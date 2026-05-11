<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# OPS.md — Limen v5 Operations Manual

**Project:** Limen v5 — Cognitive Infrastructure for AI Agents
**Branch:** release/v5
**Package:** `limen-ai` (npm)
**Dependencies:** 1 (`better-sqlite3`)
**Node.js:** ≥ 22.0.0 (ESM-only)
**Governance:** SolisForge Protocol v1.4 (Forge Critical)

---

## Quick Start

```bash
# Install
npm install limen-ai

# Use
import { createLimen } from 'limen-ai';
const limen = await createLimen();
limen.remember('entity:user:alice', 'preference.food', 'loves Thai food');
const beliefs = limen.recall('entity:user:alice');
await limen.shutdown();
```

---

## Build & Test

```bash
# From release/v5 worktree
cd ~/Projects/limen/.claude/worktrees/p0-remediation

# Build
npm run build                          # TypeScript → dist/

# Test (4686+ tests)
npm test                               # node:test runner

# Type check
npx tsc -p tsconfig.build.json --noEmit

# Release pipeline (validate → build → test → pack → verify)
bash scripts/release-pipeline.sh

# Artifact
dist/limen-ai-4.0.0.tgz               # Installable via npm install /path/to/file.tgz
```

---

## Governance Tools

```bash
# 4-Layer SolisForge Validator (v3.0.0)
bash scripts/solisforge-validator.sh              # Full 4-layer check
bash scripts/solisforge-validator.sh --verbose    # With per-check detail
bash scripts/solisforge-validator.sh --ci         # Exit 1 on P0/P1

# Contract Hash Verification (15 manifest + 20 Master Index = 35 checks)
bash scripts/verify-contract-hashes.sh

# Traceability Scanner (governance headers)
bash scripts/solisforge-traceability-scanner.sh --ci

# Divergence Detector (governance state)
bash scripts/solisforge-divergence-detector.sh

# Release Pipeline (5 stages)
bash scripts/release-pipeline.sh
```

---

## Architecture

```
limen-ai (npm package)
├── src/api/index.ts          — createLimen() factory (composition root)
├── src/api/convenience/      — remember, recall, search, forget, connect, reflect
├── src/api/interfaces/       — Limen interface (321 methods across 20 namespaces)
├── src/kernel/               — SQLite, audit trail, RBAC, crypto, events, rate limiter
├── src/claims/               — CCP (Claim Certainty Pipeline)
├── src/cognitive/            — Health, consolidation, importance, narrative, freshness
├── src/lifecycle/            — Agent registration, trust, capabilities, consent, knowledge
├── src/output/               — Output governance, inference, plugins, hooks
├── src/coordination/         — A2A rules, session fork, HLC sync, replay verification
├── src/audit/visualization/  — Timeline, belief graph, heatmap, chain integrity, export
├── src/security/             — PII detection, injection defense, poisoning defense, consent gate
├── src/search/               — FTS5, vector search, duplicate detection
├── src/orchestration/        — Missions, tasks, artifacts, checkpoints, budget
├── packages/limen-mcp/       — MCP server (46 tools over stdio)
├── packages/limen-cli/       — Command-line interface
└── src/adapters/             — CrewAI, AutoGen, LlamaIndex, SemanticKernel
```

---

## API Surface (100 public methods)

| Namespace | Methods | Purpose |
|-----------|---------|---------|
| root | 21 | remember, recall, search, forget, connect, reflect, health, shutdown |
| claims | 7 | assertClaim, queryClaims, retractClaim, relateClaims, searchClaims |
| workingMemory | 3 | write, read, discard |
| cognitive | 12 | health, consolidate, importance, narrative, verify, suggestConnections |
| lifecycle | 22 | registerAgent, promoteAgent, suspendAgent, decommissionAgent, exportKnowledge |
| outputGovernance | 17 | produce, infer, installPlugin, registerHook, recordCost, recordVital |
| coordination | 20 | registerA2ARule, forkSession, mergeFork, triggerSync, captureSnapshot |
| auditVisualization | 6 | queryEntries, getTimeline, getBeliefGraph, getGovernanceHeatmap, export |
| governance | 7 | erasure, exportAudit, addRule, protectPredicate |
| consent | 4 | register, check, revoke, list |
| security | 1 | rotateKey |
| maintenance | 3 | runRetention, getRetentionPolicies, updateRetentionPolicy |
| replay | 2 | verify, getSnapshots |

---

## MCP Server (46 tools)

```bash
# Start MCP server (stdio transport)
npx tsx packages/limen-mcp/src/server.ts

# Claude Code config (~/.claude/settings.json or project .mcp.json):
{
  "mcpServers": {
    "limen": {
      "command": "npx",
      "args": ["tsx", "packages/limen-mcp/src/server.ts"],
      "env": { "LIMEN_DATA_DIR": "/path/to/data" }
    }
  }
}
```

---

## Database

- **Engine:** SQLite via `better-sqlite3` (synchronous)
- **Mode:** WAL (concurrent reads during writes)
- **Migrations:** 51 forward-only migrations (idempotent)
- **Location:** Auto-resolved to OS temp dir (default) or `LIMEN_DATA_DIR`
- **Encryption:** AES-256-GCM vault for sensitive data
- **Audit:** Append-only hash chain (SHA-256 linked)

