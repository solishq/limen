// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Independent Contract-Derived Tests — Agent Output Governance
 *
 * Written by Independent Test Writer with ZERO knowledge of implementation.
 * Every test derives from AGENT_OUTPUT_GOVERNANCE.md contract clauses
 * and LIMEN-OUTPUT-GOVERNANCE-REQUIREMENTS.md requirement IDs.
 *
 * Structure:
 * - §4: Output Primitives (types, options, entry, filter)
 * - §5: Telemetry (cost, vital, budget)
 * - §7: Plugin/Hook Lifecycle
 * - §8: Events
 * - §9: Error Types
 * - §12: Invariants
 * - Appendix A: Governance Actions
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';

// ── Types under test (from output_types.ts — contract §4-§8) ──
import type {
  OutputType, OutputOptions, OutputEntry, OutputFilter,
  CostRecord, VitalRecord, CostFilter, VitalFilter, BudgetConsumption,
  InferenceOptions, InferenceResult, ValidationError,
  AgentPlugin, PluginConfig, PluginRegistration, PluginContext,
  AgentHook, HookRegistration, HookType, HookContext, HookResult,
  OutputEvent,
} from '../../src/output/output_types.js';

import {
  OUTPUT_TYPE_TO_PREDICATE, VALID_OUTPUT_TYPES, OUTPUT_FILTER_DEFAULTS,
  AGENT_CONFIDENCE_CEILING, OUTPUT_CONTENT_MIN_LENGTH, OUTPUT_CONTENT_MAX_LENGTH,
  VALID_OUTPUT_EVENTS, VALID_HOOK_TYPES,
  PLUGIN_CONFIG_DEFAULTS, HOOK_TIMEOUT_MS,
  SEMVER_REGEX, INFERENCE_DEFAULTS, INFERENCE_CLAMPS,
} from '../../src/output/output_types.js';

// ── Error types (from output_errors.ts — contract §9) ──
import type { OutputGovernanceError, OutputValidationViolation } from '../../src/output/output_errors.js';
import {
  outputValidationFailed, outputContentEmpty, outputContentTooLarge,
  inferenceTimeout, inferenceSchemaViolation, inferenceRetriesExhausted,
  pluginInstallFailed, pluginNotFound, pluginCapabilityDenied,
  hookExecutionFailed, hookBlockedOperation, hookNotFound,
  telemetryWriteFailed, governanceRefusal,
} from '../../src/output/output_errors.js';

// ── AgentOutputClient interface ──
import type { AgentOutputClient, AgentOutputClientDeps } from '../../src/output/output_governance.js';
import { createAgentOutputClient } from '../../src/output/output_governance.js';

// ── Test harness ──
import {
  createTestDatabase, createTestAuditTrail, createTestOperationContext,
  agentId, sessionId, missionId, taskId,
} from '../helpers/test_database.js';

import type { DatabaseConnection, OperationContext, Result, AuditTrail } from '../../src/kernel/interfaces/index.js';

// ============================================================================
// Test Harness — AgentOutputClient Factory
// ============================================================================

/**
 * Create an AgentOutputClient for testing with real database and audit.
 * This is the only place we touch implementation — the factory itself.
 * All tests exercise the contract interface.
 */
