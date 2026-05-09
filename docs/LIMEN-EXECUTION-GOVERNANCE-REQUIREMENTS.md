# Limen v5 -- AGENT_EXECUTION_GOVERNANCE.md Requirement Extraction

**Source:** `contracts/AGENT_EXECUTION_GOVERNANCE.md` v1.2.1
**Extracted:** 2026-05-09
**Governing Standard:** SolisForge Protocol v1.4
**Governance Tier:** Forge Critical
**Purpose:** Every implementable requirement from the Agent Execution Governance contract.

---

## Section 1: Purpose & Scope

| ID | Requirement | Source |
|---|---|---|
| EG-1.1 | Contract scope covers mission lifecycle, task orchestration, budget governance, and execution scheduling for AI agents | S1 |
| EG-1.2 | Contract classification is `internal` | Header |
| EG-1.3 | All operations are session-scoped, governance-gated, and produce immutable audit trails | S1 |
| EG-1.4 | All mutation operations MUST pass through GovernanceContext (SHARED_TYPES SS9) before execution | Preamble Gate |
| EG-1.5 | Every public operation MUST consume the unified `DEFAULT_RATE_LIMITS` budget (SHARED_TYPES SS18) before mutating state | Preamble Rate Gate |
| EG-1.6 | All cross-contract types referenced are defined in `contracts/SHARED_TYPES.md`; this contract does NOT redefine any shared type | Preamble |

**Totals: 6 requirements**

---

## Section 2: AgentExecutionClient Interface

| ID | Requirement | Source |
|---|---|---|
| EG-2.1 | `createMission(ctx: OperationContext, spec: MissionSpec)` MUST return `Promise<Result<AgentMission>>` | S2 |
| EG-2.2 | `updateMissionState(ctx: OperationContext, missionId: MissionId, transition: MissionTransition)` MUST return `Promise<Result<AgentMission>>` | S2 |
| EG-2.3 | `getMission(ctx: OperationContext, missionId: MissionId)` MUST return `Promise<Result<AgentMission>>` | S2 |
| EG-2.4 | `listMissions(ctx: OperationContext, filter?: MissionFilter)` MUST return `Promise<Result<AgentMission[]>>` | S2 |
| EG-2.5 | `delegateMission(ctx: OperationContext, missionId: MissionId, targetAgentId: AgentId, constraints?: DelegationConstraints)` MUST return `Promise<Result<AgentMission>>` | S2 |
| EG-2.6 | `completeMission(ctx: OperationContext, missionId: MissionId, outcome: MissionOutcome)` MUST return `Promise<Result<MissionCompletionResult>>` | S2 |
| EG-2.7 | `cancelMission(ctx: OperationContext, missionId: MissionId, reason: string)` MUST return `Promise<Result<void>>` | S2 |
| EG-2.8 | `createTask(ctx: OperationContext, missionId: MissionId, spec: TaskSpec)` MUST return `Promise<Result<AgentTask>>` | S2 |
| EG-2.9 | `updateTaskState(ctx: OperationContext, taskId: TaskId, transition: TaskTransition)` MUST return `Promise<Result<AgentTask>>` | S2 |
| EG-2.10 | `getTask(ctx: OperationContext, taskId: TaskId)` MUST return `Promise<Result<AgentTask>>` | S2 |
| EG-2.11 | `listTasks(ctx: OperationContext, missionId: MissionId, filter?: TaskFilter)` MUST return `Promise<Result<AgentTask[]>>` | S2 |
| EG-2.12 | `retryTask(ctx: OperationContext, taskId: TaskId, reason: string)` MUST return `Promise<Result<AgentTask>>` | S2 |
| EG-2.13 | `reserveBudget(ctx: OperationContext, missionId: MissionId, request: BudgetRequest)` MUST return `Promise<Result<BudgetReservation>>` | S2 |
| EG-2.14 | `consumeBudget(ctx: OperationContext, reservationId: ReservationId, consumption: BudgetConsumption)` MUST return `Promise<Result<BudgetState>>` | S2 |
| EG-2.15 | `releaseBudget(ctx: OperationContext, reservationId: ReservationId)` MUST return `Promise<Result<void>>` | S2 |
| EG-2.16 | `getBudgetState(ctx: OperationContext, missionId: MissionId)` MUST return `Promise<Result<BudgetState>>` | S2 |
| EG-2.17 | `scheduleWave(ctx: OperationContext, missionId: MissionId, wave: WaveSpec)` MUST return `Promise<Result<ExecutionWave>>` | S2 |
| EG-2.18 | `getSchedule(ctx: OperationContext, missionId: MissionId)` MUST return `Promise<Result<ExecutionSchedule>>` | S2 |

**Totals: 18 requirements**

---

## Section 2 (continued): Event System

| ID | Requirement | Source |
|---|---|---|
| EG-2.19 | `on(event: AgentEvent, handler: AgentEventHandler)` MUST return subscription ID `string` | S2 |
| EG-2.20 | `off(subscriptionId: string)` MUST unsubscribe the handler | S2 |
| EG-2.21 | `OperationContext` MUST be derived from `AgentSession` via `sessionToContext()` per SHARED_TYPES SS8 | S2 Note |
| EG-2.22 | Events MUST use the unified event system from SHARED_TYPES SS16 | S2 |

**Totals: 4 requirements**

---

## Section 3: Mission Data Models

### 3.1 MissionSpec

