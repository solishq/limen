# ADVERSARIAL CONSISTENCY AUDIT: LIMEN DEFINITIVE SPEC

**Date**: 2026-03-30
**Auditor**: Breaker (SolisHQ Meta-Orchestrator)
**Target**: `~/SolisHQ/Docs/LIMEN_DEFINITIVE_SPEC.md`
**Classification**: SIGNIFICANT
**Verdict**: SPEC DOES NOT SURVIVE. 7 internal contradictions, 6 impossible claims, 4 missing dependencies, 3 unrealistic timelines, 3 survivability risks.

---

## 1. INTERNAL CONTRADICTIONS

### C-01: "3,188+ Tests" vs Reality — ALL TESTS FAILING

**Spec claim** (Part 3, line 230): "3,188+ tests"
**Spec claim** (Part 10, line 917): "3,188 tests, 134 invariants"
**Spec claim** (Part 15, line 1233): "All 3,200+ existing tests pass"

**Reality**: The codebase has 195 test files containing 4,313 `it()` calls. ZERO of them pass. The test files use `node:test` imports but there is no working test runner configuration. Running `npx vitest run` produces "No test suite found" for all 195 files. Running `node --test` produces failures on every file.

**Severity**: CRITICAL. The spec's entire quality narrative is built on "3,188+ tests." If zero tests actually pass, the spec's engineering claims are aspirational, not factual. The Definition of Done for v1.3.0 (line 1233) depends on "All 3,200+ existing tests pass" -- this is impossible when zero tests currently pass.

**Evidence**: `npx vitest run --exclude '.claude/**'` -> "Test Files 195 failed (195), Tests no tests"

---

### C-02: Performance Budget Contradicts FTS5 + Conflict Detection + Auto-Classification Target

**Spec claim** (Part 10, line 936-943): claim assertion budget is <5ms current, <7ms with FTS5.
**Spec claim** (Part 4, line 286): Auto-conflict detection on assertion (same-subject-same-predicate-different-value).
**Spec claim** (Part 4, line 280-283): Auto-classification at Level 0 is "trivial -- already implicit."
**Spec claim** (Part 9, line 818): remember latency <10ms.

