/**
 * Limen Phase 0A — Governance Migration Verification
 * Tests the 6 governance migration files (021–026) against real SQLite.
 *
 * Phase: 0A (Foundation)
 *
 * These tests verify DDL/schema correctness. They DO NOT call the governance
 * harness. They use an in-memory SQLite database, apply governance migrations,
 * and verify the resulting schema: table existence, CHECK constraints,
 * immutability triggers, and index presence.
 *
 * NOTE: Some of these tests WILL PASS because the migration SQL is already
 * implemented. This is correct — migrations ARE implemented. The governance
 * STORES (harness) are what throws NotImplementedError. Migration DDL is real.
 *
 * For trigger tests, assert.throws IS correct because we are testing SQLite
 * trigger behavior (RAISE ABORT), not the governance harness. The trigger fires
 * on UPDATE/DELETE and raises an error. We verify the trigger error message.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { getGovernanceRunsTracesMigrations } from '../../src/governance/migration/012_governance_runs_traces.js';
import { getGovernanceContractsMigrations } from '../../src/governance/migration/013_governance_contracts.js';
import { getGovernanceSupervisorMigrations } from '../../src/governance/migration/014_governance_supervisor.js';
import { getGovernanceEvalMigrations } from '../../src/governance/migration/015_governance_eval.js';
import { getGovernanceCapabilitiesMigrations } from '../../src/governance/migration/016_governance_capabilities.js';
import { getGovernanceHandoffsIdempotencyMigrations } from '../../src/governance/migration/017_governance_handoffs_idempotency.js';
import { getSupervisorDecisionDeleteTriggerMigrations } from '../../src/governance/migration/018_supervisor_decision_delete_trigger.js';

// ─── Database factory ───

/**
 * Create an in-memory SQLite database with all 6 governance migrations applied.
 * No base (Phase 1) migrations needed — governance tables have no FKs to
 * kernel tables (INV-X08), except gov_attempts → gov_runs which is internal.
 */
function createGovDatabase(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  const allMigrations = [
    ...getGovernanceRunsTracesMigrations(),
    ...getGovernanceContractsMigrations(),
    ...getGovernanceSupervisorMigrations(),
    ...getGovernanceEvalMigrations(),
    ...getGovernanceCapabilitiesMigrations(),
    ...getGovernanceHandoffsIdempotencyMigrations(),
    ...getSupervisorDecisionDeleteTriggerMigrations(),
  ].sort((a, b) => a.version - b.version);

  for (const m of allMigrations) {
    db.exec(m.sql);
  }

  return db;
}

/**
 * Helper: Check if a table exists in the database.
 */
function tableExists(db: InstanceType<typeof Database>, tableName: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(tableName) as { name: string } | undefined;
  return row !== undefined;
}

/**
 * Helper: Check if a trigger exists in the database.
 */
function triggerExists(db: InstanceType<typeof Database>, triggerName: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?",
  ).get(triggerName) as { name: string } | undefined;
  return row !== undefined;
}

