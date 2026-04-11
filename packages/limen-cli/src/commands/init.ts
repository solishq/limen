/**
 * limen init — Initialize a Limen home directory.
 *
 * Creates the Limen home directory, generates a master encryption key,
 * and writes a default configuration file. Idempotent: will not overwrite
 * an existing master key (to prevent accidental data loss).
 *
 * FP-01: When the global --dataDir flag is provided, init treats that
 * directory as the new home. The data, master key, and config file are
 * all written beneath <dataDir>, so per-project and CI setups can stay
 * isolated from ~/.limen/. When --dataDir is omitted, init defaults to
 * ~/.limen/ as before.
 *
 * Rejection path (FP-01): When --dataDir is provided, init MUST NOT
 * create or mutate ~/.limen/. Tested in knowledge.test.ts.
 */

import { Command } from 'commander';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { getLimenHome } from '../config.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createInitCommand(): Command {
  const cmd = new Command('init')
    .description('Initialize a Limen home directory with master key and default config')
    .action(async (_options: Record<string, unknown>, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // FP-01: If --dataDir is provided, treat it as the new home.
        // Otherwise, default to ~/.limen/ (legacy behavior).
        let home: string;
        let dataDir: string;
        let masterKeyPath: string;
        let configPath: string;

        if (globals.dataDir !== undefined) {
          const trimmed = globals.dataDir.trim();
          if (trimmed.length === 0) {
            writeError(new CliError(
              'CLI_INVALID_DATADIR',
              '--dataDir must not be empty or whitespace-only',
            ));
            process.exitCode = 1;
            return;
          }
          // FP-01: Treat --dataDir literally. The directory is both the
          // home and the data directory; master.key and config.json live
          // alongside the engine database files. This matches user
          // expectations: `limen --dataDir /tmp/foo init` puts everything
          // Limen needs inside /tmp/foo.
          home = trimmed;
          dataDir = trimmed;
          masterKeyPath = globals.masterKey ?? join(home, 'master.key');
          configPath = join(home, 'config.json');
        } else {
          home = getLimenHome();
          dataDir = join(home, 'data');
          masterKeyPath = globals.masterKey ?? join(home, 'master.key');
          configPath = join(home, 'config.json');
        }

        // Create directories
        mkdirSync(home, { recursive: true });
        mkdirSync(dataDir, { recursive: true });

        const created: string[] = [];
        const skipped: string[] = [];

        // Generate master key — never overwrite existing
        if (existsSync(masterKeyPath)) {
          skipped.push('master.key (already exists)');
        } else {
          const key = randomBytes(32);
          writeFileSync(masterKeyPath, key, { mode: 0o600 });
          created.push('master.key');
        }

        // Write default config — never overwrite existing
        if (existsSync(configPath)) {
          skipped.push('config.json (already exists)');
        } else {
          const defaultConfig = {
            dataDir,
            masterKeyPath,
          };
          writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n', {
            mode: 0o644,
          });
          created.push('config.json');
        }

        writeResult({
          initialized: true,
          home,
          dataDir,
          masterKeyPath,
          created,
          skipped,
        });
      } catch (err: unknown) {
        writeError(err);
        process.exitCode = 1;
      }
    });

  return cmd;
}
