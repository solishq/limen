/**
 * CGP (Context Governance Protocol) interface types.
 * Spec ref: CGP v1.0 Design Source (FINAL), Architecture Freeze CF-01/CF-03/CF-04/CF-05/CF-07/CF-08/CF-09/CF-10
 *
 * Phase: v3.3.0 — Context Governance Protocol Truth Model
 * Status: FROZEN — interfaces defined before implementation.
 *
 * Implements: All TypeScript types for the Context Governance subsystem:
 *   §3 (11 Invariants CGP-I1 through CGP-I11)
 *   §4 (20 Conformance Tests CT-CGP-01 through CT-CGP-20)
 *   §5 (6 Position Definitions with Candidate Scope Contracts)
 *   §7 (Eviction-Ordered Admission Algorithm)
 *   §8 (5 Per-Position Deterministic Ordering Rules)
 *   §10 (Context Admission Replay Record)
 *   §11 (Chat-Mode Integration)
 *   §12 (5 Failure Modes FM-CGP-01 through FM-CGP-05)
 *   §13 (DBA/WMP/CCP Interaction Boundaries)
 *
 * Key architectural properties:
 *   - Eviction-ordered admission: start from "all admitted," evict bottom-up (CF-03)
 *   - Greedy top-down is PROVEN NON-CONFORMING (CT-CGP-02)
 *   - Protection outranks precedence: non-protected P2 CAN yield for protected P3 (CF-09)
 *   - Whole-candidate eviction: no partial eviction, over-eviction by design (§7.3)
 *   - No backfill: evicted candidates never re-admitted (§7.3, CF-10)
 *   - Position 1 never evicted: excluded from eviction loop by construction (CF-08)
 *   - Per-invocation fresh collection: no cached admission state (CF-07)
 *   - Token cost = canonical representation × costing basis (CGP-I11, DBA-I2)
 *
 * Cross-subsystem dependencies:
 *   - DBA: effectiveContextBudget (per-invocation input, DBA-I5)
 *   - WMP: position 2 candidates via internal read (WMP §9.2)
 *   - CCP: position 4 candidates via claim_artifact_refs (§14.6)
 *   - Retrieval: position 5 candidates (ranked memory list)
 *   - EGP: indirect — CGP runs within task execution
 */

import type {
  MissionId, TaskId, ArtifactId, SessionId,
  Result,
} from '../../kernel/interfaces/index.js';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { AuditTrail } from '../../kernel/interfaces/audit.js';
import type { EventBus } from '../../kernel/interfaces/events.js';
import type { ClaimId } from '../../claims/interfaces/claim_types.js';

// ============================================================================
// Branded ID Types — CGP-specific
// ============================================================================

/**
 * §10.2: Invocation identifier — unique per model invocation.
 * Links CGP replay records to DBA invocation accounting.
 */
export type ContextInvocationId = string & { readonly __brand: 'ContextInvocationId' };

/**
 * §5.6: Observation identifier — unique per capability result.
 * Capability results from the current task's execution.
 */
export type ObservationId = string & { readonly __brand: 'ObservationId' };

/**
 * §5.5: Memory identifier — unique per retrieved memory.
 * Tie-breaker for P5 eviction ordering (§8.4).
 */
export type MemoryId = string & { readonly __brand: 'MemoryId' };

// ============================================================================
// Position Types — CF-03 six-position precedence model
// ============================================================================

/**
 * CF-03: The six precedence positions.
 * Position 1 = highest precedence (system control state, never evicted).
 * Position 6 = lowest precedence (external observations, evicted first).
 */
export type PrecedencePosition = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Positions subject to the eviction algorithm (§7.2 Step 4).
 * Position 1 is excluded by construction — the eviction loop processes [6,5,4,3,2].
 * [CGP-I2, CF-08, CT-CGP-20]
 */
export type EvictablePosition = 2 | 3 | 4 | 5 | 6;

// ============================================================================
// Enumerated Types — derived from design source
// ============================================================================

/**
 * §10.2: Protection status of a candidate.
 * governed_required: excluded from eviction candidate set (CGP-I3, CF-09).
 * non_protected: subject to deterministic eviction ordering.
 *
 * In v1, only P3 artifacts declared in task.inputArtifactIds are governed_required.
 * P2 entries are "typically non-protected" (§5.2). P4-P6 are non-protected. (§6.1)
 */
export type ProtectionStatus = 'governed_required' | 'non_protected';

/**
 * §10.2, §7.3: Admission algorithm result.
 * success: admitted set fits within ECB.
 * CONTROL_STATE_OVERFLOW: P1 alone exceeds ECB (§7.2 Step 1). [FM-CGP-01]
 * CONTEXT_PROTECTION_OVERFLOW: P1 + all protected exceeds ECB (§7.2 Step 3). [FM-CGP-02]
 */
export type AdmissionResult = 'success' | 'CONTROL_STATE_OVERFLOW' | 'CONTEXT_PROTECTION_OVERFLOW';

/**
 * §10.2: Per-candidate admission decision.
 */
export type CandidateResult = 'admitted' | 'evicted';

/**
 * §10.2: Candidate type discriminator.
 * Maps to positions: wmp_entry(P2), artifact(P3), claim(P4), memory(P5), observation(P6).
 */
export type CandidateType = 'wmp_entry' | 'artifact' | 'claim' | 'memory' | 'observation';

