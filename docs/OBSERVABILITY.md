<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->
<!-- @phase SPRP Phase 3.1 — Observability & Monitoring Fabric -->

# Limen v5 Observability & Monitoring

This document describes every observability surface in Limen v5: what signals the engine produces, how to consume them, and what operational baselines indicate health or degradation.

---

## 1. Logging

### Architecture

Limen v5 uses **stderr-based structured warnings** rather than a general-purpose logging framework. The engine is designed as an embedded library (not a standalone service), so logging is the caller's responsibility. Limen emits structured signals through three channels:

| Channel | Format | Destination | Purpose |
|---------|--------|-------------|---------|
| `process.stderr.write()` | Plaintext, prefixed | stderr | Security warnings (RBAC dormant, provider status) |
| Audit trail (`limen.audit.*`) | Hash-chained structured records | SQLite `audit_entries` table | All state mutations |
| Telemetry claims (`limen.telemetry.*`) | Schema-validated JSON claims | SQLite `claim_assertions` table | Operational metrics as governed data |

### MCP Server Bootstrap Logging

The MCP server (`packages/limen-mcp/src/bootstrap.ts`) emits one structured warning at startup:

```
WARNING: RBAC dormant — all operations permitted. Set LIMEN_RBAC_ACTIVE=true for multi-agent deployments.
```

This warning is suppressed when `LIMEN_RBAC_ACTIVE=true` is set.

### Enterprise Audit Logger

The compliance layer (`src/compliance/audit/enterprise-logger.ts`) provides a secondary append-only, hash-chained logger with:
- SHA-256 canonical JSON hashing (sorted keys)
- Classification-aware entries (inherits from operations)
- Fail-closed semantics (caller must treat audit failure as operation failure)
- Deterministic time injection (no direct `Date` usage)

### What Limen Does NOT Have

- No general-purpose `console.log` / `console.error` logger
- No log levels (debug/info/warn/error) — by design
- No file-based log rotation — audit entries live in SQLite with retention policies

**Rationale:** Limen is a library. The host application (MCP server, CLI, SDK consumer) owns its own logging. Limen contributes structured audit data and health signals, not log lines.

---

## 2. Metrics

### API Surface

```typescript
limen.metrics.snapshot(tenantId?: string): MetricsSnapshot
```

Returns an in-process metrics snapshot as a typed JavaScript object (SD-08). Performance budget: < 5ms (no I/O, arithmetic only).

### MetricsSnapshot Shape

```typescript
interface MetricsSnapshot {
  limen_requests_total: number;
  limen_request_duration_ms: HistogramData;      // { p50, p99, count, sum }
  limen_tokens_total: { input: number; output: number };
  limen_tokens_cost_usd: number;
  limen_memory_retrieval_ms: HistogramData;
  limen_provider_ttft_ms: HistogramData;
  limen_provider_errors: number;
  limen_safety_violations: number;
  limen_sessions_active: number;
  limen_missions_active: number;
  limen_learning_techniques: number;
  limen_learning_cycles: number;
  limen_audit_chain_valid: boolean;
  limen_db_size_bytes: number;
  limen_db_wal_size_bytes: number;
  limen_stream_backpressure_events: number;
}

interface HistogramData {
  p50: number;    // 50th percentile
  p99: number;    // 99th percentile
  count: number;  // total observations
  sum: number;    // sum of all values
}
```

### Recording Methods (Internal Wiring)

The `MetricsCollector` class exposes recording methods wired to pipeline stages:

| Method | Tracked Signal |
|--------|---------------|
| `recordRequest(durationMs, tenantId?)` | Request count + latency histogram |
| `recordTokens(input, output, cost, tenantId?)` | Token usage + cost accumulation |
| `recordRetrievalLatency(durationMs)` | Memory retrieval p50/p99 |
| `recordTtft(durationMs)` | Provider time-to-first-token |
| `recordProviderError(tenantId?)` | Provider error count |
| `recordSafetyViolation(tenantId?)` | Safety violation count |
| `recordBackpressureEvent(tenantId?)` | Stream backpressure events |

