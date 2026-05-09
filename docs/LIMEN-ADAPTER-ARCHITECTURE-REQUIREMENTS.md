# Limen v5 — AGENT_ADAPTER_ARCHITECTURE.md Requirement Extraction

**Source:** `contracts/AGENT_ADAPTER_ARCHITECTURE.md` v2.3.0
**Extracted:** 2026-05-09
**Governing Standard:** SolisForge Protocol v1.4
**Governance Tier:** Forge Critical
**Purpose:** Every implementable requirement from the adapter architecture contract.

---

## §1 Purpose

| ID | Requirement | Source |
|---|---|---|
| AA-1.01 | Each agent framework (Claude, Codex, Hermes, Gemma, custom local models) SHALL receive a dedicated adapter that translates its native tool-call interface into canonical `SHARED_TYPES.md` formats | §1 |
| AA-1.02 | Adapters SHALL translate `NativeAgentAction` (framework-specific tool calls) into canonical types (`ComputerAction`, `LimenOperation`) for governance evaluation and `LimenAgentClient` memory operations | §1 |
| AA-1.03 | The adapter SHALL be a translation layer only — it receives native agent formats and produces canonical types; it SHALL NOT contain business logic | §1 |
| AA-1.04 | Adding support for a new agent framework SHALL require implementing only a single `AgentAdapter` interface | §1 |
| AA-1.05 | Adding a new adapter SHALL NOT require core code changes, kernel recompilation, or governance model alterations | §1 |
| AA-1.06 | The adapter model SHALL be pluggable — adapters connect agent frameworks to Limen's epistemic substrate without modifications to the Limen kernel | §1 |

---

## §2 Shared Type References

| ID | Requirement | Source |
|---|---|---|
| AA-2.01 | The adapter contract SHALL import all referenced shared types from `SHARED_TYPES.md` as listed in the §2 reference table (29 rows, 35+ individual types) | §2 |
| AA-2.02 | The adapter contract SHALL NOT redefine any shared type — all cross-contract types are owned by `SHARED_TYPES.md` | §2 header note |
| AA-2.03 | Local types defined in this contract SHALL be contract-specific and SHALL NOT be used by other contracts | §2 header note |
| AA-2.04 | `AgentFramework` SHALL reference the 10-value enum (including `'gemma'`, `'crew_ai'`, `'auto_gen'`, `'semantic_kernel'`, `'llama_index'`) from `SHARED_TYPES.md` §21 | §2 |
| AA-2.05 | `AgentCapability` SHALL reference the 20-value enum from `SHARED_TYPES.md` §6 | §2 |

---

## §3 AgentAdapter Interface

| ID | Requirement | Source |
|---|---|---|
| AA-3.01 | `AgentAdapter` SHALL expose a readonly `adapterId` property of type `AdapterId` | §3 |
| AA-3.02 | `AgentAdapter` SHALL expose a readonly `agentFramework` property of type `AgentFramework` | §3 |
| AA-3.03 | `AgentAdapter` SHALL expose a readonly `version` property of type `string` | §3 |
| AA-3.04 | `AgentAdapter` SHALL expose a readonly `capabilities` property of type `ReadonlySet<AgentCapability>` | §3 |
| AA-3.05 | `AgentAdapter` SHALL implement `initialize(client: LimenAgentClient, governor: ComputerActionGovernor, config: AdapterConfig): Promise<Result<void>>` | §3 |
| AA-3.06 | `AgentAdapter` SHALL implement `shutdown(): Promise<Result<void>>` | §3 |
| AA-3.07 | `AgentAdapter` SHALL implement `translateToolCall(toolCall: AgentToolCall): Promise<Result<LimenOperation[]>>` | §3 |
| AA-3.08 | `AgentAdapter` SHALL implement `translateActionToGovernance(action: NativeAgentAction): Promise<Result<ComputerAction>>` | §3 |
| AA-3.09 | `AgentAdapter` SHALL implement `onAgentSessionStart(nativeSession: unknown): Promise<Result<AgentSession>>` | §3 |
| AA-3.10 | `AgentAdapter` SHALL implement `onAgentSessionEnd(nativeSession: unknown): Promise<Result<SessionSummary>>` | §3 |
| AA-3.11 | `AgentAdapter` SHALL implement `mapNativeEvent(nativeEvent: unknown): AgentEventPayload | null` | §3 |
| AA-3.12 | `AgentAdapter` SHALL implement `mapLimenEvent(limenEvent: AgentEventPayload): unknown | null` | §3 |
| AA-3.13 | `AgentAdapter` SHALL implement `healthCheck(): Promise<Result<AdapterHealth>>` | §3 |
| AA-3.14 | `translateActionToGovernance` input SHALL be `NativeAgentAction` — the adapter-specific payload received from the agent framework | §3.1 |
| AA-3.15 | `translateActionToGovernance` output SHALL be `ComputerAction` — the canonical 17-variant discriminated union from `SHARED_TYPES.md` §11 | §3.1 |
| AA-3.16 | `translateActionToGovernance` output SHALL have full `ActionBase` fields populated | §3.1 |
| AA-3.17 | The adapter SHALL parse the native payload according to framework conventions | §3.1 step 1 |
| AA-3.18 | The adapter SHALL map the native action type to the correct `ComputerActionType` | §3.1 step 2 |
| AA-3.19 | The adapter SHALL populate all required `ActionBase` fields: `agentId`, `sessionId`, `timestamp`, `requestId`, `missionId`, `taskId` | §3.1 step 3 |
| AA-3.20 | The adapter SHALL construct the variant-specific fields from the native payload | §3.1 step 4 |
| AA-3.21 | `translateToolCall` SHALL return `Promise<Result<LimenOperation[]>>` — an array of zero or more operations per tool call | §3 |
| AA-3.22 | `onAgentSessionStart` SHALL accept `unknown` native session metadata and return a canonical `AgentSession` | §3 |
| AA-3.23 | `onAgentSessionEnd` SHALL accept `unknown` native session metadata and return a canonical `SessionSummary` | §3 |
| AA-3.24 | `mapNativeEvent` SHALL return `null` when the native event has no Limen equivalent | §3 |
| AA-3.25 | `mapLimenEvent` SHALL return `null` when the Limen event has no native equivalent | §3 |
| AA-3.26 | All `AgentAdapter` properties (`adapterId`, `agentFramework`, `version`, `capabilities`) SHALL be readonly | §3 |
| AA-3.27 | The Rust trait SHALL require `Send + Sync + 'static` bounds on `AgentAdapter` | §9 |
| AA-3.28 | The Rust `initialize` SHALL take `&mut self` (exclusive access during initialization) | §9 |
| AA-3.29 | The Rust `shutdown` SHALL take `&mut self` (exclusive access during shutdown) | §9 |
| AA-3.30 | The Rust `translate_tool_call` SHALL take `&self` (shared access — concurrent safe) | §9 |
| AA-3.31 | The Rust `translate_action_to_governance` SHALL take `&self` (shared access — concurrent safe) | §9 |
| AA-3.32 | The Rust `on_session_start` SHALL take `&self` and accept `&Value` for native session | §9 |
| AA-3.33 | The Rust `on_session_end` SHALL take `&self` and accept `&Value` for native session | §9 |
| AA-3.34 | The Rust `health_check` SHALL take `&self` | §9 |
| AA-3.35 | The Rust `initialize` SHALL accept `Arc<dyn AgentMemoryBridge>` for client | §9 |
| AA-3.36 | The Rust `initialize` SHALL accept `Arc<dyn ComputerActionGovernor>` for governor | §9 |
| AA-3.37 | All Rust trait async methods SHALL return `impl Future<Output = Result<T, AdapterError>> + Send` | §9 |
| AA-3.38 | The Rust `translate_tool_call` SHALL return `Vec<LimenOperation>` (not a single operation) | §9 |
| AA-3.39 | The Rust trait SHALL import all shared types from `SHARED_TYPES.md` §25 Rust Equivalents | §9 |
| AA-3.40 | `NativeAgentAction` input to `translateActionToGovernance` SHALL contain: `adapterId`, `agentId`, `sessionId`, `nativeType`, `nativePayload`, `timestamp` | §12.2 |

