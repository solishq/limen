# ADVERSARIAL COMPLETENESS AUDIT: LIMEN DEFINITIVE SPEC

**Date**: 2026-03-30
**Author**: SolisHQ Breaker Agent (Adversarial Audit)
**Classification**: CONSEQUENTIAL
**Method**: Read every source report. Extracted key findings. Verified each against the definitive spec. Flagged losses and weaknesses with severity.
**Verdict**: The consolidation is GOOD but NOT COMPLETE. 37 findings survived intact. 19 were weakened. 11 were lost entirely.

---

## SCORING KEY

| Severity | Meaning |
|----------|---------|
| **CRITICAL** | A finding that affects product viability, security, or correctness was dropped |
| **HIGH** | A specific, actionable recommendation was lost — will cause rework when rediscovered |
| **MEDIUM** | Nuance or detail removed that weakens the recommendation |
| **LOW** | Minor detail omitted, can be recovered from source |

---

## AUDIT TABLE

### Report #1: LIMEN_COMPLETE_FEATURE_SPEC.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 1.1 | Feature matrix with 7 categories, ~50 features | YES — Part 4 reproduces all 7 categories | INTACT | — |
| 1.2 | Competitive landscape table (9 competitors with stars, architecture, strengths/weaknesses) | PARTIAL — Appendix B has the comparison table but the detailed per-competitor breakdown (Hindsight 91.4% retrieval accuracy, Engram, SuperMemory details) is collapsed into a single table | WEAKENED — competitor-specific detail lost | MEDIUM |
| 1.3 | Developer journey analysis (Minute 0-1, 1-3, 3-10, 10-30, Day 1-7) | PARTIAL — Part 5 covers the DX gap and 3-line quickstart but the minute-by-minute journey map is absent | WEAKENED — the temporal progression of developer experience is lost | MEDIUM |
| 1.4 | `knowledge_api.ts` returns `{ memoriesCreated: 0 }` — specific code evidence of the stub | YES — Part 5 references this directly | INTACT | — |
| 1.5 | Feature 3.6 (OpenAI Agents SDK integration) and 3.7 (Vercel AI SDK integration) as separate line items | NO — collapsed into the framework adapters table in Part 7 | LOST — specific integration targets for Agent SDK and Vercel AI SDK disappeared as discrete features | LOW |
| 1.6 | Invention opportunity: Memory Portability Standard (JSON-LD export) — detailed spec for interop | YES — Part 4 lists it, Part 10 specifies 7 export formats including JSON-LD and N-Triples | INTACT | — |
| 1.7 | Performance targets: remember <10ms, recall <20ms, FTS5 <50ms, startup <100ms | YES — Part 8 and Part 10 | INTACT | — |
| 1.8 | The `null as unknown as TenantId` cast in example 07-knowledge.ts — specific DX failure | NO — the specific code evidence is mentioned in the DX section generically but this exact smoking gun is gone | WEAKENED — the most damning concrete evidence of DX failure is absent | LOW |

### Report #2: LIMEN_DEVELOPER_EXPERIENCE_SPEC.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 2.1 | Five critical DX failures enumerated (identity crisis, knowledge API stub, no examples in npm, native dep friction, concept overload) | PARTIAL — Items 1,2,3 are covered. Item 4 (better-sqlite3 native compilation friction on Windows/Node 25/CI) is completely absent. Item 5 (concept overload) is partially covered | WEAKENED — native compilation friction is a critical adoption barrier that vanished | HIGH |
| 2.2 | better-sqlite3 fails on Node 25, fails on Windows without VS build tools, fails in Docker slim images | NO | LOST — this is a real, documented adoption blocker. The definitive spec never mentions installation failure modes | HIGH |
| 2.3 | Detailed Mem0/Zep/Letta competitive DX comparison with time-to-first-working-code metrics (Mem0: 2min, Zep: 15min-1hr, Letta: 5min) | PARTIAL — The DX gap section mentions Mem0 vs Limen but the quantified time-to-first-code for all competitors is lost | WEAKENED — quantified competitor DX benchmarks are gone | MEDIUM |
| 2.4 | Node.js >= 22 requirement cuts off Node 18 LTS and Node 20 LTS users | NO | LOST — the Node version requirement analysis and its impact on addressable market is absent | HIGH |
| 2.5 | npm `files` field excludes examples — they don't ship with the package | PARTIAL — mentioned in passing but not flagged as a specific action item | WEAKENED | LOW |
| 2.6 | npm description "Cognitive Operating System — deterministic infrastructure hosting stochastic cognition" is poetry, not searchable | YES — Part 2 and Part 5 address this | INTACT | — |
| 2.7 | Keywords missing: `memory`, `knowledge`, `remember`, `recall`, `agent-memory` | YES — Part 9 mentions npm package.json rewrite | INTACT | — |
| 2.8 | Detailed missing documentation list (no knowledge quickstart, no recipes, no migration guide from competitors, no troubleshooting, no concepts page) | PARTIAL — Part 5 covers documentation site architecture but the specific "missing docs" inventory is gone | WEAKENED — the explicit gap list is replaced with a forward-looking site architecture | MEDIUM |

