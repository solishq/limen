/**
 * Stream parsers for SSE and NDJSON protocols.
 * S ref: §27 (Streaming Protocol), §25.4 (LLM Gateway)
 *
 * Phase: 5A (Sprint 5A — Shared Transport Infrastructure)
 * Implements:
 *   parseSSEStream() — Server-Sent Events parser
 *   parseNDJSONStream() — Newline-Delimited JSON parser
 *
 * Security constraints enforced:
 *   C-SEC-P5-10: 1MB max line length
 *   C-SEC-P5-11: 100K max events
 *   C-SEC-P5-12: 30s stall detection
 *   C-SEC-P5-13: Resource cleanup on abort
 *
 * I-01: No external dependencies. Uses Web Streams API (Node.js >= 22).
 */

import type { SSEEvent, TransportErrorCode } from './transport_types.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';

// ─── Constants ───

/** C-SEC-P5-10: Maximum line length (1MB) */
const MAX_LINE_BYTES = 1_048_576;

/** C-SEC-P5-11: Maximum number of events */
const MAX_EVENT_COUNT = 100_000;

/** C-SEC-P5-12: Stall detection timeout (30 seconds) */
const STALL_TIMEOUT_MS = 30_000;

// ─── Error Helper ───

class TransportStreamError extends Error {
  readonly code: TransportErrorCode;
  constructor(code: TransportErrorCode, message: string) {
    super(message);
    this.name = 'TransportStreamError';
    this.code = code;
  }
}

// ─── SSE Parser ───

/**
 * Parse a Server-Sent Events stream.
 * S ref: §27 (streaming protocol)
 *
 * Follows the SSE specification:
 * - Lines starting with ':' are comments (ignored)
 * - Empty lines dispatch the current event
 * - 'data:' field accumulates (multi-line data joined with \n)
 * - 'event:', 'id:', 'retry:' fields parsed
 * - [DONE] sentinel in data terminates the stream
 *
 * Security:
 * - C-SEC-P5-10: Lines > 1MB throw TRANSPORT_SSE_LINE_TOO_LONG
 * - C-SEC-P5-11: > 100K events throw TRANSPORT_SSE_MAX_EVENTS
 * - C-SEC-P5-12: 30s with no data throws TRANSPORT_STALL_DETECTED
 * - C-SEC-P5-13: Abort signal cancels cleanly with reader release
 *
 * @param body - ReadableStream from fetch response
 * @param signal - Optional AbortSignal for cancellation
 * @param time - Optional TimeProvider for clock injection (Hard Stop #7)
 */
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  time?: TimeProvider,
): AsyncIterable<SSEEvent> {
  // Each concurrent stream gets its own TextDecoder to avoid shared internal state corruption.
  const decoder = new TextDecoder();
  const clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  const reader = body.getReader();
  let eventCount = 0;
  let lastDataTime = clock.nowMs();

  // Current event being accumulated
  let currentEvent = '';
  let currentData: string[] = [];
  let currentId: string | undefined;
  let currentRetry: number | undefined;

  // Line buffer for partial reads
  let buffer = '';

  try {
    while (true) {
      // C-SEC-P5-13: Check abort signal
      if (signal?.aborted) {
        return;
      }

      // C-SEC-P5-12: Stall detection
      const elapsed = clock.nowMs() - lastDataTime;
      if (elapsed > STALL_TIMEOUT_MS) {
        throw new TransportStreamError(
          'TRANSPORT_STALL_DETECTED',
          `SSE stream stalled: no data for ${elapsed}ms (limit: ${STALL_TIMEOUT_MS}ms)`,
        );
      }

      const { done, value } = await reader.read();
      if (done) break;

      lastDataTime = clock.nowMs();
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
        buffer = buffer.slice(newlineIdx + 1);

        // C-SEC-P5-10: Max line length
        if (line.length > MAX_LINE_BYTES) {
          throw new TransportStreamError(
            'TRANSPORT_SSE_LINE_TOO_LONG',
            `SSE line exceeds maximum length: ${line.length} bytes (limit: ${MAX_LINE_BYTES})`,
          );
        }

        // Empty line dispatches the current event
        if (line === '') {
          if (currentData.length > 0) {
            // C-SEC-P5-11: Max event count
            eventCount++;
            if (eventCount > MAX_EVENT_COUNT) {
              throw new TransportStreamError(
                'TRANSPORT_SSE_MAX_EVENTS',
                `SSE event count exceeds maximum: ${eventCount} (limit: ${MAX_EVENT_COUNT})`,
              );
            }

            const data = currentData.join('\n');

            // [DONE] sentinel terminates stream
            if (data === '[DONE]') {
              return;
            }

            yield {
              event: currentEvent,
              data,
              ...(currentId !== undefined ? { id: currentId } : {}),
              ...(currentRetry !== undefined ? { retry: currentRetry } : {}),
            };
          }

          // Reset for next event
          currentEvent = '';
          currentData = [];
          currentId = undefined;
          currentRetry = undefined;
          continue;
        }

        // Comment lines (start with ':')
        if (line.startsWith(':')) {
          continue;
        }

        // Parse field:value
        const colonIdx = line.indexOf(':');
        let field: string;
        let value_str: string;

        if (colonIdx === -1) {
          field = line;
          value_str = '';
        } else {
          field = line.slice(0, colonIdx);
          // Skip leading space after colon per SSE spec
          value_str = line.slice(colonIdx + 1);
          if (value_str.startsWith(' ')) {
            value_str = value_str.slice(1);
          }
        }

        switch (field) {
          case 'data':
            currentData.push(value_str);
            break;
          case 'event':
            currentEvent = value_str;
            break;
          case 'id':
            currentId = value_str;
            break;
          case 'retry': {
            const parsed = parseInt(value_str, 10);
            if (!isNaN(parsed) && parsed >= 0) {
              currentRetry = parsed;
            }
            break;
          }
          // Unknown fields are ignored per SSE spec
        }
      }

      // C-SEC-P5-10: Check buffer length for incomplete lines
      if (buffer.length > MAX_LINE_BYTES) {
        throw new TransportStreamError(
          'TRANSPORT_SSE_LINE_TOO_LONG',
          `SSE line buffer exceeds maximum length: ${buffer.length} bytes (limit: ${MAX_LINE_BYTES})`,
        );
      }
    }

    // Process any remaining data in buffer (final event without trailing newline)
    if (currentData.length > 0) {
      eventCount++;
      if (eventCount > MAX_EVENT_COUNT) {
        throw new TransportStreamError(
          'TRANSPORT_SSE_MAX_EVENTS',
          `SSE event count exceeds maximum: ${eventCount} (limit: ${MAX_EVENT_COUNT})`,
        );
      }

      const data = currentData.join('\n');
      if (data !== '[DONE]') {
        yield {
          event: currentEvent,
          data,
          ...(currentId !== undefined ? { id: currentId } : {}),
          ...(currentRetry !== undefined ? { retry: currentRetry } : {}),
        };
      }
    }
  } finally {
    // C-SEC-P5-13: Always release the reader
    try {
      reader.releaseLock();
    } catch {
      // Reader may already be released if stream was cancelled
    }
  }
}

