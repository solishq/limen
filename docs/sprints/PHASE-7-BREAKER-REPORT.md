# Phase 7: MCP Enhancement -- Breaker Pass B Report

**Date**: 2026-03-30
**Tier**: 2
**Breaker**: Breaker Agent (independent session)
**Target**: Phase 7 MCP Enhancement tools (limen_context, limen_health_cognitive, limen_search, limen_recall_bulk, limen_recall decay visibility)
**Test Suite**: `packages/limen-mcp/tests/phase7-tools.test.ts` (18 tests, all pass)

---

## Prompt Audit Gate

No issues found with the dispatch prompt. All mandatory fields present, attack vectors enumerated, output target specified.

---

## Oracle Gate Results

| Gate | Tool | Class A Verdict | Status |
|------|------|-----------------|--------|
| OG-THREAT | oracle_threat_model | DEGRADED | Intelligence MCP unavailable -- manual analysis conducted |
| OG-FMEA | oracle_fmea | DEGRADED | Intelligence MCP unavailable -- manual analysis conducted |

### Degradation Compensation

OG-THREAT DEGRADED: Manual STRIDE analysis conducted. Key threat categories addressed: Spoofing (N/A -- MCP tools are server-side), Tampering (input validation gaps found), Repudiation (N/A -- delegates to audited layer), Information Disclosure (error messages expose internal codes -- acceptable), Denial of Service (limit bypass found), Elevation of Privilege (no auth at MCP layer -- by design).

OG-FMEA DEGRADED: Manual failure mode analysis conducted. Critical failure modes: unguarded JSON.parse (RPN HIGH), missing limit enforcement (RPN MEDIUM), NaN propagation through effectiveConfidence formatting (RPN MEDIUM), negative limit passthrough (RPN LOW).

---

## CRITICAL STRUCTURAL FINDING: Tests Do Not Test MCP Layer

**Every test in `phase7-tools.test.ts` calls `limen.recall()`, `limen.search()`, and `limen.cognitive.health()` DIRECTLY on the Limen engine.** Zero tests import `registerContextTools`, `registerCognitiveTools`, `registerSearchTools`, or `registerClaimTools`. Zero tests instantiate an `McpServer`. Zero tests invoke any MCP tool handler.

The tests verify that the convenience API works. They do NOT verify:
- That the MCP tool registration functions exist or are callable
- That the Zod schemas accept valid input or reject invalid input
- That the tool handlers correctly delegate to the convenience API
- That error responses use the `{ error, message }` format with `isError: true`
- That the text formatting in `limen_context` produces correct output
- That `limen_recall_bulk` JSON.parse/array validation works
- That `limen_recall_bulk` 50-subject limit is enforced

**Evidence**: `grep -c 'registerContextTools\|registerCognitiveTools\|registerSearchTools\|McpServer' packages/limen-mcp/tests/phase7-tools.test.ts` returns 0.

**Impact**: The ENTIRE MCP integration layer (4 new files, ~300 lines of tool handlers) is structurally untested. The tests are testing the dependency, not the artifact.

---

## Mutation Testing Results

**7/7 mutations SURVIVED.** This is a total mutation survival rate of 100%.

| # | Mutation | File:Line | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| M-1 | Replace `limen_context` delegation with hardcoded empty response | `context.ts:29-36` | context delegation tests fail | ALL 18 TESTS PASS | **SURVIVED** |
| M-2 | Strip `effectiveConfidence` and `freshness` from `limen_recall` MCP output | `claim.ts:160-162` | decay visibility tests fail | ALL 18 TESTS PASS | **SURVIVED** |
| M-3 | Replace `limen_health_cognitive` with hardcoded `totalClaims: 999` | `cognitive.ts:41` | health tests fail | ALL 18 TESTS PASS | **SURVIVED** |
| M-4 | Replace `limen_search` delegation with hardcoded empty array | `search.ts:34-37` | search tests fail | ALL 18 TESTS PASS | **SURVIVED** |
| M-5 | Remove 50-subject limit from `limen_recall_bulk` | `search.ts:86-91` | bulk recall limit tests fail | ALL 18 TESTS PASS | **SURVIVED** |
| M-6 | Comment out ALL Phase 7 tool registrations in `server.ts` | `server.ts:85-87` | registration tests fail | ALL 18 TESTS PASS | **SURVIVED** |
| M-7 | Remove JSON.parse error handling + array validation from `limen_recall_bulk` | `search.ts:64-78` | input validation tests fail | ALL 18 TESTS PASS | **SURVIVED** |

