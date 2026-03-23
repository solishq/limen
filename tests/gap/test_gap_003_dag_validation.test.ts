/**
 * TEST-GAP-003: Task graph DAG validation — S16, SD-14
 * Verifies: kahnsAlgorithm rejects cyclic graphs and accepts valid DAGs.
 * Spec: S16 (propose_task_graph), CYCLE_DETECTED error code.
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * S16 states "CYCLE_DETECTED — dependency graph contains cycle."
 * SD-14: Kahn's algorithm chosen for O(V+E) acyclicity proof + topological ordering.
 *
 * Phase: 4A-2 (pure function tests, no database dependency)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { kahnsAlgorithm } from '../../src/orchestration/tasks/task_graph.js';
import type { TaskId } from '../../src/kernel/interfaces/index.js';

// Helper to create TaskDefinition-shaped objects (only id is used by kahnsAlgorithm)
function task(id: string) {
  return {
    id: id as TaskId,
    description: `Task ${id}`,
    executionMode: 'deterministic' as const,
    estimatedTokens: 100,
    capabilitiesRequired: [] as string[],
  };
}

// Helper to create TaskDependency-shaped objects
function dep(from: string, to: string) {
  return { from: from as TaskId, to: to as TaskId };
}

describe('TEST-GAP-003: Task Graph DAG Validation (S16, SD-14)', () => {

  it('direct cycle A->B->A is detected and returns null', () => {
    // SPEC: S16 "CYCLE_DETECTED — dependency graph contains cycle"
    // Two tasks with mutual dependency form a direct cycle.
    const tasks = [task('A'), task('B')];
    const deps = [dep('A', 'B'), dep('B', 'A')];

    const result = kahnsAlgorithm(tasks, deps);

    assert.equal(result, null, 'S16: Direct cycle A->B->A must return null (cycle detected)');
  });

  it('indirect cycle A->B->C->A is detected and returns null', () => {
    // 3-node cycle. Kahn's algorithm leaves nodes with in-degree > 0.
    const tasks = [task('A'), task('B'), task('C')];
    const deps = [dep('A', 'B'), dep('B', 'C'), dep('C', 'A')];

    const result = kahnsAlgorithm(tasks, deps);

    assert.equal(result, null, 'S16: Indirect cycle A->B->C->A must return null');
  });

  it('self-referencing task A->A is detected and returns null', () => {
    // Self-dependency: A depends on itself.
    const tasks = [task('A')];
    const deps = [dep('A', 'A')];

    const result = kahnsAlgorithm(tasks, deps);

    assert.equal(result, null, 'S16: Self-reference A->A must return null');
  });

  it('valid diamond DAG A->B, A->C, B->D, C->D returns topological order', () => {
    // SPEC: Valid DAGs must produce a topological sort.
    // The order must have A before B and C, and B and C before D.
    const tasks = [task('A'), task('B'), task('C'), task('D')];
    const deps = [dep('A', 'B'), dep('A', 'C'), dep('B', 'D'), dep('C', 'D')];

    const result = kahnsAlgorithm(tasks, deps);

    assert.notEqual(result, null, 'Valid diamond DAG must not return null');
    assert.equal(result!.length, 4, 'All 4 tasks must be in the result');

    // Verify topological ordering constraints
    const indexOf = (id: string) => result!.indexOf(id as TaskId);
    assert.ok(indexOf('A') < indexOf('B'), 'A must come before B');
    assert.ok(indexOf('A') < indexOf('C'), 'A must come before C');
    assert.ok(indexOf('B') < indexOf('D'), 'B must come before D');
    assert.ok(indexOf('C') < indexOf('D'), 'C must come before D');
  });

  it('empty dependency list (all tasks independent) returns all tasks', () => {
    // No dependencies — every task is independent, all appear in result.
    const tasks = [task('A'), task('B'), task('C')];
    const deps: ReturnType<typeof dep>[] = [];

    const result = kahnsAlgorithm(tasks, deps);

    assert.notEqual(result, null, 'No deps = valid DAG');
    assert.equal(result!.length, 3, 'All 3 tasks must be in the result');
    // All tasks should appear (order doesn't matter for independent tasks)
    const resultSet = new Set(result!.map(String));
    assert.ok(resultSet.has('A'));
    assert.ok(resultSet.has('B'));
    assert.ok(resultSet.has('C'));
  });

  it('single-task graph is valid and returns the single task', () => {
    const tasks = [task('only')];
    const deps: ReturnType<typeof dep>[] = [];

    const result = kahnsAlgorithm(tasks, deps);

    assert.notEqual(result, null, 'Single task = valid DAG');
    assert.equal(result!.length, 1);
    assert.equal(result![0], 'only' as TaskId);
  });

  it('linear chain A->B->C->D produces correct order', () => {
    // Additional case: pure linear dependency chain.
    const tasks = [task('A'), task('B'), task('C'), task('D')];
    const deps = [dep('A', 'B'), dep('B', 'C'), dep('C', 'D')];

    const result = kahnsAlgorithm(tasks, deps);

    assert.notEqual(result, null, 'Linear chain is a valid DAG');
    assert.deepStrictEqual(result, ['A', 'B', 'C', 'D'].map(id => id as TaskId),
      'Linear chain must produce exact order A, B, C, D');
  });

  it('partial cycle in larger graph is detected', () => {
    // 5 tasks, only B->C->D forms a cycle. A and E are clean.
    const tasks = [task('A'), task('B'), task('C'), task('D'), task('E')];
    const deps = [dep('A', 'B'), dep('B', 'C'), dep('C', 'D'), dep('D', 'B'), dep('A', 'E')];

    const result = kahnsAlgorithm(tasks, deps);

    assert.equal(result, null, 'Partial cycle B->C->D->B in larger graph must be detected');
  });
});
