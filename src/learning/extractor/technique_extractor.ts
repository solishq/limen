/**
 * Limen — TechniqueExtractor Implementation
 * Phase 4E-2b: Learning System Extraction Pipeline
 *
 * Implements the TechniqueExtractor interface from learning_types.ts.
 * Four-step extraction algorithm per §29.3:
 *   Step 1: Collect candidates (quality > 0.7, positive feedback)
 *   Step 2: Generate proposal via LLM
 *   Step 3: Deduplicate via cosine similarity (threshold 0.85)
 *   Step 4: Store with provenance (I-03 audit, single transaction)
 *
 * S ref: S29.3 Steps 1-4, I-03 (audit), I-07 (agent isolation),
 *        LI-01 (initial confidence 0.5), LI-13 (dedup threshold 0.85)
 *
 * Decisions:
 *   D1: Local TF-IDF cosine for dedup (FO-004: upgrade to embeddings when IC-08 ships)
 *   D2: LLM failure handling — validate all fields, clamp confidence to [0,1]
 *   D3: Transaction boundary — LLM call outside transaction, store ops inside
 *   D4: Duplicate reinforcement — EMA formula (0.8*old + 0.2*1.0) per S29.5
 *   D5: collectCandidates — graceful empty (no interaction table exists yet)
 */

import type {
  TechniqueExtractor, TechniqueStore, TechniqueProposal,
  ExtractionCandidate, DuplicateCheckResult, Technique,
  TechniqueType, TechniqueId, LearningDeps,
} from '../interfaces/index.js';
import type {
  DatabaseConnection, OperationContext, Result, AgentId, TenantId,
} from '../../kernel/interfaces/index.js';
import type { LlmRequest, LlmContentBlock } from '../../substrate/interfaces/substrate.js';
import {
  DEDUP_SIMILARITY_THRESHOLD,
  INITIAL_CONFIDENCE_EXTRACTED,
  EMA_WEIGHT_OLD,
  EMA_WEIGHT_RECENT,
} from '../interfaces/index.js';

// ─── Constants ───

const VALID_TECHNIQUE_TYPES: readonly TechniqueType[] = [
  'prompt_fragment', 'decision_rule', 'rag_pattern',
];

/**
 * System prompt for technique extraction via LLM.
 * Per S29.3 Step 2: structured extraction with typed output schema.
 */
const EXTRACTION_SYSTEM_PROMPT = `You are a technique extraction engine for a cognitive operating system.
Analyze the following interaction and extract a reusable technique that can improve future conversations.

Respond ONLY with valid JSON matching this exact schema:
{
  "type": "prompt_fragment" | "decision_rule" | "rag_pattern",
  "content": "the extracted technique text — must be actionable and specific",
  "confidence": 0.0-1.0,
  "applicability": "description of when and where this technique should be applied"
}

Type definitions:
- prompt_fragment: A reusable text snippet to prepend/append to agent prompts
- decision_rule: A conditional rule for routing, escalation, or response strategy
- rag_pattern: A retrieval pattern for finding relevant context

No explanation, no markdown fences, no commentary. Only the JSON object.`;

// ─── Similarity Function (D1: Isolated Interface, FO-004) ───

/**
 * Compute cosine similarity between two texts using normalized term frequency vectors.
 * Pure function. Deterministic. No external dependencies.
 *
 * Initial implementation: bag-of-words TF cosine (D1, approved 2026-03-13).
 * FO-004: Replace with embedding-based similarity when IC-08 infrastructure ships.
 * Upgrade path: swap this function, re-run contract tests, add semantic dedup tests.
 *
 * Accepted limitation: lexically different but semantically similar texts will
 * not be flagged as duplicates. Not a spec violation — §29.3 permits pluggable
 * similarity backends ("provider API or ONNX fallback").
 *
 * @param text1 First text to compare
 * @param text2 Second text to compare
 * @returns Cosine similarity in [0, 1]. 1.0 = identical, 0.0 = no overlap.
 */
