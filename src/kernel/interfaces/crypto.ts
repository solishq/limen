/**
 * Cryptographic primitives interface types.
 * S ref: I-11, FM-10, IP-1
 *
 * Phase: 1 (Kernel)
 * Implements: AES-256-GCM encryption, PBKDF2 key derivation,
 *             SHA-256 for audit chain, HMAC-SHA256 for webhook signing.
 *
 * I-11: Encryption at rest. AES-256-GCM default. ML-KEM-512 post-quantum opt-in.
 * IP-1: Webhook signing with HMAC-SHA256.
 * All crypto uses Node.js built-in crypto module (I-01 compliance).
 */

import type { Result, OperationContext } from './common.js';
import type { DatabaseConnection } from './database.js';

// ─── Configuration ───

/**
 * Crypto engine configuration.
 * S ref: I-11 (AES-256-GCM default, PBKDF2 iterations)
 */
export interface CryptoConfig {
  readonly masterKey: Buffer;                 // provided at engine creation, never persisted in DB
  readonly defaultAlgorithm: 'aes-256-gcm';
  readonly pbkdf2Iterations: number;          // default 600000
  readonly postQuantum: boolean;              // opt-in ML-KEM-512 hybrid (I-11)
}

// ─── Encrypted Payload ───

/**
 * Encrypted data envelope with all metadata needed for decryption.
 * S ref: I-11 (AES-256-GCM with IV and auth tag)
 */
export interface EncryptedPayload {
  readonly ciphertext: Buffer;
  readonly iv: Buffer;                        // 12 bytes for AES-256-GCM
  readonly authTag: Buffer;                   // 16 bytes for GCM
  readonly keyVersion: number;                // for key rotation tracking
  readonly algorithm: string;
}

// ─── Crypto Engine ───

/**
 * Low-level cryptographic operations.
 * S ref: I-11 (encryption at rest), §3.5 (SHA-256 for audit chain),
 *        IP-6 (HMAC-SHA256 for webhook signing)
 */
export interface CryptoEngine {
  /**
   * Derive tenant-specific key via PBKDF2.
   * Key material never written to DB.
   * S ref: I-11 (key derivation, 600000 iterations default)
   */
  deriveKey(masterKey: Buffer, salt: Buffer, iterations: number): Result<Buffer>;

  /**
   * Encrypt plaintext with AES-256-GCM.
   * S ref: I-11 (AES-256-GCM default encryption)
   */
  encrypt(plaintext: Buffer, key: Buffer): Result<EncryptedPayload>;

  /**
   * Decrypt ciphertext with AES-256-GCM.
   * S ref: I-11 (decryption with authentication)
   */
  decrypt(payload: EncryptedPayload, key: Buffer): Result<Buffer>;

  /**
   * SHA-256 hash for audit chain.
   * S ref: §3.5 (SHA-256 hash chaining)
   */
  sha256(data: string): string;

  /**
   * HMAC-SHA256 for webhook signing.
   * S ref: IP-6 (webhook signing)
   */
  hmacSha256(data: string, secret: string): string;
}

// ─── Vault Operations ───

/**
 * Encrypted secret storage (vault).
 * S ref: I-11 (encryption at rest), IP-1 (secure credential storage)
 */
export interface VaultOperations {
  /**
   * Store encrypted value in vault.
   * S ref: I-11 (encryption at rest for secrets)
   */
  store(conn: DatabaseConnection, ctx: OperationContext, keyName: string, plaintext: Buffer): Result<void>;

  /**
   * Retrieve decrypted value from vault.
   * S ref: I-11 (decryption for authorized access)
   */
  retrieve(conn: DatabaseConnection, ctx: OperationContext, keyName: string): Result<Buffer>;

  /**
   * Delete vault entry.
   * S ref: I-02 (data deletion)
   */
  remove(conn: DatabaseConnection, ctx: OperationContext, keyName: string): Result<void>;

  /**
   * List vault key names (not values).
   * S ref: I-11 (key inventory without exposing secrets)
   */
  list(conn: DatabaseConnection, ctx: OperationContext): Result<string[]>;
}
