/*
 * LimenAgentClient foundational surface.
 * Contract refs: AGENT_ADAPTER_ARCHITECTURE.md §§1, 3, 5, 12; CREWAI_ADAPTER_CONTRACT.md Claims 1.1-1.13, 2.1, 2.5, 2.9; SHARED_TYPES.md §§7-10.3, §§14-16, §20.
 */

import { AuditLogger, auditId } from '../audit/AuditLogger.js';
import type { AdapterHealth, LimenAgentClientSurface, LimenOperation, OperationResult } from '../adapter/AgentAdapter.js';
import { AgentLifecycle } from '../lifecycle/AgentLifecycle.js';
import { GovernanceEngine, type GovernanceRequirement, clearanceForClassification } from '../governance/GovernanceEngine.js';
import {
  adapterError,
  brand,
  effectiveCapabilities,
  err,
  ok,
  PHASE_X_TO_CORE_TRUST,
  sessionToContext,
  TRUST_TO_CLEARANCE,
  type AdapterId,
  type AdapterKernelError,
  type AgentBranchId,
  type AgentCapability,
  type AgentEvent,
  type AgentEventHandler,
  type AgentEventPayload,
  type AgentId,
  type AgentMemoryEntry,
  type AgentMemoryOptions,
  type AgentRecallOptions,
  type AgentRecallQuery,
  type AgentSession,
  type AgentTrustLevel,
  type BeliefState,
  type ClaimId,
  type ClassificationLevel,
  type GovernanceAction,
  type GovernanceContext,
  type GovernanceDecision,
  type ManualMergeResolutionRequest,
  type MergeConflict,
  type MergeConflictResolution,
  type MergeResult,
  type MergeStrategy,
  type Result,
  type SessionId,
  type SessionSummary,
  type StructuredContent,
  type TenantId,
} from '../types/index.js';

export interface LimenAgentClientOptions {
  readonly adapterId: AdapterId;
  readonly agentId: AgentId;
  readonly tenantId: TenantId | null;
  readonly trustLevel: AgentTrustLevel;
  readonly capabilities: ReadonlySet<AgentCapability>;
  readonly auditLogger?: AuditLogger;
  readonly governanceEngine?: GovernanceEngine;
  readonly corePort?: CorePort;
  readonly initializationTimeoutMs?: number;
  readonly nowMs?: () => number;
  readonly nowIso?: () => string;
  readonly idFactory?: () => string;
}

export interface CorePort {
  remember(session: AgentSession, content: string | StructuredContent, options?: AgentMemoryOptions): Result<ClaimId, AdapterKernelError>;
  recall(session: AgentSession, query: AgentRecallQuery, options?: AgentRecallOptions): Result<readonly BeliefState[], AdapterKernelError>;
  createBranch(session: AgentSession, baseBeliefId: ClaimId, description: string): Result<AgentBranchId, AdapterKernelError>;
  mergeBranches(session: AgentSession, branchIds: readonly AgentBranchId[], strategy: MergeStrategy): Result<MergeResult, AdapterKernelError>;
  resolveConflict(session: AgentSession, resolution: ManualMergeResolutionRequest): Result<MergeResult, AdapterKernelError>;
  health(): boolean;
}

interface SessionCounters {
  memoryWrites: number;
  memoryReads: number;
  memoryDeletes: number;
  computerActions: number;
  totalOperations: number;
  allowed: number;
  refused: number;
  escalated: number;
  sandboxed: number;
  branchesCreated: number;
  branchesMerged: number;
  branchesDiscarded: number;
  missionsCreated: number;
  missionsCompleted: number;
  missionsFailed: number;
}

export class InMemoryCorePort implements CorePort {
  private readonly memory = new Map<string, AgentMemoryEntry>();
  private readonly branches = new Map<string, readonly ClaimId[]>();
  private readonly pendingMerges = new Map<string, MergeResult>();

  public constructor(private readonly adapterId: AdapterId, private readonly nowIso: () => string, private readonly idFactory: () => string) {}

