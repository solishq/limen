// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AGENT_COORDINATION_GOVERNANCE.md §6
/**
 * Distributed Sync Engine — HLC timestamps, peer management, hash-chained event log.
 *
 * Implements: CO-6.1 through CO-6.32, CO-11.10 through CO-11.14,
 *             CO-12.4, CO-12.5, CO-12.10
 *
 * HLC causal ordering (CO-12.4): physical clock + logical counter + nodeId.
 * Sync log is append-only and hash-chained (CO-12.5).
 * Conflict resolution configurable per tenant (CO-12.10).
 * Default: last-writer-wins by HLC (CO-6.23).
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Result, OperationContext, TenantId } from '../kernel/interfaces/index.js';
import type { DatabaseConnection } from '../kernel/interfaces/database.js';
import type { AuditTrail } from '../kernel/interfaces/audit.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type {
  HLCTimestamp, SyncEvent, SyncEventPayload, SyncEventType,
  SyncState, PeerRegistration, PeerState, Watermark,
  SyncOptions, SyncResult, SyncLogOptions,
} from './coordination_types.js';
import {
  DEFAULT_SYNC_LOG_LIMIT, MAX_SYNC_LOG_LIMIT,
} from './coordination_types.js';
import {
  syncPeerNotFound,
} from './coordination_errors.js';
import type { AgentCoordinationError } from './coordination_errors.js';

// ── Result helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function errResult<T>(error: AgentCoordinationError): Result<T> {
  return { ok: false, error: { code: error.code, message: error.message, spec: error.spec } };
}

// ============================================================================
// HLC Clock
// ============================================================================

/**
 * CO-6.1, CO-12.4: Generate an HLC timestamp.
 * Ensures monotonicity: if wall clock hasn't advanced, increment logical counter.
 */
export function generateHLC(nodeId: string, time: TimeProvider, lastHLC?: HLCTimestamp | null): HLCTimestamp {
  const physicalNow = time.nowMs();

  if (!lastHLC) {
    return Object.freeze({ physical: physicalNow, logical: 0, nodeId });
  }

  if (physicalNow > lastHLC.physical) {
    return Object.freeze({ physical: physicalNow, logical: 0, nodeId });
  }

  // Wall clock hasn't advanced — increment logical
  return Object.freeze({
    physical: lastHLC.physical,
    logical: lastHLC.logical + 1,
    nodeId,
  });
}

// ============================================================================
// Hash Chain (CO-6.6, CO-6.7, CO-6.9)
// ============================================================================

/**
 * CO-6.9: Compute event hash from canonical serialization.
 * Hash = SHA-256({id, type, hlcTimestamp, tenantId, payload, previousHash})
 */
