/**
 * OpenAI API adapter (Chat Completions + Responses API).
 * S ref: §25.4 (LLM Gateway), I-01 (no SDK deps), I-04 (provider independence)
 *
 * Phase: 5B (Sprint 5B — OpenAI + Google Adapters)
 * Implements: ProviderAdapter for OpenAI's Chat Completions API and Responses API.
 *
 * Dual API selection (A-P5-006):
 *   Models matching o3* or o4* → Responses API (/v1/responses)
 *   All others → Chat Completions (/v1/chat/completions)
 *
 * Chat Completions API:
 *   - Auth: Authorization: Bearer {key}
 *   - Request: messages array with role/content, model, max_tokens, temperature, tools, stream
 *   - Response: choices[0].message.content, usage.completion_tokens, usage.prompt_tokens
 *   - Streaming: SSE with data: {...} events, choices[0].delta.content, [DONE] sentinel
 *   - CR-5: completion_tokens_details.reasoning_tokens → deliberation
 *
 * Responses API (reasoning models):
 *   - URL: {baseUrl}/v1/responses
 *   - Field mapping: input (not messages), instructions (not system), max_output_tokens (not max_tokens)
 *   - supportsStreaming() returns false for reasoning models
 *   - encrypted_content → ProviderResponseMetadata if present
 *
 * Security:
 *   - C-SEC-P5-01/02: API key NEVER in logs or error messages
 *   - C-SEC-P5-04 / CR-1: API key resolved ONCE at creation
 *   - C-SEC-P5-22: Provider output is untrusted input
 *   - C-SEC-P5-23: Tool call structural validation
 *
 * Retryable: 429, 500, 502, 503
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
import {
  buildOpenAICompatRequest,
  parseOpenAICompatResponse,
  TOOL_NAME_PATTERN,
} from './openai_compat.js';
import { parseSSEStream } from '../stream_parser.js';
import type { TimeProvider } from '../../../kernel/interfaces/time.js';

// ─── Constants ───

/** Retryable HTTP status codes for OpenAI */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

/** A-P5-006: Pattern for reasoning models that use the Responses API */
const REASONING_MODEL_PATTERN = /^o[34]/;

// ─── Reasoning Model Detection ───

/**
 * A-P5-006: Determine if a model should use the Responses API.
 * Models matching o3* or o4* use the Responses API.
 */
function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_PATTERN.test(model);
}

// ─── Responses API Request Builder ───

/**
 * Build a Responses API request for reasoning models (o3*, o4*).
 * Field mapping per Design Source:
 *   - input (not messages)
 *   - instructions (not system message)
 *   - max_output_tokens (not max_tokens)
 */
function buildResponsesApiRequest(
  request: LlmRequest,
  url: string,
  headers: Record<string, string>,
): TransportHttpRequest {
  // Extract system prompt → instructions
  let instructions: string | undefined;
  if (request.systemPrompt) {
    instructions = request.systemPrompt;
  }

  // Build input from messages (flatten system messages into instructions)
  const input: Array<Record<string, unknown>> = [];
  for (const msg of request.messages) {
    if (msg.role === 'system') {
      // System messages become instructions
      const text = typeof msg.content === 'string'
        ? msg.content
        : (msg.content as readonly LlmContentBlock[])
            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
            .map(b => b.text)
            .join('\n');
      if (!instructions) {
        instructions = text;
      } else {
        instructions = `${instructions}\n${text}`;
      }
      continue;
    }

    if (typeof msg.content === 'string') {
      input.push({ role: msg.role, content: msg.content });
    } else {
      const blocks = msg.content as readonly LlmContentBlock[];
      const textContent = blocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join('\n');
      input.push({ role: msg.role, content: textContent });
    }
  }

  const body: Record<string, unknown> = {
    model: request.model,
    input,
    max_output_tokens: request.maxTokens,
  };

  if (instructions) {
    body.instructions = instructions;
  }

  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  // Tools for Responses API
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  // Responses API does NOT support streaming for reasoning models
  // stream is never true here

  return {
    url,
    method: 'POST',
    headers,
    body,
    stream: false,
  };
}

// ─── Responses API Response Parser ───

/**
 * Parse a Responses API response.
 * The response format differs from Chat Completions:
 *   - output[] contains response items
 *   - usage.input_tokens / output_tokens at top level
 *   - encrypted_content may be present (captured but not interpreted)
 */
