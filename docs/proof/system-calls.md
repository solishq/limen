# System Calls — Evidence Index

> This document is CI-governed. Every file:line reference is verified by `scripts/verify-proof-pack.ts`.
> Stale references fail the build.

## Evidence Classes

| Class | Definition |
|---|---|
| **Verified** | Interface defined, implementation complete, scaffold/contract tests present, A21 dual-path coverage (success + rejection). Full evidence chain. |
| **Implemented** | Interface defined, implementation complete, but test coverage is partial or missing a path. |
| **Measured** | Performance or statistical property verified via benchmark or metric collection. |
| **Declared** | Claimed in documentation or spec but not yet code-verified. |
| **Out of Scope** | Explicitly excluded from current verification scope with documented rationale. |

## Summary

| SC | Name | Evidence Class |
|---|---|---|
| SC-1 | propose_mission | Verified |
| SC-2 | propose_task_graph | Verified |
| SC-3 | propose_task_execution | Verified |
| SC-4 | create_artifact | Verified |
| SC-5 | read_artifact | Verified |
| SC-6 | emit_event | Verified |
| SC-7 | request_capability | Verified |
| SC-8 | request_budget | Verified |
| SC-9 | submit_result | Verified |
| SC-10 | respond_checkpoint | Verified |
| SC-11 | assert_claim | Verified |
| SC-12 | relate_claims | Verified |
| SC-13 | query_claims | Verified |
| SC-14 | write_working_memory | Verified |
| SC-15 | read_working_memory | Verified |
| SC-16 | discard_working_memory | Verified |

---

## SC-1: propose_mission

Creates a new mission (root or child) with budget allocation, capability validation, depth/tree constraints, and delegation cycle detection.

| Field | Source |
|---|---|
| **SC ID** | SC-1 |
| **Name** | `proposeMission` |
| **Purpose** | Creates a new mission with validated constraints, budget allocation, and governance side effects (S15). |
| **Interface** | `src/orchestration/interfaces/orchestration.ts:694` |
| **Input Types** | `src/orchestration/interfaces/orchestration.ts:237` (ProposeMissionInput) |
| **Error Type** | `src/orchestration/interfaces/orchestration.ts:265` (ProposeMissionError) |
| **Implementation** | `src/orchestration/syscalls/propose_mission.ts:15` |
| **Error Codes** | `BUDGET_EXCEEDED`, `DEPTH_EXCEEDED`, `CHILDREN_EXCEEDED`, `TREE_SIZE_EXCEEDED`, `CAPABILITY_VIOLATION`, `AGENT_NOT_FOUND`, `UNAUTHORIZED`, `DEADLINE_EXCEEDED`, `DELEGATION_CYCLE` |
| **Scaffold Test** | `tests/scaffold/syscalls/sc01_propose_mission.test.ts` |
| **Contract Test** | `tests/contract/test_contract_sc1_propose_mission.test.ts` |
| **A21 Coverage** | Success: mission creation with valid input, audit + event side effects. Rejection: budget exceeded, depth exceeded, children exceeded, tree size exceeded, capability violation, agent not found, deadline exceeded (all with state-unchanged verification). |
| **Evidence Class** | Verified |

---

## SC-2: propose_task_graph

Validates and installs a DAG of tasks for a mission using Kahn's algorithm for cycle detection.

| Field | Source |
|---|---|
| **SC ID** | SC-2 |
| **Name** | `proposeTaskGraph` |
| **Purpose** | Validates a task dependency graph (DAG) and installs it as the active plan for a mission (S16). |
| **Interface** | `src/orchestration/interfaces/orchestration.ts:695` |
| **Input Types** | `src/orchestration/interfaces/orchestration.ts:296` (ProposeTaskGraphInput) |
| **Error Type** | `src/orchestration/interfaces/orchestration.ts:319` (ProposeTaskGraphError) |
| **Implementation** | `src/orchestration/syscalls/propose_task_graph.ts:14` |
| **Error Codes** | `CYCLE_DETECTED`, `BUDGET_EXCEEDED`, `TASK_LIMIT_EXCEEDED`, `INVALID_DEPENDENCY`, `CAPABILITY_VIOLATION`, `MISSION_NOT_ACTIVE`, `PLAN_REVISION_LIMIT`, `UNAUTHORIZED` |
| **Scaffold Test** | `tests/scaffold/syscalls/sc02_propose_task_graph.test.ts` |
| **Contract Test** | `tests/contract/test_contract_sc2_propose_task_graph.test.ts` |
| **A21 Coverage** | Success: valid DAG installation with plan version increment. Rejection: cycle detection, budget overflow, task limit, invalid dependency, mission not active, plan revision limit (all with state-unchanged verification). |
| **Evidence Class** | Verified |

