/**
 * limen recall — Retrieve beliefs from Limen.
 *
 * Wraps the Limen convenience API recall() method.
 * All parameters optional — omitting all returns recent claims.
 *
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createRecallCommand(): Command {
  const cmd = new Command('recall')
    .description('Retrieve beliefs from Limen')
    .option('--subject <subject>', 'Subject filter (supports trailing wildcard, e.g. "entity:project:*")')
    .option('--predicate <predicate>', 'Predicate filter (supports trailing wildcard, e.g. "decision.*")')
    .option('--minConfidence <n>', 'Minimum confidence threshold', parseFloat)
    .option('--includeSuperseded', 'Include superseded claims in results')
    .option('--limit <n>', 'Maximum number of results', parseInt)
    .action(async (options: {
      subject?: string;
      predicate?: string;
      minConfidence?: number;
      includeSuperseded?: true;
      limit?: number;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // F-002/F-004: Validate --limit is a positive integer within bounds
        if (options.limit !== undefined) {
          if (isNaN(options.limit)) {
            writeError(new CliError('CLI_INVALID_LIMIT', '--limit must be a valid integer'));
            process.exitCode = 1;
            return;
          }
          if (options.limit <= 0) {
            writeError(new CliError('CLI_INVALID_LIMIT', '--limit must be a positive integer (1-1000)'));
            process.exitCode = 1;
            return;
          }
          if (options.limit > 1000) {
            writeError(new CliError('CLI_INVALID_LIMIT', '--limit must not exceed 1000'));
            process.exitCode = 1;
            return;
          }
        }

        // F-003: Validate --minConfidence is a valid number in [0.0, 1.0]
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
            const recallResult = limen.recall(
              options.subject,
              options.predicate,
              {
                ...(options.minConfidence !== undefined ? { minConfidence: options.minConfidence } : {}),
                ...(options.includeSuperseded !== undefined ? { includeSuperseded: true } : {}),
                ...(options.limit !== undefined ? { limit: options.limit } : {}),
              },
            );

            if (!recallResult.ok) {
              throw new CliError(
                recallResult.error.code,
                `Recall failed: ${recallResult.error.message}`,
              );
            }
            return recallResult.value;
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
