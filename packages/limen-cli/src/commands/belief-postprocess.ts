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
 * FP-03 + F-BR4-002 + F-BR5-004: Time-based freshness classification.
 *
 * The engine's `freshness` field is access-based (stale = never-accessed),
 * which conflicts with the user's temporal mental model. We reclassify at
 * the CLI layer based on age of `createdAt`:
 *
 *   fresh  : < 1 hour      (includes future-dated — see clock-skew note)
 *   aging  : < 24 hours
 *   stale  : >= 24 hours
 *
 * Clock-skew tolerance: a future-dated claim (ageMs < 0) satisfies
 * `ageMs < ONE_HOUR` trivially and therefore classifies as 'fresh'
 * through the normal sub-hour branch. No dedicated future-dated guard
 * is required — one used to exist (`if (ageMs < 0) return 'fresh'`)
 * but it was dead code: deleting it produced bit-identical output.
 * Keeping it would have been a non-discriminative branch masquerading
 * as a clock-skew policy decision, so it was removed (F-BR5-004).
 *
 * The behavior is intentional: NTP drift and timezone round-trips can
 * produce slightly future createdAt values for freshly-stored claims,
 * and labelling them stale would mislead users. The alternative
 * ('anomalous' / 'unknown') would require a new category consumers
 * don't yet know about. Clock skew is an observability concern, not
 * a content quality concern.
 */
