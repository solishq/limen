<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# Agent Context Governance Contract v1.2.2

**Status:** RATIFIED DESIGN --- Pending Implementation
**Governing:** SolisForge Protocol v1.4 [HISTORICAL: CDM v2.1 + Contract Compliance v2.1 — superseded]
**Scope:** Context budget management, importance-based eviction, and working memory governance for AI agents
**Classification:** QAL-3 (agent operational integrity)

> **Shared Types:** All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`. This contract does NOT redefine any shared type. Local types are contract-specific and not used by other contracts.

---

## 1. Purpose

This contract defines how AI agents manage their finite context window through governed eviction, importance-based prioritization, and working memory lifecycle. It ensures agents always retain the most relevant context while respecting budget constraints and governance boundaries. All eviction decisions produce audit trails; all assembly operations are deterministic and reproducible.

## 2. Context Governance vs Memory Bridge: Relationship

The Memory Bridge contract and this Context Governance contract are complementary subsystems that operate on the same underlying claim store but serve distinct purposes:

| Concern | Memory Bridge (`recall()`) | Context Governance (`assembleContext()`) |
|---|---|---|
| **Purpose** | Query the full belief store with filters | Construct a budget-constrained context window for LLM consumption |
| **Scope** | All claims matching query parameters | Only claims that fit within token budget after importance ranking |
| **Output** | Belief views with confidence and freshness | Ordered sections (mission, working memory, beliefs) with token counts |
| **Budget awareness** | None --- returns all matches up to `limit` | Enforces hard token cap; excess claims excluded |
| **Ordering** | By confidence or relevance | By position (1=mission, 2=WM, 3+=beliefs) then importance |
| **Use case** | Targeted knowledge retrieval during reasoning | LLM context window population before inference |

**Operational pattern:** An agent uses `recall()` (Memory Bridge) for targeted queries during task execution --- "what do I know about X?" --- and uses `assembleContext()` (Context Governance) when constructing the full context payload to send to an LLM. The Context Governor may internally invoke recall-equivalent queries to source belief candidates, but applies budget constraints, importance ranking, and position ordering that recall does not.

## 3. AgentContextClient Interface

```typescript
import type { ClaimId, MissionId, SessionId, Result } from '@limen/types';
// Shared types from SHARED_TYPES.md:
// - OperationContext (SS1.3)
// - AgentEvent (SS16), AgentEventPayload (SS16.2), AgentEventHandler (SS16.2)
// - FreshnessLabel (SS2 CCP Types)
// - ClassificationLevel (SS3)

interface AgentContextClient {
  // Context Budget
  getContextBudget(): Promise<Result<ContextBudget>>;
  setContextBudget(ctx: OperationContext, config: ContextBudgetConfig): Promise<Result<ContextBudget>>;
  getContextUtilization(): Promise<Result<ContextUtilization>>;

  // Importance & Prioritization
  scoreImportance(claimId: ClaimId): Promise<Result<ImportanceScore>>;
  batchScoreImportance(claimIds: readonly ClaimId[]): Promise<Result<ImportanceScoreMap>>;
  getContextRanking(options?: RankingOptions): Promise<Result<ContextRanking>>;
  pinToContext(ctx: OperationContext, claimId: ClaimId, priority: PinPriority): Promise<Result<void>>;
  unpinFromContext(ctx: OperationContext, claimId: ClaimId): Promise<Result<void>>;

  // Eviction
  getEvictionCandidates(count: number): Promise<Result<EvictionCandidate[]>>;
  evict(ctx: OperationContext, claimIds: readonly ClaimId[], reason: string): Promise<Result<EvictionResult>>;
  setEvictionPolicy(ctx: OperationContext, policy: EvictionPolicy): Promise<Result<void>>;
  getEvictionPolicy(): Promise<Result<EvictionPolicy>>;

  // Working Memory
  writeWorkingMemory(ctx: OperationContext, key: string, value: string, options?: WorkingMemoryOptions): Promise<Result<WorkingMemoryEntry>>;
  readWorkingMemory(key: string): Promise<Result<WorkingMemoryEntry | null>>;
  listWorkingMemory(options?: WorkingMemoryListOptions): Promise<Result<WorkingMemoryEntry[]>>;
  discardWorkingMemory(ctx: OperationContext, key: string): Promise<Result<void>>;
  flushWorkingMemory(ctx: OperationContext, namespace?: string): Promise<Result<number>>;
  getWorkingMemoryUsage(): Promise<Result<WorkingMemoryUsage>>;

  // Boundary Management
  registerBoundaryTrigger(ctx: OperationContext, trigger: BoundaryTriggerConfig): Promise<Result<string>>;
  unregisterBoundaryTrigger(ctx: OperationContext, triggerId: string): Promise<Result<void>>;
  listBoundaryTriggers(): Promise<Result<BoundaryTriggerConfig[]>>;

  // Context Assembly
  assembleContext(options: ContextAssemblyOptions): Promise<Result<AssembledContext>>;

