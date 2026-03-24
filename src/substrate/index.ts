/**
 * Substrate facade -- composes all six subsystems into a frozen object.
 * S ref: §2 (Three-layer model), §25 (Execution Substrate), C-07 (Object.freeze)
 *
 * Phase: 2 (Execution Substrate)
 * Implements: createSubstrate() factory that assembles:
 *   - TaskScheduler (§25.1)
 *   - WorkerRuntime (§25.2)
 *   - CapabilityAdapterRegistry (§25.3)
 *   - LlmGateway (§25.4)
 *   - HeartbeatMonitor (§25.5)
 *   - ResourceAccounting (§25.6)
 *
 * Layer 1.5: Deterministic infrastructure hosting stochastic work.
 * The substrate executes what the orchestrator approves and reports results.
 */

// ─── Re-exports ───

export type {
  // §25.1: Task Scheduler
  PriorityPolicy,
  TaskQueueStatus,
  ExecutionMode,
  EnqueueRequest,
  QueuedTask,
  QueueStats,
  TaskScheduler,

  // §25.2: Worker Runtime
  WorkerResourceLimits,
  WorkerPoolConfig,
  WorkerStatus,
  WorkerInfo,
  WorkerPoolStatus,
  WorkerTaskResult,
  WorkerRuntime,

  // §25.3: Capability Adapters
  CapabilityType,
  CapabilityRequest,
  CapabilityResult,
  SandboxConfig,
  AdapterRegistration,
  CapabilityAdapterRegistry,

  // §25.4: LLM Gateway
  LlmRole,
  LlmContentBlock,
  LlmMessage,
  LlmToolDefinition,
  LlmRequest,
  LlmToolCall,
  LlmResponse,
  LlmStreamChunk,
  ProviderHealthStatus,
  ProviderHealthSnapshot,
  FailoverBudgetCheck,
  FailoverPolicy,
  LlmProviderConfig,
  LlmGateway,

  // §25.5: Heartbeat Monitor
  HeartbeatCheckResult,
  HeartbeatStatus,
  HeartbeatMonitor,

  // §25.6: Resource Accounting
  AccountingRecord,
  BudgetCheckResult,
  MissionConsumption,
  TenantConsumption,
  ResourceAccounting,

  // Facade
  SubstrateHealth,
  SubstrateConfig,
  Substrate,
} from './interfaces/substrate.js';

// ─── Implementation Imports ───

import type { DatabaseConnection } from '../kernel/interfaces/index.js';
import type {
  Result,
  OperationContext,
  AuditCreateInput,
} from '../kernel/interfaces/index.js';
import type {
  Substrate,
  SubstrateConfig,
  SubstrateHealth,
} from './interfaces/substrate.js';

import { createTaskScheduler } from './scheduler/task_scheduler.js';
import { createWorkerRuntime } from './workers/worker_runtime.js';
import { createCapabilityAdapterRegistry } from './adapters/capability_registry.js';
import { createLlmGateway } from './gateway/llm_gateway.js';
import { createHeartbeatMonitor } from './heartbeat/heartbeat_monitor.js';
import { createResourceAccounting } from './accounting/resource_accounting.js';
// ─── Error Constructors ───

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

// ─── Substrate Factory ───

/**
 * Minimal audit dependency for substrate subsystems.
 * Uses only the append method to keep coupling lightweight.
 * S ref: I-03 (every state mutation and its audit entry in same transaction)
 */
interface SubstrateAuditDep {
  append(conn: DatabaseConnection, input: AuditCreateInput): Result<unknown>;
}

/**
 * CF-010: Encryption dependency for LLM gateway request/response body encryption.
 * When provided, the LLM gateway encrypts request/response bodies before storage.
 */
interface SubstrateEncryptionDep {
  encrypt(plaintext: string): Result<string>;
  decrypt(ciphertext: string): Result<string>;
}

/**
 * Create a Substrate instance composing all six subsystems.
 * S ref: §2, §25, C-07 (Object.freeze on public API), I-03 (audit in same transaction)
 *
 * Returns a frozen Substrate object. The caller must call start() to
 * initialize workers and register providers.
 *
 * @param config Substrate configuration
 * @param audit Optional audit dependency for I-03 compliance. When provided,
 *   every state mutation in the substrate appends an audit entry in the same
 *   transaction as the mutation.
 * @param encryption Optional encryption for LLM gateway request/response body encryption (CF-010)
 */
