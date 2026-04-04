/**
 * API Surface public type definitions.
 * S ref: S2 (three-layer model), S3.3 (engine not framework), S14-S24 (10 system calls),
 *        S26 (conversation), S27 (streaming), S28 (structured output), S31 (HITL),
 *        S32 (observability), S34 (RBAC), S36 (rate limiting), S39 IP-4 (TypeScript API),
 *        S42 C-06/C-07 (frozen, independent instances)
 *
 * Phase: 4 (API Surface)
 * Implements: §6.1-§6.14 of the Synthesized SDD
 *
 * This file contains ALL public TypeScript types that consumers of the Limen engine
 * interact with. No implementation logic. Pure type definitions.
 *
 * Invariants enforced: I-04 (provider independence), I-13 (authorization completeness),
 *                      I-17 (governance boundary), I-26 (streaming equivalence),
 *                      I-27 (conversation integrity), I-28 (pipeline determinism)
 * Failure modes defended: FM-02 (cost explosion), FM-06 (provider dependency),
 *                         FM-10 (tenant data leakage), FM-13 (unbounded autonomy)
 */

import type {
  TenantId, AgentId, MissionId, TaskId,
  EventId, ArtifactId, SessionId, Permission,
  MissionContractId, Result,
} from '../../kernel/interfaces/index.js';

// Re-export branded ID types that consumers need
export type {
  TenantId, UserId, AgentId, MissionId, TaskId,
  EventId, ArtifactId, SessionId, MissionContractId,
} from '../../kernel/interfaces/index.js';

// Phase 4: CCP input/output types for consumer-facing ClaimApi
import type {
  ClaimCreateInput, AssertClaimOutput,
  RelationshipCreateInput, RelateClaimsOutput,
  ClaimQueryInput, ClaimQueryResult,
  RetractClaimInput,
  SearchClaimInput, SearchClaimResult,
  RetractionReason,
} from '../../claims/interfaces/claim_types.js';

// Phase 1: Convenience API types
import type {
  CognitiveConfig,
  RememberOptions, RememberResult,
  RecallOptions, BeliefView,
  ReflectEntry, ReflectResult,
  SearchOptions, SearchResult,
} from '../convenience/convenience_types.js';

// Phase 5: Cognitive API types
import type { CognitiveNamespace } from '../cognitive/cognitive_api.js';

// Phase 8: Plugin and Exchange types
import type {
  LimenPlugin, LimenEventName, LimenEventHandler,
} from '../../plugins/plugin_types.js';
import type {
  ExportOptions, LimenExportDocument, ImportOptions, ImportResult,
} from '../../exchange/exchange_types.js';

// Phase 9: Security types for consumer-facing ConsentApi
import type {
  ConsentRecord, ConsentCreateInput,
} from '../../security/security_types.js';

// Phase 10: Governance classification types for consumer-facing GovernanceApi
import type {
  ErasureRequest, ErasureCertificate,
  ComplianceExportOptions, Soc2AuditPackage,
  ClassificationRule, ProtectedPredicateRule,
} from '../../governance/classification/governance_types.js';

// Phase 4: WMP input/output types for consumer-facing WorkingMemoryApi
import type {
  WriteWorkingMemoryInput, WriteWorkingMemoryOutput,
  ReadWorkingMemoryInput, ReadWorkingMemoryOutput,
  DiscardWorkingMemoryInput, DiscardWorkingMemoryOutput,
} from '../../working-memory/interfaces/wmp_types.js';

// Re-export CCP/WMP types so consumers can construct inputs
export type {
  ClaimCreateInput, AssertClaimOutput,
  RelationshipCreateInput, RelateClaimsOutput,
  ClaimQueryInput, ClaimQueryResult,
  RetractClaimInput,
  SearchClaimInput, SearchClaimResult,
} from '../../claims/interfaces/claim_types.js';

export type {
  WriteWorkingMemoryInput, WriteWorkingMemoryOutput,
  ReadWorkingMemoryInput, ReadWorkingMemoryOutput,
  DiscardWorkingMemoryInput, DiscardWorkingMemoryOutput,
} from '../../working-memory/interfaces/wmp_types.js';

// Phase 9: Security types
export type {
  ConsentRecord, ConsentCreateInput, ConsentBasis, ConsentStatus,
  SecurityPolicy, PiiCategory, PiiAction, SecurityErrorCode,
  ContentScanResult, PiiScanResult, InjectionScanResult,
} from '../../security/security_types.js';

// Phase 10: Governance types
export type {
  ClassificationLevel, ClassificationRule, ClassificationResult,
  ProtectedPredicateRule, ErasureRequest, ErasureCertificate,
  Soc2AuditPackage, Soc2ControlEvidence, Soc2Statistics,
  ComplianceExportOptions, GovernanceConfig, GovernanceErrorCode,
} from '../../governance/classification/governance_types.js';

// Phase 11: Vector Search types
export type {
  EmbeddingProvider, VectorConfig, StoredEmbedding,
  DuplicateCandidate, DuplicateCheckResult,
  SearchMode, HybridScore, HybridWeights,
  VectorErrorCode, EmbeddingStats,
} from '../../vector/vector_types.js';

// Phase 1: Convenience API types
export type {
  CognitiveConfig,
  RememberOptions, RememberResult,
  RecallOptions, BeliefView,
  ReflectEntry, ReflectResult,
  ConvenienceErrorCode, EvidenceRef,
  ForgetOptions,
  SearchOptions, SearchResult, SearchErrorCode,
  // Phase 3: Cognitive Metabolism types
  FreshnessLabel, FreshnessThresholds,
  StabilityConfig, AccessTrackerConfig,
} from '../convenience/convenience_types.js';

// Phase 5: Cognitive API types
export type { CognitiveNamespace } from '../cognitive/cognitive_api.js';
export type { CognitiveHealthReport, CognitiveHealthConfig } from '../../cognitive/health.js';

// Phase 12: Cognitive Engine types
export type {
  SelfHealingConfig, SelfHealingEvent,
  ConsolidationOptions, ConsolidationResult, ConsolidationLogEntry, ConflictResolution,
  ImportanceScore, ImportanceWeights,
  ConnectionSuggestion,
  NarrativeSnapshot, NarrativeThread,
  VerificationResult, VerificationProvider,
  CognitiveErrorCode,
} from '../../cognitive/cognitive_types.js';

// Phase 8: Plugin and Exchange types
export type {
  LimenPlugin, LimenEventName, LimenEventHandler, LimenEvent,
  PluginMeta, PluginContext, PluginApi, PluginLogger,
  PluginErrorCode,
} from '../../plugins/plugin_types.js';
export type {
  ExportOptions, ExportFormat,
  LimenExportDocument, ExportedClaim, ExportedRelationship, ExportedEvidenceRef,
  ExportMetadata,
  ImportOptions, ImportResult, ImportError, ImportDedup,
  ExchangeErrorCode,
} from '../../exchange/exchange_types.js';