  // Events --- uses unified event system (See SHARED_TYPES.md SS16)
  on(event: AgentEvent, handler: AgentEventHandler): string;
  off(subscriptionId: string): void;
}
```

**Applicable events from unified event system (SHARED_TYPES.md SS16.1):**
- `context:pressure_changed`, `context:eviction_triggered`, `context:eviction_complete`
- `context:pin_added`, `context:pin_removed`
- `working_memory:written`, `working_memory:discarded`, `working_memory:flushed`

## 4. Context Budget Data Models

### 4.1 ContextBudgetConfig

```typescript
interface ContextBudgetConfig {
  /** Total context window budget in tokens */
  readonly maxTokens: number;
  /** Tokens reserved for system prompt and instructions */
  readonly reservedForSystem: number;
  /** Tokens reserved for response generation */
  readonly reservedForOutput: number;
  /** Percentage of available tokens allocated to mission context (Position 1) */
  readonly missionContextAllocation: number;
  /** Percentage of available tokens allocated to working memory (Position 2) */
  readonly workingMemoryAllocation: number;
  /** Percentage of available tokens allocated to recalled beliefs (Position 3+) */
  readonly beliefAllocation: number;
}
```

**Constraint:** `missionContextAllocation + workingMemoryAllocation + beliefAllocation <= 100`

### 4.2 ContextBudget

```typescript
interface ContextBudget {
  readonly config: ContextBudgetConfig;
  /** maxTokens - reservedForSystem - reservedForOutput */
  readonly totalAvailable: number;
  readonly allocated: {
    readonly missionContext: number;
    readonly workingMemory: number;
    readonly beliefs: number;
  };
}
```

### 4.3 ContextUtilization

```typescript
interface ContextUtilization {
  readonly budget: ContextBudget;
  readonly used: {
    readonly missionContext: number;
    readonly workingMemory: number;
    readonly beliefs: number;
    readonly total: number;
  };
  readonly available: {
    readonly missionContext: number;
    readonly workingMemory: number;
    readonly beliefs: number;
    readonly total: number;
  };
  /** 0-100, derived from used.total / budget.totalAvailable */
  readonly utilizationPercent: number;
  readonly pressure: ContextPressure;
}
```

### 4.4 ContextPressure

```typescript
type ContextPressure = 'low' | 'moderate' | 'high' | 'critical';
```

Derivation rules (purely from utilization --- no manual override):
- `low`: utilization < 50%
- `moderate`: 50% <= utilization < 75%
- `high`: 75% <= utilization < 90%
- `critical`: utilization >= 90%

## 5. Importance & Ranking Data Models

### 5.1 ImportanceScore

```typescript
interface ImportanceScore {
  /** Composite importance score, 0.0-1.0 */
  readonly score: number;
  readonly factors: {
    /** How frequently this claim has been accessed, normalized [0,1] */
    readonly accessFrequency: number;
    /** Recency of last access, normalized [0,1] via FSRS decay */
    readonly recency: number;
    /** Number of relationships to other claims, normalized [0,1] */
    readonly connectionDensity: number;
    /** Effective confidence after time-decay */
    readonly confidence: number;
    /** Weight derived from classification level and governance role */
    readonly governanceWeight: number;
  };
  readonly weights: ImportanceWeights;
}
```

### 5.2 ImportanceWeights

```typescript
interface ImportanceWeights {
  readonly accessFrequency: number;
  readonly recency: number;
  readonly connectionDensity: number;
  readonly confidence: number;
  readonly governanceWeight: number;
}
```

**Default weights:** `{ accessFrequency: 0.2, recency: 0.25, connectionDensity: 0.15, confidence: 0.2, governanceWeight: 0.2 }`

**Composite calculation:** `score = sum(factor[i] * weight[i])` where all factors are [0,1] and weights sum to 1.0.

**Recency factor derivation:** Uses FSRS decay formula `R(t) = (1 + t/(9*S))^-1` where `t` is time since last access in days and `S` is stability (derived from access pattern).

### 5.3 ImportanceScoreMap

```typescript
type ImportanceScoreMap = ReadonlyMap<ClaimId, ImportanceScore>;
```

### 5.4 RankingOptions

```typescript
interface RankingOptions {
  /** Maximum entries to return */
  readonly limit?: number;
  /** Include pinned claims in ranking (default: true) */
  readonly includePinned?: boolean;
  /** Filter to specific predicate domain prefix */
  readonly domain?: string;
  /** Filter by freshness labels (See SHARED_TYPES.md SS2) */
  readonly freshnessFilter?: readonly FreshnessLabel[];
  /** Minimum importance score threshold */
  readonly minImportance?: number;
}
```

### 5.5 ContextRanking

```typescript
interface ContextRanking {
  readonly entries: readonly RankedEntry[];
  readonly totalScored: number;
  /** Importance score below which claims become eviction candidates */
  readonly cutoffScore: number;
}
```

### 5.6 RankedEntry

```typescript
interface RankedEntry {
  readonly claimId: ClaimId;
  readonly subject: string;
  readonly predicate: string;
  readonly importance: ImportanceScore;
  readonly effectiveConfidence: number;
  readonly freshness: FreshnessLabel; // See SHARED_TYPES.md SS2
  readonly pinned: boolean;
  readonly pinPriority: PinPriority | null;
  /** Estimated token count for this claim's content */
  readonly estimatedTokens: number;
}
```

### 5.7 PinPriority

```typescript
type PinPriority = 'critical' | 'high' | 'normal';
```

Eviction immunity by pin priority:
- `critical`: never auto-evicted under any pressure level
- `high`: evicted only under `critical` pressure
- `normal`: evicted under `high` or `critical` pressure

## 6. Eviction Data Models

### 6.1 EvictionCandidate

```typescript
interface EvictionCandidate {
  readonly claimId: ClaimId;
  readonly subject: string;
  readonly predicate: string;
  readonly importance: ImportanceScore;
  readonly freshness: FreshnessLabel; // See SHARED_TYPES.md SS2
  readonly lastAccessedAt: string | null;
  /** Tokens freed if this claim is evicted */
  readonly estimatedTokens: number;
  readonly evictionReason: EvictionReason;
}
```

### 6.2 EvictionReason

```typescript
type EvictionReason =
  | 'lowest_importance'
  | 'stale'
  | 'low_confidence'
  | 'budget_pressure'
  | 'manual';
