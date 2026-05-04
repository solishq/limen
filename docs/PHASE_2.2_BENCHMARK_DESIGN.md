# Phase 2.2 Benchmark Design: 30-Day Governed Agent Memory Evaluation

**Version:** 1.0.0
**Date:** 2026-05-03
**Adapter:** `@limen-ai/langgraph` v1.0.0
**Design Claims Reference:** CLAIMS.md (124 claims, 13 assumptions)
**Governing Document:** LANGGRAPH_ADAPTER_DESIGN.md Revision 8

---

## Table of Contents

1. [Metrics](#1-metrics)
2. [Mission Graph](#2-mission-graph)
3. [Success Criteria vs Baselines](#3-success-criteria-vs-baselines)
4. [Data Collection Schema](#4-data-collection-schema)
5. [Efficiency Rules](#5-efficiency-rules)
6. [Appendix A: Implementation Reference](#appendix-a-implementation-reference)

---

## 1. Metrics

Seven metrics. Each with an exact formula, unit, collection frequency, and failure threshold.

### 1.1 Coherence Score (0-100)

Measures how well memory state remains internally consistent across the 30-day simulation.

**Formula:**

```
C = 0.4 * S_avg + 0.3 * (1 - R_contra) * 100 + 0.3 * R_factual * 100
```

Where:

```
S_avg    = (1/N) * SUM(i=1..N, cosine_similarity(embed(state_i), embed(state_{i-1})))
R_contra = count(contradicting_active_claims) / count(all_claims_asserted)
R_factual = count(source_matching_claims) / count(source_backed_claims)
```

| Symbol | Type | Description |
|--------|------|-------------|
| `S_avg` | float [0,1] | Mean cosine similarity between consecutive state embeddings |
| `R_contra` | float [0,1] | Fraction of claims contradicting a prior active claim on same subject+predicate |
| `R_factual` | float [0,1] | Fraction of source-backed claims matching their source document |
| `embed(x)` | float[384] | all-MiniLM-L6-v2 embedding. `semantic_contradiction`: NLI entailment < 0.3 AND contradiction > 0.7 |

**Collection:** Daily aggregate. **Failure:** C < 50 on any single day is CRITICAL.

---

### 1.2 Audit Completeness (%)

Every chain entry must have: content hash, previous hash linkage, valid projection with correct global_sequence.

**Formula:**

```
AC = (E_full / E_total) * 100

E_full = count(chain_entries WHERE
           content_hash = sha256(state_json)
           AND previous_hash links correctly
           AND projection_row exists with matching global_sequence
           AND projection_validity_state = 'Verified')
```

**Collection:** Per-step, cumulative daily. **Failure:** AC < 100% is CRITICAL. Zero tolerance.

---

### 1.3 Refusal Rate (%)

Fraction of read attempts blocked by the governance gate, subdivided by validity state.

**Formula:**

```
RR = (G_blocked / G_total) * 100

Subdivided: RR_lagging + RR_unverified + RR_divergent + RR_rebuilding = RR
```

**Governance mode invariants:**

| State | governed=true | governed=false |
|-------|--------------|----------------|
| Verified | allowed | allowed |
| Lagging | blocked (retryable) | allowed (warn) |
| Unverified | blocked | blocked |
| Divergent | blocked | blocked |
| Rebuilding | blocked (retryable) | blocked (retryable) |

**Collection:** Per-step, daily breakdown. **Failure:** During Divergent state, RR must be 100% -- anything less is CRITICAL.

---

### 1.4 effectiveConfidence Trajectory

**Formula:**

```
EC(t) = C_0 * (1 + age_ms / (9 * S_days * 86400000))^(-1)

age_ms = t_now - t_asserted
S_days = stability_days (default: 30)

At t=0:       EC = C_0
At t=S_days:  EC = C_0 * 0.9
At t=9*S:     EC = C_0 * 0.5
At t=90*S:    EC = C_0 * 0.0909
```

**Collection:** Daily snapshot, report median with p5/p95 bands.
**Visualization:** Line chart, X=day(1-30), Y=EC[0,1], three lines (p5, median, p95).
**Failure:** Median EC < 0.3 before day 20 = WARNING (over-aggressive). Median EC > 0.8 at day 30 = WARNING (under-decay).

---

### 1.5 Self-Healing Events

**Formula:**

```
SH_rate = R_success / R_total

R_success = count(retractions WHERE status changed active->retracted AND no error)
R_total   = count(all_retraction_attempts)

Derived:
  SH_latency_ms    = median(t_retracted - t_conflict_detected)
  SH_false_positive = count(retractions_of_correct_claims) / R_success
```

**Collection:** Per-event, daily count and cumulative.
**Failure:** SH_rate < 0.95 WARNING. SH_rate < 0.80 CRITICAL. SH_false_positive > 0.05 CRITICAL.

---

### 1.6 Tamper Detection Rate

**Formula:**

```
TD = D_detected / D_injected
```

| ID | Target | Method |
|----|--------|--------|
| T1-T3 | lg_checkpoints | INSERT / UPDATE blob / DELETE |
| T4-T6 | lg_pending_writes | INSERT / UPDATE value / DELETE |
| T7-T9 | lg_store_items | INSERT / UPDATE value_json / DELETE |

All 9 must trigger tamper detection, transition to Divergent, block subsequent reads.

**Collection:** Per-injection. **Failure:** TD < 1.0 is CRITICAL. Zero tolerance.

---

### 1.7 Token Efficiency

**Formula:**

```
TE = T_total / S_total

T_total  = SUM(tokens_in + tokens_out) across all steps
S_total  = count(all_steps) (target: 3000)

Derived:
  TE_read     = tokens for query+governance steps / count(read_steps)
  TE_write    = tokens for claim+conflict+maintenance steps / count(write_steps)
  TE_overhead = (TE_limen - TE_baseline) / TE_baseline
```

**Collection:** Per-step, daily average. **Failure:** TE > 2000 CRITICAL. TE > 1500 WARNING. Target: < 1000.

---

## 2. Mission Graph

30-day simulation with scheduled failure injections.

### 2.1 Topology

```yaml
mission_graph:
  name: "limen-langgraph-30day-benchmark"
  version: "1.0.0"
  duration_days: 30
  steps_per_day: 100
  total_steps: 3000
  thread_topology:
    main_thread: "benchmark-main"
    branches_per_day: 3
    branch_pattern: "fork-execute-merge"
    branch_steps: 5
    branch_thread_format: "benchmark-branch-d{day}-b{branch}"
  tenant_config:
    primary_tenant: "tenant-alpha"
    probe_tenant: "tenant-beta"

  input_distribution:
    claim:       { weight: 0.40, ops: ["store.put", "checkpoint.put"], subjects: 50, max_per_subject: 20 }
    query:       { weight: 0.25, ops: ["store.get", "store.search", "checkpoint.getTuple", "checkpoint.list", "store.batch"] }
    governance:  { weight: 0.15, ops: ["validity.currentState", "validity.verifyOnStartup", "governed_read", "ungoverned_read"] }
    conflict:    { weight: 0.10, ops: ["store.put contradicting", "checkpoint.put contradicting"] }
    maintenance: { weight: 0.10, ops: ["EC evaluation", "retract below threshold", "deleteThread", "rebuild verify"] }
```

### 2.2 Failure Injection Schedule

```yaml
  failure_injections:
    - day: 5
      name: "tamper_injection"
      description: "3 direct SQL tamper attempts against projection tables"
      injections:
        - { id: "FI-D5-01", type: "T2", target: "lg_checkpoints", action: "UPDATE checkpoint_blob = X'DEADBEEF'" }
        - { id: "FI-D5-02", type: "T7", target: "lg_store_items", action: "INSERT rogue store item" }
        - { id: "FI-D5-03", type: "T6", target: "lg_pending_writes", action: "DELETE oldest pending write" }
      expected: "All detected, state -> Divergent, recovery via rebuild_projection -> Verified"

    - day: 10
      name: "projection_divergence"
      description: "Corrupt projection_metadata digest"
      injections:
        - { id: "FI-D10-01", type: "digest_corruption", action: "UPDATE projection_metadata SET value='corrupted'" }
      verification: ["All reads -> LimenGovernanceError", "RR_divergent = 100%", "Writes continue (Claim 4.8)"]
      recovery: { action: "full_projection_rebuild_from_chain", max_time_ms: 30000 }

    - day: 15
      name: "conflict_storm"
      description: "20 contradictory claims in 5 consecutive steps"
      injections:
        - { id: "FI-D15-01", claims: 20, steps: 5, strategy: "For 10 subjects, assert A then NOT-A" }
      success: { coherence_recovery_days: 2, retractions: ">=10", chain_integrity: true }

    - day: 20
      name: "tenant_boundary_probe"
      description: "Cross-tenant read attempts (Claims 5.2-5.4)"
      injections:
        - { id: "FI-D20-01", type: "cross_tenant", source: "tenant-beta", target: "tenant-alpha" }
        - { id: "FI-D20-02", type: "scope_injection", ops: ["getTuple with limen_tenant_scope override"] }
      success: { cross_tenant_leakage: 0, override_path_functional: true }

    - day: 25
      name: "chain_write_failure"
      description: "Simulate chain.appendEntry + SQLITE_BUSY failures"
      injections:
        - { id: "FI-D25-01", type: "chain_append_failure", mechanism: "3 consecutive LimenStorageError" }
        - { id: "FI-D25-02", type: "sqlite_busy", mechanism: "5 consecutive SQLITE_BUSY" }
      expected: ["Error propagates (Claim 8.1)", "No partial projection", "Recovery normal", "Sequence continuity"]

    - day: 28
      name: "full_projection_rebuild"
      description: "Drop all lg_* tables, rebuild from chain"
      injections:
        - { id: "FI-D28-01", type: "full_rebuild" }
      expected_transitions: "Divergent -> Rebuilding -> Verified"
      success: { data_loss: 0, state_equivalence: true, rebuild_time_ms_max: 60000 }
```

### 2.3 Daily Step Template

```yaml
  daily_template:
    warm_up:   5 steps  # verifyOnStartup, getTuple, store.search
    main:     85 steps  # weighted by input_distribution
    branches: 10 steps  # 3 fork-execute-merge cycles (3-4 steps each)
    end_of_day: 5 steps # aggregate metrics, EC decay, maintenance retractions, audit check
    total:   100 steps

  step_execution: [select_input, generate_data, record_pre_state, execute, record_post_state, compute_metrics, log]
```

---

## 3. Success Criteria vs Baselines

### 3.1 Comparison Matrix

| Metric | Limen Target | MemorySaver | SQLiteSaver | Pass Threshold | Class |
|--------|-------------|-------------|-------------|----------------|-------|
| Coherence Score | > 85 | Measured | Measured | Limen >= baseline | QUALITY_GATE |
| Audit Completeness | 100% | N/A | N/A | 100% every run | CONSTITUTIONAL |
| Refusal Rate (normal) | < 5% | N/A | N/A | Per spec | CONSTITUTIONAL |
| Refusal Rate (Divergent) | 100% | N/A | N/A | 100% every run | CONSTITUTIONAL |
| EC p50 Day 15 | [0.5, 0.8] | N/A | N/A | Within range | QUALITY_GATE |
| Self-Healing Rate | > 95% | N/A | N/A | > 95% | QUALITY_GATE |
| Tamper Detection | 100% | N/A | N/A | 100% every run | CONSTITUTIONAL |
| Token Efficiency | < 1000/step | Measured | Measured | <= 1.5x baseline | QUALITY_GATE |

### 3.2 Statistical Requirements

**Runs:** 3 minimum per configuration. **Configurations:** 4 (Limen governed, ungoverned, MemorySaver, SQLiteSaver) = 12 total.

**Improvement claims:** Welch's t-test (unequal variance), reject H0 at p < 0.05.

```
t = (mean_limen - mean_baseline) / sqrt(var_limen/n + var_baseline/n)
df = Welch-Satterthwaite approximation
Cohen's d = (mean_limen - mean_baseline) / sqrt((var_limen + var_baseline) / 2)
  d < 0.2: negligible | 0.2-0.5: small | 0.5-0.8: medium | > 0.8: large
```

**Reporting per metric:**

```
Metric: [name]
Limen (governed):   mean +/- std  [run1, run2, run3]
Limen (ungoverned): mean +/- std  [run1, run2, run3]
MemorySaver:        mean +/- std  [run1, run2, run3]
SQLiteSaver:        mean +/- std  [run1, run2, run3]
Welch t vs MemorySaver: t=[v], df=[v], p=[v]
Welch t vs SQLiteSaver: t=[v], df=[v], p=[v]
Cohen's d vs MemorySaver: [v] ([size])
Cohen's d vs SQLiteSaver: [v] ([size])
Pass: [YES/NO] -- [reason]
```

### 3.3 CONSTITUTIONAL Enforcement

CONSTITUTIONAL metrics must pass on EVERY run, not just on average. Single-run failure = CRITICAL.

```
Audit Completeness:       ALL 3 runs = 100%
Refusal Rate (Divergent): ALL 3 runs = 100% block
Tamper Detection:         ALL 3 runs = 100%
```

### 3.4 QUALITY_GATE Enforcement

Statistical framework applies. Claims require p < 0.05.

```
Coherence:       mean(Limen) >= mean(baseline), p < 0.05
Token Efficiency: mean(Limen) <= 1.5 * mean(baseline), p < 0.05
Self-Healing:    mean > 0.95, all runs > 0.80
EC Trajectory:   median within specified bands
```

---

## 4. Data Collection Schema

### 4.1 Per-Step Log Entry

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "limen-benchmark-step-log-v1",
  "type": "object",
  "required": ["step_id", "day", "timestamp_ms", "input_type", "input_data", "llm_call", "memory_ops", "projection", "output"],
  "properties": {
    "step_id":      { "type": "integer", "minimum": 1, "maximum": 3000 },
    "day":          { "type": "integer", "minimum": 1, "maximum": 30 },
    "timestamp_ms": { "type": "integer", "minimum": 0 },
    "input_type":   { "type": "string", "enum": ["claim", "query", "governance", "conflict", "maintenance"] },
    "input_data": {
      "type": "object",
      "required": ["operation"],
      "properties": {
        "operation":            { "type": "string" },
        "thread_id":            { "type": "string" },
        "namespace":            { "type": "array", "items": { "type": "string" } },
        "key":                  { "type": "string" },
        "tenant_scope":         { "type": "string" },
        "governed":             { "type": "boolean" },
        "is_failure_injection": { "type": "boolean" },
        "failure_injection_id": { "type": "string" }
      }
    },
    "llm_call": {
      "type": "object",
      "required": ["model", "tokens_in", "tokens_out", "cost_usd", "latency_ms"],
      "properties": {
        "model":      { "type": "string" },
        "tokens_in":  { "type": "integer", "minimum": 0 },
        "tokens_out": { "type": "integer", "minimum": 0 },
        "cost_usd":   { "type": "number", "minimum": 0 },
        "latency_ms": { "type": "integer", "minimum": 0 }
      }
    },
    "memory_ops": {
      "type": "object",
      "required": ["checkpoint_reads", "checkpoint_writes", "store_reads", "store_writes", "governance_state", "governance_blocked", "governance_error_retryable", "effective_confidence"],
      "properties": {
        "checkpoint_reads":          { "type": "integer", "minimum": 0 },
        "checkpoint_writes":         { "type": "integer", "minimum": 0 },
        "store_reads":               { "type": "integer", "minimum": 0 },
        "store_writes":              { "type": "integer", "minimum": 0 },
        "governance_state":          { "type": "string", "enum": ["Verified", "Lagging", "Unverified", "Divergent", "Rebuilding"] },
        "governance_blocked":        { "type": "boolean" },
        "governance_error_retryable": { "type": ["boolean", "null"] },
        "effective_confidence":      { "type": ["number", "null"], "minimum": 0, "maximum": 1 }
      }
    },
    "projection": {
      "type": "object",
      "required": ["last_projected_sequence", "validity_state", "tamper_detected", "chain_entry_count", "projection_row_count"],
      "properties": {
        "last_projected_sequence": { "type": "integer", "minimum": 0 },
        "validity_state":          { "type": "string", "enum": ["Verified", "Lagging", "Unverified", "Divergent", "Rebuilding"] },
        "tamper_detected":         { "type": "boolean" },
        "chain_entry_count":       { "type": "integer", "minimum": 0 },
        "projection_row_count":    { "type": "integer", "minimum": 0 }
      }
    },
    "output": {
      "type": "object",
      "required": ["success", "result_type", "result_summary"],
      "properties": {
        "success":         { "type": "boolean" },
        "result_type":     { "type": "string", "enum": ["checkpoint_tuple", "checkpoint_written", "writes_saved", "thread_deleted", "store_item", "search_results", "namespaces", "batch_results", "governance_blocked", "governance_verified", "claim_retracted", "decay_evaluated", "error", "null"] },
        "result_summary":  { "type": "string", "maxLength": 500 },
        "error_class":     { "type": ["string", "null"], "enum": ["LimenGovernanceError", "LimenStorageError", "LimenSerdeError", "LimenNotStartedError", "Error", null] },
        "error_message":   { "type": ["string", "null"] },
        "reasoning_trace": { "type": ["string", "null"], "maxLength": 2000 }
      }
    }
  },
  "additionalProperties": false
}
```

### 4.2 Per-Day Aggregate Schema

```json
{
  "$id": "limen-benchmark-day-aggregate-v1",
  "type": "object",
  "required": ["day", "steps_executed", "metrics", "failure_injection", "resource_usage"],
  "properties": {
    "day":            { "type": "integer", "minimum": 1, "maximum": 30 },
    "steps_executed": { "type": "integer" },
    "metrics": {
      "type": "object",
      "required": ["coherence_score", "audit_completeness_pct", "refusal_rate_pct", "effective_confidence_median", "token_efficiency_avg"],
      "properties": {
        "coherence_score":                { "type": "number", "minimum": 0, "maximum": 100 },
        "coherence_sub_semantic":         { "type": "number", "minimum": 0, "maximum": 1 },
        "coherence_sub_contradiction":    { "type": "number", "minimum": 0, "maximum": 1 },
        "coherence_sub_factual":          { "type": "number", "minimum": 0, "maximum": 1 },
        "audit_completeness_pct":         { "type": "number", "minimum": 0, "maximum": 100 },
        "refusal_rate_pct":               { "type": "number", "minimum": 0, "maximum": 100 },
        "refusal_rate_lagging_pct":       { "type": "number", "minimum": 0, "maximum": 100 },
        "refusal_rate_unverified_pct":    { "type": "number", "minimum": 0, "maximum": 100 },
        "refusal_rate_divergent_pct":     { "type": "number", "minimum": 0, "maximum": 100 },
        "refusal_rate_rebuilding_pct":    { "type": "number", "minimum": 0, "maximum": 100 },
        "effective_confidence_p5":        { "type": "number", "minimum": 0, "maximum": 1 },
        "effective_confidence_median":    { "type": "number", "minimum": 0, "maximum": 1 },
        "effective_confidence_p95":       { "type": "number", "minimum": 0, "maximum": 1 },
        "self_healing_rate":              { "type": ["number", "null"], "minimum": 0, "maximum": 1 },
        "self_healing_count":             { "type": "integer", "minimum": 0 },
        "self_healing_latency_median_ms": { "type": ["integer", "null"], "minimum": 0 },
        "tamper_detection_rate":          { "type": ["number", "null"], "minimum": 0, "maximum": 1 },
        "tamper_injections_today":        { "type": "integer", "minimum": 0 },
        "token_efficiency_avg":           { "type": "number", "minimum": 0 },
        "token_efficiency_read":          { "type": "number", "minimum": 0 },
        "token_efficiency_write":         { "type": "number", "minimum": 0 }
      }
    },
    "failure_injection": {
      "type": "object",
      "required": ["active"],
      "properties": {
        "active":              { "type": "boolean" },
        "injection_name":      { "type": ["string", "null"] },
        "injection_ids":       { "type": "array", "items": { "type": "string" } },
        "all_detected":        { "type": ["boolean", "null"] },
        "recovery_successful": { "type": ["boolean", "null"] },
        "recovery_time_ms":    { "type": ["integer", "null"] }
      }
    },
    "resource_usage": {
      "type": "object",
      "required": ["total_tokens", "total_cost_usd", "total_llm_calls"],
      "properties": {
        "total_tokens":        { "type": "integer", "minimum": 0 },
        "total_cost_usd":      { "type": "number", "minimum": 0 },
        "total_llm_calls":     { "type": "integer", "minimum": 0 },
        "mean_latency_ms":     { "type": "number", "minimum": 0 },
        "p95_latency_ms":      { "type": "number", "minimum": 0 },
        "chain_entries_added":  { "type": "integer", "minimum": 0 },
        "projection_rebuilds": { "type": "integer", "minimum": 0 }
      }
    }
  },
  "additionalProperties": false
}
```

### 4.3 Per-Run Summary Schema

```json
{
  "$id": "limen-benchmark-run-summary-v1",
  "type": "object",
  "required": ["run_id", "saver_type", "governed", "started_at", "completed_at", "total_steps", "total_days", "final_metrics", "failure_injection_results", "pass"],
  "properties": {
    "run_id":     { "type": "string", "format": "uuid" },
    "saver_type": { "type": "string", "enum": ["limen-governed", "limen-ungoverned", "memory-saver", "sqlite-saver"] },
    "governed":   { "type": "boolean" },
    "started_at": { "type": "string", "format": "date-time" },
    "completed_at": { "type": "string", "format": "date-time" },
    "total_steps":  { "type": "integer" },
    "total_days":   { "type": "integer" },
    "final_metrics": {
      "type": "object",
      "required": ["coherence_score_mean", "token_efficiency_mean", "total_tokens", "total_cost_usd"],
      "properties": {
        "coherence_score_mean":            { "type": "number" },
        "coherence_score_std":             { "type": "number" },
        "audit_completeness_pct":          { "type": "number" },
        "refusal_rate_normal_pct":         { "type": "number" },
        "refusal_rate_divergent_pct":      { "type": ["number", "null"] },
        "effective_confidence_day15_median": { "type": ["number", "null"] },
        "self_healing_rate":               { "type": ["number", "null"] },
        "tamper_detection_rate":           { "type": ["number", "null"] },
        "token_efficiency_mean":           { "type": "number" },
        "token_efficiency_std":            { "type": "number" },
        "total_tokens":                    { "type": "integer" },
        "total_cost_usd":                  { "type": "number" }
      }
    },
    "failure_injection_results": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["day", "name", "all_detected", "recovery_successful"],
        "properties": {
          "day": { "type": "integer" }, "name": { "type": "string" },
          "all_detected": { "type": "boolean" }, "recovery_successful": { "type": "boolean" },
          "recovery_time_ms": { "type": "integer" }, "notes": { "type": "string" }
        }
      }
    },
    "pass": { "type": "boolean" },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["severity", "metric", "message"],
        "properties": {
          "severity":  { "type": "string", "enum": ["CRITICAL", "WARNING", "INFO"] },
          "metric":    { "type": "string" },
          "message":   { "type": "string" },
          "day":       { "type": ["integer", "null"] },
          "value":     { "type": "number" },
          "threshold": { "type": "number" }
        }
      }
    }
  },
  "additionalProperties": false
}
```

### 4.4 Storage Format

Step logs in NDJSON (~2KB/step, ~6MB/run). Day aggregates as JSON array (~45KB/run). Run summaries as single JSON (~5KB/run). Gzip after completion (8:1 ratio, ~9MB total for 12 runs).

---

## 5. Efficiency Rules

### 5.1 Context Window Management

| Rule | Value | Rationale |
|------|-------|-----------|
| Context window cap per LLM call | 8,000-12,000 tokens | Prevents overflow, predictable cost |
| System prompt allocation | 2,000 tokens max | Fixed overhead |
| Memory state injection | 4,000 tokens max | Serialized checkpoint + store items |
| User/agent message | 2,000-6,000 tokens | Remaining budget |

### 5.2 Model Selection

| Operation | Model | Rationale |
|-----------|-------|-----------|
| Memory ops (store.put, checkpoint.put) | Haiku / GPT-4o-mini | Low reasoning, high throughput |
| Query ops (search, list, get) | Haiku / GPT-4o-mini | Pattern matching |
| Governance checks | No LLM | In-memory enum (~10ns per Claim 7.1) |
| Conflict detection / resolution | Sonnet / GPT-4o | Semantic reasoning required |
| Coherence evaluation | Sonnet / GPT-4o | Semantic analysis |

### 5.3 Batch Operation Rules

- Use `store.batch()` for multi-operation steps (3-phase execution per Claim 3.1)
- Cache governance state within a step (state transitions only on verifyOnStartup or tamper)
- Individual calls only for single-operation steps; batch mandatory for 2+ operations

### 5.4 Early Stopping

```
Condition: 3 consecutive runs produce identical metrics within +/- 2% on all 7 metrics.
Check: after each completed run (minimum 3 before check)
  stable(M) = |M_N - M_{N-1}| / max(M_N, 0.001) < 0.02
              AND |M_N - M_{N-2}| / max(M_N, 0.001) < 0.02
  early_stop = ALL(stable(M)) for all 7 metrics

If converged after 3: report "converged", skip remaining.
If unstable after 5: report "unstable" with variance analysis.
Maximum: 5 runs per configuration.
```

### 5.5 Token Budget

| Category | Target | Hard Cap |
|----------|--------|----------|
| Per 30-day run (3,000 steps) | 2,000,000 | 3,000,000 |
| Per step average | 667 | 1,000 |
| Total benchmark (12 runs max) | 24,000,000 | 36,000,000 |
| Per failure injection day | 150,000 | 200,000 |
| Embedding calls (coherence) | 100,000 | 150,000 |

**Enforcement:** At 90% cap: WARNING + downgrade all Sonnet/GPT-4o to Haiku/GPT-4o-mini. At 100%: STOP run, report BUDGET_EXHAUSTED, compute metrics from completed steps only.

---

## Appendix A: Implementation Reference

### A.1 Embedding Model

Coherence metric uses `all-MiniLM-L6-v2` (384 dimensions). Contradiction detection: NLI model, entailment < 0.3 AND contradiction > 0.7.

### A.2 effectiveConfidence Reference Points (S_days=30)

| Day | EC / C_0 | Day | EC / C_0 |
|-----|----------|-----|----------|
| 0 | 1.000 | 20 | 0.919 |
| 5 | 0.984 | 30 | 0.867 |
| 10 | 0.964 | 90 | 0.629 |
| 15 | 0.943 | 270 | 0.500 |

Derivation: `EC/C_0 = (1 + age_ms / (9 * 30 * 86400000))^(-1)`

### A.3 Statistical Methods

Welch's t-test for improvement claims. Cohen's d for effect size. Critical t-values for n=3: df=2 -> 4.303, df=3 -> 3.182, df=4 -> 2.776 (alpha=0.05, two-tailed). Conservative: use df=2 when exact df unavailable.

---

*End of Phase 2.2 Benchmark Design Document.*
