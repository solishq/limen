// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Replay MCP Tool — limen_replay_verify.
 *
 * v3.0.0 Phase 3: Exposes limen.replay.verify() as MCP tool.
 * Verifies mission replay determinism by comparing state snapshots.
 *
 * Delegates to: limen.replay.verify(missionId)
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

export function registerReplayTools(server: McpServer, limen: Limen): void {

  // ── limen_replay_verify ──
  server.tool(
    'limen_replay_verify',
    'Verify replay determinism for a completed mission. Compares start and end state snapshots to detect divergences in mission state.',
    {
      missionId: z.string().min(1).describe('Mission ID to verify replay determinism for'),
    },
    async (args) => {
      if (containsControlChars(args.missionId)) {
        return mcpError('INVALID_INPUT', 'missionId contains prohibited control characters.');
      }
      const result = safeCall(() => limen.replay.verify(args.missionId));

      if (!result.ok) {
        return mcpError(result.error.code, result.error.message);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );
}
