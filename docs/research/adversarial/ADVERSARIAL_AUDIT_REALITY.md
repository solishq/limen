# ADVERSARIAL REALITY AUDIT: LIMEN DEFINITIVE SPEC

**Date**: 2026-03-30
**Role**: Breaker -- Adversarial Reality Check
**Auditor**: SolisHQ Breaker Agent
**Scope**: LIMEN_DEFINITIVE_SPEC.md vs. codebase reality, market timing, solo-founder feasibility
**Classification**: CONSEQUENTIAL -- this determines whether real money and time are invested correctly

---

## EXECUTIVE VERDICT

The spec is intellectually magnificent and operationally dangerous. It describes a product that would take a funded team of 4 engineers 12-18 months to build. One person with AI assistance has 2-3 weeks before the market window narrows further. The thesis ("knowledge as belief, not data") is genuinely differentiated and defensible -- but the thesis is currently aspirational. The code is a sophisticated agent orchestration engine that happens to have a claim store bolted on. The distance between the spec and reality is not a gap. It is a canyon.

**The single most important finding**: The spec describes a v1.3.0 "WOW" release at "17 days." This is optimistic by at least 2x. But 6-8 features from that list, executed in 2 weeks, would be enough to validate the thesis and create a publishable product that no competitor matches.

---

## SECTION 1: GAP BETWEEN SPEC AND CODE

### 1.1 The Three-Tier API (remember/recall/search)

**Spec claims**: `limen.remember()`, `limen.recall()`, `limen.search()` as the primary programmatic interface.

**Reality**: NONE of these exist in the programmatic API.

- `/src/api/index.ts` exports `createLimen()` which returns a `Limen` object.
- The `Limen` object exposes `limen.claims.assertClaim()` (15-parameter ceremony) and `limen.claims.queryClaims()`.
- There is NO `remember()`, NO `recall()`, NO `search()`, NO `forget()`, NO `reflect()` on the programmatic API.
- These operations exist ONLY in the MCP server (`/packages/limen-mcp/src/tools/knowledge.ts`), which wraps `assertClaim()` with session context and sane defaults.
- The `KnowledgeApiImpl` at `/src/api/knowledge/knowledge_api.ts` is a STUB. Every method returns zero results. Lines 55-103: `ingest()` returns `{memoriesCreated: 0}`, `search()` returns `[]`, `purge()` returns `{purged: 0}`.

**Evidence**: `src/api/knowledge/knowledge_api.ts:55-103` -- all three methods are stubs with comments "not yet wired to orchestration."

**Severity**: CRITICAL. The spec's headline feature ("3 lines to remember") does not work. A developer who `npm install limen-ai` today cannot call `limen.remember()`. This is the single largest gap between spec and code.

### 1.2 The Seven Cognitive Primitives

**Spec claims** (Part 3, Table):

| Primitive | Spec Status | Actual Code Status |
|-----------|------------|-------------------|
| ENCODE | "YES (claim_assert, remember, reflect)" | PARTIAL -- `assertClaim()` works programmatically. `remember()`/`reflect()` are MCP-only. |
| RECALL | "YES (claim_query, recall)" | PARTIAL -- `queryClaims()` works. `recall()` is MCP-only. |
| ASSOCIATE | "YES (connect)" | PARTIAL -- `relateClaims()` works. `connect()` is MCP-only. |
| FORGET | "PARTIAL (retract exists, no decay)" | CORRECT -- retraction exists in ClaimStore. No decay function. No convenience `forget()`. |
| PRIORITIZE | "NO" | CORRECT -- does not exist. |
| CONSOLIDATE | "NO" | CORRECT -- does not exist. |
| REASON | "NO" | CORRECT -- does not exist. No `reasoning` column on claims either. |

**Honest count**: 3 of 7 primitives have working implementation (ENCODE, RECALL, ASSOCIATE) but only via the low-level `ClaimApi`, not the convenience layer. 0 of 7 work through the described simple interface. The spec is accurate about what is missing but misleading about what "YES" means -- it conflates MCP-tool-existence with API-availability.

