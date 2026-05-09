<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# Phase X: AI Agent Integration Layer — Architecture Overview

**Version:** 1.3.0
**Status:** RATIFIED DESIGN — Pending Implementation
**Governing:** SolisForge Protocol v1.4 [HISTORICAL: CDM v2.1 + Contract Compliance v2.1 — superseded]
**Date:** May 5, 2026
**Phase 8 Gate:** `contracts/phase-x.contracts.json` is the machine-readable compliance authority for contract versions, hashes, HB-37/HB-38 coverage, LCI, and monotonicity.

## 1. Vision

Limen becomes the universal governed memory and audit layer for all AI coding agents regardless of framework, model, or deployment topology. The integration layer is agent-agnostic by design: any agent framework — Claude Code, Codex, OpenClaw, Hermes, or custom local agents — plugs in via a thin adapter and immediately inherits governed memory, belief versioning with temporal decay, computer use governance with cryptographic refusal provenance, and full audit trail participation. This is not a tool agents use; it is infrastructure they inhabit. Every belief an agent forms, every action it takes, every decision it refuses flows through Limen's existing governance substrate without requiring modification to Limen Core itself.

## 2. System Architecture

### 2.1 Layer Diagram

```
+--------------------------------------------------------------------+
|                         Agent Frameworks                            |
|       Claude | Codex | OpenClaw | Hermes | Gemma | Custom/Local     |
+---------------+-------------------+-------------------+------------+
                |                   |                   |
+---------------v-------------------v-------------------v------------+
| Agent Adapter Architecture                                           |
| contracts/AGENT_ADAPTER_ARCHITECTURE.md                              |
| native tool calls -> canonical ComputerAction / LimenOperation        |
+---------------+----------------------------------------------------+
                |
+---------------v----------------------------------------------------+
| Agent Lifecycle Management                                           |
| contracts/AGENT_LIFECYCLE_MANAGEMENT.md                              |
| registration | 5-level trust | capabilities | consent | portability |
+---------------+----------------------------------------------------+
                |
+---------------v----------------------------------------------------+
| Shared Canonical Contract Layer                                      |
| contracts/SHARED_TYPES.md                                             |
| AgentSession | OperationContext mapping | AgentEventBus | policies   |
+-------+-----------+-------------+-------------+----------+----------+
        |           |             |             |          |
+-------v---+ +-----v-----+ +-----v------+ +----v----+ +---v---------+
| Memory    | | Computer  | | Execution  | | Context | | Intelligence |
| Bridge    | | Use Gov   | | Governance | | Gov     | | Bridge       |
+-------+---+ +-----+-----+ +-----+------+ +----+----+ +---+---------+
        |           |             |             |          |
+-------v---+ +-----v-----+ +-----v------+                       |
| Search    | | Coord     | | Output     |                       |
| Gov       | | Gov       | | Gov        |                       |
+-------+---+ +-----+-----+ +-----+------+                       |
        |           |             |                             |
+-------v-----------v-------------v-----------------------------v------+
| Audit & Visualization Schema                                         |
| contracts/AUDIT_VISUALIZATION_SCHEMA.md                              |
| append-only log | timelines | belief graph | heatmap | export        |
+---------------+----------------------------------------------------+
                |
+---------------v----------------------------------------------------+
| Limen Core + Hook System + Refusal Engine                            |
| CCP | WMP | TGP | EGP | CGP | RBAC | Consent | Audit Chain | Hooks |
+---------------+----------------------------------------------------+
                |
+---------------v----------------------------------------------------+
| Limen v5 Engine                                                       |
| Chain | Projector | Graph | Consensus | Postgres                     |
+--------------------------------------------------------------------+
```

### 2.2 Component Responsibilities

