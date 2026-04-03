# Changelog

All notable changes to Limen are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-04-03 (THINK)

### Added
- **Phase 11: Vector Search** — semantic search via `sqlite-vec` (optional dependency). Hybrid search combining FTS5 keyword + vector similarity. Duplicate detection before storage with configurable similarity threshold. Embedding queue with `embedPending()` for batch processing. `embeddingStats()` for monitoring. Falls back to full-text search when `sqlite-vec` is unavailable.
- **Phase 12: Cognitive Engine** — self-healing retraction cascades (opt-in, disabled by default). Consolidation engine: merge similar claims, archive stale claims, suggest contradiction resolutions with dry-run mode. 5-factor importance scoring (recency, confidence, connections, access, centrality). KNN-based auto-connection suggestions via embedding similarity with accept/reject workflow. Mission-scoped narrative snapshots. External verification provider integration (advisory only, never mutates claims).
- `limen.semanticSearch(query, options?)` — async semantic search via embedding provider.
- `limen.checkDuplicate(subject, predicate, value)` — pre-storage duplicate detection.
- `limen.embedPending()` — process embedding queue for pending claims.
- `limen.embeddingStats()` — embedding pipeline statistics.
- `limen.cognitive.consolidate(options?)` — merge, archive, suggest resolutions.
- `limen.cognitive.importance(claimId, weights?)` — composite importance score.
- `limen.cognitive.narrative(missionId?)` — knowledge state snapshot.
- `limen.cognitive.verify(claimId)` — external claim verification (async).
- `limen.cognitive.suggestConnections(claimId)` — KNN relationship suggestions.
- `limen.cognitive.acceptSuggestion(id)` / `rejectSuggestion(id)` — suggestion workflow.
- `selfHealing` configuration: `{ enabled, autoRetractThreshold, maxCascadeDepth }`.
- `vector` configuration: `{ provider, dimensions }`.
- Migration v036 (cognitive engine tables: connection_suggestions, consolidation_log).

### Changed
- **BREAKING:** `SearchOptions.mode` now includes `'semantic' | 'hybrid'` alongside existing `'fulltext'`.
- **BREAKING:** Major version bump signals cognitive capabilities. No breaking API removals — all v1.x APIs continue to work.
- `sqlite-vec` added as optional dependency (not required for core functionality).

## [1.5.0] - 2026-04-03 (GOVERN)

### Added
- **Phase 9: Security Hardening** — PII detection engine with configurable patterns (emails, phone numbers, SSNs, credit cards). Claim content sanitization against prompt injection patterns. FTS5 query injection defense. Subject/predicate URI format validation. Sensitivity levels controlling enforcement (block, redact, log). Consent tracking API (`limen.consent`) with CRUD operations, expiry computation on read, and audit trail on all mutations.
- **Phase 10: Governance Suite** — Data classification engine with configurable rules. Protected predicate system preventing unauthorized mutation of critical knowledge domains. GDPR Article 17 erasure with cryptographic certificate generation (`limen.governance.erasure()`). SOC 2 Type II audit package export (`limen.governance.exportAudit()`). Classification rule management (`addRule`, `removeRule`, `listRules`). Protected predicate management (`protectPredicate`, `listProtectedPredicates`).
- `limen.consent.register()` / `revoke()` / `check()` / `list()` — consent lifecycle management.
- `limen.governance.erasure()` — GDPR erasure with audit certificate.
- `limen.governance.exportAudit()` — SOC 2 compliance export.
- `limen.governance.addRule()` / `removeRule()` / `listRules()` — classification rule management.
- `limen.governance.protectPredicate()` / `listProtectedPredicates()` — predicate access control.
- Migrations for security tables and governance tables.

### Changed
- Security controls applied at the claim assertion boundary — PII detection and injection defense run before storage, not after.

## [1.4.0] - 2026-03-31

