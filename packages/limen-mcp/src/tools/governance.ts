// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
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
import { containsControlChars, isPiiPredicate } from './validation.js';

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
      // Structural completeness: reject control characters in user-controlled strings
      if (containsControlChars(args.dataSubjectId)) {
        return mcpError('INVALID_INPUT', 'dataSubjectId contains control characters');
      }
      if (containsControlChars(args.reason)) {
        return mcpError('INVALID_INPUT', 'reason contains control characters');
      }

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
  // BK-02: OOM protection — count total entries first, reject if too large,
  // and cap the serialized output size.
  server.tool(
    'limen_governance_audit_export',
    'Generate SOC 2 audit export for a time period. Returns a compliance package with control evidence, chain verification, and statistics. If the result exceeds 10000 entries, returns a summary with instructions to narrow the date range.',
    {
      from: z.string().min(1).describe('Period start (ISO 8601 date)'),
      to: z.string().min(1).describe('Period end (ISO 8601 date)'),
    },
    async (args) => {
      if (containsControlChars(args.from)) {
        return mcpError('INVALID_INPUT', 'from contains control characters');
      }
      if (containsControlChars(args.to)) {
        return mcpError('INVALID_INPUT', 'to contains control characters');
      }

      const result = safeCall(() => limen.governance.exportAudit({
        from: args.from,
        to: args.to,
      }));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      // F-SEC-007: Redact PII predicates from audit export evidence entries.
      // Any evidence entry whose predicate matches a PII prefix has its value
      // replaced with "[REDACTED — PII]" to prevent PII leakage via audit export.
      const pkg = result.value;
      if (pkg.controls) {
        for (const control of Object.values(pkg.controls)) {
          const ctrl = control as { evidenceEntries?: Array<{ predicate?: string; value?: unknown }> };
          if (ctrl.evidenceEntries && Array.isArray(ctrl.evidenceEntries)) {
            for (const entry of ctrl.evidenceEntries) {
              if (entry.predicate && isPiiPredicate(entry.predicate)) {
                entry.value = '[REDACTED — PII]';
              }
            }
          }
        }
      }

      // BK-02: Check total entry count across all control categories.
      // If above threshold, return summary only with a hasMore indicator.
      const MAX_ENTRIES = 10_000;
      const totalEntries = pkg.statistics?.totalAuditEntries ?? 0;

      if (totalEntries > MAX_ENTRIES) {
        // Return statistics and chain verification without the full evidence arrays
        const summary = {
          warning: 'RESULT_TOO_LARGE',
          message: `Audit export contains ${totalEntries} entries (limit: ${MAX_ENTRIES}). Narrow the date range to retrieve full evidence.`,
          hasMore: true,
          totalEntries,
          period: pkg.period,
          statistics: pkg.statistics,
          chainVerification: pkg.chainVerification,
          controls: {
            accessControl: { controlId: pkg.controls.accessControl.controlId, compliant: pkg.controls.accessControl.compliant, notes: pkg.controls.accessControl.notes, evidenceCount: pkg.controls.accessControl.evidenceEntries.length },
            changeManagement: { controlId: pkg.controls.changeManagement.controlId, compliant: pkg.controls.changeManagement.compliant, notes: pkg.controls.changeManagement.notes, evidenceCount: pkg.controls.changeManagement.evidenceEntries.length },
            dataIntegrity: { controlId: pkg.controls.dataIntegrity.controlId, compliant: pkg.controls.dataIntegrity.compliant, notes: pkg.controls.dataIntegrity.notes, evidenceCount: pkg.controls.dataIntegrity.evidenceEntries.length },
            auditLogging: { controlId: pkg.controls.auditLogging.controlId, compliant: pkg.controls.auditLogging.compliant, notes: pkg.controls.auditLogging.notes, evidenceCount: pkg.controls.auditLogging.evidenceEntries.length },
          },
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );
}
