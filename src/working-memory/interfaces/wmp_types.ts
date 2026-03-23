/**
 * WMP (Working Memory Protocol) interface types.
 * Spec ref: WMP v1.0 Design Source (FINAL DRAFT), Architecture Freeze CF-01/CF-02/CF-03/CF-04/CF-05/CF-07/CF-10/CF-12/CF-13
 *
 * Phase: v3.3.0 — Working Memory Protocol Truth Model
 * Status: FROZEN — interfaces defined before implementation.
 *
 * Implements: All TypeScript types for the Working Memory subsystem:
 *   §3 (8 Invariants WMP-I1 through WMP-I8)
 *   §4 (21 Conformance Tests CT-WMP-01 through CT-WMP-21)
 *   §5 (3 System Calls SC-14, SC-15, SC-16)
 *   §6 (Boundary Snapshot Semantics — dual-record structure)
 *   §7 (3 Failure Modes FM-WMP-01 through FM-WMP-03)
 *   §8 (Capacity Policy — 3 configurable limits)
 *   §9 (CGP Interaction Boundary — position 2 candidacy)
 *   §10 (Audit/Replay Linkage — pre-emission audit fields)
 *   §11 (Safety Architecture — three-boundary design)
 *   §12 (8 Derived Engineering Constraints DERIVED-1 through DERIVED-8)
 *
 * Key architectural properties:
 *   - Task-local scope: no cross-task access (WMP-I1, CF-04)
 *   - Terminal inaccessibility: discarded on COMPLETED/FAILED/CANCELLED (WMP-I2)
 *   - Free revisability: no per-mutation audit (WMP-I3, CF-12) — ONLY I-03 exception in Limen
 *   - Storage/admission separation: context eviction ≠ lifecycle demotion (WMP-I4, CF-01)
 *   - Deterministic mutation order: monotonic task-local counter (WMP-I5, CF-10)
 *   - Mandatory boundary capture: dual-record structure at governed boundaries (WMP-I6, CF-04)
 *   - Terminal atomicity: capture + transition + discard as one operation (WMP-I7)
 *   - Audit referenceability: boundary snapshots linked to high-stakes transitions (WMP-I8, CF-13)
 *
 * Cross-subsystem dependencies:
 *   - CGP: position 2 candidates via internal read (§9.2)
 *   - CCP: Trigger 4 pre-emission capture for SC-11 (§6.4)
 *   - Task lifecycle: terminal discard wiring (§6.4 Trigger 2)
 *   - Checkpoint system: boundary capture wiring (§6.4 Trigger 1)
 *   - Audit infrastructure: BoundaryEvent + SnapshotContent storage (§6.2)
 */

import type {
  MissionId, TaskId, AgentId,
  Result,
} from '../../kernel/interfaces/index.js';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { AuditTrail } from '../../kernel/interfaces/audit.js';
import type { EventBus } from '../../kernel/interfaces/events.js';
import type { TraceEmitter } from '../../kernel/interfaces/trace.js';

// ============================================================================
// Branded ID Types — WMP-specific
// ============================================================================

/**
 * §6.2: Boundary event record identifier.
 * Unique per boundary capture event. Referenced by pre-emission audit fields.
 */
export type BoundaryEventId = string & { readonly __brand: 'BoundaryEventId' };

/**
 * §6.2: Snapshot content record identifier.
 * May be shared across boundary events when content is deduplicated (WMP-I6).
 */
export type SnapshotContentId = string & { readonly __brand: 'SnapshotContentId' };

/**
 * System call invocation identifier.
 * Used for Trigger 4 linkedEmissionId (§6.2).
 */
export type SystemCallId = string & { readonly __brand: 'SystemCallId' };

// ============================================================================
// Namespace State — §6.2 three-state model
// ============================================================================

/**
 * §6.2, §6.7: Three distinct WMP namespace states.
 * These are NOT interchangeable. never_initialized and initialized_empty
 * MUST NOT be deduplicated against each other (WMP-I6, CT-WMP-18).
 *
 * 'never_initialized': SC-14 was never called for this task.
 * 'initialized_empty': SC-14 was called at least once, but all entries have been discarded.
 * 'initialized_with_entries': SC-14 was called and live entries exist.
 */
export type WmpNamespaceState =
  | 'never_initialized'
  | 'initialized_empty'
  | 'initialized_with_entries';

// ============================================================================
// Terminal State — task terminal states for captureAtTerminal (F-WMP-BB-01)
// ============================================================================

