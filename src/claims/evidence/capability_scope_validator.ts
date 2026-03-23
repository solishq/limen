/**
 * Capability result scope validator — DC-CCP-118.
 * Validates that capability_result evidence originates from within the
 * claiming agent's mission ancestor chain.
 *
 * Phase: Sprint 1 (Foundation Layer — CCP-02 Capability Results)
 * Implements: CapabilityResultScopeValidator interface from claim_types.ts
 *
 * Algorithm:
 *   1. Look up capability result by ID → get mission_id
 *   2. Walk from the claiming mission's mission_id upward via parent_mission_id
 *   3. If result's mission_id matches any ancestor (including self) → scope valid
 *   4. Maximum 6 iterations (maxDepth=5 + self) for bounded execution
 *   5. Visited set for cycle guard
 *
 * Spec ref: DC-CCP-118 (Capability result scope validation)
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { Result, MissionId, TenantId } from '../../kernel/interfaces/index.js';
import type { CapabilityResultScopeValidator } from '../interfaces/claim_types.js';

/**
 * Create a CapabilityResultScopeValidator backed by SQLite.
 *
 * Validates that a capability_result evidence reference originates from
 * within the mission ancestor chain of the asserting claim's mission context.
 *
 * This prevents cross-scope evidence contamination — an agent cannot claim
 * evidence from a capability result produced by an unrelated mission tree.
 *
 * F-S1-004: tenantId parameter added to prevent cross-tenant scope walk.
 * Every mission lookup is tenant-scoped via COALESCE pattern.
 */
export function createCapabilityResultScopeValidator(): CapabilityResultScopeValidator {
  return {
    validateScope(
      conn: DatabaseConnection,
      evidenceId: string,
      missionId: MissionId,
      tenantId: TenantId | null,
    ): Result<boolean> {
      // Step 1: Look up the capability result to find its mission_id
      const resultRow = conn.get<{ mission_id: string }>(
        'SELECT mission_id FROM core_capability_results WHERE id = ?',
        [evidenceId],
      );
      if (!resultRow) {
        return {
          ok: false,
          error: {
            code: 'EVIDENCE_NOT_FOUND',
            message: `Capability result '${evidenceId}' not found`,
            spec: 'DC-CCP-118',
          },
        };
      }

      const resultMissionId = resultRow.mission_id;

      // Step 2: Walk the mission ancestor chain from the claiming mission
      // Check if resultMissionId matches any ancestor (including self)
      // F-S1-004: All mission lookups scoped by tenantId to prevent cross-tenant walk
      const maxDepth = 5;
      const visited = new Set<string>();
      let currentMissionId: string | null = missionId as string;

      for (let i = 0; i <= maxDepth && currentMissionId !== null; i++) {
        // Cycle guard
        if (visited.has(currentMissionId)) break;
        visited.add(currentMissionId);

        // Step 3: Check if the capability result's mission matches this ancestor
        if (currentMissionId === resultMissionId) {
          return { ok: true, value: true };
        }

        // Walk up to parent — tenant-scoped (F-S1-004)
        const parentRow: { parent_id: string | null } | undefined = conn.get<{ parent_id: string | null }>(
          'SELECT parent_id FROM core_missions WHERE id = ? AND COALESCE(tenant_id, \'__NULL__\') = COALESCE(?, \'__NULL__\')',
          [currentMissionId, tenantId],
        );
        if (!parentRow) break;
        currentMissionId = parentRow.parent_id;
      }

      // Result mission not in ancestor chain → scope violation
      return { ok: true, value: false };
    },
  };
}
