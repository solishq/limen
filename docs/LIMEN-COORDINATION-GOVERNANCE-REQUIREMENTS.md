# Limen v5 -- AGENT_COORDINATION_GOVERNANCE.md Requirement Extraction

**Source:** `contracts/AGENT_COORDINATION_GOVERNANCE.md` v1.0.0
**Extracted:** 2026-05-09
**Governing Standard:** SolisForge Protocol v1.4
**Governance Tier:** Forge Critical
**Purpose:** Every implementable requirement from the Agent Coordination Governance contract.

---

## Section 1: Purpose & Scope

| ID | Requirement | Source |
|---|---|---|
| CO-1.1 | Contract scope covers A2A governance, session forking, distributed sync, inter-agent conflict, and replay verification | S1 |
| CO-1.2 | Contract classification is QAL-4 | Header |
| CO-1.3 | All coordination operations MUST be tenant-scoped | S1 |
| CO-1.4 | All coordination operations MUST be governance-checked | S1 |
| CO-1.5 | All coordination operations MUST produce audit entries through the unified event system | S1 |
| CO-1.6 | All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`; this contract does NOT redefine any shared type | Preamble |

**Totals: 6 requirements**

---

## Section 2: Shared Type References

| ID | Requirement | Source |
|---|---|---|
| CO-2.1 | Implementation MUST use the 20 shared types listed in the reference table from SHARED_TYPES.md without redefinition | S2 |

**Totals: 1 requirement**

---

## Section 3: AgentCoordinationClient Interface

| ID | Requirement | Source |
|---|---|---|
| CO-3.1 | `registerA2ARule(ctx: OperationContext, rule: A2AGovernanceRuleInput)` MUST return `Promise<Result<string>>` (rule ID) | S3 |
| CO-3.2 | `removeA2ARule(ctx: OperationContext, ruleId: string)` MUST return `Promise<Result<void>>` | S3 |
| CO-3.3 | `listA2ARules(ctx: OperationContext, filter?: A2ARuleFilter)` MUST return `Promise<Result<A2AGovernanceRule[]>>` | S3 |
| CO-3.4 | `validateA2AAction(ctx: OperationContext, action: A2AAction, targetAgent: AgentId)` MUST return `Promise<Result<A2AVerdict>>` | S3 |
| CO-3.5 | `getCapabilityBoundary(ctx: OperationContext, agentId: AgentId, skill: string)` MUST return `Promise<Result<CapabilityBoundary>>` | S3 |
| CO-3.6 | `forkSession(ctx: OperationContext, atTurn: number, options?: ForkOptions)` MUST return `Promise<Result<ForkedSession>>` | S3 |
| CO-3.7 | `listForks(ctx: OperationContext, sessionId: SessionId)` MUST return `Promise<Result<ForkedSession[]>>` | S3 |
| CO-3.8 | `mergeFork(ctx: OperationContext, forkId: string, strategy: MergeStrategy)` MUST return `Promise<Result<ForkMergeResult>>` | S3 |
| CO-3.9 | `discardFork(ctx: OperationContext, forkId: string)` MUST return `Promise<Result<void>>` | S3 |
| CO-3.10 | `getSyncState(ctx: OperationContext)` MUST return `Promise<Result<SyncState>>` | S3 |
| CO-3.11 | `registerPeer(ctx: OperationContext, peer: PeerRegistration)` MUST return `Promise<Result<string>>` (peer ID) | S3 |
| CO-3.12 | `removePeer(ctx: OperationContext, peerId: string)` MUST return `Promise<Result<void>>` | S3 |
| CO-3.13 | `triggerSync(ctx: OperationContext, options?: SyncOptions)` MUST return `Promise<Result<SyncResult>>` | S3 |
| CO-3.14 | `getSyncLog(ctx: OperationContext, options?: SyncLogOptions)` MUST return `Promise<Result<SyncEvent[]>>` | S3 |
| CO-3.15 | `captureSnapshot(ctx: OperationContext, missionId: MissionId, trigger: SnapshotTrigger)` MUST return `Promise<Result<StateSnapshot>>` | S3 |
| CO-3.16 | `verifyReplay(ctx: OperationContext, missionId: MissionId, options?: ReplayVerifyOptions)` MUST return `Promise<Result<ReplayVerification>>` | S3 |
| CO-3.17 | `getSnapshots(ctx: OperationContext, missionId: MissionId)` MUST return `Promise<Result<StateSnapshot[]>>` | S3 |
| CO-3.18 | `detectDivergence(ctx: OperationContext, snapshotA: string, snapshotB: string)` MUST return `Promise<Result<DivergenceReport>>` | S3 |
| CO-3.19 | `on(ctx: OperationContext, event: CoordinationEvent, handler: AgentEventHandler)` MUST return subscription ID `string` | S3 |
| CO-3.20 | `off(ctx: OperationContext, subscriptionId: string)` MUST unsubscribe the handler | S3 |

**Totals: 20 requirements**

---

## Section 4: A2A Governance Data Models

| ID | Requirement | Source |
|---|---|---|
| CO-4.1 | `A2AGovernanceRule.id` MUST be string | S4.1 |
| CO-4.2 | `A2AGovernanceRule.tenantId` MUST be `TenantId` | S4.1 |
| CO-4.3 | `A2AGovernanceRule.sourceAgent` MUST be `AgentId | '*'` (wildcard for any agent) | S4.1 |
| CO-4.4 | `A2AGovernanceRule.targetAgent` MUST be `AgentId | '*'` | S4.1 |
| CO-4.5 | `A2AGovernanceRule.skill` MUST be `string | '*'` | S4.1 |
| CO-4.6 | `A2AGovernanceRule.action` MUST be `A2ARuleAction` | S4.1 |
| CO-4.7 | `A2AGovernanceRule.conditions` MUST be `readonly A2ARuleCondition[]` | S4.1 |
| CO-4.8 | `A2AGovernanceRule.priority` MUST be number; lower = higher priority, evaluated first | S4.1 |
| CO-4.9 | `A2AGovernanceRule.enabled` MUST be boolean | S4.1 |
| CO-4.10 | `A2AGovernanceRule` MUST include `createdAt` (ISO-8601) and `createdBy` (`AgentId`) | S4.1 |
| CO-4.11 | `A2ARuleAction` MUST be `'allow' | 'deny' | 'mask' | 'rate_limit'` | S4.1 |
| CO-4.12 | `A2ARuleCondition` MUST have `field: string`, `operator`, `value` | S4.1 |
| CO-4.13 | `A2ARuleCondition.operator` MUST be `'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'lt' | 'matches'` | S4.1 |
| CO-4.14 | `A2AGovernanceRuleInput.priority` default MUST be 100 | S4.2 |
| CO-4.15 | `A2AAction.type` MUST be `'send_message' | 'delegate_task' | 'share_knowledge' | 'request_capability' | 'invoke_skill'` | S4.3 |
| CO-4.16 | `A2AAction` MUST include `sourceAgent`, `payload`, `classification`, `timestamp` | S4.3 |
| CO-4.17 | `A2AVerdict.allowed` MUST be boolean | S4.4 |
| CO-4.18 | `A2AVerdict.maskedFields` MUST be `readonly string[] | null` | S4.4 |
| CO-4.19 | If `allowed` is false, `reason` MUST be non-empty | S4.4 Validation |
| CO-4.20 | If `maskedFields` is non-null, caller MUST strip those fields from payload before delivery | S4.4 Validation |
| CO-4.21 | `rateLimited` true means action is allowed but throttled (queued for later delivery) | S4.4 Validation |
| CO-4.22 | `CapabilityBoundary` MUST include `agentId`, `skill`, `clearanceRequired`, `allowedFields`, `maskedFields`, `rateLimit`, `trustRequired`, `expiresAt` | S4.5 |
| CO-4.23 | `DataClassificationRule` MUST include `id`, `tenantId`, `predicatePattern` (glob), `classification`, `autoApply`, `createdBy` | S4.6 |
| CO-4.24 | `ProactiveRule` MUST include `id`, `tenantId`, `trigger`, `action`, `cooldownSeconds`, `enabled` | S4.7 |
| CO-4.25 | `ProactiveTrigger` MUST be discriminated union with types `'event_pattern'`, `'threshold'`, `'schedule'` | S4.7 |
| CO-4.26 | `ProactiveAction` MUST be discriminated union with types `'notify_agent'`, `'trigger_sync'`, `'capture_snapshot'` | S4.7 |
| CO-4.27 | `A2ARuleFilter` MUST support optional filtering by `sourceAgent`, `targetAgent`, `skill`, `action`, `enabled` | S4.8 |
| CO-4.28 | `ProactiveTrigger.schedule` MUST accept `cronExpression: string` | S4.7 |
| CO-4.29 | `ProactiveTrigger.threshold` MUST accept `metric`, `operator` (`'gt' | 'lt' | 'eq'`), `value` | S4.7 |
| CO-4.30 | `ProactiveTrigger.event_pattern` MUST accept `eventType: AgentEvent` and optional `condition: A2ARuleCondition` | S4.7 |
| CO-4.31 | `CapabilityBoundary.expiresAt` MUST be `string | null`; null means permanent | S4.5 |
| CO-4.32 | `CapabilityBoundary.rateLimit` MUST be `RateLimitPolicy | null` | S4.5 |

