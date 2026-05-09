# Limen v5 CrewAI Adapter Contract -- Requirements Extraction

**Source:** `contracts/CREWAI_ADAPTER_CONTRACT.md` v1.0.0 (1445 lines)
**Extraction Date:** 2026-05-09
**Governing Standard:** SolisForge Protocol v1.4
**ID Format:** `CA-{section}.{number}`

---

## Section 1: Overview & Scope (SS1)

| ID | Requirement | Source |
|---|---|---|
| CA-1.01 | Adapter MUST implement `LimenCrewAIAdapter` that bridges CrewAI multi-agent orchestration framework to Limen governance substrate | SS1.1 |
| CA-1.02 | Adapter MUST translate CrewAI native tool invocations, delegation events, and session boundaries into canonical Limen types | SS1.1 |
| CA-1.03 | Every CrewAI agent operation MUST flow through Limen governance, audit, and memory infrastructure | SS1.1 |
| CA-1.04 | Adapter MUST conform to canonical `AgentAdapter` interface from `AGENT_ADAPTER_ARCHITECTURE.md` v2.3.0 SS7.6 | SS1.2 |
| CA-1.05 | Adapter MUST NOT modify Limen Core; it is a pure translation layer | SS1.2 |
| CA-1.06 | Limen Core MUST reject CrewAI-originated operations missing registered adapter identity, session identity, governance decision, or audit-chain linkage | SS1.2 |
| CA-1.07 | Crew ID MUST be carried in `AgentSession.metadata` | SS1.3 |
| CA-1.08 | Agent Role MUST be carried in `AgentSession.metadata` | SS1.3 |
| CA-1.09 | CrewAI Task MUST map to Limen mission/task via `MissionId`/`TaskId` in `OperationContext` | SS1.3 |
| CA-1.10 | Delegation MUST map to `NativeAgentAction` with `nativeType: 'crew_delegation'` and be governance-gated | SS1.3 |
| CA-1.11 | Tool invocation MUST be translated to `LimenOperation[]` via `translateToolCall` | SS1.3 |
| CA-1.12 | Kickoff (crew execution start) MUST map to `onAgentSessionStart` with crew metadata | SS1.3 |
| CA-1.13 | Sequential/hierarchical process type MUST be preserved in metadata for audit | SS1.3 |
| CA-1.14 | Adapter MUST target CrewAI SDK v1.14.x | SS1.4 |
| CA-1.15 | Adapter MUST bind to CrewAI tool-call hook model (not inferred `{ tool, args }` convention) | SS1.5 |
| CA-1.16 | `CrewAIToolCallHookContext` MUST have minimum shape: `tool_name: string`, `tool_input: Record<string, unknown>`, optional `tool`, `agent`, `task`, `crew`, `tool_result` fields | SS1.5 |
| CA-1.17 | `tool_name` is the ONLY authoritative tool identifier; role names, task descriptions, and backstories MUST NOT imply capabilities | SS1.5 |
| CA-1.18 | Decorated tools and `BaseTool` subclasses MUST be normalized into `CrewAIToolCall` before translation | SS1.5 |
| CA-1.19 | Adapter MUST depend on `SHARED_TYPES.md` v1.4.1 | SS1.4 |
| CA-1.20 | Adapter MUST depend on `AGENT_ADAPTER_ARCHITECTURE.md` v2.3.0 | SS1.4 |
| CA-1.21 | Adapter MUST depend on `AGENT_LIFECYCLE_MANAGEMENT.md` v1.3.0 | SS1.4 |

**Section 1 Total: 21**

---

## Section 2: Shared Type References (SS2)

| ID | Requirement | Source |
|---|---|---|
| CA-2.01 | Adapter MUST use `AgentFramework` value `'crew_ai'` from SHARED_TYPES SS21 | SS2 |
| CA-2.02 | Adapter MUST use all cross-contract types listed in SS2 table (AgentCapability, AgentTrustLevel, AgentSession, SessionSummary, OperationContext, Result<T>, KernelError, GovernanceContext, GovernanceVerdict, GovernanceDecision, MergeStrategy, etc.) | SS2 |
| CA-2.03 | Adapter MUST NOT narrow, replace, or omit any canonical adapter method from `AGENT_ADAPTER_ARCHITECTURE.md` SS3-SS6 and SS11 | SS2 |

**Section 2 Total: 3**

---

## Section 3: Core Interfaces (SS3)

### 3.1 CrewAIAdapter Interface

| ID | Requirement | Source |
|---|---|---|
| CA-3.01 | `CrewAIAdapter` MUST extend `AgentAdapter` | SS3.1 |
| CA-3.02 | `adapterId` MUST be `readonly AdapterId` | SS3.1 |
| CA-3.03 | `agentFramework` MUST be literal `'crew_ai'` | SS3.1 |
| CA-3.04 | `version` MUST be `readonly string` | SS3.1 |
| CA-3.05 | `capabilities` MUST be `ReadonlySet<AgentCapability>` | SS3.1 |
| CA-3.06 | `initialize(client, governor, config)` MUST accept `LimenAgentClient`, `ComputerActionGovernor`, `CrewAIAdapterConfig` and return `Promise<Result<void>>` | SS3.1 |
| CA-3.07 | `shutdown()` MUST return `Promise<Result<void>>` | SS3.1 |
| CA-3.08 | `translateToolCall` MUST support overload: `(toolCall: AgentToolCall) => Promise<Result<LimenOperation[]>>` | SS3.1 |
| CA-3.09 | `translateToolCall` MUST support overload: `(toolCall: CrewAIToolCall) => Promise<Result<LimenOperation[]>>` | SS3.1 |
| CA-3.10 | `translateToolCall` MUST support overload: `(tool: string, args: Record<string, unknown>, context?: CrewAIToolContext) => Promise<Result<LimenOperation[]>>` | SS3.1 |
| CA-3.11 | `translateActionToGovernance(action: NativeAgentAction)` MUST return `Promise<Result<ComputerAction>>` | SS3.1 |
| CA-3.12 | `onAgentSessionStart(nativeSession: CrewAISessionStart)` MUST return `Promise<Result<AgentSession>>` | SS3.1 |
| CA-3.13 | `onAgentSessionEnd(nativeSession: CrewAISessionEnd)` MUST return `Promise<Result<SessionSummary>>` | SS3.1 |
| CA-3.14 | `mapNativeEvent(nativeEvent: CrewAIHookEvent)` MUST return `AgentEventPayload | null` | SS3.1 |
| CA-3.15 | `mapLimenEvent(limenEvent: AgentEventPayload)` MUST return `CrewAIHookEvent | null` | SS3.1 |
| CA-3.16 | `healthCheck()` MUST return `Promise<Result<AdapterHealth>>` | SS3.1 |
| CA-3.17 | `remember(ctx, content, options?)` MUST return `Promise<Result<ClaimId>>` | SS3.1 |
| CA-3.18 | `recall(ctx, query, options?)` MUST return `Promise<Result<RecallResult>>` | SS3.1 |
| CA-3.19 | `createBranch(ctx, baseBeliefId, description)` MUST return `Promise<Result<AgentBranchId>>` | SS3.1 |
| CA-3.20 | `mergeBranches(ctx, branchIds, strategy)` MUST return `Promise<Result<MergeResult>>` | SS3.1 |
| CA-3.21 | `resolveConflict(ctx, resolution)` MUST return `Promise<Result<MergeResult>>` | SS3.1 |
| CA-3.22 | `getHealth()` MUST return `AdapterHealth` (synchronous) | SS3.1 |
| CA-3.23 | `on(event, handler)` MUST return `string` (subscription ID) | SS3.1 |
| CA-3.24 | `off(subscriptionId)` MUST return `void` | SS3.1 |

### Claims on SS3.1 Methods

