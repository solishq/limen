/**
 * TEST-GAP-004: Audit Trail Tamper Prevention — I-06, FM-08, S3.5
 * Verifies: Hash chain integrity, trigger enforcement, verifyChain detection.
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * I-06: "Active database audit entries are append-only. No modify, no delete."
 * FM-08: "SHA-256 hash chaining, monotonic sequence numbers, append-only."
 * S3.5: "SHA-256 hash chaining. Monotonic sequence numbers. Append-only."
 *
 * Phase: 4A-3 (harness-dependent tests)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase,
  createTestAuditTrail,
  seedAuditEntry,
} from '../helpers/test_database.js';

describe('TEST-GAP-004: Audit Trail Tamper Prevention (I-06, FM-08, S3.5)', () => {

  describe('I-06: Trigger enforcement — append-only', () => {

    it('UPDATE on core_audit_log is blocked by I-06 trigger', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedAuditEntry(conn, audit, { operation: 'setup_entry' });

      assert.throws(
        () => conn.run(`UPDATE core_audit_log SET operation = 'tampered' WHERE seq_no = 1`),
        (err: Error) => err.message.includes('I-06'),
        'I-06: UPDATE on core_audit_log must be blocked by trigger'
      );

      conn.close();
    });

    it('DELETE on core_audit_log is blocked by I-06 trigger', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedAuditEntry(conn, audit, { operation: 'setup_entry' });

      assert.throws(
        () => conn.run(`DELETE FROM core_audit_log WHERE seq_no = 1`),
        (err: Error) => err.message.includes('I-06'),
        'I-06: DELETE on core_audit_log must be blocked by trigger'
      );

      conn.close();
    });
  });

  describe('FM-08: Hash chain integrity — verifyChain()', () => {

    it('valid chain with multiple entries verifies successfully', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      // Insert 5 entries
      for (let i = 1; i <= 5; i++) {
        const result = seedAuditEntry(conn, audit, {
          operation: `op_${i}`,
          resourceId: `res-${i}`,
        });
        assert.ok(result.ok, `Entry ${i} must succeed`);
      }

      // Verify chain
      const verification = audit.verifyChain(conn);
      assert.ok(verification.ok, 'verifyChain must succeed');
      assert.equal(verification.value.valid, true, 'FM-08: Chain must be valid');
      assert.equal(verification.value.totalEntries, 5, 'Must have 5 entries');
      assert.equal(verification.value.gaps.length, 0, 'Must have no sequence gaps');
      assert.equal(verification.value.brokenAt, null, 'Must not be broken anywhere');

      conn.close();
    });

    it('tampered hash is detected by verifyChain()', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      // Insert 3 entries
      for (let i = 1; i <= 3; i++) {
        seedAuditEntry(conn, audit, { operation: `op_${i}`, resourceId: `res-${i}` });
      }

      // Drop trigger to simulate tampering (attacker with DB access = Class C)
      conn.run(`DROP TRIGGER IF EXISTS core_audit_log_no_update`);

      // Tamper with entry 2's hash
      conn.run(`UPDATE core_audit_log SET current_hash = 'tampered_hash_value' WHERE seq_no = 2`);

      // Restore trigger (not strictly needed for test but matches real scenario)
      // verifyChain should detect the tampering
      const verification = audit.verifyChain(conn);
      assert.ok(verification.ok, 'verifyChain call must succeed');
      assert.equal(verification.value.valid, false, 'FM-08: Tampered chain must be invalid');
      assert.ok(verification.value.brokenAt !== null, 'FM-08: brokenAt must identify the tampered entry');

      conn.close();
    });

    it('sequence gap is detected by verifyChain()', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      // Insert 3 entries
      for (let i = 1; i <= 3; i++) {
        seedAuditEntry(conn, audit, { operation: `op_${i}`, resourceId: `res-${i}` });
      }

      // Drop trigger to allow deletion
      conn.run(`DROP TRIGGER IF EXISTS core_audit_log_no_delete`);

      // Delete entry 2 to create a sequence gap (1, _, 3)
      conn.run(`DELETE FROM core_audit_log WHERE seq_no = 2`);

      const verification = audit.verifyChain(conn);
      assert.ok(verification.ok, 'verifyChain call must succeed');
      // Chain should be invalid due to gap AND broken hash link
      assert.equal(verification.value.valid, false, 'FM-08: Chain with gap must be invalid');
      assert.ok(verification.value.gaps.length > 0 || verification.value.brokenAt !== null,
        'FM-08: Must detect sequence gap or broken hash link');

      conn.close();
    });

    it('empty audit log verifies as valid', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      const verification = audit.verifyChain(conn);
      assert.ok(verification.ok, 'verifyChain must succeed');
      assert.equal(verification.value.valid, true, 'Empty chain is valid');
      assert.equal(verification.value.totalEntries, 0, 'Zero entries');

      conn.close();
    });

    it('first entry links to genesis hash (SHA-256 of empty string)', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedAuditEntry(conn, audit, { operation: 'first_op' });

      const entry = conn.get<{ previous_hash: string }>(
        `SELECT previous_hash FROM core_audit_log WHERE seq_no = 1`
      );
      assert.ok(entry, 'Entry must exist');
      // Genesis hash = SHA-256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      assert.equal(entry.previous_hash,
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'S3.5: First entry previous_hash must be SHA-256 of empty string (genesis hash)');

      conn.close();
    });

    it('hash chain links are contiguous: entry N+1 previous_hash = entry N current_hash', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      for (let i = 1; i <= 4; i++) {
        seedAuditEntry(conn, audit, { operation: `op_${i}`, resourceId: `res-${i}` });
      }

      const entries = conn.query<{ seq_no: number; previous_hash: string; current_hash: string }>(
        `SELECT seq_no, previous_hash, current_hash FROM core_audit_log ORDER BY seq_no`
      );
      assert.equal(entries.length, 4);

      for (let i = 1; i < entries.length; i++) {
        assert.equal(entries[i].previous_hash, entries[i - 1].current_hash,
          `S3.5: Entry ${entries[i].seq_no} previous_hash must equal entry ${entries[i - 1].seq_no} current_hash`);
      }

      conn.close();
    });

    it('monotonic sequence numbers have no gaps after sequential inserts', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      for (let i = 1; i <= 5; i++) {
        seedAuditEntry(conn, audit, { operation: `op_${i}` });
      }

      const entries = conn.query<{ seq_no: number }>(
        `SELECT seq_no FROM core_audit_log ORDER BY seq_no`
      );
      for (let i = 0; i < entries.length; i++) {
        assert.equal(entries[i].seq_no, i + 1,
          `S3.5: Sequence numbers must be monotonic, expected ${i + 1} got ${entries[i].seq_no}`);
      }

      conn.close();
    });
  });
});
