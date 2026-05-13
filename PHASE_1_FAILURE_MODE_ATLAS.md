# PHASE_1_FAILURE_MODE_ATLAS.md

**Failure Mode Atlas** (SolisForge v1.5 — Phase 1, Ratified)

Every way Limen V5 can fail, explicitly named and mapped to an invariant it threatens. Derived first-principles from Phase 0 invariants.

| Failure Mode ID | Failure Mode Description | Threatened Invariant(s) | Preventing Principle (SolisForge §1) | Severity Potential |
|-----------------|--------------------------|--------------------------|-------------------------------------|--------------------|
| FMA-01 | Agent bypasses LimenAgentClient and writes directly to raw memory store | 1 | 4 (failure modes define structure) | P0 |
| FMA-02 | FSRS decay computation runs on write instead of every read → stale confidence values persist | 2 | 12 (execution reveals truth) | P1 |
| FMA-03 | Consent gate or classification filter is silently skipped during high-volume multi-agent coordination | 3 | 5 (adversarial verification mandatory) | P0 |
| FMA-04 | Refusal provenance for computer-use action is generated but not hash-chained into audit trail | 5 | 6 (traceability is structural) | P0 |
| FMA-05 | AdapterRegistry registration succeeds but subsequent framework calls (CrewAI/LangGraph) use stale session state instead of fresh LimenAgentClient | 4 | 3 (interfaces before implementation) | P1 |
| FMA-06 | Unified audit chain becomes query-unresponsive under concurrent agent load → real-time governance visibility collapses | 6 | 4 (failure modes define structure) | P1 |
| FMA-07 | Confidence auto-cap at 0.7 is overridden by an adapter or external contributor | 2 | 7 (role separation absolute) | P0 |
| FMA-08 | NonAuthoritative branching (multi-agent coordination) merges conflicting beliefs without provenance resolution → belief corruption | 1 & 3 | 5 (adversarial verification) | P1 |
| FMA-09 | Self-healing cascade triggers infinite loop on a decaying belief → resource exhaustion | 2 & 6 | 12 (execution reveals truth) | P1 |
| FMA-10 | Open-source contributor introduces patch that violates contracts-first rule → governance dilution | All | 9 (zero residual) + External Contributor Rule (§4) | P0 |
| FMA-11 | MCP tool access (computer-use) succeeds but sandbox is not enforced → arbitrary code execution | 5 | 5 (adversarial mandatory) | P0 |
| FMA-12 | Governance latency exceeds 50 ms under production load → agents prefer bypass for speed | Quality target | 10 (disruption through precision) | P2 |

**Atlas completeness note:** 12 exhaustive failure modes (no "etc." per §9.10). Each maps directly to Phase 0 invariants. Self-healing cascades (Invariant 2) explicitly covered in FMA-09.

**Ratified by:** Lanre — "approved" + "go"  
**Date:** May 13, 2026  
**SolisForge Phase:** 1