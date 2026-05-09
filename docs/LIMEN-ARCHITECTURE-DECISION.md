<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability SolisForge §6 Phase 4: Architecture Decision -->

# Limen v5 — Architecture Decision Record

**Version:** 1.0.0
**Date:** 2026-05-09
**Status:** RATIFIED
**QAL:** QAL-3 (High Reliability — Governed Cognitive Infrastructure)

---

## AD-1: Storage Engine

**Chosen:** SQLite via `better-sqlite3` (synchronous, embedded)

**Rejected:**
- **PostgreSQL** — Network dependency violates zero-config principle. Limen is an embeddable library (`npm install limen-ai`), not a service. Requiring a running Postgres instance destroys the single-command onboarding promise and introduces a deployment topology Limen does not own.
- **MongoDB** — Document model misaligns with the relational integrity required by hash-chained audit trails (`AuditLogEntry.previousHash` must reference prior entry deterministically — SHARED_TYPES.md §10.3). Eventual consistency is incompatible with fail-closed governance verdicts that must be durable before success is returned (PerformanceBudget `auditAppend.guarantees: 'no_success_without_audit'` — SHARED_TYPES.md §20).
- **In-memory only** — No durability. Audit chain, belief state, and governance verdicts must survive process restarts. Agent memory is the product; volatile storage contradicts the purpose.

**Evidence:**
- `package.json`: sole runtime dependency is `better-sqlite3` v11.10.0. Development dependency (`sqlite-vec` for vector search in dev/test).
- `src/api/index.ts` line 18: factory "opens SQLite, runs migrations" as step 1 of kernel creation.
- `package.json` description: "SQLite-powered, zero-config."
- Architecture overview (§2.1): Limen v5 Engine layer lists "Postgres" as future — current implementation is SQLite throughout.

**Reasoning:** SQLite delivers single-file deployment, ACID transactions for hash-chain integrity, sub-millisecond reads for governance checks (<10ms budget), and zero operational overhead. The `better-sqlite3` binding is synchronous, eliminating async hazards in the audit-append critical path where `durable_before_success` semantics require the write to complete before the governance verdict is returned. Migration to Postgres is documented as a future path (`docs/MIGRATION_SQLITE_TO_POSTGRES.md`) but is not the current architecture.

---

## AD-2: Type System — Branded Types with Strict TypeScript

**Chosen:** Branded types via intersection (`string & { readonly __brand: 'TenantId' }`) under TypeScript strict mode with maximal compiler flags.

**Rejected:**
- **Plain strings** — No compile-time distinction between `TenantId`, `AgentId`, `SessionId`. In a system with 20+ distinct ID types (SHARED_TYPES.md §1.1a, §1.1b, §4), passing an `AgentId` where a `SessionId` is expected is a governance violation that must be caught at compile time, not runtime.
- **Zod runtime-only validation** — Adds ~200ms cold-start overhead per schema. Governance check budget is <10ms total (SHARED_TYPES.md §20). Runtime validation at every call site is incompatible with the performance budget. Branded types enforce correctness at zero runtime cost.
- **Nominal types via classes** — Classes carry prototype chains, are mutable by default, and resist `Object.freeze` (C-07). Branded types are pure structural constraints that vanish at runtime — no allocation, no prototype, no mutability vector.

**Evidence:**
- `SHARED_TYPES.md` §1.1a: `TenantId`, `UserId`, `AgentId`, `MissionId`, `TaskId`, `EventId`, `ArtifactId`, `PolicyId`, `RoleId`, `SessionId` — all branded.
- `SHARED_TYPES.md` §4: Phase X adds `AgentBranchId`, `AdapterId`, `ConsentId`, and more.
- `tsconfig.json`: `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`, `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true` — maximum compiler strictness.
- `SHARED_TYPES.md` §25 (Dual-Projection Parity Rule v1.4.1): branded types map to Rust newtypes (`pub struct TenantId(pub String)`), confirming they are architectural, not incidental.

