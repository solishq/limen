# Why One Dependency Changes Everything

Limen has one production dependency. Here's why that's not a limitation — it's the entire point.

`better-sqlite3`. That's the complete `dependencies` section of our `package.json`. Everything else — LLM communication with six providers, AES-256-GCM encryption, worker pool scheduling, event handling, circuit breakers, streaming with stall detection — is built from Node.js primitives.

This post explains why, what it cost, and what it made possible.

## The Dependency Tax

Every package you install is a bet: that this team will maintain this library in a way that does not break your product. At small scale, these bets feel safe. At production scale, they compound.

A typical AI infrastructure project pulls in something like this:

```
@anthropic-ai/sdk          →  12 transitive dependencies
openai                     →  18 transitive dependencies
langchain                  →  47 transitive dependencies
chromadb                   →  23 transitive dependencies
ioredis                    →  8 transitive dependencies
bull                       →  14 transitive dependencies
```

Six direct dependencies. North of 120 transitive packages. Each one is a surface: for breaking changes, for CVEs, for version conflicts, for `npm audit` findings that block your deploy pipeline at 2 AM.

**Version conflicts.** SDK A requires `node-fetch@2`. SDK B requires `node-fetch@3`. Your bundler throws cryptic errors. You spend an afternoon figuring out why.

**Breaking changes.** A provider updates their SDK. Your pinned version works, but stops getting security patches. You upgrade and discover they changed the streaming interface. Two days.

**CVE surface area.** A vulnerability in a transitive dependency four levels deep. You don't use the affected code path, but your security scanner flags it. Half a day to triage, document, and remediate.

**Debugging opacity.** Something is wrong with retry behavior. The stack trace passes through your code, into the SDK, into an HTTP client the SDK chose, into a retry library that HTTP client uses. You are debugging someone else's architectural decisions in code you did not write.

None of these costs show up in a sprint estimate. All of them show up in the lived experience of maintaining the system.

## The Trade in Numbers

Here is what one-dependency actually looks like, side by side:

| Component | SDK Approach | Limen Approach |
|---|---|---|
| Anthropic adapter | ~8,000 lines + 12 transitive deps | 534 lines, zero deps |
| OpenAI adapter | ~12,000 lines + 18 transitive deps | 532 lines, zero deps |
| Groq adapter | ~5,000 lines + 10 transitive deps | 234 lines (shared OpenAI-compat module) |
| Mistral adapter | ~6,000 lines + 8 transitive deps | 234 lines (shared OpenAI-compat module) |
| **Total transport layer** | **~31,000 lines, ~48 transitive deps** | **4,127 lines, zero deps** |
| State management | Redis + Postgres + Kafka | SQLite (WAL mode), one file on disk |
| Cryptography | bcrypt + jose + jsonwebtoken | `node:crypto` (built-in) |
| Scheduling | bull + agenda + node-cron | Custom worker pool, 800 lines |

We replaced ~31,000 lines of SDK code and ~48 transitive packages with 4,127 lines we own and understand completely.

## What We Gave Up

Honesty matters more than advocacy. Here's what this approach cost us:

**Time.** Writing six HTTP adapters instead of `npm install`-ing six SDKs took longer. The transport layer was roughly three weeks of work. Using SDKs would have been three days.

**Free upgrades.** When Anthropic adds a new API feature, their SDK gets it immediately. We have to read the API changelog and update our adapter. This typically takes 30-60 minutes per feature, but it's work we wouldn't have with an SDK.

**Community patterns.** LangChain has an ecosystem of plugins, examples, and community knowledge. Our transport layer has our documentation and our code. If you're looking for a ready-made "RAG pipeline in 10 lines," that's not us.

**Edge cases we haven't hit.** SDK teams handle thousands of users' edge cases. We handle ours. There are certainly provider API quirks that the official SDKs handle gracefully that we haven't encountered yet.

The honest assessment: the one-dependency approach trades short-term velocity for long-term control. If you're building a prototype, use SDKs. If you're building infrastructure that other software depends on, the calculus inverts.

## What We Built Instead

### Transport: Six Providers, Zero SDKs

Every major LLM provider exposes an HTTP API. The official SDKs are convenience wrappers — they construct HTTP requests, parse responses, and handle retry logic. Useful things, but not complex things. And they come with design decisions you may not agree with, transitive dependencies you didn't ask for, and abstraction layers that make debugging harder.

Each adapter implements a `ProviderAdapter` interface with four methods: build the request, parse the response, parse a stream, and report whether a status code is retryable.

Because we own this code, we built behaviors no SDK gives you:

