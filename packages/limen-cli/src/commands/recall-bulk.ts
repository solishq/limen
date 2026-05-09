// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * limen recall-bulk -- Recall beliefs for multiple subjects in one call.
 *
 * Wraps the Limen convenience API recall() method, iterating over
 * multiple subjects. Returns an array of result sets, one per input subject.
 * Reduces round-trips for agents.
 *
 * Parity with: limen_recall_bulk MCP tool (packages/limen-mcp/src/tools/search.ts:54)
 * MCP accepts JSON array string ('["entity:a","entity:b"]').
 * CLI accepts BOTH JSON array and comma-separated formats for parity + ergonomics.
 * MCP clamps limit via Math.max(1, Math.min(limit ?? 20, 100)).
 * CLI matches this clamping behavior.
 *
 * JSON stdout, JSON stderr -- no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';
import { processBeliefs } from './belief-postprocess.js';

export function createRecallBulkCommand(): Command {
  const cmd = new Command('recall-bulk')
    .description('Recall beliefs for multiple subjects in one call')
    .requiredOption('--subjects <list>', 'Comma-separated subject URNs (e.g. "entity:project:alpha,entity:user:bob")')
    .option('--predicate <predicate>', 'Predicate filter applied to all subjects')
    .option('--minConfidence <n>', 'Minimum confidence threshold (0.0-1.0)', parseFloat)
    .option('--limit <n>', 'Maximum results per subject (default: 20, max: 100)', parseInt)
    .action(async (options: {
      subjects: string;
      predicate?: string;
      minConfidence?: number;
      limit?: number;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // Parse subjects: accept JSON array (MCP parity) or comma-separated (CLI ergonomics)
        let subjects: string[];
        const trimmed = options.subjects.trim();
        if (trimmed.startsWith('[')) {
          // JSON array format (MCP-compatible)
          try {
            const parsed = JSON.parse(trimmed) as unknown;
            if (!Array.isArray(parsed)) {
              writeError(new CliError('CLI_INVALID_SUBJECTS', '--subjects JSON must be an array'));
              process.exitCode = 1;
              return;
            }
            if (!parsed.every((s: unknown) => typeof s === 'string')) {
              writeError(new CliError('CLI_INVALID_SUBJECTS', 'All elements in --subjects array must be strings'));
              process.exitCode = 1;
              return;
            }
            subjects = (parsed as string[]).map(s => s.trim()).filter(s => s.length > 0);
          } catch {
            writeError(new CliError('CLI_INVALID_SUBJECTS', '--subjects contains invalid JSON'));
            process.exitCode = 1;
            return;
          }
        } else {
          // Comma-separated format (CLI ergonomics)
          subjects = trimmed
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0);
        }

        if (subjects.length === 0) {
          writeError(new CliError('CLI_INVALID_SUBJECTS', '--subjects must contain at least one subject URN'));
          process.exitCode = 1;
          return;
        }

        if (subjects.length > 50) {
          writeError(new CliError('CLI_INVALID_SUBJECTS', `Maximum 50 subjects per bulk recall (got ${subjects.length})`));
          process.exitCode = 1;
          return;
        }

        // Validate --limit is a valid integer, then clamp to [1, 100] (MCP parity)
        if (options.limit !== undefined) {
          if (isNaN(options.limit)) {
            writeError(new CliError('CLI_INVALID_LIMIT', '--limit must be a valid integer'));
            process.exitCode = 1;
            return;
          }
        }
        // Clamp limit to [1, 100] matching MCP: Math.max(1, Math.min(limit ?? 20, 100))
        const limitPerSubject = Math.max(1, Math.min(options.limit ?? 20, 100));

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
            const recallOptions = {
              ...(options.minConfidence !== undefined ? { minConfidence: options.minConfidence } : {}),
              limit: limitPerSubject,
            };

            const results: Array<{ subject: string; beliefs: unknown[]; error?: string }> = [];
            const now = Date.now();

            for (const subject of subjects) {
              const recallResult = limen.recall(subject, options.predicate, recallOptions);
              if (!recallResult.ok) {
                results.push({ subject, beliefs: [], error: recallResult.error.message });
              } else {
                // FP-03/04/06/10a: apply CLI-layer corrections per subject
                const processed = processBeliefs(
                  limen,
                  recallResult.value,
                  options.predicate,
                  now,
                );
                results.push({ subject, beliefs: processed });
              }
            }

            return results;
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
