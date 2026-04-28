/**
 * Kernel interface re-exports.
 * S ref: Part XII (inter-agent handoff via interface files)
 *
 * All kernel interfaces are type-only -- no implementation.
 * Team B (Orchestration) imports from this file only.
 */

// Common types
export type {
  TenantId, UserId, AgentId, MissionId, TaskId,
  EventId, ArtifactId, PolicyId, RoleId, SessionId,
  Permission, OperationContext, KernelError, Result,
  NamespacePrefix,
} from './common.js';

// Database lifecycle
export type {
  TenancyConfig, DatabaseConfig, DatabaseConnection,
  DatabaseLifecycle, MigrationEntry, MigrationResult,
  SchemaVerification, RunResult, ExportResult, DatabaseHealth,
} from './database.js';

// Audit trail
export type {
  AuditEntry, AuditCreateInput, AuditQueryFilter,
  ChainVerification, ArchiveResult, TombstoneResult, AuditTrail,
} from './audit.js';

// Cryptographic primitives
export type {
  CryptoConfig, EncryptedPayload, CryptoEngine, VaultOperations,
} from './crypto.js';

// Event bus
export type {
  EventScope, Propagation, EventPayload, EventHandler, EventBus,
} from './events.js';

// RBAC engine
export type {
  RbacEngine,
} from './rbac.js';

// Retention scheduler
export type {
  RetentionPolicy, RetentionRunResult, RetentionScheduler,
} from './retention.js';

// Namespace enforcer
export type {
  NamespaceEnforcer,
} from './namespace.js';

// Tenant context
export type {
  TenantContext,
} from './tenant.js';

// Rate limiter
export type {
  BucketType, RateLimitStatus, RateLimiter,
} from './rate_limiter.js';

// Kernel factory
export type {
  KernelConfig, KernelHealth, Kernel,
  CreateKernelFn, DestroyKernelFn,
} from './kernel.js';

// ─── Phase 0A Governance Primitives ───

// Governance IDs
export type {
  RunId, AttemptId, TraceEventId, MissionContractId,
  SupervisorDecisionId, SuspensionRecordId, HandoffId,
  CheckpointId, ArtifactLineageId, EvalCaseId,
  CapabilityManifestId, CorrelationId,
  ViolationType, LimenViolation,
} from './governance_ids.js';

// Lifecycle states
export type {
  MissionLifecycleState, MissionActiveSubstate,
  TaskLifecycleState, TaskReadiness,
  HandoffLifecycleState,
  TransitionResult, TransitionEnforcer,
} from './lifecycle.js';

// Run identity
export type {
  Run, RunState, Attempt, AttemptState,
  AttemptPinnedVersions, AttemptFailureRef, AttemptStrategyDelta,
  RunStore, AttemptStore,
} from './run_identity.js';

// Trace events
export type {
  TraceEventType, TraceEvent, TraceEventInput, TraceEventPayload,
  TraceEmitter, RunSequencer, TraceEventStore,
  GovernanceQueryContext,
} from './trace.js';

// Mission contracts
export type {
  MissionContract, ContractCriterion,
  ContractSatisfactionResult, CriterionResult,
  MissionContractStore, ConstitutionalModeStore,
} from './mission_contract.js';

// Supervisor & suspension
export type {
  SupervisorType, DecisionOutcome,
  SuspensionState, SuspensionTargetType,
  HandoffAcceptanceOutcome, HandoffRejectionReason, ResumeTokenHash,
  SupervisorDecision, SuspensionRecord, Handoff,
  SupervisorDecisionStore, SuspensionStore, HandoffStore,
} from './supervisor.js';

// Eval schema
export type {
  EvalDimension, EvalProvenance, EvalCase, EvalPinnedVersions,
  EvalCaseStore,
} from './eval.js';

// Capability manifest
export type {
  ExecutionTrustTier, SideEffectClass,
  CapabilityManifest, RetryClassification, RetentionCategory,
  CapabilityManifestStore,
} from './capability_manifest.js';

// Idempotency
export type {
  IdempotencyKey, IdempotencyCheckResult,
  ResumeToken, PayloadCanonicalizer,
  IdempotencyStore, ResumeTokenStore,
} from './idempotency.js';

// Time provider
export type {
  TimeProvider,
} from './time.js';

// Instance context (v2.1.0 — per-instance mutable state container)
export type {
  SchemaDetectionCache, RateLimitEntry, InstanceContext,
} from './instance_context.js';
export { createInstanceContext } from './instance_context.js';

// Result utilities
export { propagateError } from './result_utils.js';
