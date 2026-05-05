# Agent Adapter Architecture Contract v2.0.0

**Status:** RATIFIED DESIGN -- Pending Implementation
**Governing:** CDM v2.0 + Contract Compliance v2.0
**Scope:** Pluggable adapter model for agent framework integration

> **Shared Types:** All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`. This contract does NOT redefine any shared type. Local types are contract-specific and not used by other contracts.

---

## 1. Purpose

This contract defines the pluggable adapter model through which any AI agent framework connects to Limen's epistemic substrate without modifications to the Limen kernel. Each agent framework (Claude, Codex, Hermes, Gemma, custom local models) receives a dedicated adapter that **translates** its native tool-call interface into canonical `SHARED_TYPES.md` formats for governance evaluation and `LimenAgentClient` memory operations.

The adapter is a **translation layer**. It receives native agent formats (`NativeAgentAction`, framework-specific tool calls) and produces canonical types (`ComputerAction`, `LimenOperation`) that the governance engine and memory bridge understand. Adding support for a new agent framework requires implementing a single `AgentAdapter` interface -- no core code changes, no kernel recompilation, no governance model alterations.

---

## 2. Shared Type References

The following types are used by this contract and defined canonically in `SHARED_TYPES.md`:

| Type | Section |
|------|---------|
| `AgentCapability` (20-value enum) | See `SHARED_TYPES.md` §6 |
| `AgentFramework` (6-value enum including `'gemma'`) | See `SHARED_TYPES.md` §21 |
| `ComputerAction` (17-variant union) | See `SHARED_TYPES.md` §11 |
| `ComputerActionType` | See `SHARED_TYPES.md` §9 |
| `ActionBase` | See `SHARED_TYPES.md` §11.1 |
| `NativeAgentAction` | See `SHARED_TYPES.md` §11.4 |
| `SandboxConfig` (rich, 5-subsystem) | See `SHARED_TYPES.md` §12 |
| `AdapterSandboxDefaults` (lightweight) | See `SHARED_TYPES.md` §12.1 |
| `RefusalRule` (rich, with conditions) | See `SHARED_TYPES.md` §13 |
| `AdapterRefusalHint` (lightweight) | See `SHARED_TYPES.md` §13.1 |
| `MergeStrategy` (4-value enum) | See `SHARED_TYPES.md` §14 |
| `AgentSession` | See `SHARED_TYPES.md` §7 |
| `SessionSummary` | See `SHARED_TYPES.md` §15 |
| `AgentEvent` | See `SHARED_TYPES.md` §16.1 |
| `AgentEventPayload` | See `SHARED_TYPES.md` §16.2 |
| `AgentEventHandler` | See `SHARED_TYPES.md` §16.2 |
| `AgentEventBus` | See `SHARED_TYPES.md` §16.2 |
| `GovernanceContext` | See `SHARED_TYPES.md` §9 |
| `GovernanceVerdict` | See `SHARED_TYPES.md` §10 |
| `AgentTrustLevel` (5-level) | See `SHARED_TYPES.md` §5 |
| `TRUST_TO_CLEARANCE` | See `SHARED_TYPES.md` §5 |
| `RateLimitPolicy` | See `SHARED_TYPES.md` §18 |
| `ActionDigest` | See `SHARED_TYPES.md` §24 |
| `RetentionPolicy` | See `SHARED_TYPES.md` §17 |
| `OperationContext` | See `SHARED_TYPES.md` §1.3 |
| Branded IDs (`AdapterId`, `AgentId`, `SessionId`, `EventId`, etc.) | See `SHARED_TYPES.md` §1.1, §4 |
| `ClassificationLevel` | See `SHARED_TYPES.md` §3 |
| `Result<T>` | See `SHARED_TYPES.md` §1.5 |

---

## 3. AgentAdapter Interface

```typescript
interface AgentAdapter {
  // Identity
  readonly adapterId: AdapterId;
  readonly agentFramework: AgentFramework;
  readonly version: string;
  readonly capabilities: ReadonlySet<AgentCapability>;

  // Lifecycle
  initialize(
    client: LimenAgentClient,
    governor: ComputerActionGovernor,
    config: AdapterConfig
  ): Promise<Result<void>>;
  shutdown(): Promise<Result<void>>;

  // Translation Layer (native → canonical)
  translateToolCall(toolCall: AgentToolCall): Promise<Result<LimenOperation[]>>;
  translateActionToGovernance(action: NativeAgentAction): Promise<Result<ComputerAction>>;

