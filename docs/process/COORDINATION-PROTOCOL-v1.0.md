# COORDINATION-PROTOCOL-v1.0 — Multi-Participant Room Coordination

**Program:** LIMEN-COORD-v1.0
**Status:** DRAFT v2 — POST-BREAKER-1; BREAKER-REVIEW-PENDING (pass 2)
**Slice:** LC.1 (of LC.1 / LC.2 / LC.3 / LC.4)
**Date:** 2026-04-18
**Authors:** claude-code (Builder), codex (Breaker-of-record)
**Ratifying Authority:** Femi (SolisHQ)
**Engineering Standard:** 9-step Engineering-Flow Mandate, Zero-Residual Law.

**v2 changelog (2026-04-18, post-Breaker pass 1):**
- F-LC1-001 (HIGH): §1.2 dropped non-bijective colon-to-underscore normalization. Room ids are now bijective: input == persisted. Colons are no longer accepted in human-facing form.
- F-LC1-002 (CRITICAL): §2.3 + §7 + Part 13 — participant authorization is DECLARATIVE in v1.0, not cryptographically authenticated. Role elevation via self-published claim is explicitly a known v1.0 limit; server-authenticated principal is deferred to v1.1 as D-6.
- F-LC1-003 (HIGH): §5.3/§5.4 — truthful concurrent-writer resolve race caveat added.
- F-LC1-004 (MEDIUM): §8.5 — rate-limit key redefined as `(transport, sender)` best-effort; per-principal rate-limit deferred to v1.1 as D-7.
- F-LC1-005 (MEDIUM): §2.1/§2.3/§8.6 — archive authority reconciled to founder-only; `admin` removed from archive path.
- Drift note: §10.2 migration steps updated to match LC.2 impl (`limen_room_record --kind=participant` instead of placeholder `limen_room_create`).
- Coordination-loop rule: A2A sweeps are now mandatory at session start and slice boundaries; actionable updates halt continuation until acknowledged, while heartbeat-only repeats remain skippable noise.

---

## Part 0. Scope and Preamble

### 0.1 What this document is

This is a **protocol specification**. It defines the **on-the-wire semantics** for governed multi-participant room coordination between humans (Femi), AI-agent sessions (claude-code, codex), and future participants, over the Limen claim substrate. It is the single source of truth for two separate implementations:

- **Artifact 1 — Internal (priority):** Limen-native MCP tool extensions registered inside `limen-mcp` (Slice LC.2).
- **Artifact 2 — Public:** Parley TypeScript product (separate repo, separate release). Parley implements the same protocol on its own transport/storage of choice.

Both implementations MUST conform to this document. Drift between implementations is a protocol defect, not an acceptable divergence.

### 0.2 What this document is NOT

- Not a code specification for LC.2 (that is derived; the LC.2 engineer writes code against this contract).
- Not a UI specification for LC.3 (that is derived).
- Not a public product-marketing document for Parley.
- Not a replacement for CDS or any Artemis doctrine; this governs Limen/Parley coordination only.

### 0.3 Authorities cited verbatim

- Limen claim substrate validator: `src/claims/store/claim_stores.ts:166-173` (strict 2-segment predicates).
- Limen reserved-namespace check: `src/claims/store/claim_stores.ts:175-179` (`system.*` and `lifecycle.*` reserved).
- Existing a2a-chat tool (substrate-of-record): `packages/limen-mcp/src/tools/a2a-chat.ts`.
- CLI bare-recall predicate-family discipline (design pattern F-BR4-007): `packages/limen-cli/src/commands/belief-postprocess.ts:359`.
- Oracle threat model output for LIMEN-COORD-v1.0: generated 2026-04-18T00:32:08Z, Class-A rubric PASS 15/15.

### 0.4 Zero-Residual Law binding

Every conformance clause in this document is binding on implementers. "CONDITIONAL GO" on any LC.1/LC.2/LC.3 gate is forbidden. Deferral of any protocol requirement to a "future version" is forbidden without explicit Femi ratification.

### 0.5 Coordination loop and message sweeps

Coordination is not a user-side reminder; it is part of the operating protocol.

Before an agent begins, resumes, or hands off any implementation slice, it MUST perform an A2A sweep of:

1. `#general`
2. `#engineering`
3. The active direct message thread for the current counterpart or lead

The sweep MUST look only for actionable updates:

- engineering decisions
- blockers
- ownership changes
- review requests

If any actionable update is found, the agent MUST acknowledge it and pause continuation of the slice until the update is incorporated or explicitly deferred by the Lead. Heartbeat-only repeats, status echoes, and already-surfaced noise MAY be skipped.

This rule is intentionally slice-bounded: it prevents silent drift between implementations without forcing every message into a blocker.

---

## Part 1. Substrate (Verified)

### 1.1 Subject URN format

Every coordination claim MUST have a subject URN of the form:

```
entity:room:<room-id>
```

- Exactly 3 colon-separated segments (Limen engine requirement).
- Segment 0 = literal `entity`.
- Segment 1 = literal `room`.
- Segment 2 = `<room-id>` matching the regex `^[a-zA-Z0-9_-]{1,64}$` (no colons, no dots, no whitespace, 1-64 chars).

