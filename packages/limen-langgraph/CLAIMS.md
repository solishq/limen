# @limen-ai/langgraph -- Design Claims

All 124 claims from the LangGraph Adapter Design Document (Revision 8). Each claim is atomic and testable. Grouped by section.

Source: `~/SolisHQ/engineering-ip/limen/LANGGRAPH_ADAPTER_DESIGN.md`

---

### 1. Schema (6 claims)

- **Claim 1.1:** `lg_checkpoints` has exactly 12 columns with PK `(tenant_scope, thread_id, checkpoint_ns, checkpoint_id)`
- **Claim 1.2:** `lg_pending_writes` has exactly 10 columns with PK `(tenant_scope, thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx)`
- **Claim 1.3:** `lg_store_items` has exactly 8 columns with PK `(tenant_scope, namespace, key)`
- **Claim 1.4:** Schema version is 2; migration from 0/NULL/1 creates tables via CREATE TABLE IF NOT EXISTS; version >2 throws LimenStorageError
- **Claim 1.5:** 9 tamper triggers exist (INSERT/UPDATE/DELETE x 3 lg_* tables), each sets projection_metadata.tamper_marker=1
- **Claim 1.6:** Digest includes lg_* tables after existing 4, version-gated (v1=4-table, v2=7-table)

### 2. BaseCheckpointSaver (35 claims)

- **Claim 2.1:** getTuple with checkpoint_id executes exact SQL match on (tenant_scope, thread_id, checkpoint_ns, checkpoint_id)
- **Claim 2.2:** getTuple without checkpoint_id returns latest by UUID v6 (ORDER BY checkpoint_id DESC LIMIT 1)
- **Claim 2.3:** getTuple pending writes ordered by (task_id, write_idx)
- **Claim 2.4:** getTuple deserializes checkpoint via serde.loadsTyped(type_tag, checkpoint_blob)
- **Claim 2.5:** getTuple deserializes each pending write via serde.loadsTyped(type_tag, value)
- **Claim 2.6:** getTuple returns undefined when no row found (not null, not throw)
- **Claim 2.7:** get(config) delegates to getTuple(config), returns tuple?.checkpoint
- **Claim 2.8:** list() before filter uses checkpoint_id comparison (UUID v6 lexicographic, not step)
- **Claim 2.9:** list() filter supports 8 operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin
- **Claim 2.10:** $gt/$gte/$lt/$lte use Number() coercion on both operands
- **Claim 2.11:** $in with non-array returns false; $nin with non-array returns true
- **Claim 2.12:** Unknown filter operators silently return false
- **Claim 2.13:** isFilterOperators requires ALL keys to be valid $ operators; mixed keys fall through to === equality
- **Claim 2.14:** list() scan cap 50,000 rows; partial results on exhaustion, no throw
- **Claim 2.15:** list() generator checks governance gate once at creation, not mid-iteration
- **Claim 2.16:** put() serializes checkpoint via serde.dumpsTyped; Uint8Array->"bytes", else->"json"
- **Claim 2.17:** put() serializes metadata via JSON.stringify; extra properties preserved
- **Claim 2.18:** put() drops newVersions parameter (not stored)
- **Claim 2.19:** put() chain entry has tenant_scope as top-level field, NOT inside state_json
- **Claim 2.20:** put() calls projectPending() synchronously after chain write; failure propagates
- **Claim 2.21:** put() bypasses governance gate (writes always proceed)
- **Claim 2.22:** getNextVersion(current) returns current+1 for numbers, 1 for undefined
- **Claim 2.23:** getNextVersion for V=string throws; adapter uses V=number default
- **Claim 2.24:** putWrites index: WRITES_IDX_MAP[channel] ?? sequentialIdx; __error__=-1, __scheduled__=-2, __interrupt__=-3, __resume__=-4; __pregel_tasks uses sequential
- **Claim 2.25:** putWrites projector uses INSERT OR REPLACE (not IGNORE, not DELETE+INSERT)
- **Claim 2.26:** putWrites regular channel retry overwrites via REPLACE
- **Claim 2.27:** putWrites special channel retry overwrites via REPLACE
- **Claim 2.28:** putWrites regular + special writes for same task_id coexist (different write_idx signs)
- **Claim 2.29:** INSERT OR REPLACE chosen over INSERT OR IGNORE; documented divergence from MemorySaver
- **Claim 2.30:** MemorySaver migration requires re-serialization (no type_tag in memory)
- **Claim 2.31:** deleteThread projector order: DELETE pending_writes THEN DELETE checkpoints
- **Claim 2.32:** deleteThread deletes all namespaces, all channels within tenant; does NOT delete store items
- **Claim 2.33:** deleteThread uses adapter tenantScope (no RunnableConfig parameter)
- **Claim 2.34:** deleteThread bypasses governance gate
- **Claim 2.35:** deleteThread chain entries preserved (append-only); replay deterministic

