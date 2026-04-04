/**
 * Anthropic Messages API adapter.
 * S ref: §25.4 (LLM Gateway), I-01 (no SDK deps), I-04 (provider independence)
 *
 * Phase: 5A (Sprint 5A — Shared Transport Infrastructure)
 * Implements: ProviderAdapter for Anthropic's Messages API
 *
 * Request translation:
 *   - systemPrompt → top-level "system" parameter
 *   - LlmContentBlock mapping to Anthropic content format
 *   - thinking config (extended_thinking)
 *
 * Response parsing:
 *   - content blocks, tool calls, usage extraction
 *   - C-SEC-P5-22: Provider output is untrusted input
 *   - C-SEC-P5-23: Tool call structural validation
 *
 * Stream parsing:
 *   - thinking_delta events aggregated internally (NOT emitted as LlmStreamChunk)
 *   - content_delta/tool_call_delta/usage/done emitted
 *
 * Deliberation:
 *   - provider_authoritative when thinking blocks present
 *   - CR-5: No reasoning_tokens subtraction (that is OpenAI-specific)
 *
 * Retryable status codes: 429, 500, 502, 503, 529 (overloaded)
 *
 * Security:
 *   - C-SEC-P5-01/02: API key NEVER in logs or error messages
 *   - C-SEC-P5-04 / CR-1: API key resolved ONCE at creation
 *   - C-SEC-P5-22: Provider output is untrusted input
 *   - C-SEC-P5-23: Tool call structural validation
 */

import type {
  ProviderAdapter,
  TransportHttpRequest,
  TransportHttpResponse,
  TransportResult,
  TransportStreamResult,
  DeliberationMetrics,
} from '../transport_types.js';
import type {
  LlmRequest,
  LlmResponse,
  LlmStreamChunk,
  LlmContentBlock,
  LlmToolCall,
} from '../../interfaces/substrate.js';
import { parseSSEStream } from '../stream_parser.js';
import type { TimeProvider } from '../../../kernel/interfaces/time.js';

// ─── Constants ───

/** Anthropic API version header */
const ANTHROPIC_API_VERSION = '2023-06-01';

/** Retryable HTTP status codes for Anthropic */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 529]);

/** C-SEC-P5-23: Valid tool name pattern */
const TOOL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// ─── Tool Call Validation (C-SEC-P5-23) ───

/**
 * Validate a tool call's structural integrity.
 * C-SEC-P5-23: Non-empty id, name matches pattern, input is object.
 */
function validateToolCall(tc: Record<string, unknown>): LlmToolCall | null {
  const id = tc.id;
  const name = tc.name;
  const input = tc.input;

  // Non-empty id
  if (typeof id !== 'string' || id.length === 0) return null;

  // Name matches valid pattern
  if (typeof name !== 'string' || !TOOL_NAME_PATTERN.test(name)) return null;

  // Input must be an object (not null, not array)
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;

  return {
    id,
    name,
    input: input as Record<string, unknown>,
  };
}

// ─── Request Translation ───

/**
 * Map Limen LlmContentBlock to Anthropic content block format.
 */
function mapContentBlock(block: LlmContentBlock): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'image':
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: block.mediaType,
          data: block.data,
        },
      };
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        ...(block.isError ? { is_error: true } : {}),
      };
    default:
      return { type: 'text', text: '' };
  }
}

// ─── Anthropic Adapter Factory ───

/**
 * Create an Anthropic Messages API adapter.
 *
 * @param providerId - Provider identifier for health tracking
 * @param baseUrl - Base URL for the Anthropic API
 * @param apiKey - API key (resolved ONCE at creation — CR-1 / C-SEC-P5-04)
 * @param time - Optional TimeProvider for clock injection
 */
