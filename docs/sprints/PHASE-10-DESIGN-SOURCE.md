# Phase 10: Governance Suite — Design Source

**Date**: 2026-04-03
**Author**: Orchestrator
**Criticality**: Tier 1 (governance, authorization, compliance)
**Governing documents**: LIMEN_BUILD_PHASES.md (Phase 10), LIMEN_GOVERNANCE_PERFECTION.md, CLAUDE.md
**Decision weight**: Significant (new subsystem, Tier 1, >3 interfaces)

---

## THE FIVE QUESTIONS

1. **What does the spec actually say?**
   Phase 10 delivers: auto-classification by predicate pattern (10.1), configurable classification taxonomy (10.2), protected predicates requiring elevated permissions (10.3), GDPR erasure report with certificate (10.4), SOC 2 audit export (10.5). 16 system calls FROZEN — zero new.

2. **How can this fail?**
   - Classification rules miss predicates → claims unclassified, governance gaps
   - Protected predicate enforcement has bypass → unauthorized claim mutation
   - GDPR erasure misses derived claims → incomplete erasure, regulatory violation
   - SOC 2 export format incorrect → compliance audit failure
   - New Permission values break dormant RBAC → existing apps crash on upgrade
   - Erasure certificate forgeable → non-repudiation failure

3. **What are the downstream consequences?**
   - Classification engine enables Phase 11+ risk-based query filtering
   - Protected predicates extend RBAC to claim-level granularity
   - GDPR erasure API is the external compliance surface — must be production-grade
   - SOC 2 export is the first regulatory artifact — establishes format precedent

4. **What am I assuming?**
   - Auto-classification is rule-based (predicate prefix matching), not ML
   - Protected predicates use existing RBAC Permission system — no new auth framework
   - GDPR erasure builds on existing `ClaimStore.tombstone()` + `AuditTrail.tombstone()`
   - SOC 2 export is JSON format (machine-readable), not PDF
   - Dormant RBAC mode must still work — new permissions only enforced when RBAC active

5. **Would a hostile reviewer find fault?**
   - "Classification is just string matching" → YES, by design — QUALITY_GATE not CONSTITUTIONAL
   - "SOC 2 export lacks certification body signature" → Out of scope — Limen produces the evidence package, certification is external
   - "No EU AI Act risk classification" → Deferred to v2.0 — Phase 10 builds the classification engine, EU AI Act categories can be added later

---

## OUTPUT 1: MODULE DECOMPOSITION

### New Modules

| Module | Location | Responsibility |
|--------|----------|----------------|
| **Governance Types** | `src/governance/classification/governance_types.ts` | Types for classification, protected predicates, compliance |
| **Classification Engine** | `src/governance/classification/classification_engine.ts` | Predicate-based auto-classification with configurable rules |
| **Protected Predicate Guard** | `src/governance/classification/predicate_guard.ts` | RBAC enforcement for protected predicates on assertClaim/retract |
| **Erasure Engine** | `src/governance/compliance/erasure_engine.ts` | GDPR erasure orchestration: find PII claims, cascade tombstone, generate certificate |
| **Compliance Export** | `src/governance/compliance/compliance_export.ts` | SOC 2 audit export in structured JSON format |

### Existing Modules Modified

| Module | Change |
|--------|--------|
| `src/kernel/interfaces/common.ts` | Add governance permissions to `Permission` type |
| `src/claims/store/claim_stores.ts` | Hook classification + predicate guard into assertClaim |
| `src/api/index.ts` | Wire governance modules, expose `limen.governance.*` API |
| `src/api/interfaces/api.ts` | Add `GovernanceApi` on Limen interface |

### Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                     Consumer API (Limen)                         │
│                                                                  │
│  remember() ─► assertClaim() ─► [ClassificationEngine.classify]  │
│                                  ─► [PredicateGuard.check]       │
│                                  ─► store with classification    │
│                                                                  │
│  governance.classify(claimId)     ─► reclassify existing claim   │
│  governance.protect(predicate, permission)  ─► register rule     │
│  governance.erasure(dataSubjectId) ─► ErasureEngine.execute()    │
│  governance.exportAudit(format)    ─► ComplianceExport.generate  │
│  governance.listRules()           ─► list classification rules   │
└─────────────────────────────────────────────────────────────────┘
```

---

## OUTPUT 2: TYPE ARCHITECTURE

```typescript
// ── Classification ──

