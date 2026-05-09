# @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
# @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
"""Phase 2.2 Benchmark Harness — Mock Limen Infrastructure.

Provides deterministic mock implementations of Limen's core subsystems
for benchmark execution without requiring a live Limen instance.

Design doc reference: docs/PHASE_2.2_BENCHMARK_DESIGN.md
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class ValidityState(Enum):
    """Projection validity states per design doc section 1.3."""

    VERIFIED = "Verified"
    LAGGING = "Lagging"
    UNVERIFIED = "Unverified"
    DIVERGENT = "Divergent"
    REBUILDING = "Rebuilding"


@dataclass
class ChainEntry:
    """Immutable chain entry with content hash and linkage."""

    sequence: int
    state_json: str
    content_hash: str
    previous_hash: str | None
    timestamp_ms: int
    entry_type: str  # claim, query, governance, conflict, maintenance


@dataclass
class ProjectionRow:
    """Projected view of a chain entry."""

    global_sequence: int
    content_hash: str
    validity_state: ValidityState
    subject: str
    predicate: str
    value: str
    confidence: float
    asserted_at_ms: int


@dataclass
class StoreItem:
    """Key-value store item for LangGraph store operations."""

    namespace: tuple[str, ...]
    key: str
    value: dict[str, Any]
    created_at_ms: int
    updated_at_ms: int


class MockChainStorage:
    """In-memory append-only chain with hash linkage.

    Enforces:
    - Monotonically increasing sequence numbers
    - Content hash = sha256(state_json)
    - Previous hash linkage (None for first entry)
    """

    def __init__(self) -> None:
        self._entries: list[ChainEntry] = []
        self._append_failure_count: int = 0

    @property
    def entries(self) -> list[ChainEntry]:
        return list(self._entries)

    @property
    def entry_count(self) -> int:
        return len(self._entries)

    def append(self, state_json: str, entry_type: str, timestamp_ms: int) -> ChainEntry:
        """Append a new entry to the chain.

        Raises:
            RuntimeError: If append failures are injected.
        """
        if self._append_failure_count > 0:
            self._append_failure_count -= 1
            raise RuntimeError("LimenStorageError: chain append failed (injected)")

        sequence = len(self._entries) + 1
        content_hash = hashlib.sha256(state_json.encode("utf-8")).hexdigest()
        previous_hash = self._entries[-1].content_hash if self._entries else None

        entry = ChainEntry(
            sequence=sequence,
            state_json=state_json,
            content_hash=content_hash,
            previous_hash=previous_hash,
            timestamp_ms=timestamp_ms,
            entry_type=entry_type,
        )
        self._entries.append(entry)
        return entry

    def read(self, sequence: int | None = None) -> list[ChainEntry]:
        """Read entries. If sequence given, return from that point."""
        if sequence is None:
            return list(self._entries)
        return [e for e in self._entries if e.sequence >= sequence]

    def verify_integrity(self) -> bool:
        """Verify the full chain integrity."""
        for i, entry in enumerate(self._entries):
            expected_hash = hashlib.sha256(entry.state_json.encode("utf-8")).hexdigest()
            if entry.content_hash != expected_hash:
                return False
            if i == 0:
                if entry.previous_hash is not None:
                    return False
            else:
                if entry.previous_hash != self._entries[i - 1].content_hash:
                    return False
        return True

    def inject_append_failures(self, count: int) -> None:
        """Inject N consecutive append failures."""
        self._append_failure_count = count


class MockProjectionStorage:
    """In-memory projection storage with query support."""

    def __init__(self) -> None:
        self._rows: dict[int, ProjectionRow] = {}
        self._digest: str = ""

    @property
    def row_count(self) -> int:
        return len(self._rows)

    def upsert(self, row: ProjectionRow) -> None:
        """Insert or update a projection row."""
        self._rows[row.global_sequence] = row
        self._recompute_digest()

    def query(
        self,
        subject: str | None = None,
        predicate: str | None = None,
        min_confidence: float = 0.0,
    ) -> list[ProjectionRow]:
        """Query projection rows with optional filters."""
        results: list[ProjectionRow] = []
        for row in self._rows.values():
            if subject is not None and row.subject != subject:
                continue
            if predicate is not None and row.predicate != predicate:
                continue
            if row.confidence < min_confidence:
                continue
            results.append(row)
        return results

    def get_by_sequence(self, sequence: int) -> ProjectionRow | None:
        """Get a specific projection row by sequence."""
        return self._rows.get(sequence)

    def get_digest(self) -> str:
        """Get current projection digest for tamper detection."""
        return self._digest

    def drop_all(self) -> None:
        """Drop all projection rows (for rebuild testing)."""
        self._rows.clear()
        self._digest = ""

    def corrupt_digest(self) -> None:
        """Corrupt the projection digest (for tamper injection)."""
        self._digest = "corrupted"

    def _recompute_digest(self) -> None:
        """Recompute digest from all rows."""
        sequences = sorted(self._rows.keys())
        hasher = hashlib.sha256()
        for seq in sequences:
            row = self._rows[seq]
            hasher.update(row.content_hash.encode("utf-8"))
        self._digest = hasher.hexdigest()


class MockProjector:
    """Deterministic projector: chain entries -> projection rows."""

    def __init__(
        self, chain: MockChainStorage, projection: MockProjectionStorage
    ) -> None:
        self._chain = chain
        self._projection = projection
        self._last_projected: int = 0

    @property
    def last_projected_sequence(self) -> int:
        return self._last_projected

    def project_pending(self) -> int:
        """Project all unprocessed chain entries. Returns count projected."""
        entries = self._chain.read(self._last_projected + 1)
        count = 0
        for entry in entries:
            parsed = json.loads(entry.state_json)
            row = ProjectionRow(
                global_sequence=entry.sequence,
                content_hash=entry.content_hash,
                validity_state=ValidityState.VERIFIED,
                subject=parsed.get("subject", f"entity:benchmark:{entry.sequence}"),
                predicate=parsed.get("predicate", "benchmark.value"),
                value=parsed.get("value", entry.state_json[:200]),
                confidence=parsed.get("confidence", 0.7),
                asserted_at_ms=entry.timestamp_ms,
            )
            self._projection.upsert(row)
            self._last_projected = entry.sequence
            count += 1
        return count

    def rebuild_from_chain(self) -> int:
        """Full rebuild: drop projection, re-project all chain entries."""
        self._projection.drop_all()
        self._last_projected = 0
        return self.project_pending()


class MockValidityStateMachine:
    """Programmable validity state machine.

    Implements the state transition graph from design doc section 1.3.
    """

    # Valid transitions: (from_state, to_state)
    VALID_TRANSITIONS: set[tuple[ValidityState, ValidityState]] = {
        (ValidityState.UNVERIFIED, ValidityState.VERIFIED),
        (ValidityState.UNVERIFIED, ValidityState.DIVERGENT),
        (ValidityState.VERIFIED, ValidityState.LAGGING),
        (ValidityState.VERIFIED, ValidityState.DIVERGENT),
        (ValidityState.LAGGING, ValidityState.VERIFIED),
        (ValidityState.LAGGING, ValidityState.DIVERGENT),
        (ValidityState.DIVERGENT, ValidityState.REBUILDING),
        (ValidityState.REBUILDING, ValidityState.VERIFIED),
        (ValidityState.REBUILDING, ValidityState.DIVERGENT),
    }

    def __init__(self) -> None:
        self._state = ValidityState.UNVERIFIED
        self._transition_log: list[dict[str, Any]] = []

    @property
    def state(self) -> ValidityState:
        return self._state

    @property
    def transition_log(self) -> list[dict[str, Any]]:
        return list(self._transition_log)

    def transition(self, to_state: ValidityState, reason: str) -> None:
        """Transition to a new state.

        Raises:
            ValueError: If the transition is not valid.
        """
        if self._state == to_state:
            return  # No-op for same state
        pair = (self._state, to_state)
        if pair not in self.VALID_TRANSITIONS:
            raise ValueError(
                f"Invalid transition: {self._state.value} -> {to_state.value}"
            )
        self._transition_log.append({
            "from": self._state.value,
            "to": to_state.value,
            "reason": reason,
            "timestamp_ms": int(time.time() * 1000),
        })
        self._state = to_state

    def verify_on_startup(self, chain: MockChainStorage, projection: MockProjectionStorage) -> ValidityState:
        """Verify projection against chain on startup.

        Returns the resulting state after verification.
        """
        if chain.entry_count == 0 and projection.row_count == 0:
            self.transition(ValidityState.VERIFIED, "empty chain + empty projection")
            return self._state

        if not chain.verify_integrity():
            self.transition(ValidityState.DIVERGENT, "chain integrity failure")
            return self._state

        # Check projection digest
        expected_digest = projection.get_digest()
        if expected_digest == "corrupted":
            self.transition(ValidityState.DIVERGENT, "projection digest corrupted")
            return self._state

        # Check all chain entries have projection rows
        for entry in chain.entries:
            row = projection.get_by_sequence(entry.sequence)
            if row is None:
                self.transition(ValidityState.LAGGING, f"missing projection for seq {entry.sequence}")
                return self._state
            if row.content_hash != entry.content_hash:
                self.transition(ValidityState.DIVERGENT, f"hash mismatch at seq {entry.sequence}")
                return self._state

        self.transition(ValidityState.VERIFIED, "all checks passed")
        return self._state

    def is_read_allowed(self, governed: bool) -> tuple[bool, bool | None]:
        """Check if a read is allowed under current state.

        Returns:
            (allowed, retryable) — retryable is None if allowed.
        """
        state = self._state
        if state == ValidityState.VERIFIED:
            return (True, None)
        if state == ValidityState.LAGGING:
            if governed:
                return (False, True)
            return (True, None)  # Allowed with warning
        if state == ValidityState.UNVERIFIED:
            return (False, False)
        if state == ValidityState.DIVERGENT:
            return (False, False)
        if state == ValidityState.REBUILDING:
            return (False, True)
        return (False, False)

    def force_state(self, state: ValidityState) -> None:
        """Force state directly (for testing/injection). Bypasses transition validation."""
        self._transition_log.append({
            "from": self._state.value,
            "to": state.value,
            "reason": "forced (injection)",
            "timestamp_ms": int(time.time() * 1000),
        })
        self._state = state


class TamperInjector:
    """Injects tamper events at scheduled steps.

    Tamper types from design doc section 1.6:
    - T1-T3: checkpoint table operations
    - T4-T6: pending_writes table operations
    - T7-T9: store_items table operations

    In the mock, we simulate by corrupting chain/projection state.
    """

    def __init__(self) -> None:
        self._schedule: dict[int, list[dict[str, Any]]] = {}

    def schedule(self, step_id: int, tamper_type: str, target: str) -> None:
        """Schedule a tamper injection at a specific step."""
        if step_id not in self._schedule:
            self._schedule[step_id] = []
        self._schedule[step_id].append({"type": tamper_type, "target": target})

    def has_injection(self, step_id: int) -> bool:
        """Check if a step has a scheduled tamper injection."""
        return step_id in self._schedule

    def execute(
        self,
        step_id: int,
        chain: MockChainStorage,
        projection: MockProjectionStorage,
        validity: MockValidityStateMachine,
    ) -> list[dict[str, Any]]:
        """Execute scheduled tamper injections for a step.

        Returns list of injection records with detection status.
        """
        if step_id not in self._schedule:
            return []

        results: list[dict[str, Any]] = []
        for injection in self._schedule[step_id]:
            tamper_type = injection["type"]
            target = injection["target"]

            # Simulate tamper by corrupting projection digest
            projection.corrupt_digest()

            # Tamper should be detected on next verification
            detected = True  # Mock always detects (deterministic)
            validity.force_state(ValidityState.DIVERGENT)

            results.append({
                "step_id": step_id,
                "tamper_type": tamper_type,
                "target": target,
                "detected": detected,
                "state_after": validity.state.value,
            })

        return results


class ConflictInjector:
    """Injects contradictory claims at scheduled steps.

    Per design doc section 2.2 (day 15): assert A then NOT-A
    for specified subjects.
    """

    def __init__(self) -> None:
        self._schedule: dict[int, list[dict[str, Any]]] = {}

    def schedule(self, step_id: int, subject: str, original_value: str, contradicting_value: str) -> None:
        """Schedule a conflict injection at a specific step."""
        if step_id not in self._schedule:
            self._schedule[step_id] = []
        self._schedule[step_id].append({
            "subject": subject,
            "original": original_value,
            "contradicting": contradicting_value,
        })

    def has_injection(self, step_id: int) -> bool:
        """Check if a step has a scheduled conflict injection."""
        return step_id in self._schedule

    def get_injections(self, step_id: int) -> list[dict[str, Any]]:
        """Get conflict injections for a step."""
        return self._schedule.get(step_id, [])


class PolicyViolationInjector:
    """Injects policy violations (cross-tenant reads, scope injection).

    Per design doc section 2.2 (day 20): cross-tenant read attempts.
    """

    def __init__(self) -> None:
        self._schedule: dict[int, list[dict[str, Any]]] = {}

    def schedule(self, step_id: int, violation_type: str, source_tenant: str, target_tenant: str) -> None:
        """Schedule a policy violation injection at a specific step."""
        if step_id not in self._schedule:
            self._schedule[step_id] = []
        self._schedule[step_id].append({
            "type": violation_type,
            "source_tenant": source_tenant,
            "target_tenant": target_tenant,
        })

    def has_injection(self, step_id: int) -> bool:
        """Check if a step has a scheduled policy violation."""
        return step_id in self._schedule

    def get_injections(self, step_id: int) -> list[dict[str, Any]]:
        """Get policy violation injections for a step."""
        return self._schedule.get(step_id, [])


@dataclass
class MockLimenInfrastructure:
    """Complete mock Limen infrastructure bundle."""

    chain: MockChainStorage = field(default_factory=MockChainStorage)
    projection: MockProjectionStorage = field(default_factory=MockProjectionStorage)
    projector: MockProjector | None = None
    validity: MockValidityStateMachine = field(default_factory=MockValidityStateMachine)
    tamper_injector: TamperInjector = field(default_factory=TamperInjector)
    conflict_injector: ConflictInjector = field(default_factory=ConflictInjector)
    policy_injector: PolicyViolationInjector = field(default_factory=PolicyViolationInjector)
    store: dict[tuple[tuple[str, ...], str], StoreItem] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.projector is None:
            self.projector = MockProjector(self.chain, self.projection)

    def store_put(
        self, namespace: tuple[str, ...], key: str, value: dict[str, Any], timestamp_ms: int
    ) -> StoreItem:
        """Put an item into the store."""
        store_key = (namespace, key)
        existing = self.store.get(store_key)
        item = StoreItem(
            namespace=namespace,
            key=key,
            value=value,
            created_at_ms=existing.created_at_ms if existing else timestamp_ms,
            updated_at_ms=timestamp_ms,
        )
        self.store[store_key] = item
        return item

    def store_get(self, namespace: tuple[str, ...], key: str) -> StoreItem | None:
        """Get an item from the store."""
        return self.store.get((namespace, key))

    def store_search(self, namespace: tuple[str, ...], query: str | None = None) -> list[StoreItem]:
        """Search store items in a namespace."""
        results: list[StoreItem] = []
        for (ns, _key), item in self.store.items():
            if ns == namespace:
                if query is None or query.lower() in json.dumps(item.value).lower():
                    results.append(item)
        return results
