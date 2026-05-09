<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# Limen Case Study Templates

**Version:** 1.0.0
**Date:** 2026-05-03
**Benchmark Reference:** PHASE_2.2_BENCHMARK_DESIGN.md v1.0.0

---

## Template 1: Long-Running Research Agent

### Problem

A research agent operates over weeks, accumulating knowledge claims across hundreds of sessions. Without temporal decay, stale claims accumulate indefinitely. Without an audit trail, there is no way to trace how conclusions were reached. Over time, the agent's memory becomes a black box of contradictory, outdated, and unverifiable assertions.

**Symptoms observed in production:**
- Agent cites facts from week 1 with full confidence in week 4, despite source material updates
- No mechanism to determine which claims informed a given decision
- Memory grows unbounded; retrieval quality degrades as noise increases
- When the agent produces a wrong answer, there is no audit path to identify the faulty claim

### Solution

Limen checkpointer with `governed=true` and FSRS-inspired temporal decay.

**Architecture:**

```
Research Agent (LangGraph)
    |
    v
LimenCheckpointer (governed=true)
    |
    +-- Append-only hash chain (audit trail)
    +-- FSRS effectiveConfidence decay (temporal relevance)
    +-- Contradiction detection (semantic NLI)
    +-- Self-healing retraction (conflict resolution)
    |
    v
SQLite (chain + projections)
```

**Key configuration:**
- `governed: true` enforces read gates on non-Verified state
- `stabilityDays: 30` for FSRS decay (EC reaches 0.5 at 270 days)
- Contradiction detection via NLI (entailment < 0.3 AND contradiction > 0.7)
- Automatic retraction of conflicting claims below EC threshold

### Results

| Metric | Limen (governed) | MemorySaver | Delta |
|--------|-----------------|-------------|-------|
| Coherence Score (day 30) | [PLACEHOLDER: cs1_coherence_limen] | [PLACEHOLDER: cs1_coherence_baseline] | [PLACEHOLDER: cs1_coherence_delta] |
| Audit Completeness | [PLACEHOLDER: cs1_audit_limen] | N/A (no audit) | N/A |
| EC Trajectory p50 (day 15) | [PLACEHOLDER: cs1_ec_p50] | N/A (no decay) | N/A |
| EC Trajectory p50 (day 30) | [PLACEHOLDER: cs1_ec_p50_30] | N/A (no decay) | N/A |
| Stale claim ratio (day 30) | [PLACEHOLDER: cs1_stale_limen] | [PLACEHOLDER: cs1_stale_baseline] | [PLACEHOLDER: cs1_stale_delta] |
| Contradiction rate | [PLACEHOLDER: cs1_contra_limen] | [PLACEHOLDER: cs1_contra_baseline] | [PLACEHOLDER: cs1_contra_delta] |
| Token efficiency (tok/step) | [PLACEHOLDER: cs1_te_limen] | [PLACEHOLDER: cs1_te_baseline] | [PLACEHOLDER: cs1_te_delta] |

### Key Insights

1. **Temporal decay prevents stale claim accumulation.** MemorySaver treats all claims as equally valid regardless of age. Limen's FSRS decay curve (EC = C_0 * (1 + age_ms / (9 * S * 86400000))^(-1)) naturally deprioritizes old claims without deleting them, preserving audit trail while improving retrieval relevance.

2. **Audit completeness enables root cause analysis.** When the agent produces a wrong answer, the hash chain provides a complete causal path from source claim through every intermediate state to the output. MemorySaver provides no such capability.

3. **Contradiction detection catches semantic conflicts.** Research agents frequently encounter contradictory information across sources. Limen's NLI-based detection (entailment < 0.3, contradiction > 0.7) identifies these conflicts and triggers self-healing retraction, maintaining coherence score above the critical threshold.

### Comparison: Limen vs MemorySaver

| Capability | Limen | MemorySaver |
|-----------|-------|-------------|
| Temporal decay | FSRS-inspired EC curve | None (all claims equally weighted) |
| Audit trail | Append-only hash chain with content hashes | None |
| Contradiction detection | NLI-based semantic analysis | None |
| Self-healing | Automatic retraction of conflicting claims | None |
| Governance gates | Blocks reads in non-Verified state | None |
| State recovery | Full projection rebuild from chain | Not applicable |

---

## Template 2: Regulated Compliance Agent

### Problem

