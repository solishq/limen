/**
 * CGP (Context Governance Protocol) harness — thin factory + cross-subsystem wiring.
 * Spec ref: CGP v1.0 Design Source (FINAL)
 *
 * Phase 2A: P-010 compliance — all business logic in cgp_stores.ts.
 * Phase 2B: CGP ↔ WMP wiring — injects real WmpInternalReader from WMP harness.
 * Phase 2B: CGP ↔ DBA wiring — injects real EcbProvider from DBA harness.
 * Phase 2B: CGP ↔ CCP wiring — injects real ClaimCandidateCollector for P4.
 *
 * Pattern: Follows P-010 (harness = wiring, stores = logic).
 * The harness imports real cross-subsystem services and injects them into the governor factory.
 * Tests calling createContextGovernor() from here get real wired dependencies.
 * Tests calling createContextGovernor() from cgp_stores directly get stubs (unit isolation).
 */

import type {
  CGPDeps,
  EcbProvider,
  EcbAuditInputs,
  SystemOverheadBreakdown,
  ClaimCandidateCollector,
  ClaimCandidate,
  ObservationCollector,
  ObservationCandidate,
  ObservationId,
  TemporalScope,
} from '../interfaces/cgp_types.js';
import type { Result, DatabaseConnection, MissionId, TaskId } from '../../kernel/interfaces/index.js';
import type { ClaimId } from '../../claims/interfaces/claim_types.js';
import {
  NotImplementedError,
  createConversationContextProvider,
  createContextGovernor as createContextGovernorBase,
} from '../stores/cgp_stores.js';

// Cross-subsystem wiring: real WMP reader
import { createWmpInternalReader } from '../../working-memory/harness/wmp_harness.js';

// Cross-subsystem wiring: real DBA services for ECB computation
import { createDBAHarness } from '../../budget/harness/dba_harness.js';

export { NotImplementedError, createConversationContextProvider };

// ============================================================================
// Real EcbProvider — wraps DBA services (Phase 2B: CGP ↔ DBA wire)
// ============================================================================

/**
 * Create a real EcbProvider backed by DBA services.
 *
 * I-52: Each call is stateless — no state carried between invocations.
 * I-53: ECB = min(window − overhead, ceiling ?? ∞), clamped to 0 (DBA-I14).
 * I-55: Ceiling resolution via DBA policyGovernor (most restrictive wins).
 *
 * The provider calls:
 *   1. dba.window.getAvailableInputWindow(modelId) — substrate window
 *   2. dba.policyGovernor.mergeEffectiveCeiling() — ceiling hierarchy
 *   3. dba.ecb.compute() — the I-53 formula
 *
 * systemOverhead is provided by the caller (I-54: computed externally, not P1 content).
 */
function createRealEcbProvider(): EcbProvider {
  const dba = createDBAHarness();

  return Object.freeze({
    computeECB(params: {
      readonly modelId: string;
      readonly systemOverhead: number;
      readonly overheadBreakdown?: SystemOverheadBreakdown;
      readonly missionCeiling: number | null;
      readonly taskCeiling: number | null;
    }): Result<{ readonly effectiveContextBudget: number; readonly auditInputs: EcbAuditInputs }> {
      // Step 1: Get available input window from substrate
      const windowInfo = dba.window.getAvailableInputWindow(params.modelId);

      // Step 2: Resolve ceiling hierarchy (I-55: most restrictive wins)
      const effectivePolicyCeiling = dba.policyGovernor.mergeEffectiveCeiling(
        params.missionCeiling,
        params.taskCeiling,
      );

      // Step 3: Get overhead computation basis
      const overheadBasis = dba.overhead.getBasis();

      // Step 4: Compute ECB via DBA formula (I-53)
      const ecbResult = dba.ecb.compute({
        availableInputWindow: windowInfo.chosenValue,
        windowDerivationMode: windowInfo.derivationMode,
        kernelDerivationVersion: windowInfo.kernelDerivationVersion,
        systemOverhead: params.systemOverhead,
        overheadComputationBasis: overheadBasis.computationVersion,
        effectivePolicyCeiling,
      });

      // Step 5: Package result with full audit trail (I-61)
      return {
        ok: true as const,
        value: Object.freeze({
          effectiveContextBudget: ecbResult.effectiveContextBudget,
          auditInputs: Object.freeze({
            availableInputWindow: windowInfo.chosenValue,
            systemOverhead: params.systemOverhead,
            ...(params.overheadBreakdown ? { overheadBreakdown: Object.freeze(params.overheadBreakdown) } : {}),
            effectivePolicyCeiling,
            wasNormalized: ecbResult.wasNormalized,
            rawValue: ecbResult.rawValue,
            windowDerivationMode: windowInfo.derivationMode,
            overheadComputationBasis: overheadBasis.computationVersion,
          }),
        }),
      };
    },
  });
}

// ============================================================================
// Real ClaimCandidateCollector — wraps CCP store (Phase 2B: CGP ↔ CCP wire)
// ============================================================================

