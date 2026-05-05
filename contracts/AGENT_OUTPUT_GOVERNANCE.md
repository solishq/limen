# Agent Output Governance Contract v1.0.0

**Status:** RATIFIED DESIGN — Pending Implementation
**Governing:** CDM v2.1 + Contract Compliance v2.1
**Scope:** Output primitives, telemetry, structured inference, plugin lifecycle, and hook governance
**Classification:** QAL-4

> **Shared Types:** All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`. This contract does NOT redefine any shared type. Local types are contract-specific and not used by other contracts.

---

## 1. Purpose

This contract governs how agents produce structured semantic outputs, record operational telemetry, perform schema-validated inference with automatic retry, and interact with the plugin/hook extension system. All operations execute within governance boundaries (classification, confidence ceilings, audit), ensuring every agent-produced artifact is a governed claim subject to CCP invariants, FSRS decay, and retention policy enforcement.

**Five Questions:** Spec requires governed output, telemetry, inference, plugin, and hook lifecycle. Failures: unsupported assertion, budget blind spot, schema drift, plugin over-capability, hook cascade. Consequence: unsafe output or extension behavior becomes trusted. Assumption: named output, telemetry, infer, install, and hook internals exist behind Limen services. Hostile review target: prove validation, budget, and isolation happen before success.

---

## 2. Shared Type References

| Type | Source | Usage in This Contract |
|---|---|---|
| `ClaimId` | SHARED_TYPES 1.1b | Output entry identity, retraction target |
| `AgentId` | SHARED_TYPES 1.1a | Output attribution, telemetry scoping |
| `SessionId` | SHARED_TYPES 1.1a | Session-scoped telemetry aggregation |
| `MissionId` | SHARED_TYPES 1.1a | Mission-scoped cost tracking |
| `TaskId` | SHARED_TYPES 1.1a | Task-scoped cost attribution |
| `EventId` | SHARED_TYPES 1.1a | Audit entry linkage |
| `ClassificationLevel` | SHARED_TYPES 3 | Output classification enforcement |
| `Result<T>` | SHARED_TYPES 1.5 | All method return types |
| `KernelError` | SHARED_TYPES 1.4 | Error propagation |
| `AgentEvent` | SHARED_TYPES 16.1 | Event emission typing |
| `AgentEventHandler` | SHARED_TYPES 16.2 | Subscription handler signature |
| `AgentEventPayload` | SHARED_TYPES 16.2 | Event payload structure |
| `OperationContext` | SHARED_TYPES 1.3 | Governance evaluation context |
| `GovernanceDecision` | SHARED_TYPES 10.1 | Hook/plugin governance verdicts |
| `Permission` | SHARED_TYPES 1.2 | Capability-gated operations |
| `RetentionPolicy` | SHARED_TYPES 17 | Output retention lifecycle |
| `AgentCapability` | SHARED_TYPES 6 | Plugin installation gating |

---

## 3. AgentOutputClient Interface

```typescript
interface AgentOutputClient {
  // --- Output Primitives ---
  produce(ctx: OperationContext, type: OutputType, content: string, options?: OutputOptions): Promise<Result<OutputEntry>>;
  queryOutputs(ctx: OperationContext, filter: OutputFilter): Promise<Result<OutputEntry[]>>;
  retractOutput(ctx: OperationContext, outputId: ClaimId, reason: string): Promise<Result<void>>;

  // --- Telemetry ---
  recordCost(ctx: OperationContext, data: CostRecord): Promise<Result<void>>;
  recordVital(ctx: OperationContext, data: VitalRecord): Promise<Result<void>>;
  queryCosts(ctx: OperationContext, filter: CostFilter): Promise<Result<CostRecord[]>>;
  queryVitals(ctx: OperationContext, filter: VitalFilter): Promise<Result<VitalRecord[]>>;
  getBudgetConsumption(ctx: OperationContext): Promise<Result<BudgetConsumption>>;

  // --- Structured Inference ---
  infer<T>(ctx: OperationContext, options: InferenceOptions<T>): Promise<Result<InferenceResult<T>>>;

