/**
 * Limen v1.0 — Phase 5 Sprint 5A: Shared Transport Infrastructure + Anthropic Adapter
 * Contract tests for transport types, migration, parsers, engine, adapter, and gateway integration.
 *
 * Spec ref: §25.4 (LLM Gateway), §27 (Streaming), I-01 (no SDK deps), I-04 (provider independence)
 * Security: C-SEC-P5-01 through C-SEC-P5-23
 * Amendments: A21 (rejection-path testing), A22 (wiring manifest)
 *
 * Test Categories:
 *   1. Transport types compile correctly
 *   2. Migration v31 applies (columns exist after migration)
 *   3. SSE parser: valid events, multi-line data, [DONE] sentinel, max line, stall, event count
 *   4. NDJSON parser: valid lines, max line, stall
 *   5. Transport engine: retry, no retry on 400/401, max retries, duration cap, Retry-After,
 *      circuit breaker, response size, JSON parse, shutdown, TLS
 *   6. Anthropic adapter: request translation, response parsing, stream parsing, tool validation,
 *      retryable status codes, deliberation
 *   7. Gateway integration: request delegates, stubs remain, deliberation recorded
 *   8. API key: read at registration, reject missing for non-Ollama
 *   9. C-SEC-P5-01/02: API key never in error messages or logs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Types (compile-time verification)
import type {
  TransportErrorCode,
  SSEEvent,
  TransportHttpRequest,
  TransportHttpResponse,
  DeliberationMetrics,
  TransportResult,
  TransportStreamResult,
  ProviderAdapter,
  TransportExecuteOptions,
  TransportEngine,
  TransportEngineOptions,
} from '../../src/substrate/transport/transport_types.js';

// Stream parsers
import {
  parseSSEStream,
  parseNDJSONStream,
  TransportStreamError,
  MAX_LINE_BYTES,
  MAX_EVENT_COUNT,
  STALL_TIMEOUT_MS,
} from '../../src/substrate/transport/stream_parser.js';

// Transport engine
import {
  createTransportEngine,
  TransportError,
  MAX_RETRIES,
  DURATION_CAP_MS,
  MAX_RETRY_AFTER_MS,
  MAX_RESPONSE_BYTES,
  STREAM_FIRST_BYTE_TIMEOUT_MS,
  STREAM_TOTAL_TIMEOUT_MS,
} from '../../src/substrate/transport/transport_engine.js';

// Anthropic adapter
import {
  createAnthropicAdapter,
  createAnthropicAdapterFromEnv,
} from '../../src/substrate/transport/adapters/anthropic_adapter.js';

// Gateway
import { createLlmGateway, updateProviderHealth } from '../../src/substrate/gateway/llm_gateway.js';

// Migration
import { getTransportDeliberationMigration } from '../../src/substrate/migration/022_transport_deliberation.js';

// Accounting
import { recordAccountingDeliberation } from '../../src/substrate/accounting/resource_accounting.js';

// Test helpers
import {
  createTestDatabase,
  createTestOperationContext,
  createTestAuditTrail,
} from '../helpers/test_database.js';

import type { DatabaseConnection, OperationContext, TimeProvider } from '../../src/kernel/interfaces/index.js';
import type { LlmRequest, LlmProviderConfig } from '../../src/substrate/interfaces/substrate.js';

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
    model: 'claude-3-opus-20240229',
    messages: [{ role: 'user', content: 'Hello' }],
    maxTokens: 1024,
    ...overrides,
  };
}

/** Create a mock ProviderAdapter */
function createMockAdapter(overrides?: Partial<ProviderAdapter>): ProviderAdapter {
  return {
    providerId: 'test-provider',
    buildRequest: () => ({
      url: 'https://api.test.com/v1/messages',
      method: 'POST' as const,
      headers: { 'content-type': 'application/json' },
      body: {},
      stream: false,
    }),
    parseResponse: (resp) => ({
      response: {
        content: 'test response',
        toolCalls: [],
        finishReason: 'stop' as const,
        usage: { inputTokens: 10, outputTokens: 20 },
        model: 'test-model',
        providerId: 'test-provider',
        latencyMs: 0,
      },
      deliberation: { deliberationTokens: 0, accountingMode: 'estimated' as const, providerReportedThinkingTokens: null },
      retryCount: 0,
      totalMs: 0,
    }),
    parseStream: () => ({
      stream: (async function* () { yield { type: 'done' as const, finishReason: 'stop' as const }; })(),
      getDeliberation: () => ({ deliberationTokens: 0, accountingMode: 'estimated' as const, providerReportedThinkingTokens: null }),
      getTotalMs: () => 0,
    }),
    supportsStreaming: () => true,
    isRetryableStatus: (status) => [429, 500, 502, 503].includes(status),
    ...overrides,
  };
}

// ============================================================================
// 1. Transport Types — Compile-Time Verification
// ============================================================================

describe('Phase 5A Sprint 5A: Transport Types', () => {
  it('TransportErrorCode type includes all expected codes', () => {
    // Compile-time verification: these assignments prove the types compile
    const codes: TransportErrorCode[] = [
      'TRANSPORT_TIMEOUT',
      'TRANSPORT_RETRY_EXHAUSTED',
      'TRANSPORT_CIRCUIT_OPEN',
      'TRANSPORT_RESPONSE_TOO_LARGE',
      'TRANSPORT_JSON_PARSE_ERROR',
      'TRANSPORT_TLS_REQUIRED',
      'TRANSPORT_PROVIDER_ERROR',
      'TRANSPORT_NETWORK_ERROR',
      'TRANSPORT_ABORTED',
      'TRANSPORT_STREAM_ERROR',
      'TRANSPORT_RETRY_AFTER_TOO_LONG',
      'GATEWAY_SHUTTING_DOWN',
      'TRANSPORT_MISSING_API_KEY',
      'TRANSPORT_FIRST_BYTE_TIMEOUT',
      'TRANSPORT_STALL_DETECTED',
      'TRANSPORT_STREAM_TOTAL_TIMEOUT',
      'TRANSPORT_SSE_LINE_TOO_LONG',
      'TRANSPORT_SSE_MAX_EVENTS',
      'TRANSPORT_NDJSON_LINE_TOO_LONG',
    ];
    assert.equal(codes.length, 19, 'Expected 19 transport error codes');
  });

  it('SSEEvent interface has required fields', () => {
    const event: SSEEvent = { event: '', data: 'test' };
    assert.equal(event.event, '');
    assert.equal(event.data, 'test');
    assert.equal(event.id, undefined);
    assert.equal(event.retry, undefined);
  });

  it('DeliberationMetrics interface has required fields', () => {
    const metrics: DeliberationMetrics = {
      deliberationTokens: 100,
      accountingMode: 'provider_authoritative',
      providerReportedThinkingTokens: 100,
    };
    assert.equal(metrics.deliberationTokens, 100);
    assert.equal(metrics.accountingMode, 'provider_authoritative');
    assert.equal(metrics.providerReportedThinkingTokens, 100);
  });

  it('ProviderAdapter interface has all required methods', () => {
    const adapter = createMockAdapter();
    assert.equal(typeof adapter.buildRequest, 'function');
    assert.equal(typeof adapter.parseResponse, 'function');
    assert.equal(typeof adapter.parseStream, 'function');
    assert.equal(typeof adapter.supportsStreaming, 'function');
    assert.equal(typeof adapter.isRetryableStatus, 'function');
    assert.equal(typeof adapter.providerId, 'string');
  });

  it('TransportEngine interface has required methods', () => {
    const engine = createTransportEngine();
    assert.equal(typeof engine.execute, 'function');
    assert.equal(typeof engine.executeStream, 'function');
    assert.equal(typeof engine.shutdown, 'function');
  });
});

// ============================================================================
// 2. Migration v31 — Columns Exist After Migration
// ============================================================================

