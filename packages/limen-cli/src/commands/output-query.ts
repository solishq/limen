/**
 * limen output-query — Query stored output primitives.
 *
 * FR-001: Returns semantic output claims by type.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createOutputQueryCommand(): Command {
  const cmd = new Command('output-query')
    .description('Query stored output primitives by type')
    .option('--type <type>', 'Output type to filter (e.g., output.judgment). Omit for all.')
    .option('--subject <subject>', 'Subject URN filter')
    .option('--limit <n>', 'Maximum results (default: 50)', parseInt)
    .action(async (options: {
      type?: string;
      subject?: string;
      limit?: number;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        await withEngine(globals, async (limen) => {
          const result = limen.output.query(options.type, {
            subject: options.subject,
            limit: options.limit,
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