// ============================================================================
// Costing Basis — CGP-I11, DBA-I2 coupling
// ============================================================================

/**
 * §9.4, CGP-I11: Token costing basis.
 * Must match DBA's prompt accounting basis (DBA-I2) — same tokenizer/metering method.
 * Recorded in replay record for deterministic replay (CF-10).
 * FM-CGP-05 if mismatch between CGP costing and actual prompt consumption.
 */
export interface CostingBasis {
  /** Tokenizer or metering method identity (e.g., 'cl100k_base', 'o200k_base') */
  readonly tokenizerId: string;
  /** Tokenizer version for replay stability */
  readonly tokenizerVersion: string;
}

// ============================================================================
// Position 1 — System Control State [CF-08]
// ============================================================================

/**
 * §5.1, CGP-I2: Position 1 content — always admitted, never evicted.
 * Contains: mission objective, task definition, active budgets, permissions, active policies.
 * System-assembled, not agent-submitted.
 */
export interface ControlStateContent {
  /** Canonical text representation of all P1 content */
  readonly canonicalText: string;
  /** Token cost computed via costing basis */
  readonly tokenCost: number;
}

// ============================================================================
// Candidate Representation — §9.3, CGP-I11
// ============================================================================

/**
 * §9.3, CGP-I11: A candidate's admission representation.
 * The canonical text form is what gets token-costed AND what the model sees if admitted.
 * Costing a different form from what is rendered is non-conforming (CGP-I11).
 */
export interface CandidateRepresentation {
  /** Object ID (artifactId, claimId, memoryId, observationId, or WMP key) */
  readonly candidateId: string;
  /** Position-derived type discriminator */
  readonly candidateType: CandidateType;
  /** The serialized text that would appear in the model's context */
  readonly canonicalText: string;
  /** Token cost derived from canonicalText + costing basis */
  readonly tokenCost: number;
  /** Protection status per CGP-I3 */
  readonly protectionStatus: ProtectionStatus;
  /** Position-specific ordering inputs, recorded for replay (CF-10) */
  readonly orderingInputs: Readonly<Record<string, string | number>>;
}

// ============================================================================
// Position Candidate Set — §5
// ============================================================================

/**
 * §5: Candidates for a single evictable position (2-6).
 * Candidate collection is independent across positions and independent of
 * admission results (§5 preamble).
 */
export interface PositionCandidateSet {
  /** Position number (2-6) */
  readonly positionNumber: EvictablePosition;
  /**
   * Whether this position is applicable for the current invocation.
   * false in chat mode for P2-P4 (§11.2). Positions with applicable=false
   * contribute zero candidates and zero cost.
   */
  readonly applicable: boolean;
  /** Candidates for this position (empty array if not applicable or no candidates) */
  readonly candidates: readonly CandidateRepresentation[];
}

// ============================================================================
// Algorithm Input / Output — §7.2
// ============================================================================

/**
 * §7.2: Input to the eviction-ordered admission algorithm.
 * Collected fresh per model invocation (CGP-I10).
 */
export interface AdmissionAlgorithmInput {
  /** Unique identifier for this model invocation */
  readonly invocationId: ContextInvocationId;
  /** Executing task */
  readonly taskId: TaskId;
  /** Owning mission */
  readonly missionId: MissionId;
  /** Per-invocation budget from DBA computation (DBA-I5). Non-negative integer. */
  readonly effectiveContextBudget: number;
  /** Token costing basis — must match DBA-I2 */
  readonly costingBasis: CostingBasis;
  /** Position 1 content (always admitted, CGP-I2) */
  readonly controlState: ControlStateContent;
  /** Positions 2-6 candidate sets */
  readonly positionCandidates: readonly PositionCandidateSet[];
}

/**
 * §7.2 Step 4: A single eviction decision.
 * Recorded in replay for deterministic verification (CF-10).
 */
export interface EvictionDecision {
  /** ID of the evicted candidate */
  readonly candidateId: string;
  /** Which position the candidate belonged to */
  readonly positionNumber: EvictablePosition;
  /** Token cost freed by this eviction */
  readonly tokenCost: number;
  /** 1-based sequence within the global eviction pass */
  readonly evictionOrder: number;
}

/**
 * §7.2: Output of the eviction-ordered admission algorithm.
 * The admitted set is immutable for the duration of the invocation (CGP-I5).
 */
export interface AdmissionAlgorithmOutput {
  /** Overall admission result */
  readonly admissionResult: AdmissionResult;
  /**
   * All candidates that survived eviction (positions 2-6).
   * Does NOT include P1 (P1 is always admitted separately).
   * Empty if admission failed.
   */
  readonly admittedCandidates: readonly CandidateRepresentation[];
  /** Ordered list of eviction decisions (global eviction sequence) */
  readonly evictedCandidates: readonly EvictionDecision[];
  /** P1 cost + all admitted P2-P6 costs */
  readonly totalAdmittedCost: number;
  /** P1 token cost (always included) */
  readonly position1Cost: number;
}

// ============================================================================
// Context Admission Replay Record — §10.2, CF-10
// ============================================================================

/**
 * §10.2: Per-candidate entry in the replay record.
 * Contains all information needed to reproduce the admission decision.
 */
