// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! Prometheus metrics for Limen v5 substrate operations.
//!
//! All metrics use the `prometheus-client` crate's type-safe registry model.
//! Metric names follow the Prometheus naming convention:
//! `limen_<subsystem>_<operation>_<unit>`.
//!
//! ## Metric Categories (16 total)
//!
//! | Category      | Count | Metrics                                              |
//! |---------------|-------|------------------------------------------------------|
//! | Chain         | 4     | append duration, appends counter, verify duration, seq |
//! | Projection    | 4     | read/write/digest duration, lag gauge                |
//! | Governance    | 4     | state gauge, transitions, refusals, tampers counter  |
//! | Checkpoint    | 2     | create/rebuild duration                              |
//! | Verification  | 2     | certificate verifications, token usage               |
//!
//! ## Usage
//!
//! ```rust,no_run
//! use prometheus_client::registry::Registry;
//! use limen_observability::metrics::{LimenMetrics, GovernanceState, RefusalReason};
//!
//! let metrics = LimenMetrics::new();
//! let mut registry = Registry::default();
//! metrics.register(&mut registry);
//!
//! // Record a chain append
//! metrics.record_chain_append(0.003);
//!
//! // Type-safe governance transition (F1: bounded cardinality)
//! metrics.record_governance_transition(GovernanceState::Unverified, GovernanceState::Verified);
//! metrics.record_governance_refusal(GovernanceState::Lagging, RefusalReason::GovernanceBlocked);
//! ```

use prometheus_client::encoding::EncodeLabelSet;
use prometheus_client::metrics::counter::Counter;
use prometheus_client::metrics::family::Family;
use prometheus_client::metrics::gauge::Gauge;
use prometheus_client::metrics::histogram::{exponential_buckets, Histogram};
use prometheus_client::registry::Registry;
use std::fmt;

// ================================================================
// Governance enums (F1: bounded label cardinality)
// ================================================================

/// Governance validity states. Bounded set prevents label cardinality explosion.
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub enum GovernanceState {
    Verified,
    Lagging,
    Unverified,
    Divergent,
    Rebuilding,
}

impl GovernanceState {
    /// Encode as integer for gauge representation.
    pub fn as_gauge_value(self) -> i64 {
        match self {
            Self::Unverified => 0,
            Self::Verified => 1,
            Self::Lagging => 2,
            Self::Divergent => 3,
            Self::Rebuilding => 4,
        }
    }

    /// Parse from string. Returns None for unknown states.
    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "Unverified" => Some(Self::Unverified),
            "Verified" => Some(Self::Verified),
            "Lagging" => Some(Self::Lagging),
            "Divergent" => Some(Self::Divergent),
            "Rebuilding" => Some(Self::Rebuilding),
            _ => None,
        }
    }
}

impl fmt::Display for GovernanceState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Verified => write!(f, "Verified"),
            Self::Lagging => write!(f, "Lagging"),
            Self::Unverified => write!(f, "Unverified"),
            Self::Divergent => write!(f, "Divergent"),
            Self::Rebuilding => write!(f, "Rebuilding"),
        }
    }
}

/// Reasons for governance refusals. Bounded set prevents label cardinality explosion.
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub enum RefusalReason {
    GovernanceBlocked,
    TamperDetected,
    NotStarted,
    Other,
}

impl fmt::Display for RefusalReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::GovernanceBlocked => write!(f, "governance_blocked"),
            Self::TamperDetected => write!(f, "tamper_detected"),
            Self::NotStarted => write!(f, "not_started"),
            Self::Other => write!(f, "other"),
        }
    }
}

// ================================================================
// Label types
// ================================================================

/// Labels for governance state transitions (from_state, to_state).
#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct TransitionLabels {
    pub from_state: String,
    pub to_state: String,
}

/// Labels for governance refusals (state, reason).
#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct RefusalLabels {
    pub state: String,
    pub reason: String,
}

/// Labels for certificate verification outcome (result: "pass" or "fail").
#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct VerificationResultLabels {
    pub result: String,
}

/// Labels for token usage by operation type.
#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
pub struct OperationLabels {
    pub operation: String,
}

// ================================================================
// Histogram bucket configuration
// ================================================================

/// Latency buckets for chain operations (sub-millisecond to 10 seconds).
fn chain_latency_buckets() -> impl Iterator<Item = f64> {
    exponential_buckets(0.001, 2.0, 14)
}

/// Latency buckets for projection operations (sub-millisecond to 30 seconds).
fn projection_latency_buckets() -> impl Iterator<Item = f64> {
    exponential_buckets(0.0005, 2.0, 16)
}

/// Latency buckets for checkpoint operations (milliseconds to minutes).
fn checkpoint_latency_buckets() -> impl Iterator<Item = f64> {
    exponential_buckets(0.01, 2.0, 16)
}

// ================================================================
// LimenMetrics
// ================================================================

