// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * limen output-assert — Assert a structured output primitive.
 *
 * FR-001: Validates against schema, stores as governed claim.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createOutputAssertCommand(): Command {
  const cmd = new Command('output-assert')
    .description('Assert a structured output primitive as a governed claim')
    .requiredOption('--predicate <predicate>', 'Output predicate (e.g., output.judgment)')
    .requiredOption('--primitive <json>', 'JSON object matching the primitive schema')
    .option('--subject <subject>', 'Subject URN (auto-generated if omitted)')
    .option('--confidence <n>', 'Confidence 0.0-1.0', parseFloat)
    .action(async (options: {
      predicate: string;
      primitive: string;
      subject?: string;
      confidence?: number;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // Parse the primitive JSON at CLI boundary
        let parsed: object;
        try {
          parsed = JSON.parse(options.primitive) as object;
        } catch {
          writeError(new CliError('CLI_INVALID_PRIMITIVE', `--primitive is not valid JSON: ${options.primitive}`));
          process.exitCode = 1;
          return;
        }

        // Validate confidence at CLI boundary
        if (options.confidence !== undefined) {
          if (!Number.isFinite(options.confidence) || options.confidence < 0 || options.confidence > 1) {
            writeError(new CliError('CLI_INVALID_CONFIDENCE', `--confidence must be in [0.0, 1.0], got ${options.confidence}`));
            process.exitCode = 1;
            return;
          }
        }

        await withEngine(globals, async (limen) => {
          const result = limen.output.assert(options.predicate, parsed, {
            subject: options.subject,
            confidence: options.confidence,
          });
          if (!result.ok) {
            writeError(new CliError(result.error.code, result.error.message));
            process.exitCode = 1;
            return;
          }
          writeResult(result.value);
        });
      } catch (err) {
        writeError(err instanceof CliError ? err : new CliError('CLI_INTERNAL', err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });

  return cmd;
}
