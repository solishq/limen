# LIMEN SUPERPOWERS AS FEATURES — Research Analysis

**Author**: Researcher Agent
**Date**: 2026-03-30
**Classification**: CONSEQUENTIAL
**Status**: PA REVIEW PENDING
**Source Brief**: ~/SolisHQ/Docs/ORCHESTRATOR_SUPERPOWERS_OPERATIONAL_BRIEF.md
**Limen Version Studied**: 1.2.0

---

## Executive Summary

This analysis evaluates 14 Orchestrator Superpowers plus 5 additional first-principles capabilities for inclusion as built-in Limen features. The core thesis: **no competing framework combines deterministic knowledge governance with cognitive self-monitoring**. Mem0, Zep, Letta, and Cognee all solve memory retrieval. None solve epistemic governance — knowing whether what you remember is actually worth believing.

Limen's constitutional layer (tenant isolation, audit trails, RBAC, immutable claims, evidence chains) is the foundation that makes these superpowers safe to build. Every other framework would have to bolt governance on after the fact. Limen has it at the kernel.

### Verdict Summary

| # | Superpower | Build into Limen? | Level | Effort |
|---|---|---|---|---|
| 1 | Narrative Memory | YES | MCP tool + automatic behavior | M |
| 2 | Proactive Sensing | YES | MCP tool (enhanced health) | M |
| 3 | Multi-Pass Reasoning | NO | Client-side methodology | - |
| 4 | Reasoning Chain Memory | YES | Schema migration + MCP enhancement | S |
| 5 | Promise Accountability | YES | New MCP tools | M |
| 6 | Haystack Finder | YES | FTS5 + vector (already planned) | L |
| 7 | Excellence Gates | YES | Configurable validation hooks | M |
| 8 | Temporal Awareness | YES | Automatic behavior on recall | S |
| 9 | Autonomy Levels | PARTIAL | Extends existing RBAC | M |
| 10 | User/Preference Model | YES | Profile system on claims | S |
| 11 | DAG Dispatch | NO | Orchestration, not cognition | - |
| 12 | Agent Specialization | YES | Extends agent trust model | M |
| 13 | Real-Time Monitoring | YES (exists) | EventBus already built | S |
| 14 | Synthesis Engine | PARTIAL | MCP tool, LLM-dependent | M |
| A | Self-Healing Knowledge | YES | Cascade on retraction | M |
| B | Curiosity Engine | YES | Knowledge gap detection | M |
| C | Analogical Reasoning | LATER | Requires vector search | L |
| D | Confidence Calibration | YES | Extends agent model | M |
| E | Knowledge Metabolism | YES | Automatic consolidation | L |

**Effort key**: S = Small (< 1 day), M = Medium (1-3 days), L = Large (> 3 days)

---

## SUPERPOWER 1: NARRATIVE MEMORY

### Should Limen Have This?

**YES.** [Evidence level: CONFIRMED]

Every AI agent framework solves session continuity, but all of them solve it at the retrieval layer (what memories match this query?). None solve it at the narrative layer (what is the STORY of this session?). Mem0 compresses chat history into memory representations — token-efficient but narratively dead. Zep tracks temporal graphs — relationally rich but emotionally flat. Letta's tiered memory (core/archival/recall) gives structure but not arc.

A narrative is not a list of facts. A narrative captures momentum, unfinished threads, emotional register, and directional energy. This is what humans use to continue interrupted work. Limen should produce it automatically.

### Why Every Developer Needs It

Developers building AI agents that work across sessions need more than key-value memory. They need their agents to understand the trajectory of work — not just what happened, but what was building toward, what was interrupted, and what the priorities were at the moment the session ended.

### How It Works in Limen

`limen_session_close` already accepts an optional `summary` parameter. The enhancement:

1. **Automatic narrative generation**: When `limen_session_close()` is called, Limen queries all claims asserted during the session, all working memory entries, and the mission objective. It produces a structured narrative template that the calling agent fills in (Limen itself has no LLM — the substrate layer does).
2. **Narrative storage**: The narrative is stored as a special claim with predicate `session.narrative` and grounding mode `runtime_witness`, linking the session's mission ID.
3. **Automatic narrative injection on session open**: `limen_session_open()` queries for the most recent `session.narrative` claim for that project and returns it in the session info response.

### Proposed API

```typescript
// Enhanced session_close — automatic narrative materials
limen_session_close({
  summary: "Completed FTS5 migration, 3 failing tests remain",
  narrative: {                              // NEW — optional, structured
    momentum: "Building toward v1.3.0",
    unfinishedThreads: ["FTS5 test fixes", "vector search design"],
    keyDecisions: ["Chose FTS5 over Tantivy for SQLite compatibility"],
    energyState: "focused"                  // free-form text
  }
})

// Enhanced session_open — returns last narrative
limen_session_open({ project: "limen" })
// Returns: { missionId, taskId, project, lastNarrative: { ... } | null }
```

**Surface**: MCP tool enhancement (no new system calls).
**Depends on**: Existing CCP (claims) infrastructure.
**Schema change**: None — uses existing claim schema with new predicate convention.

---

## SUPERPOWER 2: PROACTIVE SENSING

### Should Limen Have This?

**YES.** [Evidence level: CONFIRMED]

91% of AI models experience temporal degradation — accuracy declines as data ages. Limen stores knowledge with timestamps but does nothing with temporal metadata beyond ordering. A cognitive OS that cannot detect its own knowledge decay is not a cognitive OS — it is a database with aspirations.

### Why Every Developer Needs It

