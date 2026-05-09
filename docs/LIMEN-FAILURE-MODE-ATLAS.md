<!-- @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md SS5.1 -->

# Limen v5 -- Failure Mode Atlas

**SolisForge Phase:** 1 (Failure Mode Atlas)
**Version:** 1.1.0
**Date:** 2026-05-09
**Derived From:** 14 requirement extraction files (3,744 requirements), 14 ratified contracts. R1+R2 findings documented in commit history (f4ead70, 23ee54d). Full finding log in local docs/REMEDIATION_MASTER_LOG.md (not committed due to IP content guard).
**Purpose:** Every way the system can fail, explicitly named. Each failure mode maps to a preventing property and a requirement trace.

---

## Legend

| Column | Description |
|---|---|
| FM-ID | Unique failure mode identifier: `FM-{category_code}-{number}` |
| Failure Mode | What goes wrong, stated as an observable failure |
| Category | One of the 13 defect categories |
| How It Fails | The mechanism or sequence that produces the failure |
| Preventing Property | The invariant or design property that makes this failure impossible |
| Requirement Trace | The requirement ID(s) that, when correctly implemented, prevent this failure |

**Category Codes:** GB=Governance Bypass, DI=Data Integrity, SE=Security, CC=Concurrency, TP=Type Parity, SM=State Machine, CO=Compliance, PF=Performance, IN=Integration, OP=Operational, CR=Credential/Secret Management, BQ=Behavioral/Model Quality, ME=Migration/Evolution

---

## 1. Governance Bypass

Ways governance can be circumvented, allowing unauthorized operations to proceed.

| FM-ID | Failure Mode | Category | How It Fails | Preventing Property | Requirement Trace |
|---|---|---|---|---|---|
| FM-GB-01 | Operation executes without OperationContext | Governance Bypass | A public method is called without constructing or passing OperationContext, bypassing all permission and clearance checks | Every public mutation method requires OperationContext as first parameter; type system enforces non-optional | EG-1.4, ST-1.19, EG-11.12 |
| FM-GB-02 | Governance verdict ignored after evaluation | Governance Bypass | GovernanceContext evaluates an operation and returns `refuse`, but the calling code does not check the verdict and proceeds with mutation | Every operation MUST check GovernanceVerdict before state mutation; `refuse` verdict produces early return with error | ST-10.01, EG-1.4, OG-11.1 |
| FM-GB-03 | Agent self-promotes to verified trust | Governance Bypass | An agent with `high` trust level invokes promoteAgent on itself to reach `verified`, bypassing the human approval gate | `verified` MUST NOT be self-granted; requires Core admin human transition gate | ST-5.25, LM-5.13, LM-13.06 |
| FM-GB-04 | Trust promotion skips levels | Governance Bypass | An agent at `untrusted` directly promotes to `high`, skipping `low` and `medium`, gaining capabilities it has not earned | Trust promotions MUST be monotonic and single-step; only adjacent-level transitions are valid | ST-5.24, LM-5.12, LM-13.05 |
| FM-GB-05 | File missing governance declaration header | Governance Bypass | A source file is created without the `@governance SolisForge Protocol v1.4` header, making it ungoverned and invisible to traceability scanner | Every file MUST contain governance declaration; Traceability Scanner MUST fail CI on missing declarations | IC-5.01 through IC-5.08, IC-6.04 |
| FM-GB-06 | Builtin refusal rule disabled by tenant | Governance Bypass | A tenant administrator disables a builtin safety refusal rule, allowing operations that should be universally blocked | Builtin rules (`builtin: true`) MUST NOT be disableable by tenant | ST-13.02 |
| FM-GB-07 | Adapter suppresses audit-bound event | Governance Bypass | An adapter implementation intercepts an event emission and drops it before it reaches the audit log, destroying evidence | Adapters subscribe and translate but MUST NOT suppress audit-bound events; `emit` is internal-only | ST-16.20 |
| FM-GB-08 | Defense set reduced without compensating control | Governance Bypass | An amendment removes a defense mechanism (e.g., Traceability Scanner) without adding an equivalent replacement, weakening the governance envelope | HB-37 defense-set monotonicity: no amendment SHALL reduce the defense set without compensating control | IC-8.06, IC-9.09 |
| FM-GB-09 | Prior governance standard treated as authoritative | Governance Bypass | Code references PES v2.2 as the governing standard, creating dual-standard ambiguity where PES rules override SolisForge rules | There SHALL be exactly one governing doctrine; PES references MAY remain only when marked as `[HISTORICAL]` | IC-2.02, IC-4.08, IC-4.09 |
| FM-GB-10 | Rate limit bypassed by adapter | Governance Bypass | An adapter implementation locally resets or disables rate limit counters, allowing unlimited operations | Adapters SHALL NOT disable, bypass, or locally reset rate counters; DEFAULT_RATE_LIMITS always apply | AA-INV.01, EG-11.14 |

---

## 2. Data Integrity

Ways data can be corrupted, lost, or rendered inconsistent.

