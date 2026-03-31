# PHASE 2 TRUTH MODEL: FTS5 Search

**Date**: 2026-03-30
**Author**: Builder (SolisHQ Engineering)
**Design Source**: docs/sprints/PHASE-2-DESIGN-SOURCE.md
**DC Declaration**: docs/sprints/PHASE-2-DC-DECLARATION.md

---

## Invariants

### I-P2-01: FTS5 Sync Correctness (CONSTITUTIONAL)
**Statement**: For every claim in `claim_assertions` with `subject IS NOT NULL` and `status IN ('active', 'retracted')`, there EXISTS exactly one corresponding entry in `claims_fts` AND exactly one corresponding entry in `claims_fts_cjk`.

**Formalization**: `COUNT(claims_fts WHERE claim_id = C.id) = 1` for all C where C.subject IS NOT NULL.

**Enforcement**: AFTER INSERT/UPDATE/DELETE triggers on claim_assertions. Rebuild on migration.

**DCs**: DC-P2-002, DC-P2-004

### I-P2-02: Tenant Isolation in Search (CONSTITUTIONAL)
**Statement**: `search(query)` in tenant T NEVER returns claims from tenant T' where T != T'. This holds for all search paths (primary unicode61, secondary trigram, mixed).

**Formalization**: For all results R returned by search(): `R.claim.tenantId = ctx.tenantId`.

**Enforcement**: `WHERE tenant_id = ?` on every FTS5 query. Tenant derived from OperationContext.

**DCs**: DC-P2-001

### I-P2-03: Retracted Claim Exclusion (CONSTITUTIONAL)
**Statement**: search() with default options NEVER returns claims with status='retracted'. Retracted claims exist in the FTS5 index (for potential future use) but are filtered at query time.

**Formalization**: For all results R returned by search() with default options: `R.claim.status = 'active'`.

**Enforcement**: `WHERE status = 'active'` in every search query.

**DCs**: DC-P2-003

### I-P2-04: Tombstone Removal (CONSTITUTIONAL)
**Statement**: When a claim is tombstoned (purged_at set, content NULLed), the claim MUST NOT exist in either FTS5 index. Purged content is unsearchable. Privacy/compliance requirement.

**Formalization**: For all C where C.subject IS NULL: `COUNT(claims_fts WHERE claim_id = C.id) = 0 AND COUNT(claims_fts_cjk WHERE claim_id = C.id) = 0`.

**Enforcement**: UPDATE trigger conditional re-insert: `WHERE NEW.subject IS NOT NULL` / `WHERE NEW.object_value IS NOT NULL`.

**DCs**: DC-P2-004

### I-P2-05: Score Monotonicity (CONSTITUTIONAL)
**Statement**: The combined score `score = -bm25(claims_fts) * confidence` produces a ranking where higher score = more relevant. For two claims with identical FTS5 relevance, the claim with higher confidence ranks higher. For two claims with identical confidence, the claim with better FTS5 match ranks higher.

**Formalization**: score(C1) > score(C2) implies C1 is ranked above C2 in results. BM25 is negated because FTS5 returns negative values where lower (more negative) = more relevant.

**DCs**: DC-P2-014

### I-P2-06: Error Containment (CONSTITUTIONAL)
**Statement**: FTS5 query syntax errors, missing tables, or corrupted indexes NEVER crash the engine. All search failures return Result.err, never throw.

**Enforcement**: try-catch around all FTS5 MATCH operations. Error mapped to typed error codes.

**DCs**: DC-P2-008

### I-P2-07: Input Validation (CONSTITUTIONAL)
**Statement**: Empty/whitespace queries return CONV_SEARCH_EMPTY_QUERY. Limit out of [1, 200] returns CONV_SEARCH_INVALID_LIMIT. These checks execute BEFORE any database access.

**DCs**: DC-P2-012, DC-P2-013

### I-P2-08: CJK Searchability (QUALITY_GATE)
**Statement**: Claims containing CJK characters in object_value are findable via search() when the query contains CJK characters. Trigram tokenizer provides character-level matching.

**Threshold**: 100% of CJK test cases return expected results.

**DCs**: DC-P2-005

### I-P2-09: Performance Budget (QUALITY_GATE)
**Statement**: search() completes in < 50ms for databases with 1000+ claims, measured on local SQLite.

**Threshold**: p95 < 50ms over 100 iterations with 1000 claims.

**DCs**: DC-P2-006

### I-P2-10: Governance Boundary (CONSTITUTIONAL)
**Statement**: search() traverses the full governance stack: convenience_layer -> ClaimApi.searchClaims -> ClaimApiImpl -> RawClaimFacade (RBAC + rate limit) -> ClaimStore.search. No bypass of RBAC or rate limiting.

**DCs**: DC-P2-010

### I-P2-11: Substring via Trigram (CONSTITUTIONAL)
**Statement**: A search for "food" MUST find claims with predicate "preference.food", even though `tokenchars ".:_-"` makes "preference.food" a single token in the primary FTS5 table. The trigram secondary index provides substring matching as fallback.

**DCs**: DC-P2-015

### I-P2-12: Superseded Filtering (CONSTITUTIONAL)
**Statement**: By default (includeSuperseded: false), search() excludes claims that have been superseded by another claim (i.e., a 'supersedes' relationship exists targeting them). When includeSuperseded: true, superseded claims are included.

**DCs**: DC-P2-016

---

## State Machine Invariants

### FTS5 Entry Lifecycle
```
claim_assertions row state -> FTS5 index state
  ACTIVE (subject NOT NULL)     -> INDEXED (entry exists in both FTS5 tables)
  RETRACTED (subject NOT NULL)  -> INDEXED (entry exists, filtered at query time)
  TOMBSTONED (subject IS NULL)  -> REMOVED (entry deleted from both FTS5 tables)
```

**Transition invariant**: Every state change in claim_assertions produces exactly one trigger fire that synchronizes the FTS5 state.

---

## Self-Audit
- All CONSTITUTIONAL invariants have corresponding DCs with [A21] dual-path tests.
- All QUALITY_GATE invariants have measurable thresholds.
- Invariants cover: sync correctness, tenant isolation, retracted exclusion, tombstone removal, score computation, error containment, input validation, CJK search, performance, governance boundary, substring matching, superseded filtering.
- Do NOT judge completeness -- that is the Breaker's job (Hard Ban #23).

---

*SolisHQ -- We innovate, invent, then disrupt.*
