<!-- R2-45: This file is Contract Compliance v2.1, which references and is governed by
     MASTER-INDEX v2.1 (MASTER-INDEX-v2.1-FINAL.md). The filename v2.1 matches the
     referenced version. The parent project's governance may have CDM v2.2, but this
     worktree operates under v2.1 as the latest ratified version for Limen. -->

# Contract Compliance v2.1

**Status:** Active doctrine
**Governing:** CDM v2.1
**Scope:** Contract-first discipline, monotonicity enforcement, LCI closure, and canonical contract adoption rules.

## 1. Contract-First Discipline

Every governed implementation MUST be preceded by a ratified contract or by an explicit contract amendment. Implementation may not create a parallel standard, broaden authority, redefine shared types, or silently bypass governance obligations.

Phase-level contract families MUST be integrated as indexed canonical families, not as loose documentation.

## 2. Canonical Example: Phase X Contract-First Integration

Phase X -- AI Agent Integration Layer is the canonical example for contract-first phase integration under CDM v2.1.

| Discipline | Phase X Evidence | Compliance Requirement |
|------------|------------------|------------------------|
| Contract-first integration | Phase X contract family registered in `MASTER-INDEX-v2.1-FINAL.md` | Implementations must consume the indexed contract version before code changes. |
| HB-37 defense-set monotonicity | `contracts/phase-x.contracts.json` records `defenseSetBefore`, `defenseSetAfter`, and monotonicity proof | A phase merge must prove `defenseSetAfter ⊇ defenseSetBefore`; removed or weakened defenses block adoption. |
| HB-38 interface/hash binding | `contracts/phase-x.contracts.json` records versioned files and sha256 hashes | Interface changes require owning contract updates, manifest hash updates, and Master Index alignment before implementation. |
| LCI closure proof | Phase X defines `tau_PhaseX` and closure assertions | Contract families must close authority, type, event, audit, token, projection, and lifecycle boundaries before adoption. |
| Shared-type discipline | `contracts/SHARED_TYPES.md` is the sole cross-contract type registry | Contracts may reference shared types but may not redefine them locally or create conflicting aliases. |

## 3. Rule: Phase-Level Contract Family Adoption

Any future phase-level contract family MUST include all of the following before it can be adopted as canonical:

1. Versioned contract list.
2. sha256 hashes for every public contract and required architecture document.
3. `defenseSetBefore`.
4. `defenseSetAfter`.
5. Monotonicity proof showing `defenseSetAfter ⊇ defenseSetBefore`.
6. LCI assertion and closure proof.
7. Breaker/CLEAN evidence from an independent review.
8. Master Index registration with role, version, canonical owner, hash, dependency direction, and LCI note.
9. Continuity handoff covering source branch, clean commit, adopted contracts, implementation order, known non-goals, and certification evidence.

## 4. Prohibitions

- No downstream implementation may reference a Phase X interface unless `MASTER-INDEX-v2.1-FINAL.md` points to the same canonical version and hash.
- No contract may weaken an existing v2.1 governance gate, audit obligation, consent boundary, rate limit, token budget rule, or lifecycle state requirement.
- No phase may create a parallel shared-type registry when a shared type already exists in `contracts/SHARED_TYPES.md`.
- No contract family may be merged with orphaned contract files, orphaned continuity artifacts, or unverified manifest hashes.
- No implementation may treat documentation-only adoption as equivalent to canonical index adoption.

## 5. Verification Gate

Before merge or implementation, the reviewing authority MUST verify:

1. The Master Index references every adopted phase file.
2. The manifest hashes match the workspace contents.
3. `defenseSetAfter` is a superset of `defenseSetBefore`.
4. LCI closure is stated and still valid after conflict resolution.
5. Breaker/CLEAN evidence is present.
6. Continuity handoff exists and identifies implementation order and non-goals.
7. Existing v2.1 contracts and enforcement mechanisms are not removed or weakened.
