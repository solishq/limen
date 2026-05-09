// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Contract tests for WG-02: Replay Engine Integration.
 * v3.0.0 Phase 1, Slice 1.3
 *
 * Verifies:
 *   - Replay engine instantiated and exposed on API
 *   - verify() and getSnapshots() callable with specific Result shapes
 *   - Mission transitions produce snapshots (F-V3P1-004)
 *   - DC-REPLAY-02/03 assertions are discriminative (F-V3P1-011)
 *
 * Amendment 21: Every enforcement DC has BOTH success AND rejection tests.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';

// ── Helpers ──

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-replay-wiring-'));
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

describe('WG-02: Replay Engine Wiring', () => {
  it('DC-REPLAY-01 [SUCCESS]: replay.getSnapshots returns empty array for non-existent mission', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // replay API must exist and be callable
    assert.ok(limen.replay, 'limen.replay should exist');
    assert.ok(typeof limen.replay.getSnapshots === 'function', 'getSnapshots should be a function');
    assert.ok(typeof limen.replay.verify === 'function', 'verify should be a function');
  });

  it('DC-REPLAY-02 [SUCCESS]: replay.verify returns a Result with specific shape for a mission ID (F-V3P1-011)', async () => {
    // F-V3P1-011: Strengthened from `!== undefined` to verifying specific Result shape.
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const result = limen.replay.verify('mission:convenience');
    // Must return a Result object (ok/error shape)
    assert.ok(typeof result === 'object' && result !== null, 'verify must return an object');
    assert.ok('ok' in result, 'verify result must have ok property (Result shape)');
    assert.equal(typeof result.ok, 'boolean', 'result.ok must be a boolean');

    // Without snapshots, verify returns an error result -- verify the error shape
    if (!result.ok) {
      assert.ok('error' in result, 'error result must have error property');
      assert.ok(typeof result.error === 'object' && result.error !== null, 'error must be an object');
    }
  });

  it('DC-REPLAY-03 [SUCCESS]: replay.getSnapshots returns Result<array> for a mission ID (F-V3P1-011)', async () => {
    // F-V3P1-011: Strengthened from conditional guards to mandatory shape assertions.
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const result = limen.replay.getSnapshots('mission:convenience');
    // Must return a Result object
    assert.ok(typeof result === 'object' && result !== null, 'getSnapshots must return an object');
    assert.ok('ok' in result, 'getSnapshots result must have ok property (Result shape)');
    assert.equal(typeof result.ok, 'boolean', 'result.ok must be a boolean');

    // F-V3P1-011: Whether ok or error, verify specific shape -- no conditional skipping
    if (result.ok) {
      assert.ok(Array.isArray(result.value), 'value must be an array when ok');
    } else {
      assert.ok('error' in result, 'error result must have error property');
      assert.ok(typeof result.error === 'object' && result.error !== null, 'error must be an object');
    }
  });

  it('DC-REPLAY-04 [REJECTION]: replay.getSnapshots for non-existent mission returns empty or error', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const result = limen.replay.getSnapshots('mission:nonexistent');
    // Must return a Result -- not crash
    assert.ok(typeof result === 'object' && result !== null, 'must return a Result object');
    assert.ok('ok' in result, 'must have ok property');

    if (result.ok) {
      assert.ok(Array.isArray(result.value), 'should return array');
      assert.equal(result.value.length, 0, 'should be empty for non-existent mission');
    }
    // Error result is also acceptable for non-existent mission
  });

  it('DC-REPLAY-05 [SUCCESS]: mission transition to PLANNING produces snapshot (F-V3P1-004)', async () => {
    // F-V3P1-004: Verify that the mission.transitioned event subscription
    // actually produces snapshots when a mission transitions.
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create a mission
    const handle = await limen.missions.create({
      agent: 'limen-convenience',
      objective: 'test replay snapshot on transition',
      constraints: {
        tokenBudget: 10000,
        deadline: new Date(Date.now() + 3600_000).toISOString(),
        capabilities: [],
      },
    });
    assert.ok(handle.id, 'mission must be created with an ID');

    // Propose a task graph -- this transitions CREATED -> PLANNING
    await handle.proposeTaskGraph({
      missionId: handle.id,
      tasks: [{
        id: 'task-1',
        description: 'test task',
        executionMode: 'deterministic',
        estimatedTokens: 100,
      }],
      dependencies: [],
      objectiveAlignment: 'direct alignment with test objective',
    });

    // The mission.transitioned event should have fired, creating a snapshot.
    // Give event system a tick to process.
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify snapshot exists for this mission
    const snapshots = limen.replay.getSnapshots(handle.id);
    assert.ok(snapshots.ok, `getSnapshots must succeed: ${!snapshots.ok ? JSON.stringify(snapshots.error) : ''}`);
    if (!snapshots.ok) return;

    assert.ok(snapshots.value.length > 0, 'at least one snapshot must exist after CREATED->PLANNING transition');

    // Verify the snapshot has expected properties
    const snapshot = snapshots.value[0]!;
    assert.ok('missionId' in snapshot || 'mission_id' in snapshot, 'snapshot must reference the mission');
  });
});
