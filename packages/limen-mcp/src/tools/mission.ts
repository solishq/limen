/**
 * Mission management MCP tools.
 *
 * limen_mission_create — Create a new mission with objectives and constraints
 * limen_mission_list   — List missions with optional state filter
 *
 * Maps to: limen.missions.create/list
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen } from 'limen-ai';
import { z } from 'zod';

export function registerMissionTools(server: McpServer, limen: Limen): void {

  // ── limen_mission_create ──
  server.tool(
    'limen_mission_create',
    'Create a new mission with an objective and resource constraints',
    {
      agent: z.string().describe('Agent name to execute this mission'),
      objective: z.string().describe('Mission objective statement'),
      tokenBudget: z.number().describe('Maximum token budget for this mission'),
      deadline: z.string().describe('ISO 8601 deadline timestamp'),
      successCriteria: z.string().optional().describe('Comma-separated success criteria'),
    },
    async (args) => {
      const successCriteria = args.successCriteria
        ? args.successCriteria.split(',').map((c) => c.trim()).filter(Boolean)
        : undefined;

      const handle = await limen.missions.create({
        agent: args.agent,
        objective: args.objective,
        constraints: {
          tokenBudget: args.tokenBudget,
          deadline: args.deadline,
        },
        successCriteria,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            id: handle.id,
            state: handle.state,
            budget: handle.budget,
          }, null, 2),
        }],
      };
    },
  );

  // ── limen_mission_list ──
  server.tool(
    'limen_mission_list',
    'List missions, optionally filtered by state',
    {
      state: z.string().optional().describe('Filter by mission state (CREATED, PLANNING, EXECUTING, REVIEWING, COMPLETED, PAUSED, FAILED, CANCELLED, DEGRADED, BLOCKED)'),
      limit: z.number().optional().describe('Maximum number of results (default: 50)'),
    },
    async (args) => {
      const filter: {
        state?: 'CREATED' | 'PLANNING' | 'EXECUTING' | 'REVIEWING' | 'COMPLETED' | 'PAUSED' | 'FAILED' | 'CANCELLED' | 'DEGRADED' | 'BLOCKED';
        limit?: number;
      } = {};

      if (args.state) {
        filter.state = args.state as typeof filter.state;
      }
      if (args.limit !== undefined) {
        filter.limit = args.limit;
      }

      const missions = await limen.missions.list(filter);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(missions, null, 2) }],
      };
    },
  );
}
