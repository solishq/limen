# Architecture Deep-Dive

Limen is structured as four layers with a strict dependency direction: down only, never up. Each layer is a separate module namespace with its own types, stores, and factory functions. No layer can import from a layer above it.

```
┌─────────────────────────────────────────────────────────────────┐
│  L4: API Surface                                                │
│  createLimen() → frozen Limen object                            │
│  chat(), infer(), sessions, agents, missions, health, metrics   │
├─────────────────────────────────────────────────────────────────┤
│  L2: Orchestration                                              │
│  10 system calls (SC-1 through SC-10)                           │
│  Missions, task graphs, budgets, checkpoints, artifacts, events │
├─────────────────────────────────────────────────────────────────┤
│  L1.5: Substrate                                                │
│  LLM gateway, transport engine, worker pool, scheduling         │
│  6 provider adapters, capability registry                       │
├─────────────────────────────────────────────────────────────────┤
│  L1: Kernel                                                     │
│  SQLite (WAL), audit trail, RBAC, crypto, events, rate limiting │
│  Tenant isolation, retention, namespace enforcement              │
└─────────────────────────────────────────────────────────────────┘
```

---

## L1: Kernel

The kernel owns persistence, identity, and trust. It has zero knowledge of AI.

**Build order** (each component depends only on those above it):
1. **Database lifecycle** — Opens SQLite in WAL mode, runs migrations
2. **Namespace enforcer** — Table naming conventions for multi-tenancy
3. **Audit trail** — Append-only, SHA-256 hash-chained, with triggers preventing modification
4. **Crypto engine** — AES-256-GCM encryption, PBKDF2 key derivation, HMAC-SHA256
5. **Event bus** — Typed event emission with webhook delivery
6. **RBAC engine** — Role hierarchy with 5 default roles and per-operation authorization
7. **Rate limiter** — Per-tenant request throttling
8. **Retention scheduler** — Configurable per-type data retention policies
9. **Tenant context** — Row-level or database-level isolation

**Key invariants:**
- I-03: Every mutation + audit entry in the same transaction
- I-06: Audit trail is append-only and hash-chained
- I-11: AES-256-GCM encryption at rest
- I-13: Authorization checked on every operation

**Factory:** `createKernel(config)` → frozen `Kernel` object

---

## L1.5: Substrate

The substrate provides execution services. It communicates with LLM providers over raw HTTP.

**Components:**
- **Transport engine** — HTTP client with retry (3 attempts, 120s cap), circuit breakers (per-model), exponential backoff
- **Provider adapters** — Anthropic, OpenAI, Gemini, Groq, Mistral, Ollama. Each translates between Limen's internal `LlmRequest`/`LlmResponse` types and the provider's wire format
- **Stream parser** — SSE and NDJSON parsing with stall detection, line limits, event caps
- **Worker pool** — Bounded concurrent execution with resource limits
- **Task scheduler** — Deadline-aware, fair-share, or budget-aware scheduling policies
- **Capability registry** — Maps capability names to execution handlers

**Key invariants:**
- I-01: Single production dependency (better-sqlite3). Transport uses `fetch`, not provider SDKs
- I-04: Provider independence. Swap providers without code changes
- I-26: Streaming and non-streaming produce identical final results

**Factory:** `createSubstrate(config)` → frozen `Substrate` object

---

## L2: Orchestration

Where cognition meets governance. The orchestration layer defines 16 system calls — the complete interface between agents and infrastructure. Agent output proposes; the orchestration layer validates and executes.

**10 core system calls (SC-1 through SC-10):**

| Call | Module | Function |
|---|---|---|
| SC-1: `propose_mission` | Mission store | Create mission with objective, budget, deadline |
| SC-2: `propose_task_graph` | Task graph engine | Validate and store a DAG of tasks |
| SC-3: `propose_task_execution` | Task store | Claim a task for execution |
| SC-4: `create_artifact` | Artifact store | Produce immutable, versioned artifact |
| SC-5: `read_artifact` | Artifact store | Retrieve by ID + version |
| SC-6: `emit_event` | Event propagation | Domain event (lifecycle events are system-only) |
| SC-7: `request_capability` | Capability registry | Execute web/code/data/file/API capability |
| SC-8: `request_budget` | Budget governor | Request additional token budget |
| SC-9: `submit_result` | Mission store | Deliver results with confidence score |
| SC-10: `respond_checkpoint` | Checkpoint coordinator | Assess progress at system checkpoint |

**6 additional system calls:**
- SC-11/12/13: Claim Protocol (assert, relate, query)
- SC-14/15/16: Working Memory (write, read, discard)

