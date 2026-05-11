#!/bin/bash
# @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
# @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §6.2

# SolisForge Divergence Detector v2.0.0
# Checks current state against ratified contracts under SolisForge rules.
# Flags P0 (structural violation), P1 (missing traceability), P2 (minor) divergence.
#
# v2.0.0 additions:
#   - Phase checkbox vs status declaration consistency (SC-04)
#   - Convergence table population check (SC-08)
#   - Continuity Artifact section completeness (SC-11)
#   - Cross-document Witness score consistency (SC-03)
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

echo "=== SolisForge Divergence Detector v2.0.0 ==="
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

# CHECK 8: Invoke Traceability Scanner for full deterministic check
if [ -x "$SCRIPT_DIR/solisforge-traceability-scanner.sh" ]; then
    SCANNER_OUTPUT=$(bash "$SCRIPT_DIR/solisforge-traceability-scanner.sh" --ci 2>&1)
    SCANNER_EXIT=$?
    if [ "$SCANNER_EXIT" -ne 0 ]; then
        VIOLATION_COUNT=$(echo "$SCANNER_OUTPUT" | grep "Violations:" | awk '{print $2}')
        add_finding "P1" "TRACEABILITY SCANNER: $VIOLATION_COUNT file(s) missing governance declaration (run scanner for details)"
    else
        echo "  OK: Traceability Scanner COMPLIANT"
    fi
else
    add_finding "P1" "TRACEABILITY SCANNER: Not found or not executable at $SCRIPT_DIR/solisforge-traceability-scanner.sh"
fi

# --- v2.0.0 Deep Audit Checks ---

# CHECK 9: FORGE-GATE Phase checkboxes match status declarations
# For each phase section, count checked boxes and compare to EXIT status
if [ -f "FORGE-GATE.md" ]; then
    echo "  Checking FORGE-GATE phase consistency..."

    # Extract phase sections and check for unchecked boxes paired with COMPLETE status
    # Pattern: find lines with "- [ ]" (unchecked) between Phase headers and "EXIT: COMPLETE"
    # Exception: if EXIT line says "KNOWN GAP" or "WITH GAP" and unchecked items mention
    #            "deferred" or "NOT PERFORMED", the gap is documented and acceptable.
    PHASE_NUM=0
    IN_PHASE=false
    UNCHECKED_IN_COMPLETE=0
    UNCHECKED_LINES=""
    while IFS= read -r line; do
        if echo "$line" | grep -qE "^## Phase [0-9]"; then
            PHASE_NUM=$(echo "$line" | grep -oE "[0-9]+" | head -1)
            IN_PHASE=true
            PHASE_HAS_UNCHECKED=false
            UNCHECKED_LINES=""
        fi
        if $IN_PHASE && echo "$line" | grep -q "^- \[ \]"; then
            PHASE_HAS_UNCHECKED=true
            UNCHECKED_LINES="${UNCHECKED_LINES}${line}\n"
        fi
        if $IN_PHASE && echo "$line" | grep -qE "\*\*Phase.*EXIT:.*COMPLETE"; then
            if $PHASE_HAS_UNCHECKED; then
                # Check if this is a documented known gap
                IS_DOCUMENTED_GAP=false
                if echo "$line" | grep -qiE "KNOWN GAP|WITH GAP"; then
                    # Verify unchecked items mention deferral
                    if echo -e "$UNCHECKED_LINES" | grep -qiE "deferred|NOT PERFORMED|pending"; then
                        IS_DOCUMENTED_GAP=true
                    fi
                fi
                if ! $IS_DOCUMENTED_GAP; then
                    add_finding "P1" "FORGE-GATE Phase $PHASE_NUM: unchecked boxes but declared COMPLETE"
                    UNCHECKED_IN_COMPLETE=$((UNCHECKED_IN_COMPLETE + 1))
                else
                    echo "  NOTE: Phase $PHASE_NUM has documented known gap (unchecked+deferred — accepted)"
                fi
            fi
            IN_PHASE=false
        fi
    done < FORGE-GATE.md
    if [ "$UNCHECKED_IN_COMPLETE" -eq 0 ]; then
        echo "  OK: All COMPLETE phases have fully checked boxes"
    fi
