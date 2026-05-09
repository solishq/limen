# @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
# @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
"""Tests for Phase 2.2 Benchmark Scoring Functions.

Covers all 5 scoring functions with edge cases, boundary conditions,
and formula verification against design doc examples.
"""

import hashlib
import math
import pytest

from scoring_functions import (
    calculate_audit_completeness,
    calculate_coherence_score,
    calculate_self_healing_success,
    detect_refusal_patterns,
    track_token_efficiency,
)


# ============================================================
# 1. calculate_coherence_score
# ============================================================


class TestCoherenceScore:
    """Tests for calculate_coherence_score (design doc section 1.1)."""

    def _make_state(
        self,
        embedding: list[float],
        claims_asserted: int = 100,
        contradicting: int = 0,
        source_backed: int = 50,
        source_matching: int = 50,
    ) -> dict:
        return {
            "embedding": embedding,
            "claims_asserted": claims_asserted,
            "contradicting_active_claims": contradicting,
            "source_backed_claims": source_backed,
            "source_matching_claims": source_matching,
        }

    def test_perfect_coherence(self):
        """Identical embeddings, no contradictions, all sources match -> 100."""
        emb = [1.0, 0.0, 0.0]
        states = [
            self._make_state(emb, 100, 0, 50, 50),
            self._make_state(emb, 200, 0, 100, 100),
        ]
        score = calculate_coherence_score(states)
        assert score == pytest.approx(100.0, abs=0.01)

    def test_zero_contradictions_zero_factual(self):
        """No contradictions but no source-backed claims (R_factual defaults 1.0)."""
        emb = [1.0, 0.0, 0.0]
        states = [
            self._make_state(emb, 100, 0, 0, 0),
        ]
        score = calculate_coherence_score(states)
        # Single state: S_avg=1.0, R_contra=0, R_factual=1.0
        # C = 0.4*100 + 0.3*100 + 0.3*100 = 100
        assert score == pytest.approx(100.0, abs=0.01)

    def test_high_contradiction_low_score(self):
        """50% contradictions should significantly reduce score."""
        emb = [1.0, 0.0, 0.0]
        states = [
            self._make_state(emb, 100, 50, 50, 50),
        ]
        score = calculate_coherence_score(states)
        # S_avg=1.0, R_contra=0.5, R_factual=1.0
        # C = 0.4*100 + 0.3*(1-0.5)*100 + 0.3*1.0*100 = 40 + 15 + 30 = 85
        assert score == pytest.approx(85.0, abs=0.01)

    def test_orthogonal_embeddings(self):
        """Orthogonal consecutive embeddings -> S_avg = 0."""
        states = [
            self._make_state([1.0, 0.0, 0.0], 100, 0, 50, 50),
            self._make_state([0.0, 1.0, 0.0], 100, 0, 50, 50),
        ]
        score = calculate_coherence_score(states)
        # S_avg=0, R_contra=0, R_factual=1.0
        # C = 0.4*0 + 0.3*100 + 0.3*100 = 0 + 30 + 30 = 60
        assert score == pytest.approx(60.0, abs=0.01)

    def test_all_contradictions_no_factual(self):
        """Worst case: all contradictions, no factual match."""
        emb = [1.0, 0.0, 0.0]
        states = [
            self._make_state(emb, 100, 100, 50, 0),
        ]
        score = calculate_coherence_score(states)
        # S_avg=1.0, R_contra=1.0, R_factual=0
        # C = 0.4*100 + 0.3*(1-1)*100 + 0.3*0*100 = 40 + 0 + 0 = 40
        assert score == pytest.approx(40.0, abs=0.01)

    def test_empty_raises(self):
        with pytest.raises(ValueError, match="must not be empty"):
            calculate_coherence_score([])

    def test_missing_key_raises(self):
        with pytest.raises(ValueError, match="missing keys"):
            calculate_coherence_score([{"embedding": [1.0]}])

    def test_negative_claims_raises(self):
        with pytest.raises(ValueError, match="claims_asserted must be >= 0"):
            calculate_coherence_score([
                self._make_state([1.0], claims_asserted=-1),
            ])

    def test_score_clamped_to_0_100(self):
        """Score never exceeds [0, 100] bounds."""
        emb = [1.0, 0.0]
        states = [self._make_state(emb, 100, 0, 50, 50)]
        score = calculate_coherence_score(states)
        assert 0.0 <= score <= 100.0

    def test_multiple_states_averaging(self):
        """Three states: similarity 1.0 then 0.0 -> S_avg = 0.5."""
        states = [
            self._make_state([1.0, 0.0], 50, 0, 25, 25),
            self._make_state([1.0, 0.0], 100, 0, 50, 50),
            self._make_state([0.0, 1.0], 150, 0, 75, 75),
        ]
        score = calculate_coherence_score(states)
        # S_avg = (1.0 + 0.0) / 2 = 0.5; R_contra=0; R_factual=1.0
        # C = 0.4*50 + 0.3*100 + 0.3*100 = 20 + 30 + 30 = 80
        assert score == pytest.approx(80.0, abs=0.01)

    def test_zero_claims_asserted(self):
        """Zero claims asserted: R_contra defaults to 0."""
        states = [
            self._make_state([1.0], claims_asserted=0, contradicting=0),
        ]
        score = calculate_coherence_score(states)
        # R_contra=0 (safe default), rest normal
        assert score == pytest.approx(100.0, abs=0.01)


