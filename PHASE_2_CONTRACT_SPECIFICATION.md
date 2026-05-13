# PHASE_2_CONTRACT_SPECIFICATION.md

**Contract Specification** (SolisForge v1.5 — Phase 2, Ratified)

**Core Interfaces & Boundaries** (every boundary explicit, per SolisForge §2)

## 1. LimenAgentClient (Primary Agent Interface)
- `remember(claim: Claim, context: Context) -> Provenance`
- `recall(query: Query, context: Context) -> (Beliefs, Provenance)`
- `act(action: Action, context: Context) -> (Result, Provenance)`
- All calls enforce: consent gate, classification filter, refusal provenance, hash-chain audit.

## 2. AdapterRegistry (Framework Integration)
- `register(framework: string, adapter: Adapter) -> void`
- `dispatch(framework: string, call: Call) -> Result`
- Zero core changes required. Thin registration only.

## 3. Core Governance Calls (Internal)
- `enforce_consent(claim: Claim) -> ConsentDecision`
- `classify(claim: Claim) -> Classification`
- `compute_decay(belief: Belief) -> Confidence`
- `generate_refusal(action: Action) -> RefusalProvenance`
- `append_audit(event: Event) -> HashChain`

## 4. Computer-Use Sandbox
- `execute_tool(tool: ToolCall, sandbox: Sandbox) -> (Result, Provenance)`
- Mandatory provenance + refusal on high-risk actions.

## 5. Key Data Types
- `Claim` = {content: string, confidence: float, timestamp: ISO8601, source: string}
- `Belief` = {claim: Claim, decay: FSRS, confidence: float, provenance: Hash[]}
- `Provenance` = {hash: string, parent: Hash | null, timestamp: ISO8601, actor: string}
- `ConsentDecision` = {approved: bool, reason: string, expires: ISO8601}

## 6. Ratified Contracts (14 total, from MASTER-INDEX-v2.2-FINAL.md)
All 14 contracts remain in force and are referenced here:
- AGENT_MEMORY_BRIDGE.md
- REFUSAL_PROVENANCE.md
- CONSENT_GATE.md
- CLASSIFICATION_FILTER.md
- FSRS_DECAY.md
- ADAPTER_REGISTRY.md
- COMPUTER_USE_SANDBOX.md
- AUDIT_CHAIN.md
- NONAUTHORITATIVE_BRANCHING.md
- SELF_HEALING_CASCADE.md
- MULTI_AGENT_COORDINATION.md
- OPEN_SOURCE_GOVERNANCE.md
- ENTERPRISE_MONETIZATION.md
- TEST_STAND.md

**Invariants enforced by these contracts:**
- Every call routes through governed Core (no bypass).
- Decay computed on every read.
- Consent + classification + refusal are mandatory.
- AdapterRegistry is thin.
- Audit chain is immutable.

**Ratified by:** Lanre — "approved"  
**Date:** May 13, 2026  
**SolisForge Phase:** 2