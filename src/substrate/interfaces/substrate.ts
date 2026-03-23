/**
 * Execution Substrate interface types.
 * S ref: S25 (Execution Substrate), S2 (Three-layer model), C-07 (Object.freeze)
 *
 * Phase: 2 (Execution Substrate)
 * Implements: All TypeScript interfaces for the six substrate subsystems:
 *   S25.1 (Task Scheduler), S25.2 (Worker Runtime), S25.3 (Capability Adapters),
 *   S25.4 (LLM Gateway), S25.5 (Heartbeat Protocol), S25.6 (Resource Accounting)
 *
 * Layer 1.5: Deterministic infrastructure hosting stochastic work.
 * The substrate executes what the orchestrator approves and reports results.
 */

import type {
  Result, TaskId, MissionId, TenantId, AgentId, OperationContext,
  DatabaseConnection,
} from '../../kernel/interfaces/index.js';

// ============================================================================
// S25.1: Task Scheduler
// ============================================================================

/** S25.1: Task priority policy */
export type PriorityPolicy = 'fifo' | 'priority' | 'deadline';

/** S25.1: Task status within the active queue */
export type TaskQueueStatus = 'PENDING' | 'SCHEDULED' | 'RUNNING';

/** S25.1: Task execution mode */
export type ExecutionMode = 'deterministic' | 'stochastic' | 'hybrid';

/** S25.1: Enqueue request for a new task */
export interface EnqueueRequest {
  readonly taskId: TaskId;
  readonly missionId: MissionId;
  readonly tenantId: TenantId | null;
  readonly agentId: AgentId;
  readonly priority: number;
  readonly executionMode: ExecutionMode;
  readonly estimatedTokens?: number;
  readonly capabilitiesRequired: readonly CapabilityType[];
  readonly payload: Record<string, unknown>;
  readonly maxRetries?: number;
  readonly timeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
}

/** S25.1: A task as returned from poll() */
export interface QueuedTask {
  readonly taskId: TaskId;
  readonly missionId: MissionId;
  readonly tenantId: TenantId | null;
  readonly agentId: AgentId;
  readonly priority: number;
  readonly executionMode: ExecutionMode;
  readonly estimatedTokens: number | null;
  readonly capabilitiesRequired: readonly CapabilityType[];
  readonly payload: Record<string, unknown>;
  readonly maxRetries: number;
  readonly timeoutMs: number;
  readonly heartbeatIntervalMs: number;
  readonly retryCount: number;
}

/** S25.1, S32.4: Queue statistics for monitoring and backpressure */
export interface QueueStats {
  readonly pending: number;
  readonly scheduled: number;
  readonly running: number;
  readonly total: number;
}

/**
 * S25.1: Task scheduler -- SQLite-backed priority queue.
 * Enforces: I-05 (transactional), I-14 (predictable latency)
 * Defends: FM-20 (via heartbeat columns)
 */
export interface TaskScheduler {
  /** S25.1: Enqueue a task for execution */
  enqueue(conn: DatabaseConnection, ctx: OperationContext, request: EnqueueRequest): Result<void>;
  /** S25.1: Poll for the next available task */
  poll(conn: DatabaseConnection, policy: PriorityPolicy): Result<QueuedTask | null>;
  /** S25.1: Mark a task as running with assigned worker */
  markRunning(conn: DatabaseConnection, ctx: OperationContext, taskId: TaskId, workerId: string): Result<void>;
  /** S25.1: Complete a task (archive + remove from queue) */
  complete(conn: DatabaseConnection, ctx: OperationContext, taskId: TaskId): Result<void>;
  /** S25.1: Fail a task (archive with error details) */
  fail(conn: DatabaseConnection, ctx: OperationContext, taskId: TaskId, errorCode: string, errorMessage: string, errorDetail?: string): Result<void>;
  /** S25.1: Cancel a task */
  cancel(conn: DatabaseConnection, ctx: OperationContext, taskId: TaskId): Result<void>;
  /** S25.7: Bulk-cancel all tasks for a mission */
  cancelMissionTasks(conn: DatabaseConnection, ctx: OperationContext, missionId: MissionId): Result<{ cancelled: number }>;
  /** S32.4: Get queue statistics */
  getStats(conn: DatabaseConnection): Result<QueueStats>;
  /** S25.7: Cleanup stale tasks */
  cleanup(conn: DatabaseConnection, ctx: OperationContext): Result<{ archived: number; orphansCancelled: number }>;
}

