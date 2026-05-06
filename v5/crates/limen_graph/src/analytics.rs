use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::store::InMemoryGraphStore;
use crate::types::{NodeLifecycleState, NodeType};

/// Daily refusal count for trend analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyRefusalCount {
    pub day: String,
    pub count: u64,
    pub rate: f64,
}

/// Filter for refusal analytics queries.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RefusalFilter {
    pub tenant_scope: Option<String>,
    pub governance_state: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

/// Aggregate refusal analytics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefusalAnalytics {
    pub total_refusals: u64,
    pub refusal_rate: f64,
    pub top_reasons: Vec<(String, u64)>,
    pub by_governance_state: BTreeMap<String, u64>,
    pub by_tenant: BTreeMap<String, u64>,
    pub trend: Vec<DailyRefusalCount>,
    pub governance_impact_score: f64,
}

/// Compute refusal analytics from the graph store.
pub fn compute_refusal_analytics(
    store: &InMemoryGraphStore,
    filter: &RefusalFilter,
) -> RefusalAnalytics {
    let all_nodes = store.all_nodes();

    let refusal_nodes: Vec<_> = all_nodes
        .iter()
        .filter(|n| n.node_type == NodeType::Refusal)
        .filter(|n| {
            if let Some(ref tenant) = filter.tenant_scope {
                if &n.tenant_scope != tenant {
                    return false;
                }
            }
            if let Some(ref state) = filter.governance_state {
                let node_state = format!("{:?}", n.governance_state).to_lowercase();
                if &node_state != state {
                    return false;
                }
            }
            if let Some(ref start) = filter.start_date {
                if n.created_at.as_str() < start.as_str() {
                    return false;
                }
            }
            if let Some(ref end) = filter.end_date {
                if n.created_at.as_str() > end.as_str() {
                    return false;
                }
            }
            true
        })
        .collect();

    let total_refusals = refusal_nodes.len() as u64;

    // Non-refusal reads = all non-refusal nodes (approximation: each node represents a read)
    let non_refusal_reads = all_nodes
        .iter()
        .filter(|n| n.node_type != NodeType::Refusal)
        .count() as u64;
    let total_reads = total_refusals + non_refusal_reads;
    let refusal_rate = if total_reads == 0 {
        0.0
    } else {
        total_refusals as f64 / total_reads as f64
    };

    // Top reasons: group by label (the label encodes the reason)
    let mut reason_counts: BTreeMap<String, u64> = BTreeMap::new();
    for node in &refusal_nodes {
        // Extract base reason from label (strip trailing " #N")
        let reason = extract_reason(&node.label);
        *reason_counts.entry(reason).or_insert(0) += 1;
    }
    let mut top_reasons: Vec<(String, u64)> = reason_counts.into_iter().collect();
    top_reasons.sort_by(|a, b| b.1.cmp(&a.1));

    // By governance state
    let mut by_governance_state: BTreeMap<String, u64> = BTreeMap::new();
    for node in &refusal_nodes {
        let state_str = format!("{:?}", node.governance_state).to_lowercase();
        *by_governance_state.entry(state_str).or_insert(0) += 1;
    }

    // By tenant
    let mut by_tenant: BTreeMap<String, u64> = BTreeMap::new();
    for node in &refusal_nodes {
        *by_tenant.entry(node.tenant_scope.clone()).or_insert(0) += 1;
    }

    // Trend: group by day (extract YYYY-MM-DD from created_at)
    let mut daily_counts: BTreeMap<String, u64> = BTreeMap::new();
    for node in &refusal_nodes {
        let day = node.created_at.get(..10).unwrap_or("unknown").to_string();
        *daily_counts.entry(day).or_insert(0) += 1;
    }

    // Compute daily rates (approximate: total_reads spread evenly across days)
    let num_days = daily_counts.len().max(1) as u64;
    let reads_per_day = if num_days > 0 {
        total_reads / num_days
    } else {
        1
    };

    let trend: Vec<DailyRefusalCount> = daily_counts
        .into_iter()
        .map(|(day, count)| {
            let rate = if reads_per_day == 0 {
                0.0
            } else {
                count as f64 / reads_per_day as f64
            };
            DailyRefusalCount { day, count, rate }
        })
        .collect();

    // Governance impact score: refusals in governed states / total actions * 100
    let governed_refusals = refusal_nodes
        .iter()
        .filter(|n| matches!(n.governance_state, NodeLifecycleState::Active | NodeLifecycleState::Suspended))
        .count() as f64;
    let total_actions = all_nodes.len().max(1) as f64;
    let governance_impact_score = (governed_refusals / total_actions) * 100.0;

    RefusalAnalytics {
        total_refusals,
        refusal_rate,
        top_reasons,
        by_governance_state,
        by_tenant,
        trend,
        governance_impact_score,
    }
}

/// Compute refusal trends for N days.
pub fn compute_refusal_trends(store: &InMemoryGraphStore, days: usize) -> Vec<DailyRefusalCount> {
    let all_nodes = store.all_nodes();
    let total_non_refusal = all_nodes
        .iter()
        .filter(|n| n.node_type != NodeType::Refusal)
        .count() as u64;

    let mut daily_counts: BTreeMap<String, u64> = BTreeMap::new();
    for node in all_nodes.iter().filter(|n| n.node_type == NodeType::Refusal) {
        let day = node.created_at.get(..10).unwrap_or("unknown").to_string();
        *daily_counts.entry(day).or_insert(0) += 1;
    }

    let total_refusals: u64 = daily_counts.values().sum();
    let total_reads = total_refusals + total_non_refusal;
    let num_days = daily_counts.len().max(1) as u64;
    let reads_per_day = total_reads / num_days;

    let mut trend: Vec<DailyRefusalCount> = daily_counts
        .into_iter()
        .map(|(day, count)| {
            let rate = if reads_per_day == 0 {
                0.0
            } else {
                count as f64 / reads_per_day as f64
            };
            DailyRefusalCount { day, count, rate }
        })
        .collect();

    // Take last N days (sorted descending by date, take N, then reverse)
    trend.sort_by(|a, b| b.day.cmp(&a.day));
    trend.truncate(days);
    trend.reverse();
    trend
}

/// Extract reason from a refusal label like "Policy violation block #5".
fn extract_reason(label: &str) -> String {
    // Strip trailing " #N" pattern
    if let Some(pos) = label.rfind(" #") {
        let suffix = &label[pos + 2..];
        if suffix.chars().all(|c| c.is_ascii_digit()) {
            return label[..pos].to_string();
        }
    }
    label.to_string()
}
