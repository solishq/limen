<!-- @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md SS5.1 -->

# Limen v5 -- Implementation Specification

**SolisForge Phase:** 5 (Implementation Spec)
**Version:** 1.0.0
**Date:** 2026-05-09
**Governing Standard:** SolisForge Protocol v1.4
**Derived From:** 3,747 requirements (14 contracts), Coverage Report, Architecture Decisions AD-1 through AD-14, Failure Mode Atlas (107 FMs)
**OG-CONSULT:** Completed 2026-05-09. Key guidance incorporated: fail-closed consent wiring, transactional decommission cascade, hook timeout safety, fork isolation via branch-scoped namespaces, read-only projection queries.

---

## Dependency Order

The 5 gap subsystems MUST be built in this order due to hard dependencies:

```
1. Consent Integration (ST-19)       -- no dependencies, enables LM and CO consent checks
2. Lifecycle Management (LM)         -- depends on Consent Integration for LM-6 consent governance
3. Output Governance (OG)            -- depends on LM for plugin capability gating (OG-12.9)
4. Coordination Governance (CO)      -- depends on LM for A2A agent validation, OG for telemetry
5. Audit Visualization (AV)          -- depends on all above (reads their audit entries)
```

This ordering satisfies: LM-1.06 (registration before adapter binding), OG-12.9 (capability gating requires lifecycle), CO-1.4 (governance checks require lifecycle), AV-1.3 (visualizations derive from audit trail populated by all subsystems).

---

## Subsystem 1: Consent Integration (ST-19)

### Module Structure

**Existing files to modify:**

| File | Change | Reason |
|---|---|---|
| `src/security/consent_gate.ts` | Add `checkConsentGate()` orchestration function that calls `detectConsentRequirement()` then queries `ConsentRegistry` | ST-19.10: gate runs before persistence |
| `src/api/index.ts` | Wire `ConsentGate` into factory; inject into Memory Bridge `remember()` call path | ST-19.05/06/07: consent checks on memory writes |
| `src/api/convenience/convenience_api.ts` | Insert consent gate call before `claimApi.remember()` | ST-19.05: remember() checks consent |
| `src/compliance/audit/export.ts` | Insert consent gate call before export operations | ST-19.10: consent before data export |

**No new files created.** The consent gate logic already exists in `src/security/consent_gate.ts`. The gap is exclusively wiring -- connecting the existing detection logic to the existing Phase 9 ConsentRegistry and inserting checks at the correct call sites.

### Interface Design

The `checkConsentGate()` function is the sole new public entry point:

```typescript
// In src/security/consent_gate.ts
export interface ConsentGateDeps {
  readonly consentRegistry: ConsentRegistry;
  readonly time: TimeProvider;
  readonly audit: AuditTrail;
}

export async function checkConsentGate(
  deps: ConsentGateDeps,
  ctx: OperationContext,
  content: ConsentCheckContent,
): Promise<Result<ConsentContext>>
```

**How it connects:** The factory (`src/api/index.ts`) already creates a `ConsentRegistry` instance at Phase 9 construction. The `checkConsentGate` function receives this registry via dependency injection. The `remember()` code path calls `checkConsentGate` before invoking `claimApi.assertClaim`.

**Flow (ST-19.10):**
1. `detectConsentRequirement(content)` -- returns null (no consent needed) or `{operation, dataSubjectId}`
2. If null, proceed without consent check
3. If non-null, call `consentRegistry.check(dataSubjectId, scope)` to find active consent
4. If active consent found: build `ConsentContext` with `granted: true, consentId: <id>` (ST-19.08)
5. If no consent: return `Result.err(CONSENT_REQUIRED)` -- fail-closed (FM-SE-08)
6. Audit the consent check result regardless of outcome (ST-19.10)

### Data Model

No new database tables. The Phase 9 `consent_records` table already exists with the required schema. The `ConsentContext` type already exists in `src/adapters/shared/types.ts`.

### Wiring Plan

**In `src/api/index.ts` factory:**
- Import `checkConsentGate` from `src/security/consent_gate.ts`
- At the point where `remember()` is constructed, wrap the existing `claimApi.assertClaim` call with a consent gate check
- The consent gate receives `consentRegistry` (already instantiated at Phase 9 wiring), `time` (already available as `timeProvider`), and `audit` (already available as `auditTrail`)
- No new events emitted -- consent events are emitted by the existing ConsentRegistry

**In `src/api/convenience/convenience_api.ts`:**
- Before the `claimApi.assertClaim` call in `remember()`, invoke `checkConsentGate` with `{subject, predicate, classification, dataSubjectId}` extracted from the remember parameters
- If the gate returns `err`, return that error immediately (fail-closed per AD-4)

**In `src/compliance/audit/export.ts`:**
- Before export data assembly, call `checkConsentGate` with operation `'export_data'`
- If the gate returns `err`, abort export

### Requirement Coverage

| Requirement IDs | Count |
|---|---|
| ST-19.01 through ST-19.14 | 14 |

**Total: 14 requirements**

All 14 ST-19 requirements are covered. ST-19.01 through ST-19.04 (type definitions) already exist in `src/adapters/shared/types.ts`. ST-19.05 through ST-19.14 (behavioral requirements) are implemented by the `checkConsentGate` function and its wiring.

### Test Strategy

| Scenario | Derived From | FMs Defended |
|---|---|---|
| `remember()` with personal data predicate (`personal.*`) without consent returns CONSENT_REQUIRED | ST-19.05, ST-19.11 | FM-SE-08, FM-CO-02 |
| `remember()` with `restricted` classification without consent returns CONSENT_REQUIRED | ST-19.06 | FM-SE-08 |
| `remember()` with explicit `dataSubjectId` without consent returns CONSENT_REQUIRED | ST-19.07 | FM-SE-08 |
| `remember()` with active consent proceeds and returns ConsentContext with consentId | ST-19.08 | -- |
| `remember()` with null `dataSubjectId` and non-personal predicate skips consent check | ST-19.09 | -- |
| Export operation without consent for personal data returns CONSENT_REQUIRED | ST-19.10 | FM-CO-07 |
| Consent gate called BEFORE persistence (verified by mock ordering) | ST-19.10 | FM-SE-08 |
| ConsentableOperation has exactly 6 values (compile-time check) | ST-19.13 | -- |
| ConsentPurpose has exactly 5 values (compile-time check) | ST-19.14 | -- |
| Registry unavailable: fail-closed, return CONSENT_REQUIRED | T7 invariant | FM-SE-08 |
| Revoked consent blocks operation | LM-2.14 cross-ref | FM-CC-05 |
| Expired consent blocks operation (computed on read per I-P9-22) | LM-6.09 cross-ref | FM-CC-05 |

---

## Subsystem 2: Lifecycle Management (LM)

### Module Structure

**New files to create:**

| File | Purpose | Spec Source |
|---|---|---|
| `src/lifecycle/agent_lifecycle_client.ts` | `AgentLifecycleClient` implementation -- all 22 interface methods | LM-2.01 through LM-2.22 |
| `src/lifecycle/lifecycle_types.ts` | All LM-specific types not already in shared types | LM-3 through LM-7 |
| `src/lifecycle/lifecycle_errors.ts` | 16 error types as discriminated union | LM-9.01 through LM-9.16 |
| `src/lifecycle/trust_promotion.ts` | Trust promotion state machine with evidence validation | LM-5, LM-11 |
| `src/lifecycle/knowledge_exchange.ts` | Export, import, transfer operations with classification and consent checks | LM-7 |
| `src/lifecycle/decommission_cascade.ts` | Atomic 7-step decommission cascade | LM-14.13 through LM-14.20 |
| `src/api/migration/048_agent_lifecycle.ts` | Database migration: `lm_agents` table, `lm_capabilities` table, `lm_consent_records` table, `lm_capability_history` table | LM-3, LM-4, LM-6 |