---

## §4 Adapter Configuration

| ID | Requirement | Source |
|---|---|---|
| AA-4.01 | `AdapterConfig` SHALL have a readonly `agentId` field of type `AgentId` | §4.1 |
| AA-4.02 | `AdapterConfig` SHALL have a readonly `tenantId` field of type `TenantId | null` | §4.1 |
| AA-4.03 | `AdapterConfig` SHALL have a readonly `trustLevel` field of type `AgentTrustLevel` | §4.1 |
| AA-4.04 | `AdapterConfig` SHALL have a readonly `defaultClassification` field of type `ClassificationLevel` | §4.1 |
| AA-4.05 | `AdapterConfig` SHALL have a readonly `capabilities` field of type `ReadonlySet<AgentCapability>` | §4.1 |
| AA-4.06 | `AdapterConfig` SHALL have a readonly `rateLimits` field of type `readonly RateLimitPolicy[]` | §4.1 |
| AA-4.07 | `AdapterConfig` SHALL have a readonly `sandboxDefaults` field of type `AdapterSandboxDefaults` | §4.1 |
| AA-4.08 | `AdapterConfig` SHALL have a readonly `refusalHints` field of type `readonly AdapterRefusalHint[]` | §4.1 |
| AA-4.09 | `AdapterConfig` SHALL have a readonly `metadata` field of type `Readonly<Record<string, unknown>>` | §4.1 |
| AA-4.10 | `sandboxDefaults` SHALL use `AdapterSandboxDefaults` (lightweight, from `SHARED_TYPES.md` §12.1) — NOT full `SandboxConfig` | §4.1 note |
| AA-4.11 | The governance layer SHALL expand `AdapterSandboxDefaults` into full `SandboxConfig` when issuing a `sandbox` verdict | §4.1 note |
| AA-4.12 | `refusalHints` SHALL use `AdapterRefusalHint` (lightweight, from `SHARED_TYPES.md` §13.1) — NOT full `RefusalRule` | §4.1 note |
| AA-4.13 | The registry SHALL expand `AdapterRefusalHint` into full `RefusalRule` instances with generated IDs, priority assignment, and `builtin: false` | §4.1 note |
| AA-4.14 | `rateLimits` SHALL be additive to `DEFAULT_RATE_LIMITS` (from `SHARED_TYPES.md` §18), NOT a replacement | §4.1 rate limit rule |
| AA-4.15 | Empty adapter-specific rate limits SHALL still inherit all default rate limits | §4.1 rate limit rule |
| AA-4.16 | The registry SHALL reject any adapter config that attempts to weaken default hard-refuse rate limits | §4.1 rate limit rule |
| AA-4.17 | Adapter-specific rate limits SHALL only add stricter per-adapter or per-agent limits beyond defaults | §4.1 rate limit rule |
| AA-4.18 | `AdapterHealth` SHALL have a readonly `status` field with values `'healthy' | 'degraded' | 'unhealthy'` | §4.2 |
| AA-4.19 | `AdapterHealth` SHALL have a readonly `lastActivity` field of type `string | null` | §4.2 |
| AA-4.20 | `AdapterHealth` SHALL have a readonly `activeSessions` field of type `number` | §4.2 |
| AA-4.21 | `AdapterHealth` SHALL have a readonly `errorCount` field of type `number` | §4.2 |
| AA-4.22 | `AdapterHealth` SHALL have a readonly `uptimeMs` field of type `number` | §4.2 |
| AA-4.23 | `AdapterHealth` SHALL have an optional readonly `lastError` field of type `string` | §4.2 |
| AA-4.24 | `AdapterHealth` SHALL have an optional readonly `details` field of type `Readonly<Record<string, unknown>>` | §4.2 |
| AA-4.25 | `AdapterSessionError` SHALL have readonly fields: `timestamp: string`, `operationType: string`, `error: string`, `recovered: boolean` | §4.3 |

---

## §5 Translation Types

