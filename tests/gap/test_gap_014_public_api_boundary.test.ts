/**
 * Phase 4C: Public API Boundary Tests
 * Verifies: CF-004 (COMPAT-003) — createLimen() works without internal LimenDeps.
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * §3.3: "Single factory function returning frozen immutable object."
 * C-06: "Two createLimen() calls produce independent instances."
 * C-07: "Frozen public API (Object.freeze)."
 * COMPAT-003: "Consumers CANNOT instantiate Limen without internal imports."
 *
 * Phase: 4C (Certification — Public Integration Boundary)
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import {
  createLimen,
  createDefaultDeps,
  LimenError,
} from '../../src/api/index.js';

import type {
  Limen,
  LimenConfig,
} from '../../src/api/index.js';

// ─── Constants ───

/** S3.6: Each test gets its own dataDir — no shared state (C-06). */
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-test-4c-'));
}

/** I-11: Master key must be ≥32 bytes. */
function makeKey(): Buffer {
  return randomBytes(32);
}

/** Minimal valid config for single-tenant mode. */
function minimalConfig(dataDir?: string): LimenConfig {
  return {
    dataDir: dataDir ?? makeTempDir(),
    masterKey: makeKey(),
  };
}

// ─── Cleanup ───

const dirsToClean: string[] = [];
const instancesToShutdown: Limen[] = [];

afterEach(async () => {
  // Shutdown all Limen instances created during the test
  for (const instance of instancesToShutdown) {
    try { await instance.shutdown(); } catch { /* ignore shutdown errors in cleanup */ }
  }
  instancesToShutdown.length = 0;

  // Clean up temp dirs
  for (const dir of dirsToClean) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  dirsToClean.length = 0;
});

/** Track a temp dir for cleanup. */
function trackDir(dir: string): string {
  dirsToClean.push(dir);
  return dir;
}

/** Track a Limen instance for shutdown. */
function trackInstance(instance: Limen): Limen {
  instancesToShutdown.push(instance);
  return instance;
}

// ============================================================================
// Layer 1: Unit Tests — createDefaultDeps()
// ============================================================================

describe('Layer 1: createDefaultDeps() structure', () => {

  // #1
  it('#1: createDefaultDeps() returns frozen object (C-07)', () => {
    const deps = createDefaultDeps();
    assert.ok(Object.isFrozen(deps),
      'C-07: createDefaultDeps() result must be frozen');
  });

  // #2
  it('#2: result has all 4 required LimenDeps properties', () => {
    const deps = createDefaultDeps();
    assert.ok('createKernel' in deps, 'Must have createKernel');
    assert.ok('destroyKernel' in deps, 'Must have destroyKernel');
    assert.ok('createSubstrate' in deps, 'Must have createSubstrate');
    assert.ok('createOrchestration' in deps, 'Must have createOrchestration');
  });

  // #3
  it('#3: createKernel is a function', () => {
    const deps = createDefaultDeps();
    assert.equal(typeof deps.createKernel, 'function',
      'createKernel must be a function');
  });

  // #4
  it('#4: destroyKernel is a function', () => {
    const deps = createDefaultDeps();
    assert.equal(typeof deps.destroyKernel, 'function',
      'destroyKernel must be a function');
  });

  // #5
  it('#5: createSubstrate is a function', () => {
    const deps = createDefaultDeps();
    assert.equal(typeof deps.createSubstrate, 'function',
      'createSubstrate must be a function');
  });

  // #6
  it('#6: createOrchestration is a function', () => {
    const deps = createDefaultDeps();
    assert.equal(typeof deps.createOrchestration, 'function',
      'createOrchestration must be a function');
  });
});

// ============================================================================
// Layer 2: Integration Tests — createLimen(config) without deps
// ============================================================================

