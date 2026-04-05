---
eap_version: "1.0.0"
type: "VERDICT"
id: "prr-limen-2026-04-04"
project: "limen"
commit: "0dd115638962ba1b8a2a297f44af7d36a746f406"
timestamp: "2026-04-04T12:00:00Z"
producer_role: "Certifier"
evidence_status: "VALIDATED"
qal_level: 4
---

# Production Readiness Review -- Limen v2.0.0

**System**: Limen (Cognitive Infrastructure for AI Agents)
**Version**: 2.0.0 (npm: limen-ai@2.0.0)
**Commit**: 0dd115638962ba1b8a2a297f44af7d36a746f406
**Date**: 2026-04-04
**Auditor**: PR Agent (Certifier role)
**QAL**: Mixed (QAL-4 for governance/crypto/audit/RBAC, QAL-3 for claims/WM/budget, QAL-2 for transport/API)

---

## 1. Executive Summary

**Verdict: NO-GO**

Limen has extraordinary engineering depth -- 134 invariants, 4007 tests (3890 passing), 8 verified security mechanisms, and comprehensive proof documentation. However, the audit surfaces **4 P0** and **8 P1** findings that prevent GO certification. The most critical issues are:

1. **36 failing tests** in the current test suite (P0: RC-02)
2. **1 TypeScript compilation error** (P0: RI-03)
3. **README promises `createLimen()` works with zero config** but it throws INVALID_CONFIG without LLM provider env vars (P0: VL-01/VL-03)
4. **No EAP verification artifacts** -- no checkpoints, no mutation reports, no coverage data in docs/verification/ (P0: EI-02)
5. **GDPR erasure LIKE over-broad pattern** confirmed by Breaker as CRITICAL (P1: RC-11)
6. **Bare `isNaN()` usage** in 6 locations -- cross-project warning confirmed (P1: RC-04)

The system is well-engineered but not production-ready at this commit. The failing tests and compilation error indicate work-in-progress (Phase 13 distributed sync). The GDPR erasure finding is a data integrity risk that was already identified by the Breaker (F-E2E-002b) but not remediated.

---

## 2. System Context Record

### 2.1 System Identity

| Field | Value |
|-------|-------|
| Name | Limen |
| Purpose | Cognitive infrastructure for AI agents: beliefs with confidence/decay, governance enforcement, self-healing knowledge, vector search |
| Architecture | 4-layer (API -> Orchestration -> Substrate -> Kernel), SQLite-backed, single production dependency (better-sqlite3) |
| Language | TypeScript (strict, ES2024) |
| Deployment | npm library (limen-ai), consumed by other SolisHQ products and external users |
| Traffic Profile | Embedded library, event-driven per host application |
| Data Sensitivity | Agent knowledge (potentially PII), encryption keys, audit trails |

### 2.2 QAL Classifications

| Component | QAL | Rationale |
|-----------|-----|-----------|
| Governance engine | 4 | Controls agent authority |
| Cryptographic operations | 4 | AES-256-GCM, key derivation |
| Audit trail | 4 | Hash-chain integrity |
| RBAC engine | 4 | Authorization |
| Claim assertion/retraction | 3 | Knowledge integrity |
| Working memory | 3 | Cognitive state |
| Budget governor | 3 | Resource control |
| LLM gateway/transport | 2 | Provider communication |
| API surface | 2 | Consumer interface |

### 2.3 Audit Depth

QAL-4 dominant system. Full evidence audit required (Phase 1 complete including 1f spot-check).

### 2.4 Checkpoint Inventory

| Checkpoint | Status |
|------------|--------|
| Design | EXISTS (docs/sprints/, docs/proof/) |
| Unit | MISSING (no docs/verification/checkpoints/) |
| Integration | MISSING |
| Pre-certification | MISSING |

### 2.5 AI/ML Detection

**Tier 1 Advisory**: AI is used for LLM-powered features (chat, infer, technique extraction, cognitive verify) but the governance substrate itself is deterministic. AI suggests, deterministic system decides. Governed-cognitive overlay optional.

