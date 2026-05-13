# SOLISFORGE PROTOCOL v1.4

**Sovereign Engineering System for Complex Systems**

**Date:** May 8, 2026
**Version:** 1.4 (Final Remediation — All Breaker Findings Closed)
**Status:** RATIFIED — Effective May 8, 2026. Breaker CLEAN (6 rounds) + Certifier GO + Witness 86/100.
**Owner:** Senior Head of Engineering, SolisHQ

---

## 0. Bootstrap Declaration

*Note: This section documents how SolisForge governs itself. Practitioners starting a new project should begin reading at §1 (First Principles) for the operational content.*

SolisForge must govern itself. This document was developed under its own principles:

- **Intent:** Make governed engineering structurally reliable across all SolisHQ domains (Principle 1-10 derivation).
- **Adversarial verification:** Four Breaker rounds (v1.1: 31 findings/7 P0, v1.2: zero changes rejected, v1.3: 20 findings/2 P0, v1.4: this remediation). Each round produced independent findings from dispatched Breaker agents.
- **Amendment evidence:** v1.1→v1.3 amendments driven by real project experience (voice synthesis, MCP server, governance protocol development), not theoretical concerns.
- **Ratification:** Pending Femi approval upon Breaker CLEAN verdict on v1.4.

**Governing artifacts for SolisForge itself:**
- Intent Record: This document §2 (Core Philosophy) serves as the Intent Record — why SolisForge must exist.
- Property Derivation: §1 (First Principles) — the 12 immutable properties the system must satisfy.
- Failure Mode Atlas: The engineering failures enumerated in §2.1 (originating from project experience through May 7-8, 2026) constitute the failure modes SolisForge is designed to prevent. Each principle in §1 maps to a failure mode it addresses.
- Contract Specification: The Forge Cycle (§6), Severity Classification (§5), and Enforcement Mechanisms (§9) are the contract.
- Adversarial Verdict: Four Breaker rounds (documented above).

SolisForge is the first artifact governed by SolisForge. Its own artifacts are embedded within it rather than separate files — this is acceptable for a meta-governance document where the subject and the governance are the same artifact.

---

## 1. First Principles (Immutable)

These axioms cannot be amended. They apply to every domain.

1. **Truth before speed.** A system that is fast but false is dangerous.
2. **Evidence over confidence.** Claims without verifiable proof have no authority.
3. **Interfaces before implementation.** Every boundary must be specified and attacked before realization.
4. **Failure modes define structure.** How a system can fail reveals what it must be.
5. **Adversarial verification is mandatory.** No claim survives without being attacked.
6. **Traceability is structural.** Every artifact links bidirectionally to its authorizing truth.
7. **Role separation is absolute.** Builder ≠ Breaker ≠ Certifier ≠ Witness ≠ Orchestrator.
8. **Self-audit is required.** The system must examine and improve itself.
9. **Zero residual.** No finding, no assumption, no debt remains.
10. **Disruption through precision.** Build correctly. Then build faster. Never reverse the order.
11. **Evidence over document.** When reproducible evidence proves a specification wrong, the specification is amended — not reality.
12. **Execution reveals truth.** Paper audits have diminishing returns. The test stand is the ultimate verifier.

---

## 2. Scope and Supersession

SolisForge is project-agnostic. It governs software, hardware, AI systems, organizational processes, and any future domain.

**Supersession:** SolisForge supersedes Premier Engineering Standard v2.2 and all prior governance documents for new projects initiated after ratification. Existing projects may transition at the Orchestrator's discretion.

### 2.1 Failure Modes That Motivated SolisForge

These are the specific engineering failures that SolisForge is designed to prevent. Each maps to a First Principle that addresses it.

