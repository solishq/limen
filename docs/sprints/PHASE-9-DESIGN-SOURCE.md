# Phase 9: Security Hardening — Design Source

**Date**: 2026-04-02
**Author**: Orchestrator (Design Source derivation, Phase 0.5)
**Criticality**: Tier 1 (security, data isolation, governance-adjacent)
**Governing documents**: LIMEN_BUILD_PHASES.md (Phase 9), LIMEN_SECURITY_ENGINEERING.md (SEC-CRIT-003, LINDDUN), CLAUDE.md
**Decision weight**: Significant (new subsystem, Tier 1, >3 interfaces)

---

## THE FIVE QUESTIONS

1. **What does the spec actually say?**
   Phase 9 delivers: PII detection at ingestion (9.1), PII tagging on claims (9.2), consent tracking stub (9.3), knowledge poisoning defense (9.4), audit coverage lint rule (9.5). SEC-CRIT-003 requires indirect prompt injection defense in claim content. The 16 system calls are FROZEN — no new system calls.

2. **How can this fail?**
   - PII detection has false negatives (misses PII) → privacy breach
   - PII detection has false positives (flags non-PII) → user friction, data loss if auto-redacted
   - Poisoning defense is too aggressive → legitimate high-volume agents throttled
   - Poisoning defense is too weak → single agent corrupts institutional knowledge
   - PII tagging mutates claim schema → breaks all downstream consumers
   - Consent tracking adds overhead to every claim write → performance regression
   - Audit lint has false positives → blocks valid system calls

3. **What are the downstream consequences?**
   - PII detection enables Phase 10 GDPR erasure (per-claim PII targeting)
   - PII tagging adds a column to `claim_assertions` → migration required
   - Consent tracking adds a new table → migration required
   - Poisoning defense touches the assertClaim hot path → must be O(1)
   - These are additive — no existing behavior changes

4. **What am I assuming?**
   - PII detection is heuristic, not ML (no new dependencies constraint)
   - Regex + pattern matching is sufficient for Phase 9 (ML in future phase)
   - Consent is a framework stub, not full GDPR Article 6 implementation
   - The 0.7 confidence ceiling (Phase 4) is a poisoning defense layer that already exists
   - Rate limiting per agent already exists (token-bucket in kernel)

5. **Would a hostile reviewer find fault?**
   - "PII detection by regex misses obfuscated PII" → YES, honest limitation, documented
   - "No encryption at rest" → NOT Phase 9 scope (SQLCipher is a separate decision requiring dependency change, escalation to PA)
   - "Consent stub is too thin" → By design — framework now, flesh out in Phase 10

---

## OUTPUT 1: MODULE DECOMPOSITION

### New Modules

| Module | Location | Responsibility | Owner |
|--------|----------|----------------|-------|
| **PII Detector** | `src/security/pii_detector.ts` | Pattern-based PII detection on text content | Security subsystem |
| **PII Types** | `src/security/security_types.ts` | Shared types for all Phase 9 security modules | Security subsystem |
| **Claim Content Scanner** | `src/security/claim_scanner.ts` | Orchestrates PII detection + prompt injection defense on claim content | Security subsystem |
| **Consent Registry** | `src/security/consent_registry.ts` | Data subject consent records (CRUD) | Security subsystem |
| **Poisoning Defense** | `src/security/poisoning_defense.ts` | Per-agent anomaly detection + burst rate enforcement | Security subsystem |
| **Audit Coverage Test** | `tests/architectural/audit_coverage.test.ts` | Lint: every system call produces audit entry | Test infrastructure |

### Existing Modules Modified

| Module | Change | Justification |
|--------|--------|---------------|
| `src/claims/store/claim_stores.ts` | Hook PII detection + poisoning defense into assertClaim flow | Claim ingestion is the trust boundary |
| `src/kernel/database/migrations.ts` | Add migration 033: `pii_detected` column + consent table | Schema extension |
| `src/api/index.ts` | Wire security modules into createLimen | Dependency injection |
| `src/api/interfaces/api.ts` | Expose `consent` API on Limen interface | Consumer surface |

### Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                    Consumer API (Limen)                       │
│  remember() ─► assertClaim() ─► [ClaimContentScanner] ─►    │
│                                  ├─ PiiDetector.scan()       │
│                                  ├─ PoisoningDefense.check() │
│                                  └─ Tag claim if PII found   │
│                                                              │
│  consent.register() ─► ConsentRegistry.create()              │
│  consent.revoke()   ─► ConsentRegistry.revoke()              │
│  consent.check()    ─► ConsentRegistry.check()               │
└─────────────────────────────────────────────────────────────┘
```

The ClaimContentScanner is a **pre-store interceptor** — it runs AFTER validation (step 2 in assertClaim) but BEFORE the INSERT. It DOES NOT block claims by default — it tags them. Blocking is configurable via `securityPolicy.piiAction: 'tag' | 'warn' | 'reject'`.

---

## OUTPUT 2: TYPE ARCHITECTURE

### `src/security/security_types.ts`

```typescript
// ── PII Detection ──

/** PII categories detected by the scanner */
export type PiiCategory =
  | 'email'           // RFC 5322 pattern
  | 'phone'           // International phone patterns
  | 'ssn'             // US Social Security Number
  | 'credit_card'     // Luhn-validated card numbers
  | 'ip_address'      // IPv4 and IPv6
  | 'date_of_birth'   // Common date-of-birth patterns
  | 'name_pattern';   // Common name patterns (configurable, off by default)

/** A single PII detection result */
export interface PiiMatch {
  readonly category: PiiCategory;
  readonly field: 'subject' | 'predicate' | 'objectValue';
  readonly offset: number;         // character offset in the field
  readonly length: number;         // matched length
  readonly confidence: number;     // 0.0-1.0 detection confidence
}

/** Result of scanning claim content for PII */
export interface PiiScanResult {
  readonly hasPii: boolean;
  readonly matches: readonly PiiMatch[];
  readonly categories: readonly PiiCategory[];  // deduplicated
}

/** Action to take when PII is detected */
export type PiiAction = 'tag' | 'warn' | 'reject';

// ── Prompt Injection Defense ──

/** Prompt injection detection result */
export interface InjectionScanResult {
  readonly detected: boolean;
  readonly patterns: readonly string[];    // which patterns matched
  readonly severity: 'none' | 'low' | 'medium' | 'high';
}

// ── Content Scan ──

/** Combined content scan result */
export interface ContentScanResult {
  readonly pii: PiiScanResult;
  readonly injection: InjectionScanResult;
  readonly scannedAt: string;              // ISO 8601
}

// ── Consent ──

/** Consent basis (GDPR Article 6) */
export type ConsentBasis =
  | 'explicit_consent'     // Article 6(1)(a)
  | 'contract_performance' // Article 6(1)(b)
  | 'legal_obligation'     // Article 6(1)(c)
  | 'legitimate_interest'; // Article 6(1)(f)

/** Consent record for a data subject */
export interface ConsentRecord {
  readonly id: string;                     // UUID
  readonly dataSubjectId: string;          // Who gave consent
  readonly basis: ConsentBasis;
  readonly scope: string;                  // What was consented to
  readonly grantedAt: string;              // ISO 8601
  readonly expiresAt: string | null;       // ISO 8601 or null (indefinite)
  readonly revokedAt: string | null;       // ISO 8601 or null (active)
  readonly status: 'active' | 'revoked' | 'expired';
}

export interface ConsentCreateInput {
  readonly dataSubjectId: string;
  readonly basis: ConsentBasis;
  readonly scope: string;
  readonly expiresAt?: string;             // ISO 8601
}

// ── Poisoning Defense ──

/** Per-agent claim assertion statistics */
export interface AgentClaimStats {
  readonly agentId: string;
  readonly windowStart: string;            // ISO 8601
  readonly claimsInWindow: number;
  readonly uniqueSubjects: number;
  readonly avgConfidence: number;
  readonly maxConfidenceSpike: number;      // largest single-claim confidence
}

/** Poisoning defense verdict */
export interface PoisoningVerdict {
  readonly allowed: boolean;
  readonly reason?: string;                // Why blocked
  readonly stats: AgentClaimStats;
}

// ── Security Policy Configuration ──

export interface SecurityPolicy {
  readonly pii: {
    readonly enabled: boolean;
    readonly action: PiiAction;              // default: 'tag'
    readonly categories: readonly PiiCategory[];  // which to detect
    readonly customPatterns?: readonly { name: string; pattern: string }[];
  };
  readonly injection: {
    readonly enabled: boolean;
    readonly action: 'tag' | 'warn' | 'reject';  // default: 'warn'
  };
  readonly poisoning: {
    readonly enabled: boolean;
    readonly burstLimit: number;              // max claims per window
    readonly windowSeconds: number;           // sliding window duration
    readonly subjectDiversityMin: number;     // min unique subjects in window
  };
}

