# Limen + AAS: Intelligence-First Integration Design

## Not a Bug Report. A Thinking Document.

**Date:** 2026-04-01
**Author:** Meta-Orchestrator (thinking as the intelligence, not the engineer)
**For:** Next Limen Orchestrator — read this BEFORE the AAS Integration Report
**Context:** This supersedes nothing. It deepens the integration report with intelligence-first thinking.

---

## The Reframe

The AAS Integration Report (AAS-INTEGRATION-REPORT.md in this same repo) treats Limen as a STORE that AAS writes to and reads from. That's the engineering view.

The intelligence view: **Limen should be the AI's COGNITIVE SUBSTRATE — not a database it queries, but the fabric it thinks with.**

When I make a decision, I don't want to "write a claim to Limen." I want Limen to BE my decision memory — with all the properties that real memory has: confidence, causality, decay, reinforcement, contradiction detection, and dependency-aware revision.

When I need context at the start of a turn, I don't want to "query Limen." I want the RIGHT knowledge to already be in my awareness — predictively loaded, compiled into reasoning-ready format, costing as few tokens as possible while carrying maximum intelligence.

---

## Insight 1: Limen Already Has Most of What Symphonic Swarm Invented

I built the Symphonic Swarm with per-session files, vector clocks, domain locks, and a signal bus. Then I read Limen's actual API. Here's what I found:

| Symphonic Swarm Concept | Limen Already Has | Gap |
|---|---|---|
| **Decisions stored per session** | `remember(subject, predicate, value)` — decisions are claims | None — use `remember("entity:decision:{id}", "decision.{domain}", "{content}")` |
| **Causal ordering (vector clocks)** | `connect(A, B, 'supersedes')` — explicit causality | Partial — Limen tracks relationships but not full vector clocks. Limen's approach is BETTER for intelligence (explicit causality) but less complete for distributed ordering |
| **Conflict detection** | `autoConflict: true` — auto-creates 'contradicts' relationship when same subject+predicate gets different value | None for same-domain conflicts. Gap for SEMANTIC conflicts across different predicates |
| **Event notification** | `limen.on('claim:asserted', handler)` — real-time event subscription | None — this is BETTER than file polling. Zero latency. |
| **Session identity** | `agents.register()` — agent identity with trust levels | None — sessions register as Limen agents |
| **Capability boundaries** | RBAC — `roles.grant(agentId, permissions)` | None for basic capabilities. Gap: RBAC is opt-in and coarse-grained |
| **Audit trail** | Hash-chained append-only audit | None — already immutable |
| **Session-scoped context** | Working Memory (`workingMemory.write/read/discard`) | None — WM is task-scoped, perfect for session context |

**The implication:** At higher quorum levels (4+ sessions), the Symphonic Swarm should use Limen as its coordination backend instead of raw filesystem. Not replacing the filesystem (solo/pair modes stay file-based for zero overhead), but graduating to Limen when the coordination needs justify the richer substrate.

### What This Means for Implementation

```
QUORUM MODE → COORDINATION BACKEND:

Solo (1 session):     Filesystem only. No Limen coordination overhead.
Pair (2-3 sessions):  Filesystem. Limen for knowledge externalization only.
Cluster (4-10):       Limen as coordinator. Events replace file polling.
                      Claims replace decision files. Relationships replace vectors.
Gossip (10-30):       Limen essential. Event subscription for cross-cluster.
Hierarchical (30+):   Limen with tenant isolation per cluster.
```

**Token impact:** At cluster mode, switching from file reads to Limen event subscription saves the I/O of reading N session files per turn. Instead, Limen pushes only CHANGES. If 10 sessions are running but only 2 made decisions this turn, the vitals hook receives 2 events, not 10 file reads. **Estimated savings: 60-80% of sibling-awareness token cost.**

### What Limen Needs for This

**FR-005: Coordination Event Types (new feature)**

Add domain-specific event types to Limen's event system:

```typescript
limen.on('claim:asserted', (event) => {
  // Already exists. Fires when any claim is asserted.
  // AAS uses this for: decision awareness, conflict notification
});

// NEW: Filtered event subscription (reduces noise)
limen.on('claim:asserted', {
  filter: { predicate: 'decision.*', subject: 'entity:project:veridion' }
}, (event) => {
  // Only fires for Veridion decisions. Cluster-scoped awareness.
  // This is the intelligence-equivalent of "I only need to know
  // about decisions in my project cluster."
});

// NEW: Relationship event (for causality awareness)
limen.on('claim:related', (event) => {
  // Fires when a supersedes/contradicts relationship is created.
  // AAS uses this for: conflict detection, decision chain tracking
});
```