| FM-ID | Failure Mode | Category | How It Fails | Preventing Property | Requirement Trace |
|---|---|---|---|---|---|
| FM-DI-01 | Budget accounting inconsistency | Data Integrity | `available` is computed incorrectly such that `total - consumed - reserved != available`, allowing overdraft or phantom budget | Budget invariant: `available = total - consumed - reserved`; reservation making `available < 0` produces BUDGET_EXHAUSTED | EG-11.3, EG-5.16 |
| FM-DI-02 | Merge conflict produces partial state | Data Integrity | A knowledge merge operation fails midway, leaving some claims merged and others not, creating an inconsistent belief store | Merge operations MUST be atomic; partial merge failure rolls back all changes | MB-9.13 |
| FM-DI-03 | Claim confidence exceeds effective confidence | Data Integrity | Time-decay computation produces an `effectiveConfidence` value that exceeds the stored `confidence`, violating the decay invariant | `effectiveConfidence` MUST NOT exceed `confidence` | ST-10.2.12 |
| FM-DI-04 | Event history truncated or rewritten | Data Integrity | Audit events are modified or deleted after emission, destroying the immutable audit trail | Events are append-only; every state transition MUST emit AgentEventPayload | EG-11.10 |
| FM-DI-05 | Delegation chain breaks budget conservation | Data Integrity | Child mission budget exceeds parent remaining budget due to incorrect decay factor application, creating budget from nothing | Delegated budget = `parent_available * budgetFraction * budgetDecayFactor`; child budget MUST NOT exceed parent remaining | EG-11.4, EG-12.5 |
| FM-DI-06 | Classification downgrade through delegation | Data Integrity | A child mission is created with a lower classification level than its parent, allowing restricted data to flow to lower-clearance agents | Child mission MUST inherit classification from parent (cannot downgrade security) per classification ordering | EG-12.4, ST-3.01 |
| FM-DI-07 | Orphaned budget reservation after mission terminal | Data Integrity | A mission reaches terminal state (completed/failed/cancelled) but its budget reservations remain in `active` or `reserved` status, locking budget permanently | Terminal mission MUST release all non-released reservations; reservation lifecycle ensures all states can reach `released` | EG-9.14, EG-9.2 |
| FM-DI-08 | Statistics counter drift | Data Integrity | Agent statistics (totalSessions, totalClaimsAsserted, etc.) become inconsistent with actual operation count due to missed increments or double-counts | Statistics MUST be updated atomically with the operation they track | LM-3.42 through LM-3.50 |
| FM-DI-09 | Context allocation exceeds 100% | Data Integrity | Context budget config sets `missionContextAllocation + workingMemoryAllocation + beliefAllocation > 100`, causing over-allocation | Constraint: sum of allocations MUST be <= 100 | CG-4.7 |
| FM-DI-10 | Importance weights do not sum to 1.0 | Data Integrity | Custom importance weights are set that do not sum to 1.0, producing importance scores outside [0,1] range | Weights MUST sum to 1.0; all factors MUST be in [0,1] | CG-5.12, CG-5.11 |
| FM-DI-11 | Broken causal chain in belief retraction cascade | Data Integrity | Retracting a belief does not cascade to dependent beliefs that were derived from it; dependents remain asserted with invalid provenance | Belief retraction MUST cascade to all dependents: every belief whose `supports` chain includes the retracted belief MUST be re-evaluated or co-retracted | LM-13.22, MB-9.13 |
| FM-DI-12 | Circular reference in knowledge graph | Data Integrity | A `supports`/`contradicts` cycle forms in the belief graph (A supports B, B supports A), causing infinite loops during traversal or confidence propagation | Knowledge graph MUST be a DAG; cycle detection MUST reject any assertion that would create a `supports`/`contradicts` cycle | LM-13.22, ST-10.2.12 |
| FM-DI-13 | Missing provenance in hash chain | Data Integrity | A store entry is persisted without a valid `previous_hash` linking it to the prior entry, breaking the append-only hash chain and making tamper detection impossible | Every store entry MUST include `previous_hash` referencing the immediately prior entry's hash; entries with null or incorrect `previous_hash` MUST be rejected | IC-9.10, EG-11.10 |

---

## 3. Security

Ways the system can be attacked or exploited.

| FM-ID | Failure Mode | Category | How It Fails | Preventing Property | Requirement Trace |
|---|---|---|---|---|---|
| FM-SE-01 | Clearance level escalation via session manipulation | Security | An agent modifies its session to set a higher clearanceLevel than what TRUST_TO_CLEARANCE maps for its trust level, accessing restricted data | Clearance MUST be derived from trust level via TRUST_TO_CLEARANCE mapping; never directly settable | ST-5.03 through ST-5.08, LM-3.18 |
| FM-SE-02 | Agent accesses data above its classification ceiling | Security | An `untrusted` agent (clearance 0) accesses `confidential` data because classification enforcement is missing | Each trust level has explicit classification access ceiling; `untrusted` accesses `unrestricted` only | ST-5.29 through ST-5.33 |
| FM-SE-03 | Capability granted without required trust level | Security | An agent at `low` trust receives `computer_use` capability, which requires `high` trust, enabling unauthorized system access | Trust level to capability mapping is enforced; each capability has a minimum trust level | ST-5.17, ST-5.18, LM-4.02 |
| FM-SE-04 | Decommissioned agent performs operations | Security | A decommissioned agent's session is not terminated, allowing it to continue executing missions and asserting claims | Decommission MUST terminate all active sessions and revoke all capabilities | LM-3.29, LM-3.54, LM-3.57 |
| FM-SE-05 | Knowledge export leaks restricted claims | Security | An agent exports a knowledge package containing claims classified above the receiving agent's clearance level | Knowledge exchange MUST respect classification and consent constraints | LM-1.05, LM-13.22 |
| FM-SE-06 | Hook handler accesses cross-tenant data | Security | A hook plugin registered by tenant A receives events from tenant B due to missing tenant isolation in the event bus | Tenant isolation MUST be enforced at the event bus level; hooks only receive events for their tenant | OG-12.8, ST-16.20 |
| FM-SE-07 | Computer use without required trust level | Security | An agent at `medium` trust level executes terminal commands or spawns processes, capabilities that require `high` or `verified` trust | `computer_use`, `terminal_use`, `code_execution` require trust level `high` (clearance 3); process spawn/kill requires `verified` (clearance 4) | ST-5.18, ST-5.19 |
| FM-SE-08 | Consent bypass on data operation | Security | A data operation proceeds without checking consent, or proceeds after consent has been revoked | Every consentable operation MUST check consent via `checkConsent`; revoked/expired consent MUST block the operation | LM-2.15, LM-13.08, LM-13.19 |
| FM-SE-09 | Session timeout extended by client | Security | A client-side implementation extends the session timeout, keeping expired sessions alive beyond their governance-mandated lifetime | Session timeout enforcement MUST be server-side; client cannot extend without re-authentication | MB-9.15 |
| FM-SE-10 | Sandbox verdict allows unrestricted execution | Security | A `sandbox` governance verdict is issued but the sandbox execution environment is not actually constrained, allowing the operation to affect real state | Sandbox verdict MUST restrict the operation to a constrained execution environment with no side effects on production state | ST-10.01 (sandbox variant) |

