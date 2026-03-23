/**
 * Contract tests for LEARNING-02 Interaction Recording (Sprint 2 Trust & Learning).
 * Validates core_interactions table, content immutability trigger, and tenant isolation.
 *
 * Phase: Sprint 2 (Trust & Learning)
 * Spec ref: LEARNING-02 (Interaction Table), FM-10 (Tenant Isolation)
 *
 * Tests cover:
 *   - Interaction insertion and retrieval
 *   - Content immutability (user_input and assistant_output triggers)
 *   - quality_score and user_feedback are mutable
 *   - Tenant isolation on interactions
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from '../helpers/test_database.js';
import type { DatabaseConnection } from '../../src/kernel/interfaces/index.js';

describe('LEARNING-02 Interaction Recording — Contract Tests', () => {
  let conn: DatabaseConnection;

  beforeEach(() => {
    conn = createTestDatabase();
  });

  // ─── Helper: insert an interaction directly ───
  function insertInteraction(overrides?: {
    id?: string;
    tenantId?: string | null;
    agentId?: string | null;
    sessionId?: string;
    conversationId?: string;
    userInput?: string;
    assistantOutput?: string;
    modelUsed?: string;
    inputTokens?: number;
    outputTokens?: number;
    qualityScore?: number | null;
    userFeedback?: string | null;
  }): string {
    const id = overrides?.id ?? crypto.randomUUID();
    const now = new Date().toISOString();

    conn.run(
      `INSERT INTO core_interactions (id, tenant_id, agent_id, session_id, conversation_id, user_input, assistant_output, model_used, input_tokens, output_tokens, quality_score, user_feedback, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        overrides?.tenantId ?? 'test-tenant',
        overrides?.agentId ?? 'test-agent',
        overrides?.sessionId ?? 'session-001',
        overrides?.conversationId ?? 'conv-001',
        overrides?.userInput ?? 'Hello, how are you?',
        overrides?.assistantOutput ?? 'I am doing well, thank you!',
        overrides?.modelUsed ?? 'default',
        overrides?.inputTokens ?? 10,
        overrides?.outputTokens ?? 15,
        overrides?.qualityScore ?? null,
        overrides?.userFeedback ?? null,
        now,
      ],
    );
    return id;
  }

  // ─── Insertion and Retrieval ───

  describe('Insertion and Retrieval', () => {
    it('interaction is recorded with all fields', () => {
      const id = insertInteraction({
        userInput: 'What is the weather?',
        assistantOutput: 'It is sunny today.',
        modelUsed: 'gpt-4',
        inputTokens: 5,
        outputTokens: 6,
      });

      const row = conn.get<{
        id: string; user_input: string; assistant_output: string;
        model_used: string; input_tokens: number; output_tokens: number;
      }>('SELECT * FROM core_interactions WHERE id = ?', [id]);

      assert.ok(row);
      assert.equal(row.user_input, 'What is the weather?');
      assert.equal(row.assistant_output, 'It is sunny today.');
      assert.equal(row.model_used, 'gpt-4');
      assert.equal(row.input_tokens, 5);
      assert.equal(row.output_tokens, 6);
    });

    it('interaction with null quality_score and user_feedback', () => {
      const id = insertInteraction({ qualityScore: null, userFeedback: null });

      const row = conn.get<{ quality_score: number | null; user_feedback: string | null }>(
        'SELECT quality_score, user_feedback FROM core_interactions WHERE id = ?', [id],
      );
      assert.ok(row);
      assert.equal(row.quality_score, null);
      assert.equal(row.user_feedback, null);
    });

    it('interaction with valid user_feedback values', () => {
      for (const feedback of ['positive', 'negative', 'correction'] as const) {
        const id = insertInteraction({ id: crypto.randomUUID(), userFeedback: feedback });
        const row = conn.get<{ user_feedback: string }>(
          'SELECT user_feedback FROM core_interactions WHERE id = ?', [id],
        );
        assert.ok(row);
        assert.equal(row.user_feedback, feedback);
      }
    });

    it('invalid user_feedback rejected by CHECK constraint', () => {
      assert.throws(
        () => insertInteraction({ userFeedback: 'invalid' }),
        (err: Error) => err.message.includes('CHECK constraint'),
        'Invalid feedback value should be rejected',
      );
    });
  });

  // ─── Content Immutability ───

  describe('Content Immutability', () => {
    it('user_input cannot be modified', () => {
      const id = insertInteraction({ userInput: 'original question' });

      assert.throws(
        () => conn.run('UPDATE core_interactions SET user_input = ? WHERE id = ?', ['hacked question', id]),
        (err: Error) => err.message.includes('INTERACTION_CONTENT_IMMUTABLE'),
        'user_input must be immutable',
      );

      // Verify unchanged
      const row = conn.get<{ user_input: string }>('SELECT user_input FROM core_interactions WHERE id = ?', [id]);
      assert.equal(row?.user_input, 'original question');
    });

    it('assistant_output cannot be modified', () => {
      const id = insertInteraction({ assistantOutput: 'original response' });

      assert.throws(
        () => conn.run('UPDATE core_interactions SET assistant_output = ? WHERE id = ?', ['hacked response', id]),
        (err: Error) => err.message.includes('INTERACTION_CONTENT_IMMUTABLE'),
        'assistant_output must be immutable',
      );

      // Verify unchanged
      const row = conn.get<{ assistant_output: string }>('SELECT assistant_output FROM core_interactions WHERE id = ?', [id]);
      assert.equal(row?.assistant_output, 'original response');
    });

    it('updating user_input to same value is allowed (no actual change)', () => {
      const id = insertInteraction({ userInput: 'same value' });

      // This should NOT trigger because WHEN clause checks for actual change
      assert.doesNotThrow(
        () => conn.run('UPDATE core_interactions SET user_input = ? WHERE id = ?', ['same value', id]),
      );
    });
  });

  // ─── Mutable Fields ───

  describe('Mutable Fields', () => {
    it('quality_score can be updated', () => {
      const id = insertInteraction({ qualityScore: null });

      conn.run('UPDATE core_interactions SET quality_score = ? WHERE id = ?', [0.85, id]);

      const row = conn.get<{ quality_score: number }>('SELECT quality_score FROM core_interactions WHERE id = ?', [id]);
      assert.equal(row?.quality_score, 0.85);
    });

    it('user_feedback can be updated', () => {
      const id = insertInteraction({ userFeedback: null });

      conn.run('UPDATE core_interactions SET user_feedback = ? WHERE id = ?', ['positive', id]);

      const row = conn.get<{ user_feedback: string }>('SELECT user_feedback FROM core_interactions WHERE id = ?', [id]);
      assert.equal(row?.user_feedback, 'positive');
    });

    it('quality_score can be updated from one value to another', () => {
      const id = insertInteraction({ qualityScore: 0.5 });

      conn.run('UPDATE core_interactions SET quality_score = ? WHERE id = ?', [0.9, id]);

      const row = conn.get<{ quality_score: number }>('SELECT quality_score FROM core_interactions WHERE id = ?', [id]);
      assert.equal(row?.quality_score, 0.9);
    });
  });

  // ─── Tenant Isolation ───

  describe('Tenant Isolation', () => {
    it('tenant-A interactions invisible when querying tenant-B', () => {
      insertInteraction({ tenantId: 'tenant-a', userInput: 'tenant-a input' });
      insertInteraction({ tenantId: 'tenant-b', userInput: 'tenant-b input' });

      const rowsA = conn.query<{ user_input: string }>(
        `SELECT user_input FROM core_interactions WHERE COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')`,
        ['tenant-a'],
      );
      const rowsB = conn.query<{ user_input: string }>(
        `SELECT user_input FROM core_interactions WHERE COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')`,
        ['tenant-b'],
      );

      assert.equal(rowsA.length, 1);
      assert.equal(rowsA[0]!.user_input, 'tenant-a input');
      assert.equal(rowsB.length, 1);
      assert.equal(rowsB[0]!.user_input, 'tenant-b input');
    });
  });

  // ─── Learning Pipeline Partial Index ───

  describe('Learning Pipeline Index', () => {
    it('partial index covers quality > 0.7 with positive feedback', () => {
      // Insert interactions with various quality/feedback combinations
      insertInteraction({ id: 'int-1', qualityScore: 0.9, userFeedback: 'positive', agentId: 'agent-1' });
      insertInteraction({ id: 'int-2', qualityScore: 0.5, userFeedback: 'positive', agentId: 'agent-1' });
      insertInteraction({ id: 'int-3', qualityScore: 0.8, userFeedback: 'negative', agentId: 'agent-1' });
      insertInteraction({ id: 'int-4', qualityScore: 0.95, userFeedback: 'positive', agentId: 'agent-1' });
      insertInteraction({ id: 'int-5', qualityScore: null, userFeedback: null, agentId: 'agent-1' });

      // Query as the learning pipeline would
      const rows = conn.query<{ id: string }>(
        `SELECT id FROM core_interactions
         WHERE agent_id = ?
           AND quality_score > 0.7
           AND user_feedback = 'positive'
         ORDER BY quality_score DESC`,
        ['agent-1'],
      );

      assert.equal(rows.length, 2, 'Only high-quality positive interactions');
      assert.equal(rows[0]!.id, 'int-4'); // 0.95
      assert.equal(rows[1]!.id, 'int-1'); // 0.9
    });
  });
});