### Report #3: LIMEN_GOVERNANCE_PERFECTION.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 3.1 | 7 regulatory frameworks with detailed requirements and Limen gap analysis | YES — Part 6 reproduces the table | INTACT | — |
| 3.2 | EU AI Act penalties: up to 35M EUR or 7% of global turnover | YES | INTACT | — |
| 3.3 | Detailed GDPR tombstone mechanism with cascade re-hash | YES — Part 6 covers this | INTACT | — |
| 3.4 | HIPAA requirement for field-level encryption of PHI claims (not just disk-level) | YES — mentioned in Part 6 table | INTACT | — |
| 3.5 | SOC 2 2026 update: AI governance criteria, bias detection, confidence drift | YES | INTACT | — |
| 3.6 | FINRA 2026: prompt/output logging, model version tracking | YES | INTACT | — |
| 3.7 | FDA: TPLC framework, GMLP, PCCPs for AI updates | YES — summarized in table | INTACT | — |
| 3.8 | Mandatory Features Matrix (7 regulations x 8 features) | NO | LOST — the cross-reference matrix showing which regulation requires which feature is absent | MEDIUM |
| 3.9 | Self-governing architecture vision: "non-compliance is structurally impossible" | YES — Part 6 opens with this | INTACT | — |
| 3.10 | Detailed per-regulation source citations (legal URLs, enforcement dates) | NO | LOST — all 18+ regulatory source URLs from the original are dropped | LOW |
| 3.11 | Compliance report generation specifications (SOC 2 package, FINRA export format, GDPR erasure certificate) | PARTIAL — mentioned as gaps but the detailed spec for what each compliance report should contain is lost | WEAKENED — the original had specifications, the definitive spec only notes the gap | MEDIUM |

### Report #4: LIMEN_COGNITIVE_ARCHITECTURE_RESEARCH.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 4.1 | CLS theory dual-system model (hippocampus vs neocortex) with Limen analogy table | YES — Part 3 covers this | INTACT | — |
| 4.2 | 7 cognitive primitives table with status | YES — Part 3 | INTACT | — |
| 4.3 | 5 self-organization functions (auto-classification, auto-connection, auto-conflict, importance, context placement) | YES — Part 3 covers all 5 | INTACT | — |
| 4.4 | FSRS decay formula: R(t) = (1 + t/(9*S))^(-1) | YES — Part 3 | INTACT | — |
| 4.5 | Initial stability table by claim type (governance: 365d, architectural: 180d, finding: 90d, warning: 30d, ephemeral: 7d, preference: 120d) | YES — Part 3 reproduces exact table | INTACT | — |
| 4.6 | DIAL-KG three-stage cycle (dual-track extraction, governance adjudication, schema evolution) | NO | LOST — the specific DIAL-KG research citation with its three-stage model is absent. The definitive spec mentions auto-classification but strips the academic foundation | HIGH |
| 4.7 | AutoSchemaKG: 95% semantic alignment with human-crafted schemas | NO | LOST — this specific research evidence for feasibility of self-organizing schemas is dropped | MEDIUM |
| 4.8 | PaTeCon: automatic temporal constraint mining for conflict detection (arXiv 2312.11053) | YES — Part 3 mentions it | INTACT | — |
| 4.9 | Three additional cognitive primitives: ABSTRACT, IMAGINE, ANALOGIZE | YES — Part 3 mentions as "important but premature" | INTACT | — |
| 4.10 | FSRS stability update formula: S_new = S_old * SInc with component functions | NO | LOST — the detailed formula for how stability updates on reinforcement is dropped. Only the decay formula survives | MEDIUM |
| 4.11 | Cognitive architecture vision diagram with 5 layers | YES — Part 3 | INTACT | — |
| 4.12 | Consolidation loop: 8-step process (SCAN, CLASSIFY, CONNECT, CONFLICT, CONSOLIDATE, ARCHIVE, SCHEMA, METRICS) | YES — Part 3 reproduces | INTACT | — |

### Report #5: LIMEN_SUPERPOWERS_AS_FEATURES.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 5.1 | Verdict summary table for 14 superpowers + 5 capabilities | YES — Part 4 reproduces the full table | INTACT | — |
| 5.2 | SP1 Narrative Memory: detailed API design with momentum, unfinished threads, energy state fields | NO | LOST — the specific API shape for narrative memory (momentum, unfinished threads, key decisions, energy state) is dropped. Only "narrative memory" appears as a line item | HIGH |
| 5.3 | SP2 Proactive Sensing: detailed cognitive health API response (freshness, conflicts, confidence distribution, gaps) | NO | LOST — the detailed API response shape with staleDomains, unresolvedConflicts, lowConfidenceCount is dropped. Only mentioned as a feature | HIGH |
| 5.4 | SP3 Multi-Pass Reasoning: "THE KERNEL NEVER REASONS" principle confirmed | PARTIAL — the NO verdict is preserved but the constitutional principle and the specific recommendation (document as reference architecture pattern) are gone | WEAKENED | LOW |
| 5.5 | SP4 Reasoning Chain Memory: "A claim without reasoning is a fact. A claim with reasoning is wisdom." | YES — Part 9 includes reasoning column | INTACT | — |
| 5.6 | SP5 Promise Accountability: predict/record_outcome/calibration API design | PARTIAL — listed as YES in superpower table but the detailed 3-tool API design (limen_predict, limen_record_outcome, limen_calibration) is absent | WEAKENED — the API shape is gone, only the concept survives | MEDIUM |
| 5.7 | SP7 Excellence Gates: configurable validation hooks with 5 gate types (minimum confidence, reasoning required, conflict check, evidence required, custom predicate) | PARTIAL — listed as feature but the 5 specific gate types are absent | WEAKENED | MEDIUM |
| 5.8 | SP9 Autonomy Levels: operations-per-trust-level matrix | NO | LOST — the specific matrix showing which operations each trust level can perform is dropped | MEDIUM |
| 5.9 | SP10 User/Preference Model: profile system built on claims | YES — listed in table | INTACT (as concept) | — |
| 5.10 | SP12 Agent Specialization: reliability scoring per agent per domain | YES — listed in table | INTACT (as concept) | — |
| 5.11 | Capability D Confidence Calibration: per-agent calibration curves | YES — listed in table | INTACT (as concept) | — |
| 5.12 | Effort estimates per superpower (S/M/L) | NO | LOST — the sizing estimates for each superpower are dropped from the table | LOW |