| ID | Requirement | Source |
|---|---|---|
| CA-3.25 | (Claim 1.1) `initialize` MUST complete successfully before any operation except `getHealth`, `on`, `off`, and no-op `shutdown`. Re-init with same config after READY returns `Result.ok(void)` with no side effects. Re-init after SHUTDOWN returns `NOT_INITIALIZED` | Claim 1.1 |
| CA-3.26 | (Claim 1.2) `shutdown` MUST be idempotent; calling on already-shut-down adapter returns `Result.ok(void)` | Claim 1.2 |
| CA-3.27 | (Claim 1.3) `shutdown` MUST close all active sessions, flush pending audit entries, and deregister from adapter registry before returning success | Claim 1.3 |
| CA-3.28 | (Claim 1.4) `remember` MUST enforce governance before token-budget admission and before persistence. If governance returns `refuse` or `escalate`, operation MUST fail with `GOVERNANCE_REFUSAL`, produce terminal audit entry, and create no claim | Claim 1.4 |
| CA-3.29 | (Claim 1.5) `recall` MUST filter results by explicit `OperationContext.clearanceLevel`. No claim above agent's clearance ever returned. Clearance MUST NOT be derived from ambient adapter state | Claim 1.5 |
| CA-3.30 | (Claim 1.6) `createBranch` MUST require `branching` capability (minimum trust: `medium`). Calls from agents below `medium` trust MUST fail with `GOVERNANCE_REFUSAL` | Claim 1.6 |
| CA-3.31 | (Claim 1.7) `mergeBranches` MUST follow deterministic multi-branch merge ordering per SHARED_TYPES SS23. Same inputs always produce same outputs | Claim 1.7 |
| CA-3.32 | (Claim 1.8) `getHealth` MUST be synchronous. MUST NOT block on I/O. Reports last-known health state | Claim 1.8 |
| CA-3.33 | (Claim 1.9) `translateToolCall` MUST accept CrewAI `tool_name` + `tool_input` hook payloads, translate known tools into canonical `LimenOperation[]`, and return `UNKNOWN_TOOL` with available operation names for undeclared/unregistered tools | Claim 1.9 |
| CA-3.34 | (Claim 1.10) `translateActionToGovernance` MUST populate every canonical `ComputerAction.ActionBase` field from `AgentSession`, `OperationContext`, and injected `TimeProvider`. Missing action-base data returns `SERDE_ERROR`; undeclared capabilities return `CAPABILITY_NOT_DECLARED` | Claim 1.10 |
| CA-3.35 | (Claim 1.11) Manual merge conflicts MUST be resolvable ONLY through `resolveConflict`. Pending manual merge MUST NOT complete through `mergeBranches` alone and MUST NOT be silently auto-accepted | Claim 1.11 |
| CA-3.36 | (Claim 1.12) `healthCheck()` MUST return current adapter health including connectivity to Limen Core, active session count, and governance state. Available in all lifecycle states except SHUTDOWN (returns `NOT_INITIALIZED`). Unlike `getHealth()` (synchronous, cached), `healthCheck()` performs live connectivity probe | Claim 1.12 |
| CA-3.37 | (Claim 1.13) `on()` and `off()` MUST be permitted in all lifecycle states except SHUTDOWN (throw `NOT_INITIALIZED`). Subscriptions registered via `on()` survive state transitions (UNINITIALIZED -> READY -> DEGRADED -> READY) but are cleared when `shutdown()` completes. `on()` returns unique subscription ID. `off()` with unknown/already-removed subscription ID is a no-op. No governance evaluation required for subscription management | Claim 1.13 |

### 3.2 CrewAIAdapterConfig

| ID | Requirement | Source |
|---|---|---|
| CA-3.38 | Config MUST have required fields: `agentId: AgentId`, `tenantId: TenantId | null`, `trustLevel: AgentTrustLevel`, `capabilities: ReadonlySet<AgentCapability>` | SS3.2 |
| CA-3.39 | Config MUST have CrewAI-specific fields: `crewId: string`, `agentRole: string`, `processType: 'sequential' | 'hierarchical'`, `delegationDepthMax: number` | SS3.2 |
| CA-3.40 | Config MUST have governance fields: `defaultClassification: ClassificationLevel`, `governed?: true`, `rateLimits: readonly RateLimitPolicy[]`, `sandboxDefaults: AdapterSandboxDefaults`, `refusalHints: readonly AdapterRefusalHint[]` | SS3.2 |
| CA-3.41 | Config MUST have budget field: `tokenBudget: TokenBudgetConfig` | SS3.2 |
| CA-3.42 | Config MUST have connection fields: `coreEndpoint: string`, `connectionTimeoutMs: number`, `retryPolicy: RetryPolicy` | SS3.2 |
| CA-3.43 | Config MUST have metadata field: `metadata: Readonly<Record<string, unknown>>` | SS3.2 |
| CA-3.44 | (Claim 2.1) `governed` defaults to `true` and is non-optional in effect. Setting `governed: false` is invalid for ALL callers including `verified` agents and `governance_admin`; `initialize` MUST reject with `GOVERNANCE_REFUSAL` and `rule: "governance_non_optional"` | Claim 2.1 |
| CA-3.45 | (Claim 2.2) `connectionTimeoutMs` MUST be within [1000, 30000]. Values outside range MUST be rejected at initialization with `SERDE_ERROR`; adapter MUST NOT clamp silently | Claim 2.2 |
| CA-3.46 | (Claim 2.10) Config identity determined by SHA-256 hash of canonical JSON serialization (keys sorted recursively, no whitespace, `Set` values sorted lexicographically, `null` preserved). Used for idempotent `initialize()` check and recorded in initialization audit entries. Identical digests = identical configs; differing digests trigger `ALREADY_INITIALIZED` | Claim 2.10 |
| CA-3.47 | (Claim 2.7) `rateLimits` are additive to `DEFAULT_RATE_LIMITS`. Empty adapter-specific limits still inherit defaults. Any config that weakens, disables, replaces, or locally resets default rate counters MUST be rejected at initialization with `GOVERNANCE_REFUSAL` | Claim 2.7 |
| CA-3.48 | (Claim 2.13) `delegationDepthMax` MUST be in range [0, 10]. `0` disables delegation entirely. Values above 10 MUST be rejected at initialization with `INVALID_CONFIG` (mapped to `SERDE_ERROR`). Adapter MUST NOT silently clamp | Claim 2.13 |

### 3.2.1 CrewAI Hook and Tool Types

| ID | Requirement | Source |
|---|---|---|
| CA-3.49 | `CrewAIToolCall` MUST extend `AgentToolCall` with inherited fields: `toolName`, `toolArgs`, `callId`, `agentFramework`, `rawPayload` | SS3.2.1 |
| CA-3.50 | `CrewAIToolCall.agentFramework` MUST be literal `'crew_ai'` | SS3.2.1 |
| CA-3.51 | `CrewAIToolCall.tool` MUST be alias for `toolName` (invariant: `this.tool === this.toolName`) | SS3.2.1 |
| CA-3.52 | `CrewAIToolCall.args` MUST be alias for `toolArgs` (invariant: `this.args === this.toolArgs`) | SS3.2.1 |
| CA-3.53 | `CrewAIToolCall.context` MUST be `CrewAIToolContext` | SS3.2.1 |
| CA-3.54 | `CrewAIToolContext` MUST contain: `crewId: string`, `agentRole: string`, `taskId: TaskId | null`, `delegationDepth: number`, `processType: 'sequential' | 'hierarchical'`, `hookPhase: 'before_tool_call' | 'after_tool_call'`, `rawHookContextDigest: ActionDigest` | SS3.2.1 |
| CA-3.55 | `CrewAIHookEvent` MUST be discriminated union: `{ type: 'before_tool_call', context }` or `{ type: 'after_tool_call', context }` | SS3.2.1 |
| CA-3.56 | `CrewAISessionStart` MUST contain: `crewId`, `agentRole`, `processType`, optional `taskId`, `metadata` | SS3.2.1 |
| CA-3.57 | `CrewAISessionEnd` MUST contain: `sessionId: SessionId`, `crewId`, `outcome: 'completed' | 'failed' | 'cancelled' | 'timeout'`, `metadata` | SS3.2.1 |
| CA-3.58 | (Claim 2.11) Sessions exceeding `maxDurationMs` (if configured in session metadata) MUST end with outcome `'timeout'`. Adapter MUST produce `SessionSummary` with timeout outcome and audit entry recording timeout trigger. Timeout-ended sessions follow same cleanup path as `'cancelled'` | Claim 2.11 |
| CA-3.59 | (Claim 2.8) CrewAI native hook payloads MUST be normalized from `tool_name` and `tool_input`. Adapter MUST NOT infer tool from `agent.role`, `task.description`, or arbitrary `{ tool, args }` fields unless produced by normalization layer | Claim 2.8 |

### 3.3 RememberOptions

| ID | Requirement | Source |
|---|---|---|
| CA-3.60 | `RememberOptions` MUST extend `AgentMemoryOptions` with optional `crewContext?: CrewContext` | SS3.3 |
| CA-3.61 | `CrewContext` MUST contain: `crewId: string`, `agentRole: string`, `taskId: TaskId | null`, `delegationDepth: number` | SS3.3 |
| CA-3.62 | (Claim 2.3) When `crewContext` is omitted from `RememberOptions`, adapter MUST populate it from active session's metadata. Crew context MUST always be present in persisted claim's metadata for audit traceability | Claim 2.3 |

### 3.4 RecallResult

| ID | Requirement | Source |
|---|---|---|
| CA-3.63 | `RecallResult` MUST contain: `beliefs: readonly BeliefState[]`, `totalCount: number`, `truncated: boolean`, `tokenEstimate: TokenEstimate` | SS3.4 |
| CA-3.64 | (Claim 2.4) `truncated` MUST be `true` when `totalCount` exceeds returned `beliefs.length`. Adapter MUST NOT silently drop results without signaling truncation | Claim 2.4 |

### 3.5 MergeResult

