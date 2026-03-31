# PHASE 2 DESIGN SOURCE: FTS5 Search

**Date**: 2026-03-30
**Author**: Builder (SolisHQ Engineering)
**Status**: PENDING PA REVIEW
**Classification**: SIGNIFICANT
**Governing Documents**: LIMEN_BUILD_PHASES.md (Phase 2), LIMEN_DEFINITIVE_SPEC_ADDENDUM.md (C.9, B.2, A.3), PHASE-1-DESIGN-SOURCE.md
**Codebase Baseline**: Phase 0+1 complete, 3,269 passing tests, schema v36, commit `abff6cf`

---

## PROMPT AUDIT GATE

### Documents Read

1. LIMEN_BUILD_PHASES.md -- Phase 2 section (lines 94-126)
2. LIMEN_DEFINITIVE_SPEC_ADDENDUM.md -- C.9 (CJK tokenizer), B.2 (performance budget), A.3 (execution model)
3. CLAUDE.md (project constitution)
4. PHASE-1-DESIGN-SOURCE.md (cross-phase integration)
5. `src/api/interfaces/api.ts` (Limen interface)
6. `src/api/index.ts` (createLimen factory, convenience layer wiring)
7. `src/claims/interfaces/claim_types.ts` (ClaimCreateInput, ClaimQueryInput, Claim)
8. `src/claims/migration/019_ccp_claims.ts` (claim_assertions schema)
9. `src/api/migration/027_interactions_retention.ts` (latest migration pattern, v36)
10. `src/api/convenience/convenience_layer.ts` (ConvenienceLayerDeps, delegation pattern)
11. `src/api/convenience/convenience_types.ts` (BeliefView, RecallOptions)
12. `src/kernel/interfaces/database.ts` (DatabaseConnection interface)
13. `docs/research/limen/LIMEN_FTS5_ZERO_SYSCALL_RESEARCH.md` (FTS5 architecture research)

### Gaps Found

**GAP-1: claim_assertions uses TEXT PRIMARY KEY -- rowid availability.**
FTS5 external content mode requires `content_rowid=` to point to an integer column. SQLite tables with `TEXT PRIMARY KEY` (without `WITHOUT ROWID`) still have an implicit `rowid`. Verified: `019_ccp_claims.ts` does NOT use `WITHOUT ROWID`, so the implicit `rowid` exists and is usable as `content_rowid`.

- **Impact**: None. The implicit rowid is available.
- **Ruling needed**: NO.

**GAP-2: search() not on Limen interface yet.**
The `Limen` interface in `api.ts` has no `search()` method. Phase 2 adds it as a new convenience method, same pattern as `remember()`/`recall()`.

- **Impact**: Must extend `Limen`, `ConvenienceLayer`, and `ConvenienceLayerDeps` interfaces. Additive -- non-breaking.
- **Ruling needed**: NO -- follows Phase 1 precedent exactly.

**GAP-3: No FTS5 existence check mechanism.**
The research document recommends checking FTS5 table existence for graceful degradation. But Phase 2 is the phase that CREATES the table. All post-Phase-2 databases will have it. Pre-Phase-2 databases run the migration on engine startup. The graceful degradation case is: `search()` called on a database where migration failed. This is handled by the migration system itself (startup fails if migrations fail).

- **Impact**: No need for runtime FTS5 existence checking. Migration is mandatory.
- **Ruling needed**: NO.

**GAP-4: FTS5 sync trigger interaction with CCP-I1 immutability trigger.**
The `claim_assertions_content_immutable` trigger (BEFORE UPDATE) blocks content field changes. FTS5 sync triggers fire AFTER INSERT/UPDATE/DELETE. Since CCP-I1 blocks content changes, the only UPDATE that can occur on claim_assertions is `status` change (active -> retracted) or `archived` flag change. The FTS5 UPDATE trigger must handle this correctly: the subject/predicate/object_value have NOT changed (CCP-I1 guarantees it), but we may want to REMOVE retracted claims from the FTS5 index.

- **Impact**: The UPDATE trigger must check if `status` changed to 'retracted' and remove the entry, OR check if content was tombstoned (purged_at set). See Decision 7.
- **Ruling needed**: NO -- spec says retracted claims should not appear in search.

### Wrong Assumptions Found

**DEVIATION 1: Research document uses `content_rowid=rowid`.**
- **Research claim**: FTS5 table defined with `content_rowid=rowid`.
- **Codebase reality**: This is correct for `claim_assertions` since it has an implicit rowid (TEXT PRIMARY KEY without WITHOUT ROWID).
- **Impact**: None. The research is correct.
- **Ruling needed**: NO.

**DEVIATION 2: Research suggests modifying ClaimStore.query() for wildcard optimization.**
- **Research claim**: Modify `ClaimStore.query()` to use FTS5 for wildcard queries.
- **Codebase reality / Phase 2 scope**: Phase 2 is about adding `limen.search()`, NOT about optimizing existing wildcard queries. The wildcard optimization is a nice-to-have internal improvement but is NOT in the Build Phases spec items 2.1-2.7. The spec asks for a new `search()` method.
- **Impact**: This Design Source does NOT include the wildcard optimization. `search()` is a new convenience method. The existing `recall()` continues to use LIKE queries.
- **Ruling needed**: NO -- scope is defined by Build Phases 2.1-2.7.

---

## THE FIVE QUESTIONS

1. **What does the spec/requirement actually say?**
   Phase 2 spec (Build Phases 2.1-2.7): Create FTS5 migration, sync triggers, CJK secondary index, `limen.search()` convenience method, tenant-scoped search, <50ms performance, and comprehensive tests. Addendum C.9: primary index uses `unicode61`, CJK uses `trigram` secondary. Addendum B.2: FTS5 search <50ms for 10K claims. Addendum A.3: FTS5 indexing is synchronous via SQLite trigger (<1ms overhead).

2. **How can this fail?**
   - FTS5 trigger fires on tombstone UPDATE, inserting NULLs into the index (data integrity)
   - Tenant isolation bypassed by FTS5 MATCH query that returns claims from other tenants (authority)
   - CJK detection misses edge cases (mixed scripts, emoji, rare Unicode ranges) (behavioral)
   - FTS5 rebuild on migration blocks the event loop for large existing databases (availability)
   - Trigger overhead degrades `remember()` latency beyond <10ms budget (availability)
   - BM25 * confidence ranking produces unintuitive results when confidence is near 0 (behavioral)