**Reasoning:** Branded types achieve compile-time nominal safety without runtime cost. Combined with TypeScript's strictest compiler flags, they make entire defect classes (ID confusion, undefined access, optional property mishandling) structurally impossible. The zero-runtime-cost property is load-bearing: governance checks have a 10ms budget that cannot absorb runtime type validation.

---

## AD-3: Adapter Model — Pluggable Adapters via AgentAdapter Interface

**Chosen:** Single `AgentAdapter` interface that translates native agent formats into canonical Limen types. One adapter per agent framework. No core code changes required to add a new framework.

**Rejected:**
- **Monolithic framework integration** — Tight coupling to any single agent framework (Claude, Codex, CrewAI) would make Limen a Claude plugin instead of universal infrastructure. The vision is "agent-agnostic by design" (Architecture Overview §1).
- **Plugin system with dynamic loading** — Plugins introduce `eval`/`require` at runtime, creating a code injection surface in a governance system. The adapter model uses static registration with compile-time type checking — no dynamic code loading.
- **Direct API without translation** — Forces every agent framework to speak Limen's internal types natively. Inverts the dependency: frameworks would depend on Limen's type system. The adapter pattern keeps the translation burden on the adapter, not the framework.

**Evidence:**
- `AGENT_ADAPTER_ARCHITECTURE.md` §3: `AgentAdapter` interface with 10 methods — `translateToolCall`, `translateActionToGovernance`, session bridge, event bridge, health check.
- `AGENT_ADAPTER_ARCHITECTURE.md` §1: "Adding support for a new agent framework requires implementing a single AgentAdapter interface — no core code changes, no kernel recompilation, no governance model alterations."
- `SHARED_TYPES.md` §21: `AgentFramework` is a 10-value enum (`claude`, `codex`, `hermes`, `gemma`, `crew_ai`, `auto_gen`, `semantic_kernel`, `llama_index`, plus others).
- `src/api/index.ts` lines 1-30: factory wires kernel, substrate, and orchestration layers without referencing any specific agent framework.

**Reasoning:** The adapter model achieves framework independence through a translation layer. Each adapter owns the mapping from its framework's native format (`NativeAgentAction`) to Limen's canonical format (`ComputerAction`, 17 variants). This keeps the kernel stable while the adapter surface grows. The `AgentFramework` enum is extensible without core changes.

---

## AD-4: Governance Model — Fail-Closed with 4-Verdict System

**Chosen:** Every governance check defaults to denial. Four verdict types: `allow`, `refuse`, `escalate`, `sandbox`. Every verdict produces an audit entry (`auditId: EventId`). No action succeeds without a governance verdict.

**Rejected:**
- **Permissive-by-default (fail-open)** — An AI agent governance system that defaults to "allow" is not a governance system. One missed rule and the agent executes unrestricted computer actions. The risk profile is asymmetric: false refusal is recoverable, false allowance may be irreversible.
- **Binary allow/deny** — Missing `escalate` and `sandbox`. Escalation is required for actions that need human approval (`requiredApproval: 'human' | 'senior_agent'`). Sandboxing is required for actions that should execute but under constraints (filesystem, network, process, resource, duration limits). Binary verdicts force an all-or-nothing decision where nuanced control is needed.
- **Role-only access control (RBAC alone)** — RBAC (31 permissions, SHARED_TYPES.md §1.2) handles identity-based access. But governance must also evaluate action content, context, trust level, rate limits, and refusal rules. RBAC is a necessary input to governance, not a substitute for it.

**Evidence:**
- `SHARED_TYPES.md` §10: `GovernanceVerdict` is a 4-variant discriminated union — each variant carries `auditId`, plus variant-specific fields (`reason`, `rule`, `config`, `requiredApproval`).
- `SHARED_TYPES.md` §20: `auditAppend.guarantees: 'no_success_without_audit'` — governance verdicts are not returned until the audit record is durable.
- Codebase-wide: `fail-closed` appears in `enterprise-logger.ts`, `permission_gateway.ts`, `governed_orchestration.ts`, `capability_registry.ts` — every governance boundary defaults to denial.
- `src/api/gateway/permission_gateway.ts`: "Missing entries cause a defensive throw at runtime (fail-closed)."