| ID | Requirement | Source |
|---|---|---|
| CA-3.65 | `MergeResult` MUST contain: `status: 'completed' | 'pending_resolution' | 'failed'`, `mergedClaimIds`, `conflictsResolved`, `unresolvedConflicts`, `manualMergeState` (non-null for manual), `auditId: EventId` | SS3.5 |
| CA-3.66 | `MergeConflictRecord` MUST contain: `conflictId`, `resolution: ManualMergeResolution`, `winningClaimId: ClaimId` | SS3.5 |
| CA-3.67 | `ManualMergeResolutionRequest` MUST contain: `mergeId`, `conflictId`, `resolution`, optional `newValue` (required for `merge_new_value`), optional `newConfidence` (required for `merge_new_value`) | SS3.5 |
| CA-3.68 | (Claim 2.5) When strategy is `manual` and conflicts exist, `status` MUST be `'pending_resolution'` and `manualMergeState` MUST be non-null. Merge MUST NOT complete until all conflicts resolved | Claim 2.5 |
| CA-3.69 | (Claim 2.9) `resolveConflict` MUST reject: unknown `mergeId`, expired manual merge state, already-resolved conflict IDs, and `merge_new_value` requests missing `newValue` or `newConfidence` | Claim 2.9 |

### 3.6 TokenBudgetConfig

| ID | Requirement | Source |
|---|---|---|
| CA-3.70 | `TokenBudgetConfig` MUST contain: `maxTokensPerOperation: number`, `maxTokensPerSession: number`, `encoding: TokenEncoding`, `warningThresholdPct: number` (0-100), optional `replenishmentWindowSeconds: number | null` | SS3.6 |
| CA-3.71 | (Claim 2.12) `warningThresholdPct` MUST be in [0, 100]. Values outside MUST be rejected at initialization with `INVALID_CONFIG` (mapped to `SERDE_ERROR`). Adapter MUST NOT silently clamp | Claim 2.12 |

### 3.7 RetryPolicy

| ID | Requirement | Source |
|---|---|---|
| CA-3.72 | `RetryPolicy` MUST contain: `maxRetries: number` (0 = no retries), `baseDelayMs`, `maxDelayMs`, `backoffMultiplier`, `retryableErrors: readonly CrewAIAdapterErrorCode[]` | SS3.7 |
| CA-3.73 | (Claim 2.6) Only errors listed in `retryableErrors` are retried. `GOVERNANCE_REFUSAL` and `NOT_INITIALIZED` are NEVER retryable regardless of configuration | Claim 2.6 |

### 3.8 AdapterHealth

| ID | Requirement | Source |
|---|---|---|
| CA-3.74 | `AdapterHealth` MUST contain: `status: 'healthy' | 'degraded' | 'unhealthy'`, `lifecycleState`, `lastActivity: string | null` (ISO-8601), `activeSessions`, `errorCount`, `uptimeMs`, `corePortConnected`, `tokenBudgetRemaining`, `tokenBudgetTotal`, optional `lastError`, optional `details` | SS3.8 |

**Section 3 Total: 74**

---

## Section 4: Rust Trait Equivalent (SS4)

| ID | Requirement | Source |
|---|---|---|
| CA-4.01 | Rust trait `CrewAIAdapter` MUST extend `AgentAdapter + Send + Sync + 'static` | SS4 |
| CA-4.02 | Rust `adapter_id()` MUST return `&AdapterId` | SS4 |
| CA-4.03 | Rust `agent_framework()` MUST default to `AgentFramework::CrewAI` | SS4 |
| CA-4.04 | Rust `initialize` MUST accept `LimenAgentClient`, `ComputerActionGovernor`, `CrewAIAdapterConfig` and return `Result<(), CrewAIAdapterError>` | SS4 |
| CA-4.05 | Rust `shutdown` MUST return `Result<(), CrewAIAdapterError>` | SS4 |
| CA-4.06 | Rust `remember` MUST accept `OperationContext`, `MemoryContent`, `Option<RememberOptions>` and return `Result<ClaimId, CrewAIAdapterError>` | SS4 |
| CA-4.07 | Rust `recall` MUST accept `OperationContext`, `&AgentRecallQuery`, `Option<&AgentRecallOptions>` and return `Result<RecallResult, CrewAIAdapterError>` | SS4 |
| CA-4.08 | Rust `create_branch` MUST return `Result<AgentBranchId, CrewAIAdapterError>` | SS4 |
| CA-4.09 | Rust `merge_branches` MUST accept `&[AgentBranchId]` and `MergeStrategy` and return `Result<MergeResult, CrewAIAdapterError>` | SS4 |
| CA-4.10 | Rust `resolve_conflict` MUST return `Result<MergeResult, CrewAIAdapterError>` | SS4 |
| CA-4.11 | Rust `translate_tool_call` MUST accept `CrewAIToolCall` and return `Result<Vec<LimenOperation>, CrewAIAdapterError>` | SS4 |
| CA-4.12 | Rust `translate_action_to_governance` MUST return `Result<ComputerAction, CrewAIAdapterError>` | SS4 |
| CA-4.13 | Rust `on_agent_session_start` MUST return `Result<AgentSession, CrewAIAdapterError>` | SS4 |
| CA-4.14 | Rust `on_agent_session_end` MUST return `Result<SessionSummary, CrewAIAdapterError>` | SS4 |
| CA-4.15 | Rust `map_native_event` MUST return `Option<AgentEventPayload>` | SS4 |
| CA-4.16 | Rust `map_limen_event` MUST return `Option<CrewAIHookEvent>` | SS4 |
| CA-4.17 | Rust `health_check` MUST return `Result<AdapterHealth, CrewAIAdapterError>` | SS4 |
| CA-4.18 | Rust `get_health` MUST return `AdapterHealth` (synchronous) | SS4 |
| CA-4.19 | Rust `on` MUST return `Result<String, CrewAIAdapterError>` | SS4 |
| CA-4.20 | Rust `off` MUST return `Result<(), CrewAIAdapterError>` | SS4 |
| CA-4.21 | Rust `CrewAIAdapterConfig` MUST have all fields matching TypeScript config: `agent_id`, `tenant_id`, `trust_level`, `capabilities`, `crew_id`, `agent_role`, `process_type`, `delegation_depth_max`, `default_classification`, `governed`, `rate_limits`, `sandbox_defaults`, `refusal_hints`, `token_budget`, `core_endpoint`, `connection_timeout_ms`, `retry_policy`, `metadata` | SS4 |
| CA-4.22 | Rust `CrewProcessType` enum MUST have values: `Sequential`, `Hierarchical` with `snake_case` serde | SS4 |
| CA-4.23 | Rust `TokenBudgetConfig` MUST have: `max_tokens_per_operation: u64`, `max_tokens_per_session: u64`, `encoding: TokenEncoding`, `warning_threshold_pct: u8` (validated [0,100]), `replenishment_window_seconds: Option<u64>` | SS4 |
| CA-4.24 | Rust `RetryPolicy` MUST have: `max_retries: u32`, `base_delay_ms: u64`, `max_delay_ms: u64`, `backoff_multiplier: f64`, `retryable_errors: Vec<CrewAIAdapterErrorCode>` | SS4 |
| CA-4.25 | Rust `CrewAIToolCall` MUST have: `tool_name`, `tool_args`, `call_id`, `agent_framework`, `raw_payload`, `tool` (alias, invariant: `self.tool == self.tool_name`), `args` (alias, invariant: `self.args == self.tool_args`), `context: CrewAIToolContext` | SS4 |
| CA-4.26 | Rust `CrewAIToolContext` MUST have: `crew_id`, `agent_role`, `task_id: Option<TaskId>`, `delegation_depth: u32`, `process_type`, `hook_phase`, `raw_hook_context_digest: ActionDigest` | SS4 |
| CA-4.27 | Rust `CrewAIHookPhase` enum: `BeforeToolCall`, `AfterToolCall` with `snake_case` serde | SS4 |
| CA-4.28 | Rust `CrewAIHookEvent` enum: `BeforeToolCall { context }`, `AfterToolCall { context }` | SS4 |
| CA-4.29 | Rust `CrewAIToolCallHookContext` MUST have: `tool_name`, `tool_input: serde_json::Value`, `tool_result: Option<String>` | SS4 |
| CA-4.30 | Rust `CrewAISessionStart` MUST have: `crew_id`, `agent_role`, `process_type`, `task_id: Option<TaskId>`, `metadata: serde_json::Value` | SS4 |
| CA-4.31 | Rust `CrewAISessionEnd` MUST have: `session_id: SessionId`, `crew_id`, `outcome: CrewAISessionOutcome`, `metadata: serde_json::Value` | SS4 |
| CA-4.32 | Rust `CrewAISessionOutcome` enum: `Completed`, `Failed`, `Cancelled`, `Timeout` with `snake_case` serde | SS4 |
| CA-4.33 | Rust `RecallResult` MUST have: `beliefs: Vec<BeliefState>`, `total_count: u64`, `truncated: bool`, `token_estimate: TokenEstimate` | SS4 |
| CA-4.34 | Rust `MergeResult` MUST have: `status: MergeResultStatus`, `merged_claim_ids`, `conflicts_resolved`, `unresolved_conflicts`, `manual_merge_state: Option<ManualMergeState>`, `audit_id: EventId` | SS4 |
| CA-4.35 | Rust `MergeResultStatus` enum: `Completed`, `PendingResolution`, `Failed` with `snake_case` serde | SS4 |
| CA-4.36 | Rust `ManualMergeResolutionRequest` MUST have: `merge_id`, `conflict_id`, `resolution`, `new_value: Option<String>`, `new_confidence: Option<f64>` | SS4 |
| CA-4.37 | Rust `CrewAIAdapterError` enum MUST have 18 variants: `CorePortUnavailable`, `TimeProviderUnavailable`, `BudgetExceeded`, `NotInitialized`, `AlreadyInitialized`, `AuditFailure`, `GovernanceRefusal`, `UnknownTool`, `SerdeError`, `BranchConflict`, `ShutdownFailed`, `SessionNotFound`, `TrustLevelInsufficient`, `CapabilityNotDeclared`, `TranslationFailed`, `MaxSessionsExceeded`, `ClientError`, `Internal` | SS4 |
| CA-4.38 | Rust `CrewAIAdapterErrorCode` enum MUST have 18 values matching error variant names with `snake_case` serde | SS4 |
| CA-4.39 | Rust `AdapterLifecycleState` enum: `Uninitialized`, `Initializing`, `Ready`, `Degraded`, `Shutdown` with `snake_case` serde | SS4 |
| CA-4.40 | Rust `AdapterHealthStatus` enum: `Healthy`, `Degraded`, `Unhealthy` with `snake_case` serde | SS4 |
| CA-4.41 | Rust `AdapterHealth` MUST have all fields matching TypeScript `AdapterHealth` type | SS4 |
| CA-4.42 | `CrewAIAdapterError::GovernanceRefusal` MUST include: `action`, `reason`, `rule`, `verdict: GovernanceVerdict`, `alternatives: Vec<String>` | SS4 |
| CA-4.43 | `CrewAIAdapterError::BudgetExceeded` MUST include: `remaining`, `required`, `retryable: bool`, `retry_after_seconds: Option<u64>` | SS4 |
| CA-4.44 | `CrewAIAdapterError::UnknownTool` MUST include: `tool`, `available_operations: Vec<String>` | SS4 |
| CA-4.45 | `CrewAIAdapterError` `retryable` field is CrewAI-specific extension not present in parent `AdapterKernelError` | SS4 note |
| CA-4.46 | Rust trait MUST expose `fn version(&self) -> &str` accessor method | SS4 |
| CA-4.47 | Rust trait MUST expose `fn capabilities(&self) -> &HashSet<AgentCapability>` accessor method | SS4 |
| CA-4.48 | `CrewAIAdapterError::CorePortUnavailable` MUST include: `endpoint: String`, `reason: String` | SS4 |
| CA-4.49 | `CrewAIAdapterError::AuditFailure` MUST include: `operation: String`, `reason: String` | SS4 |
| CA-4.50 | `CrewAIAdapterError::SerdeError` MUST include: `detail: String` | SS4 |
| CA-4.51 | `CrewAIAdapterError::BranchConflict` MUST include: `branch_ids: Vec<String>`, `reason: String` | SS4 |
| CA-4.52 | `CrewAIAdapterError::ShutdownFailed` MUST include: `reason: String` | SS4 |
| CA-4.53 | `CrewAIAdapterError::SessionNotFound` MUST include: `session_id: String` | SS4 |
| CA-4.54 | `CrewAIAdapterError::TrustLevelInsufficient` MUST include: `required: AgentTrustLevel`, `actual: AgentTrustLevel` | SS4 |
| CA-4.55 | `CrewAIAdapterError::CapabilityNotDeclared` MUST include: `capability: AgentCapability` | SS4 |
| CA-4.56 | `CrewAIAdapterError::TranslationFailed` MUST include: `tool: String`, `detail: String` | SS4 |
| CA-4.57 | `CrewAIAdapterError::MaxSessionsExceeded` MUST include: `current: u32`, `max: u32` | SS4 |
| CA-4.58 | `CrewAIAdapterError::ClientError` MUST include: `source: String`, `message: String` | SS4 |
| CA-4.59 | `CrewAIAdapterError::Internal` MUST include: `message: String` | SS4 |