# ============================================================
# 2. calculate_audit_completeness
# ============================================================


class TestAuditCompleteness:
    """Tests for calculate_audit_completeness (design doc section 1.2)."""

    def _make_entry(
        self,
        state_json: str,
        prev_hash: str | None,
        seq: int,
        proj_exists: bool = True,
        proj_state: str = "Verified",
    ) -> dict:
        content_hash = hashlib.sha256(state_json.encode("utf-8")).hexdigest()
        return {
            "state_json": state_json,
            "content_hash": content_hash,
            "previous_hash": prev_hash,
            "global_sequence": seq,
            "projection_row_exists": proj_exists,
            "projection_global_sequence": seq if proj_exists else None,
            "projection_validity_state": proj_state,
        }

    def test_perfect_chain(self):
        """All entries valid -> 100%."""
        e1 = self._make_entry('{"a":1}', None, 1)
        e2 = self._make_entry('{"a":2}', e1["content_hash"], 2)
        e3 = self._make_entry('{"a":3}', e2["content_hash"], 3)
        assert calculate_audit_completeness([e1, e2, e3]) == pytest.approx(100.0)

    def test_tampered_hash(self):
        """One entry with wrong content hash -> AC < 100%."""
        e1 = self._make_entry('{"a":1}', None, 1)
        e2 = self._make_entry('{"a":2}', e1["content_hash"], 2)
        e2["content_hash"] = "deadbeef" * 8  # Tampered
        assert calculate_audit_completeness([e1, e2]) == pytest.approx(50.0)

    def test_broken_chain_link(self):
        """Second entry points to wrong previous hash."""
        e1 = self._make_entry('{"a":1}', None, 1)
        e2 = self._make_entry('{"a":2}', "wrong_hash", 2)
        assert calculate_audit_completeness([e1, e2]) == pytest.approx(50.0)

    def test_missing_projection(self):
        """Entry without projection row."""
        e1 = self._make_entry('{"a":1}', None, 1, proj_exists=False)
        assert calculate_audit_completeness([e1]) == pytest.approx(0.0)

    def test_non_verified_projection(self):
        """Entry with Lagging projection state."""
        e1 = self._make_entry('{"a":1}', None, 1, proj_state="Lagging")
        assert calculate_audit_completeness([e1]) == pytest.approx(0.0)

    def test_sequence_mismatch(self):
        """Projection sequence doesn't match entry sequence."""
        e1 = self._make_entry('{"a":1}', None, 1)
        e1["projection_global_sequence"] = 999
        assert calculate_audit_completeness([e1]) == pytest.approx(0.0)

    def test_empty_raises(self):
        with pytest.raises(ValueError, match="must not be empty"):
            calculate_audit_completeness([])

    def test_missing_key_raises(self):
        with pytest.raises(ValueError, match="missing keys"):
            calculate_audit_completeness([{"state_json": "x"}])

    def test_first_entry_with_previous_hash(self):
        """First entry should have previous_hash = None."""
        e1 = self._make_entry('{"a":1}', "some_hash", 1)
        assert calculate_audit_completeness([e1]) == pytest.approx(0.0)

    def test_partial_chain_integrity(self):
        """3 entries, middle one broken -> 66.67%."""
        e1 = self._make_entry('{"a":1}', None, 1)
        e2 = self._make_entry('{"a":2}', "wrong", 2)
        e3_prev = e2["content_hash"]  # Correct link from e2
        e3 = self._make_entry('{"a":3}', e3_prev, 3)
        result = calculate_audit_completeness([e1, e2, e3])
        # e1: pass, e2: fail (wrong prev), e3: pass (correct link to e2)
        assert result == pytest.approx(66.67, abs=0.01)


# ============================================================
# 3. detect_refusal_patterns
# ============================================================


