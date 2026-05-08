/**
 * LimenCrewAIAdapter -- CrewAI Framework Adapter for Limen Governance Substrate
 *
 * Contract: CREWAI_ADAPTER_CONTRACT.md v1.0.0
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 * Shared Types: SHARED_TYPES.md v1.4.1
 *
 * This adapter translates CrewAI native tool invocations, delegation events,
 * and session boundaries into canonical Limen types, ensuring every CrewAI
 * agent operation flows through governance, audit, and memory infrastructure.
 *
 * Invariants enforced:
 * - INV-1: Pure translation (no belief cache)
 * - INV-2: Governance cannot be bypassed
 * - INV-3: Audit completeness
 * - INV-4: Capability immutability
 * - INV-5: Deterministic error resolution
 * - INV-6: Session isolation
 * - INV-7: CrewAI metadata preservation
 * - INV-8: Confidence monotonicity
 * - INV-9: Shutdown completeness
 * - INV-10: Budget non-negative
 * - INV-11: Canonical adapter surface
 * - INV-12: No local belief cache
 * - INV-13: Rate limit inheritance
 */

import { randomUUID } from 'node:crypto';
import type {
  AdapterId,
  AgentId,
  AgentCapability,
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
  CrewAIToolCall,
  CrewAIToolContext,
  CrewAIHookEvent,
  CrewAISessionStart,
  CrewAISessionEnd,
  CrewContext,
  RememberOptions,
  RecallResult,
  MergeResult,
  CrewAIAuditDetails,
  CrewAIAdapterErrorCode,
  MergeConflictRecord,
  ManualMergeState,
  TokenBudgetConfig,
  ActionDigest,
  PolicyId,
  TenantId,
} from './types.js';
import { TRUST_TO_CLEARANCE, TRUST_CONFIDENCE_CAPS, NEVER_RETRYABLE } from './types.js';
import type { CrewAIAdapterConfig } from './config.js';
import { validateConfig, computeConfigDigest } from './config.js';
import { AdapterLifecycle } from './lifecycle.js';
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
} from './errors.js';
import {
  normalizeHookContext,
  validateHookContext,
  translateToolToOperations,
  KNOWN_TOOLS,
  mapNativeEvent as hookMapNativeEvent,
  mapLimenEvent as hookMapLimenEvent,
} from './hooks.js';

// ── Constants for token estimation (F-15) ──

/** Overhead tokens for audit entry serialization */
const AUDIT_OVERHEAD_TOKENS = 20;
/** Overhead tokens for governance context */
const GOVERNANCE_OVERHEAD_TOKENS = 10;
/** Average belief size estimate for recall budgeting */
const AVG_BELIEF_SIZE_TOKENS = 50;
/** Base overhead for branch/merge metadata */
const BRANCH_BASE_TOKENS = 30;
/** Average size per conflict for merge estimation */
const AVG_CONFLICT_SIZE_TOKENS = 40;

// ── F-12: Native action type to required capability mapping ──

const NATIVE_TYPE_TO_CAPABILITY: Readonly<Record<string, AgentCapability>> = {
  'crew_delegation': 'mission_delegation',
  'file_read': 'file_access',
  'file_write': 'file_access',
  'terminal': 'terminal_use',
  'browser': 'browser_use',
  'code': 'code_execution',
};

// ── LimenCrewAIAdapter ──

/**
 * CREWAI_ADAPTER_CONTRACT.md S3.1 -- CrewAI adapter implementation.
 *
 * Implements the canonical AgentAdapter interface plus CrewAI convenience operations.
 * 5-state lifecycle: UNINITIALIZED -> INITIALIZING -> READY -> DEGRADED -> SHUTDOWN.
 */
export class LimenCrewAIAdapter {
  /** CREWAI_ADAPTER_CONTRACT.md S3.1 -- Adapter identity */
  readonly adapterId: AdapterId;
  /** CREWAI_ADAPTER_CONTRACT.md S3.1 -- Framework specialization */
  readonly agentFramework: 'crew_ai' = 'crew_ai';
  /** CREWAI_ADAPTER_CONTRACT.md S3.1 -- Adapter version */
  readonly version: string = '1.0.0';
  /** CREWAI_ADAPTER_CONTRACT.md S3.1 -- Declared capabilities (INV-4: frozen after init) */
  readonly capabilities: ReadonlySet<AgentCapability>;

  // ── Internal State ──
  private readonly _lifecycle = new AdapterLifecycle();
  private _client: LimenAgentClient | null = null;
  private _governor: ComputerActionGovernor | null = null;
  private _config: CrewAIAdapterConfig | null = null;
  private _configDigest: string | null = null;
  private _corePortConnected: boolean = false;
  private _errorCount: number = 0;
  private _lastError: string | undefined;
  private _lastActivity: string | null = null;

  // Session tracking (INV-6: per-adapter isolation)
  private readonly _sessions = new Map<string, AgentSession>();

  // Token budget tracking (INV-10: non-negative)
  private _tokenBudgetConsumed: number = 0;
  private _tokenBudgetTotal: number = 0;
  private _warningEmitted: boolean = false;
  private _lastOperationEstimate: TokenEstimate | null = null;

  // Event subscriptions (Claim 1.13)
  private readonly _subscriptions = new Map<string, { event: AgentEvent; handler: AgentEventHandler }>();
  private _nextSubscriptionId: number = 0;

  // Audit tracking
  private readonly _auditEntries: Array<Partial<CrewAIAuditDetails>> = [];
  private _auditFailureInjected: boolean = false;
  private _postAuditFailureInjected: boolean = false;
  /** F-08: Tracks whether the current _appendAudit call is a post-operation call */
  private _auditCallCount: number = 0;

  // Agent state simulation (for governance)
  private _agentState: 'active' | 'suspended' | 'decommissioned' = 'active';

  constructor(adapterId: AdapterId, capabilities: ReadonlySet<AgentCapability>) {
    this.adapterId = adapterId;
    this.capabilities = capabilities;
  }

