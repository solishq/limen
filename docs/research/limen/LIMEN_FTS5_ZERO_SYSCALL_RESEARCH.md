# Limen FTS5 Integration: Zero System Call Change Research

**Date:** 2026-03-29
**Author:** SolisHQ Research (Meta-Orchestrator)
**Limen Version:** 1.2.0
**Status:** First-principles analysis complete
**Confidence:** HIGH for recommended approach, CONFIRMED for architecture findings

---

## 1. Architecture Map: MCP Tool to SQLite Query

The full call chain from an agent invoking `limen_recall` to the SQLite database:

```
MCP Tool (limen_recall)                    [packages/limen-mcp/src/tools/knowledge.ts:176]
  |
  v
Limen Public API (limen.claims.queryClaims) [src/api/interfaces/api.ts:250, ClaimApi]
  |
  v
ClaimApiImpl                                [src/api/facades/claim_api_impl.ts:38]
  |
  v
RawClaimFacade (RBAC + rate limit)          [src/api/facades/claim_facade.ts:107]
  |
  v
ClaimSystem.queryClaims.execute             [src/claims/store/claim_stores.ts:1430]
  |  (authorization, rate limit, validation)
  v
ClaimStore.query                            [src/claims/store/claim_stores.ts:355]
  |  (builds SQL dynamically from filters)
  v
DatabaseConnection.query                    [src/kernel/interfaces/database.ts:69]
  |
  v
better-sqlite3 (SQLite with FTS5 enabled)
  |
  v
claim_assertions TABLE                      [src/claims/migration/019_ccp_claims.ts:35]
```

### Key Architectural Facts (CONFIRMED by source reading)

1. **System calls are SC-11 (assertClaim), SC-12 (relateClaims), SC-13 (queryClaims)** for the claim subsystem. These are frozen interfaces defined in `src/claims/interfaces/claim_types.ts`.

2. **MCP tools are NOT system calls.** The MCP server (`packages/limen-mcp/`) is a separate package that wraps the Limen engine. High-level tools (`limen_recall`, `limen_remember`, `limen_reflect`, etc.) are convenience wrappers. Low-level tools (`limen_claim_query`, `limen_claim_assert`) are direct 1:1 mappings. But both go through the same `limen.claims.*` API.

3. **The query is built dynamically.** `ClaimStore.query()` at line 355 of `claim_stores.ts` constructs SQL with `WHERE` clauses from the `ClaimQueryInput` filters. The SQL targets `claim_assertions c` directly.

4. **The `object_value` column stores claim content as JSON-stringified text.** All claim values are stored via `JSON.stringify(input.object.value)` (line 276). This is the column we need FTS5 on.

5. **`better-sqlite3` 11.10.0 compiles SQLite with `SQLITE_ENABLE_FTS5` by default.** FTS5 is available today with zero dependency changes.

6. **`DatabaseConnection` is a raw SQL interface.** It exposes `run()`, `query()`, `get()`, `transaction()`. Any SQL that SQLite supports can be executed through it, including FTS5 virtual table operations.

7. **The `limen_recall` MCP tool already does post-processing.** It filters out superseded claims client-side (line 192 of knowledge.ts). The tool is NOT a pure passthrough — it adds behavior.

---

## 2. The 16 System Calls (Frozen Surface)

From the codebase, the system calls are:

| # | System Call | Spec Ref | Location |
|---|---|---|---|
| 1 | SC-1: createAgent | S12 | orchestration |
| 2 | SC-2: proposeMission | S15 | orchestration/syscalls/propose_mission.ts |
| 3 | SC-3: proposeTaskGraph | S17 | orchestration/syscalls/propose_task_graph.ts |
| 4 | SC-4: createArtifact | S19 | orchestration/syscalls/create_artifact.ts |
| 5 | SC-5: respondCheckpoint | S20 | orchestration/syscalls/respond_checkpoint.ts |
| 6 | SC-6: emitEvent | S21 | orchestration/syscalls/emit_event.ts |
| 7 | SC-7: readArtifact | S22 | orchestration/syscalls/read_artifact.ts |
| 8-10 | SC-8 to SC-10 | Various | orchestration |
| 11 | SC-11: assertClaim | CCP §10.1 | claims/store/claim_stores.ts |
| 12 | SC-12: relateClaims | CCP §10.2 | claims/store/claim_stores.ts |
| 13 | SC-13: queryClaims | CCP §10.3 | claims/store/claim_stores.ts |
| 14 | SC-14: wmWrite | WMP | working-memory/ |
| 15 | SC-15: wmRead | WMP | working-memory/ |
| 16 | SC-16: wmDiscard | WMP | working-memory/ |

