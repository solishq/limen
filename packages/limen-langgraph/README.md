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

## Quick Start

```typescript
import { LimenCheckpointSaver, LimenStore } from '@limen-ai/langgraph';
import { StateGraph } from '@langchain/langgraph';

// -- Obtain Limen infrastructure objects from your limen-ai instance --
// These 4 objects come from your Limen engine initialization:
//   chain:      ChainStorage      — append-only immutable log
//   projection: ProjectionStorage — read-optimized SQLite query layer
//   projector:  Projector         — derives projection rows from chain entries
//   validity:   ValidityStateMachine — tracks projection integrity state

const config = {
  chain,        // implements appendEntry(entry) => CommittedEntry
  projection,   // implements query(), queryOne(), getMetadata(), setMetadata()
  projector,    // implements projectPending()
  validity,     // implements currentState(), verifyOnStartup()
};

// Create adapters
const checkpointer = new LimenCheckpointSaver(config);
const store = new LimenStore(config);

// MUST call start() in this order — checkpointer creates the schema that store depends on
await checkpointer.start();
await store.start();  // Requires checkpointer.start() to have run first

// Wire into LangGraph
const graph = new StateGraph({ channels: { messages: { value: [] } } })
  .addNode('agent', agentNode)
  .addEdge('__start__', 'agent')
  .compile({ checkpointer, store });

// Invoke with thread isolation
const result = await graph.invoke(
  { messages: [{ role: 'user', content: 'hello' }] },
  { configurable: { thread_id: 'thread-001' } }
);

// Cleanup when done
await checkpointer.stop();
await store.stop();
```

## Configuration

Both `LimenCheckpointSaver` and `LimenStore` accept `LimenCheckpointerConfig`:

```typescript
interface LimenCheckpointerConfig {
  chain: ChainStorage;           // Required — append-only chain
  projection: ProjectionStorage; // Required — projection query layer
  projector: Projector;          // Required — chain-to-projection derivation
  validity: ValidityStateMachine;// Required — projection integrity state

  serde?: SerializerProtocol;    // Default: JsonPlusSerializer (handles Date, Set, Map, BigInt)
  governed?: boolean;            // Default: false — see Governance Modes below
  tenantScope?: string;          // Default: '__default__' — multi-tenant isolation key
  logger?: LimenCheckpointLogger;// Default: console.warn wrapper
}
```

## Governance Modes

The `governed` flag controls how strictly the adapter enforces projection validity before serving reads.

### `governed: false` (default)

Reads proceed when validity state is `Verified` or `Lagging`. Use this for development, non-critical workloads, or when eventual consistency is acceptable.

### `governed: true`

Reads require `Verified` state only. Any other state (including `Lagging`) throws `LimenGovernanceError`. Use this for production workloads where you need guaranteed projection integrity — no stale or unverified data served.

Both modes block reads entirely when state is `Unverified` or `Divergent`.

## Multi-Tenant Isolation

Set `tenantScope` to partition data per tenant. Each checkpoint and store item is scoped to its tenant — queries never cross boundaries.

Override per-request via `configurable.limen_tenant_scope`:

```typescript
await graph.invoke(input, {
  configurable: {
    thread_id: 'thread-001',
    limen_tenant_scope: 'tenant-acme',
  },
});
```

## Error Handling

### Error Classes

| Error | Retryable | When |
|-------|-----------|------|
| `LimenGovernanceError` | Check `.retryable` | Read blocked by validity state |
| `LimenStorageError` | No | Chain/projection infrastructure failure |
| `LimenSerdeError` | No | Serialization/deserialization failure |
| `LimenNotStartedError` | No | Method called before `start()` |

### Retry Logic

```typescript
import { LimenGovernanceError } from '@limen-ai/langgraph';

try {
  const result = await graph.invoke(input, config);
} catch (err) {
  if (err instanceof LimenGovernanceError) {
    if (err.retryable) {
      // State is Lagging or Rebuilding — projection is catching up.
      // Wait briefly, then retry. Projector will resolve the lag.
      await delay(100);
      // retry...
    } else {
      // State is Divergent or Unverified — requires manual intervention.
      // Projection integrity is compromised. Rebuild or investigate.
      console.error(`Non-retryable governance rejection: ${err.state}`);
    }
  }
}
```

### Validity States

| State | Meaning | `governed: false` | `governed: true` |
|-------|---------|-------------------|------------------|
| `Verified` | Projection matches chain | Reads allowed | Reads allowed |
| `Lagging` | Projection behind chain | Reads allowed | **Blocked** (retryable) |
| `Unverified` | Integrity unknown | **Blocked** (retryable) | **Blocked** (retryable) |
| `Divergent` | Projection corrupted | **Blocked** (not retryable) | **Blocked** (not retryable) |
| `Rebuilding` | Projection rebuilding | **Blocked** (retryable) | **Blocked** (retryable) |

## Lifecycle

1. **Construct** — `new LimenCheckpointSaver(config)` / `new LimenStore(config)`
2. **Start** — `await adapter.start()` — verifies infrastructure, checks schema version, runs validity verification. Idempotent. **Important:** `checkpointer.start()` must be called before `store.start()` — the checkpointer creates the projection schema that the store depends on.
3. **Use** — all LangGraph operations available
4. **Stop** — `await adapter.stop()` — flushes pending work, releases resources. Terminal — create a new instance to restart.

## Limitations

- **No semantic search** — `LimenStore.search()` with a `query` string throws. Filter-based search only.
- **No vector indexing** — the `index` field on put operations is accepted but not used for similarity.
- **Scan cap** — `list()`, `search()`, and `listNamespaces()` are bounded to 50,000 rows maximum.
- **Synchronous projection** — writes call `projectPending()` inline. Write latency includes projection time.

## Testing

```bash
npm install @langchain/langgraph-checkpoint  # peer dep required for full suite
npm test
```

271 tests across 7 files covering all design claims and 15 failure modes. Tests reference numbered claims (e.g., "Claim 2.1", "F-LG-003") from the internal design specification.

## License

BUSL-1.1