export interface CandidateReplayEntry {
  /** Object ID */
  readonly candidateId: string;
  /** Candidate type discriminator */
  readonly candidateType: CandidateType;
  /** Token cost at admission time */
  readonly tokenCost: number;
  /** Protection status at admission time */
  readonly protectionStatus: ProtectionStatus;
  /** Position-specific ordering input values (recorded for replay) */
  readonly orderingInputs: Readonly<Record<string, string | number>>;
  /** Whether this candidate was admitted or evicted */
  readonly result: CandidateResult;
  /** Eviction sequence number (null if admitted) */
  readonly evictionOrder: number | null;
}

/**
 * §10.2: Per-position entry in the replay record.
 * All six positions are recorded, even those with zero candidates (CGP-I6).
 */
export interface PositionReplayEntry {
  /** Position number (2-6) */
  readonly positionNumber: EvictablePosition;
  /** Whether this position was applicable (false for P2-P4 in chat mode) */
  readonly applicable: boolean;
  /** Per-candidate details */
  readonly candidates: readonly CandidateReplayEntry[];
  /** Total candidate count (may be 0) */
  readonly candidateCount: number;
  /** Count of governed-required candidates */
  readonly protectedCount: number;
  /** Count of evicted candidates */
  readonly evictedCount: number;
  /** Total token cost of admitted candidates in this position */
  readonly admittedTokenCost: number;
}

/**
 * §10.2: The complete context admission replay record.
 * Produced per model invocation. Enables deterministic replay verification (CF-10).
 * An independent implementation applying §7 with the same costing basis must
 * produce an identical admitted set and identical eviction sequence.
 */
export interface ContextAdmissionRecord {
  /** Links to DBA invocation accounting */
  readonly invocationId: ContextInvocationId;
  /** Executing task */
  readonly taskId: TaskId;
  /** Owning mission */
  readonly missionId: MissionId;

  // Budget inputs
  /** From DBA computation (DBA-I5) */
  readonly effectiveContextBudget: number;

  // Costing basis
  /** Tokenizer identity + version for replay */
  readonly costingBasis: CostingBasis;

  // Position 1 — control state (always admitted, CGP-I2)
  readonly position1: {
    readonly applicable: true;
    readonly tokenCost: number;
    readonly result: 'admitted';
  };

  // Positions 2-6
  readonly positions: readonly PositionReplayEntry[];

  // Summary
  /** P1 + all admitted P2-P6 */
  readonly totalAdmittedCost: number;
  /** Algorithm result */
  readonly admissionResult: AdmissionResult;
  /** Wall-clock timestamp of admission */
  readonly timestamp: number;

  // ECB computation audit trail (Phase 2B: CGP ↔ DBA wire)
  /**
   * I-61: ECB computation inputs recorded for audit transparency.
   * Present when ECB was computed via EcbProvider (live DBA computation).
   * Absent when ECB was passed directly as a parameter (unit test path).
   */
  readonly ecbAuditInputs?: EcbAuditInputs;
}

// ============================================================================
// Task Context Specification — §6.2 schema extension
// ============================================================================

/**
 * CGP-I7: Temporal scope for claim filtering.
 * When present on task spec, claims with validAt outside this range
 * are excluded from P4 candidate set before admission scoring.
 */
export interface TemporalScope {
  /** Inclusive start (ISO-8601) */
  readonly start: string;
  /** Inclusive end (ISO-8601) */
  readonly end: string;
}

/**
 * §6.2: Task specification fields relevant to CGP.
 * These are the CGP-specific inputs from the task definition.
 * inputArtifactIds and temporalScope are schema extensions (§6.2).
 */
export interface TaskContextSpec {
  /** Executing task */
  readonly taskId: TaskId;
  /** Owning mission */
  readonly missionId: MissionId;
  /**
   * §6.2: Governed-required artifacts for P3 (CGP-I3).
   * When present: listed artifacts are governed-required (protected).
   * When absent/undefined: no P3 artifacts are governed-required.
   */
  readonly inputArtifactIds?: readonly ArtifactId[];
  /**
   * §6.2: Temporal compatibility gate for P4 claims (CGP-I7).
   * When present: claims outside this range excluded from P4 candidates.
   * When absent/undefined: no temporal filtering.
   */
  readonly temporalScope?: TemporalScope;
  /**
   * Chat-mode detection. true when invoked via limen.chat() with no
   * mission/task context. Determines P2-P4 applicability (§11.2).
   */
  readonly isChatMode: boolean;
  /**
   * §6.2, DC-CGP-X13: Task lifecycle state.
   * When present and terminal (completed, failed, cancelled),
   * admitContext rejects immediately with TASK_TERMINATED.
   * When absent: no lifecycle check (backward compatible with pre-EGP callers).
   */
  readonly taskState?: string;
}

// ============================================================================
// Cross-Subsystem Reader Interfaces
// ============================================================================

// ─── WMP Internal Read (§9.2 of WMP Design Source) ───

/**
 * WMP §9.2: A single WMP entry as returned by the internal read interface.
 * Internal kernel-to-kernel read, NOT via SC-15.
 * Returns all live entries for the executing task only (WMP-I1).
 */
export interface WmpInternalEntry {
  /** Entry key */
  readonly key: string;
  /** Entry value (UTF-8 text, canonical admission representation per §5.2) */
  readonly value: string;
  /** Byte size of value */
  readonly sizeBytes: number;
  /** Creation timestamp (ISO-8601) */
  readonly createdAt: string;
  /** Last update timestamp (ISO-8601) — P2 eviction ordering signal (§8.1) */
  readonly updatedAt: string;
  /** Task-local monotonic counter (WMP-I5) */
  readonly mutationPosition: number;
}

