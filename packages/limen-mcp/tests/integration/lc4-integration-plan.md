# LC.4 — Integration Test Plan (LIMEN-COORD-v1.0)

**Slice:** LC.4 (of LC.1 / LC.2 / LC.3 / LC.4)
**Status:** PLAN — scaffolding authored while LC.1 v4 round-4 Breaker + LC.2 v4 rewrite are in flight. Executable test bodies land once LC.2 v4 MCP tools match the LC.1 v4 envelope contract.
**Authors:** claude-code (plan), codex (LC.2 impl), shared (execution)
**Governance:** conformance rules C-1..C-23 in `docs/process/COORDINATION-PROTOCOL-v1.0.md`; test matrix T-1..T-15 in same doc Part 12.
**Witness-of-record:** femi (humans-in-the-loop smoke test).

---

## 1. Scope

LC.4 is the only gate that exercises **cross-layer conformance** between LC.2 (MCP tools) and LC.3 (CLI), over the ratified LC.1 v4 contract, against a live Limen engine, with three heterogeneous participants.

It proves that a claim written by LC.3 CLI (transport=`cli`) is read identically by an LC.2 MCP-tool caller (transport=`stdio` or `http`), and vice versa. Any envelope drift between the two implementations surfaces here.

It is explicitly NOT a repeat of LC.2's or LC.3's unit tests — those cover each side in isolation. LC.4 is the cross-side conformance gate.

## 2. Participants

| Participant | Transport | Role | Writer surface | Reader surface |
| --- | --- | --- | --- | --- |
| `femi`        | `cli`   | founder  | `limen room record` (LC.3) | `limen room read` (LC.3) |
| `claude-code` | `stdio` | member   | `limen_room_record` (LC.2) | `limen_room_read` (LC.2) |
| `codex`       | `http`  | member   | `limen_room_record` (LC.2) | `limen_room_read` (LC.2) |

All three write to and read from the same `entity:room:lc4_integration_test` subject.

## 3. Preconditions

- Limen engine initialized with an isolated `--dataDir` (fresh per test run).
- All three participant identities registered via `limen_agent_register` before any `room.*` append.
- Clock injected (deterministic for ordering assertions).
- No stray claims in the `entity:room:lc4_integration_test` subject.

## 4. Test scenarios

Each scenario maps to conformance rules C-* and test-matrix items T-*.

### T-4.1 — Founder creation + participant registration (C-9, §2.1)

1. `femi` publishes `room.participant` with role=`founder` via CLI.
2. `claude-code` publishes `room.participant` with role=`member` via stdio MCP.
3. `codex` publishes `room.participant` with role=`member` via http MCP.
4. Any participant calls `limen_room_read` → receives all 3 participant claims, chronologically ordered by `validAt`.

Verifies: §2.1 room-existence rule, §7.1 transport injection (`transport` in each reasoning envelope matches the channel used), §1.4 snake_case + top-level envelope.

### T-4.2 — Message exchange cross-transport (C-5, §3)

1. `femi` (cli) posts `room.message` value="hello from femi".
2. `claude-code` (stdio) posts `room.message` value="hi from claude" with `in_reply_to=<femi's claim-id>`.
3. `codex` (http) posts `room.message` with `mentions=[femi, claude-code]`.
4. Each reader (all three transports) sees the same 3 messages in the same order with the same `sender` + `transport` + `source_id` fields.

Verifies: cross-transport envelope consistency, mentions array, in_reply_to reference, §3.2 ordering.

### T-4.3 — source_id idempotency, single writer (C-4, T-4)

1. `claude-code` posts `room.message` with `source_id="abc-123"`.
2. `claude-code` posts the same `source_id="abc-123"` again.
3. Second call returns the SAME `claimId` as the first (idempotent hit), with `deduped: true`.

Verifies: §3.3 universal-across-kinds dedup.

### T-4.4 — source_id TOCTOU documented, concurrent writers (T-5)

