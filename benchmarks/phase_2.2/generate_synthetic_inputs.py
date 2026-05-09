#!/usr/bin/env python3
# @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
# @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
"""Generate synthetic_inputs.jsonl: 750 items.

Distribution:
  300 claims (technology facts, business decisions, project status, architecture, security)
  200 queries (customer support, technical questions, status inquiries)
  150 reasoning chains (multi-step problems, 3-7 chain-of-thought steps)
  100 governance edge cases (conflicting info, policy violations, tamper, cross-tenant)
"""

import json
import random
import sys

random.seed(73)  # Reproducible

OUTPUT = "/Users/solishq/Projects/limen/benchmarks/phase_2.2/synthetic_inputs.jsonl"

# --- Content templates ---

TECH_DOMAINS = [
    "Kubernetes", "PostgreSQL", "Redis", "gRPC", "GraphQL", "Kafka",
    "Terraform", "Docker", "Nginx", "Elasticsearch", "MongoDB", "RabbitMQ",
    "Prometheus", "Grafana", "Istio", "Envoy", "Vault", "Consul",
    "ArgoCD", "Flux", "Cilium", "Falco", "OPA", "Kyverno",
]

LANGUAGES = [
    "TypeScript", "Rust", "Go", "Python", "Swift", "Kotlin",
    "C++", "Java", "Elixir", "Zig",
]

COMPANIES = [
    "Acme Corp", "Nexus Systems", "Vertex AI Labs", "Pinnacle Robotics",
    "Quantum Bridge", "Meridian Health", "Cobalt Security", "Stratos Cloud",
    "Forge Analytics", "Atlas Infrastructure", "Prism Data", "Onyx Networks",
    "Lumen Dynamics", "Cipher Defense", "Helix Genomics", "Apex Fintech",
    "Nova Commerce", "Zenith Logistics", "Orion Aerospace", "Titan Energy",
]

PROJECT_NAMES = [
    "Project Aurora", "Project Sentinel", "Project Helios", "Project Mantis",
    "Project Orion", "Project Nexus", "Project Titan", "Project Aegis",
    "Project Phoenix", "Project Horizon", "Project Catalyst", "Project Zenith",
]

SECURITY_POLICIES = [
    "zero-trust network policy", "mTLS enforcement across all service mesh endpoints",
    "RBAC with least-privilege principle", "SOC2 Type II compliance controls",
    "GDPR data residency requirements", "PCI-DSS cardholder data isolation",
    "secrets rotation every 90 days", "container image signing with Cosign",
    "network segmentation between production and staging",
    "audit log immutability with hash-chain verification",
    "API rate limiting at 1000 req/min per tenant",
    "encryption at rest with AES-256-GCM and per-tenant keys",
]

ARCHITECTURES = [
    "event-sourced microservices with CQRS",
    "hexagonal architecture with port-adapter pattern",
    "actor-model concurrency with supervision trees",
    "serverless event-driven pipeline",
    "modular monolith with bounded contexts",
    "cell-based architecture for fault isolation",
    "saga pattern for distributed transactions",
    "outbox pattern for reliable event publishing",
    "circuit breaker with exponential backoff",
    "bulkhead pattern for resource isolation",
]

STATUS_PHASES = [
    "requirements gathering", "architecture design", "implementation sprint",
    "integration testing", "performance benchmarking", "security audit",
    "staging deployment", "canary rollout", "production release",
    "post-deployment monitoring", "incident response drill",
]

METRICS = [
    "p99 latency", "error rate", "throughput", "availability",
    "mean time to recovery", "deployment frequency", "change failure rate",
    "CPU utilization", "memory pressure", "disk I/O wait",
    "connection pool saturation", "queue depth", "cache hit ratio",
]


def random_token_est(complexity: str) -> int:
    ranges = {"low": (200, 350), "medium": (350, 550), "high": (550, 800)}
    return random.randint(*ranges[complexity])


def pick_complexity() -> str:
    return random.choices(["low", "medium", "high"], weights=[0.3, 0.5, 0.2])[0]


# --- Claim generators (300 total, ~60 each of 5 subcategories) ---