export function createSubstrate(config: SubstrateConfig, audit?: SubstrateAuditDep, encryption?: SubstrateEncryptionDep): Result<Readonly<Substrate>> {
  const scheduler = createTaskScheduler(audit);
  const workers = createWorkerRuntime(audit);
  const adapters = createCapabilityAdapterRegistry();
  const gateway = createLlmGateway(audit, encryption);
  const heartbeat = createHeartbeatMonitor(audit);
  const accounting = createResourceAccounting(audit);

  /** §25: Start the substrate (initialize workers, register providers) */
  function start(conn: DatabaseConnection, ctx: OperationContext): Result<void> {
    // Initialize the worker pool
    const initResult = workers.initialize(conn, config.workerPool);
    if (!initResult.ok) return initResult;

    // Register all configured providers
    for (const providerConfig of config.providers) {
      const regResult = gateway.registerProvider(conn, ctx, providerConfig);
      if (!regResult.ok) return regResult;
    }

    return ok(undefined);
  }

  /** §32.4: Get substrate health */
  function health(conn: DatabaseConnection): Result<SubstrateHealth> {
    // Worker status
    const poolResult = workers.poolStatus(conn);
    if (!poolResult.ok) return poolResult;
    const pool = poolResult.value;

    // Queue stats
    const queueResult = scheduler.getStats(conn);
    if (!queueResult.ok) return queueResult;
    const queue = queueResult.value;

    // Provider health
    const providerResult = gateway.getProviderHealth(conn);
    if (!providerResult.ok) return providerResult;
    const providers = providerResult.value;

    const healthyCount = providers.filter((p) => p.status === 'healthy').length;
    const degradedCount = providers.filter((p) => p.status === 'degraded').length;
    const cooldownCount = providers.filter((p) => p.status === 'cooldown').length;
    const unavailableCount = providers.filter((p) => p.status === 'unavailable').length;

    // Determine overall status
    const workerExhaustion = pool.idle === 0 && pool.total > 0;
    const allProvidersBusy = providers.length > 0 && healthyCount === 0 && degradedCount === 0;

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (allProvidersBusy || pool.total === 0) {
      status = 'unhealthy';
    } else if (workerExhaustion || degradedCount > 0 || cooldownCount > 0) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return ok({
      status,
      workers: {
        total: pool.total,
        idle: pool.idle,
        allocated: pool.allocated,
        running: pool.running,
      },
      queue: {
        pending: queue.pending,
        running: queue.running,
        total: queue.total,
      },
      providers: {
        total: providers.length,
        healthy: healthyCount,
        degraded: degradedCount,
        cooldown: cooldownCount,
        unavailable: unavailableCount,
      },
      workerExhaustionWarning: workerExhaustion,
      allProvidersBusy,
    });
  }

  /** §25: Graceful shutdown */
  function shutdown(conn: DatabaseConnection, ctx: OperationContext, timeoutMs?: number): Result<void> {
    return workers.shutdown(conn, ctx, timeoutMs);
  }

  const substrate: Substrate = {
    scheduler,
    workers,
    adapters,
    gateway,
    heartbeat,
    accounting,

    start,
    health,
    shutdown,
  };

  return ok(Object.freeze(substrate));
}

/** Re-export migrations for the database lifecycle */
export { getPhase2Migrations } from './migration/002_substrate.js';
export { getTransportDeliberationMigration } from './migration/022_transport_deliberation.js';

/** Re-export transport layer */
export {
  createTransportEngine,
  createAnthropicAdapter,
  createAnthropicAdapterFromEnv,
  parseSSEStream,
  parseNDJSONStream,
} from './transport/index.js';

export type {
  TransportErrorCode,
  SSEEvent,
  TransportHttpRequest,
  TransportHttpResponse,
  DeliberationMetrics,
  TransportResult,
  TransportStreamResult,
  ProviderAdapter,
  TransportExecuteOptions,
  TransportEngine,
  UpdateProviderHealthFn,
  IsCircuitOpenFn,
  TransportEngineOptions,
} from './transport/index.js';

/** Re-export accounting deliberation helper */
export { recordAccountingDeliberation } from './accounting/resource_accounting.js';
