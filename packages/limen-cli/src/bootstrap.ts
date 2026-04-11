/**
 * Limen CLI Bootstrap — Engine lifecycle management.
 *
 * Creates a Limen engine instance from config, executes a command,
 * then shuts down. Each CLI invocation is a fresh engine lifecycle.
 *
 * F-BR4-001 (Loopback): CLI-layer credential path resolution.
 *
 * ── SCOPE OF THE INVARIANT ───────────────────────────────────────────
 *
 * The CLI binds each dataDir to exactly one master key file under
 * `<dataDir>/master.key`. Given `--dataDir <X>`, `resolveMasterKeyPath`
 * returns EXACTLY that path (or an explicit `--masterKey` override).
 * There is no fallback to `<dataDir>/../master.key` or to
 * `~/.limen/master.key`.
 *
 * This is **filesystem-scoped path isolation**, not cryptographic
 * isolation of claim content:
 *   - Two dataDirs resolve to independent master-key files and
 *     independent sqlite files. The CLI resolver never reaches
 *     across dataDirs.
 *   - This prevents the prior silent cross-tenant leak where
 *     `--dataDir /tmp/ci-run` would fall through to `~/.limen`
 *     credentials.
 *
 * ── WHAT THIS DOES NOT GUARANTEE (F-BR5-001 residual) ────────────────
 *
 * The master-key file is the CLI's credential boundary, NOT a proof
 * that claim content is cryptographically gated on its bytes. An
 * attacker (or operator, or buggy workflow) with filesystem access to
 * a dataDir who can read or copy `master.key` across dataDirs may be
 * able to access claim content regardless of this resolver's behavior.
 * That is a filesystem access-control concern, not something the CLI
 * path resolver can defend against. Anyone backing up dataDirs must
 * treat `master.key` and the sqlite files as a single unit: they are
 * co-located, and the isolation is co-location, not encryption-at-rest.
 *
 * If you need cryptographic isolation of claim content (e.g. the
 * master key MUST authenticate the data before decryption succeeds),
 * that is an engine concern tracked as F-BR5-001 in the CLI Friction
 * Remediation residual-risk register — NOT delivered by this resolver.
 *
 * ── WHY THE FALLBACK LADDER WAS DELETED ──────────────────────────────
 *
 * The prior implementation had a fallback ladder that terminated at
 * the user-home master key, silently bridging credential paths across
 * unrelated dataDirs. A CI pipeline using `--dataDir /tmp/ci-run`
 * could end up reading `~/.limen` credentials because the ladder
 * fell through when `/tmp/ci-run/master.key` was absent. That
 * defeats the entire purpose of `--dataDir` and was classified as a
 * trust-boundary violation (Breaker finding F-BR4-001, Critical).
 * The fallback branches are deleted, not guarded — re-derivation,
 * not patching (Hard Ban #21).
 *
 * First-use behavior: if `--dataDir` is provided and the per-dataDir
 * master key does not exist, bootstrap throws
 * `CLI_UNINITIALIZED_DATADIR`. This fails fast and points the user at
 * `limen --dataDir <path> init`. Auto-generation was rejected: a
 * typo in `--dataDir` would otherwise silently spin up a new tenant
 * with a fresh key, losing access to the intended tenant without
 * any error.
 *
 * Default (no `--dataDir`): `~/.limen/` via `config.masterKeyPath`
 * (legacy behavior — this is the user's single home-scoped
 * installation).
 */

import { createLimen } from 'limen-ai';
import type { Limen, LimenConfig } from 'limen-ai';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { CliError } from './output.js';

/**
 * Resolve the master key path given runtime overrides.
 *
 * F-BR4-001 invariant: one dataDir, one master key. No fallback chain.
 *
 * Resolution rules:
 *   1. If --masterKey is explicit, use it verbatim (operator override).
 *   2. If --dataDir is provided, the master key is ALWAYS at
 *      <dataDir>/master.key. No fallback. Missing file = explicit error.
 *   3. Otherwise, fall back to the global config (~/.limen/master.key).
 */
function resolveMasterKeyPath(
  overrides: { dataDir?: string; masterKeyPath?: string } | undefined,
  configMasterKeyPath: string,
): string {
  if (overrides?.masterKeyPath !== undefined) return overrides.masterKeyPath;
  if (overrides?.dataDir !== undefined) {
    // F-BR4-001: filesystem-scoped path isolation. NO fallback to
    // parent dir, NO fallback to ~/.limen. The per-dataDir master key
    // path is the ONLY credential path this resolver will produce for
    // this dataDir. See file-level docstring for the precise meaning
    // and limits of this guarantee (F-BR5-001 residual).
    return join(overrides.dataDir, 'master.key');
  }
  return configMasterKeyPath;
}

export async function bootstrapEngine(overrides?: {
  dataDir?: string;
  masterKeyPath?: string;
}): Promise<Limen> {
  const config = loadConfig();
  const dataDir = overrides?.dataDir ?? config.dataDir;
  const masterKeyPath = resolveMasterKeyPath(overrides, config.masterKeyPath);

  // F-BR4-001: fail fast with a CLI-taxonomy error if the per-dataDir
  // master key is missing. This replaces the old silent fallback.
  if (!existsSync(masterKeyPath)) {
    if (overrides?.dataDir !== undefined && overrides?.masterKeyPath === undefined) {
      throw new CliError(
        'CLI_UNINITIALIZED_DATADIR',
        `No master key found at ${masterKeyPath}. Run: limen --dataDir "${overrides.dataDir}" init`,
      );
    }
    // Explicit --masterKey or default-home case: surface a recognisable
    // CLI error instead of a raw ENOENT from readFileSync.
    throw new CliError(
      'CLI_MASTER_KEY_NOT_FOUND',
      `Master key file not found at ${masterKeyPath}`,
    );
  }

  const masterKey = readFileSync(masterKeyPath);

  const limenConfig: LimenConfig = {
    dataDir,
    masterKey,
    providers: [],
  };

  return createLimen(limenConfig);
}

export async function withEngine<T>(
  fn: (limen: Limen) => Promise<T> | T,
  overrides?: { dataDir?: string; masterKeyPath?: string },
): Promise<T> {
  const limen = await bootstrapEngine(overrides);
  try {
    return await fn(limen);
  } finally {
    await limen.shutdown();
  }
}
