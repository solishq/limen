/**
 * Limen v1.0 — Phase 5 Sprint 5B: OpenAI + Google Adapters
 * Contract tests for openai_compat, openai_adapter, and gemini_adapter.
 *
 * Spec ref: §25.4 (LLM Gateway), §27 (Streaming), I-01 (no SDK deps), I-04 (provider independence)
 * Security: C-SEC-P5-01/02 (API key never in logs/errors), C-SEC-P5-03 (URL scrubbing),
 *           C-SEC-P5-22 (untrusted output), C-SEC-P5-23 (tool call validation)
 * Convergence: CR-5 (reasoning token subtraction — HARD REQUIREMENT)
 * Amendments: A21 (rejection-path testing), A22 (wiring manifest)
 *
 * Test Categories:
 *   1. OpenAI compat: CR-5 enforcement (THE most important tests)
 *   2. OpenAI compat: basic request/response translation
 *   3. OpenAI compat: tool call validation (C-SEC-P5-23)
 *   4. OpenAI adapter: dual API selection
 *   5. OpenAI adapter: Responses API field mapping
 *   6. OpenAI adapter: streaming
 *   7. OpenAI adapter: retryable status codes
 *   8. Gemini adapter: URL construction with key in query param
 *   9. Gemini adapter: C-SEC-P5-03 URL scrubbing (CRITICAL tests)
 *  10. Gemini adapter: request translation (contents/parts format)
 *  11. Gemini adapter: response parsing
 *  12. Gemini adapter: thinking → deliberation (thoughtsTokenCount)
 *  13. Gemini adapter: tool call parsing (functionCall)
 *  14. Gemini adapter: streaming
 *  15. API key handling for both providers
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// OpenAI compat
import {
  buildOpenAICompatRequest,
  parseOpenAICompatResponse,
  validateToolCall as openaiValidateToolCall,
  mapOpenAIFinishReason,
  TOOL_NAME_PATTERN as OPENAI_TOOL_NAME_PATTERN,
} from '../../src/substrate/transport/adapters/openai_compat.js';

// OpenAI adapter
import {
  createOpenAIAdapter,
  createOpenAIAdapterFromEnv,
  isReasoningModel,
  RETRYABLE_STATUS_CODES as OPENAI_RETRYABLE,
} from '../../src/substrate/transport/adapters/openai_adapter.js';

// Gemini adapter
import {
  createGeminiAdapter,
  createGeminiAdapterFromEnv,
  scrubUrl,
  validateGeminiFunctionCall,
  mapGeminiFinishReason,
  RETRYABLE_STATUS_CODES as GEMINI_RETRYABLE,
} from '../../src/substrate/transport/adapters/gemini_adapter.js';

// Types
import type {
  TransportHttpResponse,
  TransportResult,
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
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello' }],
    maxTokens: 1024,
    ...overrides,
  };
}

/** Build a mock OpenAI Chat Completions response body */
function buildChatCompletionResponse(opts: {
  content?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  finishReason?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}): string {
  const usage: Record<string, unknown> = {
    prompt_tokens: opts.promptTokens ?? 10,
    completion_tokens: opts.completionTokens ?? 20,
    total_tokens: (opts.promptTokens ?? 10) + (opts.completionTokens ?? 20),
  };

  if (opts.reasoningTokens !== undefined && opts.reasoningTokens > 0) {
    usage.completion_tokens_details = {
      reasoning_tokens: opts.reasoningTokens,
    };
  }

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
    model: opts.model ?? 'gpt-4o-2024-05-13',
    choices: [{
      index: 0,
      message,
      finish_reason: opts.finishReason ?? 'stop',
    }],
    usage,
  });
}

/** Build a mock Gemini response body */
function buildGeminiResponse(opts: {
  text?: string;
  model?: string;
  promptTokens?: number;
  candidateTokens?: number;
  thoughtsTokenCount?: number;
  finishReason?: string;
  functionCalls?: Array<{ name: string; args: Record<string, unknown> }>;
}): string {
  const parts: Array<Record<string, unknown>> = [];

  if (opts.text !== undefined) {
    parts.push({ text: opts.text });
  }

  if (opts.functionCalls) {
    for (const fc of opts.functionCalls) {
      parts.push({
        functionCall: {
          name: fc.name,
          args: fc.args,
        },
      });
    }
  }

  if (parts.length === 0) {
    parts.push({ text: 'Hello there!' });
  }

  const usageMetadata: Record<string, unknown> = {
    promptTokenCount: opts.promptTokens ?? 10,
    candidatesTokenCount: opts.candidateTokens ?? 20,
    totalTokenCount: (opts.promptTokens ?? 10) + (opts.candidateTokens ?? 20),
  };

  if (opts.thoughtsTokenCount !== undefined && opts.thoughtsTokenCount > 0) {
    usageMetadata.thoughtsTokenCount = opts.thoughtsTokenCount;
  }

  return JSON.stringify({
    candidates: [{
      content: {
        parts,
        role: 'model',
      },
      finishReason: opts.finishReason ?? 'STOP',
    }],
    usageMetadata,
    modelVersion: opts.model ?? 'gemini-1.5-pro',
  });
}

// ============================================================================
// 1. OpenAI Compat: CR-5 Enforcement (THE MOST IMPORTANT TESTS)
// ============================================================================