**These are constitutionally frozen. The constraint is real and non-negotiable.**

---

## 3. Approach Analysis

### Approach 1: Internal Query Enhancement (ClaimStore.query)
**Verdict: VIABLE -- RECOMMENDED (Variant A)**

**The mechanism:** The `ClaimStore.query()` function at `claim_stores.ts:355-500` dynamically builds SQL. Currently it queries:

```sql
SELECT c.* FROM claim_assertions c WHERE [conditions] ORDER BY c.created_at DESC LIMIT ? OFFSET ?
```

The object_value column (which holds the textual claim content) is never searched. Subject and predicate use exact match or `LIKE` with trailing wildcard.

**The enhancement:** Create an FTS5 virtual table that indexes `subject`, `predicate`, and `object_value`. Modify the internal SQL generation in `ClaimStore.query()` to JOIN against the FTS5 table when filters would benefit from it.

**Why it works:**
- `ClaimQueryInput` is NOT changed. Same fields, same types, same semantics.
- `ClaimQueryResult` is NOT changed. Same output shape.
- `SC-13 (queryClaims)` interface is NOT changed.
- The improvement is purely in how the INTERNAL query engine resolves filters.
- When `subject` uses a wildcard like `entity:project:*`, FTS5 prefix queries are dramatically faster than `LIKE 'entity:project:%'`.
- When `predicate` uses a wildcard like `decision.*`, same benefit.

**What changes:**
1. New migration: creates `claim_assertions_fts` FTS5 virtual table with `content=claim_assertions` (external content table).
2. New triggers: keep FTS5 index in sync on INSERT, UPDATE, DELETE to `claim_assertions`.
3. `ClaimStore.query()` internal SQL: use `claim_assertions_fts` with `MATCH` when wildcard filters are present.

**Risk assessment:**
- FTS5 external content tables are a stable, well-documented SQLite feature.
- Trigger-based sync is the canonical approach (per SQLite FTS5 documentation).
- The change is invisible to all consumers. Same input, same output, faster retrieval with semantic matching capability.

### Approach 1B: Internal Query Enhancement + New FTS-Specific Filter
**Verdict: VIOLATION -- adds field to ClaimQueryInput**

Adding a `textSearch?: string` field to `ClaimQueryInput` CHANGES the system call interface. Even though it's optional, it expands the contract surface. This violates the constraint.

### Approach 2: Middleware / Query Optimizer Layer
**Verdict: VIABLE -- RECOMMENDED (Variant B)**

**The mechanism:** Instead of modifying `ClaimStore.query()` directly, insert a query optimizer layer between `createQueryClaimsHandlerImpl` (line 1425) and `stores.store.query()` (line 1491).

```typescript
// Before (current):
return stores.store.query(conn, ctx.tenantId, input);

// After (with optimizer):
return queryOptimizer.execute(conn, ctx.tenantId, input, stores.store);
```

The optimizer would:
1. Analyze the `ClaimQueryInput` filters.
2. If wildcard subject/predicate filters are present, run an FTS5 `MATCH` query first to get candidate claim IDs.
3. Pass those IDs as additional filter constraints to the standard query.
4. OR: rewrite the SQL internally to use FTS5 JOINs.

**Why it works:** Same reasoning as Approach 1. The optimizer is an internal implementation detail. The system call boundary is `QueryClaimsHandler.execute()` -- everything below that is implementation.

**Why it's slightly less elegant than Approach 1:** It adds a new abstraction layer where the existing code is straightforward. The optimizer would need to handle the case where FTS5 is not yet initialized (migration pending). More moving parts for marginal architectural benefit.

### Approach 3: MCP Tool Layer (limen_search)
**Verdict: VIABLE -- RECOMMENDED as COMPLEMENT**

**The critical distinction:** MCP tools are NOT system calls. The codebase proves this:

1. `limen_recall` (knowledge.ts:165) is already a convenience tool that calls `limen.claims.queryClaims()` (SC-13) and then filters out superseded claims. It adds behavior beyond the system call.

