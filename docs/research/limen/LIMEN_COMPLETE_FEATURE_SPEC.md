# Limen Complete Feature Specification

**Date**: 2026-03-30
**Author**: SolisHQ Researcher (First-Principles Research)
**Status**: DEFINITIVE PRODUCT SPECIFICATION
**Purpose**: Everything Limen must ship to be complete for developers

---

## Executive Summary

Limen today is a Cognitive Operating System — a deeply-engineered, governance-first engine with 16 system calls, 134 invariants, 3,200+ tests, and a single dependency. It is architecturally superior to every competitor. But it is incomplete as a **developer product**.

The gap is not in the foundation. The gap is in the **knowledge layer** — the reason developers will choose Limen over Mem0, Zep, Cognee, or Letta. Limen has claims, working memory, sessions, and an MCP server. But it lacks the three things every competitor leads with: **semantic search**, **automatic knowledge extraction**, and **a simple remember/recall API that works without understanding governance**.

This document specifies exactly what to build to close that gap permanently.

---

## Part 1: The Competitive Landscape (Evidence)

### What Developers Can Choose Today

| Framework | Stars | Architecture | Key Strength | Key Weakness | License |
|-----------|-------|-------------|--------------|--------------|---------|
| **Mem0** | ~48K | Vector + Graph | Broadest ecosystem, 3-line quickstart | Graph requires $249/mo Pro | Apache 2.0 |
| **Zep/Graphiti** | ~24K | Temporal KG | Best temporal reasoning, <200ms retrieval | Community Edition deprecated, credit pricing | Mixed |
| **Letta** | ~21K | OS-inspired tiers | Agent self-managed memory, skill learning | Steep learning curve, full runtime adoption | Apache 2.0 |
| **Cognee** | ~12K | KG + Vector | 30+ connectors, multimodal, ontology grounding | Python-only, newer | Open core |
| **Hindsight** | ~4K | Multi-strategy | 91.4% retrieval accuracy (LongMemEval) | Newer, slower writes | MIT |
| **LangMem** | ~1.3K | Flat KV + Vector | Free, MIT, LangGraph-native | Locked to LangGraph, Python-only | MIT |
| **SuperMemory** | -- | Memory + RAG | 81.6% accuracy, generous free tier | Closed source | Proprietary |
| **Engram** | varies | Single binary | SQLite + FTS5, MCP-first, local-first | Fragmented forks, no governance | Various |
| **Limen** | new | 4-layer governed | Only engine with governance, audit, RBAC built-in | No semantic search, no auto-extraction | Apache 2.0 |

### Evidence Level: Confirmed (8 sources cross-referenced)

### What Every Competitor Offers That Limen Does Not (Today)

1. **Semantic/vector search** — Every competitor. Limen has FTS5 potential via SQLite but no vector or semantic search implementation.
2. **Automatic knowledge extraction** — Mem0, Zep, Cognee, LangMem, SuperMemory all extract facts from conversations automatically. Limen requires explicit `assertClaim()` calls.
3. **Simple remember/recall API** — Mem0: `memory.add(messages)` / `memory.search(query)`. Limen's MCP layer has `limen_remember`/`limen_recall` but the programmatic API (`limen.knowledge`) returns stubs.
4. **Graph traversal** — Zep, Cognee, Mem0 Pro all offer knowledge graph queries. Limen has claim relationships but no traversal engine.
5. **Conversation memory** — Every competitor stores and retrieves conversation history as searchable knowledge. Limen has session history but it is not searchable or cross-session.
6. **Import/export** — Cognee has 30+ connectors, Mem0 has batch operations. Limen has `limen.data` API but it is scaffolded.

### What Limen Has That Nobody Else Does

1. **Governance-aware knowledge** — Claims have confidence scores, temporal anchors, grounding modes, evidence chains, and audit trails. No competitor has this depth.
2. **RBAC on knowledge** — Per-operation authorization. Competitors have API keys. Limen has role-based access.
3. **Epistemic status tracking** — Claims are `active` or `retracted` with audited transitions. Competitors have no concept of knowledge lifecycle.
4. **Multi-tenant isolation** — Row-level or database-level. Competitors assume single-tenant.
5. **Deterministic infrastructure** — SQLite WAL, hash-chained audit, single dependency. Competitors require Postgres, Redis, Neo4j, vector DBs.
6. **16 system calls** — Formal governance boundary. No competitor has anything like this.
7. **Budget enforcement** — Token budgets on missions. No competitor tracks knowledge costs.
8. **Working memory** — Task-scoped ephemeral state with lifecycle management.

---

## Part 2: Developer Journey Analysis

### Minute 0-1: Discovery

**What the README must show in the first 10 lines:**

```
# Limen — Knowledge Engine for AI Agents

Store, recall, connect, and govern knowledge. One dependency. SQLite-powered.
Works with any LLM. Ships with an MCP server for Claude Code.

npm install limen-ai

const limen = await createLimen();
await limen.remember('user:alice', 'preference.cuisine', 'loves Thai food');
const memories = await limen.recall('user:alice');
// => [{ subject: 'user:alice', predicate: 'preference.cuisine', value: 'loves Thai food', confidence: 0.8 }]
```

**Verdict**: Limen's current README leads with "Cognitive Operating System" and chat/LLM features. A developer looking for a knowledge engine bounces. The README must lead with **knowledge operations**, not LLM orchestration.

### Minute 1-3: Install + First Use

**What must work in 3 lines:**