/**
 * §6.4 Trigger 2: The three terminal states that trigger boundary capture.
 * captureAtTerminal receives the actual terminal state — never hard-coded.
 */
export type WmpTerminalState = 'COMPLETED' | 'FAILED' | 'CANCELLED';

// ============================================================================
// Boundary Snapshot Trigger — §6.4
// ============================================================================

/**
 * §6.4: The four boundary snapshot triggers.
 * Triggers 1-3 are unconditional. Trigger 4 fires only on validation pass.
 */
export type BoundaryTrigger =
  | 'checkpoint'                    // Trigger 1: SC-10 checkpoint event (§6.4)
  | 'task_terminal'                 // Trigger 2: COMPLETED/FAILED/CANCELLED (§6.4)
  | 'mission_transition'            // Trigger 3: mission state change while task active (§6.4)
  | 'pre_irreversible_emission'     // Trigger 4: before SC-4/SC-11/SC-9 commits (§6.4)
  | 'suspension';                   // Trigger 5: task suspension boundary (Memory Doctrine, DC-WMP-213)

// ============================================================================
// WMP Entry — live namespace entry
// ============================================================================

/**
 * §5.2, §5.3: A single WMP entry in the live namespace.
 * Freely revisable within task scope (CF-12, WMP-I3).
 * Discarded on task terminal state (CF-04, WMP-I2).
 */
export interface WmpEntry {
  /** Entry key — unique within task scope (§5.2 key constraints) */
  readonly key: string;
  /** Entry value — valid UTF-8 text, no normalization applied (§5.2) */
  readonly value: string;
  /** Byte size of value in UTF-8 encoding */
  readonly sizeBytes: number;
  /** Creation timestamp (ISO-8601) */
  readonly createdAt: string;
  /** Last update timestamp (ISO-8601) — used for CGP P2 eviction ordering (§9.4) */
  readonly updatedAt: string;
  /** Task-local monotonic mutation-order position (WMP-I5, DERIVED-1) */
  readonly mutationPosition: number;
}

// ============================================================================
// SC-14: write_working_memory — §5.2
// ============================================================================

/**
 * §5.2: Input for SC-14 write_working_memory.
 * Creates a new entry or replaces the value of an existing entry.
 */
export interface WriteWorkingMemoryInput {
  /** Must match the calling task (WMP-I1 scope enforcement) */
  readonly taskId: TaskId;
  /**
   * Entry key — §5.2 constraints:
   * - Non-empty
   * - Max 256 UTF-8 characters
   * - No whitespace
   * - No path separators (/ \)
   * - Must not begin with reserved prefix '_wmp.'
   * - Case-sensitive, byte-stable UTF-8 comparison
   */
  readonly key: string;
  /** Entry value — valid UTF-8 text (§5.2) */
  readonly value: string;
}

/**
 * §5.2: Output for successful SC-14 write.
 */
export interface WriteWorkingMemoryOutput {
  /** The key that was written */
  readonly key: string;
  /** Byte size of the stored value */
  readonly sizeBytes: number;
  /** true if new entry created, false if existing entry replaced */
  readonly created: boolean;
  /** Task-local mutation-order position assigned to this write (DERIVED-1, WMP-I5) */
  readonly mutationPosition: number;
}

// ============================================================================
// SC-15: read_working_memory — §5.3
// ============================================================================

/**
 * §5.3: Input for SC-15 read_working_memory.
 * Reads one entry by key or lists all entries. Side-effect-free.
 */
export interface ReadWorkingMemoryInput {
  /** Must match the calling task (WMP-I1 scope enforcement) */
  readonly taskId: TaskId;
  /** If provided, read specific entry. If null, list all entries. */
  readonly key: string | null;
}

/**
 * §5.3: Output for SC-15 read — specific key.
 */
