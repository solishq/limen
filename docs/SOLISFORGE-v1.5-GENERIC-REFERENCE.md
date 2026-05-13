<!-- @governance SolisForge Protocol v1.5 — Sole Governing Doctrine -->

# SOLISFORGE v1.5 — OFFICIAL GENERIC REFERENCE DOCUMENT

**Project-Agnostic Engineering Discipline**
**Version:** 1.5
**Date:** May 13, 2026
**Purpose:** Universal, first-principles framework for building complex, high-stakes systems with zero residual risk, unbreakable evidence chains, and aerospace-precision discipline. Applies to any domain.

---

## 1. Core Philosophy & Non-Negotiable Principles

- Every decision, artifact, and claim must be derived from **first principles**.
- **Aerospace precision** in every step: every detail matters, nothing is too small to audit.
- **Zero residual risk** before any build, implementation, or deployment.
- **Evidence-first** — nothing is treated as true until it has a complete, unbroken proof chain.
- **No copies, no patches, no shortcuts, no assumptions.**
- **No fake-zero language** ever: Do not use "zero residual", "canonical", "certified", "100%", "no gaps", "no assumptions", "all findings closed", etc., unless the full proof chain exists in the Truth Ledger.
- **Bounded admission only** — every spec, run, or artifact is admitted only as "bounded design / evidence / scaffolding" until the full gate process is complete.
- Human oversight and kill-switch primacy are always preserved.

## 2. Truth Ledger (A-33) — Single Source of Truth

Every claim, status, or admission **must** have a complete proof chain:

```
artifact path → SHA-256 hash → validator result → Breaker verdict → Certifier verdict → Witness score (target 100/100) → FORGE-GATE.md status
```

- **FORGE-GATE.md** is the **single canonical source of truth** for the entire project.
- Every file saved must be referenced in FORGE-GATE.md with its SHA-256.
- If any link in the chain is missing, the claim is invalid and must be treated as blocked.

## 3. Hashing Rules

- **Algorithm:** SHA-256 (full 64-character hexadecimal string).
- **What is hashed:** Every specification, simulation run package, evidence ledger, manifest, report, log, breaker/certifier/witness artifact, and FORGE-GATE.md itself after every update.
- **Provenance rule:** Every evidence package must explicitly include the SHA-256 hashes of all governing specifications used to generate it.
- Hashing must be performed on the exact UTF-8 bytes of the file content.

## 4. Building & Implementation Rules

- **No build, no implementation, no runtime code** is allowed until **all P0 gaps** in the Pre-Build Hardening Plan are closed to 10/10.
- A final PA-authorized decision in FORGE-GATE.md must declare "build-authorized" before any code is written.
- All code must follow the same gate discipline: full proof chains, exhaustive tests, deterministic behavior, and bounded admission.

## 5. File Saving Rules

All artifacts saved in the designated project workspace with full path and SHA-256 confirmation.

**Recommended folder structure:**
- `FORGE-GATE.md` — Single source of truth
- `docs/` — Specifications and governance documents
- `reports/` — Breaker/Certifier/Witness artifacts
- `logs/` — Evidence and finding logs

## 6. Gate Process (Breaker → Certifier → Witness)

1. **Breaker** — Independent adversarial review (finds P0s).
2. **Remediation** (if needed) → reseal → rerun validators.
3. **Certifier** — GO / NO-GO review.
4. **Witness** — Scoring (target 100/100, non-negotiable).
5. **FORGE-GATE.md update** with full proof chain.
6. Only then is the artifact considered admitted (bounded).

## 7. Pre-Build Hardening Plan Template

All P0 gaps must be closed to 10/10 before any build begins:

| Priority | Gap | Why It Blocks Success | Current Status | Recommended Fix |
|----------|-----|-----------------------|----------------|-----------------|
| P0 | [Gap description] | [Impact] | Open | [Remediation plan] |

---

**This document is the complete, generic version of SolisForge v1.5. It ensures perfect continuity, aerospace-precision discipline, and bounded admission across any project or session.**
