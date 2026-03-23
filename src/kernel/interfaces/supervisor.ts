/**
 * Supervisor Decision Model interfaces for Phase 0A governance layer.
 * Truth Model: Deliverable 5 (Supervisor Decision Model)
 *
 * Phase: 0A (Governance Primitives)
 *
 * BC-040: 9 supervisor types with defined authority scopes.
 * BC-041: 9 decision outcomes.
 * BC-042: Hard-policy decisions are immutable and non-overridable by humans.
 * BC-043: Evaluators can assess only (no revoke authority).
 * BC-044: Scope-bound authority enforcement.
 * BC-045: Orthogonal decisions compose; contradictions resolved by precedence.
 * BC-046: Timeout creates synthetic decision (not silent skip).
 * BC-047: SuspensionRecord with 'active' | 'resolved' state.
 * BC-048: Resume tokens: plaintext returned once, stored as SHA-256 hash.
 * BC-049: Mission suspended → all tasks implicitly suspended (cascade).
 * BC-050: Task suspended → all attempts implicitly suspended.
 * BC-051: Parent handoff suspended ≠ auto-suspend child task (autonomy preserved).
 * BC-052 (v1.1): handoff.parent-suspended notification for delegate agents.
 * INV-X04: Every entity carries schemaVersion.
 * INV-X05: Suspension is never a lifecycle state — it's orthogonal.
 * INV-X12: origin distinguishes runtime from migration-backfill.
 */

import type { TaskId, AgentId, Result } from './common.js';
import type {
  SupervisorDecisionId, SuspensionRecordId, HandoffId,
} from './governance_ids.js';
import type { HandoffLifecycleState } from './lifecycle.js';
import type { DatabaseConnection } from './database.js';

// ─── Supervisor Types ───

/**
 * BC-040: 9 supervisor types with defined authority scopes.
 * Each type has specific capabilities and limitations:
 *   - hard-policy: immutable, non-overridable (BC-042)
 *   - evaluator: assess only, no revoke authority (BC-043)
 *   - system-timeout: creates synthetic decision (BC-046)
 */
export type SupervisorType =
  | 'human'
  | 'hard-policy'
  | 'soft-policy'
  | 'deployment-gate'
  | 'budget-authority'
  | 'evaluator'
  | 'parent-agent'
  | 'system-timeout'
  | 'system-migration';

/**
 * BC-041: 9 decision outcomes.
 * BC-042: hard-policy decisions that produce 'reject' or 'revoke' are immutable.
 */
export type DecisionOutcome =
  | 'approve'
  | 'reject'
  | 'request-revision'
  | 'request-clarification'
  | 'extend-budget'
  | 'reduce-scope'
  | 'delegate-review'
  | 'defer'
  | 'revoke';

// ─── Suspension Types ───

/**
 * BC-047: Suspension record state.
 * 'active' = entity is currently suspended.
 * 'resolved' = suspension has been lifted by a supervisor decision.
 * INV-X05: Suspension is orthogonal to lifecycle state.
 */
export type SuspensionState = 'active' | 'resolved';

/**
 * BC-047: Target types for suspension records.
 * Suspension applies to missions or tasks (not runs directly).
 */
export type SuspensionTargetType = 'mission' | 'task';

// ─── Handoff Types ───

/**
 * BC-029 (v1.1): Typed handoff acceptance outcomes.
 * Recorded in trace event payloads for programmatic analysis.
 */
export type HandoffAcceptanceOutcome =
  | 'accepted-as-is'
  | 'accepted-with-scope-reduction';

/**
 * BC-029 (v1.1): Typed handoff rejection reasons.
 * Recorded in trace event payloads for programmatic analysis.
 */
export type HandoffRejectionReason =
  | 'rejected-insufficient-evidence'
  | 'rejected-missing-capability'
  | 'rejected-contract-ambiguity';

/**
 * BC-048: Hash type for stored resume tokens.
 * Plaintext returned once to caller, only SHA-256 hash persisted.
 */
export type ResumeTokenHash = string & { readonly __brand: 'ResumeTokenHash' };

// ─── Entity Interfaces ───

/**
 * BC-040, BC-041: Supervisor decision record.
 * Immutable once created. BC-042: hard-policy decisions are non-overridable.
 * BC-044: Authority is scope-bound (target_type + target_id).
 */