2. `limen_reflect` (knowledge.ts:265) calls `limen.claims.assertClaim()` (SC-11) in a loop -- it's a batch convenience over a system call.

3. `limen_scratch` wraps SC-14/SC-15/SC-16 into a single tool with action parameter.

**Precedent is set.** High-level MCP tools compose system calls. They are explicitly documented as "A-04: convenience wrapper, not a new system call" (see `knowledge_api.ts:9`).

**The proposal:** Add `limen_search` as an MCP tool that:
1. Runs an FTS5 `MATCH` query against `claim_assertions_fts` to get candidate claim IDs.
2. Calls `limen.claims.queryClaims()` (SC-13) with those IDs as a filter.
3. Returns results in the same format as `limen_recall`.

**OR (simpler):** Enhance `limen_recall` to optionally use FTS5 internally. The MCP tool already has its own parameter schema separate from `ClaimQueryInput`. Adding a `query?: string` parameter to the MCP tool does NOT change SC-13.

**The valid distinction (CONFIRMED):**
- System call = `ClaimQueryInput` → `ClaimQueryResult` (frozen at SC-13)
- MCP tool = whatever Zod schema the tool declares → whatever JSON it returns

The MCP tool schema is NOT the system call schema. `limen_recall` already proves this -- it accepts `{subject, predicate, minConfidence, limit}` while `ClaimQueryInput` has 12+ fields.

### Approach 4: Index-Level Enhancement (Pure Migration)
**Verdict: PARTIALLY VIABLE -- insufficient alone**

Adding an FTS5 virtual table via migration IS just an index-level change in the same way a B-tree index is. The table exists, the data is indexed, triggers keep it in sync.

**But:** Unlike a B-tree index, SQLite's query planner does NOT automatically use FTS5 for `LIKE` queries. FTS5 requires explicit `MATCH` syntax:

```sql
-- This does NOT use FTS5:
SELECT * FROM claim_assertions WHERE subject LIKE 'entity:project:%';

-- This DOES use FTS5:
SELECT * FROM claim_assertions_fts WHERE claim_assertions_fts MATCH 'entity:project:*';
```

So a pure migration gives us the index but no queries use it. The query code MUST be modified to emit `MATCH` syntax. That's Approach 1 or 2.

**Conclusion:** Approach 4 is a prerequisite, not a solution. The migration creates the FTS5 table. Approach 1 or 3 makes the queries use it.

### Approach 5: Hook/Plugin Architecture
**Verdict: NOT VIABLE -- does not exist**

Limen has no plugin or extension mechanism for query enhancement. The `ClaimStore` is created by `createClaimStoreImpl()` as a plain object with closure-captured deps. There is no hook point, no middleware chain, no interceptor pattern in the claim query path.

The closest thing is the event bus (`emitEvent`), but events are fire-and-forget notifications, not query interceptors.

### Approach 6: View-Based Approach
**Verdict: NOT VIABLE -- wrong tool for the job**

A SQLite VIEW cannot incorporate FTS5 `MATCH` syntax conditionally based on query parameters. Views are static SQL definitions. The `ClaimStore.query()` function builds dynamic SQL with variable WHERE clauses -- a view cannot replicate this.

Furthermore, FTS5 virtual tables have their own query syntax (`MATCH`, `rank`, `bm25()`, `highlight()`, `snippet()`). A standard view that `UNION`s with an FTS5 query would need a fixed match term, which defeats the purpose.

---

## 4. Recommended Approach: Layered Implementation

The recommended approach combines Approaches 1, 3, and 4 in three layers:

### Layer 1: Migration (Approach 4)
**File:** New migration `src/claims/migration/0XX_fts5_claims.ts`