export interface ReadWorkingMemoryEntryOutput {
  readonly key: string;
  readonly value: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * §5.3: Output for SC-15 read — list all (key = null).
 */
export interface ReadWorkingMemoryListOutput {
  readonly entries: readonly ReadWorkingMemoryEntryOutput[];
  readonly totalEntries: number;
  readonly totalSizeBytes: number;
}

/**
 * §5.3: Discriminated union output for SC-15.
 * When key is provided: ReadWorkingMemoryEntryOutput.
 * When key is null: ReadWorkingMemoryListOutput.
 */
export type ReadWorkingMemoryOutput = ReadWorkingMemoryEntryOutput | ReadWorkingMemoryListOutput;

// ============================================================================
// SC-16: discard_working_memory — §5.4
// ============================================================================

/**
 * §5.4: Input for SC-16 discard_working_memory.
 * Removes one entry by key or all entries from live namespace.
 */
export interface DiscardWorkingMemoryInput {
  /** Must match the calling task (WMP-I1 scope enforcement) */
  readonly taskId: TaskId;
  /** If provided, discard specific entry. If null, discard all. */
  readonly key: string | null;
}

/**
 * §5.4: Output for successful SC-16 discard.
 */
export interface DiscardWorkingMemoryOutput {
  /** Number of entries discarded */
  readonly discardedCount: number;
  /** Total bytes freed */
  readonly freedBytes: number;
  /** Task-local mutation-order position assigned to this discard (DERIVED-1, WMP-I5) */
  readonly mutationPosition: number;
}

// ============================================================================
// Boundary Event Record — §6.2
// ============================================================================

/**
 * §6.2: Boundary event record — always created at every applicable boundary.
 * Never deduplicated. Proves the boundary was processed.
 * Immutable. No UPDATE, no DELETE. Follows I-06 retention discipline.
 */
export interface BoundaryEvent {
  /** Unique event identifier (UUID) */
  readonly eventId: BoundaryEventId;
  /** Task whose WMP namespace was captured */
  readonly taskId: TaskId;
  /** Mission owning the task */
  readonly missionId: MissionId;
  /**
   * Which governance boundary triggered this capture.
   * §6.4: checkpoint | task_terminal | mission_transition | pre_irreversible_emission
   */
  readonly trigger: BoundaryTrigger;
  /** Reference to the associated snapshot content record (§6.2) */
  readonly snapshotContentId: SnapshotContentId;
  /**
   * For pre_irreversible_emission: the SC invocation that triggered this capture.
   * For other triggers: null.
   * §6.2: links the boundary event to the specific emission.
   */
  readonly linkedEmissionId: SystemCallId | null;
  /** When the boundary capture was created (ISO-8601) */
  readonly timestamp: string;
}

// ============================================================================
// Snapshot Content Record — §6.2
// ============================================================================

/**
 * §6.2: A single entry within a snapshot content record.
 * Captures the full state of one WMP entry at boundary time.
 */
export interface SnapshotEntry {
  readonly key: string;
  readonly value: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly mutationPosition: number;
}

/**
 * §6.2: Snapshot content record — captures the logical WMP namespace state.
 * May be deduplicated when content has not changed since prior snapshot (WMP-I6).
 * 'never_initialized' and 'initialized_empty' are DISTINCT — never deduplicated
 * against each other (WMP-I6, CT-WMP-18).
 * Immutable. No UPDATE, no DELETE. Follows I-06 retention discipline.
 */
export interface SnapshotContent {
  /** Unique content identifier (UUID) */
  readonly contentId: SnapshotContentId;
  /** Three-state namespace classification (§6.2) */
  readonly namespaceState: WmpNamespaceState;
  /**
   * Snapshot entries — null when namespaceState is 'never_initialized'.
   * Empty array when 'initialized_empty'. Populated when 'initialized_with_entries'.
   * §6.3: Captures semantically visible live namespace, not raw physical storage.
   */
  readonly entries: readonly SnapshotEntry[] | null;
  /** Total entry count at capture time */
  readonly totalEntries: number;
  /** Total byte size of all entry values at capture time */
  readonly totalSizeBytes: number;
  /** Highest mutation-order position at capture time. null when never_initialized. */
  readonly highestMutationPosition: number | null;
}

// ============================================================================
// Capacity Policy — §8
// ============================================================================

/**
 * §8.1: Configurable WMP capacity limits.
 * Applied per-task. Configurable via mission policy or global configuration.
 * [V1-CHOICE] No task-level override — all tasks in a mission share the policy.
 */
export interface WmpCapacityPolicy {
  /** §8.1: Maximum entries per task WMP (default: 100) */
  readonly maxEntries: number;
  /** §8.1: Maximum bytes per entry value (default: 65536 = 64KB) */
  readonly maxBytesPerEntry: number;
  /** §8.1: Maximum total bytes per task WMP (default: 262144 = 256KB) */
  readonly maxTotalBytes: number;
}

/**
 * §8.3: Capacity metrics returned in CAPACITY_EXCEEDED error response.
 * Enables the agent to make informed capacity management decisions.
 */
export interface WmpCapacityMetrics {
  readonly currentEntryCount: number;
  readonly maxEntryCount: number;
  readonly currentSizeBytes: number;
  readonly maxSizeBytes: number;
  /** Size of the rejected write */
  readonly requestedSizeBytes: number;
}

// ============================================================================
// Pre-Emission Audit Fields — §10.2
// ============================================================================

/**
 * §10.2: WMP sourcing status for pre-emission audit records.
 * Distinguishes verified sourcing from conservative capture.
 */
export type WmpSourcingStatus =
  | 'verified'        // WMP content verified as material source (reserved for v2)
  | 'not_verified'    // v1 default: WMP initialized and captured, sourcing not verified
  | 'not_applicable'; // No WMP namespace initialized at emission time

/**
 * §10.2: Pre-emission WMP fields included in irreversible emission audit records.
 * Added to SC-4, SC-11, SC-9 audit records when task has initialized WMP.
 */
export interface PreEmissionWmpAuditFields {
  /**
   * References the boundary event record for the pre-emission capture.
   * null when wmpSourcingStatus is 'not_applicable'.
   */
  readonly preEmissionWmpCaptureId: BoundaryEventId | null;
  /**
   * §10.2: Sourcing status.
   * 'not_verified': v1 default for tasks with initialized WMP.
   * 'not_applicable': tasks where WMP was never initialized.
   * 'verified': reserved for v2 source detection.
   */
  readonly wmpSourcingStatus: WmpSourcingStatus;
}

// ============================================================================
// Error Codes — SC-14, SC-15, SC-16
// ============================================================================

/**
 * §5.2: SC-14 write_working_memory error codes (8 codes).
 */
export const SC14_ERROR_CODES = {
  /** Task does not exist (validation step 1) */
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  /** Task has reached terminal state (validation step 2) */
  TASK_TERMINATED: 'TASK_TERMINATED',
  /** Task exists but not in executable state (validation step 2) */
  TASK_NOT_EXECUTABLE: 'TASK_NOT_EXECUTABLE',
  /** Caller is not the assigned agent of this task (validation step 3) */
  TASK_SCOPE_VIOLATION: 'TASK_SCOPE_VIOLATION',
  /** Key is empty, exceeds length, contains forbidden chars, or uses reserved prefix (validation step 4) */
  WORKING_MEMORY_KEY_INVALID: 'WORKING_MEMORY_KEY_INVALID',
  /** Value is not valid UTF-8 (validation step 5) */
  WORKING_MEMORY_VALUE_INVALID: 'WORKING_MEMORY_VALUE_INVALID',
  /** Write would exceed entry-count or byte-size ceiling (validation step 6) */
  WORKING_MEMORY_CAPACITY_EXCEEDED: 'WORKING_MEMORY_CAPACITY_EXCEEDED',
  /** RBAC violation when RBAC is active (I-13) — pre-validation */
  UNAUTHORIZED: 'UNAUTHORIZED',
} as const;

/**
 * §5.3: SC-15 read_working_memory error codes (5 codes).
 */
export const SC15_ERROR_CODES = {
  /** Task does not exist */
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  /** Task has reached terminal state */
  TASK_TERMINATED: 'TASK_TERMINATED',
  /** Caller is not the assigned agent of this task */
  TASK_SCOPE_VIOLATION: 'TASK_SCOPE_VIOLATION',
  /** Specified key does not exist in this task's WMP (when key provided) */
  WORKING_MEMORY_NOT_FOUND: 'WORKING_MEMORY_NOT_FOUND',
  /** RBAC violation when RBAC is active */
  UNAUTHORIZED: 'UNAUTHORIZED',
} as const;

/**
 * §5.4: SC-16 discard_working_memory error codes (6 codes).
 */
export const SC16_ERROR_CODES = {
  /** Task does not exist */
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  /** Task has reached terminal state */
  TASK_TERMINATED: 'TASK_TERMINATED',
  /** Task not in executable state */
  TASK_NOT_EXECUTABLE: 'TASK_NOT_EXECUTABLE',
  /** Caller is not the assigned agent of this task */
  TASK_SCOPE_VIOLATION: 'TASK_SCOPE_VIOLATION',
  /** Specified key does not exist (when key provided) */
  WORKING_MEMORY_NOT_FOUND: 'WORKING_MEMORY_NOT_FOUND',
  /** RBAC violation when RBAC is active */
  UNAUTHORIZED: 'UNAUTHORIZED',
} as const;

/**
 * Union of all unique WMP error codes across SC-14, SC-15, SC-16 (9 unique).
 */
export type WmpErrorCode =
  | 'TASK_NOT_FOUND'
  | 'TASK_TERMINATED'
  | 'TASK_NOT_EXECUTABLE'
  | 'TASK_SCOPE_VIOLATION'
  | 'WORKING_MEMORY_KEY_INVALID'
  | 'WORKING_MEMORY_VALUE_INVALID'
  | 'WORKING_MEMORY_CAPACITY_EXCEEDED'
  | 'WORKING_MEMORY_NOT_FOUND'
  | 'UNAUTHORIZED';

// ============================================================================
// Key Validation Constants — §5.2
// ============================================================================

/** §5.2: Maximum key length in UTF-8 characters */
export const WMP_KEY_MAX_LENGTH = 256 as const;

/** §5.2: Reserved key prefix — system-managed metadata */
export const WMP_KEY_RESERVED_PREFIX = '_wmp.' as const;

/** §5.2: Forbidden key characters — whitespace and path separators */
export const WMP_KEY_FORBIDDEN_PATTERN = /[\s/\\]/;

// ============================================================================
// Capacity Policy Defaults — §8.1
// ============================================================================

/** §8.1: Default max entries per task WMP */
export const WMP_DEFAULT_MAX_ENTRIES = 100 as const;

/** §8.1: Default max bytes per entry value (64 KB) */
export const WMP_DEFAULT_MAX_BYTES_PER_ENTRY = 65536 as const;

/** §8.1: Default max total bytes per task WMP (256 KB) */
export const WMP_DEFAULT_MAX_TOTAL_BYTES = 262144 as const;

// ============================================================================
// Internal Read Interface — §9.2 (for CGP position 2)
// ============================================================================

/**
 * §9.2: Internal read access for context admission runtime.
 * This is NOT the agent-facing SC-15 interface.
 * Infrastructure reading its own managed state — same pattern as
 * task scheduler reading task_queue (§25.1) or retrieval reading memory (§26.5).
 *
 * NOTE: The WmpInternalEntry and WmpInternalReader interfaces are ALREADY
 * defined in src/context/interfaces/cgp_types.ts (lines 402-429).
 * This re-export exists for WMP-internal reference. The CGP definition is canonical.
 */
export type { WmpInternalEntry, WmpInternalReader } from '../../context/interfaces/cgp_types.js';

// ============================================================================
// Trigger 4 Interface — §6.4 (for CCP/SC-4/SC-9 pre-emission capture)
// ============================================================================

/**
 * NOTE: The WmpPreEmissionCapture and WmpCaptureResult interfaces are ALREADY
 * defined in src/claims/interfaces/claim_types.ts (lines 625-647).
 * This re-export exists for WMP-internal reference. The CCP definition is canonical.
 */
export type { WmpPreEmissionCapture, WmpCaptureResult } from '../../claims/interfaces/claim_types.js';

// ============================================================================
// Store Interfaces — WMP persistence layer
// ============================================================================

/**
 * WMP entry store — manages the live namespace for each task.
 * All methods enforce task scope (WMP-I1).
 */
export interface WmpEntryStore {
  /** Create or replace an entry. Returns the entry with assigned mutationPosition. */
  upsert(
    conn: DatabaseConnection,
    taskId: TaskId,
    key: string,
    value: string,
    sizeBytes: number,
  ): Result<WmpEntry>;

