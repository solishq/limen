/**
 * Test Database Harness for Limen v1.0
 * Phase 4A-1: Foundation for all behavioral verification tests.
 *
 * Provides:
 * - createTestDatabase(): In-memory SQLite with full schema (all 12 migrations)
 * - createTestOrchestrationDeps(): OrchestrationDeps with real conn + audit, stubbed substrate
 * - createTestOperationContext(): OperationContext with configurable branded IDs
 * - Seed helpers for creating missions, tasks, artifacts at known states
 *
 * Design: Uses better-sqlite3 directly (same as production) with :memory: for speed.
 * All PRAGMAs match production. Migrations run inline (no lifecycle wrapper needed
 * since :memory: databases don't persist and don't need the openDatabases tracking).
 *
 * S ref: I-05 (transactional consistency in tests), I-03 (atomic audit in tests)
 */

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { getPhase1Migrations } from '../../src/kernel/database/migrations.js';
import { getPhase2Migrations } from '../../src/substrate/migration/002_substrate.js';
import { getPhase3Migrations } from '../../src/orchestration/migration/003_orchestration.js';
import { getPhase4BMigrations } from '../../src/orchestration/migration/004_tenant_isolation.js';
import { getPhase4D2ImmutabilityMigrations } from '../../src/orchestration/migration/005_immutability_triggers.js';
import { getPhase4D4TombstoneMigrations } from '../../src/orchestration/migration/006_audit_tombstone.js';
import { getPhase4E2aTechniquesMigration } from '../../src/learning/migration/007_learning_techniques.js';
import { getPhase4E2dOutcomesMigration } from '../../src/learning/migration/008_learning_outcomes.js';
import { getPhase4E2cApplicationsMigration } from '../../src/learning/migration/009_learning_applications.js';
import { getPhase4E2eQuarantineMigration } from '../../src/learning/migration/010_learning_quarantine.js';
import { getPhase4E2eTransferMigration } from '../../src/learning/migration/011_learning_transfers.js';
import { getGovernanceRunsTracesMigrations } from '../../src/governance/migration/012_governance_runs_traces.js';
import { getGovernanceContractsMigrations } from '../../src/governance/migration/013_governance_contracts.js';
import { getGovernanceSupervisorMigrations } from '../../src/governance/migration/014_governance_supervisor.js';
import { getGovernanceEvalMigrations } from '../../src/governance/migration/015_governance_eval.js';
import { getGovernanceCapabilitiesMigrations } from '../../src/governance/migration/016_governance_capabilities.js';
import { getGovernanceHandoffsIdempotencyMigrations } from '../../src/governance/migration/017_governance_handoffs_idempotency.js';
import { getSupervisorDecisionDeleteTriggerMigrations } from '../../src/governance/migration/018_supervisor_decision_delete_trigger.js';
import { getCcpClaimsMigrations } from '../../src/claims/migration/019_ccp_claims.js';
import { getTgpGovernanceMigration } from '../../src/techniques/migration/020_tgp_governance.js';
import { getWmpMigrations } from '../../src/working-memory/migration/021_wmp.js';
import { getTransportDeliberationMigration } from '../../src/substrate/migration/022_transport_deliberation.js';
import { getAgentPersistenceMigrations } from '../../src/api/migration/023_agent_persistence.js';
import { getTrustLearningMigrations } from '../../src/api/migration/024_trust_learning.js';
import { getKnowledgeGraphMigrations } from '../../src/api/migration/025_knowledge_graph.js';
import { getReplayPipelineMigrations } from '../../src/api/migration/026_replay_pipeline.js';
import { createAuditTrail } from '../../src/kernel/audit/audit_trail.js';
import { createTenantScopedConnection } from '../../src/kernel/tenant/tenant_scope.js';
import type {
  DatabaseConnection, RunResult, Result,
  TenantId, UserId, AgentId, MissionId, TaskId, SessionId,
  Permission, OperationContext, AuditTrail, TenancyConfig, TimeProvider,
} from '../../src/kernel/interfaces/index.js';
import type { OrchestrationDeps } from '../../src/orchestration/interfaces/orchestration.js';
import type { OrchestrationTransitionService } from '../../src/orchestration/transitions/transition_service.js';
import { createOrchestrationTransitionService } from '../../src/orchestration/transitions/transition_service.js';
import type { TransitionEnforcer } from '../../src/kernel/interfaces/lifecycle.js';

