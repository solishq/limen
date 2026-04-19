/**
 * A2A Chat MCP Tools — Limen-native agent-to-agent messaging.
 *
 * Implements a group chat and direct messaging system using Limen claims
 * as the backing store. Every message is a governed, auditable claim.
 *
 * Predicate convention:
 *   Subject:    entity:channel:{channel}  (group chat)
 *               entity:dm:{agent1}_{agent2}   (direct message)
 *   Predicate:  a2a.message
 *   Value:      The message text
 *   Confidence: 1.0 (messages are facts — they happened)
 *   Reasoning:  JSON metadata: { sender, timestamp, transport?, mentions? }
 *
 * Security:
 *   - Transport origin is injected by server layer and stored in claim metadata.
 *   - Sender identity is self-declared but transport is tamper-proof.
 *   - DMs are NOT private — any agent can query any DM subject.
 *     This is by design: transparency over secrecy in a trusted team.
 *
 * Tools:
 *   limen_a2a_send      — Send a message to a channel or DM
 *   limen_a2a_read      — Read messages from a channel or DM
 *   limen_a2a_channels  — List active channels and DM threads
 *   limen_a2a_presence  — Agent registry with trust levels
 *
 * @see docs/A2A-CHAT-ARCHITECTURE.md
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Limen, BeliefView, RememberResult } from 'limen-ai';
import { z } from 'zod';

// ── Types ──

/** Result shape from Limen convenience API. */
interface LimenResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

/** Transport origin identifier, injected by server layer. */
export type TransportOrigin = 'stdio' | 'http';

// ── Helpers ──

/** MCP error response helper. */
function mcpError(code: string, message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: code, message }) }],
    isError: true as const,
  };
}

/** Build the subject URN for a channel. 3-segment URN: entity:channel:{name} */
function channelSubject(channel: string): string {
  return `entity:channel:${channel}`;
}

/** Build the subject URN for a DM between two agents. 3-segment URN: entity:dm:{sorted_pair} */
function dmSubject(agent1: string, agent2: string): string {
  const sorted = [agent1, agent2].sort();
  return `entity:dm:${sorted[0]}_${sorted[1]}`;
}

/** Validate channel/agent name: alphanumeric, hyphens, underscores, 1-64 chars. */
function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

/**
 * Wraps a synchronous Limen convenience API call that returns Result<T>.
 * Catches thrown exceptions (ENGINE_UNHEALTHY) and normalizes the error shape.
 */
function safeCall<T>(fn: () => LimenResult<T>): LimenResult<T> {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return { ok: false, error: { code: 'ASYNC_NOT_SUPPORTED', message: 'Expected synchronous Result<T>' } };
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { code: 'ENGINE_UNHEALTHY', message } };
  }
}

/**
 * Register A2A Chat tools on an MCP server.
 *
 * @param server - McpServer instance
 * @param limen - Limen engine instance (shared across transports)
 * @param transport - Transport origin identifier (injected per-transport for audit)
 */
