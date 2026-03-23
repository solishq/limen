/**
 * Limen v1.0 — Phase 5 Sprint 5C: Ollama + Groq + Mistral Adapters
 * Contract tests for groq_adapter, mistral_adapter, and ollama_adapter.
 *
 * Spec ref: §25.4 (LLM Gateway), §27 (Streaming), I-01 (no SDK deps), I-04 (provider independence)
 * Security: C-SEC-P5-01/02 (API key never in logs/errors), C-SEC-P5-05 (Ollama localhost-only),
 *           C-SEC-P5-22 (untrusted output), C-SEC-P5-23 (tool call validation)
 * Amendments: A21 (rejection-path testing), A22 (wiring manifest)
 *
 * Test Categories:
 *   1. Groq adapter: request delegation to openai_compat
 *   2. Groq adapter: response delegation to openai_compat
 *   3. Groq adapter: streaming (SSE)
 *   4. Groq adapter: retryable status codes
 *   5. Groq adapter: API key security (C-SEC-P5-01/02)
 *   6. Groq adapter: Object.freeze, CR-1
 *   7. Mistral adapter: request delegation to openai_compat
 *   8. Mistral adapter: response delegation to openai_compat
 *   9. Mistral adapter: streaming (SSE)
 *  10. Mistral adapter: retryable status codes
 *  11. Mistral adapter: API key security (C-SEC-P5-01/02)
 *  12. Mistral adapter: Object.freeze, CR-1
 *  13. Ollama adapter: C-SEC-P5-05 localhost validation
 *  14. Ollama adapter: request translation (Ollama format)
 *  15. Ollama adapter: response parsing
 *  16. Ollama adapter: tool call parsing (C-SEC-P5-23)
 *  17. Ollama adapter: streaming via NDJSON
 *  18. Ollama adapter: deliberation = estimated
 *  19. Ollama adapter: retryable status codes
 *  20. Ollama adapter: Object.freeze, no API key
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Groq adapter
import {
  createGroqAdapter,
  createGroqAdapterFromEnv,
  RETRYABLE_STATUS_CODES as GROQ_RETRYABLE,
} from '../../src/substrate/transport/adapters/groq_adapter.js';

// Mistral adapter
import {
  createMistralAdapter,
  createMistralAdapterFromEnv,
  RETRYABLE_STATUS_CODES as MISTRAL_RETRYABLE,
} from '../../src/substrate/transport/adapters/mistral_adapter.js';

// Ollama adapter
import {
  createOllamaAdapter,
  validateLocalhostUrl,
  validateOllamaToolCall,
  mapOllamaFinishReason,
  RETRYABLE_STATUS_CODES as OLLAMA_RETRYABLE,
  TOOL_NAME_PATTERN as OLLAMA_TOOL_NAME_PATTERN,
} from '../../src/substrate/transport/adapters/ollama_adapter.js';

// Types
import type {
  TransportHttpResponse,
} from '../../src/substrate/transport/transport_types.js';
import type {
  LlmRequest,
  LlmStreamChunk,
} from '../../src/substrate/interfaces/substrate.js';
import type { TimeProvider } from '../../src/kernel/interfaces/index.js';

// ============================================================================
// Test Helpers
// ============================================================================

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

/** Create a test TimeProvider */
function createTestTimeProvider(startMs: number = 1000000): TimeProvider & { advance: (ms: number) => void } {
  let current = startMs;
  return {
    nowISO: () => new Date(current).toISOString(),
    nowMs: () => current,
    advance: (ms: number) => { current += ms; },
  };
}

/** Create a minimal LlmRequest */
function createTestLlmRequest(overrides?: Partial<LlmRequest>): LlmRequest {
  return {
    model: 'llama3',
    messages: [{ role: 'user', content: 'Hello' }],
    maxTokens: 1024,
    ...overrides,
  };
}

/** Build a mock OpenAI Chat Completions response body (used by Groq/Mistral) */
function buildChatCompletionResponse(opts: {
  content?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}): string {
  const usage: Record<string, unknown> = {
    prompt_tokens: opts.promptTokens ?? 10,
    completion_tokens: opts.completionTokens ?? 20,
    total_tokens: (opts.promptTokens ?? 10) + (opts.completionTokens ?? 20),
  };

  const message: Record<string, unknown> = {
    role: 'assistant',
    content: opts.content ?? 'Hello there!',
  };

  if (opts.toolCalls) {
    message.tool_calls = opts.toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.name,
        arguments: tc.arguments,
      },
    }));
  }

  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    model: opts.model ?? 'llama-3.3-70b-versatile',
    choices: [{
      index: 0,
      message,
      finish_reason: opts.finishReason ?? 'stop',
    }],
    usage,
  });
}

/** Build a mock Ollama non-streaming response */
function buildOllamaResponse(opts: {
  content?: string;
  model?: string;
  promptEvalCount?: number;
  evalCount?: number;
  doneReason?: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}): string {
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: opts.content ?? 'Hello there!',
  };

  if (opts.toolCalls) {
    message.tool_calls = opts.toolCalls.map(tc => ({
      function: {
        name: tc.name,
        arguments: tc.arguments,
      },
    }));
  }

  const body: Record<string, unknown> = {
    model: opts.model ?? 'llama3',
    message,
    done: true,
    prompt_eval_count: opts.promptEvalCount ?? 42,
    eval_count: opts.evalCount ?? 128,
  };

  if (opts.doneReason !== undefined) {
    body.done_reason = opts.doneReason;
  }

  return JSON.stringify(body);
}

// ============================================================================
// 1. Groq Adapter: Request Delegation to openai_compat
// ============================================================================

