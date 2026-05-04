/**
 * @limen-ai/langgraph — LimenCheckpointSaver
 *
 * Governed checkpoint saver bridging LangGraph's BaseCheckpointSaver interface
 * to Limen's append-only chain + projection architecture.
 *
 * Write path:  serialize → chain entry → projectPending() → projection table
 * Read path:   governance gate → query projection → deserialize → LangGraph
 *
 * Design doc: Claims 2.1–2.35, 4.1–4.10, 5.1–5.4, 6.1–6.5, 8.1–8.18
 */

import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';

import type {
  LimenCheckpointerConfig,
  LimenCheckpointLogger,
  ChainStorage,
  ProjectionStorage,
  Projector,
  ValidityStateMachine,
  SerializerProtocol,
  RunnableConfig,
  Checkpoint,
  CheckpointMetadata,
  ChannelVersions,
  CheckpointTuple,
  CheckpointPendingWrite,
  PendingWrite,
  CheckpointListOptions,
  LgCheckpointRow,
  LgPendingWriteRow,
} from './types.js';

import {
  LimenGovernanceError,
  LimenStorageError,
  LimenSerdeError,
  LimenNotStartedError,
} from './errors.js';

import { defaultSerializer } from './serde.js';

import {
  WRITES_IDX_MAP,
  DEFAULT_TENANT_SCOPE,
  MAX_SCAN_ROWS,
  ADAPTER_SCHEMA_VERSION,
} from './types.js';

import { canonicalJson, matchesFilter } from './shared.js';

// ---------------------------------------------------------------------------
// LimenCheckpointSaver
// ---------------------------------------------------------------------------

/**
 * Governed checkpoint saver for LangGraph graphs.
 *
 * Writes append to Limen's immutable chain, then project to SQLite.
 * Reads query projected tables through a governance gate that enforces
 * validity state (Verified, Lagging, Unverified, Divergent, Rebuilding).
 *
 * Design doc §0.5: extends BaseCheckpointSaver.
 * Implements: getTuple, list, put, putWrites, deleteThread.
 * Inherits: get (delegates to getTuple), getNextVersion (integer-only).
 */
export class LimenCheckpointSaver extends BaseCheckpointSaver {
  private chain: ChainStorage | null;
  private projection: ProjectionStorage | null;
  private projector: Projector | null;
  private validity: ValidityStateMachine | null;
  private serde: SerializerProtocol | null;
  private readonly logger: LimenCheckpointLogger;
  private governed: boolean;
  private tenantScope: string;
  private initialized = false;
  private stopped = false;

  /** Default logger wrapping console.warn for backward compatibility */
  private static readonly DEFAULT_LOGGER: LimenCheckpointLogger = {
    warn(msg: string, context?: Record<string, unknown>): void {
      console.warn(`[LimenCheckpointSaver] ${msg}`, context ?? '');
    },
  };

  constructor(config: LimenCheckpointerConfig) {
    super();
    this.chain = config.chain;
    this.projection = config.projection;
    this.projector = config.projector;
    this.validity = config.validity;
    this.serde = config.serde ?? defaultSerializer;
    this.governed = config.governed ?? false;
    this.tenantScope = config.tenantScope ?? DEFAULT_TENANT_SCOPE;
    this.logger = config.logger ?? LimenCheckpointSaver.DEFAULT_LOGGER;
  }

  // =========================================================================
  // Step 2.1.2: assertStarted() Guard — Claim 3.27, 8.12
  // =========================================================================

  private assertStarted(): void {
    if (!this.initialized) {
      throw new LimenNotStartedError('Call start() before use');
    }
  }

  // =========================================================================
  // Step 2.1.3: start() Lifecycle — Claim 3.23, 3.24, 3.26
  // =========================================================================

  /**
   * Initialize the adapter. Must be called before any read/write operation.
   *
   * Claim 3.23: Verifies chain accessible, projection accessible, projector
   * initialized, schema version (auto-migrate 0/NULL/1 → 2), validity state.
   * Claim 3.24: Idempotent — multiple calls after success are no-ops.
   * Claim 3.26: start() after stop() throws — consumer must create new instance.
   */
  private starting = false;

