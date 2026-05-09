<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# Agent Search Governance Contract v1.0.0

**Status:** RATIFIED DESIGN --- Pending Implementation
**Governing:** SolisForge Protocol v1.4 [HISTORICAL: CDM v2.1 + Contract Compliance v2.1 — superseded]
**Scope:** Vector search, semantic recall, duplicate detection, embedding lifecycle, and hybrid ranking governance
**Classification:** QAL-3

> **Shared Types:** All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`. This contract does NOT redefine any shared type. Local types are contract-specific and not used by other contracts.

---

## 1. Purpose

Governs how agents perform semantic search, full-text search, and hybrid-ranked queries against the Limen knowledge store. Defines the embedding lifecycle (provisioning, staleness detection, re-embedding), duplicate detection with configurable policy enforcement, and hybrid ranking weight configuration --- all within the classification, consent, rate-limit, and audit boundaries established by the Phase X governance model. Every search operation respects agent clearance level, produces an audit entry, and operates within tenant isolation boundaries.

**Five Questions:** Spec requires governed text/semantic/hybrid search plus embedding and duplicate policy. Failures: classification leakage, stale embeddings, ranking manipulation, duplicate poisoning, tenant bleed. Consequence: unauthorized or low-quality knowledge enters agent context. Assumption: named vector, FTS5, embedding, and duplicate internals exist behind Limen services. Hostile review target: prove clearance filtering occurs before observable result count, timing, or serialization.

---

## 2. Shared Type References

| Shared Type | SHARED_TYPES Section | Usage in This Contract |
|---|---|---|
| `Result<T>` | 1.5 | All method return types |
| `ClaimId` | 1.1b | Search result identity |
| `AgentId` | 1.1a | Embedding provenance, audit attribution |
| `SessionId` | 1.1a | Audit correlation |
| `TenantId` | 1.1a | Tenant isolation scope |
| `EventId` | 1.1a | Audit entry references |
| `MissionId`, `TaskId` | 1.1a | Search scope filtering |
| `AgentSession` | 7 | Session context for all operations |
| `OperationContext` | 1.3 | Clearance-level enforcement |
| `GovernanceDecision` | 10.1 | Governance gate outcomes |
| `GovernanceAction` | 9 | `domain: 'search'` actions |
| `GovernanceVerdict` | 10 | Verdict production |
| `ClassificationLevel` | 3 | Result filtering by clearance |
| `CLASSIFICATION_NUMERIC` | 3 | Numeric comparison for filtering |
| `AgentMemoryEntry` | 10.2 | Base record for search results |
| `FreshnessLabel` | 2 | Temporal quality of results |
| `AgentEvent` | 16.1 | Search-domain events |
| `AgentEventPayload` | 16.2 | Event emission |
| `AgentEventHandler` | 16.2 | Subscription callbacks |
| `RateLimitPolicy` | 18 | Search rate limiting |
| `RetentionPolicy` | 17 | Archived claim accessibility |
| `ArchiveMode` | 2 | Include/exclude archived claims |
| `AuditLogEntry` | 10.3 | Audit trail entries |
| `PerformanceBudget` | 20 | Latency targets |
| `AgentBranchId` | 4 | Branch-scoped search |

---

## 3. AgentSearchClient Interface

```typescript
interface AgentSearchClient {
  // --- Search Operations ---
  semanticSearch(ctx: OperationContext, query: string, options?: SemanticSearchOptions): Promise<Result<SemanticSearchResult[]>>;
  hybridSearch(ctx: OperationContext, query: string, options?: HybridSearchOptions): Promise<Result<HybridSearchResult[]>>;
  textSearch(ctx: OperationContext, query: string, options?: TextSearchOptions): Promise<Result<TextSearchResult[]>>;

  // --- Duplicate Detection ---
  checkDuplicate(ctx: OperationContext, content: string, options?: DuplicateCheckOptions): Promise<Result<DuplicateCheckResult>>;
  setDuplicatePolicy(ctx: OperationContext, policy: DuplicatePolicy): Promise<Result<void>>;
  getDuplicatePolicy(ctx: OperationContext): Promise<Result<DuplicatePolicy>>;

