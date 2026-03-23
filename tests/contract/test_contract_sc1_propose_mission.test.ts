/**
 * SC-1 Contract Tests: propose_mission — Facade-Level Verification
 * S ref: S15 (propose_mission), S6 (mission lifecycle), I-03 (atomic audit),
 *        I-18 (persistence), I-20 (tree limits), I-22 (capability immutability),
 *        I-24 (goal anchoring), FM-19 (delegation cycle)
 *
 * Phase: 2C (System Call Contracts)
 * Tests through: createOrchestration() facade (NOT MissionStore.create directly)
 * Store-level tests exist in: tests/gap/test_gap_002_mission_validation.test.ts
 *
 * Amendment 21: Every rejection test verifies BOTH error code AND state unchanged.
 * Amendment 22: Wiring Manifest in D4 (separate deliverable).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestration } from '../../src/orchestration/index.js';
import { MISSION_TREE_DEFAULTS } from '../../src/orchestration/interfaces/orchestration.js';
import {
  createTestOrchestrationDeps,
  createTestOperationContext,
  seedMission,
  seedResource,
  missionId,
  agentId,
} from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext, MissionId, AgentId } from '../../src/kernel/interfaces/index.js';
import type { OrchestrationEngine } from '../../src/orchestration/index.js';
import type { ProposeMissionInput } from '../../src/orchestration/interfaces/orchestration.js';

// ─── Test Infrastructure ───

let conn: DatabaseConnection;
let ctx: OperationContext;
let engine: OrchestrationEngine;

function setup(): void {
  const { deps, conn: c, audit } = createTestOrchestrationDeps();
  conn = c;
  ctx = createTestOperationContext();
  engine = createOrchestration(conn, deps.substrate, audit);
}

/** S15: Construct a valid root mission input */
function validRootInput(overrides: Partial<ProposeMissionInput> = {}): ProposeMissionInput {
  return {
    parentMissionId: null,
    agentId: agentId('agent-1'),
    objective: 'Test mission objective',
    successCriteria: ['Complete the task'],
    scopeBoundaries: ['Within budget'],
    capabilities: ['web_search'],
    constraints: {
      budget: 5000,
      deadline: new Date(Date.now() + 3600000).toISOString(),
      ...(overrides.constraints ?? {}),
    },
    ...overrides,
    // Re-apply constraints merge to avoid overrides stomping the spread
    constraints: {
      budget: 5000,
      deadline: new Date(Date.now() + 3600000).toISOString(),
      ...(overrides.constraints ?? {}),
    },
  };
}

/** A21: Assert no mission row was inserted and no MISSION_CREATED event was emitted */
function assertStateUnchanged(conn: DatabaseConnection, label: string): void {
  const missionCount = conn.get<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM core_missions',
  );
  assert.equal(missionCount?.cnt ?? 0, 0,
    `${label}: No mission row should exist after rejection`);

  const eventCount = conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_events_log WHERE type = 'MISSION_CREATED'",
  );
  assert.equal(eventCount?.cnt ?? 0, 0,
    `${label}: No MISSION_CREATED event should exist after rejection`);
}

/** A21: Assert no NEW mission row was inserted beyond existing count */
function assertNoNewMission(conn: DatabaseConnection, countBefore: number, label: string): void {
  const countAfter = conn.get<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM core_missions',
  )?.cnt ?? 0;
  assert.equal(countAfter, countBefore,
    `${label}: Mission count should not increase after rejection (before=${countBefore}, after=${countAfter})`);
}

/** A21: Assert no NEW MISSION_CREATED event beyond existing count */
function assertNoNewEvent(conn: DatabaseConnection, countBefore: number, label: string): void {
  const countAfter = conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_events_log WHERE type = 'MISSION_CREATED'",
  )?.cnt ?? 0;
  assert.equal(countAfter, countBefore,
    `${label}: MISSION_CREATED event count should not increase after rejection (before=${countBefore}, after=${countAfter})`);
}

/** Count missions in database */
function countMissions(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM core_missions')?.cnt ?? 0;
}