**Existing files to modify:**

| File | Change | Reason |
|---|---|---|
| `src/api/index.ts` | Wire `AgentLifecycleClient` into factory; expose on Limen API object | AD-10: single composition root |
| `src/adapters/shared/types.ts` | Add any missing branded types (`KnowledgePackageId`) | LM-7.08 |
| `src/api/agents/agent_api.ts` | Delegate lifecycle operations to new `AgentLifecycleClient` | LM-2 replaces thin agent API |

### Interface Design

```typescript
// src/lifecycle/agent_lifecycle_client.ts

export interface AgentLifecycleClientDeps {
  readonly db: DatabaseConnection;
  readonly audit: AuditTrail;
  readonly eventBus: AgentEventBus;
  readonly time: TimeProvider;
  readonly consentGate: typeof checkConsentGate;
  readonly consentRegistry: ConsentRegistry;
  readonly claimApi: ClaimApi;
}

export interface AgentLifecycleClient {
  // Registration & Identity (LM-2.01 through LM-2.05)
  registerAgent(ctx: OperationContext, spec: AgentRegistrationSpec): Promise<Result<RegisteredAgent>>;
  getAgent(agentId: AgentId): Promise<Result<RegisteredAgent>>;
  listAgents(filter?: AgentFilter): Promise<Result<readonly RegisteredAgent[]>>;
  updateAgent(ctx: OperationContext, agentId: AgentId, update: AgentUpdate): Promise<Result<RegisteredAgent>>;
  decommissionAgent(ctx: OperationContext, agentId: AgentId, reason: string): Promise<Result<DecommissionResult>>;

  // Capability Management (LM-2.06 through LM-2.09)
  requestCapabilityUpgrade(ctx: OperationContext, agentId: AgentId, request: CapabilityRequest): Promise<Result<CapabilityDecision>>;
  revokeCapability(ctx: OperationContext, agentId: AgentId, capability: AgentCapability, reason: string): Promise<Result<void>>;
  getCapabilities(agentId: AgentId): Promise<Result<AgentCapabilitySet>>;
  getCapabilityHistory(agentId: AgentId): Promise<Result<readonly CapabilityHistoryEntry[]>>;

  // Trust Promotion (LM-2.10 through LM-2.12)
  promoteAgent(ctx: OperationContext, agentId: AgentId, request: PromotionRequest): Promise<Result<TrustPromotionResult>>;
  demoteAgent(ctx: OperationContext, agentId: AgentId, reason: string): Promise<Result<DemotionResult>>;
  getTrustLevel(agentId: AgentId): Promise<Result<AgentTrustLevel>>;

  // Consent Governance (LM-2.13 through LM-2.16)
  registerConsent(ctx: OperationContext, agentId: AgentId, consent: AgentConsentRecord): Promise<Result<ConsentId>>;
  revokeConsent(ctx: OperationContext, consentId: ConsentId, reason: string): Promise<Result<ConsentRevocationResult>>;
  checkConsent(agentId: AgentId, operation: ConsentableOperation): Promise<Result<ConsentDecision>>;
  listConsents(agentId: AgentId): Promise<Result<readonly AgentConsentRecord[]>>;

  // Knowledge Exchange (LM-2.17 through LM-2.19)
  exportKnowledge(ctx: OperationContext, agentId: AgentId, options: KnowledgeExportOptions): Promise<Result<KnowledgePackage>>;
  importKnowledge(ctx: OperationContext, agentId: AgentId, pkg: KnowledgePackage, options?: KnowledgeImportOptions): Promise<Result<KnowledgeImportResult>>;
  transferKnowledge(ctx: OperationContext, fromAgentId: AgentId, toAgentId: AgentId, options: KnowledgeTransferOptions): Promise<Result<KnowledgeTransferResult>>;

  // Events (LM-2.20 through LM-2.22)
  on(event: AgentEvent, handler: AgentEventHandler): string;
  off(subscriptionId: string): void;
}
```

**Connection to existing kernel:** The existing `AgentApiImpl` in `src/api/agents/agent_api.ts` handles basic agent CRUD with a 4-level trust model. The new `AgentLifecycleClient` replaces this with the full 5-level model. The existing `agent_api.ts` becomes a thin delegation layer to the lifecycle client, preserving backward compatibility for existing callers.

### Data Model

**New migration `048_agent_lifecycle.ts`:**

```sql
-- Agent lifecycle records (LM-3)
CREATE TABLE IF NOT EXISTS lm_agents (
  id TEXT PRIMARY KEY,          -- AgentId (branded)
  name TEXT NOT NULL,
  framework TEXT NOT NULL,
  version TEXT NOT NULL,
  tenant_id TEXT,               -- TenantId (branded), nullable for global agents
  state TEXT NOT NULL DEFAULT 'active',  -- AgentState: active|suspended|decommissioned
  trust_level TEXT NOT NULL DEFAULT 'untrusted',  -- 5-level: untrusted|low|medium|high|verified
  owner TEXT NOT NULL,          -- UserId | AgentId
  metadata TEXT DEFAULT '{}',   -- JSON
  registered_at TEXT NOT NULL,
  last_active_at TEXT,
  decommissioned_at TEXT,
  decommission_reason TEXT,
  UNIQUE(name, framework, COALESCE(tenant_id, '__NULL__'))  -- LM-13.02
);

-- Capability tracking (LM-4)
CREATE TABLE IF NOT EXISTS lm_capabilities (
  agent_id TEXT NOT NULL REFERENCES lm_agents(id),
  capability TEXT NOT NULL,     -- AgentCapability value
  status TEXT NOT NULL DEFAULT 'granted',  -- granted|denied|pending
  granted_at TEXT,
  reason TEXT,
  decided_by TEXT,
  PRIMARY KEY (agent_id, capability)
);

-- Capability history (LM-4.16 through LM-4.20)
CREATE TABLE IF NOT EXISTS lm_capability_history (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES lm_agents(id),
  capability TEXT NOT NULL,
  action TEXT NOT NULL,          -- granted|revoked|requested|denied
  reason TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

-- Agent consent records (LM-6)
-- NOTE: This is distinct from the Phase 9 consent_records table.
-- Phase 9 handles GDPR data-subject consent (compliance layer).
-- This table handles agent-level operational consent (lifecycle layer).
CREATE TABLE IF NOT EXISTS lm_agent_consents (
  id TEXT PRIMARY KEY,          -- ConsentId (branded)
  agent_id TEXT NOT NULL REFERENCES lm_agents(id),
  data_subject TEXT NOT NULL,
  purpose TEXT NOT NULL,         -- ConsentPurpose
  scope TEXT DEFAULT '{}',       -- JSON: ConsentScope
  status TEXT NOT NULL DEFAULT 'active',  -- active|revoked|expired
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  revoked_reason TEXT,
  tenant_id TEXT                 -- LM tenant isolation
);
```

### Wiring Plan

**In `src/api/index.ts` factory:**

1. After L1 Kernel creation and Phase 9 consent registry instantiation:
   ```
   const lifecycleClient = createAgentLifecycleClient({
     db: connection,
     audit: auditTrail,
     eventBus: eventBus,
     time: timeProvider,
     consentGate: checkConsentGate,
     consentRegistry: consentRegistry,
     claimApi: claimApi,
   });
   ```

