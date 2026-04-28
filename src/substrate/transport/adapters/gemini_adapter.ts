/**
 * Google Gemini REST API adapter.
 * S ref: §25.4 (LLM Gateway), I-01 (no SDK deps), I-04 (provider independence)
 *
 * Phase: 5B (Sprint 5B — OpenAI + Google Adapters)
 * Implements: ProviderAdapter for Google's Gemini REST API.
 *
 * Auth: API key in query parameter ?key={key}
 * URL:
 *   Non-streaming: {baseUrl}/v1beta/models/{model}:generateContent?key={key}
 *   Streaming: {baseUrl}/v1beta/models/{model}:streamGenerateContent?key={key}&alt=sse
 *
 * C-SEC-P5-03 (CRITICAL): URL credential scrubbing.
 *   The API key is in the query string. scrubUrl() replaces the key value with [REDACTED].
 *   This function MUST be called:
 *     - Before any URL is included in an error message
 *     - Before any URL is logged
 *   TransportHttpRequest.url sent to fetch() contains the real key.
 *   Any error thrown by the adapter must use scrubUrl().
 *
 * Request translation: Gemini uses contents[].parts[] format (not messages).
 *   role: 'user'/'model' (not 'assistant'). System instruction in systemInstruction field.
 *
 * Response parsing: candidates[0].content.parts, usageMetadata.promptTokenCount/candidatesTokenCount
 *
 * Thinking/Deliberation: usageMetadata.thoughtsTokenCount → provider_authoritative
 *
 * Tool calls: Gemini uses functionCall in parts. Map to LlmToolCall.
 *
 * Streaming: SSE format. Events contain partial candidates.
 *
 * Retryable: 429, 500, 502, 503
 *
 * Security:
 *   - C-SEC-P5-01/02: API key NEVER in error messages (use scrubUrl)
 *   - C-SEC-P5-03: URL credential scrubbing
 *   - C-SEC-P5-04 / CR-1: API key resolved ONCE at creation
 *   - C-SEC-P5-22: Provider output is untrusted input
 *   - C-SEC-P5-23: Tool call structural validation (functionCall)
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

/** Retryable HTTP status codes for Gemini */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

/** C-SEC-P5-23: Valid function name pattern */
const TOOL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// ─── URL Credential Scrubbing (C-SEC-P5-03) ───

/**
 * C-SEC-P5-03: Remove API key from a Gemini URL.
 * Replaces the `key=` query parameter value with [REDACTED].
 * MUST be called before including any URL in error messages, logs, or metadata.
 */
export function scrubUrl(url: string): string {
  // Replace key=value in query string, handling both ?key=xxx and &key=xxx
  return url.replace(/([?&])key=[^&]*/g, '$1key=[REDACTED]');
}

// ─── Gemini Request Translation ───

/**
 * Map Limen LlmContentBlock to Gemini part format.
 * @param block - The content block to map
 * @param toolUseIdToName - Lookup map from tool_use IDs to function names,
 *   built from prior tool_use blocks in the conversation. Gemini's functionResponse
 *   requires the function name, not the tool use ID.
 */
function mapToGeminiPart(
  block: LlmContentBlock,
  toolUseIdToName: ReadonlyMap<string, string>,
): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { text: block.text };
    case 'image':
      return {
        inlineData: {
          mimeType: block.mediaType,
          data: block.data,
        },
      };
    case 'tool_use':
      return {
        functionCall: {
          name: block.name,
          args: block.input,
        },
      };
    case 'tool_result': {
      // Gemini expects the function name in functionResponse, not the tool use ID.
      // Look up the function name from prior tool_use blocks; fall back to toolUseId
      // if the mapping is unavailable (defensive — should not happen in well-formed conversations).
      const functionName = toolUseIdToName.get(block.toolUseId) ?? block.toolUseId;
      return {
        functionResponse: {
          name: functionName,
          response: { content: block.content },
        },
      };
    }
    default:
      return { text: '' };
  }
}

/**
 * Map Limen role to Gemini role.
 * Gemini uses 'user' and 'model' (not 'assistant').
 */
function mapRole(role: string): string {
  switch (role) {
    case 'assistant': return 'model';
    case 'tool': return 'function';
    default: return role;
  }
}

// ─── Gemini Tool Call Validation ───

/**
 * Validate a Gemini functionCall part into an LlmToolCall.
 * C-SEC-P5-23: Name must match pattern, args must be an object.
 * Gemini does not provide a tool call ID — we generate one from the function name.
 */
function validateGeminiFunctionCall(
  fc: Record<string, unknown>,
  index: number,
): LlmToolCall | null {
  const name = fc.name;
  if (typeof name !== 'string' || !TOOL_NAME_PATTERN.test(name)) return null;

  const args = fc.args;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;

  // Gemini does not provide IDs — generate a deterministic one
  const id = `gemini-call-${index}`;

  return {
    id,
    name,
    input: args as Record<string, unknown>,
  };
}

