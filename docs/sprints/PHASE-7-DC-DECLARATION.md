# Phase 7: MCP Enhancement — Defect-Class Declaration

**Date**: 2026-03-30
**Tier**: 2 (Core product logic — MCP tooling)
**Governing spec**: LIMEN_BUILD_PHASES.md Phase 7

---

## Defect Classes

| ID | Description | Category | Control Mode | Mechanism | Trace | [A21] |
|---|---|---|---|---|---|---|
| DC-P7-001 | MCP tool delegates to wrong convenience method or bypasses convenience API entirely | 1: Data integrity | CBM | Code review + integration test verifying delegation chain | §7.1-7.4 | Success: tool returns convenience API output. Rejection: N/A (structural) |
| DC-P7-002 | limen_context returns stale/empty context when claims exist | 1: Data integrity | CBM | Integration test: remember claims then verify context includes them | §7.1 | Success: context contains recalled beliefs. Rejection: empty query returns empty context. |
| DC-P7-003 | limen_recall_bulk returns partial results without indicating failure | 2: State consistency | CBM | Integration test: bulk recall with valid and invalid subjects | §7.3 | Success: all subjects return results. Rejection: invalid subjects return empty arrays (not errors). |
| DC-P7-004 | limen_search returns results not matching query | 1: Data integrity | CBM | Integration test: search with known content, verify relevance | §7.4 | Success: search returns matching claims. Rejection: non-matching query returns empty. |
| DC-P7-005 | Decay visibility fields missing from recall results | 1: Data integrity | CBM | Integration test: recall returns effectiveConfidence and freshness | §7.5 | Success: fields present with correct types. Rejection: N/A (structural). |
| DC-P7-006 | limen_health_cognitive fails on empty knowledge base | 9: Availability | CBM | Integration test: health on fresh engine returns zero values | §7.2 | Success: returns all-zero report. Rejection: N/A. |
| DC-P7-007 | Zod schema validation allows invalid input through | 4: Authority/governance | CBM | Integration test: invalid inputs rejected with error | §7.1-7.4 | Success: valid input accepted. Rejection: invalid input returns error. |

### Categories Not Applicable

| # | Category | Reason |
|---|---|---|
| 3 | Concurrency | MCP tools are stateless request handlers; no concurrent state mutation |
| 5 | Causality/observability | MCP tools delegate to audited convenience API; no new trace points needed |
| 6 | Migration/evolution | No schema changes in Phase 7 |
| 7 | Credential/secret | No secrets handled by these tools |
| 8 | Behavioral/model quality | Tools are deterministic translators, no ML/LLM behavior |