| ID | Requirement | Source |
|---|---|---|
| EG-3.1 | `MissionSpec.objective` MUST be readonly string | S3.1 |
| EG-3.2 | `MissionSpec.successCriteria` MUST be `readonly string[]` | S3.1 |
| EG-3.3 | `MissionSpec.scopeBoundaries` MUST be `readonly string[]` | S3.1 |
| EG-3.4 | `MissionSpec.capabilities` MUST be `readonly string[]` validated against `AgentCapability` (SHARED_TYPES SS6) | S3.1 |
| EG-3.5 | `MissionSpec.parentMissionId` MUST be optional `MissionId` | S3.1 |
| EG-3.6 | `MissionSpec.constraints` MUST be optional `MissionConstraintsInput` | S3.1 |
| EG-3.7 | `MissionSpec.classification` MUST be optional `ClassificationLevel` from SHARED_TYPES SS3 | S3.1 |

### 3.2 MissionConstraintsInput

| ID | Requirement | Source |
|---|---|---|
| EG-3.8 | `MissionConstraintsInput.budget` MUST be optional with fields: `tokens?: number`, `deliberations?: number` | S3.2 |
| EG-3.9 | `MissionConstraintsInput.deadline` MUST be optional string (ISO-8601) | S3.2 |
| EG-3.10 | `MissionConstraintsInput.maxTasks` MUST be optional number | S3.2 |
| EG-3.11 | `MissionConstraintsInput.maxDepth` MUST be optional number | S3.2 |
| EG-3.12 | `MissionConstraintsInput.maxChildren` MUST be optional number | S3.2 |

### 3.3 AgentMission

| ID | Requirement | Source |
|---|---|---|
| EG-3.13 | `AgentMission.id` MUST be readonly `MissionId` | S3.3 |
| EG-3.14 | `AgentMission.tenantId` MUST be readonly `TenantId | null` | S3.3 |
| EG-3.15 | `AgentMission.parentId` MUST be readonly `MissionId | null` | S3.3 |
| EG-3.16 | `AgentMission.agentId` MUST be readonly `AgentId` | S3.3 |
| EG-3.17 | `AgentMission.state` MUST be readonly `MissionState` | S3.3 |
| EG-3.18 | `AgentMission.planVersion` MUST be readonly number | S3.3 |
| EG-3.19 | `AgentMission.delegationChain` MUST be `readonly DelegationRecord[]` | S3.3 |
| EG-3.20 | `AgentMission.constraints` MUST be readonly `ResolvedMissionConstraints` | S3.3 |
| EG-3.21 | `AgentMission.depth` MUST be readonly number | S3.3 |
| EG-3.22 | `AgentMission.taskCount` MUST be readonly number | S3.3 |
| EG-3.23 | `AgentMission.budgetConsumed` MUST be readonly `BudgetConsumed` | S3.3 |
| EG-3.24 | `AgentMission.classification` MUST be readonly `ClassificationLevel` from SHARED_TYPES SS3 | S3.3 |
| EG-3.25 | `AgentMission` MUST have readonly timestamp fields: `createdAt`, `updatedAt`, `completedAt` (nullable) | S3.3 |
| EG-3.26 | `AgentMission.objective` MUST be readonly string (carried from `MissionSpec.objective` at creation) | S3.3 implied from S3.1 |
| EG-3.27 | `AgentMission.successCriteria` MUST be `readonly string[]` (carried from `MissionSpec.successCriteria` at creation) | S3.3 implied from S3.1 |
| EG-3.28 | `AgentMission.scopeBoundaries` MUST be `readonly string[]` (carried from `MissionSpec.scopeBoundaries` at creation) | S3.3 implied from S3.1 |
| EG-3.29 | `AgentMission.capabilities` MUST be `readonly string[]` (carried from `MissionSpec.capabilities` at creation, validated against `AgentCapability` SS6) | S3.3 implied from S3.1 |

### 3.4 MissionState

| ID | Requirement | Source |
|---|---|---|
| EG-3.30 | `MissionState` MUST be union: `'created' | 'planning' | 'executing' | 'reviewing' | 'paused' | 'completed' | 'failed' | 'degraded' | 'blocked' | 'cancelled'` (10 states) | S3.4 |

### 3.5 MissionTransition

| ID | Requirement | Source |
|---|---|---|
| EG-3.31 | `MissionTransition` MUST have readonly fields: `from: MissionState`, `to: MissionState`, `reason: string`, `triggeredBy: AgentId` | S3.5 |
| EG-3.32 | `created` MUST transition to: `planning`, `cancelled` only | S3.5 |
| EG-3.33 | `planning` MUST transition to: `executing`, `cancelled` only | S3.5 |
| EG-3.34 | `executing` MUST transition to: `reviewing`, `paused`, `completed`, `failed`, `degraded`, `blocked`, `cancelled` | S3.5 |
| EG-3.35 | `reviewing` MUST transition to: `executing`, `paused`, `cancelled` only | S3.5 |
| EG-3.36 | `paused` MUST transition to: `executing`, `reviewing`, `cancelled` only | S3.5 |
| EG-3.37 | `blocked` MUST transition to: `executing`, `cancelled` only | S3.5 |
| EG-3.38 | `degraded` MUST transition to: `executing`, `cancelled` only | S3.5 |
| EG-3.39 | `completed` MUST have zero valid outgoing transitions (terminal) | S3.5 |
| EG-3.40 | `failed` MUST have zero valid outgoing transitions (terminal) | S3.5 |
| EG-3.41 | `cancelled` MUST have zero valid outgoing transitions (terminal) | S3.5 |

### 3.6 MissionFilter

