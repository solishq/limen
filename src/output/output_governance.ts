// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AGENT_OUTPUT_GOVERNANCE.md §3
/**
 * AgentOutputClient Implementation — Full Output Governance subsystem.
 *
 * Implements: OG-3.1 through OG-3.18, OG-11.1 through OG-11.20,
 *             OG-12.1 through OG-12.12, OG-A.1 through OG-A.10
 *
 * All methods return Result<T> (AD-11). Never throws.
 * All mutations produce audit entries.
 * Outputs are governed claims with predicate output.<type>.
 * Confidence ceiling enforced at 0.7 (OG-12.2).
 * Telemetry is append-only (OG-12.3).
 * Fail-closed governance (AD-4).
 *
 * Architecture:
 * - Single composition root via createAgentOutputClient factory
 * - Dependencies injected (AD-10)
 * - All IDs are branded types (AD-2)
 * - Integrates with CCP for claim storage (OG-11.1 through OG-11.8)
 * - Delegates to HookExecutor for hook operations
 * - Delegates to PluginLifecycleManager for plugin operations
 * - Delegates to InferenceEngine for structured inference
 */

import { randomUUID } from 'node:crypto';
import type {
  Result, OperationContext,
  AgentId, SessionId, MissionId, TaskId,
} from '../kernel/interfaces/index.js';
import type { AuditTrail } from '../kernel/interfaces/audit.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type { EventBus } from '../kernel/interfaces/events.js';
import type { DatabaseConnection } from '../kernel/interfaces/database.js';
import type { ClaimApi } from '../api/interfaces/api.js';
import type { ClaimId } from '../claims/interfaces/claim_types.js';
import type {
  AgentEvent, AgentEventHandler,
} from '../adapters/shared/types.js';
import type { ClassificationLevel } from '../governance/classification/governance_types.js';
import type {
  OutputType, OutputOptions, OutputEntry, OutputFilter,
  CostRecord, VitalRecord, CostFilter, VitalFilter, BudgetConsumption,
  InferenceOptions, InferenceResult,
  AgentPlugin, PluginConfig, PluginRegistration,
  AgentHook, HookRegistration,
  OutputEvent,
} from './output_types.js';
import {
  OUTPUT_TYPE_TO_PREDICATE, VALID_OUTPUT_TYPES, OUTPUT_FILTER_DEFAULTS,
  AGENT_CONFIDENCE_CEILING, OUTPUT_CONTENT_MIN_LENGTH, OUTPUT_CONTENT_MAX_LENGTH,
  VALID_OUTPUT_EVENTS,
} from './output_types.js';
// Error types available for callers — not used directly in this module
// import type { OutputGovernanceError } from './output_errors.js';
import type { HookExecutor } from './hook_executor.js';
import { createHookExecutor } from './hook_executor.js';
import type { PluginLifecycleManager } from './plugin_lifecycle.js';
import { createPluginLifecycleManager } from './plugin_lifecycle.js';
import type { InferenceEngine, InferenceProvider } from './inference_engine.js';
import { createInferenceEngine } from './inference_engine.js';

// ── Result Helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message, spec: 'AOG-3' } };
}

// ============================================================================
// AgentOutputClient Interface (OG-3.1 through OG-3.17)
// ============================================================================

export interface AgentOutputClient {
  // --- Output Primitives (OG-3.1 through OG-3.3) ---
  produce(ctx: OperationContext, type: OutputType, content: string, options?: OutputOptions): Promise<Result<OutputEntry>>;
  queryOutputs(ctx: OperationContext, filter: OutputFilter): Promise<Result<OutputEntry[]>>;
  retractOutput(ctx: OperationContext, outputId: ClaimId, reason: string): Promise<Result<void>>;

  // --- Telemetry (OG-3.4 through OG-3.8) ---
  recordCost(ctx: OperationContext, data: CostRecord): Promise<Result<void>>;
  recordVital(ctx: OperationContext, data: VitalRecord): Promise<Result<void>>;
  queryCosts(ctx: OperationContext, filter: CostFilter): Promise<Result<CostRecord[]>>;
  queryVitals(ctx: OperationContext, filter: VitalFilter): Promise<Result<VitalRecord[]>>;
  getBudgetConsumption(ctx: OperationContext): Promise<Result<BudgetConsumption>>;

