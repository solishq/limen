/**
 * Contract tests for Reference Agent LLM Wiring (Sprint 6).
 * Phase: Sprint 6 (Reference Agent LLM)
 *
 * Covers:
 *   SD-02: LLM-augmented decomposition via MissionPlanner.decompose()
 *   SD-04: LLM-preferred assessment via CheckpointHandler.handleCheckpoint()
 *   I-16:  Graceful degradation -- all LLM failures fall back to heuristic
 *   I-24:  Goal anchoring -- objectiveAlignment present in every decomposition/assessment
 *
 * Amendment 21: Every enforcement DC has BOTH success AND rejection tests.
 * Amendment 22: Wiring verified -- requestCapability called at correct sites.
 *
 * Test strategy: Mock SystemCallClient at class level. The sandbox returns
 * SANDBOX_VIOLATION for real capability calls, so all tests must mock
 * requestCapability.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  MissionPlanner,
  heuristicDecompose,
  validateLlmDecomposeResponse,
} from '../../src/reference-agent/mission_planner.js';

import {
  CheckpointHandler,
  computeHeuristicConfidence,
  generateHeuristicAssessment,
  validateLlmAssessmentResponse,
} from '../../src/reference-agent/checkpoint_handler.js';

import { SystemCallClient } from '../../src/reference-agent/system_call_client.js';

import type {
  MissionId, TaskId, ArtifactId,
  MissionHandle,
  TaskGraphInput, TaskGraphOutput,
  CapabilityRequestInput, CapabilityRequestOutput,
  CheckpointResponseOutput,
  AgentExecutionState,
} from '../../src/reference-agent/reference_agent.types.js';

import type { TimeProvider } from '../../src/kernel/interfaces/time.js';

// ============================================================================
// Test Helpers
// ============================================================================

function makeMissionId(s: string): MissionId { return s as MissionId; }
function makeTaskId(s: string): TaskId { return s as TaskId; }

/** Build a minimal AgentExecutionState for testing. */
function makeState(overrides?: Partial<{
  missionId: MissionId;
  objective: string;
  budgetAllocated: number;
  budgetConsumed: number;
  capabilities: readonly string[];
  activeTaskIds: Set<string>;
  completedTaskIds: Set<string>;
  completedArtifactIds: ArtifactId[];
  planRevisionCount: number;
  currentPlanVersion: number;
  checkpointHistory: Array<{
    checkpointId: string;
    trigger: string;
    assessment: string;
    confidence: number;
    action: string;
    timestamp: number;
  }>;
  crossedBudgetThresholds: Set<number>;
}>): AgentExecutionState {
  return {
    missionId: overrides?.missionId ?? makeMissionId('mission-test-001'),
    objective: overrides?.objective ?? 'Analyze market data for SEA drone delivery',
    successCriteria: ['Complete analysis'],
    scopeBoundaries: ['SEA region'],
    capabilities: overrides?.capabilities ?? ['web_search', 'data_query'],
    budgetAllocated: overrides?.budgetAllocated ?? 50000,
    budgetConsumed: overrides?.budgetConsumed ?? 0,
    currentPlanVersion: overrides?.currentPlanVersion ?? 0,
    planRevisionCount: overrides?.planRevisionCount ?? 0,
    activeTaskIds: overrides?.activeTaskIds ?? new Set<string>(),
    completedTaskIds: overrides?.completedTaskIds ?? new Set<string>(),
    completedArtifactIds: overrides?.completedArtifactIds ?? [],
    childMissionResults: new Map(),
    checkpointHistory: overrides?.checkpointHistory ?? [],
    crossedBudgetThresholds: overrides?.crossedBudgetThresholds ?? new Set<number>(),
  };
}

/** Valid LLM decomposition response for testing. */
function makeValidDecomposeResult(): {
  tasks: Array<{ id: string; description: string; executionMode: string; estimatedTokens: number }>;
  dependencies: Array<{ from: string; to: string }>;
} {
  return {
    tasks: [
      { id: 'task-1', description: 'Research SEA logistics', executionMode: 'stochastic', estimatedTokens: 15000 },
      { id: 'task-2', description: 'Analyze cost structures', executionMode: 'stochastic', estimatedTokens: 15000 },
      { id: 'task-3', description: 'Deliver findings', executionMode: 'deterministic', estimatedTokens: 10000 },
    ],
    dependencies: [
      { from: 'task-1', to: 'task-2' },
      { from: 'task-2', to: 'task-3' },
    ],
  };
}

