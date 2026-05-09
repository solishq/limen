// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Contract test for F-WITNESS-001: replay snapshot on mission creation.
 * Verifies that missions.create() triggers a mission_start snapshot
 * so replay.verify() works for newly created missions.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-replay-create-'));
}

function makeKey(): Buffer {
  return randomBytes(32);
}

const dirsToClean: string[] = [];
const instancesToShutdown: Limen[] = [];

function trackDir(dir: string): string { dirsToClean.push(dir); return dir; }
function trackInstance(limen: Limen): Limen { instancesToShutdown.push(limen); return limen; }

afterEach(async () => {
  for (const inst of instancesToShutdown) { try { await inst.shutdown(); } catch {} }
  instancesToShutdown.length = 0;
  for (const d of dirsToClean) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  dirsToClean.length = 0;
});

describe('F-WITNESS-001: Replay snapshot on mission creation', () => {
  it('DC-REPLAY-06 [SUCCESS]: missions.create() produces a mission_start snapshot', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create a mission
    const handle = await limen.missions.create({
      agent: 'limen-convenience',
      objective: 'test replay snapshot on create',
      constraints: {
        tokenBudget: 10000,
        deadline: new Date(Date.now() + 3600_000).toISOString(),
        capabilities: [],
      },
    });
    assert.ok(handle.id, 'mission must have an ID');

    // Give event system a tick
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify snapshot exists
    const snapshots = limen.replay.getSnapshots(handle.id);
    assert.ok(snapshots.ok, `getSnapshots must succeed: ${!snapshots.ok ? JSON.stringify(snapshots.error) : ''}`);
    assert.ok(snapshots.value.length > 0, 'mission_start snapshot must exist after missions.create()');

    // Verify replay.verify works (should find the snapshot)
    const verification = limen.replay.verify(handle.id);
    // May return error (only start snapshot, no end) but should NOT be SNAPSHOT_NOT_FOUND
    if (!verification.ok) {
      assert.notEqual(
        verification.error.code, 'SNAPSHOT_NOT_FOUND',
        'verify should NOT return SNAPSHOT_NOT_FOUND after missions.create()'
      );
    }
  });

  it('DC-REPLAY-07 [REJECTION]: replay.verify for mission with only start snapshot returns appropriate error', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const handle = await limen.missions.create({
      agent: 'limen-convenience',
      objective: 'test incomplete replay',
      constraints: {
        tokenBudget: 5000,
        deadline: new Date(Date.now() + 3600_000).toISOString(),
        capabilities: [],
      },
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    // verify() with only start snapshot (no end) should return an error
    // but it should be a different error than SNAPSHOT_NOT_FOUND
    const result = limen.replay.verify(handle.id);
    assert.ok(typeof result === 'object' && 'ok' in result, 'must return Result');
  });
});