export function computeSimilarity(text1: string, text2: string): number {
  const tokenize = (text: string): string[] =>
    text.toLowerCase().split(/\W+/).filter(t => t.length > 0);

  const tokens1 = tokenize(text1);
  const tokens2 = tokenize(text2);

  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  // Build normalized term frequency maps
  const buildTf = (tokens: string[]): Map<string, number> => {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    // Normalize by document length
    for (const [term, count] of tf) tf.set(term, count / tokens.length);
    return tf;
  };

  const tf1 = buildTf(tokens1);
  const tf2 = buildTf(tokens2);

  // Cosine similarity: dot(v1, v2) / (|v1| * |v2|)
  let dot = 0;
  let mag1 = 0;
  let mag2 = 0;

  for (const [term, w1] of tf1) {
    mag1 += w1 * w1;
    const w2 = tf2.get(term) ?? 0;
    dot += w1 * w2;
  }

  for (const [, w2] of tf2) {
    mag2 += w2 * w2;
  }

  if (mag1 === 0 || mag2 === 0) return 0;

  return dot / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

// ─── Factory ───

/**
 * Create a TechniqueExtractor implementation.
 * Requires LearningDeps (for LlmGateway access) and TechniqueStore (for dedup + storage).
 *
 * @param deps Learning system dependencies (gateway for LLM calls)
 * @param store TechniqueStore for dedup queries and technique creation
 */
export function createTechniqueExtractor(
  deps: LearningDeps,
  store: TechniqueStore,
): TechniqueExtractor {

  // ─── Step 1: Collect Candidates (S29.3 Step 1) ───

  /**
   * Collect extraction candidates from recent interactions.
   * Per S29.3 Step 1: filter by quality > 0.7 AND positive feedback.
   *
   * LEARNING-01: Wired to core_interactions table (migration v33).
   * Queries interactions with quality_score > 0.7 and user_feedback = 'positive'.
   * Respects tenant isolation via COALESCE pattern (FM-10).
   * Returns max 50 results ordered by quality_score descending.
   * Graceful degradation: returns empty array if table doesn't exist yet.
   */
  function collectCandidates(
    conn: DatabaseConnection,
    ctx: OperationContext,
    agentId: AgentId,
    sinceTimestamp: string,
  ): Result<readonly ExtractionCandidate[]> {
    try {
      const tenantId = ctx.tenantId ?? null;
      const rows = conn.query<{
        id: string;
        agent_id: string;
        tenant_id: string | null;
        quality_score: number;
        user_feedback: string | null;
        user_input: string;
        assistant_output: string;
      }>(
        `SELECT id, agent_id, tenant_id, quality_score, user_feedback, user_input, assistant_output
         FROM core_interactions
         WHERE agent_id = ?
           AND COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')
           AND quality_score > 0.7
           AND user_feedback = 'positive'
           AND created_at > ?
         ORDER BY quality_score DESC
         LIMIT 50`,
        [agentId, tenantId, sinceTimestamp],
      );

      const candidates: ExtractionCandidate[] = rows.map(row => ({
        interactionId: row.id,
        agentId: row.agent_id as AgentId,
        tenantId: (row.tenant_id ?? '') as TenantId,
        qualityScore: row.quality_score,
        userFeedback: row.user_feedback as 'positive' | 'correction' | null,
        conversationContext: `User: ${row.user_input}\nAssistant: ${row.assistant_output}`,
      }));

      return { ok: true, value: candidates };
    } catch (err: unknown) {
      // F-S2-002 FIX: Only gracefully degrade for "no such table" errors.
      // Any other query error must be surfaced as a Result error, not swallowed.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('no such table')) {
        // Graceful degradation: core_interactions table doesn't exist yet
        // (e.g., migration not run). Return empty array per D5.
        return { ok: true, value: [] };
      }
      return {
        ok: false,
        error: {
          code: 'LEARNING_QUERY_ERROR',
          message: `collectCandidates query failed: ${message}`,
          spec: 'S29.3',
        },
      };
    }
  }

  // ─── Step 2: Generate Proposal (S29.3 Step 2) ───

  /**
   * Generate a technique proposal from an extraction candidate via LLM.
   * Calls deps.gateway.request() with structured extraction prompt.
   * Validates all response fields per D2 failure handling.
   *
   * Pattern derived from InferPipeline (src/api/infer/infer_pipeline.ts:234-266).
   */
  async function generateProposal(
    ctx: OperationContext,
    candidate: ExtractionCandidate,
  ): Promise<Result<TechniqueProposal>> {
    const conn = deps.getConnection();

    const userContent = [
      `Agent: ${candidate.agentId}`,
      `Quality Score: ${candidate.qualityScore}`,
      `User Feedback: ${candidate.userFeedback ?? 'none'}`,
      `Conversation:`,
      candidate.conversationContext,
    ].join('\n');

    const llmRequest: LlmRequest = {
      model: 'default',
      messages: [{ role: 'user' as const, content: userContent }],
      maxTokens: 1024,
      temperature: 0.3,
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    };

    // Call LLM gateway — same pattern as ChatPipeline/InferPipeline
    const responseResult = await deps.gateway.request(conn, ctx, llmRequest);

    if (!responseResult.ok) {
      return {
        ok: false,
        error: {
          code: 'EXTRACTION_LLM_ERROR',
          message: `LLM gateway error: ${responseResult.error.message}`,
          spec: 'S29.3',
        },
      };
    }

    const response = responseResult.value;

    // Extract text content from response (may be string or LlmContentBlock[])
    const rawContent = typeof response.content === 'string'
      ? response.content
      : (response.content as readonly LlmContentBlock[])
          .filter((b): b is { readonly type: 'text'; readonly text: string } => b.type === 'text')
          .map(b => b.text)
          .join('');

    // Parse JSON — D2: malformed JSON → EXTRACTION_PARSE_ERROR
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return {
        ok: false,
        error: {
          code: 'EXTRACTION_PARSE_ERROR',
          message: `LLM returned malformed JSON: ${rawContent.slice(0, 200)}`,
          spec: 'S29.3',
        },
      };
    }

    const obj = parsed as Record<string, unknown>;

    // Validate type — D2: invalid TechniqueType → EXTRACTION_INVALID_TYPE
    if (!VALID_TECHNIQUE_TYPES.includes(obj.type as TechniqueType)) {
      return {
        ok: false,
        error: {
          code: 'EXTRACTION_INVALID_TYPE',
          message: `LLM returned invalid technique type: ${String(obj.type)}. Valid: ${VALID_TECHNIQUE_TYPES.join(', ')}`,
          spec: 'S29.1',
        },
      };
    }

    // Validate content — D2: empty content → EXTRACTION_EMPTY_CONTENT
    if (typeof obj.content !== 'string' || obj.content.length === 0) {
      return {
        ok: false,
        error: {
          code: 'EXTRACTION_EMPTY_CONTENT',
          message: 'LLM returned empty or non-string content',
          spec: 'S29.3',
        },
      };
    }

    // Validate applicability — must be non-empty string
    if (typeof obj.applicability !== 'string' || obj.applicability.length === 0) {
      return {
        ok: false,
        error: {
          code: 'EXTRACTION_EMPTY_APPLICABILITY',
          message: 'LLM returned empty or non-string applicability',
          spec: 'S29.3',
        },
      };
    }

    // D2: Clamp confidence to [0,1] — LLMs are imprecise
    const rawConfidence = typeof obj.confidence === 'number' ? obj.confidence : 0.5;
    const confidence = Math.max(0, Math.min(1, rawConfidence));

    const proposal: TechniqueProposal = {
      type: obj.type as TechniqueType,
      content: obj.content as string,
      confidence,
      applicability: obj.applicability as string,
    };

    return { ok: true, value: proposal };
  }

  // ─── Step 3: Duplicate Check (S29.3 Step 3) ───

  /**
   * Check if a proposed technique content duplicates an existing active technique.
   * Per S29.3 Step 3: cosine similarity > 0.85 = duplicate.
   *
   * D1: Uses local TF-IDF cosine via computeSimilarity() (FO-004: upgrade to embeddings).
   * Compares against ALL active techniques for the specified agent.
   * Scaling assumption: acceptable for <1000 active techniques per agent.
   */
  async function checkDuplicate(
    conn: DatabaseConnection,
    agentId: AgentId,
    tenantId: TenantId,
    proposalContent: string,
  ): Promise<Result<DuplicateCheckResult>> {
    // Fetch all active techniques for this agent (I-07: agent-scoped)
    const existingResult = store.getByAgent(conn, agentId, tenantId, 'active');
    if (!existingResult.ok) {
      return existingResult as Result<DuplicateCheckResult>;
    }

    let bestSimilarity = 0;
    let bestMatchId: TechniqueId | null = null;

    for (const technique of existingResult.value) {
      const similarity = computeSimilarity(proposalContent, technique.content);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatchId = technique.id;
      }
    }

    const isDuplicate = bestSimilarity >= DEDUP_SIMILARITY_THRESHOLD;

    return {
      ok: true,
      value: {
        isDuplicate,
        existingTechniqueId: isDuplicate ? bestMatchId : null,
        similarity: bestSimilarity,
      },
    };
  }

  // ─── Step 4: Extract and Store (S29.3 Step 4) ───

  /**
   * Full extraction pipeline: generate → dedup → store/reinforce.
   *
   * D3: LLM call (generateProposal) is OUTSIDE any transaction.
   *     Store operations (create/update) use the store's transaction + audit (I-03).
   *     Named assumption: if LLM succeeds but store fails, LLM compute is wasted,
   *     but no orphan state exists.
   *
   * D4: Duplicate reinforcement uses EMA formula (0.8*old + 0.2*1.0) per S29.5.
   *     Treats duplicate detection as positive signal (pattern reappeared = evidence of value).
   *
   * Returns: Technique if novel and stored, null if duplicate was reinforced.
   */
  async function extractAndStore(
    conn: DatabaseConnection,
    ctx: OperationContext,
    candidate: ExtractionCandidate,
  ): Promise<Result<Technique | null>> {
    // Step 2: Generate proposal via LLM
    const proposalResult = await generateProposal(ctx, candidate);
    if (!proposalResult.ok) return proposalResult;
    const proposal = proposalResult.value;

    // Step 3: Check for duplicates against agent's active techniques
    const dupResult = await checkDuplicate(
      conn, candidate.agentId, candidate.tenantId, proposal.content,
    );
    if (!dupResult.ok) return dupResult;

    if (dupResult.value.isDuplicate && dupResult.value.existingTechniqueId) {
      // D4: Reinforce existing technique using EMA formula
      // new_confidence = 0.8 * old + 0.2 * 1.0 (duplicate = positive signal)
      const existingId = dupResult.value.existingTechniqueId;
      const getResult = store.get(conn, existingId, candidate.tenantId, candidate.agentId);
      if (getResult.ok) {
        const reinforcedConfidence = EMA_WEIGHT_OLD * getResult.value.confidence + EMA_WEIGHT_RECENT * 1.0;
        store.update(conn, ctx, existingId, candidate.tenantId, {
          confidence: Math.min(reinforcedConfidence, 1.0),
        });
      }
      return { ok: true, value: null };
    }

    // Step 4: Store new technique with provenance
    // sourceMemoryIds: candidate.interactionId traces back to originating interaction
    // initialConfidence: 0.5 per S29.3 Step 4 (LI-01)
    const createResult = store.create(conn, ctx, {
      tenantId: candidate.tenantId,
      agentId: candidate.agentId,
      type: proposal.type,
      content: proposal.content,
      sourceMemoryIds: [candidate.interactionId],
      initialConfidence: INITIAL_CONFIDENCE_EXTRACTED,
    });

    if (!createResult.ok) return createResult;
    return { ok: true, value: createResult.value };
  }

  return Object.freeze({
    collectCandidates,
    generateProposal,
    checkDuplicate,
    extractAndStore,
  });
}
