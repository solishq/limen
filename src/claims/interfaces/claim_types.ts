/**
 * CCP (Claim Protocol) interface types.
 * Spec ref: CCP v2.0 Design Source, Architecture Freeze CF-05/CF-12/CF-13
 *
 * Phase: v3.3.0 — Claim Protocol Truth Model
 * Status: FROZEN — interfaces defined before implementation.
 *
 * Implements: All TypeScript types for the Claim subsystem:
 *   §6 (Claim schema), §7 (Evidence model), §8 (Relationship model),
 *   §9 (Artifact junction), §10 (System calls SC-11/SC-12/SC-13),
 *   §11 (SC-4/SC-9 amendments), §12 (Canonical admission),
 *   §13 (Retention), §14 (Events),
 *   CF-05 (Grounding), CF-12 (Object Mutability), CF-13 (Audit Sufficiency)
 *
 * THE KERNEL NEVER REASONS. The kernel stores, validates structure, links,
 * and audits. CCP extends this to knowledge. Claims make knowledge a
 * first-class citizen without making Limen an intelligent system.
 */

import type {
  TenantId, AgentId, MissionId, TaskId, ArtifactId,
  Result, OperationContext,
} from '../../kernel/interfaces/index.js';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { TraceEmitter } from '../../kernel/interfaces/trace.js';

// ============================================================================
// Branded ID Types — CCP-specific
// ============================================================================

/** §6: Claim identifier — unique across all tenants */
export type ClaimId = string & { readonly __brand: 'ClaimId' };

/** §8: Relationship identifier — unique across all tenants */
export type RelationshipId = string & { readonly __brand: 'RelationshipId' };

// ============================================================================
// Enumerated Types — §6, §7, §8
// ============================================================================

/** §6: Claim object value types — determines validation rules */
export type ObjectType = 'string' | 'number' | 'boolean' | 'date' | 'json';

/**
 * §7: Evidence source types — polymorphic FK discriminator.
 * Each type maps to a different target table for FK validation:
 *   'memory'            → memory store (NOT IN v3.2 — forward obligation)
 *   'artifact'          → core_artifacts (ArtifactStore)
 *   'claim'             → claim_assertions (ClaimStore — self-referential)
 *   'capability_result' → capability result storage (NOT IN v3.2 — forward obligation)
 */
export type EvidenceType = 'memory' | 'artifact' | 'claim' | 'capability_result';

/** §8: Relationship types — directed edges between claims */
export type RelationshipType = 'supports' | 'contradicts' | 'supersedes' | 'derived_from';

/** §10.3: Archive mode for queries — controls visibility of archived claims */
export type ArchiveMode = 'exclude' | 'include' | 'only';

/** CF-05: Grounding mode — how claim truth is anchored */
export type GroundingMode = 'evidence_path' | 'runtime_witness';

/** §6: Claim epistemic status — one forward transition only */
export type ClaimStatus = 'active' | 'retracted';

/**
 * §7, AMB-CCP-01: Evidence source lifecycle state.
 * Initial value 'live'. Updated to 'tombstoned' when source is purged.
 */
export type SourceState = 'live' | 'tombstoned';

// ============================================================================
// Domain Objects — §14.1 (readonly, immutable content)
// ============================================================================

/**
 * §6, CCP-I1: Claim — the 9th core object in Limen.
 *
 * All content fields frozen at creation (CCP-I1). Two mutable fields:
 *   - status: one forward transition (active → retracted), audited atomically per I-03
 *   - archived: forward-only (false → true), audited atomically per I-03
 *
 * CF-12: Immutable content, governed status transitions.
 */
export interface Claim {
  /** §6: Unique identifier */
  readonly id: ClaimId;
  /** §6, AMB-CCP-02: Tenant scope — always derived from OperationContext via SC-11 */
  readonly tenantId: TenantId | null;
  /** §6: Subject URN — entity:<type>:<identifier>, case-sensitive */
  readonly subject: string;
  /** §6: Predicate namespace — <domain>.<property>, reserved: system.*, lifecycle.* */
  readonly predicate: string;
  /** §6: Object value with declared type */
  readonly object: { readonly type: ObjectType; readonly value: unknown };
  /** §6: Confidence score [0.0, 1.0] inclusive */
  readonly confidence: number;
  /** §6: Temporal anchor — independent of createdAt */
  readonly validAt: string;
  /** §6: Agent that asserted this claim */
  readonly sourceAgentId: AgentId;
  /** §6: Mission context — set from SC-11 input.missionId */
  readonly sourceMissionId: MissionId | null;
  /** §6: Task context — set from SC-11 input.taskId */
  readonly sourceTaskId: TaskId | null;
  /** §6, CF-05: Grounding mode used at assertion — immutable */
  readonly groundingMode: GroundingMode;
  /** §6, CF-05: Runtime witness data — present when groundingMode='runtime_witness', immutable */
  readonly runtimeWitness: RuntimeWitnessInput | null;
  /** §6, CCP-I2: Epistemic status — mutable, one forward transition */
  readonly status: ClaimStatus;
  /** §6, CCP-I11: Archive flag — forward-only (false → true) */
  readonly archived: boolean;
  /** §6: Creation timestamp */
  readonly createdAt: string;
}

/**
 * §13, CCP-I10: Tombstone identity preservation.
 * Hard deletion of claim identity never permitted. Content fields NULLed.
 * id, tenantId, status, archived, purgedAt, purgeReason survive.
 */
export interface ClaimTombstone {
  readonly id: ClaimId;
  readonly tenantId: TenantId | null;
  readonly status: ClaimStatus;
  readonly archived: boolean;
  readonly purgedAt: string;
  readonly purgeReason: string;
}

