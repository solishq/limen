/**
 * FR-002: A2A Governance API — Convenience namespace for inter-agent governance.
 *
 * Provides `a2aGovernance.setGovernanceBlock()`, `a2aGovernance.getGovernanceBlock()`,
 * `a2aGovernance.registerProactiveRule()`, and `a2aGovernance.listProactiveRules()`
 * methods that sit on the Limen API object.
 *
 * Architecture: This is the "store" layer in the three-file pattern.
 * Governance types are defined in coordination/a2a_governance.ts (contract).
 * This file implements the convenience API (implementation).
 *
 * Governance boundary (I-17): Only imports ClaimApi, never ClaimSystem/ClaimStore.
 *
 * Spec ref: v4.0.0 Phase 7 FR-002
 * QAL: 3 (Governance integrity. Failure = unauthorized inter-agent actions.)
 */

import type { Result } from '../../kernel/interfaces/index.js';
import type { MissionId, TaskId } from '../../kernel/interfaces/index.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type { ClaimApi } from '../interfaces/api.js';
import type { TenantScopedConnection } from '../../kernel/tenant/tenant_scope.js';
import type { BeliefView } from '../convenience/convenience_types.js';

import {
  validateGovernanceBlock,
  validateProactiveRule,
} from '../../coordination/a2a_governance.js';
import type { GovernanceBlock } from '../../coordination/a2a_governance.js';

// ── Result Helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message, spec: 'FR-002' } };
}

// ============================================================================
// Constants
// ============================================================================

/** Well-known subject URN for the singleton governance block claim. */
const GOVERNANCE_BLOCK_SUBJECT = 'entity:governance:a2a-block';

/** Predicate for governance block claims. */
const GOVERNANCE_BLOCK_PREDICATE = 'a2a.governance_block';

/** Predicate for proactive rule claims. */
const PROACTIVE_RULE_PREDICATE = 'a2a.proactive_rule';

// ============================================================================
// Types
// ============================================================================

/**
 * The a2aGovernance namespace on the Limen API object.
 */
export interface A2AGovernanceApi {
  /**
   * Set the A2A governance block (singleton).
   * Validates against the GovernanceBlock schema and stores as a claim.
   * Setting a new block supersedes the previous one.
   *
   * @param block - The governance block object
   */
  setGovernanceBlock(block: object): Result<void>;

  /**
   * Get the current A2A governance block.
   * Returns null if no governance block has been set.
   */
  getGovernanceBlock(): Result<GovernanceBlock | null>;

  /**
   * Register a proactive rule for inter-agent automation.
   * Validates against the ProactiveRule schema and stores as a claim.
   *
   * @param rule - The proactive rule object
   */
  registerProactiveRule(rule: object): Result<{ claimId: string }>;

  /**
   * List proactive rules, optionally filtered by status.
   *
   * @param status - Filter by status ('active' | 'suspended' | 'retired'). Omit for all.
   */
  listProactiveRules(status?: string): Result<readonly BeliefView[]>;
}

// ============================================================================
// Dependencies
// ============================================================================