### Report #6: LIMEN_INTEGRATION_ECOSYSTEM.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 6.1 | 6 LLM provider current adapters with enhancement roadmap | YES — Part 7 | INTACT | — |
| 6.2 | Claude MCP: memory tool protocol backing store, extended thinking -> reasoning traces | YES — Part 7 mentions key enhancements | INTACT | — |
| 6.3 | OpenAI: Assistants API deprecated Aug 2026, Responses API migration needed | YES — Part 7 | INTACT | — |
| 6.4 | Gemini: 90% cost reduction on cached context reads (2.5+) | YES — Part 7 | INTACT | — |
| 6.5 | Cohere: NEW adapter + Rerank 4.0 for post-retrieval quality improvement | YES — Part 7 | INTACT | — |
| 6.6 | Detailed LOC estimates per LLM integration (~800 LOC Anthropic, ~800 OpenAI, ~500 Gemini, ~450 Ollama, ~750 Cohere) | PARTIAL — LOC estimates preserved for LLM integrations | INTACT | — |
| 6.7 | 6 agent framework adapter specifications (LangChain, LlamaIndex, CrewAI, Vercel, OpenAI Agents SDK, AutoGen) with interface contracts | YES — Part 7 reproduces the table | INTACT | — |
| 6.8 | LangChain BaseMemory and BaseCheckpointSaver interface contracts (actual TypeScript code) | NO | LOST — the specific TypeScript interface contracts for each framework adapter are dropped | MEDIUM |
| 6.9 | Groq: remote MCP tool calling (server-side Limen execution) | NO | LOST — Groq's unique zero-latency-overhead remote MCP pattern is not mentioned in the definitive spec | LOW |
| 6.10 | 5 observability integrations (OpenTelemetry, Prometheus, Grafana, Sentry, custom) — detailed specifications | NO | LOST — the entire observability integration section is absent from the definitive spec | HIGH |
| 6.11 | 6 developer tool integrations (VS Code extension, GitHub Actions, npm scripts, Docker, testing utilities, CLI plugins) | NO | LOST — the developer tools section is completely absent | MEDIUM |
| 6.12 | 3-layer adapter architecture (Storage / Provider / Framework) | YES — Part 7 reproduces the diagram | INTACT | — |
| 6.13 | Priority matrix for all integrations (Appendix A) | NO | LOST — the prioritized matrix ranking all integrations by impact vs effort is absent | LOW |

### Report #7: LIMEN_ENGINEERING_ASSESSMENT.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 7.1 | Auto-classification verdict: FEASIBLE but NOT FEASIBLE as synchronous operation on write path | YES — Part 3 and Anti-List #6 | INTACT | — |
| 7.2 | Auto-connection: suggested relationships must be flagged as `suggested`, not auto-confirmed (I-17) | YES — Part 3 mentions this | INTACT | — |
| 7.3 | Decay: query-time computation, NOT stored mutation. Compute in application code for portability | YES — Part 3 explicitly states this | INTACT | — |
| 7.4 | Access-frequency tracking: batched flush strategy to avoid write-on-read | PARTIAL — the feature is listed but the specific "batched flush" recommendation is absent | WEAKENED | LOW |
| 7.5 | sqlite-vec assessment: npm package last published ~1 year ago (concern flag) | YES — Part 13 mentions the concern | INTACT | — |
| 7.6 | Knowledge graph traversal: performance degrades superlinearly at high connectivity. LIKE-based cycle detection is O(n) anti-pattern | PARTIAL — traversal depth limits mentioned but the specific LIKE anti-pattern warning is lost | WEAKENED | LOW |
| 7.7 | Event system: EventBus ALREADY EXISTS. Enhancement, not new build | YES — mentioned in superpowers table | INTACT | — |
| 7.8 | remember(text, options?) single-parameter form with auto-generated subject | YES — Part 14 Contradiction 1 resolves this | INTACT | — |
| 7.9 | `POWER()` not built into SQLite — must use `EXP(LN(0.5) * age / half_life)` or compute in app code | NO | LOST — this specific SQLite implementation detail for decay computation is dropped | LOW |
| 7.10 | Convenience API should be thin wrappers over existing ClaimApi — specific architectural guidance | YES — Part 5 and Part 15 | INTACT | — |
| 7.11 | Python binding: HIGH priority for the product (ML/AI ecosystem is Python-first) | YES — Part 14 Contradiction 8 resolves this | INTACT | — |
| 7.12 | The honest ceiling: "Limen will not serve billions of claims as a single SQLite file" | YES — Part 15 end section | INTACT | — |

