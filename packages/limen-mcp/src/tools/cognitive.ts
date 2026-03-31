/**
 * Phase 7 §7.2: Cognitive Health MCP Tool — limen_health_cognitive.
 *
 * Wraps limen.cognitive.health() to expose the CognitiveHealthReport
 * as structured MCP output. Agents can self-diagnose knowledge quality.
 *
 * Delegates to: limen.cognitive.health(config?)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen } from 'limen-ai';
import { z } from 'zod';

export function registerCognitiveTools(server: McpServer, limen: Limen): void {

  server.tool(
    'limen_health_cognitive',
    'Get cognitive health report: freshness distribution, conflicts, confidence stats, knowledge gaps, and stale domains. Agents can self-diagnose knowledge quality.',
    {
      gapThresholdDays: z.number().optional().describe('Days without new claims before a domain is flagged as a gap (default: engine config)'),
      staleThresholdDays: z.number().optional().describe('Days since last access before a domain is flagged as stale (default: engine config)'),
      maxCriticalConflicts: z.number().optional().describe('Maximum critical conflicts to return (default: engine config)'),
      maxGaps: z.number().optional().describe('Maximum gap entries to return (default: engine config)'),
      maxStaleDomains: z.number().optional().describe('Maximum stale domain entries to return (default: engine config)'),
    },
    async (args) => {
      const config = (args.gapThresholdDays !== undefined ||
                      args.staleThresholdDays !== undefined ||
                      args.maxCriticalConflicts !== undefined ||
                      args.maxGaps !== undefined ||
                      args.maxStaleDomains !== undefined)
        ? {
            gapThresholdDays: args.gapThresholdDays,
            staleThresholdDays: args.staleThresholdDays,
            maxCriticalConflicts: args.maxCriticalConflicts,
            maxGaps: args.maxGaps,
            maxStaleDomains: args.maxStaleDomains,
          }
        : undefined;

      const result = limen.cognitive.health(config);

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
