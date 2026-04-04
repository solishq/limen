/**
 * Phase 4 Quality & Safety: Conflict Detection Tests.
 * Tests the structural conflict detection module.
 *
 * DC-P4-101, DC-P4-102, DC-P4-804: Conflict detection correctness.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectStructuralConflicts,
  DEFAULT_AUTO_CONFLICT_THRESHOLD,
} from '../../src/cognitive/conflict.js';

// ============================================================================
// Conflict Detection Constants
// ============================================================================

describe('Phase 4: Conflict detection constants', () => {
  it('DC-P4-804 success: default auto-conflict threshold is 0.8 (I-P4-08)', () => {
    assert.strictEqual(DEFAULT_AUTO_CONFLICT_THRESHOLD, 0.8);
  });
});

// ============================================================================
// Structural Conflict Detection (Mock Database)
// ============================================================================

import type { TenantScopedConnection } from '../../src/kernel/tenant/tenant_scope.js';

function createMockConn(conflicts: Array<{ id: string }>): TenantScopedConnection {
  const conn = {
    dataDir: '/tmp/test',
    schemaVersion: 40,
    tenancyMode: 'single' as const,
    tenantId: null,
    transaction: <T>(fn: () => T): T => fn(),
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    close: () => ({ ok: true as const, value: undefined }),
    query: <T>(_sql: string, _params?: unknown[]): T[] => {
      return conflicts as T[];
    },
    get: <T>(): T | undefined => undefined,
  };
  return { ...conn, raw: conn } as TenantScopedConnection;
}

describe('Phase 4: detectStructuralConflicts (DC-P4-101, DC-P4-102)', () => {
  it('DC-P4-101 success: detects conflicting claims with different value', () => {
    const conn = createMockConn([{ id: 'existing-1' }, { id: 'existing-2' }]);
    const result = detectStructuralConflicts(
      conn, 'new-claim', 'entity:test:1', 'test.value', '"old-value"',
    );
    assert.strictEqual(result.conflictingClaimIds.length, 2);
    assert.deepStrictEqual(result.conflictingClaimIds, ['existing-1', 'existing-2']);
  });

  it('DC-P4-102 success: no conflicts when no matching claims', () => {
    const conn = createMockConn([]);
    const result = detectStructuralConflicts(
      conn, 'new-claim', 'entity:test:1', 'test.value', '"some-value"',
    );
    assert.strictEqual(result.conflictingClaimIds.length, 0);
  });

  it('DC-P4-804 success: conflict detection fires for all structural conflicts regardless of confidence', () => {
    // The 0.8 threshold is for review severity, not relationship creation
    // All structural conflicts create relationships per Design Source Decision 3
    const conn = createMockConn([{ id: 'low-conf-claim' }]);
    const result = detectStructuralConflicts(
      conn, 'new-claim', 'entity:test:1', 'test.value', '"new-value"',
    );
    assert.strictEqual(result.conflictingClaimIds.length, 1);
  });
});
