# Failure Mode Defense Inventory

**Project:** Limen v3.3.0
**Specification claim:** 45 failure mode defenses
**Date:** 2026-03-24
**Evidence class key:** Verified = defense code + meaningful tests | Implemented = defense code + scaffold/decorative tests | Declared = comment/spec reference only | Out of Scope = applies to unimplemented deployment context

---

## Section 1: Verified Defenses

These failure modes have traceable defense code in the implementation AND meaningful tests that exercise the defense against real behavior (not `assert.ok(true)` scaffolds).

---

### FM-01: Memory Poisoning (Quarantine Cascade)

| Field | Content |
|---|---|
| **FM ID** | FM-01 |
| **Name** | Memory Poisoning |
| **Severity** | High |
| **Defense Mechanism** | Atomic suspension of techniques derived from poisoned memory via quarantine cascade; resolution requires human authority (HITL review) |
| **Defense Location** | `src/learning/quarantine/quarantine_manager.ts:89` (quarantine cascade transaction) |
| **Test Location** | `tests/learning/test_convergence_subsystems.test.ts:106` (quarantine edge cases — empty, retired, already-suspended, cross-agent) |
| **Evidence Class** | Verified |

---

### FM-02: Cost Explosion

| Field | Content |
|---|---|
| **FM ID** | FM-02 |
| **Name** | LLM Cost Explosion |
| **Severity** | Critical |
| **Defense Mechanism** | Multi-layer defense: budget pre-check in consume(), CHECK constraint on token_remaining >= 0, mission transitions to BLOCKED on exceed, retry cap of 10 in infer pipeline, rate limiting |
| **Defense Location** | `src/orchestration/budget/budget_governance.ts:91` (pre-check + BUDGET_EXCEEDED), `src/api/infer/infer_pipeline.ts:174` (maxRetries cap), `src/api/enforcement/cost_tracker.ts:26` (cost tracking), `src/api/enforcement/rate_guard.ts:19` (rate limit) |
| **Test Location** | `tests/gap/test_gap_005_budget_enforcement.test.ts:29` (BUDGET_EXCEEDED rejection + success path), `tests/api/api_infer.test.ts:1` (infer pipeline), `tests/streaming/streaming_pipeline.test.ts:175` (streaming cost) |
| **Evidence Class** | Verified |

---

### FM-05: State Corruption Under Concurrency

| Field | Content |
|---|---|
| **FM ID** | FM-05 |
| **Name** | State Corruption Under Concurrency |
| **Severity** | High |
| **Defense Mechanism** | SQLite WAL mode + busy timeout (5000ms default) + foreign keys + transaction boundaries around multi-statement operations |
| **Defense Location** | `src/kernel/database/database_lifecycle.ts:159` (WAL mode pragma), `src/kernel/database/database_lifecycle.ts:162` (busy timeout pragma) |
| **Test Location** | `tests/scaffold/failure-modes/fm05_state_corruption_concurrency.test.ts:87` (scaffold with local-constant assertions on WAL/timeout config) |
| **Evidence Class** | Implemented |

**Classification note:** The scaffold tests for FM-05 are marked as decorative (`assert.ok(true)`) on many assertions. However, real WAL mode enforcement is verified by the database lifecycle opening every database with `journal_mode = WAL` and `busy_timeout`. The defense is structural (SQLite configuration at open time), not algorithmic. Classified as Implemented rather than Verified because the concurrency stress scenarios in the scaffold tests use `assert.ok(true)` and do not exercise actual concurrent access.

---

### FM-06: Provider Dependency

| Field | Content |
|---|---|
| **FM ID** | FM-06 |
| **Name** | Single LLM Provider Failure |
| **Severity** | High |
| **Defense Mechanism** | Graceful degradation when providers unavailable; health check reports 'degraded' status; PROVIDER_UNAVAILABLE error code with retryable semantics; webhook delivery with retry |
| **Defense Location** | `src/api/observability/health.ts:3` (degraded health), `src/api/errors/limen_error.ts:149` (retryable error), `src/kernel/events/webhook_delivery.ts:24` (delivery retry), `src/substrate/gateway/llm_gateway.ts:12` (gateway failover) |
| **Test Location** | `tests/api/api_chat.test.ts:1` (chat pipeline FM-06), `tests/streaming/streaming_pipeline.test.ts:131` (streaming failure handling) |
| **Evidence Class** | Verified |

---

### FM-07: Learning Drift / Over-Specialization