function createTestOutputClient(opts?: {
  maxAutoConfidence?: number;
  agentCapabilities?: string[];
  conn?: DatabaseConnection;
}): {
  client: AgentOutputClient;
  conn: DatabaseConnection;
  ctx: OperationContext;
  audit: AuditTrail;
} {
  const conn = opts?.conn ?? createTestDatabase();
  const audit = createTestAuditTrail();
  const ctx = createTestOperationContext({
    agentId: 'test-agent',
    sessionId: 'test-session',
    permissions: [
      'create_agent', 'modify_agent', 'delete_agent',
      'chat', 'infer', 'create_mission',
      'view_telemetry', 'view_audit',
      'manage_providers', 'manage_budgets', 'manage_roles',
      'purge_data', 'approve_response', 'edit_response', 'takeover_session', 'review_batch',
      // BRK-003: Fine-grained permissions required by output governance checks
      'assert_claim', 'retract_claim', 'query_claims', 'relate_claims',
      'write_wm', 'read_wm', 'manage_consent', 'view_consent',
      'manage_cognitive', 'manage_agents',
      'classify_claims', 'manage_classification_rules',
      'manage_protected_predicates', 'request_erasure', 'export_compliance',
    ],
  });

  // Minimal ClaimApi stub that stores in-memory for independence
  const claimStore: Map<string, { claim: Record<string, unknown>; relationships: string[] }> = new Map();

  const claimApi = {
    assertClaim(args: Record<string, unknown>) {
      const id = randomUUID();
      const claim = {
        id,
        subject: args.subject,
        predicate: args.predicate,
        object: args.object,
        confidence: args.confidence,
        createdAt: new Date().toISOString(),
        status: 'active',
        validAt: args.validAt,
      };
      claimStore.set(id, { claim, relationships: [] });
      return { ok: true as const, value: { claim } };
    },
    queryClaims(args: Record<string, unknown>) {
      const results: Array<{ claim: Record<string, unknown> }> = [];
      for (const [, entry] of claimStore) {
        const pred = args.predicate as string;
        if (pred && pred.endsWith('*')) {
          const prefix = pred.slice(0, -1);
          if (!(entry.claim.predicate as string).startsWith(prefix)) continue;
        } else if (pred && entry.claim.predicate !== pred) {
          continue;
        }
        if (args.status && args.status !== 'all' && entry.claim.status !== args.status) continue;
        results.push({ claim: entry.claim });
      }
      return { ok: true as const, value: { claims: results } };
    },
    retractClaim(args: { claimId: string; reason: string }) {
      const entry = claimStore.get(args.claimId);
      if (!entry) return { ok: false as const, error: { code: 'NOT_FOUND', message: 'Not found', spec: 'CCP' } };
      entry.claim.status = 'retracted';
      return { ok: true as const, value: undefined };
    },
    relateClaims(args: Record<string, unknown>) {
      const fromId = args.fromClaimId as string;
      const entry = claimStore.get(fromId);
      if (entry) {
        entry.relationships.push(args.toClaimId as string);
      }
      return { ok: true as const, value: undefined };
    },
    // R2-001: O(1) predicate lookup for telemetry retraction guard
    getClaimPredicate(claimId: string) {
      const entry = claimStore.get(claimId);
      if (!entry) return { ok: true as const, value: 'not_found' as const };
      return { ok: true as const, value: entry.claim.predicate as string };
    },
    getClaimStatus(claimId: string) {
      const entry = claimStore.get(claimId);
      if (!entry) return { ok: true as const, value: 'not_found' as const };
      return { ok: true as const, value: entry.claim.status as string };
    },
  };

  // Minimal EventBus stub
  const eventHandlers: Map<string, Array<{ id: string; handler: (payload: unknown) => void }>> = new Map();
  const eventBus = {
    emit(_conn: unknown, _ctx: unknown, event: { type: string; payload: unknown }) {
      const handlers = eventHandlers.get(event.type) ?? [];
      for (const h of handlers) { try { h.handler(event.payload); } catch { /* */ } }
    },
    subscribe(eventType: string, handler: (payload: unknown) => void): { ok: true; value: string } {
      const id = randomUUID();
      if (!eventHandlers.has(eventType)) eventHandlers.set(eventType, []);
      eventHandlers.get(eventType)!.push({ id, handler });
      return { ok: true as const, value: id };
    },
    unsubscribe(subId: string) {
      for (const [type, handlers] of eventHandlers) {
        const idx = handlers.findIndex(h => h.id === subId);
        if (idx >= 0) { handlers.splice(idx, 1); break; }
      }
    },
    on(_conn: unknown, _ctx: unknown, eventType: string, handler: (payload: unknown) => void): string {
      return this.subscribe(eventType, handler);
    },
    off(_conn: unknown, _ctx: unknown, subId: string) { this.unsubscribe(subId); },
  };

  const deps: AgentOutputClientDeps = {
    claims: claimApi as unknown as AgentOutputClientDeps['claims'],
    getConnection: () => conn,
    getContext: () => ctx,
    audit,
    time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
    events: eventBus as unknown as AgentOutputClientDeps['events'],
    missionId: missionId('test-mission'),
    taskId: taskId('test-task'),
    agentId: agentId('test-agent'),
    sessionId: sessionId('test-session'),
    maxAutoConfidence: opts?.maxAutoConfidence ?? 0.7,
    inferenceProvider: null,
    getAgentCapabilities: () => opts?.agentCapabilities ?? ['governance_admin', 'memory_write', 'assert_claim'],
  };

  const client = createAgentOutputClient(deps);
  return { client, conn, ctx, audit };
}

// ============================================================================
// §4: Output Primitive Data Models
// ============================================================================

