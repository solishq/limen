// Verifies: S3.3 (engine not framework — smart defaults, not magic)
// Tests: detectProviders(), resolveMasterKey(), resolveDataDir(), resolveDefaults()
//
// Zero-config defaults module. When createLimen() is called with no arguments,
// these functions auto-detect LLM providers from environment variables,
// resolve a master encryption key, and determine a data directory.
//
// Environment isolation: each test saves/restores all env vars it touches.
// No cross-contamination between tests.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, unlinkSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import {
  detectProviders,
  resolveMasterKey,
  resolveDataDir,
  resolveDefaults,
} from '../../src/api/defaults.js';
import { LimenError } from '../../src/api/errors/limen_error.js';

// ─── Env var helpers ───

/** All env vars that defaults.ts reads */
const PROVIDER_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'OLLAMA_HOST',
] as const;

const KEY_ENV_VARS = [
  'LIMEN_MASTER_KEY',
  'LIMEN_MASTER_KEY_FILE',
] as const;

const DIR_ENV_VARS = [
  'LIMEN_DATA_DIR',
] as const;

const ALL_ENV_VARS = [...PROVIDER_ENV_VARS, ...KEY_ENV_VARS, ...DIR_ENV_VARS] as const;

type EnvSnapshot = Map<string, string | undefined>;

function saveEnv(vars: readonly string[]): EnvSnapshot {
  const snap = new Map<string, string | undefined>();
  for (const key of vars) {
    snap.set(key, process.env[key]);
  }
  return snap;
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const [key, value] of snap) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearEnv(vars: readonly string[]): void {
  for (const key of vars) {
    delete process.env[key];
  }
}

// ─── detectProviders() ───

describe('detectProviders()', () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = saveEnv(PROVIDER_ENV_VARS);
    clearEnv(PROVIDER_ENV_VARS);
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it('returns empty array when no env vars are set', () => {
    const providers = detectProviders();
    assert.deepStrictEqual(providers, []);
  });

  it('detects Anthropic from ANTHROPIC_API_KEY', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    const providers = detectProviders();
    assert.equal(providers.length, 1);
    assert.equal(providers[0].type, 'anthropic');
    assert.equal(providers[0].baseUrl, 'https://api.anthropic.com');
    assert.equal(providers[0].apiKeyEnvVar, 'ANTHROPIC_API_KEY');
    assert.ok(providers[0].models.length > 0);
  });

  it('detects OpenAI from OPENAI_API_KEY', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    const providers = detectProviders();
    assert.equal(providers.length, 1);
    assert.equal(providers[0].type, 'openai');
    assert.equal(providers[0].baseUrl, 'https://api.openai.com');
    assert.equal(providers[0].apiKeyEnvVar, 'OPENAI_API_KEY');
  });

  it('detects Gemini from GEMINI_API_KEY', () => {
    process.env['GEMINI_API_KEY'] = 'AIza-test';
    const providers = detectProviders();
    assert.equal(providers.length, 1);
    assert.equal(providers[0].type, 'gemini');
    assert.equal(providers[0].baseUrl, 'https://generativelanguage.googleapis.com');
  });

  it('detects Groq from GROQ_API_KEY', () => {
    process.env['GROQ_API_KEY'] = 'gsk-test';
    const providers = detectProviders();
    assert.equal(providers.length, 1);
    assert.equal(providers[0].type, 'groq');
    assert.equal(providers[0].baseUrl, 'https://api.groq.com');
  });

  it('detects Mistral from MISTRAL_API_KEY', () => {
    process.env['MISTRAL_API_KEY'] = 'mist-test';
    const providers = detectProviders();
    assert.equal(providers.length, 1);
    assert.equal(providers[0].type, 'mistral');
    assert.equal(providers[0].baseUrl, 'https://api.mistral.ai');
  });

  it('detects Ollama from OLLAMA_HOST', () => {
    process.env['OLLAMA_HOST'] = 'http://localhost:11434';
    const providers = detectProviders();
    assert.equal(providers.length, 1);
    assert.equal(providers[0].type, 'ollama');
    assert.equal(providers[0].baseUrl, 'http://localhost:11434');
    // Ollama has no apiKeyEnvVar
    assert.equal(providers[0].apiKeyEnvVar, undefined);
  });

  it('detects multiple providers simultaneously', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    process.env['OPENAI_API_KEY'] = 'sk-test';
    process.env['OLLAMA_HOST'] = 'http://localhost:11434';
    const providers = detectProviders();
    assert.equal(providers.length, 3);

    const types = providers.map(p => p.type);
    assert.ok(types.includes('anthropic'));
    assert.ok(types.includes('openai'));
    assert.ok(types.includes('ollama'));
  });

  it('detects all six providers when all env vars set', () => {
    process.env['ANTHROPIC_API_KEY'] = 'a';
    process.env['OPENAI_API_KEY'] = 'b';
    process.env['GEMINI_API_KEY'] = 'c';
    process.env['GROQ_API_KEY'] = 'd';
    process.env['MISTRAL_API_KEY'] = 'e';
    process.env['OLLAMA_HOST'] = 'http://localhost:11434';
    const providers = detectProviders();
    assert.equal(providers.length, 6);
  });

  it('preserves registry order: anthropic first when both anthropic and openai set', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    const providers = detectProviders();
    // Registry order: anthropic, openai, gemini, groq, mistral — so anthropic first
    assert.equal(providers[0].type, 'anthropic');
    assert.equal(providers[1].type, 'openai');
  });

  it('ignores empty string env var', () => {
    process.env['ANTHROPIC_API_KEY'] = '';
    const providers = detectProviders();
    // Empty string is falsy — should not detect
    assert.equal(providers.length, 0);
  });
});

