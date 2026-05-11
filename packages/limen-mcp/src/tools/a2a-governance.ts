// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * A2A Governance MCP Tools — governance block + proactive rule management.
 *
 * FR-002: Exposes A2A governance as MCP tools for agent use.
 * Wraps limen.a2aGovernance.* methods.
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

export function registerA2AGovernanceTools(server: McpServer, limen: Limen): void {

  // ── limen_a2a_governance_set ──
  server.tool(
    'limen_a2a_governance_set',
    'Set the A2A governance block (provider-level governance metadata). Validates against schema. Setting a new block supersedes the previous one.',
    {
      block: z.string().describe('JSON governance block object'),
    },
    async (args) => {
      // Structural completeness: reject control characters in JSON string inputs
      if (containsControlChars(args.block)) {
        return mcpError('INVALID_INPUT', 'block contains control characters');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(args.block);
      } catch {
        return mcpError('INVALID_INPUT', `block is not valid JSON: ${args.block}`);
      }
      // F-SEC-008: Runtime structure validation — governance block must be a non-null object
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return mcpError('INVALID_INPUT', 'governance block must be a JSON object (not array, null, or primitive)');
      }

      const result = safeCall(() =>
        limen.a2aGovernance.setGovernanceBlock(parsed as object),
      );

      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        return mcpError(
          (result as { error: { code: string } }).error.code,
          (result as { error: { message: string } }).error.message,
        );
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }],
      };
    },
  );

  // ── limen_a2a_governance_get ──
  server.tool(
    'limen_a2a_governance_get',
    'Get the current A2A governance block. Returns null if no governance block has been set.',
    {},
    async () => {
      const result = safeCall(() =>
        limen.a2aGovernance.getGovernanceBlock(),
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

  // ── limen_proactive_rule_register ──
  server.tool(
    'limen_proactive_rule_register',
    'Register a proactive rule for inter-agent automation. Validates against schema. Requires approvedBy field.',
    {
      rule: z.string().describe('JSON proactive rule object'),
    },
    async (args) => {
      if (containsControlChars(args.rule)) {
        return mcpError('INVALID_INPUT', 'rule contains control characters');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(args.rule);
      } catch {
        return mcpError('INVALID_INPUT', `rule is not valid JSON: ${args.rule}`);
      }
      // F-SEC-008: Runtime structure validation — proactive rule must be a non-null object
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return mcpError('INVALID_INPUT', 'proactive rule must be a JSON object (not array, null, or primitive)');
      }

      const result = safeCall(() =>
        limen.a2aGovernance.registerProactiveRule(parsed as object),
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

  // ── limen_proactive_rule_list ──
  server.tool(
    'limen_proactive_rule_list',
    'List registered proactive rules. Optionally filter by status (active/suspended/retired).',
    {
      status: z.string().optional().describe('Filter by rule status: active, suspended, retired'),
    },
    async (args) => {
      if (args.status && containsControlChars(args.status)) {
        return mcpError('INVALID_INPUT', 'status contains control characters');
      }
      const result = safeCall(() =>
        limen.a2aGovernance.listProactiveRules(args.status),
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