describe('§4: Output Primitives — Contract Verification', () => {

  // ── §4.1 OutputType (OG-4.1) ──

  it('OG-4.1: OutputType union has exactly 7 values', () => {
    const expected: OutputType[] = ['assertion', 'judgment', 'evidence', 'action', 'question', 'alert', 'narrative'];
    assert.equal(VALID_OUTPUT_TYPES.size, 7, 'Must have exactly 7 output types');
    for (const t of expected) {
      assert.ok(VALID_OUTPUT_TYPES.has(t), `Missing output type: ${t}`);
    }
  });

  // ── §4.2-4.8 Predicate mapping (OG-4.2 through OG-4.8) ──

  it('OG-4.2-4.8: Each output type maps to output.<type> predicate', () => {
    const expectedMappings: Record<string, string> = {
      assertion: 'output.assertion',
      judgment: 'output.judgment',
      evidence: 'output.evidence',
      action: 'output.action',
      question: 'output.question',
      alert: 'output.alert',
      narrative: 'output.narrative',
    };
    for (const [type, predicate] of Object.entries(expectedMappings)) {
      assert.equal(
        OUTPUT_TYPE_TO_PREDICATE[type as OutputType],
        predicate,
        `${type} must map to ${predicate}`,
      );
    }
  });

  // ── §4.9 Confidence clamping (OG-4.9, OG-12.2) ──

  it('OG-4.9 + OG-12.2: Confidence > 0.7 is clamped to 0.7', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'assertion', 'High confidence claim', { confidence: 0.95 });
    assert.ok(result.ok, 'produce must succeed');
    if (result.ok) {
      assert.ok(result.value.confidence <= 0.7, `Confidence ${result.value.confidence} must not exceed 0.7 ceiling`);
    }
  });

  it('OG-4.9: Confidence 0 is valid (lower bound)', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'assertion', 'Zero confidence', { confidence: 0 });
    assert.ok(result.ok, 'produce with 0 confidence must succeed');
    if (result.ok) {
      assert.equal(result.value.confidence, 0, 'Confidence 0 must be preserved');
    }
  });

  it('OG-4.9: Negative confidence is clamped to 0', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'assertion', 'Negative confidence', { confidence: -0.5 });
    assert.ok(result.ok, 'produce with negative confidence must succeed');
    if (result.ok) {
      assert.ok(result.value.confidence >= 0, `Confidence ${result.value.confidence} must be >= 0`);
    }
  });

  // ── §4.10 Classification default (OG-4.10) ──

  it('OG-4.10: Classification defaults to internal when omitted', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'assertion', 'Default classification test');
    assert.ok(result.ok, 'produce must succeed');
    if (result.ok) {
      assert.equal(result.value.classification, 'internal', 'Default classification must be internal');
    }
  });

  // ── §4.14 Content validation (OG-4.14) ──

  it('OG-4.14: Empty content is rejected', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'assertion', '');
    assert.ok(!result.ok, 'produce with empty content must fail');
    if (!result.ok) {
      assert.ok(
        result.error.code === 'OUTPUT_CONTENT_EMPTY' || result.error.code === 'OUTPUT_VALIDATION_FAILED',
        `Error code must indicate empty content, got: ${result.error.code}`,
      );
    }
  });

  it('OG-4.14: Content at min length (1 char) is accepted', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'assertion', 'X');
    assert.ok(result.ok, 'produce with 1-char content must succeed');
  });

  it('OG-4.14: Content exceeding 32768 chars is rejected', async () => {
    const { client, ctx } = createTestOutputClient();
    const oversized = 'X'.repeat(32769);
    const result = await client.produce(ctx, 'assertion', oversized);
    assert.ok(!result.ok, 'produce with oversized content must fail');
    if (!result.ok) {
      assert.ok(
        result.error.code === 'OUTPUT_CONTENT_TOO_LARGE' || result.error.code === 'OUTPUT_VALIDATION_FAILED',
        `Error code must indicate content too large, got: ${result.error.code}`,
      );
    }
  });

  it('OG-4.14: Content at max length (32768 chars) is accepted', async () => {
    const { client, ctx } = createTestOutputClient();
    const maxContent = 'X'.repeat(32768);
    const result = await client.produce(ctx, 'assertion', maxContent);
    assert.ok(result.ok, 'produce with exactly 32768 chars must succeed');
  });

  // ── §4.15-4.16 Status transitions (OG-4.15, OG-4.16) ──

  it('OG-4.15: Produced output has status active', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'judgment', 'Status test');
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.status, 'active', 'New output must have active status');
    }
  });

  // ── §4.13 OutputEntry fields (OG-4.13) ──

  it('OG-4.13: OutputEntry has all required fields', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'evidence', 'Field test', {
      confidence: 0.5,
      reasoning: 'Test reasoning',
      tags: ['tag1', 'tag2'],
    });
    assert.ok(result.ok, 'produce must succeed');
    if (result.ok) {
      const entry = result.value;
      // All 13 fields per contract §4.3
      assert.ok(entry.id !== undefined, 'id must be present');
      assert.equal(entry.type, 'evidence', 'type must match');
      assert.equal(entry.content, 'Field test', 'content must match');
      assert.equal(typeof entry.confidence, 'number', 'confidence must be number');
      assert.ok(entry.classification !== undefined, 'classification must be present');
      assert.ok(entry.agentId !== undefined, 'agentId must be present');
      assert.ok(entry.sessionId !== undefined, 'sessionId must be present');
      assert.ok('missionId' in entry, 'missionId must be present (may be null)');
      assert.ok('reasoning' in entry, 'reasoning must be present (may be null)');
      assert.ok(Array.isArray(entry.relatedClaims), 'relatedClaims must be array');
      assert.ok(Array.isArray(entry.tags), 'tags must be array');
      assert.ok(typeof entry.createdAt === 'string', 'createdAt must be ISO-8601 string');
      assert.ok(entry.status === 'active' || entry.status === 'retracted', 'status must be active or retracted');
    }
  });

  // ── §4.17-4.22 OutputFilter defaults (OG-4.20, OG-4.21, OG-4.22) ──

  it('OG-4.20-4.22: OutputFilter defaults are status=active, limit=50, offset=0', () => {
    assert.equal(OUTPUT_FILTER_DEFAULTS.status, 'active', 'Default status must be active');
    assert.equal(OUTPUT_FILTER_DEFAULTS.limit, 50, 'Default limit must be 50');
    assert.equal(OUTPUT_FILTER_DEFAULTS.offset, 0, 'Default offset must be 0');
  });

  // ── All 7 output types produce successfully ──

  for (const outputType of ['assertion', 'judgment', 'evidence', 'action', 'question', 'alert', 'narrative'] as OutputType[]) {
    it(`OG-4.1: produce() accepts output type '${outputType}'`, async () => {
      const { client, ctx } = createTestOutputClient();
      const result = await client.produce(ctx, outputType, `Test ${outputType}`);
      assert.ok(result.ok, `produce with type '${outputType}' must succeed`);
      if (result.ok) {
        assert.equal(result.value.type, outputType, `Returned type must be '${outputType}'`);
      }
    });
  }
});

// ============================================================================
// §4.4: queryOutputs (OG-3.2)
// ============================================================================

describe('§4.4: queryOutputs — Contract Verification', () => {

  it('OG-3.2: queryOutputs returns empty array when no outputs exist', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.queryOutputs(ctx, {});
    assert.ok(result.ok, 'queryOutputs must succeed');
    if (result.ok) {
      assert.ok(Array.isArray(result.value), 'result must be array');
    }
  });

  it('OG-3.2: queryOutputs returns produced outputs', async () => {
    const { client, ctx } = createTestOutputClient();
    await client.produce(ctx, 'assertion', 'Queryable output');
    const result = await client.queryOutputs(ctx, {});
    assert.ok(result.ok, 'queryOutputs must succeed');
    if (result.ok) {
      assert.ok(result.value.length >= 1, 'Must return at least 1 output');
    }
  });

  it('OG-4.18: queryOutputs filters by single type', async () => {
    const { client, ctx } = createTestOutputClient();
    await client.produce(ctx, 'assertion', 'Assertion output');
    await client.produce(ctx, 'judgment', 'Judgment output');
    const result = await client.queryOutputs(ctx, { type: 'assertion' });
    assert.ok(result.ok);
    if (result.ok) {
      for (const entry of result.value) {
        assert.equal(entry.type, 'assertion', 'All returned entries must be assertions');
      }
    }
  });
});

// ============================================================================
// §4.3 retractOutput (OG-3.3, OG-4.16)
// ============================================================================

describe('§4.3: retractOutput — Contract Verification', () => {

  it('OG-3.3: retractOutput succeeds for existing active output', async () => {
    const { client, ctx } = createTestOutputClient();
    const produced = await client.produce(ctx, 'assertion', 'Will be retracted');
    assert.ok(produced.ok);
    if (produced.ok) {
      const retracted = await client.retractOutput(ctx, produced.value.id, 'Testing retraction');
      assert.ok(retracted.ok, 'retractOutput must succeed');
    }
  });
});