def gen_tech_fact() -> str:
    tech = random.choice(TECH_DOMAINS)
    lang = random.choice(LANGUAGES)
    version = f"{random.randint(1, 5)}.{random.randint(0, 15)}.{random.randint(0, 9)}"
    templates = [
        f"The {tech} cluster has been upgraded to version {version}. This deployment "
        f"includes critical fixes for memory leak in the connection pool handler and "
        f"a new configuration option for tuning the garbage collection interval. "
        f"All {lang} services consuming this dependency must update their client "
        f"libraries by end of sprint. Migration guide: ensure backwards compatibility "
        f"of wire format before switching traffic.",

        f"Performance benchmarks for the {tech} integration layer show {random.randint(15, 85)}% "
        f"improvement in throughput after migrating to the async {lang} driver. "
        f"Key findings: connection pooling reduces p99 latency from {random.randint(50, 200)}ms "
        f"to {random.randint(5, 30)}ms under {random.randint(1000, 10000)} concurrent connections. "
        f"Recommended: adopt connection multiplexing for all read-heavy workloads.",

        f"Stability report for {tech} v{version}: {random.randint(0, 3)} incidents in the "
        f"last 30 days, all P3 or below. Root cause analysis shows {random.randint(60, 95)}% "
        f"of alerts were false positives from overly aggressive thresholds on the "
        f"{random.choice(METRICS)} metric. Action item: recalibrate alerting rules "
        f"using the {random.choice(['3-sigma', 'IQR', 'MAD'])} method.",
    ]
    return random.choice(templates)


def gen_business_decision() -> str:
    company = random.choice(COMPANIES)
    project = random.choice(PROJECT_NAMES)
    budget = random.randint(50, 500) * 1000
    templates = [
        f"Decision: {project} will adopt {random.choice(ARCHITECTURES)} as the "
        f"primary system architecture. Rationale: current monolith cannot scale "
        f"beyond {random.randint(10, 100)}K concurrent users without vertical scaling, "
        f"which has a hard ceiling at the current cloud provider tier. Estimated "
        f"migration cost: ${budget:,}. Timeline: {random.randint(2, 6)} quarters. "
        f"Risk: team has limited experience with the target pattern; budget "
        f"{random.randint(10, 25)}% of allocation for training and proof-of-concept.",

        f"Partnership evaluation with {company}: technical due diligence complete. "
        f"Their API handles {random.randint(1, 50)}M requests/day with "
        f"{random.uniform(99.5, 99.99):.2f}% uptime over the last 12 months. "
        f"Integration complexity: medium (REST + webhook, no streaming). "
        f"Contract terms: {random.randint(1, 3)}-year commitment, "
        f"${random.randint(5, 50)}K/month. Recommendation: proceed with pilot "
        f"in {random.choice(['Q1', 'Q2', 'Q3', 'Q4'])} targeting the "
        f"{random.choice(['payments', 'analytics', 'notification', 'auth'])} subsystem.",

        f"Go/no-go for {project} Phase {random.randint(2, 5)}: GO with conditions. "
        f"All {random.randint(8, 20)} acceptance criteria met. {random.randint(0, 3)} "
        f"minor findings deferred to next sprint (all P3, no security implications). "
        f"Budget utilization at {random.randint(65, 95)}%. Team velocity stable at "
        f"{random.randint(20, 60)} story points/sprint. Next milestone: "
        f"{random.choice(STATUS_PHASES)} by {random.choice(['March', 'June', 'September', 'December'])} "
        f"{random.choice([2026, 2027])}.",
    ]
    return random.choice(templates)


def gen_project_status() -> str:
    project = random.choice(PROJECT_NAMES)
    phase = random.choice(STATUS_PHASES)
    templates = [
        f"{project} status update: currently in {phase}. Sprint velocity: "
        f"{random.randint(18, 55)} points. Burndown tracking "
        f"{random.choice(['ahead of', 'on', 'behind'])} schedule. "
        f"Blockers: {random.randint(0, 3)} outstanding. Team capacity at "
        f"{random.randint(70, 100)}% due to {random.choice(['PTO', 'onboarding', 'context switching', 'full capacity'])}. "
        f"Key risk: {random.choice(['dependency on external API release', 'schema migration complexity', 'test environment instability', 'no critical risks identified'])}. "
        f"Next checkpoint: {random.choice(['Monday standup', 'Wednesday review', 'Friday demo', 'Sprint retrospective'])}.",

        f"Incident post-mortem for {project}: {random.choice(['P1', 'P2'])} incident on "
        f"{random.choice(['2026-04-15', '2026-04-22', '2026-04-29', '2026-05-01'])}. "
        f"Duration: {random.randint(15, 180)} minutes. Impact: {random.randint(100, 10000)} "
        f"users affected. Root cause: {random.choice(['database connection pool exhaustion', 'misconfigured rate limiter', 'stale DNS cache', 'certificate expiry', 'memory leak in worker process'])}. "
        f"Remediation: {random.choice(['automated pool scaling', 'config validation in CI', 'DNS TTL reduction', 'cert rotation automation', 'memory profiling in staging'])}. "
        f"Follow-up items: {random.randint(2, 5)} action items assigned, due within {random.randint(1, 3)} sprints.",
    ]
    return random.choice(templates)


