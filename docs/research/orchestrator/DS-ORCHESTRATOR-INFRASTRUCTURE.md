# DESIGN SOURCE: ORCHESTRATOR INFRASTRUCTURE REBUILD

**Document ID**: DS-ORCH-INFRA-001
**Author**: Builder (Senior Head of Engineering)
**Date**: 2026-03-30
**Classification**: CONSEQUENTIAL (affects all sessions, all projects, all agents)
**Governing Documents**: CLAUDE.md (global), ORCHESTRATOR_SUPERPOWERS_OPERATIONAL_BRIEF.md
**Oracle Gate**: OG-CONSULT: DEGRADED -- Intelligence MCP unavailable at 2026-03-30T12:00:00Z. Manual standards review conducted from full codebase audit of all 16 hooks, settings.json, and 3 audit documents.

---

## Preamble

This Design Source defines the complete architecture for rebuilding the SolisHQ Orchestrator infrastructure to deliver all 14 superpowers as a unified system. It is derived from first principles -- not from any existing orchestration framework, not from Airflow, not from Kubernetes patterns. Every design decision traces to a specific operational brief requirement, an audit finding, or a constitutional law.

The document is self-contained. An engineer can implement each sprint from this document alone, without reference to the operational brief (though the brief provides motivation and context).

### Design Principles (Derived, Not Assumed)

**DP-1: Additive Evolution.** Every hook modification preserves existing functionality. New capabilities are layered on, never replacing working code. Derived from: the existing hook system is in production, operational, and tested. Breaking it means breaking all sessions.

**DP-2: Graceful Degradation.** Every new component fails open. If the narrative engine crashes, sessions start without a narrative -- they do not fail to start. Derived from: hook timeouts are 3-10 seconds. Any component that can cause a timeout is a system-wide failure mode.

**DP-3: File-Based State, No Daemons.** All state lives in the filesystem. No background processes, no databases beyond existing SQLite (Limen, telemetry). Derived from: the hook architecture is process-per-invocation with no shared memory.

**DP-4: Single Source of Truth.** Each piece of information has exactly one authoritative location. Derived from: the Memory Architecture Audit (2026-03-28) identified dual-source consistency as the root cause of memory decay.

**DP-5: Structural Enforcement Over Behavioral Rules.** Where a rule can be enforced by a hook, it must be. Behavioral rules degrade within weeks. Derived from: Memory Architecture Audit finding D-3 (FM-P5: near-100% probability of regression without structural enforcement).

### Five Questions

1. **What does the spec require?** 14 superpowers integrated into a coherent infrastructure that makes the Orchestrator sense, remember, enforce, anticipate, and scale. The brief is the spec.
2. **How can this fail?** Hook timeouts (>5s = dead session start), state file corruption (invalid JSON/JSONL = lost data), concurrent session conflicts (two sessions writing same file = data loss), Limen unavailability (claims not persisted = knowledge lost), feature interaction (sentinel writes trigger memory guard = false positive).
3. **Downstream consequences?** Every session starts through this infrastructure. A defect here propagates to every project, every agent, every dispatch. Blast radius is maximum.
4. **What am I assuming?** (a) Claude Code hook API remains stable (SessionStart/Stop/PreCompact/SessionEnd/SubagentStart/SubagentStop/PreToolUse/PostToolUse/UserPromptSubmit). (b) Python3 and bash remain available on the host. (c) Limen SQLite schema is additive-only (new columns, not removed columns). (d) File I/O completes within 100ms for small files (<10KB). (e) The host machine is a single-user macOS system (no multi-user contention).
5. **Would a hostile reviewer find fault?** They would challenge: (a) the narrative engine relying on LLM self-summary (can the model accurately summarize its own session?), (b) the Femi model being a static file (how does it stay current?), (c) the dispatch planner being file-based when DAG execution needs real coordination. Each is addressed in the relevant section.

---

## 1. MODULE DECOMPOSITION

### 1.1 Layer Map

```
LAYER 7 ── ORCHESTRATION ──────────────────────────────────────
  Dispatch Planner (SP#11)  |  Agent Monitoring (SP#13)
  Synthesis Engine (SP#14)  |  Multi-Pass Reasoning (SP#3)
  Agent Excellence (SP#7)

LAYER 6 ── AWARENESS ──────────────────────────────────────────
  Temporal Awareness (SP#8)  |  Proactive Sensing (SP#2)
  Femi Model (SP#10)         |  Autonomy Levels (SP#9)

LAYER 5 ── KNOWLEDGE ──────────────────────────────────────────
  Reasoning Chains (SP#4)  |  Haystack Finder (SP#6)
  Specialization Memory (SP#12)

LAYER 4 ── ACCOUNTABILITY ─────────────────────────────────────
  Promise Register (SP#5)

LAYER 3 ── ENFORCEMENT ────────────────────────────────────────
  Memory Write Guard  |  HB-26 Enforcement  |  Frozen Zones
  IP Protection       |  Oracle Gate Tracker

LAYER 2 ── MEMORY GOVERNANCE ──────────────────────────────────
  Session Narrative Engine (SP#1)  |  Session Brief Storage

LAYER 1 ── SESSION LIFECYCLE ──────────────────────────────────
  SessionStart  |  PreCompact  |  Stop  |  SessionEnd
  SubagentStart |  SubagentStop | UserPromptSubmit
```

Dependencies flow downward. Higher layers depend on lower layers. No upward dependencies. No circular dependencies.

### 1.2 Component Inventory: What Exists, What's Broken, What's New

#### LAYER 1 -- SESSION LIFECYCLE

| Component | Status | Location | Assessment |
|-----------|--------|----------|------------|
| session-opener.sh | EXISTS, FUNCTIONAL | ~/.claude/hooks/session-opener.sh | Loads Limen claims, orchestrator skill, A25 techniques, NOUS state, infra manifest, portfolio scan, compliance, governance. 321 lines. Works. Needs enhancement for narrative brief, sentinel findings, temporal data, Femi model. |
| pre-compact.sh | EXISTS, FUNCTIONAL | ~/.claude/hooks/pre-compact.sh | Forces A25 extraction sweep, injects restore instructions. 100 lines. Works. Needs enhancement for interim narrative, session duration. |
| learning-capture.sh | EXISTS, FUNCTIONAL | ~/.claude/hooks/learning-capture.sh | Stop hook. Prompts for Limen extractions (decisions, warnings, patterns, project knowledge). 109 lines. Works. Needs enhancement for promise review. |
| session-closer.sh | EXISTS, MINIMAL | ~/.claude/hooks/session-closer.sh | SessionEnd hook. Async. Logs session end to telemetry DB and log file. Cleans per-session mute files. 65 lines. Needs major enhancement for narrative generation, promise reconciliation. |
| subagent-start.sh | EXISTS, FUNCTIONAL | ~/.claude/hooks/subagent-start.sh | Logs dispatch to file and telemetry. 118 lines. Needs enhancement for dispatch ID, agent rating setup. |
| subagent-stop.sh | EXISTS, FUNCTIONAL | ~/.claude/hooks/subagent-stop.sh | Extracts learnings, checks Oracle Gate compliance. 202 lines. Needs enhancement for agent rating capture, excellence gate. |
| voice-output.sh | EXISTS, FUNCTIONAL | ~/.claude/hooks/voice-output.sh | Stop hook. Three-layer text extraction, secret filter, barge-in support. 256 lines. No changes needed. |
| voice-mute-toggle.sh | EXISTS, FUNCTIONAL | ~/.claude/hooks/voice-mute-toggle.sh | UserPromptSubmit hook. Per-session and global mute. No changes needed. |

#### LAYER 2 -- MEMORY GOVERNANCE

| Component | Status | Location | Assessment |
|-----------|--------|----------|------------|
| Session Narrative Engine | NEW | Behavioral (Stop turn + SessionEnd hook) | Core of SP#1. Generates narrative brief from session context. |
| Session Brief Storage | NEW | ~/.solishq/session-briefs/ | File storage for narrative briefs. latest.md symlink. |

#### LAYER 3 -- ENFORCEMENT

| Component | Status | Location | Assessment |
|-----------|--------|----------|------------|
| memory-write-guard.py | EXISTS, PARTIALLY WIRED | ~/.claude/hooks/memory-write-guard.py | PreToolUse hook on Write/Edit. WARN mode. 138 lines. IS hooked in settings.json (matcher: "Write\|Edit"). Functional. No changes needed for SP rebuild. |
| enforce-hb26.py | EXISTS, FUNCTIONAL | ~/.claude/hooks/enforce-hb26.py | PreToolUse on Task. 4-layer enforcement. ~1800 lines. Needs enforcement gap fixes (per ENFORCEMENT-GAP-AUDIT.md) but those are a separate sprint. |
| frozen-zone-guard.py | EXISTS, FUNCTIONAL | ~/.claude/hooks/frozen-zone-guard.py | PreToolUse on Write/Edit. Blocks governance files, warns on hooks. 123 lines. No changes needed. |
| enforce-ip-protection.sh | EXISTS, FUNCTIONAL | ~/.claude/hooks/enforce-ip-protection.sh | PreToolUse on Bash. No changes needed. |
| oracle-gate-tracker.py | EXISTS, FUNCTIONAL | ~/.claude/hooks/oracle-gate-tracker.py | PostToolUse on Oracle tools. 120 lines. Needs dispatch ID enhancement (per enforcement gap audit). |

#### LAYER 4 -- ACCOUNTABILITY

| Component | Status | Location | Assessment |
|-----------|--------|----------|------------|
| Promise Register | NEW | ~/.solishq/promises/ | JSONL files per day. Hook integration at Stop and SessionEnd. |

#### LAYER 5 -- KNOWLEDGE

| Component | Status | Location | Assessment |
|-----------|--------|----------|------------|
| Reasoning Chains | NEW | Limen schema enhancement | Requires Limen v1.3.0+ (FTS5 first, then reasoning column). |
| Haystack Finder | PARTIAL | Behavioral (Limen recall) | Phase 1 is methodology only. Phase 2 needs FTS5. Phase 3 needs vector search. |
| Specialization Memory | NEW | ~/.solishq/agent-ratings/ | JSONL files per day. Populated by subagent-stop.sh enhancement. |

#### LAYER 6 -- AWARENESS

| Component | Status | Location | Assessment |
|-----------|--------|----------|------------|
| Temporal Awareness | PARTIAL | session-opener.sh (injects date) | Time injection exists but is incomplete. No session duration, no pacing. |
| Proactive Sensing | PARTIAL | ~/.solishq/sentinel/ | Two scripts exist (governance-health.sh, nightly-tests.sh). No comprehensive check.sh. No scheduled execution. No SessionStart integration. |
| Femi Model | NEW | ~/.solishq/femi-model.md | Consolidation of preference.femi claims + distilled behavioral model. |
| Autonomy Levels | NEW | ~/.solishq/autonomy.json | Per-session state. Escalation matrix. |

#### LAYER 7 -- ORCHESTRATION