/**
 * Create a real ClaimCandidateCollector that queries claim data from the CCP store.
 *
 * I-70: Two admission paths (OR semantics):
 *   Path 1: Claims linked via claim_artifact_refs to mission-scoped artifacts
 *   Path 2: Claims with sourceMissionId = mission AND validAt within temporalScope
 *
 * I-74: P4 collects independently of P3 — queries core_artifacts directly.
 * §51.1: status = 'active', archived = false.
 * §51.3: Temporal gate — claims with validAt outside temporalScope excluded.
 * §14.7: Canonical representation built from claim fields + evidence summary.
 */
function createRealClaimCandidateCollector(): ClaimCandidateCollector {
  return Object.freeze({
    collectCandidates(
      conn: DatabaseConnection,
      missionId: MissionId,
      temporalScope?: TemporalScope,
    ): Result<readonly ClaimCandidate[]> {
      // Path 1: Claims linked to mission-scoped artifacts via claim_artifact_refs
      const artifactLinkedRows = conn.query<{ claim_id: string }>(
        `SELECT DISTINCT car.claim_id FROM claim_artifact_refs car
         JOIN core_artifacts ca ON car.artifact_id = ca.id
         WHERE ca.mission_id = ?`,
        [missionId],
      );
      const artifactLinkedIds = new Set(artifactLinkedRows.map(r => r.claim_id));

      // Path 2: Claims by source mission + temporal scope (if temporalScope provided)
      const temporalIds = new Set<string>();
      if (temporalScope) {
        const temporalRows = conn.query<{ id: string }>(
          `SELECT id FROM claim_assertions
           WHERE source_mission_id = ?
             AND valid_at >= ? AND valid_at <= ?
             AND status = 'active' AND archived = 0 AND purged_at IS NULL`,
          [missionId, temporalScope.start, temporalScope.end],
        );
        for (const r of temporalRows) {
          temporalIds.add(r.id);
        }
      }

      // Union both paths (I-70 OR semantics)
      const allClaimIds = new Set([...artifactLinkedIds, ...temporalIds]);

      // Hydrate each claim, apply filters
      // F-02: Per-claim try/catch — one malformed claim must not drop the entire P4 position.
      // If JSON.parse(object_value) throws for one claim, skip it and continue.
      const candidates: ClaimCandidate[] = [];
      for (const cid of allClaimIds) {
        try {
          // Filter: active, non-archived, non-tombstoned (§51.1)
          const row = conn.get<Record<string, unknown>>(
            `SELECT * FROM claim_assertions
             WHERE id = ? AND status = 'active' AND archived = 0 AND purged_at IS NULL`,
            [cid],
          );
          if (!row) continue;

          // §51.3 temporal gate: if temporalScope provided, exclude out-of-window claims
          // This applies to BOTH paths (artifact-linked claims are also filtered)
          // F-03: Use epoch comparison instead of string comparison to handle mixed timezone offsets.
          const validAt = row['valid_at'] as string;
          if (temporalScope) {
            const validAtMs = new Date(validAt).getTime();
            if (Number.isNaN(validAtMs)) continue; // unparseable validAt — exclude
            const startMs = new Date(temporalScope.start).getTime();
            const endMs = new Date(temporalScope.end).getTime();
            if (validAtMs < startMs || validAtMs > endMs) {
              continue;
            }
          }

          // Evidence summary for canonical representation
          const evidenceRows = conn.query<{ evidence_type: string }>(
            `SELECT evidence_type FROM claim_evidence WHERE claim_id = ?`,
            [cid],
          );
          const evidenceTypes = [...new Set(evidenceRows.map(e => e.evidence_type))];

          candidates.push(Object.freeze({
            claimId: row['id'] as ClaimId,
            subject: row['subject'] as string,
            predicate: row['predicate'] as string,
            object: Object.freeze({
              type: row['object_type'] as string,
              value: row['object_value'] ? JSON.parse(row['object_value'] as string) : null,
            }),
            confidence: row['confidence'] as number,
            validAt,
            evidenceSummary: Object.freeze({
              count: evidenceRows.length,
              types: Object.freeze(evidenceTypes),
            }),
            createdAt: row['created_at'] as string,
          }));
        } catch {
          // F-02: Skip this claim — malformed data must not drop the entire P4 position.
          // The claim is silently excluded. safeProviderCall will NOT be triggered.
          continue;
        }
      }

      return { ok: true as const, value: Object.freeze(candidates) };
    },
  });
}

// ============================================================================
// Real ObservationCollector — queries gov_attempts + obs_trace_events
// (Phase 2B: CGP P6 wire)
// ============================================================================

/**
 * Trace event type constant for capability results.
 * When the execution runtime records capability results (web_search, code_execute, etc.),
 * it writes trace events with this type. The collector queries for events matching this type.
 *
 * NOTE: LLM transport is currently stubbed, so no events of this type exist yet.
 * The collector correctly returns empty when no matching events are found.
 * When capability results are eventually recorded, this collector will start returning them.
 */
const OBSERVATION_TRACE_EVENT_TYPE = 'task.capability_result' as const;