  // ── Public: Lifecycle ──

  /**
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 1.1 --
   * Initialize the adapter. Must complete before any core operation.
   * Idempotent: same config -> no-op success. Different config -> ALREADY_INITIALIZED.
   * Claim 7.2: After SHUTDOWN, returns NOT_INITIALIZED.
   */
  async initialize(
    client: LimenAgentClient,
    governor: ComputerActionGovernor,
    config: CrewAIAdapterConfig,
  ): Promise<Result<void>> {
    // Claim 7.2: SHUTDOWN is terminal
    if (this._lifecycle.isShutdown()) {
      return toResultError(notInitialized(this.adapterId));
    }

    // DEGRADED: re-init not permitted (Claim 7.6)
    if (this._lifecycle.isDegraded()) {
      return toResultError(alreadyInitialized(this.adapterId));
    }

    // Claim 1.1: Idempotent init (READY with same config = no-op)
    if (this._lifecycle.state === 'READY') {
      const digest = computeConfigDigest(config);
      if (digest === this._configDigest) {
        return { ok: true, value: undefined };
      }
      return toResultError(alreadyInitialized(this.adapterId));
    }

    // Only UNINITIALIZED can start init
    if (!this._lifecycle.isUninitialized()) {
      return toResultError(alreadyInitialized(this.adapterId));
    }

    // Validate config (Claims 2.1, 2.2, 2.7, 2.12, 2.13, 4.7)
    const configError = validateConfig(config, this.adapterId);
    if (configError) {
      return toResultError(configError);
    }

    // Transition to INITIALIZING
    this._lifecycle.transition('INITIALIZING');

    try {
      // Store dependencies
      this._client = client;
      this._governor = governor;
      this._config = config;
      this._configDigest = computeConfigDigest(config);
      this._tokenBudgetTotal = config.tokenBudget.maxTokensPerSession;
      this._tokenBudgetConsumed = 0;
      this._warningEmitted = false;
      this._corePortConnected = true;

      // F-04: Record init audit BEFORE transitioning to READY
      const auditResult = await this._appendAudit('initialize', 'not_applicable', 0);
      if (!auditResult.ok) {
        // Audit failed -- stay in INITIALIZING, revert to UNINITIALIZED
        this._lifecycle.transition('UNINITIALIZED');
        this._client = null;
        this._governor = null;
        this._config = null;
        this._configDigest = null;
        return toResultError(auditFailure(this.adapterId, 'initialize', 'Failed to record initialization audit'));
      }

      // Transition to READY (only after successful audit)
      this._lifecycle.transition('READY');
      this._lastActivity = new Date().toISOString();

      return { ok: true, value: undefined };
    } catch (err) {
      // Claim 7.7: INITIALIZING -> UNINITIALIZED on failure
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
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 1.2 --
   * Shutdown the adapter. Idempotent.
   * Claim 1.3: Closes sessions, flushes audit, deregisters.
   * Claim 7.5: Serialized with other operations.
   * INV-9: No background tasks remain after shutdown.
   * F-21: Transition to SHUTDOWN BEFORE session cleanup to prevent races.
   */
  async shutdown(): Promise<Result<void>> {
    // Claim 1.2: Idempotent -- SHUTDOWN or UNINITIALIZED -> no-op success
    if (this._lifecycle.isShutdown()) {
      return { ok: true, value: undefined };
    }
    if (this._lifecycle.isUninitialized()) {
      this._lifecycle.transition('SHUTDOWN');
      return { ok: true, value: undefined };
    }

    // Claim 7.7: INITIALIZING -> SHUTDOWN (force)
    if (this._lifecycle.state === 'INITIALIZING') {
      this._lifecycle.transition('SHUTDOWN');
      this._clearSubscriptions();
      return { ok: true, value: undefined };
    }

    // F-21: Transition to SHUTDOWN FIRST to prevent concurrent callers from starting sessions
    this._lifecycle.transition('SHUTDOWN');

    // Close all active sessions (Claim 1.3)
    for (const [sessionId, session] of this._sessions) {
      try {
        if (this._client) {
          await this._client.endSession(sessionId as SessionId);
        }
        // Audit forced session closure
        await this._appendAuditRaw({
          operationType: 'onAgentSessionEnd',
          crewId: (session.metadata.crewId as string) || '',
          agentRole: (session.metadata.agentRole as string) || '',
          delegationDepth: 0,
          tokenCost: 0,
          governanceState: 'not_applicable',
          duration: 0,
        });
      } catch {
        // Best-effort in shutdown
      }
    }
    this._sessions.clear();

    // Flush audit (Claim 1.3)
    await this._appendAuditRaw({
      operationType: 'shutdown',
      crewId: this._config?.crewId || '',
      agentRole: this._config?.agentRole || '',
      delegationDepth: 0,
      tokenCost: 0,
      governanceState: 'not_applicable',
      duration: 0,
    });

    // INV-9: Clear all subscriptions
    this._clearSubscriptions();

    // Clear references
    this._corePortConnected = false;

    return { ok: true, value: undefined };
  }

  // ── Public: Session Bridge ──

  /**
   * CREWAI_ADAPTER_CONTRACT.md S3.1 --
   * Start a CrewAI agent session.
   * INV-7: Preserves crew ID, agent role, task ID, delegation depth, process type.
   * F-09: Governance gate -- suspended/decommissioned agents cannot start sessions.
   * F-19: Session IDs use crypto.randomUUID().
   */
  async onAgentSessionStart(nativeSession: CrewAISessionStart): Promise<Result<AgentSession>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    // F-09: Agent state check -- suspended/decommissioned cannot start sessions
    if (this._agentState !== 'active') {
      const refVerdict: GovernanceVerdict = {
        verdict: 'refuse',
        auditId: `evt-state-${Date.now()}` as EventId,
        reason: 'agent_state_not_active',
        rule: 'agent_state_check',
      };
      return toResultError(governanceRefusal(
        this.adapterId,
        'onAgentSessionStart',
        'agent_state_not_active',
        'agent_state_check',
        refVerdict,
      ));
    }

    const config = this._config!;
    // F-19: Use crypto.randomUUID() instead of Date.now() + random chars
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
      workingMemoryNamespace: `crewai/${nativeSession.crewId}/${nativeSession.agentRole}`,
      activeMissions: [],
      metadata: {
        crewId: nativeSession.crewId,
        agentRole: nativeSession.agentRole,
        processType: nativeSession.processType,
        taskId: nativeSession.taskId ?? null,
        delegationDepth: 0,
        ...nativeSession.metadata,
      },
    };

    this._sessions.set(sessionId as string, session);
    this._lastActivity = new Date().toISOString();

    // Audit session start
    const auditResult = await this._appendAudit(
      'onAgentSessionStart',
      'not_applicable',
      0,
      { crewId: nativeSession.crewId, agentRole: nativeSession.agentRole },
    );
    if (!auditResult.ok) {
      this._sessions.delete(sessionId as string);
      return toResultError(auditFailure(this.adapterId, 'onAgentSessionStart', 'Failed to record audit'));
    }

    return { ok: true, value: session };
  }

