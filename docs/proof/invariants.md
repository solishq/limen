# Invariants — Evidence Index

> This document is CI-governed. Every `file:line` reference is verified by `scripts/verify-proof-pack.ts`.
> Stale references fail the build.
>
> Generated: 2026-03-24
> Limen version: 3.3.0 (internal spec version; npm package: v2.0.0)

## Evidence Classes

| Class | Definition | Criteria |
|---|---|---|
| **Verified** | Source enforcement AND test coverage exist | Invariant enforced in source code with at least one passing test verifying enforcement |
| **Implemented** | Source enforcement exists, no dedicated test | Code enforces the invariant but no test exercises the enforcement path |
| **Measured** | Runtime measurement confirms the property | Performance or statistical invariant confirmed via benchmark or measurement harness |
| **Declared** | Test or documentation references exist, no source enforcement | Tests reference the invariant but enforcement is in documentation/design only |
| **Out of Scope** | Not applicable to current build phase | Invariant deferred to a future phase or not yet implemented |

## Summary

Total: 134 invariants across 3 tiers

- **Tier 1 (Core Frozen):** 28 invariants — 27 Verified, 1 Measured (I-14)
- **Tier 2 (Extended):** 33 invariants — 30 Verified, 3 Declared
- **Tier 3 (Subsystem):** 73 invariants across 6 subsystems — 57 Verified, 4 Implemented, 8 Declared, 4 Out of Scope

Gaps (honest declaration):
- 4 subsystem invariants have source enforcement but no dedicated test (Implemented)
- 8 subsystem invariants have test references but no source enforcement (Declared)
- 4 CCP invariants (CCP-I3, CCP-I7, CCP-I8, CCP-I15) not found in codebase — classified Out of Scope pending design source review

---

## Tier 1: Core Frozen Invariants (I-01 — I-28)

These are the constitutional invariants. Frozen zone — modification requires Femi escalation.