### 2.6 Critical Flows

1. **Claim lifecycle**: remember -> recall -> forget (belief CRUD with governance)
2. **Governance enforcement**: RBAC check -> operation -> audit trail write (authorization chain)
3. **Crypto operations**: encrypt -> store -> retrieve -> decrypt (data protection)
4. **GDPR erasure**: request -> cascade find -> tombstone -> certificate (compliance)
5. **Audit trail integrity**: mutation -> hash-chain append -> immutability trigger (tamper evidence)

### 2.7 Pre-Audit Intelligence Briefing

**Cross-project warnings applied:**

| Warning | Source | Limen Status | Finding |
|---------|--------|-------------|---------|
| "NaN bypasses numeric comparisons" | L1 Universal | 6 bare `isNaN()` calls found | P1-NaN |
| "Nested try/catch creates dead fail-safe code" | L1 Universal | 3 files with nested try/catch | P2-NEST (reviewed, non-critical) |
| "File-based state has TOCTOU races" | L2 Node.js | Limen uses SQLite, not raw files; `mkdirSync`/`existsSync` in database_lifecycle.ts | P2-TOCTOU (low risk, startup-only) |

---

## 3. Evidence Audit (Phase 1)

### 3.1 Artifact Existence (1a)

No EAP-compliant verification artifacts exist in `docs/verification/`. The project has rich proof documentation (`docs/proof/invariants.md`, `docs/proof/security-model.md`, `docs/proof/failure-modes.md`, `docs/proof/system-calls.md`) and a Breaker report (`docs/e2e/E2E-BREAKER-REPORT.md`), but none follow the EAP format with `_meta` fields.

**Finding P0-EVIDENCE-001**: No formal verification checkpoint artifacts (QAL-4 requires every artifact).

### 3.2 Freshness (1b)

The proof documentation references "Limen version: 3.3.0" (internal version), dated 2026-03-24. The HEAD commit includes Phase 13 distributed sync work, significantly beyond what the proof docs cover. Evidence is stale relative to current code.

**Finding P1-FRESH-001**: Proof documentation references v3.3.0 but codebase is at v2.0.0 npm / includes Phase 13 code.

### 3.3 Authenticity (1c)

No `_meta.producer` fields. No dispatch_id. No role attribution. Cannot verify which agent produced which evidence.

**Finding P1-AUTH-001**: No producer attribution on evidence artifacts.

### 3.4 Threshold Compliance (1d)

- **Mutation score**: No mutation reports in docs/verification/mutation/. The Breaker report shows 87.5% kill rate on a single targeted test (erasure E2E), but no systematic mutation testing.
- **Coverage**: No c8 coverage data checked in. Coverage tooling exists (package.json `test:coverage`) but no results stored.
- **Property tests**: `tests/property/` directory exists with test files.

**Finding P1-THRESH-001**: No systematic mutation testing data (QAL-4 requires >= 90%).
**Finding P1-THRESH-002**: No coverage data (QAL-4 requires MC/DC).

### 3.5 Independence Verification (1e)

The Breaker report exists (`docs/e2e/E2E-BREAKER-REPORT.md`) with independent findings. However, no distinct dispatch_id records exist. Cannot formally verify Builder/Breaker/Certifier separation.

**Finding P2-IND-001**: No formal dispatch_id separation records.

### 3.6 Spot-Check (1f)

Running the test suite produces 36 failures out of 4007 tests. This is the spot-check: the test suite does not fully pass.

**Finding P0-SPOT-001**: Test suite fails -- 36 test failures at HEAD.

### 3.7 Verification Quality Score (VQS)

| Component | Weight | Score | Notes |
|-----------|--------|-------|-------|
| Completeness | 25% | 15 | Rich proof docs exist but no EAP artifacts |
| Freshness | 20% | 30 | Proof docs are v3.3.0, stale vs HEAD |
| Authenticity | 25% | 10 | No producer metadata, no dispatch IDs |
| Independence | 15% | 40 | Breaker report exists, no formal separation |
| Threshold Compliance | 15% | 10 | No mutation/coverage data checked in |
| **Weighted Total** | **100%** | **18** | **COMPROMISED** |

