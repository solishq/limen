/**
 * WMP (Working Memory Protocol) harness — thin factory + cross-subsystem wiring.
 * Spec ref: WMP v1.0 Design Source (FINAL DRAFT), C-07 (Object.freeze)
 *
 * Phase: v3.3.0 — Working Memory Protocol Truth Model
 * Pattern P-010: Business logic lives in stores (wmp_stores.ts), not here.
 *
 * This harness provides:
 *   1. Factory — assembles WorkingMemorySystem from store implementations
 *   2. Cross-subsystem adapters — CGP internal reader, CCP pre-emission capture
 *   3. Re-exports — NotImplementedError for backward compatibility
 *
 * EXISTING v3.2 DEPENDENCIES:
 *   - TaskStore (src/orchestration/tasks/task_store.ts) — task state validation
 *   - AuditTrail (src/kernel/audit/audit_trail.ts) — boundary event persistence
 *   - EventBus (src/kernel/events/event_bus.ts) — system event emission
 *   - CheckpointCoordinator (src/orchestration/checkpoints/) — Trigger 1 wiring
 *   - CCP ClaimSystem (src/claims/) — Trigger 4 wiring
 *   - CGP ContextGovernor (src/context/) — P2 internal reader wiring
 */

import type {
  WorkingMemorySystem,
  WmpSystemDeps,
  WmpCapacityPolicy,
  WmpEventSink,
} from '../interfaces/wmp_types.js';

import { WMP_NULL_EVENT_SINK } from '../interfaces/wmp_types.js';

// Cross-subsystem adapter types
import type { WmpInternalReader } from '../../context/interfaces/cgp_types.js';
import type { WmpPreEmissionCapture } from '../../claims/interfaces/claim_types.js';

// Store creators — P-010: all business logic lives in stores
import {
  NotImplementedError,
  createEntryStore,
  createBoundaryStore,
  createMutationCounter,
  createBoundaryCaptureCoordinator,
  createWriteHandler,
  createReadHandler,
  createDiscardHandler,
  createTaskLifecycleHandler,
  createInternalReader,
  createPreEmissionCaptureImpl,
} from '../stores/wmp_stores.js';

// Re-export for backward compatibility (tests import from harness)
export { NotImplementedError };

// ============================================================================
// Cross-Subsystem Adapters — CGP + CCP wiring
// ============================================================================

/**
 * WMP adapter implementing WmpInternalReader (CGP §9.2).
 * Provides P2 candidate entries to the context admission runtime.
 */
export function createWmpInternalReader(): WmpInternalReader {
  return createInternalReader();
}

/**
 * WMP adapter implementing WmpPreEmissionCapture (CCP §6.4 Trigger 4).
 * Provides pre-emission boundary capture for SC-11/SC-4/SC-9.
 */
export function createWmpPreEmissionCapture(): WmpPreEmissionCapture {
  const entryStore = createEntryStore();
  const boundaryStore = createBoundaryStore();
  const mutationCounter = createMutationCounter();
  const coordinator = createBoundaryCaptureCoordinator(entryStore, boundaryStore, mutationCounter);  // no eventSink — standalone adapter
  return createPreEmissionCaptureImpl(entryStore, coordinator);
}

// ============================================================================
// Factory — assembles the complete WMP system from store implementations
// ============================================================================

/**
 * Create a WorkingMemorySystem backed by SQLite stores.
 *
 * @param deps External dependencies (audit, events, capacity policy)
 * @returns Frozen WorkingMemorySystem — all methods delegate to store implementations
 */
export function createWorkingMemorySystem(
  deps?: Partial<WmpSystemDeps>,
): WorkingMemorySystem {
  const capacityPolicy: WmpCapacityPolicy = deps?.capacityPolicy ?? {
    maxEntries: 100,
    maxBytesPerEntry: 65536,
    maxTotalBytes: 262144,
  };
  const eventSink: WmpEventSink = deps?.eventSink ?? WMP_NULL_EVENT_SINK;

  // Create store instances
  const time = deps?.time;
  const entryStore = createEntryStore(time);
  const boundaryStore = createBoundaryStore(time);
  const mutationCounter = createMutationCounter();
  const coordinator = createBoundaryCaptureCoordinator(entryStore, boundaryStore, mutationCounter, eventSink, time);

  return Object.freeze({
    write: createWriteHandler(entryStore, mutationCounter, capacityPolicy, eventSink),
    read: createReadHandler(entryStore),
    discard: createDiscardHandler(entryStore, mutationCounter, eventSink),
    boundary: coordinator,
    entryStore,
    boundaryStore,
    mutationCounter,
    capacityPolicy: Object.freeze(capacityPolicy),
    taskLifecycle: createTaskLifecycleHandler(coordinator, entryStore),
  });
}