| Failure | What Happened | Preventing Principle |
|---------|--------------|---------------------|
| Aspirational ratification | Documents declared "RATIFIED" without adversarial review | Principle 5 (adversarial mandatory) |
| Version drift | Multiple versions of the same spec coexisted with contradictions | Principle 6 (traceability) |
| Remediation loops | Same defect class found across 6+ Breaker rounds without convergence | §7 (convergence criteria) |
| Spec-to-system gap | All components passed individually but system didn't function as specified | Principle 12 (execution reveals truth), Phase 5.5 |
| False production ready | System declared ready with critical components unwired | §6 Phase 5.5 (test stand) |
| Document contradicting physics | Specification prescribed equations that were physically incorrect | Principle 11 (evidence over document) |
| Builder ignoring locked spec | External contributor built against rejected documents, not the certified brief | §4 (External Contributor Rule) |
| Silent architectural decisions | Decisions made inline without documentation or rejected-alternative analysis | §6 Phase 4 (Architecture Decision) |
| Governance without proportionality | Same rigor applied to a typo fix and a new product | §3 (Governance Tiers) |

### Disposition of Prior Mechanisms

Every mechanism from v2.2 and the Engineering Constitution is explicitly accounted for. Nothing is silently dropped.

| Prior Mechanism | Disposition | SolisForge Location |
|----------------|-------------|-------------------|
| Zero-Residual Law | ABSORBED | Principle 9, §9 |
| Role separation (B/Br/C/W/O) | ABSORBED | §4 |
| Contract-First derivation | ABSORBED | §9 Contract-First Gate |
| Bidirectional traceability | ABSORBED | Principle 6, §11 |
| Monotonicity enforcement | ABSORBED | §8.1 amendment constraint |
| Change Control Board | ABSORBED | §8 amendment process |
| LCI meta-cohesion | RETIRED | Replaced by Traceability Matrix (§11) |
| Parity Engine | RETIRED | Replaced by contract-checking at Phase 6 |
| QAL levels | RETIRED | Replaced by Governance Tiers (§3) |
| Worktree Guardian | RETIRED | Replaced by Continuity Artifact (§10) |
| Oracle Gates (OG-CONSULT, OG-REVIEW, OG-VERIFY) | ABSORBED | Integrated into Forge Cycle Phases 3, 6, 7 |
| Amendment 25 predicates | ABSORBED | §10 Self-Audit (lessons, patterns, warnings captured in Continuity Artifact) |
| HB-34 to HB-38 hard bans | ABSORBED | §9 enforcement mechanisms (each hard ban maps to a specific gate) |
| Hook-based session lifecycle | ABSORBED | §10 Continuity Artifact replaces hook-dependent state |
| Dispatch brief provenance | ABSORBED | §9 Traceability Enforcement |
| HB-26 dispatch role declaration | ABSORBED | §4 Role Separation (role declared in every dispatch prompt) |
| Builder standing orders | ABSORBED | §4 Role Separation + §9 Contract-First Gate |
| Breaker-Certifier enforcement | ABSORBED | §6 Forge Cycle (sequential phases, role separation enforced) |
| No grandfathering | ABSORBED | §8.1 monotonicity constraint applies to amendments |
| Bootstrap law | ABSORBED | §0 Bootstrap Declaration + §6 Phase 0 |

---

## 3. Governance Tiers (Proportional Rigor)

| Tier | When | Required Artifacts | Required Phases | Certifier Required? |
|------|------|-------------------|-----------------|-------------------|
| **Forge Critical** | New system, security-critical, architectural change, protocol amendment | All 11 | All (0-10) | YES |
| **Forge Standard** | New feature, significant modification, integration | Intent, Contract, Adversarial (contract), Architecture Decision, Implementation, Adversarial (implementation), Certifier, Ratification | 0, 2, 3, 4, 5, 5.5, 6, 7, 9 | YES |
| **Forge Light** | Bug fix, docs, config, dependency | Contract (diff), Implementation, Adversarial, Certifier (lightweight) | 2, 5, 6, 7 | YES (lightweight) |

**Tier assignment:** Orchestrator assigns before work begins. Breaker can escalate tier if scope exceeds assignment.

### 3.1 Forge Light Certifier Rules

The Forge Light Certifier operates under a reduced scope:
- Verifies ONLY that the specific target finding is closed and no regressions were introduced
- NOT a full contract-clause audit
- If the Certifier discovers incidental findings beyond the target fix: findings are logged and trigger a Forge Standard cycle before the next merge to a governed branch
- This ensures lightweight governance for small fixes while preventing undetected regressions from accumulating

