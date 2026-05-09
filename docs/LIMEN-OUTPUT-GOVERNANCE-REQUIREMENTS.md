<!-- @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->
# Limen v5 -- AGENT_OUTPUT_GOVERNANCE.md Requirement Extraction

**Source:** `contracts/AGENT_OUTPUT_GOVERNANCE.md` v1.0.0
**Extracted:** 2026-05-09
**Governing Standard:** SolisForge Protocol v1.4
**Governance Tier:** Forge Critical
**Purpose:** Every implementable requirement from the Agent Output Governance contract.

---

## Section 1: Purpose & Scope

| ID | Requirement | Source |
|---|---|---|
| OG-1.1 | Contract governs structured semantic outputs, operational telemetry, schema-validated inference with automatic retry, and plugin/hook extension system | S1 |
| OG-1.2 | Contract classification is QAL-4 | Header |
| OG-1.3 | All operations execute within governance boundaries (classification, confidence ceilings, audit) | S1 |
| OG-1.4 | Every agent-produced artifact is a governed claim subject to CCP invariants, FSRS decay, and retention policy enforcement | S1 |
| OG-1.5 | All cross-contract types referenced are defined in `contracts/SHARED_TYPES.md`; this contract does NOT redefine any shared type | Preamble |

**Totals: 5 requirements**

---

## Section 2: Shared Type References

| ID | Requirement | Source |
|---|---|---|
| OG-2.1 | `ClaimId` from SHARED_TYPES 1.1b MUST be used for output entry identity and retraction target | S2 |
| OG-2.2 | `AgentId` from SHARED_TYPES 1.1a MUST be used for output attribution and telemetry scoping | S2 |
| OG-2.3 | `SessionId` from SHARED_TYPES 1.1a MUST be used for session-scoped telemetry aggregation | S2 |
| OG-2.4 | `MissionId` from SHARED_TYPES 1.1a MUST be used for mission-scoped cost tracking | S2 |
| OG-2.5 | `TaskId` from SHARED_TYPES 1.1a MUST be used for task-scoped cost attribution | S2 |
| OG-2.6 | `EventId` from SHARED_TYPES 1.1a MUST be used for audit entry linkage | S2 |
| OG-2.7 | `ClassificationLevel` from SHARED_TYPES 3 MUST be used for output classification enforcement | S2 |
| OG-2.8 | `Result<T>` from SHARED_TYPES 1.5 MUST be used for all method return types | S2 |
| OG-2.9 | `KernelError` from SHARED_TYPES 1.4 MUST be used for error propagation | S2 |
| OG-2.10 | `AgentEvent` from SHARED_TYPES 16.1 MUST be used for event emission typing | S2 |
| OG-2.11 | `AgentEventHandler` from SHARED_TYPES 16.2 MUST be used for subscription handler signature | S2 |
| OG-2.12 | `AgentEventPayload` from SHARED_TYPES 16.2 MUST be used for event payload structure | S2 |
| OG-2.13 | `OperationContext` from SHARED_TYPES 1.3 MUST be used for governance evaluation context | S2 |
| OG-2.14 | `GovernanceDecision` from SHARED_TYPES 10.1 MUST be used for hook/plugin governance verdicts | S2 |
| OG-2.15 | `RetentionPolicy` from SHARED_TYPES 17 MUST be used for output retention lifecycle | S2 |
| OG-2.16 | `AgentCapability` from SHARED_TYPES 6 MUST be used for plugin installation gating | S2 |

**Totals: 16 requirements**

---

## Section 3: AgentOutputClient Interface

| ID | Requirement | Source |
|---|---|---|
| OG-3.1 | `produce(ctx: OperationContext, type: OutputType, content: string, options?: OutputOptions)` MUST return `Promise<Result<OutputEntry>>` | S3 |
| OG-3.2 | `queryOutputs(ctx: OperationContext, filter: OutputFilter)` MUST return `Promise<Result<OutputEntry[]>>` | S3 |
| OG-3.3 | `retractOutput(ctx: OperationContext, outputId: ClaimId, reason: string)` MUST return `Promise<Result<void>>` | S3 |
| OG-3.4 | `recordCost(ctx: OperationContext, data: CostRecord)` MUST return `Promise<Result<void>>` | S3 |
| OG-3.5 | `recordVital(ctx: OperationContext, data: VitalRecord)` MUST return `Promise<Result<void>>` | S3 |
| OG-3.6 | `queryCosts(ctx: OperationContext, filter: CostFilter)` MUST return `Promise<Result<CostRecord[]>>` | S3 |
| OG-3.7 | `queryVitals(ctx: OperationContext, filter: VitalFilter)` MUST return `Promise<Result<VitalRecord[]>>` | S3 |
| OG-3.8 | `getBudgetConsumption(ctx: OperationContext)` MUST return `Promise<Result<BudgetConsumption>>` | S3 |
| OG-3.9 | `infer<T>(ctx: OperationContext, options: InferenceOptions<T>)` MUST return `Promise<Result<InferenceResult<T>>>` | S3 |
| OG-3.10 | `installPlugin(ctx: OperationContext, plugin: AgentPlugin, config?: PluginConfig)` MUST return `Promise<Result<string>>` | S3 |
| OG-3.11 | `uninstallPlugin(ctx: OperationContext, pluginId: string)` MUST return `Promise<Result<void>>` | S3 |
| OG-3.12 | `listPlugins(ctx: OperationContext)` MUST return `Promise<Result<PluginRegistration[]>>` | S3 |
| OG-3.13 | `registerHook(ctx: OperationContext, hook: AgentHook)` MUST return `Promise<Result<string>>` | S3 |
| OG-3.14 | `unregisterHook(ctx: OperationContext, hookId: string)` MUST return `Promise<Result<void>>` | S3 |
| OG-3.15 | `listHooks(ctx: OperationContext)` MUST return `Promise<Result<HookRegistration[]>>` | S3 |
| OG-3.16 | `on(ctx: OperationContext, event: OutputEvent, handler: AgentEventHandler)` MUST return subscription ID `string` | S3 |
| OG-3.17 | `off(ctx: OperationContext, subscriptionId: string)` MUST unsubscribe the handler | S3 |
| OG-3.18 | All interface methods MUST take `OperationContext` as first parameter. **NOTE (P3-7):** This requirement is derived/redundant — it restates the pattern already visible in OG-3.1 through OG-3.17 where every method signature includes `ctx: OperationContext`. Retained for explicitness but does not add a new constraint. | S3 |

