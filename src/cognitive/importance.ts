/**
 * Phase 12: Importance Engine — 5-factor composite importance scoring.
 *
 * Pure SQL computation. No async operations.
 * All factors normalized to [0, 1].
 *
 * Spec ref: PHASE-12-DESIGN-SOURCE.md (Output 1, Importance Engine)
 * Truth model: I-P12-20 (composite formula), I-P12-21 (factor normalization)
 * DCs: DC-P12-103, DC-P12-801, DC-P12-802
 */

import type { TenantScopedConnection } from '../kernel/tenant/tenant_scope.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type { ImportanceScore, ImportanceWeights } from './cognitive_types.js';
import { DEFAULT_IMPORTANCE_WEIGHTS } from './cognitive_types.js';
import { computeDecayFactor, computeAgeMs } from './decay.js';
import { computeCascadePenalty } from './cascade.js';
import { resolveStability, type StabilityConfig } from './stability.js';

// ── Governance level → weight mapping ──
// Design Source Output 2: governance: classification level mapped
const GOVERNANCE_WEIGHT_MAP: Record<string, number> = {
  unrestricted: 0.2,
  internal: 0.4,
  confidential: 0.6,
  restricted: 0.8,
  critical: 1.0,
};

/**
 * Compute importance score for a single claim.
 *
 * I-P12-20: importanceScore = w1*accessFreq + w2*recency + w3*density + w4*confidence + w5*governance
 * I-P12-21: All factors normalized to [0, 1].
 *
 * @param conn - Database connection (tenant-scoped or global)
 * @param claimId - The claim to score
 * @param tenantId - Tenant scope for normalization queries
 * @param time - Time provider for recency computation
 * @param weights - Factor weights (default: DEFAULT_IMPORTANCE_WEIGHTS)
 * @param stabilityConfig - Stability configuration for decay computation
 * @returns ImportanceScore or null if claim not found
 */
export function computeImportance(
  conn: TenantScopedConnection,
  claimId: string,
  _tenantId: string | null,
  time: TimeProvider,
  weights: ImportanceWeights = DEFAULT_IMPORTANCE_WEIGHTS,
  stabilityConfig?: StabilityConfig,
): ImportanceScore | null {
  // 1. Get the claim
  // F-R1-003 FIX: conn.get() auto-injects tenant_id via TenantScopedConnection.
  // Manual tenantClause removed to prevent double filtering with duplicate params.
  const claim = conn.get<{
    id: string;
    confidence: number;
    valid_at: string;
    access_count: number;
    last_accessed_at: string | null;
    predicate: string;
    classification: string;
  }>(
    `SELECT id, confidence, valid_at, access_count, last_accessed_at, predicate, classification
     FROM claim_assertions
     WHERE id = ? AND status = 'active'`,
    [claimId],
  );

  if (!claim) return null;

  const nowMs = time.nowMs();

  // 2. Access frequency: log(1 + count) / log(1 + MAX(count))
  // F-R1-003 FIX: conn.get() auto-injects tenant_id. Manual clause removed.
  const maxAccessRow = conn.get<{ max_count: number }>(
    `SELECT MAX(access_count) as max_count FROM claim_assertions
     WHERE status = 'active'`,
    [],
  );
  const maxAccessCount = maxAccessRow?.max_count ?? 0;
  const accessFrequency = maxAccessCount > 0
    ? Math.log(1 + claim.access_count) / Math.log(1 + maxAccessCount)
    : 0;

  // 3. Recency: 1 - (days_since_last_access / max_age) clamped [0, 1]
  const MS_PER_DAY = 86_400_000;
  const maxAgeDays = 365; // 1 year normalization ceiling
  const lastAccessMs = claim.last_accessed_at ? Date.parse(claim.last_accessed_at) : null;
  let recency: number;
  if (lastAccessMs !== null && Number.isFinite(lastAccessMs)) {
    const daysSinceAccess = Math.max(0, (nowMs - lastAccessMs) / MS_PER_DAY);
    recency = Math.max(0, Math.min(1, 1 - (daysSinceAccess / maxAgeDays)));
  } else {
    recency = 0; // never accessed = lowest recency
  }

  // 4. Connection density: MIN(relationship_count / 10, 1.0)
  const relRow = conn.get<{ rel_count: number }>(
    `SELECT COUNT(*) as rel_count FROM claim_relationships
     WHERE (from_claim_id = ? OR to_claim_id = ?)`,
    [claimId, claimId],
  );
  const connectionDensity = Math.min((relRow?.rel_count ?? 0) / 10, 1.0);

  // 5. Confidence: effectiveConfidence = confidence * decay * cascadePenalty
  const stabilityDays = resolveStability(claim.predicate, stabilityConfig);
  const ageMs = computeAgeMs(claim.valid_at, nowMs);
  const decayFactor = computeDecayFactor(ageMs, stabilityDays);
  const cascadePenalty = computeCascadePenalty(conn, claimId);
  const confidence = claim.confidence * decayFactor * cascadePenalty;

  // 6. Governance: classification level mapped
  const governanceWeight = GOVERNANCE_WEIGHT_MAP[claim.classification] ?? 0.2;

  // 7. Composite score
  const score =
    weights.accessFrequency * accessFrequency +
    weights.recency * recency +
    weights.connectionDensity * connectionDensity +
    weights.confidence * confidence +
    weights.governance * governanceWeight;

  return {
    claimId,
    score: Math.max(0, Math.min(1, score)),
    factors: {
      accessFrequency,
      recency,
      connectionDensity,
      confidence,
      governanceWeight,
    },
    computedAt: time.nowISO(),
  };
}

/**
 * Batch-compute and cache importance scores for all active claims in a tenant.
 *
 * Upserts into claim_importance table. Used for periodic background scoring.
 *
 * @param conn - Database connection
 * @param tenantId - Tenant scope
 * @param time - Time provider
 * @param weights - Factor weights
 * @param stabilityConfig - Stability configuration
 * @returns Number of claims scored
 */
export function computeBatchImportance(
  conn: TenantScopedConnection,
  tenantId: string | null,
  time: TimeProvider,
  weights: ImportanceWeights = DEFAULT_IMPORTANCE_WEIGHTS,
  stabilityConfig?: StabilityConfig,
): number {
  // F-R1-003 FIX: conn.query() auto-injects tenant_id. Manual clause removed.
  const claims = conn.query<{ id: string }>(
    `SELECT id FROM claim_assertions WHERE status = 'active'`,
    [],
  );

  let scored = 0;
  for (const claim of claims) {
    const score = computeImportance(conn, claim.id, tenantId, time, weights, stabilityConfig);
    if (score) {
      conn.run(
        `INSERT OR REPLACE INTO claim_importance
         (claim_id, tenant_id, importance_score,
          access_frequency_score, recency_score, connection_density_score,
          confidence_score, governance_weight, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          score.claimId, tenantId, score.score,
          score.factors.accessFrequency, score.factors.recency,
          score.factors.connectionDensity, score.factors.confidence,
          score.factors.governanceWeight, score.computedAt,
        ],
      );
      scored++;
    }
  }

  return scored;
}
