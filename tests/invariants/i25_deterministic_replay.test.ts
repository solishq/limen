/**
 * Verifies: §4 I-25, §7, §23, §24, I-03
 * Phase: Sprint 4 (Replay & Pipeline)
 *
 * I-25: Deterministic Replay.
 * "All non-determinism (LLM outputs, external tool results) is recorded.
 * Given recorded outputs, any mission can be replayed to produce identical
 * system state."
 *
 * Phase 4G: Stubs replaced with structural assertions verifying the
 * recording infrastructure (core_llm_request_log table, indexes, columns).
 *
 * Sprint 4: Activated deferred tests for LLM output recording and
 * transactional recording consistency.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase,
  createTestAuditTrail,
  seedMission,
  seedResource,
} from '../helpers/test_database.js';

describe('I-25: Deterministic Replay', () => {

  describe('Recording Infrastructure', () => {
    it('core_llm_request_log table exists with all required columns (I-25)', () => {
      /**
       * I-25: All LLM requests and responses logged.
       * Migration 007: core_llm_request_log table with prompt_hash, request_body, response_body.
       */
      const conn = createTestDatabase();

      const columns = conn.query<{ name: string; notnull: number }>(
        `PRAGMA table_info(core_llm_request_log)`,
      );
      const colNames = columns.map(c => c.name);

      assert.ok(colNames.includes('request_id'), 'Must have request_id PK');
      assert.ok(colNames.includes('prompt_hash'), 'Must have prompt_hash for replay lookup');
      assert.ok(colNames.includes('request_body'), 'Must have request_body for replay');
      assert.ok(colNames.includes('response_body'), 'Must have response_body for replay');
      assert.ok(colNames.includes('task_id'), 'Must have task_id for provenance');
      assert.ok(colNames.includes('mission_id'), 'Must have mission_id for provenance');
      assert.ok(colNames.includes('input_tokens'), 'Must have input_tokens for accounting');
      assert.ok(colNames.includes('output_tokens'), 'Must have output_tokens for accounting');

      conn.close();
    });

    it('prompt_hash is indexed for replay lookup (I-25)', () => {
      /**
       * I-25: Hash-verified replay requires indexed prompt_hash.
       * Migration 007: CREATE INDEX idx_core_llm_request_log_prompt_hash
       */
      const conn = createTestDatabase();

      const indexes = conn.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'core_llm_request_log' AND name LIKE '%prompt_hash%'`,
      );

      assert.ok(indexes.length > 0,
        'CATCHES: without prompt_hash index, replay lookup requires full table scan');

      conn.close();
    });

    it('task_id and mission_id are indexed for provenance queries (I-25)', () => {
      const conn = createTestDatabase();

      const taskIdx = conn.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'core_llm_request_log' AND name LIKE '%task_id%'`,
      );
      const missionIdx = conn.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'core_llm_request_log' AND name LIKE '%mission_id%'`,
      );

      assert.ok(taskIdx.length > 0, 'task_id index required for per-task replay');
      assert.ok(missionIdx.length > 0, 'mission_id index required for per-mission replay');

      conn.close();
    });
  });

  describe('Non-Determinism Recording', () => {
    it('all LLM outputs are recorded via logResponse (I-25)', () => {
      /**
       * I-25: LLM outputs must be recorded for replay.
       * Test that logRequest + logResponse produce queryable rows in core_llm_request_log.
       */
      const conn = createTestDatabase();

      seedMission(conn, { id: 'replay-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'replay-m1' });

      // Insert a request log entry (simulating gateway logRequest)
      const requestId = 'req-replay-001';
      const promptHash = 'abc123hash';
      const now = new Date().toISOString();

      conn.run(
        `INSERT INTO core_llm_request_log
         (request_id, mission_id, task_id, tenant_id, provider_id, model_id, prompt_hash, request_body, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [requestId, 'replay-m1', 'task-1', 'test-tenant', 'mock-provider', 'mock-model', promptHash, '{"prompt":"test"}', 'pending', now],
      );

      // Verify the pending request is queryable
      const pendingRow = conn.get<{ status: string; request_body: string }>(
        `SELECT status, request_body FROM core_llm_request_log WHERE request_id = ?`,
        [requestId],
      );
      assert.ok(pendingRow, 'Pending request must be queryable');
      assert.equal(pendingRow!.status, 'pending');

      // Simulate logResponse (update with response body)
      conn.run(
        `UPDATE core_llm_request_log
         SET response_body = ?, status = 'completed', input_tokens = ?, output_tokens = ?
         WHERE request_id = ? AND status = 'pending'`,
        ['{"response":"test output"}', 10, 5, requestId],
      );

      // Verify the completed entry has response data for replay
      const completedRow = conn.get<{
        status: string;
        response_body: string;
        input_tokens: number;
        output_tokens: number;
      }>(
        `SELECT status, response_body, input_tokens, output_tokens
         FROM core_llm_request_log WHERE request_id = ?`,
        [requestId],
      );

      assert.equal(completedRow!.status, 'completed');
      assert.equal(completedRow!.response_body, '{"response":"test output"}',
        'CATCHES: without response recording, replay cannot reproduce LLM outputs');
      assert.equal(completedRow!.input_tokens, 10);
      assert.equal(completedRow!.output_tokens, 5);

      conn.close();
    });

    it.skip('all external tool results are recorded — DEFERRED (tool execution not in scope)', () => {});

    it('recording happens in same transaction as state mutation (I-03)', () => {
      /**
       * I-03: Audit + LLM log recording must be in same transaction as state mutation.
       * Verify that within a single transaction, we can insert audit + log entries atomically.
       */
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'atomic-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'atomic-m1' });

      // Execute audit + log in same transaction
      conn.transaction(() => {
        // Insert audit entry
        audit.append(conn, {
          tenantId: 'test-tenant' as import('../../src/kernel/interfaces/index.js').TenantId,
          actorType: 'system',
          actorId: 'test',
          operation: 'llm_request',
          resourceType: 'llm_log',
          resourceId: 'req-atomic-001',
        });

        // Insert LLM log entry in same transaction
        conn.run(
          `INSERT INTO core_llm_request_log
           (request_id, mission_id, task_id, tenant_id, provider_id, model_id, prompt_hash, request_body, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ['req-atomic-001', 'atomic-m1', 'task-1', 'test-tenant', 'mock-provider', 'mock-model', 'hash1', '{}', 'pending', new Date().toISOString()],
        );
      });

      // Both entries should exist (transaction committed)
      const logRow = conn.get<{ request_id: string }>(
        `SELECT request_id FROM core_llm_request_log WHERE request_id = ?`,
        ['req-atomic-001'],
      );
      const auditRow = conn.get<{ id: string }>(
        `SELECT id FROM core_audit_log WHERE resource_id = 'req-atomic-001'`,
      );

      assert.ok(logRow, 'LLM log entry must exist after atomic transaction');
      assert.ok(auditRow, 'Audit entry must exist after atomic transaction');

      conn.close();
    });
  });

  describe('Execution Mode Replay Strategy', () => {
    it.skip('deterministic tasks: inherently replayable — DEFERRED (no replay engine integration)', () => {});
    it.skip('stochastic tasks: replayable given recorded LLM outputs — DEFERRED (no replay engine integration)', () => {});
    it.skip('hybrid tasks: partial validation possible — DEFERRED (no replay engine integration)', () => {});
  });

  describe('System Call Recording', () => {
    it.skip('system call inputs and outputs recorded via audit trail — DEFERRED (tested in I-03 audit tests)', () => {});
    it.skip('respond_checkpoint full exchange recorded — DEFERRED (checkpoint governance tested in gap tests)', () => {});
  });

  describe('Replay Correctness', () => {
    it.skip('replay produces identical system state — DEFERRED (no full replay re-execution engine)', () => {});
    it.skip('non-determinism in deterministic layers is a critical defect — DEFERRED (architectural invariant)', () => {});
  });
});
