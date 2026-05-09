// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * AutoGen Adapter -- Barrel Exports
 *
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 */

export { LimenAutoGenAdapter } from './adapter.js';
export type { AutoGenAdapterConfig, AutoGenSessionStart, AutoGenSessionEnd, AutoGenHookEvent, AutoGenFunctionCall, AutoGenAuditDetails } from './types.js';
export { translateToolToOperations, mapNativeEvent, mapLimenEvent, KNOWN_TOOLS } from './hooks.js';
