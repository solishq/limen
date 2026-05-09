// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * AutoGen Adapter Types
 *
 * Types specific to the AutoGen (Microsoft) framework adapter.
 * AutoGen patterns: ConversableAgent, GroupChat, tool registration, code execution.
 *
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 * Shared Types: SHARED_TYPES.md v1.4.1 (AgentFramework: 'auto_gen')
 */

import type {
  SessionId,
  TaskId,
  AgentId,
  EventId,
  AdapterId,
  AgentEventPayload,
  ActionDigest,
} from '../shared/types.js';
import type { BaseAdapterConfig } from '../shared/types.js';

// ── AutoGen Session Types ──

/** AutoGen session start: ConversableAgent context */
export interface AutoGenSessionStart {
  /** Unique identifier for the AutoGen conversation group */
  readonly conversationId: string;
  /** The agent's name within the AutoGen framework */
  readonly agentName: string;
  /** Group chat name (if in a group chat) */
  readonly groupChatName?: string;
  /** Whether code execution is enabled for this agent */
  readonly codeExecutionEnabled: boolean;
  /** Human input mode: ALWAYS, TERMINATE, NEVER */
  readonly humanInputMode: 'ALWAYS' | 'TERMINATE' | 'NEVER';
  /** Optional metadata */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** AutoGen session end */
export interface AutoGenSessionEnd {
  readonly sessionId: SessionId;
  readonly conversationId: string;
  readonly outcome: 'completed' | 'failed' | 'cancelled' | 'timeout';
  readonly metadata: Readonly<Record<string, unknown>>;
}

// ── AutoGen Config ──

/** AutoGen adapter configuration (extends BaseAdapterConfig) */
export interface AutoGenAdapterConfig extends BaseAdapterConfig {
  /** AutoGen conversation ID */
  readonly conversationId: string;
  /** Agent name within AutoGen */
  readonly agentName: string;
  /** Whether code execution sandbox is enabled */
  readonly codeExecutionEnabled: boolean;
  /** Maximum number of consecutive auto-replies */
  readonly maxConsecutiveAutoReplies: number;
  /** Human input mode */
  readonly humanInputMode: 'ALWAYS' | 'TERMINATE' | 'NEVER';
}

// ── AutoGen Tool Call ──

/** AutoGen function call (tool invocation through ConversableAgent) */
export interface AutoGenFunctionCall {
  /** Function name registered with the agent */
  readonly functionName: string;
  /** Arguments passed to the function */
  readonly arguments: Readonly<Record<string, unknown>>;
  /** Caller agent ID */
  readonly callerAgentName: string;
  /** Target agent for the response (in group chat) */
  readonly targetAgentName?: string;
}

// ── AutoGen Hook Events ──

/** AutoGen native events */
export type AutoGenHookEvent =
  | { readonly type: 'message_sent'; readonly from: string; readonly to: string; readonly content: string }
  | { readonly type: 'message_received'; readonly from: string; readonly to: string; readonly content: string }
  | { readonly type: 'tool_called'; readonly toolName: string; readonly args: Readonly<Record<string, unknown>>; readonly result?: unknown }
  | { readonly type: 'code_executed'; readonly code: string; readonly exitCode: number; readonly output: string }
  | { readonly type: 'group_chat_turn'; readonly speaker: string; readonly groupName: string }
  | { readonly type: 'human_input_requested'; readonly prompt: string }
  | { readonly type: 'termination'; readonly reason: string };

// ── AutoGen Audit Details ──

/** AutoGen-specific audit detail fields */
export interface AutoGenAuditDetails {
  readonly conversationId: string;
  readonly agentName: string;
  readonly groupChatName?: string;
  readonly codeExecutionEnabled: boolean;
}
