# Agent Execution Governance Contract v1.1.0

**Status:** RATIFIED DESIGN --- Pending Implementation
**Governing:** CDM v2.0 + Contract Compliance v2.0
**Scope:** Mission lifecycle, task orchestration, budget governance, and execution scheduling for AI agents
**Classification:** internal

> **Shared Types:** All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`. This contract does NOT redefine any shared type. Local types are contract-specific and not used by other contracts.

> **Governance Gate:** All mutation operations pass through GovernanceContext (SHARED_TYPES SS9) before execution.
> **Rate Gate:** Every public operation consumes the unified `DEFAULT_RATE_LIMITS` budget (SHARED_TYPES SS18) before mutating mission, task, reservation, or wave state.

---

## 1. Purpose

This contract defines how AI agents create, execute, and complete governed missions with resource budgets, task scheduling, delegation chains, and fairness guarantees. It builds on EGP internals, exposing mission/task lifecycle and budget management through agent-friendly interfaces. All operations are session-scoped, governance-gated, and produce immutable audit trails.

**Referenced shared types:** OperationContext (SS1.3), AgentSession (SS7), AgentSession-to-OperationContext mapping (SS8), GovernanceContext (SS9), GovernanceVerdict (SS10), AgentCapability (SS6), AgentTrustLevel (SS5), ClassificationLevel (SS3), AgentEvent/AgentEventPayload/AgentEventBus (SS16), branded IDs --- MissionId, TaskId, AgentId, TenantId, ReservationId, WaveId, ClaimId, EventId (SS1.1).

---

## 2. AgentExecutionClient Interface

```typescript
interface AgentExecutionClient {
  // Mission Lifecycle
  createMission(ctx: OperationContext, spec: MissionSpec): Promise<Result<AgentMission>>;
  updateMissionState(ctx: OperationContext, missionId: MissionId, transition: MissionTransition): Promise<Result<AgentMission>>;
  getMission(ctx: OperationContext, missionId: MissionId): Promise<Result<AgentMission>>;
  listMissions(ctx: OperationContext, filter?: MissionFilter): Promise<Result<AgentMission[]>>;
  delegateMission(ctx: OperationContext, missionId: MissionId, targetAgentId: AgentId, constraints?: DelegationConstraints): Promise<Result<AgentMission>>;
  completeMission(ctx: OperationContext, missionId: MissionId, outcome: MissionOutcome): Promise<Result<MissionCompletionResult>>;
  cancelMission(ctx: OperationContext, missionId: MissionId, reason: string): Promise<Result<void>>;

  // Task Management
  createTask(ctx: OperationContext, missionId: MissionId, spec: TaskSpec): Promise<Result<AgentTask>>;
  updateTaskState(ctx: OperationContext, taskId: TaskId, transition: TaskTransition): Promise<Result<AgentTask>>;
  getTask(ctx: OperationContext, taskId: TaskId): Promise<Result<AgentTask>>;
  listTasks(ctx: OperationContext, missionId: MissionId, filter?: TaskFilter): Promise<Result<AgentTask[]>>;
  retryTask(ctx: OperationContext, taskId: TaskId, reason: string): Promise<Result<AgentTask>>;

  // Budget Governance
  reserveBudget(ctx: OperationContext, missionId: MissionId, request: BudgetRequest): Promise<Result<BudgetReservation>>;
  consumeBudget(ctx: OperationContext, reservationId: ReservationId, consumption: BudgetConsumption): Promise<Result<BudgetState>>;
  releaseBudget(ctx: OperationContext, reservationId: ReservationId): Promise<Result<void>>;
  getBudgetState(ctx: OperationContext, missionId: MissionId): Promise<Result<BudgetState>>;

  // Scheduling
  scheduleWave(ctx: OperationContext, missionId: MissionId, wave: WaveSpec): Promise<Result<ExecutionWave>>;
  getSchedule(ctx: OperationContext, missionId: MissionId): Promise<Result<ExecutionSchedule>>;

