# Policy Simulator Guide

## Overview

The Policy Simulator provides what-if analysis for Limen governance policies. It answers questions like "what happens to beliefs if I enable governed mode and a tamper event occurs?" by executing scenario steps against a configurable policy and tracking state transitions, confidence decay, refusals, and self-healing events.

The simulator runs deterministically: same policy + same scenario = same result, making it suitable for regression testing governance configurations.

## Quick Start

```bash
curl -X POST http://localhost:3001/simulator/run \
  -H "Content-Type: application/json" \
  -d '{"policy":{"governed":true,"max_cascade_depth":3,"auto_retract_threshold":0.5,"tamper_action":"block"},"scenario":[{"action":"claim","data":{}},{"action":"query","data":{}},{"action":"tamper","data":{}}],"initial_state":"verified"}'
```

## API Reference

### POST /simulator/run

Execute a single simulation scenario against a policy.

**Request (`SimulationRequest`):**

| Field | Type | Description |
|-------|------|-------------|
| policy.governed | bool | Strict governance mode active |
| policy.max_cascade_depth | u32 | Maximum cascading depth |
| policy.auto_retract_threshold | f64 | EC below which self-healing triggers |
| policy.tamper_action | string | "block", "warn", or "rebuild" |
| scenario[].action | string | "claim", "query", "tamper", "conflict", or "state_change" |
| scenario[].data | object | Action payload (`{"target_state":"..."}` for state_change) |
| initial_state | string | "verified", "lagging", "unverified", "divergent", or "rebuilding" |

**Response (`SimulationResult`):**

```json
{
  "steps": [{ "step_index": 0, "action": "claim", "outcome": "allowed", "governance_state_after": "verified", "effective_confidence": 1.0 }],
  "final_state": "verified",
  "total_refusals": 1,
  "governance_transitions": [["verified", "divergent"]],
  "effective_confidence_trajectory": [1.0, 0.9988],
  "self_healing_events": 0
}
```

### POST /simulator/compare

Execute multiple simulations for side-by-side comparison. Request body is an array of `SimulationRequest` objects. Response is an array of `SimulationResult` in the same order.

## Example Scenarios

### Scenario 1: Governed Mode Handles Tamper

Policy blocks tamper attempts. The system remains in verified state and refuses the malicious action.

```json
{
  "policy": { "governed": true, "max_cascade_depth": 3, "auto_retract_threshold": 0.5, "tamper_action": "block" },
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
    { "policy": { "governed": true, "max_cascade_depth": 3, "auto_retract_threshold": 0.5, "tamper_action": "block" },
      "scenario": [{"action":"tamper","data":{}},{"action":"query","data":{}},{"action":"conflict","data":{}},{"action":"query","data":{}}],
      "initial_state": "verified" },
    { "policy": { "governed": false, "max_cascade_depth": 5, "auto_retract_threshold": 0.3, "tamper_action": "warn" },
      "scenario": [{"action":"tamper","data":{}},{"action":"query","data":{}},{"action":"conflict","data":{}},{"action":"query","data":{}}],
      "initial_state": "verified" }
  ]'
```

**Expected:** Strict: tamper refused, query allowed, conflict transitions to divergent, second query refused. Permissive: tamper allowed (warn), query allowed, conflict transitions to divergent, second query refused (divergent blocks reads regardless).

### Scenario 3: Self-Healing Threshold Tuning

Set `auto_retract_threshold` high (0.99) so that any confidence decay in a degraded state triggers self-healing:

```json
{
  "policy": { "governed": true, "max_cascade_depth": 3, "auto_retract_threshold": 0.99, "tamper_action": "rebuild" },
  "scenario": [{"action":"tamper","data":{}},{"action":"query","data":{}},{"action":"claim","data":{}}],
  "initial_state": "lagging"
}
```

**Expected:** With initial state lagging and threshold 0.99, EC at step 0 is 1.0 (above threshold) so tamper_action fires first, transitioning to rebuilding. Lowering the threshold (e.g., 0.5) would require more steps before self-healing triggers. `self_healing_events >= 1` confirms the heal fired.

## Interpreting Results

| Field | Meaning |
|-------|---------|
| steps | Ordered execution trace; each entry shows what action ran and what happened |
| steps[].outcome | "allowed" (action succeeded), "refused" (blocked with reason), "healed" (self-healing triggered), or "state_changed" (governance transition) |
| steps[].governance_state_after | The governance state after this step completed |
| steps[].effective_confidence | Confidence with temporal decay applied: EC = base / (1 + step_index / 810) |
| final_state | Governance state after all steps execute |
| total_refusals | Count of steps that were blocked by policy |
| governance_transitions | List of (from, to) state changes that occurred during the run |
| effective_confidence_trajectory | EC value at each step; shows confidence decay curve |
| self_healing_events | Count of times EC dropped below auto_retract_threshold in a degraded state, triggering automatic rebuild |
