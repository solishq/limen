<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# Phase 2.2 Analysis Framework

**Version:** 1.0.0 | **Date:** 2026-05-03
**Governing Document:** PHASE_2.2_BENCHMARK_DESIGN.md v1.0.0
**Implementation:** scoring_functions.py, analyze.py

---

## 1. Statistical Methodology

### 1.1 Run Configuration

4 configurations, 3 runs minimum each, 12 total runs:

| Config ID | Saver | Governed | Notes |
|-----------|-------|----------|-------|
| `limen-governed` | LimenCheckpointer | true | Full governance pipeline |
| `limen-ungoverned` | LimenCheckpointer | false | Governance warnings only |
| `memory-saver` | MemorySaver | N/A | LangGraph built-in baseline |
| `sqlite-saver` | SQLiteSaver | N/A | LangGraph persistence baseline |

### 1.2 Descriptive Statistics

Per metric, per configuration:
- **Mean** across 3 runs
- **Standard deviation** (sample, `analyze._std()`)
- **95% Confidence Interval:** `mean +/- t_crit * (std / sqrt(n))`, `t_crit = 4.303` for `n=3, df=2` (design doc A.3)
- **Per-run values** reported for full transparency

### 1.3 Inferential Statistics

**Welch's t-test** (unequal variance, `analyze.welch_t_test()`):

```
t = (mean_limen - mean_baseline) / sqrt(var_limen/n + var_baseline/n)
df = Welch-Satterthwaite approximation
Reject H0 at p < 0.05 (two-tailed)
```

**Cohen's d effect size** (`analyze.cohens_d()`):

```
d = (mean_limen - mean_baseline) / sqrt((var_limen + var_baseline) / 2)
```

| d range | Classification |
|---------|---------------|
| < 0.2 | Negligible |
| 0.2 - 0.5 | Small |
| 0.5 - 0.8 | Medium |
| > 0.8 | Large |

### 1.4 Early Stopping

Per design doc section 5.4: if 3 consecutive runs produce identical metrics within +/- 2% on all 7 metrics, report "converged" and skip remaining. Max 5 runs per configuration.

### 1.5 Reporting Format

```
Metric: [name]
Limen (governed):   mean +/- std  [run1, run2, run3]  95% CI: [lo, hi]
Limen (ungoverned): mean +/- std  [run1, run2, run3]  95% CI: [lo, hi]
MemorySaver:        mean +/- std  [run1, run2, run3]  95% CI: [lo, hi]
SQLiteSaver:        mean +/- std  [run1, run2, run3]  95% CI: [lo, hi]
Welch t vs MemorySaver: t=[v], df=[v], p=[v]
Welch t vs SQLiteSaver: t=[v], df=[v], p=[v]
Cohen's d vs MemorySaver: [v] ([size])
Cohen's d vs SQLiteSaver: [v] ([size])
Pass: [YES/NO] -- [reason]
```

---

## 2. Comparison Matrix

### 2.1 Full Metric Comparison Table

| Metric | Limen Governed (mean+/-std) | Limen Ungoverned (mean+/-std) | MemorySaver (mean+/-std) | SQLiteSaver (mean+/-std) | Mem0 | Zep | Significance (p) | Effect Size (d) |
|--------|---------------------------|------------------------------|--------------------------|--------------------------|------|-----|-------------------|-----------------|
| Coherence Score (0-100) | [PLACEHOLDER: coherence_governed] | [PLACEHOLDER: coherence_ungoverned] | [PLACEHOLDER: coherence_memsaver] | [PLACEHOLDER: coherence_sqlsaver] | [PLACEHOLDER: coherence_mem0] | [PLACEHOLDER: coherence_zep] | [PLACEHOLDER: coherence_p] | [PLACEHOLDER: coherence_d] |
| Audit Completeness (%) | [PLACEHOLDER: audit_governed] | [PLACEHOLDER: audit_ungoverned] | N/A (no chain) | N/A (no chain) | N/A | N/A | N/A | N/A |
| Refusal Rate - Normal (%) | [PLACEHOLDER: refusal_normal_governed] | [PLACEHOLDER: refusal_normal_ungoverned] | N/A (no governance) | N/A (no governance) | N/A | N/A | N/A | N/A |
| Refusal Rate - Divergent (%) | [PLACEHOLDER: refusal_divergent_governed] | [PLACEHOLDER: refusal_divergent_ungoverned] | N/A (no governance) | N/A (no governance) | N/A | N/A | N/A | N/A |
| EC p50 Day 15 | [PLACEHOLDER: ec_p50_governed] | [PLACEHOLDER: ec_p50_ungoverned] | N/A (no decay) | N/A (no decay) | N/A | N/A | N/A | N/A |
| Self-Healing Rate (%) | [PLACEHOLDER: sh_rate_governed] | [PLACEHOLDER: sh_rate_ungoverned] | N/A (no healing) | N/A (no healing) | N/A | N/A | N/A | N/A |
| Tamper Detection Rate (%) | [PLACEHOLDER: tamper_governed] | [PLACEHOLDER: tamper_ungoverned] | N/A (no tamper detect) | N/A (no tamper detect) | N/A | N/A | N/A | N/A |
| Token Efficiency (tok/step) | [PLACEHOLDER: te_governed] | [PLACEHOLDER: te_ungoverned] | [PLACEHOLDER: te_memsaver] | [PLACEHOLDER: te_sqlsaver] | [PLACEHOLDER: te_mem0] | [PLACEHOLDER: te_zep] | [PLACEHOLDER: te_p] | [PLACEHOLDER: te_d] |

