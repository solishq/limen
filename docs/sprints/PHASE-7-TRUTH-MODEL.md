# Phase 7: MCP Enhancement — Truth Model

**Date**: 2026-03-30
**Tier**: 2
**Governing spec**: LIMEN_BUILD_PHASES.md Phase 7

---

## Invariants

### I-P7-01: Delegation Invariant
All Phase 7 MCP tools delegate exclusively to the Limen convenience API (`limen.recall()`, `limen.search()`, `limen.cognitive.health()`). No tool accesses ClaimApi, ClaimStore, or database connections directly.

### I-P7-02: Context Builder Output
`limen_context` returns a formatted string containing recalled beliefs. When no claims match the filters, it returns an empty/minimal context section (not an error).

### I-P7-03: Bulk Recall Completeness
`limen_recall_bulk` returns one result array per input subject. The output array length equals the input subjects array length. Subjects with no matching claims return empty arrays.

### I-P7-04: Search Fidelity
`limen_search` returns SearchResult objects with `belief`, `relevance`, and `score` fields matching the convenience API's SearchResult type exactly.

### I-P7-05: Decay Visibility
`limen_recall` MCP tool output includes `effectiveConfidence` (number) and `freshness` (string label) for every BeliefView in the results.

### I-P7-06: Health Report Structure
`limen_health_cognitive` returns the complete CognitiveHealthReport structure: totalClaims, freshness, conflicts, confidence, gaps, staleDomains.

### I-P7-07: Input Validation
All MCP tools validate inputs via Zod schemas before delegating to the convenience API. Invalid inputs produce `isError: true` MCP responses with descriptive messages.

### I-P7-08: Error Propagation
When the convenience API returns `Result.err`, the MCP tool propagates the error code and message in the MCP response with `isError: true`.

---

## Assertions

1. `limen_context` calls `limen.recall()` — never `limen.claims.queryClaims()`.
2. `limen_health_cognitive` calls `limen.cognitive.health()` — never `computeCognitiveHealth()` directly.
3. `limen_recall_bulk` calls `limen.recall()` once per subject — no batch optimization that bypasses the convenience layer.
4. `limen_search` calls `limen.search()` — never `limen.claims.searchClaims()`.
5. Existing MCP tools continue to function identically after Phase 7 changes.
