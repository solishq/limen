# FORGE GATE — Limen v5

**Governing Standard:** SolisForge Protocol v1.4
**Governance Tier:** Forge Critical
**Deliverable:** Limen v5 Cognitive Infrastructure
**Last Updated:** 2026-05-09

---

## CURRENT PHASE: 5 (Implementation)

**DO NOT advance to the next phase until ALL checkboxes in the current phase are checked.**
**DO NOT dispatch a Breaker outside Phase 3 or Phase 6.**
**DO NOT combine Certifier + Witness in one dispatch.**
**DO NOT let Orchestrator act as Builder without explicit Femi authorization.**

---

## Phase 0 — Intent & Property Derivation

- [x] Intent Record produced (`docs/LIMEN-INTENT-AND-PROPERTIES.md`)
- [x] Purpose statement (1 paragraph)
- [x] Success definition (measurable)
- [x] Scope boundary (in + out)
- [x] Constraints inherited
- [x] Property Derivation produced (same file)
- [x] Enumerated invariants (59 across 14 contracts)
- [x] Non-goals (8)
- [x] Quality targets (12, measurable)

**Phase 0 EXIT: COMPLETE**

---

## Phase 1 — Failure Mode Atlas

- [x] FMA produced (`docs/LIMEN-FAILURE-MODE-ATLAS.md`)
- [x] Every failure mode maps to a preventing property
- [x] Every failure mode maps to a requirement trace
- [x] All mandatory categories covered (13 categories, 107 modes)
- [x] Consumes: Property Derivation (Phase 0) — verified

**Phase 1 EXIT: COMPLETE**

---

## Phase 2 — Contract Specification

- [x] Contract Specification produced (14 extraction files in `docs/LIMEN-*-REQUIREMENTS.md`)
- [x] All 14 contracts extracted
- [x] 3,747 requirements with unique IDs
- [x] Every requirement traces to exact contract text
- [x] Consumes: Intent Record, Property Derivation, FMA — verified

**Phase 2 EXIT: COMPLETE**

---

## Phase 3 — Adversarial Contract Attack

- [x] Breaker attacked contract specification
- [x] Adversarial Verdict produced
- [ ] Convergence Log maintained (round numbers, P0/P1/P2/P3 counts, 3-rule check)
- [ ] Negative Evidence Mandate: attacks constructed from FMA failure modes
- [x] All findings remediated

**Phase 3 EXIT: INCOMPLETE — convergence log and negative evidence missing**

---

## Phase 4 — Architecture Decision

- [x] Architecture Decision produced (`docs/LIMEN-ARCHITECTURE-DECISION.md`)
- [x] 14 decisions with chosen path + rejected alternatives + evidence
- [x] Consumes: Contract Specification (Breaker-verified)

**Phase 4 EXIT: COMPLETE**

---

## Phase 5 — Implementation

- [ ] Implementation Spec produced (how contract is realized)
- [x] Code exists (287 source files, 4,258 tests pass)
- [x] Coverage report shows 59% implemented, 17% not implemented
- [ ] Gap implementation: Consent Integration (ST-19) — IN PROGRESS (types done, gate not wired)
- [ ] Gap implementation: Lifecycle Management (LM) — NOT STARTED
- [ ] Gap implementation: Output Governance (OG) — NOT STARTED
- [ ] Gap implementation: Coordination Governance (CO) — NOT STARTED
- [ ] Gap implementation: Audit Visualization (AV) — NOT STARTED
- [ ] All 3,747 requirements have implementing code

**Phase 5 EXIT: INCOMPLETE**

---

## Phase 5.5 — Test Stand

- [ ] System runs end-to-end (not just unit tests)
- [ ] Real output generated (agent creates beliefs, governance evaluates, audit written)
- [ ] Integration failures observed (components working together)
- [ ] Performance under real conditions measured
- [ ] Resource consumption observed
- [ ] Exit criteria met: "System executes end-to-end AND produces output consistent with its purpose"

**Phase 5.5 EXIT: NOT STARTED**

---

## Phase 6 — Adversarial Implementation Attack

- [ ] Breaker attacks RUNNING code (not static review)
- [ ] Breaker receives contract as standard, running code as subject
- [ ] Negative Evidence Mandate: FMA failure modes attacked
- [ ] Adversarial Verdict produced
- [ ] Convergence Log: round numbers, 3-rule check
- [ ] If findings: Builder remediates, re-attack scoped to changed code