/// Central metrics registry for all Limen v5 substrate operations.
///
/// Constructed via `new()`, then registered with a Prometheus registry
/// via `register()`. All fields are public for direct instrumentation.
/// Convenience `record_*()` methods provide type-safe recording.
///
/// Counter registration names omit `_total` suffix — prometheus-client
/// appends it automatically during encoding (F3/F4 fix).
pub struct LimenMetrics {
    // -- Chain metrics (4) --

    /// Duration of chain append operations in seconds.
    pub chain_append_duration: Histogram,
    /// Total number of chain append operations (committed + refused).
    pub chain_appends: Counter,
    /// Duration of chain verification operations in seconds.
    pub chain_verify_duration: Histogram,
    /// Latest committed chain sequence number (monotonically increasing).
    pub chain_latest_sequence: Gauge,

    // -- Projection metrics (4) --

    /// Duration of projection read operations in seconds.
    pub projection_read_duration: Histogram,
    /// Duration of projection write operations in seconds.
    pub projection_write_duration: Histogram,
    /// Duration of projection digest computation in seconds.
    pub projection_digest_duration: Histogram,
    /// Number of chain entries not yet projected (projection lag).
    pub projection_lag_entries: Gauge,

    // -- Governance metrics (4) --

    /// Current governance validity state encoded as integer.
    /// 0=Unverified, 1=Verified, 2=Lagging, 3=Divergent, 4=Rebuilding.
    pub governance_state: Gauge,
    /// Total governance state transitions, labeled by (from_state, to_state).
    pub governance_transitions: Family<TransitionLabels, Counter>,
    /// Total governance refusals, labeled by (state, reason).
    pub governance_refusals: Family<RefusalLabels, Counter>,
    /// Total tamper detection events.
    pub governance_tampers: Counter,

    // -- Checkpoint metrics (2) --

    /// Duration of checkpoint create operations in seconds.
    pub checkpoint_create_duration: Histogram,
    /// Duration of checkpoint rebuild operations in seconds.
    pub checkpoint_rebuild_duration: Histogram,

    // -- Verification metrics (2) --

    /// Total certificate verification attempts, labeled by result (pass/fail).
    pub certificate_verifications: Family<VerificationResultLabels, Counter>,
    /// Total token usage, labeled by operation type.
    pub token_usage: Family<OperationLabels, Counter>,
}

impl LimenMetrics {
    /// Total number of individually registered metrics.
    pub const METRIC_COUNT: usize = 16;

    /// Create a new `LimenMetrics` instance with all metrics initialized.
    pub fn new() -> Self {
        Self {
            // Chain
            chain_append_duration: Histogram::new(chain_latency_buckets()),
            chain_appends: Counter::default(),
            chain_verify_duration: Histogram::new(chain_latency_buckets()),
            chain_latest_sequence: Gauge::default(),
            // Projection
            projection_read_duration: Histogram::new(projection_latency_buckets()),
            projection_write_duration: Histogram::new(projection_latency_buckets()),
            projection_digest_duration: Histogram::new(projection_latency_buckets()),
            projection_lag_entries: Gauge::default(),
            // Governance
            governance_state: Gauge::default(),
            governance_transitions: Family::<TransitionLabels, Counter>::default(),
            governance_refusals: Family::<RefusalLabels, Counter>::default(),
            governance_tampers: Counter::default(),
            // Checkpoint
            checkpoint_create_duration: Histogram::new(checkpoint_latency_buckets()),
            checkpoint_rebuild_duration: Histogram::new(checkpoint_latency_buckets()),
            // Verification
            certificate_verifications: Family::<VerificationResultLabels, Counter>::default(),
            token_usage: Family::<OperationLabels, Counter>::default(),
        }
    }

    /// Register all Limen metrics with the given Prometheus registry.
    ///
    /// Counter names omit `_total` because prometheus-client adds it during
    /// encoding. This prevents the `_total_total` suffix doubling bug (F3/F4).
    pub fn register(&self, registry: &mut Registry) {
        let sub = registry.sub_registry_with_prefix("limen");

        // Chain metrics
        sub.register(
            "chain_append_duration_seconds",
            "Duration of chain append operations in seconds",
            self.chain_append_duration.clone(),
        );
        sub.register(
            "chain_appends",
            "Total number of chain append operations",
            self.chain_appends.clone(),
        );
        sub.register(
            "chain_verify_duration_seconds",
            "Duration of chain verification operations in seconds",
            self.chain_verify_duration.clone(),
        );
        sub.register(
            "chain_latest_sequence",
            "Latest committed chain sequence number",
            self.chain_latest_sequence.clone(),
        );

        // Projection metrics
        sub.register(
            "projection_read_duration_seconds",
            "Duration of projection read operations in seconds",
            self.projection_read_duration.clone(),
        );
        sub.register(
            "projection_write_duration_seconds",
            "Duration of projection write operations in seconds",
            self.projection_write_duration.clone(),
        );
        sub.register(
            "projection_digest_duration_seconds",
            "Duration of projection digest computation in seconds",
            self.projection_digest_duration.clone(),
        );
        sub.register(
            "projection_lag_entries",
            "Number of chain entries not yet projected",
            self.projection_lag_entries.clone(),
        );

        // Governance metrics
        sub.register(
            "governance_state",
            "Current governance validity state (0=Unverified, 1=Verified, 2=Lagging, 3=Divergent, 4=Rebuilding)",
            self.governance_state.clone(),
        );
        sub.register(
            "governance_transitions",
            "Total governance state transitions",
            self.governance_transitions.clone(),
        );
        sub.register(
            "governance_refusals",
            "Total governance refusals by state and reason",
            self.governance_refusals.clone(),
        );
        sub.register(
            "governance_tampers",
            "Total tamper detection events",
            self.governance_tampers.clone(),
        );

        // Checkpoint metrics
        sub.register(
            "checkpoint_create_duration_seconds",
            "Duration of checkpoint create operations in seconds",
            self.checkpoint_create_duration.clone(),
        );
        sub.register(
            "checkpoint_rebuild_duration_seconds",
            "Duration of checkpoint rebuild operations in seconds",
            self.checkpoint_rebuild_duration.clone(),
        );

        // Verification metrics
        sub.register(
            "certificate_verifications",
            "Total certificate verification attempts by result",
            self.certificate_verifications.clone(),
        );
        sub.register(
            "token_usage",
            "Total token usage by operation type",
            self.token_usage.clone(),
        );
    }

