# Phase 8 Breaker Report

**Date**: 2026-04-02
**Role**: Breaker (Independent Attack Pass — Control 4)
**Agent**: Breaker
**Branch**: phase-8-integrations
**Tests Run**: 34 breaker tests + 30 existing builder tests
**Mutation Tests**: 1 performed (within-batch dedup removal)

---

## Summary

- **Total findings**: 8
- **CRITICAL**: 1
- **HIGH**: 3
- **MEDIUM**: 3
- **LOW**: 1

---

## Findings

### [CRITICAL] F-001: DC-P8-403 Has NO Test — Max Plugin Count Enforcement

**Attack Vector**: AV-12 (Plugin Max Count)
**File**: `tests/unit/phase8_integrations.test.ts` (missing test)
**Description**: DC-P8-403 declares that plugin count is capped at MAX_PLUGINS (50) and exceeding it returns PLUGIN_MAX_EXCEEDED. The DC Declaration header comment in the test file lists DC-P8-403 as covered, but NO actual test exists. This is a direct violation of Hard Ban #24 (enforcement DCs require both success AND rejection tests) and Hard Ban #7 (code marked complete without linked verification artifacts).

The implementation at `src/plugins/plugin_registry.ts:278` correctly enforces the limit. However, the consumer-facing error surface is different: `createLimen()` at `src/api/index.ts:979` catches the error result and logs it — meaning the engine STILL constructs with 0 plugins installed. Neither the success path (50 plugins accepted) nor the rejection path (51+ returns PLUGIN_MAX_EXCEEDED) is tested.

**Proof**: Breaker test AV-12 creates 51 plugins and confirms createLimen succeeds (error is logged, not thrown). No assertion in existing tests validates the limit behavior.
**Impact**: If the MAX_PLUGINS check were removed, no test would fail. The resource containment invariant I-P8-05 is unverified.
**Recommendation**: Add test with 50 plugins (success) and 51 plugins (rejection — verify PLUGIN_MAX_EXCEEDED logged AND 0 plugins installed). Per A21, both paths required.

---

### [HIGH] F-002: Event Mapping Only Tests 1 of 6 Event Types

**Attack Vector**: AV-21 (Event Name Mapping Completeness)
**File**: `tests/unit/phase8_integrations.test.ts:248-259` (DC-P8-501)
**Description**: The event name mapping (I-P8-10) declares 6 bidirectional mappings: `claim:asserted`, `claim:retracted`, `claim:evidence:retracted`, `claim:relationship:declared`, `claim:tombstoned`, `claim:evidence:orphaned`. The existing tests ONLY verify `claim:asserted`. None of the other 5 event types are tested for correct mapping/delivery.

The Breaker confirmed that `claim:retracted` works (AV-21 test passes after fix) — but this was only discovered because the Breaker tested it. The existing builder tests provide zero evidence that `claim:retracted`, `claim:tombstoned`, `claim:evidence:retracted`, `claim:evidence:orphaned`, or `claim:relationship:declared` are correctly mapped.

**Proof**: `grep 'claim:retracted\|claim:tombstoned\|claim:evidence' tests/unit/phase8_integrations.test.ts` returns no matches.
**Impact**: If the EVENT_NAME_MAP at `src/plugins/plugin_types.ts:66-73` had a wrong mapping for any of the 5 untested events, no test would catch it.
**Recommendation**: Add event delivery tests for all 6 mapped event types. Each test: subscribe to consumer name, trigger the action, verify handler fires with correct type.

---

### [HIGH] F-003: Import Dedup Within-Batch Check Mutation Survives All Builder Tests

**Attack Vector**: AV-6 (Import Dedup Mutation)
**File**: `src/exchange/import.ts:110-117`
**Description**: When the within-batch dedup logic (lines 110-117 of import.ts) is REMOVED (mutated out), all 30 existing builder tests still pass. The mutation survives because the database check (`existsInDatabase()` at line 120) provides a fallback — after the first claim is imported into the DB, subsequent duplicates are caught by the DB query.

While the within-batch check is an optimization (avoids N unnecessary DB queries for N-1 duplicates in a batch), it is also the ONLY guard against `onConflict='error'` detecting within-batch duplicates on the FIRST import of a fresh database. In a clean database, if two identical claims appear in the same import document, the first is imported, then the second hits the DB check. But if the first import + DB write is slower than expected, there's a race window.