**Totals: 32 requirements**

---

## Section 5: Session Forking Data Models

| ID | Requirement | Source |
|---|---|---|
| CO-5.1 | `ForkOptions.label` MUST be optional string | S5.1 |
| CO-5.2 | `ForkOptions.inheritWorkingMemory` MUST be boolean, default true | S5.1 |
| CO-5.3 | `ForkOptions.inheritClaims` MUST be boolean, default false (fork starts with parent claims visible but adds to own namespace) | S5.1 |
| CO-5.4 | `ForkOptions.maxDurationMs` MUST be optional; auto-discard after this duration | S5.1 |
| CO-5.5 | `ForkedSession.forkId` MUST be string | S5.2 |
| CO-5.6 | `ForkedSession.parentSessionId` MUST be `SessionId` | S5.2 |
| CO-5.7 | `ForkedSession.forkedSessionId` MUST be `SessionId` | S5.2 |
| CO-5.8 | `ForkedSession.forkPoint` MUST be turn number | S5.2 |
| CO-5.9 | `ForkedSession.state` MUST be `ForkState` (`'active' | 'merged' | 'discarded'`) | S5.2 |
| CO-5.10 | `ForkedSession` MUST include `label`, `claimsSinceFork`, `workingMemoryNamespace`, `createdAt`, `mergedAt`, `discardedAt` | S5.2 |
| CO-5.11 | A forked session MUST have its own working memory namespace | S5.2 Isolation |
| CO-5.12 | Claims asserted in a fork MUST be branch-scoped (visible only within fork) until merge | S5.2 Isolation |
| CO-5.13 | A fork CAN read claims from parent session (snapshot at fork point) but CANNOT modify them | S5.2 Isolation |
| CO-5.14 | New claims in parent after fork point MUST NOT be visible to the fork | S5.2 Isolation |
| CO-5.15 | `ForkMergeResult.status` MUST be `'completed' | 'pending_resolution' | 'conflict_detected'` | S5.3 |
| CO-5.16 | `ForkConflictResolution.resolution` MUST be `'kept_fork' | 'kept_parent' | 'kept_both' | 'discarded_both'` | S5.3 |
| CO-5.17 | Max forks per session default MUST be 5 (configurable per tenant) | S5.4 |
| CO-5.18 | Max active forks system-wide per agent default MUST be 10 (configurable per tenant) | S5.4 |
| CO-5.19 | Max fork depth (fork of fork) MUST be 2 (NOT configurable) | S5.4 |
| CO-5.20 | Auto-discard timeout default MUST be 1 hour (configurable per fork) | S5.4 |