describe('Phase 0A: Governance Migration Verification', () => {

  // ════════════════════════════════════════════════════════════════════════════
  // Migration entry structure
  // ════════════════════════════════════════════════════════════════════════════

  describe('Migration entry structure', () => {
    it('each migration function returns MigrationEntry with version, name, sql, checksum', () => {
      const allFns = [
        getGovernanceRunsTracesMigrations,
        getGovernanceContractsMigrations,
        getGovernanceSupervisorMigrations,
        getGovernanceEvalMigrations,
        getGovernanceCapabilitiesMigrations,
        getGovernanceHandoffsIdempotencyMigrations,
        getSupervisorDecisionDeleteTriggerMigrations,
      ];

      for (const fn of allFns) {
        const entries = fn();
        assert.ok(entries.length > 0, `${fn.name} must return at least one migration entry`);
        for (const entry of entries) {
          assert.equal(typeof entry.version, 'number', 'version must be a number');
          assert.equal(typeof entry.name, 'string', 'name must be a string');
          assert.ok(entry.name.length > 0, 'name must not be empty');
          assert.equal(typeof entry.sql, 'string', 'sql must be a string');
          assert.ok(entry.sql.length > 0, 'sql must not be empty');
          assert.equal(typeof entry.checksum, 'string', 'checksum must be a string');
          assert.ok(entry.checksum.length === 64, 'checksum must be SHA-256 hex (64 chars)');
        }
      }
    });

    it('migration versions are sequential: 21, 22, 23, 24, 25, 26', () => {
      const versions = [
        ...getGovernanceRunsTracesMigrations(),
        ...getGovernanceContractsMigrations(),
        ...getGovernanceSupervisorMigrations(),
        ...getGovernanceEvalMigrations(),
        ...getGovernanceCapabilitiesMigrations(),
        ...getGovernanceHandoffsIdempotencyMigrations(),
      ].map(m => m.version).sort((a, b) => a - b);

      assert.deepEqual(versions, [21, 22, 23, 24, 25, 26]);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Table existence (9 tables across 6 migrations)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Table existence', () => {
    // All table tests use a shared database since they are read-only checks
    const db = createGovDatabase();

    it('1. Migration 021: gov_runs table exists', () => {
      assert.ok(tableExists(db, 'gov_runs'), 'gov_runs table must exist after migration 021');
    });

    it('2. Migration 021: gov_attempts table exists', () => {
      assert.ok(tableExists(db, 'gov_attempts'), 'gov_attempts table must exist after migration 021');
    });

    it('3. Migration 021: obs_trace_events table exists', () => {
      assert.ok(tableExists(db, 'obs_trace_events'), 'obs_trace_events table must exist after migration 021');
    });

    it('4. Migration 022: gov_mission_contracts table exists', () => {
      assert.ok(tableExists(db, 'gov_mission_contracts'), 'gov_mission_contracts table must exist after migration 022');
    });

    it('5. Migration 023: gov_supervisor_decisions table exists', () => {
      assert.ok(tableExists(db, 'gov_supervisor_decisions'), 'gov_supervisor_decisions table must exist after migration 023');
    });

    it('6. Migration 023: gov_suspension_records table exists', () => {
      assert.ok(tableExists(db, 'gov_suspension_records'), 'gov_suspension_records table must exist after migration 023');
    });

    it('7. Migration 024: gov_eval_cases table exists', () => {
      assert.ok(tableExists(db, 'gov_eval_cases'), 'gov_eval_cases table must exist after migration 024');
    });

    it('8. Migration 025: gov_capability_manifests table exists', () => {
      assert.ok(tableExists(db, 'gov_capability_manifests'), 'gov_capability_manifests table must exist after migration 025');
    });

    it('9. Migration 026: gov_handoffs table exists', () => {
      assert.ok(tableExists(db, 'gov_handoffs'), 'gov_handoffs table must exist after migration 026');
    });

    it('10. Migration 026: gov_idempotency_keys table exists', () => {
      assert.ok(tableExists(db, 'gov_idempotency_keys'), 'gov_idempotency_keys table must exist after migration 026');
    });

    it('11. Migration 026: gov_resume_tokens table exists', () => {
      assert.ok(tableExists(db, 'gov_resume_tokens'), 'gov_resume_tokens table must exist after migration 026');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // CHECK constraints
  // ════════════════════════════════════════════════════════════════════════════

  describe('CHECK constraints', () => {
    it('12. gov_runs: state CHECK rejects invalid value', () => {
      const db = createGovDatabase();
      assert.throws(
        () => db.exec(
          `INSERT INTO gov_runs (run_id, tenant_id, mission_id, state, started_at, schema_version, origin)
           VALUES ('run-chk-001', 'tenant-1', 'mission-1', 'bogus', '2026-01-01T00:00:00Z', '0.1.0', 'runtime')`,
        ),
        (err: Error) => {
          // SQLite CHECK constraint failure
          return err.message.includes('CHECK') || err.message.includes('constraint');
        },
        'Invalid state value must be rejected by CHECK constraint',
      );
    });

    it('13. gov_attempts: state CHECK rejects invalid value', () => {
      const db = createGovDatabase();
      // First insert a valid run (FK reference for gov_attempts.run_id)
      db.exec(
        `INSERT INTO gov_runs (run_id, tenant_id, mission_id, state, started_at, schema_version, origin)
         VALUES ('run-chk-att-001', 'tenant-1', 'mission-1', 'active', '2026-01-01T00:00:00Z', '0.1.0', 'runtime')`,
      );
      assert.throws(
        () => db.exec(
          `INSERT INTO gov_attempts (attempt_id, task_id, mission_id, run_id, state, pinned_versions, schema_version, origin, created_at)
           VALUES ('att-chk-001', 'task-1', 'mission-1', 'run-chk-att-001', 'invalid_state', '{}', '0.1.0', 'runtime', '2026-01-01T00:00:00Z')`,
        ),
        (err: Error) => err.message.includes('CHECK') || err.message.includes('constraint'),
        'Invalid attempt state must be rejected by CHECK constraint',
      );
    });

    it('14. gov_capability_manifests: trust_tier CHECK rejects invalid value', () => {
      const db = createGovDatabase();
      assert.throws(
        () => db.exec(
          `INSERT INTO gov_capability_manifests (manifest_id, capability_type, trust_tier, side_effect_class, secret_requirements, schema_version, created_at)
           VALUES ('cap-chk-001', 'test_cap', 'bogus-tier', 'none', '[]', '0.1.0', '2026-01-01T00:00:00Z')`,
        ),
        (err: Error) => err.message.includes('CHECK') || err.message.includes('constraint'),
        'Invalid trust_tier must be rejected by CHECK constraint',
      );
    });

    it('15. gov_capability_manifests: side_effect_class CHECK rejects invalid value', () => {
      const db = createGovDatabase();
      assert.throws(
        () => db.exec(
          `INSERT INTO gov_capability_manifests (manifest_id, capability_type, trust_tier, side_effect_class, secret_requirements, schema_version, created_at)
           VALUES ('cap-chk-002', 'test_cap_2', 'sandboxed-local', 'bogus-side-effect', '[]', '0.1.0', '2026-01-01T00:00:00Z')`,
        ),
        (err: Error) => err.message.includes('CHECK') || err.message.includes('constraint'),
        'Invalid side_effect_class must be rejected by CHECK constraint',
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Immutability triggers
  // ════════════════════════════════════════════════════════════════════════════

  describe('Immutability triggers', () => {
    it('16. INV-020: obs_trace_events rejects UPDATE', () => {
      const db = createGovDatabase();
      // First insert a valid run for the run_id reference
      db.exec(
        `INSERT INTO gov_runs (run_id, tenant_id, mission_id, state, started_at, schema_version, origin)
         VALUES ('run-trig-001', 'tenant-1', 'mission-1', 'active', '2026-01-01T00:00:00Z', '0.1.0', 'runtime')`,
      );
      // Insert a valid trace event
      db.exec(
        `INSERT INTO obs_trace_events (trace_event_id, run_id, run_seq, span_seq, correlation_id, version, type, tenant_id, timestamp, payload)
         VALUES ('evt-trig-001', 'run-trig-001', 1, 1, 'corr-1', '1.0.0', 'mission.created', 'tenant-1', '2026-01-01T00:00:00Z', '{}')`,
      );
      // Attempt UPDATE — trigger should fire
      assert.throws(
        () => db.exec(`UPDATE obs_trace_events SET type = 'changed' WHERE trace_event_id = 'evt-trig-001'`),
        (err: Error) => err.message.includes('INV-020'),
        'obs_trace_events UPDATE trigger must fire with INV-020 message',
      );
    });

    it('17. INV-020: obs_trace_events rejects DELETE', () => {
      const db = createGovDatabase();
      db.exec(
        `INSERT INTO gov_runs (run_id, tenant_id, mission_id, state, started_at, schema_version, origin)
         VALUES ('run-trig-002', 'tenant-1', 'mission-1', 'active', '2026-01-01T00:00:00Z', '0.1.0', 'runtime')`,
      );
      db.exec(
        `INSERT INTO obs_trace_events (trace_event_id, run_id, run_seq, span_seq, correlation_id, version, type, tenant_id, timestamp, payload)
         VALUES ('evt-trig-002', 'run-trig-002', 1, 1, 'corr-2', '1.0.0', 'mission.created', 'tenant-1', '2026-01-01T00:00:00Z', '{}')`,
      );
      // Attempt DELETE — trigger should fire
      assert.throws(
        () => db.exec(`DELETE FROM obs_trace_events WHERE trace_event_id = 'evt-trig-002'`),
        (err: Error) => err.message.includes('INV-020'),
        'obs_trace_events DELETE trigger must fire with INV-020 message',
      );
    });

    it('18. BC-033: gov_mission_contracts rejects UPDATE', () => {
      const db = createGovDatabase();
      db.exec(
        `INSERT INTO gov_mission_contracts (contract_id, tenant_id, mission_id, criteria, schema_version, created_at)
         VALUES ('con-trig-001', 'tenant-1', 'mission-1', '[{"description":"c1","evaluationMethod":"auto","required":true}]', '0.1.0', '2026-01-01T00:00:00Z')`,
      );
      assert.throws(
        () => db.exec(`UPDATE gov_mission_contracts SET criteria = '[]' WHERE contract_id = 'con-trig-001'`),
        (err: Error) => err.message.includes('BC-033'),
        'gov_mission_contracts UPDATE trigger must fire with BC-033 message',
      );
    });

    it('19. BC-090: gov_eval_cases rejects UPDATE', () => {
      const db = createGovDatabase();
      db.exec(
        `INSERT INTO gov_eval_cases (eval_case_id, tenant_id, attempt_id, dimensions, provenance, pinned_versions, schema_version, created_at)
         VALUES ('eval-trig-001', 'tenant-1', 'attempt-1', '[]', '{"evalSchemaVersion":"0.1.0"}', '{"traceGrammarVersion":"1.0.0","evalSchemaVersion":"1.0.0","missionContractVersion":"1.0.0"}', '0.1.0', '2026-01-01T00:00:00Z')`,
      );
      assert.throws(
        () => db.exec(`UPDATE gov_eval_cases SET contract_satisfaction = 0 WHERE eval_case_id = 'eval-trig-001'`),
        (err: Error) => err.message.includes('BC-090'),
        'gov_eval_cases UPDATE trigger must fire with BC-090 message',
      );
    });

    it('20. BC-139: gov_resume_tokens rejects DELETE', () => {
      const db = createGovDatabase();
      db.exec(
        `INSERT INTO gov_resume_tokens (token_hash, tenant_id, suspension_record_id, decision_id, expires_at, consumed, created_at)
         VALUES ('hash-trig-001', 'tenant-1', 'susp-1', 'dec-1', '2027-01-01T00:00:00Z', 0, '2026-01-01T00:00:00Z')`,
      );
      assert.throws(
        () => db.exec(`DELETE FROM gov_resume_tokens WHERE token_hash = 'hash-trig-001'`),
        (err: Error) => err.message.includes('BC-139'),
        'gov_resume_tokens DELETE trigger must fire with BC-139 message',
      );
    });

    it('21. BRK-003/BC-060: gov_supervisor_decisions rejects DELETE', () => {
      const db = createGovDatabase();
      db.exec(
        `INSERT INTO gov_supervisor_decisions (decision_id, tenant_id, correlation_id, supervisor_type, outcome, schema_version, created_at)
         VALUES ('dec-trig-001', 'tenant-1', 'corr-1', 'human-supervisor', 'approve', '0.1.0', '2026-01-01T00:00:00Z')`,
      );
      // Attempt DELETE — trigger should fire (BRK-003 fix)
      assert.throws(
        () => db.exec(`DELETE FROM gov_supervisor_decisions WHERE decision_id = 'dec-trig-001'`),
        (err: Error) => err.message.includes('BC-060'),
        'gov_supervisor_decisions DELETE trigger must fire with BC-060 message',
      );
      // Verify the decision still exists after rejected DELETE
      const row = db.prepare('SELECT decision_id FROM gov_supervisor_decisions WHERE decision_id = ?').get('dec-trig-001');
      assert.ok(row, 'Decision must still exist after rejected DELETE');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Additional schema verification
  // ════════════════════════════════════════════════════════════════════════════

  describe('Trigger existence', () => {
    const db = createGovDatabase();

    it('obs_trace_events_no_update trigger exists', () => {
      assert.ok(triggerExists(db, 'obs_trace_events_no_update'));
    });

    it('obs_trace_events_no_delete trigger exists', () => {
      assert.ok(triggerExists(db, 'obs_trace_events_no_delete'));
    });

    it('gov_mission_contracts_no_update trigger exists', () => {
      assert.ok(triggerExists(db, 'gov_mission_contracts_no_update'));
    });

    it('gov_mission_contracts_no_delete trigger exists', () => {
      assert.ok(triggerExists(db, 'gov_mission_contracts_no_delete'));
    });

    it('gov_eval_cases_no_update trigger exists', () => {
      assert.ok(triggerExists(db, 'gov_eval_cases_no_update'));
    });

    it('gov_eval_cases_no_delete trigger exists', () => {
      assert.ok(triggerExists(db, 'gov_eval_cases_no_delete'));
    });

    it('gov_capability_manifests_no_update trigger exists', () => {
      assert.ok(triggerExists(db, 'gov_capability_manifests_no_update'));
    });

    it('gov_capability_manifests_no_delete trigger exists', () => {
      assert.ok(triggerExists(db, 'gov_capability_manifests_no_delete'));
    });

    it('gov_resume_tokens_no_delete trigger exists', () => {
      assert.ok(triggerExists(db, 'gov_resume_tokens_no_delete'));
    });

    it('gov_supervisor_decisions_no_update trigger exists', () => {
      assert.ok(triggerExists(db, 'gov_supervisor_decisions_no_update'));
    });

    it('gov_supervisor_decisions_no_delete trigger exists (BRK-003)', () => {
      assert.ok(triggerExists(db, 'gov_supervisor_decisions_no_delete'));
    });
  });

  describe('UNIQUE constraints', () => {
    it('obs_trace_events: (run_id, run_seq) uniqueness enforced (INV-021)', () => {
      const db = createGovDatabase();
      db.exec(
        `INSERT INTO gov_runs (run_id, tenant_id, mission_id, state, started_at, schema_version, origin)
         VALUES ('run-uniq-001', 'tenant-1', 'mission-1', 'active', '2026-01-01T00:00:00Z', '0.1.0', 'runtime')`,
      );
      db.exec(
        `INSERT INTO obs_trace_events (trace_event_id, run_id, run_seq, span_seq, correlation_id, version, type, tenant_id, timestamp, payload)
         VALUES ('evt-uniq-001', 'run-uniq-001', 1, 1, 'corr-1', '1.0.0', 'mission.created', 'tenant-1', '2026-01-01T00:00:00Z', '{}')`,
      );
      // Attempt duplicate (run_id, run_seq)
      assert.throws(
        () => db.exec(
          `INSERT INTO obs_trace_events (trace_event_id, run_id, run_seq, span_seq, correlation_id, version, type, tenant_id, timestamp, payload)
           VALUES ('evt-uniq-002', 'run-uniq-001', 1, 2, 'corr-2', '1.0.0', 'mission.transition', 'tenant-1', '2026-01-01T00:00:01Z', '{}')`,
        ),
        (err: Error) => err.message.includes('UNIQUE'),
        'Duplicate (run_id, run_seq) must be rejected by UNIQUE constraint (INV-021)',
      );
    });

    it('gov_capability_manifests: capability_type UNIQUE enforced', () => {
      const db = createGovDatabase();
      db.exec(
        `INSERT INTO gov_capability_manifests (manifest_id, capability_type, trust_tier, side_effect_class, secret_requirements, schema_version, created_at)
         VALUES ('cap-uniq-001', 'web_search', 'sandboxed-local', 'none', '[]', '0.1.0', '2026-01-01T00:00:00Z')`,
      );
      assert.throws(
        () => db.exec(
          `INSERT INTO gov_capability_manifests (manifest_id, capability_type, trust_tier, side_effect_class, secret_requirements, schema_version, created_at)
           VALUES ('cap-uniq-002', 'web_search', 'remote-tenant', 'idempotent', '[]', '0.1.0', '2026-01-01T00:00:00Z')`,
        ),
        (err: Error) => err.message.includes('UNIQUE'),
        'Duplicate capability_type must be rejected by UNIQUE constraint',
      );
    });
  });

  describe('Foreign key constraints', () => {
    it('gov_attempts.run_id references gov_runs.run_id', () => {
      const db = createGovDatabase();
      // Attempt to insert an attempt referencing a non-existent run
      assert.throws(
        () => db.exec(
          `INSERT INTO gov_attempts (attempt_id, task_id, mission_id, run_id, state, pinned_versions, schema_version, origin, created_at)
           VALUES ('att-fk-001', 'task-1', 'mission-1', 'nonexistent-run', 'started', '{}', '0.1.0', 'runtime', '2026-01-01T00:00:00Z')`,
        ),
        (err: Error) => err.message.includes('FOREIGN KEY'),
        'gov_attempts must have FK constraint to gov_runs',
      );
    });
  });
});
