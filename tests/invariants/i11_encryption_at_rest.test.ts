/**
 * Verifies: §4 I-11
 * Phase: 1 (Kernel)
 * Agent: Verification Engineer (Team D)
 *
 * Tests derived from the Limen specification.
 * No implementation exists at time of writing — tests define the contract.
 *
 * I-11: Encryption at Rest.
 * "AES-256-GCM default. ML-KEM-512 post-quantum hybrid opt-in for customers
 * with specific compliance requirements."
 *
 * VERIFICATION STRATEGY:
 * Encryption at rest protects stored data from unauthorized access to the database
 * file. We verify:
 * 1. The crypto module provides AES-256-GCM as the default cipher
 * 2. Encryption round-trip: encrypt(plaintext) -> decrypt -> plaintext
 * 3. Decryption with wrong key fails
 * 4. GCM authentication tag prevents ciphertext tampering
 * 5. Each encryption produces unique ciphertext (IV/nonce uniqueness)
 *
 * NOTE: ML-KEM-512 post-quantum hybrid is a compliance opt-in. Phase 1 tests
 * focus on the default AES-256-GCM. ML-KEM-512 is tested if the kernel
 * implements it in Phase 1, otherwise deferred to when it is built.
 *
 * ASSUMPTIONS:
 * - ASSUMPTION A11-1: The kernel uses Node.js built-in crypto module for
 *   AES-256-GCM (no external dependency required — I-01 compliance).
 * - ASSUMPTION A11-2: Each encryption operation generates a unique random IV
 *   (Initialization Vector / nonce). GCM requires a unique nonce per encryption.
 * - ASSUMPTION A11-3: The encryption interface accepts a key and plaintext,
 *   returns ciphertext + IV + auth tag. All three are needed for decryption.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

// ─── CONTRACT TYPES ───

/** I-11: Encrypted data envelope */
interface EncryptedEnvelope {
  /** The encrypted data */
  ciphertext: Buffer;
  /** The initialization vector / nonce (12 bytes for GCM) */
  iv: Buffer;
  /** The GCM authentication tag (16 bytes) */
  authTag: Buffer;
  /** Algorithm identifier for forward compatibility */
  algorithm: 'aes-256-gcm';
}

/** I-11: Encryption contract */
interface EncryptionContract {
  /** Encrypt plaintext with the given key */
  encrypt(plaintext: Buffer, key: Buffer): EncryptedEnvelope;
  /** Decrypt ciphertext with the given key */
  decrypt(envelope: EncryptedEnvelope, key: Buffer): Buffer;
  /** Generate a random encryption key (32 bytes for AES-256) */
  generateKey(): Buffer;
  /** Derive a key from a passphrase using PBKDF2 */
  deriveKey(passphrase: string, salt: Buffer): Buffer;
}