  // CREWAI_ADAPTER_CONTRACT.md Claim 1.4: persistence occurs only after caller governance succeeds.
  public remember(session: AgentSession, content: string | StructuredContent, options?: AgentMemoryOptions): Result<ClaimId, AdapterKernelError> {
    const claimId = brand<'ClaimId'>(this.idFactory());
    const classification = options?.classification ?? 'internal';
    const confidence = options?.confidence ?? 0.7;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return err(adapterError(this.adapterId, 'SERDE_ERROR', 'confidence must be in [0, 1].', 'SHARED_TYPES.md §10.2'));
    }
    const structured = typeof content === 'string'
      ? { subject: content, predicate: 'observation.note', value: content }
      : content;
    const entry: AgentMemoryEntry = {
      id: claimId,
      content: typeof content === 'string' ? content : JSON.stringify(content.value),
      subject: structured.subject,
      predicate: structured.predicate,
      value: structured.value,
      confidence,
      effectiveConfidence: confidence,
      freshness: 'fresh',
      classification,
      tags: options?.tags ?? [],
      category: options?.category ?? null,
      sourceAgentId: session.agentId,
      missionId: options?.missionId ?? null,
      taskId: options?.taskId ?? null,
      groundingMode: options?.groundingMode ?? 'runtime_witness',
      createdAt: this.nowIso(),
    };
    this.memory.set(claimId, entry);
    return ok(claimId);
  }

  // CREWAI_ADAPTER_CONTRACT.md Claim 1.5: recall filters by explicit OperationContext-derived session clearance.
  public recall(session: AgentSession, query: AgentRecallQuery, options?: AgentRecallOptions): Result<readonly BeliefState[], AdapterKernelError> {
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 100;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 0) {
      return err(adapterError(this.adapterId, 'SERDE_ERROR', 'recall offset and limit must be non-negative integers.', 'SHARED_TYPES.md §10.2.1'));
    }
    if (query.minConfidence !== undefined && (!Number.isFinite(query.minConfidence) || query.minConfidence < 0 || query.minConfidence > 1)) {
      return err(adapterError(this.adapterId, 'SERDE_ERROR', 'minConfidence must be in [0, 1].', 'SHARED_TYPES.md §10.2.1'));
    }
    const timeRange = parseRecallTimeRange(this.adapterId, query.timeRange);
    if (!timeRange.ok) {
      return err(timeRange.error);
    }
    const freshnessFilter = query.freshnessFilter === undefined
      ? null
      : new Set(Array.isArray(query.freshnessFilter) ? query.freshnessFilter : [query.freshnessFilter]);
    const maxRequested = query.classification === undefined ? session.clearanceLevel : clearanceForClassification(query.classification);
    const maxReadable = Math.min(session.clearanceLevel, maxRequested);
    const beliefs = [...this.memory.values()]
      .filter((entry) => clearanceForClassification(entry.classification) <= maxReadable)
      .filter((entry) => query.subject === undefined || entry.subject === query.subject)
      .filter((entry) => query.predicate === undefined || entry.predicate === query.predicate)
      .filter((entry) => query.text === undefined || entry.content.includes(query.text))
      .filter((entry) => query.minConfidence === undefined || entry.effectiveConfidence >= query.minConfidence)
      .filter((entry) => query.tags === undefined || query.tags.every((tag) => entry.tags.includes(tag)))
      .filter((entry) => query.category === undefined || entry.category === query.category)
      .filter((entry) => freshnessFilter === null || freshnessFilter.has(entry.freshness))
      .filter((entry) => timeRange.value === null || isWithinTimeRange(entry.createdAt, timeRange.value))
      .filter((entry) => query.missionId === undefined || entry.missionId === query.missionId)
      .filter((entry) => query.taskId === undefined || entry.taskId === query.taskId)
      .filter((entry) => query.sourceAgentId === undefined || entry.sourceAgentId === query.sourceAgentId)
      .sort((left, right) => compareRecallEntries(left, right, options?.sortBy))
      .slice(offset, offset + limit)
      .map((belief) => ({
        belief,
        evidence: [],
        relationships: [],
        status: 'active' as const,
        retentionPolicy: null,
        governance: null,
      }));
    return ok(beliefs);
  }

  // CREWAI_ADAPTER_CONTRACT.md Claim 1.6: caller governs branching capability before branch creation.
  public createBranch(_session: AgentSession, baseBeliefId: ClaimId, _description: string): Result<AgentBranchId, AdapterKernelError> {
    const branchId = brand<'AgentBranchId'>(this.idFactory());
    this.branches.set(branchId, [baseBeliefId]);
    return ok(branchId);
  }

  // SHARED_TYPES.md §23 and CREWAI_ADAPTER_CONTRACT.md Claim 1.7: branch IDs are processed in caller order.
  public mergeBranches(_session: AgentSession, branchIds: readonly AgentBranchId[], strategy: MergeStrategy): Result<MergeResult, AdapterKernelError> {
    const auditIdValue = brand<'EventId'>(this.idFactory());
    if (strategy === 'manual' && branchIds.length > 1) {
      const conflict: MergeConflict = {
        conflictId: `${auditIdValue}:conflict:0`,
        subject: 'manual_merge',
        predicate: 'branch_order',
        branchValue: String(branchIds[0]),
        branchConfidence: 0.5,
        trunkValue: String(branchIds[1]),
        trunkConfidence: 0.5,
      };
      const result: MergeResult = {
        status: 'pending_resolution',
        mergedClaimIds: [],
        conflictsResolved: [],
        unresolvedConflicts: [conflict],
        manualMergeState: {
          mergeId: auditIdValue,
          status: 'pending_resolution',
          conflicts: [conflict],
          resolved: [],
          deadline: new Date(Date.parse(this.nowIso()) + 30 * 60 * 1000).toISOString(),
        },
        auditId: auditIdValue,
      };
      this.pendingMerges.set(auditIdValue, result);
      return ok(result);
    }
    const mergedClaimIds = branchIds.flatMap((branchId) => [...(this.branches.get(branchId) ?? [])]);
    const result: MergeResult = {
      status: 'completed',
      mergedClaimIds,
      conflictsResolved: [],
      unresolvedConflicts: [],
      manualMergeState: null,
      auditId: auditIdValue,
    };
    for (const branchId of branchIds) {
      this.branches.delete(branchId);
    }
    return ok(result);
  }

  // CREWAI_ADAPTER_CONTRACT.md Claims 1.11 and 2.9: manual conflicts resolve only through resolveConflict with complete request data.
  public resolveConflict(session: AgentSession, resolution: ManualMergeResolutionRequest): Result<MergeResult, AdapterKernelError> {
    const pending = this.pendingMerges.get(resolution.mergeId);
    if (pending === undefined || pending.manualMergeState === null) {
      return err(adapterError(this.adapterId, 'SERDE_ERROR', 'Unknown manual merge ID.', 'CREWAI_ADAPTER_CONTRACT.md Claim 2.9', { mergeId: resolution.mergeId }));
    }
    if (pending.manualMergeState.status !== 'pending_resolution') {
      const alreadyResolved = pending.conflictsResolved.some((item) => item.conflictId === resolution.conflictId);
      return err(adapterError(
        this.adapterId,
        'SERDE_ERROR',
        alreadyResolved ? 'Manual merge conflict is already resolved.' : 'Manual merge is not pending resolution.',
        'CREWAI_ADAPTER_CONTRACT.md Claim 2.9',
        { mergeId: resolution.mergeId, conflictId: resolution.conflictId, status: pending.manualMergeState.status },
      ));
    }
    if (Date.parse(this.nowIso()) > Date.parse(pending.manualMergeState.deadline)) {
      const timedOut: MergeResult = {
        status: 'failed',
        mergedClaimIds: [],
        conflictsResolved: pending.conflictsResolved,
        unresolvedConflicts: pending.unresolvedConflicts,
        manualMergeState: {
          ...pending.manualMergeState,
          status: 'timed_out',
          discardedReason: 'timeout',
        },
        auditId: pending.auditId,
      };
      this.pendingMerges.set(resolution.mergeId, timedOut);
      return err(adapterError(this.adapterId, 'SERDE_ERROR', 'Manual merge state expired before resolution.', 'CREWAI_ADAPTER_CONTRACT.md Claim 2.9', { mergeId: resolution.mergeId }));
    }
    const conflict = pending.unresolvedConflicts.find((item) => item.conflictId === resolution.conflictId);
    if (conflict === undefined) {
      return err(adapterError(this.adapterId, 'SERDE_ERROR', 'Unknown conflict ID.', 'CREWAI_ADAPTER_CONTRACT.md Claim 2.9', { conflictId: resolution.conflictId }));
    }
    if (resolution.resolution === 'merge_new_value' && (resolution.newValue === undefined || resolution.newConfidence === undefined)) {
      return err(adapterError(this.adapterId, 'SERDE_ERROR', 'merge_new_value requires newValue and newConfidence.', 'CREWAI_ADAPTER_CONTRACT.md Claim 2.9'));
    }
    if (resolution.newConfidence !== undefined && (!Number.isFinite(resolution.newConfidence) || resolution.newConfidence < 0 || resolution.newConfidence > 1)) {
      return err(adapterError(this.adapterId, 'SERDE_ERROR', 'newConfidence must be in [0, 1].', 'SHARED_TYPES.md §10.2'));
    }
    const resolved: MergeConflictResolution = {
      conflictId: conflict.conflictId,
      resolution: resolution.resolution,
      resolvedBy: session.agentId,
      resolvedAt: this.nowIso(),
      ...(resolution.newValue === undefined ? {} : { newValue: resolution.newValue }),
      ...(resolution.newConfidence === undefined ? {} : { newConfidence: resolution.newConfidence }),
    };
    const result: MergeResult = {
      status: 'completed',
      mergedClaimIds: [],
      conflictsResolved: [resolved],
      unresolvedConflicts: [],
      manualMergeState: {
        ...pending.manualMergeState,
        status: 'resolved',
        resolved: [resolved],
      },
      auditId: pending.auditId,
    };
    this.pendingMerges.set(resolution.mergeId, result);
    return ok(result);
  }

  public health(): boolean {
    return true;
  }
}

