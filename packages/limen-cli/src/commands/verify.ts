/**
 * limen verify — Verify a claim via external provider.
 *
 * Wraps limen.cognitive.verify(claimId) — async method.
 * Advisory only — never auto-mutates claim state.
 *
 * Parity with: limen_verify MCP tool.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createVerifyCommand(): Command {
  const cmd = new Command('verify')
    .description('Verify a claim via external verification provider (advisory only)')
    .requiredOption('--claimId <id>', 'The claim ID to verify')
    .action(async (options: {
      claimId: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          async (limen) => {
            const r = await limen.cognitive.verify(options.claimId);
            if (!r.ok) {
              throw new CliError(r.error.code, `Verify failed: ${r.error.message}`);
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
