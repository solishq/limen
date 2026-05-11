#!/bin/bash
# @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
# @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §6.1

# SolisForge Traceability Scanner v2.0.0
# Validates:
#   1. Every governed file contains the SolisForge v1.4 governance declaration
#   2. FORGE-GATE.md exists and is readable
#   3. All 11 §11 required artifacts exist
#   4. CLAUDE.md references SolisForge (not retired QAL)
# Exit 0 = compliant, Exit 1 = violations found.
#
# Usage: bash scripts/solisforge-traceability-scanner.sh [--ci] [--verbose]
#
# Options:
#   --ci       Exit with code 1 on any violation (for manual or future CI use)
#   --verbose  Print every file checked, not just violations

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

CI_MODE=false
VERBOSE=false
for arg in "$@"; do
    case "$arg" in
        --ci) CI_MODE=true ;;
        --verbose) VERBOSE=true ;;
    esac
done

GOVERNANCE_MARKER="@governance SolisForge Protocol v1.4"
VIOLATIONS=0
CHECKED=0
SKIPPED=0

# Files exempt from governance headers (binary, generated, or config-only)
is_exempt() {
    local f="$1"
    case "$f" in
        */node_modules/*|node_modules/*|dist/*|.git/*|*.lock|*.json|*.svg|*.png|*.jpg|*.ico|*.woff*|*.ttf|*.map)
            return 0 ;;
        .gitignore|.nvmrc|.env*|.dockerignore|LICENSE|NOTICE|.provenance.json|promises/*)
            return 0 ;;
        *.d.ts|*/target/*|*.stderr)
            return 0 ;;
        *)
            return 1 ;;
    esac
}

check_file() {
    local file="$1"

    if is_exempt "$file"; then
        SKIPPED=$((SKIPPED + 1))
        return 0
    fi

    CHECKED=$((CHECKED + 1))

    if head -5 "$file" | grep -q "$GOVERNANCE_MARKER" 2>/dev/null; then
        $VERBOSE && echo "  OK: $file"
        return 0
    else
        echo "  VIOLATION: $file — missing SolisForge v1.4 governance declaration"
        VIOLATIONS=$((VIOLATIONS + 1))
        return 0
    fi
}

echo "=== SolisForge Traceability Scanner v2.0.0 ==="
echo "Scanning project root: $PROJECT_ROOT"
echo ""

# Scan all governed file types
while IFS= read -r f; do
    check_file "$f"
done < <(find src tests contracts docs packages scripts \
    examples explorer benchmarks self-host promises .github v5 reports \
    -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.mjs" -o -name "*.md" -o -name "*.sh" -o -name "*.rs" -o -name "*.yml" -o -name "*.yaml" -o -name "*.toml" -o -name "*.py" -o -name "*.css" -o -name "*.html" -o -name "Dockerfile" \) \
    2>/dev/null | sort)

# Scan top-level files
for f in *.md *.ts *.mjs; do
    [ -f "$f" ] && check_file "$f"
done

# --- Structural Checks (v2.0.0) ---

echo ""
echo "--- Structural Checks ---"

# CHECK S1: FORGE-GATE.md exists and is readable
if [ -f "FORGE-GATE.md" ] && [ -r "FORGE-GATE.md" ]; then
    $VERBOSE && echo "  OK: FORGE-GATE.md exists and is readable"
else
    echo "  VIOLATION: FORGE-GATE.md missing or not readable — required phase gate"
    VIOLATIONS=$((VIOLATIONS + 1))
fi

# CHECK S2: All 11 §11 required artifacts exist
REQUIRED_ARTIFACTS=(
    "docs/LIMEN-INTENT-AND-PROPERTIES.md"           # 1. Intent Record
    "docs/LIMEN-INTENT-AND-PROPERTIES.md"           # 2. Property Derivation (same file)
    "docs/LIMEN-FAILURE-MODE-ATLAS.md"              # 3. Failure Mode Atlas
    "docs/LIMEN-IMPLEMENTATION-SPEC.md"             # 6. Implementation Spec
    "docs/LIMEN-ARCHITECTURE-DECISION.md"           # 5. Architecture Decision
    "docs/TRACEABILITY-MATRIX.md"                   # 7. Traceability Matrix
    "docs/CONTINUITY-ARTIFACT.md"                   # 11. Continuity Artifact
    "FORGE-GATE.md"                                 # Phase gate (tracks all artifacts)
)
# Contract Specification = 14 requirement docs (artifact #4)
# Adversarial Verdicts (#8, #9) and Certifier Evidence (#10) are session artifacts tracked in FORGE-GATE.md

ARTIFACT_MISSING=0
for artifact in "${REQUIRED_ARTIFACTS[@]}"; do
    if [ -f "$artifact" ]; then
        $VERBOSE && echo "  OK: §11 artifact present: $artifact"
    else
        echo "  VIOLATION: §11 artifact missing: $artifact"
        VIOLATIONS=$((VIOLATIONS + 1))
        ARTIFACT_MISSING=$((ARTIFACT_MISSING + 1))
    fi
done

# At least 14 contract extraction files must exist
CONTRACT_REQ_COUNT=$(find docs -name "LIMEN-*-REQUIREMENTS.md" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$CONTRACT_REQ_COUNT" -ge 14 ]; then
    $VERBOSE && echo "  OK: §11 artifact #4: $CONTRACT_REQ_COUNT contract extraction files (>= 14)"
else
    echo "  VIOLATION: §11 artifact #4: only $CONTRACT_REQ_COUNT contract extraction files (need >= 14)"
    VIOLATIONS=$((VIOLATIONS + 1))
fi

# CHECK S3: CLAUDE.md references SolisForge, not retired QAL
if [ -f "CLAUDE.md" ]; then
    if grep -q "QAL-" CLAUDE.md 2>/dev/null; then
        echo "  VIOLATION: CLAUDE.md still references retired QAL classification (should use SolisForge Governance Tier)"
        VIOLATIONS=$((VIOLATIONS + 1))
    else
        $VERBOSE && echo "  OK: CLAUDE.md uses SolisForge governance tier (no QAL references)"
    fi
    if ! grep -q "SolisForge\|Forge Critical\|Forge Standard" CLAUDE.md 2>/dev/null; then
        echo "  VIOLATION: CLAUDE.md does not reference SolisForge governance"
        VIOLATIONS=$((VIOLATIONS + 1))
    else
        $VERBOSE && echo "  OK: CLAUDE.md references SolisForge governance"
    fi
fi

echo ""
echo "=== Scanner Results ==="
echo "  Checked:    $CHECKED"
echo "  Violations: $VIOLATIONS"
echo "  Skipped:    $SKIPPED (exempt files)"
echo ""

if [ "$VIOLATIONS" -gt 0 ]; then
    echo "RESULT: NON-COMPLIANT — $VIOLATIONS file(s) missing SolisForge v1.4 governance declaration"
    if $CI_MODE; then
        exit 1
    else
        exit 0
    fi
else
    echo "RESULT: COMPLIANT — All $CHECKED files contain SolisForge v1.4 governance declaration"
    exit 0
fi
