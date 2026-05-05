# Computer Use Governance Contract v2.2.0

**Status:** RATIFIED DESIGN --- Pending Implementation
**Governing:** CDM v2.1 + Contract Compliance v2.1
**Scope:** Governance, refusal, and audit for all AI agent computer actions
**Contract Hash:** Tracked in `contracts/phase-x.contracts.json`

> **Shared Types:** All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`. This contract does NOT redefine any shared type. Local types are contract-specific and not used by other contracts.

## 1. Purpose

This contract defines how Limen governs, audits, and optionally refuses computer use actions taken by any AI agent operating within the system. It is agent-agnostic --- applying uniformly to Claude Computer Use, Codex code execution, browser automation, terminal commands, API calls, and any future action type. All computer actions flow through a governance gate that evaluates risk, enforces policy, records provenance, and produces an immutable audit trail hash-chained into Limen's existing audit infrastructure.

## 2. Type References (from SHARED_TYPES.md)

This contract uses the following shared types without redefinition:

| Type | §HARED_TYPES Section |
|---|---|
| ActionBase, ComputerAction (17 variants), ComputerActionType | §11 |
| GovernanceContext, GovernanceAction | §9 |
| GovernanceVerdict | §10 |
| AgentSession | §7 |
| AgentTrustLevel, TRUST_TO_CLEARANCE | §5 |
| §andboxConfig, FilesystemSandbox, NetworkSandbox, ProcessSandbox, ResourceSandbox, DurationSandbox | §12 |
| RefusalRule, RefusalCondition (9 condition variants) | §13 |
| RateLimitPolicy, DEFAULT_RATE_LIMITS | §18 |
| RetentionPolicy, DEFAULT_RETENTION | §17 |
| ActionDigest | §24 |
| AgentEvent, AgentEventPayload, AgentEventBus | §16 |
| PerformanceBudget | §20 |
| Branded IDs (EventId, AgentId, SessionId, MissionId, TaskId, PolicyId, TenantId) | §1.1 |
| OperationContext | §1.3 |
| Result, KernelError | §1.4, S1.5 |
| ClassificationLevel, CLASSIFICATION_NUMERIC | §3 |

## 3. Contract-Specific Types

### 3.1 ActionRiskLevel

```typescript
type ActionRiskLevel = 'safe' | 'monitored' | 'elevated' | 'dangerous' | 'forbidden';

// Numeric mapping for comparison:
// safe=0, monitored=1, elevated=2, dangerous=3, forbidden=4
```

### 3.2 ActionCategory

```typescript
type ActionCategory =
  | 'filesystem'
  | 'terminal'
  | 'browser'
  | 'network'
  | 'code_execution'
  | 'process'
  | 'clipboard'
  | 'database'
  | 'custom';
```

### 3.3 ActionRiskAssessment

```typescript
interface ActionRiskAssessment {
  readonly level: ActionRiskLevel;
  readonly category: ActionCategory;
  readonly factors: readonly RiskFactor[];
  readonly score: number; // 0-100 composite
  readonly explanation: string;
}

interface RiskFactor {
  readonly name: string;
  readonly weight: number; // 0.0-1.0
  readonly value: number; // 0-100
  readonly reason: string;
}
```

### 3.4 ActionResult

```typescript
interface ActionResult {
  readonly success: boolean;
  readonly output: unknown | null;
  readonly error: string | null;
  readonly exitCode: number | null; // for terminal/process actions
  readonly duration: number; // milliseconds
  readonly sideEffects: readonly SideEffect[];
  readonly bytesRead: number;
  readonly bytesWritten: number;
}
```

### 3.5 SideEffect

```typescript
interface SideEffect {
  readonly type:
    | 'file_created'
    | 'file_modified'
    | 'file_deleted'
    | 'process_spawned'
    | 'process_killed'
    | 'network_request'
    | 'data_written'
    | 'data_deleted'
    | 'state_changed'
    | 'permission_changed';
  readonly target: string;
  readonly reversible: boolean;
  readonly reverseAction: ComputerAction | null; // action to undo, if reversible
  readonly timestamp: string;
}
```

### 3.6 GovernanceError

```typescript
type GovernanceError =
  | { readonly code: 'RULE_EVALUATION_FAILED'; readonly ruleId: string; readonly cause: string }
  | { readonly code: 'CHAIN_INTEGRITY_VIOLATION'; readonly expectedHash: string; readonly actualHash: string }
  | { readonly code: 'SANDBOX_CREATION_FAILED'; readonly reason: string }
  | { readonly code: 'AUDIT_WRITE_FAILED'; readonly reason: string }
  | { readonly code: 'TIMEOUT'; readonly operation: string; readonly elapsedMs: number };
