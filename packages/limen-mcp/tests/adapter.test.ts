/**
 * SessionAdapter test suite — lifecycle and governance tests.
 *
 * Tests the SessionAdapter class that bridges MCP sessions to Limen
 * mission/task lifecycle. Covers:
 *   - Session open/close lifecycle
 *   - Guard behavior (throws when no session active)
 *   - Governance protection (protected prefixes, claim tracking)
 *   - Idempotent init
 *
 * Uses real Limen engine instances (no mocks).
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createLimen } from '../../../src/api/index.js';
import type { Limen } from '../../../src/api/index.js';
import { SessionAdapter } from '../src/adapter.js';

// ─── Helpers ───

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-mcp-adapter-'));
}

function makeKey(): Buffer {
  return randomBytes(32);
}

const dirsToClean: string[] = [];
const instancesToShutdown: Limen[] = [];

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

async function createTestEngine(): Promise<Limen> {
  const dir = makeTempDir();
  dirsToClean.push(dir);
  const limen = await createLimen({ dataDir: dir, masterKey: makeKey(), providers: [] });
  instancesToShutdown.push(limen);
  return limen;
}

async function createTestAdapter(protectedPrefixes: string[] = []): Promise<{ adapter: SessionAdapter; limen: Limen }> {
  const limen = await createTestEngine();
  const adapter = new SessionAdapter(limen, { protectedPrefixes: new Set(protectedPrefixes) });
  await adapter.init();
  return { adapter, limen };
}

// ============================================================================
// Lifecycle tests
// ============================================================================

describe('SessionAdapter lifecycle', () => {

  it('openSession succeeds and returns SessionInfo with missionId, taskId, project', async () => {
    const { adapter } = await createTestAdapter();

    const info = await adapter.openSession('test-project');

    assert.ok(info.missionId, 'SessionInfo must contain missionId');
    assert.ok(info.taskId, 'SessionInfo must contain taskId');
    assert.equal(info.project, 'test-project', 'SessionInfo project must match input');
    assert.equal(adapter.active, true, 'Adapter must be active after openSession');
  });

  it('closeSession clears active state', async () => {
    const { adapter } = await createTestAdapter();
    await adapter.openSession('test-project');
    assert.equal(adapter.active, true, 'Precondition: adapter must be active');

    await adapter.closeSession();

    assert.equal(adapter.active, false, 'Adapter must not be active after closeSession');
  });

  it('double openSession throws (session already active)', async () => {
    const { adapter } = await createTestAdapter();
    await adapter.openSession('project-one');

    await assert.rejects(
      () => adapter.openSession('project-two'),
      (err: Error) => {
        assert.ok(err.message.includes('Session already active'), `Expected "Session already active", got: ${err.message}`);
        return true;
      },
    );
  });

  it('closeSession without active session works without error', async () => {
    const { adapter } = await createTestAdapter();

    // No openSession called — closeSession should not throw
    await adapter.closeSession();
    assert.equal(adapter.active, false, 'Adapter remains inactive after closing non-existent session');
  });

  it('after close, can open a new session', async () => {
    const { adapter } = await createTestAdapter();
    await adapter.openSession('first-project');
    await adapter.closeSession();

    const info = await adapter.openSession('second-project');

    assert.equal(info.project, 'second-project', 'New session must have the new project name');
    assert.equal(adapter.active, true, 'Adapter must be active after reopening');
  });

  it('missionId getter throws when no session active', async () => {
    const { adapter } = await createTestAdapter();

    assert.throws(
      () => adapter.missionId,
      (err: Error) => {
        assert.ok(err.message.includes('No active session'), `Expected "No active session", got: ${err.message}`);
        return true;
      },
    );
  });

  it('taskId getter throws when no session active', async () => {
    const { adapter } = await createTestAdapter();

    assert.throws(
      () => adapter.taskId,
      (err: Error) => {
        assert.ok(err.message.includes('No active session'), `Expected "No active session", got: ${err.message}`);
        return true;
      },
    );
  });

  it('project getter throws when no session active', async () => {
    const { adapter } = await createTestAdapter();

    assert.throws(
      () => adapter.project,
      (err: Error) => {
        assert.ok(err.message.includes('No active session'), `Expected "No active session", got: ${err.message}`);
        return true;
      },
    );
  });

  it('init can be called multiple times without error (duplicate agent registration)', async () => {
    const limen = await createTestEngine();
    const adapter = new SessionAdapter(limen, { protectedPrefixes: new Set() });

    // First init — registers agent
    await adapter.init();
    // Second init — should not throw (catches duplicate registration)
    await adapter.init();
    // Third init — still fine
    await adapter.init();

    // Verify adapter still works after repeated init
    const info = await adapter.openSession('multi-init-project');
    assert.ok(info.missionId, 'Adapter must work after multiple init calls');
  });
});

// ============================================================================
// Governance tests
// ============================================================================

describe('SessionAdapter governance', () => {

  it('isProtected returns true for matching prefix', async () => {
    const { adapter } = await createTestAdapter(['governance:', 'system:']);

    assert.equal(adapter.isProtected('governance:rule:alpha'), true, 'Subject with governance: prefix must be protected');
    assert.equal(adapter.isProtected('system:config:timeout'), true, 'Subject with system: prefix must be protected');
  });

  it('isProtected returns false for non-matching subject', async () => {
    const { adapter } = await createTestAdapter(['governance:', 'system:']);

    assert.equal(adapter.isProtected('entity:project:alpha'), false, 'Subject without protected prefix must not be protected');
    assert.equal(adapter.isProtected('user:settings:theme'), false, 'Subject without protected prefix must not be protected');
  });

  it('isProtected with empty prefixes always returns false', async () => {
    const { adapter } = await createTestAdapter([]);

    assert.equal(adapter.isProtected('governance:anything'), false, 'With no protected prefixes, nothing is protected');
    assert.equal(adapter.isProtected('system:anything'), false, 'With no protected prefixes, nothing is protected');
    assert.equal(adapter.isProtected(''), false, 'Empty string is not protected');
  });

  it('trackClaim + getTrackedSubject roundtrip works', async () => {
    const { adapter } = await createTestAdapter();

    adapter.trackClaim('claim-001', 'entity:test:alpha');
    const subject = adapter.getTrackedSubject('claim-001');

    assert.equal(subject, 'entity:test:alpha', 'Tracked subject must match what was stored');
  });

  it('getTrackedSubject returns undefined for untracked claim', async () => {
    const { adapter } = await createTestAdapter();

    const subject = adapter.getTrackedSubject('nonexistent-claim');

    assert.equal(subject, undefined, 'Untracked claim must return undefined');
  });

  it('claim cache is cleared on closeSession', async () => {
    const { adapter } = await createTestAdapter();
    await adapter.openSession('cache-test');

    adapter.trackClaim('claim-001', 'entity:test:alpha');
    assert.equal(adapter.getTrackedSubject('claim-001'), 'entity:test:alpha', 'Precondition: claim must be tracked');

    await adapter.closeSession();

    assert.equal(adapter.getTrackedSubject('claim-001'), undefined, 'Claim cache must be cleared after closeSession');
  });
});
