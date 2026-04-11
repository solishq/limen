/**
 * limen a2a-send -- Send a message to an A2A chat channel or direct message.
 *
 * Wraps the Limen engine remember() method to store messages as claims.
 * Messages use predicate 'a2a.message' with subjects following:
 *   - entity:channel:{name}  (group chat)
 *   - entity:dm:{sorted_pair} (direct message)
 *
 * Parity with: limen_a2a_send MCP tool (packages/limen-mcp/src/tools/a2a-chat.ts)
 *
 * F-BR3-001: --to is optional. Must provide exactly one of --to or --channel.
 * F-BR3-002: --mentions added for MCP parity.
 * F-BR3-004: Clock injection via shared TimeProvider.
 * F-BR3-008: Shared helpers from a2a-helpers.ts.
 *
 * Sender identity is self-declared. Transport is 'cli'.
 * DMs are transparent -- any agent can read any thread.
 *
 * JSON stdout, JSON stderr -- no exceptions.
 */

import { Command } from 'commander';
import { withEngine } from '../bootstrap.js';
import { writeResult, writeError, CliError } from '../output.js';
import { isValidName, channelSubject, dmSubject, getClock } from './a2a-helpers.js';

export function createA2aSendCommand(): Command {
  const cmd = new Command('a2a-send')
    .description('Send a message to an A2A chat channel or direct message')
    .requiredOption('--from <sender>', 'Your agent name (1-64 chars: alphanumeric, hyphens, underscores)')
    .option('--to <recipient>', 'Recipient agent name for DM (mutually exclusive with --channel)')
    .requiredOption('--message <text>', 'The message text (max 2000 chars)')
    .option('--channel <name>', 'Channel name for group chat (mutually exclusive with --to)')
    .option('--mentions <names>', 'Comma-separated agent names to mention (e.g. "codex,femi")')
    .option('--priority <level>', 'Message priority level')
    .option('--metadata <json>', 'Additional JSON metadata string')
    .action(async (options: {
      from: string;
      to?: string;
      message: string;
      channel?: string;
      mentions?: string;
      priority?: string;
      metadata?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // F-BR3-001: Validate mutual exclusion -- must have exactly one of --to or --channel
        if (!options.to && !options.channel) {
          writeError(new CliError(
            'CLI_NO_TARGET',
            'Provide either --to for DM or --channel for group chat',
          ));
          process.exitCode = 1;
          return;
        }

        if (options.to && options.channel) {
          writeError(new CliError(
            'CLI_DUAL_TARGET',
            'Provide either --to or --channel, not both',
          ));
          process.exitCode = 1;
          return;
        }

        // Validate --from (sender name)
        if (!isValidName(options.from)) {
          writeError(new CliError(
            'CLI_INVALID_SENDER',
            '--from must be 1-64 chars: alphanumeric, hyphens, underscores',
          ));
          process.exitCode = 1;
          return;
        }

        // Validate --to (recipient name) if provided
        if (options.to && !isValidName(options.to)) {
          writeError(new CliError(
            'CLI_INVALID_RECIPIENT',
            '--to must be 1-64 chars: alphanumeric, hyphens, underscores',
          ));
          process.exitCode = 1;
          return;
        }

        // Validate --channel if provided
        if (options.channel !== undefined && !isValidName(options.channel)) {
          writeError(new CliError(
            'CLI_INVALID_CHANNEL',
            '--channel must be 1-64 chars: alphanumeric, hyphens, underscores',
          ));
          process.exitCode = 1;
          return;
        }

        // Validate --message is not empty
        if (options.message.trim().length === 0) {
          writeError(new CliError(
            'CLI_INVALID_MESSAGE',
            '--message must not be empty or whitespace-only',
          ));
          process.exitCode = 1;
          return;
        }

        // Validate --message max length (MCP enforces 2000)
        if (options.message.length > 2000) {
          writeError(new CliError(
            'CLI_INVALID_MESSAGE',
            `--message must not exceed 2000 characters (got ${options.message.length})`,
          ));
          process.exitCode = 1;
          return;
        }

        // F-BR3-002: Validate --mentions (comma-separated, each must pass isValidName)
        const mentions: string[] = [];
        if (options.mentions) {
          for (const m of options.mentions.split(',').map(s => s.trim()).filter(Boolean)) {
            if (!isValidName(m)) {
              writeError(new CliError(
                'CLI_INVALID_MENTION',
                `Invalid mention name: "${m}". Must be 1-64 chars: alphanumeric, hyphens, underscores`,
              ));
              process.exitCode = 1;
              return;
            }
            mentions.push(m);
          }
        }

        // Validate --metadata is valid JSON if provided
        if (options.metadata !== undefined) {
          try {
            JSON.parse(options.metadata);
          } catch {
            writeError(new CliError(
              'CLI_INVALID_METADATA',
              '--metadata must be a valid JSON string',
            ));
            process.exitCode = 1;
            return;
          }
        }

        // Determine routing: --channel makes it a channel message, otherwise DM
        const isChannel = options.channel !== undefined;
        const subject = isChannel
          ? channelSubject(options.channel!)
          : dmSubject(options.from, options.to!);

        // F-BR3-004: Use injectable clock instead of direct Date.now()
        const clock = getClock();

        // Build metadata (transport = 'cli' for CLI parity with MCP's 'stdio'/'http')
        const reasoning = JSON.stringify({
          sender: options.from,
          timestamp: clock(),
          transport: 'cli',
          target: isChannel
            ? { type: 'channel', name: options.channel }
            : { type: 'dm', to: options.to },
          ...(mentions.length > 0 ? { mentions } : {}),
          ...(options.priority ? { priority: options.priority } : {}),
          ...(options.metadata ? { userMetadata: JSON.parse(options.metadata) } : {}),
        });

        const result = await withEngine(
          async (limen) => {
            // FP-09: Auto-register the sender so they show up in a2a-presence.
            // Messages from unregistered agents used to "just work" silently,
            // but the presence list only showed auto-created agents — the
            // testimony (step 30) flagged this as a discoverability defect.
            // We now register on demand. Failures are swallowed (agent may
            // already exist, or the tenant may lack permission — neither
            // should block message delivery).
            try {
              const existing = await limen.agents.get(options.from);
              if (existing === null) {
                await limen.agents.register({
                  name: options.from,
                  capabilities: ['a2a.send'],
                  domains: ['a2a'],
                });
              }
            } catch { /* best-effort; continue to send */ }
            const rememberResult = limen.remember(
              subject,
              'a2a.message',
              options.message,
              {
                confidence: 1.0,
                reasoning,
              },
            );

            if (!rememberResult.ok) {
              throw new CliError(
                rememberResult.error.code,
                `A2A send failed: ${rememberResult.error.message}`,
              );
            }

            const target = isChannel ? `#${options.channel}` : `@${options.to}`;
            return {
              sent: true,
              target,
              sender: options.from,
              claimId: rememberResult.value.claimId,
              transport: 'cli',
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