  // --- Structured Inference (OG-3.9) ---
  infer<T>(ctx: OperationContext, options: InferenceOptions<T>): Promise<Result<InferenceResult<T>>>;

  // --- Plugin/Hook Lifecycle (OG-3.10 through OG-3.15) ---
  installPlugin(ctx: OperationContext, plugin: AgentPlugin, config?: PluginConfig): Promise<Result<string>>;
  uninstallPlugin(ctx: OperationContext, pluginId: string): Promise<Result<void>>;
  listPlugins(ctx: OperationContext): Promise<Result<PluginRegistration[]>>;
  registerHook(ctx: OperationContext, hook: AgentHook): Promise<Result<string>>;
  unregisterHook(ctx: OperationContext, hookId: string): Promise<Result<void>>;
  listHooks(ctx: OperationContext): Promise<Result<HookRegistration[]>>;

  // --- Events (OG-3.16, OG-3.17) ---
  on(ctx: OperationContext, event: OutputEvent, handler: AgentEventHandler): string;
  off(ctx: OperationContext, subscriptionId: string): void;
}

// ============================================================================
// Dependencies
// ============================================================================

export interface AgentOutputClientDeps {
  readonly claims: ClaimApi;
  readonly getConnection: () => DatabaseConnection;
  readonly getContext: () => OperationContext;
  readonly audit: AuditTrail;
  readonly time: TimeProvider;
  readonly events: EventBus;
  readonly missionId: MissionId;
  readonly taskId: TaskId | null;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly maxAutoConfidence: number;
  readonly inferenceProvider: InferenceProvider | null;
  readonly getAgentCapabilities: () => readonly string[];
}

// ============================================================================
// Factory
// ============================================================================

