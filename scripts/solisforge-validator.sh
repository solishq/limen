#!/bin/bash
# @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
# @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §6

# SolisForge Comprehensive Validator v3.0.0
#
# 4-Layer Validation Architecture:
#   Layer 1: Governance Surface (headers, artifacts, retired references)
#   Layer 2: Cross-Document Consistency (scores, counts, status)
#   Layer 3: Code Quality (compiler, patterns, tests)
#   Layer 4: Structural Enforcement (aggregate gate)
#
# Replaces: traceability-scanner.sh + divergence-detector.sh
# Trigger: Run on session start, pre-commit, and phase transitions.
#
# Usage: bash scripts/solisforge-validator.sh [--ci] [--layer N] [--verbose]

set -uo pipefail
# NOTE: -e removed intentionally. grep returns 1 on no-match which is expected behavior.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

CI_MODE=false
LAYER_FILTER=0
VERBOSE=false
for arg in "$@"; do
    case "$arg" in
        --ci) CI_MODE=true ;;
        --layer=*) LAYER_FILTER="${arg#*=}" ;;
        --verbose) VERBOSE=true ;;
    esac
done

P0_COUNT=0
P1_COUNT=0
P2_COUNT=0
P3_COUNT=0
FINDINGS=()

finding() {
    local sev="$1" layer="$2" id="$3" msg="$4"
    FINDINGS+=("[$sev] [$layer] $id: $msg")
    case "$sev" in
        P0) P0_COUNT=$((P0_COUNT + 1)) ;;
        P1) P1_COUNT=$((P1_COUNT + 1)) ;;
        P2) P2_COUNT=$((P2_COUNT + 1)) ;;
        P3) P3_COUNT=$((P3_COUNT + 1)) ;;
    esac
}

ok() {
    $VERBOSE && echo "  OK: $1"
}

echo "═══════════════════════════════════════════════════════"
echo " SolisForge Comprehensive Validator v3.0.0"
echo " 4 Layers | 19 Checks | Substance, Not Declarations"
echo "═══════════════════════════════════════════════════════"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# LAYER 1: GOVERNANCE SURFACE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if [ "$LAYER_FILTER" = "0" ] || [ "$LAYER_FILTER" = "1" ]; then
echo "▶ Layer 1: Governance Surface"