/** Information classification levels — ordered by sensitivity */
export type ClassificationLevel =
  | 'unrestricted'          // Public information
  | 'internal'              // Internal use only
  | 'confidential'          // Business confidential
  | 'restricted'            // Legally restricted / PII / PHI
  | 'critical';             // Highest sensitivity — crypto keys, auth tokens

/** A classification rule — maps predicate patterns to levels */
export interface ClassificationRule {
  readonly id: string;           // UUID
  readonly predicatePattern: string;  // Glob pattern: "preference.*", "medical.*"
  readonly level: ClassificationLevel;
  readonly reason: string;       // Why this classification
  readonly createdAt: string;    // ISO 8601
}

/** Default rules — built into the engine */
export const DEFAULT_CLASSIFICATION_RULES: readonly ClassificationRule[];

/** Result of classifying a claim */
export interface ClassificationResult {
  readonly level: ClassificationLevel;
  readonly matchedRule: string | null;  // Rule ID that matched, null = default
  readonly autoClassified: boolean;     // true = matched a rule, false = default
}

// ── Protected Predicates ──

/** A protected predicate rule — requires specific permission to assert/retract */
export interface ProtectedPredicateRule {
  readonly id: string;
  readonly predicatePattern: string;   // Glob: "system.*", "governance.*"
  readonly requiredPermission: Permission;
  readonly action: 'assert' | 'retract' | 'both';
  readonly createdAt: string;
}

// ── GDPR Erasure ──

/** Input for erasure request */
export interface ErasureRequest {
  readonly dataSubjectId: string;  // Who requested erasure
  readonly reason: string;         // GDPR Article 17 basis
  readonly includeRelated: boolean; // Cascade through derived_from chains
}

/** Erasure certificate — proof of erasure */
export interface ErasureCertificate {
  readonly id: string;                   // UUID
  readonly dataSubjectId: string;
  readonly requestedAt: string;          // ISO 8601
  readonly completedAt: string;          // ISO 8601
  readonly claimsTombstoned: number;
  readonly auditEntriesTombstoned: number;
  readonly relationshipsCascaded: number;
  readonly consentRecordsRevoked: number;
  readonly chainVerification: {
    readonly valid: boolean;
    readonly headHash: string;
  };
  readonly certificateHash: string;      // SHA-256 of certificate content
}

// ── SOC 2 Export ──

/** SOC 2 audit export format */
export interface Soc2AuditPackage {
  readonly version: '1.0.0';
  readonly generatedAt: string;
  readonly period: { from: string; to: string };
  readonly controls: {
    readonly accessControl: Soc2ControlEvidence;
    readonly changeManagement: Soc2ControlEvidence;
    readonly dataIntegrity: Soc2ControlEvidence;
    readonly auditLogging: Soc2ControlEvidence;
  };
  readonly chainVerification: ChainVerification;
  readonly statistics: Soc2Statistics;
}

export interface Soc2ControlEvidence {
  readonly controlId: string;
  readonly description: string;
  readonly evidenceEntries: readonly AuditEntry[];
  readonly compliant: boolean;
  readonly notes: string;
}

export interface Soc2Statistics {
  readonly totalAuditEntries: number;
  readonly uniqueActors: number;
  readonly operationBreakdown: Record<string, number>;
  readonly chainIntegrity: boolean;
}

// ── Governance Configuration ──

export interface GovernanceConfig {
  readonly classification: {
    readonly enabled: boolean;
    readonly defaultLevel: ClassificationLevel;
    readonly rules: readonly ClassificationRule[];
  };
  readonly protectedPredicates: {
    readonly enabled: boolean;
    readonly rules: readonly ProtectedPredicateRule[];
  };
}

// ── Error Codes ──

export type GovernanceErrorCode =
  | 'CLASSIFICATION_RULE_CONFLICT'     // Overlapping rules
  | 'PROTECTED_PREDICATE_UNAUTHORIZED' // Missing required permission
  | 'ERASURE_NO_CLAIMS_FOUND'         // No PII claims for data subject
  | 'ERASURE_CHAIN_INTEGRITY_FAILED'  // Hash chain broke during erasure
  | 'EXPORT_PERIOD_INVALID'           // Invalid time range
  | 'EXPORT_NO_ENTRIES';              // No audit entries in period
