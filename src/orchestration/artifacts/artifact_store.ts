/**
 * Artifact Store -- Immutable artifact workspace with dependency tracking.
 * S ref: S8 (Artifact), I-19 (immutability), I-23 (dependency tracking),
 *        FM-15 (artifact entropy)
 *
 * Phase: 3 (Orchestration)
 * Implements: Artifact creation (INSERT-only, never UPDATE per I-19),
 *             version management via composite PK (id, version),
 *             dependency tracking on read, lifecycle state management.
 *
 * SD-03: Composite PK (id, version) from Alpha. Each row is an immutable version.
 */

import type { Result, OperationContext, MissionId, ArtifactId, TenantId } from '../../kernel/interfaces/index.js';
import type {
  OrchestrationDeps, ArtifactStore,
  CreateArtifactInput, CreateArtifactOutput,
  ReadArtifactInput, ReadArtifactOutput,
} from '../interfaces/orchestration.js';
import { MISSION_TREE_DEFAULTS, generateId } from '../interfaces/orchestration.js';
import { walkCascade } from './cascade_walker.js';

// CF-013: Maximum artifact content size (10MB)
const MAX_ARTIFACT_CONTENT_BYTES = 10_485_760;

/**
 * S8: Create the artifact store module.
 * Factory function returns frozen object per C-07.
 */
