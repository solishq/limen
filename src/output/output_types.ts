// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AGENT_OUTPUT_GOVERNANCE.md §4-§7
/**
 * Output Governance Data Models
 *
 * All types derived from AGENT_OUTPUT_GOVERNANCE contract §4 through §7.
 * Implements: OG-4.1 through OG-7.30, OG-8.1 through OG-8.28
 *
 * Design decisions:
 * - Branded types for all IDs (AD-2)
 * - Readonly interfaces throughout (immutability by default)
 * - Shared types from adapters/shared/types.ts (OG-2.1 through OG-2.16)
 * - No redefinition of shared types (contract preamble)
 */

import type {
  ClaimId,
} from '../claims/interfaces/claim_types.js';

import type {
  AgentId, SessionId, MissionId, TaskId,
  ClassificationLevel,
  AgentEvent, AgentEventHandler,
} from '../adapters/shared/types.js';

// ============================================================================
// §4.1 OutputType (OG-4.1 through OG-4.8)
// ============================================================================

/** OG-4.1: 7-value output type union */
export type OutputType =
  | 'assertion'
  | 'judgment'
  | 'evidence'
  | 'action'
  | 'question'
  | 'alert'
  | 'narrative';

/** OG-4.2 through OG-4.8: Predicate format mapping */
export const OUTPUT_TYPE_TO_PREDICATE: Readonly<Record<OutputType, string>> = {
  assertion: 'output.assertion',
  judgment: 'output.judgment',
  evidence: 'output.evidence',
  action: 'output.action',
  question: 'output.question',
  alert: 'output.alert',
  narrative: 'output.narrative',
};

/** Valid output types set for validation */
export const VALID_OUTPUT_TYPES: ReadonlySet<string> = new Set<string>([
  'assertion', 'judgment', 'evidence', 'action', 'question', 'alert', 'narrative',
]);

// ============================================================================
// §4.2 OutputOptions (OG-4.9 through OG-4.12)
// ============================================================================

/** OG-4.9 through OG-4.12: Options for produce() */
export interface OutputOptions {
  readonly confidence?: number;                       // OG-4.9: clamped to [0, 0.7]
  readonly classification?: ClassificationLevel;      // OG-4.10: defaults to 'internal'
  readonly missionId?: MissionId;                     // OG-4.12
  readonly reasoning?: string;                        // OG-4.12
  readonly relatedClaims?: readonly ClaimId[];        // OG-4.11: creates derived_from
  readonly tags?: readonly string[];                  // OG-4.12
  readonly metadata?: Readonly<Record<string, unknown>>; // OG-4.12
}

// ============================================================================
// §4.3 OutputEntry (OG-4.13 through OG-4.16)
// ============================================================================

/** OG-4.13 through OG-4.16: Output entry record */
export interface OutputEntry {
  readonly id: ClaimId;                               // OG-4.13
  readonly type: OutputType;                          // OG-4.13
  readonly content: string;                           // OG-4.13, OG-4.14: 1-32768 chars
  readonly confidence: number;                        // OG-4.13
  readonly classification: ClassificationLevel;       // OG-4.13
  readonly agentId: AgentId;                          // OG-4.13
  readonly sessionId: SessionId;                      // OG-4.13
  readonly missionId: MissionId | null;               // OG-4.13
  readonly reasoning: string | null;                  // OG-4.13
  readonly relatedClaims: readonly ClaimId[];         // OG-4.13
  readonly tags: readonly string[];                   // OG-4.13
  readonly createdAt: string;                         // OG-4.13: ISO-8601
  readonly status: 'active' | 'retracted';            // OG-4.15, OG-4.16
}

// ============================================================================
// §4.4 OutputFilter (OG-4.17 through OG-4.22)
// ============================================================================

/** OG-4.17 through OG-4.22: Query filter for outputs */
export interface OutputFilter {
  readonly type?: OutputType | readonly OutputType[];  // OG-4.18
  readonly agentId?: AgentId;                          // OG-4.17
  readonly sessionId?: SessionId;                      // OG-4.17
  readonly missionId?: MissionId;                      // OG-4.17
  readonly timeRange?: { readonly from: string; readonly to: string }; // OG-4.17
  readonly status?: 'active' | 'retracted' | 'all';   // OG-4.19, OG-4.20: default 'active'
  readonly tags?: readonly string[];                   // OG-4.17
  readonly minConfidence?: number;                     // OG-4.17
  readonly limit?: number;                             // OG-4.21: default 50
  readonly offset?: number;                            // OG-4.22: default 0
}

/** OG-4.20 through OG-4.22: Filter defaults */
export const OUTPUT_FILTER_DEFAULTS = {
  status: 'active' as const,
  limit: 50,
  offset: 0,
} as const;