  // Events --- uses unified event system (See SHARED_TYPES.md SS16)
  on(event: AgentEvent, handler: AgentEventHandler): string;
  off(subscriptionId: string): void;
}
```

**OperationContext** is derived from AgentSession via `sessionToContext()`. See `SHARED_TYPES.md` SS8.

---

## 3. Mission Data Models

### 3.1 MissionSpec

```typescript
interface MissionSpec {
  readonly objective: string;
  readonly successCriteria: readonly string[];
  readonly scopeBoundaries: readonly string[];
  readonly capabilities: readonly string[]; // validated against AgentCapability (SHARED_TYPES SS6)
  readonly parentMissionId?: MissionId;
  readonly constraints?: MissionConstraintsInput;
  readonly classification?: ClassificationLevel; // See SHARED_TYPES SS3
}
```

### 3.2 MissionConstraintsInput

```typescript
interface MissionConstraintsInput {
  readonly budget?: {
    readonly tokens?: number;
    readonly deliberations?: number;
  };
  readonly deadline?: string; // ISO-8601
  readonly maxTasks?: number;
  readonly maxDepth?: number;
  readonly maxChildren?: number;
}
```

### 3.3 AgentMission

```typescript
interface AgentMission {
  readonly id: MissionId;
  readonly tenantId: TenantId | null;
  readonly parentId: MissionId | null;
  readonly agentId: AgentId;
  readonly objective: string;
  readonly successCriteria: readonly string[];
  readonly scopeBoundaries: readonly string[];
  readonly capabilities: readonly string[];
  readonly state: MissionState;
  readonly planVersion: number;
  readonly delegationChain: readonly DelegationRecord[];
  readonly constraints: ResolvedMissionConstraints;
  readonly depth: number;
  readonly taskCount: number;
  readonly budgetConsumed: BudgetConsumed;
  readonly classification: ClassificationLevel; // See SHARED_TYPES SS3
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}
```

### 3.4 MissionState

```typescript
type MissionState =
  | 'created'
  | 'planning'
  | 'executing'
  | 'reviewing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'degraded'
  | 'blocked'
  | 'cancelled';
```

### 3.5 MissionTransition

```typescript
interface MissionTransition {
  readonly from: MissionState;
  readonly to: MissionState;
  readonly reason: string;
  readonly triggeredBy: AgentId;
}