/**
 * §7, CCP-I5: Evidence reference — provenance chain link.
 * Polymorphic FK: type determines target table, id is the foreign key.
 * Immutable after creation. sourceState tracks source availability.
 * AMB-CCP-01: sourceState is lifecycle metadata, not content mutation.
 */
export interface ClaimEvidence {
  /** §7: Owning claim */
  readonly claimId: ClaimId;
  /** §7: Source type discriminator */
  readonly evidenceType: EvidenceType;
  /** §7: Source identifier (foreign key in target table) */
  readonly evidenceId: string;
  /** §7, AMB-CCP-01: Source lifecycle — 'live' at creation, 'tombstoned' on purge */
  readonly sourceState: SourceState;
  /** §7: Reference creation timestamp */
  readonly createdAt: string;
}

/**
 * §8, CCP-I6: Directed relationship between claims.
 * Both claims must exist + same tenant. fromClaimId must be active.
 * toClaimId may be any status (audit continuity). No self-reference.
 * Append-only — no modification, no deletion.
 */
export interface ClaimRelationship {
  /** §8: Relationship identifier */
  readonly id: RelationshipId;
  /** §8: Tenant scope */
  readonly tenantId: TenantId | null;
  /** §8: Source claim (must be active) */
  readonly fromClaimId: ClaimId;
  /** §8: Target claim (any status) */
  readonly toClaimId: ClaimId;
  /** §8: Relationship type */
  readonly type: RelationshipType;
  /** §8: Agent that declared this relationship */
  readonly declaredByAgentId: AgentId;
  /** §8: Mission context */
  readonly missionId: MissionId;
  /** §8: Creation timestamp */
  readonly createdAt: string;
}

/**
 * §9, AMB-CCP-04: Claim-artifact junction row.
 * Created via two paths:
 *   1. SC-4 create_artifact with claims field
 *   2. SC-11 assert_claim with evidenceType='artifact'
 * Both paths create junction rows to enable "what claims reference this artifact?" queries.
 */
export interface ClaimArtifactRef {
  /** §9: Referenced artifact */
  readonly artifactId: ArtifactId;
  /** §9: Referencing claim */
  readonly claimId: ClaimId;
  /** §9: Creation timestamp */
  readonly createdAt: string;
}

// ============================================================================
// Input Types — SC-11, SC-12, SC-13, SC-4 Amendment
// ============================================================================

/**
 * §7: Evidence reference for claim creation.
 * Type + id pair validated via polymorphic FK lookup.
 */
export interface EvidenceRef {
  /** §7: Source type — determines validation target */
  readonly type: EvidenceType;
  /** §7: Source identifier — FK in type's target table */
  readonly id: string;
}

/**
 * §10.1, SC-11: Claim creation input.
 * Derived from CCP SC-11 with CF-05 grounding extension.
 */
export interface ClaimCreateInput {
  /** §6: Subject URN — entity:<type>:<identifier>, strict 3-segment */
  readonly subject: string;
  /** §6: Predicate — <domain>.<property>, strict 2-segment, reserved: system.*, lifecycle.* */
  readonly predicate: string;
  /** §6: Object value with declared type */
  readonly object: { readonly type: ObjectType; readonly value: unknown };
  /** §10.1: Confidence score [0.0, 1.0] inclusive */
  readonly confidence: number;
  /** §6: Temporal anchor — ISO 8601 strict, independent of createdAt */
  readonly validAt: string;
  /** §10.1: Mission context — maps to sourceMissionId */
  readonly missionId: MissionId;
  /** §10.1: Task context — maps to sourceTaskId */
  readonly taskId: TaskId | null;
  /** §7, CCP-I5: Evidence references — min 1 for evidence-path, min 0 for runtime-witness */
  readonly evidenceRefs: readonly EvidenceRef[];
  /** CF-05: Grounding mode — how claim truth is anchored */
  readonly groundingMode: GroundingMode;
  /** CF-05, §6: Runtime witness data — required when groundingMode = 'runtime_witness' */
  readonly runtimeWitness?: RuntimeWitnessInput;
  /** DC-CCP-307: Optional idempotency key for duplicate detection on retry */
  readonly idempotencyKey?: ClaimIdempotencyInput;
}

/**
 * §10.4: Retraction input.
 * Authorization derived from OperationContext (sourceAgentId or admin).
 */
export interface RetractClaimInput {
  /** §14.4: Target claim */
  readonly claimId: ClaimId;
  /** §14.4: Required reason for retraction (non-empty) */
  readonly reason: string;
}

/**
 * SC-12: Relationship creation input.
 */
export interface RelationshipCreateInput {
  /** SC-12: Source claim (must be active) */
  readonly fromClaimId: ClaimId;
  /** SC-12: Target claim (any status) */
  readonly toClaimId: ClaimId;
  /** SC-12: Relationship type */
  readonly type: RelationshipType;
  /** SC-12: Mission context */
  readonly missionId: MissionId;
}

/**
 * §10.3, SC-13: Claim query input.
 * status=null → unfiltered (returns both active and retracted).
 * Filters support trailing wildcard (*) for prefix matching.
 */
export interface ClaimQueryInput {
  /** SC-13: Subject filter — exact match or trailing wildcard ("entity:company:*") */
  readonly subject?: string | null;
  /** SC-13: Predicate filter — exact match or trailing wildcard ("financial.*") */
  readonly predicate?: string | null;
  /** SC-13, AMB-10: Status filter — null = unfiltered, default 'active' when omitted */
  readonly status?: ClaimStatus | null;
  /** SC-13: Minimum confidence threshold */
  readonly minConfidence?: number | null;
  /** SC-13: Source agent filter */
  readonly sourceAgentId?: AgentId | null;
  /** SC-13: Source mission filter */
  readonly sourceMissionId?: MissionId | null;
  /** SC-13: Temporal range — from (inclusive) */
  readonly validAtFrom?: string | null;
  /** SC-13: Temporal range — to (inclusive) */
  readonly validAtTo?: string | null;
  /** §14.7: Archive mode — 'exclude' (default), 'include', 'only' */
  readonly archiveMode?: ArchiveMode;
  /** SC-13: Include evidence array per claim */
  readonly includeEvidence?: boolean;
  /** SC-13: Include relationships array per claim */
  readonly includeRelationships?: boolean;
  /** SC-13: Maximum results (max CLAIM_QUERY_MAX_LIMIT) */
  readonly limit?: number;
  /** SC-13: Pagination offset */
  readonly offset?: number;
}

