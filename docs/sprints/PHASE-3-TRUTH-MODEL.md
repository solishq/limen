# PHASE 3 TRUTH MODEL: Cognitive Metabolism

**Date**: 2026-03-30
**Author**: Builder (SolisHQ Engineering)
**Governing Documents**: PHASE-3-DESIGN-SOURCE.md, CLAUDE.md
**Codebase Baseline**: Phase 0+1+2 complete, 3,317 passing tests, schema v38, commit `e3b8d5a`

---

## INVARIANTS

### I-P3-01: Decay Formula Correctness [CONSTITUTIONAL]

**Statement**: For all claims with age `t` (milliseconds) and stability `S` (days):
```
R(t) = (1 + (t/86400000) / (9 * S))^(-1)
```
Where:
- `t >= 0` (clamped from `max(0, nowMs - Date.parse(validAt))`)
- `S > 0` (enforced by guard clause and validation)
- `R(t)` is in the range `(0.0, 1.0]`
- `R(0) = 1.0` (no decay for brand-new claims)

**Test vectors**: 10 known input/output pairs from Design Source.

### I-P3-02: Effective Confidence Derivation [CONSTITUTIONAL]

**Statement**: For all claims:
```
effectiveConfidence = confidence * R(age, stability)
```
Where:
- `confidence` is the raw stored confidence `[0.0, 1.0]`
- `effectiveConfidence` is in `[0.0, confidence]` (never exceeds raw)
- `effectiveConfidence` is computed on every read, NEVER stored

### I-P3-03: Stability Assignment [QUALITY_GATE]

**Statement**: Every claim's stability value is:
1. Resolved from its predicate at creation time via pattern matching
2. Stored in the `stability` column
3. Immutable after creation (predicate is immutable, stability derives from predicate)
4. Always > 0 (minimum enforced by guard clause)

**Default patterns** (first match wins, user patterns prepend):
| Pattern | Stability (days) |
|---------|-----------------|
| `governance.*`, `system.*`, `lifecycle.*` | 365 |
| `architecture.*`, `decision.*`, `design.*` | 180 |
| `preference.*`, `reflection.pattern`, `reflection.decision` | 120 |
| `finding.*`, `observation.*`, `reflection.finding` | 90 |
| `warning.*`, `reflection.warning` | 30 |
| `ephemeral.*`, `session.*`, `scratch.*` | 7 |
| *(unmatched)* | 90 (default) |

### I-P3-04: No Stored Decay [CONSTITUTIONAL]

**Statement**: The `effective_confidence` value is NEVER written to the database. No SQL statement of the form `UPDATE ... SET effective_confidence = ...` exists in the codebase. Decay is a query-time computation per Addendum A.3.

### I-P3-05: Access Tracking Scope [QUALITY_GATE]

**Statement**: Access events are recorded at the `ClaimApiImpl` level (system-call boundary), AFTER query/search results are returned. Only claims that are RETURNED to the caller are tracked. Claims fetched-then-filtered are NOT tracked.

### I-P3-06: Freshness Classification [CONSTITUTIONAL]

**Statement**: For all claims with `lastAccessedAt` and `nowMs`:
```
daysSinceAccess = (nowMs - lastAccessedAtMs) / 86_400_000

if lastAccessedAt is null:     'stale'
elif daysSinceAccess < freshDays (default 7):   'fresh'
elif daysSinceAccess < agingDays (default 30):  'aging'
else:                                            'stale'
```

Thresholds are configurable via `FreshnessThresholds`.

### I-P3-07: Two-Phase minConfidence Filtering [CONSTITUTIONAL]

**Statement**: When `minConfidence` is specified in a query:
1. **Phase 1 (SQL)**: `WHERE confidence >= minConfidence` pre-filters. This is a NECESSARY condition because `effectiveConfidence <= confidence` (since `R(t) <= 1.0`).
2. **Phase 2 (TypeScript)**: After decay computation, filter `effectiveConfidence >= minConfidence`. This is the EXACT condition.

No claim where `effectiveConfidence >= minConfidence` is ever excluded by Phase 1 (mathematical guarantee).

### I-P3-08: Search Score Formula [CONSTITUTIONAL]

**Statement**: For Phase 3, the search score formula is:
```
score = abs(bm25_rank) * effectiveConfidence
```
(Changed from `abs(bm25_rank) * confidence` in Phase 2.)

