/**
 * limen agent — Agent management commands.
 *
 * Subcommands: register, list, get, promote.
 * All output JSON to stdout. All errors to stderr.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError } from '../output.js';

export function createAgentCommand(): Command {
  const agent = new Command('agent')
    .description('Manage Limen agents');

  // limen agent register --name <n> [--domains <d>]
  agent
    .command('register')
    .description('Register a new agent')
    .requiredOption('--name <name>', 'Agent name')
    .option('--domains <domains>', 'Comma-separated domain list')
    .option('--capabilities <capabilities>', 'Comma-separated capability list')
    .option('--systemPrompt <prompt>', 'Agent system prompt')
    .action(async (options: {
      name: string;
      domains?: string;
      capabilities?: string;
      systemPrompt?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          async (limen) => limen.agents.register({
            name: options.name,
            domains: options.domains?.split(',').map((d) => d.trim()),
            capabilities: options.capabilities?.split(',').map((c) => c.trim()),
            systemPrompt: options.systemPrompt,
          }),
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

  // limen agent list
  agent
    .command('list')
    .description('List all agents')
    .action(async (_options: Record<string, unknown>, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          async (limen) => limen.agents.list(),
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

  // limen agent get --name <n>
  agent
    .command('get')
    .description('Get agent by name')
    .requiredOption('--name <name>', 'Agent name')
    .action(async (options: { name: string }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          async (limen) => limen.agents.get(options.name),
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

  // limen agent promote --name <n>
  agent
    .command('promote')
    .description('Promote agent trust level')
    .requiredOption('--name <name>', 'Agent name')
    .action(async (options: { name: string }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          async (limen) => limen.agents.promote(options.name),
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

  return agent;
}