```

### 6.3 EvictionResult

```typescript
interface EvictionResult {
  readonly evicted: number;
  readonly freedTokens: number;
  readonly newUtilization: ContextUtilization;
  readonly evictedEntries: readonly {
    readonly claimId: ClaimId;
    readonly reason: EvictionReason;
  }[];
}
```

### 6.4 EvictionPolicy

```typescript
interface EvictionPolicy {
  readonly strategy: EvictionStrategy;
  readonly thresholds: EvictionThresholds;
  /** Predicate prefixes that are immune to auto-eviction */
  readonly protectedDomains?: readonly string[];
  /** Classification levels immune to auto-eviction (See SHARED_TYPES.md SS3) */
  readonly protectedClassifications?: readonly ClassificationLevel[];
  /** Maximum claims evicted in a single pass */
  readonly maxEvictionBatch: number;
}
```

### 6.5 EvictionStrategy

```typescript
type EvictionStrategy =
  | 'importance_score'
  | 'lru'
  | 'freshness_first'
  | 'composite';
```

Strategy semantics:
- `importance_score`: lowest importance evicted first
- `lru`: least recently accessed evicted first
- `freshness_first`: stale claims evicted before aging, aging before fresh
- `composite`: weighted combination --- `0.5 * importance + 0.3 * recency + 0.2 * freshness`

### 6.6 EvictionThresholds

```typescript
interface EvictionThresholds {
  /** Auto-evict claims with importance below this score (default: 0.1) */
  readonly autoEvictBelowImportance: number;
  /** Auto-evict stale claims older than this many days (default: 30) */
  readonly autoEvictStaleAfterDays: number;
  /** Trigger auto-eviction at this pressure level (default: 'high') */
  readonly pressureTrigger: ContextPressure;
}
```

## 7. Working Memory Data Models

### 7.1 WorkingMemoryEntry

```typescript
interface WorkingMemoryEntry {
  readonly key: string;
  readonly value: string;
  readonly namespace: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly accessCount: number;
  readonly lastAccessedAt: string;
  /** Monotonic counter for ordering mutations within a namespace */
  readonly mutationPosition: number;
}
```

### 7.2 WorkingMemoryOptions

```typescript
interface WorkingMemoryOptions {
  /** Namespace for this entry (default: session namespace derived from SessionId) */
  readonly namespace?: string;
  /** Seconds until auto-discard (null = no expiry) */
  readonly ttl?: number;
  /** Priority 0-100, affects eviction ordering within working memory (higher = retained longer) */
  readonly priority?: number;
  /** Maximum allowed size in bytes --- reject if value exceeds */
  readonly maxSize?: number;
}
```

### 7.3 WorkingMemoryListOptions

```typescript
interface WorkingMemoryListOptions {
  /** Filter by namespace */
  readonly namespace?: string;
  /** Filter by key prefix */
  readonly prefix?: string;
  /** Maximum entries to return (default: 100) */
  readonly limit?: number;
  /** Sort order for results */
  readonly sortBy?: 'key' | 'updated' | 'size' | 'priority';
}
```

### 7.4 WorkingMemoryUsage

```typescript
interface WorkingMemoryUsage {
  readonly namespace: string;
  readonly entryCount: number;
  readonly totalBytes: number;
  /** Configured maximum bytes for this namespace */
  readonly maxBytes: number;
  /** 0-100 */
  readonly utilizationPercent: number;
  readonly oldestEntry: string;
  readonly newestEntry: string;
}
```

## 8. Boundary Trigger Data Models

### 8.1 BoundaryTriggerConfig

```typescript
interface BoundaryTriggerConfig {
  /** Assigned on registration */
  readonly id?: string;
  readonly type: BoundaryTriggerType;
  readonly action: BoundaryAction;
  readonly condition?: BoundaryCondition;
}
```

### 8.2 BoundaryTriggerType

```typescript
type BoundaryTriggerType =
  | 'checkpoint'
  | 'task_terminal'
  | 'mission_transition'
  | 'pre_irreversible_emission'
  | 'suspension'
  | 'context_pressure'
  | 'budget_exhausted'
  | 'custom';
```

### 8.3 BoundaryAction

```typescript
type BoundaryAction =
  | 'snapshot_working_memory'
  | 'flush_working_memory'
  | 'promote_to_claims'
  | 'evict_stale'
  | 'compress_context'
  | 'custom';
```

Action semantics:
- `snapshot_working_memory`: serialize current working memory state to a durable claim for later restoration
- `flush_working_memory`: discard all entries in the scoped namespace
- `promote_to_claims`: convert working memory entries to persistent Limen claims (via CCP)
- `evict_stale`: run eviction pass targeting only stale claims
- `compress_context`: re-rank and evict lowest-importance entries until pressure drops below threshold
- `custom`: delegate to registered handler function

### 8.4 BoundaryCondition

```typescript
interface BoundaryCondition {
  /** Trigger only at this pressure level or above */
  readonly pressure?: ContextPressure;
  /** Trigger only for entries in this namespace */
  readonly namespace?: string;
  /** Trigger only for entries older than N seconds */
  readonly minAge?: number;
}
```

## 9. Context Assembly Data Models

### 9.1 ContextAssemblyOptions

```typescript
interface ContextAssemblyOptions {
  /** Maximum tokens for assembled context */
  readonly budget: number;
  readonly includeMissionContext: boolean;
  readonly includeWorkingMemory: boolean;
  readonly includeBeliefs: boolean;
  /** Filter which beliefs to consider for inclusion */
  readonly beliefQuery?: ContextBeliefQuery;
  /** Bias ranking toward more recently accessed claims */
  readonly prioritizeRecent?: boolean;
  /** Include only pinned claims (skip importance ranking) */
  readonly includePinnedOnly?: boolean;
}
```

### 9.2 ContextBeliefQuery

```typescript
interface ContextBeliefQuery {
  readonly subject?: string;
  readonly predicate?: string;
  readonly minConfidence?: number;
  readonly limit?: number;
}
```

This is structurally equivalent to the Memory Bridge recall query parameters but is a contract-local type because it is used exclusively within the assembly pipeline and never crosses contract boundaries.

### 9.3 AssembledContext

```typescript
interface AssembledContext {
  readonly sections: readonly ContextSection[];
  readonly totalTokens: number;
  readonly budgetUsed: number;
  readonly budgetRemaining: number;
  /** Number of claims that scored high enough but did not fit */
  readonly evictedForAssembly: number;
  readonly assemblyStrategy: string;
}
```

### 9.4 ContextSection

```typescript
interface ContextSection {
  /** Position: 1=mission, 2=working_memory, 3+=beliefs */
  readonly position: number;
  readonly type: 'mission' | 'working_memory' | 'belief';
  readonly content: string;
  readonly tokens: number;
  readonly source: ContextSectionSource;
  /** Importance score that determined inclusion (1.0 for mission/working_memory) */
  readonly importance: number;
}
```

### 9.5 ContextSectionSource

```typescript
interface ContextSectionSource {
  readonly claimId?: ClaimId;
  readonly key?: string;
  readonly missionId?: MissionId;
}
```

## 10. Event Payloads (Contract-Local)

This contract uses the unified event system defined in `SHARED_TYPES.md` SS16. The `AgentEvent` type, `AgentEventPayload` structure, `AgentEventHandler` callback signature, and `AgentEventBus` interface are all shared types.

Context-specific event payloads carried in `AgentEventPayload.data`:

```typescript
interface PressureChangedData {
  readonly previous: ContextPressure;
  readonly current: ContextPressure;
  readonly utilization: number;
}

interface EvictionTriggeredData {
  readonly reason: EvictionReason;
  readonly pressure: ContextPressure;
  readonly candidateCount: number;
}

interface EvictionCompleteData {
  readonly result: EvictionResult;
}

interface BudgetUpdatedData {
  readonly previous: ContextBudgetConfig;
  readonly current: ContextBudgetConfig;
}

interface PinChangedData {
  readonly claimId: ClaimId;
  readonly priority: PinPriority | null;
  readonly action: 'added' | 'removed';
}

interface WorkingMemoryWrittenData {
  readonly key: string;
  readonly namespace: string;
  readonly sizeBytes: number;
  readonly isUpdate: boolean;
}

interface WorkingMemoryDiscardedData {
  readonly key: string;
  readonly namespace: string;
}

interface WorkingMemoryFlushedData {
  readonly namespace: string;
  readonly entriesFlushed: number;
}

interface BoundaryTriggeredData {
  readonly triggerId: string;
  readonly type: BoundaryTriggerType;
  readonly action: BoundaryAction;
}

interface AssemblyCompleteData {
  readonly totalTokens: number;
  readonly sectionCount: number;
  readonly evictedForAssembly: number;
}
```

## 11. Error Types

```typescript
type AgentContextError =
  | { code: 'BUDGET_EXCEEDED'; requested: number; available: number; dimension: 'tokens' }
  | { code: 'WORKING_MEMORY_FULL'; namespace: string; currentBytes: number; maxBytes: number }
  | { code: 'ENTRY_TOO_LARGE'; key: string; size: number; maxSize: number }
  | { code: 'PIN_LIMIT_EXCEEDED'; currentPins: number; maxPins: number }
  | { code: 'EVICTION_BLOCKED'; claimId: ClaimId; reason: string }
  | { code: 'NAMESPACE_NOT_FOUND'; namespace: string }
  | { code: 'KEY_NOT_FOUND'; key: string; namespace: string }
  | { code: 'TRIGGER_NOT_FOUND'; triggerId: string }
  | { code: 'ASSEMBLY_FAILED'; reason: string }
  | { code: 'GOVERNANCE_REFUSAL'; reason: string; action: string }
  | { code: 'ALLOCATION_OVERFLOW'; totalPercent: number; maxPercent: 100 }
  | { code: 'INVALID_WEIGHT_SUM'; actualSum: number; expectedSum: 1.0 };
```

## 12. Rust Trait (v5 Alignment)

```rust
use std::future::Future;
use crate::types::{ClaimId, MissionId, SessionId}; // From SHARED_TYPES SS1.1
use crate::types::{FreshnessLabel, ClassificationLevel}; // From SHARED_TYPES SS2, SS3

