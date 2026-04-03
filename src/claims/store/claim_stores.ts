/**
 * CCP (Claim Protocol) Store Implementations — SQLite-backed.
 * Replaces NotImplementedError stubs in claim_harness.ts.
 *
 * Phase: 1 (CCP)
 * Implements: ClaimStore, ClaimEvidenceStore, ClaimRelationshipStore,
 *   ClaimArtifactRefStore, AssertClaimHandler, RetractClaimHandler,
 *   RelateClaimsHandler, QueryClaimsHandler, GroundingValidator,
 *   ClaimLifecycleProjection.
 *
 * Pattern: Follows src/governance/stores/governance_stores.ts exactly.
 *
 * Truth model obligations:
 *   CCP-I1: Content immutability (trigger-enforced)
 *   CCP-I2: Forward-only lifecycle (trigger-enforced)
 *   CCP-I5: Evidence provenance chain
 *   CCP-I6: Relationship integrity (append-only, trigger-enforced)
 *   CCP-I9: Audit sufficiency (every mutation audited in same transaction)
 *   CCP-I10: Tombstone identity preservation
 *   CCP-I12: No kernel lifecycle consequence from relationships
 *   CCP-I13: Grounding cycle safety (visited-set traversal)
 *   CCP-I14: Retraction notification boundary (one-edge-deep)
 *   Binding 14: Trace event per lifecycle transition (same transaction)
 */

import { randomUUID, createHash } from 'node:crypto';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type {
  TenantId, AgentId, MissionId, TaskId, ArtifactId,
  OperationContext, Result,
} from '../../kernel/interfaces/index.js';
import type { CorrelationId, RunId } from '../../kernel/interfaces/governance_ids.js';
import type {
  ClaimStore, ClaimEvidenceStore, ClaimRelationshipStore, ClaimArtifactRefStore,
  AssertClaimHandler, RetractClaimHandler, RelateClaimsHandler, QueryClaimsHandler,
  GroundingValidator, ClaimLifecycleProjection,
  ClaimSystem, ClaimSystemDeps,
  Claim, ClaimId, ClaimTombstone, ClaimEvidence, ClaimRelationship,
  ClaimCreateInput, RetractClaimInput, RelationshipCreateInput, ClaimQueryInput,
  ClaimQueryResult, ClaimQueryResultItem,
  AssertClaimOutput, RelateClaimsOutput,
  GroundingResult, GroundingTraversalPath, GroundingStep,
  EvidenceRef, EvidenceType, RelationshipType, RelationshipId,
  GroundingMode, ClaimStatus, ClaimLifecycleState, SourceState,
  ObjectType, RuntimeWitnessInput,
  SearchClaimInput, SearchClaimResult, SearchClaimResultItem,
} from '../interfaces/claim_types.js';
import {
  CCP_TRACE_EVENTS, CCP_EVENTS,
  CLAIM_GROUNDING_MAX_HOPS, CLAIM_PER_MISSION_LIMIT, CLAIM_PER_ARTIFACT_LIMIT,
  CLAIM_MAX_EVIDENCE_REFS, CLAIM_MAX_OUTGOING_RELATIONSHIPS,
  CLAIM_QUERY_MAX_LIMIT, CLAIM_QUERY_DEFAULT_LIMIT, CLAIM_JSON_MAX_BYTES,
  CLAIM_RATE_LIMIT,
  SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT,
  VALID_RETRACTION_REASONS,
} from '../interfaces/claim_types.js';
import { analyzeQuery, sanitizeFts5Query } from '../../search/search_utils.js';
import { computeAgeMs, computeEffectiveConfidence } from '../../cognitive/decay.js';
import { computeCascadePenalty } from '../../cognitive/cascade.js';
import { detectStructuralConflicts } from '../../cognitive/conflict.js';
import { classifyFreshness } from '../../cognitive/freshness.js';
import { resolveStability } from '../../cognitive/stability.js';
import { scanClaimContent } from '../../security/claim_scanner.js';
import { checkPoisoning } from '../../security/poisoning_defense.js';
import { DEFAULT_SECURITY_POLICY } from '../../security/security_types.js';
import type { ContentScanResult } from '../../security/security_types.js';
import { classify } from '../../governance/classification/classification_engine.js';
import { checkPredicateGuard } from '../../governance/classification/predicate_guard.js';
import { DEFAULT_CLASSIFICATION_RULES } from '../../governance/classification/governance_types.js';

// ============================================================================
// Helpers
// ============================================================================

/** Phase 9: Cached detection of v42 security columns on claim_assertions. */
let _hasPiiDetectedCol: boolean | null = null;
function hasPiiDetectedColumn(conn: DatabaseConnection): boolean {
  if (_hasPiiDetectedCol !== null) return _hasPiiDetectedCol;
  try {
    const cols = conn.query<Record<string, unknown>>('PRAGMA table_info(claim_assertions)', []);
    _hasPiiDetectedCol = cols.some(c => c['name'] === 'pii_detected');
  } catch {
    _hasPiiDetectedCol = false;
  }
  return _hasPiiDetectedCol;
}
/** Phase 10: Cached detection of v43 governance columns on claim_assertions. */
let _hasClassificationCol: boolean | null = null;
function hasClassificationColumn(conn: DatabaseConnection): boolean {
  if (_hasClassificationCol !== null) return _hasClassificationCol;
  try {
    const cols = conn.query<Record<string, unknown>>('PRAGMA table_info(claim_assertions)', []);
    _hasClassificationCol = cols.some(c => c['name'] === 'classification');
  } catch {
    _hasClassificationCol = false;
  }
  return _hasClassificationCol;
}

/** Reset cache (for tests that create fresh databases). */
export function resetSecurityColumnCache(): void {
  _hasPiiDetectedCol = null;
  _hasClassificationCol = null;
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string, spec: string): Result<T> {
  return { ok: false, error: { code, message, spec } };
}

// nowISO() removed — Hard Stop #7: use deps.time.nowISO() instead

function newId(): string {
  return randomUUID();
}

/** DC-CCP-307: Compute idempotency hash from claim input payload */
function computeIdempotencyHash(input: ClaimCreateInput): string {
  const payload = JSON.stringify({
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    confidence: input.confidence,
    validAt: input.validAt,
    groundingMode: input.groundingMode,
    evidenceRefs: input.evidenceRefs,
  });
  return createHash('sha256').update(payload).digest('hex');
}

// ============================================================================
// Validation Helpers
// ============================================================================

/** Strict 3-segment URN: lowercase-alpha-prefix : type : identifier */
function isValidSubjectURN(subject: string): boolean {
  if (!subject || typeof subject !== 'string') return false;
  const parts = subject.split(':');
  if (parts.length !== 3) return false;
  const [seg0, seg1, seg2] = parts;
  // First segment must be lowercase alpha (entity, metric, etc.)
  if (!seg0 || !/^[a-z][a-z0-9_]*$/.test(seg0)) return false;
  // Second and third segments must be non-empty
  if (!seg1 || !seg2) return false;
  // No whitespace in any segment (CCP Design Source §6, BPB-002)
  if (/\s/.test(seg1) || /\s/.test(seg2)) return false;
  return true;
}

/** Strict 2-segment predicate: domain.property */
function isValidPredicate(predicate: string): boolean {
  if (!predicate || typeof predicate !== 'string') return false;
  const parts = predicate.split('.');
  if (parts.length !== 2) return false;
  if (!parts[0] || !parts[1]) return false;
  return true;
}

/** Check reserved predicate namespaces: system.*, lifecycle.* */
function isReservedPredicate(predicate: string): boolean {
  const domain = predicate.split('.')[0];
  return domain === 'system' || domain === 'lifecycle';
}

/** Validate object value matches declared type */
function isValidObjectType(objectType: ObjectType, value: unknown): boolean {
  switch (objectType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value) && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    case 'json': {
      if (value === null || value === undefined) return false;
      const serialized = JSON.stringify(value);
      return Buffer.byteLength(serialized, 'utf8') <= CLAIM_JSON_MAX_BYTES;
    }
    default:
      return false;
  }
}

/** Validate ISO 8601 date string */
function isValidISO8601(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const d = new Date(dateStr);
  return !Number.isNaN(d.getTime());
}

/** Check authorization — agent must have create_mission permission (or be non-empty permissions set) */
function isAuthorized(ctx: OperationContext): boolean {
  return ctx.permissions.size > 0;
}

/** Check if subject filter is valid — exact or trailing wildcard */
function isValidSubjectFilter(subject: string): boolean {
  if (!subject || subject.length === 0) return false;
  // Reject wildcard in non-trailing position (AMB-14)
  const wildcardIdx = subject.indexOf('*');
  if (wildcardIdx >= 0 && wildcardIdx !== subject.length - 1) return false;
  // Trailing wildcard
  if (subject.endsWith('*')) {
    const prefix = subject.slice(0, -1);
    // Must have at least one colon-separated segment before wildcard
    if (!prefix || !prefix.includes(':')) return false;
    return true;
  }
  // Exact match — must be valid URN
  return isValidSubjectURN(subject);
}

/** Check if predicate filter is valid — exact or trailing wildcard */
function isValidPredicateFilter(predicate: string): boolean {
  if (!predicate || predicate.length === 0) return false;
  if (predicate.endsWith('*')) {
    const prefix = predicate.slice(0, -1);
    if (!prefix || !prefix.includes('.')) return false;
    if (prefix.includes('*')) return false;
    return true;
  }
  return isValidPredicate(predicate);
}

// Simple in-memory rate limiter per agent
const rateLimitCounters = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(agentId: string | null, time: import('../../kernel/interfaces/time.js').TimeProvider): boolean {
  if (!agentId) return true;
  const now = time.nowMs();
  const key = agentId;
  const entry = rateLimitCounters.get(key);
  if (!entry || now - entry.windowStart > 60_000) {
    rateLimitCounters.set(key, { count: 1, windowStart: now });
    return true;
  }
  entry.count++;
  if (entry.count > CLAIM_RATE_LIMIT) {
    return false;
  }
  return true;
}

function resetRateLimits(): void {
  rateLimitCounters.clear();
}

// ============================================================================
// Row Mapping Helpers
// ============================================================================

