/**
 * LangChain adapter types for Limen.
 *
 * Separate package — NOT part of limen-ai.
 * Design Source: PHASE-8-DESIGN-SOURCE.md (Output 2.3)
 *
 * NOTE: This adapter defines the interface structure. When @langchain/core
 * is available as a peer dependency, the implementation extends BaseMemory.
 * Without it, this serves as the documented interface contract.
 */

/**
 * Configuration for LimenMemory.
 */
export interface LimenMemoryConfig {
  /**
   * The Limen instance to use as memory backend.
   * Typed as unknown to avoid importing Limen type at module level.
   * Consumer passes their limen instance.
   */
  readonly limen: unknown;

  /**
   * Subject prefix for all memories stored by this adapter.
   * Default: 'langchain:memory'.
   */
  readonly subjectPrefix?: string;

  /**
   * Maximum memories to retrieve per load.
   * Default: 20.
   */
  readonly maxMemories?: number;

  /**
   * Minimum confidence for retrieved memories.
   * Default: 0.3.
   */
  readonly minConfidence?: number;

  /**
   * Memory key for the output of this memory class.
   * Default: 'history'.
   */
  readonly memoryKey?: string;

  /**
   * Human prefix in conversation.
   * Default: 'Human'.
   */
  readonly humanPrefix?: string;

  /**
   * AI prefix in conversation.
   * Default: 'AI'.
   */
  readonly aiPrefix?: string;
}

/**
 * The LimenMemory interface — compatible with LangChain BaseMemory.
 *
 * When @langchain/core is available, the implementation extends BaseMemory.
 * This interface documents the contract regardless.
 *
 * LangChain BaseMemory contract:
 * - memoryVariables: string[] — which keys this memory class provides
 * - loadMemoryVariables(values: InputValues): Promise<MemoryVariables>
 * - saveContext(inputValues: InputValues, outputValues: OutputValues): Promise<void>
 * - clear(): Promise<void>
 */
export interface LimenMemoryInterface {
  /** Memory keys this adapter provides */
  readonly memoryVariables: readonly string[];

  /**
   * Load memory variables — retrieves recent beliefs from Limen.
   * Uses limen.recall() and optionally limen.search() for context.
   */
  loadMemoryVariables(values: Record<string, unknown>): Promise<Record<string, string>>;

  /**
   * Save context — stores human and AI messages as beliefs in Limen.
   * Uses limen.remember() with appropriate subject/predicate.
   */
  saveContext(
    inputValues: Record<string, unknown>,
    outputValues: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Clear all memories managed by this adapter.
   * Retracts all claims with the configured subject prefix.
   */
  clear(): Promise<void>;
}