  /** Read a specific entry by key. Returns WORKING_MEMORY_NOT_FOUND if absent. */
  get(conn: DatabaseConnection, taskId: TaskId, key: string): Result<WmpEntry>;

  /** List all live entries for a task. Returns empty array if no entries or never initialized. */
  listAll(conn: DatabaseConnection, taskId: TaskId): Result<readonly WmpEntry[]>;

  /** Discard a specific entry by key. Returns WORKING_MEMORY_NOT_FOUND if absent. */
  discard(conn: DatabaseConnection, taskId: TaskId, key: string): Result<{ freedBytes: number }>;

  /** Discard all entries for a task. Returns count and bytes freed. */
  discardAll(conn: DatabaseConnection, taskId: TaskId): Result<{ discardedCount: number; freedBytes: number }>;

  /** Get current capacity usage for a task. */
  getUsage(conn: DatabaseConnection, taskId: TaskId): Result<{ entryCount: number; totalBytes: number }>;

  /** Check if WMP namespace has been initialized (SC-14 called at least once). */
  isInitialized(conn: DatabaseConnection, taskId: TaskId): Result<boolean>;

  /** Get the current namespace state for a task. */
  getNamespaceState(conn: DatabaseConnection, taskId: TaskId): Result<WmpNamespaceState>;
}

/**
 * Boundary snapshot store — manages BoundaryEvent and SnapshotContent records.
 * All records are immutable (I-06 audit retention discipline).
 */
export interface WmpBoundaryStore {
  /** Create a boundary event record. Always created — never deduplicated. */
  createBoundaryEvent(
    conn: DatabaseConnection,
    event: Omit<BoundaryEvent, 'eventId'>,
  ): Result<BoundaryEvent>;