```sql
-- FTS5 virtual table: external content from claim_assertions
-- Indexes subject, predicate, and object_value for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS claim_assertions_fts USING fts5(
  subject,
  predicate,
  object_value,
  content=claim_assertions,
  content_rowid=rowid
);

-- Sync triggers: keep FTS5 index current
-- INSERT trigger
CREATE TRIGGER IF NOT EXISTS claim_assertions_fts_ai
  AFTER INSERT ON claim_assertions
  BEGIN
    INSERT INTO claim_assertions_fts(rowid, subject, predicate, object_value)
    VALUES (NEW.rowid, NEW.subject, NEW.predicate, NEW.object_value);
  END;

-- DELETE trigger (including tombstone)
CREATE TRIGGER IF NOT EXISTS claim_assertions_fts_ad
  AFTER DELETE ON claim_assertions
  BEGIN
    INSERT INTO claim_assertions_fts(claim_assertions_fts, rowid, subject, predicate, object_value)
    VALUES ('delete', OLD.rowid, OLD.subject, OLD.predicate, OLD.object_value);
  END;

-- UPDATE trigger
CREATE TRIGGER IF NOT EXISTS claim_assertions_fts_au
  AFTER UPDATE ON claim_assertions
  BEGIN
    INSERT INTO claim_assertions_fts(claim_assertions_fts, rowid, subject, predicate, object_value)
    VALUES ('delete', OLD.rowid, OLD.subject, OLD.predicate, OLD.object_value);
    INSERT INTO claim_assertions_fts(rowid, subject, predicate, object_value)
    VALUES (NEW.rowid, NEW.subject, NEW.predicate, NEW.object_value);
  END;

-- Rebuild index for existing data
INSERT INTO claim_assertions_fts(claim_assertions_fts) VALUES('rebuild');
```

**Key design decisions:**
- `content=claim_assertions` makes this an "external content" FTS5 table. It does NOT duplicate the data. It stores only the FTS5 inverted index, which references the original table via rowid.
- The `rebuild` command at the end populates the index from existing claims.
- Tombstoned claims (where subject/predicate/object_value are NULLed) will have their FTS5 entries removed by the UPDATE trigger.

### Layer 2: Internal Query Enhancement (Approach 1)
**File:** `src/claims/store/claim_stores.ts` -- modify `ClaimStore.query()` at line 355

The enhancement targets wildcard queries. When `filters.subject` ends with `*` or `filters.predicate` ends with `*`, the current code uses `LIKE`:

```typescript
// Current (line 370-377):
if (filters.subject.endsWith('*')) {
  conditions.push('c.subject LIKE ?');
  params.push(filters.subject.slice(0, -1) + '%');
}
```

**Enhancement:** When the FTS5 table exists, use an FTS5 prefix query via subquery:

```typescript
// Enhanced:
if (filters.subject.endsWith('*')) {
  const prefix = filters.subject.slice(0, -1);
  // FTS5 prefix query: "entity:project" becomes subject:"entity:project"*
  conditions.push('c.rowid IN (SELECT rowid FROM claim_assertions_fts WHERE subject MATCH ?)');
  params.push(`"${prefix}"*`);
}
```

**Important nuance:** This changes the QUERY EXECUTION PLAN, not the query RESULTS. The same claims are returned. The same `ClaimQueryInput` is accepted. The same `ClaimQueryResult` is produced. The system call boundary is preserved.

**Graceful degradation:** The code should check whether the FTS5 table exists (via a one-time check on first query) and fall back to `LIKE` if the migration hasn't run yet. This makes the enhancement backward-compatible.

### Layer 3: MCP Search Tool (Approach 3)
**File:** New tool in `packages/limen-mcp/src/tools/knowledge.ts`

This is the layer that provides TRUE full-text search -- searching claim CONTENT, not just structured filters.

```typescript
// limen_search -- full-text search across all claim content
server.tool(
  'limen_search',
  'Full-text search across claim content. Searches subject, predicate, and object values.',
  {
    query: z.string().min(1).describe('Search query (FTS5 syntax supported)'),
    minConfidence: z.number().optional(),
    limit: z.number().max(200).optional().default(20),
  },
  async (args) => {
    // 1. FTS5 query to get matching rowids with relevance ranking
    // This goes DIRECTLY to the database through a helper, NOT through SC-13
    // OR: use SC-13 with the internal FTS5 enhancement from Layer 2

    // Option A: Direct FTS5 query + SC-13 for full claim hydration
    // Option B: Enhance limen_recall to accept a search query parameter
  },
);
```

**The architectural question for Layer 3:** Should `limen_search` go DIRECTLY to the database (bypassing the system call), or should it use SC-13 with post-filtering?

**Answer: It MUST use SC-13 (or compose system calls).** Going directly to the database would bypass RBAC, rate limiting, tenant isolation, and audit. The MCP tool layer is a convenience wrapper -- it must delegate to the constitutional enforcement layer.

