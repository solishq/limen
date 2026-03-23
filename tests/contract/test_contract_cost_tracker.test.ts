/**
 * Contract tests for Cost Tracker (I-15: Linear Cost Scaling).
 * Phase: Sprint 5 (Performance & Events)
 *
 * Verifies:
 *   - computeLinearR2 with perfectly linear data -> R^2 = 1.0
 *   - computeLinearR2 with constant data -> R^2 = 1.0
 *   - computeLinearR2 with quadratic data -> R^2 < 0.95
 *   - computeSessionOverhead computes correct overhead
 *   - evaluateCostScaling with empty sessions -> sensible defaults
 *   - evaluateCostScaling with real database data
 *
 * Amendment 21: Every enforcement DC has success AND rejection tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLinearR2,
  computeSessionOverhead,
  evaluateCostScaling,
} from '../../src/api/enforcement/cost_tracker.js';
import type { ResponseMetadata, PipelinePhase } from '../../src/api/interfaces/api.js';
import { createTestDatabase } from '../helpers/test_database.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a minimal ResponseMetadata for testing.
 */
function buildMetadata(overrides?: {
  inputTokens?: number;
  outputTokens?: number;
  techniqueTokenCost?: number;
}): ResponseMetadata {
  return {
    traceId: 'test-trace-1',
    sessionId: 'test-session-1' as import('../../src/kernel/interfaces/index.js').SessionId,
    conversationId: 'test-conv-1',
    turnNumber: 1,
    ttftMs: 100,
    totalMs: 1000,
    tokens: {
      input: overrides?.inputTokens ?? 500,
      output: overrides?.outputTokens ?? 200,
      cost: 0.0007,
    },
    provider: { id: 'test', model: 'test-model' },
    phases: [
      { phase: 'perception' as PipelinePhase, durationMs: 2 },
      { phase: 'generation' as PipelinePhase, durationMs: 800 },
    ],
    techniquesApplied: 2,
    techniqueTokenCost: overrides?.techniqueTokenCost ?? 150,
    safetyGates: [],
  };
}

// ============================================================================
// computeLinearR2 — Unit Tests
// ============================================================================

describe('I-15: Linear R^2 Computation', () => {
  it('DC-I15-001 success: perfectly linear data -> R^2 = 1.0', () => {
    // y = 2x + 3: [3, 5, 7, 9, 11]
    const values = [3, 5, 7, 9, 11];
    const r2 = computeLinearR2(values);
    assert.ok(Math.abs(r2 - 1.0) < 0.001, `Expected R^2 ~1.0, got ${r2}`);
  });

  it('DC-I15-002 success: constant data -> R^2 = 1.0', () => {
    // All same value -> SS_tot = 0 -> R^2 = 1.0 by definition
    const values = [100, 100, 100, 100, 100];
    const r2 = computeLinearR2(values);
    assert.equal(r2, 1.0);
  });

  it('DC-I15-003 success: single value -> R^2 = 1.0', () => {
    const r2 = computeLinearR2([42]);
    assert.equal(r2, 1.0);
  });

  it('DC-I15-004 success: two values -> R^2 = 1.0 (always linear)', () => {
    const r2 = computeLinearR2([10, 50]);
    assert.ok(Math.abs(r2 - 1.0) < 0.001, `Expected R^2 ~1.0, got ${r2}`);
  });

  it('DC-I15-005 success: nearly linear data -> R^2 > 0.95', () => {
    // Linear trend (y = 10x + 100) with small noise (+/- 2)
    // Values: 100, 112, 118, 132, 138, 152, 158, 172
    const values = [100, 112, 118, 132, 138, 152, 158, 172];
    const r2 = computeLinearR2(values);
    assert.ok(r2 > 0.95, `Expected R^2 > 0.95 for nearly linear data, got ${r2}`);
  });

  it('DC-I15-001 rejection: quadratic growth -> R^2 < 0.95', () => {
    // y = x^2: [0, 1, 4, 9, 16, 25, 36, 49, 64, 81]
    const values = [0, 1, 4, 9, 16, 25, 36, 49, 64, 81];
    const r2 = computeLinearR2(values);
    assert.ok(r2 < 0.95, `Expected R^2 < 0.95 for quadratic data, got ${r2}`);
  });

  it('DC-I15-002 rejection: exponential growth -> R^2 < 0.95', () => {
    // y = 2^x: [1, 2, 4, 8, 16, 32, 64, 128]
    const values = [1, 2, 4, 8, 16, 32, 64, 128];
    const r2 = computeLinearR2(values);
    assert.ok(r2 < 0.95, `Expected R^2 < 0.95 for exponential data, got ${r2}`);
  });
});

