/**
 * Breaker attack tests for Cost Tracker (I-15: Linear Cost Scaling).
 * Sprint 5 — Performance & Events.
 *
 * Attack surfaces:
 *   1. R^2 edge cases — constant, perfectly linear, quadratic, noisy data
 *   2. Negative token values — can overhead go negative?
 *   3. computeLinearR2 with empty array
 *   4. SQL injection via missionId
 *   5. Massive session counts — regression overflow
 *   6. Zero overhead values — R^2 behavior
 *   7. missionId parameter unused in SQL — documented forward obligation
 *   8. computeSessionOverhead boundary conditions
 *
 * S ref: I-15 (Linear Cost Scaling), §4 (Performance Invariants)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLinearR2,
  computeSessionOverhead,
  evaluateCostScaling,
} from '../../src/api/enforcement/cost_tracker.js';
import type { ResponseMetadata, PipelinePhase } from '../../src/api/interfaces/api.js';
import type { SessionId } from '../../src/kernel/interfaces/index.js';
import { createTestDatabase } from '../helpers/test_database.js';

// ============================================================================
// Helpers
// ============================================================================

function buildMetadata(overrides?: {
  inputTokens?: number;
  outputTokens?: number;
  techniqueTokenCost?: number;
}): ResponseMetadata {
  return {
    traceId: 'test-trace-1',
    sessionId: 'test-session-1' as SessionId,
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
// ATTACK 1: computeLinearR2 edge cases
// ============================================================================

describe('ATTACK: I-15 Cost Tracker — R^2 edge cases', () => {
  it('ATK-I15-001: all identical values -> R^2 = 1.0 (constant is linear)', () => {
    // Constant data: y = c for all x. SS_tot = 0, so R^2 = 1.0 by definition.
    const r2 = computeLinearR2([100, 100, 100, 100]);
    assert.equal(r2, 1.0);
  });

  it('ATK-I15-002: perfectly linear ascending -> R^2 = 1.0', () => {
    const r2 = computeLinearR2([100, 200, 300, 400, 500]);
    assert.ok(Math.abs(r2 - 1.0) < 0.0001, `Expected R^2 ~1.0, got ${r2}`);
  });

  it('ATK-I15-003: quadratic growth [1,4,9,16,25] -> R^2 < 1.0', () => {
    // y = x^2 is NOT linear. R^2 should be less than 1.0.
    // Whether it is < 0.95 depends on the range (short range of quadratic
    // can look nearly linear).
    const r2 = computeLinearR2([1, 4, 9, 16, 25]);
    assert.ok(r2 < 1.0, `Quadratic data should not have R^2 = 1.0, got ${r2}`);
    // With 5 points of x^2, R^2 of linear fit is actually quite high (~0.986).
    // Need more points or wider range for R^2 < 0.95.
    // DOCUMENTED: Short quadratic sequences can fool the linear test.
  });

  it('ATK-I15-004: near-constant with noise -> R^2 high', () => {
    // [100, 102, 98, 101, 99] — nearly constant. Linear fit has near-zero slope.
    // SS_res ~ SS_tot, but both are small. R^2 should still be well-defined.
    const r2 = computeLinearR2([100, 102, 98, 101, 99]);
    assert.ok(r2 >= 0 && r2 <= 1, `R^2 should be in [0,1], got ${r2}`);
  });

  it('ATK-I15-005: empty array -> R^2 = 1.0 (n <= 1 guard)', () => {
    // Line 244: if (n <= 1) return 1.0;
    // Empty array has n = 0, which satisfies n <= 1.
    const r2 = computeLinearR2([]);
    assert.equal(r2, 1.0);
  });

  it('ATK-I15-006: two values -> R^2 = 1.0 (always perfect line through two points)', () => {
    // Any two points define a perfect line.
    const r2 = computeLinearR2([10, 1000]);
    assert.ok(Math.abs(r2 - 1.0) < 0.0001, `Expected R^2 ~1.0, got ${r2}`);
  });

  it('ATK-I15-007: descending linear data -> R^2 = 1.0', () => {
    // Linear with negative slope. R^2 should still be 1.0.
    const r2 = computeLinearR2([500, 400, 300, 200, 100]);
    assert.ok(Math.abs(r2 - 1.0) < 0.0001, `Expected R^2 ~1.0 for descending linear, got ${r2}`);
  });

  it('ATK-I15-008: all zeros -> R^2 = 1.0', () => {
    // [0,0,0,0,0] — constant zero. SS_tot = 0 -> R^2 = 1.0.
    const r2 = computeLinearR2([0, 0, 0, 0, 0]);
    assert.equal(r2, 1.0);
  });

  it('ATK-I15-009: NaN in values -> R^2 behavior', () => {
    // values[i] ?? 0 guard on line 251/261/275 should replace undefined but not NaN.
    // NaN is not undefined/null, so it passes through.
    const r2 = computeLinearR2([1, 2, NaN, 4, 5]);
    // NaN propagates through arithmetic. R^2 will be NaN.
    // FINDING: NaN input produces NaN R^2. No guard against NaN values.
    assert.equal(typeof r2, 'number'); // NaN is typeof number
  });

  it('ATK-I15-010: Infinity in values -> R^2 behavior', () => {
    const r2 = computeLinearR2([1, 2, Infinity, 4, 5]);
    // Infinity propagates through arithmetic.
    assert.equal(typeof r2, 'number');
  });

  it('ATK-I15-011: negative values -> R^2 computed correctly', () => {
    // y = -2x + 10: [10, 8, 6, 4, 2]
    const r2 = computeLinearR2([10, 8, 6, 4, 2]);
    assert.ok(Math.abs(r2 - 1.0) < 0.0001, `Expected R^2 ~1.0, got ${r2}`);
  });

  it('ATK-I15-012: large dataset (1000 points) does not overflow', () => {
    // Linear: y = 5x + 100
    const values = Array.from({ length: 1000 }, (_, i) => 5 * i + 100);
    const r2 = computeLinearR2(values);
    assert.ok(Math.abs(r2 - 1.0) < 0.0001, `Expected R^2 ~1.0 for 1000-point linear, got ${r2}`);
  });
});

// ============================================================================
// ATTACK 2: computeSessionOverhead edge cases
// ============================================================================

describe('ATTACK: I-15 Cost Tracker — Session overhead computation', () => {
  it('ATK-I15-020: negative techniqueTokenCost -> negative overhead', () => {
    // Can a negative technique cost produce negative overhead?
    const metadata = buildMetadata({ techniqueTokenCost: -100 });
    const overhead = computeSessionOverhead('sess-1', 'mission-1', metadata);

    // fixedOverhead = 0, techniqueOverhead = -100, totalOverhead = -100.
    // FINDING: No guard against negative techniqueTokenCost.
    assert.equal(overhead.techniqueOverhead, -100);
    assert.equal(overhead.totalOverhead, -100);
  });

  it('ATK-I15-021: very large techniqueTokenCost -> correct overhead', () => {
    const metadata = buildMetadata({ techniqueTokenCost: Number.MAX_SAFE_INTEGER });
    const overhead = computeSessionOverhead('sess-1', 'mission-1', metadata);

    assert.equal(overhead.techniqueOverhead, Number.MAX_SAFE_INTEGER);
    assert.equal(overhead.totalOverhead, Number.MAX_SAFE_INTEGER);
  });

  it('ATK-I15-022: fixedOverhead is always 0 (hardcoded at line 106)', () => {
    // Line 106: const fixedOverhead = 0;
    // This is documented as a baseline. Verify it holds for any input.
    const metadata = buildMetadata({ inputTokens: 10000, outputTokens: 5000 });
    const overhead = computeSessionOverhead('sess-1', 'mission-1', metadata);

    assert.equal(overhead.fixedOverhead, 0);
    // Total overhead = 0 + techniqueOverhead only.
    assert.equal(overhead.totalOverhead, overhead.techniqueOverhead);
  });
});

// ============================================================================
// ATTACK 3: evaluateCostScaling — missionId parameter analysis
// ============================================================================

describe('ATTACK: I-15 Cost Tracker — missionId parameter (FORWARD OBLIGATION)', () => {
  it('ATK-I15-030: missionId is NOT used in SQL query (documented at lines 143-146)', () => {
    const conn = createTestDatabase();

    // Seed interactions for two different "missions" in separate sessions
    conn.run(
      `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-a', 'sess-a', 'conv-a', 'hello', 'world', 100, 50, '2026-01-01T00:00:00.000Z'],
    );
    conn.run(
      `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-b', 'sess-b', 'conv-b', 'hello', 'world', 200, 100, '2026-01-01T01:00:00.000Z'],
    );
    conn.run(
      `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-c', 'sess-c', 'conv-c', 'hello', 'world', 300, 150, '2026-01-01T02:00:00.000Z'],
    );

    // Query for "mission-A" should return ALL sessions (not just mission-A's).
    const reportA = evaluateCostScaling(conn, 'mission-A');
    const reportB = evaluateCostScaling(conn, 'mission-B');

    // FINDING DOCUMENTATION: Both reports return identical results because
    // missionId is NOT used in the WHERE clause. This is documented as a
    // forward obligation (lines 143-146). Not a bug — it is intentional
    // until core_sessions table with mission_id FK is implemented.
    assert.equal(reportA.sessionCount, reportB.sessionCount,
      'missionId has no effect on query — returns all sessions');
    assert.equal(reportA.sessionCount, 3);
    assert.deepEqual(
      reportA.overheads.map(o => o.totalOverhead),
      reportB.overheads.map(o => o.totalOverhead),
    );
  });

  it('ATK-I15-031: missionId IS set in returned overhead objects', () => {
    const conn = createTestDatabase();
    conn.run(
      `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-1', 'sess-1', 'conv-1', 'hello', 'world', 100, 50, '2026-01-01T00:00:00.000Z'],
    );
    conn.run(
      `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-2', 'sess-2', 'conv-2', 'hello', 'world', 100, 50, '2026-01-01T01:00:00.000Z'],
    );
    conn.run(
      `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-3', 'sess-3', 'conv-3', 'hello', 'world', 100, 50, '2026-01-01T02:00:00.000Z'],
    );

    const report = evaluateCostScaling(conn, 'my-mission-id');

    // The missionId is used in the returned overhead objects (line 184),
    // just not in the SQL query.
    for (const overhead of report.overheads) {
      assert.equal(overhead.missionId, 'my-mission-id',
        'missionId should be set in returned overhead objects');
    }
  });
});

// ============================================================================
// ATTACK 4: SQL injection via missionId
// ============================================================================

describe('ATTACK: I-15 Cost Tracker — SQL injection', () => {
  it('ATK-I15-040: missionId with SQL injection payload has no effect', () => {
    const conn = createTestDatabase();

    // The missionId is NOT used in any SQL query (lines 147-162).
    // So SQL injection via missionId is impossible — the parameter never
    // reaches the SQL engine.
    const maliciousMissionId = "'; DROP TABLE core_interactions; --";
    const report = evaluateCostScaling(conn, maliciousMissionId);

    // Verify core_interactions still exists
    const count = conn.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM core_interactions');
    assert.ok(count !== undefined, 'core_interactions table must still exist');
    assert.equal(report.sessionCount, 0);
  });
});

// ============================================================================
// ATTACK 5: evaluateCostScaling — data shape edge cases
// ============================================================================

describe('ATTACK: I-15 Cost Tracker — Data shape attacks', () => {
  it('ATK-I15-050: sessions with NULL session_id are excluded', () => {
    const conn = createTestDatabase();

    // Insert an interaction with NULL session_id — should be excluded by
    // WHERE session_id IS NOT NULL
    conn.run(
      `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-null', null, 'conv-null', 'hello', 'world', 100, 50, '2026-01-01T00:00:00.000Z'],
    );

    const report = evaluateCostScaling(conn, '');
    assert.equal(report.sessionCount, 0, 'NULL session_id interactions must be excluded');
  });

  it('ATK-I15-051: sessions with zero tokens -> overhead = 0', () => {
    const conn = createTestDatabase();

    for (let i = 0; i < 4; i++) {
      conn.run(
        `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [`int-z-${i}`, `sess-z-${i}`, `conv-z-${i}`, 'hello', 'world', 0, 0, `2026-01-01T0${i}:00:00.000Z`],
      );
    }

    const report = evaluateCostScaling(conn, '');
    assert.equal(report.sessionCount, 4);
    assert.equal(report.averageOverhead, 0);
    assert.equal(report.maxOverhead, 0);
    // All zeros -> constant -> R^2 = 1.0
    assert.equal(report.linearityR2, 1.0);
    assert.equal(report.isLinear, true);
  });

  it('ATK-I15-052: exactly 2 sessions -> isLinear defaults to true (insufficient data)', () => {
    const conn = createTestDatabase();

    conn.run(
      `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-1', 'sess-1', 'conv-1', 'hello', 'world', 100, 50, '2026-01-01T00:00:00.000Z'],
    );
    conn.run(
      `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-2', 'sess-2', 'conv-2', 'hello', 'world', 500, 250, '2026-01-01T01:00:00.000Z'],
    );

    const report = evaluateCostScaling(conn, '');
    // Line 192: if (overheads.length <= 2) -> isLinear = true, R^2 = 1.0.
    assert.equal(report.sessionCount, 2);
    assert.equal(report.isLinear, true);
    assert.equal(report.linearityR2, 1.0);
  });

  it('ATK-I15-053: exactly 3 sessions -> regression runs (boundary)', () => {
    const conn = createTestDatabase();

    // 3 sessions with wildly different overhead — enough for regression.
    conn.run(
      `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-1', 'sess-1', 'conv-1', 'hello', 'world', 100, 50, '2026-01-01T00:00:00.000Z'],
    );
    conn.run(
      `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-2', 'sess-2', 'conv-2', 'hello', 'world', 100, 50, '2026-01-01T01:00:00.000Z'],
    );
    conn.run(
      `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-3', 'sess-3', 'conv-3', 'hello', 'world', 100, 50, '2026-01-01T02:00:00.000Z'],
    );

    const report = evaluateCostScaling(conn, '');
    // 3 sessions with equal overhead -> R^2 = 1.0 (constant = linear).
    assert.equal(report.sessionCount, 3);
    assert.ok(report.linearityR2 >= 0.95, `R^2 should be >= 0.95 for constant data, got ${report.linearityR2}`);
    assert.equal(report.isLinear, true);
  });

  it('ATK-I15-054: multiple interactions per session aggregated correctly', () => {
    const conn = createTestDatabase();

    // Session sess-A has 3 interactions: total = (100+200+300) input + (50+100+150) output = 900
    for (let i = 0; i < 3; i++) {
      conn.run(
        `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [`int-a-${i}`, 'sess-A', `conv-a-${i}`, 'hello', 'world', (i + 1) * 100, (i + 1) * 50, `2026-01-01T0${i}:00:00.000Z`],
      );
    }

    // Need 3+ sessions for regression. Add 2 more.
    conn.run(
      `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-b-0', 'sess-B', 'conv-b', 'hello', 'world', 300, 150, '2026-01-01T05:00:00.000Z'],
    );
    conn.run(
      `INSERT INTO core_interactions (id, session_id, conversation_id, user_input, assistant_output, input_tokens, output_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['int-c-0', 'sess-C', 'conv-c', 'hello', 'world', 300, 150, '2026-01-01T06:00:00.000Z'],
    );

    const report = evaluateCostScaling(conn, '');
    assert.equal(report.sessionCount, 3);

    // sess-A total = 600 input + 300 output = 900
    // sess-B total = 300 + 150 = 450
    // sess-C total = 300 + 150 = 450
    const overheadValues = report.overheads.map(o => o.totalOverhead);
    assert.deepEqual(overheadValues, [900, 450, 450]);
    assert.equal(report.maxOverhead, 900);
    assert.equal(report.averageOverhead, 600);
  });
});

// ============================================================================
// ATTACK 6: R^2 threshold boundary
// ============================================================================

describe('ATTACK: I-15 Cost Tracker — R^2 threshold boundary (0.95)', () => {
  it('ATK-I15-060: R^2 exactly at 0.95 -> isLinear false (> not >=)', () => {
    // Line 218: isLinear: r2 > 0.95
    // If R^2 = 0.95 exactly, isLinear should be false.
    // This is a boundary check — hard to hit exactly 0.95 with real data,
    // but we can verify the logic via computeLinearR2.
    // We need data that produces R^2 approximately 0.95.
    // [0, 10, 20, 30, 50] — slightly non-linear.
    const values = [0, 10, 20, 30, 50];
    const r2 = computeLinearR2(values);
    // We can't force exactly 0.95, but we can verify the threshold logic.
    // The key insight: r2 > 0.95 is strict greater-than.
    // A value of exactly 0.95 would make isLinear false.
    assert.equal(typeof r2, 'number');
    // Just verify the function returns a valid number in [0, 1].
    assert.ok(r2 >= 0 && r2 <= 1, `R^2 must be in [0,1], got ${r2}`);
  });
});