/// Context pressure levels derived from utilization percentage
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ContextPressure {
    Low,       // < 50%
    Moderate,  // 50-75%
    High,      // 75-90%
    Critical,  // >= 90%
}

/// Pin priority determines eviction immunity
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PinPriority {
    Critical, // never auto-evicted
    High,     // evicted only under critical pressure
    Normal,   // evicted under high or critical pressure
}

/// Strategy for selecting eviction candidates
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvictionStrategy {
    ImportanceScore,
    Lru,
    FreshnessFirst,
    Composite,
}

/// Reason a claim was evicted
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvictionReason {
    LowestImportance,
    Stale,
    LowConfidence,
    BudgetPressure,
    Manual,
}

/// Boundary trigger types from WMP specification
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BoundaryTriggerType {
    Checkpoint,
    TaskTerminal,
    MissionTransition,
    PreIrreversibleEmission,
    Suspension,
    ContextPressure,
    BudgetExhausted,
    Custom,
}

/// Actions taken when boundary triggers fire
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BoundaryAction {
    SnapshotWorkingMemory,
    FlushWorkingMemory,
    PromoteToClaims,
    EvictStale,
    CompressContext,
    Custom,
}

/// Context section types matching position ordering
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextSectionType {
    Mission,       // Position 1
    WorkingMemory, // Position 2
    Belief,        // Position 3+
}

/// Error type for context governance operations
#[derive(Debug, thiserror::Error)]
pub enum ContextError {
    #[error("budget exceeded: requested {requested} tokens, {available} available")]
    BudgetExceeded { requested: u64, available: u64 },

    #[error("working memory full: namespace={namespace}, current={current_bytes}, max={max_bytes}")]
    WorkingMemoryFull { namespace: String, current_bytes: u64, max_bytes: u64 },

    #[error("entry too large: key={key}, size={size}, max={max_size}")]
    EntryTooLarge { key: String, size: u64, max_size: u64 },

    #[error("pin limit exceeded: current={current_pins}, max={max_pins}")]
    PinLimitExceeded { current_pins: u32, max_pins: u32 },

    #[error("eviction blocked: claim_id={claim_id}, reason={reason}")]
    EvictionBlocked { claim_id: String, reason: String },

    #[error("namespace not found: {namespace}")]
    NamespaceNotFound { namespace: String },

    #[error("key not found: key={key}, namespace={namespace}")]
    KeyNotFound { key: String, namespace: String },

    #[error("trigger not found: {trigger_id}")]
    TriggerNotFound { trigger_id: String },

    #[error("assembly failed: {reason}")]
    AssemblyFailed { reason: String },

    #[error("governance refusal: action={action}, reason={reason}")]
    GovernanceRefusal { action: String, reason: String },

    #[error("allocation overflow: {total_percent}% exceeds 100%")]
    AllocationOverflow { total_percent: f64 },

    #[error("invalid weight sum: {actual_sum} (expected 1.0)")]
    InvalidWeightSum { actual_sum: f64 },
}

/// Core data structures
pub struct ImportanceScore {
    pub score: f64,
    pub factors: ImportanceFactors,
    pub weights: ImportanceWeights,
}

pub struct ImportanceFactors {
    pub access_frequency: f64,
    pub recency: f64,
    pub connection_density: f64,
    pub confidence: f64,
    pub governance_weight: f64,
}

pub struct ImportanceWeights {
    pub access_frequency: f64,
    pub recency: f64,
    pub connection_density: f64,
    pub confidence: f64,
    pub governance_weight: f64,
}

pub struct ContextBudgetConfig {
    pub max_tokens: u64,
    pub reserved_for_system: u64,
    pub reserved_for_output: u64,
    pub mission_context_allocation: f64,
    pub working_memory_allocation: f64,
    pub belief_allocation: f64,
}

pub struct ContextBudget {
    pub config: ContextBudgetConfig,
    pub total_available: u64,
    pub allocated_mission_context: u64,
    pub allocated_working_memory: u64,
    pub allocated_beliefs: u64,
}

pub struct ContextUtilization {
    pub budget: ContextBudget,
    pub used_mission_context: u64,
    pub used_working_memory: u64,
    pub used_beliefs: u64,
    pub used_total: u64,
    pub available_mission_context: u64,
    pub available_working_memory: u64,
    pub available_beliefs: u64,
    pub available_total: u64,
    pub utilization_percent: f64,
    pub pressure: ContextPressure,
}

pub struct EvictionResult {
    pub evicted: u32,
    pub freed_tokens: u64,
    pub new_utilization: ContextUtilization,
    pub evicted_entries: Vec<(String, EvictionReason)>,
}

pub struct EvictionPolicy {
    pub strategy: EvictionStrategy,
    pub thresholds: EvictionThresholds,
    pub protected_domains: Option<Vec<String>>,
    pub protected_classifications: Option<Vec<ClassificationLevel>>,
    pub max_eviction_batch: u32,
}

pub struct EvictionThresholds {
    pub auto_evict_below_importance: f64,
    pub auto_evict_stale_after_days: u32,
    pub pressure_trigger: ContextPressure,
}

pub struct WorkingMemoryEntry {
    pub key: String,
    pub value: String,
    pub namespace: String,
    pub size_bytes: u64,
    pub created_at: String,
    pub updated_at: String,
    pub access_count: u64,
    pub last_accessed_at: String,
    pub mutation_position: u64,
}