### 2.2 Metric Applicability Notes

- **Mem0/Zep columns:** Coherence and Token Efficiency are measurable. All governance, audit, tamper, self-healing, and EC metrics are N/A because these systems lack chain-based audit, governance state machines, FSRS decay, and tamper detection.
- **MemorySaver/SQLiteSaver:** Coherence and Token Efficiency are the primary comparison surfaces. All Limen-specific governance features produce N/A.
- **Significance tests** apply only to metrics where both Limen and baseline produce numeric values (Coherence, Token Efficiency).

### 2.3 Pass/Fail Criteria

| Metric | Class | Pass Condition |
|--------|-------|---------------|
| Coherence Score | QUALITY_GATE | mean(Limen) >= mean(baseline), p < 0.05 |
| Audit Completeness | CONSTITUTIONAL | ALL 3 runs = 100% |
| Refusal Rate (Divergent) | CONSTITUTIONAL | ALL 3 runs = 100% block |
| EC p50 Day 15 | QUALITY_GATE | Within [0.5, 0.8] |
| Self-Healing Rate | QUALITY_GATE | mean > 95%, all runs > 80% |
| Tamper Detection | CONSTITUTIONAL | ALL 3 runs = 100% |
| Token Efficiency | QUALITY_GATE | mean(Limen) <= 1.5 * mean(baseline), p < 0.05 |

CONSTITUTIONAL metrics enforce per-run (every run must pass). QUALITY_GATE metrics use statistical framework (mean across runs).

---

## 3. Governance Analysis

### 3.1 State Transition Tracking

Track every governance state transition across the 30-day simulation:

| From State | To State | Trigger | Count | Mean Latency (ms) |
|------------|----------|---------|-------|--------------------|
| Verified | Lagging | New chain entry not yet projected | [PLACEHOLDER: v_to_l_count] | [PLACEHOLDER: v_to_l_latency] |
| Lagging | Verified | Projection catches up | [PLACEHOLDER: l_to_v_count] | [PLACEHOLDER: l_to_v_latency] |
| Verified | Divergent | Tamper detected | [PLACEHOLDER: v_to_d_count] | [PLACEHOLDER: v_to_d_latency] |
| Divergent | Rebuilding | Rebuild initiated | [PLACEHOLDER: d_to_r_count] | [PLACEHOLDER: d_to_r_latency] |
| Rebuilding | Verified | Rebuild complete | [PLACEHOLDER: r_to_v_count] | [PLACEHOLDER: r_to_v_latency] |
| Verified | Unverified | Startup (not yet verified) | [PLACEHOLDER: v_to_u_count] | [PLACEHOLDER: v_to_u_latency] |
| Unverified | Verified | verifyOnStartup completes | [PLACEHOLDER: u_to_v_count] | [PLACEHOLDER: u_to_v_latency] |

### 3.2 Time-in-State Distribution

Per day, calculate fraction of steps in each governance state:

```
time_in_state[s] = count(steps WHERE governance_state == s) / total_steps_today
```

Report as stacked bar chart data (see Visualization Specs, Chart 4).

### 3.3 Recovery Latency

For Divergent-to-Verified recovery (the critical path):

