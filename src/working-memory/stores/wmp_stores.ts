/**
 * WMP (Working Memory Protocol) stores — SQLite-backed implementation.
 * Pattern P-010: All business logic lives here. Harness is thin wiring only.
 *
 * Phase: v3.3.0 — Working Memory Protocol
 * Invariants: WMP-I1 through WMP-I8 (I-41 through I-48)
 * System calls: SC-14 (write), SC-15 (read), SC-16 (discard)
 * Boundary snapshots: §6.2-§6.7 (4 triggers + suspension)
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { AgentId, KernelError, MissionId, Result, TaskId, TimeProvider } from '../../kernel/interfaces/index.js';

import type {
  WmpEntryStore,
  WmpBoundaryStore,
  WmpMutationCounter,
  WmpBoundaryCaptureCoordinator,
  WriteWorkingMemoryHandler,
  ReadWorkingMemoryHandler,
  DiscardWorkingMemoryHandler,
  WriteWorkingMemoryInput,
  WriteWorkingMemoryOutput,
  ReadWorkingMemoryInput,
  ReadWorkingMemoryOutput,
  DiscardWorkingMemoryInput,
  DiscardWorkingMemoryOutput,
  WmpEntry,
  WmpNamespaceState,
  BoundaryEvent,
  BoundaryEventId,
  SnapshotContent,
  SnapshotContentId,
  SnapshotEntry,
  SystemCallId,
  WmpTaskLifecycleHandler,
  WmpCapacityPolicy,
  BoundaryTrigger,
  WmpTerminalState,
  WmpEventSink,
} from '../interfaces/wmp_types.js';

import {
  WMP_KEY_MAX_LENGTH,
  WMP_KEY_RESERVED_PREFIX,
  WMP_KEY_FORBIDDEN_PATTERN,
  WMP_EVENTS,
  WMP_NULL_EVENT_SINK,
} from '../interfaces/wmp_types.js';

import type { WmpInternalEntry, WmpInternalReader } from '../../context/interfaces/cgp_types.js';
import type { WmpPreEmissionCapture, WmpCaptureResult } from '../../claims/interfaces/claim_types.js';

// ============================================================================
// NotImplementedError — kept for backward compatibility
// ============================================================================

export class NotImplementedError extends Error {
  public readonly code = 'NOT_IMPLEMENTED';
  constructor(method: string) {
    super(`${method} is not yet implemented`);
    this.name = 'NotImplementedError';
  }
}

// ============================================================================
// File-local helpers
// ============================================================================

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string, spec: string): Result<T> {
  return { ok: false, error: { code, message, spec } };
}

function errWithExtras<T>(code: string, message: string, spec: string, extras: Record<string, unknown>): Result<T> {
  const error = { code, message, spec, ...extras };
  return { ok: false, error: error as unknown as KernelError };
}

function newId(): string {
  return randomUUID();
}

// Monotonic timestamp: guarantees strictly increasing values even within same millisecond.
// Required for P2 eviction ordering (DC-WMP-801) — updatedAt must differ on rapid writes.
// Hard Stop #7: uses injectable TimeProvider as the clock source.
// v2.1.0: _lastTimestamp eliminated. Clock state now lives in InstanceContext.monotonicClock.
function monotonicNowISO(time: import('../../kernel/interfaces/time.js').TimeProvider, clock: { lastTimestamp: string }): string {
  let ts = time.nowISO();
  if (ts <= clock.lastTimestamp) {
    const d = new Date(clock.lastTimestamp);
    d.setTime(d.getTime() + 1);
    ts = d.toISOString();
  }
  clock.lastTimestamp = ts;
  return ts;
}

function utf8ByteLength(str: string): number {
  return Buffer.byteLength(str, 'utf8');
}

function validateKey(key: string): { valid: true } | { valid: false; reason: string } {
  if (!key || key.length === 0) return { valid: false, reason: 'Key must not be empty' };
  if (key.length > WMP_KEY_MAX_LENGTH) return { valid: false, reason: `Key exceeds ${WMP_KEY_MAX_LENGTH} characters` };
  if (WMP_KEY_FORBIDDEN_PATTERN.test(key)) return { valid: false, reason: 'Key contains forbidden characters (whitespace or path separators)' };
  if (key.startsWith(WMP_KEY_RESERVED_PREFIX)) return { valid: false, reason: `Key must not begin with reserved prefix '${WMP_KEY_RESERVED_PREFIX}'` };
  return { valid: true };
}

interface TaskRow {
  id: string;
  state: string;
  assigned_agent: string;
}

const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const EXECUTABLE_STATES = new Set(['RUNNING']);

function lookupTask(conn: DatabaseConnection, taskId: TaskId): TaskRow | undefined {
  return conn.get<TaskRow>(
    'SELECT id, state, assigned_agent FROM core_tasks WHERE id = ?',
    [taskId],
  );
}

// v2.1.0: _connRef eliminated. Connection reference now lives in InstanceContext.wmpConnectionRef.
// The wmpConnectionRef is threaded through factory functions below.

// ============================================================================
// Entry Store Implementation
// ============================================================================

export function createEntryStore(time?: TimeProvider, monotonicClockState?: { lastTimestamp: string }): WmpEntryStore {
  const clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  const clockState = monotonicClockState ?? { lastTimestamp: '' };
  return Object.freeze({
    upsert(conn: DatabaseConnection, taskId: TaskId, key: string, value: string, sizeBytes: number): Result<WmpEntry> {
      const now = monotonicNowISO(clock, clockState);
      const existing = conn.get<{ key: string; value: string; size_bytes: number; mutation_position: number; created_at: string; updated_at: string }>(
        'SELECT key, value, size_bytes, mutation_position, created_at, updated_at FROM working_memory_entries WHERE task_id = ? AND key = ?',
        [taskId, key],
      );

      // Get next mutation position
      conn.run(
        'INSERT INTO wmp_mutation_counters (task_id, counter) VALUES (?, 1) ON CONFLICT(task_id) DO UPDATE SET counter = counter + 1',
        [taskId],
      );
      const counterRow = conn.get<{ counter: number }>('SELECT counter FROM wmp_mutation_counters WHERE task_id = ?', [taskId]);
      const mutationPosition = counterRow!.counter;

      if (existing) {
        conn.run(
          'UPDATE working_memory_entries SET value = ?, size_bytes = ?, mutation_position = ?, updated_at = ? WHERE task_id = ? AND key = ?',
          [value, sizeBytes, mutationPosition, now, taskId, key],
        );
        return ok({
          key,
          value,
          sizeBytes,
          createdAt: existing.created_at,
          updatedAt: now,
          mutationPosition,
        });
      }

      conn.run(
        'INSERT INTO working_memory_entries (task_id, key, value, size_bytes, mutation_position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [taskId, key, value, sizeBytes, mutationPosition, now, now],
      );
      return ok({
        key,
        value,
        sizeBytes,
        createdAt: now,
        updatedAt: now,
        mutationPosition,
      });
    },

    get(conn: DatabaseConnection, taskId: TaskId, key: string): Result<WmpEntry> {
      const row = conn.get<{ key: string; value: string; size_bytes: number; mutation_position: number; created_at: string; updated_at: string }>(
        'SELECT key, value, size_bytes, mutation_position, created_at, updated_at FROM working_memory_entries WHERE task_id = ? AND key = ?',
        [taskId, key],
      );
      if (!row) {
        return err('WORKING_MEMORY_NOT_FOUND', `Key '${key}' not found in task ${taskId}`, '§5.3');
      }
      return ok({
        key: row.key,
        value: row.value,
        sizeBytes: row.size_bytes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        mutationPosition: row.mutation_position,
      });
    },

    listAll(conn: DatabaseConnection, taskId: TaskId): Result<readonly WmpEntry[]> {
      const rows = conn.query<{ key: string; value: string; size_bytes: number; mutation_position: number; created_at: string; updated_at: string }>(
        'SELECT key, value, size_bytes, mutation_position, created_at, updated_at FROM working_memory_entries WHERE task_id = ? ORDER BY mutation_position ASC',
        [taskId],
      );
      return ok(rows.map(r => ({
        key: r.key,
        value: r.value,
        sizeBytes: r.size_bytes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        mutationPosition: r.mutation_position,
      })));
    },

    discard(conn: DatabaseConnection, taskId: TaskId, key: string): Result<{ freedBytes: number }> {
      const existing = conn.get<{ size_bytes: number }>(
        'SELECT size_bytes FROM working_memory_entries WHERE task_id = ? AND key = ?',
        [taskId, key],
      );
      if (!existing) {
        return err('WORKING_MEMORY_NOT_FOUND', `Key '${key}' not found in task ${taskId}`, '§5.4');
      }
      conn.run('DELETE FROM working_memory_entries WHERE task_id = ? AND key = ?', [taskId, key]);
      return ok({ freedBytes: existing.size_bytes });
    },

    discardAll(conn: DatabaseConnection, taskId: TaskId): Result<{ discardedCount: number; freedBytes: number }> {
      const usage = conn.get<{ cnt: number; total: number }>(
        'SELECT COUNT(*) as cnt, COALESCE(SUM(size_bytes), 0) as total FROM working_memory_entries WHERE task_id = ?',
        [taskId],
      );
      conn.run('DELETE FROM working_memory_entries WHERE task_id = ?', [taskId]);
      return ok({
        discardedCount: usage?.cnt ?? 0,
        freedBytes: usage?.total ?? 0,
      });
    },

    getUsage(conn: DatabaseConnection, taskId: TaskId): Result<{ entryCount: number; totalBytes: number }> {
      const row = conn.get<{ cnt: number; total: number }>(
        'SELECT COUNT(*) as cnt, COALESCE(SUM(size_bytes), 0) as total FROM working_memory_entries WHERE task_id = ?',
        [taskId],
      );
      return ok({
        entryCount: row?.cnt ?? 0,
        totalBytes: row?.total ?? 0,
      });
    },

    isInitialized(conn: DatabaseConnection, taskId: TaskId): Result<boolean> {
      const row = conn.get<{ counter: number }>(
        'SELECT counter FROM wmp_mutation_counters WHERE task_id = ?',
        [taskId],
      );
      return ok(row !== undefined);
    },

    getNamespaceState(conn: DatabaseConnection, taskId: TaskId): Result<WmpNamespaceState> {
      const counterRow = conn.get<{ counter: number }>(
        'SELECT counter FROM wmp_mutation_counters WHERE task_id = ?',
        [taskId],
      );
      if (!counterRow) return ok('never_initialized');

      const entryCount = conn.get<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM working_memory_entries WHERE task_id = ?',
        [taskId],
      );
      if ((entryCount?.cnt ?? 0) > 0) return ok('initialized_with_entries');
      return ok('initialized_empty');
    },
  });
}

// ============================================================================
// Boundary Store Implementation
// ============================================================================

export function createBoundaryStore(time?: TimeProvider, monotonicClockState?: { lastTimestamp: string }): WmpBoundaryStore {
  const clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  const clockState = monotonicClockState ?? { lastTimestamp: '' };
  return Object.freeze({
    createBoundaryEvent(conn: DatabaseConnection, event: Omit<BoundaryEvent, 'eventId'>): Result<BoundaryEvent> {
      const eventId = newId() as BoundaryEventId;
      const timestamp = event.timestamp || monotonicNowISO(clock, clockState);
      conn.run(
        'INSERT INTO wmp_boundary_events (event_id, task_id, mission_id, trigger, snapshot_content_id, linked_emission_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [eventId, event.taskId, event.missionId, event.trigger, event.snapshotContentId, event.linkedEmissionId ?? null, timestamp],
      );
      return ok({
        eventId,
        taskId: event.taskId,
        missionId: event.missionId,
        trigger: event.trigger,
        snapshotContentId: event.snapshotContentId,
        linkedEmissionId: event.linkedEmissionId,
        timestamp,
      });
    },

    createSnapshotContent(conn: DatabaseConnection, content: Omit<SnapshotContent, 'contentId'>): Result<SnapshotContent> {
      const contentId = newId() as SnapshotContentId;
      const entriesJson = content.entries ? JSON.stringify(content.entries) : null;
      conn.run(
        'INSERT INTO wmp_snapshot_contents (content_id, task_id, namespace_state, entries_json, total_entries, total_size_bytes, highest_mutation_position) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [contentId, (content as SnapshotContent & { taskId?: TaskId }).taskId ?? '', content.namespaceState, entriesJson, content.totalEntries, content.totalSizeBytes, content.highestMutationPosition ?? null],
      );
      return ok({
        contentId,
        namespaceState: content.namespaceState,
        entries: content.entries,
        totalEntries: content.totalEntries,
        totalSizeBytes: content.totalSizeBytes,
        highestMutationPosition: content.highestMutationPosition,
      });
    },

    findMatchingContent(conn: DatabaseConnection, taskId: TaskId, namespaceState: WmpNamespaceState, highestMutationPosition: number | null): Result<SnapshotContent | null> {
      let row: { content_id: string; namespace_state: string; entries_json: string | null; total_entries: number; total_size_bytes: number; highest_mutation_position: number | null } | undefined;
      if (highestMutationPosition === null) {
        row = conn.get(
          'SELECT content_id, namespace_state, entries_json, total_entries, total_size_bytes, highest_mutation_position FROM wmp_snapshot_contents WHERE task_id = ? AND namespace_state = ? AND highest_mutation_position IS NULL',
          [taskId, namespaceState],
        );
      } else {
        row = conn.get(
          'SELECT content_id, namespace_state, entries_json, total_entries, total_size_bytes, highest_mutation_position FROM wmp_snapshot_contents WHERE task_id = ? AND namespace_state = ? AND highest_mutation_position = ?',
          [taskId, namespaceState, highestMutationPosition],
        );
      }
      if (!row) return ok(null);
      return ok({
        contentId: row.content_id as SnapshotContentId,
        namespaceState: row.namespace_state as WmpNamespaceState,
        entries: row.entries_json ? JSON.parse(row.entries_json) : null,
        totalEntries: row.total_entries,
        totalSizeBytes: row.total_size_bytes,
        highestMutationPosition: row.highest_mutation_position,
      });
    },

    getBoundaryEvent(conn: DatabaseConnection, eventId: BoundaryEventId): Result<BoundaryEvent> {
      const row = conn.get<{ event_id: string; task_id: string; mission_id: string; trigger: string; snapshot_content_id: string; linked_emission_id: string | null; timestamp: string }>(
        'SELECT event_id, task_id, mission_id, trigger, snapshot_content_id, linked_emission_id, timestamp FROM wmp_boundary_events WHERE event_id = ?',
        [eventId],
      );
      if (!row) return err('NOT_FOUND', `Boundary event ${eventId} not found`, '§6.2');
      return ok({
        eventId: row.event_id as BoundaryEventId,
        taskId: row.task_id as TaskId,
        missionId: row.mission_id as MissionId,
        trigger: row.trigger as BoundaryTrigger,
        snapshotContentId: row.snapshot_content_id as SnapshotContentId,
        linkedEmissionId: row.linked_emission_id as SystemCallId | null,
        timestamp: row.timestamp,
      });
    },

    getSnapshotContent(conn: DatabaseConnection, contentId: SnapshotContentId): Result<SnapshotContent> {
      const row = conn.get<{ content_id: string; namespace_state: string; entries_json: string | null; total_entries: number; total_size_bytes: number; highest_mutation_position: number | null }>(
        'SELECT content_id, namespace_state, entries_json, total_entries, total_size_bytes, highest_mutation_position FROM wmp_snapshot_contents WHERE content_id = ?',
        [contentId],
      );
      if (!row) return err('NOT_FOUND', `Snapshot content ${contentId} not found`, '§6.2');
      return ok({
        contentId: row.content_id as SnapshotContentId,
        namespaceState: row.namespace_state as WmpNamespaceState,
        entries: row.entries_json ? JSON.parse(row.entries_json) : null,
        totalEntries: row.total_entries,
        totalSizeBytes: row.total_size_bytes,
        highestMutationPosition: row.highest_mutation_position,
      });
    },

    listBoundaryEvents(conn: DatabaseConnection, taskId: TaskId): Result<readonly BoundaryEvent[]> {
      const rows = conn.query<{ event_id: string; task_id: string; mission_id: string; trigger: string; snapshot_content_id: string; linked_emission_id: string | null; timestamp: string }>(
        'SELECT event_id, task_id, mission_id, trigger, snapshot_content_id, linked_emission_id, timestamp FROM wmp_boundary_events WHERE task_id = ? ORDER BY timestamp ASC',
        [taskId],
      );
      return ok(rows.map(r => ({
        eventId: r.event_id as BoundaryEventId,
        taskId: r.task_id as TaskId,
        missionId: r.mission_id as MissionId,
        trigger: r.trigger as BoundaryTrigger,
        snapshotContentId: r.snapshot_content_id as SnapshotContentId,
        linkedEmissionId: r.linked_emission_id as SystemCallId | null,
        timestamp: r.timestamp,
      })));
    },
  });
}

// ============================================================================
// Mutation Counter Implementation
// ============================================================================

export function createMutationCounter(): WmpMutationCounter {
  return Object.freeze({
    next(conn: DatabaseConnection, taskId: TaskId): Result<number> {
      conn.run(
        'INSERT INTO wmp_mutation_counters (task_id, counter) VALUES (?, 1) ON CONFLICT(task_id) DO UPDATE SET counter = counter + 1',
        [taskId],
      );
      const row = conn.get<{ counter: number }>('SELECT counter FROM wmp_mutation_counters WHERE task_id = ?', [taskId]);
      return ok(row!.counter);
    },

    current(conn: DatabaseConnection, taskId: TaskId): Result<number | null> {
      const row = conn.get<{ counter: number }>('SELECT counter FROM wmp_mutation_counters WHERE task_id = ?', [taskId]);
      return ok(row?.counter ?? null);
    },
  });
}

// ============================================================================
// Boundary Capture Coordinator Implementation
// ============================================================================

export function createBoundaryCaptureCoordinator(
  entryStore: WmpEntryStore,
  boundaryStore: WmpBoundaryStore,
  mutationCounter: WmpMutationCounter,
  eventSink: WmpEventSink = WMP_NULL_EVENT_SINK,
  time?: TimeProvider,
  monotonicClockState?: { lastTimestamp: string },
): WmpBoundaryCaptureCoordinator {
  const clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  const clockState = monotonicClockState ?? { lastTimestamp: '' };

  function captureSnapshot(conn: DatabaseConnection, taskId: TaskId): Result<SnapshotContent> {
    const nsResult = entryStore.getNamespaceState(conn, taskId);
    if (!nsResult.ok) return nsResult as unknown as Result<SnapshotContent>;
    const namespaceState = nsResult.value;

    const counterResult = mutationCounter.current(conn, taskId);
    if (!counterResult.ok) return counterResult as unknown as Result<SnapshotContent>;
    const highestMutationPosition = counterResult.value;

    // Attempt deduplication
    const existingResult = boundaryStore.findMatchingContent(conn, taskId, namespaceState, highestMutationPosition);
    if (existingResult.ok && existingResult.value) {
      return ok(existingResult.value);
    }

    let entries: readonly SnapshotEntry[] | null = null;
    let totalEntries = 0;
    let totalSizeBytes = 0;

    if (namespaceState === 'never_initialized') {
      entries = null;
    } else if (namespaceState === 'initialized_empty') {
      entries = [];
    } else {
      const listResult = entryStore.listAll(conn, taskId);
      if (!listResult.ok) return listResult as unknown as Result<SnapshotContent>;
      entries = listResult.value.map(e => ({
        key: e.key,
        value: e.value,
        sizeBytes: e.sizeBytes,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        mutationPosition: e.mutationPosition,
      }));
      totalEntries = entries.length;
      totalSizeBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
    }

    // Store taskId in snapshot content for dedup queries
    const contentInput = {
      taskId,
      namespaceState,
      entries,
      totalEntries,
      totalSizeBytes,
      highestMutationPosition,
    };
    return boundaryStore.createSnapshotContent(conn, contentInput as Omit<SnapshotContent, 'contentId'>);
  }

  function createEvent(
    conn: DatabaseConnection,
    taskId: TaskId,
    missionId: MissionId,
    trigger: BoundaryTrigger,
    linkedEmissionId: SystemCallId | null,
  ): Result<BoundaryEvent> {
    const snapshotResult = captureSnapshot(conn, taskId);
    if (!snapshotResult.ok) {
      // Emit boundary capture failure event (FM-WMP-02)
      try {
        eventSink.emit(WMP_EVENTS.BOUNDARY_CAPTURE_FAILED, taskId, {
          trigger,
          missionId,
          reason: snapshotResult.error.message,
          code: snapshotResult.error.code,
        });
      } catch { /* event emission failure is non-fatal per I-48 */ }
      return snapshotResult as unknown as Result<BoundaryEvent>;
    }
    const snapshot = snapshotResult.value;

    const eventResult = boundaryStore.createBoundaryEvent(conn, {
      taskId,
      missionId,
      trigger,
      snapshotContentId: snapshot.contentId,
      linkedEmissionId,
      timestamp: monotonicNowISO(clock, clockState),
    });

    if (eventResult.ok) {
      // Emit boundary captured event (§6.2)
      try {
        eventSink.emit(WMP_EVENTS.BOUNDARY_CAPTURED, taskId, {
          trigger,
          missionId,
          eventId: eventResult.value.eventId,
          snapshotContentId: snapshot.contentId,
          entryCount: snapshot.totalEntries,
        });
      } catch { /* event emission failure is non-fatal per I-48 */ }
    } else {
      // Emit boundary capture failure event (FM-WMP-02)
      try {
        eventSink.emit(WMP_EVENTS.BOUNDARY_CAPTURE_FAILED, taskId, {
          trigger,
          missionId,
          reason: eventResult.error.message,
          code: eventResult.error.code,
        });
      } catch { /* event emission failure is non-fatal per I-48 */ }
    }

    return eventResult;
  }

  return Object.freeze({
    captureAtCheckpoint(conn: DatabaseConnection, taskId: TaskId, missionId: MissionId): Result<BoundaryEvent> {
      return createEvent(conn, taskId, missionId, 'checkpoint', null);
    },

    captureAtTerminal(conn: DatabaseConnection, taskId: TaskId, missionId: MissionId, terminalState: WmpTerminalState): Result<BoundaryEvent> {
      return conn.transaction(() => {
        // 1. Capture snapshot (pre-discard state) — WMP-I7 atomicity
        const eventResult = createEvent(conn, taskId, missionId, 'task_terminal', null);
        if (!eventResult.ok) return eventResult;

        // 2. Physical reclamation — delete all entries (AL-WMP-07, DC-WMP-209)
        const discardResult = entryStore.discardAll(conn, taskId);

        // 3. Emit terminal discard event (§6.4 Trigger 2)
        try {
          const discarded = discardResult.ok ? discardResult.value : { discardedCount: 0, freedBytes: 0 };
          eventSink.emit(WMP_EVENTS.TERMINAL_DISCARD, taskId, {
            missionId,
            terminalState,
            discardedCount: discarded.discardedCount,
            freedBytes: discarded.freedBytes,
          });
        } catch { /* event emission failure is non-fatal per I-48 */ }

        // 4. Terminal state transition — update core_tasks
        // F-WMP-BB-01: Use actual terminal state, never hard-code 'COMPLETED'
        // F-RW-001: CAS protection — read current state, only update if non-terminal.
        // WMP is at L1.5 (Substrate layer). OrchestrationTransitionService is at L2.
        // Calling UP from L1.5→L2 would violate layer boundaries.
        // CAS (WHERE id = ? AND state NOT IN terminal) is the L1-level defense.
        // This prevents TOCTOU races where another transaction already terminated the task.
        const now = monotonicNowISO(clock, clockState);
        const terminalStates = ['COMPLETED', 'FAILED', 'CANCELLED'];
        const currentTask = conn.get<{ state: string }>(
          'SELECT state FROM core_tasks WHERE id = ?',
          [taskId],
        );
        if (currentTask && terminalStates.includes(currentTask.state)) {
          // Task already in terminal state — no-op for idempotency.
          // The boundary snapshot was already captured above, which is the primary concern.
          return eventResult;
        }
        conn.run(
          'UPDATE core_tasks SET state = ?, completed_at = ?, updated_at = ? WHERE id = ? AND state NOT IN (?, ?, ?)',
          [terminalState, now, now, taskId, ...terminalStates],
        );

        return eventResult;
      });
    },

    captureAtMissionTransition(conn: DatabaseConnection, taskId: TaskId, missionId: MissionId): Result<BoundaryEvent> {
      return createEvent(conn, taskId, missionId, 'mission_transition', null);
    },

    capturePreEmission(conn: DatabaseConnection, taskId: TaskId, missionId: MissionId, emissionId: SystemCallId): Result<BoundaryEvent> {
      return createEvent(conn, taskId, missionId, 'pre_irreversible_emission', emissionId);
    },

    captureAtSuspension(conn: DatabaseConnection, taskId: TaskId, missionId: MissionId): Result<BoundaryEvent> {
      return createEvent(conn, taskId, missionId, 'suspension', null);
    },
  });
}