### 3.2 Forge Critical for Non-Code Artifacts

Phases 5, 5.5, and 6 reference "running implementation." For Forge Critical artifacts that are documents (protocol amendments, governance specifications, organizational processes):
- Phase 5 = produce the artifact (the document IS the implementation)
- Phase 5.5 = apply the artifact to a real scenario (walkthrough: take a concrete example project and trace it through the proposed governance changes — this IS the test stand for documents)
- Phase 6 = Breaker attacks the document AND the walkthrough results

---

## 4. Role Separation

| Role | Responsibility | Forbidden Actions |
|------|---------------|-------------------|
| **Builder** | Creates artifacts and implementation | Cannot certify or witness own work |
| **Breaker** | Attacks artifacts with maximum hostility | Cannot fix what they break |
| **Certifier** | Verifies evidence completeness and correctness | Cannot be Builder or Breaker on same artifact |
| **Witness** | Experiences artifact from ignorance, scores quality | Cannot participate in creation or review |
| **Orchestrator** | Owns system, dispatches roles, makes design decisions, remediates when authorized by Femi or by explicit scope grant in the governing brief | Cannot inline Breaker/Certifier/Witness verdicts — must dispatch as independent agents |

**AI Agent Rule (Practical):**
Role separation is preserved through independent agent dispatches with distinct prompts. Within a single session, the Orchestrator dispatches each role as a separate sub-agent invocation. The Orchestrator reads the returned verdict but does not produce it. This is prompt-level separation — the strongest form achievable in a single-session AI architecture.

**External Contributor Rule:**
All externally-authored artifacts pass a Prompt Audit Gate before integration. The Orchestrator verifies: alignment with locked governing brief, no regressions, no contradictions, no version drift. Findings are documented before any work proceeds on the contribution.

---

## 5. Severity Classification

| Severity | Definition | Blocking Behavior |
|----------|-----------|-------------------|
| **P0** | System cannot function, crashes, wrong output, security breach, or contract violation that makes the artifact unbuildable | Must fix before ANY progression |
| **P1** | System functions but violates a governing contract, breaks a safety/correctness guarantee, or has a gap that will cause failure at next phase | Must fix before phase exit |
| **P2** | Engineering tradeoff, performance concern, spec gap that affects quality but not correctness | Fix in parallel with ongoing phases — must close before ratification (Phase 9). A P2 found during Phase 5 does NOT block Phase 6 Breaker, but the Breaker is informed of the open P2 and may classify related findings accordingly. |
| **P3** | Documentation gap, cosmetic issue, parameter mismatch with no behavioral impact | Fix before ratification |

**Breaker Verdicts:**
- **CLEAN:** Zero P0, zero P1
- **CONDITIONAL GO:** Zero P0, P1s with defined fix path
- **NO-GO:** Any P0 exists

Note: severity definitions are domain-agnostic. "Security breach" means different things for a payment system vs a voice synthesizer — the Breaker applies domain context when classifying.

---

## 6. The Forge Cycle

### Unit of Application

One Forge Cycle governs one **deliverable** — a coherent unit of work with a defined outcome. Examples: a new product (Forge Critical), a new feature within a product (Forge Standard), a bug fix (Forge Light). Multiple features within the same product each get their own cycle at their assigned tier. A single cycle does not span multiple unrelated deliverables.

### Phase Entry Conditions (Mandatory)

Each phase has entry conditions that MUST be verified before the phase begins. A phase dispatched without its predecessor's exit artifact is a P0 governance violation.

| Phase | Entry Condition |
|-------|----------------|
| 0 | Problem statement exists |
| 1 | Phase 0 artifacts (Intent Record, Property Derivation) exist |
| 2 | Phase 1 artifact (Failure Mode Atlas) exists |
| 3 | Phase 2 artifact (Contract Specification) exists |
| 4 | Phase 3 artifact (Adversarial Verdict on contract, convergence achieved) exists |
| 5 | Phase 4 artifact (Architecture Decision) exists |
| 5.1 | Phase 5 slice(s) built (optional gate) |
| 5.5 | Phase 5 complete (all slices built), Independent Test Suite exists |
| 6 | Phase 5.5 artifact (Test Stand observations showing system runs) exists |
| 7 | Phase 6 artifact (Adversarial Verdict on running implementation, convergence achieved) exists |
| 8 | Phase 7 artifact (Certifier Evidence with GO verdict) exists |
| 9 | Phase 8 artifact (Witness Testimony with score ≥ 80/100) exists |
| 10 | Phase 9 artifact (Ratification Record) exists |

