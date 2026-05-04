# Migration Guide: LangGraph to Limen Adapter

Migrate from LangGraph's built-in persistence to governed Limen storage.

---

## 1. From MemorySaver

**Before:**

```typescript
import { MemorySaver } from '@langchain/langgraph';

const checkpointer = new MemorySaver();
const graph = builder.compile({ checkpointer });
```

**After:**

```typescript
import { LimenCheckpointSaver } from '@limen-ai/langgraph';

const checkpointer = new LimenCheckpointSaver({
  chain, projection, projector, validity,
});
await checkpointer.start();
const graph = builder.compile({ checkpointer });
```

**Key differences:**
- Requires `start()` before use and `stop()` on shutdown.
- State persists across process restarts (chain-backed, not in-memory).
- Checkpoint migration from MemorySaver requires re-serialization (Claim 2.30) -- MemorySaver stores objects in memory without `type_tag`.
- `putWrites` uses INSERT OR REPLACE (last-wins on retry) vs MemorySaver's INSERT OR IGNORE (first-wins). See Claim 2.29.

---

## 2. From SQLiteSaver

**Before:**

```typescript
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

const checkpointer = SqliteSaver.fromConnString('./state.db');
const graph = builder.compile({ checkpointer });
```

**After:**

```typescript
import { LimenCheckpointSaver } from '@limen-ai/langgraph';

const checkpointer = new LimenCheckpointSaver({
  chain, projection, projector, validity,
  governed: false, // Match SQLiteSaver's no-governance behavior
});
await checkpointer.start();
const graph = builder.compile({ checkpointer });
```

**Key differences:**
- Limen splits storage: immutable chain (writes) + projection (reads). SQLiteSaver uses a single mutable database.
- All writes are append-only and tamper-evident. Chain entries are never modified.
- Governance gate controls read access based on projection validity state.
- Schema is different -- direct SQLite migration not supported. Replay chain entries to rebuild.
- `putWrites` behavior is identical (both use INSERT OR REPLACE).

---

## 3. What You Gain and Lose

| Capability | Native LangGraph | Limen Adapter |
|------------|-----------------|---------------|
| **Audit trail** | None | Append-only chain with global sequencing |
| **Tamper detection** | None | Digest verification + tamper triggers (Claim 1.5) |
| **Multi-tenant isolation** | Manual | Structural via PK (Claim 5.4) |
| **Governance gates** | None | Fail-closed reads based on projection validity |
| **Semantic search** | Provider-dependent | Not supported (Claim 3.13) |
| **Vector indexing** | Provider-dependent | Not supported (index stored, not used) |
| **Sync execution** | Supported | Not supported -- async only |
| **In-memory mode** | MemorySaver | Not available -- requires chain + projection |
| **Setup complexity** | Zero config | Requires Limen engine (chain, projection, projector, validity) |
| **Write latency** | Direct SQLite | Chain append + synchronous projectPending() |
| **Data recovery** | Backup/restore | Rebuild any projection from chain replay |

**When to migrate:** You need audit trails, tamper detection, multi-tenant isolation, or governed reads. You are running production workloads where data integrity matters.

**When to stay:** You need semantic search, vector indexing, sync execution, or zero-config development. MemorySaver remains ideal for prototyping and tests.
