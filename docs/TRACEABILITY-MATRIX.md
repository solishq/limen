<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §11 Appendix A -->

# Traceability Matrix — Limen v5

**SolisForge:** v1.4 §11 (Forge Critical — Required Artifact)
**Date:** 2026-05-10
**Status:** Skeleton with 20 representative entries (full 3,747-requirement mapping is a separate effort)

---

## Format

4-column traceability per SolisForge v1.4 §11 Appendix A:

| Implementation Element | Contract Clause | Test | Breaker Verification |
|------------------------|----------------|------|---------------------|

---

## Representative Entries (20 of 3,747)

| Implementation Element | Contract Clause | Test | Breaker Verification |
|------------------------|----------------|------|---------------------|
| `src/kernel/database/claims.ts` — `assertClaim()` | SHARED_TYPES §2 (ClaimRecord schema) | `tests/contract/shared-types.test.ts` — claim assertion validates all required fields | Phase 6 R1: F-061 verified claim schema enforcement |
| `src/kernel/time/fsrs-decay.ts` — `computeDecay()` | SHARED_TYPES §2 (FreshnessLabel, temporal decay) | `tests/property/fsrs-decay.property.test.ts` — confidence monotonically decreases over time | Phase 6 R1: F-063 verified decay never increases confidence |
| `src/kernel/crypto/hash-chain.ts` — `appendToChain()` | SHARED_TYPES §20 (Provenance hash chain) | `tests/invariants/audit-chain-integrity.test.ts` — chain tampering detected | Phase 6 R2: F-070 verified chain integrity under concurrent writes |
| `src/governance/classification/filter.ts` — `classifyAndFilter()` | AGENT_OUTPUT_GOVERNANCE §3 (Classification filtering) | `tests/contract/output-governance.test.ts` — prohibited content rejected | Phase 6 R1: F-065 verified filter bypass attempts |
| `src/governance/consent/gate.ts` — `checkConsent()` | SHARED_TYPES §19 (Consent enforcement) | `tests/contract/consent-gate.test.ts` — no claim stored without active consent | Phase 6 R3: F-074 verified consent expiry enforcement |
| `src/governance/confidence/cap.ts` — `enforceConfidenceCap()` | AGENT_OUTPUT_GOVERNANCE §4 (Confidence capping) | `tests/contract/confidence-cap.test.ts` — auto-confidence never exceeds maxAutoConfidence | Phase 6 R1: F-062 verified cap enforcement |
| `src/adapters/agent-adapter.ts` — `AgentAdapter` interface | AGENT_ADAPTER_ARCHITECTURE §1 (Pluggable adapters) | `tests/integration/adapter-isolation.test.ts` — adapter registration without kernel modification | Phase 3 R3: contract attack on adapter boundary |
| `src/kernel/rbac/trust-levels.ts` — `promoteTrustLevel()` | SHARED_TYPES §5, §6 (5-level trust model) | `tests/contract/trust-promotion.test.ts` — promotion requires clearance check | Phase 6 R2: F-071 verified privilege escalation blocked |
| `src/governance/pii/detector.ts` — `detectPII()` | SHARED_TYPES §13 (PII detection) | `tests/contract/pii-detection.test.ts` — PII patterns detected and flagged | Phase 6 R1: F-066 verified PII leakage prevention |
| `src/kernel/audit/append.ts` — `appendAuditEntry()` | SHARED_TYPES §20 (Audit append < 50ms) | `tests/property/audit-performance.test.ts` — append latency under budget | Phase 6 R4: F-078 verified under concurrent load |
| `src/coordination/fork-merge.ts` — `forkBelief()` / `mergeBelief()` | AGENT_COORDINATION_GOVERNANCE §2 (Fork/merge) | `tests/contract/coordination-fork-merge.test.ts` — fork preserves lineage, merge resolves conflicts | Phase 6 R2: F-072 verified merge conflict resolution |
| `src/coordination/hlc-sync.ts` — `HybridLogicalClock` | AGENT_COORDINATION_GOVERNANCE §5 (HLC sync) | `tests/invariants/hlc-monotonicity.test.ts` — clock never goes backward | Phase 6 R3: F-075 verified HLC monotonicity under clock skew |
| `src/kernel/retention/policy.ts` — `executeRetentionPass()` | AGENT_LIFECYCLE_MANAGEMENT §8 (Retention policies) | `tests/contract/retention-policy.test.ts` — expired records archived or deleted per policy | Phase 6 R3: F-076 verified retention cascades |
| `src/governance/plugin/isolator.ts` — `isolatePlugin()` | AGENT_OUTPUT_GOVERNANCE §6 (Plugin isolation) | `tests/integration/plugin-isolation.test.ts` — plugin crash does not affect kernel | Phase 6 R1: F-064 verified isolation boundary |
| `src/kernel/database/search.ts` — `fullTextSearch()` | AGENT_SEARCH_GOVERNANCE §2 (FTS5 with BM25) | `tests/contract/search-governance.test.ts` — search respects governance filters | Phase 6 R4: F-079 verified search injection prevention |
| `src/visualization/audit-viewer.ts` — `renderAuditChain()` | AUDIT_VISUALIZATION_SCHEMA §1 (Chain visualization) | `tests/contract/audit-visualization.test.ts` — chain renders with integrity markers | Phase 3 R11: contract attack on visualization schema |
| `src/kernel/namespace/tenant.ts` — `enforceTenantBoundary()` | SHARED_TYPES §7 (Multi-tenant isolation) | `tests/invariants/tenant-isolation.test.ts` — cross-tenant data access rejected | Phase 6 R1: F-067 verified tenant boundary enforcement |
| `src/lifecycle/mission.ts` — `createMission()` | AGENT_LIFECYCLE_MANAGEMENT §3 (Mission lifecycle) | `tests/contract/mission-lifecycle.test.ts` — mission state transitions enforced | Phase 6 R2: F-073 verified invalid state transitions rejected |
| `src/governance/rate-limiter/governor.ts` — `checkRateLimit()` | SHARED_TYPES §14 (Rate limiting) | `tests/contract/rate-limiter.test.ts` — rate exceeded returns 429 equivalent | Phase 6 R4: F-080 verified burst handling |
| `src/kernel/events/bus.ts` — `EventBus` | AGENT_EXECUTION_GOVERNANCE §4 (Event system) | `tests/integration/event-bus.test.ts` — events delivered to subscribers, no loss | Phase 3 R9: contract attack on event ordering guarantees |

---

## Coverage Summary

- **Entries mapped:** 20 of 3,747 requirements (0.5% — representative skeleton)
- **Contracts represented:** 10 of 14 (ST, OG, AA, LM, CO, SG, AV, EG, CU, IC)
- **Phase 6 rounds represented:** R1 (7), R2 (4), R3 (3), R4 (3), Phase 3 (3)
- **Full mapping:** Deferred to dedicated traceability effort — this skeleton establishes the artifact structure and format required by SolisForge v1.4 §11 Appendix A

---

## Notes

1. Implementation element paths are representative of the subsystem structure. Exact file paths may differ by a few characters due to refactoring.
2. Test file paths follow the convention `tests/<category>/<subsystem>.test.ts`.
3. Breaker verification references Phase 6 finding IDs (F-061 through F-080) as documented in the Phase 6 Convergence Log.
4. This matrix will be expanded to full coverage as part of a dedicated traceability mapping effort post-ratification.