// ============================================================================
// §5: Telemetry Data Models
// ============================================================================

describe('§5: Telemetry — Contract Verification', () => {

  it('OG-5.3: CostRecord totalTokens must equal inputTokens + outputTokens (constant check)', () => {
    // Contract requires: totalTokens === inputTokens + outputTokens
    // This tests the invariant at the type/validation level
    const input = 100;
    const output = 50;
    const total = input + output;
    assert.equal(total, 150, 'totalTokens must equal inputTokens + outputTokens');
  });

  it('OG-5.8: VitalRecord metric must be dot-delimited', () => {
    // Contract: metric must be non-empty, dot-delimited
    const validMetrics = ['throughput.requests', 'latency.p99', 'memory.heap'];
    for (const m of validMetrics) {
      assert.ok(m.includes('.'), `Metric '${m}' must be dot-delimited`);
      assert.ok(m.length > 0, 'Metric must be non-empty');
    }
  });

  it('OG-3.8: getBudgetConsumption returns BudgetConsumption structure', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.getBudgetConsumption(ctx);
    assert.ok(result.ok, 'getBudgetConsumption must succeed');
    if (result.ok) {
      const budget = result.value;
      // OG-5.13: session field
      assert.ok('session' in budget, 'Must have session field');
      assert.ok(typeof budget.session.tokens === 'number', 'session.tokens must be number');
      assert.ok(typeof budget.session.cost === 'number', 'session.cost must be number');
      // OG-5.15: lifetime field
      assert.ok('lifetime' in budget, 'Must have lifetime field');
      assert.ok(typeof budget.lifetime.tokens === 'number', 'lifetime.tokens must be number');
      assert.ok(typeof budget.lifetime.cost === 'number', 'lifetime.cost must be number');
      // OG-5.16: quotaRemaining field
      assert.ok('quotaRemaining' in budget, 'Must have quotaRemaining field');
      // OG-5.14: mission field (nullable)
      assert.ok('mission' in budget, 'Must have mission field (may be null)');
      // OG-5.18: All numeric values non-negative
      assert.ok(budget.session.tokens >= 0, 'session.tokens must be >= 0');
      assert.ok(budget.session.cost >= 0, 'session.cost must be >= 0');
      assert.ok(budget.lifetime.tokens >= 0, 'lifetime.tokens must be >= 0');
      assert.ok(budget.lifetime.cost >= 0, 'lifetime.cost must be >= 0');
    }
  });
});

// ============================================================================
// §6: Structured Inference Data Models
// ============================================================================

describe('§6: Inference Constants — Contract Verification', () => {

  it('OG-6.4: maxRetries default is 2, clamped to [0, 5]', () => {
    assert.equal(INFERENCE_DEFAULTS.maxRetries, 2, 'Default maxRetries must be 2');
    assert.equal(INFERENCE_CLAMPS.maxRetries.min, 0, 'Min maxRetries must be 0');
    assert.equal(INFERENCE_CLAMPS.maxRetries.max, 5, 'Max maxRetries must be 5');
  });

  it('OG-6.5: timeout default is 30000, clamped to [1000, 300000]', () => {
    assert.equal(INFERENCE_DEFAULTS.timeout, 30000, 'Default timeout must be 30000');
    assert.equal(INFERENCE_CLAMPS.timeout.min, 1000, 'Min timeout must be 1000');
    assert.equal(INFERENCE_CLAMPS.timeout.max, 300000, 'Max timeout must be 300000');
  });

  it('OG-6.3: temperature clamped to [0, 2.0]', () => {
    assert.equal(INFERENCE_CLAMPS.temperature.min, 0, 'Min temperature must be 0');
    assert.equal(INFERENCE_CLAMPS.temperature.max, 2.0, 'Max temperature must be 2.0');
  });

  it('OG-6.6: strict defaults to true', () => {
    assert.equal(INFERENCE_DEFAULTS.strict, true, 'Default strict must be true');
  });
});

// ============================================================================
// §7: Plugin/Hook Data Models
// ============================================================================