export interface A2AGovernanceApiDeps {
  readonly claims: ClaimApi;
  readonly getConnection: () => TenantScopedConnection;
  readonly time: TimeProvider;
  readonly missionId: MissionId;
  readonly taskId: TaskId | null;
  readonly maxAutoConfidence: number;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create the A2A governance API namespace.
 *
 * Returns an object with setGovernanceBlock, getGovernanceBlock,
 * registerProactiveRule, and listProactiveRules methods.
 * NOT frozen here — the permission gateway wraps methods before deepFreeze.
 */
export function createA2AGovernanceApi(deps: A2AGovernanceApiDeps): A2AGovernanceApi {
  const { claims, time, missionId, taskId, maxAutoConfidence } = deps;

  function setGovernanceBlock(block: object): Result<void> {
    // 1. Validate against schema
    const validation = validateGovernanceBlock(block);
    if (!validation.ok) {
      return validation;
    }

    // 2. Serialize to JSON string for claim storage
    const jsonValue = JSON.stringify(block);

    // 3. Assert via ClaimApi — uses well-known subject for singleton pattern
    const result = claims.assertClaim({
      subject: GOVERNANCE_BLOCK_SUBJECT,
      predicate: GOVERNANCE_BLOCK_PREDICATE,
      object: { type: 'json', value: jsonValue },
      confidence: maxAutoConfidence,
      validAt: time.nowISO(),
      missionId,
      taskId,
      groundingMode: 'runtime_witness',
      evidenceRefs: [],
      runtimeWitness: {
        witnessType: 'governance_block_set',
        witnessedValues: { action: 'set' },
        witnessTimestamp: time.nowISO(),
      },
    });

    if (!result.ok) {
      return result as Result<void>;
    }

    return ok(undefined);
  }

  function getGovernanceBlock(): Result<GovernanceBlock | null> {
    // Query for the governance block claim by well-known subject+predicate
    const result = claims.queryClaims({
      subject: GOVERNANCE_BLOCK_SUBJECT,
      predicate: GOVERNANCE_BLOCK_PREDICATE,
      limit: 1,
      status: 'active',
    });

    if (!result.ok) {
      return result as Result<GovernanceBlock | null>;
    }

    if (result.value.claims.length === 0) {
      return ok(null);
    }

    // Parse the stored JSON back to a GovernanceBlock
    const claim = result.value.claims[0]!;
    const rawValue = typeof claim.claim.object.value === 'string'
      ? claim.claim.object.value
      : JSON.stringify(claim.claim.object.value);

    try {
      const parsed = JSON.parse(rawValue) as GovernanceBlock;
      return ok(parsed);
    } catch {
      return err('INVALID_GOVERNANCE_BLOCK', 'Stored governance block is not valid JSON');
    }
  }

  function registerProactiveRule(rule: object): Result<{ claimId: string }> {
    // 1. Validate against schema
    const validation = validateProactiveRule(rule);
    if (!validation.ok) {
      return validation as Result<{ claimId: string }>;
    }

    // 2. Serialize to JSON string for claim storage
    const jsonValue = JSON.stringify(rule);

    // 3. Build subject URN using the rule's id
    const ruleObj = rule as { id: string };
    const subject = `entity:proactive-rule:${ruleObj.id}`;

    // 4. Assert via ClaimApi
    const result = claims.assertClaim({
      subject,
      predicate: PROACTIVE_RULE_PREDICATE,
      object: { type: 'json', value: jsonValue },
      confidence: maxAutoConfidence,
      validAt: time.nowISO(),
      missionId,
      taskId,
      groundingMode: 'runtime_witness',
      evidenceRefs: [],
      runtimeWitness: {
        witnessType: 'proactive_rule_register',
        witnessedValues: { ruleId: ruleObj.id },
        witnessTimestamp: time.nowISO(),
      },
    });

    if (!result.ok) {
      return result as Result<{ claimId: string }>;
    }

    return ok({ claimId: result.value.claim.id });
  }

  function listProactiveRules(status?: string): Result<readonly BeliefView[]> {
    // Validate status if provided
    const validStatuses = ['active', 'suspended', 'retired'];
    if (status !== undefined && !validStatuses.includes(status)) {
      return err('INVALID_PROACTIVE_RULE',
        `Invalid status: "${status}". Valid values: ${validStatuses.join(', ')}`);
    }

    // Query claims via ClaimApi
    const result = claims.queryClaims({
      predicate: PROACTIVE_RULE_PREDICATE,
      subject: null,
      limit: 100,
      status: 'active',
    });

    if (!result.ok) {
      return result as Result<readonly BeliefView[]>;
    }

    // Transform to BeliefView
    let beliefs: BeliefView[] = result.value.claims.map(item => ({
      claimId: item.claim.id,
      subject: item.claim.subject,
      predicate: item.claim.predicate,
      value: typeof item.claim.object.value === 'string'
        ? item.claim.object.value
        : JSON.stringify(item.claim.object.value),
      confidence: item.claim.confidence,
      validAt: item.claim.validAt,
      createdAt: item.claim.createdAt,
      effectiveConfidence: item.effectiveConfidence,
      freshness: item.freshness,
      stability: item.claim.stability,
      lastAccessedAt: item.claim.lastAccessedAt,
      accessCount: item.claim.accessCount,
      reasoning: item.claim.reasoning,
      superseded: item.superseded,
      disputed: item.disputed,
      reviewNeeded: item.reviewNeeded,
    }));

    // Filter by rule status if provided
    if (status !== undefined) {
      beliefs = beliefs.filter(b => {
        try {
          const parsed = JSON.parse(b.value) as { status?: string };
          return parsed.status === status;
        } catch {
          return false;
        }
      });
    }

    return ok(beliefs as readonly BeliefView[]);
  }

  // NOT frozen here — permission gateway wraps methods before deepFreeze.
  return {
    setGovernanceBlock,
    getGovernanceBlock,
    registerProactiveRule,
    listProactiveRules,
  };
}
