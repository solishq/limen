# internal-OS Master Index v2.1-FINAL

**Status:** Active canonical index
**Governing:** CDM v2.1 + Contract Compliance v2.1
**Rule:** This index is the canonical entrypoint for adopted internal-OS contracts and continuity artifacts. Indexed contract families may not be implemented from stale, unindexed, or hash-mismatched files.

## 1. Doctrine Anchors

| Path | Role | Version | Canonical Owner | Hash | Dependency Direction | LCI Note |
|------|------|---------|-----------------|------|----------------------|----------|
| `CONTRACT-COMPLIANCE-v2.1.md` | Contract compliance doctrine | 2.1 | SolisHQ CDM Authority | `2f53b85b3800c303a79b603205ec3de32c5c6a8ae7ed9189ae32341041a2b45f` | Upstream of all contract-family adoption gates | Preserves Contract-First Discipline, HB-37, HB-38, LCI closure, and Zero-Orphan rules. |

## 2. Phase X -- AI Agent Integration Layer

**Family status:** Canonical contract family
**Source branch:** `phase-x-remediation`
**Clean commit:** `5fdbf68`
**Target integration branch:** `integrate/phase-x-contracts`
**Compliance authority:** `contracts/phase-x.contracts.json`
**LCI note:** `tau_PhaseX = CanonicalTypes ∩ GovernanceGate ∩ ConsentGate ∩ AuditPath ∩ EventBus ∩ RateLimit ∩ TokenEstimator ∩ LifecycleState`

### 2.1 Compliance Authority

| Path | Role | Version | Canonical Owner | Hash | Dependency Direction | LCI Note |
|------|------|---------|-----------------|------|----------------------|----------|
| `contracts/phase-x.contracts.json` | Machine-readable Phase X compliance authority | manifest 1.0.0 | Phase X Contract Authority | `bf788934c36fac46414191cd42bbf82553296a39c8f76e3b660e3c21728afa1c` | Upstream of Phase X hash verification, HB-37/HB-38 proof, and LCI closure | Records versioned list, hashes, defense sets, monotonicity proof, LCI assertion, and closure proof. |

### 2.2 Prompt-Required Core Phase X Files

| Path | Role | Version | Canonical Owner | Hash | Dependency Direction | LCI Note |
|------|------|---------|-----------------|------|----------------------|----------|
| `contracts/SHARED_TYPES.md` | Canonical shared type registry | 1.4.1 | Phase X Shared Types Authority | `1158992f413e2e1653432fe22b0d39a494117af600257570595c40113cbd3b3f` | Upstream of every Phase X contract | CanonicalTypes source; no parallel shared-type registry allowed. |
| `contracts/AGENT_MEMORY_BRIDGE.md` | Universal agent-to-Limen memory bridge | 1.3.1 | Phase X Contract Authority | `c761bc31588b5ffe8de782241353e99a5137cb7c8cebc808d4cc1136de68e186` | Depends on shared types; consumed by adapters, context, and intelligence surfaces | GovernanceGate, ConsentGate, AuditPath for memory operations. |
| `contracts/COMPUTER_USE_GOVERNANCE.md` | Computer action governance, refusal, and audit | 2.2.0 | Phase X Contract Authority | `4fc9cea15f7201ebf96df9f5fc86197763d754655d053246f39bdf1f0a16dea3` | Depends on shared types; upstream of execution and adapter action gates | GovernanceGate and refusal/audit closure for computer actions. |
| `contracts/AUDIT_VISUALIZATION_SCHEMA.md` | Audit log and visualization schema | 1.2.0 | Phase X Contract Authority | `4aeb64cd2c61532643a8e84f375cf8237be5d243b8b5de9a6a5460da1836b322` | Depends on shared types and append-only audit chain | AuditPath and visualization derivation from hash-chained audit entries. |
| `contracts/AGENT_ADAPTER_ARCHITECTURE.md` | Pluggable adapter architecture | 2.3.0 | Phase X Contract Authority | `a3c5fc11915b5baec864ea39aa90f501fc96c40810e54574e0a487c57ae02b5e` | Depends on shared types, memory bridge, and computer use governance | Adapter actions translate into canonical types before governance and audit. |
| `contracts/AGENT_INTELLIGENCE_BRIDGE.md` | Technique learning and cognitive health bridge | 1.2.0 | Phase X Contract Authority | `34a0bb0d06cf77758d62b23de8ed4a1ad3b2b47d8b09eadcbb332d3354338c1d` | Depends on shared types, memory bridge, TGP, Cognitive Engine, CCP, and FSRS | Intelligence operations remain inside governed claim and technique boundaries. |
| `contracts/AGENT_EXECUTION_GOVERNANCE.md` | Mission lifecycle, orchestration, budget governance, and scheduling | 1.2.1 | Phase X Contract Authority | `e01815604f8705b36655ea05f37b10dd2629ab65edc9d4a0817064acaa3464d0` | Depends on shared types, lifecycle, governance, rate limits, and audit | RateLimit, AuditPath, and budget governance for mission execution. |
| `contracts/AGENT_CONTEXT_GOVERNANCE.md` | Context budget and working memory governance | 1.2.2 | Phase X Contract Authority | `1e60d5905022cb8a31d4bbe5ed2d0984f5c443b5f5d1353fde80f7f0c4db0aa0` | Depends on shared types, memory bridge, TokenEstimator, and audit | TokenEstimator and context boundary closure. |
| `contracts/AGENT_LIFECYCLE_MANAGEMENT.md` | Agent registration, trust, consent, and knowledge exchange | 1.3.0 | Phase X Contract Authority | `bab7eaf100d9bbc937829f64e0097099024f6481403d5fd14682a817b113ad68` | Depends on shared types; upstream of adapter binding and session lifecycle | LifecycleState, ConsentGate, and trust/capability closure. |
| `docs/PHASE_X_ARCHITECTURE_OVERVIEW.md` | Phase X architecture overview | 1.3.0 | Phase X Contract Authority | `7292b247d518e1435a1432c1b974d48b38cfe9fccd06ba26d9d189701c92e2bb` | Descriptive overview; downstream of ratified Phase X contracts | Architecture summary must not override indexed contract text. |