// Sprint 7: Consumer-facing ClaimApi — no conn/ctx required (DC-P4-406, C-SEC-05)
export interface ClaimApi {
  assertClaim(input: ClaimCreateInput): Result<AssertClaimOutput>;
  relateClaims(input: RelationshipCreateInput): Result<RelateClaimsOutput>;
  queryClaims(input: ClaimQueryInput): Result<ClaimQueryResult>;
  /** Phase 1 prerequisite: Retract a claim (active -> retracted, audited per I-03). */
  retractClaim(input: RetractClaimInput): Result<void>;
  /** Phase 2: Full-text search over claim content using FTS5. Not a new system call. */
  searchClaims(input: SearchClaimInput): Result<SearchClaimResult>;
}

// Sprint 7: Consumer-facing WorkingMemoryApi — no conn/ctx required (DC-P4-406, C-SEC-05)
export interface WorkingMemoryApi {
  write(input: WriteWorkingMemoryInput): Result<WriteWorkingMemoryOutput>;
  read(input: ReadWorkingMemoryInput): Result<ReadWorkingMemoryOutput>;
  discard(input: DiscardWorkingMemoryInput): Result<DiscardWorkingMemoryOutput>;
}

// Phase 10: Consumer-facing GovernanceApi — no conn/ctx required
export interface GovernanceApi {
  /** Phase 10 §10.4: Execute GDPR erasure with certificate generation. I-P10-20. */
  erasure(request: ErasureRequest): Result<ErasureCertificate>;
  /** Phase 10 §10.5: Generate SOC 2 audit export. I-P10-30. */
  exportAudit(options: ComplianceExportOptions): Result<Soc2AuditPackage>;
  /** Phase 10 §10.2: Add classification rule. */
  addRule(rule: Omit<ClassificationRule, 'id' | 'createdAt'>): Result<ClassificationRule>;
  /** Phase 10 §10.2: Remove classification rule. */
  removeRule(ruleId: string): Result<void>;
  /** Phase 10 §10.2: List all classification rules. */
  listRules(): Result<readonly ClassificationRule[]>;
  /** Phase 10 §10.3: Add protected predicate rule. */
  protectPredicate(rule: Omit<ProtectedPredicateRule, 'id' | 'createdAt'>): Result<ProtectedPredicateRule>;
  /** Phase 10 §10.3: List protected predicate rules. */
  listProtectedPredicates(): Result<readonly ProtectedPredicateRule[]>;
}

// Phase 9: Consumer-facing ConsentApi — no conn/ctx required
export interface ConsentApi {
  /** Register a new consent record. Audited per I-P9-23. */
  register(input: ConsentCreateInput): Result<ConsentRecord>;
  /** Revoke consent. Terminal transition. Audited per I-P9-23. */
  revoke(id: string): Result<ConsentRecord>;
  /** Check if active consent exists for a data subject + scope. I-P9-22: expiry computed on read. */
  check(dataSubjectId: string, scope: string): Result<ConsentRecord | null>;
  /** List all consent records for a data subject. I-P9-22: expiry computed on read. */
  list(dataSubjectId: string): Result<readonly ConsentRecord[]>;
}

// ============================================================================
// §6.1: Configuration Types (S39 IP-4, S3.3)
// ============================================================================

/**
 * S39 IP-4, S3.3: Limen engine configuration.
 * Passed to createLimen(). Produces an independent frozen instance.
 */
export interface LimenConfig {
  /** S3.6: Data directory path. All engine state lives here. */
  readonly dataDir: string;

  /** S39 IP-1: LLM provider configurations */
  readonly providers?: readonly ProviderConfig[];

  /** S34, S3.7: Tenancy configuration */
  readonly tenancy?: {
    readonly mode: 'single' | 'multi';
    readonly isolation?: 'row-level' | 'database';
  };

  /** I-11: Master encryption key for vault operations */
  readonly masterKey: Buffer;

  /** S25.2: Worker pool configuration */
  readonly substrate?: {
    readonly maxWorkers?: number;
    readonly schedulerPolicy?: 'deadline' | 'fair-share' | 'budget-aware';
  };

  /** S30: Offline embedding configuration */
  readonly offline?: {
    readonly embeddings?: boolean;
    readonly queueSize?: number;
    readonly syncOnReconnect?: boolean;
  };

  /** S31: Default HITL configuration */
  readonly hitl?: HitlConfig;

  /** DL-5: Safety gate configuration */
  readonly safety?: {
    readonly enabled?: boolean;          // default: true
    readonly jitterEnabled?: boolean;    // T-8 anti-probing
  };

  /** S27: Default timeout for chat/infer calls (ms). Default: 60000. */
  readonly defaultTimeoutMs?: number;

  /** S36: Rate limiting overrides */
  readonly rateLimiting?: {
    readonly apiCallsPerMinute?: number;     // default: 100
    readonly emitEventPerMinute?: number;    // default: 10
    readonly maxConcurrentStreams?: number;   // default: 50
  };

  /** FM-12: Failover policy */
  readonly failoverPolicy?: 'degrade' | 'allow-overdraft' | 'block';

  /**
   * Phase 1: Cognitive configuration for the convenience API.
   * Controls remember/recall/forget/connect/reflect behavior.
   */
  readonly cognitive?: CognitiveConfig;

  /**
   * Phase 4 §4.5, C.8: RBAC enforcement flag.
   * When true, all operations require valid agent role via requirePermission().
   * When false (default), RBAC checks pass through (dormant per §3.7).
   * CONSTITUTIONAL: Security boundary activation.
   * I-P4-10: Default false. I-P4-11: When true, enforces.
   */
  readonly requireRbac?: boolean;

  /**
   * Phase 4 §4.1, A.3: Enable structural conflict detection on assertion.
   * When true (default), asserting a claim with same subject+predicate+different value
   * as an existing active claim creates a 'contradicts' relationship.
   * I-P4-06: Synchronous with assertion.
   */
  readonly autoConflict?: boolean;

  /**
   * Phase 4 §4.3: Cascade retraction penalty configuration.
   * Phase 4 has no configurable settings — multipliers are CONSTITUTIONAL.
   * This field exists for future Phase 12 (Cognitive Engine) extensions.
   */
  readonly cascade?: Record<string, never>;

  /**
   * Phase 8 §8.1: Plugins to install during construction.
   * Installed in order before Object.freeze().
   * Destroyed in reverse order during shutdown().
   * I-P8-01: Must be before freeze.
   */
  readonly plugins?: readonly LimenPlugin[];

  /**
   * Phase 8 §8.1: Per-plugin configuration.
   * Keys are plugin names. Values passed to PluginContext.config.
   */
  readonly pluginConfig?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;

  /**
   * CF-021: Structured logging callback.
   * Limen calls this with structured events during operation.
   * Default: no-op (zero behavioral change for existing consumers).
   * S ref: §3.3 (engine, not framework — consumer provides logging implementation)
   */
  readonly logger?: LimenLogger;

  /**
   * Phase 9 §9: Security policy configuration.
   * Controls PII detection, prompt injection defense, poisoning defense.
   * I-P9-50: Default policy is non-breaking (tag/warn, not reject).
   * I-P9-51: Immutable after construction.
   */
  readonly security?: import('../../security/security_types.js').SecurityPolicy;

  /**
   * Phase 11: Vector search configuration.
   * Enables semantic search, hybrid ranking, and duplicate detection.
   * sqlite-vec is an optional peer dependency -- Limen degrades gracefully without it.
   * I-P11-01: Core features work without this configuration.
   */
  readonly vector?: import('../../vector/vector_types.js').VectorConfig;

