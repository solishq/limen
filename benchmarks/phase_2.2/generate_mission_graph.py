#!/usr/bin/env python3
"""Generate mission_graph.yaml: 30 days, 75 steps/day = 2250 steps.

Failure injection schedule from design doc:
  - tamper: days 5, 12, 19, 26
  - conflicts: days 8, 15, 22, 29
  - policy_violation: days 3, 10, 17, 24

Input distribution per day (75 steps):
  40% claims = 30 steps
  25% queries = 19 steps (18.75 rounded up)
  15% governance = 11 steps (11.25 rounded down)
  10% conflicts = 7 steps (7.5 rounded down)
  10% maintenance = 8 steps (remainder to hit 75)
"""

import yaml
import random
import sys

random.seed(42)  # Reproducible

DAYS = 30
STEPS_PER_DAY = 75
TOTAL_STEPS = DAYS * STEPS_PER_DAY  # 2250

# Failure injection schedule
TAMPER_DAYS = {5, 12, 19, 26}
CONFLICT_DAYS = {8, 15, 22, 29}
POLICY_DAYS = {3, 10, 17, 24}

# Token budget ranges by type
TOKEN_BUDGETS = {
    "claim": {"input": (4000, 8000), "output": (1000, 2000)},
    "query": {"input": (2000, 6000), "output": (500, 1500)},
    "governance": {"input": (1000, 4000), "output": (500, 1000)},
    "conflict": {"input": (4000, 8000), "output": (1500, 3000)},
    "maintenance": {"input": (1000, 3000), "output": (500, 1000)},
}

# Per-day step type distribution (total = 75)
DISTRIBUTION = [
    ("claim", 30),
    ("query", 19),
    ("governance", 11),
    ("conflict", 7),
    ("maintenance", 8),
]
assert sum(c for _, c in DISTRIBUTION) == STEPS_PER_DAY

# Branch configuration: 3 branches per day, each forking from a random step
BRANCHES_PER_DAY = 3


def failure_injection_for(day: int, step_in_day: int) -> dict | None:
    """Determine failure injection for a given day and step position.

    Injections happen at specific steps within injection days:
    - tamper: steps 20, 40, 60 within the day
    - conflict: steps 15, 30, 45, 55, 65 within the day
    - policy_violation: steps 25, 50 within the day
    """
    if day in TAMPER_DAYS:
        tamper_steps = {20, 40, 60}
        if step_in_day in tamper_steps:
            return {"type": "tamper", "probability": 1.0}
    if day in CONFLICT_DAYS:
        conflict_steps = {15, 30, 45, 55, 65}
        if step_in_day in conflict_steps:
            return {"type": "conflict", "probability": 0.8}
    if day in POLICY_DAYS:
        policy_steps = {25, 50}
        if step_in_day in policy_steps:
            return {"type": "policy_violation", "probability": 0.7}
    return None


def token_budget(step_type: str) -> dict:
    ranges = TOKEN_BUDGETS[step_type]
    return {
        "input": random.randint(*ranges["input"]),
        "output": random.randint(*ranges["output"]),
    }


def generate_branch(day: int, source_step_id: int, global_step: int) -> dict | None:
    """Generate a branch fork specification."""
    fork_a = global_step + STEPS_PER_DAY * 100 + random.randint(1, 999)
    fork_b = fork_a + 1
    return {"fork_to": [fork_a, fork_b]}


def build_graph() -> dict:
    graph = {
        "mission_graph": {
            "name": "limen-langgraph-30day-benchmark",
            "version": "1.0.0",
            "duration_days": DAYS,
            "steps_per_day": STEPS_PER_DAY,
            "total_steps": TOTAL_STEPS,
            "thread_topology": {
                "main_thread": "benchmark-main",
                "branches_per_day": BRANCHES_PER_DAY,
                "branch_pattern": "fork-execute-merge",
            },
            "tenant_config": {
                "primary_tenant": "tenant-alpha",
                "probe_tenant": "tenant-beta",
            },
            "input_distribution": {
                "claim": {"weight": 0.40, "count_per_day": 30},
                "query": {"weight": 0.25, "count_per_day": 19},
                "governance": {"weight": 0.15, "count_per_day": 11},
                "conflict": {"weight": 0.10, "count_per_day": 7},
                "maintenance": {"weight": 0.10, "count_per_day": 8},
            },
        },
        "days": [],
    }

    global_step = 0
    # Pre-select branch steps for each day (3 per day)
    for day_num in range(1, DAYS + 1):
        # Build the step type sequence for this day
        step_types: list[str] = []
        for stype, count in DISTRIBUTION:
            step_types.extend([stype] * count)
        random.shuffle(step_types)

        # Pick 3 random positions for branch forks
        branch_positions = set(random.sample(range(STEPS_PER_DAY), BRANCHES_PER_DAY))

        day_steps = []
        for i, stype in enumerate(step_types):
            global_step += 1
            step_in_day = i + 1

            fi = failure_injection_for(day_num, step_in_day)
            branch = None
            if i in branch_positions:
                branch = generate_branch(day_num, global_step, global_step)

            step = {
                "step_id": global_step,
                "type": stype,
                "tokens_budget": token_budget(stype),
                "failure_injection": fi,
                "branch": branch,
            }
            day_steps.append(step)

        graph["days"].append({"day": day_num, "steps": day_steps})

    return graph


def main():
    graph = build_graph()

    # Validate totals
    total = sum(len(d["steps"]) for d in graph["days"])
    assert total == TOTAL_STEPS, f"Expected {TOTAL_STEPS}, got {total}"

    output_path = "/Users/solishq/Projects/limen/benchmarks/phase_2.2/mission_graph.yaml"
    with open(output_path, "w") as f:
        yaml.dump(graph, f, default_flow_style=False, sort_keys=False, width=120)

    print(f"Generated {output_path}: {DAYS} days, {total} steps")

    # Count failure injections
    fi_count = 0
    for d in graph["days"]:
        for s in d["steps"]:
            if s["failure_injection"] is not None:
                fi_count += 1
    print(f"Failure injections: {fi_count}")

    # Count branches
    br_count = sum(
        1 for d in graph["days"] for s in d["steps"] if s["branch"] is not None
    )
    print(f"Branch forks: {br_count}")


if __name__ == "__main__":
    main()