**Section 4 Total: 59**

---

## Section 5: Governance Enforcement (SS5)

### 5.1 Authorization-First Ordering

| ID | Requirement | Source |
|---|---|---|
| CA-5.01 | Step 1: Validate adapter has completed initialization and is not SHUTDOWN (else `NOT_INITIALIZED`). `CORE_PORT_UNAVAILABLE` MUST NOT be returned before authorization check (step 5) | SS5.1 |
| CA-5.02 | Step 2: Validate `TimeProvider` availability for governance and audit timestamps (else `TIME_PROVIDER_UNAVAILABLE`) | SS5.1 |
| CA-5.03 | Step 3: Normalize CrewAI payload enough to identify requested action, session, agent, crew, and tool name | SS5.1 |
| CA-5.04 | Step 4: Build `GovernanceContext` from explicit `OperationContext` + active `AgentSession` | SS5.1 |
| CA-5.05 | Step 5: Evaluate governance gate (agent state, refusal rules, trust level, capabilities, rate limits, classification) | SS5.1 |
| CA-5.06 | Step 6: If verdict is `refuse`: append terminal audit entry, emit `governance:refused`, return `GOVERNANCE_REFUSAL` | SS5.1 |
| CA-5.07 | Step 7: If verdict is `escalate`: append terminal audit entry, emit `governance:escalated`, return `GOVERNANCE_REFUSAL` with escalation metadata | SS5.1 |
| CA-5.08 | Step 8: If verdict is `sandbox`: bind `SandboxConfig` constraints before any execution | SS5.1 |
| CA-5.09 | Step 9: Validate declared capability and tool registration (else `CAPABILITY_NOT_DECLARED` or `UNKNOWN_TOOL`) | SS5.1 |
| CA-5.10 | Step 10: Estimate and check token budget (else append failure audit and return `BUDGET_EXCEEDED`) | SS5.1 |
| CA-5.11 | Step 11: If operation requires Limen Core and core port is unavailable, append failure audit and return `CORE_PORT_UNAVAILABLE` | SS5.1 |
| CA-5.12 | Step 12: Append durable pre-operation audit entry | SS5.1 |
| CA-5.13 | Step 13: Execute operation against Limen Core | SS5.1 |
| CA-5.14 | Step 14: Append durable post-operation audit entry | SS5.1 |
| CA-5.15 | Step 15: Emit `AgentEventPayload` via `AgentEventBus` | SS5.1 |
| CA-5.16 | Step 16: Return result | SS5.1 |
| CA-5.17 | (Claim 3.1) No mutating operation may return success without durable audit entry existing for it. If audit recording fails, operation MUST fail with `AUDIT_FAILURE` even if underlying operation succeeded | Claim 3.1 |
| CA-5.18 | (Claim 3.2) Governance gate MUST evaluate in <10ms per `PerformanceBudget.governanceCheck`. Audit append is separate budget (<50ms) | Claim 3.2 |

### 5.2 Governance Is Non-Optional

| ID | Requirement | Source |
|---|---|---|
| CA-5.19 | Adapter has NO ungoverned execution mode. `config.governed` exists only for backward-compatible config parsing | SS5.2 |
| CA-5.20 | `remember` governance action: `{ domain: 'memory', operation: 'write' }`, requires `memory_write` capability, minimum trust `low` | SS5.2 |
| CA-5.21 | `recall` governance action: `{ domain: 'memory', operation: 'read' }`, requires `memory_read` (implicit), minimum trust `untrusted` | SS5.2 |
| CA-5.22 | `createBranch` governance action: `{ domain: 'memory', operation: 'branch' }`, requires `branching`, minimum trust `medium` | SS5.2 |
| CA-5.23 | `mergeBranches` governance action: `{ domain: 'memory', operation: 'merge' }`, requires `branching`, minimum trust `medium` | SS5.2 |
| CA-5.24 | Delegation event governance action: `{ domain: 'execution', operation: 'delegate' }`, requires `mission_delegation`, minimum trust `high` | SS5.2 |
| CA-5.25 | `translateToolCall` governance action: `{ domain: 'execution', operation: 'tool_call' }`, capability mapped per tool registry | SS5.2 |
| CA-5.26 | `translateActionToGovernance` governance action: canonical `ComputerAction` domain/action, mapped per `ComputerAction` | SS5.2 |
| CA-5.27 | `resolveConflict` governance action: `{ domain: 'memory', operation: 'resolve_merge_conflict' }`, requires `branching`, minimum trust `medium` | SS5.2 |
| CA-5.28 | `mapNativeEvent` and `mapLimenEvent` require NO governance evaluation (N/A) | SS5.2 |
| CA-5.29 | (Claim 3.8) `mapNativeEvent` and `mapLimenEvent` are pure data transformations with no side effects. No events emitted, no Limen Core writes, no governance evaluation, no audit entry. Synchronous. Return `null` when no mapping exists | Claim 3.8 |
| CA-5.30 | (Claim 3.3) EVERY side-effecting operation MUST pass through governance gate. No `governed:false`, verified-admin, test, degraded, retry, or shutdown-drain path bypasses governance | Claim 3.3 |

