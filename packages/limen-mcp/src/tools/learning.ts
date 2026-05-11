// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
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
 *   BK-01: Consent gate for PII predicates (personal.*, user.*, identity.*).
 *   BK-04: Null byte / control character rejection at MCP boundary.
 *   BK-05: Governance protection on connect — wired isProtected() check.
 *   BK-07: Predicate format validation (domain.property regex).
 *   BK-08: Adapter claim tracking via trackClaim() after successful remember.
 *   BK-09: XSS content detection flag in response metadata.
 *
 * Previously in tools/knowledge.ts (deleted abc4731). Recreated from
 * the Limen API interface — first principles, not copy.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen } from 'limen-ai';
import type { SessionAdapter } from '../adapter.js';
import { z } from 'zod';

// ── Shared validation (NEW-04: case-insensitive PII, NEW-02: control chars) ──
import { isPiiPredicate, containsPiiValue, containsControlChars } from './validation.js';

/**
 * BK-07: Predicate format validation — must be domain.property format
 * (at least two segments separated by a dot).
 */
const PREDICATE_FORMAT_REGEX = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_.*-]+$/;

/**
 * BK-09: Detect HTML/script content that could be XSS if rendered.
 * Does NOT strip — that would change semantic meaning. Returns true if detected.
 */
const HTML_SCRIPT_REGEX = /<\s*(?:script|iframe|object|embed|form|img|svg|link|style|meta|base)\b|<\/\s*script\s*>|javascript\s*:/i;

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
  adapter: SessionAdapter,  // BK-05/BK-08: required for governance + claim tracking
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

      // BK-07: Predicate format validation — must be domain.property
      if (!PREDICATE_FORMAT_REGEX.test(args.predicate)) {
        return mcpError('INVALID_PREDICATE', `Predicate must be in domain.property format (e.g. "decision.rationale"). Got: "${args.predicate}"`);
      }

      // BK-04 + R4-02: Reject control characters in all user-supplied string fields
      if (containsControlChars(args.value)) {
        return mcpError('INVALID_VALUE', 'Value contains prohibited control characters (U+0000–U+001F). Remove null bytes and control chars before storing.');
      }
      if (containsControlChars(args.subject)) {
        return mcpError('INVALID_SUBJECT', 'Subject contains prohibited control characters.');
      }
      if (containsControlChars(args.predicate)) {
        return mcpError('INVALID_PREDICATE', 'Predicate contains prohibited control characters.');
      }
      if (args.reasoning && containsControlChars(args.reasoning)) {
        return mcpError('INVALID_INPUT', 'Reasoning contains prohibited control characters.');
      }

      // BK-01 + F-SEC-005: Consent gate for PII predicates AND PII values.
      // Check both predicate prefix and value content for PII patterns.
      const hasPiiPredicate = isPiiPredicate(args.predicate);
      const hasPiiValue = containsPiiValue(args.value);

      if (hasPiiPredicate || hasPiiValue) {
        // Extract data subject from the subject URN (entity:type:id → type:id)
        const parts = args.subject.split(':');
        const dataSubjectId = parts.length >= 3 ? parts.slice(1).join(':') : args.subject;

        const consentResult = safeCall(() => limen.consent.check(dataSubjectId, 'claim_assertion'));
        if (!consentResult.ok) {
          return mcpError('CONSENT_CHECK_FAILED', `Failed to check consent: ${consentResult.error.message}`);
        }
        // consent.check returns { ok: true, value: consent_record | null }
        // If value is null, no active consent exists
        if (consentResult.value === null) {
          const reason = hasPiiPredicate
            ? `PII predicate "${args.predicate}"`
            : 'PII pattern detected in value';
          return mcpError('CONSENT_REQUIRED', `Consent required: ${reason} on data subject "${dataSubjectId}". Register consent first via limen_consent_register.`);
        }
      }

      // F-1: Wrap in try-catch — limen.remember() throws ENGINE_UNHEALTHY if convenience layer not initialized
      const result = safeCall(() => limen.remember(args.subject, args.predicate, args.value, {
        confidence: args.confidence,
        reasoning: args.reasoning,
      }));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      // BK-08: Track claim in adapter for governance checks on connect/supersedes
      if (result.value && result.value.claimId) {
        adapter.trackClaim(result.value.claimId, args.subject);
      }

      // BK-09: Detect HTML/script content and flag in response metadata
      const containsHtml = HTML_SCRIPT_REGEX.test(args.value);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          ...result.value,
          ...(containsHtml ? { warning: 'CONTAINS_HTML_SCRIPT: value contains HTML/script content. Downstream consumers must sanitize before rendering.' } : {}),
        }) }],
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
        // NEW-02: Reject control characters (null byte injection) in statement
        if (containsControlChars(entry.statement)) {
          return mcpError('INVALID_VALUE', 'Entry statement contains prohibited control characters (U+0000–U+001F). Remove null bytes and control chars before storing.');
        }

        // F-SEC-005: Check for PII patterns in statement values.
        // Reflection entries are stored as claims — PII in statements requires consent.
        if (containsPiiValue(entry.statement)) {
          return mcpError('CONSENT_REQUIRED', `PII pattern detected in reflection entry statement (category: "${entry.category}"). Register consent before storing PII values.`);
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
      if (containsControlChars(args.claimId)) {
        return mcpError('INVALID_INPUT', 'claimId contains prohibited control characters.');
      }
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
      if (containsControlChars(args.claimId1)) {
        return mcpError('INVALID_INPUT', 'claimId1 contains prohibited control characters.');
      }
      if (containsControlChars(args.claimId2)) {
        return mcpError('INVALID_INPUT', 'claimId2 contains prohibited control characters.');
      }
      // BK-05: Governance protection — block supersession of protected claims.
      // When relationship type is 'supersedes', check if the TARGET claim (claimId2)
      // has a protected subject. Protected subjects cannot be superseded.
      if (args.type === 'supersedes') {
        const targetSubject = adapter.getTrackedSubject(args.claimId2);
        if (targetSubject !== undefined && adapter.isProtected(targetSubject)) {
          return mcpError(
            'GOVERNANCE_PROTECTED',
            `Cannot supersede claim "${args.claimId2}" — its subject "${targetSubject}" is governance-protected.`,
          );
        }
        // R-001: If targetSubject is undefined, the claim was not created in this
        // session. We cannot check governance in v1 — the engine's own validation
        // is the fallback. This is a documented known limitation.
      }

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
