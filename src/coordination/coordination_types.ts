// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AGENT_COORDINATION_GOVERNANCE.md §4-§8
/**
 * Coordination Governance Type Definitions
 *
 * Implements: CO-4.1 through CO-4.32, CO-5.1 through CO-5.20,
 *             CO-6.1 through CO-6.32, CO-7.1 through CO-7.22,
 *             CO-8.1 through CO-8.9
 *
 * All types derived from AGENT_COORDINATION_GOVERNANCE contract.
 * Uses shared types from SHARED_TYPES.md — never redefines them (CO-2.1).
 * All interfaces are readonly (AD-7, C-07).
 */

import type {
  AgentId, TenantId, SessionId, MissionId,
} from '../kernel/interfaces/index.js';
import type { ClassificationLevel, AgentTrustLevel, RateLimitPolicy, MergeStrategy, MergeConflict } from '../adapters/shared/types.js';
import type { AgentEvent } from '../adapters/shared/types.js';

// ============================================================================
// §4.1: A2AGovernanceRule (CO-4.1 through CO-4.10)
// ============================================================================

/** CO-4.11: A2A rule action discriminator */
export type A2ARuleAction = 'allow' | 'deny' | 'mask' | 'rate_limit';

/** CO-4.13: Condition operator */
export type ConditionOperator = 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'lt' | 'matches';

/** CO-4.12: A2A rule condition */
export interface A2ARuleCondition {
  readonly field: string;
  readonly operator: ConditionOperator;
  readonly value: string | number | boolean | readonly string[];
}

/** CO-4.1 through CO-4.10: Full A2A governance rule */
export interface A2AGovernanceRule {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly sourceAgent: AgentId | '*';
  readonly targetAgent: AgentId | '*';
  readonly skill: string | '*';
  readonly action: A2ARuleAction;
  readonly conditions: readonly A2ARuleCondition[];
  readonly priority: number;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly createdBy: AgentId;
}

/** CO-4.14: Input for rule creation (priority defaults to 100) */
export interface A2AGovernanceRuleInput {
  readonly sourceAgent: AgentId | '*';
  readonly targetAgent: AgentId | '*';
  readonly skill: string | '*';
  readonly action: A2ARuleAction;
  readonly conditions?: readonly A2ARuleCondition[];
  readonly priority?: number;
}

/** CO-4.15, CO-4.16: A2A action to evaluate */
export interface A2AAction {
  readonly type: 'send_message' | 'delegate_task' | 'share_knowledge' | 'request_capability' | 'invoke_skill';
  readonly sourceAgent: AgentId;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly classification: ClassificationLevel;
  readonly timestamp: string;
}

/** CO-4.17 through CO-4.21: A2A evaluation verdict */
export interface A2AVerdict {
  readonly allowed: boolean;
  readonly maskedFields: readonly string[] | null;
  readonly rateLimited: boolean;
  readonly reason: string;
  readonly ruleId: string;
  readonly evaluatedAt: string;
}

/** CO-4.22, CO-4.31, CO-4.32: Capability boundary */
export interface CapabilityBoundary {
  readonly agentId: AgentId;
  readonly skill: string;
  readonly clearanceRequired: ClassificationLevel;
  readonly allowedFields: readonly string[];
  readonly maskedFields: readonly string[];
  readonly rateLimit: RateLimitPolicy | null;
  readonly trustRequired: AgentTrustLevel;
  readonly expiresAt: string | null;
}

/** CO-4.23: Data classification rule */
export interface DataClassificationRule {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly predicatePattern: string;
  readonly classification: ClassificationLevel;
  readonly autoApply: boolean;
  readonly createdBy: AgentId;
}

/** CO-4.25, CO-4.28 through CO-4.30: Proactive trigger */
export type ProactiveTrigger =
  | { readonly type: 'event_pattern'; readonly eventType: AgentEvent; readonly condition?: A2ARuleCondition }
  | { readonly type: 'threshold'; readonly metric: string; readonly operator: 'gt' | 'lt' | 'eq'; readonly value: number }
  | { readonly type: 'schedule'; readonly cronExpression: string };

/** CO-4.26: Proactive action */
export type ProactiveAction =
  | { readonly type: 'notify_agent'; readonly agentId: AgentId; readonly message: string }
  | { readonly type: 'trigger_sync'; readonly options: SyncOptions }
  | { readonly type: 'capture_snapshot'; readonly missionId: MissionId; readonly trigger: SnapshotTrigger };