> **NOTE (P1-3):** The `OperationContext` as first parameter pattern in this contract (OG-3.1-3.17) diverges from Memory Bridge (which uses `GovernanceContext` for mutating operations) and Context Governance (which only passes `OperationContext` for mutating operations, not reads). Output Governance passes `OperationContext` uniformly for ALL operations including reads (`queryOutputs`, `queryCosts`, `queryVitals`, `listPlugins`, `listHooks`). This is a deliberate design choice for telemetry scoping but creates a cross-contract inconsistency in the governance parameter model.

**Totals: 18 requirements**

---

## Section 4: Output Primitive Data Models

### 4.1 OutputType

| ID | Requirement | Source |
|---|---|---|
| OG-4.1 | `OutputType` MUST be union: `'assertion' | 'judgment' | 'evidence' | 'action' | 'question' | 'alert' | 'narrative'` (7 values) | S4.1 |
| OG-4.2 | `assertion` predicate format MUST be `output.assertion` | S4.1 |
| OG-4.3 | `judgment` predicate format MUST be `output.judgment` | S4.1 |
| OG-4.4 | `evidence` predicate format MUST be `output.evidence` | S4.1 |
| OG-4.5 | `action` predicate format MUST be `output.action` | S4.1 |
| OG-4.6 | `question` predicate format MUST be `output.question` | S4.1 |
| OG-4.7 | `alert` predicate format MUST be `output.alert` | S4.1 |
| OG-4.8 | `narrative` predicate format MUST be `output.narrative` | S4.1 |

### 4.2 OutputOptions

| ID | Requirement | Source |
|---|---|---|
| OG-4.9 | `OutputOptions.confidence` MUST be optional, clamped to [0, 0.7] | S4.2 |
| OG-4.10 | `OutputOptions.classification` MUST default to `'internal'` when omitted | S4.2 |
| OG-4.11 | `OutputOptions.relatedClaims` MUST create `derived_from` relationships to referenced claims | S4.2 |
| OG-4.12 | `OutputOptions` MUST have optional readonly fields: `missionId`, `reasoning`, `tags`, `metadata` | S4.2 |

### 4.3 OutputEntry

| ID | Requirement | Source |
|---|---|---|
| OG-4.13 | `OutputEntry` MUST have readonly fields: `id`, `type`, `content`, `confidence`, `classification`, `agentId`, `sessionId`, `missionId`, `reasoning`, `relatedClaims`, `tags`, `createdAt`, `status` | S4.3 |
| OG-4.14 | `OutputEntry.content` MUST be non-empty (min 1 character, max 32768 characters) | S4.3 |
| OG-4.15 | `OutputEntry.status` MUST be `'active' | 'retracted'` | S4.3 |
| OG-4.16 | Status transition `active -> retracted` MUST be terminal and irreversible | S4.3 |

### 4.4 OutputFilter

| ID | Requirement | Source |
|---|---|---|
| OG-4.17 | `OutputFilter` MUST have optional readonly fields: `type`, `agentId`, `sessionId`, `missionId`, `timeRange`, `status`, `tags`, `minConfidence`, `limit`, `offset` | S4.4 |
| OG-4.18 | `OutputFilter.type` MUST accept `OutputType | readonly OutputType[]` | S4.4 |
| OG-4.19 | `OutputFilter.status` MUST accept `'active' | 'retracted' | 'all'` | S4.4 |
| OG-4.20 | Default `status` MUST be `'active'` | S4.4 |
| OG-4.21 | Default `limit` MUST be `50` | S4.4 |
| OG-4.22 | Default `offset` MUST be `0` | S4.4 |

**Totals: 22 requirements**

---

## Section 5: Telemetry Data Models

### 5.1 CostRecord

| ID | Requirement | Source |
|---|---|---|
| OG-5.1 | `CostRecord` MUST have readonly fields: `id`, `provider`, `model`, `inputTokens`, `outputTokens`, `totalTokens`, `cost`, `currency`, `duration`, `agentId`, `sessionId`, `missionId`, `taskId`, `timestamp` | S5.1 |
| OG-5.2 | `inputTokens`, `outputTokens`, `totalTokens` MUST be non-negative integers | S5.1 |
| OG-5.3 | `totalTokens` MUST equal `inputTokens + outputTokens` | S5.1 |
| OG-5.4 | `cost` MUST be non-negative (zero permitted for free-tier calls) | S5.1 |
| OG-5.5 | `duration` MUST be non-negative in ms (zero permitted for cached responses) | S5.1 |
| OG-5.6 | CostRecord MUST be stored as governed claim with predicate `telemetry.cost` | S5.1 |

