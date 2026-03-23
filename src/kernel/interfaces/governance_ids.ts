/**
 * Governance branded ID types and violation primitives for Phase 0A.
 * Truth Model: Deliverable 1 (Branded ID System), Deliverable 7 (Structured Error Model)
 *
 * Phase: 0A (Foundation)
 * Build Order: 1 (no dependencies)
 *
 * BC-001 through BC-006: Branded ID compile-time safety.
 * BC-002: Brand strings are unique across all branded types in the codebase.
 * BC-003: No brand string collision with the 25 existing IDs.
 * BC-006: CorrelationId links EventBus + TraceEmitter (Binding 12).
 * BC-080: LimenViolation structured violation type.
 * INV-001: All governance branded types exported through kernel/interfaces/index.ts.
 *
 * After Phase 0A: 38 total branded IDs (25 existing + 1 from split + 12 new).
 */

// ─── Run Identity (Deliverable 2) ───

/** Table 6: Run identifier — constitutional execution envelope. BC-010 */
export type RunId = string & { readonly __brand: 'RunId' };

/** Table 6: Attempt identifier — single execution try within a task. BC-011 */
export type AttemptId = string & { readonly __brand: 'AttemptId' };

/** Table 6: Trace event identifier — immutable constitutional event. BC-020 */
export type TraceEventId = string & { readonly __brand: 'TraceEventId' };

// ─── Contract & Governance (Deliverables 4-5) ───

/** Principle 9: Mission contract identifier — immutable typed success criteria. BC-030 */
export type MissionContractId = string & { readonly __brand: 'MissionContractId' };

/** Table 3: Supervisor decision identifier — immutable governance decision. BC-040 */
export type SupervisorDecisionId = string & { readonly __brand: 'SupervisorDecisionId' };

/** Principle 14: Suspension record identifier. BC-047 */
export type SuspensionRecordId = string & { readonly __brand: 'SuspensionRecordId' };

/** Table 2D: Handoff identifier — delegation lifecycle. BC-069 */
export type HandoffId = string & { readonly __brand: 'HandoffId' };

/** Table 4: Checkpoint identifier. BC-065 */
export type CheckpointId = string & { readonly __brand: 'CheckpointId' };

/** Table 1: Artifact lineage tracking identifier. BC-001 */
export type ArtifactLineageId = string & { readonly __brand: 'ArtifactLineageId' };

// ─── Eval & Capability (Deliverables 8-9) ───

/** Principle 8: Eval case identifier — immutable evaluation record. BC-090 */
export type EvalCaseId = string & { readonly __brand: 'EvalCaseId' };

/** Principle 16: Capability manifest identifier. BC-100 */
export type CapabilityManifestId = string & { readonly __brand: 'CapabilityManifestId' };

// ─── Cross-Cutting (Binding 12) ───

/**
 * Binding 12: Neutral correlation identifier.
 * Generated once per causal action at the system-call/operation level.
 * Passed to BOTH EventBus.emit() and TraceEmitter.emit().
 * Neither emission system generates its own.
 * INV-X10: Same CorrelationId shared across both systems for same causal action.
 */
export type CorrelationId = string & { readonly __brand: 'CorrelationId' };

// ─── Structured Violation Model (Deliverable 7, BC-080) ───

/**
 * BC-080: Violation type categories for governance violations.
 * Each violation is classified into exactly one of six categories.
 */
export type ViolationType =
  | 'INVARIANT'
  | 'LIFECYCLE'
  | 'AUTHORITY'
  | 'BUDGET'
  | 'CAPABILITY'
  | 'POLICY';

/**
 * BC-080: Structured violation record for agent error model.
 * BC-081: LimenError gains optional violations array using this type.
 * BC-082: All violation messages redacted through existing error pipeline (S39 IP-4).
 */
export interface LimenViolation {
  /** Violation category */
  readonly type: ViolationType;
  /** Machine-readable violation code */
  readonly code: string;
  /** Human-readable description (redacted at API boundary) */
  readonly message: string;
  /** Spec section reference for traceability */
  readonly spec: string;
  /** Additional structured context (redacted at API boundary) */
  readonly context?: Readonly<Record<string, unknown>>;
}
