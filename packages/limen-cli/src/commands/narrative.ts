// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * limen narrative — Compute narrative snapshot.
 *
 * Wraps limen.cognitive.narrative(missionId?) to compute a narrative
 * snapshot showing subjects explored, decisions made, momentum, and threads.
 *
 * Parity with: limen_narrative MCP tool.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createNarrativeCommand(): Command {
  const cmd = new Command('narrative')
    .description('Compute narrative snapshot for a mission or global knowledge base')
    .option('--missionId <id>', 'Mission ID to scope narrative (omit for global)')
    .action(async (options: {
      missionId?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          (limen) => {
            const r = limen.cognitive.narrative(options.missionId ?? null);
            if (!r.ok) {
              throw new CliError(r.error.code, `Narrative failed: ${r.error.message}`);
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