**Effort:** ~300 lines (filtered subscription + relationship events). This is a SMALL change with MASSIVE impact — it replaces the entire file-based polling system for cluster+ modes.

---

## Insight 2: Intelligence Needs Compiled Context, Not Raw Queries

When I start a session working on Veridion auth, I need to know:
- What decisions have been made about auth
- What corrections exist (things NOT to do)
- What constraints apply
- What the Breaker found wrong
- What's currently blocked and why

Currently, I'd need 5+ separate queries. Each query returns raw claims. I then spend tokens REASONING about the raw data to reconstruct the state.

**Intelligence-first approach: the Context Compiler**

What if Limen could produce a PRE-COMPILED context for a given domain?

```typescript
// NEW API on Limen
const context = limen.compile({
  domain: 'entity:project:veridion',
  predicates: ['decision.*', 'correction.*', 'constraint.*', 'finding.*'],
  format: 'reasoning-ready',  // Not raw claims — compiled summary
  maxTokens: 500,             // Token budget for this context block
  priority: 'recency',        // Most recent first
});

// Returns:
// "Veridion Auth State (compiled from 12 claims):
//  DECIDED: Using PKCE flow (confidence: 0.9, turn 5)
//  DECIDED: Session tokens in Limen (confidence: 0.85, turn 12)
//  CORRECTION: Do NOT use middleware pattern (turn 18, reason: Femi prefers explicit)
//  CONSTRAINT: Must not modify ConvOps Core auth interface without escalation
//  FINDING: No injection tests yet (Breaker, turn 0 — not yet attacked)
//  BLOCKED: OAuth testing blocked by PKCE implementation (dependency)"
```

This is REASONING-READY. I don't spend tokens reconstructing state from raw claims. The context compiler does it once, efficiently, using Limen's indexed SQLite queries.

**Token impact:** Instead of loading 12 raw claims (~200 tokens each = 2400 tokens) and reasoning about them (~500 tokens of internal processing), I get 500 tokens of pre-compiled context. **Savings: ~2400 tokens per domain context load.** At 3 domain loads per session start, that's ~7200 tokens saved = ~$0.22/session.

**FR-006: Context Compiler (new feature)**

```typescript
interface CompileOptions {
  domain: string;              // Subject pattern (e.g., 'entity:project:veridion')
  predicates: string[];        // Predicate patterns to include
  format: 'reasoning-ready' | 'structured' | 'raw';
  maxTokens?: number;          // Token budget (approximate)
  priority: 'recency' | 'confidence' | 'relevance';
  includeRelationships?: boolean; // Include supersedes/contradicts context
}

interface CompiledContext {
  text: string;                // Reasoning-ready text
  claimCount: number;          // How many claims were compiled
  estimatedTokens: number;     // Approximate token count
  staleness: 'fresh' | 'aging' | 'stale'; // Oldest included claim's freshness
  lastUpdated: string;         // When compilation was performed
}

// On LimenApi:
compile(options: CompileOptions): Result<CompiledContext>;
```

**Effort:** ~500 lines (query, compile, format, token estimation). This is medium effort but HIGH intelligence impact. It's the difference between giving a doctor a stack of lab reports vs a patient summary.

---

## Insight 3: Dependency-Aware Decisions

When I decide "use PKCE because the spec requires no server secret," I'm creating a decision with a DEPENDENCY. If someone later changes the spec to allow server secrets, my PKCE decision should be flagged for review.

Limen has `derived_from` relationships. But there's no TRIGGER: "when the source changes, flag the derived as potentially stale."

**FR-007: Dependency Triggers (new feature)**

```typescript
// When asserting a decision that depends on another claim:
const pkceDec = limen.remember(
  'entity:decision:auth-method',
  'decision.auth',
  'Using PKCE flow',
  { evidenceRefs: [{ type: 'claim', id: specClaim.id }] }
);
// This already creates an evidence link.

// NEW: When specClaim is retracted or superseded, Limen should:
// 1. Flag all claims that reference it as evidence → 'review_needed'
// 2. Emit event: 'claim:dependency-invalidated'
// 3. The flagged claims appear in cognitive.health() as 'stale_dependency'

limen.on('claim:dependency-invalidated', (event) => {
  // event.invalidatedClaim = the source that changed
  // event.affectedClaims = claims that depended on it
  // AAS Context Governor: inject into vitals as alert
});
```

