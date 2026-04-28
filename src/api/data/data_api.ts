/**
 * Data management API wrapper for the API surface.
 * S ref: I-02 (user data ownership), S3.6 (data directory),
 *        §35 (data retention)
 *
 * Phase: 4 (API Surface)
 * Implements: SDD §7 build order item 13
 *
 * Wraps data management operations behind the DataApi interface:
 *   - export(): Export entire engine state (Permission: 'purge_data')
 *   - purgeAll(): Purge all data, leaving zero traces (Permission: 'purge_data')
 *   - purge(): Selective purge by filter (Permission: 'purge_data')
 *
 * I-02: All user data must be accessible, exportable, and deletable.
 * All mutations delegate through the kernel's database lifecycle.
 *
 * Invariants enforced: I-02 (user data ownership), I-13 (RBAC)
 */

import { resolve, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type {
  OperationContext, DatabaseConnection, RateLimiter, RbacEngine,
} from '../../kernel/interfaces/index.js';
import type { Kernel } from '../../kernel/interfaces/index.js';
import type { DataApi, PurgeFilter } from '../interfaces/api.js';
import { unwrapResult, LimenError } from '../errors/limen_error.js';
import { requirePermission } from '../enforcement/rbac_guard.js';
import { requireRateLimit } from '../enforcement/rate_guard.js';

// ============================================================================
// DataApiImpl
// ============================================================================

/**
 * I-02: Data management API implementation.
 * Ensures all user data is accessible, exportable, and deletable.
 */
export class DataApiImpl implements DataApi {
  constructor(
    private readonly rbac: RbacEngine,
    private readonly rateLimiter: RateLimiter,
    private readonly kernel: Kernel,
    private readonly getConnection: () => DatabaseConnection,
    private readonly getContext: () => OperationContext,
  ) {}

  /**
   * S3.6, I-02: Export entire engine state.
   * Permission: 'purge_data' (same elevated permission as data deletion)
   *
   * Exports the SQLite database and all associated state to the specified path.
   * The export is a complete, self-contained copy of all engine data.
   */
  async export(outputPath: string): Promise<{ path: string; sizeBytes: number }> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    requirePermission(this.rbac, ctx, 'purge_data');
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    // CF-019: Validate outputPath to prevent path traversal.
    // Resolve the path and ensure it falls within the data directory.
    const dataDir = conn.dataDir;
    const resolvedPath = resolve(dataDir, outputPath);
    const normalizedBase = normalize(dataDir) + '/';
    if (!resolvedPath.startsWith(normalizedBase)) {
      throw new LimenError('INVALID_INPUT',
        `Export path must resolve within data directory. Path traversal detected.`);
    }

    // CF-015: Ensure path ends with .limen extension (S3.6 archive format)
    const archivePath = resolvedPath.endsWith('.limen') ? resolvedPath : resolvedPath + '.limen';

    // Delegate to kernel database lifecycle for atomic export
    const result = this.kernel.database.export(conn, archivePath);
    const exportResult = unwrapResult(result);

    // CF-015: Stamp exported file with .limen archive metadata (S3.6)
    // Open the exported SQLite, add metadata table, close.
    // This enriches the raw SQLite copy with provenance information.
    try {
      const require = createRequire(import.meta.url);
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- synchronous import for export metadata
      const BetterSqlite3 = require('better-sqlite3') as {
        new (filename: string): {
          exec(sql: string): void;
          prepare(sql: string): { run(...params: unknown[]): void };
          close(): void;
        };
      };

      // Read version dynamically from package.json (Critical #18: no stale hardcoded version).
      // Navigate from this module (src/api/data/) up to the project root.
      const thisDir = dirname(fileURLToPath(import.meta.url));
      const pkgJsonPath = resolve(thisDir, '..', '..', '..', 'package.json');
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { version: string };
      const limenVersion = pkg.version;

      const exportDb = new BetterSqlite3(archivePath);

      exportDb.exec(`
        CREATE TABLE IF NOT EXISTS _limen_export_metadata (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      const insertMeta = exportDb.prepare(
        `INSERT OR REPLACE INTO _limen_export_metadata (key, value) VALUES (?, ?)`
      );
      insertMeta.run('format', 'limen-archive-v1');
      insertMeta.run('limen_version', limenVersion);
      insertMeta.run('schema_version', String(conn.schemaVersion));
      insertMeta.run('export_date', this.kernel.time.nowISO());
      insertMeta.run('tenant_id', ctx.tenantId ?? 'global');
      insertMeta.run('exported_by', ctx.userId ?? 'system');

      exportDb.close();
    } catch {
      // Metadata stamping is non-critical — the export is still valid SQLite
    }

    // I-03: Audit the export operation
    this.kernel.audit.append(conn, {
      tenantId: ctx.tenantId,
      actorType: 'user',
      actorId: ctx.userId as string ?? 'unknown',
      operation: 'data_export',
      resourceType: 'database',
      resourceId: 'export',
      detail: {
        path: archivePath,
        sizeBytes: exportResult.sizeBytes,
        format: 'limen-archive-v1',
      },
    });

    return {
      path: archivePath,
      sizeBytes: exportResult.sizeBytes,
    };
  }

  /**
   * I-02: Purge all data. Leaves zero traces.
   * Permission: 'purge_data'
   *
   * This is a destructive operation.
   * After this call, the engine is in a clean state as if freshly created.
   */
  async purgeAll(): Promise<void> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    requirePermission(this.rbac, ctx, 'purge_data');
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    // Execute retention with aggressive purge via kernel
    const result = this.kernel.retention.executeRetention(conn, ctx);
    unwrapResult(result);
  }

  /**
   * CF-009, I-02: Selective purge by filter.
   * Permission: 'purge_data'
   *
   * Purges data matching the specified filter criteria:
   *   - sessionId: Purge all data from a specific session
   *   - missionId: Purge all data from a specific mission (cascading to all child tables)
   *   - olderThan: Purge data older than the specified ISO timestamp
   *   - userId: NOT SUPPORTED (no user_id column in schema)
   *
   * I-06: Audit log entries are NEVER purged.
   * I-03: All purge operations are audited in the same transaction.
   */
  async purge(filter: PurgeFilter): Promise<{ purged: number }> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    requirePermission(this.rbac, ctx, 'purge_data');
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    // CF-009: userId is not supported — no user_id column exists in schema
    if (filter.userId) {
      throw new LimenError('INVALID_INPUT',
        'userId filter not supported: no user_id column in current schema. Use sessionId or missionId.');
    }

    // CF-009: At least one filter field required for selective purge
    if (!filter.sessionId && !filter.missionId && !filter.olderThan) {
      throw new LimenError('INVALID_INPUT',
        'At least one filter field required (sessionId, missionId, olderThan). Use purgeAll() for full purge.');
    }

    let totalPurged = 0;

    conn.transaction(() => {
      if (filter.sessionId) {
        totalPurged += this.purgeBySession(conn, filter.sessionId as string);
      }
      if (filter.missionId) {
        totalPurged += this.purgeByMission(conn, filter.missionId as string);
      }
      if (filter.olderThan) {
        totalPurged += this.purgeByAge(conn, filter.olderThan);
      }

      // I-03: Audit the purge operation
      this.kernel.audit.append(conn, {
        tenantId: ctx.tenantId,
        actorType: 'user',
        actorId: ctx.userId as string ?? 'unknown',
        operation: 'selective_purge',
        resourceType: 'data',
        resourceId: 'purge',
        detail: {
          sessionId: filter.sessionId ?? null,
          missionId: filter.missionId ?? null,
          olderThan: filter.olderThan ?? null,
          recordsPurged: totalPurged,
        },
      });
    });

    return { purged: totalPurged };
  }

  /**
   * CF-009: Purge all data associated with a session.
   * Deletes conversation turns (child FK), conversations, and HITL approvals.
   */
  private purgeBySession(conn: DatabaseConnection, sid: string): number {
    let purged = 0;

    // Delete conversation turns first (child FK to core_conversations)
    const convs = conn.query<{ id: string }>(
      'SELECT id FROM core_conversations WHERE session_id = ?', [sid],
    );
    for (const conv of convs) {
      purged += conn.run(
        'DELETE FROM core_conversation_turns WHERE conversation_id = ?', [conv.id],
      ).changes;
    }

    // Delete conversations
    purged += conn.run(
      'DELETE FROM core_conversations WHERE session_id = ?', [sid],
    ).changes;

    // Delete HITL approvals for this session
    purged += conn.run(
      'DELETE FROM hitl_approval_queue WHERE session_id = ?', [sid],
    ).changes;

    return purged;
  }

  /**
   * CF-009: Purge all data associated with a mission and its descendants.
   * Cascading delete from all 17+ child tables in FK dependency order.
   * I-06: NEVER deletes from core_audit_log.
   */
  private purgeByMission(conn: DatabaseConnection, mid: string): number {
    // Find all descendant mission IDs (recursive)
    const missionIds = this.findDescendantMissions(conn, mid);
    let purged = 0;

    for (const mId of missionIds) {
      // Delete task dependencies (via task FK — must delete before tasks)
      const tasks = conn.query<{ id: string }>(
        'SELECT id FROM core_tasks WHERE mission_id = ?', [mId],
      );
      for (const task of tasks) {
        purged += conn.run(
          'DELETE FROM core_task_dependencies WHERE from_task = ? OR to_task = ?',
          [task.id, task.id],
        ).changes;
      }

      // Delete artifact dependencies (via artifact FK — must delete before artifacts)
      const artifacts = conn.query<{ id: string }>(
        'SELECT id FROM core_artifacts WHERE mission_id = ?', [mId],
      );
      for (const art of artifacts) {
        purged += conn.run(
          'DELETE FROM core_artifact_dependencies WHERE artifact_id = ?', [art.id],
        ).changes;
      }
      // Also delete dependencies where this mission is the reader
      purged += conn.run(
        'DELETE FROM core_artifact_dependencies WHERE reading_mission_id = ?', [mId],
      ).changes;

      // Delete tasks
      purged += conn.run('DELETE FROM core_tasks WHERE mission_id = ?', [mId]).changes;

      // Delete task graphs
      purged += conn.run('DELETE FROM core_task_graphs WHERE mission_id = ?', [mId]).changes;

      // Delete artifacts
      purged += conn.run('DELETE FROM core_artifacts WHERE mission_id = ?', [mId]).changes;

      // Delete checkpoints
      purged += conn.run('DELETE FROM core_checkpoints WHERE mission_id = ?', [mId]).changes;

      // Delete resources
      purged += conn.run('DELETE FROM core_resources WHERE mission_id = ?', [mId]).changes;

      // Delete mission goals
      purged += conn.run('DELETE FROM core_mission_goals WHERE mission_id = ?', [mId]).changes;

      // Delete mission results
      purged += conn.run('DELETE FROM core_mission_results WHERE mission_id = ?', [mId]).changes;

      // Delete compaction log
      purged += conn.run('DELETE FROM core_compaction_log WHERE mission_id = ?', [mId]).changes;

      // Delete tree counts
      purged += conn.run('DELETE FROM core_tree_counts WHERE root_mission_id = ?', [mId]).changes;

      // Delete events (nullable mission_id)
      purged += conn.run('DELETE FROM obs_events WHERE mission_id = ?', [mId]).changes;

      // Delete interaction accounting
      purged += conn.run('DELETE FROM meter_interaction_accounting WHERE mission_id = ?', [mId]).changes;

      // Delete LLM request log
      purged += conn.run('DELETE FROM core_llm_request_log WHERE mission_id = ?', [mId]).changes;

      // Delete task queue
      purged += conn.run('DELETE FROM core_task_queue WHERE mission_id = ?', [mId]).changes;

      // Delete events log
      purged += conn.run('DELETE FROM core_events_log WHERE mission_id = ?', [mId]).changes;

      // Delete HITL approvals
      purged += conn.run('DELETE FROM hitl_approval_queue WHERE mission_id = ?', [mId]).changes;

      // Delete governance runs (gov_runs has mission_id)
      purged += conn.run('DELETE FROM gov_attempts WHERE mission_id = ?', [mId]).changes;
      purged += conn.run('DELETE FROM gov_runs WHERE mission_id = ?', [mId]).changes;

      // Delete working memory entries (via task_id join through core_tasks)
      const wmTasks = conn.query<{ id: string }>(
        'SELECT id FROM core_tasks WHERE mission_id = ?', [mId],
      );
      for (const task of wmTasks) {
        purged += conn.run(
          'DELETE FROM working_memory_entries WHERE task_id = ?', [task.id],
        ).changes;
      }

      // Delete WMP boundary events (has mission_id directly)
      // Note: wmp_boundary_events has immutability triggers (WMP-I6) that prevent DELETE.
      // For purge operations, we drop and recreate the trigger within this transaction.
      conn.run('DROP TRIGGER IF EXISTS trg_wmp_boundary_events_immutable_delete');
      purged += conn.run('DELETE FROM wmp_boundary_events WHERE mission_id = ?', [mId]).changes;
      conn.run(`CREATE TRIGGER IF NOT EXISTS trg_wmp_boundary_events_immutable_delete
        BEFORE DELETE ON wmp_boundary_events
        BEGIN
          SELECT RAISE(ABORT, 'WMP-I6: Boundary events are immutable -- no DELETE permitted');
        END`);

      // Delete narrative snapshots (has mission_id directly)
      purged += conn.run('DELETE FROM narrative_snapshots WHERE mission_id = ?', [mId]).changes;

      // Delete claim importance (via claim_assertions.source_mission_id FK)
      purged += conn.run(
        `DELETE FROM claim_importance WHERE claim_id IN (
          SELECT id FROM claim_assertions WHERE source_mission_id = ?
        )`, [mId],
      ).changes;

      // Delete connection suggestions (via claim_assertions.source_mission_id FK)
      purged += conn.run(
        `DELETE FROM connection_suggestions WHERE from_claim_id IN (
          SELECT id FROM claim_assertions WHERE source_mission_id = ?
        ) OR to_claim_id IN (
          SELECT id FROM claim_assertions WHERE source_mission_id = ?
        )`, [mId, mId],
      ).changes;

      // Delete consolidation log entries (via source_claim_ids containing mission claims)
      // consolidation_log.source_claim_ids is a JSON array — delete entries referencing mission claims
      purged += conn.run(
        `DELETE FROM consolidation_log WHERE target_claim_id IN (
          SELECT id FROM claim_assertions WHERE source_mission_id = ?
        )`, [mId],
      ).changes;
    }

    // Delete missions (children first, then parent — reverse order for FK safety)
    for (const mId of [...missionIds].reverse()) {
      purged += conn.run('DELETE FROM core_missions WHERE id = ?', [mId]).changes;
    }

    return purged;
  }

  /**
   * CF-009: Find a mission and all its descendants (recursive).
   * Returns IDs in breadth-first order (children after parents).
   */
  private findDescendantMissions(conn: DatabaseConnection, rootMissionId: string): string[] {
    const result: string[] = [rootMissionId];
    let queue = [rootMissionId];

    while (queue.length > 0) {
      const nextQueue: string[] = [];
      for (const parentId of queue) {
        const children = conn.query<{ id: string }>(
          'SELECT id FROM core_missions WHERE parent_id = ?', [parentId],
        );
        for (const child of children) {
          result.push(child.id);
          nextQueue.push(child.id);
        }
      }
      queue = nextQueue;
    }

    return result;
  }

  /**
   * CF-009: Purge data older than the specified ISO timestamp.
   * Finds all missions older than the cutoff and purges each one,
   * plus standalone conversations and events.
   */
  private purgeByAge(conn: DatabaseConnection, olderThan: string): number {
    let purged = 0;

    // Find and purge old missions (cascading via purgeByMission)
    const oldMissions = conn.query<{ id: string }>(
      'SELECT id FROM core_missions WHERE created_at < ? AND parent_id IS NULL', [olderThan],
    );
    for (const m of oldMissions) {
      purged += this.purgeByMission(conn, m.id);
    }

    // Purge old conversations not tied to missions
    const oldConvs = conn.query<{ id: string }>(
      'SELECT id FROM core_conversations WHERE created_at < ?', [olderThan],
    );
    for (const conv of oldConvs) {
      purged += conn.run(
        'DELETE FROM core_conversation_turns WHERE conversation_id = ?', [conv.id],
      ).changes;
    }
    purged += conn.run(
      'DELETE FROM core_conversations WHERE created_at < ?', [olderThan],
    ).changes;

    // Purge old events not tied to missions
    purged += conn.run(
      'DELETE FROM obs_events WHERE created_at < ? AND mission_id IS NULL', [olderThan],
    ).changes;

    // Purge old LLM request logs
    purged += conn.run(
      'DELETE FROM core_llm_request_log WHERE created_at < ?', [olderThan],
    ).changes;

    return purged;
  }

  /**
   * GDPR: Purge ALL data for a specific tenant across all tenant-scoped tables.
   * Permission: 'purge_data'
   *
   * Deletes from all tables that have a tenant_id column, in FK dependency order.
   * I-06: Audit log entries are NEVER purged (they are sanitized by the erasure engine instead).
   * I-31: claim_relationships immutability triggers are temporarily dropped for the purge.
   *
   * This is the nuclear option for tenant offboarding / GDPR "right to be forgotten" at tenant scope.
   */
  async purgeByTenant(tenantId: string): Promise<{ purged: number }> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    requirePermission(this.rbac, ctx, 'purge_data');
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    if (!tenantId || tenantId.trim().length === 0) {
      throw new LimenError('INVALID_INPUT', 'tenantId is required for purgeByTenant');
    }

    let totalPurged = 0;

    conn.transaction(() => {
      // ── Leaf tables first (children before parents in FK order) ──

      // Task dependencies (via task FK)
      const tasks = conn.query<{ id: string }>(
        'SELECT id FROM core_tasks WHERE tenant_id = ?', [tenantId],
      );
      for (const task of tasks) {
        totalPurged += conn.run(
          'DELETE FROM core_task_dependencies WHERE from_task = ? OR to_task = ?',
          [task.id, task.id],
        ).changes;
        // Working memory entries (keyed on task_id)
        totalPurged += conn.run(
          'DELETE FROM working_memory_entries WHERE task_id = ?', [task.id],
        ).changes;
      }

      // Artifact dependencies
      const artifacts = conn.query<{ id: string }>(
        'SELECT id FROM core_artifacts WHERE tenant_id = ?', [tenantId],
      );
      for (const art of artifacts) {
        totalPurged += conn.run(
          'DELETE FROM core_artifact_dependencies WHERE artifact_id = ?', [art.id],
        ).changes;
      }
      // Also dependencies where this tenant's missions are readers
      const missions = conn.query<{ id: string }>(
        'SELECT id FROM core_missions WHERE tenant_id = ?', [tenantId],
      );
      for (const m of missions) {
        totalPurged += conn.run(
          'DELETE FROM core_artifact_dependencies WHERE reading_mission_id = ?', [m.id],
        ).changes;
      }

      // Conversation turns (child FK to core_conversations)
      const convs = conn.query<{ id: string }>(
        'SELECT id FROM core_conversations WHERE tenant_id = ?', [tenantId],
      );
      for (const conv of convs) {
        totalPurged += conn.run(
          'DELETE FROM core_conversation_turns WHERE conversation_id = ?', [conv.id],
        ).changes;
      }

      // I-31: Temporarily drop immutability triggers on claim_relationships for GDPR purge.
      // Safe: better-sqlite3 is synchronous/single-threaded — no concurrent exploit window.
      conn.run('DROP TRIGGER IF EXISTS claim_relationships_no_delete');
      conn.run('DROP TRIGGER IF EXISTS claim_relationships_no_update');

      // Claim-related tables
      totalPurged += conn.run('DELETE FROM claim_evidence WHERE claim_id IN (SELECT id FROM claim_assertions WHERE tenant_id = ?)', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM claim_relationships WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM claim_artifact_refs WHERE claim_id IN (SELECT id FROM claim_assertions WHERE tenant_id = ?)', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM claim_importance WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM connection_suggestions WHERE tenant_id = ?', [tenantId]).changes;

      // Recreate I-31 triggers
      conn.run(`CREATE TRIGGER IF NOT EXISTS claim_relationships_no_update
        BEFORE UPDATE ON claim_relationships
        BEGIN
          SELECT RAISE(ABORT, 'I-31: Claim relationships are immutable. UPDATE is prohibited.');
        END`);
      conn.run(`CREATE TRIGGER IF NOT EXISTS claim_relationships_no_delete
        BEFORE DELETE ON claim_relationships
        BEGIN
          SELECT RAISE(ABORT, 'I-31: Claim relationships are immutable. DELETE is prohibited.');
        END`);

      // Embedding tables
      totalPurged += conn.run('DELETE FROM embedding_metadata WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM embedding_pending WHERE tenant_id = ?', [tenantId]).changes;

      // Governance tables
      totalPurged += conn.run('DELETE FROM gov_attempts WHERE mission_id IN (SELECT id FROM core_missions WHERE tenant_id = ?)', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM gov_runs WHERE tenant_id = ?', [tenantId]).changes;

      // Drop WMP boundary event immutability trigger for purge
      conn.run('DROP TRIGGER IF EXISTS trg_wmp_boundary_events_immutable_delete');
      totalPurged += conn.run('DELETE FROM wmp_boundary_events WHERE mission_id IN (SELECT id FROM core_missions WHERE tenant_id = ?)', [tenantId]).changes;
      conn.run(`CREATE TRIGGER IF NOT EXISTS trg_wmp_boundary_events_immutable_delete
        BEFORE DELETE ON wmp_boundary_events
        BEGIN
          SELECT RAISE(ABORT, 'WMP-I6: Boundary events are immutable -- no DELETE permitted');
        END`);

      // Core tables
      totalPurged += conn.run('DELETE FROM core_tasks WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM core_task_graphs WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM core_artifacts WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM core_checkpoints WHERE mission_id IN (SELECT id FROM core_missions WHERE tenant_id = ?)', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM core_resources WHERE mission_id IN (SELECT id FROM core_missions WHERE tenant_id = ?)', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM core_mission_goals WHERE mission_id IN (SELECT id FROM core_missions WHERE tenant_id = ?)', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM core_mission_results WHERE mission_id IN (SELECT id FROM core_missions WHERE tenant_id = ?)', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM core_compaction_log WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM core_tree_counts WHERE root_mission_id IN (SELECT id FROM core_missions WHERE tenant_id = ?)', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM core_conversations WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM obs_events WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM meter_interaction_accounting WHERE mission_id IN (SELECT id FROM core_missions WHERE tenant_id = ?)', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM core_llm_request_log WHERE mission_id IN (SELECT id FROM core_missions WHERE tenant_id = ?)', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM core_task_queue WHERE mission_id IN (SELECT id FROM core_missions WHERE tenant_id = ?)', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM core_events_log WHERE mission_id IN (SELECT id FROM core_missions WHERE tenant_id = ?)', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM hitl_approval_queue WHERE mission_id IN (SELECT id FROM core_missions WHERE tenant_id = ?)', [tenantId]).changes;

      // Cognitive tables
      totalPurged += conn.run('DELETE FROM narrative_snapshots WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM consolidation_log WHERE tenant_id = ?', [tenantId]).changes;

      // Governance suite tables
      totalPurged += conn.run('DELETE FROM governance_classification_rules WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM governance_protected_predicates WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM governance_erasure_certificates WHERE tenant_id = ?', [tenantId]).changes;

      // Governance contracts/supervisor/eval/capabilities/handoffs
      totalPurged += conn.run('DELETE FROM gov_mission_contracts WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM gov_supervisor_decisions WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM gov_suspension_records WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM gov_eval_cases WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM gov_capability_manifests WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM gov_handoffs WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM gov_idempotency_keys WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM gov_resume_tokens WHERE tenant_id = ?', [tenantId]).changes;

      // Learning tables
      totalPurged += conn.run('DELETE FROM learning_techniques WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM learning_outcomes WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM learning_applications WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM quarantine_entries WHERE tenant_id = ?', [tenantId]).changes;
      totalPurged += conn.run('DELETE FROM transfer_requests WHERE tenant_id = ?', [tenantId]).changes;

      // Consent records
      totalPurged += conn.run('DELETE FROM governance_consent_records WHERE tenant_id = ?', [tenantId]).changes;

      // Claims (after dependents are deleted)
      totalPurged += conn.run('DELETE FROM claim_assertions WHERE tenant_id = ?', [tenantId]).changes;

      // Missions (last — parent of many FK relationships)
      totalPurged += conn.run('DELETE FROM core_missions WHERE tenant_id = ?', [tenantId]).changes;

      // I-03: Audit the tenant purge operation (audit log itself is NOT purged)
      this.kernel.audit.append(conn, {
        tenantId: ctx.tenantId,
        actorType: 'user',
        actorId: ctx.userId as string ?? 'unknown',
        operation: 'tenant_purge',
        resourceType: 'tenant',
        resourceId: tenantId,
        detail: {
          purgedTenantId: tenantId,
          recordsPurged: totalPurged,
        },
      });
    });

    return { purged: totalPurged };
  }
}
