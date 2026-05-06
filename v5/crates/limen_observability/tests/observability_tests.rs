//! Integration tests for limen_observability.
//!
//! Tests verify the 7 spec-mandated assertions:
//! 1. Metrics registration succeeds without conflict
//! 2. Counter increments produce correct values
//! 3. Histogram observations record correctly
//! 4. Gauge set operations work
//! 5. Dashboard generation produces valid JSON with panels
//! 6. Unknown governance state maps to -1 (F6)
//! 7. Dashboard expr values reference real metric names (F5)

use limen_observability::dashboards;
use limen_observability::metrics::{GovernanceState, LimenMetrics, RefusalReason};
use prometheus_client::encoding::text::encode;
use prometheus_client::registry::Registry;
use std::collections::HashSet;

// ================================================================
// Test 1: Metrics registration
// ================================================================

#[test]
fn test_metrics_registration() {
    let metrics = LimenMetrics::new();
    let mut registry = Registry::default();
    metrics.register(&mut registry);

    // Encode to verify all metrics are registered without panic
    let mut buffer = String::new();
    encode(&mut buffer, &registry).expect("encoding must succeed");

    // Verify all 16 metric families appear in output (with correct names after F3/F4)
    // Counters get _total appended by prometheus-client:
    assert!(buffer.contains("limen_chain_appends_total"), "missing chain_appends");
    assert!(buffer.contains("limen_governance_tampers_total"), "missing governance_tampers");
    // Histograms:
    assert!(buffer.contains("limen_chain_append_duration_seconds"), "missing chain_append_duration");
    assert!(buffer.contains("limen_chain_verify_duration_seconds"), "missing chain_verify_duration");
    assert!(buffer.contains("limen_projection_read_duration_seconds"), "missing projection_read_duration");
    assert!(buffer.contains("limen_projection_write_duration_seconds"), "missing projection_write_duration");
    assert!(buffer.contains("limen_projection_digest_duration_seconds"), "missing projection_digest_duration");
    assert!(buffer.contains("limen_checkpoint_create_duration_seconds"), "missing checkpoint_create_duration");
    assert!(buffer.contains("limen_checkpoint_rebuild_duration_seconds"), "missing checkpoint_rebuild_duration");
    // Gauges:
    assert!(buffer.contains("limen_chain_latest_sequence"), "missing chain_latest_sequence");
    assert!(buffer.contains("limen_projection_lag_entries"), "missing projection_lag_entries");
    assert!(buffer.contains("limen_governance_state"), "missing governance_state");

    // Verify METRIC_COUNT constant is accurate
    assert_eq!(LimenMetrics::METRIC_COUNT, 16);
}

// ================================================================
// Test 2: Counter increment
// ================================================================

#[test]
fn test_counter_increment() {
    let metrics = LimenMetrics::new();
    let mut registry = Registry::default();
    metrics.register(&mut registry);

    // Increment chain append counter via record_* helper
    metrics.record_chain_append(0.001);
    metrics.record_chain_append(0.002);
    metrics.record_chain_append(0.003);

    let mut buffer = String::new();
    encode(&mut buffer, &registry).expect("encoding must succeed");

    // Counter registered as "chain_appends", encoded as "limen_chain_appends_total"
    assert!(
        buffer.contains("limen_chain_appends_total 3"),
        "chain_appends should be 3, got:\n{}",
        buffer
    );

    // Tamper counter
    metrics.record_governance_tamper();
    metrics.record_governance_tamper();

    let mut buffer2 = String::new();
    encode(&mut buffer2, &registry).expect("encoding must succeed");
    assert!(
        buffer2.contains("limen_governance_tampers_total 2"),
        "governance_tampers should be 2, got:\n{}",
        buffer2
    );

    // Labeled counters: certificate verification
    metrics.record_certificate_verification(true);
    metrics.record_certificate_verification(true);
    metrics.record_certificate_verification(false);

    let mut buffer3 = String::new();
    encode(&mut buffer3, &registry).expect("encoding must succeed");
    assert!(buffer3.contains("result=\"pass\""), "pass label must be present");
    assert!(buffer3.contains("result=\"fail\""), "fail label must be present");

    // Token usage labeled counter
    metrics.record_token_usage("chain_append", 100);
    metrics.record_token_usage("projection_read", 50);

    let mut buffer4 = String::new();
    encode(&mut buffer4, &registry).expect("encoding must succeed");
    assert!(buffer4.contains("operation=\"chain_append\""), "chain_append operation must be present");
    assert!(buffer4.contains("operation=\"projection_read\""), "projection_read operation must be present");
}

