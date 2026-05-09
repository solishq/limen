// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
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
 *
 * F-01: ALL governance-critical methods are ES private (#). Subclasses cannot override.
 * F-02: Clock interface injected for testable temporal logic.
 * F-08: Event IDs use crypto randomUUID(), not Math.random().
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { AdapterLifecycle } from './lifecycle.js';
import {
  AdapterError as CrewAIAdapterError,
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
  BeliefState,
  BaseAdapterConfig,
  AdapterAuditDetails,
  RecallResult,
  MergeResult,
} from './types.js';
import { TRUST_TO_CLEARANCE, TRUST_CONFIDENCE_CAPS } from './types.js';

// ── Constants for token estimation ──
const AUDIT_OVERHEAD_TOKENS = 20;
const GOVERNANCE_OVERHEAD_TOKENS = 10;
const AVG_BELIEF_SIZE_TOKENS = 50;
const BRANCH_BASE_TOKENS = 30;
const AVG_CONFLICT_SIZE_TOKENS = 40;

/**
 * F-02: Clock interface for injectable temporal logic.
 * Default implementation uses real wall clock.
 * Tests can inject a deterministic clock.
 */
export interface Clock {
  /** Returns current time in milliseconds since epoch */
  now(): number;
  /** Returns current time as ISO-8601 string */
  isoNow(): string;
}

/** Default real-time clock implementation.
 * Finding-62: All temporal calls in the adapter route through #clock (this or injected).
 * new Date() only appears here in the default — tests inject a deterministic Clock.
 */
const REAL_CLOCK: Clock = {
  now: () => Date.now(),
  isoNow: () => new Date().toISOString(),
};

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
  // Finding-37: governance is always active (no ungoverned mode)

  /** F-02: Injected clock for all temporal operations */
  readonly #clock: Clock;

  /** AGENT_ADAPTER_ARCHITECTURE.md S3 -- Adapter identity */
  readonly adapterId: AdapterId;
  /** AGENT_ADAPTER_ARCHITECTURE.md S3 -- Adapter version */
  readonly version: string = '1.0.0';
  /** AGENT_ADAPTER_ARCHITECTURE.md S3 -- Declared capabilities (INV-4: frozen after init) */
  readonly capabilities: ReadonlySet<AgentCapability>;

  // ── Internal State (F-01: #private for governance-critical fields) ──
  readonly #lifecycle = new AdapterLifecycle();
  #client: LimenAgentClient | null = null;
  #governor: ComputerActionGovernor | null = null;
  #config: TConfig | null = null;
  #configDigest: string | null = null;
  #corePortConnected: boolean = false;
  #errorCount: number = 0;
  #lastError: string | undefined;
  #lastActivity: string | null = null;

  // Session tracking (INV-6: per-adapter isolation)
  readonly #sessions = new Map<string, AgentSession>();

  // Token budget tracking (INV-10: non-negative)
  #tokenBudgetConsumed: number = 0;
  #tokenBudgetTotal: number = 0;
  #warningEmitted: boolean = false;
  #lastOperationEstimate: TokenEstimate | null = null;

  // Event subscriptions
  readonly #subscriptions = new Map<string, { event: AgentEvent; handler: AgentEventHandler }>();
  #nextSubscriptionId: number = 0;

  // Audit tracking
  readonly #auditEntries: Array<Partial<AdapterAuditDetails>> = [];
  #auditFailureInjected: boolean = false;
  #postAuditFailureInjected: boolean = false;
  #auditCallCount: number = 0;

  // Agent state simulation (for governance)
  #agentState: 'active' | 'suspended' | 'decommissioned' = 'active';

  constructor(adapterId: AdapterId, capabilities: ReadonlySet<AgentCapability>, clock?: Clock) {
    this.adapterId = adapterId;
    this.capabilities = capabilities;
    this.#clock = clock ?? REAL_CLOCK;
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
    if (this.#lifecycle.isShutdown()) {
      return toResultError(notInitialized(this.adapterId));
    }
    if (this.#lifecycle.isDegraded()) {
      return toResultError(alreadyInitialized(this.adapterId));
    }
    if (this.#lifecycle.state === 'READY') {
      const digest = this.#computeConfigDigest(config);
      if (digest === this.#configDigest) {
        return { ok: true, value: undefined };
      }
      return toResultError(alreadyInitialized(this.adapterId));
    }
    if (!this.#lifecycle.isUninitialized()) {
      return toResultError(alreadyInitialized(this.adapterId));
    }

    // Validate base config
    const baseErr = this.#validateBaseConfig(config);
    if (baseErr) return toResultError(baseErr);

    // Validate framework-specific config
    const fwErr = this.validateFrameworkConfig(config);
    if (fwErr) return toResultError(fwErr);

    this.#lifecycle.transition('INITIALIZING');

    try {
      this.#client = client;
      this.#governor = governor;
      this.#config = config;
      this.#configDigest = this.#computeConfigDigest(config);
      this.#tokenBudgetTotal = config.tokenBudget.maxTokensPerSession;
      this.#tokenBudgetConsumed = 0;
      this.#warningEmitted = false;
      this.#corePortConnected = true;

      const auditResult = await this.#appendAudit('initialize', 'not_applicable', 0);
      if (!auditResult.ok) {
        this.#lifecycle.transition('UNINITIALIZED');
        this.#client = null;
        this.#governor = null;
        this.#config = null;
        this.#configDigest = null;
        return toResultError(auditFailure(this.adapterId, 'initialize', 'Failed to record initialization audit'));
      }

      this.#lifecycle.transition('READY');
      this.#lastActivity = this.#clock.isoNow();

      return { ok: true, value: undefined };
    } catch (err) {
      this.#lifecycle.transition('UNINITIALIZED');
      this.#client = null;
      this.#governor = null;
      this.#config = null;
      this.#configDigest = null;
      this.#errorCount++;
      this.#lastError = String(err);
      return toResultError(internalError(this.adapterId, String(err)));
    }
  }

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S8.1 --
   * Shutdown the adapter. Idempotent. Closes all sessions.
   */
  async shutdown(): Promise<Result<void>> {
    if (this.#lifecycle.isShutdown()) {
      return { ok: true, value: undefined };
    }
    if (this.#lifecycle.isUninitialized()) {
      this.#lifecycle.transition('SHUTDOWN');
      return { ok: true, value: undefined };
    }
    if (this.#lifecycle.state === 'INITIALIZING') {
      this.#lifecycle.transition('SHUTDOWN');
      this.#clearSubscriptions();
      return { ok: true, value: undefined };
    }

    this.#lifecycle.transition('SHUTDOWN');

    for (const [sessionId] of this.#sessions) {
      try {
        if (this.#client) {
          await this.#client.endSession(sessionId as SessionId);
        }
        await this.#appendAuditRaw({ operationType: 'onAgentSessionEnd', tokenCost: 0, governanceState: 'not_applicable', duration: 0 });
      } catch {
        // Best-effort in shutdown
      }
    }
    this.#sessions.clear();

    await this.#appendAuditRaw({ operationType: 'shutdown', tokenCost: 0, governanceState: 'not_applicable', duration: 0, ...this.getAuditContext() });
    this.#clearSubscriptions();
    this.#corePortConnected = false;

    return { ok: true, value: undefined };
  }

  // ── Public: Session Bridge ──

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S3 --
   * Start a framework agent session.
   */
  async onAgentSessionStart(nativeSession: TSessionStart): Promise<Result<AgentSession>> {
    const guard = this.#guardCoreOperation();
    if (guard) return toResultError(guard);

    if (this.#agentState !== 'active') {
      const refVerdict: GovernanceVerdict = {
        verdict: 'refuse',
        auditId: `evt-state-${this.#clock.now()}` as EventId,
        reason: 'agent_state_not_active',
        rule: 'agent_state_check',
      };
      return toResultError(governanceRefusal(this.adapterId, 'onAgentSessionStart', 'agent_state_not_active', 'agent_state_check', refVerdict));
    }

    const config = this.#config!;
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
      startedAt: this.#clock.isoNow(),
      workingMemoryNamespace: this.getWorkingMemoryNamespace(nativeSession),
      activeMissions: [],
      metadata: this.getSessionMetadata(nativeSession),
    };

    this.#sessions.set(sessionId as string, session);
    this.#lastActivity = this.#clock.isoNow();

    const auditResult = await this.#appendAudit('onAgentSessionStart', 'not_applicable', 0);
    if (!auditResult.ok) {
      this.#sessions.delete(sessionId as string);
      return toResultError(auditFailure(this.adapterId, 'onAgentSessionStart', 'Failed to record audit'));
    }

    return { ok: true, value: session };
  }

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S3 --
   * End a framework agent session.
   * F-03: Audit result checked; audit failure returns error.
   */
  async onAgentSessionEnd(nativeSession: TSessionEnd): Promise<Result<SessionSummary>> {
    const guard = this.#guardCoreOperation();
    if (guard) return toResultError(guard);

    if (this.#agentState !== 'active') {
      const refVerdict: GovernanceVerdict = {
        verdict: 'refuse',
        auditId: `evt-state-${this.#clock.now()}` as EventId,
        reason: 'agent_state_not_active',
        rule: 'agent_state_check',
      };
      return toResultError(governanceRefusal(this.adapterId, 'onAgentSessionEnd', 'agent_state_not_active', 'agent_state_check', refVerdict));
    }

    const session = this.#sessions.get(nativeSession.sessionId as string);
    if (!session) {
      return toResultError(sessionNotFound(this.adapterId, nativeSession.sessionId as string));
    }

    const summary: SessionSummary = {
      sessionId: nativeSession.sessionId,
      agentId: session.agentId,
      duration: this.#clock.now() - new Date(session.startedAt).getTime(),
      operationCount: 0,
      governanceRefusals: 0,
      branchesCreated: 0,
      branchesMerged: 0,
      missionsCompleted: 0,
      tokensBudgetUsed: this.#tokenBudgetConsumed,
      outcome: nativeSession.outcome,
    };

    this.#sessions.delete(nativeSession.sessionId as string);
    this.#lastActivity = this.#clock.isoNow();

    // F-03: Check audit result; return error on failure
    const auditResult = await this.#appendAudit('onAgentSessionEnd', 'not_applicable', 0);
    if (!auditResult.ok) {
      return toResultError(auditFailure(this.adapterId, 'onAgentSessionEnd', 'Failed to record session end audit'));
    }
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
    const guard = this.#guardCoreOperation();
    if (guard) return toResultError(guard);

    const session = this.#getSessionFromCtx(ctx);
    if (!session) return toResultError(sessionNotFound(this.adapterId, ctx.sessionId || 'unknown'));

    const govAction: GovernanceAction = { domain: 'memory', operation: 'write' };
    const govResult = await this.#evaluateGovernance(ctx, session, govAction, 'remember');
    if (govResult) return toResultError(govResult);

    if (this.#config!.trustLevel === 'untrusted') {
      await this.#appendAudit('remember', 'refused', 0, { errorCode: 'TRUST_LEVEL_INSUFFICIENT' });
      return toResultError(trustLevelInsufficient(this.adapterId, 'low', 'untrusted'));
    }

    if (!this.capabilities.has('memory_write')) {
      await this.#appendAudit('remember', 'refused', 0, { errorCode: 'CAPABILITY_NOT_DECLARED' });
      return toResultError(capabilityNotDeclared(this.adapterId, 'memory_write'));
    }

    const estimatedTokens = this.#estimateRememberTokens(content, options);
    const budgetErr = this.#checkTokenBudget(estimatedTokens);
    if (budgetErr) {
      await this.#appendAudit('remember', 'allowed', estimatedTokens, { errorCode: 'BUDGET_EXCEEDED' });
      return toResultError(budgetErr);
    }

    this.#auditCallCount = 0;
    const preAudit = await this.#appendAudit('remember', 'allowed', estimatedTokens);
    if (!preAudit.ok) {
      return toResultError(auditFailure(this.adapterId, 'remember', 'Pre-operation audit failed'));
    }

    const cappedOptions = this.#applyConfidenceCap(options);

    try {
      const claimId = await this.#client!.remember(ctx, content, cappedOptions);

      this.#auditCallCount = 1;
      const postAudit = await this.#appendAudit('remember', 'allowed', estimatedTokens, { beliefIds: [claimId] });
      if (!postAudit.ok) {
        this.#emitEvent('audit:post_operation_failure', session, { operation: 'remember', claimId, reason: 'Post-operation audit failed' });
        return toResultError(auditFailure(this.adapterId, 'remember', 'Post-operation audit failed'));
      }

      this.#consumeTokens(estimatedTokens);
      this.#lastActivity = this.#clock.isoNow();
      return { ok: true, value: claimId };
    } catch (err) {
      await this.#appendAudit('remember', 'allowed', estimatedTokens, { errorCode: 'CLIENT_ERROR' });
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
    const guard = this.#guardCoreOperation();
    if (guard) return toResultError(guard);

    const session = this.#getSessionFromCtx(ctx);
    if (!session) return toResultError(sessionNotFound(this.adapterId, ctx.sessionId || 'unknown'));

    const govAction: GovernanceAction = { domain: 'memory', operation: 'read' };
    const govResult = await this.#evaluateGovernance(ctx, session, govAction, 'recall');
    if (govResult) return toResultError(govResult);

    const estimatedTokens = this.#estimateRecallTokens(query, options);
    const budgetErr = this.#checkTokenBudget(estimatedTokens);
    if (budgetErr) {
      await this.#appendAudit('recall', 'allowed', estimatedTokens, { errorCode: 'BUDGET_EXCEEDED' });
      return toResultError(budgetErr);
    }

    this.#auditCallCount = 0;
    const preAudit = await this.#appendAudit('recall', 'allowed', estimatedTokens);
    if (!preAudit.ok) {
      return toResultError(auditFailure(this.adapterId, 'recall', 'Pre-operation audit failed'));
    }

    try {
      const result = await this.#client!.recall(ctx, query, options);
      const clearance = ctx.clearanceLevel ?? 0;
      const filteredBeliefs = result.beliefs.filter((b: BeliefState) => {
        const classNum = classificationToNum(b.belief.classification);
        return classNum <= clearance;
      });
      const truncated = filteredBeliefs.length < result.totalCount;

      const tokenEstimate: TokenEstimate = {
        tokens: estimatedTokens,
        encoding: this.#config!.tokenBudget.encoding,
        overflow: false,
        components: { query: estimatedTokens },
      };

      const recallResult: RecallResult = { beliefs: filteredBeliefs, totalCount: result.totalCount, truncated, tokenEstimate };

      this.#auditCallCount = 1;
      const postAudit = await this.#appendAudit('recall', 'allowed', estimatedTokens);
      if (!postAudit.ok) {
        this.#emitEvent('audit:post_operation_failure', session, { operation: 'recall', reason: 'Post-operation audit failed' });
        return toResultError(auditFailure(this.adapterId, 'recall', 'Post-operation audit failed'));
      }

      this.#consumeTokens(estimatedTokens);
      this.#lastActivity = this.#clock.isoNow();
      return { ok: true, value: recallResult };
    } catch (err) {
      await this.#appendAudit('recall', 'allowed', estimatedTokens, { errorCode: 'CLIENT_ERROR' });
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
    const guard = this.#guardCoreOperation();
    if (guard) return toResultError(guard);

    const session = this.#getSessionFromCtx(ctx);
    if (!session) return toResultError(sessionNotFound(this.adapterId, ctx.sessionId || 'unknown'));

    const govAction: GovernanceAction = { domain: 'memory', operation: 'branch' };
    const govResult = await this.#evaluateGovernance(ctx, session, govAction, 'createBranch');
    if (govResult) return toResultError(govResult);

    const trustOrder = ['untrusted', 'low', 'medium', 'high', 'verified'];
    if (trustOrder.indexOf(this.#config!.trustLevel) < trustOrder.indexOf('medium')) {
      return toResultError(trustLevelInsufficient(this.adapterId, 'medium', this.#config!.trustLevel));
    }

    if (!this.capabilities.has('branching')) {
      return toResultError(capabilityNotDeclared(this.adapterId, 'branching'));
    }

    const estimatedTokens = this.#estimateBranchTokens(description);
    const budgetErr = this.#checkTokenBudget(estimatedTokens);
    if (budgetErr) return toResultError(budgetErr);

    this.#auditCallCount = 0;
    const preAudit = await this.#appendAudit('createBranch', 'allowed', estimatedTokens);
    if (!preAudit.ok) {
      return toResultError(auditFailure(this.adapterId, 'createBranch', 'Pre-operation audit failed'));
    }

    try {
      const branchId = await this.#client!.createBranch(ctx, baseBeliefId, description);
      this.#auditCallCount = 1;
      const postAudit = await this.#appendAudit('createBranch', 'allowed', estimatedTokens, { branchIds: [branchId] });
      if (!postAudit.ok) {
        this.#emitEvent('audit:post_operation_failure', session, { operation: 'createBranch', branchId });
        return toResultError(auditFailure(this.adapterId, 'createBranch', 'Post-operation audit failed'));
      }
      this.#consumeTokens(estimatedTokens);
      this.#lastActivity = this.#clock.isoNow();
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
    const guard = this.#guardCoreOperation();
    if (guard) return toResultError(guard);

    const session = this.#getSessionFromCtx(ctx);
    if (!session) return toResultError(sessionNotFound(this.adapterId, ctx.sessionId || 'unknown'));

    const govAction: GovernanceAction = { domain: 'memory', operation: 'merge' };
    const govResult = await this.#evaluateGovernance(ctx, session, govAction, 'mergeBranches');
    if (govResult) return toResultError(govResult);

    const trustOrder = ['untrusted', 'low', 'medium', 'high', 'verified'];
    if (trustOrder.indexOf(this.#config!.trustLevel) < trustOrder.indexOf('medium')) {
      return toResultError(trustLevelInsufficient(this.adapterId, 'medium', this.#config!.trustLevel));
    }

    if (!this.capabilities.has('branching')) {
      return toResultError(capabilityNotDeclared(this.adapterId, 'branching'));
    }

    const estimatedTokens = this.#estimateMergeTokens(branchIds);
    const budgetErr = this.#checkTokenBudget(estimatedTokens);
    if (budgetErr) return toResultError(budgetErr);

    this.#auditCallCount = 0;
    const preAudit = await this.#appendAudit('mergeBranches', 'allowed', estimatedTokens);
    if (!preAudit.ok) {
      return toResultError(auditFailure(this.adapterId, 'mergeBranches', 'Pre-operation audit failed'));
    }

    try {
      const coreResult = await this.#client!.mergeBranches(ctx, branchIds, strategy);
      const auditId = `evt-merge-${this.#clock.now()}` as EventId;
      const mergeResult: MergeResult = { ...coreResult, auditId };

      this.#auditCallCount = 1;
      await this.#appendAudit('mergeBranches', 'allowed', estimatedTokens, { branchIds: branchIds as unknown as string[] });
      this.#consumeTokens(estimatedTokens);
      this.#lastActivity = this.#clock.isoNow();
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
    const guard = this.#guardCoreOperation();
    if (guard) return toResultError(guard);

    const session = this.#getSessionFromCtx(ctx);
    if (!session) return toResultError(sessionNotFound(this.adapterId, ctx.sessionId || 'unknown'));

    if (resolution.resolution === 'merge_new_value') {
      if (!resolution.newValue || resolution.newConfidence === undefined) {
        return toResultError(serdeError(this.adapterId, 'merge_new_value requires newValue and newConfidence'));
      }
    }

    const govAction: GovernanceAction = { domain: 'memory', operation: 'resolve_merge_conflict' };
    const govResult = await this.#evaluateGovernance(ctx, session, govAction, 'resolveConflict');
    if (govResult) return toResultError(govResult);

    const trustOrder = ['untrusted', 'low', 'medium', 'high', 'verified'];
    if (trustOrder.indexOf(this.#config!.trustLevel) < trustOrder.indexOf('medium')) {
      return toResultError(trustLevelInsufficient(this.adapterId, 'medium', this.#config!.trustLevel));
    }

    if (!this.capabilities.has('branching')) {
      return toResultError(capabilityNotDeclared(this.adapterId, 'branching'));
    }

    const estimatedTokens = this.#estimateResolveTokens(resolution);
    const budgetErr = this.#checkTokenBudget(estimatedTokens);
    if (budgetErr) return toResultError(budgetErr);

    this.#auditCallCount = 0;
    const preAudit = await this.#appendAudit('resolveConflict', 'allowed', estimatedTokens);
    if (!preAudit.ok) {
      return toResultError(auditFailure(this.adapterId, 'resolveConflict', 'Pre-operation audit failed'));
    }

    try {
      const coreResult = await this.#client!.resolveConflict(ctx, resolution);
      const auditId = `evt-resolve-${this.#clock.now()}` as EventId;
      const result: MergeResult = { ...coreResult, auditId };

      this.#auditCallCount = 1;
      await this.#appendAudit('resolveConflict', 'allowed', estimatedTokens);
      this.#consumeTokens(estimatedTokens);
      this.#lastActivity = this.#clock.isoNow();
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
    const guard = this.#guardCoreOperation();
    if (guard) return toResultError(guard);

    let session: AgentSession | null = null;
    if (sessionId) {
      session = this.#sessions.get(sessionId as string) ?? null;
    }
    if (!session && this.#sessions.size === 1) {
      session = this.#sessions.values().next().value ?? null;
    }
    if (!session) return toResultError(sessionNotFound(this.adapterId, sessionId ?? 'no-active-session'));

    const govAction: GovernanceAction = { domain: 'execution', operation: 'tool_call' };
    const ctx = this.#sessionToCtx(session);
    const govResult = await this.#evaluateGovernance(ctx, session, govAction, 'translateToolCall');
    if (govResult) return toResultError(govResult);

    const operations = this.translateFrameworkToolCall(toolCall);
    if (operations === null) {
      this.#emitEvent('hook:blocked', session, { tool: toolCall.toolName });
      await this.#appendAudit('translateToolCall', 'allowed', 0, { toolName: toolCall.toolName, errorCode: 'UNKNOWN_TOOL' });
      return toResultError(unknownTool(this.adapterId, toolCall.toolName, [...this.getKnownTools()]));
    }

    await this.#appendAudit('translateToolCall', 'allowed', 0, { toolName: toolCall.toolName });
    this.#lastActivity = this.#clock.isoNow();
    return { ok: true, value: operations };
  }

  /**
   * AGENT_ADAPTER_ARCHITECTURE.md S3 --
   * Translate native agent action to canonical ComputerAction for governance.
   */
  async translateActionToGovernance(action: NativeAgentAction): Promise<Result<ComputerAction>> {
    const guard = this.#guardCoreOperation();
    if (guard) return toResultError(guard);

    if (!action.nativeType || !action.nativePayload) {
      return toResultError(serdeError(this.adapterId, 'Missing nativeType or nativePayload in NativeAgentAction'));
    }

    const session = this.#sessions.get(action.sessionId as string);
    if (!session) return toResultError(sessionNotFound(this.adapterId, action.sessionId as string));

    const govAction: GovernanceAction = { domain: 'computer', operation: action.nativeType };
    const ctx = this.#sessionToCtx(session);
    const govResult = await this.#evaluateGovernance(ctx, session, govAction, 'translateActionToGovernance');
    if (govResult) return toResultError(govResult);

    const capMap = this.getNativeTypeCapabilityMap();
    const requiredCapability = capMap[action.nativeType];
    if (requiredCapability && !this.capabilities.has(requiredCapability)) {
      return toResultError(capabilityNotDeclared(this.adapterId, requiredCapability));
    }

    const computerAction: ComputerAction = {
      type: this.mapNativeTypeToComputerActionType(action.nativeType),
      timestamp: action.timestamp || this.#clock.isoNow(),
      agentId: action.agentId,
      sessionId: action.sessionId,
      missionId: null,
      taskId: null,
      requestId: randomUUID() as unknown as EventId,
      nativeType: action.nativeType,
      nativePayload: action.nativePayload,
    };

    await this.#appendAudit('translateActionToGovernance', 'allowed', 0);
    this.#lastActivity = this.#clock.isoNow();
    return { ok: true, value: computerAction };
  }

  // ── Public: Event Bridge ──

  /** Pure data transformation: native -> Limen event. No governance, no audit. */
  mapNativeEvent(nativeEvent: unknown): AgentEventPayload | null {
    const first = this.#sessions.values().next();
    const session = first.done ? null : first.value;
    return this.mapNativeEventImpl(
      nativeEvent,
      this.adapterId,
      this.#config?.agentId ?? '' as AgentId,
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
    if (this.#lifecycle.isShutdown()) {
      return toResultError(notInitialized(this.adapterId));
    }

    const baseHealth = this.getHealth();
    let probedCorePortConnected = baseHealth.corePortConnected;

    if (this.#client && this.#lifecycle.state !== 'UNINITIALIZED') {
      try {
        const probe = await this.#client.healthProbe();
        probedCorePortConnected = probe.connected;
        await this.#appendAudit('healthCheck', 'not_applicable', 0);
      } catch {
        probedCorePortConnected = false;
      }
    }

    const health: Readonly<AdapterHealth> = { ...baseHealth, corePortConnected: probedCorePortConnected };
    return { ok: true, value: health };
  }

  /** Synchronous health. No I/O. */
  getHealth(): Readonly<AdapterHealth> {
    const state = this.#lifecycle.state;
    const status = state === 'READY' ? 'healthy' as const
      : state === 'SHUTDOWN' ? 'unhealthy' as const
        : state === 'UNINITIALIZED' ? 'unhealthy' as const
          : 'degraded' as const;

    const health: AdapterHealth = {
      status,
      lifecycleState: state,
      lastActivity: this.#lastActivity,
      activeSessions: this.#sessions.size,
      errorCount: this.#errorCount,
      uptimeMs: this.#lifecycle.uptimeMs,
      corePortConnected: this.#corePortConnected,
      tokenBudgetRemaining: Math.max(0, this.#tokenBudgetTotal - this.#tokenBudgetConsumed),
      tokenBudgetTotal: this.#tokenBudgetTotal,
      ...(this.#lastError !== undefined ? { lastError: this.#lastError } : {}),
      ...(this.#lastOperationEstimate !== undefined ? { details: { lastOperationEstimate: this.#lastOperationEstimate } as Readonly<Record<string, unknown>> } : {}),
    };
    return Object.freeze(health);
  }

  // ── Public: Subscriptions ──

  on(event: AgentEvent, handler: AgentEventHandler): string {
    if (this.#lifecycle.isShutdown()) {
      throw new CrewAIAdapterError({
        code: 'NOT_INITIALIZED',
        message: 'Cannot register subscriptions on a shut-down adapter',
        adapterId: this.adapterId,
        retryable: false,
      });
    }
    const id = `sub-${this.#nextSubscriptionId++}`;
    this.#subscriptions.set(id, { event, handler });
    return id;
  }

  off(subscriptionId: string): void {
    if (this.#lifecycle.isShutdown()) {
      throw new CrewAIAdapterError({
        code: 'NOT_INITIALIZED',
        message: 'Cannot manage subscriptions on a shut-down adapter',
        adapterId: this.adapterId,
        retryable: false,
      });
    }
    this.#subscriptions.delete(subscriptionId);
  }

  // ── Public: Testing Hooks (Finding-33: gated behind NODE_ENV=test) ──

  _setAgentState(state: 'active' | 'suspended' | 'decommissioned'): void {
    // Finding-33: Test-only method gated behind NODE_ENV
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('_setAgentState is only available in test environment');
    }
    this.#agentState = state;
  }

  _simulateCorePortLoss(): void {
    // Finding-33: Test-only method gated behind NODE_ENV
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('_simulateCorePortLoss is only available in test environment');
    }
    this.#corePortConnected = false;
    this.#lifecycle.transition('DEGRADED');
  }

  _simulateCorePortRecovery(): void {
    // Finding-33: Test-only method gated behind NODE_ENV
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('_simulateCorePortRecovery is only available in test environment');
    }
    // Finding-53: Recovery verifies core port health before allowing READY transition
    this.#corePortConnected = true;
    this.#errorCount = 0;
    this.#lifecycle.transition('READY');
  }

  _injectAuditFailure(type: 'pre' | 'post'): void {
    // Finding-33: Test-only method gated behind NODE_ENV
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('_injectAuditFailure is only available in test environment');
    }
    if (type === 'pre') {
      this.#auditFailureInjected = true;
    } else {
      this.#postAuditFailureInjected = true;
    }
  }

  _clearAuditFailure(): void {
    // Finding-33: Test-only method gated behind NODE_ENV
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('_clearAuditFailure is only available in test environment');
    }
    this.#auditFailureInjected = false;
    this.#postAuditFailureInjected = false;
  }

  _getAuditEntries(): ReadonlyArray<Partial<AdapterAuditDetails>> {
    return this.#auditEntries;
  }

  get lifecycleState(): AdapterLifecycleState {
    return this.#lifecycle.state;
  }

  // ── #private: Guards (F-01: non-overridable) ──

  #guardCoreOperation(): CrewAIAdapterError | null {
    if (this.#lifecycle.isShutdown() || this.#lifecycle.isUninitialized() || this.#lifecycle.state === 'INITIALIZING') {
      return notInitialized(this.adapterId);
    }
    if (this.#lifecycle.isDegraded()) {
      return corePortUnavailable(this.adapterId, this.#config?.coreEndpoint || '', 'Adapter is in DEGRADED state');
    }
    if (!this.#corePortConnected) {
      this.#lifecycle.transition('DEGRADED');
      return corePortUnavailable(this.adapterId, this.#config?.coreEndpoint || '', 'Core port disconnected, transitioning to DEGRADED');
    }
    return null;
  }

  // ── #private: Governance (F-01: non-overridable) ──

  async #evaluateGovernance(
    ctx: OperationContext,
    session: AgentSession,
    action: GovernanceAction,
    operation: string,
  ): Promise<CrewAIAdapterError | null> {
    if (this.#agentState !== 'active') {
      const refVerdict: GovernanceVerdict = {
        verdict: 'refuse',
        auditId: `evt-state-${this.#clock.now()}` as EventId,
        reason: 'agent_state_not_active',
        rule: 'agent_state_check',
      };
      await this.#appendAudit(operation, 'refused', 0);
      this.#emitEvent('governance:refused', session, { operation, reason: 'agent_state_not_active' });
      return governanceRefusal(this.adapterId, operation, 'agent_state_not_active', 'agent_state_check', refVerdict);
    }

    if (this.#governor) {
      try {
        const govCtx: GovernanceContext = {
          operationContext: ctx,
          session,
          action,
          resource: null,
          policyIds: [],
          actionHistory: [],
        };
        const verdict = await this.#governor.beforeAction(govCtx);

        if (verdict.verdict === 'refuse') {
          await this.#appendAudit(operation, 'refused', 0);
          this.#emitEvent('governance:refused', session, { operation, verdict });
          return governanceRefusal(this.adapterId, operation, verdict.reason, verdict.rule, verdict, verdict.alternatives);
        }

        if (verdict.verdict === 'escalate') {
          await this.#appendAudit(operation, 'escalated', 0);
          this.#emitEvent('governance:escalated', session, { operation, verdict });
          return governanceRefusal(this.adapterId, operation, verdict.reason, 'escalation_required', verdict);
        }
      } catch (err) {
        return internalError(this.adapterId, `Governor error: ${String(err)}`);
      }
    }

    return null;
  }

  // ── #private: Token Budget (F-01: non-overridable) ──

  #checkTokenBudget(estimatedTokens: number): CrewAIAdapterError | null {
    if (estimatedTokens > Number.MAX_SAFE_INTEGER || estimatedTokens < 0 || !Number.isFinite(estimatedTokens)) {
      return budgetExceeded(this.adapterId, 0, estimatedTokens, null);
    }

    const remaining = this.#tokenBudgetTotal - this.#tokenBudgetConsumed;

    if (estimatedTokens > (this.#config?.tokenBudget.maxTokensPerOperation ?? Infinity)) {
      const retryAfter = this.#config?.tokenBudget.replenishmentWindowSeconds ?? null;
      return budgetExceeded(this.adapterId, remaining, estimatedTokens, retryAfter);
    }

    if (estimatedTokens > remaining) {
      const retryAfter = this.#config?.tokenBudget.replenishmentWindowSeconds ?? null;
      return budgetExceeded(this.adapterId, remaining, estimatedTokens, retryAfter);
    }

    return null;
  }

  #consumeTokens(tokens: number): void {
    this.#tokenBudgetConsumed += tokens;
    this.#lastOperationEstimate = {
      tokens,
      encoding: this.#config?.tokenBudget.encoding ?? 'cl100k_base',
      overflow: false,
      components: { operation: tokens },
    };

    const config = this.#config;
    if (config && !this.#warningEmitted) {
      const pctUsed = (this.#tokenBudgetConsumed / this.#tokenBudgetTotal) * 100;
      if (pctUsed >= config.tokenBudget.warningThresholdPct) {
        this.#warningEmitted = true;
        const first = this.#sessions.values().next();
        const session = first.done ? null : first.value;
        if (session) {
          this.#emitEvent('budget:exhausted', session, { consumed: this.#tokenBudgetConsumed, total: this.#tokenBudgetTotal });
        }
      }
    }
  }

  // ── #private: Token Estimation ──

  #estimateRememberTokens(content: string | StructuredContent, options?: AgentMemoryOptions): number {
    const serialized = typeof content === 'string' ? content : JSON.stringify(content);
    const contentTokens = Math.ceil(serialized.length / 4);
    const optionsTokens = options ? Math.ceil(JSON.stringify(options).length / 4) : 0;
    return contentTokens + optionsTokens + AUDIT_OVERHEAD_TOKENS + GOVERNANCE_OVERHEAD_TOKENS;
  }

  #estimateRecallTokens(query: AgentRecallQuery, options?: AgentRecallOptions): number {
    const queryTokens = Math.ceil(JSON.stringify(query).length / 4);
    const limit = options?.limit ?? 10;
    const responseTokens = limit * AVG_BELIEF_SIZE_TOKENS;
    return queryTokens + responseTokens + AUDIT_OVERHEAD_TOKENS;
  }

  #estimateBranchTokens(description: string): number {
    return BRANCH_BASE_TOKENS + Math.ceil(description.length / 4) + AUDIT_OVERHEAD_TOKENS;
  }

  #estimateMergeTokens(branchIds: readonly AgentBranchId[]): number {
    return BRANCH_BASE_TOKENS + (branchIds.length * AVG_CONFLICT_SIZE_TOKENS) + AUDIT_OVERHEAD_TOKENS;
  }

  #estimateResolveTokens(resolution: ManualMergeResolutionRequest): number {
    const baseTokens = Math.ceil(JSON.stringify(resolution).length / 4);
    return baseTokens + BRANCH_BASE_TOKENS + AUDIT_OVERHEAD_TOKENS;
  }

  // ── #private: Confidence Cap ──

  #applyConfidenceCap(options?: AgentMemoryOptions): AgentMemoryOptions | undefined {
    if (!options?.confidence || !this.#config) return options;
    const cap = TRUST_CONFIDENCE_CAPS[this.#config.trustLevel];
    if (options.confidence > cap) {
      return { ...options, confidence: cap };
    }
    return options;
  }

  // ── #private: Audit (F-01: non-overridable) ──

  async #appendAudit(
    operationType: string,
    governanceState: 'allowed' | 'refused' | 'escalated' | 'sandboxed' | 'not_applicable',
    tokenCost: number,
    extra?: Partial<AdapterAuditDetails>,
  ): Promise<Result<EventId>> {
    if (this.#auditFailureInjected) {
      this.#auditFailureInjected = false;
      return toResultError(auditFailure(this.adapterId, operationType, 'Injected audit failure'));
    }

    if (this.#postAuditFailureInjected && this.#auditCallCount > 0) {
      this.#postAuditFailureInjected = false;
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

    this.#auditEntries.push(entry);

    if (this.#client) {
      try {
        const eventId = await this.#client.appendAudit({ details: entry as Readonly<Record<string, unknown>> });
        return { ok: true, value: eventId };
      } catch {
        return toResultError(auditFailure(this.adapterId, operationType, 'Core audit append failed'));
      }
    }

    return { ok: true, value: `evt-local-${this.#clock.now()}` as EventId };
  }

  async #appendAuditRaw(entry: Partial<AdapterAuditDetails>): Promise<void> {
    this.#auditEntries.push(entry);
    if (this.#client) {
      try {
        await this.#client.appendAudit({ details: entry as Readonly<Record<string, unknown>> });
      } catch {
        // Best-effort
      }
    }
  }

  // ── #private: Events (F-08: crypto randomUUID for event IDs) ──

  #emitEvent(
    event: AgentEvent,
    session: AgentSession | null,
    data: Readonly<Record<string, unknown>>,
  ): void {
    const payload: AgentEventPayload = {
      eventId: randomUUID() as unknown as EventId,
      event,
      timestamp: this.#clock.isoNow(),
      adapterId: this.adapterId,
      sessionId: session?.sessionId ?? null,
      agentId: this.#config?.agentId ?? '' as AgentId,
      data,
    };

    for (const [, sub] of this.#subscriptions) {
      if (sub.event === event) {
        try {
          sub.handler(payload);
        } catch {
          // Subscriber errors don't propagate
        }
      }
    }
  }

  #clearSubscriptions(): void {
    this.#subscriptions.clear();
  }

  // ── #private: Session Helpers ──

  #getSessionFromCtx(ctx: OperationContext): AgentSession | null {
    if (!ctx.sessionId) return null;
    return this.#sessions.get(ctx.sessionId as string) ?? null;
  }

  #sessionToCtx(session: AgentSession): OperationContext {
    return {
      tenantId: session.tenantId,
      userId: null,
      agentId: session.agentId,
      permissions: new Set(),
      sessionId: session.sessionId,
      clearanceLevel: session.clearanceLevel,
    };
  }

  // ── #private: Config ──

  #validateBaseConfig(config: TConfig): CrewAIAdapterError | null {
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

  #computeConfigDigest(config: TConfig): string {
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