### 5.2 VitalRecord

| ID | Requirement | Source |
|---|---|---|
| OG-5.7 | `VitalRecord` MUST have readonly fields: `id`, `metric`, `value`, `unit`, `tags`, `agentId`, `sessionId`, `timestamp` | S5.2 |
| OG-5.8 | `VitalRecord.metric` MUST be non-empty, dot-delimited (e.g., `throughput.requests`) | S5.2 |
| OG-5.9 | `VitalRecord.unit` MUST be non-empty (e.g., `ms`, `req/s`, `bytes`, `count`) | S5.2 |
| OG-5.10 | VitalRecord MUST be stored as governed claim with predicate `telemetry.vital` | S5.2 |

### 5.3 CostFilter

| ID | Requirement | Source |
|---|---|---|
| OG-5.11 | `CostFilter` MUST have optional readonly fields: `provider`, `model`, `agentId`, `sessionId`, `missionId`, `taskId`, `timeRange`, `limit`, `offset` | S5.3 |

### 5.4 VitalFilter

| ID | Requirement | Source |
|---|---|---|
| OG-5.12 | `VitalFilter` MUST have optional readonly fields: `metric`, `agentId`, `sessionId`, `tags`, `timeRange`, `limit`, `offset` | S5.4 |

### 5.5 BudgetConsumption

| ID | Requirement | Source |
|---|---|---|
| OG-5.13 | `BudgetConsumption.session` MUST have readonly fields: `tokens: number`, `cost: number` | S5.5 |
| OG-5.14 | `BudgetConsumption.mission` MUST be `{ tokens: number; cost: number } | null` | S5.5 |
| OG-5.15 | `BudgetConsumption.lifetime` MUST have readonly fields: `tokens: number`, `cost: number` | S5.5 |
| OG-5.16 | `BudgetConsumption.quotaRemaining` MUST have fields: `tokens: number | null`, `cost: number | null` | S5.5 |
| OG-5.17 | `quotaRemaining` fields MUST be `null` when no budget is configured for that dimension | S5.5 |
| OG-5.18 | All numeric values in BudgetConsumption MUST be non-negative | S5.5 |
| OG-5.19 | All telemetry data model fields MUST be readonly | S5.1-5.5 |
| OG-5.20 | `CostRecord.missionId` and `CostRecord.taskId` MUST be nullable | S5.1 |

**Totals: 20 requirements**

---

## Section 6: Structured Inference Data Models

### 6.1 InferenceOptions\<T\>

| ID | Requirement | Source |
|---|---|---|
| OG-6.1 | `InferenceOptions.prompt` MUST be non-empty (min 1 character) | S6.1 |
| OG-6.2 | `InferenceOptions.schema` MUST accept `JsonSchema | ZodSchema<T>` | S6.1 |
| OG-6.3 | `InferenceOptions.temperature` MUST be clamped to [0, 2.0] | S6.1 |
| OG-6.4 | `InferenceOptions.maxRetries` MUST be clamped to [0, 5] with default 2 | S6.1 |
| OG-6.5 | `InferenceOptions.timeout` MUST be clamped to [1000, 300000] ms with default 30000 | S6.1 |
| OG-6.6 | `InferenceOptions.strict` MUST default to `true`; enables strict JSON mode on supporting providers | S6.1 |
| OG-6.7 | `InferenceOptions` MUST have optional fields: `model`, `classification`, `missionId` | S6.1 |

### 6.2 InferenceResult\<T\>

| ID | Requirement | Source |
|---|---|---|
| OG-6.8 | `InferenceResult.value` MUST be the parsed and validated result of type `T` | S6.2 |
| OG-6.9 | `InferenceResult.raw` MUST be the raw string response from the model | S6.2 |
| OG-6.10 | `InferenceResult.retries` MUST be the count of failed attempts before success | S6.2 |
| OG-6.11 | `InferenceResult.validationErrors` MUST contain errors from ALL failed attempts (not just the last) | S6.2 |
| OG-6.12 | `InferenceResult.cost` MUST be aggregate `CostRecord` across all attempts | S6.2 |
| OG-6.13 | `InferenceResult.duration` MUST be total duration in ms across all attempts | S6.2 |

### 6.3 ValidationError

| ID | Requirement | Source |
|---|---|---|
| OG-6.14 | `ValidationError` MUST have readonly fields: `path: string`, `message: string`, `attempt: number` (1-indexed) | S6.3 |

### 6.4 Retry Protocol

| ID | Requirement | Source |
|---|---|---|
| OG-6.15 | On schema validation failure: collect errors, append structured correction block to prompt, re-invoke model | S6.4 |
| OG-6.16 | If `maxRetries` exhausted: MUST return `INFERENCE_RETRIES_EXHAUSTED` error with all accumulated `ValidationError` entries | S6.4 |

**Totals: 16 requirements**

---

## Section 7: Plugin/Hook Data Models

### 7.1 AgentPlugin