| ID | Requirement | Source |
|---|---|---|
| AA-5.01 | `AgentToolCall` SHALL have a readonly `toolName` field of type `string` | §5.1 |
| AA-5.02 | `AgentToolCall` SHALL have a readonly `toolArgs` field of type `Readonly<Record<string, unknown>>` | §5.1 |
| AA-5.03 | `AgentToolCall` SHALL have a readonly `callId` field of type `string` | §5.1 |
| AA-5.04 | `AgentToolCall` SHALL have a readonly `agentFramework` field of type `AgentFramework` | §5.1 |
| AA-5.05 | `AgentToolCall` SHALL have a readonly `rawPayload` field of type `unknown` | §5.1 |
| AA-5.06 | `AgentToolCall` SHALL be local to this contract (not a shared type) | §5.1 |
| AA-5.07 | `LimenOperation` SHALL be a discriminated union on the `type` field | §5.2 |
| AA-5.08 | `LimenOperation` SHALL have variant `'remember'` with fields: `content: string | StructuredContent`, `options?: AgentMemoryOptions` | §5.2 (TS) |
| AA-5.09 | `LimenOperation` SHALL have variant `'recall'` with fields: `query: AgentRecallQuery`, `options?: AgentRecallOptions` | §5.2 (TS) |
| AA-5.10 | `LimenOperation` SHALL have variant `'forget'` with fields: `entryId: ClaimId`, `reason: string` | §5.2 (TS) |
| AA-5.11 | `LimenOperation` SHALL have variant `'get_belief'` with field: `beliefId: ClaimId` | §5.2 (TS) |
| AA-5.12 | `LimenOperation` SHALL have variant `'create_branch'` with fields: `baseBeliefId: ClaimId`, `description: string` | §5.2 (TS) |
| AA-5.13 | `LimenOperation` SHALL have variant `'merge_branches'` with fields: `branchIds: readonly AgentBranchId[]`, `strategy: MergeStrategy` | §5.2 (TS) |
| AA-5.14 | `LimenOperation` SHALL have variant `'discard_branch'` with field: `branchId: AgentBranchId` | §5.2 (TS) |
| AA-5.15 | `LimenOperation` SHALL have variant `'relate'` with fields: `fromId: ClaimId`, `toId: ClaimId`, `relationType: RelationshipType` | §5.2 (TS) |
| AA-5.16 | `LimenOperation` SHALL have variant `'check_permission'` with fields: `action: ComputerAction`, `context: GovernanceContext` | §5.2 (TS) |
| AA-5.17 | `LimenOperation` SHALL have exactly 9 variants (remember, recall, forget, get_belief, create_branch, merge_branches, discard_branch, relate, check_permission) | §5.2 |
| AA-5.18 | `StructuredContent`, `AgentMemoryOptions`, `AgentRecallQuery`, and `AgentRecallOptions` SHALL be imported from `SHARED_TYPES.md` §10.2.1 — the adapter SHALL NOT redefine, narrow, or widen their shape | §5.2 note |
| AA-5.19 | Rust `LimenOperation::Remember` SHALL have fields: `content: MemoryContent`, `classification: Option<ClassificationLevel>`, `confidence: Option<f64>` | §9 |
| AA-5.20 | Rust `LimenOperation::Recall` SHALL have fields: `subject: Option<String>`, `predicate: Option<String>`, `text: Option<String>`, `min_confidence: Option<f64>`, `limit: Option<u32>` | §9 |
| AA-5.21 | Rust `LimenOperation::Forget` SHALL have fields: `entry_id: String`, `reason: String` | §9 |
| AA-5.22 | Rust `LimenOperation::GetBelief` SHALL have field: `belief_id: String` | §9 |
| AA-5.23 | Rust `LimenOperation::CreateBranch` SHALL have fields: `base_belief_id: String`, `description: String` | §9 |
| AA-5.24 | Rust `LimenOperation::MergeBranches` SHALL have fields: `branch_ids: Vec<String>`, `strategy: MergeStrategy` | §9 |
| AA-5.25 | Rust `LimenOperation::DiscardBranch` SHALL have field: `branch_id: String` | §9 |
| AA-5.26 | Rust `LimenOperation::Relate` SHALL have fields: `from_id: String`, `to_id: String`, `relation_type: RelationshipType` | §9 |
| AA-5.27 | Rust `LimenOperation::CheckPermission` SHALL have fields: `action: ComputerAction`, `context: Option<Value>` | §9 |
| AA-5.28 | Rust `MemoryContent` SHALL be an enum with variants: `Text(String)` and `Structured { subject: String, predicate: String, value: String }` | §9 |
| AA-5.29 | Rust `LimenOperation` SHALL derive `Debug, Clone` | §9 |
| AA-5.30 | Rust `MemoryContent` SHALL derive `Debug, Clone` | §9 |
| AA-5.31 | Rust `AgentToolCall` SHALL have fields: `tool_name: String`, `tool_args: Value`, `call_id: String`, `agent_framework: AgentFramework`, `raw_payload: Value` | §9 |
| AA-5.32 | Rust `AgentToolCall` SHALL derive `Debug, Clone` | §9 |

---

## §6 Adapter Registry

