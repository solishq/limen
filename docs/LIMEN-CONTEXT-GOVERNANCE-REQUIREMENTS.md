# Limen v5 -- AGENT_CONTEXT_GOVERNANCE.md Requirement Extraction

**Source:** `contracts/AGENT_CONTEXT_GOVERNANCE.md` v1.2.2
**Extracted:** 2026-05-09
**Governing Standard:** SolisForge Protocol v1.4
**Governance Tier:** Forge Critical
**Purpose:** Every implementable requirement from the Agent Context Governance contract.

---

## Section 1: Purpose & Scope

| ID | Requirement | Source |
|---|---|---|
| CG-1.1 | Contract scope covers context budget management, importance-based eviction, and working memory governance for AI agents | S1 |
| CG-1.2 | Contract classification is QAL-3 (agent operational integrity) | Header |
| CG-1.3 | All eviction decisions MUST produce audit trails | S1 |
| CG-1.4 | All assembly operations MUST be deterministic and reproducible | S1 |
| CG-1.5 | All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`; this contract does NOT redefine any shared type | Preamble |

**Totals: 5 requirements**

---

## Section 2: Context Governance vs Memory Bridge Relationship

| ID | Requirement | Source |
|---|---|---|
| CG-2.1 | Memory Bridge `recall()` queries the full belief store with filters; Context Governance `assembleContext()` constructs a budget-constrained context window for LLM consumption | S2 Table |
| CG-2.2 | `recall()` returns all matches up to `limit`; `assembleContext()` enforces hard token cap with excess claims excluded | S2 Table |
| CG-2.3 | `recall()` orders by confidence or relevance; `assembleContext()` orders by position (1=mission, 2=WM, 3+=beliefs) then importance | S2 Table |
| CG-2.4 | `recall()` is for targeted knowledge retrieval during reasoning; `assembleContext()` is for LLM context window population before inference | S2 Table |
| CG-2.5 | An agent uses `recall()` for targeted queries ("what do I know about X?") and `assembleContext()` when constructing the full context payload to send to an LLM | S2 Operational Pattern |
| CG-2.6 | The Context Governor MAY internally invoke recall-equivalent queries to source belief candidates | S2 Operational Pattern |
| CG-2.7 | Context Governor MUST apply budget constraints, importance ranking, and position ordering that recall does not | S2 Operational Pattern |
| CG-2.8 | `recall()` has no budget awareness; `assembleContext()` has full budget awareness | S2 Table |

**Totals: 8 requirements**

---

## Section 3: AgentContextClient Interface

| ID | Requirement | Source |
|---|---|---|
| CG-3.1 | `getContextBudget()` MUST return `Promise<Result<ContextBudget>>` | S3 Interface |
| CG-3.2 | `setContextBudget(ctx: OperationContext, config: ContextBudgetConfig)` MUST return `Promise<Result<ContextBudget>>` | S3 Interface |
| CG-3.3 | `getContextUtilization()` MUST return `Promise<Result<ContextUtilization>>` | S3 Interface |
| CG-3.4 | `scoreImportance(claimId: ClaimId)` MUST return `Promise<Result<ImportanceScore>>` | S3 Interface |
| CG-3.5 | `batchScoreImportance(claimIds: readonly ClaimId[])` MUST return `Promise<Result<ImportanceScoreMap>>` | S3 Interface |
| CG-3.6 | `getContextRanking(options?: RankingOptions)` MUST return `Promise<Result<ContextRanking>>` | S3 Interface |
| CG-3.7 | `pinToContext(ctx: OperationContext, claimId: ClaimId, priority: PinPriority)` MUST return `Promise<Result<void>>` | S3 Interface |
| CG-3.8 | `unpinFromContext(ctx: OperationContext, claimId: ClaimId)` MUST return `Promise<Result<void>>` | S3 Interface |
| CG-3.9 | `getEvictionCandidates(count: number)` MUST return `Promise<Result<EvictionCandidate[]>>` | S3 Interface |
| CG-3.10 | `evict(ctx: OperationContext, claimIds: readonly ClaimId[], reason: string)` MUST return `Promise<Result<EvictionResult>>` | S3 Interface |
| CG-3.11 | `setEvictionPolicy(ctx: OperationContext, policy: EvictionPolicy)` MUST return `Promise<Result<void>>` | S3 Interface |
| CG-3.12 | `getEvictionPolicy()` MUST return `Promise<Result<EvictionPolicy>>` | S3 Interface |
| CG-3.13 | `writeWorkingMemory(ctx: OperationContext, key: string, value: string, options?: WorkingMemoryOptions)` MUST return `Promise<Result<WorkingMemoryEntry>>` | S3 Interface |
| CG-3.14 | `readWorkingMemory(key: string)` MUST return `Promise<Result<WorkingMemoryEntry | null>>` | S3 Interface |
| CG-3.15 | `listWorkingMemory(options?: WorkingMemoryListOptions)` MUST return `Promise<Result<WorkingMemoryEntry[]>>` | S3 Interface |
| CG-3.16 | `discardWorkingMemory(ctx: OperationContext, key: string)` MUST return `Promise<Result<void>>` | S3 Interface |
| CG-3.17 | `flushWorkingMemory(ctx: OperationContext, namespace?: string)` MUST return `Promise<Result<number>>` | S3 Interface |
| CG-3.18 | `getWorkingMemoryUsage()` MUST return `Promise<Result<WorkingMemoryUsage>>` | S3 Interface |
| CG-3.19 | `registerBoundaryTrigger(ctx: OperationContext, trigger: BoundaryTriggerConfig)` MUST return `Promise<Result<string>>` | S3 Interface |
| CG-3.20 | `unregisterBoundaryTrigger(ctx: OperationContext, triggerId: string)` MUST return `Promise<Result<void>>` | S3 Interface |
| CG-3.21 | `listBoundaryTriggers()` MUST return `Promise<Result<BoundaryTriggerConfig[]>>` | S3 Interface |
| CG-3.22 | `assembleContext(options: ContextAssemblyOptions)` MUST return `Promise<Result<AssembledContext>>` | S3 Interface |

**Totals: 22 requirements**

---

## Section 3 (continued): Event System

| ID | Requirement | Source |
|---|---|---|
| CG-3.23 | `on(event: AgentEvent, handler: AgentEventHandler)` MUST return subscription ID `string` | S3 Interface |
| CG-3.24 | `off(subscriptionId: string)` MUST unsubscribe the handler | S3 Interface |
| CG-3.25 | Event `context:pressure_changed` MUST be emittable | S3 Events |
| CG-3.26 | Event `context:eviction_triggered` MUST be emittable | S3 Events |
| CG-3.27 | Event `context:eviction_complete` MUST be emittable | S3 Events |
| CG-3.28 | Event `context:pin_added` MUST be emittable | S3 Events |
| CG-3.29 | Event `context:pin_removed` MUST be emittable | S3 Events |
| CG-3.30 | Event `working_memory:written` MUST be emittable | S3 Events |
| CG-3.31 | Event `working_memory:discarded` MUST be emittable | S3 Events |
| CG-3.32 | Event `working_memory:flushed` MUST be emittable | S3 Events |
| CG-3.33 | All events use the unified event system from SHARED_TYPES.md SS16 | S3 Events |
| CG-3.34 | Events use `AgentEvent`, `AgentEventPayload`, and `AgentEventHandler` from shared types | S3 Events |

**Totals: 12 requirements**

---

## Section 4: Context Budget Data Models

### 4.1 ContextBudgetConfig

| ID | Requirement | Source |
|---|---|---|
| CG-4.1 | `ContextBudgetConfig.maxTokens` MUST be a readonly number representing total context window budget in tokens | S4.1 |
| CG-4.2 | `ContextBudgetConfig.reservedForSystem` MUST be a readonly number for tokens reserved for system prompt and instructions | S4.1 |
| CG-4.3 | `ContextBudgetConfig.reservedForOutput` MUST be a readonly number for tokens reserved for response generation | S4.1 |
| CG-4.4 | `ContextBudgetConfig.missionContextAllocation` MUST be a readonly number (percentage) for Position 1 allocation | S4.1 |
| CG-4.5 | `ContextBudgetConfig.workingMemoryAllocation` MUST be a readonly number (percentage) for Position 2 allocation | S4.1 |
| CG-4.6 | `ContextBudgetConfig.beliefAllocation` MUST be a readonly number (percentage) for Position 3+ allocation | S4.1 |
| CG-4.7 | Constraint: `missionContextAllocation + workingMemoryAllocation + beliefAllocation <= 100` | S4.1 |

### 4.2 ContextBudget

| ID | Requirement | Source |
|---|---|---|
| CG-4.8 | `ContextBudget.config` MUST be readonly `ContextBudgetConfig` | S4.2 |
| CG-4.9 | `ContextBudget.totalAvailable` MUST equal `maxTokens - reservedForSystem - reservedForOutput` | S4.2 |
| CG-4.10 | `ContextBudget.allocated` MUST have readonly fields: `missionContext`, `workingMemory`, `beliefs` (all numbers) | S4.2 |

### 4.3 ContextUtilization

| ID | Requirement | Source |
|---|---|---|
| CG-4.11 | `ContextUtilization.budget` MUST be readonly `ContextBudget` | S4.3 |
| CG-4.12 | `ContextUtilization.used` MUST have readonly fields: `missionContext`, `workingMemory`, `beliefs`, `total` (all numbers) | S4.3 |
| CG-4.13 | `ContextUtilization.available` MUST have readonly fields: `missionContext`, `workingMemory`, `beliefs`, `total` (all numbers) | S4.3 |
| CG-4.14 | `ContextUtilization.utilizationPercent` MUST be 0-100, derived from `used.total / budget.totalAvailable` | S4.3 |
| CG-4.15 | `ContextUtilization.pressure` MUST be of type `ContextPressure` | S4.3 |

### 4.4 ContextPressure

| ID | Requirement | Source |
|---|---|---|
| CG-4.16 | `ContextPressure` MUST be union type: `'low' | 'moderate' | 'high' | 'critical'` | S4.4 |
| CG-4.17 | `low` MUST be derived when utilization < 50% | S4.4 |
| CG-4.18 | `moderate` MUST be derived when 50% <= utilization < 75% | S4.4 |
| CG-4.19 | `high` MUST be derived when 75% <= utilization < 90% | S4.4 |
| CG-4.20 | `critical` MUST be derived when utilization >= 90% | S4.4 |
| CG-4.21 | Pressure derivation is purely from utilization; no manual override exists | S4.4 |
| CG-4.22 | Pressure derivation rules are exhaustive (no gaps between thresholds) | S4.4 |
| CG-4.23 | All `ContextBudgetConfig` fields MUST be readonly | S4.1 |

**Totals: 23 requirements**

---

## Section 5: Importance & Ranking Data Models

### 5.1 ImportanceScore

| ID | Requirement | Source |
|---|---|---|
| CG-5.1 | `ImportanceScore.score` MUST be a readonly number in range [0.0, 1.0] (composite importance) | S5.1 |
| CG-5.2 | `ImportanceScore.factors.accessFrequency` MUST be normalized [0,1] representing how frequently the claim has been accessed | S5.1 |
| CG-5.3 | `ImportanceScore.factors.recency` MUST be normalized [0,1] representing recency of last access via FSRS decay | S5.1 |
| CG-5.4 | `ImportanceScore.factors.connectionDensity` MUST be normalized [0,1] representing number of relationships to other claims | S5.1 |
| CG-5.5 | `ImportanceScore.factors.confidence` MUST represent effective confidence after time-decay | S5.1 |
| CG-5.6 | `ImportanceScore.factors.governanceWeight` MUST be derived from classification level and governance role | S5.1 |
| CG-5.7 | `ImportanceScore.weights` MUST be of type `ImportanceWeights` | S5.1 |

### 5.2 ImportanceWeights

| ID | Requirement | Source |
|---|---|---|
| CG-5.8 | `ImportanceWeights` MUST have readonly fields: `accessFrequency`, `recency`, `connectionDensity`, `confidence`, `governanceWeight` | S5.2 |
| CG-5.9 | Default weights MUST be `{ accessFrequency: 0.2, recency: 0.25, connectionDensity: 0.15, confidence: 0.2, governanceWeight: 0.2 }` | S5.2 |
| CG-5.10 | Composite calculation MUST be `score = sum(factor[i] * weight[i])` | S5.2 |
| CG-5.11 | All factors MUST be in [0,1] | S5.2 |
| CG-5.12 | Weights MUST sum to 1.0 | S5.2 |
| CG-5.13 | Recency factor MUST use FSRS decay formula `R(t) = (1 + t/(9*S))^-1` where `t` = days since last access, `S` = stability | S5.2 |

### 5.3 ImportanceScoreMap

| ID | Requirement | Source |
|---|---|---|
| CG-5.14 | `ImportanceScoreMap` MUST be `ReadonlyMap<ClaimId, ImportanceScore>` | S5.3 |

### 5.4 RankingOptions

| ID | Requirement | Source |
|---|---|---|
| CG-5.15 | `RankingOptions.limit` MUST be optional number for maximum entries to return | S5.4 |
| CG-5.16 | `RankingOptions.includePinned` MUST default to `true` | S5.4 |
| CG-5.17 | `RankingOptions.domain` MUST be optional string for predicate domain prefix filter | S5.4 |
| CG-5.18 | `RankingOptions.freshnessFilter` MUST accept `readonly FreshnessLabel[]` from SHARED_TYPES SS2 | S5.4 |
| CG-5.19 | `RankingOptions.minImportance` MUST be optional number for minimum importance score threshold | S5.4 |

### 5.5 ContextRanking

| ID | Requirement | Source |
|---|---|---|
| CG-5.20 | `ContextRanking.entries` MUST be `readonly RankedEntry[]` | S5.5 |
| CG-5.21 | `ContextRanking.totalScored` MUST be readonly number of total claims scored | S5.5 |
| CG-5.22 | `ContextRanking.cutoffScore` MUST be the importance score below which claims become eviction candidates | S5.5 |

### 5.6 RankedEntry

| ID | Requirement | Source |
|---|---|---|
| CG-5.23 | `RankedEntry` MUST have readonly fields: `claimId`, `subject`, `predicate`, `importance`, `effectiveConfidence`, `freshness`, `pinned`, `pinPriority`, `estimatedTokens` | S5.6 |
| CG-5.24 | `RankedEntry.freshness` MUST use `FreshnessLabel` from SHARED_TYPES SS2 | S5.6 |
| CG-5.25 | `RankedEntry.pinPriority` MUST be `PinPriority | null` | S5.6 |
| CG-5.26 | `RankedEntry.estimatedTokens` MUST be the estimated token count for the claim's content | S5.6 |

### 5.7 PinPriority

| ID | Requirement | Source |
|---|---|---|
| CG-5.27 | `PinPriority` MUST be union type: `'critical' | 'high' | 'normal'` | S5.7 |
| CG-5.28 | `critical` pinned claims MUST never be auto-evicted under any pressure level | S5.7 |
| CG-5.29 | `high` pinned claims MUST be evicted only under `critical` pressure | S5.7 |
| CG-5.30 | `normal` pinned claims MUST be evicted under `high` or `critical` pressure | S5.7 |
| CG-5.31 | All `ImportanceScore` and `RankedEntry` fields MUST be readonly | S5.1, S5.6 |

**Totals: 31 requirements**

---

## Section 6: Eviction Data Models

### 6.1 EvictionCandidate

| ID | Requirement | Source |
|---|---|---|
| CG-6.1 | `EvictionCandidate` MUST have readonly fields: `claimId`, `subject`, `predicate`, `importance`, `freshness`, `lastAccessedAt`, `estimatedTokens`, `evictionReason` | S6.1 |
| CG-6.2 | `EvictionCandidate.freshness` MUST use `FreshnessLabel` from SHARED_TYPES SS2 | S6.1 |
| CG-6.3 | `EvictionCandidate.lastAccessedAt` MUST be `string | null` | S6.1 |
| CG-6.4 | `EvictionCandidate.estimatedTokens` MUST represent tokens freed if claim is evicted | S6.1 |

### 6.2 EvictionReason

| ID | Requirement | Source |
|---|---|---|
| CG-6.5 | `EvictionReason` MUST be union type: `'lowest_importance' | 'stale' | 'low_confidence' | 'budget_pressure' | 'manual'` | S6.2 |

### 6.3 EvictionResult

| ID | Requirement | Source |
|---|---|---|
| CG-6.6 | `EvictionResult.evicted` MUST be readonly number of claims evicted | S6.3 |
| CG-6.7 | `EvictionResult.freedTokens` MUST be readonly number of tokens freed | S6.3 |
| CG-6.8 | `EvictionResult.newUtilization` MUST be readonly `ContextUtilization` | S6.3 |
| CG-6.9 | `EvictionResult.evictedEntries` MUST be a readonly array of `{ claimId: ClaimId, reason: EvictionReason }` | S6.3 |

### 6.4 EvictionPolicy

| ID | Requirement | Source |
|---|---|---|
| CG-6.10 | `EvictionPolicy.strategy` MUST be of type `EvictionStrategy` | S6.4 |
| CG-6.11 | `EvictionPolicy.thresholds` MUST be of type `EvictionThresholds` | S6.4 |
| CG-6.12 | `EvictionPolicy.protectedDomains` MUST be optional `readonly string[]` of predicate prefixes immune to auto-eviction | S6.4 |
| CG-6.13 | `EvictionPolicy.protectedClassifications` MUST be optional `readonly ClassificationLevel[]` from SHARED_TYPES SS3 immune to auto-eviction | S6.4 |
| CG-6.14 | `EvictionPolicy.maxEvictionBatch` MUST be readonly number limiting maximum claims evicted in a single pass | S6.4 |

### 6.5 EvictionStrategy

| ID | Requirement | Source |
|---|---|---|
| CG-6.15 | `EvictionStrategy` MUST be union type: `'importance_score' | 'lru' | 'freshness_first' | 'composite'` | S6.5 |
| CG-6.16 | Strategy `importance_score`: lowest importance MUST be evicted first | S6.5 |
| CG-6.17 | Strategy `lru`: least recently accessed MUST be evicted first | S6.5 |
| CG-6.18 | Strategy `freshness_first`: stale claims evicted before aging, aging before fresh | S6.5 |
| CG-6.19 | Strategy `composite`: weighted combination `0.5 * importance + 0.3 * recency + 0.2 * freshness` | S6.5 |

### 6.6 EvictionThresholds

| ID | Requirement | Source |
|---|---|---|
| CG-6.20 | `EvictionThresholds.autoEvictBelowImportance` MUST be readonly number (default: 0.1) | S6.6 |
| CG-6.21 | `EvictionThresholds.autoEvictStaleAfterDays` MUST be readonly number (default: 30) | S6.6 |
| CG-6.22 | `EvictionThresholds.pressureTrigger` MUST be readonly `ContextPressure` (default: `'high'`) | S6.6 |
| CG-6.23 | Auto-eviction triggers at the configured pressure level | S6.6 |
| CG-6.24 | All eviction data model fields MUST be readonly | S6.1-6.6 |

**Totals: 24 requirements**

---

## Section 7: Working Memory Data Models

### 7.1 WorkingMemoryEntry

| ID | Requirement | Source |
|---|---|---|
| CG-7.1 | `WorkingMemoryEntry.key` MUST be readonly string | S7.1 |
| CG-7.2 | `WorkingMemoryEntry.value` MUST be readonly string | S7.1 |
| CG-7.3 | `WorkingMemoryEntry.namespace` MUST be readonly string | S7.1 |
| CG-7.4 | `WorkingMemoryEntry.sizeBytes` MUST be readonly number | S7.1 |
| CG-7.5 | `WorkingMemoryEntry.createdAt` MUST be readonly string (ISO-8601) | S7.1 |
| CG-7.6 | `WorkingMemoryEntry.updatedAt` MUST be readonly string (ISO-8601) | S7.1 |
| CG-7.7 | `WorkingMemoryEntry.accessCount` MUST be readonly number | S7.1 |
| CG-7.8 | `WorkingMemoryEntry.lastAccessedAt` MUST be readonly string (ISO-8601) | S7.1 |
| CG-7.9 | `WorkingMemoryEntry.mutationPosition` MUST be readonly number (monotonic counter for ordering mutations within a namespace) | S7.1 |

### 7.2 WorkingMemoryOptions

| ID | Requirement | Source |
|---|---|---|
| CG-7.10 | `WorkingMemoryOptions.namespace` MUST be optional string (default: session namespace derived from SessionId) | S7.2 |
| CG-7.11 | `WorkingMemoryOptions.ttl` MUST be optional number in seconds (null = no expiry) | S7.2 |
| CG-7.12 | `WorkingMemoryOptions.priority` MUST be optional number 0-100 affecting eviction ordering (higher = retained longer) | S7.2 |
| CG-7.13 | `WorkingMemoryOptions.maxSize` MUST be optional number in bytes; reject if value exceeds | S7.2 |

### 7.3 WorkingMemoryListOptions

| ID | Requirement | Source |
|---|---|---|
| CG-7.14 | `WorkingMemoryListOptions.namespace` MUST be optional string for namespace filter | S7.3 |
| CG-7.15 | `WorkingMemoryListOptions.prefix` MUST be optional string for key prefix filter | S7.3 |
| CG-7.16 | `WorkingMemoryListOptions.limit` MUST be optional number (default: 100) | S7.3 |
| CG-7.17 | `WorkingMemoryListOptions.sortBy` MUST be optional `'key' | 'updated' | 'size' | 'priority'` | S7.3 |

### 7.4 WorkingMemoryUsage

| ID | Requirement | Source |
|---|---|---|
| CG-7.18 | `WorkingMemoryUsage` MUST have readonly fields: `namespace`, `entryCount`, `totalBytes`, `maxBytes`, `utilizationPercent`, `oldestEntry`, `newestEntry` | S7.4 |
| CG-7.19 | `WorkingMemoryUsage.utilizationPercent` MUST be 0-100 | S7.4 |
| CG-7.20 | `WorkingMemoryUsage.maxBytes` MUST be the configured maximum bytes for the namespace | S7.4 |
| CG-7.21 | All working memory data model fields MUST be readonly | S7.1-7.4 |

**Totals: 21 requirements**

---

## Section 8: Boundary Trigger Data Models

### 8.1 BoundaryTriggerConfig

| ID | Requirement | Source |
|---|---|---|
| CG-8.1 | `BoundaryTriggerConfig.id` MUST be optional readonly string (assigned on registration) | S8.1 |
| CG-8.2 | `BoundaryTriggerConfig.type` MUST be readonly `BoundaryTriggerType` | S8.1 |
| CG-8.3 | `BoundaryTriggerConfig.action` MUST be readonly `BoundaryAction` | S8.1 |
| CG-8.4 | `BoundaryTriggerConfig.condition` MUST be optional readonly `BoundaryCondition` | S8.1 |

### 8.2 BoundaryTriggerType

| ID | Requirement | Source |
|---|---|---|
| CG-8.5 | `BoundaryTriggerType` MUST be union: `'checkpoint' | 'task_terminal' | 'mission_transition' | 'pre_irreversible_emission' | 'suspension' | 'context_pressure' | 'budget_exhausted' | 'custom'` | S8.2 |

### 8.3 BoundaryAction

| ID | Requirement | Source |
|---|---|---|
| CG-8.6 | `BoundaryAction` MUST be union: `'snapshot_working_memory' | 'flush_working_memory' | 'promote_to_claims' | 'evict_stale' | 'compress_context' | 'custom'` | S8.3 |
| CG-8.7 | `snapshot_working_memory` MUST serialize current working memory state to a durable claim for later restoration | S8.3 |
| CG-8.8 | `flush_working_memory` MUST discard all entries in the scoped namespace | S8.3 |
| CG-8.9 | `promote_to_claims` MUST convert working memory entries to persistent Limen claims via CCP | S8.3 |
| CG-8.10 | `evict_stale` MUST run eviction pass targeting only stale claims | S8.3 |
| CG-8.11 | `compress_context` MUST re-rank and evict lowest-importance entries until pressure drops below threshold | S8.3 |
| CG-8.12 | `custom` MUST delegate to registered handler function | S8.3 |

### 8.4 BoundaryCondition

| ID | Requirement | Source |
|---|---|---|
| CG-8.13 | `BoundaryCondition.pressure` MUST be optional `ContextPressure` (trigger only at this pressure level or above) | S8.4 |
| CG-8.14 | `BoundaryCondition.namespace` MUST be optional string (trigger only for entries in this namespace) | S8.4 |
| CG-8.15 | `BoundaryCondition.minAge` MUST be optional number (trigger only for entries older than N seconds) | S8.4 |
| CG-8.16 | All boundary trigger data model fields MUST be readonly | S8.1-8.4 |
| CG-8.17 | Boundary triggers fire exactly once per qualifying event | S13 Integration Map |
| CG-8.18 | Boundary condition `pressure` filters by level: trigger fires only when current pressure >= configured pressure | S8.4 |
| CG-8.19 | Boundary condition filtering is conjunctive: all specified conditions must be met for trigger to fire | S8.4 implied |

**Totals: 19 requirements**

---

## Section 9: Context Assembly Data Models

### 9.1 ContextAssemblyOptions

| ID | Requirement | Source |
|---|---|---|
| CG-9.1 | `ContextAssemblyOptions.budget` MUST be readonly number (maximum tokens for assembled context) | S9.1 |
| CG-9.2 | `ContextAssemblyOptions.includeMissionContext` MUST be readonly boolean | S9.1 |
| CG-9.3 | `ContextAssemblyOptions.includeWorkingMemory` MUST be readonly boolean | S9.1 |
| CG-9.4 | `ContextAssemblyOptions.includeBeliefs` MUST be readonly boolean | S9.1 |
| CG-9.5 | `ContextAssemblyOptions.beliefQuery` MUST be optional `ContextBeliefQuery` | S9.1 |
| CG-9.6 | `ContextAssemblyOptions.prioritizeRecent` MUST be optional boolean (bias ranking toward recently accessed claims) | S9.1 |
| CG-9.7 | `ContextAssemblyOptions.includePinnedOnly` MUST be optional boolean (include only pinned claims, skip importance ranking) | S9.1 |

### 9.2 ContextBeliefQuery

| ID | Requirement | Source |
|---|---|---|
| CG-9.8 | `ContextBeliefQuery` MUST have optional readonly fields: `subject`, `predicate`, `minConfidence`, `limit` | S9.2 |
| CG-9.9 | `ContextBeliefQuery` is a contract-local type, not shared, despite structural equivalence to Memory Bridge recall query | S9.2 |

### 9.3 AssembledContext

| ID | Requirement | Source |
|---|---|---|
| CG-9.10 | `AssembledContext.sections` MUST be `readonly ContextSection[]` | S9.3 |
| CG-9.11 | `AssembledContext.totalTokens` MUST be readonly number | S9.3 |
| CG-9.12 | `AssembledContext.budgetUsed` MUST be readonly number | S9.3 |
| CG-9.13 | `AssembledContext.budgetRemaining` MUST be readonly number | S9.3 |
| CG-9.14 | `AssembledContext.evictedForAssembly` MUST be readonly number counting claims that scored high enough but did not fit | S9.3 |
| CG-9.15 | `AssembledContext.assemblyStrategy` MUST be readonly string | S9.3 |

### 9.4 ContextSection

| ID | Requirement | Source |
|---|---|---|
| CG-9.16 | `ContextSection.position` MUST be readonly number: 1=mission, 2=working_memory, 3+=beliefs | S9.4 |
| CG-9.17 | `ContextSection.type` MUST be readonly `'mission' | 'working_memory' | 'belief'` | S9.4 |
| CG-9.18 | `ContextSection.importance` MUST be 1.0 for mission and working_memory types. **NOTE (P3-8):** This is a documentation note of default behavior, not a normative MUST constraint — importance=1.0 is the position-derived default for these section types, not a configurable override. | S9.4 |
| CG-9.19 | `ContextSection.content` MUST be readonly string containing the serialized section content | S9.4 |
| CG-9.20 | `ContextSection.tokens` MUST be readonly number representing the token count for this section | S9.4 |
| CG-9.21 | `ContextSection.source` MUST be readonly `ContextSectionSource` identifying the origin of the section content | S9.4 |

### 9.5 ContextSectionSource

| ID | Requirement | Source |
|---|---|---|
| CG-9.22 | `ContextSectionSource` MUST have optional readonly fields: `claimId?: ClaimId`, `key?: string`, `missionId?: MissionId` | S9.5 |

**Totals: 22 requirements**

---

## Section 10: Event Payloads

| ID | Requirement | Source |
|---|---|---|
| CG-10.1 | `PressureChangedData` MUST have readonly fields: `previous: ContextPressure`, `current: ContextPressure`, `utilization: number` | S10 |
| CG-10.2 | `EvictionTriggeredData` MUST have readonly fields: `reason: EvictionReason`, `pressure: ContextPressure`, `candidateCount: number` | S10 |
| CG-10.3 | `EvictionCompleteData` MUST have readonly field: `result: EvictionResult` | S10 |
| CG-10.4 | `BudgetUpdatedData` MUST have readonly fields: `previous: ContextBudgetConfig`, `current: ContextBudgetConfig` | S10 |
| CG-10.5 | `PinChangedData` MUST have readonly fields: `claimId: ClaimId`, `priority: PinPriority | null`, `action: 'added' | 'removed'` | S10 |
| CG-10.6 | `WorkingMemoryWrittenData` MUST have readonly fields: `key: string`, `namespace: string`, `sizeBytes: number`, `isUpdate: boolean` | S10 |
| CG-10.7 | `WorkingMemoryDiscardedData` MUST have readonly fields: `key: string`, `namespace: string` | S10 |
| CG-10.8 | `WorkingMemoryFlushedData` MUST have readonly fields: `namespace: string`, `entriesFlushed: number` | S10 |
| CG-10.9 | `BoundaryTriggeredData` MUST have readonly fields: `triggerId: string`, `type: BoundaryTriggerType`, `action: BoundaryAction` | S10 |
| CG-10.10 | `AssemblyCompleteData` MUST have readonly fields: `totalTokens: number`, `sectionCount: number`, `evictedForAssembly: number` | S10 |
| CG-10.11 | All event payloads are carried in `AgentEventPayload.data` from the unified event system | S10 |

> **NOTE (P2-5/6/7):** Event payload types `BudgetUpdatedData`, `BoundaryTriggeredData`, and `AssemblyCompleteData` are defined as data structures but lack corresponding event name identifiers in the S3 event list. `BudgetUpdatedData` has no matching `context:budget_updated` event; `BoundaryTriggeredData` has no matching `context:boundary_triggered` event; `AssemblyCompleteData` has no matching `context:assembly_complete` event. These payloads are orphaned unless the event names are added to the contract or mapped to existing events.

**Totals: 11 requirements**

---

## Section 11: Error Types

| ID | Requirement | Source |
|---|---|---|
| CG-11.1 | Error `BUDGET_EXCEEDED` MUST include: `requested: number`, `available: number`, `dimension: 'tokens'` | S11 |
| CG-11.2 | Error `WORKING_MEMORY_FULL` MUST include: `namespace: string`, `currentBytes: number`, `maxBytes: number` | S11 |
| CG-11.3 | Error `ENTRY_TOO_LARGE` MUST include: `key: string`, `size: number`, `maxSize: number` | S11 |
| CG-11.4 | Error `PIN_LIMIT_EXCEEDED` MUST include: `currentPins: number`, `maxPins: number` | S11 |
| CG-11.5 | Error `EVICTION_BLOCKED` MUST include: `claimId: ClaimId`, `reason: string` | S11 |
| CG-11.6 | Error `NAMESPACE_NOT_FOUND` MUST include: `namespace: string` | S11 |
| CG-11.7 | Error `KEY_NOT_FOUND` MUST include: `key: string`, `namespace: string` | S11 |
| CG-11.8 | Error `TRIGGER_NOT_FOUND` MUST include: `triggerId: string` | S11 |
| CG-11.9 | Error `ASSEMBLY_FAILED` MUST include: `reason: string` | S11 |
| CG-11.10 | Error `GOVERNANCE_REFUSAL` MUST include: `reason: string`, `action: string` | S11 |
| CG-11.11 | Error `ALLOCATION_OVERFLOW` MUST include: `totalPercent: number`, `maxPercent: 100` | S11 |
| CG-11.12 | Error `INVALID_WEIGHT_SUM` MUST include: `actualSum: number`, `expectedSum: 1.0` | S11 |

**Totals: 12 requirements**

---

## Section 12: Rust Trait (v5 Alignment)

### Rust Enums

| ID | Requirement | Source |
|---|---|---|
| CG-12.1 | Rust `ContextPressure` enum MUST have variants: `Low`, `Moderate`, `High`, `Critical` with correct ordering (PartialOrd, Ord) | S12 |
| CG-12.2 | Rust `PinPriority` enum MUST have variants: `Critical`, `High`, `Normal` | S12 |
| CG-12.3 | Rust `EvictionStrategy` enum MUST have variants: `ImportanceScore`, `Lru`, `FreshnessFirst`, `Composite` | S12 |
| CG-12.4 | Rust `EvictionReason` enum MUST have variants: `LowestImportance`, `Stale`, `LowConfidence`, `BudgetPressure`, `Manual` | S12 |
| CG-12.5 | Rust `BoundaryTriggerType` enum MUST have variants: `Checkpoint`, `TaskTerminal`, `MissionTransition`, `PreIrreversibleEmission`, `Suspension`, `ContextPressure`, `BudgetExhausted`, `Custom` | S12 |
| CG-12.6 | Rust `BoundaryAction` enum MUST have variants: `SnapshotWorkingMemory`, `FlushWorkingMemory`, `PromoteToClaims`, `EvictStale`, `CompressContext`, `Custom` | S12 |
| CG-12.7 | Rust `ContextSectionType` enum MUST have variants: `Mission` (Position 1), `WorkingMemory` (Position 2), `Belief` (Position 3+) | S12 |

### Rust Error Type

| ID | Requirement | Source |
|---|---|---|
| CG-12.8 | Rust `ContextError` MUST derive `Debug` and implement `thiserror::Error` | S12 |
| CG-12.9 | Rust `ContextError::BudgetExceeded` MUST have fields: `requested: u64`, `available: u64` | S12 |
| CG-12.10 | Rust `ContextError::WorkingMemoryFull` MUST have fields: `namespace: String`, `current_bytes: u64`, `max_bytes: u64` | S12 |
| CG-12.11 | Rust `ContextError::EntryTooLarge` MUST have fields: `key: String`, `size: u64`, `max_size: u64` | S12 |
| CG-12.12 | Rust `ContextError::PinLimitExceeded` MUST have fields: `current_pins: u32`, `max_pins: u32` | S12 |
| CG-12.13 | Rust `ContextError::EvictionBlocked` MUST have fields: `claim_id: String`, `reason: String` | S12 |
| CG-12.14 | Rust `ContextError::NamespaceNotFound` MUST have field: `namespace: String` | S12 |
| CG-12.15 | Rust `ContextError::KeyNotFound` MUST have fields: `key: String`, `namespace: String` | S12 |
| CG-12.16 | Rust `ContextError::TriggerNotFound` MUST have field: `trigger_id: String` | S12 |
| CG-12.17 | Rust `ContextError::AssemblyFailed` MUST have field: `reason: String` | S12 |
| CG-12.18 | Rust `ContextError::GovernanceRefusal` MUST have fields: `action: String`, `reason: String` | S12 |
| CG-12.19 | Rust `ContextError::AllocationOverflow` MUST have field: `total_percent: f64` | S12 |
| CG-12.20 | Rust `ContextError::InvalidWeightSum` MUST have field: `actual_sum: f64` | S12 |

### Rust Structs

| ID | Requirement | Source |
|---|---|---|
| CG-12.21 | Rust `ImportanceScore` MUST have fields: `score: f64`, `factors: ImportanceFactors`, `weights: ImportanceWeights` | S12 |
| CG-12.22 | Rust `ImportanceFactors` MUST have 5 `f64` fields: `access_frequency`, `recency`, `connection_density`, `confidence`, `governance_weight` | S12 |
| CG-12.23 | Rust `ImportanceWeights` MUST have 5 `f64` fields matching `ImportanceFactors` field names | S12 |
| CG-12.24 | Rust `ContextBudgetConfig` MUST have fields: `max_tokens: u64`, `reserved_for_system: u64`, `reserved_for_output: u64`, `mission_context_allocation: f64`, `working_memory_allocation: f64`, `belief_allocation: f64` | S12 |
| CG-12.25 | Rust `ContextBudget` MUST have fields: `config`, `total_available`, `allocated_mission_context`, `allocated_working_memory`, `allocated_beliefs` | S12 |
| CG-12.26 | Rust `ContextUtilization` MUST have fields for budget, used (4 u64s), available (4 u64s), utilization_percent (f64), pressure | S12 |
| CG-12.27 | Rust `EvictionResult` MUST have fields: `evicted: u32`, `freed_tokens: u64`, `new_utilization`, `evicted_entries: Vec<(String, EvictionReason)>` | S12 |
| CG-12.28 | Rust `EvictionPolicy` MUST have fields: `strategy`, `thresholds`, `protected_domains: Option<Vec<String>>`, `protected_classifications`, `max_eviction_batch: u32` | S12 |
| CG-12.29 | Rust `EvictionThresholds` MUST have fields: `auto_evict_below_importance: f64`, `auto_evict_stale_after_days: u32`, `pressure_trigger: ContextPressure` | S12 |
| CG-12.30 | Rust `WorkingMemoryEntry` MUST have 9 fields matching the TypeScript interface with snake_case | S12 |
| CG-12.31 | Rust `BoundaryTriggerConfig` MUST have fields: `id: Option<String>`, `trigger_type`, `action`, `condition: Option<BoundaryCondition>` | S12 |
| CG-12.32 | Rust `BoundaryCondition` MUST have fields: `pressure: Option<ContextPressure>`, `namespace: Option<String>`, `min_age: Option<u64>` | S12 |

### Rust Trait

| ID | Requirement | Source |
|---|---|---|
| CG-12.33 | Rust trait `AgentContextGovernor` MUST be `Send + Sync` | S12 |
| CG-12.34 | Rust trait MUST define 20 async methods matching the TypeScript interface (see TC-21 gap section for 2 missing methods) | S12 |
| CG-12.35 | Rust trait methods for mutating operations MUST take `&OperationContext` as first arg after `&self` | S12 |
| CG-12.36 | Rust `RankingOptions` MUST have 5 optional fields matching TypeScript | S12 |
| CG-12.37 | Rust `EvictionCandidate` MUST have 8 fields matching TypeScript with snake_case | S12 |
| CG-12.38 | Rust `WorkingMemoryOptions` MUST have 4 optional fields with `priority: Option<u8>` (not number) | S12 |
| CG-12.39 | Rust `ContextAssemblyOptions` MUST have 7 fields matching TypeScript with snake_case | S12 |

**Totals: 39 requirements**

---

## Section 13: Integration Map

| ID | Requirement | Source |
|---|---|---|
| CG-13.1 | `writeWorkingMemory` MUST map to SC-14 (write_working_memory) with WMP SS5.2 namespace isolation enforced | S13 |
| CG-13.2 | `readWorkingMemory` MUST map to SC-15 (read_working_memory) with WMP SS5.3; MUST update `accessCount` and `lastAccessedAt` | S13 |
| CG-13.3 | `discardWorkingMemory` MUST map to SC-16 (discard_working_memory) with WMP SS5.4; audit trail MUST be preserved | S13 |
| CG-13.4 | `flushWorkingMemory` MUST map to batch SC-16; MUST return count of entries flushed | S13 |
| CG-13.5 | `scoreImportance` MUST map to Cognitive Engine importance scoring with CGP SS9; FSRS decay applied to recency factor | S13 |
| CG-13.6 | `assembleContext` MUST map to CGP position-based assembly with CGP SS9; positions 1-2-3+ strictly ordered | S13 |
| CG-13.7 | `evict` MUST archive claims via CCP + audit entry; MUST never delete -- only move to archive | S13 |
| CG-13.8 | `registerBoundaryTrigger` MUST map to WMP boundary events with WMP SS6.4; MUST fire exactly once per event | S13 |
| CG-13.9 | `getContextRanking` MUST map to Cognitive Engine + relationship graph with CGP SS9; `connectionDensity` from graph edges | S13 |
| CG-13.10 | `pinToContext` MUST map to pin registry (context governor state) with CGP SS9; subject to `PIN_LIMIT_EXCEEDED` | S13 |

**Totals: 10 requirements**

---

## Section 14: Invariants

| ID | Requirement | Source |
|---|---|---|
| CG-14.1 | Budget Conservation: `missionContextAllocation + workingMemoryAllocation + beliefAllocation <= 100`; violation produces `ALLOCATION_OVERFLOW` | S14 Inv1 |
| CG-14.2 | Pin Immunity: `critical` pinned claims MUST never be auto-evicted; only explicit `evict()` with manual reason can remove them | S14 Inv2 |
| CG-14.3 | Classification Protection: claims with classifications in `protectedClassifications` MUST be immune to all auto-eviction strategies | S14 Inv3 |
| CG-14.4 | Namespace Isolation: working memory reads/writes scoped to single namespace; cross-namespace requires explicit parameter, no implicit fallthrough | S14 Inv4 |
| CG-14.5 | Eviction Audit: every eviction (auto or manual) MUST produce audit entry recording: claim IDs, freed tokens, reason, timestamp, resulting utilization | S14 Inv5 |
| CG-14.6 | Assembly Determinism: identical inputs MUST produce identical section ordering; tie-break by claim creation timestamp (older first), then claim ID lexicographic | S14 Inv6 |
| CG-14.7 | Trigger Idempotency: boundary triggers fire exactly once per qualifying event; re-entrant trigger chains MUST be detected and blocked | S14 Inv7 |
| CG-14.8 | TTL Enforcement: expired working memory entries cleaned up on next namespace access; expired entries invisible to reads and listings | S14 Inv8 |
| CG-14.9 | Factor Normalization: all importance scoring factors individually normalized to [0,1]; composite score is weighted sum with weights summing to exactly 1.0 | S14 Inv9 |
| CG-14.10 | Pressure Derivation: derived purely from `used.total / budget.totalAvailable`; no manual override; transitions emit `context:pressure_changed` via unified event bus | S14 Inv10 |
| CG-14.11 | Position Invariance: assembly MUST always produce sections in position order: mission (1), working memory (2), beliefs (3+); structurally enforced, no configuration can reorder | S14 Inv11 |
| CG-14.12 | Budget Hard Cap: `assembleContext` MUST never return `totalTokens > options.budget`; excess claims excluded and counted in `evictedForAssembly` | S14 Inv12 |

**Totals: 12 requirements**

---

## Section 15: Assembly Algorithm

| ID | Requirement | Source |
|---|---|---|
| CG-15.1 | Token counting MUST use the canonical `TokenEstimator` contract in SHARED_TYPES.md SS20.1 | S15 |
| CG-15.2 | Estimator MUST use `provider_native` when active model exposes a tokenizer | S15 |
| CG-15.3 | Estimator MUST fall back to `o200k_base` for modern OpenAI-compatible models | S15 |
| CG-15.4 | Estimator MUST fall back to `cl100k_base` as final fallback | S15 |
| CG-15.5 | Approximate estimates MUST carry `varianceUpperBoundPct <= 10` | S15 |
| CG-15.6 | Items whose upper-bound estimate exceeds remaining budget MUST be excluded and counted in `evictedForAssembly` | S15 |
| CG-15.7 | Tokenization failure MUST be treated as estimator overflow, never as zero tokens | S15 |
| CG-15.8 | Caller-supplied `options.budget` overflow MUST be rejected before assembly | S15 |
| CG-15.9 | If `includeMissionContext` is true: load mission sections sorted by position ASC | S15 Algorithm |
| CG-15.10 | Upper bound tokens MUST be calculated as `ceil(tokens * (1 + varianceUpperBoundPct / 100))` | S15 Algorithm |
| CG-15.11 | If upper bound tokens exceed remaining budget for mission section: break (no partial sections) | S15 Algorithm |
| CG-15.12 | If `includeWorkingMemory` is true: load WM entries sorted by priority DESC, updatedAt DESC | S15 Algorithm |
| CG-15.13 | WM entries that exceed remaining budget MUST be excluded (counted as evicted) but continue processing remaining | S15 Algorithm |
| CG-15.14 | If `includeBeliefs` is true: rank beliefs using `beliefQuery`, `prioritizeRecent`, `includePinnedOnly` | S15 Algorithm |
| CG-15.15 | Belief candidates MUST be sorted by importance DESC | S15 Algorithm |
| CG-15.16 | Overflow items (tokenization failure) MUST increment `evictedForAssembly` and CONTINUE | S15 Algorithm |
| CG-15.17 | Assembly MUST return `AssembledContext` with `sections`, `totalTokens`, `budgetUsed`, `budgetRemaining`, `evictedForAssembly` | S15 Algorithm |
| CG-15.18 | Remaining budget MUST be decremented by `upperBoundTokens` (not raw tokens) for safety margin | S15 Algorithm |

**Totals: 18 requirements**

---

## Section 16: Auto-Eviction Algorithm

| ID | Requirement | Source |
|---|---|---|
| CG-16.1 | Auto-eviction MUST NOT execute if `utilization.pressure < policy.thresholds.pressureTrigger` | S16 |
| CG-16.2 | Claims with `critical` pin priority MUST be skipped (never evicted) | S16 |
| CG-16.3 | Claims with `high` pin priority MUST be skipped unless pressure is `critical` | S16 |
| CG-16.4 | Claims with predicate matching any `protectedDomains` prefix MUST be skipped | S16 |
| CG-16.5 | Claims with classification in `protectedClassifications` MUST be skipped | S16 |
| CG-16.6 | Claims with importance below `autoEvictBelowImportance` MUST be added as candidates with reason `lowest_importance` | S16 |
| CG-16.7 | Stale claims with days since access > `autoEvictStaleAfterDays` MUST be added as candidates with reason `stale` | S16 |
| CG-16.8 | Strategy `importance_score`: sort candidates ASC by score | S16 |
| CG-16.9 | Strategy `lru`: sort candidates ASC by `lastAccessedAt` | S16 |
| CG-16.10 | Strategy `freshness_first`: stale first, then aging, then fresh; within group by score ASC | S16 |
| CG-16.11 | Strategy `composite`: sort ASC by `(0.5*score + 0.3*recency + 0.2*freshness_numeric)` | S16 |
| CG-16.12 | Eviction batch MUST be limited to `min(candidates.length, policy.maxEvictionBatch)` | S16 |
| CG-16.13 | Eviction MUST be executed via `evict(ctx, evictionBatch, 'auto_eviction')` | S16 |
| CG-16.14 | `context:eviction_complete` event MUST be emitted via unified AgentEventBus after auto-eviction | S16 |
| CG-16.15 | Auto-eviction candidate selection MUST iterate all active claims in context | S16 |
| CG-16.16 | Only claims meeting the threshold criteria (importance below threshold OR stale beyond days) become candidates | S16 |

**Totals: 16 requirements**

---

## Section 17: Governance Boundaries

| ID | Requirement | Source |
|---|---|---|
| CG-17.1 | `getContextBudget` requires `read_wm` permission, unrestricted clearance | S17 |
| CG-17.2 | `setContextBudget` requires `manage_cognitive` permission, `internal` clearance, GovernanceAction `{ domain: 'context', operation: 'write_wm' }` | S17 |
| CG-17.3 | `scoreImportance` requires `query_claims` permission, unrestricted clearance | S17 |
| CG-17.4 | `pinToContext` requires `write_wm` permission, `internal` clearance, GovernanceAction `{ domain: 'context', operation: 'pin' }` | S17 |
| CG-17.5 | `evict` (manual) requires `write_wm` permission, `internal` clearance, GovernanceAction `{ domain: 'context', operation: 'evict' }` | S17 |
| CG-17.6 | `setEvictionPolicy` requires `manage_cognitive` permission, `confidential` clearance, GovernanceAction `{ domain: 'context', operation: 'evict' }` | S17 |
| CG-17.7 | `writeWorkingMemory` requires `write_wm` permission, unrestricted clearance, GovernanceAction `{ domain: 'context', operation: 'write_wm' }` | S17 |
| CG-17.8 | `readWorkingMemory` requires `read_wm` permission, unrestricted clearance | S17 |
| CG-17.9 | `flushWorkingMemory` requires `manage_cognitive` permission, `internal` clearance, GovernanceAction `{ domain: 'context', operation: 'discard_wm' }` | S17 |
| CG-17.10 | `registerBoundaryTrigger` requires `manage_cognitive` permission, `confidential` clearance, GovernanceAction `{ domain: 'context', operation: 'boundary_trigger' }` | S17 |
| CG-17.11 | `unregisterBoundaryTrigger` requires `manage_cognitive` permission, `confidential` clearance, GovernanceAction `{ domain: 'context', operation: 'boundary_trigger' }` | S17 |
| CG-17.12 | `assembleContext` requires `read_wm` + `query_claims` permissions, unrestricted clearance | S17 |
| CG-17.13 | All mutating operations MUST take explicit `OperationContext` at the public interface | S17 |
| CG-17.14 | All mutating operations MUST derive their `GovernanceAction` from the method row before mutation | S17 |
| CG-17.15 | Operations on claims with classification higher than agent's clearance level MUST produce `GOVERNANCE_REFUSAL` | S17 |
| CG-17.16 | Eviction of `restricted` or `critical` claims MUST require `manage_cognitive` regardless of eviction strategy | S17 |
| CG-17.17 | GovernanceAction types MUST reference the unified `GovernanceAction` discriminated union from SHARED_TYPES SS9 | S17 |

**Totals: 17 requirements**

---

## TC-21 Cross-Language Parity Gaps

| ID | Requirement | Source |
|---|---|---|
| CG-XX.01 | Rust trait `AgentContextGovernor` MUST add async method `list_working_memory(&self, options: Option<&WorkingMemoryListOptions>) -> Result<Vec<WorkingMemoryEntry>, ContextError>` to match TypeScript `listWorkingMemory` (CG-3.15). Currently missing from the Rust trait definition. | TC-21 Gap |
| CG-XX.02 | Rust trait `AgentContextGovernor` MUST add async method `get_working_memory_usage(&self) -> Result<WorkingMemoryUsage, ContextError>` to match TypeScript `getWorkingMemoryUsage` (CG-3.18). Currently missing from the Rust trait definition. | TC-21 Gap |

> **NOTE:** These 2 methods exist in the TypeScript `AgentContextClient` interface (CG-3.15, CG-3.18) but have no corresponding Rust trait methods. CG-12.34 count has been corrected from 18 to 20 to account for these methods once added.

**Totals: 2 requirements**

---

## Grand Total

| Section | Count |
|---|---|
| S1: Purpose & Scope | 5 |
| S2: Relationship | 8 |
| S3: Interface | 22 |
| S3: Events | 12 |
| S4: Budget Models | 23 |
| S5: Importance & Ranking | 31 |
| S6: Eviction Models | 24 |
| S7: Working Memory Models | 21 |
| S8: Boundary Triggers | 19 |
| S9: Assembly Models | 22 |
| S10: Event Payloads | 11 |
| S11: Error Types | 12 |
| S12: Rust Trait | 39 |
| S13: Integration Map | 10 |
| S14: Invariants | 12 |
| S15: Assembly Algorithm | 18 |
| S16: Auto-Eviction Algorithm | 16 |
| S17: Governance Boundaries | 17 |
| TC-21: Parity Gaps | 2 |
| **Grand Total** | **324** |
