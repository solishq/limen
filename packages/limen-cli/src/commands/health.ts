/**
 * limen health — Check engine health status.
 *
 * Bootstraps the engine, calls limen.health(), outputs the
 * HealthStatus object as JSON, then shuts down.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError } from '../output.js';

export function createHealthCommand(): Command {
  const cmd = new Command('health')
    .description('Check Limen engine health status')
    .action(async (_options: Record<string, unknown>, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          async (limen) => limen.health(),
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
