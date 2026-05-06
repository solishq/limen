use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tokio::sync::RwLock;
use tower::ServiceExt;

use limen_graph::analytics::{compute_refusal_analytics, compute_refusal_trends, RefusalFilter};
use limen_graph::api::{full_router, AppState, SharedState};
use limen_graph::seed::{seed_demo_data, seed_versioning_data};
use limen_graph::store::InMemoryGraphStore;
use limen_graph::versioning::{BeliefVersionStore, MergeResult};

fn seeded_state() -> SharedState {
    let mut graph = InMemoryGraphStore::new();
    seed_demo_data(&mut graph);
    let mut versioning = BeliefVersionStore::new();
    seed_versioning_data(&mut versioning);
    Arc::new(AppState {
        graph: RwLock::new(graph),
        versioning: RwLock::new(versioning),
    })
}

fn seeded_graph_store() -> InMemoryGraphStore {
    let mut store = InMemoryGraphStore::new();
    seed_demo_data(&mut store);
    store
}

// --- Unit tests for analytics ---

#[test]
fn test_refusal_analytics_counts() {
    let store = seeded_graph_store();
    let filter = RefusalFilter::default();
    let analytics = compute_refusal_analytics(&store, &filter);

    // 30 original + 50 extended = 80 total refusals
    assert_eq!(analytics.total_refusals, 80);
    assert!(analytics.refusal_rate > 0.0);
    assert!(analytics.refusal_rate < 1.0);
    assert!(!analytics.top_reasons.is_empty());
    assert!(!analytics.by_tenant.is_empty());
    assert!(!analytics.by_governance_state.is_empty());
    assert!(analytics.governance_impact_score >= 0.0);
    assert!(analytics.governance_impact_score <= 100.0);
}

#[test]
fn test_refusal_trends_30_days() {
    let store = seeded_graph_store();
    let trends = compute_refusal_trends(&store, 30);

    assert!(!trends.is_empty());
    assert!(trends.len() <= 30);
    for trend in &trends {
        assert!(!trend.day.is_empty());
        assert!(trend.count > 0);
        assert!(trend.rate >= 0.0);
    }
    // Verify sorted ascending by day
    for window in trends.windows(2) {
        assert!(window[0].day <= window[1].day);
    }
}

#[test]
fn test_refusal_filter_by_tenant() {
    let store = seeded_graph_store();
    let filter = RefusalFilter {
        tenant_scope: Some("tenant-alpha".to_string()),
        ..Default::default()
    };
    let analytics = compute_refusal_analytics(&store, &filter);

    // Only tenant-alpha refusals
    assert!(analytics.total_refusals > 0);
    assert!(analytics.total_refusals < 80); // Less than all
    // All by_tenant entries should be tenant-alpha
    for (tenant, _) in &analytics.by_tenant {
        assert_eq!(tenant, "tenant-alpha");
    }
}

// --- Unit tests for versioning ---

#[test]
fn test_belief_versions_history() {
    let mut store = BeliefVersionStore::new();
    seed_versioning_data(&mut store);

    let versions = store.get_versions("belief-ver-001").unwrap();
    // 4 main versions + 1 branch version = 5
    assert_eq!(versions.len(), 5);
    assert_eq!(versions[0].belief_id, "belief-ver-001");
}

#[test]
fn test_belief_branch_creation() {
    let mut store = BeliefVersionStore::new();
    seed_versioning_data(&mut store);

    let request = limen_graph::versioning::BranchRequest {
        belief_id: "belief-ver-002".to_string(),
        branch_name: "feature-x".to_string(),
    };
    let branch = store.create_branch(&request).unwrap();

    assert_eq!(branch.name, "feature-x");
    assert!(!branch.versions.is_empty());
    assert_eq!(branch.versions[0].belief_id, "belief-ver-002");
    assert_eq!(branch.versions[0].branch_name.as_deref(), Some("feature-x"));
}