---

## SC-3: propose_task_execution

Requests execution of a specific task after validating dependencies, budget, and capabilities.

| Field | Source |
|---|---|
| **SC ID** | SC-3 |
| **Name** | `proposeTaskExecution` |
| **Purpose** | Validates task readiness (dependencies met, budget available, capabilities allowed) and schedules execution via substrate (S17). |
| **Interface** | `src/orchestration/interfaces/orchestration.ts:696` |
| **Input Types** | `src/orchestration/interfaces/orchestration.ts:335` (ProposeTaskExecutionInput) |
| **Error Type** | `src/orchestration/interfaces/orchestration.ts:352` (ProposeTaskExecutionError) |
| **Implementation** | `src/orchestration/syscalls/propose_task_execution.ts:19` |
| **Error Codes** | `DEPENDENCIES_UNMET`, `BUDGET_EXCEEDED`, `CAPABILITY_DENIED`, `WORKER_UNAVAILABLE`, `TASK_NOT_PENDING` |
| **Scaffold Test** | `tests/scaffold/syscalls/sc03_propose_task_execution.test.ts` |
| **Contract Test** | `tests/contract/test_contract_sc3_propose_task_execution.test.ts` |
| **A21 Coverage** | Success: task transitions PENDING to SCHEDULED, worker enqueued. Rejection: task not pending, dependencies unmet, capability denied, budget exceeded, worker unavailable (all with specific error codes). |
| **Evidence Class** | Verified |

---

## SC-4: create_artifact

Creates an immutable artifact version with content storage and audit trail.

| Field | Source |
|---|---|
| **SC ID** | SC-4 |
| **Name** | `createArtifact` |
| **Purpose** | Creates an immutable artifact version within a mission scope, with I-19 immutability guarantees (S18). |
| **Interface** | `src/orchestration/interfaces/orchestration.ts:697` |
| **Input Types** | `src/orchestration/interfaces/orchestration.ts:364` (CreateArtifactInput) |
| **Error Type** | `src/orchestration/interfaces/orchestration.ts:382` (CreateArtifactError) |
| **Implementation** | `src/orchestration/syscalls/create_artifact.ts:14` |
| **Error Codes** | `MISSION_NOT_ACTIVE`, `STORAGE_EXCEEDED`, `ARTIFACT_LIMIT_EXCEEDED`, `UNAUTHORIZED` |
| **Scaffold Test** | `tests/scaffold/syscalls/sc04_create_artifact.test.ts` |
| **Contract Test** | `tests/contract/test_contract_sc4_create_artifact.test.ts` |
| **A21 Coverage** | Success: artifact created with version 1, ARTIFACT_CREATED event emitted. Rejection: mission not active, storage exceeded, artifact limit exceeded, unauthorized (all with specific error codes). |
| **Evidence Class** | Verified |

---

## SC-5: read_artifact

Reads an artifact with dependency tracking and relevance decay reset.

| Field | Source |
|---|---|
| **SC ID** | SC-5 |
| **Name** | `readArtifact` |
| **Purpose** | Reads an artifact by ID/version with I-23 dependency tracking and relevanceDecay reset (S19). |
| **Interface** | `src/orchestration/interfaces/orchestration.ts:698` |
| **Input Types** | `src/orchestration/interfaces/orchestration.ts:393` (ReadArtifactInput) |
| **Error Type** | `src/orchestration/interfaces/orchestration.ts:414` (ReadArtifactError) |
| **Implementation** | `src/orchestration/syscalls/read_artifact.ts:15` |
| **Error Codes** | `NOT_FOUND`, `UNAUTHORIZED`, `ARCHIVED` |
| **Scaffold Test** | `tests/scaffold/syscalls/sc05_read_artifact.test.ts` |
| **Contract Test** | `tests/contract/test_contract_sc5_read_artifact.test.ts` |
| **A21 Coverage** | Success: artifact read with dependency edge created, relevanceDecay reset, ARTIFACT_READ event. Rejection: artifact not found, unauthorized, archived artifact access (all with specific error codes). |
| **Evidence Class** | Verified |