// ================================================================
// Test 3: Histogram observe
// ================================================================

#[test]
fn test_histogram_observe() {
    let metrics = LimenMetrics::new();
    let mut registry = Registry::default();
    metrics.register(&mut registry);

    metrics.record_chain_append(0.001);
    metrics.record_chain_append(0.005);
    metrics.record_chain_append(0.050);

    let mut buffer = String::new();
    encode(&mut buffer, &registry).expect("encoding must succeed");

    assert!(buffer.contains("limen_chain_append_duration_seconds_bucket"), "histogram buckets must be present");
    assert!(buffer.contains("limen_chain_append_duration_seconds_count 3"), "histogram count should be 3");
    assert!(buffer.contains("limen_chain_append_duration_seconds_sum"), "histogram sum must be present");
    assert!(
        buffer.contains("limen_chain_append_duration_seconds_bucket{le=\"+Inf\"} 3"),
        "+Inf bucket should contain all 3 observations"
    );

    // Projection read histogram
    metrics.record_projection_read(0.0005);
    metrics.record_projection_read(0.002);

    let mut buffer2 = String::new();
    encode(&mut buffer2, &registry).expect("encoding must succeed");
    assert!(
        buffer2.contains("limen_projection_read_duration_seconds_count 2"),
        "projection read histogram count should be 2"
    );

    // Checkpoint create histogram
    metrics.record_checkpoint_create(0.5);

    let mut buffer3 = String::new();
    encode(&mut buffer3, &registry).expect("encoding must succeed");
    assert!(
        buffer3.contains("limen_checkpoint_create_duration_seconds_count 1"),
        "checkpoint create histogram count should be 1"
    );
}

// ================================================================
// Test 4: Gauge set
// ================================================================

#[test]
fn test_gauge_set() {
    let metrics = LimenMetrics::new();
    let mut registry = Registry::default();
    metrics.register(&mut registry);

    metrics.record_chain_sequence(42);
    metrics.record_projection_lag(7);
    metrics.record_governance_state("Verified");

    let mut buffer = String::new();
    encode(&mut buffer, &registry).expect("encoding must succeed");

    assert!(buffer.contains("limen_chain_latest_sequence 42"), "chain_latest_sequence should be 42");
    assert!(buffer.contains("limen_projection_lag_entries 7"), "projection_lag_entries should be 7");
    assert!(buffer.contains("limen_governance_state 1"), "governance_state should be 1 for Verified");

    // Verify all governance state encodings
    let states = vec![
        ("Unverified", 0),
        ("Verified", 1),
        ("Lagging", 2),
        ("Divergent", 3),
        ("Rebuilding", 4),
    ];

    for (state_name, expected_value) in states {
        let m = LimenMetrics::new();
        let mut r = Registry::default();
        m.register(&mut r);
        m.record_governance_state(state_name);

        let mut buf = String::new();
        encode(&mut buf, &r).expect("encoding must succeed");
        let expected = format!("limen_governance_state {}", expected_value);
        assert!(
            buf.contains(&expected),
            "governance_state for '{}' should be {}, got:\n{}",
            state_name, expected_value, buf
        );
    }
}

// ================================================================
// Test 5: Dashboard generation valid JSON
// ================================================================

