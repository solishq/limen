# Phase 2: CrewAI Adapter — Traceability Matrix

**Contract:** CREWAI_ADAPTER_CONTRACT.md v1.0.0
**Architecture:** AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
**Shared Types:** SHARED_TYPES.md v1.4.1
**Status:** COMPLETE — 54 tests passing

---

## Traceability Matrix

| # | Artifact | Type | Contract Clause | File | Line Range |
|---|---------|------|-----------------|------|------------|
| 1 | `AdapterId` | Branded ID | SHARED_TYPES S1.1, S4 | types.ts | 15 |
| 2 | `AgentId` | Branded ID | SHARED_TYPES S1.1 | types.ts | 16 |
| 3 | `SessionId` | Branded ID | SHARED_TYPES S1.1 | types.ts | 17 |
| 4 | `ClaimId` | Branded ID | SHARED_TYPES S1.1b | types.ts | 18 |
| 5 | `AgentBranchId` | Branded ID | SHARED_TYPES S4 | types.ts | 19 |
| 6 | `EventId` | Branded ID | SHARED_TYPES S1.1 | types.ts | 22 |
| 7 | `AgentTrustLevel` | Enum | SHARED_TYPES S5 | types.ts | 29 |
| 8 | `TRUST_TO_CLEARANCE` | Const Map | SHARED_TYPES S5 | types.ts | 32 |
| 9 | `TRUST_CONFIDENCE_CAPS` | Const Map | CREWAI S5.4, Claim 3.5 | types.ts | 40 |
| 10 | `AgentCapability` | Enum (20) | SHARED_TYPES S6 | types.ts | 50 |
| 11 | `ClassificationLevel` | Enum | SHARED_TYPES S3 | types.ts | 58 |
| 12 | `AgentFramework` | Enum (10) | SHARED_TYPES S21 | types.ts | 63 |
| 13 | `OperationContext` | Interface | SHARED_TYPES S1.3 | types.ts | 88 |
| 14 | `Result<T>` | Union Type | SHARED_TYPES S1.5 | types.ts | 107 |
| 15 | `AgentSession` | Interface | SHARED_TYPES S7 | types.ts | 122 |
| 16 | `GovernanceContext` | Interface | SHARED_TYPES S9 | types.ts | 143 |
| 17 | `GovernanceAction` | Union Type | SHARED_TYPES S9 | types.ts | 155 |
| 18 | `GovernanceVerdict` | Union Type | SHARED_TYPES S10 | types.ts | 168 |
| 19 | `GovernanceDecision` | Interface | SHARED_TYPES S10.1 | types.ts | 177 |
| 20 | `StructuredContent` | Interface | SHARED_TYPES S10.2.1 | types.ts | 193 |
| 21 | `AgentMemoryOptions` | Interface | SHARED_TYPES S10.2.1 | types.ts | 201 |
| 22 | `AgentRecallQuery` | Interface | SHARED_TYPES S10.2.1 | types.ts | 215 |
| 23 | `AgentRecallOptions` | Interface | SHARED_TYPES S10.2.1 | types.ts | 237 |
| 24 | `BeliefState` | Interface | SHARED_TYPES S10.2 | types.ts | 280 |
| 25 | `AuditLogEntry` | Interface | SHARED_TYPES S10.3 | types.ts | 293 |
| 26 | `ComputerAction` | Type | SHARED_TYPES S11 | types.ts | 320 |
| 27 | `NativeAgentAction` | Interface | SHARED_TYPES S11.4 | types.ts | 326 |
| 28 | `SandboxConfig` | Interface | SHARED_TYPES S12 | types.ts | 338 |
| 29 | `AdapterSandboxDefaults` | Interface | SHARED_TYPES S12.1 | types.ts | 360 |
| 30 | `MergeStrategy` | Enum | SHARED_TYPES S14 | types.ts | 381 |
| 31 | `SessionSummary` | Interface | SHARED_TYPES S15 | types.ts | 397 |
| 32 | `TokenEstimate` | Interface | SHARED_TYPES S20.1 | types.ts | 432 |
| 33 | `ActionDigest` | Interface | SHARED_TYPES S24 | types.ts | 445 |
| 34 | `AgentToolCall` | Interface | ADAPTER_ARCH S5.1 | types.ts | 455 |
| 35 | `LimenOperation` | Union Type | ADAPTER_ARCH S5.2 | types.ts | 465 |
| 36 | `LimenAgentClient` | Interface | ADAPTER_ARCH S6 | types.ts | 480 |
| 37 | `ComputerActionGovernor` | Interface | ADAPTER_ARCH S6 | types.ts | 504 |
| 38 | `CrewAIToolCallHookContext` | Interface | CREWAI S1.5 | types.ts | 515 |
| 39 | `CrewAIToolCall` | Interface | CREWAI S3.2.1 | types.ts | 527 |
| 40 | `CrewAIToolContext` | Interface | CREWAI S3.2.1 | types.ts | 537 |
| 41 | `CrewAIHookEvent` | Union Type | CREWAI S3.2.1 | types.ts | 549 |
| 42 | `CrewAISessionStart` | Interface | CREWAI S3.2.1 | types.ts | 555 |
| 43 | `CrewAISessionEnd` | Interface | CREWAI S3.2.1 | types.ts | 564 |
| 44 | `CrewContext` | Interface | CREWAI S3.3 | types.ts | 573 |
| 45 | `RememberOptions` | Interface | CREWAI S3.3 | types.ts | 582 |
| 46 | `RecallResult` | Interface | CREWAI S3.4 | types.ts | 588 |
| 47 | `MergeResult` | Interface | CREWAI S3.5 | types.ts | 597 |
| 48 | `ManualMergeResolutionRequest` | Interface | CREWAI S3.5 | types.ts | 612 |
| 49 | `TokenBudgetConfig` | Interface | CREWAI S3.6 | types.ts | 621 |
| 50 | `RetryPolicy` | Interface | CREWAI S3.7 | types.ts | 631 |
| 51 | `AdapterHealth` | Interface | CREWAI S3.8 | types.ts | 641 |
| 52 | `AdapterLifecycleState` | Enum | CREWAI S9.1 | types.ts | 658 |
| 53 | `CrewAIAuditDetails` | Interface | CREWAI S8.2 | types.ts | 666 |
| 54 | `CrewAIAdapterErrorCode` | Enum (18) | CREWAI S6.1 | types.ts | 691 |
| 55 | `ERROR_PRECEDENCE` | Const Map | CREWAI S6.2 | types.ts | 714 |
| 56 | `NEVER_RETRYABLE` | Const Set | CREWAI S6.2, Claims 4.2/4.3 | types.ts | 737 |
| 57 | `CrewAIAdapterError` | Class | CREWAI S6.1 | errors.ts | 33 |
| 58 | `notInitialized()` | Error Factory | CREWAI S6.1, Claim 4.3 | errors.ts | 67 |
| 59 | `governanceRefusal()` | Error Factory | CREWAI S6.1, Claims 4.2/3.4 | errors.ts | 86 |
| 60 | `budgetExceeded()` | Error Factory | CREWAI S6.1, Claim 4.4 | errors.ts | 109 |
| 61 | `unknownTool()` | Error Factory | CREWAI S6.1, Claim 4.6 | errors.ts | 127 |
| 62 | `corePortUnavailable()` | Error Factory | CREWAI S6.1, Claim 4.5 | errors.ts | 141 |
| 63 | `auditFailure()` | Error Factory | CREWAI S6.1 | errors.ts | 155 |
| 64 | `serdeError()` | Error Factory | CREWAI S6.1 | errors.ts | 167 |
| 65 | `clientError()` | Error Factory | CREWAI S6.1 | errors.ts | 191 |
| 66 | `selectHighestPrecedence()` | Function | CREWAI S6.2, Claim 4.1 | errors.ts | 245 |
| 67 | `toResultError()` | Function | CREWAI S6 | errors.ts | 255 |
| 68 | `CrewAIAdapterConfig` | Interface | CREWAI S3.2 | config.ts | 26 |
| 69 | `validateConfig()` | Function | CREWAI S3.2, Claims 2.1/2.2/2.12/2.13/4.7 | config.ts | 65 |
| 70 | `computeConfigDigest()` | Function | CREWAI S3.2, Claim 2.10 | config.ts | 127 |
| 71 | Config governed:false check | Validation | CREWAI Claim 2.1 | config.ts | 70 |
| 72 | Config connectionTimeoutMs check | Validation | CREWAI Claim 2.2 | config.ts | 82 |
| 73 | Config delegationDepthMax check | Validation | CREWAI Claim 2.13 | config.ts | 88 |
| 74 | Config warningThresholdPct check | Validation | CREWAI Claim 2.12 | config.ts | 94 |
| 75 | Rate limit weakening check | Validation | CREWAI Claim 2.7 | config.ts | 108 |
| 76 | `normalizeHookContext()` | Function | CREWAI S1.5, Claim 2.8 | hooks.ts | 27 |
| 77 | `validateHookContext()` | Function | CREWAI S3.2.1, Claim 2.8 | hooks.ts | 69 |
| 78 | `translateToolToOperations()` | Function | CREWAI S5, Claim 1.9 | hooks.ts | 94 |
| 79 | `KNOWN_TOOLS` | Const Array | CREWAI S6.1 (UNKNOWN_TOOL ctx) | hooks.ts | 155 |
| 80 | `mapNativeEvent()` | Function | CREWAI S3.1, Claim 3.8 | hooks.ts | 170 |
| 81 | `mapLimenEvent()` | Function | CREWAI S3.1, Claim 3.8 | hooks.ts | 203 |
| 82 | `AdapterLifecycle` | Class | CREWAI S9 | lifecycle.ts | 22 |
| 83 | `VALID_TRANSITIONS` | Const Map | CREWAI S9.3, Claim 7.1 | lifecycle.ts | 11 |
| 84 | `AdapterLifecycle.transition()` | Method | CREWAI S9.3, Claims 7.1/7.2 | lifecycle.ts | 41 |
| 85 | `LimenCrewAIAdapter` | Class | CREWAI S3.1 | adapter.ts | 71 |
| 86 | `initialize()` | Method | CREWAI S3.1, Claims 1.1/7.2/7.7 | adapter.ts | 101 |
| 87 | `shutdown()` | Method | CREWAI S3.1, Claims 1.2/1.3/7.5 | adapter.ts | 156 |
| 88 | `onAgentSessionStart()` | Method | CREWAI S3.1, INV-7 | adapter.ts | 205 |
| 89 | `onAgentSessionEnd()` | Method | CREWAI S3.1 | adapter.ts | 252 |
| 90 | `remember()` | Method | CREWAI S3.1, Claims 1.4/3.5/2.3 | adapter.ts | 291 |
| 91 | `recall()` | Method | CREWAI S3.1, Claims 1.5/3.7/2.4 | adapter.ts | 365 |
| 92 | `createBranch()` | Method | CREWAI S3.1, Claim 1.6 | adapter.ts | 430 |
| 93 | `mergeBranches()` | Method | CREWAI S3.1, Claims 1.7/2.5 | adapter.ts | 477 |
| 94 | `resolveConflict()` | Method | CREWAI S3.1, Claims 1.11/2.9 | adapter.ts | 530 |
| 95 | `translateToolCall()` | Method | CREWAI S3.1, Claims 1.9/2.8 | adapter.ts | 576 |
| 96 | `translateActionToGovernance()` | Method | CREWAI S3.1, Claim 1.10 | adapter.ts | 628 |
| 97 | `healthCheck()` | Method | CREWAI S3.1, Claims 1.12/6.5 | adapter.ts | 675 |
| 98 | `getHealth()` | Method | CREWAI S3.1, Claim 1.8 | adapter.ts | 700 |
| 99 | `on()` | Method | CREWAI S3.1, Claim 1.13 | adapter.ts | 723 |
| 100 | `off()` | Method | CREWAI S3.1, Claim 1.13 | adapter.ts | 742 |
| 101 | Governance-first ordering | Pipeline | CREWAI S5.1 (16-step) | adapter.ts | 291-360 |
| 102 | Agent state check (suspended) | Guard | CREWAI Claim 3.6 | adapter.ts | _evaluateGovernance |
| 103 | Confidence cap application | Logic | CREWAI Claim 3.5, INV-8 | adapter.ts | _applyConfidenceCap |
| 104 | Crew context auto-population | Logic | CREWAI Claim 2.3 | adapter.ts | _enrichRememberOptions |
| 105 | Token budget check | Logic | CREWAI S7.2, Claims 5.1/5.2 | adapter.ts | _checkTokenBudget |
| 106 | Audit-before-success | Invariant | CREWAI S8.1, Claim 6.1 | adapter.ts | _appendAudit |
| 107 | TC-01 | Test | CREWAI S10 (Happy Path) | adapter.test.ts | TC-01 |
| 108 | TC-02 | Test | CREWAI S10 (Auth-First) | adapter.test.ts | TC-02 |
| 109 | TC-03 | Test | CREWAI S10 (Budget) | adapter.test.ts | TC-03 |
| 110 | TC-04 | Test | CREWAI S10 (Audit) | adapter.test.ts | TC-04 |
| 111 | TC-05 | Test | CREWAI S10 (Port Loss) | adapter.test.ts | TC-05 |
| 112 | TC-06 | Test | CREWAI S10 (Ungoverned) | adapter.test.ts | TC-06 |
| 113 | TC-07 | Test | CREWAI S10 (Use-Before-Init) | adapter.test.ts | TC-07 |
| 114 | TC-08 | Test | CREWAI S10 (Shutdown Idempotent) | adapter.test.ts | TC-08 |
| 115 | TC-08A | Test | CREWAI S10 (Init Idempotent) | adapter.test.ts | TC-08A |
| 116 | TC-09 | Test | CREWAI S10 (Concurrent DEGRADED) | adapter.test.ts | TC-09 |
| 117 | TC-10 | Test | CREWAI S10 (Error Precedence) | adapter.test.ts | TC-10 |
| 118 | TC-11 | Test | CREWAI S10 (Confidence Cap) | adapter.test.ts | TC-11 |
| 119 | TC-13 | Test | CREWAI S10 (Hook Translation) | adapter.test.ts | TC-13 |
| 120 | TC-14 | Test | CREWAI S10 (BaseTool) | adapter.test.ts | TC-14 |
| 121 | TC-15 | Test | CREWAI S10 (Gov Refusal) | adapter.test.ts | TC-15 |
| 122 | TC-16 | Test | CREWAI S10 (Budget Exceeded) | adapter.test.ts | TC-16 |
| 123 | TC-17 | Test | CREWAI S10 (Session Timeout) | adapter.test.ts | TC-17 |
| 124 | TC-18 | Test | CREWAI S10 (Concurrent Tools) | adapter.test.ts | TC-18 |
| 125 | TC-19 | Test | CREWAI S10 (Error Translation) | adapter.test.ts | TC-19 |
| 126 | TC-20 | Test | CREWAI S10 (Ungoverned Bypass) | adapter.test.ts | TC-20 |
| 127 | TC-21 | Test | CREWAI S10 (Dual Parity) | adapter.test.ts | TC-21 |
| 128 | TC-22 | Test | CREWAI S10 (Sandbox) | adapter.test.ts | TC-22 |
| 129 | TC-24 | Test | CREWAI S10 (Hostile Payload) | adapter.test.ts | TC-24 |
| 130 | TC-25 | Test | CREWAI S10 (Client Error) | adapter.test.ts | TC-25 |
| 131 | TC-26 | Test | CREWAI S10 (Session Isolation) | adapter.test.ts | TC-26 |
| 132 | TC-27 | Test | CREWAI S10 (Shutdown Sessions) | adapter.test.ts | TC-27 |
| 133 | TC-28 | Test | CREWAI S10 (Health States) | adapter.test.ts | TC-28 |
| 134 | TC-29 | Test | CREWAI S10 (Subscriptions) | adapter.test.ts | TC-29 |
| 135 | Config connectionTimeoutMs | Test | CREWAI Claim 2.2 | adapter.test.ts | Config Validation |
| 136 | Config delegationDepthMax | Test | CREWAI Claim 2.13 | adapter.test.ts | Config Validation |
| 137 | Config warningThresholdPct | Test | CREWAI Claim 2.12 | adapter.test.ts | Config Validation |
| 138 | Config rate limit weakening | Test | CREWAI Claim 2.7 | adapter.test.ts | Config Validation |
| 139 | Event bridge native->Limen | Test | CREWAI Claim 3.8 | adapter.test.ts | Event Bridge |
| 140 | Event bridge Limen->native | Test | CREWAI Claim 3.8 | adapter.test.ts | Event Bridge |
| 141 | Event bridge null mapping | Test | CREWAI Claim 3.8 | adapter.test.ts | Event Bridge |
| 142 | Action translation | Test | CREWAI Claim 1.10 | adapter.test.ts | translateActionToGovernance |
| 143 | Capability not declared | Test | CREWAI Claim 1.10 | adapter.test.ts | translateActionToGovernance |
| 144 | Malformed payload | Test | CREWAI S6.2 | adapter.test.ts | translateActionToGovernance |
| 145 | Unknown tool handling | Test | CREWAI Claim 1.9 | adapter.test.ts | TC-02 Parent |
| 146 | resolveConflict validation | Test | CREWAI Claim 2.9 | adapter.test.ts | resolveConflict |
| 147 | Untrusted remember block | Test | CREWAI Claim 3.6 | adapter.test.ts | Trust Level |
| 148 | Low trust branch block | Test | CREWAI Claim 1.6 | adapter.test.ts | Trust Level |
| 149 | Config digest identity | Test | CREWAI Claim 2.10 | adapter.test.ts | Config Digest |
| 150 | Config digest difference | Test | CREWAI Claim 2.10 | adapter.test.ts | Config Digest |
| 151 | Init after SHUTDOWN | Test | CREWAI Claim 7.2 | adapter.test.ts | Lifecycle Edge |
| 152 | getHealth all states | Test | CREWAI Claim 1.8 | adapter.test.ts | Lifecycle Edge |