- **Detection latency:** steps between tamper injection and Divergent state entry
- **Recovery latency:** steps between Divergent entry and Verified restoration
- **Total incident duration:** detection + recovery

Expected from failure injection schedule:
- Day 5: 3 tamper injections, recovery via rebuild_projection
- Day 10: digest corruption, recovery via full_projection_rebuild (max 30s)
- Day 28: full table drop, recovery via full rebuild (max 60s)

---

## 4. Token Efficiency

### 4.1 Per-Step Histogram

Bin all steps by tokens consumed:

| Bin (tokens/step) | Count | Percentage |
|-------------------|-------|------------|
| 0 - 200 | [PLACEHOLDER: bin_0_200] | [PLACEHOLDER: pct_0_200] |
| 200 - 500 | [PLACEHOLDER: bin_200_500] | [PLACEHOLDER: pct_200_500] |
| 500 - 1000 | [PLACEHOLDER: bin_500_1000] | [PLACEHOLDER: pct_500_1000] |
| 1000 - 1500 | [PLACEHOLDER: bin_1000_1500] | [PLACEHOLDER: pct_1000_1500] |
| 1500 - 2000 | [PLACEHOLDER: bin_1500_2000] | [PLACEHOLDER: pct_1500_2000] |
| > 2000 | [PLACEHOLDER: bin_over_2000] | [PLACEHOLDER: pct_over_2000] |

Threshold markers: TARGET at 1000, WARNING at 1500, CRITICAL at 2000.

### 4.2 Per-Day Trend

Daily aggregate `token_efficiency_avg` from day aggregate schema. Report read vs write breakdown:
- `TE_read = tokens for query+governance steps / count(read_steps)`
- `TE_write = tokens for claim+conflict+maintenance steps / count(write_steps)`

### 4.3 Budget Compliance

| Metric | Target | Hard Cap | Actual |
|--------|--------|----------|--------|
| Per-step average | 667 | 1,000 | [PLACEHOLDER: te_per_step] |
| Per 30-day run total | 2,000,000 | 3,000,000 | [PLACEHOLDER: te_run_total] |
| Failure injection day overhead | 150,000 | 200,000 | [PLACEHOLDER: te_fi_day] |
| Embedding calls | 100,000 | 150,000 | [PLACEHOLDER: te_embed] |

### 4.4 Overhead Analysis

```
TE_overhead = (TE_limen - TE_baseline) / TE_baseline
```

Report overhead vs MemorySaver and vs SQLiteSaver separately. Limen governance features (chain append, projection verify, tamper check) add overhead; this section quantifies it.

---

## 5. Tamper Detection and Self-Healing

### 5.1 Tamper Detection

Per design doc section 1.6, 9 tamper types tested:

| ID | Target Table | Method | Detected | Latency (steps) | State Transition |
|----|-------------|--------|----------|-----------------|-----------------|
| T1 | lg_checkpoints | INSERT | [PLACEHOLDER: t1_detected] | [PLACEHOLDER: t1_latency] | [PLACEHOLDER: t1_state] |
| T2 | lg_checkpoints | UPDATE blob | [PLACEHOLDER: t2_detected] | [PLACEHOLDER: t2_latency] | [PLACEHOLDER: t2_state] |
| T3 | lg_checkpoints | DELETE | [PLACEHOLDER: t3_detected] | [PLACEHOLDER: t3_latency] | [PLACEHOLDER: t3_state] |
| T4 | lg_pending_writes | INSERT | [PLACEHOLDER: t4_detected] | [PLACEHOLDER: t4_latency] | [PLACEHOLDER: t4_state] |
| T5 | lg_pending_writes | UPDATE value | [PLACEHOLDER: t5_detected] | [PLACEHOLDER: t5_latency] | [PLACEHOLDER: t5_state] |
| T6 | lg_pending_writes | DELETE | [PLACEHOLDER: t6_detected] | [PLACEHOLDER: t6_latency] | [PLACEHOLDER: t6_state] |
| T7 | lg_store_items | INSERT | [PLACEHOLDER: t7_detected] | [PLACEHOLDER: t7_latency] | [PLACEHOLDER: t7_state] |
| T8 | lg_store_items | UPDATE value_json | [PLACEHOLDER: t8_detected] | [PLACEHOLDER: t8_latency] | [PLACEHOLDER: t8_state] |
| T9 | lg_store_items | DELETE | [PLACEHOLDER: t9_detected] | [PLACEHOLDER: t9_latency] | [PLACEHOLDER: t9_state] |