describe('Sprint 5C: Groq Adapter — Request Delegation', () => {
  it('builds request with correct Groq URL', () => {
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-test-key');
    const request = createTestLlmRequest({ model: 'llama-3.3-70b-versatile' });
    const httpReq = adapter.buildRequest(request, false);

    assert.equal(httpReq.url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(httpReq.method, 'POST');
    assert.equal(httpReq.stream, false);
  });

  it('includes Authorization Bearer header', () => {
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-test-key-123');
    const request = createTestLlmRequest();
    const httpReq = adapter.buildRequest(request, false);

    assert.equal(httpReq.headers['authorization'], 'Bearer gsk-test-key-123');
    assert.equal(httpReq.headers['content-type'], 'application/json');
  });

  it('delegates message translation to openai_compat (system prompt, user message)', () => {
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-key');
    const request = createTestLlmRequest({
      model: 'mixtral-8x7b-32768',
      systemPrompt: 'You are a helpful assistant.',
      temperature: 0.5,
      maxTokens: 2048,
    });
    const httpReq = adapter.buildRequest(request, false);

    assert.equal(httpReq.body.model, 'mixtral-8x7b-32768');
    assert.equal(httpReq.body.max_tokens, 2048);
    assert.equal(httpReq.body.temperature, 0.5);

    const messages = httpReq.body.messages as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(messages));
    assert.equal(messages[0]?.role, 'system');
    assert.equal(messages[0]?.content, 'You are a helpful assistant.');
    assert.equal(messages[1]?.role, 'user');
    assert.equal(messages[1]?.content, 'Hello');
  });

  it('builds streaming request with stream_options', () => {
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-key');
    const request = createTestLlmRequest();
    const httpReq = adapter.buildRequest(request, true);

    assert.equal(httpReq.stream, true);
    assert.equal(httpReq.body.stream, true);
    const streamOptions = httpReq.body.stream_options as Record<string, unknown>;
    assert.equal(streamOptions?.include_usage, true);
  });

  it('includes tools in OpenAI format', () => {
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-key');
    const request = createTestLlmRequest({
      tools: [{
        name: 'get_weather',
        description: 'Get the weather',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      }],
    });
    const httpReq = adapter.buildRequest(request, false);

    const tools = httpReq.body.tools as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(tools));
    assert.equal(tools.length, 1);
    const fn = (tools[0] as Record<string, unknown>).function as Record<string, unknown>;
    assert.equal(fn.name, 'get_weather');
  });
});

// ============================================================================
// 2. Groq Adapter: Response Delegation to openai_compat
// ============================================================================

