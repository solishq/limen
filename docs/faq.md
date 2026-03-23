# Frequently Asked Questions

## General

### What is Limen?
A Cognitive Operating System for AI agents. It provides the infrastructure that makes AI agents reliable: persistence, audit trails, budget enforcement, multi-tenant isolation, and governance boundaries. One production dependency, 16 system calls, 99 formally verified invariants.

### Why "Limen"?
Latin for *threshold* — the architectural boundary where deterministic infrastructure meets stochastic cognition.

### How is Limen different from LangChain or the Vercel AI SDK?
Those are LLM wrappers that help you call models. Limen is an operating system that governs what agents can do. It provides governance (16 system calls, RBAC), persistence (SQLite, audit trails), budget enforcement (per-mission token limits), and multi-tenant isolation. See the [comparison table](../README.md#how-limen-compares) in the README.

### Is Limen a framework?
No. Limen is an engine. You don't subclass it or plug into lifecycle hooks. You call `createLimen()`, get a frozen object, and use its methods. Two calls produce independent instances with no shared state.

---

## Serverless and Edge

### Can Limen run in serverless functions (AWS Lambda, Vercel Functions)?
**Yes, with caveats.** Limen uses SQLite with WAL mode, which requires a writable filesystem. In Lambda, you can write to `/tmp` (up to 10 GB). The tradeoff: the database lives in ephemeral storage and does not persist across cold starts.

For persistent state in serverless:
- Use `/tmp` for the database and sync to S3/EFS between invocations
- Mount an EFS volume to your Lambda function
- Use the standalone transport layer (`@solishq/limen/transport`) for stateless LLM calls

### Can Limen run at the edge (Cloudflare Workers, Vercel Edge)?
**No.** Edge runtimes do not provide a Node.js-compatible filesystem or native module support. Limen depends on `better-sqlite3`, which is a native C++ addon compiled for Node.js. It cannot run in V8 isolates.

For edge use cases, use the standalone transport layer with a remote backend:
- Deploy Limen on a standard Node.js server
- Call it from edge functions via HTTP

### Does Limen support PostgreSQL or MySQL?
**No.** Limen uses SQLite exclusively. This is a deliberate architectural decision:
- Single dependency (I-01)
- No external database server to manage
- ACID transactions with WAL mode
- Data locality — your data stays on your machine
- Operational simplicity — no connection pooling, no network latency

### How does Limen handle concurrent writes?
SQLite in WAL mode supports concurrent reads with a single writer. For most applications, this is sufficient. For high-write-throughput scenarios, use database-level tenant isolation — each tenant gets its own SQLite file, eliminating cross-tenant write contention.

### What's the maximum database size?
SQLite supports databases up to 281 TB. In practice, Limen databases are bounded by your data retention policies. The retention scheduler automatically archives old data per your configured policies.

---

## Performance

### What is the latency overhead?
The hot-path (excluding LLM execution) targets ≤103ms at P99. Per-phase budgets: perception <5ms, retrieval <50ms, mutation-audit <1ms. The LLM call itself dominates total latency — Limen's infrastructure overhead is a rounding error.

### How many tokens can a mission consume?
As many as you budget. Token budgets are configured per-mission. Limen enforces the budget continuously — each LLM call deducts from the balance. Budget requests above configured thresholds require human approval.

### Does Limen add tokens to my prompts?
The chat pipeline may inject technique suggestions from the learning system and conversation history from the session. These are visible in the `ResponseMetadata.phases` field. No hidden system prompts are added.

---

## Security

### Where are API keys stored?
API keys are resolved from environment variables at adapter creation time. They are never logged, stored in the database, or included in error messages.

### What encryption does Limen use?
AES-256-GCM for data at rest, with PBKDF2 key derivation (600,000 iterations). All crypto uses the Node.js built-in `crypto` module.

### Can an agent access another tenant's data?
No. Multi-tenant isolation is enforced at the database layer. Row-level isolation uses scoped connections that automatically filter every query by tenant ID. Database-level isolation gives each tenant a separate SQLite file.

### Are error messages safe to show to users?
Yes. All `LimenError` messages are automatically redacted at the API boundary. Internal details (SQL, stack traces, file paths, dependency internals) are replaced with safe, generic messages.

---

## Development

### What Node.js versions are supported?
Node.js 22 and 24. Tested on both in CI.

### Can I add more dependencies?
No. Limen enforces a single production dependency (I-01). CI will reject any PR that adds runtime dependencies. This is enforced by an automated check in the CI pipeline.

### How do I run the tests?
```bash
npm test          # Main test suite (~3,100 tests)
npm run test:all  # All tests including scaffold stubs
npm run typecheck # TypeScript strict mode
npm run ci        # typecheck + build + test
```

### How do I add a new provider adapter?
Implement the `ProviderAdapter` interface in `src/substrate/transport/adapters/`. Each adapter translates between Limen's `LlmRequest`/`LlmResponse` types and the provider's wire format. See any existing adapter for the pattern. No new runtime dependencies allowed.
