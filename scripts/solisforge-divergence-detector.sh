#!/bin/bash
# @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
# @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §6.2

# SolisForge Divergence Detector v1.0.0
# Checks current state against ratified contracts under SolisForge rules.
# Flags P0 (structural violation) and P1 (missing traceability) divergence.
#
# Usage: bash scripts/solisforge-divergence-detector.sh
#
# Designed to run on every commit (via pre-commit hook) or session start.
# If P0/P1 issues are found, invokes the Self-Audit Trigger.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

P0_COUNT=0
P1_COUNT=0
P2_COUNT=0
FINDINGS=()

add_finding() {
    local severity="$1"
    local message="$2"
    FINDINGS+=("[$severity] $message")
    case "$severity" in
        P0) P0_COUNT=$((P0_COUNT + 1)) ;;
        P1) P1_COUNT=$((P1_COUNT + 1)) ;;
        P2) P2_COUNT=$((P2_COUNT + 1)) ;;
    esac
}

echo "=== SolisForge Divergence Detector v1.0.0 ==="
echo "Checking: $PROJECT_ROOT"
echo "Baseline: f4ead70 (release/v5)"
echo ""

# CHECK 1: Integration contract exists
if [ ! -f "contracts/LIMEN_V5_INTEGRATION_CONTRACT.md" ]; then
    add_finding "P0" "MISSING: contracts/LIMEN_V5_INTEGRATION_CONTRACT.md — convergence contract absent"
else
    echo "  OK: Integration contract present"
fi

# CHECK 2: SolisForge governance declaration in all contracts
for f in contracts/*.md; do
    [ -f "$f" ] || continue
    if ! head -5 "$f" | grep -q "@governance SolisForge Protocol v1.4" 2>/dev/null; then
        add_finding "P0" "CONTRACT UNGOVERNED: $f — no SolisForge v1.4 declaration"
    fi
done

# CHECK 3: No authoritative references to superseded standards
AUTH_REFS=$(grep -rn "CDM v2.1\|Premier Engineering Standard v2.2" contracts/ docs/ *.md --include="*.md" 2>/dev/null | grep -v "HISTORICAL\|superseded\|LIMEN_V5_INTEGRATION\|changelog\|CHANGELOG\|@governance\|@traceability" | grep -c "Governing:\|governing:" 2>/dev/null || true)
if [ "$AUTH_REFS" -gt 0 ]; then
    add_finding "P1" "DUAL STANDARD: $AUTH_REFS authoritative reference(s) to superseded governance still present"
fi

# CHECK 4: Traceability scanner exists and is executable
if [ ! -f "scripts/solisforge-traceability-scanner.sh" ]; then
    add_finding "P1" "MISSING: Traceability Scanner not installed"
elif [ ! -x "scripts/solisforge-traceability-scanner.sh" ]; then
    add_finding "P2" "NOT EXECUTABLE: Traceability Scanner missing execute permission"
fi

# CHECK 5: Self-audit trigger exists
if [ ! -f "scripts/solisforge-self-audit-trigger.sh" ]; then
    add_finding "P1" "MISSING: Self-Audit Trigger not installed"
fi

# CHECK 6: Manifest governance field
if [ -f "contracts/phase-x.contracts.json" ]; then
    if ! grep -q "SolisForge Protocol v1.4" contracts/phase-x.contracts.json 2>/dev/null; then
        add_finding "P1" "MANIFEST DRIFT: phase-x.contracts.json does not reference SolisForge v1.4"
    fi
fi

# CHECK 7: Master Index doctrine anchor
if [ -f "MASTER-INDEX-v2.1-FINAL.md" ]; then
    if ! grep -q "SolisForge Protocol v1.4" MASTER-INDEX-v2.1-FINAL.md 2>/dev/null; then
        add_finding "P0" "MASTER INDEX: Doctrine anchor does not reference SolisForge v1.4"
    fi
fi

# CHECK 8: Source file sampling (check 10 random files for headers)
SAMPLE_FILES=$(find src -name "*.ts" -type f 2>/dev/null | shuf | head -10)
SAMPLE_MISSING=0
for f in $SAMPLE_FILES; do
    if ! head -3 "$f" | grep -q "@governance SolisForge Protocol v1.4" 2>/dev/null; then
        SAMPLE_MISSING=$((SAMPLE_MISSING + 1))
    fi
done
if [ "$SAMPLE_MISSING" -gt 0 ]; then
    add_finding "P1" "SOURCE DRIFT: $SAMPLE_MISSING of 10 sampled source files missing governance declaration"
fi

echo ""
echo "=== Divergence Report ==="
echo "  P0 (structural):   $P0_COUNT"
echo "  P1 (traceability): $P1_COUNT"
echo "  P2 (minor):        $P2_COUNT"
echo ""

if [ ${#FINDINGS[@]} -gt 0 ]; then
    echo "Findings:"
    for finding in "${FINDINGS[@]}"; do
        echo "  $finding"
    done
    echo ""
fi

if [ "$P0_COUNT" -gt 0 ] || [ "$P1_COUNT" -gt 0 ]; then
    echo "DIVERGENCE DETECTED — P0: $P0_COUNT, P1: $P1_COUNT"
    echo "Invoking Self-Audit Trigger..."
    if [ -x "$SCRIPT_DIR/solisforge-self-audit-trigger.sh" ]; then
        bash "$SCRIPT_DIR/solisforge-self-audit-trigger.sh" "$P0_COUNT" "$P1_COUNT"
    else
        echo "WARNING: Self-Audit Trigger not available — manual remediation required"
    fi
    exit 1
else
    echo "RESULT: NO DIVERGENCE — State is consistent with SolisForge v1.4 governance"
    exit 0
fi
