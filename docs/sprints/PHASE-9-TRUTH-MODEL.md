# Phase 9: Security Hardening — Truth Model

**Date**: 2026-04-02
**Criticality**: Tier 1
**Design Source**: PHASE-9-DESIGN-SOURCE.md
**DC Declaration**: PHASE-9-DC-DECLARATION.md

---

## PII Detection Invariants

### I-P9-01: PII Flag Consistency
**IF** ClaimContentScanner detects PII in claim content (subject, predicate, or objectValue)
**THEN** the stored claim MUST have `pii_detected = 1` AND `pii_categories` containing the detected category set.
**Assurance**: CONSTITUTIONAL

### I-P9-02: PII Non-Leakage
**The PII match result MUST NOT store the matched text.** Only category, field name, offset, and length are stored. The actual PII text is never persisted outside the claim content itself.
**Assurance**: CONSTITUTIONAL

### I-P9-03: PII Scan Atomicity
**The PII scan and claim INSERT MUST occur in the same SQLite transaction.** There is no state where a claim exists without its scan result (when scanning is enabled).
**Assurance**: CONSTITUTIONAL

### I-P9-04: PII Reject Enforcement
**IF** `securityPolicy.pii.action === 'reject'` AND PII is detected
**THEN** `assertClaim` MUST return `PII_DETECTED_REJECT` error AND the claim MUST NOT be stored.
**Assurance**: CONSTITUTIONAL

### I-P9-05: Backward Compatibility
**Pre-Phase-9 claims MUST have `pii_detected = 0` and `content_scan_result = NULL`.** The migration MUST NOT retroactively scan existing claims. NULL means "not scanned," 0 means "scanned, no PII found."
**Assurance**: CONSTITUTIONAL

---

## Prompt Injection Invariants

### I-P9-10: Injection Detection
**IF** claim content matches known prompt injection patterns (instruction override, role hijacking, context escape)
**THEN** `ContentScanResult.injection.detected = true` with severity classification.
**Assurance**: QUALITY_GATE (pattern-based, evolving)

### I-P9-11: Injection Reject Enforcement
**IF** `securityPolicy.injection.action === 'reject'` AND injection detected
**THEN** `assertClaim` MUST return `INJECTION_DETECTED_REJECT` AND the claim MUST NOT be stored.
**Assurance**: CONSTITUTIONAL

---

## Consent Invariants

### I-P9-20: Consent Immutable Identity
**A consent record's `id`, `dataSubjectId`, `basis`, `scope`, and `grantedAt` MUST NOT change after creation.**
**Assurance**: CONSTITUTIONAL

### I-P9-21: Consent Terminal States
**A consent record in state REVOKED or EXPIRED MUST NOT transition to ACTIVE.** Reactivation requires a new consent record with a new ID.
**Assurance**: CONSTITUTIONAL

### I-P9-22: Consent Expiry Computed
**Consent expiry is computed on read, not written by a background job.** If `expiresAt < now`, status is returned as 'expired' regardless of the stored value.
**Assurance**: CONSTITUTIONAL

### I-P9-23: Consent Audit Trail
**Every consent register and consent revoke operation MUST produce an audit entry in the same transaction (I-03 compliance).**
**Assurance**: CONSTITUTIONAL

### I-P9-24: Consent Tenant Isolation
**The `security_consent` table has a tenant_id immutability trigger.** Consent records cannot be moved between tenants.
**Assurance**: CONSTITUTIONAL

---

## Poisoning Defense Invariants

### I-P9-30: Burst Limit Enforcement
**IF** an agent has asserted `>= burstLimit` claims in the current window
**THEN** the next assertClaim call MUST return `POISONING_BURST_LIMIT` AND the claim MUST NOT be stored.
**Assurance**: CONSTITUTIONAL