**Root cause**: Tests import `createLimen` and test the convenience API directly. The MCP tool handlers that wrap these APIs are never instantiated or invoked by any test.

---

## Amendment 21 Dual-Path Audit

| DC-ID | Success Test? | Rejection Test? | Both Discriminative? | Verdict |
|---|---|---|---|---|
| DC-P7-001 | Tests call `limen.recall()` directly (YES for API, NO for MCP) | N/A (structural) | N/A | **FAIL** -- tests do not exercise MCP delegation |
| DC-P7-002 | `context builder returns beliefs from recall` (YES for API) | `context with no matching claims returns empty` (YES for API) | NO -- neither exercises `registerContextTools` | **FAIL** |
| DC-P7-003 | `bulk recall returns one result per subject` (YES for API) | `bulk recall with non-existent subject returns empty` (YES for API) | NO -- neither exercises `registerSearchTools` | **FAIL** |
| DC-P7-004 | `search returns matching claims with relevance and score` (YES for API) | `search with empty query returns error` (YES for API, error code checked) | NO -- exercises `limen.search()` not MCP tool | **FAIL** |
| DC-P7-005 | `recall returns beliefs with effectiveConfidence and freshness` (YES) | N/A (structural) | NO -- exercises `limen.recall()` not MCP tool | **FAIL** |
| DC-P7-006 | `health report on empty knowledge base returns all-zero values` (YES) | N/A | NO -- exercises `limen.cognitive.health()` not MCP tool | **FAIL** |
| DC-P7-007 | `search rejects empty query string` (YES for API) | YES (checks `result.ok === false`) | NO -- exercises `limen.search('')` not Zod validation | **FAIL** |

**Summary**: All 7 DCs have tests that exercise the underlying convenience API but NONE exercise the MCP tool layer that Phase 7 built. Every DC fails the A21 audit at the MCP layer.

---

## DC Coverage Matrix

| DC-ID | Test(s) | Discriminative? | Evidence Level |
|---|---|---|---|
| DC-P7-001 | All tests | NO -- tests never call tool handlers | **UNCOVERED at MCP layer** |
| DC-P7-002 | `context builder returns beliefs from recall`, `context with no matching claims returns empty` | NO -- M-1 survived | **UNCOVERED at MCP layer** |
| DC-P7-003 | `bulk recall returns one result per subject`, `bulk recall with non-existent subject returns empty`, `empty subjects array returns empty results` | NO -- M-5, M-7 survived | **UNCOVERED at MCP layer** |
| DC-P7-004 | `search returns matching claims...`, `search with non-matching query returns empty`, `search with empty query returns error`, `search results have complete BeliefView structure` | NO -- M-4 survived | **UNCOVERED at MCP layer** |
| DC-P7-005 | `recall returns beliefs with effectiveConfidence and freshness` | NO -- M-2 survived | **UNCOVERED at MCP layer** |
| DC-P7-006 | `health report on empty knowledge base...`, `health report reflects seeded claims`, `health report has complete structure` | NO -- M-3 survived | **UNCOVERED at MCP layer** |
| DC-P7-007 | `search rejects empty query string`, wildcard tests | NO -- M-7 survived | **UNCOVERED at MCP layer** |

---

## Findings Table

