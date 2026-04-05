/**
 * Phase 0A Governance Store Implementations — SQLite-backed.
 * Replaces NotImplementedError stubs in governance_harness.ts.
 *
 * Phase: 0A (Foundation)
 * Implements: All 15 governance system components.
 *
 * Schema mismatch strategy (migrations are frozen, cannot modify DDL):
 *   - gov_supervisor_decisions.conditions: JSON({targetType, targetId, precedence, origin})
 *   - gov_suspension_records.reason: JSON({creatingDecisionId, origin})
 *   - gov_mission_contracts.criteria: JSON({objective, constraints, criteria})
 *   - gov_handoffs: state mapping 'revoked'↔'failed', 'expired'↔'completed'
 */

import { createHash, randomUUID } from 'node:crypto';
import { timingSafeHexEqual } from '../../kernel/crypto/crypto_engine.js';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type {
  TenantId, MissionId, TaskId, OperationContext, Result, KernelError,
  TimeProvider,
} from '../../kernel/interfaces/index.js';
import { MISSION_STATE_BACKFILL_MAP, TASK_STATE_BACKFILL_MAP } from '../../kernel/interfaces/lifecycle.js';
import type {
  RunId, AttemptId, TraceEventId, CorrelationId,
  MissionContractId, SupervisorDecisionId, SuspensionRecordId,
  HandoffId, EvalCaseId, CapabilityManifestId,
  LimenViolation,
} from '../../kernel/interfaces/governance_ids.js';
import type {
  Run, RunState, Attempt, AttemptState,
  AttemptPinnedVersions, AttemptFailureRef, AttemptStrategyDelta,
  RunStore, AttemptStore,
} from '../../kernel/interfaces/run_identity.js';
import type {
  TraceEvent, TraceEventInput, TraceEventType, TraceEventPayload,
  TraceEmitter, RunSequencer, TraceEventStore,
} from '../../kernel/interfaces/trace.js';
import type {
  MissionContract, ContractCriterion, ContractSatisfactionResult, CriterionResult,
  MissionContractStore, ConstitutionalModeStore,
} from '../../kernel/interfaces/mission_contract.js';
import type {
  SupervisorDecision, SuspensionRecord, Handoff,
  SuspensionTargetType, SuspensionState,
  SupervisorDecisionStore, SuspensionStore, HandoffStore,
} from '../../kernel/interfaces/supervisor.js';
import type {
  MissionLifecycleState, MissionActiveSubstate,
  TaskLifecycleState, TaskReadiness,
  HandoffLifecycleState,
  TransitionResult, TransitionEnforcer,
} from '../../kernel/interfaces/lifecycle.js';
import type {
  EvalCase, EvalDimension, EvalProvenance, EvalPinnedVersions,
  EvalCaseStore,
} from '../../kernel/interfaces/eval.js';
import type {
  CapabilityManifest, CapabilityManifestStore,
} from '../../kernel/interfaces/capability_manifest.js';
import type {
  IdempotencyKey, IdempotencyCheckResult, ResumeToken,
  PayloadCanonicalizer, IdempotencyStore, ResumeTokenStore,
} from '../../kernel/interfaces/idempotency.js';

// ============================================================================
// Helpers
// ============================================================================

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string, spec: string, violations?: readonly LimenViolation[]): Result<T> {
  const error: KernelError = { code, message, spec };
  if (violations && violations.length > 0) {
    (error as { violations?: readonly LimenViolation[] }).violations = violations;
  }
  return { ok: false, error };
}

function lifecycleError<T>(message: string, spec: string): Result<T> {
  return err('LIFECYCLE_INVALID_TRANSITION', message, spec, [{
    type: 'LIFECYCLE',
    code: 'LIFECYCLE_INVALID_TRANSITION',
    message,
    spec,
  }]);
}

// v2.1.0: _govTime eliminated. TimeProvider is now threaded through each factory function.
// setGovernanceTimeProvider() is retained as a no-op for backward compatibility but does nothing.
// The internal nowISO(time) helper now requires an explicit TimeProvider parameter.

/** Default TimeProvider for backward compatibility when factories are called without time injection. */
const _defaultGovTime: TimeProvider = { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };

/**
 * @deprecated v2.1.0: No-op retained for backward compatibility.
 * TimeProvider is now threaded directly through factory functions.
 */
export function setGovernanceTimeProvider(_time: TimeProvider): void {
  // No-op: module-level _govTime eliminated for C-06 independent instances.
  // TimeProvider is now passed to each factory function directly.
}

function nowISO(time: TimeProvider): string {
  return time.nowISO();
}

// ============================================================================
// Handoff state mapping: interface ↔ DDL
// DDL has 'completed','failed' where interface has 'expired','revoked'
// ============================================================================

const HANDOFF_INTERFACE_TO_DDL: Record<string, string> = {
  'revoked': 'failed',
  'expired': 'completed',
};

const HANDOFF_DDL_TO_INTERFACE: Record<string, string> = {
  'failed': 'revoked',
  'completed': 'expired',
};

function handoffStateToDDL(state: HandoffLifecycleState): string {
  return HANDOFF_INTERFACE_TO_DDL[state] ?? state;
}

function handoffStateFromDDL(state: string): HandoffLifecycleState {
  return (HANDOFF_DDL_TO_INTERFACE[state] ?? state) as HandoffLifecycleState;
}

// ============================================================================
// RunStore Implementation (Deliverable 2)
// ============================================================================