### Multi-Tenant Isolation (SEC-018)

When `tenantId` is passed to `snapshot()`, only that tenant's counters are returned. Per-tenant state is independently tracked. The tenant counter map is capped at 10,000 entries (CF-036) to prevent unbounded memory growth.

### Histogram Implementation

Ring-buffer histograms with FIFO eviction at 1,000 entries. Percentiles computed via sorted-copy on each `snapshot()` call. Overhead budget: < 2% (S43).

---

## 3. Audit Trail

### Architecture

Limen's audit trail is the foundation of its governance model. Every state mutation is captured in the same database transaction as the mutation itself (I-03).

| Property | Implementation |
|----------|---------------|
| **Storage** | SQLite `audit_entries` table |
| **Append-only** | No UPDATE, no DELETE on active entries (I-06) |
| **Hash chain** | SHA-256, deterministic field ordering, pipe-delimited (§3.5) |
| **Genesis hash** | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (SHA-256 of empty string) |
| **Sequence numbers** | Monotonic, gap-free within the chain |
| **Tamper detection** | `verifyChain()` walks the chain and reports break location (FM-08) |
| **Global scope** | Hash chain is global across all tenants (FM-10) |
| **Archival** | Entries archived to cryptographically sealed files, not deleted (I-06) |
| **GDPR** | Tombstone operation replaces PII while preserving chain via cascade re-hash (CF-035) |

### AuditEntry Shape

```typescript
interface AuditEntry {
  seqNo: number;          // Monotonic sequence number
  id: string;             // UUID
  tenantId: string | null;
  timestamp: string;      // ISO 8601 with fractional seconds
  actorType: 'system' | 'user' | 'agent' | 'scheduler';
  actorId: string;
  operation: string;
  resourceType: string;
  resourceId: string;
  detail: object | null;
  previousHash: string;   // SHA-256 of previous entry
  currentHash: string;    // SHA-256 of this entry
}
```

### Verification API

```typescript
limen.audit.verifyChain(tenantId?): Result<ChainVerification>
```

Returns:
```typescript
interface ChainVerification {
  valid: boolean;
  totalEntries: number;
  firstSeqNo: number;
  lastSeqNo: number;
  brokenAt: number | null;    // Sequence number where break detected
  expectedHash: string | null;
  actualHash: string | null;
  gaps: number[];              // Missing sequence numbers
}
```

---

## 4. Health Checks

### API Surface

```typescript
limen.health(): HealthStatus
```

Synchronous. Performance budget: < 50ms (S32.4).

### HealthStatus Shape

```typescript
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime_ms: number;
  subsystems: {
    database: SubsystemHealth;
    audit: SubsystemHealth;
    providers: SubsystemHealth;
    sessions: SubsystemHealth;
    missions: SubsystemHealth;
    learning: SubsystemHealth;
    memory: SubsystemHealth;
  };
  latency: Record<string, { p50: number; p99: number }>;
  throughput: {
    requests_per_second: number;
    active_streams: number;
    error_rate_pct: number;
    write_queue_depth: number;
    active_missions: number;
  };
}

interface SubsystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  detail?: string;
}
```

### Decision Logic

The overall status is derived from subsystem states:

1. If `database` or `audit` is `unhealthy` --> **unhealthy** (critical infrastructure failure)
2. If any LLM providers are down --> **degraded** (FM-06, I-16: non-LLM operations still work)
3. If any other subsystem is `degraded` --> **degraded**
4. Otherwise --> **healthy**

### Composition

Health is composed from two layers:
- **L1 Kernel** (`kernel.health()`): database status, audit chain validity
- **L1.5 Substrate** (`substrate.health(conn)`): provider status, queue depth

---

## 5. AI-Specific Signals (Cognitive Health)

### API Surface

```typescript
limen.cognitive.health(config?): Result<CognitiveHealthReport>
limen.cognitive.delta(options): Result<DeltaResult>
```

