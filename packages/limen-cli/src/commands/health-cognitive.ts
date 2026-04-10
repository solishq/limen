/**
 * limen health-cognitive -- Get cognitive health report.
 *
 * Wraps limen.cognitive.health(config?) to expose the CognitiveHealthReport
 * as JSON output. Agents can self-diagnose knowledge quality: freshness
 * distribution, conflicts, confidence stats, knowledge gaps, stale domains.
 *
 * Parity with: limen_health_cognitive MCP tool (packages/limen-mcp/src/tools/cognitive.ts)
 *
 * All 5 config parameters are optional numeric flags with engine defaults.
 * No clamping required -- the engine handles defaults internally.
 *
 * JSON stdout, JSON stderr -- no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

/**
 * Validate an optional numeric CLI flag.
 * Returns the parsed number or undefined if not provided.
 * Throws CliError if the value is NaN or negative.
 */
function validatePositiveInt(
  raw: number | undefined,
  flagName: string,
  errorCode: string,
): number | undefined {
  if (raw === undefined) return undefined;
  if (isNaN(raw)) {
    throw new CliError(errorCode, `${flagName} must be a valid number`);
  }
  if (raw < 0) {
    throw new CliError(errorCode, `${flagName} must be non-negative`);
  }
  return raw;
}

export function createHealthCognitiveCommand(): Command {
  const cmd = new Command('health-cognitive')
    .description('Get cognitive health report: freshness, conflicts, confidence, gaps, stale domains')
    .option('--gapThresholdDays <n>', 'Days without new claims before a domain is flagged as a gap', parseInt)
    .option('--staleThresholdDays <n>', 'Days since last access before a domain is flagged as stale', parseInt)
    .option('--maxCriticalConflicts <n>', 'Maximum critical conflicts to return', parseInt)
    .option('--maxGaps <n>', 'Maximum gap entries to return', parseInt)
    .option('--maxStaleDomains <n>', 'Maximum stale domain entries to return', parseInt)
    .action(async (options: {
      gapThresholdDays?: number;
      staleThresholdDays?: number;
      maxCriticalConflicts?: number;
      maxGaps?: number;
      maxStaleDomains?: number;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // Validate all numeric options before engine bootstrap
        const gapThresholdDays = validatePositiveInt(
          options.gapThresholdDays, '--gapThresholdDays', 'CLI_INVALID_GAP_THRESHOLD',
        );
        const staleThresholdDays = validatePositiveInt(
          options.staleThresholdDays, '--staleThresholdDays', 'CLI_INVALID_STALE_THRESHOLD',
        );
        const maxCriticalConflicts = validatePositiveInt(
          options.maxCriticalConflicts, '--maxCriticalConflicts', 'CLI_INVALID_MAX_CONFLICTS',
        );
        const maxGaps = validatePositiveInt(
          options.maxGaps, '--maxGaps', 'CLI_INVALID_MAX_GAPS',
        );
        const maxStaleDomains = validatePositiveInt(
          options.maxStaleDomains, '--maxStaleDomains', 'CLI_INVALID_MAX_STALE',
        );

        // Build config only if any option was provided (matches MCP behavior)
        const hasConfig = gapThresholdDays !== undefined ||
          staleThresholdDays !== undefined ||
          maxCriticalConflicts !== undefined ||
          maxGaps !== undefined ||
          maxStaleDomains !== undefined;

        const config = hasConfig
          ? { gapThresholdDays, staleThresholdDays, maxCriticalConflicts, maxGaps, maxStaleDomains }
          : undefined;

        const result = await withEngine(
          (limen) => {
            const healthResult = limen.cognitive.health(config);

            if (!healthResult.ok) {
              throw new CliError(
                healthResult.error.code,
                `Cognitive health failed: ${healthResult.error.message}`,
              );
            }

            return healthResult.value;
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
