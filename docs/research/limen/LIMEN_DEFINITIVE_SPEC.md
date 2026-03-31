# LIMEN: THE DEFINITIVE COGNITIVE INFRASTRUCTURE SPECIFICATION

**Date**: 2026-03-30
**Author**: SolisHQ Builder (Consolidated from 19 Research Reports)
**Classification**: CONSEQUENTIAL -- The Single Source of Truth
**Status**: DEFINITIVE
**Version**: 1.0.0

---

**This document consolidates 19 research reports totaling 100,000+ words into a single, self-contained specification. After this, there is no other document to read. Every finding from every report is preserved. Every contradiction is surfaced. Every recommendation is traced to its source.**

---

## TABLE OF CONTENTS

1. [Part 1: The Thesis](#part-1-the-thesis)
2. [Part 2: The Identity](#part-2-the-identity)
3. [Part 3: The Architecture](#part-3-the-architecture)
4. [Part 4: The Features](#part-4-the-features)
5. [Part 5: The Developer Experience](#part-5-the-developer-experience)
6. [Part 6: The Governance](#part-6-the-governance)
7. [Part 7: The Integrations](#part-7-the-integrations)
8. [Part 8: The Engineering Standard](#part-8-the-engineering-standard)
9. [Part 9: The Release Strategy](#part-9-the-release-strategy)
10. [Part 10: The Operational Plan](#part-10-the-operational-plan)
11. [Part 11: The Scale Plan](#part-11-the-scale-plan)
12. [Part 12: The Gaps Register](#part-12-the-gaps-register)
13. [Part 13: The Technology Stack](#part-13-the-technology-stack)
14. [Part 14: Cross-Report Contradictions](#part-14-cross-report-contradictions)
15. [Part 15: The Implementation Roadmap](#part-15-the-implementation-roadmap)

---

# PART 1: THE THESIS
*Source: Report #14 (LIMEN_THESIS.md)*

## The One Sentence

> **Limen is a knowledge engine that treats what AI agents know as beliefs -- with confidence, evidence, decay, and governance -- not as data.**

Twelve words in its shortest form:

> **Limen is a knowledge engine that treats what AI agents know as beliefs, not data.**

## The Ontological Gap

Every AI memory system in production today (Mem0, Zep, Letta, Cognee, LangMem, SuperMemory) treats knowledge as **data**. The operations are database operations: write, read, query, delete. This is the wrong abstraction. [Report #14, Part 1]

Knowledge is **justified true belief** (Plato, 369 BC). The AGM theory (1985) formalized three operations on belief sets: expansion, revision, and contraction -- none of which are CRUD operations. Truth Maintenance Systems (Doyle 1979, de Kleer 1986) implemented justification tracking with dependency-driven retraction. Bayesian epistemology extends to degrees of belief with conditionalization on new evidence. [Report #14, Part 1]

The gap between "knowledge as data" and "knowledge as belief" is not a feature gap. It is an **ontological gap**:

| Property | Data | Belief |
|----------|------|--------|
| Confidence | Binary: exists or does not | Continuous: 0.0 to 1.0 |
| Provenance | Optional metadata | Constitutional requirement |
| Contradiction | Error state | Expected epistemic event |
| Decay | Bug (data should persist) | Feature (beliefs weaken without reinforcement) |
| Retraction | Deletion | Governed transition with cascade |
| Governance | Access control | Epistemic authority, audit, lifecycle |
| Relationships | Foreign keys | Supports, contradicts, supersedes, derived_from |
| Temporal anchor | Created/updated timestamps | Independent "valid at" -- when was this believed true? |
| Self-correction | External process | Intrinsic: retracting A cascades to everything derived from A |

[Report #14, Part 1, Table]

## Why This Matters Now

Three converging forces: [Report #14, Part 1]

1. **The Multi-Agent Problem.** Multi-agent systems require shared belief states, contradiction resolution, and epistemic authority. The ICLR 2026 MemAgents Workshop identifies memory consolidation as the central unsolved problem.
2. **The Trust Problem.** Enterprises need to audit what an AI knew, when, and why. Regulatory frameworks require explainability with auditable evidence chains.
3. **The Scaling Problem.** Knowledge bases must forget what no longer matters. Human cognition solves this through memory decay and consolidation (CLS theory, McClelland et al. 1995).

## The Intellectual Genealogy

```
Plato (369 BC)             Knowledge = Justified True Belief
       |
AGM Theory (1985)          Formal belief revision: expansion, revision, contraction
       |
Doyle / de Kleer           Truth Maintenance Systems: justification tracking,
(1979, 1986)               dependency-driven retraction
       |
Bayesian Epistemology       Degrees of belief, conditionalization
(Ramsey 1926, de Finetti)
       |
Epistemic Logic            Multi-agent knowledge/belief states
(Hintikka 1962, FHMV 1995)
       |
CLS Theory (1995)          Fast hippocampal encoding + slow neocortical consolidation
       |
LIMEN (2026)               Computational epistemic infrastructure
```

Each node contributes a specific design principle:

| Origin | Limen Design Principle | Implementation |
|--------|----------------------|----------------|
| Justified True Belief | Every claim requires grounding | `GroundingMode` type, evidence validation |
| AGM Revision | Contradiction is first-class, not error | `RelationshipType = 'contradicts'` |
| AGM Contraction | Retraction propagates to dependents | Cascade semantics on claim retraction |
| TMS (Doyle) | Every belief carries justification | `Evidence` model with polymorphic FK |
| Bayesian Epistemology | Beliefs have degrees (not binary) | `confidence: number` on every claim, [0.0, 1.0] |
| Epistemic Logic | Multi-agent knowledge/belief distinction | Agent trust levels, RBAC per operation |
| CLS Theory | Fast capture + slow consolidation | Working memory (fast) + claims (slow, governed) |

[Report #14, Part 6]

## The Competitive Chasm

The difference between Limen and competitors is not a feature gap. It is an ontological chasm. For Mem0 to match Limen's epistemic model, it would need to: add confidence scores to every memory, add evidence provenance, add contradiction tracking, add governed retraction with cascade, add audit trails, add RBAC, add temporal anchoring, and add lifecycle states with governed transitions. This is not a sprint. This is a rewrite. [Report #14, Part 7]

## Formal Statement

**Thesis**: The operational semantics of AI knowledge management should derive from formal epistemology rather than from database theory.

**Five Corollaries**: [Report #14, Part 10]
1. A system that cannot represent the confidence of its own knowledge cannot be trusted for high-stakes decisions.
2. A system that cannot track why it believes what it believes cannot provide epistemic provenance.
3. A system that cannot detect contradictions cannot operate safely in multi-agent environments.
4. A system that cannot forget will grow without bound and degrade in quality without bound.
5. Governance is a constitutional requirement, not an optional layer.

**Prediction** (registered 2026-03-30): Within 24 months, dominant AI agent memory systems will adopt at least three of Limen's five epistemic primitives. They will add them as features. Limen has them as architecture.

---

# PART 2: THE IDENTITY
*Sources: Report #14 (LIMEN_THESIS.md), Report #18 (LIMEN_DESIGN_TASTE.md)*

## What Limen Is

Limen is an **engine**. Specifically, a **governed knowledge engine** for AI agents. [Report #14, Part 4]

It is NOT a library (libraries are called and forgotten). It is NOT a platform (platforms host applications). It is NOT a database (databases store data, Limen stores beliefs). It is NOT a framework (frameworks dictate structure).

## Canonical Forms

- **README header**: Limen -- Governed Knowledge Engine for AI Agents [Report #14, Part 4]
- **Tagline**: Beliefs, not data. [Report #18, Part 1.3 -- tagline candidate #1]
- **Conference talk**: "Your AI Doesn't Know What It Knows: Why AI Memory Needs Epistemology" [Report #14, Part 4]
- **npm description**: Governed knowledge engine for AI agents. Store beliefs with confidence, evidence chains, and lifecycle governance. SQLite-powered, zero-config, single dependency. [Report #14, Part 4]

## Name Analysis: "Limen"

**Etymology**: Latin *limen, liminis* -- "threshold, doorstep, entrance, beginning." In psychophysics, the sensory threshold at which a stimulus becomes perceivable. Gives us "subliminal" (*sub* + *limen*). [Report #18, Part 1.1]

**Assessment**: 41/50 across five criteria (communicates purpose: 9/10, memorable: 8/10, searchable: 7/10, available: 8/10, phonetically clean: 9/10). [Report #18, Part 1.1]

**Pronunciation**: LY-men (English) or LEE-men (Latin). Both acceptable. [Report #18, Part 1.1]

**Searchability concern** [Report #17, Finding #1]: "Limen" returns psychology results, not software. Brand conflicts exist (Limen Technologies FZ LLC, LIMEN Relational Clarity Systems, Limen audio plugin). limen.com is for sale but not owned. **Resolution**: Name stays (npm package published, renaming is costly), but tagline must do heavy lifting. "Knowledge Engine for AI Agents" is the searchable form.

## Visual Identity

### Logo Recommendation: The Aperture (Concept B) [Report #18, Part 1.2]

A circle with approximately 30 degrees missing from the top. The circle represents completeness and governance. The gap represents the threshold -- the point of transformation. Works at favicon size. Pairs with the SolisHQ Sun Seal without conflicting.

Three concepts were evaluated. The Threshold Mark (two parallel lines) was too abstract. The Liminal Gate (Pi shape) too literal. The Aperture was recommended as most distinctive and scalable.

### Color Palette [Report #18, Part 1.3]

**Primary**: Deep indigo-blue (#6366F1). Not corporate blue. Not electric blue. Sits between blue (trust) and violet (wisdom). Unclaimed by any competitor.

**Dark Mode (Primary)**:

| Token | Hex | Usage |
|-------|-----|-------|
| `limen-void` | #0B0E17 | Deepest background |
| `limen-surface` | #111827 | Cards, panels, code blocks |
| `limen-primary` | #6366F1 | Primary accent, links |
| `limen-secondary` | #14B8A6 | Success, healthy |
| `limen-warning` | #F59E0B | Warnings, stale |
| `limen-danger` | #F43F5E | Errors, unhealthy |
| `limen-text` | #F1F5F9 | Headings, primary content |
| `limen-text-secondary` | #94A3B8 | Body text |

### Typography [Report #18, Part 1.4]

- **Code**: JetBrains Mono 400/700 (purpose-built for developers, 139 ligatures)
- **Headings**: Space Grotesk 600/700 (geometric, technical authority)
- **Body**: Inter 400/500 (screen-optimized, most-used UI typeface)

### Voice [Report #18, Part 1.5]

Precise. Grounded. Warm-technical. Candid. Confident, not arrogant.

**Words Limen uses**: Believes (not "stores"), Confidence (not "score"), Governed (not "managed"), Asserts/Retracts (not "adds"/"deletes"), Engine (not "platform").

**Words Limen avoids**: Leverage, Ecosystem, Revolutionary, AI-powered, Magic, Simple (as claim), Just (minimizing).

**Pattern**: Concrete first, abstract second. Code before theory.

### Terminal Symbols [Report #13, Part 1.4; Report #18, Part 9]

```
+  Created/added     (green)
-  Removed/retracted (red)
*  Modified/updated  (yellow)
?  Query/search      (cyan)
!  Warning           (yellow)
x  Error/failure     (red)
>  Active/running    (green)
|  Relationship      (magenta)
#  Count/metric      (purple)
No emoji. Ever.
```

---

# PART 3: THE ARCHITECTURE
*Sources: Report #4 (Cognitive Architecture), Report #7 (Engineering Assessment), Report #8 (Bleeding Edge Tech), Report #11 (Distributed Systems)*

## Current Architecture (v1.2.0)

Four-layer architecture: [Report #7, Part 1; Report #9, Part 1]

```
Layer 4: API           (public surface: programmatic API, MCP server, CLI)
Layer 3: Orchestration (system calls, mission/task management, session lifecycle)
Layer 2: Substrate     (claim store, agent registry, audit, encryption, RBAC)
Layer 1: Kernel        (SQLite connection, migration, configuration, lifecycle)
```

Rules: A layer may only import from the layer directly below or from shared types. Layer 1 imports nothing from Limen. Layer 4 is the ONLY layer with public exports.

**Current stats**: 16 system calls, 134 invariants, 3,188+ tests, 1 production dependency (better-sqlite3), 27 migrations, ~45 tables, ~25 enforcement triggers, ~60 indexes. [Report #7, Part 6; Report #16, Gap 2]

## The Seven Cognitive Primitives

Derived from neuroscience, cognitive architecture theory, and knowledge graph research: [Report #4, Part 4.2]

| Primitive | Purpose | Status in v1.2.0 |
|-----------|---------|-------------------|
| **ENCODE** | Store knowledge with evidence | YES (claim_assert, remember, reflect) |
| **RECALL** | Retrieve knowledge by filter | YES (claim_query, recall) |
| **ASSOCIATE** | Link knowledge | YES (connect) |
| **FORGET** | Principled decay/retraction | PARTIAL (retract exists, no decay) |
| **PRIORITIZE** | Rank by relevance | NO |
| **CONSOLIDATE** | Merge related claims | NO |
| **REASON** | Derive new knowledge | NO |

Additionally identified as important but premature: ABSTRACT (generalize from specific), IMAGINE (hypothetical reasoning), ANALOGIZE (cross-domain matching). [Report #4, Part 4.3]

## Cognitive Architecture Vision

```
                LIMEN COGNITIVE ARCHITECTURE

+----------------------------------------------------------+
|                    COGNITIVE LAYER (new)                   |
|  REASON   CONSOLIDATE   PRIORITIZE   ABSTRACT   FORGET   |
+----------------------------------------------------------+
|              ATTENTION ECONOMY (new)                      |
|    (retrievability * connection_density * recency)        |
|              DECAY ENGINE (FSRS-inspired)                 |
+----------------------------------------------------------+
|              KNOWLEDGE LAYER (existing)                   |
|  claim_assert  claim_query  connect  retract  supersede   |
|  remember      recall       reflect                      |
+----------------------------------------------------------+
|              WORKING MEMORY (existing)                    |
|  wm_write     wm_read      wm_discard  scratch           |
+----------------------------------------------------------+
|              KERNEL (existing)                            |
|  database  audit  crypto  vault  events  rbac  retention  |
+----------------------------------------------------------+
|              AUTO-ADAPTATION LAYER (new)                  |
|  env_detect  domain_detect  scale_adapt  schema_evolve   |
+----------------------------------------------------------+
```

[Report #4, Part 7.1]

## Self-Organizing Knowledge

Five self-organization functions Limen needs: [Report #4, Part 1.3]

1. **Auto-Classification**: Pattern matching on predicate namespaces (Level 0), embedding similarity (Level 1), LLM-based (Level 2). Level 0 is trivial -- already implicit. Level 1 requires embedding infrastructure. Level 2 requires async post-assertion processing.

2. **Auto-Connection**: Embedding similarity against existing claims, predicate matching, temporal proximity, contradiction detection. Must be flagged as `suggested`, not auto-confirmed (preserves governance -- I-17). [Report #7, Part 1.1]

3. **Auto-Conflict Detection**: Same-subject-same-predicate-different-value detection (structural). Semantic conflict detection requires embeddings. PaTeCon (arXiv 2312.11053) demonstrates temporal constraint mining for conflict detection. [Report #4, Part 1.3.3]

4. **Importance Assessment**: Access frequency, connection density, recency, authority (agent trust level), governance relevance. [Report #4, Part 1.3.4]

5. **Context Placement**: Mission/task scoping (EXISTS), domain detection via predicate analysis, temporal windowing via validAt (EXISTS). [Report #4, Part 1.3.5]

## The Consolidation Loop (Cognitive Metabolism)

Background process analogous to sleep-replay in the brain: [Report #4, Part 1.4]

```
Every consolidation_interval:
1. SCAN: Find claims with retrievability < aging_threshold
2. CLASSIFY: Auto-classify unclassified claims
3. CONNECT: Discover relationships for recent claims
4. CONFLICT: Detect contradictions
5. CONSOLIDATE: Merge related low-R claims into summaries
6. ARCHIVE: Move claims below archive_threshold to cold storage
7. SCHEMA: Update emergent schema from new patterns
8. METRICS: Record consolidation stats
```

**Engineering assessment** [Report #7, Part 1.2]: Consolidation should be opt-in maintenance command, not background daemon. A library should not run background tasks unless explicitly configured.

## Automatic Forgetting (FSRS-Inspired Decay)

The FSRS power-decay model from spaced repetition, adapted for knowledge claims: [Report #4, Part 2.2-2.3]

**Decay Function**: `R(t) = (1 + t/(9*S))^(-1)` where R = retrievability, t = time elapsed, S = stability. When t = S, R = 0.9. [Report #4, Part 2.3]

**Initial Stability by Claim Type**:

| Claim Type | Initial S (days) | Rationale |
|------------|-------------------|-----------|
| Governance (decision, rule) | 365 | Decisions persist long |
| Architectural pattern | 180 | Patterns evolve |
| Finding (research result) | 90 | Findings need revalidation |
| Warning | 30 | Warnings are time-sensitive |
| Ephemeral (session note) | 7 | Session context decays fast |
| Preference | 120 | Stable but changeable |

**Engineering assessment** [Report #7, Part 1.2]: Implement as query-time computation, NOT stored mutation. `effective_confidence = confidence * decay_function(age)`. Stored confidence remains immutable (CCP-I1). No schema change. Negligible performance impact (one float multiplication per row). Implement in application code for portability. **v1.4.0 target.**

## Tiered Storage Architecture

SQLite scaling analysis: [Report #7, Part 2]

| Scale | Claims | Feasible? | Notes |
|-------|--------|-----------|-------|
| Prototype | 100-1K | YES | Current state |
| Production | 1K-100K | YES | SQLite handles trivially |
| Scale | 100K-1M | YES with caveats | Vector storage significant at 768-dim |
| Enterprise | 1M-10M | CONDITIONAL | Requires optimization |
| Large | 10M-100M | CONDITIONAL | Requires architecture changes |
| AGI-ready | 100M+ | NO as single SQLite | Need storage backend abstraction |

**Recommendation** [Report #7, Part 2]: Do NOT build PostgreSQL backend now. DO ensure all SQL is isolated in store files. Document SQLite-specific features in PORTABILITY.md. The abstraction layer (DatabaseConnection interface) is already correct.

**Tiered storage path**: SQLite (local) -> Turso/libSQL (distributed) -> PostgreSQL (enterprise). [Report #11, Part 2.3]

## Distributed Architecture

Layered sync model on top of embedded SQLite: [Report #11, Part 2.3]

```
Each agent: local SQLite (Limen kernel) -- fast, private, zero-config
     |
     | Sync Layer (governed, selective, causal)
     v
Sync Service: coordination + persistence + governance authority
     |
     | Federation Protocol (cross-org, encrypted)
     v
External Limen instances: cross-organization knowledge sharing
```

**Key insight**: Limen's EXISTING claim model (immutable claims with relationships) is already CRDT-compatible. The merge function is: union of all claims, union of all relationships. Conflicts surface as `contradicts` relationships, not data corruption. [Report #11, Part 1.2]

**Three-layer deployment model**: [Report #11, Part 5.1]
- **Layer 1: EDGE** -- Local SQLite, full cognitive primitives, offline-capable, private by default
- **Layer 2: CLOUD** -- Centralized coordination, claim aggregation, governance authority, pattern detection
- **Layer 3: FEDERATION** -- Cross-organization discovery, encrypted exchange, data sovereignty

**Consistency model**: Governance metadata uses strong consistency (Raft). Knowledge claims use eventual consistency (causal delivery via hybrid logical clocks). [Report #11, Part 1.6]

## Adaptive RAG Router

The single most impactful retrieval technology: [Report #8, Part 1.9]

Instead of one-size-fits-all retrieval, route queries by complexity:
- Exact predicate match -> SQL lookup (fastest)
- Fuzzy subject/predicate -> FTS5 search
- Semantic meaning -> Vector similarity search
- Complex/relational -> Graph traversal
- Multi-hop -> Iterative retrieval with claim chaining

**Invention opportunity**: "Governed Adaptive RAG" -- routing that also considers claim confidence thresholds, grounding modes, and agent trust levels. Nobody has this.

---

# PART 4: THE FEATURES
*Sources: Report #1 (Complete Feature Spec), Report #5 (Superpowers as Features), Report #16 (Operational Gaps)*

## Complete Feature Matrix

### Category 1: Core Knowledge Operations

| # | Feature | Status v1.2.0 | Importance | Target |
|---|---------|---------------|------------|--------|
| 1.1 | `remember(subject, predicate, value)` | MCP only | 10 | v1.3.0 |
| 1.2 | `recall(subject?, predicate?, options?)` | MCP only | 10 | v1.3.0 |
| 1.3 | `search(query, options?)` via FTS5 | NOT BUILT | 10 | v1.3.0 |
| 1.4 | `connect(fromId, toId, relationship)` | MCP only | 9 | v1.3.0 |
| 1.5 | `forget(claimId)` retract with audit | Internal only | 8 | v1.3.0 |
| 1.6 | `reflect(learnings[])` batch assert | MCP only | 8 | v1.3.0 |
| 1.7 | Semantic/vector search | NOT BUILT | 9 | v1.4.0 |
| 1.8 | Claim update (supersede) | Relationship exists, no convenience | 7 | v1.3.0 |
| 1.9 | Bulk operations | NOT BUILT | 6 | v1.3.0 |
| 1.10 | Natural language query | NOT BUILT | 7 | v2.0.0 |

[Report #1, Part 3, Category 1]

### Category 2: Session & Context Management

| # | Feature | Status v1.2.0 | Importance | Target |
|---|---------|---------------|------------|--------|
| 2.1 | Knowledge sessions (open/close) | MCP only | 9 | v1.3.0 |
| 2.2 | Session-scoped scratch pad | WORKS (WMP) | -- | Done |
| 2.3 | Session summaries | MCP only | 7 | v1.3.0 |
| 2.4 | Context builder ("give me everything for task X") | NOT BUILT | 8 | v1.4.0 |
| 2.5 | Cross-session knowledge continuity | Claims persist, no convenience | 7 | v1.4.0 |
| 2.6 | Conversation memory as searchable knowledge | Not searchable | 8 | v1.4.0 |

[Report #1, Part 3, Category 2]

### Category 3: Agent Integration

| # | Feature | Status v1.2.0 | Importance | Target |
|---|---------|---------------|------------|--------|
| 3.1 | MCP server (19 tools) | WORKS | -- | Done |
| 3.2 | LLM-agnostic API (6 providers) | WORKS | -- | Done |
| 3.3 | Tool definitions for function calling | NOT BUILT | 8 | v1.4.0 |
| 3.4 | Auto knowledge extraction from conversations | NOT BUILT | 9 | v1.4.0 |
| 3.5 | Conversation memory store/recall | Partial | 7 | v1.4.0 |

[Report #1, Part 3, Category 3]

### Category 4: Quality & Governance

| # | Feature | Status v1.2.0 | Importance | Target |
|---|---------|---------------|------------|--------|
| 4.1 | Confidence scores | WORKS | -- | Done |
| 4.2 | Freshness tracking | validAt exists, no staleness detection | 7 | v1.4.0 |
| 4.3 | Conflict detection (auto) | Contradicts exists, no auto-detect | 8 | v1.4.0 |
| 4.4 | Audit trail (hash-chained) | WORKS | -- | Done |
| 4.5 | RBAC | WORKS | -- | Done |
| 4.6 | Claim lifecycle (candidate/stale states) | Active/retracted only | 6 | v2.0.0 |
| 4.7 | Governance-aware retrieval (trust affects access) | Trust levels exist, not wired | 7 | v1.4.0 |
| 4.8 | Protected predicates | MCP only (env var) | 6 | v1.3.0 |

[Report #1, Part 3, Category 4]

### Category 5: Intelligence & Search

| # | Feature | Status v1.2.0 | Importance | Target |
|---|---------|---------------|------------|--------|
| 5.1 | Full-text search (FTS5) | NOT BUILT | 10 | v1.3.0 |
| 5.2 | Semantic/vector search (sqlite-vec) | NOT BUILT | 9 | v1.4.0 |
| 5.3 | Knowledge graph traversal | Relationships exist, no traversal | 8 | v1.4.0 |
| 5.4 | Reasoning chains (why was this concluded?) | Evidence refs exist, no traversal | 7 | v1.4.0 |
| 5.5 | Duplicate detection | NOT BUILT | 6 | v1.4.0 |
| 5.6 | Knowledge health scoring | NOT BUILT | 7 | v1.4.0 |
| 5.7 | Auto-summarization of clusters | NOT BUILT | 5 | v2.0.0 |
| 5.8 | Temporal queries ("what was true on March 15?") | validAt exists, no temporal API | 8 | v1.4.0 |

[Report #1, Part 3, Category 5]

### Category 6: Developer Experience

| # | Feature | Status v1.2.0 | Importance | Target |
|---|---------|---------------|------------|--------|
| 6.1 | TypeScript-first with full type safety | WORKS | -- | Done |
| 6.2 | Zero-config quickstart | WORKS | -- | Done |
| 6.3 | Comprehensive examples | 8 examples exist | 8 | v1.3.0 |
| 6.4 | Migration system | WORKS (27 migrations) | -- | Done |
| 6.5 | Import/export (JSON, markdown) | DataApi scaffolded | 8 | v1.3.0 |
| 6.6 | CLI tool | limen-cli exists | 7 | v1.3.0 |
| 6.7 | Knowledge-first README | Current leads with chat | 10 | v1.3.0 |
| 6.8 | Interactive playground/REPL | NOT BUILT | 6 | v2.0.0 |

[Report #1, Part 3, Category 6]

### Category 7: Production Readiness

| # | Feature | Status v1.2.0 | Importance | Target |
|---|---------|---------------|------------|--------|
| 7.1 | SQLite-based (no server) | WORKS | -- | Done |
| 7.2 | Backup/restore utility | SQLite copy, no utility | 6 | v1.4.0 |
| 7.3 | Multi-agent support | WORKS | -- | Done |
| 7.4 | Performance benchmarks | Latency harness exists | 7 | v1.4.0 |
| 7.5 | Configurable retention | Retention scheduler exists | -- | Done |
| 7.6 | Meaningful error messages (30+ codes) | WORKS | -- | Done |
| 7.7 | Graceful shutdown | WORKS | -- | Done |

[Report #1, Part 3, Category 7]

## Superpowers as Features

14 orchestrator superpowers + 5 additional capabilities evaluated for inclusion: [Report #5]

| # | Superpower | Build? | Target |
|---|------------|--------|--------|
| SP1 | Narrative Memory (session arc, momentum, unfinished threads) | YES | v1.4.0 |
| SP2 | Proactive Sensing (knowledge freshness, conflicts, gaps in health) | YES | v1.4.0 |
| SP3 | Multi-Pass Reasoning | NO (client-side methodology, not infrastructure) | -- |
| SP4 | Reasoning Chain Memory (`reasoning` column on claims) | YES | v1.3.0 |
| SP5 | Promise Accountability (predict/record_outcome/calibration) | YES | v1.4.0 |
| SP6 | Haystack Finder (FTS5 + vector search) | YES (already planned) | v1.3.0/v1.4.0 |
| SP7 | Excellence Gates (quality validation hooks on assertion) | YES | v1.4.0 |
| SP8 | Temporal Awareness (recency-weighted retrieval) | YES | v1.4.0 |
| SP9 | Autonomy Levels (operation permissions per trust level) | PARTIAL | v1.4.0 |
| SP10 | User/Preference Model (profile system on claims) | YES | v1.4.0 |
| SP11 | DAG Dispatch | NO (orchestration, not cognition) | -- |
| SP12 | Agent Specialization (reliability scoring) | YES | v1.4.0 |
| SP13 | Real-Time Monitoring (claim lifecycle events) | YES (EventBus exists) | v1.3.0 |
| SP14 | Synthesis Engine (LLM-powered knowledge consolidation) | PARTIAL | v2.0.0 |
| A | Self-Healing Knowledge (cascade on retraction) | YES | v1.4.0 |
| B | Curiosity Engine (knowledge gap detection) | YES | v1.4.0 |
| C | Analogical Reasoning | LATER (requires vector search) | v2.0.0+ |
| D | Confidence Calibration (agent calibration curves) | YES | v1.4.0 |
| E | Knowledge Metabolism (user-triggered consolidation) | YES | v2.0.0 |

[Report #5, Verdict Summary Table]

## Invention Opportunities (Features Nobody Else Has)

1. **Epistemic Health Score** -- quantified knowledge quality (0.0-1.0 with letter grades) [Report #1, Part 5.1; Report #17, Finding #3]
2. **Knowledge Debt Register** -- track what you SHOULD know but don't [Report #1, Part 5.2]
3. **Temporal Reasoning** -- first-class time-aware queries [Report #1, Part 5.3]
4. **Governance-Aware Retrieval** -- trust level affects visibility [Report #1, Part 5.4]
5. **Calibration Loop** -- track predictions vs outcomes [Report #1, Part 5.5]
6. **Memory Portability Standard** -- JSON-LD export [Report #1, Part 5.6]
7. **Cognitive Consolidation Engine** -- principled episodic-to-semantic conversion [Report #8, Part 7.2]
8. **Governed GraphRAG** -- graph retrieval with epistemic governance [Report #8, Part 7.1]
9. **Activation-Based Retrieval** -- ACT-R inspired claim prioritization [Report #8, Part 7.4]

---

# PART 5: THE DEVELOPER EXPERIENCE
*Sources: Report #2 (Developer Experience Spec), Report #13 (Interface Design), Report #18 (Design Taste)*

## Three-Line Onboarding

The minimum viable developer interaction: [Report #1, Part 2; Report #15, Tier 1]

```typescript
const limen = await createLimen();
await limen.remember('user:alice', 'preference.cuisine', 'loves Thai food');
const knowledge = await limen.recall('user:alice');
```

**Current state**: This does NOT work in v1.2.0. The programmatic API requires 8+ parameters via `assertClaim()`. The MCP tools work but are not available programmatically. [Report #1, Part 2]

**What must change**: Promote MCP-layer patterns (`remember`/`recall`/`connect`/`reflect`/`scratch`) to the programmatic API as thin wrappers over existing ClaimApi. [Report #7, Part 4]

## The DX Gap

A developer comparing Limen to Mem0 today: [Report #1, Part 8]

**Mem0**: `memory.add(messages)` / `memory.search(query)` -- 3 lines

**Limen**: `limen.claims.assertClaim({subject, predicate, object: {type, value}, confidence, validAt, missionId, taskId, evidenceRefs, groundingMode, runtimeWitness})` -- 15 lines of ceremony

The governance is real. The engineering is superior. But the developer chose Mem0 30 seconds ago.

**The Stripe analogy**: Simple `stripe.charges.create()` on top, PCI-DSS compliance engine underneath. Limen needs simple `limen.remember()` on top, RBAC + audit + encryption + tenant isolation underneath. [Report #1, Part 8]

## CLI Design [Report #13]

Command grammar: `limen <verb> [noun] [flags]`

Three design principles:
1. Legibility over density -- absorb meaning in <2 seconds
2. Structure for machines, beauty for humans -- JSON via `--json`, human-readable by default
3. Errors are conversations, not stack traces

CLI personality: Calm, confident, fast. Silent when possible. Never celebrate. Never apologize. Report and exit. [Report #18, Part 6.1]

Operations <200ms: No loading indicator. 200ms-2s: dot animation. >2s: spinner with description. [Report #18, Part 6.4]

## Error Messages [Report #13, Part 7; Report #18, Part 7]

Every error follows the anatomy: `x LMN-NNNN: Title` + detail + fix + docs link.

Error code namespaces:
- 1xxx: Kernel errors
- 2xxx: Substrate errors (claims, agents, audit, RBAC)
- 3xxx: Orchestration errors
- 4xxx: API errors

**Non-negotiables**: Every error has a code. Every error has a fix. Errors never expose internals. Warnings use amber, not red. [Report #18, Part 7.3]

## The Three Wow Moments [Report #18, Part 8]

1. **`limen status`** -- Spacecraft-like telemetry. Claims active/retracted, freshness percentage, subsystem health. Screenshot-worthy.
2. **`limen graph`** -- Knowledge graph in the terminal. Tree structure with dotted-fill alignment, confidence scores inline, relationship types in magenta.
3. **The Error That Helps** -- Governance protection error that explains what, why (not a bug), how to fix, and where to learn more. Developers screenshot this.

## The Cold Start Problem [Report #17, Finding #2]

When knowledge base has zero claims, recall returns nothing. The system is technically working and experientially dead.

**Solutions**:
1. Starter templates: `limen.bootstrap('engineering')` seeds 10-20 connected claims
2. Interactive onboarding: Welcome message with 3-line quickstart on empty database
3. Demo mode: `createLimen({ demo: true })` with 50 pre-loaded interconnected claims
4. First-claim celebration: Special response when knowledge base comes alive

**Priority**: MUST-HAVE for v1.3.0 [Report #17, Finding #2]

## README Design [Report #18, Part 2]

First 5 lines determine everything. Code before words. 150 lines maximum. Lead with knowledge operations, not chat.

**Structure**: Logo -> "3 Lines to Remember" quickstart -> "What Runs Underneath" governance reveal -> Comparison table (Mem0 vs Zep vs Limen) -> MCP config -> Architecture diagram -> Footer.

Social preview image: 1280x640px, dark background (#0B0E17), logo centered, tagline in Space Grotesk. [Report #18, Part 2.3]

## Documentation Site Architecture [Report #18, Part 3]

```
limen.dev/
  /docs/quickstart           2-minute install->remember->recall
  /docs/concepts/beliefs     The belief model explained
  /docs/concepts/governance  Audit, RBAC, encryption
  /docs/guides/              How-to guides
  /docs/api/                 API reference
  /docs/cli                  CLI reference
  /docs/errors               Error code reference (LMN-xxxx)
  /blog/thesis               "Your AI Doesn't Know What It Knows"
```

Layout: Left sidebar navigation, center content (max 720px), right ToC (sticky). Dark mode by default. [Report #18, Part 3.2]

Three interactive elements that exceed Stripe/Tailwind/Vercel: Interactive claim explorer, "What just happened" blocks, Confidence slider on recall pages. [Report #18, Part 3.2]

---

# PART 6: THE GOVERNANCE
*Sources: Report #3 (Governance Perfection), Report #12 (Security Engineering)*

## Governance as the Moat

No competitor in the cognitive infrastructure space has governance. "Governance" as currently understood (audit trails, RBAC, claim lifecycle) is table stakes. The endgame is governance so deeply embedded that **non-compliance is structurally impossible**. [Report #3, Executive Thesis]

## Regulatory Landscape (2026)

Seven regulatory frameworks converge on AI memory systems: [Report #3, Part 1]

| Framework | Key Requirement | Limen Position | Gap |
|-----------|----------------|----------------|-----|
| **EU AI Act** (enforceable Aug 2, 2026) | Risk classification, traceability, human oversight, data lineage | STRONG (trace events, hash-chained audit) | Auto risk classification, regulatory export formats |
| **GDPR Article 17** | Right to erasure with cascade through derived claims | STRONG (tombstone with cascade re-hash) | Auto PII detection at ingestion, cascading erasure |
| **HIPAA** | Field-level encryption, access logging, minimum necessary | MODERATE (AES-256-GCM vault) | Per-claim encryption for PHI, auto PHI tagging |
| **SOC 2 Type II** (2026 update) | AI governance criteria, bias detection, immutable lineage | STRONG (hash-chained audit, RBAC) | Automated SOC 2 report generation |
| **FINRA 2026** | Prompt/output logging, version tracking, human checkpoints | STRONG (mission lifecycle, trace events) | FINRA-format export |
| **FDA** | Total Product Life Cycle, Good ML Practices | Partial | Medical-specific claim handling |
| **NIST AI RMF** | Risk assessment, testing, transparency | STRONG (governance substrate) | Formal assessment documentation |

**Penalties**: EU AI Act: up to 35M EUR or 7% of global turnover. [Report #3, Part 1.1]

## Security Architecture (STRIDE Analysis)

### Spoofing [Report #12, Part 1.1]
- Agent identity: LOW risk (UUID-based, database-enforced uniqueness)
- Claim attribution: LOW risk (OperationContext from session, not user input)
- Session hijacking: LOW for library mode, HIGH when server mode ships

### Tampering [Report #12, Part 1.1]
- Audit trail: LOW risk (three-layer protection: UPDATE trigger, DELETE trigger, SHA-256 hash chain)
- Claim content: **GAP (SEC-GAP-001)** -- Claims lack database-level immutability triggers on content fields. CCP-I1 enforced at application level only. **Recommendation**: Add BEFORE UPDATE triggers on claim content columns.
- Tenant ID: LOW risk (Migration 013 triggers on all 12 tenant-scoped tables)

### Information Disclosure [Report #12, Part 1.1]
- **SEC-CRIT-001**: SQLite database file on disk is unencrypted. Claim text, audit entries, working memory are plaintext. Vault secrets are encrypted (AES-256-GCM). **Mitigation**: SQLCipher for full database encryption at rest.
- Embedding inversion: HIGH risk when vector search ships. Zero2Text achieves 6.4x higher BLEU-2 scores for inversion WITHOUT training data.

### Denial of Service [Report #12, Part 1.1]
- Query exhaustion: Rate limiting (100/min). No query timeout. **Gap**: Use sqlite3_progress_handler for statement-level abort.
- Working memory flood: Key length validated, capacity policies exist. Total entry count per task not capped.

### Elevation of Privilege [Report #12, Part 1.1]
- Agent self-promotion: Blocked (promote requires higher-trust caller)
- System call boundary: 16 system calls are the ONLY path to mutate state

## Three Critical Security Findings [Report #12, Executive Thesis]

1. **SEC-CRIT-001**: Database file unencrypted on disk. All knowledge exposed via disk access.
2. **SEC-CRIT-002**: TenantScopedConnection passes INSERTs unchanged. Missing tenant_id = row outside scoping.
3. **SEC-CRIT-003**: Claim content not checked for indirect prompt injection. Stored instructions can control future LLM behavior.

## 10 Security Invariants [Report #12, derived]

1. Every mutation audited in same transaction (I-03)
2. Audit trail immutable (triggers block UPDATE/DELETE)
3. Hash chain tamper-detectable (SHA-256, monotonic sequence)
4. Tenant isolation at database level (triggers on 12 tables)
5. Vault secrets encrypted (AES-256-GCM, PBKDF2)
6. Rate limiting per agent (100 API calls/min, token-bucket)
7. Agent identity UUID-based, database-enforced unique
8. System call boundary is sole mutation path
9. Error messages sanitized (no internals exposed)
10. RBAC enforced at OperationContext construction

## Knowledge Poisoning Defense [Report #10, Gap 2.7]

Adversarial knowledge injection is formally recognized: MITRE ATLAS AML.T0080, OWASP ASI06. Microsoft found 50 examples in 60 days of monitoring (February 2026).

**Attack vectors**: [Report #10, Gap 2.7]
1. Malicious agent stores high-confidence false claims
2. Prompt injection causes agent to remember attacker content
3. Auto-extraction stores attacker-injected "facts"
4. Compromised embedding model produces adversarial vectors

**Required defenses**:
- Claim validation scoring: low-trust agents get lower effective confidence regardless of asserted value
- Anomaly detection: alert on claim pattern deviation
- Content sanitization: strip prompt injection patterns before storage
- Quarantine mode: suspicious claims flagged but queryable only with `includeQuarantined: true`

**Priority**: MUST-HAVE before multi-agent deployments. [Report #10, Gap 2.7]

---

# PART 7: THE INTEGRATIONS
*Source: Report #6 (Integration Ecosystem)*

## Current State

6 LLM provider adapters shipped: Anthropic, OpenAI, Google Gemini, Groq, Mistral, Ollama. All implement `ProviderAdapter` interface. [Report #6, Part 1]

## LLM Integration Priorities

| Provider | Key Enhancement | Effort |
|----------|----------------|--------|
| **Claude (Anthropic)** | MCP one-command start, memory tool protocol backing store, extended thinking -> reasoning traces | ~800 LOC |
| **GPT (OpenAI)** | Responses API migration (Assistants deprecated Aug 2026), SQLiteSession bridge | ~800 LOC |
| **Gemini (Google)** | Context caching bridge (90% cost reduction on 2.5+), grounding with claims | ~500 LOC |
| **Ollama** | Model capability detection via `/api/show`, graceful degradation | ~450 LOC |
| **Cohere** | NEW adapter + Rerank 4.0 for post-retrieval quality improvement | ~750 LOC |

[Report #6, Part 1]

## Agent Framework Adapters

| Framework | Interface | Package | Priority |
|-----------|-----------|---------|----------|
| LangChain/LangGraph | `BaseMemory`, `BaseCheckpointSaver`, `BaseRetriever`, `BaseStore` | `@limen-ai/langchain` | MEDIUM |
| LlamaIndex | `QueryEngine`, `Retriever`, `DocumentStore` | `@limen-ai/llamaindex` | MEDIUM |
| CrewAI | Memory callbacks (short/long/entity/context) | `@limen-ai/crewai` | MEDIUM |
| Vercel AI SDK | `tool()` definitions, context middleware | `@limen-ai/vercel` | LOW |
| OpenAI Agents SDK | Tool schemas, session memory | `@limen-ai/openai-agents` | LOW |
| AutoGen | `MemoryStore`, `ChatCompletionContext` | `@limen-ai/autogen` | LOW |

**Engineering Assessment recommendation** [Report #7, Part 6]: Do NOT build framework-specific adapters. MCP is the integration layer. Let the community build adapters. Ship MCP + TypeScript API.

## Protocol Support

| Protocol | Status | Enhancement |
|----------|--------|-------------|
| **MCP** (Model Context Protocol) | SHIPPED (19 tools) | Add Streamable HTTP transport, `.well-known/mcp.json`, Tasks primitive mapping |
| **A2A** (Agent-to-Agent) | NOT BUILT | Agent Cards declaring Limen capabilities, task negotiation |
| **OpenAI Function Calling** | Via adapter | Auto-generate `strict: true` schemas from Limen API |
| **Tool Use (Anthropic)** | Via MCP | Auto-generate tool_use blocks |

[Report #6, Part 3]

## Plugin Architecture (3-Layer Adapter System)

```
Layer 3: Framework Adapters    (LangChain memory, CrewAI callbacks)
Layer 2: Provider Adapters     (LLM transport, embedding providers)
Layer 1: Storage Adapters      (SQLite, Turso, PostgreSQL)
```

All adapters implement well-defined interfaces. Core never imports adapter code. Adapters discover and adapt to the environment. [Report #6, Part 7]

---

# PART 8: THE ENGINEERING STANDARD
*Source: Report #9 (Engineering Excellence Spec)*

## The Bar

SQLite: 155,800 lines of source, 92 million lines of test (590:1 ratio), 100% branch coverage, 100% MC/DC, 6,754 assert statements, zero known production bugs, continuous development since 2000. That is the bar. [Report #9, Preamble]

## Zero Tolerance List [Report #9, Part 1.1]

| Rule | Enforcement |
|------|-------------|
| Zero `any` | `@typescript-eslint/no-explicit-any` |
| Zero `as` type assertions | `@typescript-eslint/consistent-type-assertions` (exception: brand factories) |
| Zero `!` non-null assertions | `@typescript-eslint/no-non-null-assertion` |
| Zero `// @ts-ignore` | `@typescript-eslint/ban-ts-comment` |
| Zero `console.log` | `no-console` (use structured logger) |
| Zero unhandled promise rejections | `@typescript-eslint/no-floating-promises` |
| Zero unused imports/variables | `@typescript-eslint/no-unused-vars` |
| Zero circular dependencies | `eslint-plugin-import/no-cycle` |

## Type System [Report #9, Part 2]

- **Branded types** for domain identifiers (`ClaimId`, `MissionId`, `SubjectUrn`, `Confidence`) at zero runtime cost
- **Discriminated unions** with exhaustive `switch` matching (default: never)
- **Immutable interfaces** with `readonly` on every property
- **Result type** for expected failures: `{ ok: true; value: T } | { ok: false; error: E }`

## SQL Standards [Report #9, Part 3]

- Prepared statements ONLY. No string interpolation. No template literals.
- All dynamic values via parameter binding (security invariant)
- Statements created at initialization and cached
- `db.exec()` ONLY for DDL/PRAGMA, never for data operations

## Testing Standards [Report #9, Part 4]

**Test pyramid target**: Unit (70%) / Integration (25%) / E2E (5%)

**Performance targets**:

| Metric | Target | Source |
|--------|--------|--------|
| remember latency | <10ms | Report #1, Part D4 |
| recall latency | <20ms | Report #1, Part D4 |
| FTS5 search latency | <50ms | Report #1, Part D4 |
| startup time | <100ms | Report #9 |
| Test suite duration | <30s | Report #9 |

## Function Design Rules [Report #9, Part 1.5]

1. Single responsibility
2. Maximum 40 lines of logic
3. Maximum 4 parameters (use options object for more)
4. Pure when possible (separate queries from commands)
5. Explicit return types on every export
6. Named exports only (no default exports)

---

# PART 9: THE RELEASE STRATEGY
*Source: Report #15 (Release Strategy)*

## v1.3.0 "WOW" (2-3 weeks)

**Theme**: "3 lines to remember. Governance underneath."

| # | Feature | Effort |
|---|---------|--------|
| 1 | `limen.remember()` | 2 days |
| 2 | `limen.recall()` | 2 days |
| 3 | `limen.connect()` | 1 day |
| 4 | `limen.forget()` | 0.5 day |
| 5 | `limen.reflect()` | 1 day |
| 6 | `limen.session.open/close` | 1 day |
| 7 | FTS5 Full-Text Search | 3 days |
| 8 | Raise MCP value limit (500 -> 5000) | 0.25 day |
| 9 | Bulk recall MCP tool | 1 day |
| 10 | `reasoning` column on claims | 1 day |
| 11 | Knowledge-first README | 1 day |
| 12 | 3 new examples | 1 day |
| 13 | npm package.json rewrite | 0.25 day |
| 14 | Import/Export CLI | 2 days |

**Total**: ~17 days

**What gets CUT**: Vector search, auto-extraction, graph traversal, temporal queries, conflict detection, health score, framework integrations. All deferred to v1.4.0+. [Report #15, Tier 1]

## v1.4.0 "COMMIT" (2-3 months from v1.3.0)

**Theme**: "The features nobody else has."

| # | Feature | Effort |
|---|---------|--------|
| 15 | Semantic vector search (sqlite-vec) | 5 days |
| 16 | Hybrid search (FTS5 + vector) | 3 days |
| 17 | Temporal queries (asOf, history) | 3 days |
| 18 | Claim decay function (query-time) | 2 days |
| 19 | Conflict detection (auto on remember) | 3 days |
| 20 | Knowledge graph traversal | 4 days |
| 21 | Knowledge health score | 3 days |
| 22 | Context builder | 3 days |
| 23 | Session context builder MCP tool | 2 days |
| 24 | Narrative memory | 2 days |
| 25 | Freshness tracking | 2 days |
| 26 | Quality gates | 3 days |
| 27 | Temporal validity windows (invalidAt) | 2 days |
| 28 | Tool definitions export | 2 days |
| 29 | Event system | 2 days |
| 30 | Access-frequency tracking | 2 days |
| 31 | Performance benchmarks | 3 days |
| 32 | Published API reference | 1 day |
| 33 | 6 new examples | 2 days |
| 34 | Backup/restore utility | 1 day |

**Total**: ~48 days [Report #15, Tier 2]

## v2.0.0 "DEPEND" (6 months)

**Theme**: "The platform you can bet your company on."

Key additions: Python binding, natural language recall, auto-extraction pipeline, cross-agent knowledge transfer, claim visualization (limen-ui), edge deployment (D1/Turso). [Report #7, Part 6; Report #15, Tier 3]

## v3.0.0 "FUTURE" (1+ year)

Key additions: Distributed sync layer, federation protocol, cognitive consolidation engine, belief layer (derived claims), privacy-preserving reasoning. [Report #11, Part 8.4; Report #15]

## The Anti-List (Never Build)

1. PostgreSQL backend before 100K claims in any deployment [Report #7, Part 6]
2. Framework-specific adapters (MCP is the integration layer) [Report #7, Part 6]
3. Custom embedding model [Report #7, Part 6]
4. Browser WASM before Python [Report #7, Part 6]
5. Belief layer without empirical validation [Report #7, Part 6]
6. Automatic classification at assertion time (100-500ms latency) [Report #7, Part 6]

---

# PART 10: THE OPERATIONAL PLAN
*Source: Report #16 (Operational Gaps)*

## Migration from v1.2.0

Current state: 670 claims, 3,188 tests, 134 invariants, 16 system calls, 19 MCP tools, 27 migrations, ~45 tables. [Report #16, Gap 2]

**Migration strategy**: Expansion-only approach. Exclusively `ALTER TABLE ADD COLUMN` and `CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS`. No table recreation, no column removal, no constraint modification. `ALTER TABLE ADD COLUMN` in SQLite is O(1). 670 claims migrate in <1ms. [Report #16, Gap 2]

**New schema elements for v1.3.0+**: [Report #16, Gap 2]

| Feature | Schema Change | Type |
|---------|---------------|------|
| FTS5 search | `claim_assertions_fts` virtual table | NEW TABLE |
| FTS5 sync | INSERT/DELETE triggers | NEW TRIGGERS |
| Embedding vectors | `embedding BLOB` column | ALTER TABLE |
| Embedding model ID | `embedding_model TEXT` column | ALTER TABLE |
| Decay rate | `decay_rate REAL DEFAULT 1.0` | ALTER TABLE |
| Access tracking | `last_accessed_at TEXT`, `access_count INTEGER DEFAULT 0` | ALTER TABLE |
| Reasoning | `reasoning TEXT` column | ALTER TABLE |
| Auto-category | `auto_category TEXT` column | ALTER TABLE |

## Performance Overhead Budget

All new features must stay within these budgets: [Report #7, Part 1; Report #16]

| Operation | Current | Budget (with FTS5) | Budget (with vectors) |
|-----------|---------|--------------------|-----------------------|
| claim assertion | <5ms | <7ms (+2ms FTS5 trigger) | <12ms (+5ms embedding) |
| claim query | <2ms | <5ms (FTS5 JOIN) | <10ms (vector similarity) |
| recall (convenience) | N/A | <20ms | <20ms |
| search (FTS5) | N/A | <50ms | <50ms |

## Data Portability (7 Formats)

Export formats specified: [Report #16; Report #1, Part 5.6]

1. **JSON** -- Full claim data with metadata
2. **JSON-LD** -- Schema.org compatible predicates
3. **CSV** -- Flat claim data for spreadsheets
4. **Markdown** -- Human-readable knowledge base
5. **SQLite** -- Raw database file copy
6. **Limen-native** -- Optimized format for Limen-to-Limen transfer
7. **N-Triples** -- RDF-compatible for knowledge graph interop

## Export/Import Guarantees

- Export preserves: claim IDs, relationships, confidence, timestamps, evidence refs, reasoning chains
- Import deduplicates by claim ID
- Cross-instance import creates new IDs with `imported_from` metadata
- Hash chain continuity verified on import
- Export/import is atomic (all-or-nothing via transaction)

---

# PART 11: THE SCALE PLAN
*Source: Report #11 (Distributed Systems Research)*

## Distributed Architecture

See Part 3 for the full architecture. Key points summarized:

**Sync protocol**: Event-sourced change feed over WebSocket (primary) with HTTP polling fallback. Hybrid Logical Clocks for causal ordering. [Report #11, Part 5.3]

**Conflict resolution**: NOT last-write-wins. Both conflicting claims exist. `contradicts` relationship auto-created. Governance resolves. [Report #11, Part 8.2]

**Technology choices**: [Report #11, Part 8.2]

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Local storage | better-sqlite3 or libSQL | Zero-config preserved |
| Sync protocol | Custom over WebSocket | Optimized for claim tuples |
| Causality | Hybrid Logical Clocks | Bounded size, causal ordering |
| Sync service storage | PostgreSQL | Production-grade, JSONB, RLS |
| Message routing | NATS (embedded mode) | 18M msgs/sec, single binary |
| Federation | gRPC over mTLS | Bidirectional streaming, strong typing |
| Encryption | AES-256-GCM + X25519 | Native Node.js crypto |

**Phased delivery**: [Report #11, Part 8.4]
- Phase 0 (Current): Single-node
- Phase 1 (Sync-Ready): Add sync metadata columns + sync log table
- Phase 2 (Sync Client): Bidirectional claim flow
- Phase 3 (Sync Service): Separate package `@solishq/limen-sync`
- Phase 4 (Federation): Cross-org knowledge sharing
- Phase 5 (Intelligence): Pattern detection, emergent knowledge

**6 Invention Opportunities**: [Report #11, Part 9.1]
1. Governed distribution (no competitor has it)
2. Epistemic CRDTs (CRDT for claims with confidence and lifecycle)
3. Governance-aware replication (propagate by trust, not just subscription)
4. Crypto-shredding for knowledge graphs (cross-reference-safe)
5. Distributed audit trails (Merkle DAG)
6. Stigmergic knowledge propagation (attention-weighted)

## Security at Scale [Report #11, Part 7]

| Threat | Mitigation |
|--------|------------|
| Eavesdropping | TLS 1.3 for all sync, mTLS service-to-service |
| Claim injection | Agent authentication, trust levels gate propagation |
| Replay attack | Monotonic event IDs, deduplication at sync service |
| Tenant leakage | Tenant-scoped encryption keys |
| Data sovereignty | Geo-fencing, jurisdiction tags, routing rules |
| Privilege escalation | Trust changes require sync service authorization |
| Compromised node | At-rest encryption, remote wipe via sync service |

## GDPR at Scale [Report #11, Part 7.3]

Crypto-shredding: Each data subject gets a unique encryption key. Delete the key = all copies across all replicas permanently unreadable. No coordinated deletion required.

---

# PART 12: THE GAPS REGISTER
*Sources: Report #10 (Gap Analysis -- 47 gaps), Report #17 (Final Audit -- 15 findings)*

## All Identified Gaps (Combined from Both Audits)

### MUST-HAVE Gaps (Block Enterprise Readiness)

| # | Gap | Source | Status |
|---|-----|--------|--------|
| 2.1 | Database corruption recovery | Report #10, Cat 2 | OPEN -- needs `verify()`, `repair()`, corruption in health check |
| 2.2 | Embedding model degradation detection | Report #10, Cat 2 | OPEN -- needs `embedding_model_id` per vector, startup validation |
| 2.4 | PII remediation (retroactive scan + purge) | Report #10, Cat 2 | OPEN -- needs `scanForPII()`, contamination tracing, atomic purge |
| 2.5 | Claim graph cycle prevention | Report #10, Cat 2 | OPEN -- HARD BLOCK on `supersedes`/`derived_from` cycles, WARN on `supports` |
| 2.6 | Storage exhaustion handling | Report #10, Cat 2 | OPEN -- needs monitoring, configurable limit, graceful degradation |
| 2.7 | Knowledge base poisoning defense | Report #10, Cat 2 | OPEN -- validation scoring, anomaly detection, content sanitization, quarantine |
| 3.1 | Observability and debugging | Report #10, Cat 3 | OPEN -- query explain, retrieval trace, knowledge diff, embedding inspector |
| 3.3 | Schema version compatibility | Report #10, Cat 3 | OPEN -- version check at startup, additive-only migrations, compatibility matrix |
| 3.4 | Cost management / TCO modeling | Report #10, Cat 3 | OPEN -- model per-operation LLM costs before shipping auto-extraction |
| 4.1 | LLM provider competitive positioning | Report #10, Cat 4 | OPEN -- value prop EVEN WHEN provider has native memory |
| 5.1 | Consent and ethical knowledge modeling | Report #10, Cat 5 | OPEN -- consent mechanisms for being modeled by AI |
| 6.2 | Confidence propagation rules | Report #10, Cat 6 | OPEN -- Bayesian propagation through relationship chains |
| 6.4 | Testing infrastructure for users | Report #10, Cat 6 | OPEN -- `createTestLimen()`, assertion helpers, retrieval quality benchmarks |
| 6.5 | Internationalization (FTS5 tokenizer) | Report #10, Cat 6 | OPEN -- default to `unicode61`, multilingual embedding model option |
| 7.1 | Open source sustainability model | Report #10, Cat 7 | OPEN -- monetization decision needed |
| 8.1 | Community building strategy | Report #10, Cat 8 | OPEN -- Discord, blog, conference talks, contributor guidelines |
| 17.1 | AWS Bedrock AgentCore Memory as competitive threat | Report #17, Finding #1 | OPEN -- fully managed enterprise AI memory exists NOW |
| 17.2 | Cold start problem | Report #17, Finding #2 | OPEN -- bootstrap templates, demo mode, first-claim celebration |
| 17.3 | Knowledge quality metrics (KQS) | Report #17, Finding #3 | OPEN -- 6-dimension quality score |

### SHOULD-HAVE Gaps (Important for Growth)

| # | Gap | Source | Status |
|---|-----|--------|--------|
| 1.2 | Compliance officer interface | Report #10, Cat 1 | OPEN |
| 1.3 | End-user data access interface (GDPR Art 15) | Report #10, Cat 1 | OPEN |
| 3.2 | Migration path specification (SQLite -> PostgreSQL) | Report #10, Cat 3 | OPEN (architecture doc needed) |
| 3.5 | Point-in-time recovery | Report #10, Cat 3 | OPEN |
| 5.2 | Right to explanation (human-meaningful) | Report #10, Cat 5 | OPEN |
| 6.1 | Multi-modal knowledge | Report #10, Cat 6 | OPEN |
| 6.3 | Meta-knowledge API | Report #10, Cat 6 | OPEN |
| 8.2 | Plugin architecture documentation | Report #10, Cat 8 | OPEN |
| 8.4 | Education and training content | Report #10, Cat 8 | OPEN |

### NICE-TO-HAVE Gaps (Future Value)

| # | Gap | Source | Status |
|---|-----|--------|--------|
| 1.1 | Python SDK / data science personas | Report #10, Cat 1 | OPEN |
| 1.4 | Enterprise evaluation artifacts (ADRs, TCO, DR runbooks) | Report #10, Cat 1 | OPEN |
| 2.3 | Distributed conflict resolution design | Report #10, Cat 2 | ADDRESSED by Report #11 |
| 4.2 | Competitive landscape monitoring cadence | Report #10, Cat 4 | OPEN |
| 5.3 | Content policy engine | Report #10, Cat 5 | OPEN |
| 7.2 | Cloud pricing model | Report #10, Cat 7 | OPEN |
| 7.3 | Enterprise contract structure | Report #10, Cat 7 | OPEN |
| 8.3 | Standards body participation | Report #10, Cat 8 | OPEN |

## The Five Most Dangerous Gaps [Report #10, Conclusion]

1. **Knowledge Base Poisoning** -- Auto-extraction and auto-connection AMPLIFY poisoning
2. **No Testing Infrastructure** for downstream developers -- 3,200+ tests for Limen itself, zero tools for users
3. **No Observability** -- Cannot debug why wrong claims were returned
4. **Internationalization Neglect** -- FTS5 tokenizer choice in v1.3.0 affects all future releases
5. **Business Sustainability** -- No revenue model. Apache 2.0 allows unrestricted forking.

---

# PART 13: THE TECHNOLOGY STACK
*Source: Report #8 (Bleeding Edge Tech Research)*

## Optimal Technology for Each Layer

| Layer | Technology | Why | Evidence |
|-------|-----------|-----|----------|
| **Storage** | SQLite + sqlite-vec + FTS5 | Zero-dependency, proven at scale, vectors and text search in one DB | Confirmed |
| **Indexing** | FTS5 (text) + sqlite-vec HNSW (vector) + recursive CTEs (graph) | Three retrieval modalities, no external dependencies | Confirmed |
| **Embedding** | EmbeddingGemma-300M (primary) + ONNX fallback (nomic-embed 40MB) | 768-dim with Matryoshka to 128, sub-200MB, 100+ languages | Confirmed |
| **Quantization** | Matryoshka 256-dim + INT8 (256 bytes/claim) or 2-bit (64 bytes/claim) | 12-48x storage reduction, 95-98% quality | Confirmed |
| **Retrieval** | Adaptive RAG Router | Route by complexity: exact->FTS5->vector->graph->iterative | Confirmed |
| **Self-Correction** | CRAG-inspired retrieval evaluator | Assess quality using confidence and grounding modes | Likely |
| **Knowledge Rep** | Governed claims with temporal validity + causal relationships | Beyond triples: confidence, temporal anchors, evidence chains | Confirmed (partial) |
| **Self-Organization** | Cognitive Consolidation Engine (CLS-inspired) | Periodic consolidation of episodic to semantic | Theoretical |
| **Memory Model** | CLS-inspired three-tier: Working Memory / Episodic / Semantic | With consolidation and activation-based retrieval | Likely |
| **Graph** | Recursive CTE traversal + RAPTOR-style hierarchical summaries | Multi-hop reasoning + tree-organized summaries | Confirmed |

[Report #8, Part 8]

## sqlite-vec Assessment [Report #7, Part 1.4]

- Pure C, zero dependencies, prebuilt binaries for macOS/Linux/Windows, WASM available
- npm package `sqlite-vec` 0.1.7-alpha.2 -- last published ~1 year ago (**concern**)
- Loads via `db.loadExtension()` in better-sqlite3
- **Does break I-01** (single dependency). Options: (A) amend I-01, (B) optional peer dependency, (C) use provider embedding API, (D) bundle WASM
- **Recommendation**: Option B (optional peer dependency). Core remains 1 dep. Vector search requires `npm install sqlite-vec`.

## Embedding Model Strategy [Report #7, Part 1.4; Report #8, Part 6]

- **Local**: nomic-embed-text-v1.5 via Ollama (550MB, 5K-9K tokens/sec on Apple Silicon)
- **Optimal local**: EmbeddingGemma-300M (308M params, 768-dim, sub-200MB, 100+ languages, sub-22ms inference)
- **Remote**: OpenAI text-embedding-3-small ($0.02/1M tokens)
- **Architecture**: Pluggable `EmbeddingProvider` interface. Ship Ollama + OpenAI providers. Default to Noop (no vectors unless configured).

## Storage Comparison at Scale

Per claim embedding at 768 dimensions: [Report #8, Part 6.3]

| Precision | Storage | Quality | Ratio |
|-----------|---------|---------|-------|
| FP32 | 3,072 bytes | 100% | 1x |
| INT8 | 768 bytes | ~98% | 4x |
| 2-bit | 192 bytes | 95-98% | 16x |
| Matryoshka 128-dim + 2-bit | 32 bytes | ~88% | 96x |

At 32 bytes/embedding, 1M claims = 32MB. Feasible within SQLite. [Report #8, Part 6.3]

---

# PART 14: CROSS-REPORT CONTRADICTIONS

## Contradiction 1: Convenience API Surface

**Report #1** (Complete Feature Spec): `limen.remember(subject, predicate, value, options?)` -- three required parameters.
**Report #15** (Release Strategy): Same signature.
**Report #7** (Engineering Assessment): `limen.remember(text, options?)` with auto-generated subject -- one required parameter.

**Resolution**: Report #7's single-parameter form is for the simplest use case (auto-generated subject). Report #1's three-parameter form is for structured use. Both should exist. `limen.remember("fact")` auto-generates. `limen.remember("user:alice", "preference.food", "Thai")` uses explicit structure. [Report #7, Part 4]

## Contradiction 2: sqlite-vec as Dependency

**Report #1** (Complete Feature Spec): "sqlite-vec is a SQLite extension that can be compiled to WASM. It adds vector operations without requiring a second database."
**Report #7** (Engineering Assessment): "YES. Adding sqlite-vec to dependencies breaks Invariant I-01 as currently stated."
**Report #8** (Bleeding Edge): "sqlite-vec is the right choice for vector search."

**Resolution**: Optional peer dependency. Core keeps 1 dep. Users who want vectors run `npm install sqlite-vec`. The API gracefully degrades: vector search unavailable without sqlite-vec, FTS5 provides keyword search. [Report #7, Part 1.4]

## Contradiction 3: Domain Detection Feasibility

**Report #4** (Cognitive Architecture): Domain detection via predicate namespace analysis is "trivial to implement" and "CONFIRMED."
**Report #7** (Engineering Assessment): "NOT FEASIBLE as automatic detection. A library cannot infer that it's being used for 'healthcare compliance' vs 'e-commerce analytics.'"

**Resolution**: Report #4 is correct for predicate-based domain (trivial). Report #7 is correct for semantic domain (requires user input). Offer domain-specific presets: `createLimen({ preset: 'research' })`. [Report #7, Part 1.3]

## Contradiction 4: Framework Adapters

**Report #6** (Integration Ecosystem): Detailed specifications for 10 framework adapters with LOC estimates.
**Report #7** (Engineering Assessment): "Do NOT build framework-specific adapters. MCP is the integration layer."

**Resolution**: Report #7 is the pragmatic position for a solo founder. MCP first. Community builds adapters. SolisHQ provides adapter templates and documentation. Framework adapters are v2.0.0+ if demand warrants. [Report #7, Part 6]

## Contradiction 5: Auto-Extraction Architecture

**Report #1** (Complete Feature Spec): "Configurable: inline extraction, disabled by default."
**Report #7** (Engineering Assessment): "Automatic classification at assertion time... NOT FEASIBLE as synchronous operation."
**Report #10** (Gap Analysis): "Auto-extraction costs $3,000/day at enterprise scale."

**Resolution**: Auto-extraction must be (a) async, (b) opt-in, (c) cost-modeled. Implement as session hook, not pipeline phase. Disabled by default. Cost warning in documentation. [Report #7, Part 1.1; Report #10, Gap 3.4]

## Contradiction 6: Consolidation: Automatic vs User-Triggered

**Report #4** (Cognitive Architecture): "Background consolidation process analogous to sleep-replay."
**Report #5** (Superpowers): "YES -- but as a deliberate, user-triggered operation."
**Report #7** (Engineering Assessment): "A library should not run background tasks unless explicitly configured."

**Resolution**: User-triggered for v1.x. Background consolidation only when explicitly configured. `limen_consolidate()` as MCP tool for manual use. Automatic consolidation deferred to v2.0.0 with opt-in configuration. [Report #5, Capability E; Report #7, Part 1.2]

## Contradiction 7: Distributed Conflict Resolution

**Report #10** (Gap Analysis): "The research mentions CRDTs nowhere despite proposing distributed claims."
**Report #11** (Distributed Systems): Extensive CRDT analysis, concluding "Limen's EXISTING claim model is already CRDT-compatible."

**Resolution**: Report #11 was written AFTER Report #10 and directly addresses this gap. The gap is now CLOSED. Limen's immutable claims with relationship-based versioning are naturally CRDT-compatible. [Report #11, Part 1.2]

## Contradiction 8: Python Priority

**Report #7** (Engineering Assessment): "Python binding: HIGH priority. The ML/AI ecosystem is Python-first."
**Report #10** (Gap Analysis): "Python SDK: NICE-TO-HAVE (v2.0+)."

**Resolution**: Both are correct at different time horizons. Python is HIGH priority for the product but should NOT be built before the TypeScript product is complete. v2.0.0 target. [Report #7, Part 5]

---

# PART 15: THE IMPLEMENTATION ROADMAP

## Synthesized from All Reports

### Phase 1: v1.3.0 "WOW" -- Weeks 1-3

**Goal**: Make Limen usable by any developer in 60 seconds.

| Week | What Gets Built | Source Report |
|------|----------------|--------------|
| 1 | `remember()`, `recall()`, `connect()`, `forget()`, `reflect()` -- programmatic convenience API (thin wrappers over ClaimApi) | Reports #1, #7, #15 |
| 1 | `session.open/close` programmatic API | Reports #1, #15 |
| 1 | `reasoning` column on claims (additive migration) | Reports #5, #15, #19 |
| 1 | Raise MCP value limit 500 -> 5000 chars | Report #15 |
| 2 | FTS5 virtual table + sync triggers + `search()` API | Reports #1, #7, #15, #16 |
| 2 | FTS5 tokenizer: `unicode61` default for i18n | Report #10, Gap 6.5 |
| 2 | Bulk recall MCP tool | Report #15 |
| 3 | Import/Export CLI (`limen export --format json`) | Reports #1, #15 |
| 3 | Knowledge-first README rewrite | Reports #1, #15, #18 |
| 3 | 3 new examples (remember-recall, search, relationships) | Reports #1, #15 |
| 3 | npm package.json rewrite (description, keywords) | Reports #15, #18 |
| 3 | Social preview image (1280x640) | Report #18 |

**Dependencies**: FTS5 depends on convenience API. README depends on all features. Examples depend on all features.

**Definition of Done**: [Report #15, Tier 1 DoD]
- All new APIs work programmatically
- FTS5 syncs via triggers, search returns ranked results
- `reasoning` column indexed by FTS5
- All 3,200+ existing tests pass
- New tests for every new surface
- CHANGELOG with migration notes

### Phase 2: v1.4.0 "COMMIT" -- Months 2-4

**Goal**: Ship features no competitor has.

| Priority | Features | Source |
|----------|----------|--------|
| P0 | sqlite-vec integration (optional peer dep), hybrid search (FTS5 + vector) | Reports #7, #8, #15 |
| P0 | Temporal queries (asOf, history), claim decay (query-time) | Reports #1, #4, #15 |
| P0 | Conflict detection (auto on remember), knowledge graph traversal | Reports #1, #7, #15 |
| P1 | Knowledge health score, freshness tracking | Reports #1, #5, #15, #17 |
| P1 | Context builder, session context builder MCP tool | Reports #1, #15 |
| P1 | Event system (`limen.on('claim.asserted', cb)`) | Reports #7, #15 |
| P1 | Narrative memory (session arc on close, inject on open) | Report #5 |
| P1 | Quality gates (validation hooks on assertion) | Report #5 |
| P1 | Access-frequency tracking, temporal validity windows | Reports #7, #15 |
| P2 | Tool definitions export, backup/restore utility | Reports #1, #15 |
| P2 | Performance benchmarks (published), API reference (TypeDoc) | Reports #1, #15 |
| P2 | 6 new examples, claim graph cycle prevention | Reports #10, #15 |
| P2 | Schema version compatibility check at startup | Report #10, Gap 3.3 |

**Critical architectural decisions for v1.4.0**: [Report #7, Part 6]
1. sqlite-vec is optional peer dependency
2. Embedding provider is pluggable with Noop default
3. Convenience API auto-generates subjects by default, allows override
4. Decay computed at query time, not stored

### Phase 3: v2.0.0 "DEPEND" -- Months 5-8

| Features | Source |
|----------|--------|
| Python binding (native library, same SQLite schema) | Reports #7, #10 |
| Natural language recall (FTS5-powered) | Report #1 |
| Auto-extraction pipeline (async, opt-in) | Reports #1, #7 |
| Self-healing knowledge (cascade on retraction) | Report #5 |
| Confidence calibration (per-agent curves) | Report #5 |
| Knowledge metabolism (user-triggered consolidation) | Reports #4, #5 |
| Promise accountability (predict/outcome/calibration) | Report #5 |
| Agent specialization (reliability scoring) | Report #5 |
| Curiosity engine (knowledge gap detection) | Report #5 |
| Database encryption at rest (SQLCipher) | Report #12, SEC-CRIT-001 |
| Compliance officer interface (read-only dashboard) | Report #10, Gap 1.2 |
| Testing infrastructure for users (createTestLimen, assertion helpers) | Report #10, Gap 6.4 |

### Phase 4: v3.0.0 "FUTURE" -- Months 9-18

| Features | Source |
|----------|--------|
| Sync-ready schema (additive columns for distribution) | Report #11 |
| Sync client (bidirectional claim flow) | Report #11 |
| Sync service (`@solishq/limen-sync`) | Report #11 |
| Adaptive RAG Router | Report #8 |
| RAPTOR-style hierarchical claim summaries | Report #8 |
| Cognitive Consolidation Engine (background, opt-in) | Reports #4, #8 |
| Activation-based retrieval (ACT-R inspired) | Reports #4, #8 |
| Federation protocol (cross-org) | Report #11 |
| Edge deployment (Turso/D1) | Reports #7, #11 |
| Multi-modal knowledge support | Report #10, Gap 6.1 |

## The Critical Path

```
v1.3.0 ─── Convenience API ──┬── FTS5 ──── README ──── Ship
                              |
v1.4.0 ─── sqlite-vec ───────┤
           Temporal queries ──┤
           Conflict detection ┤
           Knowledge health ──┤
           Graph traversal ───┤
           Event system ──────┘── Hybrid Search ── Ship
                              |
v2.0.0 ─── Python binding ───┤
           Auto-extraction ───┤
           Self-healing ──────┤
           Encryption ────────┘── Ship
                              |
v3.0.0 ─── Sync schema ──── Sync client ──── Sync service ── Federation ── Ship
```

## The Honest Ceiling [Report #7, Part 6]

Limen will not serve billions of claims as a single SQLite file. It will serve millions -- which is more than enough for 99% of use cases. The architecture supports a future storage backend swap without rebuilding the governance layer, which is the part that matters.

Build the product people need today. Architect for the product they will need tomorrow. Do not build tomorrow's product today.

---

## APPENDIX A: SOURCE REPORT INDEX

| # | Report | File | Primary Contribution |
|---|--------|------|---------------------|
| 1 | Complete Feature Spec | LIMEN_COMPLETE_FEATURE_SPEC.md | Full feature matrix (22 features), competitive comparison |
| 2 | Developer Experience Spec | LIMEN_DEVELOPER_EXPERIENCE_SPEC.md | Developer journey, onboarding analysis |
| 3 | Governance Perfection | LIMEN_GOVERNANCE_PERFECTION.md | 7 regulatory frameworks, self-governing architecture |
| 4 | Cognitive Architecture Research | LIMEN_COGNITIVE_ARCHITECTURE_RESEARCH.md | 7 cognitive primitives, FSRS decay, CLS theory, AGI readiness |
| 5 | Superpowers as Features | LIMEN_SUPERPOWERS_AS_FEATURES.md | 14 superpowers + 5 capabilities evaluation |
| 6 | Integration Ecosystem | LIMEN_INTEGRATION_ECOSYSTEM.md | 6 LLM providers, 10 frameworks, 4 protocols |
| 7 | Engineering Assessment | LIMEN_ENGINEERING_ASSESSMENT.md | Technical feasibility, scaling analysis, architectural decisions |
| 8 | Bleeding Edge Tech Research | LIMEN_BLEEDING_EDGE_TECH_RESEARCH.md | 80+ technologies, optimal stack, 8 invention opportunities |
| 9 | Engineering Excellence Spec | LIMEN_ENGINEERING_EXCELLENCE_SPEC.md | Code standards, type system, SQL standards, testing |
| 10 | Gap Analysis | LIMEN_GAP_ANALYSIS.md | 47 gaps across 8 categories |
| 11 | Distributed Systems Research | LIMEN_DISTRIBUTED_SYSTEMS_RESEARCH.md | CRDTs, sync architecture, 3-layer deployment, federation |
| 12 | Security Engineering | LIMEN_SECURITY_ENGINEERING.md | STRIDE + LINDDUN, 3 critical findings, 10 invariants |
| 13 | Interface Design | LIMEN_INTERFACE_DESIGN.md | CLI grammar, color semantics, error anatomy, MCP output |
| 14 | Thesis | LIMEN_THESIS.md | The one sentence, ontological gap, intellectual genealogy |
| 15 | Release Strategy | LIMEN_RELEASE_STRATEGY.md | v1.3.0/v1.4.0/v2.0.0/v3.0.0 phased plan |
| 16 | Operational Gaps | LIMEN_OPERATIONAL_GAPS.md | Migration plan, performance budget, portability |
| 17 | Final Audit | LIMEN_FINAL_AUDIT.md | 15 findings including AWS threat, cold start, naming |
| 18 | Design Taste | LIMEN_DESIGN_TASTE.md | Brand identity, color, typography, voice, README design |
| 19 | Reasoning Chains + Haystack Protocols | reasoning-chains-protocol.md, haystack-protocol.md | Why reasoning chains matter, institutional memory compounding |

## APPENDIX B: COMPETITIVE POSITION (POST-IMPLEMENTATION)

After v1.4.0, Limen's competitive position: [Report #1, Appendix A; Report #8, Part 8]

| Capability | Limen | Mem0 | Zep | Letta | Cognee | Hindsight |
|------------|-------|------|-----|-------|--------|-----------|
| Simple remember/recall | YES | YES | YES | YES | YES | YES |
| Full-text search | YES (FTS5) | YES | YES | YES | NO | YES |
| Semantic search | YES (sqlite-vec) | YES | YES | NO | YES | YES |
| Knowledge graph | YES | PRO only | YES | NO | YES | YES |
| Temporal queries | YES | NO | YES | NO | NO | YES |
| Auto extraction | YES | YES | YES | YES | YES | YES |
| **Conflict detection** | **YES** | NO | NO | NO | NO | NO |
| **Health scoring** | **YES** | NO | NO | NO | NO | NO |
| **Governance/RBAC** | **YES** | NO | NO | NO | NO | NO |
| **Audit trail (hash-chained)** | **YES** | NO | NO | NO | NO | NO |
| **Multi-tenant** | **YES** | NO | YES | NO | NO | NO |
| **Confidence scores** | **YES** | NO | NO | NO | NO | NO |
| **Evidence chains** | **YES** | NO | NO | NO | NO | NO |
| **Trust levels** | **YES** | NO | NO | NO | NO | NO |
| **Budget enforcement** | **YES** | NO | NO | NO | NO | NO |
| **Working memory** | **YES** | NO | NO | YES | NO | NO |
| MCP server | YES | NO | NO | NO | NO | YES |
| CLI | YES | NO | YES | NO | NO | NO |
| **Single dependency** | **YES** | NO | NO | NO | NO | NO |
| Zero config | YES | YES | NO | NO | YES | NO |
| TypeScript-first | YES | YES | YES | NO | NO | NO |
| Open source (Apache 2.0) | YES | YES | Mixed | Open core | YES | YES |

**Limen YES count: 22/22. Next closest: Zep 11/22.** [Report #1, Appendix A]

---

*This is the definitive specification. After this document, there is no other document to read. Every finding from 19 reports is preserved. Every contradiction is surfaced. Every recommendation is traced to its source.*

*SolisHQ -- We innovate, invent, then disrupt.*