// ─── Branded type constructors for tests ───

export function tenantId(id: string): TenantId {
  return id as TenantId;
}

export function userId(id: string): UserId {
  return id as UserId;
}

export function agentId(id: string): AgentId {
  return id as AgentId;
}

export function missionId(id: string): MissionId {
  return id as MissionId;
}

export function taskId(id: string): TaskId {
  return id as TaskId;
}

export function sessionId(id: string): SessionId {
  return id as SessionId;
}

// ─── SHA-256 helper (matches production crypto engine) ───

export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

// ─── DatabaseConnection factory ───

/**
 * Create an in-memory SQLite database with the full Limen schema.
 * All 12 migrations applied (Phase 1 kernel + Phase 2 substrate + Phase 3 orchestration).
 * PRAGMAs match production: WAL mode, foreign_keys ON, synchronous NORMAL.
 * Triggers included (audit immutability, etc.).
 *
 * @param tenancyMode - Tenancy mode for the connection (default: 'single')
 * @returns DatabaseConnection wrapping the in-memory database
 */
export function createTestDatabase(tenancyMode: TenancyConfig['mode'] = 'single'): DatabaseConnection {
  const db = new Database(':memory:');

  // Match production PRAGMAs (database_lifecycle.ts lines 157-166)
  // Note: WAL mode is not supported for :memory: databases, SQLite falls back to 'memory' journal
  // This is acceptable for tests — the schema and triggers are identical.
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  // Create migrations tracking table (matches database_lifecycle.ts lines 116-127)
  db.exec(`
    CREATE TABLE IF NOT EXISTS core_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT    NOT NULL,
      checksum    TEXT    NOT NULL,
      applied_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      duration_ms INTEGER NOT NULL DEFAULT 0,
      status      TEXT    NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','failed'))
    );
  `);

  // Apply all migrations in order
  const allMigrations = [
    ...getPhase1Migrations(),
    ...getPhase2Migrations(),
    ...getPhase3Migrations(),
    ...getPhase4BMigrations(),
    ...getPhase4D2ImmutabilityMigrations(),
    ...getPhase4D4TombstoneMigrations(),
    ...getPhase4E2aTechniquesMigration(),
    ...getPhase4E2dOutcomesMigration(),
    ...getPhase4E2cApplicationsMigration(),
    ...getPhase4E2eQuarantineMigration(),
    ...getPhase4E2eTransferMigration(),
    ...getGovernanceRunsTracesMigrations(),
    ...getGovernanceContractsMigrations(),
    ...getGovernanceSupervisorMigrations(),
    ...getGovernanceEvalMigrations(),
    ...getGovernanceCapabilitiesMigrations(),
    ...getGovernanceHandoffsIdempotencyMigrations(),
    ...getSupervisorDecisionDeleteTriggerMigrations(),
    ...getCcpClaimsMigrations(),
    ...getTgpGovernanceMigration(),
    ...getWmpMigrations(),
    ...getTransportDeliberationMigration(),
    ...getAgentPersistenceMigrations(),
    ...getTrustLearningMigrations(),
    ...getKnowledgeGraphMigrations(),
    ...getReplayPipelineMigrations(),
  ].sort((a, b) => a.version - b.version);

  // Create audit_trail view aliasing core_audit_log (tests reference audit_trail)
  db.exec('CREATE VIEW IF NOT EXISTS audit_trail AS SELECT * FROM core_audit_log');

  for (const migration of allMigrations) {
    db.exec(migration.sql);
    db.prepare(
      `INSERT INTO core_migrations (version, name, checksum) VALUES (?, ?, ?)`
    ).run(migration.version, migration.name, migration.checksum);
  }

  // Wrap in DatabaseConnection interface (matches database_lifecycle.ts lines 38-94)
  const conn: DatabaseConnection = {
    dataDir: ':memory:',
    schemaVersion: allMigrations[allMigrations.length - 1]?.version ?? 0,
    tenancyMode,

    transaction<T>(fn: () => T): T {
      const txn = db.transaction(fn);
      return txn();
    },

    run(sql: string, params?: unknown[]): RunResult {
      const stmt = db.prepare(sql);
      const result = params ? stmt.run(...params) : stmt.run();
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    },

    query<T>(sql: string, params?: unknown[]): T[] {
      const stmt = db.prepare(sql);
      return (params ? stmt.all(...params) : stmt.all()) as T[];
    },

    get<T>(sql: string, params?: unknown[]): T | undefined {
      const stmt = db.prepare(sql);
      return (params ? stmt.get(...params) : stmt.get()) as T | undefined;
    },

    // Alias for query — tests may use conn.all() (better-sqlite3 convention)
    all<T>(sql: string, params?: unknown[]): T[] {
      const stmt = db.prepare(sql);
      return (params ? stmt.all(...params) : stmt.all()) as T[];
    },

    close(): Result<void> {
      try {
        db.close();
        return { ok: true, value: undefined };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'DATABASE_CLOSE_FAILED',
            message: err instanceof Error ? err.message : String(err),
            spec: 'I-05',
          },
        };
      }
    },
  };

  return conn;
}

