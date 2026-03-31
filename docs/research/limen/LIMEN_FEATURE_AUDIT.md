# LIMEN FEATURE AUDIT: What to Build Into the Product

> **Date:** 2026-03-30
> **Author:** Researcher Agent (SolisHQ Meta-Orchestrator)
> **Limen Version Audited:** v1.2.0 (limen-ai on npm)
> **Evidence Level:** Confirmed = code verified, Likely = strong inference, Uncertain = requires validation

---

## Executive Summary

SolisHQ has built a substantial infrastructure layer ON TOP of Limen that should be IN Limen. Fourteen shell scripts, Python hooks, JSON config files, and markdown documents replicate functionality that every Limen user needs. Meanwhile, the competitive landscape (Mem0, Zep/Graphiti, Letta, LangMem, CrewAI Memory) has converged on features Limen does not offer: vector search, automatic summarization, temporal decay, and zero-config developer experience.

This audit identifies **27 features** across three categories, prioritized into a roadmap spanning v1.3.0 through v2.0.0.

**Limen's structural advantage:** ACID transactions, audit trails, RBAC, governance boundary, single dependency. No competitor has all of these. The gap is in convenience, not capability. Closing that gap without sacrificing the governance foundation is the product strategy.

---

## PART 1: Audit of SolisHQ Infrastructure Built On Top of Limen

### 1.1 Session Opener Hook (`~/.claude/hooks/session-opener.sh`)

**What it does:** On session start, loads temporal context (current time, time since last session), narrative briefs, sentinel alerts, autonomy level, Femi preference model, excellence gates, and queries Limen's SQLite database directly for institutional knowledge (technique claims grouped by predicate prefix).

**Why it's outside Limen:** Limen has no concept of "session startup context injection." The MCP layer provides `limen_session_open` and `limen_recall`, but the SESSION OPENER does something higher-level: it composes a context package from multiple recall queries, adds temporal awareness, and formats it for LLM consumption.

**What should be in Limen:**
- **Session context builder** — a single call that returns a structured context package (recent warnings, decisions, patterns, project-specific knowledge) ready for LLM injection. Currently, SolisHQ's hook issues 5+ separate recall queries and formats them. This should be one API call.
- **Temporal awareness** — claim age, staleness scoring, time-since-last-session. Limen stores `createdAt` and `validAt` but provides no age/freshness computation.
- **Technique grouping** — the hook groups claims by predicate prefix (architecture, methodology, attack, etc.). This is a common query pattern that should be a first-class query mode.

**Evidence:** Lines 146-158 of session-opener.sh show 5 separate recall instructions. Lines 263-315 show direct SQLite queries bypassing the MCP layer entirely because the MCP tools are too slow/granular for bulk retrieval.

**Confidence:** Confirmed (code verified)

---

### 1.2 Learning Capture Hook (`~/.claude/hooks/learning-capture.sh`)

**What it does:** On session stop, instructs the agent to extract decisions, warnings, patterns, and project knowledge into Limen claims. Also instructs narrative brief writing, promise tracking, and Femi model updates.

**Why it's outside Limen:** Limen stores claims but has no concept of "session learning extraction." The hook is a prompt template that tells the agent WHAT to extract and HOW to categorize it.

**What should be in Limen:**
- **Extraction templates** — predefined schemas for common learning types (decision, warning, pattern, finding) with suggested subject/predicate formats. Currently every user must invent their own ontology.
- **Session summary generation** — `limen_session_close` accepts a summary string, but the actual summary generation is the user's problem. A built-in summarizer (using the configured LLM) could auto-generate summaries from session claims.

**Evidence:** Lines 46-117 of learning-capture.sh — the entire prompt is a structured template that every Limen user would need to recreate.

**Confidence:** Confirmed

---

### 1.3 Pre-Compaction Hook (`~/.claude/hooks/pre-compact.sh`)

**What it does:** Before context compaction, forces extraction of unstored techniques (Layer 2 of Amendment 25), then injects restore instructions.

**Why it's outside Limen:** Limen has no compaction lifecycle awareness. It does not know when an LLM's context window is about to be compacted.

**What should be in Limen:**
- **Pre-compaction callback** — an event hook that fires before context loss, allowing claims to be flushed. This is MCP-framework-specific (Claude Code hooks), but the concept of "emergency state persistence before context loss" is universal.

**Evidence:** Lines 46-61 of pre-compact.sh.

**Confidence:** Confirmed. However, this may be better as MCP tool documentation rather than a core feature.

---

### 1.4 Session Briefs (`~/.solishq/session-briefs/`)

**What it does:** Stores narrative markdown files describing what happened in each session — the arc, key decisions, Femi's energy, unfinished threads, techniques learned. A `latest.md` symlink points to the most recent.

**Why it's outside Limen:** Limen stores structured claims (subject-predicate-object triples), not narrative documents. There is no "document" or "note" object type. Session summaries go into a claim with predicate `session.summary`, but the rich narrative format (500+ words, sections, context) does not fit into a 500-char claim value.