| Field | Content |
|---|---|
| **FM ID** | FM-07 |
| **Name** | Learning Drift / Over-Specialization |
| **Severity** | Medium |
| **Defense Mechanism** | Shannon entropy detector flags agents where >90% of techniques are one type; specialization score computation with threshold |
| **Defense Location** | `src/learning/specialization/over_specialization_detector.ts:47` (analyze function with entropy calculation) |
| **Test Location** | `tests/learning/test_convergence_subsystems.test.ts:527` (over-specialization edge cases — N=0, N=1) |
| **Evidence Class** | Verified |

---

### FM-08: Audit Trail Tampering

| Field | Content |
|---|---|
| **FM ID** | FM-08 |
| **Name** | Audit Trail Tampering |
| **Severity** | Critical |
| **Defense Mechanism** | Append-only audit table enforced by SQLite triggers (BEFORE UPDATE/DELETE raise ABORT); SHA-256 hash chaining with monotonic sequence numbers; genesis anchor from well-known constant; chain verification as health check |
| **Defense Location** | `src/kernel/database/migrations.ts:47` (append-only triggers), `src/kernel/audit/audit_trail.ts:47` (SHA-256 hash computation), `src/kernel/audit/audit_trail.ts:70` (chain verification) |
| **Test Location** | `tests/gap/test_gap_004_audit_tamper.test.ts:56` (hash chain integrity — valid chain, tampered, gap, reorder), `tests/gap/test_gap_015_security_enforcement.test.ts:37` (security enforcement) |
| **Evidence Class** | Verified |

---

### FM-09: Tool Poisoning

| Field | Content |
|---|---|
| **FM ID** | FM-09 |
| **Name** | Tool Poisoning |
| **Severity** | High |
| **Defense Mechanism** | Capability registry validates tool execution against registered types; SANDBOX_VIOLATION error on unregistered capability execution; worker isolation via Node.js worker threads |
| **Defense Location** | `src/substrate/adapters/capability_registry.ts:153` (capability type validation), `src/substrate/adapters/capability_registry.ts:192` (SANDBOX_VIOLATION rejection), `src/substrate/workers/worker_runtime.ts:11` (worker isolation) |
| **Test Location** | `tests/gap/test_gap_016_enforcement_mechanisms.test.ts:146` (SANDBOX_VIOLATION test), `tests/scaffold/failure-modes/fm09_tool_poisoning.test.ts:109` (scaffold — largely decorative) |
| **Evidence Class** | Implemented |

**Classification note:** The capability registry enforces SANDBOX_VIOLATION in production code, and the gap test verifies this rejection path with real assertions. However, the dedicated FM-09 scaffold test file is entirely decorative (`assert.ok(true)` on tool registration validation, description analysis, provenance tracking, allowlist enforcement). The gap test proves the fail-closed behavior exists; the scaffold tests do not exercise the deeper tool poisoning vectors (schema validation, description analysis, provenance). Classified as Implemented.

---

### FM-10: Tenant Data Leakage

| Field | Content |
|---|---|
| **FM ID** | FM-10 |
| **Name** | Tenant Data Leakage |
| **Severity** | Critical |
| **Defense Mechanism** | TenantScopedConnection auto-injects `AND tenant_id = ?` on every SELECT/UPDATE/DELETE; tenant_id column on every table enforced by migration v13; complex SQL fail-safe throws on JOINs/CTEs/subqueries; branded type TenantId prevents accidental misuse |
| **Defense Location** | `src/kernel/tenant/tenant_scope.ts:95` (injectTenantPredicate), `src/orchestration/migration/004_tenant_isolation.ts:19` (migration v13), `src/kernel/interfaces/common.ts:12` (branded TenantId type) |
| **Test Location** | `tests/gap/test_gap_001_tenant_isolation.test.ts:30` (TENANT_ID_REQUIRED rejection + cross-tenant isolation), `tests/gap/test_gap_009_cross_tenant_isolation.test.ts:71` (40+ cross-tenant rejection tests across all stores), `tests/gap/test_gap_012_adversarial_tenant.test.ts:259` (adversarial bypass), `tests/gap/test_gap_010_migration_v13_verification.test.ts:57` (structural verification of every table) |
| **Evidence Class** | Verified |

---

### FM-11: Observability Overhead

