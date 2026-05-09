// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Contract tests for EG-01: Consent Enforcement on Claim Assertion.
 * v3.0.0 Phase 2, Slice 2.1
 *
 * Verifies:
 *   - Consent check enforced during claim assertion when configured
 *   - Non-entity subjects bypass consent check
 *   - Backward compatible (consent.required=false default)
 *   - Revoked and expired consent blocks assertion
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
import type { SecurityPolicy } from '../../src/security/security_types.js';

// ── Helpers ──

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-consent-enforce-'));
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

/** Create a Limen instance with consent enforcement enabled */
async function createConsentEnforcedLimen(dir: string): Promise<Limen> {
  const security: SecurityPolicy = {
    pii: { enabled: false, action: 'tag', categories: [] },
    injection: { enabled: false, action: 'tag' },
    poisoning: { enabled: false, burstLimit: 1000, windowSeconds: 60, subjectDiversityMin: 1 },
    consent: { required: true, scope: 'claim_assertion' },
  };
  return createLimen({ dataDir: dir, masterKey: makeKey(), security });
}

describe('EG-01: Consent Enforcement on Claim Assertion', () => {
  it('DC-CONSENT-01 [SUCCESS]: assertion succeeds when consent active', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createConsentEnforcedLimen(dir));

    // Register consent for the entity
    const registerResult = limen.consent.register({
      dataSubjectId: 'user:alice',
      basis: 'explicit_consent',
      scope: 'claim_assertion',
    });
    assert.ok(registerResult.ok, `consent register should succeed: ${JSON.stringify(registerResult)}`);

    // Assert a claim about the entity — should succeed with active consent
    const result = limen.remember('entity:user:alice', 'knowledge.fact', 'Alice likes blue');
    assert.ok(result.ok, `assertion should succeed with active consent: ${JSON.stringify(result)}`);
  });

  it('DC-CONSENT-02 [REJECTION]: assertion fails when consent required but none registered', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createConsentEnforcedLimen(dir));

    // No consent registered — assertion should be rejected
    const result = limen.remember('entity:user:bob', 'knowledge.fact', 'Bob likes red');
    assert.ok(!result.ok, 'assertion should fail without consent');
    assert.equal(result.error?.code, 'CONSENT_REQUIRED', `error code should be CONSENT_REQUIRED, got: ${result.error?.code}`);
  });

  it('DC-CONSENT-03 [REJECTION]: assertion fails when consent revoked', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createConsentEnforcedLimen(dir));

    // Register then revoke consent
    const registerResult = limen.consent.register({
      dataSubjectId: 'user:charlie',
      basis: 'explicit_consent',
      scope: 'claim_assertion',
    });
    assert.ok(registerResult.ok, 'consent register should succeed');
    const consentId = registerResult.value!.id;

    const revokeResult = limen.consent.revoke(consentId);
    assert.ok(revokeResult.ok, 'consent revoke should succeed');

    // Assert a claim — should be rejected because consent is revoked
    const result = limen.remember('entity:user:charlie', 'knowledge.fact', 'Charlie likes green');
    assert.ok(!result.ok, 'assertion should fail with revoked consent');
    assert.equal(result.error?.code, 'CONSENT_REQUIRED', `error code should be CONSENT_REQUIRED, got: ${result.error?.code}`);
  });

  it('DC-CONSENT-04 [REJECTION]: assertion fails when consent expired', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createConsentEnforcedLimen(dir));

    // Register consent with an already-expired date
    const pastDate = new Date(Date.now() - 86_400_000).toISOString(); // yesterday
    const registerResult = limen.consent.register({
      dataSubjectId: 'user:diana',
      basis: 'explicit_consent',
      scope: 'claim_assertion',
      expiresAt: pastDate,
    });
    assert.ok(registerResult.ok, 'consent register should succeed (expiry computed on read)');

    // Assert a claim — should be rejected because consent is expired
    const result = limen.remember('entity:user:diana', 'knowledge.fact', 'Diana likes purple');
    assert.ok(!result.ok, 'assertion should fail with expired consent');
    assert.equal(result.error?.code, 'CONSENT_REQUIRED', `error code should be CONSENT_REQUIRED, got: ${result.error?.code}`);
  });

  it('DC-CONSENT-05 [SUCCESS]: consent.required=false bypasses check (backward compat)', async () => {
    const dir = trackDir(makeTempDir());
    // Default config — no consent enforcement
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // No consent registered — assertion should succeed because consent is not required
    const result = limen.remember('entity:user:eve', 'knowledge.fact', 'Eve likes yellow');
    assert.ok(result.ok, `assertion should succeed without consent when not required: ${JSON.stringify(result)}`);
  });

  it('DC-CONSENT-06 [SUCCESS]: non-entity subjects bypass consent check', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createConsentEnforcedLimen(dir));

    // No consent registered, but subject is not an entity URN — should bypass
    const result = limen.remember('decision:arch:auth-redesign', 'decision.rationale', 'Redesign for better security');
    assert.ok(result.ok, `non-entity subject should bypass consent check: ${JSON.stringify(result)}`);
  });
});
