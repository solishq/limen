/**
 * Phase 12: Consolidation Engine — Merge, Archive, Suggest Resolution.
 *
 * Three operations:
 *   1. Merge: Deduplicate similar claims via vector similarity
 *   2. Archive: Mark stale low-confidence low-access claims as archived
 *   3. Suggest resolution: Find contradicts pairs and suggest supersession
 *
 * Spec ref: PHASE-12-DESIGN-SOURCE.md (Output 1, Consolidation Engine)
 * Truth model: I-P12-10 through I-P12-15
 * DCs: DC-P12-101, DC-P12-102, DC-P12-105, DC-P12-302, DC-P12-805, DC-P12-901
 *
 * CRITICAL CONSTRAINTS:
 *   - Merge uses RetractionReason 'superseded' (I-P12-11, CONSTITUTIONAL)
 *   - Merge creates 'supersedes' relationship (I-P12-12, CONSTITUTIONAL)
 *   - Archive sets archived=1, never deletes (I-P12-15)
 *   - Suggestions are pending only (I-P12-30)
 */

import { randomUUID } from 'node:crypto';
import type { TenantScopedConnection } from '../kernel/tenant/tenant_scope.js';
import type { OperationContext } from '../kernel/interfaces/common.js';
import type { MissionId } from '../kernel/interfaces/index.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type { RetractClaimHandler, RelateClaimsHandler, ClaimId } from '../claims/interfaces/claim_types.js';
import type { VectorStore } from '../vector/vector_store.js';
import type {
  ConsolidationOptions,
  ConsolidationResult,
  ConsolidationLogEntry,
  ConflictResolution,
} from './cognitive_types.js';
import { DEFAULT_CONSOLIDATION_OPTIONS } from './cognitive_types.js';
import { computeDecayFactor, computeAgeMs } from './decay.js';
import { computeCascadePenalty } from './cascade.js';
import { classifyFreshness, type FreshnessThresholds } from './freshness.js';
import { resolveStability, type StabilityConfig } from './stability.js';

/**
 * Dependencies for the consolidation engine.
 */
export interface ConsolidationDeps {
  readonly getConnection: () => TenantScopedConnection;
  readonly getContext: () => OperationContext;
  readonly retractClaim: RetractClaimHandler;
  readonly relateClaims: RelateClaimsHandler;
  readonly time: TimeProvider;
  readonly vectorStore: VectorStore | null;
  readonly freshnessThresholds?: FreshnessThresholds | undefined;
  readonly stabilityConfig?: StabilityConfig | undefined;
}

/**
 * Compute effective confidence for a claim.
 * Shared between merge winner selection and conflict resolution.
 */
function computeEffectiveConfidence(
  conn: TenantScopedConnection,
  claimId: string,
  confidence: number,
  validAt: string,
  predicate: string,
  nowMs: number,
  stabilityConfig?: StabilityConfig,
): number {
  const stabilityDays = resolveStability(predicate, stabilityConfig);
  const ageMs = computeAgeMs(validAt, nowMs);
  const decayFactor = computeDecayFactor(ageMs, stabilityDays);
  const cascadePenalty = computeCascadePenalty(conn, claimId);
  return confidence * decayFactor * cascadePenalty;
}

/**
 * Run consolidation: merge + archive + suggest resolution.
 *
 * @param deps - Consolidation dependencies
 * @param options - Consolidation options (thresholds, dry-run)
 * @returns ConsolidationResult with counts and full audit log
 */
export function consolidate(
  deps: ConsolidationDeps,
  options?: ConsolidationOptions,
): ConsolidationResult {
  const opts = { ...DEFAULT_CONSOLIDATION_OPTIONS, ...options };
  const conn = deps.getConnection();
  const ctx = deps.getContext();
  const nowMs = deps.time.nowMs();
  const nowISO = deps.time.nowISO();
  const tenantId = ctx.tenantId;

  const log: ConsolidationLogEntry[] = [];
  let merged = 0;
  let archived = 0;
  const suggestedResolutions: ConflictResolution[] = [];

  // ── Phase 1: Merge (requires vector store) ──
  if (deps.vectorStore && deps.vectorStore.isAvailable() && !opts.dryRun) {
    merged = runMerge(conn, ctx, deps, opts, nowMs, nowISO, tenantId, log);
  }

  // ── Phase 2: Archive ──
  if (!opts.dryRun) {
    archived = runArchive(conn, deps, opts, nowMs, nowISO, tenantId, log);
  }

  // ── Phase 3: Suggest resolution for contradicts pairs ──
  runSuggestResolution(conn, deps, opts, nowMs, nowISO, tenantId, suggestedResolutions, log);

  return { merged, archived, suggestedResolutions, log };
}

