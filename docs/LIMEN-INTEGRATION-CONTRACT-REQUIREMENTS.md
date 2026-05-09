# Limen v5 -- LIMEN_V5_INTEGRATION_CONTRACT.md Requirement Extraction

**Source:** `contracts/LIMEN_V5_INTEGRATION_CONTRACT.md` v1.0.0
**Extracted:** 2026-05-09
**Governing Standard:** SolisForge Protocol v1.4
**Governance Tier:** Forge Critical
**Purpose:** Every implementable requirement from the integration contract.

---

## Section 1: Purpose

| ID | Requirement | Source |
|---|---|---|
| IC-1.01 | SolisForge Protocol v1.4 SHALL be the sole governing doctrine for all Limen v5 artifacts | SS1 |
| IC-1.02 | The convergence boundary, supersession rules, and validation requirements SHALL be structurally enforceable | SS1 |

## Section 2: Sole Governance Declaration

| ID | Requirement | Source |
|---|---|---|
| IC-2.01 | SolisForge Protocol v1.4 SHALL govern every line of code, every contract, every document, every test, and every future change in Limen v5 | SS2 |
| IC-2.02 | There SHALL be exactly one governing doctrine -- no dual standards | SS2 |
| IC-2.03 | All existing artifacts SHALL be retroactively governed -- no grandfather clauses | SS2 |
| IC-2.04 | Any file referencing a prior governance standard as authoritative SHALL be invalid until updated | SS2 |

## Section 3: Baseline Freeze Point

| ID | Requirement | Source |
|---|---|---|
| IC-3.01 | The baseline freeze commit SHALL be `f4ead70cc9919131c3f6b712f1b2df98c79ff850` on `release/v5` | SS3 |
| IC-3.02 | The baseline SHALL have 147 adversarial findings remediated (R1: 65, R2: 82) | SS3 |
| IC-3.03 | The baseline SHALL have 4258 tests passing, 0 failures | SS3 |
| IC-3.04 | The baseline SHALL have clean TSC and 0 npm vulnerabilities | SS3 |
| IC-3.05 | All convergence changes SHALL be measured against this baseline | SS3 |

## Section 4: Supersession Rules

| ID | Requirement | Source |
|---|---|---|
| IC-4.01 | Premier Engineering Standard v2.2 SHALL be SUPERSEDED by SolisForge v1.4 SS2 | SS4.1 |
| IC-4.02 | CONTRACT-COMPLIANCE-v2.1.md (CDM v2.1) SHALL be SUPERSEDED -- mechanisms absorbed into SolisForge SS9 | SS4.1 |
| IC-4.03 | MASTER-INDEX-v2.2-FINAL.md doctrine anchors SHALL be SUPERSEDED -- re-anchored to SolisForge v1.4 | SS4.1 |
| IC-4.04 | QAL levels SHALL be RETIRED -- replaced by Governance Tiers (SolisForge SS3) | SS4.1 |
| IC-4.05 | LCI meta-cohesion SHALL be RETIRED -- replaced by Traceability Matrix (SolisForge SS11) | SS4.1 |
| IC-4.06 | All mechanisms from v2.2 SHALL be accounted for per SolisForge SS2.1 Disposition Table -- nothing silently dropped | SS4.2 |
| IC-4.07 | Every HB (Hard Ban), enforcement gate, and role separation rule SHALL have a SolisForge counterpart | SS4.2 |
| IC-4.08 | References to PES v2.2 MAY remain only when marked as `[HISTORICAL -- superseded by SolisForge Protocol v1.4]` | SS4.3 |
| IC-4.09 | No prior-standard reference SHALL appear as authoritative | SS4.3 |

## Section 5: File Compliance

| ID | Requirement | Source |
|---|---|---|
| IC-5.01 | Every TypeScript/JavaScript file SHALL contain `// @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine` | SS5.1 |
| IC-5.02 | Every TypeScript/JavaScript file SHALL contain `// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md SS5.1` | SS5.1 |
| IC-5.03 | Every Rust file SHALL contain `// @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine` | SS5.1 |
| IC-5.04 | Every Rust file SHALL contain `// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1` | SS5.1 |
| IC-5.05 | Every Markdown file SHALL contain `<!-- @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine -->` | SS5.1 |
| IC-5.06 | Every Markdown file SHALL contain `<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->` | SS5.1 |
| IC-5.07 | JSON files SHALL be tracked via the Traceability Scanner manifest (no inline comments possible) | SS5.1 |
| IC-5.08 | Any file without the governance declaration header SHALL be invalid under SolisForge v1.4 | SS5.2 |
| IC-5.09 | The Traceability Scanner (§6.1) SHALL enforce file validity automatically | SS5.2 |

## Section 6: Self-Triggering Validation Tools