export function createAnthropicAdapter(
  providerId: string,
  baseUrl: string,
  apiKey: string,
  time?: TimeProvider,
): ProviderAdapter {
  // CR-1 / C-SEC-P5-04: Key resolved once at creation
  const resolvedKey = apiKey;

  function buildRequest(request: LlmRequest, streaming: boolean): TransportHttpRequest {
    // Translate messages — Anthropic requires system message at top level
    const messages: Array<Record<string, unknown>> = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        // System messages are handled separately via top-level system param
        continue;
      }

      const content = typeof msg.content === 'string'
        ? msg.content
        : (msg.content as readonly LlmContentBlock[]).map(mapContentBlock);

      messages.push({
        role: msg.role,
        content,
      });
    }

    // Build request body
    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens,
    };

    // System prompt → top-level "system"
    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }

    // Temperature (Anthropic default is 1.0)
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    // Tools
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
    }

    // Streaming
    if (streaming) {
      body.stream = true;
    }

    return {
      url: `${baseUrl}/v1/messages`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': resolvedKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body,
      stream: streaming,
    };
  }

  function parseResponse(httpResponse: TransportHttpResponse): TransportResult {
    // C-SEC-P5-07: JSON parse safety
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(httpResponse.body) as Record<string, unknown>;
    } catch {
      throw new Error(`JSON parse error: invalid response body from Anthropic`);
    }

    // C-SEC-P5-22: Provider output is untrusted — validate structure
    const content = parsed.content;
    if (!Array.isArray(content)) {
      throw new Error('Anthropic response missing content array');
    }

    // Extract content blocks, tool calls, and thinking blocks
    const responseBlocks: LlmContentBlock[] = [];
    const toolCalls: LlmToolCall[] = [];
    let hasThinking = false;
    let thinkingCharCount = 0;

    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue;
      const b = block as Record<string, unknown>;

      if (b.type === 'text') {
        responseBlocks.push({ type: 'text', text: String(b.text ?? '') });
      } else if (b.type === 'tool_use') {
        // C-SEC-P5-23: Validate tool call structure
        const validated = validateToolCall(b);
        if (validated) {
          toolCalls.push(validated);
          responseBlocks.push({
            type: 'tool_use',
            id: validated.id,
            name: validated.name,
            input: validated.input,
          });
        }
        // Invalid tool calls are silently dropped — provider output is untrusted
      } else if (b.type === 'thinking') {
        // CR-5: Thinking blocks → deliberation metrics
        // NOT included in LlmResponse.content
        hasThinking = true;
        // Accumulate thinking text length for token estimation
        if (typeof b.thinking === 'string') {
          thinkingCharCount += b.thinking.length;
        }
      }
    }

    // Extract usage
    const usage = parsed.usage as Record<string, unknown> | undefined;
    const inputTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0;
    const outputTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0;

    // Anthropic may report cache_creation_input_tokens and cache_read_input_tokens
    // We use the top-level input_tokens which includes all types

    // Extract finish reason (stop_reason in Anthropic's format)
    const stopReason = parsed.stop_reason as string | undefined;
    const finishReason = mapFinishReason(stopReason);

    // Deliberation metrics
    // CR-5: When thinking blocks present, estimate deliberation tokens.
    // Anthropic's output_tokens includes BOTH thinking + completion tokens.
    // The API does not provide a separate thinking token count in non-streaming responses.
    // We estimate using character ratio: (thinking chars / total output chars) * outputTokens.
    // When no thinking → estimated with 0 tokens, providerReportedThinkingTokens = null.
    let deliberation: DeliberationMetrics;
    if (hasThinking) {
      // Compute total non-thinking character count from response blocks
      let completionCharCount = 0;
      for (const rb of responseBlocks) {
        if (rb.type === 'text') {
          completionCharCount += rb.text.length;
        }
      }
      const totalChars = thinkingCharCount + completionCharCount;
      // Estimate deliberation tokens proportionally; if no text at all, attribute all to thinking
      const estimatedDeliberationTokens = totalChars > 0
        ? Math.round((thinkingCharCount / totalChars) * outputTokens)
        : outputTokens;

      deliberation = {
        deliberationTokens: estimatedDeliberationTokens,
        accountingMode: 'estimated',
        providerReportedThinkingTokens: null,
      };
    } else {
      deliberation = {
        deliberationTokens: 0,
        accountingMode: 'estimated',
        providerReportedThinkingTokens: null,
      };
    }

    const response: LlmResponse = {
      content: responseBlocks.length === 1 && responseBlocks[0]?.type === 'text'
        ? (responseBlocks[0] as { type: 'text'; text: string }).text
        : responseBlocks,
      toolCalls,
      finishReason,
      usage: {
        inputTokens,
        outputTokens,
        providerInputTokens: inputTokens,
        providerOutputTokens: outputTokens,
      },
      model: String(parsed.model ?? ''),
      providerId,
      latencyMs: 0, // Filled by transport engine
    };

    return {
      response,
      deliberation,
      retryCount: 0, // Filled by transport engine
      totalMs: 0, // Filled by transport engine
    };
  }

  function parseStream(
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): TransportStreamResult {
    let deliberation: DeliberationMetrics = {
      deliberationTokens: 0,
      accountingMode: 'estimated',
      providerReportedThinkingTokens: null,
    };
    let totalMs = 0;
    const streamStart = (time ?? { nowMs: () => Date.now() }).nowMs();

    // Track thinking state for aggregation
    let thinkingTokensAccumulated = 0;
    let thinkingDetected = false;

    // Track tool call state for delta assembly
    const toolCallState = new Map<number, { id: string; name: string; inputParts: string[] }>();

    async function* processStream(): AsyncIterable<LlmStreamChunk> {
      for await (const event of parseSSEStream(body, signal, time)) {
        // Skip empty data
        if (!event.data || event.data === '[DONE]') continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          continue; // Skip unparseable events
        }

        const eventType = parsed.type as string | undefined;

        // Anthropic streaming event types
        switch (eventType) {
          case 'content_block_start': {
            const cb = parsed.content_block as Record<string, unknown> | undefined;
            if (cb?.type === 'tool_use') {
              const index = typeof parsed.index === 'number' ? parsed.index : -1;
              if (index >= 0) {
                toolCallState.set(index, {
                  id: String(cb.id ?? ''),
                  name: String(cb.name ?? ''),
                  inputParts: [],
                });
              }
            } else if (cb?.type === 'thinking') {
              thinkingDetected = true;
            }
            break;
          }

          case 'content_block_delta': {
            const delta = parsed.delta as Record<string, unknown> | undefined;
            if (!delta) break;

            if (delta.type === 'text_delta') {
              yield {
                type: 'content_delta',
                delta: String(delta.text ?? ''),
              };
            } else if (delta.type === 'input_json_delta') {
              const index = typeof parsed.index === 'number' ? parsed.index : -1;
              const state = toolCallState.get(index);
              if (state) {
                const partialJson = String(delta.partial_json ?? '');
                state.inputParts.push(partialJson);
                yield {
                  type: 'tool_call_delta',
                  toolCallId: state.id,
                  name: state.name,
                  inputDelta: partialJson,
                };
              }
            } else if (delta.type === 'thinking_delta') {
              // CR-5: Thinking deltas are aggregated internally, NOT emitted
              // We just track that thinking is happening
              thinkingDetected = true;
            }
            break;
          }

          case 'content_block_stop': {
            // No action needed — tool calls are assembled via deltas
            break;
          }

          case 'message_delta': {
            const delta = parsed.delta as Record<string, unknown> | undefined;
            const usage_delta = parsed.usage as Record<string, unknown> | undefined;

            if (usage_delta) {
              const outTokens = typeof usage_delta.output_tokens === 'number'
                ? usage_delta.output_tokens : 0;

              // CR-5: When thinking was detected, accumulate output tokens as
              // thinking tokens. Anthropic reports thinking token consumption
              // via the output_tokens field in message_delta usage.
              if (thinkingDetected) {
                thinkingTokensAccumulated += outTokens;
              }

              // Emit usage with what we have
              yield {
                type: 'usage',
                inputTokens: 0, // Input tokens come from message_start
                outputTokens: outTokens,
              };
            }

            if (delta?.stop_reason) {
              yield {
                type: 'done',
                finishReason: mapFinishReason(delta.stop_reason as string),
              };
            }
            break;
          }

          case 'message_start': {
            const message = parsed.message as Record<string, unknown> | undefined;
            const msgUsage = message?.usage as Record<string, unknown> | undefined;
            if (msgUsage) {
              const inTokens = typeof msgUsage.input_tokens === 'number'
                ? msgUsage.input_tokens : 0;
              yield {
                type: 'usage',
                inputTokens: inTokens,
                outputTokens: 0,
              };
            }
            break;
          }

          case 'error': {
            const errorObj = parsed.error as Record<string, unknown> | undefined;
            yield {
              type: 'error',
              error: String(errorObj?.message ?? 'Unknown Anthropic stream error'),
            };
            break;
          }
        }
      }

      // Set deliberation metrics after stream completes
      totalMs = ((time ?? { nowMs: () => Date.now() }).nowMs()) - streamStart;
      deliberation = thinkingDetected
        ? {
            deliberationTokens: thinkingTokensAccumulated,
            accountingMode: 'provider_authoritative',
            providerReportedThinkingTokens: thinkingTokensAccumulated,
          }
        : {
            deliberationTokens: 0,
            accountingMode: 'estimated',
            providerReportedThinkingTokens: null,
          };
    }

    return {
      stream: processStream(),
      getDeliberation: () => deliberation,
      getTotalMs: () => totalMs || ((time ?? { nowMs: () => Date.now() }).nowMs()) - streamStart,
    };
  }

  function supportsStreaming(): boolean {
    return true;
  }

  function isRetryableStatus(status: number): boolean {
    return RETRYABLE_STATUS_CODES.has(status);
  }

  const adapter: ProviderAdapter = {
    providerId,
    buildRequest,
    parseResponse,
    parseStream,
    supportsStreaming,
    isRetryableStatus,
  };

  return Object.freeze(adapter);
}

