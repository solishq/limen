/**
 * Claim Protocol (CCP) MCP tools.
 *
 * limen_claim_assert — Assert a new claim with evidence grounding
 * limen_claim_query  — Query claims with filters and pagination
 *
 * Maps to: limen.claims.assertClaim/queryClaims
 *
 * ClaimCreateInput requires branded MissionId/TaskId types.
 * The MCP layer casts plain string IDs to branded types since
 * branding is compile-time only (no runtime representation).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen, MissionId, TaskId } from 'limen-ai';
import { z } from 'zod';

export function registerClaimTools(server: McpServer, limen: Limen): void {

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
        parsedValue = JSON.parse(args.objectValue);
      }

      // Parse evidence refs if provided. EvidenceType is a string union:
      // 'memory' | 'artifact' | 'claim' | 'capability_result'
      type EvidenceType = 'memory' | 'artifact' | 'claim' | 'capability_result';
      const evidenceRefs = args.evidenceRefs
        ? JSON.parse(args.evidenceRefs) as ReadonlyArray<{ type: EvidenceType; id: string }>
        : [];

      // Parse runtime witness if provided
      const runtimeWitness = args.runtimeWitness
        ? JSON.parse(args.runtimeWitness) as {
            witnessType: string;
            witnessedValues: Record<string, unknown>;
            witnessTimestamp: string;
          }
        : undefined;

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
}