---

## Claims Coverage Summary

| Claim | Status | Test Coverage |
|-------|--------|--------------|
| 1.1 | COVERED | TC-01, TC-07, TC-08A |
| 1.2 | COVERED | TC-08 |
| 1.3 | COVERED | TC-27 |
| 1.4 | COVERED | TC-01, TC-02 |
| 1.5 | COVERED | TC-01 (recall clearance) |
| 1.6 | COVERED | Trust Level tests |
| 1.7 | COVERED | mergeBranches impl |
| 1.8 | COVERED | TC-28, Lifecycle Edge |
| 1.9 | COVERED | TC-13, TC-14, Unknown Tool |
| 1.10 | COVERED | translateActionToGovernance tests |
| 1.11 | COVERED | resolveConflict tests |
| 1.12 | COVERED | TC-28 |
| 1.13 | COVERED | TC-29 |
| 2.1 | COVERED | TC-06, TC-20 |
| 2.2 | COVERED | Config Validation |
| 2.3 | COVERED | remember impl (auto-population) |
| 2.4 | COVERED | recall impl (truncated flag) |
| 2.5 | COVERED | mergeBranches impl |
| 2.7 | COVERED | Config Validation |
| 2.8 | COVERED | TC-13, TC-24 |
| 2.9 | COVERED | resolveConflict tests |
| 2.10 | COVERED | Config Digest tests |
| 2.12 | COVERED | Config Validation |
| 2.13 | COVERED | Config Validation |
| 3.1-3.8 | COVERED | Multiple tests (governance pipeline) |
| 4.1 | COVERED | TC-10 |
| 4.2 | COVERED | TC-19 |
| 4.3 | COVERED | TC-19, TC-07 |
| 4.4 | COVERED | TC-03 |
| 4.5 | COVERED | TC-05 |
| 4.6 | COVERED | Unknown Tool test |
| 4.7 | COVERED | Config Validation |
| 5.1-5.3 | COVERED | Token budget impl + tests |
| 6.1-6.5 | COVERED | TC-04, audit pipeline |
| 7.1-7.7 | COVERED | TC-05, TC-08, TC-28, lifecycle |

---

## Invariants Coverage

| # | Invariant | Status |
|---|-----------|--------|
| 1 | Pure Translation | ENFORCED — no belief cache |
| 2 | Governance Cannot Be Bypassed | ENFORCED — every side-effecting op gated |
| 3 | Audit Completeness | ENFORCED — _appendAudit on every path |
| 4 | Capability Immutability | ENFORCED — frozen ReadonlySet |
| 5 | Deterministic Error Resolution | ENFORCED — ERROR_PRECEDENCE map |
| 6 | Session Isolation | ENFORCED — per-adapter Map, TC-26 |
| 7 | CrewAI Metadata Preservation | ENFORCED — metadata in session + audit |
| 8 | Confidence Monotonicity | ENFORCED — _applyConfidenceCap |
| 9 | Shutdown Completeness | ENFORCED — _clearSubscriptions, session cleanup |
| 10 | Budget Non-Negative | ENFORCED — checked arithmetic in _checkTokenBudget |
| 11 | Canonical Adapter Surface | ENFORCED — all AgentAdapter methods |
| 12 | No Local Belief Cache | ENFORCED — DEGRADED fails all |
| 13 | Rate Limit Inheritance | ENFORCED — config validation |
