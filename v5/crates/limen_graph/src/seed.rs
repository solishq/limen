// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
use crate::store::InMemoryGraphStore;
use crate::types::{EdgeType, NodeLifecycleState, GraphEdge, GraphNode, NodeType};
use crate::versioning::{BeliefBranch, BeliefVersion, BeliefVersionStore};

const TENANTS: &[&str] = &["tenant-alpha", "tenant-beta", "tenant-gamma", "tenant-delta"];

const BELIEF_LABELS: &[&str] = &[
    "User preference observed",
    "System pattern detected",
    "Behavioral correlation",
    "Temporal pattern",
    "Causal inference",
    "Statistical anomaly",
    "Confidence threshold met",
    "Cluster membership",
    "Feature importance",
    "Decision boundary",
];

const GOVERNANCE_LABELS: &[&str] = &[
    "Policy enforcement rule",
    "Access control boundary",
    "Rate limit policy",
    "Data retention rule",
    "Audit trail requirement",
    "Compliance checkpoint",
    "Escalation threshold",
    "Review gate",
];

const AUTHORITY_LABELS: &[&str] = &[
    "Root authority delegation",
    "Scoped permission grant",
    "Time-bounded access",
    "Conditional authority",
    "Inherited privilege",
    "Cross-tenant authority",
];

const REFUSAL_LABELS: &[&str] = &[
    "Policy violation block",
    "Confidence too low",
    "Authority insufficient",
    "Rate limit exceeded",
    "Governance state invalid",
    "Tenant scope mismatch",
];

const GOVERNANCE_STATES: &[NodeLifecycleState] = &[
    NodeLifecycleState::Active,
    NodeLifecycleState::Active,
    NodeLifecycleState::Active,
    NodeLifecycleState::Suspended,
    NodeLifecycleState::Pending,
    NodeLifecycleState::Revoked,
    NodeLifecycleState::Archived,
];

/// Extended refusal reasons for the 50 seeded refusal events.
const REFUSAL_REASONS: &[&str] = &[
    "governance_blocked",
    "tamper_detected",
    "confidence_below_threshold",
    "policy_violation",
    "cross_tenant_attempt",
];

/// Seeds the store with 250 nodes (200 original + 50 extended refusals) and 500 edges.
pub fn seed_demo_data(store: &mut InMemoryGraphStore) {
    // Generate 100 belief nodes
    for i in 0..100 {
        let label = BELIEF_LABELS[i % BELIEF_LABELS.len()];
        let tenant = TENANTS[i % TENANTS.len()];
        let state = GOVERNANCE_STATES[i % GOVERNANCE_STATES.len()];
        let confidence = 0.3 + (i as f64 * 0.007); // Range: 0.3 to 0.993

        store.add_node(GraphNode {
            id: format!("belief-{:04}", i),
            node_type: NodeType::Belief,
            label: format!("{} #{}", label, i),
            tenant_scope: tenant.to_string(),
            governance_state: state,
            confidence,
            created_at: format!("2026-05-{:02}T{:02}:00:00Z", (i % 28) + 1, i % 24),
            metadata: serde_json::json!({ "source": "seed", "index": i }),
        });
    }

    // Generate 40 governance nodes
    for i in 0..40 {
        let label = GOVERNANCE_LABELS[i % GOVERNANCE_LABELS.len()];
        let tenant = TENANTS[i % TENANTS.len()];
        let state = GOVERNANCE_STATES[i % GOVERNANCE_STATES.len()];
        let confidence = 0.7 + (i as f64 * 0.007);

        store.add_node(GraphNode {
            id: format!("governance-{:04}", i),
            node_type: NodeType::Governance,
            label: format!("{} #{}", label, i),
            tenant_scope: tenant.to_string(),
            governance_state: state,
            confidence: confidence.min(0.99),
            created_at: format!("2026-05-{:02}T{:02}:30:00Z", (i % 28) + 1, i % 24),
            metadata: serde_json::json!({ "source": "seed", "policy_version": i / 10 }),
        });
    }

    // Generate 30 authority nodes
    for i in 0..30 {
        let label = AUTHORITY_LABELS[i % AUTHORITY_LABELS.len()];
        let tenant = TENANTS[i % TENANTS.len()];
        let state = GOVERNANCE_STATES[i % GOVERNANCE_STATES.len()];
        let confidence = 0.8 + (i as f64 * 0.005);

        store.add_node(GraphNode {
            id: format!("authority-{:04}", i),
            node_type: NodeType::Authority,
            label: format!("{} #{}", label, i),
            tenant_scope: tenant.to_string(),
            governance_state: state,
            confidence: confidence.min(0.99),
            created_at: format!("2026-05-{:02}T{:02}:15:00Z", (i % 28) + 1, i % 24),
            metadata: serde_json::json!({ "source": "seed", "delegation_depth": i % 4 }),
        });
    }

    // Generate 30 refusal nodes (original set)
    for i in 0..30 {
        let label = REFUSAL_LABELS[i % REFUSAL_LABELS.len()];
        let tenant = TENANTS[i % TENANTS.len()];
        let state = GOVERNANCE_STATES[i % GOVERNANCE_STATES.len()];
        let confidence = 0.9 + (i as f64 * 0.003);

        store.add_node(GraphNode {
            id: format!("refusal-{:04}", i),
            node_type: NodeType::Refusal,
            label: format!("{} #{}", label, i),
            tenant_scope: tenant.to_string(),
            governance_state: state,
            confidence: confidence.min(0.99),
            created_at: format!("2026-05-{:02}T{:02}:45:00Z", (i % 28) + 1, i % 24),
            metadata: {
                let severities = ["low", "medium", "high"];
                serde_json::json!({
                    "source": "seed",
                    "severity": severities[i % 3],
                    "reason": REFUSAL_REASONS[i % REFUSAL_REASONS.len()]
                })
            },
        });
    }

    // Generate 50 additional refusal events with varied reasons
    for i in 0..50 {
        let reason = REFUSAL_REASONS[i % REFUSAL_REASONS.len()];
        let tenant = TENANTS[i % TENANTS.len()];
        let state = GOVERNANCE_STATES[i % GOVERNANCE_STATES.len()];
        let confidence = 0.85 + (i as f64 * 0.002);

        store.add_node(GraphNode {
            id: format!("refusal-ext-{:04}", i),
            node_type: NodeType::Refusal,
            label: format!("{} #{}", reason, i),
            tenant_scope: tenant.to_string(),
            governance_state: state,
            confidence: confidence.min(0.99),
            created_at: format!("2026-04-{:02}T{:02}:30:00Z", (i % 28) + 1, i % 24),
            metadata: {
                let severities = ["low", "medium", "high", "critical"];
                serde_json::json!({
                    "source": "seed_extended",
                    "reason": reason,
                    "severity": severities[i % 4]
                })
            },
        });
    }

    // Generate 500 edges with deterministic patterns
    let edge_types = [
        EdgeType::Provenance,
        EdgeType::Governance,
        EdgeType::Cascade,
        EdgeType::Refusal,
    ];
    let all_node_ids: Vec<String> = (0..100)
        .map(|i| format!("belief-{:04}", i))
        .chain((0..40).map(|i| format!("governance-{:04}", i)))
        .chain((0..30).map(|i| format!("authority-{:04}", i)))
        .chain((0..30).map(|i| format!("refusal-{:04}", i)))
        .collect();

    for i in 0..500 {
        let source_idx = i % all_node_ids.len();
        let target_idx = (i * 7 + 13) % all_node_ids.len();
        // Avoid self-edges
        let target_idx = if source_idx == target_idx {
            (target_idx + 1) % all_node_ids.len()
        } else {
            target_idx
        };

        let edge_type = edge_types[i % edge_types.len()];
        let weight = 0.1 + ((i % 10) as f64 * 0.09);

        let label = match edge_type {
            EdgeType::Provenance => format!("derived-from-{}", i),
            EdgeType::Governance => format!("governed-by-{}", i),
            EdgeType::Cascade => format!("cascades-to-{}", i),
            EdgeType::Refusal => format!("refused-by-{}", i),
        };

        store.add_edge(GraphEdge {
            id: format!("edge-{:04}", i),
            edge_type,
            source_id: all_node_ids[source_idx].clone(),
            target_id: all_node_ids[target_idx].clone(),
            weight,
            label,
            created_at: format!("2026-05-{:02}T{:02}:{:02}:00Z", (i % 28) + 1, i % 24, i % 60),
        });
    }
}

