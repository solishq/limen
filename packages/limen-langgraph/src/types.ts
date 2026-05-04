/**
 * @limen-ai/langgraph — Type definitions
 *
 * Defines the contracts for Limen core dependencies (chain, projection,
 * projector, validity) and LangGraph checkpoint interfaces.
 *
 * These interfaces are the TypeScript contract that the v5 Rust FFI bindings
 * will implement. The adapter codes against these interfaces, not concrete
 * implementations.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Limen Core Interfaces
// ═══════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Chain — append-only immutable log (v1.4 §7)
// ---------------------------------------------------------------------------

/** Input for appending a new entry to the chain */
export interface ChainEntryInput {
  /** Discriminator: LgCheckpoint | LgWrite | LgDelete | LgStorePut | LgStoreDelete */
  transition_kind: string;
  /** Tenant namespace — top-level field, NOT inside state_json (Claim 2.19, 5.3) */
  tenant_scope: string;
  /** MessagePack-encoded payload */
  state_json: Uint8Array;
}

/** Result of a committed chain entry */
export interface CommittedEntry {
  /** Monotonically increasing sequence number */
  global_sequence: number;
  /** Authoritative timestamp (epoch ms) */
  canonical_at: number;
}

/** Append-only chain storage */
export interface ChainStorage {
  appendEntry(entry: ChainEntryInput): Promise<CommittedEntry>;
}

// ---------------------------------------------------------------------------
// Projection — derived read-optimized SQLite tables (v1.4 §7.2)
// ---------------------------------------------------------------------------

/** Read-only access to projection tables */
export interface ProjectionStorage {
  /** Execute a SELECT query, returns all matching rows */
  query<T = Record<string, unknown>>(sql: string, params: unknown[]): T[];
  /** Execute a SELECT query, returns first row or undefined */
  queryOne<T = Record<string, unknown>>(sql: string, params: unknown[]): T | undefined;
  /** Read projection_metadata value by key */
  getMetadata(key: string): string | undefined;
  /** Write projection_metadata value by key */
  setMetadata(key: string, value: string): void;
}

// ---------------------------------------------------------------------------
// Projector — derives projection rows from chain entries (v1.4 §7.3)
// ---------------------------------------------------------------------------

