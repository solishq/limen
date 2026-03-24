/**
 * Cryptographic primitives implementation.
 * S ref: I-11, FM-10, IP-1, IP-6
 *
 * Phase: 1 (Kernel) -- Build Order 4
 * Required by audit (SHA-256 hash chaining) and vault.
 *
 * I-11: AES-256-GCM default encryption. PBKDF2 key derivation (600k iterations).
 * IP-1: Vault for secure credential storage.
 * IP-6: HMAC-SHA256 for webhook signing.
 *
 * All crypto uses Node.js built-in crypto module (I-01 compliance).
 */

import {
  createCipheriv, createDecipheriv, createHash, createHmac,
  randomBytes, pbkdf2Sync, timingSafeEqual,
} from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type {
  Result, OperationContext,
  CryptoEngine, VaultOperations, EncryptedPayload,
  DatabaseConnection,
} from '../interfaces/index.js';

/** AES-256-GCM constants. S ref: I-11. */
const AES_256_GCM = 'aes-256-gcm' as const;
const KEY_LENGTH = 32;    // 256 bits
const IV_LENGTH = 12;     // 96 bits (NIST SP 800-38D recommended for GCM)
const AUTH_TAG_LENGTH = 16; // 128 bits

/** Default PBKDF2 iterations. S ref: I-11. */
const DEFAULT_PBKDF2_ITERATIONS = 600_000;

/**
 * Create a CryptoEngine implementation.
 * S ref: I-11 (encryption at rest), §3.5 (SHA-256), IP-6 (HMAC)
 */
export function createCryptoEngine(): CryptoEngine {
  return {
    /**
     * Derive tenant-specific key via PBKDF2.
     * Key material never written to DB.
     * S ref: I-11 (key derivation, 600000 iterations default)
     */
    deriveKey(masterKey: Buffer, salt: Buffer, iterations: number): Result<Buffer> {
      try {
        if (masterKey.length < KEY_LENGTH) {
          return {
            ok: false,
            error: {
              code: 'INVALID_KEY_LENGTH',
              message: `Master key must be at least ${KEY_LENGTH} bytes, got ${masterKey.length}`,
              spec: 'I-11',
            },
          };
        }

        const derived = pbkdf2Sync(masterKey, salt, iterations, KEY_LENGTH, 'sha256');
        return { ok: true, value: derived };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'KEY_DERIVATION_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'I-11',
          },
        };
      }
    },

    /**
     * Encrypt plaintext with AES-256-GCM.
     * S ref: I-11 (AES-256-GCM default encryption)
     */
    encrypt(plaintext: Buffer, key: Buffer): Result<EncryptedPayload> {
      try {
        if (key.length !== KEY_LENGTH) {
          return {
            ok: false,
            error: {
              code: 'INVALID_KEY_LENGTH',
              message: `Key must be exactly ${KEY_LENGTH} bytes, got ${key.length}`,
              spec: 'I-11',
            },
          };
        }

        // Each encryption uses a unique random IV (NIST SP 800-38D)
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv(AES_256_GCM, key, iv);
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const authTag = cipher.getAuthTag();

        return {
          ok: true,
          value: {
            ciphertext,
            iv,
            authTag,
            keyVersion: 1,
            algorithm: AES_256_GCM,
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'ENCRYPTION_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'I-11',
          },
        };
      }
    },

    /**
     * Decrypt ciphertext with AES-256-GCM.
     * S ref: I-11 (decryption with authentication)
     */
    decrypt(payload: EncryptedPayload, key: Buffer): Result<Buffer> {
      try {
        if (key.length !== KEY_LENGTH) {
          return {
            ok: false,
            error: {
              code: 'INVALID_KEY_LENGTH',
              message: `Key must be exactly ${KEY_LENGTH} bytes, got ${key.length}`,
              spec: 'I-11',
            },
          };
        }

        const decipher = createDecipheriv(AES_256_GCM, key, payload.iv);
        decipher.setAuthTag(payload.authTag);
        const plaintext = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);

        return { ok: true, value: plaintext };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'DECRYPTION_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'I-11',
          },
        };
      }
    },

    /**
     * SHA-256 hash for audit chain.
     * S ref: §3.5 (SHA-256 hash chaining)
     */
    sha256(data: string): string {
      return createHash('sha256').update(data).digest('hex');
    },

    /**
     * HMAC-SHA256 for webhook signing.
     * S ref: IP-6 (webhook signing)
     */
    hmacSha256(data: string, secret: string): string {
      return createHmac('sha256', secret).update(data).digest('hex');
    },
  };
}

/**
 * Create VaultOperations implementation.
 * S ref: I-11 (encryption at rest), IP-1 (secure credential storage)
 */
