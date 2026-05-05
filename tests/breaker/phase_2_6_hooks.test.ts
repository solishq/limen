/**
 * Phase 2.6 Regression Tests — Validates fixes for Breaker findings F-001 through F-012.
 * Originally attack tests that proved defects; now regression tests that prove fixes hold.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createHookRegistry, type HookRegistry, type HookLogCallback, MAX_HOOKS } from '../../src/plugins/hook_registry.js';
import type {
  LimenHook,
  AssertionHookContext,
  RecallBeliefView,
  RecallQueryContext,
} from '../../src/plugins/hook_types.js';
import type { ClaimCreateInput } from '../../src/claims/interfaces/claim_types.js';

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
  return { agentId: 'agent-1', tenantId: 'tenant-1', missionId: 'mission-1' };
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
  return { subject: 'entity:test:*', predicate: undefined, minConfidence: undefined, limit: undefined };
}

// ── Regression Tests ──

describe('Phase 2.6 Regression: Breaker Findings Fixed', () => {
  let registry: HookRegistry;
  let logHelper: ReturnType<typeof createTestLog>;

  beforeEach(() => {
    logHelper = createTestLog();
    registry = createHookRegistry({ log: logHelper.log });
  });

  describe('F-001 FIX: beforeAssert return validated for required fields', () => {
    it('partial object (missing subject) is rejected by validation', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'partial-return', version: '1.0.0' },
          claimAssertion: {
            beforeAssert: () => ({ confidence: 0.5 } as unknown as ClaimCreateInput),
          },
        }),
      ]);

      const result = registry.executeBeforeAssert(makeInput(), makeAssertionCtx());
      assert.equal(result.ok, true);
      // Fix: partial object is SKIPPED, original input preserved
      if (result.ok && result.value) {
        assert.equal(result.value.subject, 'entity:test:1'); // Original preserved
      }
    });

    it('confidence > 1.0 is rejected by validation', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'over-confidence', version: '1.0.0' },
          claimAssertion: {
            beforeAssert: (claim) => ({ ...claim, confidence: 999.9 }),
          },
        }),
      ]);

      const result = registry.executeBeforeAssert(makeInput(), makeAssertionCtx());
      assert.equal(result.ok, true);
      if (result.ok && result.value) {
        // Fix: invalid confidence skipped, original preserved
        assert.equal(result.value.confidence, 0.8);
      }
    });

    it('confidence NaN is rejected by validation', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'nan-confidence', version: '1.0.0' },
          claimAssertion: {
            beforeAssert: (claim) => ({ ...claim, confidence: NaN }),
          },
        }),
      ]);

      const result = registry.executeBeforeAssert(makeInput(), makeAssertionCtx());
      assert.equal(result.ok, true);
      if (result.ok && result.value) {
        assert.equal(result.value.confidence, 0.8); // Original preserved
      }
    });

    it('valid modification (subject change with valid format) passes', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'valid-modify', version: '1.0.0' },
          claimAssertion: {
            beforeAssert: (claim) => ({ ...claim, subject: 'entity:modified:99' }),
          },
        }),
      ]);

      const result = registry.executeBeforeAssert(makeInput(), makeAssertionCtx());
      assert.equal(result.ok, true);
      if (result.ok && result.value) {
        assert.equal(result.value.subject, 'entity:modified:99');
      }
    });
  });

  describe('F-002 FIX: Getter traps handled safely', () => {
    it('getter trap in hook interface does not crash registration', () => {
      const maliciousHook: LimenHook = {
        meta: { name: 'getter-trap', version: '1.0.0' },
        get claimAssertion() {
          throw new Error('getter trap activated');
        },
      };

      // Fix: getter trap caught during registration — hook still registers
      // but hasAssertion resolved safely to false
      const result = registry.registerAll([maliciousHook]);
      assert.equal(result.ok, true);
      assert.equal(registry.hookCount, 1);

      // Execution doesn't crash — hook's capabilities were pre-resolved safely
      const execResult = registry.executeBeforeAssert(makeInput(), makeAssertionCtx());
      assert.equal(execResult.ok, true);
    });

    it('non-Error throw (string) is isolated', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'string-thrower', version: '1.0.0' },
          claimAssertion: {
            beforeAssert: () => { throw 'just a string'; },
          },
        }),
      ]);

      const result = registry.executeBeforeAssert(makeInput(), makeAssertionCtx());
      assert.equal(result.ok, true);
      assert.ok(logHelper.entries.some(e => e.level === 'warn' && e.message.includes('just a string')));
    });
  });

  describe('F-003 FIX: Decay return values clamped', () => {
    it('NaN return → null (fallback to default)', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'nan-decay', version: '1.0.0' },
          decay: { computeDecay: () => NaN },
        }),
      ]);

      const result = registry.computeDecay(0.8, 86400000, 7);
      assert.equal(result, null); // Clamped — falls back to default
    });

    it('Infinity return → null', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'inf-decay', version: '1.0.0' },
          decay: { computeDecay: () => Infinity },
        }),
      ]);

      assert.equal(registry.computeDecay(0.8, 86400000, 7), null);
    });

    it('negative return → null', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'neg-decay', version: '1.0.0' },
          decay: { computeDecay: () => -0.5 },
        }),
      ]);

      assert.equal(registry.computeDecay(0.8, 86400000, 7), null);
    });

    it('amplification (return > confidence) → null', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'amplify', version: '1.0.0' },
          decay: { computeDecay: () => 99.0 },
        }),
      ]);

      assert.equal(registry.computeDecay(0.8, 86400000, 7), null);
    });

    it('valid return within [0, confidence] passes', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'valid-decay', version: '1.0.0' },
          decay: { computeDecay: (conf) => conf * 0.5 },
        }),
      ]);

      assert.equal(registry.computeDecay(0.8, 86400000, 7), 0.4);
    });
  });

  describe('F-004 FIX: Recall hook receives defensive copy', () => {
    it('mutate-and-throw does not corrupt previous result', () => {
      const originalBeliefs = makeBeliefs(3);

      registry.registerAll([
        makeHook({
          meta: { name: 'mutate-and-throw', version: '1.0.0' },
          recall: {
            onRecall: (beliefs) => {
              beliefs.splice(0, 2); // Mutates the COPY, not original
              throw new Error('after mutation');
            },
          },
        }),
      ]);

      const result = registry.transformRecall(originalBeliefs, makeQuery());
      // Fix: hook received a defensive copy — original unchanged
      assert.equal(originalBeliefs.length, 3); // NOT mutated
      assert.notEqual(result, null);
    });

    it('chained hooks receive copies — first cannot corrupt second input', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'mutator', version: '1.0.0' },
          priority: 1,
          recall: {
            onRecall: (beliefs) => {
              beliefs[0] = { ...beliefs[0]!, value: 'MUTATED' };
              return beliefs;
            },
          },
        }),
        makeHook({
          meta: { name: 'observer', version: '1.0.0' },
          priority: 2,
          recall: { onRecall: (beliefs) => beliefs },
        }),
      ]);

      const beliefs = makeBeliefs(1);
      const result = registry.transformRecall(beliefs, makeQuery());
      assert.notEqual(result, null);
      assert.equal(result![0]!.value, 'MUTATED'); // Result is modified
      // Original caller array NOT mutated (defensive copy on first call)
      assert.equal(beliefs[0]!.value, 'value-0');
    });
  });

  describe('F-005 FIX: Cumulative registration limit enforced', () => {
    it('multiple registerAll calls respect cumulative total', () => {
      const batch1 = Array.from({ length: 49 }, (_, i) =>
        makeHook({ meta: { name: `batch1-${i}`, version: '1.0.0' } }),
      );
      const batch2 = Array.from({ length: 49 }, (_, i) =>
        makeHook({ meta: { name: `batch2-${i}`, version: '1.0.0' } }),
      );

      const r1 = registry.registerAll(batch1);
      assert.equal(r1.ok, true);
      assert.equal(registry.hookCount, 49);

      // Fix: Second batch exceeds cumulative limit (49 + 49 = 98 > 50)
      const r2 = registry.registerAll(batch2);
      assert.equal(r2.ok, false);
      if (!r2.ok) {
        assert.equal(r2.error.code, 'HOOK_MAX_EXCEEDED');
      }
      assert.equal(registry.hookCount, 49); // Unchanged
    });
  });

  describe('F-007 FIX: NaN priority defaults to 100', () => {
    it('NaN priority gets default value, deterministic ordering', () => {
      const order: string[] = [];

      registry.registerAll([
        makeHook({
          meta: { name: 'nan-priority', version: '1.0.0' },
          priority: NaN,
          claimAssertion: {
            beforeAssert: (claim) => { order.push('NaN→100'); return claim; },
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
      // Fix: NaN normalized to DEFAULT_HOOK_PRIORITY (100), so 50 runs first
      assert.deepEqual(order, ['50', 'NaN→100']);
      assert.ok(logHelper.entries.some(e => e.message.includes('non-finite priority')));
    });
  });

  describe('F-008 FIX: Name validation rejects control chars and long names', () => {
    it('null bytes in name rejected', () => {
      registry.registerAll([
        makeHook({ meta: { name: 'hook\x00evil', version: '1.0.0' } }),
      ]);
      assert.equal(registry.hookCount, 0);
    });

    it('extremely long name rejected', () => {
      registry.registerAll([
        makeHook({ meta: { name: 'a'.repeat(300), version: '1.0.0' } }),
      ]);
      assert.equal(registry.hookCount, 0);
    });

    it('__proto__ name accepted (no control chars, valid length)', () => {
      registry.registerAll([
        makeHook({ meta: { name: '__proto__', version: '1.0.0' } }),
      ]);
      assert.equal(registry.hookCount, 1); // Allowed — not a security risk in array storage
    });
  });

  describe('F-009 FIX: confidence-verifier rejects NaN', () => {
    it('NaN confidence is rejected by verifier', async () => {
      const { confidenceVerifier } = await import('../../examples/plugins/confidence-verifier.js');
      const hook = confidenceVerifier({ minConfidence: 0.5 });

      const result = hook.claimAssertion!.beforeAssert!(
        makeInput({ confidence: NaN }),
        makeAssertionCtx(),
      );
      // Fix: !(NaN >= 0.5) is true → rejected
      assert.equal(result, null);
    });
  });

  describe('F-010 FIX: exponential-decay clamps halfLifeDays', () => {
    it('negative halfLifeDays clamped to positive — no amplification', async () => {
      const { exponentialDecay } = await import('../../examples/plugins/exponential-decay.js');
      const hook = exponentialDecay({ halfLifeDays: -1 });

      const result = hook.decay!.computeDecay!(0.9, 86400000, 10);
      // Fix: halfLifeDays clamped to 0.001 minimum — rapid decay, not growth
      assert.ok(result <= 0.9, `Expected <= 0.9, got ${result}`);
    });

    it('zero halfLifeDays clamped — no division by zero', async () => {
      const { exponentialDecay } = await import('../../examples/plugins/exponential-decay.js');
      const hook = exponentialDecay({ halfLifeDays: 0 });

      const result = hook.decay!.computeDecay!(0.9, 86400000, 10);
      assert.ok(Number.isFinite(result));
      assert.ok(result <= 0.9);
    });
  });

  describe('F-011 FIX: decay semantics — highest priority number wins', () => {
    it('priority 999 wins over priority 1 regardless of registration order', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'low-prio', version: '1.0.0' },
          priority: 1,
          decay: { computeDecay: () => 0.1 },
        }),
        makeHook({
          meta: { name: 'high-prio', version: '1.0.0' },
          priority: 999,
          decay: { computeDecay: (conf) => conf * 0.5 },
        }),
      ]);

      const result = registry.computeDecay(0.8, 86400000, 7);
      assert.equal(result, 0.4); // 0.8 * 0.5 = 0.4 (highest priority number wins)
    });
  });

  describe('Sorted cache correctness', () => {
    it('cache invalidated on second registerAll', () => {
      registry.registerAll([
        makeHook({
          meta: { name: 'first-decay', version: '1.0.0' },
          priority: 1,
          decay: { computeDecay: () => 0.1 },
        }),
      ]);

      assert.equal(registry.computeDecay(0.8, 1000, 7), 0.1);

      registry.registerAll([
        makeHook({
          meta: { name: 'second-decay', version: '1.0.0' },
          priority: 999,
          decay: { computeDecay: () => 0.5 },
        }),
      ]);

      // Cache invalidated — second hook wins now
      assert.equal(registry.computeDecay(0.8, 1000, 7), 0.5);
    });
  });
});