/**
 * WMP §9.2: Internal read interface for CGP position 2 candidate collection.
 * Returns consistent snapshot of live namespace at query moment.
 * Invoked once per admission cycle.
 * Does NOT create audit entries or dependency tracking.
 */
export interface WmpInternalReader {
  /**
   * Read all live WMP entries for the specified task.
   * Returns only the executing task's entries (WMP-I1 scope enforcement).
   */
  readLiveEntries(taskId: TaskId): Result<readonly WmpInternalEntry[]>;
}

// ─── Artifact Candidate Collection (§5.3) ───

/**
 * §5.3: An artifact eligible for P3 candidacy.
 * ACTIVE artifacts from current mission + cross-mission inputArtifactIds.
 */
export interface ArtifactCandidate {
  /** Artifact identifier */
  readonly artifactId: ArtifactId;
  /** Artifact version (immutable per version, CF-12) */
  readonly version: number;
  /** Artifact content (basis for canonical representation) */
  readonly content: string;
  /** Content format (markdown, json, code, etc.) — determines rendering */
  readonly format: string;
  /** Must be 'ACTIVE' for candidacy */
  readonly lifecycleState: string;
  /** Creation timestamp — P3 eviction ordering signal (§8.2) */
  readonly createdAt: string;
  /** Source mission */
  readonly missionId: MissionId;
}

/**
 * §5.3: Collects P3 candidates from the artifact workspace.
 * Filter: lifecycleState = ACTIVE, missionId = current OR artifactId IN inputArtifactIds.
 */
export interface ArtifactCandidateCollector {
  collectCandidates(
    conn: DatabaseConnection,
    missionId: MissionId,
    inputArtifactIds?: readonly ArtifactId[],
  ): Result<readonly ArtifactCandidate[]>;
}

// ─── Claim Candidate Collection (§5.4) ───

/**
 * §5.4: A claim eligible for P4 candidacy.
 * Must be: active, non-archived, linked via claim_artifact_refs to a mission-scoped artifact
 * OR matching the task's temporal scope (I-70, §51.3).
 */
export interface ClaimCandidate {
  /** Claim identifier */
  readonly claimId: ClaimId;
  /** Subject URN */
  readonly subject: string;
  /** Predicate namespace */
  readonly predicate: string;
  /** Typed object value */
  readonly object: { readonly type: string; readonly value: unknown };
  /** Confidence score [0.0, 1.0] */
  readonly confidence: number;
  /** Temporal anchor (ISO-8601) — CGP-I7 filtering */
  readonly validAt: string;
  /** Evidence summary for canonical representation */
  readonly evidenceSummary: {
    readonly count: number;
    readonly types: readonly string[];
  };
  /** Creation timestamp — P4 eviction ordering signal (§8.3) */
  readonly createdAt: string;
}

/**
 * §5.4, §13.3, I-74: Collects P4 candidates INDEPENDENTLY of P3.
 * Two admission paths (I-70, OR semantics):
 *   Path 1: Claims linked via claim_artifact_refs to mission-scoped artifacts
 *   Path 2: Claims with sourceMissionId matching + validAt within temporalScope
 * Filter: status = 'active', archived = false, purged_at IS NULL.
 * §51.3: Claims with validAt outside temporalScope excluded before candidacy.
 * CGP does NOT modify claims — read-only.
 */
export interface ClaimCandidateCollector {
  /**
   * Collect claims eligible for P4 candidacy.
   * @param missionId — current mission scope (P4 queries artifacts independently per I-74)
   * @param temporalScope — optional §51.3 temporal compatibility gate
   */
  collectCandidates(
    conn: DatabaseConnection,
    missionId: MissionId,
    temporalScope?: TemporalScope,
  ): Result<readonly ClaimCandidate[]>;
}

// ─── Retrieved Memory (§5.5) ───

/**
 * §5.5: A memory from the retrieval subsystem output.
 * Retrieval phase runs BEFORE CGP and produces a ranked list.
 * CGP consumes the output — it does NOT perform memory retrieval.
 */
export interface RetrievedMemory {
  /** Memory identifier — P5 eviction tie-breaker (§8.4) */
  readonly memoryId: MemoryId;
  /** Memory content text (canonical admission representation per §9.3) */
  readonly content: string;
  /**
   * Ordinal retrieval rank from the retrieval subsystem.
   * Lower value = more relevant (rank 1 = most relevant).
   * P5 eviction ordering signal (§8.4): descending — highest rank value
   * (least relevant) evicted first.
   * [CT-CGP-18: rank 1 = most relevant, rank 3 = least relevant]
   */
  readonly retrievalRank: number;
}

/**
 * §5.5, §13.4: Interface to the retrieval subsystem's output.
 * CGP receives this as its P5 candidate set.
 * Includes historical conversation summaries mapped to P5 (§11.3).
 */
export interface RetrievalOutputProvider {
  /**
   * Get ranked retrieval results for the current invocation.
   * Includes: retrieved memories + historical conversation summaries (§11.3).
   */
  getRetrievalResults(invocationId: ContextInvocationId): Result<readonly RetrievedMemory[]>;
}