  /**
   * CREWAI_ADAPTER_CONTRACT.md S3.1 --
   * End a CrewAI agent session.
   * F-10: Agent state check -- suspended/decommissioned agents cannot end sessions.
   */
  async onAgentSessionEnd(nativeSession: CrewAISessionEnd): Promise<Result<SessionSummary>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    // F-10: Agent state check
    if (this._agentState !== 'active') {
      const refVerdict: GovernanceVerdict = {
        verdict: 'refuse',
        auditId: `evt-state-${Date.now()}` as EventId,
        reason: 'agent_state_not_active',
        rule: 'agent_state_check',
      };
      return toResultError(governanceRefusal(
        this.adapterId,
        'onAgentSessionEnd',
        'agent_state_not_active',
        'agent_state_check',
        refVerdict,
      ));
    }

    const session = this._sessions.get(nativeSession.sessionId);
    if (!session) {
      return toResultError(sessionNotFound(this.adapterId, nativeSession.sessionId));
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

    this._sessions.delete(nativeSession.sessionId);
    this._lastActivity = new Date().toISOString();

    await this._appendAudit(
      'onAgentSessionEnd',
      'not_applicable',
      0,
      { crewId: nativeSession.crewId },
    );

    return { ok: true, value: summary };
  }

  // ── Public: Memory Operations ──

  /**
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 1.4 --
   * Governed memory write.
   * Authorization-first: governance -> trust -> capability -> budget -> audit -> write.
   * F-07: Corrected precedence: governance -> trust -> capability.
   * Claim 3.5: Confidence capped per trust level.
   * Claim 2.3: Crew context auto-populated if omitted.
   */
  async remember(
    ctx: OperationContext,
    content: string | StructuredContent,
    options?: RememberOptions,
  ): Promise<Result<ClaimId>> {
    // Step 1: Guard lifecycle
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    // F-02: Session MUST be identified by ctx.sessionId. No arbitrary fallback.
    const session = this._getSessionFromCtx(ctx);
    if (!session) return toResultError(sessionNotFound(this.adapterId, ctx.sessionId || 'unknown'));

    const govAction: GovernanceAction = { domain: 'memory', operation: 'write' };

    // F-07: Governance FIRST (prec 5), then trust (prec 6), then capability (prec 7)
    const govResult = await this._evaluateGovernance(ctx, session, govAction, 'remember');
    if (govResult) return toResultError(govResult);

    // Trust check (prec 6): minimum trust for remember is 'low'
    if (this._config!.trustLevel === 'untrusted') {
      await this._appendAudit('remember', 'refused', 0, { errorCode: 'TRUST_LEVEL_INSUFFICIENT' });
      return toResultError(trustLevelInsufficient(this.adapterId, 'low', 'untrusted'));
    }

    // Capability check (prec 7): memory_write required
    if (!this.capabilities.has('memory_write')) {
      await this._appendAudit('remember', 'refused', 0, { errorCode: 'CAPABILITY_NOT_DECLARED' });
      return toResultError(capabilityNotDeclared(this.adapterId, 'memory_write'));
    }

    // Step 10: Token budget check
    const estimatedTokens = this._estimateRememberTokens(content, options);
    const budgetErr = this._checkTokenBudget(estimatedTokens);
    if (budgetErr) {
      await this._appendAudit('remember', 'allowed', estimatedTokens, { errorCode: 'BUDGET_EXCEEDED' });
      return toResultError(budgetErr);
    }

    // Step 12: Pre-operation audit
    this._auditCallCount = 0;
    const preAudit = await this._appendAudit('remember', 'allowed', estimatedTokens);
    if (!preAudit.ok) {
      return toResultError(auditFailure(this.adapterId, 'remember', 'Pre-operation audit failed'));
    }

    // Claim 3.5: Confidence cap per trust level
    const cappedOptions = this._applyConfidenceCap(options);

    // Claim 2.3 + F-16: Auto-populate crew context -- never return undefined
    const enrichedOptions = this._enrichRememberOptions(cappedOptions, session);

    // Step 13: Execute against Limen Core
    try {
      const claimId = await this._client!.remember(ctx, content, enrichedOptions);

      // Step 14: Post-operation audit (Claim 6.1)
      // F-08: This is a post-op audit call
      this._auditCallCount = 1;
      const postAudit = await this._appendAudit('remember', 'allowed', estimatedTokens, { beliefIds: [claimId] });
      if (!postAudit.ok) {
        // F-22: Emit observability event for audit-failure-after-core-success
        this._emitEvent('audit:post_operation_failure', session, {
          operation: 'remember',
          claimId,
          reason: 'Post-operation audit failed after successful core write',
        });
        return toResultError(auditFailure(this.adapterId, 'remember', 'Post-operation audit failed'));
      }

      // Token tracking (INV-10)
      this._consumeTokens(estimatedTokens);
      this._lastActivity = new Date().toISOString();

      return { ok: true, value: claimId };
    } catch (err) {
      await this._appendAudit('remember', 'allowed', estimatedTokens, { errorCode: 'CLIENT_ERROR' });
      return toResultError(clientError(this.adapterId, 'LimenAgentClient', String(err)));
    }
  }

