//! Programmatic generation of Grafana 10+ dashboard JSON files.
//!
//! Each generated dashboard is a valid Grafana import artifact that targets
//! a Prometheus datasource. Dashboards use simple panel types (stat, timeseries,
//! table) for maximum compatibility.
//!
//! ## Dashboards
//!
//! | File                | Content                                              |
//! |---------------------|------------------------------------------------------|
//! | `overview.json`     | Chain sequence, projection lag, governance state, error rate |
//! | `governance.json`   | State transition timeline, refusal rate, tamper detections   |
//! | `performance.json`  | Operation latencies (p50/p95/p99), throughput               |
//! | `cost.json`         | Token usage over time, cost per operation                   |

use serde_json::{json, Value};
use std::io;
use std::path::Path;

/// Grafana datasource UID used in all dashboards.
/// Operators replace this with their actual Prometheus datasource UID on import.
const DATASOURCE_UID: &str = "prometheus";
const DATASOURCE_TYPE: &str = "prometheus";

/// Generate all 4 Grafana dashboard JSON files and write them to `output_dir`.
///
/// Creates the output directory if it does not exist. Overwrites existing files.
///
/// # Errors
///
/// Returns `io::Error` if directory creation or file writing fails.
pub fn generate_dashboards(output_dir: &Path) -> io::Result<()> {
    std::fs::create_dir_all(output_dir)?;

    let dashboards: Vec<(&str, Value)> = vec![
        ("overview.json", build_overview_dashboard()),
        ("governance.json", build_governance_dashboard()),
        ("performance.json", build_performance_dashboard()),
        ("cost.json", build_cost_dashboard()),
    ];

    for (filename, dashboard) in dashboards {
        let path = output_dir.join(filename);
        let content = serde_json::to_string_pretty(&dashboard)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
        std::fs::write(path, content)?;
    }

    Ok(())
}

/// Return the names of all generated dashboard files.
pub fn dashboard_filenames() -> Vec<&'static str> {
    vec![
        "overview.json",
        "governance.json",
        "performance.json",
        "cost.json",
    ]
}

// ================================================================
// Dashboard builders
// ================================================================

// NOTE on metric names (F2 fix):
// prometheus-client appends `_total` to counters automatically.
// Registration name `chain_appends` under prefix `limen` encodes as `limen_chain_appends_total`.
// Registration name `governance_transitions` encodes as `limen_governance_transitions_total`.
// Histograms get `_bucket`, `_sum`, `_count` suffixes on the registered name.
// Gauges use the registered name as-is.

fn build_overview_dashboard() -> Value {
    let mut ref_counter = RefIdCounter::new();
    let panels = vec![
        stat_panel(
            1,
            "Chain Sequence",
            "limen_chain_latest_sequence",
            grid_pos(0, 0, 6, 4),
            &mut ref_counter,
        ),
        stat_panel(
            2,
            "Projection Lag",
            "limen_projection_lag_entries",
            grid_pos(6, 0, 6, 4),
            &mut ref_counter,
        ),
        stat_panel(
            3,
            "Governance State",
            "limen_governance_state",
            grid_pos(12, 0, 6, 4),
            &mut ref_counter,
        ),
        stat_panel(
            4,
            "Tamper Detections",
            "limen_governance_tampers_total",
            grid_pos(18, 0, 6, 4),
            &mut ref_counter,
        ),
        timeseries_panel(
            5,
            "Chain Appends / sec",
            "rate(limen_chain_appends_total[5m])",
            grid_pos(0, 4, 12, 8),
            &mut ref_counter,
        ),
        timeseries_panel(
            6,
            "Projection Lag Over Time",
            "limen_projection_lag_entries",
            grid_pos(12, 4, 12, 8),
            &mut ref_counter,
        ),
        timeseries_panel(
            7,
            "Error Rate",
            "rate(limen_governance_tampers_total[5m]) + rate(limen_governance_refusals_total[5m])",
            grid_pos(0, 12, 24, 8),
            &mut ref_counter,
        ),
    ];

    dashboard_wrapper(
        "Limen v5 Overview",
        "limen-overview",
        "Limen v5 substrate overview: chain health, projection status, governance state",
        panels,
    )
}

