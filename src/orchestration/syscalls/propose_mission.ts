/**
 * SC-1: propose_mission -- Creates a new mission (root or child).
 * S ref: S15, S6 (Mission lifecycle), I-03, I-17, I-18, I-20, I-22, I-24
 *
 * Phase: 3 (Orchestration)
 * Delegates to: MissionStore.create, EventPropagator.emitLifecycle
 */

import type { Result, OperationContext } from '../../kernel/interfaces/index.js';
import type { OrchestrationDeps, ProposeMissionInput, ProposeMissionOutput } from '../interfaces/orchestration.js';
import type { MissionStore } from '../interfaces/orchestration.js';
import type { EventPropagator } from '../interfaces/orchestration.js';

/** SC-1: propose_mission system call */
export function proposeMission(
  deps: OrchestrationDeps,
  ctx: OperationContext,
  input: ProposeMissionInput,
  missions: MissionStore,
  events: EventPropagator,
): Result<ProposeMissionOutput> {
  const result = missions.create(deps, ctx, input);
  if (!result.ok) return result;

  // CQ-01 fix: S15 Side Effect -- MISSION_CREATED lifecycle event (orchestrator-emitted, propagation: up)
  // Note: MissionStore.create already runs its transaction atomically.
  // The lifecycle event is a separate INSERT into core_events_log.
  // Per spec S15 side effects: "Event MISSION_CREATED emitted (scope: mission, propagation: up).
  // Audit entry written atomically."
  // The audit entry for mission creation is inside MissionStore.create's transaction.
  // The lifecycle event is a distinct event log entry -- acceptable as post-commit
  // because it is idempotent (event log is append-only, not a state mutation).
  events.emitLifecycle(deps, 'MISSION_CREATED', result.value.missionId, {
    objective: input.objective,
    parentMissionId: input.parentMissionId,
  });

  return result;
}
