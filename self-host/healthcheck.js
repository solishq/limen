// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Limen Docker Health Check
 *
 * Creates a lightweight Limen engine instance pointed at the container's
 * data directory, calls health(), and exits with code 0 (healthy) or 1.
 *
 * The MCP server uses stdio transport, so we cannot probe it directly.
 * Instead, we verify the underlying engine is operational by creating
 * an independent instance against the same data directory.
 *
 * Environment variables:
 *   LIMEN_DATA_DIR       — Path to SQLite data directory (default: /data)
 *   LIMEN_MASTER_KEY     — Hex-encoded master key (inline)
 *   LIMEN_MASTER_KEY_PATH — Path to master key file (default: /run/secrets/master_key)
 */

// Self-reference import: the container's /app/package.json is limen-ai,
// and Node.js >=22 supports package self-referencing via the "exports" field.
// This resolves to /app/dist/api/index.js inside the container.
import { createLimen } from 'limen-ai';
import { readFileSync } from 'node:fs';

const dataDir = process.env.LIMEN_DATA_DIR || '/data';
const masterKeyPath = process.env.LIMEN_MASTER_KEY_PATH || '/run/secrets/master_key';

function loadMasterKey() {
  // Prefer inline env var (hex-encoded)
  const inlineKey = process.env.LIMEN_MASTER_KEY;
  if (inlineKey) {
    return Buffer.from(inlineKey, 'hex');
  }

  // Fall back to file mount
  return readFileSync(masterKeyPath);
}

async function check() {
  let limen;
  try {
    const masterKey = loadMasterKey();

    limen = await createLimen({
      dataDir,
      masterKey,
      providers: [],
    });

    const health = await limen.health();

    if (health.status === 'healthy') {
      process.exit(0);
    }

    console.error(`Health check: ${health.status}`);
    process.exit(1);
  } catch (err) {
    console.error(`Health check failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    if (limen) {
      await limen.shutdown().catch(() => {});
    }
  }
}

check();
