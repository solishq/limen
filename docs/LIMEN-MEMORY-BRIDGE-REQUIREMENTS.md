<!-- @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->
# Limen v5 -- AGENT_MEMORY_BRIDGE.md Requirement Extraction

**Source:** `contracts/AGENT_MEMORY_BRIDGE.md` v1.3.1
**Extracted:** 2026-05-09
**Governing Standard:** SolisForge Protocol v1.4
**Governance Tier:** Forge Critical
**Purpose:** Every implementable requirement from the Agent Memory Bridge contract.

---

## Section 1: Purpose & Scope

| ID | Requirement | Source |
|---|---|---|
| MB-1.1 | Limen is an agent-agnostic governed memory substrate providing belief management, temporal decay, governance enforcement, and full audit provenance | S1 |
| MB-1.2 | This contract defines the universal client interface any AI agent framework uses to interact with Limen | S1 |
| MB-1.3 | All operations are session-scoped, governance-gated, and produce immutable audit entries | S1 |
| MB-1.4 | All cross-contract types referenced are defined in `contracts/SHARED_TYPES.md`; this contract does NOT redefine any shared type | Preamble |
| MB-1.5 | Contract hash MUST be tracked in `contracts/phase-x.contracts.json` | Header |

**Totals: 5 requirements**

---

## Section 2: LimenAgentClient Interface

| ID | Requirement | Source |
|---|---|---|
| MB-2.1 | `remember(ctx: GovernanceContext, content: string | StructuredContent, options?: AgentMemoryOptions)` MUST return `Promise<Result<AgentMemoryEntry>>` | S2 |
| MB-2.2 | `recall(query: AgentRecallQuery, options?: AgentRecallOptions)` MUST return `Promise<Result<AgentMemoryView[]>>` | S2 |
| MB-2.3 | `forget(ctx: GovernanceContext, entryId: ClaimId, reason: string)` MUST return `Promise<Result<void>>` | S2 |
| MB-2.4 | `getBelief(beliefId: ClaimId)` MUST return `Promise<Result<AgentBeliefState>>` | S2 |
| MB-2.5 | `relateBelief(ctx: GovernanceContext, fromId: ClaimId, toId: ClaimId, type: RelationshipType)` MUST return `Promise<Result<RelationshipId>>` | S2 |
| MB-2.6 | `createBranch(ctx: GovernanceContext, baseBeliefId: ClaimId, description: string)` MUST return `Promise<Result<AgentBranch>>` | S2 |
| MB-2.7 | `mergeBranches(ctx: GovernanceContext, branchIds: readonly AgentBranchId[], strategy: MergeStrategy)` MUST return `Promise<Result<MergeResult>>` | S2 |
| MB-2.8 | `discardBranch(ctx: GovernanceContext, branchId: AgentBranchId)` MUST return `Promise<Result<void>>` | S2 |
| MB-2.9 | `startSession(ctx: OperationContext, options: AgentSessionOptions)` MUST return `Promise<Result<AgentSession>>` | S2 |
| MB-2.10 | `endSession(ctx: OperationContext, sessionId: SessionId)` MUST return `Promise<Result<SessionSummary>>` | S2 |
| MB-2.11 | `getSessionState(sessionId: SessionId)` MUST return `Promise<Result<AgentSessionState>>` | S2 |
| MB-2.12 | `checkPermission(action: AgentAction, context: GovernanceContext)` MUST return `Promise<Result<GovernanceDecision>>` | S2 |
| MB-2.13 | `resolveConflict(mergeId: string, conflictId: string, resolution: ManualMergeResolution)` MUST return `Promise<Result<MergeConflictResolution>>` | S2 |
| MB-2.14 | `getMergeState(mergeId: string)` MUST return `Promise<Result<ManualMergeState>>` | S2 |
| MB-2.15 | `on(event: AgentEvent, handler: AgentEventHandler)` MUST return subscription ID `string` | S2 |
| MB-2.16 | `off(subscriptionId: string)` MUST unsubscribe the handler | S2 |
| MB-2.17 | `Result<T>` MUST be from SHARED_TYPES SS1.5 | S2 Note |
| MB-2.18 | All branded IDs (`ClaimId`, `RelationshipId`, `SessionId`, `AgentBranchId`, `MissionId`, `TaskId`, `AgentId`, `TenantId`, `EventId`) MUST be from SHARED_TYPES SS1.1/SS4 | S2 Note |