function rowToClaim(row: Record<string, unknown>): Claim {
  // CCP-I10: tombstoned claims have NULL content fields — preserve as null
  const isTombstoned = row['purged_at'] !== null && row['purged_at'] !== undefined;
  return {
    id: row['id'] as ClaimId,
    tenantId: (row['tenant_id'] ?? null) as TenantId | null,
    subject: (isTombstoned ? null : row['subject']) as string,
    predicate: (isTombstoned ? null : row['predicate']) as string,
    // CCP-I10: tombstoned claims return null for content fields at runtime.
    // The Claim interface declares this non-nullable, but the contract (test #54) requires null.
    // Cast through unknown to satisfy tsc while preserving runtime behavior.
    object: (isTombstoned ? null : (row['object_type'] != null ? {
      type: row['object_type'] as ObjectType,
      value: row['object_value'] ? JSON.parse(row['object_value'] as string) : null,
    } : null)) as unknown as { readonly type: ObjectType; readonly value: unknown },
    confidence: (isTombstoned ? null : row['confidence']) as number,
    validAt: (isTombstoned ? null : row['valid_at']) as string,
    sourceAgentId: (isTombstoned ? null : row['source_agent_id']) as AgentId,
    sourceMissionId: (isTombstoned || row['source_mission_id'] == null ? null : row['source_mission_id']) as MissionId | null,
    sourceTaskId: (isTombstoned || row['source_task_id'] == null ? null : row['source_task_id']) as TaskId | null,
    groundingMode: row['grounding_mode'] as GroundingMode,
    runtimeWitness: row['runtime_witness'] ? JSON.parse(row['runtime_witness'] as string) as RuntimeWitnessInput : null,
    status: row['status'] as ClaimStatus,
    archived: Boolean(row['archived']),
    createdAt: row['created_at'] as string,
    lastAccessedAt: (row['last_accessed_at'] ?? null) as string | null,
    accessCount: (row['access_count'] ?? 0) as number,
    stability: (row['stability'] ?? 90) as number,
    reasoning: (row['reasoning'] ?? null) as string | null,
  };
}

function rowToEvidence(row: Record<string, unknown>): ClaimEvidence {
  return {
    claimId: row['claim_id'] as ClaimId,
    evidenceType: row['evidence_type'] as EvidenceType,
    evidenceId: row['evidence_id'] as string,
    sourceState: row['source_state'] as SourceState,
    createdAt: row['created_at'] as string,
  };
}

function rowToRelationship(row: Record<string, unknown>): ClaimRelationship {
  return {
    id: row['id'] as RelationshipId,
    tenantId: (row['tenant_id'] ?? null) as TenantId | null,
    fromClaimId: row['from_claim_id'] as ClaimId,
    toClaimId: row['to_claim_id'] as ClaimId,
    type: row['type'] as RelationshipType,
    declaredByAgentId: row['declared_by_agent_id'] as AgentId,
    missionId: row['mission_id'] as MissionId,
    createdAt: row['created_at'] as string,
  };
}

// ============================================================================
// ClaimStore Implementation
// ============================================================================

