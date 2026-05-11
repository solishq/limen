<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

<!-- Finding-64 (P3): This file was created during R1 remediation.
     Prior to R1, the worktree had no CLAUDE.md, violating the bootstrap convention. -->

# Limen v5 -- Claude Code Project Config

## Governance Tier
Forge Critical (SolisForge v1.4 §3)

## Build & Test
```
npm test                    # All node:test tests
npx tsc --noEmit           # Type checking
npx stryker run            # Mutation testing
```

## Frozen Zones
- `contracts/` -- Ratified contracts, amend only via contract amendment process
- `src/kernel/crypto/` -- Cryptographic core, security review required for changes

## Contract Integrity
Run `bash scripts/verify-contract-hashes.sh` to verify manifest SHA-256 hashes (R2-11).

## Project Scope
Limen is the governed cognitive infrastructure for AI agents.
Phases 1-4: Foundation, CrewAI Adapter, Enterprise Compliance, Additional Adapters.
