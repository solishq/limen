<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# Agent Coordination Governance Contract v1.0.0

**Status:** RATIFIED DESIGN --- Pending Implementation
**Governing:** SolisForge Protocol v1.4 [HISTORICAL: CDM v2.1 + Contract Compliance v2.1 — superseded]
**Scope:** A2A governance, session forking, distributed sync, inter-agent conflict, and replay verification
**Classification:** QAL-4

> **Shared Types:** All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`. This contract does NOT redefine any shared type. Local types are contract-specific and not used by other contracts.

---

## 1. Purpose

Governs how agents coordinate within and across Limen deployments: inter-agent communication rules (A2A governance), session forking for parallel exploration, distributed sync for multi-node deployment, and deterministic replay for mission verification. All coordination operations are tenant-scoped, governance-checked, and produce audit entries through the unified event system.

**Five Questions:** Spec requires governed A2A, fork, sync, and replay. Failures: capability bleed, classification flow violation, fork leakage, watermark regression, replay divergence. Consequence: agents collaborate on unauthorized or non-deterministic state. Assumption: named A2A, fork, sync, and replay internals exist behind Limen services. Hostile review target: prove coordination never widens authority beyond `OperationContext`.

---

## 2. Shared Type References

| Type | Source Section | Usage in This Contract |
|---|---|---|
| `AgentId` | SHARED_TYPES 1.1a | Agent identification in rules, peers, sessions |
| `SessionId` | SHARED_TYPES 1.1a | Session forking parent/child references |
| `MissionId` | SHARED_TYPES 1.1a | Replay snapshot scoping |
| `TenantId` | SHARED_TYPES 1.1a | Tenant-scoped isolation for all operations |
| `EventId` | SHARED_TYPES 1.1a | Audit trail linkage |
| `ClaimId` | SHARED_TYPES 1.1b | Claim references in fork/sync payloads |
| `Result<T>` | SHARED_TYPES 1.5 | All method return types |
| `KernelError` | SHARED_TYPES 1.4 | Error payloads |
| `ClassificationLevel` | SHARED_TYPES 3 | Data classification in capability boundaries |
| `AgentTrustLevel` | SHARED_TYPES 5 | Trust requirements for coordination capabilities |
| `AgentCapability` | SHARED_TYPES 6 | Capability gating (`multi_agent` required) |
| `AgentSession` | SHARED_TYPES 7 | Session context for fork operations |
| `OperationContext` | SHARED_TYPES 1.3 | Governance check context |
| `GovernanceAction` | SHARED_TYPES 9 | `coordination` domain actions |
| `GovernanceVerdict` | SHARED_TYPES 10 | Rule evaluation results |
| `GovernanceDecision` | SHARED_TYPES 10.1 | Full decision records |
| `AgentEvent` | SHARED_TYPES 16.1 | Coordination event types |
| `AgentEventHandler` | SHARED_TYPES 16.2 | Event subscription callbacks |
| `AgentEventPayload` | SHARED_TYPES 16.2 | Event payloads |
| `RateLimitPolicy` | SHARED_TYPES 18 | Rate limiting in capability boundaries |
| `MergeStrategy` | SHARED_TYPES 14 | Fork merge conflict resolution |
| `MergeConflict` | SHARED_TYPES 14.2 | Fork merge conflict records |
| `RetentionPolicy` | SHARED_TYPES 17 | Sync event retention |

---

## 3. AgentCoordinationClient Interface

```typescript
interface AgentCoordinationClient {
  // --- A2A Governance ---
  registerA2ARule(ctx: OperationContext, rule: A2AGovernanceRuleInput): Promise<Result<string>>;
  removeA2ARule(ctx: OperationContext, ruleId: string): Promise<Result<void>>;
  listA2ARules(ctx: OperationContext, filter?: A2ARuleFilter): Promise<Result<A2AGovernanceRule[]>>;
  validateA2AAction(ctx: OperationContext, action: A2AAction, targetAgent: AgentId): Promise<Result<A2AVerdict>>;
  getCapabilityBoundary(ctx: OperationContext, agentId: AgentId, skill: string): Promise<Result<CapabilityBoundary>>;

  // --- Session Forking ---
  forkSession(ctx: OperationContext, atTurn: number, options?: ForkOptions): Promise<Result<ForkedSession>>;
  listForks(ctx: OperationContext, sessionId: SessionId): Promise<Result<ForkedSession[]>>;
  mergeFork(ctx: OperationContext, forkId: string, strategy: MergeStrategy): Promise<Result<ForkMergeResult>>;
  discardFork(ctx: OperationContext, forkId: string): Promise<Result<void>>;