---

## 4. Concurrency

Ways concurrent access causes errors.

| FM-ID | Failure Mode | Category | How It Fails | Preventing Property | Requirement Trace |
|---|---|---|---|---|---|
| FM-CC-01 | Double-spend on budget reservation | Concurrency | Two concurrent tasks both check `available > requested` and both proceed, consuming more budget than available | Budget reservation MUST use atomic compare-and-swap or serialized access; BUDGET_EXHAUSTED on negative available | EG-11.3, EG-5.16 |
| FM-CC-02 | Concurrent mission state transitions | Concurrency | Two concurrent operations both read mission state as `executing` and attempt different transitions, one succeeding and one silently failing without error | State transitions MUST be serialized per entity; second transition MUST re-validate from-state | EG-11.1, EG-3.31 |
| FM-CC-03 | Wave concurrency limit exceeded | Concurrency | More tasks transition to `running` than `maxConcurrency` allows because concurrent scheduling does not enforce the limit atomically | `maxConcurrency` governs simultaneous `running` tasks; scheduling MUST atomically check and increment running count | EG-12.12, EG-6.8 |
| FM-CC-04 | Event handler blocks operation | Concurrency | A synchronous or slow event handler blocks the operation that emitted the event, causing timeouts or deadlocks | Event handlers MUST execute asynchronously via unified event bus; handler failure MUST NOT block the operation | MB-9.14 |
| FM-CC-05 | Concurrent consent check and revoke | Concurrency | A data operation checks consent (returns allowed), then consent is revoked, then the operation executes against revoked consent | Consent revocation MUST invalidate all in-flight operations that depend on the revoked consent, or consent checks MUST be atomic with operation execution | LM-2.15, LM-2.14 |
| FM-CC-06 | Task dependency race | Concurrency | A task transitions to `running` while its dependency is simultaneously transitioning from `running` to `failed`, violating the dependency satisfaction invariant | Task MUST NOT transition to `running` unless all dependencies are `completed`; dependency check MUST be atomic with transition | EG-11.2 |
| FM-CC-07 | Concurrent agent decommission and operation | Concurrency | An agent is decommissioned while it is mid-mission, leaving missions in an inconsistent state (active missions owned by a decommissioned agent) | Decommission MUST atomically terminate all sessions and transition active missions to cancelled or failed | LM-3.54, LM-2.05 |

---

## 5. Type Parity (TC-21)

Ways TypeScript/Rust divergence causes bugs at the FFI boundary or in dual-implementation systems.

| FM-ID | Failure Mode | Category | How It Fails | Preventing Property | Requirement Trace |
|---|---|---|---|---|---|
| FM-TP-01 | Rust trait missing TypeScript methods (Execution) | Type Parity | Rust `AgentExecutionGovernor` has 15 methods but TypeScript `AgentExecutionClient` has 19; FFI callers from Rust cannot invoke `listMissions`, `getTask`, `listTasks`, `getBudgetState` | Rust trait MUST have method for every TypeScript interface method; TC-21 parity enforced | EG-13.01 through EG-13.04 |
| FM-TP-02 | Rust trait missing TypeScript methods (Lifecycle) | Type Parity | Rust lifecycle trait has 12 methods but TypeScript has 21; 9 methods (listAgents, getCapabilities, getCapabilityHistory, getTrustLevel, consent methods, transferKnowledge, event methods) have no Rust equivalent | Every TypeScript interface method MUST have a Rust trait equivalent or documented exclusion | LM-17.01 through LM-17.11 |
| FM-TP-03 | Rust RegisteredAgent missing fields | Type Parity | Rust `RegisteredAgent` struct omits `capabilities`, `metadata`, `statistics` fields present in TypeScript, causing data loss during serialization across FFI boundary | Rust and TypeScript data structures MUST have identical field sets | LM-17.11 |
| FM-TP-04 | TypeScript type defined only in Rust (Execution enums) | Type Parity | `BudgetDimension`, `AllocationMethod`, `BranchFailurePolicy`, `MutabilityClass`, `ReservationStatus` are used in TypeScript interface but only formally defined as Rust enums; TypeScript has no enforced type | TypeScript type definitions MUST exist for every type used in TypeScript interfaces | EG-14.01 through EG-14.05 |
| FM-TP-05 | Rust plugin lifecycle divergence | Type Parity | TypeScript `AgentPlugin` has `install`/`destroy` lifecycle methods; Rust `PluginManifest` is data-only with no lifecycle methods; plugins behave differently depending on runtime | Rust MUST either add lifecycle trait or document that plugin lifecycle is TypeScript-only; TypeScript `install`/`destroy` methods are contractual per OG-7.5 and OG-7.6 | OG-7.5, OG-7.6 |
| FM-TP-06 | Rust hook handler representation missing | Type Parity | TypeScript `registerHook` accepts `handler: HookHandler` (a function); Rust `register_hook` takes only `hook_type, priority, name` with no handler parameter; hooks cannot actually fire in Rust | Rust MUST add HookHandler trait or document that hook handlers are TypeScript-only; TypeScript `AgentHook.handler` and `HookHandler` type are contractual per OG-7.22 and OG-7.23 | OG-7.22, OG-7.23 |
| FM-TP-07 | TGP types missing Rust projection | Type Parity | `EvaluationSource`, `EvaluationMethod`, `PromotionResult`, `TGPRetiredReason` exist in TypeScript but have no Rust enum projection | Rust enums MUST be added when Intelligence Bridge adapter ships | ST-25.81 through ST-25.84 |
| FM-TP-08 | MissionState enum variant count mismatch | Type Parity | TypeScript `MissionState` has 10 values but Rust `MissionState` enum has fewer or different variant names, causing serialization failures or unhandled matches | Rust enum MUST have 10 variants matching TypeScript exactly | EG-10.1, EG-3.30 |
| FM-TP-09 | Error type variant count mismatch | Type Parity | TypeScript defines 17 error codes but Rust `ExecutionError` has fewer variants, causing error information loss during cross-language error propagation | Rust MUST have 17 variants matching TypeScript error codes | EG-10.9 |
| FM-TP-10 | Branded type erasure at FFI boundary | Type Parity | TypeScript branded types (TenantId, AgentId, etc.) are erased to plain strings when crossing FFI to Rust, allowing type confusion (passing a TenantId where AgentId is expected) | Rust newtypes MUST mirror TypeScript branded types; FFI serialization MUST preserve type identity | ST-1.01 through ST-1.16 |

