/**
 * limen proactive-rule-register — Register a proactive rule.
 *
 * FR-002: Validates against schema, stores as governed claim.
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createProactiveRuleRegisterCommand(): Command {
  const cmd = new Command('proactive-rule-register')
    .description('Register a proactive rule for inter-agent automation')
    .requiredOption('--rule <json>', 'JSON proactive rule object')
    .action(async (options: {
      rule: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // Parse JSON at CLI boundary
        let parsed: object;
        try {
          parsed = JSON.parse(options.rule) as object;
        } catch {
          writeError(new CliError('CLI_INVALID_RULE', `--rule is not valid JSON: ${options.rule}`));
          process.exitCode = 1;
          return;
        }

        await withEngine(globals, async (limen) => {
          const result = limen.a2aGovernance.registerProactiveRule(parsed);
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