fn build_governance_dashboard() -> Value {
    let mut ref_counter = RefIdCounter::new();
    let panels = vec![
        stat_panel(
            1,
            "Current State",
            "limen_governance_state",
            grid_pos(0, 0, 8, 4),
            &mut ref_counter,
        ),
        stat_panel(
            2,
            "Total Transitions",
            "sum(limen_governance_transitions_total)",
            grid_pos(8, 0, 8, 4),
            &mut ref_counter,
        ),
        stat_panel(
            3,
            "Total Refusals",
            "sum(limen_governance_refusals_total)",
            grid_pos(16, 0, 8, 4),
            &mut ref_counter,
        ),
        timeseries_panel(
            4,
            "State Transitions Over Time",
            "rate(limen_governance_transitions_total[5m])",
            grid_pos(0, 4, 12, 8),
            &mut ref_counter,
        ),
        timeseries_panel(
            5,
            "Refusal Rate by Reason",
            "rate(limen_governance_refusals_total[5m])",
            grid_pos(12, 4, 12, 8),
            &mut ref_counter,
        ),
        timeseries_panel(
            6,
            "Tamper Detections",
            "rate(limen_governance_tampers_total[5m])",
            grid_pos(0, 12, 12, 8),
            &mut ref_counter,
        ),
        timeseries_panel(
            7,
            "Certificate Verifications",
            "rate(limen_certificate_verifications_total[5m])",
            grid_pos(12, 12, 12, 8),
            &mut ref_counter,
        ),
    ];

    dashboard_wrapper(
        "Limen v5 Governance",
        "limen-governance",
        "Governance state machine: transitions, refusals, tamper detection, certificate verification",
        panels,
    )
}

fn build_performance_dashboard() -> Value {
    let mut ref_counter = RefIdCounter::new();
    let panels = vec![
        timeseries_panel(
            1,
            "Chain Append Latency (p50/p95/p99)",
            "histogram_quantile(0.50, rate(limen_chain_append_duration_seconds_bucket[5m]))",
            grid_pos(0, 0, 12, 8),
            &mut ref_counter,
        ),
        timeseries_panel(
            2,
            "Chain Verify Latency (p50/p95/p99)",
            "histogram_quantile(0.50, rate(limen_chain_verify_duration_seconds_bucket[5m]))",
            grid_pos(12, 0, 12, 8),
            &mut ref_counter,
        ),
        timeseries_panel(
            3,
            "Projection Read Latency",
            "histogram_quantile(0.50, rate(limen_projection_read_duration_seconds_bucket[5m]))",
            grid_pos(0, 8, 8, 8),
            &mut ref_counter,
        ),
        timeseries_panel(
            4,
            "Projection Write Latency",
            "histogram_quantile(0.50, rate(limen_projection_write_duration_seconds_bucket[5m]))",
            grid_pos(8, 8, 8, 8),
            &mut ref_counter,
        ),
        timeseries_panel(
            5,
            "Digest Compute Latency",
            "histogram_quantile(0.50, rate(limen_projection_digest_duration_seconds_bucket[5m]))",
            grid_pos(16, 8, 8, 8),
            &mut ref_counter,
        ),
        timeseries_panel(
            6,
            "Checkpoint Create Latency",
            "histogram_quantile(0.50, rate(limen_checkpoint_create_duration_seconds_bucket[5m]))",
            grid_pos(0, 16, 12, 8),
            &mut ref_counter,
        ),
        timeseries_panel(
            7,
            "Checkpoint Rebuild Latency",
            "histogram_quantile(0.50, rate(limen_checkpoint_rebuild_duration_seconds_bucket[5m]))",
            grid_pos(12, 16, 12, 8),
            &mut ref_counter,
        ),
        timeseries_panel(
            8,
            "Chain Throughput (ops/sec)",
            "rate(limen_chain_appends_total[5m])",
            grid_pos(0, 24, 24, 8),
            &mut ref_counter,
        ),
    ];

    // Add p95/p99 targets to the latency panels
    let mut dashboard = dashboard_wrapper(
        "Limen v5 Performance",
        "limen-performance",
        "Operation latencies (p50/p95/p99) and throughput across chain, projection, and checkpoint subsystems",
        panels,
    );

    // Enrich latency panels with p95 and p99 targets (F9: unique refIds)
    if let Some(panels_arr) = dashboard.get_mut("panels").and_then(|p| p.as_array_mut()) {
        for panel in panels_arr.iter_mut() {
            if let Some(targets) = panel.get_mut("targets").and_then(|t| t.as_array_mut()) {
                let first_expr_owned: Option<String> = targets
                    .first()
                    .and_then(|t| t.get("expr"))
                    .and_then(|e| e.as_str())
                    .filter(|e| e.contains("histogram_quantile(0.50"))
                    .map(|e| e.to_string());

                if let Some(expr) = first_expr_owned {
                    let p95_expr = expr.replace("0.50", "0.95");
                    let p99_expr = expr.replace("0.50", "0.99");

                    // Update first target legend to "p50"
                    if let Some(first) = targets.first_mut() {
                        if let Some(obj) = first.as_object_mut() {
                            obj.insert("legendFormat".to_string(), json!("p50"));
                        }
                    }

                    // F9: Use "B" and "C" for additional targets (first is "A")
                    targets.push(prometheus_target_with_ref(&p95_expr, "p95", "B"));
                    targets.push(prometheus_target_with_ref(&p99_expr, "p99", "C"));
                }
            }
        }
    }

    dashboard
}