### 5.3 GovernanceRefusal Error

| ID | Requirement | Source |
|---|---|---|
| CA-5.31 | `GovernanceRefusal` MUST contain: `code: 'GOVERNANCE_REFUSAL'`, `action`, `reason`, `rule` (which RefusalRule triggered), `verdict: GovernanceVerdict`, optional `alternatives` | SS5.3 |
| CA-5.32 | (Claim 3.4) Every `GOVERNANCE_REFUSAL` MUST include `rule` field identifying which specific refusal rule blocked. `verdict` carries full `GovernanceVerdict` for caller inspection | Claim 3.4 |

### 5.4 Validity State Matrix

| ID | Requirement | Source |
|---|---|---|
| CA-5.33 | `untrusted` + `active`: `remember` REFUSED, `recall` OK, `createBranch` REFUSED, `mergeBranches` REFUSED | SS5.4 |
| CA-5.34 | `low` + `active`: `remember` OK (conf cap 0.3), `recall` OK, `createBranch` REFUSED, `mergeBranches` REFUSED | SS5.4 |
| CA-5.35 | `medium` + `active`: `remember` OK (conf cap 0.7), `recall` OK, `createBranch` OK, `mergeBranches` OK | SS5.4 |
| CA-5.36 | `high` + `active`: `remember` OK (conf cap 0.85), `recall` OK, `createBranch` OK, `mergeBranches` OK | SS5.4 |
| CA-5.37 | `verified` + `active`: `remember` OK (conf cap 1.0), `recall` OK, `createBranch` OK, `mergeBranches` OK | SS5.4 |
| CA-5.38 | Any trust + `governed: false`: ALL operations INIT REFUSED | SS5.4 |
| CA-5.39 | `suspended` agent: ALL operations REFUSED | SS5.4 |
| CA-5.40 | `decommissioned` agent: ALL operations REFUSED | SS5.4 |
| CA-5.41 | (Claim 3.5) Confidence caps enforced per trust level: `low`=0.3, `medium`=0.7, `high`=0.85, `verified`=1.0. A `remember` with `confidence: 0.9` from `medium` trust silently caps to `0.7`. Returned `ClaimId` references claim with `confidence: 0.7` | Claim 3.5 |
| CA-5.42 | (Claim 3.6) All operations on `suspended` or `decommissioned` agent return `GOVERNANCE_REFUSAL` with reason `"agent_state_not_active"`. This check MUST precede all other governance evaluation | Claim 3.6 |
| CA-5.43 | (Claim 3.7) `memory_read` capability is implicitly granted at all trust levels including `untrusted`. Declaring it in config is permitted for audit but does not gate access. `recall` succeeds for any active agent regardless of `memory_read` in capability set. Governance gate still evaluates (agent state, rate limits, classification) but capability presence not checked for `recall`. This is the ONLY implicitly granted capability | Claim 3.7 |

**Section 5 Total: 43**

---

## Section 6: Error Taxonomy (SS6)

### 6.1 Error Codes

| ID | Requirement | Source |
|---|---|---|
| CA-6.01 | `CrewAIAdapterErrorCode` MUST be union of 18 literal types: `NOT_INITIALIZED`, `ALREADY_INITIALIZED`, `TIME_PROVIDER_UNAVAILABLE`, `GOVERNANCE_REFUSAL`, `TRUST_LEVEL_INSUFFICIENT`, `CAPABILITY_NOT_DECLARED`, `UNKNOWN_TOOL`, `BUDGET_EXCEEDED`, `CORE_PORT_UNAVAILABLE`, `AUDIT_FAILURE`, `SERDE_ERROR`, `BRANCH_CONFLICT`, `SESSION_NOT_FOUND`, `SHUTDOWN_FAILED`, `TRANSLATION_FAILED`, `MAX_SESSIONS_EXCEEDED`, `CLIENT_ERROR`, `INTERNAL` | SS6.1 |
| CA-6.02 | `CrewAIAdapterError` MUST contain: `code`, `message`, `adapterId: AdapterId`, `retryable: boolean`, optional `context` | SS6.1 |

### 6.2 Error Precedence

| ID | Requirement | Source |
|---|---|---|
| CA-6.03 | Precedence 1 (highest): `NOT_INITIALIZED` -- applies to all operations | SS6.2 |
| CA-6.04 | Precedence 2: `ALREADY_INITIALIZED` -- applies to `initialize()` only | SS6.2 |
| CA-6.05 | Precedence 3: `TIME_PROVIDER_UNAVAILABLE` -- all operations except `getHealth`, `shutdown` | SS6.2 |
| CA-6.06 | Precedence 4: `SERDE_ERROR` -- `translateToolCall`, `translateActionToGovernance`, `initialize` | SS6.2 |
| CA-6.07 | Precedence 5: `GOVERNANCE_REFUSAL` -- all side-effecting operations (lifecycle-state and governance-rule violations) | SS6.2 |
| CA-6.08 | Precedence 6: `TRUST_LEVEL_INSUFFICIENT` -- `remember`, `createBranch`, `mergeBranches`, `resolveConflict`, delegation. Agent is active and governance-compliant but lacks trust level | SS6.2 |
| CA-6.09 | Precedence 7: `CAPABILITY_NOT_DECLARED` -- `translateToolCall`, `translateActionToGovernance`, delegation | SS6.2 |
| CA-6.10 | Precedence 8: `UNKNOWN_TOOL` -- `translateToolCall` | SS6.2 |
| CA-6.11 | Precedence 9: `TRANSLATION_FAILED` -- `translateToolCall`, `translateActionToGovernance` | SS6.2 |
| CA-6.12 | Precedence 10: `MAX_SESSIONS_EXCEEDED` -- `onAgentSessionStart` | SS6.2 |
| CA-6.13 | Precedence 11: `BUDGET_EXCEEDED` -- `remember`, `recall`, `createBranch`, `mergeBranches`, `resolveConflict` | SS6.2 |
| CA-6.14 | Precedence 12: `CORE_PORT_UNAVAILABLE` -- all operations requiring Limen Core | SS6.2 |
| CA-6.15 | Precedence 13: `AUDIT_FAILURE` -- all audited operations | SS6.2 |
| CA-6.16 | Precedence 14: `BRANCH_CONFLICT` -- `mergeBranches` | SS6.2 |
| CA-6.17 | Precedence 15: `SESSION_NOT_FOUND` -- `onAgentSessionEnd`, operations requiring session context | SS6.2 |
| CA-6.18 | Precedence 16: `SHUTDOWN_FAILED` -- `shutdown()` only | SS6.2 |
| CA-6.19 | Precedence 17: `CLIENT_ERROR` -- `remember`, `recall`, `createBranch`, `mergeBranches`, `resolveConflict` | SS6.2 |
| CA-6.20 | Precedence 18 (lowest): `INTERNAL` -- all operations | SS6.2 |
| CA-6.21 | (Claim 4.1) Error precedence is deterministic. Given simultaneous `GOVERNANCE_REFUSAL`, `BUDGET_EXCEEDED`, and `CORE_PORT_UNAVAILABLE`, adapter MUST return `GOVERNANCE_REFUSAL` | Claim 4.1 |
| CA-6.22 | (Claim 4.2) `GOVERNANCE_REFUSAL` is NEVER retryable. Same operation + same context = same refusal | Claim 4.2 |
| CA-6.23 | (Claim 4.3) `NOT_INITIALIZED` is NEVER retryable. Caller must call `initialize` first | Claim 4.3 |
| CA-6.24 | (Claim 4.4) `BUDGET_EXCEEDED` retryable ONLY when `TokenBudgetConfig.replenishmentWindowSeconds` is non-null. Error includes `remaining`, `required`, and `retryAfterSeconds` when retryable; otherwise `retryable: false` | Claim 4.4 |
| CA-6.25 | (Claim 4.5) `CORE_PORT_UNAVAILABLE` retryable subject to `RetryPolicy`. Adapter transitions to `DEGRADED` and attempts automatic reconnection | Claim 4.5 |
| CA-6.26 | (Claim 4.6) `UNKNOWN_TOOL` is never retryable unless adapter registry changes. Includes `tool` and `availableOperations` in context | Claim 4.6 |
| CA-6.27 | (Claim 4.7) Config values outside accepted ranges MUST be rejected with typed errors. Adapter MUST NOT silently clamp `connectionTimeoutMs`, `delegationDepthMax`, token budgets, retry limits, or warning thresholds | Claim 4.7 |

### 6.3 Error-to-Event Mapping