```typescript
const limen = await createLimen();
await limen.remember('user:alice', 'preference.movie', 'loves sci-fi');
const results = await limen.recall('user:alice');
```

**What must work in 5 lines:**

```typescript
const limen = await createLimen();
await limen.remember('user:alice', 'preference.movie', 'loves sci-fi');
await limen.remember('user:alice', 'preference.food', 'hates cilantro');
const results = await limen.recall('user:alice', { predicate: 'preference.*' });
await limen.shutdown();
```

**What must work in 10 lines:**

```typescript
const limen = await createLimen();
const claim1 = await limen.remember('project:atlas', 'decision.database', 'chose PostgreSQL for production');
const claim2 = await limen.remember('project:atlas', 'decision.cache', 'chose Redis for session cache');
await limen.connect(claim1.id, claim2.id, 'supports');
const atlas = await limen.recall('project:atlas');
const decisions = await limen.search('database choice for atlas');
await limen.forget(claim1.id); // retract with audit trail
await limen.shutdown();
```

**Current state**: None of this works. `limen.knowledge.ingest()` returns `{ memoriesCreated: 0 }`. The claim API works but requires 8+ parameters. The MCP tools (`limen_remember`/`limen_recall`) work but are not available programmatically.

### Minute 3-10: Real Use

A developer building an AI agent wants:

1. **Store knowledge from conversations** — "My agent just learned the user prefers morning meetings. Save that."
2. **Recall relevant knowledge** — "What do we know about this user?"
3. **Search across all knowledge** — "Find everything about database decisions."
4. **Connect knowledge** — "This decision supports that one."
5. **Session continuity** — "Continue where we left off."

**Current state**: Items 1-3 require using the low-level claim API with manual subject URNs, predicates, and evidence references. Item 4 works via `relateClaims()`. Item 5 works for conversations but not for knowledge sessions.

### Minute 10-30: Power Use

1. **Custom queries** — Partial. `queryClaims()` supports subject/predicate wildcards and confidence thresholds.
2. **Export/import** — Not implemented. `DataApi` is scaffolded.
3. **LLM integration** — Chat and infer work. But no automatic knowledge extraction from conversations.
4. **MCP server** — Works. 19 tools. This is Limen's strongest integration point.
5. **Governance/permissions** — RBAC works. This is ahead of all competitors.

### Day 1-7: Production

1. **Monitoring** — `limen.health()` and `limen.metrics.snapshot()` work.
2. **Backup/restore** — SQLite file copy. No built-in utility.
3. **Migration** — 27 migration files. This works.
4. **Multi-agent** — Agent registration and trust progression work.
5. **Confidence** — Enough to ship if knowledge layer is complete.

---

## Part 3: The Complete Feature Matrix

### Category 1: Core Knowledge Operations

| # | Feature | Status Today | Importance (1-10) | Effort | Ship When |
|---|---------|-------------|-------------------|--------|-----------|
| 1.1 | **remember(subject, predicate, value)** — simplified claim assertion | MCP only, not programmatic | 10 | Low | NOW |
| 1.2 | **recall(subject?, predicate?, options?)** — simplified claim query | MCP only, not programmatic | 10 | Low | NOW |
| 1.3 | **search(query, options?)** — full-text search across claims | NOT BUILT | 10 | Medium | NOW |
| 1.4 | **connect(fromId, toId, relationship)** — simplified relate | MCP only, not programmatic | 9 | Low | NOW |
| 1.5 | **forget(claimId)** — retract with audit trail | Claim retraction exists internally | 8 | Low | NOW |
| 1.6 | **reflect(learnings[])** — batch assert categorized | MCP only, not programmatic | 8 | Low | NOW |
| 1.7 | **Semantic/vector search** | NOT BUILT | 9 | High | NOW |
| 1.8 | **Claim update (supersede)** | Relationship exists, no convenience API | 7 | Low | NOW |
| 1.9 | **Bulk operations** (batch remember, batch recall) | NOT BUILT | 6 | Medium | NOW |
| 1.10 | **Natural language query** ("what decisions did we make about auth?") | NOT BUILT | 7 | High | v2 |

### Category 2: Session & Context Management

| # | Feature | Status Today | Importance | Effort | Ship When |
|---|---------|-------------|------------|--------|-----------|
| 2.1 | **Open/close knowledge sessions** | MCP only | 9 | Low | NOW |
| 2.2 | **Session-scoped scratch pad** | Works (WMP) | -- | Done | -- |
| 2.3 | **Session summaries** | MCP only (limen_session_close with summary) | 7 | Low | NOW |
| 2.4 | **Context builder** ("give me everything relevant for task X") | NOT BUILT | 8 | High | NOW |
| 2.5 | **Cross-session knowledge continuity** | Claims persist, no convenience | 7 | Medium | NOW |
| 2.6 | **Conversation memory as searchable knowledge** | Sessions exist, not searchable | 8 | Medium | NOW |

### Category 3: Agent Integration

| # | Feature | Status Today | Importance | Effort | Ship When |
|---|---------|-------------|------------|--------|-----------|
| 3.1 | **MCP server** | WORKS (19 tools) | -- | Done | -- |
| 3.2 | **LLM-agnostic API** | WORKS (6 providers) | -- | Done | -- |
| 3.3 | **Tool definitions for function calling** | NOT BUILT | 8 | Medium | NOW |
| 3.4 | **Auto knowledge extraction from conversations** | NOT BUILT | 9 | High | NOW |
| 3.5 | **Conversation memory store/recall** | Partial (session history exists) | 7 | Medium | NOW |
| 3.6 | **OpenAI Agents SDK integration** | NOT BUILT | 6 | Medium | v2 |
| 3.7 | **Vercel AI SDK integration** | NOT BUILT | 6 | Medium | v2 |

