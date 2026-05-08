/**
 * BaseGovernedAdapter -- Abstract base for all framework adapters
 *
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 * Shared Types: SHARED_TYPES.md v1.4.1
 *
 * Implements the canonical AgentAdapter governance, lifecycle, audit, token budget,
 * and error handling logic. Framework-specific adapters extend this base and implement
 * the abstract hook/translation methods.
 *
 * Invariants enforced:
 * - INV-1: Pure translation (no belief cache)
 * - INV-2: Governance cannot be bypassed (readonly #governed = true)
 * - INV-3: Audit completeness
 * - INV-4: Capability immutability
 * - INV-5: Deterministic error resolution
 * - INV-6: Session isolation
 * - INV-8: Confidence monotonicity
 * - INV-9: Shutdown completeness
 * - INV-10: Budget non-negative
 * - INV-11: Canonical adapter surface
 * - INV-12: No local belief cache
 * - INV-13: Rate limit inheritance
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { AdapterLifecycle } from '../crewai/lifecycle.js';
import {
  CrewAIAdapterError,
  notInitialized,
  alreadyInitialized,
  governanceRefusal,
  budgetExceeded,
  unknownTool,
  corePortUnavailable,
  auditFailure,
  serdeError,
  sessionNotFound,
  clientError,
  capabilityNotDeclared,
  trustLevelInsufficient,
  internalError,
  toResultError,
} from '../crewai/errors.js';
import type {
  AdapterId,
  AgentId,
  AgentCapability,
  AgentFramework,
  AgentSession,
  AgentEventPayload,
  AgentEventHandler,
  AgentEvent,
  SessionSummary,
  OperationContext,
  StructuredContent,
  AgentRecallQuery,
  AgentRecallOptions,
  ClaimId,
  AgentBranchId,
  MergeStrategy,
  SessionId,
  EventId,
  GovernanceVerdict,
  GovernanceContext,
  GovernanceAction,
  NativeAgentAction,
  ComputerAction,
  LimenOperation,
  AgentToolCall,
  AdapterHealth,
  AdapterLifecycleState,
  Result,
  LimenAgentClient,
  ComputerActionGovernor,
  TokenEstimate,
  ManualMergeResolutionRequest,
  AgentMemoryOptions,
  TokenBudgetConfig,
  TokenEncoding,
  MergeResultData,
  BeliefState,
} from '../crewai/types.js';
import { TRUST_TO_CLEARANCE, TRUST_CONFIDENCE_CAPS } from '../crewai/types.js';
import type {
  BaseAdapterConfig,
  AdapterAuditDetails,
  RecallResult,
  MergeResult,
} from './types.js';

// ── Constants for token estimation ──
const AUDIT_OVERHEAD_TOKENS = 20;
const GOVERNANCE_OVERHEAD_TOKENS = 10;
const AVG_BELIEF_SIZE_TOKENS = 50;
const BRANCH_BASE_TOKENS = 30;
const AVG_CONFLICT_SIZE_TOKENS = 40;

/**
 * Abstract base class for all governed framework adapters.
 *
 * AGENT_ADAPTER_ARCHITECTURE.md S3 -- Implements the canonical AgentAdapter interface.
 * 5-state lifecycle: UNINITIALIZED -> INITIALIZING -> READY -> DEGRADED -> SHUTDOWN.
 *
 * Subclasses MUST implement:
 * - abstract get agentFramework
 * - abstract getWorkingMemoryNamespace(session start data)
 * - abstract getSessionMetadata(session start data)
 * - abstract translateFrameworkToolCall(toolCall) -- framework-specific tool translation
 * - abstract mapNativeEventImpl(event) / mapLimenEventImpl(event) -- event bridge
 * - abstract mapNativeTypeToComputerActionType(nativeType) -- action translation
 * - abstract getNativeTypeCapabilityMap() -- capability requirements for native action types
 * - abstract getKnownTools() -- list of known tool names
 * - abstract getAuditContext() -- framework-specific audit context fields
 */
export abstract class BaseGovernedAdapter<
  TConfig extends BaseAdapterConfig,
  TSessionStart extends { metadata: Readonly<Record<string, unknown>> },
  TSessionEnd extends { sessionId: SessionId; outcome: 'completed' | 'failed' | 'cancelled' | 'timeout'; metadata: Readonly<Record<string, unknown>> },