  // --- Plugin/Hook Lifecycle ---
  installPlugin(ctx: OperationContext, plugin: AgentPlugin, config?: PluginConfig): Promise<Result<string>>;
  uninstallPlugin(ctx: OperationContext, pluginId: string): Promise<Result<void>>;
  listPlugins(ctx: OperationContext): Promise<Result<PluginRegistration[]>>;
  registerHook(ctx: OperationContext, hook: AgentHook): Promise<Result<string>>;
  unregisterHook(ctx: OperationContext, hookId: string): Promise<Result<void>>;
  listHooks(ctx: OperationContext): Promise<Result<HookRegistration[]>>;

  // --- Events ---
  on(ctx: OperationContext, event: OutputEvent, handler: AgentEventHandler): string;
  off(ctx: OperationContext, subscriptionId: string): void;
}
```

---

## 4. Output Primitive Data Models

### 4.1 OutputType

```typescript
export type OutputType =
  | 'assertion'
  | 'judgment'
  | 'evidence'
  | 'action'
  | 'question'
  | 'alert'
  | 'narrative';
```

**Semantic definitions:**

| Type | Agent Intent | Predicate Format |
|---|---|---|
| `assertion` | States something is true | `output.assertion` |
| `judgment` | Evaluates or scores something | `output.judgment` |
| `evidence` | Presents supporting data | `output.evidence` |
| `action` | Records what it did | `output.action` |
| `question` | Records what it does not know | `output.question` |
| `alert` | Flags something for attention | `output.alert` |
| `narrative` | Tells a story or explains | `output.narrative` |

### 4.2 OutputOptions

```typescript
export interface OutputOptions {
  readonly confidence?: number;
  readonly classification?: ClassificationLevel;
  readonly missionId?: MissionId;
  readonly reasoning?: string;
  readonly relatedClaims?: readonly ClaimId[];
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}
```

**Validation rules:**
- `confidence` clamped to [0, 0.7] — agent-produced outputs cannot exceed the 0.7 ceiling (Invariant 2).
- `classification` defaults to `'internal'` when omitted.
- `relatedClaims` creates `derived_from` relationships to the referenced claims.

### 4.3 OutputEntry

```typescript
export interface OutputEntry {
  readonly id: ClaimId;
  readonly type: OutputType;
  readonly content: string;
  readonly confidence: number;
  readonly classification: ClassificationLevel;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly missionId: MissionId | null;
  readonly reasoning: string | null;
  readonly relatedClaims: readonly ClaimId[];
  readonly tags: readonly string[];
  readonly createdAt: string; // ISO-8601
  readonly status: 'active' | 'retracted';
}
```

**Validation rules:**
- `content` must be non-empty (min 1 character, max 32768 characters).
- `confidence` is stored as-is after ceiling enforcement.
- `status` transitions: `active` -> `retracted` (terminal, irreversible).

### 4.4 OutputFilter

```typescript
export interface OutputFilter {
  readonly type?: OutputType | readonly OutputType[];
  readonly agentId?: AgentId;
  readonly sessionId?: SessionId;
  readonly missionId?: MissionId;
  readonly timeRange?: { readonly from: string; readonly to: string };
  readonly status?: 'active' | 'retracted' | 'all';
  readonly tags?: readonly string[];
  readonly minConfidence?: number;
  readonly limit?: number;
  readonly offset?: number;
}
```

**Defaults:** `status: 'active'`, `limit: 50`, `offset: 0`.

---

## 5. Telemetry Data Models

### 5.1 CostRecord

```typescript
export interface CostRecord {
  readonly id: ClaimId;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cost: number;
  readonly currency: string;
  readonly duration: number; // ms
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly missionId: MissionId | null;
  readonly taskId: TaskId | null;
  readonly timestamp: string; // ISO-8601
}
```

**Validation rules:**
- `inputTokens`, `outputTokens`, `totalTokens` are non-negative integers.
- `totalTokens` must equal `inputTokens + outputTokens`.
- `cost` is non-negative (zero permitted for free-tier calls).
- `duration` is non-negative (zero permitted for cached responses).
- Stored as governed claim with predicate `telemetry.cost`.

### 5.2 VitalRecord

```typescript
export interface VitalRecord {
  readonly id: ClaimId;
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly timestamp: string; // ISO-8601
}
```

**Validation rules:**
- `metric` must be non-empty, dot-delimited (e.g., `throughput.requests`, `latency.p99`).
- `unit` must be non-empty (e.g., `ms`, `req/s`, `bytes`, `count`).
- Stored as governed claim with predicate `telemetry.vital`.

### 5.3 CostFilter

```typescript
export interface CostFilter {
  readonly provider?: string;
  readonly model?: string;
  readonly agentId?: AgentId;
  readonly sessionId?: SessionId;
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly timeRange?: { readonly from: string; readonly to: string };
  readonly limit?: number;
  readonly offset?: number;
}
```

### 5.4 VitalFilter

```typescript
export interface VitalFilter {
  readonly metric?: string;
  readonly agentId?: AgentId;
  readonly sessionId?: SessionId;
  readonly tags?: Readonly<Record<string, string>>;
  readonly timeRange?: { readonly from: string; readonly to: string };
  readonly limit?: number;
  readonly offset?: number;
}
```

### 5.5 BudgetConsumption

```typescript
export interface BudgetConsumption {
  readonly session: { readonly tokens: number; readonly cost: number };
  readonly mission: { readonly tokens: number; readonly cost: number } | null;
  readonly lifetime: { readonly tokens: number; readonly cost: number };
  readonly quotaRemaining: { readonly tokens: number | null; readonly cost: number | null };
}
```

**Validation rules:**
- `quotaRemaining` fields are `null` when no budget is configured for that dimension.
- All numeric values are non-negative.

---

## 6. Structured Inference Data Models

### 6.1 InferenceOptions\<T\>

```typescript
export interface InferenceOptions<T> {
  readonly prompt: string;
  readonly schema: JsonSchema | ZodSchema<T>;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxRetries?: number; // default: 2
  readonly strict?: boolean; // default: true
  readonly timeout?: number; // ms, default: 30000
  readonly classification?: ClassificationLevel;
  readonly missionId?: MissionId;
}
```

**Validation rules:**
- `prompt` must be non-empty (min 1 character).
- `temperature` clamped to [0, 2.0].
- `maxRetries` clamped to [0, 5].
- `timeout` clamped to [1000, 300000] ms.
- `strict` enables strict JSON mode on providers that support it.

### 6.2 InferenceResult\<T\>

```typescript
export interface InferenceResult<T> {
  readonly value: T;
  readonly raw: string;
  readonly retries: number;
  readonly validationErrors: readonly ValidationError[];
  readonly duration: number; // ms, total across all attempts
  readonly cost: CostRecord;
}
```

**Validation rules:**
- `retries` is the count of failed attempts before the successful parse.
- `validationErrors` contains errors from ALL failed attempts (not just the last).
- `cost` is the aggregate across all attempts (input/output tokens summed).

### 6.3 ValidationError

```typescript
export interface ValidationError {
  readonly path: string;
  readonly message: string;
  readonly attempt: number; // 1-indexed
}
```

### 6.4 Retry Protocol

On schema validation failure:

1. Collect all `ValidationError` entries from the failed parse.
2. Append a structured correction block to the prompt:
   ```
   [VALIDATION ERRORS FROM ATTEMPT {N}]
   - path: {path}, error: {message}
   ...
   Please fix these issues and return valid JSON matching the schema.
   ```
3. Re-invoke the model with the augmented prompt.
4. If `maxRetries` exhausted: return `INFERENCE_RETRIES_EXHAUSTED` error with all accumulated `ValidationError` entries.

---

## 7. Plugin/Hook Data Models

### 7.1 AgentPlugin

```typescript
export interface AgentPlugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly string[];
  install(context: PluginContext): Promise<void>;
  destroy(): Promise<void>;
}
```

**Validation rules:**
- `id` must be unique across all installed plugins (UUID recommended).
- `name` must be non-empty, max 128 characters.
- `version` must be valid semver.
- `capabilities` declares what the plugin needs; validated against agent capabilities at install time.

### 7.2 PluginContext

```typescript
export interface PluginContext {
  on(event: AgentEvent, handler: AgentEventHandler): string;
  off(subscriptionId: string): void;
  readonly api: PluginApi;
  readonly logger: PluginLogger;
}

