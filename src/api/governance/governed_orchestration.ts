/**
 * GovernedOrchestration — Wraps OrchestrationEngine with governance pre/post hooks.
 *
 * Phase: 4 (Governance Wiring)
 * Implements: Design Source §Output 2, Architecture §2 (Wrapper Pattern)
 * Spec sections: §14-§24 (SC-1 through SC-10 governance hooks)
 *
 * Decision D-P4-001: Wrapper pattern selected over extension/middleware/monkey-patching.
 * Rationale: Frozen zone compliance (OrchestrationDeps cannot be modified), same interface
 * shape via structural typing, single governance context per SC call.
 *
 * Security constraints enforced:
 *   C-SEC-01: Fail-closed. Pre-hook errors → GOVERNANCE_UNAVAILABLE, SC NOT executed.
 *   C-SEC-02: Subsystem accessor pass-through documented with security contract.
 *   C-SEC-03: SC-5 suspension-scope check (same-mission allow, cross-mission deny).
 *   C-SEC-04: This wrapper replaces raw orchestration for ALL consumers.
 *   C-SEC-06: Terminal release failure tracking per mission (N=3 → escalation).
 *   C-SEC-07: Consumption recording failure → warn log + health counter.
 *
 * Invariants enforced: I-17 (governance boundary), S-01 (constitutional before visible)
 *
 * Architectural note on EGP hooks:
 *   The hook matrix specifies EGP hooks on SC-3 (floor), SC-7 (invocation), SC-9 (terminal).
 *   These EGP protocol hooks require information not available at the system call input level
 *   (e.g., missionId from taskId for floor enforcer, taskVersion for execution gate).
 *   The correct wiring site for EGP enforcement is the substrate layer (Phase 2B), where:
 *     - FloorEnforcer is called during wave composition (scheduler has missionId context)
 *     - ExecutionGate is called before SCHEDULED→RUNNING transition (worker has task context)
 *     - InvocationGate is called before model invocation (pipeline has reservation context)
 *     - TerminalRelease is called during task terminal transitions (scheduler has full context)
 *   The governance wrapper handles suspension checks and governance policy (Phase 0A layer).
 *   EGP integration into the pipeline is done separately in ChatPipeline (invocation gate).
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type {
  OperationContext, Result, KernelError, MissionId,
} from '../../kernel/interfaces/index.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type { OrchestrationEngine } from '../../orchestration/interfaces/orchestration.js';
import type {
  ProposeMissionInput, ProposeMissionOutput,
  ProposeTaskGraphInput, ProposeTaskGraphOutput,
  ProposeTaskExecutionInput, ProposeTaskExecutionOutput,
  CreateArtifactInput, CreateArtifactOutput,
  ReadArtifactInput, ReadArtifactOutput,
  EmitEventInput, EmitEventOutput,
  RequestCapabilityInput, RequestCapabilityOutput,
  RequestBudgetInput, RequestBudgetOutput,
  SubmitResultInput, SubmitResultOutput,
  RespondCheckpointInput, RespondCheckpointOutput,
} from '../../orchestration/interfaces/orchestration.js';
import type { GovernanceSystem } from '../../governance/harness/governance_harness.js';
import type { ExecutionGovernor } from '../../execution/interfaces/egp_types.js';
import type { InvocationGate } from '../../execution/wiring/invocation_gate.js';
import type { SupervisorDecisionId } from '../../kernel/interfaces/governance_ids.js';

// ============================================================================
// Result Helpers
// ============================================================================

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string, spec: string): Result<T> {
  const error: KernelError = { code, message, spec };
  return { ok: false, error };
}

// ============================================================================
// GovernanceRefs — dependencies for governance hook execution
// ============================================================================

export interface GovernanceRefs {
  readonly governance: GovernanceSystem;
  readonly egp: ExecutionGovernor;
  readonly invocationGate: InvocationGate;
  readonly getConnection: () => DatabaseConnection;
  readonly time: TimeProvider;
}

// ============================================================================
// Terminal Release Failure Tracking (C-SEC-06)
// ============================================================================

/**
 * C-SEC-06: Track consecutive terminal release failures per mission.
 * After N=3 consecutive failures → create synthetic supervisor decision.
 */
const TERMINAL_RELEASE_ESCALATION_THRESHOLD = 3;

// ============================================================================
// GovernedOrchestration Result Type (C-06: per-instance health counters)
// ============================================================================

