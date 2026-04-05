# Limen Session Handoff — 2026-04-02

## TL;DR

Phase 8 (Integrations) is built on branch `phase-8-integrations` but needs Breaker → Fix → Certifier → Merge. That's it. Then v1.4.0 is complete.

## Exact Steps

```bash
cd ~/Projects/limen
git checkout phase-8-integrations    # Already there
```

### 1. Run Phase 8 Breaker Pass

Dispatch Breaker against these artifacts on branch `phase-8-integrations`:

**Files to attack:**
- `src/plugins/plugin_types.ts` (218 lines) — Plugin interface
- `src/plugins/plugin_registry.ts` (415 lines) — Plugin lifecycle + event hooks
- `src/exchange/export.ts` (256 lines) — JSON/CSV export
- `src/exchange/import.ts` (241 lines) — JSON import with dedup + ID remapping
- `packages/limen-langchain/src/memory.ts` (134 lines) — LangChain adapter
- `src/api/index.ts` — Modified: plugin wiring, export/import, event hooks
- `src/api/interfaces/api.ts` — Modified: on/off/exportData/importData
- `tests/unit/phase8_integrations.test.ts` (648 lines, 30 tests)
- `docs/sprints/PHASE-8-{DC-DECLARATION,TRUTH-MODEL}.md`

**Attack vectors:**
1. Plugin isolation (crash engine? bypass freeze?)
2. Event handler error isolation (one throws → kills dispatch?)
3. Export SQL injection via filter parameters
4. Import validation (malformed JSON, missing fields)
5. Import dedup correctness (remove dedup → tests catch it?)
6. Export → Import roundtrip fidelity (lossless for JSON?)
7. Plugin destroy on shutdown
8. LangChain adapter (real or just types?)

Write to: `docs/sprints/PHASE-8-BREAKER-REPORT.md`

### 2. Fix Cycle

Pattern from every prior phase: Builder implements guards, tests don't exercise them. Expect 3-6 HIGH findings. Fix by writing discriminative tests that kill mutations.

### 3. Certifier Gate

Write to: `docs/sprints/PHASE-8-CERTIFIER-REPORT.md`

### 4. Merge to Main

```bash
git checkout main
git merge phase-8-integrations --no-ff -m "[CLASS-2][FEAT] Phase 8: Integrations — plugins, events, export/import, LangChain adapter"
```

### 5. Fix Premature v1.4.0 Tag

```bash
git tag -d v1.4.0
git push origin :refs/tags/v1.4.0
git tag -a v1.4.0 -m "v1.4.0: Quality, Safety, Reasoning & Integrations"
git push origin main --tags
```

### 6. npm Publish

Femi runs: `cd ~/Projects/limen && npm publish --access public`

---

## What Was Built This Session

| Phase | What | Engineering Controls | Status |
|-------|------|---------------------|--------|
| 0 | Foundation + KB API deletion | Tier 3 | MERGED |
| 1 | Convenience API (remember/recall/forget/connect/reflect) | Full 7 | MERGED |
| 2 | FTS5 Search (unicode61 + trigram CJK) | Full 7 | MERGED |
| 3 | Cognitive Metabolism (FSRS decay, freshness, access tracking) | Full 7 | MERGED |
| 4 | Quality & Safety (conflict, cascade, RBAC, .raw gating) | Full 7 | MERGED |
| 5 | Reasoning (reasoning column, cognitive.health(), gaps) | Full 7 | MERGED |
| 6 | Developer Experience (README, examples, error docs) | Tier 3 | MERGED |
| 7 | MCP Enhancement (5 tools: context, health, search, bulk, decay) | Full 7 | MERGED |
| 8 | Integrations (plugins, events, export/import, LangChain) | **1-3 only** | **BRANCH** |

## Releases

- **v1.3.0**: npm + GitHub (Phases 0-3)
- **v1.4.0**: GitHub tag exists (premature). npm shows v1.3.0. Needs re-tag after Phase 8 merge.

## Known Issues

- 1 pre-existing test failure: `test_gap_018_data_integrity.test.ts` — hardcoded v1.2.0 version check
- Oracle Gates DEGRADED across all phases (Intelligence MCP unavailable)
- Stale worktrees: run `git worktree prune` to clean

## After v1.4.0

Next: v1.5.0 (Phases 9-10: Security Hardening + Governance Suite)
