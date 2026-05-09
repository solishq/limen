#!/bin/bash
# @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
# @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §6.1

# SolisForge Traceability Scanner v1.0.0
# Validates every governed file contains the SolisForge v1.4 governance declaration.
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
        .gitignore|.nvmrc|.env*|.dockerignore|LICENSE|NOTICE|.provenance.json)
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

echo "=== SolisForge Traceability Scanner v1.0.0 ==="
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
