/**
 * Bounded Cognition -- Eager compaction of completed subtrees.
 * S ref: I-21 (bounded cognitive state), S40 (operational failure defense),
 *        S23 (submit_result triggers compaction), I-03 (atomic audit)
 *
 * Phase: 3 (Orchestration)
 * Implements: On submit_result, compact completed subtrees IN THE SAME TRANSACTION.
 *             Working-set query returns only non-compacted, active missions.
 *             Compaction produces a summary artifact and archives the subtree.
 *
 * SD-20: Compaction is eager (same transaction as submit_result) not lazy.
 *        This prevents the working set from growing unboundedly.
 * SD-21: Compacted missions have compacted=1, their artifacts are ARCHIVED,
 *        and a compaction_log entry records what was compacted.
 */

import type { Result, MissionId, ArtifactId, TenantId } from '../../kernel/interfaces/index.js';
import type { OrchestrationDeps, CompactionEngine } from '../interfaces/orchestration.js';
import { generateId } from '../interfaces/orchestration.js';

/**
 * I-21: Create the compaction engine module.
 * Factory function returns frozen object per C-07.
 */
export function createCompactionEngine(): CompactionEngine {

  /**
   * I-21: Eagerly compact a completed subtree in same transaction.
   * SD-20: Called from submit_result after mission transitions to COMPLETED.
   *
   * Compaction steps:
   * 1. Find all completed children of the completed mission
   * 2. Mark them as compacted (compacted=1)
   * 3. Archive their artifacts (lifecycle_state='ARCHIVED')
   * 4. Create a summary artifact with compaction details
   * 5. Log the compaction
   */
  function compactSubtree(
    deps: OrchestrationDeps,
    completedMissionId: MissionId,
  ): Result<void> {
    // Verify mission is completed
    const mission = deps.conn.get<{ state: string; parent_id: string | null; tenant_id: TenantId | null }>(
      'SELECT state, parent_id, tenant_id FROM core_missions WHERE id = ?',
      [completedMissionId],
    );
    if (!mission || mission.state !== 'COMPLETED') {
      // Not completed -- nothing to compact
      return { ok: true, value: undefined };
    }

    // Find all completed children (direct children only for efficiency)
    const completedChildren = deps.conn.query<{ id: string }>(
      `SELECT id FROM core_missions WHERE parent_id = ? AND state = 'COMPLETED' AND compacted = 0`,
      [completedMissionId],
    );

    if (completedChildren.length === 0) {
      // No children to compact -- just mark self if it's a leaf
      return { ok: true, value: undefined };
    }

    const now = deps.time.nowISO();
    const compactionId = generateId();
    const childIds = completedChildren.map(c => c.id);
    let totalArchived = 0;

    deps.conn.transaction(() => {
      // Mark children as compacted
      for (const childId of childIds) {
        deps.conn.run(
          `UPDATE core_missions SET compacted = 1, updated_at = ? WHERE id = ?`,
          [now, childId],
        );

        // Archive their artifacts
        const archiveResult = deps.conn.run(
          `UPDATE core_artifacts SET lifecycle_state = 'ARCHIVED' WHERE mission_id = ? AND lifecycle_state = 'ACTIVE'`,
          [childId],
        );
        totalArchived += archiveResult.changes;

        // Recursively compact grandchildren that are completed
        const grandchildren = deps.conn.query<{ id: string }>(
          `SELECT id FROM core_missions WHERE parent_id = ? AND state = 'COMPLETED' AND compacted = 0`,
          [childId],
        );
        for (const gc of grandchildren) {
          deps.conn.run(
            `UPDATE core_missions SET compacted = 1, updated_at = ? WHERE id = ?`,
            [now, gc.id],
          );
          const gcArchive = deps.conn.run(
            `UPDATE core_artifacts SET lifecycle_state = 'ARCHIVED' WHERE mission_id = ? AND lifecycle_state = 'ACTIVE'`,
            [gc.id],
          );
          totalArchived += gcArchive.changes;
          childIds.push(gc.id);
        }
      }

      // Create summary artifact for the compaction
      const summaryArtifactId = generateId() as ArtifactId;
      const summaryContent = JSON.stringify({
        compactedMissions: childIds,
        totalArchived,
        compactedAt: now,
        parentMission: completedMissionId,
      });

      // FM-10: tenant_id inherited from mission
      deps.conn.run(
        `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, lifecycle_state, source_task_id, parent_artifact_id, relevance_decay, metadata_json, created_at)
         VALUES (?, 1, ?, ?, 'compaction_summary', 'report', 'json', ?, 'ACTIVE', 'compaction', NULL, 0, ?, ?)`,
        [summaryArtifactId, completedMissionId, mission.tenant_id, Buffer.from(summaryContent, 'utf-8'), JSON.stringify({ compactionId }), now],
      );

      // Log the compaction
      // FM-10: tenant_id inherited from mission
      deps.conn.run(
        `INSERT INTO core_compaction_log (id, mission_id, tenant_id, summary_artifact_id, missions_compacted, artifacts_archived, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [compactionId, completedMissionId, mission.tenant_id, summaryArtifactId, JSON.stringify(childIds), totalArchived, now],
      );

      // I-03: Audit entry
      deps.audit.append(deps.conn, {
        tenantId: mission.tenant_id,
        actorType: 'system',
        actorId: 'compaction_engine',
        operation: 'compact_subtree',
        resourceType: 'mission',
        resourceId: completedMissionId,
        detail: { childIds, totalArchived, compactionId },
      });
    });

    return { ok: true, value: undefined };
  }

  /**
   * I-21: Get working set -- non-compacted, active missions in a tree.
   * SD-07: Uses the working-set partial index for O(1) query.
   */
  function getWorkingSet(
    deps: OrchestrationDeps,
    rootMissionId: MissionId,
  ): Result<MissionId[]> {
    // Get all non-compacted, non-terminal missions in the tree
    // Start from root and walk down
    const working: MissionId[] = [];

    function walk(missionId: string): void {
      const mission = deps.conn.get<{ id: string; state: string; compacted: number }>(
        'SELECT id, state, compacted FROM core_missions WHERE id = ?',
        [missionId],
      );
      if (!mission) return;

      const terminalStates = ['COMPLETED', 'FAILED', 'CANCELLED'];
      if (mission.compacted === 0 && !terminalStates.includes(mission.state)) {
        working.push(mission.id as MissionId);
      }

      // Walk children
      const children = deps.conn.query<{ id: string }>(
        'SELECT id FROM core_missions WHERE parent_id = ?',
        [missionId],
      );
      for (const child of children) {
        walk(child.id);
      }
    }

    walk(rootMissionId);
    return { ok: true, value: working };
  }

  return Object.freeze({
    compactSubtree,
    getWorkingSet,
  });
}
