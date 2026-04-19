#!/usr/bin/env node

/**
 * Limen CLI — JSON-first command-line interface to the Limen Cognitive OS.
 *
 * Every command writes valid JSON to stdout. Errors go to stderr as JSON.
 * Engine lifecycle is per-invocation: bootstrap, execute, shutdown.
 *
 * Global options --dataDir and --masterKey override config file defaults.
 */

import { Command, CommanderError } from 'commander';
import { createInitCommand } from './commands/init.js';
import { createHealthCommand } from './commands/health.js';
import { createAgentCommand } from './commands/agent.js';
import { createClaimCommand } from './commands/claim.js';
import { createWmCommand } from './commands/wm.js';
import { createMissionCommand } from './commands/mission.js';
import { createRememberCommand } from './commands/remember.js';
import { createRecallCommand } from './commands/recall.js';
import { createForgetCommand } from './commands/forget.js';
import { createConnectCommand } from './commands/connect.js';
import { createReflectCommand } from './commands/reflect.js';
import { createSearchCommand } from './commands/search.js';
import { createRecallBulkCommand } from './commands/recall-bulk.js';
import { createContextCommand } from './commands/context.js';
import { createA2aSendCommand } from './commands/a2a-send.js';
import { createA2aReadCommand } from './commands/a2a-read.js';
import { createA2aChannelsCommand } from './commands/a2a-channels.js';
import { createA2aPresenceCommand } from './commands/a2a-presence.js';
import { createHealthCognitiveCommand } from './commands/health-cognitive.js';

/**
 * F-001 FIX: Apply JSON error output to a Commander command.
 *
 * Commander does NOT propagate configureOutput to subcommands. Each command
 * must be configured individually. This function applies JSON-formatted
 * stderr output and exitOverride to a command and all its nested subcommands
 * recursively, so that ALL Commander errors (missing required options,
 * unknown options, etc.) produce JSON to stderr instead of plain text.
 */
function applyJsonErrorHandling(cmd: Command): Command {
  cmd.configureOutput({
    writeErr: (str: string) => {
      const message = str.replace(/\n$/, '');
      process.stderr.write(
        JSON.stringify({ error: { code: 'CLI_USAGE', message } }, null, 2) + '\n',
      );
    },
    writeOut: (str: string) => {
      process.stdout.write(str);
    },
  });

  cmd.exitOverride((err: CommanderError) => {
    if (err.exitCode !== 0) {
      process.exitCode = err.exitCode;
      throw err;
    }
  });

  // Recurse into subcommands
  for (const sub of cmd.commands) {
    applyJsonErrorHandling(sub);
  }

  return cmd;
}

const program = new Command();

program
  .name('limen')
  .description('CLI for Limen Cognitive OS')
  .version('1.0.0')
  .option('--dataDir <path>', 'Override data directory')
  .option('--masterKey <path>', 'Override master key file path');

program.addCommand(createInitCommand());
program.addCommand(createHealthCommand());
program.addCommand(createAgentCommand());
program.addCommand(createClaimCommand());
program.addCommand(createWmCommand());
program.addCommand(createMissionCommand());
program.addCommand(createRememberCommand());
program.addCommand(createRecallCommand());
program.addCommand(createForgetCommand());
program.addCommand(createConnectCommand());
program.addCommand(createReflectCommand());
program.addCommand(createSearchCommand());
program.addCommand(createRecallBulkCommand());
program.addCommand(createContextCommand());
program.addCommand(createA2aSendCommand());
program.addCommand(createA2aReadCommand());
program.addCommand(createA2aChannelsCommand());
program.addCommand(createA2aPresenceCommand());
program.addCommand(createHealthCognitiveCommand());

// Apply JSON error handling AFTER all commands are registered,
// so the recursive walk covers every subcommand.
applyJsonErrorHandling(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  // Commander errors already have JSON written by configureOutput.writeErr
  if (err instanceof CommanderError) {
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    JSON.stringify({ error: { code: 'CLI_FATAL', message } }, null, 2) + '\n',
  );
  process.exitCode = 1;
});