**Reasoning:** Fail-closed governance with four verdicts provides defense-in-depth without false simplicity. Escalation preserves human oversight for high-risk actions. Sandboxing enables controlled execution without blanket refusal. The mandatory `auditId` on every verdict creates an unbroken provenance chain from decision to audit trail.

---

## AD-5: Dual Projection — TypeScript Primary, Rust Parity via TC-21

**Chosen:** All canonical types defined in TypeScript with structurally equivalent Rust projections. TypeScript is the implementation language. Rust projections exist for governance hot-path performance and cross-language FFI. Parity enforced by TC-21 (Dual Projection Parity).

**Rejected:**
- **Rust-only** — Limen is an npm package (`limen-ai`). Its consumers are Node.js AI agent frameworks. A Rust-only implementation requires N-API bindings for every API surface, dramatically increasing integration complexity and build toolchain requirements.
- **TypeScript-only (no Rust)** — Governance checks have a <10ms budget (SHARED_TYPES.md §20). TypeScript handles this today via in-memory rule matching, but the Rust projection preserves the option for native-speed governance evaluation as rule complexity grows. Architectural foresight, not premature optimization.
- **WASM bridge** — Adds serialization overhead at every crossing (JS heap to WASM linear memory). For the governance hot path where microseconds matter, N-API with zero-copy is superior to WASM's serialization tax.

**Evidence:**
- `SHARED_TYPES.md` §25: Full Rust equivalents section — every branded type, enum, struct has a Rust projection with `#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]`.
- `SHARED_TYPES.md` §25 Parity Rule (v1.4.1): "`String` is forbidden where TypeScript uses a union literal type. `serde_json::Value` is forbidden where TypeScript uses a typed interface." — this is structural parity, not loose translation.
- R2-49/50 comments: Known parity gaps tracked explicitly (`AdapterSandboxDefaults` optional vs Default, `SessionSummary.duration` precision, `NetworkSandbox.allowedProtocols` validation) — gaps are documented, not ignored.
- `package.json`: current implementation is pure TypeScript (no Rust build step in scripts). Rust is a ratified design target, not yet in the build pipeline.

**Reasoning:** Dual projection gives Limen a migration path to native performance without rewriting the TypeScript codebase. TC-21 ensures the Rust projections are not aspirational documentation but structurally verified equivalents. Known gaps (R2-49/50) are tracked with explicit reconciliation plans, preventing silent drift.

---

## AD-6: Audit Model — Append-Only Hash Chain with Fail-Closed Enforcement

**Chosen:** Every governance verdict, agent action, and lifecycle event produces an `AuditLogEntry` with `previousHash` and `currentHash` fields forming a cryptographic hash chain. Entries are append-only. Tombstones may redact content but must preserve chain linkage.

**Rejected:**
- **Traditional logging (structured logs without chain)** — Logs can be silently deleted, reordered, or modified. In a governance system where refusal provenance is a legal/compliance requirement, tamper evidence is not optional. A hash chain makes any modification to historical records detectable.
- **Event sourcing without hash chain** — Event sourcing provides append-only semantics and replay, but without cryptographic linking, the integrity of the event stream depends entirely on access control to the event store. The hash chain provides integrity evidence independent of storage-layer trust.

**Evidence:**
- `SHARED_TYPES.md` §10.3: `AuditLogEntry` includes `previousHash: string` and `currentHash: string`. Validation rule: "`previousHash` MUST match the prior retained entry for the same audit chain. `currentHash` MUST hash the canonical serialized entry excluding `currentHash`."
- `SHARED_TYPES.md` §10.3: "Tombstones may redact `details` but MUST preserve identity, hash chain linkage, event type, timestamp, and classification." — GDPR erasure is supported without breaking the chain.
- `src/compliance/audit/enterprise-logger.ts` line 127: "Append-only, fail-closed. The entry is hash-chained to the previous entry."
- `SHARED_TYPES.md` §20: `auditAppend.maxMs: 50`, `mode: 'durable_before_success'` — the audit write completes before the governance verdict is returned. No success without audit.