**Totals: 20 requirements**

---

## Section 6: Distributed Sync Data Models

| ID | Requirement | Source |
|---|---|---|
| CO-6.1 | `HLCTimestamp` MUST include `physical: number` (Unix ms), `logical: number` (Lamport counter), `nodeId: string` | S6.1 |
| CO-6.2 | HLC timestamps MUST be compared by `physical` first, then `logical`, then `nodeId` lexicographically for total order | S6.1 |
| CO-6.3 | `SyncEvent.id` MUST be string | S6.2 |
| CO-6.4 | `SyncEvent.type` MUST be `SyncEventType` (`'claim_created' | 'claim_retracted' | 'relationship_created' | 'governance_update'`) | S6.2 |
| CO-6.5 | `SyncEvent.hlcTimestamp` MUST be `HLCTimestamp` | S6.2 |
| CO-6.6 | `SyncEvent.hash` MUST be SHA-256 of canonical serialization | S6.2 |
| CO-6.7 | `SyncEvent.previousHash` MUST be hash of prior event in tenant's log | S6.2 |
| CO-6.8 | `SyncEventPayload` MUST be discriminated union with 4 variants matching `SyncEventType` | S6.2 |
| CO-6.9 | Sync event hash MUST be computed over `{id, type, hlcTimestamp, tenantId, payload, previousHash}` creating append-only tamper-evident log per tenant | S6.2 Hash Chaining |
| CO-6.10 | `SyncState` MUST include `nodeId`, `tenantId`, `peers`, `lastSyncAt`, `pendingEvents`, `watermarks`, `hashChainValid` | S6.3 |
| CO-6.11 | `PeerRegistration` MUST include `nodeId`, `endpoint` (URL), `tenantId`, `capabilities`, `maxBatchSize` | S6.4 |
| CO-6.12 | `SyncCapability` MUST be `'push' | 'pull' | 'bidirectional'` | S6.4 |
| CO-6.13 | `PeerState` MUST include `peerId`, `nodeId`, `endpoint`, `status`, `lastSeenAt`, `lastSyncedAt`, `watermark`, `pendingOutbound`, `failedAttempts` | S6.5 |
| CO-6.14 | `PeerStatus` MUST be `'active' | 'unreachable' | 'deregistered' | 'suspended'` | S6.5 |
| CO-6.15 | `Watermark` MUST include `peerId`, `hlcTimestamp`, `confirmedAt` | S6.6 |
| CO-6.16 | `SyncOptions.direction` MUST be `'push' | 'pull' | 'bidirectional'` (required) | S6.7 |
| CO-6.17 | `SyncOptions.targetPeers` MUST be optional; empty means all active peers | S6.7 |
| CO-6.18 | `SyncOptions.batchSize` default MUST be 100 | S6.7 |
| CO-6.19 | `SyncOptions.timeoutMs` default MUST be 30000 | S6.7 |
| CO-6.20 | `SyncConflictResolution` MUST be `'last_writer_wins' | 'highest_confidence' | 'manual'` | S6.7 |
| CO-6.21 | `SyncResult` MUST include `syncId`, `direction`, `eventsPushed`, `eventsPulled`, `conflictsResolved`, `conflictsUnresolved`, `peersContacted`, `peersUnreachable`, `watermarksAdvanced`, `duration`, `completedAt` | S6.8 |
| CO-6.22 | `SyncLogOptions` MUST support filtering by `since`, `until` (HLCTimestamp), `type`, `limit` (default 100, max 1000), `offset` | S6.9 |
| CO-6.23 | Default conflict resolution MUST be last-writer-wins by HLC | S6.10 |
| CO-6.24 | When two nodes assert conflicting claims (same subject+predicate, different values), claim with later HLC timestamp MUST win | S6.10 |
| CO-6.25 | If HLC timestamps are identical, `nodeId` lexicographic comparison MUST break the tie (total order, no ambiguity) | S6.10 |
| CO-6.26 | `SyncEventPayload` claim_created variant MUST include `claimId`, `subject`, `predicate`, `value`, `confidence` | S6.2 |
| CO-6.27 | `SyncEventPayload` claim_retracted variant MUST include `claimId`, `reason` | S6.2 |
| CO-6.28 | `SyncEventPayload` relationship_created variant MUST include `sourceId`, `targetId`, `relationshipType` | S6.2 |
| CO-6.29 | `SyncEventPayload` governance_update variant MUST include `ruleId`, `operation` (`'created' | 'removed' | 'updated'`) | S6.2 |
| CO-6.30 | `SyncState.hashChainValid` MUST reflect current integrity of tenant hash chain | S6.3 |
| CO-6.31 | `PeerState.watermark` MUST be `HLCTimestamp | null` (last event received from this peer) | S6.5 |
| CO-6.32 | `PeerState.failedAttempts` MUST track consecutive sync failures | S6.5 |