/**
 * §11, SC-4 Amendment: Claim input for artifact creation.
 * Subset of ClaimCreateInput WITHOUT missionId/taskId,
 * which are inherited from the SC-4 call context.
 * groundingMode is per-claim (not inherited from context) per AMB-CCP-03.
 */
export interface ClaimInput {
  /** §6: Subject URN */
  readonly subject: string;
  /** §6: Predicate namespace */
  readonly predicate: string;
  /** §6: Object value */
  readonly object: { readonly type: ObjectType; readonly value: unknown };
  /** §10.1: Confidence [0.0, 1.0] */
  readonly confidence: number;
  /** §6: Temporal anchor */
  readonly validAt: string;
  /** §7: Evidence references (artifact evidence auto-added) */
  readonly evidenceRefs: readonly EvidenceRef[];
  /** CF-05: Grounding mode — per-claim, not inherited from SC-4 context */
  readonly groundingMode: GroundingMode;
  /** CF-05: Runtime witness — required when groundingMode='runtime_witness' */
  readonly runtimeWitness?: RuntimeWitnessInput;
}

// ============================================================================
// Output Types — SC-11, SC-12, SC-13
// ============================================================================

/** SC-11: assert_claim output */
export interface AssertClaimOutput {
  /** The created claim */
  readonly claim: Claim;
  /** CF-05: Grounding result */
  readonly grounding: GroundingResult;
}

/** SC-12: relate_claims output */
export interface RelateClaimsOutput {
  /** The created relationship */
  readonly relationship: ClaimRelationship;
}

/**
 * SC-13: query_claims result — paginated.
 */
export interface ClaimQueryResult {
  /** Matching claims */
  readonly claims: readonly ClaimQueryResultItem[];
  /** Total matching count (before pagination) */
  readonly total: number;
  /** Whether more results exist beyond offset+limit */
  readonly hasMore: boolean;
}

/**
 * SC-13: Individual claim in query results.
 * Includes optional evidence/relationships and computed properties.
 */
export interface ClaimQueryResultItem {
  /** The claim */
  readonly claim: Claim;
  /** Optional evidence array (when includeEvidence=true) */
  readonly evidence?: readonly ClaimEvidence[];
  /** Optional relationships array (when includeRelationships=true) */
  readonly relationships?: readonly ClaimRelationship[];
  /** §14.7: Computed — claim has been superseded by a relationship */
  readonly superseded: boolean;
  /** §14.7: Computed — claim has been contradicted by a relationship */
  readonly disputed: boolean;
}

// ============================================================================
// Grounding Types — CF-05, CCP-LI-03, CCP-LI-05
// ============================================================================

/**
 * CF-05, CCP-I4: Grounding evaluation result.
 * Contains proof structure for audit sufficiency (CCP-I9).
 */
export interface GroundingResult {
  /** CF-05: Whether grounding succeeded */
  readonly grounded: boolean;
  /** CF-05: Mode used for grounding */
  readonly mode: GroundingMode;
  /** CF-05: Traversal proof for evidence-path mode */
  readonly traversalPath?: GroundingTraversalPath;
  /** CF-05: Witness binding for runtime-witness mode */
  readonly witnessBinding?: RuntimeWitnessInput;
  /** CF-05: Error reason when grounding fails */
  readonly failureReason?: string;
}

/**
 * CF-05: Evidence-path traversal proof.
 * Records the path from claim to non-claim anchor.
 */
export interface GroundingTraversalPath {
  /** Number of hops to anchor */
  readonly hops: number;
  /** Maximum hops allowed */
  readonly maxHops: number;
  /** Ordered path: each step is (claimId, evidenceType, evidenceId) */
  readonly steps: readonly GroundingStep[];
  /** The terminal anchor (non-claim evidence) */
  readonly anchor: { readonly type: EvidenceType; readonly id: string } | null;
}

/** CF-05: Single step in grounding traversal */
export interface GroundingStep {
  /** Claim at this level */
  readonly claimId: ClaimId;
  /** Evidence type at this step */
  readonly evidenceType: EvidenceType;
  /** Evidence ID at this step */
  readonly evidenceId: string;
}

/**
 * §6, CF-05: Runtime witness data — structured witness binding.
 * Required when groundingMode='runtime_witness'.
 * Witness data is immutable once asserted (CCP-I1).
 * Must be replay-stably bound per CF-05 — deterministically serializable.
 */
export interface RuntimeWitnessInput {
  /** CF-05: Discriminator for the witness source type */
  readonly witnessType: string;
  /** CF-05: Key-value pairs of observed runtime state values */
  readonly witnessedValues: Record<string, unknown>;
  /** CF-05: When the witness observation was recorded (ISO 8601) */
  readonly witnessTimestamp: string;
}

// ============================================================================
// Evidence Source Validation — Polymorphic FK Dependencies
// ============================================================================

/**
 * Polymorphic FK validation interface for evidence sources.
 * CCP needs to validate that evidence references point to existing entities.
 *
 * v3.2 STATUS:
 *   - 'artifact'          → ArtifactStore exists (core_artifacts table)
 *   - 'claim'             → ClaimStore self-referential (claim_assertions table)
 *   - 'memory'            → NO STORE EXISTS IN v3.2 (forward obligation)
 *   - 'capability_result' → NO PERSISTENCE IN v3.2 (forward obligation)
 */
