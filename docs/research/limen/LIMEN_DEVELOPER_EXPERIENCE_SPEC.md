# Limen Developer Experience Specification

**Status**: RESEARCH COMPLETE — READY FOR ACTION
**Version**: 1.0
**Date**: 2026-03-30
**Producer**: Researcher (Meta-Orchestrator)
**Consumer**: Builder, Product, Marketing
**Evidence Level**: CONFIRMED (source code read) + LIKELY (competitor analysis from public docs)

---

## Executive Summary

Limen has extraordinary engineering underneath. The governance layer, audit trail, encryption, invariant system, and architectural rigor are genuinely unmatched in the AI agent infrastructure space. But a developer who finds `limen-ai` on npm today will never discover any of that, because the onboarding experience has five critical failures:

1. **Identity crisis**: The README positions Limen as an LLM chat wrapper (first example is `limen.chat()`), not a knowledge/governance engine. This puts it in direct comparison with Vercel AI SDK and LangChain — where it loses on maturity and community.
2. **The knowledge API is a stub**: `knowledge_api.ts` returns `{ memoriesCreated: 0 }`. The claim protocol exists and works, but is buried behind branded types and URN syntax that no developer would choose over Mem0's `client.add(messages)`.
3. **No examples directory ships with npm**: The `files` field in package.json includes only `dist/`, `LICENSE`, `README.md`, `CHANGELOG.md`. Examples exist in the repo but not in the package.
4. **Native dependency friction**: `better-sqlite3` requires C++ compilation. On Windows without Visual Studio build tools, on Node.js 25, and in many CI environments, `npm install limen-ai` fails before the developer writes a single line of code.
5. **Concept overload**: A developer must understand branded types (`TenantId`, `AgentId`, `MissionId`, `TaskId`), the system call model, grounding modes, evidence types, and claim lifecycle before storing a single fact. Mem0 requires: `client.add(messages, { user_id: "..." })`.

The opportunity is enormous. Nobody in this space has what Limen has: governed knowledge with audit trails, temporal anchoring, evidence chains, and relationship graphs. But the packaging makes it invisible.

---

## Part 1: The Current State (What Exists Today)

### 1.1 README.md — First Impressions

**What works:**
- Clean visual hierarchy with badges
- The 3-line hello world is genuinely impressive (`createLimen()` → `chat()` → `shutdown()`)
- "What's Running Underneath" section is compelling — showing the invisible governance layer
- Architecture diagram is clear
- Comparison table is honest (explicitly acknowledges low adoption)
- Trust Surface section with proof documents is unique in the ecosystem

**What fails:**
- **The first example is chat, not knowledge.** A developer looking for "AI agent memory" sees a chat wrapper and bounces. The README buries the claim protocol (the actual differentiator) under missions, sessions, and system calls.
- **577 lines.** No developer reads this. The README tries to be the documentation, the quickstart, the architecture guide, and the API reference simultaneously.
- **"Cognitive Operating System" framing.** Confirmed by the positioning document's own A4 assumption: this likely causes confusion, not curiosity. A developer searching "how to add memory to AI agent" does not search for "cognitive operating system."
- **The knowledge example (07-knowledge.ts) uses `null as unknown as TenantId`.** This is the example that's supposed to sell the claim protocol. It opens with a type-safety hack.
- **No "memory" or "remember" in the first 50 lines.** The words developers search for — memory, remember, recall, store, knowledge — appear late or not at all in the opening.

### 1.2 package.json — Install Experience

**What works:**
- Single production dependency (genuinely impressive)
- Clean exports map with three entry points
- Keywords cover the LLM provider landscape

**What fails:**
- **Description**: "Cognitive Operating System — deterministic infrastructure hosting stochastic cognition." This is poetry, not a description. npm search results show this string. A developer searching for "ai agent memory" will not click this.
- **Keywords missing**: `memory`, `knowledge`, `remember`, `recall`, `agent-memory`, `knowledge-graph`, `governance`, `audit`. These are what developers search for.
- **Node.js >= 22 requirement**: Cuts off developers on Node 18 LTS and Node 20 LTS. As of March 2026, Node 20 is still in active LTS. This eliminates a large portion of the potential user base.
- **`better-sqlite3` native compilation**: Confirmed through issue tracker research — fails on Node 25, fails on Windows without Visual Studio build tools, fails in many Docker slim images without build-essential. The developer's first interaction with Limen is a compilation error.

### 1.3 Examples Directory

Eight examples exist in the repository:

