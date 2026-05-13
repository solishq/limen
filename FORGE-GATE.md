# FORGE-GATE.md

**Limen V5 — SolisForge v1.5 Generic Reference — Forge Gate Ledger**

**Current Phase:** 0 (Intent + Property Derivation)
**Governance Tier:** Forge Critical (SolisForge v1.5 S3)
**Status:** Bounded Admission -- Pending Breaker/Certifier/Witness

---

## Artifact Ledger

| Phase | Artifact | SHA-256 | Gate Status |
|-------|----------|---------|-------------|
| 0 | `PHASE_0_INTENT_RECORD.md` | `b2b4ff433dd0561703774fb104a19d3d6b5631e8a6bb78a77550948df3250636` | Breaker complete, Certifier pending |
| 0 | `PHASE_0_PROPERTY_DERIVATION.md` | `572ee365d225eb0faa21f4b01b8d0a1ff44007d96cae6ef72cfbe00e36ac92ac` | Breaker complete, Certifier pending |

---

## Phase Checklist

| Phase | Name | Status |
|-------|------|--------|
| 0 | Intent + Property Derivation | Bounded Admission |
| 1 | Contracts (interfaces, types, error taxonomy) | Not started |
| 2 | Core Engine (belief store, decay, governance) | Not started |
| 3 | Consent + Classification + Refusal | Not started |
| 4 | AdapterRegistry + LimenAgentClient | Not started |
| 5 | Computer-Use Sandbox + Provenance | Not started |
| 5.5 | Test Stand (structural bypass proof) | Not started |
| 6 | Unified Audit Chain + Viz | Not started |
| 7 | Self-Healing Cascades | Not started |
| 8 | MCP Tool Surface | Not started |
| 9 | Integration + OAT | Not started |
| 10 | Release + Documentation | Not started |

---

## Rules

1. No artifact advances past Bounded Admission without SHA-256 recorded here.
2. Breaker/Certifier/Witness verdicts are logged per-phase before the next phase opens.
3. Any hash mismatch between this ledger and the file on disk is a blocking finding.
4. This file is the single source of truth for Forge pipeline state.