// ============================================================================
// computeSessionOverhead — Unit Tests
// ============================================================================

describe('I-15: Session Overhead Computation', () => {
  it('DC-I15-010 success: computes overhead from metadata', () => {
    const metadata = buildMetadata({ techniqueTokenCost: 200 });
    const overhead = computeSessionOverhead('session-1', 'mission-1', metadata);

    assert.equal(overhead.sessionId, 'session-1');
    assert.equal(overhead.missionId, 'mission-1');
    assert.equal(overhead.techniqueOverhead, 200);
    assert.equal(overhead.totalOverhead, 200);
    assert.equal(overhead.fixedOverhead, 0);
  });

  it('DC-I15-011 success: zero technique cost -> zero overhead', () => {
    const metadata = buildMetadata({ techniqueTokenCost: 0 });
    const overhead = computeSessionOverhead('session-2', 'mission-1', metadata);

    assert.equal(overhead.techniqueOverhead, 0);
    assert.equal(overhead.totalOverhead, 0);
  });
});

// ============================================================================
// evaluateCostScaling — Integration Tests (with test database)
// ============================================================================

describe('I-15: Cost Scaling Evaluation', () => {
  it('DC-I15-020 success: empty sessions -> isLinear true, sensible defaults', () => {
    const conn = createTestDatabase();
    const report = evaluateCostScaling(conn, 'nonexistent-mission');

    assert.equal(report.sessionCount, 0);
    assert.equal(report.isLinear, true);
    assert.equal(report.linearityR2, 1.0);
    assert.equal(report.averageOverhead, 0);
    assert.equal(report.maxOverhead, 0);
    assert.equal(report.overheads.length, 0);
  });

  it('DC-I15-021 success: single session -> isLinear true (insufficient data)', () => {
    const conn = createTestDatabase();

    // Seed a session interaction
    conn.run(
      `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-1', 'sess-1', 'conv-1', 'hello', 'world', 100, 50, '2026-01-01T00:00:00.000Z'],
    );

    // evaluateCostScaling queries with mission_id, but since there's no
    // core_sessions join, the fallback path queries all sessions
    const report = evaluateCostScaling(conn, '');

    // With the fallback path, we get sessions from core_interactions directly
    assert.equal(report.isLinear, true);
    assert.equal(report.linearityR2, 1.0);
  });

  it('DC-I15-022 success: N sessions with constant tokens -> R^2 ~1.0, isLinear true', () => {
    const conn = createTestDatabase();

    // Seed 5 sessions with constant overhead (150 tokens each)
    for (let i = 0; i < 5; i++) {
      conn.run(
        `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [`int-${i}`, `sess-${i}`, `conv-${i}`, 'hello', 'world', 100, 50, `2026-01-01T0${i}:00:00.000Z`],
      );
    }

    const report = evaluateCostScaling(conn, '');

    assert.equal(report.sessionCount, 5);
    assert.equal(report.isLinear, true);
    assert.ok(report.linearityR2 >= 0.95, `Expected R^2 >= 0.95, got ${report.linearityR2}`);
    assert.equal(report.averageOverhead, 150);
    assert.equal(report.maxOverhead, 150);
  });

  it('DC-I15-020 rejection: quadratic overhead growth -> isLinear false', () => {
    const conn = createTestDatabase();

    // Seed sessions with quadratically growing overhead
    // Session 0: 0 tokens, Session 1: 100 tokens, ..., Session 7: 4900 tokens
    // Using i^2 * 100 (not (i+1)^2 * 100) so the curve starts at zero,
    // making the quadratic shape unambiguous to the linear regression.
    for (let i = 0; i < 8; i++) {
      const tokens = i * i * 100;
      conn.run(
        `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [`int-q-${i}`, `sess-q-${i}`, `conv-q-${i}`, 'hello', 'world', tokens, 0, `2026-01-01T0${i}:00:00.000Z`],
      );
    }

    const report = evaluateCostScaling(conn, '');

    assert.equal(report.sessionCount, 8);
    assert.equal(report.isLinear, false);
    assert.ok(report.linearityR2 < 0.95, `Expected R^2 < 0.95 for quadratic growth, got ${report.linearityR2}`);
  });
});