```

## 4. Governance Hooks

### 4.1 ComputerActionGovernor Interface

```typescript
interface ComputerActionGovernor {
  /**
   * Evaluate and potentially block an action BEFORE execution.
   * Primary governance gate. Must be called for every action.
   * Latency budget: <10ms (see SHARED_TYPES.md §20 — governance check only).
   */
  beforeAction(
    action: ComputerAction,
    context: GovernanceContext
  ): Promise<Result<GovernanceVerdict>>;

  /**
   * Record outcome AFTER action execution completes.
   * Produces audit entry and updates provenance chain.
   * The minimal post-action audit entry must be durably appended before
   * the action result is returned as success (see SHARED_TYPES.md §20).
   * If append fails, the session is quarantined and the caller receives
   * AUDIT_APPEND_FAILED instead of a successful action result.
   */
  afterAction(
    action: ComputerAction,
    result: ActionResult,
    context: GovernanceContext
  ): Promise<Result<AuditEntry>>;

  /**
   * Pure risk evaluation without governance side effects.
   * Used for pre-flight checks and UI indicators.
   * Synchronous — no I/O, no state mutation.
   */
  evaluateRisk(action: ComputerAction): ActionRiskAssessment;
}
```

### 4.2 Extended GovernanceVerdict (contract-local enrichment)

The shared `GovernanceVerdict` (see `SHARED_TYPES.md` §10) is the wire format. This contract enriches verdicts at the governor layer with risk assessment metadata:

```typescript
interface EnrichedVerdict {
  readonly base: GovernanceVerdict;
  readonly riskAssessment: ActionRiskAssessment;
  readonly evaluatedRules: readonly string[]; // rule IDs that were checked
}
```

### 4.3 AuditEntry (produced by afterAction)

```typescript
interface AuditEntry {
  readonly entryId: EventId;
  readonly actionId: EventId;
  readonly timestamp: string; // ISO-8601
  readonly chainHash: string; // SHA-256 of this entry
  readonly previousHash: string; // SHA-256 of previous entry (genesis = '0'.repeat(64))
  readonly sequenceNumber: number; // monotonically increasing per session
}
```

## 5. Refusal Rules Engine

### 5.1 Rule Evaluation

Rules use the shared `RefusalRule` and `RefusalCondition` types (see `SHARED_TYPES.md` §13). Evaluation proceeds in priority order (lower number = higher priority); specificity is the deterministic tie-breaker within equal priority (exact target before glob before wildcard). First matching rule determines the verdict. If no rule matches, verdict is `allow`. All matching rules are retained in provenance.

### 5.2 Default Refusal Rules (Built-in, always active)

| ID | Priority | Verdict | Condition | Message |
|---|---|---|---|---|
| `DR-001` | 0 | refuse | command_match: `^(rm\s+-rf\s+/\|format\s+[A-Z]:\|fdisk\|mkfs\|dd\s+if=.*of=/dev/)` | Destructive system command blocked. Irreversible system damage. |
| `DR-002` | 0 | refuse | path_match(deny): `/etc/passwd, /etc/shadow, /etc/sudoers, /System/` | §ystem file write blocked. Protected system paths immutable. |
| `DR-003` | 1 | refuse | composite(and): [path_match(deny): `*.env, *credentials*, *private_key*, *.pem, *secret*`, trust_below: high] | Credential access blocked. Requires high trust. |
| `DR-004` | 2 | refuse | composite(and): [host_match: not in allowlist, action_type: [api:call, network:connect]] | Outbound network to unknown host blocked. |
| `DR-005` | 1 | escalate | command_match: `^git\s+(push\s+.*--force\|reset\s+--hard\|clean\s+-[fd])` | Destructive git operation requires human approval. |
| `DR-006` | 1 | escalate | command_match: `^(DROP\|TRUNCATE\|ALTER)\s+` (production connections) | Destructive database operation requires human approval. |
| `DR-007` | 3 | sandbox | composite(and): [action_type: [code:execute], trust_below: medium] | Low-trust code execution sandboxed automatically. |
| `DR-008` | 4 | refuse | composite(and): [path_match(deny): outside project directory, action_type: [file:write]] | File write outside project directory blocked. |
| `DR-009` | 5 | refuse | rate_exceeded: per_agent 100 computer_actions per 60s (enforcement: hard_refuse) | Rate limit exceeded. Agent throttled. |
| `DR-010` | 0 | refuse | composite(and): [action_type: [process:kill], command_match: PID 1 or system processes] | §ystem process termination blocked. |
| `DR-011` | 1 | refuse | composite(and): [action_type: [file:delete], path_match(deny): `*.git/*`] | Git internal file deletion blocked. Use git commands. |

### 5.3 Custom Rule Registration

```typescript
interface RefusalRuleRegistry {
  /**
   * Register a new refusal rule. Fails if ID conflicts.
   * Custom rules cannot have priority < 10 (0-9 reserved for builtins).
   */
  register(rule: RefusalRule): Result<void>;

  /**
   * Remove a custom rule by ID. Builtin rules cannot be unregistered.
   */
  unregister(ruleId: string): Result<void>;

  /**
   * Enable or disable a custom rule. Builtin rules cannot be disabled.
   */
  setEnabled(ruleId: string, enabled: boolean): Result<void>;

  /**
   * List all rules, ordered by priority (ascending = highest priority first).
   */
  list(filter?: { enabled?: boolean; builtin?: boolean; verdict?: string }): readonly RefusalRule[];

  /**
   * Evaluate an action against all active rules.
   * Returns the FIRST matching rule's verdict (priority order).
   * If no rule matches, returns 'allow'.
   */
  evaluate(action: ComputerAction, context: GovernanceContext): GovernanceVerdict;

  /**
   * Dry-run: evaluate without recording audit entry.
   * Used for pre-flight UI indicators.
   */
  dryRun(action: ComputerAction, context: GovernanceContext): GovernanceVerdict;
}
```

## 6. Provenance Chain

### 6.1 ActionProvenance

```typescript
interface ActionProvenance {
  readonly actionId: EventId;
  readonly parentActionId: EventId | null; // for actions spawned by other actions
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
  readonly missionId: MissionId | null;
  readonly taskId: TaskId | null;
  readonly tenantId: TenantId;
  readonly timestamp: string; // ISO-8601
  readonly action: ComputerAction;
  readonly verdict: GovernanceVerdict;
  readonly result: ActionResult | null; // null if refused/pending
  readonly chainHash: string; // SHA-256 of this entry
  readonly previousHash: string; // SHA-256 of previous entry (genesis = '0'.repeat(64))
  readonly sequenceNumber: number; // monotonically increasing per session
}
```

### 6.2 ProvenanceChain

```typescript
interface ProvenanceChain {
  /**
   * Append a new entry. Computes chainHash from:
   * SHA-256(previousHash + actionId + timestamp + JSON(action) + JSON(verdict))
   * Batched background per SHARED_TYPES.md §20 (provenance hash <100ms, batch size 100).
   */
  append(entry: Omit<ActionProvenance, 'chainHash' | 'sequenceNumber'>): Result<{ hash: string; sequenceNumber: number }>;