| ID | Requirement | Source |
|---|---|---|
| CA-6.28 | `GOVERNANCE_REFUSAL` MUST emit `governance:refused` | SS6.3 |
| CA-6.29 | `BUDGET_EXCEEDED` MUST emit `budget:exhausted` | SS6.3 |
| CA-6.30 | `AUDIT_FAILURE` MUST emit `hook:failed` | SS6.3 |
| CA-6.31 | `CORE_PORT_UNAVAILABLE` MUST emit `cognitive:health_degraded` | SS6.3 |
| CA-6.32 | `UNKNOWN_TOOL` MUST emit `hook:blocked` | SS6.3 |
| CA-6.33 | `CAPABILITY_NOT_DECLARED` MUST emit `hook:blocked` | SS6.3 |
| CA-6.34 | `TRANSLATION_FAILED` MUST emit `hook:blocked` | SS6.3 |
| CA-6.35 | `MAX_SESSIONS_EXCEEDED` MUST emit `session:rejected` | SS6.3 |
| CA-6.36 | All other errors: logged via adapter-internal telemetry; no AgentEvent emitted | SS6.3 |

**Section 6 Total: 36**

---

## Section 7: Token Budget Enforcement (SS7)

### 7.1 TokenEstimator Integration

| ID | Requirement | Source |
|---|---|---|
| CA-7.01 | Adapter MUST maintain `TokenBudgetState` with fields: `totalBudget`, `maxTokensPerOperation`, `consumed`, `remaining`, `lastOperationEstimate`, `encoding`, `warningEmitted` | SS7.1 |

### 7.2 Pre-Operation Budget Check

| ID | Requirement | Source |
|---|---|---|
| CA-7.02 | Step 1: Estimate token cost using `TokenEstimator.estimate()` | SS7.2 |
| CA-7.03 | Step 2: Reject if `estimate.overflow === true` | SS7.2 |
| CA-7.04 | Step 3: Reject if `estimate.tokens > maxTokensPerOperation` | SS7.2 |
| CA-7.05 | Step 4: Reject if `estimate.tokens > remaining` | SS7.2 |
| CA-7.06 | Step 5: Append failure audit entry before returning `BUDGET_EXCEEDED` | SS7.2 |
| CA-7.07 | Step 6: Record successful token consumption with checked arithmetic ONLY after operation is admitted | SS7.2 |
| CA-7.08 | Step 7: If budget consumed exceeds `warningThresholdPct`, emit `budget:exhausted` event (once per session) | SS7.2 |
| CA-7.09 | (Claim 5.1) Governance evaluation happens BEFORE token budget admission. Budget-exceeded operation has already been authorized/sandboxed and receives failure audit entry before returning `BUDGET_EXCEEDED` | Claim 5.1 |
| CA-7.10 | (Claim 5.2) Token consumption tracked per-operation and cumulatively per-session. `getHealth().tokenBudgetRemaining` exposes remaining session budget. `getHealth().details.lastOperationEstimate` exposes last per-operation estimate | Claim 5.2 |
| CA-7.11 | (Claim 5.3) `remember` estimates tokens for: content serialization + audit entry + governance context. `recall` estimates tokens for: query serialization + estimated response size (using `limit` parameter as upper bound) | Claim 5.3 |

### 7.3 Budget Tracking per Operation

| ID | Requirement | Source |
|---|---|---|
| CA-7.12 | `remember` token cost: Content + metadata + audit entry + governance context | SS7.3 |
| CA-7.13 | `recall` token cost: Query + response (limit * avg_belief_size) + audit entry | SS7.3 |
| CA-7.14 | `createBranch` token cost: Branch metadata + audit entry | SS7.3 |
| CA-7.15 | `mergeBranches` token cost: Per-branch conflict resolution + merged claims + audit entries | SS7.3 |
| CA-7.16 | `resolveConflict` token cost: Resolution payload + pending merge state + audit entry | SS7.3 |
| CA-7.17 | `translateToolCall` token cost: Native hook context digest + canonical operation payloads | SS7.3 |
| CA-7.18 | `translateActionToGovernance` token cost: Native action payload + canonical ComputerAction payload | SS7.3 |
| CA-7.19 | `shutdown` token cost: Session summary + final audit entries | SS7.3 |

**Section 7 Total: 19**

---

## Section 8: Audit & Provenance (SS8)

### 8.1 Audit-Before-Success Invariant

| ID | Requirement | Source |
|---|---|---|
| CA-8.01 | (Claim 6.1) No operation returns successful `Result` without durable audit entry existing for that operation | Claim 6.1 |
| CA-8.02 | (Claim 6.2) If audit recording fails (disk error, connection loss, serialization failure), operation MUST return `AUDIT_FAILURE` even if underlying Limen Core operation succeeded. Caller must treat operation as failed | Claim 6.2 |

### 8.2 Audit Entry Structure

| ID | Requirement | Source |
|---|---|---|
| CA-8.03 | Every adapter operation MUST produce `AuditLogEntry` (SHARED_TYPES SS10.3) with `CrewAIAuditDetails` in details field | SS8.2 |
| CA-8.04 | `CrewAIAuditDetails.operationType` MUST be one of: `remember`, `recall`, `createBranch`, `mergeBranches`, `resolveConflict`, `translateToolCall`, `translateActionToGovernance`, `onAgentSessionStart`, `onAgentSessionEnd`, `initialize`, `shutdown`, `healthCheck` | SS8.2 |
| CA-8.05 | `CrewAIAuditDetails` MUST contain: `crewId: string`, `agentRole: string`, `delegationDepth: number`, `tokenCost: number`, `governanceState`, `duration: number` (ms) | SS8.2 |
| CA-8.06 | `CrewAIAuditDetails.governanceState` MUST be one of: `allowed`, `refused`, `escalated`, `sandboxed`, `not_applicable` | SS8.2 |
| CA-8.07 | `CrewAIAuditDetails` optional fields: `beliefIds?: readonly string[]`, `branchIds?: readonly string[]`, `toolName?: string`, `errorCode?: CrewAIAdapterErrorCode` | SS8.2 |
| CA-8.08 | (Claim 6.3) `governanceState` MUST accurately reflect governance verdict. `not_applicable` valid ONLY for pre-governance admission failures where no actor/action context could be constructed. `bypassed` is FORBIDDEN | Claim 6.3 |
| CA-8.09 | (Claim 6.4) Every failure after GovernanceContext construction MUST produce terminal audit entry before error is returned. If failure audit cannot be appended, returned error is `AUDIT_FAILURE` | Claim 6.4 |
| CA-8.10 | (Claim 6.5) `healthCheck` MUST produce audit entry of type `'healthCheck'` recording probe result and latency. `governanceState` for healthCheck audit entries is `'not_applicable'` (diagnostic operation, no governance gate) | Claim 6.5 |

### 8.3 Hash Chain Integrity

| ID | Requirement | Source |
|---|---|---|
| CA-8.11 | Audit entries MUST participate in existing hash chain per `AuditLogEntry` validation rules (SHARED_TYPES SS10.3): `previousHash` matches prior entry, `currentHash` is SHA-256 of canonical serialized entry excluding `currentHash` | SS8.3 |
| CA-8.12 | Adapter MUST NOT maintain its own hash chain; it MUST delegate to Limen Core's audit infrastructure | SS8.3 |

**Section 8 Total: 12**

---

## Section 9: State Machine (SS9)

### 9.1 AdapterLifecycleState

| ID | Requirement | Source |
|---|---|---|
| CA-9.01 | Adapter MUST implement 5-state lifecycle: `UNINITIALIZED`, `INITIALIZING`, `READY`, `DEGRADED`, `SHUTDOWN` | SS9.1 |

### 9.3 Transition Rules

