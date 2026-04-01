# PHASE 8 DEFECT-CLASS DECLARATION: INTEGRATIONS

**Date**: 2026-04-01
**Author**: Builder
**Status**: CONTROL 1
**Phase**: 8 (Integrations)
**Design Source**: PHASE-8-DESIGN-SOURCE.md (APPROVED)

---

## 1. DATA INTEGRITY

| ID | Description | Category | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|
| DC-P8-101 | Export JSON roundtrip: export then import must produce semantically identical claims (subject, predicate, object, confidence, validAt, status, groundingMode, stability, reasoning) | 1: Data integrity | CBM | Contract test: export -> import -> query -> compare | DS O8 (CONSTITUTIONAL) | Success: roundtrip matches. Rejection: field mismatch detected with specific diff. |
| DC-P8-102 | Import dedup by_content: claims with identical subject+predicate+objectValue+status are skipped, not duplicated | 1: Data integrity | CBM | Contract test: import same document twice, verify count unchanged | DS O8 (CONSTITUTIONAL) | Success: second import skips all. Rejection: import with dedup=none creates duplicates (proves dedup active). |
| DC-P8-103 | Import ID remapping: relationships reference new IDs, not original source IDs | 1: Data integrity | CBM | Contract test: export with relationships -> import -> verify relationship endpoints use new IDs | DS O8 (CONSTITUTIONAL) | Success: relationships rebind to new IDs. Rejection: relationship with non-existent claim ID detected. |
| DC-P8-104 | Export includes Phase 3/5 fields: stability, reasoning preserved in JSON export | 1: Data integrity | CBM | Contract test: create claim with reasoning -> export -> verify JSON contains reasoning field | DS O2 (ExportedClaim) | Success: all fields present. Rejection: missing field in export. |
| DC-P8-105 | CSV export is lossy: no relationships, no evidence refs exported | 1: Data integrity | CBM | Contract test: export as CSV -> verify no relationship columns | DS O2, DD-06 | Success: CSV contains only claim columns. N/A rejection (design principle). |

## 2. STATE CONSISTENCY

| ID | Description | Category | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|
| DC-P8-201 | Plugin lifecycle follows state machine: REGISTERED -> INSTALLING -> INSTALLED -> DESTROYING -> DESTROYED | 2: State consistency | CBM | Contract test: install plugin, verify state transitions, shutdown, verify destroy | DS O3 (Plugin Lifecycle) | Success: all transitions in order. Rejection: calling install on already-installed plugin errors. |
| DC-P8-202 | Plugin install failure transitions to FAILED, does not block other plugins | 2: State consistency | CBM | Contract test: register failing plugin + good plugin, verify good one installs | DS O3 | [A21] Success: good plugin installed. Rejection: failing plugin error propagated, good plugin state = INSTALLED. |
| DC-P8-203 | Plugin destroy called in reverse install order during shutdown | 2: State consistency | CBM | Contract test: install A, B, C -> shutdown -> verify destroy order C, B, A | DS O3 | Success: reverse order verified via callback tracking. |
| DC-P8-204 | Plugin destroy failure is non-fatal: logged, shutdown continues | 2: State consistency | CBM | Contract test: plugin with throwing destroy() -> shutdown completes | DS O5 (PLUGIN_DESTROY_FAILED) | Success: shutdown completes despite destroy error. |

## 3. CONCURRENCY

| ID | Description | Category | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|
| DC-P8-301 | Event handler error isolation: one handler throwing does not prevent other handlers from executing | 3: Concurrency | CBM | Contract test: register two handlers, first throws, verify second still called | DS O8 (CONSTITUTIONAL) | [A21] Success: both handlers invoked. Rejection: error in handler A prevents handler B from running. |
| DC-P8-302 | Event handlers execute synchronously in registration order | 3: Concurrency | CBM | Contract test: register handlers, emit event, verify call order | DS DD-07 | Success: order matches registration order. |

## 4. AUTHORITY / GOVERNANCE

| ID | Description | Category | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|
| DC-P8-401 | Plugin API access blocked during install(): calling api methods during install() must error | 4: Authority | CBM | Contract test: plugin that calls api.remember() in install() -> PLUGIN_API_NOT_READY | DS O8 (CONSTITUTIONAL) | [A21] Success: deferred API call works post-install. Rejection: install-time API call returns PLUGIN_API_NOT_READY. |
| DC-P8-402 | Plugin name uniqueness enforced: duplicate names rejected with PLUGIN_DUPLICATE_NAME | 4: Authority | CBM | Contract test: register two plugins with same name | DS O8 (CONSTITUTIONAL) | [A21] Success: unique names accepted. Rejection: duplicate name returns PLUGIN_DUPLICATE_NAME. |
| DC-P8-403 | Plugin count capped at MAX_PLUGINS (50): exceeding returns PLUGIN_MAX_EXCEEDED | 4: Authority | CBM | Contract test: attempt to register 51 plugins | DS O8 (QUALITY_GATE) | [A21] Success: 50 plugins accepted. Rejection: 51st returns PLUGIN_MAX_EXCEEDED. |
| DC-P8-404 | Invalid plugin meta (missing name or version) rejected with PLUGIN_INVALID_META | 4: Authority | CBM | Contract test: plugin with empty name | DS O5 | [A21] Success: valid meta accepted. Rejection: empty name returns PLUGIN_INVALID_META. |
| DC-P8-405 | Invalid event name rejected with PLUGIN_INVALID_EVENT | 4: Authority | CBM | Contract test: on('invalid:event', handler) | DS O5 | [A21] Success: valid event name accepted. Rejection: invalid name returns PLUGIN_INVALID_EVENT. |