def gen_architecture_choice() -> str:
    arch = random.choice(ARCHITECTURES)
    tech1 = random.choice(TECH_DOMAINS)
    tech2 = random.choice([t for t in TECH_DOMAINS if t != tech1])
    templates = [
        f"Architecture Decision Record: adopting {arch} for the data pipeline. "
        f"Context: current batch processing with {tech1} cannot meet the "
        f"sub-{random.randint(100, 500)}ms latency requirement for real-time scoring. "
        f"Alternatives considered: (1) optimize existing {tech1} pipeline, rejected due "
        f"to fundamental batch-oriented design; (2) {tech2} streaming, rejected due to "
        f"operational complexity and team unfamiliarity. Decision: {arch} provides the "
        f"best balance of latency, throughput, and operational simplicity. "
        f"Trade-offs: increased storage cost ({random.randint(10, 40)}% more), eventual "
        f"consistency window of {random.randint(50, 500)}ms.",

        f"Service mesh evaluation: {tech1} vs {tech2} for inter-service communication. "
        f"Benchmark results across {random.randint(3, 10)} services: "
        f"{tech1} adds {random.randint(1, 5)}ms p50 latency, {random.randint(3, 15)}ms p99. "
        f"{tech2} adds {random.randint(1, 5)}ms p50 latency, {random.randint(3, 15)}ms p99. "
        f"Both support mTLS, circuit breaking, and observability integration. "
        f"Differentiator: {random.choice([tech1, tech2])} has native support for "
        f"{random.choice(['gRPC reflection', 'WebSocket upgrades', 'multi-cluster federation', 'WASM extensions'])}. "
        f"Recommendation: {random.choice([tech1, tech2])} for production deployment.",
    ]
    return random.choice(templates)


def gen_security_policy() -> str:
    policy = random.choice(SECURITY_POLICIES)
    templates = [
        f"Security policy update: implementing {policy}. "
        f"Scope: all production services in the {random.choice(['us-east-1', 'eu-west-1', 'ap-southeast-1'])} region. "
        f"Enforcement date: {random.choice(['2026-05-15', '2026-06-01', '2026-06-15', '2026-07-01'])}. "
        f"Pre-enforcement audit found {random.randint(2, 15)} non-compliant services. "
        f"Remediation plan: {random.randint(1, 3)} sprint(s) for code changes, "
        f"{random.randint(1, 2)} sprint(s) for validation. Exception process: "
        f"requires security team sign-off with compensating controls documented. "
        f"Monitoring: automated compliance scanner runs {random.choice(['hourly', 'daily', 'on every deployment'])}.",

        f"Vulnerability assessment for {random.choice(TECH_DOMAINS)} deployment: "
        f"{random.randint(0, 2)} critical, {random.randint(1, 5)} high, "
        f"{random.randint(3, 12)} medium findings. Critical findings: "
        f"{random.choice(['CVE-2026-' + str(random.randint(10000, 99999)), 'no critical CVEs'])}. "
        f"Patch timeline: critical within 24h, high within 7 days, medium within 30 days. "
        f"Related policy: {policy}. "
        f"Compensating control active: {random.choice(['WAF rule blocking exploit pattern', 'network isolation of affected service', 'rate limiting on vulnerable endpoint', 'N/A - patched'])}.",
    ]
    return random.choice(templates)


# --- Query generators (200 total) ---

