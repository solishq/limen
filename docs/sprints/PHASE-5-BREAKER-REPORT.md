# PHASE 5 BREAKER REPORT: Reasoning + Cognitive Health

**Date**: 2026-03-30
**Author**: Breaker (SolisHQ Engineering)
**Artifacts Attacked**: health.ts, cognitive_api.ts, 032_reasoning.ts, claim_stores.ts, convenience_layer.ts, convenience_types.ts, api.ts, index.ts
**Tests Attacked**: health.test.ts (9), reasoning.test.ts (12)
**Controls Attacked**: PHASE-5-DC-DECLARATION.md, PHASE-5-TRUTH-MODEL.md

---

## Prompt Audit Gate

No issues found with the Breaker dispatch prompt. All artifacts listed, priority attack vectors enumerated, mandatory checks specified.

---

## Oracle Gate Results

| Gate | Tool | Class A Verdict | Checks | Key Findings | Status |
|------|------|-----------------|--------|--------------|--------|
| OG-THREAT | oracle_threat_model | N/A | N/A | Intelligence MCP unavailable | DEGRADED |
| OG-FMEA | oracle_fmea | N/A | N/A | Intelligence MCP unavailable | DEGRADED |

**Degradation Note**: Oracle Intelligence MCP tools (`oracle_threat_model`, `oracle_fmea`) are not available in this session. Manual threat analysis was conducted in their place, with deeper-than-normal manual mutation testing to compensate.

### Oracle-Informed Findings

N/A (gates degraded). Manual STRIDE analysis conducted:
- **Spoofing**: Tenant isolation in health queries verified (parameterized SQL with `tenant_id IS ?`).
- **Tampering**: CCP-I1 trigger extension verified (reasoning in protected columns). Trigger fidelity confirmed against 019_ccp_claims.ts.
- **Information Disclosure**: No credential/secret exposure in reasoning field (TEXT via parameterized SQL).
- **Denial of Service**: No unbounded scan in health queries (all use LIMIT clauses). Performance budget DC-P5-901 is CBD (deferred).
- **Elevation of Privilege**: No new system calls (DC-P5-109). Cognitive namespace is read-only.

---

## Amendment 21 Dual-Path Audit

| DC-ID | Success Test? | Rejection Test? | Both Discriminative? | Verdict |
|-------|--------------|-----------------|---------------------|---------|
| DC-P5-101 | YES (reasoning.test.ts:75) | N/A (not enforcement) | N/A | PASS |
| DC-P5-102 | YES (reasoning.test.ts:202) | **NO** -- test reads claim back but does NOT attempt SQL UPDATE | NOT DISCRIMINATIVE | **FAIL** |
| DC-P5-103 | YES (reasoning.test.ts:155) | YES (reasoning.test.ts:168) | YES (M-5 killed) | PASS |
| DC-P5-104 | YES (health.test.ts:105) | YES (health.test.ts:120) | YES | PASS |
| DC-P5-105 | YES (health.test.ts:152) | N/A (mathematical invariant) | N/A | PASS |
| DC-P5-106 | YES (health.test.ts:72) | N/A (zero handling) | N/A | PASS |
| DC-P5-107 | YES (health.test.ts:177) | YES (health.test.ts:194) | YES | PASS |
| DC-P5-401 | YES (health.test.ts:285) | **NO** -- no multi-tenant test | N/A | **FAIL** |
| DC-P5-601 | YES (reasoning.test.ts:246) | **NO** -- does NOT test trigger fires on UPDATE | NOT DISCRIMINATIVE | **FAIL** |
| DC-P5-801 | YES (health.test.ts:226) | N/A (QUALITY_GATE) | N/A | PASS |
| DC-P5-802 | YES (health.test.ts:263) | **NO** -- only tests recent domain NOT in gaps; no test for old domain IN gaps | HALF-COVERED | **FAIL** |

**A21 Failures**: 4 DCs fail dual-path audit.

---

## DC Coverage Matrix

