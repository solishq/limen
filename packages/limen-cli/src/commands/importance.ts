// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
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
    .option('--weight-access <n>', 'Weight for access frequency (0-1)', parseFloat)
    .option('--weight-recency <n>', 'Weight for recency (0-1)', parseFloat)
    .option('--weight-connections <n>', 'Weight for connection density (0-1)', parseFloat)
    .option('--weight-confidence <n>', 'Weight for confidence (0-1)', parseFloat)
    .option('--weight-governance <n>', 'Weight for governance (0-1)', parseFloat)
    .action(async (options: {
      claimId: string;
      weightAccess?: number;
      weightRecency?: number;
      weightConnections?: number;
      weightConfidence?: number;
      weightGovernance?: number;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          (limen) => {
            const weights = (options.weightAccess !== undefined || options.weightRecency !== undefined ||
              options.weightConnections !== undefined || options.weightConfidence !== undefined ||
              options.weightGovernance !== undefined) ? {
              accessFrequency: options.weightAccess,
              recency: options.weightRecency,
              connectionDensity: options.weightConnections,
              confidence: options.weightConfidence,
              governance: options.weightGovernance,
            } : undefined;
            const r = limen.cognitive.importance(options.claimId, weights);
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