  // --- Distributed Sync ---
  getSyncState(ctx: OperationContext): Promise<Result<SyncState>>;
  registerPeer(ctx: OperationContext, peer: PeerRegistration): Promise<Result<string>>;
  removePeer(ctx: OperationContext, peerId: string): Promise<Result<void>>;
  triggerSync(ctx: OperationContext, options?: SyncOptions): Promise<Result<SyncResult>>;
  getSyncLog(ctx: OperationContext, options?: SyncLogOptions): Promise<Result<SyncEvent[]>>;

  // --- Deterministic Replay ---
  captureSnapshot(ctx: OperationContext, missionId: MissionId, trigger: SnapshotTrigger): Promise<Result<StateSnapshot>>;
  verifyReplay(ctx: OperationContext, missionId: MissionId, options?: ReplayVerifyOptions): Promise<Result<ReplayVerification>>;
  getSnapshots(ctx: OperationContext, missionId: MissionId): Promise<Result<StateSnapshot[]>>;
  detectDivergence(ctx: OperationContext, snapshotA: string, snapshotB: string): Promise<Result<DivergenceReport>>;

  // --- Events ---
  on(ctx: OperationContext, event: CoordinationEvent, handler: AgentEventHandler): string;
  off(ctx: OperationContext, subscriptionId: string): void;
}
```

---

## 4. A2A Governance Data Models

### 4.1 A2AGovernanceRule

```typescript
interface A2AGovernanceRule {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly sourceAgent: AgentId | '*';
  readonly targetAgent: AgentId | '*';
  readonly skill: string | '*';
  readonly action: A2ARuleAction;
  readonly conditions: readonly A2ARuleCondition[];
  readonly priority: number; // lower = higher priority, evaluated first
  readonly enabled: boolean;
  readonly createdAt: string; // ISO-8601
  readonly createdBy: AgentId;
}

type A2ARuleAction = 'allow' | 'deny' | 'mask' | 'rate_limit';

interface A2ARuleCondition {
  readonly field: string;
  readonly operator: 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'lt' | 'matches';
  readonly value: string | number | boolean | readonly string[];
}
```

### 4.2 A2AGovernanceRuleInput

```typescript
interface A2AGovernanceRuleInput {
  readonly sourceAgent: AgentId | '*';
  readonly targetAgent: AgentId | '*';
  readonly skill: string | '*';
  readonly action: A2ARuleAction;
  readonly conditions?: readonly A2ARuleCondition[];
  readonly priority?: number; // defaults to 100
}
```

### 4.3 A2AAction

```typescript
interface A2AAction {
  readonly type: 'send_message' | 'delegate_task' | 'share_knowledge' | 'request_capability' | 'invoke_skill';
  readonly sourceAgent: AgentId;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly classification: ClassificationLevel;
  readonly timestamp: string; // ISO-8601
}
```

### 4.4 A2AVerdict

```typescript
interface A2AVerdict {
  readonly allowed: boolean;
  readonly maskedFields: readonly string[] | null;
  readonly rateLimited: boolean;
  readonly reason: string;
  readonly ruleId: string;
  readonly evaluatedAt: string; // ISO-8601
}
```

**Validation rules:** If `allowed` is false, `reason` MUST be non-empty. If `maskedFields` is non-null, the caller MUST strip those fields from the payload before delivery. `rateLimited` is true when the action is allowed but throttled (queued for later delivery).

### 4.5 CapabilityBoundary

```typescript
interface CapabilityBoundary {
  readonly agentId: AgentId;
  readonly skill: string;
  readonly clearanceRequired: ClassificationLevel;
  readonly allowedFields: readonly string[];
  readonly maskedFields: readonly string[];
  readonly rateLimit: RateLimitPolicy | null;
  readonly trustRequired: AgentTrustLevel;
  readonly expiresAt: string | null; // ISO-8601, null = permanent
}
```

### 4.6 DataClassificationRule

```typescript
interface DataClassificationRule {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly predicatePattern: string; // glob pattern matching claim predicates
  readonly classification: ClassificationLevel;
  readonly autoApply: boolean;
  readonly createdBy: AgentId;
}
```

### 4.7 ProactiveRule

```typescript
interface ProactiveRule {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly trigger: ProactiveTrigger;
  readonly action: ProactiveAction;
  readonly cooldownSeconds: number;
  readonly enabled: boolean;
}

type ProactiveTrigger =
  | { readonly type: 'event_pattern'; readonly eventType: AgentEvent; readonly condition?: A2ARuleCondition }
  | { readonly type: 'threshold'; readonly metric: string; readonly operator: 'gt' | 'lt' | 'eq'; readonly value: number }
  | { readonly type: 'schedule'; readonly cronExpression: string };