### Category 4: Quality & Governance

| # | Feature | Status Today | Importance | Effort | Ship When |
|---|---------|-------------|------------|--------|-----------|
| 4.1 | **Confidence scores** | WORKS | -- | Done | -- |
| 4.2 | **Freshness tracking** (last verified) | validAt exists, no staleness detection | 7 | Medium | NOW |
| 4.3 | **Conflict detection** (contradicting claims) | Contradicts relationship exists, no auto-detection | 8 | Medium | NOW |
| 4.4 | **Audit trail** | WORKS (hash-chained) | -- | Done | -- |
| 4.5 | **RBAC** | WORKS | -- | Done | -- |
| 4.6 | **Claim lifecycle** | Active/retracted. No candidate/stale states | 6 | Medium | v2 |
| 4.7 | **Governance-aware retrieval** (trust affects access) | Trust levels exist, not wired to retrieval | 7 | Medium | NOW |
| 4.8 | **Protected predicates** (governance immune from override) | MCP only (env var) | 6 | Low | NOW |

### Category 5: Intelligence & Search

| # | Feature | Status Today | Importance | Effort | Ship When |
|---|---------|-------------|------------|--------|-----------|
| 5.1 | **Full-text search (FTS5)** | NOT BUILT (SQLite has FTS5) | 10 | Medium | NOW |
| 5.2 | **Semantic/vector search** | NOT BUILT | 9 | High | NOW |
| 5.3 | **Knowledge graph traversal** | Relationships exist, no traversal | 8 | Medium | NOW |
| 5.4 | **Reasoning chains** (why was this concluded?) | Evidence refs exist, no traversal | 7 | Medium | NOW |
| 5.5 | **Duplicate detection** | NOT BUILT | 6 | Medium | NOW |
| 5.6 | **Knowledge health scoring** | NOT BUILT | 7 | Medium | NOW |
| 5.7 | **Auto-summarization of clusters** | NOT BUILT | 5 | High | v2 |
| 5.8 | **Temporal queries** ("what was true on March 15?") | validAt exists, no temporal query API | 8 | Medium | NOW |

### Category 6: Developer Experience

| # | Feature | Status Today | Importance | Effort | Ship When |
|---|---------|-------------|------------|--------|-----------|
| 6.1 | **TypeScript-first with full type safety** | WORKS | -- | Done | -- |
| 6.2 | **Zero-config quickstart** | WORKS | -- | Done | -- |
| 6.3 | **Comprehensive examples** | 8 examples exist | 8 | Medium | NOW |
| 6.4 | **Migration system** | WORKS (27 migrations) | -- | Done | -- |
| 6.5 | **Import/export (JSON, markdown)** | DataApi scaffolded | 8 | Medium | NOW |
| 6.6 | **CLI tool** | limen-cli exists | 7 | Medium | NOW |
| 6.7 | **Knowledge-first README** | Current README leads with chat | 10 | Low | NOW |
| 6.8 | **Interactive playground/REPL** | NOT BUILT | 6 | Medium | v2 |
| 6.9 | **Monitoring dashboard** | NOT BUILT | 4 | High | v2 |
| 6.10 | **API reference docs** | TypeDoc configured | 7 | Low | NOW |

### Category 7: Production Readiness

| # | Feature | Status Today | Importance | Effort | Ship When |
|---|---------|-------------|------------|--------|-----------|
| 7.1 | **SQLite-based (no server)** | WORKS | -- | Done | -- |
| 7.2 | **Backup/restore utility** | SQLite file copy, no utility | 6 | Low | NOW |
| 7.3 | **Multi-agent support** | WORKS | -- | Done | -- |
| 7.4 | **Performance benchmarks** | Latency harness exists | 7 | Medium | NOW |
| 7.5 | **Configurable retention** | Retention scheduler exists | -- | Done | -- |
| 7.6 | **Meaningful error messages** | WORKS (30+ error codes with spec traceability) | -- | Done | -- |
| 7.7 | **Graceful shutdown** | WORKS | -- | Done | -- |

---

## Part 4: The "Ship Everything" Analysis

### What Already Works (Do Not Rebuild)

These are Limen's competitive advantages. They are done and tested:

- 4-layer architecture (Kernel, Substrate, Orchestration, API)
- 16 system calls with governance boundary
- 134 invariants, 3,200+ tests
- SQLite with WAL mode, single dependency
- Hash-chained audit trail
- RBAC engine
- AES-256-GCM encryption
- Multi-tenant isolation
- Mission/task framework with budgets
- 6 LLM provider adapters (raw HTTP, no SDKs)
- Streaming with stall detection
- Structured output with JSON Schema validation
- Session management with conversation history
- Working memory (task-scoped)
- Claim Protocol (assert, relate, query)
- MCP server (19 tools)
- CLI package
- Agent registration and trust progression
- Learning system with technique extraction
- Zero-config quickstart
- 8 progressive examples

### What Must Be Built (The Knowledge Completeness Layer)

Grouped by implementation dependency:

#### Tier A: Foundation (Must ship first, everything depends on these)

**A1. FTS5 Search Engine** (Effort: Medium)
- Add FTS5 virtual table mirroring claim_assertions (subject, predicate, object_value)
- Trigger-based sync: INSERT/UPDATE on claims auto-populates FTS5 index
- `search(query, options?)` on the programmatic API
- Returns ranked results with snippet highlighting
- Why: Every competitor has full-text search. This is table stakes.