| ID | Requirement | Source |
|---|---|---|
| OG-7.1 | `AgentPlugin.id` MUST be unique across all installed plugins (UUID recommended) | S7.1 |
| OG-7.2 | `AgentPlugin.name` MUST be non-empty, max 128 characters | S7.1 |
| OG-7.3 | `AgentPlugin.version` MUST be valid semver | S7.1 |
| OG-7.4 | `AgentPlugin.capabilities` declares needed capabilities; MUST be validated against agent capabilities at install time | S7.1 |
| OG-7.5 | `AgentPlugin` MUST implement `install(context: PluginContext): Promise<void>` | S7.1 |
| OG-7.6 | `AgentPlugin` MUST implement `destroy(): Promise<void>` | S7.1 |

### 7.2 PluginContext

| ID | Requirement | Source |
|---|---|---|
| OG-7.7 | `PluginContext` MUST provide `on`/`off` event subscription methods | S7.2 |
| OG-7.8 | `PluginContext.api` MUST be readonly `PluginApi` | S7.2 |
| OG-7.9 | `PluginContext.logger` MUST be readonly `PluginLogger` | S7.2 |
| OG-7.10 | `PluginApi` MUST expose read-only operations only: `queryOutputs`, `queryVitals`, `queryCosts` | S7.2 |
| OG-7.11 | Plugins MUST NOT produce outputs or record telemetry directly; must request via events | S7.2 |
| OG-7.12 | `PluginLogger` writes MUST be tagged with the plugin ID for isolation | S7.2 |
| OG-7.13 | `PluginLogger` MUST have methods: `debug`, `info`, `warn`, `error` | S7.2 |

### 7.3 PluginConfig

| ID | Requirement | Source |
|---|---|---|
| OG-7.14 | `PluginConfig.enabled` default MUST be `true` | S7.3 |
| OG-7.15 | `PluginConfig.priority` MUST be 0-100 (lower = higher priority); default `50` | S7.3 |
| OG-7.16 | `PluginConfig.isolation` MUST be `'shared' | 'sandboxed'`; default `'shared'` | S7.3 |
| OG-7.17 | `PluginConfig.errorPolicy` MUST be `'propagate' | 'contain' | 'disable_on_error'`; default `'contain'` | S7.3 |
| OG-7.18 | `PluginConfig.maxErrorCount` default MUST be `3`; triggers `disable_on_error` | S7.3 |

### 7.4 PluginRegistration

| ID | Requirement | Source |
|---|---|---|
| OG-7.19 | `PluginRegistration` MUST have readonly fields: `pluginId`, `name`, `version`, `status`, `installedAt`, `errorCount`, `lastError`, `config` | S7.4 |
| OG-7.20 | `PluginRegistration.status` MUST be `'active' | 'disabled' | 'error'` | S7.4 |

### 7.5 HookType

| ID | Requirement | Source |
|---|---|---|
| OG-7.21 | `HookType` MUST be union: `'before_assert' | 'after_assert' | 'before_recall' | 'after_recall' | 'before_decay' | 'before_output' | 'after_output'` (7 values) | S7.5 |

### 7.6 AgentHook

| ID | Requirement | Source |
|---|---|---|
| OG-7.22 | `AgentHook` MUST have readonly fields: `type: HookType`, `priority: number` (0-100, lower fires first), `name: string`, `handler: HookHandler` | S7.6 |

### 7.7 HookHandler and HookResult

| ID | Requirement | Source |
|---|---|---|
| OG-7.23 | `HookHandler` MUST be `(context: HookContext) => Promise<HookResult>` | S7.7 |
| OG-7.24 | `HookContext` MUST have readonly fields: `hookType`, `agentId`, `sessionId`, `timestamp`, `payload` | S7.7 |
| OG-7.25 | `HookResult.proceed` = `false` MUST block the operation; audit entry emitted with `reason` | S7.7 |
| OG-7.26 | `HookResult.modified` MUST replace original payload if present and `proceed: true`; must conform to same schema | S7.7 |
| OG-7.27 | If hook handler throws or exceeds 5000ms timeout: MUST be treated as `{ proceed: true }` with warning audit entry | S7.7 |

### 7.8 HookRegistration

| ID | Requirement | Source |
|---|---|---|
| OG-7.28 | `HookRegistration` MUST have readonly fields: `hookId`, `type`, `priority`, `name`, `registeredAt`, `firedCount`, `blockedCount`, `lastFiredAt`, `errorCount` | S7.8 |
| OG-7.29 | `HookRegistration.firedCount` MUST track total hook invocations | S7.8 |
| OG-7.30 | `HookRegistration.blockedCount` MUST track how many times the hook blocked an operation | S7.8 |

**Totals: 30 requirements**

---

## Section 8: Output Events

| ID | Requirement | Source |
|---|---|---|
| OG-8.1 | `OutputEvent` MUST include: `'output:produced'` | S8 |
| OG-8.2 | `OutputEvent` MUST include: `'output:retracted'` | S8 |
| OG-8.3 | `OutputEvent` MUST include: `'telemetry:cost_recorded'` | S8 |
| OG-8.4 | `OutputEvent` MUST include: `'telemetry:vital_recorded'` | S8 |
| OG-8.5 | `OutputEvent` MUST include: `'inference:started'` | S8 |
| OG-8.6 | `OutputEvent` MUST include: `'inference:completed'` | S8 |
| OG-8.7 | `OutputEvent` MUST include: `'inference:retry'` | S8 |
| OG-8.8 | `OutputEvent` MUST include: `'inference:failed'` | S8 |
| OG-8.9 | `OutputEvent` MUST include: `'plugin:installed'` | S8 |
| OG-8.10 | `OutputEvent` MUST include: `'plugin:uninstalled'` | S8 |
| OG-8.11 | `OutputEvent` MUST include: `'plugin:error'` | S8 |
| OG-8.12 | `OutputEvent` MUST include: `'hook:registered'` | S8 |
| OG-8.13 | `OutputEvent` MUST include: `'hook:fired'` | S8 |
| OG-8.14 | `OutputEvent` MUST include: `'hook:blocked'` | S8 |

