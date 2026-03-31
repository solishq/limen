# LIMEN RELEASE STRATEGY: The Ruthless Cut

**Date**: 2026-03-30
**Author**: Researcher Agent (SolisHQ Meta-Orchestrator)
**Status**: DEFINITIVE RELEASE PLAN
**Source Material**: 10 research documents, 8 competitor analyses, 80+ technologies surveyed, 27+ features audited
**Governing Law**: Ship the thing that makes developers say "holy shit" in 5 minutes. Everything else waits.

---

## The Core Insight

Limen is the most architecturally rigorous cognitive infrastructure in the AI agent space. 16 system calls, 134 invariants, 3,200+ tests, hash-chained audit, RBAC, AES-256-GCM encryption, single dependency. No competitor touches this.

But a developer who runs `npm install limen-ai` today cannot store and recall a fact without writing 15 lines of branded-type ceremony. Meanwhile, Mem0 does it in 3 lines. The developer chose Mem0 30 seconds ago.

**The strategy is not "add features." The strategy is "make the existing power accessible, then add the features nobody else has."**

---

## Tier 1: "WOW" Release (v1.3.0)

### Timeline: 2-3 weeks from start
### Theme: "3 lines to remember. Governance underneath."

This is the release that makes a developer tweet about Limen. The thesis: **Mem0's simplicity as a facade over Limen's governance**. The developer sees `limen.remember()`. Underneath, RBAC fires, audit trail writes, encryption runs, tenant isolation enforces. They never know until they need it.

### Features (in build order)

| # | Feature | Source Doc | Effort (days) | Depends On |
|---|---------|-----------|---------------|------------|
| 1 | **`limen.remember(subject, predicate, value, options?)`** -- programmatic convenience API | Complete Feature Spec 1.1, DX Spec 3.2 | 2 | Nothing |
| 2 | **`limen.recall(subject?, options?)`** -- programmatic query API | Complete Feature Spec 1.2, DX Spec 3.2 | 2 | Nothing |
| 3 | **`limen.connect(fromId, toId, relationship)`** -- simplified relate | Complete Feature Spec 1.4 | 1 | #1 |
| 4 | **`limen.forget(claimId)`** -- retract with audit trail | Complete Feature Spec 1.5 | 0.5 | #1 |
| 5 | **`limen.reflect(learnings[])`** -- batch assert | Complete Feature Spec 1.6 | 1 | #1 |
| 6 | **`limen.session.open/close`** -- programmatic session API | Complete Feature Spec 2.1, 2.3 | 1 | Nothing |
| 7 | **FTS5 Full-Text Search** -- `limen.search(query)` | Feature Audit A2, Complete Feature Spec 5.1 | 3 | #1, #2 |
| 8 | **Raise MCP value limit** -- 500 chars to 5000 chars | Feature Audit 1.4, complete Feature Spec | 0.25 | Nothing |
| 9 | **Bulk recall MCP tool** -- `limen_recall_bulk` | Feature Audit A8, Feature Audit 1.10 | 1 | Nothing |
| 10 | **`reasoning` column on claims** -- store WHY, not just WHAT | Superpowers Spec #4 | 1 | Migration |
| 11 | **Knowledge-first README rewrite** | DX Spec 4.2 | 1 | #1, #2, #7 |
| 12 | **3 new examples** (remember-recall, search, relationships) | DX Spec 4.3, Complete Feature Spec D2 | 1 | #1, #2, #7 |
| 13 | **npm package.json rewrite** (description, keywords, files) | DX Spec 4.1, 4.3 | 0.25 | #12 |
| 14 | **Import/Export CLI** -- `limen export --format json` | Feature Audit B6, Complete Feature Spec C2 | 2 | #1 |

**Total effort: ~17 days**

### What Makes This the "WOW"

1. **The 3-line quickstart becomes real:**
   ```typescript
   const limen = await createLimen();
   await limen.remember('user:alice', 'preference.cuisine', 'loves Thai food');
   const knowledge = await limen.recall('user:alice');
   ```

2. **The "what just happened" reveal:** Every `remember()` call silently created a hash-chained audit entry, ran RBAC checks, encrypted at rest, and enforced tenant isolation. The developer discovers this when they read the README section titled "What just happened."