### Added
- **Structural conflict detection** — auto-creates `contradicts` relationships when new claims conflict with existing same-subject+predicate claims. Contradiction-triggered review for high-confidence (≥0.8) claims.
- **Cascade retraction** — `derived_from` claims penalized at query-time: 0.5× first-degree, 0.25× second-degree. CONSTITUTIONAL multipliers. Composes with decay: `final = confidence × decay × cascade`.
- **Retraction reason taxonomy** — `incorrect | superseded | expired | manual`. Validated on retraction.
- **`requireRbac` config** — when true, all operations require valid agent role. Default: false (backward compatible).
- **`.raw` access gating** — audit-logged, requires `rawAccessTag` when RBAC active.
- **`reasoning` column** — optional free-text reasoning on claims, immutable per CCP-I1.
- **`limen.cognitive.health()`** — CognitiveHealthReport: total claims, freshness distribution, conflict count, confidence stats, gap detection, stale domains.
- **Gap detection** — identifies predicates with no recent claims.
- **Stale domain detection** — identifies predicates with no recent access.
- Migrations v40 (conflict index), v41 (reasoning column).

### Changed
- `forget()` now accepts typed `reason` parameter from taxonomy.
- `effectiveConfidence` now includes cascade penalty alongside decay.
- Search score formula: `effectiveConfidence × BM25` (includes cascade).

## [1.3.0] - 2026-03-31

### Added
- **Convenience API** (`remember`, `recall`, `forget`, `connect`, `reflect`, `promptInstructions`) — the thesis becomes accessible. 3 lines to store a belief. Full engineering controls: Design Source, Breaker pass, Certifier gate.
- **FTS5 Full-Text Search** (`search`) — find beliefs by content. Primary index (`unicode61` tokenizer) for Latin/Cyrillic, secondary index (`trigram`) for CJK and substring matching. External content mode (zero data duplication). Tenant-scoped. FTS5 query injection sanitized.
- **Cognitive Metabolism** — beliefs that breathe. FSRS power-decay formula `R(t) = (1 + t/(9*S))^(-1)` computed on every read, never stored. `effective_confidence` returned alongside raw `confidence`. Freshness classification (Fresh/Aging/Stale). Access tracking with batched flush. `minConfidence` filters by decayed confidence.
- **Wrongness containment** — `maxAutoConfidence` ceiling (default 0.7) prevents confidence laundering. Auto-extracted claims cannot start above 0.7 unless human-verified via `evidence_path` grounding.
- **Stability per claim** — predicate-based stability assignment: governance 365d, architectural 180d, finding 90d, warning 30d, ephemeral 7d, preference 120d. Configurable patterns.
- `retractClaim` on `ClaimApi` — programmatic claim retraction with audit trail.
- `searchClaims` on `ClaimApi` — programmatic FTS5 search with BM25 ranking.
- Migrations v37 (FTS5 primary + triggers), v38 (FTS5 CJK trigram + triggers), v39 (cognitive metabolism columns).
- 235 new tests (3,188 → 3,423). Every test through A21 dual-path (success + rejection).

### Changed
- npm description updated to "Governed knowledge engine for AI agents."
- npm keywords expanded for discoverability.
- `BeliefView` extended with `effectiveConfidence`, `freshness`, `stability`, `lastAccessedAt`, `accessCount`.
- `SearchResult.score` now uses `effectiveConfidence * BM25` — old claims rank lower than fresh ones.
- `recall()` and `search()` return decay-aware results by default.

### Removed
- **Knowledge API stub** (`KnowledgeApi`, `KnowledgeApiImpl`, MCP knowledge tools) — dead code that returned `{ memoriesCreated: 0 }`. Replaced by the convenience API built through full engineering controls.

## [1.2.0] - 2026-03-28

### Added
- `setDefaultAgent` API for library-mode agent identity.
- MCP server: session adapter with knowledge tools (subsequently removed in v1.3.0).

## [1.1.0] - 2026-03-24

