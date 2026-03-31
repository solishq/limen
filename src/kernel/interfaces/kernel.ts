/**
 * Kernel factory interface types.
 * S ref: C-07 (Object.freeze), C-06 (no shared mutable state), §3.3 (engine not framework)
 *
 * Phase: 1 (Kernel)
 * Implements: Kernel creation and destruction with frozen, independent instances.
 *
 * C-07: Object.freeze on public API.
 * C-06: Two createKernel() calls produce independent instances.
 * §3.3: Engine, not framework -- consumer receives complete opaque object.
 */

import type { Result } from './common.js';
import type { TenancyConfig, DatabaseLifecycle, DatabaseHealth } from './database.js';
import type { AuditTrail } from './audit.js';
import type { CryptoEngine, VaultOperations } from './crypto.js';
import type { EventBus } from './events.js';
import type { RbacEngine } from './rbac.js';
import type { RetentionScheduler } from './retention.js';
import type { NamespaceEnforcer } from './namespace.js';
import type { TenantContext } from './tenant.js';
import type { RateLimiter } from './rate_limiter.js';
import type { TimeProvider } from './time.js';

// ─── Kernel Configuration ───

/**
 * Configuration for creating a kernel instance.
 * S ref: §3.6 (dataDir), I-11 (masterKey), FM-05 (busyTimeoutMs)
 */
export interface KernelConfig {
  readonly dataDir: string;
  readonly tenancy: TenancyConfig;
  readonly masterKey: Buffer;
  readonly busyTimeoutMs?: number;            // default 5000
  readonly postQuantum?: boolean;             // default false
  /**
   * Phase 4 §4.5, C.8: Force RBAC active regardless of custom roles.
   * When true, RBAC enforces on all operations.
   * When false/undefined (default), RBAC is dormant unless custom roles exist.
   * I-P4-10, I-P4-11.
   */
  readonly requireRbac?: boolean;
}

// ─── Kernel Health ───

/**
 * Aggregated kernel health status.
 * S ref: I-05 (consistency), I-06 (audit chain), C-05 (migrations)
 */
export interface KernelHealth {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly database: DatabaseHealth;
  readonly auditChainValid: boolean;
  readonly migrationsCurrent: boolean;
  readonly rbacActive: boolean;
  readonly uptimeMs: number;
}

// ─── Kernel Interface ───

/**
 * The complete kernel interface. Returned frozen by createKernel().
 * S ref: C-07 (Object.freeze), §3.3 (engine, not framework)
 */
export interface Kernel {
  readonly database: DatabaseLifecycle;
  readonly audit: AuditTrail;
  readonly crypto: CryptoEngine;
  readonly vault: VaultOperations;
  readonly events: EventBus;
  readonly rbac: RbacEngine;
  readonly retention: RetentionScheduler;
  readonly namespace: NamespaceEnforcer;
  readonly tenant: TenantContext;
  readonly rateLimiter: RateLimiter;
  readonly time: TimeProvider;

  /**
   * Aggregated kernel health check.
   * S ref: I-05 (database consistency), I-06 (audit chain valid)
   */
  health(): Result<KernelHealth>;
}

// ─── Factory Functions ───
// Note: These are declared as interfaces for type reference.
// The actual functions are exported from the kernel module.

/**
 * Create an independent kernel instance. Returns frozen object (C-07).
 * Two calls produce independent instances (C-06).
 * S ref: C-07 (Object.freeze), C-06 (no shared mutable state), §3.3 (engine)
 */
export type CreateKernelFn = (config: KernelConfig) => Result<Readonly<Kernel>>;

/**
 * Graceful shutdown: close DB, flush pending webhooks, archive metrics.
 * S ref: I-05 (clean shutdown), §3.4 (WAL checkpoint)
 */
export type DestroyKernelFn = (kernel: Kernel) => Result<void>;
