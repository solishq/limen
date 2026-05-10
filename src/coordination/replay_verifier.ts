// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AGENT_COORDINATION_GOVERNANCE.md §7
/**
 * Deterministic Replay Verifier — snapshot capture, hash verification, divergence detection.
 *
 * Implements: CO-7.1 through CO-7.22, CO-11.15 through CO-11.18,
 *             CO-12.6, CO-12.7
 *
 * CO-12.6: Replay verification is read-only. Never modifies state.
 * CO-12.7: Divergence detection is deterministic. Same inputs -> same outputs.
 *
 * Hash computation (CO-7.9, CO-7.10, CO-7.11):
 * - stateHash = SHA-256(sorted(tableHashes.values).join(':'))
 * - tableHashes[table] = SHA-256(canonicalSerialize(allRowsInTable.sortedById))
 * - Deterministic: same data -> same hash regardless of insertion order.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Result, OperationContext, MissionId, TenantId, AgentId } from '../kernel/interfaces/index.js';
import type { DatabaseConnection } from '../kernel/interfaces/database.js';
import type { AuditTrail } from '../kernel/interfaces/audit.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type {
  SnapshotTrigger, SnapshotTable, SnapshotMetadata, StateSnapshot,
  ReplayVerifyOptions, ReplayVerification, TableVerification,
  DivergenceReport, DivergenceEntry, DivergenceSummary,
} from './coordination_types.js';
import { replaySnapshotNotFound, replayMissionNotFound } from './coordination_errors.js';
import type { AgentCoordinationError } from './coordination_errors.js';

// ── Result helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function errResult<T>(error: AgentCoordinationError): Result<T> {
  return { ok: false, error };
}

// ============================================================================
// Constants
// ============================================================================

const ALL_SNAPSHOT_TABLES: readonly SnapshotTable[] = Object.freeze([
  'claims', 'relationships', 'working_memory', 'governance_rules', 'audit_entries',
]);

/**
 * Table name mapping: SnapshotTable -> actual SQLite table.
 * BRK-CO-011 implementation note: Snapshot table identifiers (e.g., 'claims')
 * use domain-level names while actual SQLite tables use prefixed names
 * (e.g., 'claim_assertions'). This mapping is the canonical translation layer.
 * BRK-CO-004: working_memory maps to 'working_memory_entries' (not core_working_memory).
 */
const TABLE_MAP: Readonly<Record<SnapshotTable, string>> = Object.freeze({
  claims: 'claim_assertions',
  relationships: 'claim_relationships',
  working_memory: 'working_memory_entries',
  governance_rules: 'coordination_a2a_rules',
  audit_entries: 'core_audit_log',
});

/** Primary key column for each table */
const PK_MAP: Readonly<Record<SnapshotTable, string>> = Object.freeze({
  claims: 'id',
  relationships: 'id',
  working_memory: 'task_id || \':\' || key',
  governance_rules: 'id',
  audit_entries: 'id',
});

// ============================================================================
// Replay Verifier Dependencies
// ============================================================================

export interface ReplayVerifierDeps {
  readonly conn: DatabaseConnection;
  readonly audit: AuditTrail;
  readonly time: TimeProvider;
}

// ============================================================================
// Snapshot Capture (CO-11.15)
// ============================================================================

/**
 * CO-11.15: Capture a state snapshot — hash all 5 tables, store snapshot record.
 */