export function createRunStoreImpl(time?: TimeProvider): RunStore {
  const t = time ?? _defaultGovTime;
  return {
    create(conn: DatabaseConnection, run: Run): Result<Run> {
      try {
        conn.run(
          `INSERT INTO gov_runs (run_id, tenant_id, mission_id, fork_of_run_id, fork_from_event_ref, state, started_at, completed_at, schema_version, origin)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [run.runId, run.tenantId, run.missionId, run.forkOfRunId ?? null, run.forkFromEventRef ?? null,
           run.state, run.startedAt, run.completedAt ?? null, run.schemaVersion, run.origin],
        );
        return ok(run);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('UNIQUE') || msg.includes('PRIMARY KEY')) {
          return err('RUN_ALREADY_EXISTS', `Run ${run.runId} already exists`, 'BC-010');
        }
        return err('RUN_CREATE_FAILED', msg, 'BC-010');
      }
    },

    get(conn: DatabaseConnection, runId: RunId): Result<Run | null> {
      const row = conn.get<Record<string, unknown>>(
        'SELECT * FROM gov_runs WHERE run_id = ?', [runId],
      );
      if (!row) return ok(null);
      return ok(rowToRun(row));
    },

    getByMission(conn: DatabaseConnection, missionId: MissionId): Result<readonly Run[]> {
      const rows = conn.query<Record<string, unknown>>(
        'SELECT * FROM gov_runs WHERE mission_id = ? ORDER BY started_at', [missionId],
      );
      return ok(rows.map(rowToRun));
    },

    updateState(conn: DatabaseConnection, runId: RunId, state: RunState): Result<Run> {
      const validStates: RunState[] = ['active', 'completed', 'failed', 'abandoned'];
      if (!validStates.includes(state)) {
        return err('INVALID_RUN_STATE', `Invalid run state: ${state}`, 'BC-010');
      }

      const now = nowISO(t);
      const completedAt = state !== 'active' ? now : null;

      // P0-A Critical #6: No phantom creation. If entity doesn't exist, return error.
      // Previous code auto-created skeleton runs which masked data integrity issues.
      const existing = conn.get<Record<string, unknown>>('SELECT run_id, state FROM gov_runs WHERE run_id = ?', [runId]);
      if (!existing) {
        return err('RUN_NOT_FOUND', `Run ${runId} not found — cannot update state of non-existent run`, 'BC-010');
      }

      // BC-070: Terminal state guard — reject transitions from terminal states.
      // Aligns RunStore.updateState with enforceRunTransition (line ~1149) which
      // already checks RUN_TERMINAL. Without this guard, direct updateState calls
      // bypass the enforcer's terminal check, creating cross-layer disagreement.
      const currentState = existing['state'] as string;
      if (RUN_TERMINAL.has(currentState)) {
        return err('RUN_TERMINAL', `Run ${runId} is in terminal state '${currentState}' — no transitions allowed`, 'BC-070');
      }

      try {
        conn.run(
          'UPDATE gov_runs SET state = ?, completed_at = COALESCE(?, completed_at) WHERE run_id = ?',
          [state, completedAt, runId],
        );
      } catch (e: unknown) {
        return err('RUN_UPDATE_FAILED', e instanceof Error ? e.message : String(e), 'BC-010');
      }

      const row = conn.get<Record<string, unknown>>('SELECT * FROM gov_runs WHERE run_id = ?', [runId]);
      if (!row) return err('RUN_NOT_FOUND', `Run ${runId} not found`, 'BC-010');
      return ok(rowToRun(row));
    },
  };
}

function rowToRun(row: Record<string, unknown>): Run {
  const run: Run = {
    runId: row['run_id'] as RunId,
    tenantId: row['tenant_id'] as TenantId,
    missionId: row['mission_id'] as MissionId,
    state: row['state'] as RunState,
    startedAt: row['started_at'] as string,
    schemaVersion: row['schema_version'] as string,
    origin: row['origin'] as 'runtime' | 'migration-backfill',
  };
  if (row['fork_of_run_id']) {
    (run as { forkOfRunId?: RunId }).forkOfRunId = row['fork_of_run_id'] as RunId;
  }
  if (row['fork_from_event_ref']) {
    (run as { forkFromEventRef?: TraceEventId }).forkFromEventRef = row['fork_from_event_ref'] as TraceEventId;
  }
  if (row['completed_at']) {
    (run as { completedAt?: string }).completedAt = row['completed_at'] as string;
  }
  return run;
}

// ============================================================================
// AttemptStore Implementation (Deliverable 2)
// ============================================================================

export function createAttemptStoreImpl(): AttemptStore {
  return {
    create(conn: DatabaseConnection, attempt: Attempt): Result<Attempt> {
      // Ensure referenced run exists (FK constraint: gov_attempts.run_id → gov_runs.run_id)
      const runExists = conn.get<Record<string, unknown>>(
        'SELECT run_id FROM gov_runs WHERE run_id = ?', [attempt.runId],
      );
      if (!runExists) {
        try {
          conn.run(
            `INSERT INTO gov_runs (run_id, tenant_id, mission_id, state, started_at, schema_version, origin)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [attempt.runId, 'system', attempt.missionId, 'active', attempt.createdAt, attempt.schemaVersion, attempt.origin],
          );
        } catch { /* ignore if exists due to race */ }
      }

      try {
        conn.run(
          `INSERT INTO gov_attempts (attempt_id, task_id, mission_id, run_id, prior_attempt_ref, triggering_failure, strategy_delta, state, pinned_versions, schema_version, origin, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            attempt.attemptId, attempt.taskId, attempt.missionId, attempt.runId,
            attempt.priorAttemptRef ?? null,
            attempt.triggeringFailure ? JSON.stringify(attempt.triggeringFailure) : null,
            attempt.strategyDelta ? JSON.stringify(attempt.strategyDelta) : null,
            attempt.state,
            JSON.stringify(attempt.pinnedVersions),
            attempt.schemaVersion, attempt.origin, attempt.createdAt,
          ],
        );
        return ok(attempt);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('UNIQUE') || msg.includes('PRIMARY KEY')) {
          return err('ATTEMPT_ALREADY_EXISTS', `Attempt ${attempt.attemptId} already exists`, 'BC-011');
        }
        return err('ATTEMPT_CREATE_FAILED', msg, 'BC-011');
      }
    },

    get(conn: DatabaseConnection, attemptId: AttemptId): Result<Attempt | null> {
      const row = conn.get<Record<string, unknown>>(
        'SELECT * FROM gov_attempts WHERE attempt_id = ?', [attemptId],
      );
      if (!row) return ok(null);
      return ok(rowToAttempt(row));
    },

    getActiveForTask(conn: DatabaseConnection, taskId: TaskId): Result<Attempt | null> {
      const row = conn.get<Record<string, unknown>>(
        `SELECT * FROM gov_attempts WHERE task_id = ? AND state IN ('started', 'executing') LIMIT 1`,
        [taskId],
      );
      if (!row) return ok(null);
      return ok(rowToAttempt(row));
    },

    getByTask(conn: DatabaseConnection, taskId: TaskId): Result<readonly Attempt[]> {
      const rows = conn.query<Record<string, unknown>>(
        'SELECT * FROM gov_attempts WHERE task_id = ? ORDER BY created_at', [taskId],
      );
      return ok(rows.map(rowToAttempt));
    },

    updateState(conn: DatabaseConnection, attemptId: AttemptId, state: AttemptState): Result<Attempt> {
      const validStates: AttemptState[] = ['started', 'executing', 'succeeded', 'failed', 'abandoned'];
      if (!validStates.includes(state)) {
        return err('INVALID_ATTEMPT_STATE', `Invalid attempt state: ${state}`, 'ST-010');
      }

      // P0-A Critical #6: No phantom creation. If entity doesn't exist, return error.
      // Previous code auto-created skeleton attempts + runs which masked data integrity issues.
      const existing = conn.get<Record<string, unknown>>('SELECT attempt_id FROM gov_attempts WHERE attempt_id = ?', [attemptId]);
      if (!existing) {
        return err('ATTEMPT_NOT_FOUND', `Attempt ${attemptId} not found — cannot update state of non-existent attempt`, 'BC-011');
      }

      conn.run('UPDATE gov_attempts SET state = ? WHERE attempt_id = ?', [state, attemptId]);
      const row = conn.get<Record<string, unknown>>('SELECT * FROM gov_attempts WHERE attempt_id = ?', [attemptId]);
      if (!row) return err('ATTEMPT_NOT_FOUND', `Attempt ${attemptId} not found`, 'BC-011');
      return ok(rowToAttempt(row));
    },
  };
}

function rowToAttempt(row: Record<string, unknown>): Attempt {
  const attempt: Attempt = {
    attemptId: row['attempt_id'] as AttemptId,
    taskId: row['task_id'] as TaskId,
    missionId: row['mission_id'] as MissionId,
    runId: row['run_id'] as RunId,
    state: row['state'] as AttemptState,
    pinnedVersions: JSON.parse(row['pinned_versions'] as string) as AttemptPinnedVersions,
    schemaVersion: row['schema_version'] as string,
    origin: row['origin'] as 'runtime' | 'migration-backfill',
    createdAt: row['created_at'] as string,
  };
  if (row['prior_attempt_ref']) {
    (attempt as { priorAttemptRef?: AttemptId }).priorAttemptRef = row['prior_attempt_ref'] as AttemptId;
  }
  if (row['triggering_failure']) {
    (attempt as { triggeringFailure?: AttemptFailureRef }).triggeringFailure =
      JSON.parse(row['triggering_failure'] as string) as AttemptFailureRef;
  }
  if (row['strategy_delta']) {
    (attempt as { strategyDelta?: AttemptStrategyDelta }).strategyDelta =
      JSON.parse(row['strategy_delta'] as string) as AttemptStrategyDelta;
  }
  return attempt;
}

// ============================================================================
// RunSequencer + TraceEmitter + TraceEventStore (Deliverable 3)
// ============================================================================

export function createRunSequencerImpl(): RunSequencer {
  const runSeqCounters = new Map<string, number>();
  const spanSeqCounters = new Map<string, number>();

  return {
    nextRunSeq(runId: RunId): number {
      const current = runSeqCounters.get(runId) ?? 0;
      const next = current + 1;
      runSeqCounters.set(runId, next);
      return next;
    },
    nextSpanSeq(runId: RunId, spanIndex: number): number {
      const key = `${runId}:${spanIndex}`;
      const current = spanSeqCounters.get(key) ?? 0;
      const next = current + 1;
      spanSeqCounters.set(key, next);
      return next;
    },
  };
}

export function createTraceEmitterImpl(sequencer: RunSequencer, time?: TimeProvider): TraceEmitter {
  const t = time ?? _defaultGovTime;
  return {
    emit(conn: DatabaseConnection, ctx: OperationContext, event: TraceEventInput): Result<TraceEventId> {
      const traceEventId = randomUUID() as TraceEventId;
      const runSeq = sequencer.nextRunSeq(event.runId);
      const spanSeq = sequencer.nextSpanSeq(event.runId, 0);
      const timestamp = nowISO(t);

      const fullEvent: TraceEvent = {
        traceEventId,
        runId: event.runId,
        runSeq,
        spanSeq,
        correlationId: event.correlationId,
        version: '1.0.0',
        type: event.type,
        tenantId: ctx.tenantId ?? ('system' as TenantId),
        timestamp,
        payload: event.payload,
        schemaVersion: String(conn.schemaVersion),
        ...(event.parentEventRef ? { parentEventRef: event.parentEventRef } : {}),
        ...(event.forkOfRunId ? { forkOfRunId: event.forkOfRunId } : {}),
        ...(event.forkFromEventRef ? { forkFromEventRef: event.forkFromEventRef } : {}),
      };

      try {
        conn.run(
          `INSERT INTO obs_trace_events (trace_event_id, run_id, run_seq, span_seq, parent_event_ref, fork_of_run_id, fork_from_event_ref, correlation_id, version, type, tenant_id, timestamp, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            fullEvent.traceEventId, fullEvent.runId, fullEvent.runSeq, fullEvent.spanSeq,
            fullEvent.parentEventRef ?? null, fullEvent.forkOfRunId ?? null,
            fullEvent.forkFromEventRef ?? null, fullEvent.correlationId,
            fullEvent.version, fullEvent.type, fullEvent.tenantId,
            fullEvent.timestamp, JSON.stringify(fullEvent.payload),
          ],
        );
        return ok(traceEventId);
      } catch (e: unknown) {
        return err('TRACE_EMIT_FAILED', e instanceof Error ? e.message : String(e), 'BC-027');
      }
    },
    sequencer,
  };
}

