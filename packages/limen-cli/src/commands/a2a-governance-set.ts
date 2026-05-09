// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * limen a2a-governance-set — Set the A2A governance block.
 *
 * FR-002: Validates against schema, stores as governed claim.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createA2AGovernanceSetCommand(): Command {
  const cmd = new Command('a2a-governance-set')
    .description('Set the A2A governance block (provider-level governance metadata)')
    .requiredOption('--block <json>', 'JSON governance block object')
    .action(async (options: {
      block: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // Parse JSON at CLI boundary
        let parsed: object;
        try {
          parsed = JSON.parse(options.block) as object;
        } catch {
          writeError(new CliError('CLI_INVALID_BLOCK', `--block is not valid JSON: ${options.block}`));
          process.exitCode = 1;
          return;
        }

        await withEngine(globals, async (limen) => {
          const result = limen.a2aGovernance.setGovernanceBlock(parsed);
          if (!result.ok) {
            writeError(new CliError(result.error.code, result.error.message));
            process.exitCode = 1;
            return;
          }
          writeResult({ ok: true });
        });
      } catch (err) {
        writeError(err instanceof CliError ? err : new CliError('CLI_INTERNAL', err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });

  return cmd;
}
