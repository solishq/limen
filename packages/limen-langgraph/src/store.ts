/**
 * @limen-ai/langgraph — LimenStore
 *
 * Governed key-value store bridging LangGraph's BaseStore interface
 * to Limen's append-only chain + projection architecture.
 *
 * Write path:  validate → chain entry → projectPending() → projection table
 * Read path:   governance gate → query projection → deserialize → LangGraph
 *
 * Design doc: Claims 3.1–3.27, 4.1–4.10, 5.1–5.4, 6.2, 8.1–8.18
 */

import { BaseStore } from '@langchain/langgraph-checkpoint';

import type {
  LimenCheckpointerConfig,
  ChainStorage,
  ProjectionStorage,
  Projector,
  ValidityStateMachine,
  SerializerProtocol,
  Item,
  SearchItem,
  GetOperation,
  PutOperation,
  SearchOperation,
  ListNamespacesOperation,
  MatchCondition,
  Operation,
  OperationResults,
  LgStoreItemRow,
} from './types.js';

import {
  LimenGovernanceError,
  LimenStorageError,
  LimenSerdeError,
  LimenNotStartedError,
} from './errors.js';

import {
  DEFAULT_TENANT_SCOPE,
  MAX_SCAN_ROWS,
  ADAPTER_SCHEMA_VERSION,
} from './types.js';

import {
  canonicalJson,
  matchesFilter,
  matchesConditions,
  validateNamespace,
  dotJoin,
  splitNamespace,
  isGetOp,
  isPutOp,
  isSearchOp,
  isListNsOp,
} from './shared.js';

// ---------------------------------------------------------------------------
// LimenStore
// ---------------------------------------------------------------------------

/**
 * Governed key-value store for LangGraph graphs.
 *
 * Cross-thread storage using namespace + key addressing.
 * Writes append to Limen's immutable chain, then project to SQLite.
 * Reads query projected tables through a governance gate.
 *
 * Design doc §0.5: extends BaseStore.
 * Implements: batch.
 * Inherits: get, search, put, delete, listNamespaces, start, stop.
 */
export class LimenStore extends BaseStore {
  private chain: ChainStorage;
  private projection: ProjectionStorage;
  private projector: Projector;
  private validity: ValidityStateMachine;
  private governed: boolean;
  private tenantScope: string;
  private initialized = false;
  private stopped = false;

  constructor(config: LimenCheckpointerConfig) {
    super();
    this.chain = config.chain;
    this.projection = config.projection;
    this.projector = config.projector;
    this.validity = config.validity;
    this.governed = config.governed ?? false;
    this.tenantScope = config.tenantScope ?? DEFAULT_TENANT_SCOPE;
  }

  // =========================================================================
  // assertStarted() — Claim 3.27
  // =========================================================================

  private assertStarted(): void {
    if (!this.initialized) {
      throw new LimenNotStartedError('Call start() before use');
    }
  }

  // =========================================================================
  // start() — Claims 3.23, 3.24, 3.26
  // =========================================================================

  /**
   * Initialize the store. Must be called before any operation.
   *
   * Claim 3.23: Verifies chain, projection, projector, schema, validity.
   * Claim 3.24: Idempotent.
   * Claim 3.26: start() after stop() throws.
   */
  async start(): Promise<void> {
    if (this.stopped) {
      throw new LimenStorageError('Cannot restart after stop(). Create a new adapter instance.');
    }

    if (this.initialized) {
      return;
    }

    // Verify chain accessible
    if (!this.chain || typeof this.chain.appendEntry !== 'function') {
      throw new LimenStorageError('Chain inaccessible: appendEntry not a function');
    }

    // Verify projection accessible
    if (!this.projection || typeof this.projection.query !== 'function') {
      throw new LimenStorageError('Projection inaccessible: query not a function');
    }

    // Verify projector initialized
    if (!this.projector || typeof this.projector.projectPending !== 'function') {
      throw new LimenStorageError('Projector not initialized');
    }

    // Schema version check
    const versionStr = this.projection.getMetadata('lg_schema_version');
    const version = versionStr ? parseInt(versionStr, 10) : 0;

    if (version > ADAPTER_SCHEMA_VERSION) {
      throw new LimenStorageError(
        `Schema version ${version} > adapter version ${ADAPTER_SCHEMA_VERSION}. Upgrade the adapter.`
      );
    }

    // Schema migration handled by LimenCheckpointSaver.start() — store
    // expects tables to already exist (shared projection database).
    // If schema < 2, throw to force checkpoint saver initialization first.
    if (version < ADAPTER_SCHEMA_VERSION) {
      throw new LimenStorageError(
        `Schema version ${version} < ${ADAPTER_SCHEMA_VERSION}. Initialize LimenCheckpointSaver first to migrate schema.`
      );
    }

    // Verify validity state machine
    try {
      await this.validity.verifyOnStartup();
    } catch (e) {
      throw new LimenStorageError(`Validity verification failed: ${(e as Error).message}`);
    }

    this.initialized = true;
  }