class TestRefusalPatterns:
    """Tests for detect_refusal_patterns (design doc section 1.3)."""

    def _make_entry(
        self,
        state: str = "Verified",
        governed: bool = True,
        blocked: bool = False,
        retryable: bool | None = None,
    ) -> dict:
        return {
            "governance_state": state,
            "governed": governed,
            "blocked": blocked,
            "retryable": retryable,
        }

    def test_all_verified_no_refusals(self):
        log = [self._make_entry("Verified", True, False) for _ in range(10)]
        result = detect_refusal_patterns(log)
        assert result["refusal_rate_pct"] == pytest.approx(0.0)
        assert result["total_blocked"] == 0
        assert result["invariant_violations"] == []

    def test_divergent_must_block_all(self):
        """During Divergent state, 100% block rate is mandatory."""
        log = [
            self._make_entry("Divergent", True, True, False),
            self._make_entry("Divergent", False, True, False),
        ]
        result = detect_refusal_patterns(log)
        assert result["by_state"]["Divergent"]["rate_pct"] == pytest.approx(100.0)
        assert result["invariant_violations"] == []

    def test_divergent_not_blocked_is_violation(self):
        """Divergent + not blocked = invariant violation."""
        log = [self._make_entry("Divergent", True, False)]
        result = detect_refusal_patterns(log)
        assert len(result["invariant_violations"]) == 1
        assert result["invariant_violations"][0]["expected_blocked"] is True

    def test_lagging_governed_blocked(self):
        """Lagging + governed = blocked (retryable)."""
        log = [self._make_entry("Lagging", True, True, True)]
        result = detect_refusal_patterns(log)
        assert result["refusal_rate_pct"] == pytest.approx(100.0)
        assert result["retryable_count"] == 1
        assert result["invariant_violations"] == []

    def test_lagging_ungoverned_allowed(self):
        """Lagging + ungoverned = allowed (warn)."""
        log = [self._make_entry("Lagging", False, False)]
        result = detect_refusal_patterns(log)
        assert result["refusal_rate_pct"] == pytest.approx(0.0)
        assert result["invariant_violations"] == []

    def test_rebuilding_always_blocked(self):
        """Rebuilding blocks both governed and ungoverned."""
        log = [
            self._make_entry("Rebuilding", True, True, True),
            self._make_entry("Rebuilding", False, True, True),
        ]
        result = detect_refusal_patterns(log)
        assert result["by_state"]["Rebuilding"]["rate_pct"] == pytest.approx(100.0)
        assert result["retryable_count"] == 2

    def test_mixed_states(self):
        """Mixed states produce correct per-state breakdown."""
        log = [
            self._make_entry("Verified", True, False),
            self._make_entry("Verified", True, False),
            self._make_entry("Divergent", True, True, False),
            self._make_entry("Lagging", True, True, True),
            self._make_entry("Unverified", False, True, False),
        ]
        result = detect_refusal_patterns(log)
        assert result["total_reads"] == 5
        assert result["total_blocked"] == 3
        assert result["refusal_rate_pct"] == pytest.approx(60.0)

    def test_empty_raises(self):
        with pytest.raises(ValueError, match="must not be empty"):
            detect_refusal_patterns([])

    def test_invalid_state_raises(self):
        with pytest.raises(ValueError, match="invalid governance_state"):
            detect_refusal_patterns([
                {"governance_state": "Invalid", "governed": True, "blocked": False},
            ])

    def test_unverified_must_always_block(self):
        """Unverified blocks regardless of governed flag."""
        log = [
            self._make_entry("Unverified", True, True, False),
            self._make_entry("Unverified", False, True, False),
        ]
        result = detect_refusal_patterns(log)
        assert result["by_state"]["Unverified"]["rate_pct"] == pytest.approx(100.0)
        assert result["invariant_violations"] == []

    def test_verified_blocked_is_violation(self):
        """Verified + blocked = invariant violation (should be allowed)."""
        log = [self._make_entry("Verified", True, True)]
        result = detect_refusal_patterns(log)
        assert len(result["invariant_violations"]) == 1
        assert result["invariant_violations"][0]["expected_blocked"] is False


# ============================================================
# 4. track_token_efficiency
# ============================================================