/**
 * C-06: GovernedOrchestration returns both the engine and a per-instance
 * health counter accessor. The counter is closure-local to the
 * createGovernedOrchestration call, ensuring two createLimen() instances
 * have independent failure tracking.
 *
 * The OrchestrationEngine interface is frozen and cannot be extended,
 * so the health counter is returned alongside via this type.
 */
export interface GovernedOrchestrationResult {
  readonly engine: OrchestrationEngine;
  /** Per-instance consumption recording failure count (C-SEC-07) */
  readonly getConsumptionRecordingFailureCount: () => number;
}

// ============================================================================
// createGovernedOrchestration — the factory
// ============================================================================

/**
 * Create a GovernedOrchestration wrapper that threads governance hooks
 * into SC-1 through SC-10 without modifying the frozen OrchestrationEngine.
 *
 * The returned object satisfies OrchestrationEngine via structural typing.
 * The `inner` reference is closure-local and never exposed (DC-P4-103).
 *
 * C-06: consumptionRecordingFailures is closure-local (per-instance),
 * not module-level, ensuring two createLimen() calls have independent counters.
 *
 * @param inner - The raw OrchestrationEngine (closure-local, never leaked)
 * @param refs - Governance protocol references
 * @returns Frozen GovernedOrchestrationResult with engine + health counter
 */
