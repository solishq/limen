/**
 * Phase 10: Protected Predicate Guard
 *
 * Spec ref: PHASE-10-DESIGN-SOURCE.md (Output 1, Protected Predicate Guard)
 * Invariants: I-P10-10 (enforcement), I-P10-11 (dormant bypass), I-P10-12 (action matching)
 * DCs: DC-P10-401, DC-P10-402, DC-P10-403, DC-P10-404
 *
 * Check function: takes predicate, operation, OperationContext, RBAC active flag -> Result<void>.
 * - If RBAC dormant -> always allow (I-P10-11)
 * - If RBAC active -> find matching rules, check permissions
 * - Return PROTECTED_PREDICATE_UNAUTHORIZED if blocked
 */

import type { OperationContext, Result } from '../../kernel/interfaces/common.js';
import type { ProtectedPredicateRule } from './governance_types.js';

/**
 * Check if a predicate matches a glob-like pattern.
 * Same matching logic as classification engine.
 */
function predicateMatchesPattern(predicate: string, pattern: string): boolean {
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1);
    return predicate.startsWith(prefix);
  }
  return predicate === pattern;
}

/**
 * Check whether an operation on a predicate is authorized.
 *
 * @param predicate - The claim predicate being asserted/retracted
 * @param operation - 'assert' or 'retract'
 * @param ctx - Operation context with permissions
 * @param rbacActive - Whether RBAC is currently active (not dormant)
 * @param rules - Protected predicate rules to check against
 * @returns Result<void> - ok if allowed, error PROTECTED_PREDICATE_UNAUTHORIZED if blocked
 *
 * I-P10-11: When RBAC is dormant, all predicates are writable by anyone.
 * I-P10-12: Rules with action 'both' apply to both assert and retract.
 */
export function checkPredicateGuard(
  predicate: string,
  operation: 'assert' | 'retract',
  ctx: OperationContext,
  rbacActive: boolean,
  rules: readonly ProtectedPredicateRule[],
): Result<void> {
  // I-P10-11: Dormant RBAC bypasses all predicate protection
  if (!rbacActive) {
    return { ok: true, value: undefined };
  }

  for (const rule of rules) {
    // I-P10-12: Check if the rule applies to this operation
    const appliesToOperation = rule.action === 'both' || rule.action === operation;
    if (!appliesToOperation) continue;

    // Check if the predicate matches the rule's pattern
    if (!predicateMatchesPattern(predicate, rule.predicatePattern)) continue;

    // Rule matches — check permission
    if (!ctx.permissions.has(rule.requiredPermission)) {
      return {
        ok: false,
        error: {
          code: 'PROTECTED_PREDICATE_UNAUTHORIZED',
          message: `Predicate '${predicate}' requires permission '${rule.requiredPermission}' for ${operation}`,
          spec: 'I-P10-10',
        },
      };
    }
  }

  return { ok: true, value: undefined };
}