export function registerA2AChatTools(
  server: McpServer,
  limen: Limen,
  transport: TransportOrigin = 'stdio',
): void {

  // ── limen_a2a_send ──
  server.tool(
    'limen_a2a_send',
    'Send a message to an A2A chat channel or direct message. Messages are stored as Limen claims — immutable, auditable, governed.',
    {
      sender: z.string().min(1).max(64).describe('Your agent name (e.g. "claude-code", "codex", "femi")'),
      channel: z.string().max(64).optional().describe('Channel name for group chat (e.g. "general", "engineering"). Omit for DM.'),
      to: z.string().max(64).optional().describe('Recipient agent name for direct message. Omit for channel message.'),
      message: z.string().min(1).max(2000).describe('The message text (max 2000 chars)'),
      mentions: z.string().optional().describe('Comma-separated agent names to mention (e.g. "codex,femi")'),
    },
    async (args) => {
      // Validate: must have exactly one of channel or to
      if (!args.channel && !args.to) {
        return mcpError('A2A_NO_TARGET', 'Provide either "channel" for group chat or "to" for direct message');
      }
      if (args.channel && args.to) {
        return mcpError('A2A_DUAL_TARGET', 'Provide either "channel" or "to", not both');
      }

      // Validate names
      if (!isValidName(args.sender)) {
        return mcpError('A2A_INVALID_SENDER', 'Sender must be 1-64 chars: alphanumeric, hyphens, underscores');
      }
      if (args.channel && !isValidName(args.channel)) {
        return mcpError('A2A_INVALID_CHANNEL', 'Channel must be 1-64 chars: alphanumeric, hyphens, underscores');
      }
      if (args.to && !isValidName(args.to)) {
        return mcpError('A2A_INVALID_RECIPIENT', 'Recipient must be 1-64 chars: alphanumeric, hyphens, underscores');
      }

      // Validate mentions (F-9: each mention must pass isValidName)
      const mentions: string[] = [];
      if (args.mentions) {
        for (const m of args.mentions.split(',').map(s => s.trim()).filter(Boolean)) {
          if (!isValidName(m)) {
            return mcpError('A2A_INVALID_MENTION', `Invalid mention name: "${m}". Must be 1-64 chars: alphanumeric, hyphens, underscores`);
          }
          mentions.push(m);
        }
      }

      // Build subject
      const subject = args.channel
        ? channelSubject(args.channel)
        : dmSubject(args.sender, args.to!);

      // Build metadata (F-2: include transport origin for audit)
      const metadata = JSON.stringify({
        sender: args.sender,
        timestamp: new Date().toISOString(),
        transport,
        target: args.channel ? { type: 'channel', name: args.channel } : { type: 'dm', to: args.to },
        ...(mentions.length > 0 ? { mentions } : {}),
      });

      // Store as claim
      const result = safeCall<RememberResult>(() => limen.remember(
        subject,
        'a2a.message',
        args.message,
        {
          confidence: 1.0,
          reasoning: metadata,
        },
      ));

      if (!result.ok) {
        return mcpError(result.error!.code, result.error!.message);
      }

      // F-6: result.value is RememberResult { claimId, confidence }
      const target = args.channel ? `#${args.channel}` : `@${args.to}`;
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            sent: true,
            target,
            sender: args.sender,
            claimId: result.value!.claimId,
            transport,
          }),
        }],
      };
    },
  );

  // ── limen_a2a_read ──
  server.tool(
    'limen_a2a_read',
    'Read messages from an A2A chat channel or direct message thread. Returns messages in chronological order. Note: DMs are transparent — any agent can read any thread.',
    {
      channel: z.string().max(64).optional().describe('Channel name to read (e.g. "general"). Omit for DM.'),
      from: z.string().max(64).optional().describe('For DM: the other agent in the conversation'),
      me: z.string().max(64).optional().describe('For DM: your agent name (needed to build the DM subject)'),
      limit: z.number().min(1).max(100).optional().describe('Max messages to return (default: 20)'),
    },
    async (args) => {
      // F-15: reject ambiguous queries — channel and from are mutually exclusive
      if (args.channel && args.from) {
        return mcpError('A2A_DUAL_TARGET', 'Provide either "channel" or "from"+"me", not both');
      }
      if (!args.channel && (!args.from || !args.me)) {
        return mcpError('A2A_NO_TARGET', 'Provide "channel" for group chat, or "from" + "me" for DM');
      }

      const subject = args.channel
        ? channelSubject(args.channel)
        : dmSubject(args.me!, args.from!);

      const limit = args.limit ?? 20;

      const result = safeCall<readonly BeliefView[]>(() => limen.recall(
        subject,
        'a2a.message',
        { limit },
      ));

      if (!result.ok) {
        return mcpError(result.error!.code, result.error!.message);
      }

      // F-7: use actual BeliefView fields (claimId, not id; subject is string, not optional)
      const beliefs = result.value!;
      const messages = beliefs.map((b) => {
        let sender = 'unknown';
        let timestamp = b.validAt;
        let transportOrigin = 'unknown';
        let mentionList: string[] = [];

        if (b.reasoning) {
          try {
            const meta = JSON.parse(b.reasoning) as {
              sender?: string;
              timestamp?: string;
              transport?: string;
              mentions?: string[];
            };
            sender = meta.sender ?? sender;
            timestamp = meta.timestamp ?? timestamp;
            transportOrigin = meta.transport ?? transportOrigin;
            mentionList = meta.mentions ?? [];
          } catch {
            // Reasoning is not JSON — use defaults
          }
        }

        return {
          id: b.claimId,
          sender,
          timestamp,
          transport: transportOrigin,
          message: b.value,
          ...(mentionList.length > 0 ? { mentions: mentionList } : {}),
        };
      });

      // Sort chronologically (oldest first) using validAt as fallback
      messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      const target = args.channel ? `#${args.channel}` : `DM:${args.me}↔${args.from}`;
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            channel: target,
            count: messages.length,
            messages,
          }, null, 2),
        }],
      };
    },
  );

  // ── limen_a2a_channels ──
  server.tool(
    'limen_a2a_channels',
    'List active A2A chat channels and DM threads with last activity.',
    async () => {
      // F-8: Query both channels and DMs
      const channelResult = safeCall<readonly BeliefView[]>(() => limen.recall(
        'entity:channel:*',
        'a2a.message',
        { limit: 100 },
      ));

      const dmResult = safeCall<readonly BeliefView[]>(() => limen.recall(
        'entity:dm:*',
        'a2a.message',
        { limit: 100 },
      ));

      if (!channelResult.ok) {
        return mcpError(channelResult.error!.code, channelResult.error!.message);
      }

      const threadMap = new Map<string, { lastActivity: string; messageCount: number; lastSender: string; type: string }>();

      // Process channel beliefs
      for (const b of channelResult.value!) {
        processBeliefForListing(b, threadMap, 'entity:channel:', 'channel');
      }

      // Process DM beliefs (if query succeeded)
      if (dmResult.ok && dmResult.value) {
        for (const b of dmResult.value) {
          processBeliefForListing(b, threadMap, 'entity:dm:', 'dm');
        }
      }

      const threads = Array.from(threadMap.entries())
        .map(([name, info]) => ({ name, ...info }))
        .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: threads.length,
            threads,
          }, null, 2),
        }],
      };
    },
  );

  // ── limen_a2a_presence ──
  server.tool(
    'limen_a2a_presence',
    'List registered agents with trust levels. Shows who is in the A2A network and their governance status.',
    async () => {
      // F-13: wrap in try/catch like other tools
      try {
        const agents = await limen.agents.list();

        const presence = agents.map((a) => ({
          name: a.name,
          trustLevel: a.trustLevel ?? 'unknown',
          domains: [...(a.domains ?? [])],
          capabilities: [...(a.capabilities ?? [])],
          createdAt: a.createdAt ?? 'unknown',
        }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              count: presence.length,
              agents: presence,
            }, null, 2),
          }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return mcpError('ENGINE_UNHEALTHY', message);
      }
    },
  );
}

/**
 * Process a belief into the thread listing map.
 * F-16: Use slice for deterministic URN extraction instead of replace.
 */
function processBeliefForListing(
  b: BeliefView,
  threadMap: Map<string, { lastActivity: string; messageCount: number; lastSender: string; type: string }>,
  prefix: string,
  type: string,
): void {
  const threadName = type === 'channel'
    ? `#${b.subject.slice(prefix.length)}`
    : b.subject.slice(prefix.length);

  const existing = threadMap.get(threadName);
  let sender = 'unknown';
  let timestamp = b.validAt;

  if (b.reasoning) {
    try {
      const meta = JSON.parse(b.reasoning) as { sender?: string; timestamp?: string };
      sender = meta.sender ?? sender;
      timestamp = meta.timestamp ?? timestamp;
    } catch { /* non-JSON reasoning — use validAt */ }
  }

  if (!existing) {
    threadMap.set(threadName, { lastActivity: timestamp, messageCount: 1, lastSender: sender, type });
  } else {
    existing.messageCount += 1;
    if (timestamp > existing.lastActivity) {
      existing.lastActivity = timestamp;
      existing.lastSender = sender;
    }
  }
}
