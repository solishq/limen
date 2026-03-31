# Limen Error Codes

Every error thrown by Limen is a `LimenError` with a typed `code`, a human-readable `message`, a `retryable` flag, and optional `cooldownMs` and `suggestion` fields.

```typescript
import { LimenError } from 'limen-ai';

try {
  await result.text;
} catch (err) {
  if (err instanceof LimenError) {
    console.log(err.code);        // Typed error code
    console.log(err.message);     // Safe, redacted message
    console.log(err.retryable);   // true for transient errors
    console.log(err.cooldownMs);  // Present for RATE_LIMITED
    console.log(err.suggestion);  // Present for some error types
  }
}
```

Internal details (SQL statements, stack traces, file paths, dependency internals) are **never** exposed through `LimenError`. Messages are automatically redacted at the API boundary.

---

## Retryable Errors

These errors indicate transient conditions. Retry after the suggested cooldown.

| Code | What Happened | Why | How to Fix |
|---|---|---|---|
| `RATE_LIMITED` | Request rate limit exceeded | Too many API calls in the current window | Wait `cooldownMs` (available on the error), then retry |
| `TIMEOUT` | Operation timed out | LLM provider or network latency exceeded `defaultTimeoutMs` | Retry immediately or with backoff. Increase `defaultTimeoutMs` in config if persistent |
| `PROVIDER_UNAVAILABLE` | No LLM provider reachable | All configured providers are down or unreachable | Retry with exponential backoff. Check provider status pages. Configure multiple providers for failover |
| `WORKER_UNAVAILABLE` | No worker available for task execution | Worker pool is fully occupied | Retry after short delay. Increase `substrate.maxWorkers` if persistent |

---

## API Surface Errors

| Code | What Happened | Why | How to Fix |
|---|---|---|---|
| `CANCELLED` | Operation was cancelled | An `AbortSignal` was triggered or the engine is shutting down | Intentional cancellation requires no fix. If unintentional, check your AbortController logic |
| `UNAUTHORIZED` | Insufficient permissions | RBAC denied the operation for the current agent/role | Check `requireRbac` config. Ensure the agent has the required role and permissions |
| `SCHEMA_VALIDATION_FAILED` | Structured output did not match the expected schema | The LLM returned JSON that failed validation against your `outputSchema` | Simplify the schema, increase `maxRetries`, or use a more capable model |
| `ENGINE_UNHEALTHY` | Engine is in an unhealthy state | Critical subsystem failure or unrecoverable internal error | Call `limen.health()` to diagnose. Restart the engine. Check disk space and database integrity |
| `SESSION_NOT_FOUND` | Session not found or expired | The session ID does not exist or the session was closed | Create a new session. Check that `session.close()` was not called prematurely |
| `INVALID_CONFIG` | Engine configuration is invalid | A config value failed validation (e.g., negative timeout, invalid masterKey) | Check the `LimenConfig` type. Ensure `masterKey` is >= 32 bytes, `dataDir` is writable |
| `INVALID_INPUT` | Input is invalid | A required parameter was missing, empty, or malformed | Check the method signature. Validate inputs before calling |

---

## Convenience API Errors (CONV_*)

These codes are specific to the knowledge convenience API (`remember`, `recall`, `forget`, `connect`, `reflect`, `search`).

| Code | What Happened | Why | How to Fix |
|---|---|---|---|
| `CONV_INVALID_TEXT` | `remember(text)` received empty text | The 1-param `remember()` form requires non-empty text | Pass a non-empty string |
| `CONV_INVALID_CONFIDENCE` | Confidence score out of range | Confidence must be in [0.0, 1.0] and finite | Use a value between 0.0 and 1.0 |
| `CONV_INVALID_CATEGORY` | `reflect()` received invalid category | Category must be one of: `decision`, `pattern`, `warning`, `finding` | Use a valid category string |
| `CONV_STATEMENT_TOO_LONG` | `reflect()` statement exceeds limit | Statement exceeds 500 characters | Shorten the statement to 500 characters or fewer |
| `CONV_EMPTY_ENTRIES` | `reflect()` called with empty array | At least one entry is required | Pass at least one `ReflectEntry` |
| `CONV_ENTRIES_LIMIT` | `reflect()` entries exceed maximum | Maximum 100 entries per `reflect()` call | Split into multiple `reflect()` calls of 100 or fewer |
| `CONV_BATCH_PARTIAL` | `reflect()` transaction failed mid-batch | An entry in the batch caused an error; entire transaction rolled back | Check each entry for valid category, non-empty statement, valid confidence |
| `CONV_CLAIM_NOT_FOUND` | `forget()` target not found | The `claimId` does not exist in the database | Verify the claimId. Use `recall()` to find valid claim IDs |
| `CONV_ALREADY_RETRACTED` | `forget()` target already retracted | The claim was already retracted (forgotten) | No action needed — the belief is already forgotten |
| `CONV_INVALID_RELATIONSHIP` | `connect()` received invalid type | Relationship type must be one of: `supports`, `contradicts`, `supersedes`, `derived_from` | Use a valid relationship type |
| `CONV_SELF_REFERENCE` | `connect()` used same claim on both sides | Cannot create a relationship from a claim to itself | Use two different claim IDs |
| `CONV_INVALID_REASON` | `forget()` received invalid retraction reason | Reason must be one of: `incorrect`, `superseded`, `expired`, `manual` | Use a valid `RetractionReason` |
| `CONV_REASONING_TOO_LONG` | `remember()` reasoning exceeds limit | Reasoning text exceeds 1000 characters | Shorten the reasoning to 1000 characters or fewer |

