<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 (self-referential) -->

# Limen v5 Integration Contract — SolisForge Protocol v1.4 Convergence

**Version:** 1.0.0
**Date:** 2026-05-09
**Status:** RATIFIED — Forge Critical (Breaker CLEAN R5+R6, Certifier GO, Witness 83/100, Ratified 2026-05-09 by Femi)
**Authority:** SolisForge Protocol v1.4 §2 (Orchestrator discretion for existing project transition)
**Governance:** SolisForge Protocol v1.4 — Sole Governing Doctrine
**Traceability:** SolisForge §2 (Scope and Supersession), §6 (Forge Cycle), §9 (Enforcement Mechanisms)

---

## 1. Purpose

This contract declares SolisForge Protocol v1.4 as the **sole governing doctrine** for all Limen v5 artifacts, effective immediately. It establishes the convergence boundary, supersession rules, and validation requirements that make this transition structurally enforceable.

## 2. Sole Governance Declaration

**SolisForge Protocol v1.4** governs every line of code, every contract, every document, every test, and every future change in Limen v5 from this moment forward.

- **No dual standards.** There is exactly one governing doctrine.
- **No grandfather clauses.** All existing artifacts are retroactively governed.
- **No silent references.** Any file referencing a prior governance standard as authoritative is invalid until updated.

## 3. Baseline Freeze Point

| Property | Value |
|----------|-------|
| **Commit** | `f4ead70cc9919131c3f6b712f1b2df98c79ff850` |
| **Branch** | `release/v5` |
| **Date** | 2026-05-09T07:08:58+01:00 |
| **State** | 147 adversarial findings remediated (R1: 65, R2: 82) |
| **Tests** | 4258 pass, 0 fail |
| **TSC** | Clean |
| **npm audit** | 0 vulnerabilities |

This commit is the ratified baseline. All convergence changes are measured against it.

## 4. Supersession Rules

### 4.1 Superseded Standards

The following are **no longer authoritative** for Limen v5:

| Prior Standard | Disposition |
|---------------|-------------|
| SolisHQ Premier Engineering Standard v2.2 | SUPERSEDED by SolisForge v1.4 §2 |
| CONTRACT-COMPLIANCE-v2.1.md (CDM v2.1) | SUPERSEDED — mechanisms absorbed into SolisForge §9 |
| MASTER-INDEX-v2.2-FINAL.md doctrine anchors | SUPERSEDED — re-anchored to SolisForge v1.4 |
| QAL levels | RETIRED — replaced by Governance Tiers (§3) |
| LCI meta-cohesion | RETIRED — replaced by Traceability Matrix (§11) |

### 4.2 Absorbed Mechanisms

All mechanisms from v2.2 are accounted for per SolisForge §2.1 Disposition Table. Nothing is silently dropped. Every HB (Hard Ban), every enforcement gate, every role separation rule has a SolisForge counterpart.

### 4.3 Historical Record Rule

References to Premier Engineering Standard v2.2 may remain in files **only** when clearly marked as `[HISTORICAL — superseded by SolisForge Protocol v1.4]`. No prior-standard reference may appear as authoritative.

## 5. File Compliance Requirements

### 5.1 Governance Declaration Header

Every file in the repository must contain an explicit SolisForge v1.4 governance declaration:

**For TypeScript/JavaScript files:**
```typescript
// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
```

**For Rust files:**
```rust
// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
```

**For Markdown files:**
```markdown
<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->
```

**For JSON files:**
JSON files cannot contain comments. Governance for JSON files is tracked via the Traceability Scanner manifest (see §6.1).

### 5.2 Validity Rule

Any file without the governance declaration header is **invalid** under SolisForge v1.4. The Traceability Scanner (§6.1) enforces this automatically.

## 6. Self-Triggering Validation Tools

Three validation tools are installed as part of this convergence:

### 6.1 Traceability Scanner (`scripts/solisforge-traceability-scanner.sh`)