  // Session Bridge
  onAgentSessionStart(nativeSession: unknown): Promise<Result<AgentSession>>;
  onAgentSessionEnd(nativeSession: unknown): Promise<Result<SessionSummary>>;

  // Event Bridge
  mapNativeEvent(nativeEvent: unknown): AgentEventPayload | null;
  mapLimenEvent(limenEvent: AgentEventPayload): unknown | null;

  // Health
  healthCheck(): Promise<Result<AdapterHealth>>;
}
```

### 3.1 Translation Semantics

`translateActionToGovernance` is the core translation function:

- **Input:** `NativeAgentAction` -- the adapter-specific payload received from the agent framework (framework name, native type string, opaque payload)
- **Output:** `ComputerAction` -- the canonical 17-variant discriminated union (See `SHARED_TYPES.md` §11) with full `ActionBase` fields populated

The adapter is responsible for:
1. Parsing the native payload according to framework conventions
2. Mapping the native action type to the correct `ComputerActionType`
3. Populating all required `ActionBase` fields (`agentId`, `sessionId`, `timestamp`, `requestId`, `missionId`, `taskId`)
4. Constructing the variant-specific fields from the native payload

---

## 4. Adapter Configuration

### 4.1 AdapterConfig

```typescript
interface AdapterConfig {
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
```

**Note:** `sandboxDefaults` uses `AdapterSandboxDefaults` (See `SHARED_TYPES.md` §12.1) -- the lightweight adapter-facing config. The governance layer expands these defaults into a full `SandboxConfig` (See `SHARED_TYPES.md` §12) when issuing a `sandbox` verdict.

**Note:** `refusalHints` uses `AdapterRefusalHint` (See `SHARED_TYPES.md` §13.1) -- lightweight rule hints. The registry expands these into full `RefusalRule` instances (See `SHARED_TYPES.md` §13) with generated IDs, priority assignment, and `builtin: false`.

**Rate limit rule:** `rateLimits` is additive to `DEFAULT_RATE_LIMITS` (See `SHARED_TYPES.md` §18), not a replacement. Empty adapter-specific limits still inherit all defaults. The registry rejects any adapter config that attempts to weaken default hard-refuse limits; it may only add stricter per-adapter or per-agent limits.

### 4.2 AdapterHealth

```typescript
interface AdapterHealth {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly lastActivity: string | null;
  readonly activeSessions: number;
  readonly errorCount: number;
  readonly uptimeMs: number;
  readonly lastError?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}
```

### 4.3 AdapterSessionError

```typescript
interface AdapterSessionError {
  readonly timestamp: string;
  readonly operationType: string;
  readonly error: string;
  readonly recovered: boolean;
}
```

---

## 5. Translation Types (Local to This Contract)

### 5.1 AgentToolCall

```typescript
interface AgentToolCall {
  readonly toolName: string;
  readonly toolArgs: Readonly<Record<string, unknown>>;
  readonly callId: string;
  readonly agentFramework: AgentFramework;
  readonly rawPayload: unknown;
}
```

### 5.2 LimenOperation (discriminated union)

```typescript
type LimenOperation =
  | { readonly type: 'remember'; readonly content: string | StructuredContent; readonly options?: AgentMemoryOptions }
  | { readonly type: 'recall'; readonly query: AgentRecallQuery; readonly options?: AgentRecallOptions }
  | { readonly type: 'forget'; readonly entryId: ClaimId; readonly reason: string }
  | { readonly type: 'get_belief'; readonly beliefId: ClaimId }
  | { readonly type: 'create_branch'; readonly baseBeliefId: ClaimId; readonly description: string }
  | { readonly type: 'merge_branches'; readonly branchIds: readonly AgentBranchId[]; readonly strategy: MergeStrategy }
  | { readonly type: 'discard_branch'; readonly branchId: AgentBranchId }
  | { readonly type: 'relate'; readonly fromId: ClaimId; readonly toId: ClaimId; readonly relationType: RelationshipType }
  | { readonly type: 'check_permission'; readonly action: ComputerAction; readonly context?: GovernanceContext };
```

`StructuredContent`, `AgentMemoryOptions`, `AgentRecallQuery`, and `AgentRecallOptions` are Memory Bridge request types. This adapter contract imports and forwards them verbatim; it does not redefine, narrow, or widen their shape.

---

## 6. Adapter Registry

### 6.1 AdapterRegistry Interface

```typescript
interface AdapterRegistry {
  register(adapter: AgentAdapter): Result<void>;
  unregister(adapterId: AdapterId): Result<void>;
  get(adapterId: AdapterId): Result<AgentAdapter>;
  getByFramework(framework: AgentFramework): Result<AgentAdapter>;
  list(): readonly AdapterRegistration[];
  discover(): Promise<readonly DiscoveredAdapter[]>;
}
```

### 6.2 AdapterRegistration

```typescript
interface AdapterRegistration {
  readonly adapterId: AdapterId;
  readonly framework: AgentFramework;
  readonly version: string;
  readonly capabilities: ReadonlySet<AgentCapability>;
  readonly registeredAt: string;
  readonly status: 'active' | 'disabled' | 'error';
  readonly errorMessage?: string;
}
```

### 6.3 DiscoveredAdapter

```typescript
interface DiscoveredAdapter {
  readonly source: 'plugin' | 'directory' | 'remote';
  readonly path: string;
  readonly framework: AgentFramework;
  readonly version: string;
  readonly verified: boolean;
}
```

### 6.4 Registry Behavior

- `register`: validates adapter implements all required methods for its declared capabilities. Expands `AdapterRefusalHint` entries into full `RefusalRule` instances (assigns ID, priority, `enabled: true`, `builtin: false`). Returns error if `adapterId` already registered or if framework already has an active adapter.
- `unregister`: calls `adapter.shutdown()` before removal. Returns error if adapter has active sessions.
- `get` / `getByFramework`: O(1) lookup. Returns typed error on miss.
- `list`: snapshot of all registrations with current status.
- `discover`: scans plugin directory and installed packages for exports implementing `AgentAdapter`. Does not auto-register -- returns candidates for explicit registration.

---

## 7. Reference Adapter Specifications

### 7.1 Claude Adapter

| Property | Value |
|----------|-------|
| Framework | `'claude'` |
| Capabilities | All 20 capabilities (See `SHARED_TYPES.md` §6) |
| Tool mapping | Claude `tool_use` content blocks -> `LimenOperation[]` |
| Computer Use | Claude `computer_use` native actions -> `translateActionToGovernance` -> canonical `ComputerAction` |
| Session model | Claude conversation = Limen session |
| Special | MCP tool serving (Limen exposed as MCP server to Claude) |

**Translation rules:**
- `limen_remember` tool call -> `{ type: 'remember', content, options }`
- `limen_recall` tool call -> `{ type: 'recall', query, options }`
- `limen_forget` tool call -> `{ type: 'forget', entryId, reason }`
- `limen_connect` tool call -> `{ type: 'relate', fromId, toId, relationType }`
- `computer_use` tool call -> `NativeAgentAction` with `nativeType: 'computer_use'` -> `translateActionToGovernance` produces canonical `ComputerAction` -> governance check before execution

### 7.2 Codex / OpenAI Agents Adapter

| Property | Value |
|----------|-------|
| Framework | `'codex'` |
| Capabilities | memory_read, memory_write, belief_management, file_access, terminal_use, code_execution |
| Tool mapping | OpenAI `function_call` -> `LimenOperation[]` |
| Computer Use | Codex sandbox actions -> `NativeAgentAction` -> `translateActionToGovernance` -> canonical `ComputerAction` (sandboxed by default) |
| Session model | Codex task = Limen session |
| Special | Inherits Codex sandbox boundaries -- adapter provides `AdapterSandboxDefaults` that map to Codex restrictions |

**Translation rules:**
- Function call with `name: "remember"` -> `{ type: 'remember', content, options }`
- Function call with `name: "search_memory"` -> `{ type: 'recall', query, options }`
- All terminal/file actions produce `NativeAgentAction` -> translated to canonical `ComputerAction` -> gated by governance
- Capabilities not in declared set -> adapter returns typed error on attempt

### 7.3 OpenClaw Adapter

| Property | Value |
|----------|-------|
| Framework | `'openclaw'` |
| Capabilities | memory_read, memory_write, file_access, terminal_use, code_execution |
| Tool mapping | OpenClaw tool invocations -> `LimenOperation[]` |
| Session model | OpenClaw session = Limen session |
| Special | Open-source agent with varying capability sets per deployment |

**Translation rules:**
- Tool invocations follow generic JSON-RPC format
- Adapter introspects available tools at initialization to determine actual capability subset
- Capabilities are the intersection of declared config and detected runtime tools
- Undeclared capabilities -> adapter returns typed error on those operations

### 7.4 Hermes Adapter

| Property | Value |
|----------|-------|
| Framework | `'hermes'` |
| Capabilities | memory_read, memory_write, belief_management, branching |
| Tool mapping | Hermes function calls -> `LimenOperation[]` |
| Session model | Hermes conversation = Limen session |
| Special | Inference-focused -- adapter emphasizes memory/belief operations |

**Translation rules:**
- Hermes structured output with `<tool_call>` tags -> parse and map to `LimenOperation`
- No computer use capabilities -- `translateActionToGovernance` returns error unconditionally
- Branch operations map directly -- Hermes supports exploratory reasoning via branches
- Belief relation operations preferred over raw memory writes

### 7.5 Gemma Adapter

| Property | Value |
|----------|-------|
| Framework | `'gemma'` |
| Capabilities | memory_read, memory_write, belief_management, technique_learning, file_access, code_execution |
| Tool mapping | Gemma function-call format -> `LimenOperation[]` |
| Session model | Gemma inference session = Limen session |
| Special | Self-hosted model. Adapter manages local inference lifecycle. Trust level capped at `medium` unless human-promoted. |

**Translation rules:**
- Gemma outputs structured JSON function calls -> parse and map to `LimenOperation`
- File and code actions produce `NativeAgentAction` -> `translateActionToGovernance` -> canonical `ComputerAction`
- `AdapterSandboxDefaults` restrict filesystem to project-scoped paths, deny network access by default
- Technique learning operations enabled -- Gemma can extract and store techniques via branching

### 7.6 Custom / Local Model Adapter

| Property | Value |
|----------|-------|
| Framework | `'custom'` |
| Capabilities | Configurable at registration time |
| Tool mapping | Generic JSON-RPC or OpenAI-compatible function-call format -> `LimenOperation[]` |
| Session model | Custom session management (caller-defined boundaries) |
| Special | Minimal assumptions -- thin translation layer |

**Translation rules:**
- Accepts any JSON object with `{ tool: string, args: object }` shape
- Maps to `LimenOperation` by tool name lookup in a configurable mapping table
- Unknown tool names return typed error with available operations listed
- Session boundaries must be explicitly signaled by the calling agent

---

## 8. Adapter Development Contract

### 8.1 Required Methods (must implement)

Every adapter must implement these methods regardless of declared capabilities:

1. `initialize` -- connect to `LimenAgentClient`, validate config, register with governor
2. `shutdown` -- close all sessions, release resources, deregister from governor
3. `translateToolCall` -- convert at least one native tool call format into `LimenOperation`
4. `translateActionToGovernance` -- translate `NativeAgentAction` into canonical `ComputerAction`. If the adapter declares no computer-use capabilities, this method returns `Result.err` with code `CAPABILITY_NOT_DECLARED` unconditionally.
5. `onAgentSessionStart` -- create a Limen `AgentSession` from native session metadata
6. `onAgentSessionEnd` -- close the Limen session, return `SessionSummary` (See `SHARED_TYPES.md` §15)
7. `healthCheck` -- return current adapter status with meaningful diagnostics

### 8.2 Event Bridge Methods (implement if agent supports streaming)

- `mapNativeEvent` -- translate framework-specific event into `AgentEventPayload` (See `SHARED_TYPES.md` §16.2)
- `mapLimenEvent` -- translate `AgentEventPayload` into framework-native event format

### 8.3 Testing Contract

Every adapter must pass these verification suites before registration is accepted:

1. **Lifecycle:** `initialize` -> `healthCheck` returns healthy -> `shutdown` -> subsequent calls return error
2. **Idempotent init:** calling `initialize` twice with same config succeeds without side effects
3. **Tool translation:** for each declared capability, at least one tool call translates successfully
4. **Unknown tool handling:** unknown tool names return `{ ok: false, error: { code: 'UNKNOWN_TOOL', ... } }`
5. **Session lifecycle:** `onAgentSessionStart` -> operations -> `onAgentSessionEnd` returns valid `SessionSummary`
6. **Governance gating:** all actions routed through `translateActionToGovernance` produce valid canonical `ComputerAction` instances
7. **Error propagation:** `LimenAgentClient` errors propagate through adapter without swallowing
8. **Capability enforcement:** operations outside declared capabilities return `{ ok: false, error: { code: 'CAPABILITY_NOT_DECLARED', ... } }`
9. **Concurrent sessions:** if config allows multiple sessions, they operate without interference
10. **Shutdown with active sessions:** `shutdown` with open sessions closes them gracefully and returns summaries
11. **NativeAgentAction translation:** adapter correctly populates all `ActionBase` fields when translating to `ComputerAction`
12. **AdapterSandboxDefaults expansion:** governance layer correctly expands lightweight defaults to full `SandboxConfig`

---

## 9. Rust Trait (v5 Alignment)

```rust
use std::future::Future;
use std::sync::Arc;
use std::collections::HashSet;
use serde_json::Value;

// All shared types imported from SHARED_TYPES.md §25 Rust Equivalents:
// AgentCapability, AgentFramework, AgentTrustLevel, ComputerActionType,
// SandboxConfig, GovernanceVerdict, MergeStrategy, ClassificationLevel,
// RateLimitPolicy, AdapterId, AgentId, SessionId, EventId, MissionId, TaskId

/// Core adapter trait for Limen v5 native Rust agents.
/// Translates native agent formats into canonical SHARED_TYPES types.
pub trait AgentAdapter: Send + Sync + 'static {
    fn adapter_id(&self) -> &AdapterId;
    fn agent_framework(&self) -> AgentFramework;
    fn version(&self) -> &str;
    fn capabilities(&self) -> &HashSet<AgentCapability>;

