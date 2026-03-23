/**
 * Forward-only migration for Phase 5A (LLM HTTP Transport — Deliberation).
 * S ref: C-05 (forward-only migrations), C-09 (namespace prefixes)
 *
 * Phase: 5A (Sprint 5A — Shared Transport Infrastructure)
 * Migration version: 31 (Phase 2 uses v7, Phase 3 v8-v9, WMP v30)
 *
 * Alters:
 *   meter_interaction_accounting — 6 new columns for deliberation tracking:
 *     deliberation_tokens, deliberation_accounting_mode,
 *     provider_deliberation_tokens, effective_deliberation_tokens,
 *     estimator_id, estimator_version
 *
 *   core_llm_request_log — 1 new column:
 *     deliberation_tokens
 *
 * Total: 7 columns across 2 tables.
 *
 * Implements: §25.4 (LLM Gateway deliberation accounting), §25.6 (Resource Accounting)
 * CR-5: Thinking blocks → deliberation metrics with no thinking content in LlmResponse.content
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

// ─── Migration SQL ───

const MIGRATION_031_SQL = `
-- Migration 031: Transport Deliberation columns
-- S ref: §25.4 (LLM Gateway), §25.6 (Resource Accounting)
-- Phase 5A: Shared Transport Infrastructure + Anthropic Adapter
-- Invariants: I-03 (audit in same transaction), I-05 (transactional consistency)
-- Constraints: C-05 (forward-only), C-09 (namespace prefixes)

-- ══════════════════════════════════════════════════════════════
-- ALTER: meter_interaction_accounting
-- 6 new columns for deliberation tracking.
-- deliberation_tokens: number of deliberation/thinking tokens consumed
-- deliberation_accounting_mode: 'provider_authoritative' | 'estimated'
-- provider_deliberation_tokens: raw provider-reported deliberation tokens
-- effective_deliberation_tokens: max(deliberation_tokens, provider_deliberation_tokens ?? 0)
-- estimator_id: identifier for the estimation algorithm (NULL for now)
-- estimator_version: version of the estimation algorithm (NULL for now)
-- ══════════════════════════════════════════════════════════════
ALTER TABLE meter_interaction_accounting ADD COLUMN deliberation_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meter_interaction_accounting ADD COLUMN deliberation_accounting_mode TEXT NOT NULL DEFAULT 'estimated'
  CHECK(deliberation_accounting_mode IN ('provider_authoritative', 'estimated'));
ALTER TABLE meter_interaction_accounting ADD COLUMN provider_deliberation_tokens INTEGER;
ALTER TABLE meter_interaction_accounting ADD COLUMN effective_deliberation_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meter_interaction_accounting ADD COLUMN estimator_id TEXT;
ALTER TABLE meter_interaction_accounting ADD COLUMN estimator_version TEXT;

-- ══════════════════════════════════════════════════════════════
-- ALTER: core_llm_request_log
-- 1 new column for deliberation token count on the request log.
-- Allows querying which requests involved model thinking/deliberation.
-- ══════════════════════════════════════════════════════════════
ALTER TABLE core_llm_request_log ADD COLUMN deliberation_tokens INTEGER;
`;

// ─── Build Migration Entry ───

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

/**
 * Get Phase 5A (Transport Deliberation) migration.
 * S ref: C-05 (forward-only), C-09 (namespace prefixes)
 *
 * Version 31 continues from WMP's version 30.
 * Alters 2 existing tables, adds 7 columns total.
 */
export function getTransportDeliberationMigration(): MigrationEntry[] {
  return [
    buildEntry(31, 'transport_deliberation', MIGRATION_031_SQL),
  ];
}