fn build_cost_dashboard() -> Value {
    let mut ref_counter = RefIdCounter::new();
    let panels = vec![
        timeseries_panel(
            1,
            "Token Usage Over Time",
            "rate(limen_token_usage_total[5m])",
            grid_pos(0, 0, 24, 8),
            &mut ref_counter,
        ),
        timeseries_panel(
            2,
            "Token Usage by Operation",
            "sum by (operation) (rate(limen_token_usage_total[5m]))",
            grid_pos(0, 8, 12, 8),
            &mut ref_counter,
        ),
        table_panel(
            3,
            "Cumulative Token Usage",
            "sum by (operation) (limen_token_usage_total)",
            grid_pos(12, 8, 12, 8),
            &mut ref_counter,
        ),
        timeseries_panel(
            4,
            "Operations Per Token (Efficiency)",
            "rate(limen_chain_appends_total[5m]) / (rate(limen_token_usage_total[5m]) > 0)",
            grid_pos(0, 16, 24, 8),
            &mut ref_counter,
        ),
    ];

    dashboard_wrapper(
        "Limen v5 Cost",
        "limen-cost",
        "Token usage tracking and cost-per-operation analysis",
        panels,
    )
}

// ================================================================
// RefId counter (F9: unique refIds per panel)
// ================================================================

/// Generates sequential refId values ("A", "B", "C", ...) per panel.
struct RefIdCounter {
    next: u8,
}

impl RefIdCounter {
    fn new() -> Self {
        Self { next: 0 }
    }

    fn next_id(&mut self) -> String {
        let id = (b'A' + self.next) as char;
        self.next += 1;
        id.to_string()
    }

    /// Reset for a new panel scope.
    fn reset(&mut self) {
        self.next = 0;
    }
}

// ================================================================
// Panel constructors
// ================================================================

fn stat_panel(id: u32, title: &str, expr: &str, grid: Value, ref_counter: &mut RefIdCounter) -> Value {
    ref_counter.reset();
    let ref_id = ref_counter.next_id();
    json!({
        "id": id,
        "type": "stat",
        "title": title,
        "datasource": {
            "type": DATASOURCE_TYPE,
            "uid": DATASOURCE_UID
        },
        "targets": [
            prometheus_target_with_ref(expr, "", &ref_id)
        ],
        "gridPos": grid,
        "options": {
            "reduceOptions": {
                "calcs": ["lastNotNull"],
                "fields": "",
                "values": false
            },
            "colorMode": "value",
            "graphMode": "area",
            "justifyMode": "auto",
            "textMode": "auto"
        },
        "fieldConfig": {
            "defaults": {
                "thresholds": {
                    "mode": "absolute",
                    "steps": [
                        { "color": "green", "value": null },
                        { "color": "red", "value": 80 }
                    ]
                }
            },
            "overrides": []
        }
    })
}

