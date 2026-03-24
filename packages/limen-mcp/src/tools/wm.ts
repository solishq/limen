/**
 * Working Memory Protocol (WMP) MCP tools.
 *
 * limen_wm_write   — Write a key-value entry to task working memory
 * limen_wm_read    — Read one entry or list all entries from task working memory
 * limen_wm_discard — Discard one entry or all entries from task working memory
 *
 * Maps to: limen.workingMemory.write/read/discard
 *
 * Working memory is task-scoped (WMP-I1): all operations require a taskId.
 * Entries are freely revisable within task scope (WMP-I3).
 * Discarded on task terminal state (WMP-I2).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen, TaskId } from 'limen-ai';
import { z } from 'zod';

export function registerWmTools(server: McpServer, limen: Limen): void {

  // ── limen_wm_write ──
  server.tool(
    'limen_wm_write',
    'Write a key-value entry to a task\'s working memory. Creates new or replaces existing entry.',
    {
      taskId: z.string().describe('Task ID that owns this working memory namespace'),
      key: z.string().describe('Entry key (max 256 chars, no whitespace, no path separators, no _wmp. prefix)'),
      value: z.string().describe('Entry value (UTF-8 text)'),
    },
    async (args) => {
      const result = limen.workingMemory.write({
        taskId: args.taskId as TaskId,
        key: args.key,
        value: args.value,
      });

      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error.code, message: result.error.message }) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );

  // ── limen_wm_read ──
  server.tool(
    'limen_wm_read',
    'Read from a task\'s working memory. Provide a key to read one entry, or omit key to list all entries.',
    {
      taskId: z.string().describe('Task ID that owns this working memory namespace'),
      key: z.string().nullable().optional().describe('Entry key to read (null or omitted to list all entries)'),
    },
    async (args) => {
      const result = limen.workingMemory.read({
        taskId: args.taskId as TaskId,
        key: args.key ?? null,
      });

      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error.code, message: result.error.message }) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );

  // ── limen_wm_discard ──
  server.tool(
    'limen_wm_discard',
    'Discard entries from a task\'s working memory. Provide a key to discard one entry, or omit key to discard all.',
    {
      taskId: z.string().describe('Task ID that owns this working memory namespace'),
      key: z.string().nullable().optional().describe('Entry key to discard (null or omitted to discard all entries)'),
    },
    async (args) => {
      const result = limen.workingMemory.discard({
        taskId: args.taskId as TaskId,
        key: args.key ?? null,
      });

      if (!result.ok) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error.code, message: result.error.message }) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }],
      };
    },
  );
}
