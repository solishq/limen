/**
 * limen forget — Retract a claim by ID.
 *
 * Wraps the Limen convenience API forget() method.
 * The claim remains in the database with status="retracted"
 * for audit continuity. Relationships are preserved.
 *
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';
import type { Limen } from 'limen-ai';

export function createForgetCommand(): Command {
  const cmd = new Command('forget')
    .description('Retract a claim by ID (audit-preserving)')
    .requiredOption('--claimId <id>', 'The ID of the claim to retract')
    .option('--reason <reason>', 'Retraction reason: incorrect|superseded|expired|manual (default: manual)')
    .action(async (options: {
      claimId: string;
      reason?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // Validate reason before engine bootstrap
        const validReasons = ['incorrect', 'superseded', 'expired', 'manual'];
        if (options.reason !== undefined && !validReasons.includes(options.reason)) {
          writeError(new CliError(
            'CLI_INVALID_REASON',
            `Invalid retraction reason: '${options.reason}'. Must be one of: ${validReasons.join(', ')}`,
          ));
          process.exitCode = 1;
          return;
        }

        const result = await withEngine(
          (limen: Limen) => {
            const forgetResult = limen.forget(
              options.claimId,
              options.reason as Parameters<Limen['forget']>[1],
            );

            if (!forgetResult.ok) {
              throw new CliError(
                forgetResult.error.code,
                `Forget failed: ${forgetResult.error.message}`,
              );
            }
            return { retracted: true, claimId: options.claimId };
          },
          {
            dataDir: globals.dataDir,
            masterKeyPath: globals.masterKey,
          },
        );

        writeResult(result);
      } catch (err: unknown) {
        writeError(err);
        process.exitCode = 1;
      }
    });

  return cmd;
}
