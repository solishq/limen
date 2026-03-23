/**
 * Kernel factory: createKernel and destroyKernel.
 * S ref: C-07 (Object.freeze), C-06 (no shared mutable state), §3.3 (engine not framework)
 *
 * Phase: 1 (Kernel)
 * The top-level entry point for the kernel module.
 *
 * C-07: Object.freeze on public API.
 * C-06: Two createKernel() calls produce independent instances.
 * §3.3: Engine, not framework -- consumer receives complete opaque object.
 *
 * Build order justification (SDD Section 7):
 * 1. Database lifecycle (foundation)
 * 2. Namespace enforcement (before tables)
 * 3. Audit trail (before mutations)
 * 4. Crypto (needed by audit + vault)
 * 5. Event bus (needed by all modules)
 * 6. RBAC + Rate limiter (needed by API)
 * 7. Retention + Tenant + Config
 */

import type {
  Result, Kernel, KernelConfig, KernelHealth, DatabaseConnection,
} from './interfaces/index.js';

import { createDatabaseLifecycle } from './database/database_lifecycle.js';

// CF-011: Module-level connection tracker for destroyKernel.
// WeakMap so that unreferenced kernels can be garbage-collected.
// This avoids modifying the frozen Kernel interface while giving
// destroyKernel access to the connection it needs to close.
const kernelConnections = new WeakMap<Kernel, DatabaseConnection>();
import { getPhase1Migrations } from './database/migrations.js';
import { createNamespaceEnforcer } from './namespace/namespace_enforcer.js';
import { createAuditTrail } from './audit/audit_trail.js';
import { createCryptoEngine, createVaultOperations, createStringEncryption } from './crypto/crypto_engine.js';
import { createEventBus } from './events/event_bus.js';
import { createRbacEngine } from './rbac/rbac_engine.js';
import { createRateLimiter } from './rate_limiter/rate_limiter.js';
import { createRetentionScheduler, DEFAULT_POLICIES } from './retention/retention_scheduler.js';
import { createTenantContext } from './tenant/tenant_context.js';
import { createSystemTimeProvider } from './time/time_provider.js';
import { randomUUID } from 'node:crypto';

/**
 * Create an independent kernel instance.
 * Returns a frozen object per C-07. Each call produces an independent instance per C-06.
 *
 * S ref: C-07 (Object.freeze), C-06 (no shared mutable state),
 *        §3.3 (engine not framework), SDD FPD-7
 */