### 2.3 Additional Manifest-Listed Phase X Contracts

| Path | Role | Version | Canonical Owner | Hash | Dependency Direction | LCI Note |
|------|------|---------|-----------------|------|----------------------|----------|
| `contracts/AGENT_SEARCH_GOVERNANCE.md` | Search, embedding, duplicate detection, and hybrid ranking governance | 1.0.0 | Phase X Contract Authority | `bbda03be7b5f5005d0f706262e9c51a25aee6c2c9dfc17e5e2c8d10a80f74213` | Depends on shared types, memory bridge, clearance, consent, and audit | SearchGate closure; no direct store bypass. |
| `contracts/AGENT_COORDINATION_GOVERNANCE.md` | A2A, fork, sync, peer merge, and replay verification governance | 1.0.0 | Phase X Contract Authority | `769083f1f98a2c3cf836f47bb54a920390fee13a383ef2a3bc2b8d290ec6199f` | Depends on shared types, lifecycle identity, event bus, and audit | CoordinationGate closure across agent boundaries. |
| `contracts/AGENT_OUTPUT_GOVERNANCE.md` | Output primitives, telemetry, structured inference, plugin, and hook governance | 1.0.0 | Phase X Contract Authority | `b330de27349ecf386631142d13db18ccf2bc26eea1e22c2a56d8d29eb4ab581d` | Depends on shared types, CCP, governance, audit, and isolation boundaries | OutputGate closure before externalized agent artifacts. |
| `contracts/CREWAI_ADAPTER_CONTRACT.md` | CrewAI framework adapter for Limen governance substrate | 1.0.0 | Phase X Contract Authority | `ec9f5f16669bc8f9fae45593f646c6414ec7d7df54555b2c6a4cfb1699fc7728` | Depends on shared types, adapter architecture, and lifecycle management | Phase 3 CrewAI adapter; Breaker CLEAN — Pending Certifier & Witness. |

## 3. Phase X Continuity Artifacts

| Path | Role | Version | Canonical Owner | Hash | Dependency Direction | LCI Note |
|------|------|---------|-----------------|------|----------------------|----------|
| `docs/continuity/PHASE_X_INTEGRATION_PLAN.md` | Phase X integration execution plan | 1.0 | Phase X Contract Authority | `f05ce2c4c78f1b86dc681cd556c298063c201eeb145b8f400d6f343603d4f05c` | Downstream of CLEAN remediation; upstream of integration PR execution | Preserves merge strategy, documentation updates, checklist, PR guidance, and mitigations. |
| `docs/continuity/PHASE_X_HANDOFF.md` | Phase X continuity handoff | 1.0 | Phase X Contract Authority | `d5df33a8a973edeca48afe610e3b74d532b01da2e90b5cc8d8bcc52bc6c5cb95` | Downstream of Master Index and compliance adoption; upstream of implementation inheritance | Preserves source branch, clean commit, adopted contracts, implementation order, non-goals, and certification evidence. |
| `docs/continuity/PHASE_X_READY_FOR_PR.md` | Phase X final pre-PR verification and readiness package | 1.0 | Phase X Contract Authority | `f888cb638def14b68893062bc84ea2a5877e2190db45bc70c0fba4c91e02b14b` | Downstream of integration plan and handoff; upstream of PR creation | Preserves final checklist, copy-paste PR description, and ready-for-PR summary. |

## 4. Adoption Rules

1. Existing v2.1 contract references and enforcement mechanisms MUST NOT be removed, weakened, or bypassed by Phase X adoption.
2. Phase X implementation MUST consume indexed versions and hashes from this Master Index and `contracts/phase-x.contracts.json`.
3. Any Phase X interface change MUST update the owning contract, manifest hash, Master Index entry, LCI assertion if affected, and Breaker/CLEAN evidence.
4. No downstream implementation may reference a Phase X interface unless this index points to the same canonical version and hash.
