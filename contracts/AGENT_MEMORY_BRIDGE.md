# Agent Memory Bridge Contract v1.1.0

**Status:** RATIFIED DESIGN — Pending Implementation
**Governing:** CDM v2.0 + Contract Compliance v2.0
**Scope:** Universal agent-to-Limen memory interface
**Hash:** Pending (computed at ratification)
**Date:** 2026-05-05

**Shared Types:** All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`. This contract does NOT redefine any shared type. Local types are contract-specific and not used by other contracts.

---

## 1. Purpose

Limen is an agent-agnostic governed memory substrate providing belief management, temporal decay, governance enforcement, and full audit provenance. This contract defines the universal client interface any AI agent framework uses to interact with Limen's belief system, governance infrastructure, and branched exploration capabilities. All operations are session-scoped, governance-gated, and produce immutable audit entries.

## 2. LimenAgentClient Interface

```typescript
interface LimenAgentClient {
  // Memory Operations
  remember(content: string | StructuredContent, options?: AgentMemoryOptions): Promise<Result<AgentMemoryEntry>>;
  recall(query: AgentRecallQuery, options?: AgentRecallOptions): Promise<Result<AgentMemoryView[]>>;
  forget(entryId: ClaimId, reason: string): Promise<Result<void>>;

  // Belief Operations
  getBelief(beliefId: ClaimId): Promise<Result<AgentBeliefState>>;
  relateBelief(fromId: ClaimId, toId: ClaimId, type: RelationshipType): Promise<Result<RelationshipId>>;

  // Branch Operations (NonAuthoritative exploration)
  createBranch(baseBeliefId: ClaimId, description: string): Promise<Result<AgentBranch>>;
  mergeBranches(branchIds: readonly AgentBranchId[], strategy: MergeStrategy): Promise<Result<MergeResult>>;
  discardBranch(branchId: AgentBranchId): Promise<Result<void>>;

  // Session Management
  startSession(options: AgentSessionOptions): Promise<Result<AgentSession>>;
  endSession(sessionId: SessionId): Promise<Result<SessionSummary>>;
  getSessionState(sessionId: SessionId): Promise<Result<AgentSessionState>>;

  // Governance
  checkPermission(action: AgentAction, context?: GovernanceContext): Promise<Result<GovernanceDecision>>;

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
- `AgentSession` — See `SHARED_TYPES.md` §7
- `SessionSummary` — See `SHARED_TYPES.md` §15
- `GovernanceContext` — See `SHARED_TYPES.md` §9
- `AgentEvent`, `AgentEventHandler` — See `SHARED_TYPES.md` §16

## 3. Data Models

### 3.1 StructuredContent

```typescript
interface StructuredContent {
  readonly subject: string;
  readonly predicate: string;
  readonly value: unknown;
  readonly objectType?: ObjectType; // See SHARED_TYPES.md §2
}
```

### 3.2 AgentMemoryOptions

```typescript
interface AgentMemoryOptions {
  readonly confidence?: number;
  readonly reasoning?: string;
  readonly classification?: ClassificationLevel; // See SHARED_TYPES.md §3
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly groundingMode?: GroundingMode; // See SHARED_TYPES.md §2
  readonly retentionDays?: number;
}
```

### 3.3 AgentMemoryEntry

Canonical shared type. See `SHARED_TYPES.md` §10.2. This contract produces and consumes `AgentMemoryEntry` but does not redefine it.

### 3.4 AgentRecallQuery (CANONICAL)

This is the canonical definition of AgentRecallQuery. Other contracts reference subsets of these fields.

```typescript
interface AgentRecallQuery {
  readonly text?: string;
  readonly subject?: string;
  readonly predicate?: string;
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly freshnessFilter?: FreshnessLabel | readonly FreshnessLabel[];
  readonly minConfidence?: number;
  readonly timeRange?: { readonly from: string; readonly to: string };
  readonly classification?: ClassificationLevel;
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly sourceAgentId?: AgentId;
  readonly includeSuperseded?: boolean;
  readonly branchId?: AgentBranchId;
}
```

### 3.5 AgentRecallOptions

```typescript
interface AgentRecallOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly includeEvidence?: boolean;
  readonly includeRelationships?: boolean;
  readonly searchMode?: 'text' | 'semantic' | 'hybrid';
  readonly archiveMode?: ArchiveMode; // See SHARED_TYPES.md §2
  readonly sortBy?: 'relevance' | 'confidence' | 'recency';
}
```

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
type AgentAction = 'remember' | 'recall' | 'forget' | 'create_branch' | 'merge_branch' | 'relate' | 'classify' | 'export';
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
  | { readonly code: 'SESSION_NOT_FOUND'; readonly sessionId: SessionId }
  | { readonly code: 'CONSENT_REQUIRED'; readonly dataSubjectId: string; readonly purpose: ConsentPurpose; readonly operation: ConsentableOperation };
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
1. Agent calls `createBranch(baseBeliefId, description)` — engine creates isolated namespace
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
    SessionNotFound { session_id: String },
    ConsentRequired { data_subject_id: String, purpose: String, operation: String },
    Internal { message: String },
}

