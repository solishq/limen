<p align="center">
  <img src="docs/assets/banner.svg" alt="Limen — Cognitive Operating System" width="700">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/limen-ai"><img src="https://img.shields.io/npm/v/limen-ai" alt="npm version"></a>
  <a href="https://github.com/solishq/limen/actions"><img src="https://img.shields.io/github/actions/workflow/status/solishq/limen/ci.yml?branch=main" alt="CI"></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node.js"></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/Dependencies-1-green" alt="Dependencies">
</p>

---

# Limen

Your AI agents don't have a reliability problem. They have an infrastructure problem.

Limen is a Cognitive Operating System. It does for AI agents what a kernel does for processes: isolation, resource control, lifecycle management, and deterministic behavior contracts. One production dependency. 16 system calls. 99 continuously enforced invariants backed by dedicated tests. Every execution path typed and tested.

The name is Latin for *threshold* -- the architectural boundary where deterministic infrastructure meets stochastic cognition.

---

## Why Limen Exists

Every serious AI application eventually builds the same infrastructure: conversation state management, token budget enforcement, provider failover, audit trails, structured output with retry, agent lifecycle control. Teams build these as ad-hoc layers on top of LLM SDKs, then spend months debugging the interactions between them.

Limen replaces that entire stack with a single engine. Provider communication happens through raw HTTP -- no SDKs, no transitive dependency trees, no version conflicts. State lives in a local SQLite database you control. Every mutation is audited atomically. Every agent operates within enforced budgets and capability boundaries.

The result: AI infrastructure with the reliability guarantees of a database engine and the operational simplicity of a single `npm install`.

---

## How Limen Compares

|  | Limen | Vercel AI SDK | LangChain.js |
|---|---|---|---|
| **Production deps** | 1 | ~50+ | ~50+ |
| **Provider SDKs required** | No (raw HTTP) | Yes (`@ai-sdk/*`) | Yes (`@langchain/*`) |
| **Built-in persistence** | SQLite (WAL, local) | No | Optional (external DB) |
| **Audit trail** | Hash-chained, append-only | No | LangSmith (paid SaaS) |
| **Budget enforcement** | Per-mission token budgets | No | No |
| **Agent governance** | 16 system calls, RBAC | No | No |
| **Multi-tenant isolation** | Row-level or database-level | No | No |
| **Encryption at rest** | AES-256-GCM | No | No |
| **Streaming** | Yes (stall detection, timeouts) | Yes | Yes |
| **Structured output** | JSON Schema + auto-retry | Zod schemas | Output parsers |
| **Deterministic replay** | Yes (from recorded LLM outputs) | No | No |

Limen is not a wrapper around LLM APIs. It is an operating system for AI agents. If you need a lightweight way to call an LLM, the Vercel AI SDK is excellent. If you need your agents to operate within enforced boundaries with full auditability, that is what Limen was built for.

---

## Install

```bash
npm install limen-ai
```

Requires Node.js >= 22. Single production dependency: `better-sqlite3`.

---

## Quick Start

```typescript
import { createLimen } from 'limen-ai';
import crypto from 'node:crypto';

const limen = await createLimen({
  dataDir: './my-app-data',
  masterKey: crypto.randomBytes(32),
  providers: [{
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514'],
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  }],
});

// Chat -- returns synchronously, fields resolve async
const response = limen.chat('What are the key trends in renewable energy?');
const text = await response.text;
const metadata = await response.metadata;
console.log(text);
console.log(`${metadata.tokens.input} in / ${metadata.tokens.output} out`);

// Stream
const streamed = limen.chat('Explain quantum computing', { stream: true });
for await (const chunk of streamed.stream) {
  if (chunk.type === 'content_delta') process.stdout.write(chunk.delta);
}

// Structured output with schema validation and auto-retry
const analysis = await limen.infer({
  input: 'List the top 3 programming languages by popularity',
  outputSchema: {
    type: 'object',
    properties: {
      languages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['name', 'reason'],
        },
      },
    },
    required: ['languages'],
  },
  maxRetries: 2,
});
console.log(analysis.data); // Typed, validated, guaranteed to match schema

// Cleanup
await limen.shutdown();
```

