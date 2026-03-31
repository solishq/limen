/**
 * Phase 5: Cognitive Health Computation.
 *
 * Pure computation module -- no state, no side effects.
 * All data sourced via SQL aggregation queries on the claims database.
 *
 * Spec ref: LIMEN_BUILD_PHASES.md (5.3, 5.4), LIMEN_DEFINITIVE_SPEC_ADDENDUM.md (C.5)
 * Design Source: docs/sprints/PHASE-5-DESIGN-SOURCE.md (Decision 3, Decision 4)
 *
 * Invariants: I-P5-03, I-P5-04, I-P5-05, I-P5-06, I-P5-08, I-P5-09
 * DCs: DC-P5-104, DC-P5-105, DC-P5-106, DC-P5-107, DC-P5-801, DC-P5-802
 */

import type { DatabaseConnection } from '../kernel/interfaces/database.js';
import type { TenantId } from '../kernel/interfaces/index.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import { DEFAULT_FRESH_DAYS, DEFAULT_AGING_DAYS } from './freshness.js';
import type { FreshnessThresholds } from './freshness.js';

// ── Constants ──

const MS_PER_DAY = 86_400_000;

/** Phase 5: Default gap detection threshold (days) */
export const DEFAULT_GAP_THRESHOLD_DAYS = 30;

/** Phase 5: Default stale domain threshold (days) */
export const DEFAULT_STALE_THRESHOLD_DAYS = 30;

/** Phase 5: Default max critical conflicts in health report */
export const DEFAULT_MAX_CRITICAL_CONFLICTS = 10;

/** Phase 5: Default max gaps in health report */
export const DEFAULT_MAX_GAPS = 20;

/** Phase 5: Default max stale domains in health report */
export const DEFAULT_MAX_STALE_DOMAINS = 20;

// ── Types ──

/**
 * Phase 5 §5.3, Addendum C.5: Cognitive health report.
 * Returned by limen.cognitive.health().
 * All fields computed at query-time from the claim database.
 */
export interface CognitiveHealthReport {
  /** Total active (non-retracted) claims */
  readonly totalClaims: number;

  /** Freshness distribution based on last_accessed_at */
  readonly freshness: {
    readonly fresh: number;
    readonly aging: number;
    readonly stale: number;
    readonly percentFresh: number;
  };

  /** Conflict information */
  readonly conflicts: {
    readonly unresolved: number;
    readonly critical: ReadonlyArray<{
      readonly claimIds: readonly [string, string];
      readonly subject: string;
    }>;
  };

  /** Confidence distribution across active claims */
  readonly confidence: {
    readonly mean: number;
    readonly median: number;
    readonly below30: number;
    readonly above90: number;
  };

  /** Domains with no recently ASSERTED claims (based on valid_at) */
  readonly gaps: ReadonlyArray<{
    readonly domain: string;
    readonly lastClaimAge: string;
    readonly significance: 'low' | 'medium' | 'high';
  }>;

  /** Predicates with old and unaccessed claims (based on last_accessed_at) */
  readonly staleDomains: ReadonlyArray<{
    readonly predicate: string;
    readonly newestClaimAge: string;
    readonly claimCount: number;
  }>;
}

/**
 * Phase 5: Configuration for cognitive health computation.
 */
export interface CognitiveHealthConfig {
  readonly gapThresholdDays?: number;
  readonly staleThresholdDays?: number;
  readonly maxCriticalConflicts?: number;
  readonly maxGaps?: number;
  readonly maxStaleDomains?: number;
}

// ── Helpers ──

/**
 * Format millisecond age as human-readable string.
 * e.g., 45 days -> "45 days", 90 days -> "3 months", 365 days -> "1 year"
 */
function formatAge(ageMs: number): string {
  const days = Math.floor(ageMs / MS_PER_DAY);
  if (days < 1) return '0 days';
  if (days === 1) return '1 day';
  if (days < 60) return `${days} days`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month';
  if (months < 12) return `${months} months`;
  const years = Math.floor(days / 365);
  if (years === 1) return '1 year';
  return `${years} years`;
}

/**
 * Extract domain from a predicate. Domain = first segment before the dot.
 * "reflection.decision" -> "reflection"
 * "preference.food" -> "preference"
 */