**Totals: 32 requirements**

---

## Section 7: Deterministic Replay Data Models

| ID | Requirement | Source |
|---|---|---|
| CO-7.1 | `SnapshotTrigger` MUST be `'mission_start' | 'checkpoint' | 'mission_end' | 'manual'` | S7.1 |
| CO-7.2 | `StateSnapshot.id` MUST be string | S7.2 |
| CO-7.3 | `StateSnapshot.missionId` MUST be `MissionId` | S7.2 |
| CO-7.4 | `StateSnapshot.tenantId` MUST be `TenantId` | S7.2 |
| CO-7.5 | `StateSnapshot.stateHash` MUST be SHA-256 of combined table hashes | S7.2 |
| CO-7.6 | `StateSnapshot.tableHashes` MUST be `Record<SnapshotTable, string>` | S7.2 |
| CO-7.7 | `SnapshotTable` MUST be `'claims' | 'relationships' | 'working_memory' | 'governance_rules' | 'audit_entries'` | S7.2 |
| CO-7.8 | `SnapshotMetadata` MUST include `claimCount`, `relationshipCount`, `workingMemoryEntries`, `governanceRuleCount`, `auditEntryCount`, `capturedBy`, `capturedAt` | S7.2 |
| CO-7.9 | `stateHash` MUST be computed as `SHA-256(sorted(tableHashes.values).join(':'))` | S7.2 Hash |
| CO-7.10 | Each `tableHashes[table]` MUST be `SHA-256(canonicalSerialize(allRowsInTable.sortedById))` | S7.2 Hash |
| CO-7.11 | Hash computation MUST be deterministic: same data always produces same hash regardless of insertion order | S7.2 Hash |
| CO-7.12 | `ReplayVerifyOptions.fromSnapshot` default MUST be mission_start | S7.3 |
| CO-7.13 | `ReplayVerifyOptions.toSnapshot` default MUST be latest | S7.3 |
| CO-7.14 | `ReplayVerifyOptions.tables` MUST be optional `readonly SnapshotTable[]`, default all | S7.3 |
| CO-7.15 | `ReplayVerifyOptions.haltOnFirstDivergence` MUST be optional boolean, default false | S7.3 |
| CO-7.16 | `ReplayVerification` MUST include `missionId`, `verified`, `fromSnapshotId`, `toSnapshotId`, `expectedHash`, `actualHash`, `tableResults`, `divergences`, `verifiedAt`, `duration` | S7.4 |
| CO-7.17 | `TableVerification` MUST include `table`, `expectedHash`, `actualHash`, `match`, `rowsChecked` | S7.4 |
| CO-7.18 | `DivergenceReport` MUST include `snapshotA`, `snapshotB`, `divergences`, `summary`, `generatedAt` | S7.5 |
| CO-7.19 | `DivergenceEntry.divergenceType` MUST be `'modified' | 'added_in_a' | 'added_in_b' | 'missing_in_a' | 'missing_in_b'` | S7.5 |
| CO-7.20 | `DivergenceSummary` MUST include `totalDivergences`, `byTable`, `byType` | S7.5 |
| CO-7.21 | Replay verification MUST NEVER modify state; it reports but does not repair | S7 Read-Only |
| CO-7.22 | `DivergenceEntry` MUST include `table`, `rowId`, `field`, `valueInA`, `valueInB`, `divergenceType` | S7.5 |

**Totals: 22 requirements**

---

## Section 8: Coordination Events