  /**
   * Phase 12: Self-healing configuration.
   * Controls automatic retraction of derived claims when parent claims are retracted.
   * Default: enabled=true, threshold=0.1, maxDepth=5.
   */
  readonly selfHealing?: import('../../cognitive/cognitive_types.js').SelfHealingConfig;

  /**
   * Phase 12: External verification provider.
   * LLM-based claim verification. Advisory only — never auto-mutates.
   * I-P12-50: verify() returns result; caller decides what to do.
   */
  readonly verificationProvider?: import('../../cognitive/cognitive_types.js').VerificationProvider | null;

  /**
   * Phase 8: Debug mode.
   * When true, preserves original JS stack traces and error messages in LimenError
   * instead of redacting them. MUST be false in production — exposes internal details.
   * Default: false.
   */
  readonly debug?: boolean;
}

/**
 * CF-021: Structured log event.
 * Events are typed for reliable processing by the consumer's logging infrastructure.
 */
export interface LimenLogEvent {
  /** Log level */
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  /** Event category (e.g., 'migration', 'init', 'shutdown', 'health') */
  readonly category: string;
  /** Human-readable message */
  readonly message: string;
  /** Structured context data */
  readonly context?: Record<string, unknown>;
}

/**
 * CF-021: Logger callback type.
 * Consumer provides this to receive structured log events from Limen.
 */
export type LimenLogger = (event: LimenLogEvent) => void;

/**
 * S39 IP-1: Provider configuration.
 * No provider SDK imported. Raw HTTP only (S3.2).
 */
export interface ProviderConfig {
  readonly type: string;
  readonly baseUrl: string;
  readonly models: readonly string[];
  readonly apiKeyEnvVar?: string;
  readonly maxConcurrent?: number;
  readonly costPerInputToken?: number;
  readonly costPerOutputToken?: number;
}

/**
 * S31: HITL configuration.
 * Controls human-in-the-loop behavior per agent or globally.
 */
export interface HitlConfig {
  readonly mode: HitlMode;
  readonly timeout?: number;
  readonly autoApproveAfter?: number;
  readonly sampleRate?: number;
}

/**
 * S31: HITL modes as type.
 */
export type HitlMode = 'approval-required' | 'correction-loop' | 'observation-learning' | 'batch-review';

// ============================================================================
// §6.3: The Limen Public API (C-07: Object.freeze)
// ============================================================================

/**
 * S3.3, C-07, C-06: The frozen, immutable Limen engine instance.
 * Returned by createLimen(). Object.freeze'd recursively.
 * Two calls produce independent instances (C-06).
 *
 * Every method on this object either:
 *   (a) checks RBAC (I-13) then delegates to orchestration, or
 *   (b) reads from kernel/substrate for health/metrics
 *
 * No method mutates state directly. All mutations go through orchestration.
 *
 * S ref: C-07 (Object.freeze), S39 IP-4 (frozen API), SD-06 (synthesis decision)
 */
export interface Limen {
  // -- Conversation API (S27, S48 backward-compat) --

  /**
   * S27, S48: Send a chat message using the default agent.
   * Backward-compatible shorthand: limen.chat('message')
   * Creates/reuses an ephemeral default session internally.
   * Returns ChatResult synchronously (SD-01); fields are async.
   */
  chat(message: string | ChatMessage, options?: ChatOptions): ChatResult;

  /**
   * S28, S48: Request structured output.
   * Pre-computes budget, validates schema, retries on failure.
   */
  infer<T>(options: InferOptions<T>): Promise<InferResult<T>>;

  // -- Session Management (S26) --

  /**
   * S26: Create or resume a session.
   * Sessions scope conversations to a tenant+agent pair.
   */
  session(options: SessionOptions): Promise<Session>;

  // -- Agent Management (S12, DL-2) --

  readonly agents: AgentApi;

  // -- Mission Management (S15-S24 via orchestration) --

  readonly missions: MissionApi;

  // -- Claim Management (SC-11, SC-12, SC-13 via CCP) --
  // Phase 4: Facade-only exposure (DC-P4-406, C-SEC-05)

  readonly claims: ClaimApi;

  // -- Working Memory Management (SC-14, SC-15, SC-16 via WMP) --
  // Phase 4: Facade-only exposure (DC-P4-406, C-SEC-05)

  readonly workingMemory: WorkingMemoryApi;

  // -- RBAC Management (S34) --

  readonly roles: RolesApi;

  // -- Observability (S32) --

  /**
   * S32.4: Get engine health status.
   * Three-state: healthy (all + LLM), degraded (no LLM), unhealthy (critical failure).
   */
  health(): Promise<HealthStatus>;

  /**
   * S32.2: In-process metrics.
   */
  readonly metrics: MetricsApi;

  // -- Data Management (I-02) --

  readonly data: DataApi;

  // -- Library Mode Context --

  /**
   * Set the default agent identity for single-tenant library mode.
   *
   * In library mode (single-tenant), the OperationContext has no agentId
   * by default. Library consumers that register agents can call this
   * to activate attribution: all subsequent assertClaim and relateClaims
   * calls will carry this agentId in the OperationContext.
   *
   * Pattern: createLimen() → agents.register() → setDefaultAgent(agent.id)
   *
   * No-op in multi-tenant mode (agentId is per-session).
   */
  setDefaultAgent(agentId: AgentId): void;

  // -- Phase 5: Cognitive Intelligence Namespace --

  /**
   * Phase 5 §5.3: Cognitive intelligence namespace.
   * Provides knowledge health diagnostics.
   * Forward-compatible with Phase 12 (consolidate, verify, narrative).
   * PA Ruling: limen.cognitive.health() (not limen.health.cognitive()).
   */
  readonly cognitive: CognitiveNamespace;

  // -- Phase 9: Consent Management --

  /**
   * Phase 9 §9.3: Data subject consent tracking.
   * Framework stub — provides CRUD for consent records.
   * Enforcement is Phase 10. This phase stores records and audits mutations.
   * I-P9-23: All mutations produce audit entries.
   */
  readonly consent: ConsentApi;

  // -- Phase 10: Governance Suite --

  /**
   * Phase 10: Governance API.
   * Classification rules, protected predicates, GDPR erasure, SOC 2 export.
   */
  readonly governance: GovernanceApi;

  // -- Phase 1: Convenience API (remember/recall/forget/connect/reflect) --

  /**
   * Phase 1 §1.1/§1.2: Store a belief.
   *
   * 3-param form (primary): explicit subject, predicate, value.
   * 1-param form (sugar): auto-generates subject from content hash,
   *   predicate defaults to 'observation.note'.
   *
   * Confidence capped at maxAutoConfidence (default 0.7) unless
   * groundingMode is 'evidence_path' with non-empty evidenceRefs.
   */
  remember(subject: string, predicate: string, value: string, options?: RememberOptions): Result<RememberResult>;
  remember(text: string, options?: RememberOptions): Result<RememberResult>;