**Totals: 18 requirements**

---

## Section 2.1: Session-Bound Client Model

| ID | Requirement | Source |
|---|---|---|
| MB-2.19 | `LimenAgentClient` MUST be session-bound; it is NOT a standalone object | S2.1 |
| MB-2.20 | Factory function `createAgentClient(session: AgentSession)` MUST produce a `LimenAgentClient` | S2.1 |
| MB-2.21 | Read-only methods MUST implicitly operate within the bound session's `OperationContext` (constructed per SHARED_TYPES SS8) | S2.1 |
| MB-2.22 | Mutating methods MUST still receive explicit `GovernanceContext` or `OperationContext` at the public interface | S2.1 |
| MB-2.23 | Classification filtering MUST derive from `session.clearanceLevel` | S2.1 |
| MB-2.24 | Rate limiting MUST attribute to `session.agentId` | S2.1 |
| MB-2.25 | Audit entries MUST record `session.sessionId` | S2.1 |
| MB-2.26 | Client MUST become invalid after `endSession()`; subsequent calls return `{ ok: false, error: { code: 'SESSION_ENDED' } }` | S2.1 |

**Totals: 8 requirements**

---

## Section 3: Data Models

### 3.1-3.5 Shared Type References

| ID | Requirement | Source |
|---|---|---|
| MB-3.1 | `StructuredContent` is canonical shared type from SHARED_TYPES SS10.2.1 | S3.1 |
| MB-3.2 | `AgentMemoryOptions` is canonical shared type from SHARED_TYPES SS10.2.1 | S3.2 |
| MB-3.3 | `AgentMemoryEntry` is canonical shared type from SHARED_TYPES SS10.2; this contract MUST NOT redefine it | S3.3 |
| MB-3.4 | `AgentRecallQuery` is canonical shared type from SHARED_TYPES SS10.2.1 | S3.4 |
| MB-3.5 | `AgentRecallOptions` is canonical shared type from SHARED_TYPES SS10.2.1 | S3.5 |

### 3.6 AgentMemoryView

| ID | Requirement | Source |
|---|---|---|
| MB-3.6 | `AgentMemoryView.entry` MUST be readonly `AgentMemoryEntry` | S3.6 |
| MB-3.7 | `AgentMemoryView.relevanceScore` MUST be readonly number | S3.6 |
| MB-3.8 | `AgentMemoryView.decayInfo` MUST be readonly `DecayInfo` | S3.6 |
| MB-3.9 | `AgentMemoryView.evidence` MUST be optional `readonly EvidenceRef[]` | S3.6 |
| MB-3.10 | `AgentMemoryView.relationships` MUST be optional `readonly RelationshipRef[]` | S3.6 |
| MB-3.11 | `DecayInfo.currentConfidence` MUST be readonly number | S3.6 |
| MB-3.12 | `DecayInfo.stabilityDays` MUST be readonly number | S3.6 |
| MB-3.13 | `DecayInfo.projectedFreshness` MUST be readonly `FreshnessLabel` from SHARED_TYPES SS2 | S3.6 |
| MB-3.14 | `DecayInfo.daysUntilStale` MUST be readonly number | S3.6 |

### 3.7-3.9 Shared Type References

| ID | Requirement | Source |
|---|---|---|
| MB-3.15 | `AgentBeliefState` is canonical shared type alias to `BeliefState` from SHARED_TYPES SS10.2 | S3.7 |
| MB-3.16 | `EvidenceRef` is canonical shared type from SHARED_TYPES SS10.2 | S3.8 |
| MB-3.17 | `RelationshipRef` is canonical shared type from SHARED_TYPES SS10.2 | S3.9 |

**Totals: 17 requirements**

---

## Section 3 (continued): Local Data Models

### 3.10 AgentBranch