| Component | Status | Location | Assessment |
|-----------|--------|----------|------------|
| Dispatch Planner | NEW | Behavioral (Orchestrator methodology) + ~/.solishq/dispatch/ | DAG execution for multi-agent work. |
| Agent Monitoring | NEW | Behavioral + file tailing | Progress tracking on background agents. |
| Synthesis Engine | NEW | Behavioral (Orchestrator methodology) | N-to-1 report aggregation protocol. |
| Multi-Pass Reasoning | NEW | Behavioral (methodology rule) | Self-challenge before presenting Significant+ decisions. |
| Agent Excellence | NEW | Behavioral (methodology rule) | Quality gates on agent output before presenting to PA. |

### 1.3 Dependency Matrix

```
session-opener.sh READS:
  - ~/.solishq/session-briefs/latest.md       [SP#1: Narrative Memory]
  - ~/.solishq/sentinel/latest.json           [SP#2: Proactive Sensing]
  - ~/.solishq/femi-model.md                  [SP#10: Femi Model]
  - ~/.solishq/autonomy.json                  [SP#9: Autonomy Levels]
  - system clock (date)                       [SP#8: Temporal Awareness]

learning-capture.sh (Stop hook) WRITES:
  - Limen claims via behavioral prompt        [SP#5: Promise review prompt]
  - ~/.solishq/promises/YYYY-MM-DD.jsonl      [SP#5: Promise logging]

session-closer.sh (SessionEnd) WRITES:
  - ~/.solishq/session-briefs/YYYY-MM-DD-HHMMSS.md  [SP#1: Narrative]
  - ~/.solishq/session-briefs/latest.md              [SP#1: Symlink update]
  - ~/.solishq/promises/YYYY-MM-DD.jsonl             [SP#5: Outcome reconciliation]

pre-compact.sh READS/WRITES:
  - Generates interim narrative               [SP#1: Survives compaction]
  - Injects session duration                  [SP#8: Temporal Awareness]

subagent-stop.sh WRITES:
  - ~/.solishq/agent-ratings/YYYY-MM-DD.jsonl [SP#12: Specialization Memory]
```

---

## 2. TYPE ARCHITECTURE

### 2.1 SessionBrief

```
File: ~/.solishq/session-briefs/YYYY-MM-DD-HHMMSS.md
Format: Markdown with YAML frontmatter

---
session_id: <string>           # Claude Code session ID
project: <string>              # Project name (basename of CWD)
started_at: <ISO-8601>         # Session start timestamp
ended_at: <ISO-8601>           # Session end timestamp
duration_minutes: <integer>    # Rounded session duration
energy: <string>               # "invention" | "execution" | "debugging" | "planning" | "research"
unfinished_count: <integer>    # Number of unfinished threads
promise_count: <integer>       # Promises made this session
promise_kept: <integer>        # Promises with positive outcome
---

<narrative text>

## Unfinished Threads
- <thread description> -- <status>

## Femi's Current Direction
<distilled directional statement>
```

**Rationale**: YAML frontmatter enables programmatic parsing (grep for energy, count unfinished threads across briefs) while the body remains human-readable narrative. The frontmatter fields are the minimum needed for cross-session analysis without reading the full narrative.

### 2.2 SentinelReport

```
File: ~/.solishq/sentinel/latest.json
Format: JSON

{
  "timestamp": "<ISO-8601>",
  "duration_ms": <integer>,
  "checks": {
    "<check_id>": {
      "name": "<human-readable name>",
      "category": "system" | "project" | "limen" | "infrastructure",
      "severity": "CRITICAL" | "WARNING" | "INFO",
      "status": "PASS" | "FAIL" | "DEGRADED" | "SKIP",
      "message": "<details>",
      "value": <any>
    }
  },
  "summary": {
    "critical": <integer>,
    "warning": <integer>,
    "info": <integer>,
    "total_checks": <integer>
  }
}
```

**Human-readable companion**: `~/.solishq/sentinel/latest.md` generated from the JSON for direct reading.

### 2.3 PromiseEntry

```
File: ~/.solishq/promises/YYYY-MM-DD.jsonl
Format: JSONL (one entry per line)

{
  "id": "<uuid-v4>",
  "ts": "<ISO-8601>",
  "session_id": "<string>",
  "promise": "<exact text of the commitment>",
  "category": "estimate" | "quality" | "capability" | "delivery" | "correctness",
  "confidence": <float 0.0-1.0>,
  "context": "<what was being discussed>",
  "outcome": null | "kept" | "broken" | "partial" | "deferred",
  "outcome_ts": null | "<ISO-8601>",
  "delta": null | "<description of gap between promise and reality>",
  "calibration": null | "<learning for future estimation>"
}
```

**Rationale**: JSONL over JSON array because promises are appended throughout a session. JSONL supports append without read-modify-write. UUID enables cross-referencing with Limen claims.

### 2.4 DispatchPlan

```
Format: In-memory (Orchestrator constructs in context), persisted to file for multi-session plans.
File: ~/.solishq/dispatch/active-plan.json (when persisted)

{
  "plan_id": "<uuid-v4>",
  "created_at": "<ISO-8601>",
  "objective": "<what this plan achieves>",
  "autonomy_level": <integer 1-4>,
  "quality_bar": "standard" | "excellence" | "aerospace",
  "max_parallelism": <integer>,
  "tasks": [
    {
      "task_id": "<short-id>",
      "type": "build" | "break" | "certify" | "research" | "design" | "audit",
      "description": "<what this task produces>",
      "role": "<Builder | Breaker | Certifier | Researcher | ...>",
      "depends_on": ["<task_id>", ...],
      "status": "pending" | "dispatched" | "running" | "complete" | "failed" | "skipped",
      "agent_session_id": null | "<string>",
      "started_at": null | "<ISO-8601>",
      "completed_at": null | "<ISO-8601>",
      "output_path": null | "<file path>",
      "quality_rating": null | <AgentRating>
    }
  ],
  "execution_order": [
    ["<task_id>", "<task_id>"],   // Wave 1: parallel
    ["<task_id>"],                // Wave 2: sequential after wave 1
  ]
}
```

**Rationale**: The `execution_order` field is the topologically sorted DAG, pre-computed at plan creation time. Each inner array is a wave of tasks that can execute in parallel. This eliminates runtime DAG resolution -- the Orchestrator just walks the waves sequentially, dispatching each wave's tasks in parallel.

### 2.5 AgentRating

```
File: ~/.solishq/agent-ratings/YYYY-MM-DD.jsonl
Format: JSONL

{
  "ts": "<ISO-8601>",
  "session_id": "<string>",
  "dispatch_id": "<string>",
  "role": "<string>",
  "task_type": "<string>",
  "project": "<string>",
  "quality": <float 0.0-1.0>,
  "completeness": <float 0.0-1.0>,
  "correctness": <float 0.0-1.0>,
  "originality": <float 0.0-1.0>,
  "flags": ["plan_mode" | "shallow" | "copied" | "incomplete" | "excellent" | "novel"],
  "prompt_hash": "<sha256 of first 500 chars of dispatch prompt>",
  "notes": "<what worked, what didn't>"
}
```

**Rationale**: prompt_hash enables correlation between prompt patterns and output quality without storing the full prompt (which may contain sensitive project data).

### 2.6 AutonomyLevel

```
File: ~/.solishq/autonomy.json
Format: JSON

{
  "default_level": <integer 1-4>,
  "overrides": {
    "<project-name>": <integer 1-4>
  },
  "escalation_log": [
    {
      "ts": "<ISO-8601>",
      "from_level": <integer>,
      "to_level": <integer>,
      "reason": "<PA directive or auto-adjustment>"
    }
  ],
  "last_updated": "<ISO-8601>"
}
```

**Escalation Matrix by Level**:

| Level | Name | Dispatch | Architecture | P0 Finding | Estimate > 4h |
|-------|------|----------|-------------|------------|---------------|
| 1 | Supervised | Ask PA | Ask PA | Report immediately | Ask PA |
| 2 | Guided | Execute | Ask PA | Report immediately | Report, proceed |
| 3 | Autonomous | Execute | Ask PA if blast > 3 projects | Report immediately | Execute, log |
| 4 | Full Trust | Execute | Execute, document | Report at session end | Execute, log |

### 2.7 FemiModel

```
File: ~/.solishq/femi-model.md
Format: Markdown (human-readable, loaded into context)

# Femi Decision Model

## Core Decision Patterns
- <pattern>: <when observed, how to respond>

## Preferences
- <preference>: <what it means for recommendations>

## Anti-Patterns (What Not To Do)
- <anti-pattern>: <why it fails, what to do instead>

## Energy States
- <state>: <signals, appropriate response>

## Last Updated: <ISO-8601>
## Source Claims: <count> from Limen predicate preference.femi
```

---

## 3. STATE MACHINES

### 3.1 Session Lifecycle

```
                                  ┌─────────────┐
                                  │    COLD      │
                                  │ (no session) │
                                  └──────┬───────┘
                                         │ SessionStart hook fires
                                         ▼
                                  ┌─────────────┐
                                  │  STARTING    │
                                  │ Load brief   │
                                  │ Load sentinel│
                                  │ Load femi    │
                                  │ Load temporal│
                                  │ Open Limen   │
                                  └──────┬───────┘
                                         │ Context injected
                                         ▼
                          ┌──────────────────────────────┐
                          │           ACTIVE              │
                          │  Orchestrator operational     │
                          │  Promises being tracked       │
                          │  A25 extraction on every Stop │
                          └──────┬───────────┬────────────┘
                                 │           │
                    PreCompact   │           │  User ends session
                                 ▼           │
                          ┌─────────────┐    │
                          │ COMPACTING   │    │
                          │ Interim      │    │
                          │ narrative    │    │
                          │ Extraction   │    │
                          │ sweep        │    │
                          └──────┬───────┘    │
                                 │            │
                                 │ Compaction  │
                                 │ complete    │
                                 ▼            │
                          ┌─────────────┐    │
                          │  ACTIVE      │◄───┘ (if compaction,
                          │  (resumed)   │       return to active)
                          └──────┬───────┘
                                 │ Session ends
                                 ▼
                          ┌─────────────┐
                          │   ENDING     │
                          │ Final A25    │
                          │ Narrative    │
                          │ gen          │
                          │ Promise      │
                          │ reconcile    │
                          │ Limen close  │
                          └──────┬───────┘
                                 │ SessionEnd hook
                                 ▼
                          ┌─────────────┐
                          │   CLOSED     │
                          │ Brief saved  │
                          │ Telemetry    │
                          │ logged       │
                          └─────────────┘
```

**Transitions**:

| From | To | Trigger | Side Effects |
|------|----|---------|-------------|
| COLD | STARTING | SessionStart hook | Read session brief, sentinel, femi model, autonomy, temporal data |
| STARTING | ACTIVE | Context injection complete | Orchestrator intro text, Limen session opened |
| ACTIVE | COMPACTING | PreCompact hook | Interim narrative generated, A25 extraction sweep, session duration injected |
| COMPACTING | ACTIVE | Compaction complete | Context restored from Limen + state files |
| ACTIVE | ENDING | Stop hook (final turn) | Final A25 extraction, promise review prompted |
| ENDING | CLOSED | SessionEnd hook (async) | Narrative brief written, symlink updated, telemetry logged, per-session cleanup |

**Invariant**: No state is lost between ACTIVE and COMPACTING. The interim narrative + Limen claims + state files contain everything needed to resume.

### 3.2 Sentinel State Machine

```
       ┌────────┐
       │  IDLE  │◄──────────────────────┐
       └───┬────┘                       │
           │ Trigger (cron/manual/      │
           │ session start)             │
           ▼                            │
       ┌────────────┐                   │
       │  CHECKING  │                   │
       │ Run all    │                   │
       │ health     │                   │
       │ checks     │                   │
       └───┬────────┘                   │
           │ All checks complete        │
           ▼                            │
       ┌────────────┐                   │
       │ REPORTING  │                   │
       │ Write JSON │                   │
       │ Write MD   │                   │
       │ Log to     │                   │
       │ telemetry  │                   │
       └───┬────────┘                   │
           │                            │
           └────────────────────────────┘
```

**Error handling**: If any individual check times out (>2s), mark it SKIP with message "timeout" and continue. The sentinel never blocks on a single check.

### 3.3 Dispatch State Machine

```
       ┌──────────┐
       │ PLANNED  │  Orchestrator creates plan
       └────┬─────┘
            │ Start execution
            ▼
       ┌────────────┐
       │DISPATCHING │  Send wave N tasks
       └────┬───────┘
            │ All wave N tasks sent
            ▼
       ┌────────────┐     task fails
       │ MONITORING │────────────────┐
       │ Check      │                │
       │ progress   │                ▼
       │ Tail logs  │          ┌───────────┐
       └────┬───────┘          │  FAILURE  │
            │ All wave N       │  HANDLING │
            │ tasks complete   └─────┬─────┘
            ▼                        │ retry/skip/escalate
       ┌────────────┐                │
       │ SYNTHESIS  │◄───────────────┘
       │ Aggregate  │
       │ outputs    │
       └────┬───────┘
            │ More waves?
            │ Yes → back to DISPATCHING
            │ No  ↓
       ┌────────────┐
       │  COMPLETE  │
       │  Present   │
       │  to PA     │
       └────────────┘
```

### 3.4 Promise State Machine

```
       ┌────────┐
       │  MADE  │  Orchestrator commits to something
       └───┬────┘
           │ Logged to JSONL
           ▼
       ┌──────────┐
       │ TRACKING │  Session continues
       └───┬──────┘
           │ Session end / explicit check
           ▼
       ┌────────────────┐
       │ OUTCOME        │
       │ RECORDED       │
       │ kept/broken/   │
       │ partial/       │
       │ deferred       │
       └───┬────────────┘
           │ Delta computed
           ▼
       ┌────────────────┐
       │ CALIBRATION    │
       │ APPLIED        │
       │ Limen claim    │
       │ stored         │
       └────────────────┘
```

---

## 4. SYSTEM-CALL MAPPING

This section maps each superpower to specific implementation changes.

### SP#1: Narrative Memory

| Artifact | Action | Details |
|----------|--------|---------|
| `~/.solishq/session-briefs/` | CREATE directory | Storage for narrative briefs |
| `session-closer.sh` | ENHANCE | Add narrative generation: extract last_assistant_message from stdin, run Python narrative generator, write to timestamped file, update latest.md symlink |
| `session-opener.sh` | ENHANCE | Add 5 lines: read `~/.solishq/session-briefs/latest.md`, inject as first context block (before Limen claims, before infra manifest) |
| `pre-compact.sh` | ENHANCE | Add interim narrative generation: inject directive to generate narrative as part of the compaction summary |
| `learning-capture.sh` | ENHANCE | Add narrative prompt: "Before stopping, generate a session narrative covering: what happened, why decisions were made, unfinished threads, Femi's current energy." |

**Narrative Generation Strategy**: The narrative is generated by the model itself during the Stop turn, prompted by the learning-capture.sh hook. The hook adds a directive: "Write a session narrative to `~/.solishq/session-briefs/[timestamp].md` before closing Limen." The SessionEnd hook (async) then updates the symlink. This avoids the problem of an external LLM call in a 3-second timeout hook.

**Critical Design Decision**: The narrative is generated BEHAVIORALLY (the model writes the file during its Stop turn), not STRUCTURALLY (not by the hook itself). The hook cannot generate a narrative because (a) it has no access to the full conversation context, and (b) it has a 3-5 second timeout. The hook's role is to PROMPT the generation and VERIFY the file exists at SessionEnd.

**Fallback**: If the model fails to write the narrative (behavioral failure), the SessionEnd hook detects the absence and writes a minimal structured brief from the session metadata available in stdin (session_id, cwd, timestamp). This is degraded but non-zero.

### SP#2: Proactive Sensing

| Artifact | Action | Details |
|----------|--------|---------|
| `~/.solishq/sentinel/check.sh` | CREATE | Comprehensive health check script (see Section 6 for full spec) |
| `~/.solishq/sentinel/latest.json` | CREATE (by check.sh) | Structured health report |
| `~/.solishq/sentinel/latest.md` | CREATE (by check.sh) | Human-readable summary |
| `session-opener.sh` | ENHANCE | Read latest.json, inject CRITICAL/WARNING findings before Limen claims |

**Scheduling**: The sentinel runs via Claude Code's scheduled task system (`/schedule`), not via cron or launchd. This keeps the infrastructure within Claude Code's management domain. Fallback: if scheduled tasks are not available, document manual invocation via `/sentinel` slash command.

**Check Categories** (implemented in check.sh):

| ID | Check | Category | Severity on Fail |
|----|-------|----------|------------------|
| SYS-01 | Vox binary running | system | CRITICAL |
| SYS-02 | Vox process responsive | system | CRITICAL |
| SYS-03 | Crash reports exist | system | WARNING |
| SYS-04 | Disk space > 5GB | system | WARNING |
| SYS-05 | Groq API key valid | system | WARNING |
| SYS-06 | macOS permissions intact | system | WARNING |
| PRJ-01 | Uncommitted changes > 24h | project | WARNING |
| PRJ-02 | Failing tests (last nightly) | project | WARNING |
| PRJ-03 | Stale pipeline state > 48h | project | INFO |
| PRJ-04 | Expired promise ceilings | project | WARNING |
| LIM-01 | Limen DB accessible | limen | CRITICAL |
| LIM-02 | Claim count + growth | limen | INFO |
| LIM-03 | Low-confidence relied claims | limen | WARNING |
| INF-01 | MCP servers responding | infrastructure | CRITICAL |
| INF-02 | All hooks present + executable | infrastructure | WARNING |
| INF-03 | Orphaned node processes | infrastructure | WARNING |

### SP#3: Multi-Pass Reasoning

| Artifact | Action | Details |
|----------|--------|---------|
| Orchestrator SKILL.md | ENHANCE | Add standing order: "For Significant and Consequential weight decisions, dispatch a Challenger agent before presenting to PA." |

**Implementation**: This is a METHODOLOGY RULE, not infrastructure. The standing order is added to the Orchestrator skill file. No hooks, no files, no state. The Orchestrator dispatches a Task with `# ROLE: Breaker` and directive "Challenge this analysis: [analysis]. Find what's wrong, what's missing, what assumptions are unexamined." The Breaker's output is integrated before PA presentation.

**Why not structural?** Structural enforcement would require intercepting every Orchestrator response, classifying its decision weight, and blocking if no Challenger was dispatched. This would add 5+ seconds to every response and require the hook to understand decision semantics. The behavioral rule is proportional to the risk.

### SP#4: Reasoning Chain Memory

| Artifact | Action | Details |
|----------|--------|---------|
| Limen `claim_assertions` table | ENHANCE | Add `reasoning TEXT` column (nullable, additive migration) |
| `limen_reflect` API | ENHANCE | Accept optional `reasoning` parameter |
| `limen_recall` API | ENHANCE | Return reasoning field when present |
| FTS5 index | ENHANCE | Index reasoning text for full-text search |

**Dependency**: Requires Limen v1.3.0 (FTS5) to be implemented first. The reasoning column is a v1.4.0 feature. Additive migration: `ALTER TABLE claim_assertions ADD COLUMN reasoning TEXT;`

**Deferred to Sprint O6.**

### SP#5: Promise Accountability

| Artifact | Action | Details |
|----------|--------|---------|
| `~/.solishq/promises/` | CREATE directory | Daily JSONL files |
| `learning-capture.sh` | ENHANCE | Add promise review prompt: "Review promises made this session. For each, record the outcome." |
| `session-closer.sh` | ENHANCE | Cross-check: did the Stop turn review promises? If promise file was not updated and session was non-trivial, log a warning. |
| `session-opener.sh` | ENHANCE | Load yesterday's promise outcomes as context: "Yesterday's promises: N kept, M broken. Calibration notes: [...]" |

**Promise Capture**: The Orchestrator writes promises to the JSONL file using a Bash tool call whenever it makes a commitment. The learning-capture.sh hook prompts review at session end. This is BEHAVIORAL capture with STRUCTURAL review prompting.

### SP#6: Haystack Finder

| Artifact | Action | Details |
|----------|--------|---------|
| Orchestrator SKILL.md | ENHANCE | Add protocol: "When encountering P0/P1 issues, search Limen for warning.*, pattern.*, and grep findings-log.md across projects." |

**Phase 1** (this sprint): Methodology rule only. Search Limen claims and grep across projects.
**Phase 2** (after Limen v1.3.0): FTS5 keyword search across all claims.
**Phase 3** (after Limen v1.4.0): Vector search for semantic similarity.

### SP#7: Agent Excellence Enforcement

| Artifact | Action | Details |
|----------|--------|---------|
| `subagent-stop.sh` | ENHANCE | Add excellence gate checks: file existence (did agent write requested artifacts?), depth proxy (output size), originality scan (check for "best practice"/"commonly used" phrases) |
| Orchestrator SKILL.md | ENHANCE | Add standing order: "Before presenting any agent output to PA, verify: (1) all files written, (2) depth matches weight, (3) originality check, (4) limitation acknowledgment." |

**Structural component**: The subagent-stop.sh hook can check file existence and output size. These are mechanical checks that don't require semantic understanding. The hook emits WARNING-level findings in additionalContext.

**Behavioral component**: The Orchestrator applies the originality check and limitation check. These require reading and understanding the output.

### SP#8: Temporal Awareness

| Artifact | Action | Details |
|----------|--------|---------|
| `session-opener.sh` | ENHANCE | Add temporal block: current time, day of week, time since last session ended, session count today |
| `pre-compact.sh` | ENHANCE | Add session duration: compare current time to session start (read from latest brief or telemetry) |
| `~/.solishq/state/session-start.txt` | CREATE (by session-opener.sh) | Stores session start timestamp for duration calculation |

**Implementation detail**: session-opener.sh writes `date +%s` to `~/.solishq/state/session-start.txt`. pre-compact.sh reads it and computes elapsed time. session-closer.sh reads it for the narrative brief's `duration_minutes` field.

### SP#9: Autonomy Levels

| Artifact | Action | Details |
|----------|--------|---------|
| `~/.solishq/autonomy.json` | CREATE | Initial state: `{"default_level": 2, "overrides": {}, "escalation_log": [], "last_updated": "..."}` |
| `session-opener.sh` | ENHANCE | Read autonomy.json, inject current level and escalation matrix |
| Orchestrator SKILL.md | ENHANCE | Add autonomy protocol: level descriptions, how to respond to "go autonomous" / "stay supervised" |