| ID | Description | Evidence Class | Enforcement Location | Test Location | CI Check |
|---|---|---|---|---|---|
| I-01 | Single production dependency (better-sqlite3). No SDK deps. | Verified | `src/kernel/database/database_lifecycle.ts:11` | `tests/invariants/i01_single_dependency.test.ts:59` | `ci.yml:45` — Single production dependency check |
| I-02 | User owns data. All data accessible, exportable, deletable. purgeAll() leaves zero traces. | Verified | `src/api/data/data_api.ts:14` | `tests/scaffold/invariants/i02_user_owns_data.test.ts:127` | — |
| I-03 | Atomic audit. Every state mutation and its audit entry committed in same SQLite transaction. | Verified | `src/claims/store/claim_stores.ts:1099` | `tests/invariants/i05_transactional_consistency.test.ts:129` | — |
| I-04 | Provider independence. Engine functions with any single provider available. No feature requires a specific provider. | Verified | `src/substrate/gateway/llm_gateway.ts:10` | `tests/invariants/i04_provider_independence.test.ts:199` | — |
| I-05 | Transactional consistency. Database never in inconsistent state. Every state transition atomic. | Verified | `src/substrate/interfaces/substrate.ts:75` | `tests/invariants/i05_transactional_consistency.test.ts:28` | — |
| I-06 | Audit immutability. Active audit entries are append-only. No modify, no delete. SQLite triggers enforce. | Verified | `src/kernel/database/migrations.ts:52` | `tests/helpers/test_database_smoke.test.ts:87` | — |
| I-07 | Agent isolation. One agent's crash, misbehavior, or compromise cannot corrupt another agent's state. | Verified | `src/learning/store/technique_store.ts:259` | `tests/learning/test_convergence_subsystems.test.ts:405` | — |
| I-08 | Agent identity persistence. Identity persists across engine restarts. Stored, not configured. Version immutable once deployed. | Verified | `src/api/migration/023_agent_persistence.ts:9` | `tests/contract/test_contract_agent_persistence.test.ts:65` | — |
| I-09 | Trust is earned. No agent starts with admin trust. Progression: untrusted -> probationary -> trusted -> admin (human grant only). | Verified | `src/api/agents/trust_progression.ts:37` | `tests/contract/test_contract_trust_progression.test.ts:55` | — |
| I-10 | Quarantine cascade / retirement permanence. Retired techniques are terminal — cannot be modified or reactivated. | Verified | `src/learning/store/technique_store.ts:29` | `tests/learning/test_convergence_subsystems.test.ts:223` | — |
| I-11 | Encryption at rest. AES-256-GCM default. | Verified | `src/kernel/crypto/crypto_engine.ts:12` | `tests/invariants/i11_encryption_at_rest.test.ts:28` | — |
| I-12 | Tool sandboxing. Execution via Node.js worker threads with per-worker memory and CPU caps. | Verified | `src/substrate/interfaces/substrate.ts:160` | `tests/scaffold/syscalls/sc03_propose_task_execution.test.ts:146` | — |
| I-13 | Authorization completeness. Every operation enforces RBAC when active. | Verified | `src/working-memory/stores/wmp_stores.ts:647` | `tests/rbac/rbac_enforcement.test.ts:110` | — |
| I-14 | Predictable latency. Memory retrieval < 50ms. Perception < 5ms. Mutation-audit < 1ms. | Measured | `src/substrate/heartbeat/heartbeat_monitor.ts:10` | `tests/scaffold/invariants/i14_predictable_latency.test.ts:1` | — |
| I-15 | Linear cost scaling. Engine overhead per agent-session scales linearly, not quadratically. | Verified | `src/api/enforcement/cost_tracker.ts:64` | `tests/breaker/sprint5_cost_tracker_attacks.test.ts:65` | — |
| I-16 | Graceful degradation. Subsystem failure = degradation, not crash. No LLM providers = engine status 'degraded'. | Verified | `src/substrate/gateway/llm_gateway.ts:499` | `tests/invariants/i04_provider_independence.test.ts:199` | — |
| I-17 | Governance boundary. Agents never directly mutate system state. Every mutation passes through orchestrator validation. | Verified | `src/api/governance/governed_orchestration.ts:20` | `tests/scaffold/syscalls/sc03_propose_task_execution.test.ts:195` | — |
| I-18 | Mission persistence. A mission survives engine restarts, session closures, and provider outages. | Verified | `src/orchestration/missions/mission_recovery.ts:26` | `tests/invariants/i18_mission_persistence.test.ts:44` | — |
| I-19 | Artifact immutability. Every artifact version is immutable once created. Revisions create new versions. | Verified | `src/reference-agent/artifact_manager.ts:15` | `tests/invariants/i19_artifact_immutability.test.ts:5` | — |
| I-20 | Mission tree boundedness. Max recursion depth, max children per mission, max total missions per tree — all configurable with defaults. | Verified | `src/orchestration/interfaces/orchestration.ts:130` | `tests/scaffold/syscalls/sc08_request_budget.test.ts:147` | — |
| I-21 | Bounded cognitive state. Completed subtrees automatically compacted into summary artifacts and archived. | Verified | `src/orchestration/conversation/conversation_manager.ts:4` | `tests/integration/test_phase3_e2e_recursive_mission.test.ts:1416` | — |
| I-22 | Capability immutability. Capabilities are mission-scoped and set at mission creation. Cannot expand mid-mission. | Verified | `src/substrate/adapters/capability_registry.ts:8` | `tests/contract/test_contract_sc2_propose_task_graph.test.ts:501` | — |
| I-23 | Artifact dependency tracking. Every read_artifact call creates a tracked dependency edge. | Verified | `src/orchestration/interfaces/orchestration.ts:606` | `tests/invariants/i23_artifact_dependency_tracking.test.ts:25` | — |
| I-24 | Goal anchoring. Every mission stores a canonical objective, success criteria, and scope boundaries as immutable goal artifacts. | Verified | `src/orchestration/migration/005_immutability_triggers.ts:10` | `tests/invariants/i24_goal_anchoring.test.ts:27` | — |
| I-25 | Deterministic replay. All non-determinism (LLM outputs, external tool results) is recorded. Any mission can be replayed to identical state. | Verified | `src/substrate/gateway/llm_gateway.ts:238` | `tests/invariants/i25_deterministic_replay.test.ts:26` | — |
| I-26 | Streaming equivalence. Streaming and non-streaming produce identical final results. | Verified | `src/api/chat/chat_pipeline.ts:22` | `tests/api/api_chat.test.ts:20` | — |
| I-27 | Conversation integrity. Conversation history within a session is complete and ordered. | Verified | `src/orchestration/conversation/conversation_manager.ts:3` | `tests/gap/test_gap_008_conversation_isolation.test.ts:25` | — |
| I-28 | Pipeline determinism. Fixed sequence of 9 phases. No middleware injection. No custom phases. No pipeline extension. | Verified | `src/api/interfaces/api.ts:359` | `tests/invariants/i28_pipeline_determinism.test.ts:24` | — |

---

## Tier 2: Extended Invariants (I-29 — I-96)

Extended invariants introduced in v3.3.0 subsystem design sources. Grouped by domain.

### Claims Domain (I-29 — I-31)

| ID | Description | Evidence Class | Enforcement Location | Test Location | CI Check |
|---|---|---|---|---|---|
| I-29 | Claim content immutability. All content fields frozen at creation. | Verified | `src/claims/interfaces/claim_types.ts:79` | `tests/contract/test_contract_ccp.test.ts:257` | — |
| I-30 | Evidence reference integrity. Evidence sources must exist and be resolvable. | Verified | `src/claims/store/claim_stores.ts:954` | `tests/contract/test_contract_ccp.test.ts:250` | — |
| I-31 | Relationship validation. Self-references prohibited. Source and target claims must exist and be active. | Verified | `src/claims/store/claim_stores.ts:1311` | `tests/contract/test_contract_ccp.test.ts:250` | — |