### I-P9-31: Diversity Check
**IF** an agent has asserted claims about `< subjectDiversityMin` unique subjects in the current window
**AND** the current claim's subject is not new
**THEN** assertClaim MUST return `POISONING_LOW_DIVERSITY`.
**Assurance**: QUALITY_GATE (threshold-based)

### I-P9-32: Poisoning Defense Composability
**Poisoning defense operates AFTER PII scan and BEFORE the claim INSERT.** It is a separate check from the existing rate limiter (which is per-API-call, not per-claim-content).
**Assurance**: DESIGN_PRINCIPLE

### I-P9-33: Disabled Policy No-Op
**IF** `securityPolicy.poisoning.enabled === false`
**THEN** no poisoning check is performed and no overhead is added.
**Assurance**: CONSTITUTIONAL

---

## Audit Coverage Invariant

### I-P9-40: System Call Audit Completeness
**Every one of the 16 frozen system calls MUST produce at least one audit entry per invocation.** This is verified by an architectural test that maps system call functions to `auditTrail.append()` calls.
**Assurance**: DESIGN_PRINCIPLE (enforced by test, not runtime)

---

## Security Policy Invariants

### I-P9-50: Default Policy Non-Breaking
**The default SecurityPolicy MUST NOT reject any claims.** Defaults: `pii.action = 'tag'`, `injection.action = 'warn'`, `poisoning.enabled = true` with generous limits. Existing applications upgrading to v1.5 experience zero behavioral change unless they explicitly configure stricter policies.
**Assurance**: CONSTITUTIONAL

### I-P9-51: Policy Immutability After Construction
**SecurityPolicy is set at `createLimen()` and MUST NOT change during the instance lifecycle.** Policy is frozen with the Limen instance.
**Assurance**: CONSTITUTIONAL

---

## Invariant Summary

| ID | Description | Assurance | DC Coverage |
|----|-------------|-----------|-------------|
| I-P9-01 | PII flag consistency | CONSTITUTIONAL | DC-P9-101 |
| I-P9-02 | PII non-leakage | CONSTITUTIONAL | DC-P9-701, DC-P9-702 |
| I-P9-03 | PII scan atomicity | CONSTITUTIONAL | DC-P9-301 |
| I-P9-04 | PII reject enforcement | CONSTITUTIONAL | DC-P9-401 |
| I-P9-05 | Backward compatibility | CONSTITUTIONAL | DC-P9-601, DC-P9-602 |
| I-P9-10 | Injection detection | QUALITY_GATE | DC-P9-805 |
| I-P9-11 | Injection reject enforcement | CONSTITUTIONAL | DC-P9-402 |
| I-P9-20 | Consent immutable identity | CONSTITUTIONAL | DC-P9-103 |
| I-P9-21 | Consent terminal states | CONSTITUTIONAL | DC-P9-203 |
| I-P9-22 | Consent expiry computed | CONSTITUTIONAL | DC-P9-202 |
| I-P9-23 | Consent audit trail | CONSTITUTIONAL | DC-P9-501, DC-P9-502 |
| I-P9-24 | Consent tenant isolation | CONSTITUTIONAL | DC-P9-601 |
| I-P9-30 | Burst limit enforcement | CONSTITUTIONAL | DC-P9-403 |
| I-P9-31 | Diversity check | QUALITY_GATE | DC-P9-404 |
| I-P9-32 | Poisoning defense composability | DESIGN_PRINCIPLE | DC-P9-302 |
| I-P9-33 | Disabled policy no-op | CONSTITUTIONAL | DC-P9-903 |
| I-P9-40 | System call audit completeness | DESIGN_PRINCIPLE | DC-P9-501 |
| I-P9-50 | Default policy non-breaking | CONSTITUTIONAL | DC-P9-601 |
| I-P9-51 | Policy immutability after construction | CONSTITUTIONAL | — |

**Total**: 19 invariants (13 CONSTITUTIONAL, 2 QUALITY_GATE, 4 DESIGN_PRINCIPLE)

---

*SolisHQ — We innovate, invent, then disrupt.*