| Component | Responsibility | Contract Document |
|-----------|---------------|-------------------|
| Shared Types Registry | Single authority for cross-contract types, permissions, trust mapping, retention, event bus, rate limits, consent, and merge semantics | SHARED_TYPES.md |
| Agent Adapter Architecture | Discovers, validates, and routes framework-native calls through canonical translation | AGENT_ADAPTER_ARCHITECTURE.md |
| Agent Lifecycle Management | Registers agents, manages 5-level trust, capabilities, consent records, and knowledge portability | AGENT_LIFECYCLE_MANAGEMENT.md |
| Agent Memory Bridge | Agent-facing memory, recall, belief, branch, merge, session, and consent-gated write operations | AGENT_MEMORY_BRIDGE.md |
| Computer Use Governance | Intercepts and governs 17 computer action variants through refusal rules, sandboxing, rate limits, and audit | COMPUTER_USE_GOVERNANCE.md |
| Agent Execution Governance | Mission/task lifecycle, delegation, budget reservations, wave scheduling, fairness, and resource evidence | AGENT_EXECUTION_GOVERNANCE.md |
| Agent Context Governance | Token budget control, importance scoring, working-memory eviction, context assembly, and boundary triggers | AGENT_CONTEXT_GOVERNANCE.md |
| Agent Intelligence Bridge | Technique extraction, evaluation, promotion/retirement, cognitive health, self-healing, and knowledge repair | AGENT_INTELLIGENCE_BRIDGE.md |
| Agent Search Governance | Vector search, semantic recall, duplicate detection, embedding lifecycle, and hybrid ranking | AGENT_SEARCH_GOVERNANCE.md |
| Agent Coordination Governance | A2A messaging, session forking, distributed sync, conflict merge, and replay verification | AGENT_COORDINATION_GOVERNANCE.md |
| Agent Output Governance | Output primitives, telemetry, structured inference, plugin install, and hook lifecycle | AGENT_OUTPUT_GOVERNANCE.md |
| Audit & Visualization | Queries, aggregates, and renders agent activity into timelines, belief graphs, governance heatmaps, and exportable reports | AUDIT_VISUALIZATION_SCHEMA.md |
| Limen Core | Existing CCP, WMP, TGP, EGP, CGP, RBAC, Consent API, Hook System, Refusal Engine, and hash-chained audit | unchanged |
| Limen v5 Engine | Append-only chain, deterministic projector, typed graph, consensus foundation, and Postgres persistence | unchanged |

### 2.3 Data Flow

**Flow 1: Agent Remembers Something**

1. Agent issues tool call (e.g., `limen_remember`) through its native interface
2. Framework-specific adapter receives the call, validates parameters, translates to `LimenOperation.Remember`
3. Adapter Registry routes to registered adapter, which invokes `LimenAgentClient.remember()`
4. LimenAgentClient enforces governance ceiling (confidence capped at 0.7 for ungrounded claims), attaches `OperationContext` with agent identity and session
5. Client delegates to CCP via `SC-11 (assert_claim)` with `grounding_mode: runtime_witness`
6. CCP persists claim, generates audit entry with SHA-256 hash chaining to previous entry
7. Hook System fires `memory:created` event with operation metadata
8. Client returns `AgentMemoryEntry` with claim ID and effective confidence to adapter
9. Adapter translates response back to framework-native format

**Flow 2: Agent Takes Computer Action**

1. Agent requests computer action (file write, command execution, network call) through adapter
2. Adapter constructs `ComputerAction` object with action type, target, parameters, and requesting agent identity
3. `ComputerActionGovernor.beforeAction()` receives the action with full `OperationContext`
4. Governor loads applicable `RefusalRule` set from governance configuration (matched by action type, target pattern, agent clearance)
5. Each matching rule evaluates: if ANY rule triggers, governor produces `GovernanceVerdict` with verdict `'refuse'` or `'escalate'` and stores a v5 Refusal node with provenance edge to triggering rule
6. If no rule triggers: governor produces verdict `'allow'`; if sandbox constraints apply, verdict is `'sandbox'` with filesystem paths, network hosts, and resource limits
7. Action executes within sandbox boundaries; result captured
8. Audit entry recorded: action, verdict, execution result, duration, sandbox constraints applied
9. Hook System fires `action:after` (permitted) or `action:refused` (denied)

**Flow 3: Agent Queries Belief Graph**

1. Agent issues recall/search query through adapter
2. Adapter translates to `LimenAgentClient.recall()` or `LimenAgentClient.getBelief()`
3. Client invokes CCP via `SC-13 (query_claims)` with subject/predicate filters
4. CCP retrieves matching claims, applies FSRS temporal decay: `R(t) = (1 + t/(9*S))^-1`
5. Claims below effective confidence threshold are excluded from response
6. Client enriches results with relationship data (supports, contradicts, supersedes, derived_from)
7. If visualization requested: `AuditQueryService` constructs `BeliefGraphSnapshot` with nodes (claims) and edges (relationships), annotated with freshness labels and decay curves
8. Response flows back through adapter to agent in framework-native format

