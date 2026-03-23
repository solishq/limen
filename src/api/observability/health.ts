/**
 * Health check for the API surface.
 * S ref: S32.4 (health check), FM-06 (provider dependency), I-16 (graceful degradation)
 *
 * Phase: 4 (API Surface)
 * Implements: SDD §7 build order item 12 (health)
 *
 * limen.health() returns a HealthStatus with three-state logic:
 *   - 'healthy': All subsystems operational including LLM providers
 *   - 'degraded': No LLM providers available but non-LLM operations work (I-16, FM-06)
 *   - 'unhealthy': Critical failure in database, audit, or other core subsystem
 *
 * Composes health from L1 Kernel health + L1.5 Substrate health.
 *
 * Performance budget: < 50ms (S32.4 quick aggregation).
 */

import type { Kernel, KernelHealth, DatabaseConnection } from '../../kernel/interfaces/index.js';
import type { Substrate, SubstrateHealth } from '../../substrate/interfaces/substrate.js';
import type { HealthStatus, SubsystemHealth } from '../interfaces/api.js';

/**
 * S32.4: Compose health status from all layers.
 *
 * Decision logic:
 *   1. If kernel database or audit is unhealthy -> 'unhealthy'
 *   2. If LLM providers are all down -> 'degraded' (FM-06, I-16)
 *   3. If any subsystem is degraded -> 'degraded'
 *   4. Otherwise -> 'healthy'
 *
 * @param kernel - L1 Kernel instance
 * @param substrate - L1.5 Substrate instance
 * @param conn - Database connection for substrate health
 * @param startTime - Engine start time for uptime calculation
 * @returns HealthStatus
 */
export async function getHealth(
  kernel: Kernel,
  substrate: Substrate,
  conn: DatabaseConnection,
  startTime: number,
): Promise<HealthStatus> {
  // Get kernel health
  const kernelHealthResult = kernel.health();
  const kernelHealth: KernelHealth | null = kernelHealthResult.ok ? kernelHealthResult.value : null;

  // Get substrate health (provider status)
  const substrateHealthResult = substrate.health(conn);
  const subHealth: SubstrateHealth | null = substrateHealthResult.ok ? substrateHealthResult.value : null;

  // Compose subsystem health states
  const database: SubsystemHealth = kernelHealth
    ? { status: kernelHealth.database.status === 'healthy' ? 'healthy' : 'unhealthy' }
    : { status: 'unhealthy', detail: 'Kernel health check failed' };

  const audit: SubsystemHealth = kernelHealth
    ? kernelHealth.auditChainValid
      ? { status: 'healthy' }
      : { status: 'unhealthy', detail: 'Audit chain integrity violation' }
    : { status: 'unhealthy', detail: 'Audit health unavailable' };

  const providers: SubsystemHealth = subHealth
    ? subHealth.providers.healthy > 0
      ? { status: 'healthy' }
      : { status: 'degraded', detail: 'No LLM providers available' }
    : { status: 'degraded', detail: 'Provider health check failed' };

  // Sessions, missions, learning, memory health derived from kernel/substrate status
  const sessions: SubsystemHealth = { status: kernelHealth ? 'healthy' : 'degraded' };
  const missions: SubsystemHealth = { status: kernelHealth ? 'healthy' : 'degraded' };
  const learning: SubsystemHealth = { status: 'healthy' };
  const memory: SubsystemHealth = { status: 'healthy' };

  // Determine overall status
  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (database.status === 'unhealthy' || audit.status === 'unhealthy') {
    status = 'unhealthy';
  } else if (
    providers.status === 'degraded' || sessions.status === 'degraded' ||
    missions.status === 'degraded'
  ) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  return {
    status,
    uptime_ms: kernel.time.nowMs() - startTime,
    subsystems: {
      database,
      audit,
      providers,
      sessions,
      missions,
      learning,
      memory,
    },
    latency: {},
    throughput: {
      requests_per_second: 0,
      active_streams: 0,
      error_rate_pct: 0,
      write_queue_depth: subHealth ? subHealth.queue.pending : 0,
      active_missions: 0,
    },
  };
}