| Field | Content |
|---|---|
| **FM ID** | FM-11 |
| **Name** | Observability Overhead Exceeds 2% |
| **Severity** | Medium |
| **Defense Mechanism** | Latency budget verification harness checks per-phase timing against spec budgets (103ms hot-path total excluding LLM); per-tenant metrics entry cap prevents unbounded memory growth |
| **Defense Location** | `src/api/enforcement/latency_harness.ts:23` (latency budget verification), `src/api/observability/metrics.ts:71` (per-tenant metrics cap) |
| **Test Location** | `tests/scaffold/failure-modes/fm11_observability_overhead.test.ts:89` (scaffold — largely decorative with local-constant assertions) |
| **Evidence Class** | Implemented |

**Classification note:** The defense code exists and is wired into production. The scaffold tests verify configuration constants (sampling rates, log levels, span counts) against spec values using local constants, but the overhead benchmark test (`assert.ok(true)`) does not run a real benchmark. Classified as Implemented because the defense mechanism exists in production but the 2% overhead claim is not exercised by a real benchmark test.

---

### FM-12: Provider Failover Budget Cascade

| Field | Content |
|---|---|
| **FM ID** | FM-12 |
| **Name** | Provider Failover Budget Cascade |
| **Severity** | High |
| **Defense Mechanism** | Budget-aware failover with three policies (degrade, allow-overdraft, block); checkFailoverBudget() pre-checks before provider switch; overdraft tracking for billing |
| **Defense Location** | `src/substrate/gateway/llm_gateway.ts:515` (checkFailoverBudget implementation with policy switch) |
| **Test Location** | `tests/scaffold/failure-modes/fm12_provider_failover_budget.test.ts:102` (scaffold — decorative policy assertions), `tests/scaffold/substrate/llm_gateway.test.ts:401` (scaffold — failover budget section) |
| **Evidence Class** | Implemented |

**Classification note:** The checkFailoverBudget function is fully implemented with three-policy logic in the LLM gateway. However, all tests for this FM are scaffold tests with decorative assertions on local constants. No integration test exercises the actual failover-triggers-budget-check path. Classified as Implemented.

---

### FM-13: Unbounded Cognitive Autonomy

| Field | Content |
|---|---|
| **FM ID** | FM-13 |
| **Name** | Unbounded Cognitive Autonomy |
| **Severity** | Critical |
| **Defense Mechanism** | Multi-structural bounds: maxDepth, maxChildren, maxTasks per mission; event rate limiting (10/minute per agent); reserved namespace rejection prevents agent spoofing of system events; budget as natural limiter |
| **Defense Location** | `src/orchestration/events/event_propagation.ts:46` (rate limiting), `src/orchestration/events/event_propagation.ts:23` (reserved namespace), `src/orchestration/tasks/task_graph.ts:121` (task limits) |
| **Test Location** | `tests/rate-limiting/rate_limiting.test.ts:1` (rate limiting verification), `tests/gap/test_gap_019_sc_error_codes.test.ts:679` (namespace validation), `tests/gap/test_gap_015_security_enforcement.test.ts:170` (security enforcement of rate limits) |
| **Evidence Class** | Verified |

---

### FM-14: Semantic Drift

| Field | Content |
|---|---|
| **FM ID** | FM-14 |
| **Name** | Semantic Drift |
| **Severity** | High |
| **Defense Mechanism** | Drift engine computes TF-IDF cosine similarity between checkpoint assessment and goal anchor; driftScore > 0.7 triggers escalation; append-only drift assessment records |
| **Defense Location** | `src/orchestration/checkpoints/drift_engine.ts:69` (assessDrift function with similarity computation and thresholds) |
| **Test Location** | `tests/contract/test_contract_drift_engine.test.ts:6` (drift engine contract tests) |
| **Evidence Class** | Verified |

---

### FM-15: Artifact Entropy

| Field | Content |
|---|---|
| **FM ID** | FM-15 |
| **Name** | Artifact Entropy |
| **Severity** | High |
| **Defense Mechanism** | Artifact lifecycle states (ACTIVE -> SUMMARIZED -> ARCHIVED -> DELETED); relevance decay counter incremented per task cycle without read; automatic summarization when decay exceeds threshold; agents read only ACTIVE artifacts by default |
| **Defense Location** | `src/orchestration/artifacts/artifact_store.ts:234` (artifact count for mission), `src/reference-agent/artifact_manager.ts:62` (purposeful creation — one artifact per task output) |
| **Test Location** | `tests/contract/test_contract_sc4_create_artifact.test.ts:271` (relevance_decay starts at 0), `tests/scaffold/failure-modes/fm15_artifact_entropy.test.ts:53` (scaffold — decorative lifecycle assertions) |
| **Evidence Class** | Implemented |

