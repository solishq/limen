/**
 * Limen — LearningCycleOrchestrator Implementation
 * Phase 4E-2f: Final Learning System Sub-Phase
 *
 * Implements the LearningCycleOrchestrator interface from learning_types.ts.
 * Orchestrates the §29.3 extraction pipeline:
 *   collect → extract (per candidate) → confidence update → retirement sweep → specialization check
 *
 * S ref: S29.3 (learning cycle), S29.5 (confidence tracking), S29.6 (retirement),
 *        S29.10 (over-specialization), DEC-4E-003 (HITL confidence 1.0)
 *
 * Engineering decisions:
 *   D1: Pipeline order: collect → extract → confidence update (all active) → retirement sweep
 *       → specialization check. Per §29.3 interface comment: "collect -> extract -> dedup -> store
 *       -> track -> retire -> check specialization." Extract internally handles dedup + store.
 *       Track = updateConfidence for all active techniques with recorded outcomes.
 *   D2: HITL mechanism: when trigger === 'hitl_correction', after extractAndStore creates a novel
 *       technique (non-null return), call store.update() to override confidence to HITL_CONFIDENCE
 *       (1.0). The extractor creates at INITIAL_CONFIDENCE_EXTRACTED (0.5) — the orchestrator
 *       applies the HITL override because the trigger context is only visible here.
 *   D3: Cycle state: in-memory Map<string, string> keyed by agentId:tenantId. Limen is a library
 *       (SEC-004), not a server. State lives as long as the LearningSystem instance. Set AFTER
 *       cycle completes successfully (not before — failed cycles don't update timestamp).
 *   D4: Error handling: best-effort per candidate. collectCandidates failure aborts cycle (no
 *       candidates = no pipeline). Per-candidate extractAndStore failure is logged and skipped.
 *       LearningCycleResult has count fields → design intent is partial results.
 *   D5: Event emission: §29.3 interface comment says "Emits learning.cycle.completed event on
 *       completion." Guarded: only emits if deps.events.emit is a function. Test stubs use
 *       {} as EventBus — calling emit on stub would throw TypeError. Event is best-effort;
 *       cycle success does not depend on event delivery.
 *   D6: Confidence update scope: updateConfidence for all active techniques. With no outcomes,
 *       tracker returns current confidence unchanged (no DB write). Safe to call for all.
 *   D7: tenantId: extracted from ctx.tenantId. runCycle's interface takes agentId directly;
 *       tenantId comes from the OperationContext (same pattern as all Limen operations).
 */

import { randomUUID } from 'node:crypto';
import type {
  LearningCycleOrchestrator, LearningCycleResult, LearningCycleTrigger,
  TechniqueStore, TechniqueExtractor, EffectivenessTracker,
  RetirementEvaluator, OverSpecializationDetector,
  LearningDeps,
} from '../interfaces/index.js';
import { HITL_CONFIDENCE } from '../interfaces/index.js';
import type {
  DatabaseConnection, OperationContext, Result,
  AgentId, TenantId,
} from '../../kernel/interfaces/index.js';

// ─── Factory ───

/**
 * Create a LearningCycleOrchestrator implementation.
 * Follows the Limen store pattern: factory → Object.freeze.
 *
 * §29.3: Orchestrates the full learning cycle pipeline.
 * All subsystems are injected — the orchestrator has no direct DB access.
 */
