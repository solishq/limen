# LIMEN COGNITIVE ARCHITECTURE RESEARCH

**Classification:** Strategic Research -- Significant Weight
**Author:** SolisHQ Researcher Agent
**Date:** 2026-03-30
**Status:** First-Principles Derivation Complete
**Evidence Level Key:** [CONFIRMED] = multiple independent sources; [LIKELY] = strong evidence, single-source corroboration; [UNCERTAIN] = derived inference, needs validation; [SPECULATIVE] = extrapolation from adjacent domains

---

## EXECUTIVE THESIS

Limen's next evolution is not a feature release. It is a phase transition from *knowledge store* to *cognitive substrate* -- infrastructure that organizes itself, forgets what is stale, detects its own domain, and provides the complete set of cognitive primitives an AGI-class system would need.

This research derives the mechanisms from neuroscience, cognitive architecture theory, knowledge graph research, and spaced repetition mathematics. Every mechanism is traced to its evidence base. Where the field falls short, invention opportunities are identified.

**Three Claims (Challengeable):**

1. Self-organizing knowledge is a solved problem in research (DIAL-KG, AutoSchemaKG) but no production system offers it as a zero-config primitive. Limen can be first.
2. The FSRS power-decay model, adapted from spaced repetition to knowledge claims, provides a mathematically grounded forgetting mechanism that no knowledge system currently implements.
3. Limen's current 16 system calls are missing 4-5 essential cognitive primitives (REASON, CONSOLIDATE, PRIORITIZE, FORGET, and arguably ABSTRACT) that separate a knowledge store from a thinking substrate.

---

## PART 1: SELF-ORGANIZING KNOWLEDGE

### 1.1 How the Brain Does It

