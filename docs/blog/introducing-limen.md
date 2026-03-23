# Introducing Limen: A Cognitive Operating System for AI Agents

Last year, we deployed an AI research agent on a Friday evening. Budget of 100,000 tokens. Deadline: Monday. Access to web and data capabilities. We went home.

Monday morning, we had results. The agent had spawned fourteen sub-missions, consumed 94,000 tokens, and produced a 40-page report. The report looked good. But we couldn't answer basic questions about what had happened over the weekend. Did the agent stay within its capability boundaries? Did it modify any of its earlier outputs? Was the audit trail complete, or were there gaps? Could we prove the budget enforcement actually worked, or did we just get lucky?

We couldn't. The infrastructure wasn't built to answer those questions. It was built to *run* agents, not to *govern* them.

That's the moment Limen started.

## The Real Problem

In most AI systems, there is no separation between intelligence and infrastructure. LLM output directly mutates application state. Agents allocate their own resources. Nothing prevents a misbehaving model from exceeding its token budget, spawning unbounded sub-tasks, or silently modifying its own completed work.

The agent *is* the system, and the system has no walls.

Every team building production AI eventually discovers this and constructs the same invisible layer: conversation state, budget enforcement, provider failover, audit trails, structured output with retry logic, agent lifecycle control. They build it as ad-hoc middleware on top of LLM SDKs. They wire it together with custom glue. They spend months debugging interactions between components that were never designed to compose.

The work is repetitive. It's also dangerous. When infrastructure is hand-rolled, guarantees are hand-waved. Nobody writes formal proofs that their retry logic doesn't corrupt conversation state. Nobody verifies that their budget tracking actually prevents cost explosions under concurrent load. Nobody builds an append-only, hash-chained audit trail and then proves it can't be tampered with.

This is not a tooling gap. It is an architectural one.

## Intelligence Proposes. Infrastructure Decides.

Fifty years ago, computing had the same problem. Programs controlled their own memory. They scheduled themselves. A bug in one program could corrupt another. The solution was the operating system kernel: deterministic infrastructure that manages resources, enforces boundaries, and provides services through a controlled interface.

The insight behind Limen is that AI agents need the same thing.

An agent should not control its own token budget. It should not choose whether to bypass safety checks. It should not modify artifacts it has already submitted. It should not spawn an unbounded tree of sub-missions. These constraints should be structural — enforced by a layer the agent cannot reach, through an interface the agent cannot circumvent.

**Intelligence proposes. Infrastructure decides.** That is the architectural principle. Limen is the implementation.

The name comes from Latin. *Limen* means *threshold* — the boundary between two domains. Below the threshold: deterministic, provable infrastructure. Above it: stochastic intelligence. The threshold itself is where governance happens.

## Architecture

Four layers, strict dependency direction (down only, never up):

```
┌─────────────────────────────────────────────────┐
│  API Surface                                    │
│  createLimen(), chat(), infer(), sessions,      │
│  agents, missions, health, metrics              │
├─────────────────────────────────────────────────┤
│  Orchestration                                  │
│  Missions, task graphs, budgets, checkpoints,   │
│  artifacts, events — 16 system calls            │
├─────────────────────────────────────────────────┤
│  Substrate                                      │
│  LLM gateway, transport engine, worker pool,    │
│  scheduling, provider adapters                  │
├─────────────────────────────────────────────────┤
│  Kernel                                         │
│  SQLite (WAL mode), audit trail, RBAC, crypto,  │
│  events, rate limiting                          │
└─────────────────────────────────────────────────┘
```

The **Kernel** owns persistence, identity, and trust. SQLite in WAL mode provides ACID transactions. An append-only, hash-chained audit trail records every state mutation — the audit entry and the mutation it describes live in the same database transaction, always. The kernel knows nothing about AI. It is pure infrastructure.

The **Substrate** handles execution. A transport engine communicates with LLM providers over raw HTTP — no provider SDKs, no transitive dependency trees — with circuit breakers, exponential backoff, streaming with stall detection, and TLS enforcement.