/** CO-4.24: Proactive rule */
export interface ProactiveRule {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly trigger: ProactiveTrigger;
  readonly action: ProactiveAction;
  readonly cooldownSeconds: number;
  readonly enabled: boolean;
}

/** CO-4.27: A2A rule filter */
export interface A2ARuleFilter {
  readonly sourceAgent?: AgentId;
  readonly targetAgent?: AgentId;
  readonly skill?: string;
  readonly action?: A2ARuleAction;
  readonly enabled?: boolean;
}

// ============================================================================
// §5: Session Forking Types (CO-5.1 through CO-5.20)
// ============================================================================

/** CO-5.1 through CO-5.4: Fork creation options */
export interface ForkOptions {
  readonly label?: string;
  readonly inheritWorkingMemory?: boolean;
  readonly inheritClaims?: boolean;
  readonly maxDurationMs?: number;
}

/** CO-5.9: Fork lifecycle state */
export type ForkState = 'active' | 'merged' | 'discarded';

/** CO-5.5 through CO-5.10: Forked session record */
export interface ForkedSession {
  readonly forkId: string;
  readonly parentSessionId: SessionId;
  readonly forkedSessionId: SessionId;
  readonly forkPoint: number;
  readonly state: ForkState;
  readonly label: string | null;
  readonly claimsSinceFork: number;
  readonly workingMemoryNamespace: string;
  readonly createdAt: string;
  readonly mergedAt: string | null;
  readonly discardedAt: string | null;
}

/** CO-5.15, CO-5.16: Fork merge result */
export interface ForkMergeResult {
  readonly forkId: string;
  readonly status: 'completed' | 'pending_resolution' | 'conflict_detected';
  readonly claimsMerged: number;
  readonly claimsDiscarded: number;
  readonly conflictsResolved: readonly ForkConflictResolution[];
  readonly unresolvedConflicts: readonly MergeConflict[];
  readonly mergedAt: string;
}

/** CO-5.16: Conflict resolution record */
export interface ForkConflictResolution {
  readonly subject: string;
  readonly predicate: string;
  readonly resolution: 'kept_fork' | 'kept_parent' | 'kept_both' | 'discarded_both';
  readonly strategy: MergeStrategy;
}

/** CO-5.17 through CO-5.20: Fork limits (hardcoded defaults) */
export const FORK_LIMITS = Object.freeze({
  MAX_FORKS_PER_SESSION: 5,
  MAX_ACTIVE_FORKS_PER_AGENT: 10,
  MAX_FORK_DEPTH: 2,
  AUTO_DISCARD_TIMEOUT_MS: 3_600_000, // 1 hour
});

// ============================================================================
// §6: Distributed Sync Types (CO-6.1 through CO-6.32)
// ============================================================================

/** CO-6.1, CO-6.2: Hybrid Logical Clock timestamp */
export interface HLCTimestamp {
  readonly physical: number;
  readonly logical: number;
  readonly nodeId: string;
}

/**
 * CO-6.2: Compare HLC timestamps for total order.
 * physical first, then logical, then nodeId lexicographically.
 */
export function compareHLC(a: HLCTimestamp, b: HLCTimestamp): number {
  if (a.physical !== b.physical) return a.physical - b.physical;
  if (a.logical !== b.logical) return a.logical - b.logical;
  if (a.nodeId < b.nodeId) return -1;
  if (a.nodeId > b.nodeId) return 1;
  return 0;
}

/** CO-6.4: Sync event type */
export type SyncEventType = 'claim_created' | 'claim_retracted' | 'relationship_created' | 'governance_update';

/** CO-6.8, CO-6.26 through CO-6.29: Sync event payload discriminated union */
export type SyncEventPayload =
  | { readonly type: 'claim_created'; readonly claimId: string; readonly subject: string; readonly predicate: string; readonly value: string; readonly confidence: number }
  | { readonly type: 'claim_retracted'; readonly claimId: string; readonly reason: string }
  | { readonly type: 'relationship_created'; readonly sourceId: string; readonly targetId: string; readonly relationshipType: string }
  | { readonly type: 'governance_update'; readonly ruleId: string; readonly operation: 'created' | 'removed' | 'updated' };

/** CO-6.3 through CO-6.9: Sync event (hash-chained) */
export interface SyncEvent {
  readonly id: string;
  readonly type: SyncEventType;
  readonly hlcTimestamp: HLCTimestamp;
  readonly tenantId: TenantId;
  readonly payload: SyncEventPayload;
  readonly hash: string;
  readonly previousHash: string;
}