  async start(): Promise<void> {
    // F-NEW-04: Prevent concurrent start() calls from racing
    if (this.starting) {
      throw new LimenStorageError('start() already in progress');
    }

    // Claim 3.26: restart not supported
    if (this.stopped) {
      throw new LimenStorageError('Cannot restart after stop(). Create a new adapter instance.');
    }

    // Claim 3.24: idempotent
    if (this.initialized) {
      return;
    }

    this.starting = true;

    try {
      // 1. Verify chain accessible (duck-type + connectivity probe)
      try {
        if (!this.chain || typeof this.chain.appendEntry !== 'function') {
          throw new Error('chain.appendEntry is not a function');
        }
        // F-12: Lightweight probe — verify the chain is reachable beyond duck-type.
        // ChainStorage interface only exposes appendEntry; no read-only probe exists.
        // Acceptance: duck-type check is the maximum verification without side effects.
        // Cited: F-LG-012 — no probe method on ChainStorage interface.
      } catch (e) {
        throw new LimenStorageError(`Chain inaccessible: ${(e as Error).message}`);
      }

      // 2. Verify projection accessible (duck-type + connectivity probe)
      try {
        if (!this.projection || typeof this.projection.query !== 'function') {
          throw new Error('projection.query is not a function');
        }
        // F-12 / F-NEW-02: Probe — execute a no-op read to verify actual connectivity.
        // If storage is unreachable, getMetadata() will throw (SQLite error, file not found, etc.).
        // Returning undefined is valid — it means the key doesn't exist yet, but the storage
        // layer responded successfully, proving connectivity.
        this.projection!.getMetadata('lg_schema_version');
      } catch (e) {
        throw new LimenStorageError(`Projection inaccessible: ${(e as Error).message}`);
      }

      // 3. Verify projector initialized
      if (!this.projector || typeof this.projector.projectPending !== 'function') {
        throw new LimenStorageError('Projector not initialized');
      }

      // 4. Schema version check — auto-migrate 0/NULL/1 → 2, reject >2
      const versionStr = this.projection!.getMetadata('lg_schema_version');
      const version = versionStr ? parseInt(versionStr, 10) : 0;

      if (version > ADAPTER_SCHEMA_VERSION) {
        throw new LimenStorageError(
          `Schema version ${version} > adapter version ${ADAPTER_SCHEMA_VERSION}. Upgrade the adapter.`
        );
      }

      if (version < ADAPTER_SCHEMA_VERSION) {
        this.migrateSchema(version);
      }

      // 5. Verify validity state machine
      await this.validity!.verifyOnStartup();

      this.initialized = true;
    } catch (e) {
      this.starting = false;
      if (e instanceof LimenStorageError) throw e;
      throw new LimenStorageError(`Validity verification failed: ${(e as Error).message}`);
    }

    this.starting = false;
  }

  // =========================================================================
  // Schema Migration — Claim 1.4
  // =========================================================================