3. **Full-text search** -- `limen.search("database decisions")` -- works out of the box. No embedding model. No vector database. SQLite FTS5. Sub-50ms.

4. **Reasoning chains** -- `limen.remember(..., { reasoning: "Chose X because Y" })` -- no competitor stores WHY something is believed. This is the tweet-worthy feature.

5. **The README leads with knowledge, not chat.** The first code block is `remember/recall`, not `chat()`.

### Dependencies Between Features

```
#1 remember() ──┐
                ├──> #3 connect()
#2 recall()  ───┤
                ├──> #4 forget()
                ├──> #5 reflect()
                └──> #7 FTS5 search ──> #11 README ──> #12 Examples ──> #13 npm
#6 session API (independent)
#8 MCP limit (independent)
#9 bulk recall (independent)
#10 reasoning column (independent migration)
#14 import/export (depends on #1)
```

### What Gets CUT from v1.3.0

- Vector/semantic search -- requires sqlite-vec evaluation, embedding provider architecture. Deferred to v1.4.0.
- Auto knowledge extraction -- requires LLM pipeline architecture. Deferred to v1.4.0.
- Knowledge graph traversal -- useful but not a first-5-minutes feature. Deferred to v1.4.0.
- Temporal queries (asOf, history) -- valuable but not first-impression. Deferred to v1.4.0.
- Conflict detection -- medium complexity, not a quickstart feature. Deferred to v1.4.0.
- Knowledge health score -- requires claim base to exist first. Deferred to v1.4.0.
- All framework integrations (LangChain, CrewAI, etc.) -- MCP is the universal integration. Deferred to v2.0.0.
- Context builder -- useful but can be composed from recall/search. Deferred to v1.4.0.
- Tool definitions export -- not needed when MCP is the primary integration. Deferred to v1.4.0.
- Narrative memory -- nice-to-have, not a quickstart feature. Deferred to v1.4.0.
- Promise accountability -- requires user base first. Deferred to v2.0.0.
- Quality gates -- requires user base first. Deferred to v1.4.0.
- All governance perfection features (auto-classification, regulatory export, read auditing) -- enterprise tier. Deferred to v2.0.0.

### Definition of Done (v1.3.0)

- [ ] `limen.remember()`, `limen.recall()`, `limen.search()`, `limen.connect()`, `limen.forget()`, `limen.reflect()` work programmatically
- [ ] FTS5 virtual table syncs via triggers, search returns ranked results
- [ ] `reasoning` column on claims, indexed by FTS5
- [ ] MCP `limen_remember` object value limit raised to 5000 chars
- [ ] `limen_recall_bulk` MCP tool accepts multiple filters
- [ ] `limen export --format json` and `limen import` work
- [ ] README rewritten: knowledge-first, 150 lines max, `remember/recall` in first code block
- [ ] 3 new examples ship with npm package (examples/ added to `files`)
- [ ] npm description: "Memory and knowledge infrastructure for AI agents. Governed, audited, local-first. One dependency."
- [ ] All existing 3,200+ tests pass
- [ ] New tests for every new API surface
- [ ] CHANGELOG updated with migration notes

---

## Tier 2: "COMMIT" Release (v1.4.0)

### Timeline: 2-3 months from v1.3.0
### Theme: "The features nobody else has."

This is the release that makes a developer commit to Limen over Mem0/Zep/Letta. The thesis: **cognitive intelligence that no competitor offers, built on the governance foundation**.

### Features (in build order)

