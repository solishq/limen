# CrewAI Adapter Contract v1.0.0

**Status:** RATIFIED (Final Breaker: CLEAN, 25/25 findings resolved)
**Governing:** CDM v2.1 + Contract Compliance v2.1
**Scope:** CrewAI framework adapter for Limen governance substrate integration
**Classification:** internal
**Phase:** Phase 3 (Enterprise Readiness) / Phase X (Agent Integration Layer)

> **Shared Types:** All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`. This contract does NOT redefine any shared type. Local types are contract-specific and not used by other contracts.

---

## 1. Overview & Scope

### 1.1 Purpose

This contract defines the `LimenCrewAIAdapter` -- a specialized adapter that bridges the CrewAI multi-agent orchestration framework to Limen's governance substrate. CrewAI organizes AI agents into crews with roles, tasks, and delegation hierarchies. This adapter translates CrewAI's native tool invocations, delegation events, and session boundaries into canonical Limen types, ensuring every CrewAI agent operation flows through Limen's governance, audit, and memory infrastructure.

### 1.2 Relationship to Phase 3 Design Source and Phase X

This contract is a Phase 3 deliverable that implements the CrewAI adapter specification outlined in `AGENT_ADAPTER_ARCHITECTURE.md` v2.3.0 Section 7.6. It conforms to the canonical `AgentAdapter` interface and does not define an alternate adapter surface. It conforms to:

- **SHARED_TYPES.md v1.4.0** -- All cross-contract types, including `AgentFramework.crew_ai`
- **AGENT_ADAPTER_ARCHITECTURE.md v2.3.0** -- Adapter interface, registry, translation semantics, testing contract
- **AGENT_LIFECYCLE_MANAGEMENT.md v1.3.0** -- Agent identity, trust promotion, consent governance, knowledge exchange

The adapter does NOT modify Limen Core. It is a pure translation layer that maps CrewAI-native concepts to canonical Phase X types. Limen Core MUST reject CrewAI-originated memory, execution, and delegation operations that do not carry a registered adapter identity, session identity, governance decision, and audit-chain linkage.

### 1.3 CrewAI-Specific Concerns

CrewAI introduces concepts absent from single-agent adapters:

| CrewAI Concept | Limen Mapping |
|---|---|
| Crew (group of agents) | Adapter metadata; crew ID carried in `AgentSession.metadata` |
| Agent Role (researcher, writer, etc.) | Adapter metadata; role name carried in `AgentSession.metadata` |
| Task (unit of work) | Maps to Limen mission/task via `MissionId`/`TaskId` in `OperationContext` |
| Delegation (agent delegates to another) | `NativeAgentAction` with `nativeType: 'crew_delegation'`; governance-gated |
| Tool invocation | Translated to `LimenOperation[]` via `translateToolCall` |
| Kickoff (crew execution start) | `onAgentSessionStart` with crew metadata |
| Sequential/hierarchical process | Preserved in metadata for audit; does not affect governance model |

### 1.4 Version

| Field | Value |
|---|---|
| Contract Version | 1.0.0 |
| SHARED_TYPES dependency | v1.4.0 |
| AGENT_ADAPTER_ARCHITECTURE dependency | v2.3.0 |
| AGENT_LIFECYCLE_MANAGEMENT dependency | v1.3.0 |
| CrewAI SDK target | v1.14.x |
| CrewAI docs binding | Official CrewAI docs, Tools v1.14.0 and Tool Call Hooks v1.12.2+, accessed 2026-05-06 |

### 1.5 CrewAI Hook/Event Payload Contract

This contract binds to CrewAI's tool-call hook model, not an inferred `{ tool, args }` convention. The adapter receives CrewAI hook context with the following minimum shape:

```typescript
interface CrewAIToolCallHookContext {
  readonly tool_name: string;
  readonly tool_input: Readonly<Record<string, unknown>>;
  readonly tool?: unknown;
  readonly agent?: unknown;
  readonly task?: unknown;
  readonly crew?: unknown;
  readonly tool_result?: string | null;
}
```

Decorated tools and `BaseTool` subclasses are normalized into `CrewAIToolCall` before translation. `tool_name` is the only authoritative tool identifier; role names, task descriptions, and backstories never imply capabilities.

---

## 2. Shared Type References

The following types are used by this contract and defined canonically in `SHARED_TYPES.md`:

| Type | Section |
|---|---|
| `AgentFramework` (`'crew_ai'`) | §21 |
| `AgentCapability` (20-value enum) | §6 |
| `AgentTrustLevel` (5-level) | §5 |
| `TRUST_TO_CLEARANCE` | §5 |
| `AgentSession` | §7 |
| `SessionSummary` | §15 |
| `OperationContext` | §1.3 |
| `Result<T>` | §1.5 |
| `KernelError` | §1.4 |
| `GovernanceContext` | §9 |
| `GovernanceVerdict` | §10 |
| `GovernanceDecision` | §10.1 |
| `MergeStrategy` (4-value enum) | §14 |
| `MergeConflict`, `ManualMergeState` | §14.2 |
| `StructuredContent`, `AgentMemoryOptions` | §10.2.1 |
| `AgentRecallQuery`, `AgentRecallOptions` | §10.2.1 |
| `AgentMemoryEntry`, `BeliefState` | §10.2 |
| `ClassificationLevel` | §3 |
| `AgentEvent`, `AgentEventPayload`, `AgentEventBus` | §16 |
| `RetentionPolicy` | §17 |
| `RateLimitPolicy` | §18 |
| `TokenEstimator`, `TokenEstimate` | §20.1 |
| `PerformanceBudget` | §20 |
| `ComputerAction`, `NativeAgentAction` | §11 |
| `AdapterSandboxDefaults` | §12.1 |
| `AdapterRefusalHint` | §13.1 |
| `ActionDigest` | §24 |
| Branded IDs (`AdapterId`, `AgentId`, `SessionId`, `ClaimId`, `AgentBranchId`, `MissionId`, `TaskId`, `EventId`) | §1.1, §4 |

The canonical `AgentAdapter`, `AdapterConfig`, `AgentToolCall`, `LimenOperation`, `LimenAgentClient`, `ComputerActionGovernor`, and `AdapterErrorCode` interfaces are owned by `AGENT_ADAPTER_ARCHITECTURE.md` §3-§6 and §11. This contract specializes those interfaces for CrewAI; it MUST NOT narrow, replace, or omit any canonical adapter method.

---

## 3. Core Interfaces

### 3.1 CrewAIAdapter (TypeScript)

```typescript
interface CrewAIAdapter extends AgentAdapter {
  // --- Canonical AgentAdapter identity ---
  readonly adapterId: AdapterId;
  readonly agentFramework: 'crew_ai'; // literal specialization of AgentFramework
  readonly version: string;
  readonly capabilities: ReadonlySet<AgentCapability>;

  // --- Canonical AgentAdapter lifecycle ---
  initialize(
    client: LimenAgentClient,
    governor: ComputerActionGovernor,
    config: CrewAIAdapterConfig
  ): Promise<Result<void>>;
  shutdown(): Promise<Result<void>>;

  // --- Canonical AgentAdapter translation layer ---
  translateToolCall(toolCall: AgentToolCall): Promise<Result<LimenOperation[]>>;
  translateToolCall(toolCall: CrewAIToolCall): Promise<Result<LimenOperation[]>>;
  translateToolCall(
    tool: string,
    args: Readonly<Record<string, unknown>>,
    context?: CrewAIToolContext
  ): Promise<Result<LimenOperation[]>>;
  translateActionToGovernance(action: NativeAgentAction): Promise<Result<ComputerAction>>;

  // --- Canonical AgentAdapter session bridge ---
  onAgentSessionStart(nativeSession: CrewAISessionStart): Promise<Result<AgentSession>>;
  onAgentSessionEnd(nativeSession: CrewAISessionEnd): Promise<Result<SessionSummary>>;

  // --- Canonical AgentAdapter event bridge ---
  mapNativeEvent(nativeEvent: CrewAIHookEvent): AgentEventPayload | null;
  mapLimenEvent(limenEvent: AgentEventPayload): CrewAIHookEvent | null;

  // --- Canonical AgentAdapter health ---
  healthCheck(): Promise<Result<AdapterHealth>>;

  // --- CrewAI high-level convenience operations ---
  remember(
    ctx: OperationContext,
    content: string | StructuredContent,
    options?: RememberOptions
  ): Promise<Result<ClaimId>>;

  recall(
    ctx: OperationContext,
    query: AgentRecallQuery,
    options?: AgentRecallOptions
  ): Promise<Result<RecallResult>>;

  createBranch(
    ctx: OperationContext,
    baseBeliefId: ClaimId,
    description: string
  ): Promise<Result<AgentBranchId>>;

  mergeBranches(
    ctx: OperationContext,
    branchIds: readonly AgentBranchId[],
    strategy: MergeStrategy
  ): Promise<Result<MergeResult>>;

  resolveConflict(
    ctx: OperationContext,
    resolution: ManualMergeResolutionRequest
  ): Promise<Result<MergeResult>>;