function createClaimStoreImpl(deps: ClaimSystemDeps): ClaimStore {
  // Phase 3: Lazy detection of v39 schema (stability column).
  // Cached after first check to avoid repeated PRAGMA queries.
  let hasStabilityColumn: boolean | null = null;
  // Phase 5: Lazy detection of v41 schema (reasoning column).
  let hasReasoningColumn: boolean | null = null;
  function checkHasStabilityColumn(conn: DatabaseConnection): boolean {
    if (hasStabilityColumn !== null) return hasStabilityColumn;
    try {
      const cols = conn.query<Record<string, unknown>>(
        "PRAGMA table_info(claim_assertions)",
        [],
      );
      hasStabilityColumn = cols.some(c => c['name'] === 'stability');
      hasReasoningColumn = cols.some(c => c['name'] === 'reasoning');
    } catch {
      hasStabilityColumn = false;
      hasReasoningColumn = false;
    }
    return hasStabilityColumn;
  }
  function checkHasReasoningColumn(conn: DatabaseConnection): boolean {
    if (hasReasoningColumn !== null) return hasReasoningColumn;
    // Will be populated by checkHasStabilityColumn's PRAGMA query
    checkHasStabilityColumn(conn);
    return hasReasoningColumn ?? false;
  }
  return {
    create(conn: DatabaseConnection, ctx: OperationContext, input: ClaimCreateInput): Result<Claim> {
      const hasStabCol = checkHasStabilityColumn(conn);
      const hasReasonCol = checkHasReasoningColumn(conn);
      const id = newId() as ClaimId;
      const now = deps.time.nowISO();
      // Phase 3: Resolve stability from predicate pattern at creation time (I-P3-03).
      const stability = resolveStability(input.predicate, deps.stabilityConfig);
      const reasoning = input.reasoning ?? null;
      try {
        // Phase 5: Include reasoning column if v41 schema has it.
        // Phase 3: Include stability column if v39 schema has it.
        // Detection via cached PRAGMA query.
        if (hasStabCol && hasReasonCol) {
          conn.run(
            `INSERT INTO claim_assertions (id, tenant_id, subject, predicate, object_type, object_value, confidence, valid_at, source_agent_id, source_mission_id, source_task_id, grounding_mode, runtime_witness, status, archived, idempotency_key, idempotency_hash, created_at, stability, reasoning)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, ?)`,
            [
              id, ctx.tenantId, input.subject, input.predicate,
              input.object.type, JSON.stringify(input.object.value),
              input.confidence, input.validAt,
              ctx.agentId, input.missionId, input.taskId ?? null,
              input.groundingMode,
              input.runtimeWitness ? JSON.stringify(input.runtimeWitness) : null,
              input.idempotencyKey?.key ?? null,
              input.idempotencyKey?.key ? computeIdempotencyHash(input) : null,
              now,
              stability,
              reasoning,
            ],
          );
        } else if (hasStabCol) {
          // v39 schema (stability) but pre-v41 (no reasoning column).
          conn.run(
            `INSERT INTO claim_assertions (id, tenant_id, subject, predicate, object_type, object_value, confidence, valid_at, source_agent_id, source_mission_id, source_task_id, grounding_mode, runtime_witness, status, archived, idempotency_key, idempotency_hash, created_at, stability)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?)`,
            [
              id, ctx.tenantId, input.subject, input.predicate,
              input.object.type, JSON.stringify(input.object.value),
              input.confidence, input.validAt,
              ctx.agentId, input.missionId, input.taskId ?? null,
              input.groundingMode,
              input.runtimeWitness ? JSON.stringify(input.runtimeWitness) : null,
              input.idempotencyKey?.key ?? null,
              input.idempotencyKey?.key ? computeIdempotencyHash(input) : null,
              now,
              stability,
            ],
          );
        } else {
          // Pre-v39 schema: stability column doesn't exist yet.
          conn.run(
            `INSERT INTO claim_assertions (id, tenant_id, subject, predicate, object_type, object_value, confidence, valid_at, source_agent_id, source_mission_id, source_task_id, grounding_mode, runtime_witness, status, archived, idempotency_key, idempotency_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)`,
            [
              id, ctx.tenantId, input.subject, input.predicate,
              input.object.type, JSON.stringify(input.object.value),
              input.confidence, input.validAt,
              ctx.agentId, input.missionId, input.taskId ?? null,
              input.groundingMode,
              input.runtimeWitness ? JSON.stringify(input.runtimeWitness) : null,
              input.idempotencyKey?.key ?? null,
              input.idempotencyKey?.key ? computeIdempotencyHash(input) : null,
              now,
            ],
          );
        }
        const claim: Claim = {
          id,
          tenantId: ctx.tenantId,
          subject: input.subject,
          predicate: input.predicate,
          object: input.object,
          confidence: input.confidence,
          validAt: input.validAt,
          sourceAgentId: ctx.agentId as AgentId,
          sourceMissionId: input.missionId,
          sourceTaskId: input.taskId ?? null,
          groundingMode: input.groundingMode,
          runtimeWitness: input.runtimeWitness ?? null,
          status: 'active',
          archived: false,
          createdAt: now,
          lastAccessedAt: null,
          accessCount: 0,
          stability,
          reasoning,
        };
        return ok(claim);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('CLAIM_CREATE_FAILED', msg, 'SC-11');
      }
    },

    get(conn: DatabaseConnection, claimId: ClaimId, tenantId: TenantId | null): Result<Claim> {
      const sql = tenantId !== null
        ? 'SELECT * FROM claim_assertions WHERE id = ? AND tenant_id = ?'
        : 'SELECT * FROM claim_assertions WHERE id = ?';
      const params = tenantId !== null ? [claimId, tenantId] : [claimId];
      const row = conn.get<Record<string, unknown>>(sql, params);
      if (!row) return err('CLAIM_NOT_FOUND', `Claim ${claimId} not found`, 'SC-13');
      return ok(rowToClaim(row));
    },

    retract(conn: DatabaseConnection, ctx: OperationContext, claimId: ClaimId, _reason: string): Result<void> {
      try {
        conn.run(
          `UPDATE claim_assertions SET status = 'retracted' WHERE id = ? AND tenant_id IS ?`,
          [claimId, ctx.tenantId],
        );
        return ok(undefined);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('CCP-I2')) {
          return err('CLAIM_ALREADY_RETRACTED', 'Claim already retracted', 'CCP-I2');
        }
        return err('RETRACT_FAILED', msg, 'SC-11');
      }
    },

    archive(conn: DatabaseConnection, claimId: ClaimId, tenantId: TenantId | null): Result<void> {
      const sql = tenantId !== null
        ? 'UPDATE claim_assertions SET archived = 1 WHERE id = ? AND tenant_id = ?'
        : 'UPDATE claim_assertions SET archived = 1 WHERE id = ?';
      const params = tenantId !== null ? [claimId, tenantId] : [claimId];
      conn.run(sql, params);
      return ok(undefined);
    },

    tombstone(conn: DatabaseConnection, claimId: ClaimId, tenantId: TenantId | null, reason: string): Result<void> {
      const now = deps.time.nowISO();
      const sql = tenantId !== null
        ? `UPDATE claim_assertions SET subject = NULL, predicate = NULL, object_type = NULL, object_value = NULL, confidence = NULL, valid_at = NULL, source_agent_id = NULL, source_mission_id = NULL, source_task_id = NULL, runtime_witness = NULL, purged_at = ?, purge_reason = ? WHERE id = ? AND tenant_id = ?`
        : `UPDATE claim_assertions SET subject = NULL, predicate = NULL, object_type = NULL, object_value = NULL, confidence = NULL, valid_at = NULL, source_agent_id = NULL, source_mission_id = NULL, source_task_id = NULL, runtime_witness = NULL, purged_at = ?, purge_reason = ? WHERE id = ?`;
      const params = tenantId !== null ? [now, reason, claimId, tenantId] : [now, reason, claimId];
      conn.run(sql, params);
      return ok(undefined);
    },

    query(conn: DatabaseConnection, tenantId: TenantId | null, filters: ClaimQueryInput): Result<ClaimQueryResult> {
      const conditions: string[] = [];
      const params: unknown[] = [];

      // Tenant isolation
      if (tenantId !== null) {
        conditions.push('c.tenant_id = ?');
        params.push(tenantId);
      }

      // Exclude tombstoned claims from ALL queries
      conditions.push('c.purged_at IS NULL');

      // Subject filter
      if (filters.subject !== undefined && filters.subject !== null) {
        if (filters.subject.endsWith('*')) {
          conditions.push('c.subject LIKE ?');
          params.push(filters.subject.slice(0, -1) + '%');
        } else {
          conditions.push('c.subject = ?');
          params.push(filters.subject);
        }
      }

      // Predicate filter
      if (filters.predicate !== undefined && filters.predicate !== null) {
        if (filters.predicate.endsWith('*')) {
          conditions.push('c.predicate LIKE ?');
          params.push(filters.predicate.slice(0, -1) + '%');
        } else {
          conditions.push('c.predicate = ?');
          params.push(filters.predicate);
        }
      }

      // Status filter — null means unfiltered, undefined defaults to 'active' (AMB-10, BPB-008)
      const effectiveStatus = filters.status === undefined ? 'active' : filters.status;
      if (effectiveStatus !== null) {
        conditions.push('c.status = ?');
        params.push(effectiveStatus);
      }

      // Confidence filter
      if (filters.minConfidence !== undefined && filters.minConfidence !== null) {
        conditions.push('c.confidence >= ?');
        params.push(filters.minConfidence);
      }

      // Agent filter
      if (filters.sourceAgentId !== undefined && filters.sourceAgentId !== null) {
        conditions.push('c.source_agent_id = ?');
        params.push(filters.sourceAgentId);
      }

      // Mission filter
      if (filters.sourceMissionId !== undefined && filters.sourceMissionId !== null) {
        conditions.push('c.source_mission_id = ?');
        params.push(filters.sourceMissionId);
      }

      // Temporal range
      if (filters.validAtFrom !== undefined && filters.validAtFrom !== null) {
        conditions.push('c.valid_at >= ?');
        params.push(filters.validAtFrom);
      }
      if (filters.validAtTo !== undefined && filters.validAtTo !== null) {
        conditions.push('c.valid_at <= ?');
        params.push(filters.validAtTo);
      }

      // Archive mode
      const archiveMode = filters.archiveMode ?? 'exclude';
      if (archiveMode === 'exclude') {
        conditions.push('c.archived = 0');
      } else if (archiveMode === 'only') {
        conditions.push('c.archived = 1');
      }
      // 'include' — no archive filter

      // MissionId filter (for queries that use it)
      if ('missionId' in filters && (filters as Record<string, unknown>)['missionId'] !== undefined) {
        conditions.push('c.source_mission_id = ?');
        params.push((filters as Record<string, unknown>)['missionId']);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const requestedLimit = Math.min(filters.limit ?? CLAIM_QUERY_DEFAULT_LIMIT, CLAIM_QUERY_MAX_LIMIT);
      const offset = filters.offset ?? 0;

      // Phase 3: Two-phase minConfidence filtering (I-P3-07).
      // Phase 1 (SQL): confidence >= minConfidence is a necessary condition.
      // Phase 2 (TypeScript): effectiveConfidence >= minConfidence is the exact condition.
      // Over-fetch by 2x when minConfidence is set to account for decay filtering.
      const hasMinConfidence = filters.minConfidence !== undefined && filters.minConfidence !== null;
      const overFetchFactor = hasMinConfidence ? 2 : 1;
      const sqlLimit = requestedLimit * overFetchFactor;

      // Count query
      const countRow = conn.get<{ total: number }>(`SELECT COUNT(*) as total FROM claim_assertions c ${whereClause}`, params);
      const total = countRow?.total ?? 0;

      // Data query
      const dataRows = conn.query<Record<string, unknown>>(
        `SELECT c.* FROM claim_assertions c ${whereClause} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
        [...params, sqlLimit, offset],
      );

      // Phase 3: Compute effectiveConfidence and freshness for each result (I-P3-02, I-P3-06).
      // Use a single nowMs for consistency within a single query invocation (Decision 9).
      const nowMs = deps.time.nowMs();
      const allItems: ClaimQueryResultItem[] = [];

      for (const row of dataRows) {
        const claim = rowToClaim(row);
        const claimIdVal = claim.id;

        // Phase 3: Compute decay
        const ageMs = computeAgeMs(claim.validAt, nowMs);
        const decayConf = computeEffectiveConfidence(claim.confidence, ageMs, claim.stability);

        // Phase 4 I-P4-05: Compose cascade penalty with decay
        // effective_confidence = confidence * decayFactor * cascadePenalty
        const cascadePenalty = computeCascadePenalty(conn, claimIdVal);
        const effConf = decayConf * cascadePenalty;

        // Phase 3: Two-phase minConfidence filter (Phase 2 -- TypeScript exact filter)
        if (hasMinConfidence && effConf < filters.minConfidence!) {
          continue;
        }

        // Phase 3: Classify freshness
        const lastAccessMs = claim.lastAccessedAt ? Date.parse(claim.lastAccessedAt) : null;
        const freshness = classifyFreshness(lastAccessMs, nowMs, deps.freshnessThresholds);

        // Computed properties — check relationship graph
        const supersededRow = conn.get<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM claim_relationships WHERE to_claim_id = ? AND type = 'supersedes'`,
          [claimIdVal],
        );
        // Phase 4 I-P4-09: Bidirectional disputed check for 'contradicts'
        // Both the asserting claim (from_claim_id) and contradicted claim (to_claim_id) are disputed
        const disputedRow = conn.get<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM claim_relationships WHERE (to_claim_id = ? OR from_claim_id = ?) AND type = 'contradicts'`,
          [claimIdVal, claimIdVal],
        );

        const item: ClaimQueryResultItem = {
          claim,
          superseded: (supersededRow?.cnt ?? 0) > 0,
          disputed: (disputedRow?.cnt ?? 0) > 0,
          effectiveConfidence: effConf,
          freshness,
        };

        // Include evidence if requested
        if (filters.includeEvidence) {
          const evidenceRows = conn.query<Record<string, unknown>>(
            'SELECT * FROM claim_evidence WHERE claim_id = ?',
            [claimIdVal],
          );
          (item as unknown as { evidence: readonly ClaimEvidence[] }).evidence = evidenceRows.map(rowToEvidence);
        }

        // Include relationships if requested
        if (filters.includeRelationships) {
          const relRows = conn.query<Record<string, unknown>>(
            'SELECT * FROM claim_relationships WHERE from_claim_id = ? OR to_claim_id = ?',
            [claimIdVal, claimIdVal],
          );
          (item as unknown as { relationships: readonly ClaimRelationship[] }).relationships = relRows.map(rowToRelationship);
        }

        allItems.push(item);
      }

      // Apply requested limit after Phase 2 filtering
      const claims = allItems.slice(0, requestedLimit);

      // F-P3-007: total and hasMore must reflect post-filter count, not SQL COUNT(*).
      // SQL pre-filter (confidence >= minConfidence) is a necessary condition, but the
      // TypeScript post-filter (effectiveConfidence >= minConfidence) is the exact condition.
      // Using the SQL total misleads consumers: API would claim total=10 but only return 3.
      // When minConfidence filtering is active, use allItems.length as the total.
      const postFilterTotal = hasMinConfidence ? allItems.length : total;

      return ok({
        claims,
        total: postFilterTotal,
        hasMore: hasMinConfidence
          ? allItems.length > requestedLimit
          : total > offset + requestedLimit,
      });
    },

    getAsTombstone(conn: DatabaseConnection, claimId: ClaimId, tenantId: TenantId | null): Result<ClaimTombstone | null> {
      const sql = tenantId !== null
        ? 'SELECT id, tenant_id, status, archived, purged_at, purge_reason FROM claim_assertions WHERE id = ? AND tenant_id = ? AND purged_at IS NOT NULL'
        : 'SELECT id, tenant_id, status, archived, purged_at, purge_reason FROM claim_assertions WHERE id = ? AND purged_at IS NOT NULL';
      const params = tenantId !== null ? [claimId, tenantId] : [claimId];
      const row = conn.get<Record<string, unknown>>(sql, params);
      if (!row) return ok(null);
      return ok({
        id: row['id'] as ClaimId,
        tenantId: (row['tenant_id'] ?? null) as TenantId | null,
        status: row['status'] as ClaimStatus,
        archived: Boolean(row['archived']),
        purgedAt: row['purged_at'] as string,
        purgeReason: row['purge_reason'] as string,
      });
    },

    /**
     * Phase 2: FTS5 full-text search over claim content.
     *
     * Query routing (Design Source Decision 4):
     *   - CJK-only query -> trigram table only
     *   - Latin-only or other -> both tables (primary for BM25, trigram for substring)
     *   - Mixed -> both tables, merge by best score
     *
     * PA Amendment 1: Latin queries also search trigram table for substring matching.
     * PA Amendment 2: score = -bm25() * confidence (negate BM25 so higher = better).
     *
     * Invariants: I-P2-01 (sync), I-P2-02 (tenant isolation), I-P2-03 (retracted exclusion),
     *             I-P2-05 (score), I-P2-06 (error containment)
     */
    search(conn: DatabaseConnection, tenantId: TenantId | null, input: SearchClaimInput): Result<SearchClaimResult> {
      const limit = Math.min(input.limit ?? SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT);
      const analysis = analyzeQuery(input.query);

      // DC-P2-008, I-P2-06: Sanitize user query before FTS5 MATCH.
      // Prevents FTS5 syntax injection (column filters, boolean operators, unbalanced quotes).
      // F-P2-003: sanitizeFts5Query was dead code — now wired into search path.
      const sanitizedQuery = sanitizeFts5Query(input.query);

      try {
        // Collect results from relevant FTS5 tables
        // Map: claim_id -> { relevance, source }
        const scoreMap = new Map<string, { relevance: number; source: string }>();

        // Tenant filter for UNINDEXED columns
        const tenantFilter = tenantId !== null
          ? 'AND f.tenant_id = ?'
          : 'AND f.tenant_id IS NULL';
        const tenantParam = tenantId !== null ? [tenantId] : [];

        // Query primary unicode61 table
        if (analysis.tables.includes('primary')) {
          try {
            const primaryRows = conn.query<Record<string, unknown>>(
              `SELECT f.id, bm25(claims_fts) as rank
               FROM claims_fts f
               WHERE claims_fts MATCH ?
                 ${tenantFilter}
                 AND f.status = 'active'
               ORDER BY rank
               LIMIT ?`,
              [sanitizedQuery, ...tenantParam, limit * 2],
            );

            for (const row of primaryRows) {
              const claimId = row['id'] as string;
              const rank = row['rank'] as number;
              const existing = scoreMap.get(claimId);
              // Keep the better (more negative) rank
              if (!existing || rank < existing.relevance) {
                scoreMap.set(claimId, { relevance: rank, source: 'primary' });
              }
            }
          } catch (ftsErr) {
            // FTS5 syntax error on primary table -- continue to trigram
            const msg = ftsErr instanceof Error ? ftsErr.message : String(ftsErr);
            if (msg.includes('fts5: syntax error') || msg.includes('fts5:')) {
              // For syntax errors, skip primary but try trigram
            } else {
              return err('CONV_SEARCH_FTS5_ERROR', `FTS5 search error: ${msg}`, 'Phase-2');
            }
          }
        }

        // Query trigram table
        if (analysis.tables.includes('cjk')) {
          try {
            // Trigram requires at least 3 characters for matching
            if (input.query.length >= 3) {
              const cjkRows = conn.query<Record<string, unknown>>(
                `SELECT f.id, bm25(claims_fts_cjk) as rank
                 FROM claims_fts_cjk f
                 WHERE claims_fts_cjk MATCH ?
                   ${tenantFilter}
                   AND f.status = 'active'
                 ORDER BY rank
                 LIMIT ?`,
                [sanitizedQuery, ...tenantParam, limit * 2],
              );

              for (const row of cjkRows) {
                const claimId = row['id'] as string;
                const rank = row['rank'] as number;
                const existing = scoreMap.get(claimId);
                // Keep the better rank (more negative = more relevant)
                if (!existing || rank < existing.relevance) {
                  scoreMap.set(claimId, { relevance: rank, source: 'cjk' });
                }
              }
            }
          } catch (ftsErr) {
            const msg = ftsErr instanceof Error ? ftsErr.message : String(ftsErr);
            if (!msg.includes('fts5: syntax error') && !msg.includes('fts5:')) {
              return err('CONV_SEARCH_FTS5_ERROR', `FTS5 CJK search error: ${msg}`, 'Phase-2');
            }
          }
        }

        if (scoreMap.size === 0) {
          return ok({ results: [], total: 0 });
        }

        // Hydrate claims and compute final scores
        const claimIds = Array.from(scoreMap.keys());
        const placeholders = claimIds.map(() => '?').join(',');

        const claimRows = conn.query<Record<string, unknown>>(
          `SELECT c.* FROM claim_assertions c
           WHERE c.id IN (${placeholders})
             AND c.purged_at IS NULL`,
          claimIds,
        );

        const results: SearchClaimResultItem[] = [];

        // Phase 3: Use single nowMs for consistency within this search invocation
        const nowMs = deps.time.nowMs();

        for (const row of claimRows) {
          const claim = rowToClaim(row);
          const entry = scoreMap.get(claim.id as string);
          if (!entry) continue;

          // Phase 3: Compute decay and effective confidence (I-P3-02, I-P3-08)
          const ageMs = computeAgeMs(claim.validAt, nowMs);
          const decayConf = computeEffectiveConfidence(claim.confidence, ageMs, claim.stability);

          // Phase 4 I-P4-05: Compose cascade penalty with decay
          const cascadePenalty = computeCascadePenalty(conn, claim.id as string);
          const effConf = decayConf * cascadePenalty;

          // Phase 3: score = -bm25() * effectiveConfidence (was * confidence)
          // BM25 returns negative (lower = more relevant), negate to make higher = better
          const score = -entry.relevance * effConf;

          // Compute superseded/disputed
          const supersededRow = conn.get<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM claim_relationships WHERE to_claim_id = ? AND type = 'supersedes'`,
            [claim.id],
          );
          // Phase 4 I-P4-09: Bidirectional disputed check for 'contradicts'
          const disputedRow = conn.get<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM claim_relationships WHERE (to_claim_id = ? OR from_claim_id = ?) AND type = 'contradicts'`,
            [claim.id, claim.id],
          );

          const superseded = (supersededRow?.cnt ?? 0) > 0;
          const disputed = (disputedRow?.cnt ?? 0) > 0;

          // Phase 3: minConfidence filters by effectiveConfidence (I-P3-07, DC-P3-801)
          if (input.minConfidence !== undefined && effConf < input.minConfidence) {
            continue;
          }

          // Apply superseded filter (default: exclude)
          if (!input.includeSuperseded && superseded) {
            continue;
          }

          // Phase 3: Classify freshness
          const lastAccessMs = claim.lastAccessedAt ? Date.parse(claim.lastAccessedAt) : null;
          const freshness = classifyFreshness(lastAccessMs, nowMs, deps.freshnessThresholds);

          results.push({
            claim,
            relevance: entry.relevance,
            score,
            superseded,
            disputed,
            effectiveConfidence: effConf,
            freshness,
          });
        }

        // Sort by score descending (higher = better match)
        results.sort((a, b) => b.score - a.score);

        // Apply limit
        const limited = results.slice(0, limit);

        return ok({
          results: limited,
          total: results.length,
        });
      } catch (searchErr) {
        const msg = searchErr instanceof Error ? searchErr.message : String(searchErr);
        if (msg.includes('fts5: syntax error') || msg.includes('fts5:')) {
          return err('CONV_SEARCH_QUERY_SYNTAX', `FTS5 query syntax error: ${msg}`, 'Phase-2');
        }
        return err('CONV_SEARCH_FTS5_ERROR', `FTS5 search error: ${msg}`, 'Phase-2');
      }
    },
  };
}

// ============================================================================
// ClaimEvidenceStore Implementation
// ============================================================================

function createClaimEvidenceStoreImpl(deps: ClaimSystemDeps): ClaimEvidenceStore {
  return {
    createBatch(conn: DatabaseConnection, claimId: ClaimId, evidenceRefs: readonly EvidenceRef[]): Result<void> {
      for (const ref of evidenceRefs) {
        const id = newId();
        conn.run(
          `INSERT INTO claim_evidence (id, claim_id, evidence_type, evidence_id, source_state, created_at)
           VALUES (?, ?, ?, ?, 'live', ?)`,
          [id, claimId, ref.type, ref.id, deps.time.nowISO()],
        );
      }
      return ok(undefined);
    },

    getByClaimId(conn: DatabaseConnection, claimId: ClaimId): Result<readonly ClaimEvidence[]> {
      const rows = conn.query<Record<string, unknown>>(
        'SELECT * FROM claim_evidence WHERE claim_id = ?',
        [claimId],
      );
      return ok(rows.map(rowToEvidence));
    },

    markSourceTombstoned(conn: DatabaseConnection, evidenceType: EvidenceType, evidenceId: string): Result<number> {
      const result = conn.run(
        `UPDATE claim_evidence SET source_state = 'tombstoned' WHERE evidence_type = ? AND evidence_id = ?`,
        [evidenceType, evidenceId],
      );
      return ok(result.changes);
    },

    getBySourceId(conn: DatabaseConnection, evidenceType: EvidenceType, evidenceId: string): Result<readonly ClaimEvidence[]> {
      const rows = conn.query<Record<string, unknown>>(
        'SELECT * FROM claim_evidence WHERE evidence_type = ? AND evidence_id = ?',
        [evidenceType, evidenceId],
      );
      return ok(rows.map(rowToEvidence));
    },
  };
}

// ============================================================================
// ClaimRelationshipStore Implementation
// ============================================================================

function createClaimRelationshipStoreImpl(deps: ClaimSystemDeps): ClaimRelationshipStore {
  return {
    create(conn: DatabaseConnection, ctx: OperationContext, input: RelationshipCreateInput): Result<ClaimRelationship> {
      const id = newId() as RelationshipId;
      const now = deps.time.nowISO();
      conn.run(
        `INSERT INTO claim_relationships (id, tenant_id, from_claim_id, to_claim_id, type, declared_by_agent_id, mission_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, ctx.tenantId, input.fromClaimId, input.toClaimId, input.type, ctx.agentId, input.missionId, now],
      );
      return ok({
        id,
        tenantId: ctx.tenantId,
        fromClaimId: input.fromClaimId,
        toClaimId: input.toClaimId,
        type: input.type,
        declaredByAgentId: ctx.agentId as AgentId,
        missionId: input.missionId,
        createdAt: now,
      });
    },

    getByClaimId(conn: DatabaseConnection, claimId: ClaimId, direction: 'from' | 'to'): Result<readonly ClaimRelationship[]> {
      const col = direction === 'from' ? 'from_claim_id' : 'to_claim_id';
      const rows = conn.query<Record<string, unknown>>(
        `SELECT * FROM claim_relationships WHERE ${col} = ?`,
        [claimId],
      );
      return ok(rows.map(rowToRelationship));
    },

    getByType(conn: DatabaseConnection, claimId: ClaimId, type: RelationshipType, direction: 'from' | 'to'): Result<readonly ClaimRelationship[]> {
      const col = direction === 'from' ? 'from_claim_id' : 'to_claim_id';
      const rows = conn.query<Record<string, unknown>>(
        `SELECT * FROM claim_relationships WHERE ${col} = ? AND type = ?`,
        [claimId, type],
      );
      return ok(rows.map(rowToRelationship));
    },

    countOutgoing(conn: DatabaseConnection, claimId: ClaimId): Result<number> {
      const row = conn.get<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM claim_relationships WHERE from_claim_id = ?',
        [claimId],
      );
      return ok(row?.cnt ?? 0);
    },
  };
}