The **Orchestration** layer is the governance boundary. Agents interact through 16 formally defined system calls. Every proposal is validated before any state mutation occurs. Agents cannot write to the database, emit lifecycle events, modify their own capabilities, or mutate completed artifacts. This boundary is structural, not conventional.

The **API Surface** composes these layers into a single frozen object. `createLimen(config)` wires everything together and returns an immutable engine instance. Two calls produce fully independent instances. No shared state.

## Proof

```typescript
import { createLimen } from '@solishq/limen';
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

const response = limen.chat('What are the key trends in renewable energy?');
const text = await response.text;
const metadata = await response.metadata;
console.log(text);
console.log(`${metadata.tokens.input} in / ${metadata.tokens.output} out`);
```

`chat()` returns synchronously. The `text` and `metadata` fields are promises that resolve when generation completes. The `stream` field is an async iterable that yields chunks progressively. Streaming and non-streaming produce identical final results — that's invariant I-26.

Structured output with schema validation:

```typescript
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

console.log(analysis.data); // Typed, validated, schema-guaranteed
```

If validation fails, Limen appends the validation errors to the prompt and retries. The returned `data` is typed and guaranteed to match your schema.

The transport engine works standalone — if all you need is reliable LLM communication without provider SDKs:

```typescript
import {
  createTransportEngine,
  createAnthropicAdapterFromEnv,
} from '@solishq/limen/transport';

const engine = createTransportEngine();
const anthropic = createAnthropicAdapterFromEnv();

const result = await engine.execute(anthropic, {
  request: {
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    maxTokens: 1024,
  },
});

console.log(result.response.content);
engine.shutdown();
```

Circuit breakers, exponential backoff, response size limits, TLS enforcement, streaming with stall detection — included. Zero configuration required.

## By the Numbers

- **16 system calls**: the complete governance interface between agents and infrastructure
- **28 invariants**: machine-verified properties of the running system, each backed by dedicated tests
- **1 production dependency**: `better-sqlite3`. No LLM SDKs. No framework sprawl.
- **2,447 tests**: the spec enforcement suite
- **6 providers**: Anthropic, OpenAI, Google Gemini, Groq, Mistral, Ollama — all via raw HTTP
- **9 pipeline phases**: perception, retrieval, context assembly, pre-safety, generation, post-safety, learning, evaluation, audit — executed in fixed, deterministic order

## What Makes This Different

**Limen is not a framework.** Frameworks sit above your code. Limen sits *beneath* your agents. Your agents interact with it through 16 system calls the way processes interact with a kernel.

**Limen is not an LLM wrapper.** It imports zero provider SDKs. All LLM communication happens over raw HTTP via `fetch`. Six providers are supported through adapter functions. Adding a provider means writing one adapter. Removing one means deleting one file.

**The governance model is structural, not behavioral.** Most AI safety approaches rely on prompt engineering, output filtering, or human review — all useful, all bypassable. An agent cannot exceed its budget because the budget is enforced at the system call layer. An agent cannot modify a completed artifact because immutability is enforced by SQLite triggers. The safety properties hold even if the agent is actively trying to violate them.

## The Challenge

```bash
npm install @solishq/limen
```

Requires Node.js 22+. One production dependency. TypeScript strict mode throughout. Apache 2.0 licensed. No tier gating. No feature flags.

| Import | What You Get |
|---|---|
| `@solishq/limen` | Full Cognitive OS: `createLimen`, sessions, missions, agents, everything |
| `@solishq/limen/reference-agent` | Proof-of-architecture agent demonstrating the 16 system calls |
| `@solishq/limen/transport` | Standalone LLM transport: circuit breakers, retry, streaming, six providers |

Run the test suite. Read the invariant tests. Try to find a state where an audit entry exists without its corresponding mutation. Try to escalate an agent's capabilities through delegation. Try to modify an artifact after creation. We couldn't. 2,447 tests say you won't either.

**GitHub**: [github.com/solishq/limen](https://github.com/solishq/limen)

Next: [Why One Dependency Changes Everything](why-one-dependency.md) · [28 Invariants](28-invariants.md)

*Built by [SolisHQ](https://solishq.ai).*