### Working Memory Domain (I-41 — I-49)

These map to WMP-I1 through WMP-I8 plus I-48/I-49 trace semantics.

| ID | Description | Evidence Class | Enforcement Location | Test Location | CI Check |
|---|---|---|---|---|---|
| I-41 | Task-local scope. No cross-task access to working memory. | Verified | `src/working-memory/stores/wmp_stores.ts:647` | `tests/contract/test_contract_wmp.test.ts:1` | — |
| I-42 | Terminal inaccessibility. Working memory discarded on task terminal state. | Verified | `src/working-memory/stores/wmp_stores.ts:6` | `tests/contract/test_contract_wmp.test.ts:1` | — |
| I-43 | Free revisability. No per-mutation audit for working memory — the only I-03 exception. | Verified | `src/working-memory/stores/wmp_stores.ts:6` | `tests/contract/test_contract_wmp.test.ts:1` | — |
| I-44 | Storage/admission separation. Context eviction does not equal lifecycle demotion. | Verified | `src/working-memory/interfaces/wmp_types.ts:24` | `tests/contract/test_contract_wmp.test.ts:1` | — |
| I-45 | Deterministic mutation order. Monotonic task-local counter for ordering. | Verified | `src/working-memory/interfaces/wmp_types.ts:132` | `tests/contract/test_contract_wmp.test.ts:1` | — |
| I-46 | Key validation for working memory writes. | Verified | `src/working-memory/stores/wmp_stores.ts:650` | `tests/contract/test_contract_wmp.test.ts:1` | — |
| I-48 | Trace fault isolation. Trace emission failures are non-fatal — WMP operation still succeeds. | Verified | `src/working-memory/stores/wmp_stores.ts:498` | `tests/contract/test_contract_wmp.test.ts:1` | — |
| I-49 | CR-5 enforcement. Reasoning content integrity for OpenAI-compatible providers. | Verified | `src/substrate/transport/adapters/openai_compat.ts:292` | `tests/contract/test_phase5_sprint5b.test.ts:5` | — |

### Context Governance Domain (I-52 — I-55, I-59, I-61, I-63)

| ID | Description | Evidence Class | Enforcement Location | Test Location | CI Check |
|---|---|---|---|---|---|
| I-52 | ECB (effective context budget) computed fresh per invocation. No state carried between calls. | Verified | `src/context/stores/cgp_stores.ts:1107` | `tests/contract/test_integration_cgp_dba.test.ts:10` | — |
| I-53 | ECB formula: min(window - overhead, ceiling ?? infinity), clamped to 0. | Verified | `src/context/stores/cgp_stores.ts:1122` | `tests/contract/test_integration_cgp_dba.test.ts:10` | — |
| I-54 | System overhead boundary. Pipeline infrastructure + active technique cost. | Verified | `src/context/interfaces/cgp_types.ts:824` | `tests/contract/test_integration_tgp_pipeline.test.ts:12` | — |
| I-55 | Ceiling hierarchy. Most restrictive of mission/task ceiling wins. | Verified | `src/context/interfaces/cgp_types.ts:828` | `tests/contract/test_integration_cgp_dba.test.ts:10` | — |
| I-59 | CR-5 enforcement for reasoning content (OpenAI-compat). | Verified | `src/substrate/transport/adapters/openai_compat.ts:11` | `tests/contract/test_phase5_sprint5b.test.ts:5` | — |
| I-61 | ECB computation inputs recorded for audit transparency. | Verified | `src/context/interfaces/cgp_types.ts:347` | `tests/contract/test_integration_cgp_dba.test.ts:10` | — |
| I-63 | System overhead breakdown. Component-level cost breakdown for audit payload. | Verified | `src/context/interfaces/cgp_types.ts:826` | `tests/contract/test_integration_tgp_pipeline_wiring.test.ts:389` | — |

### Context Admission Domain (I-68, I-70, I-72 — I-75)