#[test]
fn test_belief_merge_take_source() {
    let mut store = BeliefVersionStore::new();
    seed_versioning_data(&mut store);

    // Branches seeded: branch-seed-0000 (experimental on belief-ver-001)
    //                   branch-seed-0001 (hotfix on belief-ver-003)
    // Create a second branch on belief-ver-001 so we can merge them
    let request = limen_graph::versioning::BranchRequest {
        belief_id: "belief-ver-001".to_string(),
        branch_name: "target-branch".to_string(),
    };
    let target = store.create_branch(&request).unwrap();

    let merge_req = limen_graph::versioning::MergeRequest {
        source_branch: "branch-seed-0000".to_string(),
        target_branch: target.branch_id.clone(),
        conflict_resolution: limen_graph::versioning::ConflictResolution::TakeSource,
    };
    let result = store.merge_branches(&merge_req).unwrap();

    assert_eq!(result.resolution_strategy, "take_source");
    assert_eq!(result.merged_version.belief_id, "belief-ver-001");
}

#[test]
fn test_belief_merge_take_higher_confidence() {
    let mut store = BeliefVersionStore::new();
    seed_versioning_data(&mut store);

    // Create two branches on same belief for merging
    let req1 = limen_graph::versioning::BranchRequest {
        belief_id: "belief-ver-002".to_string(),
        branch_name: "high-conf".to_string(),
    };
    let branch1 = store.create_branch(&req1).unwrap();

    let req2 = limen_graph::versioning::BranchRequest {
        belief_id: "belief-ver-002".to_string(),
        branch_name: "low-conf".to_string(),
    };
    let branch2 = store.create_branch(&req2).unwrap();

    let merge_req = limen_graph::versioning::MergeRequest {
        source_branch: branch1.branch_id.clone(),
        target_branch: branch2.branch_id.clone(),
        conflict_resolution: limen_graph::versioning::ConflictResolution::TakeHigherConfidence,
    };
    let result = store.merge_branches(&merge_req).unwrap();
    assert_eq!(result.resolution_strategy, "take_higher_confidence");
    assert!(result.merged_version.confidence > 0.0);
}

// --- API endpoint tests ---

#[tokio::test]
async fn test_api_refusals_analytics() {
    let state = seeded_state();
    let app = full_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/refusals/analytics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let analytics: limen_graph::analytics::RefusalAnalytics = serde_json::from_slice(&body).unwrap();
    assert_eq!(analytics.total_refusals, 80);
}

#[tokio::test]
async fn test_api_refusals_trends() {
    let state = seeded_state();
    let app = full_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/refusals/trends?days=10")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let trends: Vec<limen_graph::analytics::DailyRefusalCount> =
        serde_json::from_slice(&body).unwrap();
    assert!(!trends.is_empty());
    assert!(trends.len() <= 10);
}

#[tokio::test]
async fn test_api_belief_versions() {
    let state = seeded_state();
    let app = full_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/beliefs/versions?belief_id=belief-ver-001")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let versions: Vec<limen_graph::versioning::BeliefVersion> =
        serde_json::from_slice(&body).unwrap();
    assert_eq!(versions.len(), 5); // 4 main + 1 branch
}

#[tokio::test]
async fn test_belief_unknown_id_404() {
    let state = seeded_state();
    let app = full_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/beliefs/versions?belief_id=nonexistent-belief")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_api_belief_branch_creation() {
    let state = seeded_state();
    let app = full_router(state);

    let body = serde_json::json!({
        "belief_id": "belief-ver-002",
        "branch_name": "new-experiment"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/beliefs/branch")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let branch: limen_graph::versioning::BeliefBranch = serde_json::from_slice(&body).unwrap();
    assert_eq!(branch.name, "new-experiment");
    assert!(!branch.versions.is_empty());
}

#[tokio::test]
async fn test_api_belief_merge() {
    let state = seeded_state();
    let app = full_router(state.clone());

    // First, create a target branch
    let branch_body = serde_json::json!({
        "belief_id": "belief-ver-001",
        "branch_name": "merge-target"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/beliefs/branch")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&branch_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let target_branch: limen_graph::versioning::BeliefBranch =
        serde_json::from_slice(&body_bytes).unwrap();

    // Now merge
    let merge_body = serde_json::json!({
        "source_branch": "branch-seed-0000",
        "target_branch": target_branch.branch_id,
        "conflict_resolution": "take_source"
    });

    let app2 = full_router(state);
    let response = app2
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/beliefs/merge")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&merge_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let result: MergeResult = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(result.resolution_strategy, "take_source");
}

#[tokio::test]
async fn test_api_belief_versions_missing_param() {
    let state = seeded_state();
    let app = full_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/beliefs/versions")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
