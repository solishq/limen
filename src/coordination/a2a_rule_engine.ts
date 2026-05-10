// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AGENT_COORDINATION_GOVERNANCE.md §4, §12
/**
 * A2A Rule Engine — priority-ordered, first-match-wins rule evaluation.
 *
 * Implements: CO-11.4, CO-12.8, CO-12.11
 *
 * Rules are sorted by priority ascending (lower = higher priority).
 * First rule whose conditions match determines the verdict.
 * If no rule matches, default verdict is deny (closed-world assumption).
 *
 * Capability boundary enforcement computed at query time (CO-12.8).
 * No cached boundaries — always recomputed.
 */

import type { AgentId } from '../kernel/interfaces/index.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type {
  A2AGovernanceRule, A2AAction, A2AVerdict, A2ARuleCondition,
  CapabilityBoundary,
} from './coordination_types.js';
import type { ClassificationLevel, AgentTrustLevel, RateLimitPolicy } from '../adapters/shared/types.js';

// ============================================================================
// Rule Matching (CO-12.11)
// ============================================================================

/**
 * Evaluate an A2A action against a sorted list of rules.
 * CO-12.11: Priority-ordered, first-match-wins.
 * CO-12.8: Evaluated on every call — no caching.
 *
 * @param rules - Rules sorted by priority ascending (caller must ensure sort order)
 * @param action - The action to evaluate
 * @param targetAgent - Target agent ID
 * @returns A2AVerdict — allowed, masked, rate-limited, or denied
 */
export function evaluateA2ARules(
  rules: readonly A2AGovernanceRule[],
  action: A2AAction,
  targetAgent: AgentId,
  time: TimeProvider,
): A2AVerdict {
  const now = time.nowISO();

  for (const rule of rules) {
    if (!rule.enabled) continue;

    // Check source agent match
    if (rule.sourceAgent !== '*' && rule.sourceAgent !== action.sourceAgent) continue;

    // Check target agent match
    if (rule.targetAgent !== '*' && rule.targetAgent !== targetAgent) continue;

    // Check skill match (action.type maps to skill)
    if (rule.skill !== '*' && rule.skill !== action.type) continue;

    // Check conditions
    if (!evaluateConditions(rule.conditions, action)) continue;

    // First match — determine verdict
    switch (rule.action) {
      case 'allow':
        return Object.freeze({
          allowed: true,
          maskedFields: null,
          rateLimited: false,
          reason: `Allowed by rule ${rule.id}`,
          ruleId: rule.id,
          evaluatedAt: now,
        });

      case 'deny':
        return Object.freeze({
          allowed: false,
          maskedFields: null,
          rateLimited: false,
          reason: `Denied by rule ${rule.id}`,
          ruleId: rule.id,
          evaluatedAt: now,
        });

      case 'mask': {
        // Extract masked fields from conditions (field-based masking)
        const maskedFields = rule.conditions
          .filter(c => c.field.startsWith('payload.'))
          .map(c => c.field.substring('payload.'.length));
        return Object.freeze({
          allowed: true,
          maskedFields: maskedFields.length > 0 ? maskedFields : ['*'],
          rateLimited: false,
          reason: `Masked by rule ${rule.id}`,
          ruleId: rule.id,
          evaluatedAt: now,
        });
      }

      case 'rate_limit':
        // CO-4.21: rateLimited=true means action is allowed but throttled
        return Object.freeze({
          allowed: true,
          maskedFields: null,
          rateLimited: true,
          reason: `Rate limited by rule ${rule.id}`,
          ruleId: rule.id,
          evaluatedAt: now,
        });
    }
  }

  // CO-12.11: No rule matched — default deny (closed-world assumption)
  return Object.freeze({
    allowed: false,
    maskedFields: null,
    rateLimited: false,
    reason: 'No matching rule found (closed-world assumption: default deny)',
    ruleId: '__default_deny__',
    evaluatedAt: now,
  });
}

// ============================================================================
// Condition Evaluation
// ============================================================================

/**
 * Evaluate all conditions against an action.
 * All conditions must be satisfied (AND semantics).
 */
function evaluateConditions(
  conditions: readonly A2ARuleCondition[],
  action: A2AAction,
): boolean {
  for (const condition of conditions) {
    if (!evaluateCondition(condition, action)) return false;
  }
  return true;
}

/**
 * Evaluate a single condition against an action.
 * Resolves the field path from the action's payload or top-level properties.
 */