| ID | Requirement | Source |
|---|---|---|
| CA-9.02 | UNINITIALIZED -> INITIALIZING: trigger `initialize()`, guard: config validation passes, side effect: begin connection to core | SS9.3 |
| CA-9.03 | INITIALIZING -> READY: trigger core port connected + adapter registered, guard: audit entry recorded, side effect: emit `session:started` | SS9.3 |
| CA-9.04 | INITIALIZING -> UNINITIALIZED: trigger connection failure / config error / connectionTimeoutMs elapsed | SS9.3 |
| CA-9.05 | INITIALIZING -> SHUTDOWN: trigger `shutdown()` while INITIALIZING, side effect: abort connection attempt, force transition to SHUTDOWN | SS9.3 |
| CA-9.06 | READY -> READY: trigger `initialize()` with identical config, guard: config digest matches, side effect: no-op success, no state reset | SS9.3 |
| CA-9.07 | READY -> DEGRADED: trigger core port loss detected, side effect: emit `cognitive:health_degraded`, begin auto-recovery | SS9.3 |
| CA-9.08 | DEGRADED -> READY: trigger core port recovered, guard: health check passes, side effect: emit `session:started` (recovery), clear error count | SS9.3 |
| CA-9.09 | READY -> SHUTDOWN: trigger `shutdown()`, side effect: close sessions, flush audit, deregister | SS9.3 |
| CA-9.10 | DEGRADED -> SHUTDOWN: trigger `shutdown()`, side effect: best-effort session close, flush audit | SS9.3 |
| CA-9.11 | SHUTDOWN -> SHUTDOWN: trigger `shutdown()` again, side effect: no-op, return success (idempotent) | SS9.3 |
| CA-9.12 | UNINITIALIZED -> SHUTDOWN: trigger `shutdown()`, side effect: no-op, return success | SS9.3 |
| CA-9.13 | (Claim 7.1) All state transitions MUST be atomic. No intermediate state observable between transition start and completion | Claim 7.1 |
| CA-9.14 | (Claim 7.2) SHUTDOWN is terminal. No transition out of SHUTDOWN possible. `initialize()` on shut-down adapter returns `NOT_INITIALIZED` | Claim 7.2 |
| CA-9.15 | (Claim 7.3) Adapter maintains NO belief cache. In DEGRADED state, `remember`, `recall`, `createBranch`, `mergeBranches`, `resolveConflict` MUST fail with `CORE_PORT_UNAVAILABLE` until recovery | Claim 7.3 |
| CA-9.16 | (Claim 7.4) Auto-recovery from DEGRADED uses exponential backoff per `RetryPolicy`. If recovery fails after `maxRetries`, adapter remains DEGRADED and emits `cognitive:health_degraded` with `{ recoveryExhausted: true }` | Claim 7.4 |
| CA-9.17 | (Claim 7.5) Concurrent `shutdown`, auto-recovery, and public operations MUST be serialized by adapter lifecycle state. Once shutdown begins, new side-effecting operations return `NOT_INITIALIZED`; in-flight operations complete with audit or fail with audit before resources released | Claim 7.5 |
| CA-9.18 | (Claim 7.6) After recovery exhaustion in DEGRADED, adapter remains DEGRADED. Caller's recourse is `shutdown()` + new adapter instance. Re-initialization from DEGRADED not permitted; `initialize()` in DEGRADED returns `ALREADY_INITIALIZED`. Adapter emits `cognitive:health_degraded` with `{ recoveryExhausted: true }` | Claim 7.6 |
| CA-9.19 | (Claim 7.7) INITIALIZING MUST transition to UNINITIALIZED within `connectionTimeoutMs`. Timeout fires in INITIALIZING -> transitions to UNINITIALIZED with connection-failure error. `shutdown()` from INITIALIZING forces immediate SHUTDOWN, aborting in-progress connection | Claim 7.7 |

### 9.4 Operations Permitted per State

| ID | Requirement | Source |
|---|---|---|
| CA-9.20 | UNINITIALIZED: `initialize` OK, all data ops ERR, `healthCheck` OK (unhealthy), `getHealth` OK (unhealthy), `on/off` OK, `shutdown` OK (no-op) | SS9.4 |
| CA-9.21 | INITIALIZING: `initialize` ERR, all data ops ERR, `healthCheck` OK (degraded), `getHealth` OK (degraded), `on/off` OK, `shutdown` OK (force) | SS9.4 |
| CA-9.22 | READY: `initialize` OK if same config / ERR if different, all data ops OK, `healthCheck` OK (live probe), `getHealth` OK (healthy), `on/off` OK, `shutdown` OK | SS9.4 |
| CA-9.23 | DEGRADED: `initialize` ERR, all data ops ERR (`CORE_PORT_UNAVAILABLE`), `healthCheck` OK (degraded), `getHealth` OK (degraded), `on/off` OK, `shutdown` OK | SS9.4 |
| CA-9.24 | SHUTDOWN: `initialize` ERR, all data ops ERR, `healthCheck` ERR (`NOT_INITIALIZED`), `getHealth` OK (unhealthy), `on/off` ERR (`NOT_INITIALIZED`), `shutdown` OK (no-op) | SS9.4 |

**Section 9 Total: 24**

---

## Section 10: Test Requirements (SS10)

| ID | Requirement | Source |
|---|---|---|
| CA-10.01 | TC-01: Happy path lifecycle (init -> session -> remember -> recall -> end -> shutdown). All ops return `Result.ok`. Audit entries for every operation. Post-shutdown returns `NOT_INITIALIZED` | TC-01 |
| CA-10.02 | TC-02: Governance refusal is authorization-first. Suspended agent with budget-exceeding content returns `GOVERNANCE_REFUSAL`, not `BUDGET_EXCEEDED`. No claim created. Terminal audit + `governance:refused` event | TC-02 |
| CA-10.03 | TC-03: Token budget exceeded mid-operation. `maxTokensPerSession: 100`, content estimates 150 tokens. Governance evaluated first. Returns `BUDGET_EXCEEDED` with `retryable: true` and `retryAfterSeconds`. No claim. Failure audit | TC-03 |
| CA-10.04 | TC-04: Audit failure blocks operation success. Pre-op audit failure prevents Core call, returns `AUDIT_FAILURE`. Post-op audit failure returns `AUDIT_FAILURE` even if Core mutation completed. `hook:failed` event | TC-04 |
| CA-10.05 | TC-05: Post-READY core port loss and recovery. READY -> DEGRADED -> `remember` fails `CORE_PORT_UNAVAILABLE` -> port restore -> READY -> `remember` success | TC-05 |
| CA-10.06 | TC-06: Branch creation and merge with conflict resolution. `medium` trust. Create branch, conflicting claims, merge with `highest_confidence`. Deterministic per SHARED_TYPES SS23 | TC-06 |
| CA-10.07 | TC-07: Use-before-initialize. All ops except `shutdown` return `NOT_INITIALIZED`. `shutdown` returns `ok`. No events, no audit | TC-07 |
| CA-10.08 | TC-08: Shutdown idempotency. First shutdown does cleanup. Second and third return `ok` with no side effects. No duplicate audit entries | TC-08 |
| CA-10.09 | TC-08A: Idempotent initialize. Second init with same config = `ok`, no side effects. Third with different config = `ALREADY_INITIALIZED`. No state/audit/session reset | TC-08A |
| CA-10.10 | TC-09: Concurrent operations during DEGRADED. 10 concurrent `remember` + 10 `recall` all fail `CORE_PORT_UNAVAILABLE`. No cache, no partial writes, no deadlocks. Error count increments | TC-09 |
| CA-10.11 | TC-10: Error precedence verification. Simultaneous core unavailable + budget exceeded + governance refusal returns `GOVERNANCE_REFUSAL`. Pairwise combinations verified | TC-10 |
| CA-10.12 | TC-11: Confidence cap enforcement. `medium` trust, `confidence: 0.95` -> succeeds, claim has `confidence: 0.7`. Silent cap, no error | TC-11 |
| CA-10.13 | TC-12: Manual merge with pending resolution. `strategy: 'manual'`, conflicts -> `status: 'pending_resolution'`, `manualMergeState` non-null. No claims merged until resolution | TC-12 |
| CA-10.14 | TC-13: Manual conflict resolution API. Valid resolutions complete deterministically. Duplicate/malformed rejected with typed errors. Final merge audit references every resolution | TC-13 |
| CA-10.15 | TC-14: Unknown tool handling. `tool_name: "delete_everything"` -> `UNKNOWN_TOOL` with `availableOperations`. `hook:blocked` event. No empty success, no native execution | TC-14 |
| CA-10.16 | TC-15: Tool translation for each declared capability. Every declared CrewAI tool translates to valid `LimenOperation[]`. Side-effecting operations pass governance first | TC-15 |
| CA-10.17 | TC-16: NativeAgentAction translation. `crew_delegation` and tool actions -> canonical `ComputerAction`. Every `ActionBase` field populated. Undeclared capability -> `CAPABILITY_NOT_DECLARED`. Malformed -> `SERDE_ERROR` | TC-16 |
| CA-10.18 | TC-17: Session lifecycle bridge. `AgentSession.metadata` preserves crew ID, agent role, task ID, delegation depth, process type. `SessionSummary` returned and audited | TC-17 |
| CA-10.19 | TC-18: Event bridge mapping. `before_tool_call`/`after_tool_call` CrewAI events -> `AgentEventPayload` and back. Audit IDs preserved. Unsupported native events return `null` | TC-18 |
| CA-10.20 | TC-19: Governed false rejection. `governed: false` as `verified` agent with `governance_admin` -> `GOVERNANCE_REFUSAL` with `rule: "governance_non_optional"`. No adapter registered | TC-19 |
| CA-10.21 | TC-20: Rate limit inheritance. Empty `rateLimits` inherits defaults. Weakened limits rejected. Rate counters shared with governance, no local reset | TC-20 |
| CA-10.22 | TC-21: Dual projection parity. TypeScript and Rust projections match: branded IDs, enums, errors, governance refusal payloads. Snake_case parity | TC-21 |
| CA-10.23 | TC-22: AdapterSandboxDefaults expansion. Sandbox governance verdict -> lightweight defaults expand to full `SandboxConfig`. Execution uses sandbox constraints. Audit records `governanceState: "sandboxed"` | TC-22 |
| CA-10.24 | TC-23: CrewAI delegation depth hostile case. Nested delegation exceeding `delegationDepthMax` -> `GOVERNANCE_REFUSAL` or `CAPABILITY_NOT_DECLARED`. No delegated operation executes | TC-23 |
| CA-10.25 | TC-24: CrewAI hook payload shape hostile case. `{ tool, args }` without `tool_name`/`tool_input` -> `SERDE_ERROR`. Role/task text never grants capabilities or tool identity | TC-24 |
| CA-10.26 | TC-25: Client error propagation. `LimenAgentClient` error propagates as `CLIENT_ERROR` with original error preserved in context. Not swallowed as `INTERNAL`. Audit records `errorCode: 'CLIENT_ERROR'`. `hook:failed` NOT emitted (adapter-internal telemetry) | TC-25 |
| CA-10.27 | TC-26: Concurrent session isolation. Two adapter instances same crew, different roles. Concurrent `remember`/`recall`. Sessions isolated: independent `activeSessions`, independent budgets, correct `agentRole` in audit. No cross-contamination, no deadlocks | TC-26 |
| CA-10.28 | TC-27: Shutdown with active sessions. 3 active sessions, `shutdown()` without ending. All 3 produce `SessionSummary` with `outcome: 'cancelled'`. 3 audit entries for forced close. Post-shutdown `activeSessions` is 0. No background tasks | TC-27 |
| CA-10.29 | TC-28: healthCheck returns correct status across states. UNINITIALIZED: unhealthy. READY: healthy + corePortConnected. DEGRADED: degraded + !corePortConnected. SHUTDOWN: NOT_INITIALIZED error. `healthCheck()` is live (not cached) -- verified by injecting transient failure between `getHealth()` and `healthCheck()` | TC-28 |
| CA-10.30 | TC-29: Subscription lifecycle via on/off. Subscriptions in UNINITIALIZED fire after READY. `off()` removes targeted subscription. Subscriptions survive DEGRADED->READY. `shutdown()` clears all. Post-SHUTDOWN `on()`/`off()` return `NOT_INITIALIZED`. Unknown ID `off()` is no-op | TC-29 |

