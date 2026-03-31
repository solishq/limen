# PHASE 2 DEFECT-CLASS DECLARATION: FTS5 Search

**Date**: 2026-03-30
**Author**: Builder (SolisHQ Engineering)
**Design Source**: docs/sprints/PHASE-2-DESIGN-SOURCE.md
**Classification**: SIGNIFICANT
**Baseline**: Phase 0+1 complete, 3,269 passing tests, commit `abff6cf`

---

## DC Coverage: All 9 Mandatory Categories

| # | Category | DCs |
|---|----------|-----|
| 1 | Data Integrity | DC-P2-001, DC-P2-002, DC-P2-004 |
| 2 | State Consistency | DC-P2-003 |
| 3 | Concurrency/Ordering | DC-P2-011 |
| 4 | Authority | DC-P2-010 |
| 5 | Interface Contract | DC-P2-012, DC-P2-013 |
| 6 | Resource Management | DC-P2-009 |
| 7 | Credential/Sensitive Data | DC-P2-004 (dual-classified) |
| 8 | Behavioral | DC-P2-005, DC-P2-014, DC-P2-015, DC-P2-016 |
| 9 | Availability | DC-P2-006, DC-P2-007, DC-P2-008 |

---

## Defect-Class Table

| DC ID | Description | Category | Assurance | Control Mode | Mechanism | Trace | [A21] |
|-------|-------------|----------|-----------|-------------|-----------|-------|-------|
| DC-P2-001 | FTS5 search returns claims from wrong tenant | 1: Data Integrity | CONSTITUTIONAL | CBM | Every FTS5 query includes `AND tenant_id = ?` (UNINDEXED column). Single-tenant: `AND tenant_id IS NULL`. Tenant filter derived from OperationContext, never from user input. | DS Decision 5 | **[A21]** Success: search in tenant A returns only tenant A claims. Rejection: search in tenant A returns zero claims from tenant B even when B has matching content. |
| DC-P2-002 | FTS5 index out of sync with claim_assertions | 1: Data Integrity | CONSTITUTIONAL | CBM | AFTER INSERT/UPDATE/DELETE triggers on claim_assertions synchronously update both claims_fts and claims_fts_cjk. Trigger SQL is part of migration (atomic with table creation). Rebuild on migration ensures pre-existing claims are indexed. | DS Decision 2 | **[A21]** Success: remember() -> search() finds the claim. Rejection: retract() -> search() no longer returns the claim. |
| DC-P2-003 | Search returns retracted claims by default | 2: State Consistency | CONSTITUTIONAL | CBM | FTS5 query includes `AND status = 'active'` (UNINDEXED column). UPDATE trigger re-inserts with new status. Default search filters retracted. `includeSuperseded` option controls superseded visibility but retracted are always excluded. | DS Decision 7 | **[A21]** Success: active claims returned. Rejection: retracted claims excluded from default results. |
| DC-P2-004 | Tombstoned (purged) claims remain in FTS5 index | 1: Data Integrity / 7: Credential | CONSTITUTIONAL | CBM | UPDATE trigger deletes old entry, conditional re-insert uses `WHERE NEW.subject IS NOT NULL`. Tombstone NULLs subject -> no re-insert -> removed from FTS5. Privacy/compliance: purged content must be unsearchable. | DS Decision 2, 7 | **[A21]** Success: tombstoned claim absent from FTS5. Rejection: search for tombstoned content returns zero results. |
| DC-P2-005 | CJK text not searchable | 8: Behavioral | QUALITY_GATE | CBM | Trigram FTS5 secondary index (claims_fts_cjk) indexes all object_value content. CJK detection regex routes CJK queries to trigram table. Threshold: CJK content must be findable via search(). | DS Decision 3 | **[A21]** Success: CJK content found via search. Rejection: N/A (QUALITY_GATE, not enforcement). |
| DC-P2-006 | Search exceeds 50ms performance budget | 9: Availability | QUALITY_GATE | CBD | FTS5 inverted index provides O(1) lookup. UNINDEXED tenant/status filter is post-MATCH. Benchmark: 1000+ claims, search < 50ms. | DS Addendum B.2 | N/A (QUALITY_GATE) |
| DC-P2-007 | FTS5 trigger overhead exceeds acceptable latency | 9: Availability | QUALITY_GATE | CBD | Triggers add ~0.5-1ms per assertion. Measured via remember() latency comparison with/without FTS5. | DS Addendum A.3 | N/A (QUALITY_GATE) |
| DC-P2-008 | FTS5 query syntax error crashes engine | 9: Availability | CONSTITUTIONAL | CBM | ClaimStore.search() catches SQLITE_ERROR from FTS5 MATCH, returns Result.err with CONV_SEARCH_QUERY_SYNTAX. Never throws. Every search call wrapped in try-catch. | DS Error Taxonomy | **[A21]** Success: valid FTS5 query returns results. Rejection: malformed query returns error Result, engine continues operating. |
| DC-P2-009 | Migration rebuild blocks for unacceptable duration | 6: Resource Management | QUALITY_GATE | CBD | `INSERT INTO claims_fts(claims_fts) VALUES('rebuild')` runs during migration. For pre-Phase-2 databases with existing claims, rebuild time is proportional to claim count. At 10K claims, < 1 second. Measured in migration perf test. | DS Decision 8 | N/A (QUALITY_GATE) |
| DC-P2-010 | search() bypasses RBAC/audit governance | 4: Authority | CONSTITUTIONAL | CBM | search() delegates to ClaimApi.searchClaims() which routes through RawClaimFacade with RBAC + rate limit checks identical to queryClaims(). No direct SQL access from convenience layer. | DS Decision 9 | **[A21]** Success: authorized agent can search. Rejection: RBAC enforcement applies (inherited from ClaimApi facade pattern). |
| DC-P2-011 | FTS5 trigger fires out of order with CCP-I1 immutability trigger | 3: Concurrency/Ordering | CONSTITUTIONAL | CBM (impossible by construction) | FTS5 triggers are AFTER triggers. CCP-I1 immutability is a BEFORE UPDATE trigger. Ordering: BEFORE triggers fire first (blocking invalid mutations), then AFTER triggers fire (syncing FTS5). Content is guaranteed unchanged by the time FTS5 trigger reads NEW values. | DS GAP-4 | Structural proof: SQLite guarantees BEFORE triggers fire before AFTER triggers on the same table. CCP-I1 blocks content mutation, so FTS5 trigger only sees legitimate status/archive changes. |
| DC-P2-012 | SearchClaimInput.limit exceeds maximum or is non-positive | 5: Interface Contract | CONSTITUTIONAL | CBM | Validation in convenience layer: limit must be in [1, 200]. Default: 20. Returns CONV_SEARCH_INVALID_LIMIT error. | DS Type Architecture | **[A21]** Success: valid limit returns results. Rejection: limit=0 or limit=201 returns error. |
| DC-P2-013 | Empty/whitespace search query accepted | 5: Interface Contract | CONSTITUTIONAL | CBM | Validation in convenience layer: query must be non-empty and not whitespace-only. Returns CONV_SEARCH_EMPTY_QUERY error. | DS Error Taxonomy | **[A21]** Success: non-empty query executes. Rejection: empty string returns error. |
| DC-P2-014 | BM25 score computation produces inverted ranking | 8: Behavioral | CONSTITUTIONAL | CBM | BM25 returns negative values (lower = more relevant). Score computed as `-bm25(claims_fts) * confidence` (negate to make higher = better). Results sorted by score DESC. | PA Amendment 2 | **[A21]** Success: more relevant claims rank higher. Rejection: N/A (ranking correctness verified by ordering test). |
| DC-P2-015 | Substring search for "food" fails to find "preference.food" via trigram | 8: Behavioral | CONSTITUTIONAL | CBM | Primary FTS5 with `tokenchars ".:_-"` tokenizes "preference.food" as single token. A search for just "food" won't match via primary table. Trigram table handles substring matching. Search implementation queries trigram table for Latin text when primary table returns no results, OR always queries both. | PA Amendment 1 | **[A21]** Success: search("food") returns claims with predicate "preference.food" (via trigram fallback). Rejection: N/A. |
| DC-P2-016 | Superseded claims included when includeSuperseded is false | 8: Behavioral | CONSTITUTIONAL | CBM | Default `includeSuperseded: false`. Superseded status computed by checking for 'supersedes' relationships targeting the claim (same logic as recall()). Superseded claims filtered post-query. | DS Decision 6 | **[A21]** Success: superseded claims excluded by default. Rejection: superseded claims appear when includeSuperseded=true. |

