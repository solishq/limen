# Limen v5 — Phase 3 Design Source

**Version:** 1.0.0 (Rebuilt May 7, 2026)
**Status:** RATIFIED (May 6, 2026)
**Authority:** Founder (Lanre Osibodu)
**Governing Doctrine:** SolisHQ CDM v2.1 + Contract Compliance v2.1

---

## 1. Executive Summary

**Phase 3** delivers the **enterprise-grade framework adapters** and **compliance infrastructure** that make Limen the governed memory layer for serious agentic systems.

**Scope:**
- 4 Framework Adapters: CrewAI, AutoGen, Semantic Kernel, LlamaIndex
- Enterprise Compliance Pack (SOC 2, ISO 27001, FedRAMP evidence primitives)
- Multi-tenant deployment governance
- Full integration with Phase X contracts

**Status:**
- Phase 3 Design Source — **RATIFIED** (May 6, 2026)
- Phase X Loopback — **RATIFIED** (AgentFramework extended 6 -> 10 values)
- CrewAI Adapter Contract — **RATIFIED** (Final Breaker: CLEAN, 25/25 findings resolved)

---

## 2. Contract Entry Criteria

**Phase 3 contract specification is AUTHORIZED.**

**Implementation is BLOCKED until:**
1. Phase X Loopback complete (AgentFramework enum extension, manifest/hash/HB-37/HB-38 update, AdapterReadiness parity, TimeProvider projection)
2. Each contract passes TBS Max Breaker + Certifier + Witness 10/10
3. Founder ratification of each contract

**Current Status:** Phase X Loopback is RATIFIED. CrewAI contract is production-ready. Implementation can begin after CrewAI Certifier GO.

---

## 3. Scope & Boundaries

### 3.1 In Scope
- 4 Framework Adapters (CrewAI, AutoGen, Semantic Kernel, LlamaIndex)
- Enterprise Compliance Pack (SOC 2 / ISO 27001 / FedRAMP evidence primitives)
- Multi-tenant deployment governance
- Full integration with Phase X contracts (governance, audit, token budget, refusal handling)

### 3.2 Out of Scope (Phase 4+)
- Additional framework adapters (beyond the 4 specified)
- Managed cloud service (Phase 4)
- Visual governance dashboard (Phase 4)
- Marketplace / plugin ecosystem (Phase 4)

### 3.3 Core Isolation (Non-Negotiable)
- Phase 3 adapters **MUST NOT** modify any v5 core file (v5 core lives on `release/v5` branch, not `main`)
- Adapters must fail closed with `CORE_PORT_UNAVAILABLE` when required v5 ports are missing
- All v5 dependencies are **read-only** (immutable inputs sourced from `release/v5`)

---

## 4. Phase X Integration Requirements

### 4.1 AgentFramework Extension (RATIFIED)
The `AgentFramework` enum has been extended from 6 -> 10 values:
- 6 existing framework values (see SHARED_TYPES.md)
- `crew_ai`, `auto_gen`, `semantic_kernel`, `llama_index` (new -- Phase 3)

### 4.2 Manifest / Hash / HB-37/HB-38 (RATIFIED)
- `phase-x.contracts.json` manifest updated
- HB-37 (defense-set monotonicity) extended
- HB-38 (LCI closure) extended
- All hashes verified

### 4.3 AdapterReadiness Parity
All Phase 3 adapters must implement the canonical `AdapterReadiness` / `AdapterLifecycleState` projection from Phase X.

### 4.4 TimeProvider Projection
All temporal logic must use the Phase X `TimeProvider` interface (no wall-clock injection).

---

## 5. Governance & Refusal (Non-Optionality)

### 5.1 Governance Non-Optionality
- `governed: true` is the **default** for all Phase 3 adapters
- Governance evaluation must be **authorization-first** (before token budget, before any side effect)
- There is no `governed:false` bypass path. All adapters enforce governance unconditionally

### 5.2 Refusal Handling
- All refusals must return typed `RefusalError` with:
  - `reasonCode` (GOVERNANCE_REFUSAL, BUDGET_EXCEEDED, TIME_PROVIDER_UNAVAILABLE, etc.)
  - `traceId` (for audit correlation)
  - `retryable` (boolean)
- Refusals must be **audited** before returning to caller

### 5.3 Audit-before-Success
No successful side effect may be returned before the required durable audit path exists (per Phase X audit closure invariant).

---

## 6. Token Budget Enforcement

### 6.1 TokenEstimator Integration
All recall/RAG/context operations must use Phase X `TokenEstimator` before execution.

### 6.2 Budget Ceilings
- Per-operation max (configurable per tenant)
- Per-session max (configurable per tenant)
- Both ceilings must be enforced; neither can be bypassed

### 6.3 BUDGET_EXCEEDED Behavior
- Operation must fail closed (no partial results that bypass governance)
- Audit entry must be written for every budget failure
- Caller must receive typed `BUDGET_EXCEEDED` error with `retryable: false`

---

## 7. Lifecycle & State Machine