---

## SC-6: emit_event

Agent emits a custom event with propagation direction and rate limiting.

| Field | Source |
|---|---|
| **SC ID** | SC-6 |
| **Name** | `emitEvent` |
| **Purpose** | Allows agents to emit custom events with configured propagation direction; lifecycle events are orchestrator-only (S20). |
| **Interface** | `src/orchestration/interfaces/orchestration.ts:699` |
| **Input Types** | `src/orchestration/interfaces/orchestration.ts:424` (EmitEventInput) |
| **Error Type** | `src/orchestration/interfaces/orchestration.ts:438` (EmitEventError) |
| **Implementation** | `src/orchestration/syscalls/emit_event.ts:14` |
| **Error Codes** | `RATE_LIMITED`, `INVALID_TYPE`, `INVALID_INPUT`, `MISSION_NOT_FOUND` |
| **Scaffold Test** | `tests/scaffold/syscalls/sc06_emit_event.test.ts` |
| **Contract Test** | `tests/contract/test_contract_sc6_emit_event.test.ts` |
| **A21 Coverage** | Success: event emitted with propagation. Rejection: rate limited, invalid (reserved) event type, invalid input (payload size), mission not found (all with specific error codes). |
| **Evidence Class** | Verified |

---

## SC-7: request_capability

Executes a capability in sandbox with budget enforcement and resource accounting.

| Field | Source |
|---|---|
| **SC ID** | SC-7 |
| **Name** | `requestCapability` |
| **Purpose** | Validates capability is in mission set, checks budget, executes via substrate adapter in sandbox, consumes resources (S21). |
| **Interface** | `src/orchestration/interfaces/orchestration.ts:700` |
| **Input Types** | `src/orchestration/interfaces/orchestration.ts:449` (RequestCapabilityInput) |
| **Error Type** | `src/orchestration/interfaces/orchestration.ts:468` (RequestCapabilityError) |
| **Implementation** | `src/orchestration/syscalls/request_capability.ts:20` |
| **Error Codes** | `CAPABILITY_DENIED`, `BUDGET_EXCEEDED`, `TIMEOUT`, `SANDBOX_VIOLATION`, `RATE_LIMITED` |
| **Scaffold Test** | `tests/scaffold/syscalls/sc07_request_capability.test.ts` |
| **Contract Test** | `tests/contract/test_contract_sc7_request_capability.test.ts` |
| **A21 Coverage** | Success: capability executed, resources consumed, result returned. Rejection: capability denied (not in set), budget exceeded, sandbox violation, timeout, NaN/Infinity guard on resources (all with specific error codes). |
| **Evidence Class** | Verified |

---

## SC-8: request_budget

Agent requests additional mission resources from parent or human.

| Field | Source |
|---|---|
| **SC ID** | SC-8 |
| **Name** | `requestBudget` |
| **Purpose** | Requests additional budget from parent mission or human; may transition mission to BLOCKED if human approval required (S22). |
| **Interface** | `src/orchestration/interfaces/orchestration.ts:701` |
| **Input Types** | `src/orchestration/interfaces/orchestration.ts:480` (RequestBudgetInput) |
| **Error Type** | `src/orchestration/interfaces/orchestration.ts:504` (RequestBudgetError) |
| **Implementation** | `src/orchestration/syscalls/request_budget.ts:19` |
| **Error Codes** | `PARENT_INSUFFICIENT`, `HUMAN_APPROVAL_REQUIRED`, `MISSION_NOT_ACTIVE`, `JUSTIFICATION_REQUIRED`, `INVALID_INPUT` |
| **Scaffold Test** | `tests/scaffold/syscalls/sc08_request_budget.test.ts` |
| **Contract Test** | `tests/contract/test_contract_sc8_request_budget.test.ts` |
| **A21 Coverage** | Success: budget allocated from parent, BUDGET_REQUESTED event. Rejection: justification required, justification size exceeded, invalid input (NaN/zero/negative), parent insufficient, human approval required (all with specific error codes). |
| **Evidence Class** | Verified |

---

## SC-9: submit_result

Completes a mission with result, triggers compaction and resource finalization.

