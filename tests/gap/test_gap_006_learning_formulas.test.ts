/**
 * TEST-GAP-006 (tests 1-2): Learning system formulas — S29, I-10
 * Verifies: EMA calculation and retirement threshold logic from spec.
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * S29: "EMA (0.8*old + 0.2*recent)"
 * S29.6: Retirement when ANY of:
 *   - success_rate < 0.3 over 50+ applications
 *   - confidence < 0.2 after 20+ applications
 *   - not applied in 90 days
 *   - explicitly flagged by human reviewer
 *
 * Phase: 4A-2 (spec formula anchors, no implementation dependency)
 * NOTE: These test the SPEC FORMULAS, not production code (which doesn't exist yet).
 *       Tests 3-5 (quarantine cascade, cross-agent gate, entropy) are DEFERRED to Phase 4F.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('TEST-GAP-006: Learning System Formulas (S29)', () => {

  describe('S29: EMA confidence tracking', () => {
    it('EMA follows 0.8*old + 0.2*recent formula exactly', () => {
      // SPEC: S29 "EMA (0.8*old + 0.2*recent)"
      const oldEma = 0.7;
      const recent = 0.5;
      const newEma = 0.8 * oldEma + 0.2 * recent;

      // IEEE 754: 0.8 * 0.7 + 0.2 * 0.5 = 0.6599999999999999 (not exactly 0.66)
      // Use tolerance for floating-point comparison. Implementation must use same formula.
      assert.ok(Math.abs(newEma - 0.66) < 1e-10,
        `S29: EMA = 0.8 * 0.7 + 0.2 * 0.5 ≈ 0.66, got ${newEma}`);
    });

    it('EMA converges toward 1.0 with consistent success', () => {
      // Verify convergence behavior: repeated 1.0 results pull EMA upward
      let ema = 0.5;
      for (let i = 0; i < 20; i++) {
        ema = 0.8 * ema + 0.2 * 1.0;
      }
      // After 20 applications of 1.0: should be very close to 1.0
      assert.ok(ema > 0.98, `S29: EMA after 20x 1.0 should converge near 1.0, got ${ema}`);
    });

    it('EMA converges toward 0.0 with consistent failure', () => {
      // Verify convergence: repeated 0.0 results pull EMA downward
      let ema = 0.5;
      for (let i = 0; i < 20; i++) {
        ema = 0.8 * ema + 0.2 * 0.0;
      }
      // After 20 applications of 0.0: should be very close to 0.0
      assert.ok(ema < 0.02, `S29: EMA after 20x 0.0 should converge near 0.0, got ${ema}`);
    });

    it('EMA is bounded [0, 1] for any valid inputs', () => {
      // Property: if old ∈ [0,1] and recent ∈ [0,1], then EMA ∈ [0,1]
      const testCases = [
        { old: 0.0, recent: 0.0 },
        { old: 1.0, recent: 1.0 },
        { old: 0.0, recent: 1.0 },
        { old: 1.0, recent: 0.0 },
        { old: 0.5, recent: 0.5 },
      ];

      for (const { old: o, recent: r } of testCases) {
        const ema = 0.8 * o + 0.2 * r;
        assert.ok(ema >= 0.0 && ema <= 1.0,
          `S29: EMA must be in [0,1] for old=${o}, recent=${r}, got ${ema}`);
      }
    });
  });

  describe('S29.6: Retirement thresholds', () => {
    it('technique retired when success_rate < 0.3 over 50+ applications', () => {
      // SPEC: S29.6 "success_rate < 0.3 over 50+ applications"
      const successRate = 0.25;
      const applicationCount = 50;
      const shouldRetire = successRate < 0.3 && applicationCount >= 50;

      assert.ok(shouldRetire,
        'S29.6: success_rate 0.25 after 50 applications → must retire');
    });

    it('technique NOT retired when success_rate < 0.3 but under 50 applications', () => {
      // Not enough data — don't retire prematurely
      const successRate = 0.1;
      const applicationCount = 30;
      const shouldRetire = successRate < 0.3 && applicationCount >= 50;

      assert.ok(!shouldRetire,
        'S29.6: 30 applications is insufficient data for retirement');
    });

    it('technique retired when confidence < 0.2 after 20+ applications', () => {
      // SPEC: S29.6 "confidence < 0.2 after 20+ applications"
      const confidence = 0.15;
      const applicationCount = 20;
      const shouldRetire = confidence < 0.2 && applicationCount >= 20;

      assert.ok(shouldRetire,
        'S29.6: confidence 0.15 after 20 applications → must retire');
    });

    it('technique NOT retired when confidence < 0.2 but under 20 applications', () => {
      const confidence = 0.1;
      const applicationCount = 10;
      const shouldRetire = confidence < 0.2 && applicationCount >= 20;

      assert.ok(!shouldRetire,
        'S29.6: 10 applications is insufficient for confidence-based retirement');
    });

    it('technique retired when not applied in 90 days', () => {
      // SPEC: S29.6 "not applied in 90 days"
      const daysSinceLastApplication = 91;
      const shouldRetire = daysSinceLastApplication > 90;

      assert.ok(shouldRetire,
        'S29.6: 91 days without application → must retire');
    });

    it('technique NOT retired at exactly 90 days', () => {
      // Boundary: 90 days exactly should NOT trigger retirement (> 90, not >=)
      const daysSinceLastApplication = 90;
      const shouldRetire = daysSinceLastApplication > 90;

      assert.ok(!shouldRetire,
        'S29.6: exactly 90 days → should NOT retire (boundary)');
    });

    it('technique retired when flagged by human reviewer regardless of metrics', () => {
      // SPEC: S29.6 "explicitly flagged by human reviewer"
      // Even with perfect metrics, human flag = retire
      const successRate = 0.95;
      const confidence = 0.99;
      const applicationCount = 100;
      const humanFlagged = true;

      const shouldRetire = humanFlagged ||
        (successRate < 0.3 && applicationCount >= 50) ||
        (confidence < 0.2 && applicationCount >= 20);

      assert.ok(shouldRetire,
        'S29.6: human flag overrides all metrics → must retire');
    });
  });
});