  /**
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 1.5 --
   * Governed memory read.
   * Claim 1.5: Filters by explicit clearanceLevel.
   * Claim 3.7: memory_read is implicitly granted at all trust levels.
   * Claim 2.4: truncated signals when results are incomplete.
   * F-07: Corrected precedence: governance -> trust -> capability (skip for recall per 3.7).
   */
  async recall(
    ctx: OperationContext,
    query: AgentRecallQuery,
    options?: AgentRecallOptions,
  ): Promise<Result<RecallResult>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    // F-02: Session MUST be identified by ctx.sessionId
    const session = this._getSessionFromCtx(ctx);
    if (!session) return toResultError(sessionNotFound(this.adapterId, ctx.sessionId || 'unknown'));

    const govAction: GovernanceAction = { domain: 'memory', operation: 'read' };

    // Governance gate (Claim 3.7: memory_read implicit, but still evaluates agent state, rate limits)
    const govResult = await this._evaluateGovernance(ctx, session, govAction, 'recall');
    if (govResult) return toResultError(govResult);

    // Claim 3.7: No trust or capability check for recall -- memory_read is implicit

    // Token budget check
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

      // Claim 1.5: Filter by clearance level
      const clearance = ctx.clearanceLevel ?? 0;
      const filteredBeliefs = result.beliefs.filter(b => {
        const classNum = classificationToNum(b.belief.classification);
        return classNum <= clearance;
      });

      // Claim 2.4: truncated flag
      const truncated = filteredBeliefs.length < result.totalCount;

      const tokenEstimate: TokenEstimate = {
        tokens: estimatedTokens,
        encoding: this._config!.tokenBudget.encoding,
        overflow: false,
        components: { query: estimatedTokens },
      };

      const recallResult: RecallResult = {
        beliefs: filteredBeliefs,
        totalCount: result.totalCount,
        truncated,
        tokenEstimate,
      };

