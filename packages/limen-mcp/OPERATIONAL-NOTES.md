<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# Limen MCP Operational Notes

## BK-06: Pre-existing Test Artifacts in Shared DB

The shared Limen database may contain test artifacts from Breaker runs, including
agent registrations with adversarial names (e.g., "evil-agent"). These are benign
test residue and do not represent a security vulnerability.

**Impact:** None. The agent registry is an informational directory. Trust levels
are enforced by the governance layer, not by agent name existence.

**Mitigation:** Periodic `limen_consolidate` runs will archive stale, low-confidence
claims. For operational deployments, use a fresh database.

## BK-10: Stale Data in Shared DB

The shared development/test database accumulates stale claims from prior sessions.
This is expected behavior for a knowledge store with temporal decay.

**Impact:** `limen_health_cognitive` reports stale domains. The `effectiveConfidence`
field in `limen_recall` results already reflects time-decay, so stale data
naturally deprioritizes over time.

**Mitigation:** Use `limen_consolidate` to archive stale low-confidence claims.
For production, configure retention policies via `limen_maintenance_retention`.

## BK-11: Conflicts in Shared DB

Conflicting claims exist in the shared database from concurrent test sessions
asserting contradictory values on the same subject/predicate.

**Impact:** `limen_health_cognitive` surfaces these as conflicts. The cognitive
engine's conflict resolution mechanisms handle this at query time.

**Mitigation:** Use `limen_consolidate` with `dryRun: false` to resolve conflicts.
For production, conflicts are expected and healthy — they represent evolving knowledge.