| ID | Requirement | Source |
|---|---|---|
| CO-8.1 | `CoordinationEvent` MUST define 22 event types across 4 domains: A2A (6), Fork (4), Sync (8), Replay (4) | S8 |
| CO-8.2 | A2A events MUST include `a2a:rule_registered`, `a2a:rule_removed`, `a2a:action_validated`, `a2a:action_denied`, `a2a:action_masked`, `a2a:rate_limited` | S8 |
| CO-8.3 | Fork events MUST include `fork:created`, `fork:merged`, `fork:discarded`, `fork:conflict_detected` | S8 |
| CO-8.4 | Sync events MUST include `sync:started`, `sync:completed`, `sync:failed`, `sync:conflict_resolved`, `sync:peer_registered`, `sync:peer_removed`, `sync:peer_unreachable`, `sync:watermark_advanced` | S8 |
| CO-8.5 | Replay events MUST include `replay:snapshot_captured`, `replay:verification_complete`, `replay:verification_failed`, `replay:divergence_detected` | S8 |
| CO-8.6 | A2A coordination events MUST map to `AgentEvent` union as: `a2a:*` -> `a2a:sent` (for allowed actions) or `a2a:refused` (for denied actions) | S8 AgentEvent Mapping |
| CO-8.7 | Fork events MUST map to `AgentEvent` union as: `fork:*` -> `session:forked` | S8 AgentEvent Mapping |
| CO-8.8 | Sync events MUST map to `AgentEvent` union as: `sync:*` -> `sync:watermark_advanced` | S8 AgentEvent Mapping |
| CO-8.9 | Replay events MUST map to `AgentEvent` union as: `replay:*` -> `replay:verified` (for success) or `replay:diverged` (for divergence) | S8 AgentEvent Mapping |

**Totals: 9 requirements**

---

## Section 9: Error Types

| ID | Requirement | Source |
|---|---|---|
| CO-9.1 | `CoordinationErrorCode` MUST include all 20 error codes: `A2A_RULE_VIOLATION`, `A2A_CAPABILITY_DENIED`, `A2A_RULE_NOT_FOUND`, `A2A_DUPLICATE_RULE`, `FORK_LIMIT_EXCEEDED`, `FORK_NOT_FOUND`, `FORK_ALREADY_MERGED`, `FORK_ALREADY_DISCARDED`, `FORK_DEPTH_EXCEEDED`, `FORK_INVALID_TURN`, `SYNC_PEER_UNREACHABLE`, `SYNC_PEER_NOT_FOUND`, `SYNC_CONFLICT_UNRESOLVABLE`, `SYNC_HASH_CHAIN_BROKEN`, `SYNC_TIMEOUT`, `REPLAY_HASH_MISMATCH`, `REPLAY_SNAPSHOT_NOT_FOUND`, `REPLAY_MISSION_NOT_FOUND`, `GOVERNANCE_REFUSAL`, `COORDINATION_TENANT_MISMATCH` | S9 |
| CO-9.2 | `AgentCoordinationError` discriminated union MUST include `A2A_RULE_VIOLATION` with `ruleId`, `reason` | S9 |
| CO-9.3 | `AgentCoordinationError` MUST include `A2A_CAPABILITY_DENIED` with `capability: AgentCapability` | S9 |
| CO-9.4 | `AgentCoordinationError` MUST include `FORK_LIMIT_EXCEEDED` with `limit` | S9 |
| CO-9.5 | `AgentCoordinationError` MUST include `FORK_NOT_FOUND` with `forkId` | S9 |
| CO-9.6 | `AgentCoordinationError` MUST include `SYNC_WATERMARK_REGRESSION` with `peerId`, `current`, `attempted` | S9 |
| CO-9.7 | `AgentCoordinationError` MUST include `SYNC_HASH_CHAIN_BROKEN` with `peerId`, `eventId` | S9 |
| CO-9.8 | `AgentCoordinationError` MUST include `REPLAY_HASH_MISMATCH` with `expected`, `actual` | S9 |
| CO-9.9 | `AgentCoordinationError` MUST include `COORDINATION_TENANT_MISMATCH` with `expected`, `actual` | S9 |
| CO-9.10 | `AgentCoordinationError` MUST include `GOVERNANCE_REFUSAL` with `decision: GovernanceDecision` | S9 |
| CO-9.11 | `CoordinationError` MUST extend `KernelError` with `code: CoordinationErrorCode` and `context: CoordinationErrorContext` | S9 |
| CO-9.12 | `CoordinationErrorContext` MUST include `operation`, `agentId`, `tenantId`, `details` | S9 |
| CO-9.13 | All errors MUST be returned via `Result<T>` -- never thrown | S9 |
| CO-9.14 | `SYNC_WATERMARK_REGRESSION` is NOT in `CoordinationErrorCode` union but IS in `AgentCoordinationError` -- implementation MUST reconcile this gap | S9 TC-21 Gap |

**Totals: 14 requirements**

---

## Section 10: Rust Trait -- AgentCoordinationGovernor