/** Valid LLM assessment response for testing. */
function makeValidAssessmentResult(): {
  assessment: string;
  confidence: number;
  suggestedAction: string;
} {
  return {
    assessment: 'Mission "Analyze market data" is progressing well. 2/4 tasks complete.',
    confidence: 0.75,
    suggestedAction: 'continue',
  };
}

/** Build a mock MissionHandle with requestCapability support. */
function makeMockHandle(overrides?: {
  requestCapability?: (input: CapabilityRequestInput) => Promise<CapabilityRequestOutput>;
  proposeTaskGraph?: (input: TaskGraphInput) => Promise<TaskGraphOutput>;
  respondCheckpoint?: (input: unknown) => Promise<CheckpointResponseOutput>;
}): MissionHandle {
  const noOp = () => Promise.reject(new Error('Not mocked'));
  return {
    id: makeMissionId('mission-test-001'),
    state: 'EXECUTING' as never,
    budget: { allocated: 50000, consumed: 0, remaining: 50000 },
    proposeTaskGraph: overrides?.proposeTaskGraph ?? (() => Promise.resolve({
      graphId: 'graph-1',
      planVersion: 1,
      taskCount: 4,
      validationWarnings: [],
    })),
    proposeTaskExecution: noOp,
    createArtifact: noOp,
    readArtifact: noOp,
    emitEvent: noOp,
    requestCapability: overrides?.requestCapability ?? noOp,
    requestBudget: noOp,
    submitResult: noOp,
    respondCheckpoint: overrides?.respondCheckpoint ?? (() => Promise.resolve({
      action: 'continue' as const,
      reason: 'Checkpoint accepted',
    })),
  } as MissionHandle;
}

/** Simple deterministic TimeProvider for testing. */
function makeTestClock(): TimeProvider {
  return {
    nowISO: () => '2026-03-23T12:00:00.000Z',
    nowMs: () => 1742731200000,
  };
}

// ============================================================================
// SD-02: LLM-Augmented Decomposition Tests (12+ tests)
// ============================================================================