| # | Feature | Source Doc | Effort (days) | Depends On |
|---|---------|-----------|---------------|------------|
| 15 | **Semantic vector search (sqlite-vec)** | Engineering Assessment 1.4, Complete Feature Spec B1, Bleeding Edge 1.1-1.8 | 5 | v1.3.0 FTS5 |
| 16 | **Hybrid search** (FTS5 score + vector similarity, configurable weighting) | Bleeding Edge Research, Complete Feature Spec B1 | 3 | #15 |
| 17 | **Temporal queries** -- `limen.recall(subject, { asOf: date })`, `limen.history()` | Complete Feature Spec B4, Superpowers #8 | 3 | v1.3.0 recall API |
| 18 | **Claim decay function** -- query-time confidence adjustment with configurable half-life | Cognitive Architecture 2.3, Engineering Assessment 1.2 | 2 | v1.3.0 |
| 19 | **Conflict detection** -- same-subject-same-predicate auto-detect on `remember()` | Engineering Assessment 1.1, Complete Feature Spec B5 | 3 | v1.3.0 |
| 20 | **Knowledge graph traversal** -- `limen.traverse()`, `limen.explain()`, `limen.contradictions()` | Engineering Assessment 1.5, Complete Feature Spec B3 | 4 | v1.3.0 |
| 21 | **Knowledge health score** -- epistemic health metrics via `limen.health.knowledge()` | Complete Feature Spec 5.6/C6, Superpowers #2, Feature Audit C2 | 3 | v1.3.0 |
| 22 | **Context builder** -- `limen.context(subject)` assembles prompt-ready knowledge | Complete Feature Spec C3, Feature Audit A1 | 3 | #16 |
| 23 | **Session context builder** -- `limen_session_context` MCP tool, one-call replaces 5+ recalls | Feature Audit 1.10, Feature Audit A1 | 2 | v1.3.0 |
| 24 | **Narrative memory** -- auto-structured session narratives on close, inject on open | Superpowers #1 | 2 | v1.3.0 session API |
| 25 | **Freshness tracking** -- staleness detection, `limen.stale()`, `limen.revalidate()` | Complete Feature Spec C5, Superpowers #8 | 2 | #18 |
| 26 | **Quality gates** -- configurable validation hooks on claim assertion | Superpowers #7 | 3 | v1.3.0 |
| 27 | **Temporal validity windows** -- `invalidAt` on claims, auto-set on supersession | Feature Audit B4, Cognitive Architecture | 2 | v1.3.0 |
| 28 | **Tool definitions export** -- `limen.tools()` returns OpenAI/Anthropic-compatible schemas | Complete Feature Spec C1 | 2 | v1.3.0 |
| 29 | **Event system** -- `limen.on('claim.asserted', callback)` | Engineering Assessment 1.6 | 2 | v1.3.0 |
| 30 | **Access-frequency tracking** -- claims recalled often get higher effective confidence | Engineering Assessment 1.2 | 2 | v1.3.0 |
| 31 | **Performance benchmarks** -- published: remember <10ms, recall <20ms, search <50ms | Complete Feature Spec D4 | 3 | #15, #16 |
| 32 | **Published API reference** -- TypeDoc on GitHub Pages | Complete Feature Spec D3 | 1 | v1.3.0 |
| 33 | **6 new examples** (vector search, temporal, conflicts, health, context, auto-extraction) | Complete Feature Spec D2 | 2 | #15-#22 |
| 34 | **Backup/restore utility** -- `limen.data.backup(path)` / CLI `limen backup` | Complete Feature Spec C7 | 1 | v1.3.0 |

**Total effort: ~48 days**

### What Makes This the "COMMIT"

1. **Semantic search** -- `limen.search("what decisions did we make about authentication?", { mode: 'semantic' })` -- finds results by meaning, not keywords. Parity with Mem0/Zep.

2. **Knowledge health** -- `limen.health.knowledge()` returns `{ healthScore: 0.71, staleClaims: 87, contradictions: 3 }`. **Nobody else has this.** This is the feature that makes engineering leads say "we need this for our agents."

3. **Temporal reasoning** -- `limen.recall('user:alice', { asOf: '2026-01-01' })` -- what did we know then? `limen.history('user:alice', 'preference.cuisine')` -- how has this changed? Only Zep approaches this, and Zep requires Neo4j.

4. **Conflict detection** -- when you `remember()` something that contradicts existing knowledge, Limen warns you. Auto-creates `contradicts` relationship. **No competitor does this.**

5. **Claim decay** -- old knowledge automatically loses effective confidence unless refreshed. Configurable per predicate domain. Decisions decay slowly. Findings decay fast. **No competitor does this.**

6. **Quality gates** -- configurable minimum confidence, reasoning requirements, conflict checks. Prevents knowledge pollution. **No competitor does this.**

### Dependencies Between Features