// ============================================================================
// SC-14 Write Handler Implementation
// ============================================================================

export function createWriteHandler(
  entryStore: WmpEntryStore,
  _mutationCounter: WmpMutationCounter,
  capacityPolicy: WmpCapacityPolicy,
  eventSink: WmpEventSink = WMP_NULL_EVENT_SINK,
  wmpConnectionRef?: { current: DatabaseConnection | null },
): WriteWorkingMemoryHandler {
  const connRef = wmpConnectionRef ?? { current: null };
  return Object.freeze({
    execute(
      conn: DatabaseConnection,
      callerTaskId: TaskId,
      callerAgentId: AgentId,
      input: WriteWorkingMemoryInput,
    ): Result<WriteWorkingMemoryOutput> {
      connRef.current = conn;

      // 1. Scope check: callerTaskId must match input.taskId
      if (callerTaskId !== input.taskId) {
        return err('TASK_SCOPE_VIOLATION', 'Caller task does not match target task', 'WMP-I1');
      }

      // 2. Task existence and state check
      const task = lookupTask(conn, input.taskId);
      if (!task) return err('TASK_NOT_FOUND', `Task ${input.taskId} not found`, '§5.2');

      if (TERMINAL_STATES.has(task.state)) {
        return err('TASK_TERMINATED', `Task ${input.taskId} has reached terminal state`, '§5.2');
      }
      if (!EXECUTABLE_STATES.has(task.state)) {
        return err('TASK_NOT_EXECUTABLE', `Task ${input.taskId} is not in an executable state`, '§5.2');
      }

      // 2b. WMP-internal suspension check (DC-WMP-212)
      const suspendedRow = conn.get<{ suspended: number }>('SELECT suspended FROM wmp_mutation_counters WHERE task_id = ?', [input.taskId]);
      if (suspendedRow && suspendedRow.suspended === 1) {
        return err('TASK_NOT_EXECUTABLE', `Task ${input.taskId} is suspended`, 'DC-WMP-212');
      }

      // 3. Agent authorization check
      if (callerAgentId !== task.assigned_agent) {
        return err('UNAUTHORIZED', `Agent ${callerAgentId} is not authorized for task ${input.taskId}`, 'I-13');
      }

      // 4. Key validation (I-46)
      const keyValidation = validateKey(input.key);
      if (!keyValidation.valid) {
        return err('WORKING_MEMORY_KEY_INVALID', keyValidation.reason, '§5.2');
      }

      // 4b. Value validation (DC-WMP-111, F-WMP-BB-04)
      if (input.value.includes('\0')) {
        return err('WORKING_MEMORY_VALUE_INVALID', 'Value contains null bytes', '§5.2');
      }

      // 5. Compute byte size
      const sizeBytes = utf8ByteLength(input.value);

      // 6. Per-entry byte limit check
      if (sizeBytes > capacityPolicy.maxBytesPerEntry) {
        return err('WORKING_MEMORY_CAPACITY_EXCEEDED', `Value size ${sizeBytes} exceeds per-entry limit ${capacityPolicy.maxBytesPerEntry}`, '§8.1');
      }

      // 7. Capacity check (entry count and total bytes)
      const usageResult = entryStore.getUsage(conn, input.taskId);
      if (!usageResult.ok) return usageResult as unknown as Result<WriteWorkingMemoryOutput>;
      const usage = usageResult.value;

      // Check if this is a replacement (existing key)
      const existingEntry = conn.get<{ size_bytes: number }>(
        'SELECT size_bytes FROM working_memory_entries WHERE task_id = ? AND key = ?',
        [input.taskId, input.key],
      );

      const isReplacement = !!existingEntry;
      const effectiveEntryCount = isReplacement ? usage.entryCount : usage.entryCount + 1;
      const effectiveTotalBytes = isReplacement
        ? usage.totalBytes - existingEntry!.size_bytes + sizeBytes
        : usage.totalBytes + sizeBytes;

      if (effectiveEntryCount > capacityPolicy.maxEntries) {
        return errWithExtras<WriteWorkingMemoryOutput>(
          'WORKING_MEMORY_CAPACITY_EXCEEDED',
          `Entry count ${effectiveEntryCount} would exceed limit ${capacityPolicy.maxEntries}`,
          '§8.1',
          { currentEntryCount: usage.entryCount, maxEntryCount: capacityPolicy.maxEntries },
        );
      }

      if (effectiveTotalBytes > capacityPolicy.maxTotalBytes) {
        return errWithExtras<WriteWorkingMemoryOutput>(
          'WORKING_MEMORY_CAPACITY_EXCEEDED',
          `Total bytes ${effectiveTotalBytes} would exceed limit ${capacityPolicy.maxTotalBytes}`,
          '§8.1',
          { currentEntryCount: usage.entryCount, maxEntryCount: capacityPolicy.maxEntries, currentSizeBytes: usage.totalBytes, maxSizeBytes: capacityPolicy.maxTotalBytes, requestedSizeBytes: sizeBytes },
        );
      }

      // 8. Upsert the entry (includes mutation counter increment)
      const upsertResult = entryStore.upsert(conn, input.taskId, input.key, input.value, sizeBytes);
      if (!upsertResult.ok) return upsertResult as unknown as Result<WriteWorkingMemoryOutput>;
      const entry = upsertResult.value;

      // 9. Emit event (DC-WMP-X15, Binding 14 — transaction-coupled)
      // Per I-48: trace failures do not roll back the write
      try {
        eventSink.emit(WMP_EVENTS.ENTRY_WRITTEN, input.taskId, {
          key: entry.key,
          sizeBytes: entry.sizeBytes,
          created: !isReplacement,
          mutationPosition: entry.mutationPosition,
        });
      } catch { /* trace emission failure is non-fatal per I-48 */ }

      // 10. Capacity warning (FM-WMP-03 monitoring) — after successful write
      // Emit when usage exceeds 80% of either entry count or total byte limit
      const CAPACITY_WARNING_THRESHOLD = 0.8;
      if (
        effectiveEntryCount > capacityPolicy.maxEntries * CAPACITY_WARNING_THRESHOLD ||
        effectiveTotalBytes > capacityPolicy.maxTotalBytes * CAPACITY_WARNING_THRESHOLD
      ) {
        try {
          eventSink.emit(WMP_EVENTS.CAPACITY_WARNING, input.taskId, {
            currentEntryCount: effectiveEntryCount,
            maxEntries: capacityPolicy.maxEntries,
            currentTotalBytes: effectiveTotalBytes,
            maxTotalBytes: capacityPolicy.maxTotalBytes,
            entryPct: effectiveEntryCount / capacityPolicy.maxEntries,
            bytesPct: effectiveTotalBytes / capacityPolicy.maxTotalBytes,
          });
        } catch { /* event emission failure is non-fatal per I-48 */ }
      }

      return ok({
        key: entry.key,
        sizeBytes: entry.sizeBytes,
        created: !isReplacement,
        mutationPosition: entry.mutationPosition,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      } as WriteWorkingMemoryOutput);
    },
  });
}