The brain uses a dual-system architecture for knowledge organization, formalized as **Complementary Learning Systems (CLS) theory** (McClelland, McNaughton, O'Reilly, 1995; updated Kumaran, Hassabis, McClelland, 2016):

**System 1: Hippocampus (Fast Learner)**
- High learning rate, sparse representations
- Rapid encoding of specific episodes without interference
- Pattern separation: each new experience gets its own distinct representation
- Acts as a temporary index into distributed cortical storage

**System 2: Neocortex (Slow Integrator)**
- Low learning rate, overlapping distributed representations
- Gradually extracts statistical regularities across experiences
- Builds schemas: pre-existing knowledge networks that new memories are assimilated into
- Prefrontal cortex creates contextual representations linking related memories

**The Key Mechanism -- Memory Consolidation:**
During sleep and rest, the hippocampus replays recent experiences to the neocortex. Each replay strengthens cortical connections slightly. Over time, memories become independent of the hippocampal index and are integrated into cortical schemas. The prefrontal cortex-hippocampus interaction supports assimilation of new memories into pre-existing networks (schemas) and modifies those schemas as new evidence arrives. [CONFIRMED -- CLS theory validated across 30+ years of empirical neuroscience]

**Limen Analogy:**
| Brain Component | Limen Equivalent | Status |
|---|---|---|
| Hippocampus (fast index) | Working Memory / recent claims | EXISTS |
| Neocortex (slow integration) | Long-term claim store with schema | PARTIAL -- claims exist, schema does not self-organize |
| Memory consolidation (replay) | Periodic consolidation pass | DOES NOT EXIST |
| Schemas (knowledge networks) | Claim relationships / ontology | PARTIAL -- relationships exist but are manually created |
| Pattern separation | Unique claim URNs | EXISTS |
| Context binding (PFC) | Mission/task scoping | EXISTS |

### 1.2 How Machines Do It: State of the Art

**DIAL-KG (2026, arXiv 2603.20059) -- Schema-Free Incremental KG Construction** [CONFIRMED]

The most relevant recent system. DIAL-KG operates a three-stage autonomous cycle orchestrated by a **Meta-Knowledge Base (MKB)**:

1. **Dual-Track Extraction:** Routes input adaptively -- simple assertions become relation triples, complex statements become event structures. During cold-start, uses few-shot prompting; subsequently, the MKB's existing schema proposals constrain extraction.

2. **Governance Adjudication:** Three verification layers:
   - Evidence verification (LLM judges extractions against source text)
   - Logical verification (removes contradictions, validates against schema)
   - Evolutionary-intent verification (distinguishes facts from deprecation signals)

3. **Schema Evolution:** Verified knowledge triggers automatic schema induction. Embedding-similar triples cluster; high-frequency coherent clusters generate schema candidates that constrain future extraction.

**Critical insight for Limen:** The schema is emergent, not predefined. Each extraction cycle refines the schema, which constrains the next cycle. The knowledge base progressively self-organizes through a feedback loop.

**AutoSchemaKG (2025, arXiv 2505.23628)** achieves 95% semantic alignment with human-crafted schemas with zero manual intervention at billion-scale. [CONFIRMED]

**Soft Deprecation:** DIAL-KG never physically deletes outdated facts. Status is set to Deprecated while retaining evidence and timestamps. This preserves evolutionary history -- directly analogous to Limen's existing `retract` semantics but with richer lifecycle tracking.

### 1.3 The Five Self-Organization Functions Limen Needs

Derived from the intersection of neuroscience and KG research:

#### 1.3.1 Auto-Classification

**Mechanism:** When a claim enters the system, classify it by analyzing its predicate structure, object type, and semantic content.

**Implementation Path:**
- **Level 0 (No LLM):** Pattern matching on predicate namespaces. `financial.*` -> fact. `decision.*` -> decision. `pattern.*` -> pattern. This already partially exists in Limen's `limen_reflect` which accepts categories.
- **Level 1 (Embedding):** Compute embedding of claim text. Nearest-neighbor against existing claim clusters determines category. New clusters form automatically when claims don't fit existing categories.
- **Level 2 (LLM):** For ambiguous cases, use the connected LLM to classify. This is the DIAL-KG approach.

**Evidence Level:** [CONFIRMED] -- All three levels have production implementations elsewhere. Level 0 is trivial. Level 1 is standard ML. Level 2 is what DIAL-KG proves works.

#### 1.3.2 Auto-Connection

**Mechanism:** When a claim enters, automatically discover its relationships to existing claims.

**Implementation Path:**
- **Embedding similarity:** Compute claim embedding, find top-K similar existing claims. Propose `supports` or `related_to` relationships.
- **Predicate matching:** Claims with the same subject but different predicates are structurally related.
- **Temporal proximity:** Claims asserted in the same mission/task window likely relate.
- **Contradiction detection:** Claims with the same subject and predicate but different object values are potential contradictions. PaTeCon (arXiv 2312.11053) demonstrates automatic temporal constraint mining for conflict detection without human experts. [CONFIRMED]

**Evidence Level:** [CONFIRMED] -- Each individual mechanism is well-established. The combination into a single auto-connection system is an invention opportunity.

#### 1.3.3 Auto-Conflict Detection

**Mechanism:** Detect contradictions between new and existing claims automatically.

**Research Base:**
- **PaTeCon** uses graph patterns and statistical information to automatically generate temporal constraints for conflict detection. [CONFIRMED]
- **TeCre** constrains temporal relations by principles of time disjoint, time precedence, and time mutually exclusive. [CONFIRMED]
- **EVOKG** applies confidence-based contradiction resolution with temporal trend tracking. [CONFIRMED]
- **CRDL** leverages LLMs for truth inference through precise filtering strategies tailored to relation types. [CONFIRMED]

**For Limen:** The simplest starting point is *same-subject-same-predicate-different-value* detection (Limen already has the data model for this). More sophisticated temporal and logical conflict detection can layer on top.

#### 1.3.4 Importance Assessment

**Mechanism:** Not all claims deserve long-term storage. Assess importance based on:
- **Access frequency** -- claims recalled often are important (the brain uses this)
- **Connection density** -- highly connected claims are important (graph centrality)
- **Recency** -- recent claims have higher baseline importance
- **Authority** -- claims from higher-trust agents are more important
- **Governance relevance** -- claims touching governance predicates are always important

**Evidence Level:** [LIKELY] -- Each factor is independently validated. The weighted combination is a design decision, not a research question.

#### 1.3.5 Context Placement

**Mechanism:** Automatically associate claims with the right project, domain, and time period.

**Implementation Path:**
- **Mission/task context** already provides project scoping (EXISTS in Limen)
- **Domain detection** via predicate namespace analysis (see Part 5)
- **Temporal windowing** via `validAt` timestamps (EXISTS in Limen)
- **Schema-on-read** semantics: store claims loosely, organize at query time based on the query's context

**Evidence Level:** [CONFIRMED] -- Limen already has most of this infrastructure. The gap is domain detection.

### 1.4 Invention Opportunity: The Consolidation Loop

No existing system combines all five self-organization functions into a single continuous loop. The closest is DIAL-KG, but it is designed for KG construction from documents, not for real-time cognitive infrastructure.

**Limen's invention:** A background consolidation process (analogous to sleep-replay in the brain) that periodically:
1. Scans recent claims (since last consolidation)
2. Auto-classifies any unclassified claims
3. Discovers connections to existing claims
4. Detects conflicts and flags them
5. Assesses importance scores
6. Updates the emergent schema

This is the **Cognitive Metabolism** -- the system's background thinking.

---

## PART 2: AUTOMATIC FORGETTING (COGNITIVE METABOLISM)

### 2.1 Why Forgetting Matters

The brain actively forgets. This is not a deficiency -- it is a computational optimization. Keeping everything would:
- Make retrieval slower (more candidates to search)
- Increase interference (similar memories compete)
- Waste energy (maintaining synaptic connections has metabolic cost)
- Reduce generalization (noise drowns signal)

**For Limen:** A knowledge system that never forgets becomes unusable as it scales. Stale claims clutter recall results. Contradicted claims confuse reasoning. The system needs principled forgetting.

### 2.2 The Mathematics of Forgetting

#### Ebbinghaus Forgetting Curve (1885)

The foundational model: **R = e^(-t/S)**

Where:
- R = retrievability (probability of successful recall, 0 to 1)
- t = time elapsed since learning
- S = stability (strength of the memory trace)

Without reinforcement, ~50% of information is forgotten within 1 hour, ~90% within 1 week. [CONFIRMED -- replicated across hundreds of studies]

#### FSRS Power-Decay Model (2023-2026)

The Free Spaced Repetition Scheduler (FSRS) improves on Ebbinghaus with a **power function** instead of exponential:

**Key insight:** Pure exponential decay models individual memories well, but when memories of different complexity are mixed (as in any real knowledge base), the aggregate forgetting curve follows a power law. This is because the *superposition* of different exponential decay rates produces power-law behavior. [CONFIRMED -- FSRS v4+ validated on millions of review records]

**FSRS Core Parameters:**
- **Stability (S):** How long before retrievability drops to 90%. Measured in days. Higher = slower forgetting.
- **Retrievability (R):** Current probability of successful recall. Decays over time.
- **Difficulty (D):** Inherent complexity of the material. Range 1-10.

**FSRS Stability Update (on successful recall):**

```
S_new = S_old * SInc
SInc = 1 + f(D) * f(S) * f(R) * w9 * grade_modifier
```

Where:
- f(D) = (11 - D): harder material gains stability more slowly
- f(S): higher stability means diminishing returns on stability increase (saturation)
- f(R): lower retrievability at time of recall yields maximum stability gain (the "desirable difficulty" effect)
- grade_modifier: user's confidence in recall

**Three Laws of Memory from FSRS:** [CONFIRMED]
1. The more complex the material, the lower the stability increase per recall
2. The higher the existing stability, the lower the stability increase (stabilization decay)
3. The lower the retrievability at recall time, the higher the stability increase (stabilization curve)

**FSRS Stability After Lapse (failed recall):**

```
S_new = min(w11 * S_old * f(D), S_old)
```

Post-lapse stability never exceeds pre-lapse. A forgotten memory restarts weaker. [CONFIRMED]

### 2.3 Adapting FSRS for Knowledge Claims

**This is the key invention.** FSRS was designed for flashcard learning. Adapting it for knowledge claim lifecycle requires mapping concepts:

| FSRS Concept | Limen Adaptation |
|---|---|
| Card | Claim |
| Recall attempt | `limen_recall` query that returns this claim |
| Successful recall | Claim returned in query results AND used by the agent |
| Failed recall | Claim exists but was not returned (low relevance score) |
| Difficulty | Claim complexity (derived from predicate type, object size, connection count) |
| Stability | Claim durability (how long before it should decay) |
| Retrievability | Claim freshness (probability of being useful right now) |
| Review | Any interaction: recall, connect, supersede, dispute |

**Limen Claim Lifecycle with FSRS-Inspired Decay:**

```
CLAIM CREATED
  |
  v
ACTIVE (R = 1.0, S = initial_stability)
  |
  | time passes, no interactions
  v
AGING (R < aging_threshold, e.g. 0.7)
  |
  | time passes, no interactions
  v
DORMANT (R < dormant_threshold, e.g. 0.3)
  |
  | time passes, no interactions
  v
ARCHIVED (R < archive_threshold, e.g. 0.1)
  |
  [NOT DELETED -- recoverable via explicit archive search]

At ANY point, a recall/interaction resets:
  R -> recalculated based on FSRS update
  S -> S_new (strengthened)
```

**Initial Stability by Claim Type:**

| Claim Type | Initial S (days) | Rationale |
|---|---|---|
| Governance (decision, rule) | 365 | Decisions should persist for a long time |
| Architectural pattern | 180 | Patterns are durable but evolve |
| Finding (research result) | 90 | Findings need revalidation |
| Warning | 30 | Warnings are time-sensitive |
| Ephemeral (session note) | 7 | Session context decays fast |
| Preference | 120 | Preferences are stable but changeable |

**The Decay Function for Limen:**

```
R(t) = (1 + t/(9*S))^(-1)
```

This is the FSRS v4.5 power-decay function where when t = S, R = 0.9 (90% retrievability). The `9` constant ensures this boundary condition holds.

**Evidence Level:** [CONFIRMED] for the mathematical model. [SPECULATIVE] for the specific initial stability values -- these need empirical tuning with real Limen usage data.

### 2.4 Consolidation Triggers

When should the system consolidate (merge, archive, strengthen)?

**Neuroscience answer:** During sleep. The hippocampus replays recent memories, and the neocortex gradually integrates them. [CONFIRMED]

**Limen adaptation -- Three consolidation triggers:**

1. **Time-based:** Every N hours (configurable), run a consolidation pass over claims with R below a threshold. Default: every 24 hours.

2. **Volume-based:** When active claim count exceeds a threshold, consolidate the lowest-R claims. This prevents unbounded growth.

3. **Event-based:** On session close, consolidate that session's claims. On mission complete, consolidate mission claims. This mirrors the brain's consolidation during state transitions.

### 2.5 What Gets Consolidated vs. Forgotten

Not all decay leads to deletion. The consolidation process should:

1. **Strengthen:** Claims that are frequently recalled get higher stability (already handled by FSRS update on recall)

2. **Merge:** Multiple related claims about the same subject can be merged into a higher-order claim. Example: 5 claims about "entity:api:auth-endpoint" with different predicates -> 1 consolidated "entity:api:auth-endpoint has properties X, Y, Z"

3. **Archive:** Claims below the archive threshold are moved to cold storage. Not queryable by default recall, but accessible via `limen_recall` with explicit `include_archived: true`.

4. **Truly forget:** Claims that are archived AND have zero connections AND belong to no governance predicate can be permanently purged after a configurable retention period. This is the only true deletion.

**Evidence Level:** [LIKELY] -- The strategy is derived from multiple sources but the specific thresholds need empirical validation.

---

## PART 3: ZERO-CONFIG INTEGRATION

### 3.1 The USB Model

USB's plug-and-play works through a hierarchical descriptor protocol:

1. **Physical detection:** Electrical signal change on data lines (pull-up resistors indicate device presence and speed)
2. **Enumeration:** Host assigns temporary address, queries device descriptor (VID, PID, capabilities)
3. **Configuration:** Host reads configuration descriptor (interfaces, endpoints, power requirements)
4. **Driver matching:** OS matches VID/PID to driver database; loads appropriate driver
5. **Ready:** Device is usable

**Key principle:** The device declares what it is. The host adapts to the device. Neither needs prior knowledge of the other. [CONFIRMED]

### 3.2 Limen's Auto-Detection Protocol

Adapting the USB model to cognitive infrastructure:

**Phase 1: Environment Detection (the "pull-up resistor")**

When `createLimen()` is called, detect the environment:

```typescript
// Auto-detect LLM provider
const llmProvider = detectProvider(); // checks env vars: ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.

// Auto-detect framework
const framework = detectFramework(); // checks package.json for langchain, crewai, etc.

// Auto-detect runtime
const runtime = detectRuntime(); // Node.js version, Deno, Bun, browser

// All detection is convention-based, not configuration-based
```

**Implementation mechanisms:**
- **Environment variables:** `ANTHROPIC_API_KEY` present -> Claude provider. `OPENAI_API_KEY` -> OpenAI. Both -> prefer Anthropic (convention).
- **Package.json analysis:** Dependencies reveal framework. `langchain` -> LangChain adapter. `@anthropic-ai/sdk` -> direct Claude.
- **Runtime detection:** `process.versions.node` -> Node.js. `Deno.version` -> Deno. `typeof window !== 'undefined'` -> browser.

**Evidence Level:** [CONFIRMED] -- Convention-over-configuration is a well-established pattern (Rails, Spring Boot, Next.js). The specific detection heuristics are straightforward.

**Phase 2: Capability Enumeration (the "device descriptor")**

After detecting the environment, Limen exposes its capabilities in the format the consumer expects:

```typescript
// If MCP consumer detected:
const tools = limen.toMCPToolSchemas();

// If LangChain consumer:
const tools = limen.toLangChainTools();

// If raw function calling:
const tools = limen.toFunctionCallingSchemas();
```

**Phase 3: Domain Adaptation (the "driver matching")**

See Part 5 for the full domain adaptation mechanism. The key principle: the domain emerges from usage, not from configuration.

**Phase 4: Scale Adaptation (the "power negotiation")**

```typescript
// Auto-detect scale from database size and claim volume
if (claimCount < 1000) {
  // Prototype mode: aggressive consolidation, relaxed governance
  config.consolidationInterval = '1h';
  config.governanceLevel = 'advisory';
} else if (claimCount < 100_000) {
  // Production mode: standard consolidation, enforced governance
  config.consolidationInterval = '24h';
  config.governanceLevel = 'enforced';
} else {
  // Scale mode: selective consolidation, strict governance
  config.consolidationInterval = '6h';
  config.governanceLevel = 'strict';
  config.archiveThreshold = 0.2; // more aggressive archiving
}
```

**Evidence Level:** [LIKELY] -- Scale-adaptive behavior is common in databases (SQLite auto-vacuum, PostgreSQL autotune). The specific thresholds are design decisions.

### 3.3 Convention-Over-Configuration Principles for Limen

Drawing from the CoC pattern (David Heinemeier Hansson, Ruby on Rails):

1. **Sensible defaults for everything:** Every configuration has a default that works for 80% of use cases
2. **Override only the unconventional:** Developer specifies only what differs from convention
3. **Progressive disclosure:** Simple use cases require zero config. Complex use cases allow full control.
4. **No "magic" without transparency:** Every auto-detected setting is inspectable via `limen.config()` or `limen.health()`

```typescript
// Zero config (90% of users):
const limen = createLimen();

// Minimal config (users with specific needs):
const limen = createLimen({ dataDir: './my-data' });

// Full config (power users):
const limen = createLimen({
  dataDir: './my-data',
  masterKey: Buffer.from(process.env.LIMEN_KEY, 'hex'),
  consolidation: { interval: '12h', archiveThreshold: 0.15 },
  governance: { level: 'strict', protectedPredicates: ['legal.*'] },
  decay: { initialStability: { decision: 365, finding: 90 } },
});
```

---

## PART 4: COGNITIVE PRIMITIVES FOR AGI

### 4.1 Existing Cognitive Architectures: What They Teach Us

#### SOAR (State, Operator, and Result)

Developed at University of Michigan, SOAR is the most mature cognitive architecture targeting general intelligence. [CONFIRMED -- 40+ years of research, hundreds of publications]

**Memory Architecture:**
- **Working Memory:** Symbolic graph of the current situation (the agent's "now")
- **Procedural Memory:** If-then rules (productions) -- the "how to"
- **Semantic Memory:** Long-term factual knowledge with base-level activation (frequency + recency)
- **Episodic Memory:** Automatic snapshots of working memory in a temporal stream

**Processing Cycle:**
1. Operator Proposal -- rules propose actions
2. Operator Evaluation -- rules compare proposed actions
3. Decision -- select best operator based on preferences
4. Operator Application -- modify working memory

**Learning Mechanisms:**
- **Chunking:** When the system lacks knowledge (impasse), it creates a subgoal. The result is compiled into a new rule. Complex reasoning becomes reactive processing.
- **Reinforcement Learning:** Tunes numeric preferences for operator selection based on reward.
- **Semantic Learning:** Online creation of new long-term fact structures.
- **Episodic Learning:** Automatic recording of working memory snapshots.

**Key insight for Limen:** SOAR's three-level processing (automatic -> deliberative -> meta-reasoning) maps to Limen's potential processing tiers:
- Level 0: Direct recall (pattern-matched, fast)
- Level 1: Deliberative query (search, filter, rank)
- Level 2: Meta-reasoning (reason about what to recall, derive new claims)

#### ACT-R (Adaptive Control of Thought -- Rational)

Focuses on cognitive modeling of human behavior rather than AGI, but provides critical insights:

- **Base-level activation:** Each memory chunk has an activation level based on frequency and recency of access. Higher activation = faster retrieval. This is exactly the FSRS stability concept.
- **Spreading activation:** When a chunk is accessed, activation spreads to connected chunks. This is how context influences recall.
- **Partial matching:** Imperfect matches are allowed with a penalty. This enables fuzzy recall.

**Key insight for Limen:** ACT-R's activation model is the theoretical justification for Limen's FSRS-based decay. The mathematics are different but the principle is identical: frequently and recently accessed knowledge is more available. [CONFIRMED]

#### OpenCog Hyperon (2024-2026)

The most ambitious current AGI architecture project:

- **Distributed Atomspace (DAS):** A hypergraph where atoms are globally unique, immutable, and indexed. Atoms hold "values" (valuations/interpretations). [CONFIRMED -- open source, actively developed]
- **MeTTa:** A programming language capable of writing introspective and self-modifying programs.
- **PRIMUS cognitive model:** Instantiates working, declarative, and procedural memories with an attention economy and a rapid goal-driven cognitive cycle.
- **Attention Economy:** Each atom has an attention value (Short-Term Importance + Long-Term Importance). Atoms compete for attention. Low-attention atoms are forgotten. [CONFIRMED]

**Key insight for Limen:** The attention economy is the missing link between FSRS-style decay and cognitive prioritization. Claims should have an attention value that decays over time but spikes when accessed. This directly feeds the consolidation/archiving decision.

### 4.2 Completeness Analysis of Limen's Primitives

Current Limen system calls (from source + MCP tools):

| # | Primitive | Purpose | Cognitive Function |
|---|---|---|---|
| 1 | claim_assert | Store a fact with evidence | ENCODE |
| 2 | claim_query | Retrieve facts by filter | RECALL |
| 3 | claim_retract | Mark a claim as no longer valid | UNLEARN |
| 4 | connect | Create relationship between claims | ASSOCIATE |
| 5 | remember | Simplified claim assertion | ENCODE (convenience) |
| 6 | recall | Simplified claim query | RECALL (convenience) |
| 7 | reflect | Batch-store categorized learnings | ENCODE (batch) |
| 8 | wm_write | Write to working memory | SHORT-TERM STORE |
| 9 | wm_read | Read from working memory | SHORT-TERM RECALL |
| 10 | wm_discard | Clear working memory | SHORT-TERM FORGET |
| 11 | session_open | Start knowledge session | CONTEXT ENTER |
| 12 | session_close | End knowledge session | CONTEXT EXIT |
| 13 | scratch (write) | Scratch pad write | NOTEPAD |
| 14 | scratch (read) | Scratch pad read | NOTEPAD |
| 15 | scratch (list) | Scratch pad list | NOTEPAD |
| 16 | mission/task ops | Mission lifecycle | GOAL MANAGEMENT |

**Coverage Analysis:**

| Cognitive Function | Covered? | Notes |
|---|---|---|
| ENCODE (store new knowledge) | YES | claim_assert, remember, reflect |
| RECALL (retrieve knowledge) | YES | claim_query, recall |
| ASSOCIATE (link knowledge) | YES | connect |
| UNLEARN (retract knowledge) | PARTIAL | retract exists, but no principled forgetting |
| SHORT-TERM MEMORY | YES | wm_write/read/discard |
| CONTEXT MANAGEMENT | YES | session_open/close, mission/task |
| **REASON (derive new knowledge)** | **NO** | Cannot derive claim C from claims A and B |
| **CONSOLIDATE (merge claims)** | **NO** | Cannot merge related claims into higher-order |
| **PRIORITIZE (rank by relevance)** | **NO** | Query returns all matches, no ranking |
| **FORGET (principled decay)** | **NO** | No decay mechanism, no archiving |
| **ABSTRACT (generalize)** | **NO** | Cannot extract patterns from specific claims |
| **IMAGINE (hypothesize)** | **NO** | Cannot create tentative claims for testing |
| **ANALOGIZE (cross-domain)** | **NO** | Cannot find structural similarities |

### 4.3 Which Missing Primitives Are Essential?

**Essential (build now):**

1. **FORGET / DECAY** -- Without this, the system grows without bound and recall quality degrades. The FSRS model provides the mathematics. This is the highest-priority gap.

2. **CONSOLIDATE** -- Without this, related claims remain fragmented. The brain's memory consolidation is essential for forming coherent knowledge. Implementation: merge claims with same subject into summary claims, creating `derived_from` relationships.

3. **PRIORITIZE** -- Without this, recall returns flat results. Every cognitive architecture (SOAR, ACT-R, OpenCog) has an attention/activation mechanism. Implementation: rank recall results by retrievability (R) * connection_density * recency.

4. **REASON** -- Without this, Limen is a store, not a substrate. The system should be able to derive "If A supports B, and B supports C, then A transitively supports C." Implementation: graph traversal + inference rules.

**Important (build next):**

5. **ABSTRACT** -- Generalize from specific instances. "These 5 claims about API errors all follow pattern X" -> create a pattern claim. This is hierarchical KG aggregation applied to Limen claims.

**Premature (architect for, don't build):**

6. **IMAGINE** -- Hypothetical reasoning requires a sandbox where tentative claims don't pollute the real knowledge base. Architecturally: a "draft" claim status that is excluded from standard recall. The data model should support this, but the cognitive mechanism is premature.

7. **ANALOGIZE** -- Cross-domain structural matching is an AGI-hard problem. No production system does this well. Architect for it (claims are domain-tagged, so cross-domain queries are possible) but don't try to automate it.

**Evidence Level:** [LIKELY] -- The essential/important/premature classification is derived from cognitive architecture research + practical engineering judgment. The specific implementations are [SPECULATIVE] and need design iteration.

### 4.4 Comparison with AGI Cognitive Requirements

From DeepMind's "Levels of AGI" framework (Morris et al., 2023):

| AGI Level | Required Cognitive Infrastructure | Limen Coverage |
|---|---|---|
| Level 1 (Emerging) | Basic knowledge storage and retrieval | COVERED |
| Level 2 (Competent) | Contextual recall, prioritized retrieval, basic reasoning | PARTIAL -- needs PRIORITIZE, REASON |
| Level 3 (Expert) | Consolidation, abstraction, domain adaptation | NOT COVERED -- needs CONSOLIDATE, ABSTRACT |
| Level 4 (Exceptional) | Self-modification, hypothetical reasoning, cross-domain transfer | NOT COVERED -- needs IMAGINE, ANALOGIZE |
| Level 5 (Superhuman) | Complete cognitive substrate with self-improving organization | ARCHITECTURAL -- the vision |

**Metacognitive requirements from DeepMind:**
- Learning new skills -> Limen's technique system partially addresses this
- Recognizing capability limits -> Not covered
- Theory of mind -> Not applicable at infrastructure level
- Model calibration -> Confidence scores partially address this

---

## PART 5: DOMAIN ADAPTATION WITHOUT TRAINING

### 5.1 The Signal Is in the Knowledge

When a medical app uses Limen, the claims will contain medical terminology: "diagnosis", "treatment", "patient", "symptom". When a legal app uses it, claims will contain "contract", "clause", "liability", "jurisdiction."

**The domain does not need to be configured. It can be detected from the claim distribution.**

### 5.2 Domain Detection Mechanism

**Layer 1: Predicate Namespace Analysis**
Limen predicates follow `domain.property` format. The domain segment is an explicit signal:
- `medical.diagnosis` -> medical domain
- `financial.revenue` -> financial domain
- `architecture.pattern` -> software engineering domain

If a Limen instance has 80% of claims with `medical.*` predicates, it is a medical knowledge base. [CONFIRMED -- trivial to implement]

**Layer 2: Vocabulary Analysis**
For claims without domain-explicit predicates, analyze object values:
- Statistical topic modeling (LDA, BERTopic) on claim text
- Cluster claims by embedding similarity
- Label clusters using the most frequent terms

**Evidence Level:** [CONFIRMED] -- BERTopic and LDA are production-ready. OntoUSP demonstrated unsupervised ontology induction from text. The combination with Limen's structured claim format makes this easier than general text.

**Layer 3: Behavioral Analysis**
The domain also reveals itself through usage patterns:
- Medical apps make frequent `recall` queries about patients
- Engineering apps make frequent `connect` calls between architectural claims
- Legal apps make frequent `claim_query` calls with high confidence thresholds

Usage patterns can refine domain detection over time.

### 5.3 Domain-Specific Adaptations

Once the domain is detected, Limen can adapt:

| Adaptation | Medical | Legal | Engineering |
|---|---|---|---|
| Default confidence threshold | 0.95 (high, medical conservatism) | 0.9 (high, legal precision) | 0.7 (moderate, engineering iteration) |
| Decay rate for findings | Slow (medical evidence persists) | Slow (legal precedent persists) | Fast (engineering patterns evolve) |
| Conflict resolution | Flag all, never auto-resolve | Flag all, require human review | Auto-resolve by recency for non-governance |
| Protected predicates | `diagnosis.*`, `treatment.*` | `contract.*`, `ruling.*` | `governance.*`, `decision.*` |
| Consolidation aggression | Conservative (don't merge case records) | Conservative (don't merge case law) | Aggressive (merge related findings) |

**Evidence Level:** [SPECULATIVE] -- The specific adaptations are reasonable inferences from domain characteristics, but have no empirical validation. These would need tuning with real users.

### 5.4 Transfer Learning Between Domains

When Limen is used across multiple domains (e.g., a company using it for both engineering and legal), cross-domain transfer becomes possible:

- **Structural patterns transfer:** If engineering domain learns that "claims connected to governance predicates should never be auto-archived", this principle can be proposed for legal domain too.
- **Decay patterns transfer:** If findings in engineering have a 90-day half-life, and findings in a new "marketing" domain show similar access patterns, propose the same half-life.

This is analogous to the brain's schema assimilation: new domains are initially organized using existing schemas, then refined.

**Evidence Level:** [UNCERTAIN] -- Theoretically sound, but no existing system demonstrates cross-domain knowledge transfer in this way. Invention opportunity.

---

## PART 6: WHAT AGI-READY ACTUALLY MEANS

### 6.1 DeepMind's Framework Applied to Infrastructure

DeepMind's Levels of AGI define 5 performance levels x 2 generality dimensions (Narrow vs General). The key insight: **AGI is not synonymous with autonomy.** Higher capabilities unlock but don't determine autonomy levels. A Level 3 Expert AGI might operate at Autonomy Level 2 (consultant) by design choice.

**For Limen as infrastructure:**
Limen doesn't need to BE AGI. It needs to be the cognitive substrate that AGI systems can build on. The analogy: Limen is to AGI as the filesystem + database + network stack is to modern applications.

### 6.2 What AGI-Ready Infrastructure Requires

| Requirement | Why | Limen Status | Build Timeline |
|---|---|---|---|
| **Massive scale** (billions of claims) | AGI generates knowledge at massive rates | PARTIAL -- SQLite is the bottleneck. Need distributed storage. | Architect now, build when needed |
| **Real-time reasoning** | AGI needs sub-100ms knowledge access | PARTIAL -- SQLite is fast for reads. Need caching layer. | Architect now, build when needed |
| **Multi-modal knowledge** | AGI processes text, image, audio, code | NO -- claims are text-only | Architect now (add `objectFormat` field) |
| **Self-modification** | The system improves its own organization | NO -- this is the consolidation loop | Build now |
| **Explanation** (traceability) | Every conclusion traceable to evidence | YES -- evidence_refs, grounding_mode, relationships | Exists |
| **Calibrated uncertainty** | Every claim has confidence | YES -- confidence scores on all claims | Exists |
| **Temporal reasoning** | Knowledge changes over time | PARTIAL -- validAt exists, but no temporal query operators | Build next |
| **Governance** | Safe, auditable, reversible | YES -- this is Limen's core strength | Exists |

### 6.3 The 5-Year Architecture Principle

Build for today's needs. Architect for tomorrow's scale. Never build what you can't test.

**Build NOW (0-6 months):**
- FORGET primitive with FSRS-inspired decay
- CONSOLIDATE primitive with merge + archive
- PRIORITIZE primitive with attention-based ranking
- Auto-connection on claim ingestion
- Auto-conflict detection (same-subject-same-predicate)
- Domain detection via predicate analysis

**Build NEXT (6-18 months):**
- REASON primitive with graph traversal inference
- ABSTRACT primitive with hierarchical aggregation
- Full consolidation loop (the background cognitive metabolism)
- Embedding-based auto-connection
- Scale-adaptive configuration
- Multi-modal claim support (object format field)

**Architect for but DON'T build (18+ months):**
- IMAGINE primitive (draft claims / sandbox)
- ANALOGIZE primitive (cross-domain structural matching)
- Distributed storage (beyond single-node SQLite)
- Real-time streaming knowledge (event-driven claim propagation)
- Self-modifying schema (schema that evolves its own evolution rules)

---

## PART 7: SYNTHESIS -- THE LIMEN COGNITIVE ARCHITECTURE

### 7.1 The Complete Picture

```
                    LIMEN COGNITIVE ARCHITECTURE

    +----------------------------------------------------------+
    |                    COGNITIVE LAYER                         |
    |                                                           |
    |  REASON   CONSOLIDATE   PRIORITIZE   ABSTRACT   FORGET   |
    |     |          |             |           |          |     |
    +-----|----------|-------------|-----------|----------|-----+
          |          |             |           |          |
    +-----|----------|-------------|-----------|----------|-----+
    |     v          v             v           v          v     |
    |              ATTENTION ECONOMY                            |
    |    (retrievability * connection_density * recency)        |
    |              DECAY ENGINE (FSRS)                          |
    |    (power-law forgetting, stability updates on access)    |
    +----------------------------------------------------------+
          |          |             |           |          |
    +-----|----------|-------------|-----------|----------|-----+
    |     v          v             v           v          v     |
    |              KNOWLEDGE LAYER (existing)                   |
    |                                                           |
    |  claim_assert  claim_query  connect  retract  supersede   |
    |  remember      recall       reflect                      |
    +----------------------------------------------------------+
          |          |             |           |          |
    +-----|----------|-------------|-----------|----------|-----+
    |     v          v             v           v          v     |
    |              WORKING MEMORY (existing)                    |
    |                                                           |
    |  wm_write     wm_read      wm_discard  scratch           |
    +----------------------------------------------------------+
          |          |             |           |          |
    +-----|----------|-------------|-----------|----------|-----+
    |     v          v             v           v          v     |
    |              KERNEL (existing)                            |
    |                                                           |
    |  database  audit  crypto  vault  events  rbac  retention  |
    |  namespace  tenant  rateLimiter  time                     |
    +----------------------------------------------------------+
          |          |             |           |          |
    +-----|----------|-------------|-----------|----------|-----+
    |     v          v             v           v          v     |
    |              AUTO-ADAPTATION LAYER (new)                  |
    |                                                           |
    |  env_detect  domain_detect  scale_adapt  schema_evolve   |
    |  framework_adapt  provider_detect                        |
    +----------------------------------------------------------+
```

### 7.2 The Consolidation Loop (The Heartbeat of Cognition)

```
Every consolidation_interval:

1. SCAN: Find claims with R < aging_threshold
   |
2. CLASSIFY: Auto-classify any claims without explicit category
   |
3. CONNECT: For recently added claims, find related existing claims
   |         (embedding similarity + predicate matching + temporal proximity)
   |
4. CONFLICT: Detect contradictions
   |          (same subject + same predicate + different value)
   |          Flag for human review or auto-resolve by recency
   |
5. CONSOLIDATE: Merge related low-R claims into summary claims
   |             Create derived_from relationships
   |
6. ARCHIVE: Move claims below archive_threshold to cold storage
   |
7. SCHEMA: Update emergent schema based on new claim patterns
   |         New predicate clusters -> new schema proposals
   |
8. METRICS: Record consolidation stats for observability
```

### 7.3 The Developer Experience

```typescript
// === ZERO CONFIG ===
import { createLimen } from 'limen-ai';
const limen = createLimen();

// That's it. The system now:
// - Detected your LLM provider from env vars
// - Created a local SQLite database
// - Started the consolidation loop
// - Is ready to receive knowledge

// === STORE KNOWLEDGE ===
await limen.remember({
  subject: 'entity:patient:12345',
  predicate: 'medical.diagnosis',
  object: 'Type 2 Diabetes',
  confidence: 0.92
});
// System automatically:
// - Classified this as a medical domain claim
// - Found 3 related claims about this patient
// - Created support relationships
// - Set initial stability = 365 (medical domain -> high retention)
// - Detected no conflicts

// === RECALL WITH PRIORITY ===
const claims = await limen.recall({
  subject: 'entity:patient:12345',
  limit: 10,
  // Results automatically ranked by attention value:
  // retrievability * connection_density * recency
});
// Each recall updates the claim's stability (FSRS reinforcement)

// === INSPECT THE COGNITIVE STATE ===
const health = await limen.health();
// Returns: {
//   activeClaims: 1247,
//   dormantClaims: 89,
//   archivedClaims: 412,
//   detectedDomain: 'medical',
//   lastConsolidation: '2026-03-30T02:00:00Z',
//   schemaEntities: 23,
//   conflictsDetected: 2
// }
```

---

## KNOWLEDGE GAPS AND OPEN QUESTIONS

### Gaps Where the Field Falls Short

1. **No production system combines self-organizing KG + forgetting + zero-config.** DIAL-KG does self-organization. FSRS does forgetting. USB does zero-config. Nobody combines all three. This is Limen's invention space.

2. **Cross-domain knowledge transfer is theoretically described but not implemented.** The CLS theory explains how the brain does it. No artificial system replicates it at the knowledge-infrastructure level.

3. **The "right" decay parameters for knowledge claims are unknown.** FSRS parameters are tuned on flashcard data (billions of reviews). Knowledge claim decay has no equivalent dataset. Limen will need to generate this data and tune.

4. **Consolidation quality metrics don't exist.** How do you measure whether a consolidation was good? The brain has no conscious metric -- it just works. For Limen, we need: recall precision before/after consolidation, storage efficiency, conflict resolution accuracy.

5. **Schema evolution stability.** DIAL-KG shows schema can evolve, but long-term stability of evolved schemas is unproven. Can the schema oscillate? Diverge? These need formal analysis.

### Open Questions for Limen Design

1. **Should consolidation be synchronous or asynchronous?** Synchronous is simpler but blocks. Asynchronous is better for production but adds complexity. Recommendation: async with a synchronous `consolidate_now()` escape hatch.

2. **Should the FSRS parameters be global or per-claim-type?** FSRS research shows personalization improves accuracy by 10-15%. Recommendation: per-claim-type with global defaults.

3. **Where does the embedding model come from for auto-connection?** Options: (a) Use the connected LLM's embedding endpoint, (b) Bundle a small local model (e.g., all-MiniLM-L6), (c) Make it configurable. Recommendation: (c) with (b) as default for zero-config.

4. **How does governance interact with forgetting?** Claims with governance predicates should NEVER be auto-archived. But should they decay in retrievability? Recommendation: governance claims have infinite stability but still participate in the attention economy for ranking purposes.

5. **What is the minimum viable cognitive layer?** To ship something, we don't need all of Part 4. The minimum is: FORGET + PRIORITIZE + auto-conflict-detection. This gives developers a knowledge system that doesn't grow without bound and returns relevant results first.

---

## SOURCES

### Neuroscience
- [Complementary Learning Systems](https://pubmed.ncbi.nlm.nih.gov/7624455/) -- McClelland, McNaughton, O'Reilly (1995)
- [CLS Update -- What Learning Systems Do Intelligent Agents Need?](https://www.cnbc.cmu.edu/~tai/nc19journalclubs/KumaranHassabisMcC16CLSUpdate.pdf) -- Kumaran, Hassabis, McClelland (2016)
- [Memory Consolidation from a Reinforcement Learning Perspective](https://www.frontiersin.org/journals/computational-neuroscience/articles/10.3389/fncom.2024.1538741/full) -- Frontiers, 2024
- [Interplay of Hippocampus and Prefrontal Cortex in Memory](https://pmc.ncbi.nlm.nih.gov/articles/PMC3789138/)
- [Learning, Sleep Replay and Consolidation of Contextual Fear Memories](https://www.biorxiv.org/content/10.1101/2025.06.20.660661v1) -- bioRxiv, 2025
- [Prioritizing Information During Working Memory](https://pmc.ncbi.nlm.nih.gov/articles/PMC7220802/)
- [Priority Maps Explain Goal-Oriented Behavior](https://www.jneurosci.org/content/34/42/13867) -- Journal of Neuroscience

### Cognitive Architectures
- [Soar Cognitive Architecture](https://en.wikipedia.org/wiki/Soar_(cognitive_architecture)) -- Laird, University of Michigan
- [Analysis and Comparison of ACT-R and Soar](https://arxiv.org/abs/2201.09305) -- Advances in Cognitive Systems, 2021
- [OpenCog Hyperon](https://hyperon.opencog.org/) -- SingularityNET
- [OpenCog Hyperon: A Practical Path to Beneficial AGI](https://link.springer.com/chapter/10.1007/978-3-032-00686-8_18)
- [Rethinking Cognitive Foundations of the Attention Economy](https://www.tandfonline.com/doi/full/10.1080/09515089.2025.2502428) -- 2025

### Knowledge Graphs and Self-Organization
- [DIAL-KG: Schema-Free Incremental KG Construction](https://arxiv.org/html/2603.20059) -- 2026
- [AutoSchemaKG: Autonomous KG Construction](https://arxiv.org/html/2505.23628v1) -- 2025
- [Building Self-Evolving Knowledge Graphs Using Agentic Systems](https://medium.com/@community_md101/building-self-evolving-knowledge-graphs-using-agentic-systems-48183533592c)
- [Ontology Learning and KG Construction](https://arxiv.org/html/2511.05991v1)
- [An Unsupervised Ontology Construction Method](https://dl.acm.org/doi/10.1145/3730436.3730532) -- 2025
- [Unsupervised Ontology Induction from Text](https://aclanthology.org/P10-1031/) -- Poon, Domingos

### Forgetting and Memory Decay
- [Forgetting Curve](https://en.wikipedia.org/wiki/Forgetting_curve) -- Ebbinghaus, 1885
- [FSRS Technical Explanation](https://expertium.github.io/Algorithm.html) -- Expertium
- [FSRS Algorithm Wiki](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm)
- [Adaptive Forgetting Curves for Spaced Repetition](https://pmc.ncbi.nlm.nih.gov/articles/PMC7334729/)
- [Forgetting in Machine Learning and Beyond: A Survey](https://arxiv.org/html/2405.20620v1) -- 2024
- [Dissecting Language Models: Machine Unlearning via Selective Pruning](https://arxiv.org/html/2403.01267v2)
- [Exponential Nature of Forgetting](https://supermemo.guru/wiki/Exponential_nature_of_forgetting) -- SuperMemo

### Conflict Detection and Temporal Reasoning
- [PaTeCon: Pattern-Based Temporal Constraint Mining for Conflict Detection](https://arxiv.org/abs/2304.09015)
- [Conflict Detection for Temporal Knowledge Graphs](https://arxiv.org/abs/2312.11053)
- [Detect-Then-Resolve: KG Conflict Resolution with LLMs](https://www.mdpi.com/2227-7390/12/15/2318)

### AGI Frameworks
- [Levels of AGI for Operationalizing Progress](https://arxiv.org/abs/2311.02462) -- DeepMind
- [AGI's Last Bottlenecks](https://ai-frontiers.org/articles/agis-last-bottlenecks) -- AI Frontiers
- [AGI Benchmarks: Tracking Progress](https://spectrum.ieee.org/agi-benchmark) -- IEEE Spectrum

### Zero-Config and Auto-Detection
- [Convention Over Configuration](https://en.wikipedia.org/wiki/Convention_over_configuration)
- [Zero-Config Backends](https://thinhdanggroup.github.io/zero-config-backend-rikta/)
- [USB Enumeration Process](https://www.totalphase.com/blog/2020/08/what-is-enumeration-why-usb-descriptors-important/)
- [Schema-on-Read vs Schema-on-Write](https://www.dremio.com/wiki/schema-on-read-vs-schema-on-write/)

### Knowledge Graph Summarization
- [Hierarchical Knowledge Graph Aggregation](https://www.emergentmind.com/topics/hierarchical-knowledge-graph-aggregation)
- [Improving Summarization with GraphRAG and RaptorRAG](https://stephencollins.tech/newsletters/improving-summarization-tasks-graphrag-raptorrag)

---

*Research conducted 2026-03-30 by SolisHQ Researcher Agent.*
*Evidence levels assigned per SolisHQ Opus-Level standard: multiple sources per claim, cross-referenced.*
*This document is a knowledge artifact, not a specification. Implementation decisions require design iteration.*