type ProactiveAction =
  | { readonly type: 'notify_agent'; readonly agentId: AgentId; readonly message: string }
  | { readonly type: 'trigger_sync'; readonly options: SyncOptions }
  | { readonly type: 'capture_snapshot'; readonly missionId: MissionId; readonly trigger: SnapshotTrigger };
```

### 4.8 A2ARuleFilter

```typescript
interface A2ARuleFilter {
  readonly sourceAgent?: AgentId;
  readonly targetAgent?: AgentId;
  readonly skill?: string;
  readonly action?: A2ARuleAction;
  readonly enabled?: boolean;
}
```

---

## 5. Session Forking Data Models

### 5.1 ForkOptions

```typescript
interface ForkOptions {
  readonly label?: string;
  readonly inheritWorkingMemory: boolean; // default: true
  readonly inheritClaims: boolean; // default: false (fork starts with parent's claims visible but adds to own namespace)
  readonly maxDurationMs?: number; // auto-discard after this duration
}
```

### 5.2 ForkedSession

```typescript
interface ForkedSession {
  readonly forkId: string;
  readonly parentSessionId: SessionId;
  readonly forkedSessionId: SessionId;
  readonly forkPoint: number; // turn number
  readonly state: ForkState;
  readonly label: string | null;
  readonly claimsSinceFork: number;
  readonly workingMemoryNamespace: string; // isolated namespace
  readonly createdAt: string; // ISO-8601
  readonly mergedAt: string | null; // ISO-8601
  readonly discardedAt: string | null; // ISO-8601
}

type ForkState = 'active' | 'merged' | 'discarded';
```

**Isolation semantics:** A forked session has its own working memory namespace. Claims asserted in the fork are branch-scoped (visible only within the fork) until merge. The fork CAN read claims from the parent session (snapshot at fork point) but CANNOT modify them. New claims in the parent after the fork point are NOT visible to the fork.

### 5.3 ForkMergeResult

```typescript
interface ForkMergeResult {
  readonly forkId: string;
  readonly status: 'completed' | 'pending_resolution' | 'conflict_detected';
  readonly claimsMerged: number;
  readonly claimsDiscarded: number;
  readonly conflictsResolved: readonly ForkConflictResolution[];
  readonly unresolvedConflicts: readonly MergeConflict[];
  readonly mergedAt: string; // ISO-8601
}

interface ForkConflictResolution {
  readonly subject: string;
  readonly predicate: string;
  readonly resolution: 'kept_fork' | 'kept_parent' | 'kept_both' | 'discarded_both';
  readonly strategy: MergeStrategy;
}
```

### 5.4 Fork Limits

| Parameter | Default | Configurable |
|---|---|---|
| Max forks per session | 5 | Yes, per tenant |
| Max active forks system-wide per agent | 10 | Yes, per tenant |
| Max fork depth (fork of a fork) | 2 | No |
| Auto-discard timeout | 1 hour | Yes, per fork |

---

## 6. Distributed Sync Data Models

### 6.1 HLCTimestamp

```typescript
interface HLCTimestamp {
  readonly physical: number; // Unix ms, wall clock component
  readonly logical: number; // Lamport counter for same physical time
  readonly nodeId: string; // Unique node identifier
}
```

**Ordering:** HLC timestamps are compared by `physical` first, then `logical`, then `nodeId` lexicographically. This produces a total order across all nodes without requiring synchronized clocks.

### 6.2 SyncEvent

```typescript
interface SyncEvent {
  readonly id: string;
  readonly type: SyncEventType;
  readonly hlcTimestamp: HLCTimestamp;
  readonly tenantId: TenantId;
  readonly payload: SyncEventPayload;
  readonly hash: string; // SHA-256 of canonical serialization
  readonly previousHash: string; // hash of prior event in this tenant's log
}

type SyncEventType = 'claim_created' | 'claim_retracted' | 'relationship_created' | 'governance_update';

type SyncEventPayload =
  | { readonly type: 'claim_created'; readonly claimId: ClaimId; readonly subject: string; readonly predicate: string; readonly value: string; readonly confidence: number }
  | { readonly type: 'claim_retracted'; readonly claimId: ClaimId; readonly reason: string }
  | { readonly type: 'relationship_created'; readonly sourceId: ClaimId; readonly targetId: ClaimId; readonly relationshipType: string }
  | { readonly type: 'governance_update'; readonly ruleId: string; readonly operation: 'created' | 'removed' | 'updated' };
