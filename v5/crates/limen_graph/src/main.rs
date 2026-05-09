// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
use std::sync::Arc;
use tokio::sync::RwLock;

use limen_graph::api::{full_router, AppState, SharedState};
use limen_graph::seed::{seed_demo_data, seed_versioning_data};
use limen_graph::store::InMemoryGraphStore;
use limen_graph::versioning::BeliefVersionStore;

#[tokio::main]
async fn main() {
    let mut graph_store = InMemoryGraphStore::new();
    seed_demo_data(&mut graph_store);

    let mut version_store = BeliefVersionStore::new();
    seed_versioning_data(&mut version_store);

    let stats = graph_store.stats();
    println!(
        "Limen Graph API starting: {} nodes, {} edges",
        stats.total_nodes, stats.total_edges
    );

    let state: SharedState = Arc::new(AppState {
        graph: RwLock::new(graph_store),
        versioning: RwLock::new(version_store),
    });
    let app = full_router(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001")
        .await
        .expect("Failed to bind to port 3001");

    println!("Listening on http://0.0.0.0:3001");
    axum::serve(listener, app).await.expect("Server error");
}