  /**
   * Phase 1 §1.3: Retrieve beliefs.
   *
   * Returns simplified BeliefView objects.
   * Excludes superseded claims by default.
   * Both parameters optional -- omitting both returns recent claims.
   */
  recall(subject?: string, predicate?: string, options?: RecallOptions): Result<readonly BeliefView[]>;

  /**
   * Phase 1 §1.4: Retract a belief (governed, audited).
   *
   * The retracted claim remains in the database with status='retracted'.
   * All derived claims retain their relationships for audit continuity.
   */
  forget(claimId: string, reason?: RetractionReason): Result<void>;

  /**
   * Phase 1 §1.5: Create a relationship between two claims.
   *
   * Types: 'supports', 'contradicts', 'supersedes', 'derived_from'.
   * Directed: from claimId1 to claimId2.
   */
  connect(claimId1: string, claimId2: string, type: 'supports' | 'contradicts' | 'supersedes' | 'derived_from'): Result<void>;

  /**
   * Phase 1 §1.6: Batch-store categorized learnings.
   *
   * Each entry becomes a claim with predicate 'reflection.<category>'.
   * Subject auto-generated from content hash.
   * Runs in a transaction -- all-or-nothing.
   */
  reflect(entries: readonly ReflectEntry[]): Result<ReflectResult>;

  /**
   * Phase 1 §1.7: Get system prompt instructions for agents.
   *
   * Returns a multi-line string teaching an AI agent how to use Limen.
   * Pure function -- no I/O, deterministic output.
   */
  promptInstructions(): string;

  /**
   * Phase 2 §2.4: Full-text search across claim content.
   *
   * Uses FTS5 for efficient text search with BM25 relevance ranking.
   * Supports CJK content via trigram secondary index.
   * Results ranked by combined score: -bm25() * confidence.
   *
   * Tenant-isolated. Retracted claims excluded. Superseded excluded by default.
   */
  search(query: string, options?: SearchOptions): Result<readonly SearchResult[]>;

  // -- Phase 11: Vector Search --

  /**
   * Phase 11 §11.2: Process pending embedding queue.
   * Calls the configured embedding provider for pending claims.
   * No-op if vector config is not provided or sqlite-vec is unavailable.
   * I-P11-50: Idempotent. I-P11-51: Failure isolation.
   */
  embedPending(): Promise<import('../../kernel/interfaces/common.js').Result<{ processed: number; failed: number }>>;

  /**
   * Phase 11 §11.5: Check if a claim would be a duplicate.
   * Requires vector config with provider. Returns Promise since provider is async.
   * I-P11-40: threshold. I-P11-41: tenant isolation. I-P11-42: disabled check.
   */
  checkDuplicate(subject: string, predicate: string, value: string): Promise<import('../../kernel/interfaces/common.js').Result<import('../../vector/vector_types.js').DuplicateCheckResult>>;

  /**
   * Phase 11 §11.3: Semantic search using vector similarity.
   * Async because it calls the embedding provider for the query.
   * Falls back to fulltext if sqlite-vec unavailable.
   */
  semanticSearch(query: string, options?: Omit<SearchOptions, 'mode'>): Promise<import('../../kernel/interfaces/common.js').Result<readonly SearchResult[]>>;

  /**
   * Phase 11: Get embedding statistics.
   * Returns counts and configuration info. Works even without sqlite-vec.
   */
  embeddingStats(): import('../../kernel/interfaces/common.js').Result<import('../../vector/vector_types.js').EmbeddingStats>;

  // -- Phase 8: Event Hooks (§8.5) --

  /**
   * Phase 8 §8.5: Subscribe to Limen events.
   * Consumer-facing event names use colon separators.
   * Returns subscription ID for later unsubscription.
   *
   * I-P8-10: Maps to internal EventBus.
   * I-P8-11: Handler errors are isolated.
   * I-P8-12: Works on frozen instance (closure-captured).
   */
  on(event: LimenEventName, handler: LimenEventHandler): string;

  /**
   * Phase 8 §8.5: Unsubscribe from events.
   */
  off(subscriptionId: string): void;

  // -- Phase 8: Import/Export (§8.3, §8.4) --

  /**
   * Phase 8 §8.3: Export knowledge to a format.
   * Returns serialized content as string.
   *
   * I-P8-20: JSON roundtrip preserves fidelity.
   * I-P8-24: Version field is '1.0.0'.
   * I-P8-26: Works on frozen instance.
   */
  exportData(options: ExportOptions): Result<string>;

  /**
   * Phase 8 §8.4: Import knowledge from JSON.
   *
   * I-P8-21: New IDs assigned.
   * I-P8-22: Dedup by content.
   * I-P8-23: Relationship rebinding.
   * I-P8-26: Works on frozen instance.
   */
  importData(document: LimenExportDocument, options?: ImportOptions): Result<ImportResult>;

  // -- Lifecycle --

  /**
   * S3.4, I-05: Graceful shutdown.
   * Checkpoints WAL, flushes pending webhooks, archives metrics.
   * All active sessions closed. Active streams terminated with error chunk.
   * SD-06: shutdown() on instance rather than separate destroyLimen().
   */
  shutdown(): Promise<void>;
}

// ============================================================================
// §6.4: Chat Types (S27)
// ============================================================================

/**
 * S27: Chat message input.
 */
export interface ChatMessage {
  readonly role: 'user';
  readonly content: string;
  readonly participantId?: string;       // S26.4: multi-participant
}

/**
 * S27: Chat options.
 */
export interface ChatOptions {
  /** S27: Enable streaming. Default: true. */
  readonly stream?: boolean;
  /** S27: AbortSignal for cancellation. */
  readonly signal?: AbortSignal;
  /** S27: Per-call timeout override (ms). Default: 60000. */
  readonly timeoutMs?: number;
  /** S31: Per-call HITL override. */
  readonly hitl?: HitlConfig;
  /** S37 DL-1: Routing strategy override. */
  readonly routing?: 'auto' | 'quality' | 'speed' | 'explicit';
  /** S37 DL-1: Explicit model selection (when routing = 'explicit'). */
  readonly model?: string;
  /** S27: Maximum tokens for generation. */
  readonly maxTokens?: number;
  /** S12: Agent name override (default: session agent). */
  readonly agent?: string;
  /** S26: Reuse existing session. */
  readonly sessionId?: SessionId;
}

/**
 * S27: ChatResult -- same structure for streaming and non-streaming (I-26).
 * Returned synchronously by chat() (SD-01).
 * Non-streaming: text resolves immediately, stream yields one chunk.
 * Streaming: text resolves on completion, stream yields progressively.
 */
export interface ChatResult {
  /** S27: Full response text. Resolves when generation completes. */
  readonly text: Promise<string>;
  /**
   * S27: Progressive stream of chunks.
   * AsyncIterable with cooperative backpressure (4KB buffer, 30s stall timeout).
   */
  readonly stream: AsyncIterable<StreamChunk>;
  /** S27, S32: Response metadata. Resolves when pipeline completes. */
  readonly metadata: Promise<ResponseMetadata>;
}

/**
 * S27: Individual stream chunk -- discriminated union (SD-03).
 * 8 variants covering: pipeline status, content, tools, safety, HITL, completion, errors.
 */