2. Expose on Limen API object:
   ```
   lifecycle: lifecycleClient,
   ```

3. The existing `agents` namespace remains for backward compatibility but delegates to `lifecycleClient` internally.

**Dependencies injected:**
- `db` -- from L1 Kernel (existing)
- `audit` -- from L1 Kernel audit trail (existing)
- `eventBus` -- from L1 Kernel event system (existing)
- `time` -- from L1 Kernel time provider (existing)
- `consentGate` -- from Subsystem 1 (new, built first)
- `consentRegistry` -- from Phase 9 (existing)
- `claimApi` -- from L1 Kernel claim system (existing)

**Events emitted (LM-8.01 through LM-8.18):**
- `agent:registered`, `agent:updated`, `agent:suspended`, `agent:reactivated`, `agent:decommissioned`
- `capability:granted`, `capability:revoked`
- `trust:promoted`, `trust:demoted`
- `consent:registered`, `consent:revoked`, `consent:expired`
- `knowledge:exported`, `knowledge:imported`, `knowledge:transferred`

All events use `AgentEventPayload` structure per ST-16.2 and flow through the shared `AgentEventBus`.

### Trust Promotion State Machine (LM-5, LM-11)

```
untrusted ──[registration complete]──> low
    low    ──[10+ ops, 0 refusals/24h]──> medium
  medium   ──[100+ ops, human/senior approval]──> high
    high   ──[human approval, Core admin record]──> verified
```

**Invariants (FM-GB-03, FM-GB-04):**
- `verified` MUST NOT be self-granted (LM-5.13, FM-GB-03)
- Promotions MUST be monotonic single-step (LM-5.12, FM-GB-04)
- Evidence validation per LM-5.05 through LM-5.08

**Demotion:**
- Can skip levels (demotion is not monotonic)
- `untrusted` is floor -- cannot demote below (LM-9.07)
- Capability revocation cascades on demotion (LM-5.18)

### Decommission Cascade (LM-14.13 through LM-14.20)

Executes atomically within a single SQLite transaction:

1. Set state to `'decommissioned'` (LM-14.14)
2. Terminate all active sessions -- query session manager, terminate each (LM-14.15)
3. Revoke all active consents -- UPDATE lm_agent_consents SET status='revoked'; emit `consent:revoked` per consent (LM-14.16)
4. Revoke all capabilities -- DELETE FROM lm_capabilities WHERE agent_id=? (LM-14.17)
5. Create knowledge archive -- call `exportKnowledge` with full scope if agent has claims (LM-14.18)
6. Remove from active lists -- agent remains queryable with `state: 'decommissioned'` filter (LM-14.19)
7. Emit `agent:decommissioned` event (LM-14.20)

**Failure mode defense:** FM-SM-07 (decommission without cleanup) is prevented by the atomic cascade. FM-CC-07 (concurrent decommission and operation) is prevented by the SQLite transaction serializing the state change before any subsequent operation can read it.

### Requirement Coverage

| Requirement Groups | IDs | Count |
|---|---|---|
| Purpose & Ordering | LM-1.01 through LM-1.07 | 7 |
| Interface Methods | LM-2.01 through LM-2.22 | 22 |
| Registration Data Models | LM-3.01 through LM-3.57 | 57 |
| Capability Management | LM-4.01 through LM-4.20 | 20 |
| Trust Promotion | LM-5.01 through LM-5.21 | 21 |
| Consent Governance | LM-6.01 through LM-6.21 | 21 |
| Knowledge Exchange | LM-7.01 through LM-7.66 | 66 |
| Lifecycle Events | LM-8.01 through LM-8.18 | 18 |
| Error Types | LM-9.01 through LM-9.16 | 16 |
| State Machine | LM-10.01 through LM-10.12 | 12 |
| Trust Capability Mapping | LM-11.01 through LM-11.11 | 11 |
| Invariants | LM-13.01 through LM-13.27 | 27 |
| Behavioral Contracts | LM-14.01 through LM-14.20+ | 20+ |

**Total: ~318 TS requirements** (excluding LM-12 Rust trait and LM-17 TC-21 gap requirements)

### Test Strategy

| Scenario | Derived From | FMs Defended |
|---|---|---|
| Register agent with valid spec: returns RegisteredAgent with `untrusted` trust | LM-2.01, LM-3.06 | FM-IN-01 |
| Register duplicate name+framework+tenant: returns AGENT_ALREADY_EXISTS | LM-9.02, LM-13.02 | -- |
| Agent name validation: 1-64 chars, alphanumeric+hyphens+underscores | LM-14.01, LM-14.02 | -- |
| Initial capabilities intersected with untrusted mapping: only memory_read, context_management | LM-14.04, LM-14.05 | FM-SE-03 |
| Promote untrusted->low: succeeds with registration evidence | LM-11.03 | FM-GB-04 |
| Promote untrusted->high: returns PROMOTION_DENIED (skip not allowed) | LM-5.12 | FM-GB-04 |
| Self-promote to verified: returns PROMOTION_DENIED | LM-5.13 | FM-GB-03 |
| Decommission cascade: all 7 steps execute atomically | LM-14.13 through LM-14.20 | FM-SM-07 |
| Decommissioned agent cannot transition to any state | LM-10.12, LM-13.03 | FM-SM-07 |
| Operation on decommissioned agent: returns AGENT_DECOMMISSIONED | LM-9.03, LM-3.29 | FM-SE-04 |
| Capability request above trust level: returns CAPABILITY_DENIED | LM-13.04, LM-13.05 | FM-SE-03 |
| Revoke capability: takes effect immediately, in-flight ops terminated | LM-13.17, LM-13.18 | -- |
| Knowledge export respects classification ceiling | LM-13.12, LM-13.14 | FM-SE-05 |
| Knowledge import caps confidence at 0.5 by default | LM-13.10, LM-13.11 | FM-BQ-02 |
| Knowledge transfer checks consent for both source and target | LM-1.05 | FM-CO-07 |
| Suspended agent blocks all ops except getAgent | LM-14.08 | -- |
| Statistics derived from audit trail on read (no counter drift) | LM-13.22, LM-13.23 | FM-DI-08 |
| All mutations require OperationContext | LM-13.26, LM-13.27 | FM-GB-01 |
| All state changes produce audit entries | LM-13.24, LM-13.25 | FM-CO-01 |

---

## Subsystem 3: Output Governance (OG)

### Module Structure

**New files to create:**

| File | Purpose | Spec Source |
|---|---|---|
| `src/output/output_governance.ts` | `AgentOutputClient` implementation -- all 18 interface methods | OG-3.1 through OG-3.18 |
| `src/output/output_types.ts` | Output-specific types: OutputType, OutputOptions, OutputEntry, OutputFilter, CostRecord, VitalRecord, BudgetConsumption, InferenceOptions, InferenceResult, ValidationError | OG-4, OG-5, OG-6 |
| `src/output/output_errors.ts` | 15 error types as discriminated union | OG-9.1 through OG-9.15 |
| `src/output/inference_engine.ts` | Schema-validated inference with retry loop | OG-6 |
| `src/output/plugin_lifecycle.ts` | Plugin install/uninstall/list with capability gating and error containment | OG-7.1 through OG-7.20 |
| `src/output/hook_executor.ts` | Hook registration/execution pipeline with priority ordering and timeout | OG-7.21 through OG-7.30 |
| `src/api/migration/049_output_governance.ts` | No new tables -- outputs are claims with `output.*` predicates (OG-12.1); cost/vital are claims with `telemetry.*` predicates; plugin/hook registrations stored in new tables | OG-12.1, OG-5.6, OG-5.10 |

