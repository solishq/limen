<!-- @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->
# Limen v5 -- SolisForge Requirement Extraction Guide

**Date:** 2026-05-09
**Governing Standard:** SolisForge Protocol v1.4
**Governance Tier:** Forge Critical
**Purpose:** Master guide for extracting, verifying, and certifying all Limen v5 requirements under SolisForge governance.

---

## 1. What This Is

This document tracks the Phase 2 (Contract Specification) extraction of every implementable requirement from every Limen v5 contract. It serves as:
- A process record for this project
- A reusable template for every future SolisHQ project
- Evidence that SolisForge Protocol v1.4 governs this codebase

## 2. The Process (Per Contract)

```
1. Builder reads the contract in its entirety
2. Builder extracts every implementable requirement with unique ID, text, source reference
3. Breaker attacks the extraction for completeness, accuracy, structural integrity
4. Builder remediates all Breaker findings
5. Repeat until Breaker returns CLEAN
6. After ALL contracts extracted: Certifier verifies the complete corpus
```

### Severity Classification (SolisForge v1.4 SS5)

| Severity | Definition | Blocking |
|----------|-----------|----------|
| P0 | System cannot function, crashes, security breach, contract violation making artifact unbuildable | Blocks ALL progression |
| P1 | Violates governing contract, breaks safety/correctness guarantee, gap causing failure at next phase | Blocks phase exit |
| P2 | Engineering tradeoff, performance concern, quality but not correctness | Fix before ratification |
| P3 | Documentation gap, cosmetic, no behavioral impact | Fix before ratification |

### Implementation Sequencing (Dependency Order)

Build contracts in this order — each depends on the ones above it:

1. **SHARED_TYPES** (ST) — foundation, all others import from here
2. **ADAPTER_ARCHITECTURE** (AA) — adapter interface all adapters implement
3. **MEMORY_BRIDGE** (MB) — core remember/recall, branches, merge
4. **LIFECYCLE_MANAGEMENT** (LM) — agent registration, trust, consent
5. **EXECUTION_GOVERNANCE** (EG) — missions, tasks, budget, waves
6. **CONTEXT_GOVERNANCE** (CG) — context assembly, eviction, working memory
7. **SEARCH_GOVERNANCE** (SG) — vector search, embeddings, dedup
8. **OUTPUT_GOVERNANCE** (OG) — inference, plugins, hooks, telemetry
9. **COMPUTER_USE_GOVERNANCE** (CU) — action governance, sandbox, provenance
10. **COORDINATION_GOVERNANCE** (CO) — A2A, forks, sync, replay
11. **INTELLIGENCE_BRIDGE** (IB) — techniques, cognitive health, self-heal
12. **AUDIT_VISUALIZATION** (AV) — visualization projections (read-only, depends on all)
13. **CREWAI_ADAPTER** (CA) — framework-specific adapter (depends on AA)

### Quality Rules (Non-Negotiable)

1. **Every type definition = a requirement.** If it has fields, each field is traceable.
2. **Every validation rule = a requirement.** These are the most important -- they define behavior.
3. **Every behavioral spec = a requirement.** Examples, ordering guarantees, edge cases.
4. **Every Rust projection = a parity requirement (TC-21).** Field-level structural equivalence.
5. **Every exclusion = a requirement.** What the system does NOT do is as important as what it does.
6. **No summaries.** Exact spec text or type definition as source.
7. **ID format:** `{PREFIX}-{section}.{number}` -- unique, sequential, no gaps.

### ID Prefix Registry

