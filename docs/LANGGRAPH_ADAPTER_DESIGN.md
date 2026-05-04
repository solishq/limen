# LangGraph Adapter Design Document

**Project:** Limen × LangGraph Integration (`@limen-ai/langgraph`)
**Revision:** 8 — Ultra-Precise (Testable Claims)
**Date:** 2026-05-04
**Target:** `@langchain/langgraph-checkpoint` v1.0.1
**Governing Spec:** Limen v5 Projection Layer (v1.4 Section 7–8)
**Findings History:** R1-R6 (112 findings addressed)
**Format:** Every claim is atomic and testable. No prose. Claims map to test names.

---

## 0. Context

Limen is a governance substrate for AI agent state. Its storage architecture splits into two layers: an append-only **chain** (the immutable source of truth for all state transitions) and **projections** (derived, read-optimized SQLite tables rebuilt deterministically from chain entries). A **projector** component derives projection rows from pending chain entries via `projectPending()`. This separation guarantees that the chain is never mutated after write, and any projection can be rebuilt from the chain at any time.

LangGraph is a graph execution framework for building stateful AI agents. It defines two persistence interfaces — `BaseCheckpointSaver` (checkpoint/restore graph state per thread) and `BaseStore` (cross-thread key-value storage). LangGraph's built-in implementations (`MemorySaver`, `SqliteSaver`) provide no governance: no audit trail, no tamper detection, no cryptographic integrity verification, no multi-tenant isolation enforced at the storage layer.

This adapter bridges LangGraph's checkpoint and store interfaces to Limen's governed chain. Writes serialize LangGraph state into chain entries (append-only, immutable, sequenced). The projector derives read-optimized projection tables (`lg_checkpoints`, `lg_pending_writes`, `lg_store_items`) from those chain entries. Reads query the projection tables through a governance gate that enforces validity state (Verified, Lagging, Unverified, Divergent, Rebuilding). The result: LangGraph graphs gain tamper-evident, auditable, cryptographically verifiable state management without any changes to graph code.

---

## 0.1 Glossary

| Term | Definition |
|---|---|
| **chain** | Append-only immutable log of state transitions. Source of truth. Entries are sequenced and never modified after write. |
| **chain entry** | A single record in the chain. Contains `transition_kind`, `state_json` (payload, JSON-encoded), `canonical_at` (authoritative timestamp), `global_sequence`, and `tenant_scope`. |
| **projection** | Derived read-optimized SQLite tables. Rebuilt deterministically from chain entries. Not authoritative — the chain is. |
| **projection table** | A specific SQLite table in the projection database (e.g., `lg_checkpoints`, `lg_pending_writes`, `lg_store_items`). |
| **projector** | Engine that derives projection rows from chain entries. Invoked via `projectPending()`. |
| **projectPending()** | Projector method that processes unprocessed chain entries and updates projection tables. Tracks progress via `last_projected_sequence`. |
| **canonical_at** | Authoritative timestamp from the chain entry. Used as `created_at`/`updated_at` in projection tables. |
| **global_sequence** | Monotonically increasing integer assigned to each chain entry. Used for ordering and progress tracking. |
| **tenant_scope** | Namespace string for multi-tenant isolation. Part of every primary key. Default: `'__default__'`. |
| **governed** | Adapter config flag controlling whether reads require cryptographic verification (Verified-only) or accept slight staleness (Lagging-acceptable). |
| **validity state machine** | Tracks projection integrity state: **Verified** (digest matches), **Lagging** (chain ahead of projection), **Unverified** (not yet checked), **Divergent** (digest mismatch / tamper detected), **Rebuilding** (projection rebuild in progress). |
| **NonAuthoritative\<T\>** | Wrapper type indicating data is from a projection (derived), not directly from the chain. Stripped via `into_inner()` before returning to LangGraph. |
| **state_json** | Chain entry payload field. JSON-encoded. Contains the serialized LangGraph state. |
| **transition_kind** | Discriminator for chain entry type: `LgCheckpoint`, `LgWrite`, `LgDelete`, `LgStorePut`, `LgStoreDelete`. |
| **digest** | Cryptographic hash of projection table state. Used for tamper detection by comparing against chain-derived expected state. |
| **tamper_marker** | Flag in `projection_metadata` set by SQLite triggers when projection tables are modified outside the projector (direct INSERT/UPDATE/DELETE). |
| **verify_on_startup()** | Function called during `start()` that checks projection integrity by comparing digests and detecting tamper markers. Transitions validity state accordingly. |

---

## 0.2 Architecture

```
LangGraph Graph
  |  put() / putWrites() / deleteThread()
  v
LimenCheckpointSaver / LimenStore (this adapter)
  |  serialize -> chain entry
  v
Chain (append-only, immutable)
  |  projectPending()
  v
Projector
  |  derive rows
  v
Projection Tables (SQLite)
  |  lg_checkpoints, lg_pending_writes, lg_store_items
  v
LimenCheckpointSaver / LimenStore (read path)
  |  query_projection() -> governance gate -> deserialize
  v
LangGraph Graph
  |  getTuple() / list() / batch()
```

---

## 0.3 Getting Started

```typescript
import { LimenCheckpointSaver, LimenStore } from '@limen-ai/langgraph';
import { createChain, createProjection, createProjector } from '@limen/core';

// Initialize Limen storage
const chain = createChain('./data/chain.db');
const projection = createProjection('./data/projection.db');
const projector = createProjector(chain, projection);

// Create adapter instances
const checkpointer = new LimenCheckpointSaver({
  chain, projection, projector,
  validity: projector.validity,
  governed: false,            // Accept Lagging reads
  tenantScope: '__default__', // Single-tenant
});

const store = new LimenStore({
  chain, projection, projector,
  validity: projector.validity,
});

// Use with LangGraph
const graph = builder.compile({ checkpointer, store });
await graph.invoke({ input: "hello" }, { configurable: { thread_id: "t1" } });
```