`createLimen()` returns a deeply frozen object. Every method is immutable. Two calls produce fully independent instances -- no shared state, no cross-contamination.

> **Important: Master Key Management**
>
> The `masterKey` is used for AES-256-GCM encryption at rest. If you lose the key, encrypted data in the SQLite database becomes permanently unreadable. Do **not** use `crypto.randomBytes(32)` in production — that generates a new key on every startup.
>
> ```bash
> # Generate once, store securely
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > master.key
> chmod 600 master.key
> ```
>
> ```typescript
> // Load from file or environment
> const masterKey = Buffer.from(process.env.LIMEN_MASTER_KEY!, 'hex');
> // or
> const masterKey = fs.readFileSync('./master.key', 'utf8').trim();
> ```
>
> Keep the key out of version control. Rotate by re-encrypting: create a new engine instance with the new key and migrate data through the public API.

---

## Architecture

Limen is built as four layers, each with a strict dependency direction: down only, never up.

```
┌─────────────────────────────────────────────┐
│  API Surface                                │  createLimen(), chat(), infer(),
│  Public interface. Composes everything.      │  sessions, agents, missions, health
├─────────────────────────────────────────────┤
│  Orchestration                              │  Missions, task graphs, budgets,
│  Cognitive governance. 16 system calls.      │  checkpoints, artifacts, events
├─────────────────────────────────────────────┤
│  Substrate                                  │  LLM gateway, transport engine,
│  Execution infrastructure.                   │  worker pool, scheduling, adapters
├─────────────────────────────────────────────┤
│  Kernel                                     │  SQLite (WAL), audit trail, RBAC,
│  Persistence and trust.                      │  crypto, events, rate limiting
└─────────────────────────────────────────────┘
```

**Kernel** owns persistence, identity, and trust. SQLite in WAL mode provides ACID transactions. An append-only, hash-chained audit trail records every state mutation. RBAC enforces authorization on every operation. AES-256-GCM encrypts sensitive data at rest. The kernel has zero knowledge of AI -- it is pure infrastructure.

**Substrate** provides execution services. The transport engine communicates with LLM providers over raw HTTP with circuit breakers, exponential backoff, streaming with stall detection, and TLS enforcement. A worker pool with resource limits manages concurrent execution. No provider SDK is imported -- ever.

**Orchestration** is where cognition meets governance. Agents propose missions, task graphs, artifact creation, budget requests, and checkpoint responses through 16 formally defined system calls. The orchestration layer validates every proposal before any state mutation occurs. This is the governance boundary: intelligence proposes, infrastructure decides.

**API Surface** composes these layers into the public `Limen` object. A single factory call -- `createLimen(config)` -- wires kernel, substrate, and orchestration into a frozen, immutable engine instance.

---

## Three Export Paths

Limen ships three independent entry points. Use the full engine, the reference agent, or the transport layer alone.

### `limen-ai` -- The Engine

The complete Cognitive OS. Everything described in this document.

```typescript
import { createLimen } from 'limen-ai';
import type { Limen, LimenConfig, ChatResult } from 'limen-ai';
```

### `limen-ai/reference-agent` -- Mission Agent

A proof-of-architecture agent that demonstrates how to build on the 16 system calls. It decomposes objectives into task graphs, manages budgets, handles checkpoints, aggregates artifacts, and delegates sub-missions. It interacts with the engine exclusively through the public API -- it cannot reach kernel or substrate internals.

```typescript
import { createReferenceAgent } from 'limen-ai/reference-agent';

const agent = createReferenceAgent(limen, {
  name: 'analyst',
  decompositionStrategy: 'heuristic',
  capabilities: ['web', 'data'],
});

const result = await agent.runMission({
  objective: 'Analyze competitive landscape for drone delivery in Southeast Asia',
  constraints: {
    tokenBudget: 50_000,
    deadline: '2024-12-31T23:59:59Z',
    capabilities: ['web', 'data'],
  },
});
```