      this._auditCallCount = 1;
      const postAudit = await this._appendAudit('recall', 'allowed', estimatedTokens);
      if (!postAudit.ok) {
        this._emitEvent('audit:post_operation_failure', session, {
          operation: 'recall',
          reason: 'Post-operation audit failed after successful core read',
        });
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
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 1.6 --
   * Create a branch. Requires 'branching' capability, minimum trust: medium.
   * F-06: Corrected precedence: governance -> trust -> capability.
   */
  async createBranch(
    ctx: OperationContext,
    baseBeliefId: ClaimId,
    description: string,
  ): Promise<Result<AgentBranchId>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    // F-02: Session MUST be identified by ctx.sessionId
    const session = this._getSessionFromCtx(ctx);
    if (!session) return toResultError(sessionNotFound(this.adapterId, ctx.sessionId || 'unknown'));

    // F-06: Governance FIRST (prec 5)
    const govAction: GovernanceAction = { domain: 'memory', operation: 'branch' };
    const govResult = await this._evaluateGovernance(ctx, session, govAction, 'createBranch');
    if (govResult) return toResultError(govResult);

    // Trust check (prec 6): minimum trust medium
    const trustOrder = ['untrusted', 'low', 'medium', 'high', 'verified'];
    if (trustOrder.indexOf(this._config!.trustLevel) < trustOrder.indexOf('medium')) {
      return toResultError(trustLevelInsufficient(this.adapterId, 'medium', this._config!.trustLevel));
    }

    // Capability check (prec 7): branching required
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
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 1.7 --
   * Merge branches. Follows deterministic ordering per SHARED_TYPES.md S23.
   * Claim 2.5: Manual strategy -> pending_resolution with non-null manualMergeState.
   * F-06: Corrected precedence: governance -> trust -> capability.
   */
  async mergeBranches(
    ctx: OperationContext,
    branchIds: readonly AgentBranchId[],
    strategy: MergeStrategy,
  ): Promise<Result<MergeResult>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    // F-02: Session MUST be identified by ctx.sessionId
    const session = this._getSessionFromCtx(ctx);
    if (!session) return toResultError(sessionNotFound(this.adapterId, ctx.sessionId || 'unknown'));

    // F-06: Governance FIRST (prec 5)
    const govAction: GovernanceAction = { domain: 'memory', operation: 'merge' };
    const govResult = await this._evaluateGovernance(ctx, session, govAction, 'mergeBranches');
    if (govResult) return toResultError(govResult);

    // Trust check (prec 6)
    const trustOrder = ['untrusted', 'low', 'medium', 'high', 'verified'];
    if (trustOrder.indexOf(this._config!.trustLevel) < trustOrder.indexOf('medium')) {
      return toResultError(trustLevelInsufficient(this.adapterId, 'medium', this._config!.trustLevel));
    }

    // Capability check (prec 7)
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

      const mergeResult: MergeResult = {
        ...coreResult,
        auditId,
      };

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
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 1.11 --
   * Resolve manual merge conflicts.
   * Claim 2.9: Rejects unknown, expired, duplicate, or malformed resolutions.
   * F-06: Corrected precedence: governance -> trust -> capability.
   */
  async resolveConflict(
    ctx: OperationContext,
    resolution: ManualMergeResolutionRequest,
  ): Promise<Result<MergeResult>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    // F-02: Session MUST be identified by ctx.sessionId
    const session = this._getSessionFromCtx(ctx);
    if (!session) return toResultError(sessionNotFound(this.adapterId, ctx.sessionId || 'unknown'));

    // Claim 2.9: Validate resolution request (SERDE check before governance)
    if (resolution.resolution === 'merge_new_value') {
      if (!resolution.newValue || resolution.newConfidence === undefined) {
        return toResultError(serdeError(this.adapterId, 'merge_new_value requires newValue and newConfidence'));
      }
    }

    // F-06: Governance FIRST (prec 5)
    const govAction: GovernanceAction = { domain: 'memory', operation: 'resolve_merge_conflict' };
    const govResult = await this._evaluateGovernance(ctx, session, govAction, 'resolveConflict');
    if (govResult) return toResultError(govResult);

    // Trust check (prec 6)
    const trustOrder = ['untrusted', 'low', 'medium', 'high', 'verified'];
    if (trustOrder.indexOf(this._config!.trustLevel) < trustOrder.indexOf('medium')) {
      return toResultError(trustLevelInsufficient(this.adapterId, 'medium', this._config!.trustLevel));
    }

    // Capability check (prec 7)
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
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 1.9 --
   * Translate CrewAI tool calls to canonical LimenOperations.
   * Returns UNKNOWN_TOOL with available operations for undeclared tools.
   * Claim 2.8: Normalizes from tool_name and tool_input.
   * F-03: Must use session from tool call context, not arbitrary first session.
   */
  async translateToolCall(
    toolCall: AgentToolCall | CrewAIToolCall,
    sessionId?: SessionId,
  ): Promise<Result<LimenOperation[]>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    // F-03: Get session from tool call context or explicit sessionId parameter
    let session: AgentSession | null = null;
    if ('context' in toolCall && (toolCall as CrewAIToolCall).context) {
      // Try to find session by matching crew context
      const crewCtx = (toolCall as CrewAIToolCall).context;
      // If the tool call has a rawHookContextDigest with a sessionId, use it
      if (crewCtx.rawHookContextDigest?.sessionId) {
        session = this._sessions.get(crewCtx.rawHookContextDigest.sessionId) ?? null;
      }
    }
    if (!session && sessionId) {
      session = this._sessions.get(sessionId) ?? null;
    }
    if (!session) {
      // If only one session exists, use it for backward compatibility
      if (this._sessions.size === 1) {
        session = this._sessions.values().next().value ?? null;
      }
    }
    if (!session) return toResultError(sessionNotFound(this.adapterId, sessionId ?? 'no-active-session'));

    // Governance check for tool_call
    const govAction: GovernanceAction = { domain: 'execution', operation: 'tool_call' };
    const ctx = this._sessionToCtx(session);
    const govResult = await this._evaluateGovernance(ctx, session, govAction, 'translateToolCall');
    if (govResult) return toResultError(govResult);

    const toolName = toolCall.toolName;

    // Claim 1.9: Translate known tools
    const crewToolCall: CrewAIToolCall = 'context' in toolCall
      ? toolCall as CrewAIToolCall
      : {
        ...toolCall,
        agentFramework: 'crew_ai' as const,
        tool: toolCall.toolName,
        args: toolCall.toolArgs,
        context: {
          crewId: (session.metadata.crewId as string) || '',
          agentRole: (session.metadata.agentRole as string) || '',
          taskId: null,
          delegationDepth: 0,
          processType: 'sequential' as const,
          hookPhase: 'before_tool_call' as const,
          rawHookContextDigest: {
            action: toolCall.toolName,
            domain: 'execution',
            timestamp: new Date().toISOString(),
            sessionId: session.sessionId,
            outcome: 'allowed' as const,
          },
        },
      };

    const operations = translateToolToOperations(crewToolCall);
    if (operations === null) {
      // Claim 4.6: UNKNOWN_TOOL with available operations
      this._emitEvent('hook:blocked', session, { tool: toolName });
      await this._appendAudit('translateToolCall', 'allowed', 0, { toolName, errorCode: 'UNKNOWN_TOOL' });
      return toResultError(unknownTool(this.adapterId, toolName, [...KNOWN_TOOLS]));
    }

    await this._appendAudit('translateToolCall', 'allowed', 0, { toolName });
    this._lastActivity = new Date().toISOString();

    return { ok: true, value: operations };
  }