| ID | Description | Evidence Class | Enforcement Location | Test Location | CI Check |
|---|---|---|---|---|---|
| I-68 | Eviction order determinism. Candidates evicted in deterministic order. | Declared | — | `tests/contract/test_integration_cgp_ccp.test.ts:10` | — |
| I-70 | Two admission paths with OR semantics for P4 claims. | Verified | `src/context/harness/cgp_harness.ts:163` | `tests/contract/test_integration_cgp_ccp.test.ts:10` | — |
| I-72 | Token cost determinism. Identical inputs produce identical token costs. | Verified | `src/context/stores/cgp_stores.ts:342` | `tests/contract/test_integration_cgp_ccp.test.ts:629` | — |
| I-73 | Replay record includes P4 details. | Declared | — | `tests/contract/test_integration_cgp_ccp.test.ts:687` | — |
| I-74 | P4 collects independently of P3. Queries core_artifacts directly. | Verified | `src/context/stores/cgp_stores.ts:771` | `tests/contract/test_integration_cgp_ccp.test.ts:11` | — |
| I-75 | Canonical serializer determinism. Identical inputs produce identical canonical text. | Declared | — | `tests/contract/test_integration_cgp_ccp.test.ts:585` | — |

### Execution Governance Domain (I-76, I-78, I-83, I-86, I-87, I-89, I-92)

| ID | Description | Evidence Class | Enforcement Location | Test Location | CI Check |
|---|---|---|---|---|---|
| I-76 | Execution gate. No task execution without active reservation. | Verified | `src/execution/wiring/execution_gate.ts:63` | `tests/contract/test_integration_egp_execution.test.ts:3` | — |
| I-78 | Budget conservation. Sum of child allocations never exceeds parent allocation. | Verified | `src/orchestration/missions/mission_store.ts:220` | `tests/contract/test_integration_egp_execution.test.ts:3` | — |
| I-83 | Terminal release. Reservation released atomically with terminal transition. | Verified | `src/execution/wiring/terminal_release.ts:20` | `tests/contract/test_integration_egp_execution.test.ts:3` | — |
| I-86 | Pre-invocation admissibility. Both budget dimensions checked before LLM invocation. | Verified | `src/execution/wiring/invocation_gate.ts:59` | `tests/contract/test_integration_egp_execution.test.ts:3` | — |
| I-87 | Reservation fairness. Unreserved floor enforced — total reservations cannot exceed configured percentage. | Verified | `src/execution/wiring/floor_enforcer.ts:59` | `tests/contract/test_integration_egp_execution.test.ts:3` | — |
| I-89 | Candidate technique exclusion from injection. | Verified | `src/api/chat/technique_injector.ts:16` | `tests/contract/test_integration_tgp_pipeline.test.ts:170` | — |
| I-92 | Suspended technique exclusion from injection. | Verified | `src/api/chat/technique_injector.ts:16` | `tests/contract/test_integration_tgp_pipeline.test.ts:193` | — |

### Technique / Learning Domain (I-94, I-96)

| ID | Description | Evidence Class | Enforcement Location | Test Location | CI Check |
|---|---|---|---|---|---|
| I-94 | Content immutability. Technique content inserted verbatim. No transformation. | Verified | `src/api/chat/technique_injector.ts:180` | `tests/contract/test_integration_tgp_pipeline.test.ts:12` | — |
| I-96 | Candidate exclusion. Only status='active' techniques participate in injection. Candidates, suspended, retired excluded. | Verified | `src/api/chat/technique_injector.ts:126` | `tests/contract/test_integration_tgp_pipeline.test.ts:12` | — |

---

## Tier 3: Subsystem Invariants

Subsystem-scoped invariants from v3.3.0 design sources. Each subsystem prefix corresponds to a dedicated design source document.

### DBA Invariants (DBA-I1 — DBA-I16)

Deliberation & Context Budget Amendment. 16 constitutional invariants.

