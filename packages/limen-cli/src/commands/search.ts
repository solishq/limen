/**
 * limen search -- Full-text search across claim content.
 *
 * Wraps the Limen convenience API search() method.
 * Uses FTS5 with BM25 relevance ranking. Returns Result<readonly SearchResult[]>
 * with belief, relevance, and score.
 *
 * Parity with: limen_search MCP tool (packages/limen-mcp/src/tools/search.ts)
 * MCP clamps limit via Math.max(1, Math.min(limit ?? 20, 200)).
 * CLI matches this behavior for interface equivalence.
 *
 * Note: --mode is not exposed (only 'fulltext' exists). When Phase 11
 * semantic search ships, both CLI and MCP will need --mode.
 *
 * JSON stdout, JSON stderr -- no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';
import { round4 } from '../output.js';
import { computeTimeFreshness } from './belief-postprocess.js';

export function createSearchCommand(): Command {
  const cmd = new Command('search')
    .description('Full-text search across claim content (FTS5 + BM25)')
    .requiredOption('--query <text>', 'Search query text')
    .option('--minConfidence <n>', 'Minimum confidence threshold (0.0-1.0)', parseFloat)
    .option('--limit <n>', 'Maximum results (default: 20, max: 200)', parseInt)
    .option('--includeSuperseded', 'Include superseded claims (default: false)')
    .action(async (options: {
      query: string;
      minConfidence?: number;
      includeSuperseded?: boolean;
      limit?: number;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // Validate --query is not empty/whitespace
        if (options.query.trim().length === 0) {
          writeError(new CliError('CLI_INVALID_QUERY', '--query must not be empty or whitespace-only'));
          process.exitCode = 1;
          return;
        }

        // Validate --limit is a valid integer, then clamp to [1, 200] (MCP parity)
        if (options.limit !== undefined) {
          if (isNaN(options.limit)) {
            writeError(new CliError('CLI_INVALID_LIMIT', '--limit must be a valid integer'));
            process.exitCode = 1;
            return;
          }
        }
        // Clamp limit to [1, 200] matching MCP: Math.max(1, Math.min(limit ?? 20, 200))
        const limit = Math.max(1, Math.min(options.limit ?? 20, 200));

        // Validate --minConfidence is a valid number in [0.0, 1.0]
        if (options.minConfidence !== undefined) {
          if (isNaN(options.minConfidence)) {
            writeError(new CliError('CLI_INVALID_CONFIDENCE', '--minConfidence must be a valid number'));
            process.exitCode = 1;
            return;
          }
          if (options.minConfidence < 0 || options.minConfidence > 1) {
            writeError(new CliError('CLI_INVALID_CONFIDENCE', '--minConfidence must be in range [0.0, 1.0]'));
            process.exitCode = 1;
            return;
          }
        }

        const result = await withEngine(
          (limen) => {
            const searchResult = limen.search(options.query, {
              ...(options.minConfidence !== undefined ? { minConfidence: options.minConfidence } : {}),
              ...(options.includeSuperseded !== undefined ? { includeSuperseded: true } : {}),
              limit,
            });

            if (!searchResult.ok) {
              throw new CliError(
                searchResult.error.code,
                `Search failed: ${searchResult.error.message}`,
              );
            }
            // FP-05: Remove the raw BM25 `relevance` field (negative numbers
            //        undermine user trust). Keep only the normalized `score`.
            // FP-04: Round effectiveConfidence on the nested belief.
            // FP-03: Replace access-based freshness with time-based.
            const now = Date.now();
            return searchResult.value.map((r) => ({
              belief: {
                ...r.belief,
                effectiveConfidence: round4(r.belief.effectiveConfidence),
                freshness: computeTimeFreshness(r.belief.createdAt, now),
              },
              score: round4(r.score),
            }));
          },
          {
            dataDir: globals.dataDir,
            masterKeyPath: globals.masterKey,
          },
        );

        writeResult(result);
      } catch (err: unknown) {
        writeError(err);
        process.exitCode = 1;
      }
    });

  return cmd;
}
