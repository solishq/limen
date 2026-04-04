/**
 * Permission Gateway -- structural RBAC enforcement for every public API method.
 *
 * v2.1.0 Phase 2: Remediation of audit finding that Phases 8-12 APIs had no RBAC.
 *
 * Design principle: every public method maps to a declared permission in a central
 * registry. No mapping = method is unreachable (the gateway throws INVALID_INPUT
 * at development time if a method is called without a registered permission).
 *
 * The PERMISSION_MAP is the single source of truth for authorization policy.
 * Individual facades/APIs no longer need their own requirePermission calls --
 * the gateway handles enforcement structurally.
 *
 * S ref: section 34 (RBAC), I-13 (authorization completeness), FPD-5 (RBAC before rate limit)
 * QAL: 4 (RBAC engine -- failure = privilege escalation)
 *
 * Invariants enforced: I-13, I-17
 * Failure modes defended: FM-10 (tenant data leakage via unauthorized access)
 */

import type { Permission, OperationContext } from '../../kernel/interfaces/common.js';
import type { RbacEngine } from '../../kernel/interfaces/rbac.js';
import type { RateLimiter, BucketType } from '../../kernel/interfaces/rate_limiter.js';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import { requirePermission } from '../enforcement/rbac_guard.js';
import { requireRateLimit } from '../enforcement/rate_guard.js';

// ============================================================================
// Permission Map -- THE source of truth for authorization policy
// ============================================================================

/**
 * Per-method authorization descriptor.
 * null means the method is exempt from permission checks (event hooks, shutdown, etc.)
 */
export interface MethodPermission {
  readonly permission: Permission;
  readonly rateLimit?: BucketType; // bucket name, or undefined for no rate limit
}

/**
 * Central permission registry.
 *
 * Every key is a dot-separated path matching a public API method:
 *   - 'remember' -> limen.remember()
 *   - 'claims.assertClaim' -> limen.claims.assertClaim()
 *
 * null entries mean the method is exempt (no permission check).
 * Missing entries cause a defensive throw at runtime (fail-closed).
 *
 * FPD-5: RBAC check runs FIRST, then rate limit. Unauthorized callers
 * never consume rate limit tokens.
 */