| DC-ID | Test(s) | Discriminative? | Evidence Level |
|-------|---------|-----------------|----------------|
| DC-P5-101 | reasoning.test.ts:75,96,110,129 | YES (M-4 killed, M-6 killed) | Strong |
| DC-P5-102 | reasoning.test.ts:202,214 | **NO** -- rejection test is non-discriminative (see F-P5-003) | Weak |
| DC-P5-103 | reasoning.test.ts:155,168,183 | YES (M-5 killed) | Strong |
| DC-P5-104 | health.test.ts:105,120 | YES | Strong |
| DC-P5-105 | health.test.ts:152 | **NO** -- M-7 survived (hardcoded all-stale still sums to totalClaims) | Weak |
| DC-P5-106 | health.test.ts:72 | YES | Strong |
| DC-P5-107 | health.test.ts:177,194 | YES | Strong |
| DC-P5-108 | N/A (structural audit) | N/A | Structural |
| DC-P5-109 | N/A (structural audit) | N/A | Structural |
| DC-P5-110 | Full test suite | YES | Strong |
| DC-P5-201 | N/A (structural) | N/A | Structural |
| DC-P5-301 | N/A (WAL isolation) | N/A | Structural |
| DC-P5-401 | health.test.ts:285 | **NO** -- single-tenant only, no cross-tenant isolation test | Weak |
| DC-P5-501 | N/A (CBD) | N/A | Deferred |
| DC-P5-601 | reasoning.test.ts:246 | **NO** -- does not test trigger fires | Weak |
| DC-P5-701 | N/A (structural -- parameterized SQL) | N/A | Structural |
| DC-P5-801 | health.test.ts:226 | YES (M-1 killed, M-9 killed) | Strong |
| DC-P5-802 | health.test.ts:263 | **NO** -- M-2 survived (gap detection entirely removed) | ABSENT |
| DC-P5-901 | N/A (CBD) | N/A | Deferred |

---

## Mutation Testing Results

| # | Mutation | File:Line | Expected | Actual | If Survived |
|---|---------|-----------|----------|--------|-------------|
| M-1 | Remove median computation (hardcoded 0) | health.ts:223-231 | DC-P5-801 test fails | **KILLED** | -- |
| M-2 | Remove gap detection entirely (return []) | health.ts:266-337 | DC-P5-802 test fails | **SURVIVED** | Zero tests exercise gap detection with old domains |
| M-3 | Remove stale domains computation entirely | health.ts:339-383 | staleDomains tests fail | **SURVIVED** | Zero tests exercise staleDomains with stale claims |
| M-4 | Null out reasoning in BeliefView recall mapping | convenience_layer.ts:302 | DC-P5-101 test fails | **KILLED** | -- |
| M-5 | Remove reasoning length validation | convenience_layer.ts:165-168 | DC-P5-103 test fails | **KILLED** | -- |
| M-6 | Remove reasoning pass-through to ClaimCreateInput | convenience_layer.ts:203 | DC-P5-101 test fails | **KILLED** | -- |
| M-7 | Hardcode freshness as all-stale (fresh=0, aging=0, stale=total) | health.ts:194-206 | DC-P5-105 test fails | **SURVIVED** | Sum invariant still holds; no test checks individual buckets |
| M-8 | Null out reasoning in search results mapping | convenience_layer.ts:520 | DC-P5-101 test fails | **SURVIVED** | No test exercises reasoning via search() path |
| M-9 | Wrong median offset (floor(n/2)+999) | health.ts:223 | DC-P5-801 test fails | **KILLED** | -- |
| M-10 | Replace computeCognitiveHealth with empty report | cognitive_api.ts:70-76 | Multiple tests fail | **KILLED** | -- |

**Summary**: 10 mutations, 6 KILLED, 4 SURVIVED. Survival rate: 40%. This is high.

---

## Findings Table