| ID | Requirement | Source |
|---|---|---|
| EG-3.42 | `MissionFilter` MUST have optional readonly fields: `state`, `agentId`, `parentId`, `classification`, `createdAfter`, `limit` | S3.6 |
| EG-3.43 | `MissionFilter.state` MUST accept `MissionState | readonly MissionState[]` | S3.6 |
| EG-3.44 | `MissionFilter.parentId` MUST accept `MissionId | null` (null filters for root missions) | S3.6 |

### 3.7-3.12 Remaining Mission Models

| ID | Requirement | Source |
|---|---|---|
| EG-3.45 | `DelegationConstraints` MUST have optional readonly fields: `budgetFraction` (0.0-1.0), `maxDepth`, `capabilities`, `deadline` (ISO-8601, must not exceed parent), `failurePolicy` | S3.7 |
| EG-3.46 | `DelegationRecord` MUST have readonly fields: `fromAgentId`, `toAgentId`, `delegatedAt`, `constraints` | S3.8 |
| EG-3.47 | `MissionOutcome` MUST have readonly fields: `success`, `summary`, `claimsProduced`, `artifactsProduced`, `budgetConsumed` | S3.9 |
| EG-3.48 | `MissionCompletionResult.finalState` MUST be `'completed' | 'failed' | 'cancelled'` | S3.10 |
| EG-3.49 | `MissionCompletionResult.tasksSummary` MUST have readonly fields: `total`, `completed`, `failed`, `cancelled` | S3.10 |
| EG-3.50 | `MissionCompletionResult.missionId` MUST be readonly `MissionId` identifying the completed mission | S3.10 |
| EG-3.51 | `MissionCompletionResult.duration` MUST be readonly number (milliseconds from creation to completion) | S3.10 |
| EG-3.52 | `MissionCompletionResult.outcome` MUST be readonly `MissionOutcome` containing the completion summary | S3.10 |
| EG-3.53 | A degraded mission has NOT completed; agent MUST transition it to `failed`/`cancelled` explicitly or resolve the degradation | S3.10 Note |

**Totals: 53 requirements**

---

## Section 3 (continued): ResolvedMissionConstraints & BudgetConsumed

| ID | Requirement | Source |
|---|---|---|
| EG-3.54 | `ResolvedMissionConstraints.budget` MUST have readonly fields: `tokens: number`, `deliberations: number` | S3.11 |
| EG-3.55 | `ResolvedMissionConstraints` MUST have readonly fields: `deadline`, `maxTasks`, `maxDepth`, `maxChildren`, `budgetDecayFactor` | S3.11 |
| EG-3.56 | Default `budget.tokens` MUST be `100_000` | S3.11 |
| EG-3.57 | Default `budget.deliberations` MUST be `10` | S3.11 |
| EG-3.58 | Default `deadline` MUST be `null` | S3.11 |
| EG-3.59 | Default `maxTasks` MUST be `50` | S3.11 |
| EG-3.60 | Default `maxDepth` MUST be `5` | S3.11 |
| EG-3.61 | Default `maxChildren` MUST be `10` | S3.11 |
| EG-3.62 | Default `budgetDecayFactor` MUST be `0.3` | S3.11 |
| EG-3.63 | `BudgetConsumed.percentage` MUST have readonly fields: `tokens` (0.0-100.0), `deliberations` (0.0-100.0) | S3.12 |

**Totals: 10 requirements**

---

## Section 4: Task Data Models

### 4.1 TaskSpec

| ID | Requirement | Source |
|---|---|---|
| EG-4.1 | `TaskSpec.description` MUST be readonly string | S4.1 |
| EG-4.2 | `TaskSpec.mutabilityClass` MUST be readonly `MutabilityClass` | S4.1 |
| EG-4.3 | `TaskSpec.estimatedTokens` MUST be optional number | S4.1 |
| EG-4.4 | `TaskSpec.dependencies` MUST be optional `readonly TaskId[]` | S4.1 |
| EG-4.5 | `TaskSpec.priority` MUST be optional number 0-100 (higher = more urgent) | S4.1 |
| EG-4.6 | `TaskSpec.timeout` MUST be optional number in milliseconds | S4.1 |
| EG-4.7 | `TaskSpec.maxRetries` MUST be optional number | S4.1 |

### 4.2 AgentTask

| ID | Requirement | Source |
|---|---|---|
| EG-4.8 | `AgentTask` MUST have readonly fields: `id`, `missionId`, `agentId`, `description`, `state`, `mutabilityClass`, `priority`, `dependencies`, `retryCount`, `maxRetries`, `timeout`, `budgetReservationId`, `createdAt`, `startedAt`, `completedAt`, `failedAt`, `failureReason` | S4.2 |
| EG-4.9 | Default `priority` MUST be `50` | S4.2 |
| EG-4.10 | Default `timeout` MUST be `300_000` (5 minutes) | S4.2 |
| EG-4.11 | Default `maxRetries` MUST be `3` | S4.2 |

### 4.3 TaskState

| ID | Requirement | Source |
|---|---|---|
| EG-4.12 | `TaskState` MUST be union: `'pending' | 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled'` (6 states) | S4.3 |

### 4.4 TaskTransition

