// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * limen telemetry-record — Record a telemetry data point.
 *
 * FR-004: Validates against schema, stores as governed claim.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createTelemetryRecordCommand(): Command {
  const cmd = new Command('telemetry-record')
    .description('Record a telemetry data point as a governed claim')
    .requiredOption('--type <type>', 'Telemetry type: cost, vital, audit')
    .requiredOption('--data <json>', 'JSON object matching the telemetry schema')
    .option('--subject <subject>', 'Subject URN (auto-generated if omitted)')
    .option('--confidence <n>', 'Confidence 0.0-1.0', parseFloat)
    .action(async (options: {
      type: string;
      data: string;
      subject?: string;
      confidence?: number;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // Validate type at CLI boundary
        const validTypes = ['cost', 'vital', 'audit'];
        if (!validTypes.includes(options.type)) {
          writeError(new CliError('CLI_INVALID_TYPE', `--type must be one of: ${validTypes.join(', ')}, got "${options.type}"`));
          process.exitCode = 1;
          return;
        }

        // Parse the data JSON at CLI boundary
        let parsed: object;
        try {
          parsed = JSON.parse(options.data) as object;
        } catch {
          writeError(new CliError('CLI_INVALID_DATA', `--data is not valid JSON: ${options.data}`));
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
          const result = limen.telemetry.record(
            options.type as 'cost' | 'vital' | 'audit',
            parsed,
            {
              subject: options.subject,
              confidence: options.confidence,
            },
          );
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