## 5. CAUSALITY / OBSERVABILITY

| ID | Description | Category | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|
| DC-P8-501 | Event name mapping correctness: consumer 'claim:asserted' maps to internal 'claim.asserted' | 5: Causality | CBM | Contract test: subscribe to 'claim:asserted', emit internal 'claim.asserted', verify handler fires | DS O8 (CONSTITUTIONAL) | [A21] Success: handler receives event. Rejection: subscribe to wrong name, handler does not fire. |
| DC-P8-502 | Wildcard event subscription receives all events | 5: Causality | CBM | Contract test: subscribe to '*', emit multiple event types, verify all received | DS O2 (LimenEventName) | Success: all event types received. |
| DC-P8-503 | Event payload contains type, data, and timestamp | 5: Causality | CBM | Contract test: subscribe, emit, verify payload shape | DS O2 (LimenEvent) | Success: all fields present. |
| DC-P8-504 | limen.off() successfully unsubscribes: handler no longer fires after off() | 5: Causality | CBM | Contract test: subscribe, off, emit, verify handler not called | DS O2 | [A21] Success: handler fires before off(). Rejection: handler does not fire after off(). |

## 6. MIGRATION / EVOLUTION

| ID | Description | Category | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|
| DC-P8-601 | Zero new database migrations: Phase 8 introduces no schema changes | 6: Migration | CBM | Verification: no new migration files added | DS O6 | N/A — structural constraint, verified by file listing. |
| DC-P8-602 | Export version field enables forward compatibility: version = '1.0.0' in all exports | 6: Migration | CBM | Contract test: export -> verify version field | DS O2 (LimenExportDocument) | Success: version field present and correct. |
| DC-P8-603 | Import validates version field: wrong version rejected with IMPORT_INVALID_DOCUMENT | 6: Migration | CBM | Contract test: import document with version '2.0.0' | DS O5 | [A21] Success: version '1.0.0' accepted. Rejection: version '2.0.0' returns IMPORT_INVALID_DOCUMENT. |

## 7. CREDENTIAL / SECRET

| ID | Description | Category | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|
| DC-P8-701 | CREDENTIAL / SECRET -- NOT APPLICABLE | 7: Credential | N/A | Phase 8 does not handle credentials, secrets, or tokens. Plugin system does not expose masterKey, database connection internals, or encryption keys. The PluginContext.api is a scoped view of the public convenience API only. | N/A | N/A |

## 8. BEHAVIORAL / MODEL QUALITY

| ID | Description | Category | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|
| DC-P8-801 | LangChain adapter as separate package: limen-ai has zero new production dependencies | 8: Behavioral | CBM | Verification: package.json dependencies unchanged after Phase 8 | DS O8 (CONSTITUTIONAL) | N/A — structural constraint, verified by package.json diff. |

## 9. AVAILABILITY / RESOURCE

| ID | Description | Category | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|
| DC-P8-901 | Plugin install failure does not prevent engine construction | 9: Availability | CBM | Contract test: config with failing plugin -> createLimen succeeds | DS O3 | [A21] Success: engine created despite plugin failure. Rejection: createLimen throws on plugin failure. |
| DC-P8-902 | Import with onConflict='error' rejects duplicates with IMPORT_DEDUP_CONFLICT | 9: Availability | CBM | Contract test: import same data twice with onConflict='error' | DS O5 | [A21] Success: first import succeeds. Rejection: second import returns IMPORT_DEDUP_CONFLICT. |
| DC-P8-903 | Export with invalid format returns EXPORT_INVALID_FORMAT | 9: Availability | CBM | Contract test: export with format='xml' | DS O5 | [A21] Success: valid format exports. Rejection: invalid format returns error code. |

---

## ASSUMPTION LEDGER

| Assumption | Owner | Review Trigger | Invalidation Trigger | Response When Broken |
|---|---|---|---|---|
| EventBus.subscribe() supports glob patterns including '*' for wildcard | Builder | Phase 8 implementation | EventBus implementation changes to not support glob | Plugin system event mapping must be re-derived |
| Limen object is deep-frozen at line 1245 of index.ts | Builder | Any change to createLimen() | deepFreeze call removed or moved | Plugin install timing must be re-validated |
| ClaimApi is accessible via closure after freeze | Builder | Freeze behavior changes | Closures broken by new freeze implementation | All convenience methods and plugin API must be redesigned |
| LangChain @langchain/core BaseMemory interface is stable at ^0.3.0 | Builder | LangChain major version | BaseMemory interface breaks in 0.4.0 | Adapter package must be version-bumped |

---

## SELF-AUDIT (Method Quality)

- Did I derive from spec? YES -- all DCs trace to Design Source outputs.
- Did I cover all 9 categories? YES -- Category 7 explicitly marked N/A with rationale.
- Did I mark enforcement DCs with [A21]? YES -- all enforcement DCs have success and rejection paths.
- Do NOT judge completeness -- that is the Breaker's job (HB#23).

---

*SolisHQ -- We innovate, invent, then disrupt.*