**Flow 4: Agent Extracts a Technique**

1. Adapter translates the native observation into `TechniqueObservation`
2. `AgentIntelligenceClient.extractTechnique()` receives an `OperationContext` derived from `AgentSession`
3. Governance checks `technique_learning` capability, `query_claims`, and `assert_claim`
4. TGP stores the candidate technique with provenance kind `local_extraction`
5. Evaluation records attach runtime evidence; promotion requires threshold evidence and emits `technique:promoted`
6. Audit Visualization records the event through the unified `AgentEventBus`

**Flow 5: Agent Executes a Mission**

1. Lifecycle confirms the agent identity, trust level, and capability ceiling
2. `AgentExecutionClient.createMission()` checks `create_mission`
3. Budget reservation is created before tasks are scheduled
4. Execution waves are scheduled deterministically by priority, creation time, and task ID
5. Task state changes emit `task:state_changed`; budget consumption emits `budget:consumed`
6. Completion writes durable learnings through Memory Bridge and technique candidates through Intelligence Bridge when justified

**Flow 6: Agent Assembles Context**

1. Context Governance reads candidate claims via `query_claims` and working memory via `read_wm`
2. Importance scores are derived from relationship density, freshness, mission relevance, and pin state
3. Eviction follows deterministic ordering: unpinned, lowest importance, older creation time, lexicographic claim ID
4. `assembleContext()` outputs position-invariant sections: mission, working memory, then beliefs
5. Boundary triggers emit context events through the unified event bus

**Flow 7: Agent Searches Governed Knowledge**

1. Adapter calls `AgentSearchClient.search()` with `OperationContext`
2. Search Governance checks `query_claims`, classification ceiling, rate limits, and ranking policy
3. FTS5/sqlite-vec candidates are filtered by clearance before result serialization
4. Hybrid ranker combines FTS/vector/recency/confidence weights only after weight-sum validation
5. Search audit records query hash, returned claim IDs, filtered count, duplicate count, and embedding model

**Flow 8: Agents Coordinate**

1. Sender calls `AgentCoordinationClient.sendA2A()`
2. A2A rules enforce capability boundary, classification flow, proactive permissions, and peer authorization
3. Session forks inherit only parent-authorized capabilities and immutable history before `atTurn`
4. Sync watermarks advance monotonically by HLC; replay verification compares canonical hashes
5. Divergence returns first divergent event and emits `replay:diverged`

**Flow 9: Agent Produces Output**

1. Agent calls `AgentOutputClient.produce()` or `AgentInferenceClient.inferStructured()`
2. Output Governance checks audience classification, confidence/evidence, schema validity, conflicts, and budget
3. Rejected outputs audit without user-visible emission
4. Plugin/hook operations require provider authority, capability subset grant, isolation, deterministic priority, and failure containment

## 3. Integration with Limen Core

### 3.0 Limen Core System Call Reference

Phase X contracts delegate to Limen Core via numbered system calls (defined in the Limen Specification §10). Quick reference for implementers:

| Syscall | Operation | Spec Ref | Input → Output |
|---|---|---|---|
| SC-11 | `assert_claim` | CCP §10 | `ClaimCreateInput → AssertClaimOutput` |
| SC-12 | `relate_claims` | CCP §8 | `RelationshipCreateInput → RelateClaimsOutput` |
| SC-13 | `query_claims` | CCP §10.3 | `ClaimQueryInput → ClaimQueryResult` |
| SC-14 | `write_working_memory` | WMP §5.2 | `WriteWorkingMemoryInput → WriteWorkingMemoryOutput` |
| SC-15 | `read_working_memory` | WMP §5.3 | `ReadWorkingMemoryInput → ReadWorkingMemoryOutput` |
| SC-16 | `discard_working_memory` | WMP §5.4 | `DiscardWorkingMemoryInput → void` |

Full syscall definitions: `src/kernel/interfaces/` in the Limen codebase.