```

---

## OUTPUT 3: STATE MACHINES

### 3.1 Classification — Stateless
Classification is a pure function: predicate → ClassificationLevel. No state transitions. Computed at claim assertion time and stored as a column.

### 3.2 Erasure Request Lifecycle
```
  erasure(request) called
         │
         ▼
  ┌──────────────────────┐
  │  FIND PII CLAIMS     │ query: pii_detected=1 AND subject LIKE dataSubjectId%
  │  (+ consent records) │
  └──────┬───────────────┘
         │
         ▼
  ┌──────────────────────┐
  │  TOMBSTONE CLAIMS    │ ClaimStore.tombstone() for each
  │  + CASCADE RELATIONS │ Follow derived_from if includeRelated
  └──────┬───────────────┘
         │
         ▼
  ┌──────────────────────┐
  │  TOMBSTONE AUDIT     │ AuditTrail.tombstone(tenantId)
  └──────┬───────────────┘
         │
         ▼
  ┌──────────────────────┐
  │  REVOKE CONSENT      │ ConsentRegistry.revoke() for all active
  └──────┬───────────────┘
         │
         ▼
  ┌──────────────────────┐
  │  VERIFY CHAIN        │ AuditTrail.verifyChain()
  └──────┬───────────────┘
         │
         ▼
  ┌──────────────────────┐
  │  GENERATE CERTIFICATE│ Hash all fields, return ErasureCertificate
  └──────────────────────┘
```
Single-pass, synchronous. No intermediate persistence — either completes fully or fails.

---

## OUTPUT 4: SYSTEM-CALL MAPPING

**ZERO new system calls. Phase 10 hooks into existing calls.**

| Spec Item | Existing System Call / Infrastructure | How Phase 10 Hooks In |
|-----------|--------------------------------------|----------------------|
| 10.1 Auto-classification | SC-11 (assertClaim) | ClassificationEngine.classify() before INSERT |
| 10.2 Taxonomy | None (configuration) | GovernanceConfig at createLimen() |
| 10.3 Protected predicates | SC-11 (assertClaim), SC-12 (retractClaim) | PredicateGuard.check() after validation |
| 10.4 GDPR erasure | ClaimStore.tombstone + AuditTrail.tombstone | ErasureEngine orchestrates existing methods |
| 10.5 SOC 2 export | AuditTrail.query + verifyChain | ComplianceExport.generate() reads existing data |

### Governance API Methods (convenience surface, NOT system calls)

| Method | Description |
|--------|-------------|
| `limen.governance.erasure(request)` | Full GDPR erasure with certificate |
| `limen.governance.exportAudit(options)` | SOC 2 audit package generation |
| `limen.governance.addRule(rule)` | Add classification rule |
| `limen.governance.removeRule(ruleId)` | Remove classification rule |
| `limen.governance.listRules()` | List all classification rules |
| `limen.governance.protectPredicate(rule)` | Add protected predicate rule |
| `limen.governance.listProtectedPredicates()` | List protected predicate rules |

---

## OUTPUT 5: ERROR TAXONOMY

| Code | When | Severity |
|------|------|----------|
| `PROTECTED_PREDICATE_UNAUTHORIZED` | Agent lacks required permission for protected predicate | Blocking |
| `CLASSIFICATION_RULE_CONFLICT` | New rule overlaps existing with different level | Validation |
| `ERASURE_NO_CLAIMS_FOUND` | No PII claims found for data subject | Informational |
| `ERASURE_CHAIN_INTEGRITY_FAILED` | Hash chain failed verification after tombstoning | Critical |
| `EXPORT_PERIOD_INVALID` | Export from > to, or dates malformed | Validation |
| `EXPORT_NO_ENTRIES` | No audit entries in the requested period | Informational |

---

## OUTPUT 6: SCHEMA DESIGN

### Migration 034: Governance Suite

```sql
-- 6.1: Classification level on claims
ALTER TABLE claim_assertions ADD COLUMN classification TEXT NOT NULL DEFAULT 'unrestricted';
-- CHECK: classification IN ('unrestricted','internal','confidential','restricted','critical')

-- 6.2: Classification metadata
ALTER TABLE claim_assertions ADD COLUMN classification_rule_id TEXT DEFAULT NULL;
-- Which rule triggered the classification (NULL = default level)

-- 6.3: Classification rules table
CREATE TABLE IF NOT EXISTS governance_classification_rules (
  id                TEXT PRIMARY KEY NOT NULL,
  tenant_id         TEXT,
  predicate_pattern TEXT NOT NULL,
  level             TEXT NOT NULL CHECK (level IN ('unrestricted','internal','confidential','restricted','critical')),
  reason            TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
);