---

## 0.4 Adapter Configuration

```typescript
interface LimenCheckpointerConfig {
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
  /** When true, reads require Verified state. When false, Lagging is acceptable. Default: false */
  governed?: boolean;
  /** Tenant scope for multi-tenant. Default: '__default__' */
  tenantScope?: string;
}
```

`LimenStore` uses the same config shape. Both classes are instantiated independently — a LangGraph graph receives both:
```typescript
const graph = builder.compile({ checkpointer: limenSaver, store: limenStore });
```

---

## 0.5 Class Structure

```typescript
class LimenCheckpointSaver extends BaseCheckpointSaver {
  // Implements: getTuple, list, put, putWrites, deleteThread
  // Inherits: get (delegates to getTuple), getNextVersion (integer-only)
}

class LimenStore extends BaseStore {
  // Implements: batch
  // Inherits: get, search, put, delete, listNamespaces, start, stop
}
```

These are TWO separate classes. `LimenCheckpointSaver` handles graph state checkpointing (per-thread, per-namespace). `LimenStore` handles cross-thread key-value storage (namespace + key). Both write to the same chain and project to the same projection database, but they manage different projection tables.

---

## 0.6 Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| `@langchain/langgraph-checkpoint` | v1.0.1 | Target interface (`BaseCheckpointSaver`, `BaseStore`) |
| `@limen/core` | (internal) | Chain, projection, projector, validity state machine |
| `better-sqlite3` | (latest) | SQLite driver for projection tables |

No additional npm dependencies. The adapter is a thin bridge — all governance logic lives in `@limen/core`.

---

## 1. Schema

**Claim 1.1:** `lg_checkpoints` has exactly these columns:

| Column | Type | Constraint |
|---|---|---|
| `tenant_scope` | `TEXT NOT NULL` | Part of PK |
| `thread_id` | `TEXT NOT NULL` | Part of PK |
| `checkpoint_ns` | `TEXT NOT NULL DEFAULT ''` | Part of PK |
| `checkpoint_id` | `TEXT NOT NULL` | Part of PK. UUID v6 (lexicographic time-order). |
| `parent_checkpoint_id` | `TEXT` | Nullable. References parent checkpoint. |
| `type_tag` | `TEXT NOT NULL` | From `serde.dumpsTyped()[0]`. Values: `"json"` or `"bytes"`. |
| `checkpoint_blob` | `BLOB NOT NULL` | From `serde.dumpsTyped()[1]`. |
| `metadata_json` | `TEXT NOT NULL` | JSON string. Queryable via `json_extract()`. |
| `step` | `INTEGER NOT NULL` | From `CheckpointMetadata.step`. |
| `source` | `TEXT NOT NULL` | CHECK constraint: `('input','loop','update','fork')`. |
| `created_at` | `INTEGER NOT NULL` | From chain entry `canonical_at`. |
| `global_sequence` | `INTEGER NOT NULL` | Chain sequence that produced this row. |

PK: `(tenant_scope, thread_id, checkpoint_ns, checkpoint_id)`. No additional indexes — PK scanned in reverse for `ORDER BY checkpoint_id DESC`.

**Test:** `test_lg_checkpoints_schema_exact_columns`

---

**Claim 1.2:** `lg_pending_writes` has exactly these columns:

| Column | Type | Constraint |
|---|---|---|
| `tenant_scope` | `TEXT NOT NULL` | Part of PK |
| `thread_id` | `TEXT NOT NULL` | Part of PK |
| `checkpoint_ns` | `TEXT NOT NULL DEFAULT ''` | Part of PK |
| `checkpoint_id` | `TEXT NOT NULL` | Part of PK |
| `task_id` | `TEXT NOT NULL` | Part of PK |
| `channel` | `TEXT NOT NULL` | Channel name (e.g., `"messages"`, `"__error__"`). |
| `type_tag` | `TEXT NOT NULL` | From `serde.dumpsTyped()[0]`. |
| `value` | `BLOB NOT NULL` | From `serde.dumpsTyped()[1]`. |
| `write_idx` | `INTEGER NOT NULL` | Part of PK. Negative for special channels (`WRITES_IDX_MAP`). |
| `global_sequence` | `INTEGER NOT NULL` | Chain sequence. |

PK: `(tenant_scope, thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx)`.
PK index covers all query patterns. No additional indexes.

**Test:** `test_lg_pending_writes_schema_exact_columns`

---

**Claim 1.3:** `lg_store_items` has exactly these columns:

| Column | Type | Constraint |
|---|---|---|
| `tenant_scope` | `TEXT NOT NULL` | Part of PK |
| `namespace` | `TEXT NOT NULL` | Dot-joined from `string[]`. Part of PK. |
| `key` | `TEXT NOT NULL` | Part of PK |
| `value_json` | `TEXT NOT NULL` | JSON string. Queryable for filter operators. |
| `index_fields` | `TEXT` | Nullable. JSON array of field names (future: vector index). |
| `created_at` | `INTEGER NOT NULL` | From chain entry `canonical_at`. |
| `updated_at` | `INTEGER NOT NULL` | From chain entry `canonical_at`. |
| `global_sequence` | `INTEGER NOT NULL` | Chain sequence. |

PK: `(tenant_scope, namespace, key)`.
PK index covers all query patterns. No additional indexes.

