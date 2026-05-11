// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Output Primitives MCP Tools — limen_output_assert + limen_output_query.
 *
 * FR-001: Exposes semantic output primitives as MCP tools for agent use.
 * Wraps limen.output.assert() and limen.output.query() methods.
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

export function registerOutputTools(server: McpServer, limen: Limen): void {

  // ── limen_output_assert ──
  server.tool(
    'limen_output_assert',
    'Assert a structured output primitive as a governed claim. Validates against schema. Types: output.assertion, output.judgment, output.evidence, output.action, output.question, output.alert, output.narrative.',
    {
      predicate: z.string().describe('Output predicate (e.g., "output.judgment", "output.alert")'),
      primitive: z.string().describe('JSON object matching the primitive schema for this type'),
      subject: z.string().optional().describe('Subject URN (auto-generated if omitted)'),
      confidence: z.number().optional().describe('Confidence 0.0-1.0 (capped at maxAutoConfidence)'),
    },
    async (args) => {
      // R3-01: Reject control characters in primitive and predicate fields
      if (containsControlChars(args.primitive)) {
        return mcpError('INVALID_INPUT', 'primitive contains control characters');
      }
      if (containsControlChars(args.predicate)) {
        return mcpError('INVALID_INPUT', 'predicate contains control characters');
      }
      if (args.subject && containsControlChars(args.subject)) {
        return mcpError('INVALID_INPUT', 'subject contains control characters');
      }

      // Parse primitive JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(args.primitive);
      } catch {
        return mcpError('INVALID_INPUT', `primitive is not valid JSON: ${args.primitive}`);
      }
      // F-SEC-008: Runtime structure validation — primitive must be a non-null object
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return mcpError('INVALID_INPUT', 'primitive must be a JSON object (not array, null, or primitive)');
      }

      const result = safeCall(() =>
        limen.output.assert(args.predicate, parsed as object, {
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

  // ── limen_output_query ──
  server.tool(
    'limen_output_query',
    'Query output primitives by type. Returns stored semantic output claims.',
    {
      type: z.string().optional().describe('Output type to filter (e.g., "output.judgment"). Omit for all output.* claims.'),
      subject: z.string().optional().describe('Subject URN filter'),
      limit: z.number().optional().describe('Maximum results (default: 50)'),
    },
    async (args) => {
      if (args.type && containsControlChars(args.type)) {
        return mcpError('INVALID_INPUT', 'type contains control characters');
      }
      if (args.subject && containsControlChars(args.subject)) {
        return mcpError('INVALID_INPUT', 'subject contains control characters');
      }
      const result = safeCall(() =>
        limen.output.query(args.type, {
          subject: args.subject,
          limit: args.limit,
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
