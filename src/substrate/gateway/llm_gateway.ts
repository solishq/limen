/**
 * LLM Gateway implementation.
 * S ref: §25.4 (LLM Gateway), DL-1 (Provider Routing), I-04 (Provider Independence)
 *
 * Phase: 2 (Execution Substrate)
 * Implements: Provider-independent LLM gateway with circuit breaker pattern,
 *             4-state health tracking, cost accounting, retry logic, and streaming.
 *             This is the ONLY async interface in the substrate (FPD-1/SD-02).
 *
 * Invariants enforced: I-01 (no SDK deps), I-03 (audit), I-04 (provider independence),
 *                      I-05 (transactional), I-25 (deterministic replay logging)
 * Failure modes defended: FM-02 (cost explosion), FM-06 (provider dependency),
 *                         FM-12 (failover cascade)
 *
 * ASYNC interface. request() and requestStream() return Promise<Result<T>>.
 * All other methods are SYNC returning Result<T>.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '../../kernel/interfaces/index.js';
import type {
  Result,
  MissionId,
  KernelError,
  OperationContext,
  AuditCreateInput,
} from '../../kernel/interfaces/index.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type {
  TransportEngine,
  ProviderAdapter,
  TransportResult,
  TransportStreamResult,
  DeliberationMetrics,
} from '../transport/transport_types.js';

/**
 * Minimal audit dependency. Uses only the append method to keep coupling lightweight.
 * S ref: I-03 (every state mutation and its audit entry in same transaction)
 */
interface AuditDep {
  append(conn: DatabaseConnection, input: AuditCreateInput): Result<unknown>;
}

/**
 * Transport dependency — when provided, the gateway delegates HTTP calls to
 * the transport engine + provider adapter pair.
 * S ref: §25.4 Phase 5A integration
 */
interface TransportDep {
  readonly engine: TransportEngine;
  readonly adapters: ReadonlyMap<string, ProviderAdapter>;
}

import type {
  LlmGateway,
  LlmProviderConfig,
  LlmRequest,
  LlmResponse,
  LlmStreamChunk,
  ProviderHealthSnapshot,
  FailoverBudgetCheck,
  FailoverPolicy,
  ProviderHealthStatus,
} from '../interfaces/substrate.js';
import { DEFAULT_BUDGET_LIMIT } from '../accounting/resource_accounting.js';

// ─── Error Constructors ───

function err(code: string, message: string, spec: string): { ok: false; error: KernelError } {
  return { ok: false, error: { code, message, spec } };
}

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

// ─── Circuit Breaker Constants ───

/** DL-1: Default N=5 consecutive failures before cooldown */
const DEFAULT_CIRCUIT_BREAKER_N = 5;
/** DL-1: Default 60s cooldown duration */
const DEFAULT_COOLDOWN_MS = 60000;

// ─── LLM Gateway Factory ───

/**
 * CF-010: Optional encryption for sensitive data at rest.
 * When provided, request/response bodies in core_llm_request_log are encrypted.
 * S ref: I-11 (encryption at rest), I-25 (deterministic replay — still works with decryption)
 */
interface EncryptionDep {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

/**
 * Create an LlmGateway implementation.
 * S ref: §25.4, C-07 (Object.freeze)
 *
 * Provider routing follows DL-1:
 *   1. Capability filter (model supports requested capability)
 *   2. Health filter (only healthy/degraded providers)
 *   3. Strategy sort (lowest cost, then lowest latency)
 *   4. Circuit breaker check
 *
 * All requests are logged to core_llm_request_log for I-25 replay.
 * CF-010: When encryption is provided, request/response bodies are encrypted before storage.
 */
export function createLlmGateway(audit?: AuditDep, encryption?: EncryptionDep, time?: TimeProvider, transport?: TransportDep): LlmGateway {
  const clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };

  /**
   * In-memory provider config registry. MUST live inside the closure to prevent
   * cross-tenant leakage via module-scoped mutable state (F-08).
   * S ref: I-07 (Agent Isolation)
   */
  const providerConfigs = new Map<string, LlmProviderConfig>();