export function createLearningCycleOrchestrator(
  deps: LearningDeps,
  store: TechniqueStore,
  extractor: TechniqueExtractor,
  tracker: EffectivenessTracker,
  retirement: RetirementEvaluator,
  specialization: OverSpecializationDetector,
): LearningCycleOrchestrator {

  // D3: In-memory cycle time tracking (per agent+tenant instance)
  const lastCycleTimes = new Map<string, string>();

  function cycleKey(agentId: AgentId, tenantId: TenantId): string {
    return `${agentId}:${tenantId}`;
  }

  // ─── runCycle ───

  async function runCycle(
    conn: DatabaseConnection,
    ctx: OperationContext,
    agentId: AgentId,
    trigger: LearningCycleTrigger,
  ): Promise<Result<LearningCycleResult>> {
    const tenantId = ctx.tenantId as TenantId;
    const cycleId = randomUUID();
    const now = deps.time.nowISO();

    // Determine since-timestamp for candidate collection
    const lastTime = lastCycleTimes.get(cycleKey(agentId, tenantId)) ?? '1970-01-01T00:00:00.000Z';

    // ── Step 1: Collect candidates (§29.3 Step 1) ──
    const candidatesResult = extractor.collectCandidates(conn, ctx, agentId, lastTime);
    if (!candidatesResult.ok) {
      return candidatesResult as Result<LearningCycleResult>;
    }

    const candidates = candidatesResult.value;
    let techniquesExtracted = 0;
    let duplicatesReinforced = 0;

    // ── Step 2: Extract and store each candidate (§29.3 Steps 2-4) ──
    // D4: Best-effort per candidate — LLM failure for one doesn't abort cycle
    for (const candidate of candidates) {
      const extractResult = await extractor.extractAndStore(conn, ctx, candidate);

      if (!extractResult.ok) {
        // Per-candidate failure: skip, continue with remaining candidates
        continue;
      }

      if (extractResult.value !== null) {
        // Novel technique created
        techniquesExtracted++;

        // D2: HITL override — set confidence to 1.0 for HITL-triggered cycles
        if (trigger === 'hitl_correction') {
          store.update(conn, ctx, extractResult.value.id, tenantId, {
            confidence: HITL_CONFIDENCE, // 1.0 per DEC-4E-003
          });
        }
      } else {
        // Duplicate reinforced (EMA applied by extractor)
        duplicatesReinforced++;
      }
    }

    // ── Step 3: Confidence update for all active techniques (§29.5 "track") ──
    // D6: updateConfidence is a no-op when no outcomes exist — safe to call for all
    const activeTechniques = store.getByAgent(conn, agentId, tenantId, 'active');
    if (activeTechniques.ok) {
      for (const technique of activeTechniques.value) {
        tracker.updateConfidence(conn, ctx, technique.id, tenantId);
        // Errors ignored per D4 — confidence update is best-effort within cycle
      }
    }

    // ── Step 4: Retirement sweep (§29.6) ──
    let techniquesRetired = 0;
    const retirementResult = retirement.evaluateAll(conn, agentId, tenantId);
    if (retirementResult.ok) {
      for (const decision of retirementResult.value) {
        if (decision.shouldRetire && decision.reason !== null) {
          const retireResult = store.retire(conn, ctx, decision.techniqueId, tenantId, decision.reason);
          if (retireResult.ok) {
            techniquesRetired++;
          }
        }
      }
    }

    // ── Step 5: Over-specialization check (§29.10) ──
    const specResult = specialization.analyze(conn, agentId, tenantId);
    const overSpecializationDetected = specResult.ok ? specResult.value.overSpecialized : false;

    // Build result
    const cycleResult: LearningCycleResult = {
      cycleId,
      agentId,
      tenantId,
      trigger,
      candidatesEvaluated: candidates.length,
      techniquesExtracted,
      duplicatesReinforced,
      techniquesRetired,
      overSpecializationDetected,
      timestamp: now,
    };

    // D3: Record cycle time AFTER successful completion
    lastCycleTimes.set(cycleKey(agentId, tenantId), now);

    // D5: Emit event (best-effort — guarded against stub EventBus)
    if (typeof deps.events?.emit === 'function') {
      try {
        deps.events.emit(conn, ctx, {
          type: 'learning.cycle.completed',
          scope: 'system',
          payload: {
            cycleId,
            agentId,
            tenantId,
            trigger,
            techniquesExtracted,
            duplicatesReinforced,
            techniquesRetired,
            overSpecializationDetected,
          },
          propagation: 'local',
        });
      } catch {
        // Event emission failure does not fail the cycle
      }
    }

    return { ok: true, value: cycleResult };
  }

  // ─── getLastCycleTime ───

  function getLastCycleTime(
    _conn: DatabaseConnection,
    agentId: AgentId,
    tenantId: TenantId,
  ): Result<string | null> {
    const key = cycleKey(agentId, tenantId);
    return {
      ok: true,
      value: lastCycleTimes.get(key) ?? null,
    };
  }

  return Object.freeze({ runCycle, getLastCycleTime });
}