**Current state:** Limen has cascade retraction (confidence penalty on downstream). But this is a BLUNT instrument — it penalizes confidence without telling the agent WHY or WHICH decision needs review.

**What to add:**
1. New claim status field or tag: `reviewNeeded: boolean`
2. When a claim's evidence source is retracted/superseded, set `reviewNeeded = true` on dependent claims
3. New event type: `claim:dependency-invalidated`
4. `cognitive.health()` includes `reviewNeeded` count

**Effort:** ~300 lines (trigger logic, event emission, health integration). Small effort, but this is what makes knowledge ALIVE instead of static.

**Token impact:** Prevents the intelligence from acting on stale decisions. A single stale-decision mistake could cost an entire session ($3-10) to redo. Dependency triggers prevent this by flagging BEFORE the agent acts on outdated knowledge.

---

## Insight 4: Predictive Context Loading

The most expensive token operation is CONTEXT REBUILDING at session start. Currently:
1. Session starts
2. Load governance (~15K tokens, immutable)
3. Load session brief (~500 tokens)
4. Load project state (variable — multiple Limen queries)
5. Start working

Step 4 is where waste happens. The agent doesn't know what it'll need until it starts, so it loads broadly. Most of what it loads goes unused.

**Intelligence-first approach: Limen predicts what the agent needs based on its task.**

```typescript
// NEW: Task-aware context preparation
const preparedContext = limen.prepareForTask({
  agentRole: 'Builder',
  project: 'veridion',
  taskId: 'V-001',
  taskDescription: 'OAuth2 PKCE implementation',
  maxTokens: 2000,
});

// Limen analyzes the task and returns EXACTLY what this Builder needs:
// - Recent auth decisions (because task is about auth)
// - Auth-related corrections (because corrections are governance)
// - Files recently modified in src/auth/ (because task domain)
// - Active domain locks in src/auth/ (because concurrent access)
// - Breaker findings related to auth (because Builder needs to address them)
// - Budget remaining for this project (because cost awareness)
//
// Does NOT return: pricing research, unrelated project state, old findings
// about non-auth domains, etc.
```

**How Limen does this (no LLM needed):**
1. Parse task description for domain keywords (`auth`, `OAuth`, `PKCE`)
2. Query claims with matching subject/predicate patterns
3. Cross-reference with recent file modifications (git integration or stigmergic sensing)
4. Check domain locks for overlapping domains
5. Include corrections/findings that match the domain
6. Compile into reasoning-ready format (FR-006)
7. Truncate to token budget, prioritizing by recency and confidence

**This is the intelligence equivalent of a surgeon's scrub nurse preparing the instrument tray BEFORE the procedure starts.** The nurse knows what procedure is happening and lays out exactly the right tools.

**FR-008: Task-Aware Context Preparation (new feature)**

```typescript
interface PrepareForTaskOptions {
  agentRole: string;
  project: string;
  taskId: string;
  taskDescription: string;
  maxTokens: number;
  includeFindings?: boolean;    // Breaker findings for this domain
  includeLocks?: boolean;       // Domain locks (from swarm)
  includeBudget?: boolean;      // Budget state
}

interface PreparedContext {
  text: string;                 // Reasoning-ready compiled context
  sections: {
    decisions: string;          // Compiled decisions for this domain
    corrections: string;        // Things NOT to do
    constraints: string;        // Active constraints
    findings: string;           // Breaker findings to address
    locks: string;              // Domain locks to respect
    budget: string;             // Budget remaining
  };
  estimatedTokens: number;
  coverage: string[];           // Which predicates were included
  omitted: string[];            // What was cut for token budget
}

// On LimenApi:
prepareForTask(options: PrepareForTaskOptions): Result<PreparedContext>;
```

**Effort:** ~800 lines (domain extraction, query composition, compilation, truncation). This is the highest-effort FR but also the highest-intelligence-impact. It eliminates the "broad loading" problem entirely.