```
v1.3.0 ──┬──> #15 sqlite-vec ──> #16 hybrid search ──> #22 context builder
         ├──> #17 temporal queries ──> #27 validity windows
         ├──> #18 decay ──> #25 freshness ──> #30 access-frequency
         ├──> #19 conflict detection
         ├──> #20 graph traversal
         ├──> #21 knowledge health
         ├──> #23 session context
         ├──> #24 narrative memory
         ├──> #26 quality gates
         ├──> #28 tool definitions
         ├──> #29 event system
         ├──> #31 benchmarks (depends on #15, #16)
         ├──> #32 API reference
         ├──> #33 examples (depends on features)
         └──> #34 backup/restore
```

### What Gets CUT from v1.4.0

- Auto knowledge extraction from conversations -- high complexity, LLM-pipeline architecture needed. Deferred to v2.0.0.
- Framework adapters (LangChain, CrewAI, LlamaIndex, etc.) -- MCP covers 80% of use cases. Deferred to v2.0.0.
- All governance perfection (auto-classification, regulatory export, PII detection, read auditing) -- enterprise features, need customer demand. Deferred to v2.0.0.
- Self-organizing knowledge (auto-classification, auto-connection, consolidation loop) -- requires embedding infrastructure to stabilize first. Deferred to v2.0.0.
- FSRS-inspired claim lifecycle (active/aging/dormant/archived) -- too complex for this release. The simpler decay function covers 80% of the value. Deferred to v2.0.0.
- Cross-agent knowledge transfer protocol -- needs multi-tenant sharing infrastructure. Deferred to v2.0.0.
- Belief layer -- research concept, no production implementation anywhere. Deferred to v3.0.0.
- Promise accountability (predict/record_outcome/calibration) -- needs user base. Deferred to v2.0.0.
- Composite scoring (recency + confidence + relevance weighted) -- hybrid search covers most of this. Full composite scoring deferred to v2.0.0.
- Knowledge portability format (JSON-LD) -- need NIST standards to solidify. Deferred to v2.0.0.
- Natural language query ("what did we decide about auth?") -- FTS5 covers keyword. Semantic search covers meaning. A dedicated NLQ engine is overkill. Cut permanently unless demand emerges.

### Definition of Done (v1.4.0)

- [ ] Vector search works with sqlite-vec (optional peer dep, graceful degradation to FTS5)
- [ ] Hybrid search: `mode: 'keyword' | 'semantic' | 'hybrid'`
- [ ] Temporal queries: `asOf`, `history()` work
- [ ] Claim decay: configurable half-life, per-predicate policy
- [ ] Conflict detection: warns on contradiction, auto-creates relationship
- [ ] Graph traversal: depth-limited recursive CTE with cycle prevention
- [ ] Knowledge health: composite score, freshness distribution, contradiction count
- [ ] Context builder: one call returns prompt-ready knowledge package
- [ ] Event system: `limen.on()` for claim lifecycle events
- [ ] Quality gates: configurable per-tenant validation hooks
- [ ] Benchmarks published and passing
- [ ] API reference on GitHub Pages
- [ ] All existing tests pass + new test coverage
- [ ] Blog post: "Your Agent's Knowledge Is Sick -- Limen Diagnoses It"

---

## Tier 3: "DEPEND" Release (v2.0.0)

### Timeline: 6 months from v1.3.0
### Theme: "Infrastructure that organizations depend on."

This is the release where Limen becomes the standard cognitive layer for production AI systems. Breaking changes permitted. The thesis: **enterprise governance + framework ecosystem + auto-cognition**.

### Features