### 7.1 5-State Lifecycle
All Phase 3 adapters must implement the canonical 5-state lifecycle:
1. `UNINITIALIZED`
2. `INITIALIZING`
3. `READY`
4. `DEGRADED`
5. `SHUTDOWN`

### 7.2 Post-READY Baseline Port Loss
If a required v5 port becomes unavailable after `READY`:
- Adapter must transition to `DEGRADED` (not `BLOCKED_DEPENDENCY`)
- `DEGRADED` reads must be clearly marked as potentially stale
- No mutation operations permitted in `DEGRADED` state

### 7.3 DEGRADED Recovery
- Adapters must expose `healthCheck()` for recovery detection
- Recovery exhaustion must have a documented caller escape path (fail closed, not infinite retry)

---

## 8. Error Taxonomy (Canonical)

All Phase 3 adapters must use the canonical error taxonomy from `AGENT_ADAPTER_ARCHITECTURE.md` v2.3.0 with deterministic precedence. Adapter-specific extensions (additional error codes beyond the base set) are permitted provided they follow the precedence rules defined in their individual contracts. The base precedence order is defined in each adapter contract's Error Taxonomy section (e.g., CrewAI Adapter Contract §6.2).

---

## 9. Test Requirements (Minimum)

### 9.1 Parent-Mandated Tests (from Phase X)
- TC-01: Idempotent init (multiple initialize calls = no-op success)
- TC-02: Unknown tool error handling
- TC-03: Session lifecycle (create -> use -> end)
- TC-04: Event bridge (native -> Limen -> native)
- TC-05: Sandbox expansion (tool allow-list)
- TC-06: Governed:false rejection (explicit config only)
- TC-07: Client error propagation
- TC-08: Rate limit inheritance
- TC-09: Dual projection parity (TS <-> Rust)
- TC-10: Manual conflict resolution
- TC-11: Delegation depth enforcement
- TC-12: Consent gate enforcement

### 9.2 CrewAI-Specific Hostile Tests
- TC-13: CrewAI tool hook payload translation
- TC-14: CrewAI `BaseTool` / `args_schema` integration
- TC-15: CrewAI tool call with governance refusal
- TC-16: CrewAI tool call with budget exceeded
- TC-17: CrewAI session timeout handling
- TC-18: CrewAI concurrent tool calls (rate limit)
- TC-19: CrewAI error translation (CrewAI error -> Limen error)
- TC-20: CrewAI `governed:false` bypass attempt (must be rejected)

---

## 10. Verification Criteria (Certifier Gate)

Before any Phase 3 contract can proceed to implementation:

- [ ] All parent-mandated tests (TC-01 through TC-12) are present
- [ ] All adapter-specific hostile tests (TC-13 through TC-20 for CrewAI) are present
- [ ] Governance is non-optional and authorization-first
- [ ] Token budget enforcement is complete (both ceilings, no bypass)
- [ ] Audit-before-success is enforced
- [ ] Error precedence is deterministic and matches Phase 3 Design Source
- [ ] Lifecycle state machine is complete (5 states, DEGRADED behavior, post-READY port loss)
- [ ] Canonical `AgentAdapter` conformance is verified
- [ ] No P0 or P1 findings remain (P2/P3 acceptable with documented mitigation)

---

## 11. Phase 3 Sequencing (Recommended Order)

1. **CrewAI Adapter** (highest priority / lowest complexity -- START HERE)
2. **AutoGen Adapter**
3. **Semantic Kernel Adapter**
4. **LlamaIndex Adapter**
5. **Enterprise Compliance Pack** (after all 4 adapters)
6. **Phase 3 Final Integration & Testing**
7. **Phase 3 Closure** (Final Certifier + Founder Ratification)

---

## 12. Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Workspace dependency mismatch (parent versions) | HIGH | Integrate ratified Phase X loopback files before certification |
| Governance bypass via `governed:false` | HIGH | Enforce non-optional governance + explicit auditable config only |
| Token budget bypass | HIGH | Enforce both per-operation and per-session ceilings; no bypass paths |
| Audit-before-success violation | HIGH | Enforce audit path before any successful side effect |
| Post-READY port loss unhandled | MEDIUM | Explicit DEGRADED state + healthCheck() + caller escape path |
| CrewAI SDK version drift | MEDIUM | Version-pin CrewAI SDK + docs in contract; update on breaking changes |

---

## 13. Continuity Note (May 7, 2026)

**Lost Files (Worktree Deletion + Filter-Repo):**
- Original Phase 3 Design Source (this document is a rebuild)
- Original Phase X Loopback Execution Plan (rebuilt in separate document)

**Recovery:**
- Rebuilt from preserved Phase X contracts + CrewAI contract + conversation history
- All architecture decisions preserved in contracts
- No functional loss -- only planning documents were affected

**Lesson:**
- Never delete worktrees or branches containing planning documents without first merging to main
- All critical planning documents should be committed to main branch, not worktree-only

---

**END OF PHASE 3 DESIGN SOURCE (REBUILT)**