| ID | Requirement | Source |
|---|---|---|
| AA-6.01 | `AdapterRegistry` SHALL implement `register(adapter: AgentAdapter): Result<void>` | §6.1 |
| AA-6.02 | `AdapterRegistry` SHALL implement `unregister(adapterId: AdapterId): Result<void>` | §6.1 |
| AA-6.03 | `AdapterRegistry` SHALL implement `get(adapterId: AdapterId): Result<AgentAdapter>` | §6.1 |
| AA-6.04 | `AdapterRegistry` SHALL implement `getByFramework(framework: AgentFramework): Result<AgentAdapter>` | §6.1 |
| AA-6.05 | `AdapterRegistry` SHALL implement `list(): readonly AdapterRegistration[]` | §6.1 |
| AA-6.06 | `AdapterRegistry` SHALL implement `discover(): Promise<readonly DiscoveredAdapter[]>` | §6.1 |
| AA-6.07 | `AdapterRegistration` SHALL have readonly fields: `adapterId: AdapterId`, `framework: AgentFramework`, `version: string`, `capabilities: ReadonlySet<AgentCapability>`, `registeredAt: string`, `status: 'active' | 'disabled' | 'error'` | §6.2 |
| AA-6.08 | `AdapterRegistration` SHALL have an optional `errorMessage` field of type `string` | §6.2 |
| AA-6.09 | `DiscoveredAdapter` SHALL have readonly fields: `source: 'plugin' | 'directory' | 'remote'`, `path: string`, `framework: AgentFramework`, `version: string`, `verified: boolean` | §6.3 |
| AA-6.10 | `register` SHALL validate that the adapter implements all required methods for its declared capabilities | §6.4 |
| AA-6.11 | `register` SHALL expand `AdapterRefusalHint` entries into full `RefusalRule` instances (assigns ID, priority, `enabled: true`, `builtin: false`) | §6.4 |
| AA-6.12 | `register` SHALL return error if `adapterId` is already registered | §6.4 |
| AA-6.13 | `register` SHALL return error if the adapter's framework already has an active adapter registered | §6.4 |
| AA-6.14 | `unregister` SHALL call `adapter.shutdown()` before removal from the registry | §6.4 |
| AA-6.15 | `unregister` SHALL return error if the adapter has active sessions | §6.4 |
| AA-6.16 | `get` SHALL provide O(1) lookup by adapter ID | §6.4 |
| AA-6.17 | `getByFramework` SHALL provide O(1) lookup by framework | §6.4 |
| AA-6.18 | `get` and `getByFramework` SHALL return typed error on miss | §6.4 |
| AA-6.19 | `list` SHALL return a snapshot of all registrations with current status | §6.4 |
| AA-6.20 | `discover` SHALL scan plugin directory and installed packages for exports implementing `AgentAdapter` | §6.4 |
| AA-6.21 | `discover` SHALL NOT auto-register discovered adapters — it SHALL return candidates for explicit registration | §6.4 |
| AA-6.22 | `discover` SHALL return `DiscoveredAdapter[]` with source, path, framework, version, and verification status | §6.3, §6.4 |
| AA-6.23 | `DiscoveredAdapter.source` SHALL be one of `'plugin'`, `'directory'`, or `'remote'` | §6.3 |
| AA-6.24 | `DiscoveredAdapter.verified` SHALL indicate whether the discovered adapter has been integrity-verified | §6.3 |

---

## §7 Reference Adapter Specifications

### §7.1 Claude Adapter

| ID | Requirement | Source |
|---|---|---|
| AA-7.01 | Claude adapter SHALL declare framework `'claude'` | §7.1 |
| AA-7.02 | Claude adapter SHALL declare all 20 capabilities from `SHARED_TYPES.md` §6 | §7.1 |
| AA-7.03 | Claude adapter SHALL map `tool_use` content blocks to `LimenOperation[]` | §7.1 |
| AA-7.04 | Claude adapter SHALL map `computer_use` native actions through `translateActionToGovernance` to canonical `ComputerAction` | §7.1 |
| AA-7.05 | Claude adapter SHALL map Claude conversation to Limen session (1:1) | §7.1 |
| AA-7.06 | Claude adapter SHALL support MCP tool serving (Limen exposed as MCP server to Claude) | §7.1 |
| AA-7.07 | Claude adapter SHALL translate `limen_remember` tool call to `{ type: 'remember', content, options }` | §7.1 translation rules |
| AA-7.08 | Claude adapter SHALL translate `limen_recall` tool call to `{ type: 'recall', query, options }` | §7.1 translation rules |
| AA-7.09 | Claude adapter SHALL translate `limen_forget` tool call to `{ type: 'forget', entryId, reason }` | §7.1 translation rules |
| AA-7.10 | Claude adapter SHALL translate `limen_connect` tool call to `{ type: 'relate', fromId, toId, relationType }` | §7.1 translation rules |
| AA-7.11 | Claude adapter SHALL translate `computer_use` tool call to `NativeAgentAction` with `nativeType: 'computer_use'`, then through `translateActionToGovernance` to canonical `ComputerAction`, then governance check before execution | §7.1 translation rules |

### §7.2 Codex / OpenAI Agents Adapter

| ID | Requirement | Source |
|---|---|---|
| AA-7.12 | Codex adapter SHALL declare framework `'codex'` | §7.2 |
| AA-7.13 | Codex adapter SHALL declare capabilities: `memory_read`, `memory_write`, `belief_management`, `file_access`, `terminal_use`, `code_execution` | §7.2 |
| AA-7.14 | Codex adapter SHALL map OpenAI `function_call` to `LimenOperation[]` | §7.2 |
| AA-7.15 | Codex adapter SHALL map Codex sandbox actions through `NativeAgentAction` -> `translateActionToGovernance` -> canonical `ComputerAction` (sandboxed by default) | §7.2 |
| AA-7.16 | Codex adapter SHALL map Codex task to Limen session (1:1) | §7.2 |
| AA-7.17 | Codex adapter SHALL provide `AdapterSandboxDefaults` that map to Codex restrictions | §7.2 |
| AA-7.18 | Codex adapter SHALL translate `function_call` with `name: "remember"` to `{ type: 'remember', content, options }` | §7.2 translation rules |
| AA-7.19 | Codex adapter SHALL translate `function_call` with `name: "search_memory"` to `{ type: 'recall', query, options }` | §7.2 translation rules |
| AA-7.20 | Codex adapter SHALL return typed error when capabilities not in declared set are attempted | §7.2 translation rules |

### §7.3 OpenClaw Adapter

| ID | Requirement | Source |
|---|---|---|
| AA-7.21 | OpenClaw adapter SHALL declare framework `'openclaw'` | §7.3 |
| AA-7.22 | OpenClaw adapter SHALL declare capabilities: `memory_read`, `memory_write`, `file_access`, `terminal_use`, `code_execution` | §7.3 |
| AA-7.23 | OpenClaw adapter SHALL map OpenClaw tool invocations to `LimenOperation[]` | §7.3 |
| AA-7.24 | OpenClaw adapter SHALL map OpenClaw session to Limen session (1:1) | §7.3 |
| AA-7.25 | OpenClaw adapter tool invocations SHALL follow generic JSON-RPC format | §7.3 translation rules |
| AA-7.26 | OpenClaw adapter SHALL introspect available tools at initialization to determine actual capability subset as the intersection of declared config and detected runtime tools | §7.3 translation rules |
| AA-7.27 | OpenClaw adapter SHALL return typed error for undeclared capabilities | §7.3 translation rules |