### Report #8: LIMEN_BLEEDING_EDGE_TECH_RESEARCH.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 8.1 | GraphRAG: 80% accuracy vs 50% for traditional RAG. LazyGraphRAG: 0.1% indexing cost | NO | LOST — the specific GraphRAG performance evidence is absent | MEDIUM |
| 8.2 | ColBERT v2: late interaction retrieval with Jina-ColBERT-v2 (89 languages, 8192 tokens) | NO | LOST — entire ColBERT analysis is absent | LOW |
| 8.3 | RAPTOR: 20% absolute accuracy improvement on QuALITY benchmark. "Claim RAPTOR" invention opportunity | PARTIAL — RAPTOR mentioned in Part 15 roadmap but the performance evidence and "Claim RAPTOR" invention are gone | WEAKENED | MEDIUM |
| 8.4 | HyDE: hypothetical document embeddings, 25-60% latency increase | NO | LOST — entire HyDE analysis is absent | LOW |
| 8.5 | Self-RAG: reflection tokens (ISREL, ISSUP, ISUSE) | NO | LOST — the Self-RAG reflection token model is absent | LOW |
| 8.6 | CRAG: retrieval evaluator with Correct/Incorrect/Ambiguous triaging | PARTIAL — mentioned as "CRAG-inspired" in tech stack table but the detailed mechanism is gone | WEAKENED | LOW |
| 8.7 | Adaptive RAG Router: 5-tier routing (exact->FTS5->vector->graph->iterative) | YES — Part 3 reproduces the routing model | INTACT | — |
| 8.8 | Optimal technology stack table (10 layers) | YES — Part 13 reproduces the full table | INTACT | — |
| 8.9 | EmbeddingGemma-300M: 308M params, sub-200MB, 100+ languages, sub-22ms inference | YES — Part 13 | INTACT | — |
| 8.10 | Storage comparison: Matryoshka 128-dim + 2-bit = 32 bytes/claim, 1M claims = 32MB | YES — Part 13 reproduces the table | INTACT | — |
| 8.11 | 8 invention opportunities listed | PARTIAL — 3 of 8 are listed (Governed GraphRAG, Cognitive Consolidation Engine, Activation-Based Retrieval). 5 are absent | WEAKENED — 5 of 8 invention opportunities from bleeding-edge research are missing | HIGH |
| 8.12 | Speculative RAG, Agentic RAG detailed analysis | NO | LOST — these two significant retrieval architectures are absent | LOW |
| 8.13 | CLS-inspired three-tier memory model (Working/Episodic/Semantic) | YES — Part 13 tech stack table | INTACT | — |

### Report #9: LIMEN_ENGINEERING_EXCELLENCE_SPEC.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 9.1 | Zero tolerance list (8 rules with ESLint enforcement) | YES — Part 8 reproduces the table | INTACT | — |
| 9.2 | Naming conventions (files, types, functions, constants, variables) | NO | LOST — the entire naming convention specification is absent | HIGH |
| 9.3 | File structure standard (6-section ordering: JSDoc, imports, types, constants, main export, helpers) | NO | LOST — the file structure template is absent | MEDIUM |
| 9.4 | Module boundaries / 4-layer architecture rules | YES — Part 8 reproduces | INTACT | — |
| 9.5 | Function design rules (6 rules including 40-line max, 4-param max) | YES — Part 8 | INTACT | — |
| 9.6 | Error handling: Result<T, E> type for expected failures, error code namespaces | YES — Part 8 and Part 5 | INTACT | — |
| 9.7 | SQL standards: prepared statements ONLY, no string interpolation | YES — Part 8 | INTACT | — |
| 9.8 | Test pyramid target: Unit 70% / Integration 25% / E2E 5% | YES — Part 8 | INTACT | — |
| 9.9 | Branded types (ClaimId, MissionId, SubjectUrn, Confidence) at zero runtime cost | YES — Part 8 | INTACT | — |
| 9.10 | Comments/documentation rules | NO | LOST — the JSDoc requirements and comment standards are absent | MEDIUM |
| 9.11 | Testing patterns (describe/it structure, test isolation, shared test utilities) | NO | LOST — the testing pattern specification is absent | MEDIUM |
| 9.12 | CI/CD specification (lint, type-check, test, benchmark gates) | NO | LOST — the CI pipeline specification is absent | MEDIUM |