**Reasoning:** The hash chain provides tamper evidence at the data structure level, independent of infrastructure security. Combined with fail-closed enforcement (no success without audit) and tombstone-safe redaction (chain survives GDPR erasure), the audit model satisfies both security and compliance requirements without architectural compromise.

---

## AD-7: API Surface — Async Factory with Deep Freeze

**Chosen:** Single `createLimen()` async factory function as the sole entry point. Returns a recursively frozen (`Object.freeze`) Limen object. Two calls produce independent instances (C-06).

**Rejected:**
- **Class-based singleton** — Singletons create hidden global state. In multi-tenant scenarios, agents from different tenants sharing a singleton is a cross-tenant leakage vector (FM-10). Independent instances via factory eliminate this by construction.
- **Builder pattern** — Builders accumulate mutable state during construction, then freeze. The factory does the same but in a single atomic operation. A builder would expose partially-constructed Limen objects if `build()` is forgotten — the factory makes this impossible.
- **Mutable object with runtime guards** — Runtime mutability checks add overhead to every property access and can be bypassed via prototype manipulation. `Object.freeze` is enforced by the JavaScript engine itself — no application code can circumvent it.

**Evidence:**
- `src/api/index.ts` (factory function, ~2400 lines): `createLimen()` factory documented with invariants C-06 (independent instances), C-07 (recursive freeze), FPD-2 (async factory), FPD-4 (deep freeze).
- `src/api/index.ts` line 22: 6-step composition — L1 Kernel, L1.5 Substrate, L2 Orchestration, API composition, deep freeze, return.
- `src/api/index.ts` lines 358-371: `deepFreeze` implementation with recursive `Object.freeze`.
- `src/api/index.ts` line 582: `return Object.freeze({...})` — the final API object.

**Reasoning:** The factory-plus-freeze pattern makes the Limen API object immutable by construction. No consumer can modify the kernel, governance engine, or audit chain via the public API. Independence (C-06) prevents cross-tenant contamination. Deep freeze (C-07, FPD-4) is applied once at factory time with zero ongoing cost — no runtime guards, no proxy overhead.

---

## AD-8: Trust and Clearance Model — 5-Level Hierarchical Trust

**Chosen:** 5-level agent trust model (`untrusted` -> `low` -> `medium` -> `high` -> `verified`) mapped to numeric clearance levels (0-4). Capabilities unlocked progressively by trust level. Trust state persisted in Core as a 4-level state machine, with the 5th level (`high` vs `verified` distinction) as a Phase X session-governance overlay.

**Rejected:**
- **Binary trusted/untrusted** — Insufficient granularity. An agent that has been running for 30 seconds should not have the same capabilities as one that has been verified by a human administrator. Progressive trust unlocking maps to real-world agent lifecycle.
- **Capability-based without trust hierarchy** — Capabilities without trust levels require explicit per-agent capability grants for every operation. The trust hierarchy provides sensible defaults: `untrusted` gets `memory_read` and `context_management`; `verified` gets everything including `purge_data` and `manage_roles`. This reduces configuration burden while maintaining security.
- **Flat RBAC (roles without clearance)** — Roles control what operations are available. Clearance controls what data is visible. A `medium` trust agent can execute memory operations but cannot access `classified` or `critical` data (clearance 2 only reaches `restricted`). Separating trust from clearance enables orthogonal access control.

**Evidence:**
- `SHARED_TYPES.md` §5: `AgentTrustLevel` = 5-value enum. `TRUST_TO_CLEARANCE` mapping. `PHASE_X_TO_CORE_TRUST` bridging Phase X to Core state machine.
- `SHARED_TYPES.md` §5 (Trust and Clearance Model): Capability unlocking table — 20 capabilities gated by trust level.
- `SHARED_TYPES.md` §1.2: 31 permissions in the RBAC layer, orthogonal to trust/clearance.
- `SHARED_TYPES.md` §3: `ClassificationLevel` with numeric mapping — clearance must meet or exceed classification to access data.

**Reasoning:** The 5-level model balances security granularity with operational simplicity. The Core-to-Phase-X bridge (`PHASE_X_TO_CORE_TRUST`) ensures backward compatibility with the existing 4-level persisted trust while adding the session-governance overlay that Phase X requires. Clearance-based data access (numeric comparison) is O(1) and fits within the <10ms governance budget.

