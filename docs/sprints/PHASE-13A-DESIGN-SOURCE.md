# Phase 13A: Types + HLC + Event Log — Design Source

**Date**: 2026-04-03
**Criticality**: Tier 2 with Tier 1 inheritance (causal ordering affects governance)
**Governing**: LIMEN_BUILD_PHASES.md (Phase 13), LIMEN_DISTRIBUTED_SYSTEMS_RESEARCH.md

---

## THE FIVE QUESTIONS

1. **What does the spec say?** Phase 13A establishes the foundation: distributed types, Hybrid Logical Clocks for causal ordering, and the sync event log. No actual sync yet — just the infrastructure.

2. **How can this fail?** HLC monotonicity violation (clock goes backward). Event log loses events. Schema migration breaks existing data. NodeId collision between instances.

3. **Downstream consequences?** Every subsequent sub-phase (13B-E) depends on HLC and the event log. Wrong HLC design means wrong causal ordering everywhere.

4. **Assumptions?** Wall clock drift between nodes is bounded (< 1 hour). NodeId is UUID-based (collision probability negligible). SQLite INTEGER sufficient for HLC counter.

5. **Hostile reviewer?** "HLC is overkill for two nodes" → Correct for Phase 13A, but HLC scales to N nodes without redesign. Build once, use forever.

---

## OUTPUT 1: MODULE DECOMPOSITION

| Module | Location | Purpose |
|--------|----------|---------|
| Sync Types | `src/sync/interfaces/sync_types.ts` | All distributed type definitions |
| HLC | `src/sync/hlc/hybrid_logical_clock.ts` | Causal ordering — tick, send, receive, compare |
| Event Store | `src/sync/stores/sync_event_store.ts` | Append-only sync event log CRUD |
| Migration | `src/api/migration/037_sync_foundation.ts` | v46: 3 new tables + HLC columns on claims/relationships |

## OUTPUT 2: TYPE ARCHITECTURE

```typescript
// Branded types
export type NodeId = string & { readonly __brand: 'NodeId' };

// HLC
export interface HybridTimestamp {
  readonly wallMs: number;      // physical time (ms since epoch)
  readonly counter: number;     // logical counter (increments on ties)
  readonly nodeId: NodeId;      // originating node
}

// Sync events
export type SyncEventType =
  | 'claim_created' | 'claim_retracted'
  | 'relationship_created'
  | 'governance_update';

export interface SyncEvent {
  readonly eventId: string;
  readonly sourceNodeId: NodeId;
  readonly hlc: HybridTimestamp;
  readonly eventType: SyncEventType;
  readonly payload: Record<string, unknown>;
  readonly tenantId: string | null;
  readonly createdAt: string;
}

// Peer tracking
export interface SyncPeerState {
  readonly peerNodeId: NodeId;
  readonly lastReceivedWall: number;
  readonly lastReceivedCounter: number;
  readonly lastSyncAt: string;
  readonly status: 'active' | 'disconnected';
}

// Configuration
export interface SyncConfig {
  readonly enabled: boolean;
  readonly nodeId?: NodeId;  // auto-generated if absent
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = { enabled: false };
```

## OUTPUT 3: STATE MACHINES

HLC is stateless per-call (pure function). Event log is append-only (no state transitions). Peer state has: `active ↔ disconnected` (based on last_sync_at age).

## OUTPUT 4: SYSTEM-CALL MAPPING

ZERO new system calls. HLC wraps TimeProvider. Event store is internal infrastructure.

## OUTPUT 5: ERROR TAXONOMY

| Code | When |
|------|------|
| `SYNC_NOT_ENABLED` | Sync operation when config.enabled = false |
| `HLC_CLOCK_DRIFT` | Wall clock drift > 1 hour between nodes |
| `SYNC_EVENT_DUPLICATE` | Same eventId already in log |

## OUTPUT 6: SCHEMA (Migration v46)

```sql
-- Node identity
CREATE TABLE IF NOT EXISTS sync_node_config (
  node_id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL
);

-- Sync event log (append-only)
CREATE TABLE IF NOT EXISTS sync_event_log (
  event_id TEXT PRIMARY KEY NOT NULL,
  source_node_id TEXT NOT NULL,
  hlc_wall INTEGER NOT NULL,
  hlc_counter INTEGER NOT NULL,
  hlc_node TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  tenant_id TEXT,
  created_at TEXT NOT NULL,
  delivered_to TEXT DEFAULT NULL,  -- JSON array of peer node IDs
  delivery_status TEXT NOT NULL DEFAULT 'pending'
);

-- Peer state tracking
CREATE TABLE IF NOT EXISTS sync_peer_state (
  peer_node_id TEXT PRIMARY KEY NOT NULL,
  last_received_wall INTEGER NOT NULL DEFAULT 0,
  last_received_counter INTEGER NOT NULL DEFAULT 0,
  last_sync_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

-- HLC columns on claims (origin tracking)
ALTER TABLE claim_assertions ADD COLUMN origin_node_id TEXT DEFAULT 'local';
ALTER TABLE claim_assertions ADD COLUMN hlc_wall INTEGER DEFAULT 0;
ALTER TABLE claim_assertions ADD COLUMN hlc_counter INTEGER DEFAULT 0;

-- HLC columns on relationships
ALTER TABLE claim_relationships ADD COLUMN origin_node_id TEXT DEFAULT 'local';
ALTER TABLE claim_relationships ADD COLUMN hlc_wall INTEGER DEFAULT 0;
ALTER TABLE claim_relationships ADD COLUMN hlc_counter INTEGER DEFAULT 0;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sync_events_status ON sync_event_log(delivery_status, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_events_type ON sync_event_log(event_type, tenant_id);
```

## OUTPUT 7: CROSS-PHASE INTEGRATION

Depends on: TimeProvider (Phase 0), DatabaseConnection (Phase 0).
Enables: Phase 13B (sync protocol), 13C (governance replication), 13D (conflicts), 13E (federation).

## OUTPUT 8: ASSURANCE MAPPING

| Element | Class |
|---------|-------|
| HLC monotonicity | CONSTITUTIONAL |
| HLC causal ordering (receive merges correctly) | CONSTITUTIONAL |
| Event log append-only | CONSTITUTIONAL |
| Migration additive | CONSTITUTIONAL |
| NodeId uniqueness | CONSTITUTIONAL |
| Default sync disabled (backward compat) | CONSTITUTIONAL |

---

*SolisHQ — We innovate, invent, then disrupt.*