def gen_customer_support_query() -> str:
    templates = [
        f"Customer {random.choice(COMPANIES)} reports intermittent {random.randint(500, 504)} errors "
        f"when calling the {random.choice(['auth', 'billing', 'data-export', 'webhook', 'search'])} API "
        f"endpoint. Frequency: approximately {random.randint(1, 10)}% of requests during "
        f"peak hours ({random.randint(9, 11)}:00-{random.randint(13, 17)}:00 UTC). "
        f"Customer impact: {random.choice(['degraded experience', 'data sync failures', 'billing discrepancies', 'notification delays'])}. "
        f"Question: what is the current status of this issue and estimated resolution time?",

        f"Inquiry from {random.choice(COMPANIES)}: requesting documentation for the "
        f"{random.choice(['batch processing', 'real-time streaming', 'multi-tenant isolation', 'custom webhook'])} "
        f"feature. They need to understand rate limits, retry behavior, and error codes. "
        f"Current SLA tier: {random.choice(['standard', 'premium', 'enterprise'])}. "
        f"Deadline: {random.choice(['end of week', 'next Monday', 'ASAP - blocking their launch'])}.",

        f"Escalation from support: {random.choice(COMPANIES)} experiencing data inconsistency "
        f"between their dashboard and API responses. Affected resources: "
        f"{random.choice(['user accounts', 'transaction records', 'inventory items', 'analytics metrics'])}. "
        f"Discrepancy noticed {random.randint(1, 72)} hours ago. "
        f"Steps taken: cache cleared, replication lag checked (within normal range). "
        f"Need root cause analysis and customer communication.",
    ]
    return random.choice(templates)


def gen_technical_query() -> str:
    tech = random.choice(TECH_DOMAINS)
    templates = [
        f"How should we configure {tech} connection pooling for a workload pattern of "
        f"{random.randint(100, 5000)} queries/second with {random.randint(5, 50)}ms average "
        f"query time? Current pool size: {random.randint(10, 50)}. "
        f"Observed symptoms: occasional {random.choice(['connection timeout', 'pool exhaustion', 'idle connection reaping', 'DNS resolution failure'])} "
        f"errors during traffic spikes. Stack: {random.choice(LANGUAGES)} "
        f"with {random.choice(['connection pool library', 'ORM', 'raw driver'])}.",

        f"What is the recommended approach for migrating from {tech} "
        f"v{random.randint(1, 3)}.x to v{random.randint(4, 6)}.x in production? "
        f"Current dataset size: {random.randint(10, 500)}GB across "
        f"{random.randint(5, 50)} tables/collections. Constraints: zero-downtime "
        f"migration, backwards-compatible wire format during transition period of "
        f"{random.randint(1, 4)} weeks. Any known gotchas with the "
        f"{random.choice(['authentication', 'replication', 'indexing', 'compression'])} subsystem?",

        f"Performance investigation: {tech} {random.choice(METRICS)} degraded by "
        f"{random.randint(20, 300)}% after deploying commit "
        f"{hex(random.randint(0x1000000, 0xFFFFFFF))[2:]}. "
        f"No code changes to the {tech} integration layer in this commit. "
        f"Hypothesis: {random.choice(['upstream dependency version bump', 'configuration drift', 'resource contention from co-located service', 'GC pressure from new feature'])}. "
        f"What diagnostic steps should we take?",
    ]
    return random.choice(templates)


def gen_status_inquiry() -> str:
    project = random.choice(PROJECT_NAMES)
    templates = [
        f"What is the current deployment status of {project}? "
        f"Last known state: {random.choice(STATUS_PHASES)}. "
        f"Specifically need: (1) are all {random.randint(5, 20)} services healthy, "
        f"(2) what is the current {random.choice(METRICS)}, "
        f"(3) any open incidents or degradations?",

        f"Requesting compliance status for {project}: "
        f"which {random.choice(SECURITY_POLICIES)} controls have been validated? "
        f"Audit deadline: {random.choice(['2026-05-15', '2026-06-01', '2026-06-30'])}. "
        f"Need gap analysis with remediation effort estimates.",
    ]
    return random.choice(templates)


# --- Reasoning chain generators (150 total) ---

