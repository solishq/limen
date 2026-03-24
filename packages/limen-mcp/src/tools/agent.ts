/**
 * Agent management MCP tools.
 *
 * limen_agent_register — Register a new AI agent
 * limen_agent_list    — List all registered agents
 * limen_agent_get     — Get agent by name
 * limen_agent_promote — Promote agent trust level
 *
 * Maps to: limen.agents.register/list/get/promote
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen } from 'limen-ai';
import { z } from 'zod';

export function registerAgentTools(server: McpServer, limen: Limen): void {

  // ── limen_agent_register ──
  server.tool(
    'limen_agent_register',
    'Register a new AI agent with the Limen engine',
    {
      name: z.string().describe('Unique agent name'),
      domains: z.string().optional().describe('Comma-separated domain list (e.g. "finance,analytics")'),
      capabilities: z.string().optional().describe('Comma-separated capability list'),
    },
    async (args) => {
      const domains = args.domains
        ? args.domains.split(',').map((d) => d.trim()).filter(Boolean)
        : undefined;
      const capabilities = args.capabilities
        ? args.capabilities.split(',').map((c) => c.trim()).filter(Boolean)
        : undefined;

      const agent = await limen.agents.register({
        name: args.name,
        domains,
        capabilities,
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(agent, null, 2) }],
      };
    },
  );

  // ── limen_agent_list ──
  server.tool(
    'limen_agent_list',
    'List all registered AI agents',
    async () => {
      const agents = await limen.agents.list();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(agents, null, 2) }],
      };
    },
  );

  // ── limen_agent_get ──
  server.tool(
    'limen_agent_get',
    'Get a specific agent by name',
    {
      name: z.string().describe('Agent name to look up'),
    },
    async (args) => {
      const agent = await limen.agents.get(args.name);
      if (!agent) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'AGENT_NOT_FOUND', name: args.name }) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(agent, null, 2) }],
      };
    },
  );

  // ── limen_agent_promote ──
  server.tool(
    'limen_agent_promote',
    'Promote an agent to the next trust level (untrusted -> probationary -> trusted -> admin)',
    {
      name: z.string().describe('Agent name to promote'),
    },
    async (args) => {
      const agent = await limen.agents.promote(args.name);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(agent, null, 2) }],
      };
    },
  );
}