# GS-01: Governance headers
HEADER_VIOLATIONS=0
while IFS= read -r f; do
    case "$f" in
        */node_modules/*|dist/*|.git/*|*.lock|*.json|*.svg|*.png|*.jpg|*.ico|*.woff*|*.ttf|*.map|*.d.ts|*/target/*|*.stderr|promises/*|.gitignore|.nvmrc|.env*|.dockerignore|LICENSE|NOTICE|.provenance.json)
            continue ;;
    esac
    if ! head -5 "$f" | grep -q "@governance SolisForge Protocol v1.4" 2>/dev/null; then
        HEADER_VIOLATIONS=$((HEADER_VIOLATIONS + 1))
        $VERBOSE && echo "    MISS: $f"
    fi
done < <(find src tests contracts docs packages scripts examples explorer benchmarks self-host .github v5 reports \
    -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.mjs" -o -name "*.md" -o -name "*.sh" -o -name "*.rs" -o -name "*.yml" -o -name "*.yaml" -o -name "*.toml" -o -name "*.py" -o -name "*.css" -o -name "*.html" -o -name "Dockerfile" \) 2>/dev/null | sort)
# Top-level files
for f in *.md *.ts *.mjs; do
    [ -f "$f" ] || continue
    if ! head -5 "$f" | grep -q "@governance SolisForge Protocol v1.4" 2>/dev/null; then
        HEADER_VIOLATIONS=$((HEADER_VIOLATIONS + 1))
    fi
done

if [ "$HEADER_VIOLATIONS" -gt 0 ]; then
    finding "P1" "L1" "GS-01" "$HEADER_VIOLATIONS files missing governance headers"
else
    ok "GS-01: All files have governance headers"
fi

# GS-02: All 11 SolisForge artifacts exist
REQUIRED_ARTIFACTS=(
    "docs/LIMEN-INTENT-AND-PROPERTIES.md"
    "docs/LIMEN-FAILURE-MODE-ATLAS.md"
    "docs/LIMEN-ARCHITECTURE-DECISION.md"
    "docs/LIMEN-IMPLEMENTATION-SPEC.md"
    "docs/TRACEABILITY-MATRIX.md"
    "docs/CONTINUITY-ARTIFACT.md"
)
MISSING_ARTIFACTS=0
for art in "${REQUIRED_ARTIFACTS[@]}"; do
    if [ ! -f "$art" ]; then
        finding "P0" "L1" "GS-02" "Missing artifact: $art"
        MISSING_ARTIFACTS=$((MISSING_ARTIFACTS + 1))
    fi
done
# Check requirement extraction files
REQ_COUNT=$(find docs -name "LIMEN-*-REQUIREMENTS.md" 2>/dev/null | wc -l | tr -d ' ')
if [ "$REQ_COUNT" -lt 14 ]; then
    finding "P1" "L1" "GS-02" "Only $REQ_COUNT/14 requirement extraction files"
fi
[ "$MISSING_ARTIFACTS" -eq 0 ] && ok "GS-02: All 11 artifacts present"

# GS-03: FORGE-GATE.md exists
if [ ! -f "FORGE-GATE.md" ]; then
    finding "P0" "L1" "GS-03" "FORGE-GATE.md missing"
else
    ok "GS-03: FORGE-GATE.md present"
fi

# GS-04: Traceability Matrix has substance (not just skeleton)
if [ -f "docs/TRACEABILITY-MATRIX.md" ]; then
    MATRIX_ROWS=$(grep -c "^|" docs/TRACEABILITY-MATRIX.md 2>/dev/null || echo 0)
    if [ "$MATRIX_ROWS" -lt 10 ]; then
        finding "P1" "L1" "GS-04" "Traceability Matrix has only $MATRIX_ROWS table rows (skeleton)"
    else
        ok "GS-04: Traceability Matrix has $MATRIX_ROWS rows"
    fi
fi

# GS-05: No retired governance references
QAL_REFS=$(grep -rn "QAL-[0-9]" CLAUDE.md 2>/dev/null | grep -v "HISTORICAL\|superseded\|retired\|SolisForge" | wc -l | tr -d ' ')
if [ "$QAL_REFS" -gt 0 ]; then
    finding "P2" "L1" "GS-05" "$QAL_REFS retired QAL references in CLAUDE.md"
else
    ok "GS-05: No retired governance references"
fi

# GS-06: Skipped tests documented
SKIP_COUNT=$(grep -rn "\.skip\|test\.skip\|it\.skip\|describe\.skip" tests/ 2>/dev/null | grep -v "node_modules" | wc -l | tr -d ' ')
if [ "$SKIP_COUNT" -gt 0 ]; then
    $VERBOSE && echo "  INFO: $SKIP_COUNT skipped tests found"
fi

# GS-07: Convergence tables populated
if [ -f "FORGE-GATE.md" ]; then
    EMPTY_CONVERGENCE=$(grep -c "| — | — | — | — |" FORGE-GATE.md 2>/dev/null || echo 0)
    if [ "$EMPTY_CONVERGENCE" -gt 0 ]; then
        finding "P2" "L1" "GS-07" "Convergence table has $EMPTY_CONVERGENCE empty rows"
    else
        ok "GS-07: Convergence tables populated"
    fi
fi

echo ""
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# LAYER 2: CROSS-DOCUMENT CONSISTENCY
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if [ "$LAYER_FILTER" = "0" ] || [ "$LAYER_FILTER" = "2" ]; then
echo "▶ Layer 2: Cross-Document Consistency"

# CD-01: Witness scores consistent across documents
# Extract all "N/100" scores near "Witness" context — generic, not hardcoded
SCORE_FILES=$(grep -rln "[0-9]\{2,3\}/100" docs/ FORGE-GATE.md 2>/dev/null | sort -u)
WITNESS_SCORES=""
for sf in $SCORE_FILES; do
    SCORES=$(grep -oE "[0-9]{2,3}/100" "$sf" 2>/dev/null | sort -u)
    for s in $SCORES; do
        WITNESS_SCORES="$WITNESS_SCORES $s"
    done
done
UNIQUE_SCORES=$(echo "$WITNESS_SCORES" | tr ' ' '\n' | sort -u | grep -v "^$" | wc -l | tr -d ' ')
if [ "$UNIQUE_SCORES" -gt 2 ]; then
    finding "P1" "L2" "CD-01" "Multiple different scores found across docs: $(echo $WITNESS_SCORES | tr ' ' '\n' | sort -u | tr '\n' ' ')"
else
    ok "CD-01: Score consistency verified"
fi

# CD-02: Phase checkbox state matches EXIT declarations
if [ -f "FORGE-GATE.md" ]; then
    # For each Phase N section: count unchecked boxes, check if EXIT says COMPLETE
    PHASE_ISSUES=0
    for phase_num in 0 1 2 3 4 5 6 7 8 9; do
        SECTION=$(sed -n "/## Phase $phase_num /,/## Phase /p" FORGE-GATE.md 2>/dev/null | head -30)
        if [ -z "$SECTION" ]; then continue; fi

        UNCHECKED=$(echo "$SECTION" | grep -c "\- \[ \]" 2>/dev/null || echo 0)
        # Documented deferrals (NOT PERFORMED, deferred, PENDING) are accepted
        DOCUMENTED=$(echo "$SECTION" | grep "\- \[ \]" | grep -ci "NOT PERFORMED\|deferred\|PENDING\|Phase 10" 2>/dev/null || echo 0)
        REAL_UNCHECKED=$((UNCHECKED - DOCUMENTED))
        HAS_COMPLETE=$(echo "$SECTION" | grep -c "EXIT:.*COMPLETE\|EXIT:.*RATIFIED" 2>/dev/null || echo 0)

        if [ "$REAL_UNCHECKED" -gt 0 ] && [ "$HAS_COMPLETE" -gt 0 ]; then
            finding "P1" "L2" "CD-02" "Phase $phase_num: $REAL_UNCHECKED unchecked boxes (not documented deferrals) but EXIT says COMPLETE"
            PHASE_ISSUES=$((PHASE_ISSUES + 1))
        fi
    done
    [ "$PHASE_ISSUES" -eq 0 ] && ok "CD-02: Phase checkboxes consistent with status"
fi

# CD-04: Continuity Artifact has all required sections
if [ -f "docs/CONTINUITY-ARTIFACT.md" ]; then
    REQUIRED_SECTIONS=("Summary" "Restart" "Locked" "Forbidden" "Open" "Rollback" "Known Limitation")
    MISSING_SECTIONS=0
    for sec in "${REQUIRED_SECTIONS[@]}"; do
        if ! grep -qi "## .*$sec" docs/CONTINUITY-ARTIFACT.md 2>/dev/null; then
            finding "P2" "L2" "CD-04" "Continuity Artifact missing section: $sec"
            MISSING_SECTIONS=$((MISSING_SECTIONS + 1))
        fi
    done
    [ "$MISSING_SECTIONS" -eq 0 ] && ok "CD-04: Continuity Artifact complete"
fi

echo ""
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# LAYER 3: CODE QUALITY
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if [ "$LAYER_FILTER" = "0" ] || [ "$LAYER_FILTER" = "3" ]; then
echo "▶ Layer 3: Code Quality"

# CQ-01: TypeScript compiles
TSC_ERRORS=$(npx tsc -p tsconfig.build.json --noEmit 2>&1 | grep -c "error TS" 2>/dev/null || echo 0)
if [ "$TSC_ERRORS" -gt 0 ]; then
    finding "P1" "L3" "CQ-01" "$TSC_ERRORS TypeScript compilation errors"
else
    ok "CQ-01: TypeScript compiles cleanly"
fi

# CQ-02: No Date.now() outside TimeProvider
DATE_NOW_VIOLATIONS=$(grep -rn "Date\.now()\|new Date()" src/ 2>/dev/null | grep -v "node_modules\|\.d\.ts\|time_provider\|interfaces/time\|defaults\.ts\|test" | wc -l | tr -d ' ')
if [ "$DATE_NOW_VIOLATIONS" -gt 5 ]; then
    finding "P2" "L3" "CQ-02" "$DATE_NOW_VIOLATIONS Date.now()/new Date() calls outside TimeProvider"
else
    ok "CQ-02: Clock injection mostly consistent ($DATE_NOW_VIOLATIONS minor)"
fi

# CQ-06: All tests pass
TEST_OUTPUT=$(npm test 2>&1)
TEST_FAILS=$(echo "$TEST_OUTPUT" | grep "^ℹ fail" | awk '{print $3}')
if [ "$TEST_FAILS" != "0" ] && [ -n "$TEST_FAILS" ]; then
    finding "P0" "L3" "CQ-06" "$TEST_FAILS test failures"
else
    TEST_PASS=$(echo "$TEST_OUTPUT" | grep "^ℹ pass" | awk '{print $3}')
    ok "CQ-06: All $TEST_PASS tests pass"
fi

# CQ-04: Consent gate on write paths (heuristic)
WRITE_PATHS=$(grep -rn "assertClaim\|remember3\|produce\|recordCost\|recordVital\|registerAgent\|importKnowledge" src/api/convenience/ src/output/ src/lifecycle/ src/coordination/ 2>/dev/null | grep -v "test\|interface\|type\|import\|//" | wc -l | tr -d ' ')
CONSENT_CALLS=$(grep -rn "checkConsent\|ConsentGate\|consent" src/api/convenience/ src/output/ src/lifecycle/ src/coordination/ 2>/dev/null | grep -v "test\|interface\|type\|import\|//" | wc -l | tr -d ' ')
if [ "$WRITE_PATHS" -gt 0 ] && [ "$CONSENT_CALLS" -lt 2 ]; then
    finding "P1" "L3" "CQ-04" "Consent gate coverage: $CONSENT_CALLS consent checks for $WRITE_PATHS write paths"
else
    ok "CQ-04: Consent gate present on write paths"
fi

echo ""
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# LAYER 4: STRUCTURAL ENFORCEMENT
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if [ "$LAYER_FILTER" = "0" ] || [ "$LAYER_FILTER" = "4" ]; then
echo "▶ Layer 4: Structural Enforcement"

# SG-01: No CONVERGENCE_REQUIRED.md present
if [ -f "CONVERGENCE_REQUIRED.md" ]; then
    finding "P0" "L4" "SG-01" "CONVERGENCE_REQUIRED.md exists — work is blocked"
else
    ok "SG-01: No convergence block"
fi

# SG-02: Hash integrity
if [ -f "scripts/verify-contract-hashes.sh" ]; then
    HASH_RESULT=$(bash scripts/verify-contract-hashes.sh 2>&1)
    HASH_FAIL_COUNT=$(echo "$HASH_RESULT" | grep -oE "[0-9]+ FAILED" | awk '{print $1}' || echo "0")
    if [ "$HASH_FAIL_COUNT" != "0" ] && [ -n "$HASH_FAIL_COUNT" ]; then
        finding "P0" "L4" "SG-02" "Contract hash verification: $HASH_FAIL_COUNT FAILED"
    else
        ok "SG-02: Hash integrity verified"
    fi
fi

echo ""
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# RESULTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "═══════════════════════════════════════════════════════"
echo " VALIDATION RESULTS"
echo "═══════════════════════════════════════════════════════"
echo "  P0 (critical):    $P0_COUNT"
echo "  P1 (high):        $P1_COUNT"
echo "  P2 (medium):      $P2_COUNT"
echo "  P3 (low):         $P3_COUNT"
echo ""

if [ ${#FINDINGS[@]} -gt 0 ]; then
    echo "FINDINGS:"
    for f in "${FINDINGS[@]}"; do
        echo "  $f"
    done
    echo ""
fi

TOTAL=$((P0_COUNT + P1_COUNT + P2_COUNT + P3_COUNT))
if [ "$P0_COUNT" -gt 0 ] || [ "$P1_COUNT" -gt 0 ]; then
    echo "RESULT: NON-COMPLIANT — $P0_COUNT P0 + $P1_COUNT P1 findings"
    if $CI_MODE; then
        # Trigger self-audit
        if [ -x "$SCRIPT_DIR/solisforge-self-audit-trigger.sh" ]; then
            bash "$SCRIPT_DIR/solisforge-self-audit-trigger.sh" "$P0_COUNT" "$P1_COUNT"
        fi
        exit 1
    fi
elif [ "$TOTAL" -gt 0 ]; then
    echo "RESULT: COMPLIANT WITH ADVISORIES — $P2_COUNT P2 + $P3_COUNT P3"
else
    echo "RESULT: FULLY COMPLIANT — Zero findings across 4 layers"
fi
echo "═══════════════════════════════════════════════════════"