### `limen-ai/transport` -- Standalone LLM Client

The transport layer works independently of the engine. Zero-dependency LLM communication with circuit breakers, retry with exponential backoff, streaming with stall detection, response size limits, TLS enforcement, and graceful shutdown. If you need a reliable way to talk to LLM providers without pulling in their SDKs, this is it.

```typescript
import {
  createTransportEngine,
  createAnthropicAdapterFromEnv,
  createOpenAIAdapterFromEnv,
} from 'limen-ai/transport';

const engine = createTransportEngine();
const anthropic = createAnthropicAdapterFromEnv();

// Non-streaming with automatic retry (3 attempts, 120s cap)
const result = await engine.execute(anthropic, {
  request: {
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    maxTokens: 1024,
  },
});
console.log(result.response.content);

// Streaming with stall detection (30s first-byte, 30s stall, 10min total)
const stream = await engine.executeStream(anthropic, {
  request: {
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    maxTokens: 1024,
  },
});
for await (const chunk of stream.stream) {
  // Process LlmStreamChunk
}

engine.shutdown(); // Aborts in-flight, rejects new requests
```

---

## Providers

Six providers, zero SDKs. All communication is raw HTTP via `fetch`.

| Provider | Adapter Factory | Streaming | Auth |
|---|---|---|---|
| **Anthropic** | `createAnthropicAdapter(apiKey, baseUrl?)` | SSE | Bearer token |
| **OpenAI** | `createOpenAIAdapter(apiKey, baseUrl?)` | SSE | Bearer token |
| **Google Gemini** | `createGeminiAdapter(apiKey, baseUrl?)` | SSE | Query param |
| **Groq** | `createGroqAdapter(apiKey, baseUrl?)` | SSE | Bearer token |
| **Mistral** | `createMistralAdapter(apiKey, baseUrl?)` | SSE | Bearer token |
| **Ollama** | `createOllamaAdapter(baseUrl?)` | NDJSON | None (local) |

Each provider also has a `*FromEnv()` variant that reads the API key from the environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`). Ollama runs locally and requires no authentication.

Configure providers at the engine level:

```typescript
const limen = await createLimen({
  dataDir: './data',
  masterKey: crypto.randomBytes(32),
  providers: [
    {
      type: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: ['claude-sonnet-4-20250514'],
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      maxConcurrent: 5,
    },
    {
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      models: ['gpt-4o'],
      apiKeyEnvVar: 'OPENAI_API_KEY',
    },
    {
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      models: ['llama3.2'],
    },
  ],
});
```

---

## Sessions and Conversations

Sessions bind a conversation to an agent and tenant context. Within a session, conversation history is maintained, turns are recorded, and the context window is managed automatically -- including summarization when the window fills.

```typescript
const session = await limen.session({
  agentName: 'researcher',
  tenantId: 'tenant-1' as TenantId,
  user: { id: 'user-42', role: 'analyst' },
});

// Chat within session context
const r1 = session.chat('What were last quarter earnings?');
const r2 = session.chat('Compare that to the previous year');

// Structured inference within the same conversation
const summary = await session.infer({
  input: 'Summarize our conversation so far',
  outputSchema: SummarySchema,
});

// Fork conversation at a specific turn
const branch = await session.fork(3);

// Review history
const turns = await session.history();

await session.close();
```

---

## Autonomous Missions

Missions are how agents do complex, multi-step work within enforced boundaries. An agent proposes an objective with a token budget and deadline. The system validates the proposal, and the agent then works through a cycle of planning (task graphs), execution, artifact creation, checkpoints, and result submission -- all through the 16 system calls.

```typescript
const mission = await limen.missions.create({
  agent: 'researcher',
  objective: 'Produce a competitive analysis report',
  constraints: {
    tokenBudget: 100_000,
    deadline: '2024-12-31T23:59:59Z',
    capabilities: ['web', 'data', 'code'],
    maxTasks: 20,
  },
  deliverables: [
    { type: 'report', name: 'competitive-analysis' },
    { type: 'data', name: 'market-data' },
  ],
});

