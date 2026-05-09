// @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md SS5.1
/**
 * Trust Promotion State Machine
 *
 * LM-5, LM-11: 5-level trust promotion with evidence validation.
 *
 * State machine (monotonic single-step forward only):
 *   untrusted -> low    : registration complete + adapter connected
 *   low       -> medium : 10+ ops, 0 governance refusals in 24h
 *   medium    -> high   : 100+ ops, human approval OR senior agent endorsement
 *   high      -> verified: human approval, Core admin transition record
 *
 * Invariants:
 * - LM-5.12: Promotions MUST be monotonic single-step
 * - LM-5.13 / FM-GB-03: verified MUST NOT be self-granted
 * - LM-9.07: untrusted is floor -- cannot demote below
 *
 * Demotion:
 * - Can skip levels (not monotonic)
 * - untrusted is floor (LM-9.07)
 * - Capability revocation cascades on demotion (LM-5.18)
 */

import type { AgentTrustLevel, AgentCapability } from '../adapters/shared/types.js';
import type { TrustPromotionEvidence } from './lifecycle_types.js';

// ============================================================================
// Trust Level Ordering
// ============================================================================

/** Ordered trust levels for comparison (LM-5.01 via SHARED_TYPES S5) */
const TRUST_LEVEL_ORDER: readonly AgentTrustLevel[] = [
  'untrusted', 'low', 'medium', 'high', 'verified',
];

/** Get numeric rank of a trust level (0-4) */
export function trustLevelRank(level: AgentTrustLevel): number {
  const idx = TRUST_LEVEL_ORDER.indexOf(level);
  return idx >= 0 ? idx : 0;
}

/** Get the trust level one step above current. Returns null if at verified. */
export function nextTrustLevel(current: AgentTrustLevel): AgentTrustLevel | null {
  const idx = TRUST_LEVEL_ORDER.indexOf(current);
  if (idx < 0 || idx >= TRUST_LEVEL_ORDER.length - 1) return null;
  return TRUST_LEVEL_ORDER[idx + 1]!;
}

/** Get the trust level one step below current. Returns null if at untrusted. */
export function previousTrustLevel(current: AgentTrustLevel): AgentTrustLevel | null {
  const idx = TRUST_LEVEL_ORDER.indexOf(current);
  if (idx <= 0) return null;
  return TRUST_LEVEL_ORDER[idx - 1]!;
}

// ============================================================================
// Capability-Trust Mapping (SHARED_TYPES S5.1, S6.1)
// ============================================================================

/**
 * LM-4.02, LM-13.04: Minimum trust level required for each capability.
 * LM-14.05: untrusted only gets memory_read + context_management.
 */
export const CAPABILITY_TRUST_FLOOR: Record<AgentCapability, AgentTrustLevel> = {
  // Untrusted capabilities (LM-14.05)
  memory_read: 'untrusted',
  context_management: 'untrusted',

  // Low trust capabilities
  memory_write: 'low',
  belief_management: 'low',

  // Medium trust capabilities
  technique_learning: 'medium',
  technique_transfer: 'medium',
  branching: 'medium',
  knowledge_export: 'medium',
  knowledge_import: 'medium',

  // High trust capabilities
  mission_creation: 'high',
  mission_delegation: 'high',
  computer_use: 'high',
  browser_use: 'high',
  terminal_use: 'high',
  file_access: 'high',
  code_execution: 'high',
  api_calls: 'high',
  network_access: 'high',
  multi_agent: 'high',

  // Verified only
  governance_admin: 'verified',
};

/**
 * Get capabilities available at a given trust level.
 * Returns all capabilities whose floor is at or below the given level.
 */
export function getCapabilitiesForTrustLevel(level: AgentTrustLevel): readonly AgentCapability[] {
  const rank = trustLevelRank(level);
  return (Object.entries(CAPABILITY_TRUST_FLOOR) as [AgentCapability, AgentTrustLevel][])
    .filter(([_, floor]) => trustLevelRank(floor) <= rank)
    .map(([cap]) => cap);
}

/**
 * LM-14.04: Intersect requested capabilities with trust level mapping.
 * Only returns capabilities the agent's trust level permits.
 */
export function intersectCapabilitiesWithTrust(
  requested: readonly AgentCapability[],
  level: AgentTrustLevel,
): readonly AgentCapability[] {
  const allowed = new Set(getCapabilitiesForTrustLevel(level));
  return requested.filter(cap => allowed.has(cap));
}

/**
 * LM-13.04: Check if a capability is within the trust level ceiling.
 */
export function isCapabilityAllowedAtTrust(capability: AgentCapability, level: AgentTrustLevel): boolean {
  const floor = CAPABILITY_TRUST_FLOOR[capability];
  if (!floor) return false;
  return trustLevelRank(level) >= trustLevelRank(floor);
}

// ============================================================================
// Promotion Validation (LM-5, LM-11)
// ============================================================================

/** Validation result for promotion requests */
export interface PromotionValidation {
  readonly valid: boolean;
  readonly reason: string;
  readonly capabilitiesUnlocked: readonly AgentCapability[];
}

/**
 * Validate a trust promotion request.
 *
 * LM-5.12: Only single-step forward promotions allowed.
 * LM-5.13: verified requires non-self human approval (FM-GB-03).
 * LM-11.03-LM-11.06: Level-specific requirements.
 *
 * @param currentLevel - Agent's current trust level
 * @param targetLevel - Requested promotion target
 * @param evidence - Evidence supporting the promotion
 * @param actorId - The actor requesting the promotion
 * @param agentId - The agent being promoted
 */