export function computeTimeFreshness(createdAt: string, now: number): 'fresh' | 'aging' | 'stale' {
  const created = Date.parse(createdAt);
  if (isNaN(created)) return 'stale';
  const ageMs = now - created;
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;
  // F-BR5-004: future-dated claims (ageMs < 0) satisfy ageMs < ONE_HOUR
  // and fall into the 'fresh' bucket via this comparison. No separate
  // negative-guard branch is needed.
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
 *
 * F-BR5-003 / F-BR5-005: `disputedUncertain` signals that the CLI could
 * not positively verify dispute state for this belief. It is TRUE when:
 *   (a) the (subject, predicate) relationship query hit the internal
 *       RELATIONSHIP_QUERY_LIMIT ceiling, so the relationship set may
 *       be incomplete, OR
 *   (b) at least one counterpart status lookup failed transiently
 *       (e.g. permission denied, DB error) and the dispute flag could
 *       not be cleared with confidence.
 * When `disputedUncertain` is TRUE, consumers should treat `disputed`
 * as load-bearing and not assume it is authoritative. When FALSE (or
 * absent), the CLI's dispute recomputation was complete.
 */
export type ProcessedBelief = Omit<BeliefView, 'effectiveConfidence' | 'freshness' | 'disputed'> & {
  readonly effectiveConfidence: number;
  readonly freshness: 'fresh' | 'aging' | 'stale';
  readonly disputed: boolean;
  readonly disputedUncertain?: boolean;
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
 * F-BR4-006 + F-BR5-005: Per-invocation cache for dispute recomputation.
 * Keyed by counterpart claimId → status (including the 'unknown' sentinel
 * for lookups that failed transiently). Scoped to one processBeliefs
 * call, so a bulk recall of N beliefs with K distinct counterparts does
 * at most K status lookups rather than N * K.
 *
 * 'unknown' semantics (F-BR5-005 fail-closed): when getClaimStatus
 * errors for reasons other than claim-absence (permission denied,
 * transient DB error, rate limit, engine error), we CANNOT positively
 * verify that the counterpart is gone. Silently coercing the error
 * to 'not_found' — the prior behavior — would flip `disputed` from
 * true to false with no signal to the user. Instead we surface a
 * stderr warning and mark the counterpart as 'unknown'; the dispute
 * recomputer then preserves the engine's flag for any belief whose
 * contradictors include an 'unknown'. This is the project-wide
 * "observability over silent coercion" policy (recurrence #7 of the
 * silent-catch pattern from F-BR4-005).
 */
type CounterpartStatus = 'active' | 'retracted' | 'not_found' | 'unknown';
type CounterpartStatusCache = Map<string, CounterpartStatus>;

function lookupCounterpartStatus(
  limen: Limen,
  cache: CounterpartStatusCache,
  counterpartId: string,
  beliefClaimId: string,
): CounterpartStatus {
  const cached = cache.get(counterpartId);
  if (cached !== undefined) return cached;
  let status: CounterpartStatus;
  try {
    const result = limen.claims.getClaimStatus(counterpartId);
    if (result.ok) {
      status = result.value;
    } else {
      // F-BR5-005: emit structured stderr warning, do NOT coerce to
      // 'not_found'. Caller will preserve belief.disputed when any
      // counterpart is 'unknown'.
      emitWarning({
        code: 'CLI_STATUS_LOOKUP_FAILED',
        message: `getClaimStatus failed for counterpart ${counterpartId}; dispute flag for ${beliefClaimId} preserved as engine-reported`,
        claimId: beliefClaimId,
        counterpartId,
        underlying: result.error.code,
      });
      status = 'unknown';
    }
  } catch (err: unknown) {
    // Defensive: getClaimStatus could synchronously throw (e.g. the
    // permission gateway rejects with an UNAUTHORIZED throw rather
    // than a Result). The fail-closed invariant still applies.
    const code = (err as { code?: string })?.code ?? 'UNKNOWN_ERROR';
    const msg = (err as { message?: string })?.message ?? String(err);
    emitWarning({
      code: 'CLI_STATUS_LOOKUP_FAILED',
      message: `getClaimStatus threw for counterpart ${counterpartId}; dispute flag for ${beliefClaimId} preserved as engine-reported`,
      claimId: beliefClaimId,
      counterpartId,
      underlying: code,
      cause: msg,
    });
    status = 'unknown';
  }
  cache.set(counterpartId, status);
  return status;
}

/**
 * F-BR5-003 / F-BR5-005: CLI-layer structured warning emitter.
 * Writes a single-line JSON object to stderr so that integration
 * tests and downstream tools can consume the warning without parsing
 * the (possibly binary) stdout payload. Keeps stdout reserved for
 * the command's primary output.
 */
function emitWarning(payload: {
  code: string;
  message: string;
  [k: string]: unknown;
}): void {
  try {
    process.stderr.write(JSON.stringify({ warning: payload }) + '\n');
  } catch {
    // If stderr is closed (e.g. piped process died), dropping the
    // warning is acceptable — the per-invocation context is already
    // about to exit. We must not throw from the dispute projection.
  }
}

/**
 * F-BR5-003: Upper bound on the (subject, predicate) relationship
 * fetch in processBeliefs. Pinned to 200 because the engine's
 * queryClaims default limit is small and we want a stable ceiling
 * that is observable rather than silently truncating. If the query
 * returns exactly this many claims, we emit a stderr warning and
 * flag every affected belief's disputedUncertain so consumers can
 * see the correctness cliff instead of silently trusting a
 * potentially-incomplete dispute recomputation.
 *
 * RATIONALE for a hard ceiling instead of pagination: in practice
 * a dense (subject, predicate) group with 200+ active claims is
 * pathological for dispute projection — every belief in the group
 * would require linear-in-group counterpart checks. Pagination here
 * would hide the pathology; the warning surfaces it. If a real
 * workload legitimately exceeds this ceiling, the fix is to
 * restructure the (subject, predicate) naming, not to raise the
 * constant.
 */
const RELATIONSHIP_QUERY_LIMIT = 200;

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
interface DisputeRecomputeResult {
  readonly disputed: boolean;
  /**
   * F-BR5-003 / F-BR5-005: true when dispute recomputation could not
   * verify state with confidence — either because relationships were
   * truncated by the (s,p) fetch limit, or because a counterpart
   * lookup failed. Consumers SHOULD treat `disputed` as load-bearing
   * when `uncertain` is true. Callers propagate this into
   * `ProcessedBelief.disputedUncertain`.
   */
  readonly uncertain: boolean;
}

function recomputeDisputed(
  limen: Limen,
  belief: BeliefView,
  relationships: readonly ClaimRelationship[] | undefined,
  relationshipsTruncated: boolean,
  cache: CounterpartStatusCache,
): DisputeRecomputeResult {
  // FP-10b: A2A event-log entries are never disputes, regardless of edges.
  if (isA2aPredicate(belief.predicate)) return { disputed: false, uncertain: false };
  // If the engine didn't flag disputed AND we have no contradicts edges,
  // short-circuit: nothing to recompute.
  if (!belief.disputed) return { disputed: false, uncertain: false };
  // If we didn't fetch relationships for this belief, we cannot recompute
  // correctly. Preserve the engine's flag AND signal uncertainty.
  if (relationships === undefined) {
    return { disputed: belief.disputed, uncertain: true };
  }

  const contradictsEdges = relationships.filter((r) => r.type === 'contradicts');
  if (contradictsEdges.length === 0) {
    // Engine said disputed but no contradicts edge exists on this claim.
    // If the relationship fetch was truncated, this could be a
    // truncation artifact — preserve the engine flag with uncertainty.
    // Otherwise defensively trust the edge enumeration: no edge, no
    // dispute.
    if (relationshipsTruncated) {
      return { disputed: belief.disputed, uncertain: true };
    }
    return { disputed: false, uncertain: false };
  }

  let sawUnknown = false;
  for (const edge of contradictsEdges) {
    // Counterpart is the "other end" of the directed edge.
    const counterpartId =
      edge.fromClaimId === belief.claimId ? edge.toClaimId : edge.fromClaimId;
    const status = lookupCounterpartStatus(limen, cache, counterpartId as string, belief.claimId as string);
    if (status === 'active') {
      // At least one live contradictor — dispute stands.
      return { disputed: true, uncertain: false };
    }
    if (status === 'unknown') {
      // F-BR5-005: we could not positively verify this counterpart.
      // Do NOT clear the dispute flag on the basis of an unverified
      // counterpart. Record that we saw an unknown and keep scanning
      // for an 'active' counterpart (which would shortcut to true).
      sawUnknown = true;
    }
  }
  if (sawUnknown) {
    // All resolvable counterparts were retracted/not-found, but at
    // least one was 'unknown'. Fail-closed: preserve the engine's
    // disputed flag and surface uncertainty to the consumer.
    return { disputed: belief.disputed, uncertain: true };
  }
  // All contradictors are retracted or not-found: dispute is stale.
  // If the relationship fetch was truncated we may be missing edges;
  // preserve the engine flag with uncertainty in that case.
  if (relationshipsTruncated) {
    return { disputed: belief.disputed, uncertain: true };
  }
  return { disputed: false, uncertain: false };
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
  // F-BR5-003 / F-BR5-005: track which (s,p) groups had truncated or
  // failed fetches. Every belief in a truncated/failed group gets
  // disputedUncertain=true.
  const truncatedGroupKeys = new Set<string>();
  const failedGroupKeys = new Set<string>();
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
      limit: RELATIONSHIP_QUERY_LIMIT,
    });
    if (!result.ok) {
      // F-BR5-005: relationship fetch failed. Emit warning and mark
      // the group so affected beliefs report disputedUncertain=true
      // with their engine flag preserved.
      emitWarning({
        code: 'CLI_RELATIONSHIP_FETCH_FAILED',
        message: `queryClaims failed for ${subject}/${predicate}; disputed flags for this group preserved as engine-reported`,
        subject,
        predicate,
        underlying: result.error.code,
      });
      failedGroupKeys.add(key);
      continue;
    }
    // F-BR5-003: detect truncation at the relationship ceiling.
    if (result.value.claims.length >= RELATIONSHIP_QUERY_LIMIT) {
      emitWarning({
        code: 'CLI_RELATIONSHIP_LIMIT_REACHED',
        message: `relationship fetch for ${subject}/${predicate} hit limit ${RELATIONSHIP_QUERY_LIMIT}; dispute recomputation for this group may be incomplete`,
        subject,
        predicate,
        limit: RELATIONSHIP_QUERY_LIMIT,
      });
      truncatedGroupKeys.add(key);
    }
    for (const item of result.value.claims) {
      if (item.relationships !== undefined) {
        relationshipsByClaimId.set(item.claim.id as string, item.relationships);
      }
    }
  }

  // F-BR4-006: per-invocation counterpart status cache.
  const counterpartCache: CounterpartStatusCache = new Map();

  return filtered.map((b) => {
    const groupKey = `${b.subject}\u0000${b.predicate}`;
    const groupFailed = failedGroupKeys.has(groupKey);
    const groupTruncated = truncatedGroupKeys.has(groupKey);
    // If the group fetch failed entirely, we have no relationships at
    // all for this belief. Preserve the engine flag and flag uncertainty.
    // recomputeDisputed already handles the "relationships === undefined"
    // case, but we also want the uncertainty to reflect the fetch failure
    // specifically (not just that this belief wasn't in the fetch result).
    const rels = relationshipsByClaimId.get(b.claimId);
    const effectiveRels = groupFailed ? undefined : rels;
    const recomputed = recomputeDisputed(
      limen,
      b,
      effectiveRels,
      groupTruncated,
      counterpartCache,
    );
    const disputedUncertain =
      recomputed.uncertain || groupFailed || (groupTruncated && b.disputed);
    const base: ProcessedBelief = {
      ...b,
      effectiveConfidence: round4(b.effectiveConfidence),
      freshness: computeTimeFreshness(b.createdAt, now),
      disputed: recomputed.disputed,
    };
    return disputedUncertain ? { ...base, disputedUncertain: true } : base;
  });
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
