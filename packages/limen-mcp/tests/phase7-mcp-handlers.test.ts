/**
 * Phase 7: MCP Tool Handler Tests.
 *
 * These tests invoke the ACTUAL MCP tool handlers registered by
 * registerContextTools, registerCognitiveTools, registerSearchTools,
 * and registerClaimTools. They verify:
 *
 *   1. Tool registration succeeds (F-P7-002)
 *   2. Handlers delegate correctly to the Limen engine (F-P7-001)
 *   3. Error handling and input validation at the MCP layer (F-P7-003, F-P7-005, F-P7-007)
 *
 * Approach: Create a real McpServer instance, register tools, then access
 * the internal _registeredTools map to get handlers. Invoke handlers directly
 * with test arguments. No transport required.
 *
 * Mutation kill targets: M-1 through M-7 from Breaker report.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLimen } from '../../../src/api/index.js';
import type { Limen } from '../../../src/api/index.js';
import { registerContextTools } from '../src/tools/context.js';
import { registerCognitiveTools } from '../src/tools/cognitive.js';
import { registerSearchTools } from '../src/tools/search.js';
import { registerClaimTools } from '../src/tools/claim.js';

// ─── Types ───

/** The CallToolResult shape returned by MCP tool handlers. */
interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/** Access _registeredTools from McpServer (runtime-accessible despite being private). */
interface RegisteredTool {
  handler: (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<ToolResult>;
  inputSchema?: unknown;
  description?: string;
  enabled: boolean;
}

function getRegisteredTools(server: McpServer): Record<string, RegisteredTool> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (server as any)._registeredTools as Record<string, RegisteredTool>;
}

// ─── Helpers ───

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-mcp-handler-'));
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

/** Create an McpServer with all Phase 7 tools registered. */
function createServerWithTools(limen: Limen): McpServer {
  const server = new McpServer({ name: 'test-limen', version: '0.0.0' });
  registerContextTools(server, limen);
  registerCognitiveTools(server, limen);
  registerSearchTools(server, limen);
  registerClaimTools(server, limen);
  return server;
}

/** Invoke a registered tool handler by name with the given args. */
async function callTool(server: McpServer, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tools = getRegisteredTools(server);
  const tool = tools[name];
  if (!tool) {
    throw new Error(`Tool "${name}" not registered. Available: ${Object.keys(tools).join(', ')}`);
  }
  // The MCP SDK calls handler(args, extra). extra contains session info we don't need.
  return await tool.handler(args, {});
}

/** Seed test claims into a Limen engine. */
function seedClaims(limen: Limen): string[] {
  const claimIds: string[] = [];

  const r1 = limen.remember('entity:project:alpha', 'decision.architecture', 'Chose microservices');
  assert.ok(r1.ok, `Seed claim 1 failed`);
  if (r1.ok) claimIds.push(r1.value.claimId);

  const r2 = limen.remember('entity:project:alpha', 'decision.language', 'TypeScript for backend');
  assert.ok(r2.ok, `Seed claim 2 failed`);
  if (r2.ok) claimIds.push(r2.value.claimId);

  const r3 = limen.remember('entity:user:bob', 'preference.editor', 'VS Code');
  assert.ok(r3.ok, `Seed claim 3 failed`);
  if (r3.ok) claimIds.push(r3.value.claimId);

  return claimIds;
}

/** Parse the text content from a tool result. */
function parseResultText(result: ToolResult): unknown {
  assert.ok(result.content.length > 0, 'Result must have content');
  return JSON.parse(result.content[0].text);
}


// ============================================================================
// Tool Registration (F-P7-002, kills M-6)
// ============================================================================

describe('Phase 7 tool registration', () => {

  it('registerContextTools registers limen_context tool', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);
    const tools = getRegisteredTools(server);

    assert.ok(tools['limen_context'], 'limen_context must be registered');
    assert.equal(typeof tools['limen_context'].handler, 'function', 'handler must be a function');
    assert.equal(tools['limen_context'].enabled, true, 'tool must be enabled');
  });

  it('registerCognitiveTools registers limen_health_cognitive tool', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);
    const tools = getRegisteredTools(server);

    assert.ok(tools['limen_health_cognitive'], 'limen_health_cognitive must be registered');
    assert.equal(typeof tools['limen_health_cognitive'].handler, 'function');
  });

  it('registerSearchTools registers limen_search and limen_recall_bulk tools', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);
    const tools = getRegisteredTools(server);

    assert.ok(tools['limen_search'], 'limen_search must be registered');
    assert.ok(tools['limen_recall_bulk'], 'limen_recall_bulk must be registered');
  });

  it('registerClaimTools registers limen_claim_assert, limen_claim_query, and limen_recall', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);
    const tools = getRegisteredTools(server);

    assert.ok(tools['limen_claim_assert'], 'limen_claim_assert must be registered');
    assert.ok(tools['limen_claim_query'], 'limen_claim_query must be registered');
    assert.ok(tools['limen_recall'], 'limen_recall must be registered');
  });

  it('all Phase 7 tools are present after registration', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);
    const tools = getRegisteredTools(server);

    const phase7ToolNames = [
      'limen_context',
      'limen_health_cognitive',
      'limen_search',
      'limen_recall_bulk',
      'limen_claim_assert',
      'limen_claim_query',
      'limen_recall',
    ];

    for (const name of phase7ToolNames) {
      assert.ok(tools[name], `Tool "${name}" must be registered`);
    }
  });
});


