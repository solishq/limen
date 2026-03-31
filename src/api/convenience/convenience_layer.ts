/**
 * Phase 1 Convenience API Implementation.
 *
 * Thin delegation layer that translates cognitive operations (remember, recall,
 * forget, connect, reflect) into ClaimApi system calls. No new system calls.
 * No new database tables. No new schema.
 *
 * Design Source: docs/sprints/PHASE-1-DESIGN-SOURCE.md
 * Invariants: I-CONV-01 through I-CONV-18
 *
 * Architecture: This is the "store" layer in the three-file pattern.
 * convenience_types.ts (contract) -> convenience_layer.ts (implementation)
 *
 * Governance boundary (I-17): Only imports ClaimApi, never ClaimSystem/ClaimStore.
 */

import { createHash } from 'node:crypto';

import type { Result } from '../../kernel/interfaces/index.js';
import type { MissionId, TaskId } from '../../kernel/interfaces/index.js';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type {
  ClaimCreateInput,
  ClaimQueryInput,
  RelationshipCreateInput,
  RetractClaimInput,
  ClaimId,
  RelationshipType,
} from '../../claims/interfaces/claim_types.js';
import type { ClaimApi } from '../interfaces/api.js';

import type {
  RememberOptions,
  RememberResult,
  RecallOptions,
  BeliefView,
  ReflectEntry,
  ReflectResult,
  SearchOptions,
  SearchResult,
} from './convenience_types.js';

import {
  VALID_RELATIONSHIP_TYPES,
  VALID_CATEGORIES,
  MAX_STATEMENT_LENGTH,
  MAX_REFLECT_ENTRIES,
  DEFAULT_RECALL_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
} from './convenience_types.js';

import { generatePromptInstructions } from './convenience_prompt.js';

// ── Result Helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message, spec: 'Phase-1' } };
}

// ── SHA-256 Subject Generation ──

/**
 * Generate a subject URN from text content using SHA-256.
 * Format: entity:observation:<sha256-hex-first-12>
 *
 * I-CONV-13: Satisfies CCP subject validation (3 colon-separated segments).
 */
function hashSubject(text: string): string {
  const hash = createHash('sha256').update(text, 'utf8').digest('hex');
  return `entity:observation:${hash.substring(0, 12)}`;
}

// ── Convenience Layer ──

/**
 * Dependencies for the convenience layer.
 * Injected during createLimen() -- no direct access to internals.
 */
export interface ConvenienceLayerDeps {
  readonly claims: ClaimApi;
  readonly getConnection: () => DatabaseConnection;
  readonly time: TimeProvider;
  readonly missionId: MissionId;
  readonly taskId: TaskId | null;
  readonly maxAutoConfidence: number;
}

/**
 * The convenience layer interface -- methods added to the Limen object.
 */
export interface ConvenienceLayer {
  remember(subject: string, predicate: string, value: string, options?: RememberOptions): Result<RememberResult>;
  remember(text: string, options?: RememberOptions): Result<RememberResult>;
  remember(subjectOrText: string, predicateOrOptions?: string | RememberOptions, value?: string, options?: RememberOptions): Result<RememberResult>;
  recall(subject?: string, predicate?: string, options?: RecallOptions): Result<readonly BeliefView[]>;
  forget(claimId: string, reason?: string): Result<void>;
  connect(claimId1: string, claimId2: string, type: 'supports' | 'contradicts' | 'supersedes' | 'derived_from'): Result<void>;
  reflect(entries: readonly ReflectEntry[]): Result<ReflectResult>;
  promptInstructions(): string;
  /** Phase 2 §2.4: Full-text search across claim content. */
  search(query: string, options?: SearchOptions): Result<readonly SearchResult[]>;
}

/**
 * Create the convenience layer.
 *
 * Returns an object with all convenience methods, ready to be spread
 * onto the Limen engine object.
 *
 * All methods are synchronous Result<T> (I-CONV-01: immediately usable).
 * Closure captures deps -- survives Object.freeze (I-CONV-15).
 */
