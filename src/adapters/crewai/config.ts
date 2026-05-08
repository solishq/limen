/**
 * CrewAI Adapter Configuration
 *
 * Contract: CREWAI_ADAPTER_CONTRACT.md S3.2
 * Implements: Config validation, digest computation, governance enforcement.
 *
 * Claims covered: 2.1, 2.2, 2.7, 2.10, 2.12, 2.13, 4.7
 */

import { createHash } from 'node:crypto';
import type {
  AgentId,
  TenantId,
  AgentTrustLevel,
  AgentCapability,
  ClassificationLevel,
  RateLimitPolicy,
  AdapterSandboxDefaults,
  AdapterRefusalHint,
  TokenBudgetConfig,
  RetryPolicy,
  AdapterId,
} from './types.js';
import { DEFAULT_RATE_LIMITS } from './types.js';
import { serdeError, governanceRefusal } from './errors.js';
import type { CrewAIAdapterError } from './errors.js';
import type { GovernanceVerdict, EventId } from './types.js';

// ── CREWAI_ADAPTER_CONTRACT.md S3.2 -- CrewAIAdapterConfig ──

/** CREWAI_ADAPTER_CONTRACT.md S3.2 -- Full adapter configuration */
export interface CrewAIAdapterConfig {
  readonly agentId: AgentId;
  readonly tenantId: TenantId | null;
  readonly trustLevel: AgentTrustLevel;
  readonly capabilities: ReadonlySet<AgentCapability>;

  // CrewAI-specific
  readonly crewId: string;
  readonly agentRole: string;
  readonly processType: 'sequential' | 'hierarchical';
  readonly delegationDepthMax: number;

  // Governance
  readonly defaultClassification: ClassificationLevel;
  readonly governed?: true;
  readonly rateLimits: readonly RateLimitPolicy[];
  readonly sandboxDefaults: AdapterSandboxDefaults;
  readonly refusalHints: readonly AdapterRefusalHint[];

  // Budget
  readonly tokenBudget: TokenBudgetConfig;

  // Connection
  readonly coreEndpoint: string;
  readonly connectionTimeoutMs: number;
  readonly retryPolicy: RetryPolicy;