The Orchestrator MUST verify entry conditions in FORGE-GATE.md (see A-16) before dispatching any phase's role. The artifact tracker in FORGE-GATE.md is the verification mechanism.

### Phase 0 — Intent & Property Derivation

Why does this system exist? What must be true? What invariants must hold?

**Consumes:** Problem statement, domain constraints, stakeholder requirements.
**Produces:** Intent Record, Property Derivation.

**Minimum Intent Record contains:**
1. One-paragraph purpose statement (why this deliverable exists)
2. Success definition (what "done" looks like, measurable)
3. Scope boundary (what is in, what is explicitly out)
4. Constraints inherited from prior phases or governing artifacts

**Minimum Property Derivation contains:**
1. Enumerated invariants (what must remain true at all times)
2. Non-goals (what the system intentionally does NOT handle — these become Known Limitations in §10)
3. Quality targets (measurable thresholds for acceptance)

### Phase 1 — Failure Mode Atlas

Every way the system can fail, explicitly named. Each failure mode maps to a property that prevents it.

**Consumes:** Property Derivation from Phase 0.
**Produces:** Failure Mode Atlas.

### Phase 2 — Contract Specification

Interfaces, data types, message schemas, parameter ranges — every boundary explicit.

**Consumes:** Intent Record, Property Derivation, Failure Mode Atlas.
**Produces:** Contract Specification.

### Phase 3 — Adversarial Contract Attack

Breaker attacks the contract for ambiguities, contradictions, missing failure modes, dimensional mismatches.

**Consumes:** Contract Specification + all foundational artifacts (Intent, Properties, FMA).
**Produces:** Adversarial Verdict (on contract).

### Phase 4 — Architecture Decision

Chosen path with evidence. Rejected alternatives documented with reasoning.

**Consumes:** Contract Specification (Breaker-verified).
**Produces:** Architecture Decision.

### Phase 5 — Implementation

Build strictly against the ratified contract. No deviations without formal amendment.

**Consumes:** Contract Specification, Architecture Decision.
**Produces:** Implementation Spec, code.

### Phase 5.5 — Test Stand (Execution Gate)

Run the system. Generate real output. Observe behavior.

**Consumes:** Running implementation.
**Produces:** Test Stand observations (appended to Implementation Spec).

**Test Stand observation criteria** (what execution reveals that paper cannot):
- Integration failures (components that pass individually but fail together)
- Performance under real conditions (latency, memory, throughput)
- Perceptual quality (for systems with human-observable output)
- Error handling under real inputs (not just edge cases from specification)
- Resource consumption (memory leaks, CPU spikes, disk growth)

**Exit criteria:** System executes end-to-end AND produces output consistent with its purpose. "Consistent with purpose" means: if it's a synthesizer, it produces audio; if it's a server, it handles requests; if it's a process, it produces the specified artifact. Quality may be pre-production but functionality must be demonstrated.

### Phase 6 — Adversarial Implementation Attack

Breaker attacks the RUNNING code (not static review only — the system must be executable per Phase 5.5). Checks compliance with contract, correctness, security, integration, edge cases, performance.

**Consumes:** Running implementation + Contract Specification + all prior artifacts. The Breaker receives the contract as the standard and the running code as the subject.
**Produces:** Adversarial Verdict (on implementation).

### Phase 7 — Certifier Evidence Gate

Certifier verifies: every contract clause implemented, every Breaker finding closed, every test passes. If verdict is GO WITH CONDITIONS: the Builder resolves each condition. If the resolution involves **code changes**, the changed code must pass a targeted Breaker re-attack (Phase 6 scoped to the changed code only — Breaker produces a SCOPED VERDICT covering only the changed surface, using the same CLEAN/CONDITIONAL GO/NO-GO taxonomy). If the resolution involves **documentation or configuration changes only**, the Certifier performs a targeted re-check without Breaker re-attack.