### 3.1 CCP (Claim Protocol) Integration

- `LimenAgentClient.remember()` delegates to SC-11 (`assert_claim`) with `grounding_mode: runtime_witness` and agent-supplied reasoning
- `LimenAgentClient.recall()` delegates to SC-13 (`query_claims`) with exact/prefix filters; full-text recall is a query-mode of SC-13, not a separate syscall; results are post-processed with FSRS decay
- `LimenAgentClient.forget()` delegates to `retract_claim` with reason propagation (incorrect, superseded, expired, manual)
- `LimenAgentClient.relateBelief()` delegates to SC-12 (`relate_claims`) supporting all four relationship types
- Governance ceiling enforced at client level: ungrounded claims capped at 0.7 confidence; evidence-grounded claims may reach 0.95
- `NonAuthoritative` branches use `runtime_witness` grounding with 0.5 confidence cap; branch claims are structurally isolated until merge

### 3.2 WMP (Working Memory) Integration

- Each `AgentSession` maps to a dedicated WMP namespace keyed by `session:{agentId}:{sessionId}`
- Session start invokes SC-14 (`write_working_memory`) to initialize session metadata (start time, agent identity, adapter type, declared capabilities)
- During session: working memory entries store ephemeral computation state, tool results, intermediate reasoning
- Session end invokes SC-16 (`discard_working_memory`) for cleanup; durable learnings must be promoted to CCP claims before session close
- Boundary triggers configured via Hook System fire on session lifecycle transitions: `session:started`, `session:ended`
- Working memory size bounded per session (configurable limit, default 10MB); overflow triggers oldest-entry eviction with audit trail

### 3.3 Hook System Integration

- Agent adapters may register as Limen plugins at install time, receiving a hook context with on/off/api/logger
- Phase X events use the canonical `AgentEvent` union in `SHARED_TYPES.md`: `action:before`, `action:after`, `action:refused`, `session:started`, `session:ended`, `memory:created`, `technique:promoted`, `mission:state_changed`, `context:eviction_complete`, and lifecycle events
- Hook subscriptions follow existing plugin lifecycle: activated on plugin enable, deactivated on plugin disable
- Adapters may observe Limen Core hook events through the hook bridge for reactive behavior. Core event names are not Phase X `AgentEvent` values; the bridge maps them to canonical Phase X events before they enter the agent event bus: claim assertion -> `memory:created`, claim retraction -> `memory:forgotten`, relationship creation -> `governance:allowed` with relationship metadata.
- Hook handlers cannot suppress audit-bound events; handler failure is captured as audit metadata and does not block the originating operation

### 3.4 Audit Trail Integration

- All `AgentAuditEntry` records chain into Limen's existing SHA-256 hash-chained audit trail — there is no separate agent audit chain
- Entry format extends existing audit schema with agent-specific fields: `agentId`, `sessionId`, `adapterType`, `actionType`, `governanceVerdict`
- Classification inheritance: audit entries inherit the classification level of their action targets (e.g., writing to a `confidential` claim produces a `confidential` audit entry)
- Retention policies from existing audit configuration apply uniformly to agent entries
- GDPR erasure (right to be forgotten) extends to agent audit entries: erasure tombstones replace content while preserving hash chain integrity
- Audit entries are append-only and immutable once written; corrections create new entries referencing the original

### 3.5 Refusal Engine Integration

- `ComputerActionGovernor` stores each refusal decision as a v5 `Refusal` NodeType in the typed graph
- Refusal edges (EdgeType.Refusal) connect the refused action node to the triggering governance rule node
- Refusal history is queryable via the belief graph visualization layer: filter by agent, time range, rule category, or action type
- Refusal rules are loaded from governance configuration at governor initialization and hot-reloadable via the Hook System configuration channel. This notification is not an `AgentEvent` and does not enter the audit event bus unless it changes an active rule version.
- Rule evaluation order: priority ascending first; specificity is the deterministic tie-breaker within equal priority (exact path before glob before wildcard). The first matching rule determines the verdict while all matching rules are recorded for provenance completeness.
- Refusal provenance includes: rule ID, rule version, evaluation timestamp, action hash, agent identity — sufficient for full reconstruction

### 3.6 Belief Versioning Integration