describe('Sprint 5B: OpenAI Compat — CR-5 Reasoning Token Subtraction', () => {
  it('A21-SUCCESS: outputTokens = completion_tokens - reasoning_tokens when reasoning_tokens present', () => {
    const completionTokens = 500;
    const reasoningTokens = 200;
    const expectedOutput = completionTokens - reasoningTokens; // 300

    const body = buildChatCompletionResponse({
      completionTokens,
      reasoningTokens,
      promptTokens: 100,
    });

    const httpResponse: TransportHttpResponse = {
      status: 200,
      headers: {},
      body,
    };

    const result = parseOpenAICompatResponse(httpResponse, 'openai');

    // CR-5: outputTokens MUST be completion_tokens - reasoning_tokens
    assert.equal(result.response.usage.outputTokens, expectedOutput,
      `outputTokens must be ${completionTokens} - ${reasoningTokens} = ${expectedOutput}`);

    // CR-5: providerOutputTokens MUST be raw completion_tokens (before subtraction)
    assert.equal(result.response.usage.providerOutputTokens, completionTokens,
      `providerOutputTokens must be raw completion_tokens: ${completionTokens}`);

    // CR-5: deliberation tokens
    assert.equal(result.deliberation.deliberationTokens, reasoningTokens,
      `deliberationTokens must equal reasoning_tokens: ${reasoningTokens}`);
    assert.equal(result.deliberation.accountingMode, 'provider_authoritative');
    assert.equal(result.deliberation.providerReportedThinkingTokens, reasoningTokens);
  });

  it('A21-REJECTION: outputTokens = completion_tokens when no reasoning_tokens', () => {
    const completionTokens = 500;

    const body = buildChatCompletionResponse({
      completionTokens,
      promptTokens: 100,
      // No reasoningTokens
    });

    const httpResponse: TransportHttpResponse = {
      status: 200,
      headers: {},
      body,
    };

    const result = parseOpenAICompatResponse(httpResponse, 'openai');

    // No reasoning tokens → outputTokens = completion_tokens (no subtraction)
    assert.equal(result.response.usage.outputTokens, completionTokens,
      `outputTokens must equal completion_tokens when no reasoning: ${completionTokens}`);

    // providerOutputTokens also equals completion_tokens
    assert.equal(result.response.usage.providerOutputTokens, completionTokens);

    // Deliberation should be estimated with 0 tokens
    assert.equal(result.deliberation.deliberationTokens, 0);
    assert.equal(result.deliberation.accountingMode, 'estimated');
    assert.equal(result.deliberation.providerReportedThinkingTokens, null);
  });

  it('CR-5 discriminative: subtraction produces different value than raw', () => {
    // This test verifies that the subtraction IS happening — if removed,
    // outputTokens would equal completionTokens (1000), not 700.
    const completionTokens = 1000;
    const reasoningTokens = 300;

    const body = buildChatCompletionResponse({
      completionTokens,
      reasoningTokens,
    });

    const httpResponse: TransportHttpResponse = {
      status: 200,
      headers: {},
      body,
    };

    const result = parseOpenAICompatResponse(httpResponse, 'openai');

    // The subtraction MUST produce a different value than the raw completion_tokens
    assert.notEqual(result.response.usage.outputTokens, completionTokens,
      'outputTokens must NOT equal raw completion_tokens when reasoning_tokens present');
    assert.equal(result.response.usage.outputTokens, completionTokens - reasoningTokens,
      'outputTokens must be completion_tokens - reasoning_tokens');

    // And providerOutputTokens MUST still be the raw value
    assert.equal(result.response.usage.providerOutputTokens, completionTokens,
      'providerOutputTokens must be raw completion_tokens');
  });

  it('CR-5: reasoning_tokens = 0 treated as no reasoning', () => {
    const body = buildChatCompletionResponse({
      completionTokens: 200,
      reasoningTokens: 0,
    });

    const httpResponse: TransportHttpResponse = {
      status: 200,
      headers: {},
      body,
    };

    const result = parseOpenAICompatResponse(httpResponse, 'openai');

    // reasoning_tokens = 0 → no subtraction
    assert.equal(result.response.usage.outputTokens, 200);
    assert.equal(result.deliberation.deliberationTokens, 0);
    assert.equal(result.deliberation.accountingMode, 'estimated');
  });

  it('CR-5: large reasoning tokens subtracted correctly', () => {
    // Edge case: reasoning_tokens is most of the completion
    const completionTokens = 10000;
    const reasoningTokens = 9500;

    const body = buildChatCompletionResponse({
      completionTokens,
      reasoningTokens,
    });

    const httpResponse: TransportHttpResponse = {
      status: 200,
      headers: {},
      body,
    };

    const result = parseOpenAICompatResponse(httpResponse, 'openai');

    assert.equal(result.response.usage.outputTokens, 500); // 10000 - 9500
    assert.equal(result.response.usage.providerOutputTokens, 10000);
    assert.equal(result.deliberation.deliberationTokens, 9500);
  });
});

// ============================================================================
// 2. OpenAI Compat: Basic Request/Response Translation
// ============================================================================

describe('Sprint 5B: OpenAI Compat — Request Translation', () => {
  it('builds Chat Completions request with correct structure', () => {
    const request = createTestLlmRequest({
      model: 'gpt-4o',
      systemPrompt: 'You are helpful.',
      temperature: 0.7,
      maxTokens: 2048,
    });

    const httpReq = buildOpenAICompatRequest(
      request,
      false,
      'https://api.openai.com/v1/chat/completions',
      { 'content-type': 'application/json', 'authorization': 'Bearer sk-test' },
    );

    assert.equal(httpReq.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(httpReq.method, 'POST');
    assert.equal(httpReq.stream, false);
    assert.equal(httpReq.headers['authorization'], 'Bearer sk-test');

    // Body structure
    assert.equal(httpReq.body.model, 'gpt-4o');
    assert.equal(httpReq.body.max_tokens, 2048);
    assert.equal(httpReq.body.temperature, 0.7);

    const messages = httpReq.body.messages as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(messages));
    // System prompt becomes first system message
    assert.equal(messages[0]?.role, 'system');
    assert.equal(messages[0]?.content, 'You are helpful.');
    // User message
    assert.equal(messages[1]?.role, 'user');
    assert.equal(messages[1]?.content, 'Hello');
  });

  it('builds streaming request with stream_options', () => {
    const request = createTestLlmRequest();

    const httpReq = buildOpenAICompatRequest(
      request,
      true,
      'https://api.openai.com/v1/chat/completions',
      { 'content-type': 'application/json' },
    );

    assert.equal(httpReq.stream, true);
    assert.equal(httpReq.body.stream, true);
    assert.deepStrictEqual(
      httpReq.body.stream_options,
      { include_usage: true },
    );
  });

  it('includes tools in OpenAI format', () => {
    const request = createTestLlmRequest({
      tools: [{
        name: 'get_weather',
        description: 'Get the weather',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      }],
    });

    const httpReq = buildOpenAICompatRequest(request, false, 'https://test.com', {});

    const tools = httpReq.body.tools as Array<Record<string, unknown>>;
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.type, 'function');
    const fn = (tools[0] as Record<string, unknown>).function as Record<string, unknown>;
    assert.equal(fn.name, 'get_weather');
  });
});

