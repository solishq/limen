#![forbid(unsafe_code)]
//! Optional observability infrastructure for Limen v5 substrate.
//!
//! This crate is OPTIONAL -- no existing Limen crate depends on it.
//! It provides two observability pillars:
//!
//! 1. **Metrics** (`metrics` module): 16 Prometheus-compatible counters, histograms,
//!    and gauges covering chain, projection, governance, checkpoint, and verification
//!    operations. Uses the `prometheus-client` crate for type-safe metric families.
//!
//! 2. **Dashboards** (`dashboards` module): Programmatic generation of 4 Grafana 10+
//!    dashboard JSON files. Each dashboard is a valid import artifact targeting
//!    a Prometheus datasource.
//!
//! ## Design Rationale
//!
//! The crate follows the "sidecar" observability pattern: it defines metric
//! registrations and span constructors that callers opt into. No existing crate
//! source is modified. This preserves the strict crate dependency DAG established
//! in v1.4 and avoids coupling the governance substrate to any specific telemetry
//! backend at compile time.

pub mod metrics;
pub mod dashboards;
