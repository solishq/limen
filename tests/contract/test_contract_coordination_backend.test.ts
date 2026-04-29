/**
 * Phase 6 — Coordination Backend Contract Tests (FR-009)
 *
 * Verifies CoordinationBackend adapter against truth model T-COORD-01..T-COORD-08.
 * Uses a real Limen instance (in-memory SQLite) -- no mocks for storage semantics.
 *
 * Amendment 21 compliance: Every enforcement DC has both SUCCESS and REJECTION tests.
 *
 * DC-COORD-01 [SUCCESS]: registerSession + getActiveSessions returns registered session
 * DC-COORD-02 [SUCCESS]: deregisterSession removes session from active list
 * DC-COORD-03 [REJECTION]: deregisterSession with invalid ID returns error
 * DC-COORD-04 [SUCCESS]: recordDecision + getRecentDecisions returns decision
 * DC-COORD-05 [SUCCESS]: acquireLock + getActiveLocks returns lock
 * DC-COORD-06 [SUCCESS]: releaseLock removes lock
 * DC-COORD-07 [REJECTION]: acquireLock on already-locked domain returns error
 * DC-COORD-08 [SUCCESS]: getRecentDecisions with domain filter returns only matching
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';
import { createLimenBackend } from '../../src/coordination/index.js';
import type { CoordinationBackend } from '../../src/coordination/index.js';
import type { TimeProvider } from '../../src/kernel/interfaces/time.js';

// ── Helpers ──

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-coord-'));
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

/** Create a real TimeProvider with controllable now */
function createTestTimeProvider(isoNow?: string): TimeProvider & { setNow(iso: string): void } {
  let currentNow = isoNow ?? new Date().toISOString();
  return {
    nowISO() { return currentNow; },
    setNow(iso: string) { currentNow = iso; },
  };
}

/** Create a Limen instance + CoordinationBackend for testing */
async function createTestBackend(time?: TimeProvider): Promise<{
  limen: Limen;
  backend: CoordinationBackend;
  time: TimeProvider & { setNow(iso: string): void };
}> {
  const dir = trackDir(makeTempDir());
  const testTime = (time as TimeProvider & { setNow(iso: string): void }) ?? createTestTimeProvider();
  const limen = trackInstance(await createLimen({
    dataDir: dir,
    masterKey: makeKey(),
  }));
  const backend = createLimenBackend(limen, testTime);
  return { limen, backend, time: testTime };
}

// ============================================================================
// Session Management Tests
// ============================================================================

describe('CoordinationBackend — Session Management', () => {
  it('DC-COORD-01 [SUCCESS]: registerSession + getActiveSessions returns registered session', async () => {
    const { backend } = await createTestBackend();

    const regResult = backend.registerSession({
      sessionId: 'sess-001',
      agentRole: 'builder',
      project: 'limen',
      status: 'active',
    });
    assert.strictEqual(regResult.ok, true, 'registerSession must succeed');

    const listResult = backend.getActiveSessions();
    assert.strictEqual(listResult.ok, true, 'getActiveSessions must succeed');
    assert.ok(listResult.ok);
    const sessions = listResult.value;
    assert.ok(sessions.length >= 1, 'Must contain at least the registered session');
    const found = sessions.find(s => s.sessionId === 'sess-001');
    assert.ok(found, 'Registered session must appear in active list');
    assert.strictEqual(found.agentRole, 'builder');
    assert.strictEqual(found.project, 'limen');
    assert.strictEqual(found.status, 'active');
  });

  it('DC-COORD-02 [SUCCESS]: deregisterSession removes session from active list', async () => {
    const { backend } = await createTestBackend();

    backend.registerSession({
      sessionId: 'sess-002',
      agentRole: 'breaker',
      project: 'limen',
      status: 'active',
    });

    const deregResult = backend.deregisterSession('sess-002');
    assert.strictEqual(deregResult.ok, true, 'deregisterSession must succeed');

    const listResult = backend.getActiveSessions();
    assert.ok(listResult.ok);
    const found = listResult.value.find(s => s.sessionId === 'sess-002');
    assert.strictEqual(found, undefined, 'Deregistered session must not appear');
  });

  it('DC-COORD-03 [REJECTION]: deregisterSession with invalid ID returns error', async () => {
    const { backend } = await createTestBackend();

    const result = backend.deregisterSession('nonexistent-session');
    assert.strictEqual(result.ok, false, 'Must fail for nonexistent session');
    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, 'COORD_SESSION_NOT_FOUND');
  });

  it('getActiveSessions with project filter returns only matching', async () => {
    const { backend } = await createTestBackend();

    backend.registerSession({ sessionId: 'sess-a', agentRole: 'builder', project: 'alpha', status: 'active' });
    backend.registerSession({ sessionId: 'sess-b', agentRole: 'breaker', project: 'beta', status: 'active' });

    const result = backend.getActiveSessions('alpha');
    assert.ok(result.ok);
    assert.strictEqual(result.value.length, 1);
    assert.strictEqual(result.value[0].sessionId, 'sess-a');
  });
});