### 1.3 FTS5 Search

**Spec claims**: FTS5 is feature 1.3, 5.1, and is the foundation of the "Haystack Finder" (SP6). Target: v1.3.0.

**Reality**: Zero FTS5 code anywhere in the codebase.

- `grep -r "FTS5\|fts5\|VIRTUAL TABLE" /src/` returns zero results.
- No FTS5 virtual table in any migration file (27 migrations exist, migrations 001-027).
- No FTS5 sync triggers.
- No search API.

**Severity**: Expected (correctly identified as "NOT BUILT"), but the spec estimates "3 days" for FTS5. This is accurate for a skilled developer -- FTS5 virtual table + sync triggers + search API + tests is genuinely a 2-3 day task given Limen's existing migration infrastructure.

### 1.4 The ACTUAL Distance

**What EXISTS and works** (the real product today):
- 4-layer architecture (Kernel, Substrate, Orchestration, API) -- solid, well-engineered
- 16 system calls -- all implemented and tested
- Claim Protocol (CCP) -- full implementation with immutability triggers, evidence validation, grounding modes, relationship tracking, tenant isolation
- Working Memory Protocol (WMP) -- full implementation
- 6 LLM provider adapters with raw HTTP transport, circuit breakers, streaming
- Hash-chained audit trail
- AES-256-GCM encryption (vault)
- RBAC engine
- Multi-tenant isolation (row-level + database-level)
- Mission/task lifecycle management
- Reference agent
- MCP server with 19 tools (including remember/recall/connect/reflect/scratch)
- A2A protocol server
- 4,333 test cases across 192 test files
- 27 database migrations, ~45 tables, ~25 enforcement triggers

