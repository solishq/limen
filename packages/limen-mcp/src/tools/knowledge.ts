/**
 * Knowledge tools — high-level MCP tools for session-scoped knowledge management.
 *
 * limen_session_open   — Open a knowledge session for a project
 * limen_session_close  — Close the active session with optional summary
 * limen_remember       — Assert a knowledge claim in the active session
 * limen_recall         — Query claims with filters, excluding superseded
 * limen_connect        — Create relationships between claims (with governance check)
 * limen_reflect        — Batch-assert categorized learnings
 * limen_scratch        — Read/write/list scratch working memory entries
 *
 * All tools require a SessionAdapter for lifecycle management.
 * Tools that mutate state require an active session (adapter.active).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SessionAdapter } from '../adapter.js';

// ── Branded type alias for cast target ──
// ClaimId is not in limen-ai public exports.
// The engine accepts plain strings at runtime; branding is compile-time only.
// We cast through unknown to satisfy TypeScript without importing internal types.
type ClaimId = string & { readonly __brand: 'ClaimId' };

export function registerKnowledgeTools(server: McpServer, adapter: SessionAdapter): void {
  const limen = adapter.engine;

  // ── limen_session_open ──
  server.tool(
    'limen_session_open',
    'Open a knowledge session for a project. Creates a Limen mission and task for scratch working memory. Only one session may be active at a time.',
    {
      project: z.string().min(1).describe('Project name for this knowledge session'),
    },
    async (args) => {
      try {
        const info = await adapter.openSession(args.project);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'SESSION_OPEN_FAILED', message }) }],
          isError: true,
        };
      }
    },
  );

  // ── limen_session_close ──
  server.tool(
    'limen_session_close',
    'Close the active knowledge session. Optionally stores a summary claim before closing.',
    {
      summary: z.string().max(2000).optional().describe('Optional session summary to persist as a claim (max 2000 chars)'),
    },
    async (args) => {
      if (!adapter.active) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'NO_ACTIVE_SESSION', message: 'No session to close.' }) }],
          isError: true,
        };
      }

      // If summary provided, assert a session summary claim before closing
      if (args.summary) {
        const now = new Date().toISOString(); // clock-exempt: infrastructure timestamp
        const subject = `entity:session:${Date.now()}`; // clock-exempt: infrastructure ID
        const result = limen.claims.assertClaim({
          subject,
          predicate: 'session.summary',
          object: { type: 'string', value: args.summary },
          confidence: 1.0,
          validAt: now,
          missionId: adapter.missionId,
          taskId: null,
          evidenceRefs: [],
          groundingMode: 'runtime_witness',
          runtimeWitness: {
            witnessType: 'mcp_session',
            witnessedValues: { project: adapter.project },
            witnessTimestamp: now,
          },
        });

        if (!result.ok) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error.code, message: result.error.message }) }],
            isError: true,
          };
        }

        // Track the summary claim for governance consistency (F-MCP-007)
        adapter.trackClaim(String(result.value.claim.id), subject);
      }

      await adapter.closeSession(args.summary);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ closed: true }) }],
      };
    },
  );

  // ── limen_remember ──
  server.tool(
    'limen_remember',
    'Assert a knowledge claim in the active session. Stores a fact with subject URN, predicate, and value.',
    {
      subject: z.string().min(1).describe('Subject URN in format entity:<type>:<id>'),
      predicate: z.string().min(1).describe('Predicate in format <domain>.<property>'),
      object: z.string().min(1).max(500).describe('Object value (plain text, max 500 chars)'),
      confidence: z.number().min(0).max(1).optional().default(0.8).describe('Confidence score 0.0-1.0 (default: 0.8)'),
    },
    async (args) => {
      if (!adapter.active) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'NO_ACTIVE_SESSION', message: 'Call limen_session_open first.' }) }],
          isError: true,
        };
      }

      const now = new Date().toISOString(); // clock-exempt: infrastructure timestamp

      const result = limen.claims.assertClaim({
        subject: args.subject,
        predicate: args.predicate,
        object: { type: 'string', value: args.object },
        confidence: args.confidence,
        validAt: now,
        missionId: adapter.missionId,
        taskId: null,
        evidenceRefs: [],
        groundingMode: 'runtime_witness',
        runtimeWitness: {
          witnessType: 'mcp_session',
          witnessedValues: { project: adapter.project },
          witnessTimestamp: now,
        },
      });

      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error.code, message: result.error.message }) }],
          isError: true,
        };
      }

      const claimId = String(result.value.claim.id);
      adapter.trackClaim(claimId, args.subject);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          claimId,
          subject: args.subject,
          predicate: args.predicate,
          object: args.object,
        }, null, 2) }],
      };
    },
  );

  // ── limen_recall ──
  server.tool(
    'limen_recall',
    'Query knowledge claims with filters. Excludes superseded claims by default. Returns matching claims with confidence and dispute status.',
    {
      subject: z.string().optional().describe('Subject filter — exact match or trailing wildcard (e.g. "entity:project:*")'),
      predicate: z.string().optional().describe('Predicate filter — exact match or trailing wildcard (e.g. "decision.*")'),
      minConfidence: z.number().optional().describe('Minimum confidence threshold'),
      limit: z.number().max(1000).optional().default(20).describe('Maximum results (default: 20, max: 1000)'),
    },
    async (args) => {
      const result = limen.claims.queryClaims({
        subject: args.subject ?? null,
        predicate: args.predicate ?? null,
        minConfidence: args.minConfidence ?? null,
        limit: args.limit,
        includeRelationships: true,
      });

      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error.code, message: result.error.message }) }],
          isError: true,
        };
      }

      // Filter out superseded claims
      const filtered = result.value.claims
        .filter((item) => !item.superseded)
        .map((item) => ({
          claimId: String(item.claim.id),
          subject: item.claim.subject,
          predicate: item.claim.predicate,
          object: String(item.claim.object.value),
          confidence: item.claim.confidence,
          disputed: item.disputed,
        }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(filtered, null, 2) }],
      };
    },
  );

  // ── limen_connect ──
  server.tool(
    'limen_connect',
    'Create a relationship between two claims: supports, contradicts, supersedes, or derived_from. Governance check prevents superseding protected claims. Note: v1 governance protection only covers claims created in the current session. Claims from previous sessions are not checked against protected prefixes.',
    {
      fromClaimId: z.string().min(1).describe('Source claim ID'),
      toClaimId: z.string().min(1).describe('Target claim ID'),
      relationship: z.enum(['supports', 'contradicts', 'supersedes', 'derived_from']).describe('Relationship type'),
    },
    async (args) => {
      if (!adapter.active) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'NO_ACTIVE_SESSION', message: 'Call limen_session_open first.' }) }],
          isError: true,
        };
      }

      // Governance check: block supersession of protected claims (v1: local cache only)
      if (args.relationship === 'supersedes') {
        const targetSubject = adapter.getTrackedSubject(args.toClaimId);
        if (targetSubject !== undefined && adapter.isProtected(targetSubject)) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: 'GOVERNANCE_PROTECTED',
              message: `Cannot supersede claim with protected subject "${targetSubject}". Subject matches a protected prefix.`,
            }) }],
            isError: true,
          };
        }
      }

      const result = limen.claims.relateClaims({
        fromClaimId: args.fromClaimId as unknown as ClaimId,
        toClaimId: args.toClaimId as unknown as ClaimId,
        type: args.relationship,
        missionId: adapter.missionId,
      });

      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error.code, message: result.error.message }) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          relationshipId: String(result.value.relationship.id),
          fromClaimId: args.fromClaimId,
          toClaimId: args.toClaimId,
          type: args.relationship,
        }, null, 2) }],
      };
    },
  );

  // ── limen_reflect ──
  server.tool(
    'limen_reflect',
    'Batch-assert categorized learnings (decisions, patterns, warnings, findings) as knowledge claims. On partial failure, returns error with count of successfully stored claims. Already-stored claims are NOT rolled back.',
    {
      learnings: z.array(z.object({
        category: z.enum(['decision', 'pattern', 'warning', 'finding']).describe('Learning category'),
        statement: z.string().min(1).max(500).describe('Learning statement (max 500 chars)'),
        confidence: z.number().min(0).max(1).optional().default(0.8).describe('Confidence (default: 0.8)'),
      })).max(100).describe('Array of learnings to record (max 100 per batch)'),
    },
    async (args) => {
      if (!adapter.active) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'NO_ACTIVE_SESSION', message: 'Call limen_session_open first.' }) }],
          isError: true,
        };
      }

      const now = new Date().toISOString(); // clock-exempt: infrastructure timestamp
      const baseTimestamp = Date.now(); // clock-exempt: infrastructure ID generation
      const claimIds: string[] = [];

      for (let i = 0; i < args.learnings.length; i++) {
        const learning = args.learnings[i];
        const subject = `entity:${learning.category}:${baseTimestamp}-${i}`;
        const predicate = `${learning.category}.description`;

        const result = limen.claims.assertClaim({
          subject,
          predicate,
          object: { type: 'string', value: learning.statement },
          confidence: learning.confidence,
          validAt: now,
          missionId: adapter.missionId,
          taskId: null,
          evidenceRefs: [],
          groundingMode: 'runtime_witness',
          runtimeWitness: {
            witnessType: 'mcp_session',
            witnessedValues: { project: adapter.project },
            witnessTimestamp: now,
          },
        });

        if (!result.ok) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: result.error.code,
              message: `Failed on learning ${i}: ${result.error.message}`,
              stored: claimIds.length,
              claimIds,
            }) }],
            isError: true,
          };
        }

        const claimId = String(result.value.claim.id);
        adapter.trackClaim(claimId, subject);
        claimIds.push(claimId);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ stored: claimIds.length, claimIds }, null, 2) }],
      };
    },
  );

  // ── limen_scratch ──
  server.tool(
    'limen_scratch',
    'Read, write, or list scratch working memory entries scoped to the active session task.',
    {
      action: z.enum(['write', 'read', 'list']).describe('Action: write, read, or list'),
      key: z.string().min(1).optional().describe('Entry key (required for write and read)'),
      value: z.string().min(1).optional().describe('Entry value (required for write)'),
    },
    async (args) => {
      if (!adapter.active) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'NO_ACTIVE_SESSION', message: 'Call limen_session_open first.' }) }],
          isError: true,
        };
      }

      const taskId = adapter.taskId;

      if (args.action === 'write') {
        if (!args.key) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'MISSING_KEY', message: 'key is required for write action.' }) }],
            isError: true,
          };
        }
        if (args.value === undefined) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'MISSING_VALUE', message: 'value is required for write action.' }) }],
            isError: true,
          };
        }

        const result = limen.workingMemory.write({
          taskId,
          key: args.key,
          value: args.value,
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
      }

      if (args.action === 'read') {
        if (!args.key) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'MISSING_KEY', message: 'key is required for read action.' }) }],
            isError: true,
          };
        }

        const result = limen.workingMemory.read({
          taskId,
          key: args.key,
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
      }

      // action === 'list'
      const result = limen.workingMemory.read({
        taskId,
        key: null,
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
