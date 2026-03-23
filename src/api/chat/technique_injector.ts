/**
 * TGP ↔ Pipeline Wire: Technique Injection into System Prompt
 * Phase 2B: Active prompt_fragment techniques injected at inference time.
 *
 * S ref: §31 (technique application), I-54 (overhead boundary), I-96 (candidate exclusion),
 *        I-94 (content immutability), I-07 (agent isolation), I-63 (audit payload)
 *
 * This module:
 *   1. Queries active prompt_fragment techniques for the executing agent (I-96)
 *   2. Applies confidence-descending ordering with 20% window truncation (§31)
 *   3. Assembles technique content into a system prompt section (I-94: verbatim)
 *   4. Computes technique token cost for systemOverhead (I-54)
 *   5. Records injection details for audit transparency (I-63)
 *
 * Invariants enforced:
 *   I-96: Only status='active' techniques participate. Candidates, suspended, retired excluded.
 *   I-94: Technique content inserted verbatim. No transformation.
 *   I-07: Techniques scoped to executing agent's agentId.
 *   I-54: Technique token cost is part of systemOverhead, NOT CGP position 1.
 *   §31:  prompt_fragment type only. Ordered by confidence descending.
 *         Truncated to 20% of model context window.
 *
 * Failure mode:
 *   TGP failure = empty technique set + trace event. Graceful degradation.
 *   The model operates without learned techniques. Safe because techniques
 *   are supplementary optimization, not governance-critical.
 */

import type { DatabaseConnection, AgentId, TenantId, Result } from '../../kernel/interfaces/index.js';
import type { Technique, TechniqueId } from '../../learning/interfaces/index.js';
import { MAX_CONTEXT_WINDOW_RATIO } from '../../learning/interfaces/index.js';
import { estimateTokens } from '../../learning/applicator/technique_applicator.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal interface for querying active prompt fragments.
 * Matches TechniqueApplicator.getActivePromptFragments signature.
 * Injected as a dependency — pipeline never imports TechniqueApplicator directly.
 */
export interface TechniqueReader {
  getActivePromptFragments(
    conn: DatabaseConnection,
    agentId: AgentId,
    tenantId: TenantId,
    maxTokenBudget: number,
  ): Result<readonly Technique[]>;
}

/**
 * Result of technique injection — everything the pipeline needs.
 */
export interface TechniqueInjectionResult {
  /** System prompt section containing injected technique content (empty string if none) */
  readonly systemPromptSection: string;
  /** Total token cost of injected techniques (for systemOverhead) */
  readonly techniqueTokenCost: number;
  /** Number of techniques injected */
  readonly count: number;
  /** Audit details for I-63 overhead breakdown */
  readonly auditDetails: TechniqueInjectionAudit;
}

/**
 * I-63: Audit record for technique injection.
 * Enables reconstruction of which techniques were injected and why.
 */
export interface TechniqueInjectionAudit {
  /** IDs of injected techniques, in injection order (confidence descending) */
  readonly injectedIds: readonly TechniqueId[];
  /** Per-technique details */
  readonly techniques: readonly TechniqueAuditEntry[];
  /** Total token budget available (20% of context window) */
  readonly tokenBudget: number;
  /** Total tokens consumed by injected techniques */
  readonly tokensUsed: number;
  /** Whether TGP query failed (graceful degradation) */
  readonly tgpQueryFailed: boolean;
}

/**
 * Per-technique audit entry.
 */
export interface TechniqueAuditEntry {
  readonly id: TechniqueId;
  readonly confidence: number;
  readonly tokenCost: number;
}

// ============================================================================
// Constants
// ============================================================================

/** System prompt section delimiter for technique injection */
const TECHNIQUE_SECTION_HEADER = '<!-- LEARNED_TECHNIQUES -->';
const TECHNIQUE_SECTION_FOOTER = '<!-- /LEARNED_TECHNIQUES -->';

// ============================================================================
// Injection Logic
// ============================================================================

/**
 * Inject active prompt_fragment techniques into a system prompt section.
 *
 * @param reader - TechniqueReader (injected TechniqueApplicator)
 * @param conn - Database connection
 * @param agentId - Executing agent's ID (I-07: agent isolation)
 * @param tenantId - Tenant scope
 * @param modelContextWindow - Model's total context window in tokens
 * @returns TechniqueInjectionResult with system prompt section, cost, and audit
 */
export function injectTechniques(
  reader: TechniqueReader,
  conn: DatabaseConnection,
  agentId: AgentId,
  tenantId: TenantId,
  modelContextWindow: number,
): TechniqueInjectionResult {
  // §31: Token budget = 20% of model context window
  const tokenBudget = Math.floor(modelContextWindow * MAX_CONTEXT_WINDOW_RATIO);

  // Query active prompt_fragment techniques.
  // getActivePromptFragments enforces:
  //   - status='active' (I-96: candidates/suspended/retired excluded)
  //   - type='prompt_fragment' (§31: only prompt_fragments in system prompt)
  //   - confidence DESC ordering (§31)
  //   - greedy token-budget fill (DEC-4E2C-002)
  //   - agent isolation via agentId (I-07)
  let techniques: readonly Technique[];
  let tgpQueryFailed = false;

  try {
    const result = reader.getActivePromptFragments(conn, agentId, tenantId, tokenBudget);
    if (!result.ok) {
      // TGP failure = graceful degradation. Empty techniques.
      techniques = [];
      tgpQueryFailed = true;
    } else {
      techniques = result.value;
    }
  } catch {
    // TGP failure = graceful degradation. Empty techniques.
    techniques = [];
    tgpQueryFailed = true;
  }

  // No techniques = no injection
  if (techniques.length === 0) {
    return Object.freeze({
      systemPromptSection: '',
      techniqueTokenCost: 0,
      count: 0,
      auditDetails: Object.freeze({
        injectedIds: Object.freeze([]),
        techniques: Object.freeze([]),
        tokenBudget,
        tokensUsed: 0,
        tgpQueryFailed,
      }),
    });
  }

  // Build audit entries and compute total cost
  const auditEntries: TechniqueAuditEntry[] = [];
  let totalTokenCost = 0;

  for (const technique of techniques) {
    const tokenCost = estimateTokens(technique.content);
    totalTokenCost += tokenCost;
    auditEntries.push(Object.freeze({
      id: technique.id,
      confidence: technique.confidence,
      tokenCost,
    }));
  }

  // Assemble system prompt section
  // I-94: Content inserted verbatim. No transformation.
  const contentLines = techniques.map(t => t.content);
  const systemPromptSection = [
    TECHNIQUE_SECTION_HEADER,
    ...contentLines,
    TECHNIQUE_SECTION_FOOTER,
  ].join('\n');

  return Object.freeze({
    systemPromptSection,
    techniqueTokenCost: totalTokenCost,
    count: techniques.length,
    auditDetails: Object.freeze({
      injectedIds: Object.freeze(techniques.map(t => t.id)),
      techniques: Object.freeze(auditEntries),
      tokenBudget,
      tokensUsed: totalTokenCost,
      tgpQueryFailed,
    }),
  });
}