### 3. BaseStore (27 claims)

- **Claim 3.1:** batch() executes in 3 phases: Gets -> Searches+ListNamespaces -> Puts+projectPending
- **Claim 3.2:** Phase 1+2 reads resolve against pre-batch projection state
- **Claim 3.3:** batch() is NOT atomic; partial Phase 3 failure leaves partial chain entries
- **Claim 3.4:** GetOp returns deserialized copy (not reference to internal state)
- **Claim 3.5:** PutOp returns undefined (not null); documented divergence from InMemoryStore
- **Claim 3.6:** Multiple PutOps same key: last-wins via INSERT OR REPLACE
- **Claim 3.7:** Namespace validation: 5 rules (non-empty, string labels, no empty strings, no dots, no "langgraph" root)
- **Claim 3.8:** Search prefix uses sargable range: namespace >= prefix AND namespace < prefix + '/'
- **Claim 3.9:** Empty search prefix matches all items in tenant
- **Claim 3.10:** Search filter uses same compareValues() as list() filter (8 operators)
- **Claim 3.11:** Search defaults: limit=10, offset=0
- **Claim 3.12:** SearchItem.score is always undefined
- **Claim 3.13:** search() with query parameter throws Error("Semantic search not supported")
- **Claim 3.14:** Search scan cap 50,000 rows; partial results on exhaustion
- **Claim 3.15:** listNamespaces defaults: limit=100, offset=0
- **Claim 3.16:** listNamespaces scan cap 50,000 on DISTINCT query
- **Claim 3.17:** MatchCondition: prefix matches start, suffix matches end, "*" matches any component
- **Claim 3.18:** maxDepth truncates namespaces to N components, deduplicates
- **Claim 3.19:** store.delete() builds PutOperation with value=null, delegates to batch
- **Claim 3.20:** PutOp (value non-null): INSERT OR REPLACE; preserves created_at on update
- **Claim 3.21:** PutOp (value null): DELETE; idempotent
- **Claim 3.22:** PutOperation.index stored in index_fields, not used for search
- **Claim 3.23:** start() checks: chain, projection, projector, schema version, validity
- **Claim 3.24:** start() is idempotent
- **Claim 3.25:** stop() flushes projectPending() in try/catch; failure logged WARN, not re-thrown
- **Claim 3.26:** start() after stop() throws; consumer must create new instance
- **Claim 3.27:** assertStarted() called on every public method

### 4. Governance (10 claims)

- **Claim 4.1:** governed=true, Verified: reads proceed
- **Claim 4.2:** governed=true, Lagging: throws LimenGovernanceError (retryable=true)
- **Claim 4.3:** governed=true, Unverified: throws LimenGovernanceError (retryable=false)
- **Claim 4.4:** governed=true, Divergent: throws LimenGovernanceError (retryable=false)
- **Claim 4.5:** governed=true, Rebuilding: throws LimenGovernanceError (retryable=true)
- **Claim 4.6:** governed=false, Lagging: reads proceed with WARN log
- **Claim 4.7:** governed=false, Unverified/Divergent/Rebuilding: throws (same as governed=true)
- **Claim 4.8:** All writes bypass governance gate
- **Claim 4.9:** NonAuthoritative<T> stripped via into_inner() inside read methods
- **Claim 4.10:** NonAuthoritative<T> not applied on writes

### 5. Tenant Isolation (4 claims)

- **Claim 5.1:** resolveTenantScope: config.configurable.limen_tenant_scope > adapterConfig.tenantScope > '__default__'
- **Claim 5.2:** Every read query includes AND tenant_scope = ?
- **Claim 5.3:** Every write chain entry includes tenant_scope as top-level field
- **Claim 5.4:** tenant_scope is part of every PK; cross-tenant thread_id collision impossible