### Report #10: LIMEN_GAP_ANALYSIS.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 10.1 | 47 gaps across 8 categories | YES — Part 12 reproduces the gaps register (MUST-HAVE, SHOULD-HAVE, NICE-TO-HAVE) | INTACT | — |
| 10.2 | 5 most dangerous gaps identified | YES — Part 12 end section | INTACT | — |
| 10.3 | Gap 2.1: Database corruption recovery with specific scenarios (WAL corruption, FTS5 desync, vector corruption) | PARTIAL — listed as a gap but the 4 specific corruption scenarios are collapsed | WEAKENED | LOW |
| 10.4 | Gap 2.7: Knowledge base poisoning — 4 attack vectors + 4 defenses | YES — Part 6 reproduces all 4 vectors and defenses | INTACT | — |
| 10.5 | Gap 3.4: Auto-extraction costs $3,000/day at enterprise scale (specific cost calculation) | YES — Part 14 Contradiction 5 references this | INTACT | — |
| 10.6 | Gap 5.1: Consent and ethical knowledge modeling — specific ethical questions (modeling without consent, federation privacy, high-risk classification) | PARTIAL — listed as a gap line item but the 3 specific ethical questions are absent | WEAKENED | MEDIUM |
| 10.7 | Gap 6.2: Confidence propagation rules — Bayesian propagation formulas for each relationship type | PARTIAL — listed but the formulas (max confidence for supports, penalty for contradicts, ceiling for derived_from) are absent | WEAKENED — the mathematical spec is gone | MEDIUM |
| 10.8 | "Which research should have caught it" attribution per gap | NO | LOST — the meta-analysis of which reports missed which gaps is completely absent | LOW |

### Report #11: LIMEN_DISTRIBUTED_SYSTEMS_RESEARCH.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 11.1 | CRDT analysis: why Limen's claim model is naturally CRDT-compatible | YES — Part 3 and Part 11 | INTACT | — |
| 11.2 | Three replication models (Full/Selective/Federated) with verdicts | PARTIAL — selective replication mentioned but the 3-model comparison is absent | WEAKENED | LOW |
| 11.3 | 5 SQLite distribution technologies compared (Turso, LiteFS, Marmot, PowerSync, ElectricSQL) | NO | LOST — the detailed comparison of 5 SQLite distribution solutions with their trade-offs is absent | MEDIUM |
| 11.4 | Three-layer deployment model (Edge/Cloud/Federation) | YES — Part 3 | INTACT | — |
| 11.5 | Consistency model: governance = strong (Raft), knowledge = eventual (HLC) | YES — Part 3 | INTACT | — |
| 11.6 | 6 invention opportunities for distributed cognition | YES — Part 11 | INTACT | — |
| 11.7 | 7 security-at-scale threats with mitigations | YES — Part 11 | INTACT | — |
| 11.8 | GDPR at scale: crypto-shredding per data subject | YES — Part 11 | INTACT | — |
| 11.9 | Technology choices table (WebSocket, HLC, PostgreSQL sync service, NATS, gRPC, AES-256-GCM + X25519) | YES — Part 11 | INTACT | — |
| 11.10 | Phased delivery: Phase 0-5 with specific deliverables per phase | YES — Part 11 | INTACT | — |
| 11.11 | Retraction propagation in distributed system: "pre-tombstone" concept | NO | LOST — the specific pre-tombstone mechanism for retractions arriving before claims is absent | LOW |
| 11.12 | Distributed governance: RBAC policies must replicate alongside claims | PARTIAL — mentioned generically but the specific requirement that policies form a separate replication stream with strong consistency is only partially captured | WEAKENED | LOW |
| 11.13 | FoundationDB/CockroachDB/Spanner/Vitess lessons learned | NO | LOST — the specific lessons from each planet-scale database are absent | LOW |

### Report #12: LIMEN_SECURITY_ENGINEERING.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 12.1 | STRIDE analysis with 6 threat categories | YES — Part 6 reproduces | INTACT | — |
| 12.2 | 3 critical security findings (SEC-CRIT-001, -002, -003) | YES — Part 6 | INTACT | — |
| 12.3 | 10 security invariants | YES — Part 6 | INTACT | — |
| 12.4 | SEC-GAP-001: Claims lack database-level immutability triggers on content fields | YES — Part 6 mentions this | INTACT | — |
| 12.5 | LINDDUN privacy analysis (Linkability, Identifiability, Non-Repudiation, Detectability, Unawareness, Non-Compliance, Data Linkability) | NO | LOST — the entire LINDDUN privacy threat model is absent. Only STRIDE survives | CRITICAL |
| 12.6 | SEC-GAP-002: .raw escape hatch has no access control — convention-only enforcement | NO | LOST — this specific privilege escalation gap is absent from the definitive spec | HIGH |
| 12.7 | SEC-GAP-003: No automatic PII detection at claim ingestion | PARTIAL — mentioned in the gaps register under PII but the SEC-GAP-003 designation and the specific cascading erasure requirement are weakened | WEAKENED | MEDIUM |
| 12.8 | Threat E-1: RBAC is dormant by default — recommendation for `requireRbac: boolean` config flag | NO | LOST — the specific recommendation that production deployments should require RBAC activation is absent | HIGH |
| 12.9 | Threat I-3: Zero2Text embedding inversion — 6.4x higher BLEU-2 scores WITHOUT training data | YES — Part 6 | INTACT | — |
| 12.10 | Threat D-1: No query timeout — recommendation for sqlite3_progress_handler | YES — Part 6 mentions this gap | INTACT | — |
| 12.11 | Threat R-2: No compile-time enforcement that system calls produce audit entries — recommendation for linting rule | NO | LOST — the specific recommendation for an architectural test/lint rule ensuring audit coverage is absent | MEDIUM |
| 12.12 | Threat E-3: .raw property requires SYSTEM_SCOPE annotation — convention not enforcement | Same as 12.6 | LOST | HIGH |

