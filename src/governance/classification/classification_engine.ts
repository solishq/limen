/**
 * Phase 10: Classification Engine — Pure Function
 *
 * Spec ref: PHASE-10-DESIGN-SOURCE.md (Output 1, Classification Engine)
 * Invariants: I-P10-01 (classification stored), I-P10-02 (default classification),
 *             I-P10-04 (rule precedence — most restrictive wins)
 * DCs: DC-P10-101, DC-P10-801-804
 *
 * Pure function: takes predicate + rules -> ClassificationResult.
 * - Match using prefix matching: 'preference.*' matches 'preference.color'
 * - If multiple rules match, most restrictive wins (I-P10-04)
 * - Returns { level, matchedRule, autoClassified }
 *
 * No I/O. No side effects. Deterministic.
 */

import type { ClassificationRule, ClassificationResult, ClassificationLevel } from './governance_types.js';
import { CLASSIFICATION_LEVEL_ORDER } from './governance_types.js';

/**
 * Check if a predicate matches a glob-like pattern.
 * Pattern format: 'domain.*' matches 'domain.anything'.
 * Exact match: 'domain.property' matches only 'domain.property'.
 */
function predicateMatchesPattern(predicate: string, pattern: string): boolean {
  if (pattern.endsWith('.*')) {
    // Prefix match: 'preference.*' matches 'preference.color', 'preference.food'
    const prefix = pattern.slice(0, -1); // 'preference.'
    return predicate.startsWith(prefix);
  }
  // Exact match
  return predicate === pattern;
}

/**
 * Classify a predicate against a set of rules.
 *
 * @param predicate - The claim predicate (e.g., 'preference.color')
 * @param rules - Classification rules to match against
 * @param defaultLevel - Default level when no rule matches (default: 'unrestricted')
 * @returns ClassificationResult with level, matched rule ID, and autoClassified flag
 *
 * I-P10-04: If multiple rules match, the MOST RESTRICTIVE level wins.
 */
export function classify(
  predicate: string,
  rules: readonly (ClassificationRule | Omit<ClassificationRule, 'id' | 'createdAt'> & { id?: string; createdAt?: string })[],
  defaultLevel: ClassificationLevel = 'unrestricted',
): ClassificationResult {
  let bestLevel: ClassificationLevel = defaultLevel;
  let bestRuleId: string | null = null;
  let matched = false;

  for (const rule of rules) {
    if (predicateMatchesPattern(predicate, rule.predicatePattern)) {
      const ruleOrder = CLASSIFICATION_LEVEL_ORDER[rule.level];
      const bestOrder = CLASSIFICATION_LEVEL_ORDER[bestLevel];

      if (!matched || ruleOrder > bestOrder) {
        bestLevel = rule.level;
        bestRuleId = ('id' in rule && rule.id) ? rule.id : null;
        matched = true;
      }
    }
  }

  return {
    level: bestLevel,
    matchedRule: bestRuleId,
    autoClassified: matched,
  };
}