export type StreamChunk =
  | { readonly type: 'status'; readonly phase: PipelinePhase; readonly durationMs: number }
  | { readonly type: 'content_delta'; readonly delta: string }
  | { readonly type: 'tool_call'; readonly toolName: string; readonly toolInput: Record<string, unknown> }
  | { readonly type: 'tool_result'; readonly toolName: string; readonly result: unknown }
  | { readonly type: 'safety_halt'; readonly gate: string; readonly severity: 'warning' | 'critical' }
  | { readonly type: 'approval_required'; readonly approvalId: string; readonly content: string }
  | { readonly type: 'done'; readonly finishReason: FinishReason }
  | { readonly type: 'error'; readonly code: string; readonly message: string };

/**
 * I-28: Pipeline phases -- fixed sequence, no extension.
 */
export type PipelinePhase =
  | 'perception'
  | 'retrieval'
  | 'context_assembly'
  | 'pre_safety'
  | 'generation'
  | 'post_safety'
  | 'learning'
  | 'evaluation'
  | 'audit';

/**
 * S27: Finish reasons for a generation (SD-04).
 * 8 values including timeout (distinct from cancelled).
 */
export type FinishReason =
  | 'stop' | 'length' | 'tool_use' | 'content_filter'
  | 'cancelled' | 'timeout' | 'budget_exceeded' | 'safety_halt';

/**
 * S27, S32: Response metadata (SD-05: hybrid structure).
 */
export interface ResponseMetadata {
  /** S32.1: Trace ID for this request */
  readonly traceId: string;
  /** S26: Session context */
  readonly sessionId: SessionId;
  readonly conversationId: string;
  readonly turnNumber: number;
  /** S27: Time to first token in milliseconds */
  readonly ttftMs: number;
  /** S27: Total generation time in milliseconds */
  readonly totalMs: number;
  /** S32.2: Token consumption */
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cost: number;
  };
  /** S37 DL-1: Provider and model used */
  readonly provider: {
    readonly id: string;
    readonly model: string;
  };
  /** I-28: Per-phase latency breakdown */
  readonly phases: ReadonlyArray<{
    readonly phase: PipelinePhase;
    readonly durationMs: number;
  }>;
  /** S29: Techniques applied during this interaction */
  readonly techniquesApplied: number;
  /** I-54: Token cost of injected techniques (for systemOverhead accounting) */
  readonly techniqueTokenCost: number;
  /** S37 DL-5: Safety gate results */
  readonly safetyGates: ReadonlyArray<{
    readonly gate: string;
    readonly result: 'pass' | 'warning' | 'critical';
  }>;
  /** S31: HITL status if applicable */
  readonly hitlStatus?: 'approved' | 'edited' | 'rejected' | 'pending_approval' | 'auto_approved';
}

// ============================================================================
// §6.5: Structured Output Types (S28)
// ============================================================================

/**
 * S28: Structured output options for limen.infer().
 * Schema can be JSON Schema object or Zod-compatible schema (SD-09).
 */
export interface InferOptions<T> {
  /** S12: Agent name (resolved to AgentId internally). */
  readonly agent?: string;
  /** S28: Typed input for the inference call. */
  readonly input: unknown;
  /** S28: Output schema -- JSON Schema or structural ZodSchema (SD-09). */
  readonly outputSchema: JsonSchema | ZodSchema<T>;
  /**
   * S28: Maximum retry count on validation failure.
   * Default: 2. Validation errors appended to prompt on retry.
   */
  readonly maxRetries?: number;
  /**
   * S28: Strict mode. Default: true.
   * Rejects z.any(), z.unknown(), non-discriminated z.union(), z.optional() on required fields.
   */
  readonly strict?: boolean;
  /** S27: AbortSignal for cancellation. */
  readonly signal?: AbortSignal;
  /** S27: Per-call timeout override (ms). */
  readonly timeoutMs?: number;
  /** S37 DL-1: Routing strategy. */
  readonly routing?: 'auto' | 'quality' | 'speed' | 'explicit';
  /** S37 DL-1: Explicit model (when routing = 'explicit'). */
  readonly model?: string;
  /** S26: Session context. */
  readonly sessionId?: SessionId;
}

/**
 * S28: Opaque JSON Schema type (draft-07).
 */
export type JsonSchema = Record<string, unknown>;

/**
 * S28: Zod-compatible structural schema type (SD-09).
 * Any object with parse() and safeParse() methods.
 * No runtime Zod dependency (I-01 preserved).
 */
export interface ZodSchema<T> {
  parse(data: unknown): T;
  safeParse(data: unknown): { success: boolean; data?: T; error?: unknown };
}

/**
 * S28: Structured output result.
 */
export interface InferResult<T> {
  /** S28: Parsed, schema-validated output. */
  readonly data: T;
  /** S28: Raw LLM output before parsing (SD-11). */
  readonly raw: string;
  /** S28: Number of retries performed (0 if first attempt succeeded). */
  readonly retryCount: number;
  /** S32.2: Token usage across all attempts. */
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly estimatedCostUsd: number;
  };
  /** S32: Response metadata. */
  readonly metadata: ResponseMetadata;
}

/**
 * S28: Schema validation error (thrown when all retries exhausted).
 */
export interface SchemaValidationError {
  readonly code: 'SCHEMA_VALIDATION_FAILED';
  readonly message: string;
  readonly validationErrors: ReadonlyArray<{
    readonly path: string;
    readonly expected: string;
    readonly received: string;
  }>;
  readonly retryCount: number;
  readonly rawOutput: string;
}

// ============================================================================
// §6.6: Session Types (S26)
// ============================================================================

/**
 * S26: Session creation/resumption options (SD-07).
 */
export interface SessionOptions {
  /** S34: Tenant identifier. Required in multi-tenant mode. */
  readonly tenantId?: TenantId;
  /** S12: Agent name to bind to this session. */
  readonly agentName: string;
  /** S34: User identity and role for RBAC. */
  readonly user?: {
    readonly id?: string;
    readonly role?: string;
  };
  /** S31: Per-session HITL override. */
  readonly hitl?: HitlConfig;
  /** S26, SD-07: Resume an existing session by ID. */
  readonly resumeSessionId?: SessionId;
}

/**
 * S26: Active session handle.
 */
export interface Session {
  readonly id: SessionId;
  readonly agentId: AgentId;
  readonly tenantId: TenantId | null;
  readonly conversationId: string;
  readonly createdAt: string;

  /** S27: Chat within this session. */
  chat(message: string | ChatMessage, options?: Omit<ChatOptions, 'sessionId'>): ChatResult;

  /** S28: Infer within this session. */
  infer<T>(options: Omit<InferOptions<T>, 'sessionId'>): Promise<InferResult<T>>;

  /** S26.3: Fork the conversation at the given turn number (copy-on-branch). */
  fork(atTurn: number): Promise<Session>;

  /** S26: Get conversation history. */
  history(): Promise<readonly ConversationTurnView[]>;

  /** S26: Close session. Finalizes conversation. */
  close(): Promise<void>;
}

/**
 * S26: View of a conversation turn (no internal fields exposed).
 */
export interface ConversationTurnView {
  readonly turnNumber: number;
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly content: string;
  readonly timestamp: string;
  readonly tokenCount: number;
  readonly isSummary: boolean;
}