// ============================================================================
// ClaimArtifactRefStore Implementation
// ============================================================================

function createClaimArtifactRefStoreImpl(deps: ClaimSystemDeps): ClaimArtifactRefStore {
  return {
    createBatch(conn: DatabaseConnection, artifactId: ArtifactId, claimIds: readonly ClaimId[]): Result<void> {
      const now = deps.time.nowISO();
      for (const claimId of claimIds) {
        conn.run(
          `INSERT OR IGNORE INTO claim_artifact_refs (artifact_id, claim_id, created_at) VALUES (?, ?, ?)`,
          [artifactId, claimId, now],
        );
      }
      return ok(undefined);
    },

    getByArtifactId(conn: DatabaseConnection, artifactId: ArtifactId): Result<readonly ClaimId[]> {
      const rows = conn.query<{ claim_id: string }>(
        'SELECT claim_id FROM claim_artifact_refs WHERE artifact_id = ?',
        [artifactId],
      );
      return ok(rows.map(r => r.claim_id as ClaimId));
    },

    getByClaimId(conn: DatabaseConnection, claimId: ClaimId): Result<readonly ArtifactId[]> {
      const rows = conn.query<{ artifact_id: string }>(
        'SELECT artifact_id FROM claim_artifact_refs WHERE claim_id = ?',
        [claimId],
      );
      return ok(rows.map(r => r.artifact_id as ArtifactId));
    },
  };
}

// ============================================================================
// GroundingValidator Implementation — CF-05, CCP-I13, DC-CCP-117
// ============================================================================

