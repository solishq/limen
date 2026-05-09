# @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
# @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
"""Phase 2.2 Benchmark Scoring Functions.

Implements the 5 scoring functions from PHASE_2.2_BENCHMARK_DESIGN.md.
Each function matches the design doc formula exactly.

Design doc reference: docs/PHASE_2.2_BENCHMARK_DESIGN.md sections 1.1-1.7
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def calculate_coherence_score(state_history: list[dict]) -> float:
    """Calculate memory coherence score (0-100).

    Formula (design doc section 1.1):
        C = 0.4 * S_avg + 0.3 * (1 - R_contra) * 100 + 0.3 * R_factual * 100

    Where:
        S_avg    = mean cosine similarity between consecutive state embeddings,
                   normalized to [0, 100] (S_avg * 100 in final formula weight)
        R_contra = count(contradicting_active_claims) / count(all_claims_asserted)
        R_factual = count(source_matching_claims) / count(source_backed_claims)

    Args:
        state_history: List of dicts, each containing:
            - 'embedding': list[float] (384-dim embedding vector)
            - 'claims_asserted': int (total claims asserted up to this state)
            - 'contradicting_active_claims': int (claims contradicting a prior
              active claim on same subject+predicate)
            - 'source_backed_claims': int (claims that reference a source document)
            - 'source_matching_claims': int (source-backed claims matching their source)

    Returns:
        Coherence score in [0, 100].

    Raises:
        ValueError: If state_history is empty or contains invalid data.
    """
    if not state_history:
        raise ValueError("state_history must not be empty")

    for i, state in enumerate(state_history):
        required = {
            "embedding", "claims_asserted", "contradicting_active_claims",
            "source_backed_claims", "source_matching_claims",
        }
        missing = required - set(state.keys())
        if missing:
            raise ValueError(f"State at index {i} missing keys: {missing}")

        if not isinstance(state["embedding"], list) or len(state["embedding"]) == 0:
            raise ValueError(f"State at index {i}: embedding must be a non-empty list")

        if state["claims_asserted"] < 0:
            raise ValueError(f"State at index {i}: claims_asserted must be >= 0")
        if state["contradicting_active_claims"] < 0:
            raise ValueError(
                f"State at index {i}: contradicting_active_claims must be >= 0"
            )
        if state["source_backed_claims"] < 0:
            raise ValueError(f"State at index {i}: source_backed_claims must be >= 0")
        if state["source_matching_claims"] < 0:
            raise ValueError(
                f"State at index {i}: source_matching_claims must be >= 0"
            )

    # S_avg: mean cosine similarity between consecutive state embeddings
    if len(state_history) < 2:
        s_avg = 1.0  # Single state: perfect self-similarity
    else:
        similarities: list[float] = []
        for i in range(1, len(state_history)):
            prev_emb = state_history[i - 1]["embedding"]
            curr_emb = state_history[i]["embedding"]
            sim = _cosine_similarity(prev_emb, curr_emb)
            similarities.append(sim)
        s_avg = sum(similarities) / len(similarities)

    # R_contra: fraction of claims that contradict a prior active claim
    last = state_history[-1]
    total_asserted = last["claims_asserted"]
    contradictions = last["contradicting_active_claims"]
    r_contra = contradictions / total_asserted if total_asserted > 0 else 0.0

    # R_factual: fraction of source-backed claims matching their source
    source_backed = last["source_backed_claims"]
    source_matching = last["source_matching_claims"]
    r_factual = source_matching / source_backed if source_backed > 0 else 1.0

    # Final formula
    c = 0.4 * (s_avg * 100) + 0.3 * (1 - r_contra) * 100 + 0.3 * r_factual * 100

    return max(0.0, min(100.0, c))


def calculate_audit_completeness(chain_entries: list[dict]) -> float:
    """Calculate audit completeness percentage (0-100).

    Formula (design doc section 1.2):
        AC = (E_full / E_total) * 100

        E_full = count(chain_entries WHERE
            content_hash = sha256(state_json)
            AND previous_hash links correctly
            AND projection_row exists with matching global_sequence
            AND projection_validity_state = 'Verified')

    Args:
        chain_entries: List of dicts, each containing:
            - 'state_json': str (the JSON state content)
            - 'content_hash': str (hex SHA-256 hash of state_json)
            - 'previous_hash': str | None (hash of previous entry, None for first)
            - 'global_sequence': int (monotonically increasing sequence number)
            - 'projection_row_exists': bool
            - 'projection_global_sequence': int | None (sequence in projection)
            - 'projection_validity_state': str ('Verified', 'Lagging', etc.)

    Returns:
        Audit completeness percentage in [0, 100].

    Raises:
        ValueError: If chain_entries is empty or contains invalid data.
    """
    if not chain_entries:
        raise ValueError("chain_entries must not be empty")

    for i, entry in enumerate(chain_entries):
        required = {
            "state_json", "content_hash", "previous_hash",
            "global_sequence", "projection_row_exists",
            "projection_global_sequence", "projection_validity_state",
        }
        missing = required - set(entry.keys())
        if missing:
            raise ValueError(f"Entry at index {i} missing keys: {missing}")

    e_total = len(chain_entries)
    e_full = 0

    for i, entry in enumerate(chain_entries):
        # Check 1: content_hash matches sha256(state_json)
        expected_hash = hashlib.sha256(entry["state_json"].encode("utf-8")).hexdigest()
        if entry["content_hash"] != expected_hash:
            continue

        # Check 2: previous_hash links correctly
        if i == 0:
            if entry["previous_hash"] is not None:
                continue
        else:
            expected_prev = chain_entries[i - 1]["content_hash"]
            if entry["previous_hash"] != expected_prev:
                continue

        # Check 3: projection_row exists with matching global_sequence
        if not entry["projection_row_exists"]:
            continue
        if entry["projection_global_sequence"] != entry["global_sequence"]:
            continue

        # Check 4: projection_validity_state = 'Verified'
        if entry["projection_validity_state"] != "Verified":
            continue

        e_full += 1

    return (e_full / e_total) * 100


def detect_refusal_patterns(governance_log: list[dict]) -> dict:
    """Detect and categorize refusal patterns from governance log.

    Formula (design doc section 1.3):
        RR = (G_blocked / G_total) * 100
        Subdivided: RR_lagging + RR_unverified + RR_divergent + RR_rebuilding = RR

    Governance mode invariants:
        Verified:    governed=true -> allowed; governed=false -> allowed
        Lagging:     governed=true -> blocked (retryable); governed=false -> allowed (warn)
        Unverified:  governed=true -> blocked; governed=false -> blocked
        Divergent:   governed=true -> blocked; governed=false -> blocked
        Rebuilding:  governed=true -> blocked (retryable); governed=false -> blocked (retryable)

    Args:
        governance_log: List of dicts, each containing:
            - 'governance_state': str ('Verified'|'Lagging'|'Unverified'|'Divergent'|'Rebuilding')
            - 'governed': bool (governance mode)
            - 'blocked': bool (whether the read was blocked)
            - 'retryable': bool | None (whether the block is retryable)

    Returns:
        Dict with keys:
            - 'total_reads': int
            - 'total_blocked': int
            - 'refusal_rate_pct': float (0-100)
            - 'by_state': dict mapping state -> {'blocked': int, 'total': int, 'rate_pct': float}
            - 'retryable_count': int
            - 'non_retryable_count': int
            - 'invariant_violations': list[dict] (entries violating governance invariants)

    Raises:
        ValueError: If governance_log is empty or contains invalid data.
    """
    if not governance_log:
        raise ValueError("governance_log must not be empty")

    valid_states = {"Verified", "Lagging", "Unverified", "Divergent", "Rebuilding"}
    for i, entry in enumerate(governance_log):
        required = {"governance_state", "governed", "blocked"}
        missing = required - set(entry.keys())
        if missing:
            raise ValueError(f"Entry at index {i} missing keys: {missing}")
        if entry["governance_state"] not in valid_states:
            raise ValueError(
                f"Entry at index {i}: invalid governance_state "
                f"'{entry['governance_state']}'"
            )

    # Expected blocking behavior per (state, governed) pair
    expected_blocked: dict[tuple[str, bool], bool] = {
        ("Verified", True): False,
        ("Verified", False): False,
        ("Lagging", True): True,
        ("Lagging", False): False,
        ("Unverified", True): True,
        ("Unverified", False): True,
        ("Divergent", True): True,
        ("Divergent", False): True,
        ("Rebuilding", True): True,
        ("Rebuilding", False): True,
    }

    by_state: dict[str, dict[str, int]] = {
        s: {"blocked": 0, "total": 0} for s in valid_states
    }
    total_blocked = 0
    retryable_count = 0
    non_retryable_count = 0
    invariant_violations: list[dict] = []

    for i, entry in enumerate(governance_log):
        state = entry["governance_state"]
        governed = entry["governed"]
        blocked = entry["blocked"]
        retryable = entry.get("retryable")

        by_state[state]["total"] += 1

        if blocked:
            total_blocked += 1
            by_state[state]["blocked"] += 1
            if retryable:
                retryable_count += 1
            else:
                non_retryable_count += 1

        # Check invariant
        expected = expected_blocked[(state, governed)]
        if blocked != expected:
            invariant_violations.append({
                "index": i,
                "state": state,
                "governed": governed,
                "blocked": blocked,
                "expected_blocked": expected,
            })

    total_reads = len(governance_log)
    refusal_rate = (total_blocked / total_reads) * 100 if total_reads > 0 else 0.0

    state_rates = {}
    for state, counts in by_state.items():
        rate = (
            (counts["blocked"] / counts["total"]) * 100
            if counts["total"] > 0
            else 0.0
        )
        state_rates[state] = {
            "blocked": counts["blocked"],
            "total": counts["total"],
            "rate_pct": rate,
        }

    return {
        "total_reads": total_reads,
        "total_blocked": total_blocked,
        "refusal_rate_pct": refusal_rate,
        "by_state": state_rates,
        "retryable_count": retryable_count,
        "non_retryable_count": non_retryable_count,
        "invariant_violations": invariant_violations,
    }


def track_token_efficiency(tokens_used: int, steps: int) -> float:
    """Calculate token efficiency (tokens per step).

    Formula (design doc section 1.7):
        TE = T_total / S_total

    Thresholds:
        < 1000: target
        > 1500: WARNING
        > 2000: CRITICAL

    Args:
        tokens_used: Total tokens consumed (input + output) across all steps.
        steps: Total number of steps executed.

    Returns:
        Tokens per step (float).

    Raises:
        ValueError: If tokens_used < 0 or steps <= 0.
    """
    if tokens_used < 0:
        raise ValueError(f"tokens_used must be >= 0, got {tokens_used}")
    if steps <= 0:
        raise ValueError(f"steps must be > 0, got {steps}")

    return tokens_used / steps


def calculate_self_healing_success(events: list[dict]) -> float:
    """Calculate self-healing success rate (0-100).

    Formula (design doc section 1.5):
        SH_rate = R_success / R_total

        R_success = count(retractions WHERE status changed active->retracted AND no error)
        R_total = count(all_retraction_attempts)

        Result scaled to 0-100 for consistency with other metrics.

    Thresholds:
        > 95%: target
        < 95%: WARNING
        < 80%: CRITICAL
        SH_false_positive > 5%: CRITICAL

    Args:
        events: List of dicts, each containing:
            - 'type': str ('retraction_attempt')
            - 'previous_status': str ('active' | other)
            - 'new_status': str ('retracted' | other)
            - 'error': bool (whether an error occurred during retraction)
            - 'correct_claim': bool (whether the retracted claim was actually correct,
              used for false positive calculation)
            - 'detected_at_ms': int (timestamp when conflict was detected)
            - 'retracted_at_ms': int | None (timestamp when retraction completed)

    Returns:
        Self-healing success rate in [0, 100].

    Raises:
        ValueError: If events is empty or contains invalid data.
    """
    if not events:
        raise ValueError("events must not be empty")

    for i, event in enumerate(events):
        required = {
            "type", "previous_status", "new_status", "error",
            "correct_claim", "detected_at_ms",
        }
        missing = required - set(event.keys())
        if missing:
            raise ValueError(f"Event at index {i} missing keys: {missing}")

        if event["type"] != "retraction_attempt":
            raise ValueError(
                f"Event at index {i}: type must be 'retraction_attempt', "
                f"got '{event['type']}'"
            )

    r_total = len(events)
    r_success = 0
    false_positives = 0
    latencies: list[int] = []

    for event in events:
        is_success = (
            event["previous_status"] == "active"
            and event["new_status"] == "retracted"
            and not event["error"]
        )
        if is_success:
            r_success += 1
            if event["correct_claim"]:
                false_positives += 1
            retracted_at = event.get("retracted_at_ms")
            if retracted_at is not None:
                latencies.append(retracted_at - event["detected_at_ms"])

    sh_rate = (r_success / r_total) * 100 if r_total > 0 else 0.0

    return max(0.0, min(100.0, sh_rate))


# --- Internal helpers ---

def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors.

    Returns value in [-1, 1]. For coherence scoring, values near 1.0
    indicate high similarity between consecutive states.
    """
    if len(a) != len(b):
        raise ValueError(f"Vector length mismatch: {len(a)} vs {len(b)}")
    if len(a) == 0:
        raise ValueError("Vectors must not be empty")

    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5

    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0

    return dot / (norm_a * norm_b)