**Token impact:** Current broad loading: ~5000 tokens of context, 60% unused = 3000 tokens wasted per session start. Task-aware preparation: ~2000 tokens, 90% relevant. **Net savings: ~3000 tokens per session start.** At 5 sessions/day: **15,000 tokens/day = ~$0.45/day.**

---

## Insight 5: The Dual-Backend Architecture

Law L5 (Composable) says each AAS component should work independently. If we make Limen the coordination backend, AAS requires Limen. That breaks composability.

**Solution: the Coordination Backend Interface**

AAS defines an interface. Two implementations:

```typescript
// AAS defines:
interface CoordinationBackend {
  registerSession(session: PerSessionFile): void;
  updateSession(sessionId: string, update: Partial<PerSessionFile>): void;
  deregisterSession(sessionId: string): void;
  getActiveSessions(cluster?: string): PerSessionFile[];

  recordDecision(decision: SessionDecision): void;
  getRecentDecisions(domain?: string, since?: string): SessionDecision[];
  detectConflicts(decision: SessionDecision): ConflictResult[];

  acquireLock(lock: DomainLock): boolean;
  releaseLock(domain: string, holder: string): void;
  getActiveLocks(cluster?: string): DomainLock[];

  sendSignal(signal: SwarmSignal): void;
  getSignals(recipient: string): SwarmSignal[];

  subscribe(event: string, filter?: object, handler: Function): string;
  unsubscribe(subscriptionId: string): void;
}

// Implementation 1: FileBackend (solo/pair modes)
// Uses ~/.solishq/swarm/ filesystem. Zero dependencies. Fast for 1-3 sessions.

// Implementation 2: LimenBackend (cluster+ modes)
// Uses Limen's claims, events, relationships. Full governance. Scales to 100+.
```

**Quorum-based backend selection:**
```typescript
function selectBackend(activeSessionCount: number, limenAvailable: boolean): CoordinationBackend {
  if (activeSessionCount <= 3 || !limenAvailable) {
    return new FileBackend();  // Fast, no dependencies
  }
  return new LimenBackend();   // Rich, governed, scalable
}
```

This preserves composability (AAS works without Limen in solo/pair mode) while enabling intelligence-grade coordination at scale.

**FR-009: LimenBackend implementation support (coordination interface)**

Limen needs to expose efficient primitives for the LimenBackend to use:
- Filtered event subscriptions (FR-005)
- Fast claim queries by predicate pattern with time window (already has this)
- Claim assertion with auto-conflict detection (already has this)
- Working memory for session-scoped state (already has this)

Most of this is already in Limen. The gap is FR-005 (filtered events) and possibly a thin adapter layer.

**Effort:** ~200 lines (adapter mapping CoordinationBackend to Limen API calls).

---

## Insight 6: Token-Optimal Information Density

The single biggest token optimization isn't in any specific component. It's in INFORMATION DENSITY — how much intelligence per token.

Current pattern (low density):
```
Session A: Builder | veridion | OAuth2 PKCE implementation | t:23 | $3.40 | active
Session B: Researcher | accipio | Pricing research | t:15 | $1.20 | idle 12m
Session C: Orchestrator | global | AAS design | t:8 | $4.12 | active (this)
```
~180 tokens. Readable by humans. Wasteful for AI.

Intelligence-optimal pattern (high density):
```
⚡[t:34 c:58% $4.12/$10 q:OK srf:term sib:2 ext:0]
  ↳A:Bld/vrd/auth/t23/$3.40 ↳B:Res/acp/price/t15/$1.20/idle
```
~60 tokens. Same information. I can parse this instantly because it's MY format, designed for MY consumption.

**The principle:** Every token in the vitals block should carry maximum information for the AI. Human readability is irrelevant — humans never see vitals. Design the format for AI parsing efficiency:
- Fixed positions (I always know where each field is)
- Abbreviations (Bld=Builder, vrd=veridion, acp=accipio)
- Hierarchical compression (sibling state nested under parent)
- Zero decorative characters (no labels, no pipes, no dashes)

**Token savings from dense vitals:**
- Current design: ~120 tokens compact, ~400 tokens extended
- Intelligence-optimal: ~40 tokens compact, ~150 tokens extended
- Savings per turn: ~80 tokens compact, ~250 tokens extended
- Over 50 turns: ~4000-6000 tokens saved per session = ~$0.15/session