| ID | Requirement | Source |
|---|---|---|
| EG-4.13 | `TaskTransition` MUST have readonly fields: `from: TaskState`, `to: TaskState`, `reason?: string` | S4.4 |
| EG-4.14 | `pending` MUST transition to: `scheduled`, `cancelled` only | S4.4 |
| EG-4.15 | `scheduled` MUST transition to: `running`, `pending` (deschedule), `cancelled` | S4.4 |
| EG-4.16 | `running` MUST transition to: `completed`, `failed` only | S4.4 |
| EG-4.17 | `failed` MUST transition to: `pending` only (retry path, only if `retryCount < maxRetries`) | S4.4 |
| EG-4.18 | `completed` MUST have zero valid outgoing transitions (terminal) | S4.4 |
| EG-4.19 | `cancelled` MUST have zero valid outgoing transitions (terminal) | S4.4 |

### 4.5 TaskFilter

| ID | Requirement | Source |
|---|---|---|
| EG-4.20 | `TaskFilter` MUST have optional readonly fields: `state`, `mutabilityClass`, `priority` (with `min`/`max`), `limit` | S4.5 |
| EG-4.21 | `TaskFilter.state` MUST accept `TaskState | readonly TaskState[]` | S4.5 |

**Totals: 21 requirements**

---

## Section 5: Budget Governance Data Models

### 5.1 BudgetRequest

| ID | Requirement | Source |
|---|---|---|
| EG-5.1 | `BudgetRequest.dimension` MUST be readonly `BudgetDimension` | S5.1 |
| EG-5.2 | `BudgetRequest.amount` MUST be readonly number | S5.1 |
| EG-5.3 | `BudgetRequest.allocationMethod` MUST be readonly `AllocationMethod` | S5.1 |
| EG-5.4 | `BudgetRequest.purpose` MUST be readonly string | S5.1 |
| EG-5.5 | `BudgetRequest.taskId` MUST be optional `TaskId` | S5.1 |

### 5.2 BudgetReservation

| ID | Requirement | Source |
|---|---|---|
| EG-5.6 | `BudgetReservation` MUST have readonly fields: `id`, `missionId`, `dimension`, `reserved`, `consumed`, `status`, `purpose`, `taskId`, `createdAt`, `activatedAt`, `releasedAt` | S5.2 |
| EG-5.7 | `BudgetReservation.status` MUST be of type `ReservationStatus` | S5.2 |
| EG-5.8 | `BudgetReservation.taskId` MUST be `TaskId | null` | S5.2 |

### 5.3 BudgetConsumption

| ID | Requirement | Source |
|---|---|---|
| EG-5.9 | `BudgetConsumption` MUST have readonly fields: `amount: number`, `operation: string` | S5.3 |
| EG-5.10 | `BudgetConsumption.taskId` MUST be optional `TaskId` | S5.3 |

### 5.4 BudgetState

| ID | Requirement | Source |
|---|---|---|
| EG-5.11 | `BudgetState` MUST have readonly fields: `missionId`, `total`, `consumed`, `reserved`, `available` | S5.4 |
| EG-5.12 | `BudgetState.total/consumed/reserved/available` MUST each have `tokens: number` and `deliberations: number` | S5.4 |
| EG-5.13 | `BudgetState.reservations` MUST be `readonly BudgetReservation[]` | S5.4 |
| EG-5.14 | `BudgetState.overBudget` MUST be readonly boolean | S5.4 |
| EG-5.15 | `BudgetState.projectedExhaustion` MUST be `string | null` (ISO-8601 if trending to exhaust) | S5.4 |
| EG-5.16 | `available` MUST be computed as `total - consumed - reserved` | S5.4 implied from S11 Inv3 |
| EG-5.17 | All budget data model fields MUST be readonly | S5.1-5.4 |

**Totals: 17 requirements**

---

## Section 6: Scheduling Data Models

### 6.1 WaveSpec

| ID | Requirement | Source |
|---|---|---|
| EG-6.1 | `WaveSpec.name` MUST be readonly string | S6.1 |
| EG-6.2 | `WaveSpec.tasks` MUST be `readonly TaskId[]` | S6.1 |
| EG-6.3 | `WaveSpec.allocationMethod` MUST be readonly `AllocationMethod` | S6.1 |
| EG-6.4 | `WaveSpec.failurePolicy` MUST be readonly `BranchFailurePolicy` | S6.1 |
| EG-6.5 | `WaveSpec.maxConcurrency` MUST be optional number | S6.1 |

### 6.2 ExecutionWave

| ID | Requirement | Source |
|---|---|---|
| EG-6.6 | `WaveState` MUST be union: `'pending' | 'executing' | 'completed' | 'failed'` | S6.2 |
| EG-6.7 | `ExecutionWave` MUST have readonly fields: `id`, `missionId`, `name`, `tasks`, `allocationMethod`, `failurePolicy`, `maxConcurrency`, `state`, `startedAt`, `completedAt` | S6.2 |
| EG-6.8 | Default `maxConcurrency` MUST be `5` | S6.2 |

### 6.3 ExecutionSchedule

| ID | Requirement | Source |
|---|---|---|
| EG-6.9 | `ExecutionSchedule` MUST have readonly fields: `missionId`, `waves`, `currentWaveId`, `completedWaves`, `totalWaves` | S6.3 |
| EG-6.10 | `ExecutionSchedule.currentWaveId` MUST be `WaveId | null` | S6.3 |
| EG-6.11 | `ExecutionSchedule.waves` MUST be `readonly ExecutionWave[]` | S6.3 |
| EG-6.12 | All scheduling data model fields MUST be readonly | S6.1-6.3 |

**Totals: 12 requirements**

---

## Section 7: Execution Events

