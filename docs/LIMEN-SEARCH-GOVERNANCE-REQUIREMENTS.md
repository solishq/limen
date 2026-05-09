<!-- @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->
# Limen v5 -- AGENT_SEARCH_GOVERNANCE.md Requirement Extraction

**Source:** `contracts/AGENT_SEARCH_GOVERNANCE.md` v1.0.0
**Extracted:** 2026-05-09
**Governing Standard:** SolisForge Protocol v1.4
**Governance Tier:** Forge Critical
**Purpose:** Every implementable requirement from the Agent Search Governance contract.

---

## Section 1: Purpose & Scope

| ID | Requirement | Source |
|---|---|---|
| SG-1.1 | Contract scope covers vector search, semantic recall, duplicate detection, embedding lifecycle, and hybrid ranking governance | S1 |
| SG-1.2 | Contract classification is QAL-3 | Header |
| SG-1.3 | Every search operation MUST respect agent clearance level | S1 |
| SG-1.4 | Every search operation MUST produce an audit entry | S1 |
| SG-1.5 | Every search operation MUST operate within tenant isolation boundaries | S1 |
| SG-1.6 | All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`; this contract does NOT redefine any shared type | Preamble |

**Totals: 6 requirements**

---

## Section 2: Shared Type References

| ID | Requirement | Source |
|---|---|---|
| SG-2.1 | Implementation MUST use the 26 shared types listed in the reference table (`Result<T>`, `ClaimId`, `AgentId`, `SessionId`, `TenantId`, `EventId`, `MissionId`, `TaskId`, `AgentSession`, `OperationContext`, `GovernanceDecision`, `GovernanceAction`, `GovernanceVerdict`, `ClassificationLevel`, `CLASSIFICATION_NUMERIC`, `AgentMemoryEntry`, `FreshnessLabel`, `AgentEvent`, `AgentEventPayload`, `AgentEventHandler`, `RateLimitPolicy`, `RetentionPolicy`, `ArchiveMode`, `AuditLogEntry`, `PerformanceBudget`, `AgentBranchId`) from SHARED_TYPES.md without redefinition | S2 |

**Totals: 1 requirement**

---

## Section 3: AgentSearchClient Interface

| ID | Requirement | Source |
|---|---|---|
| SG-3.1 | `semanticSearch(ctx: OperationContext, query: string, options?: SemanticSearchOptions)` MUST return `Promise<Result<SemanticSearchResult[]>>` | S3 Interface |
| SG-3.2 | `hybridSearch(ctx: OperationContext, query: string, options?: HybridSearchOptions)` MUST return `Promise<Result<HybridSearchResult[]>>` | S3 Interface |
| SG-3.3 | `textSearch(ctx: OperationContext, query: string, options?: TextSearchOptions)` MUST return `Promise<Result<TextSearchResult[]>>` | S3 Interface |
| SG-3.4 | `checkDuplicate(ctx: OperationContext, content: string, options?: DuplicateCheckOptions)` MUST return `Promise<Result<DuplicateCheckResult>>` | S3 Interface |
| SG-3.5 | `setDuplicatePolicy(ctx: OperationContext, policy: DuplicatePolicy)` MUST return `Promise<Result<void>>` | S3 Interface |
| SG-3.6 | `getDuplicatePolicy(ctx: OperationContext)` MUST return `Promise<Result<DuplicatePolicy>>` | S3 Interface |
| SG-3.7 | `getEmbeddingStats(ctx: OperationContext)` MUST return `Promise<Result<EmbeddingStats>>` | S3 Interface |
| SG-3.8 | `triggerReembedding(ctx: OperationContext, options?: ReembeddingOptions)` MUST return `Promise<Result<ReembeddingResult>>` | S3 Interface |
| SG-3.9 | `setEmbeddingProvider(ctx: OperationContext, provider: EmbeddingProviderConfig)` MUST return `Promise<Result<void>>` | S3 Interface |
| SG-3.10 | `getStaleEmbeddings(ctx: OperationContext, options?: StalenessOptions)` MUST return `Promise<Result<StaleEmbedding[]>>` | S3 Interface |
| SG-3.11 | `setHybridWeights(ctx: OperationContext, weights: HybridWeights)` MUST return `Promise<Result<void>>` | S3 Interface |
| SG-3.12 | `getHybridWeights(ctx: OperationContext)` MUST return `Promise<Result<HybridWeights>>` | S3 Interface |
| SG-3.13 | `on(ctx: OperationContext, event: SearchEvent, handler: AgentEventHandler)` MUST return subscription ID `string` | S3 Interface |
| SG-3.14 | `off(ctx: OperationContext, subscriptionId: string)` MUST unsubscribe the handler | S3 Interface |

**Totals: 14 requirements**

---

## Section 4: SemanticSearchOptions Data Model

| ID | Requirement | Source |
|---|---|---|
| SG-4.1 | `SemanticSearchOptions.limit` MUST be optional, default 20, max 200 | S4 |
| SG-4.2 | `SemanticSearchOptions.minSimilarity` MUST be optional, cosine threshold in [0.0, 1.0], default 0.5 | S4 |
| SG-4.3 | `SemanticSearchOptions.minConfidence` MUST be optional, effective confidence floor, default 0.0 | S4 |
| SG-4.4 | `SemanticSearchOptions.freshnessFilter` MUST accept `FreshnessLabel` or `readonly FreshnessLabel[]` | S4 |
| SG-4.5 | `SemanticSearchOptions.classification` MUST be optional `ClassificationLevel`, capped by session clearance | S4 |
| SG-4.6 | `SemanticSearchOptions.tags` MUST be optional `readonly string[]`, filter by tag intersection | S4 |
| SG-4.7 | `SemanticSearchOptions.category` MUST be optional string category filter | S4 |
| SG-4.8 | `SemanticSearchOptions.subject` MUST be optional string subject pattern with trailing wildcard | S4 |
| SG-4.9 | `SemanticSearchOptions.predicate` MUST be optional string predicate pattern with trailing wildcard | S4 |
| SG-4.10 | `SemanticSearchOptions.missionId` MUST be optional `MissionId` scope filter | S4 |
| SG-4.11 | `SemanticSearchOptions.taskId` MUST be optional `TaskId` scope filter | S4 |
| SG-4.12 | `SemanticSearchOptions.branchId` MUST be optional `AgentBranchId` scope filter | S4 |
| SG-4.13 | `SemanticSearchOptions.archiveMode` MUST be optional `ArchiveMode`, default `'exclude'` | S4 |
| SG-4.14 | `SemanticSearchOptions.timeRange` MUST be optional `{ from: string; to: string }` | S4 |

**Totals: 14 requirements**

---

## Section 4 (continued): HybridSearchOptions Data Model

| ID | Requirement | Source |
|---|---|---|
| SG-4.15 | `HybridSearchOptions` MUST extend `SemanticSearchOptions` | S4 |
| SG-4.16 | `HybridSearchOptions.weights` MUST be optional `HybridWeights` per-query override that does not persist | S4 |
| SG-4.17 | `HybridSearchOptions.textBoost` MUST be optional number BM25 boost factor, default 1.0 | S4 |

**Totals: 3 requirements**

---

## Section 4 (continued): TextSearchOptions Data Model

| ID | Requirement | Source |
|---|---|---|
| SG-4.18 | `TextSearchOptions.limit` MUST be optional, default 20, max 200 | S4 |
| SG-4.19 | `TextSearchOptions.matchMode` MUST be optional `'prefix' | 'exact' | 'fts5'`, default `'fts5'` | S4 |
| SG-4.20 | `TextSearchOptions` MUST include all common filter fields: `minConfidence`, `freshnessFilter`, `classification`, `tags`, `category`, `subject`, `predicate`, `missionId`, `taskId`, `branchId`, `archiveMode`, `timeRange` | S4 |

**Totals: 3 requirements**

---

## Section 4 (continued): SearchRelevance Data Model

| ID | Requirement | Source |
|---|---|---|
| SG-4.21 | `SearchRelevance.score` MUST be normalized to [0.0, 1.0] | S4 |
| SG-4.22 | `SearchRelevance.vectorSimilarity` MUST be `number | null` (null for text-only searches) | S4 |
| SG-4.23 | `SearchRelevance.textRank` MUST be `number | null` (null for semantic-only searches) | S4 |
| SG-4.24 | `SearchRelevance.decayFactor` MUST be the FSRS time-decay multiplier applied | S4 |

**Totals: 4 requirements**

---

## Section 4 (continued): SemanticSearchResult Data Model

| ID | Requirement | Source |
|---|---|---|
| SG-4.25 | `SemanticSearchResult.claimId` MUST be `ClaimId` | S4 |
| SG-4.26 | `SemanticSearchResult.content` MUST be the claim value (not full structured content) | S4 |
| SG-4.27 | `SemanticSearchResult.subject` MUST be a string | S4 |
| SG-4.28 | `SemanticSearchResult.predicate` MUST be a string | S4 |
| SG-4.29 | `SemanticSearchResult.confidence` MUST be the original confidence number | S4 |
| SG-4.30 | `SemanticSearchResult.effectiveConfidence` MUST be the confidence after FSRS decay | S4 |
| SG-4.31 | `SemanticSearchResult.freshness` MUST be `FreshnessLabel` | S4 |
| SG-4.32 | `SemanticSearchResult.classification` MUST be `ClassificationLevel` | S4 |
| SG-4.33 | `SemanticSearchResult.relevance` MUST be `SearchRelevance` | S4 |
| SG-4.34 | `SemanticSearchResult.createdAt` MUST be ISO-8601 string | S4 |
| SG-4.35 | `SemanticSearchResult.sourceAgentId` MUST be `AgentId` | S4 |
| SG-4.36 | Results MUST be ordered by `relevance.score` descending, then `effectiveConfidence` descending, then `createdAt` descending (deterministic tiebreaker) | S4 Validation |

**Totals: 12 requirements**

---

## Section 4 (continued): HybridSearchResult & HybridScore

| ID | Requirement | Source |
|---|---|---|
| SG-4.37 | `HybridSearchResult` MUST extend `SemanticSearchResult` | S4 |
| SG-4.38 | `HybridSearchResult.hybridScore` MUST be `HybridScore` | S4 |
| SG-4.39 | `HybridScore.combined` MUST be a weighted blend normalized to [0.0, 1.0] | S4 |
| SG-4.40 | `HybridScore.textComponent` MUST be `textWeight * textRank` | S4 |
| SG-4.41 | `HybridScore.vectorComponent` MUST be `vectorWeight * vectorSimilarity` | S4 |
| SG-4.42 | `HybridScore.weightsUsed` MUST be the actual `HybridWeights` applied | S4 |

**Totals: 6 requirements**

---

## Section 4 (continued): TextSearchResult Data Model

| ID | Requirement | Source |
|---|---|---|
| SG-4.43 | `TextSearchResult` MUST include all fields from `SemanticSearchResult` (same 11 fields) | S4 |
| SG-4.44 | `TextSearchResult.highlights` MUST be `readonly string[]` containing FTS5 snippet highlights | S4 |

**Totals: 2 requirements**

---

## Section 4 (continued): Validation Rules

| ID | Requirement | Source |
|---|---|---|
| SG-4.45 | `limit` MUST be a positive integer; values exceeding 200 MUST be clamped to 200 | S4 Validation |
| SG-4.46 | `minSimilarity` MUST be in closed interval [0.0, 1.0]; values below 0.0 clamped to 0.0, above 1.0 clamped to 1.0 | S4 Validation |
| SG-4.47 | `classification` in options is an UPPER BOUND; actual filtering MUST use `min(requested, session.clearanceLevel)` | S4 Validation |
| SG-4.48 | Claims with `CLASSIFICATION_NUMERIC[claim.classification] > session.clearanceLevel` MUST be unconditionally excluded regardless of options | S4 Validation |
| SG-4.49 | `relevance.score` MUST always be normalized to [0.0, 1.0] regardless of underlying engine scores | S4 Validation |

**Totals: 5 requirements**

---

## Section 5: Duplicate Detection Data Models

| ID | Requirement | Source |
|---|---|---|
| SG-5.1 | `DuplicateCheckOptions.threshold` MUST be optional, overrides policy threshold for this check | S5 |
| SG-5.2 | `DuplicateCheckOptions.scope` MUST be optional `DuplicateScope` override | S5 |
| SG-5.3 | `DuplicateCheckOptions.excludeClaimIds` MUST be optional `readonly ClaimId[]` for self-reference protection | S5 |
| SG-5.4 | `DuplicateCheckOptions.maxCandidates` MUST be optional, default 50 | S5 |
| SG-5.5 | `DuplicateScope` MUST be `'agent' | 'tenant' | 'global'` | S5 |
| SG-5.6 | `DuplicateCheckResult.isDuplicate` MUST be boolean | S5 |
| SG-5.7 | `DuplicateCheckResult.similarity` MUST be highest cosine similarity found [0.0, 1.0] | S5 |
| SG-5.8 | `DuplicateCheckResult.existingClaimId` MUST be `ClaimId | null` (null if no match) | S5 |
| SG-5.9 | `DuplicateCheckResult.action` MUST be `DuplicateAction` | S5 |
| SG-5.10 | `DuplicateCheckResult.candidatesEvaluated` MUST be the count of claims compared | S5 |
| SG-5.11 | `DuplicateAction` MUST be `'refuse' | 'merge' | 'flag' | 'allow'` | S5 |
| SG-5.12 | `DuplicatePolicy.threshold` MUST be in closed interval [0.7, 1.0]; values below 0.7 MUST be rejected with `INVALID_THRESHOLD` error | S5 Validation |
| SG-5.13 | When `DuplicatePolicy.action` is `'merge'`, `mergeStrategy` MUST be present; absence is a validation error | S5 Validation |
| SG-5.14 | `DuplicateScope.global` MUST be available only to `verified` trust level agents | S5 Validation |
| SG-5.15 | `excludeClaimIds` MUST be capped at 100 entries to prevent query degradation | S5 Validation |

**Totals: 15 requirements**

---

## Section 5 (continued): DuplicatePolicy Data Model

| ID | Requirement | Source |
|---|---|---|
| SG-5.16 | `DuplicatePolicy.threshold` MUST be number in [0.7, 1.0] | S5 |
| SG-5.17 | `DuplicatePolicy.action` MUST be `DuplicateAction` | S5 |
| SG-5.18 | `DuplicatePolicy.scope` MUST be `DuplicateScope` | S5 |
| SG-5.19 | `DuplicatePolicy.mergeStrategy` MUST be optional `'highest_confidence' | 'temporal_latest'` | S5 |
| SG-5.20 | `DuplicatePolicy.enabled` MUST be boolean master switch | S5 |

**Totals: 5 requirements**

---

## Section 6: Embedding Lifecycle Data Models

| ID | Requirement | Source |
|---|---|---|
| SG-6.1 | `EmbeddingProviderConfig.providerId` MUST be a unique string identifier | S6 |
| SG-6.2 | `EmbeddingProviderConfig.modelName` MUST be a string (e.g., "text-embedding-3-small") | S6 |
| SG-6.3 | `EmbeddingProviderConfig.modelVersion` MUST be branded type `ModelVersion` | S6 |
| SG-6.4 | `EmbeddingProviderConfig.dimensions` MUST be a positive integer | S6 |
| SG-6.5 | `EmbeddingProviderConfig.maxTokens` MUST be a positive integer | S6 |
| SG-6.6 | `EmbeddingProviderConfig.batchSize` MUST be in [1, 2048] | S6 |
| SG-6.7 | `EmbeddingProviderConfig.embed` MUST be a caller-supplied function `(text: string) => Promise<Float32Array>` | S6 |
| SG-6.8 | `ModelVersion` MUST be a branded string type `string & { readonly __brand: 'ModelVersion' }` | S6 |
| SG-6.9 | `EmbeddingStats.totalClaims` MUST be total claims in system | S6 |
| SG-6.10 | `EmbeddingStats.embeddedClaims` MUST be claims with valid embeddings | S6 |
| SG-6.11 | `EmbeddingStats.pendingClaims` MUST be claims awaiting embedding | S6 |
| SG-6.12 | `EmbeddingStats.staleClaims` MUST be claims with outdated model version | S6 |
| SG-6.13 | `EmbeddingStats.failedClaims` MUST be claims that failed embedding (retriable) | S6 |
| SG-6.14 | `EmbeddingStats.currentProvider` MUST be `EmbeddingProviderSummary` | S6 |
| SG-6.15 | `EmbeddingStats.averageEmbedTimeMs` MUST be rolling average per-claim embed time | S6 |
| SG-6.16 | `EmbeddingStats.lastEmbedBatchAt` MUST be `string | null` (ISO-8601) | S6 |
| SG-6.17 | `EmbeddingStats.queueDepth` MUST be current async queue size | S6 |
| SG-6.18 | `EmbeddingProviderSummary` MUST include `providerId`, `modelName`, `modelVersion`, `dimensions`, `registeredAt` | S6 |
| SG-6.19 | `ReembeddingOptions.scope` MUST be optional `'stale_only' | 'failed_only' | 'all'`, default `'stale_only'` | S6 |
| SG-6.20 | `ReembeddingOptions.batchSize` MUST be optional, overrides provider batch size | S6 |
| SG-6.21 | `ReembeddingOptions.priority` MUST be optional `'normal' | 'high'`; high preempts normal queue | S6 |
| SG-6.22 | `ReembeddingOptions.dryRun` MUST be optional boolean; reports without doing | S6 |
| SG-6.23 | `ReembeddingResult` MUST include `triggered`, `skipped`, `failed`, `estimatedDurationMs`, `batchId`, `dryRun` | S6 |
| SG-6.24 | `StalenessOptions.limit` MUST be optional, default 100 | S6 |
| SG-6.25 | `StalenessOptions.offset` MUST be optional for pagination | S6 |
| SG-6.26 | `StalenessOptions.sortBy` MUST be optional `'oldest_first' | 'highest_confidence_first'`, default `'oldest_first'` | S6 |
| SG-6.27 | `StaleEmbedding` MUST include `claimId`, `subject`, `predicate`, `currentModelVersion`, `targetModelVersion`, `embeddedAt`, `confidence` | S6 |
| SG-6.28 | Changing `dimensions` MUST require full re-embedding; partial dimension mismatch is a fatal error | S6 Validation |
| SG-6.29 | A claim is stale when its stored `modelVersion` differs from `currentProvider.modelVersion` | S6 Validation |
| SG-6.30 | `triggerReembedding` MUST be idempotent: calling while batch in progress returns existing status without creating duplicate | S6 Validation |
| SG-6.31 | Failed claims MUST be retried up to 3 times with exponential backoff (1s, 4s, 16s); after 3 failures, claim moves to `failed` state requiring manual `triggerReembedding` with `scope: 'failed_only'` | S6 Validation |

**Totals: 31 requirements**

---

## Section 7: Hybrid Ranking Data Models

| ID | Requirement | Source |
|---|---|---|
| SG-7.1 | `HybridWeights.textWeight` MUST be number in [0.0, 1.0] | S7 |
| SG-7.2 | `HybridWeights.vectorWeight` MUST be number in [0.0, 1.0] | S7 |
| SG-7.3 | `textWeight + vectorWeight` MUST equal exactly 1.0 within tolerance `Math.abs(sum - 1.0) < 1e-10`; violations produce `INVALID_WEIGHTS` error | S7 Validation |
| SG-7.4 | A weight of 0.0 is valid (disables that component entirely) | S7 Validation |
| SG-7.5 | `RankingProfile` MUST include `name`, `weights`, `description`, `domainOverrides` | S7 |
| SG-7.6 | `DomainWeightOverride` MUST include `predicatePattern` (glob) and `weights` (override `HybridWeights`) | S7 |
| SG-7.7 | `domainOverrides` MUST be evaluated in array order; first matching pattern wins | S7 Validation |
| SG-7.8 | `setHybridWeights` MUST persist weights per-tenant; absence uses default | S7 Validation |
| SG-7.9 | Default weights MUST be `{ textWeight: 0.3, vectorWeight: 0.7 }` | S7 Validation |

**Totals: 9 requirements**

---

## Section 8: Search Events

| ID | Requirement | Source |
|---|---|---|
| SG-8.1 | `SearchEvent` type MUST include `'search:queried'`, `'embedding:queued'`, `'embedding:completed'`, `'duplicate:detected'` | S8 |
| SG-8.2 | Search events MUST be a subset of the unified `AgentEvent` bus | S8 |
| SG-8.3 | `search:queried` payload MUST include `searchMode`, `query` (truncated to 100 chars), `resultCount`, `latencyMs` | S8 |
| SG-8.4 | `embedding:queued` payload MUST include `claimId`, `reason` (`'new_claim' | 'stale' | 'failed_retry'`), `batchId` | S8 |
| SG-8.5 | `embedding:completed` payload MUST include `claimId`, `modelVersion`, `dimensions`, `durationMs` | S8 |
| SG-8.6 | `duplicate:detected` payload MUST include `claimId`, `existingClaimId`, `similarity`, `action` | S8 |
| SG-8.7 | Every search operation MUST emit exactly one `search:queried` event upon completion (success or error) | S8 Emission |
| SG-8.8 | `embedding:queued` MUST emit when a claim enters the embedding queue (not when drained) | S8 Emission |
| SG-8.9 | `duplicate:detected` MUST emit only when `isDuplicate === true` AND `action !== 'allow'` | S8 Emission |
| SG-8.10 | `embedding:completed` MUST emit per-claim after successful embedding persistence | S8 Emission |

**Totals: 10 requirements**

---

## Section 9: Error Types

| ID | Requirement | Source |
|---|---|---|
| SG-9.1 | Error code `EMBEDDING_PROVIDER_UNAVAILABLE` MUST include `message` and `lastAttemptAt` | S9 |
| SG-9.2 | Error code `EMBEDDING_DIMENSION_MISMATCH` MUST include `message`, `expected`, `received` | S9 |
| SG-9.3 | Error code `DUPLICATE_REFUSED` MUST include `message`, `existingClaimId`, `similarity` | S9 |
| SG-9.4 | Error code `SEARCH_TIMEOUT` MUST include `message`, `timeoutMs`, `searchMode` | S9 |
| SG-9.5 | Error code `INVALID_WEIGHTS` MUST include `message`, `textWeight`, `vectorWeight`, `sum` | S9 |
| SG-9.6 | Error code `INVALID_THRESHOLD` MUST include `message`, `provided`, `minimum`, `maximum` | S9 |
| SG-9.7 | Error code `GOVERNANCE_REFUSAL` MUST include `message`, `verdict`, `rule` | S9 |
| SG-9.8 | Error code `BRANCH_NOT_FOUND` MUST include `message`, `branchId` | S9 |
| SG-9.9 | Error code `PROVIDER_NOT_CONFIGURED` MUST include `message` | S9 |
| SG-9.10 | Error code `BATCH_IN_PROGRESS` MUST include `message`, `existingBatchId` | S9 |
| SG-9.11 | All errors MUST be returned via `Result<T>` (`ok: false` path) with `KernelError` wrapping the discriminated `AgentSearchError` | S9 Propagation |
| SG-9.12 | `KernelError.spec` MUST reference `"AGENT_SEARCH_GOVERNANCE v1.0.0"` | S9 Propagation |
| SG-9.13 | `SEARCH_TIMEOUT` MUST fire when search exceeds configured timeout: 5000ms for semantic, 2000ms for text, 7000ms for hybrid | S9 Propagation |

**Totals: 13 requirements**

---

## Section 10: Rust Trait -- AgentSearchGovernor

| ID | Requirement | Source |
|---|---|---|
| SG-10.1 | Rust trait `AgentSearchGovernor` MUST be `Send + Sync` | S10 |
| SG-10.2 | `semantic_search` MUST accept `&AgentSession`, `&str` query, `Option<SemanticSearchOptions>` and return `AsyncSearchResult<Vec<SemanticSearchResult>>` | S10 |
| SG-10.3 | `hybrid_search` MUST accept `&AgentSession`, `&str` query, `Option<HybridSearchOptions>` and return `AsyncSearchResult<Vec<HybridSearchResult>>` | S10 |
| SG-10.4 | `text_search` MUST accept `&AgentSession`, `&str` query, `Option<TextSearchOptions>` and return `AsyncSearchResult<Vec<TextSearchResult>>` | S10 |
| SG-10.5 | `check_duplicate` MUST accept `&AgentSession`, `&str` content, `Option<DuplicateCheckOptions>` and return `AsyncSearchResult<DuplicateCheckResult>` | S10 |
| SG-10.6 | `set_duplicate_policy` MUST accept `&AgentSession`, `DuplicatePolicy` and return `AsyncSearchResult<()>` | S10 |
| SG-10.7 | `get_duplicate_policy` MUST accept `&AgentSession` and return `AsyncSearchResult<DuplicatePolicy>` | S10 |
| SG-10.8 | `get_embedding_stats` MUST accept `&AgentSession` and return `AsyncSearchResult<EmbeddingStats>` | S10 |
| SG-10.9 | `trigger_reembedding` MUST accept `&AgentSession`, `Option<ReembeddingOptions>` and return `AsyncSearchResult<ReembeddingResult>` | S10 |
| SG-10.10 | `set_embedding_provider` MUST accept `&AgentSession`, `EmbeddingProviderConfig` and return `AsyncSearchResult<()>` | S10 |
| SG-10.11 | `get_stale_embeddings` MUST accept `&AgentSession`, `Option<StalenessOptions>` and return `AsyncSearchResult<Vec<StaleEmbedding>>` | S10 |
| SG-10.12 | `set_hybrid_weights` MUST accept `&AgentSession`, `HybridWeights` and return `AsyncSearchResult<()>` | S10 |
| SG-10.13 | `get_hybrid_weights` MUST accept `&AgentSession` and return `AsyncSearchResult<HybridWeights>` | S10 |
| SG-10.14 | `SearchResult<T>` MUST be `Result<T, SearchError>` and `AsyncSearchResult` MUST be `Pin<Box<dyn Future<Output = SearchResult<T>> + Send>>` | S10 |

**Totals: 14 requirements**

---

## Section 10 (continued): Rust Data Types

| ID | Requirement | Source |
|---|---|---|
| SG-10.15 | Rust `SemanticSearchOptions` MUST mirror all 14 fields from TS `SemanticSearchOptions` | S10 |
| SG-10.16 | Rust `TimeRange` MUST have `from: String` and `to: String` | S10 |
| SG-10.17 | Rust `HybridSearchOptions` MUST have `base: SemanticSearchOptions` (composition not inheritance) | S10 |
| SG-10.18 | Rust `TextSearchOptions` MUST mirror all fields from TS `TextSearchOptions` | S10 |
| SG-10.19 | Rust `TextMatchMode` MUST be enum with `Prefix`, `Exact`, `Fts5` | S10 |
| SG-10.20 | Rust `HybridWeights` MUST have `text_weight: f64` and `vector_weight: f64` | S10 |
| SG-10.21 | Rust `SearchRelevance` MUST have `score: f64`, `vector_similarity: Option<f64>`, `text_rank: Option<f64>`, `decay_factor: f64` | S10 |
| SG-10.22 | Rust `SemanticSearchResult` MUST have `claim_id: String`, `content`, `subject`, `predicate`, `confidence`, `effective_confidence`, `freshness`, `classification`, `relevance`, `created_at`, `source_agent_id` | S10 |
| SG-10.23 | Rust `HybridSearchResult` MUST use composition (`base: SemanticSearchResult`, `hybrid_score: HybridScore`) | S10 |
| SG-10.24 | Rust `HybridScore` MUST have `combined`, `text_component`, `vector_component`, `weights_used` | S10 |
| SG-10.25 | Rust `TextSearchResult` MUST include `highlights: Vec<String>` in addition to all `SemanticSearchResult` fields | S10 |
| SG-10.26 | Rust `DuplicateCheckOptions` MUST have `threshold`, `scope`, `exclude_claim_ids`, `max_candidates` all as `Option` | S10 |
| SG-10.27 | Rust `DuplicateScope` MUST be enum with `Agent`, `Tenant`, `Global` | S10 |
| SG-10.28 | Rust `DuplicateCheckResult` MUST have `is_duplicate`, `similarity`, `existing_claim_id`, `action`, `candidates_evaluated` | S10 |
| SG-10.29 | Rust `DuplicateAction` MUST be enum with `Refuse`, `Merge`, `Flag`, `Allow` | S10 |
| SG-10.30 | Rust `DuplicatePolicy` MUST have `threshold`, `action`, `scope`, `merge_strategy`, `enabled` | S10 |
| SG-10.31 | Rust `EmbeddingStats` MUST mirror all 9 fields from TS `EmbeddingStats` using Rust equivalents | S10 |
| SG-10.32 | Rust `EmbeddingProviderSummary` MUST have `provider_id`, `model_name`, `model_version`, `dimensions`, `registered_at` | S10 |
| SG-10.33 | Rust `StaleEmbedding` MUST have `claim_id`, `subject`, `predicate`, `current_model_version`, `target_model_version`, `embedded_at`, `confidence` | S10 |
| SG-10.34 | Rust `SearchError` MUST be a tagged enum with all 10 error variants matching TS `AgentSearchError` codes | S10 |
| SG-10.35 | Rust `ReembeddingOptions` MUST have `scope`, `batch_size`, `priority`, `dry_run` all as `Option` | S10 |
| SG-10.36 | Rust `ReembeddingScope` MUST be enum with `StaleOnly`, `FailedOnly`, `All` | S10 |
| SG-10.37 | Rust `ReembeddingPriority` MUST be enum with `Normal`, `High` | S10 |
| SG-10.38 | Rust `ReembeddingResult` MUST have `triggered`, `skipped`, `failed`, `estimated_duration_ms`, `batch_id`, `dry_run` | S10 |
| SG-10.39 | Rust `EmbeddingProviderConfig` MUST have `provider_id`, `model_name`, `model_version`, `dimensions`, `max_tokens`, `batch_size` (embed function is trait object, not serializable) | S10 |
| SG-10.40 | Rust `StalenessOptions` MUST have `limit`, `offset`, `sort_by` all as `Option` | S10 |
| SG-10.41 | Rust `StalenessSortBy` MUST be enum with `OldestFirst`, `HighestConfidenceFirst` | S10 |
| SG-10.42 | All Rust structs MUST derive `Debug, Clone, Serialize, Deserialize` | S10 |

**Totals: 28 requirements**

---

## Section 10 (continued): TC-21 Rust Parity Gaps

| ID | Requirement | Source |
|---|---|---|
| SG-10.43 | **GAP (TC-21):** Rust trait `AgentSearchGovernor` has no `on`/`off` event subscription methods; TS `AgentSearchClient` does. Implementation MUST define Rust event subscription mechanism or document omission rationale | TC-21 Gap |
| SG-10.44 | **GAP (TC-21):** Rust `EmbeddingProviderConfig` cannot carry the `embed` function (not serializable); implementation MUST define a Rust trait object or callback mechanism for embedding | TC-21 Gap |

**Totals: 2 requirements**

---

## Section 11: Integration Map

| ID | Requirement | Source |
|---|---|---|
| SG-11.1 | `semanticSearch` MUST route to `vector_store.search()` + FSRS decay + classification filter | S11 |
| SG-11.2 | `hybridSearch` MUST route to `hybrid_ranker.rank()` combining FTS5 BM25 + vector cosine | S11 |
| SG-11.3 | `textSearch` MUST route to `fts5_index.search()` + FSRS decay + classification filter | S11 |
| SG-11.4 | `checkDuplicate` MUST route to `duplicate_detector.check()` cosine against sqlite-vec | S11 |
| SG-11.5 | `setDuplicatePolicy` MUST route to `config_store.set('duplicate_policy', ...)` | S11 |
| SG-11.6 | `setEmbeddingProvider` MUST route to `embedding_registry.register()` + mark all as stale | S11 |
| SG-11.7 | `triggerReembedding` MUST route to `embedding_queue.enqueue_stale()` | S11 |
| SG-11.8 | `setEmbeddingProvider` requires `verified` minimum trust level | S11 |
| SG-11.9 | `setDuplicatePolicy`, `triggerReembedding`, `setHybridWeights` require `high` minimum trust level | S11 |
| SG-11.10 | `setDuplicatePolicy`, `triggerReembedding`, `setEmbeddingProvider`, `setHybridWeights` require `manage_cognitive` permission | S11 |
| SG-11.11 | All query operations require `query_claims` permission | S11 |
| SG-11.12 | `hybridSearch` internal flow MUST follow the 11-step pipeline: governance gate, embed query, FTS5 over-retrieval (limit*3), vector over-retrieval (limit*3), classification filter, FSRS decay, hybrid score, domain weight overrides, sort+limit, emit event, append audit | S11 |
| SG-11.13 | `getDuplicatePolicy` MUST route to `config_store.get('duplicate_policy')` | S11 |
| SG-11.14 | `getStaleEmbeddings` MUST route to `embedding_registry.get_stale()` with staleness options | S11 |
| SG-11.15 | `getEmbeddingStats` MUST route to `embedding_registry.stats()` aggregating queue + provider state | S11 |
| SG-11.16 | `getHybridWeights` MUST route to `config_store.get('hybrid_weights')` returning tenant-scoped weights or default | S11 |

**Totals: 16 requirements**

---

## Section 12: Invariants

| ID | Requirement | Source |
|---|---|---|
| SG-12.1 | **Classification ceiling:** Search results MUST never include claims where `CLASSIFICATION_NUMERIC[claim.classification] > session.clearanceLevel`; enforcement MUST be at query layer (WHERE clause), not post-filter | S12 I1 |
| SG-12.2 | **Rate limiting:** All search operations MUST consume from `per_agent` and `per_session` rate limit pools under dimension `all_operations`; exceeding any `RateLimitPolicy` MUST produce `GOVERNANCE_REFUSAL` before query execution | S12 I2 |
| SG-12.3 | **Duplicate threshold floor:** `DuplicatePolicy.threshold` MUST NOT be set below 0.7; attempts MUST produce `INVALID_THRESHOLD` with `minimum: 0.7` | S12 I3 |
| SG-12.4 | **Provider change triggers stale marking:** When `setEmbeddingProvider` succeeds, ALL claims with embeddings from prior provider MUST be marked stale; system MUST NOT automatically trigger re-embedding | S12 I4 |
| SG-12.5 | **Stale embeddings remain searchable:** Claims with stale embeddings MUST participate in search with existing vectors; staleness is a quality signal, not an availability gate | S12 I5 |
| SG-12.6 | **Weight sum constraint:** `textWeight + vectorWeight` MUST equal exactly 1.0 within 1e-10 tolerance; violations MUST produce `INVALID_WEIGHTS` synchronously before persistence | S12 I6 |
| SG-12.7 | **Audit completeness:** Every search operation (success or failure) MUST produce exactly one `AuditLogEntry`; audit entry MUST be durably appended before success response | S12 I7 |
| SG-12.8 | **Branch isolation:** When `branchId` specified, results MUST be scoped to that branch plus trunk claims; specifying a `branchId` the agent does not own MUST produce `BRANCH_NOT_FOUND` | S12 I8 |
| SG-12.9 | **Embedding async guarantee:** Embedding operations MUST execute asynchronously via queue; they MUST never block `remember()`, `semanticSearch()`, or any synchronous operation; claims without embeddings MUST remain accessible via text search | S12 I9 |
| SG-12.10 | **Tenant isolation in duplicate detection:** `agent` scope compares only `sourceAgentId` matches; `tenant` compares within `session.tenantId`; `global` restricted to `verified` trust; cross-tenant at lower trust MUST produce `GOVERNANCE_REFUSAL` | S12 I10 |

**Totals: 10 requirements**

---

## Appendix A: Performance Targets

| ID | Requirement | Source |
|---|---|---|
| SG-A.1 | `textSearch` p95 latency MUST be < 15ms | App A |
| SG-A.2 | `semanticSearch` p95 latency MUST be < 50ms | App A |
| SG-A.3 | `hybridSearch` p95 latency MUST be < 80ms | App A |
| SG-A.4 | `checkDuplicate` p95 latency MUST be < 30ms | App A |
| SG-A.5 | `getEmbeddingStats` p95 latency MUST be < 5ms | App A |
| SG-A.6 | `triggerReembedding` p95 latency MUST be < 10ms (enqueue only) | App A |
| SG-A.7 | `setHybridWeights` p95 latency MUST be < 5ms | App A |
| SG-A.8 | `setEmbeddingProvider` p95 latency MUST be < 20ms | App A |

**Totals: 8 requirements**

---

## Grand Total

| Section | Count |
|---|---|
| Section 1: Purpose & Scope | 6 |
| Section 2: Shared Type References | 1 |
| Section 3: AgentSearchClient Interface | 14 |
| Section 4: Search Data Models (all subsections) | 49 |
| Section 5: Duplicate Detection Data Models | 20 |
| Section 6: Embedding Lifecycle Data Models | 31 |
| Section 7: Hybrid Ranking Data Models | 9 |
| Section 8: Search Events | 10 |
| Section 9: Error Types | 13 |
| Section 10: Rust Trait + Data Types + TC-21 Gaps | 44 |
| Section 11: Integration Map | 16 |
| Section 12: Invariants | 10 |
| Appendix A: Performance Targets | 8 |
| **GRAND TOTAL** | **231** |
