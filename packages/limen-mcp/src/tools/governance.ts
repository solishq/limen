/**
 * Governance MCP Tools — limen_governance_erasure, limen_governance_audit_export.
 *
 * v3.0.0 Phase 3: Exposes limen.governance.erasure() and
 * limen.governance.exportAudit() as MCP tools.
 *
 * Delegates to: limen.governance.erasure(request), limen.governance.exportAudit(options)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen } from 'limen-ai';
import { z } from 'zod';

/** MCP error response helper. */
function mcpError(code: string, message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: code, message }) }],
    isError: true as const,
  };
}

/**
 * Wraps a synchronous API call that may THROW.
 */
function safeCall<T>(fn: () => T): T | { ok: false; error: { code: string; message: string } } {
  try {
    const result = fn();
    if (result && typeof (result as Record<string, unknown>).then === 'function') {
      return { ok: false, error: { code: 'ASYNC_NOT_SUPPORTED', message: 'Method returned a Promise — expected synchronous Result<T>' } };
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { code: 'ENGINE_UNHEALTHY', message } };
  }
}

export function registerGovernanceTools(server: McpServer, limen: Limen): void {

  // ── limen_governance_erasure (Phase 10 §10.4) ──
  server.tool(
    'limen_governance_erasure',
    'Execute GDPR erasure for a data subject. Tombstones claims, audit entries, and cascades through derived_from chains if requested. Returns an erasure certificate as proof.',
    {
      dataSubjectId: z.string().min(1).describe('Data subject ID requesting erasure'),
      reason: z.string().min(1).describe('GDPR Article 17 basis for erasure'),
      includeRelated: z.boolean().default(false).describe('Cascade erasure through derived_from chains (default: false)'),
    },
    async (args) => {
      const result = safeCall(() => limen.governance.erasure({
        dataSubjectId: args.dataSubjectId,
        reason: args.reason,
        includeRelated: args.includeRelated,
      }));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );

  // ── limen_governance_audit_export (Phase 10 §10.5) ──
  server.tool(
    'limen_governance_audit_export',
    'Generate SOC 2 audit export for a time period. Returns a compliance package with control evidence, chain verification, and statistics.',
    {
      from: z.string().min(1).describe('Period start (ISO 8601 date)'),
      to: z.string().min(1).describe('Period end (ISO 8601 date)'),
    },
    async (args) => {
      const result = safeCall(() => limen.governance.exportAudit({
        from: args.from,
        to: args.to,
      }));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );
}