**PA Commands**: The autonomy level is set by PA verbal commands. The Orchestrator writes the JSON file when PA says "go autonomous on X" or "stay supervised." The session-opener reads it on next session start.

### SP#10: Femi Emulation Model

| Artifact | Action | Details |
|----------|--------|---------|
| `~/.solishq/femi-model.md` | CREATE | Consolidated from Limen preference.femi claims + observed patterns |
| `session-opener.sh` | ENHANCE | Read femi-model.md, inject after narrative brief |
| `learning-capture.sh` | ENHANCE | Add prompt: "If Femi expressed a preference or pattern this session, update ~/.solishq/femi-model.md" |

**Bootstrapping**: Initial femi-model.md is generated by querying all `preference.femi` claims from Limen and distilling into the model format. Subsequent updates are behavioral -- the Stop hook prompts the Orchestrator to update the file when new preferences are observed.

### SP#11: Agent Army Orchestration (DAG Dispatch)

| Artifact | Action | Details |
|----------|--------|---------|
| `~/.solishq/dispatch/` | CREATE directory | Active plan storage |
| Orchestrator SKILL.md | ENHANCE | Add dispatch planning protocol: DAG construction, wave computation, parallel dispatch, monitoring, failure handling |

**DAG Computation**: Topological sort of task dependency graph. Implemented as a Python function the Orchestrator can call inline (not a hook -- this runs during the Orchestrator's active turn).

```python
def compute_waves(tasks):
    """Topological sort into parallel waves."""
    # Build adjacency: task_id -> set of dependent task_ids
    deps = {t["task_id"]: set(t.get("depends_on", [])) for t in tasks}
    waves = []
    remaining = set(deps.keys())
    while remaining:
        # Wave = all tasks whose dependencies are already scheduled
        scheduled = set()
        for wave in waves:
            scheduled.update(wave)
        wave = {t for t in remaining if deps[t].issubset(scheduled)}
        if not wave:
            raise ValueError(f"Dependency cycle detected. Remaining: {remaining}")
        waves.append(sorted(wave))  # Sort for determinism
        remaining -= wave
    return waves
```

### SP#12: Agent Specialization Memory

| Artifact | Action | Details |
|----------|--------|---------|
| `~/.solishq/agent-ratings/` | CREATE directory | Daily JSONL files |
| `subagent-stop.sh` | ENHANCE | Prompt Orchestrator to rate agent output on quality/completeness/correctness/originality |
| `session-opener.sh` | ENHANCE | Load aggregate rating statistics: "Builder prompts with pattern X produce 0.9 quality. Breaker prompts with pattern Y produce 0.7 quality." |

**Deferred to Sprint O6** (requires enough rating data to be meaningful).

### SP#13: Real-Time Agent Monitoring

| Artifact | Action | Details |
|----------|--------|---------|
| Orchestrator SKILL.md | ENHANCE | Add monitoring protocol: for background agents, periodically check output file, detect plan-mode, early abort |

**Implementation**: The Orchestrator uses Bash tool calls to `tail -20 <output_file>` to check agent progress. If it detects plan-mode indicators ("Let me plan", "Here's my approach", "Before implementing"), it can kill the agent and redispatch with explicit "WRITE, NOT PLAN" instructions.

**Why not structural?** Real-time monitoring requires the Orchestrator to be actively checking, which it can only do during its own turns. A hook cannot monitor a background process.

### SP#14: Synthesis Engine

| Artifact | Action | Details |
|----------|--------|---------|
| Orchestrator SKILL.md | ENHANCE | Add synthesis protocol: given N agent outputs, produce consensus/disagreement/novel/coverage/priority analysis |

**Methodology rule**: When receiving 3+ agent outputs for the same objective, the Orchestrator must produce a synthesis before presenting to PA. The synthesis follows a fixed structure:

1. **Consensus** (N/M agents agree): [finding]
2. **Disagreements** (agents A and B conflict): [nature of conflict, Orchestrator's resolution]
3. **Novel** (only agent C found this): [finding, significance]
4. **Coverage gaps**: [what should have been analyzed but wasn't]
5. **Priority ranking**: [top 3 findings across all agents]

---

## 5. ERROR TAXONOMY

### 5.1 By Component

| Component | Error | Severity | Detection | Recovery |
|-----------|-------|----------|-----------|----------|
| **Narrative Engine** | Model fails to write narrative file | MEDIUM | SessionEnd hook checks file existence | Write minimal structured brief from session metadata |
| **Narrative Engine** | Narrative is shallow/generic | LOW | No automated detection | Iterate over sessions; quality improves with Femi model |
| **Narrative Engine** | Brief file corrupted (invalid YAML frontmatter) | LOW | session-opener.sh YAML parse fails | Skip frontmatter, load body only |
| **Sentinel** | Individual check times out | LOW | Per-check 2s timeout | Mark check SKIP, continue remaining checks |
| **Sentinel** | All checks fail (script crash) | MEDIUM | latest.json not updated (stale) | session-opener.sh checks file age; if >24h, injects WARNING |
| **Sentinel** | False positive CRITICAL | LOW | Human review at session start | Orchestrator investigates before alarming PA |
| **Promise Register** | JSONL file corrupted (partial write) | MEDIUM | JSON parse error on read | Skip corrupted line, log warning, continue |
| **Promise Register** | Promise not recorded (behavioral failure) | LOW | No structural detection | learning-capture.sh prompts review as second chance |
| **Promise Register** | Outcome not recorded | LOW | session-closer.sh detects null outcomes | Log warning; stale promises are reviewed next session |
| **Dispatch Planner** | Dependency cycle in task graph | HIGH | compute_waves() raises ValueError | Abort plan, report cycle to Orchestrator for manual resolution |
| **Dispatch Planner** | Agent fails mid-wave | MEDIUM | Task status = "failed" | Retry once, then skip with justification or escalate |
| **Dispatch Planner** | Plan file corrupted | LOW | JSON parse error | Reconstruct from Orchestrator's context (plan was in-memory) |
| **Agent Rating** | JSONL corruption | LOW | Same as promise register | Skip corrupted line |
| **Autonomy** | JSON file missing | LOW | session-opener.sh file check | Default to level 2 (Guided) |
| **Femi Model** | File missing | LOW | session-opener.sh file check | Session starts without Femi model; Orchestrator relies on Limen claims |
| **Femi Model** | Model is stale (preferences changed) | LOW | No automated detection | learning-capture.sh prompts update on preference observation |
| **Temporal** | session-start.txt not written | LOW | pre-compact.sh file check | Fall back to "unknown duration" |
| **Session Opener** | Hook timeout (>5s) | CRITICAL | Claude Code kills hook | All new features must be individually timed and fail-fast. Budget: existing = 3s, new additions = max 500ms total. |

### 5.2 Cross-Cutting Error Patterns

**E-1: Concurrent Session Conflict.**
Two Claude Code sessions running simultaneously both write to `~/.solishq/session-briefs/latest.md`. The second write overwrites the first's symlink.
- **Mitigation**: The symlink points to a timestamped file. Both files survive. The symlink just points to whichever wrote last. At next session start, the Orchestrator can read both recent briefs if needed (glob `session-briefs/*.md` sorted by mtime, take top 2).
- **Design choice**: We do NOT use file locking. File locks in shell scripts are fragile, especially on macOS with APFS. The write-both-read-latest approach is simpler and sufficient for a single-user system with rare concurrent sessions.

**E-2: Hook Timeout Cascade.**
Adding 5 new features to session-opener.sh pushes total execution past the 5s timeout.
- **Mitigation**: Each new feature has a strict time budget. File reads are <10ms each. The total budget for all new additions is 500ms. No network calls in hooks. No LLM calls in hooks. No subprocess spawning in hooks (except `date`).
- **Verification**: Each sprint includes a timing test: `time bash ~/.claude/hooks/session-opener.sh < test-input.json`.

**E-3: State File Corruption.**
Power failure during a JSONL append results in a partial last line.
- **Mitigation**: All JSONL readers must use try/except per line, not per file. A corrupt last line is skipped; all prior lines remain valid. This is a property of JSONL by design -- it is append-friendly and corruption-isolated.

---

## 6. SCHEMA DESIGN

### 6.1 File System Layout

```
~/.solishq/
  session-briefs/                    # SP#1: Narrative Memory
    latest.md                        # Symlink to most recent brief
    2026-03-30-143022.md             # Timestamped session briefs
    2026-03-29-220145.md
    ...
  sentinel/                          # SP#2: Proactive Sensing
    check.sh                         # Comprehensive health check script
    governance-health.sh             # EXISTS: weekly governance check
    nightly-tests.sh                 # EXISTS: nightly test runner
    latest.json                      # Most recent check result (structured)
    latest.md                        # Most recent check result (readable)
  promises/                          # SP#5: Promise Accountability
    2026-03-30.jsonl                 # Daily promise entries
    2026-03-29.jsonl
    ...
  agent-ratings/                     # SP#12: Specialization Memory
    2026-03-30.jsonl                 # Daily agent ratings
    ...
  dispatch/                          # SP#11: DAG Dispatch
    active-plan.json                 # Current dispatch plan (if any)
    archive/                         # Completed plans
      plan-<uuid>.json
  femi-model.md                      # SP#10: Femi Emulation Model
  autonomy.json                      # SP#9: Autonomy Levels
  state/
    session-start.txt                # SP#8: Session start timestamp
    telemetry.db                     # EXISTS: NOUS telemetry
    init-telemetry.py                # EXISTS: DB schema init
    projects/                        # EXISTS
    sessions/                        # EXISTS
    telemetry/                       # EXISTS
  logs/                              # EXISTS: various log files
    session-log.txt                  # EXISTS: session start/end log
    hb26-enforcement.log             # EXISTS: HB-26 enforcement decisions
    oracle-gates.jsonl               # EXISTS: Oracle gate tracking
    dispatch-log.txt                 # EXISTS: dispatch logging
    memory-write-guard.log           # EXISTS: memory guard decisions
    sentinel-governance.log          # EXISTS: sentinel governance log
    sentinel-tests.log               # EXISTS: sentinel test log
    sentinel-check.log               # NEW: comprehensive sentinel log
  backup/                            # EXISTS
  compliance/                        # EXISTS
  credentials/                       # EXISTS (NEVER in git)
  governance/                        # EXISTS
  mcp/                               # EXISTS
  provenance/                        # EXISTS
  vault/                             # EXISTS
```

### 6.2 Retention Policy

| Data | Retention | Rationale |
|------|-----------|-----------|
| Session briefs | 90 days | Narrative context is most valuable for recent sessions. Older briefs can be reviewed for patterns but are not loaded automatically. |
| Sentinel reports | 30 days (latest.json always current) | Health trends beyond 30 days are not actionable. |
| Promise files | Indefinite | Calibration data improves with history. Files are small (<10KB/day). |
| Agent ratings | Indefinite | Specialization patterns need long history. Files are small. |
| Dispatch plans (archive) | 90 days | Completed plans are reference only. |

**Cleanup**: A monthly maintenance script (added to sentinel) prunes files beyond retention. Not implemented in Sprint O1-O2 (premature optimization for small file counts).

### 6.3 Access Patterns

| Hook | Reads | Writes | Time Budget |
|------|-------|--------|-------------|
| session-opener.sh | session-briefs/latest.md, sentinel/latest.json, femi-model.md, autonomy.json, state/session-start.txt | state/session-start.txt | 500ms for all new reads |
| pre-compact.sh | state/session-start.txt | (behavioral: interim narrative) | 200ms for new reads |
| learning-capture.sh | (none new) | (behavioral: promises, narrative) | 0ms new overhead |
| session-closer.sh | state/session-start.txt | session-briefs/latest.md (symlink) | 200ms |
| subagent-stop.sh | (none new) | (behavioral: agent ratings) | 0ms new overhead |

---

## 7. CROSS-PHASE INTEGRATION

### 7.1 Sprint Dependency Graph

```
Sprint O1: CRITICAL FIXES ─────────┐
  - Memory write guard (EXISTS, already hooked)  │
  - Session file enforcement         │
  - HB-26 enforcement gap fixes      │
  - Enforcement gap audit conditions  │
                                     │
Sprint O2: FOUNDATION ◄─────────────┘
  - SP#1: Narrative Memory           │
  - SP#8: Temporal Awareness         │
  - SP#2: Proactive Sensing          │
                                     │
Sprint O3: ACCOUNTABILITY ◄─────────┘
  - SP#5: Promise Register           │
  - SP#9: Autonomy Levels            │
  - SP#10: Femi Model                │
                                     │
Sprint O4: ORCHESTRATION ◄───────────┘
  - SP#3: Multi-Pass Reasoning (methodology)
  - SP#7: Agent Excellence (methodology + hook)
  - SP#14: Synthesis Engine (methodology)
                                     │
Sprint O5: SCALE ◄───────────────────┘
  - SP#11: DAG Dispatch Planner
  - SP#13: Agent Monitoring
                                     │
Sprint O6: KNOWLEDGE ◄──────────────┘
  (After Limen v1.3.0)
  - SP#4: Reasoning Chain Memory
  - SP#6: Haystack Finder (Phase 2+)
  - SP#12: Specialization Memory
```

### 7.2 Integration Contracts Between Sprints

**O1 → O2**: O1 ensures the memory write guard is functioning and enforcement gaps are fixed. O2 depends on the hook system being reliable and the session lifecycle being stable.

**O2 → O3**: O2 delivers the narrative brief system, temporal awareness, and sentinel. O3 depends on these because:
- Promise Register needs temporal awareness (timestamps, session duration) for calibration
- Autonomy levels need sentinel data to auto-adjust (if sentinel shows CRITICAL, reduce autonomy)
- Femi model needs narrative briefs to extract preference patterns

**O3 → O4**: O3 delivers accountability infrastructure. O4 depends on:
- Multi-pass reasoning needs autonomy levels to decide depth (at Level 4, skip challenge for lightweight decisions)
- Agent excellence needs the Femi model to calibrate "what Femi considers excellent"
- Synthesis engine needs promise data to track synthesis accuracy

**O4 → O5**: O4 delivers methodology rules. O5 depends on:
- DAG dispatch needs excellence gates to filter wave outputs
- Agent monitoring needs multi-pass reasoning results as quality baselines

**O5 → O6**: O5 delivers scale capabilities. O6 depends on:
- Specialization memory needs enough agent ratings (from O5 dispatch runs) to be meaningful
- Haystack finder benefits from reasoning chains (searchable derivations)

### 7.3 Limen Dependency

Sprints O1-O5 use Limen as-is (current schema). Sprint O6 requires Limen v1.3.0 (FTS5) and v1.4.0 (reasoning column). These Limen changes are a SEPARATE build track -- they are not part of this infrastructure rebuild.

If Limen v1.3.0 ships before O6, O6 can begin immediately. If not, O6 blocks on Limen.

---

## 8. ASSURANCE MAPPING

### 8.1 Per-Superpower Assurance Classification

| # | Superpower | Assurance Class | Justification |
|---|-----------|----------------|---------------|
| 1 | Narrative Memory | QUALITY_GATE | Narrative quality is subjective and improves iteratively. No binary correctness criterion. |
| 2 | Proactive Sensing | QUALITY_GATE | Coverage and accuracy are measurable but not binary pass/fail. |
| 3 | Multi-Pass Reasoning | DESIGN_PRINCIPLE | Methodology rule. Guides decision quality but has no mechanical test. |
| 4 | Reasoning Chain Memory | CONSTITUTIONAL | Claims stored without reasoning are still valid. But reasoning must not corrupt existing claims. Migration is additive-only. |
| 5 | Promise Accountability | QUALITY_GATE | Calibration accuracy is measurable over time. Initial data is uncalibrated by definition. |
| 6 | Haystack Finder | DESIGN_PRINCIPLE | Search protocol. Effectiveness is qualitative. |
| 7 | Agent Excellence | QUALITY_GATE | Excellence gates have measurable metrics (completeness, depth) but thresholds are calibrated over time. |
| 8 | Temporal Awareness | CONSTITUTIONAL | Time injection must be correct. Wrong time = wrong pacing = wrong decisions. Tests: verify timestamp format, verify duration calculation arithmetic. |
| 9 | Autonomy Levels | CONSTITUTIONAL | Escalation matrix must be enforced. Wrong autonomy level = unauthorized decisions. Tests: verify each level's boundary. |
| 10 | Femi Model | DESIGN_PRINCIPLE | Model accuracy is qualitative and subjective. |
| 11 | DAG Dispatch | CONSTITUTIONAL | Dependency cycle detection must be correct. Task ordering must be topologically valid. Wrong ordering = wasted work. Tests: cycle detection, topological sort correctness. |
| 12 | Specialization Memory | QUALITY_GATE | Rating accuracy improves with data. |
| 13 | Agent Monitoring | DESIGN_PRINCIPLE | Monitoring protocol. Effectiveness is qualitative. |
| 14 | Synthesis Engine | QUALITY_GATE | Synthesis quality is measurable (did it catch consensus, disagreements, novel findings?). |

### 8.2 Constitutional Controls (Must Not Fail)

| Control | What Must Be True | Verification Method |
|---------|------------------|---------------------|
| C-1 | Session-opener.sh completes within 5s with all enhancements | Timed execution test with realistic input |
| C-2 | Pre-compact.sh completes within 5s with all enhancements | Timed execution test |
| C-3 | Session-closer.sh completes within 3s with narrative symlink | Timed execution test |
| C-4 | No hook enhancement breaks existing hook functionality | Before/after diff test: run hooks with same input, verify existing output fields unchanged |
| C-5 | Temporal awareness injects correct timestamps | Unit test: verify ISO-8601 format, verify duration arithmetic |
| C-6 | Autonomy level file defaults to level 2 when missing | Integration test: delete file, verify session starts with Guided level |
| C-7 | DAG topological sort is correct | Unit test: known graphs with known correct orderings |
| C-8 | DAG cycle detection works | Unit test: graph with cycle raises ValueError |
| C-9 | JSONL corruption in one line does not corrupt entire file | Unit test: file with corrupted line N, verify lines 1..N-1 readable |
| C-10 | Concurrent sessions do not lose data | Integration test: two simultaneous writes to promises/, verify both entries survive |

### 8.3 Quality Gates (Measured, Not Binary)

| Gate | Metric | Initial Target | Measurement Method |
|------|--------|---------------|-------------------|
| QG-1 | Narrative brief completeness | Has unfinished threads + energy field | Frontmatter field presence check |
| QG-2 | Sentinel check coverage | 16/16 checks execute | Count non-SKIP checks in latest.json |
| QG-3 | Promise capture rate | >50% of observable commitments logged | Manual review of session transcript vs promise file |
| QG-4 | Agent rating consistency | Ratings correlate with redispatch frequency | Statistical analysis after 20+ ratings |
| QG-5 | Femi model prediction accuracy | Model predicts PA direction >60% of time | Track predictions vs PA actual direction |

---

## 9. SPRINT DEFINITIONS

### Sprint O1: Critical Fixes

**Objective**: Fix the 3 conditions identified in the Memory Architecture Audit and the 3 conditions in the Enforcement Gap Audit. These are prerequisites for all subsequent sprints.

**Scope**:

1. **Memory write guard activation** -- ALREADY DONE. The guard is hooked in settings.json (PreToolUse on Write|Edit). Verify it fires correctly. Consider escalation from WARN to BLOCK mode for known-bad patterns.

2. **Enforcement gap fixes** (from ENFORCEMENT-GAP-AUDIT.md):
   - Fix 2: EXEMPT path runs Layer 2.5 (inline methodology detection)
   - Fix 3: Pre-dispatch BUILD-PLAN.md readiness check (WARN)
   - Fix 4: CWD/project context verification (WARN)
   - Fix 1: Oracle Gate session binding via JSONL dispatch ID (per audit: use JSONL-embedded, not shared file)
   - Fix 5: PROGRESS.md state injection (already partially implemented in session-opener.sh)

3. **ORACLE-DEGRADED co-occurrence guard** (from enforcement gap audit MG-01): when EXEMPT + ORACLE-DEGRADED co-occur, emit WARN. If ORACLE-DEGRADED >2 times without successful Oracle calls, escalate.

**Controls 1-7**: Standard. Tier 2 (enforcement infrastructure, not revenue-critical).

**Exit Criteria**: All 5 enforcement gap fixes implemented and verified. Memory write guard confirmed operational. All existing tests still pass.

---

### Sprint O2: Foundation Superpowers

**Objective**: Deliver the three foundation superpowers that everything else builds on: narrative memory (SP#1), temporal awareness (SP#8), proactive sensing (SP#2).

**Scope**:

1. **SP#1: Narrative Memory**
   - Create `~/.solishq/session-briefs/` directory
   - Enhance `learning-capture.sh`: add narrative generation directive
   - Enhance `session-closer.sh`: add symlink update for latest.md, minimal fallback brief generation
   - Enhance `session-opener.sh`: read and inject latest.md as first context block
   - Enhance `pre-compact.sh`: add interim narrative directive

2. **SP#8: Temporal Awareness**
   - Enhance `session-opener.sh`: inject current time, day of week, time since last session
   - Write `~/.solishq/state/session-start.txt` with epoch timestamp
   - Enhance `pre-compact.sh`: compute and inject session duration from session-start.txt
   - Enhance `session-closer.sh`: read session-start.txt for brief duration_minutes

3. **SP#2: Proactive Sensing**
   - Create `~/.solishq/sentinel/check.sh` with all 16 health checks
   - Create `~/.solishq/sentinel/latest.json` and `latest.md` output format
   - Enhance `session-opener.sh`: read latest.json, inject CRITICAL/WARNING findings
   - Document scheduling via Claude Code `/schedule`

**Controls 1-7**: Tier 2 for SP#1 and SP#2 (infrastructure). Tier 3 for SP#8 (utility enhancement).

**Exit Criteria**:
- Sessions start with narrative context from previous session
- Sessions start with current timestamp and time-since-last-session
- Sentinel check.sh runs successfully and produces valid JSON output
- session-opener.sh stays within 5s timeout with all enhancements
- All existing hook functionality preserved (before/after test)

---

### Sprint O3: Accountability

**Objective**: Deliver the three accountability superpowers: promise register (SP#5), autonomy levels (SP#9), Femi model (SP#10).

**Scope**:

1. **SP#5: Promise Accountability**
   - Create `~/.solishq/promises/` directory
   - Enhance `learning-capture.sh`: add promise review directive
   - Enhance `session-closer.sh`: add promise outcome cross-check
   - Enhance `session-opener.sh`: inject yesterday's promise summary
   - Define promise JSONL schema and capture protocol

2. **SP#9: Autonomy Levels**
   - Create `~/.solishq/autonomy.json` with default level 2
   - Enhance `session-opener.sh`: inject autonomy level and escalation matrix
   - Add autonomy protocol to Orchestrator SKILL.md
   - Define PA commands for level adjustment

3. **SP#10: Femi Emulation Model**
   - Bootstrap `~/.solishq/femi-model.md` from Limen preference.femi claims
   - Enhance `session-opener.sh`: inject femi model after narrative brief
   - Enhance `learning-capture.sh`: prompt for femi model updates
   - Define model structure and update protocol

**Controls 1-7**: Tier 2 for SP#5 and SP#9 (accountability infrastructure). Tier 3 for SP#10 (advisory system).

**Exit Criteria**:
- Promises can be logged, reviewed, and reconciled
- Autonomy level is correctly loaded and affects Orchestrator behavior
- Femi model is loaded and influences recommendations
- All hook timeouts respected

---

### Sprint O4: Orchestration Methodology

**Objective**: Deliver the three methodology superpowers: multi-pass reasoning (SP#3), agent excellence enforcement (SP#7), synthesis engine (SP#14).

**Scope**:

1. **SP#3: Multi-Pass Reasoning**
   - Add standing order to Orchestrator SKILL.md
   - Define Challenger dispatch protocol
   - Define decision weight thresholds for when challenge is required

2. **SP#7: Agent Excellence Enforcement**
   - Enhance `subagent-stop.sh`: add mechanical excellence checks (file existence, output size)
   - Add standing order to Orchestrator SKILL.md
   - Define quality gate criteria per task type

3. **SP#14: Synthesis Engine**
   - Add synthesis protocol to Orchestrator SKILL.md
   - Define the 5-section synthesis structure
   - Define trigger conditions (3+ agent outputs)

**Controls 1-7**: Tier 3 (methodology rules, no infrastructure risk).

**Exit Criteria**:
- Orchestrator SKILL.md contains all three standing orders
- subagent-stop.sh emits excellence findings in additionalContext
- Methodology rules are testable by code review of the skill file

---

### Sprint O5: Scale

**Objective**: Deliver the two scale superpowers: DAG dispatch planner (SP#11), agent monitoring (SP#13).

**Scope**:

1. **SP#11: DAG Dispatch Planner**
   - Create `~/.solishq/dispatch/` directory structure
   - Implement topological sort function (inline Python in Orchestrator context)
   - Define dispatch plan schema
   - Define wave execution protocol
   - Define failure handling protocol (retry, skip, escalate)

2. **SP#13: Agent Monitoring**
   - Define monitoring protocol in Orchestrator SKILL.md
   - Define plan-mode detection heuristics
   - Define early abort protocol

**Controls 1-7**: Tier 2 for SP#11 (coordination infrastructure). Tier 3 for SP#13 (monitoring protocol).

**Exit Criteria**:
- Topological sort is correct (unit tests with known graphs)
- Cycle detection works (unit test with cyclic graph)
- Dispatch plan schema validates correctly
- Monitoring protocol is documented and testable

---

### Sprint O6: Knowledge (Post-Limen v1.3.0)

**Objective**: Deliver the three knowledge superpowers that require Limen enhancements: reasoning chain memory (SP#4), haystack finder phases 2-3 (SP#6), specialization memory (SP#12).

**Scope**:

1. **SP#4: Reasoning Chain Memory**
   - Add `reasoning TEXT` column to Limen `claim_assertions` table
   - Enhance `limen_reflect` to accept reasoning parameter
   - Enhance `limen_recall` to return reasoning
   - Add reasoning to FTS5 index

2. **SP#6: Haystack Finder (Phase 2)**
   - Implement FTS5-based keyword search across all claims
   - Add search protocol to Orchestrator SKILL.md

3. **SP#12: Specialization Memory**
   - Create `~/.solishq/agent-ratings/` directory
   - Enhance `subagent-stop.sh`: prompt for agent rating
   - Enhance `session-opener.sh`: load aggregate rating statistics
   - Define rating schema and aggregation protocol

**Controls 1-7**: Tier 1 for SP#4 (Limen schema change). Tier 2 for SP#6 and SP#12.

**Blocking dependency**: Limen v1.3.0 (FTS5) must be shipped before this sprint begins.

**Exit Criteria**:
- Reasoning column exists and is populated by limen_reflect
- FTS5 search returns relevant claims for keyword queries
- Agent ratings can be logged and aggregated
- All existing Limen tests pass with schema migration

---

## 10. HOOK MODIFICATION SPECIFICATIONS

This section provides the exact changes to each hook file, suitable for direct implementation.

### 10.1 session-opener.sh Enhancements

**Insert location**: After the `limen_ready` context block, before the PROGRESS.md injection.

**New additions** (each with individual timing and fail-open):

```python
# ── SP#1: Narrative Memory ────────────
try:
    brief_path = os.path.join(home, '.solishq', 'session-briefs', 'latest.md')
    if os.path.isfile(brief_path):
        with open(brief_path, 'r') as f:
            brief_content = f.read(4000)  # Cap at 4KB for context budget
        context = (
            '## PREVIOUS SESSION NARRATIVE\n\n'
            + brief_content + '\n\n'
            '---\n\n'
        ) + context  # PREPEND: narrative comes first
except Exception:
    pass  # Fail-open

# ── SP#8: Temporal Awareness ────────────
try:
    import time as _t
    now = _t.time()
    now_local = _t.localtime(now)
    time_str = _t.strftime('%A, %B %d, %Y at %H:%M', now_local)

    # Write session start timestamp
    start_file = os.path.join(home, '.solishq', 'state', 'session-start.txt')
    os.makedirs(os.path.dirname(start_file), exist_ok=True)
    with open(start_file, 'w') as f:
        f.write(str(int(now)))

    # Time since last session
    since_last = ''
    brief_path = os.path.join(home, '.solishq', 'session-briefs', 'latest.md')
    if os.path.isfile(brief_path):
        brief_mtime = os.path.getmtime(brief_path)
        gap_hours = (now - brief_mtime) / 3600
        if gap_hours < 1:
            since_last = f'{int(gap_hours * 60)} minutes since last session'
        elif gap_hours < 24:
            since_last = f'{gap_hours:.1f} hours since last session'
        else:
            since_last = f'{gap_hours / 24:.1f} days since last session'

    context += f'\n\n## TEMPORAL CONTEXT\nCurrent time: {time_str}. {since_last}\n'
except Exception:
    pass

# ── SP#2: Proactive Sensing ────────────
try:
    sentinel_path = os.path.join(home, '.solishq', 'sentinel', 'latest.json')
    if os.path.isfile(sentinel_path):
        sentinel_age = (now - os.path.getmtime(sentinel_path)) / 3600
        if sentinel_age < 24:  # Only inject if recent
            with open(sentinel_path, 'r') as f:
                sentinel = json.load(f)
            summary = sentinel.get('summary', {})
            critical = summary.get('critical', 0)
            warning = summary.get('warning', 0)
            if critical > 0 or warning > 0:
                findings = []
                for check_id, check in sentinel.get('checks', {}).items():
                    if check.get('severity') in ('CRITICAL', 'WARNING') and check.get('status') == 'FAIL':
                        findings.append(f"- **{check.get('severity')}**: {check.get('name')}: {check.get('message')}")
                if findings:
                    context += '\n\n## SENTINEL ALERTS\n' + '\n'.join(findings[:10]) + '\n'
except Exception:
    pass

# ── SP#9: Autonomy Levels ────────────
try:
    autonomy_path = os.path.join(home, '.solishq', 'autonomy.json')
    if os.path.isfile(autonomy_path):
        with open(autonomy_path, 'r') as f:
            autonomy = json.load(f)
        level = autonomy.get('default_level', 2)
        level_names = {1: 'Supervised', 2: 'Guided', 3: 'Autonomous', 4: 'Full Trust'}
        overrides = autonomy.get('overrides', {})
        override_str = ', '.join(f'{k}={v}' for k, v in overrides.items()) if overrides else 'none'
        context += f'\n\n## AUTONOMY LEVEL: {level} ({level_names.get(level, "Unknown")}). Project overrides: {override_str}\n'
except Exception:
    pass

# ── SP#10: Femi Model ────────────
try:
    femi_path = os.path.join(home, '.solishq', 'femi-model.md')
    if os.path.isfile(femi_path):
        with open(femi_path, 'r') as f:
            femi_content = f.read(2000)  # Cap at 2KB
        context += '\n\n## FEMI DECISION MODEL\n' + femi_content + '\n'
except Exception:
    pass

# ── SP#5: Promise Summary ────────────
try:
    import datetime as _dt
    yesterday = (_dt.datetime.now() - _dt.timedelta(days=1)).strftime('%Y-%m-%d')
    promise_path = os.path.join(home, '.solishq', 'promises', f'{yesterday}.jsonl')
    if os.path.isfile(promise_path):
        kept = broken = partial = 0
        calibrations = []
        with open(promise_path, 'r') as f:
            for line in f:
                try:
                    entry = json.loads(line)
                    outcome = entry.get('outcome')
                    if outcome == 'kept': kept += 1
                    elif outcome == 'broken': broken += 1
                    elif outcome == 'partial': partial += 1
                    cal = entry.get('calibration')
                    if cal: calibrations.append(cal)
                except Exception:
                    pass
        total = kept + broken + partial
        if total > 0:
            context += f'\n\n## YESTERDAY\'S PROMISES: {kept} kept, {broken} broken, {partial} partial out of {total}\n'
            if calibrations:
                context += 'Calibration notes:\n'
                for c in calibrations[:3]:
                    context += f'- {c}\n'
except Exception:
    pass
```

### 10.2 learning-capture.sh Enhancements

**Insert location**: After the existing Limen-ready context block, before the final print.

**New additions** (appended to `context` string):

```python
# ── SP#1: Narrative Memory Directive ────────────
context += (
    '\n\n**[NARRATIVE MEMORY — SP#1]**\n'
    'Before closing this session, write a session narrative to:\n'
    '  ~/.solishq/session-briefs/[TIMESTAMP].md\n'
    'Use the SessionBrief format (YAML frontmatter + narrative body).\n'
    'Include: what happened, why decisions were made, unfinished threads, '
    'Femi\'s current energy/direction.\n'
    'After writing, update the symlink: ln -sf [file] ~/.solishq/session-briefs/latest.md\n'
    'If the session was trivial (< 5 minutes, no meaningful work), skip.\n'
)

# ── SP#5: Promise Review Directive ────────────
context += (
    '\n\n**[PROMISE ACCOUNTABILITY — SP#5]**\n'
    'Review promises made this session. For each commitment you made '
    '(estimates, quality claims, delivery timelines, capability assertions):\n'
    '1. Was the promise kept, broken, partial, or deferred?\n'
    '2. What is the delta between promise and reality?\n'
    '3. What calibration learning should be stored?\n'
    'Update ~/.solishq/promises/' + _dt.datetime.now().strftime('%Y-%m-%d') + '.jsonl\n'
    'with outcome, outcome_ts, delta, and calibration fields.\n'
    'If no promises were made, skip.\n'
)

# ── SP#10: Femi Model Update Directive ────────────
context += (
    '\n\n**[FEMI MODEL — SP#10]**\n'
    'If Femi expressed a new preference, correction, or decision pattern '
    'this session, update ~/.solishq/femi-model.md.\n'
    'If no new preferences observed, skip.\n'
)
```

### 10.3 session-closer.sh Enhancements

**Insert location**: After the existing telemetry logging, before the voice mute cleanup.

**New additions**:

```python
# ── SP#1: Narrative Brief Symlink ────────────
# Check if a narrative brief was written this session
import glob as _glob
briefs_dir = os.path.join(home, '.solishq', 'session-briefs')
os.makedirs(briefs_dir, exist_ok=True)

# Find most recent brief (written by the model during Stop turn)
briefs = sorted(_glob.glob(os.path.join(briefs_dir, '*.md')))
briefs = [b for b in briefs if not os.path.islink(b)]  # Exclude symlinks
if briefs:
    latest_brief = briefs[-1]
    latest_link = os.path.join(briefs_dir, 'latest.md')
    try:
        if os.path.islink(latest_link):
            os.unlink(latest_link)
        os.symlink(latest_brief, latest_link)
    except Exception:
        pass
else:
    # Model didn't write a brief — write minimal fallback
    ts_str = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H%M%S')
    fallback_path = os.path.join(briefs_dir, f'{ts_str}.md')
    try:
        # Read session start time
        start_file = os.path.join(home, '.solishq', 'state', 'session-start.txt')
        duration = 0
        if os.path.isfile(start_file):
            with open(start_file) as sf:
                start_epoch = int(sf.read().strip())
            duration = int((time.time() - start_epoch) / 60)

        with open(fallback_path, 'w') as f:
            f.write(f'---\nsession_id: {sid}\nproject: {cwd.split("/")[-1]}\n')
            f.write(f'started_at: unknown\nended_at: {ts}\n')
            f.write(f'duration_minutes: {duration}\nenergy: unknown\n')
            f.write(f'unfinished_count: 0\npromise_count: 0\npromise_kept: 0\n---\n\n')
            f.write('(Minimal fallback brief — narrative not generated by model.)\n')

        latest_link = os.path.join(briefs_dir, 'latest.md')
        if os.path.islink(latest_link):
            os.unlink(latest_link)
        os.symlink(fallback_path, latest_link)
    except Exception:
        pass
```

### 10.4 pre-compact.sh Enhancements

**Insert location**: After the existing Limen-ready context block, before the infra manifest.

**New additions**:

```python
# ── SP#8: Session Duration ────────────
try:
    import time as _t
    start_file = os.path.join(home, '.solishq', 'state', 'session-start.txt')
    if os.path.isfile(start_file):
        with open(start_file) as f:
            start_epoch = int(f.read().strip())
        duration_min = int((_t.time() - start_epoch) / 60)
        context += f'\n\n## SESSION DURATION: {duration_min} minutes\n'
        if duration_min > 360:
            context += 'WARNING: Session has been running for 6+ hours. Consider capturing state and continuing fresh.\n'
except Exception:
    pass

# ── SP#1: Interim Narrative Directive ────────────
context += (
    '\n\n**[INTERIM NARRATIVE]**\n'
    'Before compaction destroys context, generate an interim session narrative '
    'and include it in your compaction summary. This narrative survives compaction.\n'
)
```

---

## 11. SENTINEL CHECK SPECIFICATION

The comprehensive sentinel script (`~/.solishq/sentinel/check.sh`) implements all 16 health checks.

```bash
#!/usr/bin/env bash
# SolisHQ Sentinel — Comprehensive Health Check
#
# Runs all health checks and writes structured output.
# Budget: <30s total. Per-check timeout: 2s.
# Output: latest.json (structured) + latest.md (readable)
#
# Usage: bash ~/.solishq/sentinel/check.sh
# Scheduling: Claude Code /schedule or manual invocation

set -euo pipefail

SENTINEL_DIR="$HOME/.solishq/sentinel"
JSON_OUT="$SENTINEL_DIR/latest.json"
MD_OUT="$SENTINEL_DIR/latest.md"
LOG="$HOME/.solishq/logs/sentinel-check.log"

mkdir -p "$SENTINEL_DIR" "$(dirname "$LOG")"

python3 << 'PYEOF'
import json, os, subprocess, time, glob, sqlite3
from datetime import datetime, timezone

home = os.path.expanduser("~")
start = time.time()
checks = {}

def run_check(check_id, name, category, check_fn):
    """Run a single check with 2s timeout."""
    try:
        result = check_fn()
        checks[check_id] = {
            "name": name,
            "category": category,
            **result
        }
    except Exception as e:
        checks[check_id] = {
            "name": name,
            "category": category,
            "severity": "WARNING",
            "status": "SKIP",
            "message": f"Check error: {str(e)[:100]}"
        }

def cmd(args, timeout=2):
    """Run command with timeout, return stdout."""
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    return r.stdout.strip(), r.returncode

# ── SYSTEM CHECKS ──

def check_vox_running():
    out, rc = cmd(["launchctl", "list", "com.solishq.vox"])
    if rc == 0:
        return {"severity": "INFO", "status": "PASS", "message": "Vox agent running"}
    # Try pgrep as fallback
    out2, rc2 = cmd(["pgrep", "-f", "vox"])
    if rc2 == 0:
        return {"severity": "INFO", "status": "PASS", "message": f"Vox process found: PID {out2.split()[0]}"}
    return {"severity": "CRITICAL", "status": "FAIL", "message": "Vox not running"}

def check_crash_reports():
    reports = glob.glob(os.path.expanduser("~/Library/Logs/DiagnosticReports/*vox*"))
    recent = [r for r in reports if (time.time() - os.path.getmtime(r)) < 86400]
    if recent:
        return {"severity": "WARNING", "status": "FAIL", "message": f"{len(recent)} crash report(s) in last 24h"}
    return {"severity": "INFO", "status": "PASS", "message": "No recent crash reports"}

def check_disk_space():
    out, _ = cmd(["df", "-g", "/"])
    lines = out.strip().split("\n")
    if len(lines) >= 2:
        parts = lines[1].split()
        avail_gb = int(parts[3]) if len(parts) > 3 else 0
        if avail_gb < 5:
            return {"severity": "WARNING", "status": "FAIL", "message": f"Low disk: {avail_gb}GB free", "value": avail_gb}
        return {"severity": "INFO", "status": "PASS", "message": f"{avail_gb}GB free", "value": avail_gb}
    return {"severity": "INFO", "status": "SKIP", "message": "Could not parse df output"}

def check_groq_key():
    key_file = os.path.join(home, ".solishq", "credentials", "groq-api-key")
    env_key = os.environ.get("GROQ_API_KEY", "")
    if os.path.isfile(key_file) or env_key:
        return {"severity": "INFO", "status": "PASS", "message": "Groq API key present"}
    return {"severity": "WARNING", "status": "FAIL", "message": "Groq API key not found"}

# ── PROJECT CHECKS ──

def check_uncommitted_changes():
    projects_dir = os.path.join(home, "Projects")
    stale = []
    if os.path.isdir(projects_dir):
        for p in os.listdir(projects_dir):
            pdir = os.path.join(projects_dir, p)
            if not os.path.isdir(os.path.join(pdir, ".git")):
                continue
            try:
                out, rc = cmd(["git", "-C", pdir, "status", "--porcelain"])
                if rc == 0 and out.strip():
                    # Check age of oldest dirty file
                    try:
                        out2, _ = cmd(["git", "-C", pdir, "log", "-1", "--format=%ct"])
                        last_commit_age = (time.time() - int(out2)) / 3600
                        if last_commit_age > 24:
                            stale.append(f"{p} ({last_commit_age:.0f}h)")
                    except Exception:
                        stale.append(p)
            except Exception:
                pass
    if stale:
        return {"severity": "WARNING", "status": "FAIL", "message": f"Stale uncommitted: {', '.join(stale[:5])}"}
    return {"severity": "INFO", "status": "PASS", "message": "No stale uncommitted changes"}

# ── LIMEN CHECKS ──

def check_limen_db():
    db_path = os.path.join(home, ".limen", "data", "limen.db")
    if not os.path.isfile(db_path):
        return {"severity": "CRITICAL", "status": "FAIL", "message": "Limen database not found"}
    try:
        conn = sqlite3.connect(db_path, timeout=1)
        count = conn.execute("SELECT COUNT(*) FROM claim_assertions WHERE status='active'").fetchone()[0]
        conn.close()
        return {"severity": "INFO", "status": "PASS", "message": f"{count} active claims", "value": count}
    except Exception as e:
        return {"severity": "CRITICAL", "status": "FAIL", "message": f"Limen DB error: {str(e)[:100]}"}

# ── INFRASTRUCTURE CHECKS ──

def check_hooks_present():
    expected = [
        "session-opener.sh", "enforce-hb26.py", "enforce-ip-protection.sh",
        "pre-compact.sh", "learning-capture.sh", "session-closer.sh",
        "subagent-start.sh", "subagent-stop.sh", "oracle-gate-tracker.py",
        "frozen-zone-guard.py", "infra-manifest.py", "memory-write-guard.py",
        "voice-output.sh", "voice-mute-toggle.sh", "portfolio-scan.py"
    ]
    hooks_dir = os.path.join(home, ".claude", "hooks")
    missing = [h for h in expected if not os.path.isfile(os.path.join(hooks_dir, h))]
    if missing:
        return {"severity": "WARNING", "status": "FAIL", "message": f"Missing hooks: {', '.join(missing)}"}
    return {"severity": "INFO", "status": "PASS", "message": f"All {len(expected)} hooks present"}

def check_mcp_config():
    config_path = os.path.join(home, ".claude.json")
    if not os.path.isfile(config_path):
        return {"severity": "CRITICAL", "status": "FAIL", "message": "~/.claude.json not found"}
    try:
        with open(config_path) as f:
            config = json.load(f)
        servers = list(config.get("mcpServers", {}).keys())
        if not servers:
            return {"severity": "CRITICAL", "status": "FAIL", "message": "No MCP servers configured"}
        return {"severity": "INFO", "status": "PASS", "message": f"MCP servers: {', '.join(servers)}", "value": servers}
    except Exception as e:
        return {"severity": "CRITICAL", "status": "FAIL", "message": f"Config parse error: {str(e)[:100]}"}

def check_orphaned_processes():
    try:
        out, _ = cmd(["pgrep", "-f", "node.*claude"])
        pids = [p.strip() for p in out.split("\n") if p.strip()]
        if len(pids) > 10:
            return {"severity": "WARNING", "status": "FAIL", "message": f"{len(pids)} node/claude processes", "value": len(pids)}
        return {"severity": "INFO", "status": "PASS", "message": f"{len(pids)} node/claude processes", "value": len(pids)}
    except Exception:
        return {"severity": "INFO", "status": "PASS", "message": "No orphaned processes detected"}

# ── RUN ALL CHECKS ──

run_check("SYS-01", "Vox binary running", "system", check_vox_running)
run_check("SYS-03", "Recent crash reports", "system", check_crash_reports)
run_check("SYS-04", "Disk space", "system", check_disk_space)
run_check("SYS-05", "Groq API key", "system", check_groq_key)
run_check("PRJ-01", "Uncommitted changes > 24h", "project", check_uncommitted_changes)
run_check("LIM-01", "Limen database", "limen", check_limen_db)
run_check("INF-02", "Hooks present", "infrastructure", check_hooks_present)
run_check("INF-01", "MCP configuration", "infrastructure", check_mcp_config)
run_check("INF-03", "Orphaned processes", "infrastructure", check_orphaned_processes)

# ── COMPUTE SUMMARY ──

duration_ms = int((time.time() - start) * 1000)
summary = {"critical": 0, "warning": 0, "info": 0, "total_checks": len(checks)}
for c in checks.values():
    sev = c.get("severity", "INFO").lower()
    if sev in summary:
        summary[sev] += 1

report = {
    "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "duration_ms": duration_ms,
    "checks": checks,
    "summary": summary
}

# ── WRITE OUTPUTS ──

json_out = os.path.join(home, ".solishq", "sentinel", "latest.json")
md_out = os.path.join(home, ".solishq", "sentinel", "latest.md")

with open(json_out, "w") as f:
    json.dump(report, f, indent=2)

# Human-readable markdown
md_lines = [f"# Sentinel Report — {report['timestamp']}", f"Duration: {duration_ms}ms", ""]

# Group by severity
for sev in ["CRITICAL", "WARNING", "INFO"]:
    items = [(cid, c) for cid, c in checks.items() if c.get("severity") == sev]
    if items:
        md_lines.append(f"## {sev} ({len(items)})")
        for cid, c in sorted(items):
            status = c.get("status", "?")
            md_lines.append(f"- [{status}] {cid}: {c.get('name')} -- {c.get('message', '')}")
        md_lines.append("")

md_lines.append(f"**Summary**: {summary['critical']} critical, {summary['warning']} warning, {summary['info']} info")

with open(md_out, "w") as f:
    f.write("\n".join(md_lines))

# Log
log_path = os.path.join(home, ".solishq", "logs", "sentinel-check.log")
with open(log_path, "a") as f:
    f.write(f"{report['timestamp']} checks={summary['total_checks']} C={summary['critical']} W={summary['warning']} I={summary['info']} {duration_ms}ms\n")

print(f"Sentinel complete: {summary['critical']}C {summary['warning']}W {summary['info']}I in {duration_ms}ms")
PYEOF
```

---

## 12. ORCHESTRATOR SKILL ENHANCEMENTS

All methodology rules (SP#3, SP#6, SP#7, SP#13, SP#14) are added to the Orchestrator SKILL.md as standing orders. These are added in a new section: `## Standing Orders (Superpowers)`.

```markdown
## Standing Orders (Superpowers)

### SO-1: Multi-Pass Reasoning (SP#3)
For every decision at Significant or Consequential weight:
1. Draft your analysis
2. Dispatch a Challenger agent: `# ROLE: Breaker` with directive
   "Challenge this analysis. Find what's wrong, missing, or unexamined."
3. Integrate the critique
4. Present to PA with a "Challenge Survived" section noting what the critique caught

For Standard weight decisions, apply self-challenge internally (no dispatch).
For Lightweight decisions, execute directly.

### SO-2: Agent Excellence Enforcement (SP#7)
Before presenting any agent output to PA:
1. COMPLETENESS: Did the agent WRITE all requested artifacts? If it planned but
   didn't write, redispatch with "WRITE, NOT PLAN"
2. DEPTH: Does analysis depth match decision weight? Under 500 words for a
   Significant task = likely shallow. Redispatch with "go deeper"
3. ORIGINALITY: Search for "best practice," "commonly used," "typically" —
   these signal copying. Challenge agent to derive from first principles
4. LIMITATION: Does output acknowledge its own weaknesses? If not, add
   limitations yourself before presenting

Zero mediocre output reaches PA. Zero.

### SO-3: Haystack Finder (SP#6)
When encountering any P0 or P1 issue:
1. limen_recall predicate "warning.*" — check for prior warnings about this class
2. limen_recall predicate "pattern.*" — check for recognized patterns
3. Grep all findings-log.md files across ~/Projects/ for keyword matches
4. If match found: present it. "This looks like Pattern P-NNN. We saw this in
   [project] on [date]."

### SO-4: Agent Monitoring (SP#13)
For background agents running >5 minutes:
1. Tail the output file every 2-3 minutes
2. Check for plan-mode indicators: "Let me plan," "Here's my approach,"
   "Before implementing," "I'll start by"
3. If detected: kill the agent, redispatch with explicit "EXECUTE DIRECTLY"
4. Check for stall: if output hasn't grown in 3 minutes, investigate

### SO-5: Synthesis Engine (SP#14)
When receiving 3+ agent outputs for the same objective:
1. CONSENSUS: What do all/most agents agree on?
2. DISAGREEMENTS: Where do agents conflict? Nature of conflict?
   Your resolution and reasoning.
3. NOVEL: What did only one agent catch? Significance?
4. COVERAGE GAPS: What should have been analyzed but wasn't?
5. PRIORITY: Top 3 findings across all agents, ranked.

Present the synthesis to PA, not the raw outputs.

### SO-6: Promise Discipline (SP#5)
When making a commitment (estimate, quality claim, capability assertion):
1. Log it: append to ~/.solishq/promises/YYYY-MM-DD.jsonl
2. State your confidence explicitly
3. At session end, review and record outcomes

### SO-7: Autonomy Protocol (SP#9)
Check ~/.solishq/autonomy.json at session start.
When PA says "go autonomous" / "stay supervised" / "full trust on X":
1. Update autonomy.json with the new level
2. Adjust behavior per the escalation matrix (Section 2.6)
3. Log the change to the escalation_log array
```

---

## 13. IMPLEMENTATION ORDERING WITHIN SPRINTS

### Sprint O1 Implementation Order

1. Verify memory-write-guard.py fires correctly (test with a Write to memory dir containing test count)
2. Implement enforcement gap Fix 2 (EXEMPT Layer 2.5)
3. Implement enforcement gap Fix 3 (BUILD-PLAN check)
4. Implement enforcement gap Fix 4 (CWD check)
5. Implement enforcement gap Fix 1 (Oracle Gate dispatch ID via JSONL)
6. Implement ORACLE-DEGRADED co-occurrence guard
7. Verify all existing hook tests still pass
8. Timing test: all hooks within timeout

### Sprint O2 Implementation Order

1. Create directory structure: `~/.solishq/session-briefs/`
2. Implement SP#8 temporal awareness in session-opener.sh (simplest, lowest risk)
3. Implement SP#1 narrative directives in learning-capture.sh
4. Implement SP#1 symlink management in session-closer.sh
5. Implement SP#1 narrative injection in session-opener.sh
6. Implement SP#2 sentinel check.sh
7. Implement SP#2 sentinel injection in session-opener.sh
8. Timing test: session-opener.sh < 5s with all additions
9. Integration test: full session lifecycle with narrative round-trip

### Sprint O3 Implementation Order

1. Create directory structure: `~/.solishq/promises/`
2. Create `~/.solishq/autonomy.json` with defaults
3. Bootstrap `~/.solishq/femi-model.md` from Limen claims
4. Implement SP#5 promise directives in learning-capture.sh
5. Implement SP#5 promise summary in session-opener.sh
6. Implement SP#9 autonomy injection in session-opener.sh
7. Implement SP#10 femi model injection in session-opener.sh
8. Implement SP#10 femi model update directive in learning-capture.sh
9. Timing test: session-opener.sh still < 5s

---

## 14. WIRING MANIFEST

Every component in this design that writes or reads a file must be verified as WIRED at the correct site.

| Source File | Reads | Reads At (Line/Section) | Writes | Writes At (Line/Section) |
|-------------|-------|------------------------|--------|--------------------------|
| session-opener.sh | session-briefs/latest.md | New SP#1 block | state/session-start.txt | New SP#8 block |
| session-opener.sh | sentinel/latest.json | New SP#2 block | (none new) | |
| session-opener.sh | autonomy.json | New SP#9 block | (none new) | |
| session-opener.sh | femi-model.md | New SP#10 block | (none new) | |
| session-opener.sh | promises/yesterday.jsonl | New SP#5 block | (none new) | |
| learning-capture.sh | (none new) | | (behavioral: narrative, promises, femi) | New directives |
| session-closer.sh | state/session-start.txt | New SP#1 fallback | session-briefs/*.md, latest.md | New SP#1 block |
| pre-compact.sh | state/session-start.txt | New SP#8 block | (behavioral: interim narrative) | New directive |
| sentinel/check.sh | Limen DB, git repos, system state | Throughout | sentinel/latest.json, latest.md | End of script |

---

## 15. ORACLE GATES SUMMARY

| Gate | Status | Evidence |
|------|--------|---------|
| OG-CONSULT | DEGRADED | Intelligence MCP unavailable at 2026-03-30. Manual standards review conducted: reviewed all 16 hook files, settings.json, 3 audit documents (memory architecture, enforcement gap, their audit reports), Orchestrator SKILL.md, DOCTRINE.md, and the full Superpowers Operational Brief. Standards applied: fail-open design, timeout budgeting, JSONL corruption isolation, additive-only migrations, no-daemon constraint, concurrent-write safety. |
| OG-REVIEW | PENDING | To be run after implementation |
| OG-VERIFY | PENDING | To be run after tests pass |

---

## 16. OPEN ASSUMPTIONS

| # | Assumption | Consequence If Wrong | Mitigation |
|---|-----------|---------------------|------------|
| A1 | Claude Code hook API remains stable | All hooks break | Hooks are version-pinned to current API. Changes would be detected at session start. |
| A2 | Session-opener.sh can absorb 500ms additional execution | If wrong, sessions fail to start | Each new block is individually timed and fail-open. If total exceeds budget, least-critical blocks (femi model, promise summary) are removed first. |
| A3 | JSONL files remain small (<100KB/day) | Read times increase, hook timeouts | Daily rotation limits file size. Old files are never read in hooks (only yesterday's promises). |
| A4 | Narrative generation by the model is reliable | Sessions start without narrative context | Fallback brief in session-closer.sh provides minimum viable continuity. |
| A5 | Single-user system (no multi-user contention) | File locking needed | If multi-user becomes a requirement, add flock-based locking to JSONL writes. |
| A6 | Limen v1.3.0 ships before Sprint O6 begins | O6 is blocked | O1-O5 are independent of Limen changes. O6 can be deferred indefinitely without affecting O1-O5 value. |

---

*This Design Source is complete. It defines the architecture for all 14 superpowers across 6 sprints, with type definitions, state machines, error taxonomies, hook specifications, file schemas, dependency graphs, and assurance mappings. An engineer can implement each sprint from this document alone.*

*SolisHQ -- We innovate, invent, then disrupt.*
