# LIMEN GOVERNANCE PERFECTION

## The Complete Architecture for Self-Governing Cognitive Infrastructure

**Author:** SolisHQ Research Division
**Date:** 2026-03-30
**Classification:** Strategic Architecture Document
**Evidence Level:** Cross-referenced from 40+ regulatory sources, standards bodies, and academic research

---

## EXECUTIVE THESIS

Governance is Limen's moat. No competitor in the cognitive infrastructure space has it. But "governance" as currently understood — audit trails, RBAC, claim lifecycle, freshness tracking — is table stakes. Enterprise buyers in regulated industries (healthcare, finance, legal, government) need governance that **runs itself**. The competitive endgame is not "governance features" but a system where **non-compliance is structurally impossible**.

This document defines what PERFECT governance looks like: governance so deeply embedded that developers never think about it, compliance officers trust it completely, and regulators can verify it independently.

**The core insight:** Governance is not a feature layer on top of cognition. Governance IS the substrate. Limen already understands this — the kernel enforces tenant isolation, hash-chained audit, RBAC, and retention at the lowest level. The path to perfection is extending this principle to every dimension regulators and enterprises care about.

---

## PART 1: WHAT ENTERPRISES ACTUALLY NEED

### 1.1 The Regulatory Landscape (2026)

Seven regulatory frameworks converge on AI memory/knowledge systems in 2026. Each imposes requirements that Limen must satisfy structurally, not optionally.

#### EU AI Act (Enforceable August 2, 2026)

**What it requires for AI memory systems:**
- Risk classification of every AI system (unacceptable / high / limited / minimal)
- For high-risk systems: risk management, data quality documentation, technical documentation, transparency, human oversight, accuracy monitoring
- Transparency obligations: AI must disclose its artificial nature; decisions must be traceable
- Full data lineage tracking — knowing what datasets contributed to each output
- Human-in-the-loop checkpoints for workflows impacting safety, rights, or financial outcomes

**How Limen must behave:**
- Every claim must carry a risk classification tag (auto-assigned based on content domain and predicate)
- The trace system (already 32 constitutional events) must be extended to produce EU AI Act-compliant audit packages
- Claims derived from AI inference must be distinguishable from human-asserted claims
- Explainability must be structural, not bolt-on — every claim's derivation chain must be traversable

**Limen's current position:** STRONG. The trace event grammar, hash-chained audit, and evidence-grounded claims already provide the substrate. The gap is automatic risk classification and regulatory export formats.

**Confidence:** CONFIRMED — EU AI Act text is published law with August 2026 enforcement date.

**Penalties:** Up to 35M EUR or 7% of global annual turnover.

