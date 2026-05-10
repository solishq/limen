// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AGENT_COORDINATION_GOVERNANCE.md §9
/**
 * Coordination Governance Error Types
 *
 * Implements: CO-9.1 through CO-9.14
 *
 * Discriminated union via `code` field.
 * Every error carries a `spec` field referencing the contract section.
 * All errors returned via Result<T> — never thrown (AD-11, CO-9.13).
 */

import type { GovernanceDecision } from '../adapters/shared/types.js';
import type { AgentCapability } from '../adapters/shared/types.js';
import type { TenantId } from '../kernel/interfaces/index.js';

// ============================================================================
// §9: CoordinationErrorCode (CO-9.1 — 20 codes)
// ============================================================================

/** CO-9.1: All 20 coordination error codes */
export type CoordinationErrorCode =
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
  | 'SYNC_WATERMARK_REGRESSION' // CO-6.6 amendment: used by distributed sync when watermark moves backward
  | 'REPLAY_HASH_MISMATCH'
  | 'REPLAY_SNAPSHOT_NOT_FOUND'
  | 'REPLAY_MISSION_NOT_FOUND'
  | 'GOVERNANCE_REFUSAL'
  | 'COORDINATION_TENANT_MISMATCH';

// ============================================================================
// §9: AgentCoordinationError — Discriminated Union (CO-9.2 through CO-9.10)
// ============================================================================

/** CO-9.2 through CO-9.10: Typed coordination error union */
export type AgentCoordinationError =
  | { readonly code: 'A2A_RULE_VIOLATION'; readonly message: string; readonly spec: 'ACG-4'; readonly ruleId: string; readonly reason: string }
  | { readonly code: 'A2A_CAPABILITY_DENIED'; readonly message: string; readonly spec: 'ACG-4.5'; readonly capability: AgentCapability }
  | { readonly code: 'A2A_RULE_NOT_FOUND'; readonly message: string; readonly spec: 'ACG-4'; readonly ruleId: string }
  | { readonly code: 'A2A_DUPLICATE_RULE'; readonly message: string; readonly spec: 'ACG-4'; readonly ruleId: string }
  | { readonly code: 'FORK_LIMIT_EXCEEDED'; readonly message: string; readonly spec: 'ACG-5.4'; readonly limit: number }
  | { readonly code: 'FORK_NOT_FOUND'; readonly message: string; readonly spec: 'ACG-5'; readonly forkId: string }
  | { readonly code: 'FORK_ALREADY_MERGED'; readonly message: string; readonly spec: 'ACG-5'; readonly forkId: string }
  | { readonly code: 'FORK_ALREADY_DISCARDED'; readonly message: string; readonly spec: 'ACG-5'; readonly forkId: string }
  | { readonly code: 'FORK_DEPTH_EXCEEDED'; readonly message: string; readonly spec: 'ACG-5.4'; readonly maxDepth: number }
  | { readonly code: 'FORK_INVALID_TURN'; readonly message: string; readonly spec: 'ACG-5'; readonly turn: number }
  | { readonly code: 'SYNC_PEER_UNREACHABLE'; readonly message: string; readonly spec: 'ACG-6'; readonly peerId: string }
  | { readonly code: 'SYNC_PEER_NOT_FOUND'; readonly message: string; readonly spec: 'ACG-6'; readonly peerId: string }
  | { readonly code: 'SYNC_CONFLICT_UNRESOLVABLE'; readonly message: string; readonly spec: 'ACG-6.10'; readonly conflictCount: number }
  | { readonly code: 'SYNC_HASH_CHAIN_BROKEN'; readonly message: string; readonly spec: 'ACG-6.2'; readonly peerId: string; readonly eventId: string }
  | { readonly code: 'SYNC_TIMEOUT'; readonly message: string; readonly spec: 'ACG-6.7'; readonly timeoutMs: number }
  | { readonly code: 'SYNC_WATERMARK_REGRESSION'; readonly message: string; readonly spec: 'ACG-6.6'; readonly peerId: string; readonly current: string; readonly attempted: string }
  | { readonly code: 'REPLAY_HASH_MISMATCH'; readonly message: string; readonly spec: 'ACG-7'; readonly expected: string; readonly actual: string }
  | { readonly code: 'REPLAY_SNAPSHOT_NOT_FOUND'; readonly message: string; readonly spec: 'ACG-7'; readonly snapshotId: string }
  | { readonly code: 'REPLAY_MISSION_NOT_FOUND'; readonly message: string; readonly spec: 'ACG-7'; readonly missionId: string }
  | { readonly code: 'GOVERNANCE_REFUSAL'; readonly message: string; readonly spec: 'ACG-12'; readonly decision: GovernanceDecision }
  | { readonly code: 'COORDINATION_TENANT_MISMATCH'; readonly message: string; readonly spec: 'ACG-12.1'; readonly expected: TenantId | null; readonly actual: TenantId | null };

// ============================================================================
// Error Factory Functions
// ============================================================================

export function a2aRuleViolation(ruleId: string, reason: string): AgentCoordinationError {
  return { code: 'A2A_RULE_VIOLATION', message: `A2A rule violation: ${reason}`, spec: 'ACG-4', ruleId, reason };
}

