/**
 * Metrics API for the API surface.
 * S ref: S32.2 (in-process metrics), SD-08 (structured JavaScript object),
 *        S43 (observability overhead < 2%)
 *
 * Phase: 4 (API Surface)
 * Implements: SDD §7 build order item 12 (metrics)
 *
 * limen.metrics.snapshot() returns a MetricsSnapshot as a typed JavaScript object (SD-08).
 * SEC-018: Metrics are tenant-scoped when tenantId is provided.
 *
 * The metrics are composed from in-memory counters and histograms maintained
 * by the API layer. No database queries required for a snapshot.
 *
 * Performance budget: < 5ms (S32.2 in-process).
 * Observability overhead: < 2% (S43, FM-11).
 */

import type { Kernel } from '../../kernel/interfaces/index.js';
import type { MetricsApi, MetricsSnapshot, HistogramData } from '../interfaces/api.js';

// ============================================================================
// SEC-018: Per-Tenant Metrics Counters
// ============================================================================

/**
 * SEC-018: Per-tenant metrics state.
 * Each tenant gets an independent set of counters and histograms.
 */
interface TenantMetrics {
  requestsTotal: number;
  readonly requestDurations: number[];
  inputTokensTotal: number;
  outputTokensTotal: number;
  costTotal: number;
  providerErrors: number;
  safetyViolations: number;
  backpressureEvents: number;
}

// ============================================================================
// MetricsCollector
// ============================================================================

/**
 * S32.2: In-process metrics collector.
 * Aggregates counters and histograms from all layers.
 * Returns a structured MetricsSnapshot (SD-08) via snapshot().
 *
 * SEC-018: Supports per-tenant tracking via optional tenantId on recording methods.
 * Maintains ring-buffer histograms for latency percentiles.
 * S43: Overhead < 2% via atomic counter increments, no locks.
 */
export class MetricsCollector implements MetricsApi {
  private requestsTotal = 0;
  private readonly requestDurations: number[] = [];
  private inputTokensTotal = 0;
  private outputTokensTotal = 0;
  private costTotal = 0;
  private readonly retrievalDurations: number[] = [];
  private readonly ttftDurations: number[] = [];
  private providerErrors = 0;
  private safetyViolations = 0;
  private backpressureEvents = 0;

  /** SEC-018: Per-tenant metrics keyed by tenantId. */
  private readonly tenantCounters = new Map<string, TenantMetrics>();

  private static readonly MAX_HISTOGRAM_SIZE = 1000;

  /** CF-036: Cap on per-tenant metrics entries to prevent unbounded memory growth (FM-02). */
  private static readonly MAX_TENANT_METRICS = 10_000;

  constructor(
    private readonly kernel: Kernel,
  ) {}

  /**
   * SEC-018: Get or create per-tenant counters.
   */
  /**
   * SEC-018: Get or create per-tenant counters.
   * CF-036: Returns null when Map is at capacity for new tenantIds.
   * Existing tenants are always returned regardless of capacity.
   */
  private getTenantCounters(tenantId: string): TenantMetrics | null {
    let counters = this.tenantCounters.get(tenantId);
    if (!counters) {
      // CF-036: Enforce cap — silently degrade to global-only tracking
      if (this.tenantCounters.size >= MetricsCollector.MAX_TENANT_METRICS) {
        return null;
      }
      counters = {
        requestsTotal: 0,
        requestDurations: [],
        inputTokensTotal: 0,
        outputTokensTotal: 0,
        costTotal: 0,
        providerErrors: 0,
        safetyViolations: 0,
        backpressureEvents: 0,
      };
      this.tenantCounters.set(tenantId, counters);
    }
    return counters;
  }

  /**
   * S32.2, SD-08: Get current metrics snapshot.
   * SEC-018: When tenantId is provided, returns only that tenant's metrics.
   * Without tenantId, returns global (aggregate) metrics.
   * Performance: < 5ms (arithmetic only, no I/O).
   */
  snapshot(tenantId?: string): MetricsSnapshot {
    if (tenantId) {
      return this.buildTenantSnapshot(tenantId);
    }
    return this.buildGlobalSnapshot();
  }

  /**
   * SEC-018: Build a tenant-scoped snapshot.
   */
  private buildTenantSnapshot(tenantId: string): MetricsSnapshot {
    const counters = this.tenantCounters.get(tenantId);

    // Tenant has no recorded metrics — return zeros
    if (!counters) {
      return {
        limen_requests_total: 0,
        limen_request_duration_ms: { p50: 0, p99: 0, count: 0, sum: 0 },
        limen_tokens_total: { input: 0, output: 0 },
        limen_tokens_cost_usd: 0,
        limen_memory_retrieval_ms: { p50: 0, p99: 0, count: 0, sum: 0 },
        limen_provider_ttft_ms: { p50: 0, p99: 0, count: 0, sum: 0 },
        limen_provider_errors: 0,
        limen_safety_violations: 0,
        limen_sessions_active: 0,
        limen_missions_active: 0,
        limen_learning_techniques: 0,
        limen_learning_cycles: 0,
        limen_audit_chain_valid: false,
        limen_db_size_bytes: 0,
        limen_db_wal_size_bytes: 0,
        limen_stream_backpressure_events: 0,
      };
    }

    return {
      limen_requests_total: counters.requestsTotal,
      limen_request_duration_ms: this.computeHistogram(counters.requestDurations),
      limen_tokens_total: {
        input: counters.inputTokensTotal,
        output: counters.outputTokensTotal,
      },
      limen_tokens_cost_usd: counters.costTotal,
      limen_memory_retrieval_ms: { p50: 0, p99: 0, count: 0, sum: 0 },
      limen_provider_ttft_ms: { p50: 0, p99: 0, count: 0, sum: 0 },
      limen_provider_errors: counters.providerErrors,
      limen_safety_violations: counters.safetyViolations,
      limen_sessions_active: 0,
      limen_missions_active: 0,
      limen_learning_techniques: 0,
      limen_learning_cycles: 0,
      limen_audit_chain_valid: false,
      limen_db_size_bytes: 0,
      limen_db_wal_size_bytes: 0,
      limen_stream_backpressure_events: counters.backpressureEvents,
    };
  }