**Consumes:** Implementation + Adversarial Verdict + Contract.
**Produces:** Certifier Evidence.

### Phase 8 — Witness Gate

Witness experiences the system from ignorance. Scores across 10 dimensions, each 0-10:

1. **Clarity** — do I understand what this is after one read?
2. **Actionability** — can I follow this without asking "what does this mean"?
3. **Proportionality** — does governance scale to risk?
4. **Role clarity** — do I know who does what?
5. **Severity clarity** — can I classify a finding without debating?
6. **Amendment safety** — can I fix a wrong spec without breaking governance?
7. **Convergence confidence** — will the adversarial cycle end?
8. **Practical overhead** — does this help me build or drown me in paper?
9. **Self-consistency** — does it contradict itself?
10. **Day-one confidence** — can I start tomorrow?

**Threshold:** ≥ 80/100 with zero friction points above P1.
**Produces:** Witness testimony with per-dimension scores and friction point list.

**Note:** CONDITIONAL GO from Breaker (zero P0, P1s with fix path) counts as "zero P0" for convergence purposes per §7.

### Phase 9 — Ratification & Continuity
Founder approval. Continuity Artifact produced. System is locked. All P0-P3 findings must be closed (Zero-Residual).
**Produces:** Ratification Record, Continuity Artifact

### Phase 10 — Self-Audit & Improvement
What worked? What failed? What should change in SolisForge? Improvements proposed as Protocol amendments.

---

## 7. Convergence Criteria

The adversarial cycle must converge. It cannot loop forever.

**Phase convergence (gates Phase progression):**
1. Zero P0 for 2 consecutive Breaker rounds, AND
2. Zero NEW P1 in the most recent round, AND
3. Total finding count is non-increasing across the last 2 rounds

**Anti-oscillation rule:** A finding is "new" if it identifies a defect NOT PRESENT in any prior Breaker report — regardless of which code path it's on. Two findings on the same file are both "new" if they describe different defects (e.g., a sign error and a stability issue are different defects even if both are in the same component file). A finding is "recurrent" if it describes the same defect class that was previously found and supposedly fixed — this counts against convergence.

**Ratification convergence (gates final approval — stricter):**
All findings P0 through P3 must be closed. This is Zero-Residual. Phase convergence gets you to Phase 9. Ratification convergence gets you through Phase 9.

**These are different scopes:**
- Phase convergence: "Can we move to the next phase?" (zero P0, few P1)
- Ratification convergence: "Can we lock this system?" (zero everything)

**Worked example:**
- Round 1: 7 P0, 5 P1, 3 P2 → NO-GO. Total: 15.
- Round 2: 0 P0, 2 P1, 4 P2 → CONDITIONAL GO. Total: 6. Zero P0 (round 1 of 2 needed).
- Round 3: 0 P0, 0 new P1 (2 prior P1s fixed), 3 P2 (1 new) → CLEAN. Total: 3. Zero P0 (round 2 of 2). Zero new P1. Non-increasing (3 ≤ 6). **Phase convergence reached.**
- P2s close before Phase 9 (ratification convergence).

**Escalation:**
- After 4 Breaker rounds without phase convergence: mandatory methodology self-audit
- After 6 rounds: escalate to Femi — structural problem

---

## 8. Amendment Process

### 8.1 Artifact Amendment

**Trigger:** Reproducible evidence (Breaker finding, test stand observation, first-principles derivation, external research) proves a locked artifact is incorrect.

**Evidence standard:** The evidence must be reproducible (another person or agent following the same steps reaches the same conclusion) and falsifiable (there exists an observation that would disprove the claim). Opinion, intuition, and preference are not evidence.

**Process:**
1. Document the error with evidence
2. Orchestrator evaluates: is the evidence conclusive and reproducible?
3. If yes: draft amendment text with AMENDMENT NOTE (date, what changed, why, evidence reference)
4. Amendment is Breaker-reviewed
5. Femi ratifies

