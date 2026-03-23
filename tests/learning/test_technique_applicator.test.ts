/**
 * Limen — TechniqueApplicator Unit Tests
 * Phase 4E-2c: Supplementary tests beyond contract tests (#15-#18, #50)
 *
 * Each test has a CATCHES comment explaining what it discriminatively tests.
 * These tests verify engineering decisions and edge cases not covered
 * by the contract tests.
 *
 * S ref: S29.4, S29.2, S29.6, I-07, R-06, R-07
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLearningSystem } from '../../src/learning/harness/learning_harness.js';
import { createTestDatabase, createTestOperationContext, createTestAuditTrail, tenantId, agentId } from '../helpers/test_database.js';
import { INITIAL_CONFIDENCE_EXTRACTED } from '../../src/learning/interfaces/index.js';
import type {
  LearningSystem,
  TechniqueId,
  TechniqueCreateInput,
  TechniqueApplication,
} from '../../src/learning/interfaces/index.js';
import type { DatabaseConnection, OperationContext, EventBus, RbacEngine, RateLimiter } from '../../src/kernel/interfaces/index.js';
import type { LlmGateway } from '../../src/substrate/interfaces/substrate.js';

// ─── Test Setup ───

function createTestLearningSystem(): { ls: LearningSystem; conn: DatabaseConnection; ctx: OperationContext } {
  const conn = createTestDatabase();
  const ctx = createTestOperationContext();
  const ls = createLearningSystem({
    getConnection: () => conn,
    audit: createTestAuditTrail(),
    events: {} as EventBus,
    rbac: {} as RbacEngine,
    rateLimiter: {} as RateLimiter,
    gateway: {} as LlmGateway,
    time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
  });
  return { ls, conn, ctx };
}

const TEST_TENANT = tenantId('test-tenant');
const TEST_AGENT = agentId('test-agent');

function techniqueId(id: string): TechniqueId {
  return id as TechniqueId;
}

function createValidInput(): TechniqueCreateInput {
  return {
    tenantId: TEST_TENANT,
    agentId: TEST_AGENT,
    type: 'prompt_fragment',
    content: 'When discussing pricing, always mention the annual discount option first.',
    sourceMemoryIds: ['mem-001', 'mem-002'],
    initialConfidence: INITIAL_CONFIDENCE_EXTRACTED,
  };
}

// ─── getActivePromptFragments: Edge Cases ───

describe('TechniqueApplicator — Edge Cases (Phase 4E-2c)', () => {

  it('empty technique list returns empty, no error', () => {
    // CATCHES: implementation that throws or returns error on zero techniques
    const { ls, conn } = createTestLearningSystem();
    const result = ls.applicator.getActivePromptFragments(conn, TEST_AGENT, TEST_TENANT, 10000);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 0);
  });

  it('all techniques exceed context window returns empty applied set', () => {
    // CATCHES: implementation that includes oversized techniques, or that errors
    // when no technique fits the budget
    const { ls, conn, ctx } = createTestLearningSystem();
    // Create 3 techniques each ~500 chars = ~125 tokens
    for (let i = 0; i < 3; i++) {
      ls.store.create(conn, ctx, {
        ...createValidInput(),
        content: 'X'.repeat(500),
      });
    }

    // Budget of 10 tokens — none of the ~125-token techniques fit
    const result = ls.applicator.getActivePromptFragments(conn, TEST_AGENT, TEST_TENANT, 10);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 0, 'no techniques should fit in budget of 10');
  });

  it('single technique exactly at budget boundary is included', () => {
    // CATCHES: off-by-one error in budget comparison (< vs <=)
    // Content length 400 → Math.ceil(400/4) = 100 tokens. Budget = 100.
    const { ls, conn, ctx } = createTestLearningSystem();
    ls.store.create(conn, ctx, {
      ...createValidInput(),
      content: 'A'.repeat(400), // exactly 100 estimated tokens
    });

    const result = ls.applicator.getActivePromptFragments(conn, TEST_AGENT, TEST_TENANT, 100);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 1, 'technique at exact budget should be included');
  });

  it('single technique at budget + 1 token is excluded', () => {
    // CATCHES: off-by-one allowing techniques that exceed budget by 1
    // Content length 404 → Math.ceil(404/4) = 101 tokens. Budget = 100.
    const { ls, conn, ctx } = createTestLearningSystem();
    ls.store.create(conn, ctx, {
      ...createValidInput(),
      content: 'A'.repeat(404), // 101 estimated tokens
    });

    const result = ls.applicator.getActivePromptFragments(conn, TEST_AGENT, TEST_TENANT, 100);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 0, 'technique exceeding budget by 1 token must be excluded');
  });

  it('two techniques with identical confidence have stable ordering', () => {
    // CATCHES: non-deterministic sort that produces different orders across calls
    // with identical data. Unstable ordering makes debugging impossible.
    const { ls, conn, ctx } = createTestLearningSystem();

    const t1 = ls.store.create(conn, ctx, { ...createValidInput(), content: 'Alpha technique' });
    const t2 = ls.store.create(conn, ctx, { ...createValidInput(), content: 'Beta technique' });

    if (t1.ok) ls.store.update(conn, ctx, t1.value.id, TEST_TENANT, { confidence: 0.7 });
    if (t2.ok) ls.store.update(conn, ctx, t2.value.id, TEST_TENANT, { confidence: 0.7 });

    const result1 = ls.applicator.getActivePromptFragments(conn, TEST_AGENT, TEST_TENANT, 10000);
    const result2 = ls.applicator.getActivePromptFragments(conn, TEST_AGENT, TEST_TENANT, 10000);

    assert.strictEqual(result1.ok, true);
    assert.strictEqual(result2.ok, true);
    if (!result1.ok || !result2.ok) return;

    assert.strictEqual(result1.value.length, result2.value.length,
      'same data must produce same length');
    for (let i = 0; i < result1.value.length; i++) {
      assert.strictEqual(result1.value[i].id, result2.value[i].id,
        `order must be deterministic at position ${i}`);
    }
  });

  it('mixed types in store: prompt fragment query returns zero decision rules', () => {
    // CATCHES: missing type filter in SQL query — would return all active
    // techniques regardless of type
    const { ls, conn, ctx } = createTestLearningSystem();

    ls.store.create(conn, ctx, { ...createValidInput(), type: 'prompt_fragment', content: 'Fragment A' });
    ls.store.create(conn, ctx, { ...createValidInput(), type: 'decision_rule', content: 'Rule B' });
    ls.store.create(conn, ctx, { ...createValidInput(), type: 'rag_pattern', content: 'Pattern C' });

    const fragments = ls.applicator.getActivePromptFragments(conn, TEST_AGENT, TEST_TENANT, 10000);
    const rules = ls.applicator.getActiveDecisionRules(conn, TEST_AGENT, TEST_TENANT);
    const patterns = ls.applicator.getActiveRagPatterns(conn, TEST_AGENT, TEST_TENANT);

    assert.strictEqual(fragments.ok, true);
    assert.strictEqual(rules.ok, true);
    assert.strictEqual(patterns.ok, true);
    if (!fragments.ok || !rules.ok || !patterns.ok) return;

    assert.strictEqual(fragments.value.length, 1, 'only prompt_fragment returned');
    assert.strictEqual(fragments.value[0].content, 'Fragment A');
    assert.strictEqual(rules.value.length, 1, 'only decision_rule returned');
    assert.strictEqual(rules.value[0].content, 'Rule B');
    assert.strictEqual(patterns.value.length, 1, 'only rag_pattern returned');
    assert.strictEqual(patterns.value[0].content, 'Pattern C');
  });

  it('getActiveDecisionRules returns confidence-descending order', () => {
    // CATCHES: ordering applied only to prompt fragments, not to other types
    const { ls, conn, ctx } = createTestLearningSystem();

    const t1 = ls.store.create(conn, ctx, { ...createValidInput(), type: 'decision_rule', content: 'Low rule' });
    const t2 = ls.store.create(conn, ctx, { ...createValidInput(), type: 'decision_rule', content: 'High rule' });

    if (t1.ok) ls.store.update(conn, ctx, t1.value.id, TEST_TENANT, { confidence: 0.3 });
    if (t2.ok) ls.store.update(conn, ctx, t2.value.id, TEST_TENANT, { confidence: 0.9 });

    const result = ls.applicator.getActiveDecisionRules(conn, TEST_AGENT, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 2);
    assert.ok(result.value[0].confidence >= result.value[1].confidence,
      'decision rules must also be confidence-descending');
  });

  it('getActiveRagPatterns excludes suspended techniques', () => {
    // CATCHES: status filtering missing on rag_pattern queries
    const { ls, conn, ctx } = createTestLearningSystem();

    ls.store.create(conn, ctx, { ...createValidInput(), type: 'rag_pattern', content: 'Active pattern' });
    const suspended = ls.store.create(conn, ctx, { ...createValidInput(), type: 'rag_pattern', content: 'Suspended pattern' });

    if (suspended.ok) ls.store.suspend(conn, ctx, suspended.value.id, TEST_TENANT);

    const result = ls.applicator.getActiveRagPatterns(conn, TEST_AGENT, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 1, 'only active patterns returned');
    assert.strictEqual(result.value[0].content, 'Active pattern');
  });
});

// ─── recordApplications: R-06 Side Effects ───

describe('TechniqueApplicator — recordApplications R-06 (Phase 4E-2c)', () => {

  it('recordApplications increments applicationCount for applied=true (R-06)', () => {
    // CATCHES: implementation that writes application record but does NOT
    // increment technique applicationCount. Without this, retirement
    // thresholds (S29.6 "over 50+ applications") never trigger.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;
    assert.strictEqual(createResult.value.applicationCount, 0, 'starts at 0');

    const applications: TechniqueApplication[] = [{
      techniqueId: tid,
      interactionId: 'int-100',
      tenantId: TEST_TENANT,
      timestamp: new Date().toISOString(),
      applied: true,
    }];

    const result = ls.applicator.recordApplications(conn, ctx, applications);
    assert.strictEqual(result.ok, true);

    // Verify applicationCount incremented
    const updated = ls.store.get(conn, tid, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(updated.ok, true);
    if (!updated.ok) return;
    assert.strictEqual(updated.value.applicationCount, 1,
      'applicationCount must be incremented for applied=true');
  });

  it('recordApplications updates lastApplied for applied=true (R-06)', () => {
    // CATCHES: implementation that increments count but forgets lastApplied.
    // Without lastApplied, staleness retirement ("not applied in 90 days",
    // S29.6) is broken.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;
    assert.strictEqual(createResult.value.lastApplied, null, 'starts as null');

    const appTimestamp = new Date().toISOString();
    const applications: TechniqueApplication[] = [{
      techniqueId: tid,
      interactionId: 'int-101',
      tenantId: TEST_TENANT,
      timestamp: appTimestamp,
      applied: true,
    }];

    ls.applicator.recordApplications(conn, ctx, applications);

    const updated = ls.store.get(conn, tid, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(updated.ok, true);
    if (!updated.ok) return;
    assert.strictEqual(updated.value.lastApplied, appTimestamp,
      'lastApplied must be set to application timestamp');
  });

  it('recordApplications does NOT increment for applied=false', () => {
    // CATCHES: implementation that increments applicationCount for ALL
    // applications, including skipped ones. Skipped techniques (applied=false)
    // should not count toward retirement thresholds.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;

    const applications: TechniqueApplication[] = [{
      techniqueId: tid,
      interactionId: 'int-102',
      tenantId: TEST_TENANT,
      timestamp: new Date().toISOString(),
      applied: false,
    }];

    ls.applicator.recordApplications(conn, ctx, applications);

    const updated = ls.store.get(conn, tid, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(updated.ok, true);
    if (!updated.ok) return;
    assert.strictEqual(updated.value.applicationCount, 0,
      'applicationCount must NOT increment for applied=false');
    assert.strictEqual(updated.value.lastApplied, null,
      'lastApplied must remain null for applied=false');
  });

  it('recordApplications with applied=false writes record with correct flag', () => {
    // CATCHES: implementation that discards applied=false records.
    // The application log must record ALL application events, including
    // skipped techniques, for audit completeness (I-03).
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;
    const applications: TechniqueApplication[] = [{
      techniqueId: tid,
      interactionId: 'int-103',
      tenantId: TEST_TENANT,
      timestamp: new Date().toISOString(),
      applied: false,
    }];

    ls.applicator.recordApplications(conn, ctx, applications);

    // Query the learning_applications table directly
    const record = conn.get<{ technique_id: string; applied: number }>(
      'SELECT technique_id, applied FROM learning_applications WHERE technique_id = ? AND tenant_id = ?',
      [tid, TEST_TENANT],
    );
    assert.ok(record, 'application record must exist even for applied=false');
    assert.strictEqual(record.applied, 0, 'applied flag must be 0 (false) for skipped techniques');
  });

  it('recordApplications handles phantom technique IDs gracefully (R-07)', () => {
    // CATCHES: implementation that validates technique existence via FK or
    // explicit check before INSERT, causing phantom IDs to fail.
    // R-07: No FK. Phantom IDs are acceptable.
    const { ls, conn, ctx } = createTestLearningSystem();

    const applications: TechniqueApplication[] = [
      {
        techniqueId: techniqueId('phantom-001'),
        interactionId: 'int-104',
        tenantId: TEST_TENANT,
        timestamp: new Date().toISOString(),
        applied: true,
      },
      {
        techniqueId: techniqueId('phantom-002'),
        interactionId: 'int-104',
        tenantId: TEST_TENANT,
        timestamp: new Date().toISOString(),
        applied: false,
      },
    ];

    const result = ls.applicator.recordApplications(conn, ctx, applications);
    assert.strictEqual(result.ok, true, 'phantom IDs must not cause failure');

    // Verify records were written
    const records = conn.query<{ technique_id: string }>(
      'SELECT technique_id FROM learning_applications WHERE interaction_id = ?',
      ['int-104'],
    );
    assert.strictEqual(records.length, 2, 'both phantom records must be written');
  });

  it('recordApplications empty batch succeeds without error', () => {
    // CATCHES: implementation that errors on empty input or attempts to
    // write audit entry with no tenant context
    const { ls, conn, ctx } = createTestLearningSystem();

    const result = ls.applicator.recordApplications(conn, ctx, []);
    assert.strictEqual(result.ok, true, 'empty batch must succeed');
  });

  it('recordApplications increments applicationCount multiple times across calls', () => {
    // CATCHES: implementation that always sets applicationCount to 1 instead of
    // incrementing from current value. Verifies cumulative behavior.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;

    // Record 3 applications in separate calls
    for (let i = 0; i < 3; i++) {
      ls.applicator.recordApplications(conn, ctx, [{
        techniqueId: tid,
        interactionId: `int-multi-${i}`,
        tenantId: TEST_TENANT,
        timestamp: new Date().toISOString(),
        applied: true,
      }]);
    }

    const updated = ls.store.get(conn, tid, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(updated.ok, true);
    if (!updated.ok) return;
    assert.strictEqual(updated.value.applicationCount, 3,
      'applicationCount must be 3 after 3 applied=true recordings');
  });
});
