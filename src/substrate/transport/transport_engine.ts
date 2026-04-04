/**
 * Core transport engine for LLM HTTP communication.
 * S ref: §25.4 (LLM Gateway), I-01 (no SDK deps), I-04 (provider independence)
 *
 * Phase: 5A (Sprint 5A — Shared Transport Infrastructure)
 * Implements: createTransportEngine() factory
 *
 * Behaviors:
 *   execute() — non-streaming: fetch + retry (2 retries / 3 total, 120s cap, 60s Retry-After cap)
 *   executeStream() — streaming: fetch + NO retry after first byte, tiered timeouts
 *   shutdown() — abort all in-flight requests, reject new requests
 *
 * Security constraints enforced:
 *   C-SEC-P5-06: Response size limit 10MB
 *   C-SEC-P5-07: JSON parse safety
 *   C-SEC-P5-15: Circuit breaker checked BEFORE each retry
 *   C-SEC-P5-19: TLS enforcement for non-local URLs
 *   C-SEC-P5-20: Shutdown support (GATEWAY_SHUTTING_DOWN)
 *   CR-1 / C-SEC-P5-04: API key resolved ONCE at adapter creation
 *   CR-2: Retry-After > 60s → hard error
 *   CR-3: Streaming timeouts (30s first-byte, 30s stall, 10min total)
 *
 * Hard Stop #7: All temporal logic uses TimeProvider.
 */

import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type {
  ProviderAdapter,
  TransportExecuteOptions,
  TransportResult,
  TransportStreamResult,
  TransportEngine,
  TransportEngineOptions,
  TransportErrorCode,
  TransportHttpResponse,
} from './transport_types.js';

// ─── Constants ───

/** Maximum number of retries for non-streaming requests (2 retries = 3 total attempts) */
const MAX_RETRIES = 2;

/** Total duration cap for non-streaming requests: 120 seconds */
const DURATION_CAP_MS = 120_000;

/** Maximum Retry-After value: 60 seconds (CR-2) */
const MAX_RETRY_AFTER_MS = 60_000;

/** Response size limit: 10MB (C-SEC-P5-06) */
const MAX_RESPONSE_BYTES = 10_485_760;

/** Streaming: first-byte timeout 30s (CR-3) */
const STREAM_FIRST_BYTE_TIMEOUT_MS = 30_000;

/** Streaming: stall detection timeout 30s (CR-3) */
const STREAM_STALL_TIMEOUT_MS = 30_000;

/** Streaming: total duration cap 10 minutes (CR-3) */
const STREAM_TOTAL_TIMEOUT_MS = 600_000;

// ─── Error Helper ───

class TransportError extends Error {
  readonly code: TransportErrorCode;
  constructor(code: TransportErrorCode, message: string) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
  }
}

/**
 * C-SEC-P5-01/02: Scrub potential credentials from error messages.
 * Removes URL query parameter values that could contain API keys
 * (e.g., Gemini ?key=AIzaSy...) and Bearer tokens.
 */
function scrubErrorMessage(msg: string): string {
  return msg
    .replace(/([?&])key=[^&\s]*/gi, '$1key=[REDACTED]')
    .replace(/Bearer\s+[^\s"']*/gi, 'Bearer [REDACTED]');
}

// ─── URL Validation ───

/**
 * Check if a URL is a local address (loopback or localhost).
 * Local URLs are exempt from TLS enforcement.
 */
function isLocalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname.endsWith('.local')
    );
  } catch {
    return false;
  }
}

/**
 * C-SEC-P5-19: TLS enforcement for non-local URLs.
 * Reject http:// URLs that are not local.
 */
function enforceTls(url: string): void {
  if (url.startsWith('http://') && !isLocalUrl(url)) {
    throw new TransportError(
      'TRANSPORT_TLS_REQUIRED',
      'Non-local URLs must use HTTPS (C-SEC-P5-19)',
    );
  }
}

// ─── Retry-After Parsing ───

