# LC.1 / LC.3 Coordination Breaker Report — Round 2

**Date:** 2026-04-18
**Artifacts under review:**
- `docs/process/COORDINATION-PROTOCOL-v1.0.md`
- `packages/limen-cli/src/commands/room.ts`
- `packages/limen-cli/src/commands/room-helpers.ts`
- `packages/limen-cli/src/commands/belief-postprocess.ts`
**Program:** LIMEN-COORD-v1.0
**Reviewer:** codex (Breaker-of-record)
**Builder:** claude-code
**Status:** FINDINGS SENT TO BUILDER

---

## Scope

This report covers:

1. LC.1 Breaker round 3 on the current protocol draft after the round-two contradiction fixes.
2. LC.3 Breaker round 2 on the current CLI room-command implementation after the first hardening pass.

The review target was not style. It was conformance truth:

- Does the document still contain clauses that would drive divergent implementations?
- Does the CLI actually emit and enforce the protocol it claims to implement?

---

## Executive Verdict

**LC.1 is not yet ratifiable.**

The major race/authority contradictions from the earlier rounds are closed, but the current draft still contains one load-bearing idempotency contradiction and one stale conformance rule that point implementers in different directions.

**LC.3 is not yet ratifiable.**

The prior command defects around duplicate `source_id` handling and kind-value validation were closed, but the CLI still does not emit a protocol-conformant reasoning envelope and still does not enforce the protocol's required semantic checks for blocker, participant, and resolve events.

---

## Findings

| Finding ID | Severity | Title | Verdict |
| ---------- | -------- | ----- | ------- |
| F-LC1-R3-001 | HIGH | Idempotency algorithm still contradicts the all-event `source_id` contract | OPEN |
| F-LC1-R3-002 | MEDIUM | Conformance matrix still carries a stale per-sender rate-limit rule | OPEN |
| F-LC3-R2-004 | HIGH | CLI room-event reasoning envelope is not protocol-conformant | OPEN |
| F-LC3-R2-005 | HIGH | CLI `room record` does not enforce required blocker/resolve/participant semantics | OPEN |
| F-LC3-R2-006 | MEDIUM | CLI room append path does not implement the required coarse rate limit | OPEN |
| F-LC3-R2-007 | MEDIUM | `isRoomPredicate` overmatches beyond the ratified predicate set | OPEN |

---

## Detailed Findings

### F-LC1-R3-001 — Idempotency algorithm still contradicts the all-event `source_id` contract

**Location**
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:227-233`
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:140`
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:512`

**What breaks**

The protocol says `source_id` is mandatory on **every append** and the conformance matrix repeats that requirement. But the idempotency algorithm still says the tool layer should query recent `room.message` claims specifically:

1. "Every `room_append`-style tool call MUST accept a caller-supplied `source_id`."
2. Step 1 then says to query recent `room.message` claims for the room where `reasoning.source_id == <incoming source_id>`.

Those two statements are not equivalent. A literal implementation of §3.3 could remain "conformant" while deduping messages only and ignoring `source_id` on `room.blocker`, `room.resolve`, `room.participant`, and `room.mode`.

**Why this matters**

This is not wording drift. It can produce divergent implementations:

- one implementation dedupes all `room.*` appends;
- another dedupes only `room.message`;
- both claim conformance.

That is exactly the kind of protocol ambiguity LC.1 is supposed to eliminate.

**Required correction**

Pick one truthful rule and state it once:

- either `source_id` is universal and the dedup query is same subject + same predicate for every append kind,
- or `source_id` is message-only and the rest of the document must stop claiming otherwise.

---

### F-LC1-R3-002 — Conformance matrix still carries a stale per-sender rate-limit rule

**Location**
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:431-439`
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:520`
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:527`

**What breaks**

§8.5 correctly says the v1.0 rate-limit key is coarse best-effort `(transport, sender)`. C-19 repeats that correctly. But C-12 still says:

- `Rate-limit appends per-sender`

That is the older, weaker, and now explicitly superseded rule.

**Why this matters**

The conformance matrix is what implementers and certifiers will often scan first. Leaving both rules in place means the document still contains two incompatible answers to the same question.

**Required correction**

Make C-12 match §8.5/C-19 or delete it as redundant.

---

### F-LC3-R2-004 — CLI room-event reasoning envelope is not protocol-conformant

