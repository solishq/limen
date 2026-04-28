/**
 * Learning MCP Tools — limen_remember, limen_reflect, limen_forget, limen_connect.
 *
 * Exposes the Limen convenience API's write operations as MCP tools.
 * These are the tools that Amendment 25 learning capture depends on.
 *
 * Breaker fixes applied:
 *   F-1:  All engine calls wrapped in try-catch (ENGINE_UNHEALTHY throws).
 *   F-9:  Subject URN basic format validation.
 *   F-10: Value length enforcement (max 500 chars).
 *   F-15: Accepts SessionAdapter for governance protection on limen_connect.
 *
 * Previously in tools/knowledge.ts (deleted abc4731). Recreated from
 * the Limen API interface — first principles, not copy.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen } from 'limen-ai';
import type { SessionAdapter } from '../adapter.js';
import { z } from 'zod';

/** MCP error response helper. */
function mcpError(code: string, message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: code, message }) }],
    isError: true as const,
  };
}

/**
 * Wraps a convenience API call that may THROW (F-1: ENGINE_UNHEALTHY).
 * F-R2-06: Runtime guard against accidentally passing an async function.
 */
function safeCall<T>(fn: () => T): T | { ok: false; error: { code: string; message: string } } {
  try {
    const result = fn();
    if (result && typeof (result as Record<string, unknown>).then === 'function') {
      return { ok: false, error: { code: 'ASYNC_NOT_SUPPORTED', message: 'Convenience method returned a Promise — expected synchronous Result<T>' } };
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { code: 'ENGINE_UNHEALTHY', message } };
  }
}

export function registerLearningTools(
  server: McpServer,
  limen: Limen,
  _adapter?: SessionAdapter,  // F-15: wired for future governance gate on supersession
): void {

  // ── limen_remember ──
  server.tool(
    'limen_remember',
    'Store a knowledge claim in Limen. Provide subject (entity URN), predicate (domain.property), and value. Confidence defaults to 0.7, capped unless evidence-grounded. Use for decisions, warnings, patterns, project knowledge.',
    {
      subject: z.string().min(1).describe('Subject entity URN (e.g. "entity:decision:auth-redesign", "entity:project:limen")'),
      predicate: z.string().min(1).describe('Predicate in domain.property format (e.g. "decision.rationale", "warning.gotcha", "pattern.observed", "knowledge.architecture")'),
      value: z.string().min(1).max(500).describe('The knowledge to store — max 500 chars, actionable, specific'),
      confidence: z.number().min(0).max(1).optional().describe('Confidence 0.0-1.0 (default 0.7). Scale: 0.5 theoretical, 0.7 observed, 0.85 proven, 0.95 validated'),
      reasoning: z.string().max(1000).optional().describe('Why this claim is being asserted — max 1000 chars'),
    },
    async (args) => {
      // F-9: Basic URN validation (3 colon-separated segments minimum)
      const colonCount = (args.subject.match(/:/g) || []).length;
      if (colonCount < 2) {
        return mcpError('INVALID_SUBJECT', `Subject must be a URN with at least 3 colon-separated segments (e.g. "entity:type:id"). Got: "${args.subject}"`);
      }

      // F-1: Wrap in try-catch — limen.remember() throws ENGINE_UNHEALTHY if convenience layer not initialized
      const result = safeCall(() => limen.remember(args.subject, args.predicate, args.value, {
        confidence: args.confidence,
        reasoning: args.reasoning,
      }));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value) }],
      };
    },
  );

  // ── limen_reflect ──
  server.tool(
    'limen_reflect',
    'Batch-store categorized learnings. Each entry becomes a claim with predicate "reflection.<category>". All-or-nothing transaction. Use for Amendment 25 continuous technique extraction.',
    {
      entries: z.string().describe(
        'JSON array of entries. Each: {"category": "decision|pattern|warning|finding", "statement": "max 500 chars", "confidence": 0.7}. ' +
        'Example: [{"category":"warning","statement":"SIGPIPE from find|head with pipefail kills bash scripts silently","confidence":0.85}]',
      ),
    },
    async (args) => {
      let entries: Array<{ category: string; statement: string; confidence?: number }>;
      try {
        entries = JSON.parse(args.entries) as typeof entries;
        if (!Array.isArray(entries)) {
          return mcpError('INVALID_INPUT', 'entries must be a JSON array');
        }
      } catch {
        return mcpError('INVALID_INPUT', 'entries must be valid JSON');
      }

      if (entries.length === 0) {
        return mcpError('CONV_EMPTY_ENTRIES', 'At least one entry required');
      }
      if (entries.length > 100) {
        return mcpError('CONV_ENTRIES_LIMIT', 'Maximum 100 entries per call');
      }

      const validCategories = new Set(['decision', 'pattern', 'warning', 'finding']);
      for (const entry of entries) {
        if (typeof entry.category !== 'string' || !validCategories.has(entry.category)) {
          return mcpError('CONV_INVALID_CATEGORY', `Invalid category "${String(entry.category)}". Must be: decision, pattern, warning, finding`);
        }
        if (typeof entry.statement !== 'string' || entry.statement.length === 0) {
          return mcpError('CONV_STATEMENT_EMPTY', 'Each entry must have a non-empty statement string');
        }
        if (entry.statement.length > 500) {
          return mcpError('CONV_STATEMENT_TOO_LONG', `Statement exceeds 500 chars (got ${entry.statement.length})`);
        }
      }

      // F-1: Wrap in try-catch
      const result = safeCall(() => limen.reflect(entries as Parameters<typeof limen.reflect>[0]));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value) }],
      };
    },
  );

  // ── limen_forget ──
  server.tool(
    'limen_forget',
    'Retract a claim by ID. The claim remains in the database with status="retracted" for audit continuity. Relationships are preserved.',
    {
      claimId: z.string().min(1).describe('The ID of the claim to retract'),
      reason: z.enum(['incorrect', 'superseded', 'expired', 'manual']).optional()
        .describe('Retraction reason (default: "manual")'),
    },
    async (args) => {
      // F-1: Wrap in try-catch. F-R2-08: Cast to Limen's forget param type (not `as never`).
      // Zod enum validates at runtime; this cast aligns with the engine's second parameter type.
      const result = safeCall(() => limen.forget(args.claimId, args.reason as Parameters<typeof limen.forget>[1]));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ retracted: true, claimId: args.claimId }) }],
      };
    },
  );

  // ── limen_connect ──
  server.tool(
    'limen_connect',
    'Create a directed relationship between two claims. Types: supports, contradicts, supersedes, derived_from. Direction: from claimId1 → claimId2.',
    {
      claimId1: z.string().min(1).describe('Source claim ID'),
      claimId2: z.string().min(1).describe('Target claim ID'),
      type: z.enum(['supports', 'contradicts', 'supersedes', 'derived_from'])
        .describe('Relationship type'),
    },
    async (args) => {
      // F-15: Governance protection stub. Full implementation requires querying
      // the target claim's subject and checking against adapter.isProtected().
      // Deferred to a dedicated governance gate — the adapter is wired but
      // supersession protection needs the claim query round-trip.
      // For now, all connect operations go through the engine's own validation.

      // F-1: Wrap in try-catch
      const result = safeCall(() => limen.connect(args.claimId1, args.claimId2, args.type));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ connected: true, from: args.claimId1, to: args.claimId2, type: args.type }) }],
      };
    },
  );
}
