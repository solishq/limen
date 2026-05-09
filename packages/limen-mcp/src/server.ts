#!/usr/bin/env node
// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1

/**
 * Limen MCP Server — AI agent native integration via Model Context Protocol.
 *
 * Boots a long-running Limen engine instance and exposes it
 * via the Model Context Protocol over stdio transport.
 *
 * Low-level tools (direct engine access):
 *   limen_health          — Engine health status
 *   limen_agent_register  — Register a new agent
 *   limen_agent_list      — List all agents
 *   limen_agent_get       — Get agent by name
 *   limen_agent_promote   — Promote agent trust level
 *   limen_mission_create  — Create a mission
 *   limen_mission_list    — List missions
 *   limen_claim_assert    — Assert a knowledge claim
 *   limen_claim_query     — Query claims
 *   limen_wm_write        — Write to working memory
 *   limen_wm_read         — Read from working memory
 *   limen_wm_discard      — Discard from working memory
 *
 * Phase 7 enhancement tools (convenience API wrappers):
 *   limen_recall          — Recall beliefs with decay visibility (effectiveConfidence, freshness)
 *   limen_context         — Generate knowledge summary for system prompts
 *   limen_health_cognitive— Cognitive health report (freshness, conflicts, gaps)
 *   limen_search          — Full-text search across claim content
 *   limen_recall_bulk     — Recall beliefs for multiple subjects in one call
 *
 * Learning tools (Amendment 25 — convenience API wrappers):
 *   limen_remember        — Store a knowledge claim (3-param: subject, predicate, value)
 *   limen_reflect         — Batch-store categorized learnings (decision/pattern/warning/finding)
 *   limen_forget          — Retract a claim (governed, audited)
 *   limen_connect         — Relate two claims (supports/contradicts/supersedes/derived_from)
 *
 * v3.0.0 Phase 3 tools (MCP Tool Completion):
 *   limen_consolidate          — Run cognitive consolidation (merge/archive/resolve)
 *   limen_importance           — Compute 5-factor importance score for a claim
 *   limen_narrative            — Compute narrative snapshot (mission or global)
 *   limen_verify               — Verify a claim via external provider (advisory)
 *   limen_suggest_connections  — Suggest connections via embedding similarity
 *   limen_replay_verify        — Verify mission replay determinism
 *   limen_governance_erasure   — Execute GDPR erasure with certificate
 *   limen_governance_audit_export — Generate SOC 2 audit export
 *   limen_consent_register     — Register consent record
 *   limen_consent_check        — Check active consent
 *   limen_maintenance_retention — Execute manual retention pass
 *
 * Resources:
 *   limen://health        — Health status JSON
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { bootstrapEngine } from './bootstrap.js';
import { SessionAdapter } from './adapter.js';
import { registerHealthTools } from './tools/health.js';
import { registerAgentTools } from './tools/agent.js';
import { registerMissionTools } from './tools/mission.js';
import { registerClaimTools } from './tools/claim.js';
import { registerWmTools } from './tools/wm.js';
import { registerContextTools } from './tools/context.js';
import { registerCognitiveTools } from './tools/cognitive.js';
import { registerSearchTools } from './tools/search.js';
import { registerLearningTools } from './tools/learning.js';
import { registerA2AChatTools } from './tools/a2a-chat.js';
import { registerReplayTools } from './tools/replay.js';
import { registerGovernanceTools } from './tools/governance.js';
import { registerConsentTools } from './tools/consent.js';
import { registerMaintenanceTools } from './tools/maintenance.js';
import { registerOutputTools } from './tools/output.js';
import { registerTelemetryTools } from './tools/telemetry.js';
import { registerA2AGovernanceTools } from './tools/a2a-governance.js';
import { registerHealthResource } from './resources/health.js';

async function main(): Promise<void> {
  // Boot the Limen engine (reads ~/.limen/config.json)
  const { limen, shutdown } = await bootstrapEngine();

  // Configure governance protection from environment
  const protectedPrefixes = process.env.LIMEN_PROTECTED_PREFIXES
    ? new Set(process.env.LIMEN_PROTECTED_PREFIXES.split(',').map(p => p.trim()))
    : new Set<string>();

  // Initialize session adapter (registers "limen-mcp" agent)
  const adapter = new SessionAdapter(limen, { protectedPrefixes });
  await adapter.init();

  // Create the MCP server
  const server = new McpServer({
    name: 'limen',
    version: '1.0.0',
  });

  // Register low-level tools (direct engine access)
  registerHealthTools(server, limen);
  registerAgentTools(server, limen);
  registerMissionTools(server, limen);
  registerClaimTools(server, limen);
  registerWmTools(server, limen);

  // Register Phase 7 enhancement tools (convenience API wrappers)
  registerContextTools(server, limen);
  registerCognitiveTools(server, limen);
  registerSearchTools(server, limen);

  // Register learning tools (Amendment 25 — F-15: pass adapter for governance)
  registerLearningTools(server, limen, adapter);

  // Register A2A chat tools (direct-tool coordination channel — canonical per Femi directive 2026-04-19).
  registerA2AChatTools(server, limen, 'stdio');

  // Register v3.0.0 Phase 3 tools (MCP Tool Completion)
  registerReplayTools(server, limen);
  registerGovernanceTools(server, limen);
  registerConsentTools(server, limen);
  registerMaintenanceTools(server, limen);

  // Register Phase 4 FR-001: Output Primitives tools
  registerOutputTools(server, limen);

  // Register Phase 7 FR-004: Telemetry tools
  registerTelemetryTools(server, limen);

  // Register Phase 7 FR-002: A2A Governance tools
  registerA2AGovernanceTools(server, limen);

  // Register resources
  registerHealthResource(server, limen);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown on signals
  const handleShutdown = async (): Promise<void> => {
    await server.close();
    await shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => void handleShutdown());
  process.on('SIGTERM', () => void handleShutdown());
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`limen-mcp: fatal: ${message}\n`);
  process.exit(1);
});
