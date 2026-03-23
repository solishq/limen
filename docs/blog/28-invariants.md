# 28 Invariants: Engineering Trust Into AI Infrastructure

Your agent ran overnight. You weren't watching. Here's what you can prove about what happened — and what you can't.

Can you prove every action was audited? Can you prove the audit trail wasn't tampered with? Can you prove the agent stayed within its capability boundaries? Can you prove no artifact was silently modified after creation? Can you prove the budget enforcement actually worked?

If your infrastructure can't answer these questions with structural guarantees — not "we think so" but "here's the proof" — then you're trusting the agent, not the infrastructure. And the agent is stochastic. That's its job.

Limen answers these questions with 28 invariants: formally specified properties of the running system, each enforced by the type system, the database schema, runtime checks, and a dedicated test suite simultaneously. Not guidelines. Not best practices. Hard constraints that the CI pipeline enforces on every commit.

## What Matters at 3 AM

You deploy an agent on a research mission Friday evening. 100,000-token budget. Monday deadline. Web and data capabilities. You go home.

Monday morning, the mission completed. Here's what the invariant system guarantees about what happened while you were away:

**I-03** guarantees every action has a corresponding audit entry, written atomically. There is no gap between "what happened" and "what was recorded."

**I-06** guarantees the audit trail was not tampered with. The hash chain is intact. If any entry was modified, verification identifies the exact sequence number where the chain breaks.

**I-17** guarantees the agent never bypassed the governance layer. Every state mutation went through validation. The agent proposed; the system decided.

**I-20** guarantees the agent did not spawn an unbounded tree of sub-missions. Bounded at 50 total, depth 5. You know the worst case before you look.

**I-19** guarantees no artifact was silently modified after creation. Every version is immutable. If the agent revised a report, the revision is a new version — the original is still there.

**I-22** guarantees the agent did not escalate its own capabilities. It started with `['web', 'data']` and every sub-mission had the same or fewer capabilities.

This is not a matter of trusting the agent. It's a matter of trusting the infrastructure. The invariant system is the formal boundary between stochastic cognition and deterministic infrastructure.

## Multi-Layer Enforcement

What makes Limen's invariants unusual isn't the properties themselves — it's that each one is enforced at every layer simultaneously. Consider I-03, the atomic audit invariant:

- **Type system**: every store function accepts a `DatabaseConnection` with a `transaction()` method, and audit functions operate on the same connection
- **Database schema**: SQLite transactions provide ACID guarantees — mutation and audit entry both commit or both roll back
- **Implementation**: every store function wraps mutation and audit inside `conn.transaction(() => { ... })`
- **Test suite**: dedicated tests verify audit entries exist after mutations and are absent after rollbacks
- **CI pipeline**: runs on every push against Node.js 22 and 24

A best practice depends on the developer remembering and the reviewer catching omissions. An invariant is structural — violating it requires simultaneously defeating the type checker, the database engine, and the test suite.

## The Invariants

### Data Integrity (I-01 through I-07)

**I-01: Single Production Dependency.** The runtime dependency tree is `{ better-sqlite3 }`. One package. The invariant test reads `package.json` and asserts exactly one entry:

```typescript
it('production dependencies contain exactly { better-sqlite3 }', () => {
  const pkg = loadPackageJson();
  const deps = pkg.dependencies ?? {};
  const depNames = Object.keys(deps);

  assert.equal(depNames.length, 1,
    `I-01 violation: Expected exactly 1 production dependency, ` +
    `found ${depNames.length}: [${depNames.join(', ')}]`
  );
  assert.ok(depNames.includes('better-sqlite3'),
    'I-01 violation: The single production dependency must be better-sqlite3'
  );
});
```

Every dependency is an attack surface, a version conflict, a transitive tree you didn't audit. One dependency means one thing to audit, one thing to update, one thing that can break.

**I-03: Atomic Audit.** Every state mutation and its audit entry in the same SQLite transaction:

```typescript
deps.conn.transaction(() => {
  deps.conn.run(`INSERT INTO core_missions ...`, [...]);

  // I-03: Audit entry in the same transaction
  deps.audit.append(deps.conn, {
    tenantId: ctx.tenantId,
    actorType: ctx.userId ? 'user' : 'agent',
    actorId: (ctx.userId ?? ctx.agentId ?? 'system') as string,
    operation: 'propose_mission',
    resourceType: 'mission',
    resourceId: missionId,
    detail: { parentMissionId: input.parentMissionId, objective: input.objective },
  });
});
```

If audit insert fails, mission insert rolls back. If mission insert fails, no audit entry is written. No state where a mutation exists without its audit record. No state where an audit record exists for a mutation that didn't happen.

**I-06: Audit Immutability.** The audit trail is append-only and hash-chained. Each entry contains a SHA-256 hash computed from the previous entry's hash, the current content, and its sequence number. SQLite triggers prevent UPDATE and DELETE:

```typescript
const recomputedHash = computeEntryHash(
  sha256Fn, row.previous_hash, input, row.timestamp, row.seq_no
);

if (recomputedHash !== row.current_hash) {
  valid = false;
  brokenAt = row.seq_no;
}
```

If any entry has been tampered with, the chain breaks at a specific sequence number. Same principle as blockchain integrity verification, applied to an audit trail with sub-millisecond verification.

**I-05: Transactional Consistency.** All multi-step mutations are atomic. WAL mode, 5-second busy timeout, foreign key enforcement. Crash at any point, restart, and the database is consistent.