    // ================================================================
    // record_*() convenience methods
    // ================================================================

    /// Record a chain append operation: increments counter and observes duration.
    pub fn record_chain_append(&self, duration_secs: f64) {
        self.chain_appends.inc();
        self.chain_append_duration.observe(duration_secs);
    }

    /// Record a chain verification duration.
    pub fn record_chain_verify(&self, duration_secs: f64) {
        self.chain_verify_duration.observe(duration_secs);
    }

    /// Set the latest chain sequence gauge.
    pub fn record_chain_sequence(&self, seq: i64) {
        self.chain_latest_sequence.set(seq);
    }

    /// Record a projection read duration.
    pub fn record_projection_read(&self, duration_secs: f64) {
        self.projection_read_duration.observe(duration_secs);
    }

    /// Record a projection write duration.
    pub fn record_projection_write(&self, duration_secs: f64) {
        self.projection_write_duration.observe(duration_secs);
    }

    /// Record a projection digest computation duration.
    pub fn record_projection_digest(&self, duration_secs: f64) {
        self.projection_digest_duration.observe(duration_secs);
    }

    /// Set the projection lag gauge (entries behind chain head).
    pub fn record_projection_lag(&self, lag: i64) {
        self.projection_lag_entries.set(lag);
    }

    /// Set the governance state gauge from a typed enum (F1: bounded cardinality).
    pub fn set_governance_state(&self, state: GovernanceState) {
        self.governance_state.set(state.as_gauge_value());
    }

    /// Set the governance state gauge from a state name string.
    /// Maps: Unverified=0, Verified=1, Lagging=2, Divergent=3, Rebuilding=4.
    /// Unknown states map to -1 (fail-visible).
    pub fn record_governance_state(&self, state: &str) {
        match GovernanceState::from_str_opt(state) {
            Some(s) => self.governance_state.set(s.as_gauge_value()),
            None => self.governance_state.set(-1),
        };
    }

    /// Record a governance state transition (F1: type-safe, bounded cardinality).
    pub fn record_governance_transition(&self, from: GovernanceState, to: GovernanceState) {
        self.governance_transitions
            .get_or_create(&TransitionLabels {
                from_state: from.to_string(),
                to_state: to.to_string(),
            })
            .inc();
    }

    /// Record a governance refusal (F1: type-safe, bounded cardinality).
    pub fn record_governance_refusal(&self, state: GovernanceState, reason: RefusalReason) {
        self.governance_refusals
            .get_or_create(&RefusalLabels {
                state: state.to_string(),
                reason: reason.to_string(),
            })
            .inc();
    }

    /// Record a tamper detection event.
    pub fn record_governance_tamper(&self) {
        self.governance_tampers.inc();
    }

    /// Record a checkpoint create duration.
    pub fn record_checkpoint_create(&self, duration_secs: f64) {
        self.checkpoint_create_duration.observe(duration_secs);
    }

    /// Record a checkpoint rebuild duration.
    pub fn record_checkpoint_rebuild(&self, duration_secs: f64) {
        self.checkpoint_rebuild_duration.observe(duration_secs);
    }

    /// Record a certificate verification outcome (pass or fail).
    pub fn record_certificate_verification(&self, passed: bool) {
        let label = if passed { "pass" } else { "fail" };
        self.certificate_verifications
            .get_or_create(&VerificationResultLabels {
                result: label.to_string(),
            })
            .inc();
    }

    /// Record token usage for an operation.
    pub fn record_token_usage(&self, operation: &str, tokens: u64) {
        self.token_usage
            .get_or_create(&OperationLabels {
                operation: operation.to_string(),
            })
            .inc_by(tokens);
    }
}

impl Default for LimenMetrics {
    fn default() -> Self {
        Self::new()
    }
}