  /** Create a snapshot content record. May be deduplicated. */
  createSnapshotContent(
    conn: DatabaseConnection,
    content: Omit<SnapshotContent, 'contentId'>,
  ): Result<SnapshotContent>;

  /**
   * Find existing snapshot content matching the given state (for deduplication).
   * Returns null if no matching content exists.
   * §6.2: never_initialized and initialized_empty must NOT match each other.
   */
  findMatchingContent(
    conn: DatabaseConnection,
    taskId: TaskId,
    namespaceState: WmpNamespaceState,
    highestMutationPosition: number | null,
  ): Result<SnapshotContent | null>;

  /** Get boundary event by ID. */
  getBoundaryEvent(conn: DatabaseConnection, eventId: BoundaryEventId): Result<BoundaryEvent>;

  /** Get snapshot content by ID. */
  getSnapshotContent(conn: DatabaseConnection, contentId: SnapshotContentId): Result<SnapshotContent>;

  /** List all boundary events for a task, ordered by timestamp. */
  listBoundaryEvents(conn: DatabaseConnection, taskId: TaskId): Result<readonly BoundaryEvent[]>;
}

// ============================================================================
// Mutation Counter — WMP-I5 deterministic mutation order
// ============================================================================

/**
 * WMP-I5, DERIVED-1: Task-local monotonic mutation counter.
 * Only advances on SUCCESSFUL visible mutations (create, replace, discard).
 * Failed operations do NOT advance the counter.
 */
export interface WmpMutationCounter {
  /** Get the next mutation-order position for a task. Atomically increments. */
  next(conn: DatabaseConnection, taskId: TaskId): Result<number>;

