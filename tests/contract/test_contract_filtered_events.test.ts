// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Contract tests for FR-005: Filtered Event Subscriptions.
 *
 * Verifies:
 *   - Filtered subscription receives only matching events
 *   - Filtered subscription does NOT receive non-matching events
 *   - Unfiltered subscription receives all events (backward compat)
 *   - claim:related event fires on connect()
 *
 * Amendment 21: Every enforcement DC has BOTH success AND rejection tests.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { createEventBus } from '../../src/kernel/events/event_bus.js';
import type { EventPayload, OperationContext } from '../../src/kernel/interfaces/index.js';
import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';

// ── Helpers for EventBus tests ──

/**
 * Create a minimal in-memory database mock for EventBus tests.
 * EventBus.emit() needs a DB connection for persisting events,
 * but for filtered-dispatch-only tests we can use a stub.
 */
function createStubConn(): import('../../src/kernel/interfaces/database.js').DatabaseConnection {
  return {
    run: () => ({ changes: 0 }),
    get: () => undefined,
    query: () => [],
    transaction: (fn: () => unknown) => fn(),
    close: () => {},
  } as unknown as import('../../src/kernel/interfaces/database.js').DatabaseConnection;
}

function createStubCtx(): OperationContext {
  return {
    tenantId: null,
    agentId: 'agent-test' as import('../../src/kernel/interfaces/index.js').AgentId,
    roles: ['admin'],
    permissions: [],
  };
}

function makeEvent(type: string, payload: Record<string, unknown>): EventPayload {
  return {
    type,
    scope: 'system',
    propagation: 'local',
    payload,
  };
}

// ── Helpers for createLimen tests ──

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-filtered-events-'));
}

function makeKey(): Buffer {
  return randomBytes(32);
}

const dirsToClean: string[] = [];
const instancesToShutdown: Limen[] = [];

function trackDir(dir: string): string {
  dirsToClean.push(dir);
  return dir;
}

function trackInstance(limen: Limen): Limen {
  instancesToShutdown.push(limen);
  return limen;
}

afterEach(async () => {
  for (const instance of instancesToShutdown) {
    try { await instance.shutdown(); } catch { /* already shut down */ }
  }
  instancesToShutdown.length = 0;
  for (const dir of dirsToClean) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  dirsToClean.length = 0;
});

describe('FR-005: Filtered Event Subscriptions', () => {

  // ── DC-FILT-01 [SUCCESS]: filtered subscription receives only matching events ──
  it('DC-FILT-01 [SUCCESS]: filtered subscription receives only matching events', () => {
    const bus = createEventBus();
    const conn = createStubConn();
    const ctx = createStubCtx();

    const matchedEvents: EventPayload[] = [];

    // Subscribe to claim.asserted with predicate filter matching 'test.alpha'
    const subResult = bus.subscribe('claim.asserted', (event) => {
      matchedEvents.push(event);
    }, { predicate: 'test.alpha' });
    assert.ok(subResult.ok, 'subscribe must succeed');

    // Emit two events with different predicates in payload
    bus.emit(conn, ctx, makeEvent('claim.asserted', { predicate: 'test.alpha', subject: 'entity:a:1' }));
    bus.emit(conn, ctx, makeEvent('claim.asserted', { predicate: 'test.beta', subject: 'entity:b:1' }));

    // Only the alpha event should have been received
    assert.equal(matchedEvents.length, 1, 'filtered subscription must receive exactly 1 matching event');
    const payload = matchedEvents[0].payload;
    assert.equal(payload['predicate'], 'test.alpha', 'received event must match filter predicate');
  });

  // ── DC-FILT-02 [REJECTION]: filtered subscription does NOT receive non-matching events ──
  it('DC-FILT-02 [REJECTION]: filtered subscription does NOT receive non-matching events', () => {
    const bus = createEventBus();
    const conn = createStubConn();
    const ctx = createStubCtx();

    const receivedEvents: EventPayload[] = [];

    // Subscribe with a very specific predicate filter
    const subResult = bus.subscribe('claim.asserted', (event) => {
      receivedEvents.push(event);
    }, { predicate: 'nonexistent.predicate' });
    assert.ok(subResult.ok, 'subscribe must succeed');

    // Emit events that do NOT match
    bus.emit(conn, ctx, makeEvent('claim.asserted', { predicate: 'test.alpha', subject: 'entity:a:1' }));
    bus.emit(conn, ctx, makeEvent('claim.asserted', { predicate: 'test.beta', subject: 'entity:b:1' }));

    // No events should have been received
    assert.equal(receivedEvents.length, 0, 'filtered subscription must NOT receive non-matching events');
  });

  // ── DC-FILT-03 [SUCCESS]: unfiltered subscription receives all events (backward compat) ──
  it('DC-FILT-03 [SUCCESS]: unfiltered subscription receives all events', () => {
    const bus = createEventBus();
    const conn = createStubConn();
    const ctx = createStubCtx();

    const allEvents: EventPayload[] = [];

    // Subscribe WITHOUT filter — backward compatibility
    const subResult = bus.subscribe('claim.asserted', (event) => {
      allEvents.push(event);
    });
    assert.ok(subResult.ok, 'subscribe must succeed');

    // Emit multiple events
    bus.emit(conn, ctx, makeEvent('claim.asserted', { predicate: 'test.alpha', subject: 'entity:a:1' }));
    bus.emit(conn, ctx, makeEvent('claim.asserted', { predicate: 'test.beta', subject: 'entity:b:1' }));
    bus.emit(conn, ctx, makeEvent('claim.asserted', { predicate: 'test.gamma', subject: 'entity:c:1' }));

    // All events should have been received
    assert.equal(allEvents.length, 3, 'unfiltered subscription must receive all matching events');
  });

  // ── DC-FILT-04 [SUCCESS]: claim:related event fires on connect() ──
  it('DC-FILT-04 [SUCCESS]: claim:related event fires on connect()', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create two claims
    limen.remember('entity:filt04:a', 'filt04.alpha', 'value a');
    limen.remember('entity:filt04:b', 'filt04.beta', 'value b');

    const recallA = limen.recall('entity:filt04:a');
    const recallB = limen.recall('entity:filt04:b');
    assert.ok(recallA.ok && recallB.ok, 'recall must succeed');
    const claimIdA = recallA.value[0].claimId;
    const claimIdB = recallB.value[0].claimId;

    // Subscribe to claim:related via public API
    const relatedEvents: Array<Record<string, unknown>> = [];
    limen.on('claim:related', (event) => {
      relatedEvents.push(event.data as Record<string, unknown>);
    });

    // Connect the claims
    const connectResult = limen.connect(claimIdA, claimIdB, 'supports');
    assert.ok(connectResult.ok, 'connect must succeed');

    // Verify claim:related event fired
    assert.ok(relatedEvents.length > 0, 'claim:related event must fire on connect');
    assert.equal(relatedEvents[0]['fromClaimId'], claimIdA, 'event must contain fromClaimId');
    assert.equal(relatedEvents[0]['toClaimId'], claimIdB, 'event must contain toClaimId');
    assert.equal(relatedEvents[0]['type'], 'supports', 'event must contain relationship type');
  });
});
