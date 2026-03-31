#!/usr/bin/env node

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
 * High-level knowledge tools (session-managed):
 *   limen_session_open    — Open a knowledge session for a project
 *   limen_session_close   — Close session with optional summary
 *   limen_remember        — Assert a knowledge claim (simplified)
 *   limen_recall          — Query claims, excluding superseded
 *   limen_connect         — Relate claims with governance protection
 *   limen_reflect         — Batch-assert categorized learnings
 *   limen_scratch         — Session-scoped scratch working memory
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