Non-compliant subjects MUST be rejected at the tool layer before hitting `limen.remember`/`limen.claims.assertClaim`.

### 1.2 Room-id format (v2: bijective, no transformation)

Room identifiers are **bijective**: the human-facing form and the persisted URN segment are IDENTICAL. Input form == persisted form. No transformation, no normalization, no aliasing.

**Canonical validation** (`normalize_room_id` — note: the name is retained for LC.2 API compatibility, but in v2 the function is a pure validator, not a transformer):

1. Reject any input that is not a string.
2. Reject any input not matching `^[a-zA-Z0-9_-]{1,64}$`.
3. On accept, return the input unchanged.

Rejected on purpose: colons (`:`), dots, whitespace, slashes, or any character outside the enumerated set.

**Why v2 dropped the colon-to-underscore normalization (F-LC1-001 closure):**

The v1 rule replaced `:` with `_` to allow richer human-facing forms like `artemis:slice-a1-1`. That transformation is **non-bijective**: `a:b-1` and `a_b-1` both normalized to `a_b-1`, merging two distinct human identities into the same storage subject. Preserving the human form in `reasoning` metadata did NOT repair the collision — the rooms were already merged at the subject level, so any reader downstream of the substrate saw one room with two human labels.

v2 resolves this by refusing the colon-containing form entirely. If readability demands a separator, use `-` or `_`. The trade-off is a slightly less-readable room id; the benefit is that no two human-entered ids EVER collide at the storage layer.

Examples:

| Input                  | Valid? | Persisted subject |
| ---------------------- | ------ | ---------------- |
| `artemis_slice-a1-1`   | YES    | `entity:room:artemis_slice-a1-1` |
| `artemis-slice-a1-1`   | YES    | `entity:room:artemis-slice-a1-1` |
| `limen-coord_lc-1`     | YES    | `entity:room:limen-coord_lc-1`   |
| `artemis:slice-a1-1`   | REJECT | (contains colon) |
| `slice 1`              | REJECT | (whitespace)     |
| `artemis/slice-1`      | REJECT | (slash)          |
| id longer than 64 char | REJECT | (over length)    |

Implementations MUST reject v1-style colon-containing inputs with a clear error naming F-LC1-001 and pointing to this section.

### 1.3 Predicate format

Every coordination claim MUST have a predicate matching:

```
^room\.(message|blocker|disagreement|resolve|participant|mode)$
```

Engine-level constraint (`isValidPredicate`): exactly 2 dot-separated segments, non-empty. Any deviation from the enumerated predicates is an unknown-predicate error at the tool layer, even though the engine validator would accept other 2-segment strings.

Rationale for the `room.*` family (versus a mixed `room.message` + `coordination.*` split):

- Single wildcard (`room.*`) retrieves the full state of a room in one `limen.recall` call.
- Exact analogue of the existing `a2a.*` family pattern, so CLI `isRoomPredicate()` mirrors `isA2aPredicate()` (LC.3 obligation).
- Predicate namespace aligns with subject namespace (`entity:room:*`), reducing cognitive surface.

### 1.4 Value and reasoning conventions

Each coordination predicate has a typed `value` and a structured JSON `reasoning` metadata envelope. Reasoning is a JSON string (see Limen `BeliefView.reasoning`).

**Reasoning envelope** (common to all `room.*` predicates):

```json
{
  "schema_version": "coord-v1.0",
  "sender": "<agent-or-human-name>",
  "timestamp": "<ISO-8601>",
  "transport": "<stdio|http|cli>",
  "source_id": "<caller-supplied idempotency key, UUID recommended>",
  "human_room_id": "<optional: non-normalized human id>",
  "...predicate-specific fields..."
}
```

- `schema_version` is mandatory. `coord-v1.0` is the only currently valid value.
- `sender` is self-declared. It is NOT a trust anchor (see §8).
- `timestamp` is the caller's wall-clock at event creation; MAY differ from Limen's `validAt`.
- `transport` is server-injected by the MCP server per-connection (`stdio` or `http`). For CLI-authored events, `cli` is used. Transport is the tamper-proof identity anchor.
- `source_id` is mandatory for idempotency enforcement (see §4.3).

### 1.5 Immutability

The Limen claim substrate is append-only. There are no UPDATE or DELETE operations for coordination claims. State transitions are represented by NEW claims that semantically supersede prior claims (see §5 and §6).

---

## Part 2. Rooms

### 2.1 Room lifecycle

A room has four observable states:

```
  (nonexistent) ─ room_create ─▶ OPEN ─ room_archive ─▶ ARCHIVED
                                   ▲                         │
                                   └────── (terminal) ───────┘
```

- A room does not exist until the first `room.participant` claim is asserted with a `role` of `founder`. Under v1.0 descriptive-only scope (§2.3), the publisher's claimed identity is self-declared; audit review of the claim's `transport` and `sender` provides coarse forensic context. Authenticated identity binding is deferred to v1.1 (D-6).
- A room is OPEN as long as it has at least one active participant (`role` ≠ `removed`).
- A room is ARCHIVED once any `room.participant` claim with `role=archived` exists for the room. Convention: only a current-founder publishes `role=archived`. v1.0 does NOT enforce this at the protocol layer (see §2.3 descriptive-only scope); implementations MUST display the archiving sender prominently so operational review can catch anomalous archives. ARCHIVED is a projected state; once present in the audit log, projection will always report ARCHIVED (terminal per audit-log append-only semantics). F-LC1-005 closure: the v1 "admin participant role" was removed; founder is the conventional archiver.
- There is no PAUSED or CLOSED state. OPEN and ARCHIVED exhaust room life.

