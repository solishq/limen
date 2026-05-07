# Phase X Integration Plan

**Status:** Canonical integration handoff
**Governing:** CDM v2.1 + Contract Compliance v2.1
**Development branch:** `release/v5` (all v5 work; `main` is stable v4 baseline)
**Canonical merge:** `ee4b0df` (Phase X contracts merged to main)  

## Executive Summary

Integrate Phase X as a canonical, indexed CDM v2.1 contract family, not as loose documentation. The merge must preserve HB-37 monotonicity, update the Master Index and Contract Compliance doctrine in the same PR, and leave a traceable handoff path for future engineers.

## Merge Strategy

1. Preflight:
   - Confirm clean worktree: `git status --short`
   - Fetch source: `git fetch origin release/v5 main`
   - Verify source commit: `git rev-parse release/v5` equals or contains `5fdbf68`
   - Verify Breaker/CLEAN evidence is present in the branch notes, PR, or certification artifact.

2. Create integration branch from current main:
   - `git switch main`
   - `git pull --ff-only origin main`
   - `git switch -c release/v5`

3. Merge without squashing:
   - `git merge --no-ff release/v5`
   - Rationale: preserve contract authorship, review lineage, and audit trail.

4. Conflict policy:
   - For Phase X contract files, prefer the `release/v5` version unless main has newer CDM-wide doctrine that must be reconciled.
   - Never hand-merge by informal preference. Any conflict touching contract semantics must be resolved by explicit LCI reasoning in the PR.

5. Post-merge verification:
   - Recompute hashes for all adopted Phase X files.
   - Verify `contracts/phase-x.contracts.json` matches actual file hashes.
   - Confirm `defenseSetAfter` is a superset of `defenseSetBefore`.
   - Confirm no existing v2.1 contract references are removed or weakened.
   - Run docs/link checks if available.

## Documentation Updates

Update `MASTER-INDEX-v2.1-FINAL.md`:

- Add a canonical family entry: `Phase X -- AI Agent Integration Layer`.
- Register:
  - `contracts/SHARED_TYPES.md`
  - `contracts/AGENT_MEMORY_BRIDGE.md`
  - `contracts/COMPUTER_USE_GOVERNANCE.md`
  - `contracts/AUDIT_VISUALIZATION_SCHEMA.md`
  - `contracts/AGENT_ADAPTER_ARCHITECTURE.md`
  - `contracts/AGENT_INTELLIGENCE_BRIDGE.md`
  - `contracts/AGENT_EXECUTION_GOVERNANCE.md`
  - `contracts/AGENT_CONTEXT_GOVERNANCE.md`
  - `contracts/AGENT_LIFECYCLE_MANAGEMENT.md`
  - `docs/PHASE_X_ARCHITECTURE_OVERVIEW.md`
  - `contracts/phase-x.contracts.json`
- For each entry include role, version, canonical owner, hash, and dependency direction.
- Add `phase-x.contracts.json` as the machine-readable Phase X compliance authority.
- Add LCI note: `tau_PhaseX = CanonicalTypes ∩ GovernanceGate ∩ ConsentGate ∩ AuditPath ∩ EventBus ∩ RateLimit ∩ TokenEstimator ∩ LifecycleState ∩ CorePermissionMapping ∩ SearchGate ∩ CoordinationGate ∩ OutputGate`.

Update `CONTRACT-COMPLIANCE-v2.1.md`:

- Add Phase X as the canonical example for:
  - Contract-first phase integration
  - HB-37 defense-set monotonicity
  - HB-38 interface/hash binding
  - LCI closure proof
  - Shared-type ownership discipline
- Add rule: any future phase-level contract family must include:
  - versioned contract list
  - sha256 hashes
  - `defenseSetBefore`
  - `defenseSetAfter`
  - monotonicity proof
  - LCI assertion and closure proof
  - independent Breaker/CLEAN evidence
- Add prohibition: no downstream implementation may reference a Phase X interface unless the Master Index points to the same canonical version.

Continuity updates:

- Update `docs/PHASE_X_ARCHITECTURE_OVERVIEW.md` only if its references change after merge.
- Keep this file, `docs/continuity/PHASE_X_INTEGRATION_PLAN.md`, as the Phase X handoff artifact.
- Register this handoff file in the Master Index if the integration branch creates or updates index governance for continuity artifacts.

## Integration Checklist

1. Confirm `release/v5` branch contains all Phase X contracts and v5 Rust substrate.
2. Verify Phase X contracts on `main` match indexed versions in Master Index.
3. Resolve any conflicts with LCI notes, not informal preference.
4. Recompute hashes and verify `phase-x.contracts.json`.
5. Update `MASTER-INDEX-v2.1-FINAL.md`.
6. Update `CONTRACT-COMPLIANCE-v2.1.md`.
7. Add or confirm Phase X continuity handoff.
8. Run link/docs validation.
9. Run contract hash verification.
10. Run final verification on `release/v5` branch.
11. Require approval from doctrine owner / governance reviewer before merge to `main`.

## Commit and PR Guidance

Recommended commit message:

```text
merge: adopt Phase X canonical contracts under CDM v2.1
```

Recommended PR title:

```text
Adopt Phase X contract family into internal-OS CDM v2.1 index
```

Recommended PR description:

```markdown
## Summary
Integrates the CLEAN Phase X remediation branch into main and registers Phase X as a canonical CDM v2.1 contract family.

## Traceability
- Source branch: release/v5
- Clean commit: 5fdbf68
- Compliance authority: contracts/phase-x.contracts.json
- Doctrine updates:
  - MASTER-INDEX-v2.1-FINAL.md
  - CONTRACT-COMPLIANCE-v2.1.md

## LCI
Phase X is adopted as a closed contract family:
CanonicalTypes ∩ GovernanceGate ∩ ConsentGate ∩ AuditPath ∩ EventBus ∩ RateLimit ∩ TokenEstimator ∩ LifecycleState.

## HB-37 / HB-38
- No existing v2.1 defense removed.
- Phase X defenses are additive.
- Contract hashes are registered and verified.

## Verification
- Hash manifest verified.
- Master Index references updated.
- Contract Compliance examples updated.
- Continuity handoff added.
- Final Breaker review required before merge.
```

## Risks and Mitigations

- Risk: main has older doctrine than Phase X expects.
  - Mitigation: merge only after Master Index and Compliance doctrine are updated in the same PR.

- Risk: Phase X becomes orphaned documentation.
  - Mitigation: register every Phase X file in the Master Index and `phase-x.contracts.json`.

- Risk: future engineers implement from stale files.
  - Mitigation: make Master Index the canonical entrypoint and require hash verification before implementation.

- Risk: hidden regression to v2.1 contracts.
  - Mitigation: require HB-37 proof and final Breaker review on the merged branch, not only on `release/v5`.
