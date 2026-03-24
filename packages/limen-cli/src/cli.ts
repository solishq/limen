#!/usr/bin/env node

/**
 * Limen CLI — JSON-first command-line interface to the Limen Cognitive OS.
 *
 * Every command writes valid JSON to stdout. Errors go to stderr as JSON.
 * Engine lifecycle is per-invocation: bootstrap, execute, shutdown.
 *
 * Global options --dataDir and --masterKey override config file defaults.
 */

import { Command } from 'commander';
import { createInitCommand } from './commands/init.js';
import { createHealthCommand } from './commands/health.js';
import { createAgentCommand } from './commands/agent.js';
import { createClaimCommand } from './commands/claim.js';
import { createWmCommand } from './commands/wm.js';
import { createMissionCommand } from './commands/mission.js';

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

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    JSON.stringify({ error: { code: 'CLI_FATAL', message } }, null, 2) + '\n',
  );
  process.exitCode = 1;
});