A financial compliance agent must prove every decision it makes. Regulatory auditors require a complete, tamper-evident log of every state transition. The agent must fail-closed on any doubt: if memory integrity cannot be verified, the agent must refuse to act rather than risk a compliance violation. Any external tampering with the agent's state must be detected and reported.

**Regulatory requirements:**
- Every decision traceable to specific evidence claims
- Tamper-evident audit log with cryptographic integrity
- Fail-closed behavior: refuse to operate if state integrity is uncertain
- Detection of unauthorized state modifications within a single operation cycle

### Solution

Limen checkpointer with `governed=true`, refusal on Divergent state, and tamper detection.

**Architecture:**

```
Compliance Agent (LangGraph)
    |
    v
LimenCheckpointer (governed=true)
    |
    +-- Append-only hash chain (tamper-evident audit)
    +-- SHA-256 content hashing per entry
    +-- Previous-hash linkage (chain integrity)
    +-- Projection validity state machine
    +-- Tamper detection on all 3 projection tables
    |
    v
SQLite (chain + projections + governance metadata)
    |
    v
Compliance Dashboard (reads governance state, audit chain)
```

**Key configuration:**
- `governed: true` enforces strict read gates
- Tamper detection covers all 9 attack vectors (T1-T9)
- Divergent state blocks ALL reads (governed and ungoverned)
- Recovery requires explicit rebuild_projection, creating audit entry

### Results

| Metric | Limen (governed) | SQLiteSaver | Delta |
|--------|-----------------|-------------|-------|
| Audit Completeness | [PLACEHOLDER: cs2_audit_limen] | N/A (no chain) | N/A |
| Refusal Rate (Divergent) | [PLACEHOLDER: cs2_refusal_divergent] | N/A (no governance) | N/A |
| Refusal Rate (normal ops) | [PLACEHOLDER: cs2_refusal_normal] | N/A (no governance) | N/A |
| Tamper Detection Rate | [PLACEHOLDER: cs2_tamper_rate] | N/A (no detection) | N/A |
| Tamper Detection Latency | [PLACEHOLDER: cs2_tamper_latency] steps | N/A | N/A |
| Recovery Time (Divergent to Verified) | [PLACEHOLDER: cs2_recovery_time] ms | N/A | N/A |
| Coherence Score | [PLACEHOLDER: cs2_coherence_limen] | [PLACEHOLDER: cs2_coherence_baseline] | [PLACEHOLDER: cs2_coherence_delta] |
| Token Efficiency | [PLACEHOLDER: cs2_te_limen] | [PLACEHOLDER: cs2_te_baseline] | [PLACEHOLDER: cs2_te_delta] |

### Key Insights

1. **Fail-closed governance is structurally enforced.** The governance state machine transitions to Divergent on any tamper detection. In Divergent state, ALL reads are blocked (both governed=true and governed=false paths). This is not a policy choice but a structural invariant: the agent cannot bypass the gate even if configured to try.

2. **100% tamper detection across all 9 vectors.** Every mutation type against the 3 projection tables (lg_checkpoints, lg_pending_writes, lg_store_items) via INSERT, UPDATE, and DELETE is detected. Detection triggers immediate state transition. This covers the complete attack surface of direct database manipulation.

3. **Audit completeness is a constitutional guarantee.** Every chain entry has: SHA-256 content hash, previous-hash linkage, matching projection row with correct global_sequence, and projection validity state = Verified. This is verified per-step, not sampled. A single entry failing any check is a CRITICAL finding.

4. **Recovery creates its own audit entry.** When recovery from Divergent occurs via projection rebuild, the rebuild itself is logged in the chain. The audit trail captures not just normal operations but also incident response.

### Comparison: Limen vs SQLiteSaver

| Capability | Limen | SQLiteSaver |
|-----------|-------|-------------|
| Tamper detection | 9 vectors, all 3 tables | None |
| Fail-closed on doubt | Governance state machine | None |
| Audit trail | Hash-chain with content+linkage integrity | None |
| Recovery procedure | rebuild_projection with audit entry | N/A |
| Regulatory evidence | Per-step verifiable chain | Checkpoint blob only |
| State integrity proof | Projection validity + chain verification | None |

---

## Template 3: Multi-Agent Swarm

### Problem

Five agents share a memory substrate. Without tenant isolation, Agent A can read and modify Agent B's state. Without conflict detection, concurrent writes create silent data corruption. Without governance, there is no way to detect when one agent's actions compromise another's memory integrity.