**VQS Gate: COMPROMISED (18 < 50)**

The verification evidence chain cannot be formally trusted. However, the codebase itself is directly auditable, and 3890 tests do pass. The audit proceeds on codebase analysis with reduced-confidence findings on evidence-dependent claims.

---

## 4. Dimension-by-Dimension Audit

### Dimension 1: Reliability

| Claim | Evaluation | Evidence |
|-------|-----------|----------|
| RC-01: Dependency failure isolation | CONDITIONAL PASS | LLM gateway has failover (llm_gateway.ts:499). SQLite is the only hard dependency. Provider failures degrade gracefully. |
| RC-02: Crash recovery without data loss | BLOCKED | 36 test failures at HEAD. Phase 13 sync foundation tests fail with SQLITE_ERROR. Cannot certify crash recovery when test suite itself fails. |
| RC-03: Startup idempotency | PASS | SQLite migration system is forward-only, idempotent. Database lifecycle creates-or-opens. |
| RC-04: Race condition absence | CONDITIONAL PASS | SQLite WAL + busy_timeout provides baseline. However, 6 bare `isNaN()` calls could allow NaN to bypass numeric guards (cross-project L1 warning). |

**P0-REL-001**: 36 test failures at HEAD commit. Includes Phase 11 vector store tests (sqlite-vec related) and Phase 13 sync foundation tests. Root cause: Phase 13 migration 037 not compatible with current schema, and vector store tests depend on sqlite-vec availability.

**P1-REL-002**: Bare `isNaN()` in 6 locations (egp_stores.ts:728-729, transport_engine.ts:130,136,153, stream_parser.ts:193). `isNaN(undefined)` returns `true`, `isNaN("string")` returns `true` -- these coerce before checking, unlike `Number.isNaN()`. A non-numeric value would bypass the `< 0` guard on the same line.

### Dimension 2: Observability

| Claim | Evaluation | Evidence |
|-------|-----------|----------|
| RC-05: Diagnostic sufficiency | INSUFFICIENT | No observability infrastructure beyond the logger callback. No structured telemetry. |
| RC-06: Log quality | CONDITIONAL PASS | Structured logger callback exists. LimenError has error codes. But PII redaction in logs not verified. |
| RC-07: RED metrics | NOT APPLICABLE | Library, not service. Consumers responsible for RED metrics. |
| RC-08: Alert coverage | NOT APPLICABLE | Library, not service. |
| RC-09: Alert noise | NOT APPLICABLE | Library, not service. |

### Dimension 3: Security

| Claim | Evaluation | Evidence |
|-------|-----------|----------|
| RC-10: Auth enforcement | PASS | RBAC engine verified (I-13). Every operation enforces when `requireRbac=true`. Tests at tests/rbac/rbac_enforcement.test.ts. |
| RC-11: Input validation | BLOCKED | **GDPR erasure LIKE over-broad pattern (F-E2E-002b CRITICAL)**: `LIKE '%user:alice%'` matches `user:aliceberg`. Confirmed by Breaker. Also: `_` wildcard not escaped (F-E2E-008b). Phone number PII not detected (F-E2E-011). |
| RC-12: No secrets in code | PASS | No hardcoded secrets found. API keys resolved from env vars. Master key auto-generated or provided. |
| RC-13: Encryption | PASS | AES-256-GCM verified (I-11). 96-bit IV, 128-bit auth tag, PBKDF2 600k iterations. |
| RC-14: Dependency vulnerability scan | BLOCKED | `npm audit` shows 4 vulnerabilities (1 high: path-to-regexp ReDoS, 3 moderate: langsmith SSRF). |