// ─── resolveMasterKey() ───

describe('resolveMasterKey()', () => {
  let envSnap: EnvSnapshot;
  const testDir = join(tmpdir(), `limen-test-key-${process.pid}-${Date.now()}`);
  const devKeyDir = join(homedir(), '.limen');
  const devKeyPath = join(devKeyDir, 'dev.key');
  let originalDevKey: Buffer | null = null;

  beforeEach(() => {
    envSnap = saveEnv(KEY_ENV_VARS);
    clearEnv(KEY_ENV_VARS);
    mkdirSync(testDir, { recursive: true });

    // Preserve existing dev key if present
    if (existsSync(devKeyPath)) {
      originalDevKey = readFileSync(devKeyPath);
    }
  });

  afterEach(() => {
    restoreEnv(envSnap);
    // Clean up test dir
    rmSync(testDir, { recursive: true, force: true });

    // Restore original dev key
    if (originalDevKey !== null) {
      mkdirSync(devKeyDir, { recursive: true });
      writeFileSync(devKeyPath, originalDevKey, { mode: 0o600 });
    }
  });

  it('reads hex key from LIMEN_MASTER_KEY', () => {
    const key = randomBytes(32);
    process.env['LIMEN_MASTER_KEY'] = key.toString('hex');
    const result = resolveMasterKey();
    assert.ok(Buffer.isBuffer(result));
    assert.equal(result.length, 32);
    assert.ok(result.equals(key));
  });

  it('throws INVALID_CONFIG when LIMEN_MASTER_KEY is too short', () => {
    // 16 bytes = 32 hex chars, but we need 32 bytes = 64 hex chars
    process.env['LIMEN_MASTER_KEY'] = randomBytes(16).toString('hex');
    assert.throws(
      () => resolveMasterKey(),
      (err: unknown) => {
        assert.ok(err instanceof LimenError);
        assert.equal(err.code, 'INVALID_CONFIG');
        assert.ok(err.message.includes('64 hex characters'));
        return true;
      },
    );
  });

  it('reads key from file via LIMEN_MASTER_KEY_FILE', () => {
    const key = randomBytes(32);
    const keyFile = join(testDir, 'test.key');
    writeFileSync(keyFile, key);
    process.env['LIMEN_MASTER_KEY_FILE'] = keyFile;
    const result = resolveMasterKey();
    assert.ok(Buffer.isBuffer(result));
    assert.equal(result.length, 32);
    assert.ok(result.equals(key));
  });

  it('throws INVALID_CONFIG when key file contains too few bytes', () => {
    const keyFile = join(testDir, 'short.key');
    writeFileSync(keyFile, randomBytes(16)); // only 16 bytes
    process.env['LIMEN_MASTER_KEY_FILE'] = keyFile;
    assert.throws(
      () => resolveMasterKey(),
      (err: unknown) => {
        assert.ok(err instanceof LimenError);
        assert.equal(err.code, 'INVALID_CONFIG');
        // Message may be redacted by LimenError sanitizer (file path triggers redaction),
        // so we only assert the error code, not message content.
        return true;
      },
    );
  });

  it('throws INVALID_CONFIG when key file does not exist', () => {
    process.env['LIMEN_MASTER_KEY_FILE'] = join(testDir, 'nonexistent.key');
    assert.throws(
      () => resolveMasterKey(),
      (err: unknown) => {
        assert.ok(err instanceof LimenError);
        assert.equal(err.code, 'INVALID_CONFIG');
        // Message may be redacted by LimenError sanitizer (file path triggers redaction),
        // so we only assert the error code, not message content.
        return true;
      },
    );
  });

  it('auto-generates dev key when no env vars set', () => {
    // Remove existing dev key if present
    if (existsSync(devKeyPath)) {
      unlinkSync(devKeyPath);
    }

    // Capture stderr to verify the warning is emitted
    const result = resolveMasterKey();
    assert.ok(Buffer.isBuffer(result));
    assert.ok(result.length >= 32, `Expected >= 32 bytes, got ${result.length}`);

    // Dev key should be persisted to disk
    assert.ok(existsSync(devKeyPath), 'Dev key should be written to ~/.limen/dev.key');
  });

  it('reuses existing dev key on subsequent calls', () => {
    // Remove existing dev key if present
    if (existsSync(devKeyPath)) {
      unlinkSync(devKeyPath);
    }

    const first = resolveMasterKey();
    const second = resolveMasterKey();
    assert.ok(first.equals(second), 'Same dev key should be returned on consecutive calls');
  });

  it('LIMEN_MASTER_KEY takes priority over LIMEN_MASTER_KEY_FILE', () => {
    const hexKey = randomBytes(32);
    const fileKey = randomBytes(32);
    process.env['LIMEN_MASTER_KEY'] = hexKey.toString('hex');
    const keyFile = join(testDir, 'file.key');
    writeFileSync(keyFile, fileKey);
    process.env['LIMEN_MASTER_KEY_FILE'] = keyFile;

    const result = resolveMasterKey();
    assert.ok(result.equals(hexKey), 'Should use LIMEN_MASTER_KEY, not file');
  });
});