| File | What It Shows | Lines | Friction |
|------|--------------|-------|----------|
| 01-hello.ts | Basic chat | 5 | Clean, good |
| 02-streaming.ts | Stream chunks | ~15 | Good |
| 03-structured-output.ts | JSON schema inference | ~30 | Good |
| 04-multi-provider.ts | Provider routing | ~20 | Good |
| 05-sessions.ts | Multi-turn with fork | 33 | Good |
| 06-missions.ts | Autonomous agent missions | ~40 | Complex but appropriate |
| 07-knowledge.ts | Claim protocol | 73 | **Severe friction** — `null as unknown as TenantId` casts, branded types, verbose |
| 08-governance-visible.ts | Logger + governance metadata | 43 | Good — shows invisible layer |

**Critical gap**: No example for the simplest use case — "remember this fact and recall it later." Example 07 jumps straight to the full claim protocol with evidence chains and relationship graphs.

**Not shipped with npm package**: The `files` field excludes examples. A developer who `npm install limen-ai` gets zero examples.

### 1.4 Public API Surface

The `Limen` interface (from `src/api/interfaces/api.ts`) exposes:

```
limen.chat()          — LLM conversation
limen.infer()         — Structured output
limen.session()       — Multi-turn sessions
limen.agents          — Agent CRUD + trust progression
limen.missions        — Mission lifecycle
limen.knowledge       — STUB (returns zeros)
limen.claims          — ClaimApi (assertClaim, relateClaims, queryClaims)
limen.workingMemory   — Working memory (write, read, discard)
limen.roles           — RBAC management
limen.health()        — Three-state health
limen.metrics         — Prometheus-style metrics
limen.data            — Export/purge
limen.shutdown()      — Graceful teardown
```

**The knowledge gap**: `limen.knowledge` is a stub. The REAL knowledge system is `limen.claims` — but the API design forces the developer to provide branded types (`TenantId`, `AgentId`, `MissionId`, `TaskId`), grounding modes, evidence references, and temporal anchors to store a single fact. This is the correct model for governed systems but the wrong entry point for adoption.

**What's missing**: A high-level convenience API. Something like:

```typescript
limen.remember("user prefers dark mode", { tags: ["preference"] })
limen.recall("user preferences")
```

This does not exist. The lowest-level API available to consumers is the full claim protocol.

### 1.5 Documentation

**Exists:**
- `docs/getting-started.md` — Good walkthrough, but focuses on chat/infer, not knowledge
- `docs/architecture.md` — Excellent technical depth
- `docs/missions.md` — Mission system documentation
- `docs/deployment.md` — Production deployment guide
- `docs/security-model.md` — Security posture
- `docs/api/` — TypeDoc-generated API reference (HTML)
- `docs/proof/` — Evidence documents for trust claims

**Missing:**
- No knowledge/memory quickstart
- No "how to add memory to your agent" guide
- No recipes/cookbook
- No migration guide from competitors
- No troubleshooting guide
- No "concepts" page explaining subjects, predicates, claims, evidence
- No interactive playground or REPL

---

## Part 2: The Competitive Landscape

### 2.1 Mem0 — The Market Leader

**First interaction**: `pip install mem0ai` / `npm install mem0ai`
**Time to first working code**: ~2 minutes
**Lines of code for hello world**: 5

```javascript
import MemoryClient from 'mem0ai';
const client = new MemoryClient({ apiKey: 'your-api-key' });
await client.add([{ role: "user", content: "I prefer dark mode" }], { user_id: "user1" });
const results = await client.search("user preferences", { filters: { user_id: "user1" } });
```

**What Mem0 does right:**
- Natural language in, natural language out. No schemas, no URNs, no predicates.
- Automatic entity extraction — you pass chat messages, it extracts facts.
- Search is semantic — "what are my dietary restrictions?" finds "I'm vegetarian."
- Three scopes (user, session, agent) that match how developers think.
- Hosted API eliminates infrastructure concerns entirely.

