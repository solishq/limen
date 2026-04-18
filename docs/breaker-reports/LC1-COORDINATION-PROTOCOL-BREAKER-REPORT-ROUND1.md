# LC.1 Coordination Protocol Breaker Report — Round 1

**Date:** 2026-04-18
**Artifact under review:** `docs/process/COORDINATION-PROTOCOL-v1.0.md`
**Program:** LIMEN-COORD-v1.0
**Reviewer:** codex (Breaker-of-record)
**Builder:** claude-code
**Status:** FINDINGS SENT TO BUILDER

---

## Scope

This report covers the first adversarial review pass on the LC.1 protocol draft. The review was focused on the six attack targets explicitly requested by the Builder:

1. Room-id normalization collision
2. Idempotency TOCTOU under concurrent writers
3. Blocker FSM dead-end / illegal states
4. Disagreement resolution race
5. Participant role elevation / authorization
6. Rate-limit bypass across spoofed or multi-transport identities

The review also checked protocol claims against the current Limen substrate and MCP identity model where those runtime constraints materially affect protocol truthfulness.

---

## Findings

| Finding ID | Severity | Title | Verdict |
| ---------- | -------- | ----- | ------- |
| F-LC1-001 | HIGH | Non-bijective room-id normalization aliases distinct rooms | OPEN |
| F-LC1-002 | CRITICAL | Participant authorization is not enforceable as written | OPEN |
| F-LC1-003 | HIGH | Disagreement resolution claims stronger exclusivity than the substrate can guarantee | OPEN |
| F-LC1-004 | MEDIUM | Per-sender rate limit is bypassable by design | OPEN |
| F-LC1-005 | MEDIUM | Archive authority is internally contradictory | OPEN |

---

## Detailed Findings

### F-LC1-001 — Non-bijective room-id normalization aliases distinct rooms

**Location**
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:66-74`

**What breaks**

The normalization rule replaces every `:` with `_` and then uses the result as the authoritative subject segment. That is not injective. Two distinct human-facing room ids can collapse onto the same persisted room subject:

- `a:b-1` -> `a_b-1`
- `a_b-1` -> `a_b-1`

At that point, the protocol has merged two logically distinct rooms into a single `entity:room:<room-id>` subject. Preserving the original `human_room_id` in reasoning does not repair the collision because the alias has already happened at the authoritative storage key.

**Why this matters**

This is not a readability issue. It changes the identity of the room itself. Messages, blockers, disagreements, and participant-role projection from both human room ids now share one append-only state history.

**Required correction**

The protocol needs one of:

- an injective normalization/encoding scheme, or
- a stricter rejection rule that forbids ambiguous human ids before persistence.

Documentation-only mitigation is insufficient.

---

### F-LC1-002 — Participant authorization is not enforceable as written

**Location**
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:142-177`
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:318-335`
- `packages/limen-mcp/src/adapter.ts:7`
- `packages/limen-mcp/src/adapter.ts:41-43`
- `packages/limen-mcp/src/adapter.ts:65-79`

**What breaks**

The protocol gives authorization meaning to `room.participant` claims, but it does not define a trustworthy actor identity that the tool layer can use to authorize those mutations.

The current protocol state model says:

- a participant's current role is the most recent `room.participant` claim for that `participant_id`
- `sender` is self-declared
- `transport` is the trust anchor

That is not enough to enforce role mutation permissions. `transport` is only a coarse channel label (`stdio`, `http`, `cli`), not a unique principal. In the current Limen MCP runtime, one server process registers as `limen-mcp`, so the internal engine identity is not a per-human/per-agent principal either.

A malicious or buggy writer can therefore emit a later `room.participant` claim for self or another participant and the projection rule accepts it unless the protocol adds a stronger authorship rule than it currently specifies.

**Why this matters**

This undermines the role matrix itself. If participant mutation authorship is not authoritative, then all higher-level permissions derived from it are unstable:

- who may assert blockers
- who may resolve disagreements
- who may archive the room
- who is founder vs member vs observer

The protocol currently has an audit trail, but not an authorization basis.

**Required correction**

The protocol must either:

- define a server-authenticated actor/principal that is injected into the append path and used for authorization, or
- reduce scope and stop claiming enforceable role-governed participant mutation in v1.0.

Any solution that still trusts the self-declared `sender` field is insufficient.

---

### F-LC1-003 — Disagreement resolution claims stronger exclusivity than the substrate can guarantee

**Location**
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:276-287`

**What breaks**

The protocol says a `room.resolve` claim is valid only if no prior `room.resolve` exists for the same `disagreement_id`. But unlike the idempotency section, there is no explicit truthful caveat for concurrent writers.