export function computeEventHash(
  id: string,
  type: SyncEventType,
  hlcTimestamp: HLCTimestamp,
  tenantId: TenantId,
  payload: SyncEventPayload,
  previousHash: string,
): string {
  const canonical = JSON.stringify({
    id, type, hlcTimestamp, tenantId, payload, previousHash,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verify hash chain integrity for a sequence of events.
 * CO-12.5: Each event's hash includes the previous event's hash.
 */
export function verifyHashChain(events: readonly SyncEvent[]): boolean {
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!;
    const curr = events[i]!;
    if (curr.previousHash !== prev.hash) return false;

    // Recompute hash to verify integrity
    const expectedHash = computeEventHash(
      curr.id, curr.type, curr.hlcTimestamp, curr.tenantId, curr.payload, curr.previousHash,
    );
    if (curr.hash !== expectedHash) return false;
  }
  return true;
}

// ============================================================================
// Sync Engine Operations
// ============================================================================

export interface SyncEngineDeps {
  readonly conn: DatabaseConnection;
  readonly audit: AuditTrail;
  readonly time: TimeProvider;
  readonly nodeId: string;
}

/**
 * CO-11.10: Get current sync state — local node state + peer watermarks.
 */
export function getSyncState(
  deps: SyncEngineDeps,
  ctx: OperationContext,
): Result<SyncState> {
  const { conn, nodeId } = deps;

  // Get peers
  const peerRows = conn.query<{
    id: string; node_id: string; endpoint: string; status: string;
    last_seen_at: string; last_synced_at: string | null;
    watermark_physical: number | null; watermark_logical: number | null; watermark_node_id: string | null;
    pending_outbound: number; failed_attempts: number;
  }>(
    `SELECT * FROM coordination_sync_peers WHERE tenant_id = ?`,
    [ctx.tenantId],
  );

  const peers: PeerState[] = peerRows.map(r => Object.freeze({
    peerId: r.id,
    nodeId: r.node_id,
    endpoint: r.endpoint,
    status: r.status as PeerState['status'],
    lastSeenAt: r.last_seen_at,
    lastSyncedAt: r.last_synced_at,
    watermark: r.watermark_physical !== null ? Object.freeze({
      physical: r.watermark_physical,
      logical: r.watermark_logical ?? 0,
      nodeId: r.watermark_node_id ?? '',
    }) : null,
    pendingOutbound: r.pending_outbound,
    failedAttempts: r.failed_attempts,
  }));

  // Get watermarks
  const watermarks: Watermark[] = peerRows
    .filter(r => r.watermark_physical !== null)
    .map(r => Object.freeze({
      peerId: r.id,
      hlcTimestamp: Object.freeze({
        physical: r.watermark_physical!,
        logical: r.watermark_logical ?? 0,
        nodeId: r.watermark_node_id ?? '',
      }),
      confirmedAt: r.last_synced_at ?? r.last_seen_at,
    }));

  // Get pending events count
  const pendingRow = conn.get<{ count: number }>(
    `SELECT COUNT(*) as count FROM coordination_sync_events WHERE tenant_id = ?`,
    [ctx.tenantId],
  );
  const pendingEvents = pendingRow?.count ?? 0;

  // Get last sync timestamp
  const lastSyncRow = conn.get<{ last_synced_at: string }>(
    `SELECT MAX(last_synced_at) as last_synced_at FROM coordination_sync_peers WHERE tenant_id = ? AND last_synced_at IS NOT NULL`,
    [ctx.tenantId],
  );

  // Verify hash chain
  const allEvents = conn.query<SyncEventRow>(
    `SELECT * FROM coordination_sync_events WHERE tenant_id = ? ORDER BY physical_ts, logical_ts, node_id`,
    [ctx.tenantId],
  );
  const chainValid = allEvents.length === 0 || verifyStoredHashChain(allEvents);

  return ok(Object.freeze({
    nodeId,
    tenantId: ctx.tenantId as TenantId,
    peers: Object.freeze(peers),
    lastSyncAt: lastSyncRow?.last_synced_at ?? null,
    pendingEvents,
    watermarks: Object.freeze(watermarks),
    hashChainValid: chainValid,
  }));
}

interface SyncEventRow {
  id: string;
  type: string;
  physical_ts: number;
  logical_ts: number;
  node_id: string;
  tenant_id: string;
  payload: string;
  hash: string;
  previous_hash: string;
}

function verifyStoredHashChain(rows: readonly SyncEventRow[]): boolean {
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.previous_hash !== rows[i - 1]!.hash) return false;
  }
  return true;
}

/**
 * CO-11.11: Register a peer for sync.
 */
export function registerPeer(
  deps: SyncEngineDeps,
  ctx: OperationContext,
  peer: PeerRegistration,
): Result<string> {
  const { conn, audit, time } = deps;
  const peerId = randomUUID();
  const now = time.nowISO();

  conn.transaction(() => {
    conn.run(
      `INSERT INTO coordination_sync_peers
       (id, node_id, endpoint, tenant_id, capabilities, max_batch_size, status,
        last_seen_at, last_synced_at, watermark_physical, watermark_logical, watermark_node_id,
        pending_outbound, failed_attempts)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL, NULL, NULL, 0, 0)`,
      [peerId, peer.nodeId, peer.endpoint, ctx.tenantId,
       JSON.stringify(peer.capabilities), peer.maxBatchSize, now],
    );

    audit.append(conn, {
      tenantId: ctx.tenantId,
      actorType: 'agent',
      actorId: ctx.agentId ?? 'system',
      operation: 'register_peer',
      resourceType: 'sync_peer',
      resourceId: peerId,
    });
  });

  return ok(peerId);
}

