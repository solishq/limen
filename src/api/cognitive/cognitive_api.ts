/**
 * Phase 5 + Phase 12: Cognitive API Namespace.
 *
 * Factory that creates the `limen.cognitive` namespace object.
 * Thin delegation layer -- all computation lives in cognitive/ modules.
 *
 * Spec ref: LIMEN_BUILD_PHASES.md (5.3), PHASE-5-DESIGN-SOURCE.md (Decision 2: Option A)
 * PA Ruling: limen.cognitive.health() APPROVED (not limen.health.cognitive())
 *
 * Phase 12 additions:
 *   - limen.cognitive.consolidate(options?)
 *   - limen.cognitive.verify(claimId)
 *   - limen.cognitive.narrative(missionId?)
 *   - limen.cognitive.importance(claimId)
 *   - limen.cognitive.suggestConnections(claimId)
 *   - limen.cognitive.acceptSuggestion(suggestionId)
 *   - limen.cognitive.rejectSuggestion(suggestionId)
 */

import type { Result, MissionId } from '../../kernel/interfaces/index.js';
import type { TenantId } from '../../kernel/interfaces/index.js';
import type { OperationContext } from '../../kernel/interfaces/common.js';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type { FreshnessThresholds } from '../../cognitive/freshness.js';
import type { StabilityConfig } from '../../cognitive/stability.js';
import type { RetractClaimHandler, RelateClaimsHandler, ClaimId } from '../../claims/interfaces/claim_types.js';
import type { VectorStore } from '../../vector/vector_store.js';
import type { EmbeddingProvider } from '../../vector/vector_types.js';
import type {
  ConsolidationOptions, ConsolidationResult,
  ImportanceScore, ImportanceWeights,
  NarrativeSnapshot,
  VerificationResult, VerificationProvider,
  ConnectionSuggestion,
  SelfHealingConfig,
} from '../../cognitive/cognitive_types.js';
import {
  computeCognitiveHealth,
  type CognitiveHealthReport,
  type CognitiveHealthConfig,
} from '../../cognitive/health.js';
import { computeImportance } from '../../cognitive/importance.js';
import { consolidate as runConsolidate } from '../../cognitive/consolidation.js';
import { computeNarrative } from '../../cognitive/narrative.js';
import { suggestConnections as runSuggestConnections } from '../../cognitive/auto_connection.js';

// ── Types ──

/**
 * Phase 5 + Phase 12: Cognitive API namespace interface.
 * Exposed as `limen.cognitive` on the Limen public API.
 */
export interface CognitiveNamespace {
  /** Phase 5 §5.3: Compute cognitive health report. Synchronous. */
  health(config?: CognitiveHealthConfig): Result<CognitiveHealthReport>;

  /** Phase 12 §12.6: Run consolidation (merge + archive + suggest resolution). */
  consolidate(options?: ConsolidationOptions): Result<ConsolidationResult>;

  /** Phase 12 §12.7: Verify a claim via external provider. ONLY async method. */
  verify(claimId: string): Promise<Result<VerificationResult>>;

  /** Phase 12 §12.5: Compute narrative snapshot for a mission (or global). */
  narrative(missionId?: string | null): Result<NarrativeSnapshot>;

  /** Phase 12 §12.3: Compute importance score for a claim. */
  importance(claimId: string, weights?: ImportanceWeights): Result<ImportanceScore>;

  /** Phase 12 §12.4: Suggest connections for a claim via embedding similarity. */
  suggestConnections(claimId: string): Promise<Result<ConnectionSuggestion[]>>;

  /** Phase 12: Accept a pending connection suggestion (creates the relationship). */
  acceptSuggestion(suggestionId: string): Result<void>;

  /** Phase 12: Reject a pending connection suggestion. */
  rejectSuggestion(suggestionId: string): Result<void>;
}

/**
 * Dependencies for creating the CognitiveNamespace.
 * Extended from Phase 5 with Phase 12 additions.
 */
export interface CognitiveNamespaceDeps {
  readonly getConnection: () => DatabaseConnection;
  readonly getContext: () => OperationContext;
  readonly getTenantId: () => TenantId | null;
  readonly time: TimeProvider;
  readonly freshnessThresholds?: FreshnessThresholds | undefined;
  readonly stabilityConfig?: StabilityConfig | undefined;
  // Phase 12 additions
  readonly retractClaim?: RetractClaimHandler | undefined;
  readonly relateClaims?: RelateClaimsHandler | undefined;
  readonly vectorStore?: VectorStore | null | undefined;
  readonly embeddingProvider?: EmbeddingProvider | null | undefined;
  readonly verificationProvider?: VerificationProvider | null | undefined;
  readonly selfHealingConfig?: SelfHealingConfig | undefined;
  readonly importanceWeights?: ImportanceWeights | undefined;
}