| # | Feature | Source Doc | Effort (days) | Category |
|---|---------|-----------|---------------|----------|
| 35 | **Auto knowledge extraction** -- LLM-powered fact extraction from conversations | Complete Feature Spec B2, Superpowers #1 | 7 | Cognition |
| 36 | **Governance-aware retrieval** -- trust level affects claim visibility | Complete Feature Spec C4, Superpowers #9 | 4 | Governance |
| 37 | **Auto-classification** -- sensitivity + regulatory domain tagging at assertion time | Governance Perfection 2.2, Pillar 1 | 5 | Governance |
| 38 | **Read auditing for regulated data** | Governance Perfection 2.2, Pillar 3 | 3 | Governance |
| 39 | **Regulatory export packages** -- SOC 2, HIPAA, EU AI Act formats | Governance Perfection 2.2, Pillar 3 | 5 | Governance |
| 40 | **FSRS-inspired claim lifecycle** -- active/aging/dormant/archived with stability tracking | Cognitive Architecture 2.3 | 5 | Cognition |
| 41 | **Consolidation loop** -- background merge/archive/strengthen of claims | Cognitive Architecture 1.4 | 5 | Cognition |
| 42 | **Cross-agent knowledge transfer** -- share claims with provenance | Feature Audit C5, Complete Feature Spec | 5 | Multi-Agent |
| 43 | **Promise accountability** -- predict/record_outcome/calibration | Superpowers #5 | 3 | Cognition |
| 44 | **LangChain adapter** -- `@limen-ai/langchain` | Integration Ecosystem 2.1 | 3 | Ecosystem |
| 45 | **CrewAI adapter** -- `@limen-ai/crewai` | Integration Ecosystem 2.3 | 3 | Ecosystem |
| 46 | **OpenAI Agents SDK integration** | Integration Ecosystem 1.2 | 2 | Ecosystem |
| 47 | **Vercel AI SDK integration** | Complete Feature Spec 3.7 | 2 | Ecosystem |
| 48 | **Knowledge portability format** -- JSON-LD export/import | Feature Audit C7 | 3 | Standards |
| 49 | **Composite scoring** -- configurable recency + confidence + relevance weights | Complete Feature Spec, Bleeding Edge | 3 | Intelligence |
| 50 | **Documentation site** -- full docs with quickstart, concepts, guides, recipes, migration guides | DX Spec 4.4 | 7 | Ecosystem |
| 51 | **Curiosity engine** -- knowledge gap detection, `limen.gaps()` | Superpowers Additional B | 3 | Cognition |
| 52 | **Confidence calibration** -- track prediction accuracy per agent | Superpowers Additional D | 3 | Cognition |
| 53 | **Self-healing knowledge** -- cascade on retraction (derived claims re-evaluated) | Superpowers Additional A | 3 | Cognition |
| 54 | **Knowledge debt register** -- orphaned evidence, declining confidence, unresolved contradictions | Complete Feature Spec 5.2 | 2 | Cognition |
| 55 | **Cohere rerank integration** -- retrieval postprocessor | Integration Ecosystem 1.5 | 2 | Intelligence |
| 56 | **Streamable HTTP MCP transport** -- remote deployment support | Integration Ecosystem 1.1 | 3 | Infrastructure |
| 57 | **Extraction templates** -- predefined schemas for decisions, warnings, patterns | Feature Audit A3, Feature Audit 1.10 | 1 | DX |
| 58 | **Interactive quickstart CLI** -- `npx limen-ai init` | Feature Audit, DX Spec | 2 | DX |

**Total effort: ~83 days**

### What Makes This the "DEPEND"

1. **Auto-extraction** -- chat with your agent, Limen automatically extracts and stores facts. The feature that makes memory "just work." Every competitor has this; now Limen has it with governance.

2. **Enterprise governance** -- auto-classification of sensitive data, read auditing, regulatory export packages. This is what makes compliance officers trust Limen. EU AI Act enforcement begins August 2, 2026.

3. **Framework ecosystem** -- LangChain, CrewAI, OpenAI, Vercel adapters. Developers can use Limen with their existing framework without rewriting.

4. **Self-organizing cognition** -- consolidation loop, FSRS lifecycle, self-healing. Limen starts to think about its own knowledge. No competitor does this.

5. **Full documentation site** -- quickstart, concepts, guides, recipes, migration guides from Mem0/Zep.

### What Gets CUT from v2.0.0