  /** Get the current (latest assigned) mutation-order position. null if none assigned. */
  current(conn: DatabaseConnection, taskId: TaskId): Result<number | null>;
}

// ============================================================================
// Boundary Capture Coordinator — §6 snapshot orchestration
// ============================================================================

/**
 * §6: Coordinates boundary snapshot creation at governed boundaries.
 * Invoked by the system (NOT by agents). No public system call.
 *
 * This is the core WMP audit mechanism — the accountability model
 * for the I-03 exception (WMP-I3).
 */
export interface WmpBoundaryCaptureCoordinator {
  /**
   * §6.4 Trigger 1: Capture at checkpoint boundary.
   * Unconditional — fires for every applicable task at every checkpoint.
   */
  captureAtCheckpoint(
    conn: DatabaseConnection,
    taskId: TaskId,
    missionId: MissionId,
  ): Result<BoundaryEvent>;

  /**
   * §6.4 Trigger 2: Capture at task terminal state.
   * ATOMIC: capture + transition + discard (WMP-I7).
   * Captures pre-discard live state. No intermediate state is observable.
   * F-WMP-BB-01: terminalState must be the actual terminal state, never hard-coded.
   */
  captureAtTerminal(
    conn: DatabaseConnection,
    taskId: TaskId,
    missionId: MissionId,
    terminalState: WmpTerminalState,
  ): Result<BoundaryEvent>;

  /**
   * §6.4 Trigger 3: Capture at mission transition.
   * Unconditional — fires when owning mission transitions while task is active.
   */
  captureAtMissionTransition(
    conn: DatabaseConnection,
    taskId: TaskId,
    missionId: MissionId,
  ): Result<BoundaryEvent>;

  /**
   * §6.4 Trigger 4: Pre-emission capture.
   * Only fires after validation passes, before emission commits.
   * Only fires if task has initialized WMP namespace.
   * Returns capture result for inclusion in emission audit record.
   *
   * If capture fails, emission MUST be blocked (§6.6).
   */
  capturePreEmission(
    conn: DatabaseConnection,
    taskId: TaskId,
    missionId: MissionId,
    emissionId: SystemCallId,
  ): Result<BoundaryEvent>;