**The solution:** `limen_search` performs the FTS5 query to get candidate claim IDs, then calls `limen.claims.queryClaims()` with a subject filter that matches those IDs. Since `queryClaims` already supports exact subject match, the FTS5 results can be fed back as individual queries or as a batch.

**Better solution for Layer 3:** Instead of a separate tool, enhance `limen_recall` internally. The `limen_recall` tool already post-processes results (filtering superseded claims). Adding a `query` parameter to the MCP tool schema (NOT to `ClaimQueryInput`) is consistent with the existing pattern where MCP tools have their own schemas.

---

## 5. Injection Points (Exact Locations)

### Migration injection
**File:** Create `src/claims/migration/0XX_fts5_claims.ts`
**Registration:** Add to `getCcpClaimsMigrations()` function (wherever that returns the migration array)
**Version:** Next available migration version after current highest

### Query enhancement injection
**File:** `src/claims/store/claim_stores.ts`
**Function:** `createClaimStoreImpl()` → `query()` method, starting at line 355
**Exact insertion point:** Lines 369-387 (subject and predicate filter construction)
**What changes:** The `LIKE` clauses become FTS5 `MATCH` clauses (with fallback)

### MCP tool injection
**File:** `packages/limen-mcp/src/tools/knowledge.ts`
**Function:** `registerKnowledgeTools()`
**Insertion point:** After `limen_recall` definition (line 207) OR modification of `limen_recall` itself (line 165)

---

## 6. What Does NOT Change

| Element | Status |
|---|---|
| `ClaimQueryInput` interface | UNCHANGED -- same fields, same types |
| `ClaimQueryResult` interface | UNCHANGED -- same output shape |
| `SC-13 (queryClaims)` system call | UNCHANGED -- same signature |
| `SC-11 (assertClaim)` system call | UNCHANGED |
| `SC-12 (relateClaims)` system call | UNCHANGED |
| `ClaimSystem` interface | UNCHANGED |
| `ClaimStore` interface | UNCHANGED |
| `RawClaimFacade` | UNCHANGED |
| `ClaimApiImpl` | UNCHANGED |
| `limen.claims` public API | UNCHANGED |
| System call count | UNCHANGED (16) |
| `limen_claim_query` MCP tool schema | UNCHANGED |
| RBAC enforcement | PRESERVED |
| Tenant isolation | PRESERVED |
| Rate limiting | PRESERVED |
| Audit trail | PRESERVED |

---

## 7. FTS5 Capabilities Gained

With this implementation, Limen gains:

1. **Content search:** Find claims by text content in `object_value`, not just structured subject/predicate filters.
2. **Prefix optimization:** Wildcard queries (`entity:project:*`) use FTS5 prefix matching instead of `LIKE '%'` scans.
3. **Relevance ranking:** FTS5 provides `bm25()` ranking. Claims can be returned in relevance order.
4. **Phrase search:** `"exact phrase"` matching across claim content.
5. **Boolean queries:** `term1 AND term2`, `term1 OR term2`, `term1 NOT term2`.
6. **Column-specific search:** Search only subject, only predicate, or only object_value.
7. **Snippet/highlight:** FTS5 auxiliary functions for search result highlighting.

---

## 8. Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| FTS5 triggers slow down claim insertion | LOW | External content tables minimize overhead. Triggers only update inverted index, not content. Benchmark required. |
| Migration `rebuild` on large databases is slow | MEDIUM | One-time cost. Can be optimized with batch rebuild. Document expected time for large deployments. |
| FTS5 tokenizer may not handle URN colons well | MEDIUM | Use `unicode61` tokenizer with `tokenchars=':'` to preserve URN structure, OR use `trigram` tokenizer for substring matching. Requires testing. |
| Tombstone UPDATE trigger may fail on NULL values | LOW | The UPDATE trigger fires on tombstone, which NULLs content. The 'delete' command removes the old index entry. The new INSERT may fail with NULLs -- need to handle with `WHEN NEW.subject IS NOT NULL` guard on the INSERT part. |
| Backward compatibility: databases without FTS5 migration | LOW | Layer 2 checks for FTS5 table existence and falls back to LIKE. No breakage. |
| CCP-I1 (content immutability) trigger interaction | LOW | FTS5 sync triggers fire AFTER the immutability trigger (which is BEFORE UPDATE). No conflict -- immutability blocks the change before FTS5 sync fires. |