// ============================================================================
// SC-15 Read Handler Implementation
// ============================================================================

export function createReadHandler(
  entryStore: WmpEntryStore,
  wmpConnectionRef?: { current: DatabaseConnection | null },
): ReadWorkingMemoryHandler {
  const connRef = wmpConnectionRef ?? { current: null };
  return Object.freeze({
    execute(
      conn: DatabaseConnection,
      callerTaskId: TaskId,
      callerAgentId: AgentId,
      input: ReadWorkingMemoryInput,
    ): Result<ReadWorkingMemoryOutput> {
      connRef.current = conn;

      // 1. Scope check
      if (callerTaskId !== input.taskId) {
        return err('TASK_SCOPE_VIOLATION', 'Caller task does not match target task', 'WMP-I1');
      }

      // 2. Task existence and state check
      const task = lookupTask(conn, input.taskId);
      if (!task) return err('TASK_NOT_FOUND', `Task ${input.taskId} not found`, '§5.3');

      if (TERMINAL_STATES.has(task.state)) {
        return err('TASK_TERMINATED', `Task ${input.taskId} has reached terminal state`, '§5.3');
      }
      // SC-15 intentionally omits TASK_NOT_EXECUTABLE — reads are always safe (AMB-WMP-05)

      // 3. Agent authorization check
      if (callerAgentId !== task.assigned_agent) {
        return err('UNAUTHORIZED', `Agent ${callerAgentId} is not authorized for task ${input.taskId}`, 'I-13');
      }

      // 4. Read entry or list all
      if (input.key !== null) {
        // Specific key read
        const entryResult = entryStore.get(conn, input.taskId, input.key);
        if (!entryResult.ok) return entryResult as unknown as Result<ReadWorkingMemoryOutput>;
        const e = entryResult.value;
        return ok({
          key: e.key,
          value: e.value,
          sizeBytes: e.sizeBytes,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
        });
      }

      // List all entries
      const listResult = entryStore.listAll(conn, input.taskId);
      if (!listResult.ok) return listResult as unknown as Result<ReadWorkingMemoryOutput>;
      const entries = listResult.value;
      const totalSizeBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
      return ok({
        entries: entries.map(e => ({
          key: e.key,
          value: e.value,
          sizeBytes: e.sizeBytes,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
        })),
        totalEntries: entries.length,
        totalSizeBytes,
      });
    },
  });
}