| # | Finding | Severity | Category | Evidence | Recommendation |
|---|---|---|---|---|---|
| F-P7-001 | Tests do not test the MCP layer -- all 18 tests call convenience API directly, zero tests invoke any tool handler | **HIGH** | P-001 non-discriminative | M-1 through M-7 all survived; `grep registerContextTools tests/` returns 0 | Write tests that instantiate McpServer, register tools, and call tool handlers via `server.tool()` |
| F-P7-002 | All Phase 7 tool registrations removable without test failure -- M-6 survived | **HIGH** | P-002 defense not wired | `server.ts:85-87` commented out, all 18 tests pass | Add wiring test that verifies Phase 7 tools are registered on the server |
| F-P7-003 | `limen_claim_assert` has 3 unguarded `JSON.parse()` calls that throw on invalid input | **MEDIUM** | Input validation | `claim.ts:46` (objectValue), `claim.ts:53` (evidenceRefs), `claim.ts:58` (runtimeWitness) -- all throw SyntaxError on invalid JSON | Wrap in try/catch with MCP error response |
| F-P7-004 | Zod schemas describe range constraints in text but do not enforce them -- `minConfidence` accepts any number, `confidence` accepts any number, `limit` accepts negative/zero/unbounded | **MEDIUM** | Input validation | `search.ts:29-30` says "0.0-1.0" and "max: 200" in describe() but no `.min()/.max()` on schema; `claim.ts:30` says "0.0 to 1.0" with no range enforcement | Add `.min(0).max(1)` to confidence fields, `.min(1).max(N)` to limit fields |
| F-P7-005 | `limen_context` and `limen_recall_bulk` pass negative limits through -- `Math.min(-5, 100)` = -5 | **MEDIUM** | Input validation | `context.ts:27`, `search.ts:93` -- `Math.min(args.limit ?? 20, 100)` does not guard against negative | Add `Math.max(1, ...)` or Zod `.min(1)` |
| F-P7-006 | `limen_search` limit is uncapped at MCP layer -- Zod schema has no `.max()`, handler passes `args.limit` directly | **MEDIUM** | Availability/resource | `search.ts:30` schema description says "max: 200" but no enforcement; `search.ts:35` passes uncapped limit | Add `Math.min(args.limit ?? 20, 200)` or Zod `.max(200)` |
| F-P7-007 | `limen_context` text formatter will throw TypeError if `effectiveConfidence` is undefined (NaN is non-fatal but produces corrupt output) | **MEDIUM** | Data integrity | `context.ts:63` calls `b.effectiveConfidence.toFixed(2)` -- TypeError on undefined, "NaN" on NaN | Add defensive check before `.toFixed()` |
| F-P7-008 | `limen_recall_bulk` accepts non-string elements in JSON array without validation -- `["entity:x", 42, null]` passes through | **LOW** | Input validation | `search.ts:66-72` validates Array.isArray but not element types | Add element type validation |
| F-P7-009 | server.ts doc comment lists `limen_recall` in BOTH "Phase 7 enhancement tools" (line 24) AND "High-level knowledge tools" (line 34) creating ambiguity | **LOW** | Documentation | `server.ts:24,34` | Clarify that Phase 7 limen_recall replaces the session-managed version |
| F-P7-010 | `limen_claim_assert` `objectType === 'boolean'` parsing only recognizes `'true'` -- `'True'`, `'TRUE'`, `'1'`, `'yes'` all become `false` | **LOW** | Input validation | `claim.ts:44` -- `parsedValue = args.objectValue === 'true'` | Document exact parsing rules or use case-insensitive match |

---

## 10 Recurring Patterns Check

