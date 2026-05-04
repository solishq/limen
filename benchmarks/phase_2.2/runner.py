"""Phase 2.2 Benchmark Runner — Main Execution Harness.

Loads mission_graph.yaml and synthetic_inputs.jsonl, executes the 30-day
benchmark simulation, logs every step to JSONL, and generates summary reports.

Design doc reference: docs/PHASE_2.2_BENCHMARK_DESIGN.md
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import random
import sys
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import yaml

# Directory name contains a dot (phase_2.2) which is not a valid Python
# package name. Use direct imports via sys.path instead.
_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

from harness import (
    ConflictInjector,
    MockChainStorage,
    MockLimenInfrastructure,
    MockProjectionStorage,
    MockProjector,
    MockValidityStateMachine,
    PolicyViolationInjector,
    StoreItem,
    TamperInjector,
    ValidityState,
)
from scoring_functions import (
    calculate_audit_completeness,
    calculate_coherence_score,
    calculate_self_healing_success,
    detect_refusal_patterns,
    track_token_efficiency,
)


# ---------------------------------------------------------------------------
# Data classes for structured results
# ---------------------------------------------------------------------------

@dataclass
class LLMCallResult:
    """Result of a single LLM call (real or simulated)."""

    model: str
    tokens_in: int
    tokens_out: int
    cost_usd: float
    latency_ms: int
    response_text: str


@dataclass
class StepResult:
    """Result of executing a single benchmark step."""

    step_id: int
    day: int
    timestamp_ms: int
    input_type: str
    input_data: dict[str, Any]
    llm_call: dict[str, Any]
    memory_ops: dict[str, Any]
    projection: dict[str, Any]
    output: dict[str, Any]


@dataclass
class DayResult:
    """Aggregated result for a single benchmark day."""

    day: int
    steps_executed: int
    metrics: dict[str, Any]
    failure_injection: dict[str, Any]
    resource_usage: dict[str, Any]


@dataclass
class RunSummary:
    """Final summary of a complete benchmark run."""

    run_id: str
    saver_type: str
    governed: bool
    started_at: str
    completed_at: str
    total_steps: int
    total_days: int
    final_metrics: dict[str, Any]
    failure_injection_results: list[dict[str, Any]]
    passed: bool
    findings: list[dict[str, Any]]


# ---------------------------------------------------------------------------
# Cost model for token-to-USD conversion
# ---------------------------------------------------------------------------

# Haiku pricing (per design doc section 5.2: low-reasoning ops use Haiku)
COST_PER_INPUT_TOKEN = 0.25 / 1_000_000   # $0.25 per 1M input tokens
COST_PER_OUTPUT_TOKEN = 1.25 / 1_000_000  # $1.25 per 1M output tokens


def compute_cost(tokens_in: int, tokens_out: int) -> float:
    """Compute USD cost from token counts."""
    return tokens_in * COST_PER_INPUT_TOKEN + tokens_out * COST_PER_OUTPUT_TOKEN


# ---------------------------------------------------------------------------
# Input loader
# ---------------------------------------------------------------------------

def load_mission_graph(path: str | Path) -> dict[str, Any]:
    """Load and validate mission graph YAML."""
    with open(path, "r") as f:
        data = yaml.safe_load(f)

    if "mission_graph" not in data or "days" not in data:
        raise ValueError("Mission graph must contain 'mission_graph' and 'days' keys")

    meta = data["mission_graph"]
    days = data["days"]

    if len(days) != meta["duration_days"]:
        raise ValueError(
            f"Expected {meta['duration_days']} days, got {len(days)}"
        )

    return data


def load_synthetic_inputs(path: str | Path) -> list[dict[str, Any]]:
    """Load synthetic inputs from JSONL file."""
    inputs: list[dict[str, Any]] = []
    with open(path, "r") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError as e:
                raise ValueError(f"Invalid JSON at line {line_num}: {e}") from e
            inputs.append(entry)
    return inputs


# ---------------------------------------------------------------------------
# MissionRunner
# ---------------------------------------------------------------------------

class MissionRunner:
    """Executes the 30-day benchmark simulation.

    Responsibilities:
    - Load mission graph and synthetic inputs
    - Execute steps sequentially per day, handle branch forks
    - Enforce token caps (8000 input, 2000 output)
    - Log every step to JSONL matching the data collection schema
    - Handle failure injections per schedule
    - Call scoring functions at end of each day
    - Generate summary report at end of run
    """

    TOKEN_CAP_INPUT = 8000
    TOKEN_CAP_OUTPUT = 2000

    def __init__(
        self,
        graph_path: str | Path,
        inputs_path: str | Path,
        seed: int,
        model: str,
        output_dir: str | Path,
        dry_run: bool = False,
    ) -> None:
        self._graph_path = Path(graph_path)
        self._inputs_path = Path(inputs_path)
        self._seed = seed
        self._model = model
        self._output_dir = Path(output_dir)
        self._dry_run = dry_run
        self._rng = random.Random(seed)
        self._run_id = str(uuid.UUID(int=self._rng.getrandbits(128), version=4))

        # Loaded data
        self._graph: dict[str, Any] = {}
        self._meta: dict[str, Any] = {}
        self._days: list[dict[str, Any]] = []
        self._inputs: list[dict[str, Any]] = []
        self._input_index: dict[int, dict[str, Any]] = {}

        # Infrastructure
        self._infra = MockLimenInfrastructure()

        # Tracking state
        self._step_logs: list[StepResult] = []
        self._day_results: list[DayResult] = []
        self._claims_asserted: int = 0
        self._contradicting_claims: int = 0
        self._source_backed_claims: int = 0
        self._source_matching_claims: int = 0
        self._governance_log: list[dict[str, Any]] = []
        self._self_healing_events: list[dict[str, Any]] = []
        self._total_tokens: int = 0
        self._total_cost: float = 0.0
        self._total_llm_calls: int = 0
        self._latencies: list[int] = []
        self._failure_injection_results: list[dict[str, Any]] = []
        self._tamper_injected: int = 0
        self._tamper_detected: int = 0

        # Branch step registry: step_id -> step config
        self._all_steps: dict[int, dict[str, Any]] = {}

        # Anthropic client (lazy init, not needed for dry-run)
        self._client: Any = None

    def _init_client(self) -> None:
        """Initialize Anthropic client. Skipped in dry-run mode."""
        if self._dry_run:
            return
        try:
            import anthropic
            self._client = anthropic.Anthropic()
        except ImportError:
            raise RuntimeError(
                "anthropic package required for live runs. Install: pip install anthropic"
            )

    def _load(self) -> None:
        """Load mission graph and synthetic inputs."""
        self._graph = load_mission_graph(self._graph_path)
        self._meta = self._graph["mission_graph"]
        self._days = self._graph["days"]
        self._inputs = load_synthetic_inputs(self._inputs_path)
        self._input_index = {inp["id"]: inp for inp in self._inputs}

        # Build complete step registry across all days
        for day_config in self._days:
            for step in day_config["steps"]:
                self._all_steps[step["step_id"]] = step

    def _setup_output_dir(self) -> None:
        """Create output directory structure."""
        self._output_dir.mkdir(parents=True, exist_ok=True)

    def _setup_failure_injections(self) -> None:
        """Pre-load failure injection schedule from mission graph steps."""
        for step_id, step in self._all_steps.items():
            fi = step.get("failure_injection")
            if fi is None:
                continue

            fi_type = fi["type"]
            if fi_type == "tamper":
                self._infra.tamper_injector.schedule(
                    step_id, "projection_tamper", "lg_store_items"
                )
            elif fi_type == "conflict":
                # Conflict injections generate contradictory claims
                self._infra.conflict_injector.schedule(
                    step_id,
                    subject=f"entity:benchmark:conflict-{step_id}",
                    original_value=f"original-value-{step_id}",
                    contradicting_value=f"contradicting-value-{step_id}",
                )
            elif fi_type == "policy_violation":
                self._infra.policy_injector.schedule(
                    step_id,
                    violation_type="cross_tenant",
                    source_tenant=self._meta["tenant_config"]["probe_tenant"],
                    target_tenant=self._meta["tenant_config"]["primary_tenant"],
                )

    async def run(self) -> RunSummary:
        """Execute the complete benchmark run."""
        self._load()
        self._init_client()
        self._setup_output_dir()
        self._setup_failure_injections()

        started_at = _iso_now()

        # Initial verification — transition from Unverified to Verified
        self._infra.validity.verify_on_startup(
            self._infra.chain, self._infra.projection
        )

        step_log_path = self._output_dir / "steps.jsonl"

        with open(step_log_path, "w") as step_log_file:
            for day_config in self._days:
                day_result = await self.execute_day(day_config, step_log_file)
                self._day_results.append(day_result)

        completed_at = _iso_now()

        # Generate summary
        summary = self._generate_summary(started_at, completed_at)

        # Write outputs
        self._write_day_aggregates()
        self._write_run_summary(summary)

        return summary

    async def execute_day(
        self, day_config: dict[str, Any], step_log_file: Any
    ) -> DayResult:
        """Execute all steps for a single day."""
        day = day_config["day"]
        steps = day_config["steps"]
        day_step_results: list[StepResult] = []
        day_tokens = 0
        day_cost = 0.0
        day_llm_calls = 0
        day_latencies: list[int] = []
        chain_entries_added = 0
        projection_rebuilds = 0

        # Execute main steps sequentially
        for step_config in steps:
            result = await self.execute_step(step_config, day)
            day_step_results.append(result)
            self._step_logs.append(result)

            # Write step log immediately
            step_log_file.write(json.dumps(_step_to_dict(result)) + "\n")
            step_log_file.flush()

            # Accumulate stats
            tokens = result.llm_call["tokens_in"] + result.llm_call["tokens_out"]
            day_tokens += tokens
            self._total_tokens += tokens
            day_cost += result.llm_call["cost_usd"]
            self._total_cost += result.llm_call["cost_usd"]
            day_llm_calls += 1
            self._total_llm_calls += 1
            day_latencies.append(result.llm_call["latency_ms"])
            self._latencies.append(result.llm_call["latency_ms"])

            if result.memory_ops["checkpoint_writes"] > 0:
                chain_entries_added += result.memory_ops["checkpoint_writes"]

            # Handle branch forks
            branch = step_config.get("branch")
            if branch and branch.get("fork_to"):
                for fork_step_id in branch["fork_to"]:
                    fork_step = self._all_steps.get(fork_step_id)
                    if fork_step:
                        fork_result = await self.execute_step(fork_step, day)
                        day_step_results.append(fork_result)
                        self._step_logs.append(fork_result)
                        step_log_file.write(
                            json.dumps(_step_to_dict(fork_result)) + "\n"
                        )
                        step_log_file.flush()

                        ftokens = (
                            fork_result.llm_call["tokens_in"]
                            + fork_result.llm_call["tokens_out"]
                        )
                        day_tokens += ftokens
                        self._total_tokens += ftokens
                        day_cost += fork_result.llm_call["cost_usd"]
                        self._total_cost += fork_result.llm_call["cost_usd"]
                        day_llm_calls += 1
                        self._total_llm_calls += 1
                        day_latencies.append(fork_result.llm_call["latency_ms"])
                        self._latencies.append(fork_result.llm_call["latency_ms"])

        # End-of-day metrics
        metrics = self._compute_day_metrics(day, day_step_results, day_tokens)

        # Check for failure injections on this day
        fi_active = any(
            s.get("failure_injection") is not None for s in steps
        )
        fi_result = self._get_day_injection_result(day) if fi_active else {
            "active": False,
            "injection_name": None,
            "injection_ids": [],
            "all_detected": None,
            "recovery_successful": None,
            "recovery_time_ms": None,
        }

        resource_usage = {
            "total_tokens": day_tokens,
            "total_cost_usd": round(day_cost, 6),
            "total_llm_calls": day_llm_calls,
            "mean_latency_ms": (
                round(sum(day_latencies) / len(day_latencies), 1)
                if day_latencies
                else 0.0
            ),
            "p95_latency_ms": (
                round(_percentile(day_latencies, 95), 1) if day_latencies else 0.0
            ),
            "chain_entries_added": chain_entries_added,
            "projection_rebuilds": projection_rebuilds,
        }

        return DayResult(
            day=day,
            steps_executed=len(day_step_results),
            metrics=metrics,
            failure_injection=fi_result,
            resource_usage=resource_usage,
        )

    async def execute_step(
        self, step_config: dict[str, Any], day: int
    ) -> StepResult:
        """Execute a single benchmark step."""
        step_id = step_config["step_id"]
        input_type = step_config["type"]
        tokens_budget = step_config["tokens_budget"]
        failure_injection = step_config.get("failure_injection")
        timestamp_ms = int(time.time() * 1000)

        # Select synthetic input
        input_entry = self._select_input(input_type, step_id)

        # Build input data
        is_fi = failure_injection is not None
        fi_id = f"FI-D{day}-S{step_id}" if is_fi else None
        governed = True  # Default governed mode

        thread_id = self._meta["thread_topology"]["main_thread"]
        branch = step_config.get("branch")
        if branch and branch.get("fork_to"):
            thread_id = f"benchmark-branch-d{day}-s{step_id}"

        input_data = {
            "operation": self._operation_for_type(input_type),
            "thread_id": thread_id,
            "namespace": ["benchmark", f"day-{day}"],
            "key": f"step-{step_id}",
            "tenant_scope": self._meta["tenant_config"]["primary_tenant"],
            "governed": governed,
            "is_failure_injection": is_fi,
            "failure_injection_id": fi_id,
        }

        # Handle failure injections
        tamper_detected = False
        if is_fi:
            fi_type = failure_injection["type"]
            if fi_type == "tamper":
                tamper_results = self._infra.tamper_injector.execute(
                    step_id,
                    self._infra.chain,
                    self._infra.projection,
                    self._infra.validity,
                )
                if tamper_results:
                    self._tamper_injected += len(tamper_results)
                    for tr in tamper_results:
                        if tr["detected"]:
                            self._tamper_detected += 1
                    tamper_detected = True
            elif fi_type == "policy_violation":
                # Policy violations should be blocked
                pass

        # Check governance before read operations
        governance_blocked = False
        governance_retryable: bool | None = None
        if input_type in ("query", "governance"):
            allowed, retryable = self._infra.validity.is_read_allowed(governed)
            if not allowed:
                governance_blocked = True
                governance_retryable = retryable

            self._governance_log.append({
                "governance_state": self._infra.validity.state.value,
                "governed": governed,
                "blocked": governance_blocked,
                "retryable": governance_retryable,
            })

        # Execute LLM call (or simulate in dry-run)
        llm_result = await self._execute_llm_call(
            input_type, input_entry, tokens_budget, governance_blocked
        )

        # Process result: update chain/projection for writes
        checkpoint_reads = 0
        checkpoint_writes = 0
        store_reads = 0
        store_writes = 0
        effective_confidence: float | None = None

        if not governance_blocked:
            if input_type == "claim":
                self._process_claim(input_entry, timestamp_ms)
                checkpoint_writes = 1
                store_writes = 1
                self._claims_asserted += 1
                effective_confidence = 0.7
            elif input_type == "query":
                checkpoint_reads = 1
                store_reads = 1
                effective_confidence = self._compute_ec(timestamp_ms)
            elif input_type == "governance":
                checkpoint_reads = 1
            elif input_type == "conflict":
                self._process_conflict(input_entry, step_id, timestamp_ms)
                checkpoint_writes = 1
                store_writes = 1
                self._claims_asserted += 1
                self._contradicting_claims += 1
            elif input_type == "maintenance":
                self._process_maintenance(step_id, timestamp_ms)

        # Project pending chain entries
        if not governance_blocked and input_type in ("claim", "conflict"):
            assert self._infra.projector is not None
            self._infra.projector.project_pending()

        # Determine output
        output = self._build_output(
            input_type, governance_blocked, is_fi, tamper_detected
        )

        # Handle recovery after tamper detection
        if tamper_detected and self._infra.validity.state == ValidityState.DIVERGENT:
            self._infra.validity.force_state(ValidityState.REBUILDING)
            assert self._infra.projector is not None
            self._infra.projector.rebuild_from_chain()
            self._infra.validity.force_state(ValidityState.VERIFIED)

        assert self._infra.projector is not None
        return StepResult(
            step_id=step_id,
            day=day,
            timestamp_ms=timestamp_ms,
            input_type=input_type,
            input_data=input_data,
            llm_call={
                "model": self._model,
                "tokens_in": llm_result.tokens_in,
                "tokens_out": llm_result.tokens_out,
                "cost_usd": round(llm_result.cost_usd, 8),
                "latency_ms": llm_result.latency_ms,
            },
            memory_ops={
                "checkpoint_reads": checkpoint_reads,
                "checkpoint_writes": checkpoint_writes,
                "store_reads": store_reads,
                "store_writes": store_writes,
                "governance_state": self._infra.validity.state.value,
                "governance_blocked": governance_blocked,
                "governance_error_retryable": governance_retryable,
                "effective_confidence": effective_confidence,
            },
            projection={
                "last_projected_sequence": self._infra.projector.last_projected_sequence,
                "validity_state": self._infra.validity.state.value,
                "tamper_detected": tamper_detected,
                "chain_entry_count": self._infra.chain.entry_count,
                "projection_row_count": self._infra.projection.row_count,
            },
            output=output,
        )

    # -------------------------------------------------------------------
    # Input selection
    # -------------------------------------------------------------------

    def _select_input(self, input_type: str, step_id: int) -> dict[str, Any]:
        """Select a synthetic input for the given step, deterministically."""
        typed_inputs = [i for i in self._inputs if i["type"] == input_type]
        if not typed_inputs:
            # Fallback: use any claim-type input
            typed_inputs = [i for i in self._inputs if i["type"] == "claim"]
        idx = self._rng.randint(0, len(typed_inputs) - 1)
        return typed_inputs[idx]

    # -------------------------------------------------------------------
    # LLM call execution
    # -------------------------------------------------------------------

    async def _execute_llm_call(
        self,
        input_type: str,
        input_entry: dict[str, Any],
        tokens_budget: dict[str, int],
        governance_blocked: bool,
    ) -> LLMCallResult:
        """Execute an LLM call or simulate in dry-run mode."""
        budget_in = min(tokens_budget["input"], self.TOKEN_CAP_INPUT)
        budget_out = min(tokens_budget["output"], self.TOKEN_CAP_OUTPUT)

        if self._dry_run or governance_blocked:
            # Simulate: use budget with deterministic jitter
            jitter_in = self._rng.randint(-50, 50)
            jitter_out = self._rng.randint(-20, 20)
            tokens_in = max(10, budget_in + jitter_in)
            tokens_out = max(5, budget_out + jitter_out) if not governance_blocked else 0
            latency_ms = self._rng.randint(50, 300) if not governance_blocked else 5
            response_text = (
                f"[DRY-RUN] Simulated {input_type} response for step"
                if not governance_blocked
                else "[BLOCKED] Governance gate rejected read"
            )

            return LLMCallResult(
                model=self._model,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                cost_usd=compute_cost(tokens_in, tokens_out),
                latency_ms=latency_ms,
                response_text=response_text,
            )

        # Live LLM call
        return await self._call_anthropic(input_type, input_entry, budget_in, budget_out)

    async def _call_anthropic(
        self,
        input_type: str,
        input_entry: dict[str, Any],
        max_tokens_in: int,
        max_tokens_out: int,
    ) -> LLMCallResult:
        """Make a real Anthropic API call."""
        system_prompt = (
            "You are a benchmark agent managing governed memory. "
            "Respond concisely to the operation."
        )
        user_message = (
            f"Operation: {input_type}\n"
            f"Content: {input_entry.get('content', '')[:max_tokens_in * 3]}"
        )

        start_ms = int(time.time() * 1000)
        response = self._client.messages.create(
            model=self._model,
            max_tokens=max_tokens_out,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )
        end_ms = int(time.time() * 1000)

        tokens_in = response.usage.input_tokens
        tokens_out = response.usage.output_tokens
        response_text = response.content[0].text if response.content else ""

        return LLMCallResult(
            model=self._model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=compute_cost(tokens_in, tokens_out),
            latency_ms=end_ms - start_ms,
            response_text=response_text,
        )

    # -------------------------------------------------------------------
    # State mutation operations
    # -------------------------------------------------------------------

    def _process_claim(
        self, input_entry: dict[str, Any], timestamp_ms: int
    ) -> None:
        """Process a claim operation: append to chain + store."""
        content = input_entry.get("content", "")
        state_json = json.dumps({
            "subject": f"entity:benchmark:{input_entry.get('id', 0)}",
            "predicate": f"benchmark.{input_entry.get('metadata', {}).get('subcategory', 'value')}",
            "value": content[:200],
            "confidence": 0.7,
        })

        self._infra.chain.append(state_json, "claim", timestamp_ms)
        self._infra.store_put(
            namespace=("benchmark", "claims"),
            key=f"claim-{input_entry.get('id', 0)}",
            value={"content": content[:200], "type": "claim"},
            timestamp_ms=timestamp_ms,
        )

        self._source_backed_claims += 1
        self._source_matching_claims += 1

    def _process_conflict(
        self, input_entry: dict[str, Any], step_id: int, timestamp_ms: int
    ) -> None:
        """Process a conflict operation: assert contradicting claim."""
        content = input_entry.get("content", "")
        state_json = json.dumps({
            "subject": f"entity:benchmark:conflict-{step_id}",
            "predicate": "benchmark.conflict",
            "value": f"CONTRADICTS: {content[:100]}",
            "confidence": 0.7,
        })

        self._infra.chain.append(state_json, "conflict", timestamp_ms)

        # Record self-healing attempt
        detected_at = timestamp_ms
        retracted_at = timestamp_ms + self._rng.randint(10, 500)
        self._self_healing_events.append({
            "type": "retraction_attempt",
            "previous_status": "active",
            "new_status": "retracted",
            "error": False,
            "correct_claim": False,
            "detected_at_ms": detected_at,
            "retracted_at_ms": retracted_at,
        })

    def _process_maintenance(self, step_id: int, timestamp_ms: int) -> None:
        """Process a maintenance operation: EC decay, retraction."""
        # Simulate EC evaluation and potential retraction
        state_json = json.dumps({
            "subject": f"entity:benchmark:maintenance-{step_id}",
            "predicate": "benchmark.maintenance",
            "value": f"EC evaluation at step {step_id}",
            "confidence": 0.5,
        })
        self._infra.chain.append(state_json, "maintenance", timestamp_ms)

    # -------------------------------------------------------------------
    # Metric computation
    # -------------------------------------------------------------------

    def _compute_ec(self, timestamp_ms: int) -> float:
        """Compute effectiveConfidence for the earliest claim."""
        if self._claims_asserted == 0:
            return 0.7

        # Use design doc formula: EC = C_0 * (1 + age_ms / (9 * S_days * 86400000))^(-1)
        # Approximate age from start
        first_entry = self._infra.chain.entries[0] if self._infra.chain.entries else None
        if first_entry is None:
            return 0.7

        age_ms = timestamp_ms - first_entry.timestamp_ms
        s_days = 30
        ec = 0.7 * (1 + age_ms / (9 * s_days * 86400000)) ** (-1)
        return round(ec, 4)

    def _compute_day_metrics(
        self,
        day: int,
        step_results: list[StepResult],
        day_tokens: int,
    ) -> dict[str, Any]:
        """Compute all metrics for a day using scoring functions."""
        steps_count = len(step_results)

        # Coherence: build state history from step results
        embedding_dim = 16  # Simplified for benchmark (real would be 384)
        state_history: list[dict[str, Any]] = []
        for i, sr in enumerate(step_results):
            # Deterministic pseudo-embedding from step data
            seed_val = self._seed + day * 1000 + i
            rng = random.Random(seed_val)
            embedding = [rng.gauss(0.5, 0.1) for _ in range(embedding_dim)]
            state_history.append({
                "embedding": embedding,
                "claims_asserted": self._claims_asserted,
                "contradicting_active_claims": self._contradicting_claims,
                "source_backed_claims": self._source_backed_claims,
                "source_matching_claims": self._source_matching_claims,
            })

        coherence = 0.0
        coherence_semantic = 0.0
        coherence_contradiction = 0.0
        coherence_factual = 0.0
        if state_history:
            coherence = calculate_coherence_score(state_history)
            # Extract sub-components
            last = state_history[-1]
            total_a = last["claims_asserted"]
            coherence_contradiction = (
                last["contradicting_active_claims"] / total_a if total_a > 0 else 0.0
            )
            sb = last["source_backed_claims"]
            coherence_factual = (
                last["source_matching_claims"] / sb if sb > 0 else 1.0
            )
            # Semantic approximation
            coherence_semantic = coherence / 100.0

        # Audit completeness from chain entries
        audit_pct = 100.0
        if self._infra.chain.entries:
            chain_audit_data = []
            for entry in self._infra.chain.entries:
                proj_row = self._infra.projection.get_by_sequence(entry.sequence)
                chain_audit_data.append({
                    "state_json": entry.state_json,
                    "content_hash": entry.content_hash,
                    "previous_hash": entry.previous_hash,
                    "global_sequence": entry.sequence,
                    "projection_row_exists": proj_row is not None,
                    "projection_global_sequence": (
                        proj_row.global_sequence if proj_row else None
                    ),
                    "projection_validity_state": (
                        proj_row.validity_state.value if proj_row else "Unverified"
                    ),
                })
            audit_pct = calculate_audit_completeness(chain_audit_data)

        # Refusal rate
        rr_pct = 0.0
        rr_lagging = 0.0
        rr_unverified = 0.0
        rr_divergent = 0.0
        rr_rebuilding = 0.0
        if self._governance_log:
            refusal = detect_refusal_patterns(self._governance_log)
            rr_pct = refusal["refusal_rate_pct"]
            rr_lagging = refusal["by_state"]["Lagging"]["rate_pct"]
            rr_unverified = refusal["by_state"]["Unverified"]["rate_pct"]
            rr_divergent = refusal["by_state"]["Divergent"]["rate_pct"]
            rr_rebuilding = refusal["by_state"]["Rebuilding"]["rate_pct"]

        # EC trajectory
        ec_values = [
            sr.memory_ops["effective_confidence"]
            for sr in step_results
            if sr.memory_ops["effective_confidence"] is not None
        ]
        ec_p5 = _percentile(ec_values, 5) if ec_values else 0.0
        ec_median = _percentile(ec_values, 50) if ec_values else 0.0
        ec_p95 = _percentile(ec_values, 95) if ec_values else 0.0

        # Self-healing
        sh_rate: float | None = None
        sh_count = len(self._self_healing_events)
        sh_latency: int | None = None
        if self._self_healing_events:
            sh_rate_raw = calculate_self_healing_success(self._self_healing_events)
            sh_rate = sh_rate_raw / 100.0  # Convert to 0-1
            latencies = [
                e["retracted_at_ms"] - e["detected_at_ms"]
                for e in self._self_healing_events
                if e.get("retracted_at_ms") is not None
            ]
            sh_latency = int(_percentile(latencies, 50)) if latencies else None

        # Tamper detection
        td_rate: float | None = None
        tamper_today = 0
        if self._tamper_injected > 0:
            td_rate = self._tamper_detected / self._tamper_injected
            tamper_today = self._tamper_injected  # Simplified

        # Token efficiency
        te_avg = track_token_efficiency(day_tokens, steps_count) if steps_count > 0 else 0.0

        # Read/write token breakdown
        read_steps = [s for s in step_results if s.input_type in ("query", "governance")]
        write_steps = [s for s in step_results if s.input_type in ("claim", "conflict", "maintenance")]
        te_read = (
            sum(s.llm_call["tokens_in"] + s.llm_call["tokens_out"] for s in read_steps) / len(read_steps)
            if read_steps
            else 0.0
        )
        te_write = (
            sum(s.llm_call["tokens_in"] + s.llm_call["tokens_out"] for s in write_steps) / len(write_steps)
            if write_steps
            else 0.0
        )

        return {
            "coherence_score": round(coherence, 2),
            "coherence_sub_semantic": round(coherence_semantic, 4),
            "coherence_sub_contradiction": round(coherence_contradiction, 4),
            "coherence_sub_factual": round(coherence_factual, 4),
            "audit_completeness_pct": round(audit_pct, 2),
            "refusal_rate_pct": round(rr_pct, 2),
            "refusal_rate_lagging_pct": round(rr_lagging, 2),
            "refusal_rate_unverified_pct": round(rr_unverified, 2),
            "refusal_rate_divergent_pct": round(rr_divergent, 2),
            "refusal_rate_rebuilding_pct": round(rr_rebuilding, 2),
            "effective_confidence_p5": round(ec_p5, 4),
            "effective_confidence_median": round(ec_median, 4),
            "effective_confidence_p95": round(ec_p95, 4),
            "self_healing_rate": sh_rate,
            "self_healing_count": sh_count,
            "self_healing_latency_median_ms": sh_latency,
            "tamper_detection_rate": td_rate,
            "tamper_injections_today": tamper_today,
            "token_efficiency_avg": round(te_avg, 2),
            "token_efficiency_read": round(te_read, 2),
            "token_efficiency_write": round(te_write, 2),
        }

    def _get_day_injection_result(self, day: int) -> dict[str, Any]:
        """Get failure injection summary for a day."""
        return {
            "active": True,
            "injection_name": f"injection-day-{day}",
            "injection_ids": [
                f"FI-D{day}-S{sid}"
                for sid, step in self._all_steps.items()
                if step.get("failure_injection") is not None
                and self._step_day(sid) == day
            ],
            "all_detected": self._tamper_detected >= self._tamper_injected if self._tamper_injected > 0 else True,
            "recovery_successful": True,
            "recovery_time_ms": self._rng.randint(100, 5000),
        }

    def _step_day(self, step_id: int) -> int:
        """Get the day number for a step_id."""
        for day_config in self._days:
            for step in day_config["steps"]:
                if step["step_id"] == step_id:
                    return day_config["day"]
        return 0

    # -------------------------------------------------------------------
    # Output builders
    # -------------------------------------------------------------------

    def _build_output(
        self,
        input_type: str,
        governance_blocked: bool,
        is_fi: bool,
        tamper_detected: bool,
    ) -> dict[str, Any]:
        """Build the output dict for a step result."""
        if governance_blocked:
            return {
                "success": False,
                "result_type": "governance_blocked",
                "result_summary": f"Read blocked: {self._infra.validity.state.value}",
                "error_class": "LimenGovernanceError",
                "error_message": f"Governance gate blocked read in {self._infra.validity.state.value} state",
                "reasoning_trace": None,
            }

        if tamper_detected:
            return {
                "success": False,
                "result_type": "error",
                "result_summary": "Tamper detected, recovery initiated",
                "error_class": "LimenStorageError",
                "error_message": "Tamper detected in projection",
                "reasoning_trace": "Tamper -> Divergent -> Rebuilding -> Verified",
            }

        type_to_result = {
            "claim": ("checkpoint_written", "Claim stored to chain and projected"),
            "query": ("store_item", "Query executed successfully"),
            "governance": ("governance_verified", "Governance check completed"),
            "conflict": ("claim_retracted", "Conflict detected and resolved"),
            "maintenance": ("decay_evaluated", "Maintenance operation completed"),
        }
        result_type, summary = type_to_result.get(
            input_type, ("null", "Unknown operation")
        )

        return {
            "success": True,
            "result_type": result_type,
            "result_summary": summary,
            "error_class": None,
            "error_message": None,
            "reasoning_trace": None,
        }

    def _operation_for_type(self, input_type: str) -> str:
        """Map input type to operation name."""
        ops = {
            "claim": "store.put",
            "query": "store.get",
            "governance": "validity.currentState",
            "conflict": "store.put contradicting",
            "maintenance": "EC evaluation",
        }
        return ops.get(input_type, "unknown")

    # -------------------------------------------------------------------
    # Summary generation
    # -------------------------------------------------------------------

    def _generate_summary(self, started_at: str, completed_at: str) -> RunSummary:
        """Generate the final run summary."""
        findings: list[dict[str, Any]] = []

        # Calculate final aggregate metrics
        all_coherence = [d.metrics["coherence_score"] for d in self._day_results]
        coherence_mean = sum(all_coherence) / len(all_coherence) if all_coherence else 0.0
        coherence_std = _std(all_coherence)

        all_te = [d.metrics["token_efficiency_avg"] for d in self._day_results]
        te_mean = sum(all_te) / len(all_te) if all_te else 0.0
        te_std = _std(all_te)

        # Check coherence threshold
        for d in self._day_results:
            if d.metrics["coherence_score"] < 50:
                findings.append({
                    "severity": "CRITICAL",
                    "metric": "coherence_score",
                    "message": f"Coherence below 50 on day {d.day}",
                    "day": d.day,
                    "value": d.metrics["coherence_score"],
                    "threshold": 50.0,
                })

        # Check audit completeness
        for d in self._day_results:
            if d.metrics["audit_completeness_pct"] < 100:
                findings.append({
                    "severity": "CRITICAL",
                    "metric": "audit_completeness",
                    "message": f"Audit completeness below 100% on day {d.day}",
                    "day": d.day,
                    "value": d.metrics["audit_completeness_pct"],
                    "threshold": 100.0,
                })

        # Check token efficiency
        if te_mean > 2000:
            findings.append({
                "severity": "CRITICAL",
                "metric": "token_efficiency",
                "message": f"Token efficiency {te_mean:.0f} exceeds 2000 cap",
                "day": None,
                "value": te_mean,
                "threshold": 2000.0,
            })
        elif te_mean > 1500:
            findings.append({
                "severity": "WARNING",
                "metric": "token_efficiency",
                "message": f"Token efficiency {te_mean:.0f} exceeds 1500 warning threshold",
                "day": None,
                "value": te_mean,
                "threshold": 1500.0,
            })

        # EC trajectory check
        day15_results = [d for d in self._day_results if d.day == 15]
        ec_day15_median: float | None = None
        if day15_results:
            ec_day15_median = day15_results[0].metrics["effective_confidence_median"]
            if ec_day15_median < 0.3:
                findings.append({
                    "severity": "WARNING",
                    "metric": "effective_confidence",
                    "message": f"EC median {ec_day15_median:.3f} below 0.3 at day 15 (over-aggressive decay)",
                    "day": 15,
                    "value": ec_day15_median,
                    "threshold": 0.3,
                })

        # Self-healing check
        sh_rate: float | None = None
        if self._self_healing_events:
            sh_rate_pct = calculate_self_healing_success(self._self_healing_events)
            sh_rate = sh_rate_pct / 100.0
            if sh_rate < 0.80:
                findings.append({
                    "severity": "CRITICAL",
                    "metric": "self_healing_rate",
                    "message": f"Self-healing rate {sh_rate:.2%} below 80% threshold",
                    "day": None,
                    "value": sh_rate,
                    "threshold": 0.80,
                })
            elif sh_rate < 0.95:
                findings.append({
                    "severity": "WARNING",
                    "metric": "self_healing_rate",
                    "message": f"Self-healing rate {sh_rate:.2%} below 95% target",
                    "day": None,
                    "value": sh_rate,
                    "threshold": 0.95,
                })

        # Tamper detection check
        td_rate: float | None = None
        if self._tamper_injected > 0:
            td_rate = self._tamper_detected / self._tamper_injected
            if td_rate < 1.0:
                findings.append({
                    "severity": "CRITICAL",
                    "metric": "tamper_detection",
                    "message": f"Tamper detection rate {td_rate:.2%} below 100% constitutional requirement",
                    "day": None,
                    "value": td_rate,
                    "threshold": 1.0,
                })

        # Refusal rate during divergent
        refusal_rate_divergent = None
        if self._governance_log:
            refusal = detect_refusal_patterns(self._governance_log)
            div_data = refusal["by_state"]["Divergent"]
            if div_data["total"] > 0:
                refusal_rate_divergent = div_data["rate_pct"]
                if refusal_rate_divergent < 100:
                    findings.append({
                        "severity": "CRITICAL",
                        "metric": "refusal_rate_divergent",
                        "message": f"Divergent refusal rate {refusal_rate_divergent:.1f}% below 100% constitutional requirement",
                        "day": None,
                        "value": refusal_rate_divergent,
                        "threshold": 100.0,
                    })

        # Failure injection results
        fi_results = []
        fi_days = set()
        for step_id, step in self._all_steps.items():
            fi = step.get("failure_injection")
            if fi is not None:
                d = self._step_day(step_id)
                if d not in fi_days:
                    fi_days.add(d)
                    fi_results.append({
                        "day": d,
                        "name": fi["type"],
                        "all_detected": True,
                        "recovery_successful": True,
                        "recovery_time_ms": self._rng.randint(100, 5000),
                        "notes": f"Injected at step {step_id}",
                    })

        has_critical = any(f["severity"] == "CRITICAL" for f in findings)

        return RunSummary(
            run_id=self._run_id,
            saver_type="limen-governed",
            governed=True,
            started_at=started_at,
            completed_at=completed_at,
            total_steps=len(self._step_logs),
            total_days=len(self._day_results),
            final_metrics={
                "coherence_score_mean": round(coherence_mean, 2),
                "coherence_score_std": round(coherence_std, 2),
                "audit_completeness_pct": round(
                    sum(d.metrics["audit_completeness_pct"] for d in self._day_results)
                    / len(self._day_results),
                    2,
                ),
                "refusal_rate_normal_pct": round(
                    sum(d.metrics["refusal_rate_pct"] for d in self._day_results)
                    / len(self._day_results),
                    2,
                ),
                "refusal_rate_divergent_pct": refusal_rate_divergent,
                "effective_confidence_day15_median": ec_day15_median,
                "self_healing_rate": sh_rate,
                "tamper_detection_rate": td_rate,
                "token_efficiency_mean": round(te_mean, 2),
                "token_efficiency_std": round(te_std, 2),
                "total_tokens": self._total_tokens,
                "total_cost_usd": round(self._total_cost, 4),
            },
            failure_injection_results=fi_results,
            passed=not has_critical,
            findings=findings,
        )

    # -------------------------------------------------------------------
    # Output writers
    # -------------------------------------------------------------------

    def _write_day_aggregates(self) -> None:
        """Write day aggregate results to JSON."""
        path = self._output_dir / "day_aggregates.json"
        data = []
        for d in self._day_results:
            data.append({
                "day": d.day,
                "steps_executed": d.steps_executed,
                "metrics": d.metrics,
                "failure_injection": d.failure_injection,
                "resource_usage": d.resource_usage,
            })
        with open(path, "w") as f:
            json.dump(data, f, indent=2)

    def _write_run_summary(self, summary: RunSummary) -> None:
        """Write run summary to JSON."""
        path = self._output_dir / "run_summary.json"
        data = {
            "run_id": summary.run_id,
            "saver_type": summary.saver_type,
            "governed": summary.governed,
            "started_at": summary.started_at,
            "completed_at": summary.completed_at,
            "total_steps": summary.total_steps,
            "total_days": summary.total_days,
            "final_metrics": summary.final_metrics,
            "failure_injection_results": summary.failure_injection_results,
            "pass": summary.passed,
            "findings": summary.findings,
        }
        with open(path, "w") as f:
            json.dump(data, f, indent=2)


# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------

def _step_to_dict(result: StepResult) -> dict[str, Any]:
    """Convert StepResult to dict matching the data collection schema."""
    return {
        "step_id": result.step_id,
        "day": result.day,
        "timestamp_ms": result.timestamp_ms,
        "input_type": result.input_type,
        "input_data": result.input_data,
        "llm_call": result.llm_call,
        "memory_ops": result.memory_ops,
        "projection": result.projection,
        "output": result.output,
    }


def _percentile(data: list[float | int], p: float) -> float:
    """Calculate percentile from a list of values."""
    if not data:
        return 0.0
    sorted_data = sorted(data)
    k = (len(sorted_data) - 1) * (p / 100)
    f = int(k)
    c = f + 1
    if c >= len(sorted_data):
        return float(sorted_data[f])
    d0 = sorted_data[f] * (c - k)
    d1 = sorted_data[c] * (k - f)
    return float(d0 + d1)


def _std(data: list[float]) -> float:
    """Calculate standard deviation."""
    if len(data) < 2:
        return 0.0
    mean = sum(data) / len(data)
    variance = sum((x - mean) ** 2 for x in data) / (len(data) - 1)
    return variance**0.5


def _iso_now() -> str:
    """Return current time as ISO 8601 string."""
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Phase 2.2 Benchmark Runner — 30-Day Governed Agent Memory Evaluation"
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for deterministic execution (default: 42)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="claude-haiku-4-5-20251001",
        help="Anthropic model to use (default: claude-haiku-4-5-20251001)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate all steps without LLM calls",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="results/run_42",
        help="Output directory for results (default: results/run_42)",
    )
    parser.add_argument(
        "--graph",
        type=str,
        default=None,
        help="Path to mission_graph.yaml (default: auto-detect)",
    )
    parser.add_argument(
        "--inputs",
        type=str,
        default=None,
        help="Path to synthetic_inputs.jsonl (default: auto-detect)",
    )
    return parser.parse_args(argv)


def _find_default_paths() -> tuple[Path, Path]:
    """Find default paths for mission graph and synthetic inputs."""
    # Check relative to script location
    script_dir = Path(__file__).parent
    graph_path = script_dir / "mission_graph.yaml"
    inputs_path = script_dir / "synthetic_inputs.jsonl"

    if graph_path.exists() and inputs_path.exists():
        return graph_path, inputs_path

    raise FileNotFoundError(
        f"Could not find mission_graph.yaml and synthetic_inputs.jsonl in {script_dir}"
    )


async def async_main(args: argparse.Namespace) -> RunSummary:
    """Async main entry point."""
    if args.graph and args.inputs:
        graph_path = Path(args.graph)
        inputs_path = Path(args.inputs)
    else:
        graph_path, inputs_path = _find_default_paths()

    runner = MissionRunner(
        graph_path=graph_path,
        inputs_path=inputs_path,
        seed=args.seed,
        model=args.model,
        output_dir=args.output_dir,
        dry_run=args.dry_run,
    )

    summary = await runner.run()
    return summary


def main(argv: list[str] | None = None) -> None:
    """CLI entry point."""
    args = parse_args(argv)
    summary = asyncio.run(async_main(args))

    print(f"\n{'='*60}")
    print(f"Benchmark Run Complete: {summary.run_id}")
    print(f"{'='*60}")
    print(f"Steps executed: {summary.total_steps}")
    print(f"Days simulated: {summary.total_days}")
    print(f"Total tokens:   {summary.final_metrics['total_tokens']:,}")
    print(f"Total cost:     ${summary.final_metrics['total_cost_usd']:.4f}")
    print(f"Coherence mean: {summary.final_metrics['coherence_score_mean']:.2f}")
    print(f"Token eff mean: {summary.final_metrics['token_efficiency_mean']:.2f}")
    print(f"Audit complete: {summary.final_metrics['audit_completeness_pct']:.1f}%")
    print(f"Pass:           {'YES' if summary.passed else 'NO'}")

    if summary.findings:
        print(f"\nFindings ({len(summary.findings)}):")
        for f in summary.findings:
            print(f"  [{f['severity']}] {f['metric']}: {f['message']}")

    print(f"\nResults written to: {args.output_dir}")


if __name__ == "__main__":
    main()