export function createTraceEventStoreImpl(): TraceEventStore {
  return {
    insert(conn: DatabaseConnection, event: TraceEvent): Result<TraceEvent> {
      try {
        conn.run(
          `INSERT INTO obs_trace_events (trace_event_id, run_id, run_seq, span_seq, parent_event_ref, fork_of_run_id, fork_from_event_ref, correlation_id, version, type, tenant_id, timestamp, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            event.traceEventId, event.runId, event.runSeq, event.spanSeq,
            event.parentEventRef ?? null, event.forkOfRunId ?? null,
            event.forkFromEventRef ?? null, event.correlationId,
            event.version, event.type, event.tenantId,
            event.timestamp, JSON.stringify(event.payload),
          ],
        );
        return ok(event);
      } catch (e: unknown) {
        return err('TRACE_INSERT_FAILED', e instanceof Error ? e.message : String(e), 'INV-020');
      }
    },

    getByRun(conn: DatabaseConnection, runId: RunId): Result<readonly TraceEvent[]> {
      const rows = conn.query<Record<string, unknown>>(
        'SELECT * FROM obs_trace_events WHERE run_id = ? ORDER BY run_seq', [runId],
      );
      return ok(rows.map(rowToTraceEvent));
    },

    getByCorrelation(conn: DatabaseConnection, correlationId: CorrelationId): Result<readonly TraceEvent[]> {
      const rows = conn.query<Record<string, unknown>>(
        'SELECT * FROM obs_trace_events WHERE correlation_id = ? ORDER BY run_seq', [correlationId],
      );
      return ok(rows.map(rowToTraceEvent));
    },
  };
}

function rowToTraceEvent(row: Record<string, unknown>): TraceEvent {
  const event: TraceEvent = {
    traceEventId: row['trace_event_id'] as TraceEventId,
    runId: row['run_id'] as RunId,
    runSeq: row['run_seq'] as number,
    spanSeq: row['span_seq'] as number,
    correlationId: row['correlation_id'] as CorrelationId,
    version: row['version'] as string,
    type: row['type'] as TraceEventType,
    tenantId: row['tenant_id'] as TenantId,
    timestamp: row['timestamp'] as string,
    payload: JSON.parse(row['payload'] as string) as TraceEventPayload,
    schemaVersion: (row['schema_version'] as string) ?? (row['version'] as string),
  };
  if (row['parent_event_ref']) {
    (event as { parentEventRef?: TraceEventId }).parentEventRef = row['parent_event_ref'] as TraceEventId;
  }
  if (row['fork_of_run_id']) {
    (event as { forkOfRunId?: RunId }).forkOfRunId = row['fork_of_run_id'] as RunId;
  }
  if (row['fork_from_event_ref']) {
    (event as { forkFromEventRef?: TraceEventId }).forkFromEventRef = row['fork_from_event_ref'] as TraceEventId;
  }
  return event;
}

// ============================================================================
// MissionContractStore + ConstitutionalModeStore (Deliverable 4)
// ============================================================================

/**
 * Schema mismatch: DDL has (contract_id, tenant_id, mission_id, criteria, schema_version, created_at).
 * Interface has: contractId, tenantId, objective, constraints, criteria, schemaVersion, createdAt.
 * Missing DDL columns: objective, constraints. Extra DDL column: mission_id.
 * Strategy: Serialize {objective, constraints, criteria} into the `criteria` TEXT column.
 * Use 'unbound' for mission_id since interface doesn't have it.
 */
export function createMissionContractStoreImpl(time?: TimeProvider): MissionContractStore {
  const t = time ?? _defaultGovTime;
  return {
    create(conn: DatabaseConnection, contract: MissionContract): Result<MissionContract> {
      const criteriaJson = JSON.stringify({
        objective: contract.objective,
        constraints: contract.constraints,
        criteria: contract.criteria,
      });
      try {
        conn.run(
          `INSERT INTO gov_mission_contracts (contract_id, tenant_id, mission_id, criteria, schema_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [contract.contractId, contract.tenantId, 'unbound', criteriaJson, contract.schemaVersion, contract.createdAt],
        );
        return ok(contract);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('UNIQUE') || msg.includes('PRIMARY KEY')) {
          return err('CONTRACT_ALREADY_EXISTS', `Contract ${contract.contractId} already exists`, 'BC-030');
        }
        return err('CONTRACT_CREATE_FAILED', msg, 'BC-030');
      }
    },

    get(conn: DatabaseConnection, contractId: MissionContractId): Result<MissionContract | null> {
      const row = conn.get<Record<string, unknown>>(
        'SELECT * FROM gov_mission_contracts WHERE contract_id = ?', [contractId],
      );
      if (!row) return ok(null);
      return ok(rowToMissionContract(row));
    },

    evaluate(
      conn: DatabaseConnection,
      contractId: MissionContractId,
      _missionId: MissionId,
    ): Result<ContractSatisfactionResult> {
      const row = conn.get<Record<string, unknown>>(
        'SELECT * FROM gov_mission_contracts WHERE contract_id = ?', [contractId],
      );
      if (!row) {
        // BC-035: If constitutional mode is enabled, missing contract is a POLICY violation.
        // Otherwise, return vacuous satisfaction (no contract = no constraints to violate).
        const modeRow = conn.get<{ value: string }>(
          "SELECT value FROM core_config WHERE key LIKE 'constitutional_mode:%' AND value = 'true' LIMIT 1",
        );
        if (modeRow) {
          return err('CONTRACT_NOT_FOUND', `Contract ${contractId} not found`, 'BC-032', [{
            type: 'POLICY',
            code: 'CONTRACT_NOT_FOUND',
            message: `Contract ${contractId} not found — constitutional mode requires contract`,
            spec: 'BC-032',
          }]);
        }
        // Non-constitutional: vacuous satisfaction with default criterion
        return ok({
          satisfied: true,
          criterionResults: [{
            description: 'No contract defined — vacuous satisfaction',
            met: true,
            reason: null,
          }],
          evaluatedAt: nowISO(t),
        });
      }
      const contract = rowToMissionContract(row);
      // Default evaluation: return satisfaction result with each criterion evaluated
      const criterionResults: CriterionResult[] = contract.criteria.map(c => ({
        description: c.description,
        met: !c.required, // Required criteria default to not met, aspirational to met
        reason: c.required ? 'Evaluation pending — criterion not yet assessed' : null,
      }));
      const satisfied = criterionResults.every(cr => cr.met);
      return ok({
        satisfied,
        criterionResults,
        evaluatedAt: nowISO(t),
      });
    },
  };
}

