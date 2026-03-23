/**
 * Ollama API adapter (local-only, NDJSON, no auth).
 * S ref: §25.4 (LLM Gateway), I-01 (no SDK deps), I-04 (provider independence)
 *
 * Phase: 5C (Sprint 5C — Ollama + Groq + Mistral Adapters)
 * Implements: ProviderAdapter for Ollama's local REST API.
 *
 * Ollama is fundamentally different from cloud providers:
 *   - Local-only: C-SEC-P5-05 enforces localhost/127.0.0.1/[::1] restriction
 *   - No auth: No API key, no Bearer token
 *   - NDJSON streaming: Not SSE. Each line is a complete JSON object.
 *   - Custom request format: `options` object instead of top-level fields
 *   - Custom response format: `message` (singular), `prompt_eval_count`, `eval_count`
 *   - Tool calls: `arguments` is an OBJECT (not JSON string like OpenAI)
 *
 * Auth: NONE. Ollama is a local server.
 * URL: {baseUrl}/api/chat (default baseUrl: http://localhost:11434)
 *
 * C-SEC-P5-05: URL validation — ONLY allow localhost/127.0.0.1/[::1].
 *              Throws TRANSPORT_INVALID_URL if non-local.
 * C-SEC-P5-19 exception: TLS NOT required for localhost.
 * C-SEC-P5-23: Tool call validation — name matches TOOL_NAME_PATTERN, args is object.
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
import { parseNDJSONStream } from '../stream_parser.js';
import type { TimeProvider } from '../../../kernel/interfaces/time.js';

// ─── Constants ───

/** Retryable HTTP status codes for Ollama */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

/** C-SEC-P5-23: Valid tool name pattern */
const TOOL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** C-SEC-P5-05: Allowed localhost hostnames */
const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

// ─── URL Validation (C-SEC-P5-05) ───

/**
 * C-SEC-P5-05: Validate that a URL points to localhost only.
 * Ollama MUST only connect to local servers.
 * Throws with TRANSPORT_INVALID_URL if non-local.
 */
function validateLocalhostUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(
      `TRANSPORT_INVALID_URL: Invalid URL format for Ollama adapter. Only localhost URLs are allowed.`,
    );
  }

  // Extract hostname — URL class normalizes [::1] to [::1] in hostname
  const hostname = parsed.hostname;

  if (!LOCALHOST_HOSTNAMES.has(hostname)) {
    throw new Error(
      `TRANSPORT_INVALID_URL: Ollama adapter only allows localhost connections. ` +
      `Received hostname: ${hostname}. Allowed: localhost, 127.0.0.1, [::1].`,
    );
  }
}

// ─── Tool Call Validation (C-SEC-P5-23) ───

/**
 * Validate an Ollama tool call.
 * C-SEC-P5-23: Name must match pattern, args must be an object.
 * Ollama tool_calls use `arguments` as an OBJECT (not JSON string).
 * Ollama does NOT provide a tool call id — we generate one.
 */
function validateOllamaToolCall(
  tc: Record<string, unknown>,
  index: number,
): LlmToolCall | null {
  const fn = tc.function as Record<string, unknown> | undefined;
  if (typeof fn !== 'object' || fn === null) return null;

  // Name matches valid pattern
  const name = fn.name;
  if (typeof name !== 'string' || !TOOL_NAME_PATTERN.test(name)) return null;

  // Arguments must be an object (Ollama sends it as an object, not a JSON string)
  const args = fn.arguments;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;

  // Ollama does not provide IDs — generate a deterministic one
  const id = `ollama-call-${index}`;

  return {
    id,
    name,
    input: args as Record<string, unknown>,
  };
}

// ─── Ollama Request Translation ───

/**
 * Build an Ollama-format request body from a Limen LlmRequest.
 * Ollama uses a different structure from OpenAI:
 *   - `messages` array (same structure as OpenAI)
 *   - `options` object for generation parameters (not top-level)
 *   - `stream` boolean
 *   - `model` at top level
 */
function buildOllamaRequestBody(
  request: LlmRequest,
  streaming: boolean,
): Record<string, unknown> {
  // Build messages array
  const messages: Array<Record<string, unknown>> = [];

  // System prompt -> system message
  if (request.systemPrompt) {
    messages.push({ role: 'system', content: request.systemPrompt });
  }

  for (const msg of request.messages) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
    } else {
      // Ollama primarily handles text — collapse content blocks to text
      const blocks = msg.content as readonly LlmContentBlock[];
      const textContent = blocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join('\n');
      messages.push({ role: msg.role, content: textContent });
    }
  }

  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    stream: streaming,
  };

  // Generation options
  const options: Record<string, unknown> = {};
  if (request.maxTokens !== undefined) {
    options.num_predict = request.maxTokens;
  }
  if (request.temperature !== undefined) {
    options.temperature = request.temperature;
  }
  if (Object.keys(options).length > 0) {
    body.options = options;
  }

  // Tools
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

  return body;
}

// ─── Ollama Response Parsing ───

/**
 * Parse an Ollama non-streaming response.
 * Response format:
 *   {
 *     model: "llama3",
 *     message: { role: "assistant", content: "..." },
 *     done: true,
 *     prompt_eval_count: 42,
 *     eval_count: 128
 *   }
 */