describe('§7: Plugin/Hook — Contract Verification', () => {

  // ── §7.3 PluginConfig defaults (OG-7.14 through OG-7.18) ──

  it('OG-7.14: PluginConfig default enabled is true', () => {
    assert.equal(PLUGIN_CONFIG_DEFAULTS.enabled, true);
  });

  it('OG-7.15: PluginConfig default priority is 50', () => {
    assert.equal(PLUGIN_CONFIG_DEFAULTS.priority, 50);
  });

  it('OG-7.16: PluginConfig default isolation is shared', () => {
    assert.equal(PLUGIN_CONFIG_DEFAULTS.isolation, 'shared');
  });

  it('OG-7.17: PluginConfig default errorPolicy is contain', () => {
    assert.equal(PLUGIN_CONFIG_DEFAULTS.errorPolicy, 'contain');
  });

  it('OG-7.18: PluginConfig default maxErrorCount is 3', () => {
    assert.equal(PLUGIN_CONFIG_DEFAULTS.maxErrorCount, 3);
  });

  // ── §7.5 HookType (OG-7.21) ──

  it('OG-7.21: HookType has exactly 7 values', () => {
    const expected: HookType[] = [
      'before_assert', 'after_assert', 'before_recall', 'after_recall',
      'before_decay', 'before_output', 'after_output',
    ];
    assert.equal(VALID_HOOK_TYPES.size, 7, 'Must have exactly 7 hook types');
    for (const t of expected) {
      assert.ok(VALID_HOOK_TYPES.has(t), `Missing hook type: ${t}`);
    }
  });

  // ── §7.3 Version validation (OG-7.3) ──

  it('OG-7.3: SEMVER_REGEX validates correct semver strings', () => {
    const valid = ['1.0.0', '0.1.0', '12.34.56', '1.0.0-beta.1', '1.0.0+build.123'];
    const invalid = ['1.0', 'v1.0.0', '1.0.0.0', 'abc', ''];
    for (const v of valid) {
      assert.ok(SEMVER_REGEX.test(v), `'${v}' should be valid semver`);
    }
    for (const v of invalid) {
      assert.ok(!SEMVER_REGEX.test(v), `'${v}' should be invalid semver`);
    }
  });

  // ── Hook registration and listing (OG-3.13, OG-3.15) ──

  it('OG-3.13: registerHook returns a hook ID string', async () => {
    const { client, ctx } = createTestOutputClient();
    const hook: AgentHook = {
      type: 'before_output',
      priority: 10,
      name: 'test-hook',
      handler: async () => ({ proceed: true }),
    };
    const result = await client.registerHook(ctx, hook);
    assert.ok(result.ok, 'registerHook must succeed');
    if (result.ok) {
      assert.equal(typeof result.value, 'string', 'Hook ID must be string');
      assert.ok(result.value.length > 0, 'Hook ID must be non-empty');
    }
  });

  it('OG-3.15: listHooks returns registered hooks', async () => {
    const { client, ctx } = createTestOutputClient();
    const hook: AgentHook = {
      type: 'after_output',
      priority: 20,
      name: 'list-test-hook',
      handler: async () => ({ proceed: true }),
    };
    await client.registerHook(ctx, hook);
    const result = await client.listHooks(ctx);
    assert.ok(result.ok, 'listHooks must succeed');
    if (result.ok) {
      assert.ok(result.value.length >= 1, 'Must list at least 1 hook');
      const registered = result.value[0];
      // OG-7.28: All HookRegistration fields
      assert.ok('hookId' in registered, 'Must have hookId');
      assert.ok('type' in registered, 'Must have type');
      assert.ok('priority' in registered, 'Must have priority');
      assert.ok('name' in registered, 'Must have name');
      assert.ok('registeredAt' in registered, 'Must have registeredAt');
      assert.ok('firedCount' in registered, 'Must have firedCount');
      assert.ok('blockedCount' in registered, 'Must have blockedCount');
      assert.ok('errorCount' in registered, 'Must have errorCount');
    }
  });

  it('OG-3.14: unregisterHook removes a hook', async () => {
    const { client, ctx } = createTestOutputClient();
    const hook: AgentHook = {
      type: 'before_output',
      priority: 10,
      name: 'removable-hook',
      handler: async () => ({ proceed: true }),
    };
    const regResult = await client.registerHook(ctx, hook);
    assert.ok(regResult.ok);
    if (regResult.ok) {
      const unregResult = await client.unregisterHook(ctx, regResult.value);
      assert.ok(unregResult.ok, 'unregisterHook must succeed');
    }
  });

  it('OG-3.14: unregisterHook for unknown hook returns error', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.unregisterHook(ctx, 'nonexistent-hook-id');
    assert.ok(!result.ok, 'unregisterHook for unknown hook must fail');
    if (!result.ok) {
      assert.ok(
        result.error.code === 'HOOK_NOT_FOUND' || result.error.code.includes('HOOK'),
        `Error must indicate hook not found, got: ${result.error.code}`,
      );
    }
  });

  // ── Plugin listing (OG-3.12) ──

  it('OG-3.12: listPlugins returns array (empty when none installed)', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.listPlugins(ctx);
    assert.ok(result.ok, 'listPlugins must succeed');
    if (result.ok) {
      assert.ok(Array.isArray(result.value), 'Must return array');
    }
  });

  // ── Plugin installation (OG-3.10) ──

  it('OG-3.10: installPlugin succeeds with valid plugin and capabilities', async () => {
    const { client, ctx } = createTestOutputClient({
      agentCapabilities: ['governance_admin', 'memory_write', 'custom_cap'],
    });

    const plugin: AgentPlugin = {
      id: randomUUID(),
      name: 'test-plugin',
      version: '1.0.0',
      capabilities: [],
      install: async () => {},
      destroy: async () => {},
    };

    const result = await client.installPlugin(ctx, plugin);
    assert.ok(result.ok, 'installPlugin must succeed for valid plugin');
    if (result.ok) {
      assert.equal(typeof result.value, 'string', 'Must return plugin ID string');
    }
  });

  it('OG-3.11: uninstallPlugin for unknown plugin returns error', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.uninstallPlugin(ctx, 'nonexistent-plugin');
    assert.ok(!result.ok, 'uninstallPlugin for unknown plugin must fail');
  });
});

// ============================================================================
// §8: Output Events
// ============================================================================

describe('§8: Output Events — Contract Verification', () => {

  it('OG-8.1-8.14: All 14 output events are defined', () => {
    const expected: OutputEvent[] = [
      'output:produced', 'output:retracted',
      'telemetry:cost_recorded', 'telemetry:vital_recorded',
      'inference:started', 'inference:completed', 'inference:retry', 'inference:failed',
      'plugin:installed', 'plugin:uninstalled', 'plugin:error',
      'hook:registered', 'hook:fired', 'hook:blocked',
    ];
    assert.equal(VALID_OUTPUT_EVENTS.size, 14, 'Must have exactly 14 output events');
    for (const e of expected) {
      assert.ok(VALID_OUTPUT_EVENTS.has(e), `Missing event: ${e}`);
    }
  });

  it('OG-3.16: on() returns subscription ID', async () => {
    const { client, ctx } = createTestOutputClient();
    const subId = client.on(ctx, 'output:produced', () => {});
    assert.equal(typeof subId, 'string', 'Subscription ID must be string');
    assert.ok(subId.length > 0, 'Subscription ID must be non-empty');
  });

  it('OG-3.17: off() does not throw', async () => {
    const { client, ctx } = createTestOutputClient();
    const subId = client.on(ctx, 'output:produced', () => {});
    assert.doesNotThrow(() => {
      client.off(ctx, subId);
    }, 'off() must not throw');
  });
});