export interface SupervisorDecision {
  readonly decisionId: SupervisorDecisionId;
  readonly tenantId: string;
  readonly supervisorType: SupervisorType;
  /** Entity type being governed */
  readonly targetType: 'mission' | 'task' | 'handoff' | 'attempt';
  /** Entity ID being governed */
  readonly targetId: string;
  /** BC-041: Decision outcome */
  readonly outcome: DecisionOutcome;
  /** Rationale for the decision (redacted at API boundary) */
  readonly rationale: string;
  /** BC-045: Precedence for conflict resolution */
  readonly precedence: number;
  /** INV-X04: Governance schema version */
  readonly schemaVersion: string;
  /** INV-X12: Record origin */
  readonly origin: 'runtime' | 'migration-backfill';
  readonly createdAt: string;
}

/**
 * BC-047: Suspension record — orthogonal to lifecycle state (INV-X05).
 * Entities freeze at current state when suspended, resume to same state.
 * BC-049: Mission suspension cascades implicitly to tasks.
 * BC-050: Task suspension cascades implicitly to attempts.
 * BC-051: Parent handoff suspension ≠ auto-suspend child task.
 */
export interface SuspensionRecord {
  readonly suspensionId: SuspensionRecordId;
  readonly tenantId: string;
  /** BC-047: Target entity type */
  readonly targetType: SuspensionTargetType;
  /** BC-047: Target entity ID */
  readonly targetId: string;
  /** BC-047: Current suspension state */
  readonly state: SuspensionState;
  /** Decision that created this suspension */
  readonly creatingDecisionId: SupervisorDecisionId;
  /** Decision that resolved this suspension (null while active) */
  readonly resolutionDecisionId: SupervisorDecisionId | null;
  /** INV-X04: Governance schema version */
  readonly schemaVersion: string;
  /** INV-X12: Record origin */
  readonly origin: 'runtime' | 'migration-backfill';
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

/**
 * Handoff — delegation of task execution to another agent.
 * BC-069: Handoff lifecycle with typed acceptance/rejection outcomes.
 * BC-052 (v1.1): Delegate notification on parent suspension cascade.
 */
export interface Handoff {
  readonly handoffId: HandoffId;
  readonly tenantId: string;
  /** Task being delegated */
  readonly fromTaskId: TaskId;
  /** Agent receiving the delegation */
  readonly toAgentId: AgentId;
  /** Current handoff lifecycle state */
  readonly state: HandoffLifecycleState;
  /** Acceptance outcome (set when state transitions to 'accepted') */
  readonly acceptanceOutcome: HandoffAcceptanceOutcome | null;
  /** Rejection reason (set when state transitions to 'rejected') */
  readonly rejectionReason: HandoffRejectionReason | null;
  /** INV-X04: Governance schema version */
  readonly schemaVersion: string;
  /** INV-X12: Record origin */
  readonly origin: 'runtime' | 'migration-backfill';
  readonly createdAt: string;
}

// ─── Store Interfaces ───

/**
 * SupervisorDecision persistence operations.
 * BC-042: hard-policy decisions are immutable once created.
 */
export interface SupervisorDecisionStore {
  create(conn: DatabaseConnection, decision: SupervisorDecision): Result<SupervisorDecision>;
  get(conn: DatabaseConnection, decisionId: SupervisorDecisionId): Result<SupervisorDecision | null>;
  getByTarget(
    conn: DatabaseConnection,
    targetType: string,
    targetId: string,
  ): Result<readonly SupervisorDecision[]>;
}

/**
 * SuspensionRecord persistence operations.
 * BC-047: Active suspensions are checked on lifecycle transitions.
 */
export interface SuspensionStore {
  create(conn: DatabaseConnection, suspension: SuspensionRecord): Result<SuspensionRecord>;
  get(conn: DatabaseConnection, suspensionId: SuspensionRecordId): Result<SuspensionRecord | null>;
  /** Returns active suspension for a target, or null if not suspended */
  getActiveForTarget(
    conn: DatabaseConnection,
    targetType: SuspensionTargetType,
    targetId: string,
  ): Result<SuspensionRecord | null>;
  /** BC-047: Resolve suspension with a supervisor decision */
  resolve(
    conn: DatabaseConnection,
    suspensionId: SuspensionRecordId,
    resolutionDecisionId: SupervisorDecisionId,
  ): Result<SuspensionRecord>;
}

/**
 * Handoff persistence operations.
 */
export interface HandoffStore {
  create(conn: DatabaseConnection, handoff: Handoff): Result<Handoff>;
  get(conn: DatabaseConnection, handoffId: HandoffId): Result<Handoff | null>;
  updateState(
    conn: DatabaseConnection,
    handoffId: HandoffId,
    state: HandoffLifecycleState,
  ): Result<Handoff>;
}