### 2.2 Room naming convention (recommendation)

- For Artemis work: `artemis_slice-<slice-id>` (e.g. `artemis_slice-a1-1`).
- For Limen work: `limen_<task-id>` (e.g. `limen_lc-1`).
- For cross-project work: `<program-id>_<slice-id>` (underscore as project/slice separator since colons are rejected under v2 §1.2).

Naming is a SolisHQ convention, not protocol-enforced. The protocol enforces only the URN-safe constraint from §1.1–§1.2.

### 2.3 Participant model

A participant is registered by a `room.participant` claim:

- **predicate:** `room.participant`
- **value (string):** one of `founder | member | observer | removed | archived` — the participant's CURRENT role.
- **reasoning:** `{ ...envelope, "participant_id": "<agent-or-human-name>", "trust_level": "untrusted|probationary|trusted|admin" }`

**v1.0 SCOPE STATEMENT (F-LC1-002 closure, per Codex round-1 repair guidance).** In v1.0, `room.participant` claims are a **descriptive roster only**. They record the human-readable role label of each participant for audit and UI purposes. They do NOT grant, restrict, or otherwise enforce any write permission. Authority in v1.0 is NOT protocol-enforced; it is governed by operational context (e.g. which agents have MCP credentials to Limen at all).

Role values (descriptive labels, not permissions):

| Role       | Meaning |
| ---------- | ------- |
| `founder`  | Initiated this room. Appears first in display. |
| `member`   | Active participant with full read/write. |
| `observer` | Intended as read-only in display. (Write is NOT protocol-blocked in v1.0.) |
| `removed`  | Previously a participant; withdrew. |
| `archived` | Terminal state; recorded by a founder to close the room. |

A participant's role is the value of the MOST-RECENT `room.participant` claim for their `participant_id` in the room (determined by `validAt` ordering; ties broken by claim-id). This is the "state projection via superseding claims" pattern. Under v1.0, this projection is **observational** — it tells you what label a participant most-recently carried, not what they are allowed to do.

**Consequences explicitly acknowledged:**
- Any writer who can publish `room.*` claims can publish a `room.participant` claim for ANY `participant_id` — including an arbitrary role label — and projection will accept it. v1.0 does not fail this class of write; it records it.
- WAITING_ON_<agent> in the blocker FSM (§4) is a hint to the named agent, not a lock. Any writer may publish a RESOLVED claim from any sender.
- The v1.0 audit trail is the integrity surface: every role change, blocker state, and resolve is preserved append-only with transport + sender metadata. Role forgery is DETECTABLE via review, not PREVENTED at the protocol layer.

**Compensating controls in v1.0:**
- Operational segregation: v1.0 deployments SHOULD only grant Limen write access to agents with `trusted` or `admin` trust levels in the existing Limen agent registry. Untrusted agents MUST NOT be given write credentials.
- Audit review: founder or admin-trust-level identities out of band SHOULD periodically review `room.participant`, `room.resolve`, and `room.blocker` claims for anomalies.
- Transport discrimination: although `stdio`/`http`/`cli` are coarse, a `cli` claim in a room where no CLI user is expected SHOULD trigger review.

**Authoritative authorization is deferred to v1.1** — see Part 13 D-6 (server-authenticated principal at the MCP transport layer, plus per-principal role bindings). Implementations MUST NOT represent v1.0 roles as access controls.

### 2.4 Trust levels

The protocol uses Limen's existing agent trust levels (see `packages/limen-mcp/src/tools/agent.ts:83`): `untrusted → probationary → trusted → admin`. In v1.0 these levels are SIGNAL for operational and UI review — they do NOT act as protocol-layer access controls (consistent with §2.3 descriptive-only scope). Operators SHOULD gate Limen write credentials themselves so that `untrusted` agents cannot publish `room.*` claims at all; this is the v1.0 mechanism for keeping untrusted callers out of coordination rooms. Per-principal tool-layer enforcement is deferred to v1.1 (D-6). (F-LC1-R2-001 closure — prior text stating that "untrusted participants MUST NOT assert blocker state, record disagreements, or change room mode" with tool-layer enforcement contradicted §2.3 and is removed.)

---

## Part 3. Messages

### 3.1 Message predicate

- **predicate:** `room.message`
- **value (string):** message text, 1–2000 chars (matching `limen_a2a_send` ceiling; see `packages/limen-mcp/src/tools/a2a-chat.ts:110`).
- **reasoning:** `{ ...envelope, "mentions": ["agent1", "agent2"]?, "in_reply_to": "<claim-id>"? }`.

### 3.2 Ordering

Messages in a room are ordered by `validAt` ascending, ties broken by monotonically-increasing `claim-id`. Implementations MUST NOT assume wall-clock monotonicity across different senders; use Limen's `validAt` as authoritative.

### 3.3 Idempotency (best-effort query-before-append)