def gen_reasoning_chain() -> str:
    templates = [
        # Capacity planning
        f"Analyze capacity requirements for scaling {random.choice(PROJECT_NAMES)} from "
        f"{random.randint(1, 10)}K to {random.randint(50, 500)}K daily active users. "
        f"Step 1: Characterize current resource utilization per user "
        f"(CPU: {random.uniform(0.001, 0.01):.4f} cores, memory: {random.randint(5, 50)}MB, "
        f"storage: {random.randint(1, 20)}KB/day, network: {random.randint(10, 100)}KB/request). "
        f"Step 2: Identify bottleneck services by profiling the hot path through "
        f"{random.choice(TECH_DOMAINS)} and {random.choice(TECH_DOMAINS)}. "
        f"Step 3: Model cost curve with {random.choice(['linear', 'logarithmic', 'step-function'])} "
        f"scaling assumption. "
        f"Step 4: Propose architecture modifications to shift cost curve. "
        f"Step 5: Validate with load test at {random.randint(2, 5)}x target scale. "
        f"Constraint: monthly infrastructure budget must not exceed ${random.randint(10, 100)}K.",

        # Incident investigation
        f"Investigate correlation between {random.choice(METRICS)} spike on "
        f"{random.choice(['2026-04-28', '2026-04-30', '2026-05-01'])} and recent deployment. "
        f"Step 1: Establish timeline - deployment at {random.randint(10, 16)}:00 UTC, "
        f"metric anomaly detected at +{random.randint(5, 60)} minutes. "
        f"Step 2: Diff deployment artifacts - {random.randint(3, 15)} changed files, "
        f"{random.randint(1, 5)} new dependencies. "
        f"Step 3: Correlate with {random.choice(TECH_DOMAINS)} logs for same time window. "
        f"Step 4: Reproduce in staging with identical traffic pattern. "
        f"Step 5: Determine if rollback is warranted based on user impact "
        f"({random.randint(0, 5)}% error rate vs {random.uniform(0.01, 0.5):.2f}% baseline). "
        f"Step 6: If not rollback, identify targeted fix and estimate deployment time.",

        # Migration planning
        f"Plan migration of {random.choice(TECH_DOMAINS)} data to {random.choice(TECH_DOMAINS)} "
        f"for {random.choice(PROJECT_NAMES)}. "
        f"Step 1: Inventory source schema - {random.randint(10, 80)} tables, "
        f"{random.randint(100, 5000)}GB data, {random.randint(20, 200)} indexes. "
        f"Step 2: Map source types to target types, identifying "
        f"{random.randint(2, 10)} incompatible type conversions requiring transformation. "
        f"Step 3: Design ETL pipeline with checkpointing every "
        f"{random.randint(1000, 10000)} records for resumability. "
        f"Step 4: Implement dual-write phase for {random.randint(1, 4)} weeks to validate "
        f"consistency (compare checksums of {random.randint(100, 1000)} random samples/hour). "
        f"Step 5: Cut over with {random.randint(1, 15)} minute maintenance window. "
        f"Step 6: Monitor for {random.randint(24, 168)} hours before decommissioning source. "
        f"Step 7: Archive source backups with {random.randint(30, 365)}-day retention.",

        # Security analysis
        f"Threat model for the {random.choice(['authentication', 'payment', 'data export', 'admin panel'])} "
        f"subsystem of {random.choice(PROJECT_NAMES)}. "
        f"Step 1: Enumerate trust boundaries - "
        f"{random.randint(3, 7)} external interfaces, {random.randint(2, 5)} internal service calls. "
        f"Step 2: STRIDE analysis per boundary (spoofing, tampering, repudiation, "
        f"information disclosure, denial of service, elevation of privilege). "
        f"Step 3: Map threats to existing controls - "
        f"{random.choice(SECURITY_POLICIES)}, {random.choice(SECURITY_POLICIES)}. "
        f"Step 4: Identify {random.randint(2, 8)} gaps where threats lack mitigations. "
        f"Step 5: Prioritize by risk score (impact x likelihood) and propose "
        f"remediation for top {random.randint(3, 5)} gaps.",

        # Cost optimization
        f"Optimize cloud spend for {random.choice(PROJECT_NAMES)} "
        f"(current: ${random.randint(20, 200)}K/month). "
        f"Step 1: Break down by service: compute {random.randint(30, 50)}%, "
        f"storage {random.randint(15, 30)}%, network {random.randint(5, 15)}%, "
        f"managed services {random.randint(10, 25)}%. "
        f"Step 2: Identify idle resources - {random.randint(5, 20)} instances below "
        f"{random.randint(5, 15)}% CPU utilization in the last {random.randint(7, 30)} days. "
        f"Step 3: Evaluate reserved instance pricing for stable workloads "
        f"(estimated {random.randint(20, 40)}% savings). "
        f"Step 4: Assess spot/preemptible for batch workloads "
        f"(estimated {random.randint(50, 70)}% savings, requires checkpointing). "
        f"Step 5: Propose architecture changes: "
        f"{random.choice(['serverless for bursty workloads', 'data tiering for cold storage', 'CDN for static assets', 'connection pooling to reduce instance count'])}.",
    ]
    return random.choice(templates)


