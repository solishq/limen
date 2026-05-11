<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->
<!-- @phase SPRP Phase 3.1 — Observability & Monitoring Fabric -->

# Limen v5 Operational Runbooks

Quick-reference operational procedures for common failure scenarios. Each runbook follows the pattern: Symptom, Diagnosis, Resolution, Verification.

For full observability documentation see [OBSERVABILITY.md](./OBSERVABILITY.md).

---

## RB-001: Database Unhealthy

**Symptom:** `limen.health().subsystems.database.status === 'unhealthy'`

**Diagnosis:**
1. Check disk space — SQLite needs free space for WAL and journal
2. `PRAGMA journal_mode` should return `wal`
3. `PRAGMA busy_timeout` should be > 0 (default: 5000ms)
4. Check file permissions on data directory
5. `PRAGMA integrity_check` for corruption

**Resolution:**
- Low disk: free space or relocate `dataDir`
- Corruption: restore from backup; audit archives preserve history
- Lock contention: increase `busy_timeout`

**Verification:** `limen.health().subsystems.database.status === 'healthy'`

---

## RB-002: Audit Chain Broken

**Symptom:** `limen.audit.verifyChain().value.valid === false`

**Diagnosis:**
1. Note `brokenAt` sequence number and hash mismatch (`expectedHash` vs `actualHash`)
2. Check `gaps` array for missing sequence numbers
3. Investigate whether database was modified outside Limen

**Resolution:**
- **This is a CRITICAL security finding** — treat as a potential tampering incident
- Restore from most recent valid archive segment
- Replay operations if possible
- If gaps present: transaction rollback or data loss occurred

**Verification:** `limen.audit.verifyChain().value.valid === true`

---

## RB-003: High Conflict Count

**Symptom:** `cognitive.health().conflicts.unresolved` exceeds 10% of `totalClaims`

**Diagnosis:**
1. Review `conflicts.critical` for highest-priority pairs
2. `limen.cognitive.delta({ since: <timestamp> })` to check growth rate
3. Determine if conflicts are genuine disagreements or stale data

**Resolution:**
1. Preview: `limen.cognitive.consolidate({ dryRun: true })`
2. Execute: `limen.cognitive.consolidate()`
3. For individual claims: `limen.cognitive.verify(claimId)` via external provider
4. Manual: `limen.claims.retract(claimId, 'incorrect')` for known-bad claims

**Verification:** `cognitive.health().conflicts.unresolved` below 5% of total

---

## RB-004: Stale Knowledge Base

**Symptom:** `cognitive.health().freshness.percentFresh < 20`

**Diagnosis:**
1. Check `staleDomains` for predicates with oldest unaccessed claims
2. Check `gaps` for domains with no recent assertions
3. Check `reviewNeeded` — claims with retracted evidence inflate staleness

**Resolution:**
1. For active domains: trigger new assertions to refresh
2. For obsolete domains: `limen.cognitive.consolidate()` to archive
3. Adjust `freshnessThresholds` if defaults (7d fresh, 30d aging) are too aggressive

**Verification:** `cognitive.health().freshness.percentFresh > 50`

---

## RB-005: Rate Limit Hit

**Symptom:** Operations returning `RATE_LIMITED` error code

**Diagnosis:**
1. Check `limen.metrics.snapshot().limen_requests_total` for volume
2. Check `limen_stream_backpressure_events` for queue saturation
3. Review rate limiter configuration in engine config

**Resolution:**
- Increase burst config for legitimate load
- Batch requests: use `limen.recall.bulk()` instead of multiple singles
- High backpressure: reduce concurrent writers or increase queue depth
- Check for runaway loops in calling code

**Verification:** Operations succeed; `backpressure_events` growth stops

---

## RB-006: Consent Violation

**Symptom:** Operations failing with consent-related error codes

**Diagnosis:**
1. `limen.consent.check(dataSubjectId, scope)` — does active consent exist?
2. Check expiration (computed on read)
3. Verify consent basis matches operation type

**Resolution:**
1. Expired: re-register with `limen.consent.register({ dataSubjectId, basis, scope, expiresAt? })`
2. Never registered: obtain consent, then register
3. Scope mismatch: register for the specific scope needed
4. Valid bases: `explicit_consent`, `contract_performance`, `legal_obligation`, `legitimate_interest`

**Verification:** `limen.consent.check(dataSubjectId, scope)` returns active consent

---

## RB-007: Provider Degradation

**Symptom:** `limen.health().subsystems.providers.status === 'degraded'`

**Diagnosis:**
1. Check `limen.health().subsystems.providers.detail` for specifics
2. Check `limen.metrics.snapshot().limen_provider_errors` growth rate
3. Check `limen_provider_ttft_ms.p99` for latency spikes

**Resolution:**
- LLM provider down: non-LLM operations (claims, audit, recall) continue normally (I-16, FM-06)
- High TTFT: provider may be overloaded; reduce request rate or switch provider
- Error growth: check provider API status page; verify API keys
- All providers down: engine enters `degraded` mode automatically

**Verification:** `limen.health().subsystems.providers.status === 'healthy'`

---

## RB-008: WAL Size Growth

**Symptom:** `limen.metrics.snapshot().limen_db_wal_size_bytes > 50MB`

**Diagnosis:**
1. WAL checkpoint may be stuck due to long-running readers
2. Check for open transactions holding WAL locks
3. Verify `PRAGMA wal_autocheckpoint` is set

**Resolution:**
- Force checkpoint: `PRAGMA wal_checkpoint(TRUNCATE)` (requires no active readers)
- Close long-running connections
- If persistent: increase autocheckpoint threshold or schedule periodic checkpoints

**Verification:** `limen_db_wal_size_bytes < 10MB` after checkpoint