| ID | Requirement | Source |
|---|---|---|
| MB-3.18 | `AgentBranch.id` MUST be readonly `AgentBranchId` from SHARED_TYPES SS4 | S3.10 |
| MB-3.19 | `AgentBranch.baseBeliefId` MUST be readonly `ClaimId` | S3.10 |
| MB-3.20 | `AgentBranch.description` MUST be readonly string | S3.10 |
| MB-3.21 | `AgentBranch.claims` MUST be `readonly ClaimId[]` | S3.10 |
| MB-3.22 | `AgentBranch.createdAt` MUST be readonly string (ISO-8601) | S3.10 |
| MB-3.23 | `AgentBranch.createdBy` MUST be readonly `AgentId` | S3.10 |
| MB-3.24 | `AgentBranch.merged` MUST be readonly boolean | S3.10 |
| MB-3.25 | `AgentBranch.mergedAt` MUST be `readonly string | null` | S3.10 |

### 3.11 MergeResult

| ID | Requirement | Source |
|---|---|---|
| MB-3.26 | `MergeResult.mergedClaims` MUST be `readonly AgentMemoryEntry[]` | S3.11 |
| MB-3.27 | `MergeResult.conflictsResolved` MUST be `readonly MergeConflictResolution[]` from SHARED_TYPES SS14.2 | S3.11 |
| MB-3.28 | `MergeResult.unresolvedConflicts` MUST be `readonly MergeConflict[]` from SHARED_TYPES SS14.2 | S3.11 |
| MB-3.29 | `MergeResult.status` MUST be `'complete' | 'pending_resolution'` | S3.11 |
| MB-3.30 | `MergeResult.manualMergeState` MUST be optional `ManualMergeState` from SHARED_TYPES SS14.2; present when strategy is `'manual'` | S3.11 |

### 3.12 AgentSessionOptions

| ID | Requirement | Source |
|---|---|---|
| MB-3.31 | `AgentSessionOptions` MUST have readonly fields: `agentId: AgentId`, `adapterId: AdapterId` | S3.12 |
| MB-3.32 | `AgentSessionOptions` MUST have optional readonly fields: `tenantId`, `capabilities`, `trustLevel`, `sessionTimeout`, `workingMemoryNamespace` | S3.12 |
| MB-3.33 | `AgentSessionOptions.capabilities` MUST use `AgentCapability[]` from SHARED_TYPES SS6 | S3.12 |

**Totals: 16 requirements**

---

## Section 3 (continued): Session & Governance Models

### 3.13 AgentSessionState

| ID | Requirement | Source |
|---|---|---|
| MB-3.34 | `AgentSessionState.session` MUST be readonly `AgentSession` from SHARED_TYPES SS7 | S3.13 |
| MB-3.35 | `AgentSessionState` MUST have readonly numeric fields: `claimsAsserted`, `claimsRetracted`, `branchesActive`, `workingMemoryEntries`, `governanceRefusals` | S3.13 |
| MB-3.36 | `AgentSessionState.lastActivityAt` MUST be readonly string (ISO-8601) | S3.13 |

### 3.14-3.15

| ID | Requirement | Source |
|---|---|---|
| MB-3.37 | `GovernanceDecision` is canonical shared type from SHARED_TYPES SS10.1 | S3.14 |
| MB-3.38 | `AgentAction` MUST be union: `'remember' | 'recall' | 'forget' | 'create_branch' | 'merge_branch' | 'resolve_conflict' | 'get_merge_state' | 'relate' | 'classify' | 'export'` (10 values) | S3.15 |

**Totals: 5 requirements**

---

## Section 4: Error Types

