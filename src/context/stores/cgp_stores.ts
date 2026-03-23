/**
 * CGP (Context Governance Protocol) stores — all business logic.
 * Spec ref: CGP v1.0 Design Source (FINAL), Architecture Freeze CF-01/CF-03/CF-04/CF-07/CF-08/CF-09/CF-10
 *
 * Phase: v3.3.0 — Context Governance Protocol Implementation
 * Status: IMPLEMENTED — algorithm + pipeline operational; cross-subsystem stubs pending.
 *
 * Extracted from cgp_harness.ts (Phase 2A, P-010 compliance).
 * All business logic lives here. The harness is a thin factory that delegates.
 *
 * EXISTING v3.2 DEPENDENCIES (additive-only):
 *   - ArtifactStore (src/orchestration/artifacts/artifact_store.ts)
 *   - ConversationManager (src/orchestration/conversation/conversation_manager.ts)
 *   - EventBus (src/kernel/events/event_bus.ts)
 *   - AuditTrail (src/kernel/audit/audit_trail.ts)
 *   All are additive-only. CGP extends, never modifies.
 *
 * CROSS-SUBSYSTEM DEPENDENCIES (NOT YET IMPLEMENTED):
 *   - WmpInternalReader — WMP §9.2 (WMP subsystem not yet built)
 *   - ClaimCandidateCollector — CCP §14.6 (CCP not yet implemented)
 *   - RetrievalOutputProvider — v3.2 retrieval phase (stub in pipeline)
 *   - ObservationCollector — capability results (no storage yet)
 *
 * CROSS-POSITION DEDUPLICATION (I-74):
 *   Dedup is a pipeline-level concern, not algorithm-level. The renderer produces
 *   unique canonical texts for different entities. The algorithm operates on
 *   pre-processed candidate sets where dedup has already been applied.
 *   At algorithm level, candidates are taken as-given.
 */

import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { Result, TaskId, MissionId, ArtifactId, SessionId } from '../../kernel/interfaces/index.js';
import type { AuditTrail, AuditCreateInput } from '../../kernel/interfaces/audit.js';
import type { EventBus, EventPayload } from '../../kernel/interfaces/events.js';
import type { OperationContext } from '../../kernel/interfaces/common.js';

import type {
  ContextGovernor,
  CGPDeps,
  ContextAdmissionAlgorithm,
  ControlStateAssembler,
  TokenCostingService,
  CanonicalRepresentationRenderer,
  WmpInternalReader,
  ArtifactCandidateCollector,
  ClaimCandidateCollector,
  RetrievalOutputProvider,
  ObservationCollector,
  ConversationContextProvider,
  ContextAdmissionPipelineResult,
  AdmissionAlgorithmInput,
  AdmissionAlgorithmOutput,
  ControlStateContent,
  CostingBasis,
  TaskContextSpec,
  TemporalScope,
  ContextInvocationId,
  WmpInternalEntry,
  ArtifactCandidate,
  ClaimCandidate,
  RetrievedMemory,
  ObservationCandidate,
  ConversationTurnForAdmission,
  CandidateRepresentation,
  PositionCandidateSet,
  EvictablePosition,
  EvictionDecision,
  ContextAdmissionRecord,
  PositionReplayEntry,
  CandidateReplayEntry,
  EcbProvider,
  EcbAuditInputs,
  BudgetComputationInputs,
  ContextAdmittedEventPayload,
  ContextAdmissionFailedEventPayload,
  PositionStarvationEventPayload,
} from '../interfaces/cgp_types.js';

import {
  CGP_EVICTION_ORDER,
  CGP_POSITION_ORDERING,
  CGP_MAX_INPUT_ARTIFACT_IDS,
  CGP_EVENTS,
} from '../interfaces/cgp_types.js';

// ============================================================================
// Result helpers — local, following established codebase pattern
// ============================================================================

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string, spec: string): Result<T> {
  return { ok: false, error: { code, message, spec } };
}

// ============================================================================
// NotImplementedError — sentinel for cross-subsystem stubs
// ============================================================================

/**
 * Thrown by stub methods for cross-subsystem readers not yet implemented.
 * Contract tests verify these stubs exist and throw this error.
 * The pipeline catches these errors and treats them as provider failures (DC-CGP-306).
 */
export class NotImplementedError extends Error {
  public readonly code = 'NOT_IMPLEMENTED';

  constructor(method: string) {
    super(`${method} is not yet implemented`);
    this.name = 'NotImplementedError';
  }
}

// ============================================================================
// Position-type validation map (DC-CGP-101)
// ============================================================================

const POSITION_TYPE_MAP: Readonly<Record<number, string>> = {
  2: 'wmp_entry',
  3: 'artifact',
  4: 'claim',
  5: 'memory',
  6: 'observation',
};

// ============================================================================
// Per-position sorting (§8) — eviction ordering
// ============================================================================

