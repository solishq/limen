/**
 * Drift Engine — Semantic drift detection at checkpoints.
 * S ref: I-24 (Goal Anchoring), FM-14 (Semantic Drift), FM-16 (Mission Drift)
 *
 * Phase: Sprint 3 (Knowledge Graph)
 *
 * Algorithm:
 *   1. Read goal anchor from core_mission_goals (NOT core_missions — T-S3-018)
 *   2. Compute TF-IDF cosine similarity between objective and assessment text
 *   3. driftScore = 1.0 - similarityScore
 *   4. Threshold: > 0.7 escalated, 0.4-0.7 flagged, < 0.4 none
 *   5. INSERT drift assessment record (append-only)
 *
 * Reuses computeSimilarity from technique_extractor.ts (D1: local TF-IDF cosine).
 * FO-004: upgrade to embedding-based similarity when IC-08 ships.
 *
 * Safety constraints:
 *   - Reads from core_mission_goals (trigger-protected, I-24)
 *   - Tenant isolation via mission_id FK (core_mission_goals has no tenant_id;
 *     isolation is enforced at the mission level — the mission owns the tenant scope)
 *   - Append-only: core_drift_assessments has triggers blocking UPDATE/DELETE
 *   - TimeProvider for all timestamps
 *
 * Spec trace: §4 I-24, §6 FM-14, §16 FM-16
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, AuditTrail, TenantId, MissionId, TimeProvider } from '../../kernel/interfaces/index.js';
import { computeSimilarity } from '../../learning/extractor/technique_extractor.js';

/** Drift thresholds for action classification. */
const DRIFT_ESCALATION_THRESHOLD = 0.7;
const DRIFT_FLAG_THRESHOLD = 0.4;

/** Result of a drift assessment. */
export interface DriftResult {
  /** Drift score: 0 = no drift, 1 = complete drift. */
  readonly driftScore: number;
  /** Similarity score: 0 = no similarity, 1 = identical. */
  readonly similarityScore: number;
  /** Action taken based on thresholds. */
  readonly actionTaken: 'none' | 'flagged' | 'escalated';
  /** Escalation reason (if actionTaken is 'escalated'). */
  readonly escalationReason: string | null;
}

/**
 * Generate a drift assessment ID.
 * Uses TimeProvider for timestamp (I-25 deterministic replay) and
 * crypto.randomUUID for uniqueness (consistency with codebase pattern).
 */
function generateDriftId(time: TimeProvider): string {
  return `drift-${time.nowMs().toString(36)}-${randomUUID().slice(0, 8)}`;
}

/**
 * Assess semantic drift between a checkpoint's assessment text and the mission's
 * goal anchor objective.
 *
 * @param checkpointId - ID of the checkpoint being assessed
 * @param missionId - Mission ID to read goal anchor from
 * @param assessmentText - The checkpoint's assessment text to compare
 * @param conn - Database connection
 * @param tenantId - Tenant ID for isolation (null for single-tenant)
 * @param audit - Audit trail
 * @param time - TimeProvider for timestamps
 * @returns DriftResult with scores and action
 */
export function assessDrift(
  checkpointId: string,
  missionId: MissionId,
  assessmentText: string,
  conn: DatabaseConnection,
  tenantId: TenantId | null,
  audit: AuditTrail,
  time: TimeProvider,
): DriftResult {
  // Step 1: Read goal anchor from core_mission_goals (NOT core_missions — T-S3-018)
  // Tenant isolation via mission_id FK (no tenant_id column on core_mission_goals)
  const goalRow = conn.get<{ objective: string }>(
    `SELECT objective
     FROM core_mission_goals
     WHERE mission_id = ?`,
    [missionId],
  );

  // No goal anchor found: no drift can be detected — graceful fallback
  if (!goalRow) {
    return {
      driftScore: 0,
      similarityScore: 1,
      actionTaken: 'none',
      escalationReason: null,
    };
  }

  // Step 2: Compute similarity using reused computeSimilarity (D1: TF-IDF cosine)
  const similarityScore = computeSimilarity(goalRow.objective, assessmentText);

  // Step 3: driftScore = 1.0 - similarityScore
  const driftScore = 1.0 - similarityScore;

  // Step 4: Classify action based on thresholds
  let actionTaken: 'none' | 'flagged' | 'escalated';
  let escalationReason: string | null = null;

  if (driftScore > DRIFT_ESCALATION_THRESHOLD) {
    actionTaken = 'escalated';
    escalationReason = `goal_drift_detected: drift score ${driftScore.toFixed(3)} exceeds escalation threshold ${DRIFT_ESCALATION_THRESHOLD}`;
  } else if (driftScore >= DRIFT_FLAG_THRESHOLD) {
    actionTaken = 'flagged';
  } else {
    actionTaken = 'none';
  }

  // Step 5: INSERT drift assessment record (append-only)
  const driftId = generateDriftId(time);
  const now = time.nowISO();

  conn.run(
    `INSERT INTO core_drift_assessments
     (id, checkpoint_id, mission_id, tenant_id, drift_score, similarity_score,
      original_objective, current_assessment, action_taken, escalation_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      driftId,
      checkpointId,
      missionId,
      tenantId,
      driftScore,
      similarityScore,
      goalRow.objective,
      assessmentText,
      actionTaken,
      escalationReason,
      now,
    ],
  );

  // I-03: Audit trail for drift assessment
  audit.append(conn, {
    tenantId,
    actorType: 'system',
    actorId: 'drift_engine',
    operation: 'assess_drift',
    resourceType: 'drift_assessment',
    resourceId: driftId,
    detail: {
      checkpointId,
      missionId,
      driftScore,
      similarityScore,
      actionTaken,
    },
  });

  return {
    driftScore,
    similarityScore,
    actionTaken,
    escalationReason,
  };
}
