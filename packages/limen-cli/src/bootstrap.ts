/**
 * Limen CLI Bootstrap — Engine lifecycle management.
 *
 * Creates a Limen engine instance from config, executes a command,
 * then shuts down. Each CLI invocation is a fresh engine lifecycle.
 *
 * F-BR4-001 (Loopback): credential-scope isolation.
 *
 * INVARIANT: A master key is bound to exactly one dataDir. Given a
 * --dataDir override, resolveMasterKeyPath returns EXACTLY the path
 * <dataDir>/master.key (or an explicit --masterKey override). There
 * is no fallback to <dataDir>/../master.key or to ~/.limen/master.key.
 * Isolation between dataDirs is structural, not advisory.
 *
 * Rationale: the prior implementation had a fallback ladder that
 * terminated at the user-home master key, silently bridging
 * credential scope across unrelated dataDirs. A CI pipeline using
 * --dataDir /tmp/ci-run could decrypt rows belonging to ~/.limen or
 * vice versa. This defeats the entire purpose of --dataDir and was
 * classified as a trust-boundary violation (Breaker finding
 * F-BR4-001, Critical). The fallback branches are deleted, not
 * guarded — re-derivation, not patching (Hard Ban #21).
 *
 * First-use behavior: if --dataDir is provided and the per-dataDir
 * master key does not exist, bootstrap throws
 * CLI_UNINITIALIZED_DATADIR. This fails fast and points the user at
 * `limen --dataDir <path> init`. Auto-generation was rejected: a
 * typo in --dataDir would otherwise silently spin up a new tenant
 * with a fresh key, losing access to the intended tenant without
 * any error.
 *
 * Default (no --dataDir): ~/.limen/ via config.masterKeyPath (legacy
 * behavior — this is the user's single home-scoped installation).
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
    // F-BR4-001: structural isolation. NO fallback to parent dir, NO
    // fallback to ~/.limen. The per-dataDir master key is the ONLY
    // credential bound to this dataDir.
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
