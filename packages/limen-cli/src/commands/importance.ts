/**
 * limen importance — Compute importance score for a claim.
 *
 * Wraps limen.cognitive.importance(claimId, weights?) to compute
 * a 5-factor weighted composite importance score in [0, 1].
 *
 * Parity with: limen_importance MCP tool.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createImportanceCommand(): Command {
  const cmd = new Command('importance')
    .description('Compute importance score for a claim (5-factor composite)')
    .requiredOption('--claimId <id>', 'The claim ID to score')
    .action(async (options: {
      claimId: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          (limen) => {
            const r = limen.cognitive.importance(options.claimId);
            if (!r.ok) {
              throw new CliError(r.error.code, `Importance failed: ${r.error.message}`);
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