| Field | Source |
|---|---|
| **SC ID** | SC-9 |
| **Name** | `submitResult` |
| **Purpose** | Completes a mission: creates immutable MissionResult, transitions REVIEWING to COMPLETED, triggers I-21 eager compaction, emits MISSION_COMPLETED event (S23). |
| **Interface** | `src/orchestration/interfaces/orchestration.ts:702` |
| **Input Types** | `src/orchestration/interfaces/orchestration.ts:516` (SubmitResultInput) |
| **Error Type** | `src/orchestration/interfaces/orchestration.ts:532` (SubmitResultError) |
| **Implementation** | `src/orchestration/syscalls/submit_result.ts:21` |
| **Error Codes** | `TASKS_INCOMPLETE`, `NO_ARTIFACTS`, `MISSION_NOT_ACTIVE`, `UNAUTHORIZED`, `INVALID_INPUT` |
| **Scaffold Test** | `tests/scaffold/syscalls/sc09_submit_result.test.ts` |
| **Contract Test** | `tests/contract/test_contract_sc9_submit_result.test.ts` |
| **A21 Coverage** | Success: mission completed with result, compaction triggered, event emitted. Rejection: mission not in REVIEWING state, tasks incomplete, no artifacts, invalid confidence (NaN/out-of-range), taskless mission (all with specific error codes). |
| **Evidence Class** | Verified |

---

## SC-10: respond_checkpoint

Agent responds to a system-initiated checkpoint with assessment and proposed action.

| Field | Source |
|---|---|
| **SC ID** | SC-10 |
| **Name** | `respondCheckpoint` |
| **Purpose** | Processes agent response to a system-initiated checkpoint; evaluates proposed action against confidence bands (S24). |
| **Interface** | `src/orchestration/interfaces/orchestration.ts:703` |
| **Input Types** | `src/orchestration/interfaces/orchestration.ts:544` (RespondCheckpointInput) |
| **Error Type** | `src/orchestration/interfaces/orchestration.ts:560` (RespondCheckpointError) |
| **Implementation** | `src/orchestration/syscalls/respond_checkpoint.ts:16` |
| **Error Codes** | `CHECKPOINT_EXPIRED`, `INVALID_PLAN` |
| **Scaffold Test** | `tests/scaffold/syscalls/sc10_respond_checkpoint.test.ts` |
| **Contract Test** | `tests/contract/test_contract_sc10_respond_checkpoint.test.ts` |
| **A21 Coverage** | Success: checkpoint response processed, decision returned (continue/replan/escalate/abort). Rejection: checkpoint expired (not found, already processed, after timeout), invalid plan revision (all with specific error codes). |
| **Evidence Class** | Verified |

---

## SC-11: assert_claim

Creates a claim with validated fields, evidence chain, and grounding verification.

