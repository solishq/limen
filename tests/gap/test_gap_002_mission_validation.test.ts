/**
 * TEST-GAP-002: Mission Store Validation — S15, I-20, I-22, FM-19
 * Verifies: Tree constraint enforcement, capability immutability, delegation cycle detection.
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * S15: propose_mission system call with 7+ error codes.
 * I-20: "Max recursion depth: configurable (default 5). Max children: (default 10). Max total: (default 100)."
 * I-22: "Capabilities are mission-scoped and set at mission creation. They cannot expand mid-mission."
 * FM-19: "visited set (AgentId[]) in delegation message. Before delegating, check if target in visited set."
 *
 * Phase: 4A-3 (harness-dependent tests)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMissionStore } from '../../src/orchestration/missions/mission_store.js';
import { MISSION_TREE_DEFAULTS } from '../../src/orchestration/interfaces/orchestration.js';
import {
  createTestOrchestrationDeps,
  createTestOperationContext,
  seedMission,
  seedResource,
  missionId,
  agentId,
} from '../helpers/test_database.js';
import type { MissionId, AgentId } from '../../src/kernel/interfaces/index.js';

// Helper to create a valid ProposeMissionInput
function missionInput(overrides: Record<string, unknown> = {}) {
  return {
    parentMissionId: (overrides.parentMissionId ?? null) as MissionId | null,
    agentId: (overrides.agentId ?? agentId('agent-1')) as AgentId,
    objective: (overrides.objective ?? 'Test mission') as string,
    successCriteria: (overrides.successCriteria ?? ['Complete']) as string[],
    scopeBoundaries: (overrides.scopeBoundaries ?? ['Within scope']) as string[],
    capabilities: (overrides.capabilities ?? ['web_search']) as string[],
    constraints: {
      budget: (overrides.budget ?? 5000) as number,
      deadline: (overrides.deadline ?? new Date(Date.now() + 3600000).toISOString()) as string,
      ...(overrides.maxDepth !== undefined ? { maxDepth: overrides.maxDepth as number } : {}),
      ...(overrides.maxChildren !== undefined ? { maxChildren: overrides.maxChildren as number } : {}),
    },
  };
}

describe('TEST-GAP-002: Mission Store Validation (S15, I-20, I-22, FM-19)', () => {

  describe('I-20: Depth limit enforcement', () => {

    it('DEPTH_EXCEEDED when child exceeds maxDepth', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const missions = createMissionStore();
      const ctx = createTestOperationContext();

      // Create a root mission manually at depth 0
      seedMission(conn, { id: 'root-1', agentId: 'agent-root', depth: 0, capabilities: ['web_search'] });
      seedResource(conn, { missionId: 'root-1' });

      // Create chain to reach maxDepth (default 5)
      // Seed missions at depths 1-5
      let parentId = 'root-1';
      for (let d = 1; d <= 5; d++) {
        const childId = `depth-${d}`;
        seedMission(conn, {
          id: childId,
          parentId,
          agentId: `agent-${d}`,
          depth: d,
          capabilities: ['web_search'],
        });
        seedResource(conn, { missionId: childId });
        parentId = childId;
      }

      // Now try to create a child beyond maxDepth (depth 6 > default 5)
      const result = missions.create(deps, ctx, missionInput({
        parentMissionId: missionId('depth-5'),
        agentId: agentId(`agent-6`),
      }));

      assert.equal(result.ok, false, 'I-20: Must reject when depth exceeds maxDepth');
      if (!result.ok) {
        assert.equal(result.error.code, 'DEPTH_EXCEEDED',
          'I-20: Error code must be DEPTH_EXCEEDED');
      }

      conn.close();
    });
  });

  describe('I-20: Children count enforcement', () => {

    it('CHILDREN_EXCEEDED when parent has maxChildren children', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const missions = createMissionStore();
      const ctx = createTestOperationContext();

      // Create root mission with maxChildren = 2 (small for testing)
      seedMission(conn, { id: 'parent-1', agentId: 'agent-parent', capabilities: ['web_search'] });
      seedResource(conn, { missionId: 'parent-1' });

      // Create 10 children (the default maxChildren)
      for (let i = 0; i < MISSION_TREE_DEFAULTS.maxChildren; i++) {
        seedMission(conn, {
          id: `child-${i}`,
          parentId: 'parent-1',
          agentId: `agent-child-${i}`,
          capabilities: ['web_search'],
          depth: 1,
        });
      }

      // Try to create child #11 — should fail
      const result = missions.create(deps, ctx, missionInput({
        parentMissionId: missionId('parent-1'),
        agentId: agentId('agent-overflow'),
      }));

      assert.equal(result.ok, false, 'I-20: Must reject when children count >= maxChildren');
      if (!result.ok) {
        assert.equal(result.error.code, 'CHILDREN_EXCEEDED',
          'I-20: Error code must be CHILDREN_EXCEEDED');
      }

      conn.close();
    });
  });

  describe('I-22: Capability subset enforcement', () => {

    it('CAPABILITY_VIOLATION when child requests capabilities not in parent', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const missions = createMissionStore();
      const ctx = createTestOperationContext();

      // Parent has only ['web_search']
      seedMission(conn, { id: 'cap-parent', agentId: 'agent-cap', capabilities: ['web_search'] });
      seedResource(conn, { missionId: 'cap-parent' });

      // Child requests ['web_search', 'code_execution'] — code_execution not in parent
      const result = missions.create(deps, ctx, missionInput({
        parentMissionId: missionId('cap-parent'),
        agentId: agentId('agent-cap-child'),
        capabilities: ['web_search', 'code_execution'],
      }));

      assert.equal(result.ok, false, 'I-22: Must reject capability superset');
      if (!result.ok) {
        assert.equal(result.error.code, 'CAPABILITY_VIOLATION',
          'I-22: Error code must be CAPABILITY_VIOLATION');
      }

      conn.close();
    });

    it('child with subset of parent capabilities succeeds', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const missions = createMissionStore();
      const ctx = createTestOperationContext();

      // Parent has ['web_search', 'code_execution', 'file_io']
      // tokenAllocated must be high enough that child budget (5000) <= tokenAllocated * decayFactor (0.3)
      seedMission(conn, { id: 'cap-parent-2', agentId: 'agent-cap-2', capabilities: ['web_search', 'code_execution', 'file_io'] });
      seedResource(conn, { missionId: 'cap-parent-2', tokenAllocated: 100000 });

      // Child requests only ['web_search'] — strict subset, should succeed
      const result = missions.create(deps, ctx, missionInput({
        parentMissionId: missionId('cap-parent-2'),
        agentId: agentId('agent-subset'),
        capabilities: ['web_search'],
      }));

      assert.equal(result.ok, true, 'I-22: Capability subset must be accepted');

      conn.close();
    });
  });

  describe('FM-19: Delegation cycle detection', () => {

    it('DELEGATION_CYCLE when agent appears in delegation chain', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const missions = createMissionStore();
      const ctx = createTestOperationContext();

      // Create root mission by agent-A
      seedMission(conn, {
        id: 'cycle-root',
        agentId: 'agent-A',
        capabilities: ['web_search'],
      });
      seedResource(conn, { missionId: 'cycle-root' });

      // Create child by agent-B (delegation chain: [agent-A])
      seedMission(conn, {
        id: 'cycle-child-1',
        parentId: 'cycle-root',
        agentId: 'agent-B',
        depth: 1,
        capabilities: ['web_search'],
      });
      // tokenAllocated must be high enough that child budget (5000) <= tokenAllocated * decayFactor (0.3)
      seedResource(conn, { missionId: 'cycle-child-1', tokenAllocated: 100000 });

      // Update delegation chain for cycle-child-1 to reflect the chain
      conn.run(
        `UPDATE core_missions SET delegation_chain = ? WHERE id = ?`,
        [JSON.stringify(['agent-A']), 'cycle-child-1']
      );

      // Try to create grandchild by agent-A again — cycle!
      const result = missions.create(deps, ctx, missionInput({
        parentMissionId: missionId('cycle-child-1'),
        agentId: agentId('agent-A'),
      }));

      assert.equal(result.ok, false, 'FM-19: Must detect delegation cycle');
      if (!result.ok) {
        assert.equal(result.error.code, 'DELEGATION_CYCLE',
          'FM-19: Error code must be DELEGATION_CYCLE');
      }

      conn.close();
    });
  });

  describe('I-20: Tree size enforcement', () => {

    it('TREE_SIZE_EXCEEDED when tree total reaches maxTotalMissions', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const missions = createMissionStore();
      const ctx = createTestOperationContext();

      // Create root mission
      seedMission(conn, { id: 'tree-root', agentId: 'agent-tree', capabilities: ['web_search'] });
      seedResource(conn, { missionId: 'tree-root' });

      // Set tree count to maxTotalMissions (50, I-20)
      conn.run(
        `UPDATE core_tree_counts SET total_count = ? WHERE root_mission_id = ?`,
        [MISSION_TREE_DEFAULTS.maxTotalMissions, 'tree-root']
      );

      // Try to create another child — should fail
      const result = missions.create(deps, ctx, missionInput({
        parentMissionId: missionId('tree-root'),
        agentId: agentId('agent-overflow'),
      }));

      assert.equal(result.ok, false, 'I-20: Must reject when tree size >= maxTotalMissions');
      if (!result.ok) {
        assert.equal(result.error.code, 'TREE_SIZE_EXCEEDED',
          'I-20: Error code must be TREE_SIZE_EXCEEDED');
      }

      conn.close();
    });
  });

  describe('S15: Root mission creation succeeds with valid input', () => {

    it('root mission creation produces CREATED state and allocates resources', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const missions = createMissionStore();
      const ctx = createTestOperationContext();

      const result = missions.create(deps, ctx, missionInput({
        agentId: agentId('agent-root-valid'),
        budget: 10000,
      }));

      assert.equal(result.ok, true, 'S15: Root mission creation must succeed');
      if (result.ok) {
        assert.equal(result.value.state, 'CREATED', 'S15: Initial state must be CREATED');

        // Verify resource allocation
        const resource = conn.get<{ token_allocated: number; token_remaining: number }>(
          `SELECT token_allocated, token_remaining FROM core_resources WHERE mission_id = ?`,
          [result.value.missionId]
        );
        assert.ok(resource, 'S11: Resource must be allocated');
        assert.equal(resource.token_allocated, 10000, 'S11: token_allocated must match budget');
        assert.equal(resource.token_remaining, 10000, 'S11: token_remaining must equal allocated initially');
      }

      conn.close();
    });
  });
});
