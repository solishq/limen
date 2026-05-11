#!/bin/bash
# @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
# @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1

# Limen v5 Release Pipeline
#
# Produces a locally installable npm package artifact.
# Does NOT publish to public npm — that requires explicit PA approval.
#
# Pipeline stages:
#   1. VALIDATE: SolisForge validator passes
#   2. BUILD: TypeScript compiles with zero errors
#   3. TEST: Full test suite passes (0 failures)
#   4. PACK: npm pack produces .tgz artifact
#   5. VERIFY: Install in clean temp project, run smoke test
#
# Usage: bash scripts/release-pipeline.sh [--version 5.0.0-rc.1]
#
# Output: dist/limen-ai-{version}.tgz (installable via npm install /path/to/file.tgz)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
    VERSION=$(node -e "console.log(require('./package.json').version)")
fi

echo "═══════════════════════════════════════════"
echo " Limen Release Pipeline"
echo " Version: $VERSION"
echo " Standard: Aerospace Precision"
echo "═══════════════════════════════════════════"
echo ""

STAGE=0
FAIL=false

stage() {
    STAGE=$((STAGE + 1))
    echo "▶ Stage $STAGE: $1"
}

pass() {
    echo "  ✓ $1"
}

fail() {
    echo "  ✗ $1"
    FAIL=true
}

# ── Stage 1: VALIDATE ──
stage "SolisForge Validation"

if [ -f "scripts/solisforge-validator.sh" ]; then
    VALIDATOR_OUTPUT=$(bash scripts/solisforge-validator.sh 2>&1)
    P0_COUNT=$(echo "$VALIDATOR_OUTPUT" | grep "P0 (critical):" | awk '{print $NF}' || echo "0")
    P1_COUNT=$(echo "$VALIDATOR_OUTPUT" | grep "P1 (high):" | awk '{print $NF}' || echo "0")
    if [ "$P0_COUNT" != "0" ] || [ "$P1_COUNT" != "0" ]; then
        fail "SolisForge validator: $P0_COUNT P0, $P1_COUNT P1"
        echo "  Run: bash scripts/solisforge-validator.sh --verbose"
        echo ""
        echo "PIPELINE ABORTED at Stage 1."
        exit 1
    else
        pass "SolisForge validator: COMPLIANT"
    fi
else
    fail "SolisForge validator not found"
fi

echo ""

# ── Stage 2: BUILD ──
stage "TypeScript Compilation"

BUILD_OUTPUT=$(npx tsc -p tsconfig.build.json 2>&1)
BUILD_EXIT=$?
if [ "$BUILD_EXIT" -ne 0 ]; then
    ERROR_COUNT=$(echo "$BUILD_OUTPUT" | grep -c "error TS" || echo 0)
    fail "TypeScript compilation: $ERROR_COUNT errors"
    echo "$BUILD_OUTPUT" | grep "error TS" | head -5
    echo ""
    echo "PIPELINE ABORTED at Stage 2."
    exit 1
else
    pass "TypeScript compilation: clean"
fi

echo ""

# ── Stage 3: TEST ──
stage "Full Test Suite"

TEST_OUTPUT=$(npm test 2>&1)
TEST_FAILS=$(echo "$TEST_OUTPUT" | grep "^ℹ fail" | awk '{print $3}')
TEST_PASS=$(echo "$TEST_OUTPUT" | grep "^ℹ pass" | awk '{print $3}')

if [ "$TEST_FAILS" != "0" ] && [ -n "$TEST_FAILS" ]; then
    fail "Test suite: $TEST_FAILS failures"
    echo ""
    echo "PIPELINE ABORTED at Stage 3."
    exit 1
else
    pass "Test suite: $TEST_PASS pass, 0 fail"
fi

echo ""

# ── Stage 4: PACK ──
stage "Package Artifact"

mkdir -p dist

