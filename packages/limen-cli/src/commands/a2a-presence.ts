// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * limen a2a-presence -- List registered agents with trust levels.
 *
 * Wraps the Limen engine agents.list() method to show who is in the
 * A2A network and their governance status.
 *
 * Parity with: limen_a2a_presence MCP tool (packages/limen-mcp/src/tools/a2a-chat.ts)
 *
 * Optionally filters by --channel (agents who have sent to a specific channel)
 * or --agent-id (details for a specific agent).
 *
 * JSON stdout, JSON stderr -- no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';
import { isValidName } from './a2a-helpers.js';

export function createA2aPresenceCommand(): Command {
  const cmd = new Command('a2a-presence')
    .description('List registered agents with trust levels and governance status')
    .option('--channel <name>', 'Filter agents who have sent to this channel')
    .option('--agent-id <name>', 'Show details for a specific agent')
    .action(async (options: {
      channel?: string;
      agentId?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // Validate --channel if provided
        if (options.channel !== undefined && !isValidName(options.channel)) {
          writeError(new CliError(
            'CLI_INVALID_CHANNEL',
            '--channel must be 1-64 chars: alphanumeric, hyphens, underscores',
          ));
          process.exitCode = 1;
          return;
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

        const result = await withEngine(
          async (limen) => {
            const agents = await limen.agents.list();

            let presence = agents.map((a) => ({
              name: a.name,
              trustLevel: a.trustLevel ?? 'unknown',
              domains: [...(a.domains ?? [])],
              capabilities: [...(a.capabilities ?? [])],
              createdAt: a.createdAt ?? 'unknown',
            }));

            // Filter by --agent-id if provided
            if (options.agentId) {
              presence = presence.filter((a) => a.name === options.agentId);
            }

            // Filter by --channel: find agents who have sent to this channel
            if (options.channel) {
              const channelSubject = `entity:channel:${options.channel}`;
              const recallResult = limen.recall(
                channelSubject,
                'a2a.message',
                { limit: 100 },
              );

              if (recallResult.ok) {
                const senders = new Set<string>();
                for (const b of recallResult.value) {
                  if (b.reasoning) {
                    try {
                      const meta = JSON.parse(b.reasoning) as { sender?: string };
                      if (meta.sender) senders.add(meta.sender);
                    } catch { /* non-JSON reasoning */ }
                  }
                }
                presence = presence.filter((a) => senders.has(a.name));
              }
            }

            return {
              count: presence.length,
              agents: presence,
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
