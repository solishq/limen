# Mission System Guide

Missions are how agents perform complex, multi-step work within enforced boundaries. An agent proposes an objective with a token budget and deadline. The system validates the proposal, and the agent works through planning, execution, artifact creation, checkpoints, and result submission — all through the 16 system calls.

---

## Creating a Mission

```typescript
const mission = await limen.missions.create({
  agent: 'researcher',
  objective: 'Produce a competitive analysis report for the AI infrastructure market',
  constraints: {
    tokenBudget: 100_000,
    deadline: '2024-12-31T23:59:59Z',
    capabilities: ['web', 'data', 'code'],
    maxTasks: 20,
  },
  deliverables: [
    { type: 'report', name: 'competitive-analysis' },
    { type: 'data', name: 'market-data' },
  ],
});
```

---

## Mission Lifecycle

```
CREATED → PLANNING → EXECUTING → REVIEWING → COMPLETED
                ↓                     ↓
             BLOCKED              CANCELLED
                ↓
             PAUSED
```

| State | Description |
|---|---|
| `CREATED` | Mission accepted, not yet started |
| `PLANNING` | Agent is decomposing the objective into a task graph |
| `EXECUTING` | Tasks are being executed |
| `REVIEWING` | Agent is aggregating results and producing deliverables |
| `COMPLETED` | Mission finished successfully |
| `BLOCKED` | Budget exhausted or dependency unmet |
| `PAUSED` | Manually paused by human operator |
| `CANCELLED` | Terminated before completion |

---

## Task Graphs

Agents decompose missions into directed acyclic graphs (DAGs) of tasks. Each task has a type, description, and optional dependencies on other tasks.

```typescript
// The agent proposes a task graph via SC-2 (propose_task_graph)
const graph = {
  tasks: [
    { id: 't1', type: 'research', description: 'Gather market data' },
    { id: 't2', type: 'research', description: 'Identify competitors' },
    { id: 't3', type: 'analysis', description: 'Compare strengths/weaknesses', dependencies: ['t1', 't2'] },
    { id: 't4', type: 'writing', description: 'Draft report', dependencies: ['t3'] },
  ],
};
```

Limen validates the graph:
- No cycles (CYCLE_DETECTED)
- Task count within limits (TASK_LIMIT_EXCEEDED)
- All dependencies reference valid tasks (INVALID_DEPENDENCY)
- Dependencies are satisfiable given the execution order

---

## Budget Enforcement

Every mission has a token budget. Limen tracks consumption at every LLM call.

```typescript
const constraints = {
  tokenBudget: 100_000,  // Maximum tokens this mission can consume
  maxTasks: 20,          // Maximum tasks in the task graph
};
```

Budget enforcement is continuous:
- Each LLM call deducts from the mission budget
- If budget is exhausted, the mission transitions to BLOCKED
- An agent can request additional budget via SC-8 (request_budget)
- Budget requests above thresholds require human approval (HUMAN_APPROVAL_REQUIRED)

---

## Checkpoints

During execution, Limen issues checkpoints to assess progress. The agent responds with an assessment.

```typescript
// SC-10: respond_checkpoint
const checkpoint = {
  assessment: 'Research phase complete. 3 of 5 competitors identified.',
  confidence: 0.7,
  suggestedAction: 'continue',  // 'continue' | 'pause' | 'escalate' | 'cancel'
};
```

Checkpoints also run goal drift detection (I-24). If the agent's work has drifted too far from the original objective, Limen flags it. Below threshold → human escalation event.

---

## Artifacts

Agents produce immutable, versioned artifacts during execution (SC-4: create_artifact).

```typescript
// Artifacts are created via system calls during mission execution
const artifact = {
  name: 'competitive-analysis',
  type: 'report',
  content: { /* structured report data */ },
};
```

Properties:
- **Immutable** (I-19): Once created, an artifact cannot be modified. Create a new version instead.
- **Dependency-tracked** (I-23): Artifacts can depend on other artifacts. Archiving a dependency cascades a STALE flag to all dependents.
- **Tenant-scoped**: Artifacts belong to a mission within a tenant context.

---

## Mission Bounds (I-20)

To prevent unbounded execution, mission trees are structurally limited:

| Bound | Default |
|---|---|
| Maximum depth | 5 levels of sub-missions |
| Maximum children | 10 sub-missions per parent |
| Maximum tree size | 50 total missions in tree |

Exceeding any bound returns DEPTH_EXCEEDED, CHILDREN_EXCEEDED, or TREE_SIZE_EXCEEDED.

---

## Monitoring

```typescript
// Listen for events
mission.on('checkpoint', (payload) => {
  console.log('Checkpoint:', payload.assessment);
});

mission.on('artifact', (payload) => {
  console.log('Artifact produced:', payload.name);
});

// Wait for completion
const result = await mission.wait();
console.log(result.summary);
console.log(result.confidence);
console.log(result.resourcesConsumed.tokens);
```

---

## Recovery (I-18)

Missions survive engine restarts. On startup, Limen queries for non-terminal missions and rebuilds their execution context from the database. EXECUTING missions resume execution. BLOCKED missions stay blocked until their condition clears.

---

## Deterministic Replay (I-25)

Every LLM request and response is recorded in the audit trail. The replay engine can reproduce execution from these recorded outputs, producing identical system state. This enables debugging, testing, and post-mortem analysis.

---

## The 16 System Calls

| # | Call | Mission Lifecycle Phase |
|---|---|---|
| SC-1 | `propose_mission` | Creation |
| SC-2 | `propose_task_graph` | Planning |
| SC-3 | `propose_task_execution` | Execution |
| SC-4 | `create_artifact` | Execution |
| SC-5 | `read_artifact` | Execution |
| SC-6 | `emit_event` | Any phase |
| SC-7 | `request_capability` | Execution |
| SC-8 | `request_budget` | When blocked on budget |
| SC-9 | `submit_result` | Review/completion |
| SC-10 | `respond_checkpoint` | Checkpoints |
| SC-11 | `assert_claim` | Knowledge capture |
| SC-12 | `relate_claims` | Knowledge linking |
| SC-13 | `query_claims` | Knowledge retrieval |
| SC-14 | `write_working_memory` | Task-scoped state |
| SC-15 | `read_working_memory` | Task-scoped state |
| SC-16 | `discard_working_memory` | Cleanup |
