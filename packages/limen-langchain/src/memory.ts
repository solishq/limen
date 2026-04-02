/**
 * LimenMemory — LangChain memory adapter backed by Limen.
 *
 * Design Source: PHASE-8-DESIGN-SOURCE.md (Output 1.4, 2.3, 4)
 * Truth Model: PHASE-8-TRUTH-MODEL.md (I-P8-31)
 *
 * This adapter stores and retrieves conversation history using Limen's
 * governed knowledge engine. Each message becomes a claim with:
 * - subject: `<prefix>:conversation:<turn>`
 * - predicate: `langchain.message`
 * - value: `<role>: <content>`
 *
 * When @langchain/core is installed as a peer dependency, consumers can
 * use this adapter with LangChain chains and agents.
 *
 * I-P8-31: This lives in packages/limen-langchain/ with peer dependencies only.
 * DC-P8-801: limen-ai has zero new production dependencies from this.
 */

import type { LimenMemoryConfig, LimenMemoryInterface } from './types.js';

/** Default configuration values */
const DEFAULTS = {
  subjectPrefix: 'langchain:memory',
  maxMemories: 20,
  minConfidence: 0.3,
  memoryKey: 'history',
  humanPrefix: 'Human',
  aiPrefix: 'AI',
} as const;

/**
 * Type guard for the Limen-like interface.
 * We use structural typing to avoid importing Limen directly.
 */
interface LimenLike {
  remember(subject: string, predicate: string, value: string, options?: unknown): { ok: boolean; value?: { claimId: string } };
  recall(subject?: string, predicate?: string, options?: unknown): { ok: boolean; value?: readonly { value: string; claimId: string }[] };
  forget(claimId: string, reason?: string): { ok: boolean };
  search(query: string, options?: unknown): { ok: boolean; value?: readonly { belief: { value: string } }[] };
}

/**
 * Create a LimenMemory adapter.
 *
 * Usage:
 * ```ts
 * import { createLimenMemory } from '@solishq/limen-langchain';
 * import { createLimen } from 'limen-ai';
 *
 * const limen = await createLimen();
 * const memory = createLimenMemory({ limen });
 *
 * // Use with LangChain
 * const chain = new ConversationChain({ memory, ... });
 * ```
 */
export function createLimenMemory(config: LimenMemoryConfig): LimenMemoryInterface {
  const limen = config.limen as LimenLike;
  const prefix = config.subjectPrefix ?? DEFAULTS.subjectPrefix;
  const maxMemories = config.maxMemories ?? DEFAULTS.maxMemories;
  const minConfidence = config.minConfidence ?? DEFAULTS.minConfidence;
  const memoryKey = config.memoryKey ?? DEFAULTS.memoryKey;
  const humanPrefix = config.humanPrefix ?? DEFAULTS.humanPrefix;
  const aiPrefix = config.aiPrefix ?? DEFAULTS.aiPrefix;

  let turnCounter = 0;

  return {
    get memoryVariables() {
      return [memoryKey] as readonly string[];
    },

    async loadMemoryVariables(_values: Record<string, unknown>): Promise<Record<string, string>> {
      // Recall recent memories with the configured prefix
      const result = limen.recall(undefined, 'langchain.message', {
        minConfidence,
        limit: maxMemories,
      });

      if (!result.ok || !result.value) {
        return { [memoryKey]: '' };
      }

      // Format as conversation history
      const messages = result.value
        .map(belief => belief.value)
        .join('\n');

      return { [memoryKey]: messages };
    },

    async saveContext(
      inputValues: Record<string, unknown>,
      outputValues: Record<string, unknown>,
    ): Promise<void> {
      const humanMessage = String(inputValues.input ?? inputValues.question ?? '');
      const aiMessage = String(outputValues.output ?? outputValues.response ?? outputValues.text ?? '');

      if (humanMessage) {
        turnCounter++;
        limen.remember(
          `${prefix}:conversation:${turnCounter}`,
          'langchain.message',
          `${humanPrefix}: ${humanMessage}`,
        );
      }

      if (aiMessage) {
        turnCounter++;
        limen.remember(
          `${prefix}:conversation:${turnCounter}`,
          'langchain.message',
          `${aiPrefix}: ${aiMessage}`,
        );
      }
    },

    async clear(): Promise<void> {
      // Recall all memories with our prefix and retract them
      const result = limen.recall(undefined, 'langchain.message', {
        limit: 100000,
      });

      if (!result.ok || !result.value) return;

      for (const belief of result.value) {
        limen.forget(belief.claimId);
      }

      turnCounter = 0;
    },
  };
}
