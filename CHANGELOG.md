# Changelog

All notable changes to Limen are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