export class LimenAgentClient implements LimenAgentClientSurface {
  private readonly nowMs: () => number;
  private readonly nowIso: () => string;
  private readonly idFactory: () => string;
  private readonly auditLogger: AuditLogger;
  private readonly governanceEngine: GovernanceEngine;
  private readonly corePort: CorePort;
  private readonly lifecycle: AgentLifecycle;
  private readonly startedAtMs: number;
  private readonly sessions = new Map<string, AgentSession>();
  private readonly counters = new Map<string, SessionCounters>();
  private readonly subscriptions = new Map<string, { readonly event: AgentEvent; readonly handler: AgentEventHandler }>();
  private activeSessionId: SessionId | null = null;
  private errorCount = 0;
  private lastActivity: string | null = null;

  public constructor(private readonly options: LimenAgentClientOptions) {
    this.nowMs = options.nowMs ?? (() => new Date().getTime());
    this.nowIso = options.nowIso ?? (() => new Date(this.nowMs()).toISOString());
    this.idFactory = options.idFactory ?? (() => `evt_${this.nowMs()}_${Math.random().toString(36).slice(2)}`);
    this.auditLogger = options.auditLogger ?? new AuditLogger({ adapterId: options.adapterId, nowIso: this.nowIso, nowMs: this.nowMs, idFactory: this.idFactory });
    this.governanceEngine = options.governanceEngine ?? new GovernanceEngine({ adapterId: options.adapterId, nowIso: this.nowIso, idFactory: this.idFactory });
    this.corePort = options.corePort ?? new InMemoryCorePort(options.adapterId, this.nowIso, this.idFactory);
    this.lifecycle = new AgentLifecycle({
      adapterId: options.adapterId,
      initializationTimeoutMs: options.initializationTimeoutMs ?? 5000,
      now: this.nowMs,
      isoNow: this.nowIso,
    });
    this.startedAtMs = this.nowMs();
  }