-- 6.4: Protected predicate rules table
CREATE TABLE IF NOT EXISTS governance_protected_predicates (
  id                    TEXT PRIMARY KEY NOT NULL,
  tenant_id             TEXT,
  predicate_pattern     TEXT NOT NULL,
  required_permission   TEXT NOT NULL,
  action                TEXT NOT NULL DEFAULT 'both' CHECK (action IN ('assert','retract','both')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
);

-- 6.5: Erasure certificates table (permanent record of compliance actions)
CREATE TABLE IF NOT EXISTS governance_erasure_certificates (
  id                        TEXT PRIMARY KEY NOT NULL,
  tenant_id                 TEXT,
  data_subject_id           TEXT NOT NULL,
  requested_at              TEXT NOT NULL,
  completed_at              TEXT NOT NULL,
  claims_tombstoned         INTEGER NOT NULL,
  audit_entries_tombstoned  INTEGER NOT NULL,
  relationships_cascaded    INTEGER NOT NULL,
  consent_records_revoked   INTEGER NOT NULL,
  chain_valid               INTEGER NOT NULL,
  chain_head_hash           TEXT NOT NULL,
  certificate_hash          TEXT NOT NULL,
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
);

-- 6.6: Indexes
CREATE INDEX IF NOT EXISTS idx_gov_class_rules_pattern ON governance_classification_rules(predicate_pattern);
CREATE INDEX IF NOT EXISTS idx_gov_protected_pattern ON governance_protected_predicates(predicate_pattern);
CREATE INDEX IF NOT EXISTS idx_gov_erasure_subject ON governance_erasure_certificates(data_subject_id);

-- 6.7: Tenant isolation triggers
-- (same pattern as all other tenant-scoped tables)
```

---

## OUTPUT 7: CROSS-PHASE INTEGRATION

### Dependencies (what Phase 10 uses)

| Phase | What | How |
|-------|------|-----|
| Phase 0 (Kernel) | AuditTrail, RBAC, Permission type | Erasure, export, predicate guard |
| Phase 4 (Quality) | ClaimStore.tombstone() | GDPR erasure tombstones claims |
| Phase 9 (Security) | PII detection (pii_detected column), ConsentRegistry | Erasure targets PII claims, revokes consent |

### Dependents (future phases)

| Phase | What | How |
|-------|------|-----|
| Phase 11 (Vector) | Classification level | Risk-based embedding decisions |
| Phase 12 (Cognitive) | Protected predicates | System predicates protected from agent mutation |

---

## OUTPUT 8: ASSURANCE MAPPING

| Element | Class | Justification |
|---------|-------|---------------|
| Classification rule matching | QUALITY_GATE | Heuristic — pattern matching |
| Classification column stored | CONSTITUTIONAL | If rule matches, level MUST be stored |
| Protected predicate enforcement | CONSTITUTIONAL | If rule exists and RBAC active, MUST reject |
| Erasure completeness | CONSTITUTIONAL | All PII claims for subject MUST be tombstoned |
| Erasure certificate hash integrity | CONSTITUTIONAL | Certificate hash must be verifiable |
| Chain verification post-erasure | CONSTITUTIONAL | Hash chain must remain valid after tombstone |
| SOC 2 export accuracy | QUALITY_GATE | Export reflects actual audit entries |
| Dormant RBAC compatibility | CONSTITUTIONAL | New permissions MUST NOT break dormant mode |

---

## IMPLEMENTATION SEQUENCE

1. Governance types
2. Migration 034
3. Classification engine (pure function)
4. Protected predicate guard
5. Erasure engine (orchestrates existing tombstone infra)
6. Compliance export (reads audit trail)
7. Wire classification + predicate guard into assertClaim
8. Wire governance API into createLimen
9. Tests

---

## HONEST LIMITATIONS

1. **Classification is prefix-matching** — `preference.*` catches `preference.color` but not `user.preference.color`. More sophisticated patterns need future work.
2. **GDPR erasure is single-tenant** — cross-tenant erasure requires separate calls per tenant.
3. **SOC 2 export is evidence only** — does not include auditor sign-off or gap analysis.
4. **No EU AI Act risk categories** — deferred to v2.0.
5. **Protected predicates dormant when RBAC dormant** — by design, consistent with existing RBAC behavior.

---

*SolisHQ — We innovate, invent, then disrupt.*