/**
 * Sort candidates within a position for eviction ordering.
 * Returns a NEW sorted array (does not mutate input).
 * Candidates sorted so that the FIRST element is evicted first.
 *
 * §8.1 P2: updatedAt ascending (oldest evicted first), tie-break key ASC
 * §8.2 P3: createdAt ascending (oldest evicted first), tie-break artifactId ASC
 * §8.3 P4: createdAt ascending (oldest evicted first), tie-break claimId ASC
 * §8.4 P5: retrievalRank descending (least relevant evicted first), tie-break memoryId ASC
 * §8.5 P6: productionOrder ascending (earliest evicted first), tie-break observationId ASC
 */
function sortForEviction(
  position: EvictablePosition,
  candidates: readonly CandidateRepresentation[],
): readonly CandidateRepresentation[] {
  const ordering = CGP_POSITION_ORDERING[position];
  const sorted = [...candidates];

  sorted.sort((a, b) => {
    const aVal = a.orderingInputs[ordering.primarySignal] ?? '';
    const bVal = b.orderingInputs[ordering.primarySignal] ?? '';

    let cmp: number;
    if (ordering.direction === 'ascending') {
      cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    } else {
      cmp = aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
    }

    if (cmp !== 0) return cmp;

    const aTie = a.orderingInputs[ordering.tieBreaker] ?? '';
    const bTie = b.orderingInputs[ordering.tieBreaker] ?? '';
    const tieCmp = aTie < bTie ? -1 : aTie > bTie ? 1 : 0;
    if (tieCmp !== 0) return tieCmp;

    // Final tiebreaker: candidateId ascending (always unique — CGP-I4 determinism)
    return a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0;
  });

  return sorted;
}

// ============================================================================
// Admission Algorithm — §7.2 (8 steps, eviction-ordered)
// ============================================================================

function createAdmissionAlgorithm(): ContextAdmissionAlgorithm {
  return Object.freeze({
    execute(input: AdmissionAlgorithmInput): AdmissionAlgorithmOutput {
      const { effectiveContextBudget: ecb, controlState, positionCandidates } = input;

      // ── Step 1: P1 Reservation ──
      if (controlState.tokenCost > ecb) {
        return Object.freeze({
          admissionResult: 'CONTROL_STATE_OVERFLOW',
          admittedCandidates: Object.freeze([]),
          evictedCandidates: Object.freeze([]),
          totalAdmittedCost: controlState.tokenCost,
          position1Cost: controlState.tokenCost,
        });
      }

      // DC-CGP-101: Filter candidates with mismatched type-position
      const validatedPositions: PositionCandidateSet[] = positionCandidates.map(pos => {
        if (!pos.applicable) return pos;
        const expectedType = POSITION_TYPE_MAP[pos.positionNumber];
        const validCandidates = pos.candidates.filter(c => c.candidateType === expectedType);
        return {
          positionNumber: pos.positionNumber,
          applicable: pos.applicable,
          candidates: validCandidates,
        };
      });

      // Collect all candidates from applicable positions
      const allCandidates: CandidateRepresentation[] = [];
      for (const pos of validatedPositions) {
        if (pos.applicable) {
          for (const c of pos.candidates) {
            allCandidates.push(c);
          }
        }
      }

      // ── Step 2: Total Candidate Cost ──
      const totalCandidateCost = allCandidates.reduce((sum, c) => sum + c.tokenCost, 0);

      if (controlState.tokenCost + totalCandidateCost <= ecb) {
        return Object.freeze({
          admissionResult: 'success',
          admittedCandidates: Object.freeze([...allCandidates]),
          evictedCandidates: Object.freeze([]),
          totalAdmittedCost: controlState.tokenCost + totalCandidateCost,
          position1Cost: controlState.tokenCost,
        });
      }

      // ── Step 3: Separate Protected / Non-Protected ──
      const protectedCost = allCandidates
        .filter(c => c.protectionStatus === 'governed_required')
        .reduce((sum, c) => sum + c.tokenCost, 0);

      if (controlState.tokenCost + protectedCost > ecb) {
        return Object.freeze({
          admissionResult: 'CONTEXT_PROTECTION_OVERFLOW',
          admittedCandidates: Object.freeze([]),
          evictedCandidates: Object.freeze([]),
          totalAdmittedCost: controlState.tokenCost + protectedCost,
          position1Cost: controlState.tokenCost,
        });
      }

      // ── Step 4: Evict Non-Protected Bottom-Up [6,5,4,3,2] ──
      const evictedSet = new Set<string>();
      const evictionDecisions: EvictionDecision[] = [];
      let currentCost = controlState.tokenCost + totalCandidateCost;
      let evictionOrder = 0;

      for (const position of CGP_EVICTION_ORDER) {
        if (currentCost <= ecb) break;

        const posSet = validatedPositions.find(p => p.positionNumber === position);
        if (!posSet || !posSet.applicable) continue;

        const nonProtInPos = posSet.candidates.filter(
          c => c.protectionStatus === 'non_protected',
        );
        const sorted = sortForEviction(position, nonProtInPos);

        for (const candidate of sorted) {
          if (currentCost <= ecb) break;

          evictedSet.add(candidate.candidateId);
          evictionOrder++;
          evictionDecisions.push({
            candidateId: candidate.candidateId,
            positionNumber: position,
            tokenCost: candidate.tokenCost,
            evictionOrder,
          });
          currentCost -= candidate.tokenCost;
        }
      }

      // ── Step 5: Verify Budget Satisfaction ──
      if (currentCost > ecb) {
        return Object.freeze({
          admissionResult: 'CONTEXT_PROTECTION_OVERFLOW',
          admittedCandidates: Object.freeze([]),
          evictedCandidates: Object.freeze(evictionDecisions),
          totalAdmittedCost: currentCost,
          position1Cost: controlState.tokenCost,
        });
      }

      // ── Step 6: Produce Admitted Set (no backfill — DC-CGP-202) ──
      const admittedCandidates = allCandidates.filter(
        c => !evictedSet.has(c.candidateId),
      );

      // ── Steps 7-8: Return frozen result ──
      return Object.freeze({
        admissionResult: 'success' as const,
        admittedCandidates: Object.freeze(admittedCandidates),
        evictedCandidates: Object.freeze(evictionDecisions),
        totalAdmittedCost: currentCost,
        position1Cost: controlState.tokenCost,
      });
    },
  });
}

