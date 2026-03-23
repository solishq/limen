/**
 * Limen v1.0 — Phase 5 Sprint 5D: Integration Tests
 * Proves end-to-end composition: transport engine + real adapters + retry + circuit breaker + streaming + credential scrubbing.
 *
 * Spec ref: §25.4 (LLM Gateway), §27 (Streaming), I-01 (no SDK deps), I-04 (provider independence)
 * Security: C-SEC-P5-01/02 (credential scrubbing), C-SEC-P5-03 (Gemini URL scrub),
 *           C-SEC-P5-06 (response size), C-SEC-P5-15 (circuit breaker between retries),
 *           C-SEC-P5-19 (TLS enforcement), C-SEC-P5-20 (shutdown)
 * Design rules: CR-2 (retry bounds), CR-3 (streaming timeouts)
 * Amendments: A21 (rejection-path testing), A22 (wiring manifest)
 *
 * These are INTEGRATION tests — they prove COMPOSITION of real components working together.
 * Unit tests for individual components exist in Sprint 5A-5C contract tests.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Transport engine
import {
  createTransportEngine,
  TransportError,
} from '../../src/substrate/transport/transport_engine.js';

// Real adapters
import { createAnthropicAdapter } from '../../src/substrate/transport/adapters/anthropic_adapter.js';
import { createOllamaAdapter } from '../../src/substrate/transport/adapters/ollama_adapter.js';
import { createOpenAIAdapter } from '../../src/substrate/transport/adapters/openai_adapter.js';
import { createGeminiAdapter, scrubUrl } from '../../src/substrate/transport/adapters/gemini_adapter.js';

// Types
import type {
  TransportEngine,
  ProviderAdapter,
  TransportResult,
  TransportStreamResult,
  UpdateProviderHealthFn,
  IsCircuitOpenFn,
} from '../../src/substrate/transport/transport_types.js';
import type { TimeProvider } from '../../src/kernel/interfaces/time.js';
import type { LlmRequest, LlmStreamChunk } from '../../src/substrate/interfaces/substrate.js';

// ============================================================================
// Test Infrastructure
// ============================================================================

/** Save original fetch for restoration after each test */
const originalFetch = globalThis.fetch;

/** Deterministic clock for transport engine and adapters */
function createMockClock(startMs: number = 1_000_000): TimeProvider & { advance: (ms: number) => void } {
  let current = startMs;
  return {
    nowISO: () => new Date(current).toISOString(),
    nowMs: () => current,
    advance: (ms: number) => { current += ms; },
  };
}

/** Standard LlmRequest for testing */
function makeRequest(overrides?: Partial<LlmRequest>): LlmRequest {
  return {
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: 'Hello' }],
    maxTokens: 100,
    ...overrides,
  };
}

/** Create a ReadableStream from string chunks */
function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]!));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/** Mock Anthropic non-streaming JSON response */
function anthropicJsonResponse(text: string = 'Hello'): string {
  return JSON.stringify({
    id: 'msg_test_001',
    type: 'message',
    model: 'claude-sonnet-4-20250514',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  });
}

/** Mock OpenAI Chat Completions non-streaming JSON response */
function openaiJsonResponse(text: string = 'Hello'): string {
  return JSON.stringify({
    id: 'chatcmpl-test_001',
    model: 'gpt-4',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: text },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
}

/** Mock Ollama non-streaming JSON response */
function ollamaJsonResponse(text: string = 'Hello'): string {
  return JSON.stringify({
    model: 'llama3',
    message: { role: 'assistant', content: text },
    done: true,
    prompt_eval_count: 10,
    eval_count: 5,
  });
}

/** Mock Gemini non-streaming JSON response */
function geminiJsonResponse(text: string = 'Hello'): string {
  return JSON.stringify({
    candidates: [{
      content: { parts: [{ text }] },
      finishReason: 'STOP',
    }],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
    },
  });
}

/** Anthropic SSE events for streaming */
function anthropicSSEEvents(): string[] {
  return [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" World"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
  ];
}

/** Ollama NDJSON lines for streaming */
function ollamaNDJSONLines(): string[] {
  return [
    '{"model":"llama3","message":{"role":"assistant","content":"Hello"},"done":false}\n',
    '{"model":"llama3","message":{"role":"assistant","content":" World"},"done":false}\n',
    '{"model":"llama3","message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":10,"eval_count":5}\n',
  ];
}

// ============================================================================
// 1. Transport Engine <-> Adapter Dispatch (Cross-Provider)
// ============================================================================