  // --- Synchronous diagnostics and subscriptions ---
  getHealth(): AdapterHealth;
  on(event: AgentEvent, handler: AgentEventHandler): string;
  off(subscriptionId: string): void;
}
```

**Claim 1.1:** `initialize` MUST complete successfully before any other operation except `getHealth`, `on`, `off`, and no-op `shutdown`. Calling `initialize` again after READY with the same config returns `Result.ok(void)` with no side effects. Calling `initialize` after `SHUTDOWN` returns `NOT_INITIALIZED`.

**Claim 1.2:** `shutdown` MUST be idempotent. Calling `shutdown` on an already-shut-down adapter returns `Result.ok(void)`.

**Claim 1.3:** `shutdown` MUST close all active sessions, flush pending audit entries, and deregister from the adapter registry before returning success.

**Claim 1.4:** `remember` MUST enforce governance before token-budget admission and before persistence. If governance returns `refuse` or `escalate`, the operation MUST fail with `GOVERNANCE_REFUSAL`, produce the required terminal audit entry, and create no claim.

**Claim 1.5:** `recall` MUST filter results by the explicit `OperationContext.clearanceLevel`. No claim above the agent's clearance is ever returned, and clearance is never derived from ambient adapter state.

**Claim 1.6:** `createBranch` MUST require `branching` capability (minimum trust: `medium`). Calls from agents below `medium` trust MUST fail with `GOVERNANCE_REFUSAL`.

**Claim 1.7:** `mergeBranches` follows the deterministic multi-branch merge ordering defined in `SHARED_TYPES.md` §23. Same inputs always produce same outputs.

**Claim 1.8:** `getHealth` is synchronous. It MUST NOT block on I/O. It reports the last-known health state.

**Claim 1.9:** `translateToolCall` MUST accept CrewAI `tool_name` + `tool_input` hook payloads, translate known tools into canonical `LimenOperation[]`, and return `UNKNOWN_TOOL` with available operation names for undeclared or unregistered CrewAI tools.

**Claim 1.10:** `translateActionToGovernance` MUST populate every canonical `ComputerAction.ActionBase` field from `AgentSession`, `OperationContext`, and injected `TimeProvider`. Missing action-base data returns `SERDE_ERROR`; undeclared capabilities return `CAPABILITY_NOT_DECLARED`.

**Claim 1.11:** Manual merge conflicts MUST be resolvable only through `resolveConflict`. A pending manual merge cannot complete through `mergeBranches` alone and cannot be silently auto-accepted.

**Claim 1.12:** `healthCheck()` MUST return current adapter health including connectivity to Limen Core, active session count, and governance state. It is available in all lifecycle states except SHUTDOWN, where it returns `NOT_INITIALIZED`. Unlike `getHealth()` (which is synchronous and returns cached state), `healthCheck()` performs a live connectivity probe to Limen Core.

**Claim 1.13:** `on()` and `off()` are permitted in all lifecycle states except SHUTDOWN, where they throw `NOT_INITIALIZED`. This eliminates the dead-subscription problem: callers who attempt to register subscriptions on a shut-down adapter receive an explicit error rather than a silent no-op that creates the false impression of an active subscription. Subscriptions registered via `on()` survive state transitions (UNINITIALIZED -> READY -> DEGRADED -> READY) but are cleared when `shutdown()` completes. `on()` returns a unique subscription ID; `off()` with an unknown or already-removed subscription ID is a no-op. No governance evaluation is required for subscription management -- these are local observer registrations with no Limen Core side effects.

### 3.2 CrewAIAdapterConfig (Local Type)

```typescript
interface CrewAIAdapterConfig {
  // --- Required ---
  readonly agentId: AgentId;
  readonly tenantId: TenantId | null;
  readonly trustLevel: AgentTrustLevel;
  readonly capabilities: ReadonlySet<AgentCapability>;

  // --- CrewAI-Specific ---
  readonly crewId: string;
  readonly agentRole: string;
  readonly processType: 'sequential' | 'hierarchical';
  readonly delegationDepthMax: number; // max delegation chain depth; 0 = no delegation

  // --- Governance ---
  readonly defaultClassification: ClassificationLevel;
  readonly governed?: true; // omitted or true only; false is rejected
  readonly rateLimits: readonly RateLimitPolicy[];
  readonly sandboxDefaults: AdapterSandboxDefaults;
  readonly refusalHints: readonly AdapterRefusalHint[];

  // --- Budget ---
  readonly tokenBudget: TokenBudgetConfig;

  // --- Connection ---
  readonly coreEndpoint: string; // Limen core connection target
  readonly connectionTimeoutMs: number; // Claim 2.2: default 5000, max 30000
  readonly retryPolicy: RetryPolicy;

  // --- Metadata ---
  readonly metadata: Readonly<Record<string, unknown>>;
}
```

**Claim 2.1:** `governed` defaults to `true` and is non-optional in effect. Setting `governed: false` is invalid for every caller, including `verified` agents and agents with `governance_admin`; `initialize` MUST reject it with `GOVERNANCE_REFUSAL` and `rule: "governance_non_optional"`.

**Claim 2.2:** `connectionTimeoutMs` MUST be within `[1000, 30000]`. Values outside this range are rejected at initialization with `SERDE_ERROR`; the adapter MUST NOT clamp silently.

**Claim 2.10:** Config identity is determined by the SHA-256 hash of the canonical JSON serialization of `CrewAIAdapterConfig` (keys sorted recursively, no whitespace, `Set` values sorted lexicographically, `null` preserved). This digest is used by the idempotent `initialize()` check (§9.3 READY -> READY transition) and recorded in initialization audit entries. Two configs with identical digests are considered identical; differing digests trigger `ALREADY_INITIALIZED`.

**Claim 2.7:** `rateLimits` are additive to `DEFAULT_RATE_LIMITS`. Empty adapter-specific limits still inherit defaults. Any configuration that weakens, disables, replaces, or locally resets default rate counters is rejected at initialization with `GOVERNANCE_REFUSAL`.

**Claim 2.13:** `delegationDepthMax` must be in range [0, 10]. `0` disables delegation entirely. Values above 10 are rejected at initialization with `INVALID_CONFIG` (mapped to `SERDE_ERROR`). The adapter MUST NOT silently clamp values outside this range.

### 3.2.1 CrewAI Hook and Tool Types (Local Types)

```typescript
interface CrewAIToolCall extends AgentToolCall {
  readonly agentFramework: 'crew_ai';
  readonly tool: string; // normalized from CrewAI hook context tool_name
  readonly args: Readonly<Record<string, unknown>>; // normalized from tool_input
  readonly context: CrewAIToolContext;
}

interface CrewAIToolContext {
  readonly crewId: string;
  readonly agentRole: string;
  readonly taskId: TaskId | null;
  readonly delegationDepth: number;
  readonly processType: 'sequential' | 'hierarchical';
  readonly hookPhase: 'before_tool_call' | 'after_tool_call';
  readonly rawHookContextDigest: ActionDigest;
}

type CrewAIHookEvent =
  | { readonly type: 'before_tool_call'; readonly context: CrewAIToolCallHookContext }
  | { readonly type: 'after_tool_call'; readonly context: CrewAIToolCallHookContext };

interface CrewAISessionStart {
  readonly crewId: string;
  readonly agentRole: string;
  readonly processType: 'sequential' | 'hierarchical';
  readonly taskId?: TaskId;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface CrewAISessionEnd {
  readonly sessionId: SessionId;
  readonly crewId: string;
  readonly outcome: 'completed' | 'failed' | 'cancelled' | 'timeout';
  readonly metadata: Readonly<Record<string, unknown>>;
}
```

**Claim 2.11:** Sessions that exceed `maxDurationMs` (if configured in session metadata) end with outcome `'timeout'`. The adapter produces a `SessionSummary` with the timeout outcome and an audit entry recording the timeout trigger. Timeout-ended sessions follow the same cleanup path as `'cancelled'` sessions.

**Claim 2.8:** CrewAI native hook payloads MUST be normalized from `tool_name` and `tool_input`. The adapter MUST NOT infer a tool from `agent.role`, `task.description`, or arbitrary `{ tool, args }` fields unless those fields are produced by the normalization layer.

### 3.3 RememberOptions (Local Type)

```typescript
interface RememberOptions extends AgentMemoryOptions {
  readonly crewContext?: CrewContext; // auto-populated if omitted
}

interface CrewContext {
  readonly crewId: string;
  readonly agentRole: string;
  readonly taskId: TaskId | null;
  readonly delegationDepth: number;
}
```

**Claim 2.3:** When `crewContext` is omitted from `RememberOptions`, the adapter MUST populate it from the active session's metadata. The crew context is always present in the persisted claim's metadata for audit traceability.

### 3.4 RecallResult (Local Type)

```typescript
interface RecallResult {
  readonly beliefs: readonly BeliefState[];
  readonly totalCount: number;
  readonly truncated: boolean;
  readonly tokenEstimate: TokenEstimate;
}
```

**Claim 2.4:** `truncated` MUST be `true` when `totalCount` exceeds the returned `beliefs.length`. The adapter MUST NOT silently drop results without signaling truncation.

### 3.5 MergeResult (Local Type)

```typescript
interface MergeResult {
  readonly status: 'completed' | 'pending_resolution' | 'failed';
  readonly mergedClaimIds: readonly ClaimId[];
  readonly conflictsResolved: readonly MergeConflictRecord[];
  readonly unresolvedConflicts: readonly MergeConflict[];
  readonly manualMergeState: ManualMergeState | null; // non-null when strategy is 'manual'
  readonly auditId: EventId;
}

interface MergeConflictRecord {
  readonly conflictId: string;
  readonly resolution: ManualMergeResolution;
  readonly winningClaimId: ClaimId;
}

interface ManualMergeResolutionRequest {
  readonly mergeId: string;
  readonly conflictId: string;
  readonly resolution: ManualMergeResolution;
  readonly newValue?: string; // required when resolution is 'merge_new_value'
  readonly newConfidence?: number; // required when resolution is 'merge_new_value'
}
```

**Claim 2.5:** When `strategy` is `manual` and conflicts exist, `status` MUST be `'pending_resolution'` and `manualMergeState` MUST be non-null. The merge does NOT complete until all conflicts are resolved.

**Claim 2.9:** `resolveConflict` MUST reject resolutions for unknown `mergeId`, expired manual merge state, already-resolved conflict IDs, and `merge_new_value` requests missing `newValue` or `newConfidence`.

### 3.6 TokenBudgetConfig (Local Type)

```typescript
interface TokenBudgetConfig {
  readonly maxTokensPerOperation: number;
  readonly maxTokensPerSession: number;
  readonly encoding: TokenEncoding;
  readonly warningThresholdPct: number; // 0-100; emit warning event at this threshold
  readonly replenishmentWindowSeconds?: number | null; // null/omitted = not retryable within session
}
```

**Claim 2.12:** `warningThresholdPct` must be in range [0, 100]. Values outside this range are rejected at initialization with `INVALID_CONFIG` (mapped to `SERDE_ERROR`). The adapter MUST NOT silently clamp values outside this range.

### 3.7 RetryPolicy (Local Type)

```typescript
interface RetryPolicy {
  readonly maxRetries: number; // 0 = no retries
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  readonly retryableErrors: readonly CrewAIAdapterErrorCode[];
}
```

**Claim 2.6:** Only errors listed in `retryableErrors` are retried. `GOVERNANCE_REFUSAL` and `NOT_INITIALIZED` are NEVER retryable regardless of configuration.

### 3.8 AdapterHealth (Local Type)

```typescript
interface AdapterHealth {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly lifecycleState: AdapterLifecycleState;
  readonly lastActivity: string | null; // ISO-8601
  readonly activeSessions: number;
  readonly errorCount: number;
  readonly uptimeMs: number;
  readonly corePortConnected: boolean;
  readonly tokenBudgetRemaining: number;
  readonly tokenBudgetTotal: number;
  readonly lastError?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}
```

---

## 4. Rust Trait Equivalent

```rust
use std::future::Future;
use std::collections::HashSet;
use serde::{Serialize, Deserialize};

// All shared types imported from SHARED_TYPES.md §25 Rust Equivalents

/// CrewAI-specific adapter trait for Limen v5.
/// This trait is a specialization of the canonical AgentAdapter contract.
pub trait CrewAIAdapter: AgentAdapter + Send + Sync + 'static {
    fn adapter_id(&self) -> &AdapterId;
    fn agent_framework(&self) -> AgentFramework {
        AgentFramework::CrewAI
    }
    fn version(&self) -> &str;
    fn capabilities(&self) -> &HashSet<AgentCapability>;

