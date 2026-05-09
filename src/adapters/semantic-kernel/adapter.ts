/**
 * LimenSemanticKernelAdapter -- Semantic Kernel Framework Adapter for Limen Governance Substrate
 *
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 * Shared Types: SHARED_TYPES.md v1.4.1 (AgentFramework: 'semantic_kernel')
 *
 * Semantic Kernel-specific capabilities:
 * - Plugin system integration (SK plugins -> governed tool calls)
 * - Planner support (sequential/stepwise planners with governance at each step)
 * - SK memory integration (SK memory -> Limen governed memory)
 * - Kernel function invocation hooks
 * - SK-native event translation
 *
 * Extends BaseGovernedAdapter with SK-specific hook translation and type mapping.
 */

import { BaseGovernedAdapter } from '../shared/base-adapter.js';
import { serdeError } from '../shared/errors.js';
import type { AdapterError } from '../shared/errors.js';
import type {
  AdapterId,
  AgentId,
  AgentCapability,
  AgentFramework,
  AgentToolCall,
  AgentEventPayload,
  LimenOperation,
  SessionId,
} from '../shared/types.js';
import type { SKAdapterConfig, SKSessionStart, SKSessionEnd } from './types.js';
import type { SKHookEvent } from './types.js';
import {
  translateToolToOperations,
  mapNativeEvent,
  mapLimenEvent,
  KNOWN_TOOLS,
} from './hooks.js';

/**
 * AGENT_ADAPTER_ARCHITECTURE.md S7 -- Semantic Kernel adapter.
 *
 * Translates SK kernel function invocations, planner steps, plugin operations,
 * and session boundaries into canonical Limen types.
 *
 * readonly #governed = true (inherited from BaseGovernedAdapter)
 */
export class LimenSemanticKernelAdapter extends BaseGovernedAdapter<
  SKAdapterConfig,
  SKSessionStart,
  SKSessionEnd
> {
  /** SHARED_TYPES.md S21 -- Framework: semantic_kernel */
  get agentFramework(): AgentFramework {
    return 'semantic_kernel';
  }

  constructor(adapterId: AdapterId, capabilities: ReadonlySet<AgentCapability>) {
    super(adapterId, capabilities);
  }

  // ── Abstract implementations ──

  /** @override Build working memory namespace for SK session */
  protected getWorkingMemoryNamespace(nativeSession: SKSessionStart): string {
    return `semantic-kernel/${nativeSession.kernelId}/${nativeSession.plannerType || 'none'}`;
  }

  /** @override Build SK-specific session metadata */
  protected getSessionMetadata(nativeSession: SKSessionStart): Readonly<Record<string, unknown>> {
    return {
      kernelId: nativeSession.kernelId,
      loadedPlugins: nativeSession.loadedPlugins,
      plannerType: nativeSession.plannerType ?? 'none',
      memoryEnabled: nativeSession.memoryEnabled,
      ...nativeSession.metadata,
    };
  }

  /** @override Translate SK kernel function call to LimenOperations */
  protected translateFrameworkToolCall(toolCall: AgentToolCall): LimenOperation[] | null {
    return translateToolToOperations(toolCall);
  }

  /** @override Map SK native event to Limen event */
  protected mapNativeEventImpl(
    nativeEvent: unknown,
    adapterId: AdapterId,
    agentId: AgentId,
    sessionId: SessionId | null,
  ): AgentEventPayload | null {
    return mapNativeEvent(nativeEvent as SKHookEvent, adapterId, agentId, sessionId);
  }

  /** @override Map Limen event back to SK native event */
  protected mapLimenEventImpl(limenEvent: AgentEventPayload): unknown | null {
    return mapLimenEvent(limenEvent);
  }

  /** @override Map native action type to canonical ComputerActionType */
  protected mapNativeTypeToComputerActionType(nativeType: string): string {
    const map: Record<string, string> = {
      'kernel_function': 'code:execute',
      'plugin_invoke': 'code:execute',
      'planner_step': 'code:execute',
      'file_read': 'file:read',
      'file_write': 'file:write',
      'terminal': 'terminal:execute',
      'browser': 'browser:navigate',
      'memory_save': 'memory:write',
      'memory_recall': 'memory:read',
    };
    return map[nativeType] || `native:${nativeType}`;
  }

  /** @override Native action type to required capability mapping */
  protected getNativeTypeCapabilityMap(): Readonly<Record<string, AgentCapability>> {
    return {
      'kernel_function': 'code_execution',
      'plugin_invoke': 'code_execution',
      'planner_step': 'code_execution',
      'file_read': 'file_access',
      'file_write': 'file_access',
      'terminal': 'terminal_use',
      'browser': 'browser_use',
      'memory_save': 'memory_write',
      'memory_recall': 'memory_read',
    };
  }

  /** @override Known tool names for UNKNOWN_TOOL error */
  protected getKnownTools(): readonly string[] {
    return KNOWN_TOOLS;
  }

  /** @override SK-specific audit context */
  protected getAuditContext(): Readonly<Record<string, unknown>> {
    return {
      kernelId: this._config?.kernelId || '',
      plannerType: this._config?.plannerType || 'none',
    };
  }

  /** @override Validate SK-specific config fields */
  protected validateFrameworkConfig(config: SKAdapterConfig): AdapterError | null {
    if (!config.kernelId || config.kernelId.length === 0) {
      return serdeError(this.adapterId, 'kernelId is required and must be non-empty');
    }
    if (config.maxPlannerSteps < 1 || config.maxPlannerSteps > 100) {
      return serdeError(this.adapterId, `maxPlannerSteps must be in [1, 100], got ${config.maxPlannerSteps}`);
    }
    return null;
  }
}