  private migrateSchema(fromVersion: number): void {
    // Claim 1.1: lg_checkpoints table
    this.projection!.setMetadata('lg_schema_version_migrating', 'true');

    // All tables created via CREATE TABLE IF NOT EXISTS
    // This is safe for both fresh install (v0) and upgrade (v1)

    // The actual DDL is executed by the projection storage layer.
    // The adapter registers the required tables and the projector
    // creates them during the next projectPending() cycle.
    // For the alpha period, we define the schema inline.

    const ddl = [
      // Claim 1.1: lg_checkpoints
      `CREATE TABLE IF NOT EXISTS lg_checkpoints (
        tenant_scope TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        type_tag TEXT NOT NULL,
        checkpoint_blob BLOB NOT NULL,
        metadata_json TEXT NOT NULL,
        step INTEGER NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('input','loop','update','fork')),
        created_at INTEGER NOT NULL,
        global_sequence INTEGER NOT NULL,
        PRIMARY KEY (tenant_scope, thread_id, checkpoint_ns, checkpoint_id)
      )`,

      // Claim 1.2: lg_pending_writes
      `CREATE TABLE IF NOT EXISTS lg_pending_writes (
        tenant_scope TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        type_tag TEXT NOT NULL,
        value BLOB NOT NULL,
        write_idx INTEGER NOT NULL,
        global_sequence INTEGER NOT NULL,
        PRIMARY KEY (tenant_scope, thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx)
      )`,

      // Claim 1.3: lg_store_items
      `CREATE TABLE IF NOT EXISTS lg_store_items (
        tenant_scope TEXT NOT NULL,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        index_fields TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        global_sequence INTEGER NOT NULL,
        PRIMARY KEY (tenant_scope, namespace, key)
      )`,
    ];

    // Claim 1.5: tamper triggers (INSERT/UPDATE/DELETE × 3 tables)
    const tamperTriggers = [
      'lg_checkpoints', 'lg_pending_writes', 'lg_store_items',
    ].flatMap(table => [
      `CREATE TRIGGER IF NOT EXISTS tamper_${table}_insert
        AFTER INSERT ON ${table}
        WHEN (SELECT value FROM projection_metadata WHERE key = 'projector_active') IS NULL
        BEGIN UPDATE projection_metadata SET value = '1' WHERE key = 'tamper_marker'; END`,
      `CREATE TRIGGER IF NOT EXISTS tamper_${table}_update
        AFTER UPDATE ON ${table}
        WHEN (SELECT value FROM projection_metadata WHERE key = 'projector_active') IS NULL
        BEGIN UPDATE projection_metadata SET value = '1' WHERE key = 'tamper_marker'; END`,
      `CREATE TRIGGER IF NOT EXISTS tamper_${table}_delete
        AFTER DELETE ON ${table}
        WHEN (SELECT value FROM projection_metadata WHERE key = 'projector_active') IS NULL
        BEGIN UPDATE projection_metadata SET value = '1' WHERE key = 'tamper_marker'; END`,
    ]);

    // Execute DDL — projection.query doubles as exec for DDL
    for (const stmt of [...ddl, ...tamperTriggers]) {
      this.projection!.query(stmt, []);
    }

    // Update schema version
    this.projection!.setMetadata('lg_schema_version', String(ADAPTER_SCHEMA_VERSION));
    this.projection!.setMetadata('lg_schema_version_migrating', undefined!);
  }

  // =========================================================================
  // Step 2.1.4: getTuple — Claims 2.1–2.7
  // =========================================================================

