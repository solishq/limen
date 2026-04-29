/**
 * FR-006: Context Compiler — compiles claims into reasoning-ready context.
 *
 * Transforms raw claim query results into AI-consumable compiled context.
 * Three output formats:
 *   - 'reasoning-ready': Human/AI-readable text with semantic category labels
 *   - 'structured': JSON object with claims categorized by predicate namespace
 *   - 'raw': JSON array of claim data (same shape as queryClaims output)
 *
 * Design derivation: An AI agent consuming Limen knowledge needs:
 *   1. Semantic labels (DECIDED, CORRECTION, CONSTRAINT) — not raw predicates
 *   2. Confidence + temporal context per claim — not just values
 *   3. Token-bounded output — never unbounded context injection
 *   4. Staleness signal — the agent must know if its context is stale
 *   5. Deterministic output — same input always produces same text
 *
 * Phase: v4.0.0 Phase 2
 * Spec ref: FR-006 (Context Compiler)
 *
 * Truth model:
 *   I-CC-01: Empty domain string returns COMPILE_EMPTY_DOMAIN error
 *   I-CC-02: Non-existent domain returns empty context (0 claims, no error)
 *   I-CC-03: Predicate filter restricts output to matching predicates
 *   I-CC-04: maxTokens truncates output with omission notice
 *   I-CC-05: Deterministic — same input produces identical output
 *   I-CC-06: staleness derived from oldest included claim's freshness
 *   I-CC-07: Token estimation uses ~4 chars per token
 */

import type { TenantScopedConnection } from '../kernel/tenant/tenant_scope.js';
import type { TenantId } from '../kernel/interfaces/common.js';
import type { Result } from '../kernel/interfaces/common.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type { FreshnessThresholds, FreshnessLabel } from './freshness.js';
import type { StabilityConfig } from './stability.js';
import { classifyFreshness } from './freshness.js';
import { computeDecayFactor, computeAgeMs } from './decay.js';
import { computeCascadePenalty } from './cascade.js';
import { resolveStability } from './stability.js';
import { escapeLikeWildcards } from '../kernel/sql_utils.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the context compiler.
 * FR-006: Controls what to compile and how to format it.
 */
export interface CompileOptions {
  /** Subject pattern — used as prefix filter (e.g., 'entity:project:veridion'). */
  readonly domain: string;
  /** Predicate patterns to include (e.g., ['decision.*', 'correction.*']). */
  readonly predicates?: readonly string[];
  /** Output format. Default: 'reasoning-ready'. */
  readonly format?: CompileFormat;
  /** Approximate token budget. Default: 2000. ~4 chars per token. */
  readonly maxTokens?: number;
  /** Sort order. Default: 'recency'. */
  readonly priority?: CompilePriority;
  /** Include contradiction/supersession context. Default: false. */
  readonly includeRelationships?: boolean;
}

export type CompileFormat = 'reasoning-ready' | 'structured' | 'raw';
export type CompilePriority = 'recency' | 'confidence' | 'relevance';

/**
 * Result of context compilation.
 * FR-006: Provides the compiled output with metadata.
 */
export interface CompiledContext {
  /** The compiled output (text for reasoning-ready, JSON string for structured/raw). */
  readonly text: string;
  /** How many claims were compiled. */
  readonly claimCount: number;
  /** Approximate token count (~4 chars per token). */
  readonly estimatedTokens: number;
  /** Oldest included claim's freshness classification. */
  readonly staleness: FreshnessLabel;
  /** ISO timestamp of most recent included claim. */
  readonly lastUpdated: string;
}

// ============================================================================
// Internal Types
// ============================================================================

/** Raw claim row from the database. */
interface ClaimRow {
  readonly id: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object_value: string;
  readonly confidence: number;
  readonly valid_at: string;
  readonly created_at: string;
  readonly status: string;
  readonly last_accessed_at: string | null;
}

/** Relationship row from the database. */
interface RelationshipRow {
  readonly from_claim_id: string;
  readonly to_claim_id: string;
  readonly type: string;
}

