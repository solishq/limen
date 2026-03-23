/**
 * Limen — Learning System (S29) Harness
 * Phase 4E-2f: All 10 Subsystems REAL
 *
 * 10/10 subsystems are REAL implementations. Zero stubs.
 *
 * S ref: S29, Amendment 2 Control 3 (Executable Contract, Interface-First)
 *
 * Wiring history:
 *   4E-2a: TechniqueStore (real)
 *   4E-2b: TechniqueExtractor (real)
 *   4E-2c: TechniqueApplicator (real)
 *   4E-2d: EffectivenessTracker + RetirementEvaluator (real)
 *   4E-2e: QuarantineManager + CrossAgentTransfer + OverSpecializationDetector + ColdStartManager (real)
 *   4E-2f: LearningCycleOrchestrator (real) — FINAL
 */

import type {
  LearningSystem,
  LearningDeps,
} from '../interfaces/index.js';
import { createTechniqueStore } from '../store/technique_store.js';
import { createTechniqueExtractor } from '../extractor/technique_extractor.js';
import { createTechniqueApplicator } from '../applicator/technique_applicator.js';
import { createEffectivenessTracker } from '../tracker/effectiveness_tracker.js';
import { createRetirementEvaluator } from '../retirement/retirement_evaluator.js';
import { createQuarantineManager } from '../quarantine/quarantine_manager.js';
import { createCrossAgentTransfer } from '../transfer/cross_agent_transfer.js';
import { createOverSpecializationDetector } from '../specialization/over_specialization_detector.js';
import { createColdStartManager } from '../cold_start/cold_start_manager.js';
import { createLearningCycleOrchestrator } from '../cycle/learning_cycle_orchestrator.js';

// ─── Error Type (retained for test backward compatibility) ───

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`NOT_IMPLEMENTED: LearningSystem.${method}`);
    this.name = 'NotImplementedError';
  }
}

// ─── Factory ───

/**
 * Create the LearningSystem with all 10 implemented subsystems.
 * 10/10 real. Zero stubs. §29 complete.
 */
export function createLearningSystem(deps: LearningDeps): LearningSystem {
  const store = createTechniqueStore(deps);
  const extractor = createTechniqueExtractor(deps, store);
  const tracker = createEffectivenessTracker(deps, store);
  const retirement = createRetirementEvaluator(deps);
  const specialization = createOverSpecializationDetector(store);

  return Object.freeze({
    store,
    extractor,
    applicator: createTechniqueApplicator(deps, store),
    tracker,
    retirement,
    quarantine: createQuarantineManager(deps, store),
    transfer: createCrossAgentTransfer(deps, store),
    specialization,
    coldStart: createColdStartManager(store),
    cycle: createLearningCycleOrchestrator(deps, store, extractor, tracker, retirement, specialization),
  });
}
