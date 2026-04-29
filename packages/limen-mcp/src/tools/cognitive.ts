/**
 * Cognitive MCP Tools — limen_health_cognitive + Phase 12 cognitive engine tools.
 *
 * Phase 7 §7.2: limen_health_cognitive (existing)
 * Phase 3 v3.0.0: limen_consolidate, limen_importance, limen_narrative,
 *                  limen_verify, limen_suggest_connections
 *
 * Wraps limen.cognitive.* methods as MCP tools.
 * safeCall() pattern from learning.ts for synchronous methods.
 * Direct try-catch for async methods (verify, suggestConnections).
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
 * Wraps a synchronous convenience API call that may THROW.
 * Same pattern as learning.ts safeCall().
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

export function registerCognitiveTools(server: McpServer, limen: Limen): void {

  // ── limen_health_cognitive (Phase 7 §7.2 + FR-003 + FR-010) ──
  server.tool(
    'limen_health_cognitive',
    'Get cognitive health report: freshness distribution, conflicts, confidence stats, knowledge gaps, and stale domains. Agents can self-diagnose knowledge quality.',
    {
      gapThresholdDays: z.number().optional().describe('Days without new claims before a domain is flagged as a gap (default: engine config)'),
      staleThresholdDays: z.number().optional().describe('Days since last access before a domain is flagged as stale (default: engine config)'),
      maxCriticalConflicts: z.number().optional().describe('Maximum critical conflicts to return (default: engine config)'),
      maxGaps: z.number().optional().describe('Maximum gap entries to return (default: engine config)'),
      maxStaleDomains: z.number().optional().describe('Maximum stale domain entries to return (default: engine config)'),
      maxAge: z.number().optional().describe('Cache window in milliseconds. If set, returns cached result when age < maxAge'),
      outputMode: z.enum(['structured', 'human-readable', 'ai-dense']).optional().describe('Output format: structured (default JSON), human-readable, or ai-dense (min tokens)'),
    },
    async (args) => {
      const hasConfig = args.gapThresholdDays !== undefined ||
                      args.staleThresholdDays !== undefined ||
                      args.maxCriticalConflicts !== undefined ||
                      args.maxGaps !== undefined ||
                      args.maxStaleDomains !== undefined ||
                      args.maxAge !== undefined ||
                      args.outputMode !== undefined;

      const config = hasConfig
        ? {
            gapThresholdDays: args.gapThresholdDays,
            staleThresholdDays: args.staleThresholdDays,
            maxCriticalConflicts: args.maxCriticalConflicts,
            maxGaps: args.maxGaps,
            maxStaleDomains: args.maxStaleDomains,
            maxAge: args.maxAge,
            outputMode: args.outputMode,
          }
        : undefined;

      const result = limen.cognitive.health(config);

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      // For ai-dense and human-readable, return the formatted string directly
      if (args.outputMode && args.outputMode !== 'structured' && result.value.formatted) {
        return {
          content: [{ type: 'text' as const, text: result.value.formatted }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );

  // ── limen_health_delta (FR-003) ──
  server.tool(
    'limen_health_delta',
    'Query claim changes since a timestamp. Returns counts of added claims, retracted claims, and new conflicts. Lightweight alternative to full health check for detecting changes.',
    {
      since: z.string().min(1).describe('ISO 8601 timestamp — show changes since this time'),
      predicates: z.array(z.string()).optional().describe('Optional predicate patterns to filter (e.g., "decision.*")'),
    },
    async (args) => {
      const result = safeCall(() => limen.cognitive.delta({
        since: args.since,
        predicates: args.predicates,
      }));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );

  // ── limen_consolidate (Phase 12 §12.6) ──
  server.tool(
    'limen_consolidate',
    'Run cognitive consolidation: merge similar claims, archive stale low-confidence claims, and suggest contradiction resolutions. Returns counts and full audit log.',
    {
      mergeSimilarityThreshold: z.number().optional().describe('Similarity threshold for merging (default: 0.98)'),
      archiveMaxConfidence: z.number().optional().describe('Max confidence for archive candidates (default: 0.3)'),
      archiveMaxAccessCount: z.number().optional().describe('Max access count for archive candidates (default: 1)'),
      dryRun: z.boolean().optional().describe('Preview changes without applying (default: false)'),
    },
    async (args) => {
      const options = (args.mergeSimilarityThreshold !== undefined ||
                       args.archiveMaxConfidence !== undefined ||
                       args.archiveMaxAccessCount !== undefined ||
                       args.dryRun !== undefined)
        ? {
            mergeSimilarityThreshold: args.mergeSimilarityThreshold,
            archiveFreshnessFilter: 'stale' as const,
            archiveMaxConfidence: args.archiveMaxConfidence,
            archiveMaxAccessCount: args.archiveMaxAccessCount,
            dryRun: args.dryRun,
          }
        : undefined;

      const result = safeCall(() => limen.cognitive.consolidate(options));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );

  // ── limen_importance (Phase 12 §12.3) ──
  server.tool(
    'limen_importance',
    'Compute importance score for a claim. Returns 5-factor weighted composite in [0, 1]: accessFrequency, recency, connectionDensity, confidence, governanceWeight.',
    {
      claimId: z.string().min(1).describe('The claim ID to score'),
      weights: z.object({
        accessFrequency: z.number().optional().describe('Weight for access frequency (default: 0.25)'),
        recency: z.number().optional().describe('Weight for recency (default: 0.20)'),
        connectionDensity: z.number().optional().describe('Weight for connection density (default: 0.20)'),
        confidence: z.number().optional().describe('Weight for confidence (default: 0.25)'),
        governance: z.number().optional().describe('Weight for governance (default: 0.10)'),
      }).optional().describe('Custom importance weights (sum should equal 1.0)'),
    },
    async (args) => {
      const weights = args.weights ? {
        accessFrequency: args.weights.accessFrequency ?? 0.25,
        recency: args.weights.recency ?? 0.20,
        connectionDensity: args.weights.connectionDensity ?? 0.20,
        confidence: args.weights.confidence ?? 0.25,
        governance: args.weights.governance ?? 0.10,
      } : undefined;

      const result = safeCall(() => limen.cognitive.importance(args.claimId, weights));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );

  // ── limen_narrative (Phase 12 §12.5) ──
  server.tool(
    'limen_narrative',
    'Compute narrative snapshot for a mission or global knowledge base. Shows subjects explored, decisions made, conflicts resolved, momentum, and topic threads.',
    {
      missionId: z.string().optional().describe('Mission ID to scope narrative (omit for global)'),
    },
    async (args) => {
      const result = safeCall(() => limen.cognitive.narrative(args.missionId ?? null));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );

  // ── limen_prepare_for_task (FR-008) ──
  server.tool(
    'limen_prepare_for_task',
    'Prepare task-aware context for an agent. Analyzes task description to select relevant knowledge (decisions, corrections, constraints, findings) and returns reasoning-ready context with semantic sections.',
    {
      agentRole: z.string().min(1).describe('Agent role (e.g., "Builder", "Breaker", "Researcher")'),
      project: z.string().min(1).describe('Subject pattern for project scope (e.g., "entity:project:veridion")'),
      taskId: z.string().optional().describe('Optional task identifier'),
      taskDescription: z.string().min(1).describe('Natural language task description — drives keyword extraction'),
      maxTokens: z.number().optional().describe('Token budget for total output (default: 2000)'),
      includeFindings: z.boolean().optional().describe('Include finding.* predicates (default: true)'),
      includeLocks: z.boolean().optional().describe('Include lock.* predicates (default: false)'),
      includeBudget: z.boolean().optional().describe('Include budget.* predicates (default: false)'),
    },
    async (args) => {
      const result = safeCall(() => limen.cognitive.prepareForTask({
        agentRole: args.agentRole,
        project: args.project,
        taskId: args.taskId,
        taskDescription: args.taskDescription,
        maxTokens: args.maxTokens,
        includeFindings: args.includeFindings,
        includeLocks: args.includeLocks,
        includeBudget: args.includeBudget,
      }));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      // Return the reasoning-ready text directly — it is designed for agent consumption
      return {
        content: [{ type: 'text' as const, text: result.value.text }],
      };
    },
  );

  // ── limen_verify (Phase 12 §12.7) — ASYNC ──
  server.tool(
    'limen_verify',
    'Verify a claim via external verification provider. Advisory only — never auto-mutates claim state. Returns verdict (confirmed/challenged/inconclusive), reasoning, and suggested confidence.',
    {
      claimId: z.string().min(1).describe('The claim ID to verify'),
    },
    async (args) => {
      try {
        const result = await limen.cognitive.verify(args.claimId);

        if (!result.ok) {
          return mcpError(result.error.code, result.error.message);
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return mcpError('ENGINE_UNHEALTHY', message);
      }
    },
  );

  // ── limen_suggest_connections (Phase 12 §12.4) — ASYNC ──
  server.tool(
    'limen_suggest_connections',
    'Suggest connections for a claim via embedding similarity. Returns pending suggestions that can be accepted or rejected. Requires vector search configuration.',
    {
      claimId: z.string().min(1).describe('The claim ID to find connections for'),
    },
    async (args) => {
      try {
        const result = await limen.cognitive.suggestConnections(args.claimId);

        if (!result.ok) {
          return mcpError(result.error.code, result.error.message);
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return mcpError('ENGINE_UNHEALTHY', message);
      }
    },
  );
}
