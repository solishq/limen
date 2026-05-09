// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * @solishq/limen-langchain — LangChain memory adapter for Limen.
 *
 * Separate package with peer dependencies on limen-ai and @langchain/core.
 * I-P8-31: Zero production dependencies.
 */

export { createLimenMemory } from './memory.js';
export type { LimenMemoryConfig, LimenMemoryInterface } from './types.js';