// ============================================================================
// §5.1 CostRecord (OG-5.1 through OG-5.6)
// ============================================================================

/** OG-5.1: Cost record for LLM consumption tracking */
export interface CostRecord {
  readonly id: ClaimId;                               // OG-5.1
  readonly provider: string;                          // OG-5.1
  readonly model: string;                             // OG-5.1
  readonly inputTokens: number;                       // OG-5.2: non-negative integer
  readonly outputTokens: number;                      // OG-5.2: non-negative integer
  readonly totalTokens: number;                       // OG-5.2, OG-5.3: inputTokens + outputTokens
  readonly cost: number;                              // OG-5.4: non-negative
  readonly currency: string;                          // OG-5.1
  readonly duration: number;                          // OG-5.5: non-negative ms
  readonly agentId: AgentId;                          // OG-5.1
  readonly sessionId: SessionId;                      // OG-5.1
  readonly missionId: MissionId | null;               // OG-5.1, OG-5.20
  readonly taskId: TaskId | null;                     // OG-5.1, OG-5.20
  readonly timestamp: string;                         // OG-5.1: ISO-8601
}

// ============================================================================
// §5.2 VitalRecord (OG-5.7 through OG-5.10)
// ============================================================================

/** OG-5.7: Vital signal record for operational metrics */
export interface VitalRecord {
  readonly id: ClaimId;                               // OG-5.7
  readonly metric: string;                            // OG-5.8: non-empty, dot-delimited
  readonly value: number;                             // OG-5.7
  readonly unit: string;                              // OG-5.9: non-empty
  readonly tags: Readonly<Record<string, string>>;    // OG-5.7
  readonly agentId: AgentId;                          // OG-5.7
  readonly sessionId: SessionId;                      // OG-5.7
  readonly timestamp: string;                         // OG-5.7: ISO-8601
}

// ============================================================================
// §5.3 CostFilter (OG-5.11)
// ============================================================================

/** OG-5.11: Filter for querying cost records */
export interface CostFilter {
  readonly provider?: string;
  readonly model?: string;
  readonly agentId?: AgentId;
  readonly sessionId?: SessionId;
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly timeRange?: { readonly from: string; readonly to: string };
  readonly limit?: number;
  readonly offset?: number;
}

// ============================================================================
// §5.4 VitalFilter (OG-5.12)
// ============================================================================

/** OG-5.12: Filter for querying vital records */
export interface VitalFilter {
  readonly metric?: string;
  readonly agentId?: AgentId;
  readonly sessionId?: SessionId;
  readonly tags?: Readonly<Record<string, string>>;
  readonly timeRange?: { readonly from: string; readonly to: string };
  readonly limit?: number;
  readonly offset?: number;
}

// ============================================================================
// §5.5 BudgetConsumption (OG-5.13 through OG-5.18)
// ============================================================================

/** OG-5.13 through OG-5.18: Budget consumption aggregation */
export interface BudgetConsumption {
  readonly session: { readonly tokens: number; readonly cost: number };        // OG-5.13
  readonly mission: { readonly tokens: number; readonly cost: number } | null; // OG-5.14
  readonly lifetime: { readonly tokens: number; readonly cost: number };       // OG-5.15
  readonly quotaRemaining: {
    readonly tokens: number | null;  // OG-5.16, OG-5.17: null when no budget
    readonly cost: number | null;    // OG-5.16, OG-5.17: null when no budget
  };
}

// ============================================================================
// §6.1 InferenceOptions (OG-6.1 through OG-6.7)
// ============================================================================

/** JSON Schema type (opaque) */
export type JsonSchema = Record<string, unknown>;

/** Zod-compatible structural schema type */
export interface ZodSchema<T> {
  parse(data: unknown): T;
  safeParse(data: unknown): { success: boolean; data?: T; error?: unknown };
}

/** OG-6.1 through OG-6.7: Inference configuration */
export interface InferenceOptions<T> {
  readonly prompt: string;                            // OG-6.1: non-empty
  readonly schema: JsonSchema | ZodSchema<T>;         // OG-6.2
  readonly model?: string;                            // OG-6.7
  readonly temperature?: number;                      // OG-6.3: clamped to [0, 2.0]
  readonly maxRetries?: number;                       // OG-6.4: clamped to [0, 5], default 2
  readonly strict?: boolean;                          // OG-6.6: default true
  readonly timeout?: number;                          // OG-6.5: clamped to [1000, 300000], default 30000
  readonly classification?: ClassificationLevel;      // OG-6.7
  readonly missionId?: MissionId;                     // OG-6.7
}