function createGroundingValidatorImpl(
  _deps: ClaimSystemDeps,
  stores: { store: ClaimStore; evidence: ClaimEvidenceStore },
): GroundingValidator {

  function traverseEvidencePath(
    conn: DatabaseConnection,
    evidenceRefs: readonly EvidenceRef[],
    maxHops: number,
    checkRetracted: boolean,
    visited: Set<string> = new Set(),
    depth: number = 0,
  ): GroundingResult {
    // For each evidence ref, check if any leads to a non-claim anchor within maxHops
    for (const ref of evidenceRefs) {
      if (ref.type !== 'claim') {
        // Non-claim evidence = terminal anchor. Grounding succeeds.
        const steps: GroundingStep[] = [{
          claimId: '' as ClaimId, // placeholder — filled by caller
          evidenceType: ref.type,
          evidenceId: ref.id,
        }];
        return {
          grounded: true,
          mode: 'evidence_path',
          traversalPath: {
            hops: depth + 1,
            maxHops,
            steps,
            anchor: { type: ref.type, id: ref.id },
          },
        };
      }

      // Claim evidence — need to traverse deeper
      // At max depth with a claim ref: no more hops available to reach an anchor.
      if (depth + 1 >= maxHops) {
        continue;
      }

      if (visited.has(ref.id)) continue; // Cycle detection
      visited.add(ref.id);

      // Retrieve the referenced claim
      const targetClaim = stores.store.get(conn, ref.id as ClaimId, null);
      if (!targetClaim.ok) continue;

      if (checkRetracted && targetClaim.value.status === 'retracted') {
        return {
          grounded: false,
          mode: 'evidence_path',
          failureReason: `Evidence chain traverses retracted intermediate claim ${ref.id}`,
        };
      }

      // Get evidence of the referenced claim and recurse
      const subEvidence = stores.evidence.getByClaimId(conn, ref.id as ClaimId);
      if (!subEvidence.ok) continue;

      const subRefs: EvidenceRef[] = subEvidence.value.map(e => ({
        type: e.evidenceType,
        id: e.evidenceId,
      }));

      const subResult = traverseEvidencePath(conn, subRefs, maxHops, checkRetracted, visited, depth + 1);
      if (subResult.grounded) {
        // Update hops to account for this level
        const result: GroundingResult = {
          grounded: true,
          mode: 'evidence_path' as const,
        };
        if (subResult.traversalPath) {
          (result as { traversalPath: GroundingTraversalPath }).traversalPath = {
            ...subResult.traversalPath,
            hops: depth + 1 + (subResult.traversalPath.hops - depth - 1),
          };
        }
        return result;
      }
      // If sub-result has retraction contamination, propagate it
      if (subResult.failureReason?.includes('retracted')) {
        return subResult;
      }
    }

    // No path found to non-claim anchor
    return {
      grounded: false,
      mode: 'evidence_path',
      failureReason: 'No evidence path terminates at non-claim anchor within max hops',
    };
  }

  return Object.freeze({
    validate(
      conn: DatabaseConnection,
      _claimId: ClaimId,
      evidenceRefs: readonly EvidenceRef[],
      mode: GroundingMode,
      maxHops: number,
      runtimeWitness?: RuntimeWitnessInput,
    ): Result<GroundingResult> {
      if (mode === 'runtime_witness') {
        const result: GroundingResult = { grounded: true, mode: 'runtime_witness' };
        if (runtimeWitness) {
          (result as { witnessBinding: RuntimeWitnessInput }).witnessBinding = runtimeWitness;
        }
        return ok(result);
      }

      // evidence_path mode
      const result = traverseEvidencePath(conn, evidenceRefs, maxHops, false);
      return ok(result);
    },

    validateWithRetractedCheck(
      conn: DatabaseConnection,
      _claimId: ClaimId,
      evidenceRefs: readonly EvidenceRef[],
      mode: GroundingMode,
      maxHops: number,
      runtimeWitness?: RuntimeWitnessInput,
    ): Result<GroundingResult> {
      if (mode === 'runtime_witness') {
        const result: GroundingResult = { grounded: true, mode: 'runtime_witness' };
        if (runtimeWitness) {
          (result as { witnessBinding: RuntimeWitnessInput }).witnessBinding = runtimeWitness;
        }
        return ok(result);
      }

      // evidence_path with retraction check
      const result = traverseEvidencePath(conn, evidenceRefs, maxHops, true);
      return ok(result);
    },
  });
}

// ============================================================================
// ClaimLifecycleProjection Implementation — Binding 3, DC-CCP-205
// ============================================================================

function createClaimLifecycleProjectionImpl(): ClaimLifecycleProjection {
  return Object.freeze({
    project(
      status: ClaimStatus,
      grounded: boolean,
      hasContradicts: boolean,
      hasSupersedes: boolean,
    ): ClaimLifecycleState {
      // Ordering by severity: retracted > superseded > disputed > grounded > asserted
      if (status === 'retracted') return 'retracted';
      if (hasSupersedes) return 'superseded';
      if (hasContradicts) return 'disputed';
      if (grounded) return 'grounded';
      return 'asserted';
    },
  });
}

// ============================================================================
// AssertClaimHandler Implementation — SC-11
// ============================================================================