export interface EvidenceSourceValidator {
  /**
   * Validate that an evidence source exists and is accessible.
   * Returns ok:true if source exists within the tenant scope.
   * Returns error with EVIDENCE_NOT_FOUND if source doesn't exist.
   * Returns error with EVIDENCE_CROSS_TENANT if source is in a different tenant.
   *
   * @param taskId - Optional task context for memory evidence scoping.
   *   Memory evidence requires task context to scope WM lookups.
   *   Absent for non-memory evidence types (ignored).
   *   Sprint 1 additive parameter — existing callers unaffected.
   */
  exists(
    conn: DatabaseConnection,
    evidenceType: EvidenceType,
    evidenceId: string,
    tenantId: TenantId | null,
    taskId?: string | null,
  ): Result<boolean>;
}

// ============================================================================
// Store Interfaces — §14.1, §14.3, §14.5, §14.6
// ============================================================================

/**
 * §14.1: Claim store — primary CRUD for claims.
 * All methods accept DatabaseConnection as first parameter.
 */
export interface ClaimStore {
  /** SC-11: Create a claim with validated fields and evidence */
  create(conn: DatabaseConnection, ctx: OperationContext, input: ClaimCreateInput): Result<Claim>;
  /** §14.1: Get a claim by ID within tenant scope */
  get(conn: DatabaseConnection, claimId: ClaimId, tenantId: TenantId | null): Result<Claim>;
  /** §14.4: Retract a claim (active → retracted, audited atomically per I-03) */
  retract(conn: DatabaseConnection, ctx: OperationContext, claimId: ClaimId, reason: string): Result<void>;
  /** §14.4: Archive a claim (archived = false → true, audited per I-03) */
  archive(conn: DatabaseConnection, claimId: ClaimId, tenantId: TenantId | null): Result<void>;
  /** §14.8: Tombstone a claim — NULL content fields, preserve identity */
  tombstone(conn: DatabaseConnection, claimId: ClaimId, tenantId: TenantId | null, reason: string): Result<void>;
  /** SC-13: Query claims with filters, pagination, computed properties */
  query(conn: DatabaseConnection, tenantId: TenantId | null, filters: ClaimQueryInput): Result<ClaimQueryResult>;

  /**
   * DC-CCP-704, Binding 7: Get a claim that has been tombstoned — returns typed ClaimTombstone.
   * Only identity + metadata fields survive tombstoning (CCP-I10). Content fields are NULLed.
   * This method MUST return ClaimTombstone, never Claim, for tombstoned records.
   * Prevents accidental content retrieval from purged claims.
   */
  getAsTombstone(conn: DatabaseConnection, claimId: ClaimId, tenantId: TenantId | null): Result<ClaimTombstone | null>;

  /**
   * Phase 2: Full-text search over claim content using FTS5.
   * NOT a new system call. Internal method on ClaimStore.
   *
   * Invariants: I-P2-01 (sync), I-P2-02 (tenant isolation), I-P2-03 (retracted exclusion),
   *             I-P2-05 (score monotonicity), I-P2-06 (error containment)
   */
  search(conn: DatabaseConnection, tenantId: TenantId | null, input: SearchClaimInput): Result<SearchClaimResult>;
}

/**
 * §14.3, I-30: Evidence reference store.
 * Append-only for reference identity fields.
 * AMB-12: sourceState is lifecycle metadata, mutable.
 */
export interface ClaimEvidenceStore {
  /** §14.3: Create evidence references for a claim (batch insert) */
  createBatch(conn: DatabaseConnection, claimId: ClaimId, evidenceRefs: readonly EvidenceRef[]): Result<void>;
  /** §14.3: Get all evidence for a claim */
  getByClaimId(conn: DatabaseConnection, claimId: ClaimId): Result<readonly ClaimEvidence[]>;
  /** §14.8: Mark evidence rows as tombstoned when source is purged */
  markSourceTombstoned(conn: DatabaseConnection, evidenceType: EvidenceType, evidenceId: string): Result<number>;
  /** §14.3: Get evidence rows referencing a specific source */
  getBySourceId(conn: DatabaseConnection, evidenceType: EvidenceType, evidenceId: string): Result<readonly ClaimEvidence[]>;
}

/**
 * §14.5, I-31: Relationship store.
 * Append-only — no modification, no deletion.
 */
export interface ClaimRelationshipStore {
  /** SC-12: Create a relationship between claims */
  create(conn: DatabaseConnection, ctx: OperationContext, input: RelationshipCreateInput): Result<ClaimRelationship>;
  /** §14.5: Get relationships for a claim by direction */
  getByClaimId(conn: DatabaseConnection, claimId: ClaimId, direction: 'from' | 'to'): Result<readonly ClaimRelationship[]>;
  /** §14.5: Get relationships for a claim filtered by type and direction */
  getByType(conn: DatabaseConnection, claimId: ClaimId, type: RelationshipType, direction: 'from' | 'to'): Result<readonly ClaimRelationship[]>;
  /** I-31: Count outgoing relationships (for limit enforcement) */
  countOutgoing(conn: DatabaseConnection, claimId: ClaimId): Result<number>;
}

/**
 * §14.6: Claim-artifact junction store.
 * Both paths create junction rows (AMB-04).
 */
export interface ClaimArtifactRefStore {
  /** §14.6: Create junction rows for artifact-claim associations (batch) */
  createBatch(conn: DatabaseConnection, artifactId: ArtifactId, claimIds: readonly ClaimId[]): Result<void>;
  /** §14.6: Get all claim IDs referencing an artifact */
  getByArtifactId(conn: DatabaseConnection, artifactId: ArtifactId): Result<readonly ClaimId[]>;
  /** §14.6: Get all artifact IDs referenced by a claim */
  getByClaimId(conn: DatabaseConnection, claimId: ClaimId): Result<readonly ArtifactId[]>;
}

