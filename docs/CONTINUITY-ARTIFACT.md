<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# Continuity Artifact — Limen v5

## 1. Summary

Limen v5 is a governed cognitive infrastructure platform for AI agents, providing belief management with FSRS decay, agent lifecycle with 5-level trust promotion, output governance with confidence capping and plugin isolation, multi-agent coordination with fork/merge and HLC sync, audit visualization with chain integrity verification, and consent enforcement. It exposes 44 MCP tools over stdio transport. 14 ratified contracts define 3,747 requirements. The system is fully implemented, Phase 6 Breaker-verified (5 rounds, 20 findings closed), Certifier GO, Witness 89/100. Ratified by Femi 2026-05-10.

## 2. Restart Instructions

1. `cd ~/Projects/limen/.claude/worktrees/p0-remediation` (or checkout `release/v5`)
2. Read `FORGE-GATE.md` — current phase, checklist, artifact tracker
3. Run `npm test` — verify 4678+ pass, 0 fail
4. Run `bash scripts/verify-contract-hashes.sh` — verify 35 OK
5. Run `bash scripts/solisforge-traceability-scanner.sh --ci` — verify COMPLIANT
6. Start system: `cat init.json | npx tsx packages/limen-mcp/src/server.ts`
7. Phase 10 (Self-Audit) is next

## 3. Locked Artifacts

- `contracts/*.md` — 14 ratified contracts (amend via SolisForge §8.1 only)
- `contracts/phase-x.contracts.json` — machine-readable manifest with SHA-256 hashes
- `MASTER-INDEX-v2.1-FINAL.md` — canonical index with hash verification
- `contracts/LIMEN_V5_INTEGRATION_CONTRACT.md` — SolisForge v1.4 convergence contract
- `FORGE-GATE.md` — phase gate (update last, read first)
- `docs/LIMEN-INTENT-AND-PROPERTIES.md` — 59 invariants
- `docs/LIMEN-FAILURE-MODE-ATLAS.md` — 107 failure modes
- `docs/LIMEN-ARCHITECTURE-DECISION.md` — 14 ADRs

## 4. Forbidden Actions

- Do NOT modify contracts without the SolisForge §8.1 amendment process
- Do NOT dispatch Breaker outside Phase 3 or Phase 6
- Do NOT dispatch Certifier/Witness outside Phase 7/8
- Do NOT claim CI enforcement that does not exist (SolisForge §11)
- Do NOT use `assert.ok(true)` or any structurally unfailable assertion (P0)
- Do NOT let Builder write its own tests (PA Order 2026-05-10)
- Do NOT edit certified tests without PA approval + scoped re-pipeline
- Do NOT advance phases with missing prior-phase artifacts
- Do NOT hardcode counts derivable from content

## 5. Open Items

- **Phase 10: Self-Audit** — What worked, what failed, what to improve in SolisForge
- **Traceability Matrix** — Required for Forge Critical per §11. Produce before merge to main.
- **Merge to main** — release/v5 → main when v5 is release-ready and fully certified
- **npm publish** — Limen MCP server package publication (requires OTP)
- **v5/crates Rust substrate** — TypeScript-primary per AD-5; Rust projection is documentation-level

## 6. Known Limitations

- **No LLM providers configured** — health reports "degraded" without provider setup (by design)
- **MCP stdio only** — no HTTP/SSE transport (scope boundary per Intent Record)
- **Single-node SQLite** — no distributed deployment (scope boundary)
- **PDF/SVG export** — returns graceful error (format support is environment-dependent)
- **Performance tests** — 2 latency tests are machine-dependent (may flake under load)