const VALID_MISSION_TRANSITIONS: Record<MissionState, readonly MissionState[]> = {
  created: ['planning', 'cancelled'],
  planning: ['executing', 'cancelled'],
  executing: ['reviewing', 'paused', 'completed', 'failed', 'degraded', 'blocked', 'cancelled'],
  reviewing: ['executing', 'paused', 'cancelled'],
  paused: ['executing', 'reviewing', 'cancelled'],
  blocked: ['executing', 'cancelled'],
  degraded: ['executing', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
} as const;
```

### 3.6 MissionFilter

```typescript
interface MissionFilter {
  readonly state?: MissionState | readonly MissionState[];
  readonly agentId?: AgentId;
  readonly parentId?: MissionId | null;
  readonly classification?: ClassificationLevel; // See SHARED_TYPES SS3
  readonly createdAfter?: string;
  readonly limit?: number;
}
```

### 3.7 DelegationConstraints

```typescript
interface DelegationConstraints {
  readonly budgetFraction?: number; // 0.0-1.0, portion of parent budget allocated
  readonly maxDepth?: number;
  readonly capabilities?: readonly string[];
  readonly deadline?: string; // ISO-8601, must not exceed parent deadline
  readonly failurePolicy?: BranchFailurePolicy;
}
```

### 3.8 DelegationRecord

```typescript
interface DelegationRecord {
  readonly fromAgentId: AgentId;
  readonly toAgentId: AgentId;
  readonly delegatedAt: string;
  readonly constraints: DelegationConstraints;
}
```

### 3.9 MissionOutcome

```typescript
interface MissionOutcome {
  readonly success: boolean;
  readonly summary: string;
  readonly claimsProduced: readonly ClaimId[];
  readonly artifactsProduced: readonly string[];
  readonly budgetConsumed: BudgetConsumed;
}
```

### 3.10 MissionCompletionResult

```typescript
interface MissionCompletionResult {
  readonly missionId: MissionId;
  readonly finalState: 'completed' | 'failed' | 'degraded';
  readonly outcome: MissionOutcome;
  readonly duration: number; // milliseconds from creation to completion
  readonly tasksSummary: {
    readonly total: number;
    readonly completed: number;
    readonly failed: number;
    readonly cancelled: number;
  };
}
```

### 3.11 ResolvedMissionConstraints

```typescript
interface ResolvedMissionConstraints {
  readonly budget: {
    readonly tokens: number;
    readonly deliberations: number;
  };
  readonly deadline: string | null;
  readonly maxTasks: number;
  readonly maxDepth: number;
  readonly maxChildren: number;
  readonly budgetDecayFactor: number;
}

const MISSION_CONSTRAINT_DEFAULTS: ResolvedMissionConstraints = {
  budget: { tokens: 100_000, deliberations: 10 },
  deadline: null,
  maxTasks: 50,
  maxDepth: 5,
  maxChildren: 10,
  budgetDecayFactor: 0.3,
} as const;
```

### 3.12 BudgetConsumed

```typescript
interface BudgetConsumed {
  readonly tokens: number;
  readonly deliberations: number;
  readonly percentage: {
    readonly tokens: number;   // 0.0-100.0
    readonly deliberations: number; // 0.0-100.0
  };
}
```

---

## 4. Task Data Models

### 4.1 TaskSpec

```typescript
interface TaskSpec {
  readonly description: string;
  readonly mutabilityClass: MutabilityClass;
  readonly estimatedTokens?: number;
  readonly dependencies?: readonly TaskId[];
  readonly priority?: number; // 0-100, higher = more urgent
  readonly timeout?: number;  // milliseconds
  readonly maxRetries?: number;
}
```

### 4.2 AgentTask

```typescript
interface AgentTask {
  readonly id: TaskId;
  readonly missionId: MissionId;
  readonly agentId: AgentId;
  readonly description: string;
  readonly state: TaskState;
  readonly mutabilityClass: MutabilityClass;
  readonly priority: number;
  readonly dependencies: readonly TaskId[];
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly timeout: number;
  readonly budgetReservationId: ReservationId | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly failedAt: string | null;
  readonly failureReason: string | null;
}

const TASK_DEFAULTS = {
  priority: 50,
  timeout: 300_000, // 5 minutes
  maxRetries: 3,
} as const;
```

### 4.3 TaskState

```typescript
type TaskState = 'pending' | 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled';
```

### 4.4 TaskTransition

```typescript
interface TaskTransition {
  readonly from: TaskState;
  readonly to: TaskState;
  readonly reason?: string;
}

const VALID_TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  pending: ['scheduled', 'cancelled'],
  scheduled: ['running', 'pending', 'cancelled'],
  running: ['completed', 'failed'],
  failed: ['pending'], // retry path, only if retryCount < maxRetries
  completed: [],
  cancelled: [],
} as const;
```

### 4.5 TaskFilter

```typescript
interface TaskFilter {
  readonly state?: TaskState | readonly TaskState[];
  readonly mutabilityClass?: MutabilityClass;
  readonly priority?: {
    readonly min?: number;
    readonly max?: number;
  };
  readonly limit?: number;
}
```

---

## 5. Budget Governance Data Models

### 5.1 BudgetRequest

```typescript
interface BudgetRequest {
  readonly dimension: BudgetDimension;
  readonly amount: number;
  readonly allocationMethod: AllocationMethod;
  readonly purpose: string;
  readonly taskId?: TaskId;
}
```

### 5.2 BudgetReservation

```typescript
interface BudgetReservation {
  readonly id: ReservationId;
  readonly missionId: MissionId;
  readonly dimension: BudgetDimension;
  readonly reserved: number;
  readonly consumed: number;
  readonly status: ReservationStatus;
  readonly purpose: string;
  readonly taskId: TaskId | null;
  readonly createdAt: string;
  readonly activatedAt: string | null;
  readonly releasedAt: string | null;
}
```

### 5.3 BudgetConsumption

```typescript
interface BudgetConsumption {
  readonly amount: number;
  readonly operation: string;
  readonly taskId?: TaskId;
}
```

### 5.4 BudgetState

```typescript
interface BudgetState {
  readonly missionId: MissionId;
  readonly total: {
    readonly tokens: number;
    readonly deliberations: number;
  };
  readonly consumed: {
    readonly tokens: number;
    readonly deliberations: number;
  };
  readonly reserved: {
    readonly tokens: number;
    readonly deliberations: number;
  };
  readonly available: {
    readonly tokens: number;
    readonly deliberations: number;
  };
  readonly reservations: readonly BudgetReservation[];
  readonly overBudget: boolean;
  readonly projectedExhaustion: string | null; // ISO-8601 if trending to exhaust
}
```

---

## 6. Scheduling Data Models

### 6.1 WaveSpec

```typescript
interface WaveSpec {
  readonly name: string;
  readonly tasks: readonly TaskId[];
  readonly allocationMethod: AllocationMethod;
  readonly failurePolicy: BranchFailurePolicy;
  readonly maxConcurrency?: number;
}
```

### 6.2 ExecutionWave

```typescript
type WaveState = 'pending' | 'executing' | 'completed' | 'failed';

