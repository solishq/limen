/**
 * CrewAI Adapter Errors -- Re-exports from shared
 *
 * @deprecated Import from '../shared/errors.js' instead.
 * All error types and factory functions are now in the shared module.
 */
export {
  AdapterError,
  AdapterError as CrewAIAdapterError,
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
} from '../shared/errors.js';

export type { AdapterKernelError } from '../shared/errors.js';