function createAssertClaimHandlerImpl(
  deps: ClaimSystemDeps,
  stores: {
    store: ClaimStore;
    evidence: ClaimEvidenceStore;
    artifactRefs: ClaimArtifactRefStore;
    grounding: GroundingValidator;
  },
): AssertClaimHandler {
  return Object.freeze({
    execute(conn: DatabaseConnection, ctx: OperationContext, input: ClaimCreateInput): Result<AssertClaimOutput> {
      // F-S1-005: TOCTOU invariant — evidence validation (steps 10, 10b) and claim
      // INSERT (step 15) execute within the SAME transaction boundary. SQLite with
      // better-sqlite3 uses synchronous, serialized writes. This transaction ensures
      // no evidence can be deleted/modified between validation and claim creation.
      return conn.transaction(() => {
        // Generate a CorrelationId for this operation
        const correlationId = newId() as CorrelationId;

        // 0. Authorization
        if (!isAuthorized(ctx)) {
          return err('UNAUTHORIZED', 'Agent not authorized to assert claims', 'SC-11');
        }

        // 0a. Rate limit
        if (!checkRateLimit(ctx.agentId, deps.time)) {
          return err('RATE_LIMITED', 'Rate limit exceeded', 'SC-11');
        }

        // 0b. Idempotency key check (DC-CCP-307)
        if (input.idempotencyKey?.key) {
          const existing = conn.get<Record<string, unknown>>(
            'SELECT id, idempotency_hash FROM claim_assertions WHERE idempotency_key = ?',
            [input.idempotencyKey.key],
          );
          if (existing) {
            // Key exists — check if payload matches (hash comparison)
            const inputHash = computeIdempotencyHash(input);
            if (existing['idempotency_hash'] !== inputHash) {
              return err('IDEMPOTENT_DUPLICATE', 'Idempotency key already used with different payload', 'DC-CCP-307');
            }
            // Same key, same payload → return cached claim
            const cachedClaim = stores.store.get(conn, existing['id'] as ClaimId, ctx.tenantId);
            if (cachedClaim.ok) {
              const cachedEvidence = stores.evidence.getByClaimId(conn, cachedClaim.value.id);
              return ok({
                claim: cachedClaim.value,
                grounding: { grounded: true, mode: cachedClaim.value.groundingMode },
                evidenceRecords: cachedEvidence.ok ? cachedEvidence.value : [],
              } as AssertClaimOutput);
            }
          }
        }

        // 1. Validate grounding mode
        if (!input.groundingMode) {
          return err('GROUNDING_MODE_MISSING', 'groundingMode field is required', 'CF-05');
        }

        // 2. Validate subject URN
        if (!input.subject || !isValidSubjectURN(input.subject)) {
          return err('INVALID_SUBJECT', `Invalid subject URN: ${input.subject}`, 'SC-11');
        }

        // 3. Validate predicate
        if (!input.predicate || !isValidPredicate(input.predicate)) {
          return err('INVALID_PREDICATE', `Invalid predicate format: ${input.predicate}`, 'SC-11');
        }
        if (isReservedPredicate(input.predicate)) {
          return err('INVALID_PREDICATE', `Reserved predicate namespace: ${input.predicate}`, 'SC-11');
        }

        // 3b. Phase 10: Protected predicate guard (I-P10-10, I-P10-11)
        // F-P10-002 fix: Use dynamic getter when available (reads from DB at assertion time)
        {
          const protectedRules = deps.getProtectedPredicateRules
            ? deps.getProtectedPredicateRules()
            : (deps.protectedPredicateRules ?? []);
          const rbacActive = deps.getRbacActive
            ? deps.getRbacActive()
            : (deps.rbacActive ?? false);
          if (protectedRules.length > 0) {
            const guardResult = checkPredicateGuard(
              input.predicate,
              'assert',
              ctx,
              rbacActive,
              protectedRules,
            );
            if (!guardResult.ok) return guardResult as Result<AssertClaimOutput>;
          }
        }

        // 4. Validate object type
        if (!isValidObjectType(input.object.type, input.object.value)) {
          return err('INVALID_OBJECT_TYPE', `Object value does not match declared type ${input.object.type}`, 'SC-11');
        }

        // 5. Validate confidence
        if (typeof input.confidence !== 'number' || input.confidence < 0 || input.confidence > 1) {
          return err('CONFIDENCE_OUT_OF_RANGE', 'Confidence must be in [0.0, 1.0]', 'SC-11');
        }

        // 6. Validate validAt
        if (!isValidISO8601(input.validAt)) {
          return err('INVALID_VALID_AT', 'validAt must be valid ISO 8601', 'SC-11');
        }

        // 7. Runtime witness validation
        if (input.groundingMode === 'runtime_witness') {
          if (!input.runtimeWitness) {
            return err('RUNTIME_WITNESS_MISSING', 'runtimeWitness required for runtime_witness mode', 'CF-05');
          }
          if (!input.runtimeWitness.witnessType || !isValidISO8601(input.runtimeWitness.witnessTimestamp)) {
            return err('RUNTIME_WITNESS_INVALID', 'runtimeWitness structure is invalid', 'CF-05');
          }
        }

        // 8. Evidence validation (evidence_path requires ≥1, runtime_witness allows 0)
        if (input.groundingMode === 'evidence_path' && input.evidenceRefs.length === 0) {
          return err('NO_EVIDENCE', 'Evidence-path mode requires at least one evidence reference', 'CCP-I5');
        }

        // 9. Evidence count limit
        if (input.evidenceRefs.length > CLAIM_MAX_EVIDENCE_REFS) {
          return err('EVIDENCE_LIMIT_EXCEEDED', `Evidence references exceed limit of ${CLAIM_MAX_EVIDENCE_REFS}`, 'SC-11');
        }

        // 10. Evidence FK validation
        // Claim-type evidence: validated via DB (ClaimStore owns claim existence).
        // External types: validated via injected EvidenceSourceValidator.
        // DC-CCP-023: type mismatch detected by cross-checking alternative sources.
        for (const ref of input.evidenceRefs) {
          if (ref.type === 'claim') {
            // Self-referential: check claim_assertions directly
            const claimRef = conn.get<Record<string, unknown>>(
              'SELECT id, tenant_id FROM claim_assertions WHERE id = ?',
              [ref.id],
            );
            if (!claimRef) {
              // Check if this ID exists under a non-claim type (type mismatch)
              const nonClaimTypes: EvidenceType[] = ['memory', 'artifact', 'capability_result'];
              let typeMismatch = false;
              for (const altType of nonClaimTypes) {
                const altResult = deps.evidenceValidator.exists(conn, altType, ref.id, ctx.tenantId, input.taskId);
                if (altResult.ok) {
                  typeMismatch = true;
                  break;
                }
              }
              if (typeMismatch) {
                return err('EVIDENCE_TYPE_MISMATCH', `Evidence id ${ref.id} exists but not as type 'claim'`, 'DC-CCP-023');
              }
              return err('EVIDENCE_NOT_FOUND', `Claim evidence ${ref.id} not found`, 'I-30');
            }
            // Cross-tenant check for claim evidence
            if (ctx.tenantId !== null && claimRef['tenant_id'] !== null && claimRef['tenant_id'] !== ctx.tenantId) {
              return err('EVIDENCE_CROSS_TENANT', `Claim evidence ${ref.id} belongs to different tenant`, 'CCP-LI-06');
            }
          } else {
            // External evidence: use injected validator
            // Sprint 1: Pass taskId for memory evidence scoping (CCP-01)
            const validResult = deps.evidenceValidator.exists(conn, ref.type, ref.id, ctx.tenantId, input.taskId);
            if (!validResult.ok) {
              // Check if it exists under a different type (type mismatch)
              if (validResult.error.code === 'EVIDENCE_NOT_FOUND') {
                const allTypes: EvidenceType[] = ['memory', 'artifact', 'capability_result', 'claim'];
                const otherTypes = allTypes.filter(t => t !== ref.type);
                for (const altType of otherTypes) {
                  if (altType === 'claim') {
                    // Check DB for claim
                    const claimCheck = conn.get<Record<string, unknown>>(
                      'SELECT id FROM claim_assertions WHERE id = ?', [ref.id],
                    );
                    if (claimCheck) {
                      return err('EVIDENCE_TYPE_MISMATCH', `Evidence id ${ref.id} exists as claim not ${ref.type}`, 'DC-CCP-023');
                    }
                  } else {
                    const altResult = deps.evidenceValidator.exists(conn, altType, ref.id, ctx.tenantId, input.taskId);
                    if (altResult.ok) {
                      return err('EVIDENCE_TYPE_MISMATCH', `Evidence id ${ref.id} exists as ${altType} not ${ref.type}`, 'DC-CCP-023');
                    }
                  }
                }
              }
              return err(validResult.error.code, validResult.error.message, validResult.error.spec);
            }
          }
        }

        // 10b. Capability result scope validation (DC-CCP-118)
        if (deps.capabilityResultScopeValidator) {
          for (const ref of input.evidenceRefs) {
            if (ref.type === 'capability_result') {
              const scopeResult = deps.capabilityResultScopeValidator.validateScope(
                conn, ref.id, input.missionId, ctx.tenantId,
              );
              if (!scopeResult.ok) {
                return err(scopeResult.error.code, scopeResult.error.message, scopeResult.error.spec);
              }
              if (!scopeResult.value) {
                return err('EVIDENCE_SCOPE_VIOLATION', `capability_result ${ref.id} is outside mission ancestor chain`, 'DC-CCP-118');
              }
            }
          }
        }

        // 11. Mission state validation
        // If mission exists in DB with a terminal state, reject.
        // If mission doesn't exist in DB, allow (may be managed externally).
        if (input.missionId) {
          // F-007: Include tenant_id in mission state query to prevent cross-tenant information leak.
          // Matches SC-12 (line 1305) and SC-13 (line 1462) which both scope by tenant_id.
          const missionRow = conn.get<Record<string, unknown>>(
            'SELECT state FROM core_missions WHERE id = ? AND tenant_id IS ?',
            [input.missionId, ctx.tenantId],
          );
          if (missionRow) {
            const state = missionRow['state'] as string;
            if (state === 'COMPLETED' || state === 'FAILED' || state === 'REVOKED') {
              return err('MISSION_NOT_ACTIVE', 'Mission is not in active state', 'SC-11');
            }
          }
        }

        // 12. Per-mission claim limit
        const countRow = conn.get<{ cnt: number }>(
          'SELECT COUNT(*) as cnt FROM claim_assertions WHERE tenant_id IS ? AND source_mission_id = ?',
          [ctx.tenantId, input.missionId],
        );
        if ((countRow?.cnt ?? 0) >= CLAIM_PER_MISSION_LIMIT) {
          return err('CLAIM_LIMIT_EXCEEDED', `Per-mission claim limit (${CLAIM_PER_MISSION_LIMIT}) exceeded`, 'SC-11');
        }

        // 12b. Per-artifact claim limit (SC-4 amendment)
        const artifactRefs = input.evidenceRefs.filter(r => r.type === 'artifact');
        for (const artRef of artifactRefs) {
          const artCount = conn.get<{ cnt: number }>(
            'SELECT COUNT(*) as cnt FROM claim_artifact_refs WHERE artifact_id = ?',
            [artRef.id],
          );
          if ((artCount?.cnt ?? 0) >= CLAIM_PER_ARTIFACT_LIMIT) {
            return err('ARTIFACT_CLAIM_LIMIT', `Per-artifact claim limit (${CLAIM_PER_ARTIFACT_LIMIT}) exceeded`, 'SC-4');
          }
        }

        // 13. Grounding validation
        let groundingResult: GroundingResult;
        if (input.groundingMode === 'evidence_path') {
          const gResult = stores.grounding.validateWithRetractedCheck(
            conn, '' as ClaimId, input.evidenceRefs,
            input.groundingMode, CLAIM_GROUNDING_MAX_HOPS,
          );
          if (!gResult.ok) return gResult;
          groundingResult = gResult.value;
          if (!groundingResult.grounded) {
            // DC-SC11-111, F-004/F-010: Distinguish retraction-contaminated grounding from generic depth exceeded.
            // If failureReason indicates a retracted intermediate claim, return GROUNDING_RETRACTED_INTERMEDIATE.
            const isRetractionContaminated = groundingResult.failureReason?.includes('retracted') ?? false;
            const errorCode = isRetractionContaminated ? 'GROUNDING_RETRACTED_INTERMEDIATE' : 'GROUNDING_DEPTH_EXCEEDED';
            return err(errorCode, groundingResult.failureReason ?? 'Grounding failed', 'CF-05');
          }
        } else {
          const rw: GroundingResult = { grounded: true, mode: 'runtime_witness' };
          if (input.runtimeWitness) {
            (rw as { witnessBinding: RuntimeWitnessInput }).witnessBinding = input.runtimeWitness;
          }
          groundingResult = rw;
        }

        // 13b. Phase 9: Security scanning (PII detection + injection defense + poisoning)
        // Runs after validation, before INSERT. I-P9-03: Same transaction.
        const securityPolicy = deps.securityPolicy ?? DEFAULT_SECURITY_POLICY;
        let contentScanResult: ContentScanResult | null = null;

        // Phase 9: Content scanning (PII + injection)
        if (securityPolicy.pii.enabled || securityPolicy.injection.enabled) {
          const objectValueStr = typeof input.object.value === 'string'
            ? input.object.value
            : JSON.stringify(input.object.value);
          contentScanResult = scanClaimContent(
            { subject: input.subject, predicate: input.predicate, objectValue: objectValueStr },
            securityPolicy,
            deps.time,
          );

          // I-P9-04: PII reject enforcement
          if (securityPolicy.pii.action === 'reject' && contentScanResult.pii.hasPii) {
            return err(
              'PII_DETECTED_REJECT',
              `PII detected in claim content: ${contentScanResult.pii.categories.join(', ')}`,
              'I-P9-04',
            );
          }

          // I-P9-11: Injection reject enforcement
          if (securityPolicy.injection.action === 'reject' && contentScanResult.injection.detected) {
            return err(
              'INJECTION_DETECTED_REJECT',
              `Prompt injection detected: severity ${contentScanResult.injection.severity}`,
              'I-P9-11',
            );
          }
        }

        // Phase 9: Poisoning defense (burst limit + diversity check)
        // F-P9-020: Fall back to '__anonymous__' when agentId is absent (e.g., convenience API)
        // so that poisoning defense is still enforced for non-agent claim paths.
        if (securityPolicy.poisoning.enabled) {
          const effectiveAgentId = ctx.agentId ?? '__anonymous__';
          const poisoningVerdict = checkPoisoning(
            conn, effectiveAgentId, ctx.tenantId, input.subject,
            securityPolicy, deps.time,
          );
          if (!poisoningVerdict.allowed) {
            // Determine specific error code based on reason
            const code = poisoningVerdict.reason?.includes('burst')
              ? 'POISONING_BURST_LIMIT'
              : 'POISONING_LOW_DIVERSITY';
            return err(code, poisoningVerdict.reason ?? 'Poisoning defense triggered', 'I-P9-30');
          }
        }

        // 14. WMP pre-emission capture (optional)
        let wmpCaptureId: string | undefined;
        let wmpSourcingStatus: string | undefined;
        if (deps.wmpCapture && input.taskId) {
          const captureResult = deps.wmpCapture.capture(conn, input.taskId);
          if (!captureResult.ok) return captureResult as Result<AssertClaimOutput>;
          wmpCaptureId = captureResult.value.captureId;
          wmpSourcingStatus = captureResult.value.sourcingStatus;
        }

        // 15. Create claim
        const createResult = stores.store.create(conn, ctx, input);
        if (!createResult.ok) return createResult as unknown as Result<AssertClaimOutput>;
        const claim = createResult.value;

        // 15b. Phase 9: Write security scan columns (I-P9-01, I-P9-03: same transaction)
        if (contentScanResult) {
          // Check if v42 schema columns exist (module-level cached detection)
          const hasSecCols = hasPiiDetectedColumn(conn);
          if (hasSecCols) {
            const piiDetected = contentScanResult.pii.hasPii ? 1 : 0;
            const piiCategories = contentScanResult.pii.hasPii
              ? JSON.stringify(contentScanResult.pii.categories)
              : null;
            // I-P9-02: ContentScanResult stored as JSON — matches contain offset+length, NOT matched text.
            const scanResultJson = JSON.stringify(contentScanResult);

            conn.run(
              `UPDATE claim_assertions SET pii_detected = ?, pii_categories = ?, content_scan_result = ? WHERE id = ?`,
              [piiDetected, piiCategories, scanResultJson, claim.id],
            );
          }
        }

        // 15c. Phase 10: Auto-classification (I-P10-01, I-P10-02, I-P10-03: same transaction)
        {
          const hasClassCols = hasClassificationColumn(conn);
          if (hasClassCols) {
            // F-P10-001 fix: Use dynamic getter when available (reads from DB at assertion time)
            const rules = deps.getClassificationRules
              ? deps.getClassificationRules()
              : (deps.classificationRules ?? []);
            const allRules = rules.length > 0 ? rules : DEFAULT_CLASSIFICATION_RULES;
            const defaultLevel = deps.classificationDefaultLevel ?? 'unrestricted';
            const classResult = classify(input.predicate, allRules, defaultLevel);

            conn.run(
              `UPDATE claim_assertions SET classification = ?, classification_rule_id = ? WHERE id = ?`,
              [classResult.level, classResult.matchedRule, claim.id],
            );
          }
        }

        // 16. Create evidence rows
        if (input.evidenceRefs.length > 0) {
          const evResult = stores.evidence.createBatch(conn, claim.id, input.evidenceRefs);
          if (!evResult.ok) return evResult as unknown as Result<AssertClaimOutput>;
        }

        // 17. Create artifact junction rows for artifact evidence
        for (const ref of input.evidenceRefs) {
          if (ref.type === 'artifact') {
            stores.artifactRefs.createBatch(conn, ref.id as ArtifactId, [claim.id]);
          }
        }

        // 17b. Phase 4 §4.1: Structural conflict detection (I-P4-06: synchronous)
        // Detect existing active claims with same subject+predicate but different value.
        // Create 'contradicts' relationships for each conflict found.
        // Design Source Decision 1: Post-creation, same transaction.
        const autoConflictEnabled = deps.autoConflict !== false; // default true
        let conflictCount = 0;
        if (autoConflictEnabled) {
          // object_value is stored as JSON.stringify(input.object.value) in the DB
          const serializedValue = JSON.stringify(input.object.value);
          const conflicts = detectStructuralConflicts(
            conn, claim.id, input.subject, input.predicate, serializedValue,
          );
          for (const existingId of conflicts.conflictingClaimIds) {
            // Create directional contradicts: new claim -> existing claim
            // CCP-I6: Append-only relationships. Same transaction as assertion.
            const relId = newId();
            conn.run(
              `INSERT INTO claim_relationships (id, from_claim_id, to_claim_id, type, declared_by_agent_id, mission_id, created_at, tenant_id)
               VALUES (?, ?, ?, 'contradicts', ?, ?, ?, ?)`,
              [relId, claim.id, existingId, ctx.agentId ?? 'system', input.missionId ?? '', deps.time.nowISO(), ctx.tenantId],
            );
            conflictCount++;

            // Audit the auto-created contradiction
            deps.audit.append(conn, {
              tenantId: ctx.tenantId,
              actorType: 'system',
              actorId: 'conflict_detector',
              operation: 'auto_contradiction',
              resourceType: 'claim_relationship',
              resourceId: relId,
              detail: {
                fromClaimId: claim.id,
                toClaimId: existingId,
                type: 'contradicts',
                reason: 'structural_conflict',
                newSubject: input.subject,
                newPredicate: input.predicate,
              },
            });
          }
        }

        // 18. Audit entry (I-03: same transaction)
        deps.audit.append(conn, {
          tenantId: ctx.tenantId,
          actorType: ctx.agentId ? 'agent' : 'system',
          actorId: ctx.agentId ?? 'system',
          operation: 'claim_asserted',
          resourceType: 'claim',
          resourceId: claim.id,
          detail: {
            groundingMode: input.groundingMode,
            evidenceCount: input.evidenceRefs.length,
            confidence: input.confidence,
            traversalPath: groundingResult.traversalPath,
            ...(wmpCaptureId ? { preEmissionWmpCaptureId: wmpCaptureId, wmpSourcingStatus } : {}),
            ...(conflictCount > 0 ? { conflictsDetected: conflictCount } : {}),
          },
        });

        // 19. Domain event emission (EventBus)
        deps.eventBus.emit(conn, ctx, {
          type: CCP_EVENTS.CLAIM_ASSERTED.type,
          scope: CCP_EVENTS.CLAIM_ASSERTED.scope,
          propagation: CCP_EVENTS.CLAIM_ASSERTED.propagation,
          missionId: input.missionId,
          payload: {
            claimId: claim.id,
            subject: claim.subject,
            predicate: claim.predicate,
            groundingMode: claim.groundingMode,
            confidence: claim.confidence,
          },
        });

        // 20. Trace emission (Binding 14: same transaction)
        if (deps.traceEmitter) {
          // claim.asserted trace
          deps.traceEmitter.emit(conn, ctx, {
            runId: 'run-ccp' as RunId,
            correlationId,
            type: CCP_TRACE_EVENTS.CLAIM_ASSERTED,
            payload: {
              type: CCP_TRACE_EVENTS.CLAIM_ASSERTED,
              claimId: claim.id as string,
              agentId: ctx.agentId as AgentId,
            },
          });

          // claim.grounded trace (only on grounding success)
          if (groundingResult.grounded) {
            deps.traceEmitter.emit(conn, ctx, {
              runId: 'run-ccp' as RunId,
              correlationId,
              type: CCP_TRACE_EVENTS.CLAIM_GROUNDED,
              payload: {
                type: CCP_TRACE_EVENTS.CLAIM_GROUNDED,
                claimId: claim.id as string,
                evidenceCount: input.evidenceRefs.length,
              },
            });
          }
        }

        return ok({
          claim,
          grounding: groundingResult,
        });
      });
    },
  });
}