**Test:** `test_lg_store_items_schema_exact_columns`

---

**Claim 1.4:** Schema version is 2. Migration from 0/NULL/1 creates `lg_*` tables via `CREATE TABLE IF NOT EXISTS` in `start()`. Version > 2 throws `LimenStorageError`.

**Test:** `test_schema_migration_v1_to_v2`
**Test:** `test_schema_version_gt2_throws`

---

**Claim 1.5:** 9 tamper triggers exist (INSERT/UPDATE/DELETE × 3 `lg_*` tables). Each sets `projection_metadata.tamper_marker = 1`.

**Test:** `test_tamper_triggers_fire_on_all_mutations`

---

**Claim 1.6:** Digest includes `lg_*` tables after existing 4, version-gated. Schema v1 → 4-table digest. Schema v2 → 7-table digest.

**Test:** `test_digest_v1_excludes_lg_tables`
**Test:** `test_digest_v2_includes_lg_tables`

---

## 2. BaseCheckpointSaver

**Claim 2.1:** `getTuple(config)` with `checkpoint_id` in `config.configurable` executes:
```sql
SELECT * FROM lg_checkpoints
WHERE tenant_scope = ?1 AND thread_id = ?2 AND checkpoint_ns = ?3 AND checkpoint_id = ?4;
```

**Test:** `test_get_tuple_with_checkpoint_id_exact_sql`

---

**Claim 2.2:** `getTuple(config)` without `checkpoint_id` executes:
```sql
SELECT * FROM lg_checkpoints
WHERE tenant_scope = ?1 AND thread_id = ?2 AND checkpoint_ns = ?3
ORDER BY checkpoint_id DESC LIMIT 1;
```

**Test:** `test_get_tuple_without_checkpoint_id_latest_by_uuid6`

---

**Claim 2.3:** `getTuple` pending writes query:
```sql
SELECT * FROM lg_pending_writes
WHERE tenant_scope = ?1 AND thread_id = ?2 AND checkpoint_ns = ?3 AND checkpoint_id = ?4
ORDER BY task_id, write_idx;
```

**Test:** `test_get_tuple_pending_writes_ordered`

---

**Claim 2.4:** `getTuple` deserializes checkpoint via `serde.loadsTyped(row.type_tag, row.checkpoint_blob)` — requires both arguments.

**Test:** `test_get_tuple_deserialize_uses_type_tag`

---

**Claim 2.5:** `getTuple` deserializes each pending write via `serde.loadsTyped(pw.type_tag, pw.value)`.

**Test:** `test_get_tuple_deserialize_pending_writes_uses_type_tag`

---

**Claim 2.6:** `getTuple` returns `undefined` when no row found (not `null`, not throw).

**Test:** `test_get_tuple_missing_returns_undefined`

---

**Claim 2.7:** Concrete `get(config)` delegates to `getTuple(config)`, returns `tuple?.checkpoint`.

**Test:** `test_get_delegates_to_get_tuple`

---

**Claim 2.8:** `list(config, options)` `before` filter resolves `before.configurable.checkpoint_id` and uses `AND checkpoint_id < ?` (UUID v6 lexicographic comparison, not step).

**Test:** `test_list_before_uses_checkpoint_id_not_step`
**Test:** `test_list_before_handles_forked_checkpoints_same_step`

---

