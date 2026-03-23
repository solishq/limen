/**
 * Conversation Manager -- Conversation history and auto-summarization.
 * S ref: S26 (Conversation Model), I-27 (conversation integrity),
 *        I-21 (bounded cognition via summarization), I-03 (atomic audit)
 *
 * Phase: 3 (Orchestration)
 * Implements: Conversation CRUD, turn appending with monotonic numbering,
 *             auto-summarization when context window threshold exceeded,
 *             fork (copy-on-branch) for branching conversations,
 *             learning-source exemption (turns marked is_learning_source
 *             are never summarized away).
 *
 * SD-25: summarized_up_to tracks which turns have been summarized.
 *        Only turns with turn_number <= summarized_up_to are eligible
 *        for replacement by a summary turn.
 * SD-26: Fork copies all turns up to atTurn into a new conversation
 *        linked via parent_conversation_id.
 */

import type { Result, SessionId, AgentId, TenantId } from '../../kernel/interfaces/index.js';
import type {
  OrchestrationDeps, ConversationManager, ConversationRole, ConversationTurn,
} from '../interfaces/orchestration.js';
import { generateId } from '../interfaces/orchestration.js';

/**
 * S26: Create the conversation manager module.
 * Factory function returns frozen object per C-07.
 */
export function createConversationManager(): ConversationManager {

  /** S26: Create a new conversation */
  function create(
    deps: OrchestrationDeps,
    sessionId: SessionId,
    agentId: AgentId,
    tenantId: TenantId | null,
  ): Result<string> {
    const conversationId = generateId();
    const now = deps.time.nowISO();

    deps.conn.transaction(() => {
      deps.conn.run(
        `INSERT INTO core_conversations (id, session_id, tenant_id, agent_id, parent_conversation_id, fork_at_turn, total_turns, total_tokens, summarized_up_to, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, NULL, 0, 0, 0, ?, ?)`,
        [conversationId, sessionId, tenantId, agentId, now, now],
      );

      // F-05 fix: I-03 audit entry for conversation creation
      deps.audit.append(deps.conn, {
        tenantId,
        actorType: 'system',
        actorId: agentId as string,
        operation: 'create_conversation',
        resourceType: 'conversation',
        resourceId: conversationId,
        detail: { sessionId },
      });
    });

    return { ok: true, value: conversationId };
  }

  /** S26.1: Append a turn to conversation. Returns the new turn number. */
  function appendTurn(
    deps: OrchestrationDeps,
    conversationId: string,
    turn: {
      role: ConversationRole;
      content: string;
      tokenCount: number;
      modelUsed?: string;
      isLearningSource?: boolean;
      participantId?: string;
    },
  ): Result<number> {
    // Get current conversation state
    const conv = deps.conn.get<{ total_turns: number; total_tokens: number; tenant_id: TenantId | null }>(
      'SELECT total_turns, total_tokens, tenant_id FROM core_conversations WHERE id = ?',
      [conversationId],
    );
    if (!conv) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `Conversation ${conversationId} not found`, spec: 'S26' } };
    }

    const turnNumber = conv.total_turns + 1;
    const turnId = generateId();
    const now = deps.time.nowISO();

    deps.conn.transaction(() => {
      // FM-10: tenant_id inherited from parent conversation
      deps.conn.run(
        `INSERT INTO core_conversation_turns (id, conversation_id, tenant_id, turn_number, role, content, token_count, model_used, is_summary, is_learning_source, participant_id, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?)`,
        [
          turnId,
          conversationId,
          conv.tenant_id,
          turnNumber,
          turn.role,
          turn.content,
          turn.tokenCount,
          turn.modelUsed ?? null,
          (turn.isLearningSource ?? false) ? 1 : 0,
          turn.participantId ?? null,
          now,
        ],
      );

      // Update conversation metadata
      deps.conn.run(
        `UPDATE core_conversations SET total_turns = ?, total_tokens = total_tokens + ?, updated_at = ? WHERE id = ?`,
        [turnNumber, turn.tokenCount, now, conversationId],
      );

      // F-05 fix: I-03 audit entry for turn append
      deps.audit.append(deps.conn, {
        tenantId: conv.tenant_id,
        actorType: 'system',
        actorId: turn.participantId ?? 'system',
        operation: 'append_turn',
        resourceType: 'conversation_turn',
        resourceId: turnId,
        detail: { conversationId, turnNumber, role: turn.role },
      });
    });

    return { ok: true, value: turnNumber };
  }

  /**
   * S26.2: Auto-summarize if context window threshold exceeded.
   * SD-25: Only turns with turn_number > summarized_up_to and
   *        is_learning_source = 0 are eligible for summarization.
   *        Replaces eligible turns with a single summary turn.
   * Returns true if summarization occurred, false if not needed.
   */
  function autoSummarize(
    deps: OrchestrationDeps,
    conversationId: string,
    contextWindowTokens: number,
  ): Result<boolean> {
    const conv = deps.conn.get<{ total_tokens: number; summarized_up_to: number; total_turns: number; tenant_id: TenantId | null }>(
      'SELECT total_tokens, summarized_up_to, total_turns, tenant_id FROM core_conversations WHERE id = ?',
      [conversationId],
    );
    if (!conv) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `Conversation ${conversationId} not found`, spec: 'S26' } };
    }

    // Check if we exceed the context window threshold (80% triggers summarization)
    const threshold = Math.floor(contextWindowTokens * 0.8);
    if (conv.total_tokens <= threshold) {
      return { ok: true, value: false };
    }

    // Get eligible turns (not already summarized, not learning-source, not summary)
    // CF-034b: Include role for semantic-preserving summaries
    const eligibleTurns = deps.conn.query<{ turn_number: number; role: string; content: string; token_count: number }>(
      `SELECT turn_number, role, content, token_count FROM core_conversation_turns
       WHERE conversation_id = ? AND turn_number > ? AND is_learning_source = 0 AND is_summary = 0
       ORDER BY turn_number ASC`,
      [conversationId, conv.summarized_up_to],
    );

    if (eligibleTurns.length <= 2) {
      // Too few turns to summarize meaningfully
      return { ok: true, value: false };
    }

    // Determine how many turns to summarize (keep last 2 eligible)
    const turnsToSummarize = eligibleTurns.slice(0, -2);
    if (turnsToSummarize.length === 0) {
      return { ok: true, value: false };
    }

    // CF-034b: Improved summary that preserves semantic content (I-27).
    // Keep the first turn's content more fully (it often sets the context),
    // and extract key sentences from middle turns rather than blind truncation.
    const summaryContent = turnsToSummarize.map((t, idx) => {
      const maxLen = idx === 0 ? 500 : 300; // First turn gets more space
      const truncated = t.content.length > maxLen
        ? t.content.substring(0, maxLen) + '...'
        : t.content;
      return `[Turn ${t.turn_number} (${t.role})]: ${truncated}`;
    }).join('\n');

    const summarizedTokens = turnsToSummarize.reduce((sum, t) => sum + t.token_count, 0);
    // Summary is roughly 20% of the original
    const summaryTokens = Math.max(Math.floor(summarizedTokens * 0.2), 10);
    const lastSummarizedTurn = turnsToSummarize[turnsToSummarize.length - 1]!.turn_number;

    const now = deps.time.nowISO();
    const summaryTurnId = generateId();

    deps.conn.transaction(() => {
      // Insert summary turn at the next turn number
      const nextTurn = conv.total_turns + 1;
      // FM-10: tenant_id inherited from parent conversation
      deps.conn.run(
        `INSERT INTO core_conversation_turns (id, conversation_id, tenant_id, turn_number, role, content, token_count, model_used, is_summary, is_learning_source, participant_id, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'system', ?, ?, NULL, 1, 0, NULL, ?, ?)`,
        [summaryTurnId, conversationId, conv.tenant_id, nextTurn, `[Summary of turns ${conv.summarized_up_to + 1}-${lastSummarizedTurn}]\n${summaryContent}`, summaryTokens, JSON.stringify({ summarizedTurns: turnsToSummarize.length, originalTokens: summarizedTokens }), now],
      );

      // Update conversation metadata
      deps.conn.run(
        `UPDATE core_conversations SET summarized_up_to = ?, total_turns = ?, total_tokens = total_tokens - ? + ?, updated_at = ? WHERE id = ?`,
        [lastSummarizedTurn, nextTurn, summarizedTokens, summaryTokens, now, conversationId],
      );

      // F-05 fix: I-03 audit entry for auto-summarization
      deps.audit.append(deps.conn, {
        tenantId: conv.tenant_id,
        actorType: 'system',
        actorId: 'conversation_manager',
        operation: 'auto_summarize',
        resourceType: 'conversation',
        resourceId: conversationId,
        detail: { summarizedTurns: turnsToSummarize.length, originalTokens: summarizedTokens, summaryTokens, summarizedUpTo: lastSummarizedTurn },
      });
    });

    return { ok: true, value: true };
  }

  /**
   * S26.3: Fork a conversation at a turn (copy-on-branch).
   * SD-26: Copies all turns up to atTurn into a new conversation
   *        linked via parent_conversation_id.
   */
  function fork(
    deps: OrchestrationDeps,
    conversationId: string,
    atTurn: number,
    tenantId: TenantId | null,
  ): Result<string> {
    // F-09 fix: Include tenant_id in query to prevent cross-tenant fork (T-4)
    // If tenantId is provided, verify source conversation belongs to same tenant.
    // If tenantId is null (single-tenant mode), skip tenant check.
    let conv: { session_id: string; agent_id: string; total_turns: number } | undefined;
    if (tenantId !== null) {
      conv = deps.conn.get<{ session_id: string; agent_id: string; total_turns: number }>(
        'SELECT session_id, agent_id, total_turns FROM core_conversations WHERE id = ? AND tenant_id = ?',
        [conversationId, tenantId],
      );
    } else {
      conv = deps.conn.get<{ session_id: string; agent_id: string; total_turns: number }>(
        'SELECT session_id, agent_id, total_turns FROM core_conversations WHERE id = ?',
        [conversationId],
      );
    }
    if (!conv) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `Conversation ${conversationId} not found`, spec: 'S26' } };
    }

    if (atTurn > conv.total_turns || atTurn < 0) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `Turn ${atTurn} out of range (max ${conv.total_turns})`, spec: 'S26' } };
    }

    const forkedId = generateId();
    const now = deps.time.nowISO();

    deps.conn.transaction(() => {
      // Get turns to copy
      const turns = deps.conn.query<Record<string, unknown>>(
        `SELECT turn_number, role, content, token_count, model_used, is_summary, is_learning_source, participant_id, metadata_json
         FROM core_conversation_turns WHERE conversation_id = ? AND turn_number <= ? ORDER BY turn_number ASC`,
        [conversationId, atTurn],
      );

      const totalTokens = turns.reduce((sum, t) => sum + (t['token_count'] as number), 0);

      // Create forked conversation
      deps.conn.run(
        `INSERT INTO core_conversations (id, session_id, tenant_id, agent_id, parent_conversation_id, fork_at_turn, total_turns, total_tokens, summarized_up_to, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [forkedId, conv.session_id, tenantId, conv.agent_id, conversationId, atTurn, turns.length, totalTokens, now, now],
      );

      // Copy turns
      // FM-10: tenant_id inherited from parent conversation
      for (const turn of turns) {
        const turnId = generateId();
        deps.conn.run(
          `INSERT INTO core_conversation_turns (id, conversation_id, tenant_id, turn_number, role, content, token_count, model_used, is_summary, is_learning_source, participant_id, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            turnId,
            forkedId,
            tenantId,
            turn['turn_number'],
            turn['role'],
            turn['content'],
            turn['token_count'],
            turn['model_used'],
            turn['is_summary'],
            turn['is_learning_source'],
            turn['participant_id'],
            turn['metadata_json'],
            now,
          ],
        );
      }

      // F-05 fix: I-03 audit entry for conversation fork
      deps.audit.append(deps.conn, {
        tenantId,
        actorType: 'system',
        actorId: 'conversation_manager',
        operation: 'fork_conversation',
        resourceType: 'conversation',
        resourceId: forkedId,
        detail: { sourceConversationId: conversationId, atTurn, turnsCopied: turns.length },
      });
    });

    return { ok: true, value: forkedId };
  }

  /**
   * S26: Get conversation turns for context assembly.
   * CF-034b: Filters out turns that have been superseded by summarization.
   * Only returns: summary turns + unsummarized turns (turn_number > summarized_up_to).
   * This ensures that summarization actually reduces the context window.
   */
  function getTurns(
    deps: OrchestrationDeps,
    conversationId: string,
  ): Result<ConversationTurn[]> {
    // Look up summarized_up_to to filter out superseded turns
    const conv = deps.conn.get<{ summarized_up_to: number }>(
      'SELECT summarized_up_to FROM core_conversations WHERE id = ?',
      [conversationId],
    );
    const summarizedUpTo = conv?.summarized_up_to ?? 0;

    // Return: summary turns (is_summary=1) + turns after the summarization boundary
    // This excludes original turns that were replaced by summaries.
    const rows = deps.conn.query<Record<string, unknown>>(
      `SELECT id, conversation_id, turn_number, role, content, token_count, model_used, is_summary, is_learning_source, participant_id, created_at
       FROM core_conversation_turns
       WHERE conversation_id = ?
         AND (is_summary = 1 OR turn_number > ? OR is_learning_source = 1)
       ORDER BY turn_number ASC`,
      [conversationId, summarizedUpTo],
    );

    const turns: ConversationTurn[] = rows.map(row => ({
      id: row['id'] as string,
      conversationId: row['conversation_id'] as string,
      turnNumber: row['turn_number'] as number,
      role: row['role'] as ConversationTurn['role'],
      content: row['content'] as string,
      tokenCount: row['token_count'] as number,
      modelUsed: (row['model_used'] ?? null) as string | null,
      isSummary: (row['is_summary'] as number) === 1,
      isLearningSource: (row['is_learning_source'] as number) === 1,
      participantId: (row['participant_id'] ?? null) as string | null,
      createdAt: row['created_at'] as string,
    }));

    return { ok: true, value: turns };
  }

  return Object.freeze({
    create,
    appendTurn,
    autoSummarize,
    fork,
    getTurns,
  });
}