  /**
   * Trigger 5: Capture at task suspension boundary (Memory Doctrine, DC-WMP-213).
   * Unconditional — fires when task transitions to suspended state.
   * Establishes the "known version boundary" for resume semantics.
   * v1 conservative policy: captures even for never-initialized tasks.
   */
  captureAtSuspension(
    conn: DatabaseConnection,
    taskId: TaskId,
    missionId: MissionId,
  ): Result<BoundaryEvent>;
}

// ============================================================================
// System Call Handlers — SC-14, SC-15, SC-16
// ============================================================================

/**
 * §5.2: SC-14 write_working_memory handler.
 * Creates or replaces entries. Enforces key/value/capacity constraints.
 * No per-mutation audit (WMP-I3). No dependency tracking.
 */
export interface WriteWorkingMemoryHandler {
  execute(
    conn: DatabaseConnection,
    callerTaskId: TaskId,
    callerAgentId: AgentId,
    input: WriteWorkingMemoryInput,
  ): Result<WriteWorkingMemoryOutput>;
}

/**
 * §5.3: SC-15 read_working_memory handler.
 * Side-effect-free. No dependency tracking (unlike SC-5, §5.3).
 * Returns only live namespace state, never boundary capture data (WMP-I4).
 */
export interface ReadWorkingMemoryHandler {
  execute(
    conn: DatabaseConnection,
    callerTaskId: TaskId,
    callerAgentId: AgentId,
    input: ReadWorkingMemoryInput,
  ): Result<ReadWorkingMemoryOutput>;
}

/**
 * §5.4: SC-16 discard_working_memory handler.
 * Semantic discard — entries are no longer accessible or context candidates.
 * Physical reclamation is implementation choice.
 * No per-mutation audit (WMP-I3).
 */
export interface DiscardWorkingMemoryHandler {
  execute(
    conn: DatabaseConnection,
    callerTaskId: TaskId,
    callerAgentId: AgentId,
    input: DiscardWorkingMemoryInput,
  ): Result<DiscardWorkingMemoryOutput>;
}

// ============================================================================
// WMP System Facade — top-level interface
// ============================================================================

/**
 * WMP System — the Working Memory Protocol facade.
 * Orchestrates live namespace operations, boundary captures, and capacity enforcement.
 *
 * WMP is kernel infrastructure — not LLM-dependent.
 * SC-14/SC-15/SC-16 are direct kernel operations, not model invocations.
 * They do not consume EGP token reservations or DBA admissibility.
 */
export interface WorkingMemorySystem {
  /** SC-14 handler */
  readonly write: WriteWorkingMemoryHandler;
  /** SC-15 handler */
  readonly read: ReadWorkingMemoryHandler;
  /** SC-16 handler */
  readonly discard: DiscardWorkingMemoryHandler;
  /** Boundary capture coordinator (§6) */
  readonly boundary: WmpBoundaryCaptureCoordinator;
  /** Entry store */
  readonly entryStore: WmpEntryStore;
  /** Boundary store */
  readonly boundaryStore: WmpBoundaryStore;
  /** Mutation counter (WMP-I5) */
  readonly mutationCounter: WmpMutationCounter;
  /** Capacity policy */
  readonly capacityPolicy: WmpCapacityPolicy;
  /** Task lifecycle handler (DC-WMP-X07, X13, DC-WMP-214) */
  readonly taskLifecycle: WmpTaskLifecycleHandler;
}

// ============================================================================
// Dependencies — what WMP needs from the host system
// ============================================================================

/**
 * External dependencies injected into the WMP system.
 * Follows the factory pattern from CCP/CGP harnesses.
 */
export interface WmpSystemDeps {
  /** Database connection provider */
  readonly getConnection: () => DatabaseConnection;
  /**
   * Audit trail for boundary event/snapshot storage (I-06).
   * NOTE: WMP does NOT use audit for per-mutation logging (WMP-I3).
   * Used only for boundary capture metadata and system alerts.
   */
  readonly audit: AuditTrail;
  /** Event bus for WMP system events (FM-WMP-02 alerts, etc.) */
  readonly events: EventBus;
  /**
   * Binding 8, DC-WMP-X09: Constitutional trace emission for 3 WMP governance events
   * (memory.published, memory.tombstoned, memory.promoted).
   * Binding 14: Transaction-coupled emission within SQLite transactions.
   */
  readonly traceEmitter: TraceEmitter;
  /** DC-WMP-X15: Event sink for state mutation events (Binding 14). */
  readonly eventSink?: WmpEventSink;
  /** Capacity policy configuration */
  readonly capacityPolicy: WmpCapacityPolicy;
  /** Hard Stop #7: Injectable clock for deterministic temporal logic. */
  readonly time: import('../../kernel/interfaces/time.js').TimeProvider;
}

// ============================================================================
// Event Types — WMP system events
// ============================================================================

/** Event types emitted by WMP through the event bus */
export const WMP_EVENTS = {
  /** Emitted when a boundary capture is created (§6.2) */
  BOUNDARY_CAPTURED: 'wmp.boundary.captured',
  /** Emitted when boundary capture fails (FM-WMP-02) */
  BOUNDARY_CAPTURE_FAILED: 'wmp.boundary.capture_failed',
  /** Emitted when capacity threshold is approached (FM-WMP-03 monitoring) */
  CAPACITY_WARNING: 'wmp.capacity.warning',
  /** Emitted on terminal discard (§6.4 Trigger 2) */
  TERMINAL_DISCARD: 'wmp.terminal.discard',
  /** DC-WMP-X15: Emitted on successful SC-14 write (Binding 14 transaction-coupled) */
  ENTRY_WRITTEN: 'wmp.entry.written',
  /** DC-WMP-X15: Emitted on successful SC-16 discard (Binding 14 transaction-coupled) */
  ENTRY_DISCARDED: 'wmp.entry.discarded',
} as const;

// ============================================================================
// Event Sink — decoupled event emission for DC-WMP-X15 (Binding 14)
// ============================================================================

/**
 * DC-WMP-X15, Binding 14: Lightweight callback interface for WMP event emission.
 * Decouples store implementations from EventBus (which requires OperationContext).
 * Harness maps this to EventBus at integration time. Tests inject a recorder.
 *
 * F-WMP-BB-02: Event emission must be wired at every state mutation point.
 * If emit throws, the WMP operation STILL SUCCEEDS (per I-48 — trace failures
 * do not roll back writes). Implementations must catch and log, never propagate.
 */
export interface WmpEventSink {
  emit(eventType: string, taskId: TaskId, data: Record<string, unknown>): void;
}

/**
 * No-op event sink for backward compatibility when no EventBus is available.
 */
export const WMP_NULL_EVENT_SINK: WmpEventSink = Object.freeze({
  emit(): void { /* no-op */ },
});

// ============================================================================
// Task Lifecycle Handler — EGP→WMP wiring (DC-WMP-X07, X13, X14)
// ============================================================================

/**
 * DC-WMP-X07, DC-WMP-X13: EGP→WMP lifecycle notification interface.
 * Invoked by task_store when task lifecycle state changes.
 * Terminal: triggers atomic capture+transition+discard (WMP-I7).
 * Suspension: triggers boundary snapshot + write-protection (Memory Doctrine).
 * Resume: restores write access, verifies namespace integrity (DC-WMP-214).
 */
export interface WmpTaskLifecycleHandler {
  /**
   * DC-WMP-X07: Task reached terminal state (COMPLETED/FAILED/CANCELLED).
   * Must atomically: (1) capture boundary snapshot, (2) discard live namespace,
   * (3) physically reclaim entry rows (DC-WMP-209).
   * F-WMP-BB-01: terminalState must be the actual terminal state.
   */
  onTaskTerminal(
    conn: DatabaseConnection,
    taskId: TaskId,
    missionId: MissionId,
    terminalState: WmpTerminalState,
  ): Result<BoundaryEvent>;

