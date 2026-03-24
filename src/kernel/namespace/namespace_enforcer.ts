/**
 * Table namespace enforcement implementation.
 * S ref: C-09
 *
 * Phase: 1 (Kernel) -- Build Order 2
 * Must exist before any table is created.
 *
 * C-09: Every table must have a namespace prefix:
 *       core_, memory_, agent_, obs_, hitl_, meter_
 *
 * Validates migration SQL to ensure all CREATE TABLE and ALTER TABLE
 * statements use valid namespace prefixes.
 */

import type { Result, NamespacePrefix } from '../interfaces/index.js';
import type { NamespaceEnforcer } from '../interfaces/namespace.js';

/** Valid namespace prefixes per C-09 */
const VALID_PREFIXES: readonly NamespacePrefix[] = [
  'core_', 'memory_', 'agent_', 'obs_', 'hitl_', 'meter_', 'gov_',
] as const;

/**
 * Regex to extract table names from CREATE TABLE and ALTER TABLE statements.
 * Handles: CREATE TABLE name, CREATE TABLE IF NOT EXISTS name,
 *          ALTER TABLE name, CREATE INDEX ... ON name
 * S ref: C-09 (namespace enforcement on all table operations)
 */
const TABLE_NAME_PATTERNS = [
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))/gi,
  /ALTER\s+TABLE\s+(?:"([^"]+)"|(\w+))/gi,
  /CREATE\s+(?:UNIQUE\s+)?INDEX\s+\S+\s+ON\s+(?:"([^"]+)"|(\w+))/gi,
];

/**
 * Extract all table names referenced in SQL statements.
 * S ref: C-09 (identify tables for validation)
 */
function extractTableNames(sql: string): string[] {
  const names: string[] = [];

  for (const pattern of TABLE_NAME_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql)) !== null) {
      // Capture group 1 = quoted name, capture group 2 = unquoted name
      const name = match[1] ?? match[2];
      if (name) {
        names.push(name);
      }
    }
  }

  return names;
}

/**
 * Check if a table name starts with a valid namespace prefix.
 * S ref: C-09 (valid prefixes)
 */
function hasValidPrefix(tableName: string): boolean {
  return VALID_PREFIXES.some(prefix => tableName.startsWith(prefix));
}

/**
 * Create a NamespaceEnforcer implementation.
 * S ref: C-09 (namespace enforcement)
 */
export function createNamespaceEnforcer(): NamespaceEnforcer {
  return {
    /**
     * Validate that migration SQL only creates/alters tables with valid prefixes.
     * S ref: C-09 (namespace validation on migration)
     */
    validateMigration(sql: string): Result<void> {
      const tableNames = extractTableNames(sql);

      for (const name of tableNames) {
        if (!hasValidPrefix(name)) {
          return {
            ok: false,
            error: {
              code: 'NAMESPACE_VIOLATION',
              message: `Table "${name}" does not have a valid namespace prefix. Valid prefixes: ${VALID_PREFIXES.join(', ')}`,
              spec: 'C-09',
            },
          };
        }
      }

      return { ok: true, value: undefined };
    },

    /**
     * Check if a table name has a valid namespace prefix.
     * S ref: C-09 (valid prefixes: core_, memory_, agent_, obs_, hitl_, meter_)
     */
    isValidTableName(tableName: string): boolean {
      return hasValidPrefix(tableName);
    },
  };
}
