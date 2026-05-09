/**
 * Enterprise Compliance Pack - Public API
 *
 * Contract: PHASE_3_DESIGN_SOURCE.md
 * Purpose: Re-exports all compliance components for external consumption.
 */

// Orchestrator
export { EnterpriseCompliancePack } from './pack.js';
export type { CompliancePackConfig, ComplianceCheckResult, ComplianceCheckItem } from './pack.js';

// Classification
export { ClassificationEngine, DEFAULT_RETENTION } from './classification/engine.js';
export type { EnterpriseRetentionPolicy } from './classification/engine.js';
export {
  CLASSIFICATION_NUMERIC,
  CLASSIFICATION_LEVELS,
} from './classification/types.js';
export type {
  ClassificationEnforcementResult,
  ClassificationContext,
} from './classification/types.js';

// Token Budget
export { TokenBudgetManager } from './token-budget/manager.js';
export {
  DEFAULT_TOKEN_BUDGET,
  DEFAULT_TOKEN_BUDGET_PER_OPERATION,
  MAX_TOKEN_BUDGET_CAP,
} from './token-budget/types.js';
export type {
  TokenReservation,
  SessionBudgetState,
  BudgetCheckResult,
  BudgetEvent,
  BudgetEventType,
  TokenBudgetManagerConfig,
} from './token-budget/types.js';

// Audit
export { EnterpriseAuditLogger, canonicalJsonStringify } from './audit/enterprise-logger.js';
export type { EnterpriseAuditEntry, ChainVerificationResult, TimeProvider } from './audit/enterprise-logger.js';
export { RetentionPolicyEnforcer } from './audit/retention.js';
export type { RetentionAction, RetentionResult, GdprErasureResult, TombstonedEntry } from './audit/retention.js';
export { AuditExporter } from './audit/export.js';
export type {
  ComplianceFramework,
  DateRange,
  ComplianceExport,
  SOC2Export,
  ISO27001Export,
  FedRAMPExport,
  ClassificationDistribution,
  GovernanceDecisionSummary,
} from './audit/export.js';

// Rollback
export { RollbackManager } from './rollback/manager.js';
export type { StepExecutor } from './rollback/manager.js';
export type {
  RollbackPlan,
  RollbackStep,
  RollbackStepStatus,
  RollbackResult,
  RollbackVerification,
  RollbackCheck,
  RollbackEventType,
} from './rollback/types.js';