### §7.4 Hermes Adapter

| ID | Requirement | Source |
|---|---|---|
| AA-7.28 | Hermes adapter SHALL declare framework `'hermes'` | §7.4 |
| AA-7.29 | Hermes adapter SHALL declare capabilities: `memory_read`, `memory_write`, `belief_management`, `branching` | §7.4 |
| AA-7.30 | Hermes adapter SHALL map Hermes function calls to `LimenOperation[]` | §7.4 |
| AA-7.31 | Hermes adapter SHALL map Hermes conversation to Limen session (1:1) | §7.4 |
| AA-7.32 | Hermes adapter SHALL parse structured output with `<tool_call>` tags and map to `LimenOperation` | §7.4 translation rules |
| AA-7.33 | Hermes adapter SHALL return error unconditionally from `translateActionToGovernance` — no computer use capabilities | §7.4 translation rules |
| AA-7.34 | Hermes adapter SHALL support branch operations mapping directly -- Hermes supports exploratory reasoning via branches | §7.4 translation rules |
| AA-7.34a | Hermes adapter SHALL prefer belief relation operations over raw memory writes | §7.4 translation rules |

### §7.5 Gemma Adapter

| ID | Requirement | Source |
|---|---|---|
| AA-7.35 | Gemma adapter SHALL declare framework `'gemma'` | §7.5 |
| AA-7.36 | Gemma adapter SHALL declare capabilities: `memory_read`, `memory_write`, `belief_management`, `technique_learning`, `file_access`, `code_execution` | §7.5 |
| AA-7.37 | Gemma adapter SHALL map Gemma function-call format to `LimenOperation[]` | §7.5 |
| AA-7.38 | Gemma adapter SHALL map Gemma inference session to Limen session (1:1) | §7.5 |
| AA-7.39 | Gemma adapter trust level SHALL be capped at `medium` unless human-promoted | §7.5 |
| AA-7.40 | Gemma adapter SHALL parse structured JSON function calls and map to `LimenOperation` | §7.5 translation rules |
| AA-7.41 | Gemma adapter `AdapterSandboxDefaults` SHALL restrict filesystem to project-scoped paths and deny network access by default | §7.5 translation rules |
| AA-7.42 | Gemma adapter SHALL enable technique learning operations — Gemma can extract and store techniques via branching | §7.5 translation rules |

### §7.6 Custom / Local Model Adapter

| ID | Requirement | Source |
|---|---|---|
| AA-7.43 | Custom adapter SHALL declare framework `'custom'` | §7.6 |
| AA-7.44 | Custom adapter capabilities SHALL be configurable at registration time | §7.6 |
| AA-7.45 | Custom adapter SHALL accept generic JSON-RPC or OpenAI-compatible function-call format | §7.6 |
| AA-7.46 | Custom adapter session model SHALL support custom session management with caller-defined boundaries | §7.6 |
| AA-7.47 | Custom adapter SHALL be a minimal-assumptions thin translation layer | §7.6 |
| AA-7.48 | Custom adapter SHALL accept any JSON object with `{ tool: string, args: object }` shape | §7.6 translation rules |
| AA-7.49 | Custom adapter SHALL map to `LimenOperation` by tool name lookup in a configurable mapping table | §7.6 translation rules |
| AA-7.50 | Custom adapter SHALL return typed error for unknown tool names with available operations listed | §7.6 translation rules |
| AA-7.51 | Custom adapter session boundaries SHALL be explicitly signaled by the calling agent | §7.6 translation rules |
| AA-7.52 | ALL Codex terminal/file actions SHALL produce `NativeAgentAction`, be translated to canonical `ComputerAction`, and be gated by governance before execution | §7.2 |
| AA-7.53 | ALL Gemma file and code actions SHALL produce `NativeAgentAction`, pass through `translateActionToGovernance`, and be gated by governance before execution | §7.5 |
| AA-7.54 | Gemma adapter SHALL manage local inference lifecycle (self-hosted model) | §7.5 |

---

## §8 Adapter Development Contract

### §8.1 Required Methods

| ID | Requirement | Source |
|---|---|---|
| AA-8.01 | Every adapter SHALL implement `initialize` — connect to `LimenAgentClient`, validate config, register with governor | §8.1 rule 1 |
| AA-8.02 | Every adapter SHALL implement `shutdown` — close all sessions, release resources, deregister from governor | §8.1 rule 2 |
| AA-8.03 | Every adapter SHALL implement `translateToolCall` — convert at least one native tool call format into `LimenOperation` | §8.1 rule 3 |
| AA-8.04 | Every adapter SHALL implement `translateActionToGovernance` — translate `NativeAgentAction` into canonical `ComputerAction`; if adapter declares no computer-use capabilities, this method SHALL return `Result.err` with code `CAPABILITY_NOT_DECLARED` unconditionally | §8.1 rule 4 |
| AA-8.05 | Every adapter SHALL implement `onAgentSessionStart` — create a Limen `AgentSession` from native session metadata | §8.1 rule 5 |
| AA-8.06 | Every adapter SHALL implement `onAgentSessionEnd` — close the Limen session, return `SessionSummary` | §8.1 rule 6 |
| AA-8.07 | Every adapter SHALL implement `healthCheck` — return current adapter status with meaningful diagnostics | §8.1 rule 7 |

### §8.2 Event Bridge Methods

| ID | Requirement | Source |
|---|---|---|
| AA-8.08 | Adapters supporting streaming SHALL implement `mapNativeEvent` — translate framework-specific event into `AgentEventPayload` | §8.2 |
| AA-8.09 | Adapters supporting streaming SHALL implement `mapLimenEvent` — translate `AgentEventPayload` into framework-native event format | §8.2 |

### §8.3 Testing Contract