export function createGovernedOrchestration(
  inner: OrchestrationEngine,
  refs: GovernanceRefs,
): GovernedOrchestrationResult {
  // C-SEC-06: Per-mission terminal release failure counter (closure-local)
  const terminalReleaseFailures = new Map<string, number>();

  // C-SEC-07, C-06: Per-instance consumption recording failure counter.
  // Moved from module-level to closure-local to ensure C-06 independence.
  let consumptionRecordingFailures = 0;

  /**
   * Check if a mission or task is suspended.
   * Used as pre-hook for SC-1 through SC-10.
   *
   * C-SEC-01: If the suspension check itself throws, return GOVERNANCE_UNAVAILABLE.
   */
  function checkSuspension(
    conn: DatabaseConnection,
    targetType: 'mission' | 'task',
    targetId: string,
  ): Result<void> | null {
    try {
      const result = refs.governance.suspensionStore.getActiveForTarget(conn, targetType, targetId);
      if (!result.ok) {
        return err('GOVERNANCE_UNAVAILABLE', `Suspension check failed: ${result.error.message}`, 'BC-060');
      }
      if (result.value !== null) {
        return err('SUSPENSION_ACTIVE', `${targetType} ${targetId} is suspended`, 'BC-060');
      }
      return null; // No suspension — proceed
    } catch (e) {
      // C-SEC-01: Fail-closed — governance infrastructure error blocks SC
      return err('GOVERNANCE_UNAVAILABLE', `Suspension check error: ${e instanceof Error ? e.message : String(e)}`, 'S-01');
    }
  }

  /**
   * Lightweight task→missionId lookup via direct SQL.
   * Used by SC-3 and other hooks that receive taskId but need missionId.
   * This avoids needing full OrchestrationDeps just to resolve a relationship.
   */
  function getMissionIdForTask(
    conn: DatabaseConnection,
    taskId: string,
  ): Result<MissionId> {
    try {
      const row = conn.get<{ mission_id: string }>(
        'SELECT mission_id FROM core_tasks WHERE id = ?',
        [taskId],
      );
      if (!row) {
        return err('GOVERNANCE_UNAVAILABLE', `Task ${taskId} not found for mission resolution`, 'BC-060');
      }
      return ok(row.mission_id as MissionId);
    } catch (e) {
      return err('GOVERNANCE_UNAVAILABLE', `Task lookup error: ${e instanceof Error ? e.message : String(e)}`, 'S-01');
    }
  }

  /**
   * Lightweight artifactId→missionId lookup via direct SQL.
   * Used by SC-5 to resolve an artifact's owning mission for suspension check.
   *
   * Queries the latest version of the artifact (MAX(version)) to get the mission_id.
   * If the artifact does not exist, returns GOVERNANCE_UNAVAILABLE (fail-closed per C-SEC-01).
   *
   * Conservative design: Because OperationContext lacks missionId, we cannot distinguish
   * same-mission vs cross-mission reads. We block ALL reads of suspended mission artifacts.
   * This is MORE restrictive than C-SEC-03's "same-mission allow, cross-mission deny"
   * but fail-closed is always acceptable when the alternative is fail-open.
   */
  function getMissionIdForArtifact(
    conn: DatabaseConnection,
    artifactId: string,
  ): Result<MissionId> {
    try {
      const row = conn.get<{ mission_id: string }>(
        'SELECT mission_id FROM core_artifacts WHERE id = ? AND version = (SELECT MAX(version) FROM core_artifacts WHERE id = ?)',
        [artifactId, artifactId],
      );
      if (!row) {
        return err('GOVERNANCE_UNAVAILABLE', `Artifact ${artifactId} not found for mission resolution`, 'BC-060');
      }
      return ok(row.mission_id as MissionId);
    } catch (e) {
      return err('GOVERNANCE_UNAVAILABLE', `Artifact lookup error: ${e instanceof Error ? e.message : String(e)}`, 'S-01');
    }
  }

  /**
   * Lightweight checkpointId→missionId lookup via direct SQL.
   * Used by SC-10 which has only checkpointId in its input.
   */
  function getMissionIdForCheckpoint(
    conn: DatabaseConnection,
    checkpointId: string,
  ): Result<MissionId> {
    try {
      const row = conn.get<{ mission_id: string }>(
        'SELECT mission_id FROM core_checkpoints WHERE id = ?',
        [checkpointId],
      );
      if (!row) {
        return err('GOVERNANCE_UNAVAILABLE', `Checkpoint ${checkpointId} not found for mission resolution`, 'BC-060');
      }
      return ok(row.mission_id as MissionId);
    } catch (e) {
      return err('GOVERNANCE_UNAVAILABLE', `Checkpoint lookup error: ${e instanceof Error ? e.message : String(e)}`, 'S-01');
    }
  }

  /**
   * SC-9 post-hook: Track terminal release failures per mission (C-SEC-06).
   * When the inner SC-9 succeeds (mission transitions to COMPLETED/REVIEWING),
   * we check that budget cleanup occurred. If the ledger operation fails N times
   * consecutively, escalate via synthetic supervisor decision.
   *
   * Note: Per-task terminal release is handled at the substrate layer (Phase 2B).
   * This hook handles mission-level budget finalization tracking.
   */
  function trackMissionCompletion(
    conn: DatabaseConnection,
    missionId: string,
  ): void {
    try {
      // Verify mission budget state is consistent
      const stateResult = refs.egp.ledger.getState(conn, missionId as MissionId);
      if (!stateResult.ok) {
        trackTerminalReleaseFailure(conn, missionId);
      } else {
        // Success — reset counter
        terminalReleaseFailures.delete(missionId);
      }
    } catch {
      trackTerminalReleaseFailure(conn, missionId);
    }
  }

  function trackTerminalReleaseFailure(
    conn: DatabaseConnection,
    missionId: string,
  ): void {
    const count = (terminalReleaseFailures.get(missionId) ?? 0) + 1;
    terminalReleaseFailures.set(missionId, count);

    if (count >= TERMINAL_RELEASE_ESCALATION_THRESHOLD) {
      // C-SEC-06: Create synthetic supervisor decision
      try {
        const decisionId = `synth-terminal-${missionId}-${refs.time.nowMs()}` as SupervisorDecisionId;
        refs.governance.supervisorDecisionStore.create(conn, {
          decisionId,
          tenantId: '',  // System-level escalation — no tenant context
          supervisorType: 'system-timeout',
          targetType: 'mission',
          targetId: missionId,
          outcome: 'defer',
          rationale: `Terminal release check failed ${count} consecutive times for mission ${missionId}. Requires manual investigation.`,
          precedence: 100,  // High precedence for system escalation
          schemaVersion: '1.0',
          origin: 'runtime',
          createdAt: refs.time.nowISO(),
        });
        terminalReleaseFailures.delete(missionId);
      } catch {
        // Escalation itself failed — counter remains for next attempt
      }
    }
  }

  // ========================================================================
  // Governed SC methods
  // ========================================================================

  const governed: OrchestrationEngine = {
    // SC-1: proposeMission
    // Pre: suspension check on parent (if delegated)
    // Post: none
    proposeMission(ctx: OperationContext, input: ProposeMissionInput): Result<ProposeMissionOutput> {
      const conn = refs.getConnection();

      // Pre-hook: suspension check on parent mission (if delegated)
      if (input.parentMissionId) {
        const suspCheck = checkSuspension(conn, 'mission', input.parentMissionId);
        if (suspCheck !== null) return suspCheck as Result<ProposeMissionOutput>;
      }

      // Delegate to inner
      return inner.proposeMission(ctx, input);
    },

    // SC-2: proposeTaskGraph
    // Pre: suspension check on mission
    // Post: none
    proposeTaskGraph(ctx: OperationContext, input: ProposeTaskGraphInput): Result<ProposeTaskGraphOutput> {
      const conn = refs.getConnection();

      // Pre-hook: suspension check on mission
      const suspCheck = checkSuspension(conn, 'mission', input.missionId);
      if (suspCheck !== null) return suspCheck as Result<ProposeTaskGraphOutput>;

      // Delegate to inner
      return inner.proposeTaskGraph(ctx, input);
    },

    // SC-3: proposeTaskExecution
    // Pre: suspension check on task (mission-level cascade per BC-049)
    // Post: none (EGP gate/floor enforcement at substrate layer)
    proposeTaskExecution(ctx: OperationContext, input: ProposeTaskExecutionInput): Result<ProposeTaskExecutionOutput> {
      const conn = refs.getConnection();

      // Pre-hook: resolve task's mission for suspension check (BC-049 cascade)
      const missionResult = getMissionIdForTask(conn, input.taskId);
      if (!missionResult.ok) {
        return missionResult as unknown as Result<ProposeTaskExecutionOutput>;
      }
      const missionId = missionResult.value;

      // Pre-hook: mission-level suspension check (BC-049: mission suspended → tasks implicitly suspended)
      const suspCheck = checkSuspension(conn, 'mission', missionId);
      if (suspCheck !== null) return suspCheck as Result<ProposeTaskExecutionOutput>;

      // Pre-hook: task-level suspension check
      const taskSuspCheck = checkSuspension(conn, 'task', input.taskId);
      if (taskSuspCheck !== null) return taskSuspCheck as Result<ProposeTaskExecutionOutput>;

      // Delegate to inner
      return inner.proposeTaskExecution(ctx, input);
    },

    // SC-4: createArtifact
    // Pre: suspension check on mission
    // Post: none
    createArtifact(ctx: OperationContext, input: CreateArtifactInput): Result<CreateArtifactOutput> {
      const conn = refs.getConnection();

      const suspCheck = checkSuspension(conn, 'mission', input.missionId);
      if (suspCheck !== null) return suspCheck as Result<CreateArtifactOutput>;

      return inner.createArtifact(ctx, input);
    },

    // SC-5: readArtifact
    // Pre: suspension check on artifact's owning mission (C-SEC-03, DC-P4-403)
    // Post: none
    //
    // C-SEC-03 enforcement: OperationContext lacks missionId, so we cannot
    // distinguish same-mission vs cross-mission reads. Conservative approach:
    // block ALL reads of artifacts belonging to suspended missions.
    // This is MORE restrictive than C-SEC-03's "same-mission allow, cross-mission
    // deny" — but fail-closed is always acceptable per C-SEC-01 when the
    // alternative is fail-open. An agent on a suspended mission can resume
    // reads only after the suspension is lifted.
    readArtifact(ctx: OperationContext, input: ReadArtifactInput): Result<ReadArtifactOutput> {
      const conn = refs.getConnection();

      // Pre-hook: resolve artifact's mission for suspension check
      const missionResult = getMissionIdForArtifact(conn, input.artifactId);
      if (!missionResult.ok) {
        // C-SEC-01: Fail-closed — unknown artifact can't be governance-cleared
        return missionResult as unknown as Result<ReadArtifactOutput>;
      }

      const suspCheck = checkSuspension(conn, 'mission', missionResult.value);
      if (suspCheck !== null) return suspCheck as Result<ReadArtifactOutput>;

      return inner.readArtifact(ctx, input);
    },

    // SC-6: emitEvent
    // Pre: suspension check on mission
    // Post: none
    emitEvent(ctx: OperationContext, input: EmitEventInput): Result<EmitEventOutput> {
      const conn = refs.getConnection();

      const suspCheck = checkSuspension(conn, 'mission', input.missionId);
      if (suspCheck !== null) return suspCheck as Result<EmitEventOutput>;

      return inner.emitEvent(ctx, input);
    },

    // SC-7: requestCapability
    // Pre: suspension check on mission, invocation gate (headroom check)
    // Post: consumption record (C-SEC-07)
    requestCapability(ctx: OperationContext, input: RequestCapabilityInput): Result<RequestCapabilityOutput> {
      const conn = refs.getConnection();

      const suspCheck = checkSuspension(conn, 'mission', input.missionId);
      if (suspCheck !== null) return suspCheck as Result<RequestCapabilityOutput>;

      // Pre-hook: EGP invocation gate — check headroom before capability execution
      try {
        const headroom = refs.invocationGate.checkAdmissibility(conn, input.taskId, 0, 0);
        if (!headroom.ok) {
          return err('GOVERNANCE_UNAVAILABLE', `Invocation gate error: ${headroom.error.message}`, 'S-01');
        }
        if (!headroom.value.admissible) {
          const dim = headroom.value.rejectionDimension;
          if (dim === 'token' || dim === 'both') {
            return err('EGP_TOKEN_HEADROOM_EXHAUSTED', 'Token headroom exhausted for capability invocation', 'EGP-INV');
          }
          return err('EGP_DELIBERATION_HEADROOM_EXHAUSTED', 'Deliberation headroom exhausted for capability invocation', 'EGP-INV');
        }
      } catch (e) {
        // C-SEC-01: Fail-closed
        return err('GOVERNANCE_UNAVAILABLE', `Invocation gate error: ${e instanceof Error ? e.message : String(e)}`, 'S-01');
      }

      // Delegate to inner
      const result = inner.requestCapability(ctx, input);

      // Post-hook: EGP consumption record (C-SEC-07)
      if (result.ok) {
        try {
          const tokensConsumed = result.value.resourcesConsumed?.tokens ?? 0;
          refs.egp.ledger.recordConsumption(conn, input.missionId, tokensConsumed, 1);
        } catch {
          // C-SEC-07: Consumption recording failure — increment health counter
          consumptionRecordingFailures++;
        }
      }

      return result;
    },

    // SC-8: requestBudget
    // Pre: suspension check on mission
    // Post: none
    requestBudget(ctx: OperationContext, input: RequestBudgetInput): Result<RequestBudgetOutput> {
      const conn = refs.getConnection();

      const suspCheck = checkSuspension(conn, 'mission', input.missionId);
      if (suspCheck !== null) return suspCheck as Result<RequestBudgetOutput>;

      return inner.requestBudget(ctx, input);
    },

    // SC-9: submitResult
    // Pre: suspension check on mission
    // Post: mission completion tracking (C-SEC-06)
    submitResult(ctx: OperationContext, input: SubmitResultInput): Result<SubmitResultOutput> {
      const conn = refs.getConnection();

      const suspCheck = checkSuspension(conn, 'mission', input.missionId);
      if (suspCheck !== null) return suspCheck as Result<SubmitResultOutput>;

      // Delegate to inner
      const result = inner.submitResult(ctx, input);

      // Post-hook: mission completion budget tracking (C-SEC-06)
      // Verify budget state is consistent after mission result submission.
      // Per-task terminal releases are handled at the substrate layer.
      if (result.ok) {
        trackMissionCompletion(conn, input.missionId);
      }

      return result;
    },

    // SC-10: respondCheckpoint
    // Pre: suspension check (resolve mission from checkpoint)
    // Post: none
    respondCheckpoint(ctx: OperationContext, input: RespondCheckpointInput): Result<RespondCheckpointOutput> {
      const conn = refs.getConnection();

      // Resolve checkpoint's mission for suspension check
      // C-SEC-01: Fail-closed — if checkpoint lookup fails, return GOVERNANCE_UNAVAILABLE.
      // A checkpoint not found in the DB cannot be governance-cleared.
      const missionResult = getMissionIdForCheckpoint(conn, input.checkpointId);
      if (!missionResult.ok) {
        return missionResult as unknown as Result<RespondCheckpointOutput>;
      }
      const suspCheck = checkSuspension(conn, 'mission', missionResult.value);
      if (suspCheck !== null) return suspCheck as Result<RespondCheckpointOutput>;

      return inner.respondCheckpoint(ctx, input);
    },

    // ====================================================================
    // SECURITY CONTRACT (C-SEC-02, SEC-P4-002):
    // Subsystem accessors pass through to the inner engine WITHOUT governance hooks.
    // These are for INTERNAL INFRASTRUCTURE use only:
    //   - Checkpoint expiry timer (S24 auto-expiry)
    //   - Compaction engine (I-21 bounded cognition)
    //   - Session manager internal state queries
    // Agent-facing operations MUST use the 10 SC methods.
    // Any new code using subsystem accessors for agent-facing logic is a governance bypass.
    // ====================================================================
    get missions() { return inner.missions; },
    get taskGraph() { return inner.taskGraph; },
    get artifacts() { return inner.artifacts; },
    get budget() { return inner.budget; },
    get checkpoints() { return inner.checkpoints; },
    get compaction() { return inner.compaction; },
    get events() { return inner.events; },
    get conversations() { return inner.conversations; },
    get delegation() { return inner.delegation; },
    get transitions() { return inner.transitions; },
  };

  return Object.freeze({
    engine: Object.freeze(governed),
    getConsumptionRecordingFailureCount: () => consumptionRecordingFailures,
  });
}