pub trait AgentMemoryBridge: Send + Sync {
    fn remember(
        &self,
        content: &str,
        metadata: Option<AgentMetadata>,
        governance: Option<GovernanceDirective>,
    ) -> impl Future<Output = Result<AgentMemoryEntry, AgentError>> + Send;

    fn recall(
        &self,
        query: &AgentRecallQuery,
        options: Option<RecallOptions>,
    ) -> impl Future<Output = Result<Vec<AgentMemoryView>, AgentError>> + Send;

    fn forget(
        &self,
        entry_id: &str,
        reason: &str,
    ) -> impl Future<Output = Result<(), AgentError>> + Send;

    fn get_belief_state(
        &self,
        belief_id: &str,
    ) -> impl Future<Output = Result<AgentBeliefState, AgentError>> + Send;

    fn relate_belief(
        &self,
        from_id: &str,
        to_id: &str,
        relation_type: RelationshipType, // See SHARED_TYPES.md §25
    ) -> impl Future<Output = Result<String, AgentError>> + Send;

    fn create_branch(
        &self,
        base_belief_id: &str,
        description: &str,
    ) -> impl Future<Output = Result<AgentBranch, AgentError>> + Send;

    fn merge_branches(
        &self,
        branch_ids: &[String], // AgentBranchId
        strategy: MergeStrategy, // See SHARED_TYPES.md §25
    ) -> impl Future<Output = Result<MergeResult, AgentError>> + Send;

    fn discard_branch(
        &self,
        branch_id: &str,
    ) -> impl Future<Output = Result<(), AgentError>> + Send;

    fn start_session(
        &self,
        options: AgentSessionOptions,
    ) -> impl Future<Output = Result<AgentSession, AgentError>> + Send;

    fn end_session(
        &self,
        session_id: &str,
    ) -> impl Future<Output = Result<SessionSummary, AgentError>> + Send;

    fn get_session_state(
        &self,
        session_id: &str,
    ) -> impl Future<Output = Result<AgentSessionState, AgentError>> + Send;