- Analogical reasoning (cross-domain pattern matching) -- requires mature vector infrastructure. Deferred to v3.0.0.
- Belief layer (derived beliefs from evidence patterns) -- research concept. Deferred to v3.0.0.
- Claim visualization web UI (`limen-ui` package) -- significant separate effort. Deferred to v3.0.0.
- Domain-specific presets (`createLimen({ preset: 'healthcare' })`) -- need customer feedback. Deferred to v3.0.0.
- GraphRAG (community detection on claim graphs) -- research integration. Deferred to v3.0.0.
- ColBERT/late interaction retrieval -- overkill for current scale. Deferred to v3.0.0.
- RAPTOR (recursive claim summarization trees) -- invention opportunity, not ready. Deferred to v3.0.0.
- Self-RAG/CRAG (self-reflective retrieval) -- needs mature retrieval pipeline. Deferred to v3.0.0.
- PostgreSQL backend -- premature. SQLite handles up to 1M claims. Deferred to v3.0.0.
- Storage backend abstraction -- document portability concerns in PORTABILITY.md, don't build the abstraction. Deferred to v3.0.0.
- Field-level encryption for HIPAA PHI -- current AES-256-GCM at rest is sufficient for v2. Field-level is v3.
- Semantic Kernel, AutoGen, Haystack, Dify, LlamaIndex adapters -- low demand. Deferred to v3.0.0 or community contribution.

### Definition of Done (v2.0.0)

- [ ] Auto-extraction works with at least 2 LLM providers (Anthropic, OpenAI)
- [ ] Governance-aware retrieval wired to agent trust levels
- [ ] Auto-classification: at minimum predicate-pattern-based classification (NER for PII is optional)
- [ ] Regulatory export for SOC 2 and EU AI Act (HIPAA in v2.1)
- [ ] FSRS-inspired lifecycle running as opt-in maintenance pass
- [ ] Consolidation loop as on-demand or configurable periodic
- [ ] Cross-agent knowledge sharing with provenance
- [ ] 4 framework adapters published as separate npm packages
- [ ] Documentation site live at limen.dev
- [ ] Migration guides for Mem0 and Zep
- [ ] All existing tests pass + comprehensive new coverage
- [ ] Blog posts for each major capability

---

## Tier 4: "FUTURE" Release (v3.0.0+)

### Timeline: 1+ year
### Theme: "AGI-ready cognitive infrastructure."

These are features we **architect for now but do not build**. The v1.3.0 and v1.4.0 designs must not preclude them, but zero code ships for these until demand proves them.

### Features (architect for, don't build)

| # | Feature | Source Doc | Why Not Now |
|---|---------|-----------|-------------|
| 59 | **Belief layer** -- derived beliefs from evidence patterns | Cognitive Architecture, Feature Audit C8 | No production system has proven this works. Pure research. |
| 60 | **Analogical reasoning** -- cross-domain pattern matching | Superpowers Additional C | Requires mature vector + graph infrastructure |
| 61 | **GraphRAG** -- community detection on claim clusters | Bleeding Edge 1.1 | Research integration, needs large claim bases to be useful |
| 62 | **RAPTOR** -- recursive claim summarization trees | Bleeding Edge 1.3 | Invention opportunity but high risk |
| 63 | **Self-RAG/CRAG** -- self-reflective retrieval pipeline | Bleeding Edge 1.5, 1.6 | Needs mature retrieval pipeline |
| 64 | **ColBERT/late interaction** -- per-token retrieval | Bleeding Edge 1.2 | Overkill for current claim sizes |
| 65 | **PostgreSQL backend** -- for 1M+ claim scale | Engineering Assessment 2.0 | SQLite handles realistic workloads. Build when a customer needs it. |
| 66 | **Distributed cognition** -- multi-node Limen with consensus | Cognitive Architecture | Fundamentally different architecture. Separate product decision. |
| 67 | **Claim visualization UI** -- web-based graph/timeline viewer | Complete Feature Spec | Separate package, separate team |
| 68 | **Domain presets** -- `createLimen({ preset: 'healthcare' })` | Engineering Assessment 1.3 | Needs customer feedback to know what presets matter |
| 69 | **Field-level encryption** -- per-claim PHI encryption | Governance Perfection Pillar 1 | Current disk-level AES-256-GCM is sufficient |
| 70 | **HyDE** -- hypothetical document embeddings for deep search | Bleeding Edge 1.4 | Latency cost too high for default, niche use case |
| 71 | **Speculative RAG** -- parallel draft generation | Bleeding Edge 1.8 | Requires multi-model orchestration |
| 72 | **Memory portability standard** -- contribute to NIST initiative | Feature Audit C7 | NIST standards not finalized |
| 73 | **Multi-modal knowledge** -- image/audio/video claims | Bleeding Edge | Different storage model entirely |
| 74 | **Planetary-scale federation** -- Limen instances sharing knowledge across orgs | N/A | Product vision, not engineering reality |

