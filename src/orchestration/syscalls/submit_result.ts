/**
 * SC-9: submit_result -- Completes a mission with result.
 * S ref: S23, S6 (Mission lifecycle), I-03, I-17, I-18, I-21, I-25
 *
 * Phase: 3 (Orchestration)
 * Side effects: Mission -> COMPLETED, MissionResult created (immutable),
 *               child result propagated UP, subtree compaction (I-21),
 *               resources finalized, MISSION_COMPLETED event (up),
 *               audit entry with full result.
 */

import type { Result, OperationContext } from '../../kernel/interfaces/index.js';
import type {
  OrchestrationDeps, SubmitResultInput, SubmitResultOutput,
  MissionStore, EventPropagator, CompactionEngine,
} from '../interfaces/orchestration.js';
import { generateId } from '../interfaces/orchestration.js';

/** SC-9: submit_result system call */
export function submitResult(
  deps: OrchestrationDeps,
  ctx: OperationContext,
  input: SubmitResultInput,
  missions: MissionStore,
  events: EventPropagator,
  compaction: CompactionEngine,
): Result<SubmitResultOutput> {
  // Verify mission exists and is active
  const missionResult = missions.get(deps, input.missionId);
  if (!missionResult.ok) {
    return { ok: false, error: { code: 'MISSION_NOT_ACTIVE', message: missionResult.error.message, spec: 'S23' } };
  }
  const mission = missionResult.value;

  // Ruling 1: Only REVIEWING → COMPLETED is valid per §6 MISSION_TRANSITIONS
  if (mission.state !== 'REVIEWING') {
    return { ok: false, error: { code: 'MISSION_NOT_ACTIVE', message: `Mission must be in REVIEWING state to submit result, currently: ${mission.state}`, spec: 'S23/S6' } };
  }

  // S23: NO_ARTIFACTS -- at least one artifact required
  if (input.artifactIds.length === 0) {
    return { ok: false, error: { code: 'NO_ARTIFACTS', message: 'No deliverable artifacts specified', spec: 'S23' } };
  }

  // Ruling 2 (BD-SC9-001): Taskless missions NOT completable
  const graph = deps.conn.get<{ id: string }>(
    'SELECT id FROM core_task_graphs WHERE mission_id = ? AND is_active = 1',
    [input.missionId],
  );
  if (!graph) {
    return { ok: false, error: { code: 'TASKS_INCOMPLETE', message: 'No task graph — mission has no work to complete', spec: 'S23' } };
  }

  // Ruling 4 (BD-SC9-003): §23 completion set is {COMPLETED, CANCELLED} — FAILED excluded
  const incompleteTasks = deps.conn.query<{ id: string; state: string }>(
    `SELECT id, state FROM core_tasks WHERE graph_id = ? AND state NOT IN ('COMPLETED', 'CANCELLED')`,
    [graph.id],
  );
  if (incompleteTasks.length > 0) {
    return { ok: false, error: { code: 'TASKS_INCOMPLETE', message: `${incompleteTasks.length} tasks not in completion set (COMPLETED/CANCELLED)`, spec: 'S23' } };
  }

  // F-003 fix: NaN/Infinity guard (DC-SC9-106) + range validation
  if (!Number.isFinite(input.confidence)) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: `Confidence must be a finite number, got: ${input.confidence}`, spec: 'S23' } };
  }
  if (input.confidence < 0.0 || input.confidence > 1.0) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: `Confidence ${input.confidence} must be in [0.0, 1.0]`, spec: 'S23' } };
  }

  const resultId = generateId();
  const now = deps.time.nowISO();

  deps.conn.transaction(() => {
    // Create MissionResult (immutable)
    deps.conn.run(
      `INSERT INTO core_mission_results (mission_id, tenant_id, summary, confidence, artifact_ids, unresolved_questions, followup_recommendations, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.missionId,
        ctx.tenantId,
        input.summary,
        input.confidence,
        JSON.stringify(input.artifactIds),
        JSON.stringify(input.unresolvedQuestions),
        JSON.stringify(input.followupRecommendations),
        now,
      ],
    );

    // F-009/F-010 fix: State-guarded transition (no raw SQL bypass, TOCTOU protected)
    const updateResult = deps.conn.run(
      `UPDATE core_missions SET state = 'COMPLETED', updated_at = ?, completed_at = ? WHERE id = ? AND state = 'REVIEWING'`,
      [now, now, input.missionId],
    );
    if (updateResult.changes === 0) {
      throw new Error(`TOCTOU: Mission ${input.missionId} state changed from REVIEWING during transaction`);
    }

    // I-03: Audit entry with full result
    deps.audit.append(deps.conn, {
      tenantId: ctx.tenantId,
      actorType: ctx.userId ? 'user' : 'agent',
      actorId: (ctx.userId ?? ctx.agentId ?? 'system') as string,
      operation: 'submit_result',
      resourceType: 'mission_result',
      resourceId: resultId,
      detail: {
        missionId: input.missionId,
        summary: input.summary,
        confidence: input.confidence,
        artifactCount: input.artifactIds.length,
      },
    });

    // F-17 fix: Lifecycle event inside transaction (I-25 deterministic replay)
    events.emitLifecycle(deps, 'MISSION_COMPLETED', input.missionId, {
      resultId,
      confidence: input.confidence,
      parentMissionId: mission.parentId,
    });

    // F-17 fix: I-21 eager compaction IN THE SAME TRANSACTION (SD-20)
    compaction.compactSubtree(deps, input.missionId);
  });

  return {
    ok: true,
    value: {
      resultId,
      missionState: 'COMPLETED',
    },
  };
}