fn timeseries_panel(id: u32, title: &str, expr: &str, grid: Value, ref_counter: &mut RefIdCounter) -> Value {
    ref_counter.reset();
    let ref_id = ref_counter.next_id();
    json!({
        "id": id,
        "type": "timeseries",
        "title": title,
        "datasource": {
            "type": DATASOURCE_TYPE,
            "uid": DATASOURCE_UID
        },
        "targets": [
            prometheus_target_with_ref(expr, "{{__name__}}", &ref_id)
        ],
        "gridPos": grid,
        "options": {
            "tooltip": { "mode": "single", "sort": "none" },
            "legend": { "displayMode": "list", "placement": "bottom" }
        },
        "fieldConfig": {
            "defaults": {
                "custom": {
                    "drawStyle": "line",
                    "lineInterpolation": "smooth",
                    "fillOpacity": 10,
                    "pointSize": 5,
                    "showPoints": "auto",
                    "spanNulls": false,
                    "stacking": { "mode": "none" }
                },
                "thresholds": {
                    "mode": "absolute",
                    "steps": [
                        { "color": "green", "value": null }
                    ]
                }
            },
            "overrides": []
        }
    })
}

fn table_panel(id: u32, title: &str, expr: &str, grid: Value, ref_counter: &mut RefIdCounter) -> Value {
    ref_counter.reset();
    let ref_id = ref_counter.next_id();
    json!({
        "id": id,
        "type": "table",
        "title": title,
        "datasource": {
            "type": DATASOURCE_TYPE,
            "uid": DATASOURCE_UID
        },
        "targets": [
            prometheus_target_with_ref(expr, "", &ref_id)
        ],
        "gridPos": grid,
        "options": {
            "showHeader": true,
            "footer": { "show": false }
        },
        "fieldConfig": {
            "defaults": {
                "thresholds": {
                    "mode": "absolute",
                    "steps": [
                        { "color": "green", "value": null }
                    ]
                }
            },
            "overrides": []
        }
    })
}

// ================================================================
// Helpers
// ================================================================

/// Build a Prometheus target with explicit refId (F9: no duplicate "A").
fn prometheus_target_with_ref(expr: &str, legend: &str, ref_id: &str) -> Value {
    json!({
        "datasource": {
            "type": DATASOURCE_TYPE,
            "uid": DATASOURCE_UID
        },
        "expr": expr,
        "legendFormat": legend,
        "refId": ref_id,
        "editorMode": "code",
        "range": true,
        "instant": false
    })
}

fn grid_pos(x: u32, y: u32, w: u32, h: u32) -> Value {
    json!({
        "x": x,
        "y": y,
        "w": w,
        "h": h
    })
}

fn dashboard_wrapper(title: &str, uid: &str, description: &str, panels: Vec<Value>) -> Value {
    json!({
        "id": null,
        "uid": uid,
        "title": title,
        "description": description,
        "tags": ["limen", "v5", "substrate"],
        "timezone": "browser",
        "schemaVersion": 39,
        "version": 1,
        "refresh": "10s",
        "time": {
            "from": "now-1h",
            "to": "now"
        },
        "timepicker": {
            "refresh_intervals": ["5s", "10s", "30s", "1m", "5m"],
            "time_options": ["5m", "15m", "1h", "6h", "12h", "24h", "7d"]
        },
        "templating": {
            "list": []
        },
        "annotations": {
            "list": [
                {
                    "builtIn": 1,
                    "datasource": { "type": "grafana", "uid": "-- Grafana --" },
                    "enable": true,
                    "hide": true,
                    "iconColor": "rgba(0, 211, 255, 1)",
                    "name": "Annotations & Alerts",
                    "type": "dashboard"
                }
            ]
        },
        "panels": panels,
        "editable": true,
        "fiscalYearStartMonth": 0,
        "graphTooltip": 0,
        "links": [],
        "liveNow": false
    })
}