// ─── Gemini Adapter Factory ───

/**
 * Create a Google Gemini REST API adapter.
 *
 * @param providerId - Provider identifier for health tracking
 * @param baseUrl - Base URL for the Gemini API (e.g., 'https://generativelanguage.googleapis.com')
 * @param apiKey - API key (resolved ONCE at creation — CR-1 / C-SEC-P5-04)
 * @param time - Optional TimeProvider for clock injection
 */
export function createGeminiAdapter(
  providerId: string,
  baseUrl: string,
  apiKey: string,
  time?: TimeProvider,
): ProviderAdapter {
  // CR-1 / C-SEC-P5-04: Key resolved once at creation
  const resolvedKey = apiKey;

  function buildRequest(request: LlmRequest, streaming: boolean): TransportHttpRequest {
    // Build contents array (Gemini format: contents[].parts[])
    const contents: Array<Record<string, unknown>> = [];

    // Build tool_use ID → function name lookup for tool_result mapping.
    // Gemini's functionResponse requires the function name, not the opaque tool use ID.
    const toolUseIdToName = new Map<string, string>();
    for (const msg of request.messages) {
      if (typeof msg.content !== 'string') {
        const blocks = msg.content as readonly LlmContentBlock[];
        for (const block of blocks) {
          if (block.type === 'tool_use') {
            toolUseIdToName.set(block.id, block.name);
          }
        }
      }
    }

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        // System messages handled via systemInstruction
        continue;
      }

      const parts: Array<Record<string, unknown>> = [];
      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else {
        const blocks = msg.content as readonly LlmContentBlock[];
        for (const block of blocks) {
          parts.push(mapToGeminiPart(block, toolUseIdToName));
        }
      }

      contents.push({
        role: mapRole(msg.role),
        parts,
      });
    }

    // Build request body
    const body: Record<string, unknown> = {
      contents,
    };

    // System instruction
    if (request.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: request.systemPrompt }],
      };
    } else {
      // Check for system messages in the messages array
      const systemMsgs = request.messages.filter(m => m.role === 'system');
      if (systemMsgs.length > 0) {
        const systemText = systemMsgs
          .map(m => typeof m.content === 'string' ? m.content : '')
          .join('\n');
        if (systemText) {
          body.systemInstruction = {
            parts: [{ text: systemText }],
          };
        }
      }
    }

    // Generation config
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: request.maxTokens,
    };
    if (request.temperature !== undefined) {
      generationConfig.temperature = request.temperature;
    }
    body.generationConfig = generationConfig;

    // Tools (Gemini format: tools[].functionDeclarations[])
    if (request.tools && request.tools.length > 0) {
      body.tools = [{
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        })),
      }];
    }

    // URL construction — key in query parameter
    const action = streaming ? 'streamGenerateContent' : 'generateContent';
    const streamParam = streaming ? '&alt=sse' : '';
    const url = `${baseUrl}/v1beta/models/${request.model}:${action}?key=${resolvedKey}${streamParam}`;

    return {
      url,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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
      throw new Error(`JSON parse error: invalid response body from ${providerId}`);
    }

    // C-SEC-P5-22: Validate structure
    const candidates = parsed.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error(`${providerId} response missing candidates array`);
    }

    const firstCandidate = candidates[0] as Record<string, unknown>;
    const content = firstCandidate.content as Record<string, unknown> | undefined;
    const parts = content?.parts as Array<Record<string, unknown>> | undefined;

    // Extract content blocks and tool calls
    const responseBlocks: LlmContentBlock[] = [];
    const toolCalls: LlmToolCall[] = [];
    let toolCallIndex = 0;

    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (typeof part !== 'object' || part === null) continue;

        if (typeof part.text === 'string') {
          responseBlocks.push({ type: 'text', text: part.text });
        } else if (part.functionCall) {
          // C-SEC-P5-23: Validate function call
          const fc = part.functionCall as Record<string, unknown>;
          const validated = validateGeminiFunctionCall(fc, toolCallIndex++);
          if (validated) {
            toolCalls.push(validated);
            responseBlocks.push({
              type: 'tool_use',
              id: validated.id,
              name: validated.name,
              input: validated.input,
            });
          }
        }
      }
    }

    // Extract usage metadata
    const usageMetadata = parsed.usageMetadata as Record<string, unknown> | undefined;
    const promptTokens = typeof usageMetadata?.promptTokenCount === 'number'
      ? usageMetadata.promptTokenCount : 0;
    const candidateTokens = typeof usageMetadata?.candidatesTokenCount === 'number'
      ? usageMetadata.candidatesTokenCount : 0;

    // Thinking/Deliberation: thoughtsTokenCount
    const thoughtsTokenCount = typeof usageMetadata?.thoughtsTokenCount === 'number'
      ? usageMetadata.thoughtsTokenCount : 0;

    let deliberation: DeliberationMetrics;
    if (thoughtsTokenCount > 0) {
      deliberation = {
        deliberationTokens: thoughtsTokenCount,
        accountingMode: 'provider_authoritative',
        providerReportedThinkingTokens: thoughtsTokenCount,
      };
    } else {
      deliberation = {
        deliberationTokens: 0,
        accountingMode: 'estimated',
        providerReportedThinkingTokens: null,
      };
    }

    // Finish reason
    const rawFinishReason = firstCandidate.finishReason as string | undefined;
    const finishReason = mapGeminiFinishReason(rawFinishReason, toolCalls.length > 0);

    const response: LlmResponse = {
      content: responseBlocks.length === 1 && responseBlocks[0]?.type === 'text'
        ? (responseBlocks[0] as { type: 'text'; text: string }).text
        : responseBlocks.length > 0 ? responseBlocks : '',
      toolCalls,
      finishReason,
      usage: {
        inputTokens: promptTokens,
        outputTokens: candidateTokens,
        providerInputTokens: promptTokens,
        providerOutputTokens: candidateTokens,
      },
      model: String(parsed.modelVersion ?? ''),
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
    const clock = time ?? { nowMs: () => Date.now() }; // clock-exempt: fallback only
    const streamStart = clock.nowMs();

    let toolCallIndex = 0;

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

        // Gemini streaming: each event contains a partial candidate
        const candidates = parsed.candidates as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(candidates) && candidates.length > 0) {
          const firstCandidate = candidates[0]!;
          const content = firstCandidate.content as Record<string, unknown> | undefined;
          const parts = content?.parts as Array<Record<string, unknown>> | undefined;

          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (typeof part !== 'object' || part === null) continue;

              if (typeof part.text === 'string') {
                yield {
                  type: 'content_delta',
                  delta: part.text,
                };
              } else if (part.functionCall) {
                const fc = part.functionCall as Record<string, unknown>;
                const validated = validateGeminiFunctionCall(fc, toolCallIndex++);
                if (validated) {
                  // Emit as tool_call_delta (Gemini sends complete tool calls, not deltas)
                  yield {
                    type: 'tool_call_delta',
                    toolCallId: validated.id,
                    name: validated.name,
                    inputDelta: JSON.stringify(validated.input),
                  };
                }
              }
            }
          }

          // Check finish reason
          const finishReason = firstCandidate.finishReason as string | undefined;
          if (finishReason && finishReason !== 'FINISH_REASON_UNSPECIFIED') {
            yield {
              type: 'done',
              finishReason: mapGeminiFinishReason(finishReason, false),
            };
          }
        }

        // Usage metadata (Gemini sends this with the final chunk)
        const usageMetadata = parsed.usageMetadata as Record<string, unknown> | undefined;
        if (usageMetadata) {
          const promptTokens = typeof usageMetadata.promptTokenCount === 'number'
            ? usageMetadata.promptTokenCount : 0;
          const candidateTokens = typeof usageMetadata.candidatesTokenCount === 'number'
            ? usageMetadata.candidatesTokenCount : 0;

          yield {
            type: 'usage',
            inputTokens: promptTokens,
            outputTokens: candidateTokens,
          };

          // Update deliberation from usage metadata
          const thoughtsTokenCount = typeof usageMetadata.thoughtsTokenCount === 'number'
            ? usageMetadata.thoughtsTokenCount : 0;
          if (thoughtsTokenCount > 0) {
            deliberation = {
              deliberationTokens: thoughtsTokenCount,
              accountingMode: 'provider_authoritative',
              providerReportedThinkingTokens: thoughtsTokenCount,
            };
          }
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
 * Create a Gemini adapter with API key from environment variable.
 * C-SEC-P5-01/02: Key is read from env and NEVER logged.
 * CR-1: Key resolved once at creation.
 *
 * @param providerId - Provider identifier
 * @param baseUrl - Base URL (e.g., 'https://generativelanguage.googleapis.com')
 * @param apiKeyEnvVar - Environment variable name containing the API key
 * @param time - Optional TimeProvider
 * @throws Error if API key env var is not set (message does NOT include key value)
 */
export function createGeminiAdapterFromEnv(
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

  return createGeminiAdapter(providerId, baseUrl, apiKey, time);
}

// ─── Helpers ───

/**
 * Map Gemini finishReason to Limen finish reason.
 */
function mapGeminiFinishReason(
  reason: string | undefined,
  hasToolCalls: boolean,
): 'stop' | 'length' | 'tool_use' | 'content_filter' {
  switch (reason) {
    case 'STOP':
      return hasToolCalls ? 'tool_use' : 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
      return 'content_filter';
    default:
      return hasToolCalls ? 'tool_use' : 'stop';
  }
}

// ─── Exported for testing ───
export { RETRYABLE_STATUS_CODES, TOOL_NAME_PATTERN, validateGeminiFunctionCall, mapGeminiFinishReason };
