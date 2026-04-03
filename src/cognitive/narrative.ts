/**
 * Phase 12: Narrative Memory — Mission-scoped cognitive state snapshots.
 *
 * Pure SQL computation:
 * 1. Query claims WHERE source_mission_id = ? (or all if null)
 * 2. Count distinct subject prefixes (2-segment URN prefix)
 * 3. Count claims with predicate LIKE 'decision.%'
 * 4. Count contradicts relationships in scope
 * 5. Count retracted claims in scope
 * 6. Compute momentum: created vs retracted
 * 7. Thread detection: group by (subject prefix, predicate prefix), filter 3+ claims
 * 8. Store in narrative_snapshots
 *
 * Spec ref: PHASE-12-DESIGN-SOURCE.md (Output 1, Narrative Memory)
 * Truth model: I-P12-40 (mission scoping), I-P12-41 (momentum computation)
 * DCs: DC-P12-104, DC-P12-803
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '../kernel/interfaces/database.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type { NarrativeSnapshot, NarrativeThread } from './cognitive_types.js';

/**
 * Compute and store a narrative snapshot.
 *
 * I-P12-40: When missionId is provided, only includes claims with that source_mission_id.
 *           When null, includes all claims in tenant.
 * I-P12-41: Momentum = growing if added > retracted, stable if equal, declining otherwise.
 *
 * @param conn - Database connection
 * @param tenantId - Tenant scope
 * @param time - Time provider
 * @param missionId - Mission scope (null for global)
 * @returns NarrativeSnapshot or null if no claims in scope
 */
