"""Phase 2.2 Benchmark Analysis — Post-Run Analysis Script.

Reads JSONL logs from run directories, calculates all 7 metrics using
scoring_functions.py, generates summary CSV, and compares multiple runs
for statistical analysis (Welch's t-test, Cohen's d).

Design doc reference: docs/PHASE_2.2_BENCHMARK_DESIGN.md section 3
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_run_summary(run_dir: Path) -> dict[str, Any]:
    """Load run_summary.json from a run directory."""
    path = run_dir / "run_summary.json"
    if not path.exists():
        raise FileNotFoundError(f"Run summary not found: {path}")
    with open(path, "r") as f:
        return json.load(f)


def load_day_aggregates(run_dir: Path) -> list[dict[str, Any]]:
    """Load day_aggregates.json from a run directory."""
    path = run_dir / "day_aggregates.json"
    if not path.exists():
        raise FileNotFoundError(f"Day aggregates not found: {path}")
    with open(path, "r") as f:
        return json.load(f)


def load_step_logs(run_dir: Path) -> list[dict[str, Any]]:
    """Load steps.jsonl from a run directory."""
    path = run_dir / "steps.jsonl"
    if not path.exists():
        raise FileNotFoundError(f"Step logs not found: {path}")
    entries: list[dict[str, Any]] = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries


# ---------------------------------------------------------------------------
# Metric extraction
# ---------------------------------------------------------------------------

def extract_metrics(run_dir: Path) -> dict[str, float]:
    """Extract all 7 metrics from a run directory.

    Returns dict with keys matching design doc metrics:
    - coherence_score_mean
    - audit_completeness_pct
    - refusal_rate_normal_pct
    - effective_confidence_day15_median
    - self_healing_rate
    - tamper_detection_rate
    - token_efficiency_mean
    """
    summary = load_run_summary(run_dir)
    fm = summary["final_metrics"]

    return {
        "coherence_score_mean": fm.get("coherence_score_mean", 0.0),
        "audit_completeness_pct": fm.get("audit_completeness_pct", 0.0),
        "refusal_rate_normal_pct": fm.get("refusal_rate_normal_pct", 0.0),
        "effective_confidence_day15_median": fm.get("effective_confidence_day15_median", 0.0) or 0.0,
        "self_healing_rate": fm.get("self_healing_rate", 0.0) or 0.0,
        "tamper_detection_rate": fm.get("tamper_detection_rate", 0.0) or 0.0,
        "token_efficiency_mean": fm.get("token_efficiency_mean", 0.0),
    }


def extract_daily_metrics(run_dir: Path) -> list[dict[str, Any]]:
    """Extract per-day metrics from a run directory."""
    return load_day_aggregates(run_dir)


# ---------------------------------------------------------------------------
# Statistical functions
# ---------------------------------------------------------------------------

def welch_t_test(
    group_a: list[float], group_b: list[float]
) -> dict[str, float]:
    """Perform Welch's t-test for two independent samples.

    Returns dict with t-statistic, degrees of freedom, and p-value estimate.
    Per design doc section 3.2: reject H0 at p < 0.05.
    """
    n_a = len(group_a)
    n_b = len(group_b)

    if n_a < 2 or n_b < 2:
        return {"t": 0.0, "df": 0.0, "p": 1.0, "significant": False}

    mean_a = sum(group_a) / n_a
    mean_b = sum(group_b) / n_b

    var_a = sum((x - mean_a) ** 2 for x in group_a) / (n_a - 1)
    var_b = sum((x - mean_b) ** 2 for x in group_b) / (n_b - 1)

    se_a = var_a / n_a
    se_b = var_b / n_b
    se_sum = se_a + se_b

    if se_sum == 0:
        return {"t": 0.0, "df": 0.0, "p": 1.0, "significant": False}

    t_stat = (mean_a - mean_b) / math.sqrt(se_sum)

    # Welch-Satterthwaite degrees of freedom
    df_num = se_sum**2
    df_den = (se_a**2 / (n_a - 1)) + (se_b**2 / (n_b - 1))
    df = df_num / df_den if df_den > 0 else 1.0

    # Conservative p-value estimate using t-distribution approximation
    # For small samples (n=3), use lookup table from design doc A.3
    p_value = _estimate_p_value(abs(t_stat), df)

    return {
        "t": round(t_stat, 4),
        "df": round(df, 2),
        "p": round(p_value, 6),
        "significant": p_value < 0.05,
    }


def cohens_d(group_a: list[float], group_b: list[float]) -> dict[str, Any]:
    """Calculate Cohen's d effect size.

    Per design doc section 3.2:
    d < 0.2: negligible | 0.2-0.5: small | 0.5-0.8: medium | > 0.8: large
    """
    n_a = len(group_a)
    n_b = len(group_b)

    if n_a < 2 or n_b < 2:
        return {"d": 0.0, "size": "negligible"}

    mean_a = sum(group_a) / n_a
    mean_b = sum(group_b) / n_b

    var_a = sum((x - mean_a) ** 2 for x in group_a) / (n_a - 1)
    var_b = sum((x - mean_b) ** 2 for x in group_b) / (n_b - 1)

    pooled_std = math.sqrt((var_a + var_b) / 2)
    if pooled_std == 0:
        return {"d": 0.0, "size": "negligible"}

    d = (mean_a - mean_b) / pooled_std

    # Classify effect size
    abs_d = abs(d)
    if abs_d < 0.2:
        size = "negligible"
    elif abs_d < 0.5:
        size = "small"
    elif abs_d < 0.8:
        size = "medium"
    else:
        size = "large"

    return {"d": round(d, 4), "size": size}


def _estimate_p_value(t_abs: float, df: float) -> float:
    """Estimate two-tailed p-value from t-statistic and df.

    Uses conservative critical value lookup from design doc Appendix A.3.
    For exact p-values, scipy would be needed; this is a conservative estimate.
    """
    # Critical t-values (two-tailed, alpha=0.05)
    # df=2 -> 4.303, df=3 -> 3.182, df=4 -> 2.776
    if df <= 2:
        critical = 4.303
    elif df <= 3:
        critical = 3.182
    elif df <= 4:
        critical = 2.776
    elif df <= 5:
        critical = 2.571
    elif df <= 10:
        critical = 2.228
    elif df <= 20:
        critical = 2.086
    elif df <= 30:
        critical = 2.042
    else:
        critical = 1.96

    # Conservative: if |t| > critical, p < 0.05; otherwise estimate
    if t_abs >= critical:
        # Rough estimate: p decreases as t increases beyond critical
        return 0.05 * (critical / t_abs) ** 2
    else:
        # Rough estimate: p > 0.05
        ratio = t_abs / critical
        return 0.05 + (1.0 - 0.05) * (1.0 - ratio)


# ---------------------------------------------------------------------------
# Multi-run comparison
# ---------------------------------------------------------------------------

def compare_runs(
    run_dirs: list[Path],
) -> dict[str, Any]:
    """Compare metrics across multiple runs.

    Per design doc section 3.2: 3 minimum runs per configuration.
    Reports mean +/- std for each metric, with per-run values.
    """
    all_metrics: list[dict[str, float]] = []
    for rd in run_dirs:
        metrics = extract_metrics(rd)
        all_metrics.append(metrics)

    if not all_metrics:
        return {"error": "No runs to compare"}

    # Aggregate per metric
    metric_names = list(all_metrics[0].keys())
    comparison: dict[str, Any] = {}

    for name in metric_names:
        values = [m[name] for m in all_metrics]
        mean_val = sum(values) / len(values)
        std_val = _std(values)
        comparison[name] = {
            "mean": round(mean_val, 4),
            "std": round(std_val, 4),
            "values": [round(v, 4) for v in values],
            "n": len(values),
        }

    return comparison


def compare_configurations(
    limen_dirs: list[Path],
    baseline_dirs: list[Path],
    baseline_name: str = "baseline",
) -> dict[str, Any]:
    """Compare Limen runs against a baseline configuration.

    Per design doc section 3.2: Welch's t-test, Cohen's d.
    """
    limen_metrics = [extract_metrics(d) for d in limen_dirs]
    baseline_metrics = [extract_metrics(d) for d in baseline_dirs]

    if not limen_metrics or not baseline_metrics:
        return {"error": "Insufficient data for comparison"}

    metric_names = list(limen_metrics[0].keys())
    results: dict[str, Any] = {}

    for name in metric_names:
        limen_values = [m[name] for m in limen_metrics]
        baseline_values = [m[name] for m in baseline_metrics]

        t_result = welch_t_test(limen_values, baseline_values)
        d_result = cohens_d(limen_values, baseline_values)

        limen_mean = sum(limen_values) / len(limen_values)
        limen_std = _std(limen_values)
        base_mean = sum(baseline_values) / len(baseline_values)
        base_std = _std(baseline_values)

        results[name] = {
            "limen": {
                "mean": round(limen_mean, 4),
                "std": round(limen_std, 4),
                "values": [round(v, 4) for v in limen_values],
            },
            baseline_name: {
                "mean": round(base_mean, 4),
                "std": round(base_std, 4),
                "values": [round(v, 4) for v in baseline_values],
            },
            "welch_t": t_result,
            "cohens_d": d_result,
        }

    return results


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def generate_summary_csv(
    run_dirs: list[Path], output_path: Path
) -> None:
    """Generate summary CSV comparing all runs.

    Per design doc section 3.2 reporting format.
    """
    rows: list[dict[str, Any]] = []

    for rd in run_dirs:
        summary = load_run_summary(rd)
        metrics = extract_metrics(rd)
        row = {
            "run_id": summary["run_id"],
            "saver_type": summary["saver_type"],
            "governed": summary["governed"],
            "total_steps": summary["total_steps"],
            "total_days": summary["total_days"],
            "pass": summary["pass"],
            **metrics,
            "total_tokens": summary["final_metrics"]["total_tokens"],
            "total_cost_usd": summary["final_metrics"]["total_cost_usd"],
        }
        rows.append(row)

    if not rows:
        return

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(rows[0].keys())
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def generate_comparison_report(
    comparison: dict[str, Any], output_path: Path
) -> None:
    """Generate a text comparison report.

    Matches the design doc section 3.2 reporting format:
    Metric: [name]
    Limen (governed):   mean +/- std  [run1, run2, run3]
    Welch t: t=[v], df=[v], p=[v]
    Cohen's d: [v] ([size])
    Pass: [YES/NO] -- [reason]
    """
    lines: list[str] = []
    lines.append("=" * 70)
    lines.append("PHASE 2.2 BENCHMARK — MULTI-RUN COMPARISON REPORT")
    lines.append("=" * 70)
    lines.append("")

    for metric_name, data in comparison.items():
        if metric_name == "error":
            lines.append(f"ERROR: {data}")
            continue

        lines.append(f"Metric: {metric_name}")
        lines.append("-" * 50)

        limen_data = data.get("limen", {})
        lines.append(
            f"  Limen:    {limen_data.get('mean', 'N/A')} +/- {limen_data.get('std', 'N/A')}  "
            f"{limen_data.get('values', [])}"
        )

        # Find baseline key (not 'limen', 'welch_t', 'cohens_d')
        baseline_keys = [
            k for k in data.keys() if k not in ("limen", "welch_t", "cohens_d")
        ]
        for bk in baseline_keys:
            bd = data[bk]
            lines.append(
                f"  {bk}:  {bd.get('mean', 'N/A')} +/- {bd.get('std', 'N/A')}  "
                f"{bd.get('values', [])}"
            )

        t_data = data.get("welch_t", {})
        lines.append(
            f"  Welch t: t={t_data.get('t', 'N/A')}, "
            f"df={t_data.get('df', 'N/A')}, p={t_data.get('p', 'N/A')}"
        )

        d_data = data.get("cohens_d", {})
        lines.append(
            f"  Cohen's d: {d_data.get('d', 'N/A')} ({d_data.get('size', 'N/A')})"
        )

        sig = t_data.get("significant", False)
        lines.append(f"  Significant (p<0.05): {'YES' if sig else 'NO'}")
        lines.append("")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        f.write("\n".join(lines))


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _std(data: list[float]) -> float:
    """Calculate sample standard deviation."""
    if len(data) < 2:
        return 0.0
    mean = sum(data) / len(data)
    variance = sum((x - mean) ** 2 for x in data) / (len(data) - 1)
    return variance**0.5


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Phase 2.2 Benchmark Analysis — Post-Run Comparison"
    )
    parser.add_argument(
        "--run-dirs",
        nargs="+",
        type=str,
        required=True,
        help="Paths to run result directories",
    )
    parser.add_argument(
        "--baseline-dirs",
        nargs="*",
        type=str,
        default=None,
        help="Paths to baseline run directories (for comparison)",
    )
    parser.add_argument(
        "--baseline-name",
        type=str,
        default="MemorySaver",
        help="Name of baseline configuration (default: MemorySaver)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="results/analysis",
        help="Output directory for analysis results",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    """CLI entry point."""
    args = parse_args(argv)

    run_dirs = [Path(d) for d in args.run_dirs]
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Validate run directories exist
    for rd in run_dirs:
        if not rd.exists():
            print(f"ERROR: Run directory not found: {rd}", file=sys.stderr)
            sys.exit(1)

    # Generate summary CSV
    csv_path = output_dir / "summary.csv"
    generate_summary_csv(run_dirs, csv_path)
    print(f"Summary CSV: {csv_path}")

    # Multi-run comparison
    comparison = compare_runs(run_dirs)
    print("\nRun Comparison:")
    for metric, data in comparison.items():
        if isinstance(data, dict) and "mean" in data:
            print(f"  {metric}: {data['mean']} +/- {data['std']} (n={data['n']})")

    # Baseline comparison if provided
    if args.baseline_dirs:
        baseline_dirs = [Path(d) for d in args.baseline_dirs]
        for bd in baseline_dirs:
            if not bd.exists():
                print(f"WARNING: Baseline dir not found: {bd}", file=sys.stderr)
                baseline_dirs.remove(bd)

        if baseline_dirs:
            config_comparison = compare_configurations(
                run_dirs, baseline_dirs, args.baseline_name
            )
            report_path = output_dir / "comparison_report.txt"
            generate_comparison_report(config_comparison, report_path)
            print(f"\nComparison report: {report_path}")

    print(f"\nAnalysis complete. Results in: {output_dir}")


if __name__ == "__main__":
    main()