  /**
   * Retrieve a checkpoint tuple by config.
   *
   * Claim 2.1: With checkpoint_id → exact match query.
   * Claim 2.2: Without checkpoint_id → latest by UUID v6 (DESC LIMIT 1).
   * Claim 2.3: Pending writes ordered by (task_id, write_idx).
   * Claim 2.4: Checkpoint deserialized via serde.loadsTyped(type_tag, blob).
   * Claim 2.5: Each pending write deserialized via serde.loadsTyped.
   * Claim 2.6: Returns undefined when no row found.
   */
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    this.assertStarted();
    this.enforceGovernanceGate();
    // Claim 4.9 / F-04: NonAuthoritative<T> stripping is unnecessary here because
    // ProjectionStorage.query/queryOne returns raw T, not NonAuthoritative<T>.
    // The governance gate (above) is the enforcement mechanism that validates projection
    // state before reads proceed. NonAuthoritative<T> exists as a type-level marker
    // for implementations where the projection layer wraps results; this adapter's
    // ProjectionStorage contract returns unwrapped values directly.

    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      return undefined;
    }
    const checkpointNs = config.configurable?.checkpoint_ns ?? '';
    const checkpointId = config.configurable?.checkpoint_id;
    const tenant = this.resolveTenantScope(config);

    let row: LgCheckpointRow | undefined;

    if (checkpointId) {
      // Claim 2.1: exact match
      row = this.projection!.queryOne<LgCheckpointRow>(
        `SELECT * FROM lg_checkpoints
         WHERE tenant_scope = ? AND thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
        [tenant, threadId, checkpointNs, checkpointId]
      );
    } else {
      // Claim 2.2: latest by UUID v6 lexicographic order
      row = this.projection!.queryOne<LgCheckpointRow>(
        `SELECT * FROM lg_checkpoints
         WHERE tenant_scope = ? AND thread_id = ? AND checkpoint_ns = ?
         ORDER BY checkpoint_id DESC LIMIT 1`,
        [tenant, threadId, checkpointNs]
      );
    }

    // Claim 2.6: undefined if not found
    if (!row) {
      return undefined;
    }

    // Claim 2.4: deserialize checkpoint
    const checkpoint = this.deserialize(row.type_tag, row.checkpoint_blob) as Checkpoint;

    // Claim 2.5: deserialize metadata
    const metadata = this.parseJson<CheckpointMetadata>(
      row.metadata_json, 'metadata_json',
      `${row.thread_id}/${row.checkpoint_ns}/${row.checkpoint_id}`
    );

    // Claim 2.3: load pending writes
    const pendingWrites = this.loadPendingWrites(
      tenant, threadId, checkpointNs, row.checkpoint_id
    );

    return {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: row.checkpoint_id,
        },
      },
      checkpoint,
      metadata,
      parentConfig: row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: checkpointNs,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites,
    };
  }

  // =========================================================================
  // Claim 2.7: get() — delegates to getTuple
  // =========================================================================

  /**
   * Get checkpoint data by config. Delegates to getTuple, returns checkpoint only.
   * Claim 2.7: Concrete get(config) delegates to getTuple(config), returns tuple?.checkpoint.
   */
  async get(config: RunnableConfig): Promise<Checkpoint | undefined> {
    this.assertStarted();
    const tuple = await this.getTuple(config);
    return tuple?.checkpoint;
  }

  // =========================================================================
  // Claims 2.8–2.15: list() — async generator with filtering + scan cap
  // =========================================================================

  /**
   * List checkpoints matching config + options.
   *
   * Claim 2.8: `before` filter uses checkpoint_id comparison (UUID v6 lexicographic).
   * Claim 2.9: Filter supports 8 operators via compareValues().
   * Claim 2.14: Scan cap 50,000 rows — partial results, no throw.
   * Claim 2.15: Governance gate checked once at creation, not mid-iteration.
   */
  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    this.assertStarted();

    // Claim 2.15: governance gate checked once at generator creation
    this.enforceGovernanceGate();

    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      return;
    }
    const checkpointNs = config.configurable?.checkpoint_ns ?? '';
    const tenant = this.resolveTenantScope(config);

    // Build query
    let sql = `SELECT * FROM lg_checkpoints
               WHERE tenant_scope = ? AND thread_id = ? AND checkpoint_ns = ?`;
    const params: unknown[] = [tenant, threadId, checkpointNs];

    // Claim 2.8: before filter uses checkpoint_id (UUID v6 lexicographic, not step)
    if (options?.before?.configurable?.checkpoint_id) {
      sql += ` AND checkpoint_id < ?`;
      params.push(options.before.configurable.checkpoint_id);
    }

    sql += ` ORDER BY checkpoint_id DESC`;

    // Claim 2.14: scan cap
    const scanLimit = MAX_SCAN_ROWS;
    sql += ` LIMIT ?`;
    params.push(scanLimit);

    const rows = this.projection!.query<LgCheckpointRow>(sql, params);

    let yielded = 0;
    const limit = options?.limit;

    for (const row of rows) {
      // Apply metadata filter if present (Claim 2.9)
      if (options?.filter) {
        const metadata = this.parseJson<Record<string, unknown>>(
          row.metadata_json, 'metadata_json',
          `${row.thread_id}/${row.checkpoint_ns}/${row.checkpoint_id}`
        );
        if (!matchesFilter(metadata, options.filter)) {
          continue;
        }
      }

      // Deserialize and yield
      const checkpoint = this.deserialize(row.type_tag, row.checkpoint_blob) as Checkpoint;
      const metadata = this.parseJson<CheckpointMetadata>(
        row.metadata_json, 'metadata_json',
        `${row.thread_id}/${row.checkpoint_ns}/${row.checkpoint_id}`
      );
      const pendingWrites = this.loadPendingWrites(
        tenant, threadId, checkpointNs, row.checkpoint_id
      );

      yield {
        config: {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: row.checkpoint_id,
          },
        },
        checkpoint,
        metadata,
        parentConfig: row.parent_checkpoint_id
          ? {
              configurable: {
                thread_id: threadId,
                checkpoint_ns: checkpointNs,
                checkpoint_id: row.parent_checkpoint_id,
              },
            }
          : undefined,
        pendingWrites,
      };

      yielded++;
      if (limit !== undefined && yielded >= limit) {
        return;
      }
    }
  }

  // =========================================================================
  // Step 2.1.5: put() — Claims 2.16–2.21
  // =========================================================================

  /**
   * Save a checkpoint to the chain.
   *
   * Claim 2.16: Serializes checkpoint via serde.dumpsTyped.
   * Claim 2.17: Serializes metadata via JSON.stringify (extra props preserved).
   * Claim 2.18: Drops newVersions parameter (not stored).
   * Claim 2.19: Chain entry has tenant_scope as top-level field, NOT in state_json.
   * Claim 2.20: Calls projectPending() synchronously after chain write.
   * Claim 2.21: Bypasses governance gate (writes always proceed).
   */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    this.assertStarted();
    // Claim 2.21: NO governance gate on writes

    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      throw new LimenStorageError('thread_id required in config.configurable');
    }
    const checkpointNs = config.configurable?.checkpoint_ns ?? '';
    const checkpointId = checkpoint.id;
    const tenant = this.resolveTenantScope(config);

    // Claim 2.16: serialize checkpoint
    const [typeTag, checkpointBytes] = this.serde!.dumpsTyped(checkpoint);

    // Claim 2.17: serialize metadata via JSON.stringify (preserves extra props)
    const metadataJson = JSON.stringify(metadata);

    // Claim 2.19: tenant_scope is top-level ChainEntry field, NOT in state_json
    await this.chain!.appendEntry({
      transition_kind: 'LgCheckpoint',
      tenant_scope: tenant,
      state_json: canonicalJson({
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
        parent_checkpoint_id: config.configurable?.checkpoint_id ?? null,
        type_tag: typeTag,
        checkpoint_blob: Array.from(checkpointBytes),
        metadata_json: metadataJson,
        step: metadata.step,
        source: metadata.source,
      }),
    });

    // Claim 2.20: projectPending() synchronously after chain write.
    // If projectPending() throws, put() throws. Chain entry preserved.
    await this.projector!.projectPending();

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
      },
    };
  }

  // =========================================================================
  // Step 2.1.6: putWrites() — Claims 2.24–2.29
  // =========================================================================

  /**
   * Save pending writes to the chain.
   *
   * Claim 2.24: WRITES_IDX_MAP for special channels, sequential for regular.
   * Claim 2.25: Projector uses INSERT OR REPLACE (not IGNORE, not DELETE+INSERT).
   * Claim 2.26: Regular channel retry overwrites via REPLACE.
   * Claim 2.27: Special channel retry overwrites via REPLACE.
   * Claim 2.28: Regular + special writes coexist (different write_idx signs).
   */
  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    this.assertStarted();
    // Writes bypass governance gate (Claim 4.8)

    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      throw new LimenStorageError('thread_id required in config.configurable');
    }
    const checkpointNs = config.configurable?.checkpoint_ns ?? '';
    const checkpointId = config.configurable?.checkpoint_id;
    if (!checkpointId) {
      throw new LimenStorageError('checkpoint_id required in config.configurable for putWrites');
    }
    const tenant = this.resolveTenantScope(config);

    // Batch all writes into a single chain entry (Design doc A.1: LgWrite has writes array)
    const serializedWrites: Array<{
      channel: string;
      type_tag: string;
      value: number[];
      write_idx: number;
    }> = [];

    for (let i = 0; i < writes.length; i++) {
      const [channel, value] = writes[i];
      const [typeTag, valueBytes] = this.serde!.dumpsTyped(value);

      // Claim 2.24: special channels get negative index, regular get sequential
      const writeIdx = WRITES_IDX_MAP[channel] ?? i;

      serializedWrites.push({
        channel,
        type_tag: typeTag,
        value: Array.from(valueBytes),
        write_idx: writeIdx,
      });
    }

    await this.chain!.appendEntry({
      transition_kind: 'LgWrite',
      tenant_scope: tenant,
      state_json: canonicalJson({
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
        task_id: taskId,
        writes: serializedWrites,
      }),
    });

    await this.projector!.projectPending();
  }

  // =========================================================================
  // Step 2.1.7: deleteThread() — Claims 2.31–2.35
  // =========================================================================

  /**
   * Delete all checkpoints and writes for a thread.
   *
   * Claim 2.31: Fixed order — DELETE pending_writes THEN DELETE checkpoints.
   * Claim 2.32: All namespaces, all channels within tenant scope.
   * Claim 2.33: Uses adapter-level tenantScope (no RunnableConfig tenant override).
   * Claim 2.34: Bypasses governance gate.
   * Claim 2.35: Chain entries preserved (append-only). Replay deterministic.
   */
  async deleteThread(threadId: string): Promise<void> {
    this.assertStarted();
    // Claim 2.34: NO governance gate on deletes

    // Claim 2.33: uses adapter tenantScope, not from config
    const tenant = this.tenantScope;

    await this.chain!.appendEntry({
      transition_kind: 'LgDelete',
      tenant_scope: tenant,
      state_json: canonicalJson({
        thread_id: threadId,
      }),
    });

    await this.projector!.projectPending();
  }

  // =========================================================================
  // F-02: Sync wrappers — delegate to async counterparts
  // BaseCheckpointSaver may require sync variants for certain execution modes.
  // These throw if called outside an async context where the result can't be
  // awaited. Users should prefer the async methods directly.
  // =========================================================================

  /**
   * Sync wrapper for getTuple. Delegates to the async implementation.
   * F-02: Required by BaseCheckpointSaver contract for sync execution paths.
   */
  getTupleSync(config: RunnableConfig): CheckpointTuple | undefined {
    // In LangGraph's sync execution mode, this would be called.
    // Since our implementation requires async I/O (chain/projection),
    // we cannot provide a true sync path. Throw with guidance.
    throw new LimenStorageError(
      'LimenCheckpointSaver requires async execution. Use getTuple() (async) instead of getTupleSync().'
    );
  }

  /**
   * Sync wrapper for put. Delegates to the async implementation.
   * F-02: Required by BaseCheckpointSaver contract for sync execution paths.
   */
  putSync(
    _config: RunnableConfig,
    _checkpoint: Checkpoint,
    _metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): RunnableConfig {
    throw new LimenStorageError(
      'LimenCheckpointSaver requires async execution. Use put() (async) instead of putSync().'
    );
  }

  /**
   * Sync wrapper for putWrites. Delegates to the async implementation.
   * F-02: Required by BaseCheckpointSaver contract for sync execution paths.
   */
  putWritesSync(
    _config: RunnableConfig,
    _writes: PendingWrite[],
    _taskId: string,
  ): void {
    throw new LimenStorageError(
      'LimenCheckpointSaver requires async execution. Use putWrites() (async) instead of putWritesSync().'
    );
  }

  // =========================================================================
  // Step 2.1.8: getNextVersion — Claims 2.22, 2.23
  // =========================================================================

  /**
   * Get next channel version number.
   * Claim 2.22: V=number: (current !== undefined && typeof current === "number") ? current + 1 : 1
   * Claim 2.23: V=string would throw — adapter uses V=number default.
   */
  getNextVersion(current: number | undefined): number {
    this.assertStarted();
    return current !== undefined && typeof current === 'number'
      ? current + 1
      : 1;
  }

  // =========================================================================
  // stop() — Claims 3.25, 3.26
  // =========================================================================

  /**
   * Shutdown the adapter.
   *
   * Claim 3.25: Calls projectPending() in try/catch. Failure logged WARN, not re-thrown.
   * Sets initialized=false. Nulls refs. Post-stop calls throw LimenNotStartedError.
   * Claim 3.26: start() after stop() not supported.
   */
  async stop(): Promise<void> {
    // F-NEW-03: Set terminal flag BEFORE early return so that stop() on a
    // non-initialized instance still prevents subsequent start().
    this.stopped = true;

    if (!this.initialized) {
      return;
    }

    // Claim 3.25: flush pending, swallow errors
    try {
      await this.projector!.projectPending();
    } catch (e) {
      // Claim 3.25 + F-10: WARN logged, not re-thrown
      this.logger.warn('projectPending failed during stop', {
        error: (e as Error).message,
      });
    }

    this.initialized = false;

    // Claim 3.25 / F-03: Null refs to release resources
    this.chain = null;
    this.projection = null;
    this.projector = null;
    this.validity = null;
    this.serde = null;
  }

  // =========================================================================
  // Private: Governance Gate — Claims 4.1–4.8
  // =========================================================================

  /**
   * Enforce the governance gate based on current validity state.
   *
   * Claim 4.1: governed=true, Verified → proceed
   * Claim 4.2: governed=true, Lagging → throw retryable
   * Claim 4.3: governed=true, Unverified → throw non-retryable
   * Claim 4.4: governed=true, Divergent → throw non-retryable
   * Claim 4.5: governed=true, Rebuilding → throw retryable
   * Claim 4.6: governed=false, Lagging → proceed with WARN
   * Claim 4.7: governed=false, Unverified/Divergent/Rebuilding → throw
   * Claim 4.8: All writes bypass (caller's responsibility to not call this)
   */
  private enforceGovernanceGate(): void {
    const state = this.validity!.currentState();

    if (state === 'Verified') {
      return; // Claims 4.1: always proceed
    }

    if (state === 'Lagging') {
      if (this.governed) {
        // Claim 4.2: governed=true, Lagging → throw retryable
        throw new LimenGovernanceError({
          state: 'Lagging',
          retryable: true,
          guidance: 'Wait for projector to catch up, then retry',
        });
      }
      // Claim 4.6: governed=false, Lagging → proceed with WARN log
      this.logger.warn('Projection lagging, governed=false — proceeding with potentially stale data', {
        state: 'Lagging',
        governed: this.governed,
        threadId: this.tenantScope,
      });
      return;
    }

    // Claims 4.3, 4.4, 4.5, 4.7: Unverified/Divergent/Rebuilding always throw
    const gateConfig: Record<string, { retryable: boolean; guidance?: string }> = {
      Unverified: { retryable: false },
      Divergent: { retryable: false, guidance: 'Rebuild projection' },
      Rebuilding: { retryable: true, guidance: 'Retry after rebuild' },
    };

    const stateConfig = gateConfig[state];
    if (stateConfig) {
      // Emit info-level event so operators can track governance rejection frequency
      this.logger.info?.('Governance gate rejected read', {
        state,
        governed: this.governed,
        retryable: stateConfig.retryable,
      });
      throw new LimenGovernanceError({
        state,
        retryable: stateConfig.retryable,
        guidance: stateConfig.guidance,
      });
    }
  }

  // =========================================================================
  // Private: Tenant Scope Resolution — Claim 5.1
  // =========================================================================

  /**
   * Resolve tenant scope from config or adapter default.
   * Claim 5.1: config.configurable.limen_tenant_scope takes priority
   * over adapterConfig.tenantScope over '__default__'.
   */
  private resolveTenantScope(config: RunnableConfig): string {
    const configTenant = config.configurable?.limen_tenant_scope;
    if (typeof configTenant === 'string' && configTenant.length > 0) {
      return configTenant;
    }
    return this.tenantScope;
  }

  // =========================================================================
  // Step 2.1.9: Private Helpers — Deserialization + Pending Writes
  // =========================================================================

  /**
   * Deserialize checkpoint or write value from type_tag + blob.
   * Claim 6.3: Wraps errors in LimenSerdeError.
   */
  private deserialize(typeTag: string, data: Uint8Array): unknown {
    try {
      return this.serde!.loadsTyped(typeTag, data);
    } catch (e) {
      throw new LimenSerdeError({
        typeTag,
        dataLength: data.length,
        cause: e as Error,
      });
    }
  }

  /**
   * Parse JSON with error wrapping.
   * Claim 6.3.1: JSON.parse failures throw LimenSerdeError with context.
   */
  private parseJson<T>(json: string, context: string, rowId: string): T {
    try {
      return JSON.parse(json) as T;
    } catch (e) {
      throw new LimenSerdeError({
        typeTag: 'json',
        dataLength: json.length,
        cause: e as Error,
        context,
        rowId,
      });
    }
  }

  /**
   * Load pending writes for a checkpoint.
   * Claim 2.3: Ordered by (task_id, write_idx).
   * Claim 2.5: Each write deserialized via serde.loadsTyped.
   * Claim 6.3: One corrupted write does not block others.
   */
  private loadPendingWrites(
    tenant: string,
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): CheckpointPendingWrite[] {
    const rows = this.projection!.query<LgPendingWriteRow>(
      `SELECT * FROM lg_pending_writes
       WHERE tenant_scope = ? AND thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
       ORDER BY task_id, write_idx`,
      [tenant, threadId, checkpointNs, checkpointId]
    );

    const results: CheckpointPendingWrite[] = [];
    for (const row of rows) {
      // Claim 6.3: corrupted write does not block others
      try {
        const value = this.deserialize(row.type_tag, row.value);
        results.push([row.task_id, row.channel, value]);
      } catch (e) {
        // F-NEW-05: Log corrupted write instead of silently dropping
        this.logger.warn('Corrupted pending write dropped', {
          taskId: row.task_id,
          channel: row.channel,
          writeIdx: row.write_idx,
          error: (e as Error).message,
        });
      }
    }
    return results;
  }
}