**Claim 2.9:** `list()` filter evaluation uses `compareValues()` from LangGraph `store/utils.ts` with 8 operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`.

**Test:** `test_list_filter_supports_all_8_operators`

---

**Claim 2.10:** `$gt`, `$gte`, `$lt`, `$lte` use `Number()` coercion on both operands. `"5" > 3` evaluates to `Number("5") > Number(3)` → `true`.

**Test:** `test_filter_ordered_ops_use_number_coercion`

---

**Claim 2.11:** `$in` with non-array value returns `false`. `$nin` with non-array value returns `true`.

**Test:** `test_filter_in_non_array_returns_false`
**Test:** `test_filter_nin_non_array_returns_true`

---

**Claim 2.12:** Unknown filter operators (e.g., `$regex`) silently return `false` (not throw).

**Test:** `test_filter_unknown_operator_returns_false`

---

**Claim 2.13:** `isFilterOperators` type guard: an object is treated as filter operators only if ALL its keys are valid `$` operators. An object like `{ $eq: 1, foo: 2 }` falls through to `===` equality comparison.

**Test:** `test_filter_mixed_keys_falls_through_to_equality`

---

**Claim 2.14:** `list()` scan cap: `maxScanRows = 50000`. When filter is present and cap is reached, generator stops yielding (partial results, no throw).

**Test:** `test_list_scan_cap_partial_results`

---

**Claim 2.15:** `list()` generator checks governance gate once at creation. Mid-iteration validity changes do not re-check.

**Test:** `test_list_generator_gate_checked_once`

---

**Claim 2.16:** `put(config, checkpoint, metadata, newVersions)` serializes checkpoint via `serde.dumpsTyped(checkpoint)` → `[type_tag, bytes]`. Routing: `Uint8Array` → `"bytes"`, else → `"json"`.

**Test:** `test_put_serializes_via_dumps_typed`
**Test:** `test_dumps_typed_routing_uint8array_bytes`
**Test:** `test_dumps_typed_routing_object_json`

---

**Claim 2.17:** `put()` serializes metadata via `JSON.stringify(metadata)`. Extra properties from `CheckpointMetadata<E>` are preserved.

**Test:** `test_put_metadata_extra_properties_preserved`

---

**Claim 2.18:** `put()` drops `newVersions` parameter (not stored). Matches SQLiteSaver and MemorySaver.

**Test:** `test_put_drops_new_versions`

---

**Claim 2.19:** `put()` writes chain entry with `transition_kind: "LgCheckpoint"`. `tenant_scope` is a top-level `ChainEntry` field, NOT inside `state_json`.

**Test:** `test_put_chain_entry_tenant_scope_top_level`

---

**Claim 2.20:** `put()` calls `projector.projectPending()` synchronously after chain write. If `projectPending()` throws, `put()` throws. Chain entry is preserved.

**Test:** `test_put_project_pending_failure_propagates`

---

**Claim 2.21:** `put()` bypasses governance gate (writes always proceed regardless of projection validity state).

> **Rationale:** Chain is source of truth. Blocking writes on projection state would prevent recovery — you need to write the fix to the chain before the projection can be repaired.

**Test:** `test_put_bypasses_governance`

---

**Claim 2.22:** `getNextVersion(current)` for `V=number`: returns `(current !== undefined && typeof current === "number") ? current + 1 : 1`.

**Test:** `test_get_next_version_number_increments`
**Test:** `test_get_next_version_undefined_returns_1`

---

**Claim 2.23:** `getNextVersion` for `V=string` throws `"Please override this method to use string versions."` Adapter uses `V=number` default.

**Test:** `test_get_next_version_string_throws`

---

**Claim 2.24:** `putWrites` write index resolution: `WRITES_IDX_MAP[channel] ?? sequentialIdx`. `__error__` → -1, `__scheduled__` → -2, `__interrupt__` → -3, `__resume__` → -4. `__pregel_tasks` (TASKS) is NOT in map → uses sequential idx.

**Test:** `test_put_writes_special_channel_indices`
**Test:** `test_put_writes_tasks_uses_sequential_idx`

---

**Claim 2.25:** `putWrites` projector uses `INSERT OR REPLACE` (not `INSERT OR IGNORE`, not DELETE-then-INSERT). Writes accumulate per task.

> **Rationale:** Regular channels are written once per task execution. Retries produce identical values. REPLACE is simpler and matches SQLiteSaver, the production reference implementation.

**Test:** `test_put_writes_uses_insert_or_replace`

---

**Claim 2.26:** `putWrites` regular channel retry (same `task_id`, same `write_idx`) overwrites previous value via REPLACE.

**Test:** `test_put_writes_regular_retry_overwrites`

---

**Claim 2.27:** `putWrites` special channel retry (same `task_id`, same negative `write_idx`) overwrites previous value via REPLACE.

**Test:** `test_put_writes_special_retry_overwrites`

---

**Claim 2.28:** `putWrites` regular + special writes for same `task_id` coexist (different `write_idx` signs, no collision).

**Test:** `test_put_writes_regular_and_special_coexist`

---

**Claim 2.29:** Design decision: `INSERT OR REPLACE` (SQLiteSaver) chosen over `INSERT OR IGNORE` (MemorySaver) for regular channels. Documented divergence: retry overwrites instead of keeping first.

**Test:** `test_put_writes_divergence_from_memory_saver_documented`

---

**Claim 2.30:** MemorySaver does not use `type_tag` (objects stored in memory). Checkpoints from MemorySaver cannot migrate to Limen adapter without re-serialization.

**Test:** `test_memory_saver_migration_requires_reserialization`

---

**Claim 2.31:** `deleteThread(threadId)` projector executes in fixed order: DELETE `lg_pending_writes` THEN DELETE `lg_checkpoints`.

**Test:** `test_delete_thread_order_writes_then_checkpoints`

---

**Claim 2.32:** `deleteThread` deletes ALL checkpoints and writes across ALL namespaces (`checkpoint_ns`) for the thread within tenant scope. Includes special channel writes.

NOTE: `deleteThread` does NOT delete store items (`lg_store_items`). Store items are not thread-scoped — they use namespace + key, independent of thread_id. Applications must manage store item lifecycle independently.

**Test:** `test_delete_thread_all_namespaces_all_channels`
**Test:** `test_delete_thread_does_not_delete_store_items`

---

**Claim 2.33:** `deleteThread` tenant: uses `adapterConfig.tenantScope ?? '__default__'` (no `RunnableConfig` parameter). Multi-tenant deployments need per-tenant adapter instances.

**Test:** `test_delete_thread_uses_adapter_tenant_scope`

---

**Claim 2.34:** `deleteThread` bypasses governance gate. Rationale: blocking deletes during outages prevents cleanup.

**Test:** `test_delete_thread_bypasses_governance`

---

**Claim 2.35:** `deleteThread` chain entries preserved (append-only). Replay produces identical final state (create then delete).

**Test:** `test_delete_thread_replay_deterministic`

---

## 3. BaseStore

**Claim 3.1:** `batch()` executes in 3 phases: Phase 1 (Gets) → Phase 2 (Searches + ListNamespaces) → Phase 3 (Puts + single `projectPending()`).

**Test:** `test_batch_three_phase_ordering`

---

**Claim 3.2:** Phase 1+2 reads resolve against pre-batch projection state. Phase 3 writes apply AFTER all reads. A GetOp before a PutOp for the same key returns pre-batch state.

**Test:** `test_batch_reads_see_pre_batch_state`

---

**Claim 3.3:** `batch()` is NOT atomic. Partial Phase 3 failure leaves partial chain entries. These project on next `projectPending()` from any source.

**Test:** `test_batch_non_atomic_partial_writes_recover`

---

**Claim 3.4:** `batch()` GetOp returns deserialized copy (not reference to internal state). Mutating the returned value does NOT mutate the store.

**Test:** `test_batch_get_returns_copy_not_reference`

---

**Claim 3.5:** `batch()` PutOp returns `undefined` (TypeScript `void`). Reference InMemoryStore returns `null`. Documented divergence.

**Test:** `test_batch_put_returns_undefined_not_null`

---

**Claim 3.6:** `batch()` multiple PutOps for same key: each creates a chain entry. Projector `INSERT OR REPLACE` → last-wins. InMemoryStore deduplicates via `Map.set()` before applying. Same result, different mechanism.

**Test:** `test_batch_duplicate_puts_last_wins`

---

**Claim 3.7:** Namespace validation has exactly 5 rules:
1. `ns.length > 0` (non-empty array)
2. `typeof label === 'string'` for each label (non-string throws)
3. `label !== ''` (no empty strings)
4. `!label.includes('.')` (no dots in components)
5. `ns[0] !== 'langgraph'` (exact match, not `startsWith`)

**Test:** `test_namespace_validation_empty_array_throws`
**Test:** `test_namespace_validation_non_string_label_throws`
**Test:** `test_namespace_validation_empty_label_throws`
**Test:** `test_namespace_validation_dot_in_label_throws`
**Test:** `test_namespace_validation_langgraph_root_throws`
**Test:** `test_namespace_validation_langgraph_custom_root_allowed`

---

**Claim 3.8:** Search prefix query SQL (non-empty prefix):
```sql
SELECT * FROM lg_store_items
WHERE tenant_scope = ?1 AND namespace >= ?prefix AND namespace < ?prefix || '/'
ORDER BY updated_at DESC LIMIT ?scan_limit;
```
Boundary: `'/'` is ASCII 47, `'.'` is ASCII 46. `"user"` matches `"user"` (exact) and `"user.prefs"` (child). Does NOT match `"users"`.

**Test:** `test_search_prefix_exact_match_included`
**Test:** `test_search_prefix_child_included`
**Test:** `test_search_prefix_sibling_excluded`
**Test:** `test_search_prefix_partial_name_excluded`

---

**Claim 3.9:** Search prefix query SQL (empty prefix): omits namespace filter, matches all in tenant.

**Test:** `test_search_empty_prefix_matches_all`

---

**Claim 3.10:** Search filter uses same `compareValues()` as `list()` filter — all 8 operators, `Number()` coercion, `isFilterOperators` type guard.

**Test:** `test_search_filter_same_as_list_filter`

---

**Claim 3.11:** `SearchOperation.limit` defaults to `10` (source: `op.limit ?? 10`). `offset` defaults to `0`.

**Test:** `test_search_default_limit_10`

---

**Claim 3.12:** `SearchItem.score` is always `undefined` from this adapter.

**Test:** `test_search_item_score_always_undefined`

---

**Claim 3.13:** `search()` with `query` parameter throws `Error("Semantic search not supported")`.

**Test:** `test_search_with_query_throws`

---

**Claim 3.14:** Search scan cap: `maxScanRows = 50000`. Returns partial results on exhaustion.

**Test:** `test_search_scan_cap_partial_results`

---

**Claim 3.15:** `listNamespaces()` defaults: `limit = 100`, `offset = 0` (source: `store/base.ts`).

**Test:** `test_list_namespaces_default_limit_100`

---

**Claim 3.16:** `listNamespaces` scan cap: `maxScanRows = 50000` on DISTINCT query.

**Test:** `test_list_namespaces_scan_cap`

---

**Claim 3.17:** `MatchCondition` evaluation: `matchType: "prefix"` matches start of namespace array. `matchType: "suffix"` matches end. `"*"` matches any component.

**Test:** `test_match_condition_prefix`
**Test:** `test_match_condition_suffix`
**Test:** `test_match_condition_wildcard`

---

**Claim 3.18:** `maxDepth` truncates namespaces to N components, deduplicates.

**Test:** `test_list_namespaces_max_depth_truncates`

---

**Claim 3.19:** `store.delete(namespace, key)` builds `PutOperation { namespace, key, value: null }`, delegates to `batch([op])`.

**Test:** `test_store_delete_builds_put_null`

---

**Claim 3.20:** PutOperation (value non-null): projector uses `INSERT OR REPLACE`. On REPLACE, `created_at` preserved from existing row; `updated_at` set to chain entry `canonical_at`.

**Test:** `test_store_put_preserves_created_at_on_update`

---

**Claim 3.21:** PutOperation (value null): projector uses `DELETE WHERE tenant_scope = ? AND namespace = ? AND key = ?`. Idempotent.

**Test:** `test_store_delete_idempotent`

---

**Claim 3.22:** `PutOperation.index` stored in `index_fields` column. Not used for search. Logged when provided.

**Test:** `test_store_put_index_stored_not_used`

---

**Claim 3.23:** `start()` checks: chain accessible, projection accessible, projector initialized, schema version (0/NULL/1 → migrate; 2 → ready; >2 → throw), validity state machine (`verify_on_startup()`).

**Test:** `test_start_chain_inaccessible_throws`
**Test:** `test_start_schema_migration`
**Test:** `test_start_schema_gt2_throws`
**Test:** `test_start_verify_on_startup`

---

**Claim 3.24:** `start()` is idempotent. Multiple calls after success are no-ops.

**Test:** `test_start_idempotent`

---

**Claim 3.25:** `stop()` calls `projectPending()` in try/catch. Failure logged at WARN, not re-thrown. Sets `initialized = false`. Nulls refs. Post-stop calls throw `LimenNotStartedError`.

**Test:** `test_stop_flushes_pending`
**Test:** `test_stop_swallows_project_pending_error`
**Test:** `test_stop_resets_initialized`
**Test:** `test_post_stop_calls_throw_not_started`

---

**Claim 3.26:** `start()` after `stop()` is NOT supported. Consumer must create new adapter instance.

**Test:** `test_start_after_stop_throws`

---

**Claim 3.27:** `assertStarted()` called as first operation on every public method: `getTuple`, `list`, `put`, `putWrites`, `deleteThread`, `batch`, `get`, `search`, `delete`, `listNamespaces`.

**Test:** `test_assert_started_on_all_public_methods`

---

## 4. Governance

**Note on `governed` semantics:** `governed` controls ONLY the Lagging gate. Even with `governed=false`, Unverified/Divergent/Rebuilding states always block reads. The name refers to whether the consumer requires cryptographic verification of projection freshness (Verified-only) or accepts slight staleness (Lagging-acceptable). See Claims 4.1-4.7 for the complete state/flag matrix.

**Claim 4.1:** `governed=true`, Verified state: reads proceed.

**Test:** `test_governed_true_verified_proceeds`

---

**Claim 4.2:** `governed=true`, Lagging state: reads throw `LimenGovernanceError { state: "Lagging", retryable: true, guidance: "Wait for projector to catch up, then retry" }`.

**Test:** `test_governed_true_lagging_throws_retryable`

---

**Claim 4.3:** `governed=true`, Unverified state: reads throw `LimenGovernanceError { state: "Unverified", retryable: false }`.

**Test:** `test_governed_true_unverified_throws`

---

**Claim 4.4:** `governed=true`, Divergent state: reads throw `LimenGovernanceError { state: "Divergent", retryable: false, guidance: "Rebuild projection" }`.

**Test:** `test_governed_true_divergent_throws`

---

**Claim 4.5:** `governed=true`, Rebuilding state: reads throw `LimenGovernanceError { state: "Rebuilding", retryable: true, guidance: "Retry after rebuild" }`.

**Test:** `test_governed_true_rebuilding_throws_retryable`

---

**Claim 4.6:** `governed=false`, Lagging state: reads proceed with WARN log.

**Test:** `test_governed_false_lagging_proceeds_with_warning`

---

**Claim 4.7:** `governed=false`, Unverified/Divergent/Rebuilding: reads throw (same as `governed=true`).

**Test:** `test_governed_false_unverified_still_throws`

---

**Claim 4.8:** All writes (`put`, `putWrites`, `deleteThread`, store `put`, store `delete`) bypass governance gate.

**Test:** `test_all_writes_bypass_governance`

---

**Claim 4.9:** `NonAuthoritative<T>` stripped via `into_inner()` inside read methods. Never exposed to LangGraph.

**Test:** `test_non_authoritative_stripped_before_return`

---

**Claim 4.10:** `NonAuthoritative<T>` is NOT applied on writes. Write path bypasses `query_projection()` entirely.

**Test:** `test_writes_do_not_use_query_projection`

---

## 5. Tenant Isolation

**Claim 5.1:** `resolveTenantScope`: `config.configurable.limen_tenant_scope` (if string and non-empty) takes priority over `adapterConfig.tenantScope ?? '__default__'`.

**Test:** `test_tenant_explicit_config_takes_priority`
**Test:** `test_tenant_falls_back_to_adapter_config`
**Test:** `test_tenant_falls_back_to_default`

---

**Claim 5.2:** Every read query includes `AND tenant_scope = ?`.

**Test:** `test_all_read_queries_include_tenant_scope`

---

**Claim 5.3:** Every write chain entry includes `tenant_scope` as top-level `ChainEntry` field.

**Test:** `test_all_write_chain_entries_include_tenant_scope`

---

**Claim 5.4:** `tenant_scope` is part of every PK. Two tenants can have identical `thread_id` without collision.

> **Rationale:** Structural isolation. No query can cross tenants because the PK enforces it at the storage layer, not the application layer.

**Test:** `test_cross_tenant_thread_id_no_collision`

---

## 6. Serialization

**Claim 6.1:** `serde.dumpsTyped()` routing: `data instanceof Uint8Array` → `["bytes", data]`. Else → `["json", this._dumps(data)]`.

**Test:** `test_dumps_typed_uint8array_returns_bytes_tag`
**Test:** `test_dumps_typed_object_returns_json_tag`

---

**Claim 6.2:** Checkpoint state serialized via `serde.dumpsTyped()` (opaque BLOB + type_tag). Metadata via `JSON.stringify()` (queryable TEXT). Pending writes via `serde.dumpsTyped()`. Store values via `JSON.stringify()`.

**Test:** `test_checkpoint_blob_uses_serde`
**Test:** `test_metadata_uses_json_stringify`
**Test:** `test_pending_write_value_uses_serde`
**Test:** `test_store_value_uses_json_stringify`

---

**Claim 6.3:** Deserialization failure in `serde.loadsTyped()` throws `LimenSerdeError { typeTag, dataLength, cause }`. One corrupted pending write does not prevent reading other writes.

**Test:** `test_serde_failure_throws_limen_serde_error`
**Test:** `test_corrupted_write_does_not_block_others`

---

**Claim 6.3.1:** All `JSON.parse()` calls on projection data (`metadata_json`, `value_json`) are wrapped in try/catch. On failure, throw `LimenSerdeError { cause: SyntaxError, context: 'metadata_json' | 'value_json', row_id: string }`. This ensures consistent error typing across both blob deserialization (via serde) and JSON deserialization (via JSON.parse).

**Test:** `test_json_parse_metadata_corrupted_throws_limen_serde_error`
**Test:** `test_json_parse_value_corrupted_throws_limen_serde_error`

---

**Claim 6.4:** Digest determinism: all stored bytes are passthroughs from chain entries. No re-serialization during projection. Two projectors → identical rows.

**Test:** `test_digest_determinism_two_projectors`

---

**Claim 6.5:** `CheckpointMetadata<E>` extra properties preserved through `JSON.stringify` → `JSON.parse` round-trip.

**Test:** `test_metadata_extra_properties_roundtrip`

---

## 7. Performance

**Claim 7.1:** No application-level cache. SQLite page cache sufficient. Validity check cost: in-memory enum comparison (~10ns).

**Test:** `test_no_application_cache`

---

**Claim 7.2:** Single-projector invariant: one `Projector` per `projection.db`. Multiple adapter instances sharing projection MUST share projector reference. `projectPending()` serialized by projector.

**Test:** `test_single_projector_invariant`

---

**Claim 7.3:** Concurrent reads safe under SQLite WAL mode.

**Test:** `test_concurrent_reads_safe_wal`

---

## 8. Failure Modes

**Claim 8.1 (F-LG-001):** `put()` throws if `projectPending()` fails. Chain entry preserved. Next `projectPending()` from any source recovers.

**Test:** `test_f001_stale_read_project_pending_failure`

---

**Claim 8.2 (F-LG-002):** Governance rejection mid-execution throws `LimenGovernanceError` with `retryable` flag. After rebuild, graph resumes from last checkpoint.

**Test:** `test_f002_governance_rejection_mid_execution`

---

**Claim 8.3 (F-LG-003):** `tenant_scope` in all PKs + structural query injection prevents cross-tenant leakage.

**Test:** `test_f003_cross_tenant_leakage_prevented`

---

**Claim 8.4 (F-LG-004):** `JsonPlusSerializer` handles Date, Set, Map, Buffer, BigInt natively. Store values limited to `Record<string, any>` (JSON-safe).

**Test:** `test_f004_serialization_type_fidelity`

---

**Claim 8.5 (F-LG-005):** Projector wraps each entry derivation in SQLite transaction. `last_projected_sequence` tracks progress. Self-healing on next invocation.

**Test:** `test_f005_projector_crash_recovery`

---

**Claim 8.6 (F-LG-006):** Namespace validation rejects `.`, empty, non-string labels, empty array, `"langgraph"` root.

**Test:** `test_f006_namespace_validation_comprehensive`

---

**Claim 8.7 (F-LG-007):** TOCTOU window ~100μs. Too-permissive only (allows one read on stale state). Next read catches change. Accepted as benign.

> **Rationale:** The ~100us window is too-permissive only (a read might succeed when it should be blocked). The alternative (locking reads during state transitions) adds latency to every read for a window that occurs once per projection rebuild.

**Test:** `test_f007_toctou_accepted_benign`

---

**Claim 8.8 (F-LG-008):** Task retry with fewer regular writes: old rows persist (no DELETE). Matches SQLiteSaver. Pregel processes by channel name.

**Test:** `test_f008_stale_rows_persist_on_retry`

---

**Claim 8.9 (F-LG-009):** Prefix range `namespace >= ?p AND namespace < ?p || '/'` enforces dot boundary. ASCII 46(`.`)/47(`/`) adjacency.

**Test:** `test_f009_prefix_boundary_ascii_adjacency`

---

**Claim 8.10 (F-LG-010):** `maxScanRows = 50000`. Partial results on exhaustion (no throw).

**Test:** `test_f010_scan_cap_partial_results`

---

**Claim 8.11 (F-LG-011):** `LimenSerdeError { typeTag, dataLength }` on deserialization failure.

**Test:** `test_f011_serde_error_fields`

---

**Claim 8.12 (F-LG-012):** All public methods call `assertStarted()` → `LimenNotStartedError` before `start()`.

**Test:** `test_f012_read_before_start`

---

**Claim 8.13 (F-LG-013):** Chain write failure mid-putWrites: partial entries recoverable via `INSERT OR REPLACE` on retry.

**Test:** `test_f013_chain_failure_mid_put_writes`

---

**Claim 8.14 (F-LG-014):** Chain write failure mid-batch: reads done, writes partial. `projectPending()` not called. Partial entries project on next successful `projectPending()` from any source.

**Test:** `test_f014_batch_partial_writes_recover`

---

**Claim 8.15 (F-LG-015):** `stop()` catches `projectPending()` failure, logs WARN, does not re-throw. Unprocessed entries remain until next `projectPending()`.

**Test:** `test_f015_stop_swallows_error_logs_warn`

---

**Claim 8.16 (F-LG-016):** SQLITE_FULL (disk full during chain write or projection). Chain write fails with `LimenStorageError`. `projectPending()` fails, self-heals on next call after space is freed. No data corruption — SQLite rollback journal protects partial writes.

**Test:** `test_f016_sqlite_full_chain_write_fails`
**Test:** `test_f016_sqlite_full_projection_self_heals`

---

**Claim 8.17 (F-LG-017):** SQLITE_CORRUPT (database corruption detected). Validity transitions to Divergent. All reads blocked. Recovery: rebuild projection from chain via `rebuildProjection()`. Chain corruption requires restore from backup.

**Test:** `test_f017_sqlite_corrupt_transitions_divergent`

---

**Claim 8.18 (F-LG-018):** SQLITE_BUSY (WAL checkpoint contention). Retry with exponential backoff, max 3 retries. If still busy after 3 retries, throw `LimenStorageError { detail: "SQLITE_BUSY after 3 retries" }`.

**Test:** `test_f018_sqlite_busy_retries_then_throws`

---

## 9. Verification Matrix

| # | Claim | Test Name |
|---|---|---|
| 1.1 | lg_checkpoints schema | `test_lg_checkpoints_schema_exact_columns` |
| 1.2 | lg_pending_writes schema | `test_lg_pending_writes_schema_exact_columns` |
| 1.3 | lg_store_items schema | `test_lg_store_items_schema_exact_columns` |
| 1.4 | Schema migration | `test_schema_migration_v1_to_v2`, `test_schema_version_gt2_throws` |
| 1.5 | Tamper triggers | `test_tamper_triggers_fire_on_all_mutations` |
| 1.6 | Digest versioning | `test_digest_v1_excludes_lg_tables`, `test_digest_v2_includes_lg_tables` |
| 2.1-2.6 | getTuple SQL + deserialization | `test_get_tuple_*` (6 tests) |
| 2.7 | get() delegation | `test_get_delegates_to_get_tuple` |
| 2.8-2.15 | list() filtering + scanning | `test_list_*` (10 tests) |
| 2.16-2.21 | put() serialization + governance | `test_put_*` (8 tests) |
| 2.22-2.23 | getNextVersion | `test_get_next_version_*` (3 tests) |
| 2.24-2.30 | putWrites accumulation | `test_put_writes_*` (8 tests) |
| 2.31-2.35 | deleteThread | `test_delete_thread_*` (5 tests) |
| 3.1-3.6 | batch() phases + divergences | `test_batch_*` (6 tests) |
| 3.7 | Namespace validation | `test_namespace_validation_*` (6 tests) |
| 3.8-3.14 | Search SQL + filtering | `test_search_*` (8 tests) |
| 3.15-3.18 | listNamespaces | `test_list_namespaces_*` (4 tests) |
| 3.19-3.22 | Store put/delete/index | `test_store_*` (4 tests) |
| 3.23-3.27 | Lifecycle | `test_start_*`, `test_stop_*`, `test_assert_started_*` (10 tests) |
| 4.1-4.10 | Governance | `test_governed_*`, `test_non_authoritative_*`, `test_writes_*` (10 tests) |
| 5.1-5.4 | Tenant isolation | `test_tenant_*`, `test_cross_tenant_*` (5 tests) |
| 6.1-6.5 | Serialization | `test_dumps_typed_*`, `test_checkpoint_*`, `test_serde_*`, `test_metadata_*` (9 tests) |
| 7.1-7.3 | Performance invariants | `test_no_application_cache`, `test_single_projector_*`, `test_concurrent_*` (3 tests) |
| 8.1-8.15 | Failure modes | `test_f001_*` through `test_f015_*` (15 tests) |
| 8.16-8.18 | SQLite failure modes | `test_f016_*` through `test_f018_*` (4 tests) |

**Total: ~124 tests covering every claim.**

---

## 10. Assumptions Ledger

| # | Assumption | Owner | Test |
|---|---|---|---|
| A-1 | v1.0.1 interface stable | Adapter maintainer | `test_a01_interface_version` |
| A-2 | JsonPlusSerializer deterministic | Adapter maintainer | `test_a02_serializer_deterministic` |
| A-3 | Single Projector per projection.db | Limen core team | `test_a03_single_projector` |
| A-4 | SQLite WAL mode | Ops/DevOps | `test_a04_wal_mode` |
| A-5 | projectPending ≤10ms | Limen core team | `test_a05_project_pending_latency` |
| A-6 | Checkpoints/thread <10K | Ops/DevOps | `test_a06_checkpoint_count_bound` |
| A-7 | Store values JSON-serializable | Adapter maintainer | `test_a07_store_values_json` |
| A-8 | No `.` in namespace components | Adapter maintainer | `test_a08_no_dots` |
| A-9 | type_tag "json" or "bytes" | Adapter maintainer | `test_a09_type_tag_values` |
| A-10 | Checkpoint.v = 4, opaque | Adapter maintainer | `test_a10_checkpoint_v_opaque` |
| A-11 | newVersions unused | Adapter maintainer | `test_a11_new_versions_unused` |
| A-12 | start() after stop() unsupported | Limen core team | `test_a12_restart_unsupported` |
| A-13 | V=number for getNextVersion | Adapter maintainer | `test_a13_v_number_default` |

---

## 11. Appendix

### A.1 Chain Entry Payloads

`tenant_scope` is top-level `ChainEntry` field, NOT in `state_json`.

| Kind | state_json |
|---|---|
| `LgCheckpoint` | `{ thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type_tag, checkpoint_blob, metadata_json, step, source }` |
| `LgWrite` | `{ thread_id, checkpoint_ns, checkpoint_id, task_id, writes: [{ channel, type_tag, value, write_idx }] }` |
| `LgDelete` | `{ thread_id }` |
| `LgStorePut` | `{ namespace, key, value_json, index_fields }` |
| `LgStoreDelete` | `{ namespace, key }` |

### A.2 Error Types

```typescript
class LimenGovernanceError extends Error {
  state: string; reason?: string; guidance?: string; retryable: boolean;
}
class LimenStorageError extends Error { detail: string }
class LimenSerdeError extends Error { typeTag: string; dataLength: number; cause: Error }
class LimenNotStartedError extends Error {}
```

### A.3 Constants

```typescript
const WRITES_IDX_MAP = { "__error__": -1, "__scheduled__": -2, "__interrupt__": -3, "__resume__": -4 };
const TASKS = "__pregel_tasks";  // NOT in WRITES_IDX_MAP
const VALID_FILTER_OPS = ['$eq','$ne','$gt','$gte','$lt','$lte','$in','$nin'];
```

---

*SolisHQ — We innovate, invent, then disrupt.*
