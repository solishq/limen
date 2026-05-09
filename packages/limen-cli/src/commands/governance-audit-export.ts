// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * limen governance-audit-export — Generate SOC 2 audit export.
 *
 * Wraps limen.governance.exportAudit(options) to generate a compliance
 * package with control evidence, chain verification, and statistics.
 *
 * Parity with: limen_governance_audit_export MCP tool.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createGovernanceAuditExportCommand(): Command {
  const cmd = new Command('governance-audit-export')
    .description('Generate SOC 2 audit export for a time period')
    .requiredOption('--from <date>', 'Period start (ISO 8601 date)')
    .requiredOption('--to <date>', 'Period end (ISO 8601 date)')
    .action(async (options: {
      from: string;
      to: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          (limen) => {
            const r = limen.governance.exportAudit({
              from: options.from,
              to: options.to,
            });
            if (!r.ok) {
              throw new CliError(r.error.code, `Audit export failed: ${r.error.message}`);
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