  /**
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 1.10 --
   * Translate native agent action to canonical ComputerAction for governance.
   * Populates all ActionBase fields.
   * F-11: Now evaluates governance before performing translation.
   * F-12: Maps native action types to required capabilities.
   */
  async translateActionToGovernance(action: NativeAgentAction): Promise<Result<ComputerAction>> {
    const guard = this._guardCoreOperation();
    if (guard) return toResultError(guard);

    // Validate the native payload (SERDE check, prec 4)
    if (!action.nativeType || !action.nativePayload) {
      return toResultError(serdeError(this.adapterId, 'Missing nativeType or nativePayload in NativeAgentAction'));
    }

    const session = this._sessions.get(action.sessionId);
    if (!session) return toResultError(sessionNotFound(this.adapterId, action.sessionId));

    // F-11: Governance evaluation BEFORE capability check
    const govAction: GovernanceAction = {
      domain: 'computer',
      operation: action.nativeType,
    };
    const ctx = this._sessionToCtx(session);
    const govResult = await this._evaluateGovernance(ctx, session, govAction, 'translateActionToGovernance');
    if (govResult) return toResultError(govResult);

    // F-12: Map native action type to required capability
    const requiredCapability = NATIVE_TYPE_TO_CAPABILITY[action.nativeType];
    if (requiredCapability && !this.capabilities.has(requiredCapability)) {
      return toResultError(capabilityNotDeclared(this.adapterId, requiredCapability));
    }

    // Claim 1.10: Populate all ActionBase fields
    const computerAction: ComputerAction = {
      type: mapNativeTypeToComputerActionType(action.nativeType),
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

  /**
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Invariant 11 --
   * Convenience method that delegates to the canonical `translateToolCall`.
   * Per Invariant 11: convenience methods may be added but cannot replace
   * canonical translation, session, event, health, or registry semantics.
   *
   * @see translateToolCall - The canonical contract method for tool translation.
   */
  async executeToolCall(
    ctx: OperationContext,
    toolCall: CrewAIToolCall,
  ): Promise<Result<LimenOperation[]>> {
    // Delegates to translateToolCall which handles governance
    return this.translateToolCall(toolCall, ctx.sessionId);
  }

  // ── Public: Event Bridge ──

  /**
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 3.8 --
   * Pure data transformation. No governance, no audit, no side effects.
   */
  mapNativeEvent(nativeEvent: CrewAIHookEvent): AgentEventPayload | null {
    // Use first session for metadata (pure transform, no governance)
    const first = this._sessions.values().next();
    const session = first.done ? null : first.value;
    return hookMapNativeEvent(
      nativeEvent,
      this.adapterId,
      this._config?.agentId ?? '' as AgentId,
      session?.sessionId ?? null,
    );
  }

  /**
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 3.8 --
   * Pure data transformation. No governance, no audit, no side effects.
   */
  mapLimenEvent(limenEvent: AgentEventPayload): CrewAIHookEvent | null {
    return hookMapLimenEvent(limenEvent);
  }

  // ── Public: Health ──

  /**
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 1.12 --
   * Live health check with Core connectivity probe.
   * Available in all states except SHUTDOWN.
   * Claim 6.5: Produces audit entry recording probe result.
   * F-01: Returns a NEW immutable health object, never mutates the returned object.
   */
  async healthCheck(): Promise<Result<Readonly<AdapterHealth>>> {
    if (this._lifecycle.isShutdown()) {
      return toResultError(notInitialized(this.adapterId));
    }

    // F-01: Start with base health snapshot
    const baseHealth = this.getHealth();
    let probedCorePortConnected = baseHealth.corePortConnected;

    // If we have a client, do a live probe
    if (this._client && this._lifecycle.state !== 'UNINITIALIZED') {
      try {
        const probe = await this._client.healthProbe();
        probedCorePortConnected = probe.connected;
        // Claim 6.5: audit entry
        await this._appendAudit('healthCheck', 'not_applicable', 0);
      } catch {
        probedCorePortConnected = false;
      }
    }

    // F-01: Create a NEW object with probed value -- never mutate baseHealth
    const health: Readonly<AdapterHealth> = {
      ...baseHealth,
      corePortConnected: probedCorePortConnected,
    };

    return { ok: true, value: health };
  }

  /**
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 1.8 --
   * Synchronous health. Does NOT block on I/O.
   * Returns last-known state as a Readonly object.
   * F-01: Return type is Readonly<AdapterHealth>, not mutable.
   */
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
      details: {
        lastOperationEstimate: this._lastOperationEstimate,
      },
    });
  }

  // ── Public: Subscriptions ──

  /**
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 1.13 --
   * Register event subscription.
   * Permitted in all states except SHUTDOWN.
   * Returns unique subscription ID.
   */
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

  /**
   * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 1.13 --
   * Unregister event subscription.
   * Permitted in all states except SHUTDOWN.
   * Unknown subscription ID is a no-op.
   */
  off(subscriptionId: string): void {
    if (this._lifecycle.isShutdown()) {
      throw new CrewAIAdapterError({
        code: 'NOT_INITIALIZED',
        message: 'Cannot manage subscriptions on a shut-down adapter',
        adapterId: this.adapterId,
        retryable: false,
      });
    }

    // Claim 1.13: off() with unknown ID is a no-op
    this._subscriptions.delete(subscriptionId);
  }

  // ── Public: Testing Hooks ──

  /**
   * Inject agent state for testing governance paths.
   * NOT part of the public adapter contract -- test utility only.
   */
  _setAgentState(state: 'active' | 'suspended' | 'decommissioned'): void {
    this._agentState = state;
  }

  /**
   * Simulate core port loss for testing DEGRADED state.
   */
  _simulateCorePortLoss(): void {
    this._corePortConnected = false;
    this._lifecycle.transition('DEGRADED');
  }

  /**
   * Simulate core port recovery.
   */
  _simulateCorePortRecovery(): void {
    this._corePortConnected = true;
    this._lifecycle.transition('READY');
    this._errorCount = 0;
  }

  /**
   * Inject audit failure for testing audit-before-success invariant.
   * F-08: 'post' type is now properly checked in _appendAudit.
   */
  _injectAuditFailure(type: 'pre' | 'post'): void {
    if (type === 'pre') {
      this._auditFailureInjected = true;
    } else {
      this._postAuditFailureInjected = true;
    }
  }

  /**
   * Clear injected audit failures.
   */
  _clearAuditFailure(): void {
    this._auditFailureInjected = false;
    this._postAuditFailureInjected = false;
  }

  /** Get audit entries for test inspection */
  _getAuditEntries(): ReadonlyArray<Partial<CrewAIAuditDetails>> {
    return this._auditEntries;
  }

  /** Get lifecycle state */
  get lifecycleState(): AdapterLifecycleState {
    return this._lifecycle.state;
  }

  // ── Private: Guards ──

  /**
   * Guard for core operations. Returns error if not in READY state.
   * Claim 7.3: DEGRADED -> CORE_PORT_UNAVAILABLE
   * F-13: This is the SOLE guard for core operations. No separate _corePortConnected checks.
   */
  private _guardCoreOperation(): CrewAIAdapterError | null {
    if (this._lifecycle.isShutdown() || this._lifecycle.isUninitialized() || this._lifecycle.state === 'INITIALIZING') {
      return notInitialized(this.adapterId);
    }
    if (this._lifecycle.isDegraded()) {
      return corePortUnavailable(this.adapterId, this._config?.coreEndpoint || '', 'Adapter is in DEGRADED state');
    }
    // F-13: If lifecycle is READY but core port is disconnected, transition to DEGRADED
    if (!this._corePortConnected) {
      this._lifecycle.transition('DEGRADED');
      return corePortUnavailable(this.adapterId, this._config?.coreEndpoint || '', 'Core port disconnected, transitioning to DEGRADED');
    }
    return null;
  }

  // ── Private: Governance ──

  /**
   * CREWAI_ADAPTER_CONTRACT.md S5.1 --
   * Evaluate governance gate.
   * Claim 3.3: Every side-effecting operation passes through governance.
   * Claim 3.6: Suspended/decommissioned -> GOVERNANCE_REFUSAL
   */
  private async _evaluateGovernance(
    ctx: OperationContext,
    session: AgentSession,
    action: GovernanceAction,
    operation: string,
  ): Promise<CrewAIAdapterError | null> {
    // Claim 3.6: Agent state check precedes all other governance
    if (this._agentState !== 'active') {
      const refVerdict: GovernanceVerdict = {
        verdict: 'refuse',
        auditId: `evt-state-${Date.now()}` as EventId,
        reason: 'agent_state_not_active',
        rule: 'agent_state_check',
      };
      await this._appendAudit(operation as CrewAIAuditDetails['operationType'], 'refused', 0);
      this._emitEvent('governance:refused', session, { operation, reason: 'agent_state_not_active' });
      return governanceRefusal(
        this.adapterId,
        operation,
        'agent_state_not_active',
        'agent_state_check',
        refVerdict,
      );
    }

    // Evaluate via governor if available
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
          await this._appendAudit(operation as CrewAIAuditDetails['operationType'], 'refused', 0);
          this._emitEvent('governance:refused', session, { operation, verdict });
          return governanceRefusal(
            this.adapterId,
            operation,
            verdict.reason,
            verdict.rule,
            verdict,
            verdict.alternatives,
          );
        }

        if (verdict.verdict === 'escalate') {
          await this._appendAudit(operation as CrewAIAuditDetails['operationType'], 'escalated', 0);
          this._emitEvent('governance:escalated', session, { operation, verdict });
          return governanceRefusal(
            this.adapterId,
            operation,
            verdict.reason,
            'escalation_required',
            verdict,
          );
        }
      } catch (err) {
        // Governor failure doesn't bypass -- fail closed
        return internalError(this.adapterId, `Governor error: ${String(err)}`);
      }
    }

    return null;
  }

  // ── Private: Token Budget ──

  /**
   * CREWAI_ADAPTER_CONTRACT.md S7.2 --
   * Check token budget before operation.
   * Claim 5.1: After governance allows.
   * INV-10: Budget never negative.
   * F-14: Overflow detection added.
   */
  private _checkTokenBudget(estimatedTokens: number): CrewAIAdapterError | null {
    // F-14: Overflow detection
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

  /**
   * Consume tokens from budget.
   * INV-10: Checked arithmetic, never negative.
   */
  private _consumeTokens(tokens: number): void {
    this._tokenBudgetConsumed += tokens;
    this._lastOperationEstimate = {
      tokens,
      encoding: this._config?.tokenBudget.encoding ?? 'cl100k_base',
      overflow: false,
      components: { operation: tokens },
    };

    // Claim 5.2: Warning threshold
    const config = this._config;
    if (config && !this._warningEmitted) {
      const pctUsed = (this._tokenBudgetConsumed / this._tokenBudgetTotal) * 100;
      if (pctUsed >= config.tokenBudget.warningThresholdPct) {
        this._warningEmitted = true;
        const first = this._sessions.values().next();
        const session = first.done ? null : first.value;
        if (session) {
          this._emitEvent('budget:exhausted', session, {
            consumed: this._tokenBudgetConsumed,
            total: this._tokenBudgetTotal,
          });
        }
      }
    }
  }

  // ── Private: Token Estimation (F-15) ──
  //
  // Token estimation uses a heuristic of ~4 characters per token (based on
  // average English tokenizer ratios for cl100k_base). Estimates are APPROXIMATE
  // and include operation-specific overhead (audit entries, governance context).
  // Consumers setting tight token budgets should account for up to 10% variance
  // per SHARED_TYPES.md §20.1 TokenEstimate.varianceUpperBoundPct.

  /**
   * F-15: Operation-specific token estimation for remember.
   * Components: content + structured_content + audit overhead + governance overhead.
   * Note: Uses ~4 chars/token heuristic. Estimates are approximate (≤10% variance).
   */
  private _estimateRememberTokens(content: string | StructuredContent, options?: RememberOptions): number {
    const serialized = typeof content === 'string' ? content : JSON.stringify(content);
    const contentTokens = Math.ceil(serialized.length / 4);
    const structuredContentTokens = options ? Math.ceil(JSON.stringify(options).length / 4) : 0;
    return contentTokens + structuredContentTokens + AUDIT_OVERHEAD_TOKENS + GOVERNANCE_OVERHEAD_TOKENS;
  }

  /**
   * F-15: Operation-specific token estimation for recall.
   * Components: query + (limit * average_belief_size) + audit overhead.
   */
  private _estimateRecallTokens(query: AgentRecallQuery, options?: AgentRecallOptions): number {
    const queryTokens = Math.ceil(JSON.stringify(query).length / 4);
    const limit = options?.limit ?? 10;
    const responseTokens = limit * AVG_BELIEF_SIZE_TOKENS;
    return queryTokens + responseTokens + AUDIT_OVERHEAD_TOKENS;
  }

  /**
   * F-15: Operation-specific token estimation for branch creation.
   */
  private _estimateBranchTokens(description: string): number {
    return BRANCH_BASE_TOKENS + Math.ceil(description.length / 4) + AUDIT_OVERHEAD_TOKENS;
  }

  /**
   * F-15: Operation-specific token estimation for merge.
   * Components: base + branch_count * avg_conflict_size + audit overhead.
   */
  private _estimateMergeTokens(branchIds: readonly AgentBranchId[]): number {
    return BRANCH_BASE_TOKENS + (branchIds.length * AVG_CONFLICT_SIZE_TOKENS) + AUDIT_OVERHEAD_TOKENS;
  }

  /**
   * F-15: Operation-specific token estimation for conflict resolution.
   */
  private _estimateResolveTokens(resolution: ManualMergeResolutionRequest): number {
    const baseTokens = Math.ceil(JSON.stringify(resolution).length / 4);
    return baseTokens + BRANCH_BASE_TOKENS + AUDIT_OVERHEAD_TOKENS;
  }

  // ── Private: Confidence Cap ──

  /**
   * CREWAI_ADAPTER_CONTRACT.md S5.4, Claim 3.5 --
   * Cap confidence per trust level. Silent cap, no error.
   * INV-8: Never increases confidence beyond trust-level cap.
   */
  private _applyConfidenceCap(options?: RememberOptions): RememberOptions | undefined {
    if (!options?.confidence || !this._config) return options;

    const cap = TRUST_CONFIDENCE_CAPS[this._config.trustLevel];
    if (options.confidence > cap) {
      return { ...options, confidence: cap };
    }
    return options;
  }

  /**
   * CREWAI_ADAPTER_CONTRACT.md S3.3, Claim 2.3 --
   * Auto-populate crew context from active session when omitted.
   * F-16: When options is undefined, create a new object with crewContext.
   * Never return undefined.
   */
  private _enrichRememberOptions(options: RememberOptions | undefined, session: AgentSession): RememberOptions {
    const crewContext: CrewContext = {
      crewId: (session.metadata.crewId as string) || '',
      agentRole: (session.metadata.agentRole as string) || '',
      taskId: (session.metadata.taskId as string & { __brand: 'TaskId' }) || null,
      delegationDepth: (session.metadata.delegationDepth as number) || 0,
    };

    if (!options) {
      // F-16: Create new object with crewContext when options is undefined
      return { crewContext };
    }
    if (options.crewContext) return options;

    return {
      ...options,
      crewContext,
    };
  }

  // ── Private: Audit ──

  /**
   * CREWAI_ADAPTER_CONTRACT.md S8.1, Claim 6.1 --
   * Append audit entry. If this fails, the operation MUST fail.
   * Claim 6.2: Audit failure returns AUDIT_FAILURE.
   * F-08: Checks _postAuditFailureInjected for post-operation audit calls.
   */
  private async _appendAudit(
    operationType: CrewAIAuditDetails['operationType'],
    governanceState: CrewAIAuditDetails['governanceState'],
    tokenCost: number,
    extra?: Partial<CrewAIAuditDetails>,
  ): Promise<Result<EventId>> {
    // Test hooks for pre-operation audit failure injection
    if (this._auditFailureInjected) {
      this._auditFailureInjected = false; // One-shot
      return toResultError(auditFailure(this.adapterId, operationType, 'Injected audit failure'));
    }

    // F-08: Check post-audit failure injection for post-operation audit calls
    if (this._postAuditFailureInjected && this._auditCallCount > 0) {
      this._postAuditFailureInjected = false; // One-shot
      return toResultError(auditFailure(this.adapterId, operationType, 'Injected post-operation audit failure'));
    }

    const entry: Partial<CrewAIAuditDetails> = {
      operationType,
      crewId: this._config?.crewId || '',
      agentRole: this._config?.agentRole || '',
      delegationDepth: 0,
      tokenCost,
      governanceState,
      duration: 0,
      ...extra,
    };

    this._auditEntries.push(entry);

    // Delegate to Limen Core if available
    if (this._client) {
      try {
        const eventId = await this._client.appendAudit({
          details: entry as Readonly<Record<string, unknown>>,
        });
        return { ok: true, value: eventId };
      } catch {
        return toResultError(auditFailure(this.adapterId, operationType, 'Core audit append failed'));
      }
    }

    return { ok: true, value: `evt-local-${Date.now()}` as EventId };
  }

  /**
   * Raw audit append without validation -- used during shutdown.
   */
  private async _appendAuditRaw(entry: Partial<CrewAIAuditDetails>): Promise<void> {
    this._auditEntries.push(entry);
    if (this._client) {
      try {
        await this._client.appendAudit({ details: entry as Readonly<Record<string, unknown>> });
      } catch {
        // Best-effort in shutdown path
      }
    }
  }

  // ── Private: Events ──

  /**
   * Emit event to all matching subscribers.
   */
  private _emitEvent(
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

  /** Clear all subscriptions (Claim 1.13: shutdown clears all) */
  private _clearSubscriptions(): void {
    this._subscriptions.clear();
  }

  // ── Private: Session Helpers ──

  /**
   * F-02: Get session from operation context.
   * REQUIRES ctx.sessionId. If missing or not found, returns null.
   * NEVER falls back to an arbitrary session.
   */
  private _getSessionFromCtx(ctx: OperationContext): AgentSession | null {
    if (!ctx.sessionId) {
      return null;
    }
    return this._sessions.get(ctx.sessionId) ?? null;
  }

  private _sessionToCtx(session: AgentSession): OperationContext {
    return {
      tenantId: session.tenantId,
      userId: null,
      agentId: session.agentId,
      permissions: new Set(),
      sessionId: session.sessionId,
      clearanceLevel: session.clearanceLevel,
    };
  }
}

// ── Helpers ──

function classificationToNum(classification: string): number {
  const map: Record<string, number> = {
    unrestricted: 0,
    internal: 1,
    confidential: 2,
    restricted: 3,
    critical: 4,
  };
  return map[classification] ?? 0;
}

function mapNativeTypeToComputerActionType(nativeType: string): string {
  const map: Record<string, string> = {
    'crew_delegation': 'process:spawn',
    'file_read': 'file:read',
    'file_write': 'file:write',
    'terminal': 'terminal:execute',
    'browser': 'browser:navigate',
    'code': 'code:execute',
  };
  return map[nativeType] || `native:${nativeType}`;
}