```

**Hash chaining:** Each sync event's `hash` is computed over `{id, type, hlcTimestamp, tenantId, payload, previousHash}`. This creates an append-only, tamper-evident log per tenant.

### 6.3 SyncState

```typescript
interface SyncState {
  readonly nodeId: string;
  readonly tenantId: TenantId;
  readonly peers: readonly PeerState[];
  readonly lastSyncAt: string | null; // ISO-8601
  readonly pendingEvents: number;
  readonly watermarks: readonly Watermark[];
  readonly hashChainValid: boolean;
}
```

### 6.4 PeerRegistration

```typescript
interface PeerRegistration {
  readonly nodeId: string;
  readonly endpoint: string; // URL for sync communication
  readonly tenantId: TenantId;
  readonly capabilities: readonly SyncCapability[];
  readonly maxBatchSize: number;
}

type SyncCapability = 'push' | 'pull' | 'bidirectional';
```

### 6.5 PeerState

```typescript
interface PeerState {
  readonly peerId: string;
  readonly nodeId: string;
  readonly endpoint: string;
  readonly status: PeerStatus;
  readonly lastSeenAt: string; // ISO-8601
  readonly lastSyncedAt: string | null; // ISO-8601
  readonly watermark: HLCTimestamp | null; // last event received from this peer
  readonly pendingOutbound: number;
  readonly failedAttempts: number;
}

type PeerStatus = 'active' | 'unreachable' | 'deregistered' | 'suspended';
```

### 6.6 Watermark

```typescript
interface Watermark {
  readonly peerId: string;
  readonly hlcTimestamp: HLCTimestamp; // all events up to this point are synced
  readonly confirmedAt: string; // ISO-8601
}
```

### 6.7 SyncOptions

```typescript
interface SyncOptions {
  readonly targetPeers?: readonly string[]; // peer IDs, empty = all active peers
  readonly direction: 'push' | 'pull' | 'bidirectional';
  readonly batchSize?: number; // max events per batch, default 100
  readonly timeoutMs?: number; // default 30000
  readonly conflictResolution?: SyncConflictResolution;
}

type SyncConflictResolution = 'last_writer_wins' | 'highest_confidence' | 'manual';
```

### 6.8 SyncResult

```typescript
interface SyncResult {
  readonly syncId: string;
  readonly direction: 'push' | 'pull' | 'bidirectional';
  readonly eventsPushed: number;
  readonly eventsPulled: number;
  readonly conflictsResolved: number;
  readonly conflictsUnresolved: number;
  readonly peersContacted: number;
  readonly peersUnreachable: readonly string[];
  readonly watermarksAdvanced: readonly Watermark[];
  readonly duration: number; // ms
  readonly completedAt: string; // ISO-8601
}
```

### 6.9 SyncLogOptions

```typescript
interface SyncLogOptions {
  readonly since?: HLCTimestamp;
  readonly until?: HLCTimestamp;
  readonly type?: SyncEventType;
  readonly limit?: number; // default 100, max 1000
  readonly offset?: number;
}
```

### 6.10 Conflict Resolution

**Default: last-writer-wins by HLC.** When two nodes assert conflicting claims (same subject+predicate, different values), the claim with the later HLC timestamp wins. This is deterministic: given the same set of events, every node produces the same resolution regardless of reception order.

**Fallback ordering:** If HLC timestamps are identical (same physical, same logical, different nodeId), `nodeId` lexicographic comparison breaks the tie. This makes conflict resolution a total order function with no ambiguity.

---

## 7. Deterministic Replay Data Models

### 7.1 SnapshotTrigger

```typescript
type SnapshotTrigger = 'mission_start' | 'checkpoint' | 'mission_end' | 'manual';
```

### 7.2 StateSnapshot

```typescript
interface StateSnapshot {
  readonly id: string;
  readonly missionId: MissionId;
  readonly tenantId: TenantId;
  readonly trigger: SnapshotTrigger;
  readonly timestamp: string; // ISO-8601
  readonly stateHash: string; // SHA-256 of combined table hashes
  readonly tableHashes: Readonly<Record<SnapshotTable, string>>;
  readonly metadata: SnapshotMetadata;
}

type SnapshotTable = 'claims' | 'relationships' | 'working_memory' | 'governance_rules' | 'audit_entries';