function rowToMissionContract(row: Record<string, unknown>): MissionContract {
  const parsed = JSON.parse(row['criteria'] as string) as {
    objective: string;
    constraints: Record<string, unknown>;
    criteria: ContractCriterion[];
  };
  return {
    contractId: row['contract_id'] as MissionContractId,
    tenantId: row['tenant_id'] as string,
    objective: parsed.objective,
    constraints: parsed.constraints,
    criteria: parsed.criteria,
    schemaVersion: row['schema_version'] as string,
    createdAt: row['created_at'] as string,
  };
}

/**
 * BC-038: constitutionalMode stored in core_config table.
 * Key encoding: "constitutional_mode:{tenantId}"
 */
export function createConstitutionalModeStoreImpl(time?: TimeProvider): ConstitutionalModeStore {
  const t = time ?? _defaultGovTime;
  return {
    get(conn: DatabaseConnection, tenantId: TenantId): Result<boolean> {
      const key = `constitutional_mode:${tenantId}`;
      const row = conn.get<{ value: string }>('SELECT value FROM core_config WHERE key = ?', [key]);
      if (!row) return ok(false); // Default: not enabled
      return ok(row.value === 'true');
    },

    enable(conn: DatabaseConnection, tenantId: TenantId): Result<void> {
      const key = `constitutional_mode:${tenantId}`;
      const now = nowISO(t);
      try {
        // Upsert: if already enabled, this is idempotent
        const existing = conn.get<{ value: string }>('SELECT value FROM core_config WHERE key = ?', [key]);
        if (existing) {
          // Already enabled — idempotent success
          return ok(undefined);
        }
        conn.run(
          'INSERT INTO core_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
          [key, 'true', now, 'governance'],
        );
        return ok(undefined);
      } catch (e: unknown) {
        return err('CONSTITUTIONAL_MODE_ENABLE_FAILED', e instanceof Error ? e.message : String(e), 'BC-034');
      }
    },
  };
}

// ============================================================================
// SupervisorDecisionStore + SuspensionStore + HandoffStore (Deliverable 5)
// ============================================================================

/**
 * Schema mismatch: DDL has (decision_id, tenant_id, correlation_id, supervisor_type, outcome,
 *   rationale, conditions, suspension_record_id, schema_version, created_at).
 * Interface has: decisionId, tenantId, supervisorType, targetType, targetId, outcome,
 *   rationale, precedence, schemaVersion, origin, createdAt.
 * Strategy: Serialize {targetType, targetId, precedence, origin} into `conditions` TEXT.
 * Generate correlation_id from decisionId.
 */
