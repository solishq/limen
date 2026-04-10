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
 * Sender identity is self-declared. Transport is 'cli'.
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

/** Build the subject URN for a channel. 3-segment URN: entity:channel:{name} */
function channelSubject(channel: string): string {
  return `entity:channel:${channel}`;
}

/** Build the subject URN for a DM between two agents. Sorted for determinism. */
function dmSubject(agent1: string, agent2: string): string {
  const sorted = [agent1, agent2].sort();
  return `entity:dm:${sorted[0]}_${sorted[1]}`;
}

export function createA2aSendCommand(): Command {
  const cmd = new Command('a2a-send')
    .description('Send a message to an A2A chat channel or direct message')
    .requiredOption('--from <sender>', 'Your agent name (1-64 chars: alphanumeric, hyphens, underscores)')
    .requiredOption('--to <recipient>', 'Recipient: channel name for group chat, or agent name for DM')
    .requiredOption('--message <text>', 'The message text (max 2000 chars)')
    .option('--channel <name>', 'Explicit channel name (routes to group chat instead of DM)')
    .option('--priority <level>', 'Message priority level')
    .option('--metadata <json>', 'Additional JSON metadata string')
    .action(async (options: {
      from: string;
      to: string;
      message: string;
      channel?: string;
      priority?: string;
      metadata?: string;
    }, command: Command) => {
      try {
        const globals = command.optsWithGlobals<{
          dataDir?: string;
          masterKey?: string;
        }>();

        // Validate --from (sender name)
        if (!isValidName(options.from)) {
          writeError(new CliError(
            'CLI_INVALID_SENDER',
            '--from must be 1-64 chars: alphanumeric, hyphens, underscores',
          ));
          process.exitCode = 1;
          return;
        }

        // Validate --to (recipient name)
        if (!isValidName(options.to)) {
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
          : dmSubject(options.from, options.to);

        // Build metadata (transport = 'cli' for CLI parity with MCP's 'stdio'/'http')
        const reasoning = JSON.stringify({
          sender: options.from,
          timestamp: new Date().toISOString(),
          transport: 'cli',
          target: isChannel
            ? { type: 'channel', name: options.channel }
            : { type: 'dm', to: options.to },
          ...(options.priority ? { priority: options.priority } : {}),
          ...(options.metadata ? { userMetadata: JSON.parse(options.metadata) } : {}),
        });

        const result = await withEngine(
          (limen) => {
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