/** Projector engine */
export interface Projector {
  /** Process pending chain entries and update projection tables (Claim 2.20) */
  projectPending(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Validity State Machine — tracks projection integrity (v1.4 §8)
// ---------------------------------------------------------------------------

export type ValidityState = 'Verified' | 'Lagging' | 'Unverified' | 'Divergent' | 'Rebuilding';

export interface ValidityStateMachine {
  /** Current projection validity state */
  currentState(): ValidityState;
  /** Run startup verification (digest check, tamper detection) */
  verifyOnStartup(): Promise<void>;
}

// ---------------------------------------------------------------------------
// NonAuthoritative wrapper (Claim 4.9, 4.10)
// ---------------------------------------------------------------------------

/** Wrapper indicating data is from a projection, not the chain */
export interface NonAuthoritative<T> {
  /** Extract the inner value */
  into_inner(): T;
}

// ---------------------------------------------------------------------------
// Serializer Protocol (Claim 6.1, 6.2)
// ---------------------------------------------------------------------------

export interface SerializerProtocol {
  /** Serialize data to [typeTag, bytes]. Uint8Array → "bytes", else → "json" */
  dumpsTyped(data: unknown): [string, Uint8Array];
  /** Deserialize from typeTag + bytes back to original type */
  loadsTyped(typeTag: string, data: Uint8Array): unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// LangGraph Checkpoint Interfaces (from @langchain/langgraph-checkpoint v1.0.1)
// These are peer dependency types — defined here for compile-time contract.
// ═══════════════════════════════════════════════════════════════════════════

/** LangGraph configurable parameters */
export interface RunnableConfigurable {
  thread_id?: string;
  checkpoint_ns?: string;
  checkpoint_id?: string;
  /** Limen-specific: per-request tenant override (Claim 5.1) */
  limen_tenant_scope?: string;
}

/** LangGraph runtime config */
export interface RunnableConfig {
  configurable?: RunnableConfigurable;
}

/** Checkpoint object (opaque to the adapter — serialized as-is) */
export interface Checkpoint {
  id: string;
  v: number;
  ts: string;
  channel_values: Record<string, unknown>;
  channel_versions: Record<string, number>;
  versions_seen: Record<string, Record<string, number>>;
  pending_sends: unknown[];
}

/** Checkpoint metadata */
export interface CheckpointMetadata {
  source: 'input' | 'loop' | 'update' | 'fork';
  step: number;
  writes: Record<string, unknown> | null;
  parents: Record<string, string>;
  /** Extra properties preserved through JSON round-trip (Claim 2.17, 6.5) */
  [key: string]: unknown;
}

/** Channel version map */
export type ChannelVersions = Record<string, number>;

/** Pending write: [taskId, channel, value] */
export type CheckpointPendingWrite = [string, string, unknown];

/** Result of getTuple() */
export interface CheckpointTuple {
  config: RunnableConfig;
  checkpoint: Checkpoint;
  metadata: CheckpointMetadata;
  parentConfig?: RunnableConfig;
  pendingWrites: CheckpointPendingWrite[];
}

/** Pending write input: [channel, value] */
export type PendingWrite = [string, unknown];

/** Filter for list() — 8 operators (Claim 2.9) */
export type FilterValue =
  | { $eq: unknown }
  | { $ne: unknown }
  | { $gt: unknown }
  | { $gte: unknown }
  | { $lt: unknown }
  | { $lte: unknown }
  | { $in: unknown[] }
  | { $nin: unknown[] };

export interface CheckpointListOptions {
  /** Only return checkpoints before this config */
  before?: RunnableConfig;
  /** Filter on metadata fields */
  filter?: Record<string, FilterValue | unknown>;
  /** Maximum results (default: no limit, bounded by scan cap) */
  limit?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// LangGraph Store Interfaces (from @langchain/langgraph-checkpoint v1.0.1)
// ═══════════════════════════════════════════════════════════════════════════

/** Store item returned by get/search */
export interface Item {
  key: string;
  namespace: string[];
  value: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** Search result item — extends Item with optional score */
export interface SearchItem extends Item {
  /** Always undefined from this adapter (Claim 3.12) */
  score: undefined;
}

/** Get operation for batch() */
export interface GetOperation {
  readonly namespace: string[];
  readonly key: string;
}

/** Put operation for batch() — value=null means delete (Claim 3.19) */
export interface PutOperation {
  readonly namespace: string[];
  readonly key: string;
  readonly value: Record<string, unknown> | null;
  readonly index?: false | string[];
}

/** Search operation for batch() */
export interface SearchOperation {
  readonly namespacePrefix: string[];
  readonly filter?: Record<string, unknown>;
  readonly limit?: number;
  readonly offset?: number;
  /** If set, throws Error("Semantic search not supported") (Claim 3.13) */
  readonly query?: string;
}

/** Match condition for listNamespaces (Claim 3.17) */
export interface MatchCondition {
  matchType: 'prefix' | 'suffix';
  path: string[];
}

/** ListNamespaces operation for batch() */
export interface ListNamespacesOperation {
  readonly matchConditions?: MatchCondition[];
  readonly maxDepth?: number;
  readonly limit?: number;
  readonly offset?: number;
}

/** Union of all batch operations */
export type Operation = GetOperation | PutOperation | SearchOperation | ListNamespacesOperation;

/** Result type for a single operation */
export type OperationResult<Op> =
  Op extends GetOperation ? Item | null :
  Op extends PutOperation ? undefined :
  Op extends SearchOperation ? SearchItem[] :
  Op extends ListNamespacesOperation ? string[][] :
  never;

/** Result types for a batch of operations */
export type OperationResults<Ops extends Operation[]> = {
  [K in keyof Ops]: OperationResult<Ops[K]>;
};

/** Row from lg_store_items projection table */
export interface LgStoreItemRow {
  tenant_scope: string;
  namespace: string;
  key: string;
  value_json: string;
  index_fields: string | null;
  created_at: number;
  updated_at: number;
  global_sequence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Adapter Configuration (Design doc §0.4)
// ═══════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Logger Interface — Pluggable structured logging (Observability)
// ---------------------------------------------------------------------------

/** Pluggable logger for LimenCheckpointSaver and LimenStore */
export interface LimenCheckpointLogger {
  /** Warning-level log — always required */
  warn(msg: string, context?: Record<string, unknown>): void;
  /** Info-level log — optional, used for governance gate events */
  info?(msg: string, context?: Record<string, unknown>): void;
  /** Debug-level log — optional, used for detailed operation tracing */
  debug?(msg: string, context?: Record<string, unknown>): void;
}

export interface LimenCheckpointerConfig {
  /** Limen chain storage instance */
  chain: ChainStorage;
  /** Limen projection storage instance */
  projection: ProjectionStorage;
  /** Limen projector for synchronous derivation */
  projector: Projector;
  /** Validity state machine reference */
  validity: ValidityStateMachine;
  /** Serializer protocol (default: JsonPlusSerializer) */
  serde?: SerializerProtocol;
  /** When true, reads require Verified state. When false, Lagging acceptable. Default: false */
  governed?: boolean;
  /** Tenant scope for multi-tenant isolation. Default: '__default__' */
  tenantScope?: string;
  /** Pluggable logger. Default: console.warn wrapper */
  logger?: LimenCheckpointLogger;
}

// ═══════════════════════════════════════════════════════════════════════════
// Projection Row Types (from lg_* tables)
// ═══════════════════════════════════════════════════════════════════════════

/** Row from lg_checkpoints projection table */
export interface LgCheckpointRow {
  tenant_scope: string;
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  type_tag: string;
  checkpoint_blob: Uint8Array;
  metadata_json: string;
  step: number;
  source: string;
  created_at: number;
  global_sequence: number;
}

/** Row from lg_pending_writes projection table */
export interface LgPendingWriteRow {
  tenant_scope: string;
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  task_id: string;
  channel: string;
  type_tag: string;
  value: Uint8Array;
  write_idx: number;
  global_sequence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants (Design doc Appendix A.3)
// ═══════════════════════════════════════════════════════════════════════════

/** Special channel → negative write index mapping (Claim 2.24) */
export const WRITES_IDX_MAP: Record<string, number> = {
  '__error__': -1,
  '__scheduled__': -2,
  '__interrupt__': -3,
  '__resume__': -4,
};

/** __pregel_tasks is NOT in WRITES_IDX_MAP — uses sequential idx (Claim 2.24) */
export const TASKS = '__pregel_tasks';

/** Scan cap for list(), search(), listNamespaces() (Claims 2.14, 3.14, 3.16) */
export const MAX_SCAN_ROWS = 50_000;

/** Valid filter operators (Claim 2.9) */
export const VALID_FILTER_OPS = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin'] as const;

/** Default tenant scope */
export const DEFAULT_TENANT_SCOPE = '__default__';

/** Schema version this adapter requires */
export const ADAPTER_SCHEMA_VERSION = 2;
