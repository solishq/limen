# Agent Memory Bridge Contract v1.3.1

**Status:** RATIFIED DESIGN — Pending Implementation
**Governing:** CDM v2.1 + Contract Compliance v2.1
**Scope:** Universal agent-to-Limen memory interface
**Contract Hash:** Tracked in `contracts/phase-x.contracts.json`
**Date:** 2026-05-05

**Shared Types:** All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`. This contract does NOT redefine any shared type. Local types are contract-specific and not used by other contracts.

---

## 1. Purpose

Limen is an agent-agnostic governed memory substrate providing belief management, temporal decay, governance enforcement, and full audit provenance. This contract defines the universal client interface any AI agent framework uses to interact with Limen's belief system, governance infrastructure, and branched exploration capabilities. All operations are session-scoped, governance-gated, and produce immutable audit entries.

## 2. LimenAgentClient Interface

```typescript
interface LimenAgentClient {
  // Memory Operations
  remember(ctx: GovernanceContext, content: string | StructuredContent, options?: AgentMemoryOptions): Promise<Result<AgentMemoryEntry>>;
  recall(query: AgentRecallQuery, options?: AgentRecallOptions): Promise<Result<AgentMemoryView[]>>;
  forget(ctx: GovernanceContext, entryId: ClaimId, reason: string): Promise<Result<void>>;

  // Belief Operations
  getBelief(beliefId: ClaimId): Promise<Result<AgentBeliefState>>;
  relateBelief(ctx: GovernanceContext, fromId: ClaimId, toId: ClaimId, type: RelationshipType): Promise<Result<RelationshipId>>;

  // Branch Operations (NonAuthoritative exploration)
  createBranch(ctx: GovernanceContext, baseBeliefId: ClaimId, description: string): Promise<Result<AgentBranch>>;
  mergeBranches(ctx: GovernanceContext, branchIds: readonly AgentBranchId[], strategy: MergeStrategy): Promise<Result<MergeResult>>;
  discardBranch(ctx: GovernanceContext, branchId: AgentBranchId): Promise<Result<void>>;

  // Session Management
  startSession(ctx: OperationContext, options: AgentSessionOptions): Promise<Result<AgentSession>>;
  endSession(ctx: OperationContext, sessionId: SessionId): Promise<Result<SessionSummary>>;
  getSessionState(sessionId: SessionId): Promise<Result<AgentSessionState>>;

  // Governance
  checkPermission(action: AgentAction, context: GovernanceContext): Promise<Result<GovernanceDecision>>;

  // Manual Merge Resolution (See SHARED_TYPES.md §14.2)
  resolveConflict(mergeId: string, conflictId: string, resolution: ManualMergeResolution): Promise<Result<MergeConflictResolution>>;
  getMergeState(mergeId: string): Promise<Result<ManualMergeState>>;

  // Events (uses unified event system)
  on(event: AgentEvent, handler: AgentEventHandler): string;
  off(subscriptionId: string): void;
}
```

**Shared type references in interface:**
- `Result<T>` — See `SHARED_TYPES.md` §1.5
- `ClaimId`, `RelationshipId`, `SessionId`, `AgentBranchId`, `MissionId`, `TaskId`, `AgentId`, `TenantId`, `EventId` — See `SHARED_TYPES.md` §1.1, §4
- `RelationshipType` — See `SHARED_TYPES.md` §2
- `MergeStrategy` — See `SHARED_TYPES.md` §14
- `ManualMergeResolution` — See `SHARED_TYPES.md` §14.2
- `AgentSession` — See `SHARED_TYPES.md` §7
- `SessionSummary` — See `SHARED_TYPES.md` §15
- `OperationContext` — See `SHARED_TYPES.md` §1.3
- `GovernanceContext` — See `SHARED_TYPES.md` §9
- `StructuredContent`, `AgentMemoryOptions`, `AgentRecallQuery`, `AgentRecallOptions` — See `SHARED_TYPES.md` §10.2.1
- `AgentEvent`, `AgentEventHandler` — See `SHARED_TYPES.md` §16

### 2.1 Session-Bound Client Model

`LimenAgentClient` is a session-bound instance. It is NOT a standalone object — it is created by and bound to an `AgentSession`.

**Factory:**
```typescript
function createAgentClient(session: AgentSession): LimenAgentClient;
```

Read-only methods on the returned client implicitly operate within the bound session's `OperationContext` (constructed per SHARED_TYPES.md §8). Mutating methods still receive explicit `GovernanceContext` or `OperationContext` at the public interface to preserve the Phase X governance-closure invariant. For session-implicit reads:
- Classification filtering derives from `session.clearanceLevel`
- Rate limiting attributes to `session.agentId`
- Audit entries record `session.sessionId`
- The client instance supplies the read context; callers cannot override session identity

The client becomes invalid after `endSession()` — any subsequent method call returns `{ ok: false, error: { code: 'SESSION_ENDED' } }`.

## 3. Data Models

### 3.1 StructuredContent

Canonical shared type. See `SHARED_TYPES.md` §10.2.1.

### 3.2 AgentMemoryOptions

Canonical shared type. See `SHARED_TYPES.md` §10.2.1.

### 3.3 AgentMemoryEntry

Canonical shared type. See `SHARED_TYPES.md` §10.2. This contract produces and consumes `AgentMemoryEntry` but does not redefine it.

### 3.4 AgentRecallQuery

Canonical shared type. See `SHARED_TYPES.md` §10.2.1.

### 3.5 AgentRecallOptions

Canonical shared type. See `SHARED_TYPES.md` §10.2.1.

### 3.6 AgentMemoryView

```typescript
interface AgentMemoryView {
  readonly entry: AgentMemoryEntry;
  readonly relevanceScore: number;
  readonly decayInfo: DecayInfo;
  readonly evidence?: readonly EvidenceRef[];
  readonly relationships?: readonly RelationshipRef[];
}