- FSRS temporal decay `R(t) = (1 + t/(9*S))^-1` applies uniformly to all agent-created claims; stability `S` initialized from claim category defaults
- `NonAuthoritative` branches cap confidence at 0.5 and isolate claims in a branch-scoped namespace until explicit merge
- Merge operations create `supersedes` relationships from branch claims to any conflicting trunk claims; merged claims inherit the higher stability value
- Conflict detection is automatic on branch merge: claims with identical subject+predicate but differing object values trigger `contradicts` edge creation
- Resolution strategies (configurable per tenant): confidence-weighted (highest effective confidence wins), temporal ordering (most recent wins), or manual escalation (conflict flagged, human resolves)
- Version history is fully traversable: given any claim, its entire lineage (superseded-by chain, derived-from tree, contradiction graph) is queryable

### 3.7 TGP, EGP, CGP, and Consent Integration

- TGP is reached only through Agent Intelligence Bridge; technique candidates, evaluations, promotions, suspensions, transfers, and retirements emit canonical `technique:*` events
- EGP is reached only through Agent Execution Governance; missions, tasks, budget reservations, and execution waves emit canonical `mission:*`, `task:*`, `budget:*`, and `wave:*` events
- CGP is reached only through Agent Context Governance; context assembly and eviction use `read_wm`, `write_wm`, `query_claims`, and `manage_cognitive` Core permissions
- Consent API is consulted before memory writes, knowledge transfer, and data export whenever `ConsentContext` or `ConsentRequirement` is triggered
- All four subsystems receive `OperationContext` derived from `AgentSession` via `sessionToContext()` in `SHARED_TYPES.md`; no subsystem accepts native adapter identity directly

### 3.8 Search, Coordination, and Output Integration

- Search Governance is the only agent path to sqlite-vec, embedding queue, duplicate detector, and hybrid ranker
- Coordination Governance is the only agent path to A2A governance, session forks, HLC sync, peer watermarks, and replay verification
- Output Governance is the only agent path to output primitives, telemetry mutation, structured inference, plugin installation, and hook registration
- These surfaces use canonical `GovernanceAction` domains in `SHARED_TYPES.md` and emit only canonical `AgentEvent` values

## 4. Security Model

### 4.1 Identity and Authentication

- Every agent receives an `AgentId` (branded string type: `type AgentId = string & { __brand: 'AgentId' }`) assigned at adapter registration
- `OperationContext` threads agent identity, session ID, and clearance level through every operation; timestamps come from the injected TimeProvider at the operation/audit layer — no operation executes without a populated context
- Clearance levels (unrestricted, internal, confidential, restricted, critical) gate access: agents cannot read or write claims above their clearance
- Session-scoped permissions: capabilities declared at session start are the maximum permissions for that session; no runtime escalation
- Adapter registration requires capability declaration: the set of operations the adapter may invoke on behalf of its agents

### 4.2 Sandboxing Boundaries

- **Filesystem**: path-based allowlists per adapter; each adapter declares accessible paths at registration; all file operations validated against allowlist before execution
- **Network**: host-based allowlists with optional port restrictions; DNS resolution monitored; egress limited to declared hosts
- **Process**: command whitelists (exact match, no glob); resource limits (CPU time, memory, file descriptors) enforced via OS-level controls
- **Code execution**: isolated sandbox with configurable timeout (default 30s); stdout/stderr captured; exit code recorded in audit
- Each adapter declares its sandbox requirements at registration; the governor validates that requested permissions do not exceed the adapter's declared capability ceiling
- Sandbox violations are treated as refusals: action denied, violation recorded in audit, `action:refused` event fired

### 4.3 Threat Model

| Threat | Attack Vector | Mitigation |
|--------|--------------|------------|
| Prompt injection via agent memory | Malicious content stored as claims, later recalled and executed by another agent | Content sanitization at write boundary; classification enforcement prevents cross-level recall; all recalled content tagged as `agent-sourced` (non-authoritative) |
| Privilege escalation via adapter | Adapter attempts operations beyond its declared capabilities | Capability declaration immutable after registration; every operation validated against declared set; violation triggers adapter suspension and audit alert |
| Audit chain tampering | Attacker modifies historical audit entries to hide actions | SHA-256 hash chain with each entry referencing previous hash; any modification breaks chain verification; append-only storage with no update/delete operations |
| Sandbox escape | Agent command exploits OS-level vulnerability to break isolation | OS-level process isolation (namespaces where available); resource limits (ulimit); command whitelist (no shell metacharacters); monitoring for anomalous resource consumption |
| Cross-agent data leakage | Agent A reads claims belonging to Agent B's isolated context | Tenant isolation at CCP level; session-scoped namespaces; classification enforcement at every query boundary; no cross-session reads without explicit sharing declaration |