#[test]
fn test_dashboard_generation_valid_json() {
    let dir = tempfile::tempdir().expect("tempdir must succeed");
    dashboards::generate_dashboards(dir.path()).expect("generation must succeed");

    let expected_files = ["overview.json", "governance.json", "performance.json", "cost.json"];

    for filename in &expected_files {
        let path = dir.path().join(filename);
        assert!(path.exists(), "dashboard file '{}' must exist", filename);

        let content = std::fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("must read {}", filename));
        let parsed: serde_json::Value = serde_json::from_str(&content)
            .unwrap_or_else(|e| panic!("{} must be valid JSON: {}", filename, e));

        assert!(parsed.get("uid").is_some(), "{} must have 'uid' field", filename);
        assert!(parsed.get("title").is_some(), "{} must have 'title' field", filename);
        assert!(parsed.get("schemaVersion").is_some(), "{} must have 'schemaVersion' field", filename);

        let panels = parsed["panels"]
            .as_array()
            .unwrap_or_else(|| panic!("{}: panels must be array", filename));
        assert!(!panels.is_empty(), "{} must have at least one panel", filename);

        for (i, panel) in panels.iter().enumerate() {
            assert!(panel.get("id").is_some(), "{} panel {} must have 'id'", filename, i);
            assert!(panel.get("type").is_some(), "{} panel {} must have 'type'", filename, i);
            assert!(panel.get("title").is_some(), "{} panel {} must have 'title'", filename, i);
            assert!(panel.get("targets").is_some(), "{} panel {} must have 'targets'", filename, i);

            let panel_type = panel["type"].as_str().expect("type must be string");
            assert!(
                ["stat", "timeseries", "table"].contains(&panel_type),
                "{} panel {} has unsupported type: {}",
                filename, i, panel_type
            );

            let targets = panel["targets"].as_array()
                .unwrap_or_else(|| panic!("{} panel {}: targets must be array", filename, i));
            for target in targets {
                assert!(target.get("expr").is_some(), "{} panel {} target must have 'expr'", filename, i);
            }
        }
    }

    // Verify idempotent
    dashboards::generate_dashboards(dir.path()).expect("second generation must succeed");
}

// ================================================================
// Test 6: Unknown governance state maps to -1 (F6)
// ================================================================

#[test]
fn test_unknown_governance_state_maps_to_negative_one() {
    let metrics = LimenMetrics::new();
    let mut registry = Registry::default();
    metrics.register(&mut registry);

    metrics.record_governance_state("unknown_state");

    let mut buffer = String::new();
    encode(&mut buffer, &registry).expect("encoding must succeed");

    assert!(
        buffer.contains("limen_governance_state -1"),
        "unknown governance state should map to -1, got:\n{}",
        buffer
    );
}

// ================================================================
// Test 7: Dashboard exprs reference real metric names (F5)
// ================================================================

#[test]
fn test_dashboard_exprs_reference_real_metrics() {
    // Step 1: Register metrics and encode to get all real metric names
    let metrics = LimenMetrics::new();
    let mut registry = Registry::default();
    metrics.register(&mut registry);

    // Trigger labeled metrics so they appear in encoding
    metrics.record_governance_transition(GovernanceState::Unverified, GovernanceState::Verified);
    metrics.record_governance_refusal(GovernanceState::Lagging, RefusalReason::GovernanceBlocked);
    metrics.record_certificate_verification(true);
    metrics.record_token_usage("test", 1);
    metrics.record_chain_append(0.001);
    metrics.record_chain_verify(0.001);
    metrics.record_projection_read(0.001);
    metrics.record_projection_write(0.001);
    metrics.record_projection_digest(0.001);
    metrics.record_checkpoint_create(0.001);
    metrics.record_checkpoint_rebuild(0.001);

    let mut buffer = String::new();
    encode(&mut buffer, &registry).expect("encoding must succeed");

    // Extract all metric names from the exposition format (lines starting with "# TYPE")
    let real_metric_names: HashSet<&str> = buffer
        .lines()
        .filter(|line| line.starts_with("# TYPE "))
        .map(|line| {
            // "# TYPE limen_chain_appends counter" -> "limen_chain_appends"
            let parts: Vec<&str> = line.split_whitespace().collect();
            parts[2]
        })
        .collect();

    // Step 2: Generate dashboards and extract all expr values
    let dir = tempfile::tempdir().expect("tempdir must succeed");
    dashboards::generate_dashboards(dir.path()).expect("generation must succeed");

    let dashboard_files = ["overview.json", "governance.json", "performance.json", "cost.json"];

    for filename in &dashboard_files {
        let path = dir.path().join(filename);
        let content = std::fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();

        let panels = parsed["panels"].as_array().unwrap();
        for panel in panels {
            let targets = panel["targets"].as_array().unwrap();
            for target in targets {
                let expr = target["expr"].as_str().unwrap();
                // Extract metric names from PromQL expressions.
                // Metric names match: limen_[a-z_]+
                let metric_refs: Vec<&str> = extract_metric_names(expr);

                for metric_ref in metric_refs {
                    // For counters, the expr uses the _total form, but the
                    // TYPE line shows the base name. Check both.
                    let base_name = metric_ref.trim_end_matches("_total");
                    let with_total = format!("{}_total", base_name);

                    // For histogram buckets: limen_chain_append_duration_seconds_bucket
                    // The TYPE name is: limen_chain_append_duration_seconds
                    let base_for_bucket = metric_ref
                        .trim_end_matches("_bucket")
                        .trim_end_matches("_count")
                        .trim_end_matches("_sum");

                    let found = real_metric_names.contains(metric_ref)
                        || real_metric_names.contains(base_name)
                        || real_metric_names.contains(with_total.as_str())
                        || real_metric_names.contains(base_for_bucket);

                    assert!(
                        found,
                        "Dashboard '{}' references metric '{}' which is not registered.\n\
                         Available metrics: {:?}",
                        filename, metric_ref, real_metric_names
                    );
                }
            }
        }
    }
}

