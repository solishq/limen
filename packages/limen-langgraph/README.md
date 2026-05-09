<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# @limen-ai/langgraph

Governed LangGraph checkpoint and store adapter for Limen. Bridges LangGraph's `BaseCheckpointSaver` and `BaseStore` interfaces to Limen's append-only chain + projection architecture with governance gates that enforce projection validity before reads.

## Installation

```bash
npm install @limen-ai/langgraph
```

### Peer Dependencies

| Package | Version |
|---------|---------|
| `limen-ai` | `^5.0.0-alpha.1` |
| `@langchain/langgraph-checkpoint` | `^1.0.1` |

## Quickstart

```typescript
import { LimenCheckpointSaver, LimenStore } from '@limen-ai/langgraph';
import { StateGraph } from '@langchain/langgraph';

// Obtain Limen infrastructure objects from your limen-ai instance:
//   chain:      ChainStorage           — append-only immutable log
//   projection: ProjectionStorage      — read-optimized SQLite query layer
//   projector:  Projector              — derives projection rows from chain entries
//   validity:   ValidityStateMachine   — tracks projection integrity state

const config = { chain, projection, projector, validity };

// Create adapters (both accept LimenCheckpointerConfig)
const checkpointer = new LimenCheckpointSaver(config);
const store = new LimenStore(config);

// Start in order: checkpointer creates schema that store depends on
await checkpointer.start();
await store.start();

// Wire into LangGraph
const graph = new StateGraph({ channels: { messages: { value: [] } } })
  .addNode('agent', agentNode)
  .addEdge('__start__', 'agent')
  .compile({ checkpointer, store });

// Invoke with thread isolation
const result = await graph.invoke(
  { messages: [{ role: 'user', content: 'hello' }] },
  { configurable: { thread_id: 'thread-001' } },
);

// Cleanup
await checkpointer.stop();
await store.stop();
```

## Configuration

```typescript
interface LimenCheckpointerConfig {
  chain: ChainStorage;              // Required — append-only chain
  projection: ProjectionStorage;    // Required — projection query layer
  projector: Projector;             // Required — chain-to-projection derivation
  validity: ValidityStateMachine;   // Required — projection integrity state
  serde?: SerializerProtocol;       // Default: JsonPlusSerializer
  governed?: boolean;               // Default: false
  tenantScope?: string;             // Default: '__default__'
  logger?: LimenCheckpointLogger;   // Default: console.warn wrapper
}
```

Both `LimenCheckpointSaver` and `LimenStore` accept this config shape.

## Governed vs Non-Governed Mode

The `governed` flag controls how strictly the adapter enforces projection validity before serving reads. Claims 4.1-4.8 define the complete state/flag matrix.

| Validity State | `governed: false` (default) | `governed: true` |
|----------------|---------------------------|-------------------|
| **Verified** | Reads allowed | Reads allowed |
| **Lagging** | Reads allowed (WARN logged) | **Blocked** — retryable `LimenGovernanceError` |
| **Unverified** | **Blocked** — not retryable | **Blocked** — not retryable |
| **Divergent** | **Blocked** — not retryable | **Blocked** — not retryable |
| **Rebuilding** | **Blocked** — retryable | **Blocked** — retryable |

All writes (`put`, `putWrites`, `deleteThread`, store `put`, store `delete`) bypass the governance gate entirely (Claim 4.8).

## API Reference

### LimenCheckpointSaver (extends BaseCheckpointSaver)

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Initialize adapter. Verifies infra, migrates schema, checks validity. Idempotent. |
| `stop()` | `Promise<void>` | Shutdown. Flushes pending, nulls refs. Terminal. |
| `getTuple(config)` | `Promise<CheckpointTuple \| undefined>` | Retrieve checkpoint + pending writes by thread/checkpoint_id. |
| `get(config)` | `Promise<Checkpoint \| undefined>` | Delegates to `getTuple`, returns `tuple?.checkpoint`. |
| `list(config, options?)` | `AsyncGenerator<CheckpointTuple>` | List checkpoints with filter, before, limit. Scan cap: 50,000. |
| `put(config, checkpoint, metadata, newVersions)` | `Promise<RunnableConfig>` | Save checkpoint to chain. Bypasses governance. |
| `putWrites(config, writes, taskId)` | `Promise<void>` | Save pending writes. Special channels get negative indices. |
| `deleteThread(threadId)` | `Promise<void>` | Delete all checkpoints + writes for thread. Chain preserved. |
| `getNextVersion(current)` | `number` | Returns `current + 1` or `1`. Integer-only. |

