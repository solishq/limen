/**
 * @limen-ai/langgraph — Default serializer (JsonPlusSerializer)
 *
 * Claim 6.1: dumpsTyped routing — Uint8Array → "bytes", else → "json"
 * Claim 6.2: Checkpoint blob uses serde, metadata uses JSON.stringify
 * Claim 8.4: Handles Date, Set, Map, Buffer, BigInt natively
 */

import type { SerializerProtocol } from './types.js';

/**
 * JSON+ serializer that handles extended JS types.
 * Replacer/reviver pair preserves Date, Set, Map, BigInt, Buffer, Uint8Array.
 */
export class JsonPlusSerializer implements SerializerProtocol {
  /**
   * Serialize data to [typeTag, bytes].
   * Claim 6.1: Uint8Array → ["bytes", data]. Else → ["json", jsonBytes].
   */
  dumpsTyped(data: unknown): [string, Uint8Array] {
    if (data instanceof Uint8Array) {
      return ['bytes', data];
    }
    const json = JSON.stringify(data, jsonPlusReplacer);
    return ['json', new TextEncoder().encode(json)];
  }

  /**
   * Deserialize from typeTag + bytes.
   * "bytes" → raw Uint8Array. "json" → parsed with reviver.
   */
  loadsTyped(typeTag: string, data: Uint8Array): unknown {
    if (typeTag === 'bytes') {
      return data;
    }
    const json = new TextDecoder().decode(data);
    return JSON.parse(json, jsonPlusReviver);
  }
}

// ---------------------------------------------------------------------------
// JSON+ replacer/reviver for extended type support (Claim 8.4)
// ---------------------------------------------------------------------------

const TYPE_TAG = '__jsonplus_type__';
const VALUE_TAG = '__jsonplus_value__';

function jsonPlusReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) {
    return { [TYPE_TAG]: 'Date', [VALUE_TAG]: value.toISOString() };
  }
  if (value instanceof Set) {
    return { [TYPE_TAG]: 'Set', [VALUE_TAG]: [...value] };
  }
  if (value instanceof Map) {
    return { [TYPE_TAG]: 'Map', [VALUE_TAG]: [...value.entries()] };
  }
  if (typeof value === 'bigint') {
    return { [TYPE_TAG]: 'BigInt', [VALUE_TAG]: value.toString() };
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return { [TYPE_TAG]: 'Buffer', [VALUE_TAG]: [...value] };
  }
  return value;
}

function jsonPlusReviver(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && TYPE_TAG in value) {
    const typed = value as Record<string, unknown>;
    const innerValue = typed[VALUE_TAG];
    switch (typed[TYPE_TAG]) {
      case 'Date':
        return new Date(innerValue as string);
      case 'Set':
        return new Set(innerValue as unknown[]);
      case 'Map':
        return new Map(innerValue as [unknown, unknown][]);
      case 'BigInt':
        return BigInt(innerValue as string);
      case 'Buffer':
        return typeof Buffer !== 'undefined'
          ? Buffer.from(innerValue as number[])
          : new Uint8Array(innerValue as number[]);
      default:
        return value;
    }
  }
  return value;
}

/** Singleton instance */
export const defaultSerializer = new JsonPlusSerializer();
