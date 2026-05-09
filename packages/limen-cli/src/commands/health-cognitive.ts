// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
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
 * Parse a CLI string as a strict decimal integer.
 * Returns NaN for anything that is not a pure decimal integer string.
 *
 * Why not parseInt: parseInt silently truncates floats (3.7 -> 3),
 * accepts hex (0x10 -> 16), and mishandles scientific notation (1e5 -> 1).
 * This function rejects all of those by returning NaN, which the
 * downstream validateNonNegativeInt catches with the correct error code.
 *
 * Commander.js option parser callback: receives the raw string.
 */
function parseStrictInt(value: string): number {
  // Only allow optional minus sign followed by decimal digits.
  // Rejects hex (0x...), scientific notation (1e5), floats (3.7),
  // and any other non-decimal-integer format at the string level.
  if (!/^-?\d+$/.test(value)) {
    return NaN;
  }
  return Number(value);
}

/**
 * Validate a parsed numeric CLI flag is a non-negative finite integer.
 * Returns the validated number or undefined if not provided.
 * Throws CliError if the value is NaN, Infinity, or negative.
 */
function validateNonNegativeInt(
  raw: number | undefined,
  flagName: string,
  errorCode: string,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isFinite(raw) || isNaN(raw)) {
    throw new CliError(errorCode, `${flagName} must be a valid integer`);
  }
  if (raw < 0) {
    throw new CliError(errorCode, `${flagName} must be non-negative`);
  }
  return raw;
}

export function createHealthCognitiveCommand(): Command {
  const cmd = new Command('health-cognitive')
    .description('Get cognitive health report: freshness, conflicts, confidence, gaps, stale domains')
    .option('--gapThresholdDays <n>', 'Days without new claims before a domain is flagged as a gap', parseStrictInt)
    .option('--staleThresholdDays <n>', 'Days since last access before a domain is flagged as stale', parseStrictInt)
    .option('--maxCriticalConflicts <n>', 'Maximum critical conflicts to return', parseStrictInt)
    .option('--maxGaps <n>', 'Maximum gap entries to return', parseStrictInt)
    .option('--maxStaleDomains <n>', 'Maximum stale domain entries to return', parseStrictInt)
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
        const gapThresholdDays = validateNonNegativeInt(
          options.gapThresholdDays, '--gapThresholdDays', 'CLI_INVALID_GAP_THRESHOLD',
        );
        const staleThresholdDays = validateNonNegativeInt(
          options.staleThresholdDays, '--staleThresholdDays', 'CLI_INVALID_STALE_THRESHOLD',
        );
        const maxCriticalConflicts = validateNonNegativeInt(
          options.maxCriticalConflicts, '--maxCriticalConflicts', 'CLI_INVALID_MAX_CONFLICTS',
        );
        const maxGaps = validateNonNegativeInt(
          options.maxGaps, '--maxGaps', 'CLI_INVALID_MAX_GAPS',
        );
        const maxStaleDomains = validateNonNegativeInt(
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