### CognitiveHealthReport Shape

```typescript
interface CognitiveHealthReport {
  totalClaims: number;

  freshness: {
    fresh: number;         // Claims accessed within freshDays (default: 7)
    aging: number;         // Claims between freshDays and agingDays (default: 30)
    stale: number;         // Claims older than agingDays
    percentFresh: number;  // Percentage of fresh claims
  };

  conflicts: {
    unresolved: number;    // Active-active contradicts pairs
    critical: Array<{
      claimIds: [string, string];
      subject: string;
    }>;
  };

  confidence: {
    mean: number;
    median: number;
    below30: number;       // Low-confidence claims count
    above90: number;       // High-confidence claims count
  };

  gaps: Array<{
    domain: string;        // Predicate domain with no recent assertions
    lastClaimAge: string;  // Human-readable age (e.g., "45 days")
    significance: 'low' | 'medium' | 'high';
  }>;

  staleDomains: Array<{
    predicate: string;
    newestClaimAge: string;
    claimCount: number;
  }>;

  reviewNeeded: number;    // Claims with retracted evidence needing review
  formatted?: string;      // Present when outputMode is not 'structured'
}
```

### Configuration

```typescript
interface CognitiveHealthConfig {
  gapThresholdDays?: number;      // Default: engine config
  staleThresholdDays?: number;    // Default: engine config
  maxCriticalConflicts?: number;  // Max critical conflicts to return
  maxGaps?: number;               // Max gap entries to return
  maxStaleDomains?: number;       // Max stale domain entries
  maxAge?: number;                // Cache window in ms (FR-003)
  outputMode?: 'structured' | 'human-readable' | 'ai-dense';
}
```

### Output Modes (FR-010)

- **structured** (default): Raw TypeScript object, full fidelity
- **human-readable**: Multi-line text block for operator consumption
- **ai-dense**: Minimal tokens, fixed positions, no prose. Format: `H[t:<total> f:<fresh>/<aging>/<stale> c:<conflicts> g:<gaps> s:<meanConf> d:<domains>]`

### Delta Queries

```typescript
limen.cognitive.delta({ since: '2026-05-10T00:00:00Z', predicates?: string[] }): Result<DeltaResult>
```

Returns counts of added claims, retracted claims, and new conflicts since a timestamp. Lightweight alternative to full health check for detecting changes.

### Caching (FR-003)

`cognitive.health()` supports per-instance caching via `maxAge`. When set, returns the cached report if the cache is younger than `maxAge` milliseconds. Cache is invalidated automatically on mutations via `invalidateHealthCache()`.

---

## 6. Operational Runbooks

### RB-001: Database Unhealthy

**Symptom:** `limen.health().status === 'unhealthy'` with `subsystems.database.status === 'unhealthy'`

**Diagnosis:**
1. Check disk space: SQLite requires free space for WAL and journal files
2. Verify WAL mode: `PRAGMA journal_mode` should return `wal`
3. Check `busy_timeout`: Should be set (default: 5000ms) to prevent SQLITE_BUSY under concurrent access
4. Check database file permissions
5. Run `PRAGMA integrity_check` for corruption

**Resolution:**
- Low disk: Free space or move data directory
- Corruption: Restore from latest backup; audit archive files preserve historical data
- Lock contention: Increase `busy_timeout` or reduce concurrent writers

---

### RB-002: Audit Chain Broken

**Symptom:** `limen.audit.verifyChain()` returns `{ valid: false, brokenAt: N }`

**Diagnosis:**
1. Run `limen.audit.verifyChain()` to identify the exact sequence number where the break occurred
2. Check `brokenAt`, `expectedHash`, and `actualHash` to understand the discrepancy
3. Check for gaps in sequence numbers (returned in `gaps` array)

**Resolution:**
- If `brokenAt` is identified: The entry at that sequence number was modified or a preceding entry was altered
- If `gaps` is non-empty: Sequence numbers were skipped, indicating a transaction rollback or data loss
- A broken chain is a tamper indicator (FM-08). Investigate whether the database was modified outside Limen
- Restore from the most recent valid archive segment and replay operations if possible
- **This is a CRITICAL finding** — treat as a security incident