export function computeNarrative(
  conn: DatabaseConnection,
  tenantId: string | null,
  time: TimeProvider,
  missionId: string | null = null,
): NarrativeSnapshot | null {
  // Build WHERE clause for mission/tenant scoping
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (tenantId !== null) {
    conditions.push('tenant_id = ?');
    params.push(tenantId);
  } else {
    conditions.push('tenant_id IS NULL');
  }

  if (missionId !== null) {
    conditions.push('source_mission_id = ?');
    params.push(missionId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // 1. Count total claims in scope
  const totalRow = conn.get<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM claim_assertions ${whereClause}`,
    params,
  );
  if (!totalRow || totalRow.cnt === 0) return null;

  // 2. Count distinct subject prefixes (2-segment URN prefix: "entity:type")
  // Subject format: "entity:type:id" → extract "entity:type"
  const subjectsRow = conn.get<{ cnt: number }>(
    `SELECT COUNT(DISTINCT
       CASE
         WHEN INSTR(SUBSTR(subject, INSTR(subject, ':') + 1), ':') > 0
         THEN SUBSTR(subject, 1, INSTR(subject, ':') + INSTR(SUBSTR(subject, INSTR(subject, ':') + 1), ':') - 1)
         ELSE subject
       END
     ) as cnt FROM claim_assertions ${whereClause}`,
    params,
  );
  const subjectsExplored = subjectsRow?.cnt ?? 0;

  // 3. Count decisions (predicate LIKE 'decision.%')
  const decisionsRow = conn.get<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM claim_assertions ${whereClause}${conditions.length > 0 ? ' AND' : ' WHERE'} predicate LIKE 'decision.%' AND status = 'active'`,
    params,
  );
  const decisionsMade = decisionsRow?.cnt ?? 0;

  // 4. Count contradicts relationships in scope
  // Need to join: relationship claims must be in the mission scope
  let conflictsResolved = 0;
  if (missionId !== null) {
    const conflictsRow = conn.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM claim_relationships cr
       INNER JOIN claim_assertions ca ON ca.id = cr.from_claim_id
       WHERE cr.type = 'contradicts'
       AND ca.source_mission_id = ?
       ${tenantId !== null ? 'AND ca.tenant_id = ?' : 'AND ca.tenant_id IS NULL'}`,
      missionId !== null && tenantId !== null ? [missionId, tenantId] : [missionId],
    );
    conflictsResolved = conflictsRow?.cnt ?? 0;
  } else {
    const conflictsRow = conn.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM claim_relationships WHERE type = 'contradicts'`,
      [],
    );
    conflictsResolved = conflictsRow?.cnt ?? 0;
  }

  // 5. Count active (added) and retracted claims
  const activeRow = conn.get<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM claim_assertions ${whereClause}${conditions.length > 0 ? ' AND' : ' WHERE'} status = 'active'`,
    params,
  );
  const claimsAdded = activeRow?.cnt ?? 0;

  const retractedRow = conn.get<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM claim_assertions ${whereClause}${conditions.length > 0 ? ' AND' : ' WHERE'} status = 'retracted'`,
    params,
  );
  const claimsRetracted = retractedRow?.cnt ?? 0;

  // 6. Compute momentum (I-P12-41)
  let momentum: 'growing' | 'stable' | 'declining';
  if (claimsAdded > claimsRetracted) {
    momentum = 'growing';
  } else if (claimsAdded === claimsRetracted) {
    momentum = 'stable';
  } else {
    momentum = 'declining';
  }

  // 7. Thread detection: group by predicate prefix, filter 3+ claims
  const threadPrefix = missionId !== null
    ? `SELECT
         SUBSTR(predicate, 1, INSTR(predicate, '.') - 1) as topic,
         COUNT(*) as claim_count,
         MAX(valid_at) as latest_claim_at,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count,
         SUM(CASE WHEN status = 'retracted' THEN 1 ELSE 0 END) as retracted_count
       FROM claim_assertions
       ${whereClause}
       AND INSTR(predicate, '.') > 0
       GROUP BY topic
       HAVING claim_count >= 3
       ORDER BY claim_count DESC`
    : `SELECT
         SUBSTR(predicate, 1, INSTR(predicate, '.') - 1) as topic,
         COUNT(*) as claim_count,
         MAX(valid_at) as latest_claim_at,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count,
         SUM(CASE WHEN status = 'retracted' THEN 1 ELSE 0 END) as retracted_count
       FROM claim_assertions
       ${whereClause}
       ${conditions.length > 0 ? 'AND' : 'WHERE'} INSTR(predicate, '.') > 0
       GROUP BY topic
       HAVING claim_count >= 3
       ORDER BY claim_count DESC`;

  const threadRows = conn.query<{
    topic: string;
    claim_count: number;
    latest_claim_at: string;
    active_count: number;
    retracted_count: number;
  }>(threadPrefix, params);

  const threads: NarrativeThread[] = threadRows.map(row => {
    let threadMomentum: 'growing' | 'stable' | 'declining';
    if (row.active_count > row.retracted_count) {
      threadMomentum = 'growing';
    } else if (row.active_count === row.retracted_count) {
      threadMomentum = 'stable';
    } else {
      threadMomentum = 'declining';
    }

    return {
      topic: row.topic,
      claimCount: row.claim_count,
      latestClaimAt: row.latest_claim_at,
      momentum: threadMomentum,
    };
  });

  // 8. Store in narrative_snapshots
  const id = randomUUID();
  const nowISO = time.nowISO();
  const snapshotType = missionId ? 'mission' : 'manual';

  conn.run(
    `INSERT INTO narrative_snapshots
     (id, tenant_id, mission_id, snapshot_type, subjects_explored, decisions_made,
      conflicts_resolved, claims_added, claims_retracted, momentum, threads, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, tenantId, missionId, snapshotType,
      subjectsExplored, decisionsMade, conflictsResolved,
      claimsAdded, claimsRetracted, momentum,
      JSON.stringify(threads), nowISO,
    ],
  );

  return {
    id,
    missionId,
    subjectsExplored,
    decisionsMade,
    conflictsResolved,
    claimsAdded,
    claimsRetracted,
    momentum,
    threads,
    createdAt: nowISO,
  };
}