  /**
   * Verify chain integrity from genesis to head.
   * On-demand only (see SHARED_TYPES.md §20 — not per-operation).
   */
  verify(sessionId: SessionId): Result<{ valid: boolean; brokenAt: number | null; entries: number }>;

  /**
   * Get chain head (latest entry) for a session.
   */
  head(sessionId: SessionId): Result<ActionProvenance | null>;

  /**
   * Query chain entries with filters.
   */
  query(filter: ProvenanceQuery): Result<readonly ActionProvenance[]>;

  /**
   * Get chain length for a session.
   */
  length(sessionId: SessionId): Result<number>;
}
```

### 6.3 ProvenanceQuery

```typescript
interface ProvenanceQuery {
  readonly sessionId?: SessionId;
  readonly agentId?: AgentId;
  readonly missionId?: MissionId;
  readonly actionType?: string; // exact match or prefix with '*'
  readonly timeRange?: { readonly from: string; readonly to: string };
  readonly verdictFilter?: 'allow' | 'refuse' | 'escalate' | 'sandbox';
  readonly riskLevelMin?: ActionRiskLevel;
  readonly limit: number; // required, max 1000
  readonly offset: number;
  readonly order: 'asc' | 'desc';
}
```

## 7. Sandboxing

Sandbox structure uses the shared `SandboxConfig` (see `SHARED_TYPES.md` §12). This section defines the enforcement layer built atop that configuration.

### 7.1 SandboxEnforcer

```typescript
interface SandboxEnforcer {
  /**
   * Create a sandbox environment from config.
   */
  create(config: SandboxConfig): Result<SandboxHandle>;