**What should be in Limen:**
- **Long-form claim values** — the 500-char limit on `limen_remember` object values is an MCP tool constraint, not a Limen engine constraint. The engine's ClaimCreateInput accepts arbitrary string values. The MCP tool should allow longer values for document-type claims.
- **Session narrative as first-class object** — either as an artifact type or a claim with `object.type = 'json'` containing structured narrative data.
- **Session history** — query past sessions with their summaries, ordered by recency.

**Evidence:** File `2026-03-30-023000.md` shows a 34-line narrative brief. The MCP `limen_remember` tool caps at 500 chars (line 114 of knowledge.ts: `z.string().min(1).max(500)`).

**Confidence:** Confirmed

---

### 1.5 Sentinel Health Check (`~/.solishq/sentinel/check.sh`)

**What it does:** Runs 10 health checks across system, project, Limen, and infrastructure categories. Outputs structured JSON + human-readable markdown. Checks Limen DB directly (claim count), Vox process, disk space, uncommitted changes, pipeline freshness, MCP config, hooks presence, orphaned processes.

**Why it's outside Limen:** Limen has `limen_health` (engine health status) but no concept of "knowledge health" — how fresh are the claims? How many are stale? Are there contradictions? How large is the DB?

**What should be in Limen:**
- **Knowledge health metrics** — claim count, freshness distribution (how many claims are <1d, 1-7d, 7-30d, 30d+ old), contradiction count, orphaned claim count, storage size.
- **Staleness alerting** — configurable thresholds for claim freshness. "Warn me if my most recent claim in predicate X is older than 7 days."

**Evidence:** Lines 136-146 of check.sh — the Limen check is a single query (`SELECT COUNT(*) FROM claim_assertions WHERE status='active'`). A real knowledge health check would be far richer.

**Confidence:** Confirmed

---

### 1.6 Femi Preference Model (`~/.solishq/femi-model.md`)

**What it does:** A structured markdown document capturing the founder's decision patterns, preferences, anti-patterns, energy states, and communication patterns. Updated by agents after sessions where new preferences are observed.

**Why it's outside Limen:** Limen has claims with predicate `preference.femi` but no structured profile object. Claims are flat triples; a preference model is a structured document with sections, hierarchy, and cross-references.

**What should be in Limen:**
- **User/entity profiles** — structured JSON documents attached to subject URNs. Not just triples, but rich profile objects that can be queried and updated atomically. Example: `entity:user:femi` with a profile containing `preferences`, `anti_patterns`, `communication_style`.
- This is distinct from claims because a profile is a LIVING DOCUMENT (mutable, versioned), while claims are IMMUTABLE knowledge assertions.

**Evidence:** The 60-line femi-model.md contains structured data (Core Decision Patterns, Preferences, Anti-Patterns, Energy States, Current Priorities, Communication Patterns) that does not map cleanly to flat claim triples.

**Confidence:** Confirmed

---

### 1.7 Promise Tracking (`~/.solishq/promises/`)

**What it does:** Stores JSONL files tracking commitments made during sessions — promise text, confidence, context, outcome (kept/broken/partial), and delta between promise and reality.

**Why it's outside Limen:** Limen has no "commitment" or "promise" object type. Claims are assertions of fact, not commitments about the future.

**What should be in Limen:**
- **Temporal claims with future validity** — claims with `validAt` in the future could represent commitments. Combined with an outcome mechanism (was the commitment met?), this would enable promise tracking without a new object type.
- **Outcome registration** — the Intelligence MCP has `register_outcome`, but Limen core does not. A claim + outcome pairing would enable calibration loops.

**Evidence:** The JSONL format (`{"promise":"text","confidence":0.7,"context":"...","outcome":"kept|broken|partial","delta":"..."}`) maps directly to claims with a `commitment.status` predicate and outcome updates.

**Confidence:** Likely. This could be implemented as a convention on top of existing claims rather than a new feature.

---

### 1.8 Excellence Gates (`~/.solishq/excellence-gates.md`)

**What it does:** Defines 5 quality gates (Completeness, Depth, Originality, Invention, Self-Challenge) that all agent outputs must pass before being presented to the founder.

**Why it's outside Limen:** This is governance metadata — rules about how agents should behave. Limen stores knowledge claims, not behavioral rules.

**What should be in Limen:**
- **Governance claim predicates** — `governance.gate`, `governance.rule`, `governance.standard`. Protected from supersession. Queryable as a set. The MCP layer already has `LIMEN_PROTECTED_PREFIXES` for this, but the concept should be elevated to a first-class feature.

**Evidence:** The file is 35 lines of structured rules. Could be stored as 5 claims with predicate `governance.quality_gate`.

**Confidence:** Likely. This is more about convention/documentation than a new feature.

---

### 1.9 Autonomy Levels (`~/.solishq/autonomy.json`)

**What it does:** Defines 4 autonomy levels (Supervised, Guided, Autonomous, Full Trust) with escalation rules per action type.

**Why it's outside Limen:** Limen has agent trust progression (untrusted -> probationary -> trusted -> admin) but no concept of autonomy levels as configurable per-agent behavioral constraints.

