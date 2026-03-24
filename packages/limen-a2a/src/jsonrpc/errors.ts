/**
 * JSON-RPC 2.0 error response helpers.
 *
 * Each function constructs a well-formed JsonRpcResponse with the appropriate
 * standard error code. The id parameter is null when the request could not be
 * parsed (per JSON-RPC 2.0 spec section 5).
 */

import type { JsonRpcResponse } from './types.js';
import {
  PARSE_ERROR,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
  INTERNAL_ERROR,
} from './types.js';

export function parseError(data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    error: { code: PARSE_ERROR, message: 'Parse error', data },
    id: null,
  };
}

export function invalidRequest(id: string | number | null, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    error: { code: INVALID_REQUEST, message: 'Invalid Request', data },
    id,
  };
}

export function methodNotFound(id: string | number, method: string): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    error: { code: METHOD_NOT_FOUND, message: `Method not found: ${method}` },
    id,
  };
}

export function invalidParams(id: string | number, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    error: { code: INVALID_PARAMS, message: 'Invalid params', data },
    id,
  };
}

export function internalError(id: string | number | null, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    error: { code: INTERNAL_ERROR, message: 'Internal error', data },
    id,
  };
}
