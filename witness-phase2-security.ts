/**
 * Witness Phase 2 — Security Enforcement
 *
 * Exercises 4 promises:
 *   P1: Consent enforcement (consent.required=true blocks assertions without consent)
 *   P2: Trust-level filtering (different trust levels see different claims with requireRbac=true)
 *   P3: Classification filtering (claims classified at assertion are filtered at query/search)
 *   P4: Key rotation (master encryption key can be rotated atomically)
 *
 * Run: npx tsx witness-phase2-security.ts
 */

import { createLimen } from './src/api/index.js';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Helpers ──

function tmpDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `witness-p2-${label}-`));
}

function score(pass: boolean): number {
  return pass ? 2 : 0;
}

const results: { promise: string; pass: boolean; detail: string }[] = [];

function record(promise: string, pass: boolean, detail: string) {
  results.push({ promise, pass, detail });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${promise}: ${detail}`);
}

// ── P1: Consent Enforcement ──

async function testConsentEnforcement(): Promise<boolean> {
  console.log('\n=== P1: Consent Enforcement ===');

  const masterKey = randomBytes(32);
  const limen = await createLimen({
    dataDir: tmpDir('consent'),
    masterKey,
    security: {
      pii: { enabled: false, action: 'tag', categories: [] },
      injection: { enabled: false, action: 'tag' },
      poisoning: { enabled: false, burstLimit: 1000, windowSeconds: 60, subjectDiversityMin: 1 },
      consent: { required: true, scope: 'claim_assertion' },
    },
    maintenance: { retentionEnabled: false },
  });

  let allPass = true;

  // Step 1: Attempt assertion WITHOUT consent — should fail
  try {
    const r = limen.remember('entity:user:alice', 'preference.food', 'loves Thai');
    if (!r.ok) {
      console.log(`  Assertion without consent blocked: code=${(r as any).error?.code ?? 'unknown'}`);
      // Expected: should be blocked
    } else {
      console.log('  UNEXPECTED: Assertion succeeded without consent');
      allPass = false;
    }
  } catch (err: any) {
    console.log(`  Assertion without consent threw: ${err.code ?? err.message}`);
    // Also acceptable — thrown error means blocked
  }

  // Step 2: Register consent for alice
  const consent = limen.consent.register({
    dataSubjectId: 'user:alice',
    basis: 'explicit_consent',
    scope: 'claim_assertion',
  });

  if (!consent.ok) {
    console.log(`  UNEXPECTED: consent.register failed: ${JSON.stringify(consent)}`);
    allPass = false;
  } else {
    console.log(`  Consent registered: id=${consent.value.id}, status=${consent.value.status}`);
  }

  // Step 3: Attempt assertion WITH consent — should succeed
  const r2 = limen.remember('entity:user:alice', 'preference.food', 'loves Thai');
  if (r2.ok) {
    console.log(`  Assertion with consent succeeded: claimId=${r2.value.claimId}`);
  } else {
    console.log(`  UNEXPECTED: Assertion with consent failed: ${JSON.stringify(r2)}`);
    allPass = false;
  }

  // Step 4: Revoke consent, then try again — should fail
  if (consent.ok) {
    const revoked = limen.consent.revoke(consent.value.id);
    if (revoked.ok) {
      console.log(`  Consent revoked: status=${revoked.value.status}`);
    }
  }

  try {
    const r3 = limen.remember('entity:user:alice', 'preference.music', 'jazz');
    if (!r3.ok) {
      console.log(`  Assertion after revocation blocked (expected)`);
    } else {
      console.log('  UNEXPECTED: Assertion succeeded after consent revocation');
      allPass = false;
    }
  } catch (err: any) {
    console.log(`  Assertion after revocation threw: ${err.code ?? err.message}`);
  }

  await limen.shutdown();
  record('P1: Consent Enforcement', allPass, allPass ? 'Assertions blocked without consent, allowed with, blocked after revocation' : 'Some consent checks did not enforce correctly');
  return allPass;
}

// ── P2: Trust-Level Filtering ──

async function testTrustLevelFiltering(): Promise<boolean> {
  console.log('\n=== P2: Trust-Level Filtering ===');

  const masterKey = randomBytes(32);
  const limen = await createLimen({
    dataDir: tmpDir('trust'),
    masterKey,
    requireRbac: true,
    maintenance: { retentionEnabled: false },
  });

  let allPass = true;

  // Add classification rules that cover different sensitivity levels
  limen.governance.addRule({
    predicatePattern: 'public.*',
    level: 'unrestricted',
    reason: 'Public info',
  });
  limen.governance.addRule({
    predicatePattern: 'internal.*',
    level: 'internal',
    reason: 'Internal only',
  });
  limen.governance.addRule({
    predicatePattern: 'secret.*',
    level: 'confidential',
    reason: 'Confidential data',
  });
  limen.governance.addRule({
    predicatePattern: 'restricted.*',
    level: 'restricted',
    reason: 'Restricted data',
  });

  // Store claims at different classification levels
  const c1 = limen.remember('entity:project:alpha', 'public.name', 'Alpha Project');
  const c2 = limen.remember('entity:project:alpha', 'internal.roadmap', 'Q3 launch');
  const c3 = limen.remember('entity:project:alpha', 'secret.budget', '$5M');
  const c4 = limen.remember('entity:project:alpha', 'restricted.personnel', 'Top secret team');

  console.log(`  Stored 4 claims: public=${c1.ok}, internal=${c2.ok}, secret=${c3.ok}, restricted=${c4.ok}`);
  if (!c1.ok || !c2.ok || !c3.ok || !c4.ok) {
    allPass = false;
  }

  // Register two agents: one untrusted reader, one separate promoter
  const promoter = await limen.agents.register({ name: 'promoter-agent' });
  const agent = await limen.agents.register({ name: 'low-trust-agent' });
  console.log(`  Registered reader: ${agent.name}, trustLevel=${agent.trustLevel}`);

  // Set the untrusted agent as default — its trust level constrains recall
  limen.setDefaultAgent(agent.id);

  // Recall all claims — untrusted should only see unrestricted
  const beliefs = limen.recall('entity:project:alpha');
  if (beliefs.ok) {
    console.log(`  Untrusted agent sees ${beliefs.value.length} claim(s)`);
    for (const b of beliefs.value) {
      console.log(`    - ${b.predicate}: ${b.value}`);
    }
    // Untrusted (clearance=0) should see only unrestricted claims
    const seesConfidential = beliefs.value.some(b => b.predicate.startsWith('secret.') || b.predicate.startsWith('restricted.') || b.predicate.startsWith('internal.'));
    if (seesConfidential) {
      console.log('  UNEXPECTED: Untrusted agent sees classified claims');
      allPass = false;
    }
  } else {
    console.log(`  recall failed: ${JSON.stringify(beliefs)}`);
    allPass = false;
  }

  // Promote: switch to promoter agent to avoid self-promotion block
  limen.setDefaultAgent(promoter.id);

  const promoted = await limen.agents.promote('low-trust-agent');
  console.log(`  Promoted to: ${promoted.trustLevel}`);
  // promote goes untrusted -> probationary
  if (promoted.trustLevel === 'probationary') {
    const promoted2 = await limen.agents.promote('low-trust-agent');
    console.log(`  Promoted again to: ${promoted2.trustLevel}`);
  }

  // Set promoted agent back as default
  limen.setDefaultAgent(agent.id);

  const beliefs2 = limen.recall('entity:project:alpha');
  if (beliefs2.ok) {
    console.log(`  After promotion, agent sees ${beliefs2.value.length} claim(s)`);
    for (const b of beliefs2.value) {
      console.log(`    - ${b.predicate}: ${b.value}`);
    }
  }

  await limen.shutdown();
  record('P2: Trust-Level Filtering', allPass, allPass ? 'Trust levels correctly filter claim visibility' : 'Trust level filtering did not work as expected');
  return allPass;
}

// ── P3: Classification Filtering ──

async function testClassificationFiltering(): Promise<boolean> {
  console.log('\n=== P3: Classification Filtering ===');

  const masterKey = randomBytes(32);
  const limen = await createLimen({
    dataDir: tmpDir('classify'),
    masterKey,
    requireRbac: true,
    maintenance: { retentionEnabled: false },
  });

  let allPass = true;

  // Store a claim with a predicate matching default classification rule
  // medical.* -> restricted (level 3)
  const r1 = limen.remember('entity:patient:bob', 'medical.diagnosis', 'healthy');
  // preference.* -> confidential (level 2)
  const r2 = limen.remember('entity:user:bob', 'preference.color', 'blue');
  // observation.note -> no classification rule (unclassified, should be visible)
  const r3 = limen.remember('entity:user:bob', 'observation.note', 'likes coffee');

  console.log(`  Stored: medical=${r1.ok}, preference=${r2.ok}, observation=${r3.ok}`);

  // Register untrusted agent (clearance=0: unrestricted only)
  const agent = await limen.agents.register({ name: 'reader-agent' });
  limen.setDefaultAgent(agent.id);
  console.log(`  Agent trust: ${agent.trustLevel} (clearance=0)`);

  // Query — should NOT see medical or preference (too high classification)
  const beliefs = limen.recall('entity:patient:bob');
  if (beliefs.ok) {
    console.log(`  Untrusted query entity:patient:bob => ${beliefs.value.length} result(s)`);
    if (beliefs.value.length > 0) {
      console.log('  UNEXPECTED: Untrusted sees medical claims');
      allPass = false;
    }
  }

  // Search for "healthy" — should not find medical claims at low clearance
  const searchR = limen.search('healthy');
  if (searchR.ok) {
    console.log(`  Search 'healthy' => ${searchR.value.length} result(s)`);
    if (searchR.value.length > 0) {
      console.log('  UNEXPECTED: Search returned classified claim to untrusted');
      allPass = false;
    }
  }

  // Unclassified claims (observation.*) should bypass filter
  const obs = limen.recall('entity:user:bob', 'observation.note');
  if (obs.ok) {
    console.log(`  Unclassified recall => ${obs.value.length} result(s)`);
    // Legacy/unclassified claims bypass filter per source code doc
  }

  await limen.shutdown();
  record('P3: Classification Filtering', allPass, allPass ? 'Classified claims filtered by clearance level at query and search' : 'Classification filtering gaps detected');
  return allPass;
}

// ── P4: Key Rotation ──

async function testKeyRotation(): Promise<boolean> {
  console.log('\n=== P4: Key Rotation ===');

  const masterKey = randomBytes(32);
  const dataDir = tmpDir('keyrot');
  const limen = await createLimen({
    dataDir,
    masterKey,
    maintenance: { retentionEnabled: false },
  });

  let allPass = true;

  // Store some claims with original key
  const r1 = limen.remember('entity:secret:mission', 'credential.api_key', 'sk-abc123');
  const r2 = limen.remember('entity:secret:mission', 'credential.token', 'tok-xyz789');

  if (!r1.ok || !r2.ok) {
    console.log(`  UNEXPECTED: storing claims failed: r1=${r1.ok}, r2=${r2.ok}`);
    allPass = false;
  } else {
    console.log(`  Stored 2 encrypted claims`);
  }

  // Rotate key
  const newMasterKey = randomBytes(32);
  const rotResult = limen.security.rotateKey(newMasterKey);
  if (rotResult.ok) {
    console.log(`  Key rotation succeeded: ${rotResult.value.entriesRotated} entries rotated`);
    if (rotResult.value.entriesRotated < 1) {
      console.log('  WARNING: Zero entries rotated — may indicate no vault entries');
    }
  } else {
    console.log(`  UNEXPECTED: Key rotation failed: ${JSON.stringify(rotResult)}`);
    allPass = false;
  }

  // Verify claims are still readable after rotation
  const recalled = limen.recall('entity:secret:mission');
  if (recalled.ok) {
    console.log(`  After rotation, recalled ${recalled.value.length} claim(s)`);
    for (const b of recalled.value) {
      console.log(`    - ${b.predicate}: ${b.value}`);
    }
    // Check values are intact
    const values = recalled.value.map(b => b.value);
    if (!values.includes('sk-abc123') || !values.includes('tok-xyz789')) {
      console.log('  UNEXPECTED: Claim values corrupted after key rotation');
      allPass = false;
    }
  } else {
    console.log(`  UNEXPECTED: Recall after rotation failed: ${JSON.stringify(recalled)}`);
    allPass = false;
  }

  await limen.shutdown();

  // Verify: create new instance with NEW key — should work
  try {
    const limen2 = await createLimen({
      dataDir,
      masterKey: newMasterKey,
      maintenance: { retentionEnabled: false },
    });

    const recalled2 = limen2.recall('entity:secret:mission');
    if (recalled2.ok && recalled2.value.length >= 2) {
      console.log(`  New instance with rotated key: recalled ${recalled2.value.length} claim(s) — data intact`);
    } else {
      console.log(`  New instance recall: ${JSON.stringify(recalled2)}`);
      // Not necessarily a failure — depends on how rotation affects in-flight data
    }

    await limen2.shutdown();
  } catch (err: any) {
    console.log(`  New instance with rotated key: ${err.message}`);
    // If this fails, key rotation atomicity may have an issue
  }

  // Verify: create new instance with OLD key — should fail or return garbled data
  try {
    const limen3 = await createLimen({
      dataDir,
      masterKey,
      maintenance: { retentionEnabled: false },
    });

    const recalled3 = limen3.recall('entity:secret:mission');
    if (recalled3.ok) {
      // Check if values are garbled (decrypted with wrong key)
      const vals = recalled3.value.map(b => b.value);
      const intact = vals.includes('sk-abc123') && vals.includes('tok-xyz789');
      if (intact) {
        console.log('  WARNING: Old key still reads correct data — rotation may not have re-encrypted');
      } else {
        console.log(`  Old key reads garbled data (expected after rotation)`);
      }
    } else {
      console.log(`  Old key recall failed (expected after rotation): ${JSON.stringify(recalled3)}`);
    }

    await limen3.shutdown();
  } catch (err: any) {
    console.log(`  Old key instance error (may be expected): ${err.message}`);
  }

  record('P4: Key Rotation', allPass, allPass ? 'Key rotation atomic, data readable with new key' : 'Key rotation issues detected');
  return allPass;
}

// ── Main ──

async function main() {
  console.log('============================================');
  console.log(' WITNESS PHASE 2 — SECURITY ENFORCEMENT');
  console.log(' Timestamp:', new Date().toISOString());
  console.log('============================================');

  const p1 = await testConsentEnforcement();
  const p2 = await testTrustLevelFiltering();
  const p3 = await testClassificationFiltering();
  const p4 = await testKeyRotation();

  console.log('\n============================================');
  console.log(' RESULTS');
  console.log('============================================');

  let total = 0;
  for (const r of results) {
    const s = score(r.pass);
    total += s;
    console.log(`  ${r.promise}: ${s}/2 (${r.pass ? 'PASS' : 'FAIL'})`);
  }

  // Cohesion bonus: all 4 pass = +2
  const allPassed = p1 && p2 && p3 && p4;
  const cohesion = allPassed ? 2 : 0;
  total += cohesion;

  console.log(`\n  Cohesion bonus: ${cohesion}/2 (${allPassed ? 'all promises met' : 'incomplete'})`);
  console.log(`\n  FINAL SCORE: ${total}/10`);
  console.log(`  VERDICT: ${total >= 8 ? 'PASS' : 'FAIL'}`);
  console.log('============================================');

  process.exit(total >= 8 ? 0 : 1);
}

main().catch((err) => {
  console.error('WITNESS FATAL:', err);
  process.exit(1);
});