    fn initialize(
        &mut self,
        client: Arc<dyn AgentMemoryBridge>,
        governor: Arc<dyn ComputerActionGovernor>,
        config: AdapterConfig,
    ) -> impl Future<Output = Result<(), AdapterError>> + Send;

    fn shutdown(&mut self) -> impl Future<Output = Result<(), AdapterError>> + Send;

    /// Translate a native tool call into Limen operations.
    fn translate_tool_call(
        &self,
        tool_call: &AgentToolCall,
    ) -> impl Future<Output = Result<Vec<LimenOperation>, AdapterError>> + Send;

    /// Translate a NativeAgentAction into canonical ComputerAction for governance.
    /// Input: adapter-specific action from the agent framework.
    /// Output: canonical ComputerAction (17-variant union from SHARED_TYPES §11).
    fn translate_action_to_governance(
        &self,
        action: &NativeAgentAction,
    ) -> impl Future<Output = Result<ComputerAction, AdapterError>> + Send;

    fn on_session_start(
        &self,
        native_session: &Value,
    ) -> impl Future<Output = Result<AgentSession, AdapterError>> + Send;

    fn on_session_end(
        &self,
        native_session: &Value,
    ) -> impl Future<Output = Result<SessionSummary, AdapterError>> + Send;

    fn health_check(&self) -> impl Future<Output = Result<AdapterHealth, AdapterError>> + Send;
}