  /**
   * Execute an action within a sandbox.
   * Enforces all constraints. Returns result or enforcement error.
   */
  execute(handle: SandboxHandle, action: ComputerAction): Promise<Result<ActionResult>>;

  /**
   * Destroy sandbox and clean up resources.
   */
  destroy(handle: SandboxHandle): Result<void>;

  /**
   * Get sandbox resource usage stats.
   */
  stats(handle: SandboxHandle): Result<SandboxStats>;
}

interface SandboxHandle {
  readonly id: string;
  readonly config: SandboxConfig;
  readonly createdAt: string;
  readonly state: 'active' | 'expired' | 'destroyed';
}

interface SandboxStats {
  readonly memoryUsedBytes: number;
  readonly cpuPercent: number;
  readonly diskUsedBytes: number;
  readonly processCount: number;
  readonly networkConnections: number;
  readonly elapsedMs: number;
  readonly actionsExecuted: number;
}
```

### 7.2 Enforcement Mechanisms (by platform)

- **Filesystem:** Path validation layer intercepts all fs calls. Resolves symlinks before checking against `SandboxConfig.filesystem.allowedPaths`. Blocks path traversal (`../`). Denied paths take precedence per SHARED_TYPES.md §12. On Linux: optional seccomp-bpf for kernel-level enforcement.
- **Network:** Outbound connection hook resolves DNS then checks against `SandboxConfig.network.allowedHosts`. Denied hosts take precedence. Blocks at connect() level. On Linux: optional network namespace isolation.
- **Process:** Command validation before exec(). Denied commands take precedence over allowed per `SandboxConfig.process`. Resource limits via platform mechanisms (ulimit/cgroups on Linux, sandbox-exec on macOS). OOM killer integration.
- **Timeout:** Timer thread monitors sandbox lifetime per `SandboxConfig.duration`. Sends SIGTERM at `maxDuration`, SIGKILL at `hardKillAfter`. Warning event emitted at `warningAt`. All child processes killed on sandbox destroy.

## 8. Audit Requirements

Every requested computer action produces exactly one complete audit path:

### 8.1 Pre-Action Audit Entry

```typescript
interface PreActionAuditEntry {
  readonly entryId: EventId;
  readonly actionId: EventId; // links to post-action entry
  readonly type: 'action:before'; // AgentEvent from SHARED_TYPES.md §16
  readonly timestamp: string;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly tenantId: TenantId;
  readonly action: ComputerAction;
  readonly verdict: GovernanceVerdict;
  readonly riskAssessment: ActionRiskAssessment;
  readonly rulesEvaluated: readonly string[];
  readonly chainHash: string;
}
```

### 8.2 Post-Action Audit Entry

```typescript
interface PostActionAuditEntry {
  readonly entryId: EventId;
  readonly actionId: EventId; // same as pre-action entry
  readonly type: 'action:after'; // AgentEvent from SHARED_TYPES.md §16
  readonly timestamp: string;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly tenantId: TenantId;
  readonly result: ActionResult;
  readonly sideEffects: readonly SideEffect[];
  readonly duration: number;
  readonly chainHash: string;
}
```

### 8.3 Refusal Audit Entry

```typescript
interface RefusalAuditEntry {
  readonly entryId: EventId;
  readonly actionId: EventId;
  readonly type: 'action:refused'; // AgentEvent from SHARED_TYPES.md §16
  readonly timestamp: string;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly tenantId: TenantId;
  readonly action: ComputerAction;
  readonly rule: string;
  readonly reason: string;
  readonly riskAssessment: ActionRiskAssessment;
  readonly chainHash: string;
}
```

### 8.4 Escalation Audit Entry

Escalation is a terminal non-execution path unless a later, separately approved request is submitted. It uses the canonical `governance:escalated` event; no `action:escalated` event is defined.

```typescript
interface EscalationAuditEntry {
  readonly entryId: EventId;
  readonly actionId: EventId;
  readonly type: 'governance:escalated'; // AgentEvent from SHARED_TYPES.md §16
  readonly timestamp: string;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly tenantId: TenantId;
  readonly action: ComputerAction;
  readonly rule: string;
  readonly reason: string;
  readonly requiredApproval: 'human' | 'senior_agent';
  readonly timeout: number | null;
  readonly riskAssessment: ActionRiskAssessment;
  readonly chainHash: string;
}
```

### 8.5 Audit Invariants

- Both pre and post entries linked by shared `actionId`
- Both hash-chained into Limen's append-only audit trail via `chainHash`
- Allowed or sandboxed executed actions produce `action:before` before execution and `action:after` after execution completes or fails
- Refused non-executed actions produce exactly one terminal `RefusalAuditEntry` (`action:refused`) and no pre-action or post-action entry
- Escalated non-executed actions produce exactly one terminal `EscalationAuditEntry` (`governance:escalated`) and no pre-action or post-action entry
- Minimal pre/post audit entries are durability-critical. Pre-action append completes before execution begins; post-action append completes before success is returned. Hash projection and visualization fanout may run asynchronously after durable append.

### 8.6 Retention Policy

Retention follows the unified policy from `SHARED_TYPES.md` §17 (`DEFAULT_RETENTION`):

| Classification of Action Target | Retention | Auto-Archive After |
|---|---|---|
| unrestricted | 90 days | 30 days |
| internal | 1 year | 90 days |
| confidential | 3 years | 1 year |
| restricted | 5 years | 2 years |
| critical | 7 years | Never |

GDPR override permitted for unrestricted, internal, confidential classifications. Restricted and critical records are retained regardless (legal hold).

## 9. Trust Model Integration

This contract adopts the unified 5-level trust model from `SHARED_TYPES.md` §5:

| Trust Level | Clearance | Computer Use Capabilities |
|---|---|---|
| untrusted | 0 | No computer use permitted |
| low | 1 | No computer use permitted |
| medium | 2 | file_access, api_calls (read-biased, sandboxed) |
| high | 3 | computer_use, browser_use, terminal_use, code_execution, network_access |
| verified | 4 | All above + process:spawn, process:kill |

Capability requirements per `SHARED_TYPES.md` §6.1 are enforced at the governance gate. An action requiring `computer_use` capability is refused if the agent's trust level is below `high`.

## 10. Rate Limiting

Rate limits follow `SHARED_TYPES.md` §18 (`DEFAULT_RATE_LIMITS`). The applicable limits for computer actions:

| §cope | Dimension | Limit | Window | Enforcement |
|---|---|---|---|---|
| per_agent | computer_actions | 100 | 60s | hard_refuse |
| per_agent | all_operations | 1000 | 60s | hard_refuse |
| per_session | all_operations | 5000 | 300s | hard_refuse |
| global | all_operations | 10000 | 60s | queue |

Precedence: most specific scope wins (`per_agent` > `per_session` > `global`). If an action would violate ANY applicable limit, the most restrictive enforcement applies.

## 11. Event Integration

This contract emits events via the unified event system (see `SHARED_TYPES.md` §16). Events used:

| Event | Emitted When |
|---|---|
| `action:before` | After governance gate, before execution |
| `action:after` | After action execution completes |
| `action:refused` | Action refused by governance |
| `governance:allowed` | Verdict is allow |
| `governance:refused` | Verdict is refuse |
| `governance:escalated` | Verdict is escalate; terminal escalation audit entry for non-executed escalations |
| `governance:sandboxed` | Verdict is sandbox |

Contract-specific event payloads (carried in `AgentEventPayload.data`):

| Event | Payload Fields |
|---|---|
| `action:before` | action, verdict, riskAssessment |
| `action:after` | action, result, sideEffects, auditEntry |
| `action:refused` | action, rule, reason, alternatives |
| `governance:escalated` | action, rule, reason, requiredApproval, timeout, riskAssessment |
| `governance:sandboxed` | action, sandboxConfig, reason |

Critical event (triggers immediate session termination):
- **Sandbox escape:** Emitted when a sandboxed action violates constraints. Payload: `{ action, violation, sandboxId }`. Triggers `session:ended` with reason `sandbox_escape`.

## 12. Performance Budget

Per `SHARED_TYPES.md` §20:

| Operation | Target | Mode |
|---|---|---|
| Governance check (rule evaluation + verdict) | <10ms | §ynchronous, in-memory rule matching |
| Audit append | <50ms | Async non-blocking, eventual consistency |
| Provenance hash | <100ms | Batched background, batch size 100 |
| Full chain verification | On-demand | Not per-operation |

The <10ms governance check target covers: rule condition matching, trust level verification, rate limit counter check, verdict production. It does NOT include post-action audit append or provenance hashing. The minimal post-action audit append is durability-critical and must complete before success is returned; hashing/projection/event fanout may continue asynchronously after the durable entry exists.

## 13. Limen v5 Graph Integration

- **Refusal nodes:** Stored as `NodeType::Refusal` in the v5 graph. Each refusal creates a node with the refused action hash, rule ID, and reason. Enables graph queries like "show all refusals for agent X in mission Y."
- **Provenance edges:** `EdgeType::Provenance` connects action audit entries to their parent mission/task nodes. Enables full traceability from mission objective to individual computer actions.
- **Governance edges:** `EdgeType::Governance` connects refusal rules to the policy nodes that define them. Enables policy lineage queries.
- **Cascade edges:** `EdgeType::Cascade` connects side effects to their causing action. Enables impact analysis ("what did this action change?").

## 14. Classification Inheritance

Action targets inherit classification from the Limen classification system (see `SHARED_TYPES.md` §3):
- File actions: classification of the file path (matched against classification rules)
- Database actions: classification of the connection/table
- Network actions: classification of the endpoint
- Browser actions: classification of the URL/domain
- If target classification > agent clearance (derived from trust level via `TRUST_TO_CLEARANCE`), action verdict is `'refuse'`

## 15. Invariants

Non-negotiable system properties. Violation constitutes a CRITICAL security event.

| # | Invariant | Verification Method |
|---|---|---|
| I-1 | Every computer action passes governance gate before execution | §tructural: action executor requires GovernanceVerdict token to proceed |
| I-2 | Every executed action produces exactly two audit entries (pre + post) | Post-condition check: afterAction always called in finally block |
| I-3 | Refusal is immediate and non-negotiable --- no retry without rule change or escalation approval | Rule engine is pure function of (action, context, rules); same input = same output |
| I-4 | Provenance chain is append-only and hash-verified | Chain append rejects entries with incorrect previousHash; no update/delete API exists |
| I-5 | §andbox escape is treated as CRITICAL security event | §andbox enforcer emits event; triggers immediate session termination |
| I-6 | Default refusal rules (DR-*) cannot be disabled, only extended | Registry rejects unregister/disable calls where rule.builtin === true |
| I-7 | Escalation requires explicit approval before action proceeds | Escalation handler blocks until approval received or timeout fires (auto-refuse) |
| I-8 | Action history is immutable --- no deletion, only tombstoning with GDPR erasure | No DELETE API on provenance/audit tables; GDPR erasure replaces content with tombstone preserving chain hashes |
| I-9 | Rate limits enforced per unified policy (SHARED_TYPES.md §18) | Atomic counter increment before action; checked in governance gate |
| I-10 | All governance decisions are auditable and queryable via ProvenanceQuery | Every verdict produces an EventId linking to audit trail; query API covers all filter dimensions |

---

## Appendix A: Risk Scoring Matrix

| Category | Base Risk | Modifiers |
|---|---|---|
| filesystem:read | safe | +1 if outside project, +2 if classified path |
| filesystem:write | monitored | +1 if outside project, +2 if system path, +1 if binary |
| filesystem:delete | high | +1 if recursive, +2 if system path |
| terminal | high | +2 if sudo/doas, +1 if pipes to external, -1 if read-only command |
| browser:navigate | monitored | +1 if non-HTTPS, +2 if IP address, +1 if auth-related URL |
| browser:click/input | monitored | +1 if on payment/auth form |
| browser:extract | safe | +1 if extracting from auth-related page |
| network:connect | high | +2 if non-allowlisted host, +1 if non-standard port |
| code:execute | high | +2 if untrusted source, -1 if read-only sandbox |
| process:spawn | high | +2 if system process, +1 if network-capable |
| process:kill | dangerous | +2 if system PID |
| clipboard:access | monitored | +1 if contains URL/credentials pattern |
| database:query (read-only) | monitored | +1 if classified connection |
| database:query (mutating) | dangerous | +2 if DDL, +1 if production connection |
| api:call | monitored | +1 if POST/PUT/DELETE, +2 if non-allowlisted host |

**Composite Score Formula:**

```
base_scores = { safe: 10, monitored: 30, elevated: 50, dangerous: 70, forbidden: 90 }
composite = base_scores[category_base_risk] + sum(modifier_values)
composite = clamp(composite, 0, 100)
final_level = safe if composite < 20, monitored if < 40, elevated if < 60, dangerous if < 80, forbidden otherwise
```

Each modifier in the table above is an integer added to the base score. Example: `filesystem:write` (base `monitored`=30) outside project (+1×10=+10) to system path (+2×10=+20) = 30+10+20 = 60 → `elevated`. Modifier unit is 10 points per modifier level (e.g., +1 = +10 points, +2 = +20 points, -1 = -10 points).

Score mapping: safe=0-19, monitored=20-39, elevated=40-59, dangerous=60-79, forbidden=80-100

## Appendix B: GDPR Erasure Protocol

When GDPR erasure is required for action history:
1. Identify all provenance entries containing PII for the subject
2. Replace action payload content with tombstone: `{ erased: true, erasureId: EventId, erasedAt: string }`
3. Preserve chain hashes (integrity maintained --- content hashed at time of recording, tombstone does not break chain)
4. Preserve structural metadata (actionId, timestamp, verdict type, risk level)
5. Record erasure event in separate erasure log with legal basis
6. Provenance chain `verify()` treats tombstoned entries as valid (hash was computed before erasure)

GDPR override applicability governed by `RetentionPolicy.gdprOverride` per classification level (see `SHARED_TYPES.md` §17). Restricted and critical classifications are NOT erasable via GDPR.

## Appendix C: Event Sequence Diagram

```
Agent                  Governor              RuleEngine            ProvenanceChain        AuditLog
  |                      |                      |                      |                    |
  |-- requestAction() -->|                      |                      |                    |
  |                      |-- evaluateRisk() --->|                      |                    |
  |                      |<-- RiskAssessment ---|                      |                    |
  |                      |-- beforeAction() ---->|                      |                    |
  |                      |<-- Verdict ----------|                      |                    |
  |                      |                      |                      |                    |
  |                      |--- [if refuse] ----->|                      |                    |
  |                      |                      |                      |-- append(refused) ->|
  |<-- RefuseVerdict ----|                      |                      |                    |
  |                      |                      |                      |                    |
  |                      |--- [if allow] ------>|                      |                    |
  |                      |                      |-- append(pre) ------>|                    |
  |                      |                      |                      |-- write(pre) ----->|
  |<-- AllowVerdict -----|                      |                      |                    |
  |                      |                      |                      |                    |
  |-- executeAction() -->|                      |                      |                    |
  |<-- ActionResult -----|                      |                      |                    |
  |                      |                      |                      |                    |
  |-- reportResult() --->|                      |                      |                    |
  |                      |                      |-- append(post) ----->|                    |
  |                      |                      |                      |-- write(post) ---->|
  |<-- AuditEntry -------|                      |                      |                    |
