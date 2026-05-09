// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
use std::collections::HashSet;
use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::{Method, StatusCode},
    routing::{get, post},
    Json, Router,
};
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};

use crate::analytics::{self, DailyRefusalCount, RefusalAnalytics, RefusalFilter};
use crate::simulator::{self, SimulationRequest, SimulationResult};
use crate::store::InMemoryGraphStore;
use crate::types::{
    ErrorResponse, GraphEdge, GraphNode, GraphStats, NodeFilter, NodeLifecycleState, NodeType,
    QueryRequest,
};
use crate::versioning::{
    BeliefBranch, BeliefVersion, BeliefVersionStore, BranchRequest, MergeRequest, MergeResult,
};

/// Shared application state containing graph store and versioning store.
pub struct AppState {
    pub graph: RwLock<InMemoryGraphStore>,
    pub versioning: RwLock<BeliefVersionStore>,
}

pub type SharedState = Arc<AppState>;

/// Legacy type alias for backward compatibility with existing tests.
pub type SharedStore = Arc<RwLock<InMemoryGraphStore>>;

type ApiResult<T> = Result<Json<T>, (StatusCode, Json<ErrorResponse>)>;

fn err_response(status: StatusCode, error: impl Into<String>, detail: Option<String>) -> (StatusCode, Json<ErrorResponse>) {
    (status, Json(ErrorResponse { error: error.into(), detail }))
}