describe('Layer 2: createLimen(config) without deps — CF-004', () => {

  // #7
  it('#7: createLimen(config) succeeds without deps parameter', async () => {
    // §3.3: "Single factory function returning frozen immutable object."
    // CF-004: Consumer must NOT need LimenDeps to create an instance.
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(
      await createLimen({ dataDir: dir, masterKey: makeKey() }),
    );

    assert.ok(limen, 'createLimen must return a Limen instance without deps');
    assert.equal(typeof limen.chat, 'function', 'Instance must have chat()');
    assert.equal(typeof limen.health, 'function', 'Instance must have health()');
    assert.equal(typeof limen.shutdown, 'function', 'Instance must have shutdown()');
  });

  // #8
  it('#8: returned Limen is frozen (C-07)', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(
      await createLimen({ dataDir: dir, masterKey: makeKey() }),
    );

    assert.ok(Object.isFrozen(limen),
      'C-07: Limen instance must be deeply frozen');

    // Verify nested namespaces are frozen
    assert.ok(Object.isFrozen(limen.missions),
      'C-07: limen.missions must be frozen');
    assert.ok(Object.isFrozen(limen.agents),
      'C-07: limen.agents must be frozen');
  });

  // #9
  it('#9: limen.health() returns valid status', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(
      await createLimen({ dataDir: dir, masterKey: makeKey() }),
    );

    const health = await limen.health();
    assert.ok(
      health.status === 'healthy' || health.status === 'degraded',
      `health.status must be 'healthy' or 'degraded', got '${health.status}'`,
    );
    assert.ok(typeof health.uptime_ms === 'number', 'health.uptime_ms must be a number');
  });

  // #10
  it('#10: limen.shutdown() completes without error', async () => {
    const dir = trackDir(makeTempDir());
    const limen = await createLimen({ dataDir: dir, masterKey: makeKey() });

    // Shutdown must complete cleanly — no throw
    await assert.doesNotReject(
      () => limen.shutdown(),
      'shutdown() must complete without error',
    );
    // Don't track — already shut down
  });

  // #11
  it('#11: two createLimen() calls produce independent instances (C-06)', async () => {
    const dirA = trackDir(makeTempDir());
    const dirB = trackDir(makeTempDir());

    const cortexA = trackInstance(
      await createLimen({ dataDir: dirA, masterKey: makeKey() }),
    );
    const cortexB = trackInstance(
      await createLimen({ dataDir: dirB, masterKey: makeKey() }),
    );

    // C-06: Independent — different objects
    assert.notStrictEqual(cortexA, cortexB,
      'C-06: Two instances must be different objects');

    // Shutdown one — the other must still work
    await cortexA.shutdown();
    instancesToShutdown.splice(instancesToShutdown.indexOf(cortexA), 1);

    const healthB = await cortexB.health();
    assert.ok(
      healthB.status === 'healthy' || healthB.status === 'degraded',
      'C-06: Instance B must still function after A is shut down',
    );
  });
});

// ============================================================================
// Layer 3: Backward Compatibility Tests
// ============================================================================

describe('Layer 3: Backward compatibility — explicit deps still works', () => {

  // #12
  it('#12: createLimen(config, explicitDeps) still works', async () => {
    const dir = trackDir(makeTempDir());
    const deps = createDefaultDeps();

    const limen = trackInstance(
      await createLimen({ dataDir: dir, masterKey: makeKey() }, deps),
    );

    assert.ok(limen, 'createLimen with explicit deps must still work');
    assert.ok(Object.isFrozen(limen), 'C-07: Must still be frozen');
  });

  // #13
  it('#13: selective override — custom createKernel with default rest', async () => {
    // Advanced pattern: override one factory, keep defaults for rest
    const defaults = createDefaultDeps();
    let kernelCalled = false;

    const customDeps = {
      ...defaults,
      createKernel: (...args: Parameters<typeof defaults.createKernel>) => {
        kernelCalled = true;
        return defaults.createKernel(...args);
      },
    };

    const dir = trackDir(makeTempDir());
    const limen = trackInstance(
      await createLimen({ dataDir: dir, masterKey: makeKey() }, customDeps),
    );

    assert.ok(limen, 'Instance created with selective override');
    assert.ok(kernelCalled, 'Custom createKernel was invoked');
  });
});

// ============================================================================
// Layer 4: Consumer Pattern Validation
// ============================================================================

describe('Layer 4: Consumer patterns — downstream integration path', () => {

  // #14
  it('#14: minimal config — just dataDir and masterKey', async () => {
    // COMPAT-003: Consumer's simplest path
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(
      await createLimen({ dataDir: dir, masterKey: makeKey() }),
    );

    assert.ok(limen, 'Minimal config must produce a working instance');
    assert.equal(typeof limen.chat, 'function');
    assert.equal(typeof limen.infer, 'function');
    assert.equal(typeof limen.session, 'function');
    assert.ok(limen.missions, 'Must have missions namespace');
    assert.ok(limen.agents, 'Must have agents namespace');
    assert.ok(limen.knowledge, 'Must have knowledge namespace');
    assert.ok(limen.roles, 'Must have roles namespace');
    assert.ok(limen.data, 'Must have data namespace');
    assert.ok(limen.metrics, 'Must have metrics namespace');
  });

  // #15
  it('#15: multi-tenant config with row-level isolation', async () => {
    // COMPAT-003: Consumer's multi-tenant path
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(
      await createLimen({
        dataDir: dir,
        masterKey: makeKey(),
        tenancy: { mode: 'multi', isolation: 'row-level' },
      }),
    );

    assert.ok(limen, 'Multi-tenant config must produce a working instance');

    const health = await limen.health();
    assert.ok(
      health.status === 'healthy' || health.status === 'degraded',
      'Multi-tenant instance must be operational',
    );
  });
});