// ─── Observation Collection (§5.6) ───

/**
 * §5.6: A capability result from the current task's execution.
 * web_search, code_execute, data_query, web_fetch, api_call results, etc.
 */
export interface ObservationCandidate {
  /** Observation identifier — P6 eviction tie-breaker (§8.5) */
  readonly observationId: ObservationId;
  /** Capability result content (canonical admission representation per §9.3) */
  readonly content: string;
  /** Production order — P6 eviction ordering signal (§8.5): ascending */
  readonly productionOrder: number;
  /** Production timestamp */
  readonly producedAt: string;
}

/**
 * §5.6: Collects P6 candidates from the current task's execution context.
 * Only results from the current task's current execution.
 */
export interface ObservationCollector {
  collectObservations(taskId: TaskId): Result<readonly ObservationCandidate[]>;
}

// ─── Conversation Context (§11.3) ───

/**
 * §11.3: Conversation context provider for CGP reclassification.
 * v3.2 conversation history is reclassified under CGP:
 *   - Current user instruction → P1 (always admitted, CGP-I2)
 *   - Historical conversation → P5 (evictable, competes with memories)
 */
export interface ConversationContextProvider {
  /** Get the current user instruction for P1 inclusion */
  getCurrentInstruction(sessionId: SessionId): Result<string>;
  /** Get historical conversation turns for P5 candidacy (via retrieval) */
  getHistoricalTurns(conversationId: string): Result<readonly ConversationTurnForAdmission[]>;
}

/**
 * §11.3: A conversation turn eligible for P5 candidacy.
 * Historical turns (including auto-summarized per §26.2) map to P5.
 */
export interface ConversationTurnForAdmission {
  /** Turn identifier */
  readonly turnId: string;
  /** Turn content text */
  readonly content: string;
  /** Turn role */
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  /** Whether this is an auto-summary turn */
  readonly isSummary: boolean;
}

// ============================================================================
// Service Interfaces — CGP-owned
// ============================================================================

/**
 * §5.1: Assembles P1 (system control state) content.
 * Gathers mission objective, task definition, budgets, permissions, policies.
 * System-assembled, not agent-submitted.
 */
export interface ControlStateAssembler {
  assembleControlState(
    conn: DatabaseConnection,
    taskSpec: TaskContextSpec,
  ): Result<ControlStateContent>;
}

/**
 * §9, CGP-I11: Token costing service.
 * Computes token cost from canonical text representation + costing basis.
 * Must use the same costing basis as DBA-I2 prompt accounting (FM-CGP-05).
 */
export interface TokenCostingService {
  /** Compute token cost for a text string using the specified costing basis */
  computeTokenCost(text: string, costingBasis: CostingBasis): number;
  /** Get the costing basis for a given model ID */
  getCostingBasis(modelId: string): CostingBasis;
}

/**
 * §9.3: Canonical representation renderer.
 * Produces the serialized text form that is both token-costed and sent to the model.
 * Rendering a different form from what is costed is non-conforming (CGP-I11).
 */
export interface CanonicalRepresentationRenderer {
  /** §5.2: WMP entry → UTF-8 text value */
  renderWmpEntry(entry: WmpInternalEntry): string;
  /** §5.3: Artifact → content rendered per format */
  renderArtifact(artifact: ArtifactCandidate): string;
  /** §5.4: Claim → structured text (subject, predicate, object, confidence, validAt, evidence summary) */
  renderClaim(claim: ClaimCandidate): string;
  /** §5.5: Memory → content text */
  renderMemory(memory: RetrievedMemory): string;
  /** §5.6: Observation → capability result content */
  renderObservation(observation: ObservationCandidate): string;
}

// ============================================================================
// Algorithm Interface — §7
// ============================================================================

/**
 * §7: The eviction-ordered admission algorithm.
 * Determines the admitted context set for a single model invocation.
 *
 * Algorithm properties (§7.3):
 *   - Deterministic (CF-10)
 *   - Minimal eviction (CF-03)
 *   - Cross-position protection (CF-03, CF-09)
 *   - Fail-safe (CF-08, CF-09)
 *   - Whole-candidate eviction granularity (§7.3)
 *   - No backfill (§7.3, CF-10)
 *
 * A greedy top-down admission algorithm is NON-CONFORMING (§7.1).
 */
export interface ContextAdmissionAlgorithm {
  /**
   * Execute the eviction-ordered admission algorithm.
   * Steps 1-8 of §7.2. Returns admission result + replay data.
   */
  execute(input: AdmissionAlgorithmInput): AdmissionAlgorithmOutput;
}

// ============================================================================
// Context Admission Result — full pipeline output
// ============================================================================

/**
 * Complete result of the CGP admission pipeline.
 * Includes admitted content, P1 control state, and full replay record.
 * The admitted context is frozen for the invocation duration (CGP-I5).
 */
export interface ContextAdmissionPipelineResult {
  /** P1 control state (always admitted) */
  readonly controlState: ControlStateContent;
  /** Admitted candidates from positions 2-6 */
  readonly admittedCandidates: readonly CandidateRepresentation[];
  /** Full replay record for deterministic verification (CF-10) */
  readonly replayRecord: ContextAdmissionRecord;
  /** Overall admission result */
  readonly admissionResult: AdmissionResult;
}

// ============================================================================
// CGP System Facade — top-level interface
// ============================================================================