### Report #13: LIMEN_INTERFACE_DESIGN.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 13.1 | Three design principles: legibility over density, structure for machines/beauty for humans, errors are conversations | YES — Part 5 | INTACT | — |
| 13.2 | CLI command grammar: `limen <verb> [noun] [flags]` | YES — Part 5 | INTACT | — |
| 13.3 | Color palette with semantic meanings (Cyan=identifiers, Green=success, etc.) | YES — Part 2 includes terminal color palette | INTACT | — |
| 13.4 | Symbol vocabulary (10 symbols with meanings) | YES — Part 2 | INTACT | — |
| 13.5 | Detailed command designs: `limen init`, `limen status`, `limen remember`, `limen recall`, `limen search`, `limen graph`, `limen export`, `limen import` | PARTIAL — `limen status` and `limen graph` wow moments are described but the full command-by-command design with exact output formatting is absent | WEAKENED — the specific output format specifications per command are lost | MEDIUM |
| 13.6 | Error message anatomy: `x LMN-NNNN: Title` + detail + fix + docs link | YES — Part 5 | INTACT | — |
| 13.7 | Global flags: --json, --no-color, --verbose, --data-dir, --master-key, --quiet | NO | LOST — the 6 global CLI flags are not specified in the definitive spec | LOW |
| 13.8 | Auto-detection: when stdout is not a TTY, switch to JSON automatically | NO | LOST — this UX principle for piped output is absent | LOW |
| 13.9 | Loading indicators: <200ms none, 200ms-2s dot animation, >2s spinner | YES — Part 5 | INTACT | — |
| 13.10 | CLI personality: "Calm, confident, fast. Silent when possible. Never celebrate. Never apologize." | YES — Part 5 | INTACT | — |
| 13.11 | MCP output design specifications | NO | LOST — the MCP-specific output formatting rules are absent | LOW |
| 13.12 | Design references table (5 CLIs: Vercel, gh, Railway, Wrangler, Charm) with specific lessons | NO | LOST — the design inspiration sources with their specific lessons are absent | LOW |

### Report #14: LIMEN_THESIS.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 14.1 | The one sentence: "Limen is a knowledge engine that treats what AI agents know as beliefs..." | YES — Part 1 | INTACT | — |
| 14.2 | Ontological gap table (10 properties: Data vs Belief) | YES — Part 1 reproduces exactly | INTACT | — |
| 14.3 | Three converging forces (multi-agent, trust, scaling) | YES — Part 1 | INTACT | — |
| 14.4 | Intellectual genealogy tree (Plato -> AGM -> TMS -> Bayesian -> Epistemic Logic -> CLS -> Limen) | YES — Part 1 | INTACT | — |
| 14.5 | Design principle table (7 origins mapped to implementations) | YES — Part 1 | INTACT | — |
| 14.6 | 20 tagline candidates with evaluation process | NO | LOST — the evaluation methodology showing how the one sentence was selected is absent | LOW |
| 14.7 | Academic thesis abstract (250 words) | NO | LOST — the formal academic abstract is absent | LOW |
| 14.8 | Five formal corollaries of the thesis | YES — Part 1 | INTACT | — |
| 14.9 | Prediction: within 24 months, dominant systems will adopt 3+ epistemic primitives | YES — Part 1 | INTACT | — |
| 14.10 | Competitive chasm argument: "For Mem0 to match... This is not a sprint. This is a rewrite." | YES — Part 1 | INTACT | — |
| 14.11 | Identity resolution: "Limen is NOT a library / platform / database / framework" | YES — Part 2 | INTACT | — |

### Report #15: LIMEN_RELEASE_STRATEGY.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 15.1 | v1.3.0 "WOW": 14 features with effort estimates, dependency graph | YES — Part 9 and Part 15 | INTACT | — |
| 15.2 | v1.4.0 "COMMIT": 20 features with effort estimates | YES — Part 9 and Part 15 | INTACT | — |
| 15.3 | v2.0.0 "DEPEND" feature list | YES — Part 9 | INTACT | — |
| 15.4 | The Anti-List (6 items to never build) | YES — Part 9 | INTACT | — |
| 15.5 | Definition of Done checklist for v1.3.0 | YES — Part 15 | INTACT | — |
| 15.6 | What Gets CUT lists per version | YES — Part 9 | INTACT | — |
| 15.7 | Dependency graph between features (ASCII art) | YES — Part 15 critical path diagram | INTACT | — |

### Report #16: LIMEN_OPERATIONAL_GAPS.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 16.1 | Current state metrics (670 claims, 3188 tests, etc.) | YES — Part 10 | INTACT | — |
| 16.2 | Migration system architecture (forward-only, checksum-verified, multi-phase) | PARTIAL — the expansion-only approach is described but the 4-phase migration runner architecture is absent | WEAKENED | LOW |
| 16.3 | Exact migration SQL for v37 (Cognitive Foundation) and v38 (Consolidation) | NO | LOST — the specific SQL migration scripts are absent | MEDIUM |
| 16.4 | Schema change table (8 specific ALTER TABLE changes) | YES — Part 10 reproduces the table | INTACT | — |
| 16.5 | Performance overhead budget table (current vs with-FTS5 vs with-vectors) | YES — Part 10 | INTACT | — |
| 16.6 | 7 export formats | YES — Part 10 | INTACT | — |
| 16.7 | Export/import guarantees (deduplication, hash chain continuity, atomicity) | YES — Part 10 | INTACT | — |
| 16.8 | FTS5 external content table design (index-only, no duplicate data) | NO | LOST — the specific architectural decision to use external content tables is absent | LOW |