| ID | Description | Evidence Class | Enforcement Location | Test Location | CI Check |
|---|---|---|---|---|---|
| DBA-I1 | Token and deliberation dimensions are independent at all tiers. | Verified | `src/budget/impl/dba_impl.ts:28` | `tests/contract/test_contract_dba.test.ts:120` | — |
| DBA-I2 | Prompt/completion provenance. Provider-authoritative accounting basis. | Verified | `src/budget/interfaces/dba_types.ts:149` | `tests/contract/test_contract_dba.test.ts:232` | — |
| DBA-I3 | Estimator determinism. Same inputs + same version = same charge. Must not use wall-clock time. | Verified | `src/budget/impl/dba_impl.ts:278` | `tests/contract/test_contract_dba.test.ts:207` | — |
| DBA-I4 | Accounting mode per-invocation. Per-invocation accounting flexibility. | Verified | `src/budget/impl/dba_impl.ts:14` | `tests/contract/test_contract_dba.test.ts:232` | — |
| DBA-I5 | ECB fresh per invocation. No cross-invocation depletion. | Verified | `src/budget/interfaces/dba_types.ts:635` | `tests/contract/test_integration_cgp_dba.test.ts:10` | — |
| DBA-I6 | Reserved — no code reference found in current build. | Declared | — | — | — |
| DBA-I7 | Frozen terminology. contextPolicy = governing configuration surface. | Implemented | `src/budget/interfaces/dba_types.ts:107` | — | — |
| DBA-I8 | Monotonic inheritance. Child ceiling never exceeds parent ceiling. | Verified | `src/budget/impl/dba_impl.ts:176` | `tests/contract/test_contract_dba.test.ts:120` | — |
| DBA-I9 | Reserved — no code reference found in current build. | Declared | — | — | — |
| DBA-I10 | Joint feasibility. ALL dimensions must pass admissibility check. | Verified | `src/budget/interfaces/dba_types.ts:502` | `tests/contract/test_contract_dba.test.ts:169` | — |
| DBA-I11 | Deliberation dimension as reservable resource in EGP. | Implemented | `src/execution/interfaces/egp_types.ts:198` | — | — |
| DBA-I12 | Most restrictive ceiling wins when merging applicable ceilings. | Verified | `src/budget/impl/dba_impl.ts:196` | `tests/contract/test_contract_dba.test.ts:120` | — |
| DBA-I13 | Remaining is NEVER negative. Overage recorded separately. Clamped to zero. | Verified | `src/budget/interfaces/dba_types.ts:58` | `tests/contract/test_contract_dba.test.ts:249` | — |
| DBA-I14 | ECB result always non-negative. Clamped to 0. | Verified | `src/budget/impl/dba_impl.ts:144` | `tests/contract/test_integration_cgp_dba.test.ts:10` | — |
| DBA-I15 | System overhead must be governed, replay-stable, versioned, deterministic. | Verified | `src/budget/impl/dba_impl.ts:224` | `tests/contract/test_contract_dba.test.ts:120` | — |
| DBA-I16 | Usage recorded when actually incurred at provider boundary, not when reserved. | Verified | `src/budget/interfaces/dba_types.ts:522` | `tests/contract/test_contract_dba.test.ts:120` | — |

### EGP Invariants (EGP-I1 — EGP-I14)

Execution Governance Protocol. 14 constitutional invariants (13 from design source + EGP-I14 derived).

| ID | Description | Evidence Class | Enforcement Location | Test Location | CI Check |
|---|---|---|---|---|---|
| EGP-I1 | Headroom check before invocation authorization. | Verified | `src/execution/interfaces/egp_types.ts:599` | `tests/contract/test_contract_egp.test.ts:275` | — |
| EGP-I2 | No mid-execution rebalancing. Reservation immutable during execution. | Declared | — | `tests/contract/test_contract_egp.test.ts:275` | — |
| EGP-I3 | Atomic terminal transition. Release reservation atomically with state change. | Verified | `src/execution/interfaces/egp_types.ts:620` | `tests/contract/test_contract_egp.test.ts:275` | — |
| EGP-I4 | Dual-dimension budget (token + deliberation). Independent tracking per dimension. | Verified | `src/execution/interfaces/egp_types.ts:128` | `tests/contract/test_contract_egp.test.ts:275` | — |
| EGP-I5 | Scheduler fairness. Fan-in dependency resolution with starvation bounds. | Verified | `src/execution/interfaces/egp_types.ts:470` | `tests/contract/test_contract_egp.test.ts:275` | — |
| EGP-I6 | Branch failure policy. Mission-level failure handling (fail-fast, fail-last, manual). | Verified | `src/execution/interfaces/egp_types.ts:114` | `tests/contract/test_contract_egp.test.ts:275` | — |
| EGP-I7 | Capability mutability classification determines retry safety. | Verified | `src/execution/interfaces/egp_types.ts:121` | `tests/contract/test_contract_egp.test.ts:275` | — |
| EGP-I8 | Reservation persistence across retry attempts via 'retained' status. | Verified | `src/execution/interfaces/egp_types.ts:182` | `tests/contract/test_contract_egp.test.ts:275` | — |
| EGP-I9 | Scheduling determinism. Wave replay records for deterministic replay. | Verified | `src/execution/interfaces/egp_types.ts:336` | `tests/contract/test_contract_egp.test.ts:275` | — |
| EGP-I10 | Conservation check for budget ledger integrity. | Verified | `src/execution/interfaces/egp_types.ts:379` | `tests/contract/test_contract_egp.test.ts:2088` | — |
| EGP-I11 | Reservation enforcement. Per-reservation limit validation. | Verified | `src/execution/interfaces/egp_types.ts:917` | `tests/contract/test_contract_egp.test.ts:275` | — |
| EGP-I12 | Over-budget fault state. Explicit fault handling when budget exceeded. | Verified | `src/execution/interfaces/egp_types.ts:315` | `tests/contract/test_contract_egp.test.ts:275` | — |
| EGP-I13 | Conservation law. sum(consumed) + sum(remaining) + missionDebt = allocated. | Verified | `src/execution/interfaces/egp_types.ts:379` | `tests/contract/test_contract_egp.test.ts:275` | — |
| EGP-I14 | Reservation requirement. No execution without active reservation (execution gate). | Verified | `src/execution/wiring/execution_gate.ts:63` | `tests/contract/test_integration_egp_execution.test.ts:3` | — |