describe('Sprint 5C: Groq Adapter — Response Delegation', () => {
  it('parses standard Chat Completions response with correct token counts', () => {
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-key');
    const body = buildChatCompletionResponse({
      content: 'Hello from Groq!',
      promptTokens: 15,
      completionTokens: 30,
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.content, 'Hello from Groq!');
    assert.equal(result.response.usage.inputTokens, 15);
    assert.equal(result.response.usage.outputTokens, 30);
    assert.equal(result.response.providerId, 'groq');
  });

  it('deliberation is always estimated for Groq (no reasoning tokens)', () => {
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-key');
    const body = buildChatCompletionResponse({
      content: 'Response',
      completionTokens: 50,
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    // Groq does not send reasoning tokens, so openai_compat returns estimated
    assert.equal(result.deliberation.deliberationTokens, 0);
    assert.equal(result.deliberation.accountingMode, 'estimated');
    assert.equal(result.deliberation.providerReportedThinkingTokens, null);
  });

  it('parses tool calls through openai_compat validation (C-SEC-P5-23)', () => {
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-key');
    const body = buildChatCompletionResponse({
      content: '',
      toolCalls: [
        { id: 'call_1', name: 'get_weather', arguments: '{"city":"NYC"}' },
      ],
      finishReason: 'tool_calls',
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.toolCalls.length, 1);
    assert.equal(result.response.toolCalls[0]!.id, 'call_1');
    assert.equal(result.response.toolCalls[0]!.name, 'get_weather');
    assert.deepEqual(result.response.toolCalls[0]!.input, { city: 'NYC' });
    assert.equal(result.response.finishReason, 'tool_use');
  });

  it('maps finish reasons correctly via openai_compat', () => {
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-key');

    for (const [oaiReason, cortexReason] of [
      ['stop', 'stop'],
      ['length', 'length'],
      ['tool_calls', 'tool_use'],
      ['content_filter', 'content_filter'],
    ] as const) {
      const body = buildChatCompletionResponse({ finishReason: oaiReason });
      const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
      const result = adapter.parseResponse(httpResponse);
      assert.equal(result.response.finishReason, cortexReason,
        `Finish reason '${oaiReason}' should map to '${cortexReason}'`);
    }
  });
});

// ============================================================================
// 3. Groq Adapter: Streaming (SSE)
// ============================================================================

describe('Sprint 5C: Groq Adapter — Streaming', () => {
  it('supportsStreaming returns true', () => {
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-key');
    assert.equal(adapter.supportsStreaming(), true);
  });

  it('parses SSE content deltas and done event', async () => {
    const time = createTestTimeProvider();
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-key', time);

    const sseChunks = [
      'data: {"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createMockStream(sseChunks);
    const result = adapter.parseStream(stream);

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
      time.advance(100);
    }

    // Content deltas
    const contentDeltas = chunks.filter(c => c.type === 'content_delta');
    assert.equal(contentDeltas.length, 2);
    assert.equal((contentDeltas[0] as { type: 'content_delta'; delta: string }).delta, 'Hello');
    assert.equal((contentDeltas[1] as { type: 'content_delta'; delta: string }).delta, ' world');

    // Done event
    const doneChunks = chunks.filter(c => c.type === 'done');
    assert.equal(doneChunks.length, 1);
    assert.equal((doneChunks[0] as { type: 'done'; finishReason: string }).finishReason, 'stop');
  });

  it('parses usage from streaming usage-only event', async () => {
    const time = createTestTimeProvider();
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-key', time);

    const sseChunks = [
      'data: {"choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createMockStream(sseChunks);
    const result = adapter.parseStream(stream);

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
      time.advance(50);
    }

    const usageChunks = chunks.filter(c => c.type === 'usage');
    assert.equal(usageChunks.length, 1);
    const usage = usageChunks[0] as { type: 'usage'; inputTokens: number; outputTokens: number };
    assert.equal(usage.inputTokens, 10);
    assert.equal(usage.outputTokens, 5);
  });

  it('getDeliberation returns estimated after stream completion', async () => {
    const time = createTestTimeProvider();
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-key', time);

    const sseChunks = [
      'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createMockStream(sseChunks);
    const result = adapter.parseStream(stream);

    for await (const _ of result.stream) {
      time.advance(100);
    }

    const delib = result.getDeliberation();
    assert.equal(delib.deliberationTokens, 0);
    assert.equal(delib.accountingMode, 'estimated');
    assert.equal(delib.providerReportedThinkingTokens, null);
  });
});

// ============================================================================
// 4. Groq Adapter: Retryable Status Codes
// ============================================================================

describe('Sprint 5C: Groq Adapter — Retryable Status Codes', () => {
  it('retryable: 429, 500, 502, 503', () => {
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-key');
    for (const status of [429, 500, 502, 503]) {
      assert.equal(adapter.isRetryableStatus(status), true,
        `Status ${status} should be retryable`);
    }
  });

  it('non-retryable: 200, 400, 401, 403, 404', () => {
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-key');
    for (const status of [200, 400, 401, 403, 404]) {
      assert.equal(adapter.isRetryableStatus(status), false,
        `Status ${status} should NOT be retryable`);
    }
  });

  it('RETRYABLE_STATUS_CODES set matches expected codes', () => {
    assert.equal(GROQ_RETRYABLE.size, 4);
    assert.ok(GROQ_RETRYABLE.has(429));
    assert.ok(GROQ_RETRYABLE.has(500));
    assert.ok(GROQ_RETRYABLE.has(502));
    assert.ok(GROQ_RETRYABLE.has(503));
  });
});

// ============================================================================
// 5. Groq Adapter: API Key Security (C-SEC-P5-01/02)
// ============================================================================

describe('Sprint 5C: Groq Adapter — API Key Security', () => {
  it('A21-SUCCESS: API key is included in request headers', () => {
    const secretKey = 'gsk-super-secret-key-12345';
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', secretKey);
    const request = createTestLlmRequest();
    const httpReq = adapter.buildRequest(request, false);

    assert.equal(httpReq.headers['authorization'], `Bearer ${secretKey}`);
  });

  it('A21-REJECTION: createGroqAdapterFromEnv error message does NOT contain API key value (C-SEC-P5-01/02)', () => {
    // Ensure env var is not set
    const original = process.env['GROQ_API_KEY'];
    delete process.env['GROQ_API_KEY'];

    try {
      assert.throws(
        () => createGroqAdapterFromEnv(),
        (err: Error) => {
          // Error message must mention TRANSPORT_MISSING_API_KEY
          assert.ok(err.message.includes('TRANSPORT_MISSING_API_KEY'),
            'Error should contain TRANSPORT_MISSING_API_KEY code');
          // Error message must NOT contain any actual key value
          assert.ok(!err.message.includes('gsk-'),
            'Error message must NOT contain API key prefix');
          return true;
        },
      );
    } finally {
      if (original !== undefined) {
        process.env['GROQ_API_KEY'] = original;
      }
    }
  });

  it('CR-1: API key resolved once at creation, not per-request', () => {
    // Create adapter with a key, then verify it is used consistently
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-fixed-key');

    const req1 = adapter.buildRequest(createTestLlmRequest(), false);
    const req2 = adapter.buildRequest(createTestLlmRequest(), true);

    assert.equal(req1.headers['authorization'], 'Bearer gsk-fixed-key');
    assert.equal(req2.headers['authorization'], 'Bearer gsk-fixed-key');
  });
});

// ============================================================================
// 6. Groq Adapter: Object.freeze and providerId
// ============================================================================

describe('Sprint 5C: Groq Adapter — Object.freeze and providerId', () => {
  it('adapter is frozen (Object.freeze)', () => {
    const adapter = createGroqAdapter('groq', 'https://api.groq.com', 'gsk-key');
    assert.ok(Object.isFrozen(adapter));
  });

  it('providerId is set correctly', () => {
    const adapter = createGroqAdapter('groq-custom', 'https://api.groq.com', 'gsk-key');
    assert.equal(adapter.providerId, 'groq-custom');
  });
});

// ============================================================================
// 7. Mistral Adapter: Request Delegation to openai_compat
// ============================================================================

describe('Sprint 5C: Mistral Adapter — Request Delegation', () => {
  it('builds request with correct Mistral URL', () => {
    const adapter = createMistralAdapter('mistral', 'https://api.mistral.ai', 'ms-test-key');
    const request = createTestLlmRequest({ model: 'mistral-large-latest' });
    const httpReq = adapter.buildRequest(request, false);

    assert.equal(httpReq.url, 'https://api.mistral.ai/v1/chat/completions');
    assert.equal(httpReq.method, 'POST');
    assert.equal(httpReq.stream, false);
  });

  it('includes Authorization Bearer header', () => {
    const adapter = createMistralAdapter('mistral', 'https://api.mistral.ai', 'ms-test-key-456');
    const request = createTestLlmRequest();
    const httpReq = adapter.buildRequest(request, false);

    assert.equal(httpReq.headers['authorization'], 'Bearer ms-test-key-456');
    assert.equal(httpReq.headers['content-type'], 'application/json');
  });

  it('delegates message translation to openai_compat', () => {
    const adapter = createMistralAdapter('mistral', 'https://api.mistral.ai', 'ms-key');
    const request = createTestLlmRequest({
      model: 'mistral-medium',
      systemPrompt: 'Be concise.',
      temperature: 0.3,
      maxTokens: 4096,
    });
    const httpReq = adapter.buildRequest(request, false);

    assert.equal(httpReq.body.model, 'mistral-medium');
    assert.equal(httpReq.body.max_tokens, 4096);
    assert.equal(httpReq.body.temperature, 0.3);

    const messages = httpReq.body.messages as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(messages));
    assert.equal(messages[0]?.role, 'system');
    assert.equal(messages[0]?.content, 'Be concise.');
  });

  it('builds streaming request with stream_options', () => {
    const adapter = createMistralAdapter('mistral', 'https://api.mistral.ai', 'ms-key');
    const request = createTestLlmRequest();
    const httpReq = adapter.buildRequest(request, true);

    assert.equal(httpReq.stream, true);
    assert.equal(httpReq.body.stream, true);
    const streamOptions = httpReq.body.stream_options as Record<string, unknown>;
    assert.equal(streamOptions?.include_usage, true);
  });
});

// ============================================================================
// 8. Mistral Adapter: Response Delegation to openai_compat
// ============================================================================

describe('Sprint 5C: Mistral Adapter — Response Delegation', () => {
  it('parses standard Chat Completions response', () => {
    const adapter = createMistralAdapter('mistral', 'https://api.mistral.ai', 'ms-key');
    const body = buildChatCompletionResponse({
      content: 'Bonjour from Mistral!',
      model: 'mistral-large-2402',
      promptTokens: 20,
      completionTokens: 40,
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.content, 'Bonjour from Mistral!');
    assert.equal(result.response.usage.inputTokens, 20);
    assert.equal(result.response.usage.outputTokens, 40);
    assert.equal(result.response.providerId, 'mistral');
  });

  it('deliberation is always estimated for Mistral', () => {
    const adapter = createMistralAdapter('mistral', 'https://api.mistral.ai', 'ms-key');
    const body = buildChatCompletionResponse({ completionTokens: 100 });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.deliberation.deliberationTokens, 0);
    assert.equal(result.deliberation.accountingMode, 'estimated');
    assert.equal(result.deliberation.providerReportedThinkingTokens, null);
  });

  it('parses tool calls through openai_compat validation', () => {
    const adapter = createMistralAdapter('mistral', 'https://api.mistral.ai', 'ms-key');
    const body = buildChatCompletionResponse({
      content: '',
      toolCalls: [
        { id: 'tool-1', name: 'search', arguments: '{"query":"test"}' },
      ],
      finishReason: 'tool_calls',
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.toolCalls.length, 1);
    assert.equal(result.response.toolCalls[0]!.name, 'search');
    assert.equal(result.response.finishReason, 'tool_use');
  });
});

// ============================================================================
// 9. Mistral Adapter: Streaming (SSE)
// ============================================================================

describe('Sprint 5C: Mistral Adapter — Streaming', () => {
  it('supportsStreaming returns true', () => {
    const adapter = createMistralAdapter('mistral', 'https://api.mistral.ai', 'ms-key');
    assert.equal(adapter.supportsStreaming(), true);
  });

  it('parses SSE content deltas and done event', async () => {
    const time = createTestTimeProvider();
    const adapter = createMistralAdapter('mistral', 'https://api.mistral.ai', 'ms-key', time);

    const sseChunks = [
      'data: {"choices":[{"index":0,"delta":{"content":"Bonjour"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createMockStream(sseChunks);
    const result = adapter.parseStream(stream);

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
      time.advance(100);
    }

    const contentDeltas = chunks.filter(c => c.type === 'content_delta');
    assert.equal(contentDeltas.length, 2);
    assert.equal((contentDeltas[0] as { type: 'content_delta'; delta: string }).delta, 'Bonjour');
    assert.equal((contentDeltas[1] as { type: 'content_delta'; delta: string }).delta, '!');

    const doneChunks = chunks.filter(c => c.type === 'done');
    assert.equal(doneChunks.length, 1);
    assert.equal((doneChunks[0] as { type: 'done'; finishReason: string }).finishReason, 'stop');
  });

  it('getDeliberation returns estimated after stream completion', async () => {
    const time = createTestTimeProvider();
    const adapter = createMistralAdapter('mistral', 'https://api.mistral.ai', 'ms-key', time);

    const sseChunks = [
      'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createMockStream(sseChunks);
    const result = adapter.parseStream(stream);

    for await (const _ of result.stream) {
      time.advance(100);
    }

    const delib = result.getDeliberation();
    assert.equal(delib.deliberationTokens, 0);
    assert.equal(delib.accountingMode, 'estimated');
  });
});

// ============================================================================
// 10. Mistral Adapter: Retryable Status Codes
// ============================================================================

describe('Sprint 5C: Mistral Adapter — Retryable Status Codes', () => {
  it('retryable: 429, 500, 502, 503', () => {
    const adapter = createMistralAdapter('mistral', 'https://api.mistral.ai', 'ms-key');
    for (const status of [429, 500, 502, 503]) {
      assert.equal(adapter.isRetryableStatus(status), true,
        `Status ${status} should be retryable`);
    }
  });

  it('non-retryable: 200, 400, 401, 403', () => {
    const adapter = createMistralAdapter('mistral', 'https://api.mistral.ai', 'ms-key');
    for (const status of [200, 400, 401, 403]) {
      assert.equal(adapter.isRetryableStatus(status), false,
        `Status ${status} should NOT be retryable`);
    }
  });

  it('RETRYABLE_STATUS_CODES set matches expected codes', () => {
    assert.equal(MISTRAL_RETRYABLE.size, 4);
    assert.ok(MISTRAL_RETRYABLE.has(429));
    assert.ok(MISTRAL_RETRYABLE.has(500));
    assert.ok(MISTRAL_RETRYABLE.has(502));
    assert.ok(MISTRAL_RETRYABLE.has(503));
  });
});

// ============================================================================
// 11. Mistral Adapter: API Key Security (C-SEC-P5-01/02)
// ============================================================================

describe('Sprint 5C: Mistral Adapter — API Key Security', () => {
  it('A21-SUCCESS: API key is included in request headers', () => {
    const secretKey = 'ms-super-secret-key-789';
    const adapter = createMistralAdapter('mistral', 'https://api.mistral.ai', secretKey);
    const request = createTestLlmRequest();
    const httpReq = adapter.buildRequest(request, false);

    assert.equal(httpReq.headers['authorization'], `Bearer ${secretKey}`);
  });

  it('A21-REJECTION: createMistralAdapterFromEnv error message does NOT contain API key value (C-SEC-P5-01/02)', () => {
    const original = process.env['MISTRAL_API_KEY'];
    delete process.env['MISTRAL_API_KEY'];

    try {
      assert.throws(
        () => createMistralAdapterFromEnv(),
        (err: Error) => {
          assert.ok(err.message.includes('TRANSPORT_MISSING_API_KEY'),
            'Error should contain TRANSPORT_MISSING_API_KEY code');
          assert.ok(!err.message.includes('ms-'),
            'Error message must NOT contain API key prefix');
          return true;
        },
      );
    } finally {
      if (original !== undefined) {
        process.env['MISTRAL_API_KEY'] = original;
      }
    }
  });

  it('CR-1: API key resolved once at creation', () => {
    const adapter = createMistralAdapter('mistral', 'https://api.mistral.ai', 'ms-fixed-key');

    const req1 = adapter.buildRequest(createTestLlmRequest(), false);
    const req2 = adapter.buildRequest(createTestLlmRequest(), true);

    assert.equal(req1.headers['authorization'], 'Bearer ms-fixed-key');
    assert.equal(req2.headers['authorization'], 'Bearer ms-fixed-key');
  });
});

// ============================================================================
// 12. Mistral Adapter: Object.freeze and providerId
// ============================================================================

describe('Sprint 5C: Mistral Adapter — Object.freeze and providerId', () => {
  it('adapter is frozen (Object.freeze)', () => {
    const adapter = createMistralAdapter('mistral', 'https://api.mistral.ai', 'ms-key');
    assert.ok(Object.isFrozen(adapter));
  });

  it('providerId is set correctly', () => {
    const adapter = createMistralAdapter('mistral-custom', 'https://api.mistral.ai', 'ms-key');
    assert.equal(adapter.providerId, 'mistral-custom');
  });
});

// ============================================================================
// 13. Ollama Adapter: C-SEC-P5-05 Localhost Validation
// ============================================================================

describe('Sprint 5C: Ollama Adapter — C-SEC-P5-05 Localhost Validation', () => {
  it('A21-SUCCESS: allows localhost URL', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    assert.ok(adapter, 'localhost should be allowed');
    assert.equal(adapter.providerId, 'ollama');
  });

  it('A21-SUCCESS: allows 127.0.0.1 URL', () => {
    const adapter = createOllamaAdapter('ollama', 'http://127.0.0.1:11434');
    assert.ok(adapter, '127.0.0.1 should be allowed');
  });

  it('A21-SUCCESS: allows [::1] URL', () => {
    const adapter = createOllamaAdapter('ollama', 'http://[::1]:11434');
    assert.ok(adapter, '[::1] should be allowed');
  });

  it('A21-SUCCESS: allows localhost with different port', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:8080');
    assert.ok(adapter, 'localhost:8080 should be allowed');
  });

  it('A21-SUCCESS: uses default URL (localhost:11434) when no baseUrl provided', () => {
    const adapter = createOllamaAdapter('ollama');
    assert.ok(adapter, 'default localhost URL should be allowed');
  });

  it('A21-REJECTION: rejects external URL (TRANSPORT_INVALID_URL)', () => {
    assert.throws(
      () => createOllamaAdapter('ollama', 'https://api.example.com'),
      (err: Error) => {
        assert.ok(err.message.includes('TRANSPORT_INVALID_URL'),
          'Error should contain TRANSPORT_INVALID_URL code');
        assert.ok(err.message.includes('api.example.com'),
          'Error should identify the rejected hostname');
        return true;
      },
    );
  });

  it('A21-REJECTION: rejects non-local IP address', () => {
    assert.throws(
      () => createOllamaAdapter('ollama', 'http://192.168.1.100:11434'),
      (err: Error) => {
        assert.ok(err.message.includes('TRANSPORT_INVALID_URL'));
        return true;
      },
    );
  });

  it('A21-REJECTION: rejects cloud provider URL', () => {
    assert.throws(
      () => createOllamaAdapter('ollama', 'https://ollama.cloud-provider.com:11434'),
      (err: Error) => {
        assert.ok(err.message.includes('TRANSPORT_INVALID_URL'));
        return true;
      },
    );
  });

  it('A21-REJECTION: rejects invalid URL format', () => {
    assert.throws(
      () => createOllamaAdapter('ollama', 'not-a-valid-url'),
      (err: Error) => {
        assert.ok(err.message.includes('TRANSPORT_INVALID_URL'));
        return true;
      },
    );
  });

  it('validateLocalhostUrl unit test — allows all localhost variants', () => {
    // Should not throw for any of these — if they throw, the test fails.
    // assert.doesNotThrow is discriminative: it fails if the function throws.
    assert.doesNotThrow(() => validateLocalhostUrl('http://localhost:11434'));
    assert.doesNotThrow(() => validateLocalhostUrl('http://127.0.0.1:11434'));
    assert.doesNotThrow(() => validateLocalhostUrl('http://[::1]:11434'));
    assert.doesNotThrow(() => validateLocalhostUrl('http://localhost'));
  });

  it('validateLocalhostUrl unit test — rejects external hosts', () => {
    assert.throws(() => validateLocalhostUrl('http://example.com'), /TRANSPORT_INVALID_URL/);
    assert.throws(() => validateLocalhostUrl('http://10.0.0.1'), /TRANSPORT_INVALID_URL/);
    assert.throws(() => validateLocalhostUrl('https://0.0.0.0:11434'), /TRANSPORT_INVALID_URL/);
  });
});

// ============================================================================
// 14. Ollama Adapter: Request Translation (Ollama Format)
// ============================================================================

describe('Sprint 5C: Ollama Adapter — Request Translation', () => {
  it('builds Ollama-format request with messages and options', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    const request = createTestLlmRequest({
      model: 'llama3',
      maxTokens: 2048,
      temperature: 0.7,
    });

    const httpReq = adapter.buildRequest(request, false);

    assert.equal(httpReq.url, 'http://localhost:11434/api/chat');
    assert.equal(httpReq.method, 'POST');
    assert.equal(httpReq.stream, false);
    assert.equal(httpReq.headers['content-type'], 'application/json');

    // Ollama-specific body structure
    assert.equal(httpReq.body.model, 'llama3');
    assert.equal(httpReq.body.stream, false);

    // Messages array
    const messages = httpReq.body.messages as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(messages));
    assert.equal(messages[0]?.role, 'user');
    assert.equal(messages[0]?.content, 'Hello');

    // Options object (NOT top-level fields)
    const options = httpReq.body.options as Record<string, unknown>;
    assert.equal(options.num_predict, 2048);
    assert.equal(options.temperature, 0.7);
  });

  it('includes system prompt as system message', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    const request = createTestLlmRequest({
      model: 'llama3',
      systemPrompt: 'Be brief.',
    });

    const httpReq = adapter.buildRequest(request, false);
    const messages = httpReq.body.messages as Array<Record<string, unknown>>;

    assert.equal(messages[0]?.role, 'system');
    assert.equal(messages[0]?.content, 'Be brief.');
    assert.equal(messages[1]?.role, 'user');
    assert.equal(messages[1]?.content, 'Hello');
  });

  it('builds streaming request with stream: true', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    const request = createTestLlmRequest();
    const httpReq = adapter.buildRequest(request, true);

    assert.equal(httpReq.stream, true);
    assert.equal(httpReq.body.stream, true);
  });

  it('includes tools in Ollama format', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    const request = createTestLlmRequest({
      tools: [{
        name: 'get_weather',
        description: 'Get weather data',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      }],
    });

    const httpReq = adapter.buildRequest(request, false);
    const tools = httpReq.body.tools as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(tools));
    assert.equal(tools.length, 1);
    const fn = (tools[0] as Record<string, unknown>).function as Record<string, unknown>;
    assert.equal(fn.name, 'get_weather');
    assert.equal(fn.description, 'Get weather data');
  });

  it('no auth headers (Ollama is local-only)', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    const request = createTestLlmRequest();
    const httpReq = adapter.buildRequest(request, false);

    assert.equal(httpReq.headers['authorization'], undefined,
      'Ollama must NOT have authorization header');
    assert.equal(Object.keys(httpReq.headers).length, 1,
      'Only content-type header should be present');
  });
});

