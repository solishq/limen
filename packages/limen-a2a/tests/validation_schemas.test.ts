/**
 * A2A Perimeter Validation Schema Tests
 *
 * Verifies that Zod schemas correctly accept valid input and reject
 * malformed input at the trust boundary. Structure validation only —
 * semantic validation is Limen engine's responsibility.
 *
 * Each schema has: [A21 success] valid input accepted, [A21 rejection] invalid input rejected.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  A2ATaskSendParamsSchema,
  ClaimCreateInputSchema,
  ClaimQueryInputSchema,
  WriteWorkingMemoryInputSchema,
  ReadWorkingMemoryInputSchema,
  DiscardWorkingMemoryInputSchema,
  MissionCreateOptionsSchema,
  MissionFilterSchema,
  AgentRegisterSchema,
  AgentGetSchema,
  AgentPromoteSchema,
} from '../src/validation/schemas.js';

// ── A2A Envelope ──

describe('A2ATaskSendParamsSchema', () => {
  it('[A21: success] accepts valid task send params', () => {
    const result = A2ATaskSendParamsSchema.parse({
      id: 'task-001',
      message: { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      metadata: { skill: 'health', action: 'default' },
    });
    assert.equal(result.id, 'task-001');
    assert.equal(result.message.role, 'user');
    assert.equal(result.metadata?.skill, 'health');
  });

  it('[A21: success] accepts params without optional id', () => {
    const result = A2ATaskSendParamsSchema.parse({
      message: { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    });
    assert.equal(result.id, undefined);
  });

  it('[A21: rejection] rejects missing message', () => {
    assert.throws(() => A2ATaskSendParamsSchema.parse({ id: 'x' }), z.ZodError);
  });

  it('[A21: rejection] rejects invalid message role', () => {
    assert.throws(() => A2ATaskSendParamsSchema.parse({
      message: { role: 'system', parts: [{ type: 'text', text: 'x' }] },
    }), z.ZodError);
  });

  it('[A21: rejection] rejects unknown keys (strict)', () => {
    assert.throws(() => A2ATaskSendParamsSchema.parse({
      message: { role: 'user', parts: [{ type: 'text', text: 'x' }] },
      hackerField: 'injected',
    }), z.ZodError);
  });
});

// ── Claim Schemas ──

describe('ClaimCreateInputSchema', () => {
  const validClaim = {
    subject: 'entity:product:p-001',
    predicate: 'commerce.price',
    object: { type: 'number', value: 42.5 },
    confidence: 0.85,
    validAt: '2026-03-24T00:00:00Z',
    missionId: 'mission-001',
    taskId: 'task-001',
    evidenceRefs: [{ type: 'artifact', id: 'art-001' }],
    groundingMode: 'evidence_path',
  };

  it('[A21: success] accepts valid claim input', () => {
    const result = ClaimCreateInputSchema.parse(validClaim);
    assert.equal(result.subject, 'entity:product:p-001');
    assert.equal(result.confidence, 0.85);
    assert.equal(result.evidenceRefs.length, 1);
  });

  it('[A21: success] accepts null taskId', () => {
    const result = ClaimCreateInputSchema.parse({ ...validClaim, taskId: null });
    assert.equal(result.taskId, null);
  });

  it('[A21: rejection] rejects confidence > 1', () => {
    assert.throws(() => ClaimCreateInputSchema.parse({ ...validClaim, confidence: 1.5 }), z.ZodError);
  });

  it('[A21: rejection] rejects confidence < 0', () => {
    assert.throws(() => ClaimCreateInputSchema.parse({ ...validClaim, confidence: -0.1 }), z.ZodError);
  });

  it('[A21: rejection] rejects invalid groundingMode', () => {
    assert.throws(() => ClaimCreateInputSchema.parse({ ...validClaim, groundingMode: 'magic' }), z.ZodError);
  });

  it('[A21: rejection] rejects missing required fields', () => {
    assert.throws(() => ClaimCreateInputSchema.parse({ subject: 'x' }), z.ZodError);
  });

  it('[A21: rejection] rejects unknown keys (strict)', () => {
    assert.throws(() => ClaimCreateInputSchema.parse({ ...validClaim, tenantId: 'evil' }), z.ZodError);
  });
});

describe('ClaimQueryInputSchema', () => {
  it('[A21: success] accepts empty query (all optional)', () => {
    const result = ClaimQueryInputSchema.parse({});
    assert.deepEqual(result, {});
  });

  it('[A21: success] accepts partial filters', () => {
    const result = ClaimQueryInputSchema.parse({ status: 'active', limit: 50 });
    assert.equal(result.status, 'active');
    assert.equal(result.limit, 50);
  });

  it('[A21: rejection] rejects invalid status', () => {
    assert.throws(() => ClaimQueryInputSchema.parse({ status: 'deleted' }), z.ZodError);
  });

  it('[A21: rejection] rejects unknown keys (strict)', () => {
    assert.throws(() => ClaimQueryInputSchema.parse({ hackerField: true }), z.ZodError);
  });
});

// ── Working Memory Schemas ──

describe('WriteWorkingMemoryInputSchema', () => {
  it('[A21: success] accepts valid write input', () => {
    const result = WriteWorkingMemoryInputSchema.parse({ taskId: 't-001', key: 'notes', value: 'hello' });
    assert.equal(result.key, 'notes');
  });

  it('[A21: rejection] rejects empty key', () => {
    assert.throws(() => WriteWorkingMemoryInputSchema.parse({ taskId: 't-001', key: '', value: 'x' }), z.ZodError);
  });

  it('[A21: rejection] rejects key over 256 chars', () => {
    assert.throws(() => WriteWorkingMemoryInputSchema.parse({ taskId: 't-001', key: 'a'.repeat(257), value: 'x' }), z.ZodError);
  });

  it('[A21: rejection] rejects missing value', () => {
    assert.throws(() => WriteWorkingMemoryInputSchema.parse({ taskId: 't-001', key: 'notes' }), z.ZodError);
  });
});

describe('ReadWorkingMemoryInputSchema', () => {
  it('[A21: success] accepts specific key', () => {
    const result = ReadWorkingMemoryInputSchema.parse({ taskId: 't-001', key: 'notes' });
    assert.equal(result.key, 'notes');
  });

  it('[A21: success] accepts null key (list all)', () => {
    const result = ReadWorkingMemoryInputSchema.parse({ taskId: 't-001', key: null });
    assert.equal(result.key, null);
  });

  it('[A21: rejection] rejects missing taskId', () => {
    assert.throws(() => ReadWorkingMemoryInputSchema.parse({ key: 'notes' }), z.ZodError);
  });
});

describe('DiscardWorkingMemoryInputSchema', () => {
  it('[A21: success] accepts valid discard', () => {
    const result = DiscardWorkingMemoryInputSchema.parse({ taskId: 't-001', key: 'notes' });
    assert.equal(result.taskId, 't-001');
  });

  it('[A21: success] accepts null key (discard all)', () => {
    const result = DiscardWorkingMemoryInputSchema.parse({ taskId: 't-001', key: null });
    assert.equal(result.key, null);
  });

  it('[A21: rejection] rejects missing taskId', () => {
    assert.throws(() => DiscardWorkingMemoryInputSchema.parse({ key: 'notes' }), z.ZodError);
  });

  it('[A21: rejection] rejects unknown keys (strict)', () => {
    assert.throws(() => DiscardWorkingMemoryInputSchema.parse({ taskId: 't-001', key: 'x', evil: true }), z.ZodError);
  });
});

// ── Mission Schemas ──

describe('MissionCreateOptionsSchema', () => {
  const validMission = {
    agent: 'test-agent',
    objective: 'Test objective',
    constraints: { tokenBudget: 10000, deadline: '2026-12-31T23:59:59Z' },
  };

  it('[A21: success] accepts minimal valid mission', () => {
    const result = MissionCreateOptionsSchema.parse(validMission);
    assert.equal(result.agent, 'test-agent');
    assert.equal(result.constraints.tokenBudget, 10000);
  });

  it('[A21: success] accepts full mission with optional fields', () => {
    const result = MissionCreateOptionsSchema.parse({
      ...validMission,
      successCriteria: ['done'],
      deliverables: [{ type: 'report', name: 'final' }],
      parentMissionId: 'parent-001',
    });
    assert.equal(result.successCriteria?.length, 1);
    assert.equal(result.deliverables?.length, 1);
  });

  it('[A21: rejection] rejects missing constraints', () => {
    assert.throws(() => MissionCreateOptionsSchema.parse({ agent: 'x', objective: 'y' }), z.ZodError);
  });

  it('[A21: rejection] rejects missing tokenBudget in constraints', () => {
    assert.throws(() => MissionCreateOptionsSchema.parse({
      agent: 'x', objective: 'y', constraints: { deadline: '2026-12-31T00:00:00Z' },
    }), z.ZodError);
  });

  it('[A21: rejection] rejects unknown keys in constraints (strict)', () => {
    assert.throws(() => MissionCreateOptionsSchema.parse({
      ...validMission,
      constraints: { ...validMission.constraints, hackerBudget: 999999 },
    }), z.ZodError);
  });
});

describe('MissionFilterSchema', () => {
  it('[A21: success] accepts empty filter', () => {
    const result = MissionFilterSchema.parse({});
    assert.deepEqual(result, {});
  });

  it('[A21: success] accepts state filter', () => {
    const result = MissionFilterSchema.parse({ state: 'EXECUTING', limit: 10 });
    assert.equal(result.state, 'EXECUTING');
  });

  it('[A21: rejection] rejects invalid state', () => {
    assert.throws(() => MissionFilterSchema.parse({ state: 'RUNNING' }), z.ZodError);
  });
});

// ── Agent Management Schemas ──

describe('AgentRegisterSchema', () => {
  it('[A21: success] accepts valid agent registration', () => {
    const result = AgentRegisterSchema.parse({ name: 'test-agent', domains: ['finance'] });
    assert.equal(result.name, 'test-agent');
    assert.deepEqual(result.domains, ['finance']);
  });

  it('[A21: rejection] rejects empty name', () => {
    assert.throws(() => AgentRegisterSchema.parse({ name: '' }), z.ZodError);
  });

  it('[A21: rejection] rejects unknown keys (strict)', () => {
    assert.throws(() => AgentRegisterSchema.parse({ name: 'x', malicious: true }), z.ZodError);
  });
});

describe('AgentGetSchema', () => {
  it('[A21: success] accepts valid get', () => {
    const result = AgentGetSchema.parse({ name: 'test-agent' });
    assert.equal(result.name, 'test-agent');
  });

  it('[A21: rejection] rejects empty name', () => {
    assert.throws(() => AgentGetSchema.parse({ name: '' }), z.ZodError);
  });
});

describe('AgentPromoteSchema', () => {
  it('[A21: success] accepts valid promote', () => {
    const result = AgentPromoteSchema.parse({ name: 'test-agent' });
    assert.equal(result.name, 'test-agent');
  });

  it('[A21: rejection] rejects missing name', () => {
    assert.throws(() => AgentPromoteSchema.parse({}), z.ZodError);
  });
});