```

## Appendix D: Rust Trait (v5 Alignment)

The Rust implementation uses shared types from `SHARED_TYPES.md` §25 directly. Contract-specific Rust types:

```rust
/// Risk levels with Ord for comparison
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionRiskLevel {
    Safe = 0,
    Monitored = 1,
    Elevated = 2,
    Dangerous = 3,
    Forbidden = 4,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionCategory {
    Filesystem,
    Terminal,
    Browser,
    Network,
    CodeExecution,
    Process,
    Clipboard,
    Database,
    Custom,
}

/// Risk assessment
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ActionRiskAssessment {
    pub level: ActionRiskLevel,
    pub category: ActionCategory,
    pub factors: Vec<RiskFactor>,
    pub score: u8, // 0-100
    pub explanation: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RiskFactor {
    pub name: String,
    pub weight: f32,
    pub value: u8,
    pub reason: String,
}

/// Action result
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ActionResult {
    pub success: bool,
    pub output: Option<serde_json::Value>,
    pub error: Option<String>,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub side_effects: Vec<SideEffect>,
    pub bytes_read: u64,
    pub bytes_written: u64,
}

/// Side effect
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SideEffect {
    pub effect_type: SideEffectType,
    pub target: String,
    pub reversible: bool,
    pub timestamp: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SideEffectType {
    FileCreated,
    FileModified,
    FileDeleted,
    ProcessSpawned,
    ProcessKilled,
    NetworkRequest,
    DataWritten,
    DataDeleted,
    StateChanged,
    PermissionChanged,
}

/// Governance error
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GovernanceError {
    RuleEvaluationFailed { rule_id: String, cause: String },
    ChainIntegrityViolation { expected_hash: String, actual_hash: String },
    SandboxCreationFailed { reason: String },
    AuditWriteFailed { reason: String },
    Timeout { operation: String, elapsed_ms: u64 },
}

/// The core trait — uses shared types for ComputerAction, GovernanceVerdict, SandboxConfig
pub trait ComputerActionGovernor: Send + Sync {
    fn before_action(
        &self,
        action: &ComputerAction,       // from SHARED_TYPES §25
        meta: &ActionMeta,
        context: &GovernanceContext,    // from SHARED_TYPES §25
    ) -> impl Future<Output = Result<GovernanceVerdict, GovernanceError>> + Send;

    fn after_action(
        &self,
        action: &ComputerAction,
        meta: &ActionMeta,
        result: &ActionResult,
        context: &GovernanceContext,
    ) -> impl Future<Output = Result<AuditEntry, GovernanceError>> + Send;

    fn evaluate_risk(
        &self,
        action: &ComputerAction,
        meta: &ActionMeta,
    ) -> ActionRiskAssessment;
}

/// Action metadata shared across all variants.
/// NOTE: In TypeScript, ActionBase fields are embedded in each ComputerAction variant
/// via `extends ActionBase`. In Rust, ActionMeta is a separate struct passed alongside
/// ComputerAction. This separation exists because Rust's ownership model makes embedded
/// base fields in enum variants ergonomically costly (each variant would duplicate 6 fields).
/// The semantic contract is identical: every governance call receives both the action
/// variant AND its metadata. Implementers must ensure both are populated.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ActionMeta {
    pub request_id: EventId,    // from SHARED_TYPES §25
    pub timestamp: String,
    pub agent_id: AgentId,      // from SHARED_TYPES §25
    pub session_id: SessionId,  // from SHARED_TYPES §25
    pub mission_id: Option<MissionId>,
    pub task_id: Option<TaskId>,
}

/// Audit entry produced by after_action
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuditEntry {
    pub entry_id: EventId,
    pub action_id: EventId,
    pub timestamp: String,
    pub chain_hash: String,
    pub previous_hash: String,
    pub sequence_number: u64,
}
```

---

## Appendix E: Version History

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-05-05 | Initial ratification. |
| 2.0.0 | 2026-05-05 | Deduplicated to reference SHARED_TYPES.md. Adopted unified 5-level trust model, unified retention, unified rate limits, unified event system, unified performance budget. Removed all type redefinitions. |
| 2.1.0 | 2026-05-05 | Aligned CDM v2.1, canonical verdict naming, refusal/audit cardinality, and manifest hash binding. |
| 2.2.0 | 2026-05-05 | Added canonical terminal escalation audit schema and explicit refusal/escalation audit cardinality. |