**What should be in Limen:**
- **Agent capability constraints** — configurable per-agent rules about what requires escalation. Limen already has RBAC and trust levels; autonomy levels are a higher-level abstraction on top of those.

**Evidence:** The 54-line JSON file maps to 4 claims with predicate `agent.autonomy_level` and structured JSON values.

**Confidence:** Uncertain. This may be too domain-specific for a general-purpose product.

---

### 1.10 Direct SQLite Queries Bypassing MCP

**What it does:** The session-opener.sh hook queries Limen's SQLite database directly (lines 263-344) for speed, bypassing the MCP tool interface.

**Why this matters:** It reveals a performance gap. The MCP tool interface requires: tool call -> JSON parse -> engine method -> SQLite query -> JSON serialize -> response. Direct SQLite takes <100ms. The hook needs 25 claims grouped by predicate prefix, and making 25 individual MCP calls would be prohibitively slow.

**What should be in Limen:**
- **Bulk query API** — a single MCP tool call that returns multiple claim groups in one response. Example: `limen_recall_bulk` with multiple predicate filters.
- **Context builder tool** — a single MCP tool that returns a session startup context package.

**Evidence:** Lines 263-315 of session-opener.sh use raw `sqlite3.connect` to query `claim_assertions` directly, grouped by predicate prefix.

**Confidence:** Confirmed

---

## PART 2: Competitive Landscape Analysis

### 2.1 Mem0

**What it is:** A universal memory layer (managed cloud + self-hosted). Dual-store: vector DB for semantic search + knowledge graph for entity relationships.

**Key features Limen does not have:**
- Automatic memory extraction from conversations (passive — `add()` call extracts facts)
- Vector/semantic search (embedding-based retrieval)
- Knowledge graph with entity relationships
- Memory compression (90% lower token usage vs full-context)
- Framework integrations (OpenAI, LangGraph, CrewAI, Vercel AI SDK)

**Key features Limen has that Mem0 does not:**
- ACID transactions with audit trail
- RBAC authorization on every operation
- AES-256-GCM encryption at rest
- Budget enforcement (token budgets, deadlines)
- Agent governance (16 system calls, capability boundaries)
- Multi-tenant isolation
- Single production dependency
- Deterministic replay

**Developer experience:** Time-to-first-memory is minutes. SDK is small. But no governance, no audit trail, no encryption.

**Pricing:** Free tier (10K memories), $19/mo (50K), $249/mo (Pro).

**Evidence level:** Confirmed (documentation + community reports verified)

---

### 2.2 Zep / Graphiti

**What it is:** Temporal knowledge graph engine. Zep Cloud is the commercial product; Graphiti is the open-source graph engine.

**Key features Limen does not have:**
- Bi-temporal model (when event occurred + when ingested)
- Validity windows on facts (t_valid, t_invalid) — facts are invalidated, not deleted
- Hybrid search (semantic + keyword BM25 + graph traversal)
- Incremental updates without batch recomputation
- Entity extraction from conversations
- Domain-specific entity types

**Key features Limen has that Zep does not:**
- ACID transactions in a local SQLite database (Zep requires Neo4j/FalkorDB/Kuzu)
- Single dependency (Zep requires graph DB + embedding model + LLM)
- Budget enforcement, mission governance, RBAC
- Zero-config local operation (no external services required)

**Architectural insight:** Graphiti's temporal validity windows are the closest to what Limen should build. Limen already has `validAt` on claims but does not have `invalidAt` or automatic supersession tracking. The `supersedes` relationship type exists but is manual.

**Evidence level:** Confirmed (Graphiti is open source, architecture verified)

---

### 2.3 Letta (formerly MemGPT)

**What it is:** An agent runtime with OS-inspired memory management. The LLM manages its own memory (core/recall/archival) like an OS manages RAM and disk.

**Key features Limen does not have:**
- Agent self-editing memory (agent decides what to remember via tool calls)
- Three-tier memory (core = always in context, recall = recent history, archival = long-term search)
- Visual Agent Development Environment (ADE) for debugging memory state
- Filesystem interface for document storage

**Key features Limen has that Letta does not:**
- Limen is an engine, not a runtime — composable, not opinionated
- Governance boundary (agents propose, system decides)
- Audit trail on every state mutation
- Multi-provider transport with circuit breakers

**Architectural insight:** Letta's three-tier memory is powerful but tightly coupled to their runtime. Limen's working memory (SC-14/15/16) + claims (SC-11/12/13) + artifacts (SC-4/5) already provide three tiers, but the abstraction is not packaged as a coherent memory system.

**Evidence level:** Confirmed (open source, architecture verified)

---

### 2.4 LangMem (LangChain)

**What it is:** A library extending LangGraph's built-in store with LLM-powered memory management.

**Key features Limen does not have:**
- Procedural memory (learned procedures saved as updated instructions)
- Episodic memory (few-shot examples from past interactions)
- Namespace-based organization (multi-level grouping)

