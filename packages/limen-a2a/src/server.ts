#!/usr/bin/env node
/**
 * Limen A2A Server — Google Agent-to-Agent Protocol server for Limen Cognitive OS.
 *
 * Entry point for the limen-a2a binary. Creates an HTTP server that exposes
 * Limen's capabilities via the A2A protocol:
 *
 *   GET  /.well-known/agent.json  — Agent Card (discovery)
 *   POST /                        — JSON-RPC 2.0 handler (tasks/send, tasks/get, tasks/cancel)
 *
 * Port configuration (precedence order):
 *   1. --port <N> CLI argument
 *   2. LIMEN_A2A_PORT environment variable
 *   3. Default: 41000
 *
 * The server boots a Limen engine instance via bootstrap.ts (reads ~/.limen/config.json),
 * then serves A2A requests indefinitely. Graceful shutdown on SIGINT/SIGTERM.
 *
 * Zero external dependencies beyond limen-ai. HTTP via node:http.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { bootstrapEngine } from './bootstrap.js';
import { buildAgentCard } from './agent_card.js';
import { createHandler } from './jsonrpc/handler.js';
import type { MethodHandler } from './jsonrpc/handler.js';
import { TaskManager } from './task_manager.js';
import { createTaskSendHandler } from './methods/task_send.js';
import { createTaskGetHandler } from './methods/task_get.js';
import { createTaskCancelHandler } from './methods/task_cancel.js';
import type { Limen } from 'limen-ai';

// ── Port Resolution ──

/**
 * Resolve the server port from CLI args, environment, or default.
 */
function resolvePort(): number {
  // Check --port CLI argument
  const args = process.argv.slice(2);
  const portFlagIndex = args.indexOf('--port');
  if (portFlagIndex !== -1 && portFlagIndex + 1 < args.length) {
    const parsed = parseInt(args[portFlagIndex + 1], 10);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed < 65536) {
      return parsed;
    }
    process.stderr.write(`[limen-a2a] Invalid --port value: ${args[portFlagIndex + 1]}, using default\n`);
  }

  // Check environment variable
  const envPort = process.env.LIMEN_A2A_PORT;
  if (envPort !== undefined) {
    const parsed = parseInt(envPort, 10);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed < 65536) {
      return parsed;
    }
    process.stderr.write(`[limen-a2a] Invalid LIMEN_A2A_PORT value: ${envPort}, using default\n`);
  }

  return 41000;
}

// ── HTTP Request Helpers ──

/**
 * Read the full request body into a string.
 * Enforces a 1 MB limit to prevent memory exhaustion.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 1_048_576; // 1 MB

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error('Request body too large (max 1 MB)'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    req.on('error', reject);
  });
}

/**
 * Send a JSON response.
 */
function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

/**
 * Send a plain text response.
 */
function sendText(res: ServerResponse, statusCode: number, text: string): void {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

// ── Main ──

async function main(): Promise<void> {
  const port = resolvePort();

  process.stdout.write('[limen-a2a] Booting Limen engine...\n');
  const limen: Limen = await bootstrapEngine();
  process.stdout.write('[limen-a2a] Engine ready.\n');

  // Build Agent Card
  const baseUrl = `http://localhost:${port}`;
  const agentCard = buildAgentCard(baseUrl);

  // Build TaskManager and method registry
  const taskManager = new TaskManager();

  const methodRegistry = new Map<string, MethodHandler>([
    ['tasks/send', createTaskSendHandler(limen, taskManager)],
    ['tasks/get', createTaskGetHandler(taskManager)],
    ['tasks/cancel', createTaskCancelHandler(taskManager)],
  ]);

  const handleJsonRpc = createHandler(methodRegistry);

  // Create HTTP server
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method?.toUpperCase() ?? '';
    const url = req.url ?? '/';

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    // Set CORS headers on all responses
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Route: GET /.well-known/agent.json
    if (method === 'GET' && url === '/.well-known/agent.json') {
      sendJson(res, 200, agentCard);
      return;
    }

    // Route: POST / — JSON-RPC 2.0
    if (method === 'POST' && url === '/') {
      try {
        const body = await readBody(req);
        const response = await handleJsonRpc(body);
        sendJson(res, 200, response);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        sendJson(res, 500, {
          jsonrpc: '2.0',
          error: { code: -32603, message },
          id: null,
        });
      }
      return;
    }

    // 404 for everything else
    sendText(res, 404, 'Not Found');
  });

  // Graceful shutdown
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    process.stdout.write(`\n[limen-a2a] Received ${signal}, shutting down...\n`);

    // Close HTTP server (stop accepting new connections)
    server.close();

    // Shutdown Limen engine
    try {
      await limen.shutdown();
      process.stdout.write('[limen-a2a] Engine shutdown complete.\n');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      process.stderr.write(`[limen-a2a] Engine shutdown error: ${message}\n`);
    }

    process.exit(0);
  }

  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  // Start listening
  server.listen(port, () => {
    process.stdout.write(`[limen-a2a] A2A server listening on ${baseUrl}\n`);
    process.stdout.write(`[limen-a2a] Agent Card: ${baseUrl}/.well-known/agent.json\n`);
    process.stdout.write(`[limen-a2a] JSON-RPC endpoint: POST ${baseUrl}/\n`);
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'Unknown fatal error';
  process.stderr.write(`[limen-a2a] Fatal: ${message}\n`);
  process.exit(1);
});