  /**
   * Build global (aggregate) snapshot — original behavior.
   */
  private buildGlobalSnapshot(): MetricsSnapshot {
    const kernelHealthResult = this.kernel.health();
    const kernelHealth = kernelHealthResult.ok ? kernelHealthResult.value : null;

    return {
      limen_requests_total: this.requestsTotal,
      limen_request_duration_ms: this.computeHistogram(this.requestDurations),
      limen_tokens_total: {
        input: this.inputTokensTotal,
        output: this.outputTokensTotal,
      },
      limen_tokens_cost_usd: this.costTotal,
      limen_memory_retrieval_ms: this.computeHistogram(this.retrievalDurations),
      limen_provider_ttft_ms: this.computeHistogram(this.ttftDurations),
      limen_provider_errors: this.providerErrors,
      limen_safety_violations: this.safetyViolations,
      limen_sessions_active: 0,
      limen_missions_active: 0,
      limen_learning_techniques: 0,
      limen_learning_cycles: 0,
      limen_audit_chain_valid: kernelHealth?.auditChainValid ?? false,
      limen_db_size_bytes: kernelHealth?.database.pageCount ?? 0,
      limen_db_wal_size_bytes: kernelHealth?.database.walSize ?? 0,
      limen_stream_backpressure_events: this.backpressureEvents,
    };
  }

  // ─── Recording Methods ──
  // Wired to ChatPipeline and InferPipeline via constructor injection (PRR-103).

  /** Record a completed request with its duration. SEC-018: Optional tenantId. */
  recordRequest(durationMs: number, tenantId?: string): void {
    this.requestsTotal++;
    this.pushToHistogram(this.requestDurations, durationMs);
    if (tenantId) {
      const tc = this.getTenantCounters(tenantId);
      if (tc) {
        tc.requestsTotal++;
        this.pushToHistogram(tc.requestDurations, durationMs);
      }
    }
  }

  /** Record token usage from a generation. SEC-018: Optional tenantId. */
  recordTokens(input: number, output: number, cost: number, tenantId?: string): void {
    this.inputTokensTotal += input;
    this.outputTokensTotal += output;
    this.costTotal += cost;
    if (tenantId) {
      const tc = this.getTenantCounters(tenantId);
      if (tc) {
        tc.inputTokensTotal += input;
        tc.outputTokensTotal += output;
        tc.costTotal += cost;
      }
    }
  }

  /** Record memory retrieval latency. */
  recordRetrievalLatency(durationMs: number): void {
    this.pushToHistogram(this.retrievalDurations, durationMs);
  }

  /** Record time-to-first-token from provider. */
  recordTtft(durationMs: number): void {
    this.pushToHistogram(this.ttftDurations, durationMs);
  }

  /** Record a provider error. SEC-018: Optional tenantId. */
  recordProviderError(tenantId?: string): void {
    this.providerErrors++;
    if (tenantId) {
      const tc = this.getTenantCounters(tenantId);
      if (tc) tc.providerErrors++;
    }
  }

  /** Record a safety violation. SEC-018: Optional tenantId. */
  recordSafetyViolation(tenantId?: string): void {
    this.safetyViolations++;
    if (tenantId) {
      const tc = this.getTenantCounters(tenantId);
      if (tc) tc.safetyViolations++;
    }
  }

  /** Record a backpressure event. SEC-018: Optional tenantId. */
  recordBackpressureEvent(tenantId?: string): void {
    this.backpressureEvents++;
    if (tenantId) {
      const tc = this.getTenantCounters(tenantId);
      if (tc) tc.backpressureEvents++;
    }
  }

  // ─── Private Helpers ──

  /**
   * Push a value into a ring-buffer histogram.
   * Maintains at most MAX_HISTOGRAM_SIZE entries (FIFO eviction).
   */
  private pushToHistogram(buffer: number[], value: number): void {
    buffer.push(value);
    if (buffer.length > MetricsCollector.MAX_HISTOGRAM_SIZE) {
      buffer.shift();
    }
  }

  /**
   * Compute histogram data (p50, p99, count, sum) from a sorted buffer.
   */
  private computeHistogram(buffer: number[]): HistogramData {
    if (buffer.length === 0) {
      return { p50: 0, p99: 0, count: 0, sum: 0 };
    }

    const sorted = [...buffer].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((acc, v) => acc + v, 0);

    const p50Index = Math.floor(count * 0.5);
    const p99Index = Math.min(Math.floor(count * 0.99), count - 1);

    return {
      p50: sorted[p50Index]!,
      p99: sorted[p99Index]!,
      count,
      sum,
    };
  }
}
