/**
 * Phase 7 §7.4: Search MCP Tool — limen_search.
 *
 * Wraps limen.search(query, options?) to expose full-text search
 * to any MCP client. Returns SearchResult[] with belief, relevance, and score.
 *
 * Delegates to: limen.search(query, options?)
 *
 * Phase 7 §7.3: Bulk Recall MCP Tool — limen_recall_bulk.
 *
 * Accepts an array of subjects, calls limen.recall() for each,
 * returns combined results. Reduces round-trips for agents.
 *
 * Delegates to: limen.recall(subject, predicate?, options?) per subject.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen } from 'limen-ai';
import { z } from 'zod';

export function registerSearchTools(server: McpServer, limen: Limen): void {

  // ── limen_search (§7.4) ──
  server.tool(
    'limen_search',
    'Full-text search across claim content using FTS5 with BM25 relevance ranking. Returns beliefs with relevance score.',
    {
      query: z.string().describe('Search query text'),
      minConfidence: z.number().optional().describe('Minimum confidence threshold (0.0-1.0)'),
      limit: z.number().optional().describe('Maximum results (default: 20, max: 200)'),
      includeSuperseded: z.boolean().optional().describe('Include superseded claims (default: false)'),
    },
    async (args) => {
      const limit = Math.max(1, Math.min(args.limit ?? 20, 200));
      const result = limen.search(args.query, {
        minConfidence: args.minConfidence,
        limit,
        includeSuperseded: args.includeSuperseded,
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

  // ── limen_recall_bulk (§7.3) ──
  server.tool(
    'limen_recall_bulk',
    'Recall beliefs for multiple subjects in one call. Returns an array of result sets, one per input subject. Reduces round-trips.',
    {
      subjects: z.string().describe('JSON array of subject URNs to recall (e.g. \'["entity:project:alpha","entity:user:bob"]\')'),
      predicate: z.string().optional().describe('Predicate filter applied to all subjects'),
      minConfidence: z.number().optional().describe('Minimum confidence threshold (0.0-1.0)'),
      limit: z.number().optional().describe('Maximum results per subject (default: 20, max: 100)'),
    },
    async (args) => {
      let subjects: string[];
      try {
        subjects = JSON.parse(args.subjects) as string[];
        if (!Array.isArray(subjects)) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'INVALID_INPUT', message: 'subjects must be a JSON array of strings' }) }],
            isError: true,
          };
        }
        if (!subjects.every((s: unknown) => typeof s === 'string')) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'INVALID_INPUT', message: 'All elements in subjects array must be strings' }) }],
            isError: true,
          };
        }
      } catch {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'INVALID_INPUT', message: 'subjects must be a valid JSON array' }) }],
          isError: true,
        };
      }

      if (subjects.length === 0) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify([]) }],
        };
      }

      if (subjects.length > 50) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'INVALID_INPUT', message: 'Maximum 50 subjects per bulk recall' }) }],
          isError: true,
        };
      }

      const limitPerSubject = Math.max(1, Math.min(args.limit ?? 20, 100));
      const options = {
        minConfidence: args.minConfidence,
        limit: limitPerSubject,
      };

      const results: Array<{ subject: string; beliefs: unknown[]; error?: string }> = [];

      for (const subject of subjects) {
        const result = limen.recall(subject, args.predicate, options);
        if (!result.ok) {
          results.push({ subject, beliefs: [], error: result.error.message });
        } else {
          results.push({ subject, beliefs: [...result.value] });
        }
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      };
    },
  );
}