// ============================================================================
// limen_context handler (kills M-1)
// ============================================================================

describe('limen_context MCP handler', () => {

  it('returns text-formatted beliefs for matching subject', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_context', {
      subject: 'entity:project:alpha',
    });

    assert.equal(result.isError, undefined, 'Must not be an error');
    const text = result.content[0].text;
    assert.ok(text.includes('Knowledge Context'), 'Must contain header');
    assert.ok(text.includes('entity:project:alpha'), 'Must contain subject');
    assert.ok(text.includes('microservices') || text.includes('TypeScript'), 'Must contain claim value');
    assert.ok(text.includes('confidence:'), 'Must contain confidence line');
  });

  it('returns empty message when no beliefs match', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_context', {
      subject: 'entity:nonexistent:xyz',
    });

    assert.equal(result.isError, undefined);
    const text = result.content[0].text;
    assert.ok(text.includes('No relevant beliefs found'), 'Must indicate empty result');
  });

  it('returns JSON format when format=json', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_context', {
      subject: 'entity:project:alpha',
      format: 'json',
    });

    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(parsed), 'JSON format must return an array');
    assert.ok(parsed.length >= 2, 'Must contain seeded beliefs');
  });

  it('clamps negative limit to 1 (F-P7-005)', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);
    const server = createServerWithTools(limen);

    // Negative limit should be clamped to 1, not passed through
    const result = await callTool(server, 'limen_context', {
      subject: 'entity:project:alpha',
      limit: -5,
      format: 'json',
    });

    assert.equal(result.isError, undefined, 'Negative limit must not cause error');
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(parsed), 'Must return array');
    // With limit clamped to 1, should return at most 1 belief
    assert.ok(parsed.length <= 1, `Clamped limit should return at most 1, got ${parsed.length}`);
  });
});


// ============================================================================
// limen_health_cognitive handler (kills M-3)
// ============================================================================

describe('limen_health_cognitive MCP handler', () => {

  it('returns cognitive health report for empty knowledge base', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_health_cognitive', {});

    assert.equal(result.isError, undefined);
    const report = parseResultText(result) as Record<string, unknown>;
    assert.equal(report.totalClaims, 0, 'Empty KB must have 0 totalClaims');
  });

  it('returns report reflecting seeded claims', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_health_cognitive', {});

    assert.equal(result.isError, undefined);
    const report = parseResultText(result) as Record<string, unknown>;
    assert.equal(report.totalClaims, 3, 'Must reflect 3 seeded claims');
  });

  it('accepts config parameters', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_health_cognitive', {
      gapThresholdDays: 7,
      staleThresholdDays: 30,
    });

    assert.equal(result.isError, undefined);
    const report = parseResultText(result) as Record<string, unknown>;
    assert.equal(typeof report.totalClaims, 'number');
  });
});


// ============================================================================
// limen_search handler (kills M-4)
// ============================================================================

describe('limen_search MCP handler', () => {

  it('returns matching beliefs for valid query', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_search', {
      query: 'microservices',
    });

    assert.equal(result.isError, undefined);
    const parsed = parseResultText(result) as Array<{ belief: Record<string, unknown>; relevance: number; score: number }>;
    assert.ok(Array.isArray(parsed), 'Must return array');
    assert.ok(parsed.length > 0, 'Must find microservices claim');
    assert.equal(typeof parsed[0].belief, 'object', 'Must have belief');
    assert.equal(typeof parsed[0].relevance, 'number', 'Must have relevance');
    assert.equal(typeof parsed[0].score, 'number', 'Must have score');
  });

  it('returns empty array for non-matching query', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_search', {
      query: 'zzzznonexistentterm',
    });

    assert.equal(result.isError, undefined);
    const parsed = parseResultText(result) as unknown[];
    assert.equal(parsed.length, 0, 'Non-matching search returns empty');
  });

  it('returns error for empty query', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_search', {
      query: '',
    });

    assert.equal(result.isError, true, 'Empty query must return error');
    const parsed = parseResultText(result) as Record<string, string>;
    assert.ok(parsed.error, 'Must have error code');
  });
});