### 4.4 Trust Boundaries

- **Agent to Adapter**: UNTRUSTED. Adapter validates all input from the agent framework: type checking, size limits, content sanitization. Agent input is never passed raw to Limen Core.
- **Adapter to LimenAgentClient**: TRUSTED. Adapter has passed registration validation and capability declaration. Client trusts adapter identity but enforces governance ceiling independently.
- **LimenAgentClient to Limen Core**: TRUSTED. Same process boundary. Client is a thin governance-enforcing wrapper over Core operations.
- **Agent to ComputerActionGovernor**: UNTRUSTED. Every computer action is evaluated against the full rule set regardless of agent identity or prior history. No trust accumulation.

## 5. Multi-Agent Coordination (Foundation)

### 5.1 Shared Governed Memory

- Multiple agents can share a tenant's memory space when configured for multi-agent access
- All shared claims are governed by the same CCP rules: confidence ceiling, classification, FSRS decay
- Conflict detection via CCP `contradicts` relationship: when Agent A asserts a claim that contradicts Agent B's existing claim, the contradiction is recorded automatically
- Resolution strategies are tenant-configurable:
  - **Confidence-weighted**: highest effective confidence (post-decay) wins; loser claim receives `supersedes` edge
  - **Temporal ordering**: most recent assertion wins; useful for rapidly-changing state
  - **Manual escalation**: conflict flagged in audit, human operator resolves; both claims remain active until resolution

### 5.2 Agent-to-Agent Communication

- **Via shared claims**: Agent A asserts a claim with a known predicate convention (e.g., `coordination.request`); Agent B queries that predicate pattern on its next recall cycle
- **Via working memory namespaces**: agents sharing a task can read/write to a common WMP namespace (keyed by task ID rather than session ID); useful for ephemeral coordination state
- **Via event bridge**: Agent A's governed actions fire canonical `AgentEvent` records; Agent B subscribes through its adapter hook registration; enables reactive coordination without polling

### 5.3 Coordination Patterns

1. **Leader-Follower**: Leader agent writes claims and working memory; follower agents observe via recall with read-only access to the shared namespace. Leader's claims have higher base confidence. Followers may assert observations but cannot supersede leader claims.
2. **Peer**: Agents share namespace with equal authority. CCP contradiction detection and configured resolution strategy handle conflicts. Suitable for collaborative exploration where no single agent has primacy.
3. **Hierarchical**: Parent agent creates missions (via EGP), assigns to child agents. Child agents report progress and findings via claims scoped to the mission. Parent aggregates, resolves conflicts, and produces final claims. Maps directly to Limen's existing mission/task model.

### 5.4 Future: Consensus Protocol

- Limen v5 reserves the consensus module for multi-agent agreement on shared beliefs
- Current model: single-writer (one agent per claim assertion); conflicts resolved post-hoc by strategy
- Future model: multi-agent voting on claim confidence before claim reaches `active` status
- Consensus threshold configurable per predicate domain (e.g., `security.*` requires 3/5 agents; `observation.*` requires 1/1)
- Implementation deferred until v5 reaches beta and multi-agent deployments provide empirical conflict data

## 6. Migration Path

### 6.1 From LangGraph Adapter

- **Current state**: `LimenCheckpointSaver` and `LimenStore` implement LangGraph's `CheckpointSaver` and `Store` interfaces directly against Limen Core
- **Phase X state**: LangGraph becomes one adapter among many in the Agent Adapter Registry
- **Migration mechanics**: existing `LimenCheckpointSaver` and `LimenStore` are wrapped inside a `LangGraphAdapter` implementing the `AgentAdapter` interface; internal behavior unchanged
- **Compatibility guarantee**: no breaking changes to existing LangGraph users; existing checkpoint data remains accessible; existing LangGraph workflows continue to function without modification
- **Deprecation path**: direct LangGraph integration (current) deprecated in favor of LangGraph-via-adapter; 6-month deprecation window with runtime warnings; removal in Limen v6