/// Native tool call from the agent framework (local to adapter contract).
#[derive(Debug, Clone)]
pub struct AgentToolCall {
    pub tool_name: String,
    pub tool_args: Value,
    pub call_id: String,
    pub agent_framework: AgentFramework,
    pub raw_payload: Value,
}

/// Discriminated union of operations the adapter produces.
/// Uses canonical shared types (MergeStrategy, ClassificationLevel, etc.)
#[derive(Debug, Clone)]
pub enum LimenOperation {
    Remember {
        content: MemoryContent,
        classification: Option<ClassificationLevel>,
        confidence: Option<f64>,
    },
    Recall {
        subject: Option<String>,
        predicate: Option<String>,
        text: Option<String>,
        min_confidence: Option<f64>,
        limit: Option<u32>,
    },
    Forget {
        entry_id: String,
        reason: String,
    },
    GetBelief {
        belief_id: String,
    },
    CreateBranch {
        base_belief_id: String,
        description: String,
    },
    MergeBranches {
        branch_ids: Vec<String>,
        strategy: MergeStrategy, // canonical from SHARED_TYPES §14
    },
    DiscardBranch {
        branch_id: String,
    },
    Relate {
        from_id: String,
        to_id: String,
        relation_type: RelationshipType, // canonical: supports | contradicts | supersedes | derived_from
    },
    CheckPermission {
        action: ComputerAction, // canonical from SHARED_TYPES §11
        context: Option<Value>,
    },
}

