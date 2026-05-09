// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Phase 2.6 Slice 2: Hook Registry Tests.
 *
 * Covers:
 *   - Hook registration + discovery
 *   - beforeAssert rejection (claim blocked)
 *   - beforeAssert modification (claim modified)
 *   - afterAssert notification
 *   - Custom decay formula replaces default
 *   - Recall result transformation
 *   - Error isolation (bad hook doesn't crash)
 *   - Priority ordering
 *   - Backward compatibility (existing plugins unaffected)
 *   - Max hooks limit
 *   - Duplicate name rejection
 *   - Invalid meta handling
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createHookRegistry, type HookRegistry, type HookLogCallback } from '../../src/plugins/hook_registry.js';
import type { LimenHook, AssertionHookContext, RecallBeliefView, RecallQueryContext } from '../../src/plugins/hook_types.js';
import type { ClaimCreateInput } from '../../src/claims/interfaces/claim_types.js';
import { MAX_PLUGINS } from '../../src/plugins/plugin_types.js';

// ── Test Helpers ──

function createTestLog(): { log: HookLogCallback; entries: Array<{ level: string; category: string; message: string }> } {
  const entries: Array<{ level: string; category: string; message: string }> = [];
  const log: HookLogCallback = (level, category, message) => {
    entries.push({ level, category, message });
  };
  return { log, entries };
}

function makeHook(overrides: Partial<LimenHook> & { meta: LimenHook['meta'] }): LimenHook {
  return overrides as LimenHook;
}

function makeInput(overrides?: Partial<ClaimCreateInput>): ClaimCreateInput {
  return {
    subject: 'entity:test:1',
    predicate: 'test.value',
    object: { type: 'string' as const, value: 'hello' },
    confidence: 0.8,
    validAt: '2026-01-01T00:00:00Z',
    groundingMode: 'evidence_path' as const,
    evidenceRefs: [],
    ...overrides,
  } as ClaimCreateInput;
}

function makeAssertionCtx(): AssertionHookContext {
  return {
    agentId: 'agent-1',
    tenantId: 'tenant-1',
    missionId: 'mission-1',
  };
}

function makeBeliefs(count: number): RecallBeliefView[] {
  return Array.from({ length: count }, (_, i) => ({
    claimId: `claim-${i}`,
    subject: `entity:test:${i}`,
    predicate: 'test.value',
    value: `value-${i}`,
    confidence: 0.8,
    effectiveConfidence: 0.7,
    validAt: '2026-01-01T00:00:00Z',
    freshness: 'fresh',
  }));
}

function makeQuery(): RecallQueryContext {
  return {
    subject: 'entity:test:*',
    predicate: undefined,
    minConfidence: undefined,
    limit: undefined,
  };
}

// ── Tests ──