- Scans every file for the SolisForge v1.4 governance declaration
- Validates JSON files against the scanner manifest
- Exit code 0 = compliant, Exit code 1 = violations found
- **Note:** CI integration is a separate Forge Standard cycle (per SolisForge §11: automated verification is a roadmap goal, not claimed here)

### 6.2 Divergence Detector (`scripts/solisforge-divergence-detector.sh`)

- Runs on every commit (via pre-commit hook) or session start
- Checks current state against ratified contracts under SolisForge rules
- Flags P0 (structural violation) and P1 (missing traceability) divergence
- Outputs divergence report to stdout

### 6.3 Self-Audit Trigger (`scripts/solisforge-self-audit-trigger.sh`)

- Invoked by Divergence Detector when P0/P1 issues are found
- Creates a Forge Critical cycle titled "Existing Code Convergence"
- Blocks further work until resolved
- Produces `CONVERGENCE_REQUIRED.md` in project root when triggered

## 7. Governance Tier Assignment

| Artifact Category | Governance Tier | Rationale |
|-------------------|----------------|-----------|
| Contracts (`contracts/`) | Forge Critical | Authoritative specifications — highest rigor |
| Core source (`src/kernel/`, `src/governance/`, `src/security/`) | Forge Critical | Security and governance substrate |
| Other source (`src/`) | Forge Standard | Implementation — standard rigor |
| Tests (`tests/`) | Forge Standard | Verification infrastructure |
| Documentation (`docs/`) | Forge Light | Supporting material |
| Top-level files | Forge Light | Project metadata |

## 8. Amendment Process

Amendments to this contract follow SolisForge §8.1:

1. Evidence of error (reproducible, falsifiable)
2. Orchestrator evaluates
3. Draft amendment with AMENDMENT NOTE
4. Breaker review
5. Femi ratifies

**Monotonicity constraint applies:** No amendment may reduce the defense set without a compensating control.

## 9. Defense Set

The Limen v5 defense set under SolisForge v1.4:

1. **Contract-First Gate** — No implementation without ratified contract (SolisForge §9)
2. **Traceability Enforcement** — Every public method links to contract clause (SolisForge §9)
3. **Governance Declaration** — Every file declares its governing doctrine (this contract §5)
4. **Traceability Scanner** — Automated compliance validation (this contract §6.1)
5. **Divergence Detector** — Automated drift detection (this contract §6.2)
6. **Self-Audit Trigger** — Automated remediation cycle creation (this contract §6.3)
7. **Zero-Residual Law** — No finding remains open (SolisForge Principle 9)
8. **Role Separation** — Builder ≠ Breaker ≠ Certifier ≠ Witness ≠ Orchestrator (SolisForge §4)
9. **HB-37** — Defense-set monotonicity (absorbed from v2.2)
10. **HB-38** — Interface/hash binding (absorbed from v2.2)

## 10. Verification Checklist

- [x] Every file contains SolisForge v1.4 governance declaration (scanner COMPLIANT — count tracked by scanner at runtime)
- [x] Zero authoritative references to Premier Engineering Standard v2.2 (grep verified)
- [x] All three validation tools installed and functional (scanner + detector + trigger verified)
- [x] Full test suite passes (4291 pass, 0 fail at final verification — baseline was 4258 at f4ead70)
- [x] Master Index re-anchored to SolisForge v1.4 (doctrine anchor section updated)
- [x] phase-x.contracts.json governance field updated to SolisForge v1.4
- [x] Single atomic convergence commit produced (7245c60, remediated in follow-up)

---

**Document Status:** RATIFIED — Forge Critical Convergence Cycle (Ratified 2026-05-09 by Femi per SolisForge §6 Phase 9)
**SHA-256:** Tracked in `contracts/phase-x.contracts.json` and `MASTER-INDEX-v2.1-FINAL.md` (self-referential hash avoided per HB-38)
