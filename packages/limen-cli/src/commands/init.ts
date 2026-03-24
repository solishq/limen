/**
 * limen init — Initialize the ~/.limen/ directory.
 *
 * Creates the Limen home directory, generates a master encryption key,
 * and writes a default configuration file. Idempotent: will not overwrite
 * an existing master key (to prevent accidental data loss).
 */

import { Command } from 'commander';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { getLimenHome } from '../config.js';
import { writeResult, writeError } from '../output.js';

export function createInitCommand(): Command {
  const cmd = new Command('init')
    .description('Initialize ~/.limen/ directory with master key and default config')
    .action(async () => {
      try {
        const home = getLimenHome();
        const dataDir = join(home, 'data');
        const masterKeyPath = join(home, 'master.key');
        const configPath = join(home, 'config.json');

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
