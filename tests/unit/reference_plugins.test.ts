/**
 * Tests for Phase 2.6 reference plugins.
 * Verifies each hook type functions correctly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { confidenceVerifier } from '../../examples/plugins/confidence-verifier.js';
import { refusalExtractor } from '../../examples/plugins/refusal-extractor.js';
import { exponentialDecay } from '../../examples/plugins/exponential-decay.js';
import type { ClaimCreateInput } from '../../src/claims/interfaces/claim_types.js';
import type { AssertionHookContext, RecallBeliefView, RecallQueryContext } from '../../src/plugins/hook_types.js';

const CTX: AssertionHookContext = { agentId: 'test-agent', tenantId: null, missionId: null };
const QUERY: RecallQueryContext = { subject: undefined, predicate: undefined, minConfidence: undefined, limit: undefined };

function makeClaim(overrides: Partial<ClaimCreateInput> = {}): ClaimCreateInput {
  return {
    subject: 'entity:test:1',
    predicate: 'test.value',
    object: { type: 'string', value: 'hello' },
    confidence: 0.8,
    groundingMode: 'direct_assertion',
    ...overrides,
  } as ClaimCreateInput;
}

function makeBelief(overrides: Partial<RecallBeliefView> = {}): RecallBeliefView {
  return {
    claimId: 'claim-1',
    subject: 'entity:test:1',
    predicate: 'agent.response',
    value: 'I can help with that.',
    confidence: 0.9,
    effectiveConfidence: 0.85,
    validAt: '2026-01-01T00:00:00Z',
    freshness: 'fresh',
    ...overrides,
  };
}

describe('confidence-verifier plugin', () => {
  it('allows claims above threshold', () => {
    const hook = confidenceVerifier({ minConfidence: 0.5 });
    const claim = makeClaim({ confidence: 0.8 });
    const result = hook.claimAssertion!.beforeAssert!(claim, CTX);
    assert.deepStrictEqual(result, claim);
  });

  it('rejects claims below threshold', () => {
    const hook = confidenceVerifier({ minConfidence: 0.7 });
    const claim = makeClaim({ confidence: 0.3 });
    const result = hook.claimAssertion!.beforeAssert!(claim, CTX);
    assert.strictEqual(result, null);
  });

  it('exempts specified predicates', () => {
    const hook = confidenceVerifier({ minConfidence: 0.7, exemptPredicates: ['system.log'] });
    const claim = makeClaim({ confidence: 0.1, predicate: 'system.log' });
    const result = hook.claimAssertion!.beforeAssert!(claim, CTX);
    assert.deepStrictEqual(result, claim);
  });

  it('uses default threshold of 0.5', () => {
    const hook = confidenceVerifier();
    const passResult = hook.claimAssertion!.beforeAssert!(makeClaim({ confidence: 0.6 }), CTX);
    const failResult = hook.claimAssertion!.beforeAssert!(makeClaim({ confidence: 0.3 }), CTX);
    assert.notStrictEqual(passResult, null);
    assert.strictEqual(failResult, null);
  });

  it('has correct meta', () => {
    const hook = confidenceVerifier();
    assert.strictEqual(hook.meta.name, 'confidence-verifier');
    assert.strictEqual(hook.meta.version, '1.0.0');
    assert.strictEqual(hook.priority, 10);
  });
});

describe('refusal-extractor plugin', () => {
  it('detects safety refusal', () => {
    const hook = refusalExtractor();
    const belief = makeBelief({ value: 'That request is unsafe and harmful to others.' });
    const result = hook.recall!.onRecall!([belief], QUERY);
    assert.strictEqual((result[0] as Record<string, unknown>).refusal !== undefined, true);
    const refusal = (result[0] as Record<string, unknown>).refusal as { isRefusal: boolean; category: string };
    assert.strictEqual(refusal.isRefusal, true);
    assert.strictEqual(refusal.category, 'safety');
  });

  it('detects policy refusal', () => {
    const hook = refusalExtractor();
    const belief = makeBelief({ value: 'I cannot help with that request.' });
    const result = hook.recall!.onRecall!([belief], QUERY);
    const refusal = (result[0] as Record<string, unknown>).refusal as { isRefusal: boolean; category: string };
    assert.strictEqual(refusal.isRefusal, true);
    assert.strictEqual(refusal.category, 'policy');
  });

  it('marks non-refusal content', () => {
    const hook = refusalExtractor();
    const belief = makeBelief({ value: 'The capital of France is Paris.' });
    const result = hook.recall!.onRecall!([belief], QUERY);
    const refusal = (result[0] as Record<string, unknown>).refusal as { isRefusal: boolean; category: string | null };
    assert.strictEqual(refusal.isRefusal, false);
    assert.strictEqual(refusal.category, null);
  });

  it('respects predicate filter', () => {
    const hook = refusalExtractor({ predicateFilter: ['agent.response'] });
    const matched = makeBelief({ predicate: 'agent.response', value: 'I refuse to do that.' });
    const unmatched = makeBelief({ predicate: 'system.log', value: 'I refuse to do that.' });
    const result = hook.recall!.onRecall!([matched, unmatched], QUERY);
    assert.strictEqual((result[0] as Record<string, unknown>).refusal !== undefined, true);
    assert.strictEqual((result[1] as Record<string, unknown>).refusal, undefined);
  });

  it('has correct meta', () => {
    const hook = refusalExtractor();
    assert.strictEqual(hook.meta.name, 'refusal-extractor');
    assert.strictEqual(hook.meta.version, '1.0.0');
    assert.strictEqual(hook.priority, 50);
  });
});

describe('exponential-decay plugin', () => {
  const MS_PER_DAY = 86_400_000;

  it('returns full confidence at age 0', () => {
    const hook = exponentialDecay({ halfLifeDays: 30 });
    const result = hook.decay!.computeDecay!(0.9, 0, 10);
    assert.strictEqual(result, 0.9);
  });

  it('returns ~50% at half-life', () => {
    const hook = exponentialDecay({ halfLifeDays: 30 });
    const result = hook.decay!.computeDecay!(1.0, 30 * MS_PER_DAY, 10);
    assert.ok(Math.abs(result - 0.5) < 0.001, `Expected ~0.5 got ${result}`);
  });

  it('decays below half at double half-life', () => {
    const hook = exponentialDecay({ halfLifeDays: 30 });
    const result = hook.decay!.computeDecay!(1.0, 60 * MS_PER_DAY, 10);
    assert.ok(result < 0.5, `Expected < 0.5 got ${result}`);
    assert.ok(Math.abs(result - 0.25) < 0.001, `Expected ~0.25 got ${result}`);
  });

  it('respects floor', () => {
    const hook = exponentialDecay({ halfLifeDays: 1, floor: 0.05 });
    const result = hook.decay!.computeDecay!(1.0, 365 * MS_PER_DAY, 10);
    assert.ok(result >= 0.05, `Expected >= 0.05 got ${result}`);
  });

  it('handles negative age gracefully', () => {
    const hook = exponentialDecay({ halfLifeDays: 30 });
    const result = hook.decay!.computeDecay!(0.9, -100, 10);
    assert.strictEqual(result, 0.9);
  });

  it('handles zero confidence', () => {
    const hook = exponentialDecay({ halfLifeDays: 30 });
    const result = hook.decay!.computeDecay!(0, 30 * MS_PER_DAY, 10);
    assert.strictEqual(result, 0);
  });

  it('has correct meta', () => {
    const hook = exponentialDecay();
    assert.strictEqual(hook.meta.name, 'exponential-decay');
    assert.strictEqual(hook.meta.version, '1.0.0');
    assert.strictEqual(hook.priority, 100);
  });
});
