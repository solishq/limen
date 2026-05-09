// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * limen governance-erasure — Execute GDPR erasure.
 *
 * Wraps limen.governance.erasure(request) to tombstone claims,
 * audit entries, and cascade through derived_from chains.
 *
 * Parity with: limen_governance_erasure MCP tool.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createGovernanceErasureCommand(): Command {
  const cmd = new Command('governance-erasure')
    .description('Execute GDPR erasure for a data subject')
    .requiredOption('--dataSubjectId <id>', 'Data subject ID requesting erasure')
    .requiredOption('--reason <reason>', 'GDPR Article 17 basis for erasure')
    .option('--includeRelated', 'Cascade erasure through derived_from chains', false)
    .action(async (options: {
      dataSubjectId: string;
      reason: string;
      includeRelated: boolean;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          (limen) => {
            const r = limen.governance.erasure({
              dataSubjectId: options.dataSubjectId,
              reason: options.reason,
              includeRelated: options.includeRelated,
            });
            if (!r.ok) {
              throw new CliError(r.error.code, `Erasure failed: ${r.error.message}`);
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