function extractDomain(predicate: string): string {
  const dotIndex = predicate.indexOf('.');
  return dotIndex >= 0 ? predicate.substring(0, dotIndex) : predicate;
}

// ── Computation ──

/**
 * Compute the full cognitive health report via SQL aggregation.
 * Design Source Decision 3: Single-pass SQL aggregation with targeted supplementary queries.
 *
 * I-P5-06: Empty knowledge base returns all-zero values.
 * I-P5-03: totalClaims matches COUNT(*) WHERE status='active'.
 * I-P5-04: freshness distribution is exhaustive.
 * I-P5-05: conflicts.unresolved counts only active-active contradicts.
 */
export function computeCognitiveHealth(
  conn: DatabaseConnection,
  tenantId: TenantId | null,
  time: TimeProvider,
  freshnessThresholds?: FreshnessThresholds,
  healthConfig?: CognitiveHealthConfig,
): CognitiveHealthReport {
  const nowMs = time.nowMs();
  const freshDays = freshnessThresholds?.freshDays ?? DEFAULT_FRESH_DAYS;
  const agingDays = freshnessThresholds?.agingDays ?? DEFAULT_AGING_DAYS;
  const gapThresholdDays = healthConfig?.gapThresholdDays ?? DEFAULT_GAP_THRESHOLD_DAYS;
  const staleThresholdDays = healthConfig?.staleThresholdDays ?? DEFAULT_STALE_THRESHOLD_DAYS;
  const maxCriticalConflicts = healthConfig?.maxCriticalConflicts ?? DEFAULT_MAX_CRITICAL_CONFLICTS;
  const maxGaps = healthConfig?.maxGaps ?? DEFAULT_MAX_GAPS;
  const maxStaleDomains = healthConfig?.maxStaleDomains ?? DEFAULT_MAX_STALE_DOMAINS;

  // Compute ISO threshold dates for freshness classification
  const freshThresholdMs = nowMs - (freshDays * MS_PER_DAY);
  const agingThresholdMs = nowMs - (agingDays * MS_PER_DAY);
  const freshThresholdISO = new Date(freshThresholdMs).toISOString();
  const agingThresholdISO = new Date(agingThresholdMs).toISOString();

  // Gap threshold: claims older than this are "not recent"
  const gapThresholdMs = nowMs - (gapThresholdDays * MS_PER_DAY);
  const gapThresholdISO = new Date(gapThresholdMs).toISOString();

  // Stale threshold: last_accessed_at older than this marks domain as stale
  const staleThresholdISO = new Date(nowMs - (staleThresholdDays * MS_PER_DAY)).toISOString();

  // ── 1. Total claims ──
  const totalRow = conn.get<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM claim_assertions WHERE status = ? AND tenant_id IS ?',
    ['active', tenantId],
  );
  const totalClaims = totalRow?.cnt ?? 0;

  // I-P5-06: Empty knowledge base fast-path
  if (totalClaims === 0) {
    return {
      totalClaims: 0,
      freshness: { fresh: 0, aging: 0, stale: 0, percentFresh: 0 },
      conflicts: { unresolved: 0, critical: [] },
      confidence: { mean: 0, median: 0, below30: 0, above90: 0 },
      gaps: [],
      staleDomains: [],
    };
  }

  // ── 2. Freshness distribution ──
  // Classify by last_accessed_at (same logic as freshness.ts):
  //   fresh: last_accessed_at >= freshThreshold
  //   aging: last_accessed_at >= agingThreshold AND < freshThreshold
  //   stale: last_accessed_at < agingThreshold OR NULL
  const freshnessRow = conn.get<{ fresh_cnt: number; aging_cnt: number; stale_cnt: number }>(
    `SELECT
      SUM(CASE WHEN last_accessed_at IS NOT NULL AND last_accessed_at >= ? THEN 1 ELSE 0 END) as fresh_cnt,
      SUM(CASE WHEN last_accessed_at IS NOT NULL AND last_accessed_at < ? AND last_accessed_at >= ? THEN 1 ELSE 0 END) as aging_cnt,
      SUM(CASE WHEN last_accessed_at IS NULL OR last_accessed_at < ? THEN 1 ELSE 0 END) as stale_cnt
    FROM claim_assertions
    WHERE status = ? AND tenant_id IS ?`,
    [freshThresholdISO, freshThresholdISO, agingThresholdISO, agingThresholdISO, 'active', tenantId],
  );
  const fresh = freshnessRow?.fresh_cnt ?? 0;
  const aging = freshnessRow?.aging_cnt ?? 0;
  const stale = freshnessRow?.stale_cnt ?? 0;
  const percentFresh = totalClaims > 0 ? Math.round((fresh / totalClaims) * 10000) / 100 : 0;

  // ── 3. Confidence distribution ──
  const confRow = conn.get<{ avg_conf: number; below30_cnt: number; above90_cnt: number }>(
    `SELECT
      AVG(confidence) as avg_conf,
      SUM(CASE WHEN confidence < 0.3 THEN 1 ELSE 0 END) as below30_cnt,
      SUM(CASE WHEN confidence > 0.9 THEN 1 ELSE 0 END) as above90_cnt
    FROM claim_assertions
    WHERE status = ? AND tenant_id IS ?`,
    ['active', tenantId],
  );
  const mean = confRow?.avg_conf ?? 0;
  const below30 = confRow?.below30_cnt ?? 0;
  const above90 = confRow?.above90_cnt ?? 0;

  // Median: offset-based approach (Design Source Decision 3c)
  const medianOffset = Math.floor(totalClaims / 2);
  const medianRow = conn.get<{ median_conf: number }>(
    `SELECT confidence as median_conf FROM claim_assertions
    WHERE status = ? AND tenant_id IS ?
    ORDER BY confidence
    LIMIT 1 OFFSET ?`,
    ['active', tenantId, medianOffset],
  );
  const median = medianRow?.median_conf ?? 0;

  // ── 4. Conflicts ──
  const conflictCountRow = conn.get<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM claim_relationships cr
    JOIN claim_assertions ca1 ON cr.from_claim_id = ca1.id
    JOIN claim_assertions ca2 ON cr.to_claim_id = ca2.id
    WHERE cr.type = 'contradicts'
      AND ca1.status = 'active' AND ca2.status = 'active'
      AND ca1.tenant_id IS ? AND ca2.tenant_id IS ?`,
    [tenantId, tenantId],
  );
  const unresolvedConflicts = conflictCountRow?.cnt ?? 0;

  // Critical conflicts: both claims active, either confidence >= 0.8
  const criticalRows = conn.query<{
    from_id: string; to_id: string; subject: string;
  }>(
    `SELECT cr.from_claim_id as from_id, cr.to_claim_id as to_id, ca1.subject as subject
    FROM claim_relationships cr
    JOIN claim_assertions ca1 ON cr.from_claim_id = ca1.id
    JOIN claim_assertions ca2 ON cr.to_claim_id = ca2.id
    WHERE cr.type = 'contradicts'
      AND ca1.status = 'active' AND ca2.status = 'active'
      AND (ca1.confidence >= 0.8 OR ca2.confidence >= 0.8)
      AND ca1.tenant_id IS ? AND ca2.tenant_id IS ?
    ORDER BY ca1.confidence DESC
    LIMIT ?`,
    [tenantId, tenantId, maxCriticalConflicts],
  );
  const critical = criticalRows.map(r => ({
    claimIds: [r.from_id, r.to_id] as readonly [string, string],
    subject: r.subject,
  }));

  // ── 5. Gap detection (Design Source Decision 4) ──
  // Domain = first segment of predicate (before the dot).
  // Gap = domain with active claims but NO claim with valid_at within gapThreshold.
  const gapRows = conn.query<{
    predicate: string; max_valid_at: string; claim_count: number;
  }>(
    `SELECT predicate, MAX(valid_at) as max_valid_at, COUNT(*) as claim_count
    FROM claim_assertions
    WHERE status = 'active' AND tenant_id IS ?
    GROUP BY predicate
    HAVING MAX(valid_at) < ?`,
    [tenantId, gapThresholdISO],
  );

  // Aggregate by domain (first predicate segment)
  const domainMap = new Map<string, { maxValidAt: string; totalClaims: number }>();
  for (const row of gapRows) {
    const domain = extractDomain(row.predicate);
    const existing = domainMap.get(domain);
    if (!existing || row.max_valid_at > existing.maxValidAt) {
      domainMap.set(domain, {
        maxValidAt: existing ? (row.max_valid_at > existing.maxValidAt ? row.max_valid_at : existing.maxValidAt) : row.max_valid_at,
        totalClaims: (existing?.totalClaims ?? 0) + row.claim_count,
      });
    } else {
      domainMap.set(domain, {
        maxValidAt: existing.maxValidAt,
        totalClaims: existing.totalClaims + row.claim_count,
      });
    }
  }

  // Check that the domain doesn't also have recent predicates (a domain may have
  // some old predicates and some recent ones -- only report if ALL predicates are old).
  // Query: domains that have any predicate with recent valid_at
  const recentDomains = new Set<string>();
  const recentRows = conn.query<{ predicate: string }>(
    `SELECT DISTINCT predicate FROM claim_assertions
    WHERE status = 'active' AND tenant_id IS ? AND valid_at >= ?`,
    [tenantId, gapThresholdISO],
  );
  for (const row of recentRows) {
    recentDomains.add(extractDomain(row.predicate));
  }

  const gaps: Array<{ domain: string; lastClaimAge: string; significance: 'low' | 'medium' | 'high' }> = [];
  const ninetyDaysAgo = new Date(nowMs - 90 * MS_PER_DAY).toISOString();

  for (const [domain, data] of domainMap) {
    if (recentDomains.has(domain)) continue; // Domain has recent claims in other predicates
    const ageMs = nowMs - new Date(data.maxValidAt).getTime();
    let significance: 'low' | 'medium' | 'high' = 'low';
    if (data.totalClaims > 10 && data.maxValidAt < ninetyDaysAgo) {
      significance = 'high';
    } else if (data.totalClaims > 3) {
      significance = 'medium';
    }
    gaps.push({
      domain,
      lastClaimAge: formatAge(ageMs),
      significance,
    });
  }

  // Sort gaps by significance (high first), then by age (oldest first)
  gaps.sort((a, b) => {
    const sigOrder = { high: 0, medium: 1, low: 2 };
    if (sigOrder[a.significance] !== sigOrder[b.significance]) {
      return sigOrder[a.significance] - sigOrder[b.significance];
    }
    return 0; // Preserve insertion order within same significance
  });

  // ── 6. Stale domains (based on last_accessed_at) ──
  const staleRows = conn.query<{
    predicate: string; newest_access: string; claim_count: number;
  }>(
    `SELECT predicate, MAX(last_accessed_at) as newest_access, COUNT(*) as claim_count
    FROM claim_assertions
    WHERE status = 'active' AND tenant_id IS ? AND last_accessed_at IS NOT NULL
    GROUP BY predicate
    HAVING MAX(last_accessed_at) < ?
    ORDER BY MAX(last_accessed_at) ASC
    LIMIT ?`,
    [tenantId, staleThresholdISO, maxStaleDomains],
  );

  // Also include predicates where NO claim has ever been accessed
  const neverAccessedRows = conn.query<{
    predicate: string; claim_count: number;
  }>(
    `SELECT predicate, COUNT(*) as claim_count
    FROM claim_assertions
    WHERE status = 'active' AND tenant_id IS ? AND last_accessed_at IS NULL
    GROUP BY predicate
    LIMIT ?`,
    [tenantId, maxStaleDomains],
  );

  const staleDomains: Array<{ predicate: string; newestClaimAge: string; claimCount: number }> = [];

  for (const row of staleRows) {
    const ageMs = nowMs - new Date(row.newest_access).getTime();
    staleDomains.push({
      predicate: row.predicate,
      newestClaimAge: formatAge(ageMs),
      claimCount: row.claim_count,
    });
  }

  for (const row of neverAccessedRows) {
    if (staleDomains.length >= maxStaleDomains) break;
    staleDomains.push({
      predicate: row.predicate,
      newestClaimAge: 'never accessed',
      claimCount: row.claim_count,
    });
  }

  return {
    totalClaims,
    freshness: { fresh, aging, stale, percentFresh },
    conflicts: { unresolved: unresolvedConflicts, critical },
    confidence: {
      mean: Math.round(mean * 10000) / 10000,
      median: Math.round(median * 10000) / 10000,
      below30,
      above90,
    },
    gaps: gaps.slice(0, maxGaps),
    staleDomains: staleDomains.slice(0, maxStaleDomains),
  };
}