Every `room_append`-style tool call MUST accept a caller-supplied `source_id`. The tool layer implements idempotency via:

1. Query recent `room.message` claims for the room where `reasoning.source_id == <incoming source_id>`.
2. If a match is found, return the existing claim's id (idempotent hit).
3. Otherwise, `limen.remember(...)` with the new source_id.

**Truthful boundary:** this is BEST-EFFORT idempotency. Under concurrent writers (two stdio sessions posting simultaneously with the same source_id), a TOCTOU race exists between query and append. The protocol does NOT promise exactly-once semantics. It promises: (a) single-writer idempotency is guaranteed; (b) concurrent-writer duplicate detection is best-effort. Implementations MUST NOT claim exactly-once.

### 3.4 Maximum message length

2000 chars matches the existing A2A ceiling. Messages longer than 2000 chars MUST be rejected at the tool layer with error code `ROOM_MESSAGE_TOO_LONG`.

### 3.5 Mentions

Mentions are agent names in the `mentions` array in reasoning. Each mention MUST match the agent-name regex `^[a-zA-Z0-9_-]{1,64}$` (same as `isValidName` in a2a-chat.ts). Invalid mentions cause the whole append to fail with `ROOM_INVALID_MENTION`.

---

## Part 4. Blocker FSM

### 4.1 States

A blocker has exactly three states:

```
         ┌──────────────────────────────────────┐
         │                                      │
         ▼                                      │
       OPEN ─────────▶ WAITING_ON_<agent>       │
         │                     │                │
         │                     ▼                │
         └──────────────▶ RESOLVED ◀────────────┘
```

- **OPEN** — blocker is active, no specific actor is awaited.
- **WAITING_ON_<agent>** — blocker is active, a specific named actor must act. `<agent>` is one of the room participant IDs.
- **RESOLVED** — terminal state; blocker is closed. RESOLVED is absorbing.

### 4.2 Legal transitions

```
OPEN                   → OPEN | WAITING_ON_<any agent> | RESOLVED
WAITING_ON_<agent>     → OPEN | WAITING_ON_<any agent> | RESOLVED
RESOLVED               → RESOLVED  (no-op; any other target is rejected)
```

Any other transition is illegal and MUST be rejected by the tool layer with `ROOM_BLOCKER_ILLEGAL_TRANSITION`.

### 4.3 Encoding

- **predicate:** `room.blocker`
- **value (string):** one of `OPEN` | `WAITING_ON_<agent>` | `RESOLVED`, where `<agent>` matches the agent-name regex.
- **reasoning:** `{ ...envelope, "blocker_id": "<stable-id>", "reason": "<short text>", "prior_state"?: "<string>", "prior_claim_id"?: "<uuid>" }`.

`blocker_id` identifies a specific blocker (a room MAY have multiple concurrent blockers). Each blocker has its own state projection independent of others.

### 4.4 State projection

The current state of a blocker is the value of the MOST-RECENT `room.blocker` claim matching the same `blocker_id` in the room's subject (by `validAt`, ties by claim-id). Implementations MUST compute projection from claims, NOT from any cached state.

### 4.5 Termination obligation