| ID | Requirement | Source |
|---|---|---|
| MB-4.1 | Error `GOVERNANCE_REFUSAL` MUST include: `reason: string`, `rule: string`, `action: AgentAction` | S4 |
| MB-4.2 | Error `CONFIDENCE_CEILING` MUST include: `requested: number`, `maximum: number`, `sourceType: string` | S4 |
| MB-4.3 | Error `CLASSIFICATION_DENIED` MUST include: `required: ClassificationLevel`, `agentLevel: number` | S4 |
| MB-4.4 | Error `BRANCH_CONFLICT` MUST include: `conflicts: readonly MergeConflict[]` | S4 |
| MB-4.5 | Error `SESSION_EXPIRED` MUST include: `sessionId: SessionId`, `expiredAt: string` | S4 |
| MB-4.6 | Error `QUOTA_EXCEEDED` MUST include: `dimension: 'token' | 'deliberation'`, `used: number`, `limit: number` | S4 |
| MB-4.7 | Error `GROUNDING_FAILED` MUST include: `reason: string`, optional `claimId?: ClaimId` | S4 |
| MB-4.8 | Error `BELIEF_NOT_FOUND` MUST include: `beliefId: ClaimId` | S4 |
| MB-4.9 | Error `BRANCH_NOT_FOUND` MUST include: `branchId: AgentBranchId` | S4 |
| MB-4.10 | Error `MERGE_NOT_FOUND` MUST include: `mergeId: string` | S4 |
| MB-4.11 | Error `MERGE_CONFLICT_NOT_FOUND` MUST include: `mergeId: string`, `conflictId: string` | S4 |
| MB-4.12 | Error `INVALID_MERGE_RESOLUTION` MUST include: `resolution: string`, `reason: string` | S4 |
| MB-4.13 | Error `SESSION_NOT_FOUND` MUST include: `sessionId: SessionId` | S4 |
| MB-4.14 | Error `CONSENT_REQUIRED` MUST include: `dataSubjectId: string`, `purpose: ConsentPurpose`, `operation: ConsentableOperation` | S4 |

**Totals: 14 requirements**

---

## Section 4 (continued): Additional Error

| ID | Requirement | Source |
|---|---|---|
| MB-4.15 | Error `SESSION_ENDED` MUST include: `sessionId: SessionId` | S4 |

**Totals: 1 requirement**

---

## Section 5: NonAuthoritative Mode

| ID | Requirement | Source |
|---|---|---|
| MB-5.1 | `NonAuthoritativeContext.branchId` MUST be readonly `AgentBranchId` from SHARED_TYPES SS4 | S5 |
| MB-5.2 | `NonAuthoritativeContext.maxConfidence` MUST be fixed at `0.5` | S5 |
| MB-5.3 | `NonAuthoritativeContext.groundingMode` MUST be `'runtime_witness'` | S5 |
| MB-5.4 | `NonAuthoritativeContext.isolationLevel` MUST be `'full'` | S5 |
| MB-5.5 | `NonAuthoritativeContext.autoCleanup` MUST be boolean | S5 |
| MB-5.6 | `NonAuthoritativeContext.parentBeliefId` MUST be readonly `ClaimId` | S5 |
| MB-5.6a | `NonAuthoritativeContext.createdAt` MUST be readonly string (ISO-8601) recording when the non-authoritative context was established | S5 |
| MB-5.7 | `createBranch()` MUST create an isolated namespace for branch claims | S5 Lifecycle |
| MB-5.8 | All `remember()` calls within branch context MUST inherit NonAuthoritativeContext constraints | S5 Lifecycle |
| MB-5.9 | Branch claims MUST be invisible to `recall()` outside the branch unless explicitly included | S5 Lifecycle |
| MB-5.10 | `mergeBranches()` MUST promote selected claims to authoritative with confidence re-evaluated, capped at 0.7 | S5 Lifecycle |
| MB-5.11 | `discardBranch()` MUST tombstone all branch claims; no trace in authoritative graph | S5 Lifecycle |
| MB-5.12 | On `endSession()`, unmerged branches MUST be auto-discarded if `autoCleanup: true` | S5 Lifecycle |
| MB-5.13 | Merge promotes claims individually; partial merge MUST be valid | S5 Constraints |
| MB-5.14 | Branches MUST NOT nest; a branch claim cannot be a base for another branch | S5 Constraints |

**Totals: 15 requirements**

---

## Section 5 (continued): Branch Constraints

| ID | Requirement | Source |
|---|---|---|
| MB-5.15 | Branch claims MUST NEVER appear in authoritative recall results | S5 Constraints |
| MB-5.16 | Confidence on merge MUST be `min(original_confidence, 0.7)` for programmer-sourced claims | S5 Constraints |
| MB-5.17 | Branch-to-branch relationships MUST be discarded on merge; only claim content survives | S5 Constraints |

**Totals: 3 requirements**

---

## Section 6: Rust Trait (v5 Alignment)

### Rust Structs