  // --- Embedding Lifecycle ---
  getEmbeddingStats(ctx: OperationContext): Promise<Result<EmbeddingStats>>;
  triggerReembedding(ctx: OperationContext, options?: ReembeddingOptions): Promise<Result<ReembeddingResult>>;
  setEmbeddingProvider(ctx: OperationContext, provider: EmbeddingProviderConfig): Promise<Result<void>>;
  getStaleEmbeddings(ctx: OperationContext, options?: StalenessOptions): Promise<Result<StaleEmbedding[]>>;

  // --- Ranking Configuration ---
  setHybridWeights(ctx: OperationContext, weights: HybridWeights): Promise<Result<void>>;
  getHybridWeights(ctx: OperationContext): Promise<Result<HybridWeights>>;

  // --- Events (subset of unified AgentEvent bus) ---
  on(ctx: OperationContext, event: SearchEvent, handler: AgentEventHandler): string;
  off(ctx: OperationContext, subscriptionId: string): void;
}
```

---

## 4. Search Data Models

```typescript
// --- Options ---

interface SemanticSearchOptions {
  readonly limit?: number;                       // max results, default 20, max 200
  readonly minSimilarity?: number;               // cosine threshold [0.0, 1.0], default 0.5
  readonly minConfidence?: number;               // effective confidence floor, default 0.0
  readonly freshnessFilter?: FreshnessLabel | readonly FreshnessLabel[];
  readonly classification?: ClassificationLevel; // max classification to include (capped by session clearance)
  readonly tags?: readonly string[];             // filter by tag intersection
  readonly category?: string;                    // filter by category
  readonly subject?: string;                     // subject pattern (trailing wildcard)
  readonly predicate?: string;                   // predicate pattern (trailing wildcard)
  readonly missionId?: MissionId;                // scope to mission
  readonly taskId?: TaskId;                      // scope to task
  readonly branchId?: AgentBranchId;             // scope to branch
  readonly archiveMode?: ArchiveMode;            // default 'exclude'
  readonly timeRange?: { readonly from: string; readonly to: string };
}

interface HybridSearchOptions extends SemanticSearchOptions {
  readonly weights?: HybridWeights;              // per-query override (does not persist)
  readonly textBoost?: number;                   // BM25 boost factor, default 1.0
}

interface TextSearchOptions {
  readonly limit?: number;                       // max results, default 20, max 200
  readonly minConfidence?: number;               // effective confidence floor
  readonly freshnessFilter?: FreshnessLabel | readonly FreshnessLabel[];
  readonly classification?: ClassificationLevel;
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly subject?: string;
  readonly predicate?: string;
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly branchId?: AgentBranchId;
  readonly archiveMode?: ArchiveMode;
  readonly timeRange?: { readonly from: string; readonly to: string };
  readonly matchMode?: 'prefix' | 'exact' | 'fts5';  // default 'fts5'
}

// --- Results ---

interface SearchRelevance {
  readonly score: number;                        // normalized [0.0, 1.0]
  readonly vectorSimilarity: number | null;      // null for text-only
  readonly textRank: number | null;              // null for semantic-only
  readonly decayFactor: number;                  // FSRS time-decay multiplier applied
}

interface SemanticSearchResult {
  readonly claimId: ClaimId;
  readonly content: string;                      // claim value (not full structured content)
  readonly subject: string;
  readonly predicate: string;
  readonly confidence: number;                   // original confidence
  readonly effectiveConfidence: number;          // after FSRS decay
  readonly freshness: FreshnessLabel;
  readonly classification: ClassificationLevel;
  readonly relevance: SearchRelevance;
  readonly createdAt: string;                    // ISO-8601
  readonly sourceAgentId: AgentId;
}

interface HybridSearchResult extends SemanticSearchResult {
  readonly hybridScore: HybridScore;
}

interface HybridScore {
  readonly combined: number;                     // weighted blend, normalized [0.0, 1.0]
  readonly textComponent: number;                // textWeight * textRank
  readonly vectorComponent: number;              // vectorWeight * vectorSimilarity
  readonly weightsUsed: HybridWeights;           // actual weights applied
}

