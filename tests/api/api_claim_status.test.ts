// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * F-BR5-002: Engine-level tests for ClaimApi.getClaimStatus.
 *
 * Phase: CLI Friction Remediation — Loopback Round 2 (F-BR5 sweep)
 * Tier: 2 (consumer API surface)
 *
 * Defect Classes covered:
 *   DC-GCS-001: permission enforcement (authority/governance — Cat 4)
 *   DC-GCS-002: tenant isolation / cross-tenant existence leak (data integrity — Cat 1)
 *   DC-GCS-003: status value mapping for active/retracted/not_found
 *
 * Amendment 21 / HB #24 compliance:
 *   For every DC, BOTH success and rejection tests exist. Silence on a
 *   defect class is prohibited. The loopback commit f4b08eb added
 *   ClaimApi.getClaimStatus without engine-layer coverage — Breaker
 *   finding F-BR5-002 classified this as a Major defect. This file
 *   closes the gap.
 *
 * Test shape: Exercises the RawClaimFacade directly with a mock
 * ClaimSystem, following the same pattern used by
 * tests/contract/test_phase4_governance_wiring.test.ts for assertClaim
 * RBAC testing. The facade is the authorization boundary — the
 * ClaimApiImpl wrapper is a thin passthrough, so facade-layer tests
 * exercise the invariants at the correct place.
 *
 * Cross-tenant test rationale: ClaimStore.get returns CLAIM_NOT_FOUND
 * when a caller in tenant A queries a claim owned by tenant B (see
 * claim_types.ts:967 "CROSS_TENANT removed: tenant-scoped queries
 * return CLAIM_NOT_FOUND"). getClaimStatus maps CLAIM_NOT_FOUND to
 * 'not_found' at claim_facade.ts:174-176, so a cross-tenant probe
 * returns 'not_found' — indistinguishable from "no such claim in any
 * tenant." That is the intended existence-leak prevention invariant.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createRawClaimFacade } from '../../src/api/facades/claim_facade.js';
import type {
  ClaimSystem,
  Claim,
  ClaimId,
} from '../../src/claims/interfaces/claim_types.js';
import type {
  DatabaseConnection,
  OperationContext,
  Result,
  Permission,
  TenantId,
} from '../../src/kernel/interfaces/index.js';
import type { RbacEngine } from '../../src/kernel/interfaces/rbac.js';
import type { RateLimiter, BucketType } from '../../src/kernel/interfaces/rate_limiter.js';

// ─── Test helpers ────────────────────────────────────────────────────────────

/** A permissive RBAC mock that grants the named permissions. */
function rbacWithPerms(granted: Permission[]): RbacEngine {
  const set = new Set<Permission>(granted);
  return {
    checkPermission(_ctx: OperationContext, required: Permission): Result<boolean> {
      if (set.has(required)) return { ok: true, value: true };
      return { ok: true, value: false };
    },
    isActive(): boolean {
      return true;
    },
    assignRole() { return { ok: true, value: undefined }; },
    revokeRole() { return { ok: true, value: undefined }; },
    getRoles() { return { ok: true, value: [] }; },
  } as unknown as RbacEngine;
}

/** Rate limiter that always allows — we are not testing rate limits here. */
function permissiveRateLimiter(): RateLimiter {
  return {
    checkAndConsume(_c: DatabaseConnection, _ctx: OperationContext, _b: BucketType): Result<boolean> {
      return { ok: true, value: true };
    },
    getStatus(_c: DatabaseConnection, _ctx: OperationContext, _b: BucketType) {
      return { ok: true as const, value: { refillRate: 100, maxTokens: 100, currentTokens: 100, lastRefillAt: new Date().toISOString() } };
    },
  } as RateLimiter;
}

/** Build an OperationContext with a specific tenant and permissions. */
function ctxFor(tenantIdStr: string | null, perms: Permission[]): OperationContext {
  return {
    tenantId: (tenantIdStr === null ? null : tenantIdStr) as TenantId | null,
    userId: 'user-test' as any,
    agentId: null,
    permissions: new Set<Permission>(perms),
  };
}

/**
 * Build a minimal Claim record with the requested status and tenant.
 * Only `.status` is read by getClaimStatus (see claim_facade.ts:179);
 * the other fields are present to satisfy the Claim interface shape,
 * not to drive behaviour.
 */
function makeClaim(id: string, tenantIdStr: string | null, status: 'active' | 'retracted'): Claim {
  return {
    id: id as ClaimId,
    tenantId: (tenantIdStr === null ? null : tenantIdStr) as TenantId | null,
    subject: 'entity:test:alpha',
    predicate: 'test.status',
    object: { type: 'string' as const, value: 'stub' },
    confidence: 1.0,
    validAt: '2026-04-11T00:00:00Z',
    sourceAgentId: 'agent-test' as any,
    sourceMissionId: 'mission-test' as any,
    sourceTaskId: null,
    groundingMode: 'runtime_witness',
    runtimeWitness: null,
    status,
    archived: false,
    createdAt: '2026-04-11T00:00:00Z',
    lastAccessedAt: null,
    accessCount: 0,
    stability: 7,
    reasoning: null,
  } as Claim;
}

/**
 * Build a ClaimSystem mock whose `store.get` returns the provided map
 * of (claimId -> {claim, tenantId}) entries, enforcing tenant scope the
 * same way the real ClaimStore does: if the caller's tenantId does not
 * match the stored tenantId, CLAIM_NOT_FOUND (no existence leak).
 */
function mockClaimSystem(
  fixtures: Map<string, { status: 'active' | 'retracted'; tenantId: string | null }>,
  onGetError?: () => { code: string; message: string } | null,
): ClaimSystem {
  return {
    store: {
      get(_conn: DatabaseConnection, claimId: ClaimId, callerTenantId: TenantId | null): Result<Claim> {
        if (onGetError) {
          const e = onGetError();
          if (e) return { ok: false, error: { ...e, spec: '§14.1' } as any };
        }
        const fx = fixtures.get(claimId as string);
        if (!fx) {
          return { ok: false, error: { code: 'CLAIM_NOT_FOUND', message: `Claim ${claimId} not found`, spec: '§14.1' } as any };
        }
        // Tenant scoping: the real store filters by tenant_id. A caller
        // in a different tenant sees CLAIM_NOT_FOUND (claim_types.ts:967).
        if (fx.tenantId !== (callerTenantId as string | null)) {
          return { ok: false, error: { code: 'CLAIM_NOT_FOUND', message: `Claim ${claimId} not found`, spec: '§14.1' } as any };
        }
        return { ok: true, value: makeClaim(claimId as string, fx.tenantId, fx.status) };
      },
    },
  } as unknown as ClaimSystem;
}

const stubConn = {} as DatabaseConnection;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('F-BR5-002: ClaimApi.getClaimStatus engine coverage', () => {
  describe('DC-GCS-001: permission enforcement', () => {
    it('[SUCCESS] getClaimStatus returns active for an active tenant-scoped claim', () => {
      const fixtures = new Map([['claim-active-1', { status: 'active' as const, tenantId: 'tenant-a' }]]);
      const facade = createRawClaimFacade(
        mockClaimSystem(fixtures),
        rbacWithPerms(['query_claims']),
        permissiveRateLimiter(),
      );
      const result = facade.getClaimStatus(stubConn, ctxFor('tenant-a', ['query_claims']), 'claim-active-1');
      assert.equal(result.ok, true, 'must succeed when permission is present');
      if (!result.ok) return;
      assert.equal(result.value, 'active', 'active claim must report active');
    });

    it('[REJECTION] getClaimStatus throws UNAUTHORIZED without query_claims permission', () => {
      // The inner store MUST NOT be reached when RBAC denies — if it
      // were, this test would reveal it because the store throws.
      let storeReached = false;
      const claimSystem = {
        store: {
          get(): Result<Claim> {
            storeReached = true;
            throw new Error('store.get should not be reached when RBAC denies');
          },
        },
      } as unknown as ClaimSystem;

      const facade = createRawClaimFacade(
        claimSystem,
        rbacWithPerms([]), // NO query_claims
        permissiveRateLimiter(),
      );

      assert.throws(
        () => facade.getClaimStatus(stubConn, ctxFor('tenant-a', []), 'claim-whatever'),
        (err: Error & { code?: string }) => err.code === 'UNAUTHORIZED',
        'must throw UNAUTHORIZED when query_claims is missing',
      );
      assert.equal(storeReached, false, 'store.get must NOT be reached when RBAC denies (fail-closed)');
    });
  });

  describe('DC-GCS-002: tenant isolation (cross-tenant existence leak prevention)', () => {
    it('[REJECTION] getClaimStatus returns not_found for a claim owned by a different tenant', () => {
      // Claim exists under tenant-b. Caller is in tenant-a with query_claims.
      // Must NOT leak existence: must return 'not_found', not 'active'.
      const fixtures = new Map([['claim-tenant-b', { status: 'active' as const, tenantId: 'tenant-b' }]]);
      const facade = createRawClaimFacade(
        mockClaimSystem(fixtures),
        rbacWithPerms(['query_claims']),
        permissiveRateLimiter(),
      );
      const result = facade.getClaimStatus(stubConn, ctxFor('tenant-a', ['query_claims']), 'claim-tenant-b');
      assert.equal(result.ok, true, 'cross-tenant probe must produce ok result (no error leak)');
      if (!result.ok) return;
      assert.equal(result.value, 'not_found',
        'cross-tenant probe MUST return not_found — any other value leaks claim existence across tenants');
    });

    it('[SUCCESS] getClaimStatus returns active for same-tenant claim', () => {
      // Control for the cross-tenant test: same caller, same id, but now
      // in the correct tenant. Proves the rejection above is driven by
      // tenant scoping, not a broken fixture.
      const fixtures = new Map([['claim-tenant-b', { status: 'active' as const, tenantId: 'tenant-b' }]]);
      const facade = createRawClaimFacade(
        mockClaimSystem(fixtures),
        rbacWithPerms(['query_claims']),
        permissiveRateLimiter(),
      );
      const result = facade.getClaimStatus(stubConn, ctxFor('tenant-b', ['query_claims']), 'claim-tenant-b');
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value, 'active',
        'same-tenant caller must see the claim as active (control for cross-tenant rejection)');
    });
  });

  describe('DC-GCS-003: status value mapping (active / retracted / not_found)', () => {
    let fixtures: Map<string, { status: 'active' | 'retracted'; tenantId: string | null }>;

    beforeEach(() => {
      fixtures = new Map<string, { status: 'active' | 'retracted'; tenantId: string | null }>([
        ['claim-active', { status: 'active', tenantId: 'tenant-a' }],
        ['claim-retracted', { status: 'retracted', tenantId: 'tenant-a' }],
      ]);
    });

    it('[SUCCESS] active claim maps to "active"', () => {
      const facade = createRawClaimFacade(
        mockClaimSystem(fixtures),
        rbacWithPerms(['query_claims']),
        permissiveRateLimiter(),
      );
      const r = facade.getClaimStatus(stubConn, ctxFor('tenant-a', ['query_claims']), 'claim-active');
      assert.equal(r.ok, true);
      if (!r.ok) return;
      assert.equal(r.value, 'active');
    });

    it('[SUCCESS] retracted claim maps to "retracted" (rejection-path — caller must distinguish from not_found)', () => {
      // This is the critical rejection-path discriminator: the CLI
      // dispute-projection loop clears `disputed` only when ALL
      // counterparts are non-active. Both 'retracted' and 'not_found'
      // satisfy that, but conflating them at the engine layer would
      // prevent consumers from distinguishing "I retracted the
      // claim" from "the claim never existed / was purged." The facade
      // preserves the distinction.
      const facade = createRawClaimFacade(
        mockClaimSystem(fixtures),
        rbacWithPerms(['query_claims']),
        permissiveRateLimiter(),
      );
      const r = facade.getClaimStatus(stubConn, ctxFor('tenant-a', ['query_claims']), 'claim-retracted');
      assert.equal(r.ok, true);
      if (!r.ok) return;
      assert.equal(r.value, 'retracted',
        'retracted claim MUST report "retracted" — conflation with "not_found" would destroy semantic signal for audit consumers');
    });

    it('[SUCCESS] unknown claim id maps to "not_found" via CLAIM_NOT_FOUND translation', () => {
      const facade = createRawClaimFacade(
        mockClaimSystem(fixtures),
        rbacWithPerms(['query_claims']),
        permissiveRateLimiter(),
      );
      const r = facade.getClaimStatus(stubConn, ctxFor('tenant-a', ['query_claims']), 'claim-never-existed');
      assert.equal(r.ok, true, 'CLAIM_NOT_FOUND must be translated to ok:true value:not_found, not propagated as an error');
      if (!r.ok) return;
      assert.equal(r.value, 'not_found');
    });

    it('[REJECTION] non-CLAIM_NOT_FOUND errors from the store propagate as ok:false', () => {
      // Distinguisher: not every store error should collapse to 'not_found'.
      // A transient DB error must surface so callers can distinguish
      // "I verified the claim is gone" from "I could not verify anything."
      // This is the invariant F-BR5-005 relies on at the CLI layer.
      const facade = createRawClaimFacade(
        mockClaimSystem(
          new Map(),
          () => ({ code: 'DATABASE_ERROR', message: 'simulated transient' }),
        ),
        rbacWithPerms(['query_claims']),
        permissiveRateLimiter(),
      );
      const r = facade.getClaimStatus(stubConn, ctxFor('tenant-a', ['query_claims']), 'claim-whatever');
      assert.equal(r.ok, false,
        'transient store errors MUST propagate as ok:false — collapsing to not_found would erase dispute observability (F-BR5-005 invariant)');
      if (r.ok) return;
      assert.equal(r.error.code, 'DATABASE_ERROR',
        'original error code must be preserved for consumer-side warning emission');
    });
  });
});