| ID | Requirement | Source |
|---|---|---|
| EG-7.1 | Event `mission:created` MUST be emittable | S7 |
| EG-7.2 | Event `mission:state_changed` MUST be emittable | S7 |
| EG-7.3 | Event `mission:delegated` MUST be emittable | S7 |
| EG-7.4 | Event `mission:completed` MUST be emittable | S7 |
| EG-7.5 | Event `mission:failed` MUST be emittable | S7 |
| EG-7.6 | Event `mission:cancelled` MUST be emittable | S7 |
| EG-7.7 | Event `task:created` MUST be emittable | S7 |
| EG-7.8 | Event `task:state_changed` MUST be emittable | S7 |
| EG-7.9 | Event `task:completed` MUST be emittable | S7 |
| EG-7.10 | Event `task:failed` MUST be emittable | S7 |
| EG-7.11 | Event `task:retried` MUST be emittable | S7 |
| EG-7.12 | Event `budget:reserved` MUST be emittable | S7 |
| EG-7.13 | Event `budget:consumed` MUST be emittable | S7 |
| EG-7.14 | Event `budget:released` MUST be emittable | S7 |
| EG-7.15 | Event `budget:exhausted` MUST be emittable | S7 |
| EG-7.16 | Event `wave:started` MUST be emittable | S7 |
| EG-7.17 | Event `wave:completed` MUST be emittable | S7 |
| EG-7.18 | Event `wave:failed` MUST be emittable | S7 |

**Totals: 18 requirements**

---

## Section 8: Error Types

| ID | Requirement | Source |
|---|---|---|
| EG-8.1 | Error `INVALID_MISSION_TRANSITION` MUST include: `from: MissionState`, `to: MissionState`, `reason: string` | S8 |
| EG-8.2 | Error `INVALID_TASK_TRANSITION` MUST include: `from: TaskState`, `to: TaskState`, `reason: string` | S8 |
| EG-8.3 | Error `INVALID_RESERVATION_TRANSITION` MUST include: `reservationId: ReservationId`, `from: ReservationStatus`, `to: ReservationStatus` | S8 |
| EG-8.4 | Error `BUDGET_EXHAUSTED` MUST include: `dimension: BudgetDimension`, `requested: number`, `available: number` | S8 |
| EG-8.5 | Error `BUDGET_RESERVATION_FAILED` MUST include: `reason: string` | S8 |
| EG-8.6 | Error `MISSION_DEPTH_EXCEEDED` MUST include: `maxDepth: number`, `requestedDepth: number` | S8 |
| EG-8.7 | Error `TASK_LIMIT_EXCEEDED` MUST include: `maxTasks: number`, `currentTasks: number` | S8 |
| EG-8.8 | Error `DELEGATION_DENIED` MUST include: `reason: string`, `targetAgent: AgentId` | S8 |
| EG-8.9 | Error `DEPENDENCY_UNMET` MUST include: `taskId: TaskId`, `unmetDependencies: readonly TaskId[]` | S8 |
| EG-8.10 | Error `WAVE_CONFLICT` MUST include: `waveId: WaveId`, `reason: string` | S8 |
| EG-8.11 | Error `MISSION_NOT_FOUND` MUST include: `missionId: MissionId` | S8 |
| EG-8.12 | Error `TASK_NOT_FOUND` MUST include: `taskId: TaskId` | S8 |
| EG-8.13 | Error `RESERVATION_NOT_FOUND` MUST include: `reservationId: ReservationId` | S8 |
| EG-8.14 | Error `DEADLINE_EXCEEDED` MUST include: `missionId: MissionId`, `deadline: string` | S8 |
| EG-8.15 | Error `GOVERNANCE_REFUSAL` MUST include: `reason: string`, `action: string` | S8 |
| EG-8.16 | Error `RETRY_LIMIT_EXCEEDED` MUST include: `taskId: TaskId`, `maxRetries: number` | S8 |
| EG-8.17 | Error `MISSION_TERMINAL` MUST include: `missionId: MissionId`, `state: MissionState` | S8 |

**Totals: 17 requirements**

---

## Section 9: State Machine Diagrams

### 9.1 Mission Lifecycle (redundant with S3.5 but explicitly verified)

| ID | Requirement | Source |
|---|---|---|
| EG-9.1 | Mission lifecycle MUST support exactly 10 states: created, planning, executing, reviewing, paused, completed, failed, degraded, blocked, cancelled | S9.1 |
| EG-9.2 | Terminal states (completed, failed, cancelled) MUST have zero outgoing transitions | S9.1 |
| EG-9.3 | `executing` has the most outgoing transitions (7): reviewing, paused, completed, failed, degraded, blocked, cancelled | S9.1 |

### 9.2 Task Lifecycle

| ID | Requirement | Source |
|---|---|---|
| EG-9.4 | Task lifecycle MUST support exactly 6 states: pending, scheduled, running, completed, failed, cancelled | S9.2 |
| EG-9.5 | `scheduled` can deschedule back to `pending` | S9.2 |
| EG-9.6 | `failed` can transition to `pending` ONLY if `retryCount < maxRetries` | S9.2 |

### 9.3 Budget Reservation Lifecycle