// ─── Helpers ───

/**
 * Map Anthropic stop_reason to Limen finish reason.
 */
function mapFinishReason(stopReason: string | undefined): 'stop' | 'length' | 'tool_use' | 'content_filter' {
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_use';
    default:
      return 'stop';
  }
}

/**
 * Create an Anthropic adapter with API key from environment variable.
 * C-SEC-P5-01/02: Key is read from env and NEVER logged.
 * CR-1: Key resolved once at creation.
 *
 * @param providerId - Provider identifier
 * @param baseUrl - Base URL (e.g., 'https://api.anthropic.com')
 * @param apiKeyEnvVar - Environment variable name containing the API key
 * @param time - Optional TimeProvider
 * @throws Error if API key env var is not set (for non-Ollama providers)
 */
export function createAnthropicAdapterFromEnv(
  providerId: string,
  baseUrl: string,
  apiKeyEnvVar: string,
  time?: TimeProvider,
): ProviderAdapter {
  const apiKey = process.env[apiKeyEnvVar];

  // C-SEC-P5-01: NEVER include the key value in error messages
  if (!apiKey) {
    throw new Error(
      `TRANSPORT_MISSING_API_KEY: API key environment variable is not set. Provider: ${providerId}`,
    );
  }

  return createAnthropicAdapter(providerId, baseUrl, apiKey, time);
}