describe('Sprint 5B: OpenAI Compat — Response Parsing', () => {
  it('parses basic response correctly', () => {
    const body = buildChatCompletionResponse({
      content: 'Hello!',
      promptTokens: 15,
      completionTokens: 5,
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = parseOpenAICompatResponse(httpResponse, 'openai');

    assert.equal(result.response.content, 'Hello!');
    assert.equal(result.response.usage.inputTokens, 15);
    assert.equal(result.response.usage.outputTokens, 5);
    assert.equal(result.response.finishReason, 'stop');
    assert.equal(result.response.providerId, 'openai');
  });

  it('maps finish_reason correctly', () => {
    assert.equal(mapOpenAIFinishReason('stop'), 'stop');
    assert.equal(mapOpenAIFinishReason('length'), 'length');
    assert.equal(mapOpenAIFinishReason('tool_calls'), 'tool_use');
    assert.equal(mapOpenAIFinishReason('content_filter'), 'content_filter');
    assert.equal(mapOpenAIFinishReason(undefined), 'stop');
    assert.equal(mapOpenAIFinishReason('unknown'), 'stop');
  });

  it('rejects invalid JSON', () => {
    const httpResponse: TransportHttpResponse = {
      status: 200,
      headers: {},
      body: 'not json',
    };

    assert.throws(
      () => parseOpenAICompatResponse(httpResponse, 'openai'),
      /JSON parse error/,
    );
  });

  it('rejects missing choices array', () => {
    const httpResponse: TransportHttpResponse = {
      status: 200,
      headers: {},
      body: JSON.stringify({ model: 'gpt-4o' }),
    };

    assert.throws(
      () => parseOpenAICompatResponse(httpResponse, 'openai'),
      /missing choices array/,
    );
  });
});

// ============================================================================
// 3. OpenAI Compat: Tool Call Validation (C-SEC-P5-23)
// ============================================================================

describe('Sprint 5B: OpenAI Compat — Tool Call Validation (C-SEC-P5-23)', () => {
  it('A21-SUCCESS: validates valid tool call', () => {
    const tc = {
      id: 'call_123',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: '{"city": "London"}',
      },
    };

    const result = openaiValidateToolCall(tc);
    assert.ok(result);
    assert.equal(result.id, 'call_123');
    assert.equal(result.name, 'get_weather');
    assert.deepStrictEqual(result.input, { city: 'London' });
  });

  it('A21-REJECTION: rejects empty id', () => {
    const tc = {
      id: '',
      function: { name: 'test', arguments: '{}' },
    };
    assert.equal(openaiValidateToolCall(tc), null);
  });

  it('A21-REJECTION: rejects missing function', () => {
    const tc = { id: 'call_1' };
    assert.equal(openaiValidateToolCall(tc), null);
  });

  it('A21-REJECTION: rejects invalid function name', () => {
    const tc = {
      id: 'call_1',
      function: { name: '123invalid', arguments: '{}' },
    };
    assert.equal(openaiValidateToolCall(tc), null);
  });

  it('A21-REJECTION: rejects non-object arguments', () => {
    const tc = {
      id: 'call_1',
      function: { name: 'test', arguments: '"a string"' },
    };
    assert.equal(openaiValidateToolCall(tc), null);
  });

  it('A21-REJECTION: rejects array arguments', () => {
    const tc = {
      id: 'call_1',
      function: { name: 'test', arguments: '[1,2,3]' },
    };
    assert.equal(openaiValidateToolCall(tc), null);
  });

  it('A21-REJECTION: rejects unparseable arguments', () => {
    const tc = {
      id: 'call_1',
      function: { name: 'test', arguments: 'not json' },
    };
    assert.equal(openaiValidateToolCall(tc), null);
  });

  it('parses tool calls from response correctly', () => {
    const body = buildChatCompletionResponse({
      content: null as unknown as string,
      finishReason: 'tool_calls',
      toolCalls: [{
        id: 'call_abc',
        name: 'get_weather',
        arguments: '{"city": "NYC"}',
      }],
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = parseOpenAICompatResponse(httpResponse, 'openai');

    assert.equal(result.response.toolCalls.length, 1);
    assert.equal(result.response.toolCalls[0]!.id, 'call_abc');
    assert.equal(result.response.toolCalls[0]!.name, 'get_weather');
    assert.deepStrictEqual(result.response.toolCalls[0]!.input, { city: 'NYC' });
    assert.equal(result.response.finishReason, 'tool_use');
  });

  it('silently drops invalid tool calls (C-SEC-P5-22)', () => {
    const body = JSON.stringify({
      model: 'gpt-4o',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: '', function: { name: 'test', arguments: '{}' } },  // empty id
            { id: 'call_2', function: { name: '123bad', arguments: '{}' } },  // bad name
            { id: 'call_3', function: { name: 'valid_fn', arguments: '{"ok": true}' } },  // valid
          ],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = parseOpenAICompatResponse(httpResponse, 'openai');

    // Only the valid tool call should be included
    assert.equal(result.response.toolCalls.length, 1);
    assert.equal(result.response.toolCalls[0]!.name, 'valid_fn');
  });
});

// ============================================================================
// 4. OpenAI Adapter: Dual API Selection
// ============================================================================

describe('Sprint 5B: OpenAI Adapter — Dual API Selection (A-P5-006)', () => {
  it('gpt-4o uses Chat Completions API (/v1/chat/completions)', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'gpt-4o');
    const request = createTestLlmRequest({ model: 'gpt-4o' });
    const httpReq = adapter.buildRequest(request, false);

    assert.ok(httpReq.url.includes('/v1/chat/completions'),
      `URL must contain /v1/chat/completions, got: ${httpReq.url}`);
    assert.ok(!httpReq.url.includes('/v1/responses'),
      'URL must NOT contain /v1/responses for gpt-4o');
  });

  it('o3-mini uses Responses API (/v1/responses)', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'o3-mini');
    const request = createTestLlmRequest({ model: 'o3-mini' });
    const httpReq = adapter.buildRequest(request, false);

    assert.ok(httpReq.url.includes('/v1/responses'),
      `URL must contain /v1/responses, got: ${httpReq.url}`);
    assert.ok(!httpReq.url.includes('/v1/chat/completions'),
      'URL must NOT contain /v1/chat/completions for o3-mini');
  });

  it('o4-mini uses Responses API (/v1/responses)', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'o4-mini');
    const request = createTestLlmRequest({ model: 'o4-mini' });
    const httpReq = adapter.buildRequest(request, false);

    assert.ok(httpReq.url.includes('/v1/responses'),
      `URL must contain /v1/responses for o4-mini, got: ${httpReq.url}`);
  });

  it('isReasoningModel correctly identifies reasoning models', () => {
    assert.equal(isReasoningModel('o3-mini'), true);
    assert.equal(isReasoningModel('o3'), true);
    assert.equal(isReasoningModel('o4-mini'), true);
    assert.equal(isReasoningModel('o4'), true);
    assert.equal(isReasoningModel('gpt-4o'), false);
    assert.equal(isReasoningModel('gpt-4o-mini'), false);
    assert.equal(isReasoningModel('gpt-3.5-turbo'), false);
    assert.equal(isReasoningModel('claude-3-opus'), false);
  });

  it('reasoning model adapter returns supportsStreaming() = false', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'o3-mini');
    assert.equal(adapter.supportsStreaming(), false);
  });

  it('non-reasoning model adapter returns supportsStreaming() = true', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'gpt-4o');
    assert.equal(adapter.supportsStreaming(), true);
  });
});

// ============================================================================
// 5. OpenAI Adapter: Responses API Field Mapping
// ============================================================================