interface DecayInfo {
  readonly currentConfidence: number;
  readonly stabilityDays: number;
  readonly projectedFreshness: FreshnessLabel; // See SHARED_TYPES.md §2
  readonly daysUntilStale: number;
}
```

### 3.7 AgentBeliefState

Canonical shared type alias to `BeliefState`. See `SHARED_TYPES.md` §10.2. Memory Bridge may enrich the state with local query projections, but the transport type remains the shared `AgentBeliefState`.

### 3.8 EvidenceRef

Canonical shared type. See `SHARED_TYPES.md` §10.2.

### 3.9 RelationshipRef

Canonical shared type. See `SHARED_TYPES.md` §10.2.

### 3.10 AgentBranch

```typescript
interface AgentBranch {
  readonly id: AgentBranchId; // See SHARED_TYPES.md §4
  readonly baseBeliefId: ClaimId;
  readonly description: string;
  readonly claims: readonly ClaimId[];
  readonly createdAt: string;
  readonly createdBy: AgentId;
  readonly merged: boolean;
  readonly mergedAt: string | null;
}
```

### 3.11 MergeResult

```typescript
interface MergeResult {
  readonly mergedClaims: readonly AgentMemoryEntry[];
  readonly conflictsResolved: readonly MergeConflictResolution[]; // See SHARED_TYPES.md §14.2
  readonly unresolvedConflicts: readonly MergeConflict[]; // See SHARED_TYPES.md §14.2
  readonly status: 'complete' | 'pending_resolution';
  readonly manualMergeState?: ManualMergeState; // See SHARED_TYPES.md §14.2 — present when strategy is 'manual'
}
```

**MergeStrategy::Manual semantics:** See `SHARED_TYPES.md` §14.2 for complete manual merge lifecycle including conflict resolution options, timeout behavior, and auto-cleanup semantics.

### 3.12 AgentSessionOptions

```typescript
interface AgentSessionOptions {
  readonly agentId: AgentId;
  readonly tenantId?: TenantId;
  readonly adapterId: AdapterId; // See SHARED_TYPES.md §4
  readonly capabilities?: readonly AgentCapability[]; // See SHARED_TYPES.md §6
  readonly trustLevel?: AgentTrustLevel; // See SHARED_TYPES.md §5
  readonly sessionTimeout?: number;
  readonly workingMemoryNamespace?: string;
}
```

### 3.13 AgentSessionState

```typescript
interface AgentSessionState {
  readonly session: AgentSession; // See SHARED_TYPES.md §7
  readonly claimsAsserted: number;
  readonly claimsRetracted: number;
  readonly branchesActive: number;
  readonly workingMemoryEntries: number;
  readonly governanceRefusals: number;
  readonly lastActivityAt: string;
}
```

### 3.14 GovernanceDecision

Canonical shared type. See `SHARED_TYPES.md` §10.1.

### 3.15 AgentAction

```typescript
type AgentAction = 'remember' | 'recall' | 'forget' | 'create_branch' | 'merge_branch' | 'resolve_conflict' | 'get_merge_state' | 'relate' | 'classify' | 'export';