/**
 * Parse HTTP Retry-After header value.
 * Supports both seconds format and HTTP-date format.
 * Returns delay in milliseconds, or null if unparseable.
 */
function parseRetryAfter(value: string | null, clock: TimeProvider): number | null {
  if (!value) return null;

  // Try as seconds (integer)
  const seconds = parseInt(value, 10);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  // Try as HTTP-date
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    const delayMs = date - clock.nowMs();
    return delayMs > 0 ? delayMs : 0;
  }

  return null;
}

// ─── Response Size Check ───

/**
 * C-SEC-P5-06: Check response size from Content-Length header.
 * Also checked after reading the body.
 */
function checkResponseSize(contentLength: string | null): void {
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!Number.isNaN(size) && size > MAX_RESPONSE_BYTES) {
      throw new TransportError(
        'TRANSPORT_RESPONSE_TOO_LARGE',
        `Response size ${size} bytes exceeds limit of ${MAX_RESPONSE_BYTES} bytes (C-SEC-P5-06)`,
      );
    }
  }
}

// ─── Transport Engine Factory ───

/**
 * Create a transport engine instance.
 * S ref: §25.4, C-07 (Object.freeze)
 *
 * @param options - Configuration options including time provider, health updater, circuit breaker
 */
export function createTransportEngine(options?: TransportEngineOptions): TransportEngine {
  const clock = options?.time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  const updateHealth = options?.updateHealth;
  const isCircuitOpen = options?.isCircuitOpen;

  /** C-SEC-P5-20: Track in-flight controllers for shutdown */
  const inFlightControllers = new Set<AbortController>();
  let shuttingDown = false;

  /**
   * Create a composed abort signal from caller signal + timeout.
   * Uses AbortSignal.any() (Node.js >= 22).
   */
  function createComposedSignal(
    callerSignal: AbortSignal | undefined,
    timeoutMs: number,
    controller: AbortController,
  ): AbortSignal {
    const signals: AbortSignal[] = [controller.signal];
    if (callerSignal) {
      signals.push(callerSignal);
    }
    signals.push(AbortSignal.timeout(timeoutMs));
    return AbortSignal.any(signals);
  }

  /**
   * Extract headers from fetch Response as a plain object.
   */
  function extractHeaders(response: Response): Record<string, string> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }

  /**
   * Execute a non-streaming LLM request with retry logic.
   *
   * Retry policy:
   * - Maximum 2 retries (3 total attempts)
   * - 120s total duration cap
   * - Retry-After > 60s → hard error (CR-2)
   * - Circuit breaker checked BEFORE each attempt (C-SEC-P5-15)
   * - Only retryable status codes trigger retry (adapter.isRetryableStatus)
   */
  async function execute(
    adapter: ProviderAdapter,
    opts: TransportExecuteOptions,
  ): Promise<TransportResult> {
    // C-SEC-P5-20: Reject if shutting down
    if (shuttingDown) {
      throw new TransportError('GATEWAY_SHUTTING_DOWN', 'Transport engine is shutting down');
    }

    const startTime = clock.nowMs();
    let lastError: Error | null = null;
    let retryCount = 0;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // C-SEC-P5-15: Circuit breaker check BEFORE each attempt
      if (isCircuitOpen?.(adapter.providerId)) {
        throw new TransportError(
          'TRANSPORT_CIRCUIT_OPEN',
          `Circuit breaker open for provider ${adapter.providerId}`,
        );
      }

      // Duration cap check
      const elapsed = clock.nowMs() - startTime;
      if (elapsed >= DURATION_CAP_MS) {
        throw new TransportError(
          'TRANSPORT_TIMEOUT',
          `Total duration cap exceeded: ${elapsed}ms >= ${DURATION_CAP_MS}ms`,
        );
      }

      const remainingMs = DURATION_CAP_MS - elapsed;
      const controller = new AbortController();
      inFlightControllers.add(controller);

      try {
        // C-SEC-P5-20: Check shutdown again after adding controller
        if (shuttingDown) {
          throw new TransportError('GATEWAY_SHUTTING_DOWN', 'Transport engine is shutting down');
        }

        const httpRequest = adapter.buildRequest(opts.request, false);

        // C-SEC-P5-19: TLS enforcement
        enforceTls(httpRequest.url);

        const composedSignal = createComposedSignal(opts.signal, remainingMs, controller);

        const attemptStart = clock.nowMs();
        const response = await fetch(httpRequest.url, {
          method: httpRequest.method,
          headers: httpRequest.headers,
          body: JSON.stringify(httpRequest.body),
          signal: composedSignal,
        });

        const attemptLatency = clock.nowMs() - attemptStart;

        // Check if status is retryable
        if (!response.ok && adapter.isRetryableStatus(response.status)) {
          // Parse Retry-After
          const retryAfterMs = parseRetryAfter(
            response.headers.get('retry-after'),
            clock,
          );

          // CR-2: Retry-After > 60s → hard error
          if (retryAfterMs !== null && retryAfterMs > MAX_RETRY_AFTER_MS) {
            updateHealth?.(adapter.providerId, false, attemptLatency, `Retry-After too long: ${retryAfterMs}ms`);
            throw new TransportError(
              'TRANSPORT_RETRY_AFTER_TOO_LONG',
              `Retry-After ${retryAfterMs}ms exceeds maximum ${MAX_RETRY_AFTER_MS}ms (CR-2)`,
            );
          }

          // Update health: failure
          updateHealth?.(adapter.providerId, false, attemptLatency, `HTTP ${response.status}`);

          if (attempt < MAX_RETRIES) {
            retryCount++;
            // Wait for Retry-After delay or use exponential backoff
            const delay = retryAfterMs ?? Math.min(1000 * Math.pow(2, attempt), 10000);
            // PRR-F-002: Listen for abort during delay to avoid TOCTOU race.
            // Previous code only checked composedSignal.aborted once (snapshot),
            // missing aborts that arrive after the check but before timeout fires.
            await new Promise<void>((resolve) => {
              if (composedSignal.aborted) { resolve(); return; }
              const timerId = setTimeout(resolve, delay);
              composedSignal.addEventListener('abort', () => {
                clearTimeout(timerId);
                resolve();
              }, { once: true });
            });
            continue;
          }

          // All retries exhausted
          throw new TransportError(
            'TRANSPORT_RETRY_EXHAUSTED',
            `All ${MAX_RETRIES + 1} attempts failed for provider ${adapter.providerId}. Last status: ${response.status}`,
          );
        }

        // Non-retryable error
        if (!response.ok) {
          const attemptLat = clock.nowMs() - attemptStart;
          updateHealth?.(adapter.providerId, false, attemptLat, `HTTP ${response.status}`);
          throw new TransportError(
            'TRANSPORT_PROVIDER_ERROR',
            `Provider ${adapter.providerId} returned non-retryable status ${response.status}`,
          );
        }

        // C-SEC-P5-06: Check Content-Length
        checkResponseSize(response.headers.get('content-length'));

        // Read response body
        const bodyText = await response.text();

        // C-SEC-P5-06: Verify actual body size
        if (bodyText.length > MAX_RESPONSE_BYTES) {
          throw new TransportError(
            'TRANSPORT_RESPONSE_TOO_LARGE',
            `Response body ${bodyText.length} bytes exceeds limit of ${MAX_RESPONSE_BYTES} bytes (C-SEC-P5-06)`,
          );
        }

        // Build TransportHttpResponse
        const httpResponse: TransportHttpResponse = {
          status: response.status,
          headers: extractHeaders(response),
          body: bodyText,
        };

        // Parse response via adapter (C-SEC-P5-07: JSON parse safety handled here)
        let result: TransportResult;
        try {
          result = adapter.parseResponse(httpResponse);
        } catch (parseErr) {
          const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
          // Distinguish JSON parse errors from other parse errors
          if (msg.includes('JSON') || msg.includes('parse') || msg.includes('Unexpected token')) {
            throw new TransportError(
              'TRANSPORT_JSON_PARSE_ERROR',
              `Failed to parse provider response: ${msg}`,
            );
          }
          throw parseErr;
        }

        const totalMs = clock.nowMs() - startTime;

        // Update health: success
        updateHealth?.(adapter.providerId, true, attemptLatency);

        return {
          ...result,
          retryCount,
          totalMs,
        };
      } catch (error) {
        if (error instanceof TransportError) {
          lastError = error;
          // Re-throw non-retryable transport errors immediately
          if (
            error.code === 'GATEWAY_SHUTTING_DOWN' ||
            error.code === 'TRANSPORT_CIRCUIT_OPEN' ||
            error.code === 'TRANSPORT_TIMEOUT' ||
            error.code === 'TRANSPORT_TLS_REQUIRED' ||
            error.code === 'TRANSPORT_RETRY_AFTER_TOO_LONG' ||
            error.code === 'TRANSPORT_PROVIDER_ERROR' ||
            error.code === 'TRANSPORT_RESPONSE_TOO_LARGE' ||
            error.code === 'TRANSPORT_JSON_PARSE_ERROR' ||
            error.code === 'TRANSPORT_RETRY_EXHAUSTED'
          ) {
            throw error;
          }
        }

        // Handle abort (caller signal or timeout)
        if (error instanceof DOMException && error.name === 'AbortError') {
          if (shuttingDown) {
            throw new TransportError('GATEWAY_SHUTTING_DOWN', 'Request aborted: transport engine shutting down');
          }
          if (opts.signal?.aborted) {
            throw new TransportError('TRANSPORT_ABORTED', 'Request aborted by caller');
          }
          throw new TransportError('TRANSPORT_TIMEOUT', 'Request timed out');
        }

        // Handle TimeoutError (from AbortSignal.timeout)
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          throw new TransportError('TRANSPORT_TIMEOUT', 'Request timed out');
        }

        // Network errors — retryable on non-final attempt
        if (error instanceof TypeError) {
          const attemptLat = clock.nowMs() - startTime;
          updateHealth?.(adapter.providerId, false, attemptLat, error.message);
          lastError = error;

          if (attempt < MAX_RETRIES) {
            retryCount++;
            continue;
          }
        }

        // Unknown error — don't retry
        if (lastError && !(lastError instanceof TransportError)) {
          throw new TransportError(
            'TRANSPORT_NETWORK_ERROR',
            `Network error after ${retryCount + 1} attempt(s): ${scrubErrorMessage(lastError.message)}`,
          );
        }

        throw lastError ?? error;
      } finally {
        inFlightControllers.delete(controller);
      }
    }

    // Should not reach here, but safety net
    throw lastError ?? new TransportError(
      'TRANSPORT_RETRY_EXHAUSTED',
      `All attempts exhausted for provider ${adapter.providerId}`,
    );
  }

  /**
   * Execute a streaming LLM request.
   *
   * Streaming policy:
   * - NO retry after first byte received
   * - 30s first-byte timeout (CR-3)
   * - 30s stall detection within stream (handled by adapter/parser)
   * - 10min total duration cap (CR-3)
   */
  async function executeStream(
    adapter: ProviderAdapter,
    opts: TransportExecuteOptions,
  ): Promise<TransportStreamResult> {
    // C-SEC-P5-20: Reject if shutting down
    if (shuttingDown) {
      throw new TransportError('GATEWAY_SHUTTING_DOWN', 'Transport engine is shutting down');
    }

    // C-SEC-P5-15: Circuit breaker check
    if (isCircuitOpen?.(adapter.providerId)) {
      throw new TransportError(
        'TRANSPORT_CIRCUIT_OPEN',
        `Circuit breaker open for provider ${adapter.providerId}`,
      );
    }

    const controller = new AbortController();
    inFlightControllers.add(controller);

    try {
      if (shuttingDown) {
        throw new TransportError('GATEWAY_SHUTTING_DOWN', 'Transport engine is shutting down');
      }

      const httpRequest = adapter.buildRequest(opts.request, true);

      // C-SEC-P5-19: TLS enforcement
      enforceTls(httpRequest.url);

      // First-byte timeout: 30s
      const firstByteSignal = createComposedSignal(opts.signal, STREAM_FIRST_BYTE_TIMEOUT_MS, controller);

      const streamStart = clock.nowMs();
      const response = await fetch(httpRequest.url, {
        method: httpRequest.method,
        headers: httpRequest.headers,
        body: JSON.stringify(httpRequest.body),
        signal: firstByteSignal,
      });

      if (!response.ok) {
        const attemptLat = clock.nowMs() - streamStart;
        updateHealth?.(adapter.providerId, false, attemptLat, `HTTP ${response.status}`);
        throw new TransportError(
          'TRANSPORT_PROVIDER_ERROR',
          `Provider ${adapter.providerId} returned status ${response.status} for streaming request`,
        );
      }

      if (!response.body) {
        throw new TransportError(
          'TRANSPORT_STREAM_ERROR',
          'Streaming response has no body',
        );
      }

      // Delegate to adapter for stream parsing
      // The adapter handles thinking block aggregation internally
      const streamResult = adapter.parseStream(response.body, controller.signal);

      // Wrap the stream to add total timeout and health update on completion
      const startMs = streamStart;

      async function* wrappedStream(): AsyncIterable<import('../interfaces/substrate.js').LlmStreamChunk> {
        try {
          for await (const chunk of streamResult.stream) {
            // CR-3: total duration cap
            if (clock.nowMs() - startMs > STREAM_TOTAL_TIMEOUT_MS) {
              throw new TransportError(
                'TRANSPORT_STREAM_TOTAL_TIMEOUT',
                `Streaming total duration exceeded ${STREAM_TOTAL_TIMEOUT_MS}ms (CR-3)`,
              );
            }
            yield chunk;
          }
          const totalLat = clock.nowMs() - startMs;
          updateHealth?.(adapter.providerId, true, totalLat);
        } catch (error) {
          const totalLat = clock.nowMs() - startMs;
          const msg = error instanceof Error ? error.message : String(error);
          updateHealth?.(adapter.providerId, false, totalLat, msg);
          throw error;
        } finally {
          inFlightControllers.delete(controller);
        }
      }

      return {
        stream: wrappedStream(),
        getDeliberation: () => streamResult.getDeliberation(),
        getTotalMs: () => clock.nowMs() - startMs,
      };
    } catch (error) {
      inFlightControllers.delete(controller);

      if (error instanceof TransportError) {
        throw error;
      }

      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        if (shuttingDown) {
          throw new TransportError('GATEWAY_SHUTTING_DOWN', 'Stream aborted: transport engine shutting down');
        }
        if (opts.signal?.aborted) {
          throw new TransportError('TRANSPORT_ABORTED', 'Stream aborted by caller');
        }
        throw new TransportError('TRANSPORT_FIRST_BYTE_TIMEOUT', 'Streaming first-byte timeout exceeded (30s)');
      }

      throw new TransportError(
        'TRANSPORT_NETWORK_ERROR',
        `Network error during stream setup: ${scrubErrorMessage(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  /**
   * C-SEC-P5-20: Initiate graceful shutdown.
   * All in-flight requests are aborted. New requests are rejected.
   */
  function shutdown(): void {
    shuttingDown = true;
    for (const controller of inFlightControllers) {
      controller.abort();
    }
    inFlightControllers.clear();
  }

  const engine: TransportEngine = {
    execute,
    executeStream,
    shutdown,
  };

  return Object.freeze(engine);
}

// ─── Exports ───
export { TransportError, MAX_RETRIES, DURATION_CAP_MS, MAX_RETRY_AFTER_MS, MAX_RESPONSE_BYTES };
export { STREAM_FIRST_BYTE_TIMEOUT_MS, STREAM_STALL_TIMEOUT_MS, STREAM_TOTAL_TIMEOUT_MS };
