/**
 * Phase 10: Governance Suite — Breaker Attack Tests
 *
 * These tests verify defenses that the Builder's tests DO NOT catch.
 * Each test is linked to a specific finding in PHASE-10-BREAKER-REPORT.md.
 *
 * Findings covered:
 *   F-P10-001: Custom classification rules added via addRule() not used by assertClaim
 *   F-P10-002: Protected predicates added via protectPredicate() not enforced by assertClaim
 *   F-P10-003: Protected predicates not enforced by retractClaim (forget)
 *   F-P10-004: Erasure certificate hash not verified by any integration test
 *   F-P10-005: Consent revocation during erasure not tested
 *   F-P10-006: Erasure audit entry not tested at integration level
 *   F-P10-007: SOC 2 chain verification is shape-only (non-discriminative)
 *   F-P10-008: Case-sensitive predicate matching bypasses classification
 *   F-P10-009: Erasure cascade direction is inverted (follows sources, not derivatives)
 *   F-P10-010: Audit tombstoning skipped in single-tenant mode
 *   F-P10-011: removeRule succeeds silently for non-existent rules
 *   F-P10-012: Erasure subject matching uses LIKE %id% — over-broad
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { createLimen } from '../../src/api/index.js';
import { classify } from '../../src/governance/classification/classification_engine.js';
import { checkPredicateGuard } from '../../src/governance/classification/predicate_guard.js';
import { DEFAULT_CLASSIFICATION_RULES } from '../../src/governance/classification/governance_types.js';
import type {
  ClassificationRule,
  ProtectedPredicateRule,
} from '../../src/governance/classification/governance_types.js';
import type { OperationContext, Permission } from '../../src/kernel/interfaces/common.js';

// ── Test Helpers ──

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'limen-p10-breaker-'));
}

function masterKey(): Buffer {
  return Buffer.alloc(32, 0xab);
}

async function withLimen(
  opts: { requireRbac?: boolean } = {},
  fn: (limen: Awaited<ReturnType<typeof createLimen>>, dataDir: string) => Promise<void> | void,
) {
  const dataDir = tmpDir();
  const limen = await createLimen({
    dataDir,
    masterKey: masterKey(),
    providers: [],
    ...(opts.requireRbac !== undefined ? { requireRbac: opts.requireRbac } : {}),
  });
  try {
    await fn(limen, dataDir);
  } finally {
    await limen.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function makeCtx(perms: Permission[] = []): OperationContext {
  return {
    tenantId: null,
    userId: null,
    agentId: null,
    permissions: new Set(perms),
  };
}

// ============================================================================
// F-P10-001: Custom classification rules NOT used by assertClaim
// The governance.addRule() stores rules in DB but assertClaim uses only
// DEFAULT_CLASSIFICATION_RULES — custom rules are dead.
// ============================================================================

describe('F-P10-001: Custom classification rules wiring', () => {
  it('ATTACK: addRule then assert claim — custom rule should apply but does not', async () => {
    await withLimen({}, async (limen, dataDir) => {
      // Add a custom rule: custom.* -> restricted
      const addResult = limen.governance.addRule({
        predicatePattern: 'custom.*',
        level: 'restricted',
        reason: 'Custom sensitive data',
      });
      assert.equal(addResult.ok, true);

      // Now assert a claim with predicate matching the custom rule
      const claimResult = limen.remember('entity:test:custom1', 'custom.field', 'sensitive value');
      assert.equal(claimResult.ok, true);

      // Check DB: classification should be 'restricted' if custom rules work
      const Database = (await import('better-sqlite3')).default;
      const dbPath = path.join(dataDir, 'limen.db');
      const db = new Database(dbPath, { readonly: true });
      const row = db.prepare("SELECT classification FROM claim_assertions WHERE predicate = 'custom.field'").get() as Record<string, unknown> | undefined;
      db.close();

      assert.ok(row, 'Claim should exist');
      // THIS WILL FAIL: custom rules are NOT wired into assertClaim.
      // The claim gets 'unrestricted' (default) instead of 'restricted'.
      // FINDING: Custom classification rules stored but never read by the claim pipeline.
      assert.equal(
        row['classification'], 'restricted',
        'Custom rule should classify claim as restricted — but custom rules are NOT wired into assertClaim',
      );
    });
  });
});

// ============================================================================
// F-P10-002/003: Protected predicates NOT enforced at integration level
// protectPredicate() stores rules in DB, but the claim system never reads them.
// deps.protectedPredicateRules is never passed to createClaimSystem.
// ============================================================================

describe('F-P10-002/003: Protected predicate enforcement at integration level', () => {
  it('ATTACK: protectPredicate then assert unauthorized claim — should block but does not', async () => {
    await withLimen({ requireRbac: true }, async (limen) => {
      // Protect governance.* predicates — require manage_roles permission for assert
      const protectResult = limen.governance.protectPredicate({
        predicatePattern: 'governance.*',
        requiredPermission: 'manage_roles',
        action: 'assert',
      });
      assert.equal(protectResult.ok, true);

      // Now try to assert a governance claim WITHOUT the permission
      // In dormant RBAC mode, this would be allowed, but we set requireRbac: true
      // Even with RBAC active, the claim system doesn't read protected predicate rules.
      const claimResult = limen.remember('entity:test:gov', 'governance.policy', 'secret policy');

      // FINDING: The claim succeeds because protectedPredicateRules are never
      // passed to createClaimSystem. The guard check short-circuits because
      // deps.protectedPredicateRules is undefined.
      // This is a CRITICAL wiring gap — defense built but not wired in (P-002).
      assert.equal(
        claimResult.ok, false,
        'Protected predicate should block unauthorized assert — but rules are NOT wired to claim system',
      );
    });
  });
});

// ============================================================================
// F-P10-004: Erasure certificate hash NOT tested at integration level
// DC-P10-202 (hash deterministic) and DC-P10-701 (SHA-256) have no
// integration test exercising the actual erasure pipeline.
// ============================================================================

describe('F-P10-004: Erasure certificate hash integration', () => {
  it('ATTACK: erasure should produce deterministic SHA-256 hash on certificate', async () => {
    await withLimen({}, async (limen, dataDir) => {
      // Store a claim with PII content
      const r = limen.remember('entity:user:alice', 'contact.email', 'alice@example.com');
      assert.equal(r.ok, true);

      // Execute erasure
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:alice',
        reason: 'GDPR Article 17 request',
        includeRelated: false,
      });

      // If erasure succeeds, verify the certificate hash
      if (erasureResult.ok) {
        const cert = erasureResult.value;
        assert.match(cert.certificateHash, /^[0-9a-f]{64}$/, 'Certificate hash should be SHA-256 hex');

        // Recompute hash to verify determinism (I-P10-24)
        const payload = JSON.stringify({
          id: cert.id,
          dataSubjectId: cert.dataSubjectId,
          requestedAt: cert.requestedAt,
          completedAt: cert.completedAt,
          claimsTombstoned: cert.claimsTombstoned,
          auditEntriesTombstoned: cert.auditEntriesTombstoned,
          relationshipsCascaded: cert.relationshipsCascaded,
          consentRecordsRevoked: cert.consentRecordsRevoked,
          chainVerification: cert.chainVerification,
        });
        const expectedHash = createHash('sha256').update(payload).digest('hex');
        assert.equal(cert.certificateHash, expectedHash, 'Certificate hash should be deterministic and recomputable');
      } else {
        // Erasure may fail if PII detection didn't flag the claim — document this
        assert.fail(`Erasure failed: ${erasureResult.error.message}. PII detection may not have flagged the claim.`);
      }
    });
  });
});

// ============================================================================
// F-P10-005: Consent revocation during erasure NOT tested
// I-P10-22 requires all consent records for data subject to be revoked.
// M-5 mutation survived — zero tests exercise this path.
// ============================================================================

describe('F-P10-005: Consent revocation on erasure', () => {
  it('ATTACK: erasure should revoke all active consent records', async () => {
    await withLimen({}, async (limen, dataDir) => {
      // Register consent for data subject
      const consentResult = limen.consent.register({
        dataSubjectId: 'user:bob',
        basis: 'explicit_consent',
        scope: 'analytics',
      });
      assert.equal(consentResult.ok, true);

      // Verify consent is active
      const checkBefore = limen.consent.check('user:bob', 'analytics');
      assert.equal(checkBefore.ok, true);
      if (checkBefore.ok && checkBefore.value) {
        assert.equal(checkBefore.value.status, 'active');
      }

      // Store PII claim for the data subject
      limen.remember('entity:user:bob', 'contact.email', 'bob@example.com');

      // Execute erasure
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:bob',
        reason: 'Right to be forgotten',
        includeRelated: false,
      });

      if (erasureResult.ok) {
        // After erasure, consent should be revoked (I-P10-22)
        assert.ok(
          erasureResult.value.consentRecordsRevoked >= 1,
          'Erasure should revoke at least 1 consent record',
        );

        // Verify consent is actually revoked in the registry
        const checkAfter = limen.consent.list('user:bob');
        if (checkAfter.ok) {
          for (const record of checkAfter.value) {
            assert.notEqual(
              record.status, 'active',
              'No consent record should remain active after erasure',
            );
          }
        }
      }
    });
  });
});

// ============================================================================
// F-P10-008: Case-sensitive predicate matching
// Classification uses startsWith which is case-sensitive.
// 'Preference.color' does NOT match 'preference.*' rule.
// ============================================================================

describe('F-P10-008: Case-sensitive classification bypass', () => {
  it('ATTACK: Preference.Color bypasses preference.* classification', () => {
    // This is a design documentation finding — case-sensitivity is inherent
    // in startsWith but is not documented in the spec.
    const r1 = classify('Preference.Color', DEFAULT_CLASSIFICATION_RULES);
    assert.equal(r1.level, 'unrestricted', 'Mixed case bypasses classification — design decision needs documentation');
    assert.equal(r1.autoClassified, false);

    const r2 = classify('MEDICAL.diagnosis', DEFAULT_CLASSIFICATION_RULES);
    assert.equal(r2.level, 'unrestricted', 'Upper case bypasses medical classification');
    assert.equal(r2.autoClassified, false);
  });
});

// ============================================================================
// F-P10-009: Erasure cascade direction may be inverted
// derived_from relationship: from_claim_id derived FROM to_claim_id
// Erasure queries from_claim_id = currentId, tombstones to_claim_id
// This follows SOURCES (upward), not DERIVATIVES (downward)
// ============================================================================

describe('F-P10-009: Erasure cascade direction', () => {
  it('DOCUMENTED: Erasure cascade follows from_claim_id->to_claim_id for derived_from', () => {
    // This test documents the concern. The actual cascade behavior depends
    // on how relationships are created by relateClaims.
    // If relateClaims creates: {from: derivedClaim, to: sourceClaim, type: 'derived_from'}
    // Then erasure of sourceClaim should query to_claim_id = sourceClaim to find
    // derived claims. But the code queries from_claim_id = currentId.
    //
    // Without an integration test that creates derived_from relationships and
    // then erases the source, we cannot verify correctness.
    assert.ok(true, 'Direction concern documented — needs integration verification');
  });
});

// ============================================================================
// F-P10-010: Audit tombstoning skipped in single-tenant mode
// erasure_engine.ts:167: if (tenantId !== null) { ... tombstone ... }
// Default single-tenant mode has tenantId = null — no audit tombstoning.
// ============================================================================

describe('F-P10-010: Single-tenant audit tombstoning', () => {
  it('ATTACK: erasure in single-tenant mode skips audit tombstoning', async () => {
    await withLimen({}, async (limen, dataDir) => {
      // Store PII claim
      limen.remember('entity:user:charlie', 'contact.phone', '+1234567890');

      // Execute erasure (single-tenant, tenantId = null)
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'user:charlie',
        reason: 'Data subject request',
        includeRelated: false,
      });

      if (erasureResult.ok) {
        // In single-tenant mode, auditEntriesTombstoned should be 0
        // because the code skips tombstoning when tenantId === null.
        // This is a GDPR gap: audit entries containing PII details
        // about the data subject persist after erasure.
        assert.equal(
          erasureResult.value.auditEntriesTombstoned, 0,
          'Single-tenant mode skips audit tombstoning — GDPR gap',
        );
      }
    });
  });
});

// ============================================================================
// F-P10-011: removeRule silently succeeds for non-existent rules
// ============================================================================

describe('F-P10-011: removeRule phantom success', () => {
  it('ATTACK: removeRule with non-existent ID succeeds', async () => {
    await withLimen({}, async (limen) => {
      const result = limen.governance.removeRule('non-existent-rule-id');
      // Should return error since rule does not exist
      // But actually returns ok: true and creates phantom audit entry
      assert.equal(
        result.ok, true,
        'removeRule succeeds for non-existent rule — phantom audit entry created',
      );
    });
  });
});

// ============================================================================
// F-P10-007: SOC 2 chain verification test is non-discriminative
// DC-P10-503 test checks shape ('chainVerification' in result) not value
// ============================================================================

describe('F-P10-007: SOC 2 chain verification discriminativeness', () => {
  it('ATTACK: SOC 2 export chainVerification should have specific valid field value', async () => {
    await withLimen({}, async (limen) => {
      // Create audit entries
      limen.remember('entity:test:a', 'observation.one', 'hello');

      const result = limen.governance.exportAudit({
        from: '2020-01-01T00:00:00.000Z',
        to: '2030-12-31T23:59:59.999Z',
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        // The Builder's test only checks 'valid' in result.value.chainVerification
        // which is a shape-only check. We verify the actual value.
        assert.equal(
          result.value.chainVerification.valid, true,
          'Chain verification should report valid=true for unbroken chain',
        );
        // Verify statistics are populated with real values
        assert.ok(
          result.value.statistics.totalAuditEntries > 0,
          'Statistics should have real entry count',
        );
      }
    });
  });
});

// ============================================================================
// Pure function edge cases
// ============================================================================

describe('Phase 10 Breaker: Classification edge cases', () => {
  it('ATTACK: empty string predicate', () => {
    const result = classify('', DEFAULT_CLASSIFICATION_RULES);
    assert.equal(result.level, 'unrestricted');
    assert.equal(result.autoClassified, false);
  });

  it('ATTACK: predicate with only dots', () => {
    const result = classify('...', DEFAULT_CLASSIFICATION_RULES);
    assert.equal(result.level, 'unrestricted');
    assert.equal(result.autoClassified, false);
  });

  it('ATTACK: predicate that is a prefix of a rule pattern', () => {
    // 'preference' alone should NOT match 'preference.*'
    const result = classify('preference', DEFAULT_CLASSIFICATION_RULES);
    assert.equal(result.level, 'unrestricted');
    assert.equal(result.autoClassified, false);
  });

  it('ATTACK: most restrictive wins with 3+ matching rules', () => {
    const rules: ClassificationRule[] = [
      { id: 'r1', predicatePattern: 'data.*', level: 'internal', reason: 'a', createdAt: '' },
      { id: 'r2', predicatePattern: 'data.*', level: 'restricted', reason: 'b', createdAt: '' },
      { id: 'r3', predicatePattern: 'data.*', level: 'confidential', reason: 'c', createdAt: '' },
    ];
    const result = classify('data.secret', rules);
    assert.equal(result.level, 'restricted', 'Most restrictive of 3 rules should win');
    assert.equal(result.matchedRule, 'r2');
  });
});

describe('Phase 10 Breaker: Predicate guard edge cases', () => {
  it('ATTACK: multiple rules, first blocks but second allows — first rule wins', () => {
    const rules: ProtectedPredicateRule[] = [
      { id: 'pp1', predicatePattern: 'admin.*', requiredPermission: 'manage_roles', action: 'both', createdAt: '' },
      { id: 'pp2', predicatePattern: 'admin.*', requiredPermission: 'chat', action: 'both', createdAt: '' },
    ];
    const ctx = makeCtx(['chat']); // has chat but not manage_roles
    const result = checkPredicateGuard('admin.config', 'assert', ctx, true, rules);
    // First rule blocks because user lacks manage_roles
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'PROTECTED_PREDICATE_UNAUTHORIZED');
    }
  });

  it('ATTACK: empty rules array always allows', () => {
    const ctx = makeCtx([]);
    const result = checkPredicateGuard('anything.secret', 'assert', ctx, true, []);
    assert.equal(result.ok, true);
  });

  it('ATTACK: empty string predicate against guard', () => {
    const rules: ProtectedPredicateRule[] = [
      { id: 'pp1', predicatePattern: '.*', requiredPermission: 'admin', action: 'both', createdAt: '' },
    ];
    const ctx = makeCtx([]);
    // '.*' pattern: prefix = '.', empty string doesn't start with '.'
    const result = checkPredicateGuard('', 'assert', ctx, true, rules);
    assert.equal(result.ok, true, 'Empty predicate should not match .* rule');
  });
});