---

### RB-003: High Conflict Count

**Symptom:** `limen.cognitive.health().conflicts.unresolved > 10%` of total claims

**Diagnosis:**
1. Review `conflicts.critical` for the highest-priority pairs
2. Check if conflicts are genuine disagreements or stale data
3. Run `limen.cognitive.delta({ since: <recent_timestamp> })` to see if conflicts are growing

**Resolution:**
1. Run `limen.cognitive.consolidate({ dryRun: true })` to preview what consolidation would do
2. If preview is acceptable: `limen.cognitive.consolidate()` to merge similar claims, archive stale low-confidence claims, and suggest contradiction resolutions
3. For individual conflicts: use `limen.cognitive.verify(claimId)` with an external provider to get a verdict
4. Manual resolution: retract the incorrect claim via `limen.claims.retract(claimId, reason)`

---

### RB-004: Stale Knowledge Base

**Symptom:** `limen.cognitive.health().freshness.percentFresh < 20`

**Diagnosis:**
1. Check `staleDomains` for which predicates have the oldest unaccessed claims
2. Check `gaps` for domains with no recent assertions at all
3. Determine if the knowledge base is genuinely stale or if the freshness thresholds need adjustment

**Resolution:**
1. For actively needed domains: trigger new assertions to refresh knowledge
2. For obsolete domains: run `limen.cognitive.consolidate()` to archive low-confidence stale claims
3. Adjust `freshnessThresholds` in engine config if defaults (7 days fresh, 30 days aging) are too aggressive for your use case
4. Review `reviewNeeded` count — claims with retracted evidence may be inflating staleness

---

### RB-005: Rate Limit Hit

**Symptom:** API calls returning error code `RATE_LIMITED` or `429` equivalent

**Diagnosis:**
1. Check rate limiter configuration in engine config
2. Review `limen.metrics.snapshot().limen_requests_total` for request volume
3. Check `limen_stream_backpressure_events` for queue saturation

**Resolution:**
- Increase burst config if load is legitimate
- Implement request batching (use `limen.recall.bulk()` instead of multiple single recalls)
- If backpressure events are high: reduce concurrent writers or increase queue depth
- Check for runaway loops in calling code

---

### RB-006: Consent Violation

**Symptom:** Operations failing with consent-related error codes

**Diagnosis:**
1. Check if active consent exists: `limen.consent.check(dataSubjectId, scope)`
2. Review consent expiration — expiry is computed on read
3. Check if the consent basis matches the operation type

**Resolution:**
1. If consent expired: re-register via `limen.consent.register({ dataSubjectId, basis, scope, expiresAt? })`
2. If consent never registered: obtain consent from data subject and register it
3. If consent scope mismatch: register consent for the specific scope needed
4. Valid bases: `explicit_consent`, `contract_performance`, `legal_obligation`, `legitimate_interest`

---

## 7. Anomaly Baselines

These baselines describe normal operating ranges for a healthy Limen instance. Values outside these ranges warrant investigation.

### Claim Activity

| Metric | Normal | Warning | Critical |
|--------|--------|---------|----------|
| Claims asserted per minute | 10 - 100 | 100 - 500 | > 500 (possible runaway loop) |
| Claims retracted per minute | 0 - 5 | 5 - 20 | > 20 (bulk retraction or data issue) |
| Consolidation merge rate | < 5% per run | 5 - 15% | > 15% (excessive duplication) |

### Knowledge Freshness

| Metric | Healthy | Degraded | Critical |
|--------|---------|----------|----------|
| `freshness.percentFresh` | > 50% | 20 - 50% | < 20% |
| `gaps` count | 0 | 1 - 3 | > 3 domains with no recent claims |
| `staleDomains` count | 0 - 2 | 3 - 5 | > 5 |

### Conflict State

