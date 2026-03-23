/**
 * Time provider interface for deterministic clock injection.
 * S ref: Hard Stop #7 (clock injection), C-06 (no shared mutable state)
 *
 * Phase: 1 (Kernel)
 * Implements: TimeProvider abstraction — all temporal logic uses this interface,
 *             never direct Date.now() or new Date().
 *
 * Frozen Zone Amendment: Added to resolve Hard Stop #7 violations across 33+ files.
 * Approved: Phase 2 Cleanup sprint (Constitutional Debt Remediation).
 */

/**
 * Injectable time provider. Production uses system clock; tests use deterministic clock.
 *
 * Every function that needs the current time receives a TimeProvider via dependency
 * injection. This enables:
 * - Deterministic test execution (no flaky time-dependent tests)
 * - Time-travel testing (advance clock to test TTL, retention, timeouts)
 * - Replay-safe audit trails (timestamps reproducible from provider state)
 *
 * S ref: Hard Stop #7, C-06
 */
export interface TimeProvider {
  /** Returns current time as ISO 8601 string (e.g., "2026-03-20T10:30:00.000Z") */
  nowISO(): string;

  /** Returns current time as milliseconds since epoch (equivalent to Date.now()) */
  nowMs(): number;
}
