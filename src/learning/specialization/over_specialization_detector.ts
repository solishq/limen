/**
 * Limen — OverSpecializationDetector Implementation
 * Phase 4E-2e: Learning System Convergence Subsystems
 *
 * Implements the OverSpecializationDetector interface from learning_types.ts.
 * FM-07 defense: detects when agent's technique types lack diversity.
 *
 * S ref: S29.10 (over-specialization detection), DEC-4E-001 (Shannon entropy formula),
 *        FM-07 (learning drift / over-specialization)
 *
 * Engineering decisions:
 *   D1: Shannon entropy formula: H = -Σ(p_i × log(p_i)), Score = 1 - (H / log(N)).
 *       Uses natural log (Math.log). Both H and log(N) use the same base, so the
 *       base cancels out in the ratio. Result is base-independent.
 *   D2: N=0 edge case (no active techniques): returns score=0.0, overSpecialized=false.
 *       An agent with no techniques cannot be over-specialized.
 *   D3: N=1 edge case (one type only): H=0, log(1)=0. Score = 1-(0/0) = NaN.
 *       Handle explicitly: score=1.0 (maximally specialized). This is correct —
 *       an agent with techniques of only one type IS maximally specialized.
 *   D4: 0×log(0) edge case: convention 0×log(0) = 0 for entropy calculation.
 *       When p_i = 0, that term contributes 0 to H.
 *   D5: Score > threshold (strict >, not >=) per DEC-4E-001.
 */

import type {
  OverSpecializationDetector, SpecializationMetrics,
  TechniqueType, TechniqueStore,
} from '../interfaces/index.js';
import { OVERSPECIALIZATION_THRESHOLD } from '../interfaces/index.js';
import type {
  DatabaseConnection, Result, AgentId, TenantId,
} from '../../kernel/interfaces/index.js';

// ─── All technique types ───
const ALL_TYPES: readonly TechniqueType[] = ['prompt_fragment', 'decision_rule', 'rag_pattern'];

// ─── Factory ───

/**
 * Create an OverSpecializationDetector implementation.
 * Follows the Limen store pattern: factory → Object.freeze.
 *
 * S29.10 + DEC-4E-001: Shannon entropy specialization score.
 */
export function createOverSpecializationDetector(store: TechniqueStore): OverSpecializationDetector {

  function analyze(
    conn: DatabaseConnection,
    agentId: AgentId,
    tenantId: TenantId,
  ): Result<SpecializationMetrics> {
    // Get all active techniques for this agent
    const techniquesResult = store.getByAgent(conn, agentId, tenantId, 'active');
    if (!techniquesResult.ok) return techniquesResult as Result<SpecializationMetrics>;

    const techniques = techniquesResult.value;

    // Build type distribution
    const distribution: Record<TechniqueType, number> = {
      prompt_fragment: 0,
      decision_rule: 0,
      rag_pattern: 0,
    };

    for (const t of techniques) {
      distribution[t.type]++;
    }

    const total = techniques.length;

    // D2: N=0 — no techniques, cannot be over-specialized
    if (total === 0) {
      return {
        ok: true,
        value: {
          agentId,
          tenantId,
          typeDistribution: distribution,
          specializationScore: 0.0,
          overSpecialized: false,
        },
      };
    }

    // Count distinct types with non-zero count
    const representedTypes = ALL_TYPES.filter(t => distribution[t] > 0);
    const N = representedTypes.length;

    // D3: N=1 — single type, maximally specialized
    if (N <= 1) {
      return {
        ok: true,
        value: {
          agentId,
          tenantId,
          typeDistribution: distribution,
          specializationScore: 1.0,
          overSpecialized: 1.0 > OVERSPECIALIZATION_THRESHOLD, // D5: strict >
        },
      };
    }

    // Compute Shannon entropy: H = -Σ(p_i × log(p_i))
    // D4: 0×log(0) = 0 — skip types with zero count
    let H = 0;
    for (const type of ALL_TYPES) {
      const count = distribution[type];
      if (count === 0) continue; // D4
      const p = count / total;
      H -= p * Math.log(p);
    }

    // Score = 1 - (H / log(N))  where N = number of distinct types
    const score = 1 - (H / Math.log(N));

    return {
      ok: true,
      value: {
        agentId,
        tenantId,
        typeDistribution: distribution,
        specializationScore: score,
        overSpecialized: score > OVERSPECIALIZATION_THRESHOLD, // D5: strict >
      },
    };
  }

  return Object.freeze({ analyze });
}