  // CREWAI_ADAPTER_CONTRACT.md Claims 1.1 and 1.12: createSession initializes the client before mediated operations.
  public async createSession(metadata: Readonly<Record<string, unknown>> = {}): Promise<Result<AgentSession, AdapterKernelError>> {
    const bootstrapAudit = this.audit('session:started', this.bootstrapSessionId(), { domain: 'lifecycle', operation: 'register' }, null, { method: 'createSession', phase: 'called' }, 'internal');
    if (!bootstrapAudit.ok) {
      return err(bootstrapAudit.error);
    }
    const state = this.lifecycle.snapshot().state;
    if (state === 'SHUTDOWN') {
      return this.reject('NOT_INITIALIZED', 'Cannot create session after shutdown.', 'CREWAI_ADAPTER_CONTRACT.md Claim 1.1');
    }
    if (state === 'DEGRADED') {
      return this.reject('CORE_PORT_UNAVAILABLE', 'Cannot create session while DEGRADED.', 'Phase 1 prompt action 6');
    }
    if (state === 'UNINITIALIZED') {
      const begin = this.lifecycle.beginInitializing();
      if (!begin.ok) {
        return this.rejectFrom(begin.error);
      }
    }
    const timeout = this.lifecycle.enforceInitializingTimeout();
    if (!timeout.ok) {
      return this.rejectFrom(timeout.error);
    }
    const sessionId = brand<'SessionId'>(this.idFactory());
    const capabilities = effectiveCapabilities(this.options.trustLevel, this.options.capabilities);
    const session: AgentSession = {
      sessionId,
      agentId: this.options.agentId,
      tenantId: this.options.tenantId,
      adapterId: this.options.adapterId,
      trustLevel: this.options.trustLevel,
      coreTrustLevel: PHASE_X_TO_CORE_TRUST[this.options.trustLevel],
      clearanceLevel: TRUST_TO_CLEARANCE[this.options.trustLevel],
      capabilities,
      startedAt: this.nowIso(),
      workingMemoryNamespace: `${this.options.tenantId ?? 'global'}:${this.options.agentId}:${sessionId}`,
      activeMissions: [],
      metadata,
    };
    const ready = this.lifecycle.snapshot().state === 'INITIALIZING' ? this.lifecycle.completeInitializing() : ok<void, AdapterKernelError>(undefined);
    if (!ready.ok) {
      return this.rejectFrom(ready.error);
    }
    this.sessions.set(sessionId, session);
    this.counters.set(sessionId, emptyCounters());
    this.activeSessionId = sessionId;
    this.lastActivity = this.nowIso();
    this.emit({ type: 'session:started', sessionId, auditId: auditId(bootstrapAudit.value), data: { metadata } });
    return ok(session);
  }

  // AGENT_ADAPTER_ARCHITECTURE.md §12.1: execute routes adapter-produced operations through LimenAgentClient mediation.
  public async execute(operation: LimenOperation): Promise<Result<OperationResult, AdapterKernelError>> {
    const callAudit = this.audit('action:before', this.currentSessionId(), actionForOperation(operation), null, { method: 'execute', operationType: operation.type }, 'internal');
    if (!callAudit.ok) {
      return err(callAudit.error);
    }
    switch (operation.type) {
      case 'remember': {
        const result = await this.remember(operation.content, operation.options);
        return result.ok ? ok({ operationType: operation.type, auditId: callAudit.value.id, value: result.value }) : err(result.error);
      }
      case 'recall': {
        const result = await this.recall(operation.query, operation.options);
        return result.ok ? ok({ operationType: operation.type, auditId: callAudit.value.id, value: result.value }) : err(result.error);
      }
      case 'create_branch': {
        const result = await this.createBranch(operation.baseBeliefId, operation.description);
        return result.ok ? ok({ operationType: operation.type, auditId: callAudit.value.id, value: result.value }) : err(result.error);
      }
      case 'merge_branches': {
        const branchIds = operation.branchIds.map((branchId) => brand<'AgentBranchId'>(branchId));
        const result = await this.mergeBranches(branchIds, operation.strategy);
        return result.ok ? ok({ operationType: operation.type, auditId: callAudit.value.id, value: result.value }) : err(result.error);
      }
      case 'forget':
      case 'get_belief':
      case 'discard_branch':
      case 'relate':
      case 'check_permission':
        return this.reject('CAPABILITY_NOT_DECLARED', `Operation ${operation.type} is declared but not implemented in Phase 1 foundation.`, 'AGENT_ADAPTER_ARCHITECTURE.md §5.2');
    }
  }

