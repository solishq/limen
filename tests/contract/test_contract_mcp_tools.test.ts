/**
 * Contract tests for v3.0.0 Phase 3: MCP Tool Completion.
 *
 * Verifies that all 11 new MCP tools are properly registered and callable
 * via the MCP server. Tests the tool registration layer, not the backing
 * engine methods (those are covered by their respective contract tests).
 *
 * Tools verified:
 *   1.  limen_consolidate
 *   2.  limen_importance
 *   3.  limen_narrative
 *   4.  limen_verify
 *   5.  limen_suggest_connections
 *   6.  limen_replay_verify
 *   7.  limen_governance_erasure
 *   8.  limen_governance_audit_export
 *   9.  limen_consent_register
 *   10. limen_consent_check
 *   11. limen_maintenance_retention
 *
 * Strategy: Import the register* functions and verify they register
 * tools with the correct names on a mock McpServer.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Minimal McpServer stub that captures tool registrations.
 * We only need the tool() method signature to verify registration.
 */
class MockMcpServer {
  readonly registeredTools: Map<string, { description: string; schema: unknown; handler: unknown }> = new Map();

  tool(name: string, description: string, schema: unknown, handler: unknown): void {
    this.registeredTools.set(name, { description, schema, handler });
  }
}

/**
 * Minimal Limen stub with all namespaces that the tools access.
 * Methods return Result objects to satisfy the safeCall pattern.
 */
function createMockLimen(): unknown {
  const okResult = { ok: true, value: {} };
  const asyncOkResult = Promise.resolve(okResult);

  return {
    cognitive: {
      health: () => okResult,
      consolidate: () => okResult,
      importance: () => okResult,
      narrative: () => okResult,
      verify: () => asyncOkResult,
      suggestConnections: () => asyncOkResult,
      acceptSuggestion: () => okResult,
      rejectSuggestion: () => okResult,
    },
    replay: {
      verify: () => okResult,
      getSnapshots: () => okResult,
    },
    governance: {
      erasure: () => okResult,
      exportAudit: () => okResult,
      addRule: () => okResult,
      removeRule: () => okResult,
      listRules: () => okResult,
      protectPredicate: () => okResult,
      listProtectedPredicates: () => okResult,
    },
    consent: {
      register: () => okResult,
      check: () => okResult,
      revoke: () => okResult,
      list: () => okResult,
    },
    maintenance: {
      runRetention: () => okResult,
      getRetentionPolicies: () => okResult,
      updateRetentionPolicy: () => okResult,
    },
  };
}

// ── Dynamic imports to handle ESM module resolution ──

