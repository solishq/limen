/**
 * Limen engine bootstrap for the A2A server.
 *
 * Reads ~/.limen/config.json (if it exists) and creates a Limen engine
 * instance with the configured settings. Falls back to sensible defaults
 * when no config file is present.
 *
 * Config file format (~/.limen/config.json):
 * {
 *   "dataDir": "/path/to/data",
 *   "providers": [{ "type": "anthropic", "baseUrl": "...", "models": [...] }],
 *   "masterKey": "<hex-encoded 32-byte key>"
 * }
 *
 * If masterKey is not provided, a random 32-byte key is generated.
 * This means data encrypted in one session cannot be decrypted in another
 * unless the key is persisted — acceptable for development/demo use.
 *
 * Design: Bootstrap is separated from server.ts so that:
 *   1. The engine creation logic is testable independently.
 *   2. The config reading logic does not pollute the HTTP server.
 *   3. Future config sources (env vars, CLI flags) can be added here.
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createLimen } from 'limen-ai';
import type { Limen, LimenConfig, ProviderConfig } from 'limen-ai';

/** Raw shape of ~/.limen/config.json */
interface RawConfig {
  readonly dataDir?: string;
  readonly providers?: readonly ProviderConfig[];
  readonly masterKey?: string;
}

/** Default data directory: ~/.limen/data */
const DEFAULT_DATA_DIR = join(homedir(), '.limen', 'data');

/** Config file path: ~/.limen/config.json */
const CONFIG_PATH = join(homedir(), '.limen', 'config.json');

/**
 * Read and parse the config file. Returns undefined if the file
 * does not exist or is malformed (with a warning to stderr).
 */
function readConfig(): RawConfig | undefined {
  if (!existsSync(CONFIG_PATH)) {
    return undefined;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      process.stderr.write(`[limen-a2a] Warning: ${CONFIG_PATH} is not a JSON object, using defaults\n`);
      return undefined;
    }

    return parsed as RawConfig;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    process.stderr.write(`[limen-a2a] Warning: Failed to read ${CONFIG_PATH}: ${message}, using defaults\n`);
    return undefined;
  }
}

/**
 * Decode a hex-encoded master key string to a Buffer.
 * Returns null if the string is invalid or the wrong length.
 */
function decodeMasterKey(hex: string): Buffer | null {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    return null;
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Bootstrap a Limen engine instance.
 *
 * Reads config from ~/.limen/config.json, applies defaults for missing
 * values, ensures the data directory exists, and creates the engine.
 *
 * Returns the initialized Limen instance, ready for API calls.
 */
export async function bootstrapEngine(): Promise<Limen> {
  const rawConfig = readConfig();

  // Resolve data directory
  const dataDir = rawConfig?.dataDir ?? DEFAULT_DATA_DIR;

  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // Resolve master key
  let masterKey: Buffer;
  if (rawConfig?.masterKey) {
    const decoded = decodeMasterKey(rawConfig.masterKey);
    if (decoded === null) {
      process.stderr.write(
        '[limen-a2a] Warning: masterKey in config is not a valid 64-char hex string, generating random key\n',
      );
      masterKey = randomBytes(32);
    } else {
      masterKey = decoded;
    }
  } else {
    masterKey = randomBytes(32);
  }

  // Build LimenConfig
  const config: LimenConfig = {
    dataDir,
    masterKey,
    providers: rawConfig?.providers,
  };

  // Create and return engine
  const limen = await createLimen(config);
  return limen;
}
