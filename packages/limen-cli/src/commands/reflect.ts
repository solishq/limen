/**
 * limen reflect — Batch-store categorized learnings.
 *
 * Wraps the Limen convenience API reflect() method.
 * Each entry becomes a claim with predicate "reflection.<category>".
 * All-or-nothing transaction semantics.
 *
 * Accepts entries as inline JSON (--entries) or from a file (--file).
 *
 * JSON stdout, JSON stderr — no exceptions.
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError } from '../output.js';
import type { Limen } from 'limen-ai';

export function createReflectCommand(): Command {
  const cmd = new Command('reflect')
    .description('Batch-store categorized learnings (all-or-nothing)')
    .option('--entries <json>', 'JSON array of entries: [{category, statement, confidence?}]')
    .option('--file <path>', 'Path to JSON file containing entries array')
    .action(async (options: {
      entries?: string;
      file?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // Must provide exactly one of --entries or --file
        if (!options.entries && !options.file) {
          writeError(new Error('Provide either --entries <json> or --file <path>'));
          process.exitCode = 1;
          return;
        }
        if (options.entries && options.file) {
          writeError(new Error('Provide either --entries or --file, not both'));
          process.exitCode = 1;
          return;
        }

        // Parse entries
        let entriesJson: string;
        if (options.file) {
          try {
            entriesJson = readFileSync(options.file, 'utf-8');
          } catch (readErr: unknown) {
            const msg = readErr instanceof Error ? readErr.message : String(readErr);
            writeError(new Error(`Failed to read file '${options.file}': ${msg}`));
            process.exitCode = 1;
            return;
          }
        } else {
          entriesJson = options.entries!;
        }

        let entries: Array<{ category: string; statement: string; confidence?: number }>;
        try {
          entries = JSON.parse(entriesJson) as typeof entries;
          if (!Array.isArray(entries)) {
            writeError(new Error('Entries must be a JSON array'));
            process.exitCode = 1;
            return;
          }
        } catch {
          writeError(new Error('Invalid JSON in entries'));
          process.exitCode = 1;
          return;
        }

        const result = await withEngine(
          (limen: Limen) => {
            const reflectResult = limen.reflect(
              entries as Parameters<Limen['reflect']>[0],
            );

            if (!reflectResult.ok) {
              throw new Error(`Reflect failed: ${reflectResult.error.message}`);
            }
            return reflectResult.value;
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
