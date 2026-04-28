/**
 * limen context -- Generate a knowledge summary for system prompts.
 *
 * Wraps the Limen convenience API recall() method with configurable
 * filters and formats results as a text block or JSON that agents
 * can inject into their context.
 *
 * Parity with: limen_context MCP tool (packages/limen-mcp/src/tools/context.ts)
 * MCP clamps limit via Math.max(1, Math.min(limit ?? 20, 100)).
 * CLI matches this behavior for interface equivalence.
 *
 * JSON stdout, JSON stderr -- no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeRawText, writeError, CliError } from '../output.js';
import { processBeliefs } from './belief-postprocess.js';

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

        // Validate --limit is a valid integer, then clamp to [1, 100] (MCP parity)
        if (options.limit !== undefined) {
          if (isNaN(options.limit)) {
            writeError(new CliError('CLI_INVALID_LIMIT', '--limit must be a valid integer'));
            process.exitCode = 1;
            return;
          }
        }
        // Clamp limit to [1, 100] matching MCP: Math.max(1, Math.min(limit ?? 20, 100))
        const limit = Math.max(1, Math.min(options.limit ?? 20, 100));

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
                limit,
              },
            );

            if (!recallResult.ok) {
              throw new CliError(
                recallResult.error.code,
                `Context failed: ${recallResult.error.message}`,
              );
            }

            // FP-03/04/06/10a: apply CLI-layer belief corrections
            const beliefs = processBeliefs(
              limen,
              recallResult.value,
              options.predicate,
              Date.now(),
            );

            // JSON format: return processed beliefs directly
            if (options.format === 'json') {
              return { mode: 'json' as const, data: beliefs };
            }

            // FP-08: Default text format emits RAW text (not JSON-wrapped) so
            // users can pipe directly into files:
            //   limen context --subject X --format text > prompt.txt
            if (beliefs.length === 0) {
              return {
                mode: 'text' as const,
                data: '# Knowledge Context\n\nNo relevant beliefs found.',
              };
            }

            const lines: string[] = ['# Knowledge Context', ''];
            for (const b of beliefs) {
              lines.push(`- **${b.subject}** | ${b.predicate}: ${b.value}`);
              lines.push(`  confidence: ${b.effectiveConfidence.toFixed(2)} | freshness: ${b.freshness} | asserted: ${b.validAt}`);
            }
            lines.push('');
            lines.push(`_${beliefs.length} belief(s) retrieved._`);

            return { mode: 'text' as const, data: lines.join('\n') };
          },
          {
            dataDir: globals.dataDir,
            masterKeyPath: globals.masterKey,
          },
        );

        // FP-08: Dispatch on the mode returned by the inner closure so that
        // text format emits raw stdout (pipeable) and json format emits
        // the processed belief array as JSON.
        if (result.mode === 'text') {
          writeRawText(result.data);
        } else {
          writeResult(result.data);
        }
      } catch (err: unknown) {
        writeError(err);
        process.exitCode = 1;
      }
    });

  return cmd;
}
