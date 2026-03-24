/**
 * limen://health — MCP resource providing engine health status.
 *
 * Returns HealthStatus as JSON. Useful for monitoring the engine
 * state without invoking a tool call.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen } from 'limen-ai';

export function registerHealthResource(server: McpServer, limen: Limen): void {
  server.resource(
    'health',
    'limen://health',
    async (uri) => {
      const status = await limen.health();
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(status, null, 2),
        }],
      };
    },
  );
}