**Totals: 14 requirements**

---

## Section 8 (continued): Event Payload Data

| ID | Requirement | Source |
|---|---|---|
| OG-8.15 | `output:produced` data MUST include: `outputId: ClaimId`, `type: OutputType`, `confidence: number` | S8 Table |
| OG-8.16 | `output:retracted` data MUST include: `outputId: ClaimId`, `reason: string` | S8 Table |
| OG-8.17 | `telemetry:cost_recorded` data MUST include: `costId: ClaimId`, `totalTokens: number`, `cost: number` | S8 Table |
| OG-8.18 | `telemetry:vital_recorded` data MUST include: `vitalId: ClaimId`, `metric: string`, `value: number` | S8 Table |
| OG-8.19 | `inference:started` data MUST include: `model: string`, `promptLength: number` | S8 Table |
| OG-8.20 | `inference:completed` data MUST include: `model: string`, `retries: number`, `duration: number` | S8 Table |
| OG-8.21 | `inference:retry` data MUST include: `attempt: number`, `errors: ValidationError[]` | S8 Table |
| OG-8.22 | `inference:failed` data MUST include: `reason: string`, `attempts: number`, `errors: ValidationError[]` | S8 Table |
| OG-8.23 | `plugin:installed` data MUST include: `pluginId: string`, `name: string`, `version: string` | S8 Table |
| OG-8.24 | `plugin:uninstalled` data MUST include: `pluginId: string`, `name: string` | S8 Table |
| OG-8.25 | `plugin:error` data MUST include: `pluginId: string`, `error: string`, `errorCount: number` | S8 Table |
| OG-8.26 | `hook:registered` data MUST include: `hookId: string`, `type: HookType`, `priority: number` | S8 Table |
| OG-8.27 | `hook:fired` data MUST include: `hookId: string`, `type: HookType`, `proceed: boolean` | S8 Table |
| OG-8.28 | `hook:blocked` data MUST include: `hookId: string`, `type: HookType`, `reason: string` | S8 Table |

**Totals: 14 requirements**

---

## Section 9: Error Types

| ID | Requirement | Source |
|---|---|---|
| OG-9.1 | Error `OUTPUT_VALIDATION_FAILED` MUST include: `message`, `spec: 'AOG-4'`, `violations: OutputValidationViolation[]` | S9 |
| OG-9.2 | Error `OUTPUT_CONTENT_EMPTY` MUST include: `message`, `spec: 'AOG-4.3'` | S9 |
| OG-9.3 | Error `OUTPUT_CONTENT_TOO_LARGE` MUST include: `message`, `spec: 'AOG-4.3'`, `maxBytes: number` | S9 |
| OG-9.4 | Error `INFERENCE_TIMEOUT` MUST include: `message`, `spec: 'AOG-6.1'`, `timeoutMs: number`, `elapsed: number` | S9 |
| OG-9.5 | Error `INFERENCE_SCHEMA_VIOLATION` MUST include: `message`, `spec: 'AOG-6.3'`, `errors: ValidationError[]` | S9 |
| OG-9.6 | Error `INFERENCE_RETRIES_EXHAUSTED` MUST include: `message`, `spec: 'AOG-6.4'`, `attempts: number`, `errors: ValidationError[]` | S9 |
| OG-9.7 | Error `PLUGIN_INSTALL_FAILED` MUST include: `message`, `spec: 'AOG-7.1'`, `pluginId: string`, `reason: string` | S9 |
| OG-9.8 | Error `PLUGIN_NOT_FOUND` MUST include: `message`, `spec: 'AOG-7.4'`, `pluginId: string` | S9 |
| OG-9.9 | Error `PLUGIN_CAPABILITY_DENIED` MUST include: `message`, `spec: 'AOG-7.1'`, `required: string[]`, `available: string[]` | S9 |
| OG-9.10 | Error `HOOK_EXECUTION_FAILED` MUST include: `message`, `spec: 'AOG-7.7'`, `hookId: string`, `error: string` | S9 |
| OG-9.11 | Error `HOOK_BLOCKED_OPERATION` MUST include: `message`, `spec: 'AOG-7.7'`, `hookId: string`, `hookType: HookType`, `reason: string` | S9 |
| OG-9.12 | Error `HOOK_NOT_FOUND` MUST include: `message`, `spec: 'AOG-7.8'`, `hookId: string` | S9 |
| OG-9.13 | Error `TELEMETRY_WRITE_FAILED` MUST include: `message`, `spec: 'AOG-5'`, `reason: string` | S9 |
| OG-9.14 | Error `GOVERNANCE_REFUSAL` MUST include: `message`, `spec: 'AOG-12'`, `decision: GovernanceDecision` | S9 |
| OG-9.15 | `OutputValidationViolation` MUST have readonly fields: `field: string`, `constraint: string`, `actual: string` | S9 |