### 6. Serialization (5+1 claims)

- **Claim 6.1:** dumpsTyped routing: Uint8Array -> ["bytes", data], else -> ["json", _dumps(data)]
- **Claim 6.2:** Checkpoint state via serde.dumpsTyped (BLOB); metadata via JSON.stringify (TEXT); pending writes via serde.dumpsTyped; store values via JSON.stringify
- **Claim 6.3:** Deserialization failure throws LimenSerdeError; one corrupted write does not block others
- **Claim 6.3.1:** All JSON.parse calls on projection data wrapped in try/catch; throws LimenSerdeError with context
- **Claim 6.4:** Digest determinism: stored bytes are passthroughs from chain; no re-serialization during projection
- **Claim 6.5:** CheckpointMetadata extra properties preserved through JSON.stringify/parse round-trip

### 7. Performance (3 claims)

- **Claim 7.1:** No application-level cache; SQLite page cache sufficient; validity check ~10ns
- **Claim 7.2:** Single-projector invariant: one Projector per projection.db; projectPending() serialized
- **Claim 7.3:** Concurrent reads safe under SQLite WAL mode

### 8. Failure Modes (18 claims)

- **Claim 8.1 (F-LG-001):** put() throws if projectPending() fails; chain entry preserved; next projectPending recovers
- **Claim 8.2 (F-LG-002):** Governance rejection mid-execution throws LimenGovernanceError with retryable flag
- **Claim 8.3 (F-LG-003):** Structural tenant isolation via PKs prevents cross-tenant leakage
- **Claim 8.4 (F-LG-004):** JsonPlusSerializer handles Date, Set, Map, Buffer, BigInt; store values must be JSON-safe
- **Claim 8.5 (F-LG-005):** Projector wraps each entry in SQLite transaction; last_projected_sequence tracks progress
- **Claim 8.6 (F-LG-006):** Namespace validation rejects dot, empty, non-string, empty array, "langgraph" root
- **Claim 8.7 (F-LG-007):** TOCTOU window ~100us; too-permissive only; accepted as benign
- **Claim 8.8 (F-LG-008):** Task retry with fewer writes: old rows persist (no DELETE); matches SQLiteSaver
- **Claim 8.9 (F-LG-009):** Prefix range enforces dot boundary via ASCII 46('.')/47('/') adjacency
- **Claim 8.10 (F-LG-010):** Scan cap 50,000; partial results on exhaustion
- **Claim 8.11 (F-LG-011):** LimenSerdeError includes typeTag and dataLength fields
- **Claim 8.12 (F-LG-012):** All public methods call assertStarted() before operation
- **Claim 8.13 (F-LG-013):** Chain write failure mid-putWrites: partial entries recoverable via INSERT OR REPLACE
- **Claim 8.14 (F-LG-014):** Chain write failure mid-batch: reads done, writes partial; projectPending not called
- **Claim 8.15 (F-LG-015):** stop() catches projectPending failure, logs WARN, does not re-throw
- **Claim 8.16 (F-LG-016):** SQLITE_FULL: chain write fails with LimenStorageError; projection self-heals after space freed
- **Claim 8.17 (F-LG-017):** SQLITE_CORRUPT: validity transitions to Divergent; all reads blocked; rebuild required
- **Claim 8.18 (F-LG-018):** SQLITE_BUSY: retry with exponential backoff, max 3; then throw LimenStorageError

### Assumptions Ledger (13 entries)

- **A-1:** v1.0.1 interface stable
- **A-2:** JsonPlusSerializer deterministic
- **A-3:** Single Projector per projection.db
- **A-4:** SQLite WAL mode
- **A-5:** projectPending latency <=10ms
- **A-6:** Checkpoints per thread <10K
- **A-7:** Store values JSON-serializable
- **A-8:** No dots in namespace components
- **A-9:** type_tag is "json" or "bytes" only
- **A-10:** Checkpoint.v = 4, opaque
- **A-11:** newVersions parameter unused
- **A-12:** start() after stop() unsupported
- **A-13:** V=number for getNextVersion

---

**Total: 124 claims + 13 assumptions.**