Every developer building a knowledge-driven agent needs answers to: How fresh is my knowledge? Are any claims contradicting each other? Where are the gaps? Without proactive sensing, agents serve stale information with full confidence — the worst kind of failure because it is invisible.

### How It Works in Limen

Enhance `limen_health()` from a simple database connectivity check into a cognitive health report:

1. **Knowledge freshness**: For each predicate domain, calculate age distribution. Flag domains where the median claim age exceeds a configurable threshold.
2. **Conflict detection**: Query claims with `contradicts` relationships and report unresolved contradictions (both claims still active).
3. **Knowledge gaps**: Compare predicate domains against a configured schema. If a domain has zero claims, flag it.
4. **Confidence distribution**: Report the distribution of confidence scores. If the median confidence is below a threshold, flag it.
5. **Stale claim detection**: Claims older than N days without supporting evidence or superseding claims are flagged as potentially stale.

### Proposed API

```typescript
// Enhanced health — cognitive metrics
limen_health()
// Returns existing health PLUS:
{
  health: "healthy",
  subsystems: { ... },                // existing
  cognition: {                         // NEW
    totalClaims: 1247,
    activeClaims: 1180,
    retractedClaims: 67,
    freshness: {
      medianAgeDays: 4.2,
      staleCount: 23,                  // claims older than threshold
      staleDomains: ["architecture.*"] // domains with no recent claims
    },
    conflicts: {
      unresolvedCount: 3,
      pairs: [
        { claim1: "clm_abc", claim2: "clm_def", domain: "decision.*" }
      ]
    },
    confidence: {
      median: 0.82,
      lowConfidenceCount: 14,          // claims < 0.5
      highConfidenceCount: 890         // claims >= 0.8
    },
    gaps: ["entity:project:limen has 0 claims for predicate security.*"]
  }
}
```

**Surface**: MCP tool enhancement (enhanced `limen_health` response).
**Depends on**: CCP (claims) with relationship support.
**Schema change**: None — computed from existing data.

---

## SUPERPOWER 3: MULTI-PASS REASONING

### Should Limen Have This?

**NO.** [Evidence level: CONFIRMED]

Multi-pass reasoning is a client-side methodology pattern, not a knowledge infrastructure capability. It requires dispatching multiple agents, collecting outputs, and synthesizing — this is orchestration, not cognition. Limen's principle is "THE KERNEL NEVER REASONS" (from claim_types.ts header comment). Building reasoning into Limen would violate its own constitutional design.