**What DOES NOT exist** (from the spec's own feature matrix):
- Convenience programmatic API (remember/recall/search/forget/reflect/connect)
- FTS5 full-text search
- Vector/semantic search
- Temporal queries
- Claim decay
- Conflict detection (auto)
- Knowledge graph traversal
- Knowledge health scoring
- Context builder
- Import/export
- CLI (partially exists)
- Knowledge-first README

**Quantified distance**: The codebase is approximately 200 source files and 4,333 tests of production-grade infrastructure. It is an ORCHESTRATION ENGINE with a claim store. The spec describes a KNOWLEDGE ENGINE with orchestration underneath. The identity inversion has not happened yet. The spec is the future; the code is the past.

---

## SECTION 2: SOLO FOUNDER REALITY CHECK

### 2.1 The Spec's Own Timeline Estimates

The spec estimates v1.3.0 at "17 days" (Part 9). Let me audit each line item:

| # | Feature | Spec Est. | Realistic Est. | Notes |
|---|---------|-----------|-----------------|-------|
| 1 | `remember()` | 2 days | 1 day | Thin wrapper over `assertClaim()`. Straightforward. |
| 2 | `recall()` | 2 days | 1 day | Thin wrapper over `queryClaims()`. Straightforward. |
| 3 | `connect()` | 1 day | 0.5 day | Already implemented in MCP. Copy pattern. |
| 4 | `forget()` | 0.5 day | 0.5 day | Wrapper over existing retract. |
| 5 | `reflect()` | 1 day | 1 day | Batch wrapper. Needs transaction semantics. |
| 6 | `session.open/close` | 1 day | 1.5 days | Needs state management at API layer. |
| 7 | FTS5 | 3 days | 3-4 days | Migration + virtual table + triggers + API + tests. Realistic estimate. |
| 8 | Value limit raise | 0.25 day | 0.25 day | Config change. |
| 9 | Bulk recall MCP | 1 day | 0.5 day | Query with higher limit. |
| 10 | `reasoning` column | 1 day | 1 day | ALTER TABLE + migration + API surface. |
| 11 | Knowledge-first README | 1 day | 2 days | This is marketing-grade writing. Takes iteration. |
| 12 | 3 new examples | 1 day | 1 day | If API works, examples are fast. |
| 13 | npm rewrite | 0.25 day | 0.25 day | Trivial. |
| 14 | Import/Export CLI | 2 days | 3-4 days | JSON + Markdown export is non-trivial with relationship preservation. |

**Spec total**: 17 days
**Realistic total**: 16-18 days of focused work
**Calendar time** (solo founder, context switching, debugging, testing, CI): 21-28 days = 3-4 weeks

The spec's estimate is actually not far off for raw implementation time. But calendar time with SolisHQ's methodology (7 controls, breaker pass, certifier pass) adds 50-80% overhead. The honest answer: **4 weeks for full v1.3.0 as specified**.

### 2.2 What Should Be CUT to Ship in 2 Weeks

**The Minimum Shippable Product (MSP) for 2 weeks**:

KEEP (10 days of work):
1. `remember()` -- THE headline feature (1 day)
2. `recall()` -- THE other headline feature (1 day)
3. `connect()` -- relationship creation (0.5 day)
4. `forget()` -- retraction (0.5 day)
5. `search()` via FTS5 -- THE differentiation feature (3-4 days)
6. Knowledge-first README rewrite (2 days)
7. npm package.json rewrite (0.25 day)
8. 2 examples (remember-recall, search) (1 day)

CUT (defer to v1.3.1 or v1.4.0):
- `reflect()` batch API -- nice but not essential for thesis validation
- `session.open/close` programmatic API -- MCP version works
- Import/Export CLI -- post-launch
- `reasoning` column -- post-launch
- Bulk recall MCP tool -- post-launch
- Value limit raise -- post-launch (can be a quick patch)
- Social preview image -- can ship after

**This 2-week MSP validates the thesis**: a developer can `npm install limen-ai`, call `limen.remember()`, `limen.recall()`, `limen.search()`, and see governance happening underneath. That is the "3 lines to remember" story.

### 2.3 The Absolute MVP That Validates the Thesis

If even 2 weeks is too much, the absolute minimum is:

1. `limen.remember(subject, predicate, value)` -- 4 hours
2. `limen.recall(subject?, predicate?)` -- 4 hours
3. Knowledge-first README with working code example -- 4 hours

**Total**: 2 days. This is a viable npm publish that lets someone experience "beliefs, not data" for the first time through a programmatic API. No FTS5, no search, no CLI. Just remember and recall with governance underneath.

---

## SECTION 3: MARKET TIMING

### 3.1 EU AI Act (August 2, 2026)

**Distance**: 4 months and 3 days from today.

**What Limen already has that matters for EU AI Act compliance**:
- Hash-chained audit trail (Article 12: Record-keeping)
- RBAC (Article 14: Human oversight)
- Trace events per state mutation (Article 12: Traceability)
- Tenant isolation (Article 10: Data governance)

**What Limen DOES NOT have**:
- Auto risk classification
- Regulatory export formats (no EU AI Act-specific report generation)
- Auto PII detection/tagging
- Formal compliance documentation

**Honest assessment**: Limen's EXISTING governance infrastructure is ahead of every competitor for EU AI Act readiness. But "ahead" is relative. No competitor has this either. The opportunity is to be FIRST to claim EU AI Act compliance capability for AI agent memory. But this requires documentation and marketing, not code. The governance code is already there.

**Recommendation**: Ship a blog post / landing page claiming "EU AI Act ready governance for AI agent memory" by June 2026. The claim is defensible TODAY based on existing audit trail + RBAC + trace events. The gap is documentation, not implementation.

### 3.2 AWS AgentCore

**The threat**: AWS Bedrock AgentCore launched with managed agent memory. It is enterprise-grade, fully managed, integrated with the AWS ecosystem.

**Where Limen wins against AgentCore**:
- **No vendor lock-in**: SQLite on your disk. Export anytime. AWS owns your data.
- **Epistemic model**: AgentCore stores data. Limen stores beliefs. Confidence, evidence chains, contradiction tracking -- none of this exists in AgentCore.
- **Governance depth**: Hash-chained audit, RBAC per operation, multi-tenant isolation. AgentCore has IAM. IAM is access control, not epistemic governance.
- **Open source**: Apache 2.0. AgentCore is proprietary.
- **Cost**: SQLite is free. AgentCore charges per API call.
- **Privacy**: Data stays local. AgentCore sends data to AWS.

**Where AgentCore wins**:
- **It works now**: Managed service. No setup. Production-ready.
- **Ecosystem**: Integrates with Bedrock, Lambda, S3, CloudWatch out of the box.
- **Scale**: Managed scaling. No SQLite limitations.
- **Brand**: "AWS" on the invoice makes enterprise procurement easy.

**Differentiation strategy**: Limen does NOT compete with AgentCore on "managed service." Limen competes on "epistemic governance." The tagline is not "better than AgentCore." It is "AgentCore stores what your agent said. Limen stores what your agent believes, why it believes it, and whether it should still believe it."

### 3.3 What Ships FIRST

**Priority order by market impact**:

1. **Convenience API** (remember/recall) -- makes Limen usable. Without this, nothing else matters.
2. **FTS5 search** -- makes Limen findable within its own knowledge. The "Haystack Finder."
3. **Knowledge-first README** -- makes Limen discoverable. The current README leads with `chat()` -- which makes Limen look like yet another LLM wrapper.
4. **EU AI Act compliance documentation** -- makes Limen saleable to enterprises panicking about August 2026.
5. **Blog post: "Your AI Doesn't Know What It Knows"** -- makes the thesis viral.

Items 1-3 are code. Item 4 is documentation. Item 5 is marketing. All five can ship in 3 weeks with focused execution.

---

## SECTION 4: BUILD VS BUY

### 4.1 Cognitive Features: Build from Scratch?

| Feature | Build | Use Library | Verdict |
|---------|-------|-------------|---------|
| **FTS5** | SQLite built-in. Zero code to "buy." | N/A | BUILD (it is SQLite-native) |
| **Vector embeddings** | Generating embeddings from scratch = insane | sqlite-vec for storage, OpenAI/Ollama for generation | BUY (optional peer dep) |
| **Decay function** | `R(t) = (1 + t/(9*S))^(-1)` is one line of math | No library needed | BUILD (trivial) |
| **Consolidation** | Merging claims = domain-specific logic | No generic library exists | BUILD (when needed, not now) |
| **Graph traversal** | Recursive CTEs in SQLite | No library needed for SQL-level traversal | BUILD (SQLite-native) |
| **Conflict detection** | Same-subject-same-predicate check | No library for epistemic conflict | BUILD |
| **Embedding model** | Training your own = months | EmbeddingGemma, nomic-embed via Ollama | BUY |

### 4.2 Is Zero-Dependency a Virtue?

**The spec says**: 1 production dependency (`better-sqlite3`). Invariant I-01.

**The honest assessment**: Zero-dependency is a MARKETING virtue and an ENGINEERING constraint.

**Where it helps**:
- Supply chain security (no transitive dependency attacks)
- Reproducible builds
- Minimal attack surface
- "1 dependency" is a genuine differentiator that developers notice

**Where it hurts**:
- Reinventing wheels (transport engine instead of using `undici`)
- No embedding generation without bringing in a provider API or local model
- No schema validation library (everything is hand-rolled)
- sqlite-vec breaks I-01 if treated as a production dep

**Verdict**: Keep I-01 for CORE. Make sqlite-vec an optional peer dependency (the spec already recommends this). Do NOT build an embedding model. Do NOT build a schema validation library. The line is: "Limen core has 1 dependency. Limen with vector search has 2." This is honest and still remarkable.

### 4.3 The Honest Assessment

**Build everything yourself**: The spec describes building FTS5 integration, vector search, graph traversal, decay functions, consolidation, temporal queries, conflict detection, health scoring, and more. Every single one of these is domain-specific to the epistemic model. There is no library that does "knowledge-as-belief" retrieval. This is greenfield.

**Strategic dependencies**: Embeddings (buy), vector storage (buy via sqlite-vec), LLM providers (buy via API). Everything else is Limen's unique domain logic and must be built.

**The risk of "build it all"**: Not that it cannot be done, but that it takes time. The spec lists 48 days for v1.4.0 alone. That is 2.5 months of focused work, which means 4-5 months of calendar time for a solo founder.

---

## SECTION 5: THE THESIS TEST

### 5.1 "Knowledge as Belief, Not Data" -- Does the Code Support This?

Let me test each property from the spec's ontological gap table against the actual codebase:

| Property | Spec Claims | Code Reality | Thesis Supported? |
|----------|-------------|--------------|-------------------|
| **Confidence** | Continuous 0.0-1.0 | YES -- `confidence: number` on every Claim, validated [0.0, 1.0] | YES |
| **Provenance** | Constitutional requirement | YES -- `GroundingMode` (evidence_path, runtime_witness), `EvidenceRef` array, grounding validation | YES |
| **Contradiction** | Expected epistemic event | PARTIAL -- `contradicts` relationship type exists, but no auto-detection. Must be manually asserted. | WEAK |
| **Decay** | Feature (beliefs weaken) | NO -- no decay function anywhere. No `last_accessed_at`, no `access_count`, no `decay_rate`. | NO |
| **Retraction** | Governed transition with cascade | PARTIAL -- retraction exists with audit. Cascade is limited to one-edge-deep notification (CCP-I14). No deep cascade. | PARTIAL |
| **Governance** | Epistemic authority, audit, lifecycle | YES -- RBAC, audit trail, agent trust levels, mission-scoped claims | YES |
| **Relationships** | supports, contradicts, supersedes, derived_from | YES -- all four relationship types implemented with integrity constraints | YES |
| **Temporal anchor** | Independent validAt | YES -- `validAt` on every claim, independent of `createdAt` | YES |
| **Self-correction** | Retracting A cascades | PARTIAL -- retraction is one-edge-deep, not full cascade through derived claims | PARTIAL |

**Score: 5/9 fully supported, 3/9 partially, 1/9 absent.**

### 5.2 Is the Thesis Aspirational or Real?

**The thesis IS partially real in the code.** The claim model is genuinely epistemic -- confidence scores, evidence chains, temporal anchoring, relationship types, grounding modes. This is NOT a key-value store with extra columns. The CCP (Claim Protocol) implementation at `/src/claims/` is 19,000+ tokens of carefully engineered epistemic infrastructure with immutability triggers, grounding validation, and lifecycle governance.

**But the thesis is NOT accessible.** The epistemic model exists at Layer 2 (Substrate/Orchestration), hidden behind a 15-parameter `assertClaim()` call. A developer cannot EXPERIENCE the thesis without writing 15 lines of ceremony. The MCP tools (`remember`, `recall`, `connect`) make the thesis accessible -- but only to AI agents, not to human developers writing TypeScript.

**The code is a governed data store that COULD be an epistemic engine.** The ontological gap table is 5/9 implemented. The missing 4 items (auto-contradiction, decay, deep cascade, and full self-correction) are what separate "data store with confidence scores" from "belief system."

### 5.3 The MINIMUM Change to Make the Thesis TRUE

**Three changes that move the needle from "data store" to "belief engine"**:

1. **Convenience API** (`remember`/`recall`/`search`/`forget`/`connect`) -- makes the thesis ACCESSIBLE. Without this, the thesis exists in the code but is invisible to developers. This is the spec's #1 priority and it is correct.

2. **FTS5 search** -- makes the knowledge FINDABLE. A belief system you cannot search is a filing cabinet. Search transforms stored claims into queryable knowledge.

3. **Query-time decay** -- makes beliefs TEMPORAL. One line of math: `effective_confidence = confidence * (1 + age_days / (9 * stability))^(-1)`. No schema change needed. Apply in the query path. This is the single cheapest feature that most dramatically transforms the product from "data store" to "belief system."

**These three changes -- probably 5-7 days of work -- move the thesis from aspirational to demonstrable.** A developer could:
```typescript
const limen = await createLimen();
limen.remember('user:alice', 'preference.food', 'loves Thai food');
// 30 days later...
const beliefs = limen.recall('user:alice'); // confidence decayed from 0.8 to 0.72
const found = limen.search('Thai food');    // FTS5 finds it
limen.forget(beliefs[0].id);               // governed retraction with audit
```

That is the thesis in 4 lines.

---

## SECTION 6: THE FIVE MOST DANGEROUS THINGS IN THE SPEC

### 6.1 Scope Creep Disguised as a Roadmap

The spec describes v1.3.0 (17 days), v1.4.0 (48 days), v2.0.0 (months), v3.0.0 (year+). Each version has 15-30 features. The total feature count across all versions exceeds 80.

**The danger**: A solo founder reads this and sees a 2-year roadmap. The emotional weight of 80 features can cause paralysis or scattered effort. The spec should have a single page: "SHIP THESE 5 THINGS NEXT. NOTHING ELSE MATTERS."

### 6.2 The 19-Report Consolidation Is a Liability

19 reports. 100,000+ words. Consolidated into one 1,300-line spec. The spec preserves every finding from every report, including contradictions.

**The danger**: This is a research artifact, not a build plan. A PA (Practical Agent) trying to build from this will spend more time reading than building. The spec needs a "PA BUILD SHEET" -- a single page with: what to build, in what order, with what interfaces, tested how.

### 6.3 The Competitive Comparison Table Is Aspirational

Part 15, Appendix B shows Limen with "YES" for 20 capabilities, dominating Mem0/Zep/Letta/Cognee/Hindsight.

**The danger**: This table describes POST-v1.4.0 Limen. Today's Limen would have "YES" for maybe 8 of those 20 rows (governance, RBAC, audit trail, confidence scores, evidence chains, trust levels, budget enforcement, working memory, MCP server, single dependency). The other 12 are "NOT YET." Publishing this table now would be dishonest. Wait until the features actually ship.

### 6.4 The "Invention Opportunities" Are Distractions

The spec lists 9 invention opportunities (epistemic health score, knowledge debt register, temporal reasoning, governance-aware retrieval, calibration loop, memory portability standard, cognitive consolidation engine, governed GraphRAG, activation-based retrieval).

**The danger**: These are research projects, not product features. Each one is a paper-worthy contribution. None of them should be started until v1.3.0 ships and gets real users. Invention without users is academia. Ship, measure, then invent.

### 6.5 Missing Monetization Strategy

The spec acknowledges "No revenue model" (Gap 7.1) but does not propose one.

**The danger**: Apache 2.0 + no revenue model + solo founder = unsustainable. The spec should include at least a hypothesis: open-core (free core, paid cloud), consulting, enterprise license, or hosted service. Without this, the project is a hobby, not a business.

---

## SECTION 7: RECOMMENDATIONS

### 7.1 The 2-Week Battle Plan

**Week 1** (Monday-Friday):
- Day 1-2: Implement `remember()`, `recall()`, `forget()`, `connect()` as programmatic API methods on the `Limen` object. These are thin wrappers over `ClaimApi` -- the MCP knowledge tools already prove the pattern.
- Day 3-4: FTS5 migration + virtual table + sync triggers + `search()` API.
- Day 5: Tests for all new API methods. Verify 4,333+ existing tests still pass.

**Week 2** (Monday-Friday):
- Day 1: Query-time decay (one function, no schema change).
- Day 2-3: Knowledge-first README rewrite. Lead with `remember()`/`recall()`/`search()`, not `chat()`.
- Day 4: Two examples (remember-recall, search). npm package.json rewrite.
- Day 5: Final testing, CHANGELOG, npm publish.

**This ships a product that**:
- Validates the "beliefs, not data" thesis
- Has a 3-line onboarding story
- Has full-text search (no competitor has FTS5 + governance)
- Has query-time decay (no competitor has this AT ALL)
- Is honest about what it is and what it is not

### 7.2 What NOT to Do

1. Do NOT start v1.4.0 features before v1.3.0 ships
2. Do NOT build framework adapters (the spec correctly defers this)
3. Do NOT build vector search yet (FTS5 is sufficient for thesis validation)
4. Do NOT build the distributed sync layer
5. Do NOT build a Python binding
6. Do NOT rewrite the README more than once
7. Do NOT write blog posts before the convenience API works

### 7.3 The One Decision That Matters Most

**Rewrite the npm package description NOW.**

Current: "Cognitive Operating System -- deterministic infrastructure hosting stochastic cognition"

This tells a developer nothing. It sounds like an academic paper title.

**Proposed**: "Governed knowledge engine for AI agents. Store beliefs with confidence, evidence chains, and lifecycle governance. SQLite-powered, zero-config, single dependency."

This tells a developer exactly what Limen does, why it is different, and why they should care. The spec already recommends this exact text (Part 2, Canonical Forms). It has not been implemented. It should be the first commit.

---

## SECTION 8: HONEST CEILING

**What Limen CAN be in 2 weeks**: A working knowledge engine with remember/recall/search, governance underneath, and a compelling README. Enough to validate the thesis with real users.

**What Limen CANNOT be in 2 weeks**: A complete epistemic infrastructure with vector search, temporal queries, conflict detection, knowledge health scoring, and graph traversal. That is v1.4.0 (2-3 months).

**What Limen CANNOT be in 6 months**: A distributed, federated, multi-language platform with Python bindings, sync services, and cognitive consolidation. That is v2.0.0-v3.0.0 (12-18 months).

**What the spec describes**: All of the above, simultaneously.

**The gap is not quality -- the gap is time.** The engineering in this codebase is genuinely excellent. 4,333 tests. 200 source files. 27 migrations. 134 invariants. This is not a toy. But it is an orchestration engine that needs to become a knowledge engine, and the spec describes the full transformation without acknowledging that the transformation must be sequenced ruthlessly.

---

## APPENDIX: EVIDENCE INDEX

| Finding | File | Line(s) | Evidence |
|---------|------|---------|----------|
| KnowledgeApi is stub | `src/api/knowledge/knowledge_api.ts` | 55-103 | All methods return zero/empty |
| No `remember()` on API | `src/api/index.ts` | 1-60 | No import of remember/recall |
| No FTS5 in codebase | `src/**/*.ts` | (all) | grep returns zero results |
| MCP remember works | `packages/limen-mcp/src/tools/knowledge.ts` | 85-130 | Full implementation |
| Claim model has confidence | `src/claims/interfaces/claim_types.ts` | 98 | `readonly confidence: number` |
| Claim model has validAt | `src/claims/interfaces/claim_types.ts` | 99 | `readonly validAt: string` |
| Claim model has relationships | `src/claims/interfaces/claim_types.ts` | 55 | 4 relationship types |
| Claim model has grounding | `src/claims/interfaces/claim_types.ts` | 61 | evidence_path, runtime_witness |
| No decay function | `src/**/*.ts` | (all) | grep "decay\|retrievability" returns zero |
| Test count | `tests/**/*.test.ts` | (all) | 4,333 test cases in 192 files |
| Source file count | `src/**/*.ts` | (all) | 200 source files |
| npm description wrong | `package.json` | 4 | "Cognitive Operating System" not "knowledge engine" |

---

*This audit is the honest truth. The spec is brilliant. The code is solid. The gap between them is where the work lives. Ship the minimum. Validate the thesis. Then expand.*

*Breaker Agent -- SolisHQ*
