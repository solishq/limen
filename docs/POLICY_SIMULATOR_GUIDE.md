# Policy Simulator Guide

## Overview

The Policy Simulator provides what-if analysis for Limen governance policies. It answers questions like "what happens to projections if I enable governed mode and a tamper event occurs?" by executing scenario steps against a configurable policy and tracking state transitions, confidence decay, refusals, and self-healing events.

The simulator uses a `ProjectionValidityState` model (verified/lagging/unverified/divergent/rebuilding) distinct from the graph's `NodeLifecycleState` (active/suspended/revoked/pending/archived). The graph model tracks node lifecycle; the simulator models projection validity under governance policies.

The simulator runs deterministically: same policy + same scenario = same result, making it suitable for regression testing governance configurations.

## Quick Start

```bash
curl -X POST http://localhost:3001/simulator/run \
  -H "Content-Type: application/json" \
  -d '{"policy":{"governed":true,"max_cascade_depth":3,"auto_retract_threshold":0.5,"tamper_action":"block","rebuild_steps":3},"scenario":[{"action":"claim","data":{}},{"action":"query","data":{}},{"action":"tamper","data":{}}],"initial_state":"verified"}'
```

## API Reference

### POST /simulator/run

Execute a single simulation scenario against a policy. Returns 400 if the scenario is empty or exceeds 10,000 steps.

**Request (`SimulationRequest`):**

| Field | Type | Description |
|-------|------|-------------|
| policy.governed | bool | Strict governance mode active |
| policy.max_cascade_depth | u32 | Maximum cascading depth for cascade actions |
| policy.auto_retract_threshold | f64 | EC below which self-healing triggers |
| policy.tamper_action | string | "block", "warn", or "rebuild" |
| policy.rebuild_steps | u32 | Steps in Rebuilding before auto-transition to Verified (default: 3) |
| scenario[].action | string | "claim", "query", "tamper", "conflict", "state_change", or "cascade" |
| scenario[].data | object | Action payload (see below) |
| initial_state | string | "verified", "lagging", "unverified", "divergent", or "rebuilding" |

**Action data payloads:**
- `state_change`: `{"target_state": "verified"}` — missing/invalid target returns refused outcome
- `cascade`: `{"depth": 2}` — increments cascade depth counter; refused if total exceeds max_cascade_depth

**Response (`SimulationResult`):**

```json
{
  "steps": [{ "step_index": 0, "action": "claim", "outcome": {"type": "allowed"}, "governance_state_after": "verified", "effective_confidence": 1.0 }],
  "final_state": "verified",
  "total_refusals": 1,
  "governance_transitions": [["verified", "divergent"]],
  "effective_confidence_trajectory": [1.0, 0.9988],
  "self_healing_events": 0
}
```

### POST /simulator/compare

Execute multiple simulations for side-by-side comparison. Request body is an array of `SimulationRequest` objects (max 10). Response is an array of `SimulationResult` in the same order. Returns 400 if more than 10 simulations or any scenario is empty/too large.

## Key Behaviors

### Self-Healing

When effective confidence (EC) drops below `auto_retract_threshold` and the current state is degraded (Lagging, Unverified, or Divergent), self-healing fires:
- `self_healing_events` increments
- State transitions to Rebuilding
- If the primary action outcome was a Refusal, the outcome remains Refused (self-healing does not mask refusals)

### Rebuilding Auto-Recovery

When in Rebuilding state, after `rebuild_steps` consecutive steps, the state automatically transitions to Verified. This prevents infinite Rebuilding traps.

### Cascade Depth Enforcement

The `cascade` action accumulates depth from `data.depth` (default 1). When the cumulative cascade depth exceeds `policy.max_cascade_depth`, the action is refused with "max cascade depth exceeded".

### Invalid State Changes

A `state_change` action with a missing or invalid `target_state` in its data returns a Refused outcome with reason "invalid target_state". The governance state does not change.

## Example Scenarios

### Scenario 1: Governed Mode Handles Tamper

Policy blocks tamper attempts. The system remains in verified state and refuses the malicious action.

```json
{
  "policy": { "governed": true, "max_cascade_depth": 3, "auto_retract_threshold": 0.5, "tamper_action": "block", "rebuild_steps": 3 },
  "scenario": [
    { "action": "claim", "data": {} },
    { "action": "tamper", "data": {} },
    { "action": "query", "data": {} }
  ],
  "initial_state": "verified"
}
```