// ============================================================================
// Control State Assembler — §5.1
// ============================================================================

function createControlStateAssembler(): ControlStateAssembler {
  return Object.freeze({
    assembleControlState(
      _conn: DatabaseConnection,
      taskSpec: TaskContextSpec,
    ): Result<ControlStateContent> {
      const components: string[] = [
        `[mission_objective] Mission: ${taskSpec.missionId}`,
        `[task_definition] Task: ${taskSpec.taskId}`,
        `[budget_parameters] Budget: standard`,
        `[permission_policies] Permissions: default`,
        `[operational_constraints] Constraints: standard`,
      ];

      if (taskSpec.isChatMode) {
        components.push('[chat_mode] Chat mode active');
      }

      const canonicalText = components.join('\n');
      const tokenCost = Math.max(1, Math.ceil(canonicalText.length / 4));

      return ok({ canonicalText, tokenCost });
    },
  });
}

// ============================================================================
// Token Costing Service — §9, CGP-I11
// ============================================================================

function createTokenCostingService(): TokenCostingService {
  return Object.freeze({
    computeTokenCost(text: string, _costingBasis: CostingBasis): number {
      // DC-CGP-109: positive integer ≥ 1. Deterministic (I-72).
      return Math.max(1, Math.ceil(text.length / 4));
    },
    getCostingBasis(_modelId: string): CostingBasis {
      // DC-CGP-806: deterministic, same model → same basis
      return { tokenizerId: 'limen_v1', tokenizerVersion: '1.0.0' };
    },
  });
}

// ============================================================================
// Canonical Representation Renderer — §9.3
// ============================================================================

function createRenderer(): CanonicalRepresentationRenderer {
  return Object.freeze({
    renderWmpEntry(entry: WmpInternalEntry): string {
      return `[WMP:${entry.key}] ${entry.value}`;
    },
    renderArtifact(artifact: ArtifactCandidate): string {
      return `[Artifact:${artifact.artifactId}:v${artifact.version}:${artifact.format}] ${artifact.content}`;
    },
    renderClaim(claim: ClaimCandidate): string {
      return `[Claim:${claim.claimId}] ${claim.subject} ${claim.predicate} ${JSON.stringify(claim.object)} confidence=${claim.confidence} validAt=${claim.validAt} evidence=${claim.evidenceSummary.count}:${claim.evidenceSummary.types.join(',')}`;
    },
    renderMemory(memory: RetrievedMemory): string {
      return `[Memory:${memory.memoryId}:rank${memory.retrievalRank}] ${memory.content}`;
    },
    renderObservation(observation: ObservationCandidate): string {
      return `[Observation:${observation.observationId}:order${observation.productionOrder}] ${observation.content}`;
    },
  });
}

// ============================================================================
// Cross-Subsystem Reader Stubs — NOT YET IMPLEMENTED
// These throw NotImplementedError. The pipeline catches and degrades (DC-CGP-306).
// XSUB contract tests verify these stubs exist and throw correctly.
// ============================================================================

function createWmpInternalReader(): WmpInternalReader {
  return Object.freeze({
    readLiveEntries(_taskId: TaskId): Result<readonly WmpInternalEntry[]> {
      throw new NotImplementedError('WmpInternalReader.readLiveEntries');
    },
  });
}

function createArtifactCandidateCollector(): ArtifactCandidateCollector {
  return Object.freeze({
    collectCandidates(
      _conn: DatabaseConnection,
      _missionId: MissionId,
      _inputArtifactIds?: readonly ArtifactId[],
    ): Result<readonly ArtifactCandidate[]> {
      throw new NotImplementedError('ArtifactCandidateCollector.collectCandidates');
    },
  });
}

function createClaimCandidateCollector(): ClaimCandidateCollector {
  return Object.freeze({
    collectCandidates(
      _conn: DatabaseConnection,
      _missionId: MissionId,
      _temporalScope?: TemporalScope,
    ): Result<readonly ClaimCandidate[]> {
      throw new NotImplementedError('ClaimCandidateCollector.collectCandidates');
    },
  });
}