interface SnapshotMetadata {
  readonly claimCount: number;
  readonly relationshipCount: number;
  readonly workingMemoryEntries: number;
  readonly governanceRuleCount: number;
  readonly auditEntryCount: number;
  readonly capturedBy: AgentId;
  readonly capturedAt: string; // ISO-8601
}
```

**Hash computation:** `stateHash = SHA-256(sorted(tableHashes.values).join(':'))`. Each `tableHashes[table]` is computed as `SHA-256(canonicalSerialize(allRowsInTable.sortedById))`. This is deterministic: same data always produces the same hash regardless of insertion order.

### 7.3 ReplayVerifyOptions

```typescript
interface ReplayVerifyOptions {
  readonly fromSnapshot?: string; // snapshot ID to start from, default: mission_start
  readonly toSnapshot?: string; // snapshot ID to verify against, default: latest
  readonly tables?: readonly SnapshotTable[]; // specific tables to verify, default: all
  readonly haltOnFirstDivergence?: boolean; // default: false
}
```

### 7.4 ReplayVerification

```typescript
interface ReplayVerification {
  readonly missionId: MissionId;
  readonly verified: boolean;
  readonly fromSnapshotId: string;
  readonly toSnapshotId: string;
  readonly expectedHash: string;
  readonly actualHash: string;
  readonly tableResults: Readonly<Record<SnapshotTable, TableVerification>>;
  readonly divergences: readonly DivergenceEntry[];
  readonly verifiedAt: string; // ISO-8601
  readonly duration: number; // ms
}

interface TableVerification {
  readonly table: SnapshotTable;
  readonly expectedHash: string;
  readonly actualHash: string;
  readonly match: boolean;
  readonly rowsChecked: number;
}
```

### 7.5 DivergenceReport

```typescript
interface DivergenceReport {
  readonly snapshotA: string;
  readonly snapshotB: string;
  readonly divergences: readonly DivergenceEntry[];
  readonly summary: DivergenceSummary;
  readonly generatedAt: string; // ISO-8601
}

interface DivergenceEntry {
  readonly table: SnapshotTable;
  readonly rowId: string;
  readonly field: string;
  readonly valueInA: string | null;
  readonly valueInB: string | null;
  readonly divergenceType: 'modified' | 'added_in_a' | 'added_in_b' | 'missing_in_a' | 'missing_in_b';
}

interface DivergenceSummary {
  readonly totalDivergences: number;
  readonly byTable: Readonly<Record<SnapshotTable, number>>;
  readonly byType: Readonly<Record<DivergenceEntry['divergenceType'], number>>;
}
```

**Read-only guarantee:** Replay verification NEVER modifies state. It computes hashes from current state and compares against stored snapshot hashes. If divergence is detected, it reports but does not repair.

---

## 8. Coordination Events

```typescript
type CoordinationEvent =
  // A2A events
  | 'a2a:rule_registered'
  | 'a2a:rule_removed'
  | 'a2a:action_validated'
  | 'a2a:action_denied'
  | 'a2a:action_masked'
  | 'a2a:rate_limited'
  // Fork events
  | 'fork:created'
  | 'fork:merged'
  | 'fork:discarded'
  | 'fork:conflict_detected'
  // Sync events
  | 'sync:started'
  | 'sync:completed'
  | 'sync:failed'
  | 'sync:conflict_resolved'
  | 'sync:peer_registered'
  | 'sync:peer_removed'
  | 'sync:peer_unreachable'
  | 'sync:watermark_advanced'
  // Replay events
  | 'replay:snapshot_captured'
  | 'replay:verification_complete'
  | 'replay:verification_failed'
  | 'replay:divergence_detected';
```

**Mapping to AgentEvent:** All coordination events map to the unified `AgentEvent` system. `a2a:*` maps to `'a2a:sent'` or `'a2a:refused'`. `fork:*` maps to `'session:forked'`. `sync:*` maps to `'sync:watermark_advanced'`. `replay:*` maps to `'replay:verified'` or `'replay:diverged'`. The coordination-specific events provide finer granularity for local subscribers; the AgentEvent mappings provide system-wide observability.

---

## 9. Error Types

```typescript
type CoordinationErrorCode =
  | 'A2A_RULE_VIOLATION'
  | 'A2A_CAPABILITY_DENIED'
  | 'A2A_RULE_NOT_FOUND'
  | 'A2A_DUPLICATE_RULE'
  | 'FORK_LIMIT_EXCEEDED'
  | 'FORK_NOT_FOUND'
  | 'FORK_ALREADY_MERGED'
  | 'FORK_ALREADY_DISCARDED'
  | 'FORK_DEPTH_EXCEEDED'
  | 'FORK_INVALID_TURN'
  | 'SYNC_PEER_UNREACHABLE'
  | 'SYNC_PEER_NOT_FOUND'
  | 'SYNC_CONFLICT_UNRESOLVABLE'
  | 'SYNC_HASH_CHAIN_BROKEN'
  | 'SYNC_TIMEOUT'
  | 'REPLAY_HASH_MISMATCH'
  | 'REPLAY_SNAPSHOT_NOT_FOUND'
  | 'REPLAY_MISSION_NOT_FOUND'
  | 'GOVERNANCE_REFUSAL'
  | 'COORDINATION_TENANT_MISMATCH';