export const PERMISSION_MAP: Readonly<Record<string, MethodPermission | null>> = {
  // ── Convenience API ──
  'remember': { permission: 'assert_claim', rateLimit: 'api_calls' },
  'recall': { permission: 'query_claims', rateLimit: 'api_calls' },
  'forget': { permission: 'retract_claim', rateLimit: 'api_calls' },
  'connect': { permission: 'relate_claims', rateLimit: 'api_calls' },
  'search': { permission: 'query_claims', rateLimit: 'api_calls' },
  'reflect': { permission: 'assert_claim', rateLimit: 'api_calls' },
  'semanticSearch': { permission: 'query_claims', rateLimit: 'api_calls' },

  // ── Chat/Infer ──
  'chat': { permission: 'chat', rateLimit: 'api_calls' },
  'infer': { permission: 'infer', rateLimit: 'api_calls' },
  'session': { permission: 'chat' },

  // ── Claims namespace ──
  'claims.assertClaim': { permission: 'assert_claim', rateLimit: 'api_calls' },
  'claims.retractClaim': { permission: 'retract_claim', rateLimit: 'api_calls' },
  'claims.queryClaims': { permission: 'query_claims', rateLimit: 'api_calls' },
  'claims.relateClaims': { permission: 'relate_claims', rateLimit: 'api_calls' },
  'claims.searchClaims': { permission: 'query_claims', rateLimit: 'api_calls' },

  // ── Working Memory namespace ──
  'workingMemory.write': { permission: 'write_wm', rateLimit: 'api_calls' },
  'workingMemory.read': { permission: 'read_wm', rateLimit: 'api_calls' },
  'workingMemory.discard': { permission: 'write_wm', rateLimit: 'api_calls' },

  // ── Governance namespace (permissions EXIST in types, now enforced) ──
  'governance.erasure': { permission: 'request_erasure', rateLimit: 'api_calls' },
  'governance.exportAudit': { permission: 'export_compliance' },
  'governance.addRule': { permission: 'manage_classification_rules' },
  'governance.removeRule': { permission: 'manage_classification_rules' },
  'governance.listRules': { permission: 'manage_classification_rules' },
  'governance.protectPredicate': { permission: 'manage_protected_predicates' },
  'governance.listProtectedPredicates': { permission: 'manage_protected_predicates' },

  // ── Consent namespace ──
  'consent.register': { permission: 'manage_consent' },
  'consent.revoke': { permission: 'manage_consent' },
  'consent.check': { permission: 'view_consent' },
  'consent.list': { permission: 'view_consent' },

  // ── Cognitive namespace ──
  'cognitive.consolidate': { permission: 'manage_cognitive' },
  'cognitive.health': { permission: 'query_claims' },
  'cognitive.verify': { permission: 'manage_cognitive' },
  'cognitive.narrative': { permission: 'query_claims' },
  'cognitive.importance': { permission: 'query_claims' },
  'cognitive.suggestConnections': { permission: 'manage_cognitive' },
  'cognitive.acceptSuggestion': { permission: 'manage_cognitive' },
  'cognitive.rejectSuggestion': { permission: 'manage_cognitive' },

  // ── Agents namespace ──
  'agents.register': { permission: 'create_agent' },
  'agents.get': { permission: 'view_telemetry' },
  'agents.list': { permission: 'view_telemetry' },
  'agents.pause': { permission: 'modify_agent' },
  'agents.resume': { permission: 'modify_agent' },
  'agents.retire': { permission: 'delete_agent' },
  'agents.promote': { permission: 'modify_agent' },
  'agents.pipeline': { permission: 'create_mission' },
  'agents.recordViolation': { permission: 'modify_agent' },

  // ── Missions namespace ──
  'missions.create': { permission: 'create_mission' },
  'missions.get': { permission: 'view_telemetry' },
  'missions.list': { permission: 'view_telemetry' },

  // ── Roles namespace ──
  'roles.create': { permission: 'manage_roles' },
  'roles.assign': { permission: 'manage_roles' },
  'roles.revoke': { permission: 'manage_roles' },

  // ── Data namespace ──
  'data.export': { permission: 'export_compliance' },
  'data.purge': { permission: 'purge_data' },
  'data.purgeAll': { permission: 'purge_data' },

  // ── Metrics ──
  'metrics.snapshot': { permission: 'view_telemetry' },

  // ── Top-level ──
  'exportData': { permission: 'export_compliance' },
  'importData': { permission: 'assert_claim' },
  'setDefaultAgent': { permission: 'manage_agents' },
  'health': { permission: 'view_telemetry' },
  'embeddingStats': { permission: 'view_telemetry' },
  'embedPending': { permission: 'manage_cognitive' },
  'checkDuplicate': { permission: 'query_claims' },

  // ── Exempt methods (no permission needed) ──
  'promptInstructions': null,
  'on': null,
  'off': null,
  'shutdown': null,
};

/**
 * Methods that are NOT in PERMISSION_MAP but are known-safe:
 * internal property accessors, Symbol methods, non-function properties, etc.
 * If a method is callable on the engine and NOT in this list or PERMISSION_MAP,
 * applyPermissionGateway will throw at startup (fail-closed, Option A).
 *
 * This prevents silent privilege escalation when developers add new methods
 * but forget to add them to PERMISSION_MAP.
 */
export const EXEMPT_METHODS: ReadonlySet<string> = new Set([
  // Namespace objects (not callable methods — the fail-closed guard only checks functions)
  // These are listed here so that if a namespace object is also iterable as a key,
  // it is explicitly acknowledged rather than silently ignored.
  'claims', 'workingMemory', 'governance', 'consent', 'cognitive',
  'agents', 'missions', 'roles', 'data', 'metrics',
]);

/**
 * Internal infrastructure methods that exist on namespace implementation classes
 * but are NOT part of the public API interface. These are an artifact of class-based
 * implementations exposing internal methods. They must not be permission-gated
 * (they're not callable by API consumers) but must be explicitly declared here
 * to satisfy the fail-closed guard.
 *
 * Adding a method here requires justification: it MUST be internal infrastructure,
 * not a public-facing capability.
 */