/**
 * CGP System — the Context Governance Protocol facade.
 * Orchestrates candidate collection, token costing, admission algorithm,
 * and replay record production.
 *
 * Integrates into the chat pipeline's context_assembly phase (I-28).
 * Receives ECB from DBA, candidates from WMP/CCP/retrieval/observations.
 * Produces admitted context for DL-5 safety gates and model invocation.
 */
export interface ContextGovernor {
  /** The eviction-ordered admission algorithm (§7) */
  readonly algorithm: ContextAdmissionAlgorithm;
  /** P1 content assembler */
  readonly controlStateAssembler: ControlStateAssembler;
  /** Token costing service (CGP-I11) */
  readonly tokenCostingService: TokenCostingService;
  /** Canonical text renderer (§9.3) */
  readonly renderer: CanonicalRepresentationRenderer;
  /** WMP internal reader for P2 (WMP §9.2) */
  readonly wmpReader: WmpInternalReader;
  /** Artifact collector for P3 (§5.3) */
  readonly artifactCollector: ArtifactCandidateCollector;
  /** Claim collector for P4 (§5.4, §13.3) */
  readonly claimCollector: ClaimCandidateCollector;
  /** Retrieval output for P5 (§5.5, §13.4) */
  readonly retrievalProvider: RetrievalOutputProvider;
  /** Observation collector for P6 (§5.6) */
  readonly observationCollector: ObservationCollector;

  /**
   * Run the full CGP admission pipeline for a single model invocation.
   *
   * 1. Assemble P1 control state
   * 2. Collect candidates from all applicable positions (fresh, CGP-I10)
   * 3. Compute token costs via canonical representation + costing basis (CGP-I11)
   * 4. Execute eviction-ordered algorithm (§7)
   * 5. Produce replay record (§10)
   * 6. Freeze admitted context (CGP-I5)
   *
   * @param conn Database connection
   * @param taskSpec Task-level CGP inputs (inputArtifactIds, temporalScope, isChatMode)
   * @param effectiveContextBudget Per-invocation budget from DBA (DBA-I5)
   * @param modelId Target model for costing basis selection
   * @param invocationId Unique invocation identifier
   */
  admitContext(
    conn: DatabaseConnection,
    taskSpec: TaskContextSpec,
    effectiveContextBudget: number,
    modelId: string,
    invocationId: ContextInvocationId,
  ): Result<ContextAdmissionPipelineResult>;

  /**
   * Run CGP admission with live ECB computation from DBA (Phase 2B wire).
   *
   * I-52: ECB computed fresh per invocation — no state carried between calls.
   * I-53: ECB = min(window − overhead, ceiling ?? ∞), clamped to 0 (DBA-I14).
   * I-55: Ceiling hierarchy resolved: most restrictive of mission/task wins.
   * I-61: ECB computation inputs recorded in replay record for audit.
   *
   * If EcbProvider fails, admission fails (DC-ECB-011: no graceful degradation).
   *
   * @param conn Database connection
   * @param taskSpec Task-level CGP inputs
   * @param modelId Target model for window + costing basis
   * @param invocationId Unique invocation identifier
   * @param budgetInputs Overhead + ceiling hierarchy inputs for ECB computation
   */
  admitContextWithLiveBudget(
    conn: DatabaseConnection,
    taskSpec: TaskContextSpec,
    modelId: string,
    invocationId: ContextInvocationId,
    budgetInputs: BudgetComputationInputs,
  ): Result<ContextAdmissionPipelineResult>;
}

// ============================================================================
// ECB Computation Types — Phase 2B: CGP ↔ DBA wire
// ============================================================================

/**
 * I-54, I-63: Breakdown of systemOverhead into component costs.
 * Enables audit verification that technique cost is accounted for in ECB.
 *
 * Phase 2B: TGP ↔ Pipeline wire — technique cost is part of systemOverhead,
 * NOT CGP position 1. This breakdown makes the accounting transparent.
 */
export interface SystemOverheadBreakdown {
  /** Fixed pipeline cost: system prompt skeleton, safety preamble, tool defs, metadata */
  readonly fixedPipeline: number;
  /** Token cost of active prompt_fragment techniques injected for the executing agent */
  readonly activeTechniques: number;
  /** Total systemOverhead = fixedPipeline + activeTechniques */
  readonly total: number;
}

/**
 * I-61: Audit inputs for ECB computation.
 * All values that went into the ECB formula, recorded for replay transparency.
 * An independent verifier must be able to reconstruct the ECB value from these inputs.
 */
export interface EcbAuditInputs {
  /** Substrate-reported context tokens available (PSD-4) */
  readonly availableInputWindow: number;
  /** Fixed pipeline infrastructure + active technique cost (I-54) */
  readonly systemOverhead: number;
  /** I-63: Component breakdown of systemOverhead (Phase 2B: TGP ↔ Pipeline) */
  readonly overheadBreakdown?: SystemOverheadBreakdown;
  /** Most restrictive ceiling after hierarchy resolution (I-55), null if unconstrained */
  readonly effectivePolicyCeiling: number | null;
  /** True if negative-normalization was applied (ECB clamped to 0) */
  readonly wasNormalized: boolean;
  /** Raw value before normalization (may be negative) */
  readonly rawValue: number;
  /** How the window value was derived */
  readonly windowDerivationMode: string;
  /** Overhead computation version for replay */
  readonly overheadComputationBasis: string;
}

