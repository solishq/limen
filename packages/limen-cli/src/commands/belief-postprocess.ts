/**
 * Belief postprocessing helpers — CLI presentation layer.
 *
 * These helpers transform engine BeliefView objects into the shape exposed
 * to end users. They fix presentation bugs that surface at the CLI layer:
 *
 *  - FP-03: time-based freshness (engine field is access-based)
 *  - FP-04: round effectiveConfidence to 4 decimals
 *  - FP-06: recompute `disputed` by excluding retracted counterparts
 *  - FP-10: exclude a2a.message claims from bare recall
 *
 * These are NOT patches to the engine (HB #21). They are projection-layer
 * corrections that restore the documented contract at the CLI boundary.
 * Each correction is auditable: the engine's raw values are discarded in
 * favour of values derived from a fresh query of current active state.
 */
import type { Limen, BeliefView } from 'limen-ai';

/**
 * FP-03: Time-based freshness classification.
 *
 * The engine's `freshness` field is access-based (stale = never-accessed),
 * which conflicts with the user's temporal mental model. We reclassify at
 * the CLI layer based on age of `createdAt`:
 *
 *   fresh  : < 1 hour
 *   aging  : < 24 hours
 *   stale  : >= 24 hours
 *
 * This matches the user's intuition as documented in WITNESS-CLI-TESTIMONY
 * FP-03. The engine's raw freshness field is replaced in the output.
 */
export function computeTimeFreshness(createdAt: string, now: number): 'fresh' | 'aging' | 'stale' {
  const created = Date.parse(createdAt);
  if (isNaN(created)) return 'stale';
  const ageMs = now - created;
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;
  if (ageMs < ONE_HOUR) return 'fresh';
  if (ageMs < ONE_DAY) return 'aging';
  return 'stale';
}

/**
 * FP-04: Round effectiveConfidence to 4 decimal places.
 * Inline to avoid cross-module import in command files.
 */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
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
 * FP-06: Recompute `disputed` for a single belief.
 *
 * The engine marks a claim disputed if any 'contradicts' relationship exists,
 * regardless of whether the counterpart has been retracted. After forget(),
 * retracted claims are excluded from recall(status=active), so if the ONLY
 * contradictor was retracted, the surviving claim's disputed flag is stale.
 *
 * We recompute: if the engine says disputed=true, query all ACTIVE claims with
 * the same (subject, predicate) including superseded. If no other active claim
 * exists, no live dispute remains — override to false.
 *
 * Cost: one extra recall per disputed belief. Disputes are rare, so the
 * overhead is bounded. For non-disputed beliefs we skip the query entirely.
 */
function recomputeDisputed(limen: Limen, belief: BeliefView): boolean {
  // FP-10b: A2A messages are an event log, not contradicting assertions.
  // Sequential messages to the same channel share (subject, predicate) with
  // different values — the engine flags these as disputes, but they are not.
  if (belief.predicate === 'a2a.message') return false;
  if (!belief.disputed) return false;
  const result = limen.recall(belief.subject, belief.predicate, {
    includeSuperseded: true,
    limit: 50,
  });
  if (!result.ok) return belief.disputed; // fallback: preserve engine value
  // Count ACTIVE claims (retracted are already excluded by recall) other than self.
  const others = result.value.filter((b) => b.claimId !== belief.claimId);
  return others.length > 0;
}

/**
 * FP-10a: Should this belief be included in bare recall output?
 *
 * A2A messages are stored as claims with predicate 'a2a.message'. They are
 * infrastructure, not user knowledge. When the user calls `recall` WITHOUT
 * an explicit predicate filter, we exclude them by default. When the user
 * explicitly passes `--predicate a2a.message` or `--predicate a2a.*`, we
 * include them.
 */
export function shouldIncludeA2a(userPredicate: string | undefined): boolean {
  if (userPredicate === undefined) return false;
  // Explicit a2a.* or a2a.message — include.
  if (userPredicate === 'a2a.message') return true;
  if (userPredicate === 'a2a.*') return true;
  if (userPredicate.startsWith('a2a.')) return true;
  return false;
}

/**
 * Apply all belief-level CLI corrections. Callers pass the raw engine beliefs
 * plus the context flags that govern filtering.
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
  const filtered = includeA2a ? beliefs : beliefs.filter((b) => b.predicate !== 'a2a.message');
  return filtered.map((b) => ({
    ...b,
    effectiveConfidence: round4(b.effectiveConfidence),
    freshness: computeTimeFreshness(b.createdAt, now),
    disputed: recomputeDisputed(limen, b),
  }));
}