/// Query parameters for GET /graph/nodes
#[derive(Debug, serde::Deserialize)]
pub struct NodesQuery {
    pub tenant_scope: Option<String>,
    pub governance_state: Option<NodeLifecycleState>,
    pub node_type: Option<NodeType>,
    pub min_confidence: Option<f64>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

/// Query parameters for GET /graph/edges
#[derive(Debug, serde::Deserialize)]
pub struct EdgesQuery {
    pub node_id: Option<String>,
}

/// Query parameters for GET /refusals/analytics
#[derive(Debug, serde::Deserialize)]
pub struct RefusalAnalyticsQuery {
    pub tenant_scope: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

/// Query parameters for GET /refusals/trends
#[derive(Debug, serde::Deserialize)]
pub struct RefusalTrendsQuery {
    pub days: Option<usize>,
}

/// Query parameters for GET /beliefs/versions
#[derive(Debug, serde::Deserialize)]
pub struct BeliefVersionsQuery {
    pub belief_id: Option<String>,
}

/// Build the Axum router with all graph endpoints (legacy — graph store only).
pub fn graph_router(store: SharedStore) -> Router {
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_origin(Any)
        .allow_headers(Any);

    // Wrap in AppState with an empty versioning store for backward compat.
    // Extract the RwLock from Arc (unwrap is safe here — caller constructs the Arc fresh).
    let inner_lock = Arc::try_unwrap(store).unwrap_or_else(|arc| {
        // Fallback: cannot unwrap, so we block-read and clone the store
        let guard = arc.blocking_read();
        let cloned = guard.clone();
        drop(guard);
        RwLock::new(cloned)
    });
    let state: SharedState = Arc::new(AppState {
        graph: inner_lock,
        versioning: RwLock::new(BeliefVersionStore::new()),
    });

    build_router_with_state(state, cors)
}

/// Build the full router with both graph and versioning stores.
pub fn full_router(state: SharedState) -> Router {
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_origin(Any)
        .allow_headers(Any);

    build_router_with_state(state, cors)
}

fn build_router_with_state(state: SharedState, cors: CorsLayer) -> Router {
    Router::new()
        .route("/graph/nodes", get(get_nodes))
        .route("/graph/edges", get(get_edges))
        .route("/graph/stats", get(get_stats))
        .route("/graph/query", post(post_query))
        .route("/simulator/run", post(post_simulator_run))
        .route("/simulator/compare", post(post_simulator_compare))
        .route("/refusals/analytics", get(get_refusal_analytics))
        .route("/refusals/trends", get(get_refusal_trends))
        .route("/beliefs/versions", get(get_belief_versions))
        .route("/beliefs/branch", post(post_belief_branch))
        .route("/beliefs/merge", post(post_belief_merge))
        .layer(cors)
        .with_state(state)
}

async fn get_nodes(
    State(state): State<SharedState>,
    Query(params): Query<NodesQuery>,
) -> Json<Vec<GraphNode>> {
    let store = state.graph.read().await;
    let filter = NodeFilter {
        tenant_scope: params.tenant_scope,
        governance_state: params.governance_state,
        node_type: params.node_type,
        min_confidence: params.min_confidence,
        limit: Some(params.limit.unwrap_or(50)),
        offset: params.offset,
    };
    let nodes: Vec<GraphNode> = store.query_nodes(&filter).into_iter().cloned().collect();
    Json(nodes)
}

async fn get_edges(
    State(state): State<SharedState>,
    Query(params): Query<EdgesQuery>,
) -> ApiResult<Vec<GraphEdge>> {
    let node_id = match params.node_id {
        Some(id) if !id.is_empty() => id,
        _ => {
            return Err(err_response(
                StatusCode::BAD_REQUEST,
                "missing required parameter: node_id",
                None,
            ));
        }
    };
    let store = state.graph.read().await;
    let edges: Vec<GraphEdge> = store.query_edges(&node_id).into_iter().cloned().collect();
    Ok(Json(edges))
}

async fn get_stats(State(state): State<SharedState>) -> Json<GraphStats> {
    let store = state.graph.read().await;
    Json(store.stats())
}

/// Max filters per query request (F-004).
const MAX_FILTERS: usize = 20;

async fn post_query(
    State(state): State<SharedState>,
    Json(request): Json<QueryRequest>,
) -> ApiResult<Vec<GraphNode>> {
    // F-004: validate filter count
    if request.filters.len() > MAX_FILTERS {
        return Err(err_response(
            StatusCode::BAD_REQUEST,
            "too many filters",
            Some(format!("maximum {} filters allowed, got {}", MAX_FILTERS, request.filters.len())),
        ));
    }

    let store = state.graph.read().await;
    let limit = request.limit.unwrap_or(50);
    let mut results: Vec<GraphNode> = Vec::new();

    for filter in &request.filters {
        let mut f = filter.clone();
        if f.limit.is_none() {
            f.limit = Some(limit);
        }
        let nodes: Vec<GraphNode> = store.query_nodes(&f).into_iter().cloned().collect();
        results.extend(nodes);
    }

    if request.filters.is_empty() {
        let empty_filter = NodeFilter {
            limit: Some(limit),
            ..Default::default()
        };
        results = store.query_nodes(&empty_filter).into_iter().cloned().collect();
    }

    // F-008: deduplicate by node id before truncating
    let mut seen = HashSet::new();
    results.retain(|node| seen.insert(node.id.clone()));

    results.truncate(limit);
    Ok(Json(results))
}

/// Max simulations for compare endpoint (F-004).
const MAX_SIMULATIONS: usize = 10;
/// Max steps per simulation scenario (F-004).
const MAX_STEPS: usize = 10_000;

async fn post_simulator_run(
    Json(request): Json<SimulationRequest>,
) -> ApiResult<SimulationResult> {
    if request.scenario.is_empty() {
        return Err(err_response(
            StatusCode::BAD_REQUEST,
            "empty scenario",
            Some("scenario must contain at least one step".into()),
        ));
    }
    if request.scenario.len() > MAX_STEPS {
        return Err(err_response(
            StatusCode::BAD_REQUEST,
            "too many steps",
            Some(format!("maximum {} steps allowed", MAX_STEPS)),
        ));
    }
    Ok(Json(simulator::run_simulation(request)))
}

async fn post_simulator_compare(
    Json(requests): Json<Vec<SimulationRequest>>,
) -> ApiResult<Vec<SimulationResult>> {
    if requests.len() > MAX_SIMULATIONS {
        return Err(err_response(
            StatusCode::BAD_REQUEST,
            "too many simulations",
            Some(format!("maximum {} simulations allowed", MAX_SIMULATIONS)),
        ));
    }
    for (i, req) in requests.iter().enumerate() {
        if req.scenario.is_empty() {
            return Err(err_response(
                StatusCode::BAD_REQUEST,
                "empty scenario",
                Some(format!("simulation at index {} has empty scenario", i)),
            ));
        }
        if req.scenario.len() > MAX_STEPS {
            return Err(err_response(
                StatusCode::BAD_REQUEST,
                "too many steps",
                Some(format!("simulation at index {} exceeds {} steps", i, MAX_STEPS)),
            ));
        }
    }
    Ok(Json(simulator::run_comparison(requests)))
}

// --- Refusal Analytics Endpoints ---

async fn get_refusal_analytics(
    State(state): State<SharedState>,
    Query(params): Query<RefusalAnalyticsQuery>,
) -> Json<RefusalAnalytics> {
    let store = state.graph.read().await;
    let filter = RefusalFilter {
        tenant_scope: params.tenant_scope,
        governance_state: None,
        start_date: params.start_date,
        end_date: params.end_date,
    };
    Json(analytics::compute_refusal_analytics(&store, &filter))
}

async fn get_refusal_trends(
    State(state): State<SharedState>,
    Query(params): Query<RefusalTrendsQuery>,
) -> Json<Vec<DailyRefusalCount>> {
    let store = state.graph.read().await;
    let days = params.days.unwrap_or(30);
    Json(analytics::compute_refusal_trends(&store, days))
}

// --- Belief Versioning Endpoints ---

async fn get_belief_versions(
    State(state): State<SharedState>,
    Query(params): Query<BeliefVersionsQuery>,
) -> ApiResult<Vec<BeliefVersion>> {
    let belief_id = match params.belief_id {
        Some(id) if !id.is_empty() => id,
        _ => {
            return Err(err_response(
                StatusCode::BAD_REQUEST,
                "missing required parameter: belief_id",
                None,
            ));
        }
    };

    let vs = state.versioning.read().await;
    match vs.get_versions(&belief_id) {
        Some(versions) => Ok(Json(versions.clone())),
        None => Err(err_response(
            StatusCode::NOT_FOUND,
            "belief not found",
            Some(format!("no versions found for belief_id: {}", belief_id)),
        )),
    }
}

async fn post_belief_branch(
    State(state): State<SharedState>,
    Json(request): Json<BranchRequest>,
) -> ApiResult<BeliefBranch> {
    if request.belief_id.is_empty() {
        return Err(err_response(
            StatusCode::BAD_REQUEST,
            "missing required field: belief_id",
            None,
        ));
    }
    if request.branch_name.is_empty() {
        return Err(err_response(
            StatusCode::BAD_REQUEST,
            "missing required field: branch_name",
            None,
        ));
    }

    let mut vs = state.versioning.write().await;
    match vs.create_branch(&request) {
        Ok(branch) => Ok(Json(branch)),
        Err(msg) => Err(err_response(StatusCode::NOT_FOUND, msg, None)),
    }
}

async fn post_belief_merge(
    State(state): State<SharedState>,
    Json(request): Json<MergeRequest>,
) -> ApiResult<MergeResult> {
    if request.source_branch.is_empty() {
        return Err(err_response(
            StatusCode::BAD_REQUEST,
            "missing required field: source_branch",
            None,
        ));
    }
    if request.target_branch.is_empty() {
        return Err(err_response(
            StatusCode::BAD_REQUEST,
            "missing required field: target_branch",
            None,
        ));
    }

    let mut vs = state.versioning.write().await;
    match vs.merge_branches(&request) {
        Ok(result) => Ok(Json(result)),
        Err(msg) => Err(err_response(StatusCode::NOT_FOUND, msg, None)),
    }
}