| ID | Requirement | Source |
|---|---|---|
| AA-8.10 | Every adapter SHALL pass lifecycle test: `initialize` -> `healthCheck` returns healthy -> `shutdown` -> subsequent calls return error | §8.3 test 1 |
| AA-8.11 | Every adapter SHALL pass idempotent init test: calling `initialize` twice with same config succeeds without side effects | §8.3 test 2 |
| AA-8.12 | Every adapter SHALL pass tool translation test: for each declared capability, at least one tool call translates successfully | §8.3 test 3 |
| AA-8.13 | Every adapter SHALL pass unknown tool handling test: unknown tool names return `{ ok: false, error: { code: 'UNKNOWN_TOOL', ... } }` | §8.3 test 4 |
| AA-8.14 | Every adapter SHALL pass session lifecycle test: `onAgentSessionStart` -> operations -> `onAgentSessionEnd` returns valid `SessionSummary` | §8.3 test 5 |
| AA-8.15 | Every adapter SHALL pass governance gating test: all actions routed through `translateActionToGovernance` produce valid canonical `ComputerAction` instances | §8.3 test 6 |
| AA-8.16 | Every adapter SHALL pass error propagation test: `LimenAgentClient` errors propagate through adapter without swallowing | §8.3 test 7 |
| AA-8.17 | Every adapter SHALL pass capability enforcement test: operations outside declared capabilities return `{ ok: false, error: { code: 'CAPABILITY_NOT_DECLARED', ... } }` | §8.3 test 8 |
| AA-8.18 | Every adapter SHALL pass concurrent sessions test: if config allows multiple sessions, they operate without interference | §8.3 test 9 |
| AA-8.19 | Every adapter SHALL pass shutdown-with-active-sessions test: `shutdown` with open sessions closes them gracefully and returns summaries | §8.3 test 10 |
| AA-8.20 | Every adapter SHALL pass NativeAgentAction translation test: adapter correctly populates all `ActionBase` fields when translating to `ComputerAction` | §8.3 test 11 |
| AA-8.21 | Every adapter SHALL pass AdapterSandboxDefaults expansion test: governance layer correctly expands lightweight defaults to full `SandboxConfig` | §8.3 test 12 |
| AA-8.22 | All 12 testing contract verification suites SHALL pass before adapter registration is accepted | §8.3 |
| AA-8.23 | Unknown tool handling error response SHALL include error code `'UNKNOWN_TOOL'` | §8.3 test 4 |
| AA-8.24 | Capability enforcement error response SHALL include error code `'CAPABILITY_NOT_DECLARED'` | §8.3 test 8 |

---

## §9 Rust Types

| ID | Requirement | Source |
|---|---|---|
| AA-9.01 | `AdapterError` SHALL be an enum with variant `NotInitialized` | §9 |
| AA-9.02 | `AdapterError` SHALL be an enum with variant `AlreadyInitialized` | §9 |
| AA-9.03 | `AdapterError` SHALL be an enum with variant `ShutdownFailed { reason: String }` | §9 |
| AA-9.04 | `AdapterError` SHALL be an enum with variant `TranslationFailed { tool_name: String, reason: String }` | §9 |
| AA-9.05 | `AdapterError` SHALL be an enum with variant `UnknownTool { tool_name: String, available: Vec<String> }` | §9 |
| AA-9.06 | `AdapterError` SHALL be an enum with variant `CapabilityNotDeclared { capability: AgentCapability }` | §9 |
| AA-9.07 | `AdapterError` SHALL be an enum with variant `GovernanceRefused { action: String, reason: String }` | §9 |
| AA-9.08 | `AdapterError` SHALL be an enum with variant `SessionNotFound { session_id: String }` | §9 |
| AA-9.09 | `AdapterError` SHALL be an enum with variant `MaxSessionsExceeded { limit: u32 }` | §9 |
| AA-9.10 | `AdapterError` SHALL be an enum with variant `ClientError { source: String }` | §9 |
| AA-9.11 | `AdapterError` SHALL be an enum with variant `Internal { message: String }` | §9 |
| AA-9.12 | `AdapterError` SHALL derive `Debug, Clone` | §9 |
| AA-9.13 | `AdapterError` SHALL have exactly 11 variants | §9 |
| AA-9.14 | `AdapterHealth` (Rust) SHALL have fields: `status: HealthStatus`, `last_activity: Option<String>`, `active_sessions: u32`, `error_count: u64`, `uptime_ms: u64`, `last_error: Option<String>` | §9 |
| AA-9.15 | `AdapterHealth` (Rust) SHALL derive `Debug, Clone` | §9 |
| AA-9.16 | `HealthStatus` SHALL be an enum with variants: `Healthy`, `Degraded`, `Unhealthy` | §9 |
| AA-9.17 | `HealthStatus` SHALL derive `Debug, Clone, Copy, PartialEq, Eq` | §9 |
| AA-9.18 | `AdapterConfig` (Rust) SHALL have fields: `agent_id: AgentId`, `tenant_id: Option<TenantId>`, `trust_level: AgentTrustLevel`, `default_classification: ClassificationLevel`, `capabilities: HashSet<AgentCapability>`, `rate_limits: Vec<RateLimitPolicy>`, `sandbox_defaults: AdapterSandboxDefaults`, `refusal_hints: Vec<AdapterRefusalHint>`, `metadata: Value` | §9 |
| AA-9.19 | `AdapterConfig` (Rust) SHALL derive `Debug, Clone` | §9 |
| AA-9.20 | `AdapterSandboxDefaults` (Rust) SHALL have fields: `allowed_path_patterns: Vec<String>`, `denied_path_patterns: Vec<String>`, `allowed_host_patterns: Vec<String>`, `denied_host_patterns: Vec<String>`, `allowed_commands: Vec<String>`, `denied_commands: Vec<String>`, `max_duration_ms: Option<u64>`, `read_only_filesystem: bool` | §9 |
| AA-9.21 | `AdapterSandboxDefaults` (Rust) SHALL derive `Debug, Clone` | §9 |
| AA-9.22 | `AdapterRefusalHint` (Rust) SHALL have fields: `name: String`, `condition: RefusalCondition`, `verdict: RefusalVerdict`, `message: String` | §9 |
| AA-9.23 | `AdapterRefusalHint` (Rust) SHALL derive `Debug, Clone` | §9 |
| AA-9.24 | `RefusalVerdict` SHALL be an enum with variants: `Refuse`, `Escalate`, `Sandbox` | §9 |
| AA-9.25 | `RefusalVerdict` SHALL derive `Debug, Clone, Copy, PartialEq, Eq` | §9 |
| AA-9.26 | `RefusalVerdict` SHALL have exactly 3 variants | §9 |
| AA-9.27 | `AdapterSandboxDefaults` SHALL have exactly 8 fields | §9 |
| AA-9.28 | `AdapterConfig` (Rust) SHALL have exactly 9 fields matching the TypeScript `AdapterConfig` | §9, §4.1 |
| AA-9.29 | Rust `RelationshipType` SHALL be imported from `SHARED_TYPES.md` §25 — no local enum defined | §9 note |
| AA-9.30 | Rust shared type imports SHALL include: `AgentCapability`, `AgentFramework`, `AgentTrustLevel`, `ComputerActionType`, `SandboxConfig`, `GovernanceVerdict`, `MergeStrategy`, `ClassificationLevel`, `RateLimitPolicy`, `AdapterId`, `AgentId`, `SessionId`, `EventId`, `MissionId`, `TaskId` | §9 |
| AA-9.31 | All Rust types local to this contract SHALL NOT be exported as shared types | §9, §2 |
| AA-9.32 | `LimenOperation` SHALL have exactly 9 variants in both TypeScript and Rust | §5.2, §9 |
| AA-9.33 | Rust trait SHALL expose `adapter_id() -> &AdapterId` accessor method | §9 |
| AA-9.34 | Rust trait SHALL expose `agent_framework() -> AgentFramework` accessor method | §9 |
| AA-9.35 | Rust trait SHALL expose `version() -> &str` accessor method | §9 |
| AA-9.36 | Rust trait SHALL expose `capabilities() -> &HashSet<AgentCapability>` accessor method | §9 |
| AA-9.37 | Known TC-21 gap: TS AgentAdapter has `mapNativeEvent`/`mapLimenEvent` methods; Rust trait omits event bridge methods. Rust adapters require separate event bridge trait when event mapping is needed. | §9 vs §3 |
| AA-9.38 | Known TC-21 gap: TS `AdapterHealth` has optional `details: Readonly<Record<string, unknown>>` (7 fields); Rust `AdapterHealth` omits `details` (6 fields). Deliberate design: Rust health checks are lightweight. | §4.2 vs §9 |

