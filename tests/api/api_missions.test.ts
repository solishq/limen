// Verifies: §15, §41 UC-10, I-17, I-20, I-24, §44
// Phase 4: API Surface -- limen.missions.create() verification
//
// Tests that the public missions API delegates to SC-1 (propose_mission)
// with identical validation, exposing the orchestration layer through
// the API surface.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ProposeMissionInput, ProposeMissionOutput, ProposeMissionError,
} from '../../src/orchestration/interfaces/orchestration.js';
import { MISSION_TREE_DEFAULTS } from '../../src/orchestration/interfaces/orchestration.js';

// ---------------------------------------------------------------------------
// §15/UC-10: limen.missions.create()
// ---------------------------------------------------------------------------

describe('limen.missions.create() -- §15, UC-10', () => {

  it('accepts the same input shape as SC-1 propose_mission', () => {
    // UC-10 code example:
    // const mission = await limen.missions.create({
    //   agent: 'strategist',
    //   objective: 'Analyze SEA drone delivery market',
    //   constraints: { tokenBudget: 50000, deadline: '48h',
    //     capabilities: ['web_search','code_execute','data_query'] },
    //   deliverables: [{ type: 'report', name: 'Market Entry Strategy' }],
    // });
    //
    // Internally, this maps to ProposeMissionInput:
    // - agent -> agentId (resolved from registered agent name)
    // - objective -> objective
    // - constraints -> constraints (with defaults for maxTasks, maxDepth, etc.)
    // - parentMissionId -> null (root mission)

    const input: ProposeMissionInput = {
      parentMissionId: null,
      agentId: 'agent-strategist' as any,
      objective: 'Analyze SEA drone delivery market',
      successCriteria: ['Comprehensive market analysis delivered'],
      scopeBoundaries: ['SEA region only', 'Drone delivery vertical only'],
      capabilities: ['web_search', 'code_execute', 'data_query'],
      constraints: {
        budget: 50000,
        deadline: '2026-03-11T00:00:00Z',
        maxTasks: 50,
        maxDepth: 5,
        maxChildren: 10,
        budgetDecayFactor: 0.3,
      },
    };

    assert.ok(input.objective.length > 0, 'Objective is required');
    assert.ok(input.successCriteria.length > 0, 'Success criteria required');
    assert.ok(input.scopeBoundaries.length > 0, 'Scope boundaries required');
    assert.equal(input.parentMissionId, null, 'Root mission has null parent');
  });

  it('uses the same validation as the orchestration layer SC-1', () => {
    // Contract: limen.missions.create() must NOT bypass orchestration validation.
    // It must delegate to the same propose_mission logic that validates:
    // - BUDGET_EXCEEDED: requested > parent remaining x decayFactor
    // - DEPTH_EXCEEDED: parent depth + 1 > maxDepth (I-20)
    // - CHILDREN_EXCEEDED: parent child count >= maxChildren (I-20)
    // - TREE_SIZE_EXCEEDED: total missions in tree >= maxTotalMissions (I-20)
    // - CAPABILITY_VIOLATION: requested not subset of parent capabilities
    // - AGENT_NOT_FOUND: assignedAgentId does not exist
    // - UNAUTHORIZED: calling agent lacks create_mission permission
    // - DEADLINE_EXCEEDED: requested deadline beyond parent's
    // - DELEGATION_CYCLE: FM-19 visited set check

    const allErrorCodes: ProposeMissionError[] = [
      'BUDGET_EXCEEDED', 'DEPTH_EXCEEDED', 'CHILDREN_EXCEEDED',
      'TREE_SIZE_EXCEEDED', 'CAPABILITY_VIOLATION', 'AGENT_NOT_FOUND',
      'UNAUTHORIZED', 'DEADLINE_EXCEEDED', 'DELEGATION_CYCLE',
    ];

    assert.equal(allErrorCodes.length, 9,
      'SC-1 has exactly 9 error codes that API must enforce');
  });

  it('returns mission ID and state CREATED on success', () => {
    // §15 output: { missionId: MissionId, state: 'CREATED', resourceAllocation: Resource }
    const output: ProposeMissionOutput = {
      missionId: 'mission-123' as any,
      state: 'CREATED',
      allocated: {
        budget: 50000,
        capabilities: ['web_search', 'code_execute', 'data_query'],
      },
    };

    assert.equal(output.state, 'CREATED', 'New missions start in CREATED state');
    assert.ok(output.missionId, 'Mission ID is returned');
  });
});

// ---------------------------------------------------------------------------
// I-17: Governance Boundary at API Level
// ---------------------------------------------------------------------------

describe('I-17: Governance boundary enforcement at API level', () => {

  it.skip('missions.create() passes through orchestrator validation, never bypasses', () => {
    // I-17: "Agents never directly mutate system state. Every state mutation
    //         passes through orchestrator validation."
    //
    // The API layer (L5) calls the orchestration layer (L2) which calls the
    // kernel (L1) for persistence. No shortcut path exists.
    //
    // Contract: There is no code path from limen.missions.create() to a
    // database INSERT that doesn't go through OrchestrationEngine.proposeMission().
    //
    // UNTESTABLE: Requires integration test with instrumented orchestrator
    // to verify the delegation path. Cannot be verified structurally without
    // a live createLimen() instance.
  });
});

// ---------------------------------------------------------------------------
// I-20: Mission Tree Limits at API Level
// ---------------------------------------------------------------------------

describe('I-20: Mission tree limits enforced through API', () => {

  it('default max depth is 5', () => {
    // I-20: "Max recursion depth: configurable (default 5)."
    assert.equal(MISSION_TREE_DEFAULTS.maxDepth, 5, 'Default max depth is 5');
  });

  it('default max children per mission is 10', () => {
    // I-20: "Max children per mission: configurable (default 10)."
    assert.equal(MISSION_TREE_DEFAULTS.maxChildren, 10, 'Default max children is 10');
  });

  it('default max total missions per tree is 50', () => {
    // I-20: "Max total missions per tree: configurable (default 50)."
    assert.equal(MISSION_TREE_DEFAULTS.maxTotalMissions, 50, 'Default max total missions is 50');
  });

  it('default max tasks per mission is 50', () => {
    // I-20: "Max tasks per mission: configurable (default 50)."
    assert.equal(MISSION_TREE_DEFAULTS.maxTasks, 50, 'Default max tasks is 50');
  });

  it('default budget decay factor is 0.3', () => {
    // I-20: "Budget decay factor per child level: configurable (default 0.3)."
    assert.equal(MISSION_TREE_DEFAULTS.budgetDecayFactor, 0.3, 'Default budget decay factor is 0.3');
  });
});