| Field | Source |
|---|---|
| **SC ID** | SC-11 |
| **Name** | `assertClaim` |
| **Purpose** | Creates a claim with full field validation, polymorphic FK evidence resolution, CF-05 grounding verification, and atomic audit (CCP S10.1). |
| **Interface** | `src/claims/interfaces/claim_types.ts:546` (AssertClaimHandler) |
| **Input Types** | `src/claims/interfaces/claim_types.ts:211` (ClaimCreateInput) |
| **Error Constants** | `src/claims/interfaces/claim_types.ts:807` (SC11_ERROR_CODES) |
| **Implementation** | `src/claims/store/claim_stores.ts:822` (createAssertClaimHandlerImpl) |
| **Error Codes** | `INVALID_SUBJECT`, `INVALID_PREDICATE`, `INVALID_OBJECT_TYPE`, `CONFIDENCE_OUT_OF_RANGE`, `INVALID_VALID_AT`, `NO_EVIDENCE`, `EVIDENCE_LIMIT_EXCEEDED`, `EVIDENCE_NOT_FOUND`, `EVIDENCE_CROSS_TENANT`, `CLAIM_LIMIT_EXCEEDED`, `MISSION_NOT_ACTIVE`, `UNAUTHORIZED`, `RATE_LIMITED`, `GROUNDING_DEPTH_EXCEEDED`, `RUNTIME_WITNESS_MISSING`, `RUNTIME_WITNESS_INVALID`, `GROUNDING_MODE_MISSING`, `EVIDENCE_TYPE_MISMATCH`, `GROUNDING_RETRACTED_INTERMEDIATE`, `EVIDENCE_SCOPE_VIOLATION`, `IDEMPOTENT_DUPLICATE` |
| **Scaffold Test** | None (CCP subsystem uses contract tests as primary verification) |
| **Contract Test** | `tests/contract/test_contract_ccp.test.ts` (Groups 1-4: field validation, boundary, grounding, retraction) |
| **A21 Coverage** | Success: claim created with evidence chain and grounding result (tests #9-#12). Rejection: invalid subject (#1), empty evidence (#2), reserved predicate (#5), confidence out of range (#6), invalid validAt (#7), evidence not found (#13), cross-tenant evidence (#14), type mismatch (#15), mission limit (#17), evidence limit (#18), mission not active (#20), unauthorized (#21), rate limited (#104c). |
| **Evidence Class** | Verified |

---

## SC-12: relate_claims

Creates a directed relationship between two claims.

| Field | Source |
|---|---|
| **SC ID** | SC-12 |
| **Name** | `relateClaims` |
| **Purpose** | Creates a directed, append-only relationship (supports/contradicts/supersedes/derived_from) between two claims within the same tenant (CCP S10.2). |
| **Interface** | `src/claims/interfaces/claim_types.ts:563` (RelateClaimsHandler) |
| **Input Types** | `src/claims/interfaces/claim_types.ts:250` (RelationshipCreateInput) |
| **Error Constants** | `src/claims/interfaces/claim_types.ts:871` (SC12_ERROR_CODES) |
| **Implementation** | `src/claims/store/claim_stores.ts:1289` (createRelateClaimsHandlerImpl) |
| **Error Codes** | `CLAIM_NOT_FOUND`, `CROSS_TENANT`, `INVALID_RELATIONSHIP_TYPE`, `SELF_REFERENCE`, `CLAIM_NOT_ACTIVE`, `RELATIONSHIP_LIMIT_EXCEEDED`, `MISSION_NOT_ACTIVE`, `UNAUTHORIZED`, `RATE_LIMITED` |
| **Scaffold Test** | None (CCP subsystem uses contract tests as primary verification) |
| **Contract Test** | `tests/contract/test_contract_ccp.test.ts` (Group 6: Relationships) |
| **A21 Coverage** | Success: relationship created between active claims (#60). Rejection: from retracted claim (#62), self-reference (#64), cross-tenant (#65), claim not found (#66), invalid type (#67), append-only enforcement (#69, #70), mission not active (#74), unauthorized (#75). |
| **Evidence Class** | Verified |

---

## SC-13: query_claims

Queries claims with filters, pagination, and computed properties.

| Field | Source |
|---|---|
| **SC ID** | SC-13 |
| **Name** | `queryClaims` |
| **Purpose** | Queries claims with subject/predicate/status/confidence/agent/mission/temporal filters, pagination, and computed properties (superseded, disputed) (CCP S10.3). |
| **Interface** | `src/claims/interfaces/claim_types.ts:571` (QueryClaimsHandler) |
| **Input Types** | `src/claims/interfaces/claim_types.ts:266` (ClaimQueryInput) |
| **Error Constants** | `src/claims/interfaces/claim_types.ts:895` (SC13_ERROR_CODES) |
| **Implementation** | `src/claims/store/claim_stores.ts:1425` (createQueryClaimsHandlerImpl) |
| **Error Codes** | `NO_FILTERS`, `INVALID_SUBJECT_FILTER`, `INVALID_PREDICATE_FILTER`, `LIMIT_EXCEEDED`, `MISSION_NOT_ACTIVE`, `UNAUTHORIZED`, `RATE_LIMITED` |
| **Scaffold Test** | None (CCP subsystem uses contract tests as primary verification) |
| **Contract Test** | `tests/contract/test_contract_ccp.test.ts` (Group 7: Queries) |
| **A21 Coverage** | Success: query returns matching claims with computed properties, pagination. Rejection: all-null filters (#99), malformed subject filter (#100), malformed predicate filter (#101), non-trailing wildcard (#102), limit exceeded (#103), mission not active (#104a), unauthorized (#104b). |
| **Evidence Class** | Verified |

---

## SC-14: write_working_memory

Creates or replaces an entry in the task-local working memory namespace.

| Field | Source |
|---|---|
| **SC ID** | SC-14 |
| **Name** | `writeWorkingMemory` |
| **Purpose** | Creates or replaces a WMP entry with key/value validation, capacity enforcement, and monotonic mutation ordering (WMP S5.2). |
| **Interface** | `src/working-memory/interfaces/wmp_types.ts:688` (WriteWorkingMemoryHandler) |
| **Input Types** | `src/working-memory/interfaces/wmp_types.ts:144` (WriteWorkingMemoryInput) |
| **Error Constants** | `src/working-memory/interfaces/wmp_types.ts:390` (SC14_ERROR_CODES) |
| **Implementation** | `src/working-memory/stores/wmp_stores.ts:608` (createWriteHandler) |
| **Error Codes** | `TASK_NOT_FOUND`, `TASK_TERMINATED`, `TASK_NOT_EXECUTABLE`, `TASK_SCOPE_VIOLATION`, `WORKING_MEMORY_KEY_INVALID`, `WORKING_MEMORY_VALUE_INVALID`, `WORKING_MEMORY_CAPACITY_EXCEEDED`, `UNAUTHORIZED` |
| **Scaffold Test** | None (WMP subsystem uses contract tests as primary verification) |
| **Contract Test** | `tests/contract/test_contract_wmp.test.ts` (SC-14 Error Codes section, lines 775-853) |
| **A21 Coverage** | Success: entry created/replaced with mutationPosition (CT-WMP-04). Rejection: task not found (ERR-01), task terminated (ERR-02), task not executable (ERR-03), scope violation (ERR-04), key invalid empty (ERR-05), key reserved prefix (ERR-06), capacity exceeded (ERR-07), value invalid null bytes (ERR-08). |
| **Evidence Class** | Verified |

---

## SC-15: read_working_memory

Reads one entry by key or lists all entries from the task-local namespace.

| Field | Source |
|---|---|
| **SC ID** | SC-15 |
| **Name** | `readWorkingMemory` |
| **Purpose** | Side-effect-free read of WMP entries; single key lookup or full namespace listing. Returns only live state, never boundary capture data (WMP S5.3). |
| **Interface** | `src/working-memory/interfaces/wmp_types.ts:702` (ReadWorkingMemoryHandler) |
| **Input Types** | `src/working-memory/interfaces/wmp_types.ts:183` (ReadWorkingMemoryInput) |
| **Error Constants** | `src/working-memory/interfaces/wmp_types.ts:412` (SC15_ERROR_CODES) |
| **Implementation** | `src/working-memory/stores/wmp_stores.ts:755` (createReadHandler) |
| **Error Codes** | `TASK_NOT_FOUND`, `TASK_TERMINATED`, `TASK_SCOPE_VIOLATION`, `WORKING_MEMORY_NOT_FOUND`, `UNAUTHORIZED` |
| **Scaffold Test** | None (WMP subsystem uses contract tests as primary verification) |
| **Contract Test** | `tests/contract/test_contract_wmp.test.ts` (SC-15 Error Codes section, lines 856-901) |
| **A21 Coverage** | Success: entry read returns value/metadata, list returns all entries with totals (CT-WMP-04, CT-WMP-09). Rejection: task not found (ERR-01), task terminated (ERR-02), scope violation (ERR-03), key not found (ERR-04), unauthorized (ERR-05). |
| **Evidence Class** | Verified |

---

## SC-16: discard_working_memory

Removes one entry by key or all entries from the task-local namespace.

| Field | Source |
|---|---|
| **SC ID** | SC-16 |
| **Name** | `discardWorkingMemory` |
| **Purpose** | Semantic discard of WMP entries; single key removal or full namespace clear. Monotonic mutation counter advances on success (WMP S5.4). |
| **Interface** | `src/working-memory/interfaces/wmp_types.ts:717` (DiscardWorkingMemoryHandler) |
| **Input Types** | `src/working-memory/interfaces/wmp_types.ts:225` (DiscardWorkingMemoryInput) |
| **Error Constants** | `src/working-memory/interfaces/wmp_types.ts:428` (SC16_ERROR_CODES) |
| **Implementation** | `src/working-memory/stores/wmp_stores.ts:825` (createDiscardHandler) |
| **Error Codes** | `TASK_NOT_FOUND`, `TASK_TERMINATED`, `TASK_NOT_EXECUTABLE`, `TASK_SCOPE_VIOLATION`, `WORKING_MEMORY_NOT_FOUND`, `UNAUTHORIZED` |
| **Scaffold Test** | None (WMP subsystem uses contract tests as primary verification) |
| **Contract Test** | `tests/contract/test_contract_wmp.test.ts` (SC-16 Error Codes section, lines 903-960) |
| **A21 Coverage** | Success: entry discarded with freed bytes and mutationPosition (CT-WMP-04), discard-all clears namespace. Rejection: task not found (ERR-01), task terminated (ERR-02), task not executable (ERR-03), scope violation (ERR-04), key not found (ERR-05), unauthorized (ERR-06). |
| **Evidence Class** | Verified |

---

## Cross-Reference: Test File Index

| Test File | System Calls Covered |
|---|---|
| `tests/scaffold/syscalls/sc01_propose_mission.test.ts` | SC-1 |
| `tests/scaffold/syscalls/sc02_propose_task_graph.test.ts` | SC-2 |
| `tests/scaffold/syscalls/sc03_propose_task_execution.test.ts` | SC-3 |
| `tests/scaffold/syscalls/sc04_create_artifact.test.ts` | SC-4 |
| `tests/scaffold/syscalls/sc05_read_artifact.test.ts` | SC-5 |
| `tests/scaffold/syscalls/sc06_emit_event.test.ts` | SC-6 |
| `tests/scaffold/syscalls/sc07_request_capability.test.ts` | SC-7 |
| `tests/scaffold/syscalls/sc08_request_budget.test.ts` | SC-8 |
| `tests/scaffold/syscalls/sc09_submit_result.test.ts` | SC-9 |
| `tests/scaffold/syscalls/sc10_respond_checkpoint.test.ts` | SC-10 |
| `tests/contract/test_contract_sc1_propose_mission.test.ts` | SC-1 |
| `tests/contract/test_contract_sc2_propose_task_graph.test.ts` | SC-2 |
| `tests/contract/test_contract_sc3_propose_task_execution.test.ts` | SC-3 |
| `tests/contract/test_contract_sc4_create_artifact.test.ts` | SC-4 |
| `tests/contract/test_contract_sc5_read_artifact.test.ts` | SC-5 |
| `tests/contract/test_contract_sc6_emit_event.test.ts` | SC-6 |
| `tests/contract/test_contract_sc7_request_capability.test.ts` | SC-7 |
| `tests/contract/test_contract_sc8_request_budget.test.ts` | SC-8 |
| `tests/contract/test_contract_sc9_submit_result.test.ts` | SC-9 |
| `tests/contract/test_contract_sc10_respond_checkpoint.test.ts` | SC-10 |
| `tests/contract/test_contract_ccp.test.ts` | SC-11, SC-12, SC-13 |
| `tests/contract/test_contract_ccp_governance.test.ts` | SC-11, SC-12, SC-13 (governance aspects) |
| `tests/contract/test_contract_ccp_events.test.ts` | SC-11, SC-12, SC-13 (event emission) |
| `tests/contract/test_contract_wmp.test.ts` | SC-14, SC-15, SC-16 |
| `tests/contract/test_contract_wmp_extensions.test.ts` | SC-14, SC-15, SC-16 (extensions) |

## Architectural Notes

**SC-1 through SC-10** follow the orchestration layer pattern: interface in `src/orchestration/interfaces/orchestration.ts`, thin system call function in `src/orchestration/syscalls/<name>.ts`, delegating to domain stores (MissionStore, TaskGraphEngine, ArtifactStore, BudgetGovernor, EventPropagator, CheckpointCoordinator, CompactionEngine). Each SC file is a pure function receiving `OrchestrationDeps` and the relevant store references.

**SC-11 through SC-13** are part of the Claim Protocol (CCP) subsystem. Interfaces in `src/claims/interfaces/claim_types.ts`, implementation in `src/claims/store/claim_stores.ts`. These are handler objects created via factory functions, not standalone syscall files, because the CCP subsystem has deeper cross-cutting concerns (grounding, evidence validation, lifecycle projection).

**SC-14 through SC-16** are part of the Working Memory Protocol (WMP) subsystem. Interfaces in `src/working-memory/interfaces/wmp_types.ts`, implementation in `src/working-memory/stores/wmp_stores.ts`. Like CCP, these are handler objects created via factory functions, with cross-cutting boundary snapshot semantics.

**SC-11 through SC-16 have no scaffold tests.** These subsystems (CCP, WMP) were implemented after the scaffold pattern was established for SC-1 through SC-10. Their contract tests serve as the primary verification layer, with full A21 dual-path coverage (success + rejection) verified in the contract test files.
