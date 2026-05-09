// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
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
 *
 * F-BR5-006: master.key creation is atomic. The prior implementation
 * used existsSync() + writeFileSync() which left a TOCTOU window
 * between the check and the write — two parallel init processes
 * could both observe "no file", both write, and the second write
 * would overwrite the first with a different key (silent data loss
 * for any claims written between the two writes). The fix:
 *
 *   1. Try writeFileSync with flag 'wx' — atomic "create-or-fail".
 *      On EEXIST, the file already exists and we did not clobber it.
 *   2. On EEXIST, read the existing key and validate its size. If it
 *      is a 32-byte buffer, treat init as idempotent (no-op on key,
 *      report as skipped). Any other size means the file is either
 *      corrupted or not a Limen master key — fail hard with
 *      CLI_MASTER_KEY_CORRUPTED rather than silently "succeeding"
 *      against a broken credential.
 *
 * This preserves the existing test invariant (init is safe to run
 * once per unique temp dir) while closing the concurrent-init race.
 */

import { Command } from 'commander';
import { writeFileSync, mkdirSync, existsSync, statSync, readFileSync } from 'node:fs';
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

        // F-BR4-008: If --dataDir points at an existing non-directory path,
        // Node surfaces a raw EEXIST from mkdir. That leaks the errno
        // taxonomy through the CLI envelope instead of our CLI_* codes.
        // Detect the condition explicitly and surface CLI_DATADIR_NOT_DIRECTORY.
        if (existsSync(home)) {
          const homeStat = statSync(home);
          if (!homeStat.isDirectory()) {
            writeError(new CliError(
              'CLI_DATADIR_NOT_DIRECTORY',
              `--dataDir "${home}" is not a directory`,
            ));
            process.exitCode = 1;
            return;
          }
        }

        // Create directories
        mkdirSync(home, { recursive: true });
        mkdirSync(dataDir, { recursive: true });

        const created: string[] = [];
        const skipped: string[] = [];

        // F-BR5-006: atomic master-key creation. Use flag 'wx' so
        // the write fails (EEXIST) if the file exists — no TOCTOU
        // window between check and write.
        try {
          const key = randomBytes(32);
          writeFileSync(masterKeyPath, key, { mode: 0o600, flag: 'wx' });
          created.push('master.key');
        } catch (err: unknown) {
          const e = err as { code?: string };
          if (e.code !== 'EEXIST') throw err;
          // EEXIST: the file already exists. Validate it is a
          // well-formed 32-byte master key before treating this as
          // idempotent. A corrupted/zero-length file means an earlier
          // init was interrupted mid-write, or a non-Limen file is
          // sitting at the path; both cases are hard errors.
          const existing = readFileSync(masterKeyPath);
          if (existing.length !== 32) {
            throw new CliError(
              'CLI_MASTER_KEY_CORRUPTED',
              `Master key at ${masterKeyPath} is not a valid 32-byte key ` +
              `(found ${existing.length} bytes). Refusing to overwrite. ` +
              `Inspect the file manually and remove it if you intend to re-initialize.`,
            );
          }
          skipped.push('master.key (already exists)');
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