// ============================================================================
// 15. Ollama Adapter: Response Parsing
// ============================================================================

describe('Sprint 5C: Ollama Adapter — Response Parsing', () => {
  it('parses standard Ollama response with message.content', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    const body = buildOllamaResponse({
      content: 'Hello from Ollama!',
      model: 'llama3',
      promptEvalCount: 42,
      evalCount: 128,
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.content, 'Hello from Ollama!');
    assert.equal(result.response.model, 'llama3');
    assert.equal(result.response.providerId, 'ollama');
  });

  it('maps prompt_eval_count to inputTokens and eval_count to outputTokens', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    const body = buildOllamaResponse({
      promptEvalCount: 50,
      evalCount: 200,
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.usage.inputTokens, 50);
    assert.equal(result.response.usage.outputTokens, 200);
    assert.equal(result.response.usage.providerInputTokens, 50);
    assert.equal(result.response.usage.providerOutputTokens, 200);
  });

  it('handles missing token counts gracefully (defaults to 0)', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    const body = JSON.stringify({
      model: 'llama3',
      message: { role: 'assistant', content: 'Hi' },
      done: true,
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.usage.inputTokens, 0);
    assert.equal(result.response.usage.outputTokens, 0);
  });

  it('maps done_reason to Limen finish reason', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');

    // stop
    let body = buildOllamaResponse({ doneReason: 'stop' });
    let result = adapter.parseResponse({ status: 200, headers: {}, body });
    assert.equal(result.response.finishReason, 'stop');

    // length
    body = buildOllamaResponse({ doneReason: 'length' });
    result = adapter.parseResponse({ status: 200, headers: {}, body });
    assert.equal(result.response.finishReason, 'length');

    // undefined defaults to stop
    body = buildOllamaResponse({});
    result = adapter.parseResponse({ status: 200, headers: {}, body });
    assert.equal(result.response.finishReason, 'stop');
  });

  it('throws on invalid JSON response (C-SEC-P5-07)', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body: 'not-json' };

    assert.throws(
      () => adapter.parseResponse(httpResponse),
      (err: Error) => {
        assert.ok(err.message.includes('JSON parse error'));
        return true;
      },
    );
  });

  it('throws on missing message object (C-SEC-P5-22)', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    const body = JSON.stringify({ model: 'llama3', done: true });
    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };

    assert.throws(
      () => adapter.parseResponse(httpResponse),
      (err: Error) => {
        assert.ok(err.message.includes('missing message'));
        return true;
      },
    );
  });
});