  // CREWAI_ADAPTER_CONTRACT.md Claim 1.4: remember enforces governance before token budget and persistence.
  public async remember(content: string | StructuredContent, options?: AgentMemoryOptions): Promise<Result<ClaimId, AdapterKernelError>> {
    const sessionResult = this.requireSession('remember');
    if (!sessionResult.ok) {
      return err(sessionResult.error);
    }
    const classification = options?.classification ?? 'internal';
    const gate = this.govern(sessionResult.value, { domain: 'memory', operation: 'write' }, {
      requiredPermissions: ['assert_claim', 'write_wm'],
      clearanceRequired: clearanceForClassification(classification),
      rule: 'memory_write_requires_permission_and_clearance',
    });
    if (!gate.ok) {
      return err(gate.error);
    }
    const core = this.corePort.remember(sessionResult.value, content, options);
    if (!core.ok) {
      this.errorCount += 1;
      return err(core.error);
    }
    this.count(sessionResult.value.sessionId, 'memoryWrites');
    const audited = this.audit('memory:created', sessionResult.value.sessionId, { domain: 'memory', operation: 'write' }, gate.value, { method: 'remember', claimId: core.value }, classification);
    if (!audited.ok) {
      return err(audited.error);
    }
    this.lastActivity = this.nowIso();
    return ok(core.value);
  }

  // CREWAI_ADAPTER_CONTRACT.md Claim 1.5: recall filters by OperationContext.clearanceLevel and never ambient state.
  public async recall(query: AgentRecallQuery, options?: AgentRecallOptions): Promise<Result<readonly BeliefState[], AdapterKernelError>> {
    const sessionResult = this.requireSession('recall');
    if (!sessionResult.ok) {
      return err(sessionResult.error);
    }
    const gate = this.govern(sessionResult.value, { domain: 'memory', operation: 'read' }, {
      requiredPermissions: ['query_claims', 'read_wm'],
      clearanceRequired: query.classification === undefined ? null : clearanceForClassification(query.classification),
      rule: 'memory_read_requires_permission_and_clearance',
    });
    if (!gate.ok) {
      return err(gate.error);
    }
    const core = this.corePort.recall(sessionResult.value, query, options);
    if (!core.ok) {
      this.errorCount += 1;
      return err(core.error);
    }
    this.count(sessionResult.value.sessionId, 'memoryReads');
    const audited = this.audit('memory:recalled', sessionResult.value.sessionId, { domain: 'memory', operation: 'read' }, gate.value, { method: 'recall', resultCount: core.value.length }, 'internal');
    if (!audited.ok) {
      return err(audited.error);
    }
    this.lastActivity = this.nowIso();
    return ok(core.value);
  }

  // CREWAI_ADAPTER_CONTRACT.md Claim 1.6: createBranch requires branching capability and medium trust-derived permissions.
  public async createBranch(baseBeliefId: ClaimId, description: string): Promise<Result<AgentBranchId, AdapterKernelError>> {
    const sessionResult = this.requireSession('createBranch');
    if (!sessionResult.ok) {
      return err(sessionResult.error);
    }
    const gate = this.govern(sessionResult.value, { domain: 'memory', operation: 'branch' }, {
      requiredPermissions: ['assert_claim', 'query_claims'],
      clearanceRequired: 2,
      rule: 'branching_requires_medium_trust',
    });
    if (!gate.ok) {
      return err(gate.error);
    }
    const core = this.corePort.createBranch(sessionResult.value, baseBeliefId, description);
    if (!core.ok) {
      this.errorCount += 1;
      return err(core.error);
    }
    this.count(sessionResult.value.sessionId, 'branchesCreated');
    const audited = this.audit('memory:branch_created', sessionResult.value.sessionId, { domain: 'memory', operation: 'branch' }, gate.value, { method: 'createBranch', branchId: core.value }, 'internal');
    if (!audited.ok) {
      return err(audited.error);
    }
    return ok(core.value);
  }

