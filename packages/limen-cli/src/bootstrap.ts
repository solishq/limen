/**
 * Limen CLI Bootstrap — Engine lifecycle management.
 *
 * Creates a Limen engine instance from config, executes a command,
 * then shuts down. Each CLI invocation is a fresh engine lifecycle.
 */

import { createLimen } from 'limen-ai';
import type { Limen, LimenConfig } from 'limen-ai';
import { readFileSync } from 'node:fs';
import { loadConfig } from './config.js';

export async function bootstrapEngine(overrides?: {
  dataDir?: string;
  masterKeyPath?: string;
}): Promise<Limen> {
  const config = loadConfig();
  const dataDir = overrides?.dataDir ?? config.dataDir;
  const masterKeyPath = overrides?.masterKeyPath ?? config.masterKeyPath;

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