// ============================================================================
// Handler Interfaces — SC-11, SC-12, SC-13, Retraction, Grounding
// ============================================================================

/**
 * SC-11: assert_claim handler.
 * Orchestrates: validation → grounding → store → evidence → audit → event.
 */
export interface AssertClaimHandler {
  execute(conn: DatabaseConnection, ctx: OperationContext, input: ClaimCreateInput): Result<AssertClaimOutput>;
}

/**
 * §14.4: retract_claim handler.
 * Orchestrates: authorization → validation → retract → audit → events.
 * "Only the source agent or a user with admin role can retract."
 */
export interface RetractClaimHandler {
  execute(conn: DatabaseConnection, ctx: OperationContext, input: RetractClaimInput): Result<void>;
}

/**
 * SC-12: relate_claims handler.
 * Orchestrates: validation → store → audit → event.
 */
export interface RelateClaimsHandler {
  execute(conn: DatabaseConnection, ctx: OperationContext, input: RelationshipCreateInput): Result<RelateClaimsOutput>;
}

/**
 * SC-13: query_claims handler.
 * Orchestrates: validation → query → computed properties → pagination.
 */
export interface QueryClaimsHandler {
  execute(conn: DatabaseConnection, ctx: OperationContext, input: ClaimQueryInput): Result<ClaimQueryResult>;
}

/**
 * CF-05: Grounding validator.
 * Evidence-path: validates depth within N hops via visited-set traversal.
 * Runtime-witness: validates witness structure and binds to audit record.
 */
export interface GroundingValidator {
  validate(
    conn: DatabaseConnection,
    claimId: ClaimId,
    evidenceRefs: readonly EvidenceRef[],
    mode: GroundingMode,
    maxHops: number,
    runtimeWitness?: RuntimeWitnessInput,
  ): Result<GroundingResult>;

  /**
   * DC-CCP-117 (v1.1 CRITICAL): Validate with intermediate claim status check.
   * During evidence-path traversal, rejects if any intermediate claim in the
   * grounding chain has been retracted. Prevents epistemic contamination —
   * new claims must not be grounded through retracted evidence chains.
   *
   * @param conn - Database connection
   * @param claimId - The claim being grounded
   * @param evidenceRefs - Evidence references to traverse
   * @param mode - Grounding mode
   * @param maxHops - Maximum traversal depth
   * @param runtimeWitness - Optional witness for runtime_witness mode
   * @returns GroundingResult with failure if intermediate claim is retracted
   */
  validateWithRetractedCheck(
    conn: DatabaseConnection,
    claimId: ClaimId,
    evidenceRefs: readonly EvidenceRef[],
    mode: GroundingMode,
    maxHops: number,
    runtimeWitness?: RuntimeWitnessInput,
  ): Result<GroundingResult>;
}

// ============================================================================
// Claim System Facade — §14, C-07
// ============================================================================

/**
 * §14, C-07: ClaimSystem facade composing all CCP subsystems.
 * Object.freeze'd per C-07. Extends Limen's governance layer.
 */
export interface ClaimSystem {
  /** §14.1: Claim store */
  readonly store: ClaimStore;
  /** §14.3: Evidence reference store */
  readonly evidence: ClaimEvidenceStore;
  /** §14.5: Relationship store */
  readonly relationships: ClaimRelationshipStore;
  /** §14.6: Artifact-claim junction store */
  readonly artifactRefs: ClaimArtifactRefStore;
  /** SC-11: Assert claim handler */
  readonly assertClaim: AssertClaimHandler;
  /** §14.4: Retract claim handler */
  readonly retractClaim: RetractClaimHandler;
  /** SC-12: Relate claims handler */
  readonly relateClaims: RelateClaimsHandler;
  /** SC-13: Query claims handler */
  readonly queryClaims: QueryClaimsHandler;
  /** CF-05: Grounding validator */
  readonly grounding: GroundingValidator;
  /** Binding 3, DC-CCP-205: Lifecycle state projection */
  readonly lifecycleProjection: ClaimLifecycleProjection;
}

/**
 * Dependencies required by the ClaimSystem factory.
 * Includes existing v3.2 stores for polymorphic FK validation.
 */
export interface ClaimSystemDeps {
  /** Evidence source validation — polymorphic FK lookup */
  readonly evidenceValidator: EvidenceSourceValidator;
  /** Audit trail for I-03 atomic auditing */
  readonly audit: import('../../kernel/interfaces/audit.js').AuditTrail;
  /** Event bus for event emission */
  readonly eventBus: import('../../kernel/interfaces/events.js').EventBus;
  /** Binding 14, DC-CCP-501/502/503/511/512/513/514: Constitutional trace emission for 4 CCP trace events */
  readonly traceEmitter: TraceEmitter;
  /** Rate limiter for per-agent call calls */
  readonly rateLimiter?: import('../../kernel/interfaces/rate_limiter.js').RateLimiter;
  /** WMP Trigger 4: pre-emission boundary capture. Absent when task has no WMP namespace. */
  readonly wmpCapture?: WmpPreEmissionCapture;
  /** DC-CCP-118: Scope validation for capability_result evidence. Optional — when absent, no scope check. */
  readonly capabilityResultScopeValidator?: CapabilityResultScopeValidator;
  /** Hard Stop #7: Injectable clock for deterministic temporal logic. */
  readonly time: import('../../kernel/interfaces/time.js').TimeProvider;
}

/**
 * WMP Trigger 4 interface for pre-emission boundary capture.
 * Called by SC-11 before claim row is committed.
 * Per WMP §6.4: capture failure blocks the emission.
 */