pub struct BoundaryTriggerConfig {
    pub id: Option<String>,
    pub trigger_type: BoundaryTriggerType,
    pub action: BoundaryAction,
    pub condition: Option<BoundaryCondition>,
}

pub struct BoundaryCondition {
    pub pressure: Option<ContextPressure>,
    pub namespace: Option<String>,
    pub min_age: Option<u64>,
}

pub struct ContextRanking {
    pub entries: Vec<RankedEntry>,
    pub total_scored: u32,
    pub cutoff_score: f64,
}

pub struct RankedEntry {
    pub claim_id: String,
    pub subject: String,
    pub predicate: String,
    pub importance: ImportanceScore,
    pub effective_confidence: f64,
    pub freshness: FreshnessLabel,
    pub pinned: bool,
    pub pin_priority: Option<PinPriority>,
    pub estimated_tokens: u64,
}

pub struct AssembledContext {
    pub sections: Vec<ContextSection>,
    pub total_tokens: u64,
    pub budget_used: u64,
    pub budget_remaining: u64,
    pub evicted_for_assembly: u32,
    pub assembly_strategy: String,
}

pub struct ContextSection {
    pub position: u32,
    pub section_type: ContextSectionType,
    pub content: String,
    pub tokens: u64,
    pub claim_id: Option<String>,
    pub key: Option<String>,
    pub mission_id: Option<String>,
    pub importance: f64,
}

/// The core trait for agent context governance
pub trait AgentContextGovernor: Send + Sync {
    fn get_context_budget(&self) -> impl Future<Output = Result<ContextBudget, ContextError>> + Send;
    fn set_context_budget(&self, ctx: &OperationContext, config: &ContextBudgetConfig) -> impl Future<Output = Result<ContextBudget, ContextError>> + Send;
    fn get_utilization(&self) -> impl Future<Output = Result<ContextUtilization, ContextError>> + Send;
    fn score_importance(&self, claim_id: &str) -> impl Future<Output = Result<ImportanceScore, ContextError>> + Send;
    fn batch_score_importance(&self, claim_ids: &[&str]) -> impl Future<Output = Result<Vec<(String, ImportanceScore)>, ContextError>> + Send;
    fn get_context_ranking(&self, options: Option<&RankingOptions>) -> impl Future<Output = Result<ContextRanking, ContextError>> + Send;
    fn pin_to_context(&self, ctx: &OperationContext, claim_id: &str, priority: PinPriority) -> impl Future<Output = Result<(), ContextError>> + Send;
    fn unpin_from_context(&self, ctx: &OperationContext, claim_id: &str) -> impl Future<Output = Result<(), ContextError>> + Send;
    fn get_eviction_candidates(&self, count: u32) -> impl Future<Output = Result<Vec<EvictionCandidate>, ContextError>> + Send;
    fn evict(&self, ctx: &OperationContext, claim_ids: &[&str], reason: &str) -> impl Future<Output = Result<EvictionResult, ContextError>> + Send;
    fn set_eviction_policy(&self, ctx: &OperationContext, policy: &EvictionPolicy) -> impl Future<Output = Result<(), ContextError>> + Send;
    fn get_eviction_policy(&self) -> impl Future<Output = Result<EvictionPolicy, ContextError>> + Send;
    fn write_working_memory(&self, ctx: &OperationContext, key: &str, value: &str, options: Option<&WorkingMemoryOptions>) -> impl Future<Output = Result<WorkingMemoryEntry, ContextError>> + Send;
    fn read_working_memory(&self, key: &str) -> impl Future<Output = Result<Option<WorkingMemoryEntry>, ContextError>> + Send;
    fn discard_working_memory(&self, ctx: &OperationContext, key: &str) -> impl Future<Output = Result<(), ContextError>> + Send;
    fn flush_working_memory(&self, ctx: &OperationContext, namespace: Option<&str>) -> impl Future<Output = Result<u32, ContextError>> + Send;
    fn register_boundary_trigger(&self, ctx: &OperationContext, trigger: &BoundaryTriggerConfig) -> impl Future<Output = Result<String, ContextError>> + Send;
    fn unregister_boundary_trigger(&self, ctx: &OperationContext, trigger_id: &str) -> impl Future<Output = Result<(), ContextError>> + Send;
    fn list_boundary_triggers(&self) -> impl Future<Output = Result<Vec<BoundaryTriggerConfig>, ContextError>> + Send;
    fn assemble_context(&self, options: &ContextAssemblyOptions) -> impl Future<Output = Result<AssembledContext, ContextError>> + Send;
}

pub struct RankingOptions {
    pub limit: Option<u32>,
    pub include_pinned: Option<bool>,
    pub domain: Option<String>,
    pub freshness_filter: Option<Vec<FreshnessLabel>>,
    pub min_importance: Option<f64>,
}

pub struct EvictionCandidate {
    pub claim_id: String,
    pub subject: String,
    pub predicate: String,
    pub importance: ImportanceScore,
    pub freshness: FreshnessLabel,
    pub last_accessed_at: Option<String>,
    pub estimated_tokens: u64,
    pub eviction_reason: EvictionReason,
}

pub struct WorkingMemoryOptions {
    pub namespace: Option<String>,
    pub ttl: Option<u64>,
    pub priority: Option<u8>,
    pub max_size: Option<u64>,
}