// ManualMergeResolution is canonical in SHARED_TYPES.md §14.2.
```

## 4. Error Types

```typescript
type AgentMemoryError =
  | { readonly code: 'GOVERNANCE_REFUSAL'; readonly reason: string; readonly rule: string; readonly action: AgentAction }
  | { readonly code: 'CONFIDENCE_CEILING'; readonly requested: number; readonly maximum: number; readonly sourceType: string }
  | { readonly code: 'CLASSIFICATION_DENIED'; readonly required: ClassificationLevel; readonly agentLevel: number }
  | { readonly code: 'BRANCH_CONFLICT'; readonly conflicts: readonly MergeConflict[] }
  | { readonly code: 'SESSION_EXPIRED'; readonly sessionId: SessionId; readonly expiredAt: string }
  | { readonly code: 'QUOTA_EXCEEDED'; readonly dimension: 'token' | 'deliberation'; readonly used: number; readonly limit: number }
  | { readonly code: 'GROUNDING_FAILED'; readonly reason: string; readonly claimId?: ClaimId }
  | { readonly code: 'BELIEF_NOT_FOUND'; readonly beliefId: ClaimId }
  | { readonly code: 'BRANCH_NOT_FOUND'; readonly branchId: AgentBranchId }
  | { readonly code: 'MERGE_NOT_FOUND'; readonly mergeId: string }
  | { readonly code: 'MERGE_CONFLICT_NOT_FOUND'; readonly mergeId: string; readonly conflictId: string }
  | { readonly code: 'INVALID_MERGE_RESOLUTION'; readonly resolution: string; readonly reason: string }
  | { readonly code: 'SESSION_NOT_FOUND'; readonly sessionId: SessionId }
  | { readonly code: 'CONSENT_REQUIRED'; readonly dataSubjectId: string; readonly purpose: ConsentPurpose; readonly operation: ConsentableOperation }
  | { readonly code: 'SESSION_ENDED'; readonly sessionId: SessionId };