describe('Sprint 5D Integration: Transport Engine <-> Adapter Dispatch', () => {
  let clock: ReturnType<typeof createMockClock>;
  let healthUpdates: Array<{ providerId: string; success: boolean; latencyMs: number; errorMsg?: string }>;
  let engine: TransportEngine;

  beforeEach(() => {
    clock = createMockClock();
    healthUpdates = [];
    engine = createTransportEngine({
      time: clock,
      updateHealth: (providerId, success, latencyMs, errorMsg) => {
        healthUpdates.push({ providerId, success, latencyMs, errorMsg });
      },
      isCircuitOpen: () => false,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // INT-001: Non-streaming execute()
  it('INT-001 success: engine delegates to adapter.buildRequest()/parseResponse() for non-streaming', async () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key-001', clock);
    const responseBody = anthropicJsonResponse('Integration test');

    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBodyStr = '';

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      capturedUrl = url;
      capturedHeaders = Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([k, v]) => [k, String(v)])
      );
      capturedBodyStr = typeof init?.body === 'string' ? init.body : '';

      return new Response(responseBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await engine.execute(adapter, { request: makeRequest() });

    // Verify adapter.buildRequest() was called — URL and headers from Anthropic adapter
    assert.equal(capturedUrl, 'https://api.anthropic.com/v1/messages');
    assert.equal(capturedHeaders['x-api-key'], 'test-key-001');
    assert.equal(capturedHeaders['content-type'], 'application/json');

    // Verify adapter.parseResponse() was called — response parsed correctly
    assert.equal(result.response.content, 'Integration test');
    assert.equal(result.response.usage.inputTokens, 10);
    assert.equal(result.response.usage.outputTokens, 5);
    assert.equal(result.response.finishReason, 'stop');

    // Verify buildRequest() body was passed to fetch
    const parsedBody = JSON.parse(capturedBodyStr);
    assert.equal(parsedBody.model, 'claude-sonnet-4-20250514');
    assert.equal(parsedBody.max_tokens, 100);

    // C-1 FIX: Verify non-streaming request does NOT include stream:true
    // Kills M7 mutation (swap buildRequest(req, false) to buildRequest(req, true))
    assert.equal(parsedBody.stream, undefined, 'Non-streaming request must not include stream:true');

    // Verify health was updated on success
    assert.equal(healthUpdates.length, 1);
    assert.equal(healthUpdates[0]!.providerId, 'anthropic');
    assert.equal(healthUpdates[0]!.success, true);
  });

  // INT-002: Streaming executeStream()
  it('INT-002 success: engine delegates to adapter.buildRequest()/parseStream() for streaming', async () => {
    const adapter = createAnthropicAdapter('anthropic-stream', 'https://api.anthropic.com', 'test-key-002', clock);
    const sseData = anthropicSSEEvents().join('');

    let capturedUrl = '';
    globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      capturedUrl = url;
      return new Response(createMockStream([sseData]), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };

    const streamResult = await engine.executeStream(adapter, { request: makeRequest() });

    // Verify adapter.buildRequest() was called with streaming=true — URL matches
    assert.equal(capturedUrl, 'https://api.anthropic.com/v1/messages');

    // Consume stream
    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of streamResult.stream) {
      chunks.push(chunk);
    }

    // Verify adapter.parseStream() produced correct chunks
    const contentChunks = chunks.filter(c => c.type === 'content_delta');
    assert.ok(contentChunks.length >= 1, 'Expected at least one content_delta chunk');
    const textParts = contentChunks.map(c => (c as { type: 'content_delta'; delta: string }).delta);
    assert.ok(textParts.includes('Hello'), 'Expected "Hello" in content deltas');

    // Verify done chunk emitted
    const doneChunks = chunks.filter(c => c.type === 'done');
    assert.equal(doneChunks.length, 1);
    assert.equal((doneChunks[0] as { type: 'done'; finishReason: string }).finishReason, 'stop');

    // Verify usage chunk
    const usageChunks = chunks.filter(c => c.type === 'usage');
    assert.ok(usageChunks.length >= 1, 'Expected at least one usage chunk');
  });

  // INT-003: Adapter selection — multiple adapters dispatched by providerId
  it('INT-003 success: different adapters produce different request formats for the same engine', async () => {
    const anthropicAdapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'key-a', clock);
    const openaiAdapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'key-o', 'gpt-4', clock);

    const capturedRequests: Array<{ url: string; headers: Record<string, string> }> = [];

    // First call: Anthropic
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      capturedRequests.push({
        url,
        headers: init?.headers as Record<string, string>,
      });
      return new Response(anthropicJsonResponse(), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await engine.execute(anthropicAdapter, { request: makeRequest() });

    // Second call: OpenAI
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      capturedRequests.push({
        url,
        headers: init?.headers as Record<string, string>,
      });
      return new Response(openaiJsonResponse(), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await engine.execute(openaiAdapter, { request: makeRequest({ model: 'gpt-4' }) });

    // Verify different URLs — Anthropic uses /v1/messages, OpenAI uses /v1/chat/completions
    assert.equal(capturedRequests.length, 2);
    assert.ok(capturedRequests[0]!.url.includes('/v1/messages'), 'Anthropic URL should contain /v1/messages');
    assert.ok(capturedRequests[1]!.url.includes('/v1/chat/completions'), 'OpenAI URL should contain /v1/chat/completions');

    // Verify different auth headers — Anthropic uses x-api-key, OpenAI uses Authorization: Bearer
    assert.equal(capturedRequests[0]!.headers['x-api-key'], 'key-a');
    assert.equal(capturedRequests[1]!.headers['authorization'], 'Bearer key-o');
  });
});

// ============================================================================
// 2. Retry Integration
// ============================================================================

describe('Sprint 5D Integration: Retry End-to-End', () => {
  let clock: ReturnType<typeof createMockClock>;
  let engine: TransportEngine;

  beforeEach(() => {
    clock = createMockClock();
    engine = createTransportEngine({
      time: clock,
      updateHealth: () => {},
      isCircuitOpen: () => false,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // INT-004: Non-streaming retry with Retry-After
  it('INT-004 success: 429 with Retry-After:1 retries and succeeds on second attempt', async () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key-retry', clock);
    let attemptCount = 0;

    globalThis.fetch = async (): Promise<Response> => {
      attemptCount++;
      if (attemptCount === 1) {
        // First attempt: 429 Too Many Requests with Retry-After: 1
        return new Response('Rate limited', {
          status: 429,
          headers: { 'retry-after': '1' },
        });
      }
      // Second attempt: success
      return new Response(anthropicJsonResponse('Retry succeeded'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await engine.execute(adapter, { request: makeRequest() });

    assert.equal(attemptCount, 2, 'Should have made exactly 2 attempts');
    assert.equal(result.retryCount, 1, 'retryCount should be 1');
    assert.equal(result.response.content, 'Retry succeeded');
  });

  // INT-005: Max retry exhaustion
  it('INT-005 rejection: 3 consecutive 503s exhausts retries with TRANSPORT_RETRY_EXHAUSTED', async () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key-exhaust', clock);
    let attemptCount = 0;

    globalThis.fetch = async (): Promise<Response> => {
      attemptCount++;
      return new Response('Service Unavailable', {
        status: 503,
      });
    };

    await assert.rejects(
      () => engine.execute(adapter, { request: makeRequest() }),
      (error: unknown) => {
        assert.ok(error instanceof TransportError, 'Should be TransportError');
        assert.equal(error.code, 'TRANSPORT_RETRY_EXHAUSTED');
        return true;
      },
    );

    assert.equal(attemptCount, 3, 'Should have made 3 attempts (1 + 2 retries)');
  });

  // INT-006: Retry-After >60s hard error
  it('INT-006 rejection: Retry-After >60s yields TRANSPORT_RETRY_AFTER_TOO_LONG immediately', async () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key-long', clock);
    let attemptCount = 0;

    globalThis.fetch = async (): Promise<Response> => {
      attemptCount++;
      return new Response('Rate limited', {
        status: 429,
        headers: { 'retry-after': '120' }, // 120 seconds > 60s cap
      });
    };

    await assert.rejects(
      () => engine.execute(adapter, { request: makeRequest() }),
      (error: unknown) => {
        assert.ok(error instanceof TransportError, 'Should be TransportError');
        assert.equal(error.code, 'TRANSPORT_RETRY_AFTER_TOO_LONG');
        return true;
      },
    );

    // Should not retry — hard error on first attempt
    assert.equal(attemptCount, 1, 'Should NOT retry after Retry-After too long');
  });
});

// ============================================================================
// 3. Circuit Breaker Integration
// ============================================================================

describe('Sprint 5D Integration: Circuit Breaker', () => {
  let clock: ReturnType<typeof createMockClock>;

  beforeEach(() => {
    clock = createMockClock();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // INT-007: Circuit open -> TRANSPORT_CIRCUIT_OPEN before any fetch
  it('INT-007 rejection: circuit open blocks request before fetch is called', async () => {
    let fetchCalled = false;
    globalThis.fetch = async (): Promise<Response> => {
      fetchCalled = true;
      return new Response('Should not reach', { status: 200 });
    };

    const engine = createTransportEngine({
      time: clock,
      updateHealth: () => {},
      isCircuitOpen: (_providerId: string) => true, // Always open
    });

    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key-cb', clock);

    await assert.rejects(
      () => engine.execute(adapter, { request: makeRequest() }),
      (error: unknown) => {
        assert.ok(error instanceof TransportError, 'Should be TransportError');
        assert.equal(error.code, 'TRANSPORT_CIRCUIT_OPEN');
        return true;
      },
    );

    assert.equal(fetchCalled, false, 'fetch() should NOT be called when circuit is open');
  });

  // INT-008: Circuit open checked BETWEEN retries (C-SEC-P5-15)
  it('INT-008 rejection: circuit opens between retry attempts, blocks subsequent attempt', async () => {
    let attemptCount = 0;
    let circuitState = false; // Starts closed

    globalThis.fetch = async (): Promise<Response> => {
      attemptCount++;
      // After first attempt fails with retryable error, open the circuit
      circuitState = true;
      return new Response('Service Unavailable', {
        status: 503,
      });
    };

    const engine = createTransportEngine({
      time: clock,
      updateHealth: () => {},
      isCircuitOpen: (_providerId: string) => circuitState,
    });

    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key-cb2', clock);

    await assert.rejects(
      () => engine.execute(adapter, { request: makeRequest() }),
      (error: unknown) => {
        assert.ok(error instanceof TransportError, 'Should be TransportError');
        assert.equal(error.code, 'TRANSPORT_CIRCUIT_OPEN', 'Should be CIRCUIT_OPEN, not RETRY_EXHAUSTED');
        return true;
      },
    );

    // Only 1 fetch call — circuit opened before second attempt
    assert.equal(attemptCount, 1, 'Only 1 attempt should be made before circuit breaker blocks');
  });
});

// ============================================================================
// 4. Streaming Integration
// ============================================================================

describe('Sprint 5D Integration: Streaming End-to-End', () => {
  let clock: ReturnType<typeof createMockClock>;
  let engine: TransportEngine;

  beforeEach(() => {
    clock = createMockClock();
    engine = createTransportEngine({
      time: clock,
      updateHealth: () => {},
      isCircuitOpen: () => false,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // INT-009: Streaming with Anthropic adapter — SSE events
  it('INT-009 success: Anthropic SSE events parsed, content_delta + usage + done emitted', async () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key-stream', clock);
    const sseEvents = anthropicSSEEvents();

    globalThis.fetch = async (): Promise<Response> => {
      return new Response(createMockStream(sseEvents), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };

    const streamResult = await engine.executeStream(adapter, { request: makeRequest() });

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of streamResult.stream) {
      chunks.push(chunk);
    }

    // Verify content_delta chunks
    const contentChunks = chunks.filter(c => c.type === 'content_delta') as Array<{ type: 'content_delta'; delta: string }>;
    assert.ok(contentChunks.length >= 2, `Expected at least 2 content_delta chunks, got ${contentChunks.length}`);
    assert.equal(contentChunks[0]!.delta, 'Hello');
    assert.equal(contentChunks[1]!.delta, ' World');

    // Verify usage chunks (message_start + message_delta)
    const usageChunks = chunks.filter(c => c.type === 'usage') as Array<{ type: 'usage'; inputTokens: number; outputTokens: number }>;
    assert.ok(usageChunks.length >= 1, 'Expected at least one usage chunk');
    // message_start provides input tokens
    const inputUsage = usageChunks.find(u => u.inputTokens > 0);
    assert.ok(inputUsage, 'Expected a usage chunk with inputTokens > 0');
    assert.equal(inputUsage!.inputTokens, 10);

    // Verify done chunk
    const doneChunks = chunks.filter(c => c.type === 'done') as Array<{ type: 'done'; finishReason: string }>;
    assert.equal(doneChunks.length, 1, 'Expected exactly 1 done chunk');
    assert.equal(doneChunks[0]!.finishReason, 'stop');
  });

  // INT-010: Streaming with Ollama adapter — NDJSON events
  it('INT-010 success: Ollama NDJSON events parsed, content + done emitted', async () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434', clock);
    const ndLines = ollamaNDJSONLines();

    globalThis.fetch = async (): Promise<Response> => {
      return new Response(createMockStream(ndLines), {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      });
    };

    const streamResult = await engine.executeStream(adapter, { request: makeRequest({ model: 'llama3' }) });

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of streamResult.stream) {
      chunks.push(chunk);
    }

    // Verify content_delta chunks from Ollama
    const contentChunks = chunks.filter(c => c.type === 'content_delta') as Array<{ type: 'content_delta'; delta: string }>;
    assert.ok(contentChunks.length >= 2, `Expected at least 2 content_delta chunks, got ${contentChunks.length}`);
    assert.equal(contentChunks[0]!.delta, 'Hello');
    assert.equal(contentChunks[1]!.delta, ' World');

    // Verify done chunk
    const doneChunks = chunks.filter(c => c.type === 'done') as Array<{ type: 'done'; finishReason: string }>;
    assert.equal(doneChunks.length, 1, 'Expected exactly 1 done chunk');
    assert.equal(doneChunks[0]!.finishReason, 'stop');

    // Verify usage from final NDJSON line
    const usageChunks = chunks.filter(c => c.type === 'usage') as Array<{ type: 'usage'; inputTokens: number; outputTokens: number }>;
    assert.ok(usageChunks.length >= 1, 'Expected at least one usage chunk');
    assert.equal(usageChunks[0]!.inputTokens, 10);
    assert.equal(usageChunks[0]!.outputTokens, 5);
  });

  // INT-011: Stream deliberation recorded after completion
  it('INT-011 success: getDeliberation() returns metrics after stream completes', async () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key-delib', clock);
    const sseEvents = anthropicSSEEvents();

    globalThis.fetch = async (): Promise<Response> => {
      return new Response(createMockStream(sseEvents), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };

    const streamResult = await engine.executeStream(adapter, { request: makeRequest() });

    // Consume stream fully
    for await (const _chunk of streamResult.stream) {
      // drain
    }

    // After stream completes, getDeliberation() should return metrics
    const deliberation = streamResult.getDeliberation();
    assert.equal(typeof deliberation.deliberationTokens, 'number');
    assert.ok(
      deliberation.accountingMode === 'estimated' || deliberation.accountingMode === 'provider_authoritative',
      'accountingMode should be estimated or provider_authoritative',
    );

    // No thinking blocks in our SSE events → estimated mode, 0 tokens
    assert.equal(deliberation.accountingMode, 'estimated');
    assert.equal(deliberation.deliberationTokens, 0);
    assert.equal(deliberation.providerReportedThinkingTokens, null);
  });
});

// ============================================================================
// 5. Credential Scrubbing Audit (AS-1, AS-4)
// ============================================================================

describe('Sprint 5D Integration: Credential Scrubbing', () => {
  let clock: ReturnType<typeof createMockClock>;

  beforeEach(() => {
    clock = createMockClock();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // INT-012: API key NEVER appears in TransportError messages — all error paths
  it('INT-012 rejection: API key never in error messages across all error paths', async () => {
    const apiKey = 'sk-super-secret-key-12345';
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', apiKey, clock);

    // Test error paths that the transport engine can produce
    const errorCodes: string[] = [];

    // TRANSPORT_PROVIDER_ERROR (non-retryable 401)
    {
      globalThis.fetch = async (): Promise<Response> => {
        return new Response('Unauthorized', { status: 401 });
      };
      const engine = createTransportEngine({ time: clock, isCircuitOpen: () => false });
      try {
        await engine.execute(adapter, { request: makeRequest() });
      } catch (e) {
        const err = e as TransportError;
        errorCodes.push(err.code);
        assert.ok(!err.message.includes(apiKey), `TRANSPORT_PROVIDER_ERROR message must not contain API key: ${err.message}`);
      }
    }

    // TRANSPORT_CIRCUIT_OPEN
    {
      const engine = createTransportEngine({ time: clock, isCircuitOpen: () => true });
      try {
        await engine.execute(adapter, { request: makeRequest() });
      } catch (e) {
        const err = e as TransportError;
        errorCodes.push(err.code);
        assert.ok(!err.message.includes(apiKey), `TRANSPORT_CIRCUIT_OPEN message must not contain API key: ${err.message}`);
      }
    }

    // TRANSPORT_RETRY_EXHAUSTED (3x 503)
    {
      globalThis.fetch = async (): Promise<Response> => {
        return new Response('Service Unavailable', { status: 503 });
      };
      const engine = createTransportEngine({ time: clock, isCircuitOpen: () => false });
      try {
        await engine.execute(adapter, { request: makeRequest() });
      } catch (e) {
        const err = e as TransportError;
        errorCodes.push(err.code);
        assert.ok(!err.message.includes(apiKey), `TRANSPORT_RETRY_EXHAUSTED message must not contain API key: ${err.message}`);
      }
    }

    // TRANSPORT_TLS_REQUIRED (http:// non-local)
    {
      const httpAdapter = createAnthropicAdapter('anthropic-http', 'http://external.example.com', apiKey, clock);
      const engine = createTransportEngine({ time: clock, isCircuitOpen: () => false });
      try {
        await engine.execute(httpAdapter, { request: makeRequest() });
      } catch (e) {
        const err = e as TransportError;
        errorCodes.push(err.code);
        assert.ok(!err.message.includes(apiKey), `TRANSPORT_TLS_REQUIRED message must not contain API key: ${err.message}`);
      }
    }

    // TRANSPORT_RETRY_AFTER_TOO_LONG
    {
      globalThis.fetch = async (): Promise<Response> => {
        return new Response('Rate limited', { status: 429, headers: { 'retry-after': '300' } });
      };
      const engine = createTransportEngine({ time: clock, isCircuitOpen: () => false });
      try {
        await engine.execute(adapter, { request: makeRequest() });
      } catch (e) {
        const err = e as TransportError;
        errorCodes.push(err.code);
        assert.ok(!err.message.includes(apiKey), `TRANSPORT_RETRY_AFTER_TOO_LONG message must not contain API key: ${err.message}`);
      }
    }

    // TRANSPORT_RESPONSE_TOO_LARGE
    {
      globalThis.fetch = async (): Promise<Response> => {
        return new Response('OK', {
          status: 200,
          headers: { 'content-length': '20000000', 'content-type': 'application/json' },
        });
      };
      const engine = createTransportEngine({ time: clock, isCircuitOpen: () => false });
      try {
        await engine.execute(adapter, { request: makeRequest() });
      } catch (e) {
        const err = e as TransportError;
        errorCodes.push(err.code);
        assert.ok(!err.message.includes(apiKey), `TRANSPORT_RESPONSE_TOO_LARGE message must not contain API key: ${err.message}`);
      }
    }

    // Verify we actually tested all these error codes
    assert.ok(errorCodes.includes('TRANSPORT_PROVIDER_ERROR'), 'Must test TRANSPORT_PROVIDER_ERROR');
    assert.ok(errorCodes.includes('TRANSPORT_CIRCUIT_OPEN'), 'Must test TRANSPORT_CIRCUIT_OPEN');
    assert.ok(errorCodes.includes('TRANSPORT_RETRY_EXHAUSTED'), 'Must test TRANSPORT_RETRY_EXHAUSTED');
    assert.ok(errorCodes.includes('TRANSPORT_TLS_REQUIRED'), 'Must test TRANSPORT_TLS_REQUIRED');
    assert.ok(errorCodes.includes('TRANSPORT_RETRY_AFTER_TOO_LONG'), 'Must test TRANSPORT_RETRY_AFTER_TOO_LONG');
    assert.ok(errorCodes.includes('TRANSPORT_RESPONSE_TOO_LARGE'), 'Must test TRANSPORT_RESPONSE_TOO_LARGE');
  });

  // INT-012b: Gemini adapter — API key in URL query string must not leak via TLS error
  // C-2 FIX: Kills M11 mutation (adding URL to TRANSPORT_TLS_REQUIRED error message)
  // Gemini puts key in ?key=xxx, so if the error message includes the URL, the key leaks
  it('INT-012b rejection: Gemini API key not leaked via TLS error message when key is in URL', async () => {
    const geminiKey = 'AIzaSyTestKeyForLeakDetection123';
    const adapter = createGeminiAdapter('gemini', 'http://external.example.com', geminiKey, clock);
    const engine = createTransportEngine({ time: clock, isCircuitOpen: () => false });

    // This should fail with TRANSPORT_TLS_REQUIRED because the URL is non-local http://
    try {
      await engine.execute(adapter, { request: makeRequest({ model: 'gemini-pro' }) });
      assert.fail('Expected TRANSPORT_TLS_REQUIRED error');
    } catch (e) {
      const err = e as { code?: string; message?: string };
      assert.equal(err.code, 'TRANSPORT_TLS_REQUIRED');
      // Key must NOT appear in any error field
      assert.ok(!err.message?.includes(geminiKey), `API key "${geminiKey}" must not appear in error message, got: ${err.message}`);
      assert.ok(!String(e).includes(geminiKey), `API key must not appear in stringified error`);
    }
  });

  // INT-013: API key NEVER in error messages from adapter.buildRequest() failures
  it('INT-013 rejection: adapter buildRequest() errors do not leak API key', () => {
    const apiKey = 'sk-anthropic-secret-key-xyz';
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', apiKey, clock);

    // buildRequest with minimal request — should not throw but if it did, key must not leak
    // Test that the request object produced by buildRequest does NOT expose the key in error-relevant fields
    const httpReq = adapter.buildRequest(makeRequest(), false);

    // The key IS in the headers (that's correct for auth) but should NOT appear in any
    // field that would be used in error messages (url, body)
    assert.ok(!httpReq.url.includes(apiKey), 'URL must not contain API key');
    assert.ok(!JSON.stringify(httpReq.body).includes(apiKey), 'Body must not contain API key');
  });

  // INT-014: Gemini scrubUrl() removes key from all URLs before they reach error messages
  it('INT-014 success: Gemini scrubUrl removes API key from URL', () => {
    const apiKey = 'AIzaSyTestKey12345';
    const adapter = createGeminiAdapter('gemini', 'https://generativelanguage.googleapis.com', apiKey, clock);

    // Build a request — key will be in the URL query string
    const httpReq = adapter.buildRequest(makeRequest({ model: 'gemini-pro' }), false);

    // Verify key IS in the URL (correct for Gemini auth)
    assert.ok(httpReq.url.includes(apiKey), 'Gemini URL should contain API key for auth');

    // Verify scrubUrl() removes it
    const scrubbed = scrubUrl(httpReq.url);
    assert.ok(!scrubbed.includes(apiKey), 'scrubUrl() must remove API key from URL');
    assert.ok(scrubbed.includes('[REDACTED]'), 'scrubUrl() must replace key with [REDACTED]');
  });

  // INT-014 rejection: scrubUrl on streaming URL also works
  it('INT-014 rejection: Gemini scrubUrl works on streaming URL with alt=sse parameter', () => {
    const apiKey = 'AIzaSyStreamKey999';
    const adapter = createGeminiAdapter('gemini', 'https://generativelanguage.googleapis.com', apiKey, clock);

    const httpReq = adapter.buildRequest(makeRequest({ model: 'gemini-pro' }), true);

    // Streaming URL has ?key=xxx&alt=sse
    assert.ok(httpReq.url.includes(apiKey), 'Streaming Gemini URL should contain API key');
    assert.ok(httpReq.url.includes('alt=sse'), 'Streaming Gemini URL should contain alt=sse');

    const scrubbed = scrubUrl(httpReq.url);
    assert.ok(!scrubbed.includes(apiKey), 'scrubUrl() must remove API key from streaming URL');
    assert.ok(scrubbed.includes('alt=sse'), 'scrubUrl() must preserve alt=sse parameter');
  });
});

// ============================================================================
// 6. Gateway -> Transport -> Deliberation Recording
// ============================================================================

describe('Sprint 5D Integration: Gateway -> Transport -> Deliberation', () => {
  let clock: ReturnType<typeof createMockClock>;

  beforeEach(() => {
    clock = createMockClock();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // INT-015: Gateway.request() with transport -> calls transport.execute() -> records deliberation
  it('INT-015 success: Gateway delegates to transport engine, deliberation recorded', async () => {
    // This test requires a database. We use the test helper.
    const { createTestDatabase, createTestOperationContext, createTestAuditTrail } = await import('../helpers/test_database.js');
    const db = createTestDatabase();
    const ctx = createTestOperationContext();
    const audit = createTestAuditTrail(db);

    // Import the gateway
    const { createLlmGateway } = await import('../../src/substrate/gateway/llm_gateway.js');

    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key-gw', clock);

    globalThis.fetch = async (): Promise<Response> => {
      return new Response(anthropicJsonResponse('Gateway test'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const engine = createTransportEngine({
      time: clock,
      updateHealth: () => {},
      isCircuitOpen: () => false,
    });

    const adaptersMap = new Map<string, ProviderAdapter>();
    adaptersMap.set('anthropic', adapter);

    const gateway = createLlmGateway(audit, undefined, clock, {
      engine,
      adapters: adaptersMap,
    });

    // Register provider so the gateway can route to it
    gateway.registerProvider(db, ctx, {
      providerId: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: ['claude-sonnet-4-20250514'],
      capabilities: ['text'],
      costPerInputToken: 0.003,
      costPerOutputToken: 0.015,
    });

    const result = await gateway.request(db, ctx, makeRequest());

    assert.equal(result.ok, true, `Gateway request should succeed, got: ${result.ok === false ? result.error.message : 'ok'}`);
    if (result.ok) {
      assert.equal(result.value.content, 'Gateway test');
      assert.equal(result.value.usage.inputTokens, 10);
      assert.equal(result.value.usage.outputTokens, 5);

      // Verify deliberation was recorded in the database
      const logRow = db.get<{ deliberation_tokens: number | null }>(
        'SELECT deliberation_tokens FROM core_llm_request_log ORDER BY rowid DESC LIMIT 1',
      );
      assert.ok(logRow, 'Should have a request log row');
      assert.equal(typeof logRow!.deliberation_tokens, 'number', 'deliberation_tokens should be recorded');
    }
  });

  // INT-016: Gateway.requestStream() with transport -> deliberation recorded
  it('INT-016 success: Gateway streaming delegates to transport engine, deliberation available', async () => {
    const { createTestDatabase, createTestOperationContext, createTestAuditTrail } = await import('../helpers/test_database.js');
    const db = createTestDatabase();
    const ctx = createTestOperationContext();
    const audit = createTestAuditTrail(db);

    const { createLlmGateway } = await import('../../src/substrate/gateway/llm_gateway.js');

    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key-gws', clock);
    const sseEvents = anthropicSSEEvents();

    globalThis.fetch = async (): Promise<Response> => {
      return new Response(createMockStream(sseEvents), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };

    const engine = createTransportEngine({
      time: clock,
      updateHealth: () => {},
      isCircuitOpen: () => false,
    });

    const adaptersMap = new Map<string, ProviderAdapter>();
    adaptersMap.set('anthropic', adapter);

    const gateway = createLlmGateway(audit, undefined, clock, {
      engine,
      adapters: adaptersMap,
    });

    gateway.registerProvider(db, ctx, {
      providerId: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: ['claude-sonnet-4-20250514'],
      capabilities: ['text'],
      costPerInputToken: 0.003,
      costPerOutputToken: 0.015,
    });

    const result = await gateway.requestStream(db, ctx, makeRequest());

    assert.equal(result.ok, true, `Gateway stream request should succeed, got: ${result.ok === false ? result.error.message : 'ok'}`);
    if (result.ok) {
      // Consume stream
      const chunks: LlmStreamChunk[] = [];
      for await (const chunk of result.value) {
        chunks.push(chunk);
      }

      // Should have content
      const contentChunks = chunks.filter(c => c.type === 'content_delta');
      assert.ok(contentChunks.length >= 1, 'Expected at least one content_delta from gateway streaming');

      // Deliberation is recorded in the finally block of the wrapped stream
      // After consuming, check the database
      const logRow = db.get<{ deliberation_tokens: number | null }>(
        'SELECT deliberation_tokens FROM core_llm_request_log ORDER BY rowid DESC LIMIT 1',
      );
      assert.ok(logRow, 'Should have a request log row after streaming');
      assert.equal(typeof logRow!.deliberation_tokens, 'number', 'deliberation_tokens should be recorded after stream');
    }
  });
});

// ============================================================================
// 7. Shutdown Integration
// ============================================================================

describe('Sprint 5D Integration: Shutdown', () => {
  let clock: ReturnType<typeof createMockClock>;

  beforeEach(() => {
    clock = createMockClock();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // INT-017: engine.shutdown() aborts in-flight requests
  it('INT-017 rejection: shutdown aborts in-flight request with GATEWAY_SHUTTING_DOWN', async () => {
    const engine = createTransportEngine({
      time: clock,
      updateHealth: () => {},
      isCircuitOpen: () => false,
    });

    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key-shut', clock);

    // Fetch that hangs until abort
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      // Wait for abort signal
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
        // Never resolves naturally — waits for abort
      });
    };

    // Start request (don't await yet)
    const requestPromise = engine.execute(adapter, { request: makeRequest() });

    // Shutdown immediately
    engine.shutdown();

    await assert.rejects(
      () => requestPromise,
      (error: unknown) => {
        assert.ok(error instanceof TransportError, 'Should be TransportError');
        assert.equal(error.code, 'GATEWAY_SHUTTING_DOWN');
        return true;
      },
    );
  });

  // INT-018: New requests after shutdown() rejected
  it('INT-018 rejection: new requests after shutdown return GATEWAY_SHUTTING_DOWN', async () => {
    const engine = createTransportEngine({
      time: clock,
      updateHealth: () => {},
      isCircuitOpen: () => false,
    });

    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key-shut2', clock);

    // Shutdown first
    engine.shutdown();

    // Then try to make a request
    let fetchCalled = false;
    globalThis.fetch = async (): Promise<Response> => {
      fetchCalled = true;
      return new Response('Should not reach', { status: 200 });
    };

    // Non-streaming
    await assert.rejects(
      () => engine.execute(adapter, { request: makeRequest() }),
      (error: unknown) => {
        assert.ok(error instanceof TransportError, 'Should be TransportError');
        assert.equal(error.code, 'GATEWAY_SHUTTING_DOWN');
        return true;
      },
    );

    // Streaming
    await assert.rejects(
      () => engine.executeStream(adapter, { request: makeRequest() }),
      (error: unknown) => {
        assert.ok(error instanceof TransportError, 'Should be TransportError');
        assert.equal(error.code, 'GATEWAY_SHUTTING_DOWN');
        return true;
      },
    );

    assert.equal(fetchCalled, false, 'fetch() should never be called after shutdown');
  });
});

// ============================================================================
// 8. TLS Enforcement Integration
// ============================================================================

describe('Sprint 5D Integration: TLS Enforcement', () => {
  let clock: ReturnType<typeof createMockClock>;
  let engine: TransportEngine;

  beforeEach(() => {
    clock = createMockClock();
    engine = createTransportEngine({
      time: clock,
      updateHealth: () => {},
      isCircuitOpen: () => false,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // INT-019: Non-local http:// URL rejected
  it('INT-019 rejection: non-local http:// URL yields TRANSPORT_TLS_REQUIRED', async () => {
    const adapter = createAnthropicAdapter('anthropic-http', 'http://external-api.example.com', 'test-key-tls', clock);

    let fetchCalled = false;
    globalThis.fetch = async (): Promise<Response> => {
      fetchCalled = true;
      return new Response(anthropicJsonResponse(), { status: 200 });
    };

    await assert.rejects(
      () => engine.execute(adapter, { request: makeRequest() }),
      (error: unknown) => {
        assert.ok(error instanceof TransportError, 'Should be TransportError');
        assert.equal(error.code, 'TRANSPORT_TLS_REQUIRED');
        return true;
      },
    );

    assert.equal(fetchCalled, false, 'fetch() should NOT be called for non-TLS non-local URL');
  });

  // INT-020: Local http:// URL succeeds
  it('INT-020 success: local http://localhost URL succeeds without TLS', async () => {
    // Ollama adapter uses localhost and no auth
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434', clock);

    globalThis.fetch = async (): Promise<Response> => {
      return new Response(ollamaJsonResponse('Local works'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await engine.execute(adapter, { request: makeRequest({ model: 'llama3' }) });

    assert.equal(result.response.content, 'Local works');
  });

  // INT-020b: 127.0.0.1 also succeeds
  it('INT-020b success: local http://127.0.0.1 URL succeeds without TLS', async () => {
    const adapter = createOllamaAdapter('ollama', 'http://127.0.0.1:11434', clock);

    globalThis.fetch = async (): Promise<Response> => {
      return new Response(ollamaJsonResponse('Loopback works'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await engine.execute(adapter, { request: makeRequest({ model: 'llama3' }) });

    assert.equal(result.response.content, 'Loopback works');
  });
});

// ============================================================================
// 9. Response Size Limit Integration
// ============================================================================

describe('Sprint 5D Integration: Response Size Limit', () => {
  let clock: ReturnType<typeof createMockClock>;
  let engine: TransportEngine;

  beforeEach(() => {
    clock = createMockClock();
    engine = createTransportEngine({
      time: clock,
      updateHealth: () => {},
      isCircuitOpen: () => false,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // INT-021: Response with Content-Length > 10MB rejected
  it('INT-021 rejection: response with Content-Length > 10MB yields TRANSPORT_RESPONSE_TOO_LARGE', async () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key-size', clock);

    globalThis.fetch = async (): Promise<Response> => {
      return new Response('Huge response body placeholder', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': '20000000', // 20MB > 10MB limit
        },
      });
    };

    await assert.rejects(
      () => engine.execute(adapter, { request: makeRequest() }),
      (error: unknown) => {
        assert.ok(error instanceof TransportError, 'Should be TransportError');
        assert.equal(error.code, 'TRANSPORT_RESPONSE_TOO_LARGE');
        return true;
      },
    );
  });

  // INT-022: Response within limit succeeds
  it('INT-022 success: response within 10MB limit succeeds', async () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key-ok', clock);
    const body = anthropicJsonResponse('Normal response');

    globalThis.fetch = async (): Promise<Response> => {
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(body.length), // Well within 10MB
        },
      });
    };

    const result = await engine.execute(adapter, { request: makeRequest() });

    assert.equal(result.response.content, 'Normal response');
  });
});
