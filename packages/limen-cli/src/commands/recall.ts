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
import { writeResult, writeError } from '../output.js';

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
              throw new Error(`Recall failed: ${recallResult.error.message}`);
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