---

## Assumption Ledger

### A-P2-01: better-sqlite3 compiles with FTS5 enabled
- **Assumption**: `better-sqlite3` npm package includes SQLite compiled with `SQLITE_ENABLE_FTS5`.
- **Owner**: Builder
- **Review trigger**: Upgrade of better-sqlite3 dependency.
- **Invalidation trigger**: FTS5 virtual table creation fails at runtime.
- **Response**: Pin better-sqlite3 version or compile SQLite from source with FTS5 flag.

### A-P2-02: Implicit rowid on claim_assertions is stable
- **Assumption**: `claim_assertions` has implicit rowid (TEXT PRIMARY KEY without WITHOUT ROWID). Rowid is stable across INSERT/UPDATE.
- **Owner**: Builder
- **Review trigger**: Schema change to claim_assertions in future phase.
- **Invalidation trigger**: claim_assertions uses WITHOUT ROWID.
- **Response**: FTS5 content_rowid must change to a different integer column.

### A-P2-03: Trigger ordering (BEFORE fires before AFTER)
- **Assumption**: SQLite guarantees BEFORE triggers fire before AFTER triggers on the same table operation.
- **Owner**: Builder (structural proof from SQLite spec)
- **Review trigger**: SQLite major version upgrade.
- **Invalidation trigger**: Documented change in SQLite trigger ordering semantics.
- **Response**: Re-examine FTS5 sync correctness; may need conditional logic in FTS5 triggers.

---

## Self-Audit
- Did I derive every DC from the spec? YES -- all DCs trace to Design Source decisions or PA amendments.
- Did I cover all 9 categories? YES -- see coverage table above.
- Did I mark all enforcement DCs with [A21]? YES -- DC-P2-001 through DC-P2-016, all CONSTITUTIONAL DCs have [A21] annotations.
- Do NOT judge completeness -- that is the Breaker's job (Hard Ban #23).

---

*SolisHQ -- We innovate, invent, then disrupt.*