### 6.2 From Direct Limen API

- **Current state**: agents (including Claude Code via MCP) use Limen's convenience API (`limen_remember`, `limen_recall`, etc.) directly
- **Phase X state**: `LimenAgentClient` provides a higher-level, governed interface purpose-built for agent workflows
- **Migration mechanics**: `LimenAgentClient` wraps the convenience API internally; direct API remains fully functional and supported
- **Compatibility guarantee**: no breaking changes; `LimenAgentClient` is purely additive; existing MCP tool definitions continue to work
- **Recommended migration**: new agent integrations should use `LimenAgentClient` for governance benefits (confidence ceiling, session management, audit enrichment); existing integrations migrate at their own pace

## 7. Implementation Phases (Deferred)

### Phase X.1 — Core (4 weeks)

- `LimenAgentClient` full implementation: remember, recall, forget, getBelief, relateBelief, branch, merge, session lifecycle
- `AgentAdapter` interface definition with TypeScript branded types and Zod validation schemas
- `AdapterRegistry` with registration, discovery, health monitoring, and capability validation
- Claude Code adapter (reference implementation demonstrating full interface compliance)
- Basic audit logging: agent operations recorded in existing hash chain with agent-specific metadata
- Test target: 400+ tests covering all client operations, adapter lifecycle, and error paths

### Phase X.2 — Governance (3 weeks)

- `ComputerActionGovernor` implementation with rule evaluation engine
- `RefusalRule` definition language: pattern-based matching on action type, target, parameters
- Provenance chain: every verdict (permit or refuse) cryptographically linked to evaluated rules
- Sandboxing framework: filesystem, network, process, and code execution boundaries
- v5 Refusal node integration: refused actions stored as graph nodes with governance edges
- Test target: 300+ tests covering rule evaluation, sandbox enforcement, provenance integrity

### Phase X.3 — Visualization (3 weeks)

- `AuditQueryService` implementation with time-range, agent, action-type, and verdict filters
- Timeline view data layer: chronological agent activity with governance annotations
- Belief graph data layer: nodes (claims), edges (relationships), FSRS decay overlays
- Governance heatmap data layer: action frequency by category, refusal rates, risk concentration
- Export: JSON (full fidelity), CSV (tabular subset), with classification-aware redaction
- Test target: 250+ tests covering query correctness, pagination, classification filtering, export format compliance

### Phase X.4 — Adapters (4 weeks)

- Codex adapter: maps Codex tool-call conventions to LimenAgentClient operations
- OpenClaw adapter: maps OpenClaw's plugin interface to AgentAdapter
- Hermes adapter: maps Hermes message format to LimenAgentClient
- Custom adapter template: documented skeleton with inline guidance for new framework integration
- Adapter discovery: file-system scanning and dynamic loading of adapter packages
- Test target: 200+ tests per adapter covering translation fidelity, error handling, session lifecycle

### Phase X.5 — Advanced (4 weeks)

- Multi-agent coordination: shared namespaces, conflict detection, resolution strategy configuration
- PDF/SVG export for audit visualization (timeline, belief graph renders)
- Performance optimization: query result caching, batch audit writes, adapter connection pooling
- v5 deep integration: when v5 reaches beta, migrate governance graph operations from v4 CCP to v5 typed graph
- Test target: 300+ tests covering coordination scenarios, export rendering, performance benchmarks

## 8. Success Criteria

1. Any agent framework can integrate with Limen by implementing `AgentAdapter` (4 methods + lifecycle hooks) — verified by custom adapter template passing full compliance test suite
2. All agent actions are governed, audited, and queryable — verified by zero-unaudited-operation invariant in integration tests
3. Belief versioning works across agent sessions and frameworks — verified by cross-adapter session continuity tests with FSRS decay validation
4. Computer use governance prevents dangerous operations — verified by adversarial test suite (100+ attack patterns, zero escapes)
5. Visualization layer provides actionable insights — verified by query result accuracy tests against known audit datasets
6. No changes to Limen Core required for new agent support — verified by adapter addition without Core modification (structural constraint)
7. Migration from existing integrations is non-breaking — verified by existing LangGraph and MCP test suites passing unchanged after Phase X deployment
8. Performance: less than 10ms governance-check overhead per governed action; durable audit append has a separate 50ms budget — verified by benchmark suite under sustained load (1000 ops/sec)