**Sources:** [EU AI Act Compliance Guide 2026](https://www.is4.ai/blog/our-blog-1/eu-ai-act-compliance-guide-2026-345), [LegalNodes EU AI Act 2026 Updates](https://www.legalnodes.com/article/eu-ai-act-2026-updates-compliance-requirements-and-business-risks), [Kennedys Law EU AI Act Timeline](https://www.kennedyslaw.com/en/thought-leadership/article/2026/the-eu-ai-act-implementation-timeline-understanding-the-next-deadline-for-compliance/)

---

#### GDPR Article 17 — Right to Erasure

**What it requires for AI memory systems:**
- Individuals can request deletion of personal data when no longer necessary
- AI systems that store personal data in knowledge graphs, claims, or memory must be able to erase it
- The challenge: once data influences a model or knowledge structure, traces may persist as correlations, embeddings, or derived claims

**How Limen must behave:**
- The tombstone mechanism (already implemented: `AuditTrail.tombstone()`) is the right architectural pattern
- Claims containing PII must be tagged at assertion time (auto-classification)
- Erasure must cascade: if Claim A contains PII and Claim B was `derived_from` Claim A, Claim B must be evaluated for PII contamination
- Hash chain integrity must survive tombstoning (already implemented via cascade re-hash)
- A "right to erasure" API endpoint must produce a verifiable certificate of deletion

**Limen's current position:** STRONG. The tombstone infrastructure with cascade re-hash is architecturally correct. The gap is automatic PII detection at claim ingestion and cascading erasure through the claim relationship graph.

**Confidence:** CONFIRMED — GDPR Article 17 is established law. The AI-specific interpretation is evolving but the direction is clear.

**Sources:** [TechPolicy.Press: Right to Be Forgotten Is Dead](https://www.techpolicy.press/the-right-to-be-forgotten-is-dead-data-lives-forever-in-ai/), [CSA: Can AI Forget?](https://cloudsecurityalliance.org/blog/2025/04/11/the-right-to-be-forgotten-but-can-ai-forget), [Varonis: GDPR Right Forgotten AI](https://www.varonis.com/blog/right-forgotten-ai)

---

#### HIPAA (Healthcare)

**What it requires for AI memory systems:**
- Business Associate Agreements (BAAs) covering AI training, fine-tuning, inference, and logging
- PHI (Protected Health Information) must never be exposed or memorized by AI features
- Chat logs, prompts, retrieved context, and claims are sensitive by default
- Minimum necessary standard: AI accesses only the PHI essential for its function
- AES-256 encryption at rest, TLS in transit
- Risk analysis must include AI tools

**How Limen must behave:**
- Claims touching healthcare data must be encrypted at the field level (not just disk-level encryption)
- The crypto engine (already AES-256-GCM with per-tenant key derivation) must extend to per-claim encryption for PHI-tagged claims
- Working memory must have automatic purge on task completion for PHI-containing entries
- Audit trail must log every PHI access, not just mutations
- A "minimum necessary" policy engine must restrict which agents/roles can access which claim predicates

**Limen's current position:** MODERATE. The crypto infrastructure is solid (AES-256-GCM, PBKDF2, per-tenant keys). The gap is field-level encryption for individual claims and automatic PHI detection/tagging.

**Confidence:** CONFIRMED — HIPAA requirements are established law.

**Sources:** [PMC: AI Chatbots HIPAA Compliance](https://pmc.ncbi.nlm.nih.gov/articles/PMC10937180/), [HIPAA Journal](https://www.hipaajournal.com/hipaa-healthcare-data-and-artificial-intelligence/), [AccountableHQ HIPAA Checklist](https://www.accountablehq.com/post/hipaa-requirements-for-healthcare-ai-companies-a-practical-compliance-checklist)

---

#### SOC 2 Type II (2026 Update)

**What it requires for AI memory systems:**
- The 2026 AICPA Trust Services Criteria introduce AI governance criteria
- Algorithmic bias detection, data poisoning defenses, AI-driven decision explainability
- Immutable lineage of all training data and model versions
- Monitoring for model drift and prompt injection defense
- Continuous compliance monitoring (shift from annual point-in-time audits)

**How Limen must behave:**
- Claim confidence drift must be detectable (if a claim's confidence was 0.9 at assertion and evidence now suggests 0.6, this must be flagged)
- The trace system must produce SOC 2-compatible audit packages on demand
- Every configuration change, access modification, and policy update must be in the audit trail (already true for mutations via I-03)
- Continuous chain verification must run as a health check (already exists: `verifyChain()`)

**Limen's current position:** STRONG. Hash-chained audit, immutable traces, and RBAC already satisfy most SOC 2 requirements. The gap is automated SOC 2 report generation and confidence drift detection.

**Confidence:** CONFIRMED — 2026 AICPA guidance published December 2025.

**Sources:** [Konfirmity: SOC 2 2026 Changes](https://www.konfirmity.com/blog/soc-2-what-changed-in-2026), [DSALTA SOC 2 AI Controls](https://www.dsalta.com/resources/ai-compliance/soc-2-type-2-audit-guide-2026-10-ai-powered-controls-every-saas-team-needs)

---

#### FINRA 2026 (Financial Services)

**What it requires for AI memory systems:**
- Prompt and output logging for all AI interactions
- Version tracking: which model version was used and when
- Audit trails of all agent actions
- Narrow scope, explicit permissions, and human checkpoints for AI agents
- Governance frameworks must be established BEFORE GenAI deployment

**How Limen must behave:**
- Every claim assertion must log the model/agent version that produced it (agent versioning in trace)
- The supervision decision trace already captures human-in-the-loop checkpoints
- Working memory reads/writes must be auditable (currently they are, through the audit trail)
- Agent capability manifests must be versioned and their evolution tracked

**Limen's current position:** STRONG. The mission/task/attempt lifecycle with trace events, capability manifests, and supervisor decisions already provides the audit infrastructure FINRA expects. The gap is structured export in FINRA-expected formats.

**Confidence:** CONFIRMED — FINRA 2026 Regulatory Oversight Report published December 2025.

**Sources:** [FINRA 2026 Oversight Report](https://www.finra.org/sites/default/files/2025-12/2026-annual-regulatory-oversight-report.pdf), [Debevoise: FINRA 2026 GenAI Risks](https://www.debevoisedatablog.com/2025/12/11/finras-2026-regulatory-oversight-report-continued-focus-on-generative-ai-and-emerging-agent-based-risks/), [Shumaker: GenAI Compliance Playbook](https://www.shumaker.com/insight/client-alert-generative-artificial-intelligence-in-financial-services-a-practical-compliance-playbook-for-2026/)

---

#### FDA / Healthcare AI Devices

**What it requires for AI memory systems:**
- Total Product Life Cycle (TPLC) framework: ongoing oversight from development to decommissioning
- Good Machine Learning Practices (GMLP): data collection protocols ensuring adequate representation
- Quality System Regulation: design validation under 21 CFR 820.30
- Predetermined Change Control Plans (PCCPs) for AI updates
- Detection of performance degradation and data drift

**How Limen must behave:**
- Claims in medical contexts must have stronger evidence requirements (higher grounding thresholds)
- The learning system (techniques, outcomes, transfers) must track data representation demographics when relevant
- Claim confidence must be re-evaluated periodically (freshness + drift detection)
- Every model/agent update must go through a change control workflow (supervisor approval)

**Limen's current position:** MODERATE. The governance supervisor system and capability manifests provide the change control substrate. The gap is domain-specific evidence thresholds and data representation tracking.

**Confidence:** CONFIRMED — FDA TPLC draft guidance published January 2025, QMSR alignment scheduled 2026.

**Sources:** [IntuitionLabs: FDA Digital Health 2026](https://intuitionlabs.ai/articles/fda-digital-health-technology-guidance-requirements), [AIHNET: FDA AI Data Integrity](https://www.aihnet.com/blog/fda-ai-guidance-data-integrity-challenges/)

---

#### NIST AI Risk Management Framework

**What it requires:**
- Four functions: Govern, Map, Measure, Manage
- Voluntary but increasingly referenced by other regulations
- ISO/IEC 42001 certification is the international standard for AI Management Systems

**How Limen must behave:**
- The governance harness should map to NIST RMF functions natively
- Compliance reports should reference NIST controls
- ISO 42001 certification readiness should be achievable through Limen's built-in governance

**Limen's current position:** The architecture aligns well with NIST's four functions. The gap is explicit mapping documentation and certification readiness tooling.

**Confidence:** CONFIRMED — NIST AI RMF 1.0 published January 2023; 1.1 expected through 2026.

**Sources:** [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework), [NIST AI 100-1](https://nvlpubs.nist.gov/nistpubs/ai/nist.ai.100-1.pdf), [ISO 42001](https://www.iso.org/standard/42001)

---

### 1.2 Mandatory Features Matrix

| Feature | EU AI Act | GDPR | HIPAA | SOC 2 | FINRA | FDA | NIST |
|---------|-----------|------|-------|-------|-------|-----|------|
| **Audit trail (immutable)** | Required | Required | Required | Required | Required | Required | Recommended |
| **Data lineage / provenance** | Required | Implied | Required | Required | Required | Required | Required |
| **Right to erasure** | N/A | Required | N/A | N/A | N/A | N/A | N/A |
| **Encryption at rest** | Required | Required | Required | Required | Required | Required | Recommended |
| **Access control (RBAC)** | Required | Required | Required | Required | Required | Required | Required |
| **Explainability** | Required (high-risk) | Implied | N/A | Required (2026) | Required | Required | Required |
| **Risk classification** | Required | N/A | N/A | Required | N/A | Required | Required |
| **Continuous monitoring** | Required | N/A | Required | Required (2026) | Required | Required | Required |
| **Retention policies** | Required | Required | Required (6yr) | Required | Required | Required | Recommended |
| **Data classification** | Required | Required | Required (PHI) | Required | Required | Required | Required |
| **Human oversight** | Required (high-risk) | N/A | N/A | N/A | Required | Required | Required |
| **Change control** | Required | N/A | N/A | Required | Required | Required | Required |
| **Tenant isolation** | Implied | Required | Required | Required | Required | N/A | Recommended |
| **Consent management** | N/A | Required | Required | N/A | N/A | N/A | N/A |
| **PII detection** | N/A | Required | Required | Required | N/A | N/A | Recommended |

---

## PART 2: GOVERNANCE THAT RUNS ITSELF

### 2.1 The Self-Governing Principle

The PA directive is clear: governance must be enforced by DEFAULT, not opt-in. The developer should never have to think "I need to make this compliant." The system should make non-compliance structurally impossible, the same way Limen's immutability triggers make tenant_id mutation impossible after INSERT.

**Design principle:** If a developer can accidentally produce a non-compliant state, the governance is not good enough.

### 2.2 The Five Pillars of Self-Governing Cognition

#### Pillar 1: Automatic Classification

**Current state:** Claims have subject URNs, predicates, and types but no sensitivity classification.

**Perfect state:** Every claim is automatically classified at assertion time along two dimensions:

1. **Sensitivity level:** `public` | `internal` | `confidential` | `regulated`
2. **Regulatory domain:** `none` | `healthcare` | `financial` | `legal` | `pii` | `biometric`

**How it works:**
- A `ClassificationEngine` runs on every `claim_assert` call
- Classification is derived from:
  - **Predicate pattern matching:** `health.*` -> regulated/healthcare, `financial.*` -> regulated/financial
  - **Content scanning:** NER (Named Entity Recognition) on the object value detects PII patterns (SSN, email, phone, medical record numbers)
  - **Subject URN analysis:** `entity:patient:*` -> healthcare, `entity:account:*` -> financial
  - **Tenant policy:** Tenants can define custom classification rules (e.g., "all claims in predicate `customer.*` are confidential")
- Classification is immutable once assigned (can only be UPGRADED, never downgraded)
- Classification triggers downstream policy enforcement (encryption, retention, access control)

**Implementation architecture:**
```
claim_assert()
  -> ClassificationEngine.classify(subject, predicate, objectValue, tenantPolicy)
  -> returns { sensitivity, regulatoryDomains[] }
  -> stored as claim metadata
  -> triggers PolicyEnforcer.apply(classification)
```

**Evidence:** Automatic data classification is industry standard practice. AI-driven classification identifies and labels sensitive data across systems, helping enforce privacy policies. Automated discovery infrastructure continuously scans to identify, classify, and update data inventories without human intervention.

**Sources:** [ArdentPrivacy DCT](https://www.ardentprivacy.ai/data-classification-and-tagging/), [Privado.ai PbD Blueprint](https://www.privado.ai/post/operationalizing-privacy-by-design)

---

#### Pillar 2: Automatic Retention

**Current state:** Limen has `RetentionScheduler` with configurable per-type retention policies (archive/delete/soft_delete).

**Perfect state:** Retention policies are automatically derived from classification, with regulatory minimums enforced.

**Retention rules by regulatory domain:**

| Domain | Minimum Retention | Maximum Retention | Action at Expiry |
|--------|-------------------|-------------------|------------------|
| Healthcare (HIPAA) | 6 years | 10 years | Archive to sealed file |
| Financial (FINRA/SOX) | 7 years | 10 years | Archive to sealed file |
| Legal (litigation hold) | Until hold released | Indefinite | Suspend all retention |
| PII (GDPR) | Purpose-defined | Purpose expiry | Tombstone + cascade |
| General business | 3 years | 7 years | Archive |
| Audit trail | 7 years (default) | Indefinite | Archive (never delete) |

**How it works:**
- When a claim is classified, `RetentionScheduler` automatically assigns the correct retention policy
- Multiple regulatory domains stack: a claim tagged both `healthcare` and `financial` gets the LONGER retention period
- Legal holds override ALL retention: when litigation is pending, affected claims are excluded from deletion regardless of schedule
- Retention countdown starts from `validAt` timestamp, not assertion time
- 30 days before expiry, a `retention.expiring` trace event fires (alerting compliance teams)
- At expiry, the configured action executes automatically — with approval gates for regulated data

**Gap to close:** The current `RetentionPolicy` interface needs a `legalHoldOverride: boolean` field and a `regulatoryMinimumDays: number` floor that cannot be reduced by tenant configuration.

**Evidence:** Manual deletion processes have a 40% failure rate. Automation is essential. Advanced systems send notifications to data owners when data is about to be deleted.

**Sources:** [ECOSIRE: Data Retention Automation](https://ecosire.com/blog/data-retention-policies), [Sprinto: HIPAA Retention](https://sprinto.com/blog/hipaa-data-retention-requirements/)

---

#### Pillar 3: Automatic Audit

**Current state:** Limen's audit trail is append-only, hash-chained (SHA-256), with tamper detection. Every state mutation and its audit entry occur in the same transaction (I-03). This is already excellent.

**Perfect state:** The audit trail extends to:

1. **Read auditing for regulated data:** Currently, only mutations are audited. For HIPAA/FINRA compliance, every READ of a regulated claim must also be logged.
2. **Access pattern anomaly detection:** Unusual access patterns (agent reading claims outside its normal scope, bulk reads, off-hours access) trigger alerts.
3. **Regulatory export packages:** One-click generation of audit packages formatted for specific regulators (EU AI Act conformity assessment, SOC 2 Type II report, HIPAA security audit).
4. **Cross-tenant audit isolation:** Already strong (tenant_id on every audit entry). Perfect: audit queries are physically incapable of returning cross-tenant results (tenant_id is part of the query path, not just a filter).

**Implementation for read auditing:**
- The audit `appendBatch()` mechanism (already exists for observational audits) handles read logging without blocking the read path
- Read audits use a separate batching queue (up to 50 entries or 100ms window, as spec'd in S ref: section 3.5)
- Only regulated claims trigger read audits (classification-driven, not blanket)

**Export package architecture:**
```
ComplianceExporter
  -> .generatePackage(tenantId, framework: 'eu-ai-act' | 'soc2' | 'hipaa' | 'finra', dateRange)
  -> queries audit trail, trace events, claim lifecycle, retention logs
  -> produces structured report with:
     - Chain verification proof
     - Access summary statistics
     - Policy violation history
     - Retention compliance status
     - Evidence of human oversight (supervisor decisions)
```

---

#### Pillar 4: Automatic Compliance (Prevention, Not Detection)

**Current state:** RBAC prevents unauthorized access. Tenant isolation prevents cross-tenant leakage. Immutability triggers prevent tenant_id mutation.

**Perfect state:** The system prevents non-compliant operations BEFORE they execute, not after.

**Prevention mechanisms:**

1. **PII ingestion gate:** Claims cannot be asserted with PII content unless a consent flag is present in the operation context. The `ClassificationEngine` detects PII; the `ComplianceGate` blocks the assertion if consent is missing.

2. **Cross-border data sovereignty:** Claims tagged with `regulatoryDomain: healthcare` in a tenant configured for EU data residency cannot be replicated to US-region storage. Enforcement at the transport layer, not policy layer.

3. **Confidence floor enforcement:** Claims in regulated domains cannot be asserted below a minimum confidence threshold (configurable per tenant/domain). A healthcare claim with confidence 0.3 is blocked. The floor already exists architecturally (floor_enforcer.ts) — extend it to classification-aware confidence floors.

4. **Consent lifecycle:** Claims referencing personal data carry a `consentId` linking to a consent record. When consent is withdrawn, all claims linked to that consent are automatically tombstoned. This is "right to erasure" that actually works.

5. **Derivation contamination tracking:** If Claim A contains PII and Claim B is `derived_from` Claim A, Claim B inherits Claim A's sensitivity classification. If Claim A is tombstoned, Claim B is flagged for review (not automatically deleted — the derivation may have anonymized the data).

**Architecture:**
```
claim_assert()
  -> ClassificationEngine.classify()       [what kind of data is this?]
  -> ComplianceGate.check()                [is this operation allowed?]
     -> PII check: consent present?
     -> Sovereignty check: data residency ok?
     -> Confidence check: above floor?
     -> Retention check: retention policy assigned?
  -> if ANY check fails: REJECT with specific error code
  -> if ALL pass: proceed to assertion
```

**The key insight:** This is the same pattern as Limen's existing gate architecture (execution_gate.ts, invocation_gate.ts, floor_enforcer.ts). Compliance is just another gate in the pipeline. It is not a separate system — it is wired into the same enforcement substrate.

**Sources:** [CACM: Self-Governing AI](https://cacm.acm.org/blogcacm/we-need-ai-systems-that-can-govern-themselves/), [Acceldata: Agentic AI Governance](https://www.acceldata.io/blog/enhance-security-and-control-with-agentic-ai-data-governance), [Law-AI: Automated Compliance](https://law-ai.org/automated-compliance-and-the-regulation-of-ai/)

---

#### Pillar 5: Automatic Explanation

**Current state:** Claims have evidence refs (artifact, claim, memory, capability_result). Trace events capture the full lifecycle. Claim relationships (supports, contradicts, supersedes, derived_from) form a knowledge graph.

**Perfect state:** Every claim can produce a human-readable explanation of WHY it exists, with zero manual annotation.

**Explanation generation:**
```
explainClaim(claimId) -> {
  assertion: "Claim X asserts that entity:patient:123 has diagnosis.primary = diabetes",
  assertedBy: "agent:diagnostic-analyzer v2.3.1",
  assertedAt: "2026-03-15T14:22:00Z",
  confidence: 0.87,
  evidenceChain: [
    { type: "capability_result", source: "lab-analysis-capability", timestamp: "..." },
    { type: "claim", ref: "claim:abc", relationship: "supports" },
    { type: "artifact", ref: "artifact:lab-report-456" }
  ],
  derivationPath: [
    "Raw lab data (artifact:lab-456) -> Lab analysis capability -> Claim:abc (glucose elevated) -> Derived: Claim X (diabetes diagnosis)"
  ],
  freshness: {
    lastVerified: "2026-03-29T10:00:00Z",
    verificationMethod: "evidence_path",
    staleness: "1 day"
  },
  regulatoryContext: {
    classification: { sensitivity: "regulated", domains: ["healthcare"] },
    retentionPolicy: "hipaa-6yr",
    expiresAt: "2032-03-15T14:22:00Z"
  }
}
```

**This is not AI-generated explanation. This is structural derivation from the existing data model.** The trace events, claim relationships, evidence refs, and classification metadata already contain everything needed. The explanation engine just traverses the graph and renders it.

**Why this matters:** The EU AI Act requires traceability. SOC 2 requires explainability. FINRA requires audit trails of reasoning. A structural explanation engine satisfies all three from the SAME data, with ZERO additional annotation burden on the developer.

**Evidence:** Enterprise-grade explainability requires five capabilities: training data attribution, influence scoring, complete audit trails, contestability, and model certification. Organizations that bolt explainability on after the fact produce shallow explanations that regulators easily challenge.

**Sources:** [Seekr: Explainable AI Enterprise Guide](https://www.seekr.com/resource/explainable-ai-enterprise-guide/), [Credo AI: AI Regulations 2026](https://www.credo.ai/blog/latest-ai-regulations-update-what-enterprises-need-to-know)

---

### 2.3 Policy-as-Code Engine

The five pillars above need a unified policy language. Not YAML config files. Not JSON schemas. A declarative policy engine that expresses governance rules as executable code.

**Why policy-as-code:**
- Policy expressed in natural language is ambiguous, untestable, and unenforceable
- Policy expressed as code can be version-controlled, tested, audited, and deployed like any other system artifact
- Policy changes produce a diff that compliance can review before deployment

**Architecture:**

```typescript
interface GovernancePolicy {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly effectiveFrom: string;        // ISO 8601
  readonly effectiveUntil: string | null; // null = indefinite
  readonly scope: PolicyScope;
  readonly rules: PolicyRule[];
  readonly framework: RegulatoryFramework[]; // which regulations this policy serves
}

interface PolicyScope {
  readonly tenantIds: TenantId[] | 'all';
  readonly predicatePatterns: string[];    // glob patterns, e.g. "health.*"
  readonly subjectPatterns: string[];      // glob patterns
  readonly sensitivityLevels: SensitivityLevel[];
}

interface PolicyRule {
  readonly ruleId: string;
  readonly type: 'require' | 'prohibit' | 'gate' | 'transform';
  readonly condition: PolicyCondition;      // when does this rule apply?
  readonly action: PolicyAction;            // what does it enforce?
  readonly severity: 'block' | 'warn' | 'log';
}
```

**Policy examples:**

```
POLICY: hipaa-phi-protection
  SCOPE: sensitivity = regulated AND domain = healthcare
  RULES:
    - REQUIRE consent_flag on assertion context
    - REQUIRE field-level encryption on object_value
    - REQUIRE read audit logging
    - PROHIBIT confidence below 0.5
    - GATE: supervisor approval for claims with confidence below 0.7
    - RETENTION: minimum 6 years, action = archive
```

```
POLICY: gdpr-pii-lifecycle
  SCOPE: domain = pii
  RULES:
    - REQUIRE consent_id linked to active consent record
    - ON consent_withdrawal: tombstone all linked claims
    - ON erasure_request: cascade tombstone through derivation graph
    - RETENTION: maximum = consent scope duration
    - REQUIRE deletion certificate on erasure completion
```

**Evidence:** By expressing governance rules in machine-readable code, organizations implement context-first infrastructure that enforces policies consistently across AI agents. Policy-as-Code allows organizations to enforce guardrails during development, not after.

**Sources:** [Kyndryl: Policy as Code AI](https://www.kyndryl.com/us/en/about-us/news/2026/02/policy-as-code-ai), [NexaStack: Agent Governance at Scale](https://www.nexastack.ai/blog/agent-governance-at-scale), [Ethyca: Governing Data with PaC](https://www.ethyca.com/news/how-to-govern-data-and-ai-with-a-policy-as-code-approach)

---

## PART 3: TRUST ARCHITECTURE

### 3.1 The Four Trust Layers

Borrowing from the emerging Zero Trust for AI framework (Microsoft, March 2026), Limen's trust architecture operates at four layers:

| Layer | What It Protects | How Limen Implements It |
|-------|------------------|------------------------|
| **Data Trust** | Knowledge integrity and provenance | Hash-chained audit, evidence-grounded claims, classification |
| **Pipeline Trust** | Processing integrity | Trace events on every state transition, supervisor decisions |
| **Identity Trust** | Who/what is making claims | RBAC, agent trust levels, capability manifests |
| **Inference Trust** | Validity of derived knowledge | Confidence scores, grounding modes, claim relationships |

**Sources:** [Microsoft: Zero Trust for AI](https://www.microsoft.com/en-us/security/blog/2026/03/19/new-tools-and-guidance-announcing-zero-trust-for-ai/), [Preprints.org: Zero Trust AI Reference Architecture](https://www.preprints.org/manuscript/202602.0085)

### 3.2 Cryptographic Provenance for Claims

Every claim in a perfect governance system has cryptographic proof of its origin and integrity.

**Current state:** Claims have evidence refs and the audit trail is hash-chained. But individual claims are not cryptographically signed.

**Perfect state:** Every claim carries a provenance envelope:

```typescript
interface ClaimProvenance {
  // Who
  readonly asserterId: AgentId | UserId;
  readonly asserterVersion: string;          // agent/model version
  readonly asserterCapabilityManifest: CapabilityManifestId;

  // When
  readonly assertedAt: string;               // ISO 8601
  readonly validAt: string;                  // temporal anchor
  readonly lastVerified: string;             // freshness

  // What evidence
  readonly groundingMode: 'evidence_path' | 'runtime_witness';
  readonly evidenceRefs: EvidenceRef[];
  readonly derivedFrom: ClaimId[];           // upstream claims

  // Integrity
  readonly contentHash: string;              // SHA-256 of (subject + predicate + objectValue)
  readonly signatureChain: string;           // linked to audit trail hash chain

  // Classification
  readonly sensitivity: SensitivityLevel;
  readonly regulatoryDomains: RegulatoryDomain[];
  readonly retentionPolicy: RetentionPolicyId;
}
```

**Why individual claim signing matters:**
- A hash-chained audit trail proves the SEQUENCE of events was not tampered with
- Individual claim provenance proves the CONTENT of each claim was not tampered with
- Together, they provide both temporal and content integrity — which is what the Verifiable AI Provenance (VAP) Framework requires

**The VAP Framework** (currently an IETF draft) defines common infrastructure including hash chain integrity, digital signatures, unified conformance levels, external anchoring via RFC 3161 Time-Stamp Protocol, and standardized Evidence Pack format for regulatory submission. Limen's existing architecture maps cleanly to this framework.

**Sources:** [IETF VAP Framework](https://datatracker.ietf.org/doc/draft-ailex-vap-legal-ai-provenance/), [ArXiv: End-to-End Verifiable AI Pipelines](https://arxiv.org/html/2503.22573v1), [NVIDIA: Model Signing](https://developer.nvidia.com/blog/bringing-verifiable-trust-to-ai-models-model-signing-in-ngc)

### 3.3 Confidence Lifecycle

Static confidence scores are insufficient. Confidence must evolve:

```
Claim asserted with confidence 0.85
  -> 30 days later: supporting evidence added, confidence -> 0.90
  -> 60 days later: contradicting claim asserted, confidence -> 0.70
  -> 90 days later: no re-verification, freshness decays, effective confidence -> 0.60
  -> 120 days later: re-verified against current evidence, confidence restored -> 0.82
```

**Confidence decay model:**
- `effectiveConfidence = assertedConfidence * freshnessMultiplier * evidenceMultiplier`
- `freshnessMultiplier` decays over time since last verification (configurable half-life per domain)
- `evidenceMultiplier` adjusts based on supporting vs contradicting claims in the relationship graph

**Why this matters:** SOC 2 2026 requires monitoring for "model drift." In a knowledge system, drift manifests as claims becoming stale or contradicted without detection. A confidence lifecycle makes drift visible and actionable.

### 3.4 Reproducibility

Every conclusion must be reproducible: same inputs, same derivation path, same output.

**How Limen achieves this:**
- The trace event system captures every step of the derivation process
- Evidence refs link claims to their source data
- Agent versions are captured in provenance
- The `derived_from` relationship creates a traversable derivation graph
- Re-running the derivation with the same inputs and the same agent version must produce the same claim (deterministic inference)

**Gap:** Currently, the derivation graph is informational. Perfect governance makes it executable — you can "replay" a derivation to verify the conclusion.

---

## PART 4: MULTI-TENANT GOVERNANCE

### 4.1 Isolation Spectrum

Limen already implements transparent tenant isolation (RDD-3: consumer never knows which mode is active, FM-10: tenant_id on every row). This is strong.

**Perfect multi-tenant governance extends to:**

| Dimension | Current | Perfect |
|-----------|---------|---------|
| **Data isolation** | Row-level or DB-per-tenant | Same + field-level encryption per tenant |
| **Policy isolation** | Global policies | Per-tenant policy overrides (can only be more restrictive, never less) |
| **Audit isolation** | tenant_id filter on audit queries | Physically separate audit streams per tenant |
| **Knowledge sharing** | No cross-tenant claim visibility | Controlled knowledge federation with explicit sharing agreements |
| **Governance rules** | Uniform across tenants | Per-tenant governance profiles (e.g., Tenant A is HIPAA, Tenant B is FINRA) |

### 4.2 Knowledge Federation

The hard problem: can Team A's knowledge inform Team B's decisions without violating isolation?

**Architecture:**

```
Tenant A (Healthcare)                    Tenant B (Research)
  claim: patient:123 has diabetes
  classification: regulated/healthcare
  sharing: NONE

  claim: diabetes prevalence = 12%        claim: diabetes prevalence = 12%
  classification: public/none             [federated from Tenant A]
  sharing: FEDERATE(anonymized)           [provenance: "aggregated from Tenant A, anonymized"]
```

**Federation rules:**
1. Only claims classified as `public` or `internal` can be federated
2. Federation requires an explicit **sharing agreement** between tenants (stored as a governance policy)
3. Federated claims carry provenance indicating their origin tenant (but not the source claims that produced them)
4. Federation is one-way: the receiving tenant gets a READ-ONLY copy
5. If the source claim is retracted, the federated copy is automatically retracted

**This is how you get the benefit of shared knowledge without the risk of data leakage.**

**Evidence:** Data sovereignty no longer necessitates separate environments. By tagging and routing data according to policy, systems automatically enforce where data lives, which region processes it, and which system consumes it.

**Sources:** [Microsoft: Multi-tenant AI Architecture](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/ai-machine-learning), [Microsoft: Governance for AI Agents](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ai-agents/governance-security-across-organization), [Fast.io: Multi-Tenant AI Agent Architecture](https://fast.io/resources/ai-agent-multi-tenant-architecture/)

### 4.3 Tenant Governance Profiles

Each tenant gets a governance profile that defines:

```typescript
interface TenantGovernanceProfile {
  readonly tenantId: TenantId;
  readonly regulatoryFrameworks: RegulatoryFramework[];  // ['hipaa', 'soc2']
  readonly dataResidency: Region[];                       // ['us-east', 'eu-west']
  readonly classificationOverrides: ClassificationRule[]; // tenant-specific rules
  readonly retentionOverrides: RetentionOverride[];       // can only be MORE restrictive
  readonly confidenceFloors: Record<string, number>;      // per-domain confidence minimums
  readonly sharingAgreements: SharingAgreement[];         // cross-tenant federation
  readonly auditConfig: AuditConfig;                      // what gets read-audited
  readonly encryptionConfig: EncryptionConfig;            // field-level encryption rules
}
```

**The constraint:** Tenant-level overrides can only be MORE restrictive than system defaults. A tenant cannot lower retention below regulatory minimums, disable audit logging, or reduce confidence floors below system-wide thresholds. The `PolicyEnforcer` ensures `max(systemDefault, tenantOverride)` for restrictive policies.

---

## PART 5: GOVERNANCE UX — MAKING IT INVISIBLE

### 5.1 The Developer Experience

**Principle:** The best security is invisible security. When governance feels natural rather than burdensome, compliance goes up dramatically.

**What the developer sees:**

```typescript
// The developer writes this:
await limen.claimAssert({
  subject: 'entity:patient:123',
  predicate: 'diagnosis.primary',
  objectType: 'string',
  objectValue: 'type-2-diabetes',
  confidence: 0.87,
  validAt: '2026-03-15T14:22:00Z',
  missionId: currentMission,
  taskId: currentTask,
  groundingMode: 'evidence_path',
  evidenceRefs: [{ type: 'capability_result', id: 'lab-analysis-001' }],
});

// What happens INVISIBLY:
// 1. ClassificationEngine detects: subject=patient -> healthcare, predicate=diagnosis -> regulated
// 2. Classification assigned: { sensitivity: 'regulated', domains: ['healthcare'] }
// 3. ComplianceGate checks: consent flag present? -> YES (from operation context)
// 4. ComplianceGate checks: confidence >= healthcare floor (0.5)? -> YES (0.87)
// 5. Field-level encryption applied to objectValue (AES-256-GCM, per-tenant key)
// 6. Retention policy auto-assigned: hipaa-6yr
// 7. Provenance envelope generated and attached
// 8. Audit entry appended (same transaction)
// 9. Trace event emitted: claim.asserted
// 10. Read audit configured for future accesses
//
// The developer wrote ZERO governance code. It all happened.
```

**What the developer DOES NOT see:**
- Classification logic
- Encryption decisions
- Retention assignment
- Audit entry creation
- Compliance gate evaluation
- Provenance generation

**What the developer DOES see (only on failure):**
```
LimenError: COMPLIANCE_GATE_BLOCKED
  reason: "Claim in regulated/healthcare domain requires consent_flag in operation context"
  remedy: "Include consentId in your OperationContext before asserting healthcare claims"
  regulation: "HIPAA 45 CFR 164.508"
```

**The error message tells the developer exactly what went wrong, why, and how to fix it. It even cites the regulation.** This is not friction — this is guidance.

**Sources:** [Qovery: Zero-Friction DevSecOps](https://www.qovery.com/blog/zero-friction-devsecops), [AdminByRequest: UX vs Security False Dilemma](https://www.adminbyrequest.com/en/blogs/why-user-experience-vs-security-is-a-false-dilemma)

### 5.2 The Compliance Officer Experience

**Self-generating compliance reports:**

```
> limen compliance report --tenant acme-health --framework hipaa --period 2026-Q1

HIPAA Compliance Report: ACME Health, Q1 2026
=============================================

Audit Trail Integrity
  Chain verification: PASSED (142,847 entries, zero gaps, zero breaks)
  Last verification: 2026-03-30T00:00:00Z (automated daily)

PHI Access Summary
  Total PHI claims: 8,421
  Total PHI reads: 34,892 (logged)
  Unauthorized access attempts: 0

Encryption Status
  Claims with field-level encryption: 8,421/8,421 (100%)
  Algorithm: AES-256-GCM
  Key rotation: Last rotated 2026-02-15

Retention Compliance
  Claims past minimum retention: 0
  Claims approaching expiry (30 days): 12
  Legal holds active: 2

Consent Management
  Active consent records: 1,203
  Withdrawn consents: 47 (all cascading tombstones completed)
  Consent coverage: 100% (no PHI claims without consent)

Data Residency
  Storage regions: us-east-1 (primary)
  Cross-region transfers: 0

Agent Oversight
  Human-in-the-loop decisions: 847
  Agent-autonomous decisions: 12,493 (within approved scope)
  Scope violations: 0
```

**The compliance officer never fills out a form. The report generates itself from the system's own audit data.**

### 5.3 The Auditor Experience

**Queryable audit (not a PDF dump):**

```
> limen audit query --resource-type claim --resource-id claim:abc123 --include-chain

Claim: claim:abc123
  Subject: entity:patient:123
  Predicate: diagnosis.primary
  Classification: regulated/healthcare

Full Lifecycle:
  [1] 2026-03-15T14:22:00Z  claim.asserted    agent:diagnostic-analyzer
  [2] 2026-03-15T14:22:00Z  classification     system:classifier          -> regulated/healthcare
  [3] 2026-03-15T14:22:00Z  encryption         system:crypto-engine       -> field encrypted
  [4] 2026-03-15T14:22:00Z  retention.assigned system:retention-scheduler -> hipaa-6yr
  [5] 2026-03-16T09:00:00Z  claim.read         agent:care-coordinator     -> audit logged
  [6] 2026-03-20T14:00:00Z  claim.grounded     agent:evidence-reviewer    -> 2 evidence refs
  [7] 2026-03-25T10:00:00Z  freshness.check    system:scheduler           -> verified fresh

Chain Verification: VALID (hash abc123...def456 -> ghi789...jkl012)
Derivation Graph: 2 upstream claims, 1 downstream claim
```

**Every question an auditor asks can be answered by a query, not by digging through logs.**

---

## PART 6: INVENTION OPPORTUNITIES

These are areas where the field falls short and Limen can lead.

### 6.1 Governance-Aware Knowledge Graphs (No Competitor Has This)

No existing knowledge graph system embeds governance INTO the graph structure. They all bolt governance ON TOP. Limen's claim relationship system (supports, contradicts, supersedes, derived_from) is already a knowledge graph. Adding classification, retention, provenance, and compliance gates directly into the graph edges is a unique capability.

**Competitive advantage:** When a regulator asks "show me everything derived from this patient's data," Limen can traverse the derivation graph with classification awareness and produce a complete answer. No competitor can do this.

### 6.2 Temporal Governance (No Standard Exists)

Current governance is point-in-time. "Is this compliant NOW?" Perfect governance is temporal. "Was this compliant at the time the decision was made? What was the governance policy version when this claim was asserted?"

Limen's `GovernanceQueryContext` (already implemented) includes `policyVersionHard` and `policyVersionSoft`. This is the foundation for temporal governance — the ability to audit compliance against the policies that were IN EFFECT at any historical point.

**No regulatory framework currently requires this.** But when the first litigation asks "what were your policies when you made this decision?", the answer will be worth more than any feature.

### 6.3 Federated Compliance (Emerging Need)

When multiple organizations share a Limen instance (via multi-tenancy), compliance becomes federated. Organization A's HIPAA obligations interact with Organization B's FINRA obligations in the shared infrastructure.

**The invention:** A compliance composition engine that can reason about overlapping regulatory requirements across tenants and produce a UNIFIED compliance posture for the shared infrastructure, while maintaining per-tenant isolation.

### 6.4 Self-Certifying Compliance

Instead of waiting for an annual SOC 2 audit, Limen continuously certifies its own compliance posture and makes the certification available for independent verification.

**Architecture:**
- Continuous compliance monitors run every 24 hours
- Each monitor checks one regulatory dimension (encryption, retention, audit integrity, access control)
- Results are themselves claims in the knowledge graph (meta-governance)
- The compliance certificate is a signed document that any verifier can check against the audit trail
- If any dimension fails, the certificate is automatically revoked and an alert fires

**This transforms SOC 2 from an annual exercise into a continuous signal.**

---

## PART 7: IMPLEMENTATION ROADMAP

### Phase 1: Classification Engine (Foundation)
- Implement `ClassificationEngine` with predicate-pattern, content-scan, and subject-URN classification
- Add `sensitivity` and `regulatoryDomains` fields to claim metadata
- Wire classification into `claim_assert` pipeline
- **Dependency:** None. Can start immediately.

### Phase 2: Compliance Gate
- Implement `ComplianceGate` in the assertion pipeline (same pattern as execution_gate.ts)
- Consent tracking (consent records + claim linkage)
- Confidence floor enforcement per classification
- **Dependency:** Phase 1 (classification must exist before gates can use it)

### Phase 3: Read Audit Extension
- Extend audit batching to log reads of regulated claims
- Implement read audit toggle per classification level
- **Dependency:** Phase 1 (classification determines which reads are audited)

### Phase 4: Policy-as-Code Engine
- Implement `GovernancePolicy` storage and versioning
- Policy evaluation engine (rule matching against claim context)
- Per-tenant policy overrides with restrictiveness enforcement
- **Dependency:** Phases 1-3 (policies reference classifications and gates)

### Phase 5: Claim Provenance Envelopes
- Extend claim model with provenance metadata
- Content hashing and signature chain linking
- Explanation engine (derivation graph traversal + rendering)
- **Dependency:** Phase 1 (provenance includes classification)

### Phase 6: Compliance Reporting
- SOC 2, HIPAA, FINRA, EU AI Act export formats
- Self-generating compliance reports
- Continuous compliance monitors
- **Dependency:** Phases 1-5 (reports draw from all governance data)

### Phase 7: Knowledge Federation
- Sharing agreements between tenants
- Federated claim propagation with provenance
- Automatic retraction cascade across federation boundaries
- **Dependency:** Phase 4 (federation governed by policies)

---

## PART 8: WHAT LIMEN ALREADY HAS (The Foundation Is Real)

This section is critical. Limen is not starting from zero. The governance substrate is ALREADY architecturally correct. Here is what exists:

| Capability | Status | Implementation |
|------------|--------|----------------|
| **Hash-chained audit trail** | SHIPPED | SHA-256 chain, tamper detection, append-only, batch observational audits |
| **GDPR tombstoning** | SHIPPED | Cascade re-hash preserving chain integrity |
| **Tenant isolation** | SHIPPED | Row-level + DB-per-tenant transparent routing, immutability triggers on all 12 tables |
| **RBAC** | SHIPPED | 5 default roles, permission checking, dormant in single-user mode |
| **Encryption at rest** | SHIPPED | AES-256-GCM, per-tenant PBKDF2 key derivation, post-quantum opt-in |
| **Retention scheduler** | SHIPPED | Configurable per-type policies with archive/delete/soft_delete |
| **Trace event system** | SHIPPED | 32 constitutional events, typed payloads, run sequencing |
| **Claim lifecycle** | SHIPPED | Assert, ground, challenge, retract with evidence and relationships |
| **Supervision** | SHIPPED | Human-in-the-loop decisions with trace logging |
| **Capability manifests** | SHIPPED | Agent capability versioning and trust tiers |
| **Governance query context** | SHIPPED | Policy version tracking, completeness indicators |
| **Rate limiting** | SHIPPED | Per-tenant rate enforcement |
| **Archival** | SHIPPED | Sealed file archival preserving chain integrity |

**The gap is not infrastructure. The gap is automatic classification, compliance gates, and regulatory reporting.** The substrate for all of it already exists.

---

## CONCLUSIONS

### What Perfect Governance Looks Like

1. **Structurally impossible to produce non-compliant state** — not "detected after the fact" but "prevented before execution"
2. **Zero governance burden on the developer** — classification, encryption, retention, audit all happen invisibly
3. **Self-generating compliance evidence** — reports produce themselves from the system's own data
4. **Temporal auditability** — compliance verifiable at any historical point against the policies that were in effect
5. **Cryptographic provenance on every knowledge claim** — not just "who said this" but a verifiable proof chain
6. **Knowledge-graph-aware governance** — derivation contamination tracking, cascading erasure, federated compliance

### What No Competitor Has

- Governance embedded IN the knowledge graph, not ON TOP of it
- Automatic classification at the claim ingestion boundary
- Compliance gates that prevent non-compliant assertions (not detect them)
- Temporal governance with policy version tracking
- GDPR tombstoning that preserves audit chain integrity
- Self-certifying continuous compliance

### The Strategic Position

Limen's governance architecture is already stronger than any AI memory/knowledge system on the market. The path from "strong" to "perfect" is well-defined, implementable in phases, and builds on infrastructure that is already shipped and tested. Every phase adds regulatory coverage without breaking existing capabilities.

The moat is real. The question is how fast to deepen it.

---

*SolisHQ Research Division -- 2026-03-30*
*Evidence Level: Cross-referenced from EU AI Act, GDPR, HIPAA, SOC 2, FINRA, FDA, NIST AI RMF, ISO 42001, C2PA, VAP Framework, and 40+ industry sources.*