### Architectural Decisions to Make NOW for v3.0.0

1. **Storage abstraction**: All SQL isolated in store files (already enforced by P-010). Document SQLite-specific features in PORTABILITY.md. Future PostgreSQL backend replaces store implementations, not architecture.

2. **Embedding interface**: Design `EmbeddingProvider` as a pluggable interface in v1.4.0. This gates ColBERT, HyDE, and any future retrieval strategy.

3. **Claim schema extensibility**: The `reasoning` column (v1.3.0), `invalidAt` (v1.4.0), and classification metadata (v2.0.0) demonstrate that claim schema evolves. Design migrations to be additive only. Never remove columns.

4. **Event system**: Design events (v1.4.0) to be the hook point for future auto-cognition features. The consolidation loop, self-healing, and curiosity engine all fire from events.

---

## The Anti-List: NEVER BUILD

These are features that appear in the research but should **never** be built into Limen. They are complexity traps, scope creep, or violations of Limen's identity.

| Feature | Why NEVER |
|---------|-----------|
| **Framework detection magic** ("auto-detect LangChain in node_modules") | Fragile, too many edge cases (monorepos, yarn PnP, Bun). Sensible defaults > magic detection. Engineering Assessment confirms: "too many edge cases." |
| **Domain detection** ("auto-detect healthcare vs fintech") | Impossible without user input. A library cannot infer its domain. Offer presets, not detection. |
| **Multi-pass reasoning in the engine** | Violates "THE KERNEL NEVER REASONS" (from claim_types.ts). Reasoning is client-side. Limen provides the knowledge. Superpowers #3 confirms: "NO. Client-side methodology." |
| **Built-in LLM for classification/extraction** | Adding an LLM dependency (ONNX Runtime, transformers.js) would add 50-200MB and destroy the single-dependency value prop. Use the configured provider or make it optional. |
| **Real-time streaming of knowledge changes** (WebSocket/SSE) | Limen is a library, not a server. Application-level EventEmitter is correct. Server features belong in deployment wrappers, not the engine. |
| **Admin dashboard / web UI in core** | Separate package (`limen-ui`). The core engine is headless. No HTML, no CSS, no bundler in core. |
| **Blockchain-based audit trail** | The hash-chained audit in SQLite is already tamper-evident. Blockchain adds latency, complexity, and zero value for a single-node system. |
| **Abstract/philosophical features** ("consciousness," "meta-cognition," "self-awareness") | Marketing poetry, not engineering. Every feature must have a concrete API and a test. |
| **Database server mode** | Limen is an embedded engine (like SQLite itself). If someone needs a server, they wrap Limen in Express/Fastify. We don't build the server. The MCP server is the exception because MCP is a protocol, not an HTTP server. |
| **Compatibility with Node.js < 22** | The engineering cost of supporting Node 18/20 LTS outweighs the gain. better-sqlite3 prebuilts target Node 22+. Accept the requirement, document it clearly. |
| **Replacing better-sqlite3 with sql.js** | sql.js (WASM SQLite) is 3-10x slower and lacks extension loading (no FTS5 triggers, no sqlite-vec). The native dependency is the right trade. Document troubleshooting for platforms where it fails. |

---

## The Complete Timeline