**A2. High-Level Knowledge API** (Effort: Medium)
- Promote MCP's `remember`/`recall`/`connect`/`reflect`/`scratch` patterns to the programmatic API
- `limen.remember(subject, predicate, value, options?)` -> returns `{ id, confidence }`
- `limen.recall(subject?, options?)` -> returns claim array
- `limen.search(query, options?)` -> returns ranked claim array via FTS5
- `limen.connect(fromId, toId, relationship)` -> returns relationship
- `limen.forget(claimId)` -> retracts with audit trail
- `limen.reflect(learnings[])` -> batch assert
- These are thin wrappers over the existing claim API. The MCP server already proves the pattern.
- Why: The current programmatic API (`limen.claims.assertClaim()`) requires 8 parameters. Developers want 3.

**A3. Knowledge Session API** (Effort: Low)
- `limen.session.open(project)` / `limen.session.close(summary?)`
- Session context auto-injected into `remember`/`recall`
- Programmatic equivalent of what MCP `limen_session_open`/`limen_session_close` already do
- Why: Session lifecycle management should not be MCP-only.

#### Tier B: Differentiation (What makes developers choose Limen)

**B1. Semantic Vector Search** (Effort: High)
- Embedded vector search using SQLite + custom extension (sqlite-vec or sqlite-vss)
- OR: Use built-in cosine similarity over stored embeddings (no external DB)
- Embedding generation via configured LLM provider or offline model
- Hybrid retrieval: FTS5 score + vector similarity, configurable weighting
- Option for bring-your-own embeddings
- Why: Every competitor has this. Without it, "knowledge engine" rings hollow.
- Architecture decision: Do NOT add a second database. Limen's identity is single-file SQLite. Use sqlite-vec (WASM, no native dependency) or compute embeddings and store as BLOBs with manual cosine similarity.
- Confidence: LIKELY feasible. sqlite-vec is production-ready and adds no native dependency beyond better-sqlite3.

**B2. Automatic Knowledge Extraction** (Effort: High)
- After each `limen.chat()` or `limen.session.close()`, optionally extract facts
- LLM-powered extraction: "What new facts did this conversation establish?"
- Extracted facts auto-stored as claims with `groundingMode: 'runtime_witness'`
- Configurable: opt-in per session, per agent, or globally
- Deduplication against existing claims (FTS5 + vector similarity check)
- Why: Mem0's core value prop. Zep's core value prop. Cognee's core value prop. This is the feature that makes memory "just work."

**B3. Knowledge Graph Traversal** (Effort: Medium)
- `limen.traverse(claimId, options?)` — follow relationships N hops
- `limen.explain(claimId)` — show reasoning chain (derived_from, supports)
- `limen.contradictions(subject?)` — find contradicting claims
- Implemented via recursive CTE queries in SQLite (well-supported)
- Why: Zep and Cognee lead with graph capabilities. Limen has the data (claim_relationships table) but no traversal API.

**B4. Temporal Queries** (Effort: Medium)
- `limen.recall(subject, { asOf: '2026-03-15' })` — what was true at a point in time
- `limen.history(subject, predicate?)` — show how knowledge evolved
- Leverages existing `validAt` field and `retracted_at` tracking
- Why: Zep's unique differentiator. Limen already stores the temporal data. Just needs query support.

**B5. Conflict Detection** (Effort: Medium)
- On `remember()`, check if a contradicting active claim exists for the same subject+predicate
- If found: auto-create `contradicts` relationship, warn caller
- `limen.conflicts()` — list all unresolved contradictions
- Optional: auto-supersede older claim (configurable policy)
- Why: No competitor does this well. This is an invention opportunity.

#### Tier C: Completeness (What makes Limen production-ready for teams)

**C1. Tool Definitions Export** (Effort: Medium)
- `limen.tools()` — returns OpenAI/Anthropic-compatible tool definitions for all knowledge operations
- Drop-in for `tools` parameter in any LLM API call
- Why: Developers using non-MCP integrations need tool definitions. This is how LangMem and Mem0 integrate with agent frameworks.

**C2. Import/Export** (Effort: Medium)
- `limen.data.export(format, options?)` — JSON, CSV, or Limen-native
- `limen.data.import(source, options?)` — from JSON, CSV, or another Limen database
- Bulk migration between Limen instances
- Why: Teams need to move data between environments.

**C3. Context Builder** (Effort: Medium)
- `limen.context(subject, options?)` — assemble all relevant knowledge for a prompt
- Returns: relevant claims, sorted by recency and confidence, formatted for LLM consumption
- Configurable: max tokens, confidence threshold, recency bias
- Why: Every developer building with Limen will write this function. Ship it as a first-class feature.

**C4. Governance-Aware Retrieval** (Effort: Medium)
- Agent trust level affects what claims are visible
- `untrusted` agents see only their own claims
- `probationary` agents see claims from their domain
- `trusted` agents see all non-system claims
- `admin` sees everything
- Why: This is Limen's unique governance advantage. Wire it.

**C5. Freshness & Staleness** (Effort: Medium)
- Claims older than configurable threshold marked `stale`
- `limen.stale(options?)` — list claims needing revalidation
- `limen.revalidate(claimId)` — update validAt without changing content
- Why: Knowledge decays. No competitor addresses this. Invention opportunity.