// ============================================================================
// Decision Coordination Tests
// ============================================================================

describe('CoordinationBackend — Decision Coordination', () => {
  it('DC-COORD-04 [SUCCESS]: recordDecision + getRecentDecisions returns decision', async () => {
    const { backend } = await createTestBackend();

    const recResult = backend.recordDecision({
      sessionId: 'sess-001',
      domain: 'architecture',
      content: 'Use event sourcing for state management',
      confidence: 0.85,
    });
    assert.strictEqual(recResult.ok, true, 'recordDecision must succeed');
    assert.ok(recResult.ok);
    assert.ok(recResult.value.claimId, 'Must return a claimId');

    const listResult = backend.getRecentDecisions();
    assert.ok(listResult.ok);
    assert.ok(listResult.value.length >= 1, 'Must contain the recorded decision');
    const found = listResult.value.find(d => d.content === 'Use event sourcing for state management');
    assert.ok(found, 'Recorded decision must appear in recent list');
    assert.strictEqual(found.sessionId, 'sess-001');
    assert.strictEqual(found.domain, 'architecture');
    // Convenience API caps confidence at maxAutoConfidence (0.7) without evidence grounding.
    // The adapter stores the capped value, which is the correct behavior.
    assert.strictEqual(found.confidence, 0.7);
  });

  it('DC-COORD-08 [SUCCESS]: getRecentDecisions with domain filter returns only matching', async () => {
    const { backend } = await createTestBackend();

    backend.recordDecision({
      sessionId: 'sess-001',
      domain: 'security',
      content: 'Enable mTLS between services',
    });
    backend.recordDecision({
      sessionId: 'sess-001',
      domain: 'performance',
      content: 'Add connection pooling',
    });

    const securityResult = backend.getRecentDecisions('security');
    assert.ok(securityResult.ok);
    assert.strictEqual(securityResult.value.length, 1);
    assert.strictEqual(securityResult.value[0].domain, 'security');
    assert.strictEqual(securityResult.value[0].content, 'Enable mTLS between services');
  });

  it('getRecentDecisions with since filter excludes older decisions', async () => {
    const { backend } = await createTestBackend();

    backend.recordDecision({
      sessionId: 'sess-001',
      domain: 'design',
      content: 'A decision to filter',
    });

    // Query with since far in the future -- should exclude all decisions
    const futureResult = backend.getRecentDecisions(undefined, '2099-01-01T00:00:00.000Z');
    assert.ok(futureResult.ok);
    assert.strictEqual(futureResult.value.length, 0, 'Future since must exclude all decisions');

    // Query with since far in the past -- should include all decisions
    const pastResult = backend.getRecentDecisions(undefined, '2000-01-01T00:00:00.000Z');
    assert.ok(pastResult.ok);
    assert.ok(pastResult.value.length >= 1, 'Past since must include decisions');
    const found = pastResult.value.find(d => d.content === 'A decision to filter');
    assert.ok(found, 'Decision must appear when since is in the past');
  });
});

// ============================================================================
// Domain Locking Tests
// ============================================================================

