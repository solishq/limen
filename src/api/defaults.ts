/**
 * Zero-config defaults for createLimen().
 * S ref: S3.3 (engine not framework — smart defaults, not magic)
 *
 * When createLimen() is called with no arguments, this module:
 *   1. Auto-detects LLM providers from environment variables
 *   2. Resolves a master key (env var, file, or auto-generated dev key)
 *   3. Resolves a data directory (env var or OS temp dir)
 *
 * Design principle: Same API from hello world to production.
 * Zero-config uses sensible dev defaults. Production uses explicit config.
 * The governance layer (audit, RBAC, encryption, budget) runs either way.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { LimenConfig } from './interfaces/api.js';
import type { ProviderConfig } from './interfaces/api.js';
import { LimenError } from './errors/limen_error.js';

// ─── Provider Auto-Detection ───

/**
 * Registry of known LLM providers and their environment variable conventions.
 * Order matters: first detected provider becomes the default.
 */
const PROVIDER_REGISTRY = [
  {
    type: 'anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-20250514',
  },
  {
    type: 'openai',
    envVar: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com',
    defaultModel: 'gpt-4o',
  },
  {
    type: 'gemini',
    envVar: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.0-flash',
  },
  {
    type: 'groq',
    envVar: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  {
    type: 'mistral',
    envVar: 'MISTRAL_API_KEY',
    baseUrl: 'https://api.mistral.ai',
    defaultModel: 'mistral-large-latest',
  },
] as const;

/**
 * Detect LLM providers from environment variables.
 * Scans PROVIDER_REGISTRY in order — every provider with a set env var is included.
 * Ollama is probed separately (no env var, localhost only).
 */
export function detectProviders(): ProviderConfig[] {
  const found: ProviderConfig[] = [];

  for (const entry of PROVIDER_REGISTRY) {
    if (process.env[entry.envVar]) {
      found.push({
        type: entry.type,
        baseUrl: entry.baseUrl,
        models: [entry.defaultModel],
        apiKeyEnvVar: entry.envVar,
      });
    }
  }

  // Ollama: check if OLLAMA_HOST is set or default localhost is reachable.
  // We add it optimistically if OLLAMA_HOST is set — the adapter validates localhost at creation.
  if (process.env['OLLAMA_HOST']) {
    found.push({
      type: 'ollama',
      baseUrl: process.env['OLLAMA_HOST'],
      models: ['llama3.2'],
    });
  }

  return found;
}

// ─── Master Key Resolution ───

/** Directory for auto-generated dev keys */
const LIMEN_HOME = join(homedir(), '.limen');

/** File name for the auto-generated dev key */
const DEV_KEY_FILE = 'dev.key';

/**
 * Resolve the master encryption key for AES-256-GCM.
 *
 * Resolution order:
 *   1. LIMEN_MASTER_KEY env var (64-char hex string → 32-byte Buffer)
 *   2. LIMEN_MASTER_KEY_FILE env var (path to file containing raw 32+ bytes)
 *   3. Auto-generate and persist to ~/.limen/dev.key (dev convenience only)
 *
 * Option 3 prints a warning to stderr — this is intentional friction to prevent
 * accidental production use of an auto-generated key.
 */
export function resolveMasterKey(): Buffer {
  // 1. Hex string from env var
  const hexKey = process.env['LIMEN_MASTER_KEY'];
  if (hexKey) {
    const buf = Buffer.from(hexKey, 'hex');
    if (buf.length < 32) {
      throw new LimenError(
        'INVALID_CONFIG',
        'LIMEN_MASTER_KEY must be at least 64 hex characters (32 bytes). Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }
    return buf;
  }

  // 2. File path from env var
  const keyFile = process.env['LIMEN_MASTER_KEY_FILE'];
  if (keyFile) {
    try {
      const buf = readFileSync(keyFile);
      if (buf.length < 32) {
        throw new LimenError(
          'INVALID_CONFIG',
          `LIMEN_MASTER_KEY_FILE at '${keyFile}' contains ${buf.length} bytes — need at least 32.`,
        );
      }
      return buf;
    } catch (err) {
      if (err instanceof LimenError) throw err;
      throw new LimenError(
        'INVALID_CONFIG',
        `Cannot read LIMEN_MASTER_KEY_FILE at '${keyFile}'. Ensure the file exists and is readable.`,
      );
    }
  }

  // 3. Auto-generate dev key (with warning)
  const devKeyPath = join(LIMEN_HOME, DEV_KEY_FILE);

  if (existsSync(devKeyPath)) {
    const buf = readFileSync(devKeyPath);
    if (buf.length >= 32) {
      return buf;
    }
    // Corrupted — regenerate
  }

  // Generate fresh key
  const key = randomBytes(32);
  mkdirSync(LIMEN_HOME, { recursive: true });
  writeFileSync(devKeyPath, key, { mode: 0o600 });

  // Intentional friction — stderr warning for dev-only key
  process.stderr.write(
    `[limen] Auto-generated dev key at ${devKeyPath} — NOT for production.\n` +
    `[limen] For production, set LIMEN_MASTER_KEY or LIMEN_MASTER_KEY_FILE.\n`,
  );

  return key;
}

// ─── Data Directory Resolution ───

/**
 * Resolve the data directory for SQLite storage.
 *
 * Resolution order:
 *   1. LIMEN_DATA_DIR env var
 *   2. OS temp dir + 'limen-dev' (cleaned on reboot — appropriate for dev)
 */
export function resolveDataDir(): string {
  return process.env['LIMEN_DATA_DIR'] ?? join(tmpdir(), 'limen-dev');
}

// ─── Compose Defaults ───

/**
 * Build a complete LimenConfig from environment auto-detection.
 * Called when createLimen() receives no arguments.
 *
 * Zero-config is supported: when no LLM providers are detected, the engine
 * starts in degraded mode. Core CRUD (remember, recall, search, forget) works
 * without LLM. Only cognitive features (chat, infer, verify, narrative) require
 * a provider. This matches the README promise: "createLimen() with no arguments."
 */
export function resolveDefaults(): LimenConfig {
  const providers = detectProviders();

  return {
    dataDir: resolveDataDir(),
    masterKey: resolveMasterKey(),
    providers,
  };
}