export function createConvenienceLayer(deps: ConvenienceLayerDeps): ConvenienceLayer {
  const { claims, getConnection, time, missionId, taskId, maxAutoConfidence } = deps;

  /**
   * Compute effective confidence, applying the maxAutoConfidence cap
   * unless evidence_path grounding with non-empty evidenceRefs is provided.
   *
   * I-CONV-04 (CONSTITUTIONAL): Cap enforcement.
   * I-CONV-05 (CONSTITUTIONAL): Bypass with evidence.
   */
  function effectiveConfidence(
    requestedConfidence: number | undefined,
    groundingMode: 'runtime_witness' | 'evidence_path' | undefined,
    evidenceRefs: readonly { readonly type: string; readonly id: string }[] | undefined,
  ): number {
    const confidence = requestedConfidence ?? maxAutoConfidence;

    // Bypass: evidence_path with non-empty evidenceRefs
    if (groundingMode === 'evidence_path' && evidenceRefs && evidenceRefs.length > 0) {
      return confidence;
    }

    // Cap at maxAutoConfidence
    return Math.min(confidence, maxAutoConfidence);
  }

  /**
   * 3-param remember: explicit subject, predicate, value.
   */
  function remember3(
    subject: string,
    predicate: string,
    value: string,
    options?: RememberOptions,
  ): Result<RememberResult> {
    // Validate confidence if provided
    if (options?.confidence !== undefined) {
      if (!Number.isFinite(options.confidence) || options.confidence < 0 || options.confidence > 1) {
        return err('CONV_INVALID_CONFIDENCE', `Confidence must be in [0.0, 1.0], got ${options.confidence}`);
      }
    }

    const groundingMode = options?.groundingMode ?? 'runtime_witness';
    const evidenceRefs = options?.evidenceRefs ?? [];
    const confidence = effectiveConfidence(options?.confidence, groundingMode, evidenceRefs);
    const validAt = options?.validAt ?? time.nowISO();
    const objectType = options?.objectType ?? 'string';

    // Design Source §Grounding Mode Decision:
    // evidence_path with empty evidenceRefs falls back to runtime_witness behavior.
    // This prevents SC-11 rejection AND prevents confidence laundering.
    const effectiveGroundingMode = (groundingMode === 'evidence_path' && evidenceRefs.length > 0)
      ? 'evidence_path'
      : 'runtime_witness';

    const input: ClaimCreateInput = {
      subject,
      predicate,
      object: { type: objectType, value },
      confidence,
      validAt,
      missionId,
      taskId,
      evidenceRefs: effectiveGroundingMode === 'evidence_path'
        ? evidenceRefs.map(ref => ({ type: ref.type as 'artifact' | 'claim' | 'memory' | 'capability_result', id: ref.id }))
        : [],
      groundingMode: effectiveGroundingMode,
      ...(effectiveGroundingMode === 'runtime_witness' ? {
        runtimeWitness: {
          witnessType: 'convenience',
          witnessedValues: { source: 'remember' },
          witnessTimestamp: validAt,
        },
      } : {}),
    };

    const result = claims.assertClaim(input);
    if (!result.ok) return result;

    return ok({
      claimId: result.value.claim.id,
      confidence: result.value.claim.confidence,
    });
  }

  /**
   * 1-param remember: auto-generate subject from text hash.
   */
  function remember1(
    text: string,
    options?: RememberOptions,
  ): Result<RememberResult> {
    // Validate text is non-empty and not whitespace-only (I-CONV-09)
    if (!text || text.trim().length === 0) {
      return err('CONV_INVALID_TEXT', 'Text must be non-empty and not whitespace-only');
    }

    const subject = hashSubject(text);
    return remember3(subject, 'observation.note', text, options);
  }

  return {
    /**
     * Phase 1 §1.1/§1.2: Store a belief.
     *
     * Overload resolution (I-CONV-12):
     *   typeof secondArg === 'string' -> 3-param form
     *   otherwise -> 1-param form
     */
    remember(
      subjectOrText: string,
      predicateOrOptions?: string | RememberOptions,
      value?: string,
      options?: RememberOptions,
    ): Result<RememberResult> {
      if (typeof predicateOrOptions === 'string') {
        // 3-param form: (subject, predicate, value, options?)
        return remember3(subjectOrText, predicateOrOptions, value!, options);
      } else {
        // 1-param form: (text, options?)
        return remember1(subjectOrText, predicateOrOptions);
      }
    },

    /**
     * Phase 1 §1.3: Retrieve beliefs.
     *
     * I-CONV-08: Excludes superseded claims by default.
     */
    recall(
      subject?: string,
      predicate?: string,
      options?: RecallOptions,
    ): Result<readonly BeliefView[]> {
      const input: ClaimQueryInput = {
        ...(subject ? { subject } : {}),
        ...(predicate ? { predicate } : {}),
        status: 'active',
        ...(options?.minConfidence !== undefined ? { minConfidence: options.minConfidence } : {}),
        limit: options?.limit ?? DEFAULT_RECALL_LIMIT,
        includeEvidence: false,
        includeRelationships: false,
      };

      const result = claims.queryClaims(input);
      if (!result.ok) return result;

      // Map ClaimQueryResultItem -> BeliefView
      let items = result.value.claims;

      // I-CONV-08: Filter superseded unless explicitly included
      if (!options?.includeSuperseded) {
        items = items.filter(item => !item.superseded);
      }

      const beliefs: BeliefView[] = items.map(item => ({
        claimId: item.claim.id,
        subject: item.claim.subject,
        predicate: item.claim.predicate,
        value: String(item.claim.object.value),
        confidence: item.claim.confidence,
        validAt: item.claim.validAt,
        createdAt: item.claim.createdAt,
        superseded: item.superseded,
        disputed: item.disputed,
        // Phase 3: Cognitive Metabolism fields
        effectiveConfidence: item.effectiveConfidence,
        freshness: item.freshness,
        stability: item.claim.stability,
        lastAccessedAt: item.claim.lastAccessedAt,
        accessCount: item.claim.accessCount,
      }));

      return ok(beliefs);
    },

    /**
     * Phase 1 §1.4: Retract a belief.
     *
     * I-CONV-11: Delegates to ClaimApi.retractClaim().
     * I-CONV-14: Maps system-call errors to convenience error codes.
     */
    forget(claimId: string, reason?: string): Result<void> {
      const input: RetractClaimInput = {
        claimId: claimId as ClaimId,
        reason: reason ?? 'Retracted via forget()',
      };

      const result = claims.retractClaim(input);
      if (!result.ok) {
        // Map well-known error codes
        if (result.error.code === 'CLAIM_NOT_FOUND') {
          return err('CONV_CLAIM_NOT_FOUND', result.error.message);
        }
        if (result.error.code === 'CLAIM_ALREADY_RETRACTED') {
          return err('CONV_ALREADY_RETRACTED', result.error.message);
        }
        return result;
      }

      return ok(undefined);
    },

    /**
     * Phase 1 §1.5: Create a relationship between two claims.
     *
     * DC-P1-804: Validates relationship type.
     * DC-P1-805: Rejects self-reference.
     */
    connect(
      claimId1: string,
      claimId2: string,
      type: 'supports' | 'contradicts' | 'supersedes' | 'derived_from',
    ): Result<void> {
      // Validate relationship type
      if (!VALID_RELATIONSHIP_TYPES.includes(type as RelationshipType)) {
        return err('CONV_INVALID_RELATIONSHIP', `Invalid relationship type: ${type}. Must be one of: ${VALID_RELATIONSHIP_TYPES.join(', ')}`);
      }

      const input: RelationshipCreateInput = {
        fromClaimId: claimId1 as ClaimId,
        toClaimId: claimId2 as ClaimId,
        type: type as RelationshipType,
        missionId,
      };

      const result = claims.relateClaims(input);
      if (!result.ok) {
        // Map well-known error codes
        if (result.error.code === 'SELF_REFERENCE') {
          return err('CONV_SELF_REFERENCE', result.error.message);
        }
        return result;
      }

      return ok(undefined);
    },

    /**
     * Phase 1 §1.6: Batch-store categorized learnings.
     *
     * I-CONV-10: All-or-nothing transaction semantics.
     * Uses SQLite BEGIN/COMMIT/ROLLBACK via getConnection().
     */
    reflect(entries: readonly ReflectEntry[]): Result<ReflectResult> {
      // Validate: non-empty entries
      if (!entries || entries.length === 0) {
        return err('CONV_EMPTY_ENTRIES', 'reflect() requires at least one entry');
      }

      // Validate: entries count limit (F-P1-008: DoS protection)
      if (entries.length > MAX_REFLECT_ENTRIES) {
        return err('CONV_ENTRIES_LIMIT', `reflect() accepts at most ${MAX_REFLECT_ENTRIES} entries, got ${entries.length}`);
      }

      // Pre-validate all entries before starting transaction
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;

        // Validate category
        if (!VALID_CATEGORIES.includes(entry.category as typeof VALID_CATEGORIES[number])) {
          return err('CONV_INVALID_CATEGORY', `Entry ${i}: invalid category '${entry.category}'. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
        }

        // Validate statement length
        if (entry.statement.length > MAX_STATEMENT_LENGTH) {
          return err('CONV_STATEMENT_TOO_LONG', `Entry ${i}: statement exceeds ${MAX_STATEMENT_LENGTH} characters (${entry.statement.length})`);
        }

        // Validate confidence if provided
        if (entry.confidence !== undefined) {
          if (!Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) {
            return err('CONV_INVALID_CONFIDENCE', `Entry ${i}: confidence must be in [0.0, 1.0], got ${entry.confidence}`);
          }
        }
      }

      // Transaction: all-or-nothing
      const conn = getConnection();
      conn.run('BEGIN');

      try {
        const claimIds: ClaimId[] = [];

        for (const entry of entries) {
          const subject = hashSubject(entry.statement);
          const confidence = Math.min(entry.confidence ?? maxAutoConfidence, maxAutoConfidence);
          const validAt = time.nowISO();

          const input: ClaimCreateInput = {
            subject,
            predicate: `reflection.${entry.category}`,
            object: { type: 'string', value: entry.statement },
            confidence,
            validAt,
            missionId,
            taskId,
            evidenceRefs: [],
            groundingMode: 'runtime_witness',
            runtimeWitness: {
              witnessType: 'convenience',
              witnessedValues: { source: 'reflect', category: entry.category },
              witnessTimestamp: validAt,
            },
          };

          const result = claims.assertClaim(input);
          if (!result.ok) {
            conn.run('ROLLBACK');
            return result;
          }

          claimIds.push(result.value.claim.id);
        }

        conn.run('COMMIT');
        return ok({ stored: claimIds.length, claimIds });
      } catch (catchErr) {
        try { conn.run('ROLLBACK'); } catch { /* already rolled back */ }
        return err('CONV_BATCH_PARTIAL', `reflect() failed: ${String(catchErr)}`);
      }
    },

    /**
     * Phase 1 §1.7: Get system prompt instructions.
     *
     * I-CONV-18: Pure function, no I/O, deterministic.
     */
    promptInstructions(): string {
      return generatePromptInstructions();
    },

    /**
     * Phase 2 §2.4: Full-text search across claim content.
     *
     * Delegates to ClaimApi.searchClaims(). Maps SearchClaimResultItem -> SearchResult.
     *
     * Invariants: I-P2-02 (tenant isolation via facade), I-P2-05 (score), I-P2-07 (input validation)
     * DCs: DC-P2-012 (limit validation), DC-P2-013 (empty query validation)
     */
    search(query: string, options?: SearchOptions): Result<readonly SearchResult[]> {
      // I-P2-07: Validate query is non-empty
      if (!query || query.trim().length === 0) {
        return err('CONV_SEARCH_EMPTY_QUERY', 'Search query must be non-empty and not whitespace-only');
      }

      // I-P2-07: Validate limit
      const limit = options?.limit ?? DEFAULT_SEARCH_LIMIT;
      if (limit <= 0 || limit > MAX_SEARCH_LIMIT) {
        return err('CONV_SEARCH_INVALID_LIMIT', `Search limit must be in [1, ${MAX_SEARCH_LIMIT}], got ${limit}`);
      }

      const input: import('../../claims/interfaces/claim_types.js').SearchClaimInput = {
        query: query.trim(),
        ...(options?.minConfidence !== undefined ? { minConfidence: options.minConfidence } : {}),
        limit,
        ...(options?.includeSuperseded !== undefined ? { includeSuperseded: options.includeSuperseded } : {}),
      };

      const result = claims.searchClaims(input);

      if (!result.ok) return result;

      // Map SearchClaimResultItem -> SearchResult (convenience type)
      const searchResults: SearchResult[] = result.value.results.map(item => ({
        belief: {
          claimId: item.claim.id,
          subject: item.claim.subject,
          predicate: item.claim.predicate,
          value: String(item.claim.object.value),
          confidence: item.claim.confidence,
          validAt: item.claim.validAt,
          createdAt: item.claim.createdAt,
          superseded: item.superseded,
          disputed: item.disputed,
          // Phase 3: Cognitive Metabolism fields
          effectiveConfidence: item.effectiveConfidence,
          freshness: item.freshness,
          stability: item.claim.stability,
          lastAccessedAt: item.claim.lastAccessedAt,
          accessCount: item.claim.accessCount,
        },
        relevance: item.relevance,
        score: item.score,
      }));

      return ok(searchResults);
    },
  };
}
