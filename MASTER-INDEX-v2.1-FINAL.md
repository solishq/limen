<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# internal-OS Master Index v2.1-FINAL

**Status:** Active canonical index
**Governing:** SolisForge Protocol v1.4 — Sole Governing Doctrine [HISTORICAL: CDM v2.1 + Contract Compliance v2.1 — superseded per SolisForge §2]
**Rule:** This index is the canonical entrypoint for adopted contracts and continuity artifacts. Indexed contract families may not be implemented from stale, unindexed, or hash-mismatched files.

## 1. Doctrine Anchors

| Path | Role | Version | Canonical Owner | Hash | Dependency Direction | LCI Note |
|------|------|---------|-----------------|------|----------------------|----------|
| `SolisForge Protocol v1.4` | Sole governing doctrine | 1.4 | SolisHQ Engineering Authority | `RATIFIED-2026-05-08` | Upstream of all artifacts, contracts, and enforcement gates | Supersedes Premier Engineering Standard v2.2 and CDM v2.1. Absorbs all prior mechanisms per §2.1 Disposition Table. |
| `contracts/LIMEN_V5_INTEGRATION_CONTRACT.md` | Limen v5 convergence contract | 1.0.0 | Forge Critical Authority | `cf123370f3357e5597fa4fd0ade2849fcf879ff3d02cfcba51c5a8de3629710a` | Upstream of all file compliance and validation | Declares SolisForge v1.4 sole governance, baseline freeze f4ead70, installs validation tools. |
| `CONTRACT-COMPLIANCE-v2.1.md` | Contract compliance doctrine [HISTORICAL — superseded by SolisForge v1.4] | 2.1 | SolisHQ CDM Authority | `b1ba24df1b6ab9bd04e21adc0e7b46aec3eb6d56e7dd2f98d2a62520646f52a8` | HISTORICAL — mechanisms absorbed into SolisForge §9 | Preserves Contract-First Discipline, HB-37, HB-38, LCI closure, and Zero-Orphan rules — all now enforced via SolisForge. |

## 2. Phase X -- AI Agent Integration Layer

**Family status:** Canonical contract family
**Source branch:** `phase-x-remediation`
**Clean commit:** `5fdbf68`
**Target integration branch:** `integrate/phase-x-contracts`
**Compliance authority:** `contracts/phase-x.contracts.json`
**LCI note:** `tau_PhaseX = CanonicalTypes ∩ CorePermissionMapping ∩ GovernanceGate ∩ ConsentGate ∩ AuditPath ∩ EventBus ∩ RateLimit ∩ TokenEstimator ∩ SearchGate ∩ CoordinationGate ∩ OutputGate ∩ LifecycleState`

### 2.1 Compliance Authority

| Path | Role | Version | Canonical Owner | Hash | Dependency Direction | LCI Note |
|------|------|---------|-----------------|------|----------------------|----------|
| `contracts/phase-x.contracts.json` | Machine-readable Phase X compliance authority | manifest 1.0.0 | Phase X Contract Authority | `22e6527726dbc4b0247a39720d142b0c83ba83bea2b0f6ec5f4d8d17c7c9baa0` | Upstream of Phase X hash verification, HB-37/HB-38 proof, and LCI closure | Records versioned list, hashes, defense sets, monotonicity proof, LCI assertion, and closure proof. |

### 2.2 Prompt-Required Core Phase X Files

| Path | Role | Version | Canonical Owner | Hash | Dependency Direction | LCI Note |
|------|------|---------|-----------------|------|----------------------|----------|
| `contracts/SHARED_TYPES.md` | Canonical shared type registry | 1.4.1 | Phase X Shared Types Authority | `d5ee1d695ebb098ac3606592a090e6b5f4996d064e766468e19ab21845dd1451` | Upstream of every Phase X contract | CanonicalTypes source; no parallel shared-type registry allowed. |
| `contracts/AGENT_MEMORY_BRIDGE.md` | Universal agent-to-Limen memory bridge | 1.3.1 | Phase X Contract Authority | `a09dd37f1c36779c8b8c9dbbc3403ef1e15b3dff26d1fca70bdaeabf670bb1a2` | Depends on shared types; consumed by adapters, context, and intelligence surfaces | GovernanceGate, ConsentGate, AuditPath for memory operations. |
| `contracts/COMPUTER_USE_GOVERNANCE.md` | Computer action governance, refusal, and audit | 2.2.0 | Phase X Contract Authority | `9ecef56cc89382b01cb4d0e85df94bd889af935116ed2be8b7306db8bb77fac3` | Depends on shared types; upstream of execution and adapter action gates | GovernanceGate and refusal/audit closure for computer actions. |
| `contracts/AUDIT_VISUALIZATION_SCHEMA.md` | Audit log and visualization schema | 1.2.0 | Phase X Contract Authority | `47efcadac4b1c99628e32c25f0832329f58360969aea66f04daaaa9aa6bc0ab7` | Depends on shared types and append-only audit chain | AuditPath and visualization derivation from hash-chained audit entries. |
| `contracts/AGENT_ADAPTER_ARCHITECTURE.md` | Pluggable adapter architecture | 2.3.0 | Phase X Contract Authority | `11bf198a7ae7c142d58a17da34807657a99ab3bad050f7f4aaf9b53453e2261d` | Depends on shared types, memory bridge, and computer use governance | Adapter actions translate into canonical types before governance and audit. |
| `contracts/AGENT_INTELLIGENCE_BRIDGE.md` | Technique learning and cognitive health bridge | 1.2.0 | Phase X Contract Authority | `bdb9ee6d2b0d47cb9802a7b23206eccf0c3ec46f17224a12454222c73c63599b` | Depends on shared types, memory bridge, TGP, Cognitive Engine, CCP, and FSRS | Intelligence operations remain inside governed claim and technique boundaries. |
| `contracts/AGENT_EXECUTION_GOVERNANCE.md` | Mission lifecycle, orchestration, budget governance, and scheduling | 1.2.1 | Phase X Contract Authority | `fc3ab621bb3a4bbeb73befbb44022c76951934cdc5e3d0b708f56921f72fb06a` | Depends on shared types, lifecycle, governance, rate limits, and audit | RateLimit, AuditPath, and budget governance for mission execution. |
| `contracts/AGENT_CONTEXT_GOVERNANCE.md` | Context budget and working memory governance | 1.2.2 | Phase X Contract Authority | `16734eac3539e5c36a14ce6cf30cb4229e55c55443aa55604fb832ffb9a90460` | Depends on shared types, memory bridge, TokenEstimator, and audit | TokenEstimator and context boundary closure. |
| `contracts/AGENT_LIFECYCLE_MANAGEMENT.md` | Agent registration, trust, consent, and knowledge exchange | 1.3.0 | Phase X Contract Authority | `c08b987f496ccdab1e6a78c67a974ad1eb740cb42ec99d1578b87e6a9d65552d` | Depends on shared types; upstream of adapter binding and session lifecycle | LifecycleState, ConsentGate, and trust/capability closure. |
| `docs/PHASE_X_ARCHITECTURE_OVERVIEW.md` | Phase X architecture overview | 1.3.0 | Phase X Contract Authority | `32bded9d0e5cb3b90278b5081bff0a74e4e0d6bea5cfb68142c7d5d8c5035676` | Descriptive overview; downstream of ratified Phase X contracts | Architecture summary must not override indexed contract text. |

