/**
 * TGP (Technique Governance Protocol) harness — factory + wiring.
 * Spec ref: TGP v1.0 Design Source (FINAL), Architecture Freeze CF-12/CF-13
 *
 * Phase: v3.3.0 — Technique Governance Protocol
 * Status: IMPLEMENTED — delegates to tgp_stores.ts.
 *
 * The harness is the public entry point for creating TechniqueGovernor instances.
 * Contract tests import createTechniqueGovernor from this file.
 *
 * EXISTING v3.2 DEPENDENCIES (additive-only):
 *   - TechniqueStore (src/learning/store/technique_store.ts)
 *   - QuarantineManager (src/learning/quarantine/quarantine_manager.ts)
 *   - ColdStartManager (src/learning/cold_start/cold_start_manager.ts)
 *   - CrossAgentTransfer (src/learning/transfer/cross_agent_transfer.ts)
 *   All are additive-only. TGP extends, never modifies.
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type {
  TechniqueGovernor,
  TechniqueGovernorDeps,
} from '../interfaces/tgp_types.js';

import { createTechniqueGovernorImpl } from '../store/tgp_stores.js';

// ============================================================================
// NotImplementedError — retained for backward compatibility with structural tests
// ============================================================================

/**
 * Retained for structural tests that verify error shape.
 * No longer thrown by production code.
 */
export class NotImplementedError extends Error {
  public readonly code = 'NOT_IMPLEMENTED';

  constructor(method: string) {
    super(`${method} is not yet implemented`);
    this.name = 'NotImplementedError';
  }
}

// ============================================================================
// Factory — TechniqueGovernor
// ============================================================================

/**
 * Create the TGP TechniqueGovernor facade.
 *
 * Delegates to real SQLite-backed implementations in tgp_stores.ts.
 * Schema must be initialized via migration 029 before calling any method.
 *
 * @param deps - External dependencies (audit, events)
 * @param conn - Optional database connection for DC-TGP-908 PRAGMA verification at init
 * @returns Frozen TechniqueGovernor with all subsystems wired
 */
export function createTechniqueGovernor(deps: TechniqueGovernorDeps, conn?: DatabaseConnection): TechniqueGovernor {
  return createTechniqueGovernorImpl(deps, conn);
}