**Monotonicity constraint:** An amendment cannot reduce the defense set without specifying a compensating control. The defense set is the enumerated list of protections the system provides (security controls, quality gates, safety invariants, enforcement mechanisms). Each project defines its own defense set in its Property Derivation or Traceability Matrix.

**SolisForge's own defense set:** The 8 enforcement mechanisms in §9 (Contract-First Gate, Traceability Enforcement, Prompt Audit Gate, Negative Evidence Mandate, Zero-Residual Law, Methodology Self-Audit, Reality Anchor Gate, Test Stand Mandate) constitute SolisForge's defense set. No amendment to this protocol may remove any of these 8 without a documented compensating control.

### 8.2 Protocol Self-Amendment

SolisForge itself follows the same amendment process:
1. Propose change with evidence from project experience
2. Breaker attacks the proposed change
3. Femi ratifies
4. Version increments
5. Projects adopt at the next phase boundary — defined as the start of the next numbered phase in their current Forge Cycle (e.g., if a project is mid-Phase 5, it adopts the new protocol version at Phase 6 entry). In-progress phases are not retroactively re-governed.

---

## 9. Enforcement Mechanisms

| Mechanism | What It Does | When It Fires |
|-----------|-------------|---------------|
| **Contract-First Gate** | No implementation until contract is ratified | Before Phase 5 |
| **Traceability Enforcement** | Every public method links to a contract clause | Phase 6 Breaker check |
| **Prompt Audit Gate** | External artifacts checked against locked brief | Every external contribution |
| **Negative Evidence Mandate** | Breakers must demonstrate that specific failure modes from the Failure Mode Atlas do NOT occur. Method: for each critical failure mode, construct an attack that would trigger it. If the attack fails (the system resists), that is negative evidence. If the attack succeeds, that is a finding. This is testable, not philosophical. | Phases 3 and 6 |
| **Zero-Residual Law** | No finding remains open at ratification | Phase 9 gate |
| **Methodology Self-Audit** | Analyze process failure when defects survive 2+ rounds | After 2 failed Breaker rounds |
| **Reality Anchor Gate** | "Is governance proportional to risk?" Triggered when overhead > 30% of effort or 3+ rounds yield only P2/P3. **Output:** Orchestrator documents proportionality assessment and takes one of: (a) reduce Breaker scope to targeted vectors, (b) invoke Test Stand instead of another paper round, (c) downgrade tier with Femi approval, (d) accept and proceed to Certifier. Decision documented in Adversarial Verdict. | Orchestrator invokes |
| **Test Stand Mandate** | System must run before certification | Phase 5.5 |
| 9 | **Count Integrity Gate** | No artifact governed by SolisForge may declare a count that is derivable from the artifact's own content (e.g., "§5 Tools — 113 Requirements"). Counts in section headers, summary tables, and cross-references MUST either be (a) omitted entirely, with the reader expected to count the table, or (b) computed by a verification script that runs before ratification. A hand-written count that disagrees with a machine count is a P1 finding. When Document A references a quantity from Document B, it MUST use the phrase "see [document]" rather than citing a number. If a number must be cited for context, it MUST be accompanied by "(verified [date])" and the verification script MUST re-check at ratification. | Every artifact review, every ratification |
| 10 | **Enumeration Completeness Rule** | No artifact governed by SolisForge may use "etc.", "and so on", "and more", "among others", or any equivalent trailing indicator in an enumeration that is intended to be exhaustive. If the enumeration is intentionally non-exhaustive, it MUST be labeled "(non-exhaustive)" with a reference to where the complete list lives. A Breaker finding "etc." in an exhaustive enumeration classifies it as P1. | Every artifact review |
| 11 | **CI Enforcement Gate** | Every project governed by SolisForge at Forge Standard or above MUST have automated CI (e.g., GitHub Actions, GitLab CI) that runs on every push and pull request to governed branches. The CI pipeline MUST include: (a) the traceability scanner (exit non-zero on violations), (b) defense-specific guards (e.g., grep for child_process/exec in source for D17, grep for RegExp in tool handlers for D18), (c) type checking, (d) full test suite. Manual-only scripts are NOT sufficient for enforcement. A project without CI enforcement is non-compliant regardless of script availability. | Project setup, every push/PR |