  // =========================================================================
  // stop() — Claim 3.25
  // =========================================================================

  /**
   * Shutdown the store.
   *
   * Claim 3.25: Flushes projectPending() in try/catch. Swallows errors.
   * Sets initialized=false. Post-stop calls throw LimenNotStartedError.
   */
  async stop(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    try {
      await this.projector.projectPending();
    } catch (e) {
      // Claim 3.25: WARN logged, not re-thrown
      console.warn('[LimenStore] projectPending failed during stop:', e);
    }

    this.initialized = false;
    this.stopped = true;
  }

  // =========================================================================
  // batch() — Claims 3.1–3.6
  // =========================================================================

  /**
   * Execute a batch of operations in 3 phases.
   *
   * Claim 3.1: Phase 1 (Gets) → Phase 2 (Searches + ListNamespaces) → Phase 3 (Puts + projectPending).
   * Claim 3.2: Phase 1+2 reads resolve against pre-batch projection state.
   * Claim 3.3: NOT atomic — partial Phase 3 failure leaves partial chain entries.
   * Claim 3.4: GetOp returns deserialized copy (not reference to internal state).
   * Claim 3.5: PutOp returns undefined (not null).
   * Claim 3.6: Multiple PutOps same key → last-wins via INSERT OR REPLACE.
   */
  async batch<Ops extends Operation[]>(operations: Ops): Promise<OperationResults<Ops>> {
    this.assertStarted();

    const results: unknown[] = new Array(operations.length);

    // Phase 1: Resolve all Gets (Claim 3.1, 3.2 — pre-batch state)
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (isGetOp(op)) {
        this.enforceGovernanceGate();
        results[i] = this.executeGet(op);
      }
    }

