/**
 * limen a2a-read -- Read messages from an A2A chat channel or DM thread.
 *
 * Wraps the Limen engine recall() method to retrieve a2a.message claims.
 * Messages are returned in chronological order (oldest first).
 *
 * Parity with: limen_a2a_read MCP tool (packages/limen-mcp/src/tools/a2a-chat.ts)
 *
 * DMs are transparent -- any agent can read any thread.
 *
 * JSON stdout, JSON stderr -- no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

/** Validate name: alphanumeric, hyphens, underscores, 1-64 chars. Matches MCP. */
function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

/** Build the subject URN for a channel. */
function channelSubject(channel: string): string {
  return `entity:channel:${channel}`;
}

/** Build the subject URN for a DM between two agents. Sorted for determinism. */
function dmSubject(agent1: string, agent2: string): string {
  const sorted = [agent1, agent2].sort();
  return `entity:dm:${sorted[0]}_${sorted[1]}`;
}

export function createA2aReadCommand(): Command {
  const cmd = new Command('a2a-read')
    .description('Read messages from an A2A chat channel or DM thread')
    .option('--channel <name>', 'Channel name to read (e.g. "general")')
    .option('--from <agent>', 'For DM: the other agent in the conversation')
    .option('--me <agent>', 'For DM: your agent name (needed to build the DM subject)')
    .option('--limit <n>', 'Maximum messages to return (default: 20, max: 100)', parseInt)
    .option('--since <timestamp>', 'ISO-8601 timestamp to filter messages after')
    .option('--agent-id <name>', 'Filter messages by sender agent name')
    .action(async (options: {
      channel?: string;
      from?: string;
      me?: string;
      limit?: number;
      since?: string;
      agentId?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // Validate: must provide channel OR (from + me)
        if (options.channel && options.from) {
          writeError(new CliError(
            'CLI_DUAL_TARGET',
            'Provide either --channel or --from/--me, not both',
          ));
          process.exitCode = 1;
          return;
        }

        if (!options.channel && (!options.from || !options.me)) {
          writeError(new CliError(
            'CLI_NO_TARGET',
            'Provide --channel for group chat, or --from + --me for DM',
          ));
          process.exitCode = 1;
          return;
        }

        // Validate names
        if (options.channel && !isValidName(options.channel)) {
          writeError(new CliError(
            'CLI_INVALID_CHANNEL',
            '--channel must be 1-64 chars: alphanumeric, hyphens, underscores',
          ));
          process.exitCode = 1;
          return;
        }

        if (options.from && !isValidName(options.from)) {
          writeError(new CliError(
            'CLI_INVALID_SENDER',
            '--from must be 1-64 chars: alphanumeric, hyphens, underscores',
          ));
          process.exitCode = 1;
          return;
        }

        if (options.me && !isValidName(options.me)) {
          writeError(new CliError(
            'CLI_INVALID_SENDER',
            '--me must be 1-64 chars: alphanumeric, hyphens, underscores',
          ));
          process.exitCode = 1;
          return;
        }

        // Validate --limit
        if (options.limit !== undefined) {
          if (isNaN(options.limit)) {
            writeError(new CliError('CLI_INVALID_LIMIT', '--limit must be a valid integer'));
            process.exitCode = 1;
            return;
          }
        }
        // Clamp limit to [1, 100] matching MCP
        const limit = Math.max(1, Math.min(options.limit ?? 20, 100));

        // Validate --since is valid ISO timestamp if provided
        if (options.since !== undefined) {
          const parsed = Date.parse(options.since);
          if (isNaN(parsed)) {
            writeError(new CliError(
              'CLI_INVALID_TIMESTAMP',
              '--since must be a valid ISO-8601 timestamp',
            ));
            process.exitCode = 1;
            return;
          }
        }

        // Validate --agent-id if provided
        if (options.agentId !== undefined && !isValidName(options.agentId)) {
          writeError(new CliError(
            'CLI_INVALID_AGENT_ID',
            '--agent-id must be 1-64 chars: alphanumeric, hyphens, underscores',
          ));
          process.exitCode = 1;
          return;
        }

        const subject = options.channel
          ? channelSubject(options.channel)
          : dmSubject(options.me!, options.from!);

        const result = await withEngine(
          (limen) => {
            const recallResult = limen.recall(
              subject,
              'a2a.message',
              { limit },
            );

            if (!recallResult.ok) {
              throw new CliError(
                recallResult.error.code,
                `A2A read failed: ${recallResult.error.message}`,
              );
            }

            const beliefs = recallResult.value;

            // Parse message metadata from reasoning field (same as MCP)
            let messages = beliefs.map((b) => {
              let sender = 'unknown';
              let timestamp = b.validAt;
              let transport = 'unknown';
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
                  transport = meta.transport ?? transport;
                  mentionList = meta.mentions ?? [];
                } catch {
                  // Non-JSON reasoning -- use defaults
                }
              }

              return {
                id: b.claimId,
                sender,
                timestamp,
                transport,
                message: b.value,
                ...(mentionList.length > 0 ? { mentions: mentionList } : {}),
              };
            });

            // Filter by --since if provided
            if (options.since) {
              const sinceMs = Date.parse(options.since);
              messages = messages.filter((m) => Date.parse(m.timestamp) >= sinceMs);
            }

            // Filter by --agent-id if provided
            if (options.agentId) {
              messages = messages.filter((m) => m.sender === options.agentId);
            }

            // Sort chronologically (oldest first)
            messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

            const target = options.channel
              ? `#${options.channel}`
              : `DM:${options.me}↔${options.from}`;

            return {
              channel: target,
              count: messages.length,
              messages,
            };
          },
          {
            dataDir: globals.dataDir,
            masterKeyPath: globals.masterKey,
          },
        );

        writeResult(result);
      } catch (err: unknown) {
        writeError(err);
        process.exitCode = 1;
      }
    });

  return cmd;
}
