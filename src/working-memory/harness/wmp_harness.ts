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
 *
 * v2.1.0: InstanceContext threading for C-06 independent instances.
 * wmpConnectionRef and monotonicClock are threaded through all factories.
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
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';

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
// Module-Level Shared Connection Reference
// ============================================================================
//
// When createWorkingMemorySystem() and createWmpInternalReader() are both called
// without an explicit wmpConnectionRef (the test pattern), they must share the
// same connection reference so that write.execute(conn, ...) — which sets
// connRef.current = conn — makes the connection visible to the internal reader.
//
// In production, InstanceContext provides an explicit wmpConnectionRef to both,
// so this module-level ref is only used as a fallback for the no-args path.
// ============================================================================

const _sharedDefaultConnRef: { current: DatabaseConnection | null } = { current: null };

// ============================================================================
// Cross-Subsystem Adapters — CGP + CCP wiring
// ============================================================================

/**
 * WMP adapter implementing WmpInternalReader (CGP S9.2).
 * Provides P2 candidate entries to the context admission runtime.
 *
 * v2.1.0: Accepts optional wmpConnectionRef from InstanceContext.
 * When not provided, uses module-level shared ref (synchronized with
 * createWorkingMemorySystem default ref so write.execute sets the connection
 * visible to the reader).
 */
export function createWmpInternalReader(wmpConnectionRef?: { current: DatabaseConnection | null }): WmpInternalReader {
  return createInternalReader(wmpConnectionRef ?? _sharedDefaultConnRef);
}

/**
 * WMP adapter implementing WmpPreEmissionCapture (CCP S6.4 Trigger 4).
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
 * v2.1.0: Accepts optional InstanceContext subsets for C-06 isolation.
 * When not provided, creates local state (backward compat for tests).
 *
 * @param deps External dependencies (audit, events, capacity policy)
 * @param wmpConnectionRef Per-instance connection reference from InstanceContext
 * @param monotonicClockState Per-instance monotonic clock state from InstanceContext
 * @returns Frozen WorkingMemorySystem — all methods delegate to store implementations
 */
export function createWorkingMemorySystem(
  deps?: Partial<WmpSystemDeps>,
  wmpConnectionRef?: { current: DatabaseConnection | null },
  monotonicClockState?: { lastTimestamp: string },
): WorkingMemorySystem {
  const capacityPolicy: WmpCapacityPolicy = deps?.capacityPolicy ?? {
    maxEntries: 100,
    maxBytesPerEntry: 65536,
    maxTotalBytes: 262144,
  };
  const eventSink: WmpEventSink = deps?.eventSink ?? WMP_NULL_EVENT_SINK;
  const connRef = wmpConnectionRef ?? _sharedDefaultConnRef;
  const clockState = monotonicClockState ?? { lastTimestamp: '' };

  // Create store instances
  const time = deps?.time;
  const entryStore = createEntryStore(time, clockState);
  const boundaryStore = createBoundaryStore(time, clockState);
  const mutationCounter = createMutationCounter();
  const coordinator = createBoundaryCaptureCoordinator(entryStore, boundaryStore, mutationCounter, eventSink, time, clockState);

  return Object.freeze({
    write: createWriteHandler(entryStore, mutationCounter, capacityPolicy, eventSink, connRef),
    read: createReadHandler(entryStore, connRef),
    discard: createDiscardHandler(entryStore, mutationCounter, eventSink, connRef),
    boundary: coordinator,
    entryStore,
    boundaryStore,
    mutationCounter,
    capacityPolicy: Object.freeze(capacityPolicy),
    taskLifecycle: createTaskLifecycleHandler(coordinator, entryStore),
  });
}