/**
 * CO-11.12: Remove a peer — mark deregistered, flush pending outbound.
 */
export function removePeer(
  deps: SyncEngineDeps,
  ctx: OperationContext,
  peerId: string,
): Result<void> {
  const { conn, audit } = deps;

  const existing = conn.get<{ id: string }>(
    `SELECT id FROM coordination_sync_peers WHERE id = ? AND tenant_id = ?`,
    [peerId, ctx.tenantId],
  );
  if (!existing) return errResult(syncPeerNotFound(peerId));

  conn.transaction(() => {
    conn.run(
      `UPDATE coordination_sync_peers SET status = 'deregistered', pending_outbound = 0 WHERE id = ?`,
      [peerId],
    );

    audit.append(conn, {
      tenantId: ctx.tenantId,
      actorType: 'agent',
      actorId: ctx.agentId ?? 'system',
      operation: 'remove_peer',
      resourceType: 'sync_peer',
      resourceId: peerId,
    });
  });

  return ok(undefined);
}

/**
 * CO-11.13: Trigger sync — push/pull events since peer watermark.
 * In embedded single-node mode, this records the sync attempt.
 * Actual peer communication would happen in a multi-node deployment.
 */
export function triggerSync(
  deps: SyncEngineDeps,
  ctx: OperationContext,
  options?: SyncOptions,
): Result<SyncResult> {
  const { conn, audit, time } = deps;
  const syncNow = time.nowISO();
  const startMs = time.nowMs();

  const direction = options?.direction ?? 'bidirectional';

  // Get active peers
  const targetPeerIds = options?.targetPeers;
  const peerQuery = targetPeerIds && targetPeerIds.length > 0
    ? `SELECT * FROM coordination_sync_peers WHERE tenant_id = ? AND status = 'active' AND id IN (${targetPeerIds.map(() => '?').join(',')})`
    : `SELECT * FROM coordination_sync_peers WHERE tenant_id = ? AND status = 'active'`;
  const peerParams = targetPeerIds && targetPeerIds.length > 0
    ? [ctx.tenantId, ...targetPeerIds]
    : [ctx.tenantId];
  const peers = conn.query<{ id: string; node_id: string; status: string }>(peerQuery, peerParams);

  const peersContacted = peers.length;
  const peersUnreachable: string[] = [];
  const watermarksAdvanced: Watermark[] = [];

  // In embedded mode, sync is a local operation. Record the sync event.
  const syncId = randomUUID();

  conn.transaction(() => {
    // Update last_synced_at on contacted peers
    for (const peer of peers) {
      conn.run(
        `UPDATE coordination_sync_peers SET last_synced_at = ?, last_seen_at = ? WHERE id = ?`,
        [syncNow, syncNow, peer.id],
      );
    }

    audit.append(conn, {
      tenantId: ctx.tenantId,
      actorType: 'agent',
      actorId: ctx.agentId ?? 'system',
      operation: 'trigger_sync',
      resourceType: 'sync',
      resourceId: syncId,
    });
  });

  const durationMs = time.nowMs() - startMs;

  return ok(Object.freeze({
    syncId,
    direction,
    eventsPushed: 0,
    eventsPulled: 0,
    conflictsResolved: 0,
    conflictsUnresolved: 0,
    peersContacted,
    peersUnreachable: Object.freeze(peersUnreachable),
    watermarksAdvanced: Object.freeze(watermarksAdvanced),
    duration: durationMs,
    completedAt: syncNow,
  }));
}

/**
 * CO-11.14: Get sync log — SELECT from append-only sync_events table.
 */
