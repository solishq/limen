/**
 * limen wm — Working Memory management commands.
 *
 * Subcommands: write, read, discard.
 * Working memory is task-local scratch space — entries are discarded
 * when the owning task reaches a terminal state.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError } from '../output.js';
import type { Limen, TaskId, WorkingMemoryApi } from 'limen-ai';

export function createWmCommand(): Command {
  const wm = new Command('wm')
    .description('Manage Limen working memory');

  // limen wm write --taskId <t> --key <k> --value <v>
  wm
    .command('write')
    .description('Write an entry to working memory')
    .requiredOption('--taskId <id>', 'Task ID (scope for the entry)')
    .requiredOption('--key <key>', 'Entry key')
    .requiredOption('--value <value>', 'Entry value')
    .action(async (options: {
      taskId: string;
      key: string;
      value: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          (limen: Limen) => {
            const api: WorkingMemoryApi = limen.workingMemory;
            const wmResult = api.write({
              taskId: options.taskId as TaskId,
              key: options.key,
              value: options.value,
            });

            if (!wmResult.ok) {
              throw new Error(`Working memory write failed: ${wmResult.error.message}`);
            }
            return wmResult.value;
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

  // limen wm read --taskId <t>
  wm
    .command('read')
    .description('Read working memory entries for a task')
    .requiredOption('--taskId <id>', 'Task ID')
    .option('--key <key>', 'Specific entry key (omit to list all)')
    .action(async (options: {
      taskId: string;
      key?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          (limen: Limen) => {
            const api: WorkingMemoryApi = limen.workingMemory;
            const readResult = api.read({
              taskId: options.taskId as TaskId,
              key: options.key ?? null,
            });

            if (!readResult.ok) {
              throw new Error(`Working memory read failed: ${readResult.error.message}`);
            }
            return readResult.value;
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

  // limen wm discard --taskId <t>
  wm
    .command('discard')
    .description('Discard working memory entries for a task')
    .requiredOption('--taskId <id>', 'Task ID')
    .option('--key <key>', 'Specific entry key (omit to discard all)')
    .action(async (options: {
      taskId: string;
      key?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          (limen: Limen) => {
            const api: WorkingMemoryApi = limen.workingMemory;
            const discardResult = api.discard({
              taskId: options.taskId as TaskId,
              key: options.key ?? null,
            });

            if (!discardResult.ok) {
              throw new Error(`Working memory discard failed: ${discardResult.error.message}`);
            }
            return discardResult.value;
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

  return wm;
}