### Security (I-11, I-13)

**I-11: Encryption at Rest.** AES-256-GCM with PBKDF2 key derivation (600,000 iterations). Fresh 96-bit IV per encryption per NIST SP 800-38D. Per-tenant keys derived from master key — no two tenants share encryption material. Key material never written to disk.

**I-13: RBAC on Every Operation.** Every public kernel function accepts an `OperationContext` with tenant identity and permission set. The type system enforces this — you cannot call a kernel function without providing identity context:

```typescript
if (ctx.permissions.size > 0 && !ctx.permissions.has('view_audit')) {
  return {
    ok: false,
    error: {
      code: 'PERMISSION_DENIED',
      message: 'view_audit permission required to query audit entries',
      spec: 'I-13',
    },
  };
}
```

No "internal" paths skip authorization.

### Governance (I-17, I-19, I-20, I-22)

These enforce the boundary between stochastic cognition and deterministic infrastructure.

**I-17: Governance Boundary.** LLM output never directly mutates system state. Every response passes through the orchestration layer, which validates every proposal before any state change. The layer architecture enforces this structurally — there is no path from LLM output to database write that doesn't pass through validation.

**I-19: Artifact Immutability.** Artifacts are write-once. The store has `create()` and `read()`. There is no `update()` — not because we chose not to write one, but because the interface doesn't define one. A SQLite trigger enforces this as defense-in-depth:

```typescript
it('content BLOB is write-once -- UPDATE blocked by trigger', () => {
  const result = createArtifact(deps, ctx);
  assert.equal(result.ok, true);

  let threw = false;
  try {
    conn.run(
      `UPDATE core_artifacts SET content = X'DEADBEEF'
       WHERE id = ? AND version = ?`,
      [result.value.artifactId, result.value.version],
    );
  } catch (err) {
    threw = true;
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  assert.equal(threw, true,
    'CATCHES: without immutability trigger, content UPDATE silently succeeds');
  assert.ok(errorMsg.includes('I-19'),
    'CATCHES: trigger error message must reference I-19');
});
```

Need to change an artifact? Create a new version. Old version remains accessible. Version numbers are monotonic. Complete history preserved.

**I-20: Mission Tree Boundedness.** An agent cannot spawn an unbounded tree of sub-missions. Depth 5, 10 children per node, 50 total missions. Enforced at creation time with O(1) lookups:

```typescript
if (depth > maxDepth) {
  return { ok: false, error: {
    code: 'DEPTH_EXCEEDED',
    message: `Depth ${depth} exceeds maxDepth ${maxDepth}`,
    spec: 'I-20',
  }};
}
```

Without this, a recursive agent could spawn missions until every resource is exhausted. With it, the worst case is bounded and known in advance.

**I-22: Capability Immutability.** Capabilities can be narrowed through delegation but never expanded:

```typescript
const parentCaps = new Set(parent.capabilities);
for (const cap of input.capabilities) {
  if (!parentCaps.has(cap)) {
    return { ok: false, error: {
      code: 'CAPABILITY_VIOLATION',
      message: `Capability '${cap}' not in parent capabilities`,
      spec: 'I-22',
    }};
  }
}
```

Principle of least privilege, enforced structurally. A research agent with `['web', 'data']` cannot grant its sub-agent `['web', 'data', 'code']`. The set can only shrink. Privilege escalation through delegation is architecturally impossible.

### Determinism (I-25, I-26, I-28)

**I-25: Deterministic Replay.** All non-deterministic inputs — LLM responses, tool results — recorded in `core_llm_request_log`. Given recorded outputs, any mission replays to identical system state.

**I-26: Streaming Equivalence.** Streaming and non-streaming produce identical final results. Same return type regardless of mode.

**I-28: Pipeline Determinism.** Every chat request passes through exactly nine phases in fixed order:

```typescript
type PipelinePhase =
  | 'perception'
  | 'retrieval'
  | 'context_assembly'
  | 'pre_safety'
  | 'generation'
  | 'post_safety'
  | 'learning'
  | 'evaluation'
  | 'audit';
```

Not an extensible enum. Not a plugin registry. No middleware injection. The pipeline is the pipeline. Debugging doesn't require reasoning about which hooks fired. Phase-level latency recorded in response metadata.

The `Result<T>` type enforces error handling at the foundation:

```typescript
type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KernelError };
```

No thrown exceptions. No unchecked error paths. The compiler forces every caller to handle both cases.

## Verify It Yourself

```bash
git clone https://github.com/solishq/limen.git
cd limen
npm install
npm test
```

2,447 tests. The invariant tests live in `tests/invariants/` — each file named after the invariant it verifies. Each test includes comments tracing it back to the specification section it enforces.

The CI pipeline runs these on every push against Node.js 22 and 24. It also enforces structural properties: exactly one production dependency, no `@ts-ignore` directives, no uncontrolled `any` types, and forward-only database migrations.

Apache 2.0 licensed. Read every line of source. Read every invariant test. Run them locally. The claims in this post are verifiable by anyone with Node.js installed and ten minutes to spare.

**GitHub**: [github.com/solishq/limen](https://github.com/solishq/limen)

Next: [Introducing Limen](introducing-limen.md) · [Why One Dependency Changes Everything](why-one-dependency.md)

*Built by [SolisHQ](https://solishq.ai).*