/** Enriched claim after query-time computation. */
interface EnrichedClaim {
  readonly id: string;
  readonly subject: string;
  readonly predicate: string;
  readonly value: string;
  readonly confidence: number;
  readonly effectiveConfidence: number;
  readonly validAt: string;
  readonly freshness: FreshnessLabel;
  readonly relationships: readonly RelationshipRow[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_FORMAT: CompileFormat = 'reasoning-ready';
const DEFAULT_PRIORITY: CompilePriority = 'recency';
const CHARS_PER_TOKEN = 4;

/**
 * Predicate namespace to semantic label mapping.
 * Derived from first principles: what does an AI agent need to understand
 * about a piece of knowledge? Its *epistemic category*.
 *
 * An agent seeing "DECIDED" knows it is a settled decision.
 * An agent seeing "CORRECTION" knows a prior belief was wrong.
 * These categories are more useful than raw predicate strings.
 */
const PREDICATE_CATEGORY_MAP: Readonly<Record<string, string>> = {
  'decision': 'DECIDED',
  'correction': 'CORRECTION',
  'finding': 'FINDING',
  'constraint': 'CONSTRAINT',
  'observation': 'OBSERVED',
  'preference': 'PREFERS',
  'warning': 'WARNING',
  'pattern': 'PATTERN',
  'knowledge': 'KNOWS',
  'attack': 'THREAT',
  'reasoning': 'REASONED',
  'failure': 'FAILURE',
  'reflection': 'REFLECTED',
};

const DEFAULT_CATEGORY = 'KNOWS';

// ============================================================================
// Dependencies
// ============================================================================

export interface ContextCompilerDeps {
  readonly getConnection: () => TenantScopedConnection;
  readonly getTenantId: () => TenantId | null;
  readonly time: TimeProvider;
  readonly freshnessThresholds?: FreshnessThresholds | undefined;
  readonly stabilityConfig?: StabilityConfig | undefined;
}

// ============================================================================
// Result Helpers
// ============================================================================

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message, spec: 'FR-006' } };
}

// ============================================================================
// Core Implementation
// ============================================================================

/**
 * Compile claims from a domain into reasoning-ready context.
 *
 * Four phases:
 *   1. Query — fetch matching claims from the database
 *   2. Sort — order by the specified priority
 *   3. Compile — transform into the target format
 *   4. Truncate — enforce token budget
 *
 * I-CC-01: Empty domain returns error.
 * I-CC-02: Non-existent domain returns empty context.
 * I-CC-05: Deterministic output for identical inputs.
 */
export function compileContext(
  deps: ContextCompilerDeps,
  options: CompileOptions,
): Result<CompiledContext> {
  // ── Validation ──
  // I-CC-01: Empty domain is an error, not an empty result.
  // An agent calling compile('') is confused — fail fast.
  if (!options.domain || options.domain.trim().length === 0) {
    return err('COMPILE_EMPTY_DOMAIN', 'Domain must be a non-empty string');
  }

  const format = options.format ?? DEFAULT_FORMAT;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const priority = options.priority ?? DEFAULT_PRIORITY;
  const includeRels = options.includeRelationships ?? false;

  try {
    // ── Phase 1: Query ──
    const conn = deps.getConnection();
    const tenantId = deps.getTenantId();
    const nowMs = deps.time.nowMs();
    const nowISO = deps.time.nowISO();

    const claims = queryClaims(conn, tenantId, options.domain, options.predicates);

    // I-CC-02: Non-existent domain — return empty context, not error.
    if (claims.length === 0) {
      return ok({
        text: format === 'reasoning-ready'
          ? `Context for ${options.domain} (0 claims, compiled ${nowISO}):\nNo claims found.`
          : format === 'structured'
            ? JSON.stringify({ domain: options.domain, categories: {}, compiledAt: nowISO })
            : JSON.stringify([]),
        claimCount: 0,
        estimatedTokens: 0,
        staleness: 'stale' as FreshnessLabel,
        lastUpdated: '',
      });
    }

    // ── Enrich with computed fields ──
    const enriched = enrichClaims(claims, deps, nowMs, includeRels ? conn : null, tenantId);

    // ── Phase 2: Sort ──
    const sorted = sortClaims(enriched, priority);

    // ── Phase 3+4: Compile + Truncate ──
    return ok(compileAndTruncate(sorted, format, maxTokens, options.domain, nowISO, nowMs));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err('COMPILE_FAILED', `Context compilation failed: ${msg}`);
  }
}

// ============================================================================
// Phase 1: Query
// ============================================================================

/**
 * Query claims matching a domain (subject prefix) and optional predicate filters.
 * Uses direct SQL for efficiency — avoids the full ClaimQueryInput path which
 * does not support multi-predicate filtering in a single query.
 */