**Totals: 15 requirements**

---

## Section 10: Rust Trait

### Rust Enums

| ID | Requirement | Source |
|---|---|---|
| OG-10.1 | Rust `OutputType` enum MUST have 7 variants: `Assertion`, `Judgment`, `Evidence`, `Action`, `Question`, `Alert`, `Narrative` | S10 |
| OG-10.2 | Rust `OutputType` MUST derive `Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize` | S10 |
| OG-10.3 | Rust `OutputType` MUST use `#[serde(rename_all = "snake_case")]` | S10 |
| OG-10.4 | Rust `OutputStatus` enum MUST have variants: `Active`, `Retracted` | S10 |
| OG-10.5 | Rust `PluginIsolation` enum MUST have variants: `Shared`, `Sandboxed` | S10 |
| OG-10.6 | Rust `ErrorPolicy` enum MUST have variants: `Propagate`, `Contain`, `DisableOnError` | S10 |
| OG-10.7 | Rust `PluginStatus` enum MUST have variants: `Active`, `Disabled`, `Error` | S10 |
| OG-10.8 | Rust `HookType` enum MUST have 7 variants: `BeforeAssert`, `AfterAssert`, `BeforeRecall`, `AfterRecall`, `BeforeDecay`, `BeforeOutput`, `AfterOutput` | S10 |

### Rust Structs

| ID | Requirement | Source |
|---|---|---|
| OG-10.9 | Rust `OutputOptions` MUST have 7 optional fields matching TypeScript | S10 |
| OG-10.10 | Rust `OutputEntry` MUST have 13 fields matching TypeScript with snake_case | S10 |
| OG-10.11 | Rust `OutputFilter` MUST have 10 optional fields matching TypeScript | S10 |
| OG-10.12 | Rust `CostRecord` MUST have 14 fields matching TypeScript with snake_case | S10 |
| OG-10.13 | Rust `VitalRecord` MUST have 8 fields matching TypeScript; `tags` as `HashMap<String, String>` | S10 |
| OG-10.14 | Rust `BudgetConsumption` MUST have fields: `session: TokenCostPair`, `mission: Option<TokenCostPair>`, `lifetime: TokenCostPair`, `quota_remaining: QuotaRemaining` | S10 |
| OG-10.15 | Rust `TokenCostPair` MUST have fields: `tokens: u64`, `cost: f64` | S10 |
| OG-10.16 | Rust `QuotaRemaining` MUST have fields: `tokens: Option<u64>`, `cost: Option<f64>` | S10 |
| OG-10.17 | Rust `InferenceOptions` MUST have 9 fields matching TypeScript; `schema` as `JsonValue` | S10 |
| OG-10.18 | Rust `InferenceResult` MUST have fields: `value: JsonValue`, `raw: String`, `retries: u8`, `validation_errors`, `duration: u64`, `cost: CostRecord` | S10 |
| OG-10.19 | Rust `ValidationError` MUST have fields: `path: String`, `message: String`, `attempt: u8` | S10 |
| OG-10.20 | Rust `HookResult` MUST have fields: `proceed: bool`, `modified: Option<JsonValue>`, `reason: Option<String>` | S10 |
| OG-10.21 | Rust `PluginManifest` MUST have fields: `id: String`, `name: String`, `version: String`, `capabilities: Vec<String>` | S10 |
| OG-10.22 | Rust `PluginConfig` MUST have fields: `enabled: bool`, `priority: u8`, `isolation: PluginIsolation`, `error_policy: ErrorPolicy`, `max_error_count: Option<u8>` | S10 |
| OG-10.23 | Rust `PluginRegistration` MUST have 8 fields matching TypeScript with snake_case | S10 |
| OG-10.24 | Rust `HookRegistration` MUST have 9 fields matching TypeScript with snake_case | S10 |
| OG-10.25 | Rust `CostFilter` MUST have 9 optional fields matching TypeScript | S10 |
| OG-10.26 | Rust `VitalFilter` MUST have 7 optional fields matching TypeScript | S10 |
| OG-10.27 | Rust `TimeRange` MUST have fields: `from: String`, `to: String` | S10 |

### Rust Error Type

| ID | Requirement | Source |
|---|---|---|
| OG-10.28 | Rust `OutputGovernanceError` MUST use `#[serde(tag = "code", rename_all = "SCREAMING_SNAKE_CASE")]` | S10 |
| OG-10.29 | Rust `OutputGovernanceError` MUST have 14 variants matching TypeScript error codes | S10 |
| OG-10.30 | Rust `OutputValidationViolation` MUST have fields: `field: String`, `constraint: String`, `actual: String` | S10 |

### Rust Trait