### TGP Invariants (TGP-I1 — TGP-I8)

Technique Governance Protocol. 8 invariants.

| ID | Description | Evidence Class | Enforcement Location | Test Location | CI Check |
|---|---|---|---|---|---|
| TGP-I1 | Technique identity immutability. id, agentId, and prompt fields immutable after creation. | Verified | `src/techniques/interfaces/tgp_types.ts:166` | `tests/contract/test_contract_tgp.test.ts:1` | — |
| TGP-I2 | Valid status transitions. State machine with defined transition rules. | Verified | `src/techniques/interfaces/tgp_types.ts:132` | `tests/contract/test_contract_tgp.test.ts:1` | — |
| TGP-I3 | Promotion gate. Evaluation evidence exists + threshold met + not quarantined. | Verified | `src/techniques/interfaces/tgp_types.ts:328` | `tests/contract/test_contract_tgp.test.ts:1` | — |
| TGP-I4 | Audit sufficiency. Promotion decision must include all evaluations, threshold, rule, evidence, and version identifiers. | Verified | `src/techniques/interfaces/tgp_types.ts:281` | `tests/contract/test_contract_tgp.test.ts:1` | — |
| TGP-I5 | Quarantine cascade. Quarantined source memory suspends active and blocks candidate promotion. | Verified | `src/techniques/store/tgp_stores.ts:704` | `tests/contract/test_contract_tgp.test.ts:1` | — |
| TGP-I6 | Candidate lifecycle bound. Candidates not promoted within retention period are retired. | Verified | `src/techniques/interfaces/tgp_types.ts:353` | `tests/contract/test_contract_tgp.test.ts:1` | — |
| TGP-I7 | Reserved — no distinct enforcement beyond TGP-I2 transitions. | Declared | — | — | — |
| TGP-I8 | Reserved — no distinct enforcement beyond TGP-I5 cascade. | Declared | — | — | — |

### WMP Invariants (WMP-I1 — WMP-I8)

Working Memory Protocol. 8 invariants.

| ID | Description | Evidence Class | Enforcement Location | Test Location | CI Check |
|---|---|---|---|---|---|
| WMP-I1 | Task-local scope. No cross-task access. Agent must match calling task. | Verified | `src/working-memory/interfaces/wmp_types.ts:145` | `tests/contract/test_contract_wmp.test.ts:1` | — |
| WMP-I2 | Terminal inaccessibility. Working memory discarded on COMPLETED/FAILED/CANCELLED. | Verified | `src/working-memory/interfaces/wmp_types.ts:22` | `tests/contract/test_contract_wmp.test.ts:1` | — |
| WMP-I3 | Free revisability. No per-mutation audit. The only I-03 exception in Limen. | Verified | `src/working-memory/interfaces/wmp_types.ts:23` | `tests/contract/test_contract_wmp.test.ts:1` | — |
| WMP-I4 | Storage/admission separation. Context eviction does not equal lifecycle demotion. | Verified | `src/working-memory/interfaces/wmp_types.ts:24` | `tests/contract/test_contract_wmp.test.ts:1` | — |
| WMP-I5 | Deterministic mutation order. Monotonic task-local counter. | Verified | `src/working-memory/interfaces/wmp_types.ts:132` | `tests/contract/test_contract_wmp.test.ts:1` | — |
| WMP-I6 | Mandatory boundary capture. Dual-record structure at governed boundaries. | Verified | `src/working-memory/interfaces/wmp_types.ts:59` | `tests/contract/test_contract_wmp.test.ts:1` | — |
| WMP-I7 | Terminal atomicity. Capture + transition + discard as one atomic operation. | Verified | `src/working-memory/interfaces/wmp_types.ts:630` | `tests/contract/test_contract_wmp.test.ts:1` | — |
| WMP-I8 | Audit referenceability. Boundary snapshots linked to high-stakes transitions. | Verified | `src/working-memory/interfaces/wmp_types.ts:28` | `tests/contract/test_contract_wmp.test.ts:1` | — |

### CGP Invariants (CGP-I1 — CGP-I11)

Context Governance Protocol. 11 invariants.