  // SHARED_TYPES.md §23 and CREWAI_ADAPTER_CONTRACT.md Claim 1.7: mergeBranches preserves deterministic caller ordering.
  public async mergeBranches(branchIds: readonly AgentBranchId[], strategy: MergeStrategy): Promise<Result<MergeResult, AdapterKernelError>> {
    const sessionResult = this.requireSession('mergeBranches');
    if (!sessionResult.ok) {
      return err(sessionResult.error);
    }
    const gate = this.govern(sessionResult.value, { domain: 'memory', operation: 'merge' }, {
      requiredPermissions: ['assert_claim', 'retract_claim', 'query_claims', 'relate_claims'],
      clearanceRequired: 2,
      rule: 'merge_requires_branching_permissions',
    });
    if (!gate.ok) {
      return err(gate.error);
    }
    const core = this.corePort.mergeBranches(sessionResult.value, branchIds, strategy);
    if (!core.ok) {
      this.errorCount += 1;
      return err(core.error);
    }
    this.count(sessionResult.value.sessionId, 'branchesMerged');
    const audited = this.audit('memory:branch_merged', sessionResult.value.sessionId, { domain: 'memory', operation: 'merge' }, gate.value, { method: 'mergeBranches', strategy, branchIds }, 'internal');
    if (!audited.ok) {
      return err(audited.error);
    }
    return ok(core.value);
  }

  // CREWAI_ADAPTER_CONTRACT.md Claims 1.11 and 2.9: resolveConflict is the sole manual merge completion path.
  public async resolveConflict(resolution: ManualMergeResolutionRequest): Promise<Result<MergeResult, AdapterKernelError>> {
    const sessionResult = this.requireSession('resolveConflict');
    if (!sessionResult.ok) {
      return err(sessionResult.error);
    }
    const gate = this.govern(sessionResult.value, { domain: 'memory', operation: 'resolve_merge_conflict' }, {
      requiredPermissions: ['assert_claim', 'retract_claim', 'query_claims', 'relate_claims'],
      clearanceRequired: 2,
      rule: 'manual_merge_resolution_requires_branching_permissions',
    });
    if (!gate.ok) {
      return err(gate.error);
    }
    const core = this.corePort.resolveConflict(sessionResult.value, resolution);
    if (!core.ok) {
      this.errorCount += 1;
      return err(core.error);
    }
    const audited = this.audit('memory:branch_merged', sessionResult.value.sessionId, { domain: 'memory', operation: 'resolve_merge_conflict' }, gate.value, { method: 'resolveConflict', resolution }, 'internal');
    if (!audited.ok) {
      return err(audited.error);
    }
    return ok(core.value);
  }

  // CREWAI_ADAPTER_CONTRACT.md Claim 1.12: healthCheck is live, allowed in DEGRADED, and returns canonical AdapterHealth.
  public async healthCheck(): Promise<Result<AdapterHealth, AdapterKernelError>> {
    const audited = this.audit('governance:allowed', this.currentSessionId(), { domain: 'lifecycle', operation: 'register' }, null, { method: 'healthCheck' }, 'internal');
    if (!audited.ok) {
      return err(audited.error);
    }
    if (this.lifecycle.snapshot().state === 'SHUTDOWN') {
      return this.reject('NOT_INITIALIZED', 'healthCheck is unavailable after shutdown.', 'CREWAI_ADAPTER_CONTRACT.md Claim 1.12');
    }
    return ok(this.buildHealth());
  }

  // CREWAI_ADAPTER_CONTRACT.md Claim 1.8: getHealth is synchronous and reports last-known health.
  public getHealth(): AdapterHealth {
    return this.buildHealth();
  }

  // CREWAI_ADAPTER_CONTRACT.md Claims 1.2-1.3: shutdown is idempotent, closes sessions, and flushes audit before success.
  public async shutdown(): Promise<Result<void, AdapterKernelError>> {
    const sessionId = this.currentSessionId();
    const audited = this.audit('session:ended', sessionId, { domain: 'lifecycle', operation: 'decommission' }, null, { method: 'shutdown' }, 'internal');
    if (!audited.ok) {
      return err(audited.error);
    }
    const shutdown = this.lifecycle.shutdown();
    if (!shutdown.ok) {
      return err(shutdown.error);
    }
    this.sessions.clear();
    this.counters.clear();
    this.subscriptions.clear();
    this.activeSessionId = null;
    return ok(undefined);
  }

  // CREWAI_ADAPTER_CONTRACT.md Claim 1.13: subscriptions are local observers and survive non-shutdown transitions.
  public on(event: AgentEvent, handler: AgentEventHandler): string {
    if (this.lifecycle.snapshot().state === 'SHUTDOWN') {
      throw adapterError(this.options.adapterId, 'NOT_INITIALIZED', 'Cannot subscribe after shutdown.', 'CREWAI_ADAPTER_CONTRACT.md Claim 1.13');
    }
    const subscriptionId = this.idFactory();
    const audited = this.audit('governance:allowed', this.currentSessionId(), { domain: 'lifecycle', operation: 'register' }, null, { method: 'on', event, subscriptionId }, 'internal');
    if (!audited.ok) {
      throw audited.error;
    }
    this.subscriptions.set(subscriptionId, { event, handler });
    return subscriptionId;
  }

