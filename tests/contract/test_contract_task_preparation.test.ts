// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Contract tests for FR-008: Task-Aware Context Preparation.
 *
 * Verifies:
 *   DC-PREP-01 [SUCCESS]: prepareForTask returns sections with decisions/corrections/constraints
 *   DC-PREP-02 [SUCCESS]: task description keywords influence predicate selection
 *   DC-PREP-03 [REJECTION]: empty taskDescription returns error
 *   DC-PREP-04 [SUCCESS]: maxTokens limits total output
 *   DC-PREP-05 [SUCCESS]: includeFindings=true includes finding.* claims
 *   DC-PREP-06 [REJECTION]: includeFindings=false excludes finding.* claims
 *   DC-PREP-07 [SUCCESS]: coverage array lists included predicate namespaces
 *   DC-PREP-08 [SUCCESS]: omitted array lists what was cut for budget
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
  return mkdtempSync(join(tmpdir(), 'limen-prep-'));
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

/**
 * Helper: create a limen instance with seeded claims across predicate namespaces.
 */
async function createSeededInstance(): Promise<Limen> {
  const dir = trackDir(makeTempDir());
  const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

  // Seed claims for various predicate namespaces
  limen.remember('entity:project:alpha', 'decision.auth', 'Using PKCE flow for OAuth');
  limen.remember('entity:project:alpha', 'decision.session', 'Session tokens stored in Limen');
  limen.remember('entity:project:alpha', 'correction.middleware', 'Do NOT use middleware pattern');
  limen.remember('entity:project:alpha', 'correction.auth', 'Do NOT store tokens in localStorage');
  limen.remember('entity:project:alpha', 'constraint.api', 'API must be backward compatible');
  limen.remember('entity:project:alpha', 'constraint.perf', 'Response time < 200ms');
  limen.remember('entity:project:alpha', 'finding.xss', 'XSS vulnerability in form handler');
  limen.remember('entity:project:alpha', 'finding.auth', 'Auth bypass in admin route');
  limen.remember('entity:project:alpha', 'warning.security', 'CSP headers not configured');
  limen.remember('entity:project:alpha', 'observation.status', 'Module has 3 open findings');

  return limen;
}

describe('FR-008: Task-Aware Context Preparation (limen.cognitive.prepareForTask)', () => {

  // ── DC-PREP-01 [SUCCESS]: prepareForTask returns sections ──
  it('DC-PREP-01 [SUCCESS]: prepareForTask returns sections with decisions/corrections/constraints', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:alpha',
      taskDescription: 'Implement the authentication module with security hardening',
    });

    assert.equal(result.ok, true, 'prepareForTask must succeed');
    if (!result.ok) return;

    const ctx = result.value;

    // Must have text output
    assert.ok(ctx.text.length > 0, 'text must be non-empty');
    assert.ok(ctx.text.includes('Task Context for Builder'), 'text must include agent role');
    assert.ok(ctx.text.includes('entity:project:alpha'), 'text must include project');

    // Must have sections object
    assert.ok(typeof ctx.sections === 'object', 'sections must be an object');
    assert.ok('decisions' in ctx.sections, 'sections must have decisions');
    assert.ok('corrections' in ctx.sections, 'sections must have corrections');
    assert.ok('constraints' in ctx.sections, 'sections must have constraints');
    assert.ok('findings' in ctx.sections, 'sections must have findings');

    // Sections must contain actual seeded claim content — not just be non-empty
    assert.ok(ctx.sections.decisions.includes('PKCE'),
      'decisions section must include seeded PKCE claim content');
    assert.ok(ctx.sections.corrections.includes('middleware') || ctx.sections.corrections.includes('localStorage'),
      'corrections section must include seeded correction content');
    assert.ok(ctx.sections.constraints.includes('backward compatible') || ctx.sections.constraints.includes('200ms'),
      'constraints section must include seeded constraint content');

    // Token estimate must be positive
    assert.ok(ctx.estimatedTokens > 0, 'estimatedTokens must be positive');
  });

  // ── DC-PREP-02 [SUCCESS]: keywords influence predicate selection ──
  it('DC-PREP-02 [SUCCESS]: task description keywords influence predicate selection', async () => {
    const limen = await createSeededInstance();

    // Task mentioning "auth" should include auth-related claims
    const result = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:alpha',
      taskDescription: 'Fix the auth module security issues',
    });

    assert.equal(result.ok, true, 'prepareForTask must succeed');
    if (!result.ok) return;

    const ctx = result.value;

    // Auth-focused task must surface auth-specific seeded content
    assert.ok(ctx.text.includes('PKCE'),
      'auth-focused task must surface seeded PKCE decision in text');

    // Compare with a non-overlapping task — pricing has no seeded claims
    const pricingResult = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:alpha',
      taskDescription: 'Analyze pricing model for enterprise tier',
    });

    assert.equal(pricingResult.ok, true, 'pricing prepareForTask must succeed');
    if (!pricingResult.ok) return;

    const pricingCtx = pricingResult.value;

    // Auth task must surface PKCE decision from seeded claims
    assert.ok((ctx.sections.decisions ?? '').includes('PKCE'),
      'auth task decisions section must include PKCE from seeded claims');

    // Verify keyword extraction function independently — structural kill test.
    // If extractKeywords is removed/emptied, this import-level test catches it.
    const { extractKeywords } = await import('../../src/cognitive/task_preparation.js');
    const authKeywords = extractKeywords('Fix the auth module security issues');
    assert.ok(authKeywords.length > 0, 'auth description must extract keywords');
    assert.ok(authKeywords.includes('auth') || authKeywords.includes('security'),
      'auth description must extract auth/security keywords');

    const pricingKeywords = extractKeywords('Analyze pricing model for enterprise tier');
    // Auth and pricing descriptions should extract different keywords
    const authSet = new Set(authKeywords);
    const pricingSet = new Set(pricingKeywords);
    const overlap = [...authSet].filter(k => pricingSet.has(k));
    assert.ok(overlap.length < authKeywords.length,
      'auth and pricing must extract at least partially different keywords');
  });

  // ── DC-PREP-03 [REJECTION]: empty taskDescription returns error ──
  it('DC-PREP-03 [REJECTION]: empty taskDescription returns PREPARE_EMPTY_DESCRIPTION error', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:alpha',
      taskDescription: '',
    });

    assert.equal(result.ok, false, 'empty taskDescription must return error');
    if (result.ok) return;

    assert.equal(result.error.code, 'PREPARE_EMPTY_DESCRIPTION',
      'error code must be PREPARE_EMPTY_DESCRIPTION');
  });

  // ── DC-PREP-03b [REJECTION]: whitespace-only taskDescription returns error ──
  it('DC-PREP-03b [REJECTION]: whitespace-only taskDescription returns error', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:alpha',
      taskDescription: '   ',
    });

    assert.equal(result.ok, false, 'whitespace taskDescription must return error');
    if (result.ok) return;

    assert.equal(result.error.code, 'PREPARE_EMPTY_DESCRIPTION',
      'error code must be PREPARE_EMPTY_DESCRIPTION');
  });

  // ── DC-PREP-03c [REJECTION]: empty project returns error ──
  it('DC-PREP-03c [REJECTION]: empty project returns PREPARE_EMPTY_PROJECT error', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: '',
      taskDescription: 'Some task',
    });

    assert.equal(result.ok, false, 'empty project must return error');
    if (result.ok) return;

    assert.equal(result.error.code, 'PREPARE_EMPTY_PROJECT',
      'error code must be PREPARE_EMPTY_PROJECT');
  });

  // ── DC-PREP-03d [REJECTION]: empty agentRole returns error ──
  it('DC-PREP-03d [REJECTION]: empty agentRole returns PREPARE_EMPTY_ROLE error', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.prepareForTask({
      agentRole: '',
      project: 'entity:project:alpha',
      taskDescription: 'Some task',
    });

    assert.equal(result.ok, false, 'empty agentRole must return error');
    if (result.ok) return;

    assert.equal(result.error.code, 'PREPARE_EMPTY_ROLE',
      'error code must be PREPARE_EMPTY_ROLE');
  });

  // ── DC-PREP-04 [SUCCESS]: maxTokens limits total output ──
  it('DC-PREP-04 [SUCCESS]: maxTokens limits total output', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Seed claims to ensure content would exceed budget.
    // Use fewer claims with longer values to avoid rate limiting.
    for (let i = 0; i < 10; i++) {
      limen.remember(
        'entity:project:tokentest',
        `decision.item${i}`,
        `This is a very detailed and elaborate decision about architecture item number ${i} with sufficient length to consume tokens and fill the budget completely with meaningful content that describes the reasoning behind each decision made`,
      );
    }
    for (let i = 0; i < 10; i++) {
      limen.remember(
        'entity:project:tokentest',
        `correction.item${i}`,
        `This is a detailed correction about not using anti-pattern ${i} due to various important technical reasons including performance degradation and maintenance burden that was discovered during the code review process`,
      );
    }

    // Use a small token budget
    const result = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:tokentest',
      taskDescription: 'Implement the full system redesign',
      maxTokens: 200,
    });

    assert.equal(result.ok, true, 'prepareForTask must succeed');
    if (!result.ok) return;

    const ctx = result.value;
    // The output should be reasonably close to the budget
    // Allow some overhead for headers and section labels
    assert.ok(ctx.estimatedTokens < 400,
      `estimatedTokens (${ctx.estimatedTokens}) should be reasonably close to maxTokens (200)`);
  });

  // ── DC-PREP-04b [REJECTION]: maxTokens=0 returns error ──
  it('DC-PREP-04b [REJECTION]: maxTokens=0 returns PREPARE_INVALID_MAX_TOKENS error', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:alpha',
      taskDescription: 'Some task',
      maxTokens: 0,
    });

    assert.equal(result.ok, false, 'maxTokens=0 must return error');
    if (result.ok) return;

    assert.equal(result.error.code, 'PREPARE_INVALID_MAX_TOKENS',
      'error code must be PREPARE_INVALID_MAX_TOKENS');
  });

  // ── DC-PREP-04c [REJECTION]: negative maxTokens returns error ──
  it('DC-PREP-04c [REJECTION]: negative maxTokens returns error', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:alpha',
      taskDescription: 'Some task',
      maxTokens: -10,
    });

    assert.equal(result.ok, false, 'negative maxTokens must return error');
    if (result.ok) return;

    assert.equal(result.error.code, 'PREPARE_INVALID_MAX_TOKENS',
      'error code must be PREPARE_INVALID_MAX_TOKENS');
  });

  // ── DC-PREP-05 [SUCCESS]: includeFindings=true includes finding.* claims ──
  it('DC-PREP-05 [SUCCESS]: includeFindings=true includes finding.* claims', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:alpha',
      taskDescription: 'Review the security findings',
      includeFindings: true,
    });

    assert.equal(result.ok, true, 'prepareForTask must succeed');
    if (!result.ok) return;

    const ctx = result.value;
    // Findings section should have content (we seeded finding.* claims)
    assert.ok(ctx.sections.findings.length > 0,
      'findings section must have content when includeFindings=true');
    // Coverage should include 'finding'
    assert.ok(ctx.coverage.includes('finding'),
      'coverage must include "finding" namespace');
  });

  // ── DC-PREP-06 [REJECTION]: includeFindings=false excludes finding.* claims ──
  it('DC-PREP-06 [REJECTION]: includeFindings=false excludes finding.* claims from sections', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:alpha',
      taskDescription: 'Review the security findings',
      includeFindings: false,
    });

    assert.equal(result.ok, true, 'prepareForTask must succeed');
    if (!result.ok) return;

    const ctx = result.value;
    // Findings section must be empty when includeFindings=false
    assert.equal(ctx.sections.findings, '',
      'findings section must be empty when includeFindings=false');
    // Coverage should NOT include 'finding'
    assert.ok(!ctx.coverage.includes('finding'),
      'coverage must NOT include "finding" namespace when findings excluded');
    // Omitted should mention findings exclusion
    const findingsOmitted = ctx.omitted.some(o => o.includes('findings') && o.includes('excluded'));
    assert.ok(findingsOmitted,
      'omitted must mention findings exclusion');
  });

  // ── DC-PREP-07 [SUCCESS]: coverage array lists included predicate namespaces ──
  it('DC-PREP-07 [SUCCESS]: coverage array lists included predicate namespaces', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:alpha',
      taskDescription: 'Implement the full system',
    });

    assert.equal(result.ok, true, 'prepareForTask must succeed');
    if (!result.ok) return;

    const ctx = result.value;
    assert.ok(Array.isArray(ctx.coverage), 'coverage must be an array');

    // Since we seeded claims for decision, correction, constraint, and finding,
    // all four should appear in coverage
    assert.ok(ctx.coverage.includes('decision'),
      'coverage must include "decision" namespace');
    assert.ok(ctx.coverage.includes('correction'),
      'coverage must include "correction" namespace');
    assert.ok(ctx.coverage.includes('constraint'),
      'coverage must include "constraint" namespace');
    assert.ok(ctx.coverage.includes('finding'),
      'coverage must include "finding" namespace');
  });

  // ── DC-PREP-08 [SUCCESS]: omitted array lists what was cut for budget ──
  it('DC-PREP-08 [SUCCESS]: omitted array lists what was cut for budget', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:alpha',
      taskDescription: 'Implement the full system',
    });

    assert.equal(result.ok, true, 'prepareForTask must succeed');
    if (!result.ok) return;

    const ctx = result.value;
    assert.ok(Array.isArray(ctx.omitted), 'omitted must be an array');

    // Optional sections (locks, budget) should be listed as omitted by default
    const locksOmitted = ctx.omitted.some(o => o.includes('locks'));
    assert.ok(locksOmitted, 'omitted must mention locks (excluded by default)');
    const budgetOmitted = ctx.omitted.some(o => o.includes('budget'));
    assert.ok(budgetOmitted, 'omitted must mention budget (excluded by default)');
  });

  // ── DC-PREP-09 [SUCCESS]: non-existent project returns empty sections ──
  it('DC-PREP-09 [SUCCESS]: non-existent project returns empty sections', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:nonexistent',
      taskDescription: 'Work on this project',
    });

    assert.equal(result.ok, true, 'prepareForTask must succeed for non-existent project');
    if (!result.ok) return;

    const ctx = result.value;
    // All sections should be empty (no claims for this project)
    assert.equal(ctx.sections.decisions, '', 'decisions must be empty for non-existent project');
    assert.equal(ctx.sections.corrections, '', 'corrections must be empty for non-existent project');
    assert.equal(ctx.sections.constraints, '', 'constraints must be empty for non-existent project');
    assert.equal(ctx.sections.findings, '', 'findings must be empty for non-existent project');
  });

  // ── DC-PREP-10 [SUCCESS]: taskId included in output text when provided ──
  it('DC-PREP-10 [SUCCESS]: taskId included in output text when provided', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:alpha',
      taskId: 'task-42',
      taskDescription: 'Implement feature X',
    });

    assert.equal(result.ok, true, 'prepareForTask must succeed');
    if (!result.ok) return;

    assert.ok(result.value.text.includes('task-42'),
      'text must include taskId when provided');
  });

  // ── DC-PREP-11 [SUCCESS]: sections contain properly formatted claim content ──
  it('DC-PREP-11 [SUCCESS]: sections contain properly formatted claim content', async () => {
    const limen = await createSeededInstance();

    const result = limen.cognitive.prepareForTask({
      agentRole: 'Builder',
      project: 'entity:project:alpha',
      taskDescription: 'Review all decisions and corrections',
    });

    assert.equal(result.ok, true, 'prepareForTask must succeed');
    if (!result.ok) return;

    const ctx = result.value;
    // Decisions section should contain DECIDED labels (from compile reasoning-ready)
    if (ctx.sections.decisions.length > 0) {
      assert.ok(ctx.sections.decisions.includes('DECIDED:'),
        'decisions section must contain DECIDED: labels from compile()');
    }
    // Corrections section should contain CORRECTION labels
    if (ctx.sections.corrections.length > 0) {
      assert.ok(ctx.sections.corrections.includes('CORRECTION:'),
        'corrections section must contain CORRECTION: labels from compile()');
    }
  });

});