| ID | Description | Evidence Class | Enforcement Location | Test Location | CI Check |
|---|---|---|---|---|---|
| CGP-I1 | Eviction-ordered admission. Start from all admitted, evict bottom-up. Greedy top-down proven non-conforming. | Verified | `src/context/interfaces/cgp_types.ts:20` | `tests/contract/test_contract_cgp.test.ts:1` | — |
| CGP-I2 | Position 1 never evicted. Control state always admitted. | Verified | `src/context/interfaces/cgp_types.ts:141` | `tests/contract/test_contract_cgp.test.ts:1` | — |
| CGP-I3 | Protection outranks precedence. Governed-required candidates excluded from eviction set. | Verified | `src/context/interfaces/cgp_types.ts:92` | `tests/contract/test_contract_cgp.test.ts:1` | — |
| CGP-I4 | Whole-candidate eviction. No partial eviction. Over-eviction by design. | Verified | `src/context/interfaces/cgp_types.ts:23` | `tests/contract/test_contract_cgp.test.ts:1` | — |
| CGP-I5 | Admitted set immutable for duration of invocation. | Verified | `src/context/interfaces/cgp_types.ts:240` | `tests/contract/test_contract_cgp.test.ts:1` | — |
| CGP-I6 | All six positions recorded in replay. Even positions with zero candidates. | Verified | `src/context/interfaces/cgp_types.ts:286` | `tests/contract/test_contract_cgp.test.ts:1` | — |
| CGP-I7 | Temporal scope for claim filtering. Claims filtered by temporal compatibility. | Verified | `src/context/interfaces/cgp_types.ts:359` | `tests/contract/test_contract_cgp.test.ts:1` | — |
| CGP-I8 | WMP scope filtering. Working memory candidates filtered to task scope. | Declared | — | `tests/contract/test_contract_cgp.test.ts:401` | — |
| CGP-I9 | Eviction is selection. Context eviction does not alter source data. | Declared | — | `tests/contract/test_contract_cgp.test.ts:350` | — |
| CGP-I10 | Per-invocation fresh collection. Candidates collected fresh for each model invocation. | Verified | `src/context/interfaces/cgp_types.ts:204` | `tests/contract/test_contract_cgp.test.ts:1` | — |
| CGP-I11 | Token cost = canonical representation x costing basis. Costing a different form from what is rendered is non-conforming. | Verified | `src/context/interfaces/cgp_types.ts:124` | `tests/contract/test_contract_cgp.test.ts:1` | — |

### CCP Invariants (CCP-I1 — CCP-I16)

Claim Protocol. 16 invariants (12 from design source + 4 derived).

| ID | Description | Evidence Class | Enforcement Location | Test Location | CI Check |
|---|---|---|---|---|---|
| CCP-I1 | Claim immutability. All content fields frozen at creation. Two mutable fields only: epistemicStatus and archived. | Verified | `src/claims/interfaces/claim_types.ts:79` | `tests/contract/test_contract_ccp.test.ts:257` | — |
| CCP-I2 | Epistemic status forward-only transition. One directional state change. | Verified | `src/claims/interfaces/claim_types.ts:110` | `tests/contract/test_contract_ccp.test.ts:250` | — |
| CCP-I3 | Not found in codebase. Design source reference only. | Out of Scope | — | — | — |
| CCP-I4 | Grounding evaluation. CF-05 proof structure for audit sufficiency. | Verified | `src/claims/interfaces/claim_types.ts:372` | `tests/contract/test_contract_ccp.test.ts:250` | — |
| CCP-I5 | Evidence reference integrity. Min 1 for evidence-path mode, min 0 for runtime-witness. FK referencing validated. | Verified | `src/claims/interfaces/claim_types.ts:133` | `tests/contract/test_contract_ccp.test.ts:250` | — |
| CCP-I6 | Relationship integrity. Append-only, trigger-enforced. Directed relationships between claims. | Implemented | `src/claims/store/claim_stores.ts:17` | — | — |
| CCP-I7 | Not found in codebase. Design source reference only. | Out of Scope | — | — | — |
| CCP-I8 | Not found in codebase. Design source reference only. | Out of Scope | — | — | — |
| CCP-I9 | Audit sufficiency. captureId required in assertion audit record. | Verified | `src/claims/interfaces/claim_types.ts:683` | `tests/contract/test_contract_ccp.test.ts:250` | — |
| CCP-I10 | Tombstone identity preservation. Only identity + metadata fields survive tombstoning. Content fields NULLed. | Verified | `src/claims/interfaces/claim_types.ts:119` | `tests/contract/test_contract_ccp.test.ts:250` | — |
| CCP-I11 | Orthogonal archive flag. Forward-only (false -> true). Independent of epistemic status. | Implemented | `src/claims/interfaces/claim_types.ts:112` | — | — |
| CCP-I12 | Cross-tenant isolation for claims. Claims belong to a single tenant. | Verified | `src/claims/store/claim_stores.ts:958` | `tests/contract/test_contract_ccp.test.ts:250` | — |
| CCP-I13 | Derived — claim lifecycle events. System events fired on claim state transitions. | Verified | `src/claims/interfaces/claim_types.ts:943` | `tests/contract/test_contract_ccp_events.test.ts:8` | — |
| CCP-I14 | Derived — claim query determinism. Identical query inputs produce identical results. | Verified | `src/claims/store/claim_stores.ts:17` | `tests/contract/test_contract_ccp.test.ts:250` | — |
| CCP-I15 | Not found in codebase. Design source reference only. | Out of Scope | — | — | — |
| CCP-I16 | Derived — reserved namespace validation. Claim types/namespaces validated against reserved set. | Declared | — | `tests/contract/test_contract_ccp.test.ts:2747` | — |