/** Inference defaults */
export const INFERENCE_DEFAULTS = {
  maxRetries: 2,
  strict: true,
  timeout: 30000,
  temperature: 0.0,
} as const;

/** Inference clamping ranges */
export const INFERENCE_CLAMPS = {
  temperature: { min: 0, max: 2.0 },
  maxRetries: { min: 0, max: 5 },
  timeout: { min: 1000, max: 300000 },
} as const;

// ============================================================================
// §6.2 InferenceResult (OG-6.8 through OG-6.13)
// ============================================================================

/** OG-6.8 through OG-6.13: Inference result */
export interface InferenceResult<T> {
  readonly value: T;                                  // OG-6.8
  readonly raw: string;                               // OG-6.9
  readonly retries: number;                           // OG-6.10
  readonly validationErrors: readonly ValidationError[]; // OG-6.11: all attempts
  readonly duration: number;                          // OG-6.13: total ms
  readonly cost: CostRecord;                          // OG-6.12: aggregate
}

// ============================================================================
// §6.3 ValidationError (OG-6.14)
// ============================================================================

/** OG-6.14: Schema validation error with attempt tracking */
export interface ValidationError {
  readonly path: string;
  readonly message: string;
  readonly attempt: number;  // 1-indexed
}

// ============================================================================
// §7.1 AgentPlugin (OG-7.1 through OG-7.6)
// ============================================================================

/** OG-7.1 through OG-7.6: Plugin definition */
export interface AgentPlugin {
  readonly id: string;                                // OG-7.1: unique, UUID recommended
  readonly name: string;                              // OG-7.2: non-empty, max 128 chars
  readonly version: string;                           // OG-7.3: valid semver
  readonly capabilities: readonly string[];           // OG-7.4: validated at install
  install(context: PluginContext): Promise<void>;     // OG-7.5
  destroy(): Promise<void>;                           // OG-7.6
}

// ============================================================================
// §7.2 PluginContext (OG-7.7 through OG-7.13)
// ============================================================================

/** OG-7.7 through OG-7.9: Context provided to plugins during install */
export interface PluginContext {
  on(event: AgentEvent, handler: AgentEventHandler): string;   // OG-7.7
  off(subscriptionId: string): void;                            // OG-7.7
  readonly api: PluginApi;                                      // OG-7.8
  readonly logger: PluginLogger;                                // OG-7.9
}

/** OG-7.10, OG-7.11: Read-only API for plugins */
export interface PluginApi {
  queryOutputs(filter: OutputFilter): Promise<Result<OutputEntry[]>>;      // OG-7.10
  queryVitals(filter: VitalFilter): Promise<Result<VitalRecord[]>>;        // OG-7.10
  queryCosts(filter: CostFilter): Promise<Result<CostRecord[]>>;           // OG-7.10
}

/** OG-7.12, OG-7.13: Logger with plugin ID isolation */
export interface PluginLogger {
  debug(message: string, data?: Record<string, unknown>): void;  // OG-7.13
  info(message: string, data?: Record<string, unknown>): void;   // OG-7.13
  warn(message: string, data?: Record<string, unknown>): void;   // OG-7.13
  error(message: string, data?: Record<string, unknown>): void;  // OG-7.13
}

// ============================================================================
// §7.3 PluginConfig (OG-7.14 through OG-7.18)
// ============================================================================

/** OG-7.14 through OG-7.18: Plugin runtime configuration */
export interface PluginConfig {
  readonly enabled: boolean;                   // OG-7.14: default true
  readonly priority: number;                   // OG-7.15: 0-100, default 50
  readonly isolation: 'shared' | 'sandboxed';  // OG-7.16: default 'shared'
  readonly errorPolicy: 'propagate' | 'contain' | 'disable_on_error'; // OG-7.17: default 'contain'
  readonly maxErrorCount?: number;             // OG-7.18: default 3
}

/** OG-7.14 through OG-7.18: Plugin configuration defaults */
export const PLUGIN_CONFIG_DEFAULTS: PluginConfig = {
  enabled: true,
  priority: 50,
  isolation: 'shared',
  errorPolicy: 'contain',
  maxErrorCount: 3,
};

// ============================================================================
// §7.4 PluginRegistration (OG-7.19, OG-7.20)
// ============================================================================

/** OG-7.19, OG-7.20: Registered plugin view */
export interface PluginRegistration {
  readonly pluginId: string;                   // OG-7.19
  readonly name: string;                       // OG-7.19
  readonly version: string;                    // OG-7.19
  readonly status: 'active' | 'disabled' | 'error'; // OG-7.20
  readonly installedAt: string;                // OG-7.19: ISO-8601
  readonly errorCount: number;                 // OG-7.19
  readonly lastError: string | null;           // OG-7.19
  readonly config: PluginConfig;               // OG-7.19
}

