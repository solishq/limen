// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Limen MCP Bootstrap — Long-running engine lifecycle management.
 *
 * Unlike the CLI bootstrap (which creates/destroys per command),
 * the MCP server maintains a persistent engine instance for the
 * duration of the server process. Shutdown occurs on SIGINT/SIGTERM.
 *
 * Reads configuration from ~/.limen/config.json (same as CLI).
 */

import { createLimen } from 'limen-ai';
import type { Limen, LimenConfig } from 'limen-ai';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Configuration shape read from ~/.limen/config.json. */
interface McpConfig {
  readonly dataDir: string;
  readonly masterKeyPath: string;
}

const LIMEN_HOME = join(homedir(), '.limen');

const DEFAULT_CONFIG: McpConfig = {
  dataDir: join(LIMEN_HOME, 'data'),
  masterKeyPath: join(LIMEN_HOME, 'master.key'),
};

function loadConfig(): McpConfig {
  const configPath = join(LIMEN_HOME, 'config.json');

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<McpConfig>;
    return {
      dataDir: parsed.dataDir ?? DEFAULT_CONFIG.dataDir,
      masterKeyPath: parsed.masterKeyPath ?? DEFAULT_CONFIG.masterKeyPath,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Bootstrap a long-running Limen engine instance.
 *
 * Returns the engine and a shutdown function. The MCP server
 * should call shutdown() when the transport disconnects.
 */
export async function bootstrapEngine(): Promise<{
  limen: Limen;
  shutdown: () => Promise<void>;
}> {
  const config = loadConfig();
  const masterKeyBuffer = readFileSync(config.masterKeyPath);

  // F-SEC-002: Support LIMEN_RBAC_ACTIVE=true to force RBAC enforcement.
  // When set, passes forceActive: true so that RBAC permission checks are
  // enforced even in single-user mode. Required for multi-agent deployments.
  const forceRbac = process.env.LIMEN_RBAC_ACTIVE === 'true';

  const limenConfig: LimenConfig = {
    dataDir: config.dataDir,
    masterKey: masterKeyBuffer,
    providers: [],
    ...(forceRbac ? { requireRbac: true } : {}),
  };

  const limen = await createLimen(limenConfig);

  // F-SEC-006: Zero the master key Buffer after engine initialization.
  // createLimen() copies the key internally — the original Buffer can be scrubbed
  // to prevent it from persisting in the Node.js heap.
  masterKeyBuffer.fill(0);

  // F-SEC-003: Emit warning when RBAC is dormant in single-user mode.
  // This makes the security posture explicit at startup.
  if (!forceRbac) {
    process.stderr.write(
      'WARNING: RBAC dormant — all operations permitted. ' +
      'Set LIMEN_RBAC_ACTIVE=true for multi-agent deployments.\n',
    );
  }

  return {
    limen,
    shutdown: async () => {
      await limen.shutdown();
    },
  };
}