### LimenStore (extends BaseStore)

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Initialize store. Requires checkpointer schema. Idempotent. |
| `stop()` | `Promise<void>` | Shutdown. Flushes pending. Terminal. |
| `batch(operations)` | `Promise<OperationResults>` | Execute Get/Search/ListNs/Put in 3 phases. |
| `get(namespace, key)` | `Promise<Item \| null>` | Get single item. |
| `put(namespace, key, value, index?)` | `Promise<void>` | Upsert item. INSERT OR REPLACE. |
| `delete(namespace, key)` | `Promise<void>` | Delete item. Idempotent. |
| `search(prefix, options?)` | `Promise<SearchItem[]>` | Filter-based search. No semantic search. |
| `listNamespaces(options?)` | `Promise<string[][]>` | List unique namespaces with prefix/suffix/maxDepth. |

## Error Handling

| Error Class | Retryable | When Thrown | Recovery |
|-------------|-----------|------------|----------|
| `LimenGovernanceError` | Check `.retryable` | Read blocked by validity state | If retryable: wait ~100ms, retry. If not: rebuild projection or investigate. |
| `LimenStorageError` | No | Chain/projection infrastructure failure, schema mismatch, restart after stop | Fix infrastructure. Create new instance if stopped. |
| `LimenSerdeError` | No | Serialization/deserialization failure | Inspect `.typeTag`, `.dataLength`, `.cause`, `.context`. |
| `LimenNotStartedError` | No | Any method called before `start()` | Call `start()` first. |

```typescript
import { LimenGovernanceError } from '@limen-ai/langgraph';

try {
  const result = await graph.invoke(input, config);
} catch (err) {
  if (err instanceof LimenGovernanceError && err.retryable) {
    await new Promise(r => setTimeout(r, 100));
    // retry...
  }
}
```

## Multi-Tenant Isolation

Set `tenantScope` at construction or override per-request (checkpointer only):

```typescript
await graph.invoke(input, {
  configurable: { thread_id: 't1', limen_tenant_scope: 'tenant-acme' },
});
```

Store uses adapter-level `tenantScope` only (no per-request override). Create separate `LimenStore` instances per tenant if needed.

## Lifecycle

1. **Construct** -- `new LimenCheckpointSaver(config)` / `new LimenStore(config)`
2. **Start** -- `await adapter.start()` -- idempotent. Checkpointer before store.
3. **Use** -- all LangGraph operations available.
4. **Stop** -- `await adapter.stop()` -- terminal. Create new instance to restart.

## Performance

*Estimated, pending benchmarks.*

- No application-level cache. SQLite page cache handles hot reads.
- Governance gate cost: in-memory enum comparison (~10ns).
- Write latency includes synchronous `projectPending()` call.
- Scan cap: 50,000 rows on `list()`, `search()`, `listNamespaces()`.

## Limitations

- **No semantic search** -- `search()` with a `query` string throws.
- **No vector indexing** -- `index` field on put is stored but unused.
- **Synchronous projection** -- write latency includes projection time.
- **Async only** -- sync variants (`getTupleSync`, `putSync`, `putWritesSync`) throw.

## Claims Traceability

All 124 design claims are tracked in [CLAIMS.md](./CLAIMS.md). Tests reference claim numbers (e.g., "Claim 2.1", "F-LG-003").

## Testing

```bash
npm install @langchain/langgraph-checkpoint  # peer dep required
npm test
```

271 tests across 7 files covering all design claims and 15 failure modes.

## License

BUSL-1.1