export function createVaultOperations(crypto: CryptoEngine, masterKey: Buffer): VaultOperations {
  // PRR-106: Cache derived keys to avoid blocking the event loop on repeat retrieve().
  // Key: hex(salt) + ':' + iterations. Value: derived key Buffer.
  // Cache is bounded by number of unique vault entries (typically small).
  const derivedKeyCache = new Map<string, Buffer>();

  function cachedDeriveKey(salt: Buffer, iterations: number): Result<Buffer> {
    const cacheKey = salt.toString('hex') + ':' + iterations;
    const cached = derivedKeyCache.get(cacheKey);
    if (cached) return { ok: true, value: cached };

    const result = crypto.deriveKey(masterKey, salt, iterations);
    if (result.ok) {
      derivedKeyCache.set(cacheKey, result.value);
    }
    return result;
  }

  return {
    /**
     * Store encrypted value in vault.
     * S ref: I-11 (encryption at rest for secrets)
     */
    store(conn: DatabaseConnection, ctx: OperationContext, keyName: string, plaintext: Buffer): Result<void> {
      try {
        // Derive a key for this vault entry
        const salt = randomBytes(32);
        const derivedKeyResult = cachedDeriveKey(salt, DEFAULT_PBKDF2_ITERATIONS);
        if (!derivedKeyResult.ok) return derivedKeyResult;

        // Encrypt the value
        const encryptResult = crypto.encrypt(plaintext, derivedKeyResult.value);
        if (!encryptResult.ok) return encryptResult;

        const payload = encryptResult.value;
        const id = randomUUID();
        const tenantId = ctx.tenantId;

        // Atomic upsert: both vault entry and key metadata in a single transaction.
        // If either fails, both roll back — no partial vault entries (Critical #3).
        conn.transaction(() => {
          // Upsert into vault
          conn.run(
            `INSERT INTO core_vault (id, tenant_id, key_name, ciphertext, iv, auth_tag, algorithm, key_version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(tenant_id, key_name) DO UPDATE SET
               ciphertext = excluded.ciphertext,
               iv = excluded.iv,
               auth_tag = excluded.auth_tag,
               key_version = key_version + 1,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
            [id, tenantId, keyName,
             payload.ciphertext.toString('base64'),
             payload.iv.toString('base64'),
             payload.authTag.toString('base64'),
             payload.algorithm, payload.keyVersion]
          );

          // Store key metadata (salt + iterations for re-derivation)
          // SEC-003 fix: ON CONFLICT must UPDATE salt to match new encryption,
          // otherwise retrieve() derives wrong key and decryption fails.
          conn.run(
            `INSERT INTO core_encryption_keys (id, tenant_id, purpose, salt, iterations, algorithm, created_at)
             VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT (tenant_id, purpose) DO UPDATE SET
               salt = excluded.salt,
               iterations = excluded.iterations,
               algorithm = excluded.algorithm`,
            [randomUUID(), tenantId, `vault:${keyName}`,
             salt.toString('base64'), DEFAULT_PBKDF2_ITERATIONS, AES_256_GCM]
          );
        });

        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'VAULT_STORE_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'I-11',
          },
        };
      }
    },

    /**
     * Retrieve decrypted value from vault.
     * S ref: I-11 (decryption for authorized access)
     */
    retrieve(conn: DatabaseConnection, ctx: OperationContext, keyName: string): Result<Buffer> {
      try {
        const tenantId = ctx.tenantId;

        // Get vault entry
        const row = conn.get<{
          ciphertext: string; iv: string; auth_tag: string;
          algorithm: string; key_version: number;
        }>(
          `SELECT ciphertext, iv, auth_tag, algorithm, key_version
           FROM core_vault WHERE key_name = ? AND (tenant_id = ? OR (tenant_id IS NULL AND ? IS NULL))`,
          [keyName, tenantId, tenantId]
        );

        if (!row) {
          return {
            ok: false,
            error: {
              code: 'VAULT_KEY_NOT_FOUND',
              message: `Vault key "${keyName}" not found`,
              spec: 'I-11',
            },
          };
        }

        // Get key metadata for re-derivation
        const keyRow = conn.get<{ salt: string; iterations: number }>(
          `SELECT salt, iterations FROM core_encryption_keys
           WHERE purpose = ? AND (tenant_id = ? OR (tenant_id IS NULL AND ? IS NULL))
           ORDER BY created_at DESC LIMIT 1`,
          [`vault:${keyName}`, tenantId, tenantId]
        );

        if (!keyRow) {
          return {
            ok: false,
            error: {
              code: 'VAULT_KEY_METADATA_NOT_FOUND',
              message: `Key metadata for vault key "${keyName}" not found`,
              spec: 'I-11',
            },
          };
        }

        // Re-derive key
        const salt = Buffer.from(keyRow.salt, 'base64');
        const derivedKeyResult = cachedDeriveKey(salt, keyRow.iterations);
        if (!derivedKeyResult.ok) return derivedKeyResult;

        // Decrypt
        const payload: EncryptedPayload = {
          ciphertext: Buffer.from(row.ciphertext, 'base64'),
          iv: Buffer.from(row.iv, 'base64'),
          authTag: Buffer.from(row.auth_tag, 'base64'),
          keyVersion: row.key_version,
          algorithm: row.algorithm,
        };

        return crypto.decrypt(payload, derivedKeyResult.value);
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'VAULT_RETRIEVE_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'I-11',
          },
        };
      }
    },

    /**
     * Delete vault entry.
     * S ref: I-02 (data deletion)
     */
    remove(conn: DatabaseConnection, ctx: OperationContext, keyName: string): Result<void> {
      try {
        const tenantId = ctx.tenantId;
        conn.run(
          `DELETE FROM core_vault WHERE key_name = ? AND (tenant_id = ? OR (tenant_id IS NULL AND ? IS NULL))`,
          [keyName, tenantId, tenantId]
        );
        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'VAULT_REMOVE_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'I-02',
          },
        };
      }
    },

    /**
     * List vault key names (not values).
     * S ref: I-11 (key inventory without exposing secrets)
     */
    list(conn: DatabaseConnection, ctx: OperationContext): Result<string[]> {
      try {
        const tenantId = ctx.tenantId;
        const rows = conn.query<{ key_name: string }>(
          `SELECT key_name FROM core_vault WHERE tenant_id = ? OR (tenant_id IS NULL AND ? IS NULL)
           ORDER BY key_name`,
          [tenantId, tenantId]
        );
        return { ok: true, value: rows.map(r => r.key_name) };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'VAULT_LIST_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'I-11',
          },
        };
      }
    },
  };
}

/**
 * CF-010: String-level encryption adapter.
 * Wraps CryptoEngine's Buffer-based AES-256-GCM encrypt/decrypt into a
 * string-in/string-out interface suitable for LLM gateway and event bus.
 *
 * Format: base64(iv):base64(authTag):base64(ciphertext)
 * Uses the first 32 bytes of masterKey directly (no derivation — derivation
 * is for per-tenant vault entries, not for system-level encryption).
 *
 * S ref: I-11 (encryption at rest), CF-010 (LLM + webhook encryption)
 */
export interface StringEncryption {
  encrypt(plaintext: string): Result<string>;
  decrypt(ciphertext: string): Result<string>;
}

export function createStringEncryption(crypto: CryptoEngine, masterKey: Buffer): StringEncryption {
  // Use first KEY_LENGTH bytes of masterKey as the AES-256 key
  const key = masterKey.subarray(0, KEY_LENGTH);

  return {
    encrypt(plaintext: string): Result<string> {
      const result = crypto.encrypt(Buffer.from(plaintext, 'utf8'), key);
      if (!result.ok) {
        return { ok: false, error: { code: 'ENCRYPTION_FAILED', message: result.error.message, spec: 'I-11' } };
      }
      const { iv, authTag, ciphertext } = result.value;
      return { ok: true, value: `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}` };
    },

    decrypt(ciphertext: string): Result<string> {
      const parts = ciphertext.split(':');
      if (parts.length !== 3) {
        return { ok: false, error: { code: 'DECRYPTION_FAILED', message: 'Invalid encrypted format: expected iv:authTag:ciphertext', spec: 'I-11' } };
      }
      const [ivB64, authTagB64, ciphertextB64] = parts as [string, string, string];
      const payload = {
        iv: Buffer.from(ivB64, 'base64'),
        authTag: Buffer.from(authTagB64, 'base64'),
        ciphertext: Buffer.from(ciphertextB64, 'base64'),
        keyVersion: 1,
        algorithm: AES_256_GCM,
      };
      const result = crypto.decrypt(payload, key);
      if (!result.ok) {
        return { ok: false, error: { code: 'DECRYPTION_FAILED', message: result.error.message, spec: 'I-11' } };
      }
      return { ok: true, value: result.value.toString('utf8') };
    },
  };
}

/**
 * LRA-001 / INV-130: Timing-safe HMAC verification.
 * Prevents timing side-channel attacks when comparing HMAC signatures.
 * Use this instead of === for any security-sensitive string comparison.
 *
 * @param a - First hex string
 * @param b - Second hex string
 * @returns true if equal (constant-time)
 */
export function timingSafeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * LRA-001: Timing-safe HMAC-SHA256 verification.
 * Computes HMAC-SHA256 and compares against expected value in constant time.
 *
 * @param data - Data that was signed
 * @param secret - HMAC secret
 * @param expectedHmac - Expected hex-encoded HMAC to verify against
 * @returns true if the HMAC matches (constant-time comparison)
 */
export function hmacVerify(data: string, secret: string, expectedHmac: string): boolean {
  const computed = createHmac('sha256', secret).update(data).digest('hex');
  return timingSafeHexEqual(computed, expectedHmac);
}

export { DEFAULT_PBKDF2_ITERATIONS, KEY_LENGTH, IV_LENGTH, AUTH_TAG_LENGTH, AES_256_GCM };