Results are re-sorted by new score in TypeScript after decay computation.

### I-P3-09: Migration Additivity [CONSTITUTIONAL]

**Statement**: Migration v39 contains ONLY:
- `ALTER TABLE claim_assertions ADD COLUMN` statements (3 columns)
- `CREATE INDEX IF NOT EXISTS` (1 index)

No column drops. No column modifications. No data deletion. Existing data preserved.

### I-P3-10: Migration Defaults [CONSTITUTIONAL]

**Statement**: After migration v39, existing claims have:
- `last_accessed_at = NULL` (never accessed)
- `access_count = 0` (never accessed)
- `stability = 90.0` (default finding category)

### I-P3-11: TimeProvider Injection [CONSTITUTIONAL]

**Statement**: All temporal logic in the cognitive metabolism module uses `TimeProvider` (via `nowMs` parameter). No direct `Date.now()` calls in `src/cognitive/` or in the decay/freshness computation paths.

### I-P3-12: AccessTracker Lifecycle [QUALITY_GATE]

**Statement**: The AccessTracker has three states: ACTIVE, FLUSHING, DESTROYED.
- After DESTROYED: no writes to database, no timer fires.
- `destroy()` clears the interval timer via stored interval ID (PA Amendment).
- `flush()` is called before `destroy()` during shutdown.

### I-P3-13: Flush Interval ID Storage [QUALITY_GATE]

**Statement** (PA Amendment): The `setInterval` reference is stored as a strongly-held interval ID in the AccessTracker. The ID is used for explicit `clearInterval()` during shutdown. Not just `unref()`'d and forgotten.

### I-P3-14: BeliefView Extension [CONSTITUTIONAL]

**Statement**: `BeliefView` gains 5 new required fields:
- `effectiveConfidence: number`
- `freshness: FreshnessLabel`
- `stability: number`
- `lastAccessedAt: string | null`
- `accessCount: number`

All fields are always computable. No optional (`?`) declarations.

### I-P3-15: CognitiveConfig Extension [QUALITY_GATE]

**Statement**: `CognitiveConfig` gains 3 new optional fields:
- `stability?: StabilityConfig`
- `freshness?: FreshnessThresholds`
- `accessTracking?: AccessTrackerConfig`

Including `flushIntervalMs` exposed through `AccessTrackerConfig` (PA Amendment).

### I-P3-16: Zero New System Calls [CONSTITUTIONAL]

**Statement**: Phase 3 adds zero new system calls. The 16 frozen system calls are unchanged. All Phase 3 operations are:
- Pure computation functions (decay, freshness, stability)
- Modifications to existing system call behavior (query/search add effectiveConfidence)
- Infrastructure (access tracker, migration)

---

## MATHEMATICAL PROOFS

### Proof: SQL Pre-Filter Safety (I-P3-07)

**Claim**: If `effectiveConfidence >= threshold`, then `confidence >= threshold`.

**Proof**:
1. `effectiveConfidence = confidence * R(t, S)`
2. `R(t, S) <= 1.0` for all `t >= 0, S > 0` (from I-P3-01: `R(t) = (1 + t/(9S))^(-1)`, and `t/(9S) >= 0`, so `1 + t/(9S) >= 1`, so `R(t) <= 1`)
3. Therefore: `effectiveConfidence <= confidence`
4. Contrapositive: if `confidence < threshold`, then `effectiveConfidence < threshold`
5. Equivalently: if `effectiveConfidence >= threshold`, then `confidence >= threshold`

The SQL `WHERE confidence >= threshold` is a necessary condition. It never eliminates claims that would pass the TypeScript filter. QED.

### Proof: Age Clamping Safety (I-P3-01 edge)

**Claim**: Clamping age to `max(0, nowMs - validAtMs)` prevents `R(t) > 1.0`.

**Proof**:
1. If `validAt` is in the future: `nowMs - validAtMs < 0`
2. Without clamping: `ageDays < 0`, so `1 + ageDays/(9S) < 1`, so `R(t) > 1`
3. With clamping: `ageDays = 0`, so `R(0) = 1/(1+0) = 1.0`
4. `effectiveConfidence = confidence * 1.0 = confidence` (correct: no decay for future claims)

QED.

---

*SolisHQ -- We innovate, invent, then disrupt.*