1. `claude-code` and `codex` both attempt `room.message` with `source_id="race-1"` simultaneously.
2. Under race, the protocol permits both claims to land (2 distinct claim-ids). Assert document rather than test enforcement.

Verifies: §3.3 truthful TOCTOU caveat is accurate.

### T-4.5 — Blocker FSM progression (C-6, C-7, C-23, T-6, T-7, §4)

1. `claude-code` posts `room.blocker` value=`OPEN` with `blocker_id="b-lc4"`, `reason="review pending"`.
2. `codex` posts `room.blocker` value=`WAITING_ON_femi` with same `blocker_id`, `reason="need human call"`, `prior_state="OPEN"`.
3. `femi` (cli) posts `room.blocker` value=`RESOLVED` with same `blocker_id`, `reason="approved"`.
4. Projection: most-recent claim for `blocker_id="b-lc4"` has value=`RESOLVED`.
5. Attempt to post `room.blocker` value=`OPEN` with same `blocker_id` → MUST be rejected with `ROOM_BLOCKER_ILLEGAL_TRANSITION` (C-23).

Verifies: state-projection by `blocker_id`, illegal-transition enforcement.

### T-4.6 — Disagreement + resolve flow (T-8, §5)

1. `claude-code` posts `room.disagreement` value="FSM shape", `disagreement_id="d-lc4"`, `positions=[{by:claude-code,stance:A},{by:codex,stance:B}]`.
2. `codex` posts `room.resolve` with wrong `disagreement_id="d-nonexistent"` → MUST be rejected with `ROOM_RESOLVE_NO_OPEN_DISAGREEMENT` (C-23).
3. `codex` posts `room.resolve` value=`mutual`, `disagreement_id="d-lc4"`, `resolver=femi`, `rationale="merged position"`, `merged_position="A+B"` → accepted.
4. Projection: disagreement `d-lc4` → `RESOLVED_mutual`.

Verifies: disagreement_id existence check, mutual-resolution merged_position requirement.

### T-4.7 — CONFLICTED projection under race (T-14, §5.4)

1. `claude-code` posts `room.resolve` value=`claude-code` with `disagreement_id="d-conflict"` (pre-existing open).
2. `codex` posts `room.resolve` value=`codex` with same `disagreement_id` within the same `validAt` window.
3. Projection: disagreement `d-conflict` → `CONFLICTED`.
4. Renderer (LC.3 CLI `room read --kind resolve`) MUST display both claims with the CONFLICTED flag, NOT silently pick one.

Verifies: §5.4 three-state projection with honest race-surfacing.

### T-4.8 — Role descriptive-only (C-9, C-16, T-9, §2.3)

1. `claude-code` publishes `room.participant` for self with role=`observer`.
2. `claude-code` (now "observer") still publishes `room.blocker` — MUST be ACCEPTED. Audit log records the transport+sender.
3. v1.0 does NOT gate by role; descriptive-only scope confirmed.

Verifies: truthful limit in §2.3 is honest; role is a label not a gate.

### T-4.9 — Rate-limit coarse best-effort (T-13, §8.5)

1. `claude-code` (stdio) posts 60 `room.message` claims in a 60-second window → all accepted.
2. 61st `room.message` → rejected with `ROOM_RATE_LIMIT_EXCEEDED` (LC.3) / equivalent LC.2 error code.
3. Rotating sender to `codex` (stdio) → new bucket, first append accepted.

Verifies: `(transport, sender)` key, 60/min ceiling, rotation truthful-bypass documented.

### T-4.10 — Envelope snake_case cross-implementation (C-20, C-21)

1. LC.3 CLI writes a `room.blocker` with `blocker_id` + `reason` at top level of reasoning.
2. LC.2 MCP reader MUST find those fields at top level (NOT under a `details` nesting) — verify via `limen_room_read`.
3. LC.3 CLI reader MUST symmetrically find top-level fields written by LC.2.

Verifies: cross-side envelope parity — the #1 integration risk.