// ============================================================================
// 16. Ollama Adapter: Tool Call Parsing (C-SEC-P5-23)
// ============================================================================

describe('Sprint 5C: Ollama Adapter — Tool Call Parsing (C-SEC-P5-23)', () => {
  it('A21-SUCCESS: parses valid tool call with arguments as OBJECT', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    const body = buildOllamaResponse({
      content: '',
      toolCalls: [
        { name: 'get_weather', arguments: { city: 'NYC', units: 'metric' } },
      ],
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.toolCalls.length, 1);
    const tc = result.response.toolCalls[0]!;
    assert.equal(tc.name, 'get_weather');
    assert.deepEqual(tc.input, { city: 'NYC', units: 'metric' });
    // ID is generated since Ollama does not provide one
    assert.ok(tc.id.startsWith('ollama-call-'), `ID should be generated: ${tc.id}`);
    assert.equal(result.response.finishReason, 'tool_use');
  });

  it('A21-SUCCESS: parses multiple tool calls with unique generated IDs', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    const body = buildOllamaResponse({
      content: '',
      toolCalls: [
        { name: 'get_weather', arguments: { city: 'NYC' } },
        { name: 'get_time', arguments: { timezone: 'EST' } },
      ],
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.toolCalls.length, 2);
    assert.equal(result.response.toolCalls[0]!.id, 'ollama-call-0');
    assert.equal(result.response.toolCalls[1]!.id, 'ollama-call-1');
    assert.notEqual(result.response.toolCalls[0]!.id, result.response.toolCalls[1]!.id);
  });

  it('A21-REJECTION: drops tool call with invalid name (C-SEC-P5-23)', () => {
    // Directly test the validation function
    const result = validateOllamaToolCall({
      function: { name: 'invalid name with spaces', arguments: { x: 1 } },
    }, 0);
    assert.equal(result, null, 'Invalid name should be rejected');
  });

  it('A21-REJECTION: drops tool call with non-object arguments', () => {
    const result = validateOllamaToolCall({
      function: { name: 'valid_name', arguments: 'not-an-object' },
    }, 0);
    assert.equal(result, null, 'String arguments should be rejected (Ollama uses objects)');
  });

  it('A21-REJECTION: drops tool call with array arguments', () => {
    const result = validateOllamaToolCall({
      function: { name: 'valid_name', arguments: [1, 2, 3] },
    }, 0);
    assert.equal(result, null, 'Array arguments should be rejected');
  });

  it('A21-REJECTION: drops tool call with missing function object', () => {
    const result = validateOllamaToolCall({}, 0);
    assert.equal(result, null, 'Missing function object should be rejected');
  });

  it('A21-REJECTION: drops tool call with name not matching TOOL_NAME_PATTERN', () => {
    // Name starting with a number
    const result1 = validateOllamaToolCall({
      function: { name: '123_invalid', arguments: { x: 1 } },
    }, 0);
    assert.equal(result1, null, 'Name starting with number should be rejected');

    // Name with special characters
    const result2 = validateOllamaToolCall({
      function: { name: 'func-name', arguments: { x: 1 } },
    }, 0);
    assert.equal(result2, null, 'Name with hyphen should be rejected');
  });

  it('TOOL_NAME_PATTERN accepts valid names', () => {
    assert.ok(OLLAMA_TOOL_NAME_PATTERN.test('get_weather'));
    assert.ok(OLLAMA_TOOL_NAME_PATTERN.test('_private'));
    assert.ok(OLLAMA_TOOL_NAME_PATTERN.test('CamelCase'));
    assert.ok(OLLAMA_TOOL_NAME_PATTERN.test('func123'));
  });

  it('TOOL_NAME_PATTERN rejects invalid names', () => {
    assert.equal(OLLAMA_TOOL_NAME_PATTERN.test('123start'), false);
    assert.equal(OLLAMA_TOOL_NAME_PATTERN.test('has space'), false);
    assert.equal(OLLAMA_TOOL_NAME_PATTERN.test('has-dash'), false);
    assert.equal(OLLAMA_TOOL_NAME_PATTERN.test(''), false);
  });

  it('invalid tool calls silently dropped from response (not error)', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    // Build response with one valid and one invalid tool call
    const body = JSON.stringify({
      model: 'llama3',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          { function: { name: 'valid_tool', arguments: { x: 1 } } },
          { function: { name: '!!!invalid!!!', arguments: { y: 2 } } },
        ],
      },
      done: true,
      prompt_eval_count: 10,
      eval_count: 20,
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    // Only the valid tool call should be present
    assert.equal(result.response.toolCalls.length, 1);
    assert.equal(result.response.toolCalls[0]!.name, 'valid_tool');
  });
});