/// Extract metric names (limen_*) from a PromQL expression.
fn extract_metric_names(expr: &str) -> Vec<&str> {
    let mut names = Vec::new();
    let mut start = None;

    for (i, c) in expr.char_indices() {
        match start {
            None => {
                if c == 'l' && expr[i..].starts_with("limen_") {
                    start = Some(i);
                }
            }
            Some(s) => {
                if !c.is_alphanumeric() && c != '_' {
                    names.push(&expr[s..i]);
                    start = None;
                    // Check if this position starts a new limen_
                    if c == 'l' && expr[i..].starts_with("limen_") {
                        start = Some(i);
                    }
                }
            }
        }
    }

    // Handle metric at end of string
    if let Some(s) = start {
        names.push(&expr[s..]);
    }

    names
}

// ================================================================
// Test 8: Typed governance API (F1)
// ================================================================

#[test]
fn test_typed_governance_api() {
    let metrics = LimenMetrics::new();
    let mut registry = Registry::default();
    metrics.register(&mut registry);

    // Type-safe state setting
    metrics.set_governance_state(GovernanceState::Verified);

    let mut buffer = String::new();
    encode(&mut buffer, &registry).expect("encoding must succeed");
    assert!(buffer.contains("limen_governance_state 1"), "set_governance_state(Verified) should be 1");

    // Type-safe transition
    metrics.record_governance_transition(GovernanceState::Verified, GovernanceState::Lagging);

    let mut buffer2 = String::new();
    encode(&mut buffer2, &registry).expect("encoding must succeed");
    assert!(buffer2.contains("from_state=\"Verified\""), "transition from_state must be Verified");
    assert!(buffer2.contains("to_state=\"Lagging\""), "transition to_state must be Lagging");

    // Type-safe refusal
    metrics.record_governance_refusal(GovernanceState::Divergent, RefusalReason::TamperDetected);

    let mut buffer3 = String::new();
    encode(&mut buffer3, &registry).expect("encoding must succeed");
    assert!(buffer3.contains("state=\"Divergent\""), "refusal state must be Divergent");
    assert!(buffer3.contains("reason=\"tamper_detected\""), "refusal reason must be tamper_detected");
}

// ================================================================
// Test 9: No duplicate refIds in dashboard panels (F9)
// ================================================================

#[test]
fn test_no_duplicate_ref_ids_in_panels() {
    let dir = tempfile::tempdir().expect("tempdir must succeed");
    dashboards::generate_dashboards(dir.path()).expect("generation must succeed");

    let dashboard_files = ["overview.json", "governance.json", "performance.json", "cost.json"];

    for filename in &dashboard_files {
        let path = dir.path().join(filename);
        let content = std::fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();

        let panels = parsed["panels"].as_array().unwrap();
        for (i, panel) in panels.iter().enumerate() {
            let targets = panel["targets"].as_array().unwrap();
            if targets.len() > 1 {
                let ref_ids: Vec<&str> = targets
                    .iter()
                    .map(|t| t["refId"].as_str().unwrap())
                    .collect();

                let unique: HashSet<&str> = ref_ids.iter().copied().collect();
                assert_eq!(
                    ref_ids.len(),
                    unique.len(),
                    "{} panel {} has duplicate refIds: {:?}",
                    filename, i, ref_ids
                );
            }
        }
    }
}