# Ensure version in package.json matches
CURRENT_VERSION=$(node -e "console.log(require('./package.json').version)")
if [ "$CURRENT_VERSION" != "$VERSION" ]; then
    echo "  NOTE: package.json version ($CURRENT_VERSION) ≠ requested ($VERSION)"
    echo "  Using package.json version: $CURRENT_VERSION"
    VERSION="$CURRENT_VERSION"
fi

PACK_OUTPUT=$(npm pack --pack-destination dist 2>&1)
PACK_EXIT=$?
if [ "$PACK_EXIT" -ne 0 ]; then
    fail "npm pack failed: $PACK_OUTPUT"
    echo ""
    echo "PIPELINE ABORTED at Stage 4."
    exit 1
fi

ARTIFACT=$(ls -1 dist/limen-ai-*.tgz 2>/dev/null | tail -1)
if [ -z "$ARTIFACT" ]; then
    fail "No .tgz artifact produced"
    echo ""
    echo "PIPELINE ABORTED at Stage 4."
    exit 1
fi

ARTIFACT_SIZE=$(ls -lh "$ARTIFACT" | awk '{print $5}')
pass "Artifact: $ARTIFACT ($ARTIFACT_SIZE)"

echo ""

# ── Stage 5: VERIFY (install in clean project) ──
stage "Install Verification"

VERIFY_DIR=$(mktemp -d)
cd "$VERIFY_DIR"

# Create minimal test project
cat > package.json << EOF
{
  "name": "limen-verify",
  "version": "1.0.0",
  "type": "module",
  "private": true
}
EOF

# Install from tarball
INSTALL_OUTPUT=$(npm install "$PROJECT_ROOT/$ARTIFACT" 2>&1)
INSTALL_EXIT=$?
if [ "$INSTALL_EXIT" -ne 0 ]; then
    fail "npm install from tarball failed"
    echo "$INSTALL_OUTPUT" | tail -5
    rm -rf "$VERIFY_DIR"
    cd "$PROJECT_ROOT"
    echo ""
    echo "PIPELINE ABORTED at Stage 5."
    exit 1
fi
pass "npm install from tarball: OK"

# Smoke test: createLimen + remember + recall
SMOKE_OUTPUT=$(node -e "
import { createLimen } from 'limen-ai';
const l = await createLimen();
const r = l.remember('entity:verify:release', 'test.smoke', 'release pipeline verification');
if (!r.ok) { console.log('FAIL: remember:', r.error.message); process.exit(1); }
const rc = l.recall('entity:verify:release', 'test.smoke');
if (!rc.ok) { console.log('FAIL: recall:', rc.error.message); process.exit(1); }
if (rc.value[0].value !== 'release pipeline verification') { console.log('FAIL: value mismatch'); process.exit(1); }
const h = l.health();
if (!h.status) { console.log('FAIL: health invalid'); process.exit(1); }
console.log('PASS: createLimen→remember→recall→health all working');
await l.shutdown();
" 2>&1)
SMOKE_EXIT=$?

cd "$PROJECT_ROOT"
rm -rf "$VERIFY_DIR"

if [ "$SMOKE_EXIT" -ne 0 ]; then
    fail "Smoke test failed: $SMOKE_OUTPUT"
    echo ""
    echo "PIPELINE ABORTED at Stage 5."
    exit 1
fi
pass "Smoke test: $SMOKE_OUTPUT"

echo ""

# ── RESULT ──
echo "═══════════════════════════════════════════"
if $FAIL; then
    echo " PIPELINE: FAILED"
    echo " Artifact NOT ready for distribution"
    exit 1
else
    echo " PIPELINE: PASSED"
    echo " Artifact: $ARTIFACT"
    echo ""
    echo " To install locally:"
    echo "   npm install $PROJECT_ROOT/$ARTIFACT"
    echo ""
    echo " To dogfood in a new project:"
    echo "   mkdir my-project && cd my-project"
    echo "   npm init -y"
    echo "   npm install $PROJECT_ROOT/$ARTIFACT"
    echo "   # Then: import { createLimen } from 'limen-ai'"
fi
echo "═══════════════════════════════════════════"
