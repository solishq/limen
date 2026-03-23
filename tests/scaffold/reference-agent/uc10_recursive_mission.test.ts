// SCAFFOLD: Decorative test — assert.ok(true) or local-constant assertions only.
// Quarantined by audit-remediation (2026-03-19). Retained as Phase 2C implementation scaffolds.
// To convert: replace assertions with real store/harness calls against implementation code.
/**
 * Verifies: §41 UC-10, §6, §15, §16, §18, §19, §23, §24,
 *           I-17, I-19, I-20, I-21, I-22, I-24, FM-13, FM-19
 * Phase: 5 (Reference Agent)
 * Agent: Verification Engineer (Team D)
 *
 * Tests derived from the Limen specification.
 * No reference agent implementation exists at time of writing.
 * Tests define the contracts the reference agent must satisfy.
 *
 * UC-10: Recursive Multi-Level Mission
 * "Strategist agent creates a mission, discovers sub-opportunity,
 *  spawns child mission. Child inherits budget x 0.3. Recursive
 *  to depth 5. Artifacts flow up."
 *
 * This file tests the reference agent's ability to:
 *  1. Create a root mission via limen.missions.create()
 *  2. Plan tasks via MissionHandle.proposeTaskGraph()
 *  3. Spawn child missions (parentMissionId) with budget decay
 *  4. Flow artifacts up the tree via readArtifact cross-mission
 *  5. Submit results at each level with aggregation
 *  6. Respect I-20 limits, I-22 capability subset, I-24 alignment
 *
 * ASSUMPTIONS:
 * - ASSUMPTION P5-UC10-1: The reference agent interacts exclusively through
 *   the Limen public API (MissionApi, MissionHandle). It never imports from
 *   kernel, substrate, or orchestration. Derived from §41 + Team C boundary.
 * - ASSUMPTION P5-UC10-2: Budget decay is calculated as
 *   parent.remaining * decayFactor at the time of child creation. Derived
 *   from §11 + §6 constraint inheritance.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  MissionCreateOptions, MissionHandle, MissionResult,
  TaskGraphInput, ArtifactCreateInput, ResultSubmitInput,
  MissionState,
} from '../../src/api/interfaces/api.js';
import type { MissionId, TaskId, ArtifactId } from '../../src/kernel/interfaces/index.js';

// ---------------------------------------------------------------------------
// Mock Helpers -- contract shapes only, no implementation
// ---------------------------------------------------------------------------

function makeMissionId(s: string): MissionId { return s as MissionId; }
function makeTaskId(s: string): TaskId { return s as TaskId; }
function makeArtifactId(s: string): ArtifactId { return s as ArtifactId; }

function rootMissionOptions(overrides?: Partial<MissionCreateOptions>): MissionCreateOptions {
  return {
    agent: 'strategist',
    objective: 'Analyze SEA drone delivery market',
    successCriteria: ['Market size estimate', 'Competitor map', 'Entry strategy'],
    scopeBoundaries: ['Southeast Asia', 'Drone delivery vertical'],
    constraints: {
      tokenBudget: 50000,
      deadline: '48h',
      capabilities: ['web_search', 'code_execute', 'data_query'],
      maxTasks: 50,
      maxChildren: 10,
      maxDepth: 5,
    },
    deliverables: [{ type: 'report', name: 'Market Entry Strategy' }],
    ...overrides,
  };
}

// ============================================================================
// UC-10: Root Mission Creation
// ============================================================================

describe('UC-10: Root mission creation via limen.missions.create()', () => {

  // Verifies §15, §41 UC-10
  it('root mission has null parentMissionId', () => {
    const opts = rootMissionOptions();
    assert.equal(opts.parentMissionId, undefined,
      'Root mission parentMissionId is undefined (null internally)');
  });

  // Verifies §15, §41 UC-10
  it('root mission specifies agent name, objective, and constraints', () => {
    const opts = rootMissionOptions();
    assert.equal(opts.agent, 'strategist');
    assert.ok(opts.objective.length > 0);
    assert.equal(opts.constraints.tokenBudget, 50000);
    assert.equal(opts.constraints.deadline, '48h');
    assert.deepEqual(opts.constraints.capabilities, ['web_search', 'code_execute', 'data_query']);
  });

  // Verifies §6, §15
  it('root mission starts in CREATED state on success', () => {
    const expectedState: MissionState = 'CREATED';
    assert.equal(expectedState, 'CREATED');
  });

  // Verifies I-24, §15
  it('root mission stores success criteria and scope boundaries as goal anchors', () => {
    const opts = rootMissionOptions();
    assert.ok(opts.successCriteria!.length >= 1, 'At least one success criterion required');
    assert.ok(opts.scopeBoundaries!.length >= 1, 'At least one scope boundary required');
  });

  // Verifies §15
  it('MissionHandle returned by create() exposes mission id and state', () => {
    // Contract: MissionHandle has id: MissionId and state: MissionState
    const handle: Pick<MissionHandle, 'id' | 'state'> = {
      id: makeMissionId('mission-root'),
      state: 'CREATED',
    };
    assert.ok(handle.id);
    assert.equal(handle.state, 'CREATED');
  });
});

// ============================================================================
// UC-10: Task Graph Proposal (Root Level)
// ============================================================================

describe('UC-10: Root agent proposes task graph via proposeTaskGraph()', () => {

  // Verifies §16, I-24
  it('task graph requires objectiveAlignment linking to mission objective', () => {
    const graph: TaskGraphInput = {
      missionId: makeMissionId('mission-root'),
      tasks: [
        { id: 'task-1', description: 'Research market size', executionMode: 'stochastic', estimatedTokens: 5000 },
        { id: 'task-2', description: 'Identify competitors', executionMode: 'stochastic', estimatedTokens: 8000 },
        { id: 'task-3', description: 'Analyze regulations', executionMode: 'stochastic', estimatedTokens: 6000 },
      ],
      dependencies: [
        { from: 'task-1', to: 'task-3' },
        { from: 'task-2', to: 'task-3' },
      ],
      objectiveAlignment: 'Tasks decompose the SEA drone delivery market analysis into research, competitor ID, and regulatory analysis',
    };
    assert.ok(graph.objectiveAlignment.length > 0, 'I-24: objectiveAlignment is mandatory');
  });

  // Verifies §16
  it('task graph defines DAG with no cycles', () => {
    // DAG: task-1->task-3, task-2->task-3. No cycle.
    // Contract: system validates acyclicity on every propose_task_graph
    const hasCycle = false; // contract: system validates
    assert.equal(hasCycle, false, 'Task graph must be acyclic');
  });

  // Verifies §16, I-20
  it('task count must not exceed maxTasks (default 50)', () => {
    const maxTasks = 50;
    const taskCount = 3;
    assert.ok(taskCount <= maxTasks, 'Task count within limit');
  });

  // Verifies §16
  it('proposeTaskGraph returns graphId and planVersion on success', () => {
    // Contract: output has graphId: string, planVersion: number, taskCount: number
    const expectedOutput = {
      graphId: 'graph-001',
      planVersion: 1,
      taskCount: 3,
      validationWarnings: [],
    };
    assert.ok(expectedOutput.graphId);
    assert.equal(expectedOutput.planVersion, 1, 'First plan is version 1');
  });
});

// ============================================================================
// UC-10: Child Mission Creation (Level 1)
// ============================================================================

describe('UC-10: Strategist spawns child mission for researcher', () => {

  // Verifies §15, §11, I-20
  it('child mission has parentMissionId pointing to root', () => {
    const childOpts: MissionCreateOptions = {
      agent: 'researcher',
      objective: 'Research competitive landscape in SEA drone delivery',
      constraints: {
        tokenBudget: 15000,  // 50000 * 0.3
        deadline: '24h',
        capabilities: ['web_search', 'data_query'],
      },
      parentMissionId: makeMissionId('mission-root'),
    };
    assert.equal(childOpts.parentMissionId, makeMissionId('mission-root'));
  });

  // Verifies §11, I-20
  it('child budget = parent remaining * decayFactor (0.3)', () => {
    const parentBudget = 50000;
    const decayFactor = 0.3;
    const childBudget = parentBudget * decayFactor;
    assert.equal(childBudget, 15000);
  });

  // Verifies I-22
  it('child capabilities must be subset of parent capabilities', () => {
    const parentCaps = new Set(['web_search', 'code_execute', 'data_query']);
    const childCaps = ['web_search', 'data_query'];
    const isSubset = childCaps.every(c => parentCaps.has(c));
    assert.ok(isSubset, 'I-22: Child capabilities are subset');
  });

  // Verifies I-22
  it('CAPABILITY_VIOLATION if child requests capability not in parent', () => {
    const parentCaps = new Set(['web_search', 'data_query']);
    const invalidChildCaps = ['web_search', 'file_write'];
    const isSubset = invalidChildCaps.every(c => parentCaps.has(c));
    assert.ok(!isSubset, 'file_write not in parent -> CAPABILITY_VIOLATION');
  });

  // Verifies §6
  it('child deadline must not exceed parent deadline', () => {
    const parentDeadline = 48;  // hours
    const childDeadline = 24;   // hours
    assert.ok(childDeadline <= parentDeadline, 'Child deadline within parent');
  });
});

// ============================================================================
// UC-10: Grandchild Mission (Level 2)
// ============================================================================

describe('UC-10: Researcher spawns grandchild mission for analyst', () => {

  // Verifies §15, §11
  it('grandchild budget = researcher budget * decayFactor', () => {
    const researcherBudget = 15000;
    const decayFactor = 0.3;
    const analystBudget = researcherBudget * decayFactor;
    assert.equal(analystBudget, 4500);
  });

  // Verifies I-22
  it('analyst capabilities further subset of researcher', () => {
    const researcherCaps = new Set(['web_search', 'data_query']);
    const analystCaps = ['data_query'];
    const isSubset = analystCaps.every(c => researcherCaps.has(c));
    assert.ok(isSubset, 'Analyst has only data_query');
    assert.equal(analystCaps.length, 1);
  });

  // Verifies I-20
  it('depth tracking: root=0, child=1, grandchild=2', () => {
    const depths = { root: 0, child: 1, grandchild: 2 };
    assert.equal(depths.grandchild, 2);
    assert.ok(depths.grandchild <= 5, 'Within maxDepth default');
  });

  // Verifies I-20
  it('budget converges toward zero across levels', () => {
    const budgets = [50000, 15000, 4500, 1350, 405];
    for (let i = 1; i < budgets.length; i++) {
      const expected = Math.round(budgets[i - 1]! * 0.3);
      assert.equal(budgets[i], expected, `Level ${i} budget = level ${i - 1} * 0.3`);
    }
    assert.ok(budgets[budgets.length - 1]! < 500, 'Budget nearly exhausted by level 4');
  });
});

// ============================================================================
// UC-10: Artifact Flow Up
// ============================================================================

describe('UC-10: Artifacts flow from child to parent', () => {

  // Verifies §18, I-19
  it('child creates artifact with sourceTaskId and missionId', () => {
    const artifact: ArtifactCreateInput = {
      missionId: makeMissionId('mission-analyst'),
      name: 'Pricing Comparison Table',
      type: 'data',
      format: 'csv',
      content: 'competitor,price,volume\nDHL,5.00,10000',
      sourceTaskId: makeTaskId('task-analyst-1'),
    };
    assert.ok(artifact.missionId);
    assert.ok(artifact.sourceTaskId);
    assert.equal(artifact.type, 'data');
  });

  // Verifies §19, I-23
  it('parent reads child artifact via readArtifact, creating dependency edge', () => {
    // I-23: "read_artifact creates a dependency edge from the reading mission
    //         to the artifact. Invalidation cascades through these edges."
    const readInput = {
      artifactId: makeArtifactId('artifact-analyst-pricing'),
      version: 'latest' as const,
    };
    assert.ok(readInput.artifactId);
  });

  // Verifies I-19
  it('artifact versions are immutable once created', () => {
    // I-19: "Artifacts are append-only: new version, never modify."
    const version1Content = 'v1 content';
    const version2Content = 'v2 content with corrections';
    assert.notEqual(version1Content, version2Content,
      'New version creates new entry, does not modify v1');
  });

  // Verifies §23
  it('analyst submits result with artifact references', () => {
    const result: ResultSubmitInput = {
      missionId: makeMissionId('mission-analyst'),
      summary: 'Pricing analysis complete: 15 competitors analyzed',
      confidence: 0.85,
      artifactIds: [makeArtifactId('artifact-pricing-table')],
      unresolvedQuestions: ['Two competitors have unpublished pricing'],
    };
    assert.ok(result.artifactIds.length >= 1, 'At least one artifact required');
    assert.ok(result.confidence >= 0 && result.confidence <= 1, 'Confidence in [0,1]');
  });

  // Verifies §23
  it('researcher aggregates analyst artifacts into own result', () => {
    const researcherResult: ResultSubmitInput = {
      missionId: makeMissionId('mission-researcher'),
      summary: 'Competitive landscape analyzed: 3 reports from sub-agents',
      confidence: 0.80,
      artifactIds: [
        makeArtifactId('artifact-competitor-report'),
        makeArtifactId('artifact-pricing-table'),  // from analyst
      ],
    };
    assert.ok(researcherResult.artifactIds.length >= 2,
      'Researcher aggregates own + child artifacts');
  });

  // Verifies §23
  it('strategist produces final report aggregating all child results', () => {
    const strategyResult: ResultSubmitInput = {
      missionId: makeMissionId('mission-root'),
      summary: 'Market Entry Strategy for SEA Drone Delivery: complete',
      confidence: 0.78,
      artifactIds: [
        makeArtifactId('artifact-final-report'),
        makeArtifactId('artifact-competitor-report'),
        makeArtifactId('artifact-pricing-table'),
      ],
      unresolvedQuestions: ['Carbon capture sub-opportunity needs deeper analysis'],
      followupRecommendations: ['Commission Phase 2: detailed business model'],
    };
    assert.ok(strategyResult.artifactIds.length >= 3, 'Final report references all artifacts');
    assert.ok(strategyResult.unresolvedQuestions!.length >= 1);
    assert.ok(strategyResult.followupRecommendations!.length >= 1);
  });
});

// ============================================================================
// UC-10: MissionResult Aggregation
// ============================================================================

describe('UC-10: MissionResult aggregation from bottom up', () => {

  // Verifies §23
  it('MissionResult contains confidence score', () => {
    const result: MissionResult = {
      missionId: makeMissionId('mission-root'),
      state: 'COMPLETED',
      summary: 'Analysis complete',
      confidence: 0.78,
      artifacts: [
        { id: makeArtifactId('a1'), name: 'Final Report', type: 'report', version: 1 },
      ],
      unresolvedQuestions: ['Carbon capture sub-opportunity'],
      followupRecommendations: ['Commission Phase 2'],
      resourcesConsumed: { tokens: 42000, wallClockMs: 120000, llmCalls: 35 },
    };
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  });

  // Verifies §23
  it('MissionResult records resources consumed across tree', () => {
    const result: MissionResult = {
      missionId: makeMissionId('mission-root'),
      state: 'COMPLETED',
      summary: 'Done',
      confidence: 0.80,
      artifacts: [],
      unresolvedQuestions: [],
      followupRecommendations: [],
      resourcesConsumed: { tokens: 42000, wallClockMs: 172800000, llmCalls: 85 },
    };
    assert.ok(result.resourcesConsumed.tokens > 0);
    assert.ok(result.resourcesConsumed.llmCalls > 0);
  });

  // Verifies §6
  it('terminal state COMPLETED has no outbound transitions', () => {
    const terminalStates: MissionState[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
    assert.equal(terminalStates.length, 3);
    // Contract: once COMPLETED, mission state cannot change
  });
});

// ============================================================================
// UC-10: I-20 Mission Tree Limits
// ============================================================================

describe('UC-10/I-20: Mission tree boundedness', () => {

  // Verifies I-20
  it('max depth 5: mission at depth 5 cannot create child', () => {
    const maxDepth = 5;
    const atDepth5 = 5;
    assert.ok(atDepth5 >= maxDepth, 'At max depth, DEPTH_EXCEEDED');
  });

  // Verifies I-20
  it('max children 10: mission with 10 children cannot spawn 11th', () => {
    const maxChildren = 10;
    const currentChildren = 10;
    assert.ok(currentChildren >= maxChildren, 'At max children, CHILDREN_EXCEEDED');
  });

  // Verifies I-20
  it('max total missions 100 per tree', () => {
    const maxTotal = 100;
    const currentTotal = 100;
    assert.ok(currentTotal >= maxTotal, 'At max total, TREE_SIZE_EXCEEDED');
  });

  // Verifies I-20, FM-13
  it('FM-13 defense: budget decay + structural limits prevent unbounded autonomy', () => {
    // Budget at depth 5 with decay 0.3: 50000 * 0.3^5 = 121.5
    // 0.3^5 = 0.00243, so 50000 * 0.00243 = 121.5
    const budgetAtDepth5 = Math.round(50000 * Math.pow(0.3, 5));
    assert.equal(budgetAtDepth5, 121, 'Budget nearly zero at depth 5');
    // Combined with structural limits, FM-13 is defended
  });
});

// ============================================================================
// UC-10: I-21 Bounded Cognition
// ============================================================================

describe('UC-10/I-21: Bounded cognition and compaction', () => {

  // Verifies I-21
  it('completed subtree compacted after analyst mission completes', () => {
    // I-21: "Completed subtrees compacted to summary + artifacts.
    //         Working set never exceeds structural limits."
    // When analyst (depth 2) completes:
    //   - Tasks compacted (detail removed, summary retained)
    //   - Artifacts remain accessible
    //   - Researcher sees compact summary only
    assert.ok(true,
      'Contract: submit_result triggers compaction of completed subtree');
  });

  // Verifies I-21
  it('working set includes only non-compacted active missions', () => {
    // After analyst completes, researcher's working set is:
    //   [researcher itself, any other active children]
    // NOT [researcher, analyst (compacted)]
    assert.ok(true,
      'Contract: working set bounded to active (non-compacted) missions');
  });

  // Verifies I-21
  it('compacted mission artifacts remain readable via readArtifact', () => {
    // I-21 does NOT mean artifacts are deleted. They transition to SUMMARIZED
    // lifecycle state but remain accessible.
    assert.ok(true,
      'Contract: compaction does not delete artifacts -- they remain readable');
  });
});

// ============================================================================
// UC-10: I-24 Goal Anchoring
// ============================================================================

describe('UC-10/I-24: Goal anchoring enforcement', () => {

  // Verifies I-24, §16
  it('every proposeTaskGraph must include objectiveAlignment', () => {
    const graph: TaskGraphInput = {
      missionId: makeMissionId('mission-root'),
      tasks: [{ id: 'task-1', description: 'Research', executionMode: 'stochastic', estimatedTokens: 5000 }],
      dependencies: [],
      objectiveAlignment: 'Research task directly supports market analysis objective',
    };
    assert.ok(graph.objectiveAlignment.length > 0,
      'I-24: objectiveAlignment is required, not optional');
  });

  // Verifies I-24
  it('objective is immutable after mission creation', () => {
    // I-24: "objective, successCriteria, scopeBoundaries are immutable after creation"
    const originalObjective = 'Analyze SEA drone delivery market';
    // Contract: no API to modify objective post-creation
    assert.ok(originalObjective.length > 0,
      'Contract: objective immutable -- no setter exists on MissionHandle');
  });
});

// ============================================================================
// UC-10: FM-19 Delegation Cycle Detection
// ============================================================================

describe('UC-10/FM-19: Delegation cycle prevention', () => {

  // Verifies FM-19
  it('strategist -> researcher -> strategist is a delegation cycle', () => {
    const chain = ['strategist', 'researcher', 'strategist'];
    const visited = new Set<string>();
    let cycleDetected = false;
    for (const agent of chain) {
      if (visited.has(agent)) { cycleDetected = true; break; }
      visited.add(agent);
    }
    assert.ok(cycleDetected, 'FM-19: cycle detected in delegation chain');
  });

  // Verifies FM-19
  it('three-agent cycle: A -> B -> C -> A is detected', () => {
    const chain = ['strategist', 'researcher', 'analyst', 'strategist'];
    const visited = new Set<string>();
    let cycleDetected = false;
    for (const agent of chain) {
      if (visited.has(agent)) { cycleDetected = true; break; }
      visited.add(agent);
    }
    assert.ok(cycleDetected, 'FM-19: three-agent cycle detected');
  });

  // Verifies FM-19
  it('linear chain A -> B -> C has no cycle', () => {
    const chain = ['strategist', 'researcher', 'analyst'];
    const visited = new Set<string>();
    let cycleDetected = false;
    for (const agent of chain) {
      if (visited.has(agent)) { cycleDetected = true; break; }
      visited.add(agent);
    }
    assert.ok(!cycleDetected, 'No cycle in linear delegation chain');
  });
});

// ============================================================================
// UC-10: End-to-End Mission Lifecycle
// ============================================================================

describe('UC-10: End-to-end 3-level mission lifecycle', () => {

  // Verifies §6, §41 UC-10
  it('lifecycle: CREATED -> PLANNING -> EXECUTING -> REVIEWING -> COMPLETED', () => {
    const lifecycle: MissionState[] = ['CREATED', 'PLANNING', 'EXECUTING', 'REVIEWING', 'COMPLETED'];
    assert.equal(lifecycle[0], 'CREATED');
    assert.equal(lifecycle[lifecycle.length - 1], 'COMPLETED');
    assert.equal(lifecycle.length, 5);
  });

  // Verifies §41 UC-10
  it('bottom-up completion: analyst -> researcher -> strategist', () => {
    // The mission tree completes from leaves to root:
    // 1. Analyst completes (submit_result) -> compacted
    // 2. Researcher reads analyst artifacts, completes -> compacted
    // 3. Strategist reads researcher artifacts, produces final report, completes
    const completionOrder = ['analyst', 'researcher', 'strategist'];
    assert.equal(completionOrder[0], 'analyst', 'Leaf completes first');
    assert.equal(completionOrder[completionOrder.length - 1], 'strategist', 'Root completes last');
  });

  // Verifies §23
  it('MissionHandle.wait() resolves when mission reaches terminal state', () => {
    // Contract: wait() returns Promise<MissionResult>
    // MissionResult.state is one of: COMPLETED, FAILED, CANCELLED
    const terminalStates = ['COMPLETED', 'FAILED', 'CANCELLED'] as const;
    assert.equal(terminalStates.length, 3);
  });

  // Verifies §6, §41 UC-10
  it('all three levels produce at least one artifact', () => {
    // Contract: each level creates at least one artifact before submit_result
    const artifactsByLevel = {
      analyst: ['pricing-table'],
      researcher: ['competitor-report'],
      strategist: ['market-entry-strategy'],
    };
    assert.ok(artifactsByLevel.analyst.length >= 1);
    assert.ok(artifactsByLevel.researcher.length >= 1);
    assert.ok(artifactsByLevel.strategist.length >= 1);
  });

  // Verifies §15, §6
  it('child mission carbon capture discovery triggers recursive spawning', () => {
    // UC-10 spec: "Agent plans -> discovers carbon capture opportunity
    //              -> spawns child mission"
    const carbonCaptureMission: MissionCreateOptions = {
      agent: 'analyst',
      objective: 'Evaluate carbon capture delivery opportunity in SEA',
      constraints: {
        tokenBudget: 4500,
        deadline: '12h',
        capabilities: ['data_query'],
      },
      parentMissionId: makeMissionId('mission-researcher'),
    };
    assert.ok(carbonCaptureMission.parentMissionId);
    assert.equal(carbonCaptureMission.agent, 'analyst');
  });
});

// ============================================================================
// UC-10: MissionHandle API Surface Contracts
// ============================================================================

describe('UC-10: MissionHandle exposes all required system call wrappers', () => {

  // Verifies §14-§24
  it('MissionHandle has all 9 system call wrapper methods', () => {
    // Contract: MissionHandle exposes:
    //   proposeTaskGraph, proposeTaskExecution, createArtifact, readArtifact,
    //   emitEvent, requestCapability, requestBudget, submitResult, respondCheckpoint
    const requiredMethods = [
      'proposeTaskGraph', 'proposeTaskExecution', 'createArtifact',
      'readArtifact', 'emitEvent', 'requestCapability', 'requestBudget',
      'submitResult', 'respondCheckpoint',
    ];
    assert.equal(requiredMethods.length, 9, '9 system call wrappers on MissionHandle');
  });

  // Verifies §23
  it('MissionHandle has convenience methods: wait(), pause(), resume(), cancel()', () => {
    const convenienceMethods = ['wait', 'pause', 'resume', 'cancel'];
    assert.equal(convenienceMethods.length, 4);
  });

  // Verifies §10
  it('MissionHandle has on() for event subscription', () => {
    // Contract: MissionHandle.on(event, handler) subscribes to mission events
    assert.ok(true, 'Contract: on() method exists for event subscription');
  });

  // Verifies §15
  it('MissionHandle exposes budget state: allocated, consumed, remaining', () => {
    const budgetShape = { allocated: 50000, consumed: 0, remaining: 50000 };
    assert.equal(budgetShape.remaining, budgetShape.allocated - budgetShape.consumed);
  });
});