/**
 * Create a real ObservationCollector backed by governance trace event data.
 *
 * Data path:
 *   1. gov_attempts: task_id → run_id (current execution)
 *   2. obs_trace_events: run_id + type='task.capability_result' → observation data
 *
 * Returns empty array when:
 *   - No gov_attempts exist for the task (task not yet executed)
 *   - No trace events of type 'task.capability_result' exist (LLM transport stubbed)
 *   - Task has no capability results
 *
 * This is correct behavior: "no observations" is not an error.
 * The stub in cgp_stores.ts throws NotImplementedError (which safeProviderCall catches
 * and degrades). This real implementation queries and returns whatever it finds.
 *
 * @param getConnection Connection factory — called on each collectObservations invocation
 */
function createRealObservationCollector(getConnection: () => DatabaseConnection): ObservationCollector {
  return Object.freeze({
    collectObservations(taskId: TaskId): Result<readonly ObservationCandidate[]> {
      const conn = getConnection();

      // Step 1: Find run_ids for this task's execution attempts
      // DC-CGP-704: Only current task's observations — foreign task exclusion
      const attemptRows = conn.query<{ run_id: string }>(
        `SELECT DISTINCT run_id FROM gov_attempts WHERE task_id = ?`,
        [taskId],
      );

      if (attemptRows.length === 0) {
        // No execution attempts for this task — no observations possible
        return { ok: true as const, value: Object.freeze([]) };
      }

      const runIds = attemptRows.map(r => r.run_id);

      // Step 2: Query trace events of observation type for these runs
      // Using parameterized IN clause for run_ids
      const placeholders = runIds.map(() => '?').join(',');
      const traceRows = conn.query<{
        trace_event_id: string;
        payload: string;
        run_seq: number;
        timestamp: string;
      }>(
        `SELECT trace_event_id, payload, run_seq, timestamp
         FROM obs_trace_events
         WHERE run_id IN (${placeholders})
           AND type = ?
         ORDER BY run_seq ASC`,
        [...runIds, OBSERVATION_TRACE_EVENT_TYPE],
      );

      if (traceRows.length === 0) {
        // No capability result events — empty observations (correct, not an error)
        return { ok: true as const, value: Object.freeze([]) };
      }

      // Step 3: Map trace events to ObservationCandidate
      // F-04: Per-event try/catch — one malformed event must not drop the entire P6 position.
      const candidates: ObservationCandidate[] = [];
      let productionOrder = 0;
      for (const row of traceRows) {
        try {
          const payload = JSON.parse(row.payload) as Record<string, unknown>;
          productionOrder++;
          candidates.push(Object.freeze({
            observationId: row.trace_event_id as ObservationId,
            content: typeof payload['content'] === 'string'
              ? payload['content']
              : JSON.stringify(payload),
            productionOrder,
            producedAt: row.timestamp,
          }));
        } catch {
          // F-04: Skip malformed trace event — do not drop entire P6 position
          continue;
        }
      }

      return { ok: true as const, value: Object.freeze(candidates) };
    },
  });
}

// ============================================================================
// Governor Factory — wired with real cross-subsystem dependencies
// ============================================================================

/**
 * Create a ContextGovernor with real cross-subsystem dependencies wired.
 *
 * Phase 2B wires:
 *   - WmpInternalReader from WMP harness (P2 candidate source)
 *   - EcbProvider from DBA harness (live ECB computation)
 *   - ClaimCandidateCollector from CCP store (P4 real claims)
 *   - ObservationCollector from governance traces (P6 real observations)
 *
 * CGP never touches WMP _connRef, DBA internals, or CCP internals.
 *
 * @param deps Optional overrides — caller-supplied deps take precedence over harness wiring.
 */
export function createContextGovernor(deps?: Partial<CGPDeps>, wmpConnectionRef?: { current: DatabaseConnection | null }) {
  // Connection factory for providers that need database access.
  // In production: deps.getConnection provides the connection.
  // In tests: the mock conn passed to admitContext is used via the pipeline.
  // For the ObservationCollector, we need a getConnection factory.
  // If deps.getConnection is provided, use it. Otherwise, create a stub
  // that returns a mock conn (unit isolation — same pattern as store stubs).
  const getConnection = deps?.getConnection ?? (() => {
    // Stub connection for unit isolation — same as createMockConn in tests
    return {
      dataDir: ':memory:',
      schemaVersion: 12,
      tenancyMode: 'single',
      transaction<T>(fn: () => T): T { return fn(); },
      run() { return { changes: 0, lastInsertRowid: 0 }; },
      query<T>(): T[] { return []; },
      get<T>(): T | undefined { return undefined; },
      close() {},
      checkpoint() { return { ok: true as const, value: undefined }; },
    } as unknown as DatabaseConnection;
  });

  return createContextGovernorBase({
    ...deps,
    wmpReader: deps?.wmpReader ?? createWmpInternalReader(wmpConnectionRef),
    ecbProvider: deps?.ecbProvider ?? createRealEcbProvider(),
    claimCollector: deps?.claimCollector ?? createRealClaimCandidateCollector(),
    observationCollector: deps?.observationCollector ?? createRealObservationCollector(getConnection),
  });
}