**Classification note:** The artifact lifecycle states and relevance_decay column exist in the schema. The artifact store tracks decay. The reference agent creates artifacts purposefully. However, the automatic ACTIVE->SUMMARIZED transition on high decay and the "agents read only ACTIVE by default" filtering are scaffold-tested only with `assert.ok(true)`. The contract test verifies initial decay=0 on creation. Classified as Implemented because the infrastructure exists but the automated decay-triggered summarization is not exercised by meaningful tests.

---

### FM-16: Mission Drift

| Field | Content |
|---|---|
| **FM ID** | FM-16 |
| **Name** | Mission Drift |
| **Severity** | Medium |
| **Defense Mechanism** | Checkpoint reflection against goal anchor using drift engine; confidence-driven escalation when below 0.5 threshold; budget constraints limit wasted effort |
| **Defense Location** | `src/reference-agent/checkpoint_handler.ts:189` (FM-16 escalation on low confidence), `src/orchestration/checkpoints/drift_engine.ts:3` (drift detection) |
| **Test Location** | `tests/contract/test_contract_drift_engine.test.ts:6` (drift engine), `tests/scaffold/failure-modes/fm16_mission_drift.test.ts:42` (scaffold — decorative) |
| **Evidence Class** | Implemented |

**Classification note:** The drift engine is verified (see FM-14). The checkpoint_handler references FM-16 and implements confidence-driven escalation. But the dedicated FM-16 scaffold test is entirely `assert.ok(true)`. The meaningful test coverage comes from the drift engine contract tests (which cover the detection mechanism shared with FM-14). Classified as Implemented because the escalation path in checkpoint_handler is not directly exercised by a non-scaffold test.

---

### FM-17: Plan Explosion

| Field | Content |
|---|---|
| **FM ID** | FM-17 |
| **Name** | Plan Explosion |
| **Severity** | High |
| **Defense Mechanism** | Per-mission task count limit (TASK_LIMIT_EXCEEDED); plan revision limit (PLAN_REVISION_LIMIT); both enforced in proposeGraph with specific error codes |
| **Defense Location** | `src/orchestration/tasks/task_graph.ts:123` (TASK_LIMIT_EXCEEDED), `src/orchestration/tasks/task_graph.ts:128` (PLAN_REVISION_LIMIT), `src/reference-agent/mission_planner.ts:310` (revision limit check in replan) |
| **Test Location** | `tests/gap/test_gap_019_sc_error_codes.test.ts:94` (TASK_LIMIT_EXCEEDED rejection), `tests/gap/test_gap_019_sc_error_codes.test.ts:176` (PLAN_REVISION_LIMIT rejection) |
| **Evidence Class** | Verified |

---

### FM-18: Capability Escalation

| Field | Content |
|---|---|
| **FM ID** | FM-18 |
| **Name** | Capability Escalation |
| **Severity** | High |
| **Defense Mechanism** | Capabilities frozen at mission creation (I-22 immutability); no self-grant operation exists; child mission capabilities must be subset of parent |
| **Defense Location** | `src/orchestration/missions/mission_store.ts` (capabilities frozen in JSON at creation), `src/orchestration/interfaces/orchestration.ts` (I-22 immutability constraint) |
| **Test Location** | `tests/scaffold/failure-modes/fm18_capability_escalation.test.ts:50` (scaffold — decorative), `tests/scaffold/invariants/i22_capability_immutability.test.ts` (scaffold — I-22 tests) |
| **Evidence Class** | Implemented |

**Classification note:** Capability immutability is enforced by the data model (capabilities stored as frozen JSON at creation, no mutation API exists). The defense is structural — there is no `grantCapability()` or `expandCapabilities()` API to call. The scaffold tests document this structural defense with `assert.ok(true)` rather than testing against real rejection paths. Classified as Implemented because the structural defense is real but not exercised by meaningful rejection-path tests.

---

### FM-19: Delegation Cycle

| Field | Content |
|---|---|
| **FM ID** | FM-19 |
| **Name** | Delegation Cycle |
| **Severity** | High |
| **Defense Mechanism** | Visited set (AgentId[]) in delegation chain; before delegating, check if target agent is in visited set; immediate rejection with DELEGATION_CYCLE error code and full cycle path |
| **Defense Location** | `src/orchestration/missions/mission_store.ts:140` (cycle detection), `src/orchestration/missions/mission_store.ts:142` (DELEGATION_CYCLE rejection with chain path) |
| **Test Location** | `tests/gap/test_gap_002_mission_validation.test.ts:179` (FM-19 delegation cycle detection — both success and rejection paths), `tests/api/api_missions.test.ts:71` (API-level delegation cycle check), `tests/contract/test_contract_sc1_propose_mission.test.ts:287` (delegation chain propagation) |
| **Evidence Class** | Verified |