---

## Known Gaps Register

The following invariants have evidence class below **Verified**. Each represents an honest declaration of current coverage state.

### Implemented (source enforcement, no dedicated test)

| ID | Gap Description | Remediation |
|---|---|---|
| DBA-I7 | Frozen terminology definition — type-level enforcement only | Add conformance test verifying contextPolicy naming convention |
| DBA-I11 | Deliberation dimension referenced in EGP types — structural coupling | Add integration test verifying DBA-EGP dimension binding |
| CCP-I6 | Relationship append-only enforcement via trigger | Add contract test for trigger rejection of relationship modification |
| CCP-I11 | Archive flag forward-only enforcement via migration trigger | Add contract test for trigger rejection of archive flag reversal |

### Declared (test reference only, no source enforcement)

| ID | Gap Description | Remediation |
|---|---|---|
| DBA-I6 | No code reference found — may be documentation-only invariant | Investigate if merged into another DBA invariant |
| DBA-I9 | No code reference found — may be documentation-only invariant | Investigate if merged into another DBA invariant |
| EGP-I2 | No mid-execution rebalancing — structural property, not code-enforced | Add mutation test to verify reservation immutability during execution |
| CGP-I8 | WMP scope filtering — test exists but no source enforcement marker | Add enforcement marker in CGP stores |
| CGP-I9 | Eviction is selection — test exists but no source enforcement marker | Add enforcement marker in CGP stores |
| CCP-I16 | Reserved namespace validation — test exists, implementation may be in migration | Verify migration trigger exists |
| I-68 | Eviction order determinism — test reference only | Add enforcement marker in CGP eviction algorithm |
| I-73 | Replay record P4 details — test reference only | Add enforcement marker in CGP replay record builder |
| I-75 | Canonical serializer determinism — test reference only | Add enforcement marker in CGP canonical serializer |
| TGP-I7 | No distinct enforcement — may overlap with TGP-I2 | Investigate if subsumed by TGP-I2 |
| TGP-I8 | No distinct enforcement — may overlap with TGP-I5 | Investigate if subsumed by TGP-I5 |

### Out of Scope (not found in codebase)

| ID | Gap Description | Remediation |
|---|---|---|
| CCP-I3 | Not found in codebase — may exist in design source only | Review CCP v2.0 Design Source for implementation status |
| CCP-I7 | Not found in codebase — may exist in design source only | Review CCP v2.0 Design Source for implementation status |
| CCP-I8 | Not found in codebase — may exist in design source only | Review CCP v2.0 Design Source for implementation status |
| CCP-I15 | Not found in codebase — may exist in design source only | Review CCP v2.0 Design Source for implementation status |

---

## CI Enforcement Summary

| CI Step | Invariants Enforced | Location |
|---|---|---|
| Single production dependency | I-01 | `.github/workflows/ci.yml:45` |
| No decorative assertions (HB#8) | All — structural | `.github/workflows/ci.yml:58` |
| No @ts-ignore | All — structural | `.github/workflows/ci.yml:29` |
| No uncontrolled any | All — structural | `.github/workflows/ci.yml:36` |
| Migration forward-only | I-06 (schema integrity) | `.github/workflows/ci.yml:89` |
| Full test suite | All with tests | `.github/workflows/ci.yml:66` |
| Typecheck | All — structural | `.github/workflows/ci.yml:23` |

---

## Cross-Reference: Invariant-to-Subsystem Mapping

| Core Invariant | Subsystem Invariants That Derive From It |
|---|---|
| I-01 | — (standalone, CI-enforced) |
| I-03 | WMP-I3 (exception), CGP-I6 (replay), CCP-I9 (audit sufficiency) |
| I-05 | DBA-I13 (never negative), EGP-I3 (atomic terminal), WMP-I7 (terminal atomicity) |
| I-06 | CCP-I6 (append-only relationships), CCP-I11 (forward-only archive) |
| I-07 | WMP-I1 (task-local scope), CGP-I8 (WMP scope filtering) |
| I-10 | TGP-I5 (quarantine cascade), TGP-I6 (candidate lifecycle) |
| I-17 | EGP-I14 (execution gate), I-76 (execution reservation requirement) |
| I-20 | I-78 (budget conservation), I-87 (reservation fairness) |
| I-25 | EGP-I9 (wave replay), CGP-I6 (position recording), I-73 (P4 replay) |
| I-28 | I-54 (overhead boundary), I-63 (overhead breakdown), I-96 (technique injection) |
