/**
 * Phase 7 §7.1: Context Builder MCP Tool — limen_context.
 *
 * Generates a knowledge summary for system prompts by calling limen.recall()
 * with configurable filters and formatting results as a readable text block.
 *
 * Delegates to: limen.recall(subject?, predicate?, options?)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen } from 'limen-ai';
import { z } from 'zod';

export function registerContextTools(server: McpServer, limen: Limen): void {

  server.tool(
    'limen_context',
    'Generate a knowledge summary for system prompts. Recalls beliefs with configurable filters and formats them as a text block agents can inject into their context.',
    {
      subject: z.string().optional().describe('Subject filter — exact match or trailing wildcard (e.g. "entity:project:*")'),
      predicate: z.string().optional().describe('Predicate filter — exact match or trailing wildcard (e.g. "decision.*")'),
      minConfidence: z.number().optional().describe('Minimum confidence threshold (0.0-1.0)'),
      limit: z.number().optional().describe('Maximum beliefs to include (default: 20, max: 100)'),
      format: z.enum(['text', 'json']).optional().describe('Output format: "text" (default) for system prompt injection, "json" for structured data'),
    },
    async (args) => {
      const limit = Math.max(1, Math.min(args.limit ?? 20, 100));

      const result = limen.recall(
        args.subject,
        args.predicate,
        {
          minConfidence: args.minConfidence,
          limit,
        },
      );

      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error.code, message: result.error.message }) }],
          isError: true,
        };
      }

      const beliefs = result.value;

      if (args.format === 'json') {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(beliefs, null, 2) }],
        };
      }

      // Default: text format for system prompt injection
      if (beliefs.length === 0) {
        return {
          content: [{ type: 'text' as const, text: '# Knowledge Context\n\nNo relevant beliefs found.' }],
        };
      }

      const lines: string[] = ['# Knowledge Context', ''];
      for (const b of beliefs) {
        lines.push(`- **${b.subject}** | ${b.predicate}: ${b.value}`);
        lines.push(`  confidence: ${typeof b.effectiveConfidence === 'number' ? b.effectiveConfidence.toFixed(2) : 'N/A'} | freshness: ${b.freshness ?? 'N/A'} | asserted: ${b.validAt}`);
      }
      lines.push('');
      lines.push(`_${beliefs.length} belief(s) retrieved._`);

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );
}