describe('Phase 3: MCP Tool Registration', () => {

  it('registerCognitiveTools registers limen_health_cognitive, Phase 12 tools, and FR-008', async () => {
    const { registerCognitiveTools } = await import('../../packages/limen-mcp/src/tools/cognitive.js');
    const server = new MockMcpServer();
    const limen = createMockLimen();

    registerCognitiveTools(server as unknown as Parameters<typeof registerCognitiveTools>[0], limen as Parameters<typeof registerCognitiveTools>[1]);

    const expectedTools = [
      'limen_health_cognitive',
      'limen_health_delta',
      'limen_consolidate',
      'limen_importance',
      'limen_narrative',
      'limen_verify',
      'limen_suggest_connections',
      'limen_prepare_for_task',
    ];

    for (const toolName of expectedTools) {
      assert.ok(server.registeredTools.has(toolName), `Tool '${toolName}' should be registered`);
      const tool = server.registeredTools.get(toolName);
      assert.ok(tool, `Tool '${toolName}' registration data should exist`);
      assert.ok(typeof tool.description === 'string' && tool.description.length > 0, `Tool '${toolName}' should have a non-empty description`);
      assert.ok(typeof tool.handler === 'function', `Tool '${toolName}' should have a handler function`);
    }

    assert.equal(server.registeredTools.size, 8, 'Should register exactly 8 cognitive tools');
  });

  it('registerReplayTools registers limen_replay_verify', async () => {
    const { registerReplayTools } = await import('../../packages/limen-mcp/src/tools/replay.js');
    const server = new MockMcpServer();
    const limen = createMockLimen();

    registerReplayTools(server as unknown as Parameters<typeof registerReplayTools>[0], limen as Parameters<typeof registerReplayTools>[1]);

    assert.ok(server.registeredTools.has('limen_replay_verify'), 'limen_replay_verify should be registered');
    assert.equal(server.registeredTools.size, 1, 'Should register exactly 1 replay tool');
  });

  it('registerGovernanceTools registers limen_governance_erasure and limen_governance_audit_export', async () => {
    const { registerGovernanceTools } = await import('../../packages/limen-mcp/src/tools/governance.js');
    const server = new MockMcpServer();
    const limen = createMockLimen();

    registerGovernanceTools(server as unknown as Parameters<typeof registerGovernanceTools>[0], limen as Parameters<typeof registerGovernanceTools>[1]);

    assert.ok(server.registeredTools.has('limen_governance_erasure'), 'limen_governance_erasure should be registered');
    assert.ok(server.registeredTools.has('limen_governance_audit_export'), 'limen_governance_audit_export should be registered');
    assert.equal(server.registeredTools.size, 2, 'Should register exactly 2 governance tools');
  });

  it('registerConsentTools registers limen_consent_register and limen_consent_check', async () => {
    const { registerConsentTools } = await import('../../packages/limen-mcp/src/tools/consent.js');
    const server = new MockMcpServer();
    const limen = createMockLimen();

    registerConsentTools(server as unknown as Parameters<typeof registerConsentTools>[0], limen as Parameters<typeof registerConsentTools>[1]);

    assert.ok(server.registeredTools.has('limen_consent_register'), 'limen_consent_register should be registered');
    assert.ok(server.registeredTools.has('limen_consent_check'), 'limen_consent_check should be registered');
    assert.equal(server.registeredTools.size, 2, 'Should register exactly 2 consent tools');
  });

  it('registerMaintenanceTools registers limen_maintenance_retention', async () => {
    const { registerMaintenanceTools } = await import('../../packages/limen-mcp/src/tools/maintenance.js');
    const server = new MockMcpServer();
    const limen = createMockLimen();

    registerMaintenanceTools(server as unknown as Parameters<typeof registerMaintenanceTools>[0], limen as Parameters<typeof registerMaintenanceTools>[1]);

    assert.ok(server.registeredTools.has('limen_maintenance_retention'), 'limen_maintenance_retention should be registered');
    assert.equal(server.registeredTools.size, 1, 'Should register exactly 1 maintenance tool');
  });

  it('all 11 new tools have unique names and non-empty descriptions', async () => {
    const { registerCognitiveTools } = await import('../../packages/limen-mcp/src/tools/cognitive.js');
    const { registerReplayTools } = await import('../../packages/limen-mcp/src/tools/replay.js');
    const { registerGovernanceTools } = await import('../../packages/limen-mcp/src/tools/governance.js');
    const { registerConsentTools } = await import('../../packages/limen-mcp/src/tools/consent.js');
    const { registerMaintenanceTools } = await import('../../packages/limen-mcp/src/tools/maintenance.js');

    const server = new MockMcpServer();
    const limen = createMockLimen();

    // Register all tools on a single server to detect name collisions
    registerCognitiveTools(server as unknown as Parameters<typeof registerCognitiveTools>[0], limen as Parameters<typeof registerCognitiveTools>[1]);
    registerReplayTools(server as unknown as Parameters<typeof registerReplayTools>[0], limen as Parameters<typeof registerReplayTools>[1]);
    registerGovernanceTools(server as unknown as Parameters<typeof registerGovernanceTools>[0], limen as Parameters<typeof registerGovernanceTools>[1]);
    registerConsentTools(server as unknown as Parameters<typeof registerConsentTools>[0], limen as Parameters<typeof registerConsentTools>[1]);
    registerMaintenanceTools(server as unknown as Parameters<typeof registerMaintenanceTools>[0], limen as Parameters<typeof registerMaintenanceTools>[1]);

    // 8 cognitive + 1 replay + 2 governance + 2 consent + 1 maintenance = 14
    assert.equal(server.registeredTools.size, 14, 'Should register 14 tools total');

    // Verify tool names
    const newToolNames = [
      'limen_consolidate',
      'limen_importance',
      'limen_narrative',
      'limen_verify',
      'limen_suggest_connections',
      'limen_health_delta',
      'limen_prepare_for_task',
      'limen_replay_verify',
      'limen_governance_erasure',
      'limen_governance_audit_export',
      'limen_consent_register',
      'limen_consent_check',
      'limen_maintenance_retention',
    ];

    for (const name of newToolNames) {
      assert.ok(server.registeredTools.has(name), `New tool '${name}' should be registered`);
      const tool = server.registeredTools.get(name);
      assert.ok(tool, `Tool '${name}' data should exist`);
      assert.ok(tool.description.length > 10, `Tool '${name}' description should be substantive (>10 chars)`);
    }
  });
});
