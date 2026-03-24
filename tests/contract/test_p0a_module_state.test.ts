/**
 * P0-A Module-Level State Tests
 *
 * Verifies that mutable state is properly scoped to instances (C-06 compliance).
 * Two independent createDBAImpl() calls must produce independent DBA instances
 * with no shared mutable state.
 *
 * Tests: B1 (DBA admission state independence)
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createDBAImpl } from '../../src/budget/impl/dba_impl.js';
import type {
  PreInvocationCheckInput,
} from '../../src/budget/interfaces/dba_types.js';
import type { MissionId } from '../../src/kernel/interfaces/index.js';

function makePreCheckInput(overrides?: Partial<PreInvocationCheckInput>): PreInvocationCheckInput {
  return {
    missionId: 'mission-test-001' as MissionId,
    tokenEnvelope: 100,
    deliberationEnvelope: 10,
    ...overrides,
  };
}

describe('P0-A: Module-Level State — B1: DBA Admission State Independence (C-06)', () => {
  it('B1 success: two independent DBA instances have separate admission state', () => {
    // Create two independent DBA instances
    const dba1 = createDBAImpl();
    const dba2 = createDBAImpl();

    const missionId = 'mission-independence-test' as MissionId;

    // Perform admission on DBA instance 1 — consume most of the token budget
    const check1 = dba1.admissibility.checkAdmissibility(
      makePreCheckInput({ missionId, tokenEnvelope: 900 }),
    );
    assert.equal(check1.admissible, true, 'DBA1 first check should be admitted');

    // DBA1 should have consumed 900 of 1000 token budget for this mission
    const check1b = dba1.admissibility.checkAdmissibility(
      makePreCheckInput({ missionId, tokenEnvelope: 200 }),
    );
    assert.equal(check1b.admissible, false, 'DBA1 should reject — only 100 headroom left');

    // DBA2 should be completely unaffected by DBA1's consumption
    const check2 = dba2.admissibility.checkAdmissibility(
      makePreCheckInput({ missionId, tokenEnvelope: 900 }),
    );
    assert.equal(check2.admissible, true, 'DBA2 should be admitted — independent state');
    assert.equal(check2.tokenHeadroom, 1000, 'DBA2 should have full headroom');
  });

  it('B1 rejection: verifying DBA instance isolation with deliberation dimension', () => {
    const dba1 = createDBAImpl();
    const dba2 = createDBAImpl();

    const missionId = 'mission-delib-independence' as MissionId;

    // Exhaust deliberation budget on DBA1
    const check1 = dba1.admissibility.checkAdmissibility(
      makePreCheckInput({ missionId, deliberationEnvelope: 50 }),
    );
    assert.equal(check1.admissible, true, 'DBA1 first deliberation check should pass');

    const check1b = dba1.admissibility.checkAdmissibility(
      makePreCheckInput({ missionId, deliberationEnvelope: 10 }),
    );
    assert.equal(check1b.admissible, false, 'DBA1 should reject — deliberation exhausted');

    // DBA2 should have full deliberation budget
    const check2 = dba2.admissibility.checkAdmissibility(
      makePreCheckInput({ missionId, deliberationEnvelope: 50 }),
    );
    assert.equal(check2.admissible, true, 'DBA2 should be admitted — independent deliberation state');
    assert.equal(check2.deliberationHeadroom, 50, 'DBA2 should have full deliberation headroom');
  });
});