# --- Governance edge case generators (100 total) ---

def gen_governance_conflict() -> str:
    templates = [
        f"CONFLICTING CLAIM: Previous assertion states {random.choice(TECH_DOMAINS)} cluster "
        f"is running version {random.randint(1, 3)}.{random.randint(0, 9)}.{random.randint(0, 9)}, "
        f"but new telemetry indicates version {random.randint(4, 6)}.{random.randint(0, 9)}.{random.randint(0, 9)}. "
        f"Source: automated inventory scan at {random.choice(['2026-05-01T14:30:00Z', '2026-05-02T09:15:00Z'])}. "
        f"Resolution required: determine which version is authoritative and retract the incorrect claim. "
        f"Impact: {random.randint(3, 12)} dependent claims reference the version number.",

        f"CONTRADICTING POLICY: Team A asserts {random.choice(SECURITY_POLICIES)} applies to "
        f"all environments including development. Team B asserts development environments are "
        f"exempt per exception granted on {random.choice(['2026-03-15', '2026-04-01'])}. "
        f"No documented exception exists in the policy registry. "
        f"Governance action required: validate exception claim, update policy registry, "
        f"notify affected teams of authoritative ruling.",
    ]
    return random.choice(templates)


def gen_governance_violation() -> str:
    templates = [
        f"POLICY VIOLATION DETECTED: Service '{random.choice(['user-api', 'billing-worker', 'analytics-ingest', 'notification-service'])}' "
        f"deployed to production without required {random.choice(['security scan', 'load test', 'architecture review', 'data classification'])}. "
        f"Deployment ID: deploy-{hex(random.randint(0x100000, 0xFFFFFF))[2:]}. "
        f"Deployer: ci-pipeline (automated). Policy: {random.choice(SECURITY_POLICIES)}. "
        f"Required action: quarantine deployment, trigger retroactive compliance check, "
        f"investigate CI pipeline policy enforcement gap.",

        f"UNAUTHORIZED ACCESS ATTEMPT: Agent 'external-tool-{random.randint(1, 20)}' "
        f"attempted to modify governance configuration "
        f"'{random.choice(['trust_level', 'policy_enforcement', 'audit_retention', 'tenant_scope'])}'. "
        f"Agent trust level: {random.choice(['untrusted', 'probationary'])}. "
        f"Required trust level: admin. Request denied. "
        f"Incident logged. Pattern analysis: {random.randint(1, 5)} similar attempts "
        f"in the last {random.randint(1, 24)} hours from same agent identity.",
    ]
    return random.choice(templates)


def gen_governance_tamper() -> str:
    templates = [
        f"TAMPER ATTEMPT: Direct modification detected on "
        f"'{random.choice(['lg_checkpoints', 'lg_store_items', 'lg_pending_writes', 'projection_metadata'])}' table. "
        f"Operation: {random.choice(['UPDATE', 'INSERT', 'DELETE'])}. "
        f"Expected hash: {hex(random.randint(0x10000000, 0xFFFFFFFF))[2:]}...{hex(random.randint(0x10000000, 0xFFFFFFFF))[2:]}. "
        f"Actual hash: {hex(random.randint(0x10000000, 0xFFFFFFFF))[2:]}...{hex(random.randint(0x10000000, 0xFFFFFFFF))[2:]}. "
        f"Governance state transition: Verified -> Divergent. "
        f"All reads blocked until projection rebuild from chain completes. "
        f"Estimated rebuild time: {random.randint(500, 30000)}ms for "
        f"{random.randint(100, 10000)} chain entries.",
    ]
    return random.choice(templates)