export const EXEMPT_NAMESPACE_METHODS: ReadonlySet<string> = new Set([
  // TypeScript `private` members are visible at runtime on class instances.
  // These are internal infrastructure methods on API implementation classes
  // (AgentApiImpl, MissionApiImpl, DataApiImpl, ClaimApiImpl, etc.).
  // They are NOT part of the public interface and are NOT callable by
  // API consumers after deepFreeze. Listed here to satisfy the fail-closed guard.
  //
  // Constructor-injected closures (private readonly):
  'getConnection',
  'getContext',
  'getAudit',
  'getSubstrate',
  'time',        // TimeProvider injection on AgentApiImpl
  'raw',         // raw facade reference on ClaimApiImpl / WorkingMemoryApiImpl
  'accessTracker', // AccessTracker injection on ClaimApiImpl
  // Private methods on impl classes:
  'buildOrchDeps',       // MissionApiImpl
  'buildMissionHandle',  // MissionApiImpl
  'purgeBySession',      // DataApiImpl
  'purgeByMission',      // DataApiImpl
  'findDescendantMissions', // DataApiImpl
  'purgeByAge',          // DataApiImpl
  // Infrastructure on impl classes:
  'rbac',         // RBAC engine reference
  'rateLimiter',  // Rate limiter reference
  'orchestration', // Orchestration engine reference
  'events',       // Event bus reference
  'kernel',       // Kernel reference on DataApiImpl
]);

// ============================================================================
// Gateway Wrapper
// ============================================================================

/**
 * Wrap a single method with RBAC + rate limit enforcement.
 *
 * FPD-5 ordering: RBAC check FIRST, then rate limit.
 * Unauthorized callers never consume rate limit tokens.
 *
 * The wrapper preserves the method's `this` context and return type.
 * For async methods, the permission check happens synchronously before
 * the async body executes -- this is correct because requirePermission
 * throws synchronously on failure.
 */
function wrapMethod<T extends (...args: readonly unknown[]) => unknown>(
  method: T,
  perm: MethodPermission,
  getCtx: () => OperationContext,
  rbac: RbacEngine,
  rateLimiter: RateLimiter,
  getConn: () => DatabaseConnection,
): T {
  const wrapped = function wrappedMethod(this: unknown, ...args: unknown[]): unknown {
    const ctx = getCtx();
    requirePermission(rbac, ctx, perm.permission);
    if (perm.rateLimit) {
      requireRateLimit(rateLimiter, getConn(), ctx, perm.rateLimit);
    }
    return method.apply(this, args);
  };
  // Preserve function name for debugging/stack traces
  Object.defineProperty(wrapped, 'name', { value: method.name || 'anonymous', configurable: true });
  return wrapped as unknown as T;
}

/**
 * Apply the Permission Gateway to a raw Limen engine object.
 *
 * This function wraps every public method with RBAC + rate limit enforcement
 * based on the central PERMISSION_MAP. It MUST be called before deepFreeze().
 *
 * For top-level methods: wraps the method directly on the engine object.
 * For namespaces (governance, cognitive, consent, etc.): wraps each method
 * inside the namespace object.
 *
 * Methods mapped to null in PERMISSION_MAP are left unwrapped (exempt).
 * Methods not present in PERMISSION_MAP are left unwrapped -- the map is
 * advisory for methods that were already gated internally (e.g., missions.create
 * checks create_mission inside MissionApiImpl). The gateway adds defense-in-depth.
 *
 * @param engine - The raw Limen object (mutable, pre-freeze)
 * @param rbac - Kernel RBAC engine
 * @param rateLimiter - Kernel rate limiter
 * @param getCtx - Context accessor (closure from createLimen)
 * @param getConn - Connection accessor (closure from createLimen)
 * @returns The same engine object with wrapped methods (mutated in place)
 */