```

## 5. NonAuthoritative Mode

NonAuthoritative mode enables speculative exploration without polluting the authoritative belief graph. All branch claims are isolated, confidence-capped, and subject to automatic cleanup.

```typescript
interface NonAuthoritativeContext {
  readonly branchId: AgentBranchId; // See SHARED_TYPES.md §4
  readonly maxConfidence: 0.5;
  readonly groundingMode: 'runtime_witness';
  readonly isolationLevel: 'full';
  readonly autoCleanup: boolean;
  readonly createdAt: string;
  readonly parentBeliefId: ClaimId;
}
```

**Lifecycle:**
1. Agent calls `createBranch(ctx, baseBeliefId, description)` — engine creates isolated namespace
2. All `remember()` calls within branch context inherit NonAuthoritativeContext constraints
3. Branch claims are invisible to `recall()` outside the branch unless explicitly included
4. `mergeBranches()` promotes selected claims to authoritative (confidence re-evaluated, capped at 0.7)
5. `discardBranch()` tombstones all branch claims — no trace in authoritative graph
6. On `endSession()`, unmerged branches are auto-discarded if `autoCleanup: true`

**Constraints:**
- Branch claims NEVER appear in authoritative recall results
- Merge promotes claims individually — partial merge is valid
- Confidence on merge is `min(original_confidence, 0.7)` for programmer-sourced
- Branch-to-branch relationships are discarded on merge; only claim content survives
- Branches cannot nest — a branch claim cannot be a base for another branch

## 6. Rust Trait (v5 Alignment)

```rust
use std::future::Future;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentMetadata {
    pub confidence: Option<f64>,
    pub reasoning: Option<String>,
    pub classification: Option<ClassificationLevel>, // See SHARED_TYPES.md §25
    pub tags: Vec<String>,
    pub category: Option<String>,
    pub mission_id: Option<String>,
    pub task_id: Option<String>,
    pub grounding_mode: Option<GroundingMode>,
    pub retention_days: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GovernanceDirective {
    pub required_classification: Option<ClassificationLevel>,
    pub max_confidence: Option<f64>,
    pub audit_reason: Option<String>,
    pub consent_gate: bool, // When true, consent check is mandatory
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub enum GroundingMode {
    EvidencePath,
    RuntimeWitness,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum AgentError {
    GovernanceRefusal { reason: String, rule: String, action: String },
    ConfidenceCeiling { requested: f64, maximum: f64, source_type: String },
    ClassificationDenied { required: ClassificationLevel, agent_level: u8 },
    BranchConflict { conflict_count: usize, description: String },
    SessionExpired { session_id: String, expired_at: String },
    QuotaExceeded { dimension: String, used: u64, limit: u64 },
    GroundingFailed { reason: String, claim_id: Option<String> },
    BeliefNotFound { belief_id: String },
    BranchNotFound { branch_id: String },
    MergeNotFound { merge_id: String },
    MergeConflictNotFound { merge_id: String, conflict_id: String },
    InvalidMergeResolution { resolution: String, reason: String },
    SessionNotFound { session_id: String },
    ConsentRequired { data_subject_id: String, purpose: String, operation: String },
    SessionEnded { session_id: String },
    Internal { message: String },
}

pub trait AgentMemoryBridge: Send + Sync {
    fn remember(
        &self,
        ctx: &GovernanceContext,
        content: &str,
        options: Option<&AgentMemoryOptions>,
    ) -> impl Future<Output = Result<AgentMemoryEntry, AgentError>> + Send;

    fn recall(
        &self,
        query: &AgentRecallQuery,
        options: Option<&AgentRecallOptions>,
    ) -> impl Future<Output = Result<Vec<AgentMemoryView>, AgentError>> + Send;

    fn forget(
        &self,
        ctx: &GovernanceContext,
        entry_id: &str,
        reason: &str,
    ) -> impl Future<Output = Result<(), AgentError>> + Send;

    fn get_belief_state(
        &self,
        belief_id: &str,
    ) -> impl Future<Output = Result<AgentBeliefState, AgentError>> + Send;

    fn relate_belief(
        &self,
        ctx: &GovernanceContext,
        from_id: &str,
        to_id: &str,
        relation_type: RelationshipType, // See SHARED_TYPES.md §25
    ) -> impl Future<Output = Result<String, AgentError>> + Send;

    fn create_branch(
        &self,
        ctx: &GovernanceContext,
        base_belief_id: &str,
        description: &str,
    ) -> impl Future<Output = Result<AgentBranch, AgentError>> + Send;

    fn merge_branches(
        &self,
        ctx: &GovernanceContext,
        branch_ids: &[String], // AgentBranchId
        strategy: MergeStrategy, // See SHARED_TYPES.md §25
    ) -> impl Future<Output = Result<MergeResult, AgentError>> + Send;

    fn discard_branch(
        &self,
        ctx: &GovernanceContext,
        branch_id: &str,
    ) -> impl Future<Output = Result<(), AgentError>> + Send;

    fn start_session(
        &self,
        ctx: &OperationContext,
        options: AgentSessionOptions,
    ) -> impl Future<Output = Result<AgentSession, AgentError>> + Send;

    fn end_session(
        &self,
        ctx: &OperationContext,
        session_id: &str,
    ) -> impl Future<Output = Result<SessionSummary, AgentError>> + Send;

    fn get_session_state(
        &self,
        session_id: &str,
    ) -> impl Future<Output = Result<AgentSessionState, AgentError>> + Send;

    fn check_permission(
        &self,
        action: &str,
        context: &GovernanceContext,
    ) -> impl Future<Output = Result<GovernanceDecision, AgentError>> + Send;

    fn resolve_conflict(
        &self,
        merge_id: &str,
        conflict_id: &str,
        resolution: ManualMergeResolution, // canonical from SHARED_TYPES.md §25
    ) -> impl Future<Output = Result<MergeConflictResolution, AgentError>> + Send;

    fn get_merge_state(
        &self,
        merge_id: &str,
    ) -> impl Future<Output = Result<ManualMergeState, AgentError>> + Send;
}
```

Rust struct equivalents for local-only types (`AgentMemoryView`, `AgentBranch`, `AgentSessionOptions`, `AgentSessionState`, `MergeResult`) mirror the TypeScript interfaces with snake_case fields and `Option<T>` for nullable fields. Shared records (`StructuredContent`, `AgentMemoryOptions`, `AgentRecallQuery`, `AgentRecallOptions`, `AgentMemoryEntry`, `AgentBeliefState`, `GovernanceDecision`, `AgentSession`, `SessionSummary`, `OperationContext`, `GovernanceContext`, `MergeStrategy`, `MergeConflict`, `ManualMergeState`, `ClassificationLevel`, `AgentTrustLevel`, `AgentCapability`, `RelationshipType`) use their Rust equivalents from `SHARED_TYPES.md` §25.

## 7. Integration Map

| LimenAgentClient Method | Limen Internal | Gate | Audit Event | Consent Gate |
|---|---|---|---|---|
| `remember` | SC-11 `assert_claim` | Governance + confidence ceiling + classification + **consent check** | `memory:created` | Required when content matches personal data predicates (`personal.*`, `user.*`, `identity.*`) or classification is `restricted`/`critical` |
| `recall` | SC-13 `query_claims` with exact/prefix/full-text query modes + FSRS decay | Classification clearance (per unified trust/clearance model §5) | `memory:recalled` (sampled) | No |
| `forget` | `retract_claim` + cascade evaluation | Governance + ownership | `memory:forgotten` | No |
| `getBelief` | SC-13 + evidence query + relationship query | Classification clearance (per unified trust/clearance model §5) | None (read-only) | No |
| `relateBelief` | SC-12 `relate_claims` | Governance + claim ownership | `governance:allowed` | No |
| `createBranch` | SC-11 with NonAuthoritativeContext isolation | Session valid + quota | `memory:branch_created` | No |
| `mergeBranches` | SC-11 (new authoritative claims) + SC-12 (relationships) + retract branch claims | Governance + conflict resolution | `memory:branch_merged` | No |
| `discardBranch` | Tombstone all branch claims | Session valid + branch ownership | `memory:branch_discarded` | No |
| `startSession` | Session creation + working memory namespace init (SC-14) | Agent registered + tenant valid | `session:started` | No |
| `endSession` | Session summary + branch cleanup + working memory flush | Session ownership | `session:ended` | No |
| `checkPermission` | Governance engine evaluation | None (meta-operation) | `governance:allowed` or `governance:refused` | No |
| `resolveConflict` | SC-11 (assert winning claim) + `retract_claim` (loser) + SC-12 (supersedes relationship) | Session valid + merge ownership | `memory:branch_merged` (on final resolution) | No |
| `getMergeState` | Query `ManualMergeState` from session working memory | Session valid | None (read-only) | No |
| `on`/`off` | Unified event bus subscription (See `SHARED_TYPES.md` §16.2) | Session valid | None | No |

**SC Reference Key:**
- SC-11: Claim assertion subsystem
- SC-12: Relationship declaration subsystem
- SC-13: Query and retrieval subsystem
- SC-14: Working memory subsystem

**Consent Check Logic for `remember()`:**

When `remember()` is invoked, the implementation MUST evaluate consent requirements before persisting:

1. If the predicate matches personal data patterns (`personal.*`, `user.*`, `identity.*`): consent is REQUIRED
2. If the classification is `restricted` or `critical`: consent is REQUIRED
3. If the agent is operating on behalf of a data subject (determined via `GovernanceContext.session.metadata`): consent is REQUIRED
4. Consent is checked via `ConsentRequirement` (See `SHARED_TYPES.md` §19)
5. If consent is required but not granted: return `AgentMemoryError` with code `CONSENT_REQUIRED`

## 8. Usage Examples

### 8.1 Basic Remember/Recall

```typescript
const opCtx = currentOperationContext;
const governanceCtx = currentGovernanceContext;
const session = await client.startSession(opCtx, { agentId, adapterId, trustLevel: 'high' });
if (!session.ok) throw new Error(session.error.code);

const entry = await client.remember(
  governanceCtx,
  { subject: 'entity:project:alpha', predicate: 'decision.rationale', value: 'Chose CQRS for audit trail requirements' },
  { confidence: 0.7, reasoning: 'Architecture decision after load analysis', classification: 'internal', tags: ['architecture'] }
);

const beliefs = await client.recall(
  { subject: 'entity:project:alpha', predicate: 'decision.*', minConfidence: 0.5 },
  { sortBy: 'recency', includeEvidence: true, limit: 10 }
);

if (beliefs.ok) {
  for (const view of beliefs.value) {
    console.log(`${view.entry.predicate}: conf=${view.decayInfo.currentConfidence} (${view.decayInfo.projectedFreshness}, stale in ${view.decayInfo.daysUntilStale}d)`);
  }
}
```

### 8.2 Branched Exploration

```typescript
const branch = await client.createBranch(governanceCtx, baseBeliefId, 'Exploring Redis vs Postgres for session store');
if (!branch.ok) throw new Error(branch.error.code);

// Claims within branch are capped at 0.5, isolated from authoritative graph
const h1 = await client.remember(
  governanceCtx,
  { subject: 'entity:decision:session-store', predicate: 'hypothesis.option', value: 'Redis: sub-ms reads, TTL native, but no ACID' },
  { confidence: 0.5, category: 'hypothesis' }
);

const h2 = await client.remember(
  governanceCtx,
  { subject: 'entity:decision:session-store', predicate: 'hypothesis.option', value: 'Postgres: ACID, existing infra, 2ms reads acceptable' },
  { confidence: 0.5, category: 'hypothesis' }
);

// After evaluation, merge winning hypothesis to authoritative
const result = await client.mergeBranches(governanceCtx, [branch.value.id], 'evidence_weighted');
if (!result.ok && result.error.code === 'BRANCH_CONFLICT') {
  // Handle unresolved conflicts
}
```

### 8.3 Multi-Agent Session

```typescript
// Agent A asserts a finding
const agentA = await clientA.startSession(opCtx, { agentId: agentAId, adapterId, trustLevel: 'medium' });
await clientA.remember(
  governanceCtx,
  { subject: 'entity:service:auth', predicate: 'warning.gotcha', value: 'Token refresh race condition under concurrent requests' },
  { confidence: 0.7, classification: 'internal' }
);

// Agent B contradicts with evidence
const agentB = await clientB.startSession(opCtx, { agentId: agentBId, adapterId, trustLevel: 'medium' });
const contradiction = await clientB.remember(
  governanceCtx,
  { subject: 'entity:service:auth', predicate: 'finding.resolved', value: 'Race condition fixed in commit abc123 — mutex on refresh path' },
  { confidence: 0.7, classification: 'internal' }
);

// Declare relationship — governance evaluates contradiction
await clientB.relateBelief(governanceCtx, contradiction.value.id, agentAClaimId, 'supersedes');
// Agent A's claim now has supersededBy set; effectiveConfidence decays faster
```

### 8.4 Manual Merge with Conflict Resolution

```typescript
const result = await client.mergeBranches(governanceCtx, [branchA.id, branchB.id], 'manual');
if (result.ok && result.value.status === 'pending_resolution') {
  // See SHARED_TYPES.md §14.2 for ManualMergeState and resolution semantics
  for (const conflict of result.value.manualMergeState!.conflicts) {
    // Resolve each conflict via resolveConflict (implementation detail)
  }
}
```

## 9. Invariants

1. Agent confidence never exceeds `maxAutoConfidence` (0.7) for programmer-sourced claims
2. NonAuthoritative claims never exceed 0.5 confidence
3. All memory operations require a valid, non-expired session
4. Governance gate fires before every write operation (`remember`, `forget`, `relateBelief`, `createBranch`, `mergeBranches`, `discardBranch`) using the explicit `GovernanceContext` passed to the public method; session start/end use explicit `OperationContext`
5. Every write operation produces an immutable audit entry with `EventId`
6. Branch isolation is total — no cross-contamination with authoritative belief state
7. Session cleanup is guaranteed: unmerged branches discarded, working memory flushed
8. Classification enforcement uses unified trust/clearance model (See `SHARED_TYPES.md` §5) — agents cannot read claims above their derived `clearanceLevel`
9. FSRS decay applies on every read — no stale confidence values served to callers
10. All IDs are branded types (See `SHARED_TYPES.md` §1.1, §4) — no string confusion across ID domains
11. Governance refusals are non-bypassable — no client-side override path exists
12. Evidence chain integrity — tombstoned evidence triggers confidence re-evaluation
13. Merge operations are atomic — partial merge failure rolls back all changes
14. Event handlers execute asynchronously via unified event bus (See `SHARED_TYPES.md` §16.2) — handler failure does not block the operation
15. Session timeout enforcement is server-side — client cannot extend without re-authentication
16. Consent gate fires on `remember()` when content contains personal data identifiers — violation returns `CONSENT_REQUIRED` error (See `SHARED_TYPES.md` §19)
17. Trust level promotion follows unified requirements (See `SHARED_TYPES.md` §5.2) — capability access is trust-gated per §6.1
18. Session termination with pending manual merge: `endSession()` transitions all pending merges to `'discarded'` state, discards all unmerged branch claims, and records a forced-termination audit entry. Equivalent to calling `discardBranch()` on each pending branch.
19. Manual conflict resolution is total: each `MergeConflict.conflictId` is resolved exactly once via `resolveConflict()` before merge completion; duplicate or unknown conflict IDs return `MERGE_CONFLICT_NOT_FOUND` and do not mutate branch state.