/** Default security policy */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  pii: {
    enabled: true,
    action: 'tag',
    categories: ['email', 'phone', 'ssn', 'credit_card', 'ip_address'],
  },
  injection: {
    enabled: true,
    action: 'warn',
  },
  poisoning: {
    enabled: true,
    burstLimit: 100,          // 100 claims per window
    windowSeconds: 60,        // 60-second sliding window
    subjectDiversityMin: 3,   // must assert about >= 3 different subjects
  },
};

// ── Error Codes ──

export type SecurityErrorCode =
  | 'PII_DETECTED_REJECT'       // PII found, policy = reject
  | 'INJECTION_DETECTED_REJECT' // Prompt injection found, policy = reject
  | 'POISONING_BURST_LIMIT'     // Agent exceeded burst claim rate
  | 'POISONING_LOW_DIVERSITY'   // Agent asserting about too few subjects
  | 'CONSENT_NOT_FOUND'         // Consent record not found
  | 'CONSENT_EXPIRED'           // Consent has expired
  | 'CONSENT_ALREADY_REVOKED';  // Consent already revoked
```

---

## OUTPUT 3: STATE MACHINES

### 3.1 Consent Lifecycle

```
                  register()
                     │
                     ▼
  ┌─────────────────────────────────┐
  │            ACTIVE               │
  │  (grantedAt set, revokedAt null)│
  └─────────┬──────────┬────────────┘
            │          │
    revoke()│          │ time passes (expiresAt reached)
            │          │
            ▼          ▼
  ┌──────────┐  ┌──────────┐
  │ REVOKED  │  │ EXPIRED  │
  │ terminal │  │ terminal │
  └──────────┘  └──────────┘
```

**Transitions:**
- ACTIVE → REVOKED: `consent.revoke(id)` sets revokedAt, status = 'revoked'
- ACTIVE → EXPIRED: Checked on read — if `now > expiresAt`, status = 'expired'
- REVOKED, EXPIRED: Terminal. No transitions out. Re-consent requires new record.

**Invariants:**
- I-P9-C01: A revoked consent MUST NOT be reactivated. New consent requires new record.
- I-P9-C02: Expired consent is computed on read, never written — avoids background jobs.

### 3.2 PII Tag Lifecycle

PII tagging is a **property on claims**, not a stateful entity:
- `pii_detected: boolean` column on `claim_assertions`
- Set at assertion time by ClaimContentScanner
- Immutable after assertion (claims are write-once per CCP-I1)
- Retraction does not change PII tag — retracted PII claims are still PII

No state machine — binary flag, set once, never mutated.

### 3.3 Poisoning Defense Window

```
  Agent A asserts claim
         │
         ▼
  ┌──────────────────────────────────┐
  │  Sliding Window (60s default)     │
  │  Track: count, unique subjects    │
  │                                    │
  │  count < burstLimit AND            │
  │  uniqueSubjects >= diversityMin?   │
  │      YES → ALLOW                   │
  │      NO  → BLOCK (POISONING_*)     │
  └──────────────────────────────────┘