---

## Security Configuration

```typescript
const limen = await createLimen({
  security: {
    pii: { enabled: true, action: 'tag', categories: ['email', 'phone', 'ssn', 'credit_card', 'ip_address'] },
    injection: { enabled: true, action: 'warn' },
    poisoning: { enabled: true, burstLimit: 100, windowSeconds: 60, subjectDiversityMin: 3 },
    consent: { required: true, scope: 'claim_assertion' },
  },
});
```

| Mechanism | Default | Description |
|-----------|---------|-------------|
| PII Detection | tag | Detects emails, phones, SSNs, credit cards, IPs |
| Injection Defense | warn | Neutralizes prompt injection + SQL injection |
| Poisoning Defense | burstLimit: 100 | Prevents bulk claim flooding |
| Consent Enforcement | optional | GDPR consent gate on PII write paths |
| Protected Predicates | governance.*, hardban.*, system.* | Blocked for untrusted agents |
| Classification Filtering | clearance-based | Claims filtered by trust-derived clearance |
| Key Rotation | manual | Atomic re-encryption of vault entries |
| maxAutoConfidence | 0.7 | Prevents confidence laundering without evidence |

---

## Monitoring

```typescript
// Engine health
const h = limen.health();
// Returns: { status, uptime_ms, subsystems: { database, audit, sessions, missions, learning, memory }, throughput }

// Cognitive health
const ch = limen.cognitive.health();
// Returns: { totalClaims, freshness: { fresh, aging, stale }, conflicts: { unresolved }, gaps, staleDomains }

// Metrics
const m = limen.metrics.snapshot();
```

| Health Status | Meaning |
|---------------|---------|
| healthy | All subsystems operational |
| degraded | Missing LLM providers (core CRUD still works) |
| unhealthy | Database or audit subsystem failure |

---

## Contracts (14 ratified)

| Contract | Version | Requirements |
|----------|---------|-------------|
| SHARED_TYPES | v1.4.1 | 477 |
| AGENT_MEMORY_BRIDGE | v1.3.1 | Belief CRUD |
| AGENT_LIFECYCLE_MANAGEMENT | v1.3.0 | 318 |
| AGENT_OUTPUT_GOVERNANCE | v1.0.0 | 205 |
| AGENT_COORDINATION_GOVERNANCE | v1.0.0 | 168 |
| AUDIT_VISUALIZATION_SCHEMA | v1.2.0 | 130 |
| AGENT_ADAPTER_ARCHITECTURE | v2.3.0 | Pluggable adapters |
| AGENT_INTELLIGENCE_BRIDGE | v1.2.0 | Technique learning |
| AGENT_EXECUTION_GOVERNANCE | v1.2.1 | Missions, budgets |
| AGENT_CONTEXT_GOVERNANCE | v1.2.2 | Context, working memory |
| AGENT_SEARCH_GOVERNANCE | v1.0.0 | Search, embeddings |
| COMPUTER_USE_GOVERNANCE | v2.2.0 | Computer actions |
| CREWAI_ADAPTER_CONTRACT | v1.0.0 | CrewAI integration |
| LIMEN_V5_INTEGRATION_CONTRACT | v1.0.0 | SolisForge convergence |

---

## Production Test Stand

```bash
# From test stand project
cd ~/Projects/limen-teststand

# Install from tarball
npm install ~/Projects/limen/.claude/worktrees/p0-remediation/dist/limen-ai-4.0.0.tgz

# Run all 443 cases
npx tsx src/run.ts                     # 13 suites
npx tsx src/v5-audit/tier1-wiring-audit.ts   # Tier 1: 167 methods
npx tsx src/v5-audit/tier2/*.test.ts          # Tier 2: 95 behavioral
npx tsx src/v5-audit/tier3/*.test.ts          # Tier 3: 26 contract
npx tsx src/v5-audit/tier4/*.test.ts          # Tier 4: 143 MCP
```

---

## Rollback Procedure

1. Stop the running Limen MCP server
2. Checkout v4: `git checkout main`
3. Reinstall: `npm ci`
4. Rebuild: `npm run build`
5. Verify: `npm test`
6. Restart MCP server

**Max rollback time:** Under 5 minutes.
**Data preservation:** SQLite DB is backward-compatible. v5 tables ignored by v4.

---

## Known Limitations

- No LLM providers configured → health reports "degraded" (core CRUD works)
- MCP stdio only — no HTTP/SSE transport
- Single-node SQLite — no distributed deployment
- PDF/SVG export returns graceful error
- 2 performance tests are machine-dependent (may flake under load)
- `dataDir` option requires explicit `masterKey` as Buffer (FINDING-002)

---

## Governance Gate (FORGE-GATE.md)

Read `FORGE-GATE.md` at session start. It tracks:
- Current phase (9 — RATIFIED)
- Phase checklist (all 11 phases)
- Artifact tracker (11/11 produced)
- Convergence log (Phase 6: 5 rounds, 20 findings, CLEAN)
- Enforcement rules (10 non-negotiable)

---

## Contact

- **Repository:** github.com/solishq/limen
- **Branch:** release/v5 (development), main (v4 stable)
- **Engineering Channel:** #engineering (Limen A2A)
- **Governance:** SolisForge Protocol v1.4 + v1.5 (30 amendments, pending ratification)
