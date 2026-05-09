// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Shared Adapter Infrastructure -- Barrel Exports
 *
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 */

export { BaseGovernedAdapter } from './base-adapter.js';
export type { Clock } from './base-adapter.js';
export { AdapterLifecycle } from './lifecycle.js';
export { AdapterError, AdapterError as CrewAIAdapterError } from './errors.js';
export {
  notInitialized,
  alreadyInitialized,
  governanceRefusal,
  budgetExceeded,
  unknownTool,
  corePortUnavailable,
  auditFailure,
  serdeError,
  trustLevelInsufficient,
  capabilityNotDeclared,
  sessionNotFound,
  clientError,
  translationFailed,
  shutdownFailed,
  maxSessionsExceeded,
  internalError,
  branchConflict,
  timeProviderUnavailable,
  selectHighestPrecedence,
  toResultError,
} from './errors.js';
export type { AdapterKernelError } from './errors.js';
export type { BaseAdapterConfig, AdapterAuditDetails, FrameworkSessionStart, FrameworkSessionEnd } from './types.js';
