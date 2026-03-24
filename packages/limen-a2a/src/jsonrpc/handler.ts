/**
 * JSON-RPC 2.0 request handler.
 *
 * Parses raw HTTP body into a JsonRpcRequest, validates the envelope,
 * routes to the registered method handler, and returns a JsonRpcResponse.
 *
 * Design: The handler is a pure function composition — it takes a method
 * registry (method name -> async handler function) and returns an async
 * function that processes raw string input into a response object.
 *
 * No external dependencies. All JSON parsing uses the built-in JSON global.
 */

import type { JsonRpcRequest, JsonRpcResponse } from './types.js';
import { parseError, invalidRequest, methodNotFound, internalError } from './errors.js';

/**
 * A method handler receives validated params and the request id,
 * and returns a JSON-RPC result (the value for the `result` field).
 */
export type MethodHandler = (params: unknown, id: string | number) => Promise<unknown>;

/**
 * Method registry: maps JSON-RPC method names to their handler functions.
 */
export type MethodRegistry = ReadonlyMap<string, MethodHandler>;

/**
 * Validate the structure of a parsed JSON-RPC 2.0 request.
 *
 * Returns null if valid, or a JsonRpcResponse error if invalid.
 * Per JSON-RPC 2.0 spec:
 * - jsonrpc MUST be exactly "2.0"
 * - method MUST be a string
 * - id MUST be a string or number (we do not support null id / notifications
 *   because A2A requires responses for all requests)
 */
function validateRequest(parsed: unknown): JsonRpcResponse | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return invalidRequest(null, 'Request must be a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.jsonrpc !== '2.0') {
    return invalidRequest(
      extractId(obj),
      'Missing or invalid jsonrpc field — must be "2.0"',
    );
  }

  if (typeof obj.method !== 'string' || obj.method.length === 0) {
    return invalidRequest(extractId(obj), 'Missing or invalid method field');
  }

  if (obj.id === undefined || obj.id === null) {
    return invalidRequest(null, 'Missing id field — notifications not supported');
  }

  if (typeof obj.id !== 'string' && typeof obj.id !== 'number') {
    return invalidRequest(null, 'id must be a string or number');
  }

  return null;
}

/**
 * Safely extract the id from a partially-parsed object.
 * Returns null if the id is not a valid string or number.
 */
function extractId(obj: Record<string, unknown>): string | number | null {
  if (typeof obj.id === 'string' || typeof obj.id === 'number') {
    return obj.id;
  }
  return null;
}

/**
 * Create a JSON-RPC 2.0 request handler bound to a method registry.
 *
 * Usage:
 *   const handle = createHandler(registry);
 *   const response = await handle(rawBodyString);
 */
export function createHandler(registry: MethodRegistry): (raw: string) => Promise<JsonRpcResponse> {
  return async function handleRequest(raw: string): Promise<JsonRpcResponse> {
    // Step 1: Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return parseError('Invalid JSON');
    }

    // Step 2: Validate JSON-RPC envelope
    const validationError = validateRequest(parsed);
    if (validationError !== null) {
      return validationError;
    }

    const request = parsed as JsonRpcRequest;

    // Step 3: Route to method handler
    const handler = registry.get(request.method);
    if (handler === undefined) {
      return methodNotFound(request.id, request.method);
    }

    // Step 4: Execute handler
    try {
      const result = await handler(request.params, request.id);
      return {
        jsonrpc: '2.0',
        result,
        id: request.id,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return internalError(request.id, message);
    }
  };
}