| Metric | Normal | Warning | Critical |
|--------|--------|---------|----------|
| `conflicts.unresolved` as % of `totalClaims` | < 5% | 5 - 10% | > 10% |
| `conflicts.critical` count | 0 | 1 - 2 | > 2 |
| `reviewNeeded` | 0 | 1 - 5 | > 5 |

### Audit Chain

| Metric | Normal | Critical |
|--------|--------|----------|
| `limen_audit_chain_valid` | `true` (always) | `false` (SECURITY INCIDENT) |
| Audit entries per hour | 50 - 5,000 | > 10,000 (audit storm) |

### System Health

| Metric | Healthy | Degraded | Critical |
|--------|---------|----------|----------|
| `health().status` | `healthy` | `degraded` (acceptable, non-LLM ops work) | `unhealthy` (immediate action required) |
| `limen_request_duration_ms.p99` | < 100ms | 100 - 500ms | > 500ms |
| `limen_provider_ttft_ms.p99` | < 2000ms | 2000 - 5000ms | > 5000ms |
| `limen_provider_errors` growth rate | 0 per hour | < 10 per hour | > 10 per hour |
| `limen_safety_violations` | 0 | 1 - 2 | > 2 (investigate source) |
| `limen_db_wal_size_bytes` | < 10MB | 10 - 50MB | > 50MB (checkpoint may be stuck) |
| `limen_stream_backpressure_events` | 0 | 1 - 5 per hour | > 5 per hour |

### Confidence Distribution

| Metric | Healthy | Warning |
|--------|---------|---------|
| `confidence.mean` | 0.6 - 0.85 | < 0.5 (low-quality knowledge) or > 0.95 (overconfidence) |
| `confidence.below30` as % of total | < 5% | > 10% |

---

## Telemetry as Governed Claims

Limen's telemetry system stores operational data as governed claims (FR-004), making telemetry data subject to the same integrity guarantees as knowledge claims:

```typescript
// Record a cost telemetry point
limen.telemetry.record('cost', {
  model: 'claude-opus-4-20250514',
  inputTokens: 1500,
  outputTokens: 300,
  costUsd: 0.045
});

// Record a vital sign
limen.telemetry.record('vital', {
  metric: 'memory_rss_bytes',
  value: 104857600
});

// Record an audit action
limen.telemetry.record('audit', {
  action: 'claim_retracted',
  actorId: 'agent-alpha',
  detail: 'Superseded by newer observation'
});

// Query recent cost telemetry
limen.telemetry.query('cost', { since: '2026-05-11T00:00:00Z', limit: 50 });
```

Telemetry types: `cost` (LLM consumption), `vital` (operational signals), `audit` (action trail). All schema-validated via Zod before storage.

---

## Summary of Observability Surfaces

| Surface | API | Format | Latency | Scope |
|---------|-----|--------|---------|-------|
| Health check | `limen.health()` | `HealthStatus` object | < 50ms | System-wide |
| Metrics snapshot | `limen.metrics.snapshot()` | `MetricsSnapshot` object | < 5ms | Global or per-tenant |
| Cognitive health | `limen.cognitive.health()` | `CognitiveHealthReport` | Varies (cacheable) | Per-tenant |
| Cognitive delta | `limen.cognitive.delta()` | `DeltaResult` | Fast | Per-tenant |
| Audit trail | `limen.audit.query()` | `AuditEntry[]` | Database query | Per-tenant or global |
| Audit verification | `limen.audit.verifyChain()` | `ChainVerification` | O(n) entries | Global |
| Telemetry record | `limen.telemetry.record()` | Governed claim | CCP pipeline | Per-tenant |
| Telemetry query | `limen.telemetry.query()` | `BeliefView[]` | Database query | Per-tenant |
| Consolidation | `limen.cognitive.consolidate()` | `ConsolidationResult` | Varies | Per-tenant |
| Narrative | `limen.cognitive.narrative()` | `NarrativeSnapshot` | Database query | Per-mission or global |
