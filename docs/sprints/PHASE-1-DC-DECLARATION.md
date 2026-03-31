# PHASE 1 DEFECT-CLASS DECLARATION: Convenience API

**Date**: 2026-03-30
**Author**: Builder (SolisHQ Engineering)
**Design Source**: `docs/sprints/PHASE-1-DESIGN-SOURCE.md` (APPROVED with 3 amendments)
**Constitution Version**: CLAUDE.md v2.3+A24

---

## 9 Mandatory Categories

| ID | Description | Category | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|
| DC-P1-101 | `maxAutoConfidence` ceiling bypass: remember() stores confidence > maxAutoConfidence without evidence_path grounding with non-empty evidenceRefs | 1: Data integrity | CONSTITUTIONAL | CBM | A.2 Rule 1 | **[A21]** Success: remember() with confidence=0.9, groundingMode='evidence_path', non-empty evidenceRefs stores 0.9. Rejection: remember() with confidence=0.9, groundingMode='runtime_witness' stores capped value (0.7 default). |
| DC-P1-102 | Superseded claims returned by recall() when includeSuperseded=false (default) | 1: Data integrity | QUALITY_GATE | CBM | DS Decision 3 | **[A21]** Success: recall() after supersedes relationship excludes superseded claim. Rejection: recall() with includeSuperseded=true includes superseded claim. |
| DC-P1-103 | BeliefView.value corrupts object.value during String() coercion | 1: Data integrity | QUALITY_GATE | CBM | DS Decision 2 | **[A21]** Success: remember() with value 'hello' -> recall() returns BeliefView.value === 'hello'. Rejection: N/A (string input always coerces to string). |
| DC-P1-201 | reflect() partial completion: some entries committed, others fail, leaving inconsistent state | 2: State consistency | QUALITY_GATE | CBM | DS Output 4 | **[A21]** Success: reflect() with valid entries stores all, returns stored count. Rejection: reflect() where one entry fails rolls back all, returns CONV_BATCH_PARTIAL or passthrough error, zero claims created. |
| DC-P1-202 | Convenience mission/agent not created during createLimen() eager init | 2: State consistency | DESIGN_PRINCIPLE | CBM | DS Decision 1, I-CONV-01 | **[A21]** Success: after createLimen(), remember() works immediately. Rejection: if init fails, createLimen() throws LimenError. |
| DC-P1-301 | Concurrent reflect() calls with shared connection cause transaction nesting corruption | 3: Concurrency | QUALITY_GATE | CBM | DS §reflect() transaction | **NOT APPLICABLE**: Limen is single-threaded (SQLite synchronous mode). No concurrent reflect() calls possible in Node.js single-threaded event loop with synchronous Result<T> API. |
| DC-P1-401 | Convenience layer bypasses ClaimApi, directly accessing ClaimSystem or ClaimStore | 4: Authority/governance | CONSTITUTIONAL | CBM | I-17, DS Ownership | **[A21]** Success: remember() delegates to ClaimApi.assertClaim(). Rejection: Structural proof -- convenience_layer.ts imports only ClaimApi, never ClaimSystem/ClaimStore. (Verified by import analysis.) |
| DC-P1-402 | forget() allows retraction by non-source agent or non-admin | 4: Authority/governance | CONSTITUTIONAL | CBM | DS Decision 6, section 10.4 | **[A21]** Success: forget() by source agent succeeds. Rejection: forget() by non-source non-admin returns UNAUTHORIZED. (Delegated to SC-11 retract handler -- constitutional enforcement at system-call layer.) |
| DC-P1-501 | remember() call produces no audit trail entry | 5: Causality/observability | CONSTITUTIONAL | CBM | I-03, DS Output 4 | **[A21]** Success: remember() produces audit entry via SC-11 handler delegation. Rejection: Structural proof -- convenience layer delegates to ClaimApi which delegates to SC-11 which includes I-03 atomic auditing. (Verified by delegation chain.) |
| DC-P1-502 | forget() retraction not reflected in audit trail | 5: Causality/observability | CONSTITUTIONAL | CBM | I-03 | **[A21]** Success: forget() produces audit entry via retract handler. Rejection: Structural -- delegates to retractClaim which includes audit. |
| DC-P1-601 | Phase 1 convenience layer changes database schema | 6: Migration/evolution | CONSTITUTIONAL | CBM | DS Output 6 | **NOT APPLICABLE (by design)**: Phase 1 adds ZERO tables, ZERO columns, ZERO migrations. Structural proof: no migration files in convenience directory. |
| DC-P1-701 | maxAutoConfidence or CognitiveConfig stored in plaintext where it shouldn't be | 7: Credential/secret | CONSTITUTIONAL | CBM | — | **NOT APPLICABLE**: CognitiveConfig contains no credentials or secrets. maxAutoConfidence is a numeric threshold (0.0-1.0), not a credential. No bearer tokens, API keys, or secrets in the convenience layer. |
| DC-P1-801 | remember() 1-param form accepts empty/whitespace text, producing a claim with no meaningful content | 8: Behavioral/model quality | QUALITY_GATE | CBM | DS Error Taxonomy CONV_INVALID_TEXT | **[A21]** Success: remember('valid text') succeeds. Rejection: remember('') returns error with code CONV_INVALID_TEXT. remember('   ') returns error with code CONV_INVALID_TEXT. |
| DC-P1-802 | reflect() accepts invalid category value | 8: Behavioral/model quality | QUALITY_GATE | CBM | DS Error Taxonomy CONV_INVALID_CATEGORY | **[A21]** Success: reflect() with category 'decision' succeeds. Rejection: reflect() with category 'invalid' returns CONV_INVALID_CATEGORY. |
| DC-P1-803 | reflect() accepts statement exceeding 500 characters | 8: Behavioral/model quality | QUALITY_GATE | CBM | DS Error Taxonomy CONV_STATEMENT_TOO_LONG | **[A21]** Success: reflect() with 500-char statement succeeds. Rejection: reflect() with 501-char statement returns CONV_STATEMENT_TOO_LONG. |
| DC-P1-804 | connect() accepts invalid relationship type | 8: Behavioral/model quality | QUALITY_GATE | CBM | DS Error Taxonomy CONV_INVALID_RELATIONSHIP | **[A21]** Success: connect() with type 'supports' succeeds. Rejection: connect() with type 'invalid' returns CONV_INVALID_RELATIONSHIP. |
| DC-P1-805 | connect() accepts self-referencing relationship (same claimId both sides) | 8: Behavioral/model quality | QUALITY_GATE | CBM | DS Error Taxonomy CONV_SELF_REFERENCE | **[A21]** Success: connect(id1, id2, 'supports') succeeds. Rejection: connect(id1, id1, 'supports') returns CONV_SELF_REFERENCE. |
| DC-P1-806 | maxAutoConfidence validated outside [0.0, 1.0] at createLimen() time | 8: Behavioral/model quality | QUALITY_GATE | CBM | DS Amendment 1 | **[A21]** Success: createLimen with maxAutoConfidence=0.5 succeeds. Rejection: createLimen with maxAutoConfidence=1.5 or NaN or -0.1 throws INVALID_CONFIG. |
| DC-P1-807 | reflect() accepts empty entries array | 8: Behavioral/model quality | QUALITY_GATE | CBM | DS Error Taxonomy CONV_EMPTY_ENTRIES | **[A21]** Success: reflect() with 1+ entries succeeds. Rejection: reflect([]) returns CONV_EMPTY_ENTRIES. |
| DC-P1-808 | remember() confidence outside [0.0, 1.0] | 8: Behavioral/model quality | QUALITY_GATE | CBM | DS Error Taxonomy CONV_INVALID_CONFIDENCE | **[A21]** Success: remember() with confidence=0.5 succeeds. Rejection: remember() with confidence=1.5 returns CONV_INVALID_CONFIDENCE. |
| DC-P1-901 | Existing 3,188 tests broken by Phase 1 additions | 9: Availability/resource | CONSTITUTIONAL | CBM | DS Additive Guarantee | **[A21]** Success: npm test passes all existing tests. Rejection: any existing test failure = implementation defect. |
| DC-P1-902 | Convenience API methods on frozen Limen object not callable | 9: Availability/resource | DESIGN_PRINCIPLE | CBM | C-07 | **[A21]** Success: remember/recall/forget/connect/reflect/promptInstructions callable after deepFreeze. Rejection: TypeError on calling any method = freeze incompatibility. |