class TestTokenEfficiency:
    """Tests for track_token_efficiency (design doc section 1.7)."""

    def test_target_range(self):
        """< 1000 tokens/step is the target."""
        te = track_token_efficiency(tokens_used=750_000, steps=1000)
        assert te == pytest.approx(750.0)
        assert te < 1000  # Target

    def test_warning_range(self):
        """1500 < TE < 2000 is WARNING."""
        te = track_token_efficiency(tokens_used=1_750_000, steps=1000)
        assert 1500 < te < 2000

    def test_critical_range(self):
        """TE > 2000 is CRITICAL."""
        te = track_token_efficiency(tokens_used=2_500_000, steps=1000)
        assert te > 2000

    def test_exact_formula(self):
        """TE = T_total / S_total."""
        assert track_token_efficiency(3000, 3) == pytest.approx(1000.0)
        assert track_token_efficiency(0, 10) == pytest.approx(0.0)

    def test_negative_tokens_raises(self):
        with pytest.raises(ValueError, match="tokens_used must be >= 0"):
            track_token_efficiency(-1, 10)

    def test_zero_steps_raises(self):
        with pytest.raises(ValueError, match="steps must be > 0"):
            track_token_efficiency(1000, 0)

    def test_negative_steps_raises(self):
        with pytest.raises(ValueError, match="steps must be > 0"):
            track_token_efficiency(1000, -5)

    def test_large_scale(self):
        """Full benchmark scale: 2M tokens / 3000 steps."""
        te = track_token_efficiency(2_000_000, 3000)
        assert te == pytest.approx(666.67, abs=0.01)


# ============================================================
# 5. calculate_self_healing_success
# ============================================================


class TestSelfHealingSuccess:
    """Tests for calculate_self_healing_success (design doc section 1.5)."""

    def _make_event(
        self,
        success: bool = True,
        correct_claim: bool = False,
        latency_ms: int = 50,
    ) -> dict:
        base = {
            "type": "retraction_attempt",
            "previous_status": "active" if success else "active",
            "new_status": "retracted" if success else "error",
            "error": not success,
            "correct_claim": correct_claim,
            "detected_at_ms": 1000,
            "retracted_at_ms": 1000 + latency_ms if success else None,
        }
        return base

    def test_perfect_healing(self):
        """All retractions succeed -> 100%."""
        events = [self._make_event(True) for _ in range(20)]
        assert calculate_self_healing_success(events) == pytest.approx(100.0)

    def test_all_failures(self):
        """All retractions fail -> 0%."""
        events = [self._make_event(False) for _ in range(10)]
        assert calculate_self_healing_success(events) == pytest.approx(0.0)

    def test_95_percent_threshold(self):
        """95% success rate: 19/20."""
        events = [self._make_event(True) for _ in range(19)]
        events.append(self._make_event(False))
        result = calculate_self_healing_success(events)
        assert result == pytest.approx(95.0)

    def test_80_percent_critical(self):
        """80% success rate: 8/10."""
        events = [self._make_event(True) for _ in range(8)]
        events.extend([self._make_event(False) for _ in range(2)])
        result = calculate_self_healing_success(events)
        assert result == pytest.approx(80.0)

    def test_false_positives_counted(self):
        """Retracting a correct claim is a false positive.

        The function returns the success rate (not penalized by false positives
        directly), but the caller can compute SH_false_positive from the events.
        """
        events = [
            self._make_event(True, correct_claim=True),
            self._make_event(True, correct_claim=False),
        ]
        result = calculate_self_healing_success(events)
        assert result == pytest.approx(100.0)

    def test_empty_raises(self):
        with pytest.raises(ValueError, match="must not be empty"):
            calculate_self_healing_success([])

    def test_wrong_type_raises(self):
        with pytest.raises(ValueError, match="type must be 'retraction_attempt'"):
            calculate_self_healing_success([{
                "type": "wrong",
                "previous_status": "active",
                "new_status": "retracted",
                "error": False,
                "correct_claim": False,
                "detected_at_ms": 1000,
            }])

    def test_missing_key_raises(self):
        with pytest.raises(ValueError, match="missing keys"):
            calculate_self_healing_success([{"type": "retraction_attempt"}])

    def test_mixed_success_failure(self):
        """7 success, 3 failure -> 70%."""
        events = [self._make_event(True) for _ in range(7)]
        events.extend([self._make_event(False) for _ in range(3)])
        result = calculate_self_healing_success(events)
        assert result == pytest.approx(70.0)

    def test_error_during_retraction(self):
        """Retraction with error flag = failure even if status changed."""
        event = {
            "type": "retraction_attempt",
            "previous_status": "active",
            "new_status": "retracted",
            "error": True,  # Error occurred
            "correct_claim": False,
            "detected_at_ms": 1000,
            "retracted_at_ms": 1050,
        }
        result = calculate_self_healing_success([event])
        assert result == pytest.approx(0.0)

    def test_single_event(self):
        """Single successful retraction -> 100%."""
        events = [self._make_event(True)]
        assert calculate_self_healing_success(events) == pytest.approx(100.0)