describe('Sprint 5B: OpenAI Adapter — Responses API Field Mapping', () => {
  it('uses "input" instead of "messages"', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'o3-mini');
    const request = createTestLlmRequest({
      model: 'o3-mini',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    const httpReq = adapter.buildRequest(request, false);
    assert.ok(httpReq.body.input !== undefined, 'Must have "input" field');
    assert.equal(httpReq.body.messages, undefined, 'Must NOT have "messages" field');
  });

  it('uses "instructions" instead of system message', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'o3-mini');
    const request = createTestLlmRequest({
      model: 'o3-mini',
      systemPrompt: 'You are a helpful assistant.',
    });

    const httpReq = adapter.buildRequest(request, false);
    assert.equal(httpReq.body.instructions, 'You are a helpful assistant.');
  });

  it('uses "max_output_tokens" instead of "max_tokens"', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'o3-mini');
    const request = createTestLlmRequest({ model: 'o3-mini', maxTokens: 4096 });

    const httpReq = adapter.buildRequest(request, false);
    assert.equal(httpReq.body.max_output_tokens, 4096);
    assert.equal(httpReq.body.max_tokens, undefined, 'Must NOT have "max_tokens" field');
  });

  it('Responses API request is never streaming', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'o3-mini');
    const request = createTestLlmRequest({ model: 'o3-mini' });

    // Even if streaming=true is passed, Responses API should not stream
    const httpReq = adapter.buildRequest(request, true);
    assert.equal(httpReq.stream, false, 'Responses API request must never be streaming');
    assert.equal(httpReq.body.stream, undefined, 'No stream flag in body');
  });

  it('parses Responses API response correctly', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'o3-mini');
    const responseBody = JSON.stringify({
      id: 'resp_test',
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'Reasoning response here.' }],
      }],
      usage: {
        input_tokens: 50,
        output_tokens: 300,
        output_tokens_details: {
          reasoning_tokens: 200,
        },
      },
      model: 'o3-mini-2024-07-18',
      status: 'completed',
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body: responseBody };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.content, 'Reasoning response here.');
    assert.equal(result.response.usage.inputTokens, 50);
    // CR-5: outputTokens = 300 - 200 = 100
    assert.equal(result.response.usage.outputTokens, 100);
    assert.equal(result.response.usage.providerOutputTokens, 300);
    assert.equal(result.deliberation.deliberationTokens, 200);
    assert.equal(result.deliberation.accountingMode, 'provider_authoritative');
  });
});

// ============================================================================
// 6. OpenAI Adapter: Streaming
// ============================================================================

describe('Sprint 5B: OpenAI Adapter — Streaming', () => {
  it('parses content_delta from SSE stream', async () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'gpt-4o');

    const sseChunks = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      'data: [DONE]\n\n',
    ];

    const stream = createMockStream(sseChunks);
    const result = adapter.parseStream(stream);

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    // Should have 2 content_deltas and 1 done
    const contentDeltas = chunks.filter(c => c.type === 'content_delta');
    assert.equal(contentDeltas.length, 2);
    assert.equal((contentDeltas[0] as { type: 'content_delta'; delta: string }).delta, 'Hello');
    assert.equal((contentDeltas[1] as { type: 'content_delta'; delta: string }).delta, ' world');

    const doneChunks = chunks.filter(c => c.type === 'done');
    assert.equal(doneChunks.length, 1);
    assert.equal((doneChunks[0] as { type: 'done'; finishReason: string }).finishReason, 'stop');
  });

  it('parses tool_call_delta from SSE stream', async () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'gpt-4o');

    const sseChunks = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '' } }] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"city' } }] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '": "NYC"}' } }] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
      'data: [DONE]\n\n',
    ];

    const stream = createMockStream(sseChunks);
    const result = adapter.parseStream(stream);

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    const toolDeltas = chunks.filter(c => c.type === 'tool_call_delta');
    assert.ok(toolDeltas.length >= 2, `Expected >= 2 tool_call_deltas, got ${toolDeltas.length}`);

    const doneChunks = chunks.filter(c => c.type === 'done');
    assert.equal(doneChunks.length, 1);
    assert.equal((doneChunks[0] as { type: 'done'; finishReason: string }).finishReason, 'tool_use');
  });

  it('parses usage from SSE stream with CR-5 reasoning tokens', async () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'gpt-4o');

    const sseChunks = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      `data: ${JSON.stringify({
        choices: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 500,
          completion_tokens_details: { reasoning_tokens: 200 },
        },
      })}\n\n`,
      'data: [DONE]\n\n',
    ];

    const stream = createMockStream(sseChunks);
    const result = adapter.parseStream(stream);

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    const usageChunks = chunks.filter(c => c.type === 'usage');
    assert.equal(usageChunks.length, 1);
    const usageChunk = usageChunks[0] as { type: 'usage'; inputTokens: number; outputTokens: number };
    assert.equal(usageChunk.inputTokens, 100);
    // CR-5: outputTokens = 500 - 200 = 300
    assert.equal(usageChunk.outputTokens, 300,
      'Streaming usage must apply CR-5 subtraction');

    // Deliberation should be set after stream completes
    const deliberation = result.getDeliberation();
    assert.equal(deliberation.deliberationTokens, 200);
    assert.equal(deliberation.accountingMode, 'provider_authoritative');
  });
});

// ============================================================================
// 7. OpenAI Adapter: Retryable Status Codes
// ============================================================================

describe('Sprint 5B: OpenAI Adapter — Retryable Status Codes', () => {
  it('429 is retryable', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'gpt-4o');
    assert.equal(adapter.isRetryableStatus(429), true);
  });

  it('500 is retryable', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'gpt-4o');
    assert.equal(adapter.isRetryableStatus(500), true);
  });

  it('502 is retryable', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'gpt-4o');
    assert.equal(adapter.isRetryableStatus(502), true);
  });

  it('503 is retryable', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'gpt-4o');
    assert.equal(adapter.isRetryableStatus(503), true);
  });

  it('400 is NOT retryable', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'gpt-4o');
    assert.equal(adapter.isRetryableStatus(400), false);
  });

  it('401 is NOT retryable', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'gpt-4o');
    assert.equal(adapter.isRetryableStatus(401), false);
  });

  it('403 is NOT retryable', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'gpt-4o');
    assert.equal(adapter.isRetryableStatus(403), false);
  });
});

// ============================================================================
// 8. Gemini Adapter: URL Construction
// ============================================================================