describe('SD-02: LLM-augmented decomposition', () => {

  // ---- A21 SUCCESS PATH: LLM response accepted, used for decomposition ----

  it('llm-augmented strategy calls requestCapability for decomposition', async () => {
    let capabilityCallCount = 0;
    let capturedInput: CapabilityRequestInput | undefined;
    const mockHandle = makeMockHandle({
      requestCapability: async (input) => {
        capabilityCallCount++;
        capturedInput = input;
        return {
          result: makeValidDecomposeResult(),
          resourcesConsumed: { tokens: 500 },
        };
      },
    });
    const client = new SystemCallClient(mockHandle);
    const planner = new MissionPlanner(client, 'llm-augmented');
    const state = makeState();

    await planner.planMission(state);

    assert.equal(capabilityCallCount, 1, 'requestCapability called exactly once');
    assert.ok(capturedInput, 'Input was captured');
    assert.equal(capturedInput!.capabilityType, 'api_call', 'capabilityType is api_call');
    assert.equal(capturedInput!.missionId, state.missionId, 'missionId passed through');
  });

  it('llm-augmented returns valid TaskGraphInput from LLM response', async () => {
    const mockHandle = makeMockHandle({
      requestCapability: async () => ({
        result: makeValidDecomposeResult(),
        resourcesConsumed: { tokens: 500 },
      }),
    });
    const client = new SystemCallClient(mockHandle);
    const planner = new MissionPlanner(client, 'llm-augmented');
    const state = makeState();

    const { graphInput } = await planner.planMission(state);

    assert.equal(graphInput.tasks.length, 3, 'LLM returned 3 tasks');
    assert.equal(graphInput.tasks[0]!.id, 'task-1');
    assert.equal(graphInput.tasks[1]!.id, 'task-2');
    assert.equal(graphInput.tasks[2]!.id, 'task-3');
    assert.equal(graphInput.dependencies.length, 2, 'LLM returned 2 dependencies');
  });

  it('llm-augmented includes objectiveAlignment in result (I-24)', async () => {
    const mockHandle = makeMockHandle({
      requestCapability: async () => ({
        result: makeValidDecomposeResult(),
        resourcesConsumed: { tokens: 500 },
      }),
    });
    const client = new SystemCallClient(mockHandle);
    const planner = new MissionPlanner(client, 'llm-augmented');
    const state = makeState({ objective: 'Analyze drone delivery market' });

    const { graphInput } = await planner.planMission(state);

    assert.ok(graphInput.objectiveAlignment, 'objectiveAlignment is present');
    assert.ok(
      graphInput.objectiveAlignment.includes('Analyze drone delivery market'),
      'objectiveAlignment references the objective',
    );
  });

  it('llm-augmented tracks budget consumption from capability call', async () => {
    const mockHandle = makeMockHandle({
      requestCapability: async () => ({
        result: makeValidDecomposeResult(),
        resourcesConsumed: { tokens: 750 },
      }),
    });
    const client = new SystemCallClient(mockHandle);
    const planner = new MissionPlanner(client, 'llm-augmented');
    const state = makeState({ budgetConsumed: 1000 });

    await planner.planMission(state);

    assert.equal(state.budgetConsumed, 1750, 'Budget increased by 750 tokens from LLM call');
  });

  it('llm-augmented uses synthetic task ID for capability request', async () => {
    let capturedInput: CapabilityRequestInput | undefined;
    const mockHandle = makeMockHandle({
      requestCapability: async (input) => {
        capturedInput = input;
        return {
          result: makeValidDecomposeResult(),
          resourcesConsumed: { tokens: 100 },
        };
      },
    });
    const client = new SystemCallClient(mockHandle);
    const planner = new MissionPlanner(client, 'llm-augmented');
    const state = makeState({ missionId: makeMissionId('mission-abc-123') });

    await planner.planMission(state);

    assert.ok(capturedInput, 'Capability input captured');
    assert.equal(
      capturedInput!.taskId as string,
      'task-abc-123-llm-decompose',
      'Synthetic task ID follows naming convention',
    );
  });

  // ---- A21 REJECTION PATHS: Invalid LLM responses fall back to heuristic ----

  it('llm-augmented falls back to heuristic on requestCapability error (I-16)', async () => {
    const mockHandle = makeMockHandle({
      requestCapability: async () => {
        throw { code: 'SANDBOX_VIOLATION', message: 'Not allowed in sandbox' };
      },
    });
    const client = new SystemCallClient(mockHandle, 0); // 0 retries for fast test
    const planner = new MissionPlanner(client, 'llm-augmented');
    const state = makeState();

    const { graphInput } = await planner.planMission(state);

    // Heuristic always produces 4 tasks (research, analyze, synthesize, deliver)
    assert.equal(graphInput.tasks.length, 4, 'Fell back to heuristic (4 tasks)');
    assert.ok(graphInput.objectiveAlignment, 'objectiveAlignment present from heuristic');
  });

  it('llm-augmented falls back to heuristic on invalid response schema', async () => {
    const mockHandle = makeMockHandle({
      requestCapability: async () => ({
        result: { badKey: 'not a valid decompose response' },
        resourcesConsumed: { tokens: 200 },
      }),
    });
    const client = new SystemCallClient(mockHandle);
    const planner = new MissionPlanner(client, 'llm-augmented');
    const state = makeState();

    const { graphInput } = await planner.planMission(state);

    assert.equal(graphInput.tasks.length, 4, 'Fell back to heuristic (4 tasks)');
  });

  it('llm-augmented falls back to heuristic on empty tasks array', async () => {
    const mockHandle = makeMockHandle({
      requestCapability: async () => ({
        result: { tasks: [], dependencies: [] },
        resourcesConsumed: { tokens: 100 },
      }),
    });
    const client = new SystemCallClient(mockHandle);
    const planner = new MissionPlanner(client, 'llm-augmented');
    const state = makeState();

    const { graphInput } = await planner.planMission(state);

    assert.equal(graphInput.tasks.length, 4, 'Fell back to heuristic (empty tasks rejected)');
  });

  it('llm-augmented falls back to heuristic on negative estimatedTokens', async () => {
    const mockHandle = makeMockHandle({
      requestCapability: async () => ({
        result: {
          tasks: [{ id: 'task-1', description: 'Test', executionMode: 'stochastic', estimatedTokens: -100 }],
          dependencies: [],
        },
        resourcesConsumed: { tokens: 100 },
      }),
    });
    const client = new SystemCallClient(mockHandle);
    const planner = new MissionPlanner(client, 'llm-augmented');
    const state = makeState();

    const { graphInput } = await planner.planMission(state);

    assert.equal(graphInput.tasks.length, 4, 'Fell back to heuristic (negative tokens rejected)');
  });

  it('llm-augmented falls back to heuristic on dependency referencing non-existent task', async () => {
    const mockHandle = makeMockHandle({
      requestCapability: async () => ({
        result: {
          tasks: [
            { id: 'task-1', description: 'Research', executionMode: 'stochastic', estimatedTokens: 5000 },
          ],
          dependencies: [
            { from: 'task-1', to: 'task-999' }, // task-999 does not exist
          ],
        },
        resourcesConsumed: { tokens: 100 },
      }),
    });
    const client = new SystemCallClient(mockHandle);
    const planner = new MissionPlanner(client, 'llm-augmented');
    const state = makeState();

    const { graphInput } = await planner.planMission(state);

    assert.equal(graphInput.tasks.length, 4, 'Fell back to heuristic (phantom dependency rejected)');
  });

  it('llm-augmented falls back to heuristic on total estimated tokens exceeding budget', async () => {
    const mockHandle = makeMockHandle({
      requestCapability: async () => ({
        result: {
          tasks: [
            { id: 'task-1', description: 'Research', executionMode: 'stochastic', estimatedTokens: 30000 },
            { id: 'task-2', description: 'Analyze', executionMode: 'stochastic', estimatedTokens: 30000 },
          ],
          dependencies: [],
        },
        resourcesConsumed: { tokens: 100 },
      }),
    });
    const client = new SystemCallClient(mockHandle);
    const planner = new MissionPlanner(client, 'llm-augmented');
    // Budget remaining = 50000, but tasks total 60000
    const state = makeState({ budgetAllocated: 50000, budgetConsumed: 0 });

    const { graphInput } = await planner.planMission(state);

    assert.equal(graphInput.tasks.length, 4, 'Fell back to heuristic (budget exceeded)');
  });

  it('heuristic strategy never calls requestCapability', async () => {
    let capabilityCallCount = 0;
    const mockHandle = makeMockHandle({
      requestCapability: async () => {
        capabilityCallCount++;
        return { result: makeValidDecomposeResult(), resourcesConsumed: { tokens: 100 } };
      },
    });
    const client = new SystemCallClient(mockHandle);
    const planner = new MissionPlanner(client, 'heuristic');
    const state = makeState();

    await planner.planMission(state);

    assert.equal(capabilityCallCount, 0, 'requestCapability never called for heuristic strategy');
  });
});