| ID | Requirement | Source |
|---|---|---|
| EG-9.7 | `ReservationStatus` MUST be union: `'reserved' | 'active' | 'retained' | 'released'` | S9.3 |
| EG-9.8 | `reserved` MUST transition to: `active`, `released` only | S9.3 |
| EG-9.9 | `active` MUST transition to: `retained`, `released` only | S9.3 |
| EG-9.10 | `retained` MUST transition to: `active` (reactivate), `released` only | S9.3 |
| EG-9.11 | `released` MUST have zero valid outgoing transitions (terminal) | S9.3 |
| EG-9.12 | Invalid reservation transitions MUST produce `INVALID_RESERVATION_TRANSITION` error | S9.3 |
| EG-9.13 | Reservation lifecycle supports reactivation: `active -> retained -> active` | S9.3 |
| EG-9.14 | Every reservation state can reach `released` (terminal) | S9.3 |
| EG-9.15 | `reserved` cannot directly transition to `retained` (must go through `active` first) | S9.3 |
| EG-9.16 | Reservation lifecycle has exactly 4 states | S9.3 |

**Totals: 16 requirements**

---

## Section 10: Rust Trait (v5 Alignment)

### Rust Enums

| ID | Requirement | Source |
|---|---|---|
| EG-10.1 | Rust `MissionState` enum MUST have 10 variants matching TypeScript: `Created`, `Planning`, `Executing`, `Reviewing`, `Paused`, `Completed`, `Failed`, `Degraded`, `Blocked`, `Cancelled` | S10 |
| EG-10.2 | Rust `TaskState` enum MUST have 6 variants: `Pending`, `Scheduled`, `Running`, `Completed`, `Failed`, `Cancelled` | S10 |
| EG-10.3 | Rust `BudgetDimension` enum MUST have variants: `Token`, `Deliberation` | S10 |
| EG-10.4 | Rust `AllocationMethod` enum MUST have variants: `Proportional`, `Equal`, `Explicit` | S10 |
| EG-10.5 | Rust `BranchFailurePolicy` enum MUST have variants: `Isolate`, `FailFast`, `Quorum` | S10 |
| EG-10.6 | Rust `MutabilityClass` enum MUST have variants: `ReadOnly`, `SideEffecting`, `Mutating`, `MutatingExternal` | S10 |
| EG-10.7 | Rust `ReservationStatus` enum MUST have variants: `Reserved`, `Active`, `Retained`, `Released` | S10 |

### Rust Error Type

| ID | Requirement | Source |
|---|---|---|
| EG-10.8 | Rust `ExecutionError` enum MUST derive `Debug, Clone` | S10 |
| EG-10.9 | Rust `ExecutionError` MUST have 17 variants matching TypeScript error codes | S10 |
| EG-10.10 | Rust `ExecutionError::InvalidMissionTransition` MUST have fields: `from: MissionState`, `to: MissionState`, `reason: String` | S10 |
| EG-10.11 | Rust `ExecutionError::InvalidTaskTransition` MUST have fields: `from: TaskState`, `to: TaskState`, `reason: String` | S10 |
| EG-10.12 | Rust `ExecutionError::InvalidReservationTransition` MUST have fields: `reservation_id: String`, `from: ReservationStatus`, `to: ReservationStatus` | S10 |
| EG-10.13 | Rust `ExecutionError::BudgetExhausted` MUST have fields: `dimension: BudgetDimension`, `requested: u64`, `available: u64` | S10 |
| EG-10.14 | Rust `ExecutionError::MissionDepthExceeded` MUST have fields: `max_depth: u32`, `requested_depth: u32` | S10 |
| EG-10.15 | Rust `ExecutionError::TaskLimitExceeded` MUST have fields: `max_tasks: u32`, `current_tasks: u32` | S10 |
| EG-10.16 | Rust `ExecutionError::DelegationDenied` MUST have fields: `reason: String`, `target_agent: String` | S10 |
| EG-10.17 | Rust `ExecutionError::DependencyUnmet` MUST have fields: `task_id: String`, `unmet: Vec<String>` | S10 |
| EG-10.18 | Rust `ExecutionError::RetryLimitExceeded` MUST have fields: `task_id: String`, `max_retries: u32` | S10 |
| EG-10.19 | Rust `ExecutionError::MissionTerminal` MUST have fields: `mission_id: String`, `state: MissionState` | S10 |

### Rust Trait

| ID | Requirement | Source |
|---|---|---|
| EG-10.20 | Rust trait `AgentExecutionGovernor` MUST be `Send + Sync` | S10 |
| EG-10.21 | Rust trait MUST define 15 async methods matching critical TypeScript interface methods | S10 |
| EG-10.22 | `create_mission` MUST take `(&self, ctx: &OperationContext, spec: &MissionSpec)` returning `Result<AgentMission, ExecutionError>` | S10 |
| EG-10.23 | `update_mission_state` MUST take `mission_id: &MissionId` and `transition: &MissionTransition` | S10 |
| EG-10.24 | `delegate_mission` MUST take `target_agent: &AgentId` and `constraints: Option<&DelegationConstraints>` | S10 |
| EG-10.25 | `complete_mission` MUST return `Result<MissionCompletionResult, ExecutionError>` | S10 |
| EG-10.26 | `cancel_mission` MUST take `reason: &str` and return `Result<(), ExecutionError>` | S10 |
| EG-10.27 | `create_task` MUST take `mission_id: &MissionId` and `spec: &TaskSpec` | S10 |
| EG-10.28 | `update_task_state` MUST take `task_id: &TaskId` and `transition: &TaskTransition` | S10 |
| EG-10.29 | `retry_task` MUST take `task_id: &TaskId` and `reason: &str` | S10 |
| EG-10.30 | `reserve_budget` MUST take `mission_id: &MissionId` and `request: &BudgetRequest` | S10 |
| EG-10.31 | `consume_budget` MUST take `reservation_id: &ReservationId` and `consumption: &BudgetConsumption` | S10 |
| EG-10.32 | `release_budget` MUST take `reservation_id: &ReservationId` and return `Result<(), ExecutionError>` | S10 |
| EG-10.33 | `schedule_wave` MUST take `mission_id: &MissionId` and `wave: &WaveSpec` | S10 |
| EG-10.34 | `get_schedule` MUST take `mission_id: &MissionId` and return `Result<ExecutionSchedule, ExecutionError>` | S10 |