describe('Sprint 5B: Gemini Adapter — URL Construction', () => {
  it('non-streaming URL includes model and key', () => {
    const adapter = createGeminiAdapter('gemini', 'https://generativelanguage.googleapis.com', 'AIzaTest123');
    const request = createTestLlmRequest({ model: 'gemini-1.5-pro' });

    const httpReq = adapter.buildRequest(request, false);

    assert.ok(httpReq.url.includes('v1beta/models/gemini-1.5-pro:generateContent'),
      `URL must include model name and generateContent, got: ${scrubUrl(httpReq.url)}`);
    assert.ok(httpReq.url.includes('key=AIzaTest123'),
      'URL must include API key in query param');
    assert.ok(!httpReq.url.includes('alt=sse'),
      'Non-streaming URL must NOT include alt=sse');
  });

  it('streaming URL includes alt=sse', () => {
    const adapter = createGeminiAdapter('gemini', 'https://generativelanguage.googleapis.com', 'AIzaTest123');
    const request = createTestLlmRequest({ model: 'gemini-1.5-pro' });

    const httpReq = adapter.buildRequest(request, true);

    assert.ok(httpReq.url.includes('streamGenerateContent'),
      `Streaming URL must use streamGenerateContent, got: ${scrubUrl(httpReq.url)}`);
    assert.ok(httpReq.url.includes('alt=sse'),
      'Streaming URL must include alt=sse');
    assert.ok(httpReq.url.includes('key=AIzaTest123'),
      'Streaming URL must include API key');
  });

  it('no Authorization header (key is in URL)', () => {
    const adapter = createGeminiAdapter('gemini', 'https://generativelanguage.googleapis.com', 'AIzaTest123');
    const request = createTestLlmRequest({ model: 'gemini-1.5-pro' });

    const httpReq = adapter.buildRequest(request, false);

    assert.equal(httpReq.headers['authorization'], undefined, 'No Authorization header for Gemini');
    assert.equal(httpReq.headers['content-type'], 'application/json');
  });
});

// ============================================================================
// 9. Gemini Adapter: C-SEC-P5-03 URL Scrubbing (CRITICAL)
// ============================================================================

describe('Sprint 5B: Gemini Adapter — C-SEC-P5-03 URL Scrubbing', () => {
  it('A21-SUCCESS: scrubUrl removes API key from URL', () => {
    const url = 'https://api.example.com/v1beta/models/gemini:generateContent?key=AIzaSyDtest123ABC';
    const scrubbed = scrubUrl(url);

    assert.ok(!scrubbed.includes('AIzaSyDtest123ABC'),
      'Scrubbed URL must NOT contain the API key');
    assert.ok(scrubbed.includes('key=[REDACTED]'),
      'Scrubbed URL must contain key=[REDACTED]');
    assert.ok(scrubbed.includes('v1beta/models/gemini:generateContent'),
      'Scrubbed URL must preserve URL structure');
  });

  it('A21-REJECTION: scrubUrl preserves URL structure', () => {
    const url = 'https://api.example.com/v1beta/models/gemini:streamGenerateContent?key=SECRET&alt=sse';
    const scrubbed = scrubUrl(url);

    assert.ok(!scrubbed.includes('SECRET'),
      'Scrubbed URL must NOT contain the key value');
    assert.ok(scrubbed.includes('key=[REDACTED]'),
      'Must replace key value with [REDACTED]');
    assert.ok(scrubbed.includes('alt=sse'),
      'Must preserve other query parameters');
    assert.ok(scrubbed.includes('streamGenerateContent'),
      'Must preserve URL path');
  });

  it('scrubUrl handles URL with key in middle of params', () => {
    const url = 'https://api.example.com/path?foo=bar&key=MY_SECRET&baz=qux';
    const scrubbed = scrubUrl(url);

    assert.ok(!scrubbed.includes('MY_SECRET'));
    assert.ok(scrubbed.includes('key=[REDACTED]'));
    assert.ok(scrubbed.includes('foo=bar'));
    assert.ok(scrubbed.includes('baz=qux'));
  });

  it('scrubUrl handles URL with only key param', () => {
    const url = 'https://api.example.com/path?key=ONLY_KEY';
    const scrubbed = scrubUrl(url);

    assert.ok(!scrubbed.includes('ONLY_KEY'));
    assert.ok(scrubbed.includes('key=[REDACTED]'));
  });

  it('API key does NOT appear in error thrown by adapter on bad JSON', () => {
    const apiKey = 'AIzaSyD_super_secret_key_12345';
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', apiKey);
    const request = createTestLlmRequest({ model: 'gemini-1.5-pro' });

    // Build a request (this puts the key in the URL)
    const httpReq = adapter.buildRequest(request, false);
    assert.ok(httpReq.url.includes(apiKey), 'TransportHttpRequest.url must contain real key');

    // Parse a bad response
    const badResponse: TransportHttpResponse = {
      status: 200,
      headers: {},
      body: 'not json at all',
    };

    let thrownError: Error | null = null;
    try {
      adapter.parseResponse(badResponse);
    } catch (e) {
      thrownError = e as Error;
    }

    assert.ok(thrownError, 'Should throw on bad JSON');
    assert.ok(!thrownError.message.includes(apiKey),
      `Error message must NOT contain API key. Got: ${thrownError.message}`);
  });

  it('API key does NOT appear in error thrown by adapter on missing candidates', () => {
    const apiKey = 'AIzaSyD_another_secret_456';
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', apiKey);

    const badResponse: TransportHttpResponse = {
      status: 200,
      headers: {},
      body: JSON.stringify({ modelVersion: 'gemini-1.5-pro' }),
    };

    let thrownError: Error | null = null;
    try {
      adapter.parseResponse(badResponse);
    } catch (e) {
      thrownError = e as Error;
    }

    assert.ok(thrownError, 'Should throw on missing candidates');
    assert.ok(!thrownError.message.includes(apiKey),
      `Error message must NOT contain API key. Got: ${thrownError.message}`);
  });
});

// ============================================================================
// 10. Gemini Adapter: Request Translation (contents/parts)
// ============================================================================

describe('Sprint 5B: Gemini Adapter — Request Translation', () => {
  it('translates messages to contents[].parts[] format', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');
    const request = createTestLlmRequest({
      model: 'gemini-1.5-pro',
      messages: [
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: 'The answer is 4.' },
        { role: 'user', content: 'Thanks!' },
      ],
    });

    const httpReq = adapter.buildRequest(request, false);
    const contents = httpReq.body.contents as Array<Record<string, unknown>>;

    assert.equal(contents.length, 3);
    assert.equal(contents[0]!.role, 'user');
    assert.equal(contents[1]!.role, 'model'); // 'assistant' → 'model'
    assert.equal(contents[2]!.role, 'user');

    const firstParts = contents[0]!.parts as Array<Record<string, unknown>>;
    assert.equal(firstParts[0]!.text, 'What is 2+2?');
  });

  it('system prompt goes into systemInstruction field', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');
    const request = createTestLlmRequest({
      model: 'gemini-1.5-pro',
      systemPrompt: 'You are a math tutor.',
    });

    const httpReq = adapter.buildRequest(request, false);

    const sysInstruction = httpReq.body.systemInstruction as Record<string, unknown>;
    assert.ok(sysInstruction, 'Must have systemInstruction');
    const parts = sysInstruction.parts as Array<Record<string, unknown>>;
    assert.equal(parts[0]!.text, 'You are a math tutor.');
  });

  it('maxTokens maps to generationConfig.maxOutputTokens', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');
    const request = createTestLlmRequest({
      model: 'gemini-1.5-pro',
      maxTokens: 8192,
    });

    const httpReq = adapter.buildRequest(request, false);
    const genConfig = httpReq.body.generationConfig as Record<string, unknown>;
    assert.equal(genConfig.maxOutputTokens, 8192);
  });

  it('temperature maps to generationConfig.temperature', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');
    const request = createTestLlmRequest({
      model: 'gemini-1.5-pro',
      temperature: 0.3,
    });

    const httpReq = adapter.buildRequest(request, false);
    const genConfig = httpReq.body.generationConfig as Record<string, unknown>;
    assert.equal(genConfig.temperature, 0.3);
  });

  it('tools map to tools[].functionDeclarations[]', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');
    const request = createTestLlmRequest({
      model: 'gemini-1.5-pro',
      tools: [{
        name: 'search',
        description: 'Search the web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      }],
    });

    const httpReq = adapter.buildRequest(request, false);
    const tools = httpReq.body.tools as Array<Record<string, unknown>>;
    assert.equal(tools.length, 1);
    const decls = tools[0]!.functionDeclarations as Array<Record<string, unknown>>;
    assert.equal(decls.length, 1);
    assert.equal(decls[0]!.name, 'search');
    assert.equal(decls[0]!.description, 'Search the web');
  });
});

