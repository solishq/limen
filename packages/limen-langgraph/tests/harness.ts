/**
 * Test harness — in-memory mocks for Limen core interfaces.
 *
 * Provides ChainStorage, ProjectionStorage, Projector, and ValidityStateMachine
 * implementations backed by SQLite (better-sqlite3) for realistic testing.
 */

import Database from 'better-sqlite3';
import type {
  ChainStorage,
  ChainEntryInput,
  CommittedEntry,
  ProjectionStorage,
  Projector,
  ValidityStateMachine,
  ValidityState,
  LimenCheckpointerConfig,
} from '../src/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// In-Memory Chain
// ═══════════════════════════════════════════════════════════════════════════

export class InMemoryChain implements ChainStorage {
  private entries: Array<ChainEntryInput & { global_sequence: number; canonical_at: number }> = [];
  private seq = 0;
  shouldFail = false;

  async appendEntry(entry: ChainEntryInput): Promise<CommittedEntry> {
    if (this.shouldFail) {
      throw new Error('Chain write failure (simulated)');
    }
    this.seq++;
    const committed = {
      ...entry,
      global_sequence: this.seq,
      canonical_at: Date.now(),
    };
    this.entries.push(committed);
    return { global_sequence: committed.global_sequence, canonical_at: committed.canonical_at };
  }

  getEntries() { return this.entries; }
  getLastEntry() { return this.entries[this.entries.length - 1]; }
  clear() { this.entries = []; this.seq = 0; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SQLite-backed Projection (realistic)
// ═══════════════════════════════════════════════════════════════════════════

export class SqliteProjection implements ProjectionStorage {
  private db: Database.Database;

  constructor() {
    this.db = new Database(':memory:');
    this.db.pragma('journal_mode = WAL');
    // Create projection_metadata table
    this.db.exec(`CREATE TABLE IF NOT EXISTS projection_metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
  }

  query<T = Record<string, unknown>>(sql: string, params: unknown[]): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  queryOne<T = Record<string, unknown>>(sql: string, params: unknown[]): T | undefined {
    const stmt = this.db.prepare(sql);
    return stmt.get(...params) as T | undefined;
  }

  getMetadata(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM projection_metadata WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMetadata(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO projection_metadata (key, value) VALUES (?, ?)').run(key, value);
  }

  /** Direct exec for DDL — used by migrateSchema */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  getDb(): Database.Database { return this.db; }
}

// ═══════════════════════════════════════════════════════════════════════════
// In-Memory Projector (processes chain entries into projection)
// ═══════════════════════════════════════════════════════════════════════════

export class InMemoryProjector implements Projector {
  private chain: InMemoryChain;
  private projection: SqliteProjection;
  private lastProjected = 0;
  shouldFail = false;

  constructor(chain: InMemoryChain, projection: SqliteProjection) {
    this.chain = chain;
    this.projection = projection;
  }

  async projectPending(): Promise<void> {
    if (this.shouldFail) {
      throw new Error('projectPending failure (simulated)');
    }

    const entries = this.chain.getEntries().filter(e => e.global_sequence > this.lastProjected);
    const db = this.projection.getDb();

    // Set projector_active to suppress tamper triggers
    db.prepare('INSERT OR REPLACE INTO projection_metadata (key, value) VALUES (?, ?)').run('projector_active', '1');

    for (const entry of entries) {
      const payload = JSON.parse(new TextDecoder().decode(entry.state_json));

      switch (entry.transition_kind) {
        case 'LgCheckpoint':
          db.prepare(`INSERT OR REPLACE INTO lg_checkpoints
            (tenant_scope, thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
             type_tag, checkpoint_blob, metadata_json, step, source, created_at, global_sequence)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(
              entry.tenant_scope,
              payload.thread_id,
              payload.checkpoint_ns,
              payload.checkpoint_id,
              payload.parent_checkpoint_id,
              payload.type_tag,
              Buffer.from(payload.checkpoint_blob),
              payload.metadata_json,
              payload.step,
              payload.source,
              entry.canonical_at,
              entry.global_sequence,
            );
          break;

        case 'LgWrite':
          for (const w of payload.writes) {
            db.prepare(`INSERT OR REPLACE INTO lg_pending_writes
              (tenant_scope, thread_id, checkpoint_ns, checkpoint_id, task_id,
               channel, type_tag, value, write_idx, global_sequence)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(
                entry.tenant_scope,
                payload.thread_id,
                payload.checkpoint_ns,
                payload.checkpoint_id,
                payload.task_id,
                w.channel,
                w.type_tag,
                Buffer.from(w.value),
                w.write_idx,
                entry.global_sequence,
              );
          }
          break;

        case 'LgDelete':
          db.prepare('DELETE FROM lg_pending_writes WHERE tenant_scope = ? AND thread_id = ?')
            .run(entry.tenant_scope, payload.thread_id);
          db.prepare('DELETE FROM lg_checkpoints WHERE tenant_scope = ? AND thread_id = ?')
            .run(entry.tenant_scope, payload.thread_id);
          break;

        case 'LgStorePut':
          db.prepare(`INSERT OR REPLACE INTO lg_store_items
            (tenant_scope, namespace, key, value_json, index_fields, created_at, updated_at, global_sequence)
            VALUES (?, ?, ?, ?, ?,
              COALESCE((SELECT created_at FROM lg_store_items WHERE tenant_scope = ? AND namespace = ? AND key = ?), ?),
              ?, ?)`)
            .run(
              entry.tenant_scope, payload.namespace, payload.key,
              payload.value_json, payload.index_fields ? JSON.stringify(payload.index_fields) : null,
              entry.tenant_scope, payload.namespace, payload.key, entry.canonical_at,
              entry.canonical_at, entry.global_sequence,
            );
          break;

        case 'LgStoreDelete':
          db.prepare('DELETE FROM lg_store_items WHERE tenant_scope = ? AND namespace = ? AND key = ?')
            .run(entry.tenant_scope, payload.namespace, payload.key);
          break;
      }

      this.lastProjected = entry.global_sequence;
    }

    // Clear projector_active
    db.prepare('DELETE FROM projection_metadata WHERE key = ?').run('projector_active');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Controllable Validity State Machine
// ═══════════════════════════════════════════════════════════════════════════

export class MockValidity implements ValidityStateMachine {
  private state: ValidityState = 'Verified';
  shouldFailStartup = false;

  currentState(): ValidityState {
    return this.state;
  }

  async verifyOnStartup(): Promise<void> {
    if (this.shouldFailStartup) {
      throw new Error('Validity verification failed (simulated)');
    }
  }

  setState(state: ValidityState): void {
    this.state = state;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory: create a fully wired test config
// ═══════════════════════════════════════════════════════════════════════════

export interface TestHarness {
  chain: InMemoryChain;
  projection: SqliteProjection;
  projector: InMemoryProjector;
  validity: MockValidity;
  config: LimenCheckpointerConfig;
}

export function createTestHarness(opts?: { governed?: boolean; tenantScope?: string }): TestHarness {
  const chain = new InMemoryChain();
  const projection = new SqliteProjection();
  const projector = new InMemoryProjector(chain, projection);
  const validity = new MockValidity();

  const config: LimenCheckpointerConfig = {
    chain,
    projection,
    projector,
    validity,
    governed: opts?.governed ?? false,
    tenantScope: opts?.tenantScope ?? '__default__',
  };

  return { chain, projection, projector, validity, config };
}
