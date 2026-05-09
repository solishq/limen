#!/usr/bin/env bash
# @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
# @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
# Limen v5 — Local CI check script
# Runs all verification steps that would run in CI.
# Execute before every commit/PR. Exit 1 on any failure.
#
# This is the enforcement mechanism for Document 27 v1.3 §0.2 (forbidden edges),
# §0.5 (unsafe forbidden), and DOC-28 §8 (workspace structural enforcement).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_DIR="$(dirname "$SCRIPT_DIR")"
cd "$WORKSPACE_DIR"

echo "========================================="
echo "Limen v5 CI Check"
echo "========================================="
echo ""

# Step 1: Build entire workspace
echo "[1/6] cargo build --workspace"
cargo build --workspace 2>&1
echo "  PASS"
echo ""

# Step 2: Forbidden dependency edge check
echo "[2/6] Forbidden edge check (v1.3 §0.2)"
bash scripts/check_forbidden_edges.sh
echo ""

# Step 3: Full workspace tests (includes compile-fail via trybuild)
echo "[3/6] cargo test --workspace"
cargo test --workspace 2>&1
echo "  PASS"
echo ""

# Step 4: Foundation contract compile-fail tests explicitly
# (redundant with step 3 but makes the compile-fail run visible in output)
echo "[4/6] cargo test -p limen_foundation_contract (compile-fail)"
cargo test -p limen_foundation_contract 2>&1
echo "  PASS"
echo ""

# Step 5: Projection integration tests (require test-support feature)
# These 126 tests are gated behind the test-support feature and invisible to --workspace.
echo "[5/6] cargo test -p limen_projection --features test-support"
cargo test -p limen_projection --features test-support 2>&1
echo "  PASS"
echo ""

# Step 6: Consensus trait-impl verification (requires consensus feature)
# The most important consensus test — compile-time proof that ConsensusChainStorage
# implements ChainReadContext — is behind cfg(feature = "consensus"). Without this step,
# `cargo test --workspace` silently skips it (0 tests run for limen_consensus).
echo "[6/6] cargo test -p limen_consensus --features consensus"
cargo test -p limen_consensus --features consensus 2>&1
echo "  PASS"
echo ""

echo "========================================="
echo "ALL CI CHECKS PASSED"
echo "========================================="