function queryClaims(
  conn: TenantScopedConnection,
  tenantId: TenantId | null,
  domain: string,
  predicates?: readonly string[],
): ClaimRow[] {
  const params: unknown[] = [];
  const conditions: string[] = ['status = ?'];
  params.push('active');

  // Tenant isolation
  if (tenantId !== null) {
    conditions.push('tenant_id = ?');
    params.push(tenantId);
  } else {
    conditions.push('tenant_id IS NULL');
  }

  // Subject prefix filter: domain acts as a prefix match
  // If domain doesn't end with *, treat it as exact-or-prefix
  if (domain.endsWith('*')) {
    const prefix = domain.slice(0, -1);
    conditions.push('subject LIKE ? ESCAPE \'\\\'');
    params.push(escapeLikeWildcards(prefix) + '%');
  } else {
    // Exact match OR prefix match (domain could be a full subject or a prefix)
    conditions.push('(subject = ? OR subject LIKE ? ESCAPE \'\\\')');
    params.push(domain, escapeLikeWildcards(domain) + '%');
  }

  // Predicate filters: OR-joined patterns
  if (predicates && predicates.length > 0) {
    const predConditions: string[] = [];
    for (const pattern of predicates) {
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        predConditions.push('predicate LIKE ? ESCAPE \'\\\'');
        params.push(escapeLikeWildcards(prefix) + '%');
      } else {
        predConditions.push('predicate = ?');
        params.push(pattern);
      }
    }
    conditions.push(`(${predConditions.join(' OR ')})`);
  }

  // Exclude archived claims
  conditions.push('archived = 0');

  const sql = `
    SELECT id, subject, predicate, object_value, confidence, valid_at, created_at, status, last_accessed_at
    FROM claim_assertions
    WHERE ${conditions.join(' AND ')}
    ORDER BY valid_at DESC
    LIMIT 500
  `;

  return conn.query<ClaimRow>(sql, params);
}

// ============================================================================
// Enrichment
// ============================================================================

function enrichClaims(
  claims: readonly ClaimRow[],
  deps: ContextCompilerDeps,
  nowMs: number,
  connForRels: TenantScopedConnection | null,
  tenantId: TenantId | null,
): EnrichedClaim[] {
  // Batch-fetch relationships if requested
  let relsByClaimId: Map<string, RelationshipRow[]> | null = null;
  if (connForRels && claims.length > 0) {
    relsByClaimId = fetchRelationships(connForRels, claims.map(c => c.id), tenantId);
  }

  return claims.map(claim => {
    // Compute effective confidence (same logic as recall path)
    const ageMs = computeAgeMs(claim.valid_at, nowMs);
    const stabilityDays = resolveStability(claim.predicate, deps.stabilityConfig);
    const decayFactor = computeDecayFactor(ageMs, stabilityDays);
    const cascadePenalty = computeCascadePenalty(deps.getConnection(), claim.id);
    const effectiveConfidence = claim.confidence * decayFactor * cascadePenalty;

    // Freshness classification
    const lastAccessedMs = claim.last_accessed_at ? new Date(claim.last_accessed_at).getTime() : null;
    const freshness = classifyFreshness(lastAccessedMs, nowMs, deps.freshnessThresholds);

    const relationships = relsByClaimId?.get(claim.id) ?? [];

    return {
      id: claim.id,
      subject: claim.subject,
      predicate: claim.predicate,
      value: String(claim.object_value),
      confidence: claim.confidence,
      effectiveConfidence,
      validAt: claim.valid_at,
      freshness,
      relationships,
    };
  });
}

/**
 * Batch-fetch relationships for a set of claim IDs.
 * Single query — avoids N+1.
 */
function fetchRelationships(
  conn: TenantScopedConnection,
  claimIds: readonly string[],
  tenantId: TenantId | null,
): Map<string, RelationshipRow[]> {
  if (claimIds.length === 0) return new Map();

  const placeholders = claimIds.map(() => '?').join(',');
  const params: unknown[] = [...claimIds];

  let tenantClause = '';
  if (tenantId !== null) {
    tenantClause = 'AND tenant_id = ?';
    params.push(tenantId);
  } else {
    tenantClause = 'AND tenant_id IS NULL';
  }

  const sql = `
    SELECT from_claim_id, to_claim_id, type
    FROM claim_relationships
    WHERE (from_claim_id IN (${placeholders}) OR to_claim_id IN (${placeholders}))
    ${tenantClause}
  `;

  // Duplicate claim IDs for the second IN clause
  const allParams = [...claimIds, ...claimIds, ...(tenantId !== null ? [tenantId] : [])];
  const rows = conn.query<RelationshipRow>(sql, allParams);

  const map = new Map<string, RelationshipRow[]>();
  for (const row of rows) {
    // Index by claim ID (both directions)
    for (const id of [row.from_claim_id, row.to_claim_id]) {
      if (claimIds.includes(id)) {
        const existing = map.get(id) ?? [];
        existing.push(row);
        map.set(id, existing);
      }
    }
  }
  return map;
}