> {
  /** INV-2: Governance is non-optional. Cannot be bypassed. */
  readonly #governed = true;

  /** AGENT_ADAPTER_ARCHITECTURE.md S3 -- Adapter identity */
  readonly adapterId: AdapterId;
  /** AGENT_ADAPTER_ARCHITECTURE.md S3 -- Adapter version */
  readonly version: string = '1.0.0';
  /** AGENT_ADAPTER_ARCHITECTURE.md S3 -- Declared capabilities (INV-4: frozen after init) */
  readonly capabilities: ReadonlySet<AgentCapability>;

  // ── Internal State ──
  protected readonly _lifecycle = new AdapterLifecycle();
  protected _client: LimenAgentClient | null = null;
  protected _governor: ComputerActionGovernor | null = null;
  protected _config: TConfig | null = null;
  protected _configDigest: string | null = null;
  protected _corePortConnected: boolean = false;
  protected _errorCount: number = 0;
  protected _lastError: string | undefined;
  protected _lastActivity: string | null = null;

  // Session tracking (INV-6: per-adapter isolation)
  protected readonly _sessions = new Map<string, AgentSession>();

  // Token budget tracking (INV-10: non-negative)
  protected _tokenBudgetConsumed: number = 0;
  protected _tokenBudgetTotal: number = 0;
  protected _warningEmitted: boolean = false;
  protected _lastOperationEstimate: TokenEstimate | null = null;

  // Event subscriptions
  protected readonly _subscriptions = new Map<string, { event: AgentEvent; handler: AgentEventHandler }>();
  protected _nextSubscriptionId: number = 0;

  // Audit tracking
  protected readonly _auditEntries: Array<Partial<AdapterAuditDetails>> = [];
  protected _auditFailureInjected: boolean = false;
  protected _postAuditFailureInjected: boolean = false;
  protected _auditCallCount: number = 0;

  // Agent state simulation (for governance)
  protected _agentState: 'active' | 'suspended' | 'decommissioned' = 'active';

  constructor(adapterId: AdapterId, capabilities: ReadonlySet<AgentCapability>) {
    this.adapterId = adapterId;
    this.capabilities = capabilities;
  }

  // ── Abstract: Subclass MUST implement ──

  /** Framework identifier from SHARED_TYPES.md S21 */
  abstract get agentFramework(): AgentFramework;

  /** Build the working memory namespace for a new session */
  protected abstract getWorkingMemoryNamespace(nativeSession: TSessionStart): string;

  /** Build framework-specific session metadata */
  protected abstract getSessionMetadata(nativeSession: TSessionStart): Readonly<Record<string, unknown>>;

  /** Translate a framework-specific tool call to LimenOperations. Return null for unknown tools. */
  protected abstract translateFrameworkToolCall(toolCall: AgentToolCall): LimenOperation[] | null;

  /** Map framework-native event to Limen event payload. Return null if no mapping. */
  protected abstract mapNativeEventImpl(
    nativeEvent: unknown,
    adapterId: AdapterId,
    agentId: AgentId,
    sessionId: SessionId | null,
  ): AgentEventPayload | null;

  /** Map Limen event back to framework-native event. Return null if no mapping. */
  protected abstract mapLimenEventImpl(limenEvent: AgentEventPayload): unknown | null;

  /** Map a native action type string to a canonical ComputerActionType string. */
  protected abstract mapNativeTypeToComputerActionType(nativeType: string): string;

  /** Return the mapping of native action types to required AgentCapability. */
  protected abstract getNativeTypeCapabilityMap(): Readonly<Record<string, AgentCapability>>;

  /** Return the list of known tool names for UNKNOWN_TOOL error reporting. */
  protected abstract getKnownTools(): readonly string[];

  /** Return framework-specific audit context fields. */
  protected abstract getAuditContext(): Readonly<Record<string, unknown>>;

  /** Validate framework-specific config fields. Return error or null. */
  protected abstract validateFrameworkConfig(config: TConfig): CrewAIAdapterError | null;

  // ── Public: Lifecycle ──

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S8.1 --
   * Initialize the adapter. Idempotent with same config. Terminal after SHUTDOWN.
   */
  async initialize(
    client: LimenAgentClient,
    governor: ComputerActionGovernor,
    config: TConfig,
  ): Promise<Result<void>> {
    if (this._lifecycle.isShutdown()) {
      return toResultError(notInitialized(this.adapterId));
    }
    if (this._lifecycle.isDegraded()) {
      return toResultError(alreadyInitialized(this.adapterId));
    }
    if (this._lifecycle.state === 'READY') {
      const digest = this._computeConfigDigest(config);
      if (digest === this._configDigest) {
        return { ok: true, value: undefined };
      }
      return toResultError(alreadyInitialized(this.adapterId));
    }
    if (!this._lifecycle.isUninitialized()) {
      return toResultError(alreadyInitialized(this.adapterId));
    }

    // Validate base config
    const baseErr = this._validateBaseConfig(config);
    if (baseErr) return toResultError(baseErr);

    // Validate framework-specific config
    const fwErr = this.validateFrameworkConfig(config);
    if (fwErr) return toResultError(fwErr);

    this._lifecycle.transition('INITIALIZING');

    try {
      this._client = client;
      this._governor = governor;
      this._config = config;
      this._configDigest = this._computeConfigDigest(config);
      this._tokenBudgetTotal = config.tokenBudget.maxTokensPerSession;
      this._tokenBudgetConsumed = 0;
      this._warningEmitted = false;
      this._corePortConnected = true;

      const auditResult = await this._appendAudit('initialize', 'not_applicable', 0);
      if (!auditResult.ok) {
        this._lifecycle.transition('UNINITIALIZED');
        this._client = null;
        this._governor = null;
        this._config = null;
        this._configDigest = null;
        return toResultError(auditFailure(this.adapterId, 'initialize', 'Failed to record initialization audit'));
      }

      this._lifecycle.transition('READY');
      this._lastActivity = new Date().toISOString();

      return { ok: true, value: undefined };
    } catch (err) {
      this._lifecycle.transition('UNINITIALIZED');
      this._client = null;
      this._governor = null;
      this._config = null;
      this._configDigest = null;
      this._errorCount++;
      this._lastError = String(err);
      return toResultError(internalError(this.adapterId, String(err)));
    }
  }

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S8.1 --
   * Shutdown the adapter. Idempotent. Closes all sessions.
   */
  async shutdown(): Promise<Result<void>> {
    if (this._lifecycle.isShutdown()) {
      return { ok: true, value: undefined };
    }
    if (this._lifecycle.isUninitialized()) {
      this._lifecycle.transition('SHUTDOWN');
      return { ok: true, value: undefined };
    }
    if (this._lifecycle.state === 'INITIALIZING') {
      this._lifecycle.transition('SHUTDOWN');
      this._clearSubscriptions();
      return { ok: true, value: undefined };
    }

    this._lifecycle.transition('SHUTDOWN');

    for (const [sessionId] of this._sessions) {
      try {
        if (this._client) {
          await this._client.endSession(sessionId as SessionId);
        }
        await this._appendAuditRaw({ operationType: 'onAgentSessionEnd', tokenCost: 0, governanceState: 'not_applicable', duration: 0 });
      } catch {
        // Best-effort in shutdown
      }
    }
    this._sessions.clear();

    await this._appendAuditRaw({ operationType: 'shutdown', tokenCost: 0, governanceState: 'not_applicable', duration: 0, ...this.getAuditContext() });
    this._clearSubscriptions();
    this._corePortConnected = false;

    return { ok: true, value: undefined };
  }

  // ── Public: Session Bridge ──

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S3 --
   * Start a framework agent session.
   */
  async onAgentSessionStart(nativeSession: TSessionStart): Promise<Result<AgentSession>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    if (this._agentState !== 'active') {
      const refVerdict: GovernanceVerdict = {
        verdict: 'refuse',
        auditId: `evt-state-${Date.now()}` as EventId,
        reason: 'agent_state_not_active',
        rule: 'agent_state_check',
      };
      return toResultError(governanceRefusal(this.adapterId, 'onAgentSessionStart', 'agent_state_not_active', 'agent_state_check', refVerdict));
    }

    const config = this._config!;
    const sessionId = randomUUID() as unknown as SessionId;

    const session: AgentSession = {
      sessionId,
      agentId: config.agentId,
      tenantId: config.tenantId,
      adapterId: this.adapterId,
      trustLevel: config.trustLevel,
      coreTrustLevel: config.trustLevel === 'verified' ? 'admin' :
        config.trustLevel === 'high' || config.trustLevel === 'medium' ? 'trusted' :
          config.trustLevel === 'low' ? 'probationary' : 'untrusted',
      clearanceLevel: TRUST_TO_CLEARANCE[config.trustLevel],
      capabilities: config.capabilities,
      startedAt: new Date().toISOString(),
      workingMemoryNamespace: this.getWorkingMemoryNamespace(nativeSession),
      activeMissions: [],
      metadata: this.getSessionMetadata(nativeSession),
    };

    this._sessions.set(sessionId as string, session);
    this._lastActivity = new Date().toISOString();

    const auditResult = await this._appendAudit('onAgentSessionStart', 'not_applicable', 0);
    if (!auditResult.ok) {
      this._sessions.delete(sessionId as string);
      return toResultError(auditFailure(this.adapterId, 'onAgentSessionStart', 'Failed to record audit'));
    }

    return { ok: true, value: session };
  }

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S3 --
   * End a framework agent session.
   */
  async onAgentSessionEnd(nativeSession: TSessionEnd): Promise<Result<SessionSummary>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    if (this._agentState !== 'active') {
      const refVerdict: GovernanceVerdict = {
        verdict: 'refuse',
        auditId: `evt-state-${Date.now()}` as EventId,
        reason: 'agent_state_not_active',
        rule: 'agent_state_check',
      };
      return toResultError(governanceRefusal(this.adapterId, 'onAgentSessionEnd', 'agent_state_not_active', 'agent_state_check', refVerdict));
    }

    const session = this._sessions.get(nativeSession.sessionId as string);
    if (!session) {
      return toResultError(sessionNotFound(this.adapterId, nativeSession.sessionId as string));
    }

    const summary: SessionSummary = {
      sessionId: nativeSession.sessionId,
      agentId: session.agentId,
      duration: Date.now() - new Date(session.startedAt).getTime(),
      operationCount: 0,
      governanceRefusals: 0,
      branchesCreated: 0,
      branchesMerged: 0,
      missionsCompleted: 0,
      tokensBudgetUsed: this._tokenBudgetConsumed,
      outcome: nativeSession.outcome,
    };

    this._sessions.delete(nativeSession.sessionId as string);
    this._lastActivity = new Date().toISOString();

    await this._appendAudit('onAgentSessionEnd', 'not_applicable', 0);
    return { ok: true, value: summary };
  }

  // ── Public: Memory Operations ──

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S3, governed memory write.
   * Authorization-first: governance -> trust -> capability -> budget -> audit -> write.
   */
  async remember(
    ctx: OperationContext,
    content: string | StructuredContent,
    options?: AgentMemoryOptions,
  ): Promise<Result<ClaimId>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    const session = this._getSessionFromCtx(ctx);
    if (!session) return toResultError(sessionNotFound(this.adapterId, ctx.sessionId || 'unknown'));

    const govAction: GovernanceAction = { domain: 'memory', operation: 'write' };
    const govResult = await this._evaluateGovernance(ctx, session, govAction, 'remember');
    if (govResult) return toResultError(govResult);

    if (this._config!.trustLevel === 'untrusted') {
      await this._appendAudit('remember', 'refused', 0, { errorCode: 'TRUST_LEVEL_INSUFFICIENT' });
      return toResultError(trustLevelInsufficient(this.adapterId, 'low', 'untrusted'));
    }

    if (!this.capabilities.has('memory_write')) {
      await this._appendAudit('remember', 'refused', 0, { errorCode: 'CAPABILITY_NOT_DECLARED' });
      return toResultError(capabilityNotDeclared(this.adapterId, 'memory_write'));
    }

    const estimatedTokens = this._estimateRememberTokens(content, options);
    const budgetErr = this._checkTokenBudget(estimatedTokens);
    if (budgetErr) {
      await this._appendAudit('remember', 'allowed', estimatedTokens, { errorCode: 'BUDGET_EXCEEDED' });
      return toResultError(budgetErr);
    }

    this._auditCallCount = 0;
    const preAudit = await this._appendAudit('remember', 'allowed', estimatedTokens);
    if (!preAudit.ok) {
      return toResultError(auditFailure(this.adapterId, 'remember', 'Pre-operation audit failed'));
    }

    const cappedOptions = this._applyConfidenceCap(options);

    try {
      const claimId = await this._client!.remember(ctx, content, cappedOptions);

      this._auditCallCount = 1;
      const postAudit = await this._appendAudit('remember', 'allowed', estimatedTokens, { beliefIds: [claimId] });
      if (!postAudit.ok) {
        this._emitEvent('audit:post_operation_failure', session, { operation: 'remember', claimId, reason: 'Post-operation audit failed' });
        return toResultError(auditFailure(this.adapterId, 'remember', 'Post-operation audit failed'));
      }

      this._consumeTokens(estimatedTokens);
      this._lastActivity = new Date().toISOString();
      return { ok: true, value: claimId };
    } catch (err) {
      await this._appendAudit('remember', 'allowed', estimatedTokens, { errorCode: 'CLIENT_ERROR' });
      return toResultError(clientError(this.adapterId, 'LimenAgentClient', String(err)));
    }
  }

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S3, governed memory read.
   * memory_read is implicitly granted at all trust levels.
   */
  async recall(
    ctx: OperationContext,
    query: AgentRecallQuery,
    options?: AgentRecallOptions,
  ): Promise<Result<RecallResult>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    const session = this._getSessionFromCtx(ctx);
    if (!session) return toResultError(sessionNotFound(this.adapterId, ctx.sessionId || 'unknown'));

    const govAction: GovernanceAction = { domain: 'memory', operation: 'read' };
    const govResult = await this._evaluateGovernance(ctx, session, govAction, 'recall');
    if (govResult) return toResultError(govResult);

    const estimatedTokens = this._estimateRecallTokens(query, options);
    const budgetErr = this._checkTokenBudget(estimatedTokens);
    if (budgetErr) {
      await this._appendAudit('recall', 'allowed', estimatedTokens, { errorCode: 'BUDGET_EXCEEDED' });
      return toResultError(budgetErr);
    }

    this._auditCallCount = 0;
    const preAudit = await this._appendAudit('recall', 'allowed', estimatedTokens);
    if (!preAudit.ok) {
      return toResultError(auditFailure(this.adapterId, 'recall', 'Pre-operation audit failed'));
    }

    try {
      const result = await this._client!.recall(ctx, query, options);
      const clearance = ctx.clearanceLevel ?? 0;
      const filteredBeliefs = result.beliefs.filter((b: BeliefState) => {
        const classNum = classificationToNum(b.belief.classification);
        return classNum <= clearance;
      });
      const truncated = filteredBeliefs.length < result.totalCount;

      const tokenEstimate: TokenEstimate = {
        tokens: estimatedTokens,
        encoding: this._config!.tokenBudget.encoding,
        overflow: false,
        components: { query: estimatedTokens },
      };

      const recallResult: RecallResult = { beliefs: filteredBeliefs, totalCount: result.totalCount, truncated, tokenEstimate };

      this._auditCallCount = 1;
      const postAudit = await this._appendAudit('recall', 'allowed', estimatedTokens);
      if (!postAudit.ok) {
        this._emitEvent('audit:post_operation_failure', session, { operation: 'recall', reason: 'Post-operation audit failed' });
        return toResultError(auditFailure(this.adapterId, 'recall', 'Post-operation audit failed'));
      }

      this._consumeTokens(estimatedTokens);
      this._lastActivity = new Date().toISOString();
      return { ok: true, value: recallResult };
    } catch (err) {
      await this._appendAudit('recall', 'allowed', estimatedTokens, { errorCode: 'CLIENT_ERROR' });
      return toResultError(clientError(this.adapterId, 'LimenAgentClient', String(err)));
    }
  }

  // ── Public: Branch Operations ──

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S3 -- Create a branch.
   * Requires 'branching' capability, minimum trust: medium.
   */
  async createBranch(
    ctx: OperationContext,
    baseBeliefId: ClaimId,
    description: string,
  ): Promise<Result<AgentBranchId>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    const session = this._getSessionFromCtx(ctx);
    if (!session) return toResultError(sessionNotFound(this.adapterId, ctx.sessionId || 'unknown'));

    const govAction: GovernanceAction = { domain: 'memory', operation: 'branch' };
    const govResult = await this._evaluateGovernance(ctx, session, govAction, 'createBranch');
    if (govResult) return toResultError(govResult);

    const trustOrder = ['untrusted', 'low', 'medium', 'high', 'verified'];
    if (trustOrder.indexOf(this._config!.trustLevel) < trustOrder.indexOf('medium')) {
      return toResultError(trustLevelInsufficient(this.adapterId, 'medium', this._config!.trustLevel));
    }

    if (!this.capabilities.has('branching')) {
      return toResultError(capabilityNotDeclared(this.adapterId, 'branching'));
    }

    const estimatedTokens = this._estimateBranchTokens(description);
    const budgetErr = this._checkTokenBudget(estimatedTokens);
    if (budgetErr) return toResultError(budgetErr);

    this._auditCallCount = 0;
    const preAudit = await this._appendAudit('createBranch', 'allowed', estimatedTokens);
    if (!preAudit.ok) {
      return toResultError(auditFailure(this.adapterId, 'createBranch', 'Pre-operation audit failed'));
    }

    try {
      const branchId = await this._client!.createBranch(ctx, baseBeliefId, description);
      this._auditCallCount = 1;
      const postAudit = await this._appendAudit('createBranch', 'allowed', estimatedTokens, { branchIds: [branchId] });
      if (!postAudit.ok) {
        this._emitEvent('audit:post_operation_failure', session, { operation: 'createBranch', branchId });
        return toResultError(auditFailure(this.adapterId, 'createBranch', 'Post-operation audit failed'));
      }
      this._consumeTokens(estimatedTokens);
      this._lastActivity = new Date().toISOString();
      return { ok: true, value: branchId };
    } catch (err) {
      return toResultError(clientError(this.adapterId, 'LimenAgentClient', String(err)));
    }
  }

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S3 -- Merge branches.
   */
  async mergeBranches(
    ctx: OperationContext,
    branchIds: readonly AgentBranchId[],
    strategy: MergeStrategy,
  ): Promise<Result<MergeResult>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    const session = this._getSessionFromCtx(ctx);
    if (!session) return toResultError(sessionNotFound(this.adapterId, ctx.sessionId || 'unknown'));

    const govAction: GovernanceAction = { domain: 'memory', operation: 'merge' };
    const govResult = await this._evaluateGovernance(ctx, session, govAction, 'mergeBranches');
    if (govResult) return toResultError(govResult);

    const trustOrder = ['untrusted', 'low', 'medium', 'high', 'verified'];
    if (trustOrder.indexOf(this._config!.trustLevel) < trustOrder.indexOf('medium')) {
      return toResultError(trustLevelInsufficient(this.adapterId, 'medium', this._config!.trustLevel));
    }

    if (!this.capabilities.has('branching')) {
      return toResultError(capabilityNotDeclared(this.adapterId, 'branching'));
    }

    const estimatedTokens = this._estimateMergeTokens(branchIds);
    const budgetErr = this._checkTokenBudget(estimatedTokens);
    if (budgetErr) return toResultError(budgetErr);

    this._auditCallCount = 0;
    const preAudit = await this._appendAudit('mergeBranches', 'allowed', estimatedTokens);
    if (!preAudit.ok) {
      return toResultError(auditFailure(this.adapterId, 'mergeBranches', 'Pre-operation audit failed'));
    }

    try {
      const coreResult = await this._client!.mergeBranches(ctx, branchIds, strategy);
      const auditId = `evt-merge-${Date.now()}` as EventId;
      const mergeResult: MergeResult = { ...coreResult, auditId };

      this._auditCallCount = 1;
      await this._appendAudit('mergeBranches', 'allowed', estimatedTokens, { branchIds: branchIds as unknown as string[] });
      this._consumeTokens(estimatedTokens);
      this._lastActivity = new Date().toISOString();
      return { ok: true, value: mergeResult };
    } catch (err) {
      return toResultError(clientError(this.adapterId, 'LimenAgentClient', String(err)));
    }
  }

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S3 -- Resolve manual merge conflicts.
   */
  async resolveConflict(
    ctx: OperationContext,
    resolution: ManualMergeResolutionRequest,
  ): Promise<Result<MergeResult>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    const session = this._getSessionFromCtx(ctx);
    if (!session) return toResultError(sessionNotFound(this.adapterId, ctx.sessionId || 'unknown'));

    if (resolution.resolution === 'merge_new_value') {
      if (!resolution.newValue || resolution.newConfidence === undefined) {
        return toResultError(serdeError(this.adapterId, 'merge_new_value requires newValue and newConfidence'));
      }
    }

    const govAction: GovernanceAction = { domain: 'memory', operation: 'resolve_merge_conflict' };
    const govResult = await this._evaluateGovernance(ctx, session, govAction, 'resolveConflict');
    if (govResult) return toResultError(govResult);

    const trustOrder = ['untrusted', 'low', 'medium', 'high', 'verified'];
    if (trustOrder.indexOf(this._config!.trustLevel) < trustOrder.indexOf('medium')) {
      return toResultError(trustLevelInsufficient(this.adapterId, 'medium', this._config!.trustLevel));
    }

    if (!this.capabilities.has('branching')) {
      return toResultError(capabilityNotDeclared(this.adapterId, 'branching'));
    }

    const estimatedTokens = this._estimateResolveTokens(resolution);
    const budgetErr = this._checkTokenBudget(estimatedTokens);
    if (budgetErr) return toResultError(budgetErr);

    this._auditCallCount = 0;
    const preAudit = await this._appendAudit('resolveConflict', 'allowed', estimatedTokens);
    if (!preAudit.ok) {
      return toResultError(auditFailure(this.adapterId, 'resolveConflict', 'Pre-operation audit failed'));
    }

    try {
      const coreResult = await this._client!.resolveConflict(ctx, resolution);
      const auditId = `evt-resolve-${Date.now()}` as EventId;
      const result: MergeResult = { ...coreResult, auditId };

      this._auditCallCount = 1;
      await this._appendAudit('resolveConflict', 'allowed', estimatedTokens);
      this._consumeTokens(estimatedTokens);
      this._lastActivity = new Date().toISOString();
      return { ok: true, value: result };
    } catch (err) {
      return toResultError(clientError(this.adapterId, 'LimenAgentClient', String(err)));
    }
  }

  // ── Public: Translation Layer ──

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S3 --
   * Translate framework tool calls to canonical LimenOperations.
   */
  async translateToolCall(
    toolCall: AgentToolCall,
    sessionId?: SessionId,
  ): Promise<Result<LimenOperation[]>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    let session: AgentSession | null = null;
    if (sessionId) {
      session = this._sessions.get(sessionId as string) ?? null;
    }
    if (!session && this._sessions.size === 1) {
      session = this._sessions.values().next().value ?? null;
    }
    if (!session) return toResultError(sessionNotFound(this.adapterId, sessionId ?? 'no-active-session'));

    const govAction: GovernanceAction = { domain: 'execution', operation: 'tool_call' };
    const ctx = this._sessionToCtx(session);
    const govResult = await this._evaluateGovernance(ctx, session, govAction, 'translateToolCall');
    if (govResult) return toResultError(govResult);

    const operations = this.translateFrameworkToolCall(toolCall);
    if (operations === null) {
      this._emitEvent('hook:blocked', session, { tool: toolCall.toolName });
      await this._appendAudit('translateToolCall', 'allowed', 0, { toolName: toolCall.toolName, errorCode: 'UNKNOWN_TOOL' });
      return toResultError(unknownTool(this.adapterId, toolCall.toolName, [...this.getKnownTools()]));
    }

    await this._appendAudit('translateToolCall', 'allowed', 0, { toolName: toolCall.toolName });
    this._lastActivity = new Date().toISOString();
    return { ok: true, value: operations };
  }

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S3 --
   * Translate native agent action to canonical ComputerAction for governance.
   */
  async translateActionToGovernance(action: NativeAgentAction): Promise<Result<ComputerAction>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    if (!action.nativeType || !action.nativePayload) {
      return toResultError(serdeError(this.adapterId, 'Missing nativeType or nativePayload in NativeAgentAction'));
    }

    const session = this._sessions.get(action.sessionId as string);
    if (!session) return toResultError(sessionNotFound(this.adapterId, action.sessionId as string));

    const govAction: GovernanceAction = { domain: 'computer', operation: action.nativeType };
    const ctx = this._sessionToCtx(session);
    const govResult = await this._evaluateGovernance(ctx, session, govAction, 'translateActionToGovernance');
    if (govResult) return toResultError(govResult);

    const capMap = this.getNativeTypeCapabilityMap();
    const requiredCapability = capMap[action.nativeType];
    if (requiredCapability && !this.capabilities.has(requiredCapability)) {
      return toResultError(capabilityNotDeclared(this.adapterId, requiredCapability));
    }

    const computerAction: ComputerAction = {
      type: this.mapNativeTypeToComputerActionType(action.nativeType),
      timestamp: action.timestamp || new Date().toISOString(),
      agentId: action.agentId,
      sessionId: action.sessionId,
      missionId: null,
      taskId: null,
      requestId: `evt-${Date.now()}` as EventId,
      nativeType: action.nativeType,
      nativePayload: action.nativePayload,
    };

    await this._appendAudit('translateActionToGovernance', 'allowed', 0);
    this._lastActivity = new Date().toISOString();
    return { ok: true, value: computerAction };
  }

  // ── Public: Event Bridge ──

  /** Pure data transformation: native -> Limen event. No governance, no audit. */
  mapNativeEvent(nativeEvent: unknown): AgentEventPayload | null {
    const first = this._sessions.values().next();
    const session = first.done ? null : first.value;
    return this.mapNativeEventImpl(
      nativeEvent,
      this.adapterId,
      this._config?.agentId ?? '' as AgentId,
      session?.sessionId ?? null,
    );
  }

  /** Pure data transformation: Limen event -> native. No governance, no audit. */
  mapLimenEvent(limenEvent: AgentEventPayload): unknown | null {
    return this.mapLimenEventImpl(limenEvent);
  }

  // ── Public: Health ──

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S3 --
   * Live health check with Core connectivity probe.
   */
  async healthCheck(): Promise<Result<Readonly<AdapterHealth>>> {
    if (this._lifecycle.isShutdown()) {
      return toResultError(notInitialized(this.adapterId));
    }

    const baseHealth = this.getHealth();
    let probedCorePortConnected = baseHealth.corePortConnected;

    if (this._client && this._lifecycle.state !== 'UNINITIALIZED') {
      try {
        const probe = await this._client.healthProbe();
        probedCorePortConnected = probe.connected;
        await this._appendAudit('healthCheck', 'not_applicable', 0);
      } catch {
        probedCorePortConnected = false;
      }
    }

    const health: Readonly<AdapterHealth> = { ...baseHealth, corePortConnected: probedCorePortConnected };
    return { ok: true, value: health };
  }

  /** Synchronous health. No I/O. */
  getHealth(): Readonly<AdapterHealth> {
    const state = this._lifecycle.state;
    const status = state === 'READY' ? 'healthy' as const
      : state === 'SHUTDOWN' ? 'unhealthy' as const
        : state === 'UNINITIALIZED' ? 'unhealthy' as const
          : 'degraded' as const;

    return Object.freeze({
      status,
      lifecycleState: state,
      lastActivity: this._lastActivity,
      activeSessions: this._sessions.size,
      errorCount: this._errorCount,
      uptimeMs: this._lifecycle.uptimeMs,
      corePortConnected: this._corePortConnected,
      tokenBudgetRemaining: Math.max(0, this._tokenBudgetTotal - this._tokenBudgetConsumed),
      tokenBudgetTotal: this._tokenBudgetTotal,
      lastError: this._lastError,
      details: { lastOperationEstimate: this._lastOperationEstimate },
    });
  }

  // ── Public: Subscriptions ──

  on(event: AgentEvent, handler: AgentEventHandler): string {
    if (this._lifecycle.isShutdown()) {
      throw new CrewAIAdapterError({
        code: 'NOT_INITIALIZED',
        message: 'Cannot register subscriptions on a shut-down adapter',
        adapterId: this.adapterId,
        retryable: false,
      });
    }
    const id = `sub-${this._nextSubscriptionId++}`;
    this._subscriptions.set(id, { event, handler });
    return id;
  }

  off(subscriptionId: string): void {
    if (this._lifecycle.isShutdown()) {
      throw new CrewAIAdapterError({
        code: 'NOT_INITIALIZED',
        message: 'Cannot manage subscriptions on a shut-down adapter',
        adapterId: this.adapterId,
        retryable: false,
      });
    }
    this._subscriptions.delete(subscriptionId);
  }

  // ── Public: Testing Hooks ──

  _setAgentState(state: 'active' | 'suspended' | 'decommissioned'): void {
    this._agentState = state;
  }

  _simulateCorePortLoss(): void {
    this._corePortConnected = false;
    this._lifecycle.transition('DEGRADED');
  }

  _simulateCorePortRecovery(): void {
    this._corePortConnected = true;
    this._lifecycle.transition('READY');
    this._errorCount = 0;
  }

  _injectAuditFailure(type: 'pre' | 'post'): void {
    if (type === 'pre') {
      this._auditFailureInjected = true;
    } else {
      this._postAuditFailureInjected = true;
    }
  }

  _clearAuditFailure(): void {
    this._auditFailureInjected = false;
    this._postAuditFailureInjected = false;
  }

  _getAuditEntries(): ReadonlyArray<Partial<AdapterAuditDetails>> {
    return this._auditEntries;
  }

  get lifecycleState(): AdapterLifecycleState {
    return this._lifecycle.state;
  }

  // ── Protected: Guards ──

  protected _guardCoreOperation(): CrewAIAdapterError | null {
    if (this._lifecycle.isShutdown() || this._lifecycle.isUninitialized() || this._lifecycle.state === 'INITIALIZING') {
      return notInitialized(this.adapterId);
    }
    if (this._lifecycle.isDegraded()) {
      return corePortUnavailable(this.adapterId, this._config?.coreEndpoint || '', 'Adapter is in DEGRADED state');
    }
    if (!this._corePortConnected) {
      this._lifecycle.transition('DEGRADED');
      return corePortUnavailable(this.adapterId, this._config?.coreEndpoint || '', 'Core port disconnected, transitioning to DEGRADED');
    }
    return null;
  }

  // ── Protected: Governance ──

  protected async _evaluateGovernance(
    ctx: OperationContext,
    session: AgentSession,
    action: GovernanceAction,
    operation: string,
  ): Promise<CrewAIAdapterError | null> {
    if (this._agentState !== 'active') {
      const refVerdict: GovernanceVerdict = {
        verdict: 'refuse',
        auditId: `evt-state-${Date.now()}` as EventId,
        reason: 'agent_state_not_active',
        rule: 'agent_state_check',
      };
      await this._appendAudit(operation, 'refused', 0);
      this._emitEvent('governance:refused', session, { operation, reason: 'agent_state_not_active' });
      return governanceRefusal(this.adapterId, operation, 'agent_state_not_active', 'agent_state_check', refVerdict);
    }

    if (this._governor) {
      try {
        const govCtx: GovernanceContext = {
          operationContext: ctx,
          session,
          action,
          resource: null,
          policyIds: [],
          actionHistory: [],
        };
        const verdict = await this._governor.beforeAction(govCtx);

        if (verdict.verdict === 'refuse') {
          await this._appendAudit(operation, 'refused', 0);
          this._emitEvent('governance:refused', session, { operation, verdict });
          return governanceRefusal(this.adapterId, operation, verdict.reason, verdict.rule, verdict, verdict.alternatives);
        }

        if (verdict.verdict === 'escalate') {
          await this._appendAudit(operation, 'escalated', 0);
          this._emitEvent('governance:escalated', session, { operation, verdict });
          return governanceRefusal(this.adapterId, operation, verdict.reason, 'escalation_required', verdict);
        }
      } catch (err) {
        return internalError(this.adapterId, `Governor error: ${String(err)}`);
      }
    }

    return null;
  }

  // ── Protected: Token Budget ──

  protected _checkTokenBudget(estimatedTokens: number): CrewAIAdapterError | null {
    if (estimatedTokens > Number.MAX_SAFE_INTEGER || estimatedTokens < 0 || !Number.isFinite(estimatedTokens)) {
      return budgetExceeded(this.adapterId, 0, estimatedTokens, null);
    }

    const remaining = this._tokenBudgetTotal - this._tokenBudgetConsumed;

    if (estimatedTokens > (this._config?.tokenBudget.maxTokensPerOperation ?? Infinity)) {
      const retryAfter = this._config?.tokenBudget.replenishmentWindowSeconds ?? null;
      return budgetExceeded(this.adapterId, remaining, estimatedTokens, retryAfter);
    }

    if (estimatedTokens > remaining) {
      const retryAfter = this._config?.tokenBudget.replenishmentWindowSeconds ?? null;
      return budgetExceeded(this.adapterId, remaining, estimatedTokens, retryAfter);
    }

    return null;
  }

  protected _consumeTokens(tokens: number): void {
    this._tokenBudgetConsumed += tokens;
    this._lastOperationEstimate = {
      tokens,
      encoding: this._config?.tokenBudget.encoding ?? 'cl100k_base',
      overflow: false,
      components: { operation: tokens },
    };

    const config = this._config;
    if (config && !this._warningEmitted) {
      const pctUsed = (this._tokenBudgetConsumed / this._tokenBudgetTotal) * 100;
      if (pctUsed >= config.tokenBudget.warningThresholdPct) {
        this._warningEmitted = true;
        const first = this._sessions.values().next();
        const session = first.done ? null : first.value;
        if (session) {
          this._emitEvent('budget:exhausted', session, { consumed: this._tokenBudgetConsumed, total: this._tokenBudgetTotal });
        }
      }
    }
  }

  // ── Protected: Token Estimation ──

  protected _estimateRememberTokens(content: string | StructuredContent, options?: AgentMemoryOptions): number {
    const serialized = typeof content === 'string' ? content : JSON.stringify(content);
    const contentTokens = Math.ceil(serialized.length / 4);
    const optionsTokens = options ? Math.ceil(JSON.stringify(options).length / 4) : 0;
    return contentTokens + optionsTokens + AUDIT_OVERHEAD_TOKENS + GOVERNANCE_OVERHEAD_TOKENS;
  }

  protected _estimateRecallTokens(query: AgentRecallQuery, options?: AgentRecallOptions): number {
    const queryTokens = Math.ceil(JSON.stringify(query).length / 4);
    const limit = options?.limit ?? 10;
    const responseTokens = limit * AVG_BELIEF_SIZE_TOKENS;
    return queryTokens + responseTokens + AUDIT_OVERHEAD_TOKENS;
  }

  protected _estimateBranchTokens(description: string): number {
    return BRANCH_BASE_TOKENS + Math.ceil(description.length / 4) + AUDIT_OVERHEAD_TOKENS;
  }

  protected _estimateMergeTokens(branchIds: readonly AgentBranchId[]): number {
    return BRANCH_BASE_TOKENS + (branchIds.length * AVG_CONFLICT_SIZE_TOKENS) + AUDIT_OVERHEAD_TOKENS;
  }

  protected _estimateResolveTokens(resolution: ManualMergeResolutionRequest): number {
    const baseTokens = Math.ceil(JSON.stringify(resolution).length / 4);
    return baseTokens + BRANCH_BASE_TOKENS + AUDIT_OVERHEAD_TOKENS;
  }

  // ── Protected: Confidence Cap ──

  protected _applyConfidenceCap(options?: AgentMemoryOptions): AgentMemoryOptions | undefined {
    if (!options?.confidence || !this._config) return options;
    const cap = TRUST_CONFIDENCE_CAPS[this._config.trustLevel];
    if (options.confidence > cap) {
      return { ...options, confidence: cap };
    }
    return options;
  }

  // ── Protected: Audit ──

  protected async _appendAudit(
    operationType: string,
    governanceState: 'allowed' | 'refused' | 'escalated' | 'sandboxed' | 'not_applicable',
    tokenCost: number,
    extra?: Partial<AdapterAuditDetails>,
  ): Promise<Result<EventId>> {
    if (this._auditFailureInjected) {
      this._auditFailureInjected = false;
      return toResultError(auditFailure(this.adapterId, operationType, 'Injected audit failure'));
    }

    if (this._postAuditFailureInjected && this._auditCallCount > 0) {
      this._postAuditFailureInjected = false;
      return toResultError(auditFailure(this.adapterId, operationType, 'Injected post-operation audit failure'));
    }

    const entry: Partial<AdapterAuditDetails> = {
      operationType,
      tokenCost,
      governanceState,
      duration: 0,
      ...this.getAuditContext(),
      ...extra,
    };

    this._auditEntries.push(entry);

    if (this._client) {
      try {
        const eventId = await this._client.appendAudit({ details: entry as Readonly<Record<string, unknown>> });
        return { ok: true, value: eventId };
      } catch {
        return toResultError(auditFailure(this.adapterId, operationType, 'Core audit append failed'));
      }
    }

    return { ok: true, value: `evt-local-${Date.now()}` as EventId };
  }

  protected async _appendAuditRaw(entry: Partial<AdapterAuditDetails>): Promise<void> {
    this._auditEntries.push(entry);
    if (this._client) {
      try {
        await this._client.appendAudit({ details: entry as Readonly<Record<string, unknown>> });
      } catch {
        // Best-effort
      }
    }
  }

  // ── Protected: Events ──

  protected _emitEvent(
    event: AgentEvent,
    session: AgentSession | null,
    data: Readonly<Record<string, unknown>>,
  ): void {
    const payload: AgentEventPayload = {
      eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` as EventId,
      event,
      timestamp: new Date().toISOString(),
      adapterId: this.adapterId,
      sessionId: session?.sessionId ?? null,
      agentId: this._config?.agentId ?? '' as AgentId,
      data,
    };

    for (const [, sub] of this._subscriptions) {
      if (sub.event === event) {
        try {
          sub.handler(payload);
        } catch {
          // Subscriber errors don't propagate
        }
      }
    }
  }

  protected _clearSubscriptions(): void {
    this._subscriptions.clear();
  }

  // ── Protected: Session Helpers ──

  protected _getSessionFromCtx(ctx: OperationContext): AgentSession | null {
    if (!ctx.sessionId) return null;
    return this._sessions.get(ctx.sessionId as string) ?? null;
  }

  protected _sessionToCtx(session: AgentSession): OperationContext {
    return {
      tenantId: session.tenantId,
      userId: null,
      agentId: session.agentId,
      permissions: new Set(),
      sessionId: session.sessionId,
      clearanceLevel: session.clearanceLevel,
    };
  }

  // ── Private: Config ──

  private _validateBaseConfig(config: TConfig): CrewAIAdapterError | null {
    if ((config as unknown as Record<string, unknown>).governed === false) {
      const refusalVerdict: GovernanceVerdict = {
        verdict: 'refuse',
        auditId: 'evt-config-rejection' as EventId,
        reason: 'Governance is non-optional. governed: false is not permitted.',
        rule: 'governance_non_optional',
      };
      return governanceRefusal(this.adapterId, 'initialize', 'Governance is non-optional. governed: false is not permitted.', 'governance_non_optional', refusalVerdict);
    }

    if (config.connectionTimeoutMs < 1000 || config.connectionTimeoutMs > 30000) {
      return serdeError(this.adapterId, `connectionTimeoutMs must be in [1000, 30000], got ${config.connectionTimeoutMs}`);
    }

    if (config.tokenBudget.warningThresholdPct < 0 || config.tokenBudget.warningThresholdPct > 100) {
      return serdeError(this.adapterId, `warningThresholdPct must be in [0, 100], got ${config.tokenBudget.warningThresholdPct}`);
    }

    if (config.tokenBudget.maxTokensPerOperation <= 0) {
      return serdeError(this.adapterId, `maxTokensPerOperation must be positive, got ${config.tokenBudget.maxTokensPerOperation}`);
    }

    if (config.tokenBudget.maxTokensPerSession <= 0) {
      return serdeError(this.adapterId, `maxTokensPerSession must be positive, got ${config.tokenBudget.maxTokensPerSession}`);
    }

    return null;
  }

  private _computeConfigDigest(config: TConfig): string {
    const canonical = canonicalizeForDigest(config);
    return createHash('sha256').update(canonical).digest('hex');
  }
}

// ── Module Helpers ──

function classificationToNum(classification: string): number {
  const map: Record<string, number> = { unrestricted: 0, internal: 1, confidential: 2, restricted: 3, critical: 4 };
  return map[classification] ?? 0;
}

function canonicalizeForDigest(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Set) {
    const sorted = [...value].sort();
    return '[' + sorted.map(v => canonicalizeForDigest(v)).join(',') + ']';
  }
  if (Array.isArray(value)) {
    return '[' + value.map(v => canonicalizeForDigest(v)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys.map(k => JSON.stringify(k) + ':' + canonicalizeForDigest(obj[k]));
    return '{' + pairs.join(',') + '}';
  }
  return String(value);
}