### Added
- Zero-config `createLimen()` — auto-detects LLM providers from environment variables, auto-generates dev master key, uses OS temp dir for storage
- Provider auto-detection for Anthropic, OpenAI, Gemini, Groq, Mistral, and Ollama from environment variables
- Proof pack: CI-governed evidence index at `docs/proof/` with 530 verified file:line references
  - `system-calls.md` — 16 system calls, all Verified with interface, implementation, and A21 test coverage
  - `invariants.md` — 134 invariants across 3 tiers (114 Verified, 1 Measured, 4 Implemented, 11 Declared, 4 Out of Scope)
  - `failure-modes.md` — honest accounting: 21 traceable defenses of 45 specified (12 Verified, 8 Implemented, 1 Declared)
  - `security-model.md` — 8 security mechanisms with evidence bindings and 25 declared non-protections
  - `readiness.md` — capstone trust surface with explicit non-proof boundaries
- `scripts/verify-proof-pack.ts` — CI enforcement script verifying proof pack file:line references stay fresh
- Eight progressive examples (01-hello through 08-governance-visible) replacing five original examples
- Demo vs Production getting-started split in `docs/getting-started.md`

### Changed
- `createLimen()` config parameter is now optional (zero-config when omitted)
- README restructured: zero-config hero section, "What's Running Underneath" reveal, Trust Surface with proof pack links
- Comparison table dated (March 2026) with narrowed claims and ecosystem context
- Invariant count corrected from 99 to 134 per proof pack evidence
- Examples 04 and 08 updated to use zero-config pattern
- CI workflow updated with proof pack freshness check

### Fixed
- Examples 04 (multi-provider) and 08 (governance-visible) no longer require explicit masterKey

## [1.0.0] - 2026-03-23

### Added
- Cognitive Operating System: deterministic infrastructure hosting stochastic cognition
- Four-layer architecture: Kernel (L1), Substrate (L1.5), Orchestration (L2), API (L4)
- 16 system calls defining the governance boundary between agents and infrastructure
- 99 continuously enforced invariants backed by 3,200+ tests
- SQLite foundation with WAL mode, ACID transactions, single dependency (`better-sqlite3`)
- Append-only, hash-chained audit trail recording every state mutation
- RBAC engine with role hierarchy and per-operation authorization
- AES-256-GCM encryption at rest with configurable master key
- Multi-tenant isolation (row-level or database-level)
- Mission/task execution framework with budget enforcement and checkpoints
- LLM gateway with raw HTTP transport — zero provider SDKs
- Six provider adapters: Anthropic, OpenAI, Google Gemini, Groq, Mistral, Ollama
- Streaming with stall detection, first-byte timeout, and total stream timeout
- Circuit breakers and exponential backoff on provider communication
- Structured output with JSON Schema validation and auto-retry
- Session management with conversation history and auto-summarization
- Working memory (task-scoped ephemeral state)
- Claim Protocol for structured knowledge with provenance (assert, relate, query)
- Reference agent demonstrating autonomous mission execution via system calls
- LLM-augmented task decomposition with heuristic fallback (I-16 graceful degradation)
- LLM-preferred checkpoint assessment with deterministic action governance
- Artifact dependency cascading with STALE flag propagation
- Goal drift detection via TF-IDF cosine similarity at checkpoints
- Trust progression state machine (untrusted → probationary → trusted → admin)
- Agent persistence across engine restarts
- Learning system with technique extraction and EMA scoring
- Latency harness with per-phase budget enforcement (hot-path ≤ 103ms P99)
- Cost tracker with per-session overhead monitoring
- Webhook delivery with HMAC-SHA256 signing, exponential backoff, SSRF defense
- Deterministic replay engine for reproducing execution from recorded LLM outputs
- Mission recovery on engine restart
- Data retention scheduler with configurable per-type policies
- Periodic WAL checkpoint timer (5-minute PASSIVE checkpoint)
- Startup health gate blocking initialization if kernel is unhealthy
- Structured logging callback in configuration
- Three independent export paths: engine, reference-agent, transport
- Five runnable examples: basic-chat, multi-provider, sessions, structured-output, transport-standalone