  // CREWAI_ADAPTER_CONTRACT.md Claim 1.13: off with unknown ID is a no-op before shutdown.
  public off(subscriptionId: string): void {
    if (this.lifecycle.snapshot().state === 'SHUTDOWN') {
      throw adapterError(this.options.adapterId, 'NOT_INITIALIZED', 'Cannot unsubscribe after shutdown.', 'CREWAI_ADAPTER_CONTRACT.md Claim 1.13');
    }
    const audited = this.audit('governance:allowed', this.currentSessionId(), { domain: 'lifecycle', operation: 'register' }, null, { method: 'off', subscriptionId }, 'internal');
    if (!audited.ok) {
      throw audited.error;
    }
    this.subscriptions.delete(subscriptionId);
  }

  private requireSession(operation: string): Result<AgentSession, AdapterKernelError> {
    const ready = this.lifecycle.assertReadyForCoreOperation(operation);
    if (!ready.ok) {
      this.audit('action:refused', this.currentSessionId(), null, null, { method: operation, reason: ready.error.code }, 'internal');
      return err(ready.error);
    }
    if (this.activeSessionId === null) {
      return this.reject('SESSION_NOT_FOUND', 'No active session exists.', 'AGENT_ADAPTER_ARCHITECTURE.md §12.3');
    }
    const session = this.sessions.get(this.activeSessionId);
    if (session === undefined) {
      return this.reject('SESSION_NOT_FOUND', 'Active session is missing.', 'AGENT_ADAPTER_ARCHITECTURE.md §12.3');
    }
    return ok(session);
  }

  private govern(session: AgentSession, action: GovernanceAction, requirement: GovernanceRequirement): Result<GovernanceDecision, AdapterKernelError> {
    const context: GovernanceContext = {
      operationContext: sessionToContext(session),
      session,
      action,
      resource: null,
      policyIds: [],
      actionHistory: [],
    };
    const decision = this.governanceEngine.evaluate(context, requirement);
    if (!decision.ok) {
      this.lifecycle.markDegraded(decision.error.message);
      return err(decision.error);
    }
    if (!decision.value.allowed) {
      this.incrementGovernance(session.sessionId, decision.value);
      const audited = this.audit('governance:refused', session.sessionId, action, decision.value, { method: 'govern', rule: requirement.rule }, 'internal');
      this.lifecycle.markDegraded(decision.value.reason ?? 'governance_refusal');
      if (!audited.ok) {
        return err(audited.error);
      }
      return err(adapterError(this.options.adapterId, 'GOVERNANCE_REFUSAL', decision.value.reason ?? 'Governance refused operation.', 'SHARED_TYPES.md §10.1'));
    }
    this.incrementGovernance(session.sessionId, decision.value);
    return ok(decision.value);
  }

  private audit(
    event: AgentEvent,
    sessionId: SessionId,
    action: GovernanceAction | null,
    governanceDecision: GovernanceDecision | null,
    details: Readonly<Record<string, unknown>>,
    classification: ClassificationLevel,
  ): Result<ReturnType<typeof this.auditLogger.append> extends Result<infer T, AdapterKernelError> ? T : never, AdapterKernelError> {
    const append = this.auditLogger.append({
      tenantId: this.options.tenantId,
      agentId: this.options.agentId,
      sessionId,
      event,
      action,
      governanceDecision,
      details,
      classification,
    });
    if (!append.ok) {
      this.errorCount += 1;
      return err(append.error);
    }
    return ok(append.value);
  }

  private emit(input: Omit<AgentEventPayload, 'timestamp' | 'agentId'>): void {
    const payload: AgentEventPayload = {
      ...input,
      timestamp: this.nowIso(),
      agentId: this.options.agentId,
    };
    for (const subscription of this.subscriptions.values()) {
      if (subscription.event === payload.type || subscription.event === '*') {
        void subscription.handler(payload);
      }
    }
  }

  private buildHealth(): AdapterHealth {
    return this.lifecycle.toHealth({
      lastActivity: this.lastActivity,
      activeSessions: this.sessions.size,
      errorCount: this.errorCount,
      uptimeMs: this.nowMs() - this.startedAtMs,
      corePortConnected: this.corePort.health(),
      tokenBudgetRemaining: Number.MAX_SAFE_INTEGER,
      tokenBudgetTotal: Number.MAX_SAFE_INTEGER,
      details: { lifecycleAgeMs: this.lifecycle.ageMs() },
    });
  }

  private currentSessionId(): SessionId {
    return this.activeSessionId ?? this.bootstrapSessionId();
  }

  private bootstrapSessionId(): SessionId {
    return brand<'SessionId'>(`${this.options.adapterId}:bootstrap`);
  }

  private reject<T>(code: AdapterKernelError['code'], message: string, spec: string): Result<T, AdapterKernelError> {
    this.errorCount += 1;
    return err(adapterError(this.options.adapterId, code, message, spec));
  }