**Section 10 Total: 30**

---

## Section 11: Dependencies (SS11)

| ID | Requirement | Source |
|---|---|---|
| CA-11.01 | MUST depend on `SHARED_TYPES.md` v1.4.1 for `AgentFramework.crew_ai` and all cross-contract types | SS11 |
| CA-11.02 | MUST depend on `AGENT_ADAPTER_ARCHITECTURE.md` v2.3.0 for adapter interface, registry, translation semantics, testing contract | SS11 |
| CA-11.03 | MUST depend on `AGENT_LIFECYCLE_MANAGEMENT.md` v1.3.0 for trust promotion, consent governance, knowledge exchange, confidence caps | SS11 |
| CA-11.04 | MUST NOT depend on `@langchain/langgraph-checkpoint` -- CrewAI adapter communicates with Limen Core directly | SS11 |
| CA-11.05 | MUST target CrewAI SDK v1.14.x and official CrewAI docs (Tools v1.14.0, Tool Call Hooks v1.12.2+) | SS11 |
| CA-11.06 | Certification gate: contract MUST NOT be certified in workspace whose `SHARED_TYPES.md`, `AGENT_ADAPTER_ARCHITECTURE.md`, or `AGENT_LIFECYCLE_MANAGEMENT.md` versions are older than listed | SS11 |

**Section 11 Total: 6**

---

## Section 12: Claims Registry (SS12)

_All claims have been extracted inline within the sections where they appear. The Claims Registry (SS12) is a summary table repeating those claims for Breaker traceability. No new requirements arise from it._

**Section 12 Total: 0** (all claims extracted in their originating sections)

---

## Section 13: Assumptions Ledger (SS13)

| ID | Requirement | Source |
|---|---|---|
| CA-13.01 | (A-01) Limen Core MUST be reachable at `coreEndpoint` within `connectionTimeoutMs`. Violation: `CORE_PORT_UNAVAILABLE`, adapter transitions to DEGRADED | A-01 |
| CA-13.02 | (A-02) CrewAI agent roles map to single Limen `AgentId` per crew member (1:1 identity) | A-02 |
| CA-13.03 | (A-03) `AgentFramework.crew_ai` MUST exist in `SHARED_TYPES.md` v1.4.1. If removed, adapter registration fails with `UNKNOWN_FRAMEWORK` | A-03 |
| CA-13.04 | (A-04) `TokenEstimator` MUST produce estimates with <=10% variance per SHARED_TYPES SS20.1 | A-04 |
| CA-13.05 | (A-05) CrewAI delegation depth bounded by `delegationDepthMax` (config enforced) | A-05 |
| CA-13.06 | (A-06) TimeProvider MUST be available for ISO-8601 timestamps. Violation: `TIME_PROVIDER_UNAVAILABLE`, all operations fail (precedence 3) | A-06 |
| CA-13.07 | (A-07) Limen Core MUST enforce registered adapter identity on CrewAI-originated operations. Core MUST hard-fail at boundary if accepting direct CrewAI calls | A-07 |
| CA-13.08 | (A-08) CrewAI tool-call hooks MUST expose `tool_name` and `tool_input` as adapter ingress shape per official docs | A-08 |
| CA-13.09 | (A-09) Rate limits from `DEFAULT_RATE_LIMITS` are inherited and not weakened. Registry rejects weakening configs | A-09 |
| CA-13.10 | (A-10) Manual merge conflicts have timeout governed by session timeout. Session end with pending conflicts -> branch auto-discarded | A-10 |

**Section 13 Total: 10**

---

## Section 14: Invariants (SS14)

| ID | Requirement | Source |
|---|---|---|
| CA-14.01 | (Inv 1) Pure Translation: adapter is stateless translation layer for operations. Holds session state and budget counters but does NOT cache beliefs, branch state, or governance decisions | Inv 1 |
| CA-14.02 | (Inv 2) Governance Cannot Be Bypassed: no code path from any public side-effecting method to Limen Core skips governance evaluation. `governed:false` invalid and rejected before registration | Inv 2 |
| CA-14.03 | (Inv 3) Audit Completeness: every public method invocation reaching governance or Limen Core produces at least one `AuditLogEntry`. Failed operations after GovernanceContext construction produce audit entries recording failure | Inv 3 |
| CA-14.04 | (Inv 4) Capability Immutability: capabilities declared at initialization are frozen. No runtime escalation. Trust promotion through `AGENT_LIFECYCLE_MANAGEMENT` only | Inv 4 |
| CA-14.05 | (Inv 5) Deterministic Error Resolution: same adapter state + same input = same error code. Error precedence is total order | Inv 5 |
| CA-14.06 | (Inv 6) Session Isolation: multiple CrewAI agents using separate adapter instances do NOT share state, budget, or sessions | Inv 6 |
| CA-14.07 | (Inv 7) CrewAI Metadata Preservation: crew ID, agent role, task ID, delegation depth, process type, tool name preserved in every audit entry and session metadata for full provenance reconstruction | Inv 7 |
| CA-14.08 | (Inv 8) Confidence Monotonicity: adapter NEVER increases confidence beyond trust-level cap. May decrease (via Core decay) but NEVER inflate | Inv 8 |
| CA-14.09 | (Inv 9) Shutdown Completeness: after `shutdown()` returns, NO background tasks, timers, or connections remain active. Resource cleanup synchronous with shutdown call | Inv 9 |
| CA-14.10 | (Inv 10) Budget Non-Negative: token budget remaining NEVER negative. Budget tracking uses checked arithmetic; underflow returns `BUDGET_EXCEEDED` | Inv 10 |
| CA-14.11 | (Inv 11) Canonical Adapter Surface: `CrewAIAdapter` implements EVERY canonical `AgentAdapter` method. Convenience methods may be added but MUST NOT replace canonical translation, session, event, health, or registry semantics | Inv 11 |
| CA-14.12 | (Inv 12) No Local Belief Cache: DEGRADED state cannot serve recall from adapter-local belief cache because no such cache exists. Reads/writes requiring Limen Core fail with `CORE_PORT_UNAVAILABLE` | Inv 12 |
| CA-14.13 | (Inv 13) Rate Limit Inheritance: `DEFAULT_RATE_LIMITS` always active and may only be tightened by adapter config | Inv 13 |

**Section 14 Total: 13**

---

## TOTALS

| Section | Description | Count |
|---|---|---|
| SS1 | Overview & Scope | 21 |
| SS2 | Shared Type References | 3 |
| SS3 | Core Interfaces (TS) | 74 |
| SS4 | Rust Trait Equivalent | 45 |
| SS5 | Governance Enforcement | 43 |
| SS6 | Error Taxonomy | 36 |
| SS7 | Token Budget Enforcement | 19 |
| SS8 | Audit & Provenance | 12 |
| SS9 | State Machine | 24 |
| SS10 | Test Requirements | 30 |
| SS11 | Dependencies | 6 |
| SS12 | Claims Registry | 0 |
| SS13 | Assumptions Ledger | 10 |
| SS14 | Invariants | 13 |
| **GRAND TOTAL** | | **350** |