// ============================================================================
// Layer 5: Error Path Tests
// ============================================================================

describe('Layer 5: Error paths and adversarial inputs', () => {

  // #16
  it('#16: invalid config throws INVALID_CONFIG, not ENGINE_UNHEALTHY', async () => {
    // Missing dataDir — must throw INVALID_CONFIG
    await assert.rejects(
      () => createLimen({ dataDir: '', masterKey: makeKey() }),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, 'INVALID_CONFIG',
          'Empty dataDir must produce INVALID_CONFIG, not ENGINE_UNHEALTHY');
        return true;
      },
    );

    // Missing masterKey — must throw INVALID_CONFIG
    await assert.rejects(
      () => createLimen({ dataDir: '/tmp/test', masterKey: Buffer.alloc(0) }),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, 'INVALID_CONFIG',
          'Empty masterKey must produce INVALID_CONFIG');
        return true;
      },
    );

    // masterKey too short — must throw INVALID_CONFIG
    await assert.rejects(
      () => createLimen({ dataDir: '/tmp/test', masterKey: Buffer.alloc(16) }),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, 'INVALID_CONFIG',
          'Short masterKey must produce INVALID_CONFIG');
        return true;
      },
    );
  });

  // #17
  it('#17: ENGINE_UNHEALTHY is not thrown for missing deps', async () => {
    // Before CF-004: createLimen(config) threw ENGINE_UNHEALTHY when deps omitted.
    // After CF-004: createLimen(config) must NOT throw ENGINE_UNHEALTHY for this reason.
    // It may still throw ENGINE_UNHEALTHY for actual unhealthy states.
    const dir = trackDir(makeTempDir());

    try {
      const limen = await createLimen({ dataDir: dir, masterKey: makeKey() });
      trackInstance(limen);
      // Success -- ENGINE_UNHEALTHY not thrown. Verify we got a real instance.
      assert.equal(typeof limen.chat, 'function',
        'createLimen(config) returned a valid instance without deps');
    } catch (err: unknown) {
      const error = err as Error & { code?: string };
      assert.notEqual(error.code, 'ENGINE_UNHEALTHY',
        'CF-004: ENGINE_UNHEALTHY must not be thrown when deps are simply not provided. ' +
        `Got: ${error.code}: ${error.message}`);
      // If it threw something else, that's a different issue — still passes this test
    }
  });
});

// ============================================================================
// Layer 6: R4C-004 — Orchestration Connection Shutdown
// ============================================================================

describe('Layer 6: R4C-004 — orchestration connection cleanup', () => {

  // #18
  it('#18: shutdown releases all connections (R4C-004)', async () => {
    // R4C-004: The orchestration adapter opens its own database connection.
    // shutdown() must close it. Proof: after shutdown, a second instance
    // using the same dataDir works without contention.
    const dir = trackDir(makeTempDir());
    const cortex1 = await createLimen({ dataDir: dir, masterKey: makeKey() });

    // Force connections to be opened
    await cortex1.health();

    // Shutdown first instance
    await cortex1.shutdown();

    // Create second instance on same dir — must succeed (no leaked connections)
    const cortex2 = trackInstance(
      await createLimen({ dataDir: dir, masterKey: makeKey() }),
    );

    const health = await cortex2.health();
    assert.ok(
      health.status === 'healthy' || health.status === 'degraded',
      'R4C-004: Second instance must work after first shuts down cleanly',
    );
  });

  // #19
  it('#19: shutdown completes cleanly with default deps (R4C-004)', async () => {
    // Specifically test the default deps path (not explicit deps)
    // to verify orchestration connection tracking works.
    const dir = trackDir(makeTempDir());
    const limen = await createLimen({ dataDir: dir, masterKey: makeKey() });

    // Call health to force connection opening
    await limen.health();

    // Shutdown must not throw
    await assert.doesNotReject(
      () => limen.shutdown(),
      'R4C-004: shutdown() with default deps must close all connections cleanly',
    );
  });
});

