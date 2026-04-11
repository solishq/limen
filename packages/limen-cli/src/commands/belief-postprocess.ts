/**
 * Belief postprocessing helpers — CLI presentation layer.
 *
 * These helpers transform engine BeliefView objects into the shape exposed
 * to end users. They fix presentation bugs that surface at the CLI layer:
 *
 *  - FP-03: time-based freshness (engine field is access-based)
 *  - FP-04: round effectiveConfidence to 4 decimals (clamped to [0, 1])
 *  - FP-06: recompute `disputed` from relationship edges + counterpart status
 *  - FP-10: exclude a2a.* claims from bare recall
 *
 * These are NOT patches to the engine (HB #21). They are projection-layer
 * corrections that restore the documented contract at the CLI boundary.
 * Each correction is auditable: the engine's raw values are replaced by
 * values derived from a fresh query of current active state.
 *
 * === F-BR4 Loopback Notes ===
 * The prior implementation of recomputeDisputed used a heuristic
 * ("any other claim with same (subject, predicate) implies dispute"),
 * which passed its unit test only by the degenerate 2-claim construction
 * and produced false positives on any group of 3+ claims. That heuristic
 * is DELETED. The correct invariant is used instead: a claim is disputed
 * iff at least one active 'contradicts' relationship edge connects it to
 * an active counterpart. Counterpart status is resolved via
 * `limen.claims.getClaimStatus` (added in the same loopback pass).
 */
import type { Limen, BeliefView, ClaimRelationship } from 'limen-ai';

/**
 * FP-03 + F-BR4-002: Time-based freshness classification.
 *
 * The engine's `freshness` field is access-based (stale = never-accessed),
 * which conflicts with the user's temporal mental model. We reclassify at
 * the CLI layer based on age of `createdAt`:
 *
 *   fresh  : < 1 hour
 *   aging  : < 24 hours
 *   stale  : >= 24 hours
 *
 * Future-dated claims (ageMs < 0) are classified as 'fresh'. This is an
 * explicit clock-skew tolerance — NTP drift and timezone round-trips can
 * produce slightly future createdAt values for freshly-stored claims.
 * Treating them as stale would mislabel healthy data. The alternative
 * ('anomalous' / 'unknown') would require a new category consumers don't
 * yet know about. Clock skew is an observability concern, not a content
 * quality concern.
 */
export function computeTimeFreshness(createdAt: string, now: number): 'fresh' | 'aging' | 'stale' {
  const created = Date.parse(createdAt);
  if (isNaN(created)) return 'stale';
  const ageMs = now - created;
  // F-BR4-002: clock-skew tolerance — future-dated claims are 'fresh'.
  if (ageMs < 0) return 'fresh';
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;
  if (ageMs < ONE_HOUR) return 'fresh';
  if (ageMs < ONE_DAY) return 'aging';
  return 'stale';
}

/**
 * FP-04 + F-BR4-003: Round effectiveConfidence to 4 decimal places,
 * clamped to the legal [0, 1] range.
 *
 * Native Math.round on 0.99995 returns 1.0000 due to IEEE 754 representation
 * (0.99995 * 10000 = 9999.5 exactly, then half-up rounds to 10000). The
 * engine permits effectiveConfidence in [0, 1], so 1.0 IS a legitimate
 * value — but the clamp still matters for NaN/Infinity/-0.0001/1.0001
 * inputs that would otherwise propagate or escape the legal range.
 *
 * NaN propagation: the engine's cascade/decay math can produce NaN on
 * extreme edge cases (see F-P3-001). JSON.stringify(NaN) = null, and a
 * null effectiveConfidence confuses consumers. We map NaN to 0.
 */
function round4(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (!Number.isFinite(n)) return n > 0 ? 1 : 0;
  const rounded = Math.round(n * 10000) / 10000;
  // F-BR4-003: clamp to [0, 1]. 1.0 is legitimate; we only defend against
  // values that escape the legal range via rounding error or upstream bugs.
  if (rounded < 0) return 0;
  if (rounded > 1) return 1;
  return rounded;
}

/**
 * A processed belief: same shape as BeliefView, but with CLI-layer corrections
 * applied. We spread the original and override the corrected fields so the
 * output remains compatible with existing consumers.
 */
export type ProcessedBelief = Omit<BeliefView, 'effectiveConfidence' | 'freshness' | 'disputed'> & {
  readonly effectiveConfidence: number;
  readonly freshness: 'fresh' | 'aging' | 'stale';
  readonly disputed: boolean;
};