**Existing files to modify:**

| File | Change | Reason |
|---|---|---|
| `src/api/index.ts` | Wire `AgentOutputClient` into factory; expose `output` namespace on Limen API | AD-10 |
| `src/api/output/output_api.ts` | Refactor to delegate to `AgentOutputClient` (currently a thin wrapper over ClaimApi) | OG-3 replaces convenience API |
| `src/plugins/hook_registry.ts` | Extend to support OG-7.21 hook types and execution pipeline | OG-7.21 through OG-7.30 |
| `src/plugins/plugin_registry.ts` | Extend to support OG-7.1 through OG-7.20 plugin lifecycle | OG-7.1 through OG-7.20 |

### Interface Design

```typescript
// src/output/output_governance.ts

export interface AgentOutputClientDeps {
  readonly claimApi: ClaimApi;
  readonly audit: AuditTrail;
  readonly eventBus: AgentEventBus;
  readonly time: TimeProvider;
  readonly lifecycleClient: AgentLifecycleClient;  // for capability checks
  readonly pluginRegistry: PluginRegistry;
  readonly hookRegistry: HookRegistry;
  readonly llmGateway?: LLMGateway;  // for inference
}

export interface AgentOutputClient {
  // Output Primitives (OG-3.1 through OG-3.3)
  produce(ctx: OperationContext, type: OutputType, content: string, options?: OutputOptions): Promise<Result<OutputEntry>>;
  queryOutputs(ctx: OperationContext, filter: OutputFilter): Promise<Result<readonly OutputEntry[]>>;
  retractOutput(ctx: OperationContext, outputId: ClaimId, reason: string): Promise<Result<void>>;

  // Telemetry (OG-3.4 through OG-3.8)
  recordCost(ctx: OperationContext, data: CostRecord): Promise<Result<void>>;
  recordVital(ctx: OperationContext, data: VitalRecord): Promise<Result<void>>;
  queryCosts(ctx: OperationContext, filter: CostFilter): Promise<Result<readonly CostRecord[]>>;
  queryVitals(ctx: OperationContext, filter: VitalFilter): Promise<Result<readonly VitalRecord[]>>;
  getBudgetConsumption(ctx: OperationContext): Promise<Result<BudgetConsumption>>;

  // Structured Inference (OG-3.9)
  infer<T>(ctx: OperationContext, options: InferenceOptions<T>): Promise<Result<InferenceResult<T>>>;

  // Plugin Lifecycle (OG-3.10 through OG-3.12)
  installPlugin(ctx: OperationContext, plugin: AgentPlugin, config?: PluginConfig): Promise<Result<string>>;
  uninstallPlugin(ctx: OperationContext, pluginId: string): Promise<Result<void>>;
  listPlugins(ctx: OperationContext): Promise<Result<readonly PluginRegistration[]>>;

  // Hook Lifecycle (OG-3.13 through OG-3.15)
  registerHook(ctx: OperationContext, hook: AgentHook): Promise<Result<string>>;
  unregisterHook(ctx: OperationContext, hookId: string): Promise<Result<void>>;
  listHooks(ctx: OperationContext): Promise<Result<readonly HookRegistration[]>>;

  // Events (OG-3.16, OG-3.17)
  on(ctx: OperationContext, event: OutputEvent, handler: AgentEventHandler): string;
  off(ctx: OperationContext, subscriptionId: string): void;
}
```

**How `produce()` maps to existing CCP (OG-11.1, OG-12.1):**
1. Run `before_output` hooks (OG-11.16) -- if any returns `proceed: false`, emit audit entry with reason (OG-12.8), return HOOK_BLOCKED_OPERATION
2. Validate content: non-empty, max 32768 chars (OG-4.14)
3. Clamp confidence to [0, 0.7] (OG-12.2)
4. Default classification to `'internal'` (OG-4.10)
5. Run `before_assert` hook (OG-11.11)
6. Call `claimApi.assertClaim` with predicate `output.<type>` (OG-11.1)
7. Create `derived_from` relationships for `relatedClaims` (OG-4.11)
8. Run `after_assert` hook (OG-11.12)
9. Run `after_output` hook (OG-11.16)
10. Emit `output:produced` event (OG-8.1, OG-8.15)
11. Return `OutputEntry`

**How `infer()` works (OG-6, OG-11.9):**
1. Validate prompt non-empty (OG-6.1)
2. Clamp temperature [0, 2.0] (OG-6.3), maxRetries [0, 5] (OG-6.4), timeout [1000, 300000] (OG-6.5)
3. Emit `inference:started` (OG-8.5)
4. Call LLM gateway with prompt + schema
5. Validate response against schema (Zod or JSON Schema)
6. If validation fails and retries remain: collect errors (OG-6.14), append correction block to prompt (OG-6.15), re-invoke (OG-12.4: progressive refinement with full error history)
7. If retries exhausted: return INFERENCE_RETRIES_EXHAUSTED with all ValidationError entries (OG-6.16)
8. Record CostRecord (OG-12.11: always recorded regardless of outcome)
9. Emit `inference:completed` or `inference:failed` (OG-8.6/8.8)
10. Return InferenceResult

### Data Model

**Migration `049_output_governance.ts`:**

```sql
-- Plugin registrations (OG-7.19)
CREATE TABLE IF NOT EXISTS og_plugins (
  plugin_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active|disabled|error
  installed_at TEXT NOT NULL,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  config TEXT DEFAULT '{}',  -- JSON: PluginConfig
  tenant_id TEXT,
  agent_id TEXT
);

-- Hook registrations (OG-7.28)
CREATE TABLE IF NOT EXISTS og_hooks (
  hook_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,           -- HookType: 7 values
  priority INTEGER NOT NULL DEFAULT 50,  -- 0-100, lower fires first
  name TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  fired_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  last_fired_at TEXT,
  error_count INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT,
  session_id TEXT
);
```

Outputs and telemetry records are NOT stored in separate tables. Per OG-12.1, outputs are claims with predicate `output.<type>`. Per OG-5.6 and OG-5.10, cost and vital records are claims with predicates `telemetry.cost` and `telemetry.vital`. This reuses the existing CCP claim storage, applying all CCP invariants (confidence, decay, classification, retention, audit) to outputs and telemetry automatically.

### Wiring Plan

**In `src/api/index.ts` factory:**

1. After lifecycle client creation (Subsystem 2):
   ```
   const outputClient = createAgentOutputClient({
     claimApi,
     audit: auditTrail,
     eventBus,
     time: timeProvider,
     lifecycleClient,
     pluginRegistry: extendedPluginRegistry,
     hookRegistry: extendedHookRegistry,
     llmGateway: substrate?.llmGateway,
   });
   ```

2. Expose on Limen API object:
   ```
   outputGovernance: outputClient,
   ```

**Hook execution pipeline (OG-12.7):**
- Same-type hooks fire in priority order (lowest first)
- Equal priorities broken by registration order (earlier first)
- 5000ms timeout per hook -- if exceeded, treated as `{proceed: true}` with warning audit entry (OG-12.12)
- Error policy per hook: `propagate` (re-throw), `contain` (log, continue), `disable_on_error` (disable after N errors) (OG-12.5)