// ============================================================================
// SC-16 Discard Handler Implementation
// ============================================================================

export function createDiscardHandler(
  entryStore: WmpEntryStore,
  mutationCounter: WmpMutationCounter,
  eventSink: WmpEventSink = WMP_NULL_EVENT_SINK,
  wmpConnectionRef?: { current: DatabaseConnection | null },
): DiscardWorkingMemoryHandler {
  const connRef = wmpConnectionRef ?? { current: null };
  return Object.freeze({
    execute(
      conn: DatabaseConnection,
      callerTaskId: TaskId,
      callerAgentId: AgentId,
      input: DiscardWorkingMemoryInput,
    ): Result<DiscardWorkingMemoryOutput> {
      connRef.current = conn;

      // 1. Scope check
      if (callerTaskId !== input.taskId) {
        return err('TASK_SCOPE_VIOLATION', 'Caller task does not match target task', 'WMP-I1');
      }

      // 2. Task existence and state check
      const task = lookupTask(conn, input.taskId);
      if (!task) return err('TASK_NOT_FOUND', `Task ${input.taskId} not found`, '§5.4');

      if (TERMINAL_STATES.has(task.state)) {
        return err('TASK_TERMINATED', `Task ${input.taskId} has reached terminal state`, '§5.4');
      }
      if (!EXECUTABLE_STATES.has(task.state)) {
        return err('TASK_NOT_EXECUTABLE', `Task ${input.taskId} is not in an executable state`, '§5.4');
      }

      // 2b. WMP-internal suspension check (DC-WMP-212)
      const suspendedRow = conn.get<{ suspended: number }>('SELECT suspended FROM wmp_mutation_counters WHERE task_id = ?', [input.taskId]);
      if (suspendedRow && suspendedRow.suspended === 1) {
        return err('TASK_NOT_EXECUTABLE', `Task ${input.taskId} is suspended`, 'DC-WMP-212');
      }

      // 3. Agent authorization check
      if (callerAgentId !== task.assigned_agent) {
        return err('UNAUTHORIZED', `Agent ${callerAgentId} is not authorized for task ${input.taskId}`, 'I-13');
      }

      // 5. Discard
      if (input.key !== null) {
        // Specific key discard — advance counter AFTER success (WMP-I5: failed ops get no position, BPB-001)
        const discardResult = entryStore.discard(conn, input.taskId, input.key);
        if (!discardResult.ok) return discardResult as unknown as Result<DiscardWorkingMemoryOutput>;

        // 4a. Advance mutation counter only after single-key discard succeeds
        const counterResult = mutationCounter.next(conn, input.taskId);
        if (!counterResult.ok) return counterResult as unknown as Result<DiscardWorkingMemoryOutput>;
        const mutationPosition = counterResult.value;

        // 6. Emit event (DC-WMP-X15, Binding 14 — transaction-coupled)
        try {
          eventSink.emit(WMP_EVENTS.ENTRY_DISCARDED, input.taskId, {
            key: input.key,
            freedBytes: discardResult.value.freedBytes,
            mutationPosition,
          });
        } catch { /* trace emission failure is non-fatal per I-48 */ }

        return ok({
          discardedCount: 1,
          freedBytes: discardResult.value.freedBytes,
          mutationPosition,
        });
      }

      // Discard all — advance counter BEFORE discard (AMB-WMP-06: always a visible mutation)
      const counterResult = mutationCounter.next(conn, input.taskId);
      if (!counterResult.ok) return counterResult as unknown as Result<DiscardWorkingMemoryOutput>;
      const mutationPosition = counterResult.value;

      const discardAllResult = entryStore.discardAll(conn, input.taskId);
      if (!discardAllResult.ok) return discardAllResult as unknown as Result<DiscardWorkingMemoryOutput>;

      // Emit event for discard-all (DC-WMP-X15)
      try {
        eventSink.emit(WMP_EVENTS.ENTRY_DISCARDED, input.taskId, {
          key: null,
          freedBytes: discardAllResult.value.freedBytes,
          discardedCount: discardAllResult.value.discardedCount,
          mutationPosition,
        });
      } catch { /* trace emission failure is non-fatal per I-48 */ }

      return ok({
        discardedCount: discardAllResult.value.discardedCount,
        freedBytes: discardAllResult.value.freedBytes,
        mutationPosition,
      });
    },
  });
}