| ID | Requirement | Source |
|---|---|---|
| MB-6.1 | Rust `AgentMetadata` MUST derive `Debug, Clone, Serialize, Deserialize` | S6 |
| MB-6.2 | Rust `AgentMetadata` MUST have fields: `confidence: Option<f64>`, `reasoning: Option<String>`, `classification: Option<ClassificationLevel>`, `tags: Vec<String>`, `category: Option<String>`, `mission_id: Option<String>`, `task_id: Option<String>`, `grounding_mode: Option<GroundingMode>`, `retention_days: Option<u32>` | S6 |
| MB-6.3 | Rust `GovernanceDirective` MUST have fields: `required_classification: Option<ClassificationLevel>`, `max_confidence: Option<f64>`, `audit_reason: Option<String>`, `consent_gate: bool` | S6 |
| MB-6.4 | Rust `GovernanceDirective.consent_gate` = `true` means consent check is mandatory | S6 |
| MB-6.5 | Rust `GroundingMode` enum MUST have variants: `EvidencePath`, `RuntimeWitness` | S6 |

### Rust Error Type

| ID | Requirement | Source |
|---|---|---|
| MB-6.6 | Rust `AgentError` enum MUST derive `Debug, Clone, Serialize, Deserialize` | S6 |
| MB-6.7 | Rust `AgentError::GovernanceRefusal` MUST have fields: `reason: String`, `rule: String`, `action: String` | S6 |
| MB-6.8 | Rust `AgentError::ConfidenceCeiling` MUST have fields: `requested: f64`, `maximum: f64`, `source_type: String` | S6 |
| MB-6.9 | Rust `AgentError::ClassificationDenied` MUST have fields: `required: ClassificationLevel`, `agent_level: u8` | S6 |
| MB-6.10 | Rust `AgentError::BranchConflict` MUST have fields: `conflict_count: usize`, `description: String` | S6 |
| MB-6.11 | Rust `AgentError::SessionExpired` MUST have fields: `session_id: String`, `expired_at: String` | S6 |
| MB-6.12 | Rust `AgentError::QuotaExceeded` MUST have fields: `dimension: String`, `used: u64`, `limit: u64` | S6 |
| MB-6.13 | Rust `AgentError::GroundingFailed` MUST have fields: `reason: String`, `claim_id: Option<String>` | S6 |
| MB-6.14 | Rust `AgentError::ConsentRequired` MUST have fields: `data_subject_id: String`, `purpose: String`, `operation: String` | S6 |
| MB-6.15 | Rust `AgentError::SessionEnded` MUST have field: `session_id: String` | S6 |
| MB-6.16 | Rust `AgentError::Internal` MUST have field: `message: String` | S6 |
| MB-6.17 | Rust `AgentError` MUST have 15 total variants matching TypeScript errors plus `Internal` | S6 |

### Rust Trait

| ID | Requirement | Source |
|---|---|---|
| MB-6.18 | Rust trait `AgentMemoryBridge` MUST be `Send + Sync` | S6 |
| MB-6.19 | `remember` MUST take `(&self, ctx: &GovernanceContext, content: &str, options: Option<&AgentMemoryOptions>)` | S6 |
| MB-6.20 | `recall` MUST take `(&self, query: &AgentRecallQuery, options: Option<&AgentRecallOptions>)` | S6 |
| MB-6.21 | `forget` MUST take `(&self, ctx: &GovernanceContext, entry_id: &str, reason: &str)` | S6 |
| MB-6.22 | `create_branch` MUST take `(&self, ctx: &GovernanceContext, base_belief_id: &str, description: &str)` | S6 |
| MB-6.23 | `merge_branches` MUST take `(&self, ctx: &GovernanceContext, branch_ids: &[String], strategy: MergeStrategy)` | S6 |
| MB-6.24 | `start_session` MUST take `(&self, ctx: &OperationContext, options: AgentSessionOptions)` | S6 |
| MB-6.25 | `resolve_conflict` MUST take `(&self, merge_id: &str, conflict_id: &str, resolution: ManualMergeResolution)` | S6 |
| MB-6.26 | `get_merge_state` MUST take `(&self, merge_id: &str)` and return `Result<ManualMergeState, AgentError>` | S6 |
| MB-6.27 | Rust struct equivalents for local types MUST mirror TypeScript interfaces with snake_case and `Option<T>` for nullable fields | S6 Note |

