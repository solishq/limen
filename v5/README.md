# Limen v5

**Structurally enforced cognitive trust for AI systems.**

## Status

- Architecture: **Candidate C — Hybrid (chain canonical + non-authoritative relational projection)**
- Specification: Document 27 v1.3 — **ratified** (Document 27d, May 1, 2026)
- Implementation: **Phase 1 authorized** (Profiles 1 and 2 only)
- Profiles 3, 4b, 5: **Not authorized** — requires Genesis Phase 2

## Workspace Structure

Eleven crates per Document 27 v1.3 Section 0.1. Forbidden dependency edges enforced at compile time and CI.

| Crate | Purpose |
|---|---|
| `limen_types` | Shared primitive types |
| `limen_foundation_contract` | Foundation operation trait, capabilities, envelopes, verdicts |
| `limen_foundation_ops` | Four concrete foundation operations |
| `limen_chain` | SQLite-backed chain storage and commit path |
| `limen_crypto` | Cryptographic key provider trait and Ed25519 software implementation |
| `limen_projection` | Projection storage, projector, certification |
| `limen_substrate_runtime` | Dispatcher, capability minting, sealed registry |
| `limen_canonical` | Canonical serialization |
| `limen_substrate` | Assembled substrate |
| `limen_api` | Public API surface |
| `limen_consensus` | Profile 3 consensus-replicated ChainReadContext implementation (Raft-based) |

## Governance

All implementation follows the SolisHQ Constitutional Development Methodology.
Every milestone requires Builder/Breaker/Certifier + founder ratification.
Specification amendments require a separate Builder/Breaker/Certifier cycle.