**Location**
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:124-140`
- `packages/limen-cli/src/commands/room.ts:125-133`
- `packages/limen-cli/src/commands/room.ts:521-530`
- `packages/limen-cli/src/commands/room-helpers.ts:80-89`

**What breaks**

LC.1 defines a reasoning envelope with mandatory fields and names:

- `schema_version`
- `sender`
- `timestamp`
- `transport`
- `source_id`
- predicate-specific fields at the top level

The CLI emits a different contract:

- it omits `schema_version` entirely;
- it uses camelCase `sourceId`, not spec-level `source_id`;
- `sourceId` is optional on `room record`, even though LC.1 says `source_id` is mandatory on every append;
- predicate-specific metadata from `--details-json` is nested under `details` instead of being merged at the top level where LC.1 expects fields such as `blocker_id`, `disagreement_id`, `participant_id`, and `trust_level`.

This is not a cosmetic casing issue. It means a reader that follows LC.1 literally will not find the metadata where the CLI writes it.

**Why this matters**

The whole point of LC.1 is that LC.2, LC.3, and Parley can share one protocol contract. Right now:

- a spec-faithful implementation will look for `reasoning.source_id`;
- LC.3 writes `reasoning.sourceId`;
- a spec-faithful implementation will look for `reasoning.disagreement_id`;
- LC.3 puts the user payload under `reasoning.details.disagreement_id`.

That breaks cross-implementation interoperability and makes required protocol checks impossible to apply consistently.

**Required correction**

Choose one contract and make all layers converge:

- either LC.1 adopts the emitted shape, or
- LC.3 is rewritten to emit the ratified LC.1 envelope exactly.

Silent tolerance on both spellings is not a real convergence strategy; it just extends the drift window.

---

### F-LC3-R2-005 — CLI `room record` does not enforce required blocker/resolve/participant semantics

**Location**
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:179`
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:279-285`
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:307-320`
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:545-546`
- `packages/limen-cli/src/commands/room.ts:343-423`
- `packages/limen-cli/src/commands/room.ts:509-567`

**What breaks**

The CLI now validates enum-shaped values such as `mode=open` or `blocker=WAITING_ON_codex`. That is necessary, but it is not sufficient for protocol conformance.

Required LC.1 semantics still are not enforced:

- `room.blocker` requires `blocker_id`, projection by blocker id, and illegal-transition rejection.
- `room.resolve` requires `reasoning.disagreement_id` pointing to an existing open disagreement in the same room, with rejection on missing/unknown disagreement.
- `room.participant` requires `participant_id` and `trust_level` in reasoning for projection/audit semantics.

The CLI `record` path does none of those checks. It parses `--details-json`, nests it under `details`, and then appends immediately. There is no code path that:

- extracts `blocker_id`,
- looks up prior blocker state,
- rejects `RESOLVED -> OPEN`,
- extracts `disagreement_id`,
- verifies the disagreement exists,
- or requires participant metadata.

**Why this matters**

The CLI can therefore append events that the protocol says must be rejected. This violates the load-bearing test matrix:

- T-7 `RESOLVED -> OPEN` blocker transition rejection
- T-8 reject resolve without open disagreement

The issue is deeper than missing tests. The command surface currently cannot represent or validate the protocol's required state-carrier fields in their ratified locations.

**Required correction**

Redesign `room record` around the actual protocol event shapes, not a generic `(kind, value, detailsJson)` tunnel. The command must expose and validate the semantic keys each event type requires.

---

### F-LC3-R2-006 — CLI room append path does not implement the required coarse rate limit

**Location**
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:427-439`
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:520`
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:551`
- `packages/limen-cli/src/commands/room.ts:447-567`
- `packages/limen-cli/src/commands/room.ts:114-139`

**What breaks**

LC.1 requires the tool layer to rate-limit appends with the v1.0 coarse key `(transport, sender)`. The CLI join-message path and the explicit `room record` path both go from basic validation straight to `remember(...)`.

There is no rate-limit counter, no rejection branch, no window accounting, and no error code for the 61st append/minute case from T-13.

**Why this matters**

This is a direct conformance gap, not a stretch goal. The protocol explicitly says the rate limit is weak and only meant to stop accidental flooding. But even that weaker protection does not exist in LC.3 today.

**Required correction**

Implement the coarse v1.0 rate-limit or narrow the LC.1 requirement before ratification. Right now the document says the limit exists and the CLI does not.

---

### F-LC3-R2-007 — `isRoomPredicate` overmatches beyond the ratified predicate set

**Location**
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:106-110`
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:459-463`
- `packages/limen-cli/src/commands/belief-postprocess.ts:145-147`
- `packages/limen-cli/tests/commands/belief-postprocess.test.ts:172-176`

**What breaks**

LC.1 is explicit that the ratified room predicate set is:

- `room.message`
- `room.blocker`
- `room.disagreement`
- `room.resolve`
- `room.participant`
- `room.mode`

§9.1 says `isRoomPredicate()` should return true iff the predicate matches that enumerated set. But the CLI implementation uses:

- `predicate.startsWith('room.')`

and the tests explicitly bless forward-compatible predicates such as `room.modeChange`.

**Why this matters**

This is a protocol/implementation mismatch. The CLI is making a forward-compatibility decision the protocol has not ratified. That means bare recall filtering behavior can change for unratified `room.*` predicates without LC.1 ever saying those predicates belong to the coordination protocol.

**Required correction**

Either tighten `isRoomPredicate()` to the ratified set, or amend LC.1 to bless prefix-wide future `room.*` filtering intentionally.

---

## Additional Drift Notes

### D-LC1-R3-001 — Status/version headers are internally inconsistent

**Location**
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:4`
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:605`

The file header says:

- `DRAFT v2 — POST-BREAKER-1; BREAKER-REVIEW-PENDING (pass 2)`

The end note still says:

- `DRAFT v1 — BREAKER-REVIEW-PENDING`

This did not affect my technical findings, but it should be cleaned before ratification so the artifact has one truthful lifecycle state.

---

## Repro / Evidence Notes

### Static evidence for the envelope mismatch

The CLI write path constructs reasoning metadata at:

- `packages/limen-cli/src/commands/room.ts:521-530`

That object omits `schema_version`, writes optional `sourceId`, and nests user payload as `details`.

### Shared root-cause note

The same `sourceId` + nested `details` pattern appears in the MCP room tool at:

- `packages/limen-mcp/src/tools/room-coordination.ts:189-200`

I am not scoring that as an LC.2 formal finding here because Claude still owes the dedicated LC.2 Breaker pass on that slice, but the root cause is shared and should be fixed once across both implementations.

---

## Required Next Move

Protocol ratification should pause until:

1. LC.1 resolves the remaining idempotency/rate-limit conformance contradictions.
2. LC.3 is redesigned around the actual ratified event envelopes and semantic checks rather than a generic `detailsJson` tunnel.

Once those land, I can immediately re-run Breaker on the new LC.1 and LC.3 revisions.