interface TextSearchResult {
  readonly claimId: ClaimId;
  readonly content: string;
  readonly subject: string;
  readonly predicate: string;
  readonly confidence: number;
  readonly effectiveConfidence: number;
  readonly freshness: FreshnessLabel;
  readonly classification: ClassificationLevel;
  readonly relevance: SearchRelevance;
  readonly createdAt: string;
  readonly sourceAgentId: AgentId;
  readonly highlights: readonly string[];        // FTS5 snippet highlights
}
```

**Validation rules:**

- `limit` MUST be a positive integer. Values exceeding 200 are clamped to 200.
- `minSimilarity` MUST be in closed interval [0.0, 1.0]. Values below 0.0 are clamped to 0.0; above 1.0 clamped to 1.0.
- `classification` in options is an UPPER BOUND request; actual filtering uses `min(requested, session.clearanceLevel)`. Claims with `CLASSIFICATION_NUMERIC[claim.classification] > session.clearanceLevel` are unconditionally excluded regardless of options.
- `relevance.score` is always normalized to [0.0, 1.0] regardless of underlying engine scores.
- Results are ordered by `relevance.score` descending, then `effectiveConfidence` descending, then `createdAt` descending (deterministic tiebreaker).

---

## 5. Duplicate Detection Data Models

```typescript
interface DuplicateCheckOptions {
  readonly threshold?: number;                   // override policy threshold for this check
  readonly scope?: DuplicateScope;               // override policy scope for this check
  readonly excludeClaimIds?: readonly ClaimId[]; // ignore specific claims (self-reference protection)
  readonly maxCandidates?: number;               // max near-duplicates to compare, default 50
}

type DuplicateScope = 'agent' | 'tenant' | 'global';

interface DuplicateCheckResult {
  readonly isDuplicate: boolean;
  readonly similarity: number;                   // highest cosine similarity found [0.0, 1.0]
  readonly existingClaimId: ClaimId | null;      // most similar existing claim, null if no match
  readonly action: DuplicateAction;              // action taken per policy
  readonly candidatesEvaluated: number;          // how many claims were compared
}

type DuplicateAction = 'refuse' | 'merge' | 'flag' | 'allow';

interface DuplicatePolicy {
  readonly threshold: number;                    // cosine similarity threshold [0.7, 1.0]
  readonly action: DuplicateAction;              // action when duplicate detected
  readonly scope: DuplicateScope;                // isolation boundary for comparison
  readonly mergeStrategy?: 'highest_confidence' | 'temporal_latest';  // when action is 'merge'
  readonly enabled: boolean;                     // master switch
}
```

**Validation rules:**

- `DuplicatePolicy.threshold` MUST be in closed interval [0.7, 1.0]. Values below 0.7 are rejected with `INVALID_THRESHOLD` error. This floor prevents false positives from broad semantic overlap.
- `DuplicateCheckOptions.threshold` inherits the same [0.7, 1.0] constraint.
- When `action` is `'merge'`, `mergeStrategy` MUST be present. Absence with merge action is a validation error.
- `DuplicateScope` interacts with tenant isolation: `'agent'` checks only claims from the current agent; `'tenant'` checks all claims within the tenant; `'global'` is only available to `verified` trust level agents.
- `excludeClaimIds` is capped at 100 entries to prevent query degradation.

---

## 6. Embedding Lifecycle Data Models

```typescript
interface EmbeddingProviderConfig {
  readonly providerId: string;                   // unique identifier for this provider instance
  readonly modelName: string;                    // e.g., "text-embedding-3-small"
  readonly modelVersion: ModelVersion;           // versioned model identifier
  readonly dimensions: number;                   // embedding vector dimensionality
  readonly maxTokens: number;                    // max input tokens per embedding call
  readonly batchSize: number;                    // max items per batch request
  readonly embed: (text: string) => Promise<Float32Array>;  // caller-supplied embedding function
}

type ModelVersion = string & { readonly __brand: 'ModelVersion' };

interface EmbeddingStats {
  readonly totalClaims: number;                  // total claims in system
  readonly embeddedClaims: number;               // claims with valid embeddings
  readonly pendingClaims: number;                // claims awaiting embedding
  readonly staleClaims: number;                  // claims with outdated model version
  readonly failedClaims: number;                 // claims that failed embedding (retriable)
  readonly currentProvider: EmbeddingProviderSummary;
  readonly averageEmbedTimeMs: number;           // rolling average per-claim embed time
  readonly lastEmbedBatchAt: string | null;      // ISO-8601, null if never run
  readonly queueDepth: number;                   // current async queue size
}

interface EmbeddingProviderSummary {
  readonly providerId: string;
  readonly modelName: string;
  readonly modelVersion: ModelVersion;
  readonly dimensions: number;
  readonly registeredAt: string;                 // ISO-8601
}