pub struct ContextAssemblyOptions {
    pub budget: u64,
    pub include_mission_context: bool,
    pub include_working_memory: bool,
    pub include_beliefs: bool,
    pub belief_query: Option<ContextBeliefQuery>,
    pub prioritize_recent: Option<bool>,
    pub include_pinned_only: Option<bool>,
}

pub struct ContextBeliefQuery {
    pub subject: Option<String>,
    pub predicate: Option<String>,
    pub min_confidence: Option<f64>,
    pub limit: Option<u32>,
}
```

## 13. Integration Map

| Client Method | Limen Internal | Protocol | Notes |
|---|---|---|---|
| `writeWorkingMemory` | SC-14 (write_working_memory) | WMP SS5.2 | Namespace isolation enforced |
| `readWorkingMemory` | SC-15 (read_working_memory) | WMP SS5.3 | Updates accessCount + lastAccessedAt |
| `discardWorkingMemory` | SC-16 (discard_working_memory) | WMP SS5.4 | Audit trail preserved |
| `flushWorkingMemory` | Batch SC-16 | WMP SS5.4 | Returns count of entries flushed |
| `scoreImportance` | Cognitive Engine importance scoring | CGP SS9 | FSRS decay applied to recency factor |
| `assembleContext` | CGP position-based assembly | CGP SS9 | Positions 1-2-3+ strictly ordered |
| `evict` | Archive claims (CCP) + audit entry | CGP + CCP | Never deletes --- moves to archive |
| `registerBoundaryTrigger` | WMP boundary events | WMP SS6.4 | Fires exactly once per event |
| `getContextRanking` | Cognitive Engine + relationship graph | CGP SS9 | connectionDensity from graph edges |
| `pinToContext` | Pin registry (context governor state) | CGP SS9 | Subject to PIN_LIMIT_EXCEEDED |

## 14. Invariants

1. **Budget Conservation:** `missionContextAllocation + workingMemoryAllocation + beliefAllocation <= 100`. Violation produces `ALLOCATION_OVERFLOW` error.
2. **Pin Immunity:** Pinned claims with `critical` priority are never auto-evicted regardless of pressure level. Only explicit `evict()` with manual reason can remove them.
3. **Classification Protection:** Claims with classifications listed in `protectedClassifications` (See `SHARED_TYPES.md` SS3) are immune to all auto-eviction strategies.
4. **Namespace Isolation:** Working memory reads and writes are scoped to a single namespace. Cross-namespace access requires explicit namespace parameter --- no implicit fallthrough.
5. **Eviction Audit:** Every eviction operation (auto or manual) produces an audit entry recording: claim IDs, freed tokens, reason, timestamp, and resulting utilization.
6. **Assembly Determinism:** Given identical inputs (same claims, same scores, same budget), `assembleContext` produces identical section ordering. Tie-breaking is by claim creation timestamp (older first), then by claim ID lexicographic order.
7. **Trigger Idempotency:** Boundary triggers fire exactly once per qualifying event. Re-entrant trigger chains are detected and blocked.
8. **TTL Enforcement:** Working memory entries with expired TTL are cleaned up on next access to that namespace. Expired entries are invisible to reads and listings.
9. **Factor Normalization:** All importance scoring factors are individually normalized to [0,1]. The composite score is the weighted sum with weights summing to exactly 1.0.
10. **Pressure Derivation:** Context pressure is derived purely from `used.total / budget.totalAvailable`. No manual override exists. Pressure transitions emit `context:pressure_changed` events via the unified event bus (See `SHARED_TYPES.md` SS16.2).
11. **Position Invariance:** Assembly always produces sections in position order: mission context (1), working memory (2), beliefs (3+). This ordering is structurally enforced --- no configuration can reorder positions.
12. **Budget Hard Cap:** `assembleContext` never returns an `AssembledContext` where `totalTokens > options.budget`. Excess claims are excluded and counted in `evictedForAssembly`.

## 15. Assembly Algorithm

Token counting uses the canonical `TokenEstimator` contract in `SHARED_TYPES.md` §20.1. The estimator uses `provider_native` when the active model exposes a tokenizer, otherwise `o200k_base` for modern OpenAI-compatible models, otherwise `cl100k_base`. Approximate estimates MUST carry `varianceUpperBoundPct <= 10`; items whose upper-bound estimate exceeds remaining budget are excluded and counted in `evictedForAssembly`. Tokenization failure is treated as estimator overflow, never as zero tokens. Caller-supplied `options.budget` overflow remains the caller's responsibility and is rejected before assembly; estimator overflow only describes inability to produce a safe per-item token estimate.

```
FUNCTION assembleContext(options):
  sections = []
  remainingBudget = options.budget

  IF options.includeMissionContext:
    missionSections = loadMissionContext(currentMission)
    FOR section IN missionSections SORTED BY position ASC:
      tokenEstimate = TokenEstimator.estimate(section, activeEncoding)
      tokens = tokenEstimate.tokens
      IF tokenEstimate.overflow:
        evictedForAssembly++
        CONTINUE
      upperBoundTokens = ceil(tokens * (1 + tokenEstimate.varianceUpperBoundPct / 100))
      IF upperBoundTokens <= remainingBudget:
        sections.push(section at position=1)
        remainingBudget -= upperBoundTokens
      ELSE:
        evictedForAssembly++
        break  // hard cap --- no partial sections

  IF options.includeWorkingMemory:
    wmEntries = loadWorkingMemory(currentNamespace) SORTED BY priority DESC, updatedAt DESC
    FOR entry IN wmEntries:
      tokenEstimate = TokenEstimator.estimate(entry, activeEncoding)
      tokens = tokenEstimate.tokens
      IF tokenEstimate.overflow:
        evictedForAssembly++
        CONTINUE
      upperBoundTokens = ceil(tokens * (1 + tokenEstimate.varianceUpperBoundPct / 100))
      IF upperBoundTokens <= remainingBudget:
        sections.push(entry as section at position=2)
        remainingBudget -= upperBoundTokens
      ELSE:
        evictedForAssembly++

  IF options.includeBeliefs:
    candidates = rankBeliefs(options.beliefQuery, options.prioritizeRecent, options.includePinnedOnly)
    FOR claim IN candidates SORTED BY importance DESC:
      tokenEstimate = TokenEstimator.estimate(claim, activeEncoding)
      tokens = tokenEstimate.tokens
      IF tokenEstimate.overflow:
        evictedForAssembly++
        CONTINUE
      upperBoundTokens = ceil(tokens * (1 + tokenEstimate.varianceUpperBoundPct / 100))
      IF upperBoundTokens <= remainingBudget:
        sections.push(claim as section at position=3+)
        remainingBudget -= upperBoundTokens
      ELSE:
        evictedForAssembly++

  RETURN AssembledContext { sections, totalTokens, budgetUsed, budgetRemaining, evictedForAssembly }
