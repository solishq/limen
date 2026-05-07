# Phase X Handoff

**Status:** Canonical continuity handoff
**Governing:** CDM v2.1 + Contract Compliance v2.1
**Development branch:** `release/v5` (all v5 work; `main` is stable v4 baseline)
**Canonical merge:** `ee4b0df` (Phase X contracts merged to main)
**Certification state:** CLEAN per Phase X remediation context

## 1. Purpose

This handoff preserves continuity for adopting Phase X as a canonical contract family in the main internal-OS package. It exists to prevent orphaned Phase X files, stale implementation references, and ambiguity for future engineers or autonomous agents.

## 2. Adopted Contracts

| Path | Version | Role |
|------|---------|------|
| `contracts/SHARED_TYPES.md` | 1.3.0 | Canonical shared type registry for Phase X. |
| `contracts/AGENT_MEMORY_BRIDGE.md` | 1.3.1 | Universal agent-to-Limen memory interface. |
| `contracts/COMPUTER_USE_GOVERNANCE.md` | 2.2.0 | Governance, refusal, and audit for computer actions. |
| `contracts/AUDIT_VISUALIZATION_SCHEMA.md` | 1.2.0 | Audit log and visualization schema contract. |
| `contracts/AGENT_ADAPTER_ARCHITECTURE.md` | 2.2.0 | Pluggable adapter architecture for agent frameworks. |
| `contracts/AGENT_INTELLIGENCE_BRIDGE.md` | 1.2.0 | Technique learning, cognitive health, and self-healing bridge. |
| `contracts/AGENT_EXECUTION_GOVERNANCE.md` | 1.2.1 | Mission lifecycle, task orchestration, budget governance, and scheduling. |
| `contracts/AGENT_CONTEXT_GOVERNANCE.md` | 1.2.2 | Context budget management and working memory governance. |
| `contracts/AGENT_LIFECYCLE_MANAGEMENT.md` | 1.3.0 | Agent registration, capability evolution, consent governance, and knowledge exchange. |
| `docs/PHASE_X_ARCHITECTURE_OVERVIEW.md` | 1.3.0 | Architecture overview for the Phase X contract family. |
| `contracts/AGENT_SEARCH_GOVERNANCE.md` | 1.0.0 | Search, embedding, duplicate detection, and hybrid ranking governance. |
| `contracts/AGENT_COORDINATION_GOVERNANCE.md` | 1.0.0 | A2A governance, session fork, sync, merge, and replay verification. |
| `contracts/AGENT_OUTPUT_GOVERNANCE.md` | 1.0.0 | Output primitives, telemetry, structured inference, plugin, and hook governance. |

## 3. Implementation Order

1. Verify `contracts/phase-x.contracts.json` hashes against workspace contents.
2. Implement `contracts/SHARED_TYPES.md` first; it is the sole cross-contract type registry.
3. Implement lifecycle identity and session boundaries from `contracts/AGENT_LIFECYCLE_MANAGEMENT.md`.
4. Implement governance/audit foundations from `contracts/COMPUTER_USE_GOVERNANCE.md` and `contracts/AUDIT_VISUALIZATION_SCHEMA.md`.
5. Implement memory, context, search, intelligence, execution, coordination, and output surfaces only through their indexed contracts.
6. Implement adapter bindings from `contracts/AGENT_ADAPTER_ARCHITECTURE.md` after canonical types and governance gates are available.
7. Run Breaker verification on the merged branch before implementation begins.

## 4. Known Non-Goals

- No implementation code changes are authorized by this handoff alone.
- No weakening of existing v2.1 contracts or enforcement mechanisms is authorized.
- No replacement of `contracts/SHARED_TYPES.md` with local or parallel shared-type registries is authorized.
- No partial Phase X adoption is authorized.
- No downstream implementation may consume a Phase X interface from an unindexed or hash-mismatched file.

## 5. Certification Evidence

| Evidence | Required State |
|----------|----------------|
| Development branch | `release/v5` |
| Canonical merge | `ee4b0df` |
| Breaker state | CLEAN per provided Phase X remediation context |
| Compliance authority | `contracts/phase-x.contracts.json` |
| Master Index registration | `MASTER-INDEX-v2.1-FINAL.md` |
| Compliance doctrine update | `CONTRACT-COMPLIANCE-v2.1.md` |
| Continuity plan | `docs/continuity/PHASE_X_INTEGRATION_PLAN.md` |
| Continuity handoff | `docs/continuity/PHASE_X_HANDOFF.md` |

## 6. Continuity Notes

Future engineers MUST treat the Master Index as the canonical entrypoint, the manifest as the hash and monotonicity authority, and this handoff as the implementation inheritance record. Any conflict resolution during merge must be justified with LCI reasoning and must preserve HB-37 monotonicity.