// ============================================================================
// Layer 7: R4C-005 — Adapter Failure Paths
// ============================================================================

describe('Layer 7: R4C-005 — adapter failure paths', () => {

  // #20
  it('#20: substrate failure propagates as ENGINE_UNHEALTHY', async () => {
    // R4C-005: When createSubstrate throws, createLimen must propagate
    // the error as a LimenError, not let it escape as raw Error.
    const defaults = createDefaultDeps();
    const failDeps = {
      ...defaults,
      createSubstrate: () => {
        throw new LimenError('ENGINE_UNHEALTHY', 'Simulated substrate failure');
      },
    };

    await assert.rejects(
      () => createLimen({ dataDir: trackDir(makeTempDir()), masterKey: makeKey() }, failDeps),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, 'ENGINE_UNHEALTHY',
          'R4C-005: Substrate failure must produce ENGINE_UNHEALTHY');
        return true;
      },
    );
  });

  // #21
  it('#21: orchestration failure propagates error', async () => {
    // R4C-005: When createOrchestration throws, createLimen must propagate.
    const defaults = createDefaultDeps();
    const failDeps = {
      ...defaults,
      createOrchestration: () => {
        throw new LimenError('ENGINE_UNHEALTHY', 'Simulated orchestration failure');
      },
    };

    await assert.rejects(
      () => createLimen({ dataDir: trackDir(makeTempDir()), masterKey: makeKey() }, failDeps),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, 'ENGINE_UNHEALTHY',
          'R4C-005: Orchestration failure must produce ENGINE_UNHEALTHY');
        return true;
      },
    );
  });

  // #22
  it('#22: kernel destroyed when substrate creation fails (partial cleanup)', async () => {
    // R4C-005: If substrate construction fails after kernel is created,
    // the kernel must be destroyed to prevent resource leaks.
    const defaults = createDefaultDeps();
    let kernelDestroyed = false;

    const failDeps = {
      ...defaults,
      destroyKernel: (...args: Parameters<typeof defaults.destroyKernel>) => {
        kernelDestroyed = true;
        return defaults.destroyKernel(...args);
      },
      createSubstrate: () => {
        throw new Error('substrate construction failure');
      },
    };

    await assert.rejects(
      () => createLimen({ dataDir: trackDir(makeTempDir()), masterKey: makeKey() }, failDeps),
    );

    assert.ok(kernelDestroyed,
      'R4C-005: destroyKernel must be called when substrate construction fails');
  });
});

// ============================================================================
// Layer 8: R4C-006 — Tenancy Mode Validation
// ============================================================================

describe('Layer 8: R4C-006 — tenancy mode validation', () => {

  // #23
  it('#23: invalid tenancy mode throws INVALID_CONFIG', async () => {
    // R4C-006: Defense-in-depth — reject invalid tenancy modes at config validation.
    // TypeScript prevents this at compile time, but JavaScript callers can bypass types.
    const config = {
      dataDir: trackDir(makeTempDir()),
      masterKey: makeKey(),
      tenancy: { mode: 'invalid-mode' as 'single' | 'multi' },
    };

    await assert.rejects(
      () => createLimen(config),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, 'INVALID_CONFIG',
          'R4C-006: Invalid tenancy mode must produce INVALID_CONFIG');
        assert.ok(err.message.includes('invalid-mode'),
          'R4C-006: Error message must include the invalid mode value');
        return true;
      },
    );
  });

  // #24
  it('#24: valid tenancy modes accepted', async () => {
    // R4C-006: 'single' and 'multi' must not be rejected.
    const dir1 = trackDir(makeTempDir());
    const limen1 = trackInstance(
      await createLimen({
        dataDir: dir1,
        masterKey: makeKey(),
        tenancy: { mode: 'single' },
      }),
    );
    assert.ok(limen1, 'tenancy.mode=single must be accepted');

    const dir2 = trackDir(makeTempDir());
    const limen2 = trackInstance(
      await createLimen({
        dataDir: dir2,
        masterKey: makeKey(),
        tenancy: { mode: 'multi', isolation: 'row-level' },
      }),
    );
    assert.ok(limen2, 'tenancy.mode=multi must be accepted');
  });
});