| # | Finding | Severity | Category | Evidence | Recommendation |
|---|---------|----------|----------|----------|----------------|
| F-P5-001 | Gap detection entirely removable -- zero tests exercise gaps with old domains | **HIGH** | 1: Data Integrity | M-2 SURVIVED: Removed 70 lines of gap detection logic, all 21 tests pass | Add test: create claims with old valid_at (> gapThresholdDays ago), verify domain appears in gaps array |
| F-P5-002 | Stale domains computation entirely removable -- zero tests exercise staleDomains | **HIGH** | 1: Data Integrity | M-3 SURVIVED: Removed all staleDomains SQL + aggregation, all 21 tests pass | Add test: create claims, simulate old last_accessed_at, verify predicate appears in staleDomains |
| F-P5-003 | DC-P5-102 immutability trigger test is non-discriminative -- never attempts SQL UPDATE | **HIGH** | 2: State Consistency | reasoning.test.ts:214-238 -- test just reads claim back, does not exercise CCP-I1 trigger on reasoning column | Add test: direct SQL UPDATE of reasoning on existing claim, assert RAISE(ABORT) with CCP-I1 error |
| F-P5-004 | Freshness classification mutation survived -- hardcoded all-stale passes DC-P5-105 | **MEDIUM** | 8: Behavioral Quality | M-7 SURVIVED: DC-P5-105 test checks sum invariant only (fresh+aging+stale===total) but not individual bucket correctness | Add test: verify fresh count > 0 for newly created claims (last_accessed_at is recent) |
| F-P5-005 | DC-P5-802 gap detection has only success-path test, no rejection-path test | **MEDIUM** | A21 Violation | health.test.ts:263-277 -- only tests domain with recent claim NOT in gaps; DC declaration promises rejection test for old domains | Add rejection test: claims with old valid_at, assert domain IS in gaps with correct significance |
| F-P5-006 | Reasoning in search results has zero test coverage | **MEDIUM** | 1: Data Integrity | M-8 SURVIVED: Nulled out reasoning in search() BeliefView mapping, all tests pass | Add test: remember with reasoning, search, assert search result belief.reasoning matches |
| F-P5-007 | PHASE-5-DESIGN-SOURCE.md does not exist in repository | **MEDIUM** | P-008 Documentation | Referenced by health.ts:8, cognitive_api.ts:7, 032_reasoning.ts:5, DC declaration, truth model. File not in docs/sprints/ | Create PHASE-5-DESIGN-SOURCE.md or remove references |
| F-P5-008 | DC-P5-601 trigger recreation test is non-discriminative -- never tests trigger fires on UPDATE | **MEDIUM** | 6: Migration/Evolution | reasoning.test.ts:246-261 -- test creates a claim and reads it back, but does not attempt UPDATE to verify trigger | Add test: direct SQL UPDATE on subject after migration, assert CCP-I1 error |
| F-P5-009 | DC-P5-401 tenant isolation has no cross-tenant test (single-tenant only) | **MEDIUM** | 4: Authority/Governance | health.test.ts:285-297 -- test creates claims in default tenant and verifies count; no second tenant with claims that should be excluded | Add test: create claims in separate tenants, verify health report is scoped |
| F-P5-010 | Median computation is approximate for even-count arrays | **LOW** | 8: Behavioral Quality | health.ts:223 -- `Math.floor(totalClaims / 2)` picks one middle element; mathematical median of [a,b] = (a+b)/2 | Document as known approximation or implement true even-count median |
| F-P5-011 | hasReasoningColumn backward-compatibility path has zero test coverage | **LOW** | 6: Migration/Evolution | claim_stores.ts:337-338 -- `else if (hasStabCol)` branch (v39 schema without v41 reasoning column) is never exercised by any test | Add integration test with pre-v41 schema to verify INSERT works without reasoning column |
| F-P5-012 | DC declaration lists 9 categories as covered but Category 7 (Credential/Secret) is N/A with insufficient justification | **LOW** | Declaration quality | DC-P5-701 says "N/A -- reasoning is stored via parameterized SQL" but reasoning TEXT could contain user-pasted secrets/credentials that get exposed in recall/search results | Consider whether reasoning text should be treated as potentially sensitive and whether it needs audit-trail-only visibility |

---

## 10 Recurring Patterns Check

