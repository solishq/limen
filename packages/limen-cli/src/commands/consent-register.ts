/**
 * limen consent-register — Register a consent record.
 *
 * Wraps limen.consent.register(input) to create a new consent record
 * for a data subject. Audited per GDPR requirements.
 *
 * Parity with: limen_consent_register MCP tool.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createConsentRegisterCommand(): Command {
  const cmd = new Command('consent-register')
    .description('Register a new consent record for a data subject')
    .requiredOption('--dataSubjectId <id>', 'Data subject identifier')
    .requiredOption('--basis <basis>', 'GDPR basis: explicit_consent|contract_performance|legal_obligation|legitimate_interest')
    .requiredOption('--scope <scope>', 'Consent scope (e.g. "claim_assertion")')
    .option('--expiresAt <date>', 'Consent expiration (ISO 8601)')
    .action(async (options: {
      dataSubjectId: string;
      basis: string;
      scope: string;
      expiresAt?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const validBases = ['explicit_consent', 'contract_performance', 'legal_obligation', 'legitimate_interest'];
        if (!validBases.includes(options.basis)) {
          writeError(new CliError(
            'CLI_INVALID_BASIS',
            `Invalid consent basis: '${options.basis}'. Must be one of: ${validBases.join(', ')}`,
          ));
          process.exitCode = 1;
          return;
        }

        const result = await withEngine(
          (limen) => {
            const r = limen.consent.register({
              dataSubjectId: options.dataSubjectId,
              basis: options.basis as 'explicit_consent' | 'contract_performance' | 'legal_obligation' | 'legitimate_interest',
              scope: options.scope,
              expiresAt: options.expiresAt,
            });
            if (!r.ok) {
              throw new CliError(r.error.code, `Consent register failed: ${r.error.message}`);
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