/// Seeds the belief versioning store with 20 versions across 5 beliefs and 2 branches.
pub fn seed_versioning_data(store: &mut BeliefVersionStore) {
    let belief_ids = [
        "belief-ver-001",
        "belief-ver-002",
        "belief-ver-003",
        "belief-ver-004",
        "belief-ver-005",
    ];
    let states = ["active", "pending", "active", "suspended", "active"];

    // Create 4 versions per belief (20 total), on main branch
    for (bi, belief_id) in belief_ids.iter().enumerate() {
        for vi in 0..4 {
            let version_idx = bi * 4 + vi;
            let parent = if vi == 0 {
                None
            } else {
                Some(format!("ver-seed-{:04}", version_idx - 1))
            };

            store.add_version(BeliefVersion {
                version_id: format!("ver-seed-{:04}", version_idx),
                belief_id: belief_id.to_string(),
                content: serde_json::json!({
                    "observation": format!("Observation v{} for {}", vi + 1, belief_id),
                    "iteration": vi + 1
                }),
                confidence: 0.5 + (vi as f64 * 0.1),
                governance_state: states[bi].to_string(),
                created_at: format!("2026-05-{:02}T{:02}:00:00Z", (version_idx % 28) + 1, version_idx % 24),
                parent_version: parent,
                branch_name: Some("main".to_string()),
            });
        }
    }

    // Create 2 branches (on belief-ver-001 and belief-ver-003)
    let branch_beliefs = [("belief-ver-001", "experimental"), ("belief-ver-003", "hotfix")];
    for (bi, (belief_id, branch_name)) in branch_beliefs.iter().enumerate() {
        let base_version_idx = bi * 2 * 4 + 3; // last version of that belief on main
        let branch_id = format!("branch-seed-{:04}", bi);

        let branch_version = BeliefVersion {
            version_id: format!("ver-branch-{:04}", bi),
            belief_id: belief_id.to_string(),
            content: serde_json::json!({
                "observation": format!("Branch {} diverged content", branch_name),
                "iteration": 5,
                "branch": branch_name
            }),
            confidence: 0.85 + (bi as f64 * 0.05),
            governance_state: "active".to_string(),
            created_at: format!("2026-05-{:02}T12:00:00Z", (bi % 28) + 1),
            parent_version: Some(format!("ver-seed-{:04}", base_version_idx)),
            branch_name: Some(branch_name.to_string()),
        };

        store.add_version(branch_version.clone());

        store.add_branch(BeliefBranch {
            branch_id,
            name: branch_name.to_string(),
            base_version: format!("ver-seed-{:04}", base_version_idx),
            versions: vec![branch_version],
            created_at: format!("2026-05-{:02}T12:00:00Z", (bi % 28) + 1),
        });
    }
}