// ============================================================================
// S25.2: Worker Runtime
// ============================================================================

/** S25.2, I-12: Worker resource limits (Node.js worker_threads ResourceLimits) */
export interface WorkerResourceLimits {
  readonly maxOldGenerationSizeMb: number;
  readonly maxYoungGenerationSizeMb: number;
  readonly codeRangeSizeMb: number;
}

/** S25.2: Worker pool configuration */
export interface WorkerPoolConfig {
  readonly poolSize: number;
  readonly resourceLimits: WorkerResourceLimits;
  readonly workerScript: string;
}

/** S25.2: Worker lifecycle states */
export type WorkerStatus = 'IDLE' | 'ALLOCATED' | 'RUNNING';

/** S25.2: Worker instance information */
export interface WorkerInfo {
  readonly workerId: string;
  readonly threadId: number | null;
  readonly status: WorkerStatus;
  readonly currentTaskId: TaskId | null;
  readonly taskCount: number;
  readonly allocatedAt: string | null;
  readonly createdAt: string;
}

/** S25.2: Worker pool status */
export interface WorkerPoolStatus {
  readonly total: number;
  readonly idle: number;
  readonly allocated: number;
  readonly running: number;
}

/** S25.2: Result from a completed worker task */
export interface WorkerTaskResult {
  readonly taskId: TaskId;
  readonly success: boolean;
  readonly output: unknown;
  readonly tokensConsumed: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly providerInputTokens?: number;
    readonly providerOutputTokens?: number;
  };
  readonly wallClockMs: number;
  readonly capabilitiesUsed: ReadonlyArray<{ readonly type: CapabilityType; readonly costTokens: number }>;
  readonly artifactsProduced: number;
  readonly artifactsBytes: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

/**
 * S25.2: Worker runtime -- fixed pool with replacement.
 * Enforces: I-12 (resourceLimits), I-07 (isolation)
 * Defends: FM-20 (crash recovery + replacement)
 */
export interface WorkerRuntime {
  /** S25.2: Initialize the worker pool */
  initialize(conn: DatabaseConnection, config: WorkerPoolConfig): Result<void>;
  /** S25.2: Allocate an idle worker for a task */
  allocate(conn: DatabaseConnection, ctx: OperationContext, taskId: TaskId): Result<string>;
  /** S25.2: Dispatch a task to an allocated worker */
  dispatch(conn: DatabaseConnection, ctx: OperationContext, workerId: string, task: QueuedTask): Result<void>;
  /** S25.2: Release a worker back to IDLE */
  release(conn: DatabaseConnection, ctx: OperationContext, workerId: string): Result<void>;
  /** S25.2: Terminate and replace a worker */
  terminate(conn: DatabaseConnection, ctx: OperationContext, workerId: string): Result<void>;
  /** S25.2: Get all worker info */
  getWorkers(conn: DatabaseConnection): Result<readonly WorkerInfo[]>;
  /** S25.2: Get pool status summary */
  poolStatus(conn: DatabaseConnection): Result<WorkerPoolStatus>;
  /** S25.2: Graceful shutdown of all workers */
  shutdown(conn: DatabaseConnection, ctx: OperationContext, timeoutMs?: number): Result<void>;
}

// ============================================================================
// S25.3: Capability Adapter Registry
// ============================================================================

/** S25.3: Seven capability types per specification */
export type CapabilityType = 'web_search' | 'web_fetch' | 'code_execute' | 'data_query' | 'file_read' | 'file_write' | 'api_call';

