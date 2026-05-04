/**
 * DEPRECATED — This file is no longer used for ambient module declaration.
 *
 * F-LG-001 remediation: The tsconfig paths mapping that pointed here has been
 * removed. The adapter now resolves @langchain/langgraph-checkpoint directly
 * from node_modules, using the package's own dist/index.d.ts for types and
 * dist/index.js for runtime ESM exports.
 *
 * The previous ambient module declaration declared exports that did not match
 * the real package (BaseCheckpointSaver constructor signature, BaseStore
 * method signatures), causing ESM resolution crashes at runtime when tsx
 * resolved the import to this file instead of the real package.
 *
 * This file is retained for audit trail only. It has no effect on compilation
 * or runtime resolution.
 */
export {};