**Plugin installation governance (OG-12.9):**
- `installPlugin` requires `governance_admin` capability -- trust level `verified`
- `registerHook` requires `memory_write` capability -- trust level `low` or above
- Capability checked via `lifecycleClient.getCapabilities()` then intersection check

### Requirement Coverage

| Requirement Groups | IDs | Count |
|---|---|---|
| Purpose & Scope | OG-1.1 through OG-1.5 | 5 |
| Shared Type References | OG-2.1 through OG-2.16 | 16 |
| Interface Methods | OG-3.1 through OG-3.18 | 18 |
| Output Data Models | OG-4.1 through OG-4.22 | 22 |
| Telemetry Data Models | OG-5.1 through OG-5.20 | 20 |
| Inference Data Models | OG-6.1 through OG-6.16 | 16 |
| Plugin/Hook Data Models | OG-7.1 through OG-7.30 | 30 |
| Output Events | OG-8.1 through OG-8.28 | 28 |
| Error Types | OG-9.1 through OG-9.15 | 15 |
| Integration Map | OG-11.1 through OG-11.20 | 20 |
| Invariants | OG-12.1 through OG-12.12 | 12 |
| Governance Actions | OG-A.1 through OG-A.3 | 3 |

**Total: ~205 TS requirements** (excluding OG-10 Rust trait requirements)

### Test Strategy

| Scenario | Derived From | FMs Defended |
|---|---|---|
| `produce()` stores output as claim with `output.<type>` predicate | OG-11.1, OG-12.1 | -- |
| `produce()` clamps confidence to 0.7 | OG-12.2 | -- |
| `produce()` with empty content returns OUTPUT_CONTENT_EMPTY | OG-9.2, OG-4.14 | -- |
| `produce()` with content > 32768 chars returns OUTPUT_CONTENT_TOO_LARGE | OG-9.3 | -- |
| `before_output` hook blocks: audit entry emitted, HOOK_BLOCKED_OPERATION returned | OG-12.8 | FM-GB-02 |
| Hook timeout (>5000ms): treated as proceed=true with warning audit | OG-12.12 | -- |
| Hook priority ordering: lower fires first, same priority by registration order | OG-12.7 | -- |
| Plugin install without governance_admin: returns PLUGIN_CAPABILITY_DENIED | OG-12.9, OG-9.9 | FM-SE-03 |
| Plugin error containment: errorCount increments, disabled at maxErrorCount | OG-12.5 | -- |
| Inference retry with full error history in correction prompt | OG-12.4, OG-6.15 | -- |
| Inference maxRetries exhausted: INFERENCE_RETRIES_EXHAUSTED with all errors | OG-6.16 | -- |
| Cost always recorded regardless of inference outcome | OG-12.11 | -- |
| Telemetry tenant isolation: cross-tenant query returns empty | OG-12.10 | FM-SE-06 |
| Retracted output: active->retracted terminal, irreversible | OG-4.16 | -- |
| `relatedClaims` creates derived_from relationships | OG-4.11 | -- |

---

## Subsystem 4: Coordination Governance (CO)

### Module Structure

**New files to create:**

| File | Purpose | Spec Source |
|---|---|---|
| `src/coordination/coordination_governance.ts` | `AgentCoordinationClient` implementation -- all 20 interface methods | CO-3.1 through CO-3.20 |
| `src/coordination/coordination_types.ts` | All CO-specific types: A2A rules, fork models, sync models, replay models | CO-4 through CO-7 |
| `src/coordination/coordination_errors.ts` | 20 error codes as discriminated union | CO-9.1 through CO-9.14 |
| `src/coordination/a2a_rule_engine.ts` | A2A governance rule evaluation: match, mask, rate-limit | CO-4, CO-11 |
| `src/coordination/session_fork.ts` | Fork/merge/discard lifecycle with isolation semantics | CO-5 |
| `src/coordination/sync_engine.ts` | HLC timestamps, peer management, event hash chain, watermarks | CO-6 |
| `src/coordination/replay_verifier.ts` | Snapshot capture, hash computation, divergence detection | CO-7 |
| `src/api/migration/050_coordination_governance.ts` | Database tables for A2A rules, forks, peers, sync events, snapshots | CO-4 through CO-7 |

**Existing files to modify:**

| File | Change | Reason |
|---|---|---|
| `src/api/index.ts` | Wire `AgentCoordinationClient` into factory; expose `coordination` namespace | AD-10 |
| `src/coordination/limen_backend.ts` | Delegate to `AgentCoordinationClient` for governance-checked operations | CO-1.4 |
| `src/coordination/a2a_governance.ts` | Extend with rule evaluation engine (currently stores rules as claims) | CO-4 |

### Interface Design

```typescript
// src/coordination/coordination_governance.ts

export interface AgentCoordinationClientDeps {
  readonly db: DatabaseConnection;
  readonly audit: AuditTrail;
  readonly eventBus: AgentEventBus;
  readonly time: TimeProvider;
  readonly lifecycleClient: AgentLifecycleClient;
  readonly claimApi: ClaimApi;
  readonly sessionManager: SessionManager;
}

export interface AgentCoordinationClient {
  // A2A Governance (CO-3.1 through CO-3.5)
  registerA2ARule(ctx: OperationContext, rule: A2AGovernanceRuleInput): Promise<Result<string>>;
  removeA2ARule(ctx: OperationContext, ruleId: string): Promise<Result<void>>;
  listA2ARules(ctx: OperationContext, filter?: A2ARuleFilter): Promise<Result<readonly A2AGovernanceRule[]>>;
  validateA2AAction(ctx: OperationContext, action: A2AAction, targetAgent: AgentId): Promise<Result<A2AVerdict>>;
  getCapabilityBoundary(ctx: OperationContext, agentId: AgentId, skill: string): Promise<Result<CapabilityBoundary>>;

  // Session Forking (CO-3.6 through CO-3.9)
  forkSession(ctx: OperationContext, atTurn: number, options?: ForkOptions): Promise<Result<ForkedSession>>;
  listForks(ctx: OperationContext, sessionId: SessionId): Promise<Result<readonly ForkedSession[]>>;
  mergeFork(ctx: OperationContext, forkId: string, strategy: MergeStrategy): Promise<Result<ForkMergeResult>>;
  discardFork(ctx: OperationContext, forkId: string): Promise<Result<void>>;

  // Distributed Sync (CO-3.10 through CO-3.14)
  getSyncState(ctx: OperationContext): Promise<Result<SyncState>>;
  registerPeer(ctx: OperationContext, peer: PeerRegistration): Promise<Result<string>>;
  removePeer(ctx: OperationContext, peerId: string): Promise<Result<void>>;
  triggerSync(ctx: OperationContext, options?: SyncOptions): Promise<Result<SyncResult>>;
  getSyncLog(ctx: OperationContext, options?: SyncLogOptions): Promise<Result<readonly SyncEvent[]>>;

  // Replay Verification (CO-3.15 through CO-3.18)
  captureSnapshot(ctx: OperationContext, missionId: MissionId, trigger: SnapshotTrigger): Promise<Result<StateSnapshot>>;
  verifyReplay(ctx: OperationContext, missionId: MissionId, options?: ReplayVerifyOptions): Promise<Result<ReplayVerification>>;
  getSnapshots(ctx: OperationContext, missionId: MissionId): Promise<Result<readonly StateSnapshot[]>>;
  detectDivergence(ctx: OperationContext, snapshotA: string, snapshotB: string): Promise<Result<DivergenceReport>>;

  // Events (CO-3.19, CO-3.20)
  on(ctx: OperationContext, event: CoordinationEvent, handler: AgentEventHandler): string;
  off(ctx: OperationContext, subscriptionId: string): void;
}
```

