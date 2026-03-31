/**
 * Phase 5: Cognitive API Namespace.
 *
 * Factory that creates the `limen.cognitive` namespace object.
 * Thin delegation layer -- all computation lives in cognitive/health.ts.
 *
 * Spec ref: LIMEN_BUILD_PHASES.md (5.3), PHASE-5-DESIGN-SOURCE.md (Decision 2: Option A)
 * PA Ruling: limen.cognitive.health() APPROVED (not limen.health.cognitive())
 *
 * Forward-compatible with Phase 12 (Cognitive Engine) which will add:
 *   - limen.cognitive.consolidate()
 *   - limen.cognitive.verify()
 *   - limen.cognitive.narrative()
 */

import type { Result } from '../../kernel/interfaces/index.js';
import type { TenantId } from '../../kernel/interfaces/index.js';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type { FreshnessThresholds } from '../../cognitive/freshness.js';
import {
  computeCognitiveHealth,
  type CognitiveHealthReport,
  type CognitiveHealthConfig,
} from '../../cognitive/health.js';

// ── Types ──

/**
 * Phase 5: Cognitive API namespace interface.
 * Exposed as `limen.cognitive` on the Limen public API.
 */
export interface CognitiveNamespace {
  /** Phase 5 §5.3: Compute cognitive health report. Synchronous. */
  health(config?: CognitiveHealthConfig): Result<CognitiveHealthReport>;
}

/**
 * Dependencies for creating the CognitiveNamespace.
 */
export interface CognitiveNamespaceDeps {
  readonly getConnection: () => DatabaseConnection;
  readonly getTenantId: () => TenantId | null;
  readonly time: TimeProvider;
  readonly freshnessThresholds?: FreshnessThresholds | undefined;
}

// ── Result Helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message, spec: 'Phase-5' } };
}

// ── Factory ──

/**
 * Create the CognitiveNamespace object.
 * Captures dependencies via closure -- survives Object.freeze (same pattern as ConvenienceLayer).
 */
export function createCognitiveNamespace(deps: CognitiveNamespaceDeps): CognitiveNamespace {
  return {
    health(config?: CognitiveHealthConfig): Result<CognitiveHealthReport> {
      try {
        const conn = deps.getConnection();
        const tenantId = deps.getTenantId();
        const report = computeCognitiveHealth(
          conn,
          tenantId,
          deps.time,
          deps.freshnessThresholds,
          config,
        );
        return ok(report);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('CONV_HEALTH_QUERY_FAILED', `Cognitive health computation failed: ${msg}`);
      }
    },
  };
}