  /** §25.4: Register a provider */
  function registerProvider(conn: DatabaseConnection, _ctx: OperationContext, config: LlmProviderConfig): Result<void> {
    // Store config in memory
    providerConfigs.set(config.providerId, config);

    // I-03: mutation + audit in same transaction
    conn.transaction(() => {
      // Upsert provider health in SQLite
      conn.run(
        `INSERT INTO core_provider_health (provider_id, status, circuit_breaker_n, cooldown_duration_ms)
         VALUES (?, 'healthy', ?, ?)
         ON CONFLICT(provider_id) DO UPDATE SET
           status = 'healthy',
           consecutive_failures = 0,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        [config.providerId, DEFAULT_CIRCUIT_BREAKER_N, DEFAULT_COOLDOWN_MS]
      );

      audit?.append(conn, {
        tenantId: null,
        actorType: 'system',
        actorId: 'substrate.gateway',
        operation: 'provider.register',
        resourceType: 'provider',
        resourceId: config.providerId,
        detail: { models: config.models, baseUrl: config.baseUrl },
      });
    });

    return ok(undefined);
  }

  /**
   * DL-1: Select provider by routing algorithm.
   * Returns provider config or null if no healthy provider found.
   */
  function selectProvider(conn: DatabaseConnection, model: string): { config: LlmProviderConfig; health: { provider_id: string; status: string } } | null {
    // Step 1: Capability filter -- find providers that serve this model
    const candidateConfigs: LlmProviderConfig[] = [];
    for (const [, config] of providerConfigs) {
      if (config.models.includes(model)) {
        candidateConfigs.push(config);
      }
    }
    if (candidateConfigs.length === 0) return null;

    // Step 2: Health filter -- only healthy or degraded
    const now = clock.nowISO();
    const healthyProviders: Array<{ config: LlmProviderConfig; health: { provider_id: string; status: string; avg_latency_ms: number; cooldown_until: string | null } }> = [];

    for (const config of candidateConfigs) {
      const health = conn.get<{
        provider_id: string;
        status: string;
        avg_latency_ms: number;
        cooldown_until: string | null;
        consecutive_failures: number;
        circuit_breaker_n: number;
      }>(
        'SELECT provider_id, status, avg_latency_ms, cooldown_until, consecutive_failures, circuit_breaker_n FROM core_provider_health WHERE provider_id = ?',
        [config.providerId]
      );

      if (!health) continue;

      // Check cooldown expiry
      if (health.status === 'cooldown' && health.cooldown_until) {
        if (now >= health.cooldown_until) {
          // Cooldown expired -- transition to healthy
          conn.run(
            `UPDATE core_provider_health
             SET status = 'healthy', consecutive_failures = 0, cooldown_until = NULL,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE provider_id = ?`,
            [config.providerId]
          );
          // I-03: audit health state mutation
          audit?.append(conn, {
            tenantId: null,
            actorType: 'system',
            actorId: 'substrate.gateway',
            operation: 'provider.health_update',
            resourceType: 'provider',
            resourceId: config.providerId,
            detail: { from: 'cooldown', to: 'healthy', reason: 'cooldown_expired' },
          });
          healthyProviders.push({ config, health: { ...health, status: 'healthy' } });
          continue;
        }
        // Still in cooldown -- skip
        continue;
      }

      // Step 4: Circuit breaker check
      if (health.consecutive_failures >= health.circuit_breaker_n) {
        continue; // Circuit breaker open
      }

      if (health.status === 'healthy' || health.status === 'degraded') {
        healthyProviders.push({ config, health });
      }
    }

    if (healthyProviders.length === 0) return null;

    // Step 3: Strategy sort -- lowest cost first, then lowest latency
    healthyProviders.sort((a, b) => {
      const costA = (a.config.costPerInputToken ?? 0) + (a.config.costPerOutputToken ?? 0);
      const costB = (b.config.costPerInputToken ?? 0) + (b.config.costPerOutputToken ?? 0);
      if (costA !== costB) return costA - costB;
      return (a.health.avg_latency_ms ?? 0) - (b.health.avg_latency_ms ?? 0);
    });

    const first = healthyProviders[0];
    if (!first) return null;
    return { config: first.config, health: first.health };
  }

  /** Hash the request for I-25 replay */
  function hashRequest(request: LlmRequest): string {
    const serialized = JSON.stringify({
      model: request.model,
      messages: request.messages,
      tools: request.tools,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      systemPrompt: request.systemPrompt,
    });
    return createHash('sha256').update(serialized).digest('hex');
  }

  /** Log request to core_llm_request_log for I-25 */
  function logRequest(
    conn: DatabaseConnection,
    requestId: string,
    request: LlmRequest,
    promptHash: string,
    providerId: string,
  ): void {
    // CF-010: Encrypt request body before storage if encryption is available
    const requestJson = JSON.stringify(request);
    const storedBody = encryption ? encryption.encrypt(requestJson) : requestJson;

    conn.run(
      `INSERT INTO core_llm_request_log
        (request_id, task_id, mission_id, tenant_id, provider_id, model_id,
         prompt_hash, request_body, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        requestId,
        request.metadata?.taskId ?? '',
        request.metadata?.missionId ?? '',
        request.metadata?.tenantId ?? null,
        providerId,
        request.model,
        promptHash,
        storedBody,
      ]
    );
  }

  /** Update request log with response */
  function logResponse(
    conn: DatabaseConnection,
    requestId: string,
    response: LlmResponse | null,
    error: string | null,
    latencyMs: number,
  ): void {
    if (response) {
      // CF-010: Encrypt response body before storage if encryption is available
      const responseJson = JSON.stringify(response);
      const storedBody = encryption ? encryption.encrypt(responseJson) : responseJson;

      conn.run(
        `UPDATE core_llm_request_log
         SET response_body = ?, input_tokens = ?, output_tokens = ?,
             provider_input_tokens = ?, provider_output_tokens = ?,
             latency_ms = ?, status = 'completed'
         WHERE request_id = ?`,
        [
          storedBody,
          response.usage.inputTokens,
          response.usage.outputTokens,
          response.usage.providerInputTokens ?? null,
          response.usage.providerOutputTokens ?? null,
          latencyMs,
          requestId,
        ]
      );
    } else {
      conn.run(
        `UPDATE core_llm_request_log
         SET status = 'failed', error_message = ?, latency_ms = ?
         WHERE request_id = ?`,
        [error, latencyMs, requestId]
      );
    }
  }

  /**
   * §25.4: Send LLM request (ASYNC).
   * This is the substrate's interface -- actual HTTP calls to providers
   * would happen here. For now, the gateway provides the routing,
   * logging, and circuit breaker infrastructure. The actual HTTP call
   * is stubbed as PROVIDER_UNAVAILABLE since no providers are wired.
   *
   * In production, this would:
   * 1. Select provider via DL-1
   * 2. Translate request to provider-specific format (per-provider codec)
   * 3. Make HTTP call via fetch() (I-01: no SDK deps)
   * 4. Translate response back to internal format
   * 5. Log for I-25 replay
   * 6. Update provider health
   */
  async function request(conn: DatabaseConnection, _ctx: OperationContext, req: LlmRequest): Promise<Result<LlmResponse>> {
    // F-02: Input validation
    if (typeof req.maxTokens !== 'number' || req.maxTokens <= 0) {
      return err('INVALID_INPUT', 'maxTokens must be > 0', '§25.4');
    }
    if (!req.messages || req.messages.length === 0) {
      return err('INVALID_INPUT', 'messages must contain at least one message', '§25.4');
    }

    const provider = selectProvider(conn, req.model);
    if (!provider) {
      return err(
        'PROVIDER_UNAVAILABLE',
        `No healthy provider found for model ${req.model}`,
        'I-16'
      );
    }

    const requestId = randomUUID();
    const promptHash = hashRequest(req);
    const startTime = clock.nowMs();

    // I-25: Log the request
    logRequest(conn, requestId, req, promptHash, provider.config.providerId);

    // Phase 5A: When transport is provided, delegate to transport engine
    if (transport) {
      const adapter = transport.adapters.get(provider.config.providerId);
      if (!adapter) {
        const latencyMs = clock.nowMs() - startTime;
        logResponse(conn, requestId, null, 'No adapter registered for provider', latencyMs);
        return err('PROVIDER_UNAVAILABLE', `No transport adapter for provider ${provider.config.providerId}`, '§25.4');
      }

      try {
        const transportResult: TransportResult = await transport.engine.execute(adapter, { request: req });
        const latencyMs = clock.nowMs() - startTime;

        // Set correct latencyMs and providerId on the response
        const response: LlmResponse = {
          ...transportResult.response,
          latencyMs,
          providerId: provider.config.providerId,
        };

        // I-25: Log the response
        logResponse(conn, requestId, response, null, latencyMs);

        // Record deliberation data via supplementary SQL in same transaction
        recordDeliberation(conn, requestId, transportResult.deliberation);

        return ok(response);
      } catch (transportErr) {
        const latencyMs = clock.nowMs() - startTime;
        const errorMsg = transportErr instanceof Error ? transportErr.message : String(transportErr);
        logResponse(conn, requestId, null, errorMsg, latencyMs);
        return err('PROVIDER_UNAVAILABLE', errorMsg, '§25.4');
      }
    }

    // Fallback: No transport configured (Phase 2 stub behavior)
    const latencyMs = clock.nowMs() - startTime;
    logResponse(conn, requestId, null, 'No HTTP transport configured', latencyMs);

    return err(
      'PROVIDER_UNAVAILABLE',
      'LLM gateway HTTP transport not configured -- infrastructure only in Phase 2',
      '§25.4'
    );
  }

  /** §25.4, §27: Send streaming LLM request (ASYNC) */
  async function requestStream(conn: DatabaseConnection, _ctx: OperationContext, req: LlmRequest): Promise<Result<AsyncIterable<LlmStreamChunk>>> {
    const provider = selectProvider(conn, req.model);
    if (!provider) {
      return err(
        'PROVIDER_UNAVAILABLE',
        `No healthy provider found for model ${req.model}`,
        'I-16'
      );
    }

    // Phase 5A: When transport is provided, delegate to transport engine
    if (transport) {
      const adapter = transport.adapters.get(provider.config.providerId);
      if (!adapter) {
        return err('PROVIDER_UNAVAILABLE', `No transport adapter for provider ${provider.config.providerId}`, '§25.4/§27');
      }

      // Check if adapter supports streaming
      if (!adapter.supportsStreaming()) {
        return err('PROVIDER_UNAVAILABLE', `Provider ${provider.config.providerId} does not support streaming`, '§25.4/§27');
      }

      const requestId = randomUUID();
      const promptHash = hashRequest(req);
      logRequest(conn, requestId, req, promptHash, provider.config.providerId);

      try {
        const streamResult: TransportStreamResult = await transport.engine.executeStream(adapter, { request: req });

        // Wrap chunks to record deliberation on completion
        async function* wrappedChunks(): AsyncIterable<LlmStreamChunk> {
          try {
            for await (const chunk of streamResult.stream) {
              yield chunk;
            }
          } finally {
            // Record deliberation after stream completes
            const deliberation = streamResult.getDeliberation();
            recordDeliberation(conn, requestId, deliberation);
          }
        }

        return ok(wrappedChunks());
      } catch (transportErr) {
        const errorMsg = transportErr instanceof Error ? transportErr.message : String(transportErr);
        logResponse(conn, requestId, null, errorMsg, 0);
        return err('PROVIDER_UNAVAILABLE', errorMsg, '§25.4/§27');
      }
    }

    // Fallback: No transport configured (Phase 2 stub behavior)
    return err(
      'PROVIDER_UNAVAILABLE',
      'LLM gateway streaming transport not configured -- infrastructure only in Phase 2',
      '§25.4/§27'
    );
  }

  /** DL-1: Get all provider health snapshots */
  function getProviderHealth(conn: DatabaseConnection): Result<readonly ProviderHealthSnapshot[]> {
    const rows = conn.query<{
      provider_id: string;
      status: string;
      consecutive_failures: number;
      error_rate_5min: number;
      avg_latency_ms: number;
      total_requests: number;
      last_success_at: string | null;
      last_failure_at: string | null;
      cooldown_until: string | null;
    }>('SELECT provider_id, status, consecutive_failures, error_rate_5min, avg_latency_ms, total_requests, last_success_at, last_failure_at, cooldown_until FROM core_provider_health');

    const snapshots: ProviderHealthSnapshot[] = rows.map((row) => ({
      providerId: row.provider_id,
      status: row.status as ProviderHealthStatus,
      consecutiveFailures: row.consecutive_failures,
      errorRate5min: row.error_rate_5min,
      avgLatencyMs: row.avg_latency_ms,
      totalRequests: row.total_requests,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
      cooldownUntil: row.cooldown_until,
    }));

    return ok(snapshots);
  }

  /** I-16: Check if any healthy provider exists */
  function hasHealthyProvider(conn: DatabaseConnection): Result<boolean> {
    const row = conn.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM core_provider_health
       WHERE status IN ('healthy', 'degraded')`,
    );
    return ok((row?.cnt ?? 0) > 0);
  }

  /**
   * FM-12: Check failover budget before switching providers.
   * Failover policy determines behavior when budget is insufficient:
   *   - 'block': reject the failover (return allowed=false)
   *   - 'degrade': allow but warn
   *   - 'allow-overdraft': allow even if over budget
   */
  function checkFailoverBudget(conn: DatabaseConnection, missionId: MissionId, estimatedTokens: number, failoverPolicy: FailoverPolicy): Result<FailoverBudgetCheck> {
    // Check remaining budget for this mission
    const row = conn.get<{ total_effective: number }>(
      `SELECT COALESCE(SUM(effective_input_tokens + effective_output_tokens), 0) as total_effective
       FROM meter_interaction_accounting
       WHERE mission_id = ?`,
      [missionId]
    );

    const consumed = row?.total_effective ?? 0;
    const budgetLimit = DEFAULT_BUDGET_LIMIT;
    const remaining = budgetLimit - consumed;

    if (estimatedTokens <= remaining) {
      return ok({ allowed: true });
    }

    // Over budget -- apply policy
    switch (failoverPolicy) {
      case 'block':
        return ok({
          allowed: false,
          reason: `Failover blocked: estimated ${estimatedTokens} tokens exceeds remaining budget of ${remaining}`,
        });
      case 'degrade':
        return ok({
          allowed: true,
          reason: `Failover degraded: estimated ${estimatedTokens} tokens exceeds remaining budget of ${remaining}. System operating in degraded mode.`,
        });
      case 'allow-overdraft':
        return ok({
          allowed: true,
          reason: `Failover allowed with overdraft: estimated ${estimatedTokens} tokens exceeds remaining budget of ${remaining}`,
        });
      default:
        return ok({ allowed: false, reason: 'Unknown failover policy' });
    }
  }

  /**
   * Record deliberation data via supplementary UPDATE on core_llm_request_log.
   * S ref: §25.4/§25.6 deliberation tracking, I-03 (same transaction)
   */
  function recordDeliberation(
    conn: DatabaseConnection,
    requestId: string,
    deliberation: DeliberationMetrics,
  ): void {
    conn.run(
      `UPDATE core_llm_request_log
       SET deliberation_tokens = ?
       WHERE request_id = ?`,
      [deliberation.deliberationTokens, requestId],
    );
  }

  // Expose internal helpers for testing/substrate integration
  const gateway: LlmGateway = {
    registerProvider,
    request,
    requestStream,
    getProviderHealth,
    hasHealthyProvider,
    checkFailoverBudget,
  };

  return Object.freeze(gateway);
}

/**
 * Exported for internal substrate use: record provider success/failure.
 * Called by the actual HTTP transport layer when it processes responses.
 */
export function updateProviderHealth(
  conn: DatabaseConnection,
  providerId: string,
  success: boolean,
  latencyMs: number,
  errorMessage?: string,
  time?: TimeProvider,
): void {
  const hClock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  if (success) {
    conn.run(
      `UPDATE core_provider_health
       SET consecutive_failures = 0,
           total_requests = total_requests + 1,
           last_success_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           last_request_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           avg_latency_ms = (avg_latency_ms * total_requests + ?) / (total_requests + 1),
           status = CASE WHEN status = 'degraded' THEN 'healthy' ELSE status END,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE provider_id = ?`,
      [latencyMs, providerId]
    );
  } else {
    const health = conn.get<{ consecutive_failures: number; circuit_breaker_n: number; cooldown_duration_ms: number }>(
      'SELECT consecutive_failures, circuit_breaker_n, cooldown_duration_ms FROM core_provider_health WHERE provider_id = ?',
      [providerId]
    );
    if (!health) return;

    const newFailures = health.consecutive_failures + 1;
    if (newFailures >= health.circuit_breaker_n) {
      const cooldownUntil = new Date(hClock.nowMs() + health.cooldown_duration_ms).toISOString();
      conn.run(
        `UPDATE core_provider_health
         SET consecutive_failures = ?, total_requests = total_requests + 1,
             total_failures = total_failures + 1, status = 'cooldown',
             cooldown_until = ?, last_failure_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             last_request_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             last_error_message = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE provider_id = ?`,
        [newFailures, cooldownUntil, errorMessage ?? 'Unknown error', providerId]
      );
    } else {
      const newStatus = newFailures >= 2 ? 'degraded' : 'healthy';
      conn.run(
        `UPDATE core_provider_health
         SET consecutive_failures = ?, total_requests = total_requests + 1,
             total_failures = total_failures + 1, status = ?,
             last_failure_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             last_request_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             last_error_message = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE provider_id = ?`,
        [newFailures, newStatus, errorMessage ?? 'Unknown error', providerId]
      );
    }
  }
}