function evaluateCondition(condition: A2ARuleCondition, action: A2AAction): boolean {
  const fieldValue = resolveField(condition.field, action);

  switch (condition.operator) {
    case 'eq':
      return fieldValue === condition.value;

    case 'neq':
      return fieldValue !== condition.value;

    case 'in': {
      if (!Array.isArray(condition.value)) return false;
      return (condition.value as readonly string[]).includes(String(fieldValue));
    }

    case 'not_in': {
      if (!Array.isArray(condition.value)) return true;
      return !(condition.value as readonly string[]).includes(String(fieldValue));
    }

    case 'gt':
      return typeof fieldValue === 'number' && typeof condition.value === 'number' && fieldValue > condition.value;

    case 'lt':
      return typeof fieldValue === 'number' && typeof condition.value === 'number' && fieldValue < condition.value;

    case 'matches': {
      if (typeof fieldValue !== 'string' || typeof condition.value !== 'string') return false;
      try {
        return new RegExp(condition.value).test(fieldValue);
      } catch {
        // Invalid regex — fail-closed, condition not met
        return false;
      }
    }
  }
}

/**
 * Resolve a dot-separated field path against an action.
 * Supports: type, sourceAgent, classification, timestamp, payload.*
 */
function resolveField(field: string, action: A2AAction): unknown {
  if (field === 'type') return action.type;
  if (field === 'sourceAgent') return action.sourceAgent;
  if (field === 'classification') return action.classification;
  if (field === 'timestamp') return action.timestamp;

  if (field.startsWith('payload.')) {
    const path = field.substring('payload.'.length);
    return resolvePath(action.payload, path);
  }

  return undefined;
}

/**
 * Resolve a dot-separated path in an object.
 */
function resolvePath(obj: Readonly<Record<string, unknown>>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ============================================================================
// Capability Boundary Computation (CO-11.5, CO-12.8)
// ============================================================================

/** Trust level to numeric clearance mapping (SHARED_TYPES S5) */
const TRUST_CLEARANCE_MAP: Record<AgentTrustLevel, number> = {
  untrusted: 0,
  low: 1,
  medium: 2,
  high: 3,
  verified: 4,
};

/** Classification to numeric level mapping */
const CLASSIFICATION_LEVEL_MAP: Record<ClassificationLevel, number> = {
  unrestricted: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
  critical: 4,
};

/**
 * Compute a capability boundary for an agent+skill pair.
 * CO-11.5: Derived from agent trust + skill registration + rules.
 * CO-12.8: Computed at query time — never cached.
 */
export function computeCapabilityBoundary(
  agentId: AgentId,
  skill: string,
  trustLevel: AgentTrustLevel,
  rules: readonly A2AGovernanceRule[],
): CapabilityBoundary {
  // Derive clearance required from rules targeting this agent+skill
  const matchingRules = rules.filter(r =>
    r.enabled &&
    (r.targetAgent === '*' || r.targetAgent === agentId) &&
    (r.skill === '*' || r.skill === skill),
  );

  // Collect masked fields from mask rules
  const maskedFields: string[] = [];
  const allowedFields: string[] = [];
  let rateLimit: RateLimitPolicy | null = null;
  let clearanceRequired: ClassificationLevel = 'unrestricted';

  for (const rule of matchingRules) {
    if (rule.action === 'mask') {
      for (const cond of rule.conditions) {
        if (cond.field.startsWith('payload.')) {
          maskedFields.push(cond.field.substring('payload.'.length));
        }
      }
    }
    if (rule.action === 'allow') {
      for (const cond of rule.conditions) {
        if (cond.field.startsWith('payload.') && cond.operator === 'eq') {
          allowedFields.push(cond.field.substring('payload.'.length));
        }
      }
    }
  }

  // Determine minimum trust required based on agent's clearance level
  // TRUST_CLEARANCE_MAP maps trust to numeric clearance for comparison
  const agentClearance = TRUST_CLEARANCE_MAP[trustLevel];
  const trustRequired = agentClearance >= 2 ? trustLevel : 'medium' as AgentTrustLevel;

  // Determine clearance required — use the highest classification among matching deny/mask rules
  for (const rule of matchingRules) {
    if (rule.action === 'deny' || rule.action === 'mask') {
      for (const cond of rule.conditions) {
        if (cond.field === 'classification' && typeof cond.value === 'string') {
          const level = cond.value as ClassificationLevel;
          if (CLASSIFICATION_LEVEL_MAP[level] !== undefined &&
              CLASSIFICATION_LEVEL_MAP[level] > CLASSIFICATION_LEVEL_MAP[clearanceRequired]) {
            clearanceRequired = level;
          }
        }
      }
    }
  }

  return Object.freeze({
    agentId,
    skill,
    clearanceRequired,
    allowedFields: Object.freeze([...allowedFields]),
    maskedFields: Object.freeze([...maskedFields]),
    rateLimit,
    trustRequired,
    expiresAt: null,
  });
}
