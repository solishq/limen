/**
 * limen_health — MCP tool for Limen engine health status.
 *
 * Maps to: limen.health()
 * Returns: HealthStatus as JSON text content.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen } from 'limen-ai';

export function registerHealthTools(server: McpServer, limen: Limen): void {
  server.tool(
    'limen_health',
    'Get Limen engine health status (healthy/degraded/unhealthy with subsystem details)',
    async () => {
      const status = await limen.health();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
      };
    },
  );
}