// ── Result Helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message, spec: 'Phase-12' } };
}

// ── Factory ──

/**
 * Create the CognitiveNamespace object.
 * Captures dependencies via closure -- survives Object.freeze (same pattern as ConvenienceLayer).
 */
export function createCognitiveNamespace(deps: CognitiveNamespaceDeps): CognitiveNamespace {
  return {
    health(config?: CognitiveHealthConfig): Result<CognitiveHealthReport> {
      try {
        const conn = deps.getConnection();
        const tenantId = deps.getTenantId();
        const report = computeCognitiveHealth(
          conn,
          tenantId,
          deps.time,
          deps.freshnessThresholds,
          config,
        );
        return ok(report);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('CONV_HEALTH_QUERY_FAILED', `Cognitive health computation failed: ${msg}`);
      }
    },

    consolidate(options?: ConsolidationOptions): Result<ConsolidationResult> {
      try {
        if (!deps.retractClaim || !deps.relateClaims) {
          return err('CONSOLIDATION_NOT_CONFIGURED', 'Claim system not configured for consolidation');
        }
        const result = runConsolidate(
          {
            getConnection: deps.getConnection,
            getContext: deps.getContext,
            retractClaim: deps.retractClaim,
            relateClaims: deps.relateClaims,
            time: deps.time,
            vectorStore: deps.vectorStore ?? null,
            freshnessThresholds: deps.freshnessThresholds,
            stabilityConfig: deps.stabilityConfig,
          },
          options,
        );
        return ok(result);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('CONSOLIDATION_FAILED', `Consolidation failed: ${msg}`);
      }
    },

    async verify(claimId: string): Promise<Result<VerificationResult>> {
      try {
        // Check provider configured
        if (!deps.verificationProvider) {
          return err('VERIFY_PROVIDER_MISSING', 'No verification provider configured');
        }

        const conn = deps.getConnection();
        const tenantId = deps.getTenantId();
        const tenantClause = tenantId !== null ? 'AND tenant_id = ?' : 'AND tenant_id IS NULL';
        const tenantParams = tenantId !== null ? [claimId, tenantId] : [claimId];

        const claim = conn.get<{
          subject: string;
          predicate: string;
          object_value: string;
          confidence: number;
          status: string;
        }>(
          `SELECT subject, predicate, object_value, confidence, status
           FROM claim_assertions WHERE id = ? ${tenantClause}`,
          tenantParams,
        );

        if (!claim) {
          return err('VERIFY_CLAIM_NOT_FOUND', `Claim ${claimId} not found`);
        }

        // I-P12-50: Advisory only — verify() MUST NOT mutate claim state
        try {
          const result = await deps.verificationProvider({
            subject: claim.subject,
            predicate: claim.predicate,
            value: claim.object_value,
            confidence: claim.confidence,
          });
          return ok(result);
        } catch {
          // I-P12-51: Provider failure → inconclusive, not error propagation
          return ok({
            verdict: 'inconclusive' as const,
            reasoning: 'Verification provider failed',
            suggestedConfidence: null,
          });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('VERIFY_FAILED', `Verification failed: ${msg}`);
      }
    },

    narrative(missionId?: string | null): Result<NarrativeSnapshot> {
      try {
        const conn = deps.getConnection();
        const tenantId = deps.getTenantId();
        const result = computeNarrative(conn, tenantId, deps.time, missionId ?? null);
        if (!result) {
          return err('NARRATIVE_NO_CLAIMS', 'No claims in scope for narrative');
        }
        return ok(result);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('NARRATIVE_FAILED', `Narrative computation failed: ${msg}`);
      }
    },

    importance(claimId: string, weights?: ImportanceWeights): Result<ImportanceScore> {
      try {
        const conn = deps.getConnection();
        const tenantId = deps.getTenantId();
        const result = computeImportance(
          conn, claimId, tenantId, deps.time,
          weights ?? deps.importanceWeights,
          deps.stabilityConfig,
        );
        if (!result) {
          return err('IMPORTANCE_CLAIM_NOT_FOUND', `Claim ${claimId} not found or not active`);
        }
        return ok(result);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('IMPORTANCE_FAILED', `Importance computation failed: ${msg}`);
      }
    },

    async suggestConnections(claimId: string): Promise<Result<ConnectionSuggestion[]>> {
      try {
        const conn = deps.getConnection();
        const tenantId = deps.getTenantId();
        const suggestions = await runSuggestConnections(
          conn, claimId, tenantId, deps.time,
          deps.vectorStore ?? null,
          deps.embeddingProvider ?? null,
        );
        return ok(suggestions);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('SUGGEST_CONNECTIONS_FAILED', `Auto-connection failed: ${msg}`);
      }
    },

    acceptSuggestion(suggestionId: string): Result<void> {
      try {
        const conn = deps.getConnection();
        const ctx = deps.getContext();
        const tenantId = deps.getTenantId();

        // Get the suggestion
        const tenantClause = tenantId !== null ? 'AND tenant_id = ?' : 'AND tenant_id IS NULL';
        const tenantParams = tenantId !== null ? [suggestionId, tenantId] : [suggestionId];

        const suggestion = conn.get<{
          id: string;
          from_claim_id: string;
          to_claim_id: string;
          suggested_type: string;
          status: string;
        }>(
          `SELECT id, from_claim_id, to_claim_id, suggested_type, status
           FROM connection_suggestions WHERE id = ? ${tenantClause}`,
          tenantParams,
        );

        if (!suggestion) {
          return err('SUGGESTION_NOT_FOUND', `Suggestion ${suggestionId} not found`);
        }

        if (suggestion.status !== 'pending') {
          return err('SUGGESTION_ALREADY_RESOLVED', `Suggestion ${suggestionId} is already ${suggestion.status}`);
        }

        // I-P12-31: Create relationship via the standard relateClaims handler
        if (!deps.relateClaims) {
          return err('CONSOLIDATION_NOT_CONFIGURED', 'Claim system not configured');
        }

        // Get a missionId from one of the claims
        const claimRow = conn.get<{ source_mission_id: string | null }>(
          `SELECT source_mission_id FROM claim_assertions WHERE id = ?`,
          [suggestion.from_claim_id],
        );
        const missionId = (claimRow?.source_mission_id ?? 'mission:cognitive') as MissionId;

        const relResult = deps.relateClaims.execute(conn, ctx, {
          fromClaimId: suggestion.from_claim_id as ClaimId,
          toClaimId: suggestion.to_claim_id as ClaimId,
          type: suggestion.suggested_type as 'supports' | 'derived_from',
          missionId,
        });

        if (!relResult.ok) {
          return err(relResult.error.code, relResult.error.message);
        }

        // Update suggestion status
        const nowISO = deps.time.nowISO();
        conn.run(
          `UPDATE connection_suggestions SET status = 'accepted', resolved_at = ? WHERE id = ?`,
          [nowISO, suggestionId],
        );

        return ok(undefined);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('ACCEPT_SUGGESTION_FAILED', `Failed to accept suggestion: ${msg}`);
      }
    },

    rejectSuggestion(suggestionId: string): Result<void> {
      try {
        const conn = deps.getConnection();
        const tenantId = deps.getTenantId();

        const tenantClause = tenantId !== null ? 'AND tenant_id = ?' : 'AND tenant_id IS NULL';
        const tenantParams = tenantId !== null ? [suggestionId, tenantId] : [suggestionId];

        const suggestion = conn.get<{ id: string; status: string }>(
          `SELECT id, status FROM connection_suggestions WHERE id = ? ${tenantClause}`,
          tenantParams,
        );

        if (!suggestion) {
          return err('SUGGESTION_NOT_FOUND', `Suggestion ${suggestionId} not found`);
        }

        if (suggestion.status !== 'pending') {
          return err('SUGGESTION_ALREADY_RESOLVED', `Suggestion ${suggestionId} is already ${suggestion.status}`);
        }

        const nowISO = deps.time.nowISO();
        conn.run(
          `UPDATE connection_suggestions SET status = 'rejected', resolved_at = ? WHERE id = ?`,
          [nowISO, suggestionId],
        );

        return ok(undefined);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('REJECT_SUGGESTION_FAILED', `Failed to reject suggestion: ${msg}`);
      }
    },
  };
}