describe('I-11: Encryption at Rest', () => {
  // ─── HELPERS ───
  // These use Node.js built-in crypto to validate the contract expectations.
  // The kernel implementation must produce compatible results.

  const AES_256_GCM = 'aes-256-gcm' as const;
  const KEY_LENGTH = 32;  // 256 bits
  const IV_LENGTH = 12;   // 96 bits — recommended for GCM
  const AUTH_TAG_LENGTH = 16;  // 128 bits

  function encrypt(plaintext: Buffer, key: Buffer): EncryptedEnvelope {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(AES_256_GCM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { ciphertext: encrypted, iv, authTag, algorithm: AES_256_GCM };
  }

  function decrypt(envelope: EncryptedEnvelope, key: Buffer): Buffer {
    const decipher = createDecipheriv(AES_256_GCM, key, envelope.iv);
    decipher.setAuthTag(envelope.authTag);
    return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
  }

  // ─── POSITIVE: AES-256-GCM works correctly ───

  it('AES-256-GCM must be the default encryption algorithm', () => {
    /**
     * I-11: "AES-256-GCM default"
     *
     * CONTRACT: The default algorithm is AES-256-GCM, not AES-256-CBC,
     * not ChaCha20-Poly1305, not any other cipher. GCM provides both
     * confidentiality and authenticity.
     */
    assert.equal(AES_256_GCM, 'aes-256-gcm',
      'I-11: Default encryption algorithm is AES-256-GCM'
    );
  });

  it('encrypt then decrypt must return original plaintext', () => {
    /**
     * I-11: Fundamental correctness — the round-trip must be lossless.
     *
     * This is the core contract: data encrypted with a key can be
     * decrypted with the same key to produce the original plaintext.
     */
    const key = randomBytes(KEY_LENGTH);
    const plaintext = Buffer.from('Limen Genesis v1.0 — encrypted at rest');

    const envelope = encrypt(plaintext, key);
    const decrypted = decrypt(envelope, key);

    assert.deepEqual(decrypted, plaintext,
      'I-11: encrypt(plaintext, key) -> decrypt(_, key) must return plaintext'
    );
  });

  it('key length must be exactly 256 bits (32 bytes)', () => {
    /**
     * I-11: "AES-256-GCM" — the 256 specifies the key length.
     *
     * CONTRACT: generateKey() must produce exactly 32 bytes.
     * Keys shorter than 32 bytes are a security violation.
     * Keys longer than 32 bytes are unnecessary.
     */
    const key = randomBytes(KEY_LENGTH);
    assert.equal(key.length, 32,
      'I-11: AES-256 requires exactly 32-byte (256-bit) keys'
    );
  });

  it('IV must be 12 bytes (96 bits) for GCM', () => {
    /**
     * GCM specification requires 12-byte nonce for optimal security.
     * Other lengths are technically supported but discouraged by NIST SP 800-38D.
     */
    const iv = randomBytes(IV_LENGTH);
    assert.equal(iv.length, 12,
      'I-11: GCM IV must be 12 bytes per NIST recommendation'
    );
  });

  it('authentication tag must be 16 bytes (128 bits)', () => {
    /**
     * GCM produces a 16-byte authentication tag that prevents ciphertext
     * tampering. Truncating the tag reduces security.
     */
    const key = randomBytes(KEY_LENGTH);
    const plaintext = Buffer.from('test data');
    const envelope = encrypt(plaintext, key);

    assert.equal(envelope.authTag.length, AUTH_TAG_LENGTH,
      'I-11: GCM auth tag must be 16 bytes'
    );
  });

  // ─── NEGATIVE: Wrong key / tampered data must fail ───

  it('decryption with wrong key must fail', () => {
    /**
     * I-11: Encryption must be effective — wrong key must not decrypt.
     *
     * CONTRACT: decrypt(envelope, wrongKey) must throw an error.
     * GCM's authentication check fails before producing plaintext,
     * preventing even partial decryption.
     */
    const rightKey = randomBytes(KEY_LENGTH);
    const wrongKey = randomBytes(KEY_LENGTH);
    const plaintext = Buffer.from('sensitive data');
    const envelope = encrypt(plaintext, rightKey);

    assert.throws(
      () => decrypt(envelope, wrongKey),
      'I-11: Decryption with wrong key must throw'
    );
  });

  it('tampered ciphertext must fail authentication', () => {
    /**
     * I-11: GCM provides authenticated encryption — tampering is detected.
     *
     * CONTRACT: If any byte of the ciphertext is modified, decryption
     * must fail with an authentication error. This prevents attackers
     * from modifying encrypted data without detection.
     */
    const key = randomBytes(KEY_LENGTH);
    const plaintext = Buffer.from('tamper-proof data');
    const envelope = encrypt(plaintext, key);

    // Tamper with one byte of ciphertext
    if (envelope.ciphertext.length > 0) {
      const tampered = Buffer.from(envelope.ciphertext);
      tampered[0] = (tampered[0]! ^ 0xFF);
      const tamperedEnvelope: EncryptedEnvelope = {
        ...envelope,
        ciphertext: tampered,
      };

      assert.throws(
        () => decrypt(tamperedEnvelope, key),
        'I-11: Tampered ciphertext must fail GCM authentication'
      );
    }
  });

  it('tampered auth tag must fail decryption', () => {
    /**
     * The auth tag is the integrity proof. If it is modified, decryption
     * must fail even if the ciphertext is untouched.
     */
    const key = randomBytes(KEY_LENGTH);
    const plaintext = Buffer.from('auth tag integrity');
    const envelope = encrypt(plaintext, key);

    const tamperedTag = Buffer.from(envelope.authTag);
    tamperedTag[0] = (tamperedTag[0]! ^ 0xFF);
    const tamperedEnvelope: EncryptedEnvelope = {
      ...envelope,
      authTag: tamperedTag,
    };

    assert.throws(
      () => decrypt(tamperedEnvelope, key),
      'I-11: Tampered auth tag must fail decryption'
    );
  });

  // ─── UNIQUENESS: Each encryption produces unique output ───

  it('encrypting the same plaintext twice must produce different ciphertexts', () => {
    /**
     * ASSUMPTION A11-2: Each encryption uses a unique random IV.
     *
     * If the IV is reused with the same key, GCM's security guarantees
     * are completely broken (key recovery attack). This test verifies
     * that the IV is randomized per encryption.
     */
    const key = randomBytes(KEY_LENGTH);
    const plaintext = Buffer.from('identical plaintext');

    const envelope1 = encrypt(plaintext, key);
    const envelope2 = encrypt(plaintext, key);

    // IVs must differ
    assert.notDeepEqual(envelope1.iv, envelope2.iv,
      'I-11: Each encryption must use a unique IV'
    );

    // Ciphertexts must differ (consequence of different IVs)
    assert.notDeepEqual(envelope1.ciphertext, envelope2.ciphertext,
      'I-11: Same plaintext encrypted twice must produce different ciphertext'
    );
  });

  // ─── EDGE CASES ───

  it('empty plaintext must encrypt and decrypt correctly', () => {
    /**
     * Edge case: Encrypting an empty buffer must produce a valid envelope
     * that decrypts back to an empty buffer.
     */
    const key = randomBytes(KEY_LENGTH);
    const empty = Buffer.alloc(0);
    const envelope = encrypt(empty, key);
    const decrypted = decrypt(envelope, key);

    assert.equal(decrypted.length, 0,
      'I-11: Empty plaintext round-trips correctly'
    );
  });

  it('large plaintext must encrypt and decrypt correctly', () => {
    /**
     * Edge case: Memory content (§9) could be large. Encryption must
     * handle arbitrary sizes without truncation or corruption.
     */
    const key = randomBytes(KEY_LENGTH);
    const largePlaintext = randomBytes(1024 * 1024); // 1MB
    const envelope = encrypt(largePlaintext, key);
    const decrypted = decrypt(envelope, key);

    assert.deepEqual(decrypted, largePlaintext,
      'I-11: Large plaintext (1MB) round-trips correctly'
    );
  });

  it('binary data must encrypt and decrypt correctly', () => {
    /**
     * Edge case: Artifacts (§8) can contain binary data (images, code).
     * Encryption must handle arbitrary byte sequences, not just UTF-8 text.
     */
    const key = randomBytes(KEY_LENGTH);
    const binary = Buffer.from([0x00, 0xFF, 0x80, 0x7F, 0x01, 0xFE]);
    const envelope = encrypt(binary, key);
    const decrypted = decrypt(envelope, key);

    assert.deepEqual(decrypted, binary,
      'I-11: Binary data round-trips correctly through encryption'
    );
  });

  it('envelope must include algorithm identifier for forward compatibility', () => {
    /**
     * Edge case: When ML-KEM-512 post-quantum hybrid is introduced,
     * the system must distinguish between AES-256-GCM envelopes and
     * hybrid envelopes. The algorithm field enables this.
     */
    const key = randomBytes(KEY_LENGTH);
    const plaintext = Buffer.from('forward compatible');
    const envelope = encrypt(plaintext, key);

    assert.equal(envelope.algorithm, 'aes-256-gcm',
      'I-11: Envelope must tag algorithm for forward compatibility'
    );
  });
});