---

## 6. State Machine

Ways lifecycle transitions fail or produce invalid states.

| FM-ID | Failure Mode | Category | How It Fails | Preventing Property | Requirement Trace |
|---|---|---|---|---|---|
| FM-SM-01 | Transition from terminal mission state | State Machine | A completed, failed, or cancelled mission accepts a new transition (e.g., completed -> executing), resurrecting a finished mission | Terminal states MUST have zero valid outgoing transitions; violations produce MISSION_TERMINAL | EG-11.7, EG-3.39, EG-3.40, EG-3.41 |
| FM-SM-02 | Invalid mission transition accepted | State Machine | A mission in `created` state transitions directly to `executing`, skipping `planning`, violating the transition table | Mission transitions MUST follow VALID_MISSION_TRANSITIONS exactly; `created` -> `planning` or `cancelled` only | EG-11.1, EG-3.32 |
| FM-SM-03 | Transition from terminal task state | State Machine | A completed or cancelled task accepts a new transition, restarting work that was finalized | `completed` and `cancelled` task states MUST have zero valid outgoing transitions | EG-4.18, EG-4.19 |
| FM-SM-04 | Failed task retried beyond limit | State Machine | A failed task is retried when `retryCount >= maxRetries`, allowing infinite retry loops | Retry MUST produce RETRY_LIMIT_EXCEEDED when `retryCount >= maxRetries` | EG-11.8, EG-8.16 |
| FM-SM-05 | Budget reservation invalid transition | State Machine | A reservation in `reserved` state transitions directly to `retained`, bypassing `active`, which is the only valid intermediate state | `reserved` cannot directly transition to `retained`; must go through `active` first | EG-9.15, EG-9.8 |
| FM-SM-06 | Degraded mission treated as completed | State Machine | A degraded mission is consumed as if it completed successfully, but degraded is NOT a terminal state; the agent MUST explicitly resolve it | A degraded mission MUST be transitioned to `failed`/`cancelled` explicitly or resolved back to `executing` | EG-3.53, EG-3.38 |
| FM-SM-07 | Agent state transition to decommissioned without cleanup | State Machine | Agent transitions from `active` to `decommissioned` without terminating sessions, revoking capabilities, or archiving knowledge | Decommission MUST produce DecommissionResult with sessionsTerminated, capabilitiesRevoked, consentsRevoked, knowledgeArchived | LM-3.51 through LM-3.57 |
| FM-SM-08 | Suspended agent resumes without governance check | State Machine | A suspended agent transitions back to `active` without re-evaluating the governance condition that caused the suspension | Resumption from `suspended` MUST re-validate governance conditions; suspended means "temporarily disabled via governance action" | LM-3.28 |
| FM-SM-09 | Task running with unmet dependencies | State Machine | A task transitions from `pending`/`scheduled` to `running` while one or more of its dependency tasks are not in `completed` state | Task MUST NOT transition to `running` unless all dependencies are `completed`; violation produces DEPENDENCY_UNMET | EG-11.2, EG-8.9 |
| FM-SM-10 | Wave state inconsistent with constituent tasks | State Machine | A wave is marked `completed` but contains tasks in `running` or `pending` state, or is marked `failed` with all tasks `completed` | Wave state MUST be derived from constituent task states according to failure policy (isolate/fail-fast/quorum) | EG-11.9, EG-6.6 |

---

## 7. Compliance

Ways audit, retention, and consent requirements fail.

| FM-ID | Failure Mode | Category | How It Fails | Preventing Property | Requirement Trace |
|---|---|---|---|---|---|
| FM-CO-01 | State transition without audit entry | Compliance | A mission or task state transition occurs but no AgentEventPayload is emitted, creating a gap in the audit trail | Every state transition MUST emit AgentEventPayload with actor, reason, timestamp, previous state, new state | EG-11.10 |
| FM-CO-02 | Consent record missing for data operation | Compliance | Personal data is processed without a valid consent record, violating GDPR/consent requirements | Every consentable operation MUST have a valid, non-revoked consent record before proceeding; storing personal data without active consent returns CONSENT_REQUIRED | LM-2.15, LM-13.08, LM-13.09 |
| FM-CO-03 | Decommissioned agent data not retained | Compliance | An agent is decommissioned and its data is deleted rather than retained per retention policy | Decommissioned state means "permanently retired, data retained per retention policy" | LM-3.29, LM-3.55 |
| FM-CO-04 | GDPR override on restricted/critical data | Compliance | A GDPR erasure request is applied to `restricted` or `critical` classified data, violating the classification override constraint | `restricted` and `critical` MUST NOT allow GDPR override | ST-17.08 |
| FM-CO-05 | Capability change without evidence | Compliance | An agent's capabilities are modified (granted or revoked) without recording the evidence that justified the change | All capability changes MUST require evidence | LM-1.04, LM-4.09 |
| FM-CO-06 | Event payload missing required fields | Compliance | An emitted event is missing one or more required fields (actor, reason, timestamp, previous state, new state), producing an incomplete audit record | AgentEventPayload MUST contain all required fields per SS16.2 structure | EG-13.6, EG-11.10 |
| FM-CO-07 | Knowledge transfer without consent verification | Compliance | Knowledge is transferred between agents without verifying that the source agent consented to export and the target agent is authorized to import | Knowledge exchange MUST respect classification and consent constraints | LM-1.05, LM-2.17 |
| FM-CO-08 | Traceability scanner passes non-compliant file | Compliance | The traceability scanner has a gap in its scanning pattern and misses a file type, allowing ungoverned files into the codebase | Scanner MUST scan every file for governance declaration; JSON files tracked via manifest | IC-6.02, IC-6.03 |
| FM-CO-09 | Amendment without Femi ratification | Compliance | A contract amendment is applied without Femi's explicit ratification, changing governance rules without authorization | Amendments MUST pass Breaker review AND Femi SHALL ratify amendments | IC-8.04, IC-8.05 |
| FM-CO-10 | Retry history not preserved | Compliance | When a failed task is retried, the original failure reason and attempt details are overwritten instead of preserved, destroying forensic evidence | Full attempt history MUST be preserved across retries | EG-11.8 |