```

Not a state machine — a stateless computation over the time window. Query `claim_assertions` for claims by this agent in the last N seconds.

---

## OUTPUT 4: SYSTEM-CALL MAPPING

**CRITICAL: 16 system calls are FROZEN. Phase 9 adds ZERO new system calls.**

Phase 9 security modules are **interceptors** wired into existing system calls, not new calls.

| Spec Item | System Call | How Phase 9 Hooks In |
|-----------|------------|----------------------|
| 9.1 PII detection | SC-11 (assertClaim) | ClaimContentScanner runs before INSERT |
| 9.2 PII tagging | SC-11 (assertClaim) | `pii_detected` column set in same INSERT |
| 9.3 Consent tracking | None (new API surface) | Exposed via `limen.consent.*` convenience methods |
| 9.4 Poisoning defense | SC-11 (assertClaim) | PoisoningDefense.check() before INSERT |
| 9.5 Audit lint | None (test infrastructure) | Architectural test, no runtime code |

### Consent API Methods (NOT system calls — convenience surface only)

| Method | Description | Maps To |
|--------|-------------|---------|
| `limen.consent.register(input)` | Create consent record | Direct SQL INSERT |
| `limen.consent.revoke(id)` | Revoke consent | Direct SQL UPDATE (status) |
| `limen.consent.check(dataSubjectId, scope)` | Check active consent | Direct SQL SELECT |
| `limen.consent.list(dataSubjectId)` | List all consent records | Direct SQL SELECT |

These are **data management methods**, not system calls. They operate on the consent table directly, similar to how the vault operates on the vault table. They produce audit entries per I-03.

---

## OUTPUT 5: ERROR TAXONOMY

| Code | When | Spec | Severity |
|------|------|------|----------|
| `PII_DETECTED_REJECT` | PII found in claim content AND policy.pii.action = 'reject' | 9.1 | Blocking |
| `INJECTION_DETECTED_REJECT` | Prompt injection patterns found AND policy.injection.action = 'reject' | SEC-CRIT-003 | Blocking |
| `POISONING_BURST_LIMIT` | Agent exceeded burstLimit claims in window | 9.4 | Blocking |
| `POISONING_LOW_DIVERSITY` | Agent asserting about fewer than diversityMin subjects | 9.4 | Blocking |
| `CONSENT_NOT_FOUND` | Consent record lookup returns no result | 9.3 | Informational |
| `CONSENT_EXPIRED` | Consent record exists but expiresAt < now | 9.3 | Informational |
| `CONSENT_ALREADY_REVOKED` | Attempt to revoke already-revoked consent | 9.3 | Validation |

**Non-blocking by default**: PII detection and injection detection default to 'tag'/'warn' — they annotate, they don't reject. Only when policy escalates to 'reject' do they produce blocking errors. This is a deliberate design choice: security should not break existing workflows unless explicitly configured to do so.

---

## OUTPUT 6: SCHEMA DESIGN

### Migration 033: Security Hardening

```sql
-- 033_security_hardening.sql

-- 6.1: PII detection flag on claims
ALTER TABLE claim_assertions ADD COLUMN pii_detected INTEGER NOT NULL DEFAULT 0;
-- 0 = not detected (or not scanned), 1 = PII detected
-- CHECK constraint: pii_detected IN (0, 1)

-- 6.2: PII detection categories (which types found)
ALTER TABLE claim_assertions ADD COLUMN pii_categories TEXT DEFAULT NULL;
-- JSON array of PiiCategory strings, e.g. '["email","phone"]'
-- NULL = not scanned or no PII found

-- 6.3: Content scan metadata
ALTER TABLE claim_assertions ADD COLUMN content_scan_result TEXT DEFAULT NULL;
-- JSON blob: ContentScanResult (PII + injection scan)
-- NULL = scan not performed (backward compat for pre-Phase-9 claims)

-- 6.4: Consent tracking table
CREATE TABLE IF NOT EXISTS security_consent (
  id            TEXT PRIMARY KEY NOT NULL,
  tenant_id     TEXT,
  data_subject_id TEXT NOT NULL,
  basis         TEXT NOT NULL CHECK (basis IN ('explicit_consent', 'contract_performance', 'legal_obligation', 'legitimate_interest')),
  scope         TEXT NOT NULL,
  granted_at    TEXT NOT NULL,
  expires_at    TEXT,
  revoked_at    TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  FOREIGN KEY (tenant_id) REFERENCES core_tenants(id)
);

-- 6.5: Index for consent lookups
CREATE INDEX IF NOT EXISTS idx_security_consent_subject
  ON security_consent(data_subject_id, scope, status);

-- 6.6: Tenant isolation trigger for consent table
CREATE TRIGGER IF NOT EXISTS security_consent_tenant_immutable
  BEFORE UPDATE OF tenant_id ON security_consent
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'tenant_id is immutable on security_consent');
  END;
