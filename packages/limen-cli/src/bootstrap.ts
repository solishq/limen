/**
 * Limen CLI Bootstrap — Engine lifecycle management.
 *
 * Creates a Limen engine instance from config, executes a command,
 * then shuts down. Each CLI invocation is a fresh engine lifecycle.
 */

import { createLimen } from 'limen-ai';
import type { Limen, LimenConfig } from 'limen-ai';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from './config.js';

/**
 * Resolve the master key path given runtime overrides.
 *
 * FP-01: When --dataDir is provided without --masterKey, prefer
 * <dataDir>/master.key if it exists (new `init --dataDir X` layout), then
 * fall back to <dataDir>/../master.key (legacy: dataDir is the "data" sub-
 * directory under a Limen home), and finally fall back to the global
 * config masterKeyPath (~/.limen/master.key). This preserves backward
 * compatibility for existing tests that use temp --dataDir without
 * running `init --dataDir` first.
 */
function resolveMasterKeyPath(
  overrides: { dataDir?: string; masterKeyPath?: string } | undefined,
  configMasterKeyPath: string,
): string {
  if (overrides?.masterKeyPath !== undefined) return overrides.masterKeyPath;
  if (overrides?.dataDir !== undefined) {
    // FP-01 layout: `init --dataDir X` places master.key inside X itself.
    const insideKey = join(overrides.dataDir, 'master.key');
    if (existsSync(insideKey)) return insideKey;
    // Legacy layout: dataDir may be a "data" subdir under a home directory.
    const parentKey = join(dirname(overrides.dataDir), 'master.key');
    if (existsSync(parentKey)) return parentKey;
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