---

## AD-9: Event System — Typed Event Bus with ~110 Domain Events

**Chosen:** Strongly-typed event bus with ~110 event types spanning governance, lifecycle, memory, action, session, and system domains. Wildcard subscription (`'*'`). Ordering guaranteed within a session; cross-session ordering by audit-chain timestamp only.

**Rejected:**
- **Callback registration without event types** — Untyped callbacks (`on('event', handler)`) provide no compile-time guarantee that the handler matches the event payload. With ~110 event types, runtime type errors become inevitable.
- **External message broker (Redis, RabbitMQ)** — Limen is an embedded library with a single runtime dependency (`better-sqlite3`). Adding a message broker dependency violates the zero-config principle and introduces network failure modes into the event path.
- **Synchronous observer pattern** — Synchronous observers in the governance hot path would extend the <10ms budget. The event bus decouples event emission from handling, keeping governance checks fast while allowing adapters to react asynchronously.

**Evidence:**
- `SHARED_TYPES.md` §16: Unified Event System — `AgentEvent` type with ~110 variants including `governance:allowed`, `governance:refused`, `governance:escalated`, `governance:sandboxed`, `action:refused`, session events, memory events.
- `SHARED_TYPES.md` §16: "`emit` is internal-only; adapters subscribe and translate but do not suppress audit-bound events."
- `SHARED_TYPES.md` §16: "Event ordering is guaranteed within a single `sessionId`; cross-session ordering is by audit-chain timestamp only."
- `AGENT_ADAPTER_ARCHITECTURE.md` §3: `mapNativeEvent` and `mapLimenEvent` on the adapter interface — bidirectional event translation.

**Reasoning:** The typed event bus provides compile-time safety for ~110 event types while maintaining the single-dependency architecture. Session-scoped ordering avoids the complexity of global ordering (which would require consensus) while providing the guarantee that matters: within a single agent's session, events are causally ordered.

---

## AD-10: Composition Architecture — Layered Kernel with Single Composition Root

**Chosen:** Three-layer architecture (L1 Kernel, L1.5 Substrate, L2 Orchestration) composed in a single factory function (`createLimen()`). All wiring happens at construction time. No service locator, no dependency injection container.

**Rejected:**
- **Dependency injection container** — DI containers (InversifyJS, tsyringe) add runtime reflection, decorators, and container configuration. They obscure the wiring — you must read container configuration to understand what depends on what. A single composition root makes all wiring explicit and readable in one file.
- **Microkernel with dynamic module loading** — Dynamic loading introduces startup non-determinism (which modules loaded? in what order?). The layered kernel has a fixed build order (L1 -> L1.5 -> L2) documented in the factory (`src/api/index.ts` lines 17-23, build order comment). Build order violations are caught at compile time, not runtime.
- **Flat module structure** — No layering means any module can depend on any other. The L1/L1.5/L2 hierarchy enforces a dependency direction: L2 depends on L1.5, L1.5 depends on L1, never the reverse. This prevents circular dependencies by construction.

**Evidence:**
- `src/api/index.ts` lines 17-23: Factory creates L1 Kernel (SQLite, migrations, RBAC, audit, crypto, events), L1.5 Substrate (worker pool, LLM gateway, capability adapters, scheduler), L2 Orchestration (mission store, task graph, budget, checkpoints, conversations).
- `src/api/index.ts` line 9: "This factory function is large (~2400 lines) because it wires all kernel components in a single composition root." — acknowledged as intentional, not accidental.
- Architecture Overview §2.1: Layer diagram showing strict top-to-bottom dependency flow from Agent Frameworks through Adapters through Shared Types through governance layers through Core.
- `CLAUDE.md` frozen zones: `src/kernel/crypto/` — the kernel layer has security-critical frozen zones, confirming the kernel is the innermost trust boundary.