// ============================================================================
// Task Lifecycle Handler Implementation
// ============================================================================

export function createTaskLifecycleHandler(
  coordinator: WmpBoundaryCaptureCoordinator,
  entryStore: WmpEntryStore,
): WmpTaskLifecycleHandler {
  return Object.freeze({
    onTaskTerminal(conn: DatabaseConnection, taskId: TaskId, missionId: MissionId, terminalState: WmpTerminalState): Result<BoundaryEvent> {
      return coordinator.captureAtTerminal(conn, taskId, missionId, terminalState);
    },

    onTaskSuspended(conn: DatabaseConnection, taskId: TaskId, missionId: MissionId): Result<BoundaryEvent> {
      // 1. Set suspension flag
      conn.run(
        'INSERT INTO wmp_mutation_counters (task_id, counter, suspended) VALUES (?, 0, 1) ON CONFLICT(task_id) DO UPDATE SET suspended = 1',
        [taskId],
      );

      // 2. Capture boundary snapshot at suspension (DC-WMP-213)
      return coordinator.captureAtSuspension(conn, taskId, missionId);
    },

    onTaskResumed(conn: DatabaseConnection, taskId: TaskId, _missionId: MissionId): Result<void> {
      // 1. Clear suspension flag
      conn.run(
        'UPDATE wmp_mutation_counters SET suspended = 0 WHERE task_id = ?',
        [taskId],
      );

      // 2. Verify namespace integrity (DC-WMP-214)
      // Entries survive suspension because writes/discards are rejected during suspension.
      // Verify by confirming entries are readable.
      const listResult = entryStore.listAll(conn, taskId);
      if (!listResult.ok) return listResult as unknown as Result<void>;

      return ok(undefined);
    },
  });
}