// ============================================================================
// 17. Ollama Adapter: Streaming via NDJSON
// ============================================================================

describe('Sprint 5C: Ollama Adapter — NDJSON Streaming', () => {
  it('supportsStreaming returns true', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    assert.equal(adapter.supportsStreaming(), true);
  });

  it('parses NDJSON content deltas from message.content when done=false', async () => {
    const time = createTestTimeProvider();
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434', time);

    // NDJSON format: each line is a complete JSON object
    const ndjsonChunks = [
      '{"model":"llama3","message":{"role":"assistant","content":"Hello"},"done":false}\n',
      '{"model":"llama3","message":{"role":"assistant","content":" world"},"done":false}\n',
      '{"model":"llama3","message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":42,"eval_count":128,"done_reason":"stop"}\n',
    ];

    const stream = createMockStream(ndjsonChunks);
    const result = adapter.parseStream(stream);

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
      time.advance(100);
    }

    // Content deltas
    const contentDeltas = chunks.filter(c => c.type === 'content_delta');
    assert.equal(contentDeltas.length, 2);
    assert.equal((contentDeltas[0] as { type: 'content_delta'; delta: string }).delta, 'Hello');
    assert.equal((contentDeltas[1] as { type: 'content_delta'; delta: string }).delta, ' world');
  });

  it('extracts usage from final chunk when done=true', async () => {
    const time = createTestTimeProvider();
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434', time);

    const ndjsonChunks = [
      '{"model":"llama3","message":{"role":"assistant","content":"Hi"},"done":false}\n',
      '{"model":"llama3","message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":50,"eval_count":200,"done_reason":"stop"}\n',
    ];

    const stream = createMockStream(ndjsonChunks);
    const result = adapter.parseStream(stream);

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
      time.advance(100);
    }

    // Usage from final chunk
    const usageChunks = chunks.filter(c => c.type === 'usage');
    assert.equal(usageChunks.length, 1);
    const usage = usageChunks[0] as { type: 'usage'; inputTokens: number; outputTokens: number };
    assert.equal(usage.inputTokens, 50);
    assert.equal(usage.outputTokens, 200);
  });

  it('emits done event with correct finish reason from done_reason', async () => {
    const time = createTestTimeProvider();
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434', time);

    const ndjsonChunks = [
      '{"model":"llama3","message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":10,"eval_count":5,"done_reason":"length"}\n',
    ];

    const stream = createMockStream(ndjsonChunks);
    const result = adapter.parseStream(stream);

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
      time.advance(100);
    }

    const doneChunks = chunks.filter(c => c.type === 'done');
    assert.equal(doneChunks.length, 1);
    assert.equal((doneChunks[0] as { type: 'done'; finishReason: string }).finishReason, 'length');
  });

  it('getDeliberation returns estimated after stream completion', async () => {
    const time = createTestTimeProvider();
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434', time);

    const ndjsonChunks = [
      '{"model":"llama3","message":{"role":"assistant","content":"OK"},"done":false}\n',
      '{"model":"llama3","message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":5,"eval_count":1}\n',
    ];

    const stream = createMockStream(ndjsonChunks);
    const result = adapter.parseStream(stream);

    for await (const _ of result.stream) {
      time.advance(100);
    }

    const delib = result.getDeliberation();
    assert.equal(delib.deliberationTokens, 0);
    assert.equal(delib.accountingMode, 'estimated');
    assert.equal(delib.providerReportedThinkingTokens, null);
  });

  it('getTotalMs reflects elapsed time via TimeProvider', async () => {
    const time = createTestTimeProvider(1000);
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434', time);

    const ndjsonChunks = [
      '{"model":"llama3","message":{"role":"assistant","content":"Hi"},"done":false}\n',
      '{"model":"llama3","message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":5,"eval_count":1}\n',
    ];

    const stream = createMockStream(ndjsonChunks);
    const result = adapter.parseStream(stream);

    for await (const _ of result.stream) {
      time.advance(500);
    }

    const totalMs = result.getTotalMs();
    assert.ok(totalMs >= 1000, `totalMs should reflect time advances: ${totalMs}`);
  });
});