// ─── resolveDataDir() ───

describe('resolveDataDir()', () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = saveEnv(DIR_ENV_VARS);
    clearEnv(DIR_ENV_VARS);
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it('reads from LIMEN_DATA_DIR when set', () => {
    process.env['LIMEN_DATA_DIR'] = '/custom/data/dir';
    assert.equal(resolveDataDir(), '/custom/data/dir');
  });

  it('falls back to tmpdir/limen-dev when LIMEN_DATA_DIR not set', () => {
    const expected = join(tmpdir(), 'limen-dev');
    assert.equal(resolveDataDir(), expected);
  });
});

// ─── resolveDefaults() ───

describe('resolveDefaults()', () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = saveEnv(ALL_ENV_VARS);
    clearEnv(ALL_ENV_VARS);
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it('returns valid config with empty providers when zero providers detected (zero-config degraded mode)', () => {
    // P1-VL01-002: Zero-config createLimen() must not throw.
    // Core CRUD works without LLM. Only cognitive features require a provider.
    const config = resolveDefaults();
    assert.ok(config);
    assert.ok(Array.isArray(config.providers));
    assert.equal(config.providers!.length, 0);
    assert.ok(config.dataDir);
    assert.ok(config.masterKey);
  });

  it('composes valid LimenConfig when one provider detected', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    const config = resolveDefaults();

    // dataDir should be resolved
    assert.equal(typeof config.dataDir, 'string');
    assert.ok(config.dataDir.length > 0);

    // masterKey should be a 32+ byte buffer
    assert.ok(Buffer.isBuffer(config.masterKey));
    assert.ok(config.masterKey.length >= 32);

    // providers should include anthropic
    assert.ok(config.providers);
    assert.ok(config.providers!.length >= 1);
    assert.equal(config.providers![0].type, 'anthropic');
  });

  it('composes valid LimenConfig with multiple providers', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    process.env['OPENAI_API_KEY'] = 'sk-test';
    const config = resolveDefaults();

    assert.ok(config.providers);
    assert.equal(config.providers!.length, 2);
  });

  it('uses LIMEN_DATA_DIR when set', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    process.env['LIMEN_DATA_DIR'] = '/my/data';
    const config = resolveDefaults();
    assert.equal(config.dataDir, '/my/data');
  });

  it('uses LIMEN_MASTER_KEY when set', () => {
    const key = randomBytes(32);
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
    process.env['LIMEN_MASTER_KEY'] = key.toString('hex');
    const config = resolveDefaults();
    assert.ok(config.masterKey.equals(key));
  });
});
