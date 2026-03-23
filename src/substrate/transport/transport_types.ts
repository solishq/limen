/**
 * Transport layer types for LLM HTTP communication.
 * S ref: §25.4 (LLM Gateway), I-01 (no SDK deps), I-04 (provider independence)
 *
 * Phase: 5A (Sprint 5A — Shared Transport Infrastructure)
 * Implements: All composition types for the transport engine and provider adapters.
 *
 * This file is TYPES ONLY — no runtime logic.
 *
 * Design Source: Phase 5 Design Source Output 2 (Type Architecture)
 */

import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type {
  LlmRequest,
  LlmResponse,
  LlmStreamChunk,
} from '../interfaces/substrate.js';

// ============================================================================
// Transport Error Codes (Design Source Output 5)
// ============================================================================

/**
 * Transport-layer error codes. Each maps to a specific failure scenario.
 * S ref: §25.4, FM-06 (provider dependency), FM-12 (failover cascade)
 */
export type TransportErrorCode =
  | 'TRANSPORT_TIMEOUT'           // Total duration cap exceeded (120s non-streaming)
  | 'TRANSPORT_RETRY_EXHAUSTED'   // All retries consumed without success
  | 'TRANSPORT_CIRCUIT_OPEN'      // Circuit breaker prevents request
  | 'TRANSPORT_RESPONSE_TOO_LARGE' // Response exceeds 10MB limit (C-SEC-P5-06)
  | 'TRANSPORT_JSON_PARSE_ERROR'  // Response body is not valid JSON (C-SEC-P5-07)
  | 'TRANSPORT_TLS_REQUIRED'      // Non-TLS URL for non-local endpoint (C-SEC-P5-19)
  | 'TRANSPORT_PROVIDER_ERROR'    // Provider returned non-retryable error
  | 'TRANSPORT_NETWORK_ERROR'     // Network-level failure (DNS, connection refused)
  | 'TRANSPORT_ABORTED'           // Caller cancelled via AbortSignal
  | 'TRANSPORT_STREAM_ERROR'      // Stream-level error (stall, max events, etc.)
  | 'TRANSPORT_RETRY_AFTER_TOO_LONG' // Retry-After > 60s cap (CR-2)
  | 'GATEWAY_SHUTTING_DOWN'       // Shutdown initiated, rejecting new requests (C-SEC-P5-20)
  | 'TRANSPORT_MISSING_API_KEY'   // API key env var not set
  | 'TRANSPORT_FIRST_BYTE_TIMEOUT' // Streaming: no first byte within 30s (CR-3)
  | 'TRANSPORT_STALL_DETECTED'    // Streaming: no data for 30s after first byte (CR-3)
  | 'TRANSPORT_STREAM_TOTAL_TIMEOUT' // Streaming: total duration exceeded 10min (CR-3)
  | 'TRANSPORT_SSE_LINE_TOO_LONG' // SSE line exceeds 1MB (C-SEC-P5-10)
  | 'TRANSPORT_SSE_MAX_EVENTS'    // SSE event count exceeds 100K (C-SEC-P5-11)
  | 'TRANSPORT_NDJSON_LINE_TOO_LONG'; // NDJSON line exceeds 1MB (C-SEC-P5-10)

// ============================================================================
// SSE Event Type
// ============================================================================

/**
 * A parsed Server-Sent Event.
 * S ref: §27 (streaming protocol)
 */
export interface SSEEvent {
  /** The event type field (empty string if not specified) */
  readonly event: string;
  /** The data field (may span multiple lines, joined with \n) */
  readonly data: string;
  /** The id field (if present) */
  readonly id?: string;
  /** The retry field in milliseconds (if present) */
  readonly retry?: number;
}

// ============================================================================
// Transport Request/Response
// ============================================================================

/**
 * A provider-specific HTTP request, built by the adapter.
 * S ref: I-01 (fetch-based, no SDK), I-04 (provider independence)
 */
export interface TransportHttpRequest {
  /** Full URL for the HTTP request */
  readonly url: string;
  /** HTTP method (always POST for LLM APIs) */
  readonly method: 'POST';
  /** HTTP headers (includes auth, content-type, provider-specific headers) */
  readonly headers: Readonly<Record<string, string>>;
  /** JSON-serializable request body */
  readonly body: Record<string, unknown>;
  /** Whether this request expects a streaming response */
  readonly stream: boolean;
}

/**
 * Raw HTTP response before provider-specific parsing.
 */
export interface TransportHttpResponse {
  /** HTTP status code */
  readonly status: number;
  /** HTTP headers */
  readonly headers: Readonly<Record<string, string>>;
  /** Response body as string (for non-streaming) */
  readonly body: string;
}

// ============================================================================
// Provider Adapter Interface
// ============================================================================

/**
 * Deliberation metrics extracted from provider responses.
 * Tracks thinking/reasoning token usage for cost accounting.
 * S ref: §25.6 (resource accounting — deliberation columns)
 *
 * CR-5: The Anthropic adapter handles thinking blocks → deliberation.
 *       OpenAI reasoning_tokens subtraction is NOT included (that is OpenAI-specific).
 */
export interface DeliberationMetrics {
  /** Number of deliberation/thinking tokens consumed */
  readonly deliberationTokens: number;
  /** Whether deliberation data is authoritative (from provider) or estimated */
  readonly accountingMode: 'provider_authoritative' | 'estimated';
  /** Raw provider-reported thinking token count, or null if not applicable */
  readonly providerReportedThinkingTokens: number | null;
}

/**
 * Result from a non-streaming transport execution.
 * Includes both the LLM response and transport-level metadata.
 */