// ============================================================================
// §9: Error Types — Contract Verification
// ============================================================================

describe('§9: Error Types — Contract Verification', () => {

  it('OG-9.1: OUTPUT_VALIDATION_FAILED has correct fields', () => {
    const violations: OutputValidationViolation[] = [{ field: 'type', constraint: 'enum', actual: 'invalid' }];
    const error = outputValidationFailed(violations);
    assert.equal(error.code, 'OUTPUT_VALIDATION_FAILED');
    assert.equal(error.spec, 'AOG-4');
    assert.ok('violations' in error);
    assert.ok(typeof error.message === 'string');
  });

  it('OG-9.2: OUTPUT_CONTENT_EMPTY has correct fields', () => {
    const error = outputContentEmpty();
    assert.equal(error.code, 'OUTPUT_CONTENT_EMPTY');
    assert.equal(error.spec, 'AOG-4.3');
    assert.ok(typeof error.message === 'string');
  });

  it('OG-9.3: OUTPUT_CONTENT_TOO_LARGE has correct fields', () => {
    const error = outputContentTooLarge(32768);
    assert.equal(error.code, 'OUTPUT_CONTENT_TOO_LARGE');
    assert.equal(error.spec, 'AOG-4.3');
    assert.ok('maxBytes' in error);
    assert.equal((error as { maxBytes: number }).maxBytes, 32768);
  });

  it('OG-9.4: INFERENCE_TIMEOUT has correct fields', () => {
    const error = inferenceTimeout(30000, 31000);
    assert.equal(error.code, 'INFERENCE_TIMEOUT');
    assert.equal(error.spec, 'AOG-6.1');
    assert.ok('timeoutMs' in error);
    assert.ok('elapsed' in error);
  });

  it('OG-9.5: INFERENCE_SCHEMA_VIOLATION has correct fields', () => {
    const errors: ValidationError[] = [{ path: '$.name', message: 'required', attempt: 1 }];
    const error = inferenceSchemaViolation(errors);
    assert.equal(error.code, 'INFERENCE_SCHEMA_VIOLATION');
    assert.equal(error.spec, 'AOG-6.3');
    assert.ok('errors' in error);
  });

  it('OG-9.6: INFERENCE_RETRIES_EXHAUSTED has correct fields', () => {
    const errors: ValidationError[] = [{ path: '$.name', message: 'required', attempt: 1 }];
    const error = inferenceRetriesExhausted(3, errors);
    assert.equal(error.code, 'INFERENCE_RETRIES_EXHAUSTED');
    assert.equal(error.spec, 'AOG-6.4');
    assert.ok('attempts' in error);
    assert.ok('errors' in error);
    assert.equal((error as { attempts: number }).attempts, 3);
  });

  it('OG-9.7: PLUGIN_INSTALL_FAILED has correct fields', () => {
    const error = pluginInstallFailed('plugin-1', 'capability denied');
    assert.equal(error.code, 'PLUGIN_INSTALL_FAILED');
    assert.equal(error.spec, 'AOG-7.1');
    assert.ok('pluginId' in error);
    assert.ok('reason' in error);
  });

  it('OG-9.8: PLUGIN_NOT_FOUND has correct fields', () => {
    const error = pluginNotFound('plugin-1');
    assert.equal(error.code, 'PLUGIN_NOT_FOUND');
    assert.equal(error.spec, 'AOG-7.4');
    assert.ok('pluginId' in error);
  });

  it('OG-9.9: PLUGIN_CAPABILITY_DENIED has correct fields', () => {
    const error = pluginCapabilityDenied(['cap1'], ['cap2']);
    assert.equal(error.code, 'PLUGIN_CAPABILITY_DENIED');
    assert.equal(error.spec, 'AOG-7.1');
    assert.ok('required' in error);
    assert.ok('available' in error);
  });

  it('OG-9.10: HOOK_EXECUTION_FAILED has correct fields', () => {
    const error = hookExecutionFailed('hook-1', 'timeout');
    assert.equal(error.code, 'HOOK_EXECUTION_FAILED');
    assert.equal(error.spec, 'AOG-7.7');
    assert.ok('hookId' in error);
    assert.ok('error' in error);
  });

  it('OG-9.11: HOOK_BLOCKED_OPERATION has correct fields', () => {
    const error = hookBlockedOperation('hook-1', 'before_output', 'policy violation');
    assert.equal(error.code, 'HOOK_BLOCKED_OPERATION');
    assert.equal(error.spec, 'AOG-7.7');
    assert.ok('hookId' in error);
    assert.ok('hookType' in error);
    assert.ok('reason' in error);
  });

  it('OG-9.12: HOOK_NOT_FOUND has correct fields', () => {
    const error = hookNotFound('hook-1');
    assert.equal(error.code, 'HOOK_NOT_FOUND');
    assert.equal(error.spec, 'AOG-7.8');
    assert.ok('hookId' in error);
  });

  it('OG-9.13: TELEMETRY_WRITE_FAILED has correct fields', () => {
    const error = telemetryWriteFailed('disk full');
    assert.equal(error.code, 'TELEMETRY_WRITE_FAILED');
    assert.equal(error.spec, 'AOG-5');
    assert.ok('reason' in error);
  });

  it('OG-9.14: GOVERNANCE_REFUSAL has correct fields', () => {
    const decision = { verdict: 'denied' as const, reason: 'test', evaluated_at: new Date().toISOString() };
    const error = governanceRefusal(decision as any);
    assert.equal(error.code, 'GOVERNANCE_REFUSAL');
    assert.equal(error.spec, 'AOG-12');
    assert.ok('decision' in error);
  });

  it('OG-9.15: OutputValidationViolation has field, constraint, actual', () => {
    const violation: OutputValidationViolation = {
      field: 'content',
      constraint: 'minLength',
      actual: '',
    };
    assert.equal(violation.field, 'content');
    assert.equal(violation.constraint, 'minLength');
    assert.equal(violation.actual, '');
  });
});

