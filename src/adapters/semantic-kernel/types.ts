// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Semantic Kernel Adapter Types
 *
 * Types specific to the Microsoft Semantic Kernel framework adapter.
 * SK patterns: Plugins, Planners (sequential/stepwise), Kernel Functions, SK Memory.
 *
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 * Shared Types: SHARED_TYPES.md v1.4.1 (AgentFramework: 'semantic_kernel')
 */

import type { SessionId } from '../shared/types.js';
import type { BaseAdapterConfig } from '../shared/types.js';

// ── SK Session Types ──

/** Semantic Kernel session start */
export interface SKSessionStart {
  /** Kernel instance identifier */
  readonly kernelId: string;
  /** Plugin names loaded in this kernel */
  readonly loadedPlugins: readonly string[];
  /** Active planner type (if any) */
  readonly plannerType?: 'sequential' | 'stepwise' | 'handlebars' | 'none';
  /** Whether SK memory is enabled */
  readonly memoryEnabled: boolean;
  /** Optional metadata */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** Semantic Kernel session end */
export interface SKSessionEnd {
  readonly sessionId: SessionId;
  readonly kernelId: string;
  readonly outcome: 'completed' | 'failed' | 'cancelled' | 'timeout';
  readonly metadata: Readonly<Record<string, unknown>>;
}

// ── SK Config ──

/** Semantic Kernel adapter configuration */
export interface SKAdapterConfig extends BaseAdapterConfig {
  /** Kernel instance ID */
  readonly kernelId: string;
  /** Plugin whitelist (governance enforcement) */
  readonly allowedPlugins: readonly string[];
  /** Planner type enabled */
  readonly plannerType: 'sequential' | 'stepwise' | 'handlebars' | 'none';
  /** Whether to intercept SK memory operations and redirect to Limen */
  readonly interceptSkMemory: boolean;
  /** Maximum planner steps before forced termination */
  readonly maxPlannerSteps: number;
}

// ── SK Hook Events ──

/** Semantic Kernel native events */
export type SKHookEvent =
  | { readonly type: 'function_invoked'; readonly pluginName: string; readonly functionName: string; readonly args: Readonly<Record<string, unknown>>; readonly result?: unknown }
  | { readonly type: 'function_invoking'; readonly pluginName: string; readonly functionName: string; readonly args: Readonly<Record<string, unknown>> }
  | { readonly type: 'planner_step'; readonly stepIndex: number; readonly plannerType: string; readonly functionName: string }
  | { readonly type: 'planner_complete'; readonly plannerType: string; readonly totalSteps: number; readonly success: boolean }
  | { readonly type: 'memory_save'; readonly collection: string; readonly key: string; readonly content: string }
  | { readonly type: 'memory_recall'; readonly collection: string; readonly query: string; readonly limit: number }
  | { readonly type: 'plugin_loaded'; readonly pluginName: string; readonly functions: readonly string[] }
  | { readonly type: 'prompt_rendered'; readonly templateName: string; readonly renderedLength: number };

// ── SK Audit Details ──

/** SK-specific audit detail fields */
export interface SKAuditDetails {
  readonly kernelId: string;
  readonly plannerType: string;
  readonly pluginName?: string;
  readonly functionName?: string;
}