What Limen CAN do: provide the consistency-checking infrastructure that makes multi-pass reasoning verifiable (see Superpower 3's role as infrastructure for the Excellence Gates in Superpower 7). But the reasoning itself belongs to the client.

### Recommendation

Document multi-pass reasoning as a reference architecture pattern in Limen's documentation. Provide a code example showing how to use `limen_recall`, `limen_connect(contradicts)`, and `limen_remember` to implement challenge-revise cycles. Do not build it into the engine.

---

## SUPERPOWER 4: REASONING CHAIN MEMORY

### Should Limen Have This?

**YES.** [Evidence level: CONFIRMED]

This is the single most valuable enhancement identified in this research. The competitive landscape confirms it: confidence calibration — knowing whether what you recall is worth believing — is described as "genuinely an open problem" across all memory frameworks (Mem0, Zep, Letta, Supermemory). None of them store WHY something is believed. They store WHAT is believed and HOW CONFIDENT the agent was, but the derivation chain — the observations, hypotheses, tests, and boundary conditions — is lost.

A claim without reasoning is a fact. A claim with reasoning is wisdom. The difference: facts tell you what to do; wisdom tells you whether the fact still applies in a new context.

### Why Every Developer Needs It

When an agent encounters a situation similar to a past decision, it needs to evaluate whether the past reasoning still holds. "We chose X because of Y" is actionable in a new context only if Y is still true. Without the reasoning chain, the agent can only blindly follow precedent or ignore it entirely.

### How It Works in Limen

Add an optional `reasoning` TEXT column to the `claim_assertions` table. This is an additive migration — no existing data is modified.

### Proposed API

```typescript
// Enhanced limen_remember — with reasoning
limen_remember({
  subject: "entity:architecture:vox-dictation",
  predicate: "decision.description",
  object: "Hold-to-talk is the correct dictation architecture",
  confidence: 1.0,
  reasoning: "Fixed-time chunking creates unsolvable boundary problems with batch APIs. " +
    "Whisper transcribes overlapping segments differently, making dedup impossible. " +
    "Boundary condition: applies to BATCH APIs only. Streaming WebSocket APIs can use " +
    "continuous chunking because they maintain server-side state."
})

// Enhanced limen_recall — returns reasoning when present
limen_recall({ subject: "entity:architecture:*" })
// Returns: [..., { claimId, subject, predicate, object, confidence, disputed, reasoning: "..." }]
```

**Surface**: Schema migration + MCP tool enhancement.
**Depends on**: Nothing beyond current CCP.
**Schema change**: `ALTER TABLE claim_assertions ADD COLUMN reasoning TEXT` (nullable, additive).
**FTS5 bonus**: When FTS5 ships, index the reasoning column. This makes derivation chains searchable — "find me every claim where the reasoning mentions batch API limitations."

---

## SUPERPOWER 5: PROMISE ACCOUNTABILITY

### Should Limen Have This?

**YES.** [Evidence level: LIKELY]

No competing framework tracks predictions vs outcomes. This is genuinely novel. The closest analogy is LangSmith's agent evaluation metrics, but those measure external quality (did the agent's response satisfy the user?) not internal calibration (did the agent's confidence match reality?).

Prediction tracking turns Limen from a knowledge store into a self-calibrating knowledge system. Every prediction that can be compared to an outcome becomes a data point for confidence calibration (see additional capability D below).

### Why Every Developer Needs It

Any agent that makes estimates (time, cost, likelihood, feasibility) needs a mechanism to track accuracy over time. Without it, confidence scores are decorative — they express belief but never get corrected by reality.

### How It Works in Limen

Two new MCP tools: `limen_predict` and `limen_record_outcome`. Predictions are stored as claims with predicate `prediction.*`. Outcomes are stored as claims with predicate `outcome.*` and linked to the prediction via a `derived_from` relationship.

### Proposed API

```typescript
// Make a prediction
limen_predict({
  subject: "entity:task:fts5-migration",
  prediction: "FTS5 migration will take 4 hours",
  confidence: 0.7,
  deadline: "2026-03-31T18:00:00Z"       // when outcome should be known
})
// Returns: { predictionClaimId: "clm_xyz" }

// Record the outcome
limen_record_outcome({
  predictionClaimId: "clm_xyz",
  actual: "FTS5 migration took 9 hours",
  accuracy: 0.44,                          // prediction/actual ratio
  lessons: "Underestimated test migration complexity by 2x"
})
// Returns: { outcomeClaimId, delta: { predicted: "4h", actual: "9h", ratio: 0.44 } }

// Query calibration history
limen_calibration({
  subject: "entity:task:*",               // optional filter
  minPredictions: 5                        // need enough data points
})
// Returns: { meanAccuracy: 0.62, biasDirection: "optimistic", biasAmount: 1.8 }
```

**Surface**: New MCP tools (3 tools).
**Depends on**: Existing CCP + relationship support.
**Schema change**: None — uses existing claim schema with convention-based predicates.

---

## SUPERPOWER 6: HAYSTACK FINDER

### Should Limen Have This?

**YES — already planned.** [Evidence level: CONFIRMED]

FTS5 is approved for v1.3.0. Vector search is on the roadmap. This superpower IS the search enhancement roadmap. What this analysis adds: the search should not just return matches but also identify cross-domain structural similarities.

### Why Every Developer Needs It

Agents that can find connections between seemingly unrelated knowledge produce insights that pure retrieval cannot. "The permission issue you are seeing in audio processing is the same pattern as the TCC grant issue in keyboard simulation" — that cross-domain connection requires either vector similarity or an explicit analogy engine.

### How It Works in Limen

**Phase 1 (FTS5, v1.3.0)**: Full-text search across claim objects and reasoning fields. New MCP tool `limen_search` with keyword query.

**Phase 2 (Vector, v1.4.0+)**: Embed claim objects at assertion time. Store embeddings in a column or sidecar table. New parameter on `limen_search`: `mode: "keyword" | "semantic" | "hybrid"`.

**Phase 3 (Cross-domain pattern matching)**: When a new claim is stored, automatically find the top-N most similar claims in OTHER predicate domains. If similarity exceeds threshold, create an automatic `supports` or informational relationship.

### Proposed API

```typescript
// Phase 1: keyword search
limen_search({ query: "batch API boundary chunking", limit: 10 })

// Phase 2: semantic search
limen_search({ query: "permission issues with system-level input", mode: "semantic", limit: 10 })

// Phase 3: automatic — triggered on claim assertion
// When agent stores: "Accessibility permission denied after binary recompilation"
// Limen automatically finds: "Code signing invalidated after recompilation" (different domain)
// Returns in assertion response: { analogies: [{ claimId, similarity: 0.87, domain: "build.*" }] }
```

**Surface**: New MCP tool + schema migration + optional automatic behavior.
**Depends on**: FTS5 extension for SQLite, vector storage for Phase 2.
**Schema change**: FTS5 virtual table (v1.3.0), embedding column (v1.4.0+).

---

## SUPERPOWER 7: EXCELLENCE GATES

### Should Limen Have This?

**YES.** [Evidence level: LIKELY]

Quality gates on knowledge storage are what differentiates a knowledge system from a dumpster. Today, any claim can be stored with any confidence, any predicate, any evidence level. Limen validates structure (is it a valid URN? is the confidence between 0 and 1?) but not quality (is the confidence justified? is the reasoning adequate? does it conflict with existing knowledge?).

### Why Every Developer Needs It

Developers building multi-agent systems need to prevent low-quality knowledge from polluting the store. If Agent A stores a claim with confidence 0.95 but no reasoning and no evidence, it looks authoritative but is actually ungrounded. Quality gates catch this at ingestion time.

### How It Works in Limen

Configurable validation hooks that run before a claim is persisted. The hooks are defined per-tenant (or per-mission), not hardcoded. This keeps the kernel policy-neutral while letting users enforce their own standards.

### Proposed API

```typescript
// Configure quality gates for a project/tenant
limen_configure({
  qualityGates: {
    minConfidence: 0.3,                    // reject claims below this
    requireReasoning: true,                // reject claims without reasoning field
    requireEvidence: false,                // don't require evidence refs (too strict for most uses)
    conflictCheck: true,                   // warn if claim contradicts existing active claims
    freshnessWarning: 30,                  // flag if similar claim exists within N days
    maxClaimsPerMinute: 100                // rate limit per agent (already exists in kernel)
  }
})

// On assertion, gates fire automatically:
limen_remember({
  subject: "entity:api:groq",
  predicate: "status.description",
  object: "Groq API is operational",
  confidence: 0.95
  // No reasoning field
})
// Response: {
//   error: "QUALITY_GATE_FAILED",
//   gate: "requireReasoning",
//   message: "Claim confidence >= 0.5 requires a reasoning field when requireReasoning is enabled."
// }
```

**Surface**: MCP tool (`limen_configure`) + automatic behavior on assertion.
**Depends on**: CCP assertion path.
**Schema change**: New `quality_gates` table (tenant_id, gate_name, gate_config JSON) or simpler: store gates as claims with predicate `config.qualityGate.*`.

---

## SUPERPOWER 8: TEMPORAL AWARENESS

### Should Limen Have This?

**YES.** [Evidence level: CONFIRMED]

Every claim already has `validAt` and `createdAt` timestamps. But `limen_recall` treats all active claims equally regardless of age. A claim from 6 months ago and a claim from 6 minutes ago have the same retrieval weight. This is epistemically wrong — recent observations are generally more reliable than old ones, all else being equal.

### Why Every Developer Needs It

Time-aware retrieval is a solved problem in information retrieval but missing from every AI memory framework except Zep (which uses temporal knowledge graphs). Limen can do it simpler: recency-weighted scoring on recall.

### How It Works in Limen

Add optional temporal weighting to `limen_recall`. When enabled, results are scored by a combination of confidence and recency. The decay function is configurable (linear, exponential, or step).

### Proposed API

```typescript
// Temporal-aware recall
limen_recall({
  subject: "entity:api:*",
  predicate: "status.*",
  temporalWeight: {
    enabled: true,
    decay: "exponential",                  // "linear" | "exponential" | "step"
    halfLifeDays: 14,                      // confidence halves every 14 days
    floor: 0.1                             // never decay below this
  }
})
// A claim with confidence 0.9 from 14 days ago → effective confidence 0.45
// A claim with confidence 0.7 from today → effective confidence 0.7
```

**Surface**: MCP tool enhancement (new optional parameter on `limen_recall`).
**Depends on**: Nothing beyond current CCP.
**Schema change**: None — computed at query time from existing timestamps.

---

## SUPERPOWER 9: AUTONOMY LEVELS

### Should Limen Have This?

**PARTIAL.** [Evidence level: LIKELY]

Limen already has RBAC (role-based access control) via `rbac_engine.ts`. Autonomy levels are a specific application of RBAC: what actions can an agent take without human approval? This is a policy layer on top of existing infrastructure, not a new subsystem.

What Limen SHOULD have: a configurable escalation boundary per agent (or per mission). "This agent can assert claims but not retract them without human approval." What Limen SHOULD NOT have: full autonomy level management (levels 1-4 with behavioral descriptions) — that is orchestration logic, not cognitive infrastructure.

### Why Every Developer Needs It

Multi-agent systems need graduated trust. A new agent should not have the same permissions as a proven one. Limen already has agent trust levels (untrusted -> probationary -> trusted -> admin via `limen_agent_promote`). Extend this with operation-specific permissions.

### Proposed API

```typescript
// Already exists — agent trust levels
limen_agent_promote({ name: "researcher" })
// untrusted → probationary → trusted → admin

// NEW — operation permissions per trust level (configuration)
limen_configure({
  trustPolicy: {
    untrusted: { canAssert: true, canRetract: false, canSupersede: false, maxConfidence: 0.5 },
    probationary: { canAssert: true, canRetract: false, canSupersede: true, maxConfidence: 0.8 },
    trusted: { canAssert: true, canRetract: true, canSupersede: true, maxConfidence: 1.0 },
    admin: { canAssert: true, canRetract: true, canSupersede: true, maxConfidence: 1.0 }
  }
})
```

**Surface**: MCP tool (`limen_configure`) + enforcement in existing assertion/retraction paths.
**Depends on**: Existing RBAC engine + agent trust model.
**Schema change**: Possibly none — trust policy could be stored as claims with `config.trustPolicy.*` predicates, or as a simple JSON config table.

---

## SUPERPOWER 10: USER/PREFERENCE MODEL

### Should Limen Have This?

**YES.** [Evidence level: LIKELY]

Every personalized AI agent needs to store and retrieve user preferences. Today, developers store preferences as regular claims (e.g., `entity:user:femi` with `preference.reasoning_style` = "first_principles"). This works but lacks structure — preferences are mixed in with facts, decisions, and observations.

### Why Every Developer Needs It

A first-class profile system gives developers a clean API for the most common knowledge pattern: storing and retrieving preferences, behavioral patterns, and decision tendencies for a specific entity (user, team, organization).

### How It Works in Limen

A thin MCP convenience layer over the existing claim system. Profiles are just claims with a `profile.*` predicate convention, but the MCP tool provides a more ergonomic interface.

### Proposed API

```typescript
// Set a profile attribute
limen_profile_set({
  entity: "user:femi",                     // maps to subject "entity:user:femi"
  attribute: "reasoning_style",            // maps to predicate "profile.reasoning_style"
  value: "first_principles",
  confidence: 1.0
})

// Get a profile
limen_profile_get({
  entity: "user:femi"
})
// Returns: {
//   "reasoning_style": { value: "first_principles", confidence: 1.0 },
//   "rejects": { value: "patches_over_root_causes", confidence: 1.0 },
//   "communication": { value: "direct_terse_no_summaries", confidence: 0.9 }
// }

// Profile diff — what changed since last session?
limen_profile_diff({
  entity: "user:femi",
  since: "2026-03-29T00:00:00Z"
})
```

**Surface**: New MCP tools (3 tools).
**Depends on**: Existing CCP.
**Schema change**: None — uses existing claim schema with predicate conventions.

---

## SUPERPOWER 11: DAG DISPATCH

### Should Limen Have This?

**NO.** [Evidence level: CONFIRMED]

DAG execution is orchestration, not cognition. Limen already has mission/task hierarchies with dependency tracking (`propose_task_graph` system call accepts tasks and dependencies). But the EXECUTION of the DAG — dispatching agents, monitoring progress, handling failures, parallelizing work — is a client-side concern.

Building a DAG execution engine into Limen would violate the separation between infrastructure (Limen) and application logic (the orchestrator). Limen tracks the KNOWLEDGE of what tasks exist and their dependencies. It does not execute them.

### Recommendation

Document how to use `propose_task_graph` with dependencies to model a DAG in Limen, then implement the execution engine in client code. This is exactly what ConvOps Core does on top of Limen — application logic on cognitive infrastructure.

---

## SUPERPOWER 12: AGENT SPECIALIZATION

### Should Limen Have This?

**YES.** [Evidence level: LIKELY]

Limen already tracks claim provenance (every claim records `sourceAgentId`). It already has agent trust levels. The missing piece: performance scoring. If Agent A's claims are frequently superseded or retracted, that agent's future claims should carry less implicit authority.

### Why Every Developer Needs It

Multi-agent systems produce knowledge of varying quality. Developers need to know which agents are reliable and which are not — not by manual inspection but by automatic tracking.

### How It Works in Limen

Compute agent reliability scores from existing data:
- Count of claims that were superseded / total claims = supersession rate
- Count of claims that were retracted / total claims = retraction rate
- Count of claims with `contradicts` relationships / total claims = contradiction rate
- Weighted combination = reliability score

### Proposed API

```typescript
// Query agent reliability
limen_agent_stats({ name: "builder-1" })
// Returns: {
//   totalClaims: 234,
//   superseded: 12,     supersessionRate: 0.051,
//   retracted: 3,       retractionRate: 0.013,
//   contradicted: 8,    contradictionRate: 0.034,
//   reliabilityScore: 0.91,
//   domains: {
//     "decision.*": { claims: 45, reliability: 0.95 },
//     "architecture.*": { claims: 89, reliability: 0.88 }
//   }
// }
```

**Surface**: New MCP tool.
**Depends on**: Existing CCP + agent model.
**Schema change**: None — computed from existing data. Could optionally cache in an `agent_stats` table for performance.

---

## SUPERPOWER 13: REAL-TIME MONITORING

### Should Limen Have This?

**YES — and it essentially already does.** [Evidence level: CONFIRMED]

The `EventBus` interface in `limen/src/kernel/interfaces/events.ts` already supports:
- `subscribe(pattern, handler)` — subscribe to events matching glob patterns
- `registerWebhook(pattern, url, secret)` — external webhook delivery with HMAC signing
- At-least-once delivery with exponential backoff (3 retries)

The event system emits events for mission lifecycle, task state changes, and custom agent events. What is missing: claim-specific events. When a claim is asserted, retracted, superseded, or contradicted, no event is currently emitted.

### Proposed Enhancement

Add claim lifecycle events to the existing event system:

```
claim.asserted   — fires when a new claim is stored
claim.retracted  — fires when a claim status transitions to retracted
claim.superseded — fires when a supersedes relationship is created
claim.contradicted — fires when a contradicts relationship is created
```

### Proposed API

```typescript
// Already exists — subscribe to events
limen.events.subscribe("claim.*", (event) => {
  console.log(`Claim ${event.payload.claimId} was ${event.type}`);
});

// Already exists — webhook for external systems
limen.events.registerWebhook(conn, ctx, "claim.asserted", "https://my-app.com/hooks/limen", secret);

// NEW MCP tool — subscribe from MCP client
limen_subscribe({
  pattern: "claim.*",
  webhook: "https://my-monitor.com/limen-events"
})
```

**Surface**: MCP tool + event emission in CCP assertion/retraction/relationship paths.
**Depends on**: Existing EventBus infrastructure.
**Schema change**: None.

---

## SUPERPOWER 14: SYNTHESIS ENGINE

### Should Limen Have This?

**PARTIAL.** [Evidence level: UNCERTAIN]

Knowledge synthesis requires LLM reasoning — "here are 47 claims about audio processing, what is the synthesized understanding?" Limen's constitutional principle is that the kernel never reasons. The kernel stores, validates, links, and audits.

However, Limen DOES have a substrate layer (`src/substrate/`) that manages LLM transport. The synthesis engine could live in the substrate as a governed LLM call — the kernel provides the claims, the substrate synthesizes, and the result is stored back as a new claim with `derived_from` relationships to all source claims.

### Why Every Developer Needs It

Any agent with > 100 claims on a topic needs consolidation. Without it, knowledge sprawl makes retrieval noisy — 47 individual observations when what you need is one synthesized understanding.

### How It Works in Limen

A new MCP tool that: (1) queries claims matching a filter, (2) sends them to the substrate LLM with a synthesis prompt, (3) stores the result as a new claim with `derived_from` relationships.

### Proposed API

```typescript
// Synthesize knowledge on a topic
limen_synthesize({
  filter: { subject: "entity:subsystem:audio-*", predicate: "finding.*" },
  maxSourceClaims: 50,
  outputPredicate: "synthesis.description"
})
// Returns: {
//   synthesisClaimId: "clm_abc",
//   sourceCount: 47,
//   synthesis: "Audio processing findings converge on three themes: ...",
//   relationships: [{ from: "clm_abc", to: "clm_001", type: "derived_from" }, ...]
// }
```

**Surface**: New MCP tool (substrate-dependent).
**Depends on**: CCP + substrate transport layer.
**Schema change**: None.
**Caveat**: Requires LLM access. If no substrate model is configured, tool returns an error. This is acceptable — not every Limen deployment has LLM access.

---

## ADDITIONAL CAPABILITY A: SELF-HEALING KNOWLEDGE

### Should Limen Have This?

**YES.** [Evidence level: CONFIRMED]

Research on event-driven knowledge graphs confirms: cascading updates that propagate changes through dependency chains are a fundamental requirement. When a claim is retracted, claims that were `derived_from` it or `supported` by it may no longer be valid. Today, they remain active with their original confidence — silent knowledge corruption.

### Why Every Developer Needs It

Knowledge damage propagation is the epistemic equivalent of a data integrity bug. If Claim A supports Claim B, and Claim A is retracted, Claim B's confidence should be automatically reduced. Without this, agents trust conclusions whose foundations have been removed.

### How It Works in Limen

When a claim is retracted:
1. Query all claims with a `derived_from` or `supports` relationship TO the retracted claim
2. For each downstream claim: reduce confidence by a configurable factor (default: 0.5x)
3. If the adjusted confidence falls below a threshold (default: 0.3), flag the claim as `needs_review`
4. Emit a `claim.cascade_weakened` event for each affected claim
5. Do NOT automatically retract downstream claims — flag them for human/agent review

This is a bounded cascade (maximum propagation depth configurable, default: 3) with a discount factor, consistent with the research on preventing runaway inference in knowledge graphs.

### Proposed API

```typescript
// Configuration
limen_configure({
  cascade: {
    enabled: true,
    confidenceDecay: 0.5,              // multiply confidence by this per hop
    minConfidence: 0.3,                // flag for review below this
    maxDepth: 3                        // max propagation hops
  }
})

// Automatic — fires on retraction
limen_retract({ claimId: "clm_foundation" })
// Side effect: downstream claims automatically weakened
// Event emitted: claim.cascade_weakened for each affected claim
// Response includes: { retracted: "clm_foundation", cascadeAffected: 5 }
```

**Surface**: Automatic behavior on retraction + MCP configuration.
**Depends on**: CCP + relationship graph traversal.
**Schema change**: Possibly add `needs_review` flag to claim_assertions (or use a convention-based approach with `system.needs_review` predicate claims).

---

## ADDITIONAL CAPABILITY B: CURIOSITY ENGINE

### Should Limen Have This?

**YES.** [Evidence level: LIKELY]

Knowledge gap detection is what transforms a passive store into an active cognitive partner. Today, Limen can tell you what it knows. It cannot tell you what it does NOT know. This asymmetry means blind spots remain invisible until they cause a failure.

### Why Every Developer Needs It

Every developer building a knowledge-driven agent wants to know: where are the gaps? If an agent has detailed knowledge about authentication but zero claims about authorization, that is a critical gap that should be surfaced proactively.

### How It Works in Limen

The curiosity engine requires a knowledge schema — a declaration of what predicates/domains SHOULD exist. This is defined per project (or per tenant). The engine compares actual claims against the schema and reports gaps.

### Proposed API

```typescript
// Define expected knowledge schema
limen_configure({
  knowledgeSchema: {
    domains: [
      { predicate: "architecture.*", minClaims: 5, description: "System architecture decisions" },
      { predicate: "security.*", minClaims: 3, description: "Security posture" },
      { predicate: "decision.*", minClaims: 1, description: "Key decisions" },
      { predicate: "risk.*", minClaims: 1, description: "Known risks" }
    ]
  }
})

// Query knowledge gaps
limen_gaps()
// Returns: {
//   gaps: [
//     { predicate: "security.*", expected: 3, actual: 0, severity: "critical" },
//     { predicate: "risk.*", expected: 1, actual: 0, severity: "warning" }
//   ],
//   coverage: 0.5     // 2 of 4 domains have sufficient claims
// }
```

**Surface**: New MCP tools (2 tools).
**Depends on**: CCP + configuration store.
**Schema change**: None if stored as claims; small table if stored separately.

---

## ADDITIONAL CAPABILITY C: ANALOGICAL REASONING

### Should Limen Have This?

**LATER — after vector search.** [Evidence level: UNCERTAIN]

Cross-domain pattern matching requires semantic similarity, which requires vector embeddings. This is Phase 3 of the Haystack Finder (Superpower 6). Building it before vector search is feasible (keyword overlap heuristics) but low-quality. Wait for the right infrastructure.

### Recommendation

Defer to post-v1.4.0. When vector search ships, add automatic cross-domain similarity detection as an optional behavior on claim assertion.

---

## ADDITIONAL CAPABILITY D: CONFIDENCE CALIBRATION

### Should Limen Have This?

**YES.** [Evidence level: CONFIRMED]

This is the intersection of Superpower 5 (Promise Accountability) and Superpower 12 (Agent Specialization). Track prediction accuracy over time per agent. If an agent's claims at confidence 0.9 are retracted 40% of the time, that agent's 0.9 is actually a 0.54. Apply this correction automatically.

### Why Every Developer Needs It

Confidence scores are meaningless without calibration. A well-calibrated agent's 0.8 confidence means "this will be correct 80% of the time." A poorly-calibrated agent's 0.8 might mean anything. Calibration turns confidence from opinion into measurement.

### How It Works in Limen

Extend agent stats (Superpower 12) with a calibration model:
1. For each agent, group claims by confidence bucket (0.0-0.2, 0.2-0.4, etc.)
2. For each bucket, calculate the retraction/supersession rate
3. The calibration curve maps stated confidence to observed reliability
4. Optionally: apply correction at query time (adjust returned confidence by calibration curve)

### Proposed API

```typescript
// Query calibration data
limen_agent_calibration({ name: "researcher" })
// Returns: {
//   calibrationCurve: [
//     { stated: [0.8, 1.0], observed: 0.72, sampleSize: 45 },
//     { stated: [0.6, 0.8], observed: 0.58, sampleSize: 23 },
//     { stated: [0.4, 0.6], observed: 0.31, sampleSize: 12 }
//   ],
//   overallBias: "optimistic",           // stated > observed consistently
//   biasAmount: 0.12                     // average overconfidence
// }

// Optional: auto-correct on recall
limen_recall({
  subject: "entity:api:*",
  calibrate: true                         // adjust confidence by agent calibration
})
```

**Surface**: New MCP tool + optional parameter on recall.
**Depends on**: CCP + agent provenance tracking (both exist).
**Schema change**: None — computed from existing data. Could cache in `agent_calibration` table.

---

## ADDITIONAL CAPABILITY E: KNOWLEDGE METABOLISM

### Should Limen Have This?

**YES — but as a deliberate, user-triggered operation.** [Evidence level: LIKELY]

Automatic consolidation is powerful but dangerous. If Limen autonomously merges 10 claims into 1, the original nuance may be lost. The right approach: offer consolidation as a tool, not as an automatic background process. The agent (or user) decides when to consolidate.

### Why Every Developer Needs It

Knowledge stores accumulate redundant observations over time. "The API is slow" stored 15 times with slightly different wording creates noise. Consolidation reduces noise while preserving provenance (the synthesis claim links back to all sources via `derived_from`).

### How It Works in Limen

This is a specialized case of Superpower 14 (Synthesis Engine). The difference: metabolism specifically targets redundant claims within a domain, while synthesis covers any topic.

### Proposed API

```typescript
// Find consolidation candidates
limen_consolidation_candidates({
  predicate: "finding.*",
  similarityThreshold: 0.8,              // requires FTS5 or vector similarity
  minClusterSize: 3
})
// Returns: [
//   { cluster: ["clm_1", "clm_2", "clm_3", "clm_4"], theme: "API latency", count: 4 },
//   { cluster: ["clm_5", "clm_6", "clm_7"], theme: "Auth token expiry", count: 3 }
// ]

// Consolidate a cluster (user-triggered)
limen_consolidate({
  claimIds: ["clm_1", "clm_2", "clm_3", "clm_4"],
  summary: "Groq API latency spikes occur during peak hours (2-4 PM PST), averaging 3.2s response time vs 0.4s baseline.",
  confidence: 0.9
})
// Creates synthesis claim + derived_from relationships
// Optionally archives source claims (configurable)
```

**Surface**: New MCP tools (2 tools, substrate-dependent for auto-summary).
**Depends on**: CCP + FTS5 or vector similarity for candidate detection.
**Schema change**: None.

---

## Architecture Summary: What Goes Where

### Core Level (System Call Enhancement) — REQUIRES PA APPROVAL

None of the proposed features require new system calls. This is by design. The existing system calls (SC-11 assert, SC-12 query, SC-13 retract, etc.) are sufficient. All enhancements are either:
- Schema additive (new nullable columns)
- MCP tools (thin wrappers over existing system calls)
- Automatic behaviors (triggered by existing operations)
- Configuration (stored as claims or in config tables)

### Surface Level (MCP Tools) — Fair Game

| Tool | Function | Depends On |
|---|---|---|
| `limen_search` | FTS5/vector search | FTS5 migration |
| `limen_predict` | Store prediction | Existing CCP |
| `limen_record_outcome` | Track prediction outcome | Existing CCP |
| `limen_calibration` | Query prediction accuracy | Existing CCP |
| `limen_profile_set` | Set entity profile attribute | Existing CCP |
| `limen_profile_get` | Get entity profile | Existing CCP |
| `limen_profile_diff` | Profile changes since date | Existing CCP |
| `limen_subscribe` | Subscribe to events via MCP | Existing EventBus |
| `limen_synthesize` | LLM-powered knowledge synthesis | CCP + Substrate |
| `limen_gaps` | Query knowledge gaps | CCP + config |
| `limen_configure` | Set quality gates, cascade, schema | New config store |
| `limen_agent_stats` | Agent reliability metrics | CCP + agent model |
| `limen_agent_calibration` | Agent confidence calibration | CCP + agent model |
| `limen_consolidation_candidates` | Find redundant claim clusters | CCP + FTS5/vector |
| `limen_consolidate` | Merge redundant claims | CCP |

### Automatic Behaviors — Triggered by Existing Operations

| Behavior | Trigger | Effect |
|---|---|---|
| Narrative injection | `session_open` | Load last `session.narrative` claim |
| Cognitive health metrics | `health` check | Compute freshness, conflicts, gaps |
| Temporal weighting | `recall` with temporalWeight | Recency-adjusted confidence |
| Quality gates | `assertClaim` | Reject claims failing quality rules |
| Cascade weakening | `retractClaim` | Reduce downstream claim confidence |
| Claim events | `assertClaim`, `retractClaim`, `relateClaims` | Emit `claim.*` events |

### Schema Migrations Required

| Migration | Change | Risk |
|---|---|---|
| Add `reasoning` column | `ALTER TABLE claim_assertions ADD COLUMN reasoning TEXT` | Zero — nullable, additive |
| FTS5 virtual table | `CREATE VIRTUAL TABLE claims_fts USING fts5(...)` | Low — new table, no existing data modified |
| Quality gates config | New table or claim-based config | Low — additive |

---

## Implementation Roadmap

### Phase 1: Low-Hanging Fruit (v1.3.0, alongside FTS5)

1. **Reasoning field** — additive column, update MCP tools. < 1 day.
2. **Enhanced health** — cognitive metrics in health response. < 1 day.
3. **Claim events** — emit events on assertion/retraction/relationship. < 1 day.
4. **Temporal weighting** — optional parameter on recall. < 1 day.
5. **Profile tools** — thin MCP wrappers over claims. < 1 day.

### Phase 2: Quality Infrastructure (v1.4.0)

1. **Quality gates** — configurable validation hooks. 2-3 days.
2. **Self-healing cascade** — confidence propagation on retraction. 2-3 days.
3. **Agent stats + calibration** — computed from existing data. 1-2 days.
4. **Narrative memory** — enhanced session open/close. 1-2 days.
5. **Promise accountability** — predict/outcome/calibration tools. 1-2 days.

### Phase 3: Search and Intelligence (v1.5.0)

1. **FTS5 search** — already approved. 3-5 days.
2. **Curiosity engine** — knowledge gap detection. 1-2 days.
3. **Consolidation candidates** — redundancy detection. 2-3 days.

### Phase 4: Advanced Cognitive (v2.0.0)

1. **Vector search** — semantic similarity. 5-7 days.
2. **Cross-domain analogy** — automatic pattern matching. 3-5 days.
3. **Synthesis engine** — LLM-powered consolidation. 2-3 days.
4. **Knowledge metabolism** — user-triggered consolidation. 1-2 days.

---

## Competitive Positioning

### What Limen Has That Nobody Else Does

1. **Deterministic governance** — every claim is audited, tenant-isolated, and evidence-linked. Mem0/Zep/Letta have none of this.
2. **Reasoning chains** — (with Superpower 4) derivation chains searchable via FTS5. No competitor stores WHY.
3. **Self-healing knowledge** — (with Capability A) automatic confidence propagation on retraction. No competitor does this.
4. **Confidence calibration** — (with Capability D) track prediction accuracy over time. Genuinely open problem in the field — Limen solves it.
5. **Constitutional safety** — the kernel never reasons, never decides, never hallucinates. It stores, validates, links, and audits. Intelligence is governed, not unrestrained.

### What Competitors Have That Limen Does Not (Yet)

1. **Vector search** — Mem0, Zep, Cognee all have it. Limen needs it (v1.4.0+).
2. **Memory compression** — Mem0 claims 80% token reduction. Limen should consider context compression for narrative summaries.
3. **Graph visualization** — Zep/Cognee provide visual knowledge graph exploration. Not a Limen priority (kernel, not UI) but valuable for debugging.

---

## The Thesis

Limen's competitive moat is not memory (everyone has memory). It is not search (everyone will have search). The moat is **epistemic governance** — the guarantee that what an agent remembers is audited, evidenced, temporally anchored, confidence-calibrated, and self-healing.

The 14 superpowers, translated into Limen features, transform it from a cognitive operating system that stores knowledge into one that GOVERNS knowledge. Every claim has provenance. Every confidence has calibration. Every retraction triggers cascade review. Every gap is detected. Every agent's reliability is measured.

No other framework in the 2026 landscape attempts this. Mem0 optimizes for retrieval speed. Zep optimizes for temporal relationships. Letta optimizes for LLM-driven memory management. Limen optimizes for TRUTH — governed, calibrated, audited truth.

That is the moat. That is what should be built.

---

## Sources

Research supporting this analysis:

- [6 Best AI Agent Memory Frameworks 2026](https://machinelearningmastery.com/the-6-best-ai-agent-memory-frameworks-you-should-try-in-2026/) — Framework comparison, Mem0/Zep/Letta feature analysis
- [Mem0 Graph Memory for AI Agents](https://mem0.ai/blog/graph-memory-solutions-ai-agents) — Mem0's graph memory architecture
- [5 AI Agent Memory Systems Compared (2026 Benchmark)](https://dev.to/varun_pratapbhardwaj_b13/5-ai-agent-memory-systems-compared-mem0-zep-letta-supermemory-superlocalmemory-2026-benchmark-59p3) — Benchmark data confirming confidence calibration is an open problem
- [Mem0 vs Zep vs LangMem vs MemoClaw Comparison](https://dev.to/anajuliabit/mem0-vs-zep-vs-langmem-vs-memoclaw-ai-agent-memory-comparison-2026-1l1k) — Feature matrix comparison
- [Agent Memory Solutions: Letta vs Mem0 vs Zep vs Cognee](https://forum.letta.com/t/agent-memory-solutions-letta-vs-mem0-vs-zep-vs-cognee/85) — Community discussion on epistemic governance gaps
- [Event-Driven Cascade Updates in Knowledge Graphs (KDD 2025)](https://kdd2025.kdd.org/wp-content/uploads/2025/07/paper_21.pdf) — Cascading update theory, discount factor for bounded propagation
- [Event-Driven Knowledge Graphs — Telicent](https://telicent.io/news/event-driven-knowledge-graphs/) — Real-time event-driven KG architecture
- [AI Agents in Production 2026](https://47billion.com/blog/ai-agents-in-production-frameworks-protocols-and-what-actually-works-in-2026/) — Production agent framework requirements
- [LLM Orchestration 2026: Top 22 Frameworks](https://aimultiple.com/llm-orchestration) — Orchestration landscape, reasoning chain approaches
- [AI Agent Monitoring Best Practices 2026](https://uptimerobot.com/knowledge-hub/monitoring/ai-agent-monitoring-best-practices-tools-and-metrics/) — Monitoring patterns, temporal degradation statistics (91% of models)

---

*SolisHQ — We innovate, invent, then disrupt.*