export interface PluginApi {
  queryOutputs(filter: OutputFilter): Promise<Result<OutputEntry[]>>;
  queryVitals(filter: VitalFilter): Promise<Result<VitalRecord[]>>;
  queryCosts(filter: CostFilter): Promise<Result<CostRecord[]>>;
}

export interface PluginLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}
```

**Validation rules:**
- `PluginApi` exposes read-only operations only. Plugins cannot produce outputs or record telemetry directly; they must request the agent to do so via events.
- `PluginLogger` writes are tagged with the plugin ID for isolation.

### 7.3 PluginConfig

```typescript
export interface PluginConfig {
  readonly enabled: boolean;
  readonly priority: number; // 0-100, lower = higher priority
  readonly isolation: 'shared' | 'sandboxed';
  readonly errorPolicy: 'propagate' | 'contain' | 'disable_on_error';
  readonly maxErrorCount?: number; // default: 3, triggers disable_on_error
}
```

**Defaults:** `enabled: true`, `priority: 50`, `isolation: 'shared'`, `errorPolicy: 'contain'`, `maxErrorCount: 3`.

### 7.4 PluginRegistration

```typescript
export interface PluginRegistration {
  readonly pluginId: string;
  readonly name: string;
  readonly version: string;
  readonly status: 'active' | 'disabled' | 'error';
  readonly installedAt: string; // ISO-8601
  readonly errorCount: number;
  readonly lastError: string | null;
  readonly config: PluginConfig;
}
```

### 7.5 HookType

```typescript
export type HookType =
  | 'before_assert'
  | 'after_assert'
  | 'before_recall'
  | 'after_recall'
  | 'before_decay'
  | 'before_output'
  | 'after_output';