function createRetrievalOutputProvider(): RetrievalOutputProvider {
  return Object.freeze({
    getRetrievalResults(_invocationId: ContextInvocationId): Result<readonly RetrievedMemory[]> {
      throw new NotImplementedError('RetrievalOutputProvider.getRetrievalResults');
    },
  });
}

function createObservationCollector(): ObservationCollector {
  return Object.freeze({
    collectObservations(_taskId: TaskId): Result<readonly ObservationCandidate[]> {
      throw new NotImplementedError('ObservationCollector.collectObservations');
    },
  });
}

function createEcbProvider(): EcbProvider {
  return Object.freeze({
    computeECB(_params: {
      readonly modelId: string;
      readonly systemOverhead: number;
      readonly missionCeiling: number | null;
      readonly taskCeiling: number | null;
    }): Result<{ readonly effectiveContextBudget: number; readonly auditInputs: EcbAuditInputs }> {
      throw new NotImplementedError('EcbProvider.computeECB');
    },
  });
}

export function createConversationContextProvider(): ConversationContextProvider {
  return Object.freeze({
    getCurrentInstruction(_sessionId: SessionId): Result<string> {
      return ok('');
    },
    getHistoricalTurns(_conversationId: string): Result<readonly ConversationTurnForAdmission[]> {
      return ok([]);
    },
  });
}

// ============================================================================
// Safe provider call — catches throws and ok:false (DC-CGP-306)
// ============================================================================

function safeProviderCall<T>(fn: () => Result<T>): Result<T> {
  try {
    return fn();
  } catch {
    return err('PROVIDER_FAILURE', 'Provider threw during collection', '§5');
  }
}

// ============================================================================
// Replay Record Builder — §10.2
// ============================================================================

function buildReplayRecord(
  input: AdmissionAlgorithmInput,
  algorithmOutput: AdmissionAlgorithmOutput,
  positionCandidates: readonly PositionCandidateSet[],
  isChatMode: boolean,
  ecbAuditInputs?: EcbAuditInputs,
  nowMs?: number,
): ContextAdmissionRecord {
  const evictedIds = new Set(
    algorithmOutput.evictedCandidates.map(e => e.candidateId),
  );
  const evictedOrderMap = new Map<string, number>();
  for (const e of algorithmOutput.evictedCandidates) {
    evictedOrderMap.set(e.candidateId, e.evictionOrder);
  }

  const positions: PositionReplayEntry[] = (
    [2, 3, 4, 5, 6] as EvictablePosition[]
  ).map(posNum => {
    const posSet = positionCandidates.find(p => p.positionNumber === posNum);
    const applicable =
      isChatMode && (posNum === 2 || posNum === 3 || posNum === 4 || posNum === 6)
        ? false
        : (posSet?.applicable ?? true);

    const candidates: CandidateReplayEntry[] = (posSet?.candidates ?? []).map(
      c => ({
        candidateId: c.candidateId,
        candidateType: c.candidateType,
        tokenCost: c.tokenCost,
        protectionStatus: c.protectionStatus,
        orderingInputs: c.orderingInputs,
        result: evictedIds.has(c.candidateId)
          ? ('evicted' as const)
          : ('admitted' as const),
        evictionOrder: evictedOrderMap.get(c.candidateId) ?? null,
      }),
    );

    const admittedInPos = candidates.filter(c => c.result === 'admitted');
    const protectedInPos = candidates.filter(
      c => c.protectionStatus === 'governed_required',
    );
    const evictedInPos = candidates.filter(c => c.result === 'evicted');

    return {
      positionNumber: posNum,
      applicable,
      candidates,
      candidateCount: candidates.length,
      protectedCount: protectedInPos.length,
      evictedCount: evictedInPos.length,
      admittedTokenCost: admittedInPos.reduce((sum, c) => sum + c.tokenCost, 0),
    };
  });

  return Object.freeze({
    invocationId: input.invocationId,
    taskId: input.taskId,
    missionId: input.missionId,
    effectiveContextBudget: input.effectiveContextBudget,
    costingBasis: input.costingBasis,
    position1: Object.freeze({
      applicable: true as const,
      tokenCost: input.controlState.tokenCost,
      result: 'admitted' as const,
    }),
    positions: Object.freeze(
      positions.map(p =>
        Object.freeze({
          ...p,
          candidates: Object.freeze(p.candidates.map(c => Object.freeze(c))),
        }),
      ),
    ),
    totalAdmittedCost: algorithmOutput.totalAdmittedCost,
    admissionResult: algorithmOutput.admissionResult,
    timestamp: nowMs ?? Date.now(),
    ...(ecbAuditInputs ? { ecbAuditInputs: Object.freeze(ecbAuditInputs) } : {}),
  });
}

// ============================================================================
// Factory — ContextGovernor
// ============================================================================

// ============================================================================
// Stub AuditTrail/EventBus — used when no real deps injected (unit isolation)
// ============================================================================