// ============================================================================
// 11. Gemini Adapter: Response Parsing
// ============================================================================

describe('Sprint 5B: Gemini Adapter — Response Parsing', () => {
  it('parses basic text response', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');
    const body = buildGeminiResponse({ text: 'Hello from Gemini!' });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.content, 'Hello from Gemini!');
    assert.equal(result.response.providerId, 'gemini');
  });

  it('parses usage metadata correctly', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');
    const body = buildGeminiResponse({
      promptTokens: 25,
      candidateTokens: 50,
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.usage.inputTokens, 25);
    assert.equal(result.response.usage.outputTokens, 50);
    assert.equal(result.response.usage.providerInputTokens, 25);
    assert.equal(result.response.usage.providerOutputTokens, 50);
  });

  it('maps finish reasons correctly', () => {
    assert.equal(mapGeminiFinishReason('STOP', false), 'stop');
    assert.equal(mapGeminiFinishReason('STOP', true), 'tool_use');
    assert.equal(mapGeminiFinishReason('MAX_TOKENS', false), 'length');
    assert.equal(mapGeminiFinishReason('SAFETY', false), 'content_filter');
    assert.equal(mapGeminiFinishReason('RECITATION', false), 'content_filter');
    assert.equal(mapGeminiFinishReason(undefined, false), 'stop');
  });

  it('rejects invalid JSON', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');
    const httpResponse: TransportHttpResponse = {
      status: 200,
      headers: {},
      body: 'not json',
    };

    assert.throws(
      () => adapter.parseResponse(httpResponse),
      /JSON parse error/,
    );
  });

  it('rejects missing candidates', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');
    const httpResponse: TransportHttpResponse = {
      status: 200,
      headers: {},
      body: JSON.stringify({ usageMetadata: {} }),
    };

    assert.throws(
      () => adapter.parseResponse(httpResponse),
      /missing candidates/,
    );
  });
});

// ============================================================================
// 12. Gemini Adapter: Thinking → Deliberation
// ============================================================================

describe('Sprint 5B: Gemini Adapter — Thinking/Deliberation', () => {
  it('A21-SUCCESS: thoughtsTokenCount sets provider_authoritative deliberation', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');
    const body = buildGeminiResponse({
      thoughtsTokenCount: 150,
      candidateTokens: 200,
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.deliberation.deliberationTokens, 150);
    assert.equal(result.deliberation.accountingMode, 'provider_authoritative');
    assert.equal(result.deliberation.providerReportedThinkingTokens, 150);
  });

  it('A21-REJECTION: no thoughtsTokenCount sets estimated deliberation', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');
    const body = buildGeminiResponse({}); // No thoughtsTokenCount

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.deliberation.deliberationTokens, 0);
    assert.equal(result.deliberation.accountingMode, 'estimated');
    assert.equal(result.deliberation.providerReportedThinkingTokens, null);
  });
});

// ============================================================================
// 13. Gemini Adapter: Tool Call Parsing (functionCall)
// ============================================================================

describe('Sprint 5B: Gemini Adapter — Tool Call Parsing', () => {
  it('A21-SUCCESS: parses valid functionCall', () => {
    const fc = { name: 'get_weather', args: { city: 'London' } };
    const result = validateGeminiFunctionCall(fc, 0);

    assert.ok(result);
    assert.equal(result.id, 'gemini-call-0');
    assert.equal(result.name, 'get_weather');
    assert.deepStrictEqual(result.input, { city: 'London' });
  });

  it('A21-REJECTION: rejects invalid function name', () => {
    const fc = { name: '123bad', args: {} };
    assert.equal(validateGeminiFunctionCall(fc, 0), null);
  });

  it('A21-REJECTION: rejects non-object args', () => {
    const fc = { name: 'test', args: 'not an object' };
    assert.equal(validateGeminiFunctionCall(fc, 0), null);
  });

  it('A21-REJECTION: rejects null args', () => {
    const fc = { name: 'test', args: null };
    assert.equal(validateGeminiFunctionCall(fc, 0), null);
  });

  it('A21-REJECTION: rejects array args', () => {
    const fc = { name: 'test', args: [1, 2, 3] };
    assert.equal(validateGeminiFunctionCall(fc, 0), null);
  });

  it('parses functionCall from response', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');
    const body = buildGeminiResponse({
      functionCalls: [{
        name: 'search_web',
        args: { query: 'weather in London' },
      }],
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.toolCalls.length, 1);
    assert.equal(result.response.toolCalls[0]!.name, 'search_web');
    assert.deepStrictEqual(result.response.toolCalls[0]!.input, { query: 'weather in London' });
    assert.ok(result.response.toolCalls[0]!.id.startsWith('gemini-call-'));
  });

  it('multiple functionCalls in response', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');
    const body = buildGeminiResponse({
      functionCalls: [
        { name: 'func_a', args: { x: 1 } },
        { name: 'func_b', args: { y: 2 } },
      ],
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.toolCalls.length, 2);
    assert.equal(result.response.toolCalls[0]!.name, 'func_a');
    assert.equal(result.response.toolCalls[1]!.name, 'func_b');
    // IDs should be unique
    assert.notEqual(result.response.toolCalls[0]!.id, result.response.toolCalls[1]!.id);
  });
});

// ============================================================================
// 14. Gemini Adapter: Streaming
// ============================================================================