// Monitor
mission.on('checkpoint', (payload) => {
  console.log('Checkpoint:', payload);
});

// Wait for completion
const result = await mission.wait();
console.log(result.summary);
console.log(`Confidence: ${result.confidence}`);
console.log(`Tokens used: ${result.resourcesConsumed.tokens}`);
```

The mission lifecycle transitions through: `CREATED` -> `PLANNING` -> `EXECUTING` -> `REVIEWING` -> `COMPLETED`. At any point, a mission can be paused, resumed, or cancelled. Budget enforcement is continuous -- if a mission exceeds its allocation, it is blocked until more budget is requested and approved.

---

## The 16 System Calls

Every agent interaction with the engine passes through exactly 16 system calls. This is the governance boundary. Agents propose; the system validates and executes.

**Orchestration** — mission lifecycle and task governance:

| # | Call | What It Does |
|---|---|---|
| SC-1 | `propose_mission` | Create a mission with objective, budget, and deadline |
| SC-2 | `propose_task_graph` | Submit a DAG of tasks with dependency edges |
| SC-3 | `propose_task_execution` | Request execution of a validated task |
| SC-4 | `create_artifact` | Produce a versioned, immutable artifact |
| SC-5 | `read_artifact` | Retrieve an artifact by ID and version |
| SC-6 | `emit_event` | Signal a domain event (lifecycle events are system-only) |
| SC-7 | `request_capability` | Execute a capability (web, code, data, file, API) |
| SC-8 | `request_budget` | Request additional token budget with justification |
| SC-9 | `submit_result` | Deliver final results with confidence score |
| SC-10 | `respond_checkpoint` | Answer a system checkpoint with assessment |

**Claim Protocol** — structured knowledge with provenance:

| # | Call | What It Does |
|---|---|---|
| SC-11 | `assert_claim` | Assert a knowledge claim with evidence and confidence score |
| SC-12 | `relate_claims` | Create typed relationships between claims |
| SC-13 | `query_claims` | Query claims by subject, predicate, mission, or artifact |

**Working Memory** — task-scoped ephemeral state:

| # | Call | What It Does |
|---|---|---|
| SC-14 | `write_working_memory` | Write key-value entries to task-local scratch space |
| SC-15 | `read_working_memory` | Read entries or list all keys in task-local memory |
| SC-16 | `discard_working_memory` | Discard entries from task-local memory |

An agent cannot bypass these calls. It cannot write to the database, emit lifecycle events, modify its own capabilities, or mutate completed artifacts. The system call boundary is structural, not conventional -- enforced by the type system and the layer architecture.

---

## The Invariant System

Limen enforces 99 invariants continuously. These are not guidelines or best practices. They are machine-verified properties of the running system, each backed by dedicated tests. A violation of any invariant is a system defect.

| Invariant | Guarantee |
|---|---|
| **I-01** | Single production dependency (`better-sqlite3`) |
| **I-02** | User owns all data. Export and delete at any time. |
| **I-03** | Every state mutation includes its audit entry in the same transaction |
| **I-04** | Provider independence. Swap providers without code changes. |
| **I-05** | All multi-step mutations are transactional |
| **I-06** | Audit trail is append-only and hash-chained. Cannot be modified or deleted. |
| **I-07** | Multi-tenant isolation at row or database level |
| **I-11** | Encryption at rest (AES-256-GCM) |
| **I-13** | Authorization checked on every operation (RBAC completeness) |
| **I-17** | Governance boundary: agent output never directly mutates state |
| **I-19** | Artifacts are immutable after creation. Version, never modify. |
| **I-20** | Mission trees are bounded (depth 5, children 10, total 50) |
| **I-24** | Every task graph requires objective alignment proof |
| **I-25** | Deterministic replay: record LLM outputs, replay to identical state |
| **I-26** | Streaming and non-streaming produce identical results |
| **I-28** | Pipeline phases execute in fixed, deterministic order |

These invariants are what make AI infrastructure trustworthy. When your agent runs a mission overnight, I-03 guarantees you can audit every action it took. I-17 guarantees it never bypassed the governance layer. I-20 guarantees it didn't spawn an unbounded tree of sub-missions. I-19 guarantees no artifact was silently modified after creation.

---

## Observability

```typescript
// Health: three-state (healthy, degraded, unhealthy)
const health = await limen.health();
console.log(health.status);           // 'healthy' | 'degraded' | 'unhealthy'
console.log(health.uptime_ms);
console.log(health.subsystems);       // Per-subsystem status
console.log(health.throughput);       // requests/s, active streams, error rate