/// Content for memory write operations (local to adapter contract).
#[derive(Debug, Clone)]
pub enum MemoryContent {
    Text(String),
    Structured {
        subject: String,
        predicate: String,
        value: String,
    },
}

/// RelationshipType is imported from SHARED_TYPES §25; no local enum is defined here.

/// Adapter-specific errors (local to adapter contract).
#[derive(Debug, Clone)]
pub enum AdapterError {
    NotInitialized,
    AlreadyInitialized,
    ShutdownFailed { reason: String },
    TranslationFailed { tool_name: String, reason: String },
    UnknownTool { tool_name: String, available: Vec<String> },
    CapabilityNotDeclared { capability: AgentCapability },
    GovernanceRefused { action: String, reason: String },
    SessionNotFound { session_id: String },
    MaxSessionsExceeded { limit: u32 },
    ClientError { source: String },
    Internal { message: String },
}

/// Adapter health status (local to adapter contract).
#[derive(Debug, Clone)]
pub struct AdapterHealth {
    pub status: HealthStatus,
    pub last_activity: Option<String>,
    pub active_sessions: u32,
    pub error_count: u64,
    pub uptime_ms: u64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
}

/// Adapter config using lightweight shared types.
#[derive(Debug, Clone)]
pub struct AdapterConfig {
    pub agent_id: AgentId,
    pub tenant_id: Option<TenantId>,
    pub trust_level: AgentTrustLevel,
    pub default_classification: ClassificationLevel,
    pub capabilities: HashSet<AgentCapability>,
    pub rate_limits: Vec<RateLimitPolicy>,
    pub sandbox_defaults: AdapterSandboxDefaults,
    pub refusal_hints: Vec<AdapterRefusalHint>,
    pub metadata: Value,
}