// ============================================================================
// 18. Ollama Adapter: Deliberation = Estimated (Always)
// ============================================================================

describe('Sprint 5C: Ollama Adapter — Deliberation', () => {
  it('non-streaming: deliberation is always estimated with 0 tokens', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    const body = buildOllamaResponse({});
    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.deliberation.deliberationTokens, 0);
    assert.equal(result.deliberation.accountingMode, 'estimated');
    assert.equal(result.deliberation.providerReportedThinkingTokens, null);
  });
});

// ============================================================================
// 19. Ollama Adapter: Retryable Status Codes
// ============================================================================

describe('Sprint 5C: Ollama Adapter — Retryable Status Codes', () => {
  it('retryable: 429, 500, 502, 503', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    for (const status of [429, 500, 502, 503]) {
      assert.equal(adapter.isRetryableStatus(status), true,
        `Status ${status} should be retryable`);
    }
  });

  it('non-retryable: 200, 400, 401, 404', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    for (const status of [200, 400, 401, 404]) {
      assert.equal(adapter.isRetryableStatus(status), false,
        `Status ${status} should NOT be retryable`);
    }
  });

  it('RETRYABLE_STATUS_CODES set matches expected codes', () => {
    assert.equal(OLLAMA_RETRYABLE.size, 4);
    assert.ok(OLLAMA_RETRYABLE.has(429));
    assert.ok(OLLAMA_RETRYABLE.has(500));
    assert.ok(OLLAMA_RETRYABLE.has(502));
    assert.ok(OLLAMA_RETRYABLE.has(503));
  });
});