---

## 8. Performance

Ways the system degrades under load.

| FM-ID | Failure Mode | Category | How It Fails | Preventing Property | Requirement Trace |
|---|---|---|---|---|---|
| FM-PF-01 | Context assembly exceeds token budget | Performance | `assembleContext` produces a context window larger than `maxTokens`, causing LLM API rejection or truncation | Context assembly MUST enforce hard token cap; excess claims excluded | CG-2.2, CG-4.1, CG-4.9 |
| FM-PF-02 | Search latency exceeds SLA | Performance | `semanticSearch` p95 latency exceeds 50ms, `hybridSearch` exceeds 80ms, or `checkDuplicate` exceeds 30ms under load | Performance SLAs are contractual; implementation MUST meet p95 latency targets | SG-A.2 through SG-A.8 |
| FM-PF-03 | Token overflow silently accepted | Performance | Tokenization produces an overflow result but the caller does not check the `overflow` flag and includes the oversized item, bloating the context | If `overflow` is true, caller MUST exclude the item rather than truncate silently | ST-20.11 |
| FM-PF-04 | Budget exhaustion not detected until overspend | Performance | The projected exhaustion calculation has a stale consumption rate, failing to warn about imminent budget depletion until after exhaustion | `projectedExhaustion` MUST be computed from last 10 consumption events; auto-transition to `blocked` when exhausted | EG-12.10, EG-11.11 |
| FM-PF-05 | Eviction policy fails under pressure | Performance | Context pressure reaches `critical` (>= 90% utilization) but the eviction policy does not trigger, causing context window overflow | Pressure thresholds MUST trigger appropriate eviction actions; `critical` at >= 90% | CG-4.20, CG-3.9 |
| FM-PF-06 | Unbounded mission delegation depth | Performance | Recursive mission delegation creates a chain deeper than `maxDepth`, exhausting stack/memory | `mission.depth` MUST NOT exceed `constraints.maxDepth` (default 5); produces MISSION_DEPTH_EXCEEDED | EG-11.5, EG-8.6 |
| FM-PF-07 | Unbounded task creation per mission | Performance | Tasks are created beyond `maxTasks` limit, consuming excessive memory and scheduling resources | `mission.taskCount` MUST NOT exceed `constraints.maxTasks` (default 50); produces TASK_LIMIT_EXCEEDED | EG-11.6, EG-8.7 |
| FM-PF-08 | Rate limit does not throttle burst | Performance | Rate limit implementation counts requests over a window but allows a burst at window boundaries (classic sliding-window vs. fixed-window gap) | Unified rate limit MUST enforce DEFAULT_RATE_LIMITS consistently; per-mission limits may be stricter but MUST NOT weaken defaults | EG-11.14, AA-INV.01 |

---

## 9. Integration

Ways components fail to work together.

| FM-ID | Failure Mode | Category | How It Fails | Preventing Property | Requirement Trace |
|---|---|---|---|---|---|
| FM-IN-01 | Adapter bound to non-existent agent | Integration | An adapter registration is attempted before the agent identity is created via AgentLifecycleClient, causing a dangling adapter reference | Agent registration MUST happen first; an adapter cannot be bound to a non-existent agent identity | LM-1.06, LM-1.07 |
| FM-IN-02 | Event system fragmentation | Integration | Different contracts use separate event bus instances instead of the unified AgentEventBus, causing events to be invisible across subsystems | All events MUST be dispatched through shared AgentEventBus from SS16.2; all contracts share the same bus | EG-13.7, CG-3.33, MB-9.14 |
| FM-IN-03 | Shared type redefined in contract | Integration | A Phase X contract redefines a type from SHARED_TYPES.md (e.g., its own version of `OperationContext`), creating type divergence between subsystems | No Phase X contract may redefine any shared type listed in SHARED_TYPES.md | ST-0.02 |
| FM-IN-04 | Context Governor and Memory Bridge misuse | Integration | Application code uses `recall()` when it should use `assembleContext()`, or vice versa, getting wrong behavior (no budget enforcement or no targeted retrieval) | Clear separation: `recall()` for targeted knowledge retrieval; `assembleContext()` for LLM context window population | CG-2.1 through CG-2.5 |
| FM-IN-05 | Event payload schema mismatch | Integration | Execution events (mission:created, task:completed, etc.) are emitted with ad-hoc data shapes instead of the standardized AgentEventPayload structure, breaking event consumers | All events MUST carry AgentEventPayload structure from SS16.2 | EG-13.6, EG-7.1 through EG-7.18 |
| FM-IN-06 | CrewAI adapter misses canonical method | Integration | CrewAI adapter implements convenience methods but omits a canonical AgentAdapter method, breaking interoperability with other adapters | Canonical Adapter Surface: adapter implements EVERY canonical AgentAdapter method; convenience methods may be added but MUST NOT replace canonical semantics | CA-14.11 |
| FM-IN-07 | Cross-contract type definition gap | Integration | A type is used in an interface but defined only in one language (e.g., `AllocationMethod` used in TypeScript but only formally defined as Rust enum), causing runtime type errors | Every type used in a TypeScript interface MUST have a TypeScript definition; every type used in a Rust trait MUST have a Rust definition | EG-14.01 through EG-14.05 |
| FM-IN-08 | Governance events not registered in unified system | Integration | Execution or lifecycle events are emitted but not registered in the unified event system registry, making them invisible to hooks and plugins | All events MUST be registered in unified event system | EG-13.1 through EG-13.5 |
| FM-IN-09 | sessionToContext derivation incorrect | Integration | `OperationContext` is manually constructed instead of derived from `AgentSession` via `sessionToContext()`, producing inconsistent context (wrong permissions, missing clearance) | OperationContext MUST be derived from AgentSession via sessionToContext() per SS8 | EG-2.21 |
| FM-IN-10 | Delegation deadline exceeds parent | Integration | A child mission is delegated with a deadline that extends beyond the parent mission's deadline, creating an impossible scheduling constraint | Child mission MUST NOT exceed parent deadline | EG-12.6, EG-3.45 |