**P0-SEC-001**: GDPR erasure over-broad LIKE pattern is a data integrity violation. Erasing one data subject can delete another subject's data. This was identified by Breaker (F-E2E-002b) and marked CRITICAL but not remediated.

**P1-SEC-002**: npm audit shows 1 high vulnerability (path-to-regexp ReDoS). Must be addressed before production.

**P1-SEC-003**: Phone number PII detection gap (F-E2E-011). International format `+XXXXXXXXXX` not detected. GDPR erasure may miss claims containing only phone number PII.

### Dimension 4: Performance and Scalability

| Claim | Evaluation | Evidence |
|-------|-----------|----------|
| RC-15: SLO compliance | INSUFFICIENT | Quality gate tests fail for remember/recall/forget/connect p95 latency. Performance characterization not passing. |
| RC-16: Graceful degradation | PASS | I-16 verified. Subsystem failure = degradation. No LLM providers = engine status 'degraded'. |
| RC-17: No resource leaks | INSUFFICIENT | No sustained load test evidence. |

**P1-PERF-001**: Performance quality gate tests failing. p95 latency targets not met for core operations.

### Dimension 5: Operability

| Claim | Evaluation | Evidence |
|-------|-----------|----------|
| RC-18: Automated deployment | CONDITIONAL PASS | npm publish pipeline exists. `prepublishOnly` builds. |
| RC-19: Rollback within RTO | PASS | npm supports version pinning. Previous versions installable. |
| RC-20: Runbooks | NOT APPLICABLE | Library, not service. |
| RC-21: Operational documentation | PASS | Comprehensive README, getting-started, API docs, architecture doc, security model. |

### Dimension 6: Data Integrity and Recovery

| Claim | Evaluation | Evidence |
|-------|-----------|----------|
| RC-22: Backup integrity | PASS | SQLite single-file. `backup = cp -r dataDir`. Export/import API verified. |
| RC-23: Restore tested | CONDITIONAL PASS | Export/import exists but CSV export drops PII columns (F-E2E-006). |
| RC-24: Migration reversibility | BLOCKED | Migrations are forward-only by design (C-05). No backward migration path. |

**P2-DATA-001**: CSV export silently drops PII/classification columns (F-E2E-006). Data portability incomplete.

### Dimension 7: Dependency Management

| Claim | Evaluation | Evidence |
|-------|-----------|----------|
| RC-25: Pinned versions | CONDITIONAL PASS | Production dep `better-sqlite3` pinned to exact 11.10.0. Dev deps use `^` ranges but do not ship. Optional `sqlite-vec` uses `^`. |
| RC-26: Response plans | INSUFFICIENT | No documented response plan for better-sqlite3 EOL or compromise. |

### Dimension 8: Compliance and Governance

| Claim | Evaluation | Evidence |
|-------|-----------|----------|
| RC-27: Regulatory compliance | BLOCKED | GDPR erasure mechanism has confirmed data integrity bug (F-E2E-002b). Cannot certify GDPR compliance with over-broad deletion. |

### Dimension 9: Release Integrity

| Claim | Evaluation | Evidence |
|-------|-----------|----------|
| RI-01: Dependency integrity | CONDITIONAL PASS | Lockfile exists. npm audit shows vulnerabilities. |
| RI-02: Build reproducibility | INSUFFICIENT | No dual-build comparison. |
| RI-03: Artifact provenance | BLOCKED | TypeScript compilation error (`src/api/index.ts:949 -- 'ENGINE_SHUTDOWN' not assignable to LimenErrorCode`). The build that produced dist/ may not match current source. |
| RI-04: Environment parity | NOT APPLICABLE | Library. |
| RI-05: Version pinning across phases | INSUFFICIENT | No phase checkpoint commit records. |

**P0-RI-001**: TypeScript compilation error means current source does not compile cleanly. The published npm artifact may have been built from a different commit. Provenance chain broken.

### Dimension 10: Runtime Containment