describe('Sprint 5B: Gemini Adapter — Streaming', () => {
  it('parses content_delta from Gemini SSE stream', async () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');

    const sseChunks = [
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Hello' }], role: 'model' } }],
      })}\n\n`,
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: ' from Gemini' }], role: 'model' } }],
      })}\n\n`,
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: '!' }], role: 'model' }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      })}\n\n`,
    ];

    const stream = createMockStream(sseChunks);
    const result = adapter.parseStream(stream);

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    const contentDeltas = chunks.filter(c => c.type === 'content_delta');
    assert.equal(contentDeltas.length, 3);
    assert.equal((contentDeltas[0] as { type: 'content_delta'; delta: string }).delta, 'Hello');
    assert.equal((contentDeltas[1] as { type: 'content_delta'; delta: string }).delta, ' from Gemini');
    assert.equal((contentDeltas[2] as { type: 'content_delta'; delta: string }).delta, '!');

    const usageChunks = chunks.filter(c => c.type === 'usage');
    assert.equal(usageChunks.length, 1);

    const doneChunks = chunks.filter(c => c.type === 'done');
    assert.equal(doneChunks.length, 1);
  });

  it('updates deliberation from streaming usageMetadata with thoughtsTokenCount', async () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');

    const sseChunks = [
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Result' }], role: 'model' }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 50, thoughtsTokenCount: 30 },
      })}\n\n`,
    ];

    const stream = createMockStream(sseChunks);
    const result = adapter.parseStream(stream);

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    const deliberation = result.getDeliberation();
    assert.equal(deliberation.deliberationTokens, 30);
    assert.equal(deliberation.accountingMode, 'provider_authoritative');
    assert.equal(deliberation.providerReportedThinkingTokens, 30);
  });

  it('supportsStreaming returns true', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');
    assert.equal(adapter.supportsStreaming(), true);
  });

  it('parses functionCall in streaming', async () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');

    const sseChunks = [
      `data: ${JSON.stringify({
        candidates: [{
          content: {
            parts: [{ functionCall: { name: 'get_info', args: { id: 42 } } }],
            role: 'model',
          },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10 },
      })}\n\n`,
    ];

    const stream = createMockStream(sseChunks);
    const result = adapter.parseStream(stream);

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    const toolDeltas = chunks.filter(c => c.type === 'tool_call_delta');
    assert.equal(toolDeltas.length, 1);
    const td = toolDeltas[0] as { type: 'tool_call_delta'; toolCallId: string; name: string; inputDelta: string };
    assert.equal(td.name, 'get_info');
    assert.ok(td.toolCallId.startsWith('gemini-call-'));
  });
});

// ============================================================================
// 15. API Key Handling for Both Providers
// ============================================================================

describe('Sprint 5B: API Key Handling', () => {
  it('OpenAI: key resolved at creation, stored in closure (CR-1)', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test-key-123', 'gpt-4o');
    const request = createTestLlmRequest();

    const httpReq = adapter.buildRequest(request, false);
    assert.equal(httpReq.headers['authorization'], 'Bearer sk-test-key-123');
  });

  it('OpenAI: missing key from env throws without key in message (C-SEC-P5-01/02)', () => {
    // Save and clear env
    const envVar = 'CORTEX_TEST_OPENAI_KEY_MISSING_' + Date.now();
    delete process.env[envVar];

    assert.throws(
      () => createOpenAIAdapterFromEnv('openai', 'https://api.openai.com', envVar, 'gpt-4o'),
      (err: Error) => {
        assert.ok(err.message.includes('TRANSPORT_MISSING_API_KEY'));
        assert.ok(err.message.includes('openai'));
        // Must NOT contain any key value
        assert.ok(!err.message.includes('sk-'));
        return true;
      },
    );
  });

  it('OpenAI: adapter from env reads key correctly', () => {
    const envVar = 'CORTEX_TEST_OPENAI_KEY_' + Date.now();
    process.env[envVar] = 'sk-env-test-key';

    try {
      const adapter = createOpenAIAdapterFromEnv('openai', 'https://api.openai.com', envVar, 'gpt-4o');
      const httpReq = adapter.buildRequest(createTestLlmRequest(), false);
      assert.equal(httpReq.headers['authorization'], 'Bearer sk-env-test-key');
    } finally {
      delete process.env[envVar];
    }
  });

  it('Gemini: key resolved at creation, in URL query param (CR-1)', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'AIzaKeyTest');
    const request = createTestLlmRequest({ model: 'gemini-1.5-pro' });

    const httpReq = adapter.buildRequest(request, false);
    assert.ok(httpReq.url.includes('key=AIzaKeyTest'));
  });

  it('Gemini: missing key from env throws without key in message (C-SEC-P5-01/02)', () => {
    const envVar = 'CORTEX_TEST_GEMINI_KEY_MISSING_' + Date.now();
    delete process.env[envVar];

    assert.throws(
      () => createGeminiAdapterFromEnv('gemini', 'https://api.example.com', envVar),
      (err: Error) => {
        assert.ok(err.message.includes('TRANSPORT_MISSING_API_KEY'));
        assert.ok(err.message.includes('gemini'));
        assert.ok(!err.message.includes('AIza'));
        return true;
      },
    );
  });

  it('Gemini: adapter from env reads key correctly', () => {
    const envVar = 'CORTEX_TEST_GEMINI_KEY_' + Date.now();
    process.env[envVar] = 'AIzaEnvTestKey';

    try {
      const adapter = createGeminiAdapterFromEnv('gemini', 'https://api.example.com', envVar);
      const httpReq = adapter.buildRequest(createTestLlmRequest({ model: 'gemini-1.5-pro' }), false);
      assert.ok(httpReq.url.includes('key=AIzaEnvTestKey'));
    } finally {
      delete process.env[envVar];
    }
  });

  it('OpenAI: adapter is Object.freeze\'d (C-07)', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'gpt-4o');
    assert.ok(Object.isFrozen(adapter), 'OpenAI adapter must be frozen');
  });

  it('Gemini: adapter is Object.freeze\'d (C-07)', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'test-key');
    assert.ok(Object.isFrozen(adapter), 'Gemini adapter must be frozen');
  });
});

// ============================================================================
// Gemini Retryable Status Codes
// ============================================================================

describe('Sprint 5B: Gemini Adapter — Retryable Status Codes', () => {
  it('429 is retryable', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'key');
    assert.equal(adapter.isRetryableStatus(429), true);
  });

  it('500 is retryable', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'key');
    assert.equal(adapter.isRetryableStatus(500), true);
  });

  it('502 is retryable', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'key');
    assert.equal(adapter.isRetryableStatus(502), true);
  });

  it('503 is retryable', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'key');
    assert.equal(adapter.isRetryableStatus(503), true);
  });

  it('400 is NOT retryable', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'key');
    assert.equal(adapter.isRetryableStatus(400), false);
  });

  it('401 is NOT retryable', () => {
    const adapter = createGeminiAdapter('gemini', 'https://api.example.com', 'key');
    assert.equal(adapter.isRetryableStatus(401), false);
  });
});

// ============================================================================
// OpenAI Adapter: Additional Edge Cases
// ============================================================================

