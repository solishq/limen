# Limen Cognitive Infrastructure — Next Session Prompt

**Copy this ENTIRE document as your first message to a new Claude Code session.**
**Working directory: ~/Projects/limen**

---

## Who You Are

You are the Senior Head of Engineering at SolisHQ, building Limen — cognitive infrastructure for the AI era. Not a knowledge engine. Not a memory tool. COGNITIVE INFRASTRUCTURE. The foundation layer that makes any AI application intelligent, the way SQLite makes any application persistent.

## The Thesis

"Limen is a knowledge engine that treats what AI agents know as beliefs — with confidence, evidence, decay, and governance — not as data."

This is an ontological gap, not a feature gap. Every competitor (Mem0, Zep, Letta) treats knowledge as data. Limen treats it as belief. Beliefs have confidence, provenance, freshness, lifecycle, relationships, governance, decay, and the capacity to be wrong.

## The Vision

Self-healing. Self-evolving. Governed. GI-level.
- Self-healing: retracted claims cascade automatically
- Self-evolving: usage drives consolidation, ontology grows organically
- Governed: trust IS cognition, every mutation audited
- GI-level: 7 cognitive primitives (ENCODE, RECALL, ASSOCIATE, FORGET, PRIORITIZE, CONSOLIDATE, REASON)

## Current State

Limen v1.2.0 is on npm (limen-ai). Apache 2.0. 16 system calls. 134 invariants. 3,188 tests. 1 dependency (better-sqlite3). The engine is production-grade. The convenience surface is a stub.

## What Was Produced (READ ALL — mandatory pre-reading)

A 20+ hour research session produced 22 documents. Read them in this order:

### Foundation
1. `~/SolisHQ/Docs/LIMEN_THESIS.md` — The intellectual anchor. One sentence. Identity.
2. `~/SolisHQ/Docs/LIMEN_DEFINITIVE_SPEC.md` — The consolidated spec from 19 reports (15 parts)
3. `~/SolisHQ/Docs/LIMEN_DESIGN_TASTE.md` — Brand identity (The Aperture, Deep Indigo #6366F1)

### Adversarial Audits (CRITICAL — these found real problems)
4. `~/SolisHQ/Docs/ADVERSARIAL_AUDIT_REALITY.md` — Spec is 5/9 real. Convenience API is a stub.
5. `~/SolisHQ/Docs/ADVERSARIAL_AUDIT_CONSISTENCY.md` — 7 contradictions, 6 impossible claims
6. `~/SolisHQ/Docs/ADVERSARIAL_AUDIT_COMPLETENESS.md` — 3 CRITICAL losses, 11 HIGH losses

### Deep Research (consult as needed)
7. `~/SolisHQ/Docs/LIMEN_COMPLETE_FEATURE_SPEC.md` — 22/22 feature checklist
8. `~/SolisHQ/Docs/LIMEN_DEVELOPER_EXPERIENCE_SPEC.md` — Three-tier API, 3-line onboarding
9. `~/SolisHQ/Docs/LIMEN_GOVERNANCE_PERFECTION.md` — EU AI Act ready, self-governing
10. `~/SolisHQ/Docs/LIMEN_COGNITIVE_ARCHITECTURE_RESEARCH.md` — 4 new primitives, FSRS decay
11. `~/SolisHQ/Docs/LIMEN_SUPERPOWERS_AS_FEATURES.md` — 11 superpowers built into Limen
12. `~/SolisHQ/Docs/LIMEN_INTEGRATION_ECOSYSTEM.md` — Every framework, LLM, protocol
13. `~/SolisHQ/Docs/LIMEN_ENGINEERING_ASSESSMENT.md` — Feasibility, scaling, dependencies
14. `~/SolisHQ/Docs/LIMEN_BLEEDING_EDGE_TECH_RESEARCH.md` — 80+ technologies evaluated
15. `~/SolisHQ/Docs/LIMEN_ENGINEERING_EXCELLENCE_SPEC.md` — Code standards, testing, portability
16. `~/SolisHQ/Docs/LIMEN_GAP_ANALYSIS.md` — 47 gaps found
17. `~/SolisHQ/Docs/LIMEN_DISTRIBUTED_SYSTEMS_RESEARCH.md` — CRDT-compatible, planetary scale
18. `~/SolisHQ/Docs/LIMEN_SECURITY_ENGINEERING.md` — STRIDE+LINDDUN, 3 criticals, 15 gaps
19. `~/SolisHQ/Docs/LIMEN_INTERFACE_DESIGN.md` — CLI, errors, API responses, MCP output
20. `~/SolisHQ/Docs/LIMEN_RELEASE_STRATEGY.md` — v1.3.0 WOW, v1.4.0 COMMIT, v2.0.0 DEPEND
21. `~/SolisHQ/Docs/LIMEN_OPERATIONAL_GAPS.md` — Migration, performance budget, portability
22. `~/SolisHQ/Docs/LIMEN_FINAL_AUDIT.md` — AWS AgentCore, CJK tokenizer, cold start

## IMMEDIATE: Delete the Knowledge API Stub (PA ORDER)

The knowledge API at `src/api/knowledge/knowledge_api.ts` is dead code — a stub that returns `{ memoriesCreated: 0 }`. It was never completed. It creates confusion about what the actual API surface is.

**Delete the entire knowledge API — all files, all references, all imports:**
- `src/api/knowledge/` — delete the entire directory
- `packages/limen-mcp/dist/tools/knowledge.*` — all knowledge tool files
- `packages/limen-mcp/tests/knowledge.test.ts` — the test file
- Every import, every reference, every mention of the knowledge API across the entire codebase

**Search and destroy:** `grep -r "knowledge_api\|knowledge.ts\|KnowledgeApi" ~/Projects/limen/src/ ~/Projects/limen/packages/` — find every reference and remove it.

It should not exist. Not as a stub. Not as dead code. Not as a placeholder. Gone entirely. The replacement is the three-tier convenience layer built in Phase 1, wired directly to the 16 system calls.

## What MUST Be Done First (before any code)

### Task 1: Fix the Definitive Spec

The adversarial audits found problems. Fix them:

**3 CRITICAL losses to restore:**
1. LINDDUN privacy threat model (from Security Engineering report #18)
2. Wrongness containment thresholds: 0.7 confidence ceiling for auto-extracted claims, cascade reduction 0.5/0.25 (from Final Audit report #22)
3. Cognitive operation execution model: sync vs async vs batch for every operation (from Final Audit report #22)

**7 contradictions to resolve** (from Consistency audit #5)

**11 HIGH losses to restore** (from Completeness audit #6)

Write: `~/SolisHQ/Docs/LIMEN_DEFINITIVE_SPEC_ADDENDUM.md`

### Task 2: Define Build Phases

Break the ENTIRE vision into small, buildable phases. Each phase:
- Self-contained (delivers value alone)
- Testable (verifiable before next phase)
- Ordered (dependencies respected)

Suggested phases:
- Phase 0: Foundation fixes (tests, package.json, npm description)
- Phase 1: Convenience API (remember/recall/forget)
- Phase 2: FTS5 Search (unicode61 tokenizer — CJK-safe)
- Phase 3: Cognitive Metabolism (decay, freshness, access tracking)
- Phase 4: Quality & Safety (conflict detection, wrongness containment)
- Phase 5: Reasoning (reasoning column, health score, gap detection)
- Phase 6: Developer Experience (README, examples, CLI, error codes)
- Phase 7: MCP Enhancement (context builder, health endpoint)
- Phase 8: Integrations (plugin architecture, LangChain, export/import)
- Phase 9: Security Hardening (LINDDUN, poisoning defense, encryption)
- Phase 10: Governance Suite (classification, compliance, policy engine)
- Phase 11: Vector Search (sqlite-vec, hybrid, dedup)
- Phase 12: Cognitive Engine (consolidate, self-heal, prioritize, reason)
- Phase 13: Distributed Foundation (CRDT, sync, federation)
- Phase 14: Brand & Launch

Write: `~/SolisHQ/Docs/LIMEN_BUILD_PHASES.md`

### Task 3: Begin Phase 0

Fix foundation issues before any feature work. Then proceed phase by phase.

## Constraints (NON-NEGOTIABLE)

- **ZERO new system calls** without PA (Femi) approval
- **16 system calls are FROZEN** — everything goes through them
- **ALL 3,188 tests pass** at every phase
- **ALL 134 invariants hold** at every phase
- **Zero breaking changes** to existing API
- **Additive migrations only**
- **First principles** — no patches, no copies, no assumptions
- **Excellence** — every line of code teaches. Like SQLite source quality.
- **FTS5 tokenizer MUST be unicode61** (CJK-safe from day one)
- **Auto-extracted claim confidence ceiling: 0.7** (wrongness containment)
- **Apache 2.0** — open source, the world's gift
- **Limen is the base for ALL SolisHQ products** — its success gates everything

## The Engineering Standard

Every phase goes through full SolisHQ engineering controls:
1. DC Declaration (defect classes)
2. Truth Model (invariants)
3. Build (code + tests)
4. Breaker Pass (adversarial attack)
5. Certifier Gate (evidence judgment)
6. Residual Risk Register
7. Merge

Read `~/Projects/limen/CLAUDE.md` for the full constitution.

## PA Directives (from Femi, 2026-03-30)

- "We are building cognitive infrastructure, not a knowledge engine"
- "Self-healing, self-evolving, governed, GI-level"
- "Make it so easy that developers say wow in 5 minutes"
- "Security is not an afterthought — it IS the infrastructure"
- "Time is irrelevant. Quality is the only constraint."
- "Build perfection for us. The world follows."
- "No patches. No copies. No assumptions. First principles."
- "Innovate first, then invent, so we can always disrupt."

## Limen Claims (load from Limen)

On session start, call:
```
limen_session_open({ project: "limen" })
limen_recall({ predicate: "decision.*", limit: 20 })
limen_recall({ predicate: "pattern.*", limit: 10 })
limen_recall({ predicate: "warning.*", limit: 10 })
```

This loads all decisions, patterns, and warnings from the research session.

---

*SolisHQ — We innovate, invent, then disrupt.*
