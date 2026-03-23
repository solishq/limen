/**
 * Mock LLM Gateway for pipeline determinism tests.
 * Spec ref: I-28 (Pipeline Determinism), I-25 (Deterministic Replay)
 *
 * Phase: Sprint 4 (Replay & Pipeline)
 *
 * Provides a minimal LlmGateway implementation that returns canned responses.
 * Used by pipeline integration tests to verify phase ordering without
 * requiring a real LLM provider.
 *
 * Design: Returns deterministic responses for both request() and requestStream().
 * All methods return Result<T> matching the LlmGateway contract.
 */

import type {
  LlmGateway, LlmRequest, LlmResponse, LlmStreamChunk,
  LlmProviderConfig, ProviderHealthSnapshot, FailoverBudgetCheck, FailoverPolicy,
} from '../../src/substrate/interfaces/substrate.js';
import type {
  DatabaseConnection, OperationContext, Result, MissionId,
} from '../../src/kernel/interfaces/index.js';

/**
 * Create a mock LLM gateway that returns canned responses.
 *
 * @param response - The content string to return (default: 'Mock LLM response')
 * @returns LlmGateway with deterministic behavior for testing
 */
export function createMockGateway(response?: string): LlmGateway {
  const content = response ?? 'Mock LLM response';

  const gateway: LlmGateway = {
    registerProvider(
      _conn: DatabaseConnection,
      _ctx: OperationContext,
      _config: LlmProviderConfig,
    ): Result<void> {
      return { ok: true, value: undefined };
    },

    async request(
      _conn: DatabaseConnection,
      _ctx: OperationContext,
      _request: LlmRequest,
    ): Promise<Result<LlmResponse>> {
      const llmResponse: LlmResponse = {
        content,
        toolCalls: [],
        finishReason: 'stop',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
        },
        model: 'mock-model',
        providerId: 'mock-provider',
        latencyMs: 1,
      };
      return { ok: true, value: llmResponse };
    },

    async requestStream(
      _conn: DatabaseConnection,
      _ctx: OperationContext,
      _request: LlmRequest,
    ): Promise<Result<AsyncIterable<LlmStreamChunk>>> {
      async function* generateChunks(): AsyncGenerator<LlmStreamChunk> {
        yield { type: 'content_delta', delta: content };
        yield { type: 'usage', inputTokens: 10, outputTokens: 5 };
        yield { type: 'done', finishReason: 'stop' };
      }

      return { ok: true, value: generateChunks() };
    },

    getProviderHealth(_conn: DatabaseConnection): Result<readonly ProviderHealthSnapshot[]> {
      const snapshot: ProviderHealthSnapshot = {
        providerId: 'mock-provider',
        status: 'healthy',
        consecutiveFailures: 0,
        errorRate5min: 0,
        avgLatencyMs: 1,
        totalRequests: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        cooldownUntil: null,
      };
      return { ok: true, value: [snapshot] };
    },

    hasHealthyProvider(_conn: DatabaseConnection): Result<boolean> {
      return { ok: true, value: true };
    },

    checkFailoverBudget(
      _conn: DatabaseConnection,
      _missionId: MissionId,
      _estimatedTokens: number,
      _failoverPolicy: FailoverPolicy,
    ): Result<FailoverBudgetCheck> {
      return { ok: true, value: { allowed: true } };
    },
  };

  return Object.freeze(gateway);
}