function parseOllamaResponse(
  httpResponse: TransportHttpResponse,
  providerId: string,
): TransportResult {
  // C-SEC-P5-07: JSON parse safety
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(httpResponse.body) as Record<string, unknown>;
  } catch {
    throw new Error(`JSON parse error: invalid response body from ${providerId}`);
  }

  // C-SEC-P5-22: Validate structure
  const message = parsed.message as Record<string, unknown> | undefined;
  if (!message) {
    throw new Error(`${providerId} response missing message object`);
  }

  // Extract content
  const rawContent = message.content;
  const contentText = typeof rawContent === 'string' ? rawContent : '';

  // Extract tool calls (C-SEC-P5-23)
  const toolCalls: LlmToolCall[] = [];
  const responseBlocks: LlmContentBlock[] = [];

  if (contentText) {
    responseBlocks.push({ type: 'text', text: contentText });
  }

  const rawToolCalls = message.tool_calls;
  if (Array.isArray(rawToolCalls)) {
    let toolCallIndex = 0;
    for (const tc of rawToolCalls) {
      if (typeof tc !== 'object' || tc === null) continue;
      const validated = validateOllamaToolCall(tc as Record<string, unknown>, toolCallIndex++);
      if (validated) {
        toolCalls.push(validated);
        responseBlocks.push({
          type: 'tool_use',
          id: validated.id,
          name: validated.name,
          input: validated.input,
        });
      }
      // Invalid tool calls silently dropped — provider output is untrusted
    }
  }

  // Extract usage — Ollama uses prompt_eval_count and eval_count
  const promptEvalCount = typeof parsed.prompt_eval_count === 'number' ? parsed.prompt_eval_count : 0;
  const evalCount = typeof parsed.eval_count === 'number' ? parsed.eval_count : 0;

  // Deliberation — Ollama never reports reasoning tokens
  const deliberation: DeliberationMetrics = {
    deliberationTokens: 0,
    accountingMode: 'estimated',
    providerReportedThinkingTokens: null,
  };

  // Finish reason — map from Ollama's done_reason if present
  const doneReason = parsed.done_reason as string | undefined;
  const finishReason = mapOllamaFinishReason(doneReason, toolCalls.length > 0);

  const response: LlmResponse = {
    content: responseBlocks.length === 1 && responseBlocks[0]?.type === 'text'
      ? (responseBlocks[0] as { type: 'text'; text: string }).text
      : responseBlocks.length > 0 ? responseBlocks : contentText,
    toolCalls,
    finishReason,
    usage: {
      inputTokens: promptEvalCount,
      outputTokens: evalCount,
      providerInputTokens: promptEvalCount,
      providerOutputTokens: evalCount,
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

// ─── Ollama Adapter Factory ───

/**
 * Create an Ollama API adapter.
 *
 * C-SEC-P5-05: Validates that baseUrl is localhost at creation time.
 * No API key — Ollama is a local server.
 *
 * @param providerId - Provider identifier for health tracking
 * @param baseUrl - Base URL for the Ollama server (default: http://localhost:11434)
 * @param time - Optional TimeProvider for clock injection (Hard Stop #7)
 * @throws Error with TRANSPORT_INVALID_URL if baseUrl is not localhost
 */
export function createOllamaAdapter(
  providerId: string,
  baseUrl: string = 'http://localhost:11434',
  time?: TimeProvider,
): ProviderAdapter {
  // C-SEC-P5-05: Validate localhost at creation time
  validateLocalhostUrl(baseUrl);

  function buildRequest(request: LlmRequest, streaming: boolean): TransportHttpRequest {
    const url = `${baseUrl}/api/chat`;
    const body = buildOllamaRequestBody(request, streaming);

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
    return parseOllamaResponse(httpResponse, providerId);
  }

  function parseStream(
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): TransportStreamResult {
    // Ollama never reports reasoning tokens
    const deliberation: DeliberationMetrics = {
      deliberationTokens: 0,
      accountingMode: 'estimated',
      providerReportedThinkingTokens: null,
    };
    let totalMs = 0;
    const clock = time ?? { nowMs: () => Date.now() }; // clock-exempt: fallback only
    const streamStart = clock.nowMs();

    async function* processStream(): AsyncIterable<LlmStreamChunk> {
      for await (const chunk of parseNDJSONStream(body, signal, time)) {
        const message = chunk.message as Record<string, unknown> | undefined;
        const done = chunk.done === true;

        if (!done && message) {
          // Content delta from message.content when done === false
          const content = message.content;
          if (typeof content === 'string' && content.length > 0) {
            yield {
              type: 'content_delta',
              delta: content,
            };
          }
        }

        if (done) {
          // Final chunk — extract usage from prompt_eval_count and eval_count
          const promptEvalCount = typeof chunk.prompt_eval_count === 'number' ? chunk.prompt_eval_count : 0;
          const evalCount = typeof chunk.eval_count === 'number' ? chunk.eval_count : 0;

          yield {
            type: 'usage',
            inputTokens: promptEvalCount,
            outputTokens: evalCount,
          };

          // Finish reason from done_reason
          const doneReason = chunk.done_reason as string | undefined;
          const finishReason = mapOllamaFinishReason(doneReason, false);

          yield {
            type: 'done',
            finishReason,
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

// ─── Helpers ───

/**
 * Map Ollama done_reason to Limen finish reason.
 * Ollama uses: 'stop', 'length', or undefined (defaults to 'stop').
 */
function mapOllamaFinishReason(
  reason: string | undefined,
  hasToolCalls: boolean,
): 'stop' | 'length' | 'tool_use' | 'content_filter' {
  if (hasToolCalls) return 'tool_use';
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    default:
      return 'stop';
  }
}

// ─── Exported for testing ───
export {
  RETRYABLE_STATUS_CODES,
  TOOL_NAME_PATTERN,
  validateLocalhostUrl,
  validateOllamaToolCall,
  mapOllamaFinishReason,
  LOCALHOST_HOSTNAMES,
};