**Key modules:**
- **Mission store** — Lifecycle state machine (CREATED → PLANNING → EXECUTING → REVIEWING → COMPLETED)
- **Task graph engine** — DAG validation, cycle detection, dependency resolution
- **Budget governor** — Per-mission token budgets with continuous enforcement
- **Checkpoint coordinator** — Progress assessment with goal drift detection (TF-IDF cosine similarity)
- **Artifact store** — Immutable versioned artifacts with dependency cascading
- **Conversation manager** — Turn history with auto-summarization
- **Compaction engine** — Bounded cognitive state management

**Factory:** `createOrchestration(deps)` → frozen `OrchestrationEngine` object

---

## L4: API Surface

The public face of the engine. Composes kernel, substrate, and orchestration into a single frozen object.

**`createLimen(config)` build sequence:**
1. Create L1 Kernel (SQLite, migrations, RBAC, audit, crypto, events)
2. Create L1.5 Substrate (worker pool, LLM gateway, adapters, scheduler)
3. Create L2 Orchestration (missions, tasks, budgets, checkpoints, artifacts)
4. Wire sub-modules: sessions, chat pipeline, infer pipeline, agents, knowledge, roles, data, metrics
5. Deep-freeze the result (recursive `Object.freeze` per C-07)
6. Return the frozen `Limen` object

**Key properties:**
- C-06: Two `createLimen()` calls produce fully independent instances
- C-07: The returned object is deeply frozen. No mutation possible
- FPD-4: Deep freeze applied once at factory time. Zero ongoing cost

---

## Three-File Architecture

Every subsystem follows the same pattern:

```
subsystem/
  interfaces/     → Pure types. No runtime logic.
  harness/        → Factory function. Wiring and composition.
  stores/         → Implementation. All logic lives here.
```

Harness files never contain business logic — they wire dependencies and return frozen objects. Implementation lives exclusively in store files.

---

## Migration System

Database schema evolves through numbered migration files. 26 migrations (v1 through v26) cover the full schema.

**Rules:**
- Migrations are **forward-only**. Existing files cannot be modified (enforced by CI)
- Each migration receives the database connection and returns nothing
- Migrations run in order at kernel startup
- Hash-checking ensures migrations are immutable after deployment

```
v1-v6:   Kernel tables (audit, rbac, events, retention, tenant)
v7-v11:  Learning system (techniques, outcomes, applications, quarantine, transfers)
v12-v18: Governance (runs, contracts, supervisor, eval, capabilities, handoffs)
v19-v21: Claims, techniques governance, working memory
v22:     Transport deliberation
v23-v26: Agent persistence, trust progression, knowledge graph, replay
```

---

## Chat Pipeline

The 9-phase pipeline processes every chat request in deterministic order (I-28):

```
1. Input validation
2. Rate limiting
3. Context assembly (session history, working memory, claims)
4. Technique injection (learning system applies relevant techniques)
5. Provider routing (select provider and model)
6. LLM execution (transport engine: request → response)
7. Output processing (structured validation, retry if needed)
8. State mutation (conversation update, audit entry, budget deduction)
9. Response construction (ChatResult with text, metadata, stream)
```

Phase ordering is fixed and tested. Latency enforcement (I-14) tracks per-phase timing: perception <5ms, retrieval <50ms, mutation-audit <1ms, hot-path total ≤103ms P99 (excluding LLM execution).

---

## Data Flow: Agent Mission Execution

```
Agent                    Limen Engine                    SQLite
  │                          │                              │
  ├── propose_mission ──────►│── validate ──────────────────►│ INSERT mission
  │                          │── audit entry ───────────────►│ INSERT audit
  │◄── mission_id ──────────┤                              │
  │                          │                              │
  ├── propose_task_graph ───►│── validate DAG ──────────────►│ INSERT tasks
  │                          │── check cycles ──────────────│
  │                          │── audit entry ───────────────►│ INSERT audit
  │◄── task_ids ────────────┤                              │
  │                          │                              │
  ├── propose_task_exec ────►│── check dependencies ────────│ SELECT deps
  │                          │── execute via substrate ─────│
  │                          │── deduct budget ─────────────►│ UPDATE budget
  │                          │── audit entry ───────────────►│ INSERT audit
  │◄── execution_result ───┤                              │
  │                          │                              │
  ├── create_artifact ──────►│── validate + store ──────────►│ INSERT artifact
  │                          │── audit entry ───────────────►│ INSERT audit
  │◄── artifact_id ─────────┤                              │
  │                          │                              │
  ├── submit_result ────────►│── check completeness ────────│ SELECT tasks
  │                          │── transition to COMPLETED ───►│ UPDATE mission
  │                          │── audit entry ───────────────►│ INSERT audit
  │◄── result_accepted ────┤                              │
```

Every arrow into SQLite is wrapped in a transaction that includes the audit entry (I-03). The agent never touches SQLite directly — every interaction goes through a system call with validation.