**C6. Knowledge Health Score** (Effort: Medium)
- `limen.health.knowledge()` — returns epistemic health metrics
  - Total claims / active / retracted / stale
  - Contradiction count
  - Average confidence
  - Claims without evidence
  - Coverage gaps (subjects with few claims)
- Why: No competitor offers this. It makes governance visible.

**C7. Backup/Restore Utility** (Effort: Low)
- `limen.data.backup(path)` — SQLite `.backup()` API
- `limen.data.restore(path)` — replace database from backup
- CLI: `limen backup` / `limen restore`
- Why: SQLite file copy works, but a first-class API reduces production anxiety.

#### Tier D: Ecosystem (What grows Limen's adoption)

**D1. Knowledge-First README** (Effort: Low)
- Lead with knowledge operations, not chat
- Show remember/recall in the first code block
- "Underneath" section reveals the governance engine
- Comparison table against Mem0, Zep, Cognee
- Why: The README is the product page. If knowledge is the differentiator, lead with it.

**D2. Knowledge Examples** (Effort: Low)
- `examples/09-remember-recall.ts` — basic knowledge operations
- `examples/10-knowledge-search.ts` — FTS5 + semantic search
- `examples/11-knowledge-graph.ts` — connect, traverse, explain
- `examples/12-auto-extraction.ts` — chat with auto knowledge extraction
- `examples/13-temporal-memory.ts` — time-aware queries
- `examples/14-conflict-resolution.ts` — contradiction detection
- Why: Examples are documentation. Knowledge examples prove the product.

**D3. Published API Reference** (Effort: Low)
- TypeDoc is configured. Run `npm run docs` and publish to GitHub Pages.
- Why: Developers evaluate SDKs by their API reference.

**D4. Performance Benchmarks** (Effort: Medium)
- Publish: remember latency, recall latency, search latency, startup time
- Compare against Mem0, Zep benchmarks
- Target: remember <10ms, recall <20ms, FTS5 search <50ms (SQLite advantages)
- Why: "SQLite-based" is either a feature or a concern. Benchmarks make it a feature.

---

## Part 5: What Nobody Offers (Invention Opportunities)

These are features derived from first principles that no competitor has shipped. They represent Limen's opportunity to lead rather than follow.

### 5.1 Epistemic Health Score (Importance: 8/10)

**What**: A quantified measure of how healthy an agent's knowledge is.

**Why nobody has this**: Competitors treat memory as a black box — you put things in, you get things out. Nobody asks "is this knowledge base healthy?"

**Implementation**:
```typescript
limen.health.knowledge() => {
  totalClaims: 1247,
  activeClaims: 1103,
  retractedClaims: 144,
  staleClaims: 87,          // older than freshness threshold
  contradictions: 3,         // unresolved conflicts
  ungroundedClaims: 12,     // no evidence refs
  avgConfidence: 0.76,
  coverageScore: 0.82,      // how well are known subjects covered
  healthScore: 0.71,        // composite
}
```

**Confidence**: HIGH — all the data exists in the claims table. This is a query + formula.

### 5.2 Knowledge Debt Register (Importance: 7/10)

**What**: Track what you SHOULD know but don't.

**Why nobody has this**: Competitors only track what IS known. Nobody tracks epistemic gaps.

**Implementation**:
```typescript
limen.remember('project:atlas', 'gap.identified', 'No load testing data for payment service');
limen.debts() => [{ subject: 'project:atlas', gap: 'No load testing data...', since: '2026-03-15' }]
```

This is just a predicate convention (`gap.identified`, `gap.resolved`) with a convenience query. Lightweight to ship.

**Confidence**: HIGH — convention over mechanism.

### 5.3 Temporal Reasoning (Importance: 8/10)

**What**: First-class support for knowledge that changes over time.

**Why competitors struggle**: Zep has temporal graphs but requires Neo4j. Others ignore time entirely.

**Implementation**:
```typescript
// What was true then?
limen.recall('user:alice', { asOf: '2026-01-01' })

// How has this changed?
limen.history('user:alice', 'preference.cuisine')
// => [{ value: 'loved Italian', validAt: '2025-06', retractedAt: '2026-01' },
//     { value: 'loves Thai', validAt: '2026-01', retractedAt: null }]
```

**Confidence**: HIGH — Limen already stores `validAt` and retraction timestamps. This is a query feature.

### 5.4 Governance-Aware Retrieval (Importance: 7/10)

**What**: Trust level affects what knowledge is accessible.

**Why nobody has this**: Competitors assume flat access. No trust hierarchy.

**Implementation**: Wire the existing RBAC engine and trust levels to claim queries. An `untrusted` agent cannot read `admin`-asserted system claims.

**Confidence**: HIGH — both systems exist. Just need wiring.

### 5.5 Calibration Loop (Importance: 6/10)

**What**: Track predictions vs outcomes. Measure whether your agent's confidence scores are accurate.

**Why nobody has this**: Requires explicit outcome recording, which competitors don't model.

**Implementation**:
```typescript
const prediction = await limen.remember('event:q1-revenue', 'prediction.value', '>$100K', { confidence: 0.7 });
// Later...
await limen.record_outcome(prediction.id, 'actual: $87K', false);
limen.calibration() => { predictions: 47, correct: 31, calibration: 0.66 } // vs expected 0.70
```

**Confidence**: LIKELY — requires new table for outcomes. Medium effort.

### 5.6 Memory Portability Standard (Importance: 5/10)

**What**: Export knowledge in a standard format that any system can import.