function createStubAuditTrail(): AuditTrail {
  return {
    append(_conn: DatabaseConnection, _input: AuditCreateInput) {
      return ok({
        seqNo: 0, id: 'stub-audit-id', tenantId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        actorType: 'system' as const, actorId: 'cgp',
        operation: 'stub', resourceType: 'stub', resourceId: 'stub',
        detail: null, previousHash: '', currentHash: '',
      });
    },
    appendBatch(_conn: DatabaseConnection, _inputs: AuditCreateInput[]) { return ok([]); },
    query() { return ok([]); },
    verifyChain() { return ok({ valid: true, totalEntries: 0, firstSeqNo: 0, lastSeqNo: 0, brokenAt: null, expectedHash: null, actualHash: null, gaps: [] }); },
    archive() { return err('NOT_IMPLEMENTED', 'stub', '§3.5'); },
    getChainHead() { return ok(''); },
    tombstone() { return ok({ tombstonedEntries: 0, rehashedEntries: 0, chainValid: true }); },
  } as AuditTrail;
}

function createStubEventBus(): EventBus {
  return {
    emit(_conn: DatabaseConnection, _ctx: OperationContext, _event: EventPayload) {
      return ok('stub-event-id' as unknown);
    },
    subscribe() { return ok('stub-sub-id'); },
    unsubscribe() { return ok(undefined); },
    registerWebhook() { return ok('stub-webhook-id'); },
    processWebhooks() { return ok({ delivered: 0, failed: 0, exhausted: 0 }); },
  } as EventBus;
}

// ============================================================================
// System OperationContext for CGP internal operations
// ============================================================================

function createCgpOperationContext(): OperationContext {
  // CGP is a system-level subsystem — operates with system identity.
  // EventBus.emit() and AuditTrail.append() are kernel operations
  // invoked by system actors, not user-facing RBAC operations.
  return {
    tenantId: null,
    userId: null,
    agentId: null,
    permissions: new Set(),
  };
}

