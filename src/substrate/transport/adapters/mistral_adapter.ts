/**
 * Mistral API adapter (OpenAI-compatible Chat Completions format).
 * S ref: §25.4 (LLM Gateway), I-01 (no SDK deps), I-04 (provider independence)
 *
 * Phase: 5C (Sprint 5C — Ollama + Groq + Mistral Adapters)
 * Implements: ProviderAdapter for Mistral's OpenAI-compatible Chat Completions API.
 *
 * Mistral speaks the OpenAI Chat Completions wire format — this is a thin wrapper
 * around openai_compat.ts shared functions. Minimal adapter.
 *
 * Auth: Authorization: Bearer {key} — same as OpenAI
 * URL: {baseUrl}/v1/chat/completions (default baseUrl: https://api.mistral.ai)
 * Request: Delegates to buildOpenAICompatRequest() from openai_compat.ts
 * Response: Delegates to parseOpenAICompatResponse() from openai_compat.ts
 * Streaming: SSE via parseSSEStream() — same pattern as OpenAI Chat Completions
 * Deliberation: Always estimated with 0 tokens (Mistral does not report reasoning tokens)
 *
 * Security:
 *   - C-SEC-P5-01/02: API key NEVER in logs or error messages
 *   - C-SEC-P5-04 / CR-1: API key resolved ONCE at creation
 *   - C-SEC-P5-22: Provider output is untrusted input
 *   - C-SEC-P5-23: Tool call structural validation (via openai_compat)
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
  LlmStreamChunk,
} from '../../interfaces/substrate.js';
import {
  buildOpenAICompatRequest,
  parseOpenAICompatResponse,
} from './openai_compat.js';
import { parseSSEStream } from '../stream_parser.js';
import type { TimeProvider } from '../../../kernel/interfaces/time.js';

// ─── Constants ───

/** Retryable HTTP status codes for Mistral */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

// ─── Mistral Adapter Factory ───

/**
 * Create a Mistral API adapter.
 *
 * @param providerId - Provider identifier for health tracking
 * @param baseUrl - Base URL for the Mistral API (e.g., 'https://api.mistral.ai')
 * @param apiKey - API key (resolved ONCE at creation — CR-1 / C-SEC-P5-04)
 * @param time - Optional TimeProvider for clock injection (Hard Stop #7)
 */
export function createMistralAdapter(
  providerId: string,
  baseUrl: string,
  apiKey: string,
  time?: TimeProvider,
): ProviderAdapter {
  // CR-1 / C-SEC-P5-04: Key resolved once at creation
  const resolvedKey = apiKey;

  function buildRequest(request: LlmRequest, streaming: boolean): TransportHttpRequest {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'authorization': `Bearer ${resolvedKey}`,
    };

    const url = `${baseUrl}/v1/chat/completions`;
    return buildOpenAICompatRequest(request, streaming, url, headers);
  }

  function parseResponse(httpResponse: TransportHttpResponse): TransportResult {
    return parseOpenAICompatResponse(httpResponse, providerId);
  }

  function parseStream(
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): TransportStreamResult {
    // Mistral does not report reasoning tokens — deliberation is always estimated
    let deliberation: DeliberationMetrics = {
      deliberationTokens: 0,
      accountingMode: 'estimated',
      providerReportedThinkingTokens: null,
    };
    let totalMs = 0;
    const clock = time ?? { nowMs: () => Date.now() }; // clock-exempt: fallback only
    const streamStart = clock.nowMs();

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

            yield {
              type: 'usage',
              inputTokens: promptToks,
              outputTokens: completionToks,
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
              const fn = tcd.function as Record<string, unknown> | undefined;
              const id = typeof tcd.id === 'string' ? tcd.id : '';
              const name = typeof fn?.name === 'string' ? fn.name : '';
              const argsDelta = typeof fn?.arguments === 'string' ? fn.arguments : '';

              if (argsDelta || id || name) {
                yield {
                  type: 'tool_call_delta',
                  toolCallId: id,
                  name,
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

/**
 * Create a Mistral adapter with API key from environment variable.
 * C-SEC-P5-01/02: Key is read from env and NEVER logged.
 * CR-1: Key resolved once at creation.
 *
 * @param providerId - Provider identifier (defaults to 'mistral')
 * @param time - Optional TimeProvider
 * @throws Error if MISTRAL_API_KEY env var is not set (message does NOT include key value)
 */
export function createMistralAdapterFromEnv(
  providerId: string = 'mistral',
  time?: TimeProvider,
): ProviderAdapter {
  const apiKey = process.env['MISTRAL_API_KEY'];

  // C-SEC-P5-01: NEVER include the key value in error messages
  if (!apiKey) {
    throw new Error(
      `TRANSPORT_MISSING_API_KEY: API key environment variable is not set. Provider: ${providerId}`,
    );
  }

  return createMistralAdapter(providerId, 'https://api.mistral.ai', apiKey, time);
}

// ─── Exported for testing ───
export { RETRYABLE_STATUS_CODES };