**Key features Limen has that LangMem does not:**
- Framework-independent (LangMem requires LangGraph)
- Built-in persistence (LangMem uses LangGraph's store)
- Governance layer

**Evidence level:** Confirmed (documentation verified)

---

### 2.5 CrewAI Memory

**What it is:** Multi-layered memory built into the CrewAI agent framework.

**Key features Limen does not have:**
- Cognitive memory with LLM-powered analysis at save time (infers scope, categories, importance)
- Adaptive-depth recall (composite scoring: semantic similarity + recency + importance)
- Scope-based access control (agent scope vs company knowledge, read-only vs read-write)

**Key features Limen has that CrewAI does not:**
- Framework-independent
- ACID transactions, audit trail, RBAC
- Budget enforcement

**Evidence level:** Confirmed (documentation verified)

---

### 2.6 Competitive Matrix Summary

| Feature | Limen | Mem0 | Zep/Graphiti | Letta | LangMem | CrewAI |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| ACID transactions | YES | No | No | No | No | No |
| Audit trail | YES | Partial | No | No | No | No |
| RBAC | YES | No | No | No | No | Partial |
| Encryption at rest | YES | SaaS | No | No | No | No |
| Budget enforcement | YES | No | No | No | No | No |
| Single dependency | YES | No | No | No | No | No |
| Vector/semantic search | No | YES | YES | YES | YES | YES |
| Knowledge graph | No | YES | YES | No | No | No |
| Temporal decay/freshness | No | No | YES | No | No | Partial |
| Auto memory extraction | No | YES | YES | YES | YES | YES |
| Import/export | No | Partial | No | No | No | No |
| Conflict detection | No | No | YES | No | No | No |
| Framework independent | YES | YES | YES | No | No | No |
| Multi-agent sharing | Partial | YES | YES | No | No | YES |
| Zero-config start | YES | YES | No | No | No | No |

**Limen's unique position:** It is the ONLY system with ACID transactions + audit trails + RBAC + budget enforcement + single dependency. No competitor offers this governance depth. But it lacks the convenience features (vector search, auto-extraction, knowledge graph) that make the others immediately useful.

---

## PART 3: Feature Gap Analysis

### Category A: Things SolisHQ Uses That Users Would Want

| # | Feature | SolisHQ Implementation | Limen Gap | Priority |
|---|---|---|---|---|
| A1 | Session context builder | session-opener.sh (5 recall queries + formatting) | No bulk query or context composition API | HIGH |
| A2 | Full-text search | Approved as v1.3.0 FTS5 | Not yet built | HIGH |
| A3 | Technique extraction templates | learning-capture.sh prompt templates | No extraction schemas or ontology guidance | MEDIUM |
| A4 | Knowledge health metrics | sentinel/check.sh (claim count only) | No freshness distribution, staleness, contradiction metrics | MEDIUM |
| A5 | Session narratives | session-briefs/*.md + latest.md symlink | 500-char MCP limit, no narrative object type | MEDIUM |
| A6 | Temporal awareness | session-opener.sh computes time gaps | No age/freshness on claim queries | HIGH |
| A7 | User/entity profiles | femi-model.md (structured markdown) | No structured profile objects | LOW |
| A8 | Bulk claim retrieval | Direct SQLite bypass in session-opener.sh | No bulk/batch query in MCP tools | HIGH |
| A9 | Governance claim protection | LIMEN_PROTECTED_PREFIXES env var | Not documented, not first-class | LOW |
| A10 | Promise/commitment tracking | promises/*.jsonl | No future-validity claims or outcome pairing | LOW |

### Category B: Things Competitors Offer That Limen Does Not

| # | Feature | Who Has It | Limen Impact | Priority |
|---|---|---|---|---|
| B1 | Vector/semantic search | Mem0, Zep, Letta, LangMem, CrewAI | Missing for large claim stores | MEDIUM |
| B2 | Knowledge graph / entity relationships | Mem0, Zep/Graphiti | Limen has claim relationships but no graph traversal queries | LOW |
| B3 | Automatic memory extraction | Mem0, Zep, Letta, LangMem, CrewAI | Users must manually decide what to remember | MEDIUM |
| B4 | Temporal validity windows | Zep/Graphiti (t_valid, t_invalid) | Claims have validAt but no invalidAt | MEDIUM |
| B5 | Conflict/contradiction detection | Zep, Martian-Engineering/agent-memory | `contradicts` relationship exists but is manual | MEDIUM |
| B6 | Import/export (JSON, CSV, markdown) | Mem0 (partial), Google Gemini | No import/export in Limen | HIGH |
| B7 | Claim summarization | CrewAI (cognitive memory) | No auto-summarization of claim clusters | LOW |
| B8 | Composite scoring (recency + importance + similarity) | CrewAI, Zep | Query results unscored | MEDIUM |
| B9 | Framework integrations | Mem0 (OpenAI, LangGraph, CrewAI, Vercel) | Only MCP integration | LOW |

### Category C: Things Nobody Offers But Should Exist

| # | Feature | Why It Should Exist | Evidence |
|---|---|---|---|
| C1 | **Claim provenance visualization** | No tool shows WHERE a claim came from or HOW it was derived. Graph of evidence chains would make knowledge auditable visually. | NIST AI Agent Standards Initiative calls for auditability. Limen already has provenance chains — they just lack a rendering layer. |
| C2 | **Epistemic health score** | A single number: "how healthy is this knowledge base?" combining freshness, contradiction rate, orphan rate, confidence distribution. No competitor offers this. | Oracle-like. SolisHQ's sentinel check touches this but only checks claim count. |
| C3 | **Claim decay function** | Claims should lose effective confidence over time unless refreshed. A claim from 6 months ago at 0.9 confidence should not outrank a claim from yesterday at 0.7. | Every memory system struggles with stale knowledge. Temporal decay is discussed in research but no product implements it as a query-time function. |
| C4 | **Knowledge debt register** | Like technical debt but for knowledge. Claims that reference deleted evidence, claims with declining confidence over time, claims that contradict each other. Surfaced proactively. | SolisHQ's methodology already has "residual risk registers." Extending this to knowledge is natural. |
| C5 | **Cross-agent knowledge transfer protocol** | Limen has multi-tenant isolation, but no protocol for SHARING knowledge between agents/tenants with provenance preservation. Agent A learns something — how does Agent B get it? | Letta and Mem0 offer shared memory, but without provenance. Limen's claim protocol (evidence chains, grounding modes) makes provenance-preserving transfer possible. |
| C6 | **Natural language querying** | `limen_recall` requires exact subject/predicate patterns. A natural language query ("what did we decide about authentication last week?") would be transformative. Requires FTS5 at minimum, ideally semantic search. | Every developer who encounters Limen's subject URN syntax (`entity:type:id`) asks "can I just search in English?" |
| C7 | **Memory portability standard** | NIST announced an AI Agent Standards Initiative for interoperability. Google and Anthropic are adding memory import features. Limen should define a portable knowledge format (JSON-LD or similar) before a standard is imposed. | NIST announcement (Feb 2026). Google Gemini import tool (Mar 2026). The market is moving toward memory portability. |
| C8 | **Belief layer** | What's missing from every memory system is the extraction step from "what happened" to "what does it mean." Claims are facts; beliefs are derived from facts. No product has an explicit belief layer. | Research paper: "The Memory Problem in AI Agents Is Half Solved. Here's the Other Half." |

---

## PART 4: Prioritized Feature Roadmap

### v1.3.0 — Knowledge Retrieval (Already Approved)

| # | Feature | Description | Effort | New Syscall? | Core vs MCP |
|---|---|---|---|---|---|
| 1 | **FTS5 Full-Text Search** | SQLite FTS5 on claim content for full-text queries | Medium | No (extends SC-13) | Core |
| 2 | **Temporal metadata on query results** | Add `age_seconds`, `freshness_score` to ClaimQueryResultItem | Small | No (extends SC-13 response) | Core |
| 3 | **Raise MCP object value limit** | Increase `limen_remember` from 500 chars to 5000 chars | Trivial | No | MCP |
| 4 | **Import/Export CLI** | `limen export --format json` / `limen import claims.json` | Medium | No | CLI |
| 5 | **Bulk recall MCP tool** | `limen_recall_bulk` accepting multiple predicate/subject filters in one call | Small | No | MCP |

**Rationale:** These are low-risk, high-value. FTS5 is already approved. The others are trivial MCP/CLI additions that don't touch the governance boundary.

---

### v1.4.0 — Knowledge Health & Temporal Intelligence

| # | Feature | Description | Effort | New Syscall? | Core vs MCP |
|---|---|---|---|---|---|
| 6 | **Knowledge health metrics** | Claim count, freshness distribution, contradiction count, storage size, confidence distribution. Exposed via `limen_health` and a new `limen_knowledge_health` MCP tool. | Medium | No | MCP + Core (extends health) |
| 7 | **Claim decay function** | Query-time confidence adjustment: `effective_confidence = confidence * decay(age, half_life)`. Configurable half-life per predicate prefix. | Medium | No (query-time computation) | Core |
| 8 | **Temporal validity windows** | Add `invalidAt` field to claims. When a claim is superseded, set `invalidAt` on the old claim. Enable time-range queries: "what was true on date X?" | Medium | No (extends SC-11, SC-13) | Core |
| 9 | **Session context builder** | `limen_session_context` MCP tool that returns a structured context package: recent warnings, decisions, patterns, project knowledge, grouped by predicate prefix. One call replaces 5+ recalls. | Medium | No | MCP |
| 10 | **Extraction templates** | Ship predefined schemas for common learning types (decision, warning, pattern, finding, technique) as part of MCP server config. | Small | No | MCP |
| 11 | **Contradiction detection** | When asserting a claim, check for existing active claims with same subject and conflicting predicate/value. Return a warning (not a block) with the conflicting claim IDs. | Medium | No (extends SC-11 response) | Core |

**Rationale:** These features address the most common pain points from SolisHQ's internal use. Knowledge health and temporal intelligence are what distinguish a governance substrate from a dumb key-value store.

---

### v1.5.0 — Developer Experience & Portability

| # | Feature | Description | Effort | New Syscall? | Core vs MCP |
|---|---|---|---|---|---|
| 12 | **Natural language recall** | FTS5-powered fuzzy matching on claim content. Not semantic search (no embeddings), but good enough for "what did we decide about auth?" | Small | No (FTS5 extension) | MCP |
| 13 | **Knowledge portability format** | Define a JSON-LD schema for Limen knowledge export. Include claims, relationships, evidence chains. Compatible with NIST standards direction. | Medium | No | Specification + CLI |
| 14 | **Session narrative support** | New claim object type `narrative` with no character limit. Stored with regular claim governance (RBAC, audit, ACID). Queryable by session/project. | Medium | No (extends claim schema) | Core |
| 15 | **Epistemic health score** | Single 0-100 score combining: freshness (are claims recent?), confidence (are claims confident?), consistency (are there contradictions?), coverage (are there orphaned evidence chains?). Exposed via health API. | Medium | No | Core |
| 16 | **Getting-started wizard** | Interactive CLI: `npx limen-ai init` — creates config, opens first session, stores first claim, recalls it. 60-second onboarding. | Small | No | CLI |
| 17 | **Claim templates** | Predefined claim patterns shipped with the MCP server. `limen_remember_decision`, `limen_remember_warning`, etc. — convenience wrappers over `limen_remember` with pre-filled subject URN patterns. | Small | No | MCP |

**Rationale:** Developer experience is the gate to adoption. These features make Limen immediately usable without reading the full spec.

---

### v2.0.0 — Advanced Intelligence (Breaking Changes Permitted)

| # | Feature | Description | Effort | New Syscall? | Core vs MCP |
|---|---|---|---|---|---|
| 18 | **Vector/semantic search** | Embedding-based retrieval using SQLite vec extension or built-in embedding table. Opt-in per claim or per predicate prefix. Requires embedding model configuration. | Large | Possibly (SC-13 extension or new SC-17) | Core |
| 19 | **Knowledge graph traversal** | Graph queries across claim relationships. "Show me all claims that support or derive from claim X, recursively." Limen already has `ClaimRelationship` — this adds traversal queries. | Medium | No (extends SC-13) | Core |
| 20 | **Automatic extraction** | LLM-powered analysis at claim assertion time. When a conversation is added, extract entities, facts, and relationships automatically. Opt-in, uses configured provider. | Large | No (pipeline, not syscall) | Core |
| 21 | **Cross-agent knowledge transfer** | Protocol for sharing claims between agents/tenants with provenance preservation. Agent A's claim becomes Agent B's claim with `derived_from` relationship to the original. | Large | Possibly (new SC-18) | Core |
| 22 | **Belief layer** | Derived claims: automatically inferred from evidence patterns. "Agent X has made 5 claims about Y being unreliable. Derived belief: Y is unreliable (confidence 0.8, derived from 5 claims)." | Large | Possibly | Core |
| 23 | **Claim visualization** | Web-based viewer for claim graphs, timelines, and provenance chains. Could be a separate package (`limen-ui`). | Large | No | New package |
| 24 | **Composite scoring** | Query results ranked by configurable composite score: `recency_weight * recency + confidence_weight * confidence + relevance_weight * fts_score`. | Medium | No (extends SC-13) | Core |
| 25 | **Knowledge debt register** | Automatic detection and reporting: orphaned evidence, declining confidence trends, unresolved contradictions. Exposed via health API and MCP tool. | Medium | No | Core |

**Rationale:** These are the features that would make Limen competitive with Mem0/Zep/Letta on convenience while maintaining the governance advantage. They require careful design to avoid bloating the single-dependency architecture.

---

### Deferred / Out of Scope

| # | Feature | Why Deferred |
|---|---|---|
| 26 | **User/entity profiles** | Can be implemented as JSON claims with convention. Does not need a new object type. |
| 27 | **Framework integrations** (OpenAI, LangGraph, CrewAI) | MCP is the universal integration layer. Building framework-specific adapters dilutes focus. Revisit when MCP adoption plateaus. |

---

## PART 5: Developer Experience Audit

### 5.1 First 5 Minutes: npm install limen-ai

**Step 1: Install**
```bash
npm install limen-ai
```
Result: 1 production dependency (better-sqlite3). Clean install, no native compilation issues on macOS/Linux. Windows may have better-sqlite3 build issues (not tested). **Grade: A**

**Step 2: Hello World**
```typescript
import { createLimen } from 'limen-ai';
const limen = await createLimen();
const response = limen.chat('What is quantum computing?');
console.log(await response.text);
await limen.shutdown();
```
This works. Three lines to chat. Auto-detects provider from env vars. Generates dev encryption key. **Grade: A**

**Step 3: Store and recall knowledge**

This is where it breaks down. There is no simple `limen.remember()` or `limen.recall()` on the engine API. The knowledge tools exist only in the MCP layer (`limen_remember`, `limen_recall`). To use Limen as a knowledge store programmatically, a developer must:

1. Understand the claim protocol (subjects, predicates, objects, grounding modes, evidence refs)
2. Call `limen.claims.assertClaim()` with 9+ required parameters
3. Call `limen.claims.queryClaims()` with a structured query input

Compare to Mem0:
```python
m = MemoryClient()
m.add("User prefers dark mode", user_id="alice")
results = m.search("what does alice prefer?", user_id="alice")
```

**Grade: D** for knowledge management developer experience.

### 5.2 What's Confusing

1. **Subject URN syntax** (`entity:type:id`) — developers do not know what type to use or what id to choose. No guidance, no examples beyond the MCP tool descriptions.

2. **Predicate format** (`domain.property`) — what domains exist? What properties are valid? No ontology documentation.

3. **Grounding mode** — what is `evidence_path` vs `runtime_witness`? The spec is clear but the developer docs are not. Most users want `runtime_witness` for manual assertions.

4. **MCP-only convenience** — the high-level tools (`limen_remember`, `limen_recall`, `limen_reflect`, `limen_scratch`) exist only in the MCP server. A TypeScript developer using the engine directly gets none of these. There should be equivalent convenience methods on the `Limen` API object.

5. **No claim examples** — the README shows chat, streaming, structured output, sessions, and missions. It does not show a single claim assertion or query example.

6. **Knowledge API is stub** — `KnowledgeApiImpl` (knowledge_api.ts) returns `{ memoriesCreated: 0 }` for every operation. The `search()` method returns `[]`. The claims facade is the real implementation, but `limen.knowledge` appears non-functional.

### 5.3 What Would Make a Developer Say "This is Amazing"

1. **`limen.remember("User prefers dark mode")`** — a one-liner that auto-generates subject URN, predicate, grounding mode, and timestamps. The claim protocol is powerful but should have a convenience surface.

2. **`limen.recall("what does the user prefer?")`** — natural language query that uses FTS5 to find relevant claims.

3. **`limen.health().knowledge`** — knowledge health metrics right next to engine health.

4. **`limen.export('json')`** — export all knowledge for backup/migration.

5. **Claims in the README** — show a developer storing and recalling knowledge in 3 lines, next to the chat example.

6. **Interactive quickstart** — `npx limen-ai init` that walks through creating a knowledge base, storing a fact, and recalling it.

### 5.4 What's Missing From Docs

1. No claim/knowledge examples in README
2. No ontology guide (what subjects/predicates to use)
3. No migration guide (upgrading from v1.1 to v1.2)
4. No "when to use claims vs working memory vs artifacts" guide
5. No comparison with Mem0/Zep/Letta for knowledge management use cases
6. No MCP setup guide in the README (MCP is documented separately)

---

## PART 6: Synthesis and Recommendations

### The Core Insight

Limen is architecturally superior to every competitor in governance, auditability, and safety. But it is architecturally inferior in developer experience for knowledge management. The gap is not in the engine — the claim protocol is powerful and well-designed. The gap is in the SURFACE:

1. **No convenience API** for knowledge operations on the engine
2. **No guidance** on claim ontology (subject/predicate conventions)
3. **No temporal intelligence** (freshness, decay, staleness)
4. **No bulk operations** for session startup/context building
5. **No export/import** for portability
6. **No health metrics** for knowledge quality

### What to Build First (v1.3.0 priorities)

1. **FTS5** (already approved) — unlocks natural language recall
2. **Convenience API on engine** — `limen.remember()`, `limen.recall()` as thin wrappers over the claim facade
3. **Raise MCP value limit** — 500 chars -> 5000 chars
4. **Bulk recall** — one MCP call for multiple filters
5. **README: add claim examples** — show knowledge management in 3 lines

### What Makes Limen Unbeatable (v1.4.0-v1.5.0)

6. **Knowledge health metrics** — no competitor has this
7. **Claim decay/freshness scoring** — only Zep/Graphiti approaches this
8. **Temporal validity windows** — Graphiti-inspired but governance-grade
9. **Epistemic health score** — a SolisHQ invention, nobody else has it
10. **Knowledge portability format** — ahead of NIST standards

### What to Do About Vector Search

Vector/semantic search is the #1 feature every competitor has that Limen does not. But adding it requires an embedding model dependency, which violates I-01 (single production dependency). Three options:

**Option A: SQLite vec extension** — a SQLite extension for vector search. Keeps single-dependency philosophy. Limited model support. Experimental.

**Option B: Opt-in embedding provider** — use the already-configured LLM provider to generate embeddings. Store in SQLite. No new dependency. But adds latency to claim assertions.

**Option C: External vector DB adapter** — allow plugging in Chroma/Pinecone/etc. Breaks single-dependency.

**Recommendation:** Option B for v2.0.0. Use the configured provider for embeddings. Store vectors in SQLite (BLOB column). Search at query time with cosine similarity. No new dependency. Opt-in per predicate prefix.

---

## Limitations of This Audit

1. **No user research** — this audit is based on SolisHQ's internal usage and web research, not interviews with Limen users (near-zero community adoption as stated in README).
2. **Competitor features verified from documentation**, not hands-on testing. Feature claims may overstate actual quality.
3. **Effort estimates are approximate** — actual implementation effort depends on invariant impact and test coverage requirements.
4. **v2.0.0 features speculative** — the belief layer and automatic extraction features are conceptual. No competitor has proven these at production quality.
5. **MCP-first bias** — this audit focuses on MCP tool surface because that is how SolisHQ uses Limen. The TypeScript API surface may have different priorities for non-MCP users.

---

## Sources

### Competitor Documentation
- [Mem0 Platform Overview](https://docs.mem0.ai/platform/overview)
- [Mem0 GitHub](https://github.com/mem0ai/mem0)
- [Zep / Graphiti GitHub](https://github.com/getzep/graphiti)
- [Graphiti Knowledge Graphs for Agents](https://blog.getzep.com/graphiti-knowledge-graphs-for-agents/)
- [Letta (MemGPT) GitHub](https://github.com/letta-ai/letta)
- [Letta Agent Memory Guide](https://www.letta.com/blog/agent-memory)
- [LangMem Documentation](https://langchain-ai.github.io/langmem/)
- [LangMem Concepts Guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)
- [CrewAI Memory Documentation](https://docs.crewai.com/en/concepts/memory)
- [CrewAI Cognitive Memory Blog](https://blog.crewai.com/how-we-built-cognitive-memory-for-agentic-systems/)

### Comparative Analyses
- [5 AI Agent Memory Systems Compared (DEV Community)](https://dev.to/varun_pratapbhardwaj_b13/5-ai-agent-memory-systems-compared-mem0-zep-letta-supermemory-superlocalmemory-2026-benchmark-59p3)
- [Best AI Agent Memory Systems 2026: 8 Frameworks Compared (Vectorize)](https://vectorize.io/articles/best-ai-agent-memory-systems)
- [Mem0 vs Letta Comparison (Vectorize)](https://vectorize.io/articles/mem0-vs-letta)
- [Mem0 vs Zep vs LangMem vs MemoClaw Comparison (DEV Community)](https://dev.to/anajuliabit/mem0-vs-zep-vs-langmem-vs-memoclaw-ai-agent-memory-comparison-2026-1l1k)
- [Top 6 AI Agent Memory Frameworks for Devs (DEV Community)](https://dev.to/nebulagg/top-6-ai-agent-memory-frameworks-for-devs-2026-1fef)
- [Top 10 AI Memory Products 2026 (Medium)](https://medium.com/@bumurzaqov2/top-10-ai-memory-products-2026-09d7900b5ab1)

### Industry & Standards
- [NIST AI Agent Standards Initiative](https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure)
- [AI Agents and Memory: Privacy and Power in the MCP Era (New America)](https://www.newamerica.org/oti/briefs/ai-agents-and-memory/)
- [The Memory Problem in AI Agents Is Half Solved (Medium)](https://medium.com/data-unlocked/the-memory-problem-in-ai-agents-is-half-solved-heres-the-other-half-ebbf218ae4d5)
- [Agent Memory: Why Your AI Has Amnesia (Oracle)](https://blogs.oracle.com/developers/agent-memory-why-your-ai-has-amnesia-and-how-to-fix-it)

### Pain Points & Developer Experience
- [Mem0: Do AI Agents Really Need Memory? Honest Review (Medium)](https://medium.com/@reliabledataengineering/mem0-do-ai-agents-really-need-memory-honest-review-6760b5288f37)
- [The Three Things Wrong with AI Agents in 2026 (DEV Community)](https://dev.to/jarveyspecter/the-three-things-wrong-with-ai-agents-in-2026-and-how-we-fixed-each-one-4ep3)
- [Agentic Memory Poisoning (Medium)](https://medium.com/@instatunnel/agentic-memory-poisoning-how-long-term-ai-context-can-be-weaponized-7c0eb213bd1a)
- [MCP Memory Server: Hindsight](https://hindsight.vectorize.io/blog/2026/03/04/mcp-agent-memory)
- [Martian-Engineering/agent-memory (GitHub)](https://github.com/Martian-Engineering/agent-memory)

### SolisHQ Internal (Code Evidence)
- `~/.claude/hooks/session-opener.sh` — session context injection, direct SQLite queries
- `~/.claude/hooks/learning-capture.sh` — learning extraction templates
- `~/.claude/hooks/pre-compact.sh` — pre-compaction state preservation
- `~/.solishq/session-briefs/` — narrative session memory
- `~/.solishq/sentinel/check.sh` — health monitoring with Limen checks
- `~/.solishq/femi-model.md` — structured preference model
- `~/.solishq/autonomy.json` — autonomy level configuration
- `~/.solishq/excellence-gates.md` — quality gate definitions
- `~/Projects/limen/packages/limen-mcp/src/tools/knowledge.ts` — MCP knowledge tools
- `~/Projects/limen/packages/limen-mcp/src/adapter.ts` — session adapter
- `~/Projects/limen/src/claims/interfaces/claim_types.ts` — claim type system
- `~/Projects/limen/src/api/knowledge/knowledge_api.ts` — stub knowledge API
