# CHANGE REQUEST: Amendment 25 Enhancement — Continuous Technique Extraction

**CR Number**: CR-2026-03-29-001
**Requested By**: Femi (Principal Architect)
**Date**: 2026-03-29
**Status**: APPROVED AND IMPLEMENTED — 2026-03-29
**Affects**: Amendment 25, Stop hook, PreCompact hook, SessionEnd hook
**Scope**: All SolisHQ projects, all agents, open source skill system

---

## 1. Current State (Amendment 25 as-is)

Amendment 25 specifies technique extraction at three points:
- Post-sprint (Control 7.5)
- During conversations (organic — agent remembers)
- On session close (reflective)

**Problem**: The "organic" and "reflective" extraction depends on agent memory. If the agent is deep in a complex build, it forgets to extract. If a session crashes, techniques die. If context compacts, unextracted techniques are lost permanently.

**Evidence**: In the 2026-03-29 Vox session (12+ hours), technique extraction happened 15+ times — but ONLY because the orchestrator manually called `limen_reflect` at key moments. If a Builder or Breaker subagent discovers a technique, it has no mechanism to store it. Subagents don't call `limen_reflect` because their skill files don't mandate it.

**Root cause**: Amendment 25 makes extraction a behavioral expectation, not a structural enforcement. Behavioral expectations erode under velocity pressure (same root cause as HB-24, HB-25, HB-26).

---

## 2. Proposed Enhancement

### 2.1 Three-Layer Continuous Extraction (Hook-Enforced)

Replace the behavioral expectation with structural enforcement at three hook points:

**Layer 1 — Stop Hook (Every Response)**
The Stop hook injects a structured mandate into the assistant's context:

```
If this turn produced any of the following, store via limen_reflect before continuing:
- A technique (how to do something that wasn't obvious)
- A decision (a choice with rationale)
- A pattern (a recurring approach)
- A finding (something discovered that changes understanding)
- A warning (a mistake to avoid)

If nothing worth storing: proceed normally.
```

This is a lightweight check on every turn. Most turns produce nothing — the mandate is a no-op. But when a technique IS produced, the extraction is immediate. Not deferred. Not "later." Now.

**Layer 2 — PreCompact Hook (Before Context Loss)**
Before context compaction, the hook injects a FORCED sweep:

```
MANDATORY: Before compaction destroys context, extract ALL unstored techniques from this session.
Scan your conversation for: decisions, patterns, findings, warnings, mistakes, corrections.
Store each via limen_reflect. This is your last chance — after compaction, these are gone.
```

This is the safety net. If Layer 1 missed something (agent was busy, tool call interrupted), Layer 2 catches it.

**Layer 3 — SessionEnd Hook (Session Summary)**
Same as current Amendment 25: session summary via `limen_session_close`. No change.

### 2.2 Subagent Extraction

Subagents (Builder, Breaker, Certifier) should extract techniques in their completion reports. Add to each skill file:

```
Before reporting completion, check: did you discover a technique, pattern, or finding
during this work that would benefit future agents? If yes, include it in your report
tagged with [EXTRACT: category] for the orchestrator to store.
```

The orchestrator processes `[EXTRACT:]` tags from subagent reports and stores them via `limen_reflect`. This works because subagents return their output to the orchestrator, which has Limen access.

### 2.3 Immediate Availability

All extractions go to Limen via `limen_reflect`. Limen is a shared database. Any session running `limen_recall` gets the technique immediately. No sync delay, no file propagation, no manual transfer.

---

## 3. Hard Ban Addition

**Proposed HB#30 (Enhancement)**:

Current HB#30: "Session ends with zero extractions when techniques were produced = methodology violation."

Enhanced HB#30: "Session in which techniques were produced but not stored to Limen before context compaction = methodology violation. Extraction at session-end only is insufficient if compaction occurred during the session."

This makes PreCompact extraction mandatory, not optional.

---

## 4. Implementation Changes

| File | Change | Effort |
|------|--------|--------|
| `~/.claude/hooks/learning-capture.sh` (Stop hook) | Replace reminder with structured mandate | 30 min |
| `~/.claude/hooks/pre-compact.sh` | Add forced sweep mandate | 30 min |
| `~/.claude/CLAUDE.md` (global) | Update Amendment 25 text | 15 min |
| `~/.claude/skills/spine/doctrine/DOCTRINE.md` | Add Layer 1/2/3 to learning loop section | 15 min |
| Per-project CLAUDE.md (each project) | Update Amendment 25 reference | 5 min each |
| `.claude/builder.md` (template) | Add [EXTRACT:] tag instruction | 10 min |
| `.claude/breaker.md` (template) | Add [EXTRACT:] tag instruction | 10 min |
| `.claude/certifier.md` (template) | Add [EXTRACT:] tag instruction | 10 min |
| `~/SolisHQ/Docs/AMENDMENT_25_TECHNIQUE_EXTRACTION.md` | Update spec with enhancement | 30 min |

**Total effort**: ~3 hours
**Risk**: Low — additive change, no breaking behavior
**Blast radius**: All projects, all agents, all sessions — but the change is additive (more extraction, not less)
**Reversibility**: High — revert hook changes to restore current behavior

---

## 5. Backward Compatibility

- Current Amendment 25 behavior continues to work (session-close extraction)
- The enhancement ADDS two new extraction points (Stop, PreCompact)
- No existing extractions are affected
- Projects that haven't updated their skill files still get Layer 1 and 2 via global hooks
- Open source consumers get the enhancement when they pull the updated skill system

---

## 6. Open Source Impact

This change ships as part of the SolisHQ Skill System update. Consumers who use:
- The Stop hook template get Layer 1 automatically
- The PreCompact hook template get Layer 2 automatically
- The skill file templates get subagent extraction tags

**No breaking changes for existing users.** The enhancement is purely additive.

---

## 7. Decision Required

**PA to approve or modify:**
1. Three-layer continuous extraction (Stop + PreCompact + SessionEnd)
2. Subagent [EXTRACT:] tag protocol
3. HB#30 enhancement (compaction-aware)
4. Implementation scope and timeline

---

*SolisHQ — We innovate, invent, then disrupt.*
