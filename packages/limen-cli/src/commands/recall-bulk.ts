/**
 * limen recall-bulk -- Recall beliefs for multiple subjects in one call.
 *
 * Wraps the Limen convenience API recall() method, iterating over
 * multiple subjects. Returns an array of result sets, one per input subject.
 * Reduces round-trips for agents.
 *
 * Parity with: limen_recall_bulk MCP tool (packages/limen-mcp/src/tools/search.ts)
 *
 * JSON stdout, JSON stderr -- no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

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

        // Parse and validate subjects
        const subjects = options.subjects
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);

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

        // Validate --limit is a positive integer within bounds
        if (options.limit !== undefined) {
          if (isNaN(options.limit)) {
            writeError(new CliError('CLI_INVALID_LIMIT', '--limit must be a valid integer'));
            process.exitCode = 1;
            return;
          }
          if (options.limit <= 0) {
            writeError(new CliError('CLI_INVALID_LIMIT', '--limit must be a positive integer (1-100)'));
            process.exitCode = 1;
            return;
          }
          if (options.limit > 100) {
            writeError(new CliError('CLI_INVALID_LIMIT', '--limit must not exceed 100'));
            process.exitCode = 1;
            return;
          }
        }

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
              ...(options.limit !== undefined ? { limit: options.limit } : {}),
            };

            const results: Array<{ subject: string; beliefs: unknown[]; error?: string }> = [];

            for (const subject of subjects) {
              const recallResult = limen.recall(subject, options.predicate, recallOptions);
              if (!recallResult.ok) {
                results.push({ subject, beliefs: [], error: recallResult.error.message });
              } else {
                results.push({ subject, beliefs: [...recallResult.value] });
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