> **NOTE (P2-3):** Rust `AgentError::BranchConflict` has fields `conflict_count: usize, description: String`, while TypeScript `BRANCH_CONFLICT` has `conflicts: readonly MergeConflict[]`. The Rust variant is a lossy projection — it loses the full conflict list, retaining only count and description. If the Rust consumer needs individual conflict details for resolution, this is insufficient. The Rust error should either carry `Vec<MergeConflict>` or the full conflict list must be retrievable via a separate query.

> **NOTE (P2-4):** Rust struct field-level requirements (e.g., `AgentMetadata` fields in MB-6.2) are extracted at the struct level. Individual field-level constraints (nullability, default values, validation ranges) that exist in local Rust struct definitions are not individually extracted as separate requirements. This is acceptable for extraction but means the implementation must cross-reference the Rust source for per-field constraints.

> **NOTE (P2-5):** The integration map (S7) notes that `recall` events are "(sampled)" — meaning not every recall invocation emits an event. The sampling qualifier is documented but the sampling rate, configuration mechanism, and conditions under which sampling is applied are not specified. Implementation MUST define a deterministic sampling policy.

> **NOTE (P2-6):** The source contract contains usage examples (S2.1, S5) that embed behavioral patterns (e.g., session lifecycle flow, branch-then-merge workflow). These examples are illustrative, not normative, but contain implicit ordering constraints that are captured in the invariants (S9). No additional requirements extracted from examples beyond what invariants already cover.

**Totals: 27 requirements**

---

## Section 7: Integration Map

| ID | Requirement | Source |
|---|---|---|
| MB-7.1 | `remember` MUST map to SC-11 (`assert_claim`) with governance + confidence ceiling + classification + consent check | S7 |
| MB-7.2 | `remember` MUST emit `memory:created` audit event | S7 |
| MB-7.3 | `remember` consent gate: REQUIRED when predicate matches `personal.*`, `user.*`, `identity.*` or classification is `restricted`/`critical` | S7 |
| MB-7.4 | `recall` MUST map to SC-13 (`query_claims`) with exact/prefix/full-text query modes + FSRS decay | S7 |
| MB-7.5 | `recall` MUST enforce classification clearance per unified trust/clearance model SS5 | S7 |
| MB-7.6 | `forget` MUST map to `retract_claim` + cascade evaluation with governance + ownership check | S7 |
| MB-7.7 | `forget` MUST emit `memory:forgotten` audit event | S7 |
| MB-7.8 | `getBelief` MUST map to SC-13 + evidence query + relationship query with classification clearance | S7 |
| MB-7.9 | `relateBelief` MUST map to SC-12 (`relate_claims`) with governance + claim ownership | S7 |
| MB-7.10 | `createBranch` MUST map to SC-11 with NonAuthoritativeContext isolation; requires session valid + quota | S7 |
| MB-7.11 | `mergeBranches` MUST map to SC-11 (new authoritative) + SC-12 (relationships) + retract branch claims | S7 |
| MB-7.12 | `discardBranch` MUST tombstone all branch claims; requires session valid + branch ownership | S7 |
| MB-7.13 | `startSession` MUST create session + init working memory namespace (SC-14); requires agent registered + tenant valid | S7 |
| MB-7.14 | `endSession` MUST produce session summary + branch cleanup + working memory flush; requires session ownership | S7 |
| MB-7.15 | `resolveConflict` MUST map to SC-11 (assert winning) + `retract_claim` (loser) + SC-12 (supersedes) | S7 |
| MB-7.16 | `getMergeState` MUST query `ManualMergeState` from session working memory | S7 |
| MB-7.17 | `on`/`off` MUST use unified event bus subscription from SHARED_TYPES SS16.2; requires session valid | S7 |

**Totals: 17 requirements**

---

## Section 7 (continued): Consent Check Logic

| ID | Requirement | Source |
|---|---|---|
| MB-7.18 | `remember()` implementation MUST evaluate consent requirements BEFORE persisting | S7 Consent |
| MB-7.19 | Consent REQUIRED when predicate matches personal data patterns (`personal.*`, `user.*`, `identity.*`) | S7 Consent |
| MB-7.20 | Consent REQUIRED when classification is `restricted` or `critical` | S7 Consent |
| MB-7.21 | Consent REQUIRED when agent operates on behalf of a data subject (via `GovernanceContext.session.metadata`) | S7 Consent |
| MB-7.22 | When consent required but not granted: MUST return `AgentMemoryError` with code `CONSENT_REQUIRED` | S7 Consent |