/** CO-6.12: Sync capability */
export type SyncCapability = 'push' | 'pull' | 'bidirectional';

/** CO-6.11: Peer registration input */
export interface PeerRegistration {
  readonly nodeId: string;
  readonly endpoint: string;
  readonly tenantId: TenantId;
  readonly capabilities: readonly SyncCapability[];
  readonly maxBatchSize: number;
}

/** CO-6.14: Peer status */
export type PeerStatus = 'active' | 'unreachable' | 'deregistered' | 'suspended';

/** CO-6.13, CO-6.31, CO-6.32: Peer state */
export interface PeerState {
  readonly peerId: string;
  readonly nodeId: string;
  readonly endpoint: string;
  readonly status: PeerStatus;
  readonly lastSeenAt: string;
  readonly lastSyncedAt: string | null;
  readonly watermark: HLCTimestamp | null;
  readonly pendingOutbound: number;
  readonly failedAttempts: number;
}

/** CO-6.15: Watermark */
export interface Watermark {
  readonly peerId: string;
  readonly hlcTimestamp: HLCTimestamp;
  readonly confirmedAt: string;
}

/** CO-6.10, CO-6.30: Sync state */
export interface SyncState {
  readonly nodeId: string;
  readonly tenantId: TenantId;
  readonly peers: readonly PeerState[];
  readonly lastSyncAt: string | null;
  readonly pendingEvents: number;
  readonly watermarks: readonly Watermark[];
  readonly hashChainValid: boolean;
}

/** CO-6.20: Sync conflict resolution strategy */
export type SyncConflictResolution = 'last_writer_wins' | 'highest_confidence' | 'manual';

/** CO-6.16 through CO-6.19: Sync options */
export interface SyncOptions {
  readonly targetPeers?: readonly string[];
  readonly direction: 'push' | 'pull' | 'bidirectional';
  readonly batchSize?: number;
  readonly timeoutMs?: number;
  readonly conflictResolution?: SyncConflictResolution;
}

/** CO-6.21: Sync result */
export interface SyncResult {
  readonly syncId: string;
  readonly direction: 'push' | 'pull' | 'bidirectional';
  readonly eventsPushed: number;
  readonly eventsPulled: number;
  readonly conflictsResolved: number;
  readonly conflictsUnresolved: number;
  readonly peersContacted: number;
  readonly peersUnreachable: readonly string[];
  readonly watermarksAdvanced: readonly Watermark[];
  readonly duration: number;
  readonly completedAt: string;
}

/** CO-6.22: Sync log query options */
export interface SyncLogOptions {
  readonly since?: HLCTimestamp;
  readonly until?: HLCTimestamp;
  readonly type?: SyncEventType;
  readonly limit?: number;
  readonly offset?: number;
}

// ============================================================================
// §7: Deterministic Replay Types (CO-7.1 through CO-7.22)
// ============================================================================

/** CO-7.1: Snapshot trigger */
export type SnapshotTrigger = 'mission_start' | 'checkpoint' | 'mission_end' | 'manual';

/** CO-7.7: Snapshot table identifiers */
export type SnapshotTable = 'claims' | 'relationships' | 'working_memory' | 'governance_rules' | 'audit_entries';

/** CO-7.8: Snapshot metadata */
export interface SnapshotMetadata {
  readonly claimCount: number;
  readonly relationshipCount: number;
  readonly workingMemoryEntries: number;
  readonly governanceRuleCount: number;
  readonly auditEntryCount: number;
  readonly capturedBy: AgentId;
  readonly capturedAt: string;
}

/** CO-7.2 through CO-7.6: State snapshot */
export interface StateSnapshot {
  readonly id: string;
  readonly missionId: MissionId;
  readonly tenantId: TenantId;
  readonly trigger: SnapshotTrigger;
  readonly timestamp: string;
  readonly stateHash: string;
  readonly tableHashes: Readonly<Record<SnapshotTable, string>>;
  readonly metadata: SnapshotMetadata;
}

/** CO-7.12 through CO-7.15: Replay verify options */
export interface ReplayVerifyOptions {
  readonly fromSnapshot?: string;
  readonly toSnapshot?: string;
  readonly tables?: readonly SnapshotTable[];
  readonly haltOnFirstDivergence?: boolean;
}