/**
 * Result of ECB computation — the budget value + full audit trail.
 */
export interface EcbComputationResult {
  /** The computed effectiveContextBudget — non-negative (DBA-I14) */
  readonly effectiveContextBudget: number;
  /** Full audit trail for I-61 transparency */
  readonly auditInputs: EcbAuditInputs;
}

/**
 * ECB Provider — computes effectiveContextBudget from DBA services.
 * Injected into CGP via CGPDeps (Phase 2B: CGP ↔ DBA wire).
 *
 * I-52: Each call computes fresh — no state carried between invocations.
 * I-53: Implements min(window − overhead, ceiling ?? ∞), clamped to 0.
 * I-55: Ceiling resolution: most restrictive of mission/task wins.
 *
 * The provider encapsulates DBA window, overhead, ceiling, and ECB services.
 * CGP never directly imports DBA types — the EcbProvider is the cross-subsystem seam.
 */
export interface EcbProvider {
  computeECB(params: {
    readonly modelId: string;
    readonly systemOverhead: number;
    readonly overheadBreakdown?: SystemOverheadBreakdown;
    readonly missionCeiling: number | null;
    readonly taskCeiling: number | null;
  }): Result<EcbComputationResult>;
}

/**
 * Budget inputs for admitContextWithLiveBudget().
 * The caller provides the inputs that CGP cannot derive internally.
 */
export interface BudgetComputationInputs {
  /** System overhead — infrastructure cost (I-54: excludes P1 content) */
  readonly systemOverhead: number;
  /** I-63: Component breakdown of systemOverhead (Phase 2B: TGP ↔ Pipeline) */
  readonly overheadBreakdown?: SystemOverheadBreakdown;
  /** Mission-level context ceiling (null = unconstrained) */
  readonly missionCeiling: number | null;
  /** Task-level context ceiling (null = unconstrained) */
  readonly taskCeiling: number | null;
}

// ============================================================================
// Dependencies — what CGP needs from the host system
// ============================================================================

/**
 * External dependencies injected into the CGP system.
 * Follows the factory pattern from CCP/EGP harnesses.
 */
export interface CGPDeps {
  /** Database connection provider */
  readonly getConnection: () => DatabaseConnection;
  /** Audit trail for replay record persistence (I-03) */
  readonly audit: AuditTrail;
  /** Event bus for admission events */
  readonly events: EventBus;
  /** WMP internal reader — P2 candidate source */
  readonly wmpReader: WmpInternalReader;
  /** Artifact collector — P3 candidate source */
  readonly artifactCollector: ArtifactCandidateCollector;
  /** Claim collector — P4 candidate source */
  readonly claimCollector: ClaimCandidateCollector;
  /** Retrieval provider — P5 candidate source */
  readonly retrievalProvider: RetrievalOutputProvider;
  /** Observation collector — P6 candidate source */
  readonly observationCollector: ObservationCollector;
  /** Conversation context — P1 instruction + P5 historical turns */
  readonly conversationContext: ConversationContextProvider;
  /** ECB provider — DBA budget computation (Phase 2B: CGP ↔ DBA wire) */
  readonly ecbProvider: EcbProvider;
  /** Hard Stop #7: Injectable clock for deterministic temporal logic. */
  readonly time: import('../../kernel/interfaces/time.js').TimeProvider;
}

// ============================================================================
// Configuration Constants — §7, §8
// ============================================================================

/** CGP configuration constants derived from the design source */
export const CGP_POSITION_COUNT = 6 as const;

/** Eviction processes these positions in this order (§7.2 Step 4) */
export const CGP_EVICTION_ORDER: readonly EvictablePosition[] = [6, 5, 4, 3, 2] as const;

/**
 * v1 limit on inputArtifactIds cardinality to prevent protection overflow (FM-CGP-02).
 * [V1-CHOICE: operational guard, not constitutional]
 */
export const CGP_MAX_INPUT_ARTIFACT_IDS = 50 as const;

// ============================================================================
// Event Types — CGP admission events
// ============================================================================

/** Event types emitted by CGP through the event bus */
export const CGP_EVENTS = {
  /** Emitted on successful context admission */
  CONTEXT_ADMITTED: 'cgp.context.admitted',
  /** Emitted on admission failure (CONTROL_STATE_OVERFLOW or CONTEXT_PROTECTION_OVERFLOW) */
  CONTEXT_ADMISSION_FAILED: 'cgp.context.admission_failed',
  /** Emitted when position starvation detected (FM-CGP-03) */
  POSITION_STARVATION: 'cgp.position.starvation',
} as const;

// ============================================================================
// Per-Position Ordering Signals — §8 (for test assertions)
// ============================================================================

/**
 * §8: Per-position eviction ordering configuration.
 * Each entry defines: primary signal, sort direction, tie-breaker.
 * "ascending" = low values evicted first.
 * "descending" = high values evicted first (P5: least-relevant rank first).
 */
// ============================================================================
// Event Payload Types — typed payloads for CGP events (DC-CGP-502/503/504)
// ============================================================================

/**
 * Payload for cgp.context.admitted event (DC-CGP-502).
 * Emitted after successful admission cycle.
 * Includes correlationId per Binding 12.
 */
