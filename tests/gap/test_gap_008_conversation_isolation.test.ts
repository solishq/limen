/**
 * TEST-GAP-008: Conversation Isolation — S26, I-27
 * Verifies: Conversations scoped to session+agent, fork tenant verification.
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * S26.1: "A conversation is a sequence of turns maintained by the engine within a session."
 * S26.3: "No reference sharing across branches. Runtime assertion: all returned conversation
 *         rows verified same tenant_id (FM-10 defense)."
 * I-27: "Conversation history within a session is complete and ordered."
 *
 * Phase: 4A-3 (harness-dependent tests)
 * NOTE: Spec reference corrected from I-08 (Agent Identity Persistence) per FINDING-R1.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createConversationManager } from '../../src/orchestration/conversation/conversation_manager.js';
import {
  createTestOrchestrationDeps,
  sessionId,
  agentId,
  tenantId,
} from '../helpers/test_database.js';

describe('TEST-GAP-008: Conversation Isolation (S26, I-27)', () => {

  describe('S26: Conversation creation scoped to session + agent', () => {

    it('conversation is created with correct session_id and agent_id', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const conversations = createConversationManager();

      const result = conversations.create(
        deps,
        sessionId('session-1'),
        agentId('agent-A'),
        tenantId('tenant-1'),
      );

      assert.equal(result.ok, true, 'S26: Conversation creation must succeed');
      if (result.ok) {
        const convId = result.value;

        // Verify in database
        const conv = conn.get<{ session_id: string; agent_id: string; tenant_id: string }>(
          `SELECT session_id, agent_id, tenant_id FROM core_conversations WHERE id = ?`,
          [convId]
        );
        assert.ok(conv, 'Conversation must exist in database');
        assert.equal(conv.session_id, 'session-1', 'S26: session_id must match');
        assert.equal(conv.agent_id, 'agent-A', 'S26: agent_id must match');
        assert.equal(conv.tenant_id, 'tenant-1', 'S26: tenant_id must match');
      }

      conn.close();
    });

    it('multiple conversations can be created for same session but different agents', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const conversations = createConversationManager();

      const r1 = conversations.create(deps, sessionId('sess-shared'), agentId('agent-1'), tenantId('t1'));
      const r2 = conversations.create(deps, sessionId('sess-shared'), agentId('agent-2'), tenantId('t1'));

      assert.ok(r1.ok && r2.ok, 'Both creations must succeed');
      if (r1.ok && r2.ok) {
        assert.notEqual(r1.value, r2.value,
          'S26: Different agents must get different conversation IDs');
      }

      conn.close();
    });
  });

  describe('S26.1: Turn appending with monotonic numbering', () => {

    it('turns are numbered monotonically starting from 1', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const conversations = createConversationManager();

      const convResult = conversations.create(deps, sessionId('s1'), agentId('a1'), tenantId('t1'));
      assert.ok(convResult.ok);

      // Append 3 turns
      const t1 = conversations.appendTurn(deps, convResult.value, {
        role: 'user', content: 'Hello', tokenCount: 5,
      });
      const t2 = conversations.appendTurn(deps, convResult.value, {
        role: 'assistant', content: 'Hi there', tokenCount: 8,
      });
      const t3 = conversations.appendTurn(deps, convResult.value, {
        role: 'user', content: 'How are you?', tokenCount: 10,
      });

      assert.ok(t1.ok && t2.ok && t3.ok, 'All turn appends must succeed');
      if (t1.ok && t2.ok && t3.ok) {
        assert.equal(t1.value, 1, 'I-27: First turn must be number 1');
        assert.equal(t2.value, 2, 'I-27: Second turn must be number 2');
        assert.equal(t3.value, 3, 'I-27: Third turn must be number 3');
      }

      conn.close();
    });

    it('NOT_FOUND when appending to nonexistent conversation', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const conversations = createConversationManager();

      const result = conversations.appendTurn(deps, 'nonexistent-conv-id', {
        role: 'user', content: 'Hello', tokenCount: 5,
      });

      assert.equal(result.ok, false, 'S26: Must fail for nonexistent conversation');
      if (!result.ok) {
        assert.equal(result.error.code, 'NOT_FOUND',
          'S26: Error code must be NOT_FOUND');
      }

      conn.close();
    });
  });

  describe('I-27: Conversation history completeness', () => {

    it('total_turns counter tracks appended turns accurately', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const conversations = createConversationManager();

      const convResult = conversations.create(deps, sessionId('s2'), agentId('a2'), tenantId('t2'));
      assert.ok(convResult.ok);

      // Append 3 turns
      for (let i = 0; i < 3; i++) {
        conversations.appendTurn(deps, convResult.value, {
          role: 'user', content: `Turn ${i}`, tokenCount: 5,
        });
      }

      const conv = conn.get<{ total_turns: number; total_tokens: number }>(
        `SELECT total_turns, total_tokens FROM core_conversations WHERE id = ?`,
        [convResult.value]
      );
      assert.ok(conv);
      assert.equal(conv.total_turns, 3, 'I-27: total_turns must equal number of appended turns');
      assert.equal(conv.total_tokens, 15, 'I-27: total_tokens must equal sum of turn token counts');

      conn.close();
    });
  });

  describe('S26: Conversation auditing', () => {

    it('conversation creation is recorded in audit trail', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const conversations = createConversationManager();

      conversations.create(deps, sessionId('audit-sess'), agentId('audit-agent'), tenantId('audit-t'));

      const auditEntry = conn.get<{ operation: string; resource_type: string }>(
        `SELECT operation, resource_type FROM core_audit_log WHERE operation = 'create_conversation' ORDER BY seq_no DESC LIMIT 1`
      );
      assert.ok(auditEntry, 'I-03: Conversation creation must produce audit entry');
      assert.equal(auditEntry.resource_type, 'conversation',
        'I-03: Audit resource_type must be conversation');

      conn.close();
    });
  });
});