/** Count MISSION_CREATED events */
function countMissionCreatedEvents(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_events_log WHERE type = 'MISSION_CREATED'",
  )?.cnt ?? 0;
}

describe('SC-1 Contract: propose_mission (Facade-Level)', () => {
  beforeEach(() => { setup(); });

  // ════════════════════════════════════════════════════════════════════════
  // SUCCESS PATH — Root Mission
  // ════════════════════════════════════════════════════════════════════════

  describe('Root Mission — Success Path', () => {

    it('SC1-ROOT-SUCCESS: creates root mission with state CREATED and returns missionId', () => {
      const result = engine.proposeMission(ctx, validRootInput());

      assert.equal(result.ok, true, 'S15: Root mission creation must succeed');
      if (!result.ok) return;

      assert.equal(result.value.state, 'CREATED', 'S15: Initial state must be CREATED');
      assert.equal(typeof result.value.missionId, 'string', 'S15: missionId must be a string');
      assert.ok(result.value.missionId.length > 0, 'S15: missionId must be non-empty');
    });

    it('SC1-ROOT-SIDEEFFECTS: verifies all side effects — mission row, goals, resources, tree count, event, audit', () => {
      const input = validRootInput({ objective: 'Side-effect verification mission' });
      const result = engine.proposeMission(ctx, input);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const mid = result.value.missionId;

      // I-18: Mission row persisted
      const missionRow = conn.get<{ id: string; state: string; objective: string; depth: number }>(
        'SELECT id, state, objective, depth FROM core_missions WHERE id = ?',
        [mid],
      );
      assert.ok(missionRow, 'I-18: core_missions row must exist');
      assert.equal(missionRow.state, 'CREATED', 'S6: State must be CREATED');
      assert.equal(missionRow.objective, 'Side-effect verification mission', 'I-18: Objective must match input');
      assert.equal(missionRow.depth, 0, 'I-20: Root mission depth must be 0');

      // I-24: Goal anchor persisted
      const goalRow = conn.get<{ mission_id: string; objective: string }>(
        'SELECT mission_id, objective FROM core_mission_goals WHERE mission_id = ?',
        [mid],
      );
      assert.ok(goalRow, 'I-24: core_mission_goals row must exist');
      assert.equal(goalRow.objective, 'Side-effect verification mission', 'I-24: Goal objective must match');

      // S11: Resource allocation
      const resourceRow = conn.get<{ token_allocated: number; token_remaining: number; token_consumed: number }>(
        'SELECT token_allocated, token_remaining, token_consumed FROM core_resources WHERE mission_id = ?',
        [mid],
      );
      assert.ok(resourceRow, 'S11: core_resources row must exist');
      assert.equal(resourceRow.token_allocated, 5000, 'S11: token_allocated must match budget');
      assert.equal(resourceRow.token_remaining, 5000, 'S11: token_remaining must equal allocated initially');
      assert.equal(resourceRow.token_consumed, 0, 'S11: token_consumed must be 0 initially');

      // I-20: Tree count entry
      const treeRow = conn.get<{ total_count: number }>(
        'SELECT total_count FROM core_tree_counts WHERE root_mission_id = ?',
        [mid],
      );
      assert.ok(treeRow, 'I-20: core_tree_counts row must exist for root');
      assert.equal(treeRow.total_count, 1, 'I-20: Tree count must be 1 for new root');

      // S15: MISSION_CREATED event
      const eventRow = conn.get<{ type: string; scope: string; propagation: string; payload_json: string }>(
        "SELECT type, scope, propagation, payload_json FROM core_events_log WHERE type = 'MISSION_CREATED' AND mission_id = ?",
        [mid],
      );
      assert.ok(eventRow, 'S15: MISSION_CREATED event must exist in core_events_log');
      assert.equal(eventRow.type, 'MISSION_CREATED', 'S15: Event type must be MISSION_CREATED');
      assert.equal(eventRow.scope, 'system', 'S15: Lifecycle event scope is system');
      assert.equal(eventRow.propagation, 'up', 'S15: Lifecycle event propagation is up');
      const payload = JSON.parse(eventRow.payload_json);
      assert.equal(payload.objective, 'Side-effect verification mission', 'S15: Event payload must contain objective');
      assert.equal(payload.parentMissionId, null, 'S15: Event payload must contain parentMissionId');

      // I-03: Audit entry
      const auditRow = conn.get<{ operation: string; resource_id: string }>(
        "SELECT operation, resource_id FROM core_audit_log WHERE operation = 'propose_mission' AND resource_id = ?",
        [mid],
      );
      assert.ok(auditRow, 'I-03: Audit entry must exist for propose_mission');
      assert.equal(auditRow.operation, 'propose_mission', 'I-03: Audit operation must be propose_mission');
    });

    it('SC1-ROOT-CONSTRAINTS: verifies constraint defaults applied', () => {
      const result = engine.proposeMission(ctx, validRootInput());
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const mid = result.value.missionId;
      const constraintsRow = conn.get<{ constraints_json: string }>(
        'SELECT constraints_json FROM core_missions WHERE id = ?',
        [mid],
      );
      assert.ok(constraintsRow, 'Constraints must be stored');
      const constraints = JSON.parse(constraintsRow.constraints_json);

      assert.equal(constraints.maxTasks, MISSION_TREE_DEFAULTS.maxTasks,
        'S15: maxTasks default must be applied');
      assert.equal(constraints.maxDepth, MISSION_TREE_DEFAULTS.maxDepth,
        'S15: maxDepth default must be applied');
      assert.equal(constraints.maxChildren, MISSION_TREE_DEFAULTS.maxChildren,
        'S15: maxChildren default must be applied');
      assert.equal(constraints.budgetDecayFactor, MISSION_TREE_DEFAULTS.budgetDecayFactor,
        'S15: budgetDecayFactor default must be applied');
      assert.equal(constraints.budget, 5000, 'S15: budget must match input');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUCCESS PATH — Child Mission
  // ════════════════════════════════════════════════════════════════════════

  describe('Child Mission — Success Path', () => {

    it('SC1-CHILD-SUCCESS: creates child mission with correct capabilities and state', () => {
      // Create parent through real path
      const parentResult = engine.proposeMission(ctx, validRootInput({
        agentId: agentId('parent-agent'),
        capabilities: ['web_search', 'code_execution'],
        constraints: { budget: 10000, deadline: new Date(Date.now() + 7200000).toISOString() },
      }));
      assert.equal(parentResult.ok, true, 'Parent creation must succeed');
      if (!parentResult.ok) return;

      const parentId = parentResult.value.missionId;

      // Create child with subset of parent capabilities
      const childResult = engine.proposeMission(ctx, validRootInput({
        parentMissionId: parentId,
        agentId: agentId('child-agent'),
        capabilities: ['web_search'],
        constraints: {
          budget: 2000,
          deadline: new Date(Date.now() + 3600000).toISOString(),
        },
      }));

      assert.equal(childResult.ok, true, 'S15: Child mission creation must succeed');
      if (!childResult.ok) return;

      assert.equal(childResult.value.state, 'CREATED', 'S15: Child state must be CREATED');
      assert.deepEqual(childResult.value.allocated.capabilities, ['web_search'],
        'I-22: Child capabilities must be the requested subset');
    });

    it('SC1-CHILD-DELEGATION-CHAIN: verifies delegation chain includes parent agentId', () => {
      const parentResult = engine.proposeMission(ctx, validRootInput({
        agentId: agentId('chain-parent'),
        constraints: { budget: 10000, deadline: new Date(Date.now() + 7200000).toISOString() },
      }));
      assert.equal(parentResult.ok, true);
      if (!parentResult.ok) return;

      const childResult = engine.proposeMission(ctx, validRootInput({
        parentMissionId: parentResult.value.missionId,
        agentId: agentId('chain-child'),
        constraints: {
          budget: 2000,
          deadline: new Date(Date.now() + 3600000).toISOString(),
        },
      }));
      assert.equal(childResult.ok, true);
      if (!childResult.ok) return;

      const childRow = conn.get<{ delegation_chain: string }>(
        'SELECT delegation_chain FROM core_missions WHERE id = ?',
        [childResult.value.missionId],
      );
      assert.ok(childRow, 'Child mission row must exist');
      const chain = JSON.parse(childRow.delegation_chain) as string[];
      assert.ok(chain.includes('chain-parent'),
        'FM-19: Delegation chain must include parent agentId');
    });

    it('SC1-CHILD-TREE-COUNT: verifies tree count incremented after child creation', () => {
      const parentResult = engine.proposeMission(ctx, validRootInput({
        agentId: agentId('tree-parent'),
        constraints: { budget: 10000, deadline: new Date(Date.now() + 7200000).toISOString() },
      }));
      assert.equal(parentResult.ok, true);
      if (!parentResult.ok) return;

      const parentId = parentResult.value.missionId;

      // Tree count after parent = 1
      const beforeCount = conn.get<{ total_count: number }>(
        'SELECT total_count FROM core_tree_counts WHERE root_mission_id = ?',
        [parentId],
      );
      assert.equal(beforeCount?.total_count, 1, 'Tree count must be 1 after root creation');

      // Create child
      const childResult = engine.proposeMission(ctx, validRootInput({
        parentMissionId: parentId,
        agentId: agentId('tree-child'),
        constraints: {
          budget: 2000,
          deadline: new Date(Date.now() + 3600000).toISOString(),
        },
      }));
      assert.equal(childResult.ok, true, 'Child creation must succeed');

      // Tree count after child = 2
      const afterCount = conn.get<{ total_count: number }>(
        'SELECT total_count FROM core_tree_counts WHERE root_mission_id = ?',
        [parentId],
      );
      assert.equal(afterCount?.total_count, 2,
        'I-20: Tree count must increment to 2 after child creation');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ERROR PATHS — A21 Dual-Path (rejection code + state unchanged)
  // ════════════════════════════════════════════════════════════════════════

  describe('Error Paths — A21 Rejection Verification', () => {

    it('SC1-ERR-BUDGET-EXCEEDED: rejects child budget exceeding parent remaining * decayFactor', () => {
      // Create parent with budget 10000, default decayFactor 0.3
      // Max child budget = 10000 * 0.3 = 3000
      const parentResult = engine.proposeMission(ctx, validRootInput({
        agentId: agentId('budget-parent'),
        constraints: { budget: 10000, deadline: new Date(Date.now() + 7200000).toISOString() },
      }));
      assert.equal(parentResult.ok, true, 'Parent creation must succeed');
      if (!parentResult.ok) return;

      const parentId = parentResult.value.missionId;
      const missionsBefore = countMissions(conn);
      const eventsBefore = countMissionCreatedEvents(conn);

      // Request budget 5000 > 10000 * 0.3 = 3000
      const result = engine.proposeMission(ctx, validRootInput({
        parentMissionId: parentId,
        agentId: agentId('budget-child'),
        constraints: {
          budget: 5000,
          deadline: new Date(Date.now() + 3600000).toISOString(),
        },
      }));

      assert.equal(result.ok, false, 'S15: Must reject when budget exceeds parent remaining * decayFactor');
      if (!result.ok) {
        assert.equal(result.error.code, 'BUDGET_EXCEEDED',
          'S15: Error code must be BUDGET_EXCEEDED');
      }

      // A21: State unchanged
      assertNoNewMission(conn, missionsBefore, 'BUDGET_EXCEEDED');
      assertNoNewEvent(conn, eventsBefore, 'BUDGET_EXCEEDED');
    });

    it('SC1-ERR-DEPTH-EXCEEDED: rejects child at maxDepth', () => {
      // Create a chain to maxDepth using the real engine
      // Default maxDepth = 5
      const farDeadline = new Date(Date.now() + 86400000).toISOString(); // 24 hours

      const root = engine.proposeMission(ctx, validRootInput({
        agentId: agentId('depth-root'),
        capabilities: ['web_search'],
        constraints: { budget: 100000, deadline: farDeadline },
      }));
      assert.equal(root.ok, true, 'Root creation must succeed');
      if (!root.ok) return;

      let currentParentId: MissionId = root.value.missionId;

      // Create chain depth 1 through 5
      for (let d = 1; d <= 5; d++) {
        // Get parent's remaining to calculate valid child budget
        const parentRes = conn.get<{ token_remaining: number }>(
          'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
          [currentParentId],
        );
        const maxBudget = (parentRes?.token_remaining ?? 100000) * MISSION_TREE_DEFAULTS.budgetDecayFactor;

        const child = engine.proposeMission(ctx, validRootInput({
          parentMissionId: currentParentId,
          agentId: agentId(`depth-agent-${d}`),
          capabilities: ['web_search'],
          constraints: {
            budget: Math.floor(maxBudget * 0.9), // Stay under limit
            deadline: farDeadline,
          },
        }));
        assert.equal(child.ok, true, `Depth ${d} child must succeed`);
        if (!child.ok) return;
        currentParentId = child.value.missionId;
      }

      const missionsBefore = countMissions(conn);
      const eventsBefore = countMissionCreatedEvents(conn);

      // Now try depth 6 — should fail
      const parentRes = conn.get<{ token_remaining: number }>(
        'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
        [currentParentId],
      );
      const maxBudget = (parentRes?.token_remaining ?? 1000) * MISSION_TREE_DEFAULTS.budgetDecayFactor;

      const result = engine.proposeMission(ctx, validRootInput({
        parentMissionId: currentParentId,
        agentId: agentId('depth-overflow'),
        capabilities: ['web_search'],
        constraints: {
          budget: Math.floor(maxBudget * 0.5),
          deadline: farDeadline,
        },
      }));

      assert.equal(result.ok, false, 'I-20: Must reject when depth exceeds maxDepth');
      if (!result.ok) {
        assert.equal(result.error.code, 'DEPTH_EXCEEDED',
          'I-20: Error code must be DEPTH_EXCEEDED');
      }

      assertNoNewMission(conn, missionsBefore, 'DEPTH_EXCEEDED');
      assertNoNewEvent(conn, eventsBefore, 'DEPTH_EXCEEDED');
    });

    it('SC1-ERR-CHILDREN-EXCEEDED: rejects when parent has maxChildren children', () => {
      const farDeadline = new Date(Date.now() + 86400000).toISOString();

      const root = engine.proposeMission(ctx, validRootInput({
        agentId: agentId('children-root'),
        capabilities: ['web_search'],
        constraints: { budget: 1000000, deadline: farDeadline },
      }));
      assert.equal(root.ok, true);
      if (!root.ok) return;

      const parentId = root.value.missionId;

      // Create maxChildren children via seed (faster than engine for 10 children)
      for (let i = 0; i < MISSION_TREE_DEFAULTS.maxChildren; i++) {
        seedMission(conn, {
          id: `child-overflow-${i}`,
          parentId: parentId as string,
          agentId: `child-agent-${i}`,
          capabilities: ['web_search'],
          depth: 1,
        });
      }

      const missionsBefore = countMissions(conn);
      const eventsBefore = countMissionCreatedEvents(conn);

      const result = engine.proposeMission(ctx, validRootInput({
        parentMissionId: parentId,
        agentId: agentId('child-overflow'),
        capabilities: ['web_search'],
        constraints: { budget: 100, deadline: farDeadline },
      }));

      assert.equal(result.ok, false, 'I-20: Must reject when children count >= maxChildren');
      if (!result.ok) {
        assert.equal(result.error.code, 'CHILDREN_EXCEEDED',
          'I-20: Error code must be CHILDREN_EXCEEDED');
      }

      assertNoNewMission(conn, missionsBefore, 'CHILDREN_EXCEEDED');
      assertNoNewEvent(conn, eventsBefore, 'CHILDREN_EXCEEDED');
    });

    it('SC1-ERR-TREE-SIZE-EXCEEDED: rejects when tree reaches maxTotalMissions', () => {
      const farDeadline = new Date(Date.now() + 86400000).toISOString();

      const root = engine.proposeMission(ctx, validRootInput({
        agentId: agentId('tree-size-root'),
        capabilities: ['web_search'],
        constraints: { budget: 1000000, deadline: farDeadline },
      }));
      assert.equal(root.ok, true);
      if (!root.ok) return;

      const parentId = root.value.missionId;

      // Set tree count to maxTotalMissions
      conn.run(
        'UPDATE core_tree_counts SET total_count = ? WHERE root_mission_id = ?',
        [MISSION_TREE_DEFAULTS.maxTotalMissions, parentId],
      );

      const missionsBefore = countMissions(conn);
      const eventsBefore = countMissionCreatedEvents(conn);

      const result = engine.proposeMission(ctx, validRootInput({
        parentMissionId: parentId,
        agentId: agentId('tree-overflow'),
        capabilities: ['web_search'],
        constraints: { budget: 100, deadline: farDeadline },
      }));

      assert.equal(result.ok, false, 'I-20: Must reject when tree size >= maxTotalMissions');
      if (!result.ok) {
        assert.equal(result.error.code, 'TREE_SIZE_EXCEEDED',
          'I-20: Error code must be TREE_SIZE_EXCEEDED');
      }

      assertNoNewMission(conn, missionsBefore, 'TREE_SIZE_EXCEEDED');
      assertNoNewEvent(conn, eventsBefore, 'TREE_SIZE_EXCEEDED');
    });

    it('SC1-ERR-CAPABILITY-VIOLATION: rejects child requesting capability not in parent', () => {
      const farDeadline = new Date(Date.now() + 86400000).toISOString();

      const root = engine.proposeMission(ctx, validRootInput({
        agentId: agentId('cap-root'),
        capabilities: ['web_search'],
        constraints: { budget: 10000, deadline: farDeadline },
      }));
      assert.equal(root.ok, true);
      if (!root.ok) return;

      const missionsBefore = countMissions(conn);
      const eventsBefore = countMissionCreatedEvents(conn);

      const result = engine.proposeMission(ctx, validRootInput({
        parentMissionId: root.value.missionId,
        agentId: agentId('cap-child'),
        capabilities: ['web_search', 'code_execution'], // code_execution not in parent
        constraints: { budget: 100, deadline: farDeadline },
      }));

      assert.equal(result.ok, false, 'I-22: Must reject capability superset');
      if (!result.ok) {
        assert.equal(result.error.code, 'CAPABILITY_VIOLATION',
          'I-22: Error code must be CAPABILITY_VIOLATION');
      }

      assertNoNewMission(conn, missionsBefore, 'CAPABILITY_VIOLATION');
      assertNoNewEvent(conn, eventsBefore, 'CAPABILITY_VIOLATION');
    });

    it('SC1-ERR-AGENT-NOT-FOUND: rejects empty agentId', () => {
      const result = engine.proposeMission(ctx, validRootInput({
        agentId: agentId(''),
      }));

      assert.equal(result.ok, false, 'S15: Must reject empty agentId');
      if (!result.ok) {
        assert.equal(result.error.code, 'AGENT_NOT_FOUND',
          'S15: Error code must be AGENT_NOT_FOUND');
      }

      assertStateUnchanged(conn, 'AGENT_NOT_FOUND');
    });

    it('SC1-ERR-DEADLINE-EXCEEDED: rejects child deadline after parent deadline', () => {
      const parentDeadline = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now

      const root = engine.proposeMission(ctx, validRootInput({
        agentId: agentId('deadline-root'),
        capabilities: ['web_search'],
        constraints: { budget: 10000, deadline: parentDeadline },
      }));
      assert.equal(root.ok, true, 'Parent creation must succeed');
      if (!root.ok) return;

      const missionsBefore = countMissions(conn);
      const eventsBefore = countMissionCreatedEvents(conn);

      // Child deadline 2 hours from now > parent 1 hour from now
      const childDeadline = new Date(Date.now() + 7200000).toISOString();
      const result = engine.proposeMission(ctx, validRootInput({
        parentMissionId: root.value.missionId,
        agentId: agentId('deadline-child'),
        capabilities: ['web_search'],
        constraints: { budget: 100, deadline: childDeadline },
      }));

      assert.equal(result.ok, false, 'S15: Must reject child deadline beyond parent');
      if (!result.ok) {
        assert.equal(result.error.code, 'DEADLINE_EXCEEDED',
          'S15: Error code must be DEADLINE_EXCEEDED');
      }

      assertNoNewMission(conn, missionsBefore, 'DEADLINE_EXCEEDED');
      assertNoNewEvent(conn, eventsBefore, 'DEADLINE_EXCEEDED');
    });

    it('SC1-ERR-DELEGATION-CYCLE: rejects agent already in delegation chain', () => {
      const farDeadline = new Date(Date.now() + 86400000).toISOString();

      // Root by agent-A
      const root = engine.proposeMission(ctx, validRootInput({
        agentId: agentId('cycle-A'),
        capabilities: ['web_search'],
        constraints: { budget: 100000, deadline: farDeadline },
      }));
      assert.equal(root.ok, true);
      if (!root.ok) return;

      // Child by agent-B (chain: [cycle-A])
      const parentRes = conn.get<{ token_remaining: number }>(
        'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
        [root.value.missionId],
      );
      const maxBudget = (parentRes?.token_remaining ?? 100000) * MISSION_TREE_DEFAULTS.budgetDecayFactor;

      const child = engine.proposeMission(ctx, validRootInput({
        parentMissionId: root.value.missionId,
        agentId: agentId('cycle-B'),
        capabilities: ['web_search'],
        constraints: {
          budget: Math.floor(maxBudget * 0.9),
          deadline: farDeadline,
        },
      }));
      assert.equal(child.ok, true, 'Child creation must succeed');
      if (!child.ok) return;

      const missionsBefore = countMissions(conn);
      const eventsBefore = countMissionCreatedEvents(conn);

      // Grandchild by agent-A again — cycle!
      const childRes = conn.get<{ token_remaining: number }>(
        'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
        [child.value.missionId],
      );
      const maxGrandchildBudget = (childRes?.token_remaining ?? 1000) * MISSION_TREE_DEFAULTS.budgetDecayFactor;

      const result = engine.proposeMission(ctx, validRootInput({
        parentMissionId: child.value.missionId,
        agentId: agentId('cycle-A'), // Same as root — cycle
        capabilities: ['web_search'],
        constraints: {
          budget: Math.floor(maxGrandchildBudget * 0.5),
          deadline: farDeadline,
        },
      }));

      assert.equal(result.ok, false, 'FM-19: Must detect delegation cycle');
      if (!result.ok) {
        assert.equal(result.error.code, 'DELEGATION_CYCLE',
          'FM-19: Error code must be DELEGATION_CYCLE');
      }

      assertNoNewMission(conn, missionsBefore, 'DELEGATION_CYCLE');
      assertNoNewEvent(conn, eventsBefore, 'DELEGATION_CYCLE');
    });

    // ── F-001: MISSION_NOT_FOUND (M8 survived — zero tests) ──

    it('SC1-ERR-MISSION-NOT-FOUND: rejects child when parent mission does not exist', () => {
      const missionsBefore = countMissions(conn);
      const eventsBefore = countMissionCreatedEvents(conn);

      const result = engine.proposeMission(ctx, validRootInput({
        parentMissionId: missionId('nonexistent-parent'),
        agentId: agentId('orphan-child'),
        constraints: {
          budget: 1000,
          deadline: new Date(Date.now() + 3600000).toISOString(),
        },
      }));

      assert.equal(result.ok, false, 'S15: Must reject when parent mission does not exist');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_FOUND',
          'S15: Error code must be MISSION_NOT_FOUND');
      }

      assertNoNewMission(conn, missionsBefore, 'MISSION_NOT_FOUND');
      assertNoNewEvent(conn, eventsBefore, 'MISSION_NOT_FOUND');
    });

    // ── Debt 2 fix: Budget check no longer silently skips when parent has no resource row ──

    it('SC1-ERR-BUDGET-NO-RESOURCE: rejects child when parent has no core_resources row (Debt 2 fix)', () => {
      // Create parent via engine (gets resource row)
      const parentResult = engine.proposeMission(ctx, validRootInput({
        agentId: agentId('no-res-parent'),
        capabilities: ['web_search'],
        constraints: { budget: 10000, deadline: new Date(Date.now() + 7200000).toISOString() },
      }));
      assert.equal(parentResult.ok, true);
      if (!parentResult.ok) return;

      const parentId = parentResult.value.missionId;

      // Capture counts AFTER parent creation (parent adds its own mission + event)
      const missionsAfterParent = countMissions(conn);
      const eventsAfterParent = countMissionCreatedEvents(conn);

      // Delete the parent's resource row to simulate missing resource
      conn.run('DELETE FROM core_resources WHERE mission_id = ?', [parentId]);

      // Child must be rejected — budget enforcement impossible without resource row
      const childResult = engine.proposeMission(ctx, validRootInput({
        parentMissionId: parentId,
        agentId: agentId('no-res-child'),
        capabilities: ['web_search'],
        constraints: {
          budget: 9999,
          deadline: new Date(Date.now() + 3600000).toISOString(),
        },
      }));

      // Debt 2: Missing resource row now correctly rejects instead of silently skipping
      assert.equal(childResult.ok, false,
        'S15/Debt2: Must reject child when parent has no resource row');
      if (!childResult.ok) {
        assert.equal(childResult.error.code, 'BUDGET_EXCEEDED',
          'S15/Debt2: Error code must be BUDGET_EXCEEDED');
      }

      assertNoNewMission(conn, missionsAfterParent, 'BUDGET-NO-RESOURCE');
      assertNoNewEvent(conn, eventsAfterParent, 'BUDGET-NO-RESOURCE');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // COMPOSITION TESTS — Facade Value-Add
  // ════════════════════════════════════════════════════════════════════════

  describe('Composition — Facade-Level Verification', () => {

    it('SC1-EVENT-MISSION-CREATED: successful creation emits MISSION_CREATED lifecycle event with correct shape', () => {
      const input = validRootInput({ objective: 'Event shape verification' });
      const result = engine.proposeMission(ctx, input);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const mid = result.value.missionId;

      const event = conn.get<{
        type: string; scope: string; propagation: string;
        mission_id: string; emitted_by: string; payload_json: string;
      }>(
        "SELECT type, scope, propagation, mission_id, emitted_by, payload_json FROM core_events_log WHERE type = 'MISSION_CREATED' AND mission_id = ?",
        [mid],
      );

      assert.ok(event, 'S15: MISSION_CREATED event must exist');
      assert.equal(event.type, 'MISSION_CREATED', 'Event type correct');
      assert.equal(event.scope, 'system', 'Lifecycle events have system scope');
      assert.equal(event.propagation, 'up', 'S15: propagation must be up');
      assert.equal(event.mission_id, mid, 'Event must reference the created mission');
      assert.equal(event.emitted_by, 'orchestrator', 'Lifecycle events emitted by orchestrator');

      const payload = JSON.parse(event.payload_json);
      assert.equal(payload.objective, 'Event shape verification',
        'S15: payload must contain objective');
      assert.equal(payload.parentMissionId, null,
        'S15: payload must contain parentMissionId');
    });

    it('SC1-AUDIT-ATOMIC: audit_log entry exists with operation=propose_mission', () => {
      const result = engine.proposeMission(ctx, validRootInput());
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const mid = result.value.missionId;

      const auditEntry = conn.get<{
        operation: string; resource_type: string; resource_id: string;
        actor_type: string; detail: string;
      }>(
        "SELECT operation, resource_type, resource_id, actor_type, detail FROM core_audit_log WHERE operation = 'propose_mission' AND resource_id = ?",
        [mid],
      );

      assert.ok(auditEntry, 'I-03: Audit entry must exist');
      assert.equal(auditEntry.operation, 'propose_mission', 'I-03: operation must be propose_mission');
      assert.equal(auditEntry.resource_type, 'mission', 'I-03: resource_type must be mission');
      assert.equal(auditEntry.resource_id, mid, 'I-03: resource_id must be the mission id');

      const detail = JSON.parse(auditEntry.detail);
      assert.ok('objective' in detail, 'I-03: detail must contain objective');
    });
  });
});