// ============================================================================
// Internal Reader Implementation (for CGP P2 — WmpInternalReader)
// ============================================================================

export function createInternalReader(wmpConnectionRef?: { current: DatabaseConnection | null }): WmpInternalReader {
  const connRef = wmpConnectionRef ?? { current: null };
  return Object.freeze({
    readLiveEntries(taskId: TaskId): Result<readonly WmpInternalEntry[]> {
      const conn = connRef.current;
      if (!conn) return err('NO_CONNECTION', 'No database connection available', '§9.2');

      const rows = conn.query<{ key: string; value: string; size_bytes: number; created_at: string; updated_at: string; mutation_position: number }>(
        'SELECT key, value, size_bytes, created_at, updated_at, mutation_position FROM working_memory_entries WHERE task_id = ? ORDER BY mutation_position ASC',
        [taskId],
      );

      return ok(rows.map(r => ({
        key: r.key,
        value: r.value,
        sizeBytes: r.size_bytes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        mutationPosition: r.mutation_position,
      })));
    },
  });
}

// ============================================================================
// Pre-Emission Capture Implementation (for CCP — WmpPreEmissionCapture)
// ============================================================================

export function createPreEmissionCaptureImpl(
  entryStore: WmpEntryStore,
  coordinator: WmpBoundaryCaptureCoordinator,
): WmpPreEmissionCapture {
  return Object.freeze({
    capture(conn: DatabaseConnection, taskId: TaskId): Result<WmpCaptureResult> {
      // Check if WMP is initialized for this task
      const initResult = entryStore.isInitialized(conn, taskId);
      if (!initResult.ok) return initResult as unknown as Result<WmpCaptureResult>;

      if (!initResult.value) {
        // Never-initialized — not_applicable (no snapshot needed)
        return ok({ captureId: null, sourcingStatus: 'not_applicable' } as unknown as WmpCaptureResult);
      }

      // Initialized — capture pre-emission snapshot
      // Look up the mission_id from core_tasks
      const taskRow = conn.get<{ mission_id: string }>('SELECT mission_id FROM core_tasks WHERE id = ?', [taskId]);
      if (!taskRow) {
        // Debt 2: Missing task row means identity cannot be established — do not fabricate empty missionId
        return { ok: false, error: { code: 'NOT_FOUND', message: `Task ${taskId} not found in core_tasks — cannot determine mission for WMP capture`, spec: 'S7' } } as Result<WmpCaptureResult>;
      }
      const actualMissionId = taskRow.mission_id as MissionId;

      const emissionId = newId() as SystemCallId;
      const captureResult = coordinator.capturePreEmission(conn, taskId, actualMissionId, emissionId);
      if (!captureResult.ok) return captureResult as unknown as Result<WmpCaptureResult>;

      return ok({
        captureId: captureResult.value.eventId as string,
        sourcingStatus: 'not_verified' as const,
      });
    },
  });
}
