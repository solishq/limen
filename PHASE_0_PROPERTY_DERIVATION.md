# PHASE_0_PROPERTY_DERIVATION.md

**Property Derivation** (SolisForge v1.5 — Ratified)

**Invariants (must remain true at all times):**  
1. Every remember/recall/action flows through governed Core system calls (no direct bypass).  
2. Beliefs decay via FSRS power law computed on every read; confidence auto-capped at 0.7.  
3. Consent + classification + refusal provenance are non-optional and hash-chained.  
4. AdapterRegistry is thin and zero-core-change (any framework registers once).  
5. All computer-use actions produce mandatory provenance + sandbox audit.  
6. Unified audit chain is immutable and queryable in real time.  

**Non-goals (explicitly out — known limitations):**  
- Replacing vector DBs or raw memory stores.  
- Supporting non-agentic workflows.  
- Built-in monetization UI (enterprise pack is separate).  

**Quality targets:**  
- Governance latency ≤ 50 ms per claim.  
- Test Stand pass rate 100 % on live MCP refusal scenarios.  
- Witness score ≥ 90/100 on clarity/actionability.  
- Governance overhead ≤ 25 % (Forge Standard tier).

**Ratified by:** Lanre — "approved" + "go"  
**Date:** May 13, 2026  
**SolisForge Phase:** 0