# LC.2 Breaker Report — Round 1

**Program:** LIMEN-COORD-v1.0
**Slice:** LC.2 (of LC.1 / LC.2 / LC.3 / LC.4)
**Builder (LC.2):** codex
**Breaker (LC.2):** claude-code
**Date:** 2026-04-18
**Artifact under attack:** `packages/limen-mcp/src/tools/room-coordination.ts`
**Reference spec:** `docs/process/COORDINATION-PROTOCOL-v1.0.md` (v2, POST-BREAKER-1)
**Builder's claim:** "11/11 tests PASS — LC.2 ready for Breaker pass."

## Header

| Field                        | Value                                |
| ---------------------------- | ------------------------------------ |
| Codex's test count (claimed) | 11                                   |
| Tests verified PASS          | 11/11 (cosmetic pass — see below)    |
| Findings total               | **28**                               |
| CRITICAL                     | **5**                                |
| HIGH                         | **11**                               |
| MEDIUM                       | **9**                                |
| LOW                          | **3**                                |
| Conformance matrix pass      | 5 / 19 C-rules (26%)                 |
| Test matrix coverage         | ~2 / 15 T-rules (13%)                |
| Verdict                      | **NO-GO — LC.2 fails LC.4 blockers** |

**Headline:** the LC.2 impl covers approximately **33% of the protocol surface** (message + participant + blocker-as-string + disagreement-as-string). It **cannot record `room.resolve` or `room.mode` claims at all** — the two predicates are missing from the `RoomEventKind` union, so the tool layer silently fails when invoked with those kinds (a UUID is returned, but the claim is unreadable). All five FSM/validation obligations in the spec are missing: blocker transitions, disagreement resolve linkage, CONFLICTED projection, participant role enumeration, mode enumeration. The tool layer is effectively a thin wrapper around `limen.remember` with no domain checks. Zero-Residual Law blocks LC.4 on these findings.

---

## Test Suite Confirmation

Codex's test suite **runs green (11/11 PASS)** — confirmed:

```
▶ room coordination helpers (3 tests pass)
▶ room coordination record/read (6 tests pass)
▶ room coordination MCP handlers (2 tests pass)
✔ 11 tests, 0 fail, duration 1.3s
```

