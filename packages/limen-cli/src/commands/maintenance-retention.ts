/**
 * limen maintenance-retention — Execute a manual retention pass.
 *
 * Wraps limen.maintenance.runRetention() to archive/delete records
 * past their retention period based on configured policies.
 *
 * Parity with: limen_maintenance_retention MCP tool.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createMaintenanceRetentionCommand(): Command {
  const cmd = new Command('maintenance-retention')
    .description('Execute a manual retention pass (archive/delete expired records)')
    .action(async (_options: Record<string, never>, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          (limen) => {
            const r = limen.maintenance.runRetention();
            if (!r.ok) {
              throw new CliError(r.error.code, `Retention failed: ${r.error.message}`);
            }
            return r.value;
          },
          { dataDir: globals.dataDir, masterKeyPath: globals.masterKey },
        );

        writeResult(result);
      } catch (err: unknown) {
        writeError(err);
        process.exitCode = 1;
      }
    });

  return cmd;
}