/** S25.3: Capability execution request */
export interface CapabilityRequest {
  readonly type: CapabilityType;
  readonly params: Record<string, unknown>;
  readonly missionId: MissionId;
  readonly taskId: TaskId;
  readonly workspaceDir: string;
  readonly timeoutMs: number;
}

/** S25.3: Capability execution result */
export interface CapabilityResult {
  readonly result: unknown;
  readonly resourcesConsumed: {
    readonly wallClockMs: number;
    readonly tokensUsed: number;
    readonly bytesRead: number;
    readonly bytesWritten: number;
  };
}

/** S25.3, I-12: Sandbox configuration per capability type */
export interface SandboxConfig {
  readonly type: CapabilityType;
  readonly allowedPaths: readonly string[];
  readonly networkAllowed: boolean;
  readonly maxExecutionMs: number;
  readonly resourceLimits: WorkerResourceLimits;
}

/** S25.3: Adapter registration metadata */
export interface AdapterRegistration {
  readonly type: CapabilityType;
  readonly version: string;
  readonly sandboxConfig: SandboxConfig;
}

/**
 * S25.3: Capability adapter registry.
 * Enforces: I-12 (sandbox), I-22 (immutable capabilities)
 * Defends: FM-09 (unauthorized tool execution)
 */
export interface CapabilityAdapterRegistry {
  /** S25.3: Execute a capability in sandbox */
  execute(conn: DatabaseConnection, ctx: OperationContext, request: CapabilityRequest): Result<CapabilityResult>;
  /** S25.3: Validate an adapter registration */
  validateRegistration(registration: AdapterRegistration): Result<void>;
  /** S25.3: Get all supported capability types */
  getSupportedCapabilities(): Result<readonly CapabilityType[]>;
  /** S25.3: Get sandbox config for a capability type */
  getSandboxConfig(type: CapabilityType): Result<SandboxConfig>;
}

// ============================================================================
// S25.4: LLM Gateway (ASYNC -- the ONE async interface)
// ============================================================================

/** S25.4: LLM message roles */
export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

/** S25.4, FPD-4: Rich content blocks for provider independence */
export type LlmContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mediaType: string; readonly data: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly type: 'tool_result'; readonly toolUseId: string; readonly content: string; readonly isError?: boolean };

/** S25.4: LLM message */
export interface LlmMessage {
  readonly role: LlmRole;
  readonly content: string | readonly LlmContentBlock[];
}

/** S25.4: LLM tool definition */
export interface LlmToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/** S25.4: LLM request */
export interface LlmRequest {
  readonly model: string;
  readonly messages: readonly LlmMessage[];
  readonly tools?: readonly LlmToolDefinition[];
  readonly maxTokens: number;
  readonly temperature?: number;
  readonly systemPrompt?: string;
  readonly metadata?: {
    readonly taskId: TaskId;
    readonly missionId: MissionId;
    readonly tenantId: TenantId | null;
  };
}

/** S25.4, SD-04: Parsed tool call */
export interface LlmToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/** S25.4: LLM response */
export interface LlmResponse {
  readonly content: string | readonly LlmContentBlock[];
  readonly toolCalls: readonly LlmToolCall[];
  readonly finishReason: 'stop' | 'length' | 'tool_use' | 'content_filter';
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly providerInputTokens?: number;
    readonly providerOutputTokens?: number;
  };
  readonly model: string;
  readonly providerId: string;
  readonly latencyMs: number;
}

/** S27, FPD-2: Discriminated union stream chunks */
export type LlmStreamChunk =
  | { readonly type: 'content_delta'; readonly delta: string }
  | { readonly type: 'tool_call_delta'; readonly toolCallId: string; readonly name?: string; readonly inputDelta: string }
  | { readonly type: 'usage'; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly type: 'done'; readonly finishReason: 'stop' | 'length' | 'tool_use' | 'content_filter' }
  | { readonly type: 'error'; readonly error: string };

/** DL-1, FPD-6: Four-state provider health */
export type ProviderHealthStatus = 'healthy' | 'degraded' | 'cooldown' | 'unavailable';