---

### FM-20: Worker Deadlock

| Field | Content |
|---|---|
| **FM ID** | FM-20 |
| **Name** | Worker Deadlock / Hung Workers |
| **Severity** | Medium |
| **Defense Mechanism** | Heartbeat protocol: 30s default interval, escalation ladder (1 miss = warn, 2 = notify, 3 = kill + retry); heartbeat columns in core_task_queue; independent execution timeout per task |
| **Defense Location** | `src/substrate/heartbeat/heartbeat_monitor.ts:114` (checkCycle with escalation ladder — warn/notify/kill), `src/substrate/migration/002_substrate.ts:31` (heartbeat columns) |
| **Test Location** | `tests/scaffold/failure-modes/fm20_worker_deadlock.test.ts:78` (scaffold — decorative), `tests/scaffold/substrate/heartbeat_protocol.test.ts:145` (scaffold — decorative) |
| **Evidence Class** | Implemented |

**Classification note:** The heartbeat monitor is fully implemented with the three-tier escalation ladder (warn at 1, notify at 2, kill at 3 missed heartbeats). The checkCycle function reads actual database state, computes missed beats, and records audit entries. However, all tests are scaffold tests marked decorative. No integration test starts a real worker, misses heartbeats, and verifies the kill/retry path. Classified as Implemented.

---

### FM-22: CCP Claim Events

| Field | Content |
|---|---|
| **FM ID** | FM-22 |
| **Name** | CCP Claim Event Integrity |
| **Severity** | Medium |
| **Defense Mechanism** | CCP (Claim Certification Protocol) event emission with lifecycle tracking; EventBus integration ensures claim lifecycle events (assert, relate, supersede) are emitted with correct scope and propagation |
| **Defense Location** | Referenced in CCP event pipeline within the claims subsystem (event emission wired through EventBus) |
| **Test Location** | `tests/contract/test_contract_ccp_events.test.ts:8` (CCP event contract tests with real assertions against mock EventBus) |
| **Evidence Class** | Verified |

---

### FM-35: CGP Cross-Position Dedup

| Field | Content |
|---|---|
| **FM ID** | FM-35 |
| **Name** | Context Governor Cross-Position Dedup |
| **Severity** | Low |
| **Defense Mechanism** | Renderer produces distinct canonical texts for different entity types (artifact vs memory) even when underlying content is identical, preventing false duplicates in the context governor algorithm |
| **Defense Location** | Defense is structural — the CGP renderer's design produces type-tagged canonical texts (no explicit FM-35 label in source) |
| **Test Location** | `tests/contract/test_contract_cgp.test.ts:2292` (DC-CGP-705 with real assertions: `assert.notStrictEqual` on artifact vs memory text) |
| **Evidence Class** | Verified |

---

## Section 2: Unimplemented Failure Modes

The specification defines 45 failure modes (FM-01 through FM-45). The following table lists failure modes NOT covered in Section 1 — either because they have zero code presence, only comment-level references, or apply to deployment contexts not supported in v1.x.