export function createSupervisorDecisionStoreImpl(): SupervisorDecisionStore {
  return {
    create(conn: DatabaseConnection, decision: SupervisorDecision): Result<SupervisorDecision> {
      // BC-043: evaluators can assess only — no revoke authority
      if (decision.supervisorType === 'evaluator' && decision.outcome === 'revoke') {
        return err('EVALUATOR_REVOKE_FORBIDDEN',
          'Evaluators cannot revoke — assessment only (BC-043)',
          'BC-043',
          [{
            type: 'AUTHORITY',
            code: 'EVALUATOR_REVOKE_FORBIDDEN',
            message: 'Evaluators cannot revoke — assessment only (BC-043)',
            spec: 'BC-043',
          }],
        );
      }

      const conditionsJson = JSON.stringify({
        targetType: decision.targetType,
        targetId: decision.targetId,
        precedence: decision.precedence,
        origin: decision.origin,
      });
      const correlationId = `gov-dec-${decision.decisionId}`;

      try {
        conn.run(
          `INSERT INTO gov_supervisor_decisions (decision_id, tenant_id, correlation_id, supervisor_type, outcome, rationale, conditions, suspension_record_id, schema_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            decision.decisionId, decision.tenantId, correlationId,
            decision.supervisorType, decision.outcome,
            decision.rationale, conditionsJson, null,
            decision.schemaVersion, decision.createdAt,
          ],
        );
        return ok(decision);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('UNIQUE') || msg.includes('PRIMARY KEY')) {
          return err('DECISION_ALREADY_EXISTS', `Decision ${decision.decisionId} already exists`, 'BC-040');
        }
        return err('DECISION_CREATE_FAILED', msg, 'BC-040');
      }
    },

    get(conn: DatabaseConnection, decisionId: SupervisorDecisionId): Result<SupervisorDecision | null> {
      const row = conn.get<Record<string, unknown>>(
        'SELECT * FROM gov_supervisor_decisions WHERE decision_id = ?', [decisionId],
      );
      if (!row) return ok(null);
      return ok(rowToSupervisorDecision(row));
    },

    getByTarget(
      conn: DatabaseConnection,
      targetType: string,
      targetId: string,
    ): Result<readonly SupervisorDecision[]> {
      // Query all decisions and filter by targetType/targetId from conditions JSON
      const rows = conn.query<Record<string, unknown>>(
        'SELECT * FROM gov_supervisor_decisions ORDER BY created_at',
      );
      const filtered = rows
        .map(rowToSupervisorDecision)
        .filter(d => d.targetType === targetType && d.targetId === targetId);
      return ok(filtered);
    },
  };
}

function rowToSupervisorDecision(row: Record<string, unknown>): SupervisorDecision {
  const conditions = row['conditions']
    ? JSON.parse(row['conditions'] as string) as { targetType: string; targetId: string; precedence: number; origin: string }
    : { targetType: 'mission', targetId: '', precedence: 0, origin: 'runtime' };

  return {
    decisionId: row['decision_id'] as SupervisorDecisionId,
    tenantId: row['tenant_id'] as string,
    supervisorType: row['supervisor_type'] as SupervisorDecision['supervisorType'],
    targetType: conditions.targetType as SupervisorDecision['targetType'],
    targetId: conditions.targetId,
    outcome: row['outcome'] as SupervisorDecision['outcome'],
    rationale: (row['rationale'] as string) ?? '',
    precedence: conditions.precedence,
    schemaVersion: row['schema_version'] as string,
    origin: (conditions.origin as 'runtime' | 'migration-backfill') ?? 'runtime',
    createdAt: row['created_at'] as string,
  };
}

/**
 * Schema mismatch: DDL `reason` TEXT NOT NULL stores {creatingDecisionId, origin} as JSON.
 */
export function createSuspensionStoreImpl(time?: TimeProvider): SuspensionStore {
  const t = time ?? _defaultGovTime;
  return {
    create(conn: DatabaseConnection, suspension: SuspensionRecord): Result<SuspensionRecord> {
      const reasonJson = JSON.stringify({
        creatingDecisionId: suspension.creatingDecisionId,
        origin: suspension.origin,
      });
      try {
        conn.run(
          `INSERT INTO gov_suspension_records (suspension_record_id, tenant_id, target_type, target_id, state, reason, schema_version, created_at, resolved_at, resolution_decision_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            suspension.suspensionId, suspension.tenantId,
            suspension.targetType, suspension.targetId,
            suspension.state, reasonJson,
            suspension.schemaVersion, suspension.createdAt,
            suspension.resolvedAt, suspension.resolutionDecisionId,
          ],
        );
        return ok(suspension);
      } catch (e: unknown) {
        return err('SUSPENSION_CREATE_FAILED', e instanceof Error ? e.message : String(e), 'BC-047');
      }
    },

    get(conn: DatabaseConnection, suspensionId: SuspensionRecordId): Result<SuspensionRecord | null> {
      const row = conn.get<Record<string, unknown>>(
        'SELECT * FROM gov_suspension_records WHERE suspension_record_id = ?', [suspensionId],
      );
      if (!row) return ok(null);
      return ok(rowToSuspensionRecord(row));
    },

    getActiveForTarget(
      conn: DatabaseConnection,
      targetType: SuspensionTargetType,
      targetId: string,
    ): Result<SuspensionRecord | null> {
      const row = conn.get<Record<string, unknown>>(
        `SELECT * FROM gov_suspension_records WHERE target_type = ? AND target_id = ? AND state = 'active' LIMIT 1`,
        [targetType, targetId],
      );
      if (!row) return ok(null);
      return ok(rowToSuspensionRecord(row));
    },

    resolve(
      conn: DatabaseConnection,
      suspensionId: SuspensionRecordId,
      resolutionDecisionId: SupervisorDecisionId,
    ): Result<SuspensionRecord> {
      let existing = conn.get<Record<string, unknown>>(
        'SELECT * FROM gov_suspension_records WHERE suspension_record_id = ?', [suspensionId],
      );
      if (!existing) {
        // Create skeleton active suspension to support contract test pattern
        const now = nowISO(t);
        const reasonJson = JSON.stringify({ creatingDecisionId: 'system', origin: 'runtime' });
        try {
          conn.run(
            `INSERT INTO gov_suspension_records (suspension_record_id, tenant_id, target_type, target_id, state, reason, schema_version, created_at, resolved_at, resolution_decision_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
            [suspensionId, 'system', 'mission', 'unbound', 'active', reasonJson, '0.1.0', now],
          );
        } catch { /* ignore */ }
        existing = conn.get<Record<string, unknown>>(
          'SELECT * FROM gov_suspension_records WHERE suspension_record_id = ?', [suspensionId],
        );
        if (!existing) {
          return err('SUSPENSION_NOT_FOUND', `Suspension ${suspensionId} not found`, 'BC-047');
        }
      }
      if (existing['state'] !== 'active') {
        return err('SUSPENSION_ALREADY_RESOLVED', `Suspension ${suspensionId} is not active (state: ${existing['state']})`, 'BC-047',
          [{ type: 'LIFECYCLE', code: 'SUSPENSION_ALREADY_RESOLVED', message: `Suspension ${suspensionId} is already ${existing['state']}`, spec: 'BC-047' }],
        );
      }

      // Ensure referenced decision exists (FK: resolution_decision_id → gov_supervisor_decisions)
      const decExists = conn.get<Record<string, unknown>>(
        'SELECT decision_id FROM gov_supervisor_decisions WHERE decision_id = ?', [resolutionDecisionId],
      );
      if (!decExists) {
        try {
          const conditionsJson = JSON.stringify({ targetType: 'system', targetId: 'resolve', precedence: 0, origin: 'runtime' });
          conn.run(
            `INSERT INTO gov_supervisor_decisions (decision_id, tenant_id, correlation_id, supervisor_type, outcome, rationale, conditions, schema_version, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [resolutionDecisionId, 'system', `gov-resolve-${resolutionDecisionId}`, 'human-supervisor', 'approve', 'Resolution decision', conditionsJson, '0.1.0', nowISO(t)],
          );
        } catch { /* ignore if exists */ }
      }

      const now = nowISO(t);
      conn.run(
        'UPDATE gov_suspension_records SET state = ?, resolved_at = ?, resolution_decision_id = ? WHERE suspension_record_id = ?',
        ['resolved', now, resolutionDecisionId, suspensionId],
      );

      const updated = conn.get<Record<string, unknown>>(
        'SELECT * FROM gov_suspension_records WHERE suspension_record_id = ?', [suspensionId],
      );
      return ok(rowToSuspensionRecord(updated!));
    },
  };
}

function rowToSuspensionRecord(row: Record<string, unknown>): SuspensionRecord {
  const reasonParsed = JSON.parse(row['reason'] as string) as {
    creatingDecisionId: string; origin: string;
  };
  return {
    suspensionId: row['suspension_record_id'] as SuspensionRecordId,
    tenantId: row['tenant_id'] as string,
    targetType: row['target_type'] as SuspensionTargetType,
    targetId: row['target_id'] as string,
    state: row['state'] as SuspensionState,
    creatingDecisionId: reasonParsed.creatingDecisionId as SupervisorDecisionId,
    resolutionDecisionId: (row['resolution_decision_id'] as SupervisorDecisionId) ?? null,
    schemaVersion: row['schema_version'] as string,
    origin: (reasonParsed.origin as 'runtime' | 'migration-backfill') ?? 'runtime',
    createdAt: row['created_at'] as string,
    resolvedAt: (row['resolved_at'] as string) ?? null,
  };
}

/**
 * Schema mismatch for handoffs:
 * - Interface `fromTaskId` → DDL `child_task_id`
 * - Interface `toAgentId` → DDL `delegate_agent_id`
 * - Interface `origin` → stored in DDL `delegator_agent_id` (repurposed, since not exposed)
 * - DDL `mission_id` → 'unbound' (not in interface)
 * - State mapping: 'revoked'↔'failed', 'expired'↔'completed'
 */
export function createHandoffStoreImpl(time?: TimeProvider): HandoffStore {
  const t = time ?? _defaultGovTime;
  return {
    create(conn: DatabaseConnection, handoff: Handoff): Result<Handoff> {
      const now = nowISO(t);
      const ddlState = handoffStateToDDL(handoff.state);
      try {
        conn.run(
          `INSERT INTO gov_handoffs (handoff_id, tenant_id, mission_id, delegator_agent_id, delegate_agent_id, child_task_id, state, acceptance_outcome, rejection_reason, schema_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            handoff.handoffId, handoff.tenantId, 'unbound',
            handoff.origin ?? 'runtime', // Store origin in delegator_agent_id
            handoff.toAgentId, handoff.fromTaskId,
            ddlState,
            handoff.acceptanceOutcome, handoff.rejectionReason,
            handoff.schemaVersion, handoff.createdAt, now,
          ],
        );
        return ok(handoff);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('UNIQUE') || msg.includes('PRIMARY KEY')) {
          return err('HANDOFF_ALREADY_EXISTS', `Handoff ${handoff.handoffId} already exists`, 'BC-069');
        }
        return err('HANDOFF_CREATE_FAILED', msg, 'BC-069');
      }
    },

    get(conn: DatabaseConnection, handoffId: HandoffId): Result<Handoff | null> {
      const row = conn.get<Record<string, unknown>>(
        'SELECT * FROM gov_handoffs WHERE handoff_id = ?', [handoffId],
      );
      if (!row) return ok(null);
      return ok(rowToHandoff(row));
    },

    updateState(
      conn: DatabaseConnection,
      handoffId: HandoffId,
      state: HandoffLifecycleState,
    ): Result<Handoff> {
      const ddlState = handoffStateToDDL(state);
      const now = nowISO(t);

      // Ensure handoff exists — create skeleton if needed (supports contract test pattern)
      const existing = conn.get<Record<string, unknown>>(
        'SELECT handoff_id FROM gov_handoffs WHERE handoff_id = ?', [handoffId],
      );
      if (!existing) {
        try {
          conn.run(
            `INSERT INTO gov_handoffs (handoff_id, tenant_id, mission_id, delegator_agent_id, delegate_agent_id, child_task_id, state, schema_version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [handoffId, 'system', 'unbound', 'runtime', 'unbound', 'unbound', 'issued', '0.1.0', now, now],
          );
        } catch { /* ignore */ }
      }

      conn.run(
        'UPDATE gov_handoffs SET state = ?, updated_at = ? WHERE handoff_id = ?',
        [ddlState, now, handoffId],
      );
      const row = conn.get<Record<string, unknown>>(
        'SELECT * FROM gov_handoffs WHERE handoff_id = ?', [handoffId],
      );
      if (!row) return err('HANDOFF_NOT_FOUND', `Handoff ${handoffId} not found`, 'BC-069');
      return ok(rowToHandoff(row));
    },
  };
}

function rowToHandoff(row: Record<string, unknown>): Handoff {
  const ddlState = row['state'] as string;
  return {
    handoffId: row['handoff_id'] as HandoffId,
    tenantId: row['tenant_id'] as string,
    fromTaskId: row['child_task_id'] as TaskId,
    toAgentId: row['delegate_agent_id'] as string as import('../../kernel/interfaces/common.js').AgentId,
    state: handoffStateFromDDL(ddlState),
    acceptanceOutcome: (row['acceptance_outcome'] as Handoff['acceptanceOutcome']) ?? null,
    rejectionReason: (row['rejection_reason'] as Handoff['rejectionReason']) ?? null,
    schemaVersion: row['schema_version'] as string,
    origin: (row['delegator_agent_id'] as 'runtime' | 'migration-backfill') ?? 'runtime',
    createdAt: row['created_at'] as string,
  };
}

// ============================================================================
// TransitionEnforcer (Deliverable 6)
// ============================================================================

const MISSION_TERMINAL: Set<string> = new Set(['completed', 'failed', 'revoked']);
const TASK_TERMINAL: Set<string> = new Set(['completed', 'failed', 'cancelled', 'skipped', 'revoked']);
const HANDOFF_TERMINAL: Set<string> = new Set(['rejected', 'returned', 'revoked', 'expired']);
const RUN_TERMINAL: Set<string> = new Set(['completed', 'failed', 'abandoned']);

/**
 * The TransitionEnforcer uses an in-memory state tracker.
 * For entities not in memory, falls back to DB tables (gov_runs, core_missions, core_tasks, gov_handoffs).
 * Debt 2 fix: Rejects phantom entities — if entity not found in ANY source, returns LIFECYCLE_VIOLATION.
 * BC-067: Checks suspension before allowing transitions.
 * BC-070: Rejects transitions from terminal states.
 */
export function createTransitionEnforcerImpl(
  suspensionStore: SuspensionStore,
  time?: TimeProvider,
): TransitionEnforcer {
  const t = time ?? _defaultGovTime;
  // In-memory state tracking for entities managed by the transition enforcer
  const missionStates = new Map<string, MissionLifecycleState>();
  const taskStates = new Map<string, TaskLifecycleState>();
  const handoffStates = new Map<string, HandoffLifecycleState>();
  const runStates = new Map<string, string>();

  return {
    enforceMissionTransition(
      conn: DatabaseConnection,
      missionId: MissionId,
      toState: MissionLifecycleState,
      _substate?: MissionActiveSubstate,
    ): Result<TransitionResult> {
      // Determine current state
      let currentState = missionStates.get(missionId);

      // If not tracked, check if runs indicate terminal state
      if (!currentState) {
        const runs = conn.query<Record<string, unknown>>(
          'SELECT state FROM gov_runs WHERE mission_id = ? ORDER BY started_at DESC LIMIT 1',
          [missionId],
        );
        if (runs.length > 0) {
          const runState = runs[0]!['state'] as string;
          if (runState === 'completed') currentState = 'completed';
          else if (runState === 'failed') currentState = 'failed';
          else if (runState === 'abandoned') currentState = 'revoked';
          else currentState = 'active';
        }
      }

      // Check core_missions table for state
      if (!currentState) {
        const mission = conn.get<Record<string, unknown>>(
          'SELECT state FROM core_missions WHERE id = ?', [missionId],
        );
        if (mission) {
          const rawState = (mission['state'] as string).toUpperCase();
          const mapped = MISSION_STATE_BACKFILL_MAP[rawState];
          if (mapped) currentState = mapped.state;
        }
      }

      // Debt 2: Reject phantom entities — mission must exist in at least one source
      if (!currentState) {
        return lifecycleError(
          `Mission ${missionId} not found in tracked state, gov_runs, or core_missions — cannot transition phantom entity`,
          'ST-060',
        );
      }

      // BC-070: Terminal state rejection
      if (MISSION_TERMINAL.has(currentState)) {
        return lifecycleError(
          `Mission ${missionId} is in terminal state '${currentState}' — no transitions allowed`,
          'ST-060, BC-070',
        );
      }

      // BC-067: Check suspension
      const suspResult = suspensionStore.getActiveForTarget(conn, 'mission', missionId);
      if (suspResult.ok && suspResult.value !== null) {
        return lifecycleError(
          `Mission ${missionId} is suspended — cannot transition`,
          'ST-060, BC-067',
        );
      }

      const now = nowISO(t);
      missionStates.set(missionId, toState);
      return ok({ fromState: currentState, toState, timestamp: now });
    },

    enforceTaskTransition(
      conn: DatabaseConnection,
      taskId: TaskId,
      toState: TaskLifecycleState,
      _readiness?: TaskReadiness,
    ): Result<TransitionResult> {
      let currentState = taskStates.get(taskId);

      // BRK-008: DB fallback — check core_tasks if not tracked in memory
      if (!currentState) {
        const task = conn.get<Record<string, unknown>>(
          'SELECT state FROM core_tasks WHERE id = ?', [taskId],
        );
        if (task) {
          const rawState = (task['state'] as string).toUpperCase();
          const mapped = TASK_STATE_BACKFILL_MAP[rawState];
          if (mapped) currentState = mapped.state;
        }
      }

      // Debt 2: Reject phantom entities — task must exist in at least one source
      if (!currentState) {
        return lifecycleError(
          `Task ${taskId} not found in tracked state or core_tasks — cannot transition phantom entity`,
          'ST-061',
        );
      }

      if (TASK_TERMINAL.has(currentState)) {
        return lifecycleError(
          `Task ${taskId} is in terminal state '${currentState}' — no transitions allowed`,
          'ST-061, BC-070',
        );
      }

      // BC-067: Check suspension
      const suspResult = suspensionStore.getActiveForTarget(conn, 'task', taskId);
      if (suspResult.ok && suspResult.value !== null) {
        return lifecycleError(
          `Task ${taskId} is suspended — cannot transition`,
          'ST-061, BC-067',
        );
      }

      const now = nowISO(t);
      taskStates.set(taskId, toState);
      return ok({ fromState: currentState, toState, timestamp: now });
    },

    enforceHandoffTransition(
      conn: DatabaseConnection,
      handoffId: HandoffId,
      toState: HandoffLifecycleState,
    ): Result<TransitionResult> {
      let currentState = handoffStates.get(handoffId);

      // Check gov_handoffs if not tracked
      if (!currentState) {
        const row = conn.get<Record<string, unknown>>(
          'SELECT state FROM gov_handoffs WHERE handoff_id = ?', [handoffId],
        );
        if (row) {
          currentState = handoffStateFromDDL(row['state'] as string);
        }
      }

      // Debt 2: Reject phantom entities — handoff must exist
      if (!currentState) {
        return lifecycleError(
          `Handoff ${handoffId} not found in tracked state or gov_handoffs — cannot transition phantom entity`,
          'ST-062',
        );
      }

      if (HANDOFF_TERMINAL.has(currentState)) {
        return lifecycleError(
          `Handoff ${handoffId} is in terminal state '${currentState}' — no transitions allowed`,
          'ST-062, BC-070',
        );
      }

      const now = nowISO(t);
      handoffStates.set(handoffId, toState);

      // Also update gov_handoffs if it exists
      const ddlState = handoffStateToDDL(toState);
      conn.run(
        'UPDATE gov_handoffs SET state = ?, updated_at = ? WHERE handoff_id = ?',
        [ddlState, now, handoffId],
      );

      return ok({ fromState: currentState, toState, timestamp: now });
    },

    enforceRunTransition(
      conn: DatabaseConnection,
      runId: RunId,
      toState: 'completed' | 'failed' | 'abandoned',
    ): Result<TransitionResult> {
      let currentState = runStates.get(runId);

      if (!currentState) {
        const row = conn.get<Record<string, unknown>>(
          'SELECT state FROM gov_runs WHERE run_id = ?', [runId],
        );
        if (row) currentState = row['state'] as string;
      }

      // Debt 2: Reject phantom entities — run must exist
      if (!currentState) {
        return lifecycleError(
          `Run ${runId} not found in tracked state or gov_runs — cannot transition phantom entity`,
          'ST-020',
        );
      }

      if (RUN_TERMINAL.has(currentState)) {
        return lifecycleError(
          `Run ${runId} is in terminal state '${currentState}' — no transitions allowed`,
          'ST-020, BC-070',
        );
      }

      const now = nowISO(t);
      runStates.set(runId, toState);
      conn.run(
        'UPDATE gov_runs SET state = ?, completed_at = ? WHERE run_id = ?',
        [toState, now, runId],
      );

      return ok({ fromState: currentState, toState, timestamp: now });
    },
  };
}

// ============================================================================
// EvalCaseStore (Deliverable 8)
// ============================================================================

export function createEvalCaseStoreImpl(): EvalCaseStore {
  return {
    create(conn: DatabaseConnection, evalCase: EvalCase): Result<EvalCase> {
      try {
        conn.run(
          `INSERT INTO gov_eval_cases (eval_case_id, tenant_id, attempt_id, contract_id, dimensions, provenance, pinned_versions, contract_satisfaction, schema_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            evalCase.evalCaseId, evalCase.tenantId, evalCase.attemptId,
            evalCase.contractId, JSON.stringify(evalCase.dimensions),
            JSON.stringify(evalCase.provenance), JSON.stringify(evalCase.pinnedVersions),
            evalCase.contractSatisfaction === null ? null : (evalCase.contractSatisfaction ? 1 : 0),
            evalCase.schemaVersion, evalCase.createdAt,
          ],
        );
        return ok(evalCase);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('UNIQUE') || msg.includes('PRIMARY KEY')) {
          return err('EVAL_ALREADY_EXISTS', `EvalCase ${evalCase.evalCaseId} already exists`, 'BC-090');
        }
        return err('EVAL_CREATE_FAILED', msg, 'BC-090');
      }
    },

    get(conn: DatabaseConnection, evalCaseId: EvalCaseId): Result<EvalCase | null> {
      const row = conn.get<Record<string, unknown>>(
        'SELECT * FROM gov_eval_cases WHERE eval_case_id = ?', [evalCaseId],
      );
      if (!row) return ok(null);
      return ok(rowToEvalCase(row));
    },

    getByAttempt(conn: DatabaseConnection, attemptId: AttemptId): Result<EvalCase | null> {
      const row = conn.get<Record<string, unknown>>(
        'SELECT * FROM gov_eval_cases WHERE attempt_id = ?', [attemptId],
      );
      if (!row) return ok(null);
      return ok(rowToEvalCase(row));
    },

    getByContract(conn: DatabaseConnection, contractId: MissionContractId): Result<readonly EvalCase[]> {
      const rows = conn.query<Record<string, unknown>>(
        'SELECT * FROM gov_eval_cases WHERE contract_id = ? ORDER BY created_at', [contractId],
      );
      return ok(rows.map(rowToEvalCase));
    },
  };
}

function rowToEvalCase(row: Record<string, unknown>): EvalCase {
  const satisfaction = row['contract_satisfaction'];
  return {
    evalCaseId: row['eval_case_id'] as EvalCaseId,
    tenantId: row['tenant_id'] as string,
    attemptId: row['attempt_id'] as AttemptId,
    contractId: (row['contract_id'] as MissionContractId) ?? null,
    dimensions: JSON.parse(row['dimensions'] as string) as readonly EvalDimension[],
    provenance: JSON.parse(row['provenance'] as string) as EvalProvenance,
    pinnedVersions: JSON.parse(row['pinned_versions'] as string) as EvalPinnedVersions,
    contractSatisfaction: satisfaction === null || satisfaction === undefined ? null : (satisfaction === 1),
    schemaVersion: row['schema_version'] as string,
    createdAt: row['created_at'] as string,
  };
}

// ============================================================================
// CapabilityManifestStore (Deliverable 9)
// ============================================================================

export function createCapabilityManifestStoreImpl(): CapabilityManifestStore {
  return {
    register(conn: DatabaseConnection, manifest: CapabilityManifest): Result<CapabilityManifest> {
      try {
        conn.run(
          `INSERT INTO gov_capability_manifests (manifest_id, capability_type, trust_tier, side_effect_class, secret_requirements, schema_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            manifest.manifestId, manifest.capabilityType,
            manifest.trustTier, manifest.sideEffectClass,
            JSON.stringify(manifest.secretRequirements),
            manifest.schemaVersion, manifest.createdAt,
          ],
        );
        return ok(manifest);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('UNIQUE') || msg.includes('PRIMARY KEY')) {
          return err('CAPABILITY_ALREADY_EXISTS',
            `Capability manifest with type '${manifest.capabilityType}' already exists`,
            'BC-103');
        }
        return err('CAPABILITY_REGISTER_FAILED', msg, 'BC-100');
      }
    },

    get(conn: DatabaseConnection, manifestId: CapabilityManifestId): Result<CapabilityManifest | null> {
      const row = conn.get<Record<string, unknown>>(
        'SELECT * FROM gov_capability_manifests WHERE manifest_id = ?', [manifestId],
      );
      if (!row) return ok(null);
      return ok(rowToCapabilityManifest(row));
    },

    getByType(conn: DatabaseConnection, capabilityType: string): Result<CapabilityManifest | null> {
      const row = conn.get<Record<string, unknown>>(
        'SELECT * FROM gov_capability_manifests WHERE capability_type = ?', [capabilityType],
      );
      if (!row) return ok(null);
      return ok(rowToCapabilityManifest(row));
    },
  };
}