interface ReembeddingOptions {
  readonly scope?: 'stale_only' | 'failed_only' | 'all';  // default 'stale_only'
  readonly batchSize?: number;                   // override provider batch size
  readonly priority?: 'normal' | 'high';         // high = preempts normal queue
  readonly dryRun?: boolean;                     // report what would be re-embedded without doing it
}

interface ReembeddingResult {
  readonly triggered: number;                    // claims enqueued for re-embedding
  readonly skipped: number;                      // claims already current
  readonly failed: number;                       // claims that could not be enqueued
  readonly estimatedDurationMs: number;          // estimated time to complete
  readonly batchId: string;                      // tracking identifier for this batch
  readonly dryRun: boolean;                      // whether this was a dry run
}

interface StalenessOptions {
  readonly limit?: number;                       // max results, default 100
  readonly offset?: number;                      // pagination
  readonly sortBy?: 'oldest_first' | 'highest_confidence_first';  // default 'oldest_first'
}

interface StaleEmbedding {
  readonly claimId: ClaimId;
  readonly subject: string;
  readonly predicate: string;
  readonly currentModelVersion: ModelVersion;    // version used when embedded
  readonly targetModelVersion: ModelVersion;     // current provider version
  readonly embeddedAt: string;                   // ISO-8601, when last embedded
  readonly confidence: number;                   // claim confidence (for prioritization)
}
```

**Validation rules:**

- `EmbeddingProviderConfig.dimensions` MUST be a positive integer. Changing dimensions requires a full re-embedding; partial dimension mismatch is a fatal error.
- `EmbeddingProviderConfig.batchSize` MUST be in [1, 2048].
- `EmbeddingProviderConfig.maxTokens` MUST be a positive integer.
- A claim is stale when its stored `modelVersion` differs from `currentProvider.modelVersion`.
- `triggerReembedding` is idempotent: calling it while a batch is in progress returns the existing batch status without creating a duplicate.
- Failed claims are retried up to 3 times with exponential backoff (1s, 4s, 16s). After 3 failures, the claim moves to `failed` state and requires manual `triggerReembedding` with `scope: 'failed_only'`.

---

## 7. Hybrid Ranking Data Models

```typescript
interface HybridWeights {
  readonly textWeight: number;                   // [0.0, 1.0]
  readonly vectorWeight: number;                 // [0.0, 1.0]
}

interface RankingProfile {
  readonly name: string;                         // profile identifier
  readonly weights: HybridWeights;
  readonly description: string;
  readonly domainOverrides: readonly DomainWeightOverride[];
}

interface DomainWeightOverride {
  readonly predicatePattern: string;             // predicate glob pattern (e.g., "code.*")
  readonly weights: HybridWeights;              // override weights for matching predicates
}
```

**Validation rules:**

- `textWeight + vectorWeight` MUST equal exactly 1.0. Tolerance: `Math.abs(textWeight + vectorWeight - 1.0) < 1e-10`. Violations produce `INVALID_WEIGHTS` error.
- Both weights MUST be in closed interval [0.0, 1.0]. A weight of 0.0 is valid (disables that component entirely).
- `domainOverrides` are evaluated in array order; first matching pattern wins.
- `setHybridWeights` persists weights per-tenant. Absence of persisted weights uses default.
- Default weights: `{ textWeight: 0.3, vectorWeight: 0.7 }`.

---

## 8. Search Events

```typescript
type SearchEvent =
  | 'search:queried'
  | 'embedding:queued'
  | 'embedding:completed'
  | 'duplicate:detected';
