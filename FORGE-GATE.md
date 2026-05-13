# FORGE-GATE.md

**Limen V5 — SolisForge v1.5 Generic Reference — Forge Gate Ledger**

**Current Phase:** 0 (Intent + Property Derivation)
**Governance Tier:** Forge Critical (SolisForge v1.5 S3)
**Status:** Bounded Admission — Breaker CLEAN, Certifier GO, Witness pending

---

## Artifact Ledger

| Phase | Artifact | SHA-256 | Gate Status |
|-------|----------|---------|-------------|
| 0 | `PHASE_0_INTENT_RECORD.md` | `bd43a2f5e57d32c012c4ce3738007aef687f5ce10d8094b5e55622bb3f7c3157` | Breaker CLEAN → Certifier GO → Witness pending |
| 0 | `PHASE_0_PROPERTY_DERIVATION.md` | `3162fc6b8aad446bc1724e28d6f1bc9e9656e0906af6d1adb1aacc77081847e1` | Breaker CLEAN → Certifier GO → Witness pending |
| 0 | `FORGE-GATE.md` | `self-referential — verify via git commit hash` | Breaker CLEAN → Certifier GO → Witness pending |
| 0 | `docs/SOLISFORGE-v1.5-GENERIC-REFERENCE.md` | `c1805f70bf875d3126a4805e2eecb2af3fcfa29f86cbbbc463f9803e4e9fb001` | Governing constitution (reference artifact) |
| 1 | `PHASE_1_FAILURE_MODE_ATLAS.md` | `00fd30979371155cafa12af0103585f1c74080c6c91485944eb8dcf1079bc2ad` | Breaker CLEAN → Certifier GO → Witness 100/100 |
| 2 | `PHASE_2_CONTRACT_SPECIFICATION.md` | `d06d268f555f50d1b27bf42f4ddf1ca7add12810c6979571e8143c86ce80d8ff` | Bounded Admission — 3 P1 findings remediated, re-Breaker pending |

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

## Severity Taxonomy

| Severity | Definition | Blocking Behavior |
|----------|-----------|-------------------|
| **P0** | System cannot function, security breach, contract violation | Blocks ALL progression |
| **P1** | Violates governing contract, gap causing failure at next phase | Blocks phase exit |
| **P2** | Quality concern, performance, spec gap | Fix before ratification (Phase 9) |
| **P3** | Documentation, cosmetic | Fix before ratification |

---

## Rules

1. No artifact advances past Bounded Admission without SHA-256 recorded here.
2. Breaker/Certifier/Witness verdicts are logged per-phase before the next phase opens.
3. Any hash mismatch between this ledger and the file on disk is a blocking finding.
4. This file is the single source of truth for Forge pipeline state.
5. All pipeline roles (Builder, Breaker, Certifier, Witness, Independent Test Writer) are dispatched as independent sub-agents with A-27 standing orders. No inline execution by Orchestrator.
