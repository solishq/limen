/**
 * limen connect — Create a directed relationship between two claims.
 *
 * Wraps the Limen convenience API connect() method.
 * Types: supports, contradicts, supersedes, derived_from.
 * Direction: from --from to --to.
 *
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';
import type { Limen } from 'limen-ai';

export function createConnectCommand(): Command {
  const cmd = new Command('connect')
    .description('Create a directed relationship between two claims')
    .requiredOption('--from <claimId>', 'Source claim ID')
    .requiredOption('--to <claimId>', 'Target claim ID')
    .requiredOption('--type <type>', 'Relationship type: supports|contradicts|supersedes|derived_from')
    .action(async (options: {
      from: string;
      to: string;
      type: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // Validate type before engine bootstrap
        const validTypes = ['supports', 'contradicts', 'supersedes', 'derived_from'];
        if (!validTypes.includes(options.type)) {
          writeError(new CliError(
            'CLI_INVALID_TYPE',
            `Invalid relationship type: '${options.type}'. Must be one of: ${validTypes.join(', ')}`,
          ));
          process.exitCode = 1;
          return;
        }

        const result = await withEngine(
          (limen: Limen) => {
            const connectResult = limen.connect(
              options.from,
              options.to,
              options.type as Parameters<Limen['connect']>[2],
            );

            if (!connectResult.ok) {
              throw new CliError(
                connectResult.error.code,
                `Connect failed: ${connectResult.error.message}`,
              );
            }
            return { connected: true, from: options.from, to: options.to, type: options.type };
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
