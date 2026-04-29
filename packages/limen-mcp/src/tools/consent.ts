/**
 * Consent MCP Tools — limen_consent_register, limen_consent_check.
 *
 * v3.0.0 Phase 3: Exposes limen.consent.register() and
 * limen.consent.check() as MCP tools.
 *
 * Delegates to: limen.consent.register(input), limen.consent.check(dataSubjectId, scope)
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

export function registerConsentTools(server: McpServer, limen: Limen): void {

  // ── limen_consent_register (Phase 9 §9.3) ──
  server.tool(
    'limen_consent_register',
    'Register a new consent record for a data subject. Audited per GDPR requirements. Basis must be one of: explicit_consent, contract_performance, legal_obligation, legitimate_interest.',
    {
      dataSubjectId: z.string().min(1).describe('Data subject identifier'),
      basis: z.enum(['explicit_consent', 'contract_performance', 'legal_obligation', 'legitimate_interest'])
        .describe('GDPR Article 6 consent basis'),
      scope: z.string().min(1).describe('What the consent covers (e.g. "claim_assertion", "data_processing")'),
      expiresAt: z.string().optional().describe('Consent expiration (ISO 8601). Omit for indefinite.'),
    },
    async (args) => {
      const result = safeCall(() => limen.consent.register({
        dataSubjectId: args.dataSubjectId,
        basis: args.basis,
        scope: args.scope,
        expiresAt: args.expiresAt,
      }));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );

  // ── limen_consent_check (Phase 9 §9.3) ──
  server.tool(
    'limen_consent_check',
    'Check if active consent exists for a data subject and scope. Returns the consent record if active, or null if no active consent found. Expiry is computed on read.',
    {
      dataSubjectId: z.string().min(1).describe('Data subject identifier'),
      scope: z.string().min(1).describe('Consent scope to check'),
    },
    async (args) => {
      const result = safeCall(() => limen.consent.check(args.dataSubjectId, args.scope));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );
}