**Pass criteria (CONSTITUTIONAL):** TD = D_detected / D_injected = 1.0. All 9 must be detected. All must trigger Divergent state. All must block subsequent reads.

### 5.2 Self-Healing Analysis

Per design doc section 1.5:

| Metric | Formula | Target | Actual |
|--------|---------|--------|--------|
| SH_rate | R_success / R_total | > 95% | [PLACEHOLDER: sh_rate] |
| SH_latency_ms | median(t_retracted - t_conflict_detected) | < 1000ms | [PLACEHOLDER: sh_latency] |
| SH_false_positive | retractions_of_correct_claims / R_success | < 5% | [PLACEHOLDER: sh_fp] |

Implementation reference: `scoring_functions.calculate_self_healing_success()` computes SH_rate from retraction events.

### 5.3 Conflict Storm Analysis (Day 15)

The Day 15 failure injection introduces 20 contradictory claims in 5 steps:

| Metric | Expected | Actual |
|--------|----------|--------|
| Coherence recovery (days) | <= 2 | [PLACEHOLDER: storm_recovery_days] |
| Retractions triggered | >= 10 | [PLACEHOLDER: storm_retractions] |
| Chain integrity preserved | true | [PLACEHOLDER: storm_chain_ok] |
| Coherence score dip (day 15) | Transient drop | [PLACEHOLDER: storm_coherence_dip] |
| Coherence score recovery (day 17) | >= pre-storm | [PLACEHOLDER: storm_coherence_recovery] |

---

## 6. Visualization Specs

### Chart 1: Coherence Trajectory

- **Type:** Line chart
- **X-axis:** Day (1-30), integer ticks
- **Y-axis:** Coherence Score (0-100)
- **Lines:** 4 series
  - Limen governed (solid blue, marker circle)
  - Limen ungoverned (dashed blue, marker triangle)
  - MemorySaver (solid gray, marker square)
  - SQLiteSaver (dashed gray, marker diamond)
- **Annotations:** Vertical dashed lines at failure injection days (5, 10, 15, 20, 25, 28) with labels
- **Shading:** 95% CI band around each line (alpha=0.15)
- **Threshold:** Horizontal red dashed line at C=50 (CRITICAL threshold)
- **Data source:** `day_aggregates[].metrics.coherence_score`

### Chart 2: Refusal Rate Timeline

- **Type:** Stacked area chart
- **X-axis:** Day (1-30), integer ticks
- **Y-axis:** Refusal Rate (0-100%)
- **Areas:** 4 stacked series (bottom to top)
  - Lagging (yellow, alpha=0.6)
  - Unverified (orange, alpha=0.6)
  - Divergent (red, alpha=0.6)
  - Rebuilding (purple, alpha=0.6)
- **Annotations:** Failure injection markers at days 5, 10, 15, 20, 25, 28
- **Data source:** `day_aggregates[].metrics.refusal_rate_*_pct`

### Chart 3: Token Efficiency Distribution

- **Type:** Dual chart (histogram + line overlay)
- **Histogram:**
  - **X-axis:** Tokens per step (0-2500, bin width=100)
  - **Y-axis (left):** Step count
  - **Bars:** Limen governed (blue), baseline overlay (gray, alpha=0.4)
- **Line overlay:**
  - **Y-axis (right):** Daily average tokens/step
  - **X-axis:** Day (1-30)
  - **Lines:** Limen governed (blue), MemorySaver (gray)
- **Threshold markers:** Vertical lines at 1000 (target, green), 1500 (warning, orange), 2000 (critical, red)
- **Data source:** `steps.jsonl` for histogram; `day_aggregates[].metrics.token_efficiency_avg` for trend

### Chart 4: Governance State Distribution

- **Type:** Stacked bar chart (100% height)
- **X-axis:** Day (1-30), integer ticks
- **Y-axis:** Percentage of steps in state (0-100%)
- **Bars:** 5 segments per day
  - Verified (green)
  - Lagging (yellow)
  - Unverified (orange)
  - Divergent (red)
  - Rebuilding (purple)
- **Annotations:** Failure injection labels above bars for days 5, 10, 15, 20, 25, 28
- **Data source:** Derived from `steps.jsonl` by counting `memory_ops.governance_state` per day

*End of Analysis Framework. All metric references verified against PHASE_2.2_BENCHMARK_DESIGN.md v1.0.0.*