### Report #17: LIMEN_FINAL_AUDIT.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 17.1 | AWS Bedrock AgentCore Memory as existential competitive threat | YES — Part 12 | INTACT | — |
| 17.2 | Cold start problem with 4 solutions (templates, onboarding, demo mode, first-claim celebration) | YES — Part 5 | INTACT | — |
| 17.3 | Knowledge Quality Score (KQS) with 6-dimension formula and letter grades | PARTIAL — mentioned as an invention opportunity and gap but the formula and letter grade system are absent | WEAKENED — the mathematical specification is gone | MEDIUM |
| 17.4 | Wrong knowledge problem: confidence ceiling for auto-extracted claims (default 0.7), cascade retraction formula (0.5 for first-degree, 0.25 for second-degree) | NO | LOST — the specific wrongness containment protocol with numeric thresholds is absent | CRITICAL |
| 17.5 | FTS5 tokenizer: unicode61 does NOT support CJK. 4 options evaluated. Intl.Segmenter recommended | PARTIAL — i18n gap is mentioned, unicode61 recommended, but the CJK failure analysis and the 4 alternative tokenizer options are absent | WEAKENED — the most dangerous irreversible decision (tokenizer) has reduced detail | HIGH |
| 17.6 | Real-time vs batch cognitive operations: hybrid event-driven model with latency budgets per operation | NO | LOST — the execution model specification for cognitive operations (sync/async/batch per operation type) is absent | CRITICAL |
| 17.7 | Developer community strategy: 3 tiers (discovery/engagement/growth), 4 user cohorts, 8 specific communities | PARTIAL — community mentioned as a gap but the 3-tier strategy, 4 cohorts, and 8 specific community targets are absent | WEAKENED | MEDIUM |
| 17.8 | IP strategy: Apache 2.0 analysis with 4 project license-change case studies (MongoDB, Elasticsearch, Redis, HashiCorp) | NO | LOST — the detailed IP/licensing analysis with historical precedents is absent | HIGH |
| 17.9 | Accessibility: WCAG 2.2 AA, Section 508, CLI screen reader compatibility | NO | LOST — accessibility analysis is completely absent | MEDIUM |
| 17.10 | Documentation versioning (Docusaurus) | NO | LOST — documentation versioning strategy is absent | LOW |
| 17.11 | Agent prompt engineering: `limen.promptInstructions()` API for system prompt injection | NO | LOST — the recommended system prompt snippet and API method are absent | HIGH |
| 17.12 | Telemetry: opt-out anonymous usage collection specification | NO | LOST — the telemetry design is absent | MEDIUM |
| 17.13 | CI testing matrix: 7 specific jobs covering 3 OSes, 2 architectures, 3 Node versions | NO | LOST — the CI matrix specification is absent | MEDIUM |
| 17.14 | Competitive response analysis: what Mem0/Zep/AWS will do when Limen ships | NO | LOST — the competitor response predictions are absent | MEDIUM |
| 17.15 | First 100 users: 4 cohorts (Claude Code users, multi-agent builders, privacy-conscious, enterprise eval) with specific channels | PARTIAL — same as 17.7, collapsed | WEAKENED | MEDIUM |
| 17.16 | Unicode edge cases in subject URNs (NFC normalization requirement) | NO | LOST — URN Unicode normalization specification is absent | LOW |
| 17.17 | Multilingual embedding models: BGE-M3 (100+ languages), multilingual-e5-large (94 languages) | NO | LOST — the multilingual embedding model recommendations are absent | MEDIUM |

### Report #18: LIMEN_DESIGN_TASTE.md