**Why nobody has this**: Every competitor uses proprietary storage.

**Implementation**: JSON-LD export with schema.org compatible predicates. Markdown export for human reading.

**Confidence**: HIGH — serialization of existing data.

---

## Part 6: The 80/20 Cut

### If We Could Only Ship ONE Release

The following is the **minimum feature set** that makes Limen "complete" as a developer-facing knowledge engine. Ordered by implementation dependency.

#### Phase 1: Knowledge API Surface (1-2 weeks)

| Feature | Why | Effort |
|---------|-----|--------|
| `limen.remember()` | 3-line quickstart becomes possible | Low |
| `limen.recall()` | Developers can retrieve knowledge | Low |
| `limen.search()` via FTS5 | Full-text search, table stakes | Medium |
| `limen.connect()` | Relationship creation simplified | Low |
| `limen.forget()` | Knowledge lifecycle management | Low |
| `limen.reflect()` | Batch knowledge assertion | Low |
| Knowledge session API | Programmatic session management | Low |

This is primarily lifting the MCP-layer patterns into the programmatic API and adding an FTS5 virtual table. The MCP server already proves every pattern works.

#### Phase 2: Intelligence Layer (2-3 weeks)

| Feature | Why | Effort |
|---------|-----|--------|
| Semantic vector search (sqlite-vec) | Competitors all have this | High |
| Auto knowledge extraction | The feature that makes memory "just work" | High |
| Graph traversal + explain | Knowledge graph queries | Medium |
| Temporal queries (asOf, history) | Time-aware knowledge | Medium |
| Conflict detection | Auto-detect contradictions | Medium |

This is the hard layer that requires new infrastructure (vector index, LLM extraction pipeline, recursive CTE traversal).

#### Phase 3: Production Polish (1-2 weeks)

| Feature | Why | Effort |
|---------|-----|--------|
| Context builder | Assemble knowledge for prompts | Medium |
| Tool definitions export | Non-MCP agent integration | Medium |
| Knowledge health score | Governance made visible | Medium |
| Freshness tracking | Knowledge decay management | Medium |
| Import/export (JSON) | Data portability | Medium |
| Knowledge examples (6 new) | Documentation by example | Low |
| Knowledge-first README | Product positioning | Low |
| Published API reference | Developer evaluation | Low |
| Backup/restore utility | Production confidence | Low |
| Performance benchmarks | SQLite advantage proof | Medium |

### Total Estimated Effort: 4-7 weeks

### What This Delivers

After this release, a developer who runs `npm install limen-ai` gets:

1. **3-line quickstart** with `remember`/`recall` that just works
2. **Full-text search** across all stored knowledge
3. **Semantic search** for meaning-based retrieval
4. **Knowledge graph** with traversal and explanation
5. **Temporal queries** for time-aware knowledge
6. **Automatic extraction** from conversations
7. **Conflict detection** that no competitor has
8. **Health scoring** that no competitor has
9. **Governance, RBAC, audit** that no competitor has
10. **Single dependency, SQLite, zero config** that no competitor matches
11. **MCP server** for Claude Code integration
12. **CLI** for debugging and inspection
13. **19 MCP tools + programmatic API parity**

This is not incremental. This is the complete product.

---

## Part 7: Architecture Decisions

### Decision 1: Vector Search Implementation

**Options analyzed:**
1. **sqlite-vec** — SQLite extension, WASM-based, no additional native dependency
2. **sqlite-vss** — Requires faiss native library, breaks single-dependency promise
3. **External vector DB** (Qdrant, Chroma, Milvus) — violates Limen's architecture
4. **Compute-only** — Store embeddings as BLOBs, compute cosine similarity in JS

**Recommendation**: sqlite-vec (option 1) as primary, compute-only (option 4) as fallback.

**Rationale**: sqlite-vec is a loadable SQLite extension that can be compiled to WASM. It adds vector operations without requiring a second database or a native library beyond better-sqlite3. If sqlite-vec causes platform issues, fall back to storing embeddings as BLOBs and computing similarity in JavaScript (slow for 100K+ vectors but fine for most use cases).

**Confidence**: LIKELY. sqlite-vec is in active development and used by multiple production systems. Testing needed for integration with better-sqlite3.

### Decision 2: Embedding Generation

**Options analyzed:**
1. **Use configured LLM provider** — OpenAI, Gemini, Mistral all offer embedding APIs
2. **Built-in model** (onnxruntime-web, transformers.js) — local embeddings, no API calls
3. **Bring your own** — Accept pre-computed embeddings

**Recommendation**: Option 1 (provider) as default, option 3 (BYO) as alternative, option 2 (local) as future enhancement.

**Rationale**: Limen already manages LLM provider connections. Adding embedding calls to the transport layer is incremental. Local models add a large dependency and complexity. BYO embeddings are a zero-cost option to support.

### Decision 3: Knowledge API Layer

**Options analyzed:**
1. **New API surface** — `limen.remember()`, `limen.recall()` as top-level methods
2. **Extend existing** — `limen.knowledge.remember()`, `limen.knowledge.recall()`
3. **Replace claims** — Remove ClaimApi, only expose high-level

**Recommendation**: Option 1 (top-level) for the simple API, keep ClaimApi for power users.

**Rationale**: The developer journey starts with `limen.remember()`. If they need power, they drop to `limen.claims.assertClaim()`. Two layers serving two audiences. The MCP server already validates this pattern (high-level `limen_remember` alongside low-level `limen_claim_assert`).

### Decision 4: Automatic Extraction Architecture

