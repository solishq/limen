/**
 * BREAKER: Sprint 2 Interaction Recording Attack Tests
 * Target: LEARNING-02 core_interactions table (migration v33, chat_pipeline.ts Phase 7)
 *
 * Attack vectors: IR-01 through IR-09
 * Classification: Tier 1 (data integrity, content immutability, tenant isolation)
 *
 * What we attack:
 *   - Content immutability (UPDATE user_input, UPDATE assistant_output)
 *   - Quality score mutability (should succeed)
 *   - User feedback mutability (should succeed)
 *   - NULL agent_id (sessionless interactions)
 *   - Cross-tenant interaction visibility
 *   - Large payload in user_input/assistant_output
 *   - Interaction timestamps
 *   - Duplicate interaction IDs (UUID collision)
 *   - Invalid user_feedback values
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from '../helpers/test_database.js';
import type { DatabaseConnection } from '../../src/kernel/interfaces/index.js';

describe('BREAKER: Sprint 2 Interaction Recording Attacks', () => {
  let conn: DatabaseConnection;

  beforeEach(() => {
    conn = createTestDatabase();
  });

  // ─── Helper: insert interaction directly ───
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
    createdAt?: string;
  }): string {
    const id = overrides?.id ?? crypto.randomUUID();
    const now = overrides?.createdAt ?? new Date().toISOString();
    // Use property-in check for nullable fields to distinguish undefined from null
    const effectiveTenantId = overrides && 'tenantId' in overrides ? overrides.tenantId : 'test-tenant';
    const effectiveAgentId = overrides && 'agentId' in overrides ? overrides.agentId : 'test-agent';

    conn.run(
      `INSERT INTO core_interactions (id, tenant_id, agent_id, session_id, conversation_id, user_input, assistant_output, model_used, input_tokens, output_tokens, quality_score, user_feedback, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        effectiveTenantId,
        effectiveAgentId,
        overrides?.sessionId ?? 'session-001',
        overrides?.conversationId ?? 'conv-001',
        overrides?.userInput ?? 'Hello',
        overrides?.assistantOutput ?? 'Hi there!',
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

  // ═══════════════════════════════════════════════════════════════════════════
  // IR-01: Content Immutability — user_input and assistant_output
  // CATCHES: If content immutability trigger is missing, conversation
  // records can be tampered with post-hoc.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('IR-01: Content Immutability', () => {
    it('IR-01a: UPDATE user_input with DIFFERENT value BLOCKED', () => {
      const id = insertInteraction({ userInput: 'original question' });

      assert.throws(
        () => conn.run('UPDATE core_interactions SET user_input = ? WHERE id = ?', ['hacked question', id]),
        (err: Error) => {
          assert.ok(err.message.includes('INTERACTION_CONTENT_IMMUTABLE'),
            `Expected immutability error, got: ${err.message}`);
          return true;
        },
      );

      // Verify unchanged
      const row = conn.get<{ user_input: string }>('SELECT user_input FROM core_interactions WHERE id = ?', [id]);
      assert.equal(row?.user_input, 'original question', 'user_input must remain unchanged');
    });

    it('IR-01b: UPDATE assistant_output with DIFFERENT value BLOCKED', () => {
      const id = insertInteraction({ assistantOutput: 'original response' });

      assert.throws(
        () => conn.run('UPDATE core_interactions SET assistant_output = ? WHERE id = ?', ['hacked response', id]),
        (err: Error) => {
          assert.ok(err.message.includes('INTERACTION_CONTENT_IMMUTABLE'),
            `Expected immutability error, got: ${err.message}`);
          return true;
        },
      );

      const row = conn.get<{ assistant_output: string }>('SELECT assistant_output FROM core_interactions WHERE id = ?', [id]);
      assert.equal(row?.assistant_output, 'original response', 'assistant_output must remain unchanged');
    });

    it('IR-01c: UPDATE user_input to SAME value is ALLOWED (no actual change)', () => {
      const id = insertInteraction({ userInput: 'same value' });

      // WHEN clause in trigger checks for actual change — same value should pass
      assert.doesNotThrow(
        () => conn.run('UPDATE core_interactions SET user_input = ? WHERE id = ?', ['same value', id]),
        'Updating to same value should not trigger immutability error',
      );
    });

    it('IR-01d: UPDATE assistant_output to SAME value is ALLOWED', () => {
      const id = insertInteraction({ assistantOutput: 'same response' });

      assert.doesNotThrow(
        () => conn.run('UPDATE core_interactions SET assistant_output = ? WHERE id = ?', ['same response', id]),
        'Updating to same value should not trigger immutability error',
      );
    });

    it('IR-01e: UPDATE both user_input AND assistant_output BLOCKED when content changes', () => {
      const id = insertInteraction({ userInput: 'original Q', assistantOutput: 'original A' });

      assert.throws(
        () => conn.run(
          'UPDATE core_interactions SET user_input = ?, assistant_output = ? WHERE id = ?',
          ['hacked Q', 'hacked A', id],
        ),
        (err: Error) => {
          assert.ok(err.message.includes('INTERACTION_CONTENT_IMMUTABLE'),
            `Expected immutability error, got: ${err.message}`);
          return true;
        },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // IR-02: Mutable Fields — quality_score and user_feedback
  // CATCHES: These fields must be updatable for the learning pipeline.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('IR-02: Mutable Fields', () => {
    it('IR-02a: quality_score can be set on initially null', () => {
      const id = insertInteraction({ qualityScore: null });

      conn.run('UPDATE core_interactions SET quality_score = ? WHERE id = ?', [0.85, id]);

      const row = conn.get<{ quality_score: number }>('SELECT quality_score FROM core_interactions WHERE id = ?', [id]);
      assert.equal(row?.quality_score, 0.85, 'quality_score should be updatable');
    });

    it('IR-02b: quality_score can be updated from one value to another', () => {
      const id = insertInteraction({ qualityScore: 0.5 });

      conn.run('UPDATE core_interactions SET quality_score = ? WHERE id = ?', [0.95, id]);

      const row = conn.get<{ quality_score: number }>('SELECT quality_score FROM core_interactions WHERE id = ?', [id]);
      assert.equal(row?.quality_score, 0.95, 'quality_score update from 0.5 to 0.95 should succeed');
    });

    it('IR-02c: user_feedback can be set on initially null', () => {
      const id = insertInteraction({ userFeedback: null });

      conn.run('UPDATE core_interactions SET user_feedback = ? WHERE id = ?', ['positive', id]);

      const row = conn.get<{ user_feedback: string }>('SELECT user_feedback FROM core_interactions WHERE id = ?', [id]);
      assert.equal(row?.user_feedback, 'positive', 'user_feedback should be updatable');
    });

    it('IR-02d: user_feedback can change between valid values', () => {
      const id = insertInteraction({ userFeedback: 'positive' });

      conn.run('UPDATE core_interactions SET user_feedback = ? WHERE id = ?', ['negative', id]);

      const row = conn.get<{ user_feedback: string }>('SELECT user_feedback FROM core_interactions WHERE id = ?', [id]);
      assert.equal(row?.user_feedback, 'negative');
    });

    it('IR-02e: quality_score update does NOT trigger content immutability', () => {
      const id = insertInteraction({ userInput: 'keep this', assistantOutput: 'keep this too', qualityScore: 0.5 });

      // This should NOT raise INTERACTION_CONTENT_IMMUTABLE
      assert.doesNotThrow(
        () => conn.run('UPDATE core_interactions SET quality_score = ? WHERE id = ?', [0.9, id]),
        'quality_score update must not trigger content immutability guard',
      );

      // Verify content unchanged
      const row = conn.get<{ user_input: string; assistant_output: string }>(
        'SELECT user_input, assistant_output FROM core_interactions WHERE id = ?', [id],
      );
      assert.equal(row?.user_input, 'keep this');
      assert.equal(row?.assistant_output, 'keep this too');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // IR-03: NULL agent_id (sessionless interactions)
  // CATCHES: The schema allows NULL agent_id for system-level interactions
  // without a bound agent.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('IR-03: NULL agent_id', () => {
    it('IR-03a: interaction with NULL agent_id is accepted', () => {
      const id = insertInteraction({ agentId: null });

      const row = conn.get<{ agent_id: string | null }>('SELECT agent_id FROM core_interactions WHERE id = ?', [id]);
      assert.equal(row?.agent_id, null, 'NULL agent_id should be accepted');
    });

    it('IR-03b: interaction with NULL session_id is accepted', () => {
      // session_id is also nullable
      const id = crypto.randomUUID();
      conn.run(
        `INSERT INTO core_interactions (id, tenant_id, agent_id, session_id, conversation_id, user_input, assistant_output, model_used, input_tokens, output_tokens, created_at)
         VALUES (?, 'test-tenant', NULL, NULL, NULL, 'test', 'test', 'default', 0, 0, ?)`,
        [id, new Date().toISOString()],
      );

      const row = conn.get<{ session_id: string | null }>('SELECT session_id FROM core_interactions WHERE id = ?', [id]);
      assert.equal(row?.session_id, null, 'NULL session_id should be accepted');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // IR-04: Cross-Tenant Interaction Visibility
  // CATCHES: Tenant isolation breach where tenant-A can read tenant-B's interactions.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('IR-04: Cross-Tenant Interaction Visibility', () => {
    it('IR-04a: COALESCE tenant scoping prevents cross-tenant reads', () => {
      insertInteraction({ tenantId: 'tenant-a', userInput: 'secret-a' });
      insertInteraction({ tenantId: 'tenant-b', userInput: 'secret-b' });

      // Query as tenant-a
      const rowsA = conn.query<{ user_input: string }>(
        `SELECT user_input FROM core_interactions WHERE COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')`,
        ['tenant-a'],
      );
      assert.equal(rowsA.length, 1);
      assert.equal(rowsA[0]!.user_input, 'secret-a');

      // Query as tenant-b
      const rowsB = conn.query<{ user_input: string }>(
        `SELECT user_input FROM core_interactions WHERE COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')`,
        ['tenant-b'],
      );
      assert.equal(rowsB.length, 1);
      assert.equal(rowsB[0]!.user_input, 'secret-b');
    });

    it('IR-04b: NULL tenant interactions isolated from named tenants', () => {
      insertInteraction({ tenantId: null, userInput: 'null-tenant input' });
      insertInteraction({ tenantId: 'real-tenant', userInput: 'real-tenant input' });

      const nullRows = conn.query<{ user_input: string }>(
        `SELECT user_input FROM core_interactions WHERE COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')`,
        [null],
      );
      assert.equal(nullRows.length, 1);
      assert.equal(nullRows[0]!.user_input, 'null-tenant input');

      const realRows = conn.query<{ user_input: string }>(
        `SELECT user_input FROM core_interactions WHERE COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')`,
        ['real-tenant'],
      );
      assert.equal(realRows.length, 1);
      assert.equal(realRows[0]!.user_input, 'real-tenant input');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // IR-05: Large Payload Handling
  // CATCHES: Boundary testing for very large user_input/assistant_output.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('IR-05: Large Payload Handling', () => {
    it('IR-05a: 1MB user_input does not crash', () => {
      const largeInput = 'x'.repeat(1_000_000);
      const id = insertInteraction({ userInput: largeInput });

      const row = conn.get<{ user_input: string }>('SELECT user_input FROM core_interactions WHERE id = ?', [id]);
      assert.ok(row);
      assert.equal(row.user_input.length, 1_000_000, 'Large user_input should be stored and retrieved');
    });

    it('IR-05b: 1MB assistant_output does not crash', () => {
      const largeOutput = 'y'.repeat(1_000_000);
      const id = insertInteraction({ assistantOutput: largeOutput });

      const row = conn.get<{ assistant_output: string }>('SELECT assistant_output FROM core_interactions WHERE id = ?', [id]);
      assert.ok(row);
      assert.equal(row.assistant_output.length, 1_000_000, 'Large assistant_output should be stored and retrieved');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // IR-06: Duplicate Interaction IDs
  // CATCHES: UUID collision (or intentional reuse) should be rejected
  // by PRIMARY KEY constraint.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('IR-06: Duplicate Interaction IDs', () => {
    it('IR-06a: duplicate id rejected by PRIMARY KEY', () => {
      const id = insertInteraction();

      assert.throws(
        () => insertInteraction({ id }),
        (err: Error) => {
          assert.ok(
            err.message.includes('UNIQUE') || err.message.includes('PRIMARY KEY'),
            `Expected PK violation, got: ${err.message}`,
          );
          return true;
        },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // IR-07: Invalid user_feedback Values
  // CATCHES: CHECK constraint enforcement on user_feedback enum.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('IR-07: Invalid user_feedback Values', () => {
    it('IR-07a: invalid user_feedback on INSERT rejected', () => {
      assert.throws(
        () => insertInteraction({ userFeedback: 'invalid-value' }),
        (err: Error) => {
          assert.ok(err.message.includes('CHECK constraint'),
            `Expected CHECK constraint failure, got: ${err.message}`);
          return true;
        },
      );
    });

    it('IR-07b: invalid user_feedback on UPDATE rejected', () => {
      const id = insertInteraction({ userFeedback: null });

      assert.throws(
        () => conn.run('UPDATE core_interactions SET user_feedback = ? WHERE id = ?', ['thumbs_up', id]),
        (err: Error) => {
          assert.ok(err.message.includes('CHECK constraint'),
            `Expected CHECK constraint failure on update, got: ${err.message}`);
          return true;
        },
      );
    });

    it('IR-07c: all valid user_feedback values accepted', () => {
      for (const feedback of ['positive', 'negative', 'correction'] as const) {
        const id = insertInteraction({ userFeedback: feedback });
        const row = conn.get<{ user_feedback: string }>('SELECT user_feedback FROM core_interactions WHERE id = ?', [id]);
        assert.equal(row?.user_feedback, feedback, `${feedback} should be accepted`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // IR-08: DELETE on Interactions
  // CATCHES: Unlike trust_transitions and safety_violations, interactions
  // do NOT have a no-delete trigger. Verify this is by design.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('IR-08: Interaction Deletion', () => {
    it('IR-08a: interaction records can be deleted (no append-only trigger)', () => {
      // NOTE: core_interactions does NOT have a no-delete trigger.
      // This is intentional — I-02 (user data ownership) requires delete capability.
      // This test documents the design choice.
      const id = insertInteraction();

      const before = conn.get<{ id: string }>('SELECT id FROM core_interactions WHERE id = ?', [id]);
      assert.ok(before, 'Interaction should exist before delete');

      conn.run('DELETE FROM core_interactions WHERE id = ?', [id]);

      const after = conn.get<{ id: string }>('SELECT id FROM core_interactions WHERE id = ?', [id]);
      assert.equal(after, undefined, 'Interaction should be deleted');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // IR-09: Token Count Boundary
  // CATCHES: Zero and very large token counts should be handled.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('IR-09: Token Count Boundaries', () => {
    it('IR-09a: zero token counts accepted', () => {
      const id = insertInteraction({ inputTokens: 0, outputTokens: 0 });

      const row = conn.get<{ input_tokens: number; output_tokens: number }>(
        'SELECT input_tokens, output_tokens FROM core_interactions WHERE id = ?', [id],
      );
      assert.equal(row?.input_tokens, 0);
      assert.equal(row?.output_tokens, 0);
    });

    it('IR-09b: large token counts stored correctly', () => {
      const id = insertInteraction({ inputTokens: 1_000_000, outputTokens: 500_000 });

      const row = conn.get<{ input_tokens: number; output_tokens: number }>(
        'SELECT input_tokens, output_tokens FROM core_interactions WHERE id = ?', [id],
      );
      assert.equal(row?.input_tokens, 1_000_000);
      assert.equal(row?.output_tokens, 500_000);
    });
  });
});