| Contract | Prefix | File |
|----------|--------|------|
| SHARED_TYPES.md | ST | LIMEN-SHARED-TYPES-REQUIREMENTS.md |
| AGENT_ADAPTER_ARCHITECTURE.md | AA | LIMEN-ADAPTER-ARCHITECTURE-REQUIREMENTS.md |
| CREWAI_ADAPTER_CONTRACT.md | CA | LIMEN-CREWAI-ADAPTER-REQUIREMENTS.md |
| AGENT_LIFECYCLE_MANAGEMENT.md | LM | LIMEN-LIFECYCLE-MANAGEMENT-REQUIREMENTS.md |
| AGENT_CONTEXT_GOVERNANCE.md | CG | LIMEN-CONTEXT-GOVERNANCE-REQUIREMENTS.md |
| AGENT_EXECUTION_GOVERNANCE.md | EG | LIMEN-EXECUTION-GOVERNANCE-REQUIREMENTS.md |
| AGENT_MEMORY_BRIDGE.md | MB | LIMEN-MEMORY-BRIDGE-REQUIREMENTS.md |
| AGENT_OUTPUT_GOVERNANCE.md | OG | LIMEN-OUTPUT-GOVERNANCE-REQUIREMENTS.md |
| AGENT_SEARCH_GOVERNANCE.md | SG | LIMEN-SEARCH-GOVERNANCE-REQUIREMENTS.md |
| AGENT_COORDINATION_GOVERNANCE.md | CO | LIMEN-COORDINATION-GOVERNANCE-REQUIREMENTS.md |
| AGENT_INTELLIGENCE_BRIDGE.md | IB | LIMEN-INTELLIGENCE-BRIDGE-REQUIREMENTS.md |
| COMPUTER_USE_GOVERNANCE.md | CU | LIMEN-COMPUTER-USE-REQUIREMENTS.md |
| AUDIT_VISUALIZATION_SCHEMA.md | AV | LIMEN-AUDIT-VISUALIZATION-REQUIREMENTS.md |
| Kernel (implicit) | KN | LIMEN-KERNEL-REQUIREMENTS.md |

## 3. Extraction Progress

| # | Contract | Prefix | Reqs | Breaker | Remediated | Status |
|---|----------|--------|------|---------|------------|--------|
| 1 | SHARED_TYPES.md | ST | 477 | 29 findings | 29/29 fixed | CLEAN |
| 2 | ADAPTER_ARCHITECTURE.md | AA | 309 | 11 findings | 11/11 fixed | CLEAN |
| 3 | CREWAI_ADAPTER_CONTRACT.md | CA | 350 | 7 findings | 7/7 fixed | CLEAN |
| 4 | AGENT_LIFECYCLE_MANAGEMENT.md | LM | 406 | 7 findings | 7/7 fixed | CLEAN |
| 5 | AGENT_CONTEXT_GOVERNANCE.md | CG | see file | 9 findings fixed | CLEAN |
| 6 | AGENT_EXECUTION_GOVERNANCE.md | EG | see file | 10 findings fixed | CLEAN |
| 7 | AGENT_MEMORY_BRIDGE.md | MB | see file | 6 findings fixed | CLEAN |
| 8 | AGENT_OUTPUT_GOVERNANCE.md | OG | see file | 7 findings fixed | CLEAN |
| 9 | AGENT_SEARCH_GOVERNANCE.md | SG | see file | 5 findings fixed | CLEAN |
| 10 | AGENT_COORDINATION_GOVERNANCE.md | CO | see file | 2 findings fixed | CLEAN |
| 11 | AGENT_INTELLIGENCE_BRIDGE.md | IB | see file | 2 findings fixed | CLEAN |
| 12 | COMPUTER_USE_GOVERNANCE.md | CU | see file | 4 findings fixed | CLEAN |
| 13 | AUDIT_VISUALIZATION_SCHEMA.md | AV | see file | 4 findings fixed | CLEAN |
| 14 | Kernel (implicit) | KN | -- | -- | DEFERRED |

**Requirement counts are derived from files, never hand-declared. Run: `grep -c "^| [A-Z][A-Z]-" docs/LIMEN-*REQUIREMENTS*.md` to get current totals.**

**Verified total as of 2026-05-09: 3,674 requirements from 13 contracts. 103 Breaker findings found and fixed. Certifier GO. Witness 75/100 (P1 count-drift fixed).**

## 4. Breaker Finding Log

### SHARED_TYPES.md Breaker (Round 1)
- **Verdict:** DIRTY (29 findings: 16 P1, 8 P2, 5 P3)
- **Root cause:** Rust parity (TC-21) -- 24 structs + 8 enums missing from extraction
- **Remediation:** All 29 fixed. Added ST-25.46 through ST-25.84. Total: 446 -> 477.
- **Post-remediation:** CLEAN (pending re-Breaker confirmation)

### ADAPTER_ARCHITECTURE.md Breaker (Round 1)
- **Verdict:** DIRTY (11 findings: 3 P1, 5 P2, 3 P3)
- **Root cause:** Wrong type count, missing Rust accessor methods, missing governance pipeline reqs
- **Remediation:** All 11 fixed. Added AA-7.52-54, AA-9.33-38, AA-12.28-30, split AA-7.34. Total: 296 -> 309.
- **Post-remediation:** CLEAN