**A2A rule evaluation flow (CO-4, CO-11):**
1. Receive `A2AAction` from source agent targeting target agent
2. Query `co_a2a_rules` for matching rules: filter by source/target/skill, ordered by priority (lower first per CO-4.8)
3. For each matching rule, evaluate conditions (CO-4.12, CO-4.13)
4. First matching rule determines verdict:
   - `allow`: proceed
   - `deny`: return verdict with `allowed: false, reason` (CO-4.19)
   - `mask`: return verdict with `maskedFields` (CO-4.18, CO-4.20: caller strips fields)
   - `rate_limit`: return verdict with `rateLimited: true` (CO-4.21)
5. If no rule matches: fail-closed, deny (AD-4)
6. Emit `a2a:action_validated` or `a2a:action_denied` event (CO-8.2)

**Session fork isolation (CO-5.11 through CO-5.14):**
- Each fork gets its own working memory namespace (CO-5.11)
- Claims in fork are branch-scoped, visible only within fork until merge (CO-5.12)
- Fork can read parent claims at fork point (snapshot), cannot modify (CO-5.13)
- Parent claims created after fork point are invisible to fork (CO-5.14)
- This maps directly to the existing branch-scoped claim storage in the CCP

**Sync engine (CO-6):**
- HLC timestamps: `{physical, logical, nodeId}` with total order (CO-6.1, CO-6.2)
- Sync events hash-chained per tenant (CO-6.9)
- Default conflict resolution: last-writer-wins by HLC (CO-6.23)
- Watermark tracking per peer (CO-6.15)

**Replay verifier (CO-7):**
- Snapshots capture SHA-256 of 5 table states (CO-7.7)
- Hash computation: deterministic canonical serialization, sorted by ID (CO-7.10, CO-7.11)
- Verification is read-only -- reports but never mutates (CO-7.21)

### Data Model

**Migration `050_coordination_governance.ts`:**

```sql
-- A2A governance rules (CO-4)
CREATE TABLE IF NOT EXISTS co_a2a_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_agent TEXT NOT NULL,    -- AgentId | '*'
  target_agent TEXT NOT NULL,    -- AgentId | '*'
  skill TEXT NOT NULL DEFAULT '*',
  action TEXT NOT NULL,          -- allow|deny|mask|rate_limit
  conditions TEXT DEFAULT '[]',  -- JSON: A2ARuleCondition[]
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

-- Session forks (CO-5)
CREATE TABLE IF NOT EXISTS co_forks (
  fork_id TEXT PRIMARY KEY,
  parent_session_id TEXT NOT NULL,
  forked_session_id TEXT NOT NULL,
  fork_point INTEGER NOT NULL,   -- turn number
  state TEXT NOT NULL DEFAULT 'active',  -- active|merged|discarded
  label TEXT,
  claims_since_fork INTEGER NOT NULL DEFAULT 0,
  wm_namespace TEXT NOT NULL,
  created_at TEXT NOT NULL,
  merged_at TEXT,
  discarded_at TEXT,
  tenant_id TEXT,
  depth INTEGER NOT NULL DEFAULT 0  -- CO-5.19: max depth 2
);

-- Peer registrations (CO-6.4)
CREATE TABLE IF NOT EXISTS co_peers (
  peer_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  capabilities TEXT NOT NULL,     -- JSON: SyncCapability[]
  max_batch_size INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'active',  -- active|unreachable|deregistered|suspended
  last_seen_at TEXT,
  last_synced_at TEXT,
  watermark TEXT,                 -- JSON: HLCTimestamp | null
  pending_outbound INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0
);

-- Sync events (CO-6.2)
CREATE TABLE IF NOT EXISTS co_sync_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,       -- claim_created|claim_retracted|relationship_created|governance_update
  hlc_physical INTEGER NOT NULL,
  hlc_logical INTEGER NOT NULL,
  hlc_node_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  payload TEXT NOT NULL,          -- JSON
  hash TEXT NOT NULL,
  previous_hash TEXT NOT NULL
);

-- State snapshots (CO-7)
CREATE TABLE IF NOT EXISTS co_snapshots (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  trigger TEXT NOT NULL,          -- mission_start|checkpoint|mission_end|manual
  timestamp TEXT NOT NULL,
  state_hash TEXT NOT NULL,       -- SHA-256 of combined table hashes
  table_hashes TEXT NOT NULL,     -- JSON: Record<SnapshotTable, string>
  metadata TEXT NOT NULL          -- JSON: SnapshotMetadata
);
```

### Wiring Plan

**In `src/api/index.ts` factory:**

1. After output governance creation (Subsystem 3):
   ```
   const coordinationClient = createAgentCoordinationClient({
     db: connection,
     audit: auditTrail,
     eventBus,
     time: timeProvider,
     lifecycleClient,
     claimApi,
     sessionManager,
   });
   ```

2. Expose on Limen API object:
   ```
   coordination: coordinationClient,
   ```

**Events emitted (CO-8.1 through CO-8.9):**
- A2A: `a2a:rule_registered`, `a2a:rule_removed`, `a2a:action_validated`, `a2a:action_denied`, `a2a:action_masked`, `a2a:rate_limited`
- Fork: `fork:created`, `fork:merged`, `fork:discarded`, `fork:conflict_detected`
- Sync: `sync:started`, `sync:completed`, `sync:failed`, `sync:conflict_resolved`, `sync:peer_registered`, `sync:peer_removed`, `sync:peer_unreachable`, `sync:watermark_advanced`
- Replay: `replay:snapshot_captured`, `replay:verification_complete`, `replay:verification_failed`, `replay:divergence_detected`

All mapped to `AgentEvent` union per CO-8.6 through CO-8.9.

### Requirement Coverage

| Requirement Groups | IDs | Count |
|---|---|---|
| Purpose & Scope | CO-1.1 through CO-1.6 | 6 |
| Shared Type References | CO-2.1 | 1 |
| Interface Methods | CO-3.1 through CO-3.20 | 20 |
| A2A Data Models | CO-4.1 through CO-4.32 | 32 |
| Fork Data Models | CO-5.1 through CO-5.20 | 20 |
| Sync Data Models | CO-6.1 through CO-6.32 | 32 |
| Replay Data Models | CO-7.1 through CO-7.22 | 22 |
| Coordination Events | CO-8.1 through CO-8.9 | 9 |
| Error Types | CO-9.1 through CO-9.14 | 14 |
| Invariants | CO-11.* | est. 12 |

**Total: ~168 TS requirements** (excluding CO-10 Rust trait requirements)

### Test Strategy