// ─── NDJSON Parser ───

/**
 * Parse a Newline-Delimited JSON stream.
 * S ref: §27 (streaming protocol)
 *
 * Each line is a complete JSON object. Empty lines are skipped.
 *
 * Security:
 * - C-SEC-P5-10: Lines > 1MB throw TRANSPORT_NDJSON_LINE_TOO_LONG
 * - C-SEC-P5-12: 30s with no data throws TRANSPORT_STALL_DETECTED
 * - C-SEC-P5-13: Abort signal cancels cleanly with reader release
 *
 * @param body - ReadableStream from fetch response
 * @param signal - Optional AbortSignal for cancellation
 * @param time - Optional TimeProvider for clock injection (Hard Stop #7)
 */
export async function* parseNDJSONStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  time?: TimeProvider,
): AsyncIterable<Record<string, unknown>> {
  // Each concurrent stream gets its own TextDecoder to avoid shared internal state corruption.
  const decoder = new TextDecoder();
  const clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  const reader = body.getReader();
  let lastDataTime = clock.nowMs();
  let buffer = '';

  try {
    while (true) {
      // C-SEC-P5-13: Check abort signal
      if (signal?.aborted) {
        return;
      }

      // C-SEC-P5-12: Stall detection
      const elapsed = clock.nowMs() - lastDataTime;
      if (elapsed > STALL_TIMEOUT_MS) {
        throw new TransportStreamError(
          'TRANSPORT_STALL_DETECTED',
          `NDJSON stream stalled: no data for ${elapsed}ms (limit: ${STALL_TIMEOUT_MS}ms)`,
        );
      }

      const { done, value } = await reader.read();
      if (done) break;

      lastDataTime = clock.nowMs();
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
        buffer = buffer.slice(newlineIdx + 1);

        // C-SEC-P5-10: Max line length
        if (line.length > MAX_LINE_BYTES) {
          throw new TransportStreamError(
            'TRANSPORT_NDJSON_LINE_TOO_LONG',
            `NDJSON line exceeds maximum length: ${line.length} bytes (limit: ${MAX_LINE_BYTES})`,
          );
        }

        // Skip empty lines
        if (line.trim() === '') continue;

        try {
          yield JSON.parse(line) as Record<string, unknown>;
        } catch (parseErr) {
          throw new TransportStreamError(
            'TRANSPORT_JSON_PARSE_ERROR',
            `NDJSON parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          );
        }
      }

      // C-SEC-P5-10: Check buffer length for incomplete lines
      if (buffer.length > MAX_LINE_BYTES) {
        throw new TransportStreamError(
          'TRANSPORT_NDJSON_LINE_TOO_LONG',
          `NDJSON line buffer exceeds maximum length: ${buffer.length} bytes (limit: ${MAX_LINE_BYTES})`,
        );
      }
    }

    // Process remaining data (final line without trailing newline)
    if (buffer.trim() !== '') {
      if (buffer.length > MAX_LINE_BYTES) {
        throw new TransportStreamError(
          'TRANSPORT_NDJSON_LINE_TOO_LONG',
          `NDJSON line exceeds maximum length: ${buffer.length} bytes (limit: ${MAX_LINE_BYTES})`,
        );
      }
      try {
        yield JSON.parse(buffer) as Record<string, unknown>;
      } catch (parseErr) {
        throw new TransportStreamError(
          'TRANSPORT_JSON_PARSE_ERROR',
          `NDJSON parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        );
      }
    }
  } finally {
    // C-SEC-P5-13: Always release the reader
    try {
      reader.releaseLock();
    } catch {
      // Reader may already be released if stream was cancelled
    }
  }
}

// ─── Exported for testing ───
export { TransportStreamError, MAX_LINE_BYTES, MAX_EVENT_COUNT, STALL_TIMEOUT_MS };