| ID | Requirement | Source |
|---|---|---|
| OG-10.31 | Rust trait `AgentOutputGovernor` MUST be `Send + Sync` with `#[async_trait]` | S10 |
| OG-10.32 | `produce` MUST take `(&self, ctx: &OperationContext, output_type: OutputType, content: &str, options: Option<OutputOptions>)` | S10 |
| OG-10.33 | `query_outputs` MUST take `(&self, ctx: &OperationContext, filter: OutputFilter)` | S10 |
| OG-10.34 | `retract_output` MUST take `(&self, ctx: &OperationContext, output_id: &str, reason: &str)` | S10 |
| OG-10.35 | `record_cost` MUST take `(&self, ctx: &OperationContext, data: CostRecord)` | S10 |
| OG-10.36 | `record_vital` MUST take `(&self, ctx: &OperationContext, data: VitalRecord)` | S10 |
| OG-10.37 | `query_costs` MUST take `(&self, ctx: &OperationContext, filter: CostFilter)` | S10 |
| OG-10.38 | `query_vitals` MUST take `(&self, ctx: &OperationContext, filter: VitalFilter)` | S10 |
| OG-10.39 | `get_budget_consumption` MUST take `(&self, ctx: &OperationContext)` | S10 |
| OG-10.40 | `infer` MUST take `(&self, ctx: &OperationContext, options: InferenceOptions)` | S10 |
| OG-10.41 | `install_plugin` MUST take `(&self, ctx: &OperationContext, plugin_manifest: PluginManifest, config: Option<PluginConfig>)` | S10 |
| OG-10.42 | `register_hook` MUST take `(&self, ctx: &OperationContext, hook_type: HookType, priority: u8, name: &str)` | S10 |
| OG-10.43 | Trait MUST define 16 async methods covering output, telemetry, inference, plugin, and hook operations | S10 |
| OG-10.44 | All trait methods MUST return `Result<T, OutputGovernanceError>` | S10 |

**Totals: 44 requirements**

---

## Section 11: Integration Map

| ID | Requirement | Source |
|---|---|---|
| OG-11.1 | `produce` MUST map to SC-11 (`assert_claim`) with predicate `output.<type>` and governance domain `{ domain: 'output', operation: 'produce' }` | S11 |
| OG-11.2 | `queryOutputs` MUST map to SC-13 (`query_claims`) with `output.*` filter | S11 |
| OG-11.3 | `retractOutput` MUST map to SC-12 (`retract_claim`) | S11 |
| OG-11.4 | `recordCost` MUST map to SC-11 with predicate `telemetry.cost` | S11 |
| OG-11.5 | `recordVital` MUST map to SC-11 with predicate `telemetry.vital` | S11 |
| OG-11.6 | `queryCosts` MUST map to SC-13 with `telemetry.cost` filter | S11 |
| OG-11.7 | `queryVitals` MUST map to SC-13 with `telemetry.vital` filter | S11 |
| OG-11.8 | `getBudgetConsumption` MUST aggregate over `telemetry.cost` claims | S11 |
| OG-11.9 | `infer` MUST use LLM gateway + Zod/JSON schema validation + retry loop; cost auto-recorded | S11 |
| OG-11.10 | `installPlugin` MUST use `plugin_registry.install()` + capability validation | S11 |
| OG-11.11 | Hook `before_assert` MUST fire before any claim assertion (CCP pipeline) | S11 Hook Table |
| OG-11.12 | Hook `after_assert` MUST fire after successful claim assertion | S11 Hook Table |
| OG-11.13 | Hook `before_recall` MUST fire before claim query execution | S11 Hook Table |
| OG-11.14 | Hook `after_recall` MUST fire after claim query returns results | S11 Hook Table |
| OG-11.15 | Hook `before_decay` MUST fire before FSRS decay calculation runs | S11 Hook Table |
| OG-11.16 | Hook `before_output`/`after_output` MUST fire before/after `produce()` persists/succeeds | S11 Hook Table |
| OG-11.17 | `uninstallPlugin` MUST map to `plugin_registry.uninstall()` + cleanup of all plugin subscriptions and hooks | S11 implied |
| OG-11.18 | `unregisterHook` MUST remove the hook from the firing chain + emit `hook:unregistered` or equivalent audit entry | S11 implied |
| OG-11.19 | `listPlugins` MUST query `plugin_registry` and return all `PluginRegistration` entries scoped to the requesting agent's tenant | S11 implied |
| OG-11.20 | `listHooks` MUST return all `HookRegistration` entries scoped to the requesting agent's session | S11 implied |

> **NOTE (P2-4):** `retractOutput` maps to SC-12 (`retract_claim`) per OG-11.3. However, the Memory Bridge integration map (MB-7.6) maps `forget` to `retract_claim` + cascade evaluation. The Output Governance integration map does not mention cascade evaluation for `retractOutput`. If an output claim has `derived_from` relationships (created via `relatedClaims` in OG-4.11), retraction behavior regarding dependent claims is unspecified. Either cascade evaluation applies (consistent with CCP) or it does not (output-specific override). The contract should clarify.

**Totals: 20 requirements**

---

## Section 12: Invariants