### 2.3 Additional Manifest-Listed Phase X Contracts

| Path | Role | Version | Canonical Owner | Hash | Dependency Direction | LCI Note |
|------|------|---------|-----------------|------|----------------------|----------|
| `contracts/AGENT_SEARCH_GOVERNANCE.md` | Search, embedding, duplicate detection, and hybrid ranking governance | 1.0.0 | Phase X Contract Authority | `bfb41cafce2d1f506f7cc3abf957c0828d4f110b5372e27d2290d69862a20cd5` | Depends on shared types, memory bridge, clearance, consent, and audit | SearchGate closure; no direct store bypass. |
| `contracts/AGENT_COORDINATION_GOVERNANCE.md` | A2A, fork, sync, peer merge, and replay verification governance | 1.0.0 | Phase X Contract Authority | `af8bcfe0e06660f37ae2ab658fdcc60b5ddd14f5797ac414bc722e284ba81fc2` | Depends on shared types, lifecycle identity, event bus, and audit | CoordinationGate closure across agent boundaries. |
| `contracts/AGENT_OUTPUT_GOVERNANCE.md` | Output primitives, telemetry, structured inference, plugin, and hook governance | 1.0.0 | Phase X Contract Authority | `6c13d904839aa4eca2362c6ef11af33c17b934309324e7f690621ca8fa65794f` | Depends on shared types, CCP, governance, audit, and isolation boundaries | OutputGate closure before externalized agent artifacts. |
| `contracts/CREWAI_ADAPTER_CONTRACT.md` | CrewAI framework adapter for Limen governance substrate | 1.0.0 | Phase X Contract Authority | `4f1e58879e0a61ba8a6fee5751f930a498f3f617e96640cb4f669e21ea0a8312` | Depends on shared types, adapter architecture, and lifecycle management | Phase 3 CrewAI adapter; Breaker CLEAN — Pending Certifier & Witness. |

## 3. Phase X Continuity Artifacts

| Path | Role | Version | Canonical Owner | Hash | Dependency Direction | LCI Note |
|------|------|---------|-----------------|------|----------------------|----------|
| `docs/continuity/PHASE_X_INTEGRATION_PLAN.md` | Phase X integration execution plan | 1.0 | Phase X Contract Authority | `cc03b2506a4543c01ebe8da47af950a65a7944f1763c70108d573b1afb87962d` | Downstream of CLEAN remediation; upstream of integration PR execution | Preserves merge strategy, documentation updates, checklist, PR guidance, and mitigations. |
| `docs/continuity/PHASE_X_HANDOFF.md` | Phase X continuity handoff | 1.0 | Phase X Contract Authority | `285e94fcaee426f33cc2ae11fd960cf389c4520bda5d840e8ba629da38f3ebfe` | Downstream of Master Index and compliance adoption; upstream of implementation inheritance | Preserves source branch, clean commit, adopted contracts, implementation order, non-goals, and certification evidence. |
| `docs/continuity/PHASE_X_READY_FOR_PR.md` | Phase X final pre-PR verification and readiness package | 1.0 | Phase X Contract Authority | `25bd3204bc87a8d0f5700b383f70c94a510bfea6646af02968358b4c89acdb0e` | Downstream of integration plan and handoff; upstream of PR creation | Preserves final checklist, copy-paste PR description, and ready-for-PR summary. |

## 4. Adoption Rules

1. Existing v2.1 contract references and enforcement mechanisms MUST NOT be removed, weakened, or bypassed by Phase X adoption.
2. Phase X implementation MUST consume indexed versions and hashes from this Master Index and `contracts/phase-x.contracts.json`.
3. Any Phase X interface change MUST update the owning contract, manifest hash, Master Index entry, LCI assertion if affected, and Breaker/CLEAN evidence.
4. No downstream implementation may reference a Phase X interface unless this index points to the same canonical version and hash.