/**
 * Merge: deduplicate similar claims via vector similarity.
 * I-P12-10: Winner = highest effectiveConfidence, tiebreak by most recent valid_at.
 * I-P12-11: Losers retracted with reason 'superseded'.
 * I-P12-12: 'supersedes' relationship created from winner to each loser.
 * I-P12-13: Every merge logged in consolidation_log.
 */
function runMerge(
  conn: TenantScopedConnection,
  ctx: OperationContext,
  deps: ConsolidationDeps,
  opts: Required<ConsolidationOptions>,
  nowMs: number,
  nowISO: string,
  tenantId: string | null,
  log: ConsolidationLogEntry[],
): number {
  let merged = 0;

  // Get all active claims that have embeddings
  const tenantClause = tenantId !== null ? 'AND ca.tenant_id = ?' : 'AND ca.tenant_id IS NULL';
  const tenantParams = tenantId !== null ? [tenantId] : [];

  const embeddedClaims = conn.query<{
    id: string;
    subject: string;
    predicate: string;
    confidence: number;
    valid_at: string;
  }>(
    `SELECT ca.id, ca.subject, ca.predicate, ca.confidence, ca.valid_at
     FROM claim_assertions ca
     INNER JOIN embedding_metadata em ON em.claim_id = ca.id
     WHERE ca.status = 'active' AND ca.archived = 0 ${tenantClause}`,
    tenantParams,
  );

  // Track which claims have been processed/retracted to avoid redundant work
  const processed = new Set<string>();

  for (const claim of embeddedClaims) {
    if (processed.has(claim.id)) continue;

    // Get embedding for this claim directly from vec0 table
    let claimVector: number[] | null = null;
    try {
      const embRow = conn.get<{ embedding: Buffer }>(
        `SELECT embedding FROM claim_embeddings WHERE claim_id = ?`,
        [claim.id],
      );
      if (embRow?.embedding) {
        const float32 = new Float32Array(embRow.embedding.buffer, embRow.embedding.byteOffset, embRow.embedding.byteLength / 4);
        claimVector = Array.from(float32);
      }
    } catch {
      // vec0 read failed — skip this claim
    }
    if (!claimVector) continue;

    // KNN search with k=10 to find similar claims
    const knnResult = deps.vectorStore!.knn(
      conn, claimVector, 10, tenantId,
    );
    if (!knnResult.ok) continue;

    // Filter: same subject+predicate, similarity > threshold, not self
    const candidates = knnResult.value
      .filter(r => r.claimId !== claim.id && !processed.has(r.claimId))
      .filter(r => {
        const similarity = 1 - r.distance; // cosine distance → similarity
        return similarity >= opts.mergeSimilarityThreshold;
      });

    for (const candidate of candidates) {
      if (processed.has(candidate.claimId)) continue;

      // Verify same subject + predicate
      const candidateClaim = conn.get<{
        id: string;
        subject: string;
        predicate: string;
        confidence: number;
        valid_at: string;
        status: string;
      }>(
        `SELECT id, subject, predicate, confidence, valid_at, status
         FROM claim_assertions WHERE id = ?`,
        [candidate.claimId],
      );

      if (!candidateClaim || candidateClaim.status !== 'active') continue;
      if (candidateClaim.subject !== claim.subject || candidateClaim.predicate !== claim.predicate) continue;

      // Pick winner by highest effectiveConfidence, tiebreak by most recent
      const ec1 = computeEffectiveConfidence(
        conn, claim.id, claim.confidence, claim.valid_at, claim.predicate, nowMs, deps.stabilityConfig,
      );
      const ec2 = computeEffectiveConfidence(
        conn, candidateClaim.id, candidateClaim.confidence, candidateClaim.valid_at,
        candidateClaim.predicate, nowMs, deps.stabilityConfig,
      );

      let winnerId: string;
      let loserId: string;
      if (ec1 > ec2) {
        winnerId = claim.id;
        loserId = candidateClaim.id;
      } else if (ec2 > ec1) {
        winnerId = candidateClaim.id;
        loserId = claim.id;
      } else {
        // Tiebreak: most recent valid_at
        winnerId = claim.valid_at >= candidateClaim.valid_at ? claim.id : candidateClaim.id;
        loserId = winnerId === claim.id ? candidateClaim.id : claim.id;
      }

      // C2: Wrap retract + relate + consolidation_log in a single transaction for atomicity.
      // Inner handlers (retractClaim, relateClaims) use conn.transaction() internally,
      // which becomes savepoints inside this outer transaction (better-sqlite3 supports nesting).
      const mergeResult = conn.transaction(() => {
        // Retract loser with reason 'superseded' (I-P12-11)
        const retractResult = deps.retractClaim.execute(conn, ctx, {
          claimId: loserId as ClaimId,
          reason: 'superseded',
        });

        if (retractResult.ok) {
          // Create 'supersedes' relationship from winner to loser (I-P12-12)
          // Need a missionId — use the loser's source_mission_id or a synthetic one
          const loserMission = conn.get<{ source_mission_id: string | null }>(
            `SELECT source_mission_id FROM claim_assertions WHERE id = ?`,
            [loserId],
          );
          const missionId = (loserMission?.source_mission_id ?? 'mission:consolidation') as MissionId;

          deps.relateClaims.execute(conn, ctx, {
            fromClaimId: winnerId as ClaimId,
            toClaimId: loserId as ClaimId,
            type: 'supersedes',
            missionId,
          });

          // Log in consolidation_log (I-P12-13)
          const entry: ConsolidationLogEntry = {
            id: randomUUID(),
            operation: 'merge',
            sourceClaimIds: [winnerId, loserId],
            targetClaimId: winnerId,
            reason: `Merged: similarity >= ${opts.mergeSimilarityThreshold}, winner EC=${ec1 > ec2 ? ec1.toFixed(4) : ec2.toFixed(4)}`,
          };

          conn.run(
            `INSERT INTO consolidation_log (id, tenant_id, operation, source_claim_ids, target_claim_id, reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [entry.id, tenantId, entry.operation, JSON.stringify(entry.sourceClaimIds), entry.targetClaimId, entry.reason, nowISO],
          );

          return { ok: true as const, entry };
        }
        return { ok: false as const, entry: null };
      });

      if (mergeResult.ok && mergeResult.entry) {
        log.push(mergeResult.entry);
        processed.add(loserId);
        merged++;
      }
    }

    processed.add(claim.id);
  }

  return merged;
}

/**
 * Archive: mark stale, low-confidence, low-access claims.
 * I-P12-14: All three conditions required (stale AND low confidence AND low access).
 * I-P12-15: Sets archived=1, never deletes.
 */
function runArchive(
  conn: TenantScopedConnection,
  deps: ConsolidationDeps,
  opts: Required<ConsolidationOptions>,
  nowMs: number,
  nowISO: string,
  tenantId: string | null,
  log: ConsolidationLogEntry[],
): number {
  let archived = 0;

  const tenantClause = tenantId !== null ? 'AND tenant_id = ?' : 'AND tenant_id IS NULL';
  const tenantParams = tenantId !== null ? [tenantId] : [];

  // Get all active, non-archived claims with low access count
  const candidates = conn.query<{
    id: string;
    confidence: number;
    valid_at: string;
    predicate: string;
    access_count: number;
    last_accessed_at: string | null;
  }>(
    `SELECT id, confidence, valid_at, predicate, access_count, last_accessed_at
     FROM claim_assertions
     WHERE status = 'active' AND archived = 0
     AND access_count <= ? ${tenantClause}`,
    [opts.archiveMaxAccessCount, ...tenantParams],
  );

  for (const claim of candidates) {
    // Check freshness = stale
    const lastAccessMs = claim.last_accessed_at ? Date.parse(claim.last_accessed_at) : null;
    const freshness = classifyFreshness(
      lastAccessMs && Number.isFinite(lastAccessMs) ? lastAccessMs : null,
      nowMs,
      deps.freshnessThresholds,
    );
    if (freshness !== 'stale') continue;

    // Check effectiveConfidence < archiveMaxConfidence
    const ec = computeEffectiveConfidence(
      conn, claim.id, claim.confidence, claim.valid_at, claim.predicate, nowMs, deps.stabilityConfig,
    );
    if (ec >= opts.archiveMaxConfidence) continue;

    // C2: Wrap archive UPDATE + consolidation_log INSERT in a transaction for atomicity.
    const entry: ConsolidationLogEntry = conn.transaction(() => {
      // Archive: set archived=1 (I-P12-15: reversible, never deleted)
      conn.run(
        `UPDATE claim_assertions SET archived = 1 WHERE id = ?`,
        [claim.id],
      );

      const logEntry: ConsolidationLogEntry = {
        id: randomUUID(),
        operation: 'archive',
        sourceClaimIds: [claim.id],
        targetClaimId: null,
        reason: `Archived: stale, EC=${ec.toFixed(4)} < ${opts.archiveMaxConfidence}, access=${claim.access_count}`,
      };

      conn.run(
        `INSERT INTO consolidation_log (id, tenant_id, operation, source_claim_ids, target_claim_id, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [logEntry.id, tenantId, logEntry.operation, JSON.stringify(logEntry.sourceClaimIds), logEntry.targetClaimId, logEntry.reason, nowISO],
      );

      return logEntry;
    });

    log.push(entry);
    archived++;
  }

  return archived;
}

/**
 * Suggest resolution: find active contradicts pairs and suggest supersession.
 * If confidence ratio < 0.5, suggest the weaker claim be superseded.
 * Stored in connection_suggestions as pending.
 */
function runSuggestResolution(
  conn: TenantScopedConnection,
  deps: ConsolidationDeps,
  _opts: Required<ConsolidationOptions>,
  nowMs: number,
  nowISO: string,
  tenantId: string | null,
  suggestedResolutions: ConflictResolution[],
  log: ConsolidationLogEntry[],
): void {
  // Find all active contradicts pairs
  const tenantClause = tenantId !== null
    ? 'AND ca1.tenant_id = ? AND ca2.tenant_id = ?'
    : 'AND ca1.tenant_id IS NULL AND ca2.tenant_id IS NULL';
  const tenantParams = tenantId !== null ? [tenantId, tenantId] : [];

  const pairs = conn.query<{
    rel_id: string;
    from_id: string;
    to_id: string;
    from_confidence: number;
    from_valid_at: string;
    from_predicate: string;
    to_confidence: number;
    to_valid_at: string;
    to_predicate: string;
  }>(
    `SELECT
       cr.id as rel_id,
       cr.from_claim_id as from_id, cr.to_claim_id as to_id,
       ca1.confidence as from_confidence, ca1.valid_at as from_valid_at, ca1.predicate as from_predicate,
       ca2.confidence as to_confidence, ca2.valid_at as to_valid_at, ca2.predicate as to_predicate
     FROM claim_relationships cr
     INNER JOIN claim_assertions ca1 ON ca1.id = cr.from_claim_id AND ca1.status = 'active'
     INNER JOIN claim_assertions ca2 ON ca2.id = cr.to_claim_id AND ca2.status = 'active'
     WHERE cr.type = 'contradicts' ${tenantClause}`,
    tenantParams,
  );

  for (const pair of pairs) {
    const ec1 = computeEffectiveConfidence(
      conn, pair.from_id, pair.from_confidence, pair.from_valid_at, pair.from_predicate, nowMs, deps.stabilityConfig,
    );
    const ec2 = computeEffectiveConfidence(
      conn, pair.to_id, pair.to_confidence, pair.to_valid_at, pair.to_predicate, nowMs, deps.stabilityConfig,
    );

    // Compute ratio: weaker / stronger
    const stronger = ec1 >= ec2 ? pair.from_id : pair.to_id;
    const weaker = stronger === pair.from_id ? pair.to_id : pair.from_id;
    const strongerEC = Math.max(ec1, ec2);
    const weakerEC = Math.min(ec1, ec2);
    const ratio = strongerEC > 0 ? weakerEC / strongerEC : 1;

    if (ratio < 0.5) {
      const resolution: ConflictResolution = {
        contradictionId: pair.rel_id,
        weakerClaimId: weaker,
        strongerClaimId: stronger,
        confidenceRatio: ratio,
      };
      suggestedResolutions.push(resolution);

      // Store in connection_suggestions as pending
      const suggId = randomUUID();
      conn.run(
        `INSERT INTO connection_suggestions
         (id, tenant_id, from_claim_id, to_claim_id, suggested_type, similarity, status, created_at)
         VALUES (?, ?, ?, ?, 'supports', ?, 'pending', ?)`,
        [suggId, tenantId, stronger, weaker, 1 - ratio, nowISO],
      );

      const entry: ConsolidationLogEntry = {
        id: randomUUID(),
        operation: 'resolve',
        sourceClaimIds: [stronger, weaker],
        targetClaimId: null,
        reason: `Suggested resolution: confidence ratio ${ratio.toFixed(4)} < 0.5`,
      };
      conn.run(
        `INSERT INTO consolidation_log (id, tenant_id, operation, source_claim_ids, target_claim_id, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [entry.id, tenantId, entry.operation, JSON.stringify(entry.sourceClaimIds), entry.targetClaimId, entry.reason, nowISO],
      );
      log.push(entry);
    }
  }
}
