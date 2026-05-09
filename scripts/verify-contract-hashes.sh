#!/bin/bash
# @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
# @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
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

// Phase 2: Verify Master Index entries (meta-level hash integrity)
const miPath = 'MASTER-INDEX-v2.1-FINAL.md';
if (fs.existsSync(miPath)) {
  const miContent = fs.readFileSync(miPath, 'utf-8');
  // Extract all path-hash pairs from Master Index table rows
  const miPattern = /\| \x60([^\x60]+)\x60 \|[^|]*\|[^|]*\|[^|]*\| \x60([a-f0-9]{64})\x60 \|/g;
  let match;
  let miChecked = 0;
  while ((match = miPattern.exec(miContent)) !== null) {
    const miFile = match[1];
    const miHash = match[2];
    if (!fs.existsSync(miFile)) continue;
    const actual = crypto.createHash('sha256').update(fs.readFileSync(miFile)).digest('hex');
    miChecked++;
    if (actual === miHash) {
      ok++;
    } else {
      console.log('MI-MISMATCH: ' + miFile);
      console.log('  MI expected: ' + miHash);
      console.log('  actual:      ' + actual);
      fail++;
    }
  }
  console.log('Master Index: ' + miChecked + ' entries verified');
}

console.log('');
console.log(ok + ' OK, ' + fail + ' FAILED' + (missing > 0 ? ' (' + missing + ' missing)' : ''));
process.exit(fail > 0 ? 1 : 0);
"
