#!/usr/bin/env node

/**
 * Limen MCP Server — Claude Code native integration.
 *
 * Boots a long-running Limen engine instance and exposes it
 * via the Model Context Protocol over stdio transport.
 *
 * Tools:
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
 * Resources:
 *   limen://health        — Health status JSON
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { bootstrapEngine } from './bootstrap.js';
import { registerHealthTools } from './tools/health.js';
import { registerAgentTools } from './tools/agent.js';
import { registerMissionTools } from './tools/mission.js';
import { registerClaimTools } from './tools/claim.js';
import { registerWmTools } from './tools/wm.js';
import { registerHealthResource } from './resources/health.js';

async function main(): Promise<void> {
  // Boot the Limen engine (reads ~/.limen/config.json)
  const { limen, shutdown } = await bootstrapEngine();

  // Create the MCP server
  const server = new McpServer({
    name: 'limen',
    version: '1.0.0',
  });

  // Register tools
  registerHealthTools(server, limen);
  registerAgentTools(server, limen);
  registerMissionTools(server, limen);
  registerClaimTools(server, limen);
  registerWmTools(server, limen);

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