| Claim | Evaluation | Evidence |
|-------|-----------|----------|
| RT-01: Progressive delivery | NOT APPLICABLE | Library consumed via npm. Consumers own deployment. |
| RT-02: Runtime invariant monitoring | NOT APPLICABLE | Library. Health check exists for consumers. |
| RT-03: Regression corpus growth | CONDITIONAL PASS | The Breaker report (E2E-BREAKER-REPORT.md) shows defect-to-test pipeline. |
| RT-04: Rollback thresholds | NOT APPLICABLE | Library. |

### Dimension 11: Evidence Integrity

| Claim | Evaluation | Evidence |
|-------|-----------|----------|
| EI-01: Commit-linked evidence | BLOCKED | No verification artifacts with commit hashes. |
| EI-02: Tool-generated evidence | BLOCKED | No formal evidence artifacts exist. VQS = COMPROMISED. |
| EI-03: Tool trust model | CONDITIONAL PASS | Tools documented in package.json (tsx, c8, typescript). Versions in lockfile. |

**P0-EI-001**: No tool-generated evidence artifacts. All evidence is informal (test output, proof docs). For QAL-4, this is a blocking finding.

### Dimension 12: Validation

| Claim | Evaluation | Evidence |
|-------|-----------|----------|
| VL-01: Product promise registry | BLOCKED | See Section 5 below. |
| VL-02: E2E path coverage | CONDITIONAL PASS | E2E tests exist (docs/e2e/) but 36 tests failing. |
| VL-03: Fresh-start validation | BLOCKED | See Section 5 below. |
| VL-04: Post-deployment validation | BLOCKED | Published package tested manually (this audit). Issues found. |

---

## 5. Dimension 12 Validation -- Detailed Findings

### VL-01: Product Promise Registry

**Promise enumeration from external surfaces:**

| # | Promise | Source | Works? | Finding |
|---|---------|--------|--------|---------|
| 1 | `createLimen()` zero-config | README Quick Start + description | NO | Throws INVALID_CONFIG without any LLM provider env var |
| 2 | `remember(subject, predicate, value)` | README Core API | YES | Works from fresh install |
| 3 | `recall(subject)` with decay | README Core API | YES | effectiveConfidence computed correctly |
| 4 | `search(query)` full-text | README Core API | YES | FTS5 works from fresh install |
| 5 | `forget(claimId, reason)` | README Core API | PARTIAL | Works but README uses `reason` as free text; actual requires enum: incorrect/superseded/expired/manual |
| 6 | `connect(id1, id2, type)` | README Core API | YES | Works when both claims exist |
| 7 | `reflect(entries)` | README Core API | YES | Works from fresh install |
| 8 | `cognitive.health()` | README Cognitive API | YES | Returns health report |
| 9 | `cognitive.consolidate()` | README Cognitive API | NOT VERIFIED | Requires populated DB |
| 10 | `cognitive.importance()` | README Cognitive API | NOT VERIFIED | Requires claimId |
| 11 | `cognitive.narrative()` | README Cognitive API | NOT VERIFIED | Requires populated DB |
| 12 | `cognitive.verify()` | README Cognitive API | NOT VERIFIED | Requires provider |
| 13 | `cognitive.suggestConnections()` | README Cognitive API | NOT VERIFIED | Requires vector provider |
| 14 | `governance.erasure()` | README Governance API | BROKEN | LIKE over-broad (F-E2E-002b CRITICAL) |
| 15 | `governance.exportAudit()` | README Governance API | EXISTS | Function available |
| 16 | `governance.protectPredicate()` | README Governance API | EXISTS | Function available |
| 17 | `consent.register/check/revoke` | README Security | EXISTS | Functions available |
| 18 | Semantic search | README Vector Search | CONDITIONAL | Requires optional sqlite-vec |
| 19 | `beliefs.value[0].id` | README Quick Start line 41 | BROKEN | Property is `claimId`, not `id` |
| 20 | Self-healing cascades | README Self-Healing | EXISTS | Opt-in feature |
| 21 | "5,000+ tests" | README Architecture | FALSE | 4007 tests at HEAD |