| ID | Requirement | Source |
|---|---|---|
| CO-10.1 | Rust trait `AgentCoordinationGovernor` MUST be `Send + Sync` and use `async_trait` | S10 |
| CO-10.2 | `register_a2a_rule` MUST accept `&OperationContext`, `A2AGovernanceRuleInput` and return `Result<String, CoordinationError>` | S10 |
| CO-10.3 | `remove_a2a_rule` MUST accept `&OperationContext`, `&str` rule_id and return `Result<(), CoordinationError>` | S10 |
| CO-10.4 | `list_a2a_rules` MUST accept `&OperationContext`, `Option<&A2ARuleFilter>` and return `Result<Vec<A2AGovernanceRule>, CoordinationError>` | S10 |
| CO-10.5 | `validate_a2a_action` MUST accept `&OperationContext`, `&A2AAction`, `&AgentId` and return `Result<A2AVerdict, CoordinationError>` | S10 |
| CO-10.6 | `get_capability_boundary` MUST accept `&OperationContext`, `&AgentId`, `&str` skill and return `Result<CapabilityBoundary, CoordinationError>` | S10 |
| CO-10.7 | `fork_session` MUST accept `&OperationContext`, `u32` at_turn, `Option<&ForkOptions>` and return `Result<ForkedSession, CoordinationError>` | S10 |
| CO-10.8 | `list_forks` MUST accept `&OperationContext`, `&SessionId` and return `Result<Vec<ForkedSession>, CoordinationError>` | S10 |
| CO-10.9 | `merge_fork` MUST accept `&OperationContext`, `&str` fork_id, `MergeStrategy` and return `Result<ForkMergeResult, CoordinationError>` | S10 |
| CO-10.10 | `discard_fork` MUST accept `&OperationContext`, `&str` fork_id and return `Result<(), CoordinationError>` | S10 |
| CO-10.11 | `get_sync_state` MUST accept `&OperationContext` and return `Result<SyncState, CoordinationError>` | S10 |
| CO-10.12 | `register_peer` MUST accept `&OperationContext`, `&PeerRegistration` and return `Result<String, CoordinationError>` | S10 |
| CO-10.13 | `remove_peer` MUST accept `&OperationContext`, `&str` peer_id and return `Result<(), CoordinationError>` | S10 |
| CO-10.14 | `trigger_sync` MUST accept `&OperationContext`, `Option<&SyncOptions>` and return `Result<SyncResult, CoordinationError>` | S10 |
| CO-10.15 | `get_sync_log` MUST accept `&OperationContext`, `Option<&SyncLogOptions>` and return `Result<Vec<SyncEvent>, CoordinationError>` | S10 |
| CO-10.16 | `capture_snapshot` MUST accept `&OperationContext`, `&MissionId`, `SnapshotTrigger` and return `Result<StateSnapshot, CoordinationError>` | S10 |
| CO-10.17 | `verify_replay` MUST accept `&OperationContext`, `&MissionId`, `Option<&ReplayVerifyOptions>` and return `Result<ReplayVerification, CoordinationError>` | S10 |
| CO-10.18 | `get_snapshots` MUST accept `&OperationContext`, `&MissionId` and return `Result<Vec<StateSnapshot>, CoordinationError>` | S10 |
| CO-10.19 | `detect_divergence` MUST accept `&OperationContext`, `&str` snapshot_a, `&str` snapshot_b and return `Result<DivergenceReport, CoordinationError>` | S10 |
| CO-10.20 | All 18 Rust trait methods MUST mirror the 18 TS `AgentCoordinationClient` methods (excluding `on`/`off` events) | S10 |

**Totals: 20 requirements**

---

## Section 10 (continued): Rust Data Types