- **Circuit breakers** checked before every attempt, per provider
- **Retry with exponential backoff**, capped at 120 seconds, with Retry-After header parsing
- **Streaming with stall detection**: 30-second first-byte timeout, 30-second stall timeout, 10-minute total cap
- **TLS enforcement** for all non-local URLs
- **Response size limits** (10MB) at both Content-Length and body level
- **Graceful shutdown** that aborts in-flight requests and rejects new ones
- **Credential scrubbing** from every error message

These aren't features we requested from SDK maintainers and waited for. They're properties we required and built.

### State: SQLite, Not a Database Server

Instead of Redis for caching plus Postgres for persistence plus Kafka for events, Limen uses SQLite in WAL mode. One file on disk. ACID transactions, an append-only hash-chained audit trail, forward-only migrations with checksum verification, and crash recovery.

The user owns their data physically. `cp limen.db limen.db.backup` is a valid backup strategy. No connection strings. No managed database services. No separate process to monitor, patch, and restart.

### Cryptography: Node.js `crypto`

AES-256-GCM for encryption at rest. SHA-256 for hash chains. All from `node:crypto`. No `bcrypt`, no `jose`, no `jsonwebtoken`, no `crypto-js`.

### Scheduling and Events: Built-In

A custom worker pool and task scheduler replace `bull`, `agenda`, and `node-cron`. An in-process event bus replaces `eventemitter2` and `rxjs`. Small, focused implementations tuned to exactly what the system needs.

## What One Dependency Enables

**Install time is measured in seconds.** One native module. No dependency tree to reconcile, no optional dependencies to evaluate, no postinstall scripts from packages you've never heard of.

**The attack surface is one native module.** `better-sqlite3` is a C++ binding to SQLite — one of the most tested pieces of software ever written. When a security team audits your dependency tree, the conversation takes five minutes instead of five days.

**Upgrades are a single decision.** One changelog. One test run. Ship.

**Every line in the stack trace is yours.** When something breaks at 3 AM, you're not reading through SDK internals trying to understand someone else's retry logic. You wrote the retry logic.

**Portability is total.** SQLite runs everywhere Node.js runs. No database server to provision, no Redis cluster to manage, no message broker to configure.

**The tarball is small.** Under 700KB. Not 12MB. This matters for serverless cold starts, CI pipelines, and air-gapped deployments.

## Structural Enforcement

Philosophy degrades. Discipline lapses. New contributors don't know the rules. So we made it structural.

The CI pipeline includes a check that fails if the dependency count is not exactly one:

```yaml
- name: 'Single production dependency (I-01)'
  run: |
    DEP_COUNT=$(node -e "const p=require('./package.json'); \
      console.log(Object.keys(p.dependencies||{}).length)")
    if [ "$DEP_COUNT" -ne 1 ]; then
      echo "::error::Expected exactly 1 production dependency, found $DEP_COUNT"
      exit 1
    fi
    DEP_NAME=$(node -e "const p=require('./package.json'); \
      console.log(Object.keys(p.dependencies||{})[0])")
    if [ "$DEP_NAME" != "better-sqlite3" ]; then
      echo "::error::Expected better-sqlite3 as sole dependency, found $DEP_NAME"
      exit 1
    fi
```

Not a convention in a README. A gate in CI that blocks every push and every pull request. You cannot accidentally add a dependency. You cannot intentionally add one without changing the CI check first — a visible, reviewable act that forces the conversation.

## When This Doesn't Apply

This approach makes sense for infrastructure that other software depends on. Libraries. Engines. Foundations.

It does not make sense for applications. If you're building a SaaS product or a web app, use dependencies freely. The ecosystem exists for good reason.

The question is not "should I use dependencies." It's "should this specific piece of software own this specific behavior." If you're at the top of the stack — building applications — delegate aggressively. If you're at the bottom — building infrastructure — question every delegation. Every dependency you take becomes a dependency for everyone above you.

Limen sits at the bottom. One dependency is the right number for what we're building. Your number is almost certainly different. The point is that it should be a deliberate decision, not an accident.

## Try It

The transport layer is available standalone: `limen-ai/transport`. Zero-dependency LLM communication with circuit breakers, retry, streaming stall detection, TLS enforcement, and graceful shutdown.

```typescript
import {
  createTransportEngine,
  createAnthropicAdapterFromEnv,
} from 'limen-ai/transport';

const engine = createTransportEngine();
const anthropic = createAnthropicAdapterFromEnv();

const result = await engine.execute(anthropic, {
  request: {
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    maxTokens: 1024,
  },
});
```

Six providers. One interface. No SDKs. The dependency you don't take is the vulnerability you don't inherit, the breaking change that doesn't wake you up, and the upgrade you never have to coordinate.

**GitHub**: [github.com/solishq/limen](https://github.com/solishq/limen)

Next: [Introducing Limen](introducing-limen.md) · [28 Invariants](28-invariants.md)

*Built by [SolisHQ](https://solishq.ai).*