```

### 7.6 AgentHook

```typescript
export interface AgentHook {
  readonly type: HookType;
  readonly priority: number; // 0-100, lower fires first
  readonly name: string;
  readonly handler: HookHandler;
}
```

### 7.7 HookHandler and HookResult

```typescript
export type HookHandler = (context: HookContext) => Promise<HookResult>;

export interface HookContext {
  readonly hookType: HookType;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly timestamp: string; // ISO-8601
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface HookResult {
  readonly proceed: boolean;
  readonly modified?: Readonly<Record<string, unknown>>;
  readonly reason?: string;
}
```

**Validation rules:**
- `proceed: false` blocks the operation. An audit entry is emitted with `reason`.
- `modified` replaces the original payload if present and `proceed: true`. Must conform to the same schema as the original payload.
- If handler throws or exceeds 5000ms timeout: treated as `{ proceed: true }` with a warning audit entry.

### 7.8 HookRegistration

```typescript
export interface HookRegistration {
  readonly hookId: string;
  readonly type: HookType;
  readonly priority: number;
  readonly name: string;
  readonly registeredAt: string; // ISO-8601
  readonly firedCount: number;
  readonly blockedCount: number;
  readonly lastFiredAt: string | null;
  readonly errorCount: number;
}
```

---

## 8. Output Events

```typescript
export type OutputEvent =
  | 'output:produced'
  | 'output:retracted'
  | 'telemetry:cost_recorded'
  | 'telemetry:vital_recorded'
  | 'inference:started'
  | 'inference:completed'
  | 'inference:retry'
  | 'inference:failed'
  | 'plugin:installed'
  | 'plugin:uninstalled'
  | 'plugin:error'
  | 'hook:registered'
  | 'hook:fired'
  | 'hook:blocked';
```

**Event payload data fields:**

| Event | `data` Contents |
|---|---|
| `output:produced` | `{ outputId: ClaimId, type: OutputType, confidence: number }` |
| `output:retracted` | `{ outputId: ClaimId, reason: string }` |
| `telemetry:cost_recorded` | `{ costId: ClaimId, totalTokens: number, cost: number }` |
| `telemetry:vital_recorded` | `{ vitalId: ClaimId, metric: string, value: number }` |
| `inference:started` | `{ model: string, promptLength: number }` |
| `inference:completed` | `{ model: string, retries: number, duration: number }` |
| `inference:retry` | `{ attempt: number, errors: ValidationError[] }` |
| `inference:failed` | `{ reason: string, attempts: number, errors: ValidationError[] }` |
| `plugin:installed` | `{ pluginId: string, name: string, version: string }` |
| `plugin:uninstalled` | `{ pluginId: string, name: string }` |
| `plugin:error` | `{ pluginId: string, error: string, errorCount: number }` |
| `hook:registered` | `{ hookId: string, type: HookType, priority: number }` |
| `hook:fired` | `{ hookId: string, type: HookType, proceed: boolean }` |
| `hook:blocked` | `{ hookId: string, type: HookType, reason: string }` |

---

## 9. Error Types

```typescript
export type OutputGovernanceError =
  | { readonly code: 'OUTPUT_VALIDATION_FAILED'; readonly message: string; readonly spec: 'AOG-4'; readonly violations: readonly OutputValidationViolation[] }
  | { readonly code: 'OUTPUT_CONTENT_EMPTY'; readonly message: string; readonly spec: 'AOG-4.3' }
  | { readonly code: 'OUTPUT_CONTENT_TOO_LARGE'; readonly message: string; readonly spec: 'AOG-4.3'; readonly maxBytes: number }
  | { readonly code: 'INFERENCE_TIMEOUT'; readonly message: string; readonly spec: 'AOG-6.1'; readonly timeoutMs: number; readonly elapsed: number }
  | { readonly code: 'INFERENCE_SCHEMA_VIOLATION'; readonly message: string; readonly spec: 'AOG-6.3'; readonly errors: readonly ValidationError[] }
  | { readonly code: 'INFERENCE_RETRIES_EXHAUSTED'; readonly message: string; readonly spec: 'AOG-6.4'; readonly attempts: number; readonly errors: readonly ValidationError[] }
  | { readonly code: 'PLUGIN_INSTALL_FAILED'; readonly message: string; readonly spec: 'AOG-7.1'; readonly pluginId: string; readonly reason: string }
  | { readonly code: 'PLUGIN_NOT_FOUND'; readonly message: string; readonly spec: 'AOG-7.4'; readonly pluginId: string }
  | { readonly code: 'PLUGIN_CAPABILITY_DENIED'; readonly message: string; readonly spec: 'AOG-7.1'; readonly required: readonly string[]; readonly available: readonly string[] }
  | { readonly code: 'HOOK_EXECUTION_FAILED'; readonly message: string; readonly spec: 'AOG-7.7'; readonly hookId: string; readonly error: string }
  | { readonly code: 'HOOK_BLOCKED_OPERATION'; readonly message: string; readonly spec: 'AOG-7.7'; readonly hookId: string; readonly hookType: HookType; readonly reason: string }
  | { readonly code: 'HOOK_NOT_FOUND'; readonly message: string; readonly spec: 'AOG-7.8'; readonly hookId: string }
  | { readonly code: 'TELEMETRY_WRITE_FAILED'; readonly message: string; readonly spec: 'AOG-5'; readonly reason: string }
  | { readonly code: 'GOVERNANCE_REFUSAL'; readonly message: string; readonly spec: 'AOG-12'; readonly decision: GovernanceDecision };

export interface OutputValidationViolation {
  readonly field: string;
  readonly constraint: string;
  readonly actual: string;
}
```

---

## 10. Rust Trait

```rust
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

// --- Local types (not in SHARED_TYPES Rust section) ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputType {
    Assertion,
    Judgment,
    Evidence,
    Action,
    Question,
    Alert,
    Narrative,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputOptions {
    pub confidence: Option<f64>,
    pub classification: Option<ClassificationLevel>,
    pub mission_id: Option<MissionId>,
    pub reasoning: Option<String>,
    pub related_claims: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub metadata: Option<JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputEntry {
    pub id: String,
    pub output_type: OutputType,
    pub content: String,
    pub confidence: f64,
    pub classification: ClassificationLevel,
    pub agent_id: AgentId,
    pub session_id: SessionId,
    pub mission_id: Option<MissionId>,
    pub reasoning: Option<String>,
    pub related_claims: Vec<String>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub status: OutputStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputStatus {
    Active,
    Retracted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputFilter {
    pub output_type: Option<Vec<OutputType>>,
    pub agent_id: Option<AgentId>,
    pub session_id: Option<SessionId>,
    pub mission_id: Option<MissionId>,
    pub time_range: Option<TimeRange>,
    pub status: Option<String>,
    pub tags: Option<Vec<String>>,
    pub min_confidence: Option<f64>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeRange {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostRecord {
    pub id: String,
    pub provider: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub cost: f64,
    pub currency: String,
    pub duration: u64,
    pub agent_id: AgentId,
    pub session_id: SessionId,
    pub mission_id: Option<MissionId>,
    pub task_id: Option<TaskId>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VitalRecord {
    pub id: String,
    pub metric: String,
    pub value: f64,
    pub unit: String,
    pub tags: std::collections::HashMap<String, String>,
    pub agent_id: AgentId,
    pub session_id: SessionId,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetConsumption {
    pub session: TokenCostPair,
    pub mission: Option<TokenCostPair>,
    pub lifetime: TokenCostPair,
    pub quota_remaining: QuotaRemaining,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenCostPair {
    pub tokens: u64,
    pub cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaRemaining {
    pub tokens: Option<u64>,
    pub cost: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceOptions {
    pub prompt: String,
    pub schema: JsonValue,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_retries: Option<u8>,
    pub strict: Option<bool>,
    pub timeout_ms: Option<u64>,
    pub classification: Option<ClassificationLevel>,
    pub mission_id: Option<MissionId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceResult {
    pub value: JsonValue,
    pub raw: String,
    pub retries: u8,
    pub validation_errors: Vec<ValidationError>,
    pub duration: u64,
    pub cost: CostRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationError {
    pub path: String,
    pub message: String,
    pub attempt: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookResult {
    pub proceed: bool,
    pub modified: Option<JsonValue>,
    pub reason: Option<String>,
}

// --- Trait ---

#[async_trait]
pub trait AgentOutputGovernor: Send + Sync {
    // Output Primitives
    async fn produce(
        &self,
        ctx: &OperationContext,
        output_type: OutputType,
        content: &str,
        options: Option<OutputOptions>,
    ) -> Result<OutputEntry, OutputGovernanceError>;

    async fn query_outputs(
        &self,
        ctx: &OperationContext,
        filter: OutputFilter,
    ) -> Result<Vec<OutputEntry>, OutputGovernanceError>;

    async fn retract_output(
        &self,
        ctx: &OperationContext,
        output_id: &str,
        reason: &str,
    ) -> Result<(), OutputGovernanceError>;

    // Telemetry
    async fn record_cost(
        &self,
        ctx: &OperationContext,
        data: CostRecord,
    ) -> Result<(), OutputGovernanceError>;

    async fn record_vital(
        &self,
        ctx: &OperationContext,
        data: VitalRecord,
    ) -> Result<(), OutputGovernanceError>;

    async fn query_costs(
        &self,
        ctx: &OperationContext,
        filter: CostFilter,
    ) -> Result<Vec<CostRecord>, OutputGovernanceError>;

    async fn query_vitals(
        &self,
        ctx: &OperationContext,
        filter: VitalFilter,
    ) -> Result<Vec<VitalRecord>, OutputGovernanceError>;

    async fn get_budget_consumption(
        &self,
        ctx: &OperationContext,
    ) -> Result<BudgetConsumption, OutputGovernanceError>;

    // Structured Inference
    async fn infer(
        &self,
        ctx: &OperationContext,
        options: InferenceOptions,
    ) -> Result<InferenceResult, OutputGovernanceError>;

    // Plugin Lifecycle
    async fn install_plugin(
        &self,
        ctx: &OperationContext,
        plugin_manifest: PluginManifest,
        config: Option<PluginConfig>,
    ) -> Result<String, OutputGovernanceError>;

    async fn uninstall_plugin(
        &self,
        ctx: &OperationContext,
        plugin_id: &str,
    ) -> Result<(), OutputGovernanceError>;

    async fn list_plugins(
        &self,
        ctx: &OperationContext,
    ) -> Result<Vec<PluginRegistration>, OutputGovernanceError>;

    // Hook Lifecycle
    async fn register_hook(
        &self,
        ctx: &OperationContext,
        hook_type: HookType,
        priority: u8,
        name: &str,
    ) -> Result<String, OutputGovernanceError>;

    async fn unregister_hook(
        &self,
        ctx: &OperationContext,
        hook_id: &str,
    ) -> Result<(), OutputGovernanceError>;

    async fn list_hooks(
        &self,
        ctx: &OperationContext,
    ) -> Result<Vec<HookRegistration>, OutputGovernanceError>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginConfig {
    pub enabled: bool,
    pub priority: u8,
    pub isolation: PluginIsolation,
    pub error_policy: ErrorPolicy,
    pub max_error_count: Option<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginIsolation {
    Shared,
    Sandboxed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorPolicy {
    Propagate,
    Contain,
    DisableOnError,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRegistration {
    pub plugin_id: String,
    pub name: String,
    pub version: String,
    pub status: PluginStatus,
    pub installed_at: String,
    pub error_count: u32,
    pub last_error: Option<String>,
    pub config: PluginConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginStatus {
    Active,
    Disabled,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HookType {
    BeforeAssert,
    AfterAssert,
    BeforeRecall,
    AfterRecall,
    BeforeDecay,
    BeforeOutput,
    AfterOutput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookRegistration {
    pub hook_id: String,
    pub hook_type: HookType,
    pub priority: u8,
    pub name: String,
    pub registered_at: String,
    pub fired_count: u64,
    pub blocked_count: u64,
    pub last_fired_at: Option<String>,
    pub error_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostFilter {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub agent_id: Option<AgentId>,
    pub session_id: Option<SessionId>,
    pub mission_id: Option<MissionId>,
    pub task_id: Option<TaskId>,
    pub time_range: Option<TimeRange>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VitalFilter {
    pub metric: Option<String>,
    pub agent_id: Option<AgentId>,
    pub session_id: Option<SessionId>,
    pub tags: Option<std::collections::HashMap<String, String>>,
    pub time_range: Option<TimeRange>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OutputGovernanceError {
    OutputValidationFailed { message: String, violations: Vec<OutputValidationViolation> },
    OutputContentEmpty { message: String },
    OutputContentTooLarge { message: String, max_bytes: u64 },
    InferenceTimeout { message: String, timeout_ms: u64, elapsed: u64 },
    InferenceSchemaViolation { message: String, errors: Vec<ValidationError> },
    InferenceRetriesExhausted { message: String, attempts: u8, errors: Vec<ValidationError> },
    PluginInstallFailed { message: String, plugin_id: String, reason: String },
    PluginNotFound { message: String, plugin_id: String },
    PluginCapabilityDenied { message: String, required: Vec<String>, available: Vec<String> },
    HookExecutionFailed { message: String, hook_id: String, error: String },
    HookBlockedOperation { message: String, hook_id: String, hook_type: HookType, reason: String },
    HookNotFound { message: String, hook_id: String },
    TelemetryWriteFailed { message: String, reason: String },
    GovernanceRefusal { message: String, decision: GovernanceDecision },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputValidationViolation {
    pub field: String,
    pub constraint: String,
    pub actual: String,
}
```

---

## 11. Integration Map

| Method | Limen Internal | Predicate | Governance Domain |
|---|---|---|---|
| `produce` | SC-11 (`assert_claim`) | `output.<type>` | `{ domain: 'output', operation: 'produce' }` |
| `queryOutputs` | SC-13 (`query_claims`) | `output.*` filter | `{ domain: 'output', operation: 'produce' }` (read) |
| `retractOutput` | SC-12 (`retract_claim`) | `output.<type>` | `{ domain: 'output', operation: 'produce' }` |
| `recordCost` | SC-11 (`assert_claim`) | `telemetry.cost` | `{ domain: 'output', operation: 'telemetry' }` |
| `recordVital` | SC-11 (`assert_claim`) | `telemetry.vital` | `{ domain: 'output', operation: 'telemetry' }` |
| `queryCosts` | SC-13 (`query_claims`) | `telemetry.cost` filter | `{ domain: 'output', operation: 'telemetry' }` (read) |
| `queryVitals` | SC-13 (`query_claims`) | `telemetry.vital` filter | `{ domain: 'output', operation: 'telemetry' }` (read) |
| `getBudgetConsumption` | Aggregation over `telemetry.cost` claims | N/A | `{ domain: 'output', operation: 'telemetry' }` (read) |
| `infer` | LLM gateway + Zod/JSON schema validation + retry loop | N/A (cost auto-recorded) | `{ domain: 'output', operation: 'infer' }` |
| `installPlugin` | `plugin_registry.install()` + capability validation | N/A | `{ domain: 'output', operation: 'plugin' }` |
| `uninstallPlugin` | `plugin_registry.uninstall()` | N/A | `{ domain: 'output', operation: 'plugin' }` |
| `listPlugins` | `plugin_registry.list()` | N/A | `{ domain: 'output', operation: 'plugin' }` (read) |
| `registerHook` | `hook_registry.register()` + priority ordering | N/A | `{ domain: 'output', operation: 'hook' }` |
| `unregisterHook` | `hook_registry.unregister()` | N/A | `{ domain: 'output', operation: 'hook' }` |
| `listHooks` | `hook_registry.list()` | N/A | `{ domain: 'output', operation: 'hook' }` (read) |

**Hook execution points:**

| Hook Type | Fires During |
|---|---|
| `before_assert` | Before any claim assertion (CCP pipeline) |
| `after_assert` | After successful claim assertion |
| `before_recall` | Before claim query execution |
| `after_recall` | After claim query returns results |
| `before_decay` | Before FSRS decay calculation runs |
| `before_output` | Before `produce()` persists the output claim |
| `after_output` | After `produce()` succeeds |

---

## 12. Invariants

1. **Outputs are claims.** All CCP invariants apply: confidence ceiling, FSRS decay, classification enforcement, retention policy, audit trail. An output is a claim with predicate `output.<type>`.

2. **Agent confidence ceiling.** Output confidence cannot exceed 0.7 for agent-produced outputs. If `options.confidence > 0.7`, it is clamped to 0.7. This mirrors the Memory Bridge ceiling for agent-asserted claims.

3. **Telemetry append-only.** Telemetry records (cost and vital) cannot be mutated or deleted after persistence. Retraction is not supported for telemetry claims. The only lifecycle transition is natural expiry via retention policy.

4. **Inference progressive refinement.** On validation failure, the retry prompt includes all previous validation errors. Each retry attempt sees the full error history, enabling the model to correct multiple issues simultaneously.

5. **Plugin error containment.** When `errorPolicy: 'contain'`, plugin errors are logged (audit entry emitted) but do not propagate to the caller. The plugin's `errorCount` increments. When `errorCount >= maxErrorCount`, plugin transitions to `'disabled'` status.

6. **Plugin isolation.** Sandboxed plugins (`isolation: 'sandboxed'`) receive an isolated `PluginContext` that cannot access other plugins' event subscriptions, logger namespaces, or API results scoped to other plugins.

7. **Hook deterministic ordering.** Hooks of the same type fire in priority order (lowest numeric value first). For equal priorities, registration order (earlier first) breaks ties. This ordering is deterministic and reproducible.

8. **Hook blocking audit.** A hook returning `proceed: false` blocks the operation. An audit entry of classification `internal` is emitted recording: hook ID, hook type, blocking reason, and the operation that was blocked. The caller receives `HOOK_BLOCKED_OPERATION` error.

9. **Plugin installation governance.** Installing a plugin requires `governance_admin` capability (`verified` trust level). Agents below `verified` trust cannot install plugins. Hooks can be registered by any agent with `memory_write` capability (`low` trust or above). **Rationale for asymmetry:** Plugins are full lifecycle extensions with access to the PluginContext API (read/write/search/connect), can subscribe to all events, and persist across operations — a compromised plugin can exfiltrate data or corrupt state. Hooks are single-operation interceptors with scoped context (one operation's input/output), no API access, and a 5-second timeout — their blast radius is bounded to one operation. The trust requirement reflects this difference in blast radius.

10. **Telemetry tenant isolation.** All telemetry queries are scoped to the requesting agent's tenant. No cross-tenant aggregation without explicit consent (verified via ConsentContext with purpose `'analytics'`).

11. **Inference cost always recorded.** Every `infer()` call records a `CostRecord` regardless of whether the inference succeeds, fails validation, or times out. Partial token consumption from failed attempts is included.

12. **Hook timeout safety.** Hook handlers have a 5000ms execution timeout. If exceeded, the hook is treated as returning `{ proceed: true }` (non-blocking). A warning audit entry is emitted. The hook's `errorCount` increments.

---

## Appendix A: Governance Action Registration

This contract introduces the following governance action to the `GovernanceAction` union (already registered in SHARED_TYPES 9):

```typescript
{ readonly domain: 'output'; readonly operation: 'produce' | 'telemetry' | 'infer' | 'plugin' | 'hook' }
```

**Permission requirements by operation:**

| Operation | Required Permission | Minimum Trust |
|---|---|---|
| `produce` | `assert_claim` | `low` |
| `telemetry` (write) | `assert_claim` | `low` |
| `telemetry` (read) | `view_telemetry` | `untrusted` |
| `infer` | `infer` | `low` |
| `plugin` (install/uninstall) | `governance_admin` | `verified` |
| `plugin` (list) | `view_telemetry` | `untrusted` |
| `hook` (register/unregister) | `assert_claim` | `low` |
| `hook` (list) | `view_telemetry` | `untrusted` |

---

## Appendix B: Version History

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-05-05 | Initial ratification. Output primitives, telemetry, inference, plugin/hook lifecycle. All 12 sections canonical. |