```
Week 0-3:    v1.3.0 "WOW" -- convenience API, FTS5, README, examples
             Ship. npm publish. Blog: "Limen: Knowledge in 3 Lines"

Week 4-12:   v1.4.0 "COMMIT" -- vector search, temporal, decay, health, conflicts
             Ship. npm publish. Blog: "Your Agent's Knowledge Is Sick"

Week 12-26:  v2.0.0 "DEPEND" -- auto-extraction, governance, framework adapters, docs site
             Ship. npm publish. Blog: "Limen 2.0: Cognitive Infrastructure"

Week 26+:    v3.0.0 planning based on user feedback and adoption data
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| sqlite-vec integration fails with better-sqlite3 | Medium | High | Fallback: BLOB storage + JS cosine similarity. Evaluate BEFORE v1.4.0 commit. |
| sqlite-vec npm package is alpha (0.1.7-alpha.2) | Medium | Medium | Monitor GitHub activity. Build from source if npm stale. Fallback to compute-only. |
| FTS5 tokenization inadequate for non-English | Low | Low | SQLite FTS5 supports Unicode. ICU tokenizer available if needed. |
| Scope creep during v1.3.0 | HIGH | HIGH | The feature list is FROZEN. No additions. If something seems essential, it goes to v1.4.0. |
| Convenience API hides governance, users don't discover it | Medium | Medium | "What just happened" section in README. Governance-visible example. Blog posts. |
| Vector search performance at >100K claims | Medium | Medium | Benchmark early. Document scale limits. Use Matryoshka dimensionality reduction (256-dim). |
| Auto-extraction quality varies by LLM provider | High | Medium | Configurable extraction prompts. Confidence thresholds. Provider-specific tuning. |
| EU AI Act enforcement (Aug 2, 2026) creates urgency for governance features | Medium | High | v2.0.0 targets June 2026 to give customers time before enforcement. |
| Breaking changes in v2.0.0 alienate early adopters | Medium | Medium | v2.0.0 breaking changes are additive (new required fields). Provide migration CLI. |

---

## The Conviction Statement

This strategy is built on 10 research documents, 8 competitor analyses, 80+ technology evaluations, and first-principles derivation of what "complete" means for a cognitive infrastructure product.

The single most important thing: **v1.3.0 ships in 3 weeks with `limen.remember()`.** Everything else is subordinate to this. If v1.3.0 is late because we added features, this strategy has failed.

The second most important thing: **v1.4.0 ships the features nobody else has.** Knowledge health scoring, claim decay, conflict detection, temporal reasoning. These are not copies of competitor features -- they are inventions that define the category.

The third most important thing: **v2.0.0 closes the ecosystem gap.** Auto-extraction, framework adapters, documentation site. This is where Limen becomes the default choice, not just the best architecture.

Everything else is future. Build it when demand proves it.

---

## Appendix: Feature-to-Document Traceability

Every feature in this strategy traces back to a specific research finding. No feature was invented for this document.

| Feature | Primary Source | Supporting Sources |
|---------|---------------|-------------------|
| Convenience API | Complete Feature Spec Part 6, DX Spec Part 3 | Feature Audit 5.2, Engineering Assessment Part 4 |
| FTS5 | Feature Audit A2, Complete Feature Spec 5.1 | Engineering Assessment (already approved) |
| Reasoning column | Superpowers #4 | Cognitive Architecture (evidence chains) |
| Vector search | Engineering Assessment 1.4, Bleeding Edge 1.1-1.8 | Complete Feature Spec B1 |
| Temporal queries | Complete Feature Spec B4, Superpowers #8 | Cognitive Architecture 2.0 |
| Claim decay | Cognitive Architecture 2.2-2.3, Engineering Assessment 1.2 | FSRS research (confirmed) |
| Conflict detection | Engineering Assessment 1.1, Complete Feature Spec B5 | Cognitive Architecture 1.3.3, PaTeCon research |
| Knowledge health | Complete Feature Spec C6, Superpowers #2 | Feature Audit C2 |
| Auto-extraction | Complete Feature Spec B2, Feature Audit B3 | Superpowers analysis |
| Governance suite | Governance Perfection (full document) | EU AI Act, HIPAA, SOC 2, FINRA research |
| Framework adapters | Integration Ecosystem (full document) | 10 frameworks analyzed |
| Self-organizing knowledge | Cognitive Architecture Part 1 | DIAL-KG, AutoSchemaKG research |
| FSRS lifecycle | Cognitive Architecture 2.3 | Engineering Assessment 1.2 (feasibility confirmed) |

---

*The ruthless cut. What ships when. What gets cut. No ambiguity.*

*SolisHQ -- We innovate, invent, then disrupt.*