// ============================================================================
// RetractClaimHandler Implementation — §14.4
// ============================================================================

function createRetractClaimHandlerImpl(
  deps: ClaimSystemDeps,
  stores: { store: ClaimStore; evidence: ClaimEvidenceStore },
): RetractClaimHandler {
  return Object.freeze({
    execute(conn: DatabaseConnection, ctx: OperationContext, input: RetractClaimInput): Result<void> {
      return conn.transaction(() => {
        const correlationId = newId() as CorrelationId;

        // 0. Authorization
        if (!isAuthorized(ctx)) {
          return err('UNAUTHORIZED', 'Agent not authorized to retract claims', 'SC-11');
        }

        // 1. Validate reason (non-empty)
        if (!input.reason || input.reason.trim().length === 0) {
          return err('INVALID_REASON', 'Retraction reason is required', '§10.4');
        }

        // 1b. Phase 4 §4.4: Validate reason against taxonomy (I-P4-15, I-P4-17)
        if (!(VALID_RETRACTION_REASONS as readonly string[]).includes(input.reason)) {
          return err(
            'INVALID_REASON',
            `Invalid retraction reason: '${input.reason}'. Must be one of: ${VALID_RETRACTION_REASONS.join(', ')}`,
            'A.2 Rule 5',
          );
        }

        // 2. Get claim (tenant-scoped)
        const getResult = stores.store.get(conn, input.claimId, ctx.tenantId);
        if (!getResult.ok) {
          return err('CLAIM_NOT_FOUND', `Claim ${input.claimId} not found`, '§10.4');
        }
        const claim = getResult.value;

        // 2b. Phase 10: Protected predicate guard for retraction (I-P10-10, I-P10-11, I-P10-12)
        // F-P10-003 fix: Use dynamic getter when available (reads from DB at retract time)
        {
          const protectedRules = deps.getProtectedPredicateRules
            ? deps.getProtectedPredicateRules()
            : (deps.protectedPredicateRules ?? []);
          const rbacActive = deps.getRbacActive
            ? deps.getRbacActive()
            : (deps.rbacActive ?? false);
          if (claim.predicate && protectedRules.length > 0) {
            const guardResult = checkPredicateGuard(
              claim.predicate,
              'retract',
              ctx,
              rbacActive,
              protectedRules,
            );
            if (!guardResult.ok) return guardResult;
          }
        }

        // 3. Authorization: source agent or admin
        if (claim.sourceAgentId !== ctx.agentId) {
          const hasAdmin = ctx.permissions.has('manage_roles') || ctx.permissions.has('purge_data');
          if (!hasAdmin) {
            return err('UNAUTHORIZED', 'Only source agent or admin can retract', '§10.4');
          }
        }

        // 4. Check if already retracted
        if (claim.status === 'retracted') {
          return err('CLAIM_ALREADY_RETRACTED', 'Claim is already retracted', 'CCP-I2');
        }

        // 5. Retract (trigger enforces forward-only)
        const retractResult = stores.store.retract(conn, ctx, input.claimId, input.reason);
        if (!retractResult.ok) return retractResult;

        // 6. Audit (I-03)
        deps.audit.append(conn, {
          tenantId: ctx.tenantId,
          actorType: ctx.agentId ? 'agent' : 'system',
          actorId: ctx.agentId ?? 'system',
          operation: 'claim_retracted',
          resourceType: 'claim',
          resourceId: input.claimId,
          detail: {
            claimId: input.claimId,
            oldStatus: 'active',
            newStatus: 'retracted',
            reason: input.reason,
            actor: ctx.agentId,
            timestamp: deps.time.nowISO(),
          },
        });

        // 7. Domain event: claim.retracted
        deps.eventBus.emit(conn, ctx, {
          type: CCP_EVENTS.CLAIM_RETRACTED.type,
          scope: CCP_EVENTS.CLAIM_RETRACTED.scope,
          propagation: CCP_EVENTS.CLAIM_RETRACTED.propagation,
          payload: {
            claimId: input.claimId,
            reason: input.reason,
            actor: ctx.agentId,
          },
        });

        // 8. Notification cascade: one-edge-deep (CCP-I14)
        // Find direct dependents (claims that reference this claim as evidence)
        const dependentEvidence = stores.evidence.getBySourceId(conn, 'claim', input.claimId as string);
        if (dependentEvidence.ok) {
          for (const ev of dependentEvidence.value) {
            deps.eventBus.emit(conn, ctx, {
              type: CCP_EVENTS.CLAIM_EVIDENCE_RETRACTED.type,
              scope: CCP_EVENTS.CLAIM_EVIDENCE_RETRACTED.scope,
              propagation: CCP_EVENTS.CLAIM_EVIDENCE_RETRACTED.propagation,
              payload: {
                dependentClaimId: ev.claimId,
                retractedClaimId: input.claimId,
                sourceClaimId: input.claimId,
                claimId: ev.claimId,
              },
            });
          }
        }

        // 9. Trace: claim.retracted (Binding 14)
        if (deps.traceEmitter) {
          deps.traceEmitter.emit(conn, ctx, {
            runId: 'run-ccp' as RunId,
            correlationId,
            type: CCP_TRACE_EVENTS.CLAIM_RETRACTED,
            payload: {
              type: CCP_TRACE_EVENTS.CLAIM_RETRACTED,
              claimId: input.claimId as string,
              reason: input.reason,
            },
          });
        }

        return ok(undefined);
      });
    },
  });
}

// ============================================================================
// RelateClaimsHandler Implementation — SC-12
// ============================================================================