// ============================================================================
// §6.7: Mission API Types (S15-S24, SD-10)
// ============================================================================

/**
 * S14-S24: Public mission API wrapping the 10 system calls.
 * RBAC + rate limiting before delegation to orchestration.
 * S ref: S14, I-13, I-17
 */
export interface MissionApi {
  /** SC-1 (S15): Create a mission. Returns MissionHandle (SD-10). */
  create(options: MissionCreateOptions): Promise<MissionHandle>;

  /** S6: Get an existing mission by ID. */
  get(id: MissionId): Promise<MissionHandle | null>;

  /** S6: List missions with optional filters. */
  list(filter?: MissionFilter): Promise<readonly MissionView[]>;
}

/**
 * S15: Mission creation options (consumer-facing).
 * Maps to ProposeMissionInput internally.
 */
export interface MissionCreateOptions {
  readonly agent: string;
  readonly objective: string;
  readonly successCriteria?: string[];
  readonly scopeBoundaries?: string[];
  readonly constraints: {
    readonly tokenBudget: number;
    readonly deadline: string;
    readonly capabilities?: string[];
    readonly maxTasks?: number;
    readonly maxChildren?: number;
    readonly maxDepth?: number;
  };
  readonly deliverables?: ReadonlyArray<{
    readonly type: string;
    readonly name: string;
  }>;
  readonly parentMissionId?: MissionId;
  /** Phase 0A: Governing mission contract reference (BC-030, BC-092) */
  readonly contractId?: MissionContractId;
}

/**
 * S6, SD-10: Mission handle with methods for monitoring and control.
 * All methods delegate to L2 orchestration via RBAC.
 */
export interface MissionHandle {
  readonly id: MissionId;
  readonly state: MissionState;
  readonly budget: {
    readonly allocated: number;
    readonly consumed: number;
    readonly remaining: number;
  };

  // -- System Call Wrappers --

  /** SC-2 (S16): Propose a task graph. */
  proposeTaskGraph(input: TaskGraphInput): Promise<TaskGraphOutput>;

  /** SC-3 (S17): Propose task execution. */
  proposeTaskExecution(input: TaskExecutionInput): Promise<TaskExecutionOutput>;

  /** SC-4 (S18): Create an artifact. */
  createArtifact(input: ArtifactCreateInput): Promise<ArtifactCreateOutput>;

  /** SC-5 (S19): Read an artifact. */
  readArtifact(input: ArtifactReadInput): Promise<ArtifactReadOutput>;

  /** SC-6 (S20): Emit an event. */
  emitEvent(input: EventEmitInput): Promise<EventEmitOutput>;

  /** SC-7 (S21): Request capability execution. */
  requestCapability(input: CapabilityRequestInput): Promise<CapabilityRequestOutput>;

  /** SC-8 (S22): Request additional budget. */
  requestBudget(input: BudgetRequestInput): Promise<BudgetRequestOutput>;

  /** SC-9 (S23): Submit mission result. */
  submitResult(input: ResultSubmitInput): Promise<ResultSubmitOutput>;

  /** SC-10 (S24): Respond to a checkpoint. */
  respondCheckpoint(input: CheckpointResponseInput): Promise<CheckpointResponseOutput>;

  // -- Convenience Methods --

  /** S10: Subscribe to mission events. */
  on(event: string, handler: (payload: Record<string, unknown>) => void): void;

  /** S23: Wait for mission completion. */
  wait(): Promise<MissionResult>;

  /** S6: Pause mission execution. */
  pause(): Promise<void>;

  /** S6: Resume paused mission. */
  resume(): Promise<void>;

  /** S6: Cancel mission. */
  cancel(): Promise<void>;
}

/**
 * S6: Mission lifecycle states.
 */
export type MissionState =
  | 'CREATED' | 'PLANNING' | 'EXECUTING' | 'REVIEWING'
  | 'COMPLETED' | 'PAUSED' | 'FAILED' | 'CANCELLED'
  | 'DEGRADED' | 'BLOCKED';

/**
 * S23: Mission result.
 */
export interface MissionResult {
  readonly missionId: MissionId;
  readonly state: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly summary: string;
  readonly confidence: number;
  readonly artifacts: ReadonlyArray<{
    readonly id: ArtifactId;
    readonly name: string;
    readonly type: string;
    readonly version: number;
  }>;
  readonly unresolvedQuestions: readonly string[];
  readonly followupRecommendations: readonly string[];
  readonly resourcesConsumed: {
    readonly tokens: number;
    readonly wallClockMs: number;
    readonly llmCalls: number;
  };
}

// -- System Call I/O Types (consumer-facing wrappers) --

export interface TaskGraphInput {
  readonly missionId: MissionId;
  readonly tasks: readonly TaskSpec[];
  readonly dependencies: readonly { readonly from: string; readonly to: string }[];
  readonly objectiveAlignment: string;   // I-24: mandatory
}

export interface TaskSpec {
  readonly id: string;
  readonly description: string;
  readonly executionMode: 'deterministic' | 'stochastic' | 'hybrid';
  readonly estimatedTokens: number;
  readonly capabilitiesRequired?: string[];
}

export interface TaskGraphOutput {
  readonly graphId: string;
  readonly planVersion: number;
  readonly taskCount: number;
  readonly validationWarnings: readonly { readonly code: string; readonly message: string }[];
}

export interface TaskExecutionInput {
  readonly taskId: TaskId;
  readonly executionMode: 'deterministic' | 'stochastic' | 'hybrid';
  readonly environmentRequest: {
    readonly capabilities: string[];
    readonly timeout: number;
  };
}

export interface TaskExecutionOutput {
  readonly executionId: string;
  readonly scheduledAt: string;
  readonly workerId: string;
}

export interface ArtifactCreateInput {
  readonly missionId: MissionId;
  readonly name: string;
  readonly type: 'report' | 'data' | 'code' | 'analysis' | 'image' | 'raw';
  readonly format: 'markdown' | 'json' | 'csv' | 'python' | 'sql' | 'html';
  readonly content: string | Buffer;
  readonly sourceTaskId: TaskId;
  readonly parentArtifactId?: ArtifactId;
  readonly metadata?: Record<string, unknown>;
}

export interface ArtifactCreateOutput {
  readonly artifactId: ArtifactId;
  readonly version: number;
}

export interface ArtifactReadInput {
  readonly artifactId: ArtifactId;
  readonly version?: number | 'latest';
}

export interface ArtifactReadOutput {
  readonly artifact: {
    readonly id: ArtifactId;
    readonly version: number;
    readonly name: string;
    readonly type: string;
    readonly format: string;
    readonly content: string | Buffer;
    readonly lifecycleState: 'ACTIVE' | 'SUMMARIZED' | 'ARCHIVED';
    readonly metadata: Record<string, unknown>;
  };
}

export interface EventEmitInput {
  readonly eventType: string;
  readonly missionId: MissionId;
  readonly payload: Record<string, unknown>;
  readonly propagation?: 'up' | 'down' | 'local';
}

export interface EventEmitOutput {
  readonly eventId: EventId;
  readonly delivered: boolean;
}