---

## 10. Operational

Ways deployment, upgrade, and runtime operation fail.

| FM-ID | Failure Mode | Category | How It Fails | Preventing Property | Requirement Trace |
|---|---|---|---|---|---|
| FM-OP-01 | Baseline freeze commit lost or misidentified | Operational | The baseline freeze commit (`f4ead70`) is not preserved or is incorrectly referenced, making convergence measurement impossible | Baseline freeze commit SHALL be `f4ead70cc9919131c3f6b712f1b2df98c79ff850` on `release/v5`; all convergence changes measured against this | IC-3.01, IC-3.05 |
| FM-OP-02 | Divergence detector not running | Operational | The divergence detector script is not installed as a pre-commit hook or session-start check, allowing governance drift to accumulate silently | Divergence Detector SHALL run on every commit or session start | IC-6.07 |
| FM-OP-03 | Self-audit trigger fails to block | Operational | P0/P1 divergence is detected but the self-audit trigger does not block further work, allowing code to be built on a non-compliant base | Self-Audit Trigger SHALL block further work until resolved; produces CONVERGENCE_REQUIRED.md | IC-6.13, IC-6.14, IC-6.15 |
| FM-OP-04 | Contract hash binding broken | Operational | A contract is modified but its hash in `phase-x.contracts.json` is not updated, causing the hash binding check (HB-38) to fail or be silently skipped | Interface/hash binding (HB-38) MUST be enforced; contract hashes verified by `verify-contract-hashes.sh` | IC-9.10 |
| FM-OP-05 | Test suite regression below baseline | Operational | Test count drops below 4,258 (the baseline), indicating test deletion or breakage without replacement | Full test suite SHALL pass (4258+ tests); convergence maintains or increases test count | IC-10.04, IC-3.03 |
| FM-OP-06 | Master Index stale after governance change | Operational | The Master Index references PES v2.2 or outdated governance anchors after SolisForge v1.4 adoption, creating confusion about authoritative standards | Master Index SHALL be re-anchored to SolisForge v1.4 | IC-10.05 |
| FM-OP-07 | Phased implementation breaks capability ordering | Operational | Phase 3 features are implemented before Phase 2 prerequisites (e.g., cognitive health before Intelligence Bridge), causing missing dependency failures | Implementation phases have explicit ordering constraints; dependencies MUST be satisfied before dependent phases | IB-17.3, LM-1.06 |
| FM-OP-08 | Quorum evaluation ambiguity | Operational | Wave quorum policy (`ceil(tasks.length / 2)`) is evaluated eagerly when half the tasks complete but others are still running, prematurely declaring success or waiting forever | Quorum SHALL be computed against non-cancelled tasks only; evaluation SHALL occur only after all non-cancelled tasks reach a terminal state (completed or failed); quorum threshold applied to completed count vs. non-cancelled total | EG-11.9, EG-6.6 |
| FM-OP-09 | Event payload data fields unspecified | Operational | Execution events are emitted with the correct event name but the internal `data` field structure varies across implementations, breaking consumers that parse specific fields | Event payload schemas SHALL be defined as typed interfaces per event name; each of the 18 execution events MUST have an exported `{EventName}Data` type defining required fields, validated at emit time | EG-7.1 through EG-7.18, OG-8.15 through OG-8.24 |
| FM-OP-10 | Scanner manifest missing JSON file | Operational | A new JSON config file is added but not registered in the Traceability Scanner manifest, making it invisible to governance validation | JSON files SHALL be tracked via the Traceability Scanner manifest | IC-5.07, IC-6.03 |

---

## 11. Credential/Secret Management

Ways secrets leak, rotate incorrectly, or fail to protect sensitive material.

| FM-ID | Failure Mode | Category | How It Fails | Preventing Property | Requirement Trace |
|---|---|---|---|---|---|
| FM-CR-01 | Secret leakage via audit logs | Credential/Secret Management | An API key, token, or password is included in an AgentEventPayload `data` field or telemetry vital, persisted to the audit log, and exposed to any agent with audit read access | Audit event `data` fields MUST be sanitized before persistence; a redaction filter SHALL strip values matching secret patterns (API keys, tokens, passwords) before emit; no raw secret SHALL appear in any persisted event | EG-11.10, OG-8.15 through OG-8.24, ST-17.08 |
| FM-CR-02 | Key rotation race condition | Credential/Secret Management | During credential rotation, the old key is revoked before all in-flight operations using it complete, causing those operations to fail with authentication errors; or the new key is not yet propagated, creating a window where no valid key exists | Credential rotation MUST follow overlap-then-revoke: new credential activated and propagated before old credential is revoked; a minimum overlap window MUST be enforced; in-flight operations started with the old credential MUST complete or be retried with the new credential | LM-3.54, MB-9.15 |
| FM-CR-03 | Plaintext fallback on encryption failure | Credential/Secret Management | When the encryption layer fails (missing key, corrupted keystore, algorithm mismatch), the system falls back to storing data in plaintext rather than failing the operation, silently downgrading security | Encryption failure MUST produce an error and abort the operation; plaintext storage SHALL NOT be a fallback path; `ClassificationLevel` enforcement MUST reject unencrypted storage for any classification above `unrestricted` | ST-3.01, ST-17.08, EG-12.4 |