```

These are a subset of the unified `AgentEvent` bus defined in SHARED_TYPES 16.

**Event payloads (via `AgentEventPayload.data`):**

| Event | Payload Fields |
|---|---|
| `search:queried` | `{ searchMode: 'text' \| 'semantic' \| 'hybrid', query: string (truncated to 100 chars), resultCount: number, latencyMs: number }` |
| `embedding:queued` | `{ claimId: ClaimId, reason: 'new_claim' \| 'stale' \| 'failed_retry', batchId: string }` |
| `embedding:completed` | `{ claimId: ClaimId, modelVersion: ModelVersion, dimensions: number, durationMs: number }` |
| `duplicate:detected` | `{ claimId: ClaimId, existingClaimId: ClaimId, similarity: number, action: DuplicateAction }` |

**Emission rules:**

- Every search operation emits exactly one `search:queried` event upon completion (success or error).
- `embedding:queued` emits when a claim enters the embedding queue (not when the queue is drained).
- `embedding:completed` emits per-claim after successful embedding persistence.
- `duplicate:detected` emits only when `isDuplicate === true` and `action !== 'allow'`.

---

## 9. Error Types

```typescript
type AgentSearchError =
  | { readonly code: 'EMBEDDING_PROVIDER_UNAVAILABLE'; readonly message: string; readonly lastAttemptAt: string }
  | { readonly code: 'EMBEDDING_DIMENSION_MISMATCH'; readonly message: string; readonly expected: number; readonly received: number }
  | { readonly code: 'DUPLICATE_REFUSED'; readonly message: string; readonly existingClaimId: ClaimId; readonly similarity: number }
  | { readonly code: 'SEARCH_TIMEOUT'; readonly message: string; readonly timeoutMs: number; readonly searchMode: string }
  | { readonly code: 'INVALID_WEIGHTS'; readonly message: string; readonly textWeight: number; readonly vectorWeight: number; readonly sum: number }
  | { readonly code: 'INVALID_THRESHOLD'; readonly message: string; readonly provided: number; readonly minimum: number; readonly maximum: number }
  | { readonly code: 'GOVERNANCE_REFUSAL'; readonly message: string; readonly verdict: GovernanceVerdict; readonly rule: string }
  | { readonly code: 'BRANCH_NOT_FOUND'; readonly message: string; readonly branchId: AgentBranchId }
  | { readonly code: 'PROVIDER_NOT_CONFIGURED'; readonly message: string }
  | { readonly code: 'BATCH_IN_PROGRESS'; readonly message: string; readonly existingBatchId: string };
```

**Error propagation rules:**

- All errors are returned via `Result<T>` (`ok: false` path) with a `KernelError` wrapping the discriminated `AgentSearchError`.
- `KernelError.code` is the `AgentSearchError.code` string.
- `KernelError.spec` references this contract: `"AGENT_SEARCH_GOVERNANCE v1.0.0"`.
- `GOVERNANCE_REFUSAL` wraps any verdict that blocks the search operation (rate limit, clearance, consent).
- `SEARCH_TIMEOUT` fires when a search exceeds the configured timeout (default: 5000ms for semantic, 2000ms for text, 7000ms for hybrid).

---

## 10. Rust Trait

```rust
use std::future::Future;
use std::pin::Pin;