// ============================================================================
// Phase 2: Sort
// ============================================================================

function sortClaims(claims: readonly EnrichedClaim[], priority: CompilePriority): EnrichedClaim[] {
  const sorted = [...claims];

  switch (priority) {
    case 'recency':
      // Most recent validAt first
      sorted.sort((a, b) => b.validAt.localeCompare(a.validAt));
      break;
    case 'confidence':
      // Highest effective confidence first
      sorted.sort((a, b) => b.effectiveConfidence - a.effectiveConfidence);
      break;
    case 'relevance':
      // Default: sort by recency (relevance ranking is a future enhancement)
      sorted.sort((a, b) => b.validAt.localeCompare(a.validAt));
      break;
  }

  return sorted;
}

// ============================================================================
// Phase 3+4: Compile + Truncate
// ============================================================================

function compileAndTruncate(
  claims: readonly EnrichedClaim[],
  format: CompileFormat,
  maxTokens: number,
  domain: string,
  nowISO: string,
  nowMs: number,
): CompiledContext {
  switch (format) {
    case 'raw':
      return compileRaw(claims, maxTokens, domain, nowISO);
    case 'structured':
      return compileStructured(claims, maxTokens, domain, nowISO);
    case 'reasoning-ready':
      return compileReasoningReady(claims, maxTokens, domain, nowISO, nowMs);
  }
}

// ── Raw Format ──

function compileRaw(
  claims: readonly EnrichedClaim[],
  maxTokens: number,
  _domain: string,
  _nowISO: string,
): CompiledContext {
  // Serialize claims as JSON array, truncating if needed
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  let included: readonly EnrichedClaim[] = claims;
  let omitted = 0;

  // Try full serialization first
  let text = JSON.stringify(claims.map(claimToRawObject));
  if (text.length > maxChars && claims.length > 1) {
    // Binary search for the right count
    let lo = 1;
    let hi = claims.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const attempt = JSON.stringify(claims.slice(0, mid).map(claimToRawObject));
      if (attempt.length <= maxChars) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    included = claims.slice(0, lo);
    omitted = claims.length - lo;
    const arr = included.map(claimToRawObject);
    if (omitted > 0) {
      // Type assertion needed for the sentinel object
      (arr as unknown[]).push({ __omitted: `${omitted} more claims omitted` });
    }
    text = JSON.stringify(arr);
  }

  return buildResult(text, included);
}

function claimToRawObject(c: EnrichedClaim): Record<string, unknown> {
  return {
    id: c.id,
    subject: c.subject,
    predicate: c.predicate,
    value: c.value,
    confidence: c.confidence,
    effectiveConfidence: Math.round(c.effectiveConfidence * 100) / 100,
    validAt: c.validAt,
    freshness: c.freshness,
  };
}

// ── Structured Format ──

function compileStructured(
  claims: readonly EnrichedClaim[],
  maxTokens: number,
  domain: string,
  nowISO: string,
): CompiledContext {
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  // Categorize claims by predicate namespace
  const categories: Record<string, unknown[]> = {};
  let includedCount = 0;
  let omittedCount = 0;

  for (const claim of claims) {
    const category = getCategory(claim.predicate);
    if (!categories[category]) {
      categories[category] = [];
    }

    const entry = {
      id: claim.id,
      predicate: claim.predicate,
      value: claim.value,
      confidence: Math.round(claim.effectiveConfidence * 100) / 100,
      validAt: claim.validAt,
      freshness: claim.freshness,
    };

    // Check if adding this entry would exceed budget
    const tentative = JSON.stringify({ domain, categories, compiledAt: nowISO });
    const entrySize = JSON.stringify(entry).length;
    if (tentative.length + entrySize > maxChars && includedCount > 0) {
      omittedCount = claims.length - includedCount;
      break;
    }

    categories[category].push(entry);
    includedCount++;
  }

  const result: Record<string, unknown> = { domain, categories, compiledAt: nowISO };
  if (omittedCount > 0) {
    result['omitted'] = `${omittedCount} more claims omitted`;
  }

  const text = JSON.stringify(result);
  const included = claims.slice(0, includedCount);

  return buildResult(text, included);
}