**Phase 6 EXIT: NOT STARTED**

---

## Phase 7 — Certifier Evidence Gate

- [ ] Every contract clause implemented (3,747 requirements verified)
- [ ] Every Breaker finding closed
- [ ] Every test passes
- [ ] Certifier Evidence produced
- [ ] Traceability Matrix produced (Appendix A format: element, clause, test, Breaker ID)

**Phase 7 EXIT: NOT STARTED**

---

## Phase 8 — Witness Gate

- [ ] Witness experiences system from ignorance
- [ ] 10-dimension scoring (>= 80/100)
- [ ] Zero friction points above P1
- [ ] Witness Testimony produced

**Phase 8 EXIT: NOT STARTED**

---

## Phase 9 — Ratification & Continuity

- [ ] All P0-P3 findings closed (Zero-Residual)
- [ ] Femi ratifies
- [ ] Continuity Artifact produced (<=1000 words: summary, restart, locked, forbidden, open, limitations)
- [ ] Ratification Record produced

**Phase 9 EXIT: NOT STARTED**

---

## Phase 10 — Self-Audit & Improvement

- [x] Compliance audit performed (`docs/LIMEN-COMPLIANCE-AUDIT.md`)
- [x] 9 violations documented
- [x] 6 SolisForge v1.5 amendments proposed
- [ ] Amendments Breaker-reviewed (per §8.2)
- [ ] Amendments Femi-ratified

**Phase 10 EXIT: IN PROGRESS**

---

## Required Artifacts Checklist (Forge Critical — All 11)

| # | Artifact | Phase | Status | File |
|---|----------|-------|--------|------|
| 1 | Intent Record | 0 | DONE | `docs/LIMEN-INTENT-AND-PROPERTIES.md` |
| 2 | Property Derivation | 0 | DONE | Same file (59 invariants) |
| 3 | Failure Mode Atlas | 1 | DONE | `docs/LIMEN-FAILURE-MODE-ATLAS.md` |
| 4 | Contract Specification | 2 | DONE | 14 `docs/LIMEN-*-REQUIREMENTS.md` files |
| 5 | Architecture Decision | 4 | DONE | `docs/LIMEN-ARCHITECTURE-DECISION.md` |
| 6 | Implementation Spec | 5 | **MISSING** | — |
| 7 | Traceability Matrix | 7 | **MISSING** | — |
| 8 | Adversarial Verdict (contract) | 3 | DONE | Breaker logs in extraction guide |
| 9 | Adversarial Verdict (implementation) | 6 | **NOT YET** | Phase 6 not reached |
| 10 | Certifier Evidence | 7 | **NOT YET** | Phase 7 not reached |
| 11 | Continuity Artifact | 9 | **MISSING** | — |
| + | Ratification Record | 9 | **NOT YET** | Phase 9 not reached |
| + | Witness Testimony | 8 | **NOT YET** | Phase 8 not reached |

**7 of 11 produced. 4 remaining (Implementation Spec, Traceability Matrix, Continuity Artifact, and phases not yet reached).**

---

## Convergence Log

| Round | Phase | P0 | P1 | P2 | P3 | Total | New P1? | Non-increasing? | Converged? |
|-------|-------|----|----|----|----|-------|---------|-----------------|------------|
| — | — | — | — | — | — | — | — | — | Phase 3 and Phase 6 rounds logged here |

---

## Enforcement Rules (Read at Every Session Start)

1. **Check this file first.** What phase are we in? What's missing?
2. **Do not skip phases.** If Phase 5 is incomplete, do not start Phase 5.5.
3. **Breaker ONLY at Phase 3 and Phase 6.** Not per-file. Not per-artifact.
4. **Certifier and Witness are SEPARATE dispatches.** Never combined.
5. **Orchestrator does not build.** If agents fail, stop or re-dispatch. Do not edit code.
6. **Test stand means RUN THE SYSTEM.** Unit tests are not a test stand.
7. **Track convergence formally.** Fill in the Convergence Log table.
8. **Reality Anchor fires at 30% overhead or 3+ P2/P3-only rounds.**
9. **Every phase produces its artifact.** Phase is not complete until artifact exists.
10. **This file is updated BEFORE any commit.** Current phase and checklist reflect reality.