**P0-VL01-001**: README Quick Start code example is incorrect. `beliefs.value[0].id` does not exist -- the property is `claimId`. A user copying the Quick Start will get `undefined`.

**P1-VL01-002**: `createLimen()` with zero config fails. README says "auto-detects LLM providers, generates a dev encryption key, and provisions a local SQLite database. Copy, paste, run." But without any LLM env var, it throws. The promise of zero-config is broken.

**P1-VL01-003**: README claims "5,000+ tests" but actual count is 4007.

**P1-VL01-004**: `forget()` README shows free-text reason but actual API requires enum value (incorrect/superseded/expired/manual). Documentation mismatch.

### VL-02: E2E Path Coverage

Integration and E2E tests exist in `tests/integration/` and `docs/e2e/`. The Breaker report shows targeted E2E with mutation testing. However, 36 tests currently fail, reducing confidence in E2E coverage.

**P1-VL02-001**: 36 failing tests indicate E2E paths not fully covered at this commit.

### VL-03: Fresh-Start Validation

Fresh install test (this audit):

1. `npm install limen-ai` -- SUCCESS
2. `import { createLimen } from 'limen-ai'` -- SUCCESS
3. `createLimen()` -- FAILS without env var
4. `createLimen()` with OLLAMA_HOST -- SUCCESS
5. `remember()` -- SUCCESS (but `.value.id` is undefined per README example)
6. `recall()` -- SUCCESS
7. `search()` -- SUCCESS
8. `forget()` -- FAILS with README's example reason format
9. `connect()` -- SUCCESS
10. `reflect()` -- SUCCESS
11. `cognitive.health()` -- SUCCESS

**P0-VL03-001**: Fresh install following README Quick Start fails at step 1 (createLimen() throws).

### VL-04: Post-Deployment Validation

The published npm package (limen-ai@2.0.0) was downloaded and tested. The package contents are complete (927 files, 4.3MB). The import chain works when dependencies are installed. The SHA integrity matches npm registry.

**P2-VL04-001**: Published package version (2.0.0) does not match proof documentation version (3.3.0). Internal versioning inconsistency.

---

## 6. Five-Path Matrix

### Tier 1: Critical Flows

| Flow | Happy | Degraded | Dep Failure | Recovery | Rollback |
|------|-------|----------|-------------|----------|----------|
| Claim lifecycle | PASS | PASS (no LLM needed) | PASS (SQLite only dep) | PASS (export/import) | INSUFFICIENT |
| Governance/RBAC | PASS | N/A | N/A | INSUFFICIENT | INSUFFICIENT |
| Crypto operations | PASS | N/A | N/A | INSUFFICIENT | INSUFFICIENT |
| GDPR erasure | **BLOCKED** | N/A | N/A | INSUFFICIENT | INSUFFICIENT |
| Audit trail integrity | PASS | N/A | N/A | INSUFFICIENT | INSUFFICIENT |

**GDPR erasure blocked**: Over-broad LIKE pattern confirmed as data integrity violation.

### Tier 2: Advertised Features

| Feature | Happy Path | Notes |
|---------|-----------|-------|
| Zero-config createLimen() | FAIL | Requires LLM env var |
| remember/recall/search/forget | PASS | Core loop works |
| Confidence decay | PASS | FSRS computed on read |
| Conflict detection | NOT VERIFIED | |
| Cognitive health | PASS | |
| Governance erasure | FAIL | Over-broad LIKE |
| Consent tracking | EXISTS | Not deeply validated |
| Vector/semantic search | CONDITIONAL | Requires sqlite-vec |
| Self-healing | EXISTS | Opt-in, not validated |

---

## 7. Cross-Cutting Analysis (Phase 6)

### 7.1 Failure Cascades

The GDPR erasure over-broad LIKE pattern is the most dangerous cascade: erasing data subject A can delete data subject B's claims if B's identifier is a substring of A's (or vice versa). This is confirmed by the Breaker.

### 7.2 Recovery Sequencing