```

## 16. Auto-Eviction Algorithm

```
FUNCTION autoEvict(ctx, policy, utilization):
  IF utilization.pressure < policy.thresholds.pressureTrigger:
    RETURN  // no action needed

  candidates = []
  allClaims = getActiveClaimsInContext()

  FOR claim IN allClaims:
    IF claim.pinned AND claim.pinPriority == 'critical':
      CONTINUE  // never evict
    IF claim.pinned AND claim.pinPriority == 'high' AND utilization.pressure != 'critical':
      CONTINUE  // only evict under critical pressure
    IF claim.predicate.startsWith(ANY OF policy.protectedDomains):
      CONTINUE  // domain protected
    IF claim.classification IN policy.protectedClassifications:
      CONTINUE  // classification protected

    score = scoreImportance(claim)
    IF score.score < policy.thresholds.autoEvictBelowImportance:
      candidates.push({ claim, reason: 'lowest_importance' })
    ELSE IF claim.freshness == 'stale' AND daysSinceAccess(claim) > policy.thresholds.autoEvictStaleAfterDays:
      candidates.push({ claim, reason: 'stale' })

  SORT candidates BY strategy:
    importance_score: ASC by score
    lru: ASC by lastAccessedAt
    freshness_first: stale first, then aging, then fresh; within group by score ASC
    composite: ASC by (0.5*score + 0.3*recency + 0.2*freshness_numeric)

  evictionBatch = candidates[0..min(candidates.length, policy.maxEvictionBatch)]
  EXECUTE evict(ctx, evictionBatch, 'auto_eviction')
  EMIT 'context:eviction_complete'  // via unified AgentEventBus
```

## 17. Governance Boundaries

| Operation | Required Permission | Clearance Level | Governance Gate |
|---|---|---|---|
| `getContextBudget` | `read_wm` | unrestricted | --- |
| `setContextBudget` | `manage_cognitive` | internal | GovernanceAction `{ domain: 'context', operation: 'write_wm' }` |
| `scoreImportance` | `query_claims` | unrestricted | --- |
| `pinToContext` | `write_wm` | internal | GovernanceAction `{ domain: 'context', operation: 'pin' }` |
| `evict` (manual) | `write_wm` | internal | GovernanceAction `{ domain: 'context', operation: 'evict' }` |
| `setEvictionPolicy` | `manage_cognitive` | confidential | GovernanceAction `{ domain: 'context', operation: 'evict' }` |
| `writeWorkingMemory` | `write_wm` | unrestricted | GovernanceAction `{ domain: 'context', operation: 'write_wm' }` |
| `readWorkingMemory` | `read_wm` | unrestricted | --- |
| `flushWorkingMemory` | `manage_cognitive` | internal | GovernanceAction `{ domain: 'context', operation: 'discard_wm' }` |
| `registerBoundaryTrigger` | `manage_cognitive` | confidential | GovernanceAction `{ domain: 'context', operation: 'boundary_trigger' }` |
| `unregisterBoundaryTrigger` | `manage_cognitive` | confidential | GovernanceAction `{ domain: 'context', operation: 'boundary_trigger' }` |
| `assembleContext` | `read_wm` + `query_claims` | unrestricted | --- |

All mutating operations in this table take explicit `OperationContext` at the public interface and derive their `GovernanceAction` from the method row before mutation. Operations on claims with classification higher than the agent's clearance level produce `GOVERNANCE_REFUSAL` errors. Eviction of `restricted` or `critical` claims requires `manage_cognitive` regardless of eviction strategy. GovernanceAction types reference the unified `GovernanceAction` discriminated union (See `SHARED_TYPES.md` SS9).

---

**Contract Hash:** Tracked in `contracts/phase-x.contracts.json`
**Authored:** 2026-05-05
**Revised:** 2026-05-05 (v1.2.2 --- Rust enum projection parity for eviction and boundary trigger structs)
**Supersedes:** v1.2.1