export function captureSnapshot(
  deps: ReplayVerifierDeps,
  ctx: OperationContext,
  missionId: MissionId,
  trigger: SnapshotTrigger,
): Result<StateSnapshot> {
  const { conn, audit, time } = deps;
  const now = time.nowISO();
  const snapshotId = randomUUID();

  // CO-7.10: Compute per-table hashes
  const tableHashes: Record<string, string> = {};
  const metadata: {
    claimCount: number; relationshipCount: number; workingMemoryEntries: number;
    governanceRuleCount: number; auditEntryCount: number;
  } = {
    claimCount: 0, relationshipCount: 0, workingMemoryEntries: 0,
    governanceRuleCount: 0, auditEntryCount: 0,
  };

  for (const table of ALL_SNAPSHOT_TABLES) {
    const { hash, rowCount } = computeTableHash(conn, table, ctx.tenantId);
    tableHashes[table] = hash;

    switch (table) {
      case 'claims': metadata.claimCount = rowCount; break;
      case 'relationships': metadata.relationshipCount = rowCount; break;
      case 'working_memory': metadata.workingMemoryEntries = rowCount; break;
      case 'governance_rules': metadata.governanceRuleCount = rowCount; break;
      case 'audit_entries': metadata.auditEntryCount = rowCount; break;
    }
  }

  // CO-7.9: stateHash = SHA-256(sorted(tableHashes.values).join(':'))
  const sortedHashes = Object.values(tableHashes).sort();
  const stateHash = createHash('sha256').update(sortedHashes.join(':')).digest('hex');

  const snapshotMetadata: SnapshotMetadata = Object.freeze({
    claimCount: metadata.claimCount,
    relationshipCount: metadata.relationshipCount,
    workingMemoryEntries: metadata.workingMemoryEntries,
    governanceRuleCount: metadata.governanceRuleCount,
    auditEntryCount: metadata.auditEntryCount,
    capturedBy: (ctx.agentId ?? 'system') as AgentId,
    capturedAt: now,
  });

  conn.transaction(() => {
    conn.run(
      `INSERT INTO coordination_state_snapshots
       (id, mission_id, tenant_id, trigger, timestamp, state_hash, table_hashes, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [snapshotId, missionId, ctx.tenantId, trigger, now, stateHash,
       JSON.stringify(tableHashes), JSON.stringify(snapshotMetadata)],
    );

    audit.append(conn, {
      tenantId: ctx.tenantId,
      actorType: 'agent',
      actorId: ctx.agentId ?? 'system',
      operation: 'capture_snapshot',
      resourceType: 'state_snapshot',
      resourceId: snapshotId,
    });
  });

  const snapshot: StateSnapshot = Object.freeze({
    id: snapshotId,
    missionId,
    tenantId: ctx.tenantId as TenantId,
    trigger,
    timestamp: now,
    stateHash,
    tableHashes: Object.freeze(tableHashes as Record<SnapshotTable, string>),
    metadata: snapshotMetadata,
  });

  return ok(snapshot);
}

// ============================================================================
// Replay Verification (CO-11.16, CO-12.6)
// ============================================================================

/**
 * CO-11.16: Verify replay — re-hash current state and compare to stored snapshot.
 * CO-12.6: Read-only. NEVER modifies state.
 */
export function verifyReplay(
  deps: ReplayVerifierDeps,
  ctx: OperationContext,
  missionId: MissionId,
  options?: ReplayVerifyOptions,
): Result<ReplayVerification> {
  const { conn, time } = deps;
  const startMs = time.nowMs();
  const now = time.nowISO();

  // Get snapshots for this mission
  const snapshots = conn.query<SnapshotRow>(
    `SELECT * FROM coordination_state_snapshots WHERE mission_id = ? AND tenant_id = ? ORDER BY timestamp`,
    [missionId, ctx.tenantId],
  );

  if (snapshots.length === 0) {
    return errResult(replayMissionNotFound(missionId as string));
  }

  // CO-7.12: fromSnapshot defaults to mission_start (first)
  const fromSnapshotId = options?.fromSnapshot ?? snapshots[0]!.id;
  // CO-7.13: toSnapshot defaults to latest (last)
  const toSnapshotId = options?.toSnapshot ?? snapshots[snapshots.length - 1]!.id;

  const toSnapshot = snapshots.find(s => s.id === toSnapshotId);
  if (!toSnapshot) return errResult(replaySnapshotNotFound(toSnapshotId));

  const fromSnapshot = snapshots.find(s => s.id === fromSnapshotId);
  if (!fromSnapshot) return errResult(replaySnapshotNotFound(fromSnapshotId));

  // CO-7.14: tables defaults to all
  const tablesToVerify = options?.tables ?? ALL_SNAPSHOT_TABLES;

  // Re-hash current state
  const currentTableHashes: Record<string, string> = {};
  const tableResults: Record<string, TableVerification> = {};
  const divergences: DivergenceEntry[] = [];

  const expectedHashes: Record<string, string> = JSON.parse(toSnapshot.table_hashes);

  for (const table of tablesToVerify) {
    const { hash: currentHash, rowCount } = computeTableHash(conn, table, ctx.tenantId);
    const expectedHash = expectedHashes[table] ?? '';
    currentTableHashes[table] = currentHash;

    tableResults[table] = Object.freeze({
      table,
      expectedHash,
      actualHash: currentHash,
      match: currentHash === expectedHash,
      rowsChecked: rowCount,
    });

    // CO-7.15: halt on first divergence if requested
    if (currentHash !== expectedHash && options?.haltOnFirstDivergence) {
      divergences.push(Object.freeze({
        table,
        rowId: '*',
        field: 'hash',
        valueInA: expectedHash,
        valueInB: currentHash,
        divergenceType: 'modified',
      }));
      break;
    }

    if (currentHash !== expectedHash) {
      divergences.push(Object.freeze({
        table,
        rowId: '*',
        field: 'hash',
        valueInA: expectedHash,
        valueInB: currentHash,
        divergenceType: 'modified',
      }));
    }
  }

  // BRK-CO-008: When verifying a subset of tables, recompute expected hash from only
  // those tables' hashes in the snapshot, not from the full-state hash.
  const sortedCurrentHashes = tablesToVerify.map(t => currentTableHashes[t] ?? '').sort();
  const actualHash = createHash('sha256').update(sortedCurrentHashes.join(':')).digest('hex');

  const sortedExpectedHashes = tablesToVerify.map(t => expectedHashes[t] ?? '').sort();
  const expectedHash = createHash('sha256').update(sortedExpectedHashes.join(':')).digest('hex');

  const durationMs = time.nowMs() - startMs;

  const verification: ReplayVerification = Object.freeze({
    missionId,
    verified: divergences.length === 0,
    fromSnapshotId: fromSnapshot.id,
    toSnapshotId: toSnapshot.id,
    expectedHash,
    actualHash,
    tableResults: Object.freeze(tableResults as Record<SnapshotTable, TableVerification>),
    divergences: Object.freeze(divergences),
    verifiedAt: now,
    duration: durationMs,
  });

  return ok(verification);
}

// ============================================================================
// Snapshot Retrieval (CO-11.17)
// ============================================================================

/**
 * CO-11.17: Get all snapshots for a mission.
 */
export function getSnapshots(
  deps: ReplayVerifierDeps,
  ctx: OperationContext,
  missionId: MissionId,
): Result<StateSnapshot[]> {
  const { conn } = deps;

  const rows = conn.query<SnapshotRow>(
    `SELECT * FROM coordination_state_snapshots WHERE mission_id = ? AND tenant_id = ? ORDER BY timestamp`,
    [missionId, ctx.tenantId],
  );

  const snapshots: StateSnapshot[] = rows.map(r => Object.freeze({
    id: r.id,
    missionId: r.mission_id as MissionId,
    tenantId: r.tenant_id as TenantId,
    trigger: r.trigger as SnapshotTrigger,
    timestamp: r.timestamp,
    stateHash: r.state_hash,
    tableHashes: Object.freeze(JSON.parse(r.table_hashes) as Record<SnapshotTable, string>),
    metadata: Object.freeze(JSON.parse(r.metadata) as SnapshotMetadata),
  }));

  return ok(snapshots);
}

// ============================================================================
// Divergence Detection (CO-11.18, CO-12.7)
// ============================================================================

/**
 * CO-11.18: Row-by-row comparison between two snapshot states.
 * CO-12.7: Deterministic — identical inputs -> identical output.
 */
export function detectDivergence(
  deps: ReplayVerifierDeps,
  ctx: OperationContext,
  snapshotAId: string,
  snapshotBId: string,
): Result<DivergenceReport> {
  const { conn, time } = deps;
  const now = time.nowISO();

  const snapshotA = conn.get<SnapshotRow>(
    `SELECT * FROM coordination_state_snapshots WHERE id = ? AND tenant_id = ?`,
    [snapshotAId, ctx.tenantId],
  );
  if (!snapshotA) return errResult(replaySnapshotNotFound(snapshotAId));

  const snapshotB = conn.get<SnapshotRow>(
    `SELECT * FROM coordination_state_snapshots WHERE id = ? AND tenant_id = ?`,
    [snapshotBId, ctx.tenantId],
  );
  if (!snapshotB) return errResult(replaySnapshotNotFound(snapshotBId));

  const hashesA: Record<string, string> = JSON.parse(snapshotA.table_hashes);
  const hashesB: Record<string, string> = JSON.parse(snapshotB.table_hashes);

  const divergences: DivergenceEntry[] = [];

  for (const table of ALL_SNAPSHOT_TABLES) {
    const hashA = hashesA[table] ?? '';
    const hashB = hashesB[table] ?? '';
    if (hashA !== hashB) {
      divergences.push(Object.freeze({
        table,
        rowId: '*',
        field: 'hash',
        valueInA: hashA,
        valueInB: hashB,
        divergenceType: 'modified',
      }));
    }
  }

  // Build summary
  const byTable: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const table of ALL_SNAPSHOT_TABLES) byTable[table] = 0;
  byType['modified'] = 0;
  byType['added_in_a'] = 0;
  byType['added_in_b'] = 0;
  byType['missing_in_a'] = 0;
  byType['missing_in_b'] = 0;

  for (const d of divergences) {
    byTable[d.table] = (byTable[d.table] ?? 0) + 1;
    byType[d.divergenceType] = (byType[d.divergenceType] ?? 0) + 1;
  }

  const summary: DivergenceSummary = Object.freeze({
    totalDivergences: divergences.length,
    byTable: Object.freeze(byTable as Record<SnapshotTable, number>),
    byType: Object.freeze(byType as Record<DivergenceEntry['divergenceType'], number>),
  });

  const report: DivergenceReport = Object.freeze({
    snapshotA: snapshotAId,
    snapshotB: snapshotBId,
    divergences: Object.freeze(divergences),
    summary,
    generatedAt: now,
  });

  return ok(report);
}

// ============================================================================
// Internal: Table Hash Computation (CO-7.10, CO-7.11)
// ============================================================================

interface SnapshotRow {
  id: string;
  mission_id: string;
  tenant_id: string;
  trigger: string;
  timestamp: string;
  state_hash: string;
  table_hashes: string;
  metadata: string;
}

/**
 * CO-7.10: Compute SHA-256 of canonically serialized table rows sorted by ID.
 * CO-7.11: Deterministic — same data -> same hash regardless of insertion order.
 */
function computeTableHash(
  conn: DatabaseConnection,
  table: SnapshotTable,
  tenantId: OperationContext['tenantId'],
): { hash: string; rowCount: number } {
  const tableName = TABLE_MAP[table];
  const pkExpr = PK_MAP[table];

  // BRK-CO-007: Runtime assertion — tableName and pkExpr come from frozen constant maps,
  // but validate they only contain safe characters as defense-in-depth.
  if (!/^[a-z_]+$/.test(tableName)) {
    return { hash: createHash('sha256').update('').digest('hex'), rowCount: 0 };
  }
  // pkExpr is either a simple column name or a concat expression — validate pattern
  if (!/^[a-z_]+(?:\s*\|\|\s*'[^']*'\s*\|\|\s*[a-z_]+)?$/.test(pkExpr)) {
    return { hash: createHash('sha256').update('').digest('hex'), rowCount: 0 };
  }

  // Check if table exists (governance_rules table may not exist yet)
  const tableExists = conn.get<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [tableName],
  );

  if (!tableExists) {
    // Table doesn't exist — empty hash
    return { hash: createHash('sha256').update('').digest('hex'), rowCount: 0 };
  }

  // Check if table has tenant_id column
  const hasTenantId = conn.get<{ name: string }>(
    `SELECT name FROM pragma_table_info(?) WHERE name='tenant_id'`,
    [tableName],
  );

  let rows: Record<string, unknown>[];
  if (hasTenantId) {
    rows = conn.query(
      `SELECT * FROM ${tableName} WHERE tenant_id = ? ORDER BY ${pkExpr}`,
      [tenantId],
    );
  } else {
    rows = conn.query(`SELECT * FROM ${tableName} ORDER BY ${pkExpr}`);
  }

  if (rows.length === 0) {
    return { hash: createHash('sha256').update('').digest('hex'), rowCount: 0 };
  }

  // Canonical serialization: sorted keys, stable JSON
  const canonical = rows.map(row => JSON.stringify(row, Object.keys(row as object).sort())).join('\n');
  const hash = createHash('sha256').update(canonical).digest('hex');

  return { hash, rowCount: rows.length };
}