  /**
   * DC-WMP-X13: Task suspended (Binding 15 cascade or supervisor action).
   * Must: (1) capture boundary snapshot at suspension (DC-WMP-213),
   * (2) enable write-protection (DC-WMP-212 — SC-14/SC-16 return TASK_NOT_EXECUTABLE).
   */
  onTaskSuspended(
    conn: DatabaseConnection,
    taskId: TaskId,
    missionId: MissionId,
  ): Result<BoundaryEvent>;

  /**
   * DC-WMP-214: Task resumed from suspension.
   * Must verify namespace integrity — all pre-suspension entries intact.
   */
  onTaskResumed(
    conn: DatabaseConnection,
    taskId: TaskId,
    missionId: MissionId,
  ): Result<void>;
}

// ============================================================================
// Configuration Constants — §8, derived from design source
// ============================================================================

/** Default capacity policy matching §8.1 defaults */
export const WMP_DEFAULT_CAPACITY_POLICY: WmpCapacityPolicy = Object.freeze({
  maxEntries: WMP_DEFAULT_MAX_ENTRIES,
  maxBytesPerEntry: WMP_DEFAULT_MAX_BYTES_PER_ENTRY,
  maxTotalBytes: WMP_DEFAULT_MAX_TOTAL_BYTES,
});