---

## 10. Continuity Artifact

Every ratified system must have a Continuity Artifact:

1. **Summary** — what this system is, current state (1 paragraph)
2. **Restart instructions** — exact steps to resume in a new session
3. **Locked artifacts** — governing documents with paths
4. **Forbidden actions** — what must NOT be done
5. **Open items** — remaining work with phase assignments
6. **Known limitations** — constraints that are genuinely accepted by design, not deferred findings. A known limitation is a boundary condition the system was intentionally designed NOT to handle (e.g., "does not support languages other than English"). This is distinct from Zero-Residual: an open finding is a defect; a known limitation is a scope boundary. The difference is intent — limitations are documented in the Property Derivation as explicit non-goals.

**Maximum length:** 500 words for standard systems. Complex systems (10+ components, multi-phase) may extend to 1000 words. If the artifact exceeds the limit, decompose the system into sub-systems with their own Continuity Artifacts.

---

## 11. Artifact Taxonomy

| Artifact | Purpose | Authority | Required Tier |
|----------|---------|-----------|---------------|
| Intent Record | Why this system must exist | Foundational | Critical, Standard |
| Property Derivation | Invariants and constraints | Foundational | Critical |
| Failure Mode Atlas | All failure paths | Foundational | Critical |
| Contract Specification | Interfaces, schemas, ranges | Authoritative | All tiers |
| Architecture Decision | Chosen path + rejected alternatives | Authoritative | Critical, Standard |
| Implementation Spec | How contract is realized | Authoritative | Critical, Standard |
| Traceability Matrix | Code ↔ contract links | Authoritative | Critical |
| Adversarial Verdict | Breaker findings | Verification | All tiers |
| Certifier Evidence | Quality gate proof | Verification | All tiers (lightweight for Forge Light) |
| Ratification Record | Founder approval | Final | Critical, Standard |
| Continuity Artifact | Restart path + constraints | Operational | Critical, Standard |

**Phase → Artifact mapping:**

| Phase | Produces |
|-------|---------|
| 0 | Intent Record, Property Derivation |
| 1 | Failure Mode Atlas |
| 2 | Contract Specification |
| 3 | Adversarial Verdict (contract) |
| 4 | Architecture Decision |
| 5 | Implementation Spec, code |
| 5.5 | Test Stand observations (appended to Implementation Spec) |
| 6 | Adversarial Verdict (implementation) |
| 7 | Certifier Evidence |
| 8 | Witness testimony |
| 9 | Ratification Record, Continuity Artifact |
| 10 | Self-Audit findings (fed to §8.2) |

**Machine verification:** Currently manual via Breaker + Certifier. Automated verification is a roadmap goal — as CI tooling is built, artifacts will gain automated checks. Claiming automated verification before the tooling exists is a false guarantee.

---

## 12. Cost Governance

Governance must not consume more effort than implementation.

**Overhead targets:**
- Forge Critical: ≤ 40% governance overhead
- Forge Standard: ≤ 25%
- Forge Light: ≤ 10%

**Measurement:** Governance overhead = governance effort / total effort. For AI-native workflows, count each agent dispatch (Breaker, Certifier, Witness) as one unit. Total effort = governance units + Builder units. For human workflows, use hours. The Orchestrator estimates at phase completion. Not a hard gate — a monitoring signal that triggers the Reality Anchor Gate when exceeded.

**Efficiency rules:**
- Breaker prompts should be targeted (specific attack vectors) not exhaustive
- If a round produces only P2/P3: invoke Reality Anchor before dispatching another round
- Prefer Test Stand (Phase 5.5) over additional paper Breaker rounds when convergence stalls

---

## 13. Operational Procedures

### 13.1 Incident Response

When a ratified system fails in production:
1. Immediate: contain the failure (rollback, disable, isolate)
2. Within 24 hours: root cause analysis INITIATED — which gate failed and why (complex RCAs may take longer but investigation must begin within 24 hours)
3. Within 48 hours: documented fix with Breaker verification (for P0/P1 severity incidents)
4. Within 1 week: methodology self-audit — should the Forge Cycle have caught this?