### Search Errors

| Code | What Happened | Why | How to Fix |
|---|---|---|---|
| `CONV_SEARCH_EMPTY_QUERY` | `search()` received empty query | Search query must be non-empty | Pass a non-empty search string |
| `CONV_SEARCH_INVALID_LIMIT` | `search()` limit out of range | Limit must be between 1 and 200 | Use a limit in [1, 200]. Default is 20 |
| `CONV_SEARCH_FTS5_ERROR` | FTS5 engine returned an error | Internal FTS5 index error (rare) | Retry the search. If persistent, rebuild the engine |
| `CONV_SEARCH_QUERY_SYNTAX` | FTS5 query syntax error | The search query contains invalid FTS5 syntax characters | Simplify the query. Avoid special characters like `*`, `OR`, `AND` in the search string |

---

## Mission and Task Errors

| Code | What Happened | Why | How to Fix |
|---|---|---|---|
| `BUDGET_EXCEEDED` | Token budget exhausted | The mission consumed all allocated tokens | Request additional budget via `request_budget` system call. Or increase the initial `tokenBudget` |
| `DEPTH_EXCEEDED` | Mission tree too deep | Maximum nesting depth of 5 exceeded | Flatten the mission structure. Use task graphs instead of sub-missions |
| `CHILDREN_EXCEEDED` | Too many child missions | A parent mission has more than 10 children | Consolidate child missions or restructure the mission tree |
| `TREE_SIZE_EXCEEDED` | Mission tree too large | Total missions in the tree exceeded 50 | Reduce mission count. Use tasks within missions instead of new sub-missions |
| `DEADLINE_EXCEEDED` | Mission deadline passed | The mission's deadline timestamp has elapsed | Set a later deadline or complete work faster. Deadlines are enforced on task execution |
| `MISSION_NOT_ACTIVE` | Mission is not active | Operation attempted on a mission in a terminal state (COMPLETED, FAILED, CANCELLED) | Create a new mission. Terminal missions cannot be reactivated |
| `MISSION_NOT_FOUND` | Mission does not exist | The mission ID was not found in the database | Verify the mission ID |
| `TASKS_INCOMPLETE` | Cannot submit result | `submit_result` called but not all tasks are in a terminal state | Complete or cancel all tasks before submitting the mission result |
| `NO_ARTIFACTS` | Cannot submit result | `submit_result` called but no artifacts were produced | Create at least one artifact via `create_artifact` before submitting |
| `PLAN_REVISION_LIMIT` | Too many plan revisions | The mission's task graph has been revised too many times | Work with the current plan. Maximum revisions is enforced to prevent infinite replanning |
| `INVALID_PLAN` | Plan revision is invalid | The proposed task graph revision failed validation | Check task graph structure: no cycles, valid dependencies, within task limits |

---

## Task Graph Errors

| Code | What Happened | Why | How to Fix |
|---|---|---|---|
| `CYCLE_DETECTED` | Dependency cycle in task graph | Tasks form a circular dependency | Remove the cycle. Task graphs must be DAGs (directed acyclic graphs) |
| `TASK_LIMIT_EXCEEDED` | Too many tasks | Task count exceeds the mission's `maxTasks` limit | Reduce task count or increase `maxTasks` in mission constraints |
| `INVALID_DEPENDENCY` | Invalid task dependency | A task references a dependency that does not exist in the graph | Verify all dependency IDs exist as tasks in the same graph |
| `DEPENDENCIES_UNMET` | Task dependencies not satisfied | `propose_task_execution` called but predecessor tasks are not complete | Wait for dependent tasks to complete before executing |
| `TASK_NOT_PENDING` | Task is not pending | Attempted to execute a task that is not in PENDING state | Check task state. Only PENDING tasks can be executed |

---

## Agent and Capability Errors