| ID | Requirement | Source |
|---|---|---|
| CO-10.21 | Rust `A2AGovernanceRule` MUST have `id`, `tenant_id`, `source_agent`, `target_agent`, `skill`, `action`, `conditions`, `priority`, `enabled`, `created_at`, `created_by` | S10 |
| CO-10.22 | Rust `A2AGovernanceRuleInput` MUST have `source_agent`, `target_agent`, `skill`, `action`, `conditions`, `priority` (Option) | S10 |
| CO-10.23 | Rust `A2ARuleAction` MUST be enum with `Allow`, `Deny`, `Mask`, `RateLimit` | S10 |
| CO-10.24 | Rust `A2ARuleCondition` MUST have `field`, `operator`, `value` (serde_json::Value) | S10 |
| CO-10.25 | Rust `ConditionOperator` MUST be enum with `Eq`, `Neq`, `In`, `NotIn`, `Gt`, `Lt`, `Matches` | S10 |
| CO-10.26 | Rust `A2AAction` MUST have `action_type`, `source_agent`, `payload`, `classification`, `timestamp` | S10 |
| CO-10.27 | Rust `A2AActionType` MUST be enum with `SendMessage`, `DelegateTask`, `ShareKnowledge`, `RequestCapability`, `InvokeSkill` | S10 |
| CO-10.28 | Rust `A2AVerdict` MUST have `allowed`, `masked_fields`, `rate_limited`, `reason`, `rule_id`, `evaluated_at` | S10 |
| CO-10.29 | Rust `CapabilityBoundary` MUST have `agent_id`, `skill`, `clearance_required`, `allowed_fields`, `masked_fields`, `rate_limit`, `trust_required`, `expires_at` | S10 |
| CO-10.30 | Rust `HLCTimestamp` MUST implement `Ord`, `PartialOrd`, `PartialEq`, `Eq` with comparison order: physical, logical, node_id | S10 |
| CO-10.31 | Rust `SyncEvent` MUST have `id`, `event_type`, `hlc_timestamp`, `tenant_id`, `payload` (serde_json::Value), `hash`, `previous_hash` | S10 |
| CO-10.32 | Rust `SyncEventType` MUST be enum with `ClaimCreated`, `ClaimRetracted`, `RelationshipCreated`, `GovernanceUpdate` | S10 |
| CO-10.33 | Rust `StateSnapshot` MUST have `id`, `mission_id`, `tenant_id`, `trigger`, `timestamp`, `state_hash`, `table_hashes` (HashMap), `metadata` | S10 |
| CO-10.34 | Rust `SnapshotTrigger` MUST be enum with `MissionStart`, `Checkpoint`, `MissionEnd`, `Manual` | S10 |
| CO-10.35 | Rust `SnapshotMetadata` MUST have `claim_count`, `relationship_count`, `working_memory_entries`, `governance_rule_count`, `audit_entry_count`, `captured_by`, `captured_at` | S10 |
| CO-10.36 | Rust `CoordinationError` MUST have `code`, `message`, `spec`, `operation`, `agent_id`, `tenant_id`, `details` | S10 |
| CO-10.37 | Rust `A2ARuleFilter` MUST have `source_agent`, `target_agent`, `skill`, `action`, `enabled` all as `Option` | S10 |
| CO-10.38 | All Rust structs MUST derive `Debug, Clone, Serialize, Deserialize` | S10 |
| CO-10.39 | All Rust enums MUST use `#[serde(rename_all = "snake_case")]` | S10 |
| CO-10.40 | **GAP (TC-21):** Rust trait `AgentCoordinationGovernor` has no `on`/`off` event subscription methods; TS `AgentCoordinationClient` does. Implementation MUST define Rust event subscription mechanism or document omission | TC-21 Gap |
| CO-10.41 | **GAP (TC-21):** Rust trait has no equivalents for `DataClassificationRule`, `ProactiveRule`, `ProactiveTrigger`, `ProactiveAction` types defined in TS S4.6-S4.7; implementation MUST provide Rust equivalents | TC-21 Gap |
| CO-10.42 | **GAP (TC-21):** Rust `SyncEvent.payload` uses `serde_json::Value` instead of typed `SyncEventPayload` discriminated union; implementation SHOULD provide typed Rust enum | TC-21 Gap |
| CO-10.43 | **GAP (TC-21):** Rust types missing for `ForkOptions`, `ForkedSession`, `ForkMergeResult`, `ForkConflictResolution`, `SyncState`, `PeerRegistration`, `PeerState`, `Watermark`, `SyncOptions`, `SyncResult`, `SyncLogOptions`, `ReplayVerifyOptions`, `ReplayVerification`, `TableVerification`, `DivergenceReport`, `DivergenceEntry`, `DivergenceSummary`; implementation MUST define all | TC-21 Gap |
| CO-10.44 | **GAP (TC-21):** Rust `StateSnapshot.table_hashes` uses `HashMap<String, String>` instead of typed `SnapshotTable` keys; implementation SHOULD use typed enum keys | TC-21 Gap |
| CO-10.45 | **GAP (TC-21):** Rust trait uses `async fn` via `async_trait` macro; TS uses `Promise<Result<T>>`; implementation MUST ensure compatible async semantics | TC-21 Gap |
| CO-10.46 | **GAP (TC-21):** Rust `A2AGovernanceRule.source_agent` and `target_agent` are `String` not `AgentId | '*'`; implementation MUST validate wildcard at runtime | TC-21 Gap |
| CO-10.47 | **GAP (TC-21):** Rust `A2ARuleCondition.value` uses `serde_json::Value` instead of typed `string | number | boolean | readonly string[]`; implementation MUST validate value types | TC-21 Gap |
| CO-10.48 | **GAP (TC-21):** Rust has no `SyncConflictResolution` enum; implementation MUST define it | TC-21 Gap |
| CO-10.49 | **GAP (TC-21):** Rust has no `SnapshotTable` enum (TS defines it as string union); implementation MUST define it | TC-21 Gap |
| CO-10.50 | **GAP (TC-21):** Rust has no `ForkState` enum; implementation MUST define it | TC-21 Gap |

**Totals: 30 requirements**

---

## Section 11: Integration Map

| ID | Requirement | Source |
|---|---|---|
| CO-11.1 | `registerA2ARule` MUST INSERT into `a2a_governance_rules` table | S11 |
| CO-11.2 | `removeA2ARule` MUST soft-delete (set `enabled = false`, retain for audit) | S11 |
| CO-11.3 | `listA2ARules` MUST SELECT with filter predicates | S11 |
| CO-11.4 | `validateA2AAction` MUST perform priority-ordered rule matching, first match wins | S11 |
| CO-11.5 | `getCapabilityBoundary` MUST compute from agent trust + skill registration | S11 |
| CO-11.6 | `forkSession` MUST copy working memory namespace and create branch scope | S11 |
| CO-11.7 | `listForks` MUST SELECT from `session_forks` by parent session | S11 |
| CO-11.8 | `mergeFork` MUST apply `MergeStrategy` to branch-scoped claims | S11 |
| CO-11.9 | `discardFork` MUST mark discarded, retain claims for audit, release namespace | S11 |
| CO-11.10 | `getSyncState` MUST read local node state + peer watermarks | S11 |
| CO-11.11 | `registerPeer` MUST INSERT into `sync_peers` and initiate handshake | S11 |
| CO-11.12 | `removePeer` MUST mark deregistered and flush pending outbound | S11 |
| CO-11.13 | `triggerSync` MUST push/pull events since peer watermark | S11 |
| CO-11.14 | `getSyncLog` MUST SELECT from append-only `sync_events` table | S11 |
| CO-11.15 | `captureSnapshot` MUST hash all 5 tables and store snapshot record | S11 |
| CO-11.16 | `verifyReplay` MUST re-hash current state and compare to stored snapshot | S11 |
| CO-11.17 | `getSnapshots` MUST SELECT from `state_snapshots` by mission | S11 |
| CO-11.18 | `detectDivergence` MUST perform row-by-row comparison between two snapshot states | S11 |

