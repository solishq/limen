/**
 * limen prepare-for-task -- Task-aware context preparation.
 *
 * Wraps limen.cognitive.prepareForTask(options) to generate
 * reasoning-ready context tailored to an agent's role and task.
 *
 * Parity with: limen_prepare_for_task MCP tool (packages/limen-mcp/src/tools/cognitive.ts)
 *
 * JSON stdout, JSON stderr -- no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeRawText, writeError, CliError } from '../output.js';

export function createPrepareForTaskCommand(): Command {
  const cmd = new Command('prepare-for-task')
    .description('Prepare task-aware context for an agent based on role and task description')
    .requiredOption('--role <role>', 'Agent role (e.g., "Builder", "Breaker", "Researcher")')
    .requiredOption('--project <project>', 'Subject pattern for project scope (e.g., "entity:project:veridion")')
    .requiredOption('--description <description>', 'Natural language task description')
    .option('--task-id <taskId>', 'Optional task identifier')
    .option('--max-tokens <n>', 'Token budget for total output (default: 2000)', parseInt)
    .option('--include-findings', 'Include finding.* predicates (default: true)')
    .option('--no-include-findings', 'Exclude finding.* predicates')
    .option('--include-locks', 'Include lock.* predicates (default: false)')
    .option('--include-budget', 'Include budget.* predicates (default: false)')
    .option('--format <format>', 'Output format: "text" (default) or "json"')
    .action(async (options: {
      role: string;
      project: string;
      description: string;
      taskId?: string;
      maxTokens?: number;
      includeFindings?: boolean;
      includeLocks?: boolean;
      includeBudget?: boolean;
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

        // Validate --max-tokens
        if (options.maxTokens !== undefined && (isNaN(options.maxTokens) || options.maxTokens <= 0)) {
          writeError(new CliError(
            'CLI_INVALID_MAX_TOKENS',
            '--max-tokens must be a positive integer',
          ));
          process.exitCode = 1;
          return;
        }

        const result = await withEngine(
          (limen) => {
            const prepResult = limen.cognitive.prepareForTask({
              agentRole: options.role,
              project: options.project,
              taskId: options.taskId,
              taskDescription: options.description,
              maxTokens: options.maxTokens,
              includeFindings: options.includeFindings,
              includeLocks: options.includeLocks ?? false,
              includeBudget: options.includeBudget ?? false,
            });

            if (!prepResult.ok) {
              throw new CliError(
                prepResult.error.code,
                `Task preparation failed: ${prepResult.error.message}`,
              );
            }

            return prepResult.value;
          },
          {
            dataDir: globals.dataDir,
            masterKeyPath: globals.masterKey,
          },
        );

        if (options.format === 'json') {
          writeResult(result);
        } else {
          // Default: text format — output the reasoning-ready text
          writeRawText(result.text);
        }
      } catch (err: unknown) {
        writeError(err);
        process.exitCode = 1;
      }
    });

  return cmd;
}
