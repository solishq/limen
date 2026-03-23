/**
 * Time provider implementations.
 * S ref: Hard Stop #7 (clock injection)
 *
 * Phase: 1 (Kernel)
 * Implements: System clock (production) and test clock (deterministic testing).
 *
 * System provider: thin wrapper around Date — zero overhead, real clock.
 * Test provider: deterministic, advanceable — enables time-dependent testing
 * without flakiness or sleep().
 */

import type { TimeProvider } from '../interfaces/time.js';

/**
 * Create a system time provider using the real clock.
 * Used in production. Returns current wall-clock time.
 *
 * S ref: Hard Stop #7
 */
export function createSystemTimeProvider(): TimeProvider {
  return {
    nowISO(): string {
      return new Date().toISOString();
    },
    nowMs(): number {
      return Date.now();
    },
  };
}

/**
 * Create a deterministic test time provider.
 * Starts at a fixed epoch (or specified time) and only advances when told.
 *
 * Usage:
 *   const time = createTestTimeProvider();
 *   time.nowISO(); // "2026-01-01T00:00:00.000Z"
 *   time.advance(1000); // advance 1 second
 *   time.nowISO(); // "2026-01-01T00:00:01.000Z"
 *   time.set(new Date('2026-06-15T12:00:00Z').getTime()); // jump to specific time
 *
 * S ref: Hard Stop #7, C-06
 */
export function createTestTimeProvider(
  startMs: number = new Date('2026-01-01T00:00:00.000Z').getTime(),
): TimeProvider & {
  /** Advance the clock by the given number of milliseconds */
  advance(ms: number): void;
  /** Set the clock to an exact millisecond timestamp */
  set(ms: number): void;
} {
  let currentMs = startMs;

  return {
    nowISO(): string {
      return new Date(currentMs).toISOString();
    },
    nowMs(): number {
      return currentMs;
    },
    advance(ms: number): void {
      currentMs += ms;
    },
    set(ms: number): void {
      currentMs = ms;
    },
  };
}