// ============================================================================
// SD-02: Validation Function Tests
// ============================================================================

describe('SD-02: validateLlmDecomposeResponse', () => {

  it('accepts valid response with tasks and dependencies', () => {
    const result = validateLlmDecomposeResponse(makeValidDecomposeResult(), 50000);
    assert.ok(result !== null, 'Valid response accepted');
    assert.equal(result!.tasks.length, 3);
    assert.equal(result!.dependencies.length, 2);
  });

  it('rejects null result', () => {
    assert.equal(validateLlmDecomposeResponse(null, 50000), null);
  });

  it('rejects non-object result', () => {
    assert.equal(validateLlmDecomposeResponse('string', 50000), null);
  });

  it('rejects response with no tasks key', () => {
    assert.equal(validateLlmDecomposeResponse({ dependencies: [] }, 50000), null);
  });

  it('rejects response with empty tasks array', () => {
    assert.equal(validateLlmDecomposeResponse({ tasks: [], dependencies: [] }, 50000), null);
  });

  it('rejects task with empty id', () => {
    const r = { tasks: [{ id: '', description: 'X', executionMode: 'stochastic', estimatedTokens: 100 }], dependencies: [] };
    assert.equal(validateLlmDecomposeResponse(r, 50000), null);
  });

  it('rejects task with zero estimatedTokens', () => {
    const r = { tasks: [{ id: 't1', description: 'X', executionMode: 'stochastic', estimatedTokens: 0 }], dependencies: [] };
    assert.equal(validateLlmDecomposeResponse(r, 50000), null);
  });

  it('rejects task with invalid executionMode', () => {
    const r = { tasks: [{ id: 't1', description: 'X', executionMode: 'invalid', estimatedTokens: 100 }], dependencies: [] };
    assert.equal(validateLlmDecomposeResponse(r, 50000), null);
  });

  it('rejects when total estimatedTokens exceeds budget', () => {
    const r = {
      tasks: [{ id: 't1', description: 'X', executionMode: 'stochastic', estimatedTokens: 60000 }],
      dependencies: [],
    };
    assert.equal(validateLlmDecomposeResponse(r, 50000), null, 'Total exceeds budget');
  });

  it('rejects dependency referencing non-existent task', () => {
    const r = {
      tasks: [{ id: 't1', description: 'X', executionMode: 'stochastic', estimatedTokens: 100 }],
      dependencies: [{ from: 't1', to: 'nonexistent' }],
    };
    assert.equal(validateLlmDecomposeResponse(r, 50000), null);
  });
});