## 9. Contract Document Index

| Document | Scope | Key Interfaces |
|----------|-------|---------------|
| SHARED_TYPES.md | Canonical cross-contract types, trust mapping, permissions, retention, rate limits, event bus, consent, merge ordering | `AgentSession`, `GovernanceContext`, `ComputerAction`, `AgentEventBus`, `RetentionPolicy` |
| AGENT_MEMORY_BRIDGE.md | Memory operations, belief management, session lifecycle, NonAuthoritative branching | `LimenAgentClient`, `AgentMemoryEntry`, `AgentBeliefState`, `AgentSession`, `NonAuthoritativeContext` |
| COMPUTER_USE_GOVERNANCE.md | Action interception, rule evaluation, refusal provenance, sandbox enforcement | `ComputerActionGovernor`, `ComputerAction`, `RefusalRule`, `GovernanceVerdict`, `SandboxConfig` |
| AUDIT_VISUALIZATION_SCHEMA.md | Audit querying, timeline rendering, belief graph construction, heatmap aggregation, export | `AgentAuditEntry`, `AuditQueryService`, `BeliefGraphSnapshot`, `GovernanceHeatmapData`, `TimelineView` |
| AGENT_ADAPTER_ARCHITECTURE.md | Pluggable adapter interface, registration protocol, discovery, lifecycle management | `AgentAdapter`, `AdapterRegistry`, `AdapterCapabilities`, `LimenOperation`, `AdapterHealthStatus` |
| AGENT_LIFECYCLE_MANAGEMENT.md | Agent registration, trust/capability evolution, consent records, decommission, knowledge portability | `AgentLifecycleClient`, `RegisteredAgent`, `CapabilityDecision`, `ConsentDecision` |
| AGENT_EXECUTION_GOVERNANCE.md | Mission/task lifecycle, budget reservations, execution waves, scheduling fairness | `AgentExecutionClient`, `AgentMission`, `AgentTask`, `BudgetReservation`, `ExecutionWave` |
| AGENT_CONTEXT_GOVERNANCE.md | Context budget, importance scoring, working memory governance, eviction, assembly | `AgentContextClient`, `ContextBudget`, `ImportanceScore`, `EvictionPolicy`, `AssembledContext` |
| AGENT_INTELLIGENCE_BRIDGE.md | Technique learning, cognitive health, self-healing, conflict repair | `AgentIntelligenceClient`, `AgentTechnique`, `TechniqueEvaluation`, `SelfHealReport` |

## 10. Invariants (System-Level)

1. **Core Isolation**: Limen Core is never modified for agent-specific logic. All agent behavior lives in the integration layer above Core.
2. **Client Mediation**: All agent interactions flow through `LimenAgentClient` — no direct Core access for agents. The client is the sole entry point.
3. **Governance Non-Optionality**: Every write operation and every computer action is governed. There is no ungoverned path through the system.
4. **Unified Audit Chain**: Agent entries and core entries share one SHA-256 hash chain. No separate audit streams. One source of truth.
5. **Adapter Purity**: Adapters are pure translation layers — they convert framework-specific formats to `LimenOperation` and back. No business logic lives in adapters.
6. **Classification Enforcement**: Classification is enforced at every boundary crossing. No data flows from a higher classification to a lower one without explicit declassification.
7. **Session Isolation**: No cross-session state contamination. Session working memory is invisible to other sessions. Session end is a hard boundary.
8. **CCP Conflict Authority**: Multi-agent conflict resolution uses CCP's existing relationship and resolution mechanisms. No custom conflict logic outside CCP.
9. **Additive Migration**: Existing integrations continue to work without modification. Phase X is purely additive — no breaking changes to any existing API surface.
10. **Performance Budget**: Less than 10ms overhead for governance check only (measured as: rule evaluation, trust/capability/rate checks, and verdict production). Durable audit append is mandatory before success and has its own 50ms budget.