**Totals: 34 requirements**

---

## Section 11: Invariants

| ID | Requirement | Source |
|---|---|---|
| EG-11.1 | State machine integrity: mission transitions MUST follow `VALID_MISSION_TRANSITIONS` exactly; violations produce `INVALID_MISSION_TRANSITION` | S11 Inv1 |
| EG-11.2 | Dependency satisfaction: task MUST NOT transition to `running` unless all dependencies are `completed`; violation produces `DEPENDENCY_UNMET` | S11 Inv2 |
| EG-11.3 | Budget non-negativity: `available = total - consumed - reserved`; reservation making `available < 0` produces `BUDGET_EXHAUSTED` | S11 Inv3 |
| EG-11.4 | Delegation budget decay: delegated budget = `parent_available * budgetFraction * budgetDecayFactor`; child budget MUST NOT exceed parent remaining | S11 Inv4 |
| EG-11.5 | Depth ceiling: `mission.depth` MUST NOT exceed `constraints.maxDepth` (default 5); violation produces `MISSION_DEPTH_EXCEEDED` | S11 Inv5 |
| EG-11.6 | Task ceiling: `mission.taskCount` MUST NOT exceed `constraints.maxTasks` (default 50); violation produces `TASK_LIMIT_EXCEEDED` | S11 Inv6 |
| EG-11.7 | Terminal irreversibility: `completed`, `failed`, `cancelled` have zero valid outgoing transitions; violations produce `MISSION_TERMINAL` or `INVALID_TASK_TRANSITION` | S11 Inv7 |
| EG-11.8 | Retry semantics: `retryTask` transitions failed->pending, increments `retryCount`; if `retryCount >= maxRetries` produces `RETRY_LIMIT_EXCEEDED`; full attempt history preserved | S11 Inv8 |
| EG-11.9 | Wave failure policy: `isolate` = failed tasks don't affect siblings; `fail-fast` = first failure cancels all pending/running; `quorum` = wave succeeds if `ceil(tasks.length / 2)` complete | S11 Inv9 |
| EG-11.10 | Audit completeness: every state transition MUST emit `AgentEventPayload` with: actor, reason, timestamp, previous state, new state; events are append-only | S11 Inv10 |
| EG-11.11 | Budget exhaustion escalation: when `available.tokens == 0 || available.deliberations == 0` in `executing` state, mission auto-transitions to `blocked` and emits `budget:exhausted` | S11 Inv11 |
| EG-11.12 | Session-scoped governance: all operations require valid `OperationContext`; operations without `agentId` or with insufficient clearance produce `GOVERNANCE_REFUSAL` | S11 Inv12 |
| EG-11.13 | Reservation state machine integrity: budget reservation transitions MUST follow SS9.3 table exactly; violations produce `INVALID_RESERVATION_TRANSITION` | S11 Inv13 |
| EG-11.14 | Unified rate limit inheritance: mission/task/budget/wave operations check `DEFAULT_RATE_LIMITS` before state mutation; per-mission limits may be stricter but MUST NOT weaken defaults | S11 Inv14 |

**Totals: 14 requirements**

---

## Section 12: Behavioral Contracts

### 12.1 Budget Allocation Methods

| ID | Requirement | Source |
|---|---|---|
| EG-12.1 | `proportional` allocation: budget distributed proportional to `estimatedTokens` relative to sum of all estimates in wave | S12.1 |
| EG-12.2 | `equal` allocation: budget divided equally among all tasks regardless of estimates | S12.1 |
| EG-12.3 | `explicit` allocation: budget allocated exactly as specified in `BudgetRequest.amount` per task | S12.1 |

### 12.2 Delegation Chain Semantics

| ID | Requirement | Source |
|---|---|---|
| EG-12.4 | Child mission MUST inherit `classification` from parent (cannot downgrade security) per SHARED_TYPES SS3 ordering | S12.2 |
| EG-12.5 | Child mission budget computed as `parent_available * budgetFraction * budgetDecayFactor` | S12.2 |
| EG-12.6 | Child mission MUST NOT exceed parent `deadline` | S12.2 |
| EG-12.7 | Child mission depth = `parent.depth + 1` | S12.2 |
| EG-12.8 | Delegation MUST appear in parent's `delegationChain` as `DelegationRecord` | S12.2 |
| EG-12.9 | Failure propagation depends on `failurePolicy` in `DelegationConstraints` | S12.2 |

### 12.3 Projected Exhaustion

| ID | Requirement | Source |
|---|---|---|
| EG-12.10 | `projectedExhaustion` MUST be computed as `now + (available / consumption_rate)` when consumption_rate > 0; null otherwise | S12.3 |
| EG-12.11 | `consumption_rate` MUST be tokens-per-millisecond averaged over last 10 consumption events | S12.3 |

**Totals: 11 requirements**

---

## Section 12 (continued): Concurrency

| ID | Requirement | Source |
|---|---|---|
| EG-12.12 | `maxConcurrency` governs how many tasks within a wave may be in `running` state simultaneously | S12.4 |
| EG-12.13 | When a task completes/fails, next `pending` task (by priority, then creation order) MUST be scheduled if concurrency slot available | S12.4 |