**Options analyzed:**
1. **Pipeline phase** — Add extraction as a pipeline phase after chat
2. **Session hook** — Extract on session close
3. **Background job** — Queue extraction for async processing
4. **Configurable** — All three, user chooses

**Recommendation**: Option 4 (configurable), with pipeline phase as default.

**Rationale**: Mem0 extracts inline. Zep extracts in background. Developers have different latency/accuracy tradeoffs. Support all three with sensible defaults (inline extraction, disabled by default, enabled per session).

---

## Part 8: The Honest Assessment

### What Limen Is Today

Limen is an extraordinary piece of infrastructure engineering. 134 invariants. Hash-chained audit. Formal governance boundary. No competitor comes close on architectural rigor.

But architecture does not win adoption. API simplicity does. A developer comparing Limen to Mem0 today sees:

**Mem0:**
```typescript
const memory = new Memory();
await memory.add(messages, { userId: 'alice' });
const results = await memory.search('preferences', { userId: 'alice' });
```

**Limen:**
```typescript
const limen = await createLimen();
const result = limen.claims.assertClaim({
  subject: 'entity:user:alice',
  predicate: 'preference.cuisine',
  object: { type: 'string', value: 'loves Thai food' },
  confidence: 0.8,
  validAt: new Date().toISOString(),
  missionId: '...',
  taskId: null,
  evidenceRefs: [],
  groundingMode: 'runtime_witness',
  runtimeWitness: { witnessType: 'api_call', witnessedValues: {}, witnessTimestamp: '...' },
});
```

The governance is real. The engineering is superior. But the developer chose Mem0 30 seconds ago.

### What Limen Must Become

The simple API on top. The governance underneath. Like how Stripe has a simple `stripe.charges.create()` but underneath runs a compliance engine that handles PCI-DSS, fraud detection, and multi-currency settlement.

```typescript
// What the developer sees
const limen = await createLimen();
await limen.remember('user:alice', 'preference.cuisine', 'loves Thai food');
const knowledge = await limen.recall('user:alice');

// What's actually happening underneath
// - RBAC check (I-13)
// - Claim assertion with auto-generated evidence (CCP)
// - FTS5 index update (trigger)
// - Vector embedding generation and storage
// - Audit trail entry (hash-chained)
// - Conflict detection against existing claims
// - Event emission for subscribers
// - Rate limit check
// - Tenant isolation enforcement
```

The complexity is not gone. It is hidden behind a beautiful API. When the developer needs governance — when they need to audit who said what, when they need to retract a claim with evidence, when they need RBAC on knowledge access — it is all there. They just did not need it in the first 5 minutes.

### Conviction Level: 9/10

This analysis is built on:
- 8 competitor frameworks analyzed in depth
- Current Limen codebase read (API surface, claim types, knowledge API, MCP server)
- 15 unbuilt features audit cross-referenced
- Developer journey mapped minute-by-minute
- Multiple 2026 comparison articles and benchmarks reviewed
- First-principles derivation of what "complete" means for a knowledge engine

The one area of uncertainty is the vector search implementation. sqlite-vec integration with better-sqlite3 needs testing. If it fails, the fallback (compute-only cosine similarity) works but scales poorly past 100K vectors. This is an engineering risk, not a product risk.

---

## Part 9: Prioritized Implementation Order

For a solo founder with AI assistance, building in this order minimizes risk and maximizes developer-facing value at each step:

### Sprint 1: API Parity (3-5 days)
- `limen.remember()`, `limen.recall()`, `limen.connect()`, `limen.forget()`, `limen.reflect()`
- Thin wrappers over existing ClaimApi
- Session API (`limen.session.open/close`)
- Knowledge-first README rewrite
- 3 new examples (remember-recall, search, graph)

**After Sprint 1**: Developers can use Limen with 3 lines of code. Blog post: "Limen 2.0: Knowledge in 3 Lines."

### Sprint 2: Search (5-7 days)
- FTS5 virtual table + triggers
- `limen.search()` implementation
- sqlite-vec evaluation and integration
- Hybrid search (FTS5 + vector)
- Temporal queries (`asOf`, `history`)

**After Sprint 2**: Limen has search parity with competitors. Blog post: "Why SQLite is the Best Vector Database for Agent Memory."

### Sprint 3: Intelligence (7-10 days)
- Auto knowledge extraction pipeline
- Graph traversal (`traverse`, `explain`, `contradictions`)
- Conflict detection on `remember()`
- Context builder
- Knowledge health score

**After Sprint 3**: Limen exceeds competitors on intelligence. Blog post: "Your Agent's Knowledge is Sick — How Limen Diagnoses It."

### Sprint 4: Production & Ecosystem (3-5 days)
- Tool definitions export
- Import/export (JSON)
- Backup/restore utility
- Performance benchmarks
- Published API reference
- 3 more examples (auto-extraction, temporal, conflicts)

**After Sprint 4**: Complete product. npm publish as v2.0.0.

### Total: ~20-27 days of focused work

---

## Appendix A: Feature-by-Feature Competitor Comparison