// ============================================================================
// 20. Ollama Adapter: Object.freeze, No API Key
// ============================================================================

describe('Sprint 5C: Ollama Adapter — Object.freeze and No Auth', () => {
  it('adapter is frozen (Object.freeze)', () => {
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    assert.ok(Object.isFrozen(adapter));
  });

  it('providerId is set correctly', () => {
    const adapter = createOllamaAdapter('ollama-local', 'http://localhost:11434');
    assert.equal(adapter.providerId, 'ollama-local');
  });

  it('no apiKey parameter in factory (auth-free)', () => {
    // Verify createOllamaAdapter only takes providerId, baseUrl, time
    // This is a structural test — if it compiles with these args, it is correct
    const adapter = createOllamaAdapter('ollama', 'http://localhost:11434');
    const request = createTestLlmRequest();
    const httpReq = adapter.buildRequest(request, false);

    // No auth header
    assert.equal(httpReq.headers['authorization'], undefined);
  });
});

// ============================================================================
// 21. mapOllamaFinishReason unit tests
// ============================================================================

describe('Sprint 5C: Ollama mapOllamaFinishReason', () => {
  it('maps stop -> stop', () => {
    assert.equal(mapOllamaFinishReason('stop', false), 'stop');
  });

  it('maps length -> length', () => {
    assert.equal(mapOllamaFinishReason('length', false), 'length');
  });

  it('maps undefined -> stop (default)', () => {
    assert.equal(mapOllamaFinishReason(undefined, false), 'stop');
  });

  it('hasToolCalls overrides to tool_use', () => {
    assert.equal(mapOllamaFinishReason('stop', true), 'tool_use');
    assert.equal(mapOllamaFinishReason(undefined, true), 'tool_use');
  });
});