But this is a **cosmetic pass**. The test suite does not exercise:
- Any FSM transition (OPEN→WAITING_ON→RESOLVED path, or illegal RESOLVED→OPEN)
- `resolve` or `mode` predicate kinds at all (because they don't exist in the impl)
- Participant role enumeration
- Message/topic length boundaries at the direct function layer (Zod on MCP boundary only)
- Transport client-supplied-field overwrite (C-3)
- Source-id-mandatory rule (§1.4)
- Rate-limit behavior (§8.5/C-12)
- CONFLICTED projection (§5.4/C-17)
- The test literally states in its title: `"records structured room events without inventing a fixed FSM"` — a direct admission that the spec-required FSM is absent.

Test coverage against the spec's Part 12 T-matrix: **2/15 = 13%**. See §5 below for gap analysis.

---

## Findings

### F-LC2-001 — CRITICAL — `resolve` predicate unimplementable

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:7-11, 45-50, 308, 322`

**Spec obligation:** §1.3 mandates the enumerated set `room.message | room.blocker | room.disagreement | room.resolve | room.participant | room.mode`. Part 5 (Disagreement FSM) and conformance rules C-8, C-17 hinge on `room.resolve` being writable.

**Code:**
```ts
// line 7
export type RoomEventKind =
  | 'message'
  | 'participant'
  | 'blocker'
  | 'disagreement';   // resolve and mode are MISSING

// line 45
const ROOM_PREDICATE_BY_KIND: Record<RoomEventKind, string> = {
  message: 'room.message',
  participant: 'room.participant',
  blocker: 'room.blocker',
  disagreement: 'room.disagreement',
};   // no 'resolve', no 'mode' entry

// line 308 (Zod enum)
kind: z.enum(['message', 'participant', 'blocker', 'disagreement'])
// line 322
kind: z.enum(['message', 'participant', 'blocker', 'disagreement']).optional()
```

**Repro:**
```ts
// @ts-expect-error - kind not in RoomEventKind
roomPredicate('resolve')  // => undefined
```

At the MCP boundary the Zod enum rejects `kind="resolve"`. At the direct-function-call layer (used by tests, internal integrations, future LC.3/LC.4 code), `roomPredicate('resolve')` returns `undefined`. `recordRoomEvent` then calls `limen.remember(subject, undefined, value, …)`. The engine's `isValidPredicate(undefined)` at `src/claims/store/claim_stores.ts:167` returns false — and yet the engine **returns `ok: true` with a claim-id** (separate Limen engine anomaly, but observable here: I ran `limen.remember('entity:room:q', undefined, 'mutual', {...})` directly and got `{"ok":true,"value":{"claimId":"…","confidence":0.7}}`). `recordRoomEvent` then returns `recorded: true, predicate: undefined` to the caller. The claim is **not findable** via `limen.recall('entity:room:q', 'room.*')` — count=0. Silently lost write, but caller believes it succeeded.

**Impact:** Disagreement resolution (Part 5) is unimplementable. C-8 (reject resolve without open disagreement), C-17 (three-state projection including CONFLICTED), T-8, T-14 — all unreachable. The rest of the spec refers repeatedly to `room.resolve`; LC.3/LC.4 cannot proceed.

**Proposed remediation:**
1. Add `'resolve'` and `'mode'` to `RoomEventKind` and to `ROOM_PREDICATE_BY_KIND`.
2. Extend both Zod enums.
3. Introduce a per-kind validator dispatch table.
4. For `resolve`: implement §5.3 tool-layer checks (disagreement_id references prior `room.disagreement`; query-before-append for prior resolve; surface `CONFLICTED` per §5.4).

---

### F-LC2-002 — CRITICAL — `mode` predicate unimplementable

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:7-11, 45-50`

**Spec obligation:** §1.3, Part 6 (Modes). Mode values `open | directed | debate | verify` per §6.1. Mode default `open` per §6.3.

**Code:** same structure as F-LC2-001. `'mode'` is absent from `RoomEventKind` and `ROOM_PREDICATE_BY_KIND`.

**Repro:**
```ts
roomPredicate('mode')  // => undefined
// Direct call: @ts-expect-error recordRoomEvent(limen, {kind:'mode', value:'open', ...}, 'http')
// Returns {recorded:true, claimId:"…"} but nothing persisted under room.* subject.
```

**Impact:** Part 6 is dead code-wise. T-12 (mode default open) cannot be written. The room mode concept — which sets semantics for `debate`/`verify` routing — is a no-op in LC.2.

**Proposed remediation:** as F-LC2-001. Additionally, validate `value ∈ {open, directed, debate, verify}` at tool layer; document `debate`/`verify` as provisional per §6.2 in the tool description.

---

### F-LC2-003 — CRITICAL — Blocker FSM entirely unenforced (C-7 violation)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:138-236` (no FSM logic anywhere)

**Spec obligation:** §4.2 legal transitions; §4.4 state projection; C-7 "reject illegal blocker transitions"; T-7 `ROOM_BLOCKER_ILLEGAL_TRANSITION` error code.

**Code:** the entire `recordRoomEvent` body contains **zero** references to "blocker", "OPEN", "RESOLVED", "WAITING_ON", "blocker_id", "prior_state", "transition". `value` is passed through as an opaque string with only `Zod.min(1).max(2000)` as a gate at MCP boundary.

**Repro:**
```ts
// 1. Accept arbitrary blocker values
recordRoomEvent(limen, {
  room: 'testroom', sender: 'x', kind: 'blocker',
  value: 'MALFORMED_GARBAGE_NOT_A_VALID_STATE',
}, 'http');
// => { recorded: true, predicate: 'room.blocker', claimId: '…' }   NO ROOM_BLOCKER_INVALID_VALUE

// 2. Accept illegal RESOLVED -> OPEN transition
recordRoomEvent(limen, {
  room: 'tr', sender: 'x', kind: 'blocker', value: 'RESOLVED',
  detailsJson: JSON.stringify({ blocker_id: 'b1' }),
}, 'http');  // initial RESOLVED
recordRoomEvent(limen, {
  room: 'tr', sender: 'x', kind: 'blocker', value: 'OPEN',  // §4.2: RESOLVED is absorbing
  detailsJson: JSON.stringify({ blocker_id: 'b1' }),
}, 'http');
// => { recorded: true }   NO ROOM_BLOCKER_ILLEGAL_TRANSITION
```

Both scenarios are accepted. The blocker projection (§4.4) would now report `OPEN` after a prior `RESOLVED` — a spec-explicit impossible state.

**Impact:** §4.2 RESOLVED-is-absorbing is irrecoverable. Callers cannot trust blocker state. Any scheduler or UI that consumes the blocker projection will observe undefined-behaviour state oscillations. This is the canonical FSM-escape defect.

**Proposed remediation:**
1. Validate `value` matches `^(OPEN|WAITING_ON_[a-zA-Z0-9_-]{1,64}|RESOLVED)$`.
2. Require `blocker_id` in `detailsJson` / reasoning for `kind=blocker`.
3. Before appending, project prior state via most-recent-claim (§4.4) and reject illegal transitions with error code `ROOM_BLOCKER_ILLEGAL_TRANSITION`.
4. Concurrent-writer race: same TOCTOU caveat as §3.3 — document, surface conflict.

---

### F-LC2-004 — CRITICAL — `source_id` not mandatory (§1.4 violation; F-LC2-005 chain)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:27, 170, 312`

**Spec obligation:** §1.4 — `source_id` is listed as **mandatory** ("source_id is mandatory for idempotency enforcement (see §4.3)"). §3.3 refactors idempotency around source_id-matched query-before-append.

**Code:**
```ts
// line 27
interface RoomRecordArgs {
  readonly sourceId?: string;   // OPTIONAL
}

// line 170
if (args.sourceId) {          // only dedupes if caller supplies
  const duplicate = findExistingBySourceId(...);
  if (duplicate !== null) { return … deduped … }
}
// Otherwise: straight append, NO idempotency.

// line 312 Zod
sourceId: z.string().max(128).optional()
```

**Repro:**
```ts
// Without sourceId, duplicates are persisted
recordRoomEvent(limen, {room:'tr', sender:'x', kind:'message', value:'dup'}, 'http');
recordRoomEvent(limen, {room:'tr', sender:'x', kind:'message', value:'dup'}, 'http');
readRoomEvents(limen, {room:'tr'}).count  // => 2   (spec wanted 1)
```

**Impact:** §3.3 idempotency guarantee (single-writer exactly-once) requires source_id. With source_id optional and most callers likely to omit it, "best-effort idempotency" degrades to "no idempotency". C-4 "Require `source_id` on every append" is explicitly violated. T-4 passes only because the one test that sets source_id produces dedup; a test omitting source_id would produce duplicates.

**Proposed remediation:** make `sourceId` required in both `RoomRecordArgs` and the Zod schema. Caller MUST supply. If caller cannot generate an id, tool layer auto-generates a UUID4 and returns it so the caller can retry with the same value. Update §1.4 tool description accordingly.

---

### F-LC2-005 — CRITICAL — Lost-write ambiguity: caller receives `recorded:true` for writes that are unreadable

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:208-235`

**Evidence chain:** F-LC2-001 / F-LC2-002 demonstrate that `remember(subject, undefined, …)` returns `ok:true` with a claimId while persisting a claim that is unreadable via `limen.recall('entity:room:*', 'room.*')`. LC.2's `recordRoomEvent` does not check that the predicate resolved to a truthy string before handing to `remember`, and does not read-verify after write.

**Code:**
```ts
// line 168
const predicate = roomPredicate(args.kind);    // MAY BE undefined

// lines 208-216 — no validation of `predicate` before calling remember
const result = safeCall<RememberResult>(() => limen.remember(
  subject,
  predicate,           // <- undefined goes in
  args.value,
  { confidence: 1.0, reasoning },
));

if (!result.ok) { return mcpError(...); }
// line 222 — returns recorded:true regardless of whether predicate was undefined
return { content: [{ type:'text', text: JSON.stringify({ recorded: true, ... }) }] };
```

**Repro:** the `kind:'resolve'` direct call at F-LC2-001 produces `recorded:true, claimId:"…"` but `limen.recall('entity:room:z', 'room.*')` returns count=0. Consumer assumes success; state is invisible.

**Impact:** silent data loss. Any orchestrator built on top of LC.2 that checks "did the record succeed" will operate on a false-positive success signal. Combined with F-LC2-001/002 this means orchestration logic assumes a resolve or a mode claim landed when it did not. Under Zero-Residual, this is terminal.

**Proposed remediation:**
1. Guard: `if (predicate === undefined) return mcpError('ROOM_UNKNOWN_KIND', ...)`.
2. Separately, file an engine-side bug (or confirm existing) that `limen.remember` with an undefined predicate returns `ok:true` — this is a Limen-core defect deserving its own report and is out of LC.2 scope but LC.2 MUST guard defensively.

---

### F-LC2-006 — HIGH — Disagreement resolve has no `disagreement_id` linkage (C-8 violation)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts` (resolve unimplemented, so no linkage check)

**Spec obligation:** §5.3: "A `room.resolve` claim is accepted ONLY IF `reasoning.disagreement_id` refers to a prior `room.disagreement` claim in the same room." Error code: `ROOM_RESOLVE_NO_OPEN_DISAGREEMENT`. C-8.

**Code:** absent — chained to F-LC2-001.

**Impact:** even if `resolve` is added to RoomEventKind, the linkage enforcement is missing. Without it, an attacker can publish `room.resolve` claims for nonexistent disagreements, polluting the audit log.

**Proposed remediation:** when `kind==='resolve'`, require `disagreement_id` in `detailsJson`; query `room.disagreement` claims for the same subject; reject if no match with `ROOM_RESOLVE_NO_OPEN_DISAGREEMENT`.

---

### F-LC2-007 — HIGH — CONFLICTED projection absent (C-17 violation)

**File:** absent — chained to F-LC2-001/006

**Spec obligation:** §5.4 three-state projection `OPEN | RESOLVED_<winner> | CONFLICTED`. C-17 "disagreement projection uses three states; no silent last-write-wins."

**Impact:** LC.2 exposes no projection primitive at all — callers have to compute state themselves from raw `room.*` claims. That means every consumer (LC.3, LC.4) re-implements projection, and the protocol's §5.4 guarantee of surfacing `CONFLICTED` depends on every downstream doing this consistently. This is a systemic correctness risk; the contract is ungrounded.

**Proposed remediation:** expose `readRoomState(room)` or `projectDisagreement(room, disagreement_id)` in LC.2 that returns `{state: 'OPEN' | 'RESOLVED_<winner>' | 'CONFLICTED', claims: […]}`. Without this, LC.3 UIs will disagree about room state. Alternatively, keep projection as a documented LC.3 responsibility but at minimum ensure the raw claims are retrievable via `readRoomEvents` (which they currently are for recorded kinds — but not for resolve, per F-LC2-001).

---

### F-LC2-008 — HIGH — Participant role enumeration not validated (§2.3, C-9/C-16 partial)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:138-236`

**Spec obligation:** §2.3 enumerates `founder | member | observer | removed | archived`. C-9: "Surface participant role labels in UI; do NOT enforce as access control (descriptive-only in v1.0 per §2.3)". C-16: descriptive-only, no gating.

**Nuance:** v2 §2.3 explicitly says participant roles are DESCRIPTIVE and v1.0 does NOT protocol-enforce them as access controls. So "role enforcement" is intentionally absent. BUT — the role *value-set* is still an enumeration. Accepting `value: 'GOD-EMPEROR'` for `kind: participant` means the audit-trail label cannot be trusted by UI projections ("is this participant a founder?" becomes "does this string equal `founder`?" which is brittle).

**Repro:**
```ts
recordRoomEvent(limen, {
  room:'tr', sender:'x', kind:'participant', value:'GOD-EMPEROR',
}, 'http');
// => { recorded: true, predicate: 'room.participant' }   accepts arbitrary strings
```

**Impact:** the projection rule "role = value of most-recent `room.participant` claim" (§2.3) depends on values being drawn from the enumeration. Arbitrary strings break projection. UI renderers will either silently coerce to `unknown` or crash.

**Proposed remediation:** validate `value ∈ {founder, member, observer, removed, archived}` for `kind=participant` at tool layer. Error code: `ROOM_PARTICIPANT_INVALID_ROLE`. This is VALUE validation, not AUTHORITY validation — consistent with v2's descriptive-only scope (any participant can PUBLISH any role for themselves/others, but the label must be from the enumerated set so readers know what it means).

---

### F-LC2-009 — HIGH — Transport is never overwritten (C-3 violation, latent)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:138-142, 189-200`

**Spec obligation:** §7.1 / C-3: "Implementations MUST inject `transport` in the reasoning envelope at the SERVER layer, not accept it from the client. A client-supplied `transport` field in the reasoning envelope MUST be discarded and overwritten."

**Analysis:** `recordRoomEvent` takes `transport` as a function parameter, not a field of `args`. The `metadata` object is built server-side and sets `transport` from that parameter. So far, so good.

**BUT** — the client can inject a `transport` field via `detailsJson`. That field lands inside `metadata.details`. On read, `readRoomEvents` surfaces it inside the event's `details` subtree. A naive UI that reads `event.details.transport` before `event.transport` will display the spoofed value.

**Repro:**
```ts
recordRoomEvent(limen, {
  room:'tr', sender:'x', kind:'message', value:'hi',
  detailsJson: JSON.stringify({ transport: 'cli' }),  // attacker claim
}, 'http');

readRoomEvents(limen, {room:'tr'}).events[0]
// =>
// {
//   transport: 'http',           // TRUE server-injected
//   details: { transport: 'cli' }   // ATTACKER-INJECTED, never discarded
// }
```

**Impact:** violates the "tamper-proof identity anchor" promise of §1.4 bullet 4 and §7.1. Any downstream consumer (CLI renderer, audit query, future governance rule) that inspects `details` trusting the envelope will be mislead. Also violates C-3 literally: "a client-supplied `transport` field" is not discarded — it is preserved in a nested sibling.

**Proposed remediation:** before building `metadata`, strip `transport`, `sender`, `timestamp`, `schema_version`, `source_id`, and `kind` keys from `details` (any reserved-envelope field). Error OR silently scrub. Decision: scrubbing is sufficient because the server-injected envelope already holds truth at the top level; render strict priority (`event.transport` > `event.details.transport` — but that's an LC.3 concern). At LC.2: refuse details containing reserved keys with `ROOM_DETAILS_RESERVED_KEY`.

---

### F-LC2-010 — HIGH — No rate limiting at tool layer (§8.5, C-12, T-13 violation)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts` (none)

**Spec obligation:** §8.5 / C-12 / T-13: "The tool layer MUST rate-limit appends with a COARSE BEST-EFFORT key of `(transport, sender)`. v1.0 RECOMMENDS 60 appends/minute/(transport, sender)." T-13: 61st append in the same minute rejected.

**Code:** zero rate-limiter logic. A global engine-level rate limiter does fire (observed `ENGINE_UNHEALTHY: Request rate limit exceeded` at ~24 appends), but:
1. That bucket is global across ALL Limen calls (not LC.2-scoped).
2. It is not keyed by `(transport, sender)` as spec mandates.
3. The error code `ENGINE_UNHEALTHY` is not the spec-implied `ROOM_RATE_LIMIT_EXCEEDED`.
4. It conflates engine-internal health signals with a tool-layer rate decision.

**Repro:**
```ts
for (let i = 0; i < 100; i++) {
  recordRoomEvent(limen, {
    room:'tr', sender:'floodbot', kind:'message', value:`msg ${i}`,
  }, 'http');
}
// With a fresh engine, ~24 appends succeed before engine-level limiter fires.
// Spec wants 60/(transport,sender)/minute, not 24/global/second.
```

**Impact:** C-12 unmet. T-13 not testable. Sophisticated writers can already bypass (§8.5 acknowledges this), but even the coarse best-effort floor is absent.

**Proposed remediation:** add a per-`(transport, sender)` sliding-window counter (60/min) at the start of `recordRoomEvent`. Error code `ROOM_RATE_LIMIT_EXCEEDED`. Document in tool description per C-19.

---

### F-LC2-011 — HIGH — Message length not enforced at direct-call boundary (§3.4, C-5)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:138-236, 309`

**Spec obligation:** §3.4: "Messages longer than 2000 chars MUST be rejected at the tool layer with error code `ROOM_MESSAGE_TOO_LONG`." C-5.

**Code:** the 2000-char cap exists ONLY on the Zod schema (line 309 `z.string().min(1).max(2000)`). `recordRoomEvent` itself has no length check. Callers that use `recordRoomEvent` directly (tests, internal integration code, future LC.3/LC.4 server-side paths) bypass Zod.

**Repro:**
```ts
recordRoomEvent(limen, {
  room:'tr', sender:'x', kind:'message', value: 'x'.repeat(3000),
}, 'http');
// => { recorded: true }   3000-char message stored
```

**Impact:** C-5 violated on direct-call path. Any integration test or internal adapter that builds on `recordRoomEvent` will store overlong messages. Also: error code mismatch — spec says `ROOM_MESSAGE_TOO_LONG`, impl has no such error path.

**Proposed remediation:** move the length check into `recordRoomEvent`:
```ts
if (args.kind === 'message' && args.value.length > 2000) {
  return mcpError('ROOM_MESSAGE_TOO_LONG', 'Message value exceeds 2000 chars');
}
```

---

### F-LC2-012 — HIGH — Disagreement topic length not enforced (§5.1)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:309`

**Spec obligation:** §5.1: "value (string): topic — 1-500 chars short description."

**Code:** Zod max(2000) applies to ALL kinds uniformly, including `disagreement`. No per-kind length policy.

**Repro:**
```ts
recordRoomEvent(limen, {
  room:'tr', sender:'x', kind:'disagreement', value:'x'.repeat(1500),
}, 'http');
// => recorded: true   1500 > 500 (§5.1 cap)
```

**Impact:** §5.1 500-char ceiling missing. Spec violation.

**Proposed remediation:** per-kind value-length matrix:
| kind          | max      |
| ------------- | -------- |
| message       | 2000     |
| blocker       | 64 + prefix (OPEN / WAITING_ON_* / RESOLVED) |
| disagreement  | 500      |
| participant   | 16 (one of enum values) |
| resolve       | 256 (handles `escalate:<agent>`) |
| mode          | 16 (one of enum values) |

---

### F-LC2-013 — HIGH — Agent-registered precondition not checked (C-13, §7.3 violation)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:143-145`

**Spec obligation:** §7.3 / C-13: "Every agent that participates in a room MUST be registered in Limen via `limen_agent_register` before being added as a room participant."

**Code:**
```ts
if (!isValidAgentName(args.sender)) {
  return mcpError('ROOM_INVALID_SENDER', ...);
}
// No check that `sender` is registered in Limen's agent store.
```

**Repro:** any name passing `^[a-zA-Z0-9_-]{1,64}$` is accepted — `sender: "nonexistent-ghost-agent"` records fine.

**Impact:** C-13 unmet. Untraceable senders pollute the audit log. While v2 §7.2 acknowledges sender is self-declared and not strongly authenticated, §7.3 still requires registration — the weakest form of sender provenance. Without it, `limen_agent_presence` and audit queries can't cross-reference.

**Proposed remediation:** at start of `recordRoomEvent`, consult `limen.agents.get(args.sender)` (or equivalent) and reject with `ROOM_SENDER_NOT_REGISTERED` if absent. Cache the result for performance. Alternatively, document exception: if auto-registration is preferred, call `limen_agent_register` idempotently with `trust=untrusted` — but that's a behavioural decision requiring spec update.

---

### F-LC2-014 — HIGH — Ordering by self-declared `metadata.timestamp` not spec-required `validAt` (§3.2 violation)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:271, 281`

**Spec obligation:** §3.2: "Messages in a room are ordered by `validAt` ascending, ties broken by monotonically-increasing `claim-id`. Implementations MUST NOT assume wall-clock monotonicity across different senders; use Limen's `validAt` as authoritative."

**Code:**
```ts
// line 271 — timestamp falls back to validAt but picks self-declared first
timestamp: metadata?.timestamp ?? belief.validAt,

// line 281 — sort by self-declared timestamp
.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
```

The sort key is `metadata.timestamp`, which is set by `recordRoomEvent` at line 191 as `new Date().toISOString()` — server wall-clock at APPEND time. That is NOT the same as Limen's `validAt` (claim store canonical time). For co-located stdio calls these are near-identical, but:
1. If a future code path allows a caller to supply a back-dated timestamp via `detailsJson.timestamp` — oh wait, that ends up in `details`, not `metadata.timestamp`. OK.
2. Clock skew between server nodes (future multi-process Limen) will cause out-of-order rendering.
3. `validAt` is strictly monotonic-per-mission/session in Limen; `Date.now()` can go backwards on NTP adjust.
4. Spec's tie-breaker "monotonically-increasing claim-id" is not implemented — pure string sort on timestamp means ties (same wall-clock ms) break in JS-stable-sort order (input order).

**Repro:** under clock skew, or on a slow machine where two appends land at the same ms, ordering is indeterminate. On fast test machines not reproducible; on production hardware will observed.

**Impact:** §3.2 contract broken. C-6 rule for blockers ("Compute blocker state via most-recent-claim projection") is indirectly affected: "most recent" is defined by `validAt` but the read-side sort uses `metadata.timestamp`.

**Proposed remediation:**
```ts
timestamp: belief.validAt,
// Secondary sort by claimId for ties:
.sort((a, b) => {
  const cmp = a.validAt.localeCompare(b.validAt);
  return cmp !== 0 ? cmp : a.claimId.localeCompare(b.claimId);
});
```
Keep `metadata.timestamp` as an informational "sender wall-clock" field, clearly labelled.

---

### F-LC2-015 — HIGH — Metadata envelope missing mandatory `schema_version` (§1.4 violation)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:189-199`

**Spec obligation:** §1.4 "Reasoning envelope: `schema_version`, `sender`, `timestamp`, `transport`, `source_id`, …". "`schema_version` is mandatory. `coord-v1.0` is the only currently valid value."

**Code:**
```ts
const metadata = {
  sender: args.sender,
  timestamp: new Date().toISOString(),
  transport,
  room: args.room,
  normalizedRoomId,
  kind: args.kind,
  ...(args.sourceId ? { sourceId: args.sourceId } : {}),
  ...(mentions.length > 0 ? { mentions } : {}),
  ...(details !== undefined ? { details } : {}),
};
// No schema_version: 'coord-v1.0'
```

**Repro:**
```
metadata keys: [ sender, timestamp, transport, room, normalizedRoomId, kind ]
schema_version present? false
```

**Impact:** forward compatibility broken. When v1.1 lands, consumers have no way to distinguish v1.0 envelopes from v1.1 envelopes. Parley's separate impl has nothing to negotiate against. Audit consumers cannot gate on version.

**Proposed remediation:** hard-code `schema_version: 'coord-v1.0'` as the first field of `metadata`. Add a constant `const COORD_SCHEMA_VERSION = 'coord-v1.0';`.

---

### F-LC2-016 — HIGH — Field naming drift: camelCase vs spec snake_case (§1.4 violation)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:189-199`

**Spec obligation:** §1.4 envelope spells fields `source_id`, `human_room_id` (snake_case JSON). Impl uses `sourceId`, `normalizedRoomId` (camelCase).

**Code:**
```ts
...(args.sourceId ? { sourceId: args.sourceId } : {}),   // spec: source_id
normalizedRoomId,                                         // spec: human_room_id
```

**Impact:** Parley's separate TypeScript impl will observe a different on-wire shape. This is exactly the kind of cross-implementation drift §0.1 forbids: "Drift between implementations is a protocol defect, not an acceptable divergence." Consumers written to spec (looking for `source_id`) will not find it.

**Proposed remediation:** change field names:
- `sourceId` → `source_id`
- `normalizedRoomId` → drop (redundant in v2 bijective scheme; `room` is authoritative)
- If we keep a display-alias: `human_room_id` (matches spec verbatim)

Update tests and LC.3 / parley consumers.

---

### F-LC2-017 — MEDIUM — Read default limit 50 silently truncates (no `truncated` flag)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:256, 286-293`

**Spec obligation:** §1.3 rationale claims "Single wildcard (`room.*`) retrieves the full state of a room in one `limen.recall` call." Implicit: reads should be complete or flag incompleteness.

**Code:**
```ts
const limit = args.limit ?? 50;
// ... later ...
text: JSON.stringify({
  room, normalizedRoomId, subject,
  count: events.length,                // count = returned, NOT stored
  events,
}),
```

**Repro:** 75 messages in a room, `readRoomEvents(limen, {room})` returns 50 silently. No `truncated`, no `hasMore`, no `nextOffset`. Consumer believes they have full state.

**Impact:** Room with ≥51 messages will be silently misread. Any projection ("most recent blocker state") is correct because of ordering, but state derived from "all messages" is stale.

**Proposed remediation:**
1. Raise default limit to `args.limit ?? 200` (match `findExistingBySourceId`).
2. If `events.length === limit`, set `truncated: true, hasMore: true` in the response. Document pagination via explicit `limit`.
3. Consider exposing an `offset` or continuation token. Or, document that full-state recall requires caller to page until `events.length < limit`.

---

### F-LC2-018 — MEDIUM — Idempotency window hardcoded to 200 (overflow bypass)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:129`

**Spec obligation:** §3.3 "best-effort query-before-append on source_id"; the spec does not bound the query window, but implies robust single-writer idempotency.

**Code:**
```ts
const existing = safeCall<readonly BeliefView[]>(() => limen.recall(subject, predicate, { limit: 200 }));
```

**Impact:** any room with more than 200 claims of the same predicate family will silently fail idempotency checks. A legitimate single writer retrying an event that happened 201 claims ago will see `deduped:false` and double-append. "Single-writer idempotency is guaranteed" (§3.3) becomes false once the room heats up.

**Proposed remediation:**
1. Use Limen's native source-id index if available (preferred), or
2. Query with much larger limit (e.g. 10,000) and cap with a documented max, or
3. Expose a dedicated idempotency table keyed by `(subject, predicate, source_id)` — trades storage for correctness.

Document the actual window in the tool description per spec C-10 truthfulness obligation.

---

### F-LC2-019 — MEDIUM — Reasoning-length cap 1000 undocumented in spec (silent budget)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:43, 201-206`

**Spec obligation:** §1.4 defines the envelope shape but does not state a reasoning length cap. Engine-level `CONV_REASONING_TOO_LONG` is defined elsewhere but at a different size (looks like `MAX_REASONING_LENGTH`).

**Code:**
```ts
const MAX_REASONING_LENGTH = 1000;
...
if (reasoning.length > MAX_REASONING_LENGTH) {
  return mcpError('ROOM_METADATA_TOO_LARGE', `Metadata exceeds maximum reasoning length of ${MAX_REASONING_LENGTH} characters`);
}
```

**Repro:** a `detailsJson` of 1500 chars (allowed by Zod `max(2000)`) blows the 1000-char envelope budget:
```
{ error: 'ROOM_METADATA_TOO_LARGE', message: 'Metadata exceeds maximum reasoning length of 1000 characters' }
```

**Impact:** mismatch between Zod's `detailsJson.max(2000)` (tool input gate) and `MAX_REASONING_LENGTH=1000` (internal budget). A caller who respects tool-input constraints hits an internal server error. Undocumented.

**Proposed remediation:** either:
1. Lower Zod's `detailsJson` cap to a value that cannot blow the envelope (e.g. `max(800)`), or
2. Raise `MAX_REASONING_LENGTH` to accommodate 2000-char message + full envelope (~2300 chars), or
3. Document the envelope budget in spec §1.4 and align all caps.

---

### F-LC2-020 — MEDIUM — `TransportOrigin` type omits `cli` (§7.1 violation)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:5`

**Spec obligation:** §7.1: "`transport=cli` — the message was authored from the Limen CLI itself (human direct input, typically Femi)." Spec defines three transports.

**Code:**
```ts
export type TransportOrigin = 'stdio' | 'http';   // missing 'cli'
```

**Impact:** when LC.3 (CLI) calls `recordRoomEvent` from a CLI context, it cannot cleanly pass `transport='cli'`. Direct-call works at runtime (JS is lax), but the type system rejects it. Future strict consumers (Parley) cannot express the third transport cleanly.

**Repro:** `recordRoomEvent(limen, {...}, 'cli')` produces a TS error. At runtime: accepted, persists `transport: 'cli'` in envelope — so semantic correctness is preserved, but contract types lie.

**Proposed remediation:**
```ts
export type TransportOrigin = 'stdio' | 'http' | 'cli';
```

---

### F-LC2-021 — MEDIUM — Reserved-namespace gap for `details` keys

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:189-199`

**Spec obligation:** §7.1 mandates transport overwrite. By extension, server-injected envelope fields (`sender`, `timestamp`, `transport`, `schema_version`, `source_id`, `kind`, `room`, `normalizedRoomId`) should not be shadowed by caller input.

**Analysis:** `details` is caller-controlled JSON. Nothing prevents the caller from embedding `{sender: 'femi', transport: 'cli'}` inside `details`. The top-level envelope fields are correct (server-injected), but `details` carries a parallel set of spoofed fields. Naive consumers may read from `details`. (See F-LC2-009 for transport specifically.)

**Proposed remediation:** before assigning `details` into metadata, strip reserved keys or refuse with `ROOM_DETAILS_RESERVED_KEY`. Recommend strip-then-warn for forward compatibility.

---

### F-LC2-022 — MEDIUM — Concurrent-writer resolve race not surfaceable (C-17 gap)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts` (resolve unimplemented)

**Spec obligation:** §5.3 "query-before-append for prior resolve; surface CONFLICTED per §5.4". §5.4 three-state projection.

**Impact:** chained to F-LC2-001. Once resolve is implemented, the race detection (two concurrent resolves → CONFLICTED) must be provided. Current impl has no projection primitive, so even if resolve kind is added, CONFLICTED can only be observed by downstream consumers if LC.2 exposes a projection.

**Proposed remediation:** with F-LC2-007, expose `projectDisagreement(room, disagreement_id): {state, claims}`.

---

### F-LC2-023 — MEDIUM — No blocker-id validation

**File:** absent

**Spec obligation:** §4.3: `reasoning.blocker_id` is REQUIRED for kind=blocker (§4.4: projection keys by blocker_id).

**Impact:** current impl lets callers create blocker claims without a `blocker_id`, meaning projection cannot distinguish concurrent blockers. Same class of fault as F-LC2-003 but on a different field.

**Proposed remediation:** when `kind=blocker`, require `details.blocker_id` matching `^[a-zA-Z0-9_-]{1,64}$`. Reject with `ROOM_BLOCKER_MISSING_ID`.

---

### F-LC2-024 — MEDIUM — No disagreement-id validation on kind=disagreement

**File:** absent

**Spec obligation:** §5.1 `disagreement_id` stable-id is part of the envelope.

**Impact:** similar to F-LC2-023. Without a stable id, resolve can't find a disagreement to reference.

**Proposed remediation:** require `details.disagreement_id` for kind=disagreement.

---

### F-LC2-025 — MEDIUM — `parseRoomMetadata` silent-nulls on malformed reasoning

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:114-121`

**Code:**
```ts
function parseRoomMetadata(reasoning: string | null): ParsedRoomMetadata | null {
  if (reasoning === null) return null;
  try {
    return JSON.parse(reasoning) as ParsedRoomMetadata;
  } catch {
    return null;
  }
}
```

**Impact:** if a claim was written with malformed reasoning (by a non-LC.2 pathway or a prior buggy version), reads silently fall back to `sender: 'unknown', transport: 'unknown'`. That's graceful in one sense and dishonest in another — consumer sees a claim with `transport: 'unknown'` and no indication the reasoning was malformed.

**Proposed remediation:** return `{metadata, parseError}` and include a `reasoningError: true` flag in the read event. Or fail-loud with a log.

---

### F-LC2-026 — LOW — `deduped:true` returns the OLD claim's value (not the caller's)

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:170-186`

**Code:** on dedup hit, returns the original claim's id but not the original claim's value. The caller's new `value` is silently ignored. That's the correct semantics (idempotency means same operation → same result), but the response is ambiguous:

```ts
// caller resends with NEW value but same source_id
// response says: recorded:true, deduped:true, claimId:<old>, [no value]
```

Test `"best-effort de-duplicates matching source ids"` illustrates this: first call value `"same logical event"`, second call value `"same logical event but retried"` — dedup returns first's claimId, second's value discarded silently.

**Impact:** if a caller changed the value between retries (misunderstanding idempotency), the divergence is silent. Spec §3.3 doesn't require detecting this, but it's a footgun.

**Proposed remediation:** include the original `value` in the dedup response, or add a field `originalValue: <first>`. Log a warning if caller's new value differs from stored.

---

### F-LC2-027 — LOW — Tool descriptions (MCP) don't document rate-limit, idempotency, FSM

**File:** `packages/limen-mcp/src/tools/room-coordination.ts:303-326`

**Spec obligation:** §3.3 "Implementations MUST document this limitation in their tool descriptions." §5.3 "Implementations MUST document this race explicitly in their tool descriptions." §8.7 "Implementations MUST document this limitation in their tool descriptions." C-10, C-11, C-19.

**Code:** the Zod tool descriptions are terse one-liners. Nothing about:
- Best-effort idempotency & TOCTOU (§3.3)
- Concurrent-writer resolve race (§5.3)
- Rate-limit key (§8.5)
- `debate`/`verify` provisional status (§6.2)
- Blocker FSM rules (§4.2)

**Impact:** AI agents consuming these tools via MCP introspection will not understand the trust boundary. This is a truthful-boundary violation.

**Proposed remediation:** expand tool descriptions to include the MUST-documented clauses verbatim (shorted). Alternatively, link to the COORDINATION-PROTOCOL-v1.0 doc in the tool description.

---

### F-LC2-028 — LOW — Error codes not mapped to spec's named codes

**File:** `packages/limen-mcp/src/tools/room-coordination.ts` (throughout)

**Spec obligation:** §3.4 `ROOM_MESSAGE_TOO_LONG`, §3.5 `ROOM_INVALID_MENTION` (✓ present), §4.2 `ROOM_BLOCKER_ILLEGAL_TRANSITION`, §5.3 `ROOM_RESOLVE_NO_OPEN_DISAGREEMENT`.

**Present in impl:** `ROOM_INVALID_SENDER`, `ROOM_INVALID_ID`, `ROOM_INVALID_MENTION`, `ROOM_INVALID_DETAILS_JSON`, `ROOM_METADATA_TOO_LARGE`.

**Missing:** `ROOM_MESSAGE_TOO_LONG`, `ROOM_BLOCKER_ILLEGAL_TRANSITION`, `ROOM_BLOCKER_INVALID_VALUE`, `ROOM_BLOCKER_MISSING_ID`, `ROOM_RESOLVE_NO_OPEN_DISAGREEMENT`, `ROOM_PARTICIPANT_INVALID_ROLE`, `ROOM_MODE_INVALID_VALUE`, `ROOM_RATE_LIMIT_EXCEEDED`, `ROOM_UNKNOWN_KIND`.

**Impact:** downstream consumers can't program against named errors; spec's error contract is aspirational.

**Proposed remediation:** add the missing codes as the FSM/validation findings above are closed.

---

## Conformance Matrix (Part 11) Scorecard

| Rule  | Requirement                                                          | Status |
| ----- | -------------------------------------------------------------------- | ------ |
| C-1   | Reject subjects not matching `entity:room:<room-id>`                 | PASS   |
| C-2   | Reject predicates not in `room.*` enumerated set                     | PARTIAL — only 4/6 predicates reachable (F-LC2-001/002) |
| C-3   | Inject `transport` server-side; overwrite client-supplied            | PARTIAL — top-level ok; `details.transport` not scrubbed (F-LC2-009) |
| C-4   | Require `source_id` on every append                                  | **FAIL** (F-LC2-004) |
| C-5   | Cap message value length at 2000 chars                               | PARTIAL — Zod only; direct call bypass (F-LC2-011) |
| C-6   | Compute blocker state via most-recent-claim projection               | N/A — no projection exposed (F-LC2-007/022) |
| C-7   | Reject illegal blocker transitions                                   | **FAIL** (F-LC2-003) |
| C-8   | Reject `room.resolve` without matching open disagreement_id          | **FAIL** (F-LC2-006) |
| C-9   | Surface participant role labels; no gate as access control           | PARTIAL — labels not validated (F-LC2-008) |
| C-10  | Document idempotency as best-effort                                  | FAIL — tool description silent (F-LC2-027) |
| C-11  | Document `debate`/`verify` provisional                               | **FAIL** — modes unimplementable (F-LC2-002) |
| C-12  | Rate-limit appends per-sender                                        | **FAIL** (F-LC2-010) |
| C-13  | Agent must be registered before becoming participant                 | **FAIL** (F-LC2-013) |
| C-14  | CLI `isRoomPredicate` analogue                                       | N/A — LC.3 scope  |
| C-15  | Reject room ids containing `:` (v2 bijective rule)                   | PASS   |
| C-16  | Participant roles descriptive-only                                   | PASS (also PARTIAL via F-LC2-008) |
| C-17  | Three-state disagreement projection                                  | **FAIL** (F-LC2-007) |
| C-18  | Archive convention + display archiving sender                        | N/A — projection not exposed |
| C-19  | Rate-limit key documented as `(transport, sender)`                   | **FAIL** (F-LC2-027) |

**Score: 5 PASS / 3 PARTIAL / 9 FAIL / 2 N/A = 5/17 actionable rules conformant.**

---

## Test Matrix (Part 12) Coverage

| T-rule | Property                                                | Codex's tests cover? |
| ------ | ------------------------------------------------------- | -------------------- |
| T-1    | Subject URN rejection (colon/whitespace/>64/invalid)    | PARTIAL (colon + slash + whitespace tested; >64 not tested; chars-outside-set not tested) |
| T-2    | Predicate rejection: 3-segment / unknown 2-segment      | NO  (cannot be tested at MCP layer since Zod trap; not tested at helper layer) |
| T-3    | Transport injection overwrite                           | NO  |
| T-4    | Idempotency single-writer                               | YES |
| T-5    | TOCTOU documentation                                    | NO  |
| T-6    | Blocker OPEN→WAITING→RESOLVED projection                | NO  |
| T-7    | Blocker illegal transition rejected                     | NO  |
| T-8    | Resolve without open disagreement rejected              | NO  (kind missing) |
| T-9    | Observer-labeled participant's blocker claim ACCEPTED   | NO  |
| T-10   | CLI bare-recall exclusion                               | LC.3 scope |
| T-11   | CLI explicit include                                    | LC.3 scope |
| T-12   | Mode default open                                       | NO  (kind missing) |
| T-13   | Rate limit 61st                                         | NO  |
| T-14   | CONFLICTED projection                                   | NO  (kind missing) |
| T-15   | Archive projection                                      | NO  |

**Covered: ~2/15 = 13%. Remaining 13 tests require new implementation.**

This gap alone would be a MEDIUM defect (under Zero-Residual: every missing test is blocking). Combined with the unimplementable kinds, it's HIGH.

---

## Confirmations (spec obligations verified conformant)

The impl DOES correctly:

1. **§1.1 subject URN shape** — `entity:room:<id>` built from validated id.
2. **§1.2 v2 bijective rule** — colons rejected, no normalization (F-LC1-001 closure preserved). `roomSubject('a:b-1')` returns null. `roomSubject('a'.repeat(64))` succeeds; 65 chars fails. 
3. **§3.5 mentions validation** — `parseMentions` applies `isValidAgentName` to each comma-separated mention; returns null on any invalid → error `ROOM_INVALID_MENTION`.
4. **Transport as server-parameter** — `transport` is a function parameter to `recordRoomEvent`, not a field of `args`; so clients have no direct way to set the top-level envelope `transport` value (see F-LC2-009 for the `details` shadow-field bypass).
5. **Sender name validation** — `isValidAgentName` applies `^[a-zA-Z0-9_-]{1,64}$` to `sender` before any storage.
6. **Dedup happy path** — `findExistingBySourceId` scans recent claims and returns first match (within the 200-claim window).
7. **Append-only semantics** — no UPDATE/DELETE codepaths; every call produces a new claim via `limen.remember`.
8. **Cross-room scope** — subjects are tightly scoped; no leakage between rooms observed.

---

## Verdict

**LC.2 NO-GO with findings above.**

Breakdown:
- **5 CRITICAL** findings directly block any LC.3 / LC.4 integration (resolve + mode unimplementable, blocker FSM absent, source_id optional, lost-write silent success).
- **11 HIGH** findings represent systemic spec violations across identity, validation, rate-limit, and envelope compliance.
- **9 MEDIUM** findings include truncation, dedup window, and cross-impl drift.
- **3 LOW** findings are documentation / error-code cosmetic.

The impl is roughly **a third of LC.2 scope** by surface and **a fifth** by conformance rule. Codex built a thin wrapper around `limen.remember` with enough validation to pass his 11 tests, but skipped the entire FSM surface and two of the six predicate kinds. The test suite's own title — "records structured room events **without inventing a fixed FSM**" — announces the omission.

Zero-Residual Law binding (per project CLAUDE.md, 2026-04-10): every finding above is blocking. There is no "CONDITIONAL GO" path. Builder (Codex) must close all 28 findings before LC.4.

**Recommended next steps:**
1. Codex: close F-LC2-001, F-LC2-002, F-LC2-005 first (these unblock the FSM work).
2. Add full per-kind validator dispatch (closes F-LC2-003, F-LC2-008, F-LC2-011, F-LC2-012, F-LC2-023, F-LC2-024).
3. Implement §3.3 / §5.3 / §4.4 projections (closes F-LC2-006, F-LC2-007, F-LC2-022).
4. Implement `(transport, sender)` rate limiter (closes F-LC2-010).
5. Fix envelope shape: `schema_version`, snake_case field names, scrub reserved keys from `details` (closes F-LC2-009, F-LC2-015, F-LC2-016, F-LC2-021).
6. Extend test suite to cover the full T-matrix — minimum 15 tests, one per T-rule.
7. After remediation, Breaker Round 2.

Signed: **claude-code (Breaker, LC.2 Round 1)** — 2026-04-18.