/**
 * F-BR4-007: Unified A2A predicate matcher.
 *
 * The prior implementation checked `predicate === 'a2a.message'` in one
 * place and `predicate.startsWith('a2a.')` in another, leaving a latent
 * asymmetry: a future `a2a.event` claim would be INCLUDED by
 * shouldIncludeA2a (because it matches the prefix) but NOT filtered out
 * of bare recall (because that check used exact-equality on
 * 'a2a.message' only). This single helper is used by both sides to
 * guarantee symmetry.
 */
export function isA2aPredicate(predicate: string): boolean {
  return predicate.startsWith('a2a.');
}

/**
 * F-BR4-006: Per-invocation cache for dispute recomputation.
 * Keyed by counterpart claimId → status. Scoped to one processBeliefs call,
 * so a bulk recall of N beliefs with K distinct counterparts does at most
 * K status lookups rather than N * K.
 */
type CounterpartStatusCache = Map<string, 'active' | 'retracted' | 'not_found'>;

function lookupCounterpartStatus(
  limen: Limen,
  cache: CounterpartStatusCache,
  counterpartId: string,
): 'active' | 'retracted' | 'not_found' {
  const cached = cache.get(counterpartId);
  if (cached !== undefined) return cached;
  const result = limen.claims.getClaimStatus(counterpartId);
  // Failure (e.g. permission denied, transient DB error) is treated
  // conservatively as 'not_found' — we refuse to assert a dispute we
  // cannot positively verify. The engine's original flag is still
  // authoritative via the fallback path below.
  const status = result.ok ? result.value : 'not_found';
  cache.set(counterpartId, status);
  return status;
}

/**
 * FP-06 + F-BR4-004: Recompute `disputed` for a single belief.
 *
 * REAL INVARIANT (not the prior heuristic): a claim is disputed iff at
 * least one active 'contradicts' relationship edge connects it to an
 * active counterpart.
 *
 * Input: the belief itself plus its `relationships` array from the engine
 * (populated by queryClaims({includeRelationships: true})). The
 * relationships array contains ClaimRelationship rows the engine stored
 * against this claim; they are immutable once created (I-31), so
 * retraction of a counterpart does NOT remove the edge. We must therefore
 * check counterpart claim status separately.
 *
 * Algorithm:
 *   1. Filter edges to type === 'contradicts'.
 *   2. For each edge, resolve the counterpart claimId (the "other side").
 *   3. Query counterpart status via limen.claims.getClaimStatus.
 *   4. Return true iff any counterpart is 'active'.
 *
 * Cost: O(contradicts-edges) per belief, with a per-batch cache on
 * counterpart status. For a bulk recall with a dense dispute graph the
 * amortised cost is O(distinct counterparts), not O(beliefs × edges).
 *
 * FP-10b: a2a.* claims are an event log, not contradicting assertions.
 * Sequential messages to the same channel share (subject, predicate) with
 * different values — the engine's auto-contradicts config flags these as
 * disputes, but they are not. Skip dispute recomputation entirely for
 * a2a.* predicates.
 */
function recomputeDisputed(
  limen: Limen,
  belief: BeliefView,
  relationships: readonly ClaimRelationship[] | undefined,
  cache: CounterpartStatusCache,
): boolean {
  // FP-10b: A2A event-log entries are never disputes, regardless of edges.
  if (isA2aPredicate(belief.predicate)) return false;
  // If the engine didn't flag disputed AND we have no contradicts edges,
  // short-circuit: nothing to recompute.
  if (!belief.disputed) return false;
  // If we didn't fetch relationships for this belief, we cannot recompute
  // correctly. Preserve the engine's flag rather than silently claiming
  // 'not disputed'.
  if (relationships === undefined) return belief.disputed;

  const contradictsEdges = relationships.filter((r) => r.type === 'contradicts');
  if (contradictsEdges.length === 0) {
    // Engine said disputed but no contradicts edge exists on this claim.
    // This is unexpected but defensively we trust the edge enumeration:
    // no edge, no dispute.
    return false;
  }

  for (const edge of contradictsEdges) {
    // Counterpart is the "other end" of the directed edge.
    const counterpartId =
      edge.fromClaimId === belief.claimId ? edge.toClaimId : edge.fromClaimId;
    const status = lookupCounterpartStatus(limen, cache, counterpartId as string);
    if (status === 'active') {
      // At least one live contradictor — dispute stands.
      return true;
    }
  }
  // All contradictors are retracted or not-found: dispute is stale.
  return false;
}