type AgentCoordinationError =
  | { readonly code: 'A2A_RULE_VIOLATION'; readonly ruleId: string; readonly reason: string }
  | { readonly code: 'A2A_CAPABILITY_DENIED'; readonly capability: AgentCapability }
  | { readonly code: 'FORK_LIMIT_EXCEEDED'; readonly limit: number }
  | { readonly code: 'FORK_NOT_FOUND'; readonly forkId: string }
  | { readonly code: 'SYNC_WATERMARK_REGRESSION'; readonly peerId: AgentId; readonly current: string; readonly attempted: string }
  | { readonly code: 'SYNC_HASH_CHAIN_BROKEN'; readonly peerId: AgentId; readonly eventId: EventId }
  | { readonly code: 'REPLAY_HASH_MISMATCH'; readonly expected: string; readonly actual: string }
  | { readonly code: 'COORDINATION_TENANT_MISMATCH'; readonly expected: TenantId | null; readonly actual: TenantId | null }
  | { readonly code: 'GOVERNANCE_REFUSAL'; readonly decision: GovernanceDecision };

interface CoordinationError extends KernelError {
  readonly code: CoordinationErrorCode;
  readonly context: CoordinationErrorContext;
}

interface CoordinationErrorContext {
  readonly operation: string;
  readonly agentId: AgentId;
  readonly tenantId: TenantId;
  readonly details: Readonly<Record<string, unknown>>;
}
```

---

## 10. Rust Trait

```rust
use async_trait::async_trait;

/// Agent Coordination Governor --- governs A2A communication, session forking,
/// distributed sync, and deterministic replay verification.
#[async_trait]
pub trait AgentCoordinationGovernor: Send + Sync {
    // --- A2A Governance ---
    async fn register_a2a_rule(&self, ctx: &OperationContext, rule: A2AGovernanceRuleInput) -> Result<String, CoordinationError>;
    async fn remove_a2a_rule(&self, ctx: &OperationContext, rule_id: &str) -> Result<(), CoordinationError>;
    async fn list_a2a_rules(&self, ctx: &OperationContext, filter: Option<&A2ARuleFilter>) -> Result<Vec<A2AGovernanceRule>, CoordinationError>;
    async fn validate_a2a_action(&self, ctx: &OperationContext, action: &A2AAction, target: &AgentId) -> Result<A2AVerdict, CoordinationError>;
    async fn get_capability_boundary(&self, ctx: &OperationContext, agent_id: &AgentId, skill: &str) -> Result<CapabilityBoundary, CoordinationError>;

    // --- Session Forking ---
    async fn fork_session(&self, ctx: &OperationContext, at_turn: u32, options: Option<&ForkOptions>) -> Result<ForkedSession, CoordinationError>;
    async fn list_forks(&self, ctx: &OperationContext, session_id: &SessionId) -> Result<Vec<ForkedSession>, CoordinationError>;
    async fn merge_fork(&self, ctx: &OperationContext, fork_id: &str, strategy: MergeStrategy) -> Result<ForkMergeResult, CoordinationError>;
    async fn discard_fork(&self, ctx: &OperationContext, fork_id: &str) -> Result<(), CoordinationError>;

    // --- Distributed Sync ---
    async fn get_sync_state(&self, ctx: &OperationContext) -> Result<SyncState, CoordinationError>;
    async fn register_peer(&self, ctx: &OperationContext, peer: &PeerRegistration) -> Result<String, CoordinationError>;
    async fn remove_peer(&self, ctx: &OperationContext, peer_id: &str) -> Result<(), CoordinationError>;
    async fn trigger_sync(&self, ctx: &OperationContext, options: Option<&SyncOptions>) -> Result<SyncResult, CoordinationError>;
    async fn get_sync_log(&self, ctx: &OperationContext, options: Option<&SyncLogOptions>) -> Result<Vec<SyncEvent>, CoordinationError>;

    // --- Deterministic Replay ---
    async fn capture_snapshot(&self, ctx: &OperationContext, mission_id: &MissionId, trigger: SnapshotTrigger) -> Result<StateSnapshot, CoordinationError>;
    async fn verify_replay(&self, ctx: &OperationContext, mission_id: &MissionId, options: Option<&ReplayVerifyOptions>) -> Result<ReplayVerification, CoordinationError>;
    async fn get_snapshots(&self, ctx: &OperationContext, mission_id: &MissionId) -> Result<Vec<StateSnapshot>, CoordinationError>;
    async fn detect_divergence(&self, ctx: &OperationContext, snapshot_a: &str, snapshot_b: &str) -> Result<DivergenceReport, CoordinationError>;
}