---

## Cross-Subsystem Boundary Declaration

The convenience layer crosses ONE boundary:
- **Convenience Layer -> ClaimApi**: All data mutations and queries delegate through ClaimApi (I-17). The convenience layer never imports from `claims/store/`, `claims/interfaces/claim_types.ts` system internals, or kernel types beyond branded IDs.

## Assumption Ledger

| Assumption | Owner | Review Trigger | Invalidation Trigger | Response When Broken |
|---|---|---|---|---|
| A-P1-01: ClaimApi.assertClaim correctly enforces maxAutoConfidence cap via GroundingValidator | Builder | Phase 1 Breaker pass | Convenience layer sets confidence=0.9 with runtime_witness and ClaimApi stores 0.9 | Reopen DC-P1-101, re-derive convenience layer confidence capping logic. The convenience layer currently pre-caps confidence before delegating -- this assumption affects whether double-capping is needed. |
| A-P1-02: SQLite transaction BEGIN/COMMIT/ROLLBACK works correctly through getConnection() closure singleton | Builder | Breaker transaction tests | reflect() partial commit observed | Reopen DC-P1-201, investigate connection management. |
| A-P1-03: Agent registration via agents.register() is idempotent (re-registering same name does not fail) | Builder | First integration test | agents.register('limen-convenience') throws on second createLimen() with same dataDir | Add try/catch for agent registration in eager init; fetch existing agent if registration fails. |

---

## Self-Audit

- Did I derive every DC from the spec? YES -- each DC traces to Design Source section, error taxonomy, or constitutional invariant.
- Did I cover all 9 categories? YES -- all 9 enumerated with explicit disposition.
- Did I mark all enforcement DCs with [A21]? YES -- every testable DC has [A21] annotation with success AND rejection paths.
- **I do NOT judge completeness -- that is the Breaker's job (HB #23).**

---

*SolisHQ -- We innovate, invent, then disrupt.*