SQLite single-file makes recovery simple: restore the file. Forward-only migrations mean no backward recovery via schema -- only file-level restore.

### 7.3 Operational Gaps

- No key rotation mechanism (acknowledged in security-model.md)
- No process for managing master key in production
- `.bak` files in source tree (4 files) -- development artifacts not cleaned up

### 7.4 Contradiction Detection

- README says "5,000+ tests" but test suite has 4007
- README says "zero-config" but requires LLM provider env var
- Proof docs say "v3.3.0" but npm version is 2.0.0
- README example uses `.id` but actual property is `.claimId`

### 7.5 Governance Compliance

- **PG-01**: No overrides.json exists. No PA overrides recorded.
- **PG-02**: No disputes.json exists.
- **PG-03 Warning Escalation**: 4 P0 findings triggers immediate PA review.
- **PG-04 Calibration**: First audit. No prior data. Performance latency thresholds may be too aggressive for SQLite-based system.

---

## 8. Phase 9: Learning Analysis

### 8.1 Detection Matrix (Initial)

| Finding | Primary Catcher | Missed By |
|---------|----------------|-----------|
| P0-REL-001 (36 failing tests) | Spot-check (test execution) | Should have been caught by CI |
| P0-RI-001 (TS compile error) | Phase 3 codebase analysis | Should have been caught by CI |
| P0-SEC-001 (GDPR LIKE) | Breaker (E2E-BREAKER-REPORT.md) | Builder (not remediated) |
| P0-VL01-001 (README .id) | VL-03 fresh-install | VL-01 promise registry (if it existed) |
| P0-VL03-001 (zero-config fails) | VL-03 fresh-install | No prior check |
| P0-EI-001 (no evidence) | Phase 1 evidence audit | N/A (systemic gap) |
| P1-REL-002 (bare isNaN) | Cross-project intelligence | Codebase analysis |
| P1-SEC-002 (npm vuln) | Dependency audit | CI (no automated audit) |

### 8.2 Cross-Project Extraction

| Finding | Level | Warning |
|---------|-------|---------|
| Bare `isNaN()` bypasses guards | L1 Universal | **CONFIRMED in Limen**. 6 occurrences. Global: always use `Number.isNaN()`. |
| LIKE pattern injection via `%` and `_` | L1 Universal | Any `LIKE '%' + userInput + '%'` is injectable. Escape or use exact match. |
| README code examples not tested | L1 Universal | README examples should be extracted into executable smoke tests. |
| Proof doc version mismatch | L2 Domain (npm) | Internal version and npm version must be reconciled in proof docs. |
| Breaker findings not remediated | L2 Domain (EIS) | Breaker findings need tracked remediation before release. |

### 8.3 Taxonomy Check

All findings map to existing IC-03 categories:

- Data integrity (GDPR LIKE, CSV PII drop)
- Wiring defects (Category 14: README .id vs .claimId, zero-config promise)
- Evidence integrity (no EAP artifacts)
- Dependency management (npm vulnerabilities)

### 8.4 Living Proof Refresh

- Invariants.md references v3.3.0 -- needs refresh for v2.0.0 npm alignment
- Security-model.md references v3.3.0 -- same
- Failure-modes.md references v3.3.0 -- same

---

## 9. Finding Summary

| Severity | Count | Most Critical |
|----------|-------|--------------|
| P0 | 4 | 36 failing tests + TS compile error + README .id broken + no evidence artifacts |
| P1 | 8 | GDPR LIKE over-broad + bare isNaN + npm vulns + zero-config broken + perf gates |
| P2 | 4 | CSV PII drop + nested try/catch + TOCTOU + version mismatch |
| P3 | 1 | .bak files in source tree |

### Complete P0 Finding List