**Expected:** Step 0 allowed (writes always succeed). Step 1 refused (tamper blocked). Step 2 allowed (state remained verified). `total_refusals: 1`, `final_state: "verified"`.

### Scenario 2: Comparing Strict vs Permissive Policies

Use `/simulator/compare` with two policies against the same 4-step scenario (tamper, query, conflict, query):

```bash
curl -X POST http://localhost:3001/simulator/compare \
  -H "Content-Type: application/json" \
  -d '[
    { "policy": { "governed": true, "max_cascade_depth": 3, "auto_retract_threshold": 0.5, "tamper_action": "block", "rebuild_steps": 3 },
      "scenario": [{"action":"tamper","data":{}},{"action":"query","data":{}},{"action":"conflict","data":{}},{"action":"query","data":{}}],
      "initial_state": "verified" },
    { "policy": { "governed": false, "max_cascade_depth": 5, "auto_retract_threshold": 0.3, "tamper_action": "warn", "rebuild_steps": 3 },
      "scenario": [{"action":"tamper","data":{}},{"action":"query","data":{}},{"action":"conflict","data":{}},{"action":"query","data":{}}],
      "initial_state": "verified" }
  ]'
```

**Expected:** Strict: tamper refused, query allowed, conflict transitions to divergent, second query refused. Permissive: tamper allowed (warn), query allowed, conflict transitions to divergent, second query refused (divergent blocks reads regardless of governed flag).

### Scenario 3: Cascade Depth Enforcement

```json
{
  "policy": { "governed": true, "max_cascade_depth": 3, "auto_retract_threshold": 0.5, "tamper_action": "block", "rebuild_steps": 3 },
  "scenario": [
    { "action": "cascade", "data": { "depth": 2 } },
    { "action": "cascade", "data": { "depth": 2 } }
  ],
  "initial_state": "verified"
}
```

**Expected:** Step 0 allowed (cumulative depth 2 <= max 3). Step 1 refused (cumulative depth 4 > max 3). `total_refusals: 1`.

### Scenario 4: Self-Healing Threshold Tuning

Set `auto_retract_threshold` high (0.95) so that EC decay in a degraded state triggers self-healing after approximately 43 steps:

```json
{
  "policy": { "governed": true, "max_cascade_depth": 5, "auto_retract_threshold": 0.95, "tamper_action": "block", "rebuild_steps": 3 },
  "scenario": [{"action":"claim","data":{}}, ... (100 claims)],
  "initial_state": "lagging"
}
```

**Expected:** EC starts at 1.0 and decays per `EC = 1.0 / (1 + step_index / 810)`. Around step 43, EC drops below 0.95. Since state is Lagging (degraded), self-healing fires, transitioning to Rebuilding. After 3 more steps in Rebuilding, auto-recovery transitions back to Verified.

## Interpreting Results

| Field | Meaning |
|-------|---------|
| steps | Ordered execution trace; each entry shows what action ran and what happened |
| steps[].outcome.type | "allowed" (action succeeded), "refused" (blocked with reason), "healed" (self-healing triggered), or "state_changed" (governance transition) |
| steps[].governance_state_after | The projection validity state after this step completed |
| steps[].effective_confidence | Confidence with temporal decay applied: EC = 1.0 / (1 + step_index / 810) |
| final_state | Projection validity state after all steps execute |
| total_refusals | Count of steps that were blocked by policy |
| governance_transitions | List of [from, to] state changes that occurred during the run |
| effective_confidence_trajectory | EC value at each step; shows confidence decay curve |
| self_healing_events | Count of times EC dropped below auto_retract_threshold in a degraded state, triggering automatic rebuild |

## Error Responses

All endpoints return 400 with an `ErrorResponse` body for validation failures:

```json
{
  "error": "too many filters",
  "detail": "maximum 20 filters allowed, got 21"
}
```

Common errors:
- Empty scenario (POST /simulator/run)
- Too many steps (> 10,000 per scenario)
- Too many simulations (> 10 for /simulator/compare)
- Missing node_id (GET /graph/edges)
- Too many filters (> 20 for POST /graph/query)