/**
 * FP-10a + F-BR4-007: Should this belief be included in bare recall output?
 *
 * A2A messages and other a2a.* predicates are infrastructure, not user
 * knowledge. When the user calls `recall` WITHOUT an explicit predicate
 * filter, we exclude them by default. When the user explicitly passes
 * `--predicate a2a.message` or `--predicate a2a.*`, we include them.
 *
 * This function and the bare-recall filter in processBeliefs share
 * `isA2aPredicate` to prevent the F-BR4-007 asymmetry recurrence.
 */
export function shouldIncludeA2a(userPredicate: string | undefined): boolean {
  if (userPredicate === undefined) return false;
  if (userPredicate === 'a2a.*') return true;
  return isA2aPredicate(userPredicate);
}

/**
 * Apply all belief-level CLI corrections. Callers pass the raw engine beliefs
 * plus the context flags that govern filtering.
 *
 * F-BR4-004 / F-BR4-006: relationships for dispute recomputation are
 * fetched from the engine via queryClaims({includeRelationships: true})
 * batched per (subject, predicate) group. The resulting relationships map
 * is keyed by claimId.
 *
 * @param limen Engine handle (for FP-06 dispute recomputation)
 * @param beliefs Raw engine BeliefView array
 * @param userPredicate The --predicate flag the user passed (for FP-10a)
 * @param now Current timestamp in ms (for FP-03 freshness)
 */
export function processBeliefs(
  limen: Limen,
  beliefs: readonly BeliefView[],
  userPredicate: string | undefined,
  now: number,
): ProcessedBelief[] {
  const includeA2a = shouldIncludeA2a(userPredicate);
  // F-BR4-007: symmetric filter with shouldIncludeA2a — both use
  // isA2aPredicate. A future a2a.event or a2a.ack claim is automatically
  // excluded from bare recall without further code changes.
  const filtered = includeA2a ? beliefs : beliefs.filter((b) => !isA2aPredicate(b.predicate));

  // F-BR4-004 / F-BR4-006: Fetch relationship edges in batches keyed by
  // (subject, predicate). Most recall calls touch 1-2 distinct (s, p)
  // tuples, so this is usually a single round-trip regardless of belief
  // count. The engine's includeRelationships path returns all edges
  // touching each returned claim.
  const relationshipsByClaimId = new Map<string, readonly ClaimRelationship[]>();
  // Build (s, p) keys to query. We only need to fetch for beliefs whose
  // engine disputed flag is true AND which are NOT a2a.* (because
  // recomputeDisputed short-circuits those two cases).
  const groupKeys = new Set<string>();
  for (const b of filtered) {
    if (!b.disputed) continue;
    if (isA2aPredicate(b.predicate)) continue;
    groupKeys.add(`${b.subject}\u0000${b.predicate}`);
  }
  for (const key of groupKeys) {
    const sep = key.indexOf('\u0000');
    const subject = key.slice(0, sep);
    const predicate = key.slice(sep + 1);
    const result = limen.claims.queryClaims({
      subject,
      predicate,
      status: 'active',
      includeRelationships: true,
      limit: 200,
    });
    if (!result.ok) continue;
    for (const item of result.value.claims) {
      if (item.relationships !== undefined) {
        relationshipsByClaimId.set(item.claim.id as string, item.relationships);
      }
    }
  }

  // F-BR4-006: per-invocation counterpart status cache.
  const counterpartCache: CounterpartStatusCache = new Map();

  return filtered.map((b) => ({
    ...b,
    effectiveConfidence: round4(b.effectiveConfidence),
    freshness: computeTimeFreshness(b.createdAt, now),
    disputed: recomputeDisputed(limen, b, relationshipsByClaimId.get(b.claimId), counterpartCache),
  }));
}

// F-BR4-002/003/004/006/007: test-only exports for direct unit testing
// (integration tests via the CLI binary cannot exercise round4/isA2aPredicate
// in isolation because they are internal functions). Exported as a single
// namespace to minimize the public surface.
export const __TEST_ONLY__ = Object.freeze({
  round4,
  isA2aPredicate,
  computeTimeFreshness,
});