| Feature | Limen (after this spec) | Mem0 | Zep | Cognee | Letta | Hindsight |
|---------|------------------------|------|-----|--------|-------|-----------|
| Simple remember/recall | YES | YES | YES | YES | YES | YES |
| Full-text search | YES (FTS5) | YES | YES | YES | NO | YES (BM25) |
| Semantic search | YES (sqlite-vec) | YES | YES | YES | NO | YES |
| Knowledge graph | YES | PRO only | YES | YES | NO | YES |
| Temporal queries | YES | NO | YES | NO | NO | YES |
| Auto extraction | YES | YES | YES | YES | YES | YES |
| Conflict detection | YES | NO | NO | NO | NO | NO |
| Health scoring | YES | NO | NO | NO | NO | NO |
| Governance/RBAC | YES | NO | NO | NO | NO | NO |
| Audit trail | YES (hash-chained) | NO | NO | NO | NO | NO |
| Multi-tenant | YES | NO | YES | NO | NO | NO |
| Confidence scores | YES | NO | NO | NO | NO | NO |
| Evidence chains | YES | NO | NO | NO | NO | NO |
| Trust levels | YES | NO | NO | NO | NO | NO |
| Budget enforcement | YES | NO | NO | NO | NO | NO |
| Working memory | YES | NO | NO | NO | YES | NO |
| MCP server | YES | NO | NO | NO | NO | YES |
| CLI | YES | NO | YES (zepctl) | NO | NO | NO |
| Single dependency | YES | NO (OpenAI, vector DB) | NO (Neo4j) | NO (multiple) | NO (multiple) | NO (PostgreSQL) |
| Zero config | YES | YES | NO | YES | NO | NO |
| TypeScript-first | YES | YES | YES | NO (Python) | NO (Python) | NO |
| Open source | YES (Apache 2.0) | YES (Apache 2.0) | Mixed | Open core | YES (Apache 2.0) | YES (MIT) |

**Count of "YES" after this spec: 22/22**
**Next closest competitor (Zep): 11/22**

---

## Appendix B: Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| sqlite-vec integration fails with better-sqlite3 | Medium | High | Fallback to BLOB storage + JS cosine similarity |
| Vector search performance at scale (>100K claims) | Medium | Medium | Benchmark early; document limits; async indexing |
| Auto-extraction quality varies by LLM provider | High | Medium | Configurable extraction prompts; confidence thresholds |
| Scope creep during implementation | High | High | Sprint structure with clear deliverables; ship after each sprint |
| Breaking changes to existing API | Low | High | New APIs are additive; existing ClaimApi unchanged |
| FTS5 tokenization for non-English | Medium | Low | SQLite FTS5 supports Unicode; ICU tokenizer available |

---

## Appendix C: Sources

### Competitor Research
- [Mem0 GitHub](https://github.com/mem0ai/mem0)
- [Mem0 Node.js Quickstart](https://docs.mem0.ai/open-source/node-quickstart)
- [Zep Context Engineering Platform](https://www.getzep.com/)
- [Zep Temporal Knowledge Graph Paper](https://arxiv.org/abs/2501.13956)
- [Letta GitHub](https://github.com/letta-ai/letta)
- [Cognee GitHub](https://github.com/topoteretes/cognee)
- [LangMem SDK](https://langchain-ai.github.io/langmem/)

### Comparison Articles
- [Best AI Agent Memory Systems in 2026: 8 Frameworks Compared](https://vectorize.io/articles/best-ai-agent-memory-systems)
- [AI Agent Memory Systems in 2026: Compared](https://yogeshyadav.medium.com/ai-agent-memory-systems-in-2026-mem0-zep-hindsight-memvid-and-everything-in-between-compared-96e35b818da8)
- [Top 6 AI Agent Memory Frameworks for Devs (2026)](https://dev.to/nebulagg/top-6-ai-agent-memory-frameworks-for-devs-2026-1fef)
- [Mem0 vs Zep vs LangMem vs MemoClaw Comparison 2026](https://dev.to/anajuliabit/mem0-vs-zep-vs-langmem-vs-memoclaw-ai-agent-memory-comparison-2026-1l1k)
- [Top 10 AI Memory Products 2026](https://medium.com/@bumurzaqov2/top-10-ai-memory-products-2026-09d7900b5ab1)
- [The 6 Best AI Agent Memory Frameworks 2026](https://machinelearningmastery.com/the-6-best-ai-agent-memory-frameworks-you-should-try-in-2026/)

### Developer Experience Research
- [Developer Experience Complete Guide 2026](https://getdx.com/blog/developer-experience/)
- [IBM: What Is AI Agent Memory](https://www.ibm.com/think/topics/ai-agent-memory)
- [AI Agent Memory Management: The Complete Guide](https://dev.to/techfind777/ai-agent-memory-management-the-complete-guide-55h9)
- [Memory Systems for AI Agents: What Research Says](https://stevekinney.com/writing/agent-memory-systems)

### Internal References
- `/Users/solishq/Projects/limen/limen/src/api/interfaces/api.ts` — Current public API types
- `/Users/solishq/Projects/limen/limen/src/api/knowledge/knowledge_api.ts` — Stub implementation
- `/Users/solishq/Projects/limen/limen/src/claims/interfaces/claim_types.ts` — Claim Protocol types
- `/Users/solishq/Projects/limen/limen/packages/limen-mcp/src/tools/knowledge.ts` — MCP knowledge tools (working implementation)
- `/Users/solishq/Projects/limen/limen/packages/limen-mcp/src/server.ts` — MCP server tool registry
- `/Users/solishq/SolisHQ/Docs/strategy/LIMEN_UNBUILT_FEATURES_AUDIT.md` — 15 unbuilt features
- `/Users/solishq/Projects/limen/CHANGELOG.md` — Release history
- `/Users/solishq/Projects/limen/docs/getting-started.md` — Current developer onboarding

---

*This is not a roadmap. This is the product. Build it.*