// ─── AuditTrail factory ───

/**
 * Create a real AuditTrail instance using SHA-256.
 * Same as production — no stubs.
 */
export function createTestAuditTrail(): AuditTrail {
  return createAuditTrail(sha256);
}

// ─── OrchestrationDeps factory ───

/**
 * Minimal Substrate stub for orchestration tests.
 * Most orchestration code only needs conn and audit.
 * The substrate is required by the interface but rarely called directly.
 */
function createSubstrateStub(): OrchestrationDeps['substrate'] {
  const notImplemented = () => {
    throw new Error('Substrate stub: not implemented in test harness. If your test needs substrate, extend the stub.');
  };

  // Return a minimal object that satisfies the Substrate interface shape.
  // Tests that need real substrate behavior should use a more complete setup.
  return {
    scheduler: { enqueue: notImplemented, dequeue: notImplemented, peek: notImplemented, size: notImplemented, clear: notImplemented },
    workerPool: { dispatch: notImplemented, getWorker: notImplemented, shutdown: notImplemented, getMetrics: notImplemented },
    gateway: { sendRequest: notImplemented, requestStream: notImplemented, getProviderHealth: notImplemented, registerProvider: notImplemented },
    heartbeat: { start: notImplemented, stop: notImplemented, check: notImplemented, getStatus: notImplemented },
    accounting: { recordInteraction: notImplemented, getAccountingSummary: notImplemented, checkRateLimit: notImplemented, consumeRateLimit: notImplemented },
    shutdown: notImplemented,
  } as unknown as OrchestrationDeps['substrate'];
}

/**
 * Create a test OrchestrationTransitionService with a passthrough enforcer.
 * Uses real SQL transitions (UPDATE + CAS + audit) but approves all state changes.
 * P0-A: Required by module factories (createBudgetGovernor, createCheckpointCoordinator, etc.).
 */