    // Phase 2: Resolve all Searches + ListNamespaces (Claim 3.1, 3.2 — pre-batch state)
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (isSearchOp(op)) {
        this.enforceGovernanceGate();
        results[i] = this.executeSearch(op);
      } else if (isListNsOp(op)) {
        this.enforceGovernanceGate();
        results[i] = this.executeListNamespaces(op);
      }
    }

    // Phase 3: Apply all Puts + single projectPending() (Claim 3.1, 3.3)
    let hasWrites = false;
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (isPutOp(op)) {
        // Claim 4.8: writes bypass governance gate
        await this.executePut(op);
        results[i] = undefined; // Claim 3.5: PutOp returns undefined
        hasWrites = true;
      }
    }

    if (hasWrites) {
      await this.projector.projectPending();
    }

    return results as OperationResults<Ops>;
  }

  // =========================================================================
  // Convenience Methods — delegate to batch() (Claim 3.19, 3.27)
  // =========================================================================

  /**
   * Get a single item by namespace + key.
   * Claim 3.27: assertStarted() enforced via batch().
   */
  async get(namespace: string[], key: string): Promise<Item | null> {
    const [result] = await this.batch([{ namespace, key } as GetOperation]);
    return result as Item | null;
  }

  /**
   * Put a value into the store.
   * Claim 3.20: INSERT OR REPLACE — preserves created_at on update.
   * Claim 3.22: index stored in index_fields, not used for search.
   */
  async put(
    namespace: string[],
    key: string,
    value: Record<string, unknown>,
    index?: false | string[],
  ): Promise<void> {
    await this.batch([{
      namespace,
      key,
      value,
      index: index === false ? undefined : index,
    } as PutOperation]);
  }

  /**
   * Delete an item from the store.
   * Claim 3.19: Builds PutOperation with value=null, delegates to batch.
   * Claim 3.21: Idempotent — deleting non-existent key is a no-op.
   */
  async delete(namespace: string[], key: string): Promise<void> {
    await this.batch([{ namespace, key, value: null } as PutOperation]);
  }

  /**
   * Search items by namespace prefix + filter.
   * Claim 3.13: query parameter throws Error("Semantic search not supported").
   */
  async search(
    namespacePrefix: string[],
    options?: {
      filter?: Record<string, unknown>;
      limit?: number;
      offset?: number;
      query?: string;
    },
  ): Promise<SearchItem[]> {
    const [result] = await this.batch([{
      namespacePrefix,
      filter: options?.filter,
      limit: options?.limit,
      offset: options?.offset,
      query: options?.query,
    } as SearchOperation]);
    return result as SearchItem[];
  }

  /**
   * List unique namespaces with optional filtering.
   * Claim 3.15: Defaults limit=100, offset=0.
   * Claim 3.17: MatchCondition prefix/suffix/wildcard evaluation.
   * Claim 3.18: maxDepth truncates + deduplicates.
   */
  async listNamespaces(options?: {
    prefix?: string[];
    suffix?: string[];
    maxDepth?: number;
    limit?: number;
    offset?: number;
  }): Promise<string[][]> {
    const matchConditions: MatchCondition[] = [];
    if (options?.prefix) {
      matchConditions.push({ matchType: 'prefix', path: options.prefix });
    }
    if (options?.suffix) {
      matchConditions.push({ matchType: 'suffix', path: options.suffix });
    }

    const [result] = await this.batch([{
      matchConditions: matchConditions.length > 0 ? matchConditions : undefined,
      maxDepth: options?.maxDepth,
      limit: options?.limit,
      offset: options?.offset,
    } as ListNamespacesOperation]);
    return result as string[][];
  }

  // =========================================================================
  // Private: executeGet — Claim 3.4
  // =========================================================================

  /**
   * Execute a single Get operation.
   * Claim 3.4: Returns deserialized copy (not reference to internal state).
   */
  private executeGet(op: GetOperation): Item | null {
    validateNamespace(op.namespace);

    const row = this.projection.queryOne<LgStoreItemRow>(
      `SELECT * FROM lg_store_items
       WHERE tenant_scope = ? AND namespace = ? AND key = ?`,
      [this.tenantScope, dotJoin(op.namespace), op.key]
    );

    if (!row) return null;

    // Claim 3.4: deserialized copy
    const value = this.parseJson(row.value_json, 'value_json', `${row.namespace}/${row.key}`);

    return {
      key: row.key,
      namespace: splitNamespace(row.namespace),
      value,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  // =========================================================================
  // Private: executeSearch — Claims 3.8–3.14
  // =========================================================================

  /**
   * Execute a single Search operation.
   *
   * Claim 3.8: Sargable range query — namespace >= prefix AND namespace < prefix + '/'.
   * Claim 3.9: Empty prefix → matches all in tenant.
   * Claim 3.10: Filter uses same compareValues() as checkpoint list.
   * Claim 3.11: Limit defaults to 10, offset to 0.
   * Claim 3.12: SearchItem.score always undefined.
   * Claim 3.13: query parameter throws.
   * Claim 3.14: Scan cap 50,000.
   */
  private executeSearch(op: SearchOperation): SearchItem[] {
    // Claim 3.13: query param throws
    if (op.query !== undefined) {
      throw new Error('Semantic search not supported');
    }

    if (op.namespacePrefix.length > 0) {
      validateNamespace(op.namespacePrefix);
    }

    const prefix = op.namespacePrefix.length > 0 ? dotJoin(op.namespacePrefix) : '';
    const limit = op.limit ?? 10; // Claim 3.11
    const offset = op.offset ?? 0; // Claim 3.11
    const scanLimit = MAX_SCAN_ROWS; // Claim 3.14

    let sql: string;
    let params: unknown[];

    if (prefix) {
      // Claim 3.8: sargable range — ASCII 46('.') / 47('/') adjacency (Claim 8.9)
      sql = `SELECT * FROM lg_store_items
             WHERE tenant_scope = ? AND namespace >= ? AND namespace < ?
             ORDER BY updated_at DESC LIMIT ?`;
      params = [this.tenantScope, prefix, prefix + '/', scanLimit];
    } else {
      // Claim 3.9: empty prefix → all items in tenant
      sql = `SELECT * FROM lg_store_items
             WHERE tenant_scope = ?
             ORDER BY updated_at DESC LIMIT ?`;
      params = [this.tenantScope, scanLimit];
    }

    const rows = this.projection.query<LgStoreItemRow>(sql, params);

    if (rows.length === scanLimit) {
      console.warn('[LimenStore] scan cap (50000) reached — results may be incomplete');
    }

    const results: SearchItem[] = [];
    let skipped = 0;

    for (const row of rows) {
      // Parse once, reuse for filter check and result construction (F-01)
      const value = this.parseJson(row.value_json, 'value_json', `${row.namespace}/${row.key}`);

      // Apply filter (Claim 3.10)
      if (op.filter) {
        if (!matchesFilter(value, op.filter)) {
          continue;
        }
      }

      // Apply offset
      if (skipped < offset) {
        skipped++;
        continue;
      }

      results.push({
        key: row.key,
        namespace: splitNamespace(row.namespace),
        value,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        score: undefined, // Claim 3.12
      });

      if (results.length >= limit) {
        break;
      }
    }

    return results;
  }

  // =========================================================================
  // Private: executeListNamespaces — Claims 3.15–3.18
  // =========================================================================

  /**
   * Execute a single ListNamespaces operation.
   *
   * Claim 3.15: Defaults limit=100, offset=0.
   * Claim 3.16: Scan cap 50,000 on DISTINCT query.
   * Claim 3.17: MatchCondition prefix/suffix/wildcard evaluation.
   * Claim 3.18: maxDepth truncates + deduplicates.
   */
  private executeListNamespaces(op: ListNamespacesOperation): string[][] {
    const limit = op.limit ?? 100; // Claim 3.15
    const offset = op.offset ?? 0; // Claim 3.15
    const scanLimit = MAX_SCAN_ROWS; // Claim 3.16

    const rows = this.projection.query<{ namespace: string }>(
      `SELECT DISTINCT namespace FROM lg_store_items
       WHERE tenant_scope = ?
       ORDER BY namespace
       LIMIT ?`,
      [this.tenantScope, scanLimit]
    );

    if (rows.length === scanLimit) {
      console.warn('[LimenStore] scan cap (50000) reached — results may be incomplete');
    }

    let namespaces = rows.map(r => splitNamespace(r.namespace));

    // Claim 3.17: apply match conditions
    if (op.matchConditions && op.matchConditions.length > 0) {
      namespaces = namespaces.filter(ns => matchesConditions(ns, op.matchConditions!));
    }

    // Claim 3.18: maxDepth truncates + deduplicates
    if (op.maxDepth !== undefined && op.maxDepth > 0) {
      namespaces = namespaces.map(ns => ns.slice(0, op.maxDepth));
      // Deduplicate
      const seen = new Set<string>();
      namespaces = namespaces.filter(ns => {
        const key = ns.join('.');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Apply offset + limit
    return namespaces.slice(offset, offset + limit);
  }

  // =========================================================================
  // Private: executePut — Claims 3.19–3.22
  // =========================================================================

  /**
   * Execute a single Put operation (writes to chain, does NOT project).
   *
   * Claim 3.19: value=null → LgStoreDelete chain entry.
   * Claim 3.20: value non-null → LgStorePut chain entry (INSERT OR REPLACE by projector).
   * Claim 3.21: Delete is idempotent.
   * Claim 3.22: index stored in index_fields, not used for search.
   */
  private async executePut(op: PutOperation): Promise<void> {
    validateNamespace(op.namespace);
    const namespace = dotJoin(op.namespace);

    if (op.value === null) {
      // Claim 3.19, 3.21: Delete — transition_kind LgStoreDelete
      await this.chain.appendEntry({
        transition_kind: 'LgStoreDelete',
        tenant_scope: this.tenantScope,
        state_json: canonicalJson({
          namespace,
          key: op.key,
        }),
      });
    } else {
      // Claim 3.20, 3.22: Upsert — transition_kind LgStorePut
      await this.chain.appendEntry({
        transition_kind: 'LgStorePut',
        tenant_scope: this.tenantScope,
        state_json: canonicalJson({
          namespace,
          key: op.key,
          value_json: JSON.stringify(op.value),
          index_fields: op.index || null, // Claim 3.22: stored, not used
        }),
      });
    }
  }

  // =========================================================================
  // Private: Governance Gate — Claims 4.1–4.8
  // =========================================================================

  private enforceGovernanceGate(): void {
    const state = this.validity.currentState();

    if (state === 'Verified') {
      return;
    }

    if (state === 'Lagging') {
      if (this.governed) {
        throw new LimenGovernanceError({
          state: 'Lagging',
          retryable: true,
          guidance: 'Wait for projector to catch up, then retry',
        });
      }
      console.warn('[LimenStore] governance state Lagging — reads may be stale');
      return;
    }

    const stateMap: Record<string, { retryable: boolean; guidance?: string }> = {
      Unverified: { retryable: false },
      Divergent: { retryable: false, guidance: 'Rebuild projection' },
      Rebuilding: { retryable: true, guidance: 'Retry after rebuild' },
    };

    const cfg = stateMap[state];
    if (cfg) {
      throw new LimenGovernanceError({
        state,
        retryable: cfg.retryable,
        guidance: cfg.guidance,
      });
    }
  }

  // =========================================================================
  // Private: JSON parsing with error wrapping — Claim 6.3.1
  // =========================================================================

  private parseJson(json: string, context: string, rowId: string): Record<string, unknown> {
    try {
      return JSON.parse(json) as Record<string, unknown>;
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
}