export function createAgentOutputClient(deps: AgentOutputClientDeps): AgentOutputClient {
  const {
    claims, getConnection, getContext, audit, time, events,
    missionId, taskId, agentId, sessionId,
    maxAutoConfidence, inferenceProvider, getAgentCapabilities,
  } = deps;

  // Helper: emit event with proper conn/ctx/payload signature
  function emitEvent(eventType: string, payload: Record<string, unknown>): void {
    try {
      const conn = getConnection();
      const ctx = getContext();
      events.emit(conn, ctx, {
        type: eventType,
        scope: 'system',
        payload,
        propagation: 'local',
      });
    } catch { /* event emission non-fatal */ }
  }

  // Helper: append audit entry with proper conn signature
  function appendAudit(operation: string, resourceType: string, resourceId: string, detail?: Record<string, unknown>): void {
    try {
      const conn = getConnection();
      audit.append(conn, {
        tenantId: null,
        actorType: 'system',
        actorId: 'output-governance',
        operation,
        resourceType,
        resourceId,
        ...(detail !== undefined ? { detail } : {}),
      });
    } catch { /* audit non-fatal post-success */ }
  }

  // Create sub-components
  const hookExecutor: HookExecutor = createHookExecutor({
    getConnection, getContext, audit, time, events,
  });
  const pluginManager: PluginLifecycleManager = createPluginLifecycleManager({
    getConnection, getContext, audit, time, events, getAgentCapabilities,
  });
  const inferenceEngine: InferenceEngine = createInferenceEngine({
    provider: inferenceProvider,
    getConnection, getContext, time, events, audit, agentId, sessionId,
  });

  // Subscription tracking for on/off
  const subscriptions = new Map<string, string>();

  // ========================================================================
  // Output Primitives (OG-3.1 through OG-3.3, OG-11.1 through OG-11.3)
  // ========================================================================

  async function produce(
    ctx: OperationContext,
    type: OutputType,
    content: string,
    options?: OutputOptions,
  ): Promise<Result<OutputEntry>> {
    // Validate output type (OG-4.1)
    if (!VALID_OUTPUT_TYPES.has(type)) {
      return err('OUTPUT_VALIDATION_FAILED', `Invalid output type: ${type}`);
    }

    // Validate content (OG-4.14)
    if (!content || content.length < OUTPUT_CONTENT_MIN_LENGTH) {
      return err('OUTPUT_CONTENT_EMPTY', 'Output content must be non-empty');
    }
    if (content.length > OUTPUT_CONTENT_MAX_LENGTH) {
      return err('OUTPUT_CONTENT_TOO_LARGE',
        `Output content exceeds ${OUTPUT_CONTENT_MAX_LENGTH} characters`);
    }

    // OG-12.2: Clamp confidence to [0, 0.7]
    let confidence = options?.confidence ?? maxAutoConfidence;
    confidence = Math.max(0, Math.min(confidence, AGENT_CONFIDENCE_CEILING));

    // OG-4.10: Default classification to 'internal'
    const classification: ClassificationLevel = options?.classification ?? 'internal';

    // Execute before_output hooks (OG-11.16)
    const hookPayload: Record<string, unknown> = {
      type,
      content,
      confidence,
      classification,
      tags: options?.tags ?? [],
      reasoning: options?.reasoning ?? null,
    };

    const hookResult = await hookExecutor.execute(
      'before_output', agentId, sessionId, hookPayload,
    );

    if (!hookResult.proceed) {
      return err('HOOK_BLOCKED_OPERATION',
        `Hook '${hookResult.blockingHookId}' blocked output production: ${hookResult.reason}`);
    }

    // Apply hook modifications if any
    const modifiedContent = typeof hookResult.payload.content === 'string'
      ? hookResult.payload.content : content;

    // OG-11.1: Store as governed claim via CCP (SC-11)
    const predicate = OUTPUT_TYPE_TO_PREDICATE[type];
    const now = time.nowISO();

    const claimResult = claims.assertClaim({
      subject: `entity:output:${randomUUID()}`,
      predicate,
      object: { type: 'json', value: JSON.stringify({
        type,
        content: modifiedContent,
        classification,
        tags: options?.tags ?? [],
        reasoning: options?.reasoning ?? null,
        metadata: options?.metadata ?? {},
      }) },
      confidence,
      validAt: now,
      missionId: options?.missionId ?? missionId,
      taskId,
      groundingMode: 'runtime_witness',
      evidenceRefs: [],
      runtimeWitness: {
        witnessType: 'output_governance',
        witnessedValues: { outputType: type, classification },
        witnessTimestamp: now,
      },
    });

    if (!claimResult.ok) {
      return err('OUTPUT_VALIDATION_FAILED', claimResult.error.message);
    }

    // Claim ID comes back as string from CCP — cast to branded type
    const claimId = claimResult.value.claim.id as unknown as ClaimId;

    // OG-4.11: Create derived_from relationships for relatedClaims
    if (options?.relatedClaims && options.relatedClaims.length > 0) {
      for (const relatedId of options.relatedClaims) {
        claims.relateClaims({
          fromClaimId: claimId,
          toClaimId: relatedId,
          type: 'derived_from',
          missionId: options?.missionId ?? missionId,
        });
      }
    }

    const entry: OutputEntry = {
      id: claimId,
      type,
      content: modifiedContent,
      confidence,
      classification,
      agentId: ctx.agentId ?? agentId,
      sessionId: ctx.sessionId ?? sessionId,
      missionId: options?.missionId ?? missionId ?? null,
      reasoning: options?.reasoning ?? null,
      relatedClaims: options?.relatedClaims ?? [],
      tags: options?.tags ?? [],
      createdAt: now,
      status: 'active',
    };

    // Execute after_output hooks (OG-11.16)
    await hookExecutor.execute('after_output', agentId, sessionId, {
      outputId: claimId,
      type,
      confidence,
    });

    // OG-8.15: output:produced event
    emitEvent('output:produced', { outputId: claimId, type, confidence });
    appendAudit('output.produced', 'output', claimId as string, { type, confidence, classification });

    return ok(entry);
  }

  async function queryOutputs(
    ctx: OperationContext,
    filter: OutputFilter,
  ): Promise<Result<OutputEntry[]>> {
    // Build predicate filter
    let predicateFilter: string;
    if (filter.type) {
      if (Array.isArray(filter.type)) {
        // Multiple types — query with wildcard and filter in-memory
        predicateFilter = 'output.*';
      } else {
        predicateFilter = OUTPUT_TYPE_TO_PREDICATE[filter.type as OutputType] ?? 'output.*';
      }
    } else {
      predicateFilter = 'output.*';
    }

    const status = filter.status ?? OUTPUT_FILTER_DEFAULTS.status;
    const limit = filter.limit ?? OUTPUT_FILTER_DEFAULTS.limit;
    const offset = filter.offset ?? OUTPUT_FILTER_DEFAULTS.offset;

    // OG-11.2: Query via SC-13 (query_claims)
    const queryResult = claims.queryClaims({
      predicate: predicateFilter,
      subject: null,
      limit: limit + offset, // Fetch extra to handle offset
      ...(status !== 'all' ? { status: status as 'active' | 'retracted' } : {}),
    });

    if (!queryResult.ok) {
      return err('OUTPUT_VALIDATION_FAILED', queryResult.error.message);
    }

    // Transform claim results to OutputEntry
    const entries: OutputEntry[] = [];
    const claimsData = queryResult.value.claims;

    for (let i = offset; i < Math.min(claimsData.length, offset + limit); i++) {
      const item = claimsData[i];
      if (!item) continue;

      const claim = item.claim;
      let parsed: Record<string, unknown> = {};
      try {
        const value = typeof claim.object.value === 'string'
          ? claim.object.value
          : JSON.stringify(claim.object.value);
        parsed = JSON.parse(value) as Record<string, unknown>;
      } catch { /* parse failure — use defaults */ }

      // Determine output type from predicate
      const outputType = claim.predicate.replace('output.', '') as OutputType;

      // Apply type filter if array
      if (filter.type && Array.isArray(filter.type)) {
        if (!(filter.type as readonly OutputType[]).includes(outputType)) {
          continue;
        }
      }

      // Apply min confidence filter
      if (filter.minConfidence !== undefined && claim.confidence < filter.minConfidence) {
        continue;
      }

      // Apply time range filter
      if (filter.timeRange) {
        if (claim.createdAt < filter.timeRange.from || claim.createdAt > filter.timeRange.to) {
          continue;
        }
      }

      // Apply tags filter
      if (filter.tags && filter.tags.length > 0) {
        const entryTags = Array.isArray(parsed.tags) ? parsed.tags as string[] : [];
        const hasAllTags = filter.tags.every(t => entryTags.includes(t));
        if (!hasAllTags) continue;
      }

      entries.push({
        id: claim.id as ClaimId,
        type: outputType,
        content: typeof parsed.content === 'string' ? parsed.content : '',
        confidence: claim.confidence,
        classification: (typeof parsed.classification === 'string'
          ? parsed.classification : 'internal') as ClassificationLevel,
        agentId: (ctx.agentId ?? agentId) as AgentId,
        sessionId: (ctx.sessionId ?? sessionId) as SessionId,
        missionId: missionId ?? null,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : null,
        relatedClaims: [],
        tags: Array.isArray(parsed.tags) ? parsed.tags as string[] : [],
        createdAt: claim.createdAt,
        status: claim.status as 'active' | 'retracted',
      });
    }

    return ok(entries);
  }

  async function retractOutput(
    _ctx: OperationContext,
    outputId: ClaimId,
    reason: string,
  ): Promise<Result<void>> {
    // OG-4.16: Status transition active -> retracted (terminal, irreversible)
    // OG-11.3: Maps to SC-12 (retract_claim)
    const result = claims.retractClaim({
      claimId: outputId,
      reason,
    });

    if (!result.ok) {
      return err('OUTPUT_VALIDATION_FAILED', result.error.message);
    }

    // OG-8.16: output:retracted event
    emitEvent('output:retracted', { outputId, reason });
    appendAudit('output.retracted', 'output', String(outputId), { reason });

    return ok(undefined);
  }

  // ========================================================================
  // Telemetry (OG-3.4 through OG-3.8, OG-11.4 through OG-11.8, OG-12.3)
  // ========================================================================

  async function recordCost(
    _ctx: OperationContext,
    data: CostRecord,
  ): Promise<Result<void>> {
    // OG-5.2: Validate non-negative integers
    if (data.inputTokens < 0 || data.outputTokens < 0 || data.totalTokens < 0) {
      return err('TELEMETRY_WRITE_FAILED', 'Token counts must be non-negative');
    }
    // OG-5.3: totalTokens must equal inputTokens + outputTokens
    if (data.totalTokens !== data.inputTokens + data.outputTokens) {
      return err('TELEMETRY_WRITE_FAILED',
        `totalTokens (${data.totalTokens}) must equal inputTokens (${data.inputTokens}) + outputTokens (${data.outputTokens})`);
    }
    // OG-5.4: cost non-negative
    if (data.cost < 0) {
      return err('TELEMETRY_WRITE_FAILED', 'Cost must be non-negative');
    }
    // OG-5.5: duration non-negative
    if (data.duration < 0) {
      return err('TELEMETRY_WRITE_FAILED', 'Duration must be non-negative');
    }

    // OG-5.6 / OG-11.4: Store as governed claim with predicate telemetry.cost
    const result = claims.assertClaim({
      subject: `entity:telemetry:cost:${randomUUID()}`,
      predicate: 'telemetry.cost',
      object: { type: 'json', value: JSON.stringify(data) },
      confidence: AGENT_CONFIDENCE_CEILING,
      validAt: data.timestamp,
      missionId: data.missionId ?? missionId,
      taskId: data.taskId ?? taskId,
      groundingMode: 'runtime_witness',
      evidenceRefs: [],
      runtimeWitness: {
        witnessType: 'telemetry_cost',
        witnessedValues: { provider: data.provider, model: data.model, totalTokens: data.totalTokens },
        witnessTimestamp: data.timestamp,
      },
    });

    if (!result.ok) {
      return err('TELEMETRY_WRITE_FAILED', result.error.message);
    }

    // OG-8.17: telemetry:cost_recorded event
    emitEvent('telemetry:cost_recorded', {
      costId: result.value.claim.id,
      totalTokens: data.totalTokens,
      cost: data.cost,
    });

    return ok(undefined);
  }

  async function recordVital(
    _ctx: OperationContext,
    data: VitalRecord,
  ): Promise<Result<void>> {
    // OG-5.8: metric must be non-empty, dot-delimited
    if (!data.metric || data.metric.length === 0) {
      return err('TELEMETRY_WRITE_FAILED', 'Vital metric must be non-empty');
    }
    if (!data.metric.includes('.')) {
      return err('TELEMETRY_WRITE_FAILED',
        'Vital metric must be dot-delimited (e.g., throughput.requests)');
    }
    // OG-5.9: unit must be non-empty
    if (!data.unit || data.unit.length === 0) {
      return err('TELEMETRY_WRITE_FAILED', 'Vital unit must be non-empty');
    }

    // OG-5.10 / OG-11.5: Store as governed claim with predicate telemetry.vital
    const result = claims.assertClaim({
      subject: `entity:telemetry:vital:${randomUUID()}`,
      predicate: 'telemetry.vital',
      object: { type: 'json', value: JSON.stringify(data) },
      confidence: AGENT_CONFIDENCE_CEILING,
      validAt: data.timestamp,
      missionId,
      taskId,
      groundingMode: 'runtime_witness',
      evidenceRefs: [],
      runtimeWitness: {
        witnessType: 'telemetry_vital',
        witnessedValues: { metric: data.metric, value: data.value, unit: data.unit },
        witnessTimestamp: data.timestamp,
      },
    });

    if (!result.ok) {
      return err('TELEMETRY_WRITE_FAILED', result.error.message);
    }

    // OG-8.18: telemetry:vital_recorded event
    emitEvent('telemetry:vital_recorded', {
      vitalId: result.value.claim.id,
      metric: data.metric,
      value: data.value,
    });

    return ok(undefined);
  }

  async function queryCosts(
    _ctx: OperationContext,
    filter: CostFilter,
  ): Promise<Result<CostRecord[]>> {
    // OG-11.6: Query via SC-13 with telemetry.cost filter
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const queryResult = claims.queryClaims({
      predicate: 'telemetry.cost',
      subject: null,
      limit: limit + offset,
      status: 'active',
    });

    if (!queryResult.ok) {
      return err('TELEMETRY_WRITE_FAILED', queryResult.error.message);
    }

    const records: CostRecord[] = [];
    const claimsData = queryResult.value.claims;

    for (let i = offset; i < Math.min(claimsData.length, offset + limit); i++) {
      const item = claimsData[i];
      if (!item) continue;

      try {
        const value = typeof item.claim.object.value === 'string'
          ? item.claim.object.value
          : JSON.stringify(item.claim.object.value);
        const parsed = JSON.parse(value) as CostRecord;

        // Apply filters
        if (filter.provider && parsed.provider !== filter.provider) continue;
        if (filter.model && parsed.model !== filter.model) continue;
        if (filter.timeRange) {
          if (parsed.timestamp < filter.timeRange.from || parsed.timestamp > filter.timeRange.to) continue;
        }

        records.push(parsed);
      } catch { /* parse failure — skip */ }
    }

    return ok(records);
  }

  async function queryVitals(
    _ctx: OperationContext,
    filter: VitalFilter,
  ): Promise<Result<VitalRecord[]>> {
    // OG-11.7: Query via SC-13 with telemetry.vital filter
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const queryResult = claims.queryClaims({
      predicate: 'telemetry.vital',
      subject: null,
      limit: limit + offset,
      status: 'active',
    });

    if (!queryResult.ok) {
      return err('TELEMETRY_WRITE_FAILED', queryResult.error.message);
    }

    const records: VitalRecord[] = [];
    const claimsData = queryResult.value.claims;

    for (let i = offset; i < Math.min(claimsData.length, offset + limit); i++) {
      const item = claimsData[i];
      if (!item) continue;

      try {
        const value = typeof item.claim.object.value === 'string'
          ? item.claim.object.value
          : JSON.stringify(item.claim.object.value);
        const parsed = JSON.parse(value) as VitalRecord;

        // Apply filters
        if (filter.metric && parsed.metric !== filter.metric) continue;
        if (filter.timeRange) {
          if (parsed.timestamp < filter.timeRange.from || parsed.timestamp > filter.timeRange.to) continue;
        }

        records.push(parsed);
      } catch { /* parse failure — skip */ }
    }

    return ok(records);
  }

  async function getBudgetConsumption(
    _ctx: OperationContext,
  ): Promise<Result<BudgetConsumption>> {
    // OG-11.8: Aggregate over telemetry.cost claims
    const queryResult = claims.queryClaims({
      predicate: 'telemetry.cost',
      subject: null,
      limit: 10000, // Get all for aggregation
      status: 'active',
    });

    if (!queryResult.ok) {
      return err('TELEMETRY_WRITE_FAILED', queryResult.error.message);
    }

    let sessionTokens = 0, sessionCost = 0;
    let missionTokens = 0, missionCost = 0;
    let lifetimeTokens = 0, lifetimeCost = 0;
    let hasMissionCosts = false;

    for (const item of queryResult.value.claims) {
      try {
        const value = typeof item.claim.object.value === 'string'
          ? item.claim.object.value
          : JSON.stringify(item.claim.object.value);
        const parsed = JSON.parse(value) as CostRecord;

        lifetimeTokens += parsed.totalTokens;
        lifetimeCost += parsed.cost;

        // Session-scoped (match current session)
        if (parsed.sessionId === sessionId) {
          sessionTokens += parsed.totalTokens;
          sessionCost += parsed.cost;
        }

        // Mission-scoped (match current mission)
        if (parsed.missionId === missionId) {
          missionTokens += parsed.totalTokens;
          missionCost += parsed.cost;
          hasMissionCosts = true;
        }
      } catch { /* parse failure — skip */ }
    }

    const consumption: BudgetConsumption = {
      session: { tokens: sessionTokens, cost: sessionCost },
      mission: hasMissionCosts ? { tokens: missionTokens, cost: missionCost } : null,
      lifetime: { tokens: lifetimeTokens, cost: lifetimeCost },
      quotaRemaining: { tokens: null, cost: null }, // OG-5.17: null when no budget configured
    };

    return ok(consumption);
  }

  // ========================================================================
  // Structured Inference (OG-3.9, OG-11.9)
  // ========================================================================

  async function inferMethod<T>(
    _ctx: OperationContext,
    options: InferenceOptions<T>,
  ): Promise<Result<InferenceResult<T>>> {
    return inferenceEngine.infer(options, options.missionId ?? missionId);
  }

  // ========================================================================
  // Plugin Lifecycle (OG-3.10 through OG-3.12, OG-11.10)
  // ========================================================================

  async function installPlugin(
    _ctx: OperationContext,
    plugin: AgentPlugin,
    config?: PluginConfig,
  ): Promise<Result<string>> {
    return pluginManager.install(plugin, config);
  }

  async function uninstallPlugin(
    _ctx: OperationContext,
    pluginId: string,
  ): Promise<Result<void>> {
    return pluginManager.uninstall(pluginId);
  }

  async function listPlugins(
    _ctx: OperationContext,
  ): Promise<Result<PluginRegistration[]>> {
    return pluginManager.list();
  }

  // ========================================================================
  // Hook Lifecycle (OG-3.13 through OG-3.15, OG-11.11 through OG-11.16)
  // ========================================================================

  async function registerHook(
    _ctx: OperationContext,
    hook: AgentHook,
  ): Promise<Result<string>> {
    return hookExecutor.register(hook);
  }

  async function unregisterHook(
    _ctx: OperationContext,
    hookId: string,
  ): Promise<Result<void>> {
    return hookExecutor.unregister(hookId);
  }

  async function listHooks(
    _ctx: OperationContext,
  ): Promise<Result<HookRegistration[]>> {
    return hookExecutor.list();
  }

  // ========================================================================
  // Events (OG-3.16, OG-3.17)
  // ========================================================================

  function on(
    _ctx: OperationContext,
    event: OutputEvent,
    handler: AgentEventHandler,
  ): string {
    if (!VALID_OUTPUT_EVENTS.has(event)) {
      return ''; // Invalid event — return empty subscription ID
    }

    const subResult = events.subscribe(event, (eventPayload) => {
      try {
        handler({
          eventId: '' as unknown as import('../adapters/shared/types.js').EventId,
          event: event as AgentEvent,
          timestamp: time.nowISO(),
          adapterId: '' as unknown as import('../adapters/shared/types.js').AdapterId,
          sessionId: sessionId as unknown as import('../adapters/shared/types.js').SessionId,
          agentId: agentId as unknown as import('../adapters/shared/types.js').AgentId,
          data: eventPayload.payload as Readonly<Record<string, unknown>>,
        });
      } catch { /* handler error isolation */ }
    });

    if (!subResult.ok) {
      return '';
    }

    subscriptions.set(subResult.value, event);
    return subResult.value;
  }

  function off(
    _ctx: OperationContext,
    subscriptionId: string,
  ): void {
    if (subscriptions.has(subscriptionId)) {
      try { events.unsubscribe(subscriptionId); } catch { /* non-fatal */ }
      subscriptions.delete(subscriptionId);
    }
  }

  // ========================================================================
  // Return frozen client
  // ========================================================================

  return {
    produce,
    queryOutputs,
    retractOutput,
    recordCost,
    recordVital,
    queryCosts,
    queryVitals,
    getBudgetConsumption,
    infer: inferMethod,
    installPlugin,
    uninstallPlugin,
    listPlugins,
    registerHook,
    unregisterHook,
    listHooks,
    on,
    off,
  };
}
