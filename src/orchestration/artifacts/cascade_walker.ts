/**
 * Cascade Walker — BFS STALE flag propagation through artifact dependency graph.
 * S ref: I-23 (Artifact Dependency Tracking), I-19 (Artifact Immutability)
 *
 * Phase: Sprint 3 (Knowledge Graph)
 *
 * Algorithm: Breadth-first search starting from archived artifact IDs.
 * For each artifact: find missions that depend on it, find their ACTIVE+FRESH
 * artifacts, mark them STALE, add to BFS queue.
 *
 * Safety constraints:
 *   - COALESCE tenant pattern on EVERY query (FM-10)
 *   - Column-specific UPDATE (staleness_flag only) — I-19 content/type triggers NOT fired
 *   - Visited set prevents infinite loops on circular dependencies
 *   - MAX_CASCADE_DEPTH = 10 hard safety bound
 *   - Only cascades to ACTIVE + FRESH artifacts (skip ARCHIVED/DELETED/SUMMARIZED/STALE)
 *   - Single audit entry per cascade invocation
 *
 * Spec trace: §4 I-23, §8 S18/S19, §19 Side Effects
 */

import type { DatabaseConnection, AuditTrail, TenantId } from '../../kernel/interfaces/index.js';

/** Maximum BFS depth to prevent unbounded traversal. */
const MAX_CASCADE_DEPTH = 10;

/** Result of a cascade operation. */
export interface CascadeResult {
  /** Number of artifacts marked STALE. */
  readonly affectedCount: number;
  /** IDs of artifacts marked STALE (artifact_id:version format). */
  readonly affectedIds: readonly string[];
}

/**
 * Walk the artifact dependency graph via BFS, marking transitive dependents as STALE.
 *
 * @param sourceArtifactIds - Artifact IDs that were just archived (cascade source)
 * @param conn - Database connection (must be inside a transaction already)
 * @param tenantId - Tenant ID for isolation (null for single-tenant)
 * @param audit - Audit trail for recording the cascade
 * @returns CascadeResult with affected count and IDs
 */
export function walkCascade(
  sourceArtifactIds: readonly string[],
  conn: DatabaseConnection,
  tenantId: TenantId | null,
  audit: AuditTrail,
): CascadeResult {
  if (sourceArtifactIds.length === 0) {
    return { affectedCount: 0, affectedIds: [] };
  }

  // Visited set: `${artifactId}:${version}` — prevents cycles
  const visited = new Set<string>();
  const affectedIds: string[] = [];

  // BFS queue: each entry is { artifactId, depth }
  const queue: Array<{ artifactId: string; depth: number }> = [];

  // Seed the queue with source artifact IDs
  for (const id of sourceArtifactIds) {
    queue.push({ artifactId: id, depth: 0 });
  }

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Safety bound: stop if max depth exceeded
    if (current.depth >= MAX_CASCADE_DEPTH) {
      continue;
    }

    // Find all missions that depend on this artifact
    // COALESCE tenant pattern (FM-10)
    const dependentMissions = conn.query<{ reading_mission_id: string }>(
      `SELECT DISTINCT reading_mission_id
       FROM core_artifact_dependencies
       WHERE artifact_id = ?
         AND COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')`,
      [current.artifactId, tenantId],
    );

    for (const dep of dependentMissions) {
      // Find ACTIVE + FRESH artifacts in this dependent mission
      // COALESCE tenant pattern (FM-10)
      const freshArtifacts = conn.query<{ id: string; version: number }>(
        `SELECT id, version
         FROM core_artifacts
         WHERE mission_id = ?
           AND lifecycle_state = 'ACTIVE'
           AND staleness_flag = 'FRESH'
           AND COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')`,
        [dep.reading_mission_id, tenantId],
      );

      for (const artifact of freshArtifacts) {
        const visitKey = `${artifact.id}:${artifact.version}`;

        // Skip already-visited artifacts (cycle prevention)
        if (visited.has(visitKey)) {
          continue;
        }
        visited.add(visitKey);

        // Column-specific UPDATE: only staleness_flag — I-19 safe
        // Uses version in WHERE clause for optimistic concurrency
        const result = conn.run(
          `UPDATE core_artifacts
           SET staleness_flag = 'STALE'
           WHERE id = ? AND version = ?`,
          [artifact.id, artifact.version],
        );

        if (result.changes > 0) {
          affectedIds.push(visitKey);

          // Add to BFS queue for further propagation
          queue.push({ artifactId: artifact.id, depth: current.depth + 1 });
        }
      }
    }
  }

  // Single audit entry per cascade invocation (not per artifact)
  if (affectedIds.length > 0) {
    audit.append(conn, {
      tenantId,
      actorType: 'system',
      actorId: 'cascade_walker',
      operation: 'cascade_stale',
      resourceType: 'artifact',
      resourceId: `cascade:${sourceArtifactIds.join(',')}`,
      detail: {
        sourceArtifactIds,
        affectedCount: affectedIds.length,
        affectedIds,
      },
    });
  }

  return {
    affectedCount: affectedIds.length,
    affectedIds,
  };
}
