/**
 * Maintenance MCP Tool — limen_maintenance_retention.
 *
 * v3.0.0 Phase 3: Exposes limen.maintenance.runRetention() as MCP tool.
 * Executes a manual retention pass: archives/deletes records past retention period.
 *
 * Delegates to: limen.maintenance.runRetention()
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen } from 'limen-ai';
/** MCP error response helper. */
function mcpError(code: string, message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: code, message }) }],
    isError: true as const,
  };
}

/**
 * Wraps a synchronous API call that may THROW.
 */
function safeCall<T>(fn: () => T): T | { ok: false; error: { code: string; message: string } } {
  try {
    const result = fn();
    if (result && typeof (result as Record<string, unknown>).then === 'function') {
      return { ok: false, error: { code: 'ASYNC_NOT_SUPPORTED', message: 'Method returned a Promise — expected synchronous Result<T>' } };
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { code: 'ENGINE_UNHEALTHY', message } };
  }
}

export function registerMaintenanceTools(server: McpServer, limen: Limen): void {

  // ── limen_maintenance_retention (v3.0.0 WG-01) ──
  server.tool(
    'limen_maintenance_retention',
    'Execute a manual retention pass. Archives or deletes records past their retention period based on configured policies. Audit entries are always archived, never deleted.',
    // No required parameters — retention uses configured policies
    {},
    async () => {
      const result = safeCall(() => limen.maintenance.runRetention());

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );
}