| ID | Finding | Dimension | Remediation |
|----|---------|-----------|-------------|
| P0-REL-001 | 36 test failures at HEAD | Reliability | Fix Phase 13 sync migrations and vector store tests. Do not release with failing tests. |
| P0-RI-001 | TypeScript compile error | Release Integrity | Fix `ENGINE_SHUTDOWN` error code in src/api/index.ts:949. Verify dist matches source. |
| P0-VL01-001 | README uses `.id` but property is `.claimId` | Validation | Fix README Quick Start example. |
| P0-EI-001 | No formal verification evidence artifacts | Evidence Integrity | Create EAP-compliant checkpoints, mutation reports, coverage data in docs/verification/. |

### Complete P1 Finding List

| ID | Finding | Dimension | Remediation |
|----|---------|-----------|-------------|
| P0-SEC-001 | GDPR erasure LIKE over-broad | Security | Replace `LIKE '%id%'` with exact match on subject URN. Escape `%`/`_`. |
| P1-REL-002 | 6 bare `isNaN()` calls | Reliability | Replace with `Number.isNaN()` in egp_stores.ts, transport_engine.ts, stream_parser.ts. |
| P1-SEC-002 | npm audit: 1 high vuln | Security | Run `npm audit fix`. |
| P1-SEC-003 | Phone PII not detected | Security | Fix PII scanner regex for international phone format. |
| P1-VL01-002 | Zero-config createLimen() fails | Validation | Either make createLimen() work without providers (degraded mode) or update README. |
| P1-VL01-003 | README claims 5000+ tests, actual 4007 | Validation | Update README to accurate count. |
| P1-VL01-004 | forget() reason is enum, not free text | Validation | Update README to show valid reason values. |
| P1-PERF-001 | Performance gate tests failing | Performance | Investigate p95 latency targets. May need calibration. |

---

## 10. Verdict

### GO Criteria Evaluation

| Criterion | Status | Notes |
|-----------|--------|-------|
| All P0 claims PASS | FAIL | 4 P0 findings |
| All P1 PASS or CONDITIONAL | FAIL | 8 P1 findings, several BLOCKED |
| VQS >= 80 (SUFFICIENT) | FAIL | VQS = 18 (COMPROMISED) |
| Five-path complete for critical flows | FAIL | GDPR erasure BLOCKED, multiple INSUFFICIENT |
| No unresolved CONTRADICTIONS on P0/P1 | FAIL | README contradictions |
| RI-03 Artifact Provenance PASS | FAIL | TS compile error breaks provenance |
| EI-02 Tool-generated Evidence PASS | FAIL | No evidence artifacts |
| Spot-check PASS (QAL-4) | FAIL | Test suite fails |

### CONDITIONAL GO Criteria

| Criterion | Status |
|-----------|--------|
| All P0 claims PASS | FAIL |

**CONDITIONAL GO not available**: P0 findings exist.

---

## VERDICT: NO-GO

**Justification**: Limen has deep engineering quality -- 134 invariants, comprehensive security model, well-structured architecture. However, the current HEAD commit has 36 failing tests, a TypeScript compilation error, confirmed GDPR data integrity bugs, README documentation that misleads users, and no formal verification evidence artifacts. The system is actively under development (Phase 13 distributed sync) and is not at a stable release point.

### Top 3 Risks (even after remediation)

1. **GDPR erasure is architecturally fragile** -- the LIKE-based approach needs redesign, not just escaping. Subject matching should use structured query, not string containment.
2. **No key rotation mechanism** -- acknowledged but un-implemented. Production deployments with long-lived keys have no recovery path if a key is compromised.
3. **Forward-only migrations with no rollback** -- any schema bug in a migration is permanent. Consumers on older versions cannot easily downgrade.

### Recommended Remediation Priority

1. Fix test suite (all 36 failures) and TS compile error
2. Fix GDPR erasure LIKE pattern (CRITICAL security)
3. Fix README (`.id` -> `.claimId`, zero-config claim, test count)
4. Replace bare `isNaN()` with `Number.isNaN()`
5. Run `npm audit fix`
6. Establish EAP verification artifacts
7. Re-audit after remediation

---

**Escalation**: All 4 P0 findings require PA (Femi) disposition before any release.
