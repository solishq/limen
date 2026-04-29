/**
 * Coordination Backend — Public API Surface
 *
 * Phase 6 (FR-009): Exports the CoordinationBackend interface and factory.
 * Enables Symphonic Swarm cluster mode to use Limen as its coordination substrate.
 *
 * Usage:
 *   import { createLimenBackend } from 'limen/coordination';
 *   const backend = createLimenBackend(limen, timeProvider);
 */

export {
  createLimenBackend,
  type CoordinationBackend,
  type SessionInfo,
  type DecisionInfo,
  type LockInfo,
} from './limen_backend.js';