// ── Reasoning-Ready Format ──

function compileReasoningReady(
  claims: readonly EnrichedClaim[],
  maxTokens: number,
  domain: string,
  nowISO: string,
  nowMs: number,
): CompiledContext {
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  const header = `Context for ${domain} (${claims.length} claims, compiled ${nowISO}):`;
  const lines: string[] = [header];
  let currentChars = header.length + 1; // +1 for newline
  let includedCount = 0;

  for (const claim of claims) {
    const label = getCategoryLabel(claim.predicate);
    const line = formatReasoningLine(claim, label, nowMs);
    const lineChars = line.length + 1; // +1 for newline

    if (currentChars + lineChars > maxChars && includedCount > 0) {
      break;
    }

    lines.push(line);
    currentChars += lineChars;
    includedCount++;
  }

  const omitted = claims.length - includedCount;
  if (omitted > 0) {
    lines.push(`[... ${omitted} more claims omitted]`);
  }

  const text = lines.join('\n');
  const included = claims.slice(0, includedCount);

  return buildResult(text, included);
}

function formatReasoningLine(claim: EnrichedClaim, label: string, nowMs: number): string {
  const conf = Math.round(claim.effectiveConfidence * 100) / 100;
  const age = formatAge(claim.validAt, nowMs);
  const staleMarker = claim.freshness === 'stale' ? ', stale' : '';

  // Include relationship context if present
  let relContext = '';
  if (claim.relationships.length > 0) {
    const contradicts = claim.relationships.filter(r => r.type === 'contradicts');
    const supersedes = claim.relationships.filter(r => r.type === 'supersedes');
    const parts: string[] = [];
    if (contradicts.length > 0) parts.push(`${contradicts.length} contradiction(s)`);
    if (supersedes.length > 0) parts.push(`${supersedes.length} supersession(s)`);
    if (parts.length > 0) relContext = ` [${parts.join(', ')}]`;
  }

  return `${label}: ${claim.value} (confidence: ${conf}, ${age}${staleMarker})${relContext}`;
}

/**
 * Format a validAt timestamp as a human-readable relative age.
 * I-CC-05: Deterministic — uses injected nowMs, not Date.now().
 * Hard Stop #7: Clock injection — all temporal logic uses TimeProvider.
 */
function formatAge(validAt: string, nowMs: number): string {
  const validMs = new Date(validAt).getTime();
  const diffMs = nowMs - validMs;
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffDays < 1) return 'today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months}mo ago`;
  }
  const years = Math.floor(diffDays / 365);
  return `${years}y ago`;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract category label from predicate namespace.
 * 'decision.rationale' -> 'DECIDED'
 * 'correction.auth' -> 'CORRECTION'
 * 'unknown.thing' -> 'KNOWS'
 */
function getCategoryLabel(predicate: string): string {
  const namespace = predicate.split('.')[0] ?? '';
  return PREDICATE_CATEGORY_MAP[namespace] ?? DEFAULT_CATEGORY;
}

/**
 * Extract category key for structured format.
 * Uses the raw namespace, not the label.
 */
function getCategory(predicate: string): string {
  const parts = predicate.split('.');
  return parts[0] ?? 'unknown';
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function buildResult(
  text: string,
  included: readonly EnrichedClaim[],
): CompiledContext {
  const claimCount = included.length;

  // Staleness: worst (oldest) freshness among included claims
  // fresh < aging < stale — use the worst
  let staleness: FreshnessLabel = 'fresh';
  for (const claim of included) {
    if (claim.freshness === 'stale') { staleness = 'stale'; break; }
    if (claim.freshness === 'aging') { staleness = 'aging'; }
  }

  // Last updated: most recent validAt among included claims
  let lastUpdated = '';
  for (const claim of included) {
    if (claim.validAt > lastUpdated) {
      lastUpdated = claim.validAt;
    }
  }

  return {
    text,
    claimCount,
    estimatedTokens: estimateTokens(text),
    staleness,
    lastUpdated,
  };
}