    fn initialize(
        &mut self,
        client: LimenAgentClient,
        governor: ComputerActionGovernor,
        config: CrewAIAdapterConfig,
    ) -> impl Future<Output = Result<(), CrewAIAdapterError>> + Send;

    fn shutdown(
        &mut self,
    ) -> impl Future<Output = Result<(), CrewAIAdapterError>> + Send;

    fn remember(
        &self,
        ctx: OperationContext,
        content: MemoryContent,
        options: Option<RememberOptions>,
    ) -> impl Future<Output = Result<ClaimId, CrewAIAdapterError>> + Send;

    fn recall(
        &self,
        ctx: OperationContext,
        query: &AgentRecallQuery,
        options: Option<&AgentRecallOptions>,
    ) -> impl Future<Output = Result<RecallResult, CrewAIAdapterError>> + Send;

    fn create_branch(
        &self,
        ctx: OperationContext,
        base_belief_id: ClaimId,
        description: &str,
    ) -> impl Future<Output = Result<AgentBranchId, CrewAIAdapterError>> + Send;

    fn merge_branches(
        &self,
        ctx: OperationContext,
        branch_ids: &[AgentBranchId],
        strategy: MergeStrategy,
    ) -> impl Future<Output = Result<MergeResult, CrewAIAdapterError>> + Send;

    fn resolve_conflict(
        &self,
        ctx: OperationContext,
        resolution: ManualMergeResolutionRequest,
    ) -> impl Future<Output = Result<MergeResult, CrewAIAdapterError>> + Send;

    fn translate_tool_call(
        &self,
        tool_call: CrewAIToolCall,
    ) -> impl Future<Output = Result<Vec<LimenOperation>, CrewAIAdapterError>> + Send;

    fn translate_action_to_governance(
        &self,
        action: NativeAgentAction,
    ) -> impl Future<Output = Result<ComputerAction, CrewAIAdapterError>> + Send;

    fn on_agent_session_start(
        &self,
        native_session: CrewAISessionStart,
    ) -> impl Future<Output = Result<AgentSession, CrewAIAdapterError>> + Send;

    fn on_agent_session_end(
        &self,
        native_session: CrewAISessionEnd,
    ) -> impl Future<Output = Result<SessionSummary, CrewAIAdapterError>> + Send;

    fn map_native_event(&self, native_event: CrewAIHookEvent) -> Option<AgentEventPayload>;
    fn map_limen_event(&self, limen_event: AgentEventPayload) -> Option<CrewAIHookEvent>;

    fn health_check(
        &self,
    ) -> impl Future<Output = Result<AdapterHealth, CrewAIAdapterError>> + Send;

    fn get_health(&self) -> AdapterHealth;

    fn on(&mut self, event: &str, callback: Box<dyn Fn(&AgentEventPayload) + Send + Sync>) -> Result<String, CrewAIAdapterError>;
    fn off(&mut self, subscription_id: &str) -> Result<(), CrewAIAdapterError>;
}