---

## §10 Invariants

| ID | Requirement | Source |
|---|---|---|
| AA-10.01 | Adapters SHALL be stateless translation layers — no business logic, no state mutation outside Limen, no caching of beliefs | §10 invariant 1 |
| AA-10.02 | The registry SHALL reject duplicate framework registrations — one adapter per framework; to replace, unregister first | §10 invariant 2 |
| AA-10.03 | Calling `initialize` on an already-initialized adapter SHALL be a no-op success; internal state SHALL NOT be reset | §10 invariant 3 |
| AA-10.04 | Unknown tool calls SHALL return `Result.err` with code `UNKNOWN_TOOL` and available operations; SHALL never panic, never swallow, never return empty success | §10 invariant 4 |
| AA-10.05 | `shutdown` SHALL close all active sessions (calling `onAgentSessionEnd` for each), deregister from governor, and release all held resources | §10 invariant 5 |
| AA-10.06 | Post-shutdown calls SHALL return `NOT_INITIALIZED` error | §10 invariant 5 |
| AA-10.07 | Capabilities SHALL be declared at registration and frozen — no runtime escalation; attempts to use undeclared capabilities SHALL return `CAPABILITY_NOT_DECLARED` error | §10 invariant 6 |
| AA-10.08 | Every operation that flows through an adapter SHALL emit an `AgentEventPayload`; adapters SHALL NOT suppress or filter audit events | §10 invariant 7 |
| AA-10.09 | All actions producing a `ComputerAction` SHALL pass through `ComputerActionGovernor.beforeAction` before execution and `afterAction` after; adapters SHALL NOT bypass, cache, or pre-approve governance decisions | §10 invariant 8 |
| AA-10.10 | `AdapterRegistry.discover()` SHALL return candidates but SHALL NOT load or execute them; registration SHALL require explicit `register()` call with a verified adapter instance | §10 invariant 9 |
| AA-10.11 | Each adapter SHALL declare `minLimenVersion` and `maxLimenVersion` in its metadata; the registry SHALL reject adapters incompatible with the running Limen version | §10 invariant 10 |
| AA-10.12 | An adapter's effective capabilities SHALL be the intersection of its declared capabilities and those unlocked by its `AgentTrustLevel`; an adapter at `low` trust SHALL NOT exercise `computer_use` regardless of declaration | §10 invariant 11 |
| AA-10.13 | `translateActionToGovernance` SHALL produce a valid `ComputerAction` union member with all `ActionBase` fields populated; partial or malformed output SHALL be a translation failure | §10 invariant 12 |

---

## §11 Error Taxonomy

| ID | Requirement | Source |
|---|---|---|
| AA-11.01 | `AdapterErrorCode` SHALL include code `'NOT_INITIALIZED'` | §11 |
| AA-11.02 | `AdapterErrorCode` SHALL include code `'ALREADY_INITIALIZED'` | §11 |
| AA-11.03 | `AdapterErrorCode` SHALL include code `'SHUTDOWN_FAILED'` | §11 |
| AA-11.04 | `AdapterErrorCode` SHALL include code `'TRANSLATION_FAILED'` | §11 |
| AA-11.05 | `AdapterErrorCode` SHALL include code `'UNKNOWN_TOOL'` | §11 |
| AA-11.06 | `AdapterErrorCode` SHALL include code `'CAPABILITY_NOT_DECLARED'` | §11 |
| AA-11.07 | `AdapterErrorCode` SHALL include code `'GOVERNANCE_REFUSAL'` | §11 |
| AA-11.08 | `AdapterErrorCode` SHALL include code `'SESSION_NOT_FOUND'` | §11 |
| AA-11.09 | `AdapterErrorCode` SHALL include code `'MAX_SESSIONS_EXCEEDED'` | §11 |
| AA-11.10 | `AdapterErrorCode` SHALL include code `'TRUST_LEVEL_INSUFFICIENT'` | §11 |
| AA-11.11 | `AdapterErrorCode` SHALL include code `'CLIENT_ERROR'` | §11 |
| AA-11.12 | `AdapterErrorCode` SHALL include code `'INTERNAL'` | §11 |
| AA-11.13 | `AdapterErrorCode` SHALL have exactly 12 values | §11 |
| AA-11.14 | `AdapterKernelError` SHALL have readonly fields: `code: AdapterErrorCode`, `message: string`, `adapterId: AdapterId` | §11 |
| AA-11.15 | `AdapterKernelError` SHALL have an optional `context` field of type `Readonly<Record<string, unknown>>` | §11 |