| Scenario | Derived From | FMs Defended |
|---|---|---|
| A2A rule deny blocks action, audit entry emitted | CO-4.11, CO-4.19 | FM-GB-02 |
| A2A mask: maskedFields returned, caller MUST strip fields | CO-4.18, CO-4.20 | FM-SE-05 |
| A2A no matching rule: fail-closed deny | AD-4 | FM-GB-02 |
| Rule priority ordering: lower number evaluated first | CO-4.8 | -- |
| Fork limit exceeded (>5 per session): FORK_LIMIT_EXCEEDED | CO-5.17, CO-9.4 | -- |
| Fork depth exceeded (>2): FORK_DEPTH_EXCEEDED | CO-5.19, CO-9.4 | -- |
| Fork isolation: claims in fork invisible to parent | CO-5.12, CO-5.14 | -- |
| Fork auto-discard after timeout (default 1hr) | CO-5.20 | -- |
| Merge fork with conflict: status pending_resolution | CO-5.15 | -- |
| HLC timestamp total ordering: physical, logical, nodeId | CO-6.2 | -- |
| Sync event hash chain: broken chain returns SYNC_HASH_CHAIN_BROKEN | CO-6.9, CO-9.7 | FM-DI-13 |
| Last-writer-wins conflict resolution | CO-6.23, CO-6.24 | -- |
| Identical HLC tiebreak by nodeId lexicographic | CO-6.25 | -- |
| Snapshot hash deterministic: same data = same hash regardless of insertion order | CO-7.11 | -- |
| Replay verification read-only: never mutates state | CO-7.21 | -- |
| Divergence detection: identifies modified/added/missing entries | CO-7.19 | -- |
| Tenant mismatch: COORDINATION_TENANT_MISMATCH | CO-9.9 | FM-SE-06 |
| All errors via Result<T>, never thrown | CO-9.13 | AD-11 |

---

## Subsystem 5: Audit Visualization (AV)

### Module Structure

**New files to create:**

| File | Purpose | Spec Source |
|---|---|---|
| `src/audit/visualization/audit_query_service.ts` | `AuditQueryService` implementation -- 6 interface methods | AV-8.1 through AV-8.6 |
| `src/audit/visualization/visualization_types.ts` | All AV-specific types: SessionTimeline, BeliefGraphSnapshot, GovernanceHeatmapData, ExportRequest/Result, IntegrityReport | AV-2 through AV-9 |
| `src/audit/visualization/timeline_projection.ts` | SessionTimeline projection: queries audit entries, assembles timeline entries, computes statistics | AV-3 |
| `src/audit/visualization/belief_graph_projection.ts` | BeliefGraphSnapshot projection: builds nodes from claims, edges from relationships, computes graph statistics | AV-4 |
| `src/audit/visualization/heatmap_projection.ts` | GovernanceHeatmapData projection: aggregates governance verdicts by time bucket and agent | AV-5 |
| `src/audit/visualization/integrity_checker.ts` | Chain integrity verification: walks hash chain, detects breaks | AV-8.6, AV-10.1, AV-10.9 |
| `src/audit/visualization/export_engine.ts` | Export to JSON, CSV, PDF, SVG with checksum verification | AV-6 |

**Existing files to modify:**

| File | Change | Reason |
|---|---|---|
| `src/api/index.ts` | Wire `AuditQueryService` into factory; expose `auditVisualization` namespace | AD-10 |
| `src/kernel/audit/audit_trail.ts` | No changes -- read-only queries use existing audit tables | AV-10.10 |

**No new migration needed.** All visualization queries read from existing tables:
- `audit_entries` (existing L1 Kernel table)
- `claims` (existing CCP table)
- `claim_relationships` (existing CCP table)

### Interface Design

```typescript
// src/audit/visualization/audit_query_service.ts

export interface AuditQueryServiceDeps {
  readonly db: DatabaseConnection;
  readonly time: TimeProvider;
}

export interface AuditQueryService {
  queryEntries(filter: AuditFilter, pagination: Pagination): Promise<Result<PaginatedResult<AgentAuditEntry>>>;
  getTimeline(sessionId: SessionId): Promise<Result<SessionTimeline>>;
  getBeliefGraph(options?: BeliefGraphOptions): Promise<Result<BeliefGraphSnapshot>>;
  getGovernanceHeatmap(options: HeatmapOptions): Promise<Result<GovernanceHeatmapData>>;
  export(request: ExportRequest): Promise<Result<ExportResult>>;
  verifyChainIntegrity(options?: IntegrityCheckOptions): Promise<Result<IntegrityReport>>;
}
```

**Connection to kernel:** The `AuditQueryService` is a read-only projection layer. It queries existing `audit_entries`, `claims`, and `claim_relationships` tables. It does NOT write to any table. This satisfies AV-10.10 (single source of truth: all data derives from audit entries) and AD-6 (append-only audit model -- visualization never modifies the chain).

### Projection Implementations

**1. SessionTimeline (AV-3):**
- Query `audit_entries` WHERE `session_id = ?` ORDER BY `timestamp ASC`
- Map each entry to `TimelineEntry` with type derived from `action_type` (AV-3.3)
- Compute `SessionStatistics` (11 fields per AV-3.4 through AV-3.14) by aggregating over entries
- Statistics are computed on read, not cached (consistent with LM-13.22)

**2. BeliefGraphSnapshot (AV-4):**
- Query `claims` with optional filters: agentId, tenantId, rootClaimId, includeRetracted, includeArchived
- If `rootClaimId` specified, BFS/DFS to `depth` hops (AV-8.20, AV-8.21)
- Map claims to `BeliefGraphNode` with:
  - `effectiveConfidence` computed via FSRS decay (AV-4.4): `R(t) = (1 + t/(9*S))^-1`
  - `freshness` label from shared types (AV-4.5)
- Query `claim_relationships` for edges, map to `BeliefGraphEdge` (8 edge types per AV-4.11)
- Compute `GraphStatistics`: totalNodes, totalEdges, connectedComponents, freshnessDistribution, classificationDistribution, agentDistribution, averageConfidence (AV-4.13 through AV-4.19)
- No caching -- real-time consistency required (AV-10.7)

**3. GovernanceHeatmapData (AV-5):**
- Query `audit_entries` WHERE `action_type = 'governance_check'` within `timeRange`
- Bucket by `granularity` (minute/hour/day/week per AV-5.2)
- For each bucket, count allow/refuse/escalate/sandbox verdicts (AV-5.3)
- Normalize `intensity` within dataset [0, 1] (AV-5.8)
- Privacy safety: aggregates only contain counts and rates, no PII or claim content (AV-10.8)
- Compute totals: allowRate, refuseRate, escalateRate, sandboxRate; topRefusalRules (AV-5.5 through AV-5.7)

**4. IntegrityChecker (AV-8.6, AV-10.1):**
- Walk `audit_entries` ordered by `seq_no`
- Verify `entry[n].previousHash === entry[n-1].currentHash` (AV-10.1)
- Report: `valid`, `entriesChecked`, `brokenLinks`, `hashMismatches`, `firstBreakAt`, `details[]`
- `repairMode` flags but does NOT mutate (AV-8.14, AV-10.9)
- Scope: `'full'` (entire chain) or `'recent'` (last N hours per AV-8.13)

**5. Export Engine (AV-6):**
- JSON: serialize filtered entries to JSON string
- CSV: serialize to CSV with header row
- PDF/SVG: placeholder -- out of scope for v5 initial implementation (document as future)
- Checksum: SHA-256 of `ExportResult.data` (AV-6.11, AV-10.4)
- Classification enforcement: filter entries above requester's clearance (AV-10.3)
- Redaction: when `redactClassified: true`, replace content above clearance with null (AV-6.6)

### Data Model

No new tables. All projections query existing tables:

| Projection | Source Table(s) | Access Pattern |
|---|---|---|
| SessionTimeline | `audit_entries` | WHERE session_id = ? ORDER BY timestamp |
| BeliefGraph | `claims`, `claim_relationships` | WHERE filters, BFS on relationships |
| GovernanceHeatmap | `audit_entries` | WHERE action_type = 'governance_check' AND timestamp BETWEEN |
| IntegrityCheck | `audit_entries` | Sequential scan ORDER BY seq_no |
| Export | `audit_entries` + optional others | Filtered scan with pagination |

