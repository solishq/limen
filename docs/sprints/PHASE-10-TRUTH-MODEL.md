# Phase 10: Governance Suite — Truth Model

**Date**: 2026-04-03
**Criticality**: Tier 1
**Design Source**: PHASE-10-DESIGN-SOURCE.md

---

## Classification Invariants

### I-P10-01: Classification Stored
**IF** a ClassificationRule matches the claim's predicate
**THEN** the claim's `classification` column MUST equal the rule's level AND `classification_rule_id` MUST reference the rule.
**Assurance**: CONSTITUTIONAL

### I-P10-02: Default Classification
**IF** no rule matches the claim's predicate
**THEN** `classification` MUST equal `GovernanceConfig.classification.defaultLevel` (default: 'unrestricted') AND `classification_rule_id` MUST be NULL.
**Assurance**: CONSTITUTIONAL

### I-P10-03: Classification Atomicity
**Classification assignment and claim INSERT MUST occur in the same transaction.**
**Assurance**: CONSTITUTIONAL

### I-P10-04: Rule Precedence
**IF** multiple rules match, the MOST RESTRICTIVE level wins.** Level ordering: unrestricted < internal < confidential < restricted < critical.
**Assurance**: CONSTITUTIONAL

---

## Protected Predicate Invariants

### I-P10-10: Predicate Guard Enforcement
**IF** a ProtectedPredicateRule matches the claim's predicate AND RBAC is active AND the claim operation matches the rule's action
**THEN** `assertClaim`/`retractClaim` MUST check `ctx.permissions.has(rule.requiredPermission)` and return `PROTECTED_PREDICATE_UNAUTHORIZED` if missing.
**Assurance**: CONSTITUTIONAL

### I-P10-11: Dormant RBAC Bypass
**IF** RBAC is dormant (no custom roles, no forceActive)
**THEN** protected predicate enforcement MUST be skipped — all predicates writable.
**Assurance**: CONSTITUTIONAL

### I-P10-12: Rule Application
**Protected predicate rules with `action: 'assert'` apply to assertClaim only. Rules with `action: 'retract'` apply to retractClaim only. Rules with `action: 'both'` apply to both.**
**Assurance**: CONSTITUTIONAL

---

## Erasure Invariants

### I-P10-20: Erasure Completeness
**ALL claims with `pii_detected = 1` whose subject matches the data subject pattern MUST be tombstoned.** No PII claim for the subject may remain un-tombstoned.
**Assurance**: CONSTITUTIONAL

### I-P10-21: Erasure Cascade
**IF** `includeRelated = true` AND a tombstoned claim has `derived_from` relationships
**THEN** derived claims MUST also be tombstoned (recursive).
**Assurance**: CONSTITUTIONAL

### I-P10-22: Consent Revocation on Erasure
**ALL active consent records for the data subject MUST be revoked during erasure.**
**Assurance**: CONSTITUTIONAL

### I-P10-23: Chain Integrity Post-Erasure
**After erasure, `AuditTrail.verifyChain()` MUST return `valid: true`.** The tombstone + cascade re-hash mechanism preserves chain integrity.
**Assurance**: CONSTITUTIONAL

### I-P10-24: Certificate Hash Integrity
**The `certificateHash` field MUST be a SHA-256 hash of the certificate's content fields (excluding the hash itself).** Recomputing the hash from the stored certificate MUST produce the same value.
**Assurance**: CONSTITUTIONAL

### I-P10-25: Erasure Audit
**Every erasure operation MUST produce an audit entry with operation = 'governance.erasure'.**
**Assurance**: CONSTITUTIONAL

---

## Compliance Export Invariants

### I-P10-30: SOC 2 Period Accuracy
**The export MUST include ONLY audit entries within the requested period [from, to].** No entries before `from` or after `to`.
**Assurance**: CONSTITUTIONAL

### I-P10-31: SOC 2 Chain Verification
**The export MUST include a fresh `AuditTrail.verifyChain()` result reflecting the current chain state.**
**Assurance**: CONSTITUTIONAL

### I-P10-32: SOC 2 Tombstone Safety
**Tombstoned audit entries (PII replaced with sanitized values) MUST appear in the export with sanitized content, NOT original PII.**
**Assurance**: CONSTITUTIONAL

---

## Migration Invariants

### I-P10-40: Backward Compatibility
**Pre-Phase-10 claims MUST have `classification = 'unrestricted'` and `classification_rule_id = NULL`.** The migration MUST NOT change existing claim data.
**Assurance**: CONSTITUTIONAL

### I-P10-41: Dormant RBAC Preservation
**Adding new Permission values MUST NOT activate dormant RBAC.** RBAC activates only on custom role creation or `forceActive=true`.
**Assurance**: CONSTITUTIONAL

---

## Summary: 18 invariants — 18 CONSTITUTIONAL

*SolisHQ — We innovate, invent, then disrupt.*