export interface WmpPreEmissionCapture {
  /** Create pre-emission snapshot. Returns capture ID and sourcing status. */
  capture(
    conn: DatabaseConnection,
    taskId: TaskId,
  ): Result<WmpCaptureResult>;
}

/**
 * WMP Trigger 4 capture result.
 * CCP-I9 audit sufficiency requires captureId in assertion audit record.
 */
export interface WmpCaptureResult {
  /** Boundary event ID referencing the WMP snapshot */
  readonly captureId: string;
  /**
   * WMP sourcing status per WMP §10.2:
   * 'not_verified': v1 default for tasks with initialized WMP
   * 'not_applicable': tasks where WMP was never initialized
   * 'verified': reserved for future content tracing
   */
  readonly sourcingStatus: 'verified' | 'not_verified' | 'not_applicable';
}

// ============================================================================
// Lifecycle Projection — Binding 3, DC-CCP-205
// ============================================================================

/**
 * Binding 3, DC-CCP-205: Claim lifecycle state — computed projection.
 * Combines claim status with relationship-derived state for a complete view.
 * Unlike ClaimStatus (storage: active|retracted), this includes relationship
 * effects (disputed, superseded) and grounding state (grounded).
 *
 * Ordering by severity: retracted > superseded > disputed > grounded > asserted.
 */
export type ClaimLifecycleState = 'asserted' | 'grounded' | 'disputed' | 'superseded' | 'retracted';

/**
 * Binding 3, DC-CCP-205: Lifecycle projection interface.
 * Computes the full lifecycle state of a claim by combining its stored status
 * with relationship-derived state. This is the executable projection function
 * required by Binding 3.
 *
 * The projection is pure — it does not mutate state.
 */
export interface ClaimLifecycleProjection {
  /**
   * Project the full lifecycle state of a claim.
   *
   * @param status - The claim's stored status (active | retracted)
   * @param grounded - Whether the claim has been successfully grounded (CF-05)
   * @param hasContradicts - Whether any 'contradicts' relationship targets this claim
   * @param hasSupersedes - Whether any 'supersedes' relationship targets this claim
   * @returns The projected lifecycle state (highest severity wins)
   */
  project(
    status: ClaimStatus,
    grounded: boolean,
    hasContradicts: boolean,
    hasSupersedes: boolean,
  ): ClaimLifecycleState;
}

// ============================================================================
// Phase 0A Governance Integration — Trace Events
// ============================================================================

/**
 * DC-CCP-501/502/512/513, Binding 14: Constitutional CCP trace event types.
 * Maps CCP lifecycle transitions to the 4 constitutional trace events defined
 * in trace.ts:64-67. Used for type-safe emission through ClaimSystemDeps.traceEmitter.
 *
 * These are the CCP projection of the 32 constitutional trace events.
 * BC-020: TraceEmitter is SEPARATE from EventBus (CCP_EVENTS).
 */
export const CCP_TRACE_EVENTS = {
  /** Binding 14: Emitted on SC-11 successful assertion. Transaction-coupled (BC-027). */
  CLAIM_ASSERTED: 'claim.asserted' as const,
  /** DC-CCP-513: Emitted on SC-11 grounding success. Transaction-coupled (BC-027). */
  CLAIM_GROUNDED: 'claim.grounded' as const,
  /** DC-CCP-512: Emitted on SC-12 'contradicts' relationship. Transaction-coupled (BC-027). */
  CLAIM_CHALLENGED: 'claim.challenged' as const,
  /** Binding 14: Emitted on retraction (§10.4). Transaction-coupled (BC-027). */
  CLAIM_RETRACTED: 'claim.retracted' as const,
} as const;

/**
 * DC-CCP-118 (v1.1): Capability result scope validation.
 * When evidenceType='capability_result', the referenced result must originate
 * from within the claiming agent's mission ancestor chain. This prevents
 * cross-scope evidence contamination.
 *
 * This interface extends EvidenceSourceValidator's exists() by adding
 * mission-chain scope validation for the 'capability_result' evidence type.
 */
export interface CapabilityResultScopeValidator {
  /**
   * Validate that a capability_result evidence reference is within the
   * mission ancestor chain of the asserting agent's current mission.
   *
   * @param conn - Database connection
   * @param evidenceId - The capability_result ID
   * @param missionId - The asserting claim's mission context
   * @param tenantId - Tenant scope for isolation (F-S1-004: prevents cross-tenant scope walk)
   * @returns ok:true if within scope, error if cross-scope
   */
  validateScope(
    conn: DatabaseConnection,
    evidenceId: string,
    missionId: MissionId,
    tenantId: TenantId | null,
  ): Result<boolean>;
}

/**
 * DC-CCP-307: Idempotency key for SC-11 assert_claim.
 * Optional — when provided, duplicate assertions with the same key
 * return the cached result instead of creating a new claim.
 * Uses the Phase 0A IdempotencyKey structure (governance_ids.ts).
 */
export interface ClaimIdempotencyInput {
  /** Caller-provided idempotency key (unique per agent per mission) */
  readonly key: string;
}

// ============================================================================
// Error Code Constants — SC-11, SC-12, SC-13, §14.4, SC-4 Amendment
// ============================================================================

/**
 * §10.1, SC-11: assert_claim error codes (17 design source + 1 derived = 18).
 * Each maps to a specific validation failure per CCP §6, §10.1, and CF-05.
 */