| FM ID | Name (Inferred from Spec Context) | Evidence Class | Explanation |
|---|---|---|---|
| FM-03 | Prompt Injection | Out of Scope | Zero code references. Structural output validation exists (JSON Schema) but no prompt-injection-specific defense. Future obligation. |
| FM-04 | Cascading Agent Failure | Declared | Referenced only in FM-19 scaffold as "broader category." FM-19 (delegation cycle) partially covers. No independent cascading failure defense. |
| FM-21 | (Unidentified) | Out of Scope | No code references. Likely applies to deployment context not supported in v1.x. |
| FM-23 | (Unidentified) | Out of Scope | No code references. |
| FM-24 | (Unidentified) | Out of Scope | No code references. |
| FM-25 | (Unidentified) | Out of Scope | No code references. |
| FM-26 | (Unidentified) | Out of Scope | No code references. |
| FM-27 | (Unidentified) | Out of Scope | No code references. |
| FM-28 | (Unidentified) | Out of Scope | No code references. |
| FM-29 | (Unidentified) | Out of Scope | No code references. |
| FM-30 | (Unidentified) | Out of Scope | No code references. |
| FM-31 | (Unidentified) | Out of Scope | No code references. |
| FM-32 | (Unidentified) | Out of Scope | No code references. |
| FM-33 | (Unidentified) | Out of Scope | No code references. |
| FM-34 | (Unidentified) | Out of Scope | No code references. |
| FM-36 | (Unidentified) | Out of Scope | No code references. |
| FM-37 | (Unidentified) | Out of Scope | No code references. |
| FM-38 | (Unidentified) | Out of Scope | No code references. |
| FM-39 | (Unidentified) | Out of Scope | No code references. |
| FM-40 | (Unidentified) | Out of Scope | No code references. |
| FM-41 | (Unidentified) | Out of Scope | No code references. |
| FM-42 | (Unidentified) | Out of Scope | No code references. |
| FM-43 | (Unidentified) | Out of Scope | No code references. |
| FM-44 | (Unidentified) | Out of Scope | No code references. |
| FM-45 | (Unidentified) | Out of Scope | No code references. |

**Note on "Unidentified" names:** The specification document defining FM-21 through FM-45 is not available in the repository. These FM IDs are inferred from the specification's claim of "45 failure mode defenses." Without the spec document, their names and descriptions cannot be verified. The codebase contains zero references to FM-21, FM-23 through FM-34, and FM-36 through FM-45. They are classified as Out of Scope pending spec document availability.

---

## Section 3: Correcting the Record

The Limen specification defines 45 failure modes (FM-01 through FM-45). Of these, 21 unique FM IDs have traceable presence in the codebase (source code references, test references, or both): FM-01, FM-02, FM-04, FM-05, FM-06, FM-07, FM-08, FM-09, FM-10, FM-11, FM-12, FM-13, FM-14, FM-15, FM-16, FM-17, FM-18, FM-19, FM-20, FM-22, and FM-35.

Of these 21:

- **12 are Verified** — defense code exists with meaningful, non-decorative test coverage that exercises real behavior: FM-01, FM-02, FM-06, FM-07, FM-08, FM-10, FM-13, FM-14, FM-17, FM-19, FM-22, FM-35.
- **8 are Implemented** — defense code exists in production but tests are scaffold-only (marked decorative with `assert.ok(true)`) or test coverage is indirect: FM-05, FM-09, FM-11, FM-12, FM-15, FM-16, FM-18, FM-20.
- **1 is Declared** — referenced in test comments as a cross-reference but lacks independent defense code: FM-04.

The remaining 24 FM IDs (FM-21, FM-23 through FM-34, FM-36 through FM-45) have zero references anywhere in the codebase. They are either defined in the specification for deployment contexts not supported in v1.x (distributed multi-node, horizontal scaling, cross-datacenter scenarios) or represent future obligations not yet addressed.

**This document claims 12 verified failure mode defenses with full test coverage, 8 implemented defenses with scaffold-only or indirect test coverage, and 1 declared defense with test-comment-only presence. The total traceable defense count is 21, not 45.**

The gap between the specification's 45 failure modes and the codebase's 21 traceable defenses is the primary honesty obligation. The 24 untraced FMs are not failures of implementation — they may be legitimate deferrals for deployment contexts that v1.x does not support. But the project's external claims must reflect 21 traceable defenses, not 45.

---

## Appendix: Evidence Class Definitions

| Class | Definition | Criteria |
|---|---|---|
| **Verified** | Defense code exists in source AND meaningful tests exercise the defense | Tests use real assertions against real behavior; `assert.ok(true)` does not qualify |
| **Implemented** | Defense code exists in source but tests are scaffold/decorative or indirect | Source defense is real; test coverage is weak, indirect, or scaffold-only |
| **Declared** | Referenced in comments, spec traces, or cross-references only | No independent defense mechanism in source |
| **Out of Scope** | Applies to deployment context not supported in v1.x | Zero references in codebase; likely deferred by design |

## Appendix: Scaffold Test Classification

All files in `tests/scaffold/failure-modes/` carry the header:
```
// SCAFFOLD: Decorative test — assert.ok(true) or local-constant assertions only.
```

These tests document the specification's requirements and defense contracts but do not exercise real implementation behavior. They pass regardless of whether the defense code exists. Per Hard Ban #8, these do not constitute verification. Where a scaffold test is the only test for an FM, that FM is classified as Implemented (if defense code exists) or Declared (if it does not).