export interface CapabilityRequestInput {
  readonly capabilityType: string;
  readonly parameters: Record<string, unknown>;
  readonly missionId: MissionId;
  readonly taskId: TaskId;
}

export interface CapabilityRequestOutput {
  readonly result: unknown;
  readonly resourcesConsumed: {
    readonly tokens?: number;
    readonly time?: number;
    readonly compute?: number;
    readonly storage?: number;
  };
}

export interface BudgetRequestInput {
  readonly missionId: MissionId;
  readonly amount: {
    readonly tokens?: number;
    readonly time?: number;
    readonly compute?: number;
    readonly storage?: number;
  };
  readonly justification: string;
}

export interface BudgetRequestOutput {
  readonly approved: boolean;
  readonly allocated: {
    readonly tokens?: number;
    readonly time?: number;
    readonly compute?: number;
    readonly storage?: number;
  };
  readonly source: 'parent' | 'human';
}

export interface ResultSubmitInput {
  readonly missionId: MissionId;
  readonly summary: string;
  readonly confidence: number;
  readonly artifactIds: readonly ArtifactId[];
  readonly unresolvedQuestions?: string[];
  readonly followupRecommendations?: string[];
}

export interface ResultSubmitOutput {
  readonly resultId: string;
  readonly missionState: 'COMPLETED' | 'REVIEWING';
}

export interface CheckpointResponseInput {
  readonly checkpointId: string;
  readonly assessment: string;
  readonly confidence: number;
  readonly proposedAction: 'continue' | 'replan' | 'escalate' | 'abort';
  readonly planRevision?: TaskGraphInput;
  readonly escalationReason?: string;
}

export interface CheckpointResponseOutput {
  readonly action: 'continue' | 'replan_accepted' | 'replan_rejected' | 'escalated' | 'aborted';
  readonly reason: string;
}

export interface MissionView {
  readonly id: MissionId;
  readonly state: MissionState;
  readonly objective: string;
  readonly parentId: MissionId | null;
  readonly agentId: AgentId;
  readonly planVersion: number;
  readonly budget: {
    readonly allocated: number;
    readonly consumed: number;
    readonly remaining: number;
  };
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface MissionFilter {
  readonly state?: MissionState;
  readonly agentName?: string;
  readonly parentId?: MissionId;
  readonly limit?: number;
  readonly offset?: number;
}

// ============================================================================
// §6.8: Agent Management Types (S12, DL-2)
// ============================================================================

/**
 * S12, DL-2: Agent management API.
 */
export interface AgentApi {
  /** S12: Register a new agent. Permission: 'create_agent' */
  register(config: AgentRegistration): Promise<AgentView>;

  /** DL-2: Pause an active agent. Permission: 'modify_agent' */
  pause(name: string): Promise<void>;

  /** DL-2: Resume a paused agent. Permission: 'modify_agent' */
  resume(name: string): Promise<void>;

  /** DL-2: Retire an agent permanently. Permission: 'delete_agent' */
  retire(name: string): Promise<void>;

  /** S12: Get agent by name. */
  get(name: string): Promise<AgentView | null>;

  /** S12: List all agents for current tenant. */
  list(): Promise<readonly AgentView[]>;

  /** UC-4: Create a typed agent pipeline for sequential processing. */
  pipeline(stages: readonly PipelineStage[]): AgentPipeline;

  /** I-09: Promote agent trust level. Permission: 'modify_agent' */
  promote(name: string, options?: TrustPromotionOptions): Promise<AgentView>;

  /** I-09: Record a safety violation against an agent. Permission: 'modify_agent' */
  recordViolation(name: string, violation: SafetyViolationInput): Promise<AgentView>;
}

/** I-09: Options for trust promotion */
export interface TrustPromotionOptions {
  /** Target trust level. If omitted, promotes to next level. */
  readonly targetLevel?: 'probationary' | 'trusted' | 'admin';
  /** Actor type performing the promotion. Default: 'system'. */
  readonly actorType?: 'system' | 'human';
  /** Actor ID (user/system identifier). */
  readonly actorId?: string;
  /** Reason for promotion. */
  readonly reason?: string;
}

/** I-09: Input for recording a safety violation */
export interface SafetyViolationInput {
  readonly violationType: 'content_policy' | 'prompt_injection' | 'data_exfiltration' | 'unauthorized_access' | 'rate_abuse' | 'safety_bypass' | 'other';
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly description: string;
  readonly evidence?: Record<string, unknown>;
}

export interface AgentRegistration {
  readonly name: string;
  readonly systemPrompt?: string;
  readonly domains?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly template?: string;            // S29.9: cold-start template
  readonly hitl?: HitlConfig;
}

export interface AgentView {
  readonly id: AgentId;
  readonly name: string;
  readonly version: number;
  readonly trustLevel: 'untrusted' | 'probationary' | 'trusted' | 'admin';
  readonly status: 'registered' | 'active' | 'paused' | 'retired';
  readonly capabilities: readonly string[];
  readonly domains: readonly string[];
  readonly createdAt: string;
}

export interface PipelineStage {
  readonly agent: string;
  readonly input?: string;
  readonly escalate?: boolean;
}

export interface AgentPipeline {
  execute(input: Record<string, unknown>): Promise<MissionResult>;
}

// ============================================================================
// §6.10: RBAC Management Types (S34)
// ============================================================================

/**
 * S34: RBAC management API.
 */
export interface RolesApi {
  /** S34: Create a custom role. Permission: 'manage_roles' */
  create(name: string, permissions: readonly Permission[]): Promise<string>;

  /** S34: Assign role to a user or agent. Permission: 'manage_roles' */
  assign(principalType: 'user' | 'agent', principalId: string, roleId: string): Promise<void>;

  /** S34: Revoke role. Permission: 'manage_roles' */
  revoke(principalType: 'user' | 'agent', principalId: string, roleId: string): Promise<void>;
}

// Re-export Permission from kernel for consumer use
export type { Permission } from '../../kernel/interfaces/index.js';

// ============================================================================
// §6.11: Observability Types (S32)
// ============================================================================

/**
 * S32.4: Health check response.
 */
export interface HealthStatus {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly uptime_ms: number;
  readonly subsystems: {
    readonly database: SubsystemHealth;
    readonly audit: SubsystemHealth;
    readonly providers: SubsystemHealth;
    readonly sessions: SubsystemHealth;
    readonly missions: SubsystemHealth;
    readonly learning: SubsystemHealth;
    readonly memory: SubsystemHealth;
  };
  readonly latency: Record<string, { readonly p50: number; readonly p99: number }>;
  readonly throughput: {
    readonly requests_per_second: number;
    readonly active_streams: number;
    readonly error_rate_pct: number;
    readonly write_queue_depth: number;
    readonly active_missions: number;
  };
}

export interface SubsystemHealth {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly detail?: string;
}

/**
 * S32.2: Metrics API (SD-08: structured JavaScript object).
 */
export interface MetricsApi {
  /** S32.2: Get current metrics snapshot. SEC-018: Tenant-scoped when tenantId provided. */
  snapshot(tenantId?: string): MetricsSnapshot;
}

export interface MetricsSnapshot {
  readonly limen_requests_total: number;
  readonly limen_request_duration_ms: HistogramData;
  readonly limen_tokens_total: { readonly input: number; readonly output: number };
  readonly limen_tokens_cost_usd: number;
  readonly limen_memory_retrieval_ms: HistogramData;
  readonly limen_provider_ttft_ms: HistogramData;
  readonly limen_provider_errors: number;
  readonly limen_safety_violations: number;
  readonly limen_sessions_active: number;
  readonly limen_missions_active: number;
  readonly limen_learning_techniques: number;
  readonly limen_learning_cycles: number;
  readonly limen_audit_chain_valid: boolean;
  readonly limen_db_size_bytes: number;
  readonly limen_db_wal_size_bytes: number;
  readonly limen_stream_backpressure_events: number;
}

export interface HistogramData {
  readonly p50: number;
  readonly p99: number;
  readonly count: number;
  readonly sum: number;
}

// ============================================================================
// §6.12: Data Management Types (I-02)
// ============================================================================

export interface PurgeFilter {
  readonly userId?: string;
  readonly sessionId?: SessionId;
  readonly missionId?: MissionId;
  readonly olderThan?: string;
}

/**
 * I-02: User data ownership. All data accessible, exportable, deletable.
 */
export interface DataApi {
  /** S3.6: Export entire engine state. Permission: 'purge_data' */
  export(outputPath: string): Promise<{ path: string; sizeBytes: number }>;