### T-4.11 — `isRoomPredicate` enumerated set (C-22, T-10, T-11)

1. `limen recall` without `--predicate` → returns zero `room.*` claims from the test room (excluded by `isRoomPredicate`).
2. `limen recall --predicate 'room.*'` → returns all room claims with `reasoning` preserved.
3. Add a hypothetical unratified `room.modeChange` claim directly via `limen.remember` (bypassing the tool layer) → bare recall still excludes it ONLY IF the enumerated check is replaced with prefix. With v4's enumerated-only check, this hypothetical `room.modeChange` would INCLUDE (not excluded from bare recall) — this is by design and asserts the tightening.

Verifies: C-22 enumerated-set discipline; unratified extensions are not silently blessed.

### T-4.12 — Mode projection (T-12)

1. Room with no `room.mode` claim → projection = `open` (default).
2. `femi` posts `room.mode` value=`debate`. Projection = `debate`.
3. Message posted in `debate` mode still accepted (v1.0 mode is declared-provisional per §6.2).

Verifies: §6.3 mode default, §6.2 truthful-provisional boundary.

### T-4.13 — Archive projection (C-18, T-15, §2.1)

1. `femi` publishes `room.participant` value=`archived` for the room.
2. Projection: room state = ARCHIVED.
3. Renderer MUST display the archiving sender prominently.
4. Subsequent appends of `room.message` are STILL accepted at the protocol level (v1.0 does not enforce post-archive write block); audit review is the compensating control.

Verifies: §2.1 archive-is-projected-state rule.

### T-4.14 — Transport injection tamper-resistance (C-3)

1. A malicious client-supplied `transport: 'cli'` in the reasoning payload of a `room_record` call via http → server overwrites with `transport: 'http'` before `limen.remember`.
2. Readers see the server-injected `transport`, NOT the spoofed value.

Verifies: §7.1 server-injected transport discipline.

### T-4.15 — Witness-from-ignorance smoke test (Witness gate)

Human-executed by Femi:
1. Install fresh Limen CLI + MCP server.
2. Start a room.
3. Exchange 5 messages between femi + claude-code + codex across all three transports.
4. Raise a blocker, resolve it.
5. Check `limen recall` behavior (room claims excluded from bare recall, included with `--predicate room.*`).
6. Score from ignorance: any friction, undocumented gotcha, or unexpected error message deducts.

Target: 10/10 from Femi.

## 5. Out of scope

- Performance / throughput benchmarks. LC.4 is a conformance gate, not a perf gate.
- Multi-room cross-talk. v1.0 does not specify cross-room references beyond `in_reply_to` within a single room.
- HMAC / cryptographic-signing testing. Deferred to v1.1 D-6.
- `debate` / `verify` mode parallel-dispatch semantics. Deferred to v1.1 D-1.

## 6. Execution notes

- Tests are runnable from `limen-mcp` package (for MCP-side) + `limen-cli` package (for CLI-side) against a shared `--dataDir`. The cross-package setup can be a single harness script.
- LC.3's `--as <sender>` override + `--poll-interval` + `--source-id` flags let the tests script deterministic CLI writes without interactive stdin.
- For LC.2, the tests import `recordRoomEvent` / `readRoomEvents` directly from `packages/limen-mcp/src/tools/room-coordination.ts` (once LC.2 is v4-conformant).

## 7. Done criteria

LC.4 is ratified when:
- All 14 automated scenarios pass.
- T-4.15 (Femi Witness) scores ≥ 9/10.
- Cross-side envelope-parity check (T-4.10) passes exactly — no tolerance for casing drift or `details` nesting.
- A combined Breaker pass over the integration test itself (I attack, Codex attacks) finds no new defects.

On ratification, LIMEN-COORD-v1.0 is CLOSED and ready for formal Femi ratification-commit on the Limen repo.

---

*End of LC.4 plan. Test bodies land once LC.2 v4 is Codex-committed against the LC.1 v4 envelope contract.*