export function a2aCapabilityDenied(capability: AgentCapability): AgentCoordinationError {
  return { code: 'A2A_CAPABILITY_DENIED', message: `A2A capability denied: ${capability}`, spec: 'ACG-4.5', capability };
}

export function a2aRuleNotFound(ruleId: string): AgentCoordinationError {
  return { code: 'A2A_RULE_NOT_FOUND', message: `A2A rule not found: ${ruleId}`, spec: 'ACG-4', ruleId };
}

export function a2aDuplicateRule(ruleId: string): AgentCoordinationError {
  return { code: 'A2A_DUPLICATE_RULE', message: `Duplicate A2A rule: ${ruleId}`, spec: 'ACG-4', ruleId };
}

export function forkLimitExceeded(limit: number): AgentCoordinationError {
  return { code: 'FORK_LIMIT_EXCEEDED', message: `Fork limit exceeded: max ${limit} forks`, spec: 'ACG-5.4', limit };
}

export function forkNotFound(forkId: string): AgentCoordinationError {
  return { code: 'FORK_NOT_FOUND', message: `Fork not found: ${forkId}`, spec: 'ACG-5', forkId };
}

export function forkAlreadyMerged(forkId: string): AgentCoordinationError {
  return { code: 'FORK_ALREADY_MERGED', message: `Fork already merged: ${forkId}`, spec: 'ACG-5', forkId };
}

export function forkAlreadyDiscarded(forkId: string): AgentCoordinationError {
  return { code: 'FORK_ALREADY_DISCARDED', message: `Fork already discarded: ${forkId}`, spec: 'ACG-5', forkId };
}

export function forkDepthExceeded(maxDepth: number): AgentCoordinationError {
  return { code: 'FORK_DEPTH_EXCEEDED', message: `Fork depth exceeded: max ${maxDepth}`, spec: 'ACG-5.4', maxDepth };
}

export function forkInvalidTurn(turn: number): AgentCoordinationError {
  return { code: 'FORK_INVALID_TURN', message: `Invalid fork turn: ${turn}`, spec: 'ACG-5', turn };
}

export function syncPeerUnreachable(peerId: string): AgentCoordinationError {
  return { code: 'SYNC_PEER_UNREACHABLE', message: `Sync peer unreachable: ${peerId}`, spec: 'ACG-6', peerId };
}

export function syncPeerNotFound(peerId: string): AgentCoordinationError {
  return { code: 'SYNC_PEER_NOT_FOUND', message: `Sync peer not found: ${peerId}`, spec: 'ACG-6', peerId };
}

export function syncConflictUnresolvable(conflictCount: number): AgentCoordinationError {
  return { code: 'SYNC_CONFLICT_UNRESOLVABLE', message: `${conflictCount} unresolvable sync conflict(s)`, spec: 'ACG-6.10', conflictCount };
}

export function syncHashChainBroken(peerId: string, eventId: string): AgentCoordinationError {
  return { code: 'SYNC_HASH_CHAIN_BROKEN', message: `Hash chain broken for peer ${peerId} at event ${eventId}`, spec: 'ACG-6.2', peerId, eventId };
}

export function syncTimeout(timeoutMs: number): AgentCoordinationError {
  return { code: 'SYNC_TIMEOUT', message: `Sync timed out after ${timeoutMs}ms`, spec: 'ACG-6.7', timeoutMs };
}

/** CO-6.6 amendment: BRK-CO-010 — documented as contract extension for distributed sync watermark enforcement */
export function syncWatermarkRegression(peerId: string, current: string, attempted: string): AgentCoordinationError {
  return { code: 'SYNC_WATERMARK_REGRESSION', message: `Watermark regression for peer ${peerId}: attempted ${attempted} < current ${current}`, spec: 'ACG-6.6', peerId, current, attempted };
}

export function replayHashMismatch(expected: string, actual: string): AgentCoordinationError {
  return { code: 'REPLAY_HASH_MISMATCH', message: `Replay hash mismatch: expected ${expected.substring(0, 16)}..., got ${actual.substring(0, 16)}...`, spec: 'ACG-7', expected, actual };
}

export function replaySnapshotNotFound(snapshotId: string): AgentCoordinationError {
  return { code: 'REPLAY_SNAPSHOT_NOT_FOUND', message: `Replay snapshot not found: ${snapshotId}`, spec: 'ACG-7', snapshotId };
}

export function replayMissionNotFound(missionId: string): AgentCoordinationError {
  return { code: 'REPLAY_MISSION_NOT_FOUND', message: `Mission not found for replay: ${missionId}`, spec: 'ACG-7', missionId };
}

export function coordinationGovernanceRefusal(decision: GovernanceDecision): AgentCoordinationError {
  return { code: 'GOVERNANCE_REFUSAL', message: `Coordination operation refused by governance: ${decision.verdict}`, spec: 'ACG-12', decision };
}

export function coordinationTenantMismatch(expected: TenantId | null, actual: TenantId | null): AgentCoordinationError {
  return { code: 'COORDINATION_TENANT_MISMATCH', message: `Tenant mismatch: expected ${String(expected)}, got ${String(actual)}`, spec: 'ACG-12.1', expected, actual };
}
