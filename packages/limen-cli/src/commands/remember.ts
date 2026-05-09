// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * limen remember — Store a knowledge claim.
 *
 * Wraps the Limen convenience API remember() method.
 * Requires subject, predicate, and value. Optionally accepts
 * confidence and reasoning.
 *
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

/**
 * FP-02: The engine caps confidence at CognitiveConfig.maxAutoConfidence
 * (default 0.7) for non-grounded claims. The CLI does not currently
 * propagate a custom CognitiveConfig to createLimen(), so the effective
 * ceiling is the engine default. Hardcode that value here with an explicit
 * pin — if the CLI ever starts passing a CognitiveConfig, update both
 * sites in the same commit.
 */
const CLI_MAX_AUTO_CONFIDENCE = 0.7;

export function createRememberCommand(): Command {
  const cmd = new Command('remember')
    .description('Store a knowledge claim in Limen')
    .requiredOption('--subject <subject>', 'Subject URN (entity:type:id)')
    .requiredOption('--predicate <predicate>', 'Predicate (domain.property)')
    .requiredOption('--value <value>', 'The knowledge to store (max 500 chars)')
    .option('--confidence <n>', 'Confidence 0.0-1.0 (default: 0.7)', parseFloat)
    .option('--reasoning <text>', 'Why this claim is being asserted (max 1000 chars)')
    .action(async (options: {
      subject: string;
      predicate: string;
      value: string;
      confidence?: number;
      reasoning?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // F-007: Reject empty value
        if (options.value.trim().length === 0) {
          writeError(new CliError('CLI_INVALID_VALUE', '--value must not be empty or whitespace-only'));
          process.exitCode = 1;
          return;
        }

        // F-006: Enforce max 500 chars (documented contract)
        if (options.value.length > 500) {
          writeError(new CliError('CLI_INVALID_VALUE', `--value must not exceed 500 characters (got ${options.value.length})`));
          process.exitCode = 1;
          return;
        }

        // Validate --confidence at CLI boundary
        if (options.confidence !== undefined) {
          if (isNaN(options.confidence)) {
            writeError(new CliError('CLI_INVALID_CONFIDENCE', '--confidence must be a valid number'));
            process.exitCode = 1;
            return;
          }
          if (options.confidence < 0 || options.confidence > 1) {
            writeError(new CliError('CLI_INVALID_CONFIDENCE', '--confidence must be in range [0.0, 1.0]'));
            process.exitCode = 1;
            return;
          }
        }

        const result = await withEngine(
          (limen) => {
            const rememberResult = limen.remember(
              options.subject,
              options.predicate,
              options.value,
              {
                ...(options.confidence !== undefined ? { confidence: options.confidence } : {}),
                ...(options.reasoning !== undefined ? { reasoning: options.reasoning } : {}),
              },
            );

            if (!rememberResult.ok) {
              throw new CliError(
                rememberResult.error.code,
                `Remember failed: ${rememberResult.error.message}`,
              );
            }
            return rememberResult.value;
          },
          {
            dataDir: globals.dataDir,
            masterKeyPath: globals.masterKey,
          },
        );

        // FP-02: Detect confidence capping and annotate the response so the
        // caller knows their requested value was governed. We only annotate
        // when the user explicitly passed --confidence AND the returned
        // confidence is strictly less than the requested value.
        const wasCapped =
          options.confidence !== undefined &&
          result.confidence < options.confidence;

        if (wasCapped) {
          writeResult({
            ...result,
            requestedConfidence: options.confidence,
            governed: true,
            governanceReason: `maxAutoConfidence ceiling (${CLI_MAX_AUTO_CONFIDENCE})`,
          });
        } else {
          writeResult(result);
        }
      } catch (err: unknown) {
        writeError(err);
        process.exitCode = 1;
      }
    });

  return cmd;
}
