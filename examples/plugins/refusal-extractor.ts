// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Reference Plugin: Refusal Extractor
 *
 * Demonstrates RecallHook — enriches recall results by detecting
 * refusal patterns and extracting structured metadata.
 *
 * Usage:
 *   import { refusalExtractor } from './refusal-extractor.js';
 *   const limen = await createLimen({
 *     hooks: [refusalExtractor()],
 *   });
 */

// NOTE: In your own project, import from the package:
//   import type { LimenHook, RecallBeliefView } from 'limen-ai';
// Source-relative import used here for development only.
import type { LimenHook, RecallBeliefView } from '../../src/plugins/hook_types.js';

/** Refusal categories detected by this extractor */
export type RefusalCategory =
  | 'safety'
  | 'capability'
  | 'policy'
  | 'knowledge_boundary'
  | 'ambiguity';

/** Structured refusal metadata added to beliefs */
export interface RefusalMetadata {
  readonly isRefusal: boolean;
  readonly category: RefusalCategory | null;
  readonly confidence: number;
}

const REFUSAL_PATTERNS: ReadonlyArray<{ pattern: RegExp; category: RefusalCategory; weight: number }> = [
  { pattern: /\bcannot\b.*\b(help|assist|provide)\b/i, category: 'policy', weight: 0.9 },
  { pattern: /\b(unsafe|harmful|dangerous)\b/i, category: 'safety', weight: 0.95 },
  { pattern: /\b(don't have|lack|unable to)\b.*\b(capability|ability)\b/i, category: 'capability', weight: 0.85 },
  { pattern: /\b(don't know|not sure|uncertain)\b/i, category: 'knowledge_boundary', weight: 0.7 },
  { pattern: /\b(unclear|ambiguous|need more)\b.*\b(context|information)\b/i, category: 'ambiguity', weight: 0.65 },
  { pattern: /\bI('m| am) not able to\b/i, category: 'policy', weight: 0.8 },
  { pattern: /\brefuse\b/i, category: 'policy', weight: 0.95 },
];

function detectRefusal(value: string): RefusalMetadata {
  let bestMatch: { category: RefusalCategory; weight: number } | null = null;

  for (const { pattern, category, weight } of REFUSAL_PATTERNS) {
    if (pattern.test(value)) {
      if (!bestMatch || weight > bestMatch.weight) {
        bestMatch = { category, weight };
      }
    }
  }

  return {
    isRefusal: bestMatch !== null,
    category: bestMatch?.category ?? null,
    confidence: bestMatch?.weight ?? 0,
  };
}

export interface RefusalExtractorOptions {
  /** Only process beliefs matching these predicates. Default: all. */
  readonly predicateFilter?: readonly string[];
}

export function refusalExtractor(options: RefusalExtractorOptions = {}): LimenHook {
  const predicateFilter = options.predicateFilter
    ? new Set(options.predicateFilter)
    : null;

  return {
    meta: { name: 'refusal-extractor', version: '1.0.0' },
    priority: 50,
    recall: {
      onRecall(beliefs, _query) {
        return beliefs.map((belief): RecallBeliefView => {
          if (predicateFilter && !predicateFilter.has(belief.predicate)) {
            return belief;
          }
          const refusal = detectRefusal(belief.value);
          return { ...belief, refusal };
        });
      },
    },
  };
}