| Code | What Happened | Why | How to Fix |
|---|---|---|---|
| `AGENT_NOT_FOUND` | Agent does not exist | The agent name was not found in the registry | Register the agent first via `limen.agents.register()` |
| `CAPABILITY_VIOLATION` | Agent lacks required capability | The agent does not have the capability needed for this operation | Add the capability to the agent's capability list |
| `CAPABILITY_DENIED` | Capability request denied | The capability request was denied by policy or trust level | Promote the agent to a higher trust level or adjust capability policies |
| `DELEGATION_CYCLE` | Delegation cycle detected | A mission delegation would create a circular chain | Restructure mission delegation to avoid cycles |
| `SANDBOX_VIOLATION` | Sandbox constraint violated | Capability execution attempted something outside its sandbox | Review the capability's sandbox constraints and the operation it attempted |

---

## Resource and Storage Errors

| Code | What Happened | Why | How to Fix |
|---|---|---|---|
| `STORAGE_EXCEEDED` | Storage limit exceeded | The operation would exceed configured storage limits | Free space or increase storage limits |
| `ARTIFACT_LIMIT_EXCEEDED` | Artifact count limit exceeded | Too many artifacts created for a mission/task | Archive or consolidate artifacts |
| `NOT_FOUND` | Resource not found | The requested resource ID does not exist | Verify the resource ID |
| `ARCHIVED` | Resource archived | The resource exists but has been archived | Access is read-only for archived resources |

---

## Budget Errors

| Code | What Happened | Why | How to Fix |
|---|---|---|---|
| `PARENT_INSUFFICIENT` | Parent has insufficient budget | Child mission requested more budget than the parent has remaining | Reduce the child's budget request or increase the parent's budget |
| `HUMAN_APPROVAL_REQUIRED` | Human approval required | The budget request exceeds the auto-approval threshold | Submit for human approval via HITL |
| `JUSTIFICATION_REQUIRED` | Justification required | A budget request above threshold must include a justification string | Add a `justification` field to the budget request |

---

## Governance Errors

| Code | What Happened | Why | How to Fix |
|---|---|---|---|
| `LIFECYCLE_INVALID_TRANSITION` | Invalid state transition | Attempted a lifecycle transition that is not allowed from the current state | Check the valid transitions for the current state |
| `SUSPENSION_ACTIVE` | Operation blocked by suspension | The entity is suspended and the operation is not allowed during suspension | Wait for suspension to be lifted or resolve the suspension cause |
| `SUSPENSION_NOT_FOUND` | Suspension record not found | The referenced suspension ID does not exist | Verify the suspension ID |
| `AUTHORITY_INSUFFICIENT` | Insufficient authority | The caller's trust level is too low for this operation | Promote the agent or use a higher-authority caller |
| `AUTHORITY_SCOPE_EXCEEDED` | Authority scope exceeded | The action is outside the caller's authority scope | Operate within scope or escalate to a higher authority |
| `HARD_POLICY_VIOLATION` | Hard policy violated | A mandatory policy constraint was violated — no override possible | Modify the operation to comply with the policy |
| `SOFT_POLICY_VIOLATION` | Soft policy violated | A recommended policy was violated — may be overridden with justification | Provide justification or modify the operation |
| `DECISION_CONFLICT` | Conflicting supervisor decision | A supervisor decision conflicts with the attempted operation | Resolve the conflicting decision first |
| `CONTRACT_UNSATISFIED` | Contract criteria unmet | Mission completion requires specific criteria that have not been met | Satisfy all contract criteria before completing the mission |
| `HANDOFF_REJECTED` | Handoff rejected | The delegate rejected the mission handoff | Choose a different delegate or modify the handoff terms |
| `ATTEMPT_EXHAUSTED` | Retry attempts exhausted | Maximum retry attempts have been used | The operation has permanently failed. Investigate root cause |
| `CHECKPOINT_EXPIRED` | Checkpoint expired | The checkpoint response window has elapsed | Checkpoints have a time-to-live. Respond more quickly in future |

---

## Observability Errors

| Code | What Happened | Why | How to Fix |
|---|---|---|---|
| `TRACE_EMISSION_FAILED` | Trace emission failed | The trace/audit subsystem could not record the event | Check database connectivity and disk space |
| `EVAL_GATE_FAILED` | Evaluation gate failed | A quality evaluation gate blocked completion | Review the evaluation criteria and improve the output quality |
| `INVALID_TYPE` | Invalid event type | The event type string is not in the valid event type set | Use a valid event type from the `EventType` union |

---

## Trust and Identity Errors

| Code | What Happened | Why | How to Fix |
|---|---|---|---|
| `MANIFEST_TRUST_VIOLATION` | Trust tier violation | The capability manifest references a trust tier the agent has not reached | Promote the agent or remove the high-trust capability from the manifest |
| `RESUME_TOKEN_INVALID` | Resume token invalid | The token has been consumed or was never issued | Request a new resume token |
| `RESUME_TOKEN_EXPIRED` | Resume token expired | The token's TTL has elapsed | Request a new resume token |
| `IDEMPOTENCY_CONFLICT` | Idempotency key conflict | The same idempotency key was used with a different payload | Use a unique idempotency key per distinct operation |
