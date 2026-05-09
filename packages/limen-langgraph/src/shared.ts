// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * @limen-ai/langgraph — Shared internals
 *
 * Filter logic (Claims 2.9–2.13, 3.10), namespace utilities (Claim 3.7),
 * canonical encoding, and operation type guards.
 */

import type {
  GetOperation,
  PutOperation,
  SearchOperation,
  ListNamespacesOperation,
  MatchCondition,
  Operation,
} from './types.js';

import { LimenStorageError } from './errors.js';
import { VALID_FILTER_OPS } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Canonical Encoding
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Encode chain entry payload as canonical JSON with sorted keys.
 *
 * Design doc §0.1 Glossary: "state_json" field name is historical — chain layer
 * accepts JSON encoding. This function produces deterministic JSON for chain entries.
 * F-08: Renamed from canonicalMsgpack to accurately reflect the encoding format.
 * F-LG-009: Keys are sorted recursively to ensure identical payloads produce
 * identical byte sequences regardless of property insertion order.
 */
export function canonicalJson(obj: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj, sortedKeyReplacer));
}

/**
 * JSON.stringify replacer that sorts object keys recursively.
 * Arrays pass through unchanged; only plain objects get sorted.
 */
function sortedKeyReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    );
  }
  return value;
}

/** @deprecated Use canonicalJson — renamed for accuracy (F-08) */
export const canonicalMsgpack = canonicalJson;

// ═══════════════════════════════════════════════════════════════════════════
// Namespace Utilities — Claim 3.7
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate namespace array against 5 rules (Claim 3.7).
 *
 * 1. Non-empty array
 * 2. All labels must be strings
 * 3. No empty strings
 * 4. No dots in labels
 * 5. Cannot start with "langgraph" (exact match on first element)
 */
export function validateNamespace(ns: string[]): void {
  // Rule 1: non-empty array
  if (!Array.isArray(ns) || ns.length === 0) {
    throw new LimenStorageError('Namespace must be a non-empty array');
  }

  for (let i = 0; i < ns.length; i++) {
    const label = ns[i];
    // Rule 2: all labels must be strings
    if (typeof label !== 'string') {
      throw new LimenStorageError(`Namespace label at index ${i} must be a string, got ${typeof label}`);
    }
    // Rule 3: no empty strings
    if (label === '') {
      throw new LimenStorageError(`Namespace label at index ${i} must not be empty`);
    }
    // Rule 4: no dots in labels
    if (label.includes('.')) {
      throw new LimenStorageError(`Namespace label "${label}" must not contain dots`);
    }
  }

  // Rule 5: cannot start with "langgraph" (exact match, not startsWith)
  if (ns[0] === 'langgraph') {
    throw new LimenStorageError('Namespace cannot start with "langgraph"');
  }
}

/** Join namespace array with dots for storage */
export function dotJoin(ns: string[]): string {
  return ns.join('.');
}

/** Split dot-joined namespace back to array */
export function splitNamespace(dotted: string): string[] {
  return dotted.split('.');
}

// ═══════════════════════════════════════════════════════════════════════════
// Filter Logic — Claims 2.9–2.13, 3.10
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a metadata/value object matches a filter specification.
 *
 * Claim 2.9: 8 operators — $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin.
 * Claim 2.10: Ordered ops use Number() coercion on both operands.
 * Claim 2.11: $in with non-array → false. $nin with non-array → true.
 * Claim 2.12: Unknown operators → false.
 * Claim 2.13: Mixed keys (operator + non-operator) → falls through to === equality.
 * Claim 3.10: Store search uses same filter logic as checkpoint list.
 */
export function matchesFilter(
  data: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  for (const [key, filterValue] of Object.entries(filter)) {
    const dataValue = data[key];

    if (filterValue !== null && typeof filterValue === 'object' && !Array.isArray(filterValue)) {
      // Check if ALL keys are valid filter operators (Claim 2.13)
      const filterObj = filterValue as Record<string, unknown>;
      const keys = Object.keys(filterObj);
      const allOps = keys.length > 0 && keys.every(k => (VALID_FILTER_OPS as readonly string[]).includes(k));

      if (allOps) {
        for (const [op, opValue] of Object.entries(filterObj)) {
          if (!compareValues(dataValue, op, opValue)) {
            return false;
          }
        }
      } else {
        // Claim 2.13: mixed keys → falls through to === equality
        if (dataValue !== filterValue) {
          return false;
        }
      }
    } else {
      if (dataValue !== filterValue) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Compare a value against a filter operator and operand.
 *
 * Claim 2.10: $gt, $gte, $lt, $lte use Number() coercion.
 * Claim 2.11: $in non-array → false, $nin non-array → true.
 * Claim 2.12: Unknown operator → false.
 */
export function compareValues(value: unknown, operator: string, operand: unknown): boolean {
  switch (operator) {
    case '$eq':
      return value === operand;
    case '$ne':
      return value !== operand;
    case '$gt':
      return Number(value) > Number(operand);
    case '$gte':
      return Number(value) >= Number(operand);
    case '$lt':
      return Number(value) < Number(operand);
    case '$lte':
      return Number(value) <= Number(operand);
    case '$in':
      return Array.isArray(operand) ? operand.includes(value) : false;
    case '$nin':
      return Array.isArray(operand) ? !operand.includes(value) : true;
    default:
      return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MatchCondition evaluation — Claim 3.17
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a namespace matches all conditions.
 *
 * Claim 3.17: prefix matches start, suffix matches end, "*" matches any component.
 */
export function matchesConditions(ns: string[], conditions: MatchCondition[]): boolean {
  return conditions.every(cond => matchesSingleCondition(ns, cond));
}

function matchesSingleCondition(ns: string[], cond: MatchCondition): boolean {
  const { matchType, path } = cond;

  if (matchType === 'prefix') {
    if (path.length > ns.length) return false;
    return path.every((p, i) => p === '*' || p === ns[i]);
  }

  if (matchType === 'suffix') {
    if (path.length > ns.length) return false;
    const offset = ns.length - path.length;
    return path.every((p, i) => p === '*' || p === ns[offset + i]);
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Operation Type Guards
// ═══════════════════════════════════════════════════════════════════════════

export function isGetOp(op: Operation): op is GetOperation {
  return 'key' in op && 'namespace' in op && !('value' in op) && !('namespacePrefix' in op);
}

export function isPutOp(op: Operation): op is PutOperation {
  return 'key' in op && 'namespace' in op && 'value' in op;
}

export function isSearchOp(op: Operation): op is SearchOperation {
  return 'namespacePrefix' in op;
}

/**
 * Type guard for ListNamespacesOperation.
 *
 * F-LG-008: Tightened guard — requires at least one of `matchConditions` or
 * `maxDepth` to be present. An object with only `limit` (and no `namespace`
 * or `namespacePrefix`) could be ambiguous. If a consumer needs a "list all
 * with only limit," they must include `matchConditions: undefined` or
 * `maxDepth: undefined` explicitly in the operation object.
 */
export function isListNsOp(op: Operation): op is ListNamespacesOperation {
  return !('key' in op) && !('namespacePrefix' in op) && ('matchConditions' in op || 'maxDepth' in op);
}