  // Metadata
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * CREWAI_ADAPTER_CONTRACT.md S3.2 -- Validate config at initialization
 *
 * Claim 2.1: governed: false is always rejected with GOVERNANCE_REFUSAL
 * Claim 2.2: connectionTimeoutMs must be in [1000, 30000]
 * Claim 2.12: warningThresholdPct must be in [0, 100]
 * Claim 2.13: delegationDepthMax must be in [0, 10]
 * Claim 4.7: Invalid ranges rejected, not clamped
 */
export function validateConfig(
  config: CrewAIAdapterConfig,
  adapterId: AdapterId,
): CrewAIAdapterError | null {
  // Claim 2.1: governed: false is always rejected
  if ((config as unknown as Record<string, unknown>).governed === false) {
    const refusalVerdict: GovernanceVerdict = {
      verdict: 'refuse',
      auditId: 'evt-config-rejection' as EventId,
      reason: 'Governance is non-optional. governed: false is not permitted.',
      rule: 'governance_non_optional',
    };
    return governanceRefusal(
      adapterId,
      'initialize',
      'Governance is non-optional. governed: false is not permitted.',
      'governance_non_optional',
      refusalVerdict,
    );
  }

  // Claim 2.2: connectionTimeoutMs in [1000, 30000]
  if (config.connectionTimeoutMs < 1000 || config.connectionTimeoutMs > 30000) {
    return serdeError(
      adapterId,
      `connectionTimeoutMs must be in [1000, 30000], got ${config.connectionTimeoutMs}`,
    );
  }

  // Claim 2.13: delegationDepthMax in [0, 10]
  if (config.delegationDepthMax < 0 || config.delegationDepthMax > 10) {
    return serdeError(
      adapterId,
      `delegationDepthMax must be in [0, 10], got ${config.delegationDepthMax}`,
    );
  }

  // Claim 2.12: warningThresholdPct in [0, 100]
  if (config.tokenBudget.warningThresholdPct < 0 || config.tokenBudget.warningThresholdPct > 100) {
    return serdeError(
      adapterId,
      `warningThresholdPct must be in [0, 100], got ${config.tokenBudget.warningThresholdPct}`,
    );
  }

  // Claim 2.7: rateLimits cannot weaken DEFAULT_RATE_LIMITS
  const weakenError = checkRateLimitWeakening(config.rateLimits, adapterId);
  if (weakenError) return weakenError;

  // Validate token budget values
  if (config.tokenBudget.maxTokensPerOperation <= 0) {
    return serdeError(adapterId, `maxTokensPerOperation must be positive, got ${config.tokenBudget.maxTokensPerOperation}`);
  }
  if (config.tokenBudget.maxTokensPerSession <= 0) {
    return serdeError(adapterId, `maxTokensPerSession must be positive, got ${config.tokenBudget.maxTokensPerSession}`);
  }

  return null;
}

/**
 * CREWAI_ADAPTER_CONTRACT.md S3.2, Claim 2.7 --
 * Rate limits are additive to DEFAULT_RATE_LIMITS.
 * Any config that weakens defaults is rejected.
 */
function checkRateLimitWeakening(
  adapterLimits: readonly RateLimitPolicy[],
  adapterId: AdapterId,
): CrewAIAdapterError | null {
  for (const adapterLimit of adapterLimits) {
    for (const defaultLimit of DEFAULT_RATE_LIMITS) {
      if (
        adapterLimit.scope === defaultLimit.scope &&
        adapterLimit.operation === defaultLimit.operation
      ) {
        // Adapter limit must be equal or stricter
        if (adapterLimit.maxRequests > defaultLimit.maxRequests) {
          const refusalVerdict: GovernanceVerdict = {
            verdict: 'refuse',
            auditId: 'evt-ratelimit-rejection' as EventId,
            reason: `Rate limit for ${adapterLimit.scope}:${adapterLimit.operation} weakens default (${adapterLimit.maxRequests} > ${defaultLimit.maxRequests})`,
            rule: 'rate_limit_inheritance',
          };
          return governanceRefusal(
            adapterId,
            'initialize',
            `Rate limit weakens default for ${adapterLimit.scope}:${adapterLimit.operation}`,
            'rate_limit_inheritance',
            refusalVerdict,
          );
        }
      }
    }
  }
  return null;
}

/**
 * CREWAI_ADAPTER_CONTRACT.md S3.2, Claim 2.10 --
 * Config identity is SHA-256 of canonical JSON serialization.
 * Keys sorted recursively, no whitespace, Set values sorted lexicographically.
 */
export function computeConfigDigest(config: CrewAIAdapterConfig): string {
  const canonical = canonicalizeForDigest(config);
  return sha256Hex(canonical);
}

/**
 * Canonicalize a value for digest computation.
 * Claim 2.10: keys sorted recursively, Sets sorted lexicographically, null preserved.
 */
function canonicalizeForDigest(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (value instanceof Set) {
    const sorted = [...value].sort();
    return '[' + sorted.map(v => canonicalizeForDigest(v)).join(',') + ']';
  }

  if (Array.isArray(value)) {
    return '[' + value.map(v => canonicalizeForDigest(v)).join(',') + ']';
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys.map(k => JSON.stringify(k) + ':' + canonicalizeForDigest(obj[k]));
    return '{' + pairs.join(',') + '}';
  }

  return String(value);
}

/**
 * CREWAI_ADAPTER_CONTRACT.md S3.2, Claim 2.10 --
 * SHA-256 hash of canonical JSON config serialization.
 * Contract requires SHA-256, not a 32-bit DJB hash.
 */
function sha256Hex(input: string): string {
  const hash = createHash('sha256').update(input).digest('hex');
  return hash;
}