  /** I-02: Purge all data. Leaves zero traces. Permission: 'purge_data' */
  purgeAll(): Promise<void>;

  /** I-02: Selective purge. Permission: 'purge_data' */
  purge(filter: PurgeFilter): Promise<{ purged: number }>;

  /** GDPR: Purge ALL data for a specific tenant across all tenant-scoped tables. Permission: 'purge_data' */
  purgeByTenant(tenantId: string): Promise<{ purged: number }>;
}

// ============================================================================
// §6.13: Error Types (S39 IP-4, SD-02)
// ============================================================================

/**
 * S39 IP-4: Public API error (SD-02: thrown as exception).
 * Internal details (stack traces, SQL errors, file paths) are NEVER exposed.
 */
export interface LimenError extends Error {
  readonly code: LimenErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly cooldownMs?: number;          // for RATE_LIMITED
  readonly suggestion?: string;          // for TIMEOUT, SCHEMA_VALIDATION_FAILED
}

/**
 * All error codes traceable to spec sections.
 */
export type LimenErrorCode =
  // API surface
  | 'RATE_LIMITED'                       // S36
  | 'TIMEOUT'                           // S27
  | 'CANCELLED'                         // S27
  | 'UNAUTHORIZED'                      // I-13, S34
  | 'PROVIDER_UNAVAILABLE'              // FM-06, I-16
  | 'SCHEMA_VALIDATION_FAILED'          // S28
  | 'ENGINE_UNHEALTHY'                  // S32.4
  | 'SESSION_NOT_FOUND'                 // S26
  | 'INVALID_CONFIG'                    // S3.3
  | 'INVALID_INPUT'                     // CF-019, CF-028 (input validation at API boundary)
  // SC-1 through SC-10 error codes (pass-through from L2)
  | 'BUDGET_EXCEEDED'                   // S15, S16, S17, S22
  | 'DEPTH_EXCEEDED'                    // S15
  | 'CHILDREN_EXCEEDED'                 // S15
  | 'TREE_SIZE_EXCEEDED'                // S15
  | 'CAPABILITY_VIOLATION'              // S15, S16
  | 'AGENT_NOT_FOUND'                   // S15
  | 'DEADLINE_EXCEEDED'                 // S15
  | 'DELEGATION_CYCLE'                  // S15
  | 'CYCLE_DETECTED'                    // S16
  | 'TASK_LIMIT_EXCEEDED'               // S16
  | 'INVALID_DEPENDENCY'                // S16
  | 'MISSION_NOT_ACTIVE'                // S16, S18, S22, S23
  | 'PLAN_REVISION_LIMIT'               // S16
  | 'DEPENDENCIES_UNMET'                // S17
  | 'CAPABILITY_DENIED'                 // S17, S21
  | 'WORKER_UNAVAILABLE'                // S17
  | 'TASK_NOT_PENDING'                  // S17
  | 'STORAGE_EXCEEDED'                  // S18
  | 'ARTIFACT_LIMIT_EXCEEDED'           // S18
  | 'NOT_FOUND'                         // S19
  | 'ARCHIVED'                          // S19
  | 'INVALID_TYPE'                      // S20
  | 'MISSION_NOT_FOUND'                 // S20
  | 'SANDBOX_VIOLATION'                 // S21
  | 'PARENT_INSUFFICIENT'               // S22
  | 'HUMAN_APPROVAL_REQUIRED'           // S22
  | 'JUSTIFICATION_REQUIRED'            // S22
  | 'TASKS_INCOMPLETE'                  // S23
  | 'NO_ARTIFACTS'                      // S23
  | 'CHECKPOINT_EXPIRED'                // S24
  | 'INVALID_PLAN'                      // S24
  // Phase 0A governance error codes
  | 'LIFECYCLE_INVALID_TRANSITION'       // BC-070: Invalid lifecycle state transition
  | 'SUSPENSION_ACTIVE'                  // BC-060: Operation blocked by active suspension
  | 'SUSPENSION_NOT_FOUND'              // BC-060: Referenced suspension record not found
  | 'AUTHORITY_INSUFFICIENT'             // BC-080: Caller lacks required authority
  | 'AUTHORITY_SCOPE_EXCEEDED'          // BC-080: Action exceeds caller's authority scope
  | 'HARD_POLICY_VIOLATION'             // BC-080: Hard policy constraint violated
  | 'SOFT_POLICY_VIOLATION'             // BC-080: Soft policy constraint violated
  | 'DECISION_CONFLICT'                  // BC-060: Conflicting supervisor decision
  | 'CONTRACT_UNSATISFIED'              // BC-030: Mission contract criteria not met
  | 'HANDOFF_REJECTED'                   // BC-050: Handoff rejected by delegate
  | 'ATTEMPT_EXHAUSTED'                  // BC-011: Maximum retry attempts exhausted
  | 'TRACE_EMISSION_FAILED'             // BC-027: Trace event emission failure
  | 'EVAL_GATE_FAILED'                   // BC-095: Eval gate blocked completion
  | 'MANIFEST_TRUST_VIOLATION'          // BC-100: Capability manifest trust tier violation
  | 'RESUME_TOKEN_INVALID'              // BC-138: Resume token invalid or consumed
  | 'RESUME_TOKEN_EXPIRED'              // BC-136: Resume token expired
  | 'IDEMPOTENCY_CONFLICT';             // BC-133: Same idempotency key, different payload

// ============================================================================
// §6.14: Backpressure Types (S36)
// ============================================================================

/**
 * S36: Streaming backpressure configuration.
 * Cooperative backpressure via AsyncIterable.
 */
export interface BackpressureConfig {
  readonly bufferSizeBytes: number;        // default: 4096 (4KB per S36)
  readonly stallTimeoutMs: number;         // default: 30000 (30s per S27)
  readonly maxConcurrentStreams: number;    // default: 50 per tenant (S36)
}