**Totals: 18 requirements**

---

## Section 12: Invariants

| ID | Requirement | Source |
|---|---|---|
| CO-12.1 | **Tenant isolation:** A2A rules MUST be tenant-scoped; no rule from tenant A can affect agents of tenant B; cross-tenant returns `COORDINATION_TENANT_MISMATCH` | S12 I1 |
| CO-12.2 | **Fork limits are hard:** Exceeding `maxForksPerSession` MUST return `FORK_LIMIT_EXCEEDED` without partial creation | S12 I2 |
| CO-12.3 | **Fork isolation is total:** No cross-fork claim visibility until merge; fork reads ONLY parent-at-fork-point + own claims | S12 I3 |
| CO-12.4 | **HLC causal ordering:** Sync MUST use Hybrid Logical Clocks; no operation depends on synchronized wall clocks across nodes | S12 I4 |
| CO-12.5 | **Sync log append-only and hash-chained:** Once written, sync events are immutable; each event's hash includes previous hash; `SYNC_HASH_CHAIN_BROKEN` halts sync until repaired | S12 I5 |
| CO-12.6 | **Replay verification is read-only:** `verifyReplay` and `detectDivergence` MUST NEVER modify state | S12 I6 |
| CO-12.7 | **Divergence detection is deterministic:** Given identical snapshot pairs, MUST produce identical `DivergenceReport` regardless of environment, timing, or caller | S12 I7 |
| CO-12.8 | **Capability boundary enforcement at query time:** `validateA2AAction` MUST evaluate boundaries on every call; cached boundaries MUST expire and be recomputed | S12 I8 |
| CO-12.9 | **All coordination operations produce audit entries:** Every method emits `AuditLogEntry` via unified event bus; failed operations produce audit entries with error context | S12 I9 |
| CO-12.10 | **Sync conflict resolution is configurable per tenant:** Default is `last_writer_wins`; tenants may configure alternative; strategy stored in `sync_config` | S12 I10 |
| CO-12.11 | **A2A rule evaluation is priority-ordered, first-match-wins:** Rules sorted by priority ascending; if no rule matches, default verdict is `deny` (closed-world assumption) | S12 I11 |
| CO-12.12 | **Fork merge respects MergeStrategy determinism:** For non-manual strategies, same fork state + same parent state MUST produce same merge result | S12 I12 |

**Totals: 12 requirements**

---

## Appendix A: Governance Action Mapping

| ID | Requirement | Source |
|---|---|---|
| CO-A.1 | `validateA2AAction` MUST map to `{ domain: 'coordination', operation: 'a2a_send' }` | App A |
| CO-A.2 | `forkSession`, `mergeFork`, `discardFork` MUST map to `{ domain: 'coordination', operation: 'fork_session' }` | App A |
| CO-A.3 | `triggerSync`, `registerPeer`, `removePeer` MUST map to `{ domain: 'coordination', operation: 'sync' }` | App A |
| CO-A.4 | `captureSnapshot`, `verifyReplay`, `detectDivergence` MUST map to `{ domain: 'coordination', operation: 'replay' }` | App A |
| CO-A.5 | `registerA2ARule`, `removeA2ARule` MUST map to `{ domain: 'coordination', operation: 'rule' }` | App A |

**Totals: 5 requirements**

---

## Appendix B: Capability Requirements

| ID | Requirement | Source |
|---|---|---|
| CO-B.1 | A2A rule management MUST require `multi_agent` + `governance_admin` capabilities and `verified` trust | App B |
| CO-B.2 | A2A action validation MUST require `multi_agent` capability and `high` trust | App B |
| CO-B.3 | Session forking MUST require `branching` capability and `medium` trust | App B |
| CO-B.4 | Fork merge/discard MUST require `branching` capability and `medium` trust | App B |
| CO-B.5 | Distributed sync MUST require `multi_agent` + `network_access` capabilities and `high` trust | App B |
| CO-B.6 | Replay capture MUST require `multi_agent` capability and `high` trust | App B |
| CO-B.7 | Replay verification (read-only) MUST require `belief_management` capability and `low` trust | App B |

**Totals: 7 requirements**

---

## Grand Total

| Section | Count |
|---|---|
| Section 1: Purpose & Scope | 6 |
| Section 2: Shared Type References | 1 |
| Section 3: AgentCoordinationClient Interface | 20 |
| Section 4: A2A Governance Data Models | 32 |
| Section 5: Session Forking Data Models | 20 |
| Section 6: Distributed Sync Data Models | 32 |
| Section 7: Deterministic Replay Data Models | 22 |
| Section 8: Coordination Events | 9 |
| Section 9: Error Types | 14 |
| Section 10: Rust Trait + Data Types + TC-21 Gaps | 50 |
| Section 11: Integration Map | 18 |
| Section 12: Invariants | 12 |
| Appendix A: Governance Action Mapping | 5 |
| Appendix B: Capability Requirements | 7 |
| **GRAND TOTAL** | **248** |