**The contradiction**: If `remember()` wraps `claim_assert` AND triggers FTS5 sync (via INSERT trigger) AND runs auto-conflict detection (query for same subject+predicate) AND runs auto-classification (predicate pattern matching), then:
- Base assertion: ~5ms
- FTS5 trigger INSERT: +2ms (spec's own estimate)
- Conflict detection query (SELECT WHERE subject=? AND predicate=?): +1-3ms
- Auto-classification regex: +0.5ms
- Total: 8.5-10.5ms

The <10ms `remember` target is achievable only if conflict detection is NOT synchronous on assertion -- but Part 4 (line 286) describes it as detection that happens during assertion. The spec never resolves whether conflict detection is sync or async on the assertion path.

**Severity**: HIGH. The performance budget is internally inconsistent when all features are active simultaneously.

---

### C-03: "22/22 Feature Completeness" Counts Features That Do Not Exist

**Spec claim** (Appendix B, line 1376): "Limen YES count: 22/22. Next closest: Zep 11/22."

**The deception**: The competitive comparison table (lines 1348-1374) is labeled as "After v1.4.0" (line 1349) but is presented as Limen's current competitive position. Multiple features marked YES do not exist in v1.2.0:
- Conflict detection: NOT BUILT (line 439)
- Health scoring: NOT BUILT (line 457)
- Semantic search: NOT BUILT (line 401)
- Temporal queries: NOT BUILT (line 459)

The "22/22" is a post-v1.4.0 projection presented alongside today's competitive landscape. A developer reading this comparison will believe Limen HAS these features today. This is intellectually dishonest positioning.

**Severity**: HIGH. Marketing fiction disguised as engineering truth.

---

### C-04: "Single Dependency" Claim Contradicts sqlite-vec Requirement

**Spec claim** (Appendix B, line 1371): "Single dependency: YES"
**Spec claim** (Part 13, line 1115): "Adding sqlite-vec to dependencies breaks Invariant I-01"
**Spec claim** (Part 13, line 1116): Resolution is "optional peer dependency"

**The contradiction**: The competitive table counts "single dependency" as YES even though v1.4.0 features (semantic search, hybrid search) require sqlite-vec. An optional peer dependency is still a dependency from the user's perspective when they want advertised features. The 22/22 score is inflated.

**Severity**: MEDIUM. Semantic dishonesty -- "single dependency" is true only if you don't use half the advertised features.

---

### C-05: Convenience API Signature Contradiction (Unresolved)

**Spec claim** (Part 14, Contradiction 1, line 1142-1148): Report #7 wants `limen.remember(text, options?)` (1 param). Reports #1/#15 want `limen.remember(subject, predicate, value, options?)` (3 params).
**Resolution** (line 1148): "Both should exist."

**The unresolved problem**: The spec never specifies which form is the PRIMARY API shown in the README, the quickstart, or the 3-line onboarding. Part 5 (line 541-544) shows the 3-param form. Part 2 (line 144) says "zero-config." If both exist, which is `limen.remember()`? The function signature overload creates a confusing API surface. TypeScript overloads with fundamentally different semantics (auto-generated subject vs explicit subject) are a well-known DX antipattern.

**Severity**: MEDIUM. Architecture decision deferred into ambiguity.

---

### C-06: v1.3.0 Feature List Contradicts Feature Matrix Target Assignments

**Spec claim** (Part 9, line 837-858): v1.3.0 includes 14 features, including Feature 1.9 (Bulk operations, line 856: "Bulk recall MCP tool").
**Spec claim** (Part 4, Feature 1.9, line 403): Bulk operations target is v1.3.0.
**Spec claim** (Part 4, Feature 4.8, line 444): Protected predicates target is v1.3.0.

**The contradiction**: Protected predicates (4.8) is listed as v1.3.0 in the feature matrix but does NOT appear in the v1.3.0 release plan (Part 9, lines 837-858). Either the feature matrix is wrong or the release plan is incomplete.

Similarly, Feature 1.8 (Claim update/supersede convenience) is v1.3.0 in the matrix but absent from the v1.3.0 release plan.

**Severity**: MEDIUM. Feature tracking inconsistency between two sections of the same document.

---

### C-07: Governance Metadata "Strong Consistency" vs "Single SQLite" Architecture

**Spec claim** (Part 3, line 369): "Governance metadata uses strong consistency (Raft)."
**Spec claim** (Part 3, line 218-228): Current architecture is SQLite-based, single-node.

Raft consensus requires multiple nodes. The spec describes a distributed consistency model for a product that is currently single-node embedded SQLite with no distributed component planned until v3.0.0. The governance consistency model contradicts the current (and near-future) architecture. This is not a "future vision" section -- it is stated as a design principle in the architecture section.

**Severity**: LOW (future-looking, but misleadingly placed).

---

## 2. IMPOSSIBLE CLAIMS

### I-01: "17 Days for 14 Features" is Impossible at Quality

**Spec claim** (Part 9, line 858): v1.3.0 total effort is ~17 days for 14 features.
**Spec claim** (Part 15, line 1229-1235): Definition of Done requires new tests for every new surface, all existing tests pass, FTS5 syncs via triggers, CHANGELOG with migration notes.

**Why it is impossible**:
- 17 days is EFFORT estimate, not calendar time. For a solo founder also running SolisHQ (Accipio, Veridion, ConvOps Core, provenance infrastructure, voice infrastructure, governance amendments, research reports), 17 working days is 4-5 calendar weeks minimum.
- The DoD requires "All 3,200+ existing tests pass" -- but ZERO tests currently pass (see C-01). Fixing the test infrastructure alone is a multi-day effort.
- FTS5 integration (3 days estimate) does not include: migration testing, backward compatibility verification, performance benchmarking against the <50ms budget, i18n tokenizer configuration testing (Report #10, Gap 6.5).
- Import/Export CLI (2 days estimate) must support 7 export formats (line 948-956) with atomicity guarantees (line 962). 2 days for 7 formats with atomic transactions is aspirational.
- The spec promises "3 new examples" in 1 day while simultaneously shipping 14 features. Examples require all features to be working, tested, and documented.

**Realistic estimate**: 30-45 working days (6-10 calendar weeks for a solo founder with other products).

---

### I-02: "Zero Test Breakage" Migration is Impossible When Zero Tests Pass

**Spec claim** (Part 10, line 919): "670 claims migrate in <1ms"
**Spec claim** (Part 15, line 1233): "All 3,200+ existing tests pass"

If zero tests currently pass, there is no baseline to measure "zero breakage" against. The migration strategy assumes a healthy test suite. The test suite is not healthy. "Zero test breakage" is undefined when you start from 100% breakage.

**Severity**: CRITICAL. The migration safety narrative collapses entirely.

---

### I-03: FTS5 Search <50ms Claim Lacks Basis

**Spec claim** (Part 8, line 819): "FTS5 search latency <50ms"
**Spec claim** (Part 10, line 941-942): FTS5 budget is <5ms for claim_query JOIN, <50ms for search.

The spec provides no benchmarking evidence for the 50ms claim. FTS5 performance depends on: corpus size, query complexity, tokenizer choice, index size, concurrent operations, and whether ranking (BM25) is used. At 670 claims, 50ms is trivially achievable. At 100K claims with BM25 ranking and unicode61 tokenizer, the budget is unproven. The spec asserts the target without evidence.

**Severity**: MEDIUM. Plausible but unsubstantiated.

---

### I-04: "v1.4.0 in 2-3 Months" with 20 Features is Impossible

**Spec claim** (Part 9, line 862-889): v1.4.0 contains 20 features totaling ~48 days of effort.
**Spec claim** (Part 15, line 1237): v1.4.0 timeline is "Months 2-4."

48 working days for a solo founder across 2-3 months (40-60 working days) leaves almost zero buffer for: debugging, review, certification (the spec's own 7-control process), documentation, community engagement (Gap 8.1), and maintenance of 4 other products. This assumes 100% allocation to Limen, which contradicts the multi-product reality.

Additionally, v1.4.0 depends on v1.3.0 being complete and stable. If v1.3.0 slips (which it will per I-01), v1.4.0 cascades.

**Severity**: HIGH. The cumulative timeline is fantasy.

---

### I-05: sqlite-vec Stability Claim Contradicts Evidence

**Spec claim** (Part 13, line 1113): sqlite-vec npm package "0.1.7-alpha.2 -- last published ~1 year ago (concern)"
**Spec claim** (Part 13, line 1097): sqlite-vec is the "Confirmed" optimal technology choice.

The spec acknowledges the concern (alpha, stale) but then confirms it as the technology choice. An alpha package last published a year ago is a significant supply chain risk for a product positioning itself as enterprise-grade. If sqlite-vec is abandoned (the spec's own survivability question), the entire v1.4.0 feature set (semantic search, hybrid search, duplicate detection) is blocked.

**Severity**: HIGH. The spec identifies the risk and then ignores it.

---

### I-06: "Epistemic CRDTs" are Theoretical, Not Confirmed

**Spec claim** (Part 3, line 362): "Limen's EXISTING claim model is already CRDT-compatible."
**Spec claim** (Part 11, line 1000): "Epistemic CRDTs (CRDT for claims with confidence and lifecycle)" listed as invention opportunity.

Standard CRDTs merge via mathematical lattice properties. Claims with mutable confidence scores (which change via decay), lifecycle states (active -> retracted), and governed transitions do NOT form a standard CRDT. The merge function "union of all claims, union of all relationships" (line 362) ignores: what happens when the same claim has different confidence on two nodes, what happens when one node retracts a claim the other still references, and how lifecycle state conflicts resolve. The spec asserts CRDT compatibility without proving the lattice properties hold for its data model.

**Severity**: MEDIUM. Theoretical claim presented as engineering fact.

---

## 3. MISSING DEPENDENCIES

### D-01: FTS5 Depends on Working Tests, Tests Don't Work

The v1.3.0 release plan sequences FTS5 in Week 2 (line 1218) with DoD requiring all existing tests to pass. FTS5 cannot be certified without a working test harness. The test harness repair is not in the v1.3.0 plan.

---

### D-02: Knowledge Health Score Depends on Temporal Queries AND Conflict Detection AND Freshness Tracking

Feature 5.6 (Knowledge health score, v1.4.0) requires:
- Freshness tracking (Feature 4.2, v1.4.0) -- to measure staleness
- Conflict detection (Feature 4.3, v1.4.0) -- to measure contradictions
- Access-frequency tracking (v1.4.0) -- to measure relevance

All four are scheduled for v1.4.0 with no internal ordering specified. If health score depends on all three inputs, it must be built LAST. The v1.4.0 plan does not specify internal dependency ordering.

---

### D-03: Hybrid Search Depends on BOTH FTS5 AND sqlite-vec

Feature 16 (Hybrid search, v1.4.0, line 869) requires both FTS5 (v1.3.0) AND sqlite-vec (v1.4.0). If sqlite-vec integration fails or is delayed (see I-05 on sqlite-vec stability), hybrid search is blocked. The spec does not identify a fallback -- hybrid search without vectors is just FTS5, which already exists.

---

### D-04: Import/Export Requires Formats Not Yet Designed

The Import/Export CLI (v1.3.0, 2 days) must support 7 formats (line 948-956). But:
- JSON-LD format requires Schema.org predicate mapping (not designed)
- N-Triples requires RDF mapping (not designed)
- Limen-native format is undefined ("Optimized format for Limen-to-Limen transfer" -- no spec)

Three of the seven formats have no specification. The 2-day estimate covers at most JSON + CSV + Markdown + SQLite copy. The other three are undefined.

---

## 4. UNREALISTIC TIMELINES

### T-01: v1.3.0 "2-3 Weeks" is 6-10 Weeks Minimum

See I-01 above. Additional factors:
- The spec's own 7-control process (Part 8 of CLAUDE.md) requires Builder, Breaker, and Certifier passes for every sprint. That triples calendar time.
- 19 source reports were consolidated, but the consolidation revealed 8 contradictions (Part 14). Resolving these in implementation will surface more contradictions.
- The SolisHQ methodology requires Oracle Gate verification (Amendment 24), which adds overhead to every feature.

---

### T-02: v2.0.0 at "Months 5-8" Assumes Zero Slippage in v1.3.0 and v1.4.0

The v2.0.0 plan (Part 15, line 1263-1278) includes 12 major features including a Python binding, database encryption (SQLCipher), and a testing infrastructure for users. It depends on v1.3.0 and v1.4.0 being complete. If v1.3.0 takes 10 weeks instead of 3 (see T-01), and v1.4.0 takes 4 months instead of 2-3, v2.0.0 starts at month 7 minimum, pushing it to months 7-14.

---

### T-03: The Full Roadmap (v1.3.0 through v3.0.0) Spans 18 Months for a Solo Founder

Total effort across all versions: ~17 + ~48 + ~60+ (v2.0.0, estimated) + ~80+ (v3.0.0 distributed systems) = 200+ working days = 40+ working weeks = 10+ months of pure engineering. For a solo founder also maintaining 4 other products, this is 18-24 months minimum -- and the spec says v3.0.0 is "1+ year." That 1+ year assumes everything before it shipped on time. Nothing in software ships on time.

---

## 5. SURVIVABILITY ANALYSIS

### S-01: If OpenAI Ships Native Structured Memory

**Spec's own concern** (Part 1, line 127): Prediction that competitors will adopt Limen's primitives within 24 months.

**Attack**: OpenAI's Assistants API already has persistent memory. If they add confidence scores, evidence chains, and governed retraction (which the spec predicts they will), Limen loses the "ontological chasm" advantage. The spec argues "They will add them as features. Limen has them as architecture." This is the correct defense -- but it only holds if Limen SHIPS before competitors catch up. With a 18-24 month roadmap, competitors have time to close the gap.

**Survivability**: MODERATE. The defense is valid in theory but the timeline is the vulnerability. Limen's moat is real only if v1.3.0 ships within 6 weeks and v1.4.0 within 4 months.

---

### S-02: If AWS AgentCore Captures Enterprise

**Spec's own concern** (Report #17, Finding #1, line 1049): "AWS Bedrock AgentCore Memory as competitive threat -- fully managed enterprise AI memory exists NOW."

**Attack**: AgentCore is fully managed, zero-ops, backed by AWS's enterprise sales force. Limen is a TypeScript library requiring self-hosting. The enterprise segment -- which the spec targets with governance, RBAC, audit trails, SOC 2 compliance -- is exactly where AWS has distribution advantage. Limen's governance features are superior, but enterprises buy from vendors they already pay. AWS is already that vendor.

**Survivability**: LOW for enterprise. MODERATE for developer/open-source segment. The spec should acknowledge that enterprise is NOT the v1.x market. The developer community is.

---

### S-03: If sqlite-vec is Abandoned

**Spec's own concern** (Part 13, line 1113): "last published ~1 year ago (concern)"

**Attack**: sqlite-vec is the foundation of: semantic search (v1.4.0), hybrid search (v1.4.0), duplicate detection (v1.4.0), auto-connection via embeddings (Part 3), importance assessment via embedding similarity (Part 3), and the entire Adaptive RAG Router concept (Part 3).

If sqlite-vec is abandoned:
- 6 planned features are blocked
- The "Adaptive RAG Router" -- described as "the single most impactful retrieval technology" (line 373) -- loses its vector modality
- The competitive advantage over Mem0/Zep in semantic search disappears

**Mitigation in spec**: None specified. The resolution (line 1156) is "optional peer dependency" which handles the code dependency but not the strategic dependency.

**What the spec should say**: Identify a fallback (e.g., DuckDB with vss extension, native WASM vector operations, or a pure-JS approximate nearest neighbor library). Without a fallback, the v1.4.0 feature set has a single point of failure on an alpha package.

**Survivability**: LOW without mitigation plan. The spec bets the v1.4.0 release on an alpha package.

---

## 6. ADDITIONAL FINDINGS

### F-01: The Spec Consolidates 19 Reports but Does Not Retire Them

The spec says (line 11): "After this, there is no other document to read." But the 19 source reports still exist in the filesystem. If a developer reads Report #7 directly, they get recommendations that this spec overrides. The spec does not specify whether source reports should be archived, deleted, or marked as superseded.

### F-02: No Monetization Decision = No Sustainability

Gap 7.1 (line 1047): "Open source sustainability model -- monetization decision needed." Apache 2.0 license allows unrestricted forking. The spec provides zero monetization strategy. A 24-month roadmap with no revenue model is a plan that runs on founder savings.

### F-03: The Description in package.json Contradicts the Spec's Identity

**package.json**: `"description": "Cognitive Operating System -- deterministic infrastructure hosting stochastic cognition"`
**Spec** (Part 2, line 136): Limen is an "engine", specifically "NOT a platform" and should be described as "Governed knowledge engine for AI agents."

The npm description actively contradicts the spec's identity framework. This is not just a typo -- the spec spent an entire section (Part 2) establishing what Limen IS and IS NOT, and the published package uses language the spec explicitly rejects.

### F-04: "Current Stats" Numbers Are Unverifiable

The spec claims (line 230): "16 system calls, 134 invariants, 3,188+ tests, 1 production dependency, 27 migrations, ~45 tables, ~25 enforcement triggers, ~60 indexes."

Testing this:
- Tests: 4,313 `it()` calls defined, 0 passing -- the "3,188+" number is neither the defined count nor a passing count
- Migrations directory: does not exist at `src/kernel/migrations/` -- the "27 migrations" claim is unverifiable from the stated path
- These numbers appear to be from a previous state of the codebase that no longer matches reality

### F-05: Performance Targets Have No Benchmark Harness

The spec references a "latency harness" (line 485: "Latency harness exists") but provides no evidence of its operation. Performance targets without automated benchmarking are aspirations, not engineering commitments.

---

## VERDICT

The spec is intellectually ambitious, architecturally sound in theory, and operationally detached from reality. Its core weaknesses:

1. **Quality claims are unsubstantiated.** Zero tests pass. The "3,188+ tests" narrative is false against the current codebase.
2. **Timelines are fantasy.** 17 days for v1.3.0 ignores the 7-control methodology, the broken test infrastructure, and the multi-product reality.
3. **The competitive comparison is dishonest.** 22/22 counts features that don't exist yet.
4. **Critical technology dependencies are unmitigated.** sqlite-vec is alpha and stale with no fallback plan.
5. **The spec contradicts itself on performance budgets.** Synchronous conflict detection + FTS5 triggers + auto-classification cannot fit in the <10ms remember budget.

**Recommendation**: Before v1.3.0 development begins:
1. Fix the test infrastructure and establish a real passing test count.
2. Revise timelines to reflect solo-founder reality (3x the spec's estimates minimum).
3. Remove or clearly label the "22/22" competitive comparison as post-v1.4.0 projection.
4. Add a sqlite-vec fallback plan.
5. Decide whether conflict detection is sync or async on the assertion path.
6. Make a monetization decision.

The thesis is strong. The architecture is sound. The execution plan is not survivable as written. The spec needs a reality pass.

---

*SolisHQ Breaker -- Adversarial consistency audit complete. Every claim challenged. Every contradiction documented.*
