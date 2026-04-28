/**
 * Result utility functions for type-safe error propagation.
 * S ref: C-03 (TypeScript strict), §3.1 (deterministic infrastructure)
 *
 * Phase: 9 (Type Safety Hardening)
 *
 * These utilities replace unsafe `as unknown as Result<T>` casts
 * with runtime-validated type-safe alternatives.
 */

import type { Result } from './common.js';

/**
 * Propagate an error Result to a different value type.
 * Used to replace unsafe `as unknown as Result<T>` casts.
 * Only valid on error Results (ok === false).
 *
 * @throws Error if called on an ok Result (this is a bug in the caller)
 */
export function propagateError<T>(result: Result<unknown>): Result<T> {
  if (result.ok) throw new Error('propagateError called on ok result — this is a bug');
  return { ok: false, error: result.error };
}