/** S25.4: Provider health snapshot */
export interface ProviderHealthSnapshot {
  readonly providerId: string;
  readonly status: ProviderHealthStatus;
  readonly consecutiveFailures: number;
  readonly errorRate5min: number;
  readonly avgLatencyMs: number;
  readonly totalRequests: number;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly cooldownUntil: string | null;
}

/** FM-12: Failover budget check result */
export interface FailoverBudgetCheck {
  readonly allowed: boolean;
  readonly reason?: string;
}

/** FM-12, DL-3: Failover policy */
export type FailoverPolicy = 'degrade' | 'allow-overdraft' | 'block';

/** S25.4, IP-1: Provider configuration */
export interface LlmProviderConfig {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly models: readonly string[];
  readonly apiKeyEnvVar: string;
  readonly maxConcurrent?: number;
  readonly costPerInputToken?: number;
  readonly costPerOutputToken?: number;
}

/**
 * S25.4: LLM Gateway -- the ONLY async interface in the substrate.
 * SD-02/FPD-1: HTTP is inherently async. Blocking kills heartbeat.
 * Enforces: I-04 (provider independence), I-25 (deterministic replay)
 * Defends: FM-02 (cost explosion), FM-06 (provider dependency), FM-12 (failover cascade)
 */
export interface LlmGateway {
  /** S25.4: Register a provider */
  registerProvider(conn: DatabaseConnection, ctx: OperationContext, config: LlmProviderConfig): Result<void>;
  /** S25.4: Send LLM request (ASYNC) */
  request(conn: DatabaseConnection, ctx: OperationContext, request: LlmRequest): Promise<Result<LlmResponse>>;
  /** S25.4, S27: Send streaming LLM request (ASYNC) */
  requestStream(conn: DatabaseConnection, ctx: OperationContext, request: LlmRequest): Promise<Result<AsyncIterable<LlmStreamChunk>>>;
  /** DL-1: Get all provider health snapshots */
  getProviderHealth(conn: DatabaseConnection): Result<readonly ProviderHealthSnapshot[]>;
  /** I-16: Check if any healthy provider exists */
  hasHealthyProvider(conn: DatabaseConnection): Result<boolean>;
  /** FM-12: Check failover budget before switching providers */
  checkFailoverBudget(conn: DatabaseConnection, missionId: MissionId, estimatedTokens: number, failoverPolicy: FailoverPolicy): Result<FailoverBudgetCheck>;
}

// ============================================================================
// S25.5: Heartbeat Monitor
// ============================================================================

/** S25.5: Heartbeat check cycle result */
export interface HeartbeatCheckResult {
  readonly warned: readonly TaskId[];
  readonly notified: readonly TaskId[];
  readonly killed: readonly TaskId[];
}

/** S25.5: Status of heartbeat for a specific task */
export interface HeartbeatStatus {
  readonly taskId: TaskId;
  readonly workerId: string;
  readonly missedHeartbeats: number;
  readonly lastHeartbeatAt: string | null;
  readonly heartbeatIntervalMs: number;
}

/**
 * S25.5: Heartbeat monitor -- detects hung workers.
 * Enforces: I-12 (execution timeout as defense-in-depth)
 * Defends: FM-20 (infinite loops / hung workers)
 */
export interface HeartbeatMonitor {
  /** S25.5: Receive heartbeat from a running task */
  receiveHeartbeat(conn: DatabaseConnection, taskId: TaskId, workerId: string): Result<void>;
  /** S25.5: Check all running tasks for missed heartbeats */
  checkCycle(conn: DatabaseConnection, ctx: OperationContext): Result<HeartbeatCheckResult>;
  /** S25.5: Reset heartbeat counter for a task */
  resetHeartbeat(conn: DatabaseConnection, taskId: TaskId): Result<void>;
  /** S25.5: Get heartbeat status for a task */
  getStatus(conn: DatabaseConnection, taskId: TaskId): Result<HeartbeatStatus | null>;
}

// ============================================================================
// S25.6: Resource Accounting
// ============================================================================