export function createContextGovernor(deps?: Partial<CGPDeps>): ContextGovernor {
  const algorithm = createAdmissionAlgorithm();
  const controlStateAssembler = createControlStateAssembler();
  const tokenCostingService = createTokenCostingService();
  const renderer = createRenderer();

  const wmpReader = deps?.wmpReader ?? createWmpInternalReader();
  const artifactCollector = deps?.artifactCollector ?? createArtifactCandidateCollector();
  const claimCollector = deps?.claimCollector ?? createClaimCandidateCollector();
  const retrievalProvider = deps?.retrievalProvider ?? createRetrievalOutputProvider();
  const observationCollector = deps?.observationCollector ?? createObservationCollector();
  const ecbProvider = deps?.ecbProvider ?? createEcbProvider();
  const audit = deps?.audit ?? createStubAuditTrail();
  const events = deps?.events ?? createStubEventBus();

  // ── Internal pipeline — shared by admitContext and admitContextWithLiveBudget ──
  function runAdmissionPipeline(
    conn: DatabaseConnection,
    taskSpec: TaskContextSpec,
    effectiveContextBudget: number,
    modelId: string,
    invocationId: ContextInvocationId,
    ecbAuditData?: EcbAuditInputs,
  ): Result<ContextAdmissionPipelineResult> {
    // ── Validation: DC-CGP-X10 — empty taskId/missionId ──
    if (!taskSpec.taskId || !taskSpec.missionId) {
      return err(
        'INVALID_TASK_CONTEXT',
        'taskId and missionId must be non-empty',
        '§6.2',
      );
    }

    // ── Validation: DC-CGP-X13 — terminal task state guard ──
    const terminalStates = ['completed', 'failed', 'cancelled'];
    if (taskSpec.taskState && terminalStates.includes(taskSpec.taskState)) {
      return err(
        'TASK_TERMINATED',
        `Task ${taskSpec.taskId} is in terminal state: ${taskSpec.taskState}`,
        '§6.2',
      );
    }

    // ── Validation: DC-CGP-905 — inputArtifactIds limit ──
    if (
      taskSpec.inputArtifactIds &&
      taskSpec.inputArtifactIds.length > CGP_MAX_INPUT_ARTIFACT_IDS
    ) {
      return err(
        'MAX_INPUT_ARTIFACT_IDS_EXCEEDED',
        `inputArtifactIds count ${taskSpec.inputArtifactIds.length} exceeds limit of ${CGP_MAX_INPUT_ARTIFACT_IDS}`,
        '§6.2',
      );
    }

    // ── Step 1: Assemble P1 control state ──
    const p1Result = controlStateAssembler.assembleControlState(conn, taskSpec);
    if (!p1Result.ok) {
      return err(p1Result.error.code, p1Result.error.message, p1Result.error.spec);
    }
    const controlState = p1Result.value;

    // ── Get costing basis ──
    const costingBasis = tokenCostingService.getCostingBasis(modelId);

    // ── Step 2: Collect candidates — single transaction (DC-CGP-307) ──
    const positionCandidates: PositionCandidateSet[] = conn.transaction(() => {
      const positions: PositionCandidateSet[] = [];

      // P2: WMP entries
      if (taskSpec.isChatMode) {
        positions.push({ positionNumber: 2, applicable: false, candidates: [] });
      } else {
        const wmpResult = safeProviderCall(() =>
          wmpReader.readLiveEntries(taskSpec.taskId),
        );
        if (wmpResult.ok) {
          const p2Candidates: CandidateRepresentation[] = wmpResult.value.map(
            entry => {
              const canonicalText = renderer.renderWmpEntry(entry);
              return {
                candidateId: entry.key,
                candidateType: 'wmp_entry' as const,
                canonicalText,
                tokenCost: tokenCostingService.computeTokenCost(
                  canonicalText,
                  costingBasis,
                ),
                protectionStatus: 'non_protected' as const,
                orderingInputs: {
                  mutationPosition: entry.mutationPosition,
                  updatedAt: entry.updatedAt,
                  key: entry.key,
                },
              };
            },
          );
          positions.push({
            positionNumber: 2,
            applicable: true,
            candidates: p2Candidates,
          });
        } else {
          // DC-CGP-306: degraded
          positions.push({
            positionNumber: 2,
            applicable: true,
            candidates: [],
          });
        }
      }

      // P3: Artifacts
      if (taskSpec.isChatMode) {
        positions.push({ positionNumber: 3, applicable: false, candidates: [] });
      } else {
        const artResult = safeProviderCall(() =>
          artifactCollector.collectCandidates(
            conn,
            taskSpec.missionId,
            taskSpec.inputArtifactIds,
          ),
        );
        if (artResult.ok) {
          const p3Candidates: CandidateRepresentation[] = artResult.value.map(
            artifact => {
              const canonicalText = renderer.renderArtifact(artifact);
              const isProtected =
                taskSpec.inputArtifactIds?.some(
                  id => id === artifact.artifactId,
                ) ?? false;
              return {
                candidateId: artifact.artifactId as string,
                candidateType: 'artifact' as const,
                canonicalText,
                tokenCost: tokenCostingService.computeTokenCost(
                  canonicalText,
                  costingBasis,
                ),
                protectionStatus: isProtected
                  ? ('governed_required' as const)
                  : ('non_protected' as const),
                orderingInputs: {
                  createdAt: artifact.createdAt,
                  artifactId: artifact.artifactId as string,
                },
              };
            },
          );
          positions.push({
            positionNumber: 3,
            applicable: true,
            candidates: p3Candidates,
          });
        } else {
          positions.push({
            positionNumber: 3,
            applicable: true,
            candidates: [],
          });
        }
      }

      // P4: Claims — independent collection via missionId (I-74)
      if (taskSpec.isChatMode) {
        positions.push({ positionNumber: 4, applicable: false, candidates: [] });
      } else {
        const claimResult = safeProviderCall(() =>
          claimCollector.collectCandidates(
            conn,
            taskSpec.missionId,
            taskSpec.temporalScope,
          ),
        );
        if (claimResult.ok) {
          const p4Candidates: CandidateRepresentation[] =
            claimResult.value.map(claim => {
              const canonicalText = renderer.renderClaim(claim);
              return {
                candidateId: claim.claimId as string,
                candidateType: 'claim' as const,
                canonicalText,
                tokenCost: tokenCostingService.computeTokenCost(
                  canonicalText,
                  costingBasis,
                ),
                protectionStatus: 'non_protected' as const,
                orderingInputs: {
                  createdAt: claim.createdAt,
                  claimId: claim.claimId as string,
                },
              };
            });
          positions.push({
            positionNumber: 4,
            applicable: true,
            candidates: p4Candidates,
          });
        } else {
          positions.push({
            positionNumber: 4,
            applicable: true,
            candidates: [],
          });
        }
      }

      // P5: Retrieval (memories + conversation)
      {
        const retResult = safeProviderCall(() =>
          retrievalProvider.getRetrievalResults(invocationId),
        );
        if (retResult.ok) {
          const p5Candidates: CandidateRepresentation[] = retResult.value.map(
            memory => {
              const canonicalText = renderer.renderMemory(memory);
              return {
                candidateId: memory.memoryId as string,
                candidateType: 'memory' as const,
                canonicalText,
                tokenCost: tokenCostingService.computeTokenCost(
                  canonicalText,
                  costingBasis,
                ),
                protectionStatus: 'non_protected' as const,
                orderingInputs: {
                  retrievalRank: memory.retrievalRank,
                  memoryId: memory.memoryId as string,
                },
              };
            },
          );
          positions.push({
            positionNumber: 5,
            applicable: true,
            candidates: p5Candidates,
          });
        } else {
          positions.push({
            positionNumber: 5,
            applicable: true,
            candidates: [],
          });
        }
      }

      // P6: Observations — §51.4: chat mode reduces to P1+P5, P6 inapplicable
      if (taskSpec.isChatMode) {
        positions.push({
          positionNumber: 6,
          applicable: false,
          candidates: [],
        });
      } else {
        const obsResult = safeProviderCall(() =>
          observationCollector.collectObservations(taskSpec.taskId),
        );
        if (obsResult.ok) {
          const p6Candidates: CandidateRepresentation[] = obsResult.value.map(
            obs => {
              const canonicalText = renderer.renderObservation(obs);
              return {
                candidateId: obs.observationId as string,
                candidateType: 'observation' as const,
                canonicalText,
                tokenCost: tokenCostingService.computeTokenCost(
                  canonicalText,
                  costingBasis,
                ),
                protectionStatus: 'non_protected' as const,
                orderingInputs: {
                  productionOrder: obs.productionOrder,
                  observationId: obs.observationId as string,
                },
              };
            },
          );
          positions.push({
            positionNumber: 6,
            applicable: true,
            candidates: p6Candidates,
          });
        } else {
          positions.push({
            positionNumber: 6,
            applicable: true,
            candidates: [],
          });
        }
      }

      return positions;
    });

    // ── Step 3: Build algorithm input ──
    const algorithmInput: AdmissionAlgorithmInput = {
      invocationId,
      taskId: taskSpec.taskId,
      missionId: taskSpec.missionId,
      effectiveContextBudget,
      costingBasis,
      controlState,
      positionCandidates,
    };

    // ── Step 4: Execute admission algorithm ──
    const algorithmOutput = algorithm.execute(algorithmInput);

    // ── Step 5: Build replay record ──
    const replayRecord = buildReplayRecord(
      algorithmInput,
      algorithmOutput,
      positionCandidates,
      taskSpec.isChatMode,
      ecbAuditData,
      deps?.time?.nowMs(),
    );

    // ── Step 6: Persist audit + emit events — atomic (DC-CGP-507, I-03) ──
    // Audit persistence and event emission must be in the SAME transaction.
    // If either fails, both roll back.
    const persistResult = conn.transaction(() => {
      // ── 6a: Persist replay record to AuditTrail (DC-CGP-501, I-03) ──
      const auditInput: AuditCreateInput = {
        tenantId: null,
        actorType: 'system',
        actorId: 'cgp',
        operation: 'context_admission',
        resourceType: 'context_admission_record',
        resourceId: invocationId as string,
        detail: {
          invocationId: replayRecord.invocationId,
          taskId: replayRecord.taskId,
          missionId: replayRecord.missionId,
          admissionResult: replayRecord.admissionResult,
          totalAdmittedCost: replayRecord.totalAdmittedCost,
          effectiveContextBudget: replayRecord.effectiveContextBudget,
          positions: replayRecord.positions.map(p => ({
            positionNumber: p.positionNumber,
            applicable: p.applicable,
            candidateCount: p.candidateCount,
            protectedCount: p.protectedCount,
            evictedCount: p.evictedCount,
            admittedTokenCost: p.admittedTokenCost,
          })),
        },
      };

      const auditResult = audit.append(conn, auditInput);
      if (!auditResult.ok) {
        return err<ContextAdmissionPipelineResult>(
          'AUDIT_PERSISTENCE_FAILED',
          `Failed to persist admission replay record: ${auditResult.error.message}`,
          '§10.2, I-03',
        );
      }

      // ── 6b: Emit events (DC-CGP-502/503/504) ──
      const cgpCtx = createCgpOperationContext();

      if (algorithmOutput.admissionResult === 'success') {
        // DC-CGP-502: Emit CONTEXT_ADMITTED on success
        const admittedPayload: ContextAdmittedEventPayload = {
          invocationId,
          taskId: taskSpec.taskId,
          missionId: taskSpec.missionId,
          totalAdmittedCost: algorithmOutput.totalAdmittedCost,
          effectiveContextBudget,
          evictedCount: algorithmOutput.evictedCandidates.length,
          correlationId: invocationId as string,
        };

        const emitResult = events.emit(conn, cgpCtx, {
          type: CGP_EVENTS.CONTEXT_ADMITTED,
          scope: 'task',
          missionId: taskSpec.missionId,
          payload: admittedPayload as unknown as Record<string, unknown>,
          propagation: 'up',
        });

        if (!emitResult.ok) {
          return err<ContextAdmissionPipelineResult>(
            'EVENT_EMISSION_FAILED',
            `Failed to emit context_admitted event: ${emitResult.error.message}`,
            '§CGP, DC-CGP-502',
          );
        }

        // DC-CGP-504: Detect position starvation — ALL non-protected candidates evicted from a position
        for (const posEntry of replayRecord.positions) {
          if (!posEntry.applicable) continue;
          const totalNonProtected = posEntry.candidates.filter(
            c => c.protectionStatus === 'non_protected',
          ).length;
          if (totalNonProtected > 0 && posEntry.evictedCount === totalNonProtected) {
            // All non-protected candidates in this position were evicted
            const starvationPayload: PositionStarvationEventPayload = {
              invocationId,
              taskId: taskSpec.taskId,
              positionNumber: posEntry.positionNumber as EvictablePosition,
              evictedCount: posEntry.evictedCount,
              correlationId: invocationId as string,
            };

            const starvResult = events.emit(conn, cgpCtx, {
              type: CGP_EVENTS.POSITION_STARVATION,
              scope: 'task',
              missionId: taskSpec.missionId,
              payload: starvationPayload as unknown as Record<string, unknown>,
              propagation: 'up',
            });

            if (!starvResult.ok) {
              return err<ContextAdmissionPipelineResult>(
                'EVENT_EMISSION_FAILED',
                `Failed to emit position_starvation event: ${starvResult.error.message}`,
                '§CGP, DC-CGP-504',
              );
            }
          }
        }
      } else {
        // DC-CGP-503: Emit CONTEXT_ADMISSION_FAILED on overflow
        const failedPayload: ContextAdmissionFailedEventPayload = {
          invocationId,
          taskId: taskSpec.taskId,
          missionId: taskSpec.missionId,
          admissionResult: algorithmOutput.admissionResult as 'CONTROL_STATE_OVERFLOW' | 'CONTEXT_PROTECTION_OVERFLOW',
          position1Cost: algorithmOutput.position1Cost,
          effectiveContextBudget,
          correlationId: invocationId as string,
        };

        const emitResult = events.emit(conn, cgpCtx, {
          type: CGP_EVENTS.CONTEXT_ADMISSION_FAILED,
          scope: 'task',
          missionId: taskSpec.missionId,
          payload: failedPayload as unknown as Record<string, unknown>,
          propagation: 'up',
        });

        if (!emitResult.ok) {
          return err<ContextAdmissionPipelineResult>(
            'EVENT_EMISSION_FAILED',
            `Failed to emit admission_failed event: ${emitResult.error.message}`,
            '§CGP, DC-CGP-503',
          );
        }
      }

      // Both audit and events succeeded — return success signal
      return ok<ContextAdmissionPipelineResult>(undefined as unknown as ContextAdmissionPipelineResult);
    });

    // If the atomic persist+emit transaction failed, return the error
    if (!persistResult.ok) {
      return persistResult;
    }

    // ── Step 7: Return frozen pipeline result ──
    const pipelineResult: ContextAdmissionPipelineResult = Object.freeze({
      controlState: Object.freeze(controlState),
      admittedCandidates: algorithmOutput.admittedCandidates,
      replayRecord,
      admissionResult: algorithmOutput.admissionResult,
    });

    return ok(pipelineResult);
  }

  return Object.freeze({
    algorithm,
    controlStateAssembler,
    tokenCostingService,
    renderer,
    wmpReader,
    artifactCollector,
    claimCollector,
    retrievalProvider,
    observationCollector,

    admitContext(
      conn: DatabaseConnection,
      taskSpec: TaskContextSpec,
      effectiveContextBudget: number,
      modelId: string,
      invocationId: ContextInvocationId,
    ): Result<ContextAdmissionPipelineResult> {
      return runAdmissionPipeline(conn, taskSpec, effectiveContextBudget, modelId, invocationId);
    },


    admitContextWithLiveBudget(
      conn: DatabaseConnection,
      taskSpec: TaskContextSpec,
      modelId: string,
      invocationId: ContextInvocationId,
      budgetInputs: BudgetComputationInputs,
    ): Result<ContextAdmissionPipelineResult> {
      // ── Step 0: Compute ECB from DBA (I-52: fresh per invocation) ──
      // DC-ECB-011: DBA failure = admission failure. No graceful degradation.
      let ecbResult: Result<{ readonly effectiveContextBudget: number; readonly auditInputs: EcbAuditInputs }>;
      try {
        ecbResult = ecbProvider.computeECB({
          modelId,
          systemOverhead: budgetInputs.systemOverhead,
          ...(budgetInputs.overheadBreakdown ? { overheadBreakdown: budgetInputs.overheadBreakdown } : {}),
          missionCeiling: budgetInputs.missionCeiling,
          taskCeiling: budgetInputs.taskCeiling,
        });
      } catch (providerErr: unknown) {
        return err(
          'ECB_COMPUTATION_FAILED',
          `EcbProvider threw: ${providerErr instanceof Error ? providerErr.message : String(providerErr)}`,
          '§53.2, I-53',
        );
      }

      if (!ecbResult.ok) {
        return err(
          ecbResult.error.code,
          ecbResult.error.message,
          ecbResult.error.spec,
        );
      }

      const { effectiveContextBudget, auditInputs: ecbAuditInputs } = ecbResult.value;

      // ── F-01 guard: ECB must be finite and non-negative (I-53, §53.2) ──
      // The DBA formula guarantees this via clamping (DBA-I14), but the EcbProvider
      // boundary is a trust boundary — we validate the contract here.
      // NaN silently corrupts all comparisons; Infinity bypasses all budget enforcement.
      if (!Number.isFinite(effectiveContextBudget) || effectiveContextBudget < 0) {
        return err(
          'ECB_COMPUTATION_FAILED',
          `EcbProvider returned invalid ECB value: ${effectiveContextBudget}`,
          '§53.2, I-53',
        );
      }

      // ── Delegate to admitContext with computed ECB ──
      const pipelineResult = runAdmissionPipeline(
        conn, taskSpec, effectiveContextBudget, modelId, invocationId, ecbAuditInputs,
      );

      return pipelineResult;
    },
  });
}