/** CO-7.17: Table verification result */
export interface TableVerification {
  readonly table: SnapshotTable;
  readonly expectedHash: string;
  readonly actualHash: string;
  readonly match: boolean;
  readonly rowsChecked: number;
}

/** CO-7.16: Replay verification result */
export interface ReplayVerification {
  readonly missionId: MissionId;
  readonly verified: boolean;
  readonly fromSnapshotId: string;
  readonly toSnapshotId: string;
  readonly expectedHash: string;
  readonly actualHash: string;
  readonly tableResults: Readonly<Record<SnapshotTable, TableVerification>>;
  readonly divergences: readonly DivergenceEntry[];
  readonly verifiedAt: string;
  readonly duration: number;
}

/** CO-7.19, CO-7.22: Divergence entry */
export interface DivergenceEntry {
  readonly table: SnapshotTable;
  readonly rowId: string;
  readonly field: string;
  readonly valueInA: string | null;
  readonly valueInB: string | null;
  readonly divergenceType: 'modified' | 'added_in_a' | 'added_in_b' | 'missing_in_a' | 'missing_in_b';
}

/** CO-7.20: Divergence summary */
export interface DivergenceSummary {
  readonly totalDivergences: number;
  readonly byTable: Readonly<Record<SnapshotTable, number>>;
  readonly byType: Readonly<Record<DivergenceEntry['divergenceType'], number>>;
}

/** CO-7.18: Divergence report */
export interface DivergenceReport {
  readonly snapshotA: string;
  readonly snapshotB: string;
  readonly divergences: readonly DivergenceEntry[];
  readonly summary: DivergenceSummary;
  readonly generatedAt: string;
}

// ============================================================================
// §8: Coordination Events (CO-8.1 through CO-8.9)
// ============================================================================

/** CO-8.1: 22 coordination event types across 4 domains */
export type CoordinationEvent =
  // A2A events (6)
  | 'a2a:rule_registered'
  | 'a2a:rule_removed'
  | 'a2a:action_validated'
  | 'a2a:action_denied'
  | 'a2a:action_masked'
  | 'a2a:rate_limited'
  // Fork events (4)
  | 'fork:created'
  | 'fork:merged'
  | 'fork:discarded'
  | 'fork:conflict_detected'
  // Sync events (8)
  | 'sync:started'
  | 'sync:completed'
  | 'sync:failed'
  | 'sync:conflict_resolved'
  | 'sync:peer_registered'
  | 'sync:peer_removed'
  | 'sync:peer_unreachable'
  | 'sync:watermark_advanced'
  // Replay events (4)
  | 'replay:snapshot_captured'
  | 'replay:verification_complete'
  | 'replay:verification_failed'
  | 'replay:divergence_detected';

/** CO-8.2 through CO-8.9: Validate coordination events are complete (compile-time check) */
export const ALL_COORDINATION_EVENTS: readonly CoordinationEvent[] = Object.freeze([
  'a2a:rule_registered', 'a2a:rule_removed', 'a2a:action_validated',
  'a2a:action_denied', 'a2a:action_masked', 'a2a:rate_limited',
  'fork:created', 'fork:merged', 'fork:discarded', 'fork:conflict_detected',
  'sync:started', 'sync:completed', 'sync:failed', 'sync:conflict_resolved',
  'sync:peer_registered', 'sync:peer_removed', 'sync:peer_unreachable',
  'sync:watermark_advanced',
  'replay:snapshot_captured', 'replay:verification_complete',
  'replay:verification_failed', 'replay:divergence_detected',
]);

// ============================================================================
// Default constants
// ============================================================================

/** CO-4.14: Default priority for new rules */
export const DEFAULT_RULE_PRIORITY = 100;

/** CO-6.18: Default sync batch size */
export const DEFAULT_SYNC_BATCH_SIZE = 100;

/** CO-6.19: Default sync timeout */
export const DEFAULT_SYNC_TIMEOUT_MS = 30_000;

/** CO-6.22: Default sync log limit */
export const DEFAULT_SYNC_LOG_LIMIT = 100;

/** CO-6.22: Max sync log limit */
export const MAX_SYNC_LOG_LIMIT = 1000;

/** CO-12.11: Default verdict when no rule matches (closed-world) */
export const DEFAULT_NO_MATCH_VERDICT: A2AVerdict = Object.freeze({
  allowed: false,
  maskedFields: null,
  rateLimited: false,
  reason: 'No matching rule found (closed-world assumption: default deny)',
  ruleId: '__default_deny__',
  evaluatedAt: '',
});