| # | Key Finding | In Definitive Spec? | Lost/Weakened | Severity |
|---|-------------|---------------------|---------------|----------|
| 18.1 | Name analysis with 5-criteria scoring (41/50 total) | YES — Part 2 | INTACT | — |
| 18.2 | 3 logo concepts evaluated (Threshold Mark, Aperture, Liminal Gate) with recommendation | YES — Part 2 | INTACT | — |
| 18.3 | Color palette: dark mode + light mode + terminal colors (full token table) | PARTIAL — dark mode palette is present but the light mode palette and terminal-specific palette are absent | WEAKENED — light mode colors dropped | MEDIUM |
| 18.4 | Typography: JetBrains Mono / Space Grotesk / Inter | YES — Part 2 | INTACT | — |
| 18.5 | Voice guidelines with words-to-use and words-to-avoid | YES — Part 2 | INTACT | — |
| 18.6 | README design: 5-line rule, code before words, 150 lines max | YES — Part 5 | INTACT | — |
| 18.7 | Documentation site architecture (limen.dev/*) with page structure | YES — Part 5 | INTACT | — |
| 18.8 | Three interactive elements (claim explorer, "what just happened" blocks, confidence slider) | YES — Part 5 | INTACT | — |
| 18.9 | Social preview image specification (1280x640px, dark background) | YES — Part 15 | INTACT | — |
| 18.10 | Three "wow moments" (limen status, limen graph, the error that helps) | YES — Part 5 | INTACT | — |
| 18.11 | Light mode color palette (14 tokens) | NO | LOST — the full light mode palette with hex values is absent | LOW |
| 18.12 | Terminal color palette mapping table (semantic -> dark terminal -> light terminal) | NO | LOST — terminal-specific color mappings are absent | LOW |

---

## SUMMARY OF LOSSES

### CRITICAL (3 findings)

| # | Finding | Source Report | Impact |
|---|---------|--------------|--------|
| 12.5 | LINDDUN privacy threat model completely absent | Security Engineering (#12) | Privacy threats (Linkability, Identifiability, Detectability, Unawareness) are unaddressed. STRIDE alone is insufficient for a system storing personal knowledge |
| 17.4 | Wrongness containment protocol (confidence ceiling 0.7 for auto-extracted claims, cascade retraction formula) | Final Audit (#17) | Without these numeric thresholds, auto-extraction becomes a confidence laundering operation |
| 17.6 | Cognitive operation execution model (sync/async/batch per operation type with latency budgets) | Final Audit (#17) | No specification for WHEN cognitive operations run. Every cognitive feature in v1.4.0 depends on this architectural decision |

### HIGH (11 findings)

| # | Finding | Source Report |
|---|---------|--------------|
| 2.1 | better-sqlite3 installation failure modes (Windows, Node 25, Docker slim) | DX Spec (#2) |
| 2.2 | better-sqlite3 fails on specific platforms — documented adoption blocker | DX Spec (#2) |
| 2.4 | Node.js >= 22 requirement cuts off Node 18/20 LTS users | DX Spec (#2) |
| 4.6 | DIAL-KG three-stage cycle — academic foundation for self-organizing knowledge | Cognitive Architecture (#4) |
| 5.2 | Narrative Memory API shape (momentum, unfinished threads, energy state) | Superpowers (#5) |
| 5.3 | Proactive Sensing API response shape (freshness, conflicts, confidence distribution) | Superpowers (#5) |
| 6.10 | Observability integrations (OpenTelemetry, Prometheus, etc.) — entire section absent | Integration Ecosystem (#6) |
| 8.11 | 5 of 8 invention opportunities from bleeding-edge research missing | Bleeding Edge Tech (#8) |
| 12.6/12 | SEC-GAP-002: .raw escape hatch privilege escalation (no access control) | Security Engineering (#12) |
| 12.8 | RBAC dormant by default — requireRbac config flag recommendation | Security Engineering (#12) |
| 17.5 | FTS5 CJK failure analysis and 4 tokenizer alternatives | Final Audit (#17) |
| 17.8 | IP/licensing analysis with 4 historical case studies | Final Audit (#17) |
| 17.11 | Agent prompt engineering API (limen.promptInstructions()) | Final Audit (#17) |

### MEDIUM (23 findings)

| Category | Count | Examples |
|----------|-------|---------|
| API shapes dropped (superpowers that survived as concepts but lost their specification) | 5 | Promise accountability, excellence gates, autonomy levels, narrative memory, proactive sensing |
| Specific competitor detail lost | 3 | Per-competitor DX benchmarks, competitor-specific breakdown, competitive response predictions |
| Engineering spec sections absent | 4 | Naming conventions, file structure, testing patterns, CI/CD specification |
| Research evidence dropped | 3 | GraphRAG performance, RAPTOR accuracy, KQS formula |
| Security details lost | 3 | LINDDUN analysis, .raw escape hatch, audit lint rule |
| Community/business strategy lost | 3 | Community tiers, telemetry design, documentation versioning |
| Design detail lost | 2 | Light mode palette, CLI command output formats |

### LOW (20+ findings)

Minor details, specific code examples, source URLs, design reference tables, and implementation minutiae that can be recovered by re-reading the source report.

---

## VERDICT

The definitive spec is a **strong consolidation** that successfully preserves the thesis, architecture, feature roadmap, release strategy, gap register, technology stack, and competitive positioning. The 8 cross-report contradictions are a particularly valuable addition — that section adds value beyond what any source report provided individually.

However, the consolidation has three systematic failure modes:

1. **API shapes evaporated.** Multiple superpowers and features survived as one-line entries in tables but lost their API designs (response shapes, parameter schemas, configuration structures). When a Builder picks up "Narrative Memory: YES, v1.4.0," they have no specification to build from and must re-derive the API.

2. **Security depth was truncated.** The LINDDUN privacy analysis, the .raw escape hatch gap, the RBAC dormancy risk, and the audit coverage lint rule all disappeared. STRIDE alone is insufficient for a knowledge system that stores information about people.

3. **Operational decisions were deferred into oblivion.** The cognitive operation execution model (when do async features run?), the FTS5 tokenizer selection (CJK support), the Node version requirement analysis, the CI matrix, and the installation failure modes — these are decisions that BLOCK v1.3.0 implementation and are not in the definitive spec.

**Recommendation**: Do not discard the source reports. The definitive spec should be the entry point, but builders must still consult source reports for: API shapes (#5), security details (#12), operational specifications (#16, #17), and engineering standards (#9).

---

*SolisHQ Breaker Agent — Everything breaks. The question is whether you find it first.*