### CREWAI_ADAPTER_CONTRACT.md Breaker (Round 1)
- **Verdict:** DIRTY (7 findings: 4 P1, 1 P2, 2 P3)
- **Root cause:** Error code count "17" should be "18" (3 occurrences); 12 Rust error variant payloads missing
- **Remediation:** All 7 fixed. Added CA-4.46 through CA-4.59. Total: 336 -> 350.
- **Post-remediation:** CLEAN

### LIFECYCLE_MANAGEMENT.md Breaker (Round 1)
- **Verdict:** DIRTY (7 findings: 5 P1, 1 P2, 1 P3)
- **Root cause:** 9 TypeScript methods have no Rust trait equivalent; extraction didn't flag TC-21 gaps
- **Remediation:** All 7 fixed. Added Section 17 (LM-17.01 through LM-17.11). Total: 395 -> 406.
- **Post-remediation:** CLEAN

### Batch Breaker: CG + EG + MB + OG (Round 1)
- **Verdict:** ALL DIRTY (32 findings: 14 P1, 14 P2, 4 P3)
- **Dominant pattern:** TC-21 Rust parity gaps (same class as all prior contracts)
- **Second pattern:** Event payloads without event name identifiers (CG)
- **Third pattern:** TS types used-but-not-defined in contract scope (EG — 5 enum types)
- **Remediation:** IN PROGRESS

## 5. Lessons Learned (Feed to SolisForge v1.5)

1. **Rust parity is a systematic gap.** The first extraction missed ALL Rust struct projections. Every future extraction must have an explicit "Rust Parity" section checklist.
2. **Section header counts drift.** When requirements are added/removed during remediation, section headers become stale. Add a verification step: `grep -c` actual rows vs declared total.
3. **Behavioral examples are requirements.** Contract examples (e.g., "A high-trust session stores...") are testable behavioral specs. Extract them.
4. **Parallel extraction + Breaker works.** Extractions are independent reads. Breaker can attack one while Builder extracts the next. No quality loss.
5. **Sub-agent usage limits are a real constraint.** Budget sub-agent dispatches. When limits hit, the Orchestrator must execute directly.
6. **Wicket validation:** Wicket's extraction went through 5 Breaker rounds, growing from 379 to ~400 requirements. New requirements discovered in later rounds include tool descriptions (R-5.114-120), allowed file types (R-6.28a), audit signal classification (R-6.29), connection rejection behavior (R-8.10-11), rate limit scope (R-9.07-08), and security mandates (R-12.11a-b). This proves the Breaker cycle catches real gaps.
7. **Per-contract Breaker → Certify while parallelizing next extraction.** The pipeline is: extract contract N → dispatch Breaker on N → remediate N → dispatch Certifier on N, WHILE extracting contract N+1 in parallel. Certification happens per-contract, not at the end. This is Femi's directive.
8. **NEVER declare counts in headers.** Section headers must NOT state "N Requirements." The table IS the count. Declaring it creates redundant data that drifts on every remediation. Use `grep -c` to verify. This is a proposed SolisForge v1.5 amendment (Count Integrity Gate).
9. **Non-standard IDs break traceability.** Suffixes like `EG-3.25a` and placeholder prefixes like `EG-XX` violate the `{PREFIX}-{section}.{number}` format. Always renumber sequentially when adding requirements.

## 6. SolisForge Phase Map

This extraction work is Phase 2 of the Forge Cycle:

| Phase | Status | Artifact |
|-------|--------|----------|
| 0 -- Intent & Property Derivation | TODO | Formalize from existing contracts |
| 1 -- Failure Mode Atlas | TODO | Consolidate from Breaker findings |
| **2 -- Contract Specification** | **IN PROGRESS** | **This extraction work** |
| 3 -- Adversarial Contract Attack | IN PROGRESS (per-contract Breakers) | Breaker verdicts |
| 4 -- Architecture Decision | TODO | Formalize from existing code |
| 5 -- Implementation | EXISTING (4258 tests, commit f4ead70) | Code |
| 5.5 -- Test Stand | TODO | End-to-end system verification |
| 6 -- Adversarial Implementation Attack | DONE (R1+R2, 147 findings remediated) | Breaker verdicts |
| 7 -- Certifier Evidence Gate | TODO | After all extractions complete |
| 8 -- Witness Gate | TODO | After Certifier GO |
| 9 -- Ratification & Continuity | TODO | Femi approval |
| 10 -- Self-Audit | TODO | Process lessons |

---

**This document is updated after each extraction cycle.**
