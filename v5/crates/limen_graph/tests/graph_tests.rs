use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tokio::sync::RwLock;
use tower::ServiceExt;

use limen_graph::api::{graph_router, SharedStore};
use limen_graph::seed::seed_demo_data;
use limen_graph::store::InMemoryGraphStore;
use limen_graph::types::{NodeLifecycleState, GraphNode, GraphStats, NodeFilter, NodeType};

fn seeded_store() -> InMemoryGraphStore {
    let mut store = InMemoryGraphStore::new();
    seed_demo_data(&mut store);
    store
}

fn shared_store() -> SharedStore {
    Arc::new(RwLock::new(seeded_store()))
}

#[test]
fn test_seed_counts() {
    let store = seeded_store();
    let stats = store.stats();
    assert_eq!(stats.total_nodes, 250);
    assert_eq!(stats.total_edges, 500);
    assert_eq!(stats.nodes_by_type.belief, 100);
    assert_eq!(stats.nodes_by_type.governance, 40);
    assert_eq!(stats.nodes_by_type.authority, 30);
    assert_eq!(stats.nodes_by_type.refusal, 80);
}

#[test]
fn test_query_by_state() {
    let store = seeded_store();
    let filter = NodeFilter {
        governance_state: Some(NodeLifecycleState::Active),
        ..Default::default()
    };
    let results = store.query_nodes(&filter);
    assert!(!results.is_empty());
    for node in &results {
        assert_eq!(node.governance_state, NodeLifecycleState::Active);
    }
}

#[test]
fn test_query_by_tenant() {
    let store = seeded_store();
    let filter = NodeFilter {
        tenant_scope: Some("tenant-alpha".to_string()),
        limit: Some(200),
        ..Default::default()
    };
    let results = store.query_nodes(&filter);
    assert!(!results.is_empty());
    for node in &results {
        assert_eq!(node.tenant_scope, "tenant-alpha");
    }
}

#[test]
fn test_query_edges() {
    let store = seeded_store();
    let edges = store.query_edges("belief-0000");
    assert!(!edges.is_empty());
    for edge in &edges {
        assert!(edge.source_id == "belief-0000" || edge.target_id == "belief-0000");
    }
}

#[test]
fn test_stats() {
    let store = seeded_store();
    let stats = store.stats();
    assert_eq!(stats.total_nodes, 250);
    assert_eq!(stats.total_edges, 500);
    assert!(stats.avg_confidence > 0.0);
    assert!(stats.avg_confidence < 1.0);
}

#[test]
fn test_confidence_filter() {
    let store = seeded_store();
    let filter = NodeFilter {
        min_confidence: Some(0.9),
        limit: Some(200),
        ..Default::default()
    };
    let results = store.query_nodes(&filter);
    assert!(!results.is_empty());
    for node in &results {
        assert!(node.confidence >= 0.9);
    }
}

#[tokio::test]
async fn test_api_get_nodes() {
    let store = shared_store();
    let app = graph_router(store);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/graph/nodes?limit=10")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let nodes: Vec<GraphNode> = serde_json::from_slice(&body).unwrap();
    assert_eq!(nodes.len(), 10);
}

#[tokio::test]
async fn test_api_get_edges() {
    let store = shared_store();
    let app = graph_router(store);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/graph/edges?node_id=belief-0000")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let edges: Vec<limen_graph::types::GraphEdge> = serde_json::from_slice(&body).unwrap();
    assert!(!edges.is_empty());
}

#[tokio::test]
async fn test_api_get_stats() {
    let store = shared_store();
    let app = graph_router(store);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/graph/stats")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let stats: GraphStats = serde_json::from_slice(&body).unwrap();
    assert_eq!(stats.total_nodes, 250);
    assert_eq!(stats.total_edges, 500);
}

#[tokio::test]
async fn test_api_post_query() {
    let store = shared_store();
    let app = graph_router(store);

    let query = serde_json::json!({
        "filters": [
            { "node_type": "belief", "min_confidence": 0.9, "limit": 5 }
        ],
        "limit": 5
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/graph/query")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&query).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let nodes: Vec<GraphNode> = serde_json::from_slice(&body).unwrap();
    assert!(!nodes.is_empty());
    assert!(nodes.len() <= 5);
    for node in &nodes {
        assert_eq!(node.node_type, NodeType::Belief);
        assert!(node.confidence >= 0.9);
    }
}

// F-009: Missing node_id returns 400
#[tokio::test]
async fn test_api_get_edges_missing_node_id() {
    let store = shared_store();
    let app = graph_router(store);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/graph/edges")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

// F-004/F-009: Too many filters returns 400
#[tokio::test]
async fn test_api_post_query_too_many_filters() {
    let store = shared_store();
    let app = graph_router(store);

    // Build 21 filters (max is 20)
    let filters: Vec<serde_json::Value> = (0..21)
        .map(|_| serde_json::json!({ "node_type": "belief" }))
        .collect();
    let query = serde_json::json!({ "filters": filters });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/graph/query")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&query).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

// F-009: Empty scenario returns 400
#[tokio::test]
async fn test_api_simulator_empty_scenario() {
    let store = shared_store();
    let app = graph_router(store);

    let req = serde_json::json!({
        "policy": { "governed": true, "max_cascade_depth": 3, "auto_retract_threshold": 0.5, "tamper_action": "block" },
        "scenario": [],
        "initial_state": "verified"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/simulator/run")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&req).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

// F-004/F-009: Too many simulations returns 400
#[tokio::test]
async fn test_api_simulator_compare_too_many() {
    let store = shared_store();
    let app = graph_router(store);

    let single = serde_json::json!({
        "policy": { "governed": true, "max_cascade_depth": 3, "auto_retract_threshold": 0.5, "tamper_action": "block" },
        "scenario": [{"action": "claim", "data": {}}],
        "initial_state": "verified"
    });
    // Build 11 simulations (max is 10)
    let reqs: Vec<serde_json::Value> = (0..11).map(|_| single.clone()).collect();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/simulator/compare")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&reqs).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
