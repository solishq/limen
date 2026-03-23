# Limen vs Vercel AI SDK: When You Need More Than a Wrapper

The Vercel AI SDK is an excellent tool for calling LLM APIs. If all you need is to make requests to Claude, GPT, or Gemini — with streaming, structured output, and React integration — the AI SDK does that well.

But what happens when your agents need to do real work?

---

## The Gap

Consider what happens when you build a production AI application on top of the AI SDK:

**Month 1**: Chat works. Streaming works. Structured output works. Ship it.

**Month 3**: You need conversation history. You add a database. You need to track token costs. You add a cost tracker. You need to limit what agents can do. You add authorization checks.

**Month 6**: You have 15 infrastructure modules duct-taped around the AI SDK. They interact in ways nobody fully understands. A bug in the cost tracker causes an agent to blow through its token budget overnight. The audit trail you built has gaps because three modules write to the database independently and one forgets the audit entry.

**Month 9**: You rewrite the infrastructure layer.

This is the gap Limen fills.

---

## What Limen Does That the AI SDK Doesn't

### Governance Boundary

The AI SDK gives your code direct access to LLM responses. There's nothing between your agent logic and the state mutations it produces.

Limen interposes a governance layer. Agents interact with the engine through 16 formally defined system calls. Every system call validates the proposal before any state change occurs. An agent cannot bypass this — the layer architecture makes it structurally impossible.

```typescript
// AI SDK: Agent code directly mutates your state
const response = await generateText({ model, prompt });
db.insert('reports', { content: response.text }); // Hope nothing went wrong

// Limen: Agent proposes, system validates, state mutates atomically
const result = agent.createArtifact({
  name: 'report',
  type: 'report',
  content: structuredData,
}); // Validated, audited, budget-deducted, tenant-scoped — one transaction
```

### Audit Trail

Every state mutation in Limen is recorded in an append-only, SHA-256 hash-chained audit trail. The mutation and its audit entry happen in the same database transaction. Not eventually consistent — atomic.

The AI SDK has no built-in audit mechanism. You build it yourself, and you build it correctly, or you don't know what your agents did last Tuesday.

### Budget Enforcement

Limen tracks token consumption per-mission, continuously. If a mission exceeds its budget, it blocks. Budget requests above configured thresholds require human approval.

With the AI SDK, token tracking is your responsibility. If you forget to check, or your check has a race condition, an agent can consume unlimited tokens.

### Multi-Tenant Isolation

Limen provides row-level or database-level tenant isolation. Every query is automatically scoped by tenant. Cross-tenant data access is structurally impossible from the API surface.

The AI SDK has no tenancy concept. If you serve multiple customers, you build the isolation yourself.

### Persistence

Limen uses SQLite with WAL mode. Sessions, conversations, missions, artifacts, audit entries — all persisted locally with ACID guarantees. No external database server needed.

The AI SDK is stateless. Persistence is your problem.

---

## What the AI SDK Does Better

**React integration.** The AI SDK has first-class React hooks (`useChat`, `useCompletion`) and server-side streaming with Next.js. Limen is a backend engine with no frontend opinions.

**Lightweight adoption.** If you need to add LLM capabilities to an existing app with minimal changes, the AI SDK's lightweight approach is a better fit.

**Edge runtime support.** The AI SDK runs at the edge (Cloudflare Workers, Vercel Edge). Limen requires Node.js and a filesystem (SQLite dependency).

**Provider breadth.** The AI SDK supports more providers out of the box through its adapter ecosystem. Limen ships six adapters covering the major providers.

---

## When to Choose What

**Choose the AI SDK when:**
- You need LLM calls in a React/Next.js app
- Your agents are stateless or you manage state yourself
- You run at the edge
- You don't need governance, audit, or budget enforcement

**Choose Limen when:**
- Your agents do autonomous, multi-step work
- You need to know exactly what your agents did and why (audit trail)
- You need to enforce token budgets per-mission
- You serve multiple tenants and need isolation guarantees
- You want one `npm install` instead of building 15 infrastructure modules

---

## They're Not Competitors

The AI SDK is a library for calling LLMs. Limen is an operating system for running AI agents. They solve different problems at different layers of the stack.

If you're building a chatbot, use the AI SDK. If you're building an AI system that needs to be reliable, auditable, and governed — that's what Limen was built for.