// ============================================================================
// §7.5 HookType (OG-7.21)
// ============================================================================

/** OG-7.21: 7-value hook type union */
export type HookType =
  | 'before_assert'
  | 'after_assert'
  | 'before_recall'
  | 'after_recall'
  | 'before_decay'
  | 'before_output'
  | 'after_output';

/** Valid hook types set for validation */
export const VALID_HOOK_TYPES: ReadonlySet<string> = new Set<string>([
  'before_assert', 'after_assert', 'before_recall', 'after_recall',
  'before_decay', 'before_output', 'after_output',
]);

// ============================================================================
// §7.6 AgentHook (OG-7.22)
// ============================================================================

/** OG-7.22: Hook definition */
export interface AgentHook {
  readonly type: HookType;       // OG-7.22
  readonly priority: number;     // OG-7.22: 0-100, lower fires first
  readonly name: string;         // OG-7.22
  readonly handler: HookHandler; // OG-7.22
}

// ============================================================================
// §7.7 HookHandler, HookContext, HookResult (OG-7.23 through OG-7.27)
// ============================================================================

/** OG-7.23: Hook handler function type */
export type HookHandler = (context: HookContext) => Promise<HookResult>;

/** OG-7.24: Context provided to hook handlers */
export interface HookContext {
  readonly hookType: HookType;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly timestamp: string;  // ISO-8601
  readonly payload: Readonly<Record<string, unknown>>;
}

/** OG-7.25, OG-7.26: Hook execution result */
export interface HookResult {
  readonly proceed: boolean;                              // OG-7.25
  readonly modified?: Readonly<Record<string, unknown>>;  // OG-7.26
  readonly reason?: string;                               // OG-7.25
}

// ============================================================================
// §7.8 HookRegistration (OG-7.28 through OG-7.30)
// ============================================================================

/** OG-7.28 through OG-7.30: Registered hook view */
export interface HookRegistration {
  readonly hookId: string;                     // OG-7.28
  readonly type: HookType;                     // OG-7.28
  readonly priority: number;                   // OG-7.28
  readonly name: string;                       // OG-7.28
  readonly registeredAt: string;               // OG-7.28: ISO-8601
  readonly firedCount: number;                 // OG-7.29
  readonly blockedCount: number;               // OG-7.30
  readonly lastFiredAt: string | null;         // OG-7.28
  readonly errorCount: number;                 // OG-7.28
}

// ============================================================================
// §8 Output Events (OG-8.1 through OG-8.14)
// ============================================================================

/** OG-8.1 through OG-8.14: Output event type union */
export type OutputEvent =
  | 'output:produced'
  | 'output:retracted'
  | 'telemetry:cost_recorded'
  | 'telemetry:vital_recorded'
  | 'inference:started'
  | 'inference:completed'
  | 'inference:retry'
  | 'inference:failed'
  | 'plugin:installed'
  | 'plugin:uninstalled'
  | 'plugin:error'
  | 'hook:registered'
  | 'hook:fired'
  | 'hook:blocked';

/** Valid output events set for validation */
export const VALID_OUTPUT_EVENTS: ReadonlySet<string> = new Set<string>([
  'output:produced', 'output:retracted',
  'telemetry:cost_recorded', 'telemetry:vital_recorded',
  'inference:started', 'inference:completed', 'inference:retry', 'inference:failed',
  'plugin:installed', 'plugin:uninstalled', 'plugin:error',
  'hook:registered', 'hook:fired', 'hook:blocked',
]);

// ============================================================================
// Constants
// ============================================================================

/** OG-12.2: Agent confidence ceiling */
export const AGENT_CONFIDENCE_CEILING = 0.7;

/** OG-4.14: Content length limits */
export const OUTPUT_CONTENT_MIN_LENGTH = 1;
export const OUTPUT_CONTENT_MAX_LENGTH = 32768;

/** OG-12.12: Hook timeout in ms */
export const HOOK_TIMEOUT_MS = 5000;

/** OG-7.2: Plugin name max length */
export const PLUGIN_NAME_MAX_LENGTH = 128;

/** Semver regex for version validation (OG-7.3) */
export const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?$/;

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type {
  AgentId, SessionId, MissionId, TaskId,
  ClassificationLevel,
  AgentEvent, AgentEventHandler,
  GovernanceDecision,
} from '../adapters/shared/types.js';

export type { OperationContext } from '../kernel/interfaces/index.js';

export type { ClaimId } from '../claims/interfaces/claim_types.js';

// Import Result type for use in interfaces
import type { Result } from '../kernel/interfaces/index.js';
export type { Result } from '../kernel/interfaces/index.js';