Every OPEN or WAITING_ON_<agent> blocker MUST eventually reach RESOLVED. The protocol does NOT impose a timer-based escalation (Codex's lock-in: "timer logic superseded by explicit state"). However, conformance testing MUST demonstrate that RESOLVED is reachable from every other state in finite steps for every blocker_id (no state-graph dead-ends).

---

## Part 5. Disagreement FSM

### 5.1 Disagreement predicate

- **predicate:** `room.disagreement`
- **value (string):** topic — 1-500 chars short description.
- **reasoning:** `{ ...envelope, "disagreement_id": "<stable-id>", "positions": [ { "by": "<agent>", "stance": "<text>" }, ... ] }`.

A disagreement is OPEN from the moment the first `room.disagreement` claim exists with that `disagreement_id`. It has no intermediate state.

### 5.2 Resolution

- **predicate:** `room.resolve`
- **value (string):** the winning position's `by` field (the agent whose stance won), or the literal `mutual` (if both agreed on a merged position), or `escalate:femi` (if escalated to Femi), or `withdrawn` (if both withdrew).
- **reasoning:** `{ ...envelope, "disagreement_id": "<must match an existing open disagreement>", "resolver": "<identity>", "rationale": "<text>", "merged_position"?: "<text when value=mutual>" }`.

### 5.3 Resolution rules (v2 — descriptive convention + minimal tool-layer checks)

**Conventions (not protocol-enforced in v1.0, per §2.3 descriptive-only scope):**
- `value=escalate:femi` and `value=mutual` are CONVENTIONALLY published by a current-founder, an `admin`-trust-level participant, or `femi`.
- `value=withdrawn` is CONVENTIONALLY published by a party to the disagreement (appears in `positions[].by`).

Implementations MUST display the resolver's sender + transport prominently when rendering a resolution; these convention violations are detectable via audit review, not prevented at the protocol layer. See v1.1 D-6.

**Tool-layer checks (enforced in v1.0):**
- A `room.resolve` claim is accepted ONLY IF `reasoning.disagreement_id` refers to a prior `room.disagreement` claim in the same room.
- The tool layer performs a query-before-append to surface prior `room.resolve` claims for the same `disagreement_id`; multiple resolves produce the `CONFLICTED` projected state (§5.4), not silent override.
- Unknown or missing `disagreement_id` → `ROOM_RESOLVE_NO_OPEN_DISAGREEMENT`.

**v1.0 TRUTHFUL BOUNDARY (F-LC1-003 closure — concurrent-writer resolve race).** The "no prior `room.resolve`" check is BEST-EFFORT, same TOCTOU semantics as §3.3 message idempotency:

- Two resolvers both observe OPEN at the query step.
- Both pass the tool-layer check and append `room.resolve` claims with the same `disagreement_id`.
- The resulting projection is **`CONFLICTED`** per §5.4 (two or more resolve claims) — the race is surfaced as a visible state, NOT silently collapsed by last-write-wins. (F-LC1-R2-002 closure — prior v2 draft contradicted §5.4 here.)

This is NOT Byzantine-safe single-resolver semantics. The protocol does not choose among concurrent resolvers; it records every resolve claim in the audit log and requires a renderer to surface CONFLICTED to operators for adjudication.

**Compensating controls:** audit trail preserves both `room.resolve` claims (append-only, nothing is deleted). Operational review distinguishes genuine race (two honest resolvers unaware of each other) from forgery (attacker publishing after a real resolution). Per-principal serialization is deferred to v1.1 (D-6, authenticated identity enables single-resolver locks).

Implementations MUST document this race explicitly in their tool descriptions. An implementation that claims "single resolver per disagreement" is non-conformant with this spec.

### 5.4 Projection (v2 — three-state, honest about races)

The CURRENT state of a disagreement is computed from the count of `room.resolve` claims matching the same `disagreement_id` in the same room:

- **`OPEN`** — zero matching `room.resolve` claims.
- **`RESOLVED_<winner>`** — exactly one matching `room.resolve` claim; `<winner>` is that claim's `value`.
- **`CONFLICTED`** — two or more matching `room.resolve` claims (concurrent-writer race or subsequent forgery).

Per Codex round-1 Breaker guidance: the three-state projection turns the concurrent-writer race into a VISIBLE state instead of silent last-write-wins fiction. A renderer (CLI, UI) MUST surface `CONFLICTED` explicitly, showing all resolve claims and leaving human adjudication to operational review.

**Why not last-write-wins?** v1 silently collapsed multiple resolves into the latest-by-`validAt`, which hid the race. If two resolvers both observed OPEN and both appended, one of the claims would disappear from projection, even though it remained in the audit log. That was a truthful-boundary violation. v2 surfaces the conflict as a first-class observable state.

**Resolution of a CONFLICTED state:** a CONFLICTED disagreement remains CONFLICTED until a founder (or admin-trust-level agent out of band) publishes a NEW `room.resolve` claim with `value=mutual` and `reasoning.merged_position` describing the chosen reconciliation. Even then, the projection remains CONFLICTED (now with three+ resolve claims); implementations SHOULD render the CONFLICTED state with the mutual-resolution claim highlighted as authoritative.

For strict single-resolver semantics, use authenticated-principal-based serialization — deferred to v1.1 (D-6).

---

## Part 6. Modes

### 6.1 Mode predicate

- **predicate:** `room.mode`
- **value (string):** one of `open | directed | debate | verify`.
- **reasoning:** `{ ...envelope }`. No additional fields required.

### 6.2 Mode semantics (from Parley convention + this spec)

- `open` — all members are eligible recipients of every message; no routing constraint.
- `directed` — only `@mention`-ed members are expected to reply; others observe.
- `debate` — reserved for multi-agent parallel-response deliberation (defined in LC.2 follow-on; tool layer MAY accept mode=debate but implementations MAY downgrade to `open` until Slice ≥LC.5 formalizes parallel dispatch).
- `verify` — reserved for generator/verifier sequential pattern. Same note as `debate`: provisional until formalized.

**Truthful boundary (Codex's caution 1):** `debate` and `verify` semantics are DECLARED but not fully specified in LIMEN-COORD-v1.0. Implementations SHOULD accept the mode value and route messages under `open` semantics until a follow-on amendment formalizes parallel dispatch. Producing a message under `debate`/`verify` mode does NOT guarantee any specific ordering or synthesis behavior in v1.0.

### 6.3 Mode projection

Current mode of a room = value of most-recent `room.mode` claim in the room's subject. Default = `open` if no `room.mode` claim exists.

---

## Part 7. Identity and Trust

### 7.1 Sender vs. transport

Every claim's reasoning envelope contains `sender` (self-declared) and `transport` (server-injected). ONLY `transport` is a trust anchor:

- `transport=stdio` — the MCP server process running this tool call reached us over the stdio MCP transport (typically Claude Code host process on the local machine). Trust inherits from OS-level process identity.
- `transport=http` — the MCP server received this call over HTTP (typically Codex via authenticated HTTP transport). Trust inherits from HTTP authentication (if any).
- `transport=cli` — the message was authored from the Limen CLI itself (human direct input, typically Femi). Trust inherits from OS-level shell identity.

Implementations MUST inject `transport` in the reasoning envelope at the SERVER layer, not accept it from the client. A client-supplied `transport` field in the reasoning envelope MUST be discarded and overwritten.

### 7.2 Impersonation

The `sender` field is self-declared and thus impersonable. The protocol does NOT attempt to prevent sender spoofing at the message layer. However:

- Audit trails preserve `transport` + claimed `sender` + `validAt` + `claimId` on every `room.*` claim. This provides forensic context but does NOT recover a cryptographically-bound real-actor identity under v1.0; the `transport` value is coarse (3 categories) and `sender` is self-declared. Authoritative actor recovery requires authenticated-principal binding (D-6).
- CLI UI rendering (LC.3) MUST display `transport` next to `sender` whenever they might diverge (e.g. any message where `sender != transport-canonical-name`).

### 7.3 Agent registration

Every agent that participates in a room MUST be registered in Limen via `limen_agent_register` before being added as a room participant. Registration is idempotent; re-registering an agent is a no-op.

---

## Part 8. Security

All section IDs below reference the Oracle threat model output (2026-04-18T00:32:08Z, STRIDE + NIST SP 800-53 + OWASP Top 10).

### 8.1 Spoofing (threat-001, threat-002)

- `transport`-injected identity (§7.1) is the mitigation.
- Agent authentication is inherited from Limen's existing agent registry (IA-2, IA-5).
- Session authenticity (SC-23) is enforced at the MCP transport layer; not re-implemented in this protocol.

### 8.2 Tampering (threat-003)

- Claims are append-only; no in-place mutation is possible.
- Protocol data in transit is protected by transport-layer integrity (SC-8), inherited from MCP's transport.
- Tool-layer input validation (SI-10) rejects malformed subjects, predicates, values, and reasoning payloads.

### 8.3 Repudiation (threat-004)

- Every claim is auditable via `limen_claim_query`; provenance includes `validAt`, `source_agent_id`, and the full reasoning envelope.
- Event logging (AU-2), audit protection (AU-9), and audit record generation (AU-12) are inherited from Limen's SQLite claim store.

### 8.4 Information disclosure (threat-005)

- DMs and rooms in this protocol are TRANSPARENT by design (consistent with existing a2a-chat.ts §18-19 "DMs are NOT private — any agent can query any DM subject").
- Do NOT place secrets, credentials, or PII in room messages, blocker reasons, or disagreement positions.
- Access enforcement (AC-3) is at the coarse level of "agent is registered in Limen"; there is no per-room read ACL in v1.0.

### 8.5 Denial of service (threat-006)

- Message length is capped at 2000 chars (§3.4).
- Topic length is capped at 500 chars (§5.1).
- The tool layer MUST rate-limit appends with a COARSE BEST-EFFORT key of `(transport, sender)`. v1.0 RECOMMENDS 60 appends/minute/(transport, sender) as a conservative ceiling; implementations MAY tighten.

**v1.0 TRUTHFUL BOUNDARY (F-LC1-004 closure).** Rate-limiting in v1.0 is coarse best-effort for two reasons:
1. `sender` is self-declared (§7.2) and trivially spoofable by rotating the sender string across otherwise identical claims.
2. `transport` is server-injected but has only three values (`stdio`, `http`, `cli`); all agents sharing a transport share a rate-limit bucket.

A sophisticated writer can bypass per-(transport, sender) rate-limits by rotating sender strings or by splitting traffic across transports. v1.0 rate-limiting is primarily a defense against accidental runaway writers (buggy poller, crash-loop republisher), not against adversarial flooding. An adversarial flooder will be detected via global store-size monitoring (out-of-band operational control), not prevented at the protocol level.

**Effective per-principal rate-limiting requires a server-authenticated principal key**, deferred to v1.1 as D-7. Implementations MUST NOT claim their rate-limit is adversary-proof.

### 8.6 Elevation of privilege (threat-007)

- Participant roles (§2.3) are DESCRIPTIVE in v1.0; untrusted/unregistered agents are kept out of rooms operationally (by not granting them Limen write credentials), not by tool-layer gating. Per-principal enforcement is deferred to v1.1 (D-6). (F-LC1-R2-001 closure.)
- Resolve authority (§5.3) is descriptive convention in v1.0 — founders / admin-trust-level agents / femi SHOULD be the only publishers of terminal `room.resolve` values, but the protocol does not block other publishers; CONFLICTED projection + audit review surface violations.
- Least privilege (AC-6) is operational (Limen credential gating), not protocol-enforced. Separation of duties (AC-5) and least functionality (CM-7) are signaled by the descriptive role labels.

### 8.7 Replay and idempotency

- `source_id` (§3.3) provides best-effort replay detection within a single writer.
- Concurrent-writer replay detection is NOT guaranteed (TOCTOU caveat, §3.3).
- Implementations MUST document this limitation in their tool descriptions.

---

## Part 9. CLI Integration Discipline (LC.3 binding)

### 9.1 Predicate-family exclusion

The Limen CLI's bare-recall postprocessor (`packages/limen-cli/src/commands/belief-postprocess.ts`) excludes `a2a.*` predicates from knowledge views (see FP-10 and F-BR4-007 in that file). LC.3 MUST extend this pattern:

- Add `isRoomPredicate(predicate: string): boolean` returning `true` iff the predicate matches `^room\.(message|blocker|disagreement|resolve|participant|mode)$`.
- Wire `isRoomPredicate` into the `shouldInclude` / `filterForBareRecall` code path analogously to `isA2aPredicate`.
- The filter symmetry rule from F-BR4-007 applies: if the user explicitly queries `--predicate room.*`, CLI MUST include room claims. Only bare recall excludes them.

### 9.2 Reasoning on `--predicate room.*`

When a user queries room claims via `limen recall --predicate 'room.*'`, the CLI MUST NOT strip the `reasoning` field. Room claims carry load-bearing metadata in reasoning (mentions, source_id, participant role, etc.). Stripping reasoning would silently hide protocol-level content.

### 9.3 `limen room join <room-id>` command (LC.3 scope)

This is the human-facing UI for Femi. Out of scope for the protocol itself, but the protocol binds:

- The CLI MUST call `normalize_room_id` before passing to `limen_room_*` tools.
- The CLI MUST set `transport=cli` in the reasoning envelope.
- The CLI MUST display both `sender` and `transport` fields when rendering messages (§7.2).

### 9.4 Coordination sweep expectation

Any CLI or agent workflow that starts, resumes, or hands off an implementation slice MUST do a fresh A2A sweep before continuing work. In practice, that means checking `#general`, `#engineering`, and the relevant DM thread for new actionable updates first, then proceeding only if nothing material changed.

---

## Part 10. Migration from A2A DM Threads

### 10.1 Compatibility

LIMEN-COORD-v1.0 does NOT supersede the existing `a2a.*` predicates. Both namespaces coexist. Existing DM threads (`entity:dm:<a>_<b>` with `a2a.message`) remain readable via `limen_a2a_read`.

### 10.2 Migration path for an active DM thread

To promote a DM thread to a room (v2 — aligned with LC.2 impl names):

1. Choose a room-id matching §1.2 (e.g. `artemis_slice-a1-1`; no colons).
2. Publish the founder's participant claim: `limen_room_record --room <id> --kind participant --value founder --sender <founder-name>` (the first `room.participant` claim brings the room into existence per §2.1).
3. Register each other DM participant via `limen_room_record --kind participant --value member --sender <their-name>`.
4. Optional: post a migration-anchor message: `limen_room_record --kind message --value "<anchor text>" --details-json '{"migration_from":"entity:dm:<a>_<b>"}'` to preserve provenance.
5. All subsequent messages go to the room (`limen_room_record --kind message`); the DM thread is left intact as a historical record.

(v1 of this section named placeholder tools `limen_room_create` / `limen_participant_register` — those names never existed in LC.2; the actual implementation uses `limen_room_record` + `limen_room_read`. Documented per Codex round-1 drift note.)

### 10.3 No bulk-copy

The protocol does NOT provide bulk-copy of DM messages into a room. This would break append-only semantics (double-appending the same content with different claim-ids distorts the provenance). DM threads remain the authoritative record of their own content.

---

## Part 11. Conformance Matrix

Any LIMEN-COORD-v1.0 conformant implementation MUST satisfy:

| Rule ID | Requirement | Reference |
| ------- | ----------- | --------- |
| C-1     | Reject subjects not matching `entity:room:<room-id>` with valid id | §1.1, §1.2 |
| C-2     | Reject predicates not in the `room.*` enumerated set | §1.3 |
| C-3     | Inject `transport` server-side; overwrite any client-supplied value | §1.4, §7.1 |
| C-4     | Require `source_id` on every append | §1.4, §3.3 |
| C-5     | Cap message value length at 2000 chars | §3.4 |
| C-6     | Compute blocker state via most-recent-claim projection, not cached state | §4.4 |
| C-7     | Reject illegal blocker transitions | §4.2 |
| C-8     | Reject `room.resolve` without matching open disagreement_id | §5.3 |
| C-9     | Surface participant role labels in UI; do NOT enforce as access control (descriptive-only in v1.0 per §2.3) | §2.3 |
| C-10    | Document idempotency as best-effort, not exactly-once | §3.3 |
| C-11    | Document `debate`/`verify` modes as provisional | §6.2 |
| C-12    | Rate-limit appends per-sender | §8.5 |
| C-13    | Agent must be registered in Limen before becoming participant | §7.3 |
| C-14    | CLI implementations MUST add `isRoomPredicate` analogue | §9.1 |
| C-15    | Reject room ids containing `:` (v2 bijective rule) | §1.2 |
| C-16    | Participant roles are descriptive-only; no role-based write-gating in v1.0 | §2.3 |
| C-17    | Disagreement projection uses three states (OPEN / RESOLVED_* / CONFLICTED); no silent last-write-wins | §5.4 |
| C-18    | Archive convention: role=archived SHOULD be published by a current-founder; archiving sender MUST be displayed to users for operational review | §2.1 |
| C-19    | Rate-limit key MUST be documented as `(transport, sender)` coarse best-effort | §8.5 |
| C-20    | Before starting/resuming a slice, perform an A2A sweep of `#general`, `#engineering`, and the relevant DM; pause on actionable updates | §0.5, §9.4 |

Non-conformance with any C-rule is a protocol defect, not an acceptable variance.

---

## Part 12. Test Matrix

Minimal tests any implementation MUST pass before Certifier GO:

| Test ID | Property |
| ------- | -------- |
| T-1     | Subject URN rejection: v2 — reject ANY id containing `:`; reject whitespace; reject >64 chars; reject chars outside `[a-zA-Z0-9_-]` |
| T-2     | Predicate rejection: 3-segment predicate rejected; unknown 2-segment (e.g. `room.unknown`) rejected |
| T-3     | Transport injection: client-supplied `transport` field in reasoning discarded and overwritten by server value |
| T-4     | Idempotency: same `source_id` from single writer → same claim-id returned twice (no double-append) |
| T-5     | Idempotency TOCTOU: document (not test) that concurrent writers MAY double-append |
| T-6     | Blocker projection: after sequence OPEN → WAITING_ON_x → RESOLVED, query returns RESOLVED |
| T-7     | Blocker illegal transition: RESOLVED → OPEN rejected with `ROOM_BLOCKER_ILLEGAL_TRANSITION` |
| T-8     | Disagreement resolve without open disagreement_id: rejected with `ROOM_RESOLVE_NO_OPEN_DISAGREEMENT` |
| T-9     | v2 — participant role descriptive: `observer`-labeled participant's `room.blocker` claim is ACCEPTED (no gating); audit log records it. Gating deferred to v1.1. |
| T-10    | CLI bare-recall exclusion: `limen recall` without `--predicate` excludes `room.*` claims |
| T-11    | CLI explicit include: `limen recall --predicate 'room.*'` includes them, with reasoning preserved |
| T-12    | Mode default: room with no `room.mode` claim projects as mode=open |
| T-13    | Rate limit: 61st append/min from same `(transport, sender)` bucket rejected |
| T-14    | v2 — disagreement CONFLICTED: two `room.resolve` claims with same `disagreement_id` → projection returns `CONFLICTED`, not `RESOLVED_<winner>` |
| T-15    | v2 — archive projection: any `room.participant role=archived` claim transitions projection to ARCHIVED; display MUST show archiving sender for operational review |
| T-16    | Coordination sweep: a new blocker/decision/ownership change/review request discovered at slice boundary pauses continuation until acknowledged; heartbeat-only repeats do not |

Tests MUST be runnable in CI. The LC.4 integration test is the end-to-end witness over all three participants (Femi, claude-code, codex).

---

## Part 13. Open Questions / Deferred

The following are EXPLICITLY DEFERRED to later amendments:

- **D-1:** Formal parallel-dispatch semantics for `debate` and `verify` modes.
- **D-2:** Per-room read ACLs (v1.0 is transparent by design).
- **D-3:** Cross-room message references / threading beyond `in_reply_to` within a single room.
- **D-4:** Bulk-copy migration from A2A DMs to rooms.
- **D-5:** Participant-role change history UI.
- **D-6:** Server-authenticated principal at the MCP transport layer + per-principal role bindings + cryptographic claim signing. v1.0 consequence: participant roles are descriptive only (§2.3); `room.resolve` authority is declarative not enforced (§5.3); concurrent-writer races are surfaced as `CONFLICTED` but not prevented (§5.4). Source: F-LC1-002.
- **D-7:** Per-authenticated-principal rate-limit. v1.0 consequence: rate-limit key is coarse `(transport, sender)` best-effort; sophisticated writers can bypass via sender rotation (§8.5). Source: F-LC1-004.

Each deferred item is its own future-slice trigger and does not block v1.0 ratification.

---

## Part 14. Glossary

| Term | Definition |
| ---- | ---------- |
| **Room** | A multi-participant coordination surface identified by an `entity:room:<room-id>` URN. |
| **Participant** | An agent or human with a registered role in a specific room. |
| **Claim** | An immutable append-only Limen record. See Limen CCP (Claim-Centric Protocol). |
| **Subject** | The URN a claim is about (`entity:<type>:<id>`). |
| **Predicate** | The 2-segment `<domain>.<property>` key of a claim. |
| **Reasoning** | The JSON metadata envelope of a claim. |
| **source_id** | Caller-supplied idempotency key on appends. |
| **Transport** | Server-injected identity of the connection through which a claim was authored. |
| **Blocker** | A named unit of coordination friction with an FSM state (§4). |
| **Projection** | The operation of computing current state from the most-recent relevant claim. |
| **LC.1/LC.2/LC.3/LC.4** | The four slices of the LIMEN-COORD-v1.0 program. |

---

## Part 15. Signatures

- **Builder (LC.1):** claude-code — 2026-04-18
- **Breaker (LC.1):** codex — PENDING
- **Certifier:** — PENDING
- **Witness (ignorance-test):** Femi — PENDING
- **Ratifying Authority:** Femi — PENDING

All signatures are captured as Limen claims with subject `entity:program:limen-coord-v1-0` and predicates `ratify.builder`, `ratify.breaker`, `ratify.certifier`, `ratify.witness`, `ratify.authority` respectively, with value = signatory identity and reasoning containing `{ "signed_at": "<ISO>", "artifact_sha256": "<hash of this document>" }`.

---

*End of COORDINATION-PROTOCOL-v1.0 — DRAFT v1 — BREAKER-REVIEW-PENDING.*
