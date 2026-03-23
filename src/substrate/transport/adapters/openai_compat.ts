/**
 * Shared pure functions for OpenAI-compatible request/response translation.
 * S ref: §25.4 (LLM Gateway), I-01 (no SDK deps), I-04 (provider independence)
 *
 * Phase: 5B (Sprint 5B — OpenAI + Google Adapters)
 * Used by: openai_adapter.ts (directly), groq_adapter.ts, mistral_adapter.ts (Sprint 5C)
 *
 * These functions handle the OpenAI Chat Completions wire format shared by
 * multiple providers. They are PURE — no state, no side effects, no auth.
 *
 * CR-5 ENFORCEMENT (HARD REQUIREMENT — I-49/I-59):
 *   When usage.completion_tokens_details.reasoning_tokens is present and > 0:
 *     outputTokens = completion_tokens - reasoning_tokens
 *     providerOutputTokens = completion_tokens (raw)
 *     deliberation.deliberationTokens = reasoning_tokens
 *     deliberation.accountingMode = 'provider_authoritative'
 *     deliberation.providerReportedThinkingTokens = reasoning_tokens
 *
 * C-SEC-P5-22: Provider output is untrusted — validate structure.
 * C-SEC-P5-23: Tool call structural validation.
 */

import type {
  TransportHttpRequest,
  TransportHttpResponse,
  TransportResult,
  DeliberationMetrics,
} from '../transport_types.js';
import type {
  LlmRequest,
  LlmResponse,
  LlmContentBlock,
  LlmToolCall,
} from '../../interfaces/substrate.js';

// ─── Constants ───

/** C-SEC-P5-23: Valid tool name pattern (same as Anthropic adapter) */
const TOOL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// ─── Tool Call Validation (C-SEC-P5-23) ───

/**
 * Validate a tool call's structural integrity for OpenAI-format responses.
 * C-SEC-P5-23: Non-empty id, name matches pattern, arguments is valid JSON object.
 * OpenAI uses `function.name` and `function.arguments` (JSON string).
 */
function validateToolCall(tc: Record<string, unknown>): LlmToolCall | null {
  const id = tc.id;
  const fn = tc.function as Record<string, unknown> | undefined;

  // Non-empty id
  if (typeof id !== 'string' || id.length === 0) return null;

  // Function object must exist
  if (typeof fn !== 'object' || fn === null) return null;

  // Name matches valid pattern
  const name = fn.name;
  if (typeof name !== 'string' || !TOOL_NAME_PATTERN.test(name)) return null;

  // Arguments must be a JSON string that parses to an object
  const args = fn.arguments;
  if (typeof args !== 'string') return null;

  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(args);
  } catch {
    return null;
  }

  if (typeof parsedArgs !== 'object' || parsedArgs === null || Array.isArray(parsedArgs)) {
    return null;
  }

  return {
    id,
    name,
    input: parsedArgs as Record<string, unknown>,
  };
}

// ─── Request Translation ───

/**
 * Build an OpenAI Chat Completions-compatible HTTP request from an LlmRequest.
 * Pure function — auth headers and URL are provided by the calling adapter.
 *
 * @param request - The Limen LlmRequest
 * @param streaming - Whether to enable streaming
 * @param url - The full URL for the request (constructed by adapter)
 * @param headers - HTTP headers including auth (constructed by adapter)
 */
export function buildOpenAICompatRequest(
  request: LlmRequest,
  streaming: boolean,
  url: string,
  headers: Record<string, string>,
): TransportHttpRequest {
  // Build messages array
  const messages: Array<Record<string, unknown>> = [];

  // System prompt → system message
  if (request.systemPrompt) {
    messages.push({ role: 'system', content: request.systemPrompt });
  }

  for (const msg of request.messages) {
    if (msg.role === 'system') {
      // System messages go as system role
      messages.push({
        role: 'system',
        content: typeof msg.content === 'string'
          ? msg.content
          : (msg.content as readonly LlmContentBlock[])
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map(b => b.text)
              .join('\n'),
      });
      continue;
    }

    // Map Limen content blocks to OpenAI format
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
    } else {
      const blocks = msg.content as readonly LlmContentBlock[];
      // Check if all blocks are text — collapse to string
      const allText = blocks.every(b => b.type === 'text');
      if (allText) {
        messages.push({
          role: msg.role,
          content: blocks
            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
            .map(b => b.text)
            .join('\n'),
        });
      } else {
        // Multi-modal content blocks
        const parts: Array<Record<string, unknown>> = [];
        for (const block of blocks) {
          switch (block.type) {
            case 'text':
              parts.push({ type: 'text', text: block.text });
              break;
            case 'image':
              parts.push({
                type: 'image_url',
                image_url: { url: `data:${block.mediaType};base64,${block.data}` },
              });
              break;
            case 'tool_use':
              // Tool use blocks map to assistant messages with tool_calls
              // These are handled differently — pass through
              parts.push({ type: 'text', text: '' });
              break;
            case 'tool_result':
              // Tool results map to tool role messages
              messages.push({
                role: 'tool',
                tool_call_id: block.toolUseId,
                content: block.content,
              });
              break;
          }
        }
        if (parts.length > 0) {
          messages.push({ role: msg.role, content: parts });
        }
      }
    }
  }

  // Build request body
  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    max_tokens: request.maxTokens,
  };

  // Temperature
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
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

  // Streaming
  if (streaming) {
    body.stream = true;
    // Request usage stats in streaming mode
    body.stream_options = { include_usage: true };
  }

  return {
    url,
    method: 'POST',
    headers,
    body,
    stream: streaming,
  };
}

