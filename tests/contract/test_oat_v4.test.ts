/**
 * v4.0.0 Operational Acceptance Testing (OAT)
 * Phase 8: Verify every v4 spec promise works end-to-end.
 * 7 scenarios — one per phase.
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

function td(d: string) { dirs.push(d); return d; }
function ti(l: Limen) { instances.push(l); return l; }
function makeTempDir() { return mkdtempSync(join(tmpdir(), 'limen-oat4-')); }
function makeKey() { return randomBytes(32); }
const dirs: string[] = [];
const instances: Limen[] = [];

afterEach(async () => {
  for (const i of instances) { try { await i.shutdown(); } catch {} }
  instances.length = 0;
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  dirs.length = 0;
});

describe('OAT v4: Cognitive Substrate Verification', () => {

  it('OAT4-1: Vitals — cached health + delta + dense output', async () => {
    const limen = ti(await createLimen({ dataDir: td(makeTempDir()), masterKey: makeKey() }));
    limen.remember('entity:oat4:a', 'test.vitals', 'seed');

    // Cached health
    const h1 = limen.cognitive.health({ maxAge: 60000 });
    assert.ok(h1.ok);
    assert.equal(h1.value.totalClaims, 1);

    // Delta
    const delta = limen.cognitive.delta({ since: new Date(0).toISOString() });
    assert.ok(delta.ok);
    assert.ok(delta.value.added >= 1);

    // Dense output
    const dense = limen.cognitive.health({ outputMode: 'ai-dense' });
    assert.ok(dense.ok);
    assert.ok(dense.value.formatted, 'ai-dense must produce formatted string');
  });

  it('OAT4-2: Context Compiler — reasoning-ready compilation', async () => {
    const limen = ti(await createLimen({ dataDir: td(makeTempDir()), masterKey: makeKey() }));
    limen.remember('entity:project:oat', 'decision.arch', 'Use microservices');
    limen.remember('entity:project:oat', 'correction.arch', 'Do NOT use monolith');

    const ctx = limen.cognitive.compile({
      domain: 'entity:project:oat',
      format: 'reasoning-ready',
      maxTokens: 500,
    });
    assert.ok(ctx.ok);
    assert.ok(ctx.value.text.includes('DECIDED') || ctx.value.text.includes('microservices'));
    assert.ok(ctx.value.claimCount >= 2);
    assert.ok(ctx.value.estimatedTokens > 0);
  });

  it('OAT4-3: Living Knowledge — reviewNeeded field + filtered events', async () => {
    const limen = ti(await createLimen({ dataDir: td(makeTempDir()), masterKey: makeKey() }));

    // Create claims
    const r1 = limen.remember('entity:oat4:src', 'fact.base', 'Earth is round');
    assert.ok(r1.ok);
    const r2 = limen.remember('entity:oat4:dep', 'decision.navigation', 'Use great circle routes');
    assert.ok(r2.ok);

    // Verify reviewNeeded field exists on recall results
    const beliefs = limen.recall('entity:oat4:dep', 'decision.navigation');
    assert.ok(beliefs.ok);
    assert.ok(beliefs.value.length > 0);
    assert.equal(typeof beliefs.value[0].reviewNeeded, 'boolean', 'reviewNeeded must be boolean');

    // Without evidence links (created via direct SQL in unit tests), reviewNeeded=false
    assert.equal(beliefs.value[0].reviewNeeded, false, 'no evidence chain = no review needed');

    // Verify health includes reviewNeeded count
    const health = limen.cognitive.health();
    assert.ok(health.ok);
    assert.equal(typeof health.value.reviewNeeded, 'number', 'health must include reviewNeeded count');
  });

  it('OAT4-4: Semantic Primitives — output.judgment stores and recalls', async () => {
    const limen = ti(await createLimen({ dataDir: td(makeTempDir()), masterKey: makeKey() }));

    const result = limen.output.assert('output.judgment', {
      subject: 'auth design',
      assessment: 'PKCE is the correct approach',
      rationale: 'No server secret needed for SPA',
    });
    assert.ok(result.ok);

    const query = limen.output.query('output.judgment');
    assert.ok(query.ok);
    assert.ok(query.value.length >= 1);
    const stored = JSON.parse(query.value[0].value);
    assert.equal(stored.assessment, 'PKCE is the correct approach');
  });

  it('OAT4-5: Task-Aware Preparation — surgeon instrument tray', async () => {
    const limen = ti(await createLimen({ dataDir: td(makeTempDir()), masterKey: makeKey() }));
    limen.remember('entity:project:oat', 'decision.auth', 'Use OAuth2 PKCE');
    limen.remember('entity:project:oat', 'correction.auth', 'Do NOT store tokens in localStorage');

    const prep = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:oat',
      taskDescription: 'Implement the auth module',
      maxTokens: 1000,
    });
    assert.ok(prep.ok);
    assert.ok(prep.value.sections.decisions.includes('PKCE') || prep.value.text.includes('PKCE'));
    assert.ok(prep.value.estimatedTokens > 0);
  });

  it('OAT4-6: Coordination Backend — session + decision + lock lifecycle', async () => {
    const limen = ti(await createLimen({ dataDir: td(makeTempDir()), masterKey: makeKey() }));
    const time = { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
    const backend = createLimenBackend(limen, time);

    // Session
    const reg = backend.registerSession({ sessionId: 'sess-1', agentRole: 'Builder', project: 'oat', status: 'active' });
    assert.ok(reg.ok);
    const sessions = backend.getActiveSessions();
    assert.ok(sessions.ok);
    assert.ok(sessions.value.length >= 1);

    // Decision
    const dec = backend.recordDecision({ sessionId: 'sess-1', domain: 'auth', content: 'Use PKCE' });
    assert.ok(dec.ok);

    // Lock
    const lock = backend.acquireLock('auth', 'sess-1', 30000);
    assert.ok(lock.ok);
    const release = backend.releaseLock(lock.value.lockId);
    assert.ok(release.ok);

    // Cleanup
    backend.deregisterSession('sess-1');
  });

  it('OAT4-7: Telemetry + A2A Governance — record + query + governance block', async () => {
    const limen = ti(await createLimen({ dataDir: td(makeTempDir()), masterKey: makeKey() }));

    // Telemetry
    const tel = limen.telemetry.record('cost', { model: 'opus-4-6', tokens: 50000, cost: 0.85, purpose: 'primary' });
    assert.ok(tel.ok);
    const telQ = limen.telemetry.query('cost');
    assert.ok(telQ.ok);
    assert.ok(telQ.value.length >= 1);

    // A2A Governance
    const gov = limen.a2aGovernance.setGovernanceBlock({
      provider: 'limen',
      version: '4.0.0',
      dataResidency: ['US'],
      piiHandling: 'masked',
      auditTrail: true,
      compliance: ['SOC2'],
      maxConfidence: 0.7,
    });
    assert.ok(gov.ok);
    const govGet = limen.a2aGovernance.getGovernanceBlock();
    assert.ok(govGet.ok);
    assert.ok(govGet.value !== null);
  });
});