describe('HookRegistry', () => {
  let registry: HookRegistry;
  let logHelper: ReturnType<typeof createTestLog>;

  beforeEach(() => {
    logHelper = createTestLog();
    registry = createHookRegistry({ log: logHelper.log });
  });

  describe('registration', () => {
    it('registers hooks successfully', () => {
      const hook = makeHook({
        meta: { name: 'test-hook', version: '1.0.0' },
        decay: { computeDecay: () => 0.5 },
      });

      const result = registry.registerAll([hook]);
      assert.equal(result.ok, true);
      assert.equal(registry.hookCount, 1);
      assert.deepEqual(registry.hookNames, ['test-hook']);
      assert.equal(registry.hasHooks, true);
    });

    it('returns ok for empty hooks array', () => {
      const result = registry.registerAll([]);
      assert.equal(result.ok, true);
      assert.equal(registry.hookCount, 0);
    });

    it('rejects when max hooks exceeded', () => {
      const hooks = Array.from({ length: MAX_PLUGINS + 1 }, (_, i) =>
        makeHook({ meta: { name: `hook-${i}`, version: '1.0.0' } }),
      );

      const result = registry.registerAll(hooks);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, 'HOOK_MAX_EXCEEDED');
      }
    });

    it('skips hooks with missing name', () => {
      const hook = makeHook({
        meta: { name: '', version: '1.0.0' },
      });

      const result = registry.registerAll([hook]);
      assert.equal(result.ok, true);
      assert.equal(registry.hookCount, 0);
      assert.ok(logHelper.entries.some(e => e.level === 'error' && e.message.includes('missing or empty name')));
    });

    it('skips hooks with missing version', () => {
      const hook = makeHook({
        meta: { name: 'test', version: '' },
      });

      const result = registry.registerAll([hook]);
      assert.equal(result.ok, true);
      assert.equal(registry.hookCount, 0);
      assert.ok(logHelper.entries.some(e => e.level === 'error' && e.message.includes('missing or empty version')));
    });

    it('skips duplicate hook names', () => {
      const hook1 = makeHook({ meta: { name: 'dup', version: '1.0.0' } });
      const hook2 = makeHook({ meta: { name: 'dup', version: '2.0.0' } });

      const result = registry.registerAll([hook1, hook2]);
      assert.equal(result.ok, true);
      assert.equal(registry.hookCount, 1);
      assert.ok(logHelper.entries.some(e => e.level === 'error' && e.message.includes('already registered')));
    });

    it('reports correct has* flags', () => {
      assert.equal(registry.hasDecayHook, false);
      assert.equal(registry.hasRecallHook, false);
      assert.equal(registry.hasAssertionHook, false);

      registry.registerAll([
        makeHook({
          meta: { name: 'decay-hook', version: '1.0.0' },
          decay: { computeDecay: () => 0.5 },
        }),
      ]);

      assert.equal(registry.hasDecayHook, true);
      assert.equal(registry.hasRecallHook, false);
      assert.equal(registry.hasAssertionHook, false);
    });
  });

  describe('beforeAssert', () => {
    it('success: passes through unmodified input when hook returns it', () => {
      const input = makeInput();
      const ctx = makeAssertionCtx();

      registry.registerAll([
        makeHook({
          meta: { name: 'pass-through', version: '1.0.0' },
          claimAssertion: {
            beforeAssert: (claim) => claim,
          },
        }),
      ]);

      const result = registry.executeBeforeAssert(input, ctx);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.notEqual(result.value, null);
        assert.equal(result.value!.subject, 'entity:test:1');
      }
    });

    it('rejection: returns null when hook rejects', () => {
      const input = makeInput();
      const ctx = makeAssertionCtx();

      registry.registerAll([
        makeHook({
          meta: { name: 'rejector', version: '1.0.0' },
          claimAssertion: {
            beforeAssert: () => null,
          },
        }),
      ]);

      const result = registry.executeBeforeAssert(input, ctx);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value, null);
      }
    });

    it('modification: hook modifies the claim input', () => {
      const input = makeInput({ confidence: 0.5 });
      const ctx = makeAssertionCtx();

      registry.registerAll([
        makeHook({
          meta: { name: 'modifier', version: '1.0.0' },
          claimAssertion: {
            beforeAssert: (claim) => ({
              ...claim,
              confidence: 0.9,
            }),
          },
        }),
      ]);

      const result = registry.executeBeforeAssert(input, ctx);
      assert.equal(result.ok, true);
      if (result.ok && result.value) {
        assert.equal(result.value.confidence, 0.9);
      }
    });

    it('error isolation: throwing hook is skipped, pipeline continues', () => {
      const input = makeInput();
      const ctx = makeAssertionCtx();

      registry.registerAll([
        makeHook({
          meta: { name: 'thrower', version: '1.0.0' },
          priority: 1,
          claimAssertion: {
            beforeAssert: () => { throw new Error('boom'); },
          },
        }),
        makeHook({
          meta: { name: 'good-hook', version: '1.0.0' },
          priority: 2,
          claimAssertion: {
            beforeAssert: (claim) => ({ ...claim, confidence: 0.99 }),
          },
        }),
      ]);

      const result = registry.executeBeforeAssert(input, ctx);
      assert.equal(result.ok, true);
      if (result.ok && result.value) {
        assert.equal(result.value.confidence, 0.99);
      }
      assert.ok(logHelper.entries.some(e => e.level === 'warn' && e.message.includes('boom')));
    });

    it('returns input unchanged when no assertion hooks registered', () => {
      const input = makeInput();
      const ctx = makeAssertionCtx();

      // No hooks registered
      const result = registry.executeBeforeAssert(input, ctx);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.deepEqual(result.value, input);
      }
    });
  });

  describe('afterAssert', () => {
    it('calls afterAssert hooks with claim info', () => {
      const notifications: Array<{ id: string }> = [];

      registry.registerAll([
        makeHook({
          meta: { name: 'notifier', version: '1.0.0' },
          claimAssertion: {
            afterAssert: (claim) => { notifications.push({ id: claim.id }); },
          },
        }),
      ]);

      registry.executeAfterAssert(
        {
          id: 'claim-123',
          subject: 'entity:test:1',
          predicate: 'test.value',
          objectValue: 'hello',
          confidence: 0.8,
          groundingMode: 'evidence_path',
          validAt: '2026-01-01T00:00:00Z',
          createdAt: '2026-01-01T00:00:01Z',
        },
        makeAssertionCtx(),
      );

      assert.equal(notifications.length, 1);
      assert.equal(notifications[0]!.id, 'claim-123');
    });

    it('error isolation: throwing afterAssert hook does not crash', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'thrower', version: '1.0.0' },
          claimAssertion: {
            afterAssert: () => { throw new Error('after boom'); },
          },
        }),
      ]);

      // Should not throw
      registry.executeAfterAssert(
        {
          id: 'claim-123',
          subject: 'entity:test:1',
          predicate: 'test.value',
          objectValue: 'hello',
          confidence: 0.8,
          groundingMode: 'evidence_path',
          validAt: '2026-01-01T00:00:00Z',
          createdAt: '2026-01-01T00:00:01Z',
        },
        makeAssertionCtx(),
      );

      assert.ok(logHelper.entries.some(e => e.level === 'warn' && e.message.includes('after boom')));
    });
  });

  describe('decay hooks', () => {
    it('success: custom decay formula replaces default', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'custom-decay', version: '1.0.0' },
          decay: {
            computeDecay: (confidence, _ageMs, _stabilityDays) => confidence * 0.5,
          },
        }),
      ]);

      const result = registry.computeDecay(0.8, 86400000, 7);
      assert.equal(result, 0.4); // 0.8 * 0.5
    });

    it('returns null when no decay hooks registered', () => {
      const result = registry.computeDecay(0.8, 86400000, 7);
      assert.equal(result, null);
    });

    it('error isolation: throwing decay hook returns null', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'bad-decay', version: '1.0.0' },
          decay: {
            computeDecay: () => { throw new Error('decay boom'); },
          },
        }),
      ]);

      const result = registry.computeDecay(0.8, 86400000, 7);
      assert.equal(result, null);
      assert.ok(logHelper.entries.some(e => e.level === 'warn' && e.message.includes('decay boom')));
    });

    it('last hook wins when multiple decay hooks registered', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'decay-1', version: '1.0.0' },
          priority: 1,
          decay: { computeDecay: () => 0.1 },
        }),
        makeHook({
          meta: { name: 'decay-2', version: '1.0.0' },
          priority: 2,
          decay: { computeDecay: () => 0.7 },
        }),
      ]);

      const result = registry.computeDecay(0.8, 86400000, 7);
      assert.equal(result, 0.7); // Last by priority wins (must be <= confidence)
    });
  });

  describe('recall hooks', () => {
    it('success: recall hook transforms results', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'filter-hook', version: '1.0.0' },
          recall: {
            onRecall: (beliefs, _query) =>
              beliefs.filter(b => b.effectiveConfidence > 0.5),
          },
        }),
      ]);

      const beliefs = [
        ...makeBeliefs(2),
        { ...makeBeliefs(1)[0]!, effectiveConfidence: 0.3 },
      ];

      const result = registry.transformRecall(beliefs, makeQuery());
      assert.notEqual(result, null);
      assert.equal(result!.length, 2);
    });

    it('returns null when no recall hooks registered', () => {
      const result = registry.transformRecall(makeBeliefs(3), makeQuery());
      assert.equal(result, null);
    });

    it('recall hooks chain: output of one = input of next', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'chain-1', version: '1.0.0' },
          priority: 1,
          recall: {
            onRecall: (beliefs) => beliefs.map(b => ({ ...b, value: b.value + '-A' })),
          },
        }),
        makeHook({
          meta: { name: 'chain-2', version: '1.0.0' },
          priority: 2,
          recall: {
            onRecall: (beliefs) => beliefs.map(b => ({ ...b, value: b.value + '-B' })),
          },
        }),
      ]);

      const result = registry.transformRecall(makeBeliefs(1), makeQuery());
      assert.notEqual(result, null);
      assert.equal(result![0]!.value, 'value-0-A-B');
    });

    it('error isolation: throwing recall hook preserves previous result', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'good-recall', version: '1.0.0' },
          priority: 1,
          recall: {
            onRecall: (beliefs) => beliefs.map(b => ({ ...b, value: 'modified' })),
          },
        }),
        makeHook({
          meta: { name: 'bad-recall', version: '1.0.0' },
          priority: 2,
          recall: {
            onRecall: () => { throw new Error('recall boom'); },
          },
        }),
      ]);

      const result = registry.transformRecall(makeBeliefs(1), makeQuery());
      assert.notEqual(result, null);
      assert.equal(result![0]!.value, 'modified'); // First hook's result preserved
      assert.ok(logHelper.entries.some(e => e.level === 'warn' && e.message.includes('recall boom')));
    });
  });

  describe('priority ordering', () => {
    it('hooks execute in priority order (lower first)', () => {
      const order: string[] = [];

      registry.registerAll([
        makeHook({
          meta: { name: 'high-priority', version: '1.0.0' },
          priority: 200,
          claimAssertion: {
            beforeAssert: (claim) => { order.push('200'); return claim; },
          },
        }),
        makeHook({
          meta: { name: 'low-priority', version: '1.0.0' },
          priority: 10,
          claimAssertion: {
            beforeAssert: (claim) => { order.push('10'); return claim; },
          },
        }),
        makeHook({
          meta: { name: 'mid-priority', version: '1.0.0' },
          priority: 50,
          claimAssertion: {
            beforeAssert: (claim) => { order.push('50'); return claim; },
          },
        }),
      ]);

      registry.executeBeforeAssert(makeInput(), makeAssertionCtx());
      assert.deepEqual(order, ['10', '50', '200']);
    });

    it('default priority is 100', () => {
      const order: string[] = [];

      registry.registerAll([
        makeHook({
          meta: { name: 'default-priority', version: '1.0.0' },
          // no priority specified — defaults to 100
          claimAssertion: {
            beforeAssert: (claim) => { order.push('default'); return claim; },
          },
        }),
        makeHook({
          meta: { name: 'low-priority', version: '1.0.0' },
          priority: 50,
          claimAssertion: {
            beforeAssert: (claim) => { order.push('50'); return claim; },
          },
        }),
      ]);

      registry.executeBeforeAssert(makeInput(), makeAssertionCtx());
      assert.deepEqual(order, ['50', 'default']);
    });
  });

  describe('backward compatibility', () => {
    it('empty hook registry has no effect on any pipeline', () => {
      // No hooks registered — all operations should be no-ops or return null
      assert.equal(registry.hasHooks, false);
      assert.equal(registry.hookCount, 0);

      // beforeAssert passes through
      const assertResult = registry.executeBeforeAssert(makeInput(), makeAssertionCtx());
      assert.equal(assertResult.ok, true);

      // afterAssert does nothing (no throw)
      registry.executeAfterAssert(
        { id: 'x', subject: 's', predicate: 'p', objectValue: 'v', confidence: 0.5, groundingMode: 'evidence_path', validAt: '', createdAt: '' },
        makeAssertionCtx(),
      );

      // computeDecay returns null (caller uses default)
      assert.equal(registry.computeDecay(0.8, 1000, 7), null);

      // transformRecall returns null (caller uses default)
      assert.equal(registry.transformRecall(makeBeliefs(1), makeQuery()), null);
    });
  });
});