| ID | Requirement | Source |
|---|---|---|
| IC-6.01 | Traceability Scanner SHALL be implemented at `scripts/solisforge-traceability-scanner.sh` | SS6.1 |
| IC-6.02 | Traceability Scanner SHALL scan every file for SolisForge v1.4 governance declaration | SS6.1 |
| IC-6.03 | Traceability Scanner SHALL validate JSON files against the scanner manifest | SS6.1 |
| IC-6.04 | Traceability Scanner SHALL fail CI on any missing declaration (exit code 1) | SS6.1 |
| IC-6.05 | Traceability Scanner SHALL return exit code 0 when compliant | SS6.1 |
| IC-6.06 | Divergence Detector SHALL be implemented at `scripts/solisforge-divergence-detector.sh` | SS6.2 |
| IC-6.07 | Divergence Detector SHALL run on every commit (pre-commit hook) or session start | SS6.2 |
| IC-6.08 | Divergence Detector SHALL check current state against ratified contracts under SolisForge rules | SS6.2 |
| IC-6.09 | Divergence Detector SHALL flag P0 (structural violation) and P1 (missing traceability) divergence | SS6.2 |
| IC-6.10 | Divergence Detector SHALL output divergence report to stdout | SS6.2 |
| IC-6.11 | Self-Audit Trigger SHALL be implemented at `scripts/solisforge-self-audit-trigger.sh` | SS6.3 |
| IC-6.12 | Self-Audit Trigger SHALL be invoked by Divergence Detector when P0/P1 issues are found | SS6.3 |
| IC-6.13 | Self-Audit Trigger SHALL create a Forge Critical cycle titled "Existing Code Convergence" | SS6.3 |
| IC-6.14 | Self-Audit Trigger SHALL block further work until resolved | SS6.3 |
| IC-6.15 | Self-Audit Trigger SHALL produce `CONVERGENCE_REQUIRED.md` in project root when triggered | SS6.3 |

## Section 7: Governance Tier Assignment

| ID | Requirement | Source |
|---|---|---|
| IC-7.01 | Contracts (`contracts/`) SHALL be governed at Forge Critical tier | SS7 |
| IC-7.02 | Core source (`src/kernel/`, `src/governance/`, `src/security/`) SHALL be governed at Forge Critical tier | SS7 |
| IC-7.03 | Other source (`src/`) SHALL be governed at Forge Standard tier | SS7 |
| IC-7.04 | Tests (`tests/`) SHALL be governed at Forge Standard tier | SS7 |
| IC-7.05 | Documentation (`docs/`) SHALL be governed at Forge Light tier | SS7 |
| IC-7.06 | Top-level files SHALL be governed at Forge Light tier | SS7 |

## Section 8: Amendment Process

| ID | Requirement | Source |
|---|---|---|
| IC-8.01 | Amendments SHALL require reproducible, falsifiable evidence of error | SS8 |
| IC-8.02 | Orchestrator SHALL evaluate evidence before drafting amendment | SS8 |
| IC-8.03 | Amendments SHALL include AMENDMENT NOTE | SS8 |
| IC-8.04 | Amendments SHALL pass Breaker review | SS8 |
| IC-8.05 | Femi SHALL ratify amendments | SS8 |
| IC-8.06 | No amendment SHALL reduce the defense set without compensating control (monotonicity) | SS8 |

## Section 9: Defense Set

| ID | Requirement | Source |
|---|---|---|
| IC-9.01 | Defense 1: Contract-First Gate -- no implementation without ratified contract | SS9 |
| IC-9.02 | Defense 2: Traceability Enforcement -- every public method links to contract clause | SS9 |
| IC-9.03 | Defense 3: Governance Declaration -- every file declares its governing doctrine | SS9 |
| IC-9.04 | Defense 4: Traceability Scanner -- automated compliance validation | SS9 |
| IC-9.05 | Defense 5: Divergence Detector -- automated drift detection | SS9 |
| IC-9.06 | Defense 6: Self-Audit Trigger -- automated remediation cycle creation | SS9 |
| IC-9.07 | Defense 7: Zero-Residual Law -- no finding remains open | SS9 |
| IC-9.08 | Defense 8: Role Separation -- B != Br != C != W != O | SS9 |
| IC-9.09 | Defense 9: HB-37 -- defense-set monotonicity (absorbed from v2.2) | SS9 |
| IC-9.10 | Defense 10: HB-38 -- interface/hash binding (absorbed from v2.2) | SS9 |

## Section 10: Verification Checklist

| ID | Requirement | Source |
|---|---|---|
| IC-10.01 | Every file SHALL contain SolisForge v1.4 governance declaration | SS10 |
| IC-10.02 | Zero authoritative references to PES v2.2 SHALL remain | SS10 |
| IC-10.03 | All three validation tools SHALL be installed and functional | SS10 |
| IC-10.04 | Full test suite SHALL pass (4258+ tests) | SS10 |
| IC-10.05 | Master Index SHALL be re-anchored to SolisForge v1.4 | SS10 |
| IC-10.06 | phase-x.contracts.json SHALL be updated with this contract | SS10 |
| IC-10.07 | A single atomic convergence commit SHALL be produced | SS10 |

---

## Summary

| Section | Count |
|---|---|
| 1 Purpose | 2 |
| 2 Sole Governance | 4 |
| 3 Baseline Freeze | 5 |
| 4 Supersession Rules | 9 |
| 5 File Compliance | 9 |
| 6 Validation Tools | 15 |
| 7 Tier Assignment | 6 |
| 8 Amendment Process | 6 |
| 9 Defense Set | 10 |
| 10 Verification Checklist | 7 |
| **GRAND TOTAL** | **73** |