describe('CoordinationBackend — Domain Locking', () => {
  it('DC-COORD-05 [SUCCESS]: acquireLock + getActiveLocks returns lock', async () => {
    const { backend } = await createTestBackend();

    const lockResult = backend.acquireLock('auth-module', 'builder-agent');
    assert.strictEqual(lockResult.ok, true, 'acquireLock must succeed on free domain');
    assert.ok(lockResult.ok);
    assert.ok(lockResult.value.lockId, 'Must return a lockId');

    const listResult = backend.getActiveLocks();
    assert.ok(listResult.ok);
    assert.ok(listResult.value.length >= 1, 'Must contain the acquired lock');
    const found = listResult.value.find(l => l.domain === 'auth-module');
    assert.ok(found, 'Acquired lock must appear in active list');
    assert.strictEqual(found.holder, 'builder-agent');
  });

  it('DC-COORD-06 [SUCCESS]: releaseLock removes lock', async () => {
    const { backend } = await createTestBackend();

    const lockResult = backend.acquireLock('db-schema', 'certifier-agent');
    assert.ok(lockResult.ok);

    const releaseResult = backend.releaseLock(lockResult.value.lockId);
    assert.strictEqual(releaseResult.ok, true, 'releaseLock must succeed');

    const listResult = backend.getActiveLocks();
    assert.ok(listResult.ok);
    const found = listResult.value.find(l => l.domain === 'db-schema');
    assert.strictEqual(found, undefined, 'Released lock must not appear in active list');
  });

  it('DC-COORD-07 [REJECTION]: acquireLock on already-locked domain returns error', async () => {
    const { backend } = await createTestBackend();

    const first = backend.acquireLock('critical-section', 'agent-alpha');
    assert.ok(first.ok, 'First lock must succeed');

    const second = backend.acquireLock('critical-section', 'agent-beta');
    assert.strictEqual(second.ok, false, 'Second lock on same domain must fail');
    assert.ok(!second.ok);
    assert.strictEqual(second.error.code, 'COORD_LOCK_CONTENTION');
  });

  it('acquireLock succeeds after expired lock is cleaned up', async () => {
    const testTime = createTestTimeProvider('2026-04-01T00:00:00.000Z');
    const { backend } = await createTestBackend(testTime);

    // Acquire with 1-second TTL
    const first = backend.acquireLock('expiring-domain', 'agent-alpha', 1000);
    assert.ok(first.ok);

    // Move time past expiry
    testTime.setNow('2026-04-01T00:00:02.000Z');

    // Second acquire should succeed (expired lock cleaned up)
    const second = backend.acquireLock('expiring-domain', 'agent-beta');
    assert.ok(second.ok, 'Lock on expired domain must succeed');
  });

  it('getActiveLocks excludes expired locks', async () => {
    const testTime = createTestTimeProvider('2026-04-01T00:00:00.000Z');
    const { backend } = await createTestBackend(testTime);

    backend.acquireLock('temp-domain', 'agent', 1000);

    // Move time past expiry
    testTime.setNow('2026-04-01T00:00:02.000Z');

    const result = backend.getActiveLocks();
    assert.ok(result.ok);
    const found = result.value.find(l => l.domain === 'temp-domain');
    assert.strictEqual(found, undefined, 'Expired lock must not appear in active list');
  });

  it('acquireLock with TTL stores expiresAt', async () => {
    const testTime = createTestTimeProvider('2026-04-01T00:00:00.000Z');
    const { backend } = await createTestBackend(testTime);

    const lockResult = backend.acquireLock('timed-domain', 'agent', 60000);
    assert.ok(lockResult.ok);

    const listResult = backend.getActiveLocks();
    assert.ok(listResult.ok);
    const found = listResult.value.find(l => l.domain === 'timed-domain');
    assert.ok(found);
    assert.ok(found.expiresAt, 'Lock with TTL must have expiresAt');
    assert.strictEqual(found.expiresAt, '2026-04-01T00:01:00.000Z');
  });

  it('acquireLock without TTL stores null expiresAt', async () => {
    const { backend } = await createTestBackend();

    backend.acquireLock('permanent-domain', 'agent');

    const listResult = backend.getActiveLocks();
    assert.ok(listResult.ok);
    const found = listResult.value.find(l => l.domain === 'permanent-domain');
    assert.ok(found);
    assert.strictEqual(found.expiresAt, null, 'Lock without TTL must have null expiresAt');
  });
});
