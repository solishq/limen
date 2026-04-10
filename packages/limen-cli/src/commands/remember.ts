/**
 * limen remember — Store a knowledge claim.
 *
 * Wraps the Limen convenience API remember() method.
 * Requires subject, predicate, and value. Optionally accepts
 * confidence and reasoning.
 *
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError } from '../output.js';

export function createRememberCommand(): Command {
  const cmd = new Command('remember')
    .description('Store a knowledge claim in Limen')
    .requiredOption('--subject <subject>', 'Subject URN (entity:type:id)')
    .requiredOption('--predicate <predicate>', 'Predicate (domain.property)')
    .requiredOption('--value <value>', 'The knowledge to store (max 500 chars)')
    .option('--confidence <n>', 'Confidence 0.0-1.0 (default: 0.7)', parseFloat)
    .option('--reasoning <text>', 'Why this claim is being asserted (max 1000 chars)')
    .action(async (options: {
      subject: string;
      predicate: string;
      value: string;
      confidence?: number;
      reasoning?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          (limen) => {
            const rememberResult = limen.remember(
              options.subject,
              options.predicate,
              options.value,
              {
                ...(options.confidence !== undefined ? { confidence: options.confidence } : {}),
                ...(options.reasoning !== undefined ? { reasoning: options.reasoning } : {}),
              },
            );

            if (!rememberResult.ok) {
              throw new Error(`Remember failed: ${rememberResult.error.message}`);
            }
            return rememberResult.value;
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