export function getSyncLog(
  deps: SyncEngineDeps,
  ctx: OperationContext,
  options?: SyncLogOptions,
): Result<SyncEvent[]> {
  const { conn } = deps;
  const limit = Math.min(options?.limit ?? DEFAULT_SYNC_LOG_LIMIT, MAX_SYNC_LOG_LIMIT);
  const offset = options?.offset ?? 0;

  let sql = `SELECT * FROM coordination_sync_events WHERE tenant_id = ?`;
  const params: unknown[] = [ctx.tenantId];

  if (options?.type) {
    sql += ' AND type = ?';
    params.push(options.type);
  }

  // BRK-CO-013: Include nodeId in HLC comparisons for total ordering
  if (options?.since) {
    sql += ' AND (physical_ts > ? OR (physical_ts = ? AND logical_ts > ?) OR (physical_ts = ? AND logical_ts = ? AND node_id > ?))';
    params.push(options.since.physical, options.since.physical, options.since.logical,
      options.since.physical, options.since.logical, options.since.nodeId);
  }

  if (options?.until) {
    sql += ' AND (physical_ts < ? OR (physical_ts = ? AND logical_ts < ?) OR (physical_ts = ? AND logical_ts = ? AND node_id < ?))';
    params.push(options.until.physical, options.until.physical, options.until.logical,
      options.until.physical, options.until.logical, options.until.nodeId);
  }

  sql += ' ORDER BY physical_ts, logical_ts, node_id LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = conn.query<SyncEventRow>(sql, params);

  const events: SyncEvent[] = rows.map(r => Object.freeze({
    id: r.id,
    type: r.type as SyncEventType,
    hlcTimestamp: Object.freeze({
      physical: r.physical_ts,
      logical: r.logical_ts,
      nodeId: r.node_id,
    }),
    tenantId: r.tenant_id as TenantId,
    payload: JSON.parse(r.payload) as SyncEventPayload,
    hash: r.hash,
    previousHash: r.previous_hash,
  }));

  return ok(events);
}

/**
 * Append a sync event to the hash-chained log.
 * CO-12.5: Each event's hash includes the previous hash.
 */
export function appendSyncEvent(
  deps: SyncEngineDeps,
  ctx: OperationContext,
  type: SyncEventType,
  payload: SyncEventPayload,
): Result<SyncEvent> {
  const { conn, time, nodeId } = deps;
  const id = randomUUID();

  // Get the last event's hash for chaining
  const lastEvent = conn.get<{ hash: string }>(
    `SELECT hash FROM coordination_sync_events WHERE tenant_id = ? ORDER BY physical_ts DESC, logical_ts DESC LIMIT 1`,
    [ctx.tenantId],
  );
  const previousHash = lastEvent?.hash ?? '0000000000000000000000000000000000000000000000000000000000000000';

  // Get last HLC for this node
  const lastHlcRow = conn.get<{ physical_ts: number; logical_ts: number; node_id: string }>(
    `SELECT physical_ts, logical_ts, node_id FROM coordination_sync_events WHERE tenant_id = ? AND node_id = ? ORDER BY physical_ts DESC, logical_ts DESC LIMIT 1`,
    [ctx.tenantId, nodeId],
  );
  const lastHLC: HLCTimestamp | null = lastHlcRow ? {
    physical: lastHlcRow.physical_ts,
    logical: lastHlcRow.logical_ts,
    nodeId: lastHlcRow.node_id,
  } : null;

  const hlc = generateHLC(nodeId, time, lastHLC);
  const hash = computeEventHash(id, type, hlc, ctx.tenantId as TenantId, payload, previousHash);

  conn.run(
    `INSERT INTO coordination_sync_events
     (id, type, physical_ts, logical_ts, node_id, tenant_id, payload, hash, previous_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, type, hlc.physical, hlc.logical, hlc.nodeId, ctx.tenantId,
     JSON.stringify(payload), hash, previousHash],
  );

  return ok(Object.freeze({
    id,
    type,
    hlcTimestamp: hlc,
    tenantId: ctx.tenantId as TenantId,
    payload,
    hash,
    previousHash,
  }));
}