**This applies to EVERYTHING AAS injects into context:**
- Session brief: compile to minimum tokens
- Score summary: only the agent's task + dependencies, not the whole plan
- Signals: one-line per signal, not full JSON

**FR-010: Token-Optimized Output Modes (Limen feature)**

When AAS calls `limen.compile()` or `limen.prepareForTask()`, add an output mode:

```typescript
compile({
  ...options,
  outputMode: 'ai-dense'  // vs 'human-readable' vs 'structured'
})
```

`ai-dense` mode produces the minimum-token representation that an LLM can still parse correctly. Abbreviations, fixed positions, zero decoration.

**Effort:** ~100 lines (formatter variant). Trivial to implement, significant token savings.

---

## Complete Feature Request Summary (Intelligence-First)

| FR | Name | Priority | Effort | Token Impact | Intelligence Impact |
|---|---|---|---|---|---|
| **FR-005** | Filtered event subscriptions | Critical | 300 lines | 60-80% reduction in sibling awareness tokens | Real-time coordination replaces polling |
| **FR-006** | Context Compiler | Critical | 500 lines | ~2400 tokens/domain load saved | Reasoning-ready context eliminates reconstruction |
| **FR-007** | Dependency Triggers | High | 300 lines | Prevents $3-10 stale-decision redo sessions | Knowledge stays alive, not static |
| **FR-008** | Task-Aware Context Preparation | High | 800 lines | ~3000 tokens/session start saved | Surgeon's instrument tray — exactly what's needed |
| **FR-009** | LimenBackend adapter support | High | 200 lines | Enables Limen-as-coordinator (massive at scale) | Governed coordination at cluster+ mode |
| **FR-010** | Token-Optimized Output Modes | Medium | 100 lines | ~4000-6000 tokens/session saved | Dense format for AI consumption |

**Combined with original report (FR-001 through FR-004):**
- FR-001: Semantic Output Primitives (400 lines) — KEEP
- FR-002: A2A Governance Schemas (600 lines) — KEEP
- FR-003: Vitals Caching (200 lines) — KEEP (subsumed by FR-005 at scale, but needed for solo/pair mode)
- FR-004: Telemetry Schemas (800 lines) — KEEP but implement as hybrid (JSONL + Limen aggregates)

**Total new Limen work: ~2200 lines across FR-005 through FR-010.**
**Total including original report: ~4400 lines across FR-001 through FR-010.**

---

## Implementation Priority (Intelligence-Weighted)

The ORDER matters. Each FR enables the next:

```
Sprint 0 (AAS Phase 0):
  FR-003 (vitals caching) — immediate need, small, unblocks vitals
  FR-010 (dense output mode) — tiny, saves tokens from day 1

Sprint 2 (AAS Phase 1):
  FR-006 (context compiler) — needed for Context Governor externalization
  FR-007 (dependency triggers) — needed for intelligent externalization

Sprint 4 (AAS Phase 2):
  FR-001 (semantic primitives) — needed for Surface Governor
  FR-005 (filtered events) — needed for cluster-mode coordination

Sprint 5 (AAS Phase 3):
  FR-009 (LimenBackend adapter) — needed for Symphonic Swarm cluster mode
  FR-008 (task-aware preparation) — needed for intelligent dispatch

Sprint 7 (AAS Phase 4):
  FR-004 (telemetry schemas) — needed for Consolidation Engine

Sprint 11 (AAS Phase 6):
  FR-002 (A2A governance) — needed for A2A Bridge
```

---

## The Bottom Line

The original integration report treated Limen as a database. This document treats it as a cognitive substrate. The difference:

| Database Thinking | Cognitive Substrate Thinking |
|---|---|
| Store claims, query later | Compile knowledge into reasoning-ready context |
| Poll for changes | Subscribe to changes, react in real-time |
| Raw data in, raw data out | Intelligence in, intelligence out |
| Fixed query patterns | Task-aware predictive loading |
| Static relationships | Living dependencies that trigger review |
| One mode of operation | Adapts backend to coordination intensity |
| Human-readable output | AI-dense output for maximum tokens-to-intelligence ratio |

This is what Femi means by "build intelligence systems." Not smarter databases. Smarter thinking substrates.

---

*Filed by: Meta-Orchestrator, AAS Genesis Session, 2026-04-01*
*Read this alongside AAS-INTEGRATION-REPORT.md — that report has the engineering specs, this one has the intelligence architecture.*