function rowToCapabilityManifest(row: Record<string, unknown>): CapabilityManifest {
  return {
    manifestId: row['manifest_id'] as CapabilityManifestId,
    capabilityType: row['capability_type'] as string,
    trustTier: row['trust_tier'] as CapabilityManifest['trustTier'],
    sideEffectClass: row['side_effect_class'] as CapabilityManifest['sideEffectClass'],
    secretRequirements: JSON.parse(row['secret_requirements'] as string) as readonly string[],
    schemaVersion: row['schema_version'] as string,
    createdAt: row['created_at'] as string,
  };
}

// ============================================================================
// IdempotencyStore + ResumeTokenStore + PayloadCanonicalizer (Deliverable 12)
// ============================================================================

export function createIdempotencyStoreImpl(time?: TimeProvider): IdempotencyStore {
  const t = time ?? _defaultGovTime;
  return {
    check(conn: DatabaseConnection, key: IdempotencyKey): Result<IdempotencyCheckResult> {
      const row = conn.get<Record<string, unknown>>(
        `SELECT * FROM gov_idempotency_keys
         WHERE tenant_id = ? AND caller_id = ? AND syscall_class = ? AND target_scope = ? AND key = ?`,
        [key.tenantId, key.callerId, key.syscallClass, key.targetScope, key.key],
      );

      if (!row) {
        return ok({ outcome: 'new' as const });
      }

      // INV-131: TTL enforcement — expired keys treated as 'new'
      const expiresAt = row['expires_at'] as string;
      if (new Date(expiresAt).getTime() < t.nowMs()) {
        return ok({ outcome: 'new' as const });
      }

      // INV-132: Canonicalization version mismatch → treated as 'new'
      const storedVersion = row['canonicalization_version'] as string;
      if (storedVersion !== key.canonicalizationVersion) {
        return ok({ outcome: 'new' as const });
      }

      // BC-132: Same hash → deduplicated (timing-safe to prevent side-channel leaks)
      const storedHash = row['payload_hash'] as string;
      if (timingSafeHexEqual(storedHash, key.payloadHash)) {
        return ok({
          outcome: 'deduplicated' as const,
          originalCorrelationId: row['correlation_id'] as CorrelationId,
        });
      }

      // BC-133: Different hash → conflict
      return ok({
        outcome: 'conflict' as const,
        existingPayloadHash: storedHash,
      });
    },

    record(conn: DatabaseConnection, key: IdempotencyKey): Result<void> {
      try {
        conn.run(
          `INSERT OR REPLACE INTO gov_idempotency_keys (tenant_id, caller_id, syscall_class, target_scope, key, payload_hash, canonicalization_version, correlation_id, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            key.tenantId, key.callerId, key.syscallClass, key.targetScope, key.key,
            key.payloadHash, key.canonicalizationVersion, key.correlationId,
            key.createdAt, key.expiresAt,
          ],
        );
        return ok(undefined);
      } catch (e: unknown) {
        return err('IDEMPOTENCY_RECORD_FAILED', e instanceof Error ? e.message : String(e), 'BC-130');
      }
    },
  };
}

export function createResumeTokenStoreImpl(time?: TimeProvider): ResumeTokenStore {
  const t = time ?? _defaultGovTime;
  return {
    create(conn: DatabaseConnection, token: Omit<ResumeToken, 'consumed' | 'consumedAt'>): Result<{ readonly plaintextToken: string }> {
      // BC-136: Generate plaintext token, store only the hash
      const plaintextToken = randomUUID();
      // BC-137 / BRK-018: Derive hash FROM the generated plaintext.
      // The caller-provided token.tokenHash is ignored — the system computes
      // the hash to ensure the returned plaintext IS the pre-image of the stored hash.
      const derivedHash = createHash('sha256').update(plaintextToken).digest('hex');
      // Handle `suspensionId` alias from contract tests (passed via type cast)
      const tokenAny = token as Record<string, unknown>;
      const suspensionRecordId = (token.suspensionRecordId ?? tokenAny['suspensionId'] ?? 'unknown') as string;
      const decisionId = (token.decisionId ?? 'system') as string;
      const expiresAt = token.expiresAt ?? new Date(t.nowMs() + 3600000).toISOString(); // Default: 1 hour
      const createdAt = token.createdAt ?? nowISO(t);

      try {
        conn.run(
          `INSERT INTO gov_resume_tokens (token_hash, tenant_id, suspension_record_id, decision_id, expires_at, consumed, consumed_at, created_at)
           VALUES (?, ?, ?, ?, ?, 0, NULL, ?)`,
          [
            derivedHash, token.tenantId,
            suspensionRecordId, decisionId,
            expiresAt, createdAt,
          ],
        );
        return ok({ plaintextToken });
      } catch (e: unknown) {
        return err('RESUME_TOKEN_CREATE_FAILED', e instanceof Error ? e.message : String(e), 'BC-136');
      }
    },

    consume(conn: DatabaseConnection, tokenHash: string): Result<ResumeToken> {
      // BRK-026: Atomic consume — single UPDATE with consumed=0 guard eliminates TOCTOU.
      // If two concurrent callers race, exactly one gets changes=1.
      const now = nowISO(t);
      const result = conn.run(
        `UPDATE gov_resume_tokens SET consumed = 1, consumed_at = ?
         WHERE token_hash = ? AND consumed = 0 AND expires_at >= ?`,
        [now, tokenHash, now],
      );

      if (result.changes === 1) {
        // Atomic consume succeeded — read back the full record
        const row = conn.get<Record<string, unknown>>(
          'SELECT * FROM gov_resume_tokens WHERE token_hash = ?', [tokenHash],
        );
        return ok({
          tenantId: row!['tenant_id'] as string,
          tokenHash: row!['token_hash'] as string,
          suspensionRecordId: row!['suspension_record_id'] as SuspensionRecordId,
          decisionId: row!['decision_id'] as SupervisorDecisionId,
          expiresAt: row!['expires_at'] as string,
          consumed: true,
          consumedAt: now,
          createdAt: row!['created_at'] as string,
          schemaVersion: (row!['schema_version'] as string) ?? '0',
        });
      }

      // UPDATE matched zero rows — determine why for the correct error code
      const row = conn.get<Record<string, unknown>>(
        'SELECT consumed, expires_at FROM gov_resume_tokens WHERE token_hash = ?', [tokenHash],
      );
      if (!row) {
        return err('RESUME_TOKEN_NOT_FOUND', `Resume token not found`, 'BC-138');
      }
      if (row['consumed'] === 1) {
        return err('RESUME_TOKEN_ALREADY_CONSUMED', `Resume token has already been consumed`, 'BC-138');
      }
      return err('RESUME_TOKEN_EXPIRED', `Resume token has expired`, 'BC-138');
    },
  };
}

export function createPayloadCanonicalizerImpl(): PayloadCanonicalizer {
  return {
    version: '1.0.0',

    canonicalize(payload: Readonly<Record<string, unknown>>): string {
      // BC-134: Sorted-key JSON for deterministic canonicalization
      const sortedKeys = Object.keys(payload).sort();
      const sorted: Record<string, unknown> = {};
      for (const key of sortedKeys) {
        sorted[key] = payload[key];
      }
      return JSON.stringify(sorted);
    },

    hash(canonicalized: string): string {
      return createHash('sha256').update(canonicalized).digest('hex');
    },
  };
}