Two resolvers can both:

1. observe an open disagreement,
2. observe no prior resolution,
3. append different `room.resolve` claims.

The projection rule then silently picks the most recent resolve claim and treats that as the winner.

**Why this matters**

This is not just duplicate noise. It can rewrite the outcome of a resolved disagreement after the fact and make the protocol report a single authoritative winner where the substrate actually recorded a race.

**Required correction**

The protocol must do one of:

- weaken the claim truthfully and define concurrent double-resolution as a conflict state,
- require a stronger uniqueness primitive than query-before-append, or
- otherwise stop promising single-resolution semantics on the current append-only substrate.

---

### F-LC1-004 — Per-sender rate limit is bypassable by design

**Location**
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:328-331`
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:366-382`

**What breaks**

The protocol recommends rate limiting per `sender`, but it also says `sender` is self-declared and impersonable. That means the simplest bypass is not even multi-transport; it is rotating sender strings.

Even if implementations try to key on transport, the protocol still does not define a canonical authenticated principal that unifies:

- stdio participants
- http participants
- cli participants

So the current rule is not enforceable as a meaningful anti-flood control.

**Why this matters**

The protocol is presenting a mitigation that looks stronger than it is. A reader could incorrectly conclude that appends are rate limited per actor when the actual guarantee is, at best, coarse and transport-dependent.

**Required correction**

The protocol should either:

- define a server-authenticated principal as the rate-limit key, or
- restate the limit as coarse best-effort protection rather than actor-accurate rate limiting.

---

### F-LC1-005 — Archive authority is internally contradictory

**Location**
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:144`
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:160`
- `docs/process/COORDINATION-PROTOCOL-v1.0.md:167`

**What breaks**

The draft uses three incompatible statements for room archival authority:

- room archival requires an identity holding `admin` participant role
- the participant role enum has no `admin` role
- the role matrix says `founder` may archive

Because ARCHIVED is terminal, this is not a cosmetic inconsistency. The protocol does not currently define one authoritative rule for who may permanently archive a room.

**Required correction**

The document needs a single archival authority rule and matching role vocabulary. All conflicting language should be removed.

---

## Requested Attack Targets — Disposition

### 1. Normalization collision

**Result:** HIT

See `F-LC1-001`.

### 2. Idempotency TOCTOU under concurrent writers

**Result:** NO FINDING on the truth claim itself

The draft is honest that idempotency is best-effort only and does not promise exactly-once semantics under concurrent writers.

**Minor note**

The algorithm text queries recent `room.message` claims specifically, even though `source_id` is described as mandatory on every append. The next revision should either:

- scope dedup explicitly to messages, or
- say same subject + same predicate rather than `room.message`.

### 3. Blocker FSM dead-end / illegal states

**Result:** NO STANDALONE FINDING

The state graph itself is small and closed:

- `OPEN`
- `WAITING_ON_<agent>`
- `RESOLVED`

`RESOLVED` remains reachable from the non-terminal states in finite steps. I did not find a state-space dead-end in the documented graph.

**Boundary note**

This does not clear blocker authorization. Blocker correctness still depends on `F-LC1-002`, because `WAITING_ON_<agent>` is only meaningful if participant identity and authorization are trustworthy.

### 4. Disagreement resolution race

**Result:** HIT

See `F-LC1-003`.

### 5. Role elevation / self-published participant mutation

**Result:** HIT

See `F-LC1-002`.

### 6. Rate-limit bypass / multi-transport same identity

**Result:** HIT

See `F-LC1-004`.

---

## Additional Drift Notes

### D-LC1-001 — Migration tool names do not match the current LC.2 foundation

`Part 10` references `limen_room_create` and `limen_participant_register`, but the current LC.2 foundation exposes `limen_room_record` and `limen_room_read`.

This may be a temporary naming placeholder, but if so it should be marked explicitly. Otherwise the spec is already drifting from the implementation track.

---

## Builder Direction

The next protocol revision should:

1. Fix room identity so distinct human ids cannot alias onto the same room subject.
2. Define authoritative actor identity for participant mutations and permission checks, or reduce the claimed authorization scope.
3. Correct disagreement resolution so concurrent double-resolve is represented truthfully.
4. Replace per-sender rate-limit language with a defensible principal key or a truthful weaker claim.
5. Collapse archival authority to one coherent rule.

---

## Review Verdict

**NO-GO for ratification in current form.**

The draft is promising and the `room.*` substrate framing is strong, but the current version overstates what the underlying identity and append-only model can guarantee in several places. Those seams are repairable, but they are protocol defects, not documentation polish.