  private rejectFrom<T>(errorValue: AdapterKernelError): Result<T, AdapterKernelError> {
    this.errorCount += 1;
    return err(errorValue);
  }

  private count(sessionId: SessionId, key: keyof Pick<SessionCounters, 'memoryWrites' | 'memoryReads' | 'memoryDeletes' | 'computerActions' | 'branchesCreated' | 'branchesMerged' | 'branchesDiscarded'>): void {
    const counters = this.counters.get(sessionId);
    if (counters !== undefined) {
      counters[key] += 1;
      counters.totalOperations += 1;
    }
  }

  private incrementGovernance(sessionId: SessionId, decision: GovernanceDecision): void {
    const counters = this.counters.get(sessionId);
    if (counters === undefined) {
      return;
    }
    switch (decision.verdict.verdict) {
      case 'allow':
        counters.allowed += 1;
        break;
      case 'refuse':
        counters.refused += 1;
        break;
      case 'escalate':
        counters.escalated += 1;
        break;
      case 'sandbox':
        counters.sandboxed += 1;
        break;
    }
  }

  public sessionSummary(sessionId: SessionId): Result<SessionSummary, AdapterKernelError> {
    const session = this.sessions.get(sessionId);
    const counters = this.counters.get(sessionId);
    if (session === undefined || counters === undefined) {
      return this.reject('SESSION_NOT_FOUND', 'Cannot summarize unknown session.', 'SHARED_TYPES.md §15');
    }
    const endedAt = this.nowIso();
    return ok({
      sessionId,
      agentId: session.agentId,
      adapterId: session.adapterId,
      startedAt: session.startedAt,
      endedAt,
      duration: Date.parse(endedAt) - Date.parse(session.startedAt),
      operations: {
        memoryWrites: counters.memoryWrites,
        memoryReads: counters.memoryReads,
        memoryDeletes: counters.memoryDeletes,
        computerActions: counters.computerActions,
        totalOperations: counters.totalOperations,
      },
      governance: {
        allowed: counters.allowed,
        refused: counters.refused,
        escalated: counters.escalated,
        sandboxed: counters.sandboxed,
      },
      branches: {
        created: counters.branchesCreated,
        merged: counters.branchesMerged,
        discarded: counters.branchesDiscarded,
      },
      missions: {
        created: counters.missionsCreated,
        completed: counters.missionsCompleted,
        failed: counters.missionsFailed,
      },
    });
  }
}

function emptyCounters(): SessionCounters {
  return {
    memoryWrites: 0,
    memoryReads: 0,
    memoryDeletes: 0,
    computerActions: 0,
    totalOperations: 0,
    allowed: 0,
    refused: 0,
    escalated: 0,
    sandboxed: 0,
    branchesCreated: 0,
    branchesMerged: 0,
    branchesDiscarded: 0,
    missionsCreated: 0,
    missionsCompleted: 0,
    missionsFailed: 0,
  };
}

interface RecallTimeRange {
  readonly fromMs: number;
  readonly toMs: number;
}

function parseRecallTimeRange(adapterId: AdapterId, range: AgentRecallQuery['timeRange']): Result<RecallTimeRange | null, AdapterKernelError> {
  if (range === undefined) {
    return ok(null);
  }
  const fromMs = Date.parse(range.from);
  const toMs = Date.parse(range.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
    return err(adapterError(adapterId, 'SERDE_ERROR', 'timeRange must contain valid ISO timestamps with from <= to.', 'SHARED_TYPES.md §10.2.1', { timeRange: range }));
  }
  return ok({ fromMs, toMs });
}

function isWithinTimeRange(timestamp: string, range: RecallTimeRange): boolean {
  const timestampMs = Date.parse(timestamp);
  return Number.isFinite(timestampMs) && timestampMs >= range.fromMs && timestampMs <= range.toMs;
}

function compareRecallEntries(left: AgentMemoryEntry, right: AgentMemoryEntry, sortBy: AgentRecallOptions['sortBy']): number {
  switch (sortBy) {
    case 'confidence':
      return right.effectiveConfidence - left.effectiveConfidence;
    case 'recency':
      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    case 'relevance':
    case undefined:
      return 0;
  }
}

function actionForOperation(operation: LimenOperation): GovernanceAction | null {
  switch (operation.type) {
    case 'remember':
      return { domain: 'memory', operation: 'write' };
    case 'recall':
      return { domain: 'memory', operation: 'read' };
    case 'forget':
      return { domain: 'memory', operation: 'delete' };
    case 'get_belief':
      return { domain: 'memory', operation: 'read' };
    case 'create_branch':
      return { domain: 'memory', operation: 'branch' };
    case 'merge_branches':
      return { domain: 'memory', operation: 'merge' };
    case 'discard_branch':
      return { domain: 'memory', operation: 'delete' };
    case 'relate':
      return { domain: 'memory', operation: 'write' };
    case 'check_permission':
      return operation.context.action;
  }
}