interface ExecutionWave {
  readonly id: WaveId;
  readonly missionId: MissionId;
  readonly name: string;
  readonly tasks: readonly TaskId[];
  readonly allocationMethod: AllocationMethod;
  readonly failurePolicy: BranchFailurePolicy;
  readonly maxConcurrency: number;
  readonly state: WaveState;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

const WAVE_DEFAULTS = {
  maxConcurrency: 5,
} as const;
```

### 6.3 ExecutionSchedule

```typescript
interface ExecutionSchedule {
  readonly missionId: MissionId;
  readonly waves: readonly ExecutionWave[];
  readonly currentWaveId: WaveId | null;
  readonly completedWaves: number;
  readonly totalWaves: number;
}
```

---

## 7. Execution Events

This contract uses the unified event system defined in `SHARED_TYPES.md` SS16. The following `AgentEvent` values are execution-domain events consumed and emitted by this contract:

- `mission:created`, `mission:state_changed`, `mission:delegated`, `mission:completed`, `mission:failed`, `mission:cancelled`
- `task:created`, `task:state_changed`, `task:completed`, `task:failed`, `task:retried`
- `budget:reserved`, `budget:consumed`, `budget:released`, `budget:exhausted`
- `wave:started`, `wave:completed`, `wave:failed`

All events are dispatched via `AgentEventBus` (SHARED_TYPES SS16.2) with `AgentEventPayload` structure. The wildcard `'*'` subscription captures all execution events.

---

## 8. Error Types

```typescript
type AgentExecutionError =
  | { code: 'INVALID_MISSION_TRANSITION'; from: MissionState; to: MissionState; reason: string }
  | { code: 'INVALID_TASK_TRANSITION'; from: TaskState; to: TaskState; reason: string }
  | { code: 'INVALID_RESERVATION_TRANSITION'; from: ReservationStatus; to: ReservationStatus; reason: string }
  | { code: 'BUDGET_EXHAUSTED'; dimension: BudgetDimension; requested: number; available: number }
  | { code: 'BUDGET_RESERVATION_FAILED'; reason: string }
  | { code: 'MISSION_DEPTH_EXCEEDED'; maxDepth: number; requestedDepth: number }
  | { code: 'TASK_LIMIT_EXCEEDED'; maxTasks: number; currentTasks: number }
  | { code: 'DELEGATION_DENIED'; reason: string; targetAgent: AgentId }
  | { code: 'DEPENDENCY_UNMET'; taskId: TaskId; unmetDependencies: readonly TaskId[] }
  | { code: 'WAVE_CONFLICT'; waveId: WaveId; reason: string }
  | { code: 'MISSION_NOT_FOUND'; missionId: MissionId }
  | { code: 'TASK_NOT_FOUND'; taskId: TaskId }
  | { code: 'RESERVATION_NOT_FOUND'; reservationId: ReservationId }
  | { code: 'DEADLINE_EXCEEDED'; missionId: MissionId; deadline: string }
  | { code: 'GOVERNANCE_REFUSAL'; reason: string; action: string }
  | { code: 'RETRY_LIMIT_EXCEEDED'; taskId: TaskId; maxRetries: number }
  | { code: 'MISSION_TERMINAL'; missionId: MissionId; state: MissionState };
```

---

## 9. State Machine Diagrams

### 9.1 Mission Lifecycle

```
CREATED --> PLANNING --> EXECUTING <--> REVIEWING
   |                        |    |         |
   |                        |    v         |
   |                        |  PAUSED <----+
   |                        |
   v                        v
CANCELLED              COMPLETED | FAILED | DEGRADED | BLOCKED
```

Valid transitions (exhaustive):

| From       | To                                                                  |
|------------|---------------------------------------------------------------------|
| created    | planning, cancelled                                                 |
| planning   | executing, cancelled                                                |
| executing  | reviewing, paused, completed, failed, degraded, blocked, cancelled  |
| reviewing  | executing, paused, cancelled                                        |
| paused     | executing, reviewing, cancelled                                     |
| blocked    | executing, cancelled                                                |
| degraded   | executing, cancelled                                                |
| completed  | (terminal)                                                          |
| failed     | (terminal)                                                          |
| cancelled  | (terminal)                                                          |

### 9.2 Task Lifecycle

```
PENDING <--> SCHEDULED --> RUNNING --> COMPLETED
  ^              |             |
  |              |             v
  +---(retry)---+-----------FAILED
  |              |
  v              v
CANCELLED    CANCELLED
```

Valid transitions (exhaustive):

| From      | To                                             | Condition                      |
|-----------|------------------------------------------------|--------------------------------|
| pending   | scheduled, cancelled                           |                                |
| scheduled | running, pending (deschedule), cancelled       |                                |
| running   | completed, failed                              |                                |
| failed    | pending                                        | retryCount < maxRetries        |
| completed | (terminal)                                     |                                |
| cancelled | (terminal)                                     |                                |

### 9.3 Budget Reservation Lifecycle

```
RESERVED --> ACTIVE --> RETAINED --> ACTIVE (reactivate)
   |            |           |
   v            v           v
RELEASED    RELEASED    RELEASED
```

Valid transitions:

| From     | To                  |
|----------|---------------------|
| reserved | active, released    |
| active   | retained, released  |
| retained | active, released    |
| released | (terminal)          |

Invalid transitions produce `INVALID_RESERVATION_TRANSITION`.

---

## 10. Rust Trait (v5 Alignment)

```rust
use std::future::Future;

// Branded IDs: See SHARED_TYPES SS25 for canonical Rust newtypes.
// This contract uses: MissionId, TaskId, AgentId, TenantId, ReservationId, WaveId, ClaimId, EventId.

/// Mission states
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MissionState {
    Created,
    Planning,
    Executing,
    Reviewing,
    Paused,
    Completed,
    Failed,
    Degraded,
    Blocked,
    Cancelled,
}

/// Task states
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskState {
    Pending,
    Scheduled,
    Running,
    Completed,
    Failed,
    Cancelled,
}

/// Budget dimension
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BudgetDimension {
    Token,
    Deliberation,
}

/// Allocation method for budget distribution
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AllocationMethod {
    Proportional,
    Equal,
    Explicit,
}

/// Branch failure policy for waves and delegations
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BranchFailurePolicy {
    Isolate,
    FailFast,
    Quorum,
}

/// Mutability classification for tasks
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MutabilityClass {
    ReadOnly,
    SideEffecting,
    Mutating,
    MutatingExternal,
}

/// Reservation status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReservationStatus {
    Reserved,
    Active,
    Retained,
    Released,
}