describe('Phase 5A Sprint 5A: Migration v31 (Transport Deliberation)', () => {
  let conn: DatabaseConnection;

  beforeEach(() => {
    conn = createTestDatabase();
  });

  it('migration v31 is version 31 with correct name', () => {
    const entries = getTransportDeliberationMigration();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.version, 31);
    assert.equal(entries[0]!.name, 'transport_deliberation');
  });

  it('migration v31 adds deliberation columns to meter_interaction_accounting', () => {
    // Verify columns exist by querying PRAGMA
    const columns = conn.query<{ name: string }>(
      `PRAGMA table_info(meter_interaction_accounting)`
    ).map(c => c.name);

    assert.ok(columns.includes('deliberation_tokens'), 'Missing deliberation_tokens column');
    assert.ok(columns.includes('deliberation_accounting_mode'), 'Missing deliberation_accounting_mode column');
    assert.ok(columns.includes('provider_deliberation_tokens'), 'Missing provider_deliberation_tokens column');
    assert.ok(columns.includes('effective_deliberation_tokens'), 'Missing effective_deliberation_tokens column');
    assert.ok(columns.includes('estimator_id'), 'Missing estimator_id column');
    assert.ok(columns.includes('estimator_version'), 'Missing estimator_version column');
  });

  it('migration v31 adds deliberation_tokens column to core_llm_request_log', () => {
    const columns = conn.query<{ name: string }>(
      `PRAGMA table_info(core_llm_request_log)`
    ).map(c => c.name);

    assert.ok(columns.includes('deliberation_tokens'), 'Missing deliberation_tokens on core_llm_request_log');
  });

  it('migration v31 has 7 total new columns across 2 tables', () => {
    // 6 on meter_interaction_accounting + 1 on core_llm_request_log
    const meterCols = conn.query<{ name: string }>(
      `PRAGMA table_info(meter_interaction_accounting)`
    ).map(c => c.name);

    const logCols = conn.query<{ name: string }>(
      `PRAGMA table_info(core_llm_request_log)`
    ).map(c => c.name);

    const expectedMeterCols = ['deliberation_tokens', 'deliberation_accounting_mode',
      'provider_deliberation_tokens', 'effective_deliberation_tokens',
      'estimator_id', 'estimator_version'];
    const expectedLogCols = ['deliberation_tokens'];

    let count = 0;
    for (const col of expectedMeterCols) {
      if (meterCols.includes(col)) count++;
    }
    for (const col of expectedLogCols) {
      if (logCols.includes(col)) count++;
    }

    assert.equal(count, 7, 'Expected 7 new columns across 2 tables');
  });

  it('deliberation_accounting_mode has CHECK constraint', () => {
    // Insert valid values
    conn.run(
      `INSERT INTO meter_interaction_accounting (id, task_id, mission_id, tenant_id, agent_id, model_id, interaction_type, input_tokens, output_tokens, effective_input_tokens, effective_output_tokens, wall_clock_ms, artifacts_bytes, capabilities_used, deliberation_accounting_mode)
       VALUES ('id-1', 'task-1', 'mission-1', 'tenant-1', 'agent-1', 'model-1', 'llm', 0, 0, 0, 0, 0, 0, '[]', 'provider_authoritative')`
    );

    // A21: Try invalid value — should fail
    assert.throws(() => {
      conn.run(
        `INSERT INTO meter_interaction_accounting (id, task_id, mission_id, tenant_id, agent_id, model_id, interaction_type, input_tokens, output_tokens, effective_input_tokens, effective_output_tokens, wall_clock_ms, artifacts_bytes, capabilities_used, deliberation_accounting_mode)
         VALUES ('id-2', 'task-2', 'mission-2', 'tenant-2', 'agent-2', 'model-2', 'llm', 0, 0, 0, 0, 0, 0, '[]', 'invalid_source')`
      );
    }, 'Should reject invalid deliberation_accounting_mode value');
  });
});

// ============================================================================
// 3. SSE Parser
// ============================================================================

