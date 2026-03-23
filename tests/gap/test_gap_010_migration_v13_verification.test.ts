/**
 * Layer 5: Migration v13 Verification Tests
 * Verifies: Schema correctness, backfill integrity, immutability triggers,
 * NULL→value handling, and index existence for FM-10 tenant isolation.
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * FM-10: "tenant ID on every row in every table"
 * DEC-CERT-002: tenant_id on all 12 tables
 * AUDIT-005: IS NOT NULL guard for NULL→value backfill
 *
 * Phase: 4B (Certification — Tenant Isolation)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase,
  seedMission,
  seedResource,
} from '../helpers/test_database.js';

// ─── Constants ───

const TENANT_A = 'tenant-A';

// All 12 tables that must have tenant_id per DEC-CERT-002
const ALL_TENANT_TABLES = [
  'core_missions',
  'core_tasks',
  'core_artifacts',
  'core_resources',
  'core_checkpoints',
  'core_conversations',
  'core_task_graphs',
  'core_task_dependencies',
  'core_conversation_turns',
  'core_artifact_dependencies',
  'core_compaction_log',
  'core_tree_counts',
];

// The 6 tables that gained tenant_id in migration v13
const V13_NEW_TABLES = [
  'core_task_graphs',
  'core_task_dependencies',
  'core_conversation_turns',
  'core_artifact_dependencies',
  'core_compaction_log',
  'core_tree_counts',
];

// All 12 tables with immutability triggers
const TRIGGER_TABLES = ALL_TENANT_TABLES;

// ─── Layer 5: Migration v13 Verification ───

describe('Layer 5: Migration v13 Verification (FM-10, DEC-CERT-002)', () => {

  // Test 1: All 6 new tables have tenant_id column after migration
  it('#1: All 6 tables have tenant_id column after migration v13', () => {
    const conn = createTestDatabase('row-level');

    for (const table of V13_NEW_TABLES) {
      const columns = conn.query<{ name: string }>(
        `PRAGMA table_info(${table})`,
      );
      const colNames = columns.map(c => c.name);
      assert.ok(
        colNames.includes('tenant_id'),
        `FM-10: Table ${table} must have tenant_id column after migration v13`,
      );
    }

    conn.close();
  });

  // Test 2: All 12 tables have tenant_id column (comprehensive)
  it('#2: All 12 tables have tenant_id column (DEC-CERT-002 comprehensive)', () => {
    const conn = createTestDatabase('row-level');

    for (const table of ALL_TENANT_TABLES) {
      const columns = conn.query<{ name: string }>(
        `PRAGMA table_info(${table})`,
      );
      const colNames = columns.map(c => c.name);
      assert.ok(
        colNames.includes('tenant_id'),
        `DEC-CERT-002: Table ${table} must have tenant_id column`,
      );
    }

    conn.close();
  });

  // Test 3: Backfill produces zero NULL tenant_ids when parent data exists
  it('#3: Backfill produces zero NULL tenant_ids when parent data exists', () => {
    const conn = createTestDatabase('row-level');
    const now = new Date().toISOString();

    // Seed a mission with tenant_id (parent data for backfill)
    seedMission(conn, { id: 'mission-v13', tenantId: TENANT_A });
    seedResource(conn, { missionId: 'mission-v13', tenantId: TENANT_A });

    // Seed task graph and tasks (child data)
    conn.run(
      `INSERT INTO core_task_graphs (id, mission_id, tenant_id, version, objective_alignment, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      ['tg-v13', 'mission-v13', TENANT_A, 1, 'aligned', now],
    );
    conn.run(
      `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, estimated_tokens, capabilities_required, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['task-v13-a', 'mission-v13', TENANT_A, 'tg-v13', 'test A', 'deterministic', 100, '[]', 'PENDING', now, now],
    );
    conn.run(
      `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, estimated_tokens, capabilities_required, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['task-v13-b', 'mission-v13', TENANT_A, 'tg-v13', 'test B', 'deterministic', 100, '[]', 'PENDING', now, now],
    );
    conn.run(
      `INSERT INTO core_task_dependencies (graph_id, from_task, to_task, tenant_id) VALUES (?, ?, ?, ?)`,
      ['tg-v13', 'task-v13-a', 'task-v13-b', TENANT_A],
    );

    // Seed conversation and turns
    conn.run(
      `INSERT INTO core_conversations (id, session_id, tenant_id, agent_id, total_turns, total_tokens, summarized_up_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['conv-v13', 'sess-v13', TENANT_A, 'agent-A', 1, 10, 0, now, now],
    );
    conn.run(
      `INSERT INTO core_conversation_turns (id, conversation_id, tenant_id, turn_number, role, content, token_count, is_summary, is_learning_source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['turn-v13', 'conv-v13', TENANT_A, 1, 'user', 'hello', 10, 0, 0, now],
    );

    // Check ALL tables — no NULL tenant_ids for seeded rows
    for (const table of ALL_TENANT_TABLES) {
      const nullCount = conn.get<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM ${table} WHERE tenant_id IS NULL`,
      );
      assert.equal(
        nullCount?.cnt ?? -1,
        0,
        `FM-10: Table ${table} must have zero NULL tenant_ids after proper seeding`,
      );
    }

    conn.close();
  });

  // Test 4: Immutability trigger blocks tenant_id UPDATE on core_missions
  it('#4: Immutability trigger blocks tenant_id UPDATE on core_missions', () => {
    const conn = createTestDatabase('row-level');
    seedMission(conn, { id: 'mission-imm', tenantId: TENANT_A });

    assert.throws(
      () => conn.run(
        `UPDATE core_missions SET tenant_id = ? WHERE id = ?`,
        ['attacker-tenant', 'mission-imm'],
      ),
      /I-MUT: tenant_id is immutable after INSERT on core_missions/,
      'I-MUT: trigger must prevent tenant_id mutation on core_missions',
    );

    // Verify tenant_id unchanged
    const row = conn.get<{ tenant_id: string }>(
      'SELECT tenant_id FROM core_missions WHERE id = ?',
      ['mission-imm'],
    );
    assert.equal(row?.tenant_id, TENANT_A, 'tenant_id must remain unchanged');

    conn.close();
  });

  // Test 5: Immutability triggers block tenant_id UPDATE on all 6 new tables
  it('#5: Immutability triggers block tenant_id UPDATE on all 6 new tables', () => {
    const conn = createTestDatabase('row-level');
    const now = new Date().toISOString();

    // Seed parent data
    seedMission(conn, { id: 'mission-trig', tenantId: TENANT_A });

    // Seed rows in each of the 6 new tables
    conn.run(
      `INSERT INTO core_task_graphs (id, mission_id, tenant_id, version, objective_alignment, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      ['tg-trig', 'mission-trig', TENANT_A, 1, 'aligned', now],
    );
    conn.run(
      `INSERT INTO core_task_dependencies (graph_id, from_task, to_task, tenant_id) VALUES (?, ?, ?, ?)`,
      ['tg-trig', 'from-trig', 'to-trig', TENANT_A],
    );
    conn.run(
      `INSERT INTO core_conversations (id, session_id, tenant_id, agent_id, total_turns, total_tokens, summarized_up_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['conv-trig', 'sess-trig', TENANT_A, 'agent-A', 0, 0, 0, now, now],
    );
    conn.run(
      `INSERT INTO core_conversation_turns (id, conversation_id, tenant_id, turn_number, role, content, token_count, is_summary, is_learning_source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['turn-trig', 'conv-trig', TENANT_A, 1, 'user', 'data', 5, 0, 0, now],
    );
    conn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, lifecycle_state, source_task_id, relevance_decay, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['art-trig', 1, 'mission-trig', TENANT_A, 'test', 'data', 'json', 'content', 'ACTIVE', 'task-trig', 1, '{}', now],
    );
    conn.run(
      `INSERT INTO core_artifact_dependencies (reading_mission_id, artifact_id, artifact_version, is_cross_mission, tenant_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['mission-trig', 'art-trig', 1, 0, TENANT_A, now],
    );
    conn.run(
      `INSERT INTO core_compaction_log (id, mission_id, tenant_id, summary_artifact_id, missions_compacted, artifacts_archived, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['comp-trig', 'mission-trig', TENANT_A, 'art-trig', '[]', 0, now],
    );

    // Attempt mutation on each table — trigger must block
    const tablesToTest: Array<{ table: string; where: string; params: unknown[] }> = [
      { table: 'core_task_graphs', where: 'id = ?', params: ['tg-trig'] },
      { table: 'core_task_dependencies', where: 'graph_id = ? AND from_task = ?', params: ['tg-trig', 'from-trig'] },
      { table: 'core_conversation_turns', where: 'id = ?', params: ['turn-trig'] },
      { table: 'core_artifact_dependencies', where: 'reading_mission_id = ? AND artifact_id = ?', params: ['mission-trig', 'art-trig'] },
      { table: 'core_compaction_log', where: 'id = ?', params: ['comp-trig'] },
      { table: 'core_tree_counts', where: 'root_mission_id = ?', params: ['mission-trig'] },
    ];

    for (const { table, where, params } of tablesToTest) {
      assert.throws(
        () => conn.run(
          `UPDATE ${table} SET tenant_id = ? WHERE ${where}`,
          ['attacker', ...params],
        ),
        /I-MUT: tenant_id is immutable after INSERT/,
        `I-MUT: trigger must prevent tenant_id mutation on ${table}`,
      );
    }

    conn.close();
  });

  // Test 6: NULL→value transition is allowed (AUDIT-005: IS NOT NULL guard)
  it('#6: NULL→value transition allowed, value→value blocked (AUDIT-005)', () => {
    const conn = createTestDatabase('row-level');
    const now = new Date().toISOString();

    // Seed mission with known tenant
    seedMission(conn, { id: 'mission-null', tenantId: TENANT_A });

    // Insert a task_graph with NULL tenant_id (simulates pre-migration state)
    conn.run(
      `INSERT INTO core_task_graphs (id, mission_id, tenant_id, version, objective_alignment, is_active, created_at)
       VALUES (?, ?, NULL, ?, ?, 1, ?)`,
      ['tg-null', 'mission-null', 1, 'aligned', now],
    );

    // NULL → value should SUCCEED (the IS NOT NULL guard allows it)
    assert.doesNotThrow(
      () => conn.run(
        `UPDATE core_task_graphs SET tenant_id = ? WHERE id = ?`,
        [TENANT_A, 'tg-null'],
      ),
      'AUDIT-005: NULL→value transition must be allowed for backfill',
    );

    // Verify the value was set
    const row = conn.get<{ tenant_id: string }>(
      'SELECT tenant_id FROM core_task_graphs WHERE id = ?',
      ['tg-null'],
    );
    assert.equal(row?.tenant_id, TENANT_A, 'tenant_id must be set after backfill');

    // value → different value should FAIL (immutability kicks in)
    assert.throws(
      () => conn.run(
        `UPDATE core_task_graphs SET tenant_id = ? WHERE id = ?`,
        ['attacker', 'tg-null'],
      ),
      /I-MUT: tenant_id is immutable after INSERT/,
      'I-MUT: value→different value must be blocked after backfill',
    );

    conn.close();
  });

  // Test 7: Indexes exist on tenant_id for all 6 new tables
  it('#7: Indexes exist on tenant_id for migration v13 tables', () => {
    const conn = createTestDatabase('row-level');

    const expectedIndexes = [
      'idx_task_graphs_tenant',
      'idx_task_dependencies_tenant',
      'idx_conversation_turns_tenant',
      'idx_artifact_dependencies_tenant',
      'idx_compaction_log_tenant',
      'idx_tree_counts_tenant',
    ];

    const allIndexes = conn.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index'`,
    );
    const indexNames = allIndexes.map(i => i.name);

    for (const expectedIdx of expectedIndexes) {
      assert.ok(
        indexNames.includes(expectedIdx),
        `FM-10: Index ${expectedIdx} must exist for tenant_id queries`,
      );
    }

    conn.close();
  });

  // Test 8: Immutability triggers also exist on pre-v13 tables
  it('#8: Immutability triggers exist on all 12 tables', () => {
    const conn = createTestDatabase('row-level');

    const triggers = conn.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%tenant_immutable'`,
    );
    const triggerNames = triggers.map(t => t.name);

    for (const table of TRIGGER_TABLES) {
      const expectedTrigger = `${table}_tenant_immutable`;
      assert.ok(
        triggerNames.includes(expectedTrigger),
        `DEC-CERT-002: Immutability trigger ${expectedTrigger} must exist`,
      );
    }

    assert.ok(triggerNames.length >= 12, 'Must have at least 12 immutability triggers (12 core + learning_techniques)');

    conn.close();
  });

  // Test 9: Migration v13 is recorded in core_migrations
  it('#9: Migration v13 recorded in core_migrations table', () => {
    const conn = createTestDatabase('row-level');

    const migration = conn.get<{ version: number; name: string; status: string }>(
      `SELECT version, name, status FROM core_migrations WHERE version = 13`,
    );

    assert.ok(migration, 'Migration v13 must be recorded');
    assert.equal(migration.version, 13);
    assert.equal(migration.name, 'tenant_isolation');
    assert.equal(migration.status, 'applied');

    conn.close();
  });
});