---

## 12. Behavioral/Model Quality

Ways agent behavior degrades due to model quality, belief management, or technique application failures.

| FM-ID | Failure Mode | Category | How It Fails | Preventing Property | Requirement Trace |
|---|---|---|---|---|---|
| FM-BQ-01 | Belief decay miscalculation | Behavioral/Model Quality | The FSRS decay function computes an `effectiveConfidence` that does not monotonically decrease over time (e.g., due to floating-point error or incorrect interval calculation), causing stale beliefs to appear fresh | FSRS decay MUST produce monotonically non-increasing `effectiveConfidence` for any given belief as time advances; `effectiveConfidence` at time T+1 MUST be <= `effectiveConfidence` at time T when no reinforcement occurs | ST-10.2.12, CG-5.11 |
| FM-BQ-02 | False confidence amplification | Behavioral/Model Quality | An agent reinforces a belief multiple times from the same evidence source, inflating confidence without new information; or circular reinforcement between agents creates unbounded confidence growth | Confidence reinforcement MUST track evidence source identity; duplicate reinforcement from the same source SHALL NOT increase confidence; cross-agent reinforcement MUST include provenance to prevent circular amplification | LM-13.22, ST-10.2.12, MB-9.13 |
| FM-BQ-03 | Stale technique application | Behavioral/Model Quality | An agent applies a technique (reasoning pattern, tool usage strategy) that was effective in a prior context but is no longer valid due to changed environment, producing incorrect outputs with high apparent confidence | Techniques stored in the knowledge base MUST carry context metadata (environment version, applicable conditions); technique selection MUST validate that current context matches stored applicability conditions; expired or inapplicable techniques MUST be flagged, not silently applied | CG-5.12, LM-13.22, IB-17.3 |

---

## 13. Migration/Evolution

Ways schema changes, version upgrades, and contract evolution introduce failures.

| FM-ID | Failure Mode | Category | How It Fails | Preventing Property | Requirement Trace |
|---|---|---|---|---|---|
| FM-ME-01 | Schema migration ordering violation | Migration/Evolution | Database migrations execute out of order (e.g., migration 003 runs before 002), creating schema states that depend on columns or tables that do not yet exist, corrupting the database | Migrations MUST execute in strict sequential order; each migration MUST declare its predecessor; the migration runner MUST verify predecessor completion before executing; out-of-order execution MUST abort with MIGRATION_ORDER_VIOLATION | IC-3.01, IC-3.05, EG-11.10 |
| FM-ME-02 | Backward-incompatible contract change | Migration/Evolution | A contract amendment changes a method signature, removes a field, or alters semantics in a way that breaks existing consumers who depend on the prior contract version | Contract amendments MUST be backward-compatible unless a major version bump is declared; removed fields MUST be deprecated for at least one major version before removal; method signature changes MUST maintain the prior signature as an overload or alias during the transition period | IC-8.04, IC-8.05, IC-8.06, ST-0.02 |
| FM-ME-03 | Data loss during version upgrade | Migration/Evolution | A version upgrade transforms stored data (e.g., belief format, event schema) but the transformation is lossy, silently dropping fields or truncating values that existed in the prior format | Version upgrade transformations MUST be lossless; every field in the source format MUST map to a field in the target format or be explicitly archived; a pre-upgrade snapshot MUST be taken; the upgrade MUST verify record count and field completeness post-migration, aborting on any discrepancy | IC-3.01, EG-11.10, LM-3.55 |

---

## Summary

| Category | Code | Count | Description |
|---|---|---|---|
| Governance Bypass | GB | 10 | Ways governance can be circumvented |
| Data Integrity | DI | 13 | Ways data can be corrupted or lost |
| Security | SE | 10 | Ways the system can be attacked |
| Concurrency | CC | 7 | Ways concurrent access causes errors |
| Type Parity | TP | 10 | Ways TS/Rust divergence causes bugs |
| State Machine | SM | 10 | Ways lifecycle transitions fail |
| Compliance | CO | 10 | Ways audit/retention/consent fails |
| Performance | PF | 8 | Ways the system degrades under load |
| Integration | IN | 10 | Ways components fail to work together |
| Operational | OP | 10 | Ways deployment/upgrade fails |
| Credential/Secret Management | CR | 3 | Ways secrets leak or rotate incorrectly |
| Behavioral/Model Quality | BQ | 3 | Ways agent behavior degrades due to model/belief issues |
| Migration/Evolution | ME | 3 | Ways schema changes and upgrades introduce failures |
| **TOTAL** | | **107** | |

---

## Requirement Trace Coverage

This atlas traces to requirements from all 14 extraction files:

