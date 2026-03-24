/**
 * JSON-RPC 2.0 type definitions for the Limen A2A server.
 *
 * Derived from the JSON-RPC 2.0 specification (https://www.jsonrpc.org/specification).
 * Zero external dependencies — types only.
 */

// ── JSON-RPC 2.0 Core Types ──

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: unknown;
  readonly id: string | number;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly result?: unknown;
  readonly error?: JsonRpcError;
  readonly id: string | number | null;
}

export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

// ── Standard JSON-RPC 2.0 Error Codes ──

export const PARSE_ERROR = -32700 as const;
export const INVALID_REQUEST = -32600 as const;
export const METHOD_NOT_FOUND = -32601 as const;
export const INVALID_PARAMS = -32602 as const;
export const INTERNAL_ERROR = -32603 as const;

// ── A2A Task Types ──

export type A2ATaskState = 'submitted' | 'working' | 'completed' | 'failed' | 'canceled';

export interface A2AMessage {
  readonly role: 'user' | 'agent';
  readonly parts: readonly A2APart[];
}

export interface A2APart {
  readonly type: 'text';
  readonly text: string;
}

export interface A2ATaskSendParams {
  readonly id: string;
  readonly message: A2AMessage;
  readonly metadata?: {
    readonly skill?: string;
    readonly action?: string;
    readonly params?: Record<string, unknown>;
  };
}

export interface A2ATaskGetParams {
  readonly id: string;
}

export interface A2ATaskCancelParams {
  readonly id: string;
}

export interface A2ATaskResult {
  readonly id: string;
  readonly state: A2ATaskState;
  readonly messages: readonly A2AMessage[];
  readonly metadata?: Record<string, unknown>;
}
