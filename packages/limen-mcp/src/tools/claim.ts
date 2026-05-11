// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Claim Protocol (CCP) MCP tools.
 *
 * limen_claim_assert — Assert a new claim with evidence grounding
 * limen_claim_query  — Query claims with filters and pagination
 * limen_recall       — Recall beliefs via convenience API (Phase 7 §7.5: includes decay visibility)
 *
 * Maps to: limen.claims.assertClaim/queryClaims, limen.recall()
 *
 * ClaimCreateInput requires branded MissionId/TaskId types.
 * The MCP layer casts plain string IDs to branded types since
 * branding is compile-time only (no runtime representation).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen, MissionId, TaskId } from 'limen-ai';
import type { SessionAdapter } from '../adapter.js';
import { z } from 'zod';
import { isPiiPredicate, containsPiiValue, containsControlChars } from './validation.js';

/** MCP error response helper. */
function mcpError(code: string, message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: code, message }) }],
    isError: true as const,
  };
}

export function registerClaimTools(server: McpServer, limen: Limen, adapter: SessionAdapter): void {

  // ── limen_claim_assert ──
  server.tool(
    'limen_claim_assert',
    'Assert a knowledge claim with evidence grounding. Requires a subject URN (entity:type:id), predicate (domain.property), confidence, and grounding mode.',
    {
      subject: z.string().describe('Subject URN in format entity:<type>:<id> (3 colon-separated segments)'),
      predicate: z.string().describe('Predicate in format <domain>.<property> (2 dot-separated segments)'),
      objectType: z.enum(['string', 'number', 'boolean', 'date', 'json']).describe('Type of the object value'),
      objectValue: z.string().describe('Object value (JSON-encoded for complex types)'),
      confidence: z.number().describe('Confidence score from 0.0 to 1.0'),
      validAt: z.string().describe('ISO 8601 timestamp for temporal anchor'),
      missionId: z.string().describe('Mission ID context for this claim'),
      taskId: z.string().nullable().describe('Task ID context (null if not task-scoped)'),
      groundingMode: z.enum(['evidence_path', 'runtime_witness']).describe('How claim truth is anchored'),
      evidenceRefs: z.string().optional().describe('JSON array of evidence refs: [{type: "artifact"|"claim"|"memory"|"capability_result", id: "..."}]'),
      runtimeWitness: z.string().optional().describe('JSON object for runtime witness: {witnessType, witnessedValues, witnessTimestamp}'),
    },
    async (args) => {
      // Parse the object value based on declared type
      let parsedValue: unknown = args.objectValue;
      if (args.objectType === 'number') {
        parsedValue = Number(args.objectValue);
      } else if (args.objectType === 'boolean') {
        parsedValue = args.objectValue === 'true';
      } else if (args.objectType === 'json') {
        try {
          parsedValue = JSON.parse(args.objectValue);
        } catch {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'INVALID_INPUT', message: `objectValue is not valid JSON: ${args.objectValue}` }) }],
            isError: true,
          };
        }
      }

      // Parse evidence refs if provided. EvidenceType is a string union:
      // 'memory' | 'artifact' | 'claim' | 'capability_result'
      type EvidenceType = 'memory' | 'artifact' | 'claim' | 'capability_result';
      const VALID_EVIDENCE_TYPES = new Set<string>(['memory', 'artifact', 'claim', 'capability_result']);
      let evidenceRefs: ReadonlyArray<{ type: EvidenceType; id: string }> = [];
      if (args.evidenceRefs) {
        let raw: unknown;
        try {
          raw = JSON.parse(args.evidenceRefs);
        } catch {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'INVALID_INPUT', message: `evidenceRefs is not valid JSON: ${args.evidenceRefs}` }) }],
            isError: true,
          };
        }
        // F-SEC-008: Runtime structure validation after JSON.parse
        if (!Array.isArray(raw)) {
          return mcpError('INVALID_INPUT', 'evidenceRefs must be a JSON array');
        }
        for (let i = 0; i < raw.length; i++) {
          const ref = raw[i] as Record<string, unknown>;
          if (typeof ref !== 'object' || ref === null || typeof ref.type !== 'string' || typeof ref.id !== 'string') {
            return mcpError('INVALID_INPUT', `evidenceRefs[${i}] must have string "type" and "id" fields`);
          }
          if (!VALID_EVIDENCE_TYPES.has(ref.type)) {
            return mcpError('INVALID_INPUT', `evidenceRefs[${i}].type must be one of: ${[...VALID_EVIDENCE_TYPES].join(', ')}`);
          }
        }
        evidenceRefs = raw as ReadonlyArray<{ type: EvidenceType; id: string }>;
      }

      // Parse runtime witness if provided
      let runtimeWitness: { witnessType: string; witnessedValues: Record<string, unknown>; witnessTimestamp: string } | undefined;
      if (args.runtimeWitness) {
        let raw: unknown;
        try {
          raw = JSON.parse(args.runtimeWitness);
        } catch {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'INVALID_INPUT', message: `runtimeWitness is not valid JSON: ${args.runtimeWitness}` }) }],
            isError: true,
          };
        }
        // F-SEC-008: Runtime structure validation after JSON.parse
        const rw = raw as Record<string, unknown>;
        if (typeof rw !== 'object' || rw === null || Array.isArray(rw)) {
          return mcpError('INVALID_INPUT', 'runtimeWitness must be a JSON object');
        }
        if (typeof rw.witnessType !== 'string') {
          return mcpError('INVALID_INPUT', 'runtimeWitness.witnessType must be a string');
        }
        if (typeof rw.witnessTimestamp !== 'string') {
          return mcpError('INVALID_INPUT', 'runtimeWitness.witnessTimestamp must be a string');
        }
        if (typeof rw.witnessedValues !== 'object' || rw.witnessedValues === null || Array.isArray(rw.witnessedValues)) {
          return mcpError('INVALID_INPUT', 'runtimeWitness.witnessedValues must be a JSON object');
        }
        runtimeWitness = rw as { witnessType: string; witnessedValues: Record<string, unknown>; witnessTimestamp: string };
      }

      // R4-01 + NEW-01: Control character rejection on all user-supplied string fields
      if (containsControlChars(args.subject)) {
        return mcpError('INVALID_SUBJECT', 'Subject contains prohibited control characters.');
      }
      if (containsControlChars(args.predicate)) {
        return mcpError('INVALID_PREDICATE', 'Predicate contains prohibited control characters.');
      }
      if (containsControlChars(args.objectValue)) {
        return mcpError('INVALID_VALUE', 'objectValue contains prohibited control characters (U+0000–U+001F). Remove null bytes and control chars before storing.');
      }
      if (containsControlChars(args.missionId)) {
        return mcpError('INVALID_INPUT', 'missionId contains prohibited control characters.');
      }
      if (args.taskId && containsControlChars(args.taskId)) {
        return mcpError('INVALID_INPUT', 'taskId contains prohibited control characters.');
      }
      if (containsControlChars(args.validAt)) {
        return mcpError('INVALID_INPUT', 'validAt contains prohibited control characters.');
      }

      // R4-01: Predicate format validation — must be domain.property (same as limen_remember)
      const PREDICATE_FORMAT_REGEX = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_.*-]+$/;
      if (!PREDICATE_FORMAT_REGEX.test(args.predicate)) {
        return mcpError('INVALID_PREDICATE', `Predicate must be in domain.property format (e.g. "decision.rationale"). Got: "${args.predicate}"`);
      }

      // R4-01: Control character rejection on runtimeWitness parsed string values
      if (runtimeWitness) {
        if (containsControlChars(runtimeWitness.witnessType)) {
          return mcpError('INVALID_INPUT', 'runtimeWitness.witnessType contains prohibited control characters.');
        }
        if (containsControlChars(runtimeWitness.witnessTimestamp)) {
          return mcpError('INVALID_INPUT', 'runtimeWitness.witnessTimestamp contains prohibited control characters.');
        }
        // Check string values within witnessedValues
        for (const [key, val] of Object.entries(runtimeWitness.witnessedValues)) {
          if (containsControlChars(key)) {
            return mcpError('INVALID_INPUT', `runtimeWitness.witnessedValues key "${key}" contains prohibited control characters.`);
          }
          if (typeof val === 'string' && containsControlChars(val)) {
            return mcpError('INVALID_INPUT', `runtimeWitness.witnessedValues["${key}"] contains prohibited control characters.`);
          }
        }
      }

      // R4-01: Control character rejection on evidenceRefs parsed string values
      for (const ref of evidenceRefs) {
        if (containsControlChars(ref.id)) {
          return mcpError('INVALID_INPUT', 'evidenceRefs entry id contains prohibited control characters.');
        }
        if (containsControlChars(ref.type)) {
          return mcpError('INVALID_INPUT', 'evidenceRefs entry type contains prohibited control characters.');
        }
      }

      // NEW-01 + F-SEC-005: Consent gate for PII predicates AND PII values.
      const hasPiiPredicate = isPiiPredicate(args.predicate);
      const hasPiiValue = typeof args.objectValue === 'string' && containsPiiValue(args.objectValue);

      if (hasPiiPredicate || hasPiiValue) {
        const parts = args.subject.split(':');
        const dataSubjectId = parts.length >= 3 ? parts.slice(1).join(':') : args.subject;

        const consentResult = limen.consent.check(dataSubjectId, 'claim_assertion');
        if (!consentResult.ok) {
          return mcpError('CONSENT_CHECK_FAILED', `Failed to check consent: ${consentResult.error.message}`);
        }
        if (consentResult.value === null) {
          const reason = hasPiiPredicate
            ? `PII predicate "${args.predicate}"`
            : 'PII pattern detected in value';
          return mcpError('CONSENT_REQUIRED', `Consent required: ${reason} on data subject "${dataSubjectId}". Register consent first via limen_consent_register.`);
        }
      }

      const result = limen.claims.assertClaim({
        subject: args.subject,
        predicate: args.predicate,
        object: { type: args.objectType, value: parsedValue },
        confidence: args.confidence,
        validAt: args.validAt,
        missionId: args.missionId as MissionId,
        taskId: args.taskId as TaskId | null,
        groundingMode: args.groundingMode,
        evidenceRefs,
        runtimeWitness,
      });

      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error.code, message: result.error.message }) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );

  // ── limen_claim_query ──
  server.tool(
    'limen_claim_query',
    'Query claims with filters. Supports subject/predicate wildcards, confidence thresholds, and pagination.',
    {
      subject: z.string().optional().describe('Subject filter — exact match or trailing wildcard (e.g. "entity:company:*")'),
      predicate: z.string().optional().describe('Predicate filter — exact match or trailing wildcard (e.g. "financial.*")'),
      status: z.enum(['active', 'retracted']).optional().describe('Filter by claim status (default: active)'),
      minConfidence: z.number().optional().describe('Minimum confidence threshold'),
      limit: z.number().optional().describe('Maximum results (max 200, default 50)'),
      offset: z.number().optional().describe('Pagination offset'),
      includeEvidence: z.boolean().optional().describe('Include evidence array per claim'),
      includeRelationships: z.boolean().optional().describe('Include relationships array per claim'),
    },
    async (args) => {
      if (args.subject && containsControlChars(args.subject)) {
        return mcpError('INVALID_INPUT', 'subject contains prohibited control characters.');
      }
      if (args.predicate && containsControlChars(args.predicate)) {
        return mcpError('INVALID_INPUT', 'predicate contains prohibited control characters.');
      }
      const result = limen.claims.queryClaims({
        subject: args.subject ?? null,
        predicate: args.predicate ?? null,
        status: args.status ?? undefined,
        minConfidence: args.minConfidence ?? null,
        limit: args.limit,
        offset: args.offset,
        includeEvidence: args.includeEvidence,
        includeRelationships: args.includeRelationships,
      });

      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error.code, message: result.error.message }) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );

  // ── limen_recall (Phase 7 §7.5: Decay Visibility) ──
  // Convenience API wrapper. BeliefView includes effectiveConfidence and freshness.
  server.tool(
    'limen_recall',
    'Query knowledge claims, excluding superseded by default. Returns BeliefView with effectiveConfidence (after time-decay) and freshness label. Uses the convenience API.',
    {
      subject: z.string().optional().describe('Subject filter — exact match or trailing wildcard (e.g. "entity:project:*")'),
      predicate: z.string().optional().describe('Predicate filter — exact match or trailing wildcard (e.g. "decision.*")'),
      minConfidence: z.number().optional().describe('Minimum confidence threshold'),
      includeSuperseded: z.boolean().optional().describe('Include superseded claims (default: false)'),
      limit: z.number().optional().describe('Maximum results (default: 50, max: 1000)'),
    },
    async (args) => {
      if (args.subject && containsControlChars(args.subject)) {
        return mcpError('INVALID_INPUT', 'subject contains prohibited control characters.');
      }
      if (args.predicate && containsControlChars(args.predicate)) {
        return mcpError('INVALID_INPUT', 'predicate contains prohibited control characters.');
      }
      const result = limen.recall(
        args.subject,
        args.predicate,
        {
          minConfidence: args.minConfidence,
          includeSuperseded: args.includeSuperseded,
          limit: args.limit,
        },
      );

      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error.code, message: result.error.message }) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );
}
