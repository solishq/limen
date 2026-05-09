#!/bin/bash
# @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
# @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §6.3

# SolisForge Self-Audit Trigger v1.0.0
# Invoked by Divergence Detector when P0/P1 issues are found.
# Creates a Forge Critical cycle and blocks further work.
#
# Usage: bash scripts/solisforge-self-audit-trigger.sh <p0_count> <p1_count>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

P0_COUNT="${1:-0}"
P1_COUNT="${2:-0}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

CONVERGENCE_FILE="$PROJECT_ROOT/CONVERGENCE_REQUIRED.md"

cat > "$CONVERGENCE_FILE" << EOF
<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §6.3 -->

# CONVERGENCE REQUIRED — Forge Critical

**Generated:** $TIMESTAMP
**Trigger:** Divergence Detector found P0: $P0_COUNT, P1: $P1_COUNT
**Authority:** SolisForge Protocol v1.4 §9 (Zero-Residual Law)
**Blocking:** All further work until resolved

---

## Required Actions

1. Run the Traceability Scanner to identify all non-compliant files:
   \`\`\`bash
   bash scripts/solisforge-traceability-scanner.sh --verbose
   \`\`\`

2. Fix all violations (add SolisForge v1.4 governance declarations)

3. Run the Divergence Detector to confirm resolution:
   \`\`\`bash
   bash scripts/solisforge-divergence-detector.sh
   \`\`\`

4. Delete this file only after all P0/P1 issues are resolved

---

**SolisForge Protocol v1.4 — Zero-Residual Law: No finding remains open.**
EOF

echo ""
echo "============================================"
echo "  FORGE CRITICAL: CONVERGENCE REQUIRED"
echo "============================================"
echo ""
echo "  P0 findings: $P0_COUNT"
echo "  P1 findings: $P1_COUNT"
echo "  Timestamp:   $TIMESTAMP"
echo ""
echo "  Created: CONVERGENCE_REQUIRED.md"
echo "  Status:  ALL WORK BLOCKED until resolved"
echo ""
echo "  Run: bash scripts/solisforge-traceability-scanner.sh --verbose"
echo "  to identify non-compliant files."
echo ""
echo "============================================"