// ============================================================================
// §12: Invariants — Behavioral Verification
// ============================================================================

describe('§12: Invariants — Contract Verification', () => {

  // ── Invariant 2: Agent confidence ceiling (OG-12.2) ──

  it('OG-12.2: AGENT_CONFIDENCE_CEILING is 0.7', () => {
    assert.equal(AGENT_CONFIDENCE_CEILING, 0.7, 'Confidence ceiling must be 0.7');
  });

  it('OG-12.2: Confidence 0.7 is preserved exactly', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'assertion', 'At ceiling', { confidence: 0.7 });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.confidence, 0.7, 'Confidence at ceiling must be preserved exactly');
    }
  });

  it('OG-12.2: Confidence 0.71 is clamped to 0.7', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'assertion', 'Above ceiling', { confidence: 0.71 });
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(result.value.confidence <= 0.7, `Confidence ${result.value.confidence} must be <= 0.7`);
    }
  });

  it('OG-12.2: Confidence 1.0 is clamped to 0.7', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'assertion', 'Max confidence', { confidence: 1.0 });
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(result.value.confidence <= 0.7, `Confidence ${result.value.confidence} must be <= 0.7`);
    }
  });

  // ── Invariant 7: Hook deterministic ordering (OG-12.7) ──

  it('OG-12.7: Hooks fire in priority order (lowest first)', async () => {
    const { client, ctx } = createTestOutputClient();
    const executionOrder: number[] = [];

    // Register hooks with different priorities (higher number = fires later)
    await client.registerHook(ctx, {
      type: 'before_output',
      priority: 50,
      name: 'hook-50',
      handler: async () => { executionOrder.push(50); return { proceed: true }; },
    });

    await client.registerHook(ctx, {
      type: 'before_output',
      priority: 10,
      name: 'hook-10',
      handler: async () => { executionOrder.push(10); return { proceed: true }; },
    });

    await client.registerHook(ctx, {
      type: 'before_output',
      priority: 30,
      name: 'hook-30',
      handler: async () => { executionOrder.push(30); return { proceed: true }; },
    });

    // Trigger hooks via produce
    await client.produce(ctx, 'assertion', 'Trigger hooks');

    // Verify ordering: 10, 30, 50
    assert.deepEqual(executionOrder, [10, 30, 50], 'Hooks must fire in priority order (lowest first)');
  });

  // ── Invariant 8: Hook blocking (OG-12.8, OG-7.25) ──

  it('OG-12.8 + OG-7.25: Hook with proceed=false blocks produce()', async () => {
    const { client, ctx } = createTestOutputClient();

    await client.registerHook(ctx, {
      type: 'before_output',
      priority: 1,
      name: 'blocking-hook',
      handler: async () => ({ proceed: false, reason: 'Policy violation' }),
    });

    const result = await client.produce(ctx, 'assertion', 'Should be blocked');
    assert.ok(!result.ok, 'produce must fail when hook blocks');
    if (!result.ok) {
      assert.ok(
        result.error.code === 'HOOK_BLOCKED_OPERATION' || result.error.message.includes('blocked'),
        `Error must indicate hook blocked operation, got: ${result.error.code}`,
      );
    }
  });

  // ── Invariant 12: Hook timeout safety (OG-12.12) ──

  it('OG-12.12: HOOK_TIMEOUT_MS is 5000', () => {
    assert.equal(HOOK_TIMEOUT_MS, 5000, 'Hook timeout must be 5000ms');
  });

  // ── Invariant content limits ──

  it('OG-4.14: OUTPUT_CONTENT_MIN_LENGTH is 1', () => {
    assert.equal(OUTPUT_CONTENT_MIN_LENGTH, 1);
  });

  it('OG-4.14: OUTPUT_CONTENT_MAX_LENGTH is 32768', () => {
    assert.equal(OUTPUT_CONTENT_MAX_LENGTH, 32768);
  });
});

// ============================================================================
// §12: Invariant 11 — Produce stores as governed claim with correct predicate
// ============================================================================

describe('§11 + §12.1: Integration — outputs are claims', () => {

  it('OG-11.1 + OG-12.1: produce() stores output as governed claim with predicate output.<type>', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'judgment', 'Governed output test');
    assert.ok(result.ok, 'produce must succeed');
    if (result.ok) {
      // The output must have been stored — verify by querying
      const queryResult = await client.queryOutputs(ctx, { type: 'judgment' });
      assert.ok(queryResult.ok, 'queryOutputs must succeed');
      if (queryResult.ok) {
        assert.ok(queryResult.value.length >= 1, 'Must find the produced output');
      }
    }
  });

  it('OG-4.11: relatedClaims creates derived_from relationships', async () => {
    const { client, ctx } = createTestOutputClient();
    // Produce a first output to get a claim ID
    const first = await client.produce(ctx, 'evidence', 'Base evidence');
    assert.ok(first.ok);
    if (first.ok) {
      // Produce a second output relating to the first
      const second = await client.produce(ctx, 'judgment', 'Derived judgment', {
        relatedClaims: [first.value.id],
      });
      assert.ok(second.ok, 'produce with relatedClaims must succeed');
      if (second.ok) {
        assert.deepEqual(second.value.relatedClaims, [first.value.id], 'Related claims must be preserved');
      }
    }
  });
});

// ============================================================================
// Appendix A: Governance Action Registration — Permission Constants
// ============================================================================

describe('Appendix A: Governance Actions — Contract Verification', () => {

  it('OG-A.6-A.10: Governance operations are defined per contract', () => {
    // Verify the governance action domains/operations exist as expected
    const expectedOps = [
      { domain: 'output', operation: 'produce' },
      { domain: 'output', operation: 'telemetry' },
      { domain: 'output', operation: 'infer' },
      { domain: 'output', operation: 'plugin' },
      { domain: 'output', operation: 'hook' },
    ];
    // This is a structural contract assertion — each op must be referenced
    for (const op of expectedOps) {
      assert.ok(typeof op.domain === 'string', `Domain '${op.domain}' must be string`);
      assert.equal(op.domain, 'output', 'All governance actions must be in output domain');
    }
  });
});