export interface ContextAdmittedEventPayload {
  /** Links to DBA invocation accounting */
  readonly invocationId: ContextInvocationId;
  /** Executing task */
  readonly taskId: TaskId;
  /** Owning mission */
  readonly missionId: MissionId;
  /** P1 + admitted P2-P6 total cost */
  readonly totalAdmittedCost: number;
  /** Effective context budget from DBA */
  readonly effectiveContextBudget: number;
  /** Number of candidates evicted */
  readonly evictedCount: number;
  /** Binding 12: correlation identifier */
  readonly correlationId: string;
}

/**
 * Payload for cgp.context.admission_failed event (DC-CGP-503).
 * Emitted on CONTROL_STATE_OVERFLOW or CONTEXT_PROTECTION_OVERFLOW.
 */
export interface ContextAdmissionFailedEventPayload {
  /** Links to DBA invocation accounting */
  readonly invocationId: ContextInvocationId;
  /** Executing task */
  readonly taskId: TaskId;
  /** Owning mission */
  readonly missionId: MissionId;
  /** Specific failure reason */
  readonly admissionResult: 'CONTROL_STATE_OVERFLOW' | 'CONTEXT_PROTECTION_OVERFLOW';
  /** P1 token cost at failure */
  readonly position1Cost: number;
  /** ECB at failure */
  readonly effectiveContextBudget: number;
  /** Binding 12: correlation identifier */
  readonly correlationId: string;
}

/**
 * Payload for cgp.position.starvation event (DC-CGP-504, FM-CGP-03).
 * Emitted when ALL non-protected candidates in a position are evicted.
 */
export interface PositionStarvationEventPayload {
  /** Links to DBA invocation accounting */
  readonly invocationId: ContextInvocationId;
  /** Executing task */
  readonly taskId: TaskId;
  /** Which position was fully evicted */
  readonly positionNumber: EvictablePosition;
  /** How many candidates were evicted from this position */
  readonly evictedCount: number;
  /** Binding 12: correlation identifier */
  readonly correlationId: string;
}

// ============================================================================
// Provider Failure Policy — DC-CGP-306 (v1.1)
// ============================================================================

/**
 * DC-CGP-306: Per-provider failure policy for candidate collection.
 * Defines whether a provider failure is fatal (fails entire admission)
 * or degraded (proceeds with empty position + starvation event).
 *
 * §5 preamble: positions are independently collected.
 * Provider failure for a non-critical position should degrade, not abort.
 */
export type ProviderFailurePolicy = 'fatal' | 'degraded';

/**
 * DC-CGP-306: Provider failure behavior specification.
 * P1 (ControlStateAssembler) failure is always fatal — no admission without P1.
 * Other providers can be configured per deployment needs.
 *
 * Default policy:
 *   P1 assembler: fatal (CONTROL_STATE_OVERFLOW equivalent)
 *   P2 WMP: degraded (proceed with empty P2)
 *   P3 artifacts: degraded (proceed with empty P3)
 *   P4 claims: degraded (proceed with empty P4)
 *   P5 retrieval: degraded (proceed with empty P5)
 *   P6 observations: degraded (proceed with empty P6)
 */
export const CGP_DEFAULT_PROVIDER_FAILURE_POLICY: Readonly<Record<string, ProviderFailurePolicy>> = {
  controlStateAssembler: 'fatal',
  wmpReader: 'degraded',
  artifactCollector: 'degraded',
  claimCollector: 'degraded',
  retrievalProvider: 'degraded',
  observationCollector: 'degraded',
} as const;

// ============================================================================
// P1 Required Components — DC-CGP-110 (v1.1)
// ============================================================================

/**
 * DC-CGP-110: Required components of Position 1 (System Control State).
 * §51.1: P1 contains mission objective, task definition, budget parameters,
 * permission policies, and operational constraints.
 * ControlStateAssembler must include ALL of these in canonicalText.
 */
export const CGP_P1_REQUIRED_COMPONENTS = [
  'mission_objective',
  'task_definition',
  'budget_parameters',
  'permission_policies',
  'operational_constraints',
] as const;

export type P1RequiredComponent = typeof CGP_P1_REQUIRED_COMPONENTS[number];

// ============================================================================
// Per-Position Ordering Signals — §8 (for test assertions)
// ============================================================================

export const CGP_POSITION_ORDERING = {
  /** §8.1: P2 — mutationPosition ascending (lowest position evicted first), tie-break key ASC [I-45] */
  2: { primarySignal: 'mutationPosition', direction: 'ascending' as const, tieBreaker: 'key' },
  /** §8.2: P3 — createdAt ascending (oldest artifact evicted first), tie-break artifactId ASC */
  3: { primarySignal: 'createdAt', direction: 'ascending' as const, tieBreaker: 'artifactId' },
  /** §8.3: P4 — createdAt ascending (oldest claim evicted first), tie-break claimId ASC */
  4: { primarySignal: 'createdAt', direction: 'ascending' as const, tieBreaker: 'claimId' },
  /** §8.4: P5 — retrievalRank descending (least relevant evicted first), tie-break memoryId ASC */
  5: { primarySignal: 'retrievalRank', direction: 'descending' as const, tieBreaker: 'memoryId' },
  /** §8.5: P6 — productionOrder ascending (earliest evicted first), tie-break observationId ASC */
  6: { primarySignal: 'productionOrder', direction: 'ascending' as const, tieBreaker: 'observationId' },
} as const;
