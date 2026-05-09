/**
 * Migration v47: Sync Foundation.
 * Phase 13A: Node identity, sync event log, peer state, HLC columns.
 *
 * Spec ref: PHASE-13A-DESIGN-SOURCE.md (Output 6)
 *
 * Schema changes:
 *   1. CREATE TABLE sync_node_config (node identity — single row)
 *   2. CREATE TABLE sync_event_log (append-only event log)
 *   3. CREATE TABLE sync_peer_state (peer watermark tracking)
 *   4. ALTER TABLE claim_assertions ADD COLUMN origin_node_id, hlc_wall, hlc_counter
 *   5. ALTER TABLE claim_relationships ADD COLUMN origin_node_id, hlc_wall, hlc_counter
 *   6. Indexes for sync query patterns
 *
 * Additive only. No drops. No column modifications to existing columns.
 * Existing data gets 'local' origin_node_id and 0 HLC values (safe defaults).
 *
 * Invariants:
 *   - DC-P13A-601: Migration is strictly additive
 *   - DC-P13A-602: Existing data remains intact with safe defaults
 *   - DEFAULT_SYNC_CONFIG.enabled = false ensures backward compatibility
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_047_SQL = `
-- Migration 047: Sync Foundation
-- Phase 13A: Node identity, sync event log, peer state, HLC columns
-- Spec ref: PHASE-13A-DESIGN-SOURCE.md (Output 6)

-- ============================================================================
-- 1. Node identity.
-- Single-row table storing this engine instance's unique node ID.
-- Auto-generated UUID on first sync init. Never changes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_node_config (
  node_id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL
);

-- ============================================================================
-- 2. Sync event log (append-only).
-- Records all local mutations for replication to peers.
-- delivery_status tracks which events need to be sent.
-- delivered_to is a JSON array of peer node IDs that received this event.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_event_log (
  event_id TEXT PRIMARY KEY NOT NULL,
  source_node_id TEXT NOT NULL,
  hlc_wall INTEGER NOT NULL,
  hlc_counter INTEGER NOT NULL,
  hlc_node TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('claim_created','claim_retracted','relationship_created','governance_update')),
  payload TEXT NOT NULL,
  tenant_id TEXT,
  created_at TEXT NOT NULL,
  delivered_to TEXT DEFAULT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','delivered','failed'))
);

-- ============================================================================
-- 3. Peer state tracking.
-- Watermark per peer: last HLC received. Used for catch-up sync.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_peer_state (
  peer_node_id TEXT PRIMARY KEY NOT NULL,
  last_received_wall INTEGER NOT NULL DEFAULT 0,
  last_received_counter INTEGER NOT NULL DEFAULT 0,
  last_sync_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disconnected'))
);

-- ============================================================================
-- 4. HLC columns on claim_assertions (origin tracking).
-- DEFAULT 'local' for existing rows — backward compatible.
-- ============================================================================

ALTER TABLE claim_assertions ADD COLUMN origin_node_id TEXT DEFAULT 'local';
ALTER TABLE claim_assertions ADD COLUMN hlc_wall INTEGER DEFAULT 0;
ALTER TABLE claim_assertions ADD COLUMN hlc_counter INTEGER DEFAULT 0;

-- ============================================================================
-- 5. HLC columns on claim_relationships (origin tracking).
-- DEFAULT 'local' for existing rows — backward compatible.
-- ============================================================================

ALTER TABLE claim_relationships ADD COLUMN origin_node_id TEXT DEFAULT 'local';
ALTER TABLE claim_relationships ADD COLUMN hlc_wall INTEGER DEFAULT 0;
ALTER TABLE claim_relationships ADD COLUMN hlc_counter INTEGER DEFAULT 0;

-- ============================================================================
-- 6. Indexes.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sync_events_status ON sync_event_log(delivery_status, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_events_type ON sync_event_log(event_type, tenant_id);
CREATE INDEX IF NOT EXISTS idx_sync_events_hlc ON sync_event_log(hlc_wall, hlc_counter);
CREATE INDEX IF NOT EXISTS idx_assertions_origin ON claim_assertions(origin_node_id);
CREATE INDEX IF NOT EXISTS idx_relationships_origin ON claim_relationships(origin_node_id);
`;

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

export function getSyncFoundationMigrations(): MigrationEntry[] {
  return [buildEntry(47, 'sync_foundation', MIGRATION_047_SQL)];
}