pub type SearchResult<T> = Result<T, SearchError>;
pub type AsyncSearchResult<'a, T> = Pin<Box<dyn Future<Output = SearchResult<T>> + Send + 'a>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSearchOptions {
    pub limit: Option<u32>,
    pub min_similarity: Option<f64>,
    pub min_confidence: Option<f64>,
    pub freshness_filter: Option<Vec<String>>,
    pub classification: Option<ClassificationLevel>,
    pub tags: Option<Vec<String>>,
    pub category: Option<String>,
    pub subject: Option<String>,
    pub predicate: Option<String>,
    pub mission_id: Option<MissionId>,
    pub task_id: Option<TaskId>,
    pub branch_id: Option<String>,
    pub archive_mode: Option<String>,
    pub time_range: Option<TimeRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeRange {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridSearchOptions {
    pub base: SemanticSearchOptions,
    pub weights: Option<HybridWeights>,
    pub text_boost: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextSearchOptions {
    pub limit: Option<u32>,
    pub min_confidence: Option<f64>,
    pub freshness_filter: Option<Vec<String>>,
    pub classification: Option<ClassificationLevel>,
    pub tags: Option<Vec<String>>,
    pub category: Option<String>,
    pub subject: Option<String>,
    pub predicate: Option<String>,
    pub mission_id: Option<MissionId>,
    pub task_id: Option<TaskId>,
    pub branch_id: Option<String>,
    pub archive_mode: Option<String>,
    pub time_range: Option<TimeRange>,
    pub match_mode: Option<TextMatchMode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextMatchMode {
    Prefix,
    Exact,
    Fts5,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridWeights {
    pub text_weight: f64,
    pub vector_weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchRelevance {
    pub score: f64,
    pub vector_similarity: Option<f64>,
    pub text_rank: Option<f64>,
    pub decay_factor: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSearchResult {
    pub claim_id: String,
    pub content: String,
    pub subject: String,
    pub predicate: String,
    pub confidence: f64,
    pub effective_confidence: f64,
    pub freshness: String,
    pub classification: ClassificationLevel,
    pub relevance: SearchRelevance,
    pub created_at: String,
    pub source_agent_id: AgentId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridSearchResult {
    pub base: SemanticSearchResult,
    pub hybrid_score: HybridScore,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridScore {
    pub combined: f64,
    pub text_component: f64,
    pub vector_component: f64,
    pub weights_used: HybridWeights,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextSearchResult {
    pub claim_id: String,
    pub content: String,
    pub subject: String,
    pub predicate: String,
    pub confidence: f64,
    pub effective_confidence: f64,
    pub freshness: String,
    pub classification: ClassificationLevel,
    pub relevance: SearchRelevance,
    pub created_at: String,
    pub source_agent_id: AgentId,
    pub highlights: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateCheckOptions {
    pub threshold: Option<f64>,
    pub scope: Option<DuplicateScope>,
    pub exclude_claim_ids: Option<Vec<String>>,
    pub max_candidates: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateScope {
    Agent,
    Tenant,
    Global,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateCheckResult {
    pub is_duplicate: bool,
    pub similarity: f64,
    pub existing_claim_id: Option<String>,
    pub action: DuplicateAction,
    pub candidates_evaluated: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateAction {
    Refuse,
    Merge,
    Flag,
    Allow,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicatePolicy {
    pub threshold: f64,
    pub action: DuplicateAction,
    pub scope: DuplicateScope,
    pub merge_strategy: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingStats {
    pub total_claims: u64,
    pub embedded_claims: u64,
    pub pending_claims: u64,
    pub stale_claims: u64,
    pub failed_claims: u64,
    pub current_provider: EmbeddingProviderSummary,
    pub average_embed_time_ms: f64,
    pub last_embed_batch_at: Option<String>,
    pub queue_depth: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingProviderSummary {
    pub provider_id: String,
    pub model_name: String,
    pub model_version: String,
    pub dimensions: u32,
    pub registered_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StaleEmbedding {
    pub claim_id: String,
    pub subject: String,
    pub predicate: String,
    pub current_model_version: String,
    pub target_model_version: String,
    pub embedded_at: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SearchError {
    EmbeddingProviderUnavailable { message: String, last_attempt_at: String },
    EmbeddingDimensionMismatch { message: String, expected: u32, received: u32 },
    DuplicateRefused { message: String, existing_claim_id: String, similarity: f64 },
    SearchTimeout { message: String, timeout_ms: u64, search_mode: String },
    InvalidWeights { message: String, text_weight: f64, vector_weight: f64, sum: f64 },
    InvalidThreshold { message: String, provided: f64, minimum: f64, maximum: f64 },
    GovernanceRefusal { message: String, rule: String },
    BranchNotFound { message: String, branch_id: String },
    ProviderNotConfigured { message: String },
    BatchInProgress { message: String, existing_batch_id: String },
}

/// Core search governance trait. All methods are async and enforce
/// classification filtering, rate limiting, and audit emission.
pub trait AgentSearchGovernor: Send + Sync {
    fn semantic_search<'a>(
        &'a self,
        session: &'a AgentSession,
        query: &'a str,
        options: Option<SemanticSearchOptions>,
    ) -> AsyncSearchResult<'a, Vec<SemanticSearchResult>>;

    fn hybrid_search<'a>(
        &'a self,
        session: &'a AgentSession,
        query: &'a str,
        options: Option<HybridSearchOptions>,
    ) -> AsyncSearchResult<'a, Vec<HybridSearchResult>>;

    fn text_search<'a>(
        &'a self,
        session: &'a AgentSession,
        query: &'a str,
        options: Option<TextSearchOptions>,
    ) -> AsyncSearchResult<'a, Vec<TextSearchResult>>;

    fn check_duplicate<'a>(
        &'a self,
        session: &'a AgentSession,
        content: &'a str,
        options: Option<DuplicateCheckOptions>,
    ) -> AsyncSearchResult<'a, DuplicateCheckResult>;

    fn set_duplicate_policy<'a>(
        &'a self,
        session: &'a AgentSession,
        policy: DuplicatePolicy,
    ) -> AsyncSearchResult<'a, ()>;

    fn get_duplicate_policy<'a>(
        &'a self,
        session: &'a AgentSession,
    ) -> AsyncSearchResult<'a, DuplicatePolicy>;

    fn get_embedding_stats<'a>(
        &'a self,
        session: &'a AgentSession,
    ) -> AsyncSearchResult<'a, EmbeddingStats>;

    fn trigger_reembedding<'a>(
        &'a self,
        session: &'a AgentSession,
        options: Option<ReembeddingOptions>,
    ) -> AsyncSearchResult<'a, ReembeddingResult>;

    fn set_embedding_provider<'a>(
        &'a self,
        session: &'a AgentSession,
        provider: EmbeddingProviderConfig,
    ) -> AsyncSearchResult<'a, ()>;

    fn get_stale_embeddings<'a>(
        &'a self,
        session: &'a AgentSession,
        options: Option<StalenessOptions>,
    ) -> AsyncSearchResult<'a, Vec<StaleEmbedding>>;

    fn set_hybrid_weights<'a>(
        &'a self,
        session: &'a AgentSession,
        weights: HybridWeights,
    ) -> AsyncSearchResult<'a, ()>;

    fn get_hybrid_weights<'a>(
        &'a self,
        session: &'a AgentSession,
    ) -> AsyncSearchResult<'a, HybridWeights>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReembeddingOptions {
    pub scope: Option<ReembeddingScope>,
    pub batch_size: Option<u32>,
    pub priority: Option<ReembeddingPriority>,
    pub dry_run: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReembeddingScope {
    StaleOnly,
    FailedOnly,
    All,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReembeddingPriority {
    Normal,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReembeddingResult {
    pub triggered: u64,
    pub skipped: u64,
    pub failed: u64,
    pub estimated_duration_ms: u64,
    pub batch_id: String,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingProviderConfig {
    pub provider_id: String,
    pub model_name: String,
    pub model_version: String,
    pub dimensions: u32,
    pub max_tokens: u32,
    pub batch_size: u32,
    // embed function is a trait object in Rust, not serializable
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StalenessOptions {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub sort_by: Option<StalenessSortBy>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StalenessSortBy {
    OldestFirst,
    HighestConfidenceFirst,
}
```

---

## 11. Integration Map

| Method | Limen Internal | Governance Gate | Required Permission | Minimum Trust |
|---|---|---|---|---|
| `semanticSearch` | `vector_store.search()` + FSRS decay + classification filter | `{ domain: 'search', operation: 'query' }` | `query_claims` | `untrusted` |
| `hybridSearch` | `hybrid_ranker.rank()` combining FTS5 BM25 + vector cosine | `{ domain: 'search', operation: 'query' }` | `query_claims` | `untrusted` |
| `textSearch` | `fts5_index.search()` + FSRS decay + classification filter | `{ domain: 'search', operation: 'query' }` | `query_claims` | `untrusted` |
| `checkDuplicate` | `duplicate_detector.check()` cosine against sqlite-vec | `{ domain: 'search', operation: 'duplicate_check' }` | `query_claims` | `low` |
| `setDuplicatePolicy` | `config_store.set('duplicate_policy', ...)` | `{ domain: 'search', operation: 'configure' }` | `manage_cognitive` | `high` |
| `getDuplicatePolicy` | `config_store.get('duplicate_policy')` | `{ domain: 'search', operation: 'query' }` | `query_claims` | `untrusted` |
| `getEmbeddingStats` | `embedding_queue.stats()` + `vector_store.count()` | `{ domain: 'search', operation: 'query' }` | `query_claims` | `low` |
| `triggerReembedding` | `embedding_queue.enqueue_stale()` | `{ domain: 'search', operation: 'embed' }` | `manage_cognitive` | `high` |
| `setEmbeddingProvider` | `embedding_registry.register()` + mark all as stale | `{ domain: 'search', operation: 'configure' }` | `manage_cognitive` | `verified` |
| `getStaleEmbeddings` | `vector_store.query_stale(model_version)` | `{ domain: 'search', operation: 'query' }` | `query_claims` | `low` |
| `setHybridWeights` | `config_store.set('hybrid_weights', ...)` | `{ domain: 'search', operation: 'configure' }` | `manage_cognitive` | `high` |
| `getHybridWeights` | `config_store.get('hybrid_weights')` | `{ domain: 'search', operation: 'query' }` | `query_claims` | `untrusted` |

**Internal flow for `hybridSearch`:**

1. Governance gate: verify `query_claims` permission, rate limit, clearance
2. Embed query via `currentProvider.embed(query)` to get query vector
3. Execute FTS5 search: `fts5_index.search(query, limit * 3)` for over-retrieval
4. Execute vector search: `vector_store.search(queryVector, limit * 3)` for over-retrieval
5. Apply classification filter: exclude claims above `session.clearanceLevel`
6. Apply FSRS decay to each candidate's confidence
7. Compute hybrid score: `combined = textWeight * normalizedBM25 + vectorWeight * cosineSimilarity`
8. Apply domain weight overrides if predicate matches a `DomainWeightOverride` pattern
9. Sort by `combined` descending, apply `limit`
10. Emit `search:queried` event
11. Append audit entry

---

## 12. Invariants

1. **Classification ceiling.** Search results never include claims where `CLASSIFICATION_NUMERIC[claim.classification] > session.clearanceLevel`. This is enforced at the query layer (WHERE clause), not post-filter, to prevent information leakage via result count or timing.

2. **Rate limiting.** All search operations consume from the `per_agent` and `per_session` rate limit pools under dimension `all_operations`. Exceeding any applicable `RateLimitPolicy` produces `GOVERNANCE_REFUSAL` before query execution.

3. **Duplicate threshold floor.** `DuplicatePolicy.threshold` cannot be set below 0.7. `DuplicateCheckOptions.threshold` cannot be set below 0.7. Attempts produce `INVALID_THRESHOLD` error with `minimum: 0.7`. This prevents pathological false-positive rates from broad semantic overlap.

4. **Provider change triggers stale marking.** When `setEmbeddingProvider` succeeds, ALL claims with embeddings from the prior provider are marked stale. The system does NOT automatically trigger re-embedding; the caller must explicitly invoke `triggerReembedding`. This is intentional --- re-embedding may be expensive and should be a deliberate action.

5. **Stale embeddings remain searchable.** Claims with stale embeddings participate in search with their existing vectors. Results from stale embeddings include `relevance.decayFactor` reflecting temporal degradation but are NOT excluded. Staleness is a quality signal, not an availability gate.

6. **Weight sum constraint.** `HybridWeights.textWeight + HybridWeights.vectorWeight` must equal exactly 1.0 (within floating-point tolerance of 1e-10). Violations produce `INVALID_WEIGHTS` synchronously before any persistence.

7. **Audit completeness.** Every search operation (success or failure) produces exactly one `AuditLogEntry` with `event: 'search:queried'` and `action: { domain: 'search', operation: 'query' | 'embed' | 'duplicate_check' | 'configure' }`. The audit entry is durably appended before the success response is returned to the caller (per `PerformanceBudget.auditAppend` contract).

8. **Branch isolation.** When `branchId` is specified in search options, results are scoped to claims within that branch plus trunk claims visible to the branch. Cross-branch search is not permitted; specifying a `branchId` the agent does not own produces `BRANCH_NOT_FOUND`.

9. **Embedding async guarantee.** Embedding operations (`triggerReembedding`, automatic new-claim embedding) execute asynchronously via the embedding queue. They never block the critical path of `remember()`, `semanticSearch()`, or any other synchronous operation. A claim without an embedding simply does not appear in semantic/hybrid results but remains fully accessible via text search.

10. **Tenant isolation in duplicate detection.** `DuplicateScope.agent` compares only against claims where `sourceAgentId` matches. `DuplicateScope.tenant` compares against all claims within `session.tenantId`. `DuplicateScope.global` (restricted to `verified` trust level) compares across all tenants. Cross-tenant matching at lower trust levels produces `GOVERNANCE_REFUSAL`.

---

## Appendix A: Performance Targets

| Operation | Target Latency (p95) | Notes |
|---|---|---|
| `textSearch` | < 15ms | FTS5 with pre-built index |
| `semanticSearch` | < 50ms | sqlite-vec ANN + filter + sort |
| `hybridSearch` | < 80ms | Parallel FTS5 + vector, merge + rank |
| `checkDuplicate` | < 30ms | Single vector comparison against top-K |
| `getEmbeddingStats` | < 5ms | Cached counters, refreshed per batch |
| `triggerReembedding` | < 10ms | Enqueue only; actual work is async |
| `setHybridWeights` | < 5ms | Config write |
| `setEmbeddingProvider` | < 20ms | Config write + stale marking (batched) |

These targets exclude network round-trip for remote embedding providers. The `embed()` function latency is caller-controlled and not governed by this contract.

---

## Appendix B: Version History

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-05-05 | Initial ratification. All 12 sections canonical. |
