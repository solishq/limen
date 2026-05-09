<!-- @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->
# Limen v5 -- COMPUTER_USE_GOVERNANCE.md Requirement Extraction

**Source:** `contracts/COMPUTER_USE_GOVERNANCE.md` v2.2.0
**Extracted:** 2026-05-09
**Governing Standard:** SolisForge Protocol v1.4
**Governance Tier:** Forge Critical
**Purpose:** Every implementable requirement from the Computer Use Governance contract.

---

## Section 1: Purpose & Scope

| ID | Requirement | Source |
|---|---|---|
| CU-1.1 | Contract scope covers governance, audit, and optional refusal for all AI agent computer actions | S1 |
| CU-1.2 | Contract is agent-agnostic -- applies uniformly to Claude Computer Use, Codex, browser automation, terminal, API calls, and any future action type | S1 |
| CU-1.3 | All computer actions MUST flow through a governance gate that evaluates risk, enforces policy, records provenance, and produces immutable hash-chained audit trail | S1 |
| CU-1.4 | All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`; this contract does NOT redefine any shared type | Preamble |

**Totals: 4 requirements**

---

## Section 2: Type References

| ID | Requirement | Source |
|---|---|---|
| CU-2.1 | Implementation MUST use all shared types listed in S2 table from SHARED_TYPES.md without redefinition: `ActionBase`, `ComputerAction` (17 variants), `ComputerActionType`, `GovernanceContext`, `GovernanceAction`, `GovernanceVerdict`, `AgentSession`, `AgentTrustLevel`, `TRUST_TO_CLEARANCE`, `SandboxConfig` (5 sub-configs), `RefusalRule`, `RefusalCondition` (9 variants), `RateLimitPolicy`, `DEFAULT_RATE_LIMITS`, `RetentionPolicy`, `DEFAULT_RETENTION`, `ActionDigest`, `AgentEvent`, `AgentEventPayload`, `AgentEventBus`, `PerformanceBudget`, branded IDs, `OperationContext`, `Result`, `KernelError`, `ClassificationLevel`, `CLASSIFICATION_NUMERIC` | S2 |

**Totals: 1 requirement**

---

## Section 3: Contract-Specific Types

| ID | Requirement | Source |
|---|---|---|
| CU-3.1 | `ActionRiskLevel` MUST be `'safe' | 'monitored' | 'elevated' | 'dangerous' | 'forbidden'` | S3.1 |
| CU-3.2 | `ActionRiskLevel` numeric mapping MUST be: safe=0, monitored=1, elevated=2, dangerous=3, forbidden=4 | S3.1 |
| CU-3.3 | `ActionCategory` MUST be `'filesystem' | 'terminal' | 'browser' | 'network' | 'code_execution' | 'process' | 'clipboard' | 'database' | 'custom'` | S3.2 |
| CU-3.4 | `ActionRiskAssessment` MUST include `level`, `category`, `factors`, `score` (0-100), `explanation` | S3.3 |
| CU-3.5 | `RiskFactor` MUST include `name`, `weight` (0.0-1.0), `value` (0-100), `reason` | S3.3 |
| CU-3.6 | `ActionResult.success` MUST be boolean | S3.4 |
| CU-3.7 | `ActionResult.output` MUST be `unknown | null` | S3.4 |
| CU-3.8 | `ActionResult.error` MUST be `string | null` | S3.4 |
| CU-3.9 | `ActionResult.exitCode` MUST be `number | null` (for terminal/process actions) | S3.4 |
| CU-3.10 | `ActionResult.duration` MUST be milliseconds | S3.4 |
| CU-3.11 | `ActionResult.sideEffects` MUST be `readonly SideEffect[]` | S3.4 |
| CU-3.12 | `ActionResult` MUST include `bytesRead` and `bytesWritten` | S3.4 |
| CU-3.13 | `SideEffect.type` MUST be one of 10 values: `file_created`, `file_modified`, `file_deleted`, `process_spawned`, `process_killed`, `network_request`, `data_written`, `data_deleted`, `state_changed`, `permission_changed` | S3.5 |
| CU-3.14 | `SideEffect` MUST include `target`, `reversible`, `reverseAction` (nullable `ComputerAction`), `timestamp` | S3.5 |
| CU-3.15 | `GovernanceError` MUST be discriminated union with 5 codes: `RULE_EVALUATION_FAILED`, `CHAIN_INTEGRITY_VIOLATION`, `SANDBOX_CREATION_FAILED`, `AUDIT_WRITE_FAILED`, `TIMEOUT` | S3.6 |
| CU-3.16 | `RULE_EVALUATION_FAILED` MUST include `ruleId` and `cause` | S3.6 |
| CU-3.17 | `CHAIN_INTEGRITY_VIOLATION` MUST include `expectedHash` and `actualHash` | S3.6 |
| CU-3.18 | `TIMEOUT` MUST include `operation` and `elapsedMs` | S3.6 |
| CU-3.19 | `SANDBOX_CREATION_FAILED` MUST include `reason: string` describing the sandbox creation failure | S3.6 |
| CU-3.20 | `AUDIT_WRITE_FAILED` MUST include `reason: string` describing the audit write failure | S3.6 |

**Totals: 20 requirements**

---

## Section 4: Governance Hooks

| ID | Requirement | Source |
|---|---|---|
| CU-4.1 | `ComputerActionGovernor.beforeAction(action, context)` MUST return `Promise<Result<GovernanceVerdict>>` | S4.1 |
| CU-4.2 | `beforeAction` MUST be called for every action (primary governance gate) | S4.1 |
| CU-4.3 | `beforeAction` latency budget MUST be <10ms | S4.1 |
| CU-4.4 | `ComputerActionGovernor.afterAction(action, result, context)` MUST return `Promise<Result<AuditEntry>>` | S4.1 |
| CU-4.5 | `afterAction` minimal post-action audit entry MUST be durably appended before action result is returned as success | S4.1 |
| CU-4.6 | If audit append fails, session MUST be quarantined and caller MUST receive `AUDIT_APPEND_FAILED` instead of success | S4.1 |
| CU-4.7 | `ComputerActionGovernor.evaluateRisk(action)` MUST return `ActionRiskAssessment` synchronously (no I/O, no state mutation) | S4.1 |
| CU-4.8 | `EnrichedVerdict` MUST include `base: GovernanceVerdict`, `riskAssessment`, `evaluatedRules` | S4.2 |
| CU-4.9 | `AuditEntry` MUST include `entryId`, `actionId`, `timestamp`, `chainHash` (SHA-256), `previousHash`, `sequenceNumber` (monotonically increasing per session) | S4.3 |
| CU-4.10 | `AuditEntry.previousHash` genesis value MUST be `'0'.repeat(64)` | S4.3 |

**Totals: 10 requirements**

---

## Section 5: Refusal Rules Engine

| ID | Requirement | Source |
|---|---|---|
| CU-5.1 | Rules MUST use shared `RefusalRule` and `RefusalCondition` types from SHARED_TYPES S13 | S5.1 |
| CU-5.2 | Evaluation MUST proceed in priority order (lower = higher priority) | S5.1 |
| CU-5.3 | Specificity MUST be deterministic tie-breaker within equal priority (exact > glob > wildcard) | S5.1 |
| CU-5.4 | First matching rule determines verdict; if no rule matches, verdict is `allow` | S5.1 |
| CU-5.5 | All matching rules MUST be retained in provenance | S5.1 |
| CU-5.6 | Default rule DR-001 (priority 0, refuse) MUST block destructive system commands: `rm -rf /`, `format`, `fdisk`, `mkfs`, `dd` | S5.2 |
| CU-5.7 | Default rule DR-002 (priority 0, refuse) MUST block writes to `/etc/passwd`, `/etc/shadow`, `/etc/sudoers`, `/System/` | S5.2 |
| CU-5.8 | Default rule DR-003 (priority 1, refuse) MUST block credential file access for trust below high | S5.2 |
| CU-5.9 | Default rule DR-004 (priority 2, refuse) MUST block outbound network to unknown hosts | S5.2 |
| CU-5.10 | Default rule DR-005 (priority 1, escalate) MUST escalate destructive git operations | S5.2 |
| CU-5.11 | Default rule DR-006 (priority 1, escalate) MUST escalate destructive database operations (DROP, TRUNCATE, ALTER) on production | S5.2 |
| CU-5.12 | Default rule DR-007 (priority 3, sandbox) MUST sandbox low-trust code execution | S5.2 |
| CU-5.13 | Default rule DR-008 (priority 4, refuse) MUST block file writes outside project directory | S5.2 |
| CU-5.14 | Default rule DR-009 (priority 5, refuse) MUST enforce rate limit: 100 computer_actions per 60s per agent | S5.2 |
| CU-5.15 | Default rule DR-010 (priority 0, refuse) MUST block system process termination (PID 1 or system processes) | S5.2 |
| CU-5.16 | Default rule DR-011 (priority 1, refuse) MUST block git internal file deletion (`.git/*`) | S5.2 |
| CU-5.17 | `RefusalRuleRegistry.register` MUST fail on ID conflict; custom rules CANNOT have priority < 10 (0-9 reserved for builtins) | S5.3 |
| CU-5.18 | Builtin rules (DR-*) MUST NOT be unregistered or disabled | S5.3 |

**Totals: 18 requirements**

---

## Section 5 (continued): RefusalRuleRegistry Interface

| ID | Requirement | Source |
|---|---|---|
| CU-5.19 | `register(rule: RefusalRule)` MUST return `Result<void>` | S5.3 |
| CU-5.20 | `unregister(ruleId: string)` MUST return `Result<void>`; builtin rules CANNOT be unregistered | S5.3 |
| CU-5.21 | `setEnabled(ruleId: string, enabled: boolean)` MUST return `Result<void>`; builtin rules CANNOT be disabled | S5.3 |
| CU-5.22 | `list(filter?)` MUST return all rules ordered by priority ascending | S5.3 |
| CU-5.23 | `evaluate(action, context)` MUST return first matching rule's verdict; if no match returns `'allow'` | S5.3 |
| CU-5.24 | `dryRun(action, context)` MUST evaluate without recording audit entry | S5.3 |
| CU-5.25 | `list(filter?)` filter parameter shape MUST be `{ enabled?: boolean; builtin?: boolean; verdict?: string }` | S5.3 |

**Totals: 7 requirements**

---

## Section 6: Provenance Chain

| ID | Requirement | Source |
|---|---|---|
| CU-6.1 | `ActionProvenance` MUST include `actionId`, `parentActionId` (nullable), `sessionId`, `agentId`, `missionId` (nullable), `taskId` (nullable), `tenantId`, `timestamp`, `action`, `verdict`, `result` (nullable), `chainHash`, `previousHash`, `sequenceNumber` | S6.1 |
| CU-6.2 | `result` is null if action was refused/pending | S6.1 |
| CU-6.3 | `previousHash` genesis MUST be `'0'.repeat(64)` | S6.1 |
| CU-6.4 | `ProvenanceChain.append` MUST compute `chainHash` from `SHA-256(previousHash + actionId + timestamp + JSON(action) + JSON(verdict))` | S6.2 |
| CU-6.5 | Provenance hash MUST be batched background per SHARED_TYPES S20 (<100ms, batch size 100) | S6.2 |
| CU-6.6 | `ProvenanceChain.verify(sessionId)` MUST verify chain integrity from genesis to head | S6.2 |
| CU-6.7 | Chain verification MUST be on-demand only (not per-operation) | S6.2 |
| CU-6.8 | `ProvenanceChain.head(sessionId)` MUST return latest entry or null | S6.2 |
| CU-6.9 | `ProvenanceChain.query(filter)` MUST return filtered entries | S6.2 |
| CU-6.10 | `ProvenanceChain.length(sessionId)` MUST return chain length | S6.2 |
| CU-6.11 | `ProvenanceQuery` MUST support filtering by `sessionId`, `agentId`, `missionId`, `actionType`, `timeRange`, `verdictFilter`, `riskLevelMin` with required `limit` (max 1000), `offset`, `order` | S6.3 |
| CU-6.12 | `sequenceNumber` MUST be monotonically increasing per session | S6.1 |

**Totals: 12 requirements**

---

## Section 7: Sandboxing

| ID | Requirement | Source |
|---|---|---|
| CU-7.1 | `SandboxEnforcer.create(config)` MUST return `Result<SandboxHandle>` | S7.1 |
| CU-7.2 | `SandboxEnforcer.execute(handle, action)` MUST return `Promise<Result<ActionResult>>` enforcing all constraints | S7.1 |
| CU-7.3 | `SandboxEnforcer.destroy(handle)` MUST return `Result<void>` and clean up resources | S7.1 |
| CU-7.4 | `SandboxEnforcer.stats(handle)` MUST return `Result<SandboxStats>` | S7.1 |
| CU-7.5 | `SandboxHandle` MUST include `id`, `config`, `createdAt`, `state` (`'active' | 'expired' | 'destroyed'`) | S7.1 |
| CU-7.6 | `SandboxStats` MUST include `memoryUsedBytes`, `cpuPercent`, `diskUsedBytes`, `processCount`, `networkConnections`, `elapsedMs`, `actionsExecuted` | S7.1 |
| CU-7.7 | Filesystem enforcement MUST resolve symlinks before checking against `SandboxConfig.filesystem.allowedPaths`; MUST block path traversal (`../`); denied paths take precedence | S7.2 |
| CU-7.8 | Network enforcement MUST resolve DNS then check against allowed hosts; denied hosts take precedence; block at connect() level | S7.2 |
| CU-7.9 | Process enforcement MUST validate commands before exec(); denied commands take precedence; resource limits via platform mechanisms | S7.2 |
| CU-7.10 | Timeout enforcement: SIGTERM at `maxDuration`, SIGKILL at `hardKillAfter`, warning event at `warningAt`; all child processes killed on sandbox destroy | S7.2 |

**Totals: 10 requirements**

---

## Section 8: Audit Requirements

| ID | Requirement | Source |
|---|---|---|
| CU-8.1 | `PreActionAuditEntry` MUST include `entryId`, `actionId`, `type: 'action:before'`, `timestamp`, `agentId`, `sessionId`, `tenantId`, `action`, `verdict`, `riskAssessment`, `rulesEvaluated`, `chainHash` | S8.1 |
| CU-8.2 | `PostActionAuditEntry` MUST include `entryId`, `actionId`, `type: 'action:after'`, `timestamp`, `agentId`, `sessionId`, `tenantId`, `result`, `sideEffects`, `duration`, `chainHash` | S8.2 |
| CU-8.3 | `RefusalAuditEntry` MUST include `entryId`, `actionId`, `type: 'action:refused'`, `timestamp`, `agentId`, `sessionId`, `tenantId`, `action`, `rule`, `reason`, `riskAssessment`, `chainHash` | S8.3 |
| CU-8.4 | `EscalationAuditEntry` MUST include `entryId`, `actionId`, `type: 'governance:escalated'`, `timestamp`, `agentId`, `sessionId`, `tenantId`, `action`, `rule`, `reason`, `requiredApproval` (`'human' | 'senior_agent'`), `timeout` (nullable), `riskAssessment`, `chainHash` | S8.4 |
| CU-8.5 | Pre and post entries MUST be linked by shared `actionId` | S8.5 |
| CU-8.6 | Both entries MUST be hash-chained into Limen's append-only audit trail | S8.5 |
| CU-8.7 | Allowed/sandboxed executed actions MUST produce `action:before` before execution and `action:after` after execution | S8.5 |
| CU-8.8 | Refused actions MUST produce exactly one terminal `RefusalAuditEntry` (`action:refused`) and NO pre-action or post-action entry | S8.5 |
| CU-8.9 | Escalated actions MUST produce exactly one terminal `EscalationAuditEntry` (`governance:escalated`) and NO pre-action or post-action entry | S8.5 |
| CU-8.10 | Pre-action append MUST complete before execution begins | S8.5 |
| CU-8.11 | Post-action append MUST complete before success is returned | S8.5 |
| CU-8.12 | Hash projection and visualization fanout MAY run asynchronously after durable append | S8.5 |
| CU-8.13 | Escalation is terminal non-execution path unless later approved request submitted | S8.4 |
| CU-8.14 | Retention for unrestricted: 90 days, auto-archive 30 days | S8.6 |
| CU-8.15 | Retention for critical: 7 years, never auto-archive | S8.6 |
| CU-8.16 | GDPR override permitted for unrestricted, internal, confidential; restricted and critical retained regardless (legal hold) | S8.6 |

**Totals: 16 requirements**

---

## Section 9: Trust Model Integration

| ID | Requirement | Source |
|---|---|---|
| CU-9.1 | `untrusted` and `low` trust levels MUST have no computer use permitted | S9 |
| CU-9.2 | `medium` trust MUST permit `file_access`, `api_calls` (read-biased, sandboxed) | S9 |
| CU-9.3 | `high` trust MUST permit `computer_use`, `browser_use`, `terminal_use`, `code_execution`, `network_access` | S9 |
| CU-9.4 | `verified` trust MUST permit all above + `process:spawn`, `process:kill` | S9 |
| CU-9.5 | Action requiring `computer_use` capability MUST be refused if agent trust level below `high` | S9 |

**Totals: 5 requirements**

---

## Section 10: Rate Limiting

| ID | Requirement | Source |
|---|---|---|
| CU-10.1 | Per-agent computer_actions limit: 100 per 60s, enforcement: hard_refuse | S10 |
| CU-10.2 | Per-agent all_operations limit: 1000 per 60s, enforcement: hard_refuse | S10 |
| CU-10.3 | Per-session all_operations limit: 5000 per 300s, enforcement: hard_refuse | S10 |
| CU-10.4 | Most specific scope wins (per_agent > per_session > global); if action violates ANY limit, most restrictive enforcement applies | S10 |
| CU-10.5 | Global all_operations limit: 10000 per 60s, enforcement: queue (requests queued until capacity available) | S10 |

**Totals: 5 requirements**

---

## Section 11: Event Integration

| ID | Requirement | Source |
|---|---|---|
| CU-11.1 | Event `action:before` MUST be emitted after governance gate, before execution | S11 |
| CU-11.2 | Event `action:after` MUST be emitted after action execution completes | S11 |
| CU-11.3 | Event `action:refused` MUST be emitted when action refused by governance | S11 |
| CU-11.4 | Event `governance:allowed` MUST be emitted when verdict is allow | S11 |
| CU-11.5 | Event `governance:refused` MUST be emitted when verdict is refuse | S11 |
| CU-11.6 | Event `governance:escalated` MUST be emitted when verdict is escalate (terminal escalation audit entry) | S11 |
| CU-11.7 | Event `governance:sandboxed` MUST be emitted when verdict is sandbox | S11 |
| CU-11.8 | **Sandbox escape** is a critical event: MUST trigger immediate session termination; payload `{ action, violation, sandboxId }` triggers `session:ended` with reason `sandbox_escape` | S11 |
| CU-11.9 | Event payloads MUST follow the specified field sets per event type in S11 table | S11 |
| CU-11.10 | **NOTE (Appendix C):** Event sequence ordering constraints: `governance:allowed` or `governance:refused` MUST precede `action:before`; `action:before` MUST precede `action:after`; `action:refused` and `governance:escalated` are terminal (no subsequent action events for that actionId) | App C |

**Totals: 10 requirements**

---

## Section 12: Performance Budget

| ID | Requirement | Source |
|---|---|---|
| CU-12.1 | Governance check (rule evaluation + verdict) target MUST be <10ms, synchronous in-memory | S12 |
| CU-12.2 | Audit append target MUST be <50ms, async non-blocking | S12 |
| CU-12.3 | Provenance hash target MUST be <100ms, batched background (batch size 100) | S12 |
| CU-12.4 | Full chain verification MUST be on-demand only, not per-operation | S12 |

**Totals: 4 requirements**

---

## Section 13: Limen v5 Graph Integration

| ID | Requirement | Source |
|---|---|---|
| CU-13.1 | Refusal nodes MUST be stored as `NodeType::Refusal` in v5 graph with refused action hash, rule ID, reason | S13 |
| CU-13.2 | Provenance edges (`EdgeType::Provenance`) MUST connect action audit entries to parent mission/task nodes | S13 |
| CU-13.3 | Governance edges (`EdgeType::Governance`) MUST connect refusal rules to policy nodes | S13 |
| CU-13.4 | Cascade edges (`EdgeType::Cascade`) MUST connect side effects to causing action | S13 |

**Totals: 4 requirements**

---

## Section 14: Classification Inheritance

| ID | Requirement | Source |
|---|---|---|
| CU-14.1 | File actions MUST inherit classification from file path matching against classification rules | S14 |
| CU-14.2 | Database actions MUST inherit classification from connection/table | S14 |
| CU-14.3 | Network actions MUST inherit classification from endpoint | S14 |
| CU-14.4 | Browser actions MUST inherit classification from URL/domain | S14 |
| CU-14.5 | If target classification > agent clearance (via `TRUST_TO_CLEARANCE`), verdict MUST be `'refuse'` | S14 |

**Totals: 5 requirements**

---

## Section 15: Invariants

| ID | Requirement | Source |
|---|---|---|
| CU-15.1 | **I-1:** Every computer action MUST pass governance gate before execution; structurally enforced (executor requires GovernanceVerdict token) | S15 |
| CU-15.2 | **I-2:** Every executed action MUST produce exactly two audit entries (pre + post); afterAction always called in finally block | S15 |
| CU-15.3 | **I-3:** Refusal is immediate and non-negotiable -- no retry without rule change or escalation approval; rule engine is pure function | S15 |
| CU-15.4 | **I-4:** Provenance chain is append-only and hash-verified; chain append rejects entries with incorrect previousHash; no update/delete API | S15 |
| CU-15.5 | **I-5:** Sandbox escape MUST be treated as CRITICAL security event; triggers immediate session termination | S15 |
| CU-15.6 | **I-6:** Default refusal rules (DR-*) CANNOT be disabled, only extended; registry rejects unregister/disable where `rule.builtin === true` | S15 |
| CU-15.7 | **I-7:** Escalation MUST require explicit approval before action proceeds; handler blocks until approval or timeout (auto-refuse) | S15 |
| CU-15.8 | **I-8:** Action history is immutable -- no deletion, only tombstoning; GDPR erasure replaces content preserving chain hashes | S15 |
| CU-15.9 | **I-9:** Rate limits MUST be enforced per unified policy; atomic counter increment before action | S15 |
| CU-15.10 | **I-10:** All governance decisions MUST be auditable and queryable via ProvenanceQuery | S15 |

**Totals: 10 requirements**

---

## Appendix A: Risk Scoring Matrix

| ID | Requirement | Source |
|---|---|---|
| CU-A.1 | `filesystem:read` base risk MUST be `safe` with modifiers: +1 outside project, +2 classified path | App A |
| CU-A.2 | `filesystem:write` base risk MUST be `monitored` with modifiers: +1 outside project, +2 system path, +1 binary | App A |
| CU-A.3 | `filesystem:delete` base risk MUST be `high` with modifiers: +1 recursive, +2 system path | App A |
| CU-A.4 | `terminal` base risk MUST be `high` with modifiers: +2 sudo/doas, +1 pipes to external, -1 read-only | App A |
| CU-A.5 | `browser:navigate` base risk MUST be `monitored` with modifiers: +1 non-HTTPS, +2 IP address, +1 auth-related URL | App A |
| CU-A.6 | `browser:click/input` base risk MUST be `monitored` with modifier: +1 payment/auth form | App A |
| CU-A.7 | `browser:extract` base risk MUST be `safe` with modifier: +1 auth-related page | App A |
| CU-A.8 | `network:connect` base risk MUST be `high` with modifiers: +2 non-allowlisted host, +1 non-standard port | App A |
| CU-A.9 | `code:execute` base risk MUST be `high` with modifiers: +2 untrusted source, -1 read-only sandbox | App A |
| CU-A.10 | `process:spawn` base risk MUST be `high` with modifiers: +2 system process, +1 network-capable | App A |
| CU-A.11 | `process:kill` base risk MUST be `dangerous` with modifier: +2 system PID | App A |
| CU-A.12 | `clipboard:access` base risk MUST be `monitored` with modifier: +1 URL/credentials pattern | App A |
| CU-A.13 | `database:query` (read-only) base risk MUST be `monitored` with modifier: +1 classified connection | App A |
| CU-A.14 | `database:query` (mutating) base risk MUST be `dangerous` with modifiers: +2 DDL, +1 production | App A |
| CU-A.15 | `api:call` base risk MUST be `monitored` with modifiers: +1 POST/PUT/DELETE, +2 non-allowlisted host | App A |
| CU-A.16 | Base scores MUST be: safe=10, monitored=30, elevated=50, dangerous=70, forbidden=90 | App A Formula |
| CU-A.17 | Modifier unit MUST be 10 points per modifier level (+1=+10, +2=+20, -1=-10) | App A Formula |
| CU-A.18 | Score mapping MUST be: safe=0-19, monitored=20-39, elevated=40-59, dangerous=60-79, forbidden=80-100; composite clamped to [0, 100] | App A Formula |

**Totals: 18 requirements**

---

## Appendix B: GDPR Erasure Protocol

| ID | Requirement | Source |
|---|---|---|
| CU-B.1 | GDPR erasure MUST identify all provenance entries containing PII for the subject | App B |
| CU-B.2 | Action payload content MUST be replaced with tombstone: `{ erased: true, erasureId: EventId, erasedAt: string }` | App B |
| CU-B.3 | Chain hashes MUST be preserved (content hashed at recording time; tombstone does not break chain) | App B |
| CU-B.4 | Structural metadata (`actionId`, `timestamp`, `verdict type`, `risk level`) MUST be preserved | App B |
| CU-B.5 | Erasure event MUST be recorded in separate erasure log with legal basis | App B |
| CU-B.6 | Provenance chain `verify()` MUST treat tombstoned entries as valid | App B |

**Totals: 6 requirements**

---

## Appendix D: Rust Trait

| ID | Requirement | Source |
|---|---|---|
| CU-D.1 | Rust `ActionRiskLevel` MUST derive `Ord` for comparison with values Safe=0 through Forbidden=4 | App D |
| CU-D.2 | Rust `ActionCategory` MUST be enum with 9 variants matching TS | App D |
| CU-D.3 | Rust `ActionRiskAssessment` MUST have `level`, `category`, `factors: Vec<RiskFactor>`, `score: u8` (0-100), `explanation` | App D |
| CU-D.4 | Rust `RiskFactor` MUST have `name`, `weight: f32`, `value: u8`, `reason` | App D |
| CU-D.5 | Rust `ActionResult` MUST have `success`, `output` (Option<serde_json::Value>), `error`, `exit_code`, `duration_ms: u64`, `side_effects`, `bytes_read: u64`, `bytes_written: u64` | App D |
| CU-D.6 | Rust `SideEffect` MUST have `effect_type`, `target`, `reversible`, `timestamp` | App D |
| CU-D.7 | **GAP (TC-21):** Rust `SideEffect` omits `reverse_action` field present in TS (`reverseAction: ComputerAction | null`); implementation MUST add or document omission | TC-21 Gap |
| CU-D.8 | Rust `SideEffectType` MUST be enum with 10 variants matching TS | App D |
| CU-D.9 | Rust `GovernanceError` MUST be tagged enum with 5 variants matching TS `GovernanceError` | App D |
| CU-D.10 | Rust trait `ComputerActionGovernor` MUST be `Send + Sync` | App D |
| CU-D.11 | Rust `before_action` MUST accept `&ComputerAction`, `&ActionMeta`, `&GovernanceContext` and return `Result<GovernanceVerdict, GovernanceError>` | App D |
| CU-D.12 | Rust `after_action` MUST accept `&ComputerAction`, `&ActionMeta`, `&ActionResult`, `&GovernanceContext` and return `Result<AuditEntry, GovernanceError>` | App D |
| CU-D.13 | Rust `evaluate_risk` MUST accept `&ComputerAction`, `&ActionMeta` and return `ActionRiskAssessment` (synchronous) | App D |
| CU-D.14 | Rust `ActionMeta` MUST have `request_id: EventId`, `timestamp`, `agent_id`, `session_id`, `mission_id` (Option), `task_id` (Option) | App D |
| CU-D.15 | Rust `ActionMeta` exists because Rust ownership makes embedded base fields in enum variants costly; semantic contract identical to TS ActionBase | App D Note |
| CU-D.16 | Rust `AuditEntry` MUST have `entry_id`, `action_id`, `timestamp`, `chain_hash`, `previous_hash`, `sequence_number: u64` | App D |
| CU-D.17 | **GAP (TC-21):** Rust trait has no `RefusalRuleRegistry` equivalent; implementation MUST define Rust rule registration | TC-21 Gap |
| CU-D.18 | **GAP (TC-21):** Rust trait has no `ProvenanceChain` equivalent; implementation MUST define Rust provenance chain | TC-21 Gap |
| CU-D.19 | **GAP (TC-21):** Rust trait has no `SandboxEnforcer` equivalent; implementation MUST define Rust sandbox enforcement | TC-21 Gap |
| CU-D.20 | **GAP (TC-21):** Rust types missing for `EnrichedVerdict`, `PreActionAuditEntry`, `PostActionAuditEntry`, `RefusalAuditEntry`, `EscalationAuditEntry`, `ActionProvenance`, `ProvenanceQuery`, `SandboxHandle`, `SandboxStats`; implementation MUST define all | TC-21 Gap |
| CU-D.21 | All Rust structs MUST derive `Clone, Debug, Serialize, Deserialize` | App D |
| CU-D.22 | All Rust enums MUST use `#[serde(rename_all = "snake_case")]` | App D |

**Totals: 22 requirements**

---

## Grand Total

| Section | Count |
|---|---|
| Section 1: Purpose & Scope | 4 |
| Section 2: Type References | 1 |
| Section 3: Contract-Specific Types | 20 |
| Section 4: Governance Hooks | 10 |
| Section 5: Refusal Rules Engine + Registry | 25 |
| Section 6: Provenance Chain | 12 |
| Section 7: Sandboxing | 10 |
| Section 8: Audit Requirements | 16 |
| Section 9: Trust Model Integration | 5 |
| Section 10: Rate Limiting | 5 |
| Section 11: Event Integration | 10 |
| Section 12: Performance Budget | 4 |
| Section 13: Limen v5 Graph Integration | 4 |
| Section 14: Classification Inheritance | 5 |
| Section 15: Invariants | 10 |
| Appendix A: Risk Scoring Matrix | 18 |
| Appendix B: GDPR Erasure Protocol | 6 |
| Appendix D: Rust Trait + TC-21 Gaps | 22 |
| **GRAND TOTAL** | **187** |
