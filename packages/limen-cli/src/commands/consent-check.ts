// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * limen consent-check — Check active consent for a data subject.
 *
 * Wraps limen.consent.check(dataSubjectId, scope) to check if active
 * consent exists. Returns the consent record if found, or null.
 *
 * Parity with: limen_consent_check MCP tool.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createConsentCheckCommand(): Command {
  const cmd = new Command('consent-check')
    .description('Check if active consent exists for a data subject and scope')
    .requiredOption('--dataSubjectId <id>', 'Data subject identifier')
    .requiredOption('--scope <scope>', 'Consent scope to check')
    .action(async (options: {
      dataSubjectId: string;
      scope: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          (limen) => {
            const r = limen.consent.check(options.dataSubjectId, options.scope);
            if (!r.ok) {
              throw new CliError(r.error.code, `Consent check failed: ${r.error.message}`);
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
