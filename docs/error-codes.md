# Limen Error Codes

Every error thrown by Limen is a `LimenError` with a typed `code`, a human-readable `message`, a `retryable` flag, and optional `cooldownMs` and `suggestion` fields.

```typescript
import { LimenError } from '@solishq/limen';

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

| Code | Description | Retry Strategy |
|---|---|---|
| `RATE_LIMITED` | Request rate limit exceeded | Wait `cooldownMs`, then retry |
| `TIMEOUT` | Operation timed out | Retry immediately or with backoff |
| `PROVIDER_UNAVAILABLE` | No LLM provider reachable | Retry with exponential backoff |
| `WORKER_UNAVAILABLE` | No worker available for execution | Retry after short delay |

---

## API Surface Errors

| Code | Description |
|---|---|
| `RATE_LIMITED` | Request rate limit exceeded |
| `TIMEOUT` | The operation timed out |
| `CANCELLED` | The operation was cancelled |
| `UNAUTHORIZED` | Insufficient permissions (RBAC denied) |
| `PROVIDER_UNAVAILABLE` | No LLM provider is currently available |
| `SCHEMA_VALIDATION_FAILED` | Structured output did not match the expected schema |
| `ENGINE_UNHEALTHY` | The engine is in an unhealthy state (catch-all for internal errors) |
| `SESSION_NOT_FOUND` | The specified session was not found or has expired |
| `INVALID_CONFIG` | The engine configuration is invalid |
| `INVALID_INPUT` | The provided input is invalid |

---

## Mission & Task Errors

| Code | Description |
|---|---|
| `BUDGET_EXCEEDED` | Token budget has been exceeded |
| `DEPTH_EXCEEDED` | Mission tree depth limit exceeded (max 5) |
| `CHILDREN_EXCEEDED` | Maximum child missions exceeded (max 10) |
| `TREE_SIZE_EXCEEDED` | Mission tree total size limit exceeded (max 50) |
| `DEADLINE_EXCEEDED` | The mission deadline has passed |
| `MISSION_NOT_ACTIVE` | The mission is not in an active state |
| `MISSION_NOT_FOUND` | The specified mission was not found |
| `TASKS_INCOMPLETE` | Cannot submit result: tasks are incomplete |
| `NO_ARTIFACTS` | Cannot submit result: no artifacts produced |
| `PLAN_REVISION_LIMIT` | Maximum plan revision count exceeded |
| `INVALID_PLAN` | The plan revision is invalid |

---

## Task Graph Errors

| Code | Description |
|---|---|
| `CYCLE_DETECTED` | A dependency cycle was detected in the task graph |
| `TASK_LIMIT_EXCEEDED` | Maximum task count exceeded |
| `INVALID_DEPENDENCY` | Invalid task dependency specified |
| `DEPENDENCIES_UNMET` | Task dependencies have not been satisfied |
| `TASK_NOT_PENDING` | The task is not in a pending state |

---

## Agent & Capability Errors

| Code | Description |
|---|---|
| `AGENT_NOT_FOUND` | The specified agent was not found |
| `CAPABILITY_VIOLATION` | Agent capability does not include the required permission |
| `CAPABILITY_DENIED` | Capability request was denied |
| `DELEGATION_CYCLE` | A delegation cycle was detected in the mission tree |
| `SANDBOX_VIOLATION` | Capability execution violated sandbox constraints |

---

## Resource & Storage Errors

| Code | Description |
|---|---|
| `STORAGE_EXCEEDED` | Storage limit exceeded |
| `ARTIFACT_LIMIT_EXCEEDED` | Artifact count limit exceeded |
| `NOT_FOUND` | The requested resource was not found |
| `ARCHIVED` | The requested resource has been archived |

---

## Budget Errors

| Code | Description |
|---|---|
| `PARENT_INSUFFICIENT` | Parent mission has insufficient budget |
| `HUMAN_APPROVAL_REQUIRED` | Human approval is required for this budget request |
| `JUSTIFICATION_REQUIRED` | A justification is required for this budget request |

---

## Governance Errors

| Code | Description |
|---|---|
| `LIFECYCLE_INVALID_TRANSITION` | Invalid lifecycle state transition |
| `SUSPENSION_ACTIVE` | Operation is blocked by an active suspension |
| `SUSPENSION_NOT_FOUND` | The referenced suspension record was not found |
| `AUTHORITY_INSUFFICIENT` | Insufficient authority for this operation |
| `AUTHORITY_SCOPE_EXCEEDED` | Action exceeds the caller's authority scope |
| `HARD_POLICY_VIOLATION` | A hard policy constraint was violated |
| `SOFT_POLICY_VIOLATION` | A soft policy constraint was violated |
| `DECISION_CONFLICT` | A conflicting supervisor decision exists |
| `CONTRACT_UNSATISFIED` | Mission contract criteria have not been met |
| `HANDOFF_REJECTED` | The handoff was rejected by the delegate |
| `ATTEMPT_EXHAUSTED` | Maximum retry attempts have been exhausted |
| `CHECKPOINT_EXPIRED` | The checkpoint has expired |

---

## Observability Errors

| Code | Description |
|---|---|
| `TRACE_EMISSION_FAILED` | Trace event emission failed |
| `EVAL_GATE_FAILED` | Evaluation gate blocked completion |
| `INVALID_TYPE` | Invalid event type |

---

## Trust & Identity Errors

| Code | Description |
|---|---|
| `MANIFEST_TRUST_VIOLATION` | Capability manifest trust tier violation |
| `RESUME_TOKEN_INVALID` | The resume token is invalid or has been consumed |
| `RESUME_TOKEN_EXPIRED` | The resume token has expired |
| `IDEMPOTENCY_CONFLICT` | Same idempotency key with different payload |