| ID | Requirement | Source |
|---|---|---|
| OG-12.1 | Outputs are claims: all CCP invariants apply (confidence ceiling, FSRS decay, classification, retention, audit). Output is a claim with predicate `output.<type>` | S12 Inv1 |
| OG-12.2 | Agent confidence ceiling: output confidence MUST NOT exceed 0.7; if `options.confidence > 0.7`, clamp to 0.7 | S12 Inv2 |
| OG-12.3 | Telemetry append-only: cost and vital records MUST NOT be mutated or deleted after persistence; retraction not supported; only natural expiry via retention policy | S12 Inv3 |
| OG-12.4 | Inference progressive refinement: retry prompt MUST include all previous validation errors; each retry sees full error history | S12 Inv4 |
| OG-12.5 | Plugin error containment: `errorPolicy: 'contain'` logs errors but does not propagate; `errorCount` increments; when `errorCount >= maxErrorCount`, plugin transitions to `'disabled'` | S12 Inv5 |
| OG-12.6 | Plugin isolation: sandboxed plugins receive isolated `PluginContext`; cannot access other plugins' subscriptions, logger namespaces, or scoped API results | S12 Inv6 |
| OG-12.7 | Hook deterministic ordering: same-type hooks fire in priority order (lowest first); equal priorities broken by registration order (earlier first); deterministic and reproducible | S12 Inv7 |
| OG-12.8 | Hook blocking audit: `proceed: false` blocks operation; audit entry of classification `internal` emitted with hook ID, type, reason, blocked operation; caller receives `HOOK_BLOCKED_OPERATION` | S12 Inv8 |
| OG-12.9 | Plugin installation governance: installing requires `governance_admin` capability (`verified` trust); hooks require only `memory_write` capability (`low` trust or above) | S12 Inv9 |
| OG-12.10 | Telemetry tenant isolation: all telemetry queries scoped to requesting agent's tenant; no cross-tenant aggregation without explicit consent (purpose `'analytics'`) | S12 Inv10 |
| OG-12.11 | Inference cost always recorded: every `infer()` records a `CostRecord` regardless of outcome; partial token consumption from failed attempts included | S12 Inv11 |
| OG-12.12 | Hook timeout safety: 5000ms timeout; if exceeded, treated as `{ proceed: true }`; warning audit entry emitted; hook `errorCount` increments | S12 Inv12 |

**Totals: 12 requirements**

---

## Appendix A: Governance Action Registration

| ID | Requirement | Source |
|---|---|---|
| OG-A.1 | GovernanceAction `{ domain: 'output', operation: 'produce' }` MUST be registered | App A |
| OG-A.2 | GovernanceAction `{ domain: 'output', operation: 'telemetry' }` MUST be registered | App A |
| OG-A.3 | GovernanceAction `{ domain: 'output', operation: 'infer' }` MUST be registered | App A |
| OG-A.4 | GovernanceAction `{ domain: 'output', operation: 'plugin' }` MUST be registered | App A |
| OG-A.5 | GovernanceAction `{ domain: 'output', operation: 'hook' }` MUST be registered | App A |
| OG-A.6 | `produce` requires `assert_claim` permission, minimum trust `low` | App A |
| OG-A.7 | `telemetry` (write) requires `assert_claim` permission, minimum trust `low`; `telemetry` (read) requires `view_telemetry`, minimum trust `untrusted` | App A |
| OG-A.8 | `infer` requires `infer` permission, minimum trust `low` | App A |
| OG-A.9 | `plugin` (install/uninstall) requires `governance_admin` permission, minimum trust `verified`; `plugin` (list) requires `view_telemetry`, minimum trust `untrusted` | App A |
| OG-A.10 | `hook` (register/unregister) requires `assert_claim` permission, minimum trust `low`; `hook` (list) requires `view_telemetry`, minimum trust `untrusted` | App A |

**Totals: 10 requirements**

---

## TC-21 Cross-Language Parity Gaps

| ID | Requirement | Source |
|---|---|---|
| OG-XX.01 | TypeScript `AgentPlugin` defines behavioral lifecycle methods `install(context: PluginContext): Promise<void>` and `destroy(): Promise<void>` (OG-7.5, OG-7.6). Rust uses `PluginManifest` (OG-10.21) which is a data-only struct with no lifecycle methods. The Rust representation MUST either: (a) add an `AgentPlugin` trait with `install`/`destroy` async methods, or (b) document that plugin lifecycle is TypeScript-only and Rust plugins are configuration-only. Current state is an undocumented divergence. | TC-21 Gap |
| OG-XX.02 | TypeScript `registerHook` accepts `AgentHook` containing `handler: HookHandler` (a function type, OG-7.22-7.23). Rust `register_hook` takes `hook_type: HookType, priority: u8, name: &str` with no handler parameter (OG-10.42). The Rust trait has no representation of hook handler functions. The Rust representation MUST either: (a) add a `HookHandler` trait or callback mechanism, or (b) document that hook handlers are TypeScript-only and Rust hooks use a different dispatch mechanism. | TC-21 Gap |

> **NOTE (P2-6):** TypeScript `InferenceOptions<T>` and `InferenceResult<T>` use generics where `T` is the parsed output type driven by the schema. Rust `InferenceOptions` uses `schema: JsonValue` and `InferenceResult` uses `value: JsonValue`, losing compile-time type safety. This is an acceptable Rust/TypeScript divergence (Rust lacks first-class schema-to-type inference), but implementors should note that Rust consumers must perform runtime validation that TypeScript consumers get at compile time.

**Totals: 2 requirements**

---

## Grand Total

| Section | Count |
|---|---|
| S1: Purpose & Scope | 5 |
| S2: Shared Type References | 16 |
| S3: Interface | 18 |
| S4: Output Primitives | 22 |
| S5: Telemetry Models | 20 |
| S6: Inference Models | 16 |
| S7: Plugin/Hook Models | 30 |
| S8: Events | 14 |
| S8: Event Payloads | 14 |
| S9: Error Types | 15 |
| S10: Rust Trait | 44 |
| S11: Integration Map | 20 |
| S12: Invariants | 12 |
| Appendix A: Governance Actions | 10 |
| TC-21: Parity Gaps | 2 |
| **Grand Total** | **258** |