// Metrics: structured snapshot
const metrics = limen.metrics.snapshot();
console.log(metrics.limen_requests_total);
console.log(metrics.limen_tokens_cost_usd);
console.log(metrics.limen_audit_chain_valid);
console.log(metrics.limen_db_size_bytes);
```

Health distinguishes between three states: **healthy** (all subsystems operational, LLM providers reachable), **degraded** (engine functional but LLM connectivity impaired), and **unhealthy** (critical subsystem failure). Subsystem health covers database, audit, providers, sessions, missions, learning, and memory.

---

## Configuration Reference

```typescript
interface LimenConfig {
  dataDir: string;                           // Where all engine state lives
  masterKey: Buffer;                         // >= 32 bytes, for AES-256-GCM encryption
  providers?: ProviderConfig[];              // LLM provider configurations
  tenancy?: {
    mode: 'single' | 'multi';               // Default: 'single'
    isolation?: 'row-level' | 'database';    // Multi-tenant isolation strategy
  };
  substrate?: {
    maxWorkers?: number;                     // Worker pool size (default: 4)
    schedulerPolicy?: 'deadline' | 'fair-share' | 'budget-aware';
  };
  hitl?: HitlConfig;                         // Human-in-the-loop defaults
  defaultTimeoutMs?: number;                 // Chat/infer timeout (default: 60000)
  rateLimiting?: {
    apiCallsPerMinute?: number;              // Default: 100
    maxConcurrentStreams?: number;            // Default: 50
  };
  logger?: (event: LimenLogEvent) => void;  // Structured logging callback
}
```

---

## Error Handling

Every error thrown by Limen is a `LimenError` with a typed code, a human-readable message, a `retryable` flag, and an optional `cooldownMs` for rate-limited responses.

```typescript
import { LimenError } from 'limen-ai';

try {
  const result = limen.chat('Hello');
  await result.text;
} catch (err) {
  if (err instanceof LimenError) {
    console.log(err.code);       // 'RATE_LIMITED' | 'TIMEOUT' | 'PROVIDER_UNAVAILABLE' | ...
    console.log(err.retryable);  // true for transient errors
    console.log(err.cooldownMs); // Present for RATE_LIMITED
  }
}
```

Error codes trace directly to specific system behaviors: `BUDGET_EXCEEDED` from budget enforcement, `CAPABILITY_VIOLATION` from the governance layer, `SCHEMA_VALIDATION_FAILED` from structured output, `PROVIDER_UNAVAILABLE` from the transport engine. Internal details -- stack traces, SQL errors, file paths -- are never exposed through the public API.

---

## Development

```bash
git clone https://github.com/solishq/limen.git
cd limen
npm install

npm run typecheck    # TypeScript strict mode, zero errors
npm run build        # Compile to dist/
npm test             # Full test suite
npm run ci           # typecheck + build + test
```

### CI Enforcement

The CI pipeline enforces structural properties on every push:

- **Single dependency** -- exactly one production dependency (`better-sqlite3`)
- **No `@ts-ignore`** -- every type must be resolved
- **No uncontrolled `any`** -- type safety is not optional
- **No decorative assertions** -- tests that pass regardless of implementation are rejected
- **Forward-only migrations** -- existing migration files cannot be modified
- **Node.js 22 and 24** -- tested on current and next LTS

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture overview, and pull request requirements.

## Security

Report vulnerabilities privately. See [SECURITY.md](SECURITY.md) for details.

## License

[Apache License 2.0](LICENSE)

---

<p align="center">Built by <a href="https://solishq.ai">SolisHQ</a></p>
