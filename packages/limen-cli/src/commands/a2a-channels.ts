/**
 * limen a2a-channels -- List active A2A chat channels and DM threads.
 *
 * Wraps the Limen engine recall() method with wildcard subjects to discover
 * all channels (entity:channel:*) and DM threads (entity:dm:*).
 *
 * Parity with: limen_a2a_channels MCP tool (packages/limen-mcp/src/tools/a2a-chat.ts)
 *
 * JSON stdout, JSON stderr -- no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';

export function createA2aChannelsCommand(): Command {
  const cmd = new Command('a2a-channels')
    .description('List active A2A chat channels and DM threads')
    .option('--include-metadata', 'Include additional metadata in output')
    .action(async (options: {
      includeMetadata?: boolean;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        const result = await withEngine(
          (limen) => {
            // Query channels
            const channelResult = limen.recall(
              'entity:channel:*',
              'a2a.message',
              { limit: 100 },
            );

            if (!channelResult.ok) {
              throw new CliError(
                channelResult.error.code,
                `A2A channels query failed: ${channelResult.error.message}`,
              );
            }

            // Query DM threads
            const dmResult = limen.recall(
              'entity:dm:*',
              'a2a.message',
              { limit: 100 },
            );

            // Build thread map (same logic as MCP)
            const threadMap = new Map<string, {
              lastActivity: string;
              messageCount: number;
              lastSender: string;
              type: string;
            }>();

            // Process channel beliefs
            for (const b of channelResult.value) {
              processBeliefForListing(b, threadMap, 'entity:channel:', 'channel');
            }

            // Process DM beliefs (if query succeeded)
            if (dmResult.ok) {
              for (const b of dmResult.value) {
                processBeliefForListing(b, threadMap, 'entity:dm:', 'dm');
              }
            }

            const threads = Array.from(threadMap.entries())
              .map(([name, info]) => ({
                name,
                ...info,
                ...(options.includeMetadata ? { raw: true } : {}),
              }))
              .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));

            return {
              count: threads.length,
              threads,
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

/**
 * Process a belief into the thread listing map.
 * Matches MCP processBeliefForListing logic exactly.
 */
function processBeliefForListing(
  b: { subject: string; validAt: string; reasoning?: string | null },
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
    } catch { /* non-JSON reasoning -- use validAt */ }
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