// ─── Response Parsing ───

/**
 * Parse an OpenAI Chat Completions-compatible response into a TransportResult.
 * Pure function — providerId is supplied by the calling adapter.
 *
 * CR-5 ENFORCEMENT (HARD REQUIREMENT):
 *   When completion_tokens_details.reasoning_tokens is present and > 0:
 *     outputTokens = completion_tokens - reasoning_tokens
 *     providerOutputTokens = completion_tokens (raw, before subtraction)
 *     deliberation.deliberationTokens = reasoning_tokens
 *
 * C-SEC-P5-22: Provider output is untrusted — validate structure.
 * C-SEC-P5-23: Tool call structural validation.
 *
 * @param httpResponse - Raw HTTP response
 * @param providerId - Provider identifier for the response
 */
export function parseOpenAICompatResponse(
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
  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error(`${providerId} response missing choices array`);
  }

  const firstChoice = choices[0] as Record<string, unknown>;
  const message = firstChoice.message as Record<string, unknown> | undefined;
  if (!message) {
    throw new Error(`${providerId} response missing message in first choice`);
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
    for (const tc of rawToolCalls) {
      if (typeof tc !== 'object' || tc === null) continue;
      const validated = validateToolCall(tc as Record<string, unknown>);
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

  // Extract usage
  const usage = parsed.usage as Record<string, unknown> | undefined;
  const promptTokens = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
  const completionTokens = typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0;

  // ──── CR-5 ENFORCEMENT (HARD REQUIREMENT — I-49/I-59) ────
  // When completion_tokens_details.reasoning_tokens is present and > 0:
  //   outputTokens = completion_tokens - reasoning_tokens
  //   providerOutputTokens = completion_tokens (raw, BEFORE subtraction)
  //   deliberation.deliberationTokens = reasoning_tokens
  //   deliberation.accountingMode = 'provider_authoritative'
  const completionDetails = usage?.completion_tokens_details as Record<string, unknown> | undefined;
  const reasoningTokens = typeof completionDetails?.reasoning_tokens === 'number'
    ? completionDetails.reasoning_tokens
    : 0;

  let effectiveOutputTokens: number;
  let deliberation: DeliberationMetrics;

  if (reasoningTokens > 0) {
    // CR-5: Subtract reasoning tokens to avoid double-counting
    // Floor at 0 to guard against malformed provider responses (C-SEC-P5-22)
    effectiveOutputTokens = Math.max(0, completionTokens - reasoningTokens);
    deliberation = {
      deliberationTokens: reasoningTokens,
      accountingMode: 'provider_authoritative',
      providerReportedThinkingTokens: reasoningTokens,
    };
  } else {
    // No reasoning tokens — use raw completion_tokens
    effectiveOutputTokens = completionTokens;
    deliberation = {
      deliberationTokens: 0,
      accountingMode: 'estimated',
      providerReportedThinkingTokens: null,
    };
  }

  // Extract finish reason
  const rawFinishReason = firstChoice.finish_reason as string | undefined;
  const finishReason = mapOpenAIFinishReason(rawFinishReason);

  const response: LlmResponse = {
    content: responseBlocks.length === 1 && responseBlocks[0]?.type === 'text'
      ? (responseBlocks[0] as { type: 'text'; text: string }).text
      : responseBlocks.length > 0 ? responseBlocks : contentText,
    toolCalls,
    finishReason,
    usage: {
      inputTokens: promptTokens,
      outputTokens: effectiveOutputTokens,
      providerInputTokens: promptTokens,
      providerOutputTokens: completionTokens, // CR-5: raw value BEFORE subtraction
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

// ─── Helpers ───

/**
 * Map OpenAI finish_reason to Limen finish reason.
 */
function mapOpenAIFinishReason(reason: string | undefined): 'stop' | 'length' | 'tool_use' | 'content_filter' {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
      return 'tool_use';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'stop';
  }
}

// ─── Exported for testing ───
export { validateToolCall, mapOpenAIFinishReason, TOOL_NAME_PATTERN };
