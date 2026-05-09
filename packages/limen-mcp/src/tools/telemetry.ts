// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Telemetry MCP Tools — limen_telemetry_record + limen_telemetry_query.
 *
 * FR-004: Exposes operational telemetry as MCP tools for agent use.
 * Wraps limen.telemetry.record() and limen.telemetry.query() methods.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen } from 'limen-ai';
import { z } from 'zod';

/** MCP error response helper. */
function mcpError(code: string, message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: code, message }) }],
    isError: true as const,
  };
}

/**
 * Wraps a synchronous convenience API call that may THROW.
 */
function safeCall<T>(fn: () => T): T | { ok: false; error: { code: string; message: string } } {
  try {
    const result = fn();
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { code: 'ENGINE_UNHEALTHY', message } };
  }
}

export function registerTelemetryTools(server: McpServer, limen: Limen): void {

  // ── limen_telemetry_record ──
  server.tool(
    'limen_telemetry_record',
    'Record a telemetry data point as a governed claim. Types: cost (LLM consumption), vital (operational signal), audit (action trail). Schema-validated.',
    {
      type: z.enum(['cost', 'vital', 'audit']).describe('Telemetry type'),
      data: z.string().describe('JSON object matching the telemetry schema for this type'),
      subject: z.string().optional().describe('Subject URN (auto-generated if omitted)'),
      confidence: z.number().optional().describe('Confidence 0.0-1.0 (capped at maxAutoConfidence)'),
    },
    async (args) => {
      // Parse data JSON
      let parsed: object;
      try {
        parsed = JSON.parse(args.data) as object;
      } catch {
        return mcpError('INVALID_INPUT', `data is not valid JSON: ${args.data}`);
      }

      const result = safeCall(() =>
        limen.telemetry.record(args.type, parsed, {
          subject: args.subject,
          confidence: args.confidence,
        }),
      );

      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        return mcpError(
          (result as { error: { code: string } }).error.code,
          (result as { error: { message: string } }).error.message,
        );
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // ── limen_telemetry_query ──
  server.tool(
    'limen_telemetry_query',
    'Query telemetry claims by type. Returns stored telemetry data points.',
    {
      type: z.string().optional().describe('Telemetry type to filter (e.g., "cost"). Omit for all telemetry.* claims.'),
      subject: z.string().optional().describe('Subject URN filter'),
      limit: z.number().optional().describe('Maximum results (default: 50)'),
      since: z.string().optional().describe('ISO 8601 timestamp: only return claims created after this time'),
    },
    async (args) => {
      const result = safeCall(() =>
        limen.telemetry.query(args.type, {
          subject: args.subject,
          limit: args.limit,
          since: args.since,
        }),
      );

      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        return mcpError(
          (result as { error: { code: string } }).error.code,
          (result as { error: { message: string } }).error.message,
        );
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}