describe('Sprint 5B: OpenAI Adapter — Edge Cases', () => {
  it('Chat Completions adapter has Authorization header', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-key', 'gpt-4o');
    const req = adapter.buildRequest(createTestLlmRequest(), false);
    assert.equal(req.headers['authorization'], 'Bearer sk-key');
  });

  it('Responses API adapter has Authorization header', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-key', 'o3-mini');
    const req = adapter.buildRequest(createTestLlmRequest({ model: 'o3-mini' }), false);
    assert.equal(req.headers['authorization'], 'Bearer sk-key');
  });

  it('Chat Completions parses response through openai_compat', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-key', 'gpt-4o');

    const body = buildChatCompletionResponse({
      content: 'Test response',
      completionTokens: 100,
      reasoningTokens: 40,
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = adapter.parseResponse(httpResponse);

    // CR-5 enforcement through adapter
    assert.equal(result.response.usage.outputTokens, 60); // 100 - 40
    assert.equal(result.response.usage.providerOutputTokens, 100);
    assert.equal(result.deliberation.deliberationTokens, 40);
  });

  it('providerId is set correctly', () => {
    const adapter = createOpenAIAdapter('my-openai', 'https://api.openai.com', 'sk-key', 'gpt-4o');
    assert.equal(adapter.providerId, 'my-openai');
  });

  it('Gemini providerId is set correctly', () => {
    const adapter = createGeminiAdapter('my-gemini', 'https://api.example.com', 'key');
    assert.equal(adapter.providerId, 'my-gemini');
  });
});

// ============================================================================
// F-001 / F-004: Responses API Tool Call Validation (C-SEC-P5-23)
// ============================================================================

describe('Sprint 5B: Responses API — Tool Call Validation (C-SEC-P5-23)', () => {
  it('A21-SUCCESS: valid function_call is parsed into LlmToolCall', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'o3-mini');
    const responseBody = JSON.stringify({
      id: 'resp_tool',
      output: [
        {
          type: 'function_call',
          call_id: 'call_abc123',
          name: 'get_weather',
          arguments: '{"city": "London"}',
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
      model: 'o3-mini-2024-07-18',
      status: 'completed',
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body: responseBody };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.toolCalls.length, 1, 'Should parse exactly 1 tool call');
    assert.equal(result.response.toolCalls[0]!.id, 'call_abc123');
    assert.equal(result.response.toolCalls[0]!.name, 'get_weather');
    assert.deepStrictEqual(result.response.toolCalls[0]!.input, { city: 'London' });
    assert.equal(result.response.finishReason, 'tool_use', 'Finish reason must be tool_use when tool calls present');
  });

  it('A21-REJECTION: invalid tool name is silently dropped (C-SEC-P5-23)', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'o3-mini');
    const responseBody = JSON.stringify({
      id: 'resp_bad_tool',
      output: [
        {
          type: 'function_call',
          call_id: 'call_bad',
          name: '123invalid',  // Starts with digit — must fail TOOL_NAME_PATTERN
          arguments: '{"x": 1}',
        },
        {
          type: 'function_call',
          call_id: 'call_bad2',
          name: '../../../etc/passwd',  // Path traversal attempt
          arguments: '{}',
        },
        {
          type: 'function_call',
          call_id: 'call_bad3',
          name: '<script>',  // XSS attempt
          arguments: '{}',
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
      model: 'o3-mini-2024-07-18',
      status: 'completed',
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body: responseBody };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.toolCalls.length, 0,
      'All invalid tool names must be silently dropped');
    assert.equal(result.response.finishReason, 'stop',
      'Finish reason must be stop when no valid tool calls remain');
  });

  it('A21-DISCRIMINATIVE: valid + invalid tool calls in same response', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'o3-mini');
    const responseBody = JSON.stringify({
      id: 'resp_mixed',
      output: [
        {
          type: 'function_call',
          call_id: 'call_good',
          name: 'valid_function',
          arguments: '{"key": "value"}',
        },
        {
          type: 'function_call',
          call_id: 'call_evil',
          name: '0xDEADBEEF',  // Starts with digit — invalid
          arguments: '{"evil": true}',
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
      model: 'o3-mini-2024-07-18',
      status: 'completed',
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body: responseBody };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.toolCalls.length, 1,
      'Only valid tool call should survive');
    assert.equal(result.response.toolCalls[0]!.name, 'valid_function');
    assert.equal(result.response.finishReason, 'tool_use',
      'Finish reason must be tool_use when at least one valid tool call');
  });
});

// ============================================================================
// F-002: CR-5 Negative Token Floor (C-SEC-P5-22 defensive)
// ============================================================================

describe('Sprint 5B: CR-5 Negative Token Floor', () => {
  it('Chat Completions: reasoningTokens > completionTokens floors at 0', () => {
    const body = buildChatCompletionResponse({
      content: 'Malformed response',
      completionTokens: 100,
      reasoningTokens: 150,  // Greater than completionTokens — malformed
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body };
    const result = parseOpenAICompatResponse(httpResponse, 'openai');

    assert.equal(result.response.usage.outputTokens, 0,
      'outputTokens must be floored at 0, not negative');
    assert.equal(result.response.usage.providerOutputTokens, 100,
      'providerOutputTokens must be raw value');
    assert.equal(result.deliberation.deliberationTokens, 150);
  });

  it('Responses API: reasoningTokens > outputTokens floors at 0', () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'o3-mini');
    const responseBody = JSON.stringify({
      id: 'resp_neg',
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'Malformed' }],
      }],
      usage: {
        input_tokens: 50,
        output_tokens: 80,
        output_tokens_details: {
          reasoning_tokens: 200,  // Greater than output_tokens — malformed
        },
      },
      model: 'o3-mini-2024-07-18',
      status: 'completed',
    });

    const httpResponse: TransportHttpResponse = { status: 200, headers: {}, body: responseBody };
    const result = adapter.parseResponse(httpResponse);

    assert.equal(result.response.usage.outputTokens, 0,
      'Responses API outputTokens must be floored at 0');
    assert.equal(result.response.usage.providerOutputTokens, 80,
      'providerOutputTokens must be raw value');
    assert.equal(result.deliberation.deliberationTokens, 200);
  });

  it('Streaming: reasoningTokens > completionTokens floors at 0', async () => {
    const adapter = createOpenAIAdapter('openai', 'https://api.openai.com', 'sk-test', 'gpt-4o');

    const sseChunks = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      `data: ${JSON.stringify({
        choices: [],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 60,
          completion_tokens_details: { reasoning_tokens: 100 },  // Greater — malformed
        },
      })}\n\n`,
      'data: [DONE]\n\n',
    ];

    const stream = createMockStream(sseChunks);
    const result = adapter.parseStream(stream);

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    const usageChunks = chunks.filter(c => c.type === 'usage');
    assert.equal(usageChunks.length, 1);
    const usageChunk = usageChunks[0] as { type: 'usage'; inputTokens: number; outputTokens: number };
    assert.equal(usageChunk.outputTokens, 0,
      'Streaming outputTokens must be floored at 0, not negative (-40)');

    const deliberation = result.getDeliberation();
    assert.equal(deliberation.deliberationTokens, 100);
  });
});
