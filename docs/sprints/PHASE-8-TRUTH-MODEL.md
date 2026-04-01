# PHASE 8 TRUTH MODEL: INTEGRATIONS

**Date**: 2026-04-01
**Author**: Builder
**Status**: CONTROL 2
**Phase**: 8 (Integrations)
**Design Source**: PHASE-8-DESIGN-SOURCE.md (APPROVED)

---

## INVARIANTS

### Plugin System

**I-P8-01 (CONSTITUTIONAL)**: Plugin install occurs BEFORE Object.freeze(). After freeze, no plugin can be installed.
```
forall plugin in config.plugins:
  plugin.install(context) called BEFORE deepFreeze(engine)
```

**I-P8-02 (CONSTITUTIONAL)**: Plugin names are unique within a Limen instance.
```
forall p1, p2 in installedPlugins:
  p1 !== p2 => p1.meta.name !== p2.meta.name
```

**I-P8-03 (CONSTITUTIONAL)**: Plugin API methods are not callable during install().
```
during plugin.install(context):
  context.api.remember() => Error(PLUGIN_API_NOT_READY)
  context.api.recall() => Error(PLUGIN_API_NOT_READY)
  context.api.forget() => Error(PLUGIN_API_NOT_READY)
  context.api.search() => Error(PLUGIN_API_NOT_READY)
  context.api.connect() => Error(PLUGIN_API_NOT_READY)
```

**I-P8-04**: Plugin destroy order is reverse of install order.
```
if install_order = [A, B, C]:
  destroy_order = [C, B, A]
```

**I-P8-05**: Plugin count bounded: |installedPlugins| <= MAX_PLUGINS (50).

**I-P8-06**: Plugin install failure does not prevent engine construction. Failed plugins are logged and skipped.

### Event Hooks

**I-P8-10 (CONSTITUTIONAL)**: Consumer event names map bidirectionally to internal EventBus types.
```
forall (consumerName, internalName) in EVENT_NAME_MAP:
  limen.on(consumerName, handler) => EventBus.subscribe(internalName, wrappedHandler)
  EventBus.emit(internalName) => handler receives LimenEvent with type = consumerName
```

**I-P8-11 (CONSTITUTIONAL)**: Event handler errors are isolated. One handler throwing does not prevent other handlers from executing.
```
forall handlers H1..Hn subscribed to event E:
  if Hi throws:
    forall j != i: Hj still executes
```

**I-P8-12 (CONSTITUTIONAL)**: limen.on()/off() work on frozen Limen instance (closure-captured EventBus reference).

**I-P8-13**: Wildcard '*' subscription receives all mapped event types.

### Export/Import

**I-P8-20 (CONSTITUTIONAL)**: JSON export-import roundtrip preserves claim data fidelity.
```
forall claims C in limen instance:
  export(json) -> import(json) produces claims C' where:
    C'.subject = C.subject
    C'.predicate = C.predicate
    C'.object = C.object
    C'.confidence = C.confidence
    C'.validAt = C.validAt
    C'.status = C.status
    C'.groundingMode = C.groundingMode
    C'.stability = C.stability
    C'.reasoning = C.reasoning
  (IDs differ -- I-P8-21)
```

**I-P8-21 (CONSTITUTIONAL)**: Imported claims receive new IDs. Old-to-new mapping maintained for relationship rebinding.
```
forall imported claim c:
  c.newId = freshUUID()
  c.newId !== c.originalId
  idMap[c.originalId] = c.newId
```

**I-P8-22 (CONSTITUTIONAL)**: Import dedup by_content: claims with matching (subject, predicate, objectValue, status) are skipped.
```
forall claim c in import document:
  if exists local_claim l where
    l.subject = c.subject AND
    l.predicate = c.predicate AND
    l.objectValue = c.objectValue AND
    l.status = c.status:
  then c is SKIPPED (not imported)
```

**I-P8-23 (CONSTITUTIONAL)**: Import relationship rebinding uses idMap.
```
forall relationship r in import document:
  r.newFromId = idMap[r.originalFromId]
  r.newToId = idMap[r.originalToId]
  if idMap[r.originalFromId] is undefined OR idMap[r.originalToId] is undefined:
    r is SKIPPED (not imported)
```

**I-P8-24**: Export version field is always '1.0.0'.

**I-P8-25**: Import rejects documents with version !== '1.0.0'.

**I-P8-26 (CONSTITUTIONAL)**: limen.export()/importData() work on frozen Limen instance.

### Dependency Boundary

**I-P8-30 (CONSTITUTIONAL)**: limen-ai package.json dependencies unchanged after Phase 8. Zero new production dependencies.

**I-P8-31 (CONSTITUTIONAL)**: LangChain adapter lives in packages/limen-langchain/ with peer dependencies only.

---

## STATE MACHINES

### Plugin Lifecycle (per plugin)

```
REGISTERED --[install()]-> INSTALLING --[success]--> INSTALLED --[shutdown()]--> DESTROYING --[success]--> DESTROYED
                              |                                                     |
                              +--[throws]-> FAILED                                  +--[throws]--> FAILED (non-fatal)
```

Terminal states: INSTALLED (normal), DESTROYED (after shutdown), FAILED

### Import Pipeline

```
VALIDATING --[valid]--> DEDUPLICATING --[done]--> IMPORTING_CLAIMS --[done]--> REBINDING_RELATIONSHIPS --[done]--> COMPLETE
    |                                                  |                              |
    +--[invalid]--> FAILED                             +--[partial]--> PARTIAL_FAIL   +--[partial]--> PARTIAL_FAIL
```

---

## FAILURE SEMANTICS

| Failure | Behavior | Error Code |
|---|---|---|
| Plugin install throws | Plugin marked FAILED, other plugins continue, engine constructs | PLUGIN_INSTALL_FAILED (logged) |
| Plugin destroy throws | Logged, shutdown continues to next plugin | PLUGIN_DESTROY_FAILED (logged) |
| Event handler throws | Caught, logged, other handlers continue | (no error code -- internal isolation) |
| Export format unknown | Immediate error return | EXPORT_INVALID_FORMAT |
| Import document invalid | Immediate error return | IMPORT_INVALID_DOCUMENT |
| Import claim fails | Skipped, counted in result.failed | IMPORT_CLAIM_FAILED |
| Duplicate on import with onConflict=error | Immediate error return | IMPORT_DEDUP_CONFLICT |
| API call during plugin install | Immediate error return | PLUGIN_API_NOT_READY |

---

## SELF-AUDIT (Method Quality)

- Did I derive from Design Source? YES -- every invariant traces to DS outputs.
- Did I formalize all CONSTITUTIONAL elements from DS O8? YES.
- Did I specify failure semantics? YES -- every error code from DS O5.
- Do NOT judge completeness -- that is the Breaker's job (HB#23).

---

*SolisHQ -- We innovate, invent, then disrupt.*