def gen_governance_cross_tenant() -> str:
    tenants = ["tenant-alpha", "tenant-beta", "tenant-gamma", "tenant-delta"]
    source = random.choice(tenants)
    target = random.choice([t for t in tenants if t != source])
    templates = [
        f"CROSS-TENANT PROBE: Request from {source} attempting to read checkpoint data "
        f"belonging to {target}. Thread ID: benchmark-{target}-{random.randint(1, 100)}. "
        f"Method: {random.choice(['getTuple with explicit thread_id', 'list with namespace override', 'search with injected tenant scope'])}. "
        f"Expected behavior: request rejected with LimenGovernanceError, no data returned. "
        f"Scope isolation enforced via limen_tenant_scope column filter. "
        f"Audit entry generated for security review.",

        f"SCOPE INJECTION ATTEMPT: Request includes manipulated namespace "
        f"['{source}', '__admin__', '{target}'] attempting to bypass tenant isolation. "
        f"The '__admin__' namespace segment is not recognized by the governance layer. "
        f"Expected: namespace validated against allowed patterns, request rejected, "
        f"incident flagged. Cross-tenant data exposure: zero tolerance.",
    ]
    return random.choice(templates)


def generate_all():
    items = []
    item_id = 0

    # --- 300 Claims ---
    claim_generators = [
        gen_tech_fact, gen_business_decision, gen_project_status,
        gen_architecture_choice, gen_security_policy,
    ]
    for i in range(300):
        item_id += 1
        gen = claim_generators[i % len(claim_generators)]
        complexity = pick_complexity()
        content = gen()
        items.append({
            "id": item_id,
            "type": "claim",
            "content": content,
            "metadata": {
                "complexity": complexity,
                "tokens_est": random_token_est(complexity),
                "subcategory": gen.__name__.replace("gen_", ""),
            },
        })

    # --- 200 Queries ---
    query_generators = [gen_customer_support_query, gen_technical_query, gen_status_inquiry]
    for i in range(200):
        item_id += 1
        gen = query_generators[i % len(query_generators)]
        complexity = pick_complexity()
        content = gen()
        items.append({
            "id": item_id,
            "type": "query",
            "content": content,
            "metadata": {
                "complexity": complexity,
                "tokens_est": random_token_est(complexity),
                "subcategory": gen.__name__.replace("gen_", ""),
            },
        })

    # --- 150 Reasoning chains ---
    for i in range(150):
        item_id += 1
        complexity = random.choices(["medium", "high"], weights=[0.4, 0.6])[0]
        content = gen_reasoning_chain()
        items.append({
            "id": item_id,
            "type": "reasoning",
            "content": content,
            "metadata": {
                "complexity": complexity,
                "tokens_est": random_token_est(complexity),
                "chain_steps": random.randint(3, 7),
            },
        })

    # --- 100 Governance edge cases ---
    gov_generators = [
        (gen_governance_conflict, "conflicting_info"),
        (gen_governance_violation, "policy_violation"),
        (gen_governance_tamper, "tamper_attempt"),
        (gen_governance_cross_tenant, "cross_tenant_probe"),
    ]
    for i in range(100):
        item_id += 1
        gen, subcat = gov_generators[i % len(gov_generators)]
        complexity = random.choices(["medium", "high"], weights=[0.3, 0.7])[0]
        content = gen()
        items.append({
            "id": item_id,
            "type": "governance",
            "content": content,
            "metadata": {
                "complexity": complexity,
                "tokens_est": random_token_est(complexity),
                "subcategory": subcat,
            },
        })

    return items


def main():
    items = generate_all()
    assert len(items) == 750, f"Expected 750, got {len(items)}"

    with open(OUTPUT, "w") as f:
        for item in items:
            f.write(json.dumps(item) + "\n")

    # Report distribution
    from collections import Counter
    type_counts = Counter(item["type"] for item in items)
    print(f"Generated {OUTPUT}: {len(items)} items")
    for t, c in sorted(type_counts.items()):
        print(f"  {t}: {c}")

    # Token estimate stats
    token_ests = [item["metadata"]["tokens_est"] for item in items]
    print(f"  Token estimates: min={min(token_ests)}, max={max(token_ests)}, avg={sum(token_ests)/len(token_ests):.0f}")


if __name__ == "__main__":
    main()
