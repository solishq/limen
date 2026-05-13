/*
 * Canonical TypeScript adapter surface.
 * Contract refs: AGENT_ADAPTER_ARCHITECTURE.md §§3-6, §§8-12; CREWAI_ADAPTER_CONTRACT.md §3.1; SHARED_TYPES.md §27.
 */

import type {
  AdapterId,
  AdapterKernelError,
  AdapterRefusalHint,
  AdapterSandboxDefaults,
  AgentCapability,
  AgentEvent,
  AgentEventHandler,
  AgentEventPayload,
  AgentFramework,
  AgentId,
  AgentMemoryOptions,
  AgentRecallOptions,
  AgentRecallQuery,
  AgentSession,
  AgentTrustLevel,
  BeliefState,
  ClassificationLevel,
  ClaimId,
  ComputerAction,
  GovernanceContext,
  GovernanceVerdict,
  MergeResult,
  MergeStrategy,
  NativeAgentAction,
  OperationContext,
  RateLimitPolicy,
  RelationshipType,
  Result,
  SessionSummary,
  StructuredContent,
  TenantId,
} from '../types/index.js';

// AGENT_ADAPTER_ARCHITECTURE.md §4.1: AdapterConfig uses canonical shared types and additive rate limits.
export interface AdapterConfig {
  readonly agentId: AgentId;
  readonly tenantId: TenantId | null;
  readonly trustLevel: AgentTrustLevel;
  readonly defaultClassification: ClassificationLevel;
  readonly capabilities: ReadonlySet<AgentCapability>;
  readonly rateLimits: readonly RateLimitPolicy[];
  readonly sandboxDefaults: AdapterSandboxDefaults;
  readonly refusalHints: readonly AdapterRefusalHint[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

// CREWAI_ADAPTER_CONTRACT.md §3.8 extends AGENT_ADAPTER_ARCHITECTURE.md §4.2 with lifecycle and core connectivity diagnostics.
export interface AdapterHealth {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly lifecycleState: AdapterLifecycleState;
  readonly lastActivity: string | null;
  readonly activeSessions: number;
  readonly errorCount: number;
  readonly uptimeMs: number;
  readonly corePortConnected: boolean;
  readonly tokenBudgetRemaining: number;
  readonly tokenBudgetTotal: number;
  readonly lastError?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

// Phase 1 prompt action 5: lifecycle state machine is exactly five states.
export type AdapterLifecycleState = 'UNINITIALIZED' | 'INITIALIZING' | 'READY' | 'DEGRADED' | 'SHUTDOWN';

// AGENT_ADAPTER_ARCHITECTURE.md §5.1: AgentToolCall is contract-local and adapter-facing.
export interface AgentToolCall {
  readonly toolName: string;
  readonly toolArgs: Readonly<Record<string, unknown>>;
  readonly callId: string;
  readonly agentFramework: AgentFramework;
  readonly rawPayload: unknown;
}

// AGENT_ADAPTER_ARCHITECTURE.md §5.2: LimenOperation is the canonical adapter-produced operation union.
export type LimenOperation =
  | { readonly type: 'remember'; readonly content: string | StructuredContent; readonly options?: AgentMemoryOptions }
  | { readonly type: 'recall'; readonly query: AgentRecallQuery; readonly options?: AgentRecallOptions }
  | { readonly type: 'forget'; readonly entryId: ClaimId; readonly reason: string }
  | { readonly type: 'get_belief'; readonly beliefId: ClaimId }
  | { readonly type: 'create_branch'; readonly baseBeliefId: ClaimId; readonly description: string }
  | { readonly type: 'merge_branches'; readonly branchIds: readonly string[]; readonly strategy: MergeStrategy }
  | { readonly type: 'discard_branch'; readonly branchId: string }
  | { readonly type: 'relate'; readonly fromId: ClaimId; readonly toId: ClaimId; readonly relationType: RelationshipType }
  | { readonly type: 'check_permission'; readonly action: ComputerAction; readonly context: GovernanceContext };

// Phase 1 prompt action 4: execute returns OperationResult or AdapterKernelError.
export interface OperationResult {
  readonly operationType: LimenOperation['type'] | 'core_execute';
  readonly auditId: string;
  readonly value: unknown;
}

// AGENT_ADAPTER_ARCHITECTURE.md §12.1 and §12.2: computer actions must be governed before/after execution.
export interface ComputerActionGovernor {
  beforeAction(action: ComputerAction, context: GovernanceContext): Promise<Result<GovernanceVerdict, AdapterKernelError>>;
  afterAction(action: ComputerAction, result: Result<unknown, AdapterKernelError>): Promise<Result<void, AdapterKernelError>>;
}

// AGENT_ADAPTER_ARCHITECTURE.md §3: AgentAdapter is pure translation plus lifecycle, session, event, and health bridge.
export interface AgentAdapter {
  readonly adapterId: AdapterId;
  readonly agentFramework: AgentFramework;
  readonly version: string;
  readonly capabilities: ReadonlySet<AgentCapability>;

  // AGENT_ADAPTER_ARCHITECTURE.md §8.1: initialize connects client, validates config, and registers governor.
  initialize(client: LimenAgentClientSurface, governor: ComputerActionGovernor, config: AdapterConfig): Promise<Result<void, AdapterKernelError>>;

  // AGENT_ADAPTER_ARCHITECTURE.md §8.1 and CREWAI_ADAPTER_CONTRACT.md Claim 1.2: shutdown is clean and idempotent.
  shutdown(): Promise<Result<void, AdapterKernelError>>;

  // AGENT_ADAPTER_ARCHITECTURE.md §3.1: translate native tool calls into canonical Limen operations.
  translateToolCall(toolCall: AgentToolCall): Promise<Result<readonly LimenOperation[], AdapterKernelError>>;

  // AGENT_ADAPTER_ARCHITECTURE.md §3.1 and §12.2: translate native action into complete ComputerAction.
  translateActionToGovernance(action: NativeAgentAction): Promise<Result<ComputerAction, AdapterKernelError>>;

  // AGENT_ADAPTER_ARCHITECTURE.md §12.3: session start produces canonical AgentSession.
  onAgentSessionStart(nativeSession: unknown): Promise<Result<AgentSession, AdapterKernelError>>;

  // AGENT_ADAPTER_ARCHITECTURE.md §12.3: session end returns canonical SessionSummary.
  onAgentSessionEnd(nativeSession: unknown): Promise<Result<SessionSummary, AdapterKernelError>>;

  // AGENT_ADAPTER_ARCHITECTURE.md §8.2: event bridge maps native events into canonical AgentEventPayload.
  mapNativeEvent(nativeEvent: unknown): AgentEventPayload | null;

  // AGENT_ADAPTER_ARCHITECTURE.md §8.2: event bridge maps canonical AgentEventPayload back to framework-native shape.
  mapLimenEvent(limenEvent: AgentEventPayload): unknown | null;

  // AGENT_ADAPTER_ARCHITECTURE.md §8.1 and CREWAI_ADAPTER_CONTRACT.md Claim 1.12: healthCheck is live and available outside core operations.
  healthCheck(): Promise<Result<AdapterHealth, AdapterKernelError>>;

  // Phase 1 prompt action 4: Rust trait parity exposes execute(OperationContext) as a governed adapter operation.
  execute(operation: OperationContext): Promise<Result<OperationResult, AdapterKernelError>>;
}

// CREWAI_ADAPTER_CONTRACT.md §3.1: client surface consumed by adapters for mediated memory and branch operations.
export interface LimenAgentClientSurface {
  createSession(metadata?: Readonly<Record<string, unknown>>): Promise<Result<AgentSession, AdapterKernelError>>;
  execute(operation: LimenOperation): Promise<Result<OperationResult, AdapterKernelError>>;
  remember(content: string | StructuredContent, options?: AgentMemoryOptions): Promise<Result<ClaimId, AdapterKernelError>>;
  recall(query: AgentRecallQuery, options?: AgentRecallOptions): Promise<Result<readonly BeliefState[], AdapterKernelError>>;
  createBranch(baseBeliefId: ClaimId, description: string): Promise<Result<string, AdapterKernelError>>;
  mergeBranches(branchIds: readonly string[], strategy: MergeStrategy): Promise<Result<MergeResult, AdapterKernelError>>;
  healthCheck(): Promise<Result<AdapterHealth, AdapterKernelError>>;
  getHealth(): AdapterHealth;
  shutdown(): Promise<Result<void, AdapterKernelError>>;
  on(event: AgentEvent, handler: AgentEventHandler): string;
  off(subscriptionId: string): void;
}