/// Lightweight sandbox defaults (adapter-facing).
/// Expanded to full SandboxConfig by governance layer.
#[derive(Debug, Clone)]
pub struct AdapterSandboxDefaults {
    pub allowed_path_patterns: Vec<String>,
    pub denied_path_patterns: Vec<String>,
    pub allowed_host_patterns: Vec<String>,
    pub denied_host_patterns: Vec<String>,
    pub allowed_commands: Vec<String>,
    pub denied_commands: Vec<String>,
    pub max_duration_ms: Option<u64>,
    pub read_only_filesystem: bool,
}

/// Lightweight refusal hint (adapter-facing).
/// Registry expands to full RefusalRule with generated ID, priority, enabled, builtin fields.
#[derive(Debug, Clone)]
pub struct AdapterRefusalHint {
    pub name: String,
    pub condition: RefusalCondition,
    pub verdict: RefusalVerdict,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefusalVerdict {
    Refuse,
    Escalate,
    Sandbox,
}
```

---

## 10. Invariants

1. **Pure translation.** Adapters are stateless translation layers -- no business logic, no state mutation outside Limen, no caching of beliefs.
2. **One adapter per framework.** The registry rejects duplicate framework registrations. To replace, unregister first.
3. **Idempotent initialization.** Calling `initialize` on an already-initialized adapter is a no-op success. Internal state is not reset.
4. **Typed error on unknown tools.** Unknown tool calls return `Result.err` with code `UNKNOWN_TOOL` and available operations. Never panic, never swallow, never return empty success.
5. **Clean shutdown.** `shutdown` closes all active sessions (calling `onAgentSessionEnd` for each), deregisters from governor, and releases all held resources. Post-shutdown calls return `NOT_INITIALIZED` error.
6. **Capability immutability.** Capabilities are declared at registration and frozen. No runtime escalation. Attempts to use undeclared capabilities return `CAPABILITY_NOT_DECLARED` error.
7. **Full audit trail.** Every operation that flows through an adapter emits an `AgentEventPayload` (See `SHARED_TYPES.md` §16.2). Adapters cannot suppress or filter audit events.
8. **Governance is mandatory.** All actions producing a `ComputerAction` must pass through `ComputerActionGovernor.beforeAction` before execution and `afterAction` after. Adapters cannot bypass, cache, or pre-approve governance decisions.
9. **Explicit discovery.** `AdapterRegistry.discover()` returns candidates but does not load or execute them. Registration requires explicit `register()` call with a verified adapter instance.
10. **Version compatibility.** Each adapter declares `minLimenVersion` and `maxLimenVersion` in its metadata. The registry rejects adapters incompatible with the running Limen version.
11. **Trust-gated capabilities.** An adapter's effective capabilities are the intersection of its declared capabilities and those unlocked by its `AgentTrustLevel` (See `SHARED_TYPES.md` §5.1). An adapter at `low` trust cannot exercise `computer_use` regardless of declaration.
12. **Canonical output.** `translateActionToGovernance` must produce a valid `ComputerAction` union member with all `ActionBase` fields populated. Partial or malformed output is a translation failure.
13. **Rate limits are inherited.** Every adapter is governed by `DEFAULT_RATE_LIMITS` plus adapter-specific stricter limits. Adapters cannot disable, bypass, or locally reset rate counters.

---

## 11. Error Taxonomy

```typescript
type AdapterErrorCode =
  | 'NOT_INITIALIZED'
  | 'ALREADY_INITIALIZED'
  | 'SHUTDOWN_FAILED'
  | 'TRANSLATION_FAILED'
  | 'UNKNOWN_TOOL'
  | 'CAPABILITY_NOT_DECLARED'
  | 'GOVERNANCE_REFUSED'
  | 'SESSION_NOT_FOUND'
  | 'MAX_SESSIONS_EXCEEDED'
  | 'TRUST_LEVEL_INSUFFICIENT'
  | 'CLIENT_ERROR'
  | 'INTERNAL';

interface AdapterKernelError {
  readonly code: AdapterErrorCode;
  readonly message: string;
  readonly adapterId: AdapterId;
  readonly context?: Readonly<Record<string, unknown>>;
}
```

---

## 12. Sequence Diagrams (Textual)

### 12.1 Tool Call Flow

```
Agent Framework -> Adapter.translateToolCall(toolCall)
  Adapter parses native format
  Adapter maps to LimenOperation[]
  For each operation:
    If operation is 'check_permission' or requires governance:
      Adapter -> Governor.beforeAction(ComputerAction)
        Governor evaluates against RefusalRules, RateLimitPolicy, trust level
        Returns GovernanceVerdict (See SHARED_TYPES.md §10)
      If verdict is 'refuse': return Result.err(GOVERNANCE_REFUSED)
      If verdict is 'sandbox': execute within SandboxConfig constraints
      If verdict is 'escalate': return Result.err with escalation info
    Adapter -> LimenAgentClient.<operation>()
    If operation had governance:
      Adapter -> Governor.afterAction(action, result)
    Adapter -> EventBus.emit(AgentEventPayload)
  Return Result.ok(results)
```

### 12.2 Action Translation Flow

```
Agent Framework produces native action
  -> NativeAgentAction { adapterId, agentId, sessionId, nativeType, nativePayload, timestamp }
  -> Adapter.translateActionToGovernance(nativeAction)
    Adapter maps nativeType to ComputerActionType (17 variants)
    Adapter populates ActionBase fields from session state
    Adapter constructs variant-specific fields from nativePayload
  <- ComputerAction (canonical, fully populated)
  -> Governor.beforeAction(ComputerAction)
  <- GovernanceVerdict
```

### 12.3 Session Lifecycle

```
Agent starts conversation/task
  -> Adapter.onAgentSessionStart(nativeSession)
    -> Derive AgentTrustLevel from config
    -> Compute effective capabilities (declared ∩ trust-unlocked)
    -> LimenAgentClient.startSession(...)
    <- AgentSession (See SHARED_TYPES.md §7)
  Agent makes tool calls (N times)
    -> Adapter.translateToolCall(...)
    <- LimenOperation results
  Agent ends conversation/task
  -> Adapter.onAgentSessionEnd(nativeSession)
    -> LimenAgentClient.endSession(sessionId)
    <- SessionSummary (See SHARED_TYPES.md §15)
```

### 12.4 Adapter Registration

```
System startup / plugin load
  -> AdapterRegistry.discover()
  <- DiscoveredAdapter[] (candidates)
  For each approved candidate:
    Instantiate adapter
    -> AdapterRegistry.register(adapter)
      Validate required methods exist
      Validate no duplicate framework
      Expand AdapterRefusalHints -> full RefusalRules
      Expand AdapterSandboxDefaults -> ready for governance expansion
      Store in registry
    <- Result.ok()
    -> adapter.initialize(client, governor, config)
    <- Result.ok() -- adapter is live
```

---

**End of Contract.**