export function createKernel(config: KernelConfig): Result<Readonly<Kernel>> {
  try {
    const time = createSystemTimeProvider();
    const startTime = time.nowMs();

    // ─── Build Order 1: Database lifecycle ───
    const database = createDatabaseLifecycle();
    const openResult = database.open({
      dataDir: config.dataDir,
      tenancy: config.tenancy,
      ...(config.busyTimeoutMs !== undefined ? { busyTimeoutMs: config.busyTimeoutMs } : {}),
    });

    if (!openResult.ok) return openResult;
    const conn = openResult.value;

    // ─── Build Order 2: Namespace enforcement ───
    const namespace = createNamespaceEnforcer();

    // Validate all migration SQL before applying
    const migrations = getPhase1Migrations();
    for (const migration of migrations) {
      const validationResult = namespace.validateMigration(migration.sql);
      if (!validationResult.ok) {
        conn.close();
        return validationResult;
      }
    }

    // Run migrations
    const migrateResult = database.migrate(conn, migrations);
    if (!migrateResult.ok) {
      conn.close();
      return migrateResult;
    }

    // ─── Build Order 4: Crypto engine ───
    // (Built before audit because audit needs sha256)
    const crypto = createCryptoEngine();
    const vault = createVaultOperations(crypto, config.masterKey);

    // ─── Build Order 3: Audit trail ───
    const audit = createAuditTrail(crypto.sha256);

    // ─── Build Order 5: Event bus ───
    // CF-010: Wire encryption adapter for webhook secret encryption at rest
    const stringEncryption = createStringEncryption(crypto, config.masterKey);
    const events = createEventBus(stringEncryption);

    // ─── Build Order 6: RBAC + Rate limiter ───
    // CF-006: Pass conn to restore RBAC active state from existing custom roles
    const rbac = createRbacEngine(conn);
    const rateLimiter = createRateLimiter();

    // CF-005 / DEC-4D-001: Clean stale archive flag on startup.
    // If kernel crashed mid-archive, the flag remains and the DELETE trigger is
    // permanently disabled. Clean it unconditionally — archive() is transactional,
    // so a stale flag means the archive didn't complete.
    conn.run('DELETE FROM core_audit_archive_active');

    // CF-035: Clean stale tombstone flag on startup (same rationale as archive flag).
    // CF-011: Guard with try/catch — table is created by Phase 4D4 migration
    // which may not have run yet on first startup.
    try {
      conn.run('DELETE FROM core_audit_tombstone_active');
    } catch {
      // Table does not exist yet (first run before Phase 4D4 migrations).
      // This is safe — no stale flag can exist if the table doesn't exist.
    }

    // Seed default roles in a transaction (I-03: mutation + audit in same txn)
    conn.transaction(() => {
      rbac.seedDefaultRoles(conn);

      // Seed default retention policies
      for (const policy of DEFAULT_POLICIES) {
        const id = randomUUID();
        conn.run(
          `INSERT INTO core_retention_policies (id, tenant_id, data_type, retention_days, action, enabled)
           VALUES (?, NULL, ?, ?, ?, 1)
           ON CONFLICT(tenant_id, data_type) DO NOTHING`,
          [id, policy.dataType, policy.retentionDays, policy.action]
        );
      }

      // Audit the kernel initialization
      audit.append(conn, {
        tenantId: null,
        actorType: 'system',
        actorId: 'kernel',
        operation: 'kernel.initialized',
        resourceType: 'kernel',
        resourceId: 'kernel',
        detail: {
          dataDir: config.dataDir,
          tenancyMode: config.tenancy.mode,
          schemaVersion: migrateResult.value.currentVersion,
          migrationsApplied: migrateResult.value.applied,
        },
      });
    });

    // ─── Build Order 7: Retention + Tenant ───
    const retention = createRetentionScheduler(audit);
    const tenant = createTenantContext(conn);

    // ─── Assemble Kernel ───
    const kernel: Kernel = {
      database,
      audit,
      crypto,
      vault,
      events,
      rbac,
      retention,
      namespace,
      tenant,
      rateLimiter,
      time,

      /**
       * Aggregated kernel health check.
       * S ref: I-05 (database consistency), I-06 (audit chain valid)
       */
      health(): Result<KernelHealth> {
        try {
          // Database health
          const dbHealthResult = database.health(conn);
          if (!dbHealthResult.ok) {
            return {
              ok: true,
              value: {
                status: 'unhealthy',
                database: {
                  status: 'unhealthy',
                  walSize: 0,
                  pageCount: 0,
                  freePages: 0,
                  schemaVersion: 0,
                  integrityOk: false,
                },
                auditChainValid: false,
                migrationsCurrent: false,
                rbacActive: rbac.isActive(),
                uptimeMs: time.nowMs() - startTime,
              },
            };
          }

          // Audit chain verification
          const chainResult = audit.verifyChain(conn);
          const auditChainValid = chainResult.ok && chainResult.value.valid;

          // Schema verification
          const schemaResult = database.verifySchema(conn);
          const migrationsCurrent = schemaResult.ok && schemaResult.value.valid;

          const dbHealth = dbHealthResult.value;
          const status = dbHealth.integrityOk && auditChainValid && migrationsCurrent
            ? 'healthy'
            : dbHealth.integrityOk
              ? 'degraded'
              : 'unhealthy';

          return {
            ok: true,
            value: {
              status,
              database: dbHealth,
              auditChainValid,
              migrationsCurrent,
              rbacActive: rbac.isActive(),
              uptimeMs: time.nowMs() - startTime,
            },
          };
        } catch (err) {
          return {
            ok: false,
            error: {
              code: 'HEALTH_CHECK_FAILED',
              message: err instanceof Error ? err.message : String(err),
              spec: 'I-05',
            },
          };
        }
      },
    };

    // CF-011: Track connection for destroyKernel cleanup
    kernelConnections.set(kernel, conn);

    // C-07: Freeze the kernel object to prevent mutation
    return { ok: true, value: Object.freeze(kernel) };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'KERNEL_CREATE_FAILED',
        message: err instanceof Error ? err.message : String(err),
        spec: 'C-07, C-06, §3.3',
      },
    };
  }
}

/**
 * Graceful shutdown: close kernel's internal database connection.
 * CF-011: Properly closes the connection tracked during createKernel.
 * Idempotent: calling destroyKernel twice is safe (second call is a no-op).
 *
 * S ref: I-05 (clean shutdown), §3.4 (WAL checkpoint)
 */
export function destroyKernel(kernel: Kernel): Result<void> {
  try {
    const conn = kernelConnections.get(kernel);
    if (conn) {
      // WAL checkpoint before close: ensures all pending writes are flushed
      // to the main database file. PASSIVE mode doesn't block readers.
      try {
        conn.run('PRAGMA wal_checkpoint(PASSIVE)');
      } catch {
        // Checkpoint failure is non-fatal — SQLite will replay WAL on next open
      }

      conn.close();
      kernelConnections.delete(kernel);
    }
    // If no connection found, kernel was already destroyed (idempotent).
    return { ok: true, value: undefined };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'KERNEL_DESTROY_FAILED',
        message: err instanceof Error ? err.message : String(err),
        spec: 'I-05',
      },
    };
  }
}

// Re-export all interfaces for consumer convenience
export type * from './interfaces/index.js';