| # | Pattern | Checked | Result |
|---|---------|---------|--------|
| P-001 | Non-discriminative enforcement tests | YES | **FOUND**: DC-P5-105 sum-invariant test passes with wrong distribution (M-7), DC-P5-102 rejection test reads claim instead of exercising trigger (F-P5-003) |
| P-002 | Defense built but not wired in | YES | **CLEAN**: computeCognitiveHealth is wired through createCognitiveNamespace (M-10 killed). Reasoning pass-through wired (M-6 killed). |
| P-003 | IBC overclaims | YES | **CLEAN**: No "impossible by construction" claims in Phase 5. All enforcement is via trigger (CCP-I1 extension) or runtime validation. |
| P-004 | Test rewrite drops coverage | YES | **CLEAN**: No prior test file was rewritten. 21 tests is net new. |
| P-005 | Phantom test references | YES | **CLEAN**: All DC-to-test references verified. Tests exist at cited locations. |
| P-006 | Cross-subsystem boundary gaps | YES | **FOUND**: CognitiveNamespace boundary to health computation has zero error-path tests (cognitive_api.ts catch clause at line 78-80 never exercised). Convenience-to-search boundary reasoning mapping untested (M-8 survived). |
| P-007 | FM numbering collisions | YES | **CLEAN**: All DC IDs use DC-P5-xxx format, no collisions. |
| P-008 | Documentation in session only | YES | **FOUND**: PHASE-5-DESIGN-SOURCE.md does not exist in repo (F-P5-007). Referenced by 6+ locations. |
| P-009 | Prompt Audit Gate degradation | YES | **CLEAN**: Builder prompt not available for audit. Breaker prompt contains PAG instruction. |
| P-010 | Implementation logic in harness | YES | **CLEAN**: No harness file for Phase 5. Tests use createTestLimen() factory directly (appropriate). |

---

## Architecture-Level Findings

- **Cognitive namespace is read-only**: No mutation risk from concurrent health() calls. SQLite WAL provides read isolation. Sound architecture.
- **No new system calls**: DC-P5-109 holds. Cognitive namespace delegates directly to SQL, not through the system call layer. This is a clean architecture decision.
- **Forward-compatibility**: The namespace pattern (limen.cognitive) supports future Phase 12 methods (consolidate, verify, narrative) without breaking changes.

---

## Security Findings

- **SQL injection**: All queries use parameterized SQL. No string interpolation in any health.ts query. Clean.
- **Trigger fidelity**: Migration 032_reasoning.ts trigger recreation matches 019_ccp_claims.ts original columns exactly, with reasoning added. Verified line-by-line: 11 original protected columns + reasoning = 12 total.
- **Tenant isolation**: Parameterized `tenant_id IS ?` in all 10 SQL queries in health.ts. Structurally sound but UNTESTED for multi-tenant (F-P5-009).

---

## Performance Findings

- **No materialized views**: All health computations are live SQL aggregations. At 100K claims, the 5+ separate queries may exceed the 200ms budget. DC-P5-901 is CBD but worth noting.
- **No caching**: computeCognitiveHealth runs fresh SQL every call. For frequent health polling, this could be expensive.

---

## Dependency Findings

No new dependencies introduced in Phase 5. Clean.

---

## Self-Audit

- Was every finding derived from evidence? **YES** -- all findings backed by mutation results (M-1 through M-10), file:line references, or grep results.
- What would I check to prove my findings wrong? I would need to find hidden tests in other test files that exercise gap detection with old claims, stale domains with stale claims, and CCP-I1 trigger UPDATE rejection on reasoning.
- What did I NOT examine? Performance testing (DC-P5-901 is CBD). Audit trail verification (DC-P5-501 is CBD). Load/concurrency testing. The `err` function in cognitive_api.ts error path.
- Is my finding count reasonable? **YES** -- 12 findings (0 CRITICAL, 3 HIGH, 6 MEDIUM, 3 LOW). Historical average is 16.4. Phase 5 is smaller scope (pure computation module + simple migration), so 12 is consistent.
- Did I check all 10 recurring patterns? **YES** -- table above.

---

## Verdict

**CONDITIONAL PASS** -- 3 HIGHs must be fixed before merge:

1. **F-P5-001** (gap detection M-2 survived): Add tests that exercise gap detection with old domains
2. **F-P5-002** (stale domains M-3 survived): Add tests that exercise staleDomains with stale claims
3. **F-P5-003** (DC-P5-102 trigger non-discriminative): Add test that actually attempts SQL UPDATE on reasoning and asserts CCP-I1 rejection

All 6 MEDIUMs should be addressed. The 3 LOWs are acceptable risk.

---

## Oracle Gates Summary (HB#29)

| Gate | Tool | Status | Notes |
|------|------|--------|-------|
| OG-THREAT | oracle_threat_model | DEGRADED | Intelligence MCP unavailable. Manual STRIDE analysis conducted. |
| OG-FMEA | oracle_fmea | DEGRADED | Intelligence MCP unavailable. Manual failure mode analysis via mutation testing (10 mutations). |

---

*SolisHQ -- We innovate, invent, then disrupt.*
