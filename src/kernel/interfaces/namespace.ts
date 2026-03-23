/**
 * Namespace enforcer interface types.
 * S ref: C-09
 *
 * Phase: 1 (Kernel)
 * Implements: Table namespace prefix validation for all migrations.
 *
 * C-09: Every table must have a namespace prefix:
 *       core_, memory_, agent_, obs_, hitl_, meter_
 */

import type { Result } from './common.js';

// ─── Namespace Enforcer Interface ───

/**
 * Table namespace prefix enforcer.
 * Validates that all table operations use valid C-09 namespace prefixes.
 * S ref: C-09 (namespace enforcement)
 */
export interface NamespaceEnforcer {
  /**
   * Validate that migration SQL only creates/alters tables with valid prefixes.
   * Rejects any CREATE TABLE or ALTER TABLE that uses an invalid prefix.
   * S ref: C-09 (namespace validation on migration)
   */
  validateMigration(sql: string): Result<void>;

  /**
   * Check if a table name has a valid namespace prefix.
   * S ref: C-09 (valid prefixes: core_, memory_, agent_, obs_, hitl_, meter_)
   */
  isValidTableName(tableName: string): boolean;
}
