/**
 * Common types shared across all kernel modules.
 * S ref: S6-S13 (core objects), C-03 (TypeScript strict), C-09 (namespaces)
 *
 * Phase: 1 (Kernel)
 * Implements: §4 I-13 (branded types for RBAC), §4 I-03 (Result<T>),
 *             §34 (Permission), FM-10 (tenant isolation via branded types)
 */

// ─── Branded ID Types ───
// Compile-time nominal typing with zero runtime cost.
// Derived from FM-10 defense (tenant data leakage prevention via type safety)
// and C-03 (TypeScript strict mode). See SDD FPD-2.

/** §6: Mission identifier */
export type TenantId = string & { readonly __brand: 'TenantId' };
/** §34: User identifier */
export type UserId = string & { readonly __brand: 'UserId' };
/** §7: Agent identifier */
export type AgentId = string & { readonly __brand: 'AgentId' };
/** §6: Mission identifier */
export type MissionId = string & { readonly __brand: 'MissionId' };
/** §7: Task identifier */
export type TaskId = string & { readonly __brand: 'TaskId' };
/** §10: Event identifier */
export type EventId = string & { readonly __brand: 'EventId' };
/** §8: Artifact identifier */
export type ArtifactId = string & { readonly __brand: 'ArtifactId' };
/** §13: Policy identifier */
export type PolicyId = string & { readonly __brand: 'PolicyId' };
/** §34: Role identifier */
export type RoleId = string & { readonly __brand: 'RoleId' };
/** §26: Session identifier */
export type SessionId = string & { readonly __brand: 'SessionId' };

// ─── Operation Context ───
// Every kernel function receives this for identity threading.
// Derived from I-13 (authorization completeness) and FM-10 (tenant isolation).
// See SDD FPD-3.

/** §34: Permission strings per specification §34 + §31.5 */
export type Permission =
  | 'create_agent' | 'modify_agent' | 'delete_agent'
  | 'chat' | 'infer'
  | 'create_mission'
  | 'view_telemetry' | 'view_audit'
  | 'manage_providers' | 'manage_budgets' | 'manage_roles'
  | 'purge_data'
  | 'approve_response' | 'edit_response' | 'takeover_session' | 'review_batch'
  // Phase 10: Governance permissions (I-P10-41: MUST NOT activate dormant RBAC)
  | 'classify_claims' | 'manage_classification_rules'
  | 'manage_protected_predicates'
  | 'request_erasure' | 'export_compliance';

/**
 * Operation context for identity threading and RBAC enforcement.
 * S ref: I-13 (authorization completeness), FM-10 (tenant isolation)
 *
 * Every public kernel function accepts this as its identity parameter.
 * In single-tenant mode, tenantId is null. For system operations, userId is null.
 */
export interface OperationContext {
  readonly tenantId: TenantId | null;
  readonly userId: UserId | null;
  readonly agentId: AgentId | null;
  readonly permissions: ReadonlySet<Permission>;
  readonly sessionId?: SessionId;
}

// ─── Error Handling ───
// Deterministic error handling via discriminated union.
// Derived from C-03 (strict mode) and §3.1 (deterministic infrastructure).
// See SDD FPD-1.

/**
 * Standard kernel error. Machine-readable code + human-readable message + spec ref.
 * S ref: C-10 (error handling), §3.1 (deterministic)
 * BC-081: Optional violations array for structured governance error model.
 */
export interface KernelError {
  readonly code: string;
  readonly message: string;
  readonly spec: string;
  /** BC-081: Structured violation records for governance error classification. */
  readonly violations?: readonly import('./governance_ids.js').LimenViolation[];
}

/**
 * Discriminated union result type. Every kernel function returns this.
 * Forces callers to handle both success and error paths at compile time.
 * S ref: C-03 (TypeScript strict), §3.1 (deterministic infrastructure)
 */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KernelError };

// ─── Table Namespace Prefixes ───
// S ref: C-09

/** Valid table namespace prefixes per C-09 */
export type NamespacePrefix = 'core_' | 'memory_' | 'agent_' | 'obs_' | 'hitl_' | 'meter_' | 'gov_';