export function applyPermissionGateway(
  engine: Record<string, unknown>,
  rbac: RbacEngine,
  rateLimiter: RateLimiter,
  getCtx: () => OperationContext,
  getConn: () => DatabaseConnection,
): void {
  // Phase 1: Wrap top-level methods
  for (const [key, perm] of Object.entries(PERMISSION_MAP)) {
    if (perm === null) continue; // exempt
    if (key.includes('.')) continue; // namespace method, handled in Phase 2

    const method = engine[key];
    if (typeof method !== 'function') continue;

    engine[key] = wrapMethod(
      method as (...args: readonly unknown[]) => unknown,
      perm,
      getCtx,
      rbac,
      rateLimiter,
      getConn,
    );
  }

  // Phase 2: Wrap namespace methods
  const namespaceEntries = Object.entries(PERMISSION_MAP)
    .filter(([key, perm]) => key.includes('.') && perm !== null);

  // Group by namespace
  const byNamespace = new Map<string, Array<[string, MethodPermission]>>();
  for (const [key, perm] of namespaceEntries) {
    const dotIdx = key.indexOf('.');
    const ns = key.substring(0, dotIdx);
    const method = key.substring(dotIdx + 1);
    if (!byNamespace.has(ns)) byNamespace.set(ns, []);
    byNamespace.get(ns)!.push([method, perm as MethodPermission]);
  }

  for (const [nsName, methods] of byNamespace) {
    const ns = engine[nsName];
    if (ns === null || ns === undefined || typeof ns !== 'object') continue;

    const nsObj = ns as Record<string, unknown>;

    for (const [methodName, perm] of methods) {
      const method = nsObj[methodName];
      if (typeof method !== 'function') continue;

      nsObj[methodName] = wrapMethod(
        method as (...args: readonly unknown[]) => unknown,
        perm,
        getCtx,
        rbac,
        rateLimiter,
        getConn,
      );
    }
  }

  // ── Phase 3: Fail-closed guard (F-PG-002) ──
  // Detect any top-level callable methods not in PERMISSION_MAP or EXEMPT_METHODS.
  // This is a development-time guard: if a developer adds a method to the engine
  // but forgets to add it to PERMISSION_MAP, initialization fails immediately.
  const topLevelMappedKeys = new Set(
    Object.keys(PERMISSION_MAP).filter(k => !k.includes('.')),
  );
  const unmapped: string[] = [];
  for (const key of Object.keys(engine)) {
    if (typeof engine[key] !== 'function') continue;
    if (topLevelMappedKeys.has(key)) continue;
    if (EXEMPT_METHODS.has(key)) continue;
    unmapped.push(key);
  }
  if (unmapped.length > 0) {
    throw new Error(
      `[PermissionGateway] FAIL-CLOSED: ${unmapped.length} unmapped method(s) found on engine. ` +
      `Add them to PERMISSION_MAP or EXEMPT_METHODS: ${unmapped.join(', ')}`,
    );
  }

  // Also check ALL namespace objects on the engine for unmapped methods.
  // This catches both namespaces in PERMISSION_MAP AND new namespaces that
  // a developer might add without registering any permissions.
  const allNamespaceNames = new Set<string>();
  for (const key of Object.keys(engine)) {
    const val = engine[key];
    if (val !== null && val !== undefined && typeof val === 'object' && !Array.isArray(val)) {
      allNamespaceNames.add(key);
    }
  }

  for (const nsName of allNamespaceNames) {
    if (!EXEMPT_METHODS.has(nsName) && !byNamespace.has(nsName)) {
      // Namespace exists on engine but has zero entries in PERMISSION_MAP
      // and is not exempt. Check if it has callable methods.
      const nsObj = engine[nsName] as Record<string, unknown>;
      const callables = Object.keys(nsObj).filter(k => typeof nsObj[k] === 'function' && !EXEMPT_NAMESPACE_METHODS.has(k));
      if (callables.length > 0) {
        throw new Error(
          `[PermissionGateway] FAIL-CLOSED: namespace '${nsName}' has ${callables.length} method(s) ` +
          `but no PERMISSION_MAP entries. Add them: ${callables.map(c => `${nsName}.${c}`).join(', ')}`,
        );
      }
      continue;
    }

    const ns = engine[nsName];
    if (ns === null || ns === undefined || typeof ns !== 'object') continue;
    const nsObj = ns as Record<string, unknown>;
    const mappedMethods = new Set(
      (byNamespace.get(nsName) ?? []).map(([m]) => m),
    );
    // Also include null-mapped (exempt) namespace methods
    for (const [key, perm] of Object.entries(PERMISSION_MAP)) {
      if (key.startsWith(`${nsName}.`) && perm === null) {
        mappedMethods.add(key.substring(nsName.length + 1));
      }
    }
    const unmappedNs: string[] = [];
    for (const key of Object.keys(nsObj)) {
      if (typeof nsObj[key] !== 'function') continue;
      if (mappedMethods.has(key)) continue;
      if (EXEMPT_NAMESPACE_METHODS.has(key)) continue;
      unmappedNs.push(`${nsName}.${key}`);
    }
    if (unmappedNs.length > 0) {
      throw new Error(
        `[PermissionGateway] FAIL-CLOSED: ${unmappedNs.length} unmapped namespace method(s). ` +
        `Add them to PERMISSION_MAP: ${unmappedNs.join(', ')}`,
      );
    }
  }
}

/**
 * Get all permissions referenced by the PERMISSION_MAP.
 * Used by createLimen() to populate the default single-user role.
 * Ensures the default role always includes every permission the gateway checks.
 */
export function getAllGatewayPermissions(): ReadonlySet<Permission> {
  const perms = new Set<Permission>();
  for (const entry of Object.values(PERMISSION_MAP)) {
    if (entry !== null) {
      perms.add(entry.permission);
    }
  }
  return perms;
}