| Source Contract | Prefix | FMs Referencing |
|---|---|---|
| LIMEN_V5_INTEGRATION_CONTRACT | IC-* | FM-GB-05, FM-GB-08, FM-GB-09, FM-CO-08, FM-CO-09, FM-DI-13, FM-OP-01 through FM-OP-06, FM-OP-10, FM-ME-01, FM-ME-02, FM-ME-03 |
| SHARED_TYPES | ST-* | FM-GB-06, FM-DI-03, FM-DI-06, FM-DI-10, FM-DI-12, FM-SE-01, FM-SE-02, FM-SE-03, FM-SE-10, FM-PF-03, FM-IN-03, FM-TP-07, FM-TP-10, FM-CO-04, FM-CR-01, FM-CR-03, FM-BQ-01, FM-BQ-02, FM-ME-02 |
| AGENT_EXECUTION_GOVERNANCE | EG-* | FM-GB-01, FM-GB-02, FM-GB-10, FM-DI-01, FM-DI-05, FM-DI-07, FM-DI-13, FM-CC-01 through FM-CC-03, FM-CC-06, FM-SM-01 through FM-SM-06, FM-SM-09, FM-SM-10, FM-CO-01, FM-CO-06, FM-CO-10, FM-PF-04, FM-PF-06, FM-PF-07, FM-PF-08, FM-IN-05, FM-IN-07, FM-IN-08, FM-IN-10, FM-OP-08, FM-OP-09, FM-TP-01, FM-TP-04, FM-TP-08, FM-TP-09, FM-CR-01, FM-CR-03, FM-ME-01, FM-ME-03 |
| AGENT_LIFECYCLE_MANAGEMENT | LM-* | FM-GB-03, FM-GB-04, FM-DI-08, FM-DI-11, FM-SE-03, FM-SE-04, FM-SE-05, FM-SE-08, FM-CC-05, FM-CC-07, FM-SM-07, FM-SM-08, FM-CO-02, FM-CO-03, FM-CO-05, FM-CO-07, FM-IN-01, FM-TP-02, FM-TP-03, FM-CR-02, FM-BQ-02, FM-BQ-03, FM-ME-03 |
| AGENT_CONTEXT_GOVERNANCE | CG-* | FM-DI-09, FM-DI-10, FM-PF-01, FM-PF-05, FM-IN-04, FM-BQ-01, FM-BQ-03 |
| AGENT_MEMORY_BRIDGE | MB-* | FM-DI-02, FM-DI-11, FM-CC-04, FM-SE-09, FM-CR-02, FM-BQ-02 |
| AGENT_OUTPUT_GOVERNANCE | OG-* | FM-GB-02, FM-GB-07, FM-SE-06, FM-TP-05, FM-TP-06, FM-OP-09, FM-CR-01 |
| AGENT_ADAPTER_ARCHITECTURE | AA-* | FM-GB-10, FM-PF-08 |
| AGENT_SEARCH_GOVERNANCE | SG-* | FM-PF-02 |
| AGENT_INTELLIGENCE_BRIDGE | IB-* | FM-OP-07, FM-BQ-03 |
| CREWAI_ADAPTER_CONTRACT | CA-* | FM-IN-06 |
| AGENT_COORDINATION_GOVERNANCE | (cross-referenced via shared event bus) | FM-IN-02 |
| AUDIT_VISUALIZATION_SCHEMA | (cross-referenced via audit trail) | FM-CO-01, FM-CO-06 |
| COMPUTER_USE_GOVERNANCE | (cross-referenced via trust model) | FM-SE-07 |

---

## Cross-Reference: Overlapping Failure Modes

The following failure modes address related concerns from different categories. They are not duplicates -- each captures a distinct failure mechanism -- but implementors should verify that fixes for one do not regress the other.

| FM Group | Related FMs | Shared Concern |
|---|---|---|
| Belief retraction + Merge atomicity | FM-DI-11, FM-DI-02 | Both involve belief graph consistency; DI-02 covers merge atomicity, DI-11 covers retraction cascade completeness |
| Event payload completeness | FM-CO-06, FM-IN-05, FM-OP-09 | CO-06 covers missing required fields, IN-05 covers schema mismatch, OP-09 covers unspecified data field types |
| Decommission atomicity | FM-SE-04, FM-CC-07, FM-SM-07 | SE-04 covers session termination, CC-07 covers concurrent decommission race, SM-07 covers state transition without cleanup |
| Budget conservation | FM-DI-01, FM-DI-05, FM-CC-01, FM-DI-07 | DI-01 covers accounting invariant, DI-05 covers delegation conservation, CC-01 covers double-spend, DI-07 covers orphaned reservations |
| Task dependency enforcement | FM-SM-09, FM-CC-06 | SM-09 covers the state machine invariant, CC-06 covers the race condition in dependency checking |
| Confidence integrity | FM-DI-03, FM-BQ-01, FM-BQ-02, FM-DI-12 | DI-03 covers effective > stored, BQ-01 covers non-monotonic decay, BQ-02 covers circular amplification, DI-12 covers graph cycles |
| Hash chain integrity | FM-DI-13, FM-OP-04 | DI-13 covers store-level hash chain provenance, OP-04 covers contract-level hash binding |

---

## Design Notes

1. **Quorum Semantics (FM-OP-08):** The contract specifies `ceil(tasks.length / 2)` for quorum but does not specify eager vs. terminal evaluation. This atlas resolves the ambiguity: quorum SHALL be computed against non-cancelled tasks only, evaluated after all non-cancelled tasks reach terminal states. This prevents both false-success (eager evaluation) and unnecessary-wait (including cancelled tasks in denominator) failures.

2. **Event Payload Data Fields (FM-OP-09):** The contract defines 18 execution event names but does not specify structured payload types for each event's internal `data` field. This atlas requires typed interfaces per event name (e.g., `MissionCreatedData`, `TaskCompletedData`), validated at emit time. Output Governance requirements OG-8.15 through OG-8.24 provide partial schemas for output-domain events.

3. **TC-21 Parity Gaps:** 10 failure modes (FM-TP-01 through FM-TP-10) document known divergences between TypeScript and Rust projections. These are not speculative -- they are gaps identified during requirement extraction that MUST be resolved before Rust integration.

4. **Concurrency Category (7 FMs):** Fewer than other categories because the system is primarily single-threaded Node.js with serialized database access. The concurrency risks that exist are at the logical level (race conditions in state machine transitions, budget accounting) rather than at the thread-safety level.

5. **New Categories (v1.1.0):** Three categories added per B1-01 finding: Credential/Secret Management (CR), Behavioral/Model Quality (BQ), and Migration/Evolution (ME). These address failure domains not covered by the original 10 categories: secret handling in a multi-agent system, AI model behavior degradation, and schema evolution safety.

6. **Causality/Observability (v1.1.0):** Three failure modes added per B1-02 finding: FM-DI-11 (belief retraction cascade), FM-DI-12 (knowledge graph cycles), FM-DI-13 (hash chain provenance). These address the causal reasoning and observability gaps in the belief management subsystem.