    fn check_permission(
        &self,
        action: &str,
        context: Option<&GovernanceContext>,
    ) -> impl Future<Output = Result<GovernanceDecision, AgentError>> + Send;
}
```

Rust struct equivalents for local-only types (`AgentRecallQuery`, `RecallOptions`, `AgentMemoryView`, `AgentBranch`, `AgentSessionOptions`, `AgentSessionState`, `MergeResult`) mirror the TypeScript interfaces with snake_case fields and `Option<T>` for nullable fields. Shared records (`AgentMemoryEntry`, `AgentBeliefState`, `GovernanceDecision`, `AgentSession`, `SessionSummary`, `GovernanceContext`, `MergeStrategy`, `MergeConflict`, `ManualMergeState`, `ClassificationLevel`, `AgentTrustLevel`, `AgentCapability`, `RelationshipType`) use their Rust equivalents from `SHARED_TYPES.md` §25.

## 7. Integration Map

| LimenAgentClient Method | Limen Internal | Gate | Audit Event | Consent Gate |
|---|---|---|---|---|
| `remember` | SC-11 `assert_claim` | Governance + confidence ceiling + classification + **consent check** | `memory:created` | Required when content matches personal data predicates (`personal.*`, `user.*`, `identity.*`) or classification is `restricted`/`critical` |
| `recall` | SC-13 `query_claims` + `search_claims` + FSRS decay | Classification clearance (per unified trust/clearance model §5) | `memory:recalled` (sampled) | No |
| `forget` | `retract_claim` + cascade evaluation | Governance + ownership | `memory:forgotten` | No |
| `getBelief` | SC-13 + evidence query + relationship query | Classification clearance (per unified trust/clearance model §5) | None (read-only) | No |
| `relateBelief` | SC-12 `declare_relationship` | Governance + claim ownership | `governance:allowed` | No |
| `createBranch` | SC-11 with NonAuthoritativeContext isolation | Session valid + quota | `memory:branch_created` | No |
| `mergeBranches` | SC-11 (new authoritative claims) + SC-12 (relationships) + retract branch claims | Governance + conflict resolution | `memory:branch_merged` | No |
| `discardBranch` | Tombstone all branch claims | Session valid + branch ownership | `memory:branch_discarded` | No |
| `startSession` | Session creation + working memory namespace init (SC-14) | Agent registered + tenant valid | `session:started` | No |
| `endSession` | Session summary + branch cleanup + working memory flush | Session ownership | `session:ended` | No |
| `checkPermission` | Governance engine evaluation | None (meta-operation) | `governance:allowed` or `governance:refused` | No |
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
const session = await client.startSession({ agentId, adapterId, trustLevel: 'high' });
if (!session.ok) throw new Error(session.error.code);

const entry = await client.remember(
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
const branch = await client.createBranch(baseBeliefId, 'Exploring Redis vs Postgres for session store');
if (!branch.ok) throw new Error(branch.error.code);

// Claims within branch are capped at 0.5, isolated from authoritative graph
const h1 = await client.remember(
  { subject: 'entity:decision:session-store', predicate: 'hypothesis.option', value: 'Redis: sub-ms reads, TTL native, but no ACID' },
  { confidence: 0.5, category: 'hypothesis' }
);

const h2 = await client.remember(
  { subject: 'entity:decision:session-store', predicate: 'hypothesis.option', value: 'Postgres: ACID, existing infra, 2ms reads acceptable' },
  { confidence: 0.5, category: 'hypothesis' }
);

// After evaluation, merge winning hypothesis to authoritative
const result = await client.mergeBranches([branch.value.id], 'evidence_weighted');
if (!result.ok && result.error.code === 'BRANCH_CONFLICT') {
  // Handle unresolved conflicts
}
```

### 8.3 Multi-Agent Session

```typescript
// Agent A asserts a finding
const agentA = await clientA.startSession({ agentId: agentAId, adapterId, trustLevel: 'medium' });
await clientA.remember(
  { subject: 'entity:service:auth', predicate: 'warning.gotcha', value: 'Token refresh race condition under concurrent requests' },
  { confidence: 0.7, classification: 'internal' }
);

// Agent B contradicts with evidence
const agentB = await clientB.startSession({ agentId: agentBId, adapterId, trustLevel: 'medium' });
const contradiction = await clientB.remember(
  { subject: 'entity:service:auth', predicate: 'finding.resolved', value: 'Race condition fixed in commit abc123 — mutex on refresh path' },
  { confidence: 0.7, classification: 'internal' }
);

// Declare relationship — governance evaluates contradiction
await clientB.relateBelief(contradiction.value.id, agentAClaimId, 'supersedes');
// Agent A's claim now has supersededBy set; effectiveConfidence decays faster
```

### 8.4 Manual Merge with Conflict Resolution

```typescript
const result = await client.mergeBranches([branchA.id, branchB.id], 'manual');
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
4. Governance gate fires before every write operation (`remember`, `forget`, `relateBelief`, `createBranch`, `mergeBranches`)
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
