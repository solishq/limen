/**
 * limen mission — Mission management commands.
 *
 * Subcommands: create, list.
 * Missions are the top-level orchestration unit in Limen — an agent
 * pursuing an objective within budget and deadline constraints.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError } from '../output.js';
import type { MissionState } from 'limen-ai';

export function createMissionCommand(): Command {
  const mission = new Command('mission')
    .description('Manage Limen missions');

  // limen mission create --agent <a> --objective <o> --budget <n> --deadline <d>
  mission
    .command('create')
    .description('Create a new mission')
    .requiredOption('--agent <name>', 'Agent name to assign the mission')
    .requiredOption('--objective <text>', 'Mission objective')
    .requiredOption('--budget <n>', 'Token budget', parseInt)
    .requiredOption('--deadline <iso>', 'Deadline (ISO 8601)')
    .option('--maxTasks <n>', 'Maximum number of tasks', parseInt)
    .option('--maxDepth <n>', 'Maximum task tree depth', parseInt)
    .action(async (options: {
      agent: string;
      objective: string;
      budget: number;
      deadline: string;
      maxTasks?: number;
      maxDepth?: number;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          async (limen) => {
            const handle = await limen.missions.create({
              agent: options.agent,
              objective: options.objective,
              constraints: {
                tokenBudget: options.budget,
                deadline: options.deadline,
                maxTasks: options.maxTasks,
                maxDepth: options.maxDepth,
              },
            });

            return {
              id: handle.id,
              state: handle.state,
              budget: handle.budget,
            };
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

  // limen mission list
  mission
    .command('list')
    .description('List missions')
    .option('--state <state>', 'Filter by mission state')
    .option('--limit <n>', 'Maximum results', parseInt)
    .action(async (options: {
      state?: string;
      limit?: number;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          async (limen) => limen.missions.list({
            state: options.state as MissionState | undefined,
            limit: options.limit,
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

  return mission;
}