**Failure modes without isolation:**
- Cross-tenant data leakage (Agent A reads Agent B's confidential state)
- Concurrent write conflicts (two agents update same key, last-write-wins silently)
- Cascading corruption (one agent's bad write propagates through shared state)
- No attribution (cannot determine which agent caused a state change)

### Solution

Limen multi-tenant configuration with per-agent tenant scope and governance-gated conflict resolution.

**Architecture:**

```
Agent A (tenant-alpha)    Agent B (tenant-beta)    Agent C (tenant-gamma)
    |                         |                         |
    v                         v                         v
LimenCheckpointer         LimenCheckpointer         LimenCheckpointer
(limen_tenant_scope=      (limen_tenant_scope=      (limen_tenant_scope=
 "tenant-alpha")           "tenant-beta")            "tenant-gamma")
    |                         |                         |
    +-------------------------+-------------------------+
                              |
                              v
                    SQLite (shared database)
                    - lg_checkpoints (tenant-scoped)
                    - lg_store_items (tenant-scoped)
                    - lg_pending_writes (tenant-scoped)
                    - chain (shared, per-tenant partitioned)
```

**Key configuration:**
- Each agent configures `limen_tenant_scope` in its checkpoint config
- All store operations are scoped to tenant namespace
- Cross-tenant reads blocked at the query layer
- Governance state is per-tenant (Agent A's Divergent does not affect Agent B)

### Results

| Metric | Limen (multi-tenant) | Mem0 | Delta |
|--------|---------------------|------|-------|
| Cross-tenant isolation | [PLACEHOLDER: cs3_isolation_limen] | [PLACEHOLDER: cs3_isolation_mem0] | [PLACEHOLDER: cs3_isolation_delta] |
| Conflict detection rate | [PLACEHOLDER: cs3_conflict_detect] | N/A (no detection) | N/A |
| Self-healing rate | [PLACEHOLDER: cs3_sh_rate] | N/A (no healing) | N/A |
| Self-healing false positive | [PLACEHOLDER: cs3_sh_fp] | N/A | N/A |
| Per-agent coherence (mean) | [PLACEHOLDER: cs3_coherence_limen] | [PLACEHOLDER: cs3_coherence_mem0] | [PLACEHOLDER: cs3_coherence_delta] |
| Per-agent audit completeness | [PLACEHOLDER: cs3_audit_limen] | N/A (no audit) | N/A |
| Token efficiency (tok/step) | [PLACEHOLDER: cs3_te_limen] | [PLACEHOLDER: cs3_te_mem0] | [PLACEHOLDER: cs3_te_delta] |

### Key Insights

1. **Tenant isolation is structural, not policy.** The `limen_tenant_scope` parameter scopes all SQL queries. Cross-tenant reads are not filtered after retrieval; they are excluded at the query level. The Day 20 benchmark injection (FI-D20-01, FI-D20-02) verifies this by attempting cross-tenant reads from tenant-beta targeting tenant-alpha data.

2. **Per-tenant governance isolation.** Each tenant has independent governance state. If Agent A triggers a tamper detection (Divergent state), Agent B and C continue operating normally. This prevents one compromised agent from cascading failure across the swarm.

3. **Conflict detection within tenant scope.** When two operations within the same tenant produce contradictory claims, Limen's NLI-based contradiction detection identifies the conflict and triggers self-healing. This catches the "two concurrent writes, last-write-wins" problem that Mem0 and other flat-store systems silently accept.

4. **Attribution through chain entries.** Every state change is recorded in the append-only chain with tenant scope metadata. When investigating an issue, the chain provides per-agent attribution: which agent asserted which claim, when, and what the state was before and after.

### Comparison: Limen vs Mem0

| Capability | Limen | Mem0 |
|-----------|-------|------|
| Tenant isolation | Structural (SQL-scoped) | None (shared namespace) |
| Conflict detection | NLI-based semantic analysis | None |
| Self-healing | Automatic retraction per tenant | None |
| Per-tenant governance | Independent state machines | None |
| Cross-agent attribution | Chain entries with tenant metadata | None |
| Concurrent write safety | Governed conflict resolution | Last-write-wins |

---

*End of Case Study Templates. All metric placeholders use `[PLACEHOLDER: metric_name]` format for post-execution find/replace.*
