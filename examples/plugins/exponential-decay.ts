/**
 * Reference Plugin: Exponential Decay Policy
 *
 * Demonstrates DecayHook — replaces the default FSRS power-decay
 * formula with a configurable exponential decay.
 *
 * Default FSRS: R(t) = (1 + t/(9*S))^(-1)
 * This plugin: R(t) = e^(-lambda * t)  where lambda = ln(2) / halfLifeDays
 *
 * Usage:
 *   import { exponentialDecay } from './exponential-decay.js';
 *   const limen = await createLimen({
 *     hooks: [exponentialDecay({ halfLifeDays: 30 })],
 *   });
 */

// NOTE: In your own project, import from the package:
//   import type { LimenHook } from 'limen-ai';
// Source-relative import used here for development only.
import type { LimenHook } from '../../src/plugins/hook_types.js';

const MS_PER_DAY = 86_400_000;

export interface ExponentialDecayOptions {
  /** Half-life in days. After this many days, confidence drops to 50%. Default: 30 */
  readonly halfLifeDays?: number;
  /** Floor — minimum decay factor never goes below this. Default: 0.01 */
  readonly floor?: number;
}

export function exponentialDecay(options: ExponentialDecayOptions = {}): LimenHook {
  // F-010 fix: Clamp halfLifeDays to positive value
  const halfLifeDays = Math.max(0.001, options.halfLifeDays ?? 30);
  const floor = Math.max(0, Math.min(1, options.floor ?? 0.01));
  const lambda = Math.LN2 / halfLifeDays;

  return {
    meta: { name: 'exponential-decay', version: '1.0.0' },
    priority: 100,
    decay: {
      computeDecay(confidence, ageMs, _stabilityDays) {
        if (!Number.isFinite(ageMs) || ageMs <= 0) return confidence;
        if (!Number.isFinite(confidence) || confidence <= 0) return 0;

        const ageDays = Math.max(0, ageMs) / MS_PER_DAY;
        const decayFactor = Math.max(floor, Math.exp(-lambda * ageDays));
        return confidence * decayFactor;
      },
    },
  };
}