// --- Local Rust types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AGovernanceRule {
    pub id: String,
    pub tenant_id: TenantId,
    pub source_agent: String, // AgentId or "*"
    pub target_agent: String, // AgentId or "*"
    pub skill: String,        // skill name or "*"
    pub action: A2ARuleAction,
    pub conditions: Vec<A2ARuleCondition>,
    pub priority: i32,
    pub enabled: bool,
    pub created_at: String,
    pub created_by: AgentId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AGovernanceRuleInput {
    pub source_agent: String,
    pub target_agent: String,
    pub skill: String,
    pub action: A2ARuleAction,
    pub conditions: Vec<A2ARuleCondition>,
    pub priority: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum A2ARuleAction {
    Allow,
    Deny,
    Mask,
    RateLimit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2ARuleCondition {
    pub field: String,
    pub operator: ConditionOperator,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConditionOperator {
    Eq,
    Neq,
    In,
    NotIn,
    Gt,
    Lt,
    Matches,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AAction {
    pub action_type: A2AActionType,
    pub source_agent: AgentId,
    pub payload: serde_json::Value,
    pub classification: ClassificationLevel,
    pub timestamp: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum A2AActionType {
    SendMessage,
    DelegateTask,
    ShareKnowledge,
    RequestCapability,
    InvokeSkill,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AVerdict {
    pub allowed: bool,
    pub masked_fields: Option<Vec<String>>,
    pub rate_limited: bool,
    pub reason: String,
    pub rule_id: String,
    pub evaluated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityBoundary {
    pub agent_id: AgentId,
    pub skill: String,
    pub clearance_required: ClassificationLevel,
    pub allowed_fields: Vec<String>,
    pub masked_fields: Vec<String>,
    pub rate_limit: Option<RateLimitPolicy>,
    pub trust_required: AgentTrustLevel,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HLCTimestamp {
    pub physical: u64,
    pub logical: u32,
    pub node_id: String,
}

impl Ord for HLCTimestamp {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.physical.cmp(&other.physical)
            .then(self.logical.cmp(&other.logical))
            .then(self.node_id.cmp(&other.node_id))
    }
}

impl PartialOrd for HLCTimestamp {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for HLCTimestamp {
    fn eq(&self, other: &Self) -> bool {
        self.physical == other.physical && self.logical == other.logical && self.node_id == other.node_id
    }
}

impl Eq for HLCTimestamp {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEvent {
    pub id: String,
    pub event_type: SyncEventType,
    pub hlc_timestamp: HLCTimestamp,
    pub tenant_id: TenantId,
    pub payload: serde_json::Value,
    pub hash: String,
    pub previous_hash: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncEventType {
    ClaimCreated,
    ClaimRetracted,
    RelationshipCreated,
    GovernanceUpdate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateSnapshot {
    pub id: String,
    pub mission_id: MissionId,
    pub tenant_id: TenantId,
    pub trigger: SnapshotTrigger,
    pub timestamp: String,
    pub state_hash: String,
    pub table_hashes: std::collections::HashMap<String, String>,
    pub metadata: SnapshotMetadata,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotTrigger {
    MissionStart,
    Checkpoint,
    MissionEnd,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotMetadata {
    pub claim_count: u64,
    pub relationship_count: u64,
    pub working_memory_entries: u64,
    pub governance_rule_count: u64,
    pub audit_entry_count: u64,
    pub captured_by: AgentId,
    pub captured_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoordinationError {
    pub code: String,
    pub message: String,
    pub spec: String,
    pub operation: String,
    pub agent_id: AgentId,
    pub tenant_id: TenantId,
    pub details: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2ARuleFilter {
    pub source_agent: Option<String>,
    pub target_agent: Option<String>,
    pub skill: Option<String>,
    pub action: Option<A2ARuleAction>,
    pub enabled: Option<bool>,
}
```

---

## 11. Integration Map

| Method | Limen Internal Module | Core Operation |
|---|---|---|
| `registerA2ARule` | `governance/a2a_rules` | INSERT into `a2a_governance_rules` table |
| `removeA2ARule` | `governance/a2a_rules` | Soft-delete (set `enabled = false`, retain for audit) |
| `listA2ARules` | `governance/a2a_rules` | SELECT with filter predicates |
| `validateA2AAction` | `governance/a2a_evaluator` | Priority-ordered rule matching, first match wins |
| `getCapabilityBoundary` | `governance/capability_boundaries` | Compute from agent trust + skill registration |
| `forkSession` | `sessions/fork_manager` | Copy working memory namespace, create branch scope |
| `listForks` | `sessions/fork_manager` | SELECT from `session_forks` by parent session |
| `mergeFork` | `sessions/fork_manager` + `claims/merge_engine` | Apply MergeStrategy to branch-scoped claims |
| `discardFork` | `sessions/fork_manager` | Mark discarded, retain claims for audit, release namespace |
| `getSyncState` | `sync/state_manager` | Read local node state + peer watermarks |
| `registerPeer` | `sync/peer_registry` | INSERT into `sync_peers`, initiate handshake |
| `removePeer` | `sync/peer_registry` | Mark deregistered, flush pending outbound |
| `triggerSync` | `sync/sync_engine` | Push/pull events since peer watermark |
| `getSyncLog` | `sync/event_log` | SELECT from append-only `sync_events` table |
| `captureSnapshot` | `replay/snapshot_engine` | Hash all 5 tables, store snapshot record |
| `verifyReplay` | `replay/verification_engine` | Re-hash current state, compare to stored snapshot |
| `getSnapshots` | `replay/snapshot_engine` | SELECT from `state_snapshots` by mission |
| `detectDivergence` | `replay/divergence_detector` | Row-by-row comparison between two snapshot states |

---

## 12. Invariants

1. **Tenant isolation.** A2A rules are tenant-scoped. No rule created by tenant A can affect agents of tenant B. Cross-tenant rule evaluation returns `COORDINATION_TENANT_MISMATCH`.

2. **Fork limits are hard.** Exceeding `maxForksPerSession` (default 5) returns `FORK_LIMIT_EXCEEDED` without partial creation. No fork is partially created then rolled back.

3. **Fork isolation is total.** No cross-fork claim visibility until merge. A forked session reads ONLY: (a) claims from parent at fork-point (snapshot), (b) claims created within the fork. Parent claims created AFTER fork-point are invisible.

4. **HLC causal ordering.** Sync uses Hybrid Logical Clocks. Physical clock component provides approximate wall-time; logical component ensures causal ordering within a node. No operation depends on synchronized wall clocks across nodes.

5. **Sync log append-only and hash-chained.** Once a sync event is written, it is immutable. Each event's hash includes the previous event's hash, creating a tamper-evident chain per tenant. `SYNC_HASH_CHAIN_BROKEN` halts sync until repaired.

6. **Replay verification is read-only.** `verifyReplay` and `detectDivergence` NEVER modify state. They compute hashes from current state and compare. No side effects beyond audit entry production.

7. **Divergence detection is deterministic.** Given identical snapshot pairs, `detectDivergence` produces identical `DivergenceReport` regardless of execution environment, timing, or caller identity.

8. **Capability boundary enforcement at query time.** `validateA2AAction` evaluates capability boundaries on every call. Cached boundaries expire and are recomputed. No stale boundary permits unauthorized access.

9. **All coordination operations produce audit entries.** Every method in `AgentCoordinationClient` emits an `AuditLogEntry` via the unified event bus. Failed operations produce audit entries with the error context. No silent operations.

10. **Sync conflict resolution is configurable per tenant.** Default is `last_writer_wins` by HLC. Tenants may configure `highest_confidence` or `manual`. The configured strategy is stored in `sync_config` and applied uniformly to all sync operations for that tenant.

11. **A2A rule evaluation is priority-ordered, first-match-wins.** Rules are sorted by `priority` ascending (lower = higher priority). The first rule whose conditions match determines the verdict. If no rule matches, the default verdict is `deny` (closed-world assumption).

12. **Fork merge respects MergeStrategy determinism.** For non-manual strategies, merge produces identical results regardless of when it runs. Same fork state + same parent state = same merge result. Manual strategy pauses for resolution (see SHARED_TYPES 14.2).

---

## Appendix A: Governance Action Mapping

All operations in this contract map to the `coordination` domain in `GovernanceAction`:

```typescript
{ domain: 'coordination'; operation: 'a2a_send' }   // validateA2AAction
{ domain: 'coordination'; operation: 'fork_session' } // forkSession, mergeFork, discardFork
{ domain: 'coordination'; operation: 'sync' }         // triggerSync, registerPeer, removePeer
{ domain: 'coordination'; operation: 'replay' }       // captureSnapshot, verifyReplay, detectDivergence
{ domain: 'coordination'; operation: 'rule' }         // registerA2ARule, removeA2ARule
```

---

## Appendix B: Capability Requirements

| Operation Group | Minimum Capability | Minimum Trust |
|---|---|---|
| A2A rule management | `multi_agent` + `governance_admin` | verified |
| A2A action validation | `multi_agent` | high |
| Session forking | `branching` | medium |
| Fork merge/discard | `branching` | medium |
| Distributed sync | `multi_agent` + `network_access` | high |
| Replay capture | `multi_agent` | high |
| Replay verification (read-only) | `belief_management` | low |

---

## Appendix C: Version History

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-05-05 | Initial ratification. Full A2A governance, session forking, distributed sync, deterministic replay. |