**Totals: 5 requirements**

---

> **NOTE (P3-7):** Section numbering skips from S7 to S9. There is no Section 8 in this extraction. This mirrors the source contract structure where Section 8 (Event System) content is absorbed into the Integration Map (S7) and Invariants (S9). No requirements are missing; the numbering gap is intentional alignment with the source contract.

## Section 9: Invariants

| ID | Requirement | Source |
|---|---|---|
| MB-9.1 | Agent confidence MUST never exceed `maxAutoConfidence` (0.7) for programmer-sourced claims | S9 Inv1 |
| MB-9.2 | NonAuthoritative claims MUST never exceed 0.5 confidence | S9 Inv2 |
| MB-9.3 | All memory operations MUST require a valid, non-expired session | S9 Inv3 |
| MB-9.4 | Governance gate MUST fire before every write operation (`remember`, `forget`, `relateBelief`, `createBranch`, `mergeBranches`, `discardBranch`) using explicit `GovernanceContext`; session start/end use explicit `OperationContext` | S9 Inv4 |
| MB-9.5 | Every write operation MUST produce an immutable audit entry with `EventId` | S9 Inv5 |
| MB-9.6 | Branch isolation MUST be total; no cross-contamination with authoritative belief state | S9 Inv6 |
| MB-9.7 | Session cleanup MUST be guaranteed: unmerged branches discarded, working memory flushed | S9 Inv7 |
| MB-9.8 | Classification enforcement MUST use unified trust/clearance model (SHARED_TYPES SS5); agents cannot read claims above their derived `clearanceLevel` | S9 Inv8 |
| MB-9.9 | FSRS decay MUST apply on every read; no stale confidence values served to callers | S9 Inv9 |
| MB-9.10 | All IDs MUST be branded types from SHARED_TYPES SS1.1/SS4; no string confusion across ID domains | S9 Inv10 |
| MB-9.11 | Governance refusals MUST be non-bypassable; no client-side override path exists | S9 Inv11 |
| MB-9.12 | Evidence chain integrity: tombstoned evidence MUST trigger confidence re-evaluation | S9 Inv12 |
| MB-9.13 | Merge operations MUST be atomic; partial merge failure rolls back all changes | S9 Inv13 |
| MB-9.14 | Event handlers MUST execute asynchronously via unified event bus (SHARED_TYPES SS16.2); handler failure MUST NOT block the operation | S9 Inv14 |
| MB-9.15 | Session timeout enforcement MUST be server-side; client cannot extend without re-authentication | S9 Inv15 |
| MB-9.16 | Consent gate MUST fire on `remember()` when content contains personal data identifiers; violation returns `CONSENT_REQUIRED` | S9 Inv16 |
| MB-9.17 | Trust level promotion MUST follow unified requirements from SHARED_TYPES SS5.2; capability access is trust-gated per SS6.1 | S9 Inv17 |
| MB-9.18 | Session termination with pending manual merge: `endSession()` MUST transition all pending merges to `'discarded'`, discard all unmerged branch claims, record forced-termination audit entry | S9 Inv18 |
| MB-9.19 | Manual conflict resolution is total: each `MergeConflict.conflictId` resolved exactly once via `resolveConflict()`; duplicate or unknown IDs return `MERGE_CONFLICT_NOT_FOUND` | S9 Inv19 |

**Totals: 19 requirements**

---

## Grand Total

| Section | Count |
|---|---|
| S1: Purpose & Scope | 5 |
| S2: Interface | 18 |
| S2.1: Session-Bound Client | 8 |
| S3: Data Models (Shared Refs) | 17 |
| S3: Data Models (Local) | 16 |
| S3: Session & Governance | 5 |
| S4: Error Types | 15 |
| S5: NonAuthoritative Mode | 18 |
| S6: Rust Trait | 27 |
| S7: Integration Map | 17 |
| S7: Consent Check Logic | 5 |
| S9: Invariants | 19 |
| **Grand Total** | **170** |