// ============================================================================
// limen_recall_bulk handler (kills M-5, M-7)
// ============================================================================

describe('limen_recall_bulk MCP handler', () => {

  it('returns one result set per subject', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_recall_bulk', {
      subjects: JSON.stringify(['entity:project:alpha', 'entity:user:bob']),
    });

    assert.equal(result.isError, undefined);
    const parsed = parseResultText(result) as Array<{ subject: string; beliefs: unknown[] }>;
    assert.equal(parsed.length, 2, 'Must have one result per subject');
    assert.equal(parsed[0].subject, 'entity:project:alpha');
    assert.ok(parsed[0].beliefs.length >= 2, 'Alpha must have 2+ beliefs');
    assert.equal(parsed[1].subject, 'entity:user:bob');
    assert.ok(parsed[1].beliefs.length >= 1, 'Bob must have 1+ belief');
  });

  it('returns error for invalid JSON subjects', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_recall_bulk', {
      subjects: 'not-json',
    });

    assert.equal(result.isError, true, 'Invalid JSON must return error');
    const parsed = parseResultText(result) as Record<string, string>;
    assert.equal(parsed.error, 'INVALID_INPUT');
  });

  it('returns error for non-array JSON', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_recall_bulk', {
      subjects: JSON.stringify({ not: 'an array' }),
    });

    assert.equal(result.isError, true);
    const parsed = parseResultText(result) as Record<string, string>;
    assert.equal(parsed.error, 'INVALID_INPUT');
  });

  it('returns error for non-string elements in subjects array (F-P7-008)', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_recall_bulk', {
      subjects: JSON.stringify(['entity:x', 42, null]),
    });

    assert.equal(result.isError, true, 'Non-string elements must return error');
    const parsed = parseResultText(result) as Record<string, string>;
    assert.equal(parsed.error, 'INVALID_INPUT');
  });

  it('enforces 50-subject limit', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);

    const subjects = Array.from({ length: 51 }, (_, i) => `entity:test:${i}`);
    const result = await callTool(server, 'limen_recall_bulk', {
      subjects: JSON.stringify(subjects),
    });

    assert.equal(result.isError, true, '>50 subjects must return error');
    const parsed = parseResultText(result) as Record<string, string>;
    assert.equal(parsed.error, 'INVALID_INPUT');
    assert.ok(parsed.message.includes('50'), 'Error must mention 50 limit');
  });

  it('returns empty array for empty subjects', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_recall_bulk', {
      subjects: JSON.stringify([]),
    });

    assert.equal(result.isError, undefined);
    const parsed = parseResultText(result) as unknown[];
    assert.deepStrictEqual(parsed, [], 'Empty subjects returns empty array');
  });

  it('clamps negative limit to 1 (F-P7-005)', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);
    const server = createServerWithTools(limen);

    // Negative limit should be clamped, not passed through
    const result = await callTool(server, 'limen_recall_bulk', {
      subjects: JSON.stringify(['entity:project:alpha']),
      limit: -5,
    });

    assert.equal(result.isError, undefined, 'Negative limit must not cause error');
    const parsed = parseResultText(result) as Array<{ subject: string; beliefs: unknown[] }>;
    assert.equal(parsed.length, 1, 'Must have one result');
    // With clamped limit of 1, should return at most 1 belief per subject
    assert.ok(parsed[0].beliefs.length <= 1, `Clamped limit should return at most 1, got ${parsed[0].beliefs.length}`);
  });
});


// ============================================================================
// limen_recall handler (kills M-2: decay visibility)
// ============================================================================

describe('limen_recall MCP handler', () => {

  it('returns beliefs with effectiveConfidence and freshness', async () => {
    const limen = await createTestEngine();
    seedClaims(limen);
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_recall', {
      subject: 'entity:project:alpha',
    });

    assert.equal(result.isError, undefined);
    const beliefs = parseResultText(result) as Array<{
      effectiveConfidence: number;
      freshness: string;
      subject: string;
    }>;
    assert.ok(beliefs.length > 0, 'Must return beliefs');
    for (const b of beliefs) {
      assert.equal(typeof b.effectiveConfidence, 'number', 'Must have effectiveConfidence');
      assert.ok(b.effectiveConfidence >= 0 && b.effectiveConfidence <= 1, 'effectiveConfidence in [0,1]');
      assert.equal(typeof b.freshness, 'string', 'Must have freshness');
      assert.ok(['fresh', 'aging', 'stale'].includes(b.freshness), `freshness must be valid, got: ${b.freshness}`);
    }
  });

  it('returns empty array for non-matching subject', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);

    const result = await callTool(server, 'limen_recall', {
      subject: 'entity:nonexistent:xyz',
    });

    assert.equal(result.isError, undefined);
    const beliefs = parseResultText(result) as unknown[];
    assert.equal(beliefs.length, 0, 'Non-matching recall returns empty');
  });
});