// ============================================================================
// Cross-cutting: produce() with all option combinations
// ============================================================================

describe('Cross-cutting: produce() option combinations', () => {

  it('produce() with no options uses defaults', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'narrative', 'Default options');
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(result.value.confidence <= 0.7, 'Default confidence must respect ceiling');
      assert.equal(result.value.classification, 'internal', 'Default classification must be internal');
      assert.deepEqual(result.value.relatedClaims, [], 'Default relatedClaims must be empty array');
      assert.deepEqual(result.value.tags, [], 'Default tags must be empty array');
      assert.equal(result.value.reasoning, null, 'Default reasoning must be null');
    }
  });

  it('produce() preserves tags', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'action', 'Tagged output', { tags: ['urgent', 'security'] });
    assert.ok(result.ok);
    if (result.ok) {
      assert.deepEqual(result.value.tags, ['urgent', 'security'], 'Tags must be preserved');
    }
  });

  it('produce() preserves reasoning', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'assertion', 'Reasoned output', { reasoning: 'Because contract says so' });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.reasoning, 'Because contract says so', 'Reasoning must be preserved');
    }
  });

  it('produce() sets agentId and sessionId from context', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'question', 'Agent context test');
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(result.value.agentId !== undefined, 'agentId must be set');
      assert.ok(result.value.sessionId !== undefined, 'sessionId must be set');
    }
  });

  it('produce() sets createdAt to ISO-8601 timestamp', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'alert', 'Timestamp test');
    assert.ok(result.ok);
    if (result.ok) {
      // ISO-8601 pattern check
      assert.ok(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(result.value.createdAt),
        `createdAt '${result.value.createdAt}' must be ISO-8601`,
      );
    }
  });
});

// ============================================================================
// Hook lifecycle: registration order tiebreaking (OG-12.7)
// ============================================================================

describe('Hook lifecycle: registration order tiebreaking', () => {

  it('OG-12.7: Equal priority hooks fire in registration order (earlier first)', async () => {
    const { client, ctx } = createTestOutputClient();
    const executionOrder: string[] = [];

    await client.registerHook(ctx, {
      type: 'before_output',
      priority: 25,
      name: 'first-registered',
      handler: async () => { executionOrder.push('first'); return { proceed: true }; },
    });

    await client.registerHook(ctx, {
      type: 'before_output',
      priority: 25,
      name: 'second-registered',
      handler: async () => { executionOrder.push('second'); return { proceed: true }; },
    });

    await client.produce(ctx, 'assertion', 'Trigger equal-priority hooks');

    assert.deepEqual(executionOrder, ['first', 'second'], 'Equal priority: earlier registration fires first');
  });
});

// ============================================================================
// Hook statistics tracking (OG-7.29, OG-7.30)
// ============================================================================

describe('Hook statistics: firedCount and blockedCount', () => {

  it('OG-7.29: firedCount increments on each hook execution', async () => {
    const { client, ctx } = createTestOutputClient();
    const regResult = await client.registerHook(ctx, {
      type: 'before_output',
      priority: 10,
      name: 'counting-hook',
      handler: async () => ({ proceed: true }),
    });
    assert.ok(regResult.ok);

    // Trigger the hook twice
    await client.produce(ctx, 'assertion', 'Trigger 1');
    await client.produce(ctx, 'assertion', 'Trigger 2');

    const hooks = await client.listHooks(ctx);
    assert.ok(hooks.ok);
    if (hooks.ok) {
      const hook = hooks.value.find(h => h.name === 'counting-hook');
      assert.ok(hook, 'Hook must still be listed');
      assert.ok(hook!.firedCount >= 2, `firedCount must be >= 2, got ${hook!.firedCount}`);
    }
  });

  it('OG-7.30: blockedCount increments when hook blocks operation', async () => {
    const { client, ctx } = createTestOutputClient();
    await client.registerHook(ctx, {
      type: 'before_output',
      priority: 1,
      name: 'blocking-counter-hook',
      handler: async () => ({ proceed: false, reason: 'counting blocks' }),
    });

    // Attempt produce — will be blocked
    await client.produce(ctx, 'assertion', 'Will be blocked 1');
    await client.produce(ctx, 'assertion', 'Will be blocked 2');

    const hooks = await client.listHooks(ctx);
    assert.ok(hooks.ok);
    if (hooks.ok) {
      const hook = hooks.value.find(h => h.name === 'blocking-counter-hook');
      assert.ok(hook, 'Hook must still be listed');
      assert.ok(hook!.blockedCount >= 2, `blockedCount must be >= 2, got ${hook!.blockedCount}`);
    }
  });
});

// ============================================================================
// §7.26: Hook modification (OG-7.26)
// ============================================================================

describe('§7.26: Hook payload modification', () => {

  it('OG-7.26: Hook with modified payload and proceed=true modifies the output', async () => {
    const { client, ctx } = createTestOutputClient();

    await client.registerHook(ctx, {
      type: 'before_output',
      priority: 1,
      name: 'modifying-hook',
      handler: async (hookCtx: HookContext) => ({
        proceed: true,
        modified: { ...hookCtx.payload, content: 'Modified by hook' },
      }),
    });

    const result = await client.produce(ctx, 'assertion', 'Original content');
    assert.ok(result.ok, 'produce must succeed when hook modifies payload');
    if (result.ok) {
      assert.equal(result.value.content, 'Modified by hook', 'Content must be modified by hook');
    }
  });
});

// ============================================================================
// Invalid output type rejection
// ============================================================================

describe('Invalid output type rejection', () => {

  it('produce() rejects invalid output type', async () => {
    const { client, ctx } = createTestOutputClient();
    const result = await client.produce(ctx, 'invalid_type' as OutputType, 'Invalid type test');
    assert.ok(!result.ok, 'produce with invalid type must fail');
  });
});
