// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
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

  // R2-38: Validate LimenLike interface at construction time.
  // Fail fast if the provided object doesn't satisfy the structural contract.
  if (typeof limen.remember !== 'function' || typeof limen.recall !== 'function') {
    throw new Error('Invalid LimenLike: missing required methods (remember, recall)');
  }
  if (typeof limen.forget !== 'function' || typeof limen.search !== 'function') {
    throw new Error('Invalid LimenLike: missing required methods (forget, search)');
  }

  const prefix = config.subjectPrefix ?? DEFAULTS.subjectPrefix;
  const maxMemories = config.maxMemories ?? DEFAULTS.maxMemories;
  const minConfidence = config.minConfidence ?? DEFAULTS.minConfidence;
  const memoryKey = config.memoryKey ?? DEFAULTS.memoryKey;
  const humanPrefix = config.humanPrefix ?? DEFAULTS.humanPrefix;
  const aiPrefix = config.aiPrefix ?? DEFAULTS.aiPrefix;

  // R2-39: Prefix turn counter with instance ID to prevent cross-instance collisions.
  // Without this, two LimenMemory instances sharing the same Limen backend would
  // overwrite each other's turn subjects (e.g., both writing to `langchain:memory:conversation:1`).
  const instanceId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
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

      // R2-39: Include instanceId in subject to prevent cross-instance collisions
      if (humanMessage) {
        turnCounter++;
        limen.remember(
          `${prefix}:${instanceId}:conversation:${turnCounter}`,
          'langchain.message',
          `${humanPrefix}: ${humanMessage}`,
        );
      }

      if (aiMessage) {
        turnCounter++;
        limen.remember(
          `${prefix}:${instanceId}:conversation:${turnCounter}`,
          'langchain.message',
          `${aiPrefix}: ${aiMessage}`,
        );
      }
    },

    async clear(): Promise<void> {
      // R2-37: Batch clear instead of N sequential forget calls.
      // Use paginated recall with a bounded batch size to prevent unbounded
      // sequential forget() calls. Each batch retrieves up to CLEAR_BATCH_SIZE
      // entries, forgets them, then fetches the next batch until none remain.
      const CLEAR_BATCH_SIZE = 500;
      let cleared = 0;

      // eslint-disable-next-line no-constant-condition -- intentional drain loop
      while (true) {
        const result = limen.recall(undefined, 'langchain.message', {
          limit: CLEAR_BATCH_SIZE,
        });

        if (!result.ok || !result.value || result.value.length === 0) break;

        for (const belief of result.value) {
          limen.forget(belief.claimId);
          cleared++;
        }

        // If we got fewer than batch size, we've drained all entries
        if (result.value.length < CLEAR_BATCH_SIZE) break;
      }

      turnCounter = 0;
    },
  };
}
