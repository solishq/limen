/**
 * Phase 12: Self-Healing Engine — Event-driven auto-retraction of derived claims.
 *
 * NOT a standalone callable. A function that processes retraction cascades:
 * 1. Called by an event listener registered in createLimen() on 'claim.retracted'
 * 2. Traverses derived_from children of the retracted claim
 * 3. Computes effectiveConfidence = confidence * decay * cascadePenalty
 * 4. If below threshold: retracts with reason 'incorrect' via the claim system
 * 5. Guards: visited Set (I-P12-02), depth counter (I-P12-03)
 *
 * Spec ref: PHASE-12-DESIGN-SOURCE.md (Output 1, Self-Healing Engine)
 * Truth model: I-P12-01, I-P12-02, I-P12-03, I-P12-04, I-P12-05
 * DCs: DC-P12-201, DC-P12-202, DC-P12-203, DC-P12-204, DC-P12-401, DC-P12-502
 *
 * CRITICAL CONSTRAINT: Self-healing MUST use RetractionReason 'incorrect' (I-P12-04).
 * The retraction taxonomy is CONSTITUTIONAL — no new values.
 *
 * v2.1.0: activeCascadeClaims moved from module-level to per-instance Set
 * (InstanceContext.activeCascadeClaims). Eliminates cross-instance interference (C-06).
 */

import { randomUUID } from 'node:crypto';
import type { TenantScopedConnection } from '../kernel/tenant/tenant_scope.js';
import type { OperationContext } from '../kernel/interfaces/common.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type { RetractClaimHandler } from '../claims/interfaces/claim_types.js';
import type { ClaimId } from '../claims/interfaces/claim_types.js';
import type { SelfHealingConfig, SelfHealingEvent } from './cognitive_types.js';
import { computeDecayFactor, computeAgeMs } from './decay.js';
import { computeCascadePenalty } from './cascade.js';
import { resolveStability, type StabilityConfig } from './stability.js';

/**
 * Dependencies for self-healing execution.
 * Injected from createLimen() at registration time.
 */
export interface SelfHealingDeps {
  readonly getConnection: () => TenantScopedConnection;
  readonly getContext: () => OperationContext;
  readonly retractClaim: RetractClaimHandler;
  readonly time: TimeProvider;
  readonly config: SelfHealingConfig;
  readonly stabilityConfig?: StabilityConfig | undefined;
  /**
   * v2.1.0: Per-instance cascade guard Set from InstanceContext.
   * Replaces module-level activeCascadeClaims for C-06 isolation.
   */
  readonly activeCascadeClaims: Set<string>;
}

/**
 * Check if a claim is currently being processed by an active self-healing cascade.
 * Exported for use by the event listener in createLimen().
 *
 * v2.1.0: Now accepts the per-instance Set instead of using module-level state.
 *
 * @param cascadeSet - The per-instance active cascade claims Set
 * @param claimId - The claim ID to check
 * @returns true if the claim is part of an active cascade
 */
export function isInActiveCascade(cascadeSet: Set<string>, claimId: string): boolean {
  return cascadeSet.has(claimId);
}

/**
 * Process a self-healing cascade for a retracted claim.
 *
 * This is the core function invoked by the event listener.
 * It traverses derived_from children and auto-retracts those
 * whose effectiveConfidence falls below the threshold.
 *
 * I-P12-01: Claims below threshold MUST be auto-retracted with reason 'incorrect'.
 * I-P12-02: Visited Set prevents cycles.
 * I-P12-03: Depth limit prevents unbounded recursion.
 * I-P12-04: Uses RetractionReason 'incorrect' (CONSTITUTIONAL).
 * I-P12-05: Every auto-retraction logged in consolidation_log.
 *
 * @param retractedClaimId - The claim that was just retracted (trigger)
 * @param deps - Self-healing dependencies (includes activeCascadeClaims Set)
 * @param visited - Set of already-visited claim IDs (cycle prevention)
 * @param depth - Current cascade depth
 * @returns Array of self-healing events (for testing/observability)
 */