// ============================================================================
// SD-04: LLM-Preferred Assessment Tests (12+ tests)
// ============================================================================

describe('SD-04: LLM-preferred assessment', () => {

  // ---- A21 SUCCESS PATH: LLM assessment accepted, used for checkpoint ----

  it('llm-preferred mode calls requestCapability for assessment', async () => {
    let capabilityCallCount = 0;
    let capturedInput: CapabilityRequestInput | undefined;
    const mockHandle = makeMockHandle({
      requestCapability: async (input) => {
        capabilityCallCount++;
        capturedInput = input;
        return {
          result: makeValidAssessmentResult(),
          resourcesConsumed: { tokens: 300 },
        };
      },
    });
    const client = new SystemCallClient(mockHandle);
    const handler = new CheckpointHandler(client, 'llm-preferred', makeTestClock());
    const state = makeState({
      activeTaskIds: new Set(['t1', 't2']),
      completedTaskIds: new Set(['t3', 't4']),
    });

    await handler.handleCheckpoint('chk-1', 'PERIODIC', state);

    assert.equal(capabilityCallCount, 1, 'requestCapability called exactly once');
    assert.ok(capturedInput, 'Input was captured');
    assert.equal(capturedInput!.capabilityType, 'api_call');
    assert.equal(capturedInput!.missionId, state.missionId);
  });

  it('llm-preferred returns LLM-provided confidence and assessment', async () => {
    let capturedResponse: { assessment: string; confidence: number } | undefined;
    const mockHandle = makeMockHandle({
      requestCapability: async () => ({
        result: {
          assessment: 'Custom LLM assessment text for market analysis.',
          confidence: 0.82,
          suggestedAction: 'continue',
        },
        resourcesConsumed: { tokens: 200 },
      }),
      respondCheckpoint: async (input: unknown) => {
        const resp = input as { assessment: string; confidence: number };
        capturedResponse = resp;
        return { action: 'continue' as const, reason: 'Accepted' };
      },
    });
    const client = new SystemCallClient(mockHandle);
    const handler = new CheckpointHandler(client, 'llm-preferred', makeTestClock());
    const state = makeState({
      activeTaskIds: new Set(['t1']),
      completedTaskIds: new Set(['t2', 't3']),
    });

    await handler.handleCheckpoint('chk-2', 'PERIODIC', state);

    assert.ok(capturedResponse, 'Checkpoint response was captured');
    assert.equal(capturedResponse!.confidence, 0.82, 'LLM-provided confidence used');
    assert.ok(
      capturedResponse!.assessment.includes('Custom LLM assessment text'),
      'LLM-provided assessment used',
    );
  });

  it('llm-preferred tracks budget consumption from capability call', async () => {
    const mockHandle = makeMockHandle({
      requestCapability: async () => ({
        result: makeValidAssessmentResult(),
        resourcesConsumed: { tokens: 450 },
      }),
    });
    const client = new SystemCallClient(mockHandle);
    const handler = new CheckpointHandler(client, 'llm-preferred', makeTestClock());
    const state = makeState({
      budgetConsumed: 2000,
      activeTaskIds: new Set(['t1']),
      completedTaskIds: new Set(['t2']),
    });

    await handler.handleCheckpoint('chk-3', 'PERIODIC', state);

    assert.equal(state.budgetConsumed, 2450, 'Budget increased by 450 tokens from LLM assessment');
  });

  it('llm-preferred assessment includes mission objective (I-24)', async () => {
    let capturedInput: CapabilityRequestInput | undefined;
    const mockHandle = makeMockHandle({
      requestCapability: async (input) => {
        capturedInput = input;
        return {
          result: makeValidAssessmentResult(),
          resourcesConsumed: { tokens: 100 },
        };
      },
    });
    const client = new SystemCallClient(mockHandle);
    const handler = new CheckpointHandler(client, 'llm-preferred', makeTestClock());
    const state = makeState({ objective: 'Analyze SEA drone delivery market' });

    await handler.handleCheckpoint('chk-4', 'PERIODIC', state);

    assert.ok(capturedInput, 'Input captured');
    const params = capturedInput!.parameters as Record<string, unknown>;
    const prompt = params['prompt'] as string;
    assert.ok(
      prompt.includes('Analyze SEA drone delivery market'),
      'Prompt includes mission objective for I-24 goal anchoring',
    );
  });

  it('llm-preferred uses synthetic task ID for capability request', async () => {
    let capturedInput: CapabilityRequestInput | undefined;
    const mockHandle = makeMockHandle({
      requestCapability: async (input) => {
        capturedInput = input;
        return {
          result: makeValidAssessmentResult(),
          resourcesConsumed: { tokens: 100 },
        };
      },
    });
    const client = new SystemCallClient(mockHandle);
    const handler = new CheckpointHandler(client, 'llm-preferred', makeTestClock());
    const state = makeState({ missionId: makeMissionId('mission-xyz-789') });

    await handler.handleCheckpoint('chk-5', 'PERIODIC', state);

    assert.ok(capturedInput, 'Input captured');
    assert.equal(
      capturedInput!.taskId as string,
      'task-xyz-789-llm-assess',
      'Synthetic task ID for assessment follows naming convention',
    );
  });

  it('llm-preferred clamps confidence to [0, 1] range', async () => {
    let capturedResponse: { confidence: number } | undefined;
    const mockHandle = makeMockHandle({
      requestCapability: async () => ({
        result: {
          assessment: 'Over-confident assessment',
          confidence: 1.5, // Above 1.0 -- should be clamped
          suggestedAction: 'continue',
        },
        resourcesConsumed: { tokens: 100 },
      }),
      respondCheckpoint: async (input: unknown) => {
        capturedResponse = input as { confidence: number };
        return { action: 'continue' as const, reason: 'Accepted' };
      },
    });
    const client = new SystemCallClient(mockHandle);
    const handler = new CheckpointHandler(client, 'llm-preferred', makeTestClock());
    const state = makeState({ activeTaskIds: new Set(['t1']) });

    await handler.handleCheckpoint('chk-6', 'PERIODIC', state);

    assert.ok(capturedResponse, 'Response captured');
    assert.ok(capturedResponse!.confidence <= 1.0, 'Confidence clamped to at most 1.0');
    assert.equal(capturedResponse!.confidence, 1.0, 'Confidence clamped to exactly 1.0');
  });

  // ---- A21 REJECTION PATHS: LLM failures fall back to heuristic ----

  it('llm-preferred falls back to heuristic on requestCapability error (I-16)', async () => {
    let capturedResponse: { confidence: number; assessment: string } | undefined;
    const mockHandle = makeMockHandle({
      requestCapability: async () => {
        throw { code: 'CAPABILITY_DENIED', message: 'LLM access denied' };
      },
      respondCheckpoint: async (input: unknown) => {
        capturedResponse = input as { confidence: number; assessment: string };
        return { action: 'continue' as const, reason: 'Accepted' };
      },
    });
    const client = new SystemCallClient(mockHandle, 0); // 0 retries for fast test
    const handler = new CheckpointHandler(client, 'llm-preferred', makeTestClock());
    const state = makeState({
      activeTaskIds: new Set(['t1', 't2']),
      completedTaskIds: new Set(['t3']),
    });

    await handler.handleCheckpoint('chk-7', 'PERIODIC', state);

    // Heuristic assessment includes the objective (generateHeuristicAssessment pattern)
    assert.ok(capturedResponse, 'Response captured');
    assert.ok(
      capturedResponse!.assessment.includes(state.objective),
      'Fell back to heuristic assessment (includes objective)',
    );
    // Heuristic confidence should be a computed value, not the LLM value
    assert.ok(typeof capturedResponse!.confidence === 'number', 'Confidence is a number');
  });

  it('llm-preferred falls back to heuristic on invalid response schema', async () => {
    let capturedResponse: { assessment: string } | undefined;
    const mockHandle = makeMockHandle({
      requestCapability: async () => ({
        result: { invalid: 'not a valid assessment response' },
        resourcesConsumed: { tokens: 100 },
      }),
      respondCheckpoint: async (input: unknown) => {
        capturedResponse = input as { assessment: string };
        return { action: 'continue' as const, reason: 'Accepted' };
      },
    });
    const client = new SystemCallClient(mockHandle);
    const handler = new CheckpointHandler(client, 'llm-preferred', makeTestClock());
    const state = makeState({
      activeTaskIds: new Set(['t1']),
      completedTaskIds: new Set(['t2', 't3']),
    });

    await handler.handleCheckpoint('chk-8', 'PERIODIC', state);

    assert.ok(capturedResponse, 'Response captured');
    assert.ok(
      capturedResponse!.assessment.includes(state.objective),
      'Fell back to heuristic assessment',
    );
  });

  it('llm-preferred falls back to heuristic on missing assessment field', async () => {
    let capturedResponse: { assessment: string } | undefined;
    const mockHandle = makeMockHandle({
      requestCapability: async () => ({
        result: { confidence: 0.8, suggestedAction: 'continue' }, // missing assessment
        resourcesConsumed: { tokens: 100 },
      }),
      respondCheckpoint: async (input: unknown) => {
        capturedResponse = input as { assessment: string };
        return { action: 'continue' as const, reason: 'Accepted' };
      },
    });
    const client = new SystemCallClient(mockHandle);
    const handler = new CheckpointHandler(client, 'llm-preferred', makeTestClock());
    const state = makeState({ activeTaskIds: new Set(['t1']) });

    await handler.handleCheckpoint('chk-9', 'PERIODIC', state);

    assert.ok(capturedResponse, 'Response captured');
    assert.ok(
      capturedResponse!.assessment.includes(state.objective),
      'Fell back to heuristic (missing assessment field)',
    );
  });

  it('llm-preferred validates suggestedAction is valid enum value', async () => {
    let capturedResponse: { assessment: string } | undefined;
    const mockHandle = makeMockHandle({
      requestCapability: async () => ({
        result: {
          assessment: 'Some assessment',
          confidence: 0.7,
          suggestedAction: 'invalid_action', // Not a valid action
        },
        resourcesConsumed: { tokens: 100 },
      }),
      respondCheckpoint: async (input: unknown) => {
        capturedResponse = input as { assessment: string };
        return { action: 'continue' as const, reason: 'Accepted' };
      },
    });
    const client = new SystemCallClient(mockHandle);
    const handler = new CheckpointHandler(client, 'llm-preferred', makeTestClock());
    const state = makeState({ activeTaskIds: new Set(['t1']) });

    await handler.handleCheckpoint('chk-10', 'PERIODIC', state);

    assert.ok(capturedResponse, 'Response captured');
    assert.ok(
      capturedResponse!.assessment.includes(state.objective),
      'Fell back to heuristic (invalid suggestedAction)',
    );
  });

  it('heuristic mode never calls requestCapability', async () => {
    let capabilityCallCount = 0;
    const mockHandle = makeMockHandle({
      requestCapability: async () => {
        capabilityCallCount++;
        return { result: makeValidAssessmentResult(), resourcesConsumed: { tokens: 100 } };
      },
    });
    const client = new SystemCallClient(mockHandle);
    const handler = new CheckpointHandler(client, 'heuristic', makeTestClock());
    const state = makeState({
      activeTaskIds: new Set(['t1']),
      completedTaskIds: new Set(['t2']),
    });

    await handler.handleCheckpoint('chk-11', 'PERIODIC', state);

    assert.equal(capabilityCallCount, 0, 'requestCapability never called in heuristic mode');
  });

  it('llm-preferred confidence below threshold still triggers escalation (FM-16)', async () => {
    const mockHandle = makeMockHandle({
      requestCapability: async () => ({
        result: {
          assessment: 'Mission is struggling. Low confidence.',
          confidence: 0.3, // Below ESCALATION_CONFIDENCE_THRESHOLD (0.5)
          suggestedAction: 'continue', // LLM suggests continue, but FM-16 overrides
        },
        resourcesConsumed: { tokens: 100 },
      }),
      respondCheckpoint: async (input: unknown) => {
        const resp = input as { proposedAction: string; escalationReason?: string };
        assert.equal(resp.proposedAction, 'escalate', 'FM-16: low confidence forces escalation');
        assert.ok(resp.escalationReason, 'Escalation reason provided');
        return { action: 'escalated' as const, reason: 'Escalated due to low confidence' };
      },
    });
    const client = new SystemCallClient(mockHandle);
    const handler = new CheckpointHandler(client, 'llm-preferred', makeTestClock());
    const state = makeState({ activeTaskIds: new Set(['t1', 't2']) });

    const result = await handler.handleCheckpoint('chk-12', 'PERIODIC', state);

    assert.equal(result.action, 'escalated', 'System escalated the checkpoint');
  });
});