export interface TransportResult {
  /** The parsed LLM response */
  readonly response: LlmResponse;
  /** Deliberation metrics for accounting */
  readonly deliberation: DeliberationMetrics;
  /** Number of retry attempts made */
  readonly retryCount: number;
  /** Total wall clock time including retries */
  readonly totalMs: number;
}

/**
 * Result from a streaming transport execution.
 * The stream is an async iterable of LlmStreamChunks.
 */
export interface TransportStreamResult {
  /** The async iterable stream of chunks */
  readonly stream: AsyncIterable<LlmStreamChunk>;
  /** Deliberation metrics — populated after stream completes */
  readonly getDeliberation: () => DeliberationMetrics;
  /** Total wall clock time — populated after stream completes */
  readonly getTotalMs: () => number;
}

/**
 * Provider adapter interface. Each provider (Anthropic, OpenAI, Ollama)
 * implements this interface to translate between Limen's internal
 * LlmRequest/LlmResponse and the provider's HTTP API.
 *
 * S ref: I-04 (provider independence), I-01 (no SDK deps)
 *
 * Key constraints:
 * - C-SEC-P5-01/02: API key NEVER appears in logs or error messages
 * - C-SEC-P5-22: Provider output is untrusted input
 * - C-SEC-P5-23: Tool call structural validation
 * - CR-1 / C-SEC-P5-04: API key resolved ONCE at creation, NOT per-request
 */
export interface ProviderAdapter {
  /** Provider identifier (e.g., 'anthropic', 'openai', 'ollama') */
  readonly providerId: string;

  /**
   * Build provider-specific HTTP request from Limen LlmRequest.
   * API key is embedded in headers at this point (resolved at adapter creation).
   */
  buildRequest(request: LlmRequest, streaming: boolean): TransportHttpRequest;

  /**
   * Parse provider-specific HTTP response into Limen LlmResponse.
   * C-SEC-P5-22: Provider output is untrusted — validate structure.
   * C-SEC-P5-23: Tool calls must have non-empty id, valid name, object input.
   */
  parseResponse(httpResponse: TransportHttpResponse): TransportResult;

  /**
   * Parse a streaming response into an async iterable of LlmStreamChunks.
   * Thinking blocks are aggregated internally and NOT emitted as LlmStreamChunk.
   * Deliberation metrics are available via getDeliberation() after stream completes.
   */
  parseStream(
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): TransportStreamResult;

  /** Whether this adapter supports streaming responses */
  supportsStreaming(): boolean;

  /**
   * Whether the given HTTP status code is retryable for this provider.
   * S ref: FM-12 (failover), DL-1 (circuit breaker)
   */
  isRetryableStatus(status: number): boolean;
}

// ============================================================================
// Transport Engine Interface
// ============================================================================

/**
 * Transport engine options for a single request.
 */
export interface TransportExecuteOptions {
  /** The original LLM request (for logging and metadata) */
  readonly request: LlmRequest;
  /** Optional caller-provided abort signal */
  readonly signal?: AbortSignal;
}

/**
 * Transport engine — executes HTTP requests against LLM providers.
 * Handles retry logic, circuit breaker integration, timeouts, and health updates.
 *
 * S ref: §25.4 (LLM Gateway), I-01 (fetch-based), I-04 (provider independence)
 *
 * Key behaviors:
 * - Non-streaming: 2 retries (3 total), 120s duration cap, Retry-After parsing
 * - Streaming: NO retry after first byte, 30s first-byte timeout, 30s stall, 10min total
 * - Circuit breaker checked BEFORE each attempt (C-SEC-P5-15)
 * - Response size limit 10MB (C-SEC-P5-06)
 * - TLS enforcement for non-local URLs (C-SEC-P5-19)
 * - Shutdown support via AbortController tracking (C-SEC-P5-20)
 */
export interface TransportEngine {
  /**
   * Execute a non-streaming LLM request with retry logic.
   * Returns TransportResult on success, or rejects with a transport error.
   */
  execute(adapter: ProviderAdapter, options: TransportExecuteOptions): Promise<TransportResult>;

  /**
   * Execute a streaming LLM request.
   * No retry after first byte received.
   * Returns TransportStreamResult on success, or rejects with a transport error.
   */
  executeStream(adapter: ProviderAdapter, options: TransportExecuteOptions): Promise<TransportStreamResult>;

  /**
   * Initiate graceful shutdown. All in-flight requests are aborted
   * with GATEWAY_SHUTTING_DOWN. New requests are rejected immediately.
   * C-SEC-P5-20: Shutdown support.
   */
  shutdown(): void;
}

// ============================================================================
// Health Update Function Type
// ============================================================================

/**
 * Function type for updating provider health after each request attempt.
 * S ref: DL-1 (circuit breaker), §25.4 (provider health tracking)
 */
export type UpdateProviderHealthFn = (
  providerId: string,
  success: boolean,
  latencyMs: number,
  errorMessage?: string,
) => void;

// ============================================================================
// Circuit Breaker Check Function Type
// ============================================================================

/**
 * Function type for checking circuit breaker state before a request.
 * Returns true if the circuit is OPEN (request should NOT proceed).
 * S ref: C-SEC-P5-15, DL-1
 */
export type IsCircuitOpenFn = (providerId: string) => boolean;

// ============================================================================
// Transport Engine Factory Options
// ============================================================================

/**
 * Options for creating a transport engine instance.
 */
export interface TransportEngineOptions {
  /** Time provider for clock injection (Hard Stop #7) */
  readonly time?: TimeProvider;
  /** Function to update provider health after attempts */
  readonly updateHealth?: UpdateProviderHealthFn;
  /** Function to check circuit breaker state */
  readonly isCircuitOpen?: IsCircuitOpenFn;
}