export const SC11_ERROR_CODES = {
  /** §6: Subject URN format invalid */
  INVALID_SUBJECT: 'INVALID_SUBJECT',
  /** §6: Predicate namespace format invalid or reserved */
  INVALID_PREDICATE: 'INVALID_PREDICATE',
  /** §6: Object value does not match declared type */
  INVALID_OBJECT_TYPE: 'INVALID_OBJECT_TYPE',
  /** §10.1: Confidence not in [0.0, 1.0] */
  CONFIDENCE_OUT_OF_RANGE: 'CONFIDENCE_OUT_OF_RANGE',
  /** §6: validAt is not valid ISO 8601 */
  INVALID_VALID_AT: 'INVALID_VALID_AT',
  /** CCP-I5: No evidence references for evidence-path mode */
  NO_EVIDENCE: 'NO_EVIDENCE',
  /** §10.1: Evidence references exceed CLAIM_MAX_EVIDENCE_REFS */
  EVIDENCE_LIMIT_EXCEEDED: 'EVIDENCE_LIMIT_EXCEEDED',
  /** CCP-I5: Evidence FK referencing nonexistent source */
  EVIDENCE_NOT_FOUND: 'EVIDENCE_NOT_FOUND',
  /** §6: Evidence reference crosses tenant boundary */
  EVIDENCE_CROSS_TENANT: 'EVIDENCE_CROSS_TENANT',
  /** §10.1: Per-mission claim limit exceeded (500) */
  CLAIM_LIMIT_EXCEEDED: 'CLAIM_LIMIT_EXCEEDED',
  /** §10.1: Mission not in active state */
  MISSION_NOT_ACTIVE: 'MISSION_NOT_ACTIVE',
  /** §10.1: Agent not authorized */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** §10.1: Per-agent rate limit exceeded (100 calls/min) */
  RATE_LIMITED: 'RATE_LIMITED',
  /** CF-05: No evidence-path terminates at non-claim source within maxHops */
  GROUNDING_DEPTH_EXCEEDED: 'GROUNDING_DEPTH_EXCEEDED',
  /** CF-05: groundingMode='runtime_witness' but runtimeWitness field absent */
  RUNTIME_WITNESS_MISSING: 'RUNTIME_WITNESS_MISSING',
  /** CF-05: runtimeWitness present but structurally invalid */
  RUNTIME_WITNESS_INVALID: 'RUNTIME_WITNESS_INVALID',
  /** CF-05: groundingMode field not provided */
  GROUNDING_MODE_MISSING: 'GROUNDING_MODE_MISSING',
  /** DERIVED: Polymorphic FK type/id pair invalid (type discriminator mismatch) */
  EVIDENCE_TYPE_MISMATCH: 'EVIDENCE_TYPE_MISMATCH',
  /** DC-CCP-117 (v1.1): Evidence chain traverses a retracted intermediate claim — epistemic contamination */
  GROUNDING_RETRACTED_INTERMEDIATE: 'GROUNDING_RETRACTED_INTERMEDIATE',
  /** DC-CCP-118 (v1.1): capability_result evidence from outside mission ancestor chain */
  EVIDENCE_SCOPE_VIOLATION: 'EVIDENCE_SCOPE_VIOLATION',
  /** DC-CCP-307: Duplicate assertion detected via idempotency key */
  IDEMPOTENT_DUPLICATE: 'IDEMPOTENT_DUPLICATE',
} as const;

/**
 * §10.4: Retraction error codes (4 codes per design source).
 * Derived from retraction action boundary in CCP §10.4.
 * CROSS_TENANT removed: tenant-scoped queries return CLAIM_NOT_FOUND.
 */
export const RETRACTION_ERROR_CODES = {
  /** §10.4: Target claim not found (includes cross-tenant — tenant-scoped query) */
  CLAIM_NOT_FOUND: 'CLAIM_NOT_FOUND',
  /** §10.4: Not source agent or admin */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** §10.4: Claim already in retracted state (terminal, CCP-I2) */
  CLAIM_ALREADY_RETRACTED: 'CLAIM_ALREADY_RETRACTED',
  /** §10.4: Reason is required and must be non-empty */
  INVALID_REASON: 'INVALID_REASON',
} as const;

/**
 * SC-12: relate_claims error codes (9 codes).
 */