// ============================================================================
// SD-04: Validation Function Tests
// ============================================================================

describe('SD-04: validateLlmAssessmentResponse', () => {

  it('accepts valid response with all fields', () => {
    const result = validateLlmAssessmentResponse(makeValidAssessmentResult());
    assert.ok(result !== null);
    assert.equal(result!.confidence, 0.75);
    assert.equal(result!.suggestedAction, 'continue');
    assert.ok(result!.assessment.length > 0);
  });

  it('rejects null result', () => {
    assert.equal(validateLlmAssessmentResponse(null), null);
  });

  it('rejects non-object result', () => {
    assert.equal(validateLlmAssessmentResponse(42), null);
  });

  it('rejects result with empty assessment', () => {
    assert.equal(
      validateLlmAssessmentResponse({ assessment: '', confidence: 0.5, suggestedAction: 'continue' }),
      null,
    );
  });

  it('rejects result with non-number confidence', () => {
    assert.equal(
      validateLlmAssessmentResponse({ assessment: 'ok', confidence: 'high', suggestedAction: 'continue' }),
      null,
    );
  });

  it('rejects result with NaN confidence', () => {
    assert.equal(
      validateLlmAssessmentResponse({ assessment: 'ok', confidence: NaN, suggestedAction: 'continue' }),
      null,
    );
  });

  it('clamps confidence above 1.0 to 1.0', () => {
    const result = validateLlmAssessmentResponse({
      assessment: 'ok', confidence: 2.5, suggestedAction: 'continue',
    });
    assert.ok(result !== null);
    assert.equal(result!.confidence, 1.0);
  });

  it('clamps confidence below 0.0 to 0.0', () => {
    const result = validateLlmAssessmentResponse({
      assessment: 'ok', confidence: -0.5, suggestedAction: 'continue',
    });
    assert.ok(result !== null);
    assert.equal(result!.confidence, 0.0);
  });

  it('rejects invalid suggestedAction', () => {
    assert.equal(
      validateLlmAssessmentResponse({ assessment: 'ok', confidence: 0.5, suggestedAction: 'panic' }),
      null,
    );
  });

  it('accepts all valid suggestedActions', () => {
    for (const action of ['continue', 'replan', 'escalate', 'abort']) {
      const result = validateLlmAssessmentResponse({
        assessment: 'ok', confidence: 0.5, suggestedAction: action,
      });
      assert.ok(result !== null, `Action '${action}' accepted`);
      assert.equal(result!.suggestedAction, action);
    }
  });
});