export function createArtifactStore(): ArtifactStore {

  /** S18: Create artifact (INSERT-only, I-19) */
  function create(
    deps: OrchestrationDeps,
    ctx: OperationContext,
    input: CreateArtifactInput,
  ): Result<CreateArtifactOutput> {
    // Verify mission is in active state
    const mission = deps.conn.get<{ state: string }>(
      'SELECT state FROM core_missions WHERE id = ?',
      [input.missionId],
    );
    if (!mission) {
      return { ok: false, error: { code: 'MISSION_NOT_ACTIVE', message: 'Mission not found', spec: 'S18' } };
    }
    const activeStates = ['CREATED', 'PLANNING', 'EXECUTING', 'REVIEWING'];
    if (!activeStates.includes(mission.state)) {
      return { ok: false, error: { code: 'MISSION_NOT_ACTIVE', message: `Mission in state ${mission.state}`, spec: 'S18' } };
    }

    // I-20: Artifact limit check
    const countResult = getArtifactCount(deps, input.missionId);
    if (countResult.ok && countResult.value >= MISSION_TREE_DEFAULTS.maxArtifacts) {
      return { ok: false, error: { code: 'ARTIFACT_LIMIT_EXCEEDED', message: `Artifact count ${countResult.value} >= max ${MISSION_TREE_DEFAULTS.maxArtifacts}`, spec: 'I-20' } };
    }

    // CF-013: Hard cap on artifact content size (10MB)
    const contentSize = typeof input.content === 'string'
      ? Buffer.byteLength(input.content, 'utf-8')
      : input.content.length;
    if (contentSize > MAX_ARTIFACT_CONTENT_BYTES) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: `Artifact content exceeds maximum size (${contentSize} bytes > ${MAX_ARTIFACT_CONTENT_BYTES} bytes limit)`, spec: 'S18/CF-013' } };
    }

    // CQ-10 fix: S18 STORAGE_EXCEEDED -- check storage budget before artifact creation
    const resource = deps.conn.get<{ storage_max_bytes: number; storage_consumed_bytes: number }>(
      'SELECT storage_max_bytes, storage_consumed_bytes FROM core_resources WHERE mission_id = ?',
      [input.missionId],
    );
    if (!resource) {
      // Debt 2: Missing resource row means storage budget enforcement is impossible — do not silently skip
      return { ok: false, error: { code: 'STORAGE_EXCEEDED', message: `Resource record missing for mission ${input.missionId} — cannot verify storage budget`, spec: 'S18' } };
    }
    if (resource.storage_max_bytes > 0 && (resource.storage_consumed_bytes + contentSize) > resource.storage_max_bytes) {
      return { ok: false, error: { code: 'STORAGE_EXCEEDED', message: `Content size ${contentSize} would exceed storage budget (consumed ${resource.storage_consumed_bytes} of max ${resource.storage_max_bytes})`, spec: 'S18' } };
    }

    // Determine version
    let artifactId: ArtifactId;
    let version: number;

    if (input.parentArtifactId !== null) {
      // Revision: same artifact id, next version
      artifactId = input.parentArtifactId;
      const maxVersion = deps.conn.get<{ mv: number }>(
        'SELECT MAX(version) as mv FROM core_artifacts WHERE id = ?',
        [input.parentArtifactId],
      );
      version = (maxVersion?.mv ?? 0) + 1;
    } else {
      // New artifact
      artifactId = generateId() as ArtifactId;
      version = 1;
    }

    const now = deps.time.nowISO();
    const contentBlob = typeof input.content === 'string'
      ? Buffer.from(input.content, 'utf-8')
      : input.content;

    deps.conn.transaction(() => {
      // I-19: INSERT only -- never UPDATE
      deps.conn.run(
        `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type,
         format, content, lifecycle_state, source_task_id, parent_artifact_id,
         relevance_decay, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 0, ?, ?)`,
        [
          artifactId,
          version,
          input.missionId,
          ctx.tenantId,
          input.name,
          input.type,
          input.format,
          contentBlob,
          input.sourceTaskId,
          input.parentArtifactId,
          JSON.stringify(input.metadata),
          now,
        ],
      );

      // I-03: Audit entry
      deps.audit.append(deps.conn, {
        tenantId: ctx.tenantId,
        actorType: ctx.userId ? 'user' : 'agent',
        actorId: (ctx.userId ?? ctx.agentId ?? 'system') as string,
        operation: 'create_artifact',
        resourceType: 'artifact',
        resourceId: `${artifactId as string}@v${version}`,
        detail: { missionId: input.missionId, name: input.name, type: input.type, version },
      });
    });

    return {
      ok: true,
      value: { artifactId, version },
    };
  }

  /** S19: Read artifact with dependency tracking (I-23) */
  function read(
    deps: OrchestrationDeps,
    _ctx: OperationContext,
    input: ReadArtifactInput,
  ): Result<ReadArtifactOutput> {
    let row: Record<string, unknown> | undefined;

    if (input.version === 'latest') {
      row = deps.conn.get<Record<string, unknown>>(
        'SELECT * FROM core_artifacts WHERE id = ? ORDER BY version DESC LIMIT 1',
        [input.artifactId],
      );
    } else {
      row = deps.conn.get<Record<string, unknown>>(
        'SELECT * FROM core_artifacts WHERE id = ? AND version = ?',
        [input.artifactId, input.version],
      );
    }

    if (!row) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `Artifact ${input.artifactId} not found`, spec: 'S19' } };
    }

    const lifecycleState = row['lifecycle_state'] as string;
    if (lifecycleState === 'ARCHIVED' || lifecycleState === 'DELETED') {
      return { ok: false, error: { code: 'ARCHIVED', message: `Artifact is ${lifecycleState}`, spec: 'S19' } };
    }

    const content = row['content'] as Buffer;
    const metadata = row['metadata_json'] ? JSON.parse(row['metadata_json'] as string) as Record<string, unknown> : {};

    return {
      ok: true,
      value: {
        artifact: {
          id: row['id'] as ArtifactId,
          version: row['version'] as number,
          missionId: row['mission_id'] as MissionId,
          name: row['name'] as string,
          type: row['type'] as ReadArtifactOutput['artifact']['type'],
          format: row['format'] as ReadArtifactOutput['artifact']['format'],
          content,
          lifecycleState: lifecycleState as ReadArtifactOutput['artifact']['lifecycleState'],
          metadata,
        },
      },
    };
  }

  /** I-23: Track dependency edge */
  function trackDependency(
    deps: OrchestrationDeps,
    readingMissionId: MissionId,
    artifactId: ArtifactId,
    version: number,
    isCrossMission: boolean,
  ): Result<void> {
    const now = deps.time.nowISO();
    // FM-10: Derive tenant_id from reading mission
    const missionRow = deps.conn.get<{ tenant_id: string | null }>(
      'SELECT tenant_id FROM core_missions WHERE id = ?', [readingMissionId],
    );
    if (!missionRow) {
      // Debt 2: Missing mission means tenant identity cannot be established — do not fabricate null tenant
      return { ok: false, error: { code: 'MISSION_NOT_FOUND', message: `Mission ${readingMissionId} not found — cannot derive tenant for dependency tracking`, spec: 'FM-10' } };
    }
    const depTenantId = (missionRow.tenant_id ?? null) as TenantId | null;

    // CQ-06 fix: I-03 -- dependency tracking INSERT + audit in same transaction
    deps.conn.transaction(() => {
      // FM-10: tenant_id inherited from reading mission
      deps.conn.run(
        `INSERT OR IGNORE INTO core_artifact_dependencies
         (reading_mission_id, artifact_id, artifact_version, is_cross_mission, tenant_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [readingMissionId, artifactId, version, isCrossMission ? 1 : 0, depTenantId, now],
      );

      deps.audit.append(deps.conn, {
        tenantId: depTenantId,
        actorType: 'system',
        actorId: 'artifact_store',
        operation: 'track_dependency',
        resourceType: 'artifact_dependency',
        resourceId: `${artifactId as string}@v${version}`,
        detail: { readingMissionId, artifactId, version, isCrossMission },
      });
    });
    return { ok: true, value: undefined };
  }

  /** FM-15: Get artifact count for mission */
  function getArtifactCount(deps: OrchestrationDeps, missionId: MissionId): Result<number> {
    const row = deps.conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_artifacts WHERE mission_id = ?',
      [missionId],
    );
    return { ok: true, value: row?.cnt ?? 0 };
  }

  /** I-21: Archive artifacts for compaction */
  function archiveForMission(deps: OrchestrationDeps, missionId: MissionId): Result<number> {
    // Debt 3: Derive tenant_id from mission for audit trail
    const archiveMissionRow = deps.conn.get<{ tenant_id: string | null }>(
      'SELECT tenant_id FROM core_missions WHERE id = ?',
      [missionId],
    );
    const archiveTenantId = (archiveMissionRow?.tenant_id ?? null) as TenantId | null;

    // CQ-07 fix: I-03 -- archive UPDATE + audit + cascade in same transaction
    let archived = 0;
    deps.conn.transaction(() => {
      const result = deps.conn.run(
        `UPDATE core_artifacts SET lifecycle_state = 'ARCHIVED' WHERE mission_id = ? AND lifecycle_state = 'ACTIVE'`,
        [missionId],
      );
      archived = result.changes;

      if (archived > 0) {
        // I-23: Collect the archived artifact IDs for cascade
        const archivedRows = deps.conn.query<{ id: string }>(
          `SELECT DISTINCT id FROM core_artifacts WHERE mission_id = ? AND lifecycle_state = 'ARCHIVED'`,
          [missionId],
        );
        const archivedArtifactIds = archivedRows.map(r => r.id);

        deps.audit.append(deps.conn, {
          tenantId: archiveTenantId,
          actorType: 'system',
          actorId: 'artifact_store',
          operation: 'archive_artifacts',
          resourceType: 'artifact',
          resourceId: missionId,
          detail: { missionId, archivedCount: archived },
        });

        // I-23: Cascade STALE flag to transitive dependents (BFS)
        // Both archive and cascade in the same transaction
        walkCascade(archivedArtifactIds, deps.conn, archiveTenantId, deps.audit);
      }
    });
    return { ok: true, value: archived };
  }

  return Object.freeze({
    create,
    read,
    trackDependency,
    getArtifactCount,
    archiveForMission,
  });
}