// ============================================================================
// limen_claim_assert handler: JSON.parse guards (F-P7-003)
// ============================================================================

describe('limen_claim_assert MCP handler — JSON parse guards', () => {

  /** Helper: create a mission via async Limen API, return its ID. */
  async function createTestMission(limen: Limen): Promise<string> {
    await limen.agents.register({ name: 'test-agent' });
    const handle = await limen.missions.create({
      agent: 'test-agent',
      objective: 'test',
      constraints: {
        tokenBudget: 1000,
        deadline: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    return handle.id;
  }

  it('returns error for invalid objectValue JSON when objectType=json', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);

    // JSON parse error fires before engine call, so dummy missionId is fine
    const result = await callTool(server, 'limen_claim_assert', {
      subject: 'entity:test:alpha',
      predicate: 'test.prop',
      objectType: 'json',
      objectValue: 'not{valid}json',
      confidence: 0.8,
      validAt: new Date().toISOString(),
      missionId: 'dummy-mission-id',
      taskId: null,
      groundingMode: 'evidence_path',
    });

    assert.equal(result.isError, true, 'Invalid JSON objectValue must return error');
    const parsed = parseResultText(result) as Record<string, string>;
    assert.equal(parsed.error, 'INVALID_INPUT');
    assert.ok(parsed.message.includes('objectValue'), 'Error must mention objectValue');
  });

  it('returns error for invalid evidenceRefs JSON', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);

    // JSON parse error fires before engine call
    const result = await callTool(server, 'limen_claim_assert', {
      subject: 'entity:test:alpha',
      predicate: 'test.prop',
      objectType: 'string',
      objectValue: 'hello',
      confidence: 0.8,
      validAt: new Date().toISOString(),
      missionId: 'dummy-mission-id',
      taskId: null,
      groundingMode: 'evidence_path',
      evidenceRefs: '{broken json',
    });

    assert.equal(result.isError, true, 'Invalid JSON evidenceRefs must return error');
    const parsed = parseResultText(result) as Record<string, string>;
    assert.equal(parsed.error, 'INVALID_INPUT');
    assert.ok(parsed.message.includes('evidenceRefs'), 'Error must mention evidenceRefs');
  });

  it('returns error for invalid runtimeWitness JSON', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);

    // JSON parse error fires before engine call
    const result = await callTool(server, 'limen_claim_assert', {
      subject: 'entity:test:alpha',
      predicate: 'test.prop',
      objectType: 'string',
      objectValue: 'hello',
      confidence: 0.8,
      validAt: new Date().toISOString(),
      missionId: 'dummy-mission-id',
      taskId: null,
      groundingMode: 'runtime_witness',
      runtimeWitness: 'not-json!!!',
    });

    assert.equal(result.isError, true, 'Invalid JSON runtimeWitness must return error');
    const parsed = parseResultText(result) as Record<string, string>;
    assert.equal(parsed.error, 'INVALID_INPUT');
    assert.ok(parsed.message.includes('runtimeWitness'), 'Error must mention runtimeWitness');
  });

  it('succeeds with valid JSON objectValue when mission exists', async () => {
    const limen = await createTestEngine();
    const server = createServerWithTools(limen);
    const missionId = await createTestMission(limen);

    const result = await callTool(server, 'limen_claim_assert', {
      subject: 'entity:test:alpha',
      predicate: 'test.prop',
      objectType: 'json',
      objectValue: JSON.stringify({ key: 'value' }),
      confidence: 0.8,
      validAt: new Date().toISOString(),
      missionId,
      taskId: null,
      groundingMode: 'evidence_path',
    });

    // The key assertion: valid JSON must NOT produce INVALID_INPUT error.
    // The handler may produce an engine-level error (e.g. mission state),
    // but the JSON parsing stage must have succeeded.
    if (result.isError) {
      const errParsed = parseResultText(result) as Record<string, string>;
      assert.notEqual(errParsed.error, 'INVALID_INPUT',
        'Valid JSON must not produce INVALID_INPUT — engine error is acceptable, parse error is not');
    } else {
      const parsed = parseResultText(result) as Record<string, string>;
      assert.ok(parsed.id || parsed.claimId, 'Must return a claim ID');
    }
  });
});