3. **What are the downstream consequences of this decision?**
   - Phase 3 (Cognitive Metabolism) adds `effective_confidence` -- search ranking must use `effective_confidence` in Phase 3, not raw `confidence`. The Phase 2 ranking formula must be designed to accommodate this.
   - Phase 7 (MCP Enhancement) wraps `limen.search()` in an MCP tool -- the return type must be MCP-serializable.
   - Phase 11 (Vector Search) adds hybrid search -- the `search()` options must have extensible `mode` field for future `'semantic'` and `'hybrid'` modes.

4. **What am I assuming?**
   - ASSUMPTION A1: `better-sqlite3` compiles with `SQLITE_ENABLE_FTS5` enabled. CONFIRMED by research doc (GitHub issue #1253).
   - ASSUMPTION A2: The implicit `rowid` on `claim_assertions` is stable across INSERT/UPDATE/DELETE. CONFIRMED by SQLite specification: rowid is assigned at INSERT time and does not change unless the row is deleted and re-inserted.
   - ASSUMPTION A3: FTS5 `unicode61` tokenizer handles colon-separated URNs adequately for subject/predicate search. UNCERTAIN -- depends on tokenizer character rules. Will use `tokenchars=':'` to preserve URN structure.

5. **Would a hostile reviewer find fault with my analysis?**
   - A hostile reviewer might ask: "Why not use trigram for everything instead of dual-indexing?" Answer: Trigram indexes are 3x larger and lose word-boundary semantics (no phrase search, no BM25 relevance on natural language text). Latin/Cyrillic text benefits enormously from `unicode61` word tokenization.
   - A hostile reviewer might ask: "How do you merge results from two FTS5 tables?" Answer: UNION with deduplication by claim ID, re-ranked by combined BM25 score. Detailed in Decision 4.

---

## CRITICAL DESIGN DECISIONS

### Decision 1: FTS5 Content Columns

**Problem**: Which `claim_assertions` columns go into the FTS5 index?

**Candidates**:
| Column | Include? | Rationale |
|--------|----------|-----------|
| `subject` | YES | URN search -- "find all claims about entity:user:alice" |
| `predicate` | YES | Domain search -- "find all preference claims" |
| `object_value` | YES | Content search -- "find claims mentioning Thai food" |
| `tenant_id` | YES (as unindexed) | Tenant isolation (see Decision 5) |
| `status` | YES (as unindexed) | Filter retracted claims (see Decision 7) |
| `confidence` | NO | Numeric -- FTS5 does not index numbers meaningfully. Used in ORDER BY, not MATCH. |
| `source_agent_id` | NO | Not a search target. Available via recall(). |
| `id` | YES (as unindexed) | Needed to JOIN back to claim_assertions for full hydration |

**Decision**: Index `subject`, `predicate`, `object_value`. Include `tenant_id`, `status`, `id` as unindexed columns for post-MATCH filtering and JOIN.

**FTS5 column specification**:
```sql
CREATE VIRTUAL TABLE claims_fts USING fts5(
  subject,
  predicate,
  object_value,
  tenant_id UNINDEXED,
  status UNINDEXED,
  claim_id UNINDEXED,
  content='claim_assertions',
  content_rowid='rowid',
  tokenize='unicode61 tokenchars ".:_-"'
);
```

**Justification for `tokenchars`**: URN subjects contain colons (`entity:user:alice`), predicates contain dots (`preference.food`), identifiers contain underscores and hyphens. Without `tokenchars`, the tokenizer splits on these characters, breaking structured search. With `tokenchars=".:_-"`, a search for `entity:user:alice` matches the full URN.

**Trade-off**: Including tenant_id/status/id as UNINDEXED adds ~20 bytes per row to the FTS5 shadow tables but avoids a JOIN for tenant filtering, which is critical for performance.

### Decision 2: External Content Sync Strategy

**Problem**: FTS5 `content=` tables require explicit INSERT/DELETE sync via triggers. Map the exact trigger SQL for all mutation paths.

**Mutation paths on `claim_assertions`**:

| Operation | Trigger | FTS5 Action |
|-----------|---------|-------------|
| New claim (SC-11 assertClaim) | AFTER INSERT | INSERT into FTS5 with all indexed + unindexed columns |
| Retraction (status active -> retracted) | AFTER UPDATE OF status | DELETE old entry, INSERT new entry with status='retracted' |
| Tombstone (purge: content NULLed, purged_at set) | AFTER UPDATE | DELETE old entry (do NOT re-insert -- NULLed content is not searchable) |
| Hard DELETE (theoretical -- never happens per CCP-I10) | AFTER DELETE | DELETE old entry |
| Archive (archived false -> true) | AFTER UPDATE OF archived | No FTS5 change needed -- archived claims remain searchable unless also retracted |

**Key insight**: The FTS5 UPDATE trigger cannot be a simple "delete old, insert new" because tombstone updates NULL the content fields. The trigger must guard against this.

**Trigger SQL**:
```sql
-- AFTER INSERT: Index new claims
CREATE TRIGGER claims_fts_ai AFTER INSERT ON claim_assertions
WHEN NEW.subject IS NOT NULL  -- Skip tombstoned rows (shouldn't happen on INSERT, but defensive)
BEGIN
  INSERT INTO claims_fts(rowid, subject, predicate, object_value, tenant_id, status, claim_id)
  VALUES (NEW.rowid, NEW.subject, NEW.predicate, NEW.object_value, NEW.tenant_id, NEW.status, NEW.id);
END;

-- AFTER DELETE: Remove from index
CREATE TRIGGER claims_fts_ad AFTER DELETE ON claim_assertions
BEGIN
  INSERT INTO claims_fts(claims_fts, rowid, subject, predicate, object_value, tenant_id, status, claim_id)
  VALUES ('delete', OLD.rowid, OLD.subject, OLD.predicate, OLD.object_value, OLD.tenant_id, OLD.status, OLD.id);
END;

-- AFTER UPDATE: Handle status changes and tombstone
CREATE TRIGGER claims_fts_au AFTER UPDATE ON claim_assertions
BEGIN
  -- Always delete the old entry
  INSERT INTO claims_fts(claims_fts, rowid, subject, predicate, object_value, tenant_id, status, claim_id)
  VALUES ('delete', OLD.rowid, OLD.subject, OLD.predicate, OLD.object_value, OLD.tenant_id, OLD.status, OLD.id);
  -- Re-insert only if content is not NULLed (tombstone check)
  INSERT INTO claims_fts(rowid, subject, predicate, object_value, tenant_id, status, claim_id)
  SELECT NEW.rowid, NEW.subject, NEW.predicate, NEW.object_value, NEW.tenant_id, NEW.status, NEW.id
  WHERE NEW.subject IS NOT NULL;
END;
```

**Why INSERT...SELECT with WHERE instead of WHEN on trigger**: SQLite does not allow multiple WHEN conditions on a single trigger for different INSERT statements. Using `INSERT...SELECT...WHERE` is the canonical pattern for conditional insertion within a trigger body.

### Decision 3: CJK Detection Algorithm

**Problem**: How to detect CJK content for dual-indexing?

**Unicode ranges**:
| Range | Script | Hex |
|-------|--------|-----|
| CJK Unified Ideographs | Chinese/Japanese Kanji | U+4E00 - U+9FFF |
| CJK Unified Ideographs Extension A | Rare Chinese | U+3400 - U+4DBF |
| Hiragana | Japanese | U+3040 - U+309F |
| Katakana | Japanese | U+30A0 - U+30FF |
| Hangul Syllables | Korean | U+AC00 - U+D7AF |
| Hangul Jamo | Korean | U+1100 - U+11FF |
| CJK Compatibility Ideographs | Various | U+F900 - U+FAFF |

**Detection function (TypeScript)**:
```typescript
const CJK_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\uAC00-\uD7AF\u1100-\u11FF\uF900-\uFAFF]/;

function containsCJK(text: string): boolean {
  return CJK_REGEX.test(text);
}
```

**Where detection happens**: At **trigger time in SQL** for the FTS5 sync, NOT in TypeScript. The CJK secondary FTS5 table has its own set of triggers that fire on the same mutations. The trigger inspects the `object_value` column for CJK characters using SQLite's `unicode()` function or a stored function.

**Correction**: SQLite triggers cannot call JavaScript functions. CJK detection must happen at **write time in the convenience layer** (remember/reflect) AND **search time** (search query contains CJK). Two approaches:

**Approach A -- Marker column**: Add a `has_cjk INTEGER DEFAULT 0` column to `claim_assertions`. Set to 1 at SC-11 assertion time when content contains CJK. The CJK FTS5 trigger fires only WHEN `NEW.has_cjk = 1`. **Problem**: This modifies the claim_assertions schema, adding coupling.

**Approach B -- Dual triggers, always fire**: The CJK FTS5 table has triggers that fire on ALL claim mutations, same as the primary FTS5 table. Both tables index ALL claims. At search time, the query decides which table to use based on the search query content.

**Approach C -- All-claims trigram**: The CJK FTS5 table uses `trigram` tokenizer and indexes ALL claims' `object_value` only. At search time, if the query contains CJK characters, query the trigram table. Otherwise, query the primary unicode61 table. Merge results if query is mixed.

**Decision: Approach C -- All-claims trigram secondary index.**

**Justification**:
1. No schema change to `claim_assertions` (preserves frozen interface).
2. No conditional trigger logic (simpler, no edge cases).
3. Trigram index is useful for ALL substring matching, not just CJK. It improves search for partial matches in Latin text too.
4. The trigram table is larger (~3x) but Limen's claim volume is modest (performance budget is "10K claims"). At 10K claims, a trigram index is ~10-30MB. Negligible.
5. At search time, the search layer decides which table to query based on query content analysis.

**Trade-off acknowledged**: The trigram index adds storage overhead for all claims, not just CJK claims. At the target scale (10K-100K claims), this is acceptable. At million-claim scale, this decision should be revisited (Phase 11 or later).

### Decision 4: Search Result Merging (CJK Dual-Index)

**Problem**: When a search query contains CJK characters, how do we query both FTS5 tables and merge results?

**Strategy**:

1. **CJK-only query** (all characters are CJK): Query ONLY the trigram table. The unicode61 table cannot tokenize CJK meaningfully.

2. **Latin-only query** (no CJK characters): Query ONLY the primary unicode61 table. BM25 ranking is more meaningful with word-boundary tokenization.

3. **Mixed query** (both CJK and Latin): Query BOTH tables. UNION results by claim_id, taking the BEST rank from either table. This is the rare case.

**Implementation**: The search store function runs CJK detection on the search query string, decides which FTS5 table(s) to query, executes the query/queries, and merges by claim_id if both tables were queried.

**Merge algorithm** (for mixed queries):
```sql
-- Primary (unicode61) results
SELECT claim_id, bm25(claims_fts) as rank FROM claims_fts WHERE claims_fts MATCH ?
UNION ALL
-- Secondary (trigram) results
SELECT claim_id, bm25(claims_fts_cjk) as rank FROM claims_fts_cjk WHERE claims_fts_cjk MATCH ?
-- Deduplicate: keep the better rank per claim_id
-- Apply confidence weighting and tenant filter in outer query
```

The outer query JOINs with `claim_assertions` for confidence, tenant_id filtering, and full claim hydration.

### Decision 5: Tenant Isolation in FTS5

**Problem**: FTS5 virtual tables don't support WHERE clauses on non-FTS columns in the MATCH expression. How do we enforce tenant isolation?

**Three strategies evaluated**:

| Strategy | How | Performance | Correctness |
|----------|-----|-------------|-------------|
| A. Post-filter JOIN | FTS5 MATCH -> JOIN claim_assertions -> WHERE tenant_id = ? | Worst: FTS5 returns all tenants, then filters | Correct |
| B. FTS5 UNINDEXED column | Include tenant_id as UNINDEXED in FTS5 -> filter in outer query | Good: no JOIN needed, filter on FTS5 shadow table | Correct |
| C. Prefix tenant in content | Prepend tenant_id to subject: `tenant:X:entity:user:alice` | Good: FTS5 prefix query | Breaks subject format (REJECTED) |

**Decision: Strategy B -- UNINDEXED column in FTS5 table.**

This is why Decision 1 includes `tenant_id UNINDEXED`. The search query becomes:
```sql
SELECT claim_id, bm25(claims_fts) as rank
FROM claims_fts
WHERE claims_fts MATCH ?
  AND tenant_id = ?  -- UNINDEXED column filter, applied post-MATCH
  AND status = 'active'  -- Also UNINDEXED, filter out retracted
ORDER BY rank
LIMIT ?
```

**Why this works**: FTS5 applies MATCH first (using the inverted index), then filters the result set on UNINDEXED columns. This is equivalent to a post-filter but without the JOIN overhead. The UNINDEXED columns are stored in the FTS5 content table but NOT in the inverted index.

**CONSTITUTIONAL invariant**: Tenant isolation is NON-NEGOTIABLE. Every search query MUST include the tenant_id filter. The search store function receives `tenantId` from the `OperationContext` (same as all other operations). In single-tenant mode, tenant_id is NULL, and the filter becomes `AND tenant_id IS NULL`.

### Decision 6: search() Return Type

**Problem**: Does `search()` return `BeliefView[]` with a relevance score, or a new type?

**Options**:
| Option | Type | Pros | Cons |
|--------|------|------|------|
| A. `BeliefView[]` | Same as recall() | Consistent, no new type | No relevance score |
| B. `SearchResult[]` (new type) | New type with relevance | Expresses ranking | New type proliferation |
| C. `SearchResultView extends BeliefView` | BeliefView + relevance | Consistent + relevance | Inheritance complexity |

**Decision: Option B -- New `SearchResult` type containing `BeliefView` + `relevance`.**

```typescript
interface SearchResult {
  /** The belief (same shape as recall() results) */
  readonly belief: BeliefView;
  /** FTS5 BM25 relevance score (lower is more relevant -- FTS5 convention) */
  readonly relevance: number;
  /** Combined score: relevance * confidence (the actual sort key) */
  readonly score: number;
}
```

**Justification**:
1. Composition over inheritance -- `SearchResult` HAS a `BeliefView`, not IS a `BeliefView`.
2. The `relevance` field is FTS5-specific. Exposing it teaches consumers about search relevance.
3. The `score` field is the combined BM25 * confidence ranking, which is the sort key. Making it explicit avoids confusion about how results are ordered.
4. Phase 3 will add `effective_confidence` to the score calculation. The `score` field abstracts this evolution.

**search() signature**:
```typescript
search(query: string, options?: SearchOptions): Result<readonly SearchResult[]>;
```

**SearchOptions**:
```typescript
interface SearchOptions {
  /** Minimum confidence threshold. Default: none. */
  readonly minConfidence?: number;
  /** Maximum results. Default: 20. */
  readonly limit?: number;
  /** Include superseded claims. Default: false. */
  readonly includeSuperseded?: boolean;
  /** Search mode. Default: 'fulltext'. Future: 'semantic', 'hybrid'. */
  readonly mode?: 'fulltext';
}
```

The `mode` field is typed as literal `'fulltext'` now. Phase 11 extends it to `'fulltext' | 'semantic' | 'hybrid'`. This is an additive type change.

### Decision 7: Retracted Claims in FTS5

**Problem**: Should retracted claims be removed from the FTS5 index?

**Decision: YES -- retracted claims are removed from FTS5.**

The FTS5 UPDATE trigger (Decision 2) re-inserts with `status='retracted'`. The search query filters `AND status = 'active'`. This means retracted claims EXIST in the FTS5 index but are filtered out at query time.

**Alternative considered**: Remove retracted claims entirely from FTS5 on retraction. This would save space but makes the trigger more complex (must detect status change). The current approach (keep in index, filter at query time) is simpler, and the storage overhead of retracted claim entries is negligible.

**Tombstoned claims**: When a claim is tombstoned (purged_at set, content NULLed), the UPDATE trigger removes it from FTS5 entirely because `NEW.subject IS NULL` prevents re-insertion. This is correct -- purged claims have no searchable content.

### Decision 8: Migration Versioning

**Problem**: The latest migration is v36 (`027_interactions_retention.ts`). What version for FTS5?

**Decision: v37 for primary FTS5, v38 for CJK trigram secondary.**

Two separate migrations:
1. **v37** (`028_fts5_search.ts`): Creates `claims_fts` (unicode61), sync triggers, rebuilds index from existing claims.
2. **v38** (`029_fts5_cjk.ts`): Creates `claims_fts_cjk` (trigram), sync triggers, rebuilds index.

**Why two migrations, not one**: Separation of concerns. If the trigram index proves too large or is not needed, it can be skipped independently. Each migration is self-contained with its own checksum.

**Pattern followed**: Same `buildEntry(version, name, sql)` pattern as all existing migrations. Same `MigrationEntry[]` export function pattern.

### Decision 9: Where search() Lives Architecturally

**Problem**: The convenience layer (`convenience_layer.ts`) delegates to `ClaimApi` for all operations. `search()` needs raw SQL access (FTS5 MATCH queries). `ClaimApi` does not expose FTS5.

**Options**:
| Option | Mechanism | Governance |
|--------|-----------|------------|
| A. Add searchClaims to ClaimApi | New method on ClaimApi | Extends the facade (additive). RBAC/rate-limit/audit enforced by facade. |
| B. Direct SQL in convenience layer | Use `getConnection()` (already in ConvenienceLayerDeps) | Bypasses ClaimApi RBAC/audit. REJECTED -- violates I-17 governance boundary. |
| C. New SearchStore + SearchApi | Separate subsystem | Clean but heavyweight for one method. |
| D. Internal search function on ClaimStore | Add to claim_stores.ts, expose through facade | Matches existing pattern. RBAC/audit wired through facade. |

**Decision: Option D -- Internal search on ClaimStore, exposed through ClaimApi facade.**

**Implementation chain**:
```
limen.search(query, options)
  -> convenienceLayer.search(query, options)
    -> claims.searchClaims(input)  // New method on ClaimApi
      -> ClaimApiImpl.searchClaims(input)
        -> RawClaimFacade.searchClaims(input)  // RBAC + rate limit + audit
          -> ClaimSystem.searchClaims.execute(conn, ctx, input)
            -> ClaimStore.search(conn, tenantId, input)  // Raw FTS5 SQL
```

**Why this is correct**: It follows the exact same pattern as `queryClaims`/`assertClaim`/`retractClaim`. Every operation goes through the governance stack. `search()` is NOT a new system call (SC-17). It is a new method on the existing ClaimApi, implemented through the existing facade/system call handler pattern. The system call count stays at 16.

**What changes**:
- `ClaimApi` interface: add `searchClaims(input: SearchClaimInput): Result<SearchClaimResult>`
- `ClaimApiImpl`: add delegation
- `RawClaimFacade`: add RBAC-gated delegation
- `ClaimSystem`: add search handler
- `ClaimStore`: add `search()` method with raw FTS5 SQL
- `ConvenienceLayer`: add `search()` that delegates to `claims.searchClaims()`

---

## OUTPUT 1: MODULE DECOMPOSITION

### Architecture

```
src/
  claims/
    interfaces/
      claim_types.ts                <- MODIFIED: add SearchClaimInput, SearchClaimResult
    store/
      claim_stores.ts               <- MODIFIED: add ClaimStore.search(), search handler
    migration/
      028_fts5_search.ts            <- NEW: v37, primary FTS5 table + triggers
      029_fts5_cjk.ts               <- NEW: v38, trigram FTS5 table + triggers
  api/
    interfaces/
      api.ts                        <- MODIFIED: add search() to Limen, searchClaims to ClaimApi
    convenience/
      convenience_types.ts          <- MODIFIED: add SearchOptions, SearchResult, SearchErrorCode
      convenience_layer.ts          <- MODIFIED: add search() method
    facades/
      claim_facade.ts               <- MODIFIED: add searchClaims to RawClaimFacade
      claim_api_impl.ts             <- MODIFIED: add searchClaims to ClaimApiImpl
    index.ts                        <- MODIFIED: wire search into Limen object, register migrations
  search/
    search_utils.ts                 <- NEW: CJK detection, query analysis, result merging
```

### Module Boundaries

| Module | Purpose | Inputs | Outputs | Dependencies |
|--------|---------|--------|---------|--------------|
| `028_fts5_search.ts` | Migration: primary FTS5 table + sync triggers | None | `MigrationEntry[]` | `MigrationEntry` type |
| `029_fts5_cjk.ts` | Migration: CJK trigram FTS5 table + sync triggers | None | `MigrationEntry[]` | `MigrationEntry` type |
| `search_utils.ts` | CJK detection, query analysis | `string` | `{ hasCJK: boolean, hasLatin: boolean }` | None (pure functions) |
| `claim_stores.ts` (search addition) | Raw FTS5 query execution | `DatabaseConnection`, `TenantId`, `SearchClaimInput` | `SearchClaimResult` | `DatabaseConnection`, `search_utils.ts` |
| `convenience_layer.ts` (search addition) | Convenience delegation | `SearchOptions` | `Result<readonly SearchResult[]>` | `ClaimApi.searchClaims` |

### Ownership

The FTS5 search subsystem is co-owned by:
- **Claims subsystem** (`src/claims/`): FTS5 migration, store-level search, schema.
- **API surface** (`src/api/`): Convenience `search()` method, type definitions.
- **Search utilities** (`src/search/`): Pure functions for query analysis. No state. No dependencies.

---

## OUTPUT 2: TYPE ARCHITECTURE

```typescript
// ============================================================================
// claim_types.ts additions (frozen interface extension -- additive only)
// ============================================================================

/**
 * Phase 2: Search claim input.
 * Full-text search across claim content using FTS5.
 * NOT a system call (no new SC-17). Implemented as internal method on ClaimApi.
 */
export interface SearchClaimInput {
  /** FTS5 search query. Supports phrase ("exact match"), boolean (AND/OR/NOT), prefix (term*). */
  readonly query: string;
  /** Minimum confidence threshold. Default: none. */
  readonly minConfidence?: number;
  /** Maximum results. Default: 20. Max: 200. */
  readonly limit?: number;
  /** Include superseded claims. Default: false. */
  readonly includeSuperseded?: boolean;
}

/**
 * Phase 2: Search result item.
 */
export interface SearchClaimResultItem {
  /** The matching claim (full Claim object) */
  readonly claim: Claim;
  /** FTS5 BM25 relevance score (lower/more negative = more relevant) */
  readonly relevance: number;
  /** Combined score: abs(bm25) * confidence. Higher = better match. */
  readonly score: number;
  /** Whether this claim has been superseded (computed) */
  readonly superseded: boolean;
  /** Whether this claim is disputed (computed) */
  readonly disputed: boolean;
}

/**
 * Phase 2: Search result.
 */
export interface SearchClaimResult {
  /** Matching claims, ordered by score descending */
  readonly results: readonly SearchClaimResultItem[];
  /** Total matching count (before limit) */
  readonly total: number;
}

// ============================================================================
// convenience_types.ts additions
// ============================================================================

/**
 * Phase 2: Options for search() calls.
 */
export interface SearchOptions {
  /** Minimum confidence threshold. Default: none. */
  readonly minConfidence?: number;
  /** Maximum results. Default: 20. */
  readonly limit?: number;
  /** Include superseded claims. Default: false. */
  readonly includeSuperseded?: boolean;
  /**
   * Search mode. Default: 'fulltext'.
   * Phase 11 extends to: 'semantic' | 'hybrid'.
   */
  readonly mode?: 'fulltext';
}

/**
 * Phase 2: Search result for convenience API.
 */
export interface SearchResult {
  /** The belief (same shape as recall() results) */
  readonly belief: BeliefView;
  /** FTS5 BM25 relevance score (lower/more negative = more relevant) */
  readonly relevance: number;
  /** Combined score: higher = better match (BM25 relevance * confidence) */
  readonly score: number;
}

/**
 * Phase 2: Search-specific error codes.
 */
export type SearchErrorCode =
  | 'CONV_SEARCH_EMPTY_QUERY'
  | 'CONV_SEARCH_INVALID_LIMIT'
  | 'CONV_SEARCH_FTS5_ERROR'
  | 'CONV_SEARCH_QUERY_SYNTAX';

// ============================================================================
// search_utils.ts (pure functions)
// ============================================================================

/**
 * CJK detection result.
 */
export interface QueryAnalysis {
  /** True if query contains CJK Unicode characters */
  readonly hasCJK: boolean;
  /** True if query contains Latin/Cyrillic/other word-boundary characters */
  readonly hasLatin: boolean;
  /** Which FTS5 tables to query */
  readonly tables: readonly ('primary' | 'cjk')[];
}
```

---

## OUTPUT 3: STATE MACHINES

### FTS5 Index Lifecycle (Per Claim)

FTS5 entries mirror `claim_assertions` row lifecycle. No independent state.

```
                    ┌─────────────┐
  SC-11 assert  --> │  INDEXED    │ <-- Subject/predicate/object_value in FTS5
                    │  (active)   │
                    └──────┬──────┘
                           │
                  retract  │  (status -> 'retracted')
                           v
                    ┌─────────────┐
                    │  INDEXED    │ <-- Still in FTS5, but status='retracted'
                    │ (retracted) │     Filtered out by search query WHERE clause
                    └──────┬──────┘
                           │
                  tombstone│  (purged_at set, content NULLed)
                           v
                    ┌─────────────┐
                    │  REMOVED    │ <-- Deleted from FTS5 (trigger: subject IS NULL)
                    │ (tombstoned)│
                    └─────────────┘
```

**Terminal states**: REMOVED (via tombstone). No claim is ever hard-deleted per CCP-I10, but FTS5 entries ARE removed when content is purged.

**Invariant**: FTS5 entry count = active claims + retracted claims (excluding tombstoned). This is verifiable.

### Search Query Routing (Stateless -- Decision Tree)

```
search(query)
  |
  ├── containsCJK(query)?
  |     ├── YES and containsLatin(query)?
  |     |     ├── YES -> query BOTH tables, merge results
  |     |     └── NO  -> query CJK trigram table ONLY
  |     └── NO -> query primary unicode61 table ONLY
  |
  ├── Apply tenant_id filter
  ├── Apply status = 'active' filter
  ├── Apply minConfidence filter (post-FTS5)
  ├── Apply includeSuperseded filter (post-FTS5)
  ├── Rank by score (abs(bm25) * confidence)
  └── Return top N results
```

---

## OUTPUT 4: SYSTEM-CALL MAPPING

| Spec Item | Operation | System Call | Implementation |
|-----------|-----------|-------------|----------------|
| 2.1 FTS5 migration | Schema creation | None (migration) | `028_fts5_search.ts` v37 |
| 2.2 FTS5 sync triggers | Data sync | None (SQLite triggers) | Embedded in v37 migration SQL |
| 2.3 CJK secondary index | Schema creation | None (migration) | `029_fts5_cjk.ts` v38 |
| 2.4 `limen.search()` | Full-text search | Composes ClaimApi.searchClaims (internal, NOT a new SC) | `convenience_layer.ts` -> `ClaimApiImpl` -> `RawClaimFacade` -> `ClaimStore.search()` |
| 2.5 Tenant-scoped search | Isolation | Uses OperationContext.tenantId (same as SC-13) | WHERE tenant_id = ? on FTS5 UNINDEXED column |
| 2.6 Performance budget | Non-functional | N/A | Benchmark tests |
| 2.7 Tests | Verification | N/A | Test files |

**Zero new system calls.** `searchClaims` is an internal method on `ClaimApi`, NOT a new numbered system call. The system call count remains at 16. This is consistent with Phase 1 where `retractClaim` was added to `ClaimApi` without being a new system call.

---

## OUTPUT 5: ERROR TAXONOMY

| Code | Trigger | Meaning | Recovery |
|------|---------|---------|----------|
| `CONV_SEARCH_EMPTY_QUERY` | `search('')` or `search('   ')` | Empty/whitespace-only query | Provide non-empty search query |
| `CONV_SEARCH_INVALID_LIMIT` | `limit <= 0` or `limit > 200` | Limit out of bounds | Use limit in [1, 200] |
| `CONV_SEARCH_QUERY_SYNTAX` | FTS5 MATCH syntax error (unmatched quotes, invalid boolean) | SQLite FTS5 query parser error | Fix query syntax |
| `CONV_SEARCH_FTS5_ERROR` | FTS5 table missing or corrupted | Migration failed or database corruption | Re-run migrations or rebuild FTS5 index |
| `LMN-1001` (existing) | RBAC check fails | Unauthorized search | Provide valid agent with search permission |
| `LMN-1002` (existing) | Rate limit exceeded | Too many search calls | Reduce search frequency |

**FTS5 syntax error handling**: SQLite throws `SQLITE_ERROR` when FTS5 MATCH syntax is invalid. The `ClaimStore.search()` method catches this and returns `CONV_SEARCH_QUERY_SYNTAX` with the SQLite error message. This is CONSTITUTIONAL -- FTS5 syntax errors must not crash the engine.

---

## OUTPUT 6: SCHEMA DESIGN

### Migration v37: Primary FTS5 Table (`028_fts5_search.ts`)

```sql
-- Migration 037: FTS5 Full-Text Search Index
-- Phase 2: Make knowledge findable.
-- Spec ref: LIMEN_BUILD_PHASES.md (2.1, 2.2), ADDENDUM C.9
--
-- Creates external-content FTS5 virtual table indexed on claim content columns.
-- Sync maintained by AFTER triggers on claim_assertions.
-- Tokenizer: unicode61 with extended tokenchars for URN/predicate structure.

-- ============================================================================
-- Table: claims_fts -- FTS5 external content index over claim_assertions
-- ============================================================================

CREATE VIRTUAL TABLE IF NOT EXISTS claims_fts USING fts5(
  subject,
  predicate,
  object_value,
  tenant_id UNINDEXED,
  status UNINDEXED,
  claim_id UNINDEXED,
  content='claim_assertions',
  content_rowid='rowid',
  tokenize='unicode61 tokenchars ".:_-"'
);

-- ============================================================================
-- Sync Triggers: Keep FTS5 index synchronized with claim_assertions
-- ============================================================================

-- AFTER INSERT: Index new claims (guard against NULL subject for safety)
CREATE TRIGGER IF NOT EXISTS claims_fts_ai
  AFTER INSERT ON claim_assertions
  WHEN NEW.subject IS NOT NULL
BEGIN
  INSERT INTO claims_fts(rowid, subject, predicate, object_value, tenant_id, status, claim_id)
  VALUES (NEW.rowid, NEW.subject, NEW.predicate, NEW.object_value, NEW.tenant_id, NEW.status, NEW.id);
END;

-- AFTER DELETE: Remove from index
CREATE TRIGGER IF NOT EXISTS claims_fts_ad
  AFTER DELETE ON claim_assertions
BEGIN
  INSERT INTO claims_fts(claims_fts, rowid, subject, predicate, object_value, tenant_id, status, claim_id)
  VALUES ('delete', OLD.rowid, OLD.subject, OLD.predicate, OLD.object_value, OLD.tenant_id, OLD.status, OLD.id);
END;

-- AFTER UPDATE: Remove old entry, conditionally re-insert new entry
-- Handles: status changes (active->retracted), tombstone (content NULLed), archive flag
CREATE TRIGGER IF NOT EXISTS claims_fts_au
  AFTER UPDATE ON claim_assertions
BEGIN
  -- Remove old entry
  INSERT INTO claims_fts(claims_fts, rowid, subject, predicate, object_value, tenant_id, status, claim_id)
  VALUES ('delete', OLD.rowid, OLD.subject, OLD.predicate, OLD.object_value, OLD.tenant_id, OLD.status, OLD.id);
  -- Re-insert only if not tombstoned (subject NULL = tombstoned)
  INSERT INTO claims_fts(rowid, subject, predicate, object_value, tenant_id, status, claim_id)
  SELECT NEW.rowid, NEW.subject, NEW.predicate, NEW.object_value, NEW.tenant_id, NEW.status, NEW.id
  WHERE NEW.subject IS NOT NULL;
END;

-- ============================================================================
-- Rebuild: Index existing claims (forward migration for pre-Phase-2 databases)
-- ============================================================================

INSERT INTO claims_fts(claims_fts) VALUES('rebuild');
```

### Migration v38: CJK Trigram FTS5 Table (`029_fts5_cjk.ts`)

```sql
-- Migration 038: FTS5 CJK Trigram Index
-- Phase 2: CJK content search support.
-- Spec ref: LIMEN_DEFINITIVE_SPEC_ADDENDUM.md C.9
--
-- Creates trigram-tokenized FTS5 table for substring matching.
-- Primary use: CJK content that unicode61 cannot tokenize meaningfully.
-- Secondary use: Substring matching for all content.
-- Indexes object_value only (subject/predicate are structured, not CJK).

-- ============================================================================
-- Table: claims_fts_cjk -- FTS5 trigram index for CJK/substring search
-- ============================================================================

CREATE VIRTUAL TABLE IF NOT EXISTS claims_fts_cjk USING fts5(
  object_value,
  tenant_id UNINDEXED,
  status UNINDEXED,
  claim_id UNINDEXED,
  content='claim_assertions',
  content_rowid='rowid',
  tokenize='trigram'
);

-- ============================================================================
-- Sync Triggers
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS claims_fts_cjk_ai
  AFTER INSERT ON claim_assertions
  WHEN NEW.object_value IS NOT NULL
BEGIN
  INSERT INTO claims_fts_cjk(rowid, object_value, tenant_id, status, claim_id)
  VALUES (NEW.rowid, NEW.object_value, NEW.tenant_id, NEW.status, NEW.id);
END;

CREATE TRIGGER IF NOT EXISTS claims_fts_cjk_ad
  AFTER DELETE ON claim_assertions
BEGIN
  INSERT INTO claims_fts_cjk(claims_fts_cjk, rowid, object_value, tenant_id, status, claim_id)
  VALUES ('delete', OLD.rowid, OLD.object_value, OLD.tenant_id, OLD.status, OLD.id);
END;

CREATE TRIGGER IF NOT EXISTS claims_fts_cjk_au
  AFTER UPDATE ON claim_assertions
BEGIN
  INSERT INTO claims_fts_cjk(claims_fts_cjk, rowid, object_value, tenant_id, status, claim_id)
  VALUES ('delete', OLD.rowid, OLD.object_value, OLD.tenant_id, OLD.status, OLD.id);
  INSERT INTO claims_fts_cjk(rowid, object_value, tenant_id, status, claim_id)
  SELECT NEW.rowid, NEW.object_value, NEW.tenant_id, NEW.status, NEW.id
  WHERE NEW.object_value IS NOT NULL;
END;

-- ============================================================================
-- Rebuild
-- ============================================================================

INSERT INTO claims_fts_cjk(claims_fts_cjk) VALUES('rebuild');
```

### Schema Diagram

```
claim_assertions (existing)
├── id TEXT PRIMARY KEY (implicit rowid)
├── tenant_id TEXT
├── subject TEXT
├── predicate TEXT
├── object_type TEXT
├── object_value TEXT
├── confidence REAL
├── status TEXT ('active' | 'retracted')
├── ...
│
├──[AFTER INSERT/UPDATE/DELETE triggers]──> claims_fts (FTS5, unicode61)
│                                          ├── subject (indexed)
│                                          ├── predicate (indexed)
│                                          ├── object_value (indexed)
│                                          ├── tenant_id (UNINDEXED)
│                                          ├── status (UNINDEXED)
│                                          └── claim_id (UNINDEXED)
│
└──[AFTER INSERT/UPDATE/DELETE triggers]──> claims_fts_cjk (FTS5, trigram)
                                           ├── object_value (indexed)
                                           ├── tenant_id (UNINDEXED)
                                           ├── status (UNINDEXED)
                                           └── claim_id (UNINDEXED)
```

### Critical Schema Properties

1. **External content mode**: `content='claim_assertions'` means FTS5 stores only the inverted index, NOT the content. Zero data duplication.
2. **content_rowid='rowid'**: Links FTS5 entries to claim_assertions via implicit rowid. Stable because claim_assertions does NOT use WITHOUT ROWID.
3. **Trigger-based sync**: Synchronous. No background job. Adds ~0.5-1ms per claim assertion (within the <10ms `remember()` budget from Addendum B.2).
4. **Additive migration**: No columns dropped, no tables modified. Two new virtual tables, six new triggers.

---

## OUTPUT 7: CROSS-PHASE INTEGRATION

### Phase 1 -> Phase 2 (Dependencies)

| Phase 1 Element | Phase 2 Usage |
|-----------------|---------------|
| `ClaimApi` interface | Extended with `searchClaims()` method |
| `ConvenienceLayer` interface | Extended with `search()` method |
| `ConvenienceLayerDeps` | No change -- search delegates to ClaimApi like all other methods |
| `BeliefView` type | Reused inside `SearchResult.belief` |
| `claim_assertions` table | FTS5 external content source |
| `CognitiveConfig` | No change for Phase 2 (Phase 3 adds decay config) |
| Auto-mission pattern | search() uses same missionId/taskId as remember()/recall() |

### Phase 2 -> Phase 3 (Forward Obligations)

| Phase 2 Element | Phase 3 Impact |
|-----------------|----------------|
| `SearchResult.score` | Phase 3 replaces `confidence` with `effective_confidence` in score calculation |
| `SearchClaimResultItem.claim.confidence` | Phase 3 adds `effective_confidence` alongside `confidence` |
| `SearchOptions` | Phase 3 may add `minEffectiveConfidence` filter |
| FTS5 triggers | Phase 3 adds `last_accessed_at`/`access_count` columns. search() must update access tracking (batched flush). FTS5 triggers are NOT affected (they fire on content changes, not access tracking columns). |

### Phase 2 -> Phase 7 (MCP Enhancement)

| Phase 2 Element | Phase 7 Impact |
|-----------------|----------------|
| `limen.search()` | MCP tool `limen_search` wraps this |
| `SearchResult` | Serialized to MCP JSON response |
| `SearchOptions` | Mapped to MCP tool Zod schema |

### Phase 2 -> Phase 11 (Vector Search)

| Phase 2 Element | Phase 11 Impact |
|-----------------|----------------|
| `SearchOptions.mode` | Extended from `'fulltext'` to `'fulltext' \| 'semantic' \| 'hybrid'` |
| FTS5 BM25 ranking | Combined with vector similarity in hybrid mode |
| `claims_fts` table | Continues to serve fulltext queries in hybrid pipeline |

### Migration Dependency Chain

```
v28 (019_ccp_claims.ts) -- claim_assertions table
  |
  v
v37 (028_fts5_search.ts) -- claims_fts (depends on claim_assertions)
  |
  v
v38 (029_fts5_cjk.ts) -- claims_fts_cjk (depends on claim_assertions)
```

---

## OUTPUT 8: ASSURANCE MAPPING

| Element | Assurance Class | Justification |
|---------|----------------|---------------|
| **Tenant isolation in search** | CONSTITUTIONAL | FTS5 queries MUST filter by tenant_id. Leakage = security defect. |
| **Retracted claim exclusion** | CONSTITUTIONAL | Search MUST NOT return retracted claims by default. Status filter is mandatory. |
| **FTS5 sync trigger correctness** | CONSTITUTIONAL | FTS5 index MUST reflect current state of claim_assertions. Stale index = data integrity defect. |
| **Tombstone removal from FTS5** | CONSTITUTIONAL | Tombstoned (purged) claims MUST be removed from FTS5. Privacy/compliance requirement. |
| **CJK content searchability** | QUALITY_GATE | CJK text should return relevant results. Threshold: >80% recall for CJK test corpus. |
| **Search performance <50ms** | QUALITY_GATE | Benchmark: 10K claims, BM25 ranking, <50ms p95. Threshold per Addendum B.2. |
| **FTS5 trigger overhead <1ms** | QUALITY_GATE | Per Addendum A.3: FTS5 indexing is synchronous, <1ms overhead. Benchmark required. |
| **BM25 * confidence ranking** | DESIGN_PRINCIPLE | Combined ranking produces meaningful results. Quality evaluated by relevance tests. |
| **unicode61 tokenchars for URN** | DESIGN_PRINCIPLE | Preserving URN structure in tokenization improves search precision. |
| **Trigram secondary index** | DESIGN_PRINCIPLE | Trade storage for CJK + substring matching capability. Revisitable at scale. |
| **SearchOptions.mode extensibility** | ROADMAP | Phase 11 adds 'semantic' and 'hybrid' modes. |

### Defect-Class Declaration Scope (Preview)

The following DCs will be formally declared in Control 1:

| DC ID | Description | Category | Assurance |
|-------|-------------|----------|-----------|
| DC-P2-001 | FTS5 returns claims from wrong tenant | 1: Data integrity | CONSTITUTIONAL |
| DC-P2-002 | FTS5 index out of sync with claim_assertions | 1: Data integrity | CONSTITUTIONAL |
| DC-P2-003 | Search returns retracted claims | 2: State consistency | CONSTITUTIONAL |
| DC-P2-004 | Tombstoned claims remain in FTS5 index | 1: Data integrity / 7: Credential | CONSTITUTIONAL |
| DC-P2-005 | CJK text not searchable | 8: Behavioral | QUALITY_GATE |
| DC-P2-006 | Search exceeds 50ms performance budget | 9: Availability | QUALITY_GATE |
| DC-P2-007 | FTS5 trigger overhead exceeds 1ms | 9: Availability | QUALITY_GATE |
| DC-P2-008 | FTS5 query syntax error crashes engine | 9: Availability | CONSTITUTIONAL |
| DC-P2-009 | Migration rebuild blocks event loop | 9: Availability | QUALITY_GATE |
| DC-P2-010 | search() bypasses RBAC/audit | 4: Authority | CONSTITUTIONAL |

---

## ORACLE GATES

| Gate | Status | Notes |
|------|--------|-------|
| OG-CONSULT | DEGRADED -- Intelligence MCP not available | Manual standards review conducted: FTS5 external content mode per SQLite official docs, trigger-based sync is canonical approach, tokenizer selection follows C.9 addendum. |
| OG-DESIGN | SKIPPED | Tier 2 -- not required for Phase 2 scope. |
| OG-FMEA | SKIPPED | Tier 2 -- not required. Failure modes covered in Decision analysis and DC preview. |

---

## SELF-AUDIT

- Did I derive every element from spec? YES -- all 8 outputs trace to Build Phases 2.1-2.7, Addendum C.9, B.2, A.3.
- Did I follow the three-file architecture? YES -- search lives in claim_stores.ts (store), claim_types.ts (types), convenience_layer.ts (thin delegation).
- Did I mark enforcement DCs with [A21]? Not yet -- this is the Design Source, not the DC declaration. DCs will be formally declared in Control 1.
- Would the Breaker find fault with my implementation? Potential attack surfaces: FTS5 injection via MATCH syntax, tenant_id UNINDEXED filter bypass, trigger ordering with CCP-I1 immutability trigger. All addressed in decisions.
- Do NOT judge completeness -- that is the Breaker's and Certifier's job (Hard Ban #23).

---

*SolisHQ -- We innovate, invent, then disrupt.*