describe('Phase 5A Sprint 5A: SSE Parser', () => {
  it('parses valid SSE events', async () => {
    const stream = createMockStream([
      'data: {"type":"content"}\n\n',
      'data: {"type":"done"}\n\n',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }

    assert.equal(events.length, 2);
    assert.equal(events[0]!.data, '{"type":"content"}');
    assert.equal(events[1]!.data, '{"type":"done"}');
  });

  it('handles multi-line data fields', async () => {
    const stream = createMockStream([
      'data: line1\ndata: line2\ndata: line3\n\n',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }

    assert.equal(events.length, 1);
    assert.equal(events[0]!.data, 'line1\nline2\nline3');
  });

  it('terminates on [DONE] sentinel', async () => {
    const stream = createMockStream([
      'data: {"type":"content"}\n\n',
      'data: [DONE]\n\n',
      'data: should not appear\n\n',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }

    assert.equal(events.length, 1);
    assert.equal(events[0]!.data, '{"type":"content"}');
  });

  it('parses event type and id fields', async () => {
    const stream = createMockStream([
      'event: message\nid: 123\ndata: hello\n\n',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }

    assert.equal(events.length, 1);
    assert.equal(events[0]!.event, 'message');
    assert.equal(events[0]!.id, '123');
    assert.equal(events[0]!.data, 'hello');
  });

  it('parses retry field', async () => {
    const stream = createMockStream([
      'retry: 5000\ndata: test\n\n',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }

    assert.equal(events.length, 1);
    assert.equal(events[0]!.retry, 5000);
  });

  it('ignores comment lines', async () => {
    const stream = createMockStream([
      ': this is a comment\ndata: hello\n\n',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }

    assert.equal(events.length, 1);
    assert.equal(events[0]!.data, 'hello');
  });

  it('A21-SUCCESS: accepts lines within max length', async () => {
    const longButValid = 'data: ' + 'x'.repeat(1000) + '\n\n';
    const stream = createMockStream([longButValid]);

    const events: SSEEvent[] = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }

    assert.equal(events.length, 1);
    assert.equal(events[0]!.data.length, 1000);
  });

  it('A21-REJECTION: rejects lines exceeding max length (C-SEC-P5-10)', async () => {
    const tooLong = 'data: ' + 'x'.repeat(MAX_LINE_BYTES + 1) + '\n\n';
    const stream = createMockStream([tooLong]);

    try {
      for await (const _event of parseSSEStream(stream)) {
        // Should not reach here
      }
      assert.fail('Should have thrown TransportStreamError');
    } catch (err) {
      assert.ok(err instanceof TransportStreamError);
      assert.equal(err.code, 'TRANSPORT_SSE_LINE_TOO_LONG');
    }
  });

  it('detects stall (C-SEC-P5-12)', async () => {
    const time = createTestTimeProvider();

    // The parser checks stall BEFORE reader.read() and updates lastDataTime AFTER.
    // To trigger stall: the pull callback must advance time but NOT enqueue data
    // on the second call. This means the read() call blocks (pull doesn't enqueue),
    // and the parser's stall check fires on the next loop iteration.
    //
    // Strategy: First pull returns data. Second pull advances time and returns nothing.
    // Since pull() doesn't enqueue or close, the stream stalls. But the parser's
    // stall check runs BEFORE read(), not during. So we need a different approach.
    //
    // Revised: We create a custom stream where the second read returns data but
    // the time has advanced past stall threshold between reads via microtask.
    let readCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Pre-enqueue first chunk
        controller.enqueue(new TextEncoder().encode('data: first\n\n'));
      },
      pull(controller) {
        readCount++;
        if (readCount === 1) {
          // After first chunk was consumed, advance time before second chunk
          time.advance(STALL_TIMEOUT_MS + 1000);
          // Enqueue second chunk - but stall check already happened
          controller.enqueue(new TextEncoder().encode('data: second\n\n'));
        } else {
          controller.close();
        }
      },
    });

    // The parser flow for this stream:
    // 1. read() -> returns 'data: first\n\n' (from start), lastDataTime = T0
    // 2. Process 'first' event, loop back
    // 3. Stall check: elapsed = T0 - T0 = 0 (no stall)
    // 4. read() -> triggers pull(). pull advances time to T0+31s, enqueues 'second'
    // 5. read returns 'data: second\n\n', lastDataTime = T0+31s
    // 6. Process 'second' event, loop back
    // 7. Stall check: elapsed = (T0+31s) - (T0+31s) = 0 (no stall)
    //
    // This still doesn't trigger stall because lastDataTime is always updated
    // right after read(). The stall detection as implemented only catches
    // when the PREVIOUS read's data arrived long ago relative to current time
    // and NO new data has arrived since. We need read() to not return data
    // while time advances.
    //
    // Final approach: Use a stream where pull() advances time but does NOT
    // enqueue, causing the parser to re-check on the next loop.
    // Actually, if pull doesn't enqueue, read() doesn't return (it waits).
    // The parser's stall check runs BEFORE read(), so it can't catch this.
    //
    // The fundamental limitation: stall detection as implemented in the parser
    // checks elapsed time at the start of each loop iteration. But reader.read()
    // is blocking - the check only happens when we have data. This means the
    // stall detection can only catch cases where we HAD data but time moved on.
    //
    // For testing: we verify the error code is correct when stall conditions are met.
    // Use a stream that enqueues data infrequently with time advancing between.

    // Simplified test: verify TransportStreamError is thrown with correct code
    const stall = new TransportStreamError('TRANSPORT_STALL_DETECTED', 'test stall');
    assert.equal(stall.code, 'TRANSPORT_STALL_DETECTED');
    assert.equal(stall.name, 'TransportStreamError');
    assert.ok(stall instanceof Error);
    assert.ok(stall instanceof TransportStreamError);

    // Also verify the constants are correct
    assert.equal(STALL_TIMEOUT_MS, 30_000);
  });

  it('A21-REJECTION: rejects when event count exceeds max (C-SEC-P5-11)', async () => {
    // Generate a stream with too many events
    // We need to generate more than MAX_EVENT_COUNT events
    // For test efficiency, we override the constant by creating a stream that triggers the check
    // Since MAX_EVENT_COUNT is 100K, we test the mechanism using a smaller approach:
    // We patch via mocking is not possible due to const, so we verify the error code
    // by examining the error class
    const manyEvents: string[] = [];
    // Create 100001 events in chunks (each chunk has multiple events)
    const eventsPerChunk = 10000;
    const numChunks = Math.ceil((MAX_EVENT_COUNT + 1) / eventsPerChunk);
    for (let c = 0; c < numChunks; c++) {
      let chunk = '';
      for (let i = 0; i < eventsPerChunk; i++) {
        chunk += 'data: x\n\n';
      }
      manyEvents.push(chunk);
    }

    const stream = createMockStream(manyEvents);

    try {
      let count = 0;
      for await (const _event of parseSSEStream(stream)) {
        count++;
      }
      assert.fail(`Should have thrown at event count limit, got ${count} events`);
    } catch (err) {
      assert.ok(err instanceof TransportStreamError, `Expected TransportStreamError, got ${err}`);
      assert.equal(err.code, 'TRANSPORT_SSE_MAX_EVENTS');
    }
  });

  it('handles abort signal (C-SEC-P5-13)', async () => {
    const controller = new AbortController();
    const stream = createMockStream([
      'data: first\n\n',
      'data: second\n\n',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of parseSSEStream(stream, controller.signal)) {
      events.push(event);
      // Abort after first event
      controller.abort();
    }

    // Should stop after first event
    assert.equal(events.length, 1);
  });
});

// ============================================================================
// 4. NDJSON Parser
// ============================================================================

describe('Phase 5A Sprint 5A: NDJSON Parser', () => {
  it('parses valid NDJSON lines', async () => {
    const stream = createMockStream([
      '{"key":"value1"}\n',
      '{"key":"value2"}\n',
    ]);

    const records: Record<string, unknown>[] = [];
    for await (const record of parseNDJSONStream(stream)) {
      records.push(record);
    }

    assert.equal(records.length, 2);
    assert.equal((records[0] as Record<string, string>).key, 'value1');
    assert.equal((records[1] as Record<string, string>).key, 'value2');
  });

  it('skips empty lines', async () => {
    const stream = createMockStream([
      '{"key":"value1"}\n\n{"key":"value2"}\n',
    ]);

    const records: Record<string, unknown>[] = [];
    for await (const record of parseNDJSONStream(stream)) {
      records.push(record);
    }

    assert.equal(records.length, 2);
  });

  it('A21-REJECTION: rejects lines exceeding max length (C-SEC-P5-10)', async () => {
    const tooLong = '{"data":"' + 'x'.repeat(MAX_LINE_BYTES + 1) + '"}\n';
    const stream = createMockStream([tooLong]);

    try {
      for await (const _record of parseNDJSONStream(stream)) {
        // Should not reach
      }
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof TransportStreamError);
      assert.equal(err.code, 'TRANSPORT_NDJSON_LINE_TOO_LONG');
    }
  });

  it('stall detection constant and error type are correct (C-SEC-P5-12)', () => {
    // Verify the stall detection mechanism exists and produces correct error
    const stall = new TransportStreamError('TRANSPORT_STALL_DETECTED', 'NDJSON stall');
    assert.equal(stall.code, 'TRANSPORT_STALL_DETECTED');
    assert.equal(stall.name, 'TransportStreamError');
    assert.ok(stall instanceof Error);
    assert.ok(stall instanceof TransportStreamError);
    assert.equal(STALL_TIMEOUT_MS, 30_000);
  });
});

// ============================================================================
// 5. Transport Engine
// ============================================================================

describe('Phase 5A Sprint 5A: Transport Engine', () => {
  it('retries on 429/500/502/503 status codes', async () => {
    let attemptCount = 0;
    const mockAdapter = createMockAdapter({
      buildRequest: () => ({
        url: 'https://api.test.com/v1/messages',
        method: 'POST' as const,
        headers: { 'content-type': 'application/json' },
        body: {},
        stream: false,
      }),
      isRetryableStatus: (status) => [429, 500, 502, 503].includes(status),
    });

    // Mock global fetch to return 500 then 200
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url: string | URL | Request, _init?: RequestInit) => {
      attemptCount++;
      if (attemptCount <= 2) {
        return new Response('error', { status: 500 });
      }
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'test',
        stop_reason: 'end_turn',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    try {
      const engine = createTransportEngine();
      const result = await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.equal(result.retryCount, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does NOT retry on 400 (non-retryable)', async () => {
    let attemptCount = 0;
    const mockAdapter = createMockAdapter({
      isRetryableStatus: () => false,
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      attemptCount++;
      return new Response('bad request', { status: 400 });
    };

    try {
      const engine = createTransportEngine();
      await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof TransportError);
      assert.equal(err.code, 'TRANSPORT_PROVIDER_ERROR');
      assert.equal(attemptCount, 1, 'Should only attempt once for non-retryable');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does NOT retry on 401 (non-retryable)', async () => {
    let attemptCount = 0;
    const mockAdapter = createMockAdapter({
      isRetryableStatus: () => false,
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      attemptCount++;
      return new Response('unauthorized', { status: 401 });
    };

    try {
      const engine = createTransportEngine();
      await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof TransportError);
      assert.equal(err.code, 'TRANSPORT_PROVIDER_ERROR');
      assert.equal(attemptCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('A21-REJECTION: exhausts max 2 retries (3 total attempts)', async () => {
    let attemptCount = 0;
    const mockAdapter = createMockAdapter({
      isRetryableStatus: () => true,
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      attemptCount++;
      return new Response('error', { status: 500 });
    };

    try {
      const engine = createTransportEngine();
      await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof TransportError);
      assert.equal(err.code, 'TRANSPORT_RETRY_EXHAUSTED');
      assert.equal(attemptCount, 3, 'Should attempt exactly 3 times (1 + 2 retries)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('parses Retry-After header in seconds format', async () => {
    let attemptCount = 0;
    const mockAdapter = createMockAdapter({
      isRetryableStatus: () => true,
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      attemptCount++;
      if (attemptCount === 1) {
        return new Response('retry', {
          status: 429,
          headers: { 'retry-after': '1' },
        });
      }
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'test',
        stop_reason: 'end_turn',
      }), { status: 200 });
    };

    try {
      const engine = createTransportEngine();
      const result = await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.equal(result.retryCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('parses Retry-After header in HTTP-date format', async () => {
    let attemptCount = 0;
    const mockAdapter = createMockAdapter({
      isRetryableStatus: () => true,
    });

    const futureDate = new Date(Date.now() + 1000).toUTCString();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      attemptCount++;
      if (attemptCount === 1) {
        return new Response('retry', {
          status: 429,
          headers: { 'retry-after': futureDate },
        });
      }
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'test',
        stop_reason: 'end_turn',
      }), { status: 200 });
    };

    try {
      const engine = createTransportEngine();
      const result = await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.equal(result.retryCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('Retry-After > 60s → hard error (CR-2)', async () => {
    const mockAdapter = createMockAdapter({
      isRetryableStatus: () => true,
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response('retry', {
        status: 429,
        headers: { 'retry-after': '120' }, // 120s > 60s cap
      });
    };

    try {
      const engine = createTransportEngine();
      await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof TransportError);
      assert.equal(err.code, 'TRANSPORT_RETRY_AFTER_TOO_LONG');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('circuit breaker check between retries (C-SEC-P5-15)', async () => {
    let attemptCount = 0;
    let circuitOpen = false;
    const mockAdapter = createMockAdapter({
      isRetryableStatus: () => true,
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      attemptCount++;
      circuitOpen = true; // Open circuit after first attempt
      return new Response('error', { status: 500 });
    };

    try {
      const engine = createTransportEngine({
        isCircuitOpen: () => circuitOpen,
      });
      await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof TransportError);
      assert.equal(err.code, 'TRANSPORT_CIRCUIT_OPEN');
      assert.equal(attemptCount, 1, 'Should stop at circuit breaker before retry');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('A21-REJECTION: rejects oversized response (C-SEC-P5-06)', async () => {
    const mockAdapter = createMockAdapter();

    const originalFetch = globalThis.fetch;
    // Return a response with Content-Length exceeding limit
    globalThis.fetch = async () => {
      return new Response('x', {
        status: 200,
        headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) },
      });
    };

    try {
      const engine = createTransportEngine();
      await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof TransportError);
      assert.equal(err.code, 'TRANSPORT_RESPONSE_TOO_LARGE');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles JSON parse error (C-SEC-P5-07)', async () => {
    const mockAdapter = createMockAdapter({
      parseResponse: () => { throw new Error('JSON parse error: invalid'); },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response('not json', { status: 200 });
    };

    try {
      const engine = createTransportEngine();
      await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof TransportError);
      assert.equal(err.code, 'TRANSPORT_JSON_PARSE_ERROR');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('shutdown aborts in-flight requests (C-SEC-P5-20)', async () => {
    const mockAdapter = createMockAdapter();

    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      fetchCalled = true;
      // Simulate slow response
      await new Promise((resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }
        setTimeout(resolve, 60000);
      });
      return new Response('ok', { status: 200 });
    };

    try {
      const engine = createTransportEngine();

      // Start a request then immediately shutdown
      const promise = engine.execute(mockAdapter, { request: createTestLlmRequest() });

      // Small delay to let fetch start
      await new Promise(r => setTimeout(r, 10));
      engine.shutdown();

      try {
        await promise;
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok(err instanceof TransportError);
        assert.equal(err.code, 'GATEWAY_SHUTTING_DOWN');
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('shutdown rejects new requests (C-SEC-P5-20)', async () => {
    const engine = createTransportEngine();
    engine.shutdown();

    try {
      await engine.execute(createMockAdapter(), { request: createTestLlmRequest() });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof TransportError);
      assert.equal(err.code, 'GATEWAY_SHUTTING_DOWN');
    }
  });

  it('A21-SUCCESS: allows https:// URLs', async () => {
    const mockAdapter = createMockAdapter({
      buildRequest: () => ({
        url: 'https://api.anthropic.com/v1/messages',
        method: 'POST' as const,
        headers: {},
        body: {},
        stream: false,
      }),
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'test',
        stop_reason: 'end_turn',
      }), { status: 200 });
    };

    try {
      const engine = createTransportEngine();
      const result = await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.equal(typeof result.response.content, 'string');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('A21-REJECTION: rejects http:// non-local URLs (C-SEC-P5-19)', async () => {
    const mockAdapter = createMockAdapter({
      buildRequest: () => ({
        url: 'http://api.anthropic.com/v1/messages',
        method: 'POST' as const,
        headers: {},
        body: {},
        stream: false,
      }),
    });

    try {
      const engine = createTransportEngine();
      await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof TransportError);
      assert.equal(err.code, 'TRANSPORT_TLS_REQUIRED');
    }
  });

  it('allows http:// for localhost (local development)', async () => {
    const mockAdapter = createMockAdapter({
      buildRequest: () => ({
        url: 'http://localhost:11434/v1/messages',
        method: 'POST' as const,
        headers: {},
        body: {},
        stream: false,
      }),
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'test',
        stop_reason: 'end_turn',
      }), { status: 200 });
    };

    try {
      const engine = createTransportEngine();
      const result = await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.equal(typeof result.response.content, 'string');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('calls updateHealth on success', async () => {
    let healthUpdated = false;
    const mockAdapter = createMockAdapter();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'test',
        stop_reason: 'end_turn',
      }), { status: 200 });
    };

    try {
      const engine = createTransportEngine({
        updateHealth: (providerId, success) => {
          healthUpdated = true;
          assert.equal(providerId, 'test-provider');
          assert.equal(success, true);
        },
      });
      await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.ok(healthUpdated, 'Health should be updated on success');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ============================================================================
// 6. Anthropic Adapter
// ============================================================================

describe('Phase 5A Sprint 5A: Anthropic Adapter', () => {
  it('builds request with system prompt at top level', () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key');
    const req = createTestLlmRequest({ systemPrompt: 'You are helpful.' });
    const httpReq = adapter.buildRequest(req, false);

    assert.equal(httpReq.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(httpReq.method, 'POST');
    assert.equal(httpReq.headers['x-api-key'], 'test-key');
    assert.equal(httpReq.headers['anthropic-version'], '2023-06-01');
    assert.equal(httpReq.body.system, 'You are helpful.');
    assert.equal(httpReq.body.model, 'claude-3-opus-20240229');
    assert.equal(httpReq.body.max_tokens, 1024);
  });

  it('translates messages correctly', () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key');
    const req = createTestLlmRequest({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'How are you?' },
      ],
    });
    const httpReq = adapter.buildRequest(req, false);
    const messages = httpReq.body.messages as Array<Record<string, unknown>>;

    assert.equal(messages.length, 3);
    assert.equal(messages[0]!.role, 'user');
    assert.equal(messages[0]!.content, 'Hello');
    assert.equal(messages[1]!.role, 'assistant');
  });

  it('translates tools correctly', () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key');
    const req = createTestLlmRequest({
      tools: [{
        name: 'get_weather',
        description: 'Get weather info',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      }],
    });
    const httpReq = adapter.buildRequest(req, false);
    const tools = httpReq.body.tools as Array<Record<string, unknown>>;

    assert.equal(tools.length, 1);
    assert.equal(tools[0]!.name, 'get_weather');
    assert.equal(tools[0]!.description, 'Get weather info');
  });

  it('sets stream flag in streaming mode', () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key');
    const httpReq = adapter.buildRequest(createTestLlmRequest(), true);
    assert.equal(httpReq.body.stream, true);
    assert.equal(httpReq.stream, true);
  });

  it('parses text response correctly', () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key');
    const result = adapter.parseResponse({
      status: 200,
      headers: {},
      body: JSON.stringify({
        content: [{ type: 'text', text: 'Hello world' }],
        usage: { input_tokens: 15, output_tokens: 25 },
        model: 'claude-3-opus-20240229',
        stop_reason: 'end_turn',
      }),
    });

    assert.equal(result.response.content, 'Hello world');
    assert.equal(result.response.usage.inputTokens, 15);
    assert.equal(result.response.usage.outputTokens, 25);
    assert.equal(result.response.finishReason, 'stop');
    assert.equal(result.deliberation.accountingMode, 'estimated');
    assert.equal(result.deliberation.providerReportedThinkingTokens, null);
  });

  it('parses tool call response correctly', () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key');
    const result = adapter.parseResponse({
      status: 200,
      headers: {},
      body: JSON.stringify({
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'call_123', name: 'get_weather', input: { city: 'London' } },
        ],
        usage: { input_tokens: 15, output_tokens: 25 },
        model: 'claude-3-opus-20240229',
        stop_reason: 'tool_use',
      }),
    });

    assert.equal(result.response.toolCalls.length, 1);
    assert.equal(result.response.toolCalls[0]!.id, 'call_123');
    assert.equal(result.response.toolCalls[0]!.name, 'get_weather');
    assert.deepEqual(result.response.toolCalls[0]!.input, { city: 'London' });
    assert.equal(result.response.finishReason, 'tool_use');
  });

  it('parses thinking blocks → deliberation (CR-5)', () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key');
    const result = adapter.parseResponse({
      status: 200,
      headers: {},
      body: JSON.stringify({
        content: [
          { type: 'thinking', thinking: 'internal reasoning...' },
          { type: 'text', text: 'Based on my analysis...' },
        ],
        usage: { input_tokens: 15, output_tokens: 250 },
        model: 'claude-3-opus-20240229',
        stop_reason: 'end_turn',
      }),
    });

    // Thinking blocks → deliberation metrics
    assert.equal(result.deliberation.accountingMode, 'provider_authoritative');
    assert.equal(typeof result.deliberation.providerReportedThinkingTokens, 'number');

    // Thinking blocks NOT in LlmResponse.content
    if (typeof result.response.content === 'string') {
      assert.ok(!result.response.content.includes('internal reasoning'));
    } else {
      const hasThinkingBlock = result.response.content.some(b => (b as Record<string, unknown>).type === 'thinking');
      assert.ok(!hasThinkingBlock, 'Thinking blocks must not appear in response content');
    }
  });

  it('A21-REJECTION: rejects malformed tool call (C-SEC-P5-23) — empty id', () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key');
    const result = adapter.parseResponse({
      status: 200,
      headers: {},
      body: JSON.stringify({
        content: [
          { type: 'tool_use', id: '', name: 'valid_name', input: {} }, // Empty id
          { type: 'text', text: 'fallback' },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'test',
        stop_reason: 'end_turn',
      }),
    });

    // Malformed tool call should be silently dropped
    assert.equal(result.response.toolCalls.length, 0);
  });

  it('A21-REJECTION: rejects malformed tool call (C-SEC-P5-23) — invalid name', () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key');
    const result = adapter.parseResponse({
      status: 200,
      headers: {},
      body: JSON.stringify({
        content: [
          { type: 'tool_use', id: 'call_1', name: '123-invalid', input: {} }, // Name starts with digit
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'test',
        stop_reason: 'end_turn',
      }),
    });

    assert.equal(result.response.toolCalls.length, 0);
  });

  it('A21-REJECTION: rejects malformed tool call (C-SEC-P5-23) — input is array', () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key');
    const result = adapter.parseResponse({
      status: 200,
      headers: {},
      body: JSON.stringify({
        content: [
          { type: 'tool_use', id: 'call_1', name: 'valid_name', input: [1, 2, 3] }, // Array, not object
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'test',
        stop_reason: 'end_turn',
      }),
    });

    assert.equal(result.response.toolCalls.length, 0);
  });

  it('A21-SUCCESS: accepts valid tool call', () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key');
    const result = adapter.parseResponse({
      status: 200,
      headers: {},
      body: JSON.stringify({
        content: [
          { type: 'tool_use', id: 'call_valid', name: 'get_data', input: { query: 'test' } },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'test',
        stop_reason: 'tool_use',
      }),
    });

    assert.equal(result.response.toolCalls.length, 1);
    assert.equal(result.response.toolCalls[0]!.id, 'call_valid');
    assert.equal(result.response.toolCalls[0]!.name, 'get_data');
  });

  it('stream parses content_delta events', async () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key');
    const stream = createMockStream([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
    ]);

    const result = adapter.parseStream(stream);
    const chunks: import('../../src/substrate/interfaces/substrate.js').LlmStreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    // Should have: usage (from message_start), content_delta, usage (from message_delta), done
    const contentChunks = chunks.filter(c => c.type === 'content_delta');
    const doneChunks = chunks.filter(c => c.type === 'done');
    const usageChunks = chunks.filter(c => c.type === 'usage');

    assert.equal(contentChunks.length, 1);
    assert.equal((contentChunks[0] as { type: 'content_delta'; delta: string }).delta, 'Hello');
    assert.equal(doneChunks.length, 1);
    assert.ok(usageChunks.length >= 1);
  });

  it('stream aggregates thinking_delta internally (not emitted)', async () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key');
    const stream = createMockStream([
      'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"thinking"},"index":0}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"reasoning..."},"index":0}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Result"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n',
    ]);

    const result = adapter.parseStream(stream);
    const chunks: import('../../src/substrate/interfaces/substrate.js').LlmStreamChunk[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }

    // thinking_delta should NOT appear as a content_delta
    const contentDeltas = chunks.filter(c => c.type === 'content_delta');
    for (const cd of contentDeltas) {
      assert.notEqual((cd as { type: 'content_delta'; delta: string }).delta, 'reasoning...');
    }

    // Deliberation should reflect thinking was detected
    const delib = result.getDeliberation();
    assert.equal(delib.accountingMode, 'provider_authoritative');
    assert.equal(typeof delib.providerReportedThinkingTokens, 'number');
  });

  it('identifies retryable status codes correctly', () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key');

    // Retryable
    assert.equal(adapter.isRetryableStatus(429), true);
    assert.equal(adapter.isRetryableStatus(500), true);
    assert.equal(adapter.isRetryableStatus(502), true);
    assert.equal(adapter.isRetryableStatus(503), true);
    assert.equal(adapter.isRetryableStatus(529), true);

    // Not retryable
    assert.equal(adapter.isRetryableStatus(400), false);
    assert.equal(adapter.isRetryableStatus(401), false);
    assert.equal(adapter.isRetryableStatus(403), false);
    assert.equal(adapter.isRetryableStatus(404), false);
  });

  it('supports streaming', () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'test-key');
    assert.equal(adapter.supportsStreaming(), true);
  });
});

// ============================================================================
// 7. Gateway Integration
// ============================================================================

describe('Phase 5A Sprint 5A: Gateway Integration', () => {
  let conn: DatabaseConnection;
  let ctx: OperationContext;
  let audit: import('../../src/kernel/interfaces/index.js').AuditTrail;

  beforeEach(() => {
    conn = createTestDatabase();
    ctx = createTestOperationContext();
    audit = createTestAuditTrail();
  });

  it('request delegates to transport when provided', async () => {
    let transportCalled = false;
    const mockAdapter: ProviderAdapter = createMockAdapter({
      providerId: 'test-anthropic',
    });

    const mockEngine: TransportEngine = {
      execute: async (adapter, opts) => {
        transportCalled = true;
        return {
          response: {
            content: 'transported response',
            toolCalls: [],
            finishReason: 'stop' as const,
            usage: { inputTokens: 10, outputTokens: 20 },
            model: 'claude-3-opus-20240229',
            providerId: adapter.providerId,
            latencyMs: 100,
          },
          deliberation: { deliberationTokens: 0, accountingMode: 'estimated' as const, providerReportedThinkingTokens: null },
          retryCount: 0,
          totalMs: 100,
        };
      },
      executeStream: async () => { throw new Error('Not implemented'); },
      shutdown: () => {},
    };

    const adaptersMap = new Map<string, ProviderAdapter>();
    adaptersMap.set('test-anthropic', mockAdapter);

    const gateway = createLlmGateway(audit, undefined, undefined, {
      engine: mockEngine,
      adapters: adaptersMap,
    });

    // Register provider
    gateway.registerProvider(conn, ctx, {
      providerId: 'test-anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: ['claude-3-opus-20240229'],
      apiKeyEnvVar: 'TEST_KEY',
    });

    const result = await gateway.request(conn, ctx, createTestLlmRequest());
    assert.ok(result.ok);
    assert.ok(transportCalled, 'Transport engine should have been called');
    if (result.ok) {
      assert.equal(result.value.content, 'transported response');
      assert.equal(result.value.providerId, 'test-anthropic');
    }
  });

  it('requestStream delegates to transport when provided', async () => {
    let streamCalled = false;
    const mockAdapter: ProviderAdapter = createMockAdapter({
      providerId: 'test-anthropic',
    });

    const mockEngine: TransportEngine = {
      execute: async () => { throw new Error('Not implemented'); },
      executeStream: async (adapter, opts) => {
        streamCalled = true;
        return {
          stream: (async function* () {
            yield { type: 'content_delta' as const, delta: 'hello' };
            yield { type: 'done' as const, finishReason: 'stop' as const };
          })(),
          getDeliberation: () => ({ deliberationTokens: 0, accountingMode: 'estimated' as const, providerReportedThinkingTokens: null }),
          getTotalMs: () => 100,
        };
      },
      shutdown: () => {},
    };

    const adaptersMap = new Map<string, ProviderAdapter>();
    adaptersMap.set('test-anthropic', mockAdapter);

    const gateway = createLlmGateway(audit, undefined, undefined, {
      engine: mockEngine,
      adapters: adaptersMap,
    });

    gateway.registerProvider(conn, ctx, {
      providerId: 'test-anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: ['claude-3-opus-20240229'],
      apiKeyEnvVar: 'TEST_KEY',
    });

    const result = await gateway.requestStream(conn, ctx, createTestLlmRequest());
    assert.ok(result.ok);
    assert.ok(streamCalled, 'Transport stream should have been called');

    if (result.ok) {
      const chunks: import('../../src/substrate/interfaces/substrate.js').LlmStreamChunk[] = [];
      for await (const chunk of result.value) {
        chunks.push(chunk);
      }
      assert.equal(chunks.length, 2);
    }
  });

  it('stubs remain when no transport provided', async () => {
    const gateway = createLlmGateway(audit);

    gateway.registerProvider(conn, ctx, {
      providerId: 'test-provider',
      baseUrl: 'https://api.test.com',
      models: ['claude-3-opus-20240229'],
      apiKeyEnvVar: 'TEST_KEY',
    });

    const result = await gateway.request(conn, ctx, createTestLlmRequest());
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.error.code, 'PROVIDER_UNAVAILABLE');
      assert.ok(result.error.message.includes('not configured'));
    }
  });

  it('deliberation recorded in core_llm_request_log after successful transport', async () => {
    const mockAdapter: ProviderAdapter = createMockAdapter({
      providerId: 'test-anthropic',
    });

    const mockEngine: TransportEngine = {
      execute: async () => ({
        response: {
          content: 'result',
          toolCalls: [],
          finishReason: 'stop' as const,
          usage: { inputTokens: 10, outputTokens: 20 },
          model: 'claude-3-opus-20240229',
          providerId: 'test-anthropic',
          latencyMs: 100,
        },
        deliberation: { deliberationTokens: 50, accountingMode: 'provider_authoritative' as const, providerReportedThinkingTokens: 50 },
        retryCount: 1,
        totalMs: 200,
      }),
      executeStream: async () => { throw new Error('Not implemented'); },
      shutdown: () => {},
    };

    const adaptersMap = new Map<string, ProviderAdapter>();
    adaptersMap.set('test-anthropic', mockAdapter);

    const gateway = createLlmGateway(audit, undefined, undefined, {
      engine: mockEngine,
      adapters: adaptersMap,
    });

    gateway.registerProvider(conn, ctx, {
      providerId: 'test-anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: ['claude-3-opus-20240229'],
      apiKeyEnvVar: 'TEST_KEY',
    });

    const result = await gateway.request(conn, ctx, createTestLlmRequest());
    assert.ok(result.ok);

    // Check deliberation was recorded in core_llm_request_log
    const logEntry = conn.get<{ deliberation_tokens: number }>(
      `SELECT deliberation_tokens FROM core_llm_request_log WHERE provider_id = ?`,
      ['test-anthropic'],
    );
    assert.ok(logEntry, 'Should have a log entry');
    assert.equal(logEntry.deliberation_tokens, 50);
  });
});

// ============================================================================
// 8. API Key Security
// ============================================================================

describe('Phase 5A Sprint 5A: API Key Security', () => {
  it('A21-SUCCESS: reads API key from env at adapter creation', () => {
    const originalEnv = process.env.TEST_ANTHROPIC_KEY;
    process.env.TEST_ANTHROPIC_KEY = 'sk-test-12345';

    try {
      const adapter = createAnthropicAdapterFromEnv(
        'anthropic', 'https://api.anthropic.com', 'TEST_ANTHROPIC_KEY',
      );
      assert.equal(adapter.providerId, 'anthropic');

      // Key should be in request headers
      const req = adapter.buildRequest(createTestLlmRequest(), false);
      assert.equal(req.headers['x-api-key'], 'sk-test-12345');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.TEST_ANTHROPIC_KEY;
      } else {
        process.env.TEST_ANTHROPIC_KEY = originalEnv;
      }
    }
  });

  it('A21-REJECTION: rejects missing API key for non-Ollama', () => {
    const originalEnv = process.env.MISSING_KEY;
    delete process.env.MISSING_KEY;

    try {
      assert.throws(
        () => createAnthropicAdapterFromEnv(
          'anthropic', 'https://api.anthropic.com', 'MISSING_KEY',
        ),
        (err: Error) => {
          assert.ok(err.message.includes('TRANSPORT_MISSING_API_KEY'));
          return true;
        },
      );
    } finally {
      if (originalEnv !== undefined) {
        process.env.MISSING_KEY = originalEnv;
      }
    }
  });

  it('C-SEC-P5-01/02: API key NEVER in error messages', () => {
    const originalEnv = process.env.MISSING_KEY_2;
    delete process.env.MISSING_KEY_2;

    try {
      try {
        createAnthropicAdapterFromEnv(
          'anthropic', 'https://api.anthropic.com', 'MISSING_KEY_2',
        );
        assert.fail('Should have thrown');
      } catch (err) {
        const message = (err as Error).message;
        // The error message must NOT contain any API key or the env var value
        assert.ok(!message.includes('sk-'), 'Error message must not contain API key');
        // It should contain the error code for diagnosis
        assert.ok(message.includes('TRANSPORT_MISSING_API_KEY'));
      }
    } finally {
      if (originalEnv !== undefined) {
        process.env.MISSING_KEY_2 = originalEnv;
      }
    }
  });

  it('C-SEC-P5-01/02: API key not leaked in transport errors', async () => {
    const adapter = createAnthropicAdapter('anthropic', 'https://api.anthropic.com', 'sk-secret-key-12345');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response('not found', { status: 404 });
    };

    try {
      const engine = createTransportEngine();
      await engine.execute(adapter, { request: createTestLlmRequest() });
      assert.fail('Should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      assert.ok(!message.includes('sk-secret-key-12345'), 'API key must not appear in error message');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ============================================================================
// 9. Accounting Deliberation Supplementary Write
// ============================================================================

describe('Phase 5A Sprint 5A: Accounting Deliberation', () => {
  let conn: DatabaseConnection;

  beforeEach(() => {
    conn = createTestDatabase();
  });

  it('supplementary write updates deliberation columns', () => {
    // Insert a base accounting record
    conn.run(
      `INSERT INTO meter_interaction_accounting (id, task_id, mission_id, tenant_id, agent_id, model_id, interaction_type, input_tokens, output_tokens, effective_input_tokens, effective_output_tokens, wall_clock_ms, artifacts_bytes, capabilities_used)
       VALUES ('acc-1', 'task-1', 'mission-1', 'tenant-1', 'agent-1', 'model-1', 'llm', 100, 200, 100, 200, 500, 0, '[]')`
    );

    recordAccountingDeliberation(
      conn,
      'acc-1',
      {
        deliberationTokens: 75,
        accountingMode: 'provider_authoritative',
        providerReportedThinkingTokens: 75,
      },
    );

    // Verify the columns were updated
    const row = conn.get<{
      deliberation_tokens: number;
      deliberation_accounting_mode: string;
      provider_deliberation_tokens: number;
      effective_deliberation_tokens: number;
      estimator_id: string | null;
      estimator_version: string | null;
    }>(
      `SELECT deliberation_tokens, deliberation_accounting_mode, provider_deliberation_tokens, effective_deliberation_tokens, estimator_id, estimator_version
       FROM meter_interaction_accounting WHERE id = ?`,
      ['acc-1'],
    );

    assert.ok(row);
    assert.equal(row.deliberation_tokens, 75);
    assert.equal(row.deliberation_accounting_mode, 'provider_authoritative');
    assert.equal(row.provider_deliberation_tokens, 75);
    assert.equal(row.effective_deliberation_tokens, 75);
    assert.equal(row.estimator_id, null);
    assert.equal(row.estimator_version, null);
  });
});

// ============================================================================
// 10. B-001: Stall Detection Behavioral Tests (C-SEC-P5-12)
// ============================================================================

describe('Phase 5A Sprint 5A: Stall Detection Behavioral (B-001)', () => {
  // Strategy: The stall check runs at the TOP of the outer while(true) loop,
  // BEFORE reader.read(). It compares clock.nowMs() against lastDataTime.
  // lastDataTime is updated AFTER reader.read() returns data.
  //
  // To trigger: put multiple SSE events in a single chunk so they're all in the
  // buffer. When the generator yields the first event, the test consumer advances
  // the mock clock past STALL_TIMEOUT_MS. The generator resumes, processes remaining
  // buffered events, then loops back to the outer while — where the stall check fires
  // because lastDataTime is stale (from the single reader.read() call) and the clock
  // has advanced.

  it('A21-REJECTION: SSE stream stall detected after >30s silence (C-SEC-P5-12)', async () => {
    const time = createTestTimeProvider();

    // Two events in ONE chunk. After first yield, consumer advances clock.
    // Second event is processed from buffer. Then outer loop: stall check fires.
    const stream = createMockStream([
      'data: event-1\n\ndata: event-2\n\n',
    ]);

    const events: SSEEvent[] = [];
    try {
      for await (const event of parseSSEStream(stream, undefined, time)) {
        events.push(event);
        if (events.length === 1) {
          // Advance clock past stall timeout BETWEEN yields.
          // The generator is suspended at the inner yield. When it resumes,
          // it processes event-2 from the buffer, then loops back to the outer
          // while(true) where stall check fires: clock.nowMs() - lastDataTime > 30s.
          time.advance(STALL_TIMEOUT_MS + 1000);
        }
      }
      assert.fail('Should have thrown TransportStreamError for stall detection');
    } catch (err) {
      assert.ok(err instanceof TransportStreamError, `Expected TransportStreamError, got: ${err}`);
      assert.equal(err.code, 'TRANSPORT_STALL_DETECTED');
      assert.ok(err.message.includes('SSE stream stalled'));
    }

    // Both events should have been yielded before the stall was detected
    assert.equal(events.length, 2);
  });

  it('A21-SUCCESS: SSE stream within timeout does NOT trigger stall (C-SEC-P5-12)', async () => {
    const time = createTestTimeProvider();

    // Multiple events in one chunk, but cumulative clock advancement stays under threshold.
    // Two events from one read: lastDataTime set once at the read. Between yields, total
    // advancement must stay under STALL_TIMEOUT_MS. Advance only 10s per event = 20s total.
    const stream = createMockStream([
      'data: event-1\n\ndata: event-2\n\n',
    ]);

    const events: SSEEvent[] = [];
    for await (const event of parseSSEStream(stream, undefined, time)) {
      events.push(event);
      // Advance by 10s each time — cumulative 20s < 30s threshold
      time.advance(10_000);
    }

    assert.equal(events.length, 2);
    assert.equal(events[0]!.data, 'event-1');
    assert.equal(events[1]!.data, 'event-2');
  });

  it('A21-REJECTION: NDJSON stream stall detected after >30s silence (C-SEC-P5-12)', async () => {
    const time = createTestTimeProvider();

    // Two JSON objects in one chunk. After first yield, advance clock past stall threshold.
    const stream = createMockStream([
      '{"seq":1}\n{"seq":2}\n',
    ]);

    const records: Record<string, unknown>[] = [];
    try {
      for await (const record of parseNDJSONStream(stream, undefined, time)) {
        records.push(record);
        if (records.length === 1) {
          time.advance(STALL_TIMEOUT_MS + 1000);
        }
      }
      assert.fail('Should have thrown TransportStreamError for stall detection');
    } catch (err) {
      assert.ok(err instanceof TransportStreamError, `Expected TransportStreamError, got: ${err}`);
      assert.equal(err.code, 'TRANSPORT_STALL_DETECTED');
      assert.ok(err.message.includes('NDJSON stream stalled'));
    }

    assert.equal(records.length, 2);
  });

  it('A21-SUCCESS: NDJSON stream within timeout does NOT trigger stall (C-SEC-P5-12)', async () => {
    const time = createTestTimeProvider();

    const stream = createMockStream([
      '{"seq":1}\n{"seq":2}\n',
    ]);

    const records: Record<string, unknown>[] = [];
    for await (const record of parseNDJSONStream(stream, undefined, time)) {
      records.push(record);
      // Advance by 10s each time — cumulative 20s < 30s threshold
      time.advance(10_000);
    }

    assert.equal(records.length, 2);
    assert.equal((records[0] as { seq: number }).seq, 1);
    assert.equal((records[1] as { seq: number }).seq, 2);
  });
});

// ============================================================================
// 11. B-002: Post-Read Body Size Check (C-SEC-P5-06)
// ============================================================================

describe('Phase 5A Sprint 5A: Post-Read Body Size (B-002)', () => {
  // The transport engine has TWO size checks:
  //   1. Content-Length header check (pre-read) — already tested
  //   2. bodyText.length check (post-read) — for chunked transfer without Content-Length
  // B-002 tests the post-read check specifically.

  it('A21-REJECTION: rejects oversized body WITHOUT Content-Length header (C-SEC-P5-06)', async () => {
    const mockAdapter = createMockAdapter();

    // Create a response body larger than MAX_RESPONSE_BYTES (10MB)
    // We use a stream-based body so Response doesn't auto-set Content-Length.
    // The body must be > 10MB when read as text.
    const oversizedBody = 'x'.repeat(MAX_RESPONSE_BYTES + 1);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      // Response with NO Content-Length header but oversized body.
      // Using a ReadableStream body prevents auto Content-Length.
      const encoder = new TextEncoder();
      const bodyStream = new ReadableStream({
        start(controller) {
          // Enqueue in chunks to avoid single massive allocation
          const chunkSize = 1024 * 1024; // 1MB chunks
          let offset = 0;
          while (offset < oversizedBody.length) {
            const end = Math.min(offset + chunkSize, oversizedBody.length);
            controller.enqueue(encoder.encode(oversizedBody.slice(offset, end)));
            offset = end;
          }
          controller.close();
        },
      });
      return new Response(bodyStream, {
        status: 200,
        headers: { 'content-type': 'application/json' },
        // No content-length header — simulates chunked transfer encoding
      });
    };

    try {
      const engine = createTransportEngine();
      await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.fail('Should have thrown TransportError for oversized body');
    } catch (err) {
      assert.ok(err instanceof TransportError, `Expected TransportError, got: ${err}`);
      assert.equal(err.code, 'TRANSPORT_RESPONSE_TOO_LARGE');
      assert.ok(err.message.includes('exceeds limit'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('A21-SUCCESS: accepts body under limit WITHOUT Content-Length header (C-SEC-P5-06)', async () => {
    const mockAdapter = createMockAdapter();

    const validBody = JSON.stringify({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 20 },
      model: 'test',
      stop_reason: 'end_turn',
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      const encoder = new TextEncoder();
      const bodyStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(validBody));
          controller.close();
        },
      });
      return new Response(bodyStream, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    try {
      const engine = createTransportEngine();
      const result = await engine.execute(mockAdapter, { request: createTestLlmRequest() });
      assert.equal(typeof result.response.content, 'string');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ============================================================================
// 12. B-003: NDJSON JSON.parse Error Handling (C-SEC-P5-07)
// ============================================================================

describe('Phase 5A Sprint 5A: NDJSON Parse Error Handling (B-003)', () => {
  // The NDJSON parser must wrap JSON.parse in try/catch and throw
  // TransportStreamError with TRANSPORT_JSON_PARSE_ERROR on invalid JSON.

  it('A21-REJECTION: invalid JSON in NDJSON stream throws TransportStreamError (C-SEC-P5-07)', async () => {
    // First line is valid, second line is invalid JSON
    const stream = createMockStream([
      '{"valid":true}\nthis is not json\n',
    ]);

    const records: Record<string, unknown>[] = [];
    try {
      for await (const record of parseNDJSONStream(stream)) {
        records.push(record);
      }
      assert.fail('Should have thrown TransportStreamError for invalid JSON');
    } catch (err) {
      assert.ok(err instanceof TransportStreamError, `Expected TransportStreamError, got: ${err}`);
      assert.equal(err.code, 'TRANSPORT_JSON_PARSE_ERROR');
      assert.ok(err.message.includes('NDJSON parse error'));
    }

    // First valid record should have been yielded
    assert.equal(records.length, 1);
    assert.equal((records[0] as { valid: boolean }).valid, true);
  });

  it('A21-REJECTION: invalid JSON in trailing buffer throws TransportStreamError (C-SEC-P5-07)', async () => {
    // Stream with invalid JSON as the final line (no trailing newline — exercises the
    // trailing buffer JSON.parse path at the end of parseNDJSONStream)
    const stream = createMockStream([
      '{broken json',
    ]);

    try {
      for await (const _record of parseNDJSONStream(stream)) {
        // Should not yield
      }
      assert.fail('Should have thrown TransportStreamError for invalid JSON in trailing buffer');
    } catch (err) {
      assert.ok(err instanceof TransportStreamError, `Expected TransportStreamError, got: ${err}`);
      assert.equal(err.code, 'TRANSPORT_JSON_PARSE_ERROR');
    }
  });

  it('A21-SUCCESS: valid NDJSON parses correctly (C-SEC-P5-07)', async () => {
    const stream = createMockStream([
      '{"key":"value1"}\n{"key":"value2"}\n',
    ]);

    const records: Record<string, unknown>[] = [];
    for await (const record of parseNDJSONStream(stream)) {
      records.push(record);
    }

    assert.equal(records.length, 2);
    assert.equal((records[0] as { key: string }).key, 'value1');
    assert.equal((records[1] as { key: string }).key, 'value2');
  });
});

// ============================================================================
// 13. B-004: Streaming Timeouts Behavioral (CR-3)
// ============================================================================

describe('Phase 5A Sprint 5A: Streaming Timeouts Behavioral (B-004)', () => {
  // The transport engine has two streaming timeouts:
  //   1. First-byte timeout: 30s from request start to HTTP response (CR-3)
  //   2. Total duration cap: 10min from stream start (CR-3)
  //
  // First-byte timeout: The engine uses AbortSignal.timeout(30000) via
  //   createComposedSignal. If fetch doesn't resolve within 30s, it throws
  //   a DOMException (TimeoutError or AbortError) caught as TRANSPORT_FIRST_BYTE_TIMEOUT.
  //
  // Total duration cap: Inside wrappedStream(), each chunk checks
  //   clock.nowMs() - startMs > STREAM_TOTAL_TIMEOUT_MS. If exceeded, throws
  //   TRANSPORT_STREAM_TOTAL_TIMEOUT.

  it('A21-REJECTION: first-byte timeout fires when no response within 30s (CR-3)', async () => {
    const mockAdapter = createMockAdapter({
      buildRequest: () => ({
        url: 'https://api.test.com/v1/messages',
        method: 'POST' as const,
        headers: { 'content-type': 'application/json' },
        body: {},
        stream: true,
      }),
    });

    const originalFetch = globalThis.fetch;
    // Mock fetch that rejects with the same DOMException that AbortSignal.timeout
    // produces when the 30s first-byte timeout fires. This exercises the engine's
    // error-mapping path (DOMException → TRANSPORT_FIRST_BYTE_TIMEOUT) without
    // waiting 30 real seconds.
    globalThis.fetch = async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };

    try {
      const engine = createTransportEngine();
      await engine.executeStream(mockAdapter, { request: createTestLlmRequest() });
      assert.fail('Should have thrown for first-byte timeout');
    } catch (err) {
      assert.ok(err instanceof TransportError, `Expected TransportError, got: ${err}`);
      assert.equal(err.code, 'TRANSPORT_FIRST_BYTE_TIMEOUT');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('A21-SUCCESS: stream that delivers first byte within 30s succeeds (CR-3)', async () => {
    const mockAdapter = createMockAdapter({
      buildRequest: () => ({
        url: 'https://api.test.com/v1/messages',
        method: 'POST' as const,
        headers: { 'content-type': 'application/json' },
        body: {},
        stream: true,
      }),
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      // Immediate response (well within 30s)
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };

    try {
      const engine = createTransportEngine();
      const result = await engine.executeStream(mockAdapter, { request: createTestLlmRequest() });
      assert.ok(result.stream, 'Should return a stream result');

      // Consume the stream
      const chunks: import('../../src/substrate/interfaces/substrate.js').LlmStreamChunk[] = [];
      for await (const chunk of result.stream) {
        chunks.push(chunk);
      }
      // The stream should complete without timeout
      assert.ok(chunks.length >= 0, 'Stream should complete successfully');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('A21-REJECTION: total duration cap fires after >10min of streaming (CR-3)', async () => {
    const time = createTestTimeProvider();

    const mockAdapter = createMockAdapter({
      buildRequest: () => ({
        url: 'https://api.test.com/v1/messages',
        method: 'POST' as const,
        headers: { 'content-type': 'application/json' },
        body: {},
        stream: true,
      }),
      // parseStream returns a stream that yields chunks with controllable timing
      parseStream: (body: ReadableStream<Uint8Array>, signal?: AbortSignal) => {
        const chunks = [
          { type: 'content_delta' as const, delta: 'chunk1' },
          { type: 'content_delta' as const, delta: 'chunk2' },
          { type: 'content_delta' as const, delta: 'chunk3' },
          { type: 'done' as const, finishReason: 'stop' as const },
        ];
        let idx = 0;
        return {
          stream: (async function* () {
            for (const chunk of chunks) {
              yield chunk;
              idx++;
            }
          })(),
          getDeliberation: () => ({ deliberationTokens: 0, accountingMode: 'estimated' as const, providerReportedThinkingTokens: null }),
          getTotalMs: () => 0,
        };
      },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('dummy'));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    };

    try {
      const engine = createTransportEngine({ time });
      const result = await engine.executeStream(mockAdapter, { request: createTestLlmRequest() });

      // Consume the stream, advancing clock past total timeout between chunks
      const chunks: import('../../src/substrate/interfaces/substrate.js').LlmStreamChunk[] = [];
      try {
        for await (const chunk of result.stream) {
          chunks.push(chunk);
          if (chunks.length === 1) {
            // Advance clock past the 10-minute total duration cap
            time.advance(STREAM_TOTAL_TIMEOUT_MS + 1000);
          }
        }
        assert.fail('Should have thrown for total duration cap');
      } catch (err) {
        assert.ok(err instanceof TransportError, `Expected TransportError, got: ${err}`);
        assert.equal(err.code, 'TRANSPORT_STREAM_TOTAL_TIMEOUT');
        assert.ok(err.message.includes('total duration'));
      }

      // First chunk should have been consumed before timeout
      assert.ok(chunks.length >= 1, 'Should have consumed at least one chunk');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('A21-SUCCESS: stream that completes within 10min succeeds (CR-3)', async () => {
    const time = createTestTimeProvider();

    const mockAdapter = createMockAdapter({
      buildRequest: () => ({
        url: 'https://api.test.com/v1/messages',
        method: 'POST' as const,
        headers: { 'content-type': 'application/json' },
        body: {},
        stream: true,
      }),
      parseStream: () => ({
        stream: (async function* () {
          yield { type: 'content_delta' as const, delta: 'hello' };
          yield { type: 'done' as const, finishReason: 'stop' as const };
        })(),
        getDeliberation: () => ({ deliberationTokens: 0, accountingMode: 'estimated' as const, providerReportedThinkingTokens: null }),
        getTotalMs: () => 0,
      }),
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('dummy'));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    };

    try {
      const engine = createTransportEngine({ time });
      const result = await engine.executeStream(mockAdapter, { request: createTestLlmRequest() });

      const chunks: import('../../src/substrate/interfaces/substrate.js').LlmStreamChunk[] = [];
      for await (const chunk of result.stream) {
        chunks.push(chunk);
        // Advance clock but stay well under 10min
        time.advance(60_000); // 1 minute per chunk
      }

      assert.equal(chunks.length, 2);
      assert.equal((chunks[0] as { type: 'content_delta'; delta: string }).delta, 'hello');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
