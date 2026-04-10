/**
 * limen context -- Generate a knowledge summary for system prompts.
 *
 * Wraps the Limen convenience API recall() method with configurable
 * filters and formats results as a text block or JSON that agents
 * can inject into their context.
 *
 * Parity with: limen_context MCP tool (packages/limen-mcp/src/tools/context.ts)
 *
 * JSON stdout, JSON stderr -- no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createContextCommand(): Command {
  const cmd = new Command('context')
    .description('Generate a knowledge summary for system prompts')
    .option('--subject <subject>', 'Subject filter (supports trailing wildcard, e.g. "entity:project:*")')
    .option('--predicate <predicate>', 'Predicate filter (supports trailing wildcard, e.g. "decision.*")')
    .option('--minConfidence <n>', 'Minimum confidence threshold (0.0-1.0)', parseFloat)
    .option('--limit <n>', 'Maximum beliefs to include (default: 20, max: 100)', parseInt)
    .option('--format <format>', 'Output format: "text" (default) or "json"')
    .action(async (options: {
      subject?: string;
      predicate?: string;
      minConfidence?: number;
      limit?: number;
      format?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // Validate --format if provided
        const validFormats = ['text', 'json'];
        if (options.format !== undefined && !validFormats.includes(options.format)) {
          writeError(new CliError(
            'CLI_INVALID_FORMAT',
            `Invalid format: '${options.format}'. Must be one of: ${validFormats.join(', ')}`,
          ));
          process.exitCode = 1;
          return;
        }

        // Validate --limit is a positive integer within bounds
        if (options.limit !== undefined) {
          if (isNaN(options.limit)) {
            writeError(new CliError('CLI_INVALID_LIMIT', '--limit must be a valid integer'));
            process.exitCode = 1;
            return;
          }
          if (options.limit <= 0) {
            writeError(new CliError('CLI_INVALID_LIMIT', '--limit must be a positive integer (1-100)'));
            process.exitCode = 1;
            return;
          }
          if (options.limit > 100) {
            writeError(new CliError('CLI_INVALID_LIMIT', '--limit must not exceed 100'));
            process.exitCode = 1;
            return;
          }
        }

        // Validate --minConfidence is a valid number in [0.0, 1.0]
        if (options.minConfidence !== undefined) {
          if (isNaN(options.minConfidence)) {
            writeError(new CliError('CLI_INVALID_CONFIDENCE', '--minConfidence must be a valid number'));
            process.exitCode = 1;
            return;
          }
          if (options.minConfidence < 0 || options.minConfidence > 1) {
            writeError(new CliError('CLI_INVALID_CONFIDENCE', '--minConfidence must be in range [0.0, 1.0]'));
            process.exitCode = 1;
            return;
          }
        }

        const result = await withEngine(
          (limen) => {
            const recallResult = limen.recall(
              options.subject,
              options.predicate,
              {
                ...(options.minConfidence !== undefined ? { minConfidence: options.minConfidence } : {}),
                ...(options.limit !== undefined ? { limit: options.limit } : {}),
              },
            );

            if (!recallResult.ok) {
              throw new CliError(
                recallResult.error.code,
                `Context failed: ${recallResult.error.message}`,
              );
            }

            const beliefs = recallResult.value;

            // JSON format: return beliefs directly
            if (options.format === 'json') {
              return beliefs;
            }

            // Default: text format for system prompt injection
            if (beliefs.length === 0) {
              return { text: '# Knowledge Context\n\nNo relevant beliefs found.' };
            }

            const lines: string[] = ['# Knowledge Context', ''];
            for (const b of beliefs) {
              lines.push(`- **${b.subject}** | ${b.predicate}: ${b.value}`);
              lines.push(`  confidence: ${typeof b.effectiveConfidence === 'number' ? b.effectiveConfidence.toFixed(2) : 'N/A'} | freshness: ${b.freshness ?? 'N/A'} | asserted: ${b.validAt}`);
            }
            lines.push('');
            lines.push(`_${beliefs.length} belief(s) retrieved._`);

            return { text: lines.join('\n') };
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