---

## 9. Implementation Recommendation

**Phase 1 (Foundation):** Layer 1 (migration) + Layer 2 (internal query enhancement with FTS5 for wildcard queries). This gives all existing queries a speed boost with zero API changes.

**Phase 2 (Search):** Layer 3 (MCP tool for content search). This gives agents the ability to search claim content semantically. Likely implemented as a `query` parameter on `limen_recall` rather than a new tool.

**Phase 1 is pure internal optimization.** No consumer ever knows FTS5 exists. Same inputs. Same outputs. Faster.

**Phase 2 is a convenience tool addition.** It adds an MCP tool parameter (NOT a system call parameter). Consistent with existing patterns where MCP tools compose system calls.

---

## 10. Alternative: Trigram Tokenizer

If the primary use case is substring matching within URNs (e.g., finding all claims where the subject contains "project" anywhere), FTS5's `trigram` tokenizer is superior to the default tokenizer:

```sql
CREATE VIRTUAL TABLE claim_assertions_fts USING fts5(
  subject,
  predicate,
  object_value,
  content=claim_assertions,
  content_rowid=rowid,
  tokenize='trigram'
);
```

Trigram advantages:
- Matches substrings anywhere in the text, not just word boundaries
- Perfect for URN-style identifiers (`entity:project:limen`)
- No need for `tokenchars` configuration

Trigram disadvantages:
- Larger index (every 3-character sequence is indexed)
- No word-boundary semantics (no phrase search, no boolean word queries)
- Slower `rebuild` on large datasets

**Recommendation:** Start with `unicode61 tokenchars ':'` for the initial implementation. If substring matching is needed, add a second FTS5 table with `trigram` tokenizer (they can coexist).

---

## 11. Sources

- **Limen source code:** `/Users/solishq/Projects/limen/src/claims/store/claim_stores.ts` -- primary query implementation
- **Limen migration:** `/Users/solishq/Projects/limen/src/claims/migration/019_ccp_claims.ts` -- claim_assertions schema
- **Limen MCP server:** `/Users/solishq/Projects/limen/packages/limen-mcp/src/server.ts` -- MCP tool registration
- **Limen knowledge tools:** `/Users/solishq/Projects/limen/packages/limen-mcp/src/tools/knowledge.ts` -- recall/remember/reflect
- **Limen claim tools:** `/Users/solishq/Projects/limen/packages/limen-mcp/src/tools/claim.ts` -- low-level claim MCP tools
- **Claim types:** `/Users/solishq/Projects/limen/src/claims/interfaces/claim_types.ts` -- ClaimQueryInput/ClaimQueryResult
- **Database interface:** `/Users/solishq/Projects/limen/src/kernel/interfaces/database.ts` -- DatabaseConnection
- **better-sqlite3 FTS5:** [GitHub Issue #1253](https://github.com/WiseLibs/better-sqlite3/issues/1253) -- confirmed SQLITE_ENABLE_FTS5 compiled by default
- **SQLite FTS5 docs:** [sqlite.org/fts5.html](https://sqlite.org/fts5.html) -- external content tables, tokenizers, sync triggers

---

## 12. Confidence Levels

| Finding | Confidence | Basis |
|---|---|---|
| MCP tools are NOT system calls | CONFIRMED | Source code proves separation. A-04 annotation in codebase. |
| better-sqlite3 has FTS5 enabled | CONFIRMED | GitHub issue #1253, resolved. |
| ClaimStore.query() is the injection point | CONFIRMED | Source code, line 355 of claim_stores.ts. |
| FTS5 external content tables work with triggers | CONFIRMED | SQLite official documentation. |
| Internal query enhancement preserves system call boundary | CONFIRMED | Same ClaimQueryInput in, same ClaimQueryResult out. |
| Wildcard LIKE can be replaced with FTS5 MATCH | LIKELY | Requires tokenizer testing with URN-style identifiers. |
| Trigram tokenizer is better for URN substring matching | LIKELY | Based on FTS5 documentation. Needs benchmarking. |
| Performance impact on INSERT is acceptable | UNCERTAIN | External content tables minimize overhead, but no benchmark exists. |

---

*SolisHQ -- First principles. No assumptions. Read the code, prove it.*