function createRelateClaimsHandlerImpl(
  deps: ClaimSystemDeps,
  stores: { store: ClaimStore; relationships: ClaimRelationshipStore },
): RelateClaimsHandler {
  return Object.freeze({
    execute(conn: DatabaseConnection, ctx: OperationContext, input: RelationshipCreateInput): Result<RelateClaimsOutput> {
      return conn.transaction(() => {
        const correlationId = newId() as CorrelationId;

        // 0. Authorization
        if (!isAuthorized(ctx)) {
          return err('UNAUTHORIZED', 'Agent not authorized to create relationships', 'SC-12');
        }

        // 0a. Rate limit
        if (!checkRateLimit(ctx.agentId, deps.time)) {
          return err('RATE_LIMITED', 'Rate limit exceeded', 'SC-12');
        }

        // 1. Validate relationship type
        const validTypes: RelationshipType[] = ['supports', 'contradicts', 'supersedes', 'derived_from'];
        if (!validTypes.includes(input.type)) {
          return err('INVALID_RELATIONSHIP_TYPE', `Invalid type: ${input.type}`, 'I-31');
        }

        // 2. Self-reference check
        if (input.fromClaimId === input.toClaimId) {
          return err('SELF_REFERENCE', 'Cannot create self-referencing relationship', 'I-31');
        }

        // 3. Mission state validation
        if (input.missionId) {
          const missionRow = conn.get<Record<string, unknown>>(
            'SELECT state FROM core_missions WHERE id = ? AND tenant_id IS ?',
            [input.missionId, ctx.tenantId],
          );
          if (missionRow) {
            const state = missionRow['state'] as string;
            if (state === 'COMPLETED' || state === 'FAILED' || state === 'REVOKED') {
              return err('MISSION_NOT_ACTIVE', 'Mission is not in active state', 'SC-12');
            }
          }
        }

        // 4. Get from claim (must exist)
        const fromResult = stores.store.get(conn, input.fromClaimId, null);
        if (!fromResult.ok) {
          return err('CLAIM_NOT_FOUND', `Source claim ${input.fromClaimId} not found`, 'I-31');
        }

        // 5. Cross-tenant check
        const fromClaim = fromResult.value;
        if (ctx.tenantId !== null && fromClaim.tenantId !== ctx.tenantId) {
          return err('CROSS_TENANT', 'Source claim belongs to different tenant', 'CCP-LI-06');
        }

        // 6. From claim must be active
        if (fromClaim.status !== 'active') {
          return err('CLAIM_NOT_ACTIVE', 'Source claim must be active', 'I-31');
        }

        // 7. Get to claim (must exist)
        const toResult = stores.store.get(conn, input.toClaimId, null);
        if (!toResult.ok) {
          return err('CLAIM_NOT_FOUND', `Target claim ${input.toClaimId} not found`, 'I-31');
        }

        // 8. Cross-tenant on target
        const toClaim = toResult.value;
        if (ctx.tenantId !== null && fromClaim.tenantId !== toClaim.tenantId) {
          return err('CROSS_TENANT', 'Claims belong to different tenants', 'CCP-LI-06');
        }

        // 9. Outgoing relationship limit
        const countResult = stores.relationships.countOutgoing(conn, input.fromClaimId);
        if (countResult.ok && countResult.value >= CLAIM_MAX_OUTGOING_RELATIONSHIPS) {
          return err('RELATIONSHIP_LIMIT_EXCEEDED', `Outgoing relationship limit (${CLAIM_MAX_OUTGOING_RELATIONSHIPS}) exceeded`, 'I-31');
        }

        // 10. Create relationship
        const createResult = stores.relationships.create(conn, ctx, input);
        if (!createResult.ok) return createResult as unknown as Result<RelateClaimsOutput>;

        // 11. Audit (I-03)
        deps.audit.append(conn, {
          tenantId: ctx.tenantId,
          actorType: ctx.agentId ? 'agent' : 'system',
          actorId: ctx.agentId ?? 'system',
          operation: 'claim_relationship_declared',
          resourceType: 'claim_relationship',
          resourceId: createResult.value.id,
          detail: {
            fromClaimId: input.fromClaimId,
            toClaimId: input.toClaimId,
            type: input.type,
          },
        });

        // 12. Domain event: claim.relationship.declared
        deps.eventBus.emit(conn, ctx, {
          type: CCP_EVENTS.CLAIM_RELATIONSHIP_DECLARED.type,
          scope: CCP_EVENTS.CLAIM_RELATIONSHIP_DECLARED.scope,
          propagation: CCP_EVENTS.CLAIM_RELATIONSHIP_DECLARED.propagation,
          missionId: input.missionId,
          payload: {
            fromClaimId: input.fromClaimId,
            toClaimId: input.toClaimId,
            type: input.type,
            relationshipId: createResult.value.id,
          },
        });

        // 13. Trace: claim.challenged on contradicts (DC-CCP-512)
        if (input.type === 'contradicts' && deps.traceEmitter) {
          deps.traceEmitter.emit(conn, ctx, {
            runId: 'run-ccp' as RunId,
            correlationId,
            type: CCP_TRACE_EVENTS.CLAIM_CHALLENGED,
            payload: {
              type: CCP_TRACE_EVENTS.CLAIM_CHALLENGED,
              claimId: input.toClaimId as string,
              challengerId: ctx.agentId as AgentId,
            },
          });
        }

        return ok({ relationship: createResult.value });
      });
    },
  });
}

// ============================================================================
// QueryClaimsHandler Implementation — SC-13
// ============================================================================

function createQueryClaimsHandlerImpl(
  deps: ClaimSystemDeps,
  stores: { store: ClaimStore; evidence: ClaimEvidenceStore; relationships: ClaimRelationshipStore },
): QueryClaimsHandler {
  return Object.freeze({
    execute(conn: DatabaseConnection, ctx: OperationContext, input: ClaimQueryInput): Result<ClaimQueryResult> {
      // 0. Authorization
      if (!isAuthorized(ctx)) {
        return err('UNAUTHORIZED', 'Agent not authorized to query claims', 'SC-13');
      }

      // 0a. Rate limit
      if (!checkRateLimit(ctx.agentId, deps.time)) {
        return err('RATE_LIMITED', 'Rate limit exceeded', 'SC-13');
      }

      // 1. Validate limit
      if (input.limit !== undefined && input.limit !== null && input.limit > CLAIM_QUERY_MAX_LIMIT) {
        return err('LIMIT_EXCEEDED', `Limit exceeds maximum of ${CLAIM_QUERY_MAX_LIMIT}`, 'SC-13');
      }

      // 2. Validate at least one filter provided
      const hasFilter = (
        (input.subject !== undefined && input.subject !== null) ||
        (input.predicate !== undefined && input.predicate !== null) ||
        (input.status !== undefined && input.status !== null) ||
        (input.minConfidence !== undefined && input.minConfidence !== null) ||
        (input.sourceAgentId !== undefined && input.sourceAgentId !== null) ||
        (input.sourceMissionId !== undefined && input.sourceMissionId !== null) ||
        (input.validAtFrom !== undefined && input.validAtFrom !== null) ||
        (input.validAtTo !== undefined && input.validAtTo !== null) ||
        ('missionId' in input && (input as Record<string, unknown>)['missionId'] !== undefined)
      );
      if (!hasFilter) {
        return err('NO_FILTERS', 'At least one filter must be provided', 'SC-13');
      }

      // 3. Validate subject filter format
      if (input.subject !== undefined && input.subject !== null) {
        if (!isValidSubjectFilter(input.subject)) {
          return err('INVALID_SUBJECT_FILTER', `Invalid subject filter: ${input.subject}`, 'AMB-14');
        }
      }

      // 4. Validate predicate filter format
      if (input.predicate !== undefined && input.predicate !== null) {
        if (!isValidPredicateFilter(input.predicate)) {
          return err('INVALID_PREDICATE_FILTER', `Invalid predicate filter: ${input.predicate}`, 'AMB-14');
        }
      }

      // 5. Mission state validation for sourceMissionId filter
      if (input.sourceMissionId) {
        const missionRow = conn.get<Record<string, unknown>>(
          'SELECT state FROM core_missions WHERE id = ? AND tenant_id IS ?',
          [input.sourceMissionId, ctx.tenantId],
        );
        if (missionRow) {
          const state = missionRow['state'] as string;
          if (state === 'COMPLETED' || state === 'FAILED' || state === 'REVOKED') {
            return err('MISSION_NOT_ACTIVE', 'Mission is not in active state', 'SC-13');
          }
        }
      }

      // 6. Delegate to store
      return stores.store.query(conn, ctx.tenantId, input);
    },
  });
}

// ============================================================================
// ClaimSystem Factory — wires everything together
// ============================================================================

export function createClaimSystem(deps: ClaimSystemDeps): ClaimSystem {
  // Reset rate limits per test run
  resetRateLimits();

  // Create stores
  const store = createClaimStoreImpl(deps);
  const evidence = createClaimEvidenceStoreImpl(deps);
  const relationships = createClaimRelationshipStoreImpl(deps);
  const artifactRefs = createClaimArtifactRefStoreImpl(deps);

  // Create grounding validator
  const grounding = createGroundingValidatorImpl(deps, { store, evidence });

  // Create lifecycle projection
  const lifecycleProjection = createClaimLifecycleProjectionImpl();

  // Create handlers
  const assertClaim = createAssertClaimHandlerImpl(deps, { store, evidence, artifactRefs, grounding });
  const retractClaim = createRetractClaimHandlerImpl(deps, { store, evidence });
  const relateClaims = createRelateClaimsHandlerImpl(deps, { store, relationships });
  const queryClaims = createQueryClaimsHandlerImpl(deps, { store, evidence, relationships });

  // Wire tombstone event and evidence cascade to the store operations
  const storeWithEvents: ClaimStore = {
    ...store,
    tombstone(conn: DatabaseConnection, claimId: ClaimId, tenantId: TenantId | null, reason: string): Result<void> {
      return conn.transaction(() => {
        // Tombstone the claim
        const result = store.tombstone(conn, claimId, tenantId, reason);
        if (!result.ok) return result;

        // Update evidence rows pointing to this claim (sourceState → tombstoned)
        evidence.markSourceTombstoned(conn, 'claim', claimId as string);

        // Emit claim.tombstoned event
        const dummyCtx: OperationContext = {
          tenantId: tenantId,
          userId: null,
          agentId: null,
          permissions: new Set(),
        };
        deps.eventBus.emit(conn, dummyCtx, {
          type: CCP_EVENTS.CLAIM_TOMBSTONED.type,
          scope: CCP_EVENTS.CLAIM_TOMBSTONED.scope,
          propagation: CCP_EVENTS.CLAIM_TOMBSTONED.propagation,
          payload: { claimId, purgeReason: reason },
        });

        // Audit
        deps.audit.append(conn, {
          tenantId,
          actorType: 'system',
          actorId: 'system',
          operation: 'claim_tombstoned',
          resourceType: 'claim',
          resourceId: claimId,
          detail: { reason },
        });

        return ok(undefined);
      });
    },

    archive(conn: DatabaseConnection, claimId: ClaimId, tenantId: TenantId | null): Result<void> {
      return conn.transaction(() => {
        const result = store.archive(conn, claimId, tenantId);
        if (!result.ok) return result;

        // Audit
        deps.audit.append(conn, {
          tenantId,
          actorType: 'system',
          actorId: 'system',
          operation: 'claim_archived',
          resourceType: 'claim',
          resourceId: claimId,
        });

        return ok(undefined);
      });
    },
  };

  // Wire evidence store with event emission for markSourceTombstoned
  const evidenceWithEvents: ClaimEvidenceStore = {
    ...evidence,
    markSourceTombstoned(conn: DatabaseConnection, evidenceType: EvidenceType, evidenceId: string): Result<number> {
      const result = evidence.markSourceTombstoned(conn, evidenceType, evidenceId);
      if (!result.ok) return result;

      // Emit claim.evidence.orphaned for non-claim sources
      if (evidenceType !== 'claim') {
        // Get affected evidence rows to know which claims are affected
        const affected = evidence.getBySourceId(conn, evidenceType, evidenceId);
        if (affected.ok) {
          const dummyCtx: OperationContext = {
            tenantId: null,
            userId: null,
            agentId: null,
            permissions: new Set(),
          };
          for (const ev of affected.value) {
            deps.eventBus.emit(conn, dummyCtx, {
              type: CCP_EVENTS.CLAIM_EVIDENCE_ORPHANED.type,
              scope: CCP_EVENTS.CLAIM_EVIDENCE_ORPHANED.scope,
              propagation: CCP_EVENTS.CLAIM_EVIDENCE_ORPHANED.propagation,
              payload: {
                claimId: ev.claimId,
                evidenceType,
                evidenceId,
                sourceType: evidenceType,
                sourceId: evidenceId,
              },
            });
          }
        }
      }

      return result;
    },
  };

  return Object.freeze({
    store: storeWithEvents,
    evidence: evidenceWithEvents,
    relationships,
    artifactRefs,
    assertClaim,
    retractClaim,
    relateClaims,
    queryClaims,
    grounding,
    lifecycleProjection,
  });
}