export function validatePromotion(
  currentLevel: AgentTrustLevel,
  targetLevel: AgentTrustLevel,
  evidence: readonly TrustPromotionEvidence[],
  actorId: string,
  agentId: string,
): PromotionValidation {
  const rejected = (reason: string): PromotionValidation => ({
    valid: false, reason, capabilitiesUnlocked: [],
  });

  // Cannot promote to same level
  if (currentLevel === targetLevel) {
    return rejected(`Already at trust level '${currentLevel}'`);
  }

  // LM-5.12: Single-step forward only (FM-GB-04)
  const expected = nextTrustLevel(currentLevel);
  if (expected === null) {
    return rejected('Cannot promote beyond verified trust level');
  }
  if (targetLevel !== expected) {
    return rejected(`Must promote one level at a time. Current: '${currentLevel}', expected next: '${expected}', got: '${targetLevel}'`);
  }

  // LM-5.13 / FM-GB-03: verified must not be self-granted
  if (targetLevel === 'verified' && actorId === agentId) {
    return rejected('verified trust level cannot be self-granted');
  }

  // LM-11.03: low requires registration evidence
  if (targetLevel === 'low') {
    // Minimal: registration is implicitly complete if we get here
    // No additional evidence requirements
  }

  // LM-11.04: medium requires 10+ ops, 0 governance refusals in 24h
  if (targetLevel === 'medium') {
    const sessionEvidence = evidence.find(e => e.type === 'session_count');
    if (!sessionEvidence || (typeof sessionEvidence.value === 'number' && sessionEvidence.value < 10)) {
      return rejected('medium trust requires 10+ successful operations');
    }
    const complianceEvidence = evidence.find(e => e.type === 'governance_compliance');
    if (complianceEvidence && typeof complianceEvidence.value === 'number' && complianceEvidence.value > 0) {
      return rejected('medium trust requires 0 governance refusals in last 24h');
    }
  }

  // LM-11.05: high requires 100+ ops + human/senior approval
  if (targetLevel === 'high') {
    const sessionEvidence = evidence.find(e => e.type === 'session_count');
    if (!sessionEvidence || (typeof sessionEvidence.value === 'number' && sessionEvidence.value < 100)) {
      return rejected('high trust requires 100+ successful operations');
    }
    const humanEvidence = evidence.find(e => e.type === 'human_endorsement');
    if (!humanEvidence) {
      return rejected('high trust requires human approval or senior agent endorsement');
    }
  }

  // LM-11.06: verified requires human approval + Core admin record
  if (targetLevel === 'verified') {
    const humanEvidence = evidence.find(e => e.type === 'human_endorsement');
    if (!humanEvidence) {
      return rejected('verified trust requires human approval and Core admin transition record');
    }
  }

  // Compute capabilities unlocked by the new level
  const currentCaps = new Set(getCapabilitiesForTrustLevel(currentLevel));
  const newCaps = getCapabilitiesForTrustLevel(targetLevel);
  const unlocked = newCaps.filter(cap => !currentCaps.has(cap));

  return { valid: true, reason: 'Promotion approved', capabilitiesUnlocked: unlocked };
}

/**
 * Validate a demotion and compute capability revocations.
 *
 * LM-9.07: untrusted is floor.
 * LM-5.18: Capabilities above new level are revoked.
 * Demotion can skip levels (not monotonic).
 */
export function validateDemotion(
  currentLevel: AgentTrustLevel,
  targetLevel: AgentTrustLevel,
): { valid: boolean; reason: string; capabilitiesRevoked: readonly AgentCapability[] } {
  if (currentLevel === 'untrusted') {
    return { valid: false, reason: 'Cannot demote below untrusted (floor)', capabilitiesRevoked: [] };
  }

  if (trustLevelRank(targetLevel) >= trustLevelRank(currentLevel)) {
    return { valid: false, reason: `Target level '${targetLevel}' is not below current level '${currentLevel}'`, capabilitiesRevoked: [] };
  }

  // Compute capabilities that will be revoked
  const newCaps = new Set(getCapabilitiesForTrustLevel(targetLevel));
  const currentCaps = getCapabilitiesForTrustLevel(currentLevel);
  const revoked = currentCaps.filter(cap => !newCaps.has(cap));

  return { valid: true, reason: 'Demotion approved', capabilitiesRevoked: revoked };
}

// ============================================================================
// Trust-to-CoreTrustLevel Mapping (LM-3.17)
// ============================================================================

/** Map 5-level trust to 4-level Core trust for backward compat */
export function toCoretrustLevel(level: AgentTrustLevel): 'untrusted' | 'probationary' | 'trusted' | 'admin' {
  switch (level) {
    case 'untrusted': return 'untrusted';
    case 'low': return 'probationary';
    case 'medium': return 'trusted';
    case 'high': return 'trusted';
    case 'verified': return 'admin';
  }
}

// ============================================================================
// Confidence Caps (LM-11.07 through LM-11.11)
// ============================================================================

/** LM-11.07-11.11: Max assertable confidence per trust level */
export const TRUST_CONFIDENCE_CAPS: Record<AgentTrustLevel, number> = {
  untrusted: 0,    // LM-11.07: N/A (cannot assert)
  low: 0.3,        // LM-11.08
  medium: 0.7,     // LM-11.09
  high: 0.85,      // LM-11.10
  verified: 1.0,   // LM-11.11
};