/** S25.6: Accounting record for a task interaction */
export interface AccountingRecord {
  readonly taskId: TaskId;
  readonly missionId: MissionId;
  readonly tenantId: TenantId | null;
  readonly agentId: AgentId;
  readonly modelId: string | null;
  readonly interactionType: 'llm' | 'capability' | 'embedding';
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly providerInputTokens?: number;
  readonly providerOutputTokens?: number;
  readonly wallClockMs: number;
  readonly artifactsBytes: number;
  readonly capabilitiesUsed: ReadonlyArray<{ readonly type: CapabilityType; readonly costTokens: number }>;
}

/** S11, FM-02: Budget check result */
export interface BudgetCheckResult {
  readonly allowed: boolean;
  readonly remainingTokens: number;
  readonly consumedTokens: number;
  readonly budgetLimit: number;
  readonly reason?: string;
}

/** S25.6: Mission consumption aggregation */
export interface MissionConsumption {
  readonly missionId: MissionId;
  readonly totalEffectiveInputTokens: number;
  readonly totalEffectiveOutputTokens: number;
  readonly totalWallClockMs: number;
  readonly totalArtifactsBytes: number;
  readonly interactionCount: number;
}

/** S25.6: Tenant consumption aggregation */
export interface TenantConsumption {
  readonly tenantId: TenantId;
  readonly totalEffectiveInputTokens: number;
  readonly totalEffectiveOutputTokens: number;
  readonly totalInteractions: number;
}

/**
 * S25.6: Resource accounting -- per-task token/time/compute tracking.
 * Enforces: I-03 (audit in same transaction)
 * Defends: FM-02 (cost explosion), FM-11 (observability overhead < 2%)
 */
export interface ResourceAccounting {
  /** S25.6: Record a task interaction's resource consumption */
  record(conn: DatabaseConnection, ctx: OperationContext, record: AccountingRecord): Result<void>;
  /** S11, FM-02: Check if estimated tokens would exceed mission budget */
  checkBudget(conn: DatabaseConnection, missionId: MissionId, estimatedTokens: number): Result<BudgetCheckResult>;
  /** S25.6: Get total consumption for a mission */
  getMissionConsumption(conn: DatabaseConnection, missionId: MissionId): Result<MissionConsumption>;
  /** S25.6: Get total consumption for a tenant */
  getTenantConsumption(conn: DatabaseConnection, tenantId: TenantId): Result<TenantConsumption>;
}

// ============================================================================
// S2, C-07: Substrate Facade
// ============================================================================

/** S32.4: Substrate health status */
export interface SubstrateHealth {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly workers: { readonly total: number; readonly idle: number; readonly allocated: number; readonly running: number };
  readonly queue: { readonly pending: number; readonly running: number; readonly total: number };
  readonly providers: { readonly total: number; readonly healthy: number; readonly degraded: number; readonly cooldown: number; readonly unavailable: number };
  readonly workerExhaustionWarning: boolean;
  readonly allProvidersBusy: boolean;
}

/** S25: Substrate configuration */
export interface SubstrateConfig {
  readonly workerPool: WorkerPoolConfig;
  readonly pollingIntervalMs?: number;
  readonly providers: readonly LlmProviderConfig[];
}

/**
 * S2, C-07: Substrate facade composing all six subsystems.
 * Object.freeze'd per C-07. Layer 1.5 of the cognitive model.
 */
export interface Substrate {
  readonly scheduler: TaskScheduler;
  readonly workers: WorkerRuntime;
  readonly adapters: CapabilityAdapterRegistry;
  readonly gateway: LlmGateway;
  readonly heartbeat: HeartbeatMonitor;
  readonly accounting: ResourceAccounting;

  /** S25: Start the substrate (initialize workers, register providers) */
  start(conn: DatabaseConnection, ctx: OperationContext): Result<void>;
  /** S32.4: Get substrate health */
  health(conn: DatabaseConnection): Result<SubstrateHealth>;
  /** S25: Graceful shutdown */
  shutdown(conn: DatabaseConnection, ctx: OperationContext, timeoutMs?: number): Result<void>;
}