### 13.2 Rollback

Every ratified deployment must have a documented rollback procedure:
- Steps to revert to the last known-good state
- Maximum acceptable rollback time
- Data preservation requirements
- Triggers for automatic rollback (if applicable)

### 13.3 Metrics

| Metric | Target | Review |
|--------|--------|--------|
| P0 defect escape rate (P0 found after ratification) | 0 | Per release |
| P1 defect escape rate (P1 found after ratification) | < 2 per release | Per release |
| Breaker rounds to convergence | ≤ 3 | Per phase |
| Finding recurrence rate (same finding class in 2+ rounds) | < 10% | Per project |
| Governance overhead ratio | Within tier target | Per phase |
| Test stand pass rate (Phase 5.5 on first attempt) | > 80% | Per project |

---

## 14. Verdict Taxonomy

| Role | Verdicts | Progression Rule |
|------|----------|-----------------|
| Breaker | CLEAN / CONDITIONAL GO / NO-GO | Must reach CLEAN or CONDITIONAL GO |
| Certifier | GO / GO WITH CONDITIONS / NO-GO | Must reach GO (conditions resolved) |
| Witness | Score 0-100 | Must reach ≥ 80/100, zero friction above P1 |
| Ratification | RATIFIED / RATIFIED WITH AMENDMENTS / REJECTED | Femi final authority. RATIFIED WITH AMENDMENTS: Femi specifies required amendments, Builder applies them, amendments pass Breaker review per §8.1 before ratification is finalized. |

---

## 15. Final Doctrine

SolisForge treats the creation of complex systems as aerospace-grade engineering — tempered by the reality that iteration is how correctness is discovered.

We do not accept "good enough." We also do not accept "perfect on paper but never runs."

The test stand is the truth. The specification serves the test stand, not the other way around.

We move precisely. We build things that do not break. And when we discover they can break in ways we didn't predict, we amend the specification, fix the system, and forge forward.

---

**Document Status:** RATIFIED — Effective May 8, 2026. Breaker CLEAN (6 rounds) + Certifier GO + Witness 86/100.

---

## Appendix A — Traceability Matrix Template

The Traceability Matrix links every implementation artifact to its authorizing contract clause. Required for Forge Critical.

**Minimum structure:**

| Implementation Element | Contract Clause | Test | Breaker Verification |
|----------------------|----------------|------|---------------------|
| [function/module/component name] | [exact clause from Contract Specification] | [test name or test description] | [Breaker finding ID that verified it, or "not yet attacked"] |

**Rules:**
- Every row must have all 4 columns filled before ratification
- Every contract clause must appear in at least one row (no unimplemented clauses)
- Every implementation element must trace to a clause (no orphan code)
- "Not yet attacked" entries must be zero at Phase 7 exit

---

## Appendix B — Worked Example: Minimal Phase 0 Artifacts

**Scenario:** Building a CLI tool that converts CSV files to JSON.

### Intent Record (Minimal)

**Purpose:** Build a CSV-to-JSON converter that handles large files efficiently and produces standards-compliant JSON output.

**Success definition:** User runs `convert input.csv -o output.json` and receives valid JSON. Files up to 1GB are processed without OOM. Malformed CSV rows produce clear error messages, not crashes.

**Scope:**
- In: CSV parsing, JSON output, error handling, CLI interface
- Out: GUI, streaming output, database integration, format auto-detection

**Constraints:** Must run on Python 3.12+. No external dependencies beyond stdlib. Must handle UTF-8 and Latin-1 encodings.

### Property Derivation (Minimal)

**Invariants:**
1. Output is always valid JSON (parseable by any JSON parser)
2. No input CSV can crash the tool (all malformed input produces an error message)
3. Memory usage stays below 2× input file size

**Non-goals:**
- Excel format support (known limitation — CSV only)
- Streaming JSON output (entire output written at once)

**Quality targets:**
- Processing speed: ≥ 50MB/s on M1 Mac
- Error message clarity: every error includes line number and column

---

**End of SolisForge Protocol v1.4**