function parseResponsesApiResponse(
  httpResponse: TransportHttpResponse,
  providerId: string,
): TransportResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(httpResponse.body) as Record<string, unknown>;
  } catch {
    throw new Error(`JSON parse error: invalid response body from ${providerId}`);
  }

  // Extract output content
  const output = parsed.output;
  const responseBlocks: LlmContentBlock[] = [];
  const toolCalls: LlmToolCall[] = [];

  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item !== 'object' || item === null) continue;
      const i = item as Record<string, unknown>;

      if (i.type === 'message') {
        const content = i.content;
        if (Array.isArray(content)) {
          for (const part of content) {
            if (typeof part !== 'object' || part === null) continue;
            const p = part as Record<string, unknown>;
            if (p.type === 'output_text') {
              responseBlocks.push({ type: 'text', text: String(p.text ?? '') });
            }
          }
        }
      } else if (i.type === 'function_call') {
        // Tool calls in Responses API format
        const id = typeof i.call_id === 'string' ? i.call_id : '';
        const name = typeof i.name === 'string' ? i.name : '';
        const args = typeof i.arguments === 'string' ? i.arguments : '{}';

        // C-SEC-P5-23: Validate tool name against pattern (same enforcement as Chat Completions)
        if (id && name && TOOL_NAME_PATTERN.test(name)) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            const raw = JSON.parse(args);
            if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
              parsedArgs = raw as Record<string, unknown>;
            }
          } catch {
            // Invalid args — skip
          }
          const tc: LlmToolCall = { id, name, input: parsedArgs };
          toolCalls.push(tc);
          responseBlocks.push({ type: 'tool_use', id, name, input: parsedArgs });
        }
      }
    }
  }

  // Extract usage
  const usage = parsed.usage as Record<string, unknown> | undefined;
  const inputTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0;
  const outputTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0;

  // Responses API reasoning tokens
  const outputDetails = usage?.output_tokens_details as Record<string, unknown> | undefined;
  const reasoningTokens = typeof outputDetails?.reasoning_tokens === 'number'
    ? outputDetails.reasoning_tokens
    : 0;

  // CR-5: Same token math applies
  let effectiveOutputTokens: number;
  let deliberation: DeliberationMetrics;

  if (reasoningTokens > 0) {
    // Floor at 0 to guard against malformed provider responses (C-SEC-P5-22)
    effectiveOutputTokens = Math.max(0, outputTokens - reasoningTokens);
    deliberation = {
      deliberationTokens: reasoningTokens,
      accountingMode: 'provider_authoritative',
      providerReportedThinkingTokens: reasoningTokens,
    };
  } else {
    effectiveOutputTokens = outputTokens;
    deliberation = {
      deliberationTokens: 0,
      accountingMode: 'estimated',
      providerReportedThinkingTokens: null,
    };
  }

  // Finish reason
  const status = parsed.status as string | undefined;
  const finishReason = status === 'incomplete' ? 'length' as const
    : toolCalls.length > 0 ? 'tool_use' as const
    : 'stop' as const;

  const response: LlmResponse = {
    content: responseBlocks.length === 1 && responseBlocks[0]?.type === 'text'
      ? (responseBlocks[0] as { type: 'text'; text: string }).text
      : responseBlocks.length > 0 ? responseBlocks : '',
    toolCalls,
    finishReason,
    usage: {
      inputTokens,
      outputTokens: effectiveOutputTokens,
      providerInputTokens: inputTokens,
      providerOutputTokens: outputTokens,
    },
    model: String(parsed.model ?? ''),
    providerId,
    latencyMs: 0,
  };

  return {
    response,
    deliberation,
    retryCount: 0,
    totalMs: 0,
  };
}

// ─── OpenAI Adapter Factory ───

/**
 * Create an OpenAI API adapter.
 *
 * @param providerId - Provider identifier for health tracking
 * @param baseUrl - Base URL for the OpenAI API (e.g., 'https://api.openai.com')
 * @param apiKey - API key (resolved ONCE at creation — CR-1 / C-SEC-P5-04)
 * @param model - The model to use (determines API selection)
 * @param time - Optional TimeProvider for clock injection
 */