/// CrewAI adapter config (contract-local)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrewAIAdapterConfig {
    pub agent_id: AgentId,
    pub tenant_id: Option<TenantId>,
    pub trust_level: AgentTrustLevel,
    pub capabilities: HashSet<AgentCapability>,
    pub crew_id: String,
    pub agent_role: String,
    pub process_type: CrewProcessType,
    pub delegation_depth_max: u32,
    pub default_classification: ClassificationLevel,
    pub governed: Option<bool>, // None or Some(true) only; Some(false) is rejected
    pub rate_limits: Vec<RateLimitPolicy>,
    pub sandbox_defaults: AdapterSandboxDefaults,
    pub refusal_hints: Vec<AdapterRefusalHint>,
    pub token_budget: TokenBudgetConfig,
    pub core_endpoint: String,
    pub connection_timeout_ms: u64,
    pub retry_policy: RetryPolicy,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrewProcessType {
    Sequential,
    Hierarchical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenBudgetConfig {
    pub max_tokens_per_operation: u64,
    pub max_tokens_per_session: u64,
    pub encoding: String, // "cl100k_base" | "o200k_base" | "provider_native"
    pub warning_threshold_pct: u8, // Validated: must be in [0, 100]; values > 100 rejected at initialization
    pub replenishment_window_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
    pub backoff_multiplier: f64,
    pub retryable_errors: Vec<CrewAIAdapterErrorCode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrewAIToolCall {
    pub agent_framework: AgentFramework,
    pub tool: String,
    pub args: serde_json::Value,
    pub context: CrewAIToolContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrewAIToolContext {
    pub crew_id: String,
    pub agent_role: String,
    pub task_id: Option<TaskId>,
    pub delegation_depth: u32,
    pub process_type: CrewProcessType,
    pub hook_phase: CrewAIHookPhase,
    pub raw_hook_context_digest: ActionDigest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrewAIHookPhase {
    BeforeToolCall,
    AfterToolCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CrewAIHookEvent {
    BeforeToolCall { context: CrewAIToolCallHookContext },
    AfterToolCall { context: CrewAIToolCallHookContext },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrewAIToolCallHookContext {
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub tool_result: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrewAISessionStart {
    pub crew_id: String,
    pub agent_role: String,
    pub process_type: CrewProcessType,
    pub task_id: Option<TaskId>,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrewAISessionEnd {
    pub session_id: SessionId,
    pub crew_id: String,
    pub outcome: CrewAISessionOutcome,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrewAISessionOutcome {
    Completed,
    Failed,
    Cancelled,
    Timeout,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecallResult {
    pub beliefs: Vec<BeliefState>,
    pub total_count: u64,
    pub truncated: bool,
    pub token_estimate: TokenEstimate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub status: MergeResultStatus,
    pub merged_claim_ids: Vec<ClaimId>,
    pub conflicts_resolved: Vec<MergeConflictRecord>,
    pub unresolved_conflicts: Vec<MergeConflict>,
    pub manual_merge_state: Option<ManualMergeState>,
    pub audit_id: EventId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeConflictRecord {
    pub conflict_id: String,
    pub resolution: ManualMergeResolution,
    pub winning_claim_id: ClaimId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MergeResultStatus {
    Completed,
    PendingResolution,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManualMergeResolutionRequest {
    pub merge_id: String,
    pub conflict_id: String,
    pub resolution: ManualMergeResolution,
    pub new_value: Option<String>,
    pub new_confidence: Option<f64>,
}

/// CrewAI adapter errors (contract-local)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CrewAIAdapterError {
    CorePortUnavailable { endpoint: String, reason: String },
    TimeProviderUnavailable,
    BudgetExceeded { remaining: u64, required: u64, retryable: bool, retry_after_seconds: Option<u64> },
    NotInitialized,
    AlreadyInitialized,
    AuditFailure { operation: String, reason: String },
    GovernanceRefusal {
        action: String,
        reason: String,
        rule: String,
        verdict: GovernanceVerdict,
        alternatives: Vec<String>,
    },
    UnknownTool { tool: String, available_operations: Vec<String> },
    SerdeError { detail: String },
    BranchConflict { branch_ids: Vec<String>, reason: String },
    ShutdownFailed { reason: String },
    SessionNotFound { session_id: String },
    TrustLevelInsufficient { required: AgentTrustLevel, actual: AgentTrustLevel },
    CapabilityNotDeclared { capability: String },
    TranslationFailed { tool: String, detail: String },
    MaxSessionsExceeded { current: u32, max: u32 },
    ClientError { source: String, message: String },
    Internal { message: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrewAIAdapterErrorCode {
    NotInitialized,
    AlreadyInitialized,
    TimeProviderUnavailable,
    GovernanceRefusal,
    TrustLevelInsufficient,
    CapabilityNotDeclared,
    UnknownTool,
    BudgetExceeded,
    CorePortUnavailable,
    AuditFailure,
    SerdeError,
    BranchConflict,
    SessionNotFound,
    ShutdownFailed,
    TranslationFailed,
    MaxSessionsExceeded,
    ClientError,
    Internal,
}

/// Adapter lifecycle states (contract-local)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterLifecycleState {
    Uninitialized,
    Initializing,
    Ready,
    Degraded,
    Shutdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterHealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterHealth {
    pub status: AdapterHealthStatus,
    pub lifecycle_state: AdapterLifecycleState,
    pub last_activity: Option<String>,
    pub active_sessions: u32,
    pub error_count: u64,
    pub uptime_ms: u64,
    pub core_port_connected: bool,
    pub token_budget_remaining: u64,
    pub token_budget_total: u64,
    pub last_error: Option<String>,
    pub details: Option<serde_json::Value>,
}
```

---

## 5. Governance Enforcement

### 5.1 Authorization-First Ordering

Every adapter operation that can produce a Limen side effect follows this authorization-first sequence. Budget exhaustion MUST NOT be usable to hide governance refusals, suspended-agent activity, undeclared capabilities, or forbidden delegation.

```
1. Validate adapter has completed initialization and is not SHUTDOWN (else NOT_INITIALIZED). **INV: CORE_PORT_UNAVAILABLE MUST NOT be returned before authorization check completes (step 5).** Core port status is recorded but deferred to step 11.
2. Validate TimeProvider availability for governance and audit timestamps (else TIME_PROVIDER_UNAVAILABLE)
3. Normalize CrewAI payload enough to identify requested action, session, agent, crew, and tool name
4. Build GovernanceContext from explicit OperationContext + active AgentSession
5. Evaluate governance gate (agent state, refusal rules, trust level, capabilities, rate limits, classification)
6. If verdict is 'refuse': append terminal audit entry, emit 'governance:refused', return GOVERNANCE_REFUSAL
7. If verdict is 'escalate': append terminal audit entry, emit 'governance:escalated', return GOVERNANCE_REFUSAL with escalation metadata
8. If verdict is 'sandbox': bind SandboxConfig constraints before any execution
9. Validate declared capability and tool registration (else CAPABILITY_NOT_DECLARED or UNKNOWN_TOOL)
10. Estimate and check token budget (else append failure audit and return BUDGET_EXCEEDED)
11. If operation requires Limen Core and the core port is unavailable, append failure audit and return CORE_PORT_UNAVAILABLE
12. Append durable pre-operation audit entry
13. Execute operation against Limen Core
14. Append durable post-operation audit entry
15. Emit AgentEventPayload via AgentEventBus
16. Return result
```

**Claim 3.1:** No mutating operation may return success without a durable audit entry existing for it (audit-before-success). If audit recording fails, the operation MUST fail with `AUDIT_FAILURE` even if the underlying operation succeeded.

**Claim 3.2:** The governance gate evaluates in <10ms as specified by `PerformanceBudget.governanceCheck` (SHARED_TYPES.md §20). Audit append is a separate budget (<50ms).

### 5.2 Governance Is Non-Optional

The adapter has no ungoverned execution mode. `config.governed` exists only for backward-compatible config parsing and may be omitted or set to `true`. Any explicit `false` value is rejected during initialization.

| Operation | Governance Action | Required Capability | Minimum Trust |
|---|---|---|---|
| `remember` | `{ domain: 'memory', operation: 'write' }` | `memory_write` | `low` |
| `recall` | `{ domain: 'memory', operation: 'read' }` | `memory_read` (implicit) | `untrusted` |
| `createBranch` | `{ domain: 'memory', operation: 'branch' }` | `branching` | `medium` |
| `mergeBranches` | `{ domain: 'memory', operation: 'merge' }` | `branching` | `medium` |
| delegation event | `{ domain: 'execution', operation: 'delegate' }` | `mission_delegation` | `high` |
| `translateToolCall` | `{ domain: 'execution', operation: 'tool_call' }` | mapped per tool registry | mapped per tool registry |
| `translateActionToGovernance` | canonical `ComputerAction` domain/action | mapped per `ComputerAction` | mapped per `ComputerAction` |
| `resolveConflict` | `{ domain: 'memory', operation: 'resolve_merge_conflict' }` | `branching` | `medium` |
| `mapNativeEvent` | N/A -- pure transformation | N/A | N/A |
| `mapLimenEvent` | N/A -- pure transformation | N/A | N/A |

**Claim 3.8:** `mapNativeEvent` and `mapLimenEvent` are pure data transformations with no side effects. They do not emit events, do not write to Limen Core, and do not require governance evaluation. They produce no audit entry. They are synchronous functions that translate between CrewAI hook event shapes and canonical `AgentEventPayload` shapes, returning `null` when no mapping exists.

**Claim 3.3:** EVERY side-effecting operation in the table above MUST pass through the governance gate. There is no `governed:false`, verified-admin, test, degraded, retry, or shutdown-drain path that bypasses governance evaluation for a side-effecting operation.

### 5.3 GovernanceRefusal Error

```typescript
interface GovernanceRefusal {
  readonly code: 'GOVERNANCE_REFUSAL';
  readonly action: string;
  readonly reason: string;
  readonly rule: string; // which RefusalRule triggered
  readonly verdict: GovernanceVerdict;
  readonly alternatives?: readonly string[];
}
```

**Claim 3.4:** Every `GOVERNANCE_REFUSAL` includes the `rule` field identifying which specific refusal rule blocked the operation. The `verdict` field carries the full `GovernanceVerdict` for caller inspection.

### 5.4 Validity State Matrix

The adapter enforces a validity matrix derived from `AGENT_LIFECYCLE_MANAGEMENT.md` invariants:

| Agent State | Trust Level | Governed | remember | recall | createBranch | mergeBranches |
|---|---|---|---|---|---|---|
| active | untrusted | true | REFUSED | OK | REFUSED | REFUSED |
| active | low | true | OK (conf cap 0.3) | OK | REFUSED | REFUSED |
| active | medium | true | OK (conf cap 0.7) | OK | OK | OK |
| active | high | true | OK (conf cap 0.85) | OK | OK | OK |
| active | verified | true | OK (conf cap 1.0) | OK | OK | OK |
| active | any | false | INIT REFUSED | INIT REFUSED | INIT REFUSED | INIT REFUSED |
| suspended | any | any | REFUSED | REFUSED | REFUSED | REFUSED |
| decommissioned | any | any | REFUSED | REFUSED | REFUSED | REFUSED |

**Claim 3.5:** Confidence caps from `AGENT_LIFECYCLE_MANAGEMENT.md` §11 are enforced. A `remember` call with `confidence: 0.9` from a `medium` trust agent silently caps to `0.7`. The returned `ClaimId` references a claim with `confidence: 0.7`.

**Claim 3.6:** All operations on a `suspended` or `decommissioned` agent return `GOVERNANCE_REFUSAL` with reason `"agent_state_not_active"`. This check precedes all other governance evaluation.

**Claim 3.7:** The `memory_read` capability is implicitly granted at all trust levels, including `untrusted`. Declaring `memory_read` in `CrewAIAdapterConfig.capabilities` is permitted for audit visibility but does not gate access -- `recall` succeeds for any active agent regardless of whether `memory_read` appears in the declared capability set. The governance gate still evaluates (agent state, rate limits, classification), but capability presence is not checked for `recall`. This is the only implicitly granted capability; all other operations require explicit capability declaration.

---

## 6. Error Taxonomy

### 6.1 Error Codes

```typescript
type CrewAIAdapterErrorCode =
  | 'NOT_INITIALIZED'
  | 'ALREADY_INITIALIZED'
  | 'TIME_PROVIDER_UNAVAILABLE'
  | 'GOVERNANCE_REFUSAL'
  | 'TRUST_LEVEL_INSUFFICIENT'
  | 'CAPABILITY_NOT_DECLARED'
  | 'UNKNOWN_TOOL'
  | 'BUDGET_EXCEEDED'
  | 'CORE_PORT_UNAVAILABLE'
  | 'AUDIT_FAILURE'
  | 'SERDE_ERROR'
  | 'BRANCH_CONFLICT'
  | 'SESSION_NOT_FOUND'
  | 'SHUTDOWN_FAILED'
  | 'TRANSLATION_FAILED'
  | 'MAX_SESSIONS_EXCEEDED'
  | 'CLIENT_ERROR'
  | 'INTERNAL';

interface CrewAIAdapterError {
  readonly code: CrewAIAdapterErrorCode;
  readonly message: string;
  readonly adapterId: AdapterId;
  readonly retryable: boolean;
  readonly context?: Readonly<Record<string, unknown>>;
}
```

**Note:** The `retryable` field on `CrewAIAdapterError` is a CrewAI-specific extension of the canonical `AdapterKernelError` defined in `AGENT_ADAPTER_ARCHITECTURE.md`. It is not present in the parent contract. Implementations of other adapters are not required to include this field.

### 6.2 Error Precedence

Errors are evaluated in strict precedence order. The order extends the canonical `AdapterErrorCode` family from `AGENT_ADAPTER_ARCHITECTURE.md` §11 with CrewAI-specific resource and audit errors. When multiple error conditions are simultaneously true, the highest-precedence error is returned:

| Precedence | Error Code | Applies To | Rationale |
|---|---|---|---|
| 1 (highest) | `NOT_INITIALIZED` | All operations | Adapter not ready; no other evaluation is meaningful |
| 2 | `ALREADY_INITIALIZED` | `initialize()` only | Conflicting initialization attempt against a READY adapter |
| 3 | `TIME_PROVIDER_UNAVAILABLE` | All operations except `getHealth`, `shutdown` | Cannot timestamp governance or audit decisions |
| 4 | `SERDE_ERROR` | `translateToolCall`, `translateActionToGovernance`, `initialize` | Native payload cannot be normalized enough to identify actor/action |
| 5 | `GOVERNANCE_REFUSAL` | All side-effecting operations | Policy blocks operation before resource admission. Fires for lifecycle-state violations (suspended/decommissioned agents attempting any operation) and governance-rule violations (refusal hints, rate limits, classification denials). |
| 6 | `TRUST_LEVEL_INSUFFICIENT` | `remember`, `createBranch`, `mergeBranches`, `resolveConflict`, delegation | Trust floor not met for requested capability. Fires when an active agent's trust level is below the minimum required for a specific operation (e.g., an `untrusted` agent calling `remember` which requires `low`). Distinguished from `GOVERNANCE_REFUSAL` in that the agent is active and governance-compliant, but lacks the trust level for the specific operation. |
| 7 | `CAPABILITY_NOT_DECLARED` | `translateToolCall`, `translateActionToGovernance`, delegation | Operation requires undeclared capability |
| 8 | `UNKNOWN_TOOL` | `translateToolCall` | CrewAI tool is not registered in adapter tool registry |
| 9 | `TRANSLATION_FAILED` | `translateToolCall`, `translateActionToGovernance` | Tool call translation from CrewAI format to Limen governance format failed |
| 10 | `MAX_SESSIONS_EXCEEDED` | `onAgentSessionStart` | Maximum concurrent sessions limit reached |
| 11 | `BUDGET_EXCEEDED` | `remember`, `recall`, `createBranch`, `mergeBranches`, `resolveConflict` | Token budget exhausted after authorization succeeds |
| 12 | `CORE_PORT_UNAVAILABLE` | All operations requiring Limen Core | Authorized operation cannot reach Limen Core |
| 13 | `AUDIT_FAILURE` | All audited operations | Audit cannot record; operation must not succeed |
| 14 | `BRANCH_CONFLICT` | `mergeBranches` | Unresolvable merge conflict (non-manual strategy) |
| 15 | `SESSION_NOT_FOUND` | `onAgentSessionEnd`, operations requiring session context | Referenced session does not exist |
| 16 | `SHUTDOWN_FAILED` | `shutdown()` only | Shutdown could not complete cleanly |
| 17 | `CLIENT_ERROR` | `remember`, `recall`, `createBranch`, `mergeBranches`, `resolveConflict` | Canonical Limen client returned an adapter-facing error |
| 18 (lowest) | `INTERNAL` | All operations | Catch-all for unexpected failures |

**Claim 4.1:** Error precedence is deterministic. Given simultaneous `GOVERNANCE_REFUSAL`, `BUDGET_EXCEEDED`, and `CORE_PORT_UNAVAILABLE`, the adapter MUST return `GOVERNANCE_REFUSAL` because authorization precedes budget and core-port admission.

**Claim 4.2:** `GOVERNANCE_REFUSAL` is NEVER retryable. The governance decision is authoritative; retrying the same operation with the same context produces the same refusal.

**Claim 4.3:** `NOT_INITIALIZED` is NEVER retryable. The caller must call `initialize` first.

**Claim 4.4:** `BUDGET_EXCEEDED` is retryable only when `TokenBudgetConfig.replenishmentWindowSeconds` is non-null. The error includes `remaining`, `required`, and `retryAfterSeconds` when retryable; otherwise `retryable` is `false`.

**Claim 4.5:** `CORE_PORT_UNAVAILABLE` is retryable subject to the `RetryPolicy`. The adapter transitions to `DEGRADED` state and attempts automatic reconnection.

**Claim 4.6:** `UNKNOWN_TOOL` is never retryable unless the adapter registry changes. It includes `tool` and `availableOperations` in `context`.

**Claim 4.7:** Configuration values outside accepted ranges are rejected with typed errors. The adapter MUST NOT silently clamp `connectionTimeoutMs`, `delegationDepthMax`, token budgets, retry limits, or warning thresholds.

### 6.3 Error-to-Event Mapping

Every error emits a corresponding event for observability:

| Error Code | Event Type |
|---|---|
| `GOVERNANCE_REFUSAL` | `governance:refused` |
| `BUDGET_EXCEEDED` | `budget:exhausted` |
| `AUDIT_FAILURE` | `hook:failed` |
| `CORE_PORT_UNAVAILABLE` | `cognitive:health_degraded` |
| `UNKNOWN_TOOL` | `hook:blocked` |
| `CAPABILITY_NOT_DECLARED` | `hook:blocked` |
| `TRANSLATION_FAILED` | `hook:blocked` |
| `MAX_SESSIONS_EXCEEDED` | `session:rejected` |
| All others | Logged via adapter-internal telemetry; no AgentEvent emitted |

---

## 7. Token Budget Enforcement

### 7.1 TokenEstimator Integration

The adapter integrates with `TokenEstimator` (SHARED_TYPES.md §20.1) to enforce token budgets:

```typescript
interface TokenBudgetState {
  readonly totalBudget: number;
  readonly maxTokensPerOperation: number;
  readonly consumed: number;
  readonly remaining: number;
  readonly lastOperationEstimate: TokenEstimate | null;
  readonly encoding: TokenEncoding;
  readonly warningEmitted: boolean;
}
```

### 7.2 Pre-Operation Budget Check

After governance allows or sandboxes the operation, and before any Limen Core call, the adapter:

1. Estimates the token cost of the operation using `TokenEstimator.estimate()`
2. Rejects if `estimate.overflow === true`
3. Rejects if `estimate.tokens > maxTokensPerOperation`
4. Rejects if `estimate.tokens > remaining`
5. Appends a failure audit entry before returning `BUDGET_EXCEEDED`
6. Records successful token consumption with checked arithmetic only after the operation is admitted
7. If budget consumed exceeds `warningThresholdPct`: emit `budget:exhausted` event (once per session)

**Claim 5.1:** Governance evaluation happens BEFORE token budget admission. A budget-exceeded operation has already been authorized or sandboxed and receives a failure audit entry before returning `BUDGET_EXCEEDED`.

**Claim 5.2:** Token consumption is tracked per-operation and cumulatively per-session. `getHealth().tokenBudgetRemaining` exposes remaining session budget, and `getHealth().details.lastOperationEstimate` exposes the last per-operation estimate.

**Claim 5.3:** The `remember` operation estimates tokens for: content serialization + audit entry + governance context. The `recall` operation estimates tokens for: query serialization + estimated response size (using `limit` parameter as upper bound).

### 7.3 Budget Tracking per Operation

| Operation | Token Cost Components |
|---|---|
| `remember` | Content + metadata + audit entry + governance context |
| `recall` | Query + response (limit * avg_belief_size) + audit entry |
| `createBranch` | Branch metadata + audit entry |
| `mergeBranches` | Per-branch conflict resolution + merged claims + audit entries |
| `resolveConflict` | Resolution payload + pending merge state + audit entry |
| `translateToolCall` | Native hook context digest + canonical operation payloads |
| `translateActionToGovernance` | Native action payload + canonical ComputerAction payload |
| `shutdown` | Session summary + final audit entries |

---

## 8. Audit & Provenance

### 8.1 Audit-Before-Success Invariant

**Claim 6.1:** No operation returns a successful `Result` without a durable audit entry existing for that operation. This is the fundamental audit guarantee.

**Claim 6.2:** If audit recording fails (disk error, connection loss, serialization failure), the operation MUST return `AUDIT_FAILURE` even if the underlying Limen Core operation succeeded. The caller must treat the operation as failed.

### 8.2 Audit Entry Structure

Every adapter operation produces an `AuditLogEntry` (SHARED_TYPES.md §10.3) with these additional details in the `details` field:

```typescript
interface CrewAIAuditDetails {
  readonly operationType:
    | 'remember'
    | 'recall'
    | 'createBranch'
    | 'mergeBranches'
    | 'resolveConflict'
    | 'translateToolCall'
    | 'translateActionToGovernance'
    | 'onAgentSessionStart'
    | 'onAgentSessionEnd'
    | 'initialize'
    | 'shutdown'
    | 'healthCheck';
  readonly crewId: string;
  readonly agentRole: string;
  readonly delegationDepth: number;
  readonly tokenCost: number;
  readonly governanceState: 'allowed' | 'refused' | 'escalated' | 'sandboxed' | 'not_applicable';
  readonly beliefIds?: readonly string[]; // claim IDs affected
  readonly branchIds?: readonly string[]; // branch IDs affected
  readonly toolName?: string;
  readonly errorCode?: CrewAIAdapterErrorCode;
  readonly duration: number; // operation duration in ms
}
```

**Claim 6.3:** The `governanceState` field MUST accurately reflect the governance verdict for this operation. `'not_applicable'` is valid only for pre-governance admission failures where no actor/action context could be constructed, such as malformed native payloads. `'bypassed'` is forbidden.

**Claim 6.4:** Every failure that occurs after GovernanceContext construction produces a terminal audit entry before the error is returned. If that failure audit cannot be appended, the returned error is `AUDIT_FAILURE`.

**Claim 6.5:** `healthCheck` produces an audit entry of type `'healthCheck'` recording probe result and latency. The `governanceState` for healthCheck audit entries is `'not_applicable'` because health probes are diagnostic operations with no governance gate.

### 8.3 Hash Chain Integrity

Audit entries participate in the existing hash chain per `AuditLogEntry` validation rules (SHARED_TYPES.md §10.3): `previousHash` matches the prior entry, `currentHash` is the SHA-256 of the canonical serialized entry excluding `currentHash`. The adapter does not maintain its own hash chain; it delegates to Limen Core's audit infrastructure.

---

## 9. State Machine

### 9.1 AdapterLifecycleState

```typescript
type AdapterLifecycleState =
  | 'UNINITIALIZED'
  | 'INITIALIZING'
  | 'READY'
  | 'DEGRADED'
  | 'SHUTDOWN';
```

### 9.2 State Transition Diagram

```
                    initialize()
  +----------------+ ---------> +--------------+
  | UNINITIALIZED  |            | INITIALIZING |
  +----------------+            +------+-------+
        ^                              |
        |                    success   |   failure
        |                              |   (returns to UNINITIALIZED)
        |                              v
        |                       +------+-------+
        |                       |    READY     |<----+
        |                       +--+---+---+---+     |
        |                          |   |   |         |
        |               port loss  |   |   | port    |
        |              +----------+    |   | recovery|
        |              |               |   +---------+
        |              v               |
        |        +-----+------+        |
        |        |  DEGRADED  |--------+ recovery
        |        +-----+------+
        |              |
        |    shutdown() |  shutdown()
        |              |       |
        |              v       v
        |        +-----+------+---+
        +--------|   SHUTDOWN     |  (terminal)
                 +-----------------+
```

### 9.3 Transition Rules

| From | To | Trigger | Guard | Side Effects |
|---|---|---|---|---|
| UNINITIALIZED | INITIALIZING | `initialize()` called | Config validation passes | Begin connection to core |
| INITIALIZING | READY | Core port connected, adapter registered | Audit entry recorded | Emit `session:started` |
| INITIALIZING | UNINITIALIZED | Connection failure, config error, connectionTimeoutMs elapsed | — | Error returned to caller |
| INITIALIZING | SHUTDOWN | `shutdown()` called while INITIALIZING | — | Abort connection attempt; force transition to SHUTDOWN |
| READY | READY | `initialize()` called again with identical config | Config digest matches active digest | No-op success; no state reset |
| READY | DEGRADED | Core port loss detected | — | Emit `cognitive:health_degraded`; begin auto-recovery |
| DEGRADED | READY | Core port recovered | Health check passes | Emit `session:started` (recovery); clear error count |
| READY | SHUTDOWN | `shutdown()` called | — | Close sessions, flush audit, deregister |
| DEGRADED | SHUTDOWN | `shutdown()` called | — | Best-effort session close, flush audit |
| SHUTDOWN | SHUTDOWN | `shutdown()` called again | — | No-op, return success (idempotent) |
| UNINITIALIZED | SHUTDOWN | `shutdown()` called | — | No-op, return success |

**Claim 7.1:** All state transitions are atomic. No intermediate state is observable between transition start and completion.

**Claim 7.2:** `SHUTDOWN` is terminal. No transition out of `SHUTDOWN` is possible. Calling `initialize()` on a shut-down adapter returns `NOT_INITIALIZED`.

**Claim 7.3:** The adapter maintains no belief cache. In `DEGRADED` state, `remember`, `recall`, `createBranch`, `mergeBranches`, and `resolveConflict` MUST fail with `CORE_PORT_UNAVAILABLE` until recovery.

**Claim 7.4:** Auto-recovery from `DEGRADED` uses exponential backoff per `RetryPolicy`. If recovery fails after `maxRetries`, the adapter remains in `DEGRADED` and emits `cognitive:health_degraded` with `{ recoveryExhausted: true }`.

**Claim 7.5:** Concurrent `shutdown`, auto-recovery, and public operation calls are serialized by adapter lifecycle state. Once shutdown begins, new side-effecting operations return `NOT_INITIALIZED`; in-flight operations either complete with audit or fail with audit before resources are released.

**Claim 7.6:** After recovery exhaustion in DEGRADED state (all retry attempts per `RetryPolicy` have failed), the adapter remains in DEGRADED. The caller's recourse is `shutdown()` followed by construction of a new adapter instance. Re-initialization from DEGRADED is not permitted; calling `initialize()` in DEGRADED state returns `ALREADY_INITIALIZED`. The adapter emits `cognitive:health_degraded` with `{ recoveryExhausted: true }` when exhaustion occurs.

**Claim 7.7:** INITIALIZING MUST transition to UNINITIALIZED within `connectionTimeoutMs`. If the timeout fires while in INITIALIZING, the adapter transitions to UNINITIALIZED and returns a connection-failure error to the caller. `shutdown()` from INITIALIZING MUST force an immediate transition to SHUTDOWN, aborting the in-progress connection attempt. This prevents INITIALIZING from becoming a stuck state that blocks resource cleanup.

### 9.4 Operations Permitted per State

| State | initialize | remember | recall | createBranch | mergeBranches | resolveConflict | translateToolCall | translateActionToGovernance | onAgentSessionStart | onAgentSessionEnd | healthCheck | getHealth | on/off | shutdown |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UNINITIALIZED | OK | ERR | ERR | ERR | ERR | ERR | ERR | ERR | ERR | ERR | OK (status: unhealthy) | OK (status: unhealthy) | OK | OK (no-op) |
| INITIALIZING | ERR | ERR | ERR | ERR | ERR | ERR | ERR | ERR | ERR | ERR | OK (status: degraded) | OK (status: degraded) | OK | OK (force) |
| READY | OK if same config; ERR if different | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK (live probe) | OK (status: healthy) | OK | OK |
| DEGRADED | ERR | ERR | ERR | ERR | ERR | ERR | ERR (CORE_PORT_UNAVAILABLE) | ERR (CORE_PORT_UNAVAILABLE) | ERR (CORE_PORT_UNAVAILABLE) | ERR (CORE_PORT_UNAVAILABLE) | OK (status: degraded) | OK (status: degraded) | OK | OK |
| SHUTDOWN | ERR | ERR | ERR | ERR | ERR | ERR | ERR | ERR | ERR | ERR | ERR (NOT_INITIALIZED) | OK (status: unhealthy) | ERR (NOT_INITIALIZED) | OK (no-op) |

---

## 10. Test Requirements

The following test cases are mandatory for certification. They include the parent `AgentAdapter` testing contract plus CrewAI-specific hostile cases.

### TC-01: Happy Path Lifecycle

**Covers:** Claims 1.1, 1.2, 1.3, 6.1
**Steps:** `initialize(client, governor, config)` with valid config -> `onAgentSessionStart` -> `remember` -> `recall` -> verify returned belief matches -> `onAgentSessionEnd` -> `shutdown`
**Assertions:** All operations return `Result.ok`. Audit entries exist for every operation. Post-shutdown, operations return `NOT_INITIALIZED`.

### TC-02: Governance Refusal Is Authorization-First

**Covers:** Claims 3.1, 3.3, 3.4, 3.6
**Steps:** Initialize with `governed: true` and agent in `suspended` state. Call `remember` with content that also exceeds token budget.
**Assertions:** Returns `GOVERNANCE_REFUSAL`, not `BUDGET_EXCEEDED`. No claim is created. Terminal refusal audit and `governance:refused` event are emitted.

### TC-03: Token Budget Exceeded Mid-Operation

**Covers:** Claims 5.1, 5.2, 4.4
**Steps:** Initialize with `tokenBudget.maxTokensPerSession: 100` and `replenishmentWindowSeconds: 60`. Call `remember` with content that estimates to 150 tokens.
**Assertions:** Governance verdict is evaluated first. Returns `BUDGET_EXCEEDED` with `remaining < required`, `retryable: true`, and `retryAfterSeconds <= 60`. No claim is created. Failure audit entry exists.

### TC-04: Audit Failure Blocks Operation Success

**Covers:** Claims 6.1, 6.2
**Steps:** Initialize. Inject pre-operation audit failure and call `remember`; then inject post-operation audit failure after a separate successful pre-audit append.
**Assertions:** Pre-operation audit failure prevents the Core call and returns `AUDIT_FAILURE`. Post-operation audit failure returns `AUDIT_FAILURE` even if Core mutation completed. `hook:failed` event emitted.

### TC-05: Post-READY Core Port Loss and Recovery

**Covers:** Claims 7.1, 7.3, 7.4, 4.5
**Steps:** Initialize to READY. Simulate core port disconnect. Verify state is `DEGRADED`. Attempt `remember` -> `CORE_PORT_UNAVAILABLE`. Restore core port. Verify state transitions to `READY`. Call `remember` -> success.
**Assertions:** State transitions are observable via `getHealth()`. Write operations fail in DEGRADED. Recovery restores full functionality.

### TC-06: Branch Creation and Merge with Conflict Resolution

**Covers:** Claims 1.6, 1.7, 2.5
**Steps:** Initialize at `medium` trust. Create branch. Remember conflicting claims on trunk and branch. Merge with `highest_confidence` strategy.
**Assertions:** `createBranch` succeeds. Merge resolves deterministically per SHARED_TYPES.md §23. `MergeResult.conflictsResolved` is populated. `MergeResult.status` is `'completed'`.

### TC-07: Use-Before-Initialize

**Covers:** Claims 1.1, 4.1, 4.3
**Steps:** Without calling `initialize`, call `remember`, `recall`, `createBranch`, `mergeBranches`, `resolveConflict`, `translateToolCall`, `translateActionToGovernance`, and `shutdown`.
**Assertions:** All operations except `shutdown` return `NOT_INITIALIZED`. `shutdown` returns `ok` (no-op). No events emitted. No audit entries created.

### TC-08: Shutdown Idempotency

**Covers:** Claim 1.2
**Steps:** Initialize. Shutdown. Shutdown again. Shutdown a third time.
**Assertions:** First shutdown returns `ok` with cleanup. Second and third return `ok` with no side effects. State remains `SHUTDOWN`. No duplicate audit entries.

### TC-08A: Idempotent Initialize

**Covers:** Claims 1.1, 7.1
**Steps:** Initialize with valid config. Initialize again with identical config. Initialize a third time with a different config digest.
**Assertions:** Second initialize returns `ok` with no side effects. Third initialize returns `ALREADY_INITIALIZED`. Active sessions, capabilities, registry state, and audit chain are not reset.

### TC-09: Concurrent Operations During DEGRADED State

**Covers:** Claim 7.3
**Steps:** Initialize. Transition to DEGRADED (port loss). Issue 10 concurrent `remember` calls and 10 concurrent `recall` calls.
**Assertions:** All 10 `remember` calls fail with `CORE_PORT_UNAVAILABLE`. All 10 `recall` calls fail with `CORE_PORT_UNAVAILABLE`. No cache read occurs. No partial writes. No deadlocks. Error count increments correctly.

### TC-10: Error Precedence Verification

**Covers:** Claims 4.1, 4.2, 4.3
**Steps:** Arrange simultaneous conditions: core port unavailable + budget exceeded + governance refusal pending. Call `remember`.
**Assertions:** Returns `GOVERNANCE_REFUSAL`, not `BUDGET_EXCEEDED` or `CORE_PORT_UNAVAILABLE`. Verify pairwise combinations across the full precedence table.

### TC-11: Confidence Cap Enforcement

**Covers:** Claim 3.5
**Steps:** Initialize at `medium` trust (conf cap 0.7). Call `remember` with `confidence: 0.95`.
**Assertions:** Operation succeeds. Returned `ClaimId` references a claim with `confidence: 0.7`. No error. The cap is silent.

### TC-12: Manual Merge with Pending Resolution

**Covers:** Claim 2.5
**Steps:** Create branch. Add conflicting claims. Call `mergeBranches` with `strategy: 'manual'`.
**Assertions:** `MergeResult.status === 'pending_resolution'`. `manualMergeState` is non-null with conflicts listed. No claims merged until resolution.

### TC-13: Manual Conflict Resolution API

**Covers:** Claims 1.11, 2.9
**Steps:** Create manual merge with conflicts. Call `resolveConflict` for each conflict. Attempt duplicate resolution and `merge_new_value` without `newValue`.
**Assertions:** Valid resolutions complete deterministically. Duplicate or malformed resolutions return typed errors. Final merge audit references every resolution.

### TC-14: Unknown Tool Handling

**Covers:** Claims 1.9, 2.8, 4.6
**Steps:** Pass CrewAI hook context with `tool_name: "delete_everything"` and valid `tool_input` from an authorized active agent.
**Assertions:** Returns `UNKNOWN_TOOL` with `availableOperations`. Emits `hook:blocked`. Does not return empty success and does not execute the native tool.

### TC-15: Tool Translation for Each Declared Capability

**Covers:** Claims 1.9, 1.10, 3.3
**Steps:** For every declared CrewAI capability, pass at least one registered CrewAI tool call through `translateToolCall`.
**Assertions:** Each known tool translates to valid `LimenOperation[]`; side-effecting operations pass governance first.

### TC-16: NativeAgentAction Translation

**Covers:** Claim 1.10
**Steps:** Translate `crew_delegation` and representative tool actions into canonical `ComputerAction`.
**Assertions:** Every `ActionBase` field is populated; undeclared capability returns `CAPABILITY_NOT_DECLARED`; malformed native payload returns `SERDE_ERROR`.

### TC-17: Session Lifecycle Bridge

**Covers:** Claims 1.1, 6.1, 7.1
**Steps:** Call `onAgentSessionStart`, execute operations, then `onAgentSessionEnd`.
**Assertions:** `AgentSession.metadata` preserves crew ID, agent role, task ID, delegation depth, and process type. `SessionSummary` is returned and audited.

### TC-18: Event Bridge Mapping

**Covers:** Claims 1.9, 6.3
**Steps:** Map `before_tool_call` and `after_tool_call` CrewAI events into `AgentEventPayload`; map Limen events back.
**Assertions:** Audit IDs are preserved; unsupported native events return `null` without suppressing Limen audit events.

### TC-19: Governed False Rejection

**Covers:** Claims 2.1, 3.3
**Steps:** Initialize with `governed: false` as a `verified` agent with `governance_admin`.
**Assertions:** Initialization returns `GOVERNANCE_REFUSAL` with `rule: "governance_non_optional"`. No adapter is registered.

### TC-20: Rate Limit Inheritance

**Covers:** Claim 2.7
**Steps:** Initialize with empty `rateLimits`, then with weaker limits than `DEFAULT_RATE_LIMITS`.
**Assertions:** Empty limits inherit defaults. Weakened limits are rejected. Rate counters are shared with governance and cannot reset locally.

### TC-21: Dual Projection Parity

**Covers:** Rust/TypeScript interface parity
**Steps:** Generate/inspect TypeScript and Rust projections for methods, branded IDs, enums, errors, and governance refusal payloads.
**Assertions:** Rust returns `ClaimId`/`AgentBranchId`, not raw strings. Error and status enums serialize with canonical snake_case parity.

### TC-22: AdapterSandboxDefaults Expansion

**Covers:** Parent adapter test contract
**Steps:** Force a sandbox governance verdict for a CrewAI tool call.
**Assertions:** Lightweight `AdapterSandboxDefaults` expands to full `SandboxConfig`; execution uses sandbox constraints; audit records `governanceState: "sandboxed"`.

### TC-23: CrewAI Delegation Depth Hostile Case

**Covers:** CrewAI-specific constraints
**Steps:** Submit nested delegation events exceeding `delegationDepthMax`.
**Assertions:** Authorization returns `GOVERNANCE_REFUSAL` or `CAPABILITY_NOT_DECLARED` according to capability state. No delegated operation executes.

### TC-24: CrewAI Hook Payload Shape Hostile Case

**Covers:** Claims 2.8, 4.1
**Steps:** Submit payloads with `{ tool, args }` but no `tool_name`/`tool_input`, and payloads where role names imply privileged tools.
**Assertions:** Missing hook fields return `SERDE_ERROR`. Role/task text never grants capabilities or tool identity.

### TC-25: Client Error Propagation

**Covers:** Invariant 5, Claims 6.1, 6.4
**Steps:** Initialize. Inject a `LimenAgentClient` error (e.g., connection reset, deserialization failure) during a `remember` call and then during a `recall` call.
**Assertions:** Error propagates as `CLIENT_ERROR` with the original error code and message preserved in `context`, not swallowed as `INTERNAL`. Audit entry records the client error with `errorCode: 'CLIENT_ERROR'` and the original source in `details`. `hook:failed` is NOT emitted (client errors use adapter-internal telemetry per §6.3).

### TC-26: Concurrent Session Isolation

**Covers:** Invariant 6
**Steps:** Initialize two separate adapter instances for the same crew with different agent roles (e.g., "researcher" and "writer"). Start sessions on both. Run concurrent `remember` and `recall` operations on both adapters simultaneously.
**Assertions:** Sessions are fully isolated: each adapter's `getHealth().activeSessions` is 1. Token budgets are independent. Audit entries reference the correct `agentRole`. A claim written by "researcher" is not visible in "writer"'s session metadata. No shared state, no budget cross-contamination, no deadlocks.

### TC-27: Shutdown with Active Sessions

**Covers:** Claims 1.3, 7.5, Invariant 9
**Steps:** Initialize. Start 3 sessions via `onAgentSessionStart` with different agent roles. Call `shutdown()` without calling `onAgentSessionEnd` for any of them.
**Assertions:** `shutdown()` returns `Result.ok`. All 3 sessions produce a `SessionSummary` with `outcome: 'cancelled'`. Audit entries exist for each forced session close (3 entries with `operationType: 'onAgentSessionEnd'` and `governanceState: 'not_applicable'`). Post-shutdown `getHealth().activeSessions` is 0. No background tasks remain (Invariant 9).

### TC-28: healthCheck Returns Correct Status Across States

**Covers:** Claim 1.12
**Steps:** Call `healthCheck()` in UNINITIALIZED state. Initialize to READY and call `healthCheck()`. Simulate core port loss (DEGRADED) and call `healthCheck()`. Restore core port (READY) and call `healthCheck()`. Shutdown and call `healthCheck()`.
**Assertions:** UNINITIALIZED: returns `AdapterHealth` with `status: 'unhealthy'`, `corePortConnected: false`, `activeSessions: 0`. READY: returns `status: 'healthy'`, `corePortConnected: true`. DEGRADED: returns `status: 'degraded'`, `corePortConnected: false`. SHUTDOWN: returns `NOT_INITIALIZED` error. In all non-SHUTDOWN states, `healthCheck()` performs a live probe (not cached) -- verified by injecting a transient core port failure between `getHealth()` (cached: healthy) and `healthCheck()` (live: degraded).

### TC-29: Subscription Lifecycle via on/off

**Covers:** Claim 1.13
**Steps:** Register a subscription via `on('governance:refused', handler)` in UNINITIALIZED state. Initialize to READY. Trigger a governance refusal and verify handler fires. Call `off(subscriptionId)` and trigger another refusal -- verify handler does NOT fire. Register a new subscription. Transition to DEGRADED then back to READY -- verify subscription still fires. Call `shutdown()` -- verify all subscriptions are cleared. Attempt `on()` post-SHUTDOWN -- verify `NOT_INITIALIZED` error is returned. Attempt `off()` post-SHUTDOWN -- verify `NOT_INITIALIZED` error is returned. Attempt `off('nonexistent-id')` pre-SHUTDOWN -- verify no-op.
**Assertions:** Subscriptions registered pre-READY fire once READY. `off()` removes exactly the targeted subscription. Subscriptions survive DEGRADED -> READY recovery. Shutdown clears all subscriptions. Post-SHUTDOWN `on()` and `off()` return `NOT_INITIALIZED`. `off()` with unknown ID (pre-SHUTDOWN) is a no-op.

---

## 11. Dependencies

| Dependency | Version | Section | Purpose |
|---|---|---|---|
| `SHARED_TYPES.md` | v1.4.0 | §21 (`AgentFramework.crew_ai`) | Framework enum, all cross-contract types |
| `AGENT_ADAPTER_ARCHITECTURE.md` | v2.3.0 | §7.6, §3, §8, §10 | Adapter interface, CrewAI spec, registry, testing contract, invariants |
| `AGENT_LIFECYCLE_MANAGEMENT.md` | v1.3.0 | §5, §6, §7, §11, §13 | Trust promotion, consent governance, knowledge exchange, confidence caps, invariants |
| `@langchain/langgraph-checkpoint` | N/A | — | NOT a dependency. CrewAI adapter communicates with Limen Core directly. LangGraph interop is a separate adapter concern. |
| CrewAI SDK/docs | v1.14.x / official docs accessed 2026-05-06 | Tools, Tool Call Hooks | Hook context shape, BaseTool normalization, tool call interception |

**Certification Gate:** This contract MUST NOT be certified in a workspace whose `SHARED_TYPES.md`, `AGENT_ADAPTER_ARCHITECTURE.md`, or `AGENT_LIFECYCLE_MANAGEMENT.md` versions are older than the versions listed above. In particular, `AgentFramework.crew_ai`, the v2.3.0 canonical `AgentAdapter` interface, and the v1.3.0 lifecycle confidence/trust rules must exist in the same contract family before implementation begins.

---

## 12. Claims Registry

All verifiable claims for Breaker traceability:

| Claim | Section | Statement |
|---|---|---|
| 1.1 | §3.1 | `initialize` must complete before operations; repeat init with same config is no-op success |
| 1.2 | §3.1 | `shutdown` is idempotent |
| 1.3 | §3.1 | `shutdown` closes sessions, flushes audit, deregisters before returning |
| 1.4 | §3.1 | `remember` enforces governance before budget and persistence; refusal prevents claim creation |
| 1.5 | §3.1 | `recall` filters by explicit caller clearance level; no above-clearance claims returned |
| 1.6 | §3.1 | `createBranch` requires `branching` capability, minimum trust `medium` |
| 1.7 | §3.1 | `mergeBranches` follows deterministic ordering per SHARED_TYPES §23 |
| 1.8 | §3.1 | `getHealth` is synchronous, does not block on I/O |
| 1.9 | §3.1 | `translateToolCall` normalizes CrewAI hook payloads and returns `UNKNOWN_TOOL` for unknown tools |
| 1.10 | §3.1 | `translateActionToGovernance` populates all canonical `ComputerAction` action-base fields |
| 1.11 | §3.1 | Manual merge conflicts resolve only through `resolveConflict` |
| 1.12 | §3.1 | `healthCheck()` returns live health including Core connectivity, session count, governance state; available in all states except SHUTDOWN |
| 2.1 | §3.2 | `governed` defaults to `true`; `false` is always rejected |
| 2.2 | §3.2 | `connectionTimeoutMs` outside [1000, 30000] is rejected, not clamped |
| 2.3 | §3.3 | Crew context auto-populated from session when omitted |
| 2.4 | §3.4 | `truncated` signals when results are incomplete |
| 2.5 | §3.5 | Manual merge returns `pending_resolution` with non-null `manualMergeState` |
| 2.6 | §3.7 | Only listed errors are retried; `GOVERNANCE_REFUSAL` and `NOT_INITIALIZED` never retried |
| 2.7 | §3.2 | Rate limits inherit `DEFAULT_RATE_LIMITS` and cannot be weakened |
| 2.8 | §3.2.1 | CrewAI hook payloads normalize from `tool_name` and `tool_input` |
| 2.9 | §3.5 | `resolveConflict` rejects unknown, expired, duplicate, or malformed manual resolutions |
| 3.1 | §5.1 | Audit-before-success: no success without durable audit entry |
| 3.2 | §5.1 | Governance check completes in <10ms |
| 3.3 | §5.2 | Every side-effecting operation passes through governance gate; no bypass mode exists |
| 3.4 | §5.3 | Every `GOVERNANCE_REFUSAL` includes the triggering rule |
| 3.5 | §5.4 | Confidence caps per trust level are enforced silently |
| 3.6 | §5.4 | Suspended/decommissioned agents get `GOVERNANCE_REFUSAL` on all operations |
| 4.1 | §6.2 | Error precedence is deterministic per the defined ordering |
| 4.2 | §6.2 | `GOVERNANCE_REFUSAL` is never retryable |
| 4.3 | §6.2 | `NOT_INITIALIZED` is never retryable |
| 4.4 | §6.2 | `BUDGET_EXCEEDED` retryability depends on configured replenishment window |
| 4.5 | §6.2 | `CORE_PORT_UNAVAILABLE` is retryable per RetryPolicy |
| 4.6 | §6.2 | `UNKNOWN_TOOL` is not retryable without registry change |
| 4.7 | §6.2 | Invalid config ranges are rejected, not clamped |
| 5.1 | §7.2 | Governance precedes budget admission |
| 5.2 | §7.2 | Token consumption tracked per-operation and per-session |
| 5.3 | §7.2 | Token estimates include content + audit + governance overhead |
| 6.1 | §8.1 | No successful result without durable audit entry |
| 6.2 | §8.1 | Audit failure causes operation failure |
| 6.3 | §8.2 | `governanceState` accurately reflects verdict; `bypassed` is forbidden |
| 6.4 | §8.2 | Post-governance failures produce terminal audit entries before returning |
| 7.1 | §9.3 | State transitions are atomic |
| 7.2 | §9.3 | SHUTDOWN is terminal |
| 7.3 | §9.3 | DEGRADED blocks reads and writes; no belief cache exists |
| 7.4 | §9.3 | Auto-recovery uses exponential backoff; exhaustion keeps DEGRADED |
| 7.5 | §9.3 | Concurrent shutdown, recovery, and operations are serialized by lifecycle state |
| 7.6 | §9.3 | Recovery exhaustion keeps DEGRADED; re-initialization not permitted; caller must shutdown + reconstruct |
| 7.7 | §9.3 | INITIALIZING must transition to UNINITIALIZED within connectionTimeoutMs; shutdown from INITIALIZING forces SHUTDOWN |
| 1.13 | §3.1 | on/off permitted in all states except SHUTDOWN (throws NOT_INITIALIZED); subscriptions survive transitions, cleared on shutdown |
| 2.10 | §3.2 | Config identity is SHA-256 of canonical JSON (sorted keys, no whitespace); used for idempotent init |
| 3.7 | §5.4 | memory_read implicitly granted at all trust levels; declaration is for audit only, does not gate access |
| 3.8 | §5.2 | mapNativeEvent and mapLimenEvent are pure data transformations; no governance, no audit, no side effects |
| 2.11 | §3.2.1 | Sessions exceeding maxDurationMs end with outcome 'timeout' |
| 2.12 | §3.6 | warningThresholdPct must be in [0, 100]; values outside rejected with SERDE_ERROR |
| 2.13 | §3.2 | delegationDepthMax must be in [0, 10]; 0 disables delegation; values above 10 rejected with SERDE_ERROR |
| 6.5 | §8.2 | healthCheck produces audit entry of type 'healthCheck' recording probe result and latency |

---

## 13. Assumptions Ledger

| ID | Assumption | Justification | Violation Impact |
|---|---|---|---|
| A-01 | Limen Core is reachable at `coreEndpoint` within `connectionTimeoutMs` | Standard deployment: adapter and core co-located or within same network | CORE_PORT_UNAVAILABLE; adapter transitions to DEGRADED |
| A-02 | CrewAI agent roles map to a single Limen `AgentId` per crew member | CrewAI's agent abstraction has 1:1 identity | If CrewAI allows anonymous or pooled agents, identity mapping fails; requires adapter extension |
| A-03 | `AgentFramework.crew_ai` exists in `SHARED_TYPES.md` v1.4.0 | Added in manifest v1.1.0; confirmed in §21 | If enum value is removed, adapter registration fails with `UNKNOWN_FRAMEWORK` |
| A-04 | `TokenEstimator` produces estimates with <=10% variance | Per SHARED_TYPES.md §20.1 validation rules | Budget enforcement accuracy degrades; operations may be over/under-budgeted |
| A-05 | CrewAI delegation depth is bounded by `delegationDepthMax` | Configuration enforced at adapter level | Unbounded delegation creates governance audit explosion; risk mitigated by config validation |
| A-06 | Time provider is available for ISO-8601 timestamp generation | Standard runtime assumption; clock injection per Constitution Hard Stop #7 | TIME_PROVIDER_UNAVAILABLE; all operations fail (precedence 3) |
| A-07 | Limen Core enforces registered adapter identity on CrewAI-originated operations | Adapter Architecture invariant #8 plus §1.2 Core boundary requirement | If Core accepts direct CrewAI calls, governance can be circumvented; implementation must hard-fail at Core boundary |
| A-08 | CrewAI tool-call hooks expose `tool_name` and `tool_input` as the adapter ingress shape | CrewAI official Tool Call Hooks docs; version pin in §1.4 | Translation fails with `SERDE_ERROR`; adapter must update this contract before supporting incompatible CrewAI SDK payloads |
| A-09 | Rate limits from `DEFAULT_RATE_LIMITS` are inherited and not weakened | Per SHARED_TYPES.md §18 and Adapter Architecture §4.1 | Registry rejects config that weakens defaults; additive limits only |
| A-10 | Manual merge conflicts have a timeout governed by session timeout | Per SHARED_TYPES.md §14.2 | If session ends with pending conflicts, branch is auto-discarded per session-end terminal path |

---

## 14. Invariants

1. **Pure Translation.** The adapter is a stateless translation layer for operations. It holds session state and budget counters but does not cache beliefs, branch state, or governance decisions.
2. **Governance Cannot Be Bypassed.** There is no code path from any public side-effecting method to Limen Core that skips governance evaluation. `governed:false` is invalid and rejected before registration.
3. **Audit Completeness.** Every public method invocation that reaches governance or Limen Core produces at least one `AuditLogEntry`. Failed operations after GovernanceContext construction produce audit entries recording the failure.
4. **Capability Immutability.** Capabilities declared at initialization are frozen. No runtime escalation. Trust promotion must go through `AGENT_LIFECYCLE_MANAGEMENT`.
5. **Deterministic Error Resolution.** Given the same adapter state and input, the same error code is returned. Error precedence is a total order.
6. **Session Isolation.** Multiple CrewAI agents using separate adapter instances do not share state, budget, or sessions.
7. **CrewAI Metadata Preservation.** Crew ID, agent role, task ID, delegation depth, process type, and tool name are preserved in every audit entry and session metadata for full provenance reconstruction.
8. **Confidence Monotonicity.** The adapter never increases confidence beyond the trust-level cap. It may decrease (via Limen Core's decay) but never inflate.
9. **Shutdown Completeness.** After `shutdown()` returns, no background tasks, timers, or connections remain active. Resource cleanup is synchronous with the shutdown call.
10. **Budget Non-Negative.** Token budget remaining is never negative. Budget tracking uses checked arithmetic; underflow returns `BUDGET_EXCEEDED`.
11. **Canonical Adapter Surface.** CrewAIAdapter implements every canonical `AgentAdapter` method. Convenience methods may be added but cannot replace canonical translation, session, event, health, or registry semantics.
12. **No Local Belief Cache.** DEGRADED state cannot serve recall from adapter-local belief cache because no such cache exists. Reads and writes that require Limen Core fail with `CORE_PORT_UNAVAILABLE`.
13. **Rate Limit Inheritance.** `DEFAULT_RATE_LIMITS` are always active and may only be tightened by adapter config.

---

**End of Contract.**