### Wiring Plan

**In `src/api/index.ts` factory:**

1. After all governance subsystems (last in dependency order):
   ```
   const auditVisualization = createAuditQueryService({
     db: connection,
     time: timeProvider,
   });
   ```

2. Expose on Limen API object:
   ```
   auditVisualization: auditVisualization,
   ```

**Dependencies:** Minimal -- only needs database connection and time provider. No dependency on lifecycle, output, or coordination clients. This is a read-only projection layer.

**Events emitted:** None. The `AuditQueryService` is pure read -- it does not produce audit entries for its own operations (querying the audit trail does not itself require auditing).

### Requirement Coverage

| Requirement Groups | IDs | Count |
|---|---|---|
| Purpose | AV-1.1 through AV-1.4 | 4 |
| Audit Log Schema | AV-2.1 through AV-2.23 | 23 |
| Session Timeline | AV-3.1 through AV-3.14 | 14 |
| Belief Graph | AV-4.1 through AV-4.19 | 19 |
| Governance Heatmap | AV-5.1 through AV-5.10 | 10 |
| Export Contracts | AV-6.1 through AV-6.12 | 12 |
| Retention & Privacy | AV-7.1 through AV-7.11 | 11 |
| Query Interfaces | AV-8.1 through AV-8.26 | 26 |
| Invariants | AV-10.1 through AV-10.11 | 11 |

**Total: ~130 TS requirements** (excluding AV-9 Rust type requirements)

### Test Strategy

| Scenario | Derived From | FMs Defended |
|---|---|---|
| Timeline entries ordered by timestamp within session | AV-3.1, AV-3.2 | -- |
| Timeline statistics computed correctly (11 numeric fields) | AV-3.4 through AV-3.14 | -- |
| Belief graph effectiveConfidence uses FSRS decay formula | AV-4.4, AV-10.7 | FM-BQ-01 |
| Belief graph real-time consistency: no stale cache | AV-10.7 | FM-BQ-01 |
| Belief graph with rootClaimId: BFS to specified depth | AV-8.20, AV-8.21 | -- |
| Heatmap privacy: no PII, no claim content in cells | AV-10.8 | FM-CR-01 |
| Heatmap intensity normalized [0, 1] within dataset | AV-5.8 | -- |
| Export checksum verifiable: SHA-256 of data | AV-6.11, AV-10.4 | -- |
| Export respects classification ceiling | AV-10.3 | FM-SE-02 |
| Chain integrity verification: detects hash mismatch | AV-10.1 | FM-DI-13 |
| Chain integrity verification: detects missing parent | AV-8.16 | FM-DI-13 |
| Chain integrity verification: repairMode does NOT mutate | AV-8.14, AV-10.9 | -- |
| All visualization derives from audit entries only | AV-10.10 | -- |
| Governance verdict values match canonical set | AV-10.11 | -- |
| Tombstoned entries: content null, chain position preserved | AV-7.9, AV-10.2 | FM-CO-04 |
| PaginatedResult.hasMore correctly computed | AV-8.22 | -- |

---

## Cross-Cutting Concerns

### Failure Mode Atlas Cross-Reference

Every subsystem defends against specific failure modes:

| FM-ID | Category | Defended By Subsystem |
|---|---|---|
| FM-GB-01 | Governance Bypass | LM (OperationContext on all mutations) |
| FM-GB-02 | Governance Bypass | OG (hook blocking), CO (A2A rule deny) |
| FM-GB-03 | Governance Bypass | LM (self-promotion block) |
| FM-GB-04 | Governance Bypass | LM (monotonic single-step promotion) |
| FM-GB-07 | Governance Bypass | OG (event bus cannot suppress audit-bound events) |
| FM-SE-03 | Security | LM (capability-trust mapping), OG (plugin capability gating) |
| FM-SE-04 | Security | LM (decommission cascade terminates sessions) |
| FM-SE-05 | Security | LM (classification ceiling on export), CO (A2A mask fields) |
| FM-SE-06 | Security | OG (telemetry tenant isolation), CO (tenant mismatch error) |
| FM-SE-08 | Security | Consent (fail-closed gate) |
| FM-CC-05 | Concurrency | Consent (atomic check with operation) |
| FM-CC-07 | Concurrency | LM (atomic decommission cascade) |
| FM-SM-07 | State Machine | LM (7-step cascade with audit) |
| FM-CO-01 | Compliance | LM (all transitions emit audit entries) |
| FM-CO-02 | Compliance | Consent (consent before data operation) |
| FM-CO-07 | Compliance | LM (consent on knowledge transfer), Consent (gate on export) |
| FM-DI-08 | Data Integrity | LM (statistics derived on read) |
| FM-DI-13 | Data Integrity | AV (chain integrity verification), CO (sync hash chain) |
| FM-BQ-01 | Behavioral | AV (FSRS decay verification in belief graph) |
| FM-BQ-02 | Behavioral | LM (import confidence cap 0.5) |
| FM-CR-01 | Credential | AV (heatmap privacy safety) |
| FM-IN-01 | Integration | LM (registration before adapter binding) |

### Architecture Decision Compliance

| AD | Decision | How Subsystems Comply |
|---|---|---|
| AD-1 | SQLite via better-sqlite3 | All new tables in SQLite migrations |
| AD-2 | Branded types | All IDs use branded types from shared types |
| AD-4 | Fail-closed governance | Consent gate, A2A rule engine, hook blocking all default to deny |
| AD-6 | Append-only hash chain | Sync events hash-chained (CO-6.9), snapshots use SHA-256 (CO-7.5) |
| AD-7 | Factory + deep freeze | All new modules wired in factory, frozen on return |
| AD-9 | Typed event bus | All subsystems emit typed events through shared bus |
| AD-10 | Single composition root | All wiring in `src/api/index.ts` |
| AD-11 | Result\<T\> | All methods return Result, never throw |
| AD-12 | Forward-only migrations | Migrations 048/049/050 -- forward only |
| AD-14 | Row-level tenant isolation | All queries scoped by tenant_id |

### Total Requirement Coverage Summary

| Subsystem | TS Requirements | Rust Requirements | Total |
|---|---|---|---|
| 1. Consent Integration (ST-19) | 14 | 0 | 14 |
| 2. Lifecycle Management (LM) | ~318 | ~48 | ~366 |
| 3. Output Governance (OG) | ~205 | ~44 | ~249 |
| 4. Coordination Governance (CO) | ~168 | ~37 | ~205 |
| 5. Audit Visualization (AV) | ~130 | ~62 | ~192 |
| **Total** | **~835** | **~191** | **~1,026** |

Note: Rust requirements (LM-12, OG-10, CO-10, AV-9) are documented but not in scope for TypeScript implementation. They define the parity target for the v5 Rust crate layer (TC-21).

### Build Estimation

| Subsystem | New Files | Modified Files | New Tables | Est. LoC |
|---|---|---|---|---|
| 1. Consent Integration | 0 | 3 | 0 | ~200 |
| 2. Lifecycle Management | 7 | 3 | 4 | ~2,500 |
| 3. Output Governance | 7 | 4 | 2 | ~2,000 |
| 4. Coordination Governance | 8 | 3 | 5 | ~3,000 |
| 5. Audit Visualization | 7 | 1 | 0 | ~1,800 |
| **Total** | **29** | **14** | **11** | **~9,500** |

---

**This document is the Phase 5 Implementation Specification per SolisForge SS6.**
**Every design decision traces to a requirement ID. No assumption is ungrounded.**
