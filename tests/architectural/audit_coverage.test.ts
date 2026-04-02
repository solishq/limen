/**
 * Phase 9: Audit Coverage Architectural Test
 *
 * DC: DC-P9-501, DC-P9-502, I-P9-40
 *
 * Verifies that key implementation files call audit.append() or
 * auditTrail.append() within their execution paths. Grep-based
 * architectural test that reads source files.
 *
 * Note: Not all system calls have DIRECT audit.append() — some delegate
 * through facade layers. This test checks the store-level implementations
 * where audit calls are directly invoked.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC_ROOT = path.resolve(import.meta.dirname ?? '.', '../../src');

/**
 * Check that a source file contains audit.append or auditTrail.append calls.
 */
function fileContainsAuditCall(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf-8');
  return /(?:audit|auditTrail)\.append\s*\(/g.test(content);
}

describe('Phase 9: Audit Coverage (I-P9-40)', () => {
  // Verify claim store (SC-11, SC-12) has audit coverage
  it('claim_stores.ts contains audit.append calls', () => {
    const filePath = path.join(SRC_ROOT, 'claims/store/claim_stores.ts');
    assert.ok(
      fileContainsAuditCall(filePath),
      'claim_stores.ts must contain audit.append() for assertClaim/retractClaim',
    );
  });

  // Verify consent registry (Phase 9 additions) has audit coverage
  it('consent_registry.ts contains audit.append calls', () => {
    const filePath = path.join(SRC_ROOT, 'security/consent_registry.ts');
    assert.ok(
      fileContainsAuditCall(filePath),
      'consent_registry.ts must contain audit.append() for consent register/revoke (I-P9-23)',
    );
  });

  // Verify execution governance has audit coverage
  it('egp_stores.ts contains audit calls', () => {
    const filePath = path.join(SRC_ROOT, 'execution/stores/egp_stores.ts');
    assert.ok(
      fileContainsAuditCall(filePath),
      'egp_stores.ts must contain audit calls',
    );
  });
});