export const SC12_ERROR_CODES = {
  /** I-31: One or both claims not found */
  CLAIM_NOT_FOUND: 'CLAIM_NOT_FOUND',
  /** CCP-LI-06: Claims in different tenants */
  CROSS_TENANT: 'CROSS_TENANT',
  /** I-31: Relationship type not in allowed set */
  INVALID_RELATIONSHIP_TYPE: 'INVALID_RELATIONSHIP_TYPE',
  /** I-31: fromClaimId === toClaimId */
  SELF_REFERENCE: 'SELF_REFERENCE',
  /** I-31: fromClaimId is not active */
  CLAIM_NOT_ACTIVE: 'CLAIM_NOT_ACTIVE',
  /** SC-12: Outgoing relationship limit exceeded */
  RELATIONSHIP_LIMIT_EXCEEDED: 'RELATIONSHIP_LIMIT_EXCEEDED',
  /** SC-12: Mission not in active state */
  MISSION_NOT_ACTIVE: 'MISSION_NOT_ACTIVE',
  /** SC-12: Agent not authorized */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** SC-12: Per-agent rate limit exceeded */
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

/**
 * SC-13: query_claims error codes (7 codes).
 */
export const SC13_ERROR_CODES = {
  /** SC-13: No filters provided (all null) */
  NO_FILTERS: 'NO_FILTERS',
  /** SC-13, AMB-14: Subject filter structurally malformed */
  INVALID_SUBJECT_FILTER: 'INVALID_SUBJECT_FILTER',
  /** SC-13, AMB-14: Predicate filter structurally malformed */
  INVALID_PREDICATE_FILTER: 'INVALID_PREDICATE_FILTER',
  /** SC-13: Requested limit exceeds CLAIM_QUERY_MAX_LIMIT */
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  /** SC-13: Mission not in active state */
  MISSION_NOT_ACTIVE: 'MISSION_NOT_ACTIVE',
  /** SC-13: Agent not authorized */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** SC-13: Per-agent rate limit exceeded */
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

/**
 * SC-4 Amendment: Error codes for claim-bearing artifacts (3 codes).
 */
export const SC4_AMENDMENT_ERROR_CODES = {
  /** SC-4: Invalid assertionType value */
  INVALID_ASSERTION_TYPE: 'INVALID_ASSERTION_TYPE',
  /** SC-4: Per-artifact claim limit exceeded */
  ARTIFACT_CLAIM_LIMIT: 'ARTIFACT_CLAIM_LIMIT',
  /** SC-4: Policy requires claims for assertionType='factual' */
  POLICY_VIOLATION: 'POLICY_VIOLATION',
} as const;

// ============================================================================
// CCP Event Types — §14, FM-CCP-02
// ============================================================================

/**
 * §14: CCP event type constants with scope and propagation.
 * 6 events per design source. Each documents scope, propagation, and trigger.
 */
export const CCP_EVENTS = {
  /** §14, SC-11: Fired on successful claim assertion. Scope: mission, Propagation: local */
  CLAIM_ASSERTED: { type: 'claim.asserted', scope: 'mission' as const, propagation: 'local' as const },
  /** §14, §10.4: Fired on retraction. Scope: system, Propagation: up */
  CLAIM_RETRACTED: { type: 'claim.retracted', scope: 'system' as const, propagation: 'up' as const },
  /** §14, PSD-2: Fired per dependent claim when evidence source retracted. Scope: system, one-edge-deep */
  CLAIM_EVIDENCE_RETRACTED: { type: 'claim.evidence.retracted', scope: 'system' as const, propagation: 'up' as const },
  /** §14, SC-12: Fired on relationship declaration. Scope: mission, Propagation: local */
  CLAIM_RELATIONSHIP_DECLARED: { type: 'claim.relationship.declared', scope: 'mission' as const, propagation: 'local' as const },
  /** §14, §13: Fired on claim purge/tombstone. Scope: system, Propagation: local */
  CLAIM_TOMBSTONED: { type: 'claim.tombstoned', scope: 'system' as const, propagation: 'local' as const },
  /** §14, CCP-I5: Fired when non-claim evidence source purged. Scope: system, Propagation: local */
  CLAIM_EVIDENCE_ORPHANED: { type: 'claim.evidence.orphaned', scope: 'system' as const, propagation: 'local' as const },
} as const;

// ============================================================================
// Configuration Constants — CCP Limits and Thresholds
// ============================================================================

/** CF-05, PSD-5: Maximum hops for evidence-path grounding (default, configurable per tenant/mission) */
export const CLAIM_GROUNDING_MAX_HOPS = 3;

/** FM-CCP-01: Maximum claims per mission */
export const CLAIM_PER_MISSION_LIMIT = 500;

/** FM-CCP-01: Maximum claims per artifact (SC-4 amendment) */
export const CLAIM_PER_ARTIFACT_LIMIT = 50;

/** FM-CCP-01: Maximum evidence references per claim */
export const CLAIM_MAX_EVIDENCE_REFS = 20;

/** FM-CCP-01: Maximum outgoing relationships per claim */
export const CLAIM_MAX_OUTGOING_RELATIONSHIPS = 50;

/** §10.3: Maximum query result limit */
export const CLAIM_QUERY_MAX_LIMIT = 200;

/** §10.3: Default query result limit */
export const CLAIM_QUERY_DEFAULT_LIMIT = 50;

/** §6, AMB-CCP-07: Maximum JSON object value size in bytes (10KB = 10,240 bytes UTF-8) */
export const CLAIM_JSON_MAX_BYTES = 10_240;

/** §10.1/§10.2/§10.3: Rate limit — calls per minute per agent */
export const CLAIM_RATE_LIMIT = 100;

// ============================================================================
// SC-4 Amendment Types — Assertion Type
// ============================================================================

/** SC-4 §11.1: Artifact assertion type classification. Nullable — null means no assertion type. */
export type AssertionType = 'factual' | 'speculative' | 'procedural';

// ============================================================================
// Phase 2: Search Types (FTS5 Full-Text Search)
// ============================================================================

/**
 * Phase 2: Search claim input.
 * Full-text search across claim content using FTS5.
 * NOT a system call (no new SC-17). Implemented as internal method on ClaimApi.
 *
 * Invariants: I-P2-02 (tenant isolation), I-P2-07 (input validation)
 */
export interface SearchClaimInput {
  /** FTS5 search query. Supports phrase ("exact match"), boolean (AND/OR/NOT), prefix (term*). */
  readonly query: string;
  /** Minimum confidence threshold. Default: none. */
  readonly minConfidence?: number;
  /** Maximum results. Default: 20. Max: 200. */
  readonly limit?: number;
  /** Include superseded claims. Default: false. */
  readonly includeSuperseded?: boolean;
}

/**
 * Phase 2: Search result item.
 */
export interface SearchClaimResultItem {
  /** The matching claim (full Claim object) */
  readonly claim: Claim;
  /** FTS5 BM25 relevance score (raw, negative -- lower = more relevant) */
  readonly relevance: number;
  /**
   * Combined score: -bm25(claims_fts) * confidence. Higher = better match.
   * PA Amendment 2: BM25 negated to make higher = better.
   */
  readonly score: number;
  /** Whether this claim has been superseded (computed) */
  readonly superseded: boolean;
  /** Whether this claim is disputed (computed) */
  readonly disputed: boolean;
}

/**
 * Phase 2: Search result.
 */
export interface SearchClaimResult {
  /** Matching claims, ordered by score descending */
  readonly results: readonly SearchClaimResultItem[];
  /** Total matching count (before limit) */
  readonly total: number;
}

/** Phase 2: Default search result limit */
export const SEARCH_DEFAULT_LIMIT = 20;

/** Phase 2: Maximum search result limit (same as query) */
export const SEARCH_MAX_LIMIT = 200;
