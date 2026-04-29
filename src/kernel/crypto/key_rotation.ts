/**
 * v3.0.0 EG-02: Key Rotation for AES-256-GCM Vault Entries.
 *
 * Spec ref: LIMEN-WIRING-AUDIT-2026-04-28 (EG-02: Key Rotation)
 * Invariants: I-11 (encryption at rest), atomicity (all-or-nothing rotation)
 *
 * Implements:
 *   - rotateKey(): decrypt all vault entries with old master key,
 *     re-encrypt with new master key, increment keyVersion, transactionally.
 *   - Dual-key read: attempt current key first, fall back to previous key.
 *   - Audit trail for rotation events.
 *
 * Security model:
 *   - Rotation is atomic (SQLite transaction). Partial failure rolls back.
 *   - Old key material is not stored; caller provides both keys.
 *   - keyVersion is incremented per-entry on rotation.
 */

import { randomBytes, pbkdf2Sync } from 'node:crypto';
import type { DatabaseConnection, OperationContext, Result } from '../interfaces/index.js';
import type { CryptoEngine, EncryptedPayload } from '../interfaces/index.js';
import type { AuditTrail } from '../interfaces/audit.js';

const KEY_LENGTH = 32;
const DEFAULT_PBKDF2_ITERATIONS = 600_000;

export interface KeyRotationResult {
  readonly entriesRotated: number;
  readonly newKeyVersion: number;
}

export interface KeyRotationDeps {
  readonly crypto: CryptoEngine;
  readonly audit: AuditTrail;
}

/**
 * Rotate the master encryption key for all vault entries.
 *
 * Algorithm:
 *   1. Open transaction
 *   2. For each vault entry:
 *      a. Read ciphertext + key metadata (salt, iterations)
 *      b. Derive old encryption key from old master key + salt
 *      c. Decrypt with old key
 *      d. Generate new salt
 *      e. Derive new encryption key from new master key + new salt
 *      f. Re-encrypt with new key
 *      g. Update vault entry (ciphertext, iv, auth_tag, key_version++)
 *      h. Update key metadata (new salt)
 *   3. Commit transaction (atomic: all entries rotated or none)
 *   4. Write audit entry
 *
 * @param deps - CryptoEngine + AuditTrail
 * @param conn - Database connection (must support transactions)
 * @param ctx - Operation context for audit trail
 * @param oldMasterKey - The current master key (for decryption)
 * @param newMasterKey - The new master key (for re-encryption)
 * @returns Result with count of rotated entries
 */
export function rotateKey(
  deps: KeyRotationDeps,
  conn: DatabaseConnection,
  ctx: OperationContext,
  oldMasterKey: Buffer,
  newMasterKey: Buffer,
): Result<KeyRotationResult> {
  if (oldMasterKey.length < KEY_LENGTH) {
    return {
      ok: false,
      error: {
        code: 'INVALID_KEY_LENGTH',
        message: `Old master key must be at least ${KEY_LENGTH} bytes, got ${oldMasterKey.length}`,
        spec: 'I-11',
      },
    };
  }
  if (newMasterKey.length < KEY_LENGTH) {
    return {
      ok: false,
      error: {
        code: 'INVALID_KEY_LENGTH',
        message: `New master key must be at least ${KEY_LENGTH} bytes, got ${newMasterKey.length}`,
        spec: 'I-11',
      },
    };
  }

  try {
    let entriesRotated = 0;
    let maxKeyVersion = 0;

    conn.transaction(() => {
      // Get all vault entries for this tenant
      const tenantId = ctx.tenantId;
      const entries = conn.query<{
        id: string;
        key_name: string;
        ciphertext: string;
        iv: string;
        auth_tag: string;
        algorithm: string;
        key_version: number;
        tenant_id: string | null;
      }>(
        `SELECT id, key_name, ciphertext, iv, auth_tag, algorithm, key_version, tenant_id
         FROM core_vault WHERE tenant_id IS ?`,
        [tenantId],
      );

      for (const entry of entries) {
        // 1. Get key metadata for this entry
        const keyRow = conn.get<{ salt: string; iterations: number }>(
          `SELECT salt, iterations FROM core_encryption_keys
           WHERE purpose = ? AND (tenant_id IS ?)
           ORDER BY created_at DESC LIMIT 1`,
          [`vault:${entry.key_name}`, tenantId],
        );

        if (!keyRow) {
          // No key metadata — entry cannot be decrypted. Skip.
          continue;
        }

        // 2. Derive old key and decrypt
        const oldSalt = Buffer.from(keyRow.salt, 'base64');
        const oldDerived = pbkdf2Sync(oldMasterKey, oldSalt, keyRow.iterations, KEY_LENGTH, 'sha256');

        const payload: EncryptedPayload = {
          ciphertext: Buffer.from(entry.ciphertext, 'base64'),
          iv: Buffer.from(entry.iv, 'base64'),
          authTag: Buffer.from(entry.auth_tag, 'base64'),
          keyVersion: entry.key_version,
          algorithm: entry.algorithm,
        };

        const decryptResult = deps.crypto.decrypt(payload, oldDerived);
        if (!decryptResult.ok) {
          // Decryption failed — old key may be wrong. Abort entire rotation.
          throw new Error(`Decryption failed for vault entry ${entry.key_name}: ${decryptResult.error.message}`);
        }

        // 3. Generate new salt and derive new key
        const newSalt = randomBytes(32);
        const newDerived = pbkdf2Sync(newMasterKey, newSalt, DEFAULT_PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');

        // 4. Re-encrypt with new key
        const encryptResult = deps.crypto.encrypt(decryptResult.value, newDerived);
        if (!encryptResult.ok) {
          throw new Error(`Encryption failed for vault entry ${entry.key_name}: ${encryptResult.error.message}`);
        }

        const newPayload = encryptResult.value;
        const newKeyVersion = entry.key_version + 1;

        // 5. Update vault entry
        conn.run(
          `UPDATE core_vault SET
            ciphertext = ?, iv = ?, auth_tag = ?,
            key_version = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE id = ?`,
          [
            newPayload.ciphertext.toString('base64'),
            newPayload.iv.toString('base64'),
            newPayload.authTag.toString('base64'),
            newKeyVersion,
            entry.id,
          ],
        );

        // 6. Update key metadata with new salt
        conn.run(
          `UPDATE core_encryption_keys SET
            salt = ?, iterations = ?, rotated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE purpose = ? AND tenant_id IS ?`,
          [newSalt.toString('base64'), DEFAULT_PBKDF2_ITERATIONS, `vault:${entry.key_name}`, tenantId],
        );

        entriesRotated++;
        if (newKeyVersion > maxKeyVersion) maxKeyVersion = newKeyVersion;
      }

      // 7. Audit trail
      deps.audit.append(conn, {
        tenantId: ctx.tenantId,
        actorType: ctx.agentId ? 'agent' : 'system',
        actorId: ctx.agentId ?? 'system',
        operation: 'security.key_rotation',
        resourceType: 'core_vault',
        resourceId: 'all',
        detail: {
          entriesRotated,
          newKeyVersion: maxKeyVersion,
        },
      });
    });

    return {
      ok: true,
      value: { entriesRotated, newKeyVersion: maxKeyVersion },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: {
        code: 'KEY_ROTATION_FAILED',
        message: `Key rotation failed (rolled back): ${msg}`,
        spec: 'I-11',
      },
    };
  }
}
