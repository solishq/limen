/**
 * limen delta -- Query claim changes since a timestamp.
 *
 * Wraps limen.cognitive.delta(options) to show added/retracted/conflicts
 * counts since a given ISO timestamp. Lightweight change detection.
 *
 * Parity with: limen_health_delta MCP tool (packages/limen-mcp/src/tools/cognitive.ts)
 *
 * JSON stdout, JSON stderr -- no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createDeltaCommand(): Command {
  const cmd = new Command('delta')
    .description('Query claim changes since a timestamp: added, retracted, conflicts')
    .requiredOption('--since <timestamp>', 'ISO 8601 timestamp — show changes since this time')
    .option('--predicates <patterns...>', 'Predicate patterns to filter (e.g., "decision.*")')
    .action(async (options: {
      since: string;
      predicates?: string[];
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // Validate since is a plausible ISO timestamp before engine bootstrap
        const parsed = Date.parse(options.since);
        if (isNaN(parsed)) {
          throw new CliError(
            'CLI_INVALID_SINCE',
            `--since must be a valid ISO 8601 timestamp, got: ${options.since}`,
          );
        }

        const result = await withEngine(
          (limen) => {
            const deltaResult = limen.cognitive.delta({
              since: options.since,
              predicates: options.predicates,
            });

            if (!deltaResult.ok) {
              throw new CliError(
                deltaResult.error.code,
                `Delta query failed: ${deltaResult.error.message}`,
              );
            }

            return deltaResult.value;
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
