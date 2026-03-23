# Changelog

All notable changes to Limen are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-23

### Added
- Cognitive Operating System: deterministic infrastructure hosting stochastic cognition
- Four-layer architecture: Kernel (L1), Substrate (L1.5), Orchestration (L2), API (L4)
- 16 system calls defining the governance boundary between agents and infrastructure
- 99 formally verified invariants enforced by 3,100+ tests
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