**Proof**: Mutation test performed: commented out lines 110-117, ran `npx tsx --test tests/unit/phase8_integrations.test.ts` — all 30 pass. Breaker test AV-17 also passed because DB fallback caught duplicates. However, the within-batch dedup serves a DIFFERENT purpose for `onConflict='error'` mode where batch-internal duplicates should be caught WITHOUT first writing to the DB.
**Impact**: The within-batch dedup can be accidentally removed without any test breaking. This is a test quality gap.
**Recommendation**: Add test: import document with batch-internal duplicates where `onConflict='error'`. The within-batch check should return IMPORT_DEDUP_CONFLICT on the second duplicate WITHOUT writing the first to the database. This requires a specifically crafted test that validates the error fires on the BATCH duplicate, not the DB duplicate.

---

### [HIGH] F-004: Import Does Not Validate Individual Claim Field Types

**Attack Vector**: AV-5 (Import Malformed Documents)
**File**: `src/exchange/import.ts:103-172`
**Description**: The import function validates the document envelope (version, claims array presence) but does NOT validate individual claim field types before passing to `assertClaim()`. Any malformed claim (wrong types, missing fields, NaN confidence, invalid dates) is passed directly to the ClaimApi, which may or may not validate it.

The import relies entirely on the downstream `assertClaim()` for field validation. If `assertClaim()` has gaps (e.g., doesn't validate `objectType` enum values), the import will silently accept garbage data. This is a defense-in-depth failure — the import boundary should validate before delegation.

Evidence: Confidence 999.0 IS correctly rejected by ClaimApi (`Confidence must be in [0.0, 1.0]`). But `objectType` is cast directly (`claim.objectType as 'string' | 'number' | ...` at line 142) with no validation — any string passes the TypeScript cast at runtime.

**Proof**: Breaker test AV-5 "import claim with empty subject" — the import passes it through to assertClaim, which rejects it, reporting `failed: 1`. The import itself does no validation.
**Impact**: If ClaimApi validation has any gap, the import pipeline inherits it. Defense-in-depth says the trust boundary (import from external JSON) should have its own validation layer.
**Recommendation**: Add validation at the import boundary for at minimum: non-empty subject, non-empty predicate, confidence in [0,1], objectType in allowed enum, non-empty objectValue, valid ISO 8601 dates.

---

### [MEDIUM] F-005: CSV Export Does Not Defend Against Formula Injection

**Attack Vector**: AV-11 (CSV Injection)
**File**: `src/exchange/export.ts:236-248`
**Description**: The CSV export properly escapes commas, newlines, and quotes (RFC 4180 compliance). However, it does NOT defend against CSV formula injection. Values starting with `=`, `+`, `-`, or `@` are passed through without prefixing. If a user opens the exported CSV in Excel/Google Sheets, a claim value like `=CMD("calc.exe")` would be interpreted as a formula.

**Proof**: Breaker test AV-11 "CSV export with formula injection" — the value `=CMD("calc.exe")` appears unescaped in the CSV output.
**Impact**: LOW for Limen itself (it's a CLI/library, not a web app), but HIGH if CSV exports are shared with non-technical users who open them in spreadsheet software.
**Recommendation**: Prefix values starting with `=`, `+`, `-`, `@` with a single quote `'` or tab character. Alternatively, document this as a known limitation in the export API docs.

---

### [MEDIUM] F-006: Export Filter Uses LIKE Without Escaping Wildcards

**Attack Vector**: AV-4 (Export SQL Injection)
**File**: `src/exchange/export.ts:77-83`
**Description**: The export function uses `LIKE ?` with parameterized queries (safe from SQL injection). However, the LIKE clause uses `${options.subject}%` — appending `%` to the user's input. If the user's input already contains `%` or `_` (SQL LIKE wildcards), the filter will match unintended claims.

For example, `subject: 'entity%admin'` would match `entity_test_admin_thing` because `%` is a LIKE wildcard, not a literal character. The user cannot filter for subjects that literally contain `%` or `_`.

**Proof**: Breaker test AV-4 confirms no SQL injection is possible (parameterized). But the LIKE wildcard behavior is unintuitive and undocumented.
**Impact**: Low — this is a filter precision issue, not a security issue. A consumer filtering by subject with `%` or `_` in the pattern gets unexpected results.
**Recommendation**: Either document that subject/predicate filters support LIKE wildcards, or escape `%` and `_` in user input using `ESCAPE` clause.

---

### [MEDIUM] F-007: Builder Test DC-P8-103 Has Weak Assertion for Relationships

**Attack Vector**: AV-18 (Relationship Rebinding with Dedup)
**File**: `tests/unit/phase8_integrations.test.ts:521`
**Description**: The test for DC-P8-103 (relationship rebinding) uses a weak assertion: `assert.ok(importResult.value!.relationshipsImported > 0 || doc.relationships.length === 0, ...)`. The `OR` clause means this test passes even when zero relationships are imported — if the export contained no relationships, the assertion trivially passes. This assertion is dangerously close to HB#8 (assertions that pass regardless of implementation).

The test should REQUIRE that at least one relationship is exported and imported, proving the rebinding actually works.

**Proof**: The assertion at line 521 of phase8_integrations.test.ts always passes if `doc.relationships.length === 0` — which would be the case if the `connect()` call at line 509 silently fails or if `exportData` with `includeRelationships: true` doesn't actually include them.
**Impact**: If relationship export or import were broken, this test could still pass.
**Recommendation**: Change assertion to `assert.ok(doc.relationships.length > 0, 'Export contains relationships')` followed by `assert.ok(importResult.value!.relationshipsImported > 0, 'Relationships were imported')`.

---

### [LOW] F-008: pluginCount Property Counts Only 'installed' State Plugins

**Attack Vector**: AV-8 (Plugin Destroy with Mixed States)
**File**: `src/plugins/plugin_registry.ts:407-409`
**Description**: The `pluginCount` getter filters for `state === 'installed'` only. After shutdown (destroy), the count drops to 0. After a failed install, the failed plugin is not counted. This behavior is correct but undocumented — consumers calling `pluginCount` after shutdown get 0, which could be confusing.

**Proof**: Breaker test AV-8 confirms failed plugins are correctly excluded from destroy. This is a documentation gap, not a code defect.
**Impact**: Minimal — no functional issue.
**Recommendation**: Document in the PluginRegistry interface that `pluginCount` only reflects successfully installed (not failed/destroyed) plugins.

---

## Coverage Gaps

| ID | DC | Gap Description | Severity |
|---|---|---|---|
| CG-001 | DC-P8-403 | No test for MAX_PLUGINS (50) enforcement. Success + rejection required. | CRITICAL |
| CG-002 | DC-P8-501 | Only `claim:asserted` tested. 5 of 6 mapped event types have no test. | HIGH |
| CG-003 | DC-P8-102 | Within-batch dedup is not independently tested. Mutation survives. | HIGH |
| CG-004 | DC-P8-103 | Weak assertion allows trivial pass when no relationships exist. | MEDIUM |
| CG-005 | N/A | No test for `claim:retracted` event delivery (confirmed working by Breaker AV-21). | MEDIUM |
| CG-006 | N/A | No test for `dryRun` import mode (confirmed working by Breaker AV-20). | LOW |
| CG-007 | N/A | No test for export with empty database (confirmed working by Breaker AV-7). | LOW |
| CG-008 | N/A | No test for on()/off() on frozen instance (confirmed working by Breaker AV-16). | LOW |

---

## Mutation Tests Performed

| Mutation | Target | Result | Builder Tests | Breaker Tests |
|---|---|---|---|---|
| Remove within-batch dedup (lines 110-117 of import.ts) | I-P8-22 dedup | Survived | 30/30 PASS (mutation NOT caught) | 34/34 PASS (DB fallback masks mutation) |

**Analysis**: The mutation survived because the database check at line 120 provides a redundant guard. The within-batch dedup is an optimization and a correctness guard for `onConflict='error'` mode. The mutation test reveals that builder tests do not distinguish between within-batch dedup and database dedup.

---

## Verified Defenses (Attacks That Failed)

The following attack vectors were attempted and the implementation correctly defended:

1. **SQL injection via export filters** (AV-4): Parameterized queries prevent injection. All 3 filter parameters (subject, predicate, status) are safe.
2. **Plugin crash isolation** (AV-1): TypeError, prototype pollution, and throwing event handlers all correctly isolated. Engine remains functional.
3. **Plugin API guard during install** (AV-2): All 5 API methods correctly throw PLUGIN_API_NOT_READY during install. Deferred access works post-install.
4. **Import null/malformed documents** (AV-5): Null, missing claims, empty version all correctly rejected.
5. **Prototype pollution via import** (AV-10): `__proto__` keys in claim JSON do not propagate to Object.prototype.
6. **Roundtrip with special characters** (AV-7): Quotes, newlines, HTML tags, and emoji survive export-import roundtrip.
7. **Plugin destroy order with mixed states** (AV-8): Failed plugins correctly skipped during destroy. Throwing destroyers don't block sibling cleanup.
8. **Import dryRun mode** (AV-20): Claims are counted but not actually written to database.
9. **Relationship rebinding with dedup gaps** (AV-18): When a claim is dedup-skipped, its relationships are correctly skipped (not in idMap).
10. **off() idempotency** (AV-16): Double off(), non-existent ID — all handled gracefully.

---

## Oracle Gate Summary

| Gate | Tool | Status | Result |
|---|---|---|---|
| OG-THREAT | oracle_threat_model | COMPLETED | Class A: PASS (15/15 checks). 11 threats identified. No critical unmitigated. |

---

*SolisHQ -- We innovate, invent, then disrupt.*