```

### Migration Notes

- **Additive only** — no existing columns changed, no data modified
- `pii_detected` defaults to 0 — all existing claims unaffected
- `content_scan_result` defaults to NULL — existing claims show as "not scanned"
- Consent table is new — no migration of existing data
- Tenant isolation trigger follows the pattern in `004_tenant_isolation.ts`

---

## OUTPUT 7: CROSS-PHASE INTEGRATION

### Dependencies (what Phase 9 uses from prior phases)

| Phase | What | How |
|-------|------|-----|
| Phase 0 (Kernel) | `DatabaseConnection`, `AuditTrail`, `RateLimiter` | Schema extension, audit on consent ops |
| Phase 1 (Convenience) | `assertClaim` handler chain | PII scanner + poisoning defense hook into the chain |
| Phase 4 (Quality) | 0.7 confidence ceiling | Poisoning defense ADDS to this — does not replace it |
| Phase 8 (Integrations) | Plugin system, import pipeline | Import pipeline should also run PII scanner (future — not Phase 9 scope) |

### Dependents (what future phases use from Phase 9)

| Phase | What | How |
|-------|------|-----|
| Phase 10 (Governance) | PII detection exists | GDPR erasure targets PII-tagged claims |
| Phase 10 (Governance) | Consent registry exists | Protected predicates + compliance reports build on consent |
| Phase 11 (Vector) | Injection defense patterns | Embedding content sanitized before vectorization |

### Integration Points

1. **assertClaim hook**: ClaimContentScanner is called inside `createAssertClaimHandlerImpl`. It receives the `ClaimCreateInput` and returns a `ContentScanResult`. The result is stored in `content_scan_result` column and `pii_detected` flag is set.

2. **Convenience API**: `limen.consent.*` methods are wired in `createLimen()`, similar to how `limen.exportData()` was wired in Phase 8.

3. **Audit trail**: All consent operations (register, revoke) produce audit entries via `auditTrail.append()` within the same transaction.

4. **Configuration**: `SecurityPolicy` is part of `LimenConfig`, passed to `createLimen()`. Defaults are non-breaking (`pii.action: 'tag'`, not 'reject').

---

## OUTPUT 8: ASSURANCE MAPPING

| Element | Assurance Class | Justification |
|---------|----------------|---------------|
| PII detection accuracy | QUALITY_GATE | Statistical — regex has false positive/negative rates |
| PII tagging on claims | CONSTITUTIONAL | Binary law — if PII detected, flag MUST be set |
| Consent lifecycle transitions | CONSTITUTIONAL | Active→Revoked/Expired only. No reactivation. |
| Consent audit trail | CONSTITUTIONAL | I-03 — every mutation audited |
| Poisoning burst limit | CONSTITUTIONAL | If count > limit, MUST reject |
| Poisoning diversity check | QUALITY_GATE | Threshold-based, configurable |
| Prompt injection patterns | QUALITY_GATE | Heuristic — patterns evolve |
| Audit coverage lint | DESIGN_PRINCIPLE | Architectural test, not runtime enforcement |
| Consent tenant isolation | CONSTITUTIONAL | Tenant trigger, same pattern as all tables |
| SecurityPolicy defaults | DESIGN_PRINCIPLE | Defaults are non-breaking by design |

---

## IMPLEMENTATION SEQUENCE

Given the module boundaries, the Builder should implement in this order:

1. **Security types** (`security_types.ts`) — all types, no dependencies
2. **Migration 033** — schema extension
3. **PII Detector** (`pii_detector.ts`) — pure function, regex patterns
4. **Claim Content Scanner** (`claim_scanner.ts`) — orchestrates PII + injection detection
5. **Poisoning Defense** (`poisoning_defense.ts`) — query-based, uses DatabaseConnection
6. **Consent Registry** (`consent_registry.ts`) — CRUD on consent table
7. **Wire into assertClaim** — hook scanner + poisoning into claim creation
8. **Wire consent into API** — expose `limen.consent.*`
9. **Audit coverage test** — architectural lint
10. **Tests** — unit tests for each module, integration tests for the full flow

---

## HONEST LIMITATIONS

1. **PII detection is regex-based** — it will miss obfuscated PII (e.g., "my email is john at gmail dot com"). ML-based detection is a future enhancement.
2. **Prompt injection detection is pattern-based** — adversarial prompt engineering will evolve faster than static patterns. This is a first defense layer, not a complete solution.
3. **Consent is a framework stub** — it provides the data model for consent records but does not enforce consent-gated access to claims. Enforcement is Phase 10.
4. **No encryption at rest** — SQLCipher integration requires changing the production dependency (better-sqlite3 → @journeyapps/sqlcipher). This is an escalation to PA, not a Phase 9 deliverable.
5. **Import pipeline not scanned** — Phase 8 import should run PII detection too, but that's a cross-phase integration that can be added as a patch after Phase 9.

---

*SolisHQ — We innovate, invent, then disrupt.*