| # | Pattern | Checked | Result |
|---|---|---|---|
| P-001 | Non-discriminative enforcement tests | YES | **FOUND** -- All 18 tests are non-discriminative for the MCP layer (F-P7-001). All 7 mutations survived. |
| P-002 | Defense built but not wired in | YES | **FOUND** -- M-6 proves tool registration wiring is untested (F-P7-002). |
| P-003 | IBC overclaims | YES | No "impossible by construction" claims in DC declaration. N/A. |
| P-004 | Test rewrite drops coverage | YES | Not applicable -- new test file, not a rewrite. |
| P-005 | Phantom test references | YES | DC declaration references test descriptions that match actual test names. No phantoms found. |
| P-006 | Cross-subsystem boundary gaps | YES | **FOUND** -- MCP tool handler layer (the boundary between MCP SDK and Limen engine) has ZERO tests. The boundary is entirely undefended. |
| P-007 | FM numbering collisions | YES | DC-P7-001 through DC-P7-007 are unique. No collisions. |
| P-008 | Documentation in session only | YES | DC declaration and truth model exist as files. Report being written now. |
| P-009 | Prompt Audit Gate degradation | YES | Prompt included attack vectors. No degradation. |
| P-010 | Implementation logic in harness | YES | No harness file -- tests use inline helpers. `createTestEngine()` and `seedClaims()` are thin factories (<15 lines each). No violation. |

---

## Architecture-Level Findings

The architectural issue is clear: the Builder wrote MCP tool handler code (4 files, ~300 lines) and then wrote tests that verify the underlying convenience API instead of the tool handlers themselves. This is the equivalent of testing the database driver when you should be testing the HTTP endpoint. The entire MCP integration boundary is undefended.

---

## Security Findings

1. **Unguarded JSON.parse** (F-P7-003): 3 calls in `limen_claim_assert` that throw uncaught SyntaxError on malformed input. An MCP client sending `{"objectType": "json", "objectValue": "not{json"}` will get an unhandled exception.

2. **Zod schema lies** (F-P7-004): Schemas describe constraints ("0.0-1.0", "max: 200") that they do not enforce. MCP clients that trust the description will be surprised; adversarial clients can send `confidence: 999` or `limit: 10000000`.

---

## Performance Findings

1. **Uncapped search limit** (F-P7-006): `limen_search` passes user-supplied limit directly to the convenience API. A client can request `limit: 1000000`.

2. **Negative limit passthrough** (F-P7-005): A `limit: -1` is passed through to the underlying API, behavior undefined.

---

## Self-Audit

- **Was every finding derived from evidence?** Yes -- every finding has file:line references and/or mutation results.
- **What would I check to prove my findings wrong?** Run `grep registerContextTools` in test files to disprove F-P7-001. Check if MCP SDK provides a test harness that auto-tests registrations. Neither would succeed.
- **What did I NOT examine?** (1) The existing pre-Phase-7 MCP tools (health, agent, mission, wm) -- only Phase 7 artifacts were in scope. (2) Runtime behavior under MCP transport -- would require a running MCP server. (3) The adapter's interaction with Phase 7 tools.
- **Is my finding count reasonable?** 10 findings (0 CRITICAL, 2 HIGH, 5 MEDIUM, 3 LOW). Historical average: 16.4. Below average, but Phase 7 is a thin wrapper layer (~300 lines) so the lower count is justified. The 2 HIGHs are severe -- 100% mutation survival means the MCP layer has zero effective test coverage.

---

## Oracle Gates Summary (HB#29)

| Gate | Status | Evidence |
|------|--------|----------|
| OG-THREAT | DEGRADED -- Intelligence MCP unavailable | Manual STRIDE analysis conducted, findings documented above |
| OG-FMEA | DEGRADED -- Intelligence MCP unavailable | Manual failure mode analysis conducted, findings documented above |

---

## Verdict

**CONDITIONAL PASS** -- F-P7-001 (tests do not test MCP layer, 100% mutation survival) and F-P7-002 (tool registration wiring untested) must be fixed before merge. The Builder must write tests that actually instantiate the MCP tool handlers and invoke them, not just test the underlying convenience API.