export function createTestTransitionService(audit: AuditTrail): OrchestrationTransitionService {
  const time: TimeProvider = { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  const passthroughResult = () => ({ ok: true as const, value: { fromState: '', toState: '', timestamp: time.nowISO() } });
  const enforcer: TransitionEnforcer = {
    enforceMissionTransition: passthroughResult,
    enforceTaskTransition: passthroughResult,
    enforceHandoffTransition: passthroughResult,
    enforceRunTransition: passthroughResult,
  };
  return createOrchestrationTransitionService(enforcer, audit, time);
}

/**
 * Create OrchestrationDeps with real database + audit trail, stubbed substrate.
 *
 * @param tenancyMode - Tenancy mode (default: 'single')
 * @returns { deps, conn, audit, transitionService } — deps for orchestration calls, conn/audit for direct access
 */
export function createTestOrchestrationDeps(tenancyMode: TenancyConfig['mode'] = 'single'): {
  deps: OrchestrationDeps;
  conn: DatabaseConnection;
  audit: AuditTrail;
  transitionService: OrchestrationTransitionService;
} {
  const conn = createTestDatabase(tenancyMode);
  const audit = createTestAuditTrail();
  const substrate = createSubstrateStub();

  const time: TimeProvider = { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  const deps: OrchestrationDeps = Object.freeze({ conn, substrate, audit, time });
  const transitionService = createTestTransitionService(audit);
  return { deps, conn, audit, transitionService };
}

// ─── Tenant-Scoped Connection Factory (Phase 4B — uses real facade) ───

/**
 * Create OrchestrationDeps with a tenant-scoped connection for cross-tenant isolation tests.
 * Uses the real TenantScopedConnection facade from src/kernel/tenant/tenant_scope.ts.
 *
 * In row-level mode: auto-injects `AND tenant_id = ?` into SELECT/UPDATE/DELETE queries.
 * INSERT queries pass through unchanged.
 *
 * @param rawConn - A raw DatabaseConnection (from createTestDatabase with 'row-level')
 * @param scopedTenantId - The tenant_id to scope queries to
 * @returns { deps, conn, rawConn, audit } — deps with scoped conn, rawConn for direct access
 */
export function createScopedTestDeps(
  rawConn: DatabaseConnection,
  scopedTenantId: string,
): {
  deps: OrchestrationDeps;
  conn: DatabaseConnection;
  rawConn: DatabaseConnection;
  audit: AuditTrail;
} {
  const audit = createTestAuditTrail();
  const substrate = createSubstrateStub();
  const scopedConn = createTenantScopedConnection(rawConn, tenantId(scopedTenantId));

  const time: TimeProvider = { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  const deps: OrchestrationDeps = Object.freeze({
    conn: scopedConn as DatabaseConnection,
    substrate,
    audit,
    time,
  });
  return { deps, conn: scopedConn as DatabaseConnection, rawConn, audit };
}

// ─── OperationContext factory ───

export interface TestContextOptions {
  tenantId?: string | null;
  userId?: string | null;
  agentId?: string | null;
  permissions?: Permission[];
  sessionId?: string;
}

/**
 * Create an OperationContext for tests with sensible defaults.
 * Default: admin-level permissions, tenant 'test-tenant', user 'test-user'.
 */
export function createTestOperationContext(options: TestContextOptions = {}): OperationContext {
  const allPermissions: Permission[] = [
    'create_agent', 'modify_agent', 'delete_agent',
    'chat', 'infer', 'create_mission',
    'view_telemetry', 'view_audit',
    'manage_providers', 'manage_budgets', 'manage_roles',
    'purge_data',
    'approve_response', 'edit_response', 'takeover_session', 'review_batch',
  ];

  return {
    tenantId: options.tenantId === null ? null : tenantId(options.tenantId ?? 'test-tenant'),
    userId: options.userId === null ? null : userId(options.userId ?? 'test-user'),
    agentId: options.agentId === null ? null : agentId(options.agentId ?? 'test-agent'),
    permissions: new Set(options.permissions ?? allPermissions),
    ...(options.sessionId ? { sessionId: sessionId(options.sessionId) } : {}),
  };
}

// ─── Seed Helpers ───

/**
 * Seed a mission directly into the database.
 * Bypasses orchestration validation for test setup convenience.
 */
export function seedMission(conn: DatabaseConnection, options: {
  id: string;
  tenantId?: string;
  parentId?: string | null;
  agentId?: string;
  objective?: string;
  state?: string;
  depth?: number;
  capabilities?: string[];
}): void {
  const {
    id,
    tenantId: tid = 'test-tenant',
    parentId = null,
    agentId: aid = 'test-agent',
    objective = 'Test mission objective',
    state = 'CREATED',
    depth = 0,
    capabilities = ['web_search'],
  } = options;

  const now = new Date().toISOString();

  conn.run(
    `INSERT INTO core_missions (id, tenant_id, parent_id, agent_id, objective, success_criteria, scope_boundaries, state, depth, capabilities, delegation_chain, constraints_json, plan_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, tid, parentId, aid, objective, JSON.stringify(['Complete the objective']), JSON.stringify(['Within budget']), state, depth, JSON.stringify(capabilities), JSON.stringify([]), JSON.stringify({}), 0, now, now]
  );

  // Seed mission goals (required by schema — all 5 NOT NULL columns)
  conn.run(
    `INSERT INTO core_mission_goals (mission_id, objective, success_criteria, scope_boundaries, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, objective, JSON.stringify(['Complete the objective']), JSON.stringify(['Within budget']), now]
  );

  // Update tree counts
  const rootId = parentId ? conn.get<{ root_id: string }>(
    `WITH RECURSIVE tree AS (
       SELECT id, parent_id FROM core_missions WHERE id = ?
       UNION ALL
       SELECT m.id, m.parent_id FROM core_missions m JOIN tree t ON m.id = t.parent_id
     ) SELECT id as root_id FROM tree WHERE parent_id IS NULL`,
    [id]
  )?.root_id ?? id : id;

  // Upsert tree count
  const existing = conn.get<{ total_count: number }>(`SELECT total_count FROM core_tree_counts WHERE root_mission_id = ?`, [rootId]);
  if (existing) {
    conn.run(`UPDATE core_tree_counts SET total_count = total_count + 1 WHERE root_mission_id = ?`, [rootId]);
  } else {
    conn.run(`INSERT INTO core_tree_counts (root_mission_id, total_count, tenant_id) VALUES (?, ?, ?)`, [rootId, 1, tid]);
  }
}

/**
 * Seed a resource/budget record for a mission.
 */
export function seedResource(conn: DatabaseConnection, options: {
  missionId: string;
  tenantId?: string;
  tokenAllocated?: number;
  tokenConsumed?: number;
  deadline?: string;
}): void {
  const {
    missionId: mid,
    tenantId: tid = 'test-tenant',
    tokenAllocated = 10000,
    tokenConsumed = 0,
    deadline = new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
  } = options;

  const now = new Date().toISOString();

  conn.run(
    `INSERT INTO core_resources (mission_id, tenant_id, token_allocated, token_consumed, token_remaining, deadline, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [mid, tid, tokenAllocated, tokenConsumed, tokenAllocated - tokenConsumed, deadline, now]
  );
}

/**
 * Seed an audit entry directly (for testing chain integrity).
 */
export function seedAuditEntry(conn: DatabaseConnection, audit: AuditTrail, options: {
  tenantId?: string | null;
  operation?: string;
  resourceType?: string;
  resourceId?: string;
}): Result<unknown> {
  return audit.append(conn, {
    tenantId: options.tenantId ? tenantId(options.tenantId) : null,
    actorType: 'system',
    actorId: 'test-harness',
    operation: options.operation ?? 'test_operation',
    resourceType: options.resourceType ?? 'test_resource',
    resourceId: options.resourceId ?? `res-${Date.now()}`,
  });
}
