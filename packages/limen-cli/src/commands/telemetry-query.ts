/**
 * limen telemetry-query — Query telemetry claims.
 *
 * FR-004: Returns stored telemetry data points.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createTelemetryQueryCommand(): Command {
  const cmd = new Command('telemetry-query')
    .description('Query telemetry claims by type')
    .option('--type <type>', 'Telemetry type to filter (cost, vital, audit). Omit for all.')
    .option('--subject <subject>', 'Subject URN filter')
    .option('--limit <n>', 'Maximum results (default: 50)', parseInt)
    .option('--since <timestamp>', 'ISO 8601 timestamp: only return claims after this time')
    .action(async (options: {
      type?: string;
      subject?: string;
      limit?: number;
      since?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        await withEngine(globals, async (limen) => {
          const result = limen.telemetry.query(options.type, {
            subject: options.subject,
            limit: options.limit,
            since: options.since,
          });
          if (!result.ok) {
            writeError(new CliError(result.error.code, result.error.message));
            process.exitCode = 1;
            return;
          }
          writeResult(result.value);
        });
      } catch (err) {
        writeError(err instanceof CliError ? err : new CliError('CLI_INTERNAL', err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });

  return cmd;
}
