/**
 * limen replay-verify — Verify mission replay determinism.
 *
 * Wraps limen.replay.verify(missionId) to compare state snapshots
 * and detect divergences in mission state.
 *
 * Parity with: limen_replay_verify MCP tool.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createReplayVerifyCommand(): Command {
  const cmd = new Command('replay-verify')
    .description('Verify replay determinism for a completed mission')
    .requiredOption('--missionId <id>', 'Mission ID to verify')
    .action(async (options: {
      missionId: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          (limen) => {
            const r = limen.replay.verify(options.missionId);
            if (!r.ok) {
              throw new CliError(r.error.code, `Replay verify failed: ${r.error.message}`);
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
