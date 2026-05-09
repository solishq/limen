#!/bin/bash
# R2-11: Verify contract manifest SHA-256 hashes.
# Reads contracts/phase-x.contracts.json and verifies each listed contract
# file's SHA-256 hash matches the recorded value. Exits 1 on any mismatch.
#
# Usage: bash scripts/verify-contract-hashes.sh
# CI: Add to pre-merge checks to enforce HB-38 (interface/hash binding).

set -euo pipefail

cd "$(dirname "$0")/.."

MANIFEST="contracts/phase-x.contracts.json"

if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: Manifest not found: $MANIFEST"
  exit 1
fi

node -e "
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(fs.readFileSync('$MANIFEST', 'utf-8'));
const contracts = manifest.contracts || [];

let ok = 0;
let fail = 0;
let missing = 0;

for (const entry of contracts) {
  const filePath = entry.path;
  if (!fs.existsSync(filePath)) {
    console.log('MISSING: ' + filePath);
    missing++;
    fail++;
    continue;
  }
  const content = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  if (hash === entry.sha256) {
    ok++;
  } else {
    console.log('MISMATCH: ' + filePath);
    console.log('  expected: ' + entry.sha256);
    console.log('  actual:   ' + hash);
    fail++;
  }
}

console.log('');
console.log(ok + ' OK, ' + fail + ' FAILED' + (missing > 0 ? ' (' + missing + ' missing)' : ''));
process.exit(fail > 0 ? 1 : 0);
"
