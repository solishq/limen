// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
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
import { containsControlChars } from './validation.js';

/** MCP error response helper. */
function mcpError(code: string, message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: code, message }) }],
    isError: true as const,
  };
}

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
      // Structural completeness: reject control characters in all user-controlled strings
      if (containsControlChars(args.name)) {
        return mcpError('INVALID_INPUT', 'name contains control characters');
      }
      if (args.domains && containsControlChars(args.domains)) {
        return mcpError('INVALID_INPUT', 'domains contains control characters');
      }
      if (args.capabilities && containsControlChars(args.capabilities)) {
        return mcpError('INVALID_INPUT', 'capabilities contains control characters');
      }

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
      if (containsControlChars(args.name)) {
        return mcpError('INVALID_INPUT', 'name contains control characters');
      }
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
      if (containsControlChars(args.name)) {
        return mcpError('INVALID_INPUT', 'name contains control characters');
      }
      const agent = await limen.agents.promote(args.name);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(agent, null, 2) }],
      };
    },
  );
}