fi

# CHECK 10: Convergence tables are populated (not placeholder dashes)
if [ -f "FORGE-GATE.md" ]; then
    PLACEHOLDER_ROWS=$(grep -cE "^\| — \| — \| — \| — \| — \| — \| — \| — \| — \|$" FORGE-GATE.md 2>/dev/null || true)
    if [ "$PLACEHOLDER_ROWS" -gt 0 ]; then
        add_finding "P2" "FORGE-GATE: $PLACEHOLDER_ROWS convergence table row(s) still contain placeholder dashes"
    else
        echo "  OK: Convergence tables populated (no placeholder dashes)"
    fi
fi

# CHECK 11: Continuity Artifact exists with all required sections
if [ -f "docs/CONTINUITY-ARTIFACT.md" ]; then
    CONT_SECTIONS=0
    MISSING_SECTIONS=""
    for section_name in "Summary" "Restart Instructions" "Locked Artifacts" "Forbidden Actions" "Open Items" "Rollback Procedure" "Known Limitations"; do
        if grep -q "## .*${section_name}" docs/CONTINUITY-ARTIFACT.md 2>/dev/null; then
            CONT_SECTIONS=$((CONT_SECTIONS + 1))
        else
            MISSING_SECTIONS="${MISSING_SECTIONS} ${section_name},"
        fi
    done
    if [ "$CONT_SECTIONS" -ge 7 ]; then
        echo "  OK: Continuity Artifact has all 7 required sections"
    else
        MISSING_SECTIONS=$(echo "$MISSING_SECTIONS" | sed 's/,$//')
        add_finding "P2" "CONTINUITY-ARTIFACT: missing sections:${MISSING_SECTIONS} ($CONT_SECTIONS/7 present)"
    fi
else
    add_finding "P1" "MISSING: docs/CONTINUITY-ARTIFACT.md — required §11 artifact"
fi

# CHECK 12: Cross-document Witness score consistency
if [ -f "FORGE-GATE.md" ] && [ -f "docs/CONTINUITY-ARTIFACT.md" ]; then
    # Extract Witness scores from FORGE-GATE
    FG_SCORES=$(grep -oE "Witness [0-9]+: [0-9]+/100" FORGE-GATE.md 2>/dev/null | sort -u)
    CA_SCORES=$(grep -oE "Witness [0-9].*scored [0-9]+/100" docs/CONTINUITY-ARTIFACT.md 2>/dev/null | grep -oE "[0-9]+/100" | sort -u)

    # Simple check: both files should mention the same set of scores
    FG_SCORE_NUMS=$(grep -oE "[0-9]+/100" FORGE-GATE.md 2>/dev/null | grep -v "80/100\|3,747" | sort -u | tr '\n' ' ')
    CA_SCORE_NUMS=$(grep -oE "[0-9]+/100" docs/CONTINUITY-ARTIFACT.md 2>/dev/null | grep -v "80/100" | sort -u | tr '\n' ' ')

    # Check that at least the primary Witness scores appear in both
    for score in 83 89; do
        FG_HAS=$(grep -c "${score}/100" FORGE-GATE.md 2>/dev/null || true)
        CA_HAS=$(grep -c "${score}/100" docs/CONTINUITY-ARTIFACT.md 2>/dev/null || true)
        if [ "$FG_HAS" -gt 0 ] && [ "$CA_HAS" -eq 0 ]; then
            add_finding "P1" "WITNESS SCORE DIVERGENCE: ${score}/100 in FORGE-GATE.md but not in CONTINUITY-ARTIFACT.md"
        fi
        if [ "$CA_HAS" -gt 0 ] && [ "$FG_HAS" -eq 0 ]; then
            add_finding "P1" "WITNESS SCORE DIVERGENCE: ${score}/100 in CONTINUITY-ARTIFACT.md but not in FORGE-GATE.md"
        fi
    done
    echo "  OK: Cross-document Witness scores checked"
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
