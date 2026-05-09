// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * limen suggest-connections — Suggest connections for a claim.
 *
 * Wraps limen.cognitive.suggestConnections(claimId) — async method.
 * Returns pending suggestions that can be accepted or rejected.
 *
 * Parity with: limen_suggest_connections MCP tool.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createSuggestConnectionsCommand(): Command {
  const cmd = new Command('suggest-connections')
    .description('Suggest connections for a claim via embedding similarity')
    .requiredOption('--claimId <id>', 'The claim ID to find connections for')
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
            const r = await limen.cognitive.suggestConnections(options.claimId);
            if (!r.ok) {
              throw new CliError(r.error.code, `Suggest connections failed: ${r.error.message}`);
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
