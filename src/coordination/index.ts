// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Coordination Backend — Public API Surface
 *
 * Phase 6 (FR-009): Exports the CoordinationBackend interface and factory.
 * Enables Symphonic Swarm cluster mode to use Limen as its coordination substrate.
 *
 * Usage:
 *   import { createLimenBackend } from 'limen/coordination';
 *   const backend = createLimenBackend(limen, timeProvider);
 */

export {
  createLimenBackend,
  type CoordinationBackend,
  type SessionInfo,
  type DecisionInfo,
  type LockInfo,
} from './limen_backend.js';

// Subsystem 4: Coordination Governance
export {
  createAgentCoordinationClient,
  type AgentCoordinationClient,
} from './coordination_governance.js';

export type {
  // A2A types
  A2AGovernanceRule, A2AGovernanceRuleInput, A2ARuleFilter,
  A2AAction, A2AVerdict, A2ARuleAction, A2ARuleCondition, CapabilityBoundary,
  DataClassificationRule, ProactiveRule, ProactiveTrigger, ProactiveAction,
  // Fork types
  ForkedSession, ForkOptions, ForkMergeResult, ForkConflictResolution, ForkState,
  // Sync types
  HLCTimestamp, SyncEvent, SyncEventPayload, SyncEventType,
  SyncState, PeerRegistration, PeerState, Watermark,
  SyncOptions, SyncResult, SyncLogOptions, SyncCapability, SyncConflictResolution,
  // Replay types
  SnapshotTrigger, SnapshotTable, SnapshotMetadata, StateSnapshot,
  ReplayVerifyOptions, ReplayVerification, TableVerification,
  DivergenceReport, DivergenceEntry, DivergenceSummary,
  // Events
  CoordinationEvent,
} from './coordination_types.js';

export type {
  CoordinationErrorCode, AgentCoordinationError,
} from './coordination_errors.js';