---

## §12 Sequence Diagrams

### §12.1 Tool Call Flow

| ID | Requirement | Source |
|---|---|---|
| AA-12.01 | Tool call flow SHALL begin with Agent Framework calling `Adapter.translateToolCall(toolCall)` | §12.1 |
| AA-12.02 | Adapter SHALL parse native format during translation | §12.1 |
| AA-12.03 | Adapter SHALL map parsed tool call to `LimenOperation[]` | §12.1 |
| AA-12.04 | For each operation requiring governance, adapter SHALL call `Governor.beforeAction(ComputerAction)` | §12.1 |
| AA-12.05 | Governor SHALL evaluate against `RefusalRules`, `RateLimitPolicy`, and trust level, returning `GovernanceVerdict` | §12.1 |
| AA-12.06 | If verdict is `'refuse'`, adapter SHALL return `Result.err(GOVERNANCE_REFUSAL)` | §12.1 |
| AA-12.07 | If verdict is `'sandbox'`, adapter SHALL execute within `SandboxConfig` constraints | §12.1 |
| AA-12.08 | If verdict is `'escalate'`, adapter SHALL return `Result.err` with escalation info | §12.1 |
| AA-12.09 | After governance-gated operation completes, adapter SHALL call `Governor.afterAction(action, result)` | §12.1 |
| AA-12.10 | Adapter SHALL call `EventBus.emit(AgentEventPayload)` for every operation | §12.1 |

### §12.2 Action Translation Flow

| ID | Requirement | Source |
|---|---|---|
| AA-12.11 | `NativeAgentAction` SHALL contain: `adapterId`, `agentId`, `sessionId`, `nativeType`, `nativePayload`, `timestamp` | §12.2 |
| AA-12.12 | Adapter SHALL map `nativeType` to `ComputerActionType` (17 variants) | §12.2 |
| AA-12.13 | Adapter SHALL populate `ActionBase` fields from session state | §12.2 |
| AA-12.14 | Adapter SHALL construct variant-specific fields from `nativePayload` | §12.2 |
| AA-12.15 | Output of translation SHALL be a canonical, fully populated `ComputerAction` | §12.2 |

### §12.3 Session Lifecycle

| ID | Requirement | Source |
|---|---|---|
| AA-12.16 | Session start SHALL begin with `Adapter.onAgentSessionStart(nativeSession)` | §12.3 |
| AA-12.17 | Session start SHALL derive `AgentTrustLevel` from config | §12.3 |
| AA-12.18 | Session start SHALL compute effective capabilities as intersection of declared and trust-unlocked | §12.3 |
| AA-12.19 | Session start SHALL call `LimenAgentClient.startSession(...)` and return `AgentSession` | §12.3 |
| AA-12.20 | Session end SHALL call `Adapter.onAgentSessionEnd(nativeSession)` | §12.3 |
| AA-12.21 | Session end SHALL call `LimenAgentClient.endSession(sessionId)` | §12.3 |
| AA-12.22 | Session end SHALL return `SessionSummary` | §12.3 |

### §12.4 Adapter Registration Flow

| ID | Requirement | Source |
|---|---|---|
| AA-12.23 | Registration flow SHALL begin with `AdapterRegistry.discover()` returning `DiscoveredAdapter[]` candidates | §12.4 |
| AA-12.24 | For each approved candidate, the system SHALL instantiate the adapter then call `AdapterRegistry.register(adapter)` | §12.4 |
| AA-12.25 | Registration SHALL validate required methods, validate no duplicate framework, expand refusal hints to full rules, expand sandbox defaults | §12.4 |
| AA-12.26 | After successful registration, the system SHALL call `adapter.initialize(client, governor, config)` | §12.4 |
| AA-12.27 | Initialization SHALL return `Result.ok()` to indicate the adapter is live | §12.4 |
| AA-12.28 | Adapter SHALL dispatch each `LimenOperation` to `LimenAgentClient.<operation>()` for execution | §12.1 |
| AA-12.29 | Adapter SHALL return `Result.ok(results)` with aggregated operation results after all operations complete | §12.1 |
| AA-12.30 | During an active session (between `onAgentSessionStart` and `onAgentSessionEnd`), the agent MAY invoke `translateToolCall` N times; each invocation follows the §12.1 tool call flow | §12.3 |

---

## §INV Rate Limit Invariant

| ID | Requirement | Source |
|---|---|---|
| AA-INV.01 | Every adapter SHALL be governed by `DEFAULT_RATE_LIMITS` plus adapter-specific stricter limits; adapters SHALL NOT disable, bypass, or locally reset rate counters | §10 invariant 13 |
| AA-INV.02 | Rate limits enforcement SHALL be inherited — not configurable to be weaker than defaults | §10 invariant 13, §4.1 |

---

## Summary

| Section | Count |
|---|---|
| §1 Purpose | 6 |
| §2 Shared Type References | 5 |
| §3 AgentAdapter Interface | 40 |
| §4 Adapter Configuration | 25 |
| §5 Translation Types | 32 |
| §6 Adapter Registry | 24 |
| §7 Reference Adapter Specifications | 55 |
| §8 Adapter Development Contract | 24 |
| §9 Rust Types | 38 |
| §10 Invariants | 13 |
| §11 Error Taxonomy | 15 |
| §12 Sequence Diagrams | 30 |
| §INV Rate Limit Invariant | 2 |
| **GRAND TOTAL** | **309** |
