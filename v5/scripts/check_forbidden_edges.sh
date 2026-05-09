#!/usr/bin/env bash
# @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
# @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
# Limen v5 — Forbidden dependency edge checker
# Enforces Document 27 v1.3 Section 0.2 at CI time.
# Uses `cargo metadata` to parse the workspace dependency graph.
# Exit 1 if any forbidden edge is detected.

set -euo pipefail

FORBIDDEN_EDGES=(
    # Format: "source_crate:forbidden_dependency"
    # v1.3 §0.2: limen_foundation_contract MUST NOT depend on anything except limen_types
    "limen_foundation_contract:limen_chain"
    "limen_foundation_contract:limen_projection"
    "limen_foundation_contract:limen_foundation_ops"
    "limen_foundation_contract:limen_substrate_runtime"
    "limen_foundation_contract:limen_substrate"
    "limen_foundation_contract:limen_api"
    "limen_foundation_contract:limen_canonical"
    # v1.3 §0.2: limen_foundation_ops MUST NOT depend on limen_projection, limen_chain
    "limen_foundation_ops:limen_projection"
    "limen_foundation_ops:limen_chain"
    # v1.3 §0.2: limen_chain MUST NOT depend on limen_projection, limen_foundation_ops
    "limen_chain:limen_projection"
    "limen_chain:limen_foundation_ops"
    # v1.3 §0.2: limen_substrate_runtime MUST NOT depend on limen_projection
    "limen_substrate_runtime:limen_projection"
    # v1.5 Amendment C: limen_consensus MUST NOT depend on limen_projection, limen_chain
    "limen_consensus:limen_projection"
    "limen_consensus:limen_chain"
    # limen_foundation_contract MUST NOT depend on limen_consensus
    "limen_foundation_contract:limen_consensus"
)

# Get workspace metadata
METADATA=$(cargo metadata --format-version=1 --no-deps 2>/dev/null)

VIOLATIONS=0
for edge in "${FORBIDDEN_EDGES[@]}"; do
    SOURCE="${edge%%:*}"
    FORBIDDEN="${edge##*:}"

    # Check if SOURCE's dependencies include FORBIDDEN
    DEPS=$(echo "$METADATA" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for pkg in data['packages']:
    if pkg['name'] == '$SOURCE':
        for dep in pkg['dependencies']:
            if dep['name'] == '$FORBIDDEN':
                print('VIOLATION')
                break
" 2>/dev/null || true)

    if [ "$DEPS" = "VIOLATION" ]; then
        echo "FORBIDDEN EDGE: $SOURCE depends on $FORBIDDEN (v1.3 §0.2 violation)"
        VIOLATIONS=$((VIOLATIONS + 1))
    fi
done

# Check for unauthorized Profile 3+ crates (limen_consensus authorized by v1.5 Amendment C)
for CRATE in limen_cluster_storage limen_durable_edge; do
    if echo "$METADATA" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for pkg in data['packages']:
    if pkg['name'] == '$CRATE':
        print('EXISTS')
        break
" 2>/dev/null | grep -q EXISTS; then
        echo "FORBIDDEN CRATE: $CRATE exists in workspace (Profile 3+ not authorized)"
        VIOLATIONS=$((VIOLATIONS + 1))
    fi
done

if [ "$VIOLATIONS" -gt 0 ]; then
    echo ""
    echo "FAILED: $VIOLATIONS forbidden dependency edge(s) detected."
    echo "See Document 27 v1.3 Section 0.2 for the authoritative forbidden edge list."
    exit 1
fi

echo "OK: No forbidden dependency edges detected."
exit 0