/// Execution errors
#[derive(Debug, Clone)]
pub enum ExecutionError {
    InvalidMissionTransition { from: MissionState, to: MissionState, reason: String },
    InvalidTaskTransition { from: TaskState, to: TaskState, reason: String },
    InvalidReservationTransition { from: ReservationStatus, to: ReservationStatus, reason: String },
    BudgetExhausted { dimension: BudgetDimension, requested: u64, available: u64 },
    BudgetReservationFailed { reason: String },
    MissionDepthExceeded { max_depth: u32, requested_depth: u32 },
    TaskLimitExceeded { max_tasks: u32, current_tasks: u32 },
    DelegationDenied { reason: String, target_agent: String },
    DependencyUnmet { task_id: String, unmet: Vec<String> },
    WaveConflict { wave_id: String, reason: String },
    MissionNotFound { mission_id: String },
    TaskNotFound { task_id: String },
    ReservationNotFound { reservation_id: String },
    DeadlineExceeded { mission_id: String, deadline: String },
    GovernanceRefusal { reason: String, action: String },
    RetryLimitExceeded { task_id: String, max_retries: u32 },
    MissionTerminal { mission_id: String, state: MissionState },
}

/// Core governance trait
/// OperationContext is an explicit argument on every method so governance,
/// clearance, and DEFAULT_RATE_LIMITS are structurally unavoidable.
/// ClassificationLevel: see SHARED_TYPES SS25.
pub trait AgentExecutionGovernor: Send + Sync {
    fn create_mission(&self, ctx: &OperationContext, spec: &MissionSpec) -> impl Future<Output = Result<AgentMission, ExecutionError>> + Send;
    fn update_mission_state(&self, ctx: &OperationContext, mission_id: &MissionId, transition: &MissionTransition) -> impl Future<Output = Result<AgentMission, ExecutionError>> + Send;
    fn get_mission(&self, ctx: &OperationContext, mission_id: &MissionId) -> impl Future<Output = Result<AgentMission, ExecutionError>> + Send;
    fn delegate_mission(&self, ctx: &OperationContext, mission_id: &MissionId, target_agent: &AgentId, constraints: Option<&DelegationConstraints>) -> impl Future<Output = Result<AgentMission, ExecutionError>> + Send;
    fn complete_mission(&self, ctx: &OperationContext, mission_id: &MissionId, outcome: &MissionOutcome) -> impl Future<Output = Result<MissionCompletionResult, ExecutionError>> + Send;
    fn cancel_mission(&self, ctx: &OperationContext, mission_id: &MissionId, reason: &str) -> impl Future<Output = Result<(), ExecutionError>> + Send;
    fn create_task(&self, ctx: &OperationContext, mission_id: &MissionId, spec: &TaskSpec) -> impl Future<Output = Result<AgentTask, ExecutionError>> + Send;
    fn update_task_state(&self, ctx: &OperationContext, task_id: &TaskId, transition: &TaskTransition) -> impl Future<Output = Result<AgentTask, ExecutionError>> + Send;
    fn retry_task(&self, ctx: &OperationContext, task_id: &TaskId, reason: &str) -> impl Future<Output = Result<AgentTask, ExecutionError>> + Send;
    fn reserve_budget(&self, ctx: &OperationContext, mission_id: &MissionId, request: &BudgetRequest) -> impl Future<Output = Result<BudgetReservation, ExecutionError>> + Send;
    fn consume_budget(&self, ctx: &OperationContext, reservation_id: &ReservationId, consumption: &BudgetConsumption) -> impl Future<Output = Result<BudgetState, ExecutionError>> + Send;
    fn release_budget(&self, ctx: &OperationContext, reservation_id: &ReservationId) -> impl Future<Output = Result<(), ExecutionError>> + Send;
    fn schedule_wave(&self, ctx: &OperationContext, mission_id: &MissionId, wave: &WaveSpec) -> impl Future<Output = Result<ExecutionWave, ExecutionError>> + Send;
    fn get_schedule(&self, ctx: &OperationContext, mission_id: &MissionId) -> impl Future<Output = Result<ExecutionSchedule, ExecutionError>> + Send;
}
```

---

## 11. Invariants

1. **State machine integrity.** Mission state transitions follow `VALID_MISSION_TRANSITIONS` exactly. Any transition not in the table produces `INVALID_MISSION_TRANSITION`.

2. **Dependency satisfaction.** A task cannot transition to `running` unless all entries in its `dependencies` array are in state `completed`. Violation produces `DEPENDENCY_UNMET`.

3. **Budget non-negativity.** `available = total - consumed - reserved`. A reservation request that would make `available < 0` in the requested dimension produces `BUDGET_EXHAUSTED`.

4. **Delegation budget decay.** Delegated mission budget = `parent_available * budgetFraction * budgetDecayFactor`. Child budget can never exceed parent remaining budget.

5. **Depth ceiling.** `mission.depth` cannot exceed `constraints.maxDepth` (default 5). `delegateMission` with depth >= maxDepth produces `MISSION_DEPTH_EXCEEDED`.

6. **Task ceiling.** `mission.taskCount` cannot exceed `constraints.maxTasks` (default 50). `createTask` beyond this limit produces `TASK_LIMIT_EXCEEDED`.

7. **Terminal irreversibility.** States `completed`, `failed`, and `cancelled` have zero valid outgoing transitions. Any attempt produces `MISSION_TERMINAL` or `INVALID_TASK_TRANSITION`.

8. **Retry semantics.** `retryTask` transitions failed task to `pending`, increments `retryCount`. If `retryCount >= maxRetries`, produces `RETRY_LIMIT_EXCEEDED`. Full attempt history is preserved.

9. **Wave failure policy enforcement.** `isolate`: failed tasks do not affect siblings. `fail-fast`: first failure cancels all pending/running tasks in wave. `quorum`: wave succeeds if `ceil(tasks.length / 2)` tasks complete successfully.

10. **Audit completeness.** Every state transition (mission, task, reservation) emits an `AgentEventPayload` (SHARED_TYPES SS16.2) containing: actor (`AgentId`), reason (string), timestamp (ISO-8601), previous state, new state. Events are append-only.

11. **Budget exhaustion escalation.** When `available.tokens == 0 || available.deliberations == 0` and mission is in `executing` state, mission automatically transitions to `blocked` and emits `budget:exhausted`.

12. **Session-scoped governance.** All operations require valid `OperationContext` (SHARED_TYPES SS1.3). Operations without `agentId` or with insufficient `clearanceLevel` for the mission's `classification` produce `GOVERNANCE_REFUSAL`.

13. **Reservation state machine integrity.** Budget reservation transitions follow SS9.3 table exactly. Any transition not in the table produces `INVALID_RESERVATION_TRANSITION`.

14. **Unified rate limit inheritance.** Mission, task, budget, and wave operations all check `DEFAULT_RATE_LIMITS` before state mutation. Per-mission limits may be stricter, but cannot weaken per-agent, per-session, per-adapter, or global defaults.

---

## 12. Behavioral Contracts

### 12.1 Budget Allocation Methods

- **proportional**: Budget distributed to tasks proportional to their `estimatedTokens` relative to sum of all estimates in the wave.
- **equal**: Budget divided equally among all tasks in the wave, regardless of estimates.
- **explicit**: Budget allocated exactly as specified in the `BudgetRequest.amount` field per task.

### 12.2 Delegation Chain Semantics

Delegation creates a parent-child mission relationship. The child mission:
- Inherits `classification` from parent (cannot downgrade security). See `SHARED_TYPES.md` SS3 for classification ordering.
- Receives budget computed as `parent_available * budgetFraction * budgetDecayFactor`.
- Cannot exceed parent `deadline`.
- Has `depth = parent.depth + 1`.
- Appears in parent's `delegationChain` as a `DelegationRecord`.
- Failure propagation depends on `failurePolicy` in `DelegationConstraints`.

### 12.3 Projected Exhaustion

`BudgetState.projectedExhaustion` is computed as:
```
if consumption_rate > 0:
  projectedExhaustion = now + (available / consumption_rate)
else:
  projectedExhaustion = null
```

Where `consumption_rate` is tokens-per-millisecond averaged over last 10 consumption events.

### 12.4 Concurrency within Waves

`maxConcurrency` governs how many tasks within a wave may be in `running` state simultaneously. When a task completes or fails, the next `pending` task (by priority, then creation order) is scheduled if concurrency slot is available.

---

## 13. Hook Event Integration

Execution events integrate with the unified event system (SHARED_TYPES SS16):

| Execution Event       | AgentEvent Value (SS16.1) |
|-----------------------|---------------------------|
| mission:created       | `mission:created`         |
| mission:state_changed | `mission:state_changed`   |
| mission:completed     | `mission:completed`       |
| task:completed        | `task:completed`          |
| budget:exhausted      | `budget:exhausted`        |

All events carry the `AgentEventPayload` structure (SS16.2) and are dispatched through `AgentEventBus` (SS16.2), the same bus used by memory, governance, and lifecycle events.

---

**End of Contract**