**Reasoning:** A single composition root trades file-level modularity for wiring transparency. Every dependency relationship is visible in one file. The ~2400 line size is the cost of explicitness — the documented future refactor (decompose into `buildKernelLayer()`, `buildSubstrateLayer()`, etc.) would split the file while preserving the single-composition-root principle. The three-layer hierarchy (kernel, substrate, orchestration) maps to three trust boundaries: kernel owns crypto and audit, substrate owns agent communication, orchestration owns mission lifecycle.

---

## AD-11: Error Handling Strategy

**Chosen:** Result<T, E> return types (never throw)

**Rejected:**
- **Exception-based (throw/catch)** — Exceptions are invisible in type signatures. Callers can silently ignore error paths. In a governance system where every failure must be handled explicitly (audit trail, escalation), invisible error paths are unacceptable.
- **Error codes only** — Numeric error codes lose semantic context and require lookup tables. Result types carry the full error payload with type safety.
- **Hybrid (throw for unexpected, Result for expected)** — Creates ambiguity about which functions throw and which return Results. A single convention eliminates this class of confusion.

**Evidence:**
- `SHARED_TYPES.md` §1.5 defines `Result<T>`, used throughout `api/`, `adapters/`, `compliance/`.

**Reasoning:** Result types make error paths explicit. Every caller must handle the error case — the compiler enforces it. Aligns with Rust parity (`Result<T, E>` in both projections).

---

## AD-12: Schema Migration Strategy

**Chosen:** Forward-only imperative migrations (numbered .ts files)

**Rejected:**
- **Reversible migrations** — Rollback logic doubles migration surface area and is rarely tested. In practice, forward-only with a new corrective migration is simpler and more reliable.
- **Declarative schema** — Declarative diff-based tools struggle with SQLite's limited `ALTER TABLE` support. Imperative migrations give explicit control over each schema change.
- **ORM-managed** — ORM migration generators produce opaque SQL that may not respect SQLite constraints. Hand-written migrations are auditable and predictable.

**Evidence:**
- `src/api/migration/` contains migration files numbered up to 047 (forward-only, with gaps).

**Reasoning:** SQLite has limited `ALTER TABLE`. Forward-only is simpler and matches append-only audit philosophy. Each migration is a numbered TypeScript file that runs exactly once, tracked by the migration table.

---

## AD-13: Test Framework

**Chosen:** `node:test` (built-in) + Stryker (mutation)

**Rejected:**
- **Jest** — External dependency with heavy runtime (babel transforms, custom globals). Adds ~15MB to devDependencies and introduces a parallel module resolution system.
- **Vitest** — Lighter than Jest but still an external dependency with its own configuration surface. No compelling advantage over the built-in.
- **Mocha** — External dependency requiring separate assertion library. `node:test` includes both runner and assertions.

**Evidence:**
- `CLAUDE.md`: documents `npm test` (node:test) and `npx stryker run` (mutation testing) as the test commands.
- `package.json` devDependencies: `@stryker-mutator/core` and related packages.

**Reasoning:** Zero external test dependency. `node:test` is Node.js built-in — no install, no version drift, no configuration. Stryker validates test quality via mutation killing, ensuring tests are not just passing but actually verifying behavior.

---

## AD-14: Multi-Tenancy Isolation

**Chosen:** Row-level `tenant_id` filtering via `TenantScopedConnection`

**Rejected:**
- **Separate databases per tenant** — Multiplies file handles, migration complexity, and backup surface. A single SQLite file with row-level filtering is operationally simpler and sufficient for the embedded library model.
- **Schema-level isolation** — SQLite does not support schemas as isolation boundaries. Schema-level isolation would require multiple attached databases, adding complexity without benefit over row-level filtering.

**Evidence:**
- `src/kernel/tenant/tenant_scope.ts`: `TenantScopedConnection` injects `WHERE tenant_id = ?` on every query.
- `TenantId` branded type (ST-1.01) ensures tenant IDs cannot be confused with other string types at compile time.

**Reasoning:** Single SQLite file with row-level filtering. `TenantScopedConnection` injects `WHERE tenant_id = ?` on every query, making cross-tenant data access structurally impossible through the scoped connection. Combined with branded `TenantId` types, tenant isolation is enforced at both the type level and the query level.
