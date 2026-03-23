/**
 * TEST-GAP-005: Budget Enforcement — S11, S22, FM-02
 * Verifies: Never-negative budget, BUDGET_EXCEEDED, parent-child transfer, human approval gate.
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * S11: "Resource.remaining never negative."
 * S22: "request_budget. Error codes: BUDGET_EXCEEDED, JUSTIFICATION_REQUIRED, HUMAN_APPROVAL_REQUIRED, PARENT_INSUFFICIENT."
 * FM-02: "Cost explosion defense — halt if budget exceeded."
 *
 * Phase: 4A-3 (harness-dependent tests)
 * NOTE: Spec reference corrected from I-14 (Predictable Latency) per FINDING-R1.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBudgetGovernor } from '../../src/orchestration/budget/budget_governance.js';
import {
  createTestOrchestrationDeps,
  seedMission,
  seedResource,
  missionId,
} from '../helpers/test_database.js';
import type { MissionId } from '../../src/kernel/interfaces/index.js';

describe('TEST-GAP-005: Budget Enforcement (S11, S22, FM-02)', () => {

  describe('S11/FM-02: BUDGET_EXCEEDED — consumption exceeds remaining', () => {

    it('consume() returns BUDGET_EXCEEDED when token cost exceeds remaining', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const budget = createBudgetGovernor();

      seedMission(conn, { id: 'budget-m1' });
      seedResource(conn, { missionId: 'budget-m1', tokenAllocated: 1000, tokenConsumed: 0 });

      // Try to consume 1500 when only 1000 remains
      const result = budget.consume(deps, missionId('budget-m1'), { tokens: 1500 });

      assert.equal(result.ok, false, 'FM-02: Must reject consumption exceeding remaining');
      if (!result.ok) {
        assert.equal(result.error.code, 'BUDGET_EXCEEDED',
          'S11: Error code must be BUDGET_EXCEEDED');
      }

      conn.close();
    });

    it('consume() succeeds when token cost equals remaining', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const budget = createBudgetGovernor();

      seedMission(conn, { id: 'budget-m2' });
      seedResource(conn, { missionId: 'budget-m2', tokenAllocated: 500, tokenConsumed: 0 });

      const result = budget.consume(deps, missionId('budget-m2'), { tokens: 500 });
      assert.equal(result.ok, true, 'S11: Consume exactly remaining must succeed');

      // Verify remaining is now 0
      const resource = conn.get<{ token_remaining: number }>(
        `SELECT token_remaining FROM core_resources WHERE mission_id = ?`,
        ['budget-m2']
      );
      assert.equal(resource?.token_remaining, 0, 'S11: Remaining must be 0 after consuming all');

      conn.close();
    });

    it('remaining never goes negative — CHECK constraint enforced', () => {
      const { deps: _deps, conn } = createTestOrchestrationDeps();

      seedMission(conn, { id: 'budget-m3' });
      seedResource(conn, { missionId: 'budget-m3', tokenAllocated: 100, tokenConsumed: 0 });

      // Directly try to set token_remaining to -1 via SQL — CHECK constraint should block
      assert.throws(
        () => conn.run(
          `UPDATE core_resources SET token_remaining = -1 WHERE mission_id = ?`,
          ['budget-m3']
        ),
        (err: Error) => err.message.includes('CHECK') || err.message.includes('constraint'),
        'SD-15: SQLite CHECK constraint must prevent token_remaining < 0'
      );

      conn.close();
    });
  });

  describe('S22: Budget request from parent', () => {

    it('HUMAN_APPROVAL_REQUIRED for root mission budget request', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const budget = createBudgetGovernor();

      // Root mission (no parent)
      seedMission(conn, { id: 'root-budget' });
      seedResource(conn, { missionId: 'root-budget', tokenAllocated: 1000, tokenConsumed: 500 });

      const result = budget.requestFromParent(
        deps,
        missionId('root-budget'),
        500,
        'Need more tokens for analysis'
      );

      assert.equal(result.ok, false, 'S22: Root mission budget request must require human approval');
      if (!result.ok) {
        assert.equal(result.error.code, 'HUMAN_APPROVAL_REQUIRED',
          'S22: Error code must be HUMAN_APPROVAL_REQUIRED');
      }

      conn.close();
    });

    it('JUSTIFICATION_REQUIRED when justification is empty', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const budget = createBudgetGovernor();

      seedMission(conn, { id: 'justify-parent' });
      seedResource(conn, { missionId: 'justify-parent', tokenAllocated: 5000 });
      seedMission(conn, { id: 'justify-child', parentId: 'justify-parent' });
      seedResource(conn, { missionId: 'justify-child', tokenAllocated: 500, tokenConsumed: 400 });

      const result = budget.requestFromParent(
        deps,
        missionId('justify-child'),
        200,
        '' // Empty justification
      );

      assert.equal(result.ok, false, 'S22: Must require non-empty justification');
      if (!result.ok) {
        assert.equal(result.error.code, 'JUSTIFICATION_REQUIRED',
          'S22: Error code must be JUSTIFICATION_REQUIRED');
      }

      conn.close();
    });

    it('PARENT_INSUFFICIENT when parent lacks sufficient remaining budget', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const budget = createBudgetGovernor();

      seedMission(conn, { id: 'poor-parent' });
      seedResource(conn, { missionId: 'poor-parent', tokenAllocated: 1000, tokenConsumed: 900 });
      seedMission(conn, { id: 'needy-child', parentId: 'poor-parent' });
      seedResource(conn, { missionId: 'needy-child', tokenAllocated: 100, tokenConsumed: 90 });

      // Parent only has 100 remaining, child requests 500
      const result = budget.requestFromParent(
        deps,
        missionId('needy-child'),
        500,
        'Need more tokens for extended analysis'
      );

      assert.equal(result.ok, false, 'S22: Must reject when parent has insufficient budget');
      if (!result.ok) {
        assert.equal(result.error.code, 'PARENT_INSUFFICIENT',
          'S22: Error code must be PARENT_INSUFFICIENT');
      }

      conn.close();
    });

    it('successful parent-to-child transfer is atomic', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const budget = createBudgetGovernor();

      seedMission(conn, { id: 'rich-parent' });
      seedResource(conn, { missionId: 'rich-parent', tokenAllocated: 10000, tokenConsumed: 0 });
      seedMission(conn, { id: 'funded-child', parentId: 'rich-parent' });
      seedResource(conn, { missionId: 'funded-child', tokenAllocated: 1000, tokenConsumed: 800 });

      const result = budget.requestFromParent(
        deps,
        missionId('funded-child'),
        2000,
        'Expanding analysis scope requires additional tokens'
      );

      assert.equal(result.ok, true, 'SD-15: Transfer must succeed');
      if (result.ok) {
        assert.equal(result.value.approved, true, 'Transfer must be approved');
      }

      // Verify parent budget decreased
      const parentResource = conn.get<{ token_remaining: number }>(
        `SELECT token_remaining FROM core_resources WHERE mission_id = ?`,
        ['rich-parent']
      );
      assert.equal(parentResource?.token_remaining, 8000,
        'SD-15: Parent remaining must decrease by transfer amount');

      // Verify child budget increased
      const childResource = conn.get<{ token_allocated: number; token_remaining: number }>(
        `SELECT token_allocated, token_remaining FROM core_resources WHERE mission_id = ?`,
        ['funded-child']
      );
      assert.equal(childResource?.token_allocated, 3000,
        'SD-15: Child allocated must increase by transfer amount');
      assert.equal(childResource?.token_remaining, 2200,
        'SD-15: Child remaining must increase by transfer amount (200 was remaining + 2000 transfer)');

      conn.close();
    });
  });

  describe('S11: Budget check utility', () => {

    it('checkBudget returns true when estimated cost fits within remaining', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const budget = createBudgetGovernor();

      seedMission(conn, { id: 'check-m1' });
      seedResource(conn, { missionId: 'check-m1', tokenAllocated: 5000, tokenConsumed: 1000 });

      const result = budget.checkBudget(deps, missionId('check-m1'), 2000);
      assert.equal(result.ok, true);
      assert.equal(result.value, true, 'S11: 2000 fits within 4000 remaining');

      conn.close();
    });

    it('checkBudget returns false when estimated cost exceeds remaining', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const budget = createBudgetGovernor();

      seedMission(conn, { id: 'check-m2' });
      seedResource(conn, { missionId: 'check-m2', tokenAllocated: 1000, tokenConsumed: 800 });

      const result = budget.checkBudget(deps, missionId('check-m2'), 500);
      assert.equal(result.ok, true);
      assert.equal(result.value, false, 'S11: 500 exceeds 200 remaining');

      conn.close();
    });
  });
});