**What Mem0 lacks (Limen's opportunity):**
- No audit trail. You cannot prove what was stored, when, or why.
- No governance. Any code can write/read/delete anything.
- No evidence chains. A "fact" in Mem0 has no provenance.
- No temporal anchoring. Facts are current or deleted, never versioned with validity windows.
- No relationships between facts (supports, contradicts, supersedes).
- Graph features require $249/month Pro tier.
- 49.0% on LongMemEval benchmark — significantly trails competitors.
- SaaS dependency — your data lives on their servers.

### 2.2 Zep — The Context Engineering Platform

**First interaction**: Cloud signup required or self-hosted with Neo4j
**Time to first working code**: ~15 minutes (cloud) / ~1 hour (self-hosted)
**Lines of code for hello world**: ~10

**What Zep does right:**
- Best temporal awareness in the space — tracks when facts became/ceased being true
- Knowledge graph with entity resolution
- `memory.get()` returns assembled context ready for LLM injection
- SOC2 Type 2 compliance

**What Zep lacks:**
- Community Edition deprecated — self-hosting means using raw Graphiti library
- Requires graph database infrastructure (Neo4j/FalkorDB)
- Credit-based pricing requires usage estimation upfront
- No local-first option

### 2.3 Letta — The Agent Runtime

**First interaction**: `npm install -g @letta-ai/letta-code`
**Time to first working code**: ~5 minutes
**Approach**: Full agent runtime, not a library

**What Letta does right:**
- Agents manage their own memory (OS-inspired tiers)
- Visual debugging with Agent Development Environment
- `/remember` command is natural and immediate
- Model-agnostic

**What Letta lacks:**
- It's a runtime, not a library. You adopt the whole system or nothing.
- Hours to deep productivity, not minutes.
- No governance or audit trail.
- Cannot be embedded — it IS the application.

### 2.4 Gap Analysis: What Nobody Has

| Capability | Mem0 | Zep | Letta | Limen |
|-----------|------|-----|-------|-------|
| Natural language storage | Yes | Partial | Yes | **No** |
| Semantic search/recall | Yes | Yes | Yes | **No** (exact match only) |
| Evidence provenance | No | No | No | **Yes** |
| Audit trail | No | No | No | **Yes** |
| Temporal anchoring | No | Yes | No | **Yes** |
| Claim relationships | No | Yes (graph) | No | **Yes** |
| Governance/RBAC | No | No | No | **Yes** |
| Local-first (no SaaS) | OSS option | Deprecated | Yes | **Yes** |
| Embeddable library | Yes | Yes | No | **Yes** |
| 3-line quickstart | Yes | No | No | **No** |
| Zero native deps | Yes | N/A | N/A | **No** (better-sqlite3) |

**The insight**: Limen has the strongest foundation (governance, audit, evidence, temporal) but the weakest developer entry point. Mem0 has the weakest foundation but the best developer entry point. The winning strategy is obvious: build Mem0's simplicity as a facade over Limen's governance.

---

## Part 3: The Developer Journey Redesign

### 3.1 The Three Promises

#### The 3-Line Promise

A developer should be able to store and recall knowledge in 3 lines after import:

```typescript
import { createLimen } from 'limen-ai';
const limen = await createLimen();
await limen.remember("The user prefers dark mode", { userId: "user-1", tags: ["preference"] });
```

And recall:

```typescript
const memories = await limen.recall("user preferences", { userId: "user-1" });
console.log(memories); // [{ text: "The user prefers dark mode", tags: ["preference"], ... }]
```

**Implementation**: This is a convenience layer over the claim protocol. `remember()` creates a claim with:
- `subject`: derived from `userId` or auto-generated
- `predicate`: derived from tags or `general.fact`
- `object`: the text
- `confidence`: 1.0 (explicit human input)
- `groundingMode`: `runtime_witness`

`recall()` queries claims with text matching (initially exact substring, eventually semantic when embeddings are added).

#### The 10-Line Promise

In 10 lines, a developer should see governed knowledge in action:

```typescript
import { createLimen } from 'limen-ai';

const limen = await createLimen();

// Store facts with automatic governance
await limen.remember("User prefers dark mode", { userId: "u1", tags: ["preference"] });
await limen.remember("User is vegetarian", { userId: "u1", tags: ["dietary"] });
await limen.remember("User is NOT vegetarian", { userId: "u1", tags: ["dietary"] });

// The last fact automatically supersedes the earlier contradicting one
const diet = await limen.recall("dietary preferences", { userId: "u1" });
console.log(diet); // Only the latest fact — with full audit trail of the change
```

#### The 30-Minute Promise

In 30 minutes, a developer should have:
1. Limen installed and running (5 min)
2. Facts stored and recalled (5 min)
3. A chatbot with persistent memory across sessions (10 min)
4. An agent that records decisions with evidence (10 min)
5. An understanding of how the audit trail works (dashboard/log inspection)

### 3.2 The API Simplification

#### Current API (Claim Protocol — Power Users)

```typescript
// 15 lines to store one fact
const result = limen.claims.assertClaim({
  tenantId: null as unknown as TenantId,
  agentId: 'analyst' as AgentId,
  missionId: 'mission-1' as MissionId,
  taskId: 'task-1' as TaskId,
  subject: 'European EV Market',
  predicate: 'market_size_2025',
  object: '$45.3 billion',
  confidence: 0.87,
  evidence: {
    type: 'artifact',
    artifactId: 'report-001',
    artifactVersion: 1,
    excerpt: 'Market analysis report Section 3.2',
  },
});
```

**Problems:**
1. Branded types require casting for simple use cases
2. Every claim needs mission/task context even for standalone knowledge
3. Subject/predicate model is powerful but requires upfront understanding
4. Evidence is mandatory even when the source is "the user told me"

#### Proposed API (Convenience Layer — All Developers)

Three tiers, from simple to powerful:

**Tier 1: Natural Language (new developers)**

```typescript
// Store
await limen.remember("The user prefers dark mode");
await limen.remember("Meeting with Sarah moved to Thursday", {
  userId: "u1",
  tags: ["calendar", "meeting"]
});

// Recall
const prefs = await limen.recall("user preferences");
const meetings = await limen.recall({ tags: ["meeting"] });
const everything = await limen.recall({ userId: "u1" });
```

**Tier 2: Structured Knowledge (intermediate developers)**

```typescript
// Store with explicit structure
await limen.knowledge.store({
  subject: "user:u1",
  fact: "prefers dark mode",
  confidence: 0.95,
  source: "user settings page",
  tags: ["preference", "ui"],
});

// Recall with filters
const facts = await limen.knowledge.query({
  subject: "user:u1",
  tags: ["preference"],
  minConfidence: 0.8,
});

// Relationships
await limen.knowledge.connect(factA.id, factB.id, "supports");
await limen.knowledge.supersede(oldFact.id, newFact.id);
```

**Tier 3: Governed Claims (power users, production systems)**

The current `limen.claims` API remains unchanged. Full branded types, evidence chains, grounding modes, temporal anchors. This is the API for systems that need provable audit trails.

**Key design principle**: Each tier compiles down to the tier below it. `remember()` creates a structured knowledge entry. Structured knowledge creates a governed claim. The audit trail captures everything regardless of which tier the developer used.

### 3.3 The Error Experience

**Current state**: `LimenError` with typed codes, `retryable` flag, and `cooldownMs`. This is well-designed at the system level.

**What's missing**: Developer-friendly error messages for onboarding scenarios.

**Proposed error messages:**

```
LimenError [NATIVE_BUILD_FAILED]
  better-sqlite3 failed to compile. This is a native module that requires C++ build tools.

  Fix for macOS:  xcode-select --install
  Fix for Ubuntu: sudo apt-get install build-essential python3
  Fix for Windows: npm install --global windows-build-tools
  Fix for Docker: Add "RUN apk add --no-cache build-base python3" to your Dockerfile

  Alternatively, set LIMEN_STORAGE=memory to use in-memory storage (data not persisted).

  More info: https://limen.dev/docs/troubleshooting#native-build
```

```
LimenError [NO_PROVIDER]
  No LLM provider configured. Limen needs at least one API key to chat.

  Set one of these environment variables:
    ANTHROPIC_API_KEY=sk-ant-...
    OPENAI_API_KEY=sk-...
    GEMINI_API_KEY=...
    GROQ_API_KEY=gsk_...
    MISTRAL_API_KEY=...

  Or run Ollama locally: OLLAMA_HOST=http://localhost:11434

  For knowledge storage only (no LLM needed): use limen.remember() / limen.recall()
```

```
LimenError [CLAIM_MISSING_CONTEXT]
  assertClaim() requires missionId and taskId.

  If you're storing standalone knowledge (not mission-scoped), use the simpler API:
    limen.remember("your fact here")

  Or use limen.knowledge.store() for structured knowledge without mission context.

  The full claim API (limen.claims.assertClaim) is for governed, mission-scoped
  knowledge with evidence chains. See: https://limen.dev/docs/claims
```

### 3.4 The TypeScript Experience

**Current state**: Fully typed with branded ID types. TypeDoc generates API reference HTML.

**What works**: Autocomplete on `limen.` shows all available methods. Type safety prevents passing a raw string where a `TenantId` is expected.

**What fails**: The branded types (`TenantId`, `AgentId`, etc.) are opaque at the IDE level. Hovering over `TenantId` shows `string & { readonly __brand: 'TenantId' }` — correct but unhelpful. A developer doesn't know where these IDs come from or how to construct them.

**Proposed improvements:**
1. **JSDoc on every branded type** with examples of how to obtain one:
   ```typescript
   /**
    * Tenant identifier. Obtained from:
    * - Session creation: `await limen.session({ tenantId: 'my-tenant' as TenantId })`
    * - Automatic: single-tenant mode uses a default tenant
    * - Multi-tenant: provided by your authentication layer
    * @example const tid = 'acme-corp' as TenantId;
    */
   export type TenantId = string & { readonly __brand: 'TenantId' };
   ```
2. **Convenience factory functions**: `TenantId.from('acme-corp')` instead of `'acme-corp' as TenantId`
3. **Inferred defaults**: In single-tenant mode, every API that requires `TenantId` should infer it automatically

---

## Part 4: The Complete Onboarding Specification

### 4.1 npm Package Page

**Description** (max 140 chars for npm search display):
```
"Memory and knowledge infrastructure for AI agents. Governed, audited, local-first. One dependency."
```

**Keywords** (add to existing):
```json
["memory", "knowledge", "remember", "recall", "agent-memory",
 "knowledge-graph", "governance", "audit", "audit-trail", "local-first",
 "claims", "evidence", "provenance"]
```

### 4.2 README.md — Complete Redesign

The README should be 150 lines maximum. It has one job: get the developer to install and try Limen within 60 seconds of reading.

**Structure:**

```
Lines 1-3:    One-sentence description + badges
Lines 4-20:   Quickstart (working code, copy-paste-run)
Lines 21-40:  "What just happened" (the invisible governance reveal)
Lines 41-70:  Three use cases with 5-line code each
Lines 71-100: Comparison table (honest, specific)
Lines 101-120: Architecture overview (the 4-layer diagram)
Lines 121-140: Links to full docs
Lines 141-150: Contributing, security, license
```

**Proposed README opening:**

```markdown
# Limen

Memory and knowledge infrastructure for AI agents. Every fact stored with
provenance. Every mutation audited. Every recall governed. One dependency.

## Quickstart

npm install limen-ai

```typescript
import { createLimen } from 'limen-ai';

const limen = await createLimen();

// Store knowledge
await limen.remember("User prefers dark mode", { userId: "u1" });
await limen.remember("User is based in Berlin", { userId: "u1" });

// Recall knowledge
const facts = await limen.recall({ userId: "u1" });
console.log(facts);
// [
//   { text: "User prefers dark mode", confidence: 1.0, storedAt: "2026-03-30T..." },
//   { text: "User is based in Berlin", confidence: 1.0, storedAt: "2026-03-30T..." }
// ]

await limen.shutdown();
```

Set an API key if you want LLM features (chat, structured output). Knowledge
storage works without any API key — it's pure local infrastructure.

### What just happened

That code created an encrypted SQLite database, recorded every mutation in a
hash-chained audit trail, and enforced RBAC authorization — automatically.
The governance layer runs whether you configure it or not.

- **Every `remember()` call** → claim assertion + audit entry + RBAC check
- **Every `recall()` call** → query + authorization + tenant isolation
- **Every fact** → timestamped, confidence-scored, supersession-tracked
- **Zero configuration** → encryption, audit, RBAC all running by default
```

### 4.3 Examples Directory — Progressive Complexity

Restructure to tell a story. Each example builds on the last.

| # | File | Concept | Lines | Prereqs |
|---|------|---------|-------|---------|
| 01 | hello-memory.ts | `remember()` + `recall()` | 12 | None |
| 02 | chatbot-memory.ts | Chat with persistent memory | 25 | 01 |
| 03 | structured-knowledge.ts | `knowledge.store()` + `knowledge.query()` | 30 | 01 |
| 04 | knowledge-relationships.ts | `connect()`, `supersede()` | 25 | 03 |
| 05 | multi-turn-sessions.ts | Sessions with automatic context | 30 | 02 |
| 06 | structured-output.ts | JSON schema inference | 25 | None |
| 07 | governed-claims.ts | Full claim protocol with evidence | 40 | 03 |
| 08 | mission-agent.ts | Autonomous missions with budgets | 50 | 07 |
| 09 | audit-inspection.ts | Reading the audit trail | 30 | 01 |
| 10 | multi-provider.ts | Provider routing and failover | 25 | None |
| 11 | governance-visible.ts | Logger showing invisible governance | 35 | None |

**Key change**: Memory/knowledge examples come FIRST. Chat comes second. This signals what Limen is actually for.

**Ship with npm**: Add `"examples/"` to the `files` array in package.json. Or at minimum, include a `QUICKSTART.md` in the package.

### 4.4 Documentation Site Structure

```
docs/
  index.md                    — What is Limen? (1 page)
  quickstart.md               — Install → remember → recall (1 page)
  concepts/
    knowledge-model.md        — Subjects, predicates, confidence, evidence
    governance.md             — Audit, RBAC, encryption, invariants
    sessions.md               — Conversation memory and context management
    missions.md               — Autonomous agent execution
    architecture.md           — The 4-layer model
  guides/
    chatbot-memory.md         — Add memory to any chatbot
    agent-learning.md         — Agents that learn from experience
    decision-tracking.md      — Record and audit agent decisions
    multi-agent-knowledge.md  — Share knowledge between agents
    temporal-knowledge.md     — Facts that change over time
    migration-from-mem0.md    — Moving from Mem0 to Limen
    migration-from-langchain.md — Moving LangChain memory to Limen
  api/
    remember-recall.md        — Convenience API reference
    knowledge.md              — Structured knowledge API reference
    claims.md                 — Governed claim protocol reference
    sessions.md               — Session API reference
    missions.md               — Mission API reference
    transport.md              — Standalone transport reference
    errors.md                 — Error code reference
  recipes/
    user-preferences.md       — Store and recall user preferences
    conversation-summary.md   — Automatic conversation summarization
    fact-checking.md          — Cross-reference facts with evidence
    knowledge-export.md       — Export knowledge to JSON
    audit-compliance.md       — Audit trail for compliance
  troubleshooting.md          — Common errors and fixes
  deployment.md               — Production deployment guide
  security.md                 — Security model and posture
```

### 4.5 The Six Developer Scenarios

Walking through each scenario from the directive:

#### Scenario 1: "I want my chatbot to remember user preferences"

**Today**: Not obvious. Developer must use the claim protocol with branded types, or discover that `limen.knowledge` is a stub.

**Proposed** (8 lines):
```typescript
import { createLimen } from 'limen-ai';
const limen = await createLimen();

// In your chat handler:
async function handleMessage(userId: string, message: string) {
  // Store the preference
  if (message.includes("prefer")) {
    await limen.remember(message, { userId, tags: ["preference"] });
  }
  // Recall preferences for context
  const prefs = await limen.recall({ userId, tags: ["preference"] });
  // Pass prefs to your LLM as context...
}
```

#### Scenario 2: "I want my agent to learn from past conversations"

**Today**: No path. The knowledge API is a stub. The claim protocol requires mission/task context.

**Proposed** (12 lines):
```typescript
const session = await limen.session({ agentName: "tutor", user: { id: "student-1" } });

// After each conversation turn, extract and store learnings
session.on("turn", async (turn) => {
  const insights = await limen.infer({
    input: `Extract key facts from this exchange: ${turn.text}`,
    outputSchema: { type: "object", properties: { facts: { type: "array", items: { type: "string" } } } },
  });
  for (const fact of insights.data.facts) {
    await limen.remember(fact, { userId: "student-1", tags: ["learned"] });
  }
});
```

#### Scenario 3: "I want to store decisions my agent makes and recall them later"

**Today**: Possible via claim protocol, but requires full branded type ceremony.

**Proposed** (6 lines):
```typescript
await limen.remember("Decided to use PostgreSQL for user data due to ACID requirements", {
  tags: ["decision", "architecture"],
  confidence: 0.95,
  source: "architecture review meeting 2026-03-30",
});

const decisions = await limen.recall({ tags: ["decision", "architecture"] });
```

#### Scenario 4: "I want to share knowledge between multiple agents"

**Today**: Technically possible — claims are tenant-scoped, not agent-scoped. But the API doesn't make this obvious.

**Proposed** (10 lines):
```typescript
const limen = await createLimen();

// Agent A stores a finding
await limen.remember("Market size for EVs in Europe is $45.3B", {
  agentId: "researcher",
  tags: ["market", "ev", "europe"],
  confidence: 0.87,
});

// Agent B reads it
const findings = await limen.recall({ tags: ["market", "ev"] });
// Returns findings from ALL agents — governed by RBAC
```

#### Scenario 5: "I want to know when stored knowledge is outdated"

**Today**: The claim protocol supports temporal anchoring (`validAt`) and supersession relationships. But there's no convenience API for this.

**Proposed** (8 lines):
```typescript
const original = await limen.remember("Bitcoin price is $67,000", {
  tags: ["crypto", "price"],
  validAt: new Date("2026-03-01"),
});

// Later, supersede with new information
await limen.remember("Bitcoin price is $72,000", {
  tags: ["crypto", "price"],
  validAt: new Date("2026-03-30"),
  supersedes: original.id,
});

// Recall returns only current facts by default
const current = await limen.recall({ tags: ["crypto", "price"] });
// Returns only the $72,000 fact. The $67,000 fact is in the audit trail.
```

#### Scenario 6: "I want to export my knowledge base to JSON"

**Today**: `limen.data` API exists (DataApi) for export/purge. This is already available.

**Proposed** (3 lines):
```typescript
const allKnowledge = await limen.data.export({ format: "json" });
fs.writeFileSync("knowledge-backup.json", JSON.stringify(allKnowledge, null, 2));
```

---

## Part 5: What Makes Limen Impossible to Leave

### 5.1 The Governance Moat

No competitor has this. When a developer stores 10,000 facts through Limen, they get:
- A hash-chained audit trail proving every mutation
- Temporal history of every fact change
- Evidence provenance for every claim
- RBAC authorization on every access
- Encrypted storage with tenant isolation

Switching to Mem0 means losing all of this. For any organization with compliance requirements, this is permanent lock-in — not through vendor dependency, but through capability dependency.

### 5.2 The Knowledge Graph Effect

As facts accumulate, the relationship graph (supports, contradicts, supersedes, derived_from) becomes increasingly valuable. Facts are not isolated — they form a web of evidence that an agent can traverse. Exporting individual facts to a competitor loses the graph structure.

### 5.3 The Audit Trail as Product Feature

The audit trail is not just compliance infrastructure — it's a debugging tool. When an agent makes a wrong decision, the developer can trace the exact knowledge chain that led to it. No competitor offers this. It becomes indispensable once used.

### 5.4 The Local-First Advantage

Data never leaves the developer's machine unless they choose to sync. In a post-GDPR, post-AI-regulation world, this is increasingly valuable. Mem0 and Zep are SaaS-first. Limen is local-first.

### 5.5 The Incremental Adoption Path

The three-tier API (remember/recall → structured knowledge → governed claims) means a developer starts simple and graduates to power features as needs grow. They never need to rewrite — the convenience layer compiles down to the governed layer. Every `remember()` call already has an audit trail.

---

## Part 6: Implementation Priority

### Phase 1: The Convenience Layer (1-2 weeks)

**Goal**: `limen.remember()` and `limen.recall()` work in 3 lines.

1. Add `remember(text, options?)` to the `Limen` interface
2. Add `recall(query, options?)` to the `Limen` interface
3. Implement as thin facades over the claim protocol
4. Auto-generate `TenantId`, `AgentId`, `MissionId`, `TaskId` for standalone use
5. Support text matching for recall (exact substring initially)
6. Create a "standalone" mission context for non-mission-scoped claims

**Design constraints:**
- Must compile to valid claim protocol calls (no bypass)
- Must generate audit entries (governance is not optional)
- Must work without any LLM API key (pure local storage)
- Must work without branded type casts in consumer code

### Phase 2: The Structured Knowledge Layer (1-2 weeks)

**Goal**: `limen.knowledge.store()` and `limen.knowledge.query()` with tags, confidence, relationships.

1. Implement `KnowledgeApi` for real (replace the stub)
2. Subject/predicate model simplified to `subject` + `tags`
3. Relationship convenience: `connect()`, `supersede()`
4. Temporal queries: "facts valid at date X"
5. Export: knowledge to JSON with relationships

### Phase 3: README and Examples Rewrite (1 week)

1. Rewrite README to 150 lines, knowledge-first
2. Restructure examples (memory first, chat second)
3. Add examples to npm package (`files` in package.json)
4. Update package.json description and keywords

### Phase 4: Documentation Site (2-3 weeks)

1. Quickstart guide
2. Concepts documentation
3. Recipes/cookbook
4. Migration guides (from Mem0, from LangChain)
5. Troubleshooting guide

### Phase 5: Native Dependency Mitigation (investigation)

Investigate:
- `sql.js` (WebAssembly SQLite) as an alternative to `better-sqlite3` for environments without C++ toolchain
- `LIMEN_STORAGE=memory` mode for zero-native-dep development/testing
- Prebuilt binaries coverage for common platforms
- Clear error messages when native build fails with platform-specific fix instructions

### Phase 6: Semantic Recall (future)

- Embedding generation at write time (using configured LLM provider)
- Vector similarity search for `recall()` queries
- Automatic entity extraction from natural language input
- This is what closes the gap with Mem0's search quality

---

## Part 7: Measurements of Success

### Onboarding Metrics (target)

| Metric | Current | Target |
|--------|---------|--------|
| Lines to first working code | 15+ (claim protocol) | 3 (remember) |
| Concepts to learn before productive | 6 (URN, predicate, branded types, grounding, evidence, claim lifecycle) | 0 (remember/recall) |
| Time to "it works" from npm install | 10+ minutes | 2 minutes |
| npm install success rate | Unknown (native build failures) | 95%+ |
| README length | 577 lines | 150 lines |

### Competitive Position (target)

| Dimension | Current Position | Target Position |
|-----------|-----------------|-----------------|
| Onboarding simplicity | Last (behind Mem0, Letta, Zep) | Tied with Mem0 |
| Governance capabilities | First (unmatched) | First (and visible) |
| Knowledge model power | First (claims + evidence + relationships) | First (and accessible) |
| Developer awareness | Near zero | Top 5 in "AI agent memory" searches |

---

## Appendix A: The Full Friction Map

Every moment of developer friction, catalogued:

| Step | Friction Point | Severity | Fix |
|------|---------------|----------|-----|
| npm search | Description is poetry, not utility | HIGH | Rewrite to "Memory and knowledge infrastructure for AI agents" |
| npm install | `better-sqlite3` native compilation failure | HIGH | Investigate WASM alternative, improve error messages |
| npm install | Node >= 22 requirement | MEDIUM | Investigate Node 20 LTS support |
| First code | No `remember()`/`recall()` | CRITICAL | Implement convenience layer |
| First code | Knowledge API is a stub | CRITICAL | Wire or replace |
| First code | Must understand branded types | HIGH | Auto-infer in single-tenant mode |
| First code | Must provide mission/task context for claims | HIGH | Standalone knowledge context |
| Examples | Knowledge example uses type casts | HIGH | Rewrite with convenience API |
| Examples | Not shipped with npm package | MEDIUM | Add to `files` |
| README | 577 lines, chat-first | HIGH | Rewrite, knowledge-first, 150 lines |
| README | "Cognitive Operating System" confusion | MEDIUM | Reframe as knowledge infrastructure |
| Docs | No knowledge quickstart | HIGH | Write it |
| Docs | No recipes/cookbook | MEDIUM | Write them |
| Docs | No migration guides | LOW | Write for Mem0 and LangChain |
| Recall | No semantic search | MEDIUM | Phase 6 — embeddings |
| Recall | Exact match only | MEDIUM | Add substring/tag matching |
| Error | Native build fails silently or cryptically | HIGH | Detailed platform-specific error messages |
| Error | No provider → unclear error | MEDIUM | Specific guidance error |

---

## Appendix B: The Naming Decision

The `remember()` / `recall()` naming was chosen deliberately:

**Considered alternatives:**
- `store()` / `retrieve()` — too generic, sounds like a key-value store
- `add()` / `search()` — Mem0's API. Copying is not our standard.
- `learn()` / `know()` — too anthropomorphic
- `assert()` / `query()` — too technical for tier 1
- `save()` / `find()` — too generic

**Why `remember` / `recall`:**
1. Maps to how developers think about agent memory ("I want my agent to remember this")
2. Distinct from competitors (Mem0 uses `add`/`search`, Zep uses `memory.add`/`memory.get`)
3. Implies persistence and importance — you remember things that matter
4. Natural in conversation: "limen.remember(...)" reads like English
5. Already used in Limen's MCP interface (`limen_remember`, `limen_recall`) — consistency

---

## Appendix C: What We Do NOT Copy

This specification explicitly rejects several competitor patterns:

1. **We do not copy Mem0's SaaS-first model.** Limen is local-first. The developer's data stays on their machine.
2. **We do not copy Mem0's implicit extraction.** When a developer calls `remember("I'm vegetarian")`, we store exactly that — not an extracted entity. Explicit is better than implicit for governed systems. (Semantic extraction is a future layer, not a default.)
3. **We do not copy Zep's graph-database dependency.** Limen's relationship model runs on SQLite. No Neo4j. No infrastructure.
4. **We do not copy Letta's runtime model.** Limen is a library, not an application. It embeds into your code.
5. **We do not simplify away governance.** The convenience layer produces governed claims. The audit trail runs on every call. Simplicity of API does not mean absence of guarantees.

---

*SolisHQ — We innovate, invent, then disrupt.*