export function processSelfHealing(
  retractedClaimId: string,
  deps: SelfHealingDeps,
  visited: Set<string> = new Set(),
  depth: number = 0,
): SelfHealingEvent[] {
  const isTopLevel = depth === 0;
  const { config, time, activeCascadeClaims } = deps;

  // Guard: disabled
  if (!config.enabled) return [];

  // Guard: depth limit (I-P12-03)
  if (depth >= config.maxCascadeDepth) {
    // Log depth exceeded but do not throw
    const conn = deps.getConnection();
    const tenantId = deps.getContext().tenantId;
    conn.run(
      `INSERT INTO consolidation_log (id, tenant_id, operation, source_claim_ids, target_claim_id, reason, created_at)
       VALUES (?, ?, 'self_heal', ?, NULL, ?, ?)`,
      [randomUUID(), tenantId, JSON.stringify([retractedClaimId]), 'SELF_HEALING_DEPTH_EXCEEDED', time.nowISO()],
    );
    return [];
  }

  // Guard: cycle prevention (I-P12-02)
  if (visited.has(retractedClaimId)) return [];
  visited.add(retractedClaimId);

  // F-P12-003: Register this claim in the active cascade set.
  // This prevents the event listener from re-entering when retractClaim.execute()
  // emits claim.retracted synchronously. The recursive traversal below handles
  // cascading — the event listener is the ENTRY POINT only.
  activeCascadeClaims.add(retractedClaimId);

  try {
    const conn = deps.getConnection();
    const ctx = deps.getContext();
    const nowMs = time.nowMs();
    const events: SelfHealingEvent[] = [];

    // Query derived_from children:
    // Direction: from_claim_id = child (derives from parent), to_claim_id = parent
    // So children of retractedClaimId are: from_claim_id WHERE to_claim_id = retractedClaimId
    const children = conn.query<{ from_claim_id: string }>(
      `SELECT from_claim_id FROM claim_relationships
       WHERE to_claim_id = ? AND type = 'derived_from'`,
      [retractedClaimId],
    );

    for (const child of children) {
      const childId = child.from_claim_id;

      // Skip already visited (cycle in derived_from graph)
      if (visited.has(childId)) continue;

      // Get the child claim to compute effective confidence
      const childClaim = conn.get<{
        id: string;
        confidence: number;
        valid_at: string;
        predicate: string;
        status: string;
      }>(
        `SELECT id, confidence, valid_at, predicate, status
         FROM claim_assertions WHERE id = ?`,
        [childId],
      );

      // Skip if already retracted or not found
      if (!childClaim || childClaim.status === 'retracted') continue;

      // Compute effectiveConfidence = confidence * decay * cascadePenalty
      const stabilityDays = resolveStability(childClaim.predicate, deps.stabilityConfig);
      const ageMs = computeAgeMs(childClaim.valid_at, nowMs);
      const decayFactor = computeDecayFactor(ageMs, stabilityDays);
      const cascadePenalty = computeCascadePenalty(conn, childId);
      const effectiveConfidence = childClaim.confidence * decayFactor * cascadePenalty;

      if (effectiveConfidence < config.autoRetractThreshold) {
        // F-P12-003: Pre-register child in active cascade BEFORE retraction.
        // retractClaim.execute() emits claim.retracted synchronously, which
        // fires the event listener. The listener checks isInActiveCascade()
        // and skips re-entry for this child.
        activeCascadeClaims.add(childId);

        // Auto-retract with reason 'incorrect' (I-P12-04: CONSTITUTIONAL)
        const retractResult = deps.retractClaim.execute(conn, ctx, {
          claimId: childId as ClaimId,
          reason: 'incorrect',
        });

        if (retractResult.ok) {
          // Log in consolidation_log (I-P12-05)
          conn.run(
            `INSERT INTO consolidation_log (id, tenant_id, operation, source_claim_ids, target_claim_id, reason, created_at)
             VALUES (?, ?, 'self_heal', ?, ?, ?, ?)`,
            [
              randomUUID(), ctx.tenantId,
              JSON.stringify([retractedClaimId]),
              childId,
              `Auto-retracted: effectiveConfidence ${effectiveConfidence.toFixed(4)} < threshold ${config.autoRetractThreshold}`,
              time.nowISO(),
            ],
          );

          events.push({
            retractedClaimId,
            derivedClaimId: childId,
            effectiveConfidence,
            reason: 'incorrect',
          });

          // Recurse: traverse children of the retracted child.
          // The event listener will NOT re-enter because childId is in activeCascadeClaims.
          // This recursive call handles cascading with shared visited Set and incremented depth.
          const childEvents = processSelfHealing(
            childId, deps, visited, depth + 1,
          );
          events.push(...childEvents);
        }
        // If retraction fails (e.g., already retracted by another path), skip silently
      }
      // If above threshold: child survives with reduced confidence (I-P12-01)
    }

    return events;
  } finally {
    // F-P12-003: Clean up the active cascade set when the TOP-LEVEL cascade completes.
    // Only the top-level call clears the set — recursive calls leave entries for the
    // duration of the cascade so that synchronous event re-entry is suppressed.
    if (isTopLevel) {
      activeCascadeClaims.clear();
    }
  }
}
