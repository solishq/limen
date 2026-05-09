/**
 * LimenAutoGenAdapter -- AutoGen (Microsoft) Framework Adapter for Limen Governance Substrate
 *
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 * Shared Types: SHARED_TYPES.md v1.4.1 (AgentFramework: 'auto_gen')
 *
 * AutoGen-specific capabilities:
 * - ConversableAgent pattern support (agent-to-agent messaging)
 * - Tool registration with governance wrapping
 * - Group chat orchestration hooks
 * - Code execution sandboxing integration
 * - AutoGen-native event translation (message_sent, tool_called, etc.)
 *
 * Extends BaseGovernedAdapter with AutoGen-specific hook translation and type mapping.
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
import type { AutoGenAdapterConfig, AutoGenSessionStart, AutoGenSessionEnd } from './types.js';
import type { AutoGenHookEvent } from './types.js';
import {
  translateToolToOperations,
  mapNativeEvent,
  mapLimenEvent,
  KNOWN_TOOLS,
} from './hooks.js';

/**
 * AGENT_ADAPTER_ARCHITECTURE.md S7.3 -- AutoGen adapter.
 *
 * Translates AutoGen ConversableAgent tool invocations, group chat events,
 * and session boundaries into canonical Limen types.
 *
 * readonly #governed = true (inherited from BaseGovernedAdapter)
 */
export class LimenAutoGenAdapter extends BaseGovernedAdapter<
  AutoGenAdapterConfig,
  AutoGenSessionStart,
  AutoGenSessionEnd
> {
  /** SHARED_TYPES.md S21 -- Framework: auto_gen */
  get agentFramework(): AgentFramework {
    return 'auto_gen';
  }

  constructor(adapterId: AdapterId, capabilities: ReadonlySet<AgentCapability>) {
    super(adapterId, capabilities);
  }

  // ── Abstract implementations ──

  /** @override Build working memory namespace for AutoGen session */
  protected getWorkingMemoryNamespace(nativeSession: AutoGenSessionStart): string {
    return `autogen/${nativeSession.conversationId}/${nativeSession.agentName}`;
  }

  /** @override Build AutoGen-specific session metadata */
  protected getSessionMetadata(nativeSession: AutoGenSessionStart): Readonly<Record<string, unknown>> {
    return {
      conversationId: nativeSession.conversationId,
      agentName: nativeSession.agentName,
      groupChatName: nativeSession.groupChatName ?? null,
      codeExecutionEnabled: nativeSession.codeExecutionEnabled,
      humanInputMode: nativeSession.humanInputMode,
      ...nativeSession.metadata,
    };
  }

  /** @override Translate AutoGen tool call to LimenOperations */
  protected translateFrameworkToolCall(toolCall: AgentToolCall): LimenOperation[] | null {
    return translateToolToOperations(toolCall);
  }

  /** @override Map AutoGen native event to Limen event */
  protected mapNativeEventImpl(
    nativeEvent: unknown,
    adapterId: AdapterId,
    agentId: AgentId,
    sessionId: SessionId | null,
  ): AgentEventPayload | null {
    return mapNativeEvent(nativeEvent as AutoGenHookEvent, adapterId, agentId, sessionId);
  }

  /** @override Map Limen event back to AutoGen native event */
  protected mapLimenEventImpl(limenEvent: AgentEventPayload): unknown | null {
    return mapLimenEvent(limenEvent);
  }

  /** @override Map native action type to canonical ComputerActionType */
  protected mapNativeTypeToComputerActionType(nativeType: string): string {
    const map: Record<string, string> = {
      'function_call': 'code:execute',
      'code_execution': 'code:execute',
      'file_read': 'file:read',
      'file_write': 'file:write',
      'terminal': 'terminal:execute',
      'browser': 'browser:navigate',
      'message_send': 'process:spawn',
    };
    return map[nativeType] || `native:${nativeType}`;
  }

  /** @override Native action type to required capability mapping */
  protected getNativeTypeCapabilityMap(): Readonly<Record<string, AgentCapability>> {
    return {
      'function_call': 'code_execution',
      'code_execution': 'code_execution',
      'file_read': 'file_access',
      'file_write': 'file_access',
      'terminal': 'terminal_use',
      'browser': 'browser_use',
      'message_send': 'multi_agent',
    };
  }

  /** @override Known tool names for UNKNOWN_TOOL error */
  protected getKnownTools(): readonly string[] {
    return KNOWN_TOOLS;
  }

  /** @override AutoGen-specific audit context */
  protected getAuditContext(): Readonly<Record<string, unknown>> {
    return {
      conversationId: this._config?.conversationId || '',
      agentName: this._config?.agentName || '',
      codeExecutionEnabled: this._config?.codeExecutionEnabled ?? false,
    };
  }

  /** @override Validate AutoGen-specific config fields */
  protected validateFrameworkConfig(config: AutoGenAdapterConfig): AdapterError | null {
    if (!config.conversationId || config.conversationId.length === 0) {
      return serdeError(this.adapterId, 'conversationId is required and must be non-empty');
    }
    if (!config.agentName || config.agentName.length === 0) {
      return serdeError(this.adapterId, 'agentName is required and must be non-empty');
    }
    if (config.maxConsecutiveAutoReplies < 0 || config.maxConsecutiveAutoReplies > 100) {
      return serdeError(this.adapterId, `maxConsecutiveAutoReplies must be in [0, 100], got ${config.maxConsecutiveAutoReplies}`);
    }
    return null;
  }
}