export function createOpenAIAdapter(
  providerId: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  time?: TimeProvider,
): ProviderAdapter {
  // CR-1 / C-SEC-P5-04: Key resolved once at creation
  const resolvedKey = apiKey;
  const useResponsesApi = isReasoningModel(model);

  function buildRequest(request: LlmRequest, streaming: boolean): TransportHttpRequest {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'authorization': `Bearer ${resolvedKey}`,
    };

    if (useResponsesApi) {
      // Responses API — streaming not supported for reasoning models
      const url = `${baseUrl}/v1/responses`;
      return buildResponsesApiRequest(request, url, headers);
    }

    // Chat Completions API
    const url = `${baseUrl}/v1/chat/completions`;
    return buildOpenAICompatRequest(request, streaming, url, headers);
  }

  function parseResponse(httpResponse: TransportHttpResponse): TransportResult {
    if (useResponsesApi) {
      return parseResponsesApiResponse(httpResponse, providerId);
    }
    return parseOpenAICompatResponse(httpResponse, providerId);
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
    const clock = time ?? { nowMs: () => Date.now() }; // clock-exempt: fallback only
    const streamStart = clock.nowMs();

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

        const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(choices) || choices.length === 0) {
          // Check for usage-only event (streaming usage stats)
          const streamUsage = parsed.usage as Record<string, unknown> | undefined;
          if (streamUsage) {
            const promptToks = typeof streamUsage.prompt_tokens === 'number' ? streamUsage.prompt_tokens : 0;
            const completionToks = typeof streamUsage.completion_tokens === 'number' ? streamUsage.completion_tokens : 0;

            // CR-5: Check for reasoning tokens in stream usage
            const details = streamUsage.completion_tokens_details as Record<string, unknown> | undefined;
            const reasoningToks = typeof details?.reasoning_tokens === 'number' ? details.reasoning_tokens : 0;

            let effectiveOutput: number;
            if (reasoningToks > 0) {
              // Floor at 0 to guard against malformed provider responses (C-SEC-P5-22)
              effectiveOutput = Math.max(0, completionToks - reasoningToks);
              deliberation = {
                deliberationTokens: reasoningToks,
                accountingMode: 'provider_authoritative',
                providerReportedThinkingTokens: reasoningToks,
              };
            } else {
              effectiveOutput = completionToks;
            }

            yield {
              type: 'usage',
              inputTokens: promptToks,
              outputTokens: effectiveOutput,
            };
          }
          continue;
        }

        const firstChoice = choices[0]!;
        const delta = firstChoice.delta as Record<string, unknown> | undefined;
        const finishReason = firstChoice.finish_reason as string | null | undefined;

        if (delta) {
          // Content delta
          const content = delta.content;
          if (typeof content === 'string' && content.length > 0) {
            yield {
              type: 'content_delta',
              delta: content,
            };
          }

          // Tool call deltas
          const toolCallDeltas = delta.tool_calls as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(toolCallDeltas)) {
            for (const tcd of toolCallDeltas) {
              const index = typeof tcd.index === 'number' ? tcd.index : 0;
              const fn = tcd.function as Record<string, unknown> | undefined;

              if (!toolCallState.has(index)) {
                // New tool call
                toolCallState.set(index, {
                  id: typeof tcd.id === 'string' ? tcd.id : '',
                  name: typeof fn?.name === 'string' ? fn.name : '',
                  inputParts: [],
                });
              }

              const state = toolCallState.get(index)!;
              if (tcd.id && typeof tcd.id === 'string') {
                state.id = tcd.id;
              }
              if (fn?.name && typeof fn.name === 'string') {
                state.name = fn.name;
              }

              const argsDelta = typeof fn?.arguments === 'string' ? fn.arguments : '';
              if (argsDelta) {
                state.inputParts.push(argsDelta);
                yield {
                  type: 'tool_call_delta',
                  toolCallId: state.id,
                  name: state.name,
                  inputDelta: argsDelta,
                };
              }
            }
          }
        }

        // Finish reason
        if (finishReason) {
          const mapped = finishReason === 'stop' ? 'stop' as const
            : finishReason === 'length' ? 'length' as const
            : finishReason === 'tool_calls' ? 'tool_use' as const
            : finishReason === 'content_filter' ? 'content_filter' as const
            : 'stop' as const;

          yield {
            type: 'done',
            finishReason: mapped,
          };
        }
      }

      // Set timing after stream completes
      totalMs = clock.nowMs() - streamStart;
    }

    return {
      stream: processStream(),
      getDeliberation: () => deliberation,
      getTotalMs: () => totalMs || (clock.nowMs() - streamStart),
    };
  }

  function supportsStreaming(): boolean {
    // Reasoning models (o3*, o4*) do NOT support streaming via Responses API
    return !useResponsesApi;
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

/**
 * Create an OpenAI adapter with API key from environment variable.
 * C-SEC-P5-01/02: Key is read from env and NEVER logged.
 * CR-1: Key resolved once at creation.
 *
 * @param providerId - Provider identifier
 * @param baseUrl - Base URL (e.g., 'https://api.openai.com')
 * @param apiKeyEnvVar - Environment variable name containing the API key
 * @param model - The model to use (determines API selection)
 * @param time - Optional TimeProvider
 * @throws Error if API key env var is not set
 */
export function createOpenAIAdapterFromEnv(
  providerId: string,
  baseUrl: string,
  apiKeyEnvVar: string,
  model: string,
  time?: TimeProvider,
): ProviderAdapter {
  const apiKey = process.env[apiKeyEnvVar];

  // C-SEC-P5-01: NEVER include the key value in error messages
  if (!apiKey) {
    throw new Error(
      `TRANSPORT_MISSING_API_KEY: API key environment variable is not set. Provider: ${providerId}`,
    );
  }

  return createOpenAIAdapter(providerId, baseUrl, apiKey, model, time);
}

// ─── Exported for testing ───
export { isReasoningModel, RETRYABLE_STATUS_CODES, REASONING_MODEL_PATTERN };