**Totals: 2 requirements**

---

## Section 13: Hook Event Integration

| ID | Requirement | Source |
|---|---|---|
| EG-13.1 | `mission:created` event MUST be registered in unified event system with value `mission:created` | S13 |
| EG-13.2 | `mission:state_changed` event MUST be registered in unified event system | S13 |
| EG-13.3 | `mission:completed` event MUST be registered in unified event system | S13 |
| EG-13.4 | `task:completed` event MUST be registered in unified event system | S13 |
| EG-13.5 | `budget:exhausted` event MUST be registered in unified event system | S13 |
| EG-13.6 | All events MUST carry `AgentEventPayload` structure from SS16.2 | S13 |
| EG-13.7 | All events MUST be dispatched through `AgentEventBus` from SS16.2, shared with memory/governance/lifecycle | S13 |

**Totals: 7 requirements**

---

## TC-21 Cross-Language Parity Gaps

| ID | Requirement | Source |
|---|---|---|
| EG-13.01 | Rust trait `AgentExecutionGovernor` MUST add async method `list_missions(&self, ctx: &OperationContext, filter: Option<&MissionFilter>) -> Result<Vec<AgentMission>, ExecutionError>` to match TypeScript `listMissions` (EG-2.4). Currently missing from Rust trait. | TC-21 Gap |
| EG-13.02 | Rust trait `AgentExecutionGovernor` MUST add async method `get_task(&self, ctx: &OperationContext, task_id: &TaskId) -> Result<AgentTask, ExecutionError>` to match TypeScript `getTask` (EG-2.10). Currently missing from Rust trait. | TC-21 Gap |
| EG-13.03 | Rust trait `AgentExecutionGovernor` MUST add async method `list_tasks(&self, ctx: &OperationContext, mission_id: &MissionId, filter: Option<&TaskFilter>) -> Result<Vec<AgentTask>, ExecutionError>` to match TypeScript `listTasks` (EG-2.11). Currently missing from Rust trait. | TC-21 Gap |
| EG-13.04 | Rust trait `AgentExecutionGovernor` MUST add async method `get_budget_state(&self, ctx: &OperationContext, mission_id: &MissionId) -> Result<BudgetState, ExecutionError>` to match TypeScript `getBudgetState` (EG-2.16). Currently missing from Rust trait. | TC-21 Gap |

> **NOTE:** These 4 methods exist in the TypeScript `AgentExecutionClient` interface but have no corresponding Rust trait methods. EG-10.21 states 15 methods; with these additions the count becomes 19.

**Totals: 4 requirements**

---

## Cross-Contract Type Definition Gaps

| ID | Requirement | Source |
|---|---|---|
| EG-14.01 | `BudgetDimension` type is used in the TypeScript interface (EG-5.1, EG-8.4) but is only defined as a Rust enum (EG-10.3). A TypeScript type definition MUST exist or be traced to SHARED_TYPES. | Type Gap |
| EG-14.02 | `AllocationMethod` type is used in the TypeScript interface (EG-5.3, EG-6.3) but is only defined as a Rust enum (EG-10.4). A TypeScript type definition MUST exist or be traced to SHARED_TYPES. | Type Gap |
| EG-14.03 | `BranchFailurePolicy` type is used in the TypeScript interface (EG-6.4) but is only defined as a Rust enum (EG-10.5). A TypeScript type definition MUST exist or be traced to SHARED_TYPES. | Type Gap |
| EG-14.04 | `MutabilityClass` type is used in the TypeScript interface (EG-4.2) but is only defined as a Rust enum (EG-10.6). A TypeScript type definition MUST exist or be traced to SHARED_TYPES. | Type Gap |
| EG-14.05 | `ReservationStatus` type is used in the TypeScript interface (EG-5.7, EG-9.7) but is only defined as a Rust enum (EG-10.7). A TypeScript type definition MUST exist or be traced to SHARED_TYPES. | Type Gap |

> **NOTE (P2-8):** Event payload data definitions for execution events (S7) are specified as event names only. The contract does not define structured payload types (e.g., `MissionCreatedData`, `TaskCompletedData`) with explicit field requirements. Each event payload MUST carry `AgentEventPayload` structure per EG-13.6, but the internal `data` fields are unspecified.

> **NOTE (P2-9):** Quorum semantics in EG-11.9 define success as `ceil(tasks.length / 2)` tasks completing. This is ambiguous for edge cases: (1) a wave with 1 task requires ceil(0.5) = 1, meaning quorum equals unanimity; (2) the behavior when exactly half complete but remaining are still running is unspecified (does it wait or succeed early?). The contract should clarify whether quorum is evaluated eagerly or only after all tasks reach terminal states.

**Totals: 5 requirements**

---

## Grand Total

| Section | Count |
|---|---|
| S1: Purpose & Scope | 6 |
| S2: Interface | 18 |
| S2: Events | 4 |
| S3: Mission Models | 53 |
| S3: Constraints & Budget | 10 |
| S4: Task Models | 21 |
| S5: Budget Models | 17 |
| S6: Scheduling Models | 12 |
| S7: Events | 18 |
| S8: Error Types | 17 |
| S9: State Machines | 16 |
| S10: Rust Trait | 34 |
| S11: Invariants | 14 |
| S12: Behavioral Contracts | 11 |
| S12: Concurrency | 2 |
| S13: Hook Event Integration | 7 |
| TC-21: Parity Gaps | 4 |
| Type Definition Gaps | 5 |
| **Grand Total** | **269** |
