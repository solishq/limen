/**
 * Verifies: §3.1, §4 I-01, §42 C-01
 * Phase: 1 (Kernel)
 * Agent: Verification Engineer (Team D)
 *
 * Tests derived from the Limen specification.
 * No implementation exists at time of writing — tests define the contract.
 *
 * I-01: Single Production Dependency.
 * "The runtime dependency set is { better-sqlite3 }. ONNX Runtime is an optional
 * peer dependency for offline embedding mode only, installed by the consumer when
 * needed. No dependency added without Genesis-level review."
 *
 * §3.1: "Production dependency: better-sqlite3. ONNX Runtime optional for offline
 * mode. No Redis, Kafka, PostgreSQL, vector databases, or external services."
 *
 * C-01: "Production dep: better-sqlite3. ONNX optional peer."
 *
 * VERIFICATION STRATEGY:
 * The invariant guarantees a minimal dependency surface. We verify this by inspecting
 * the package.json manifest — the single source of truth for Node.js dependencies.
 * This is a structural invariant: it constrains the build artifact, not runtime behavior.
 * Therefore, the correct verification approach is static analysis of the dependency
 * declaration, not runtime import testing.
 *
 * ASSUMPTIONS:
 * - ASSUMPTION A01-1: package.json is located at the repository root relative to
 *   the test file (../../package.json). This is standard Node.js convention and
 *   matches the standard Node.js repository structure.
 * - ASSUMPTION A01-2: "production dependency" means entries in the "dependencies"
 *   field of package.json, not "devDependencies" or "peerDependencies". This is
 *   standard npm semantics and aligns with §3.1's distinction between production
 *   and optional dependencies.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Read and parse the package.json manifest.
 * §3.1, I-01, C-01: The dependency set is the authoritative record.
 */
function loadPackageJson(): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
} {
  const pkgPath = resolve(__dirname, '..', '..', 'package.json');
  const raw = readFileSync(pkgPath, 'utf-8');
  return JSON.parse(raw);
}

describe('I-01: Single Production Dependency', () => {
  // ─── POSITIVE: The invariant holds under normal conditions ───

  it('production dependencies contain exactly { better-sqlite3 }', () => {
    /**
     * §4 I-01: "The runtime dependency set is { better-sqlite3 }."
     * This is the canonical positive assertion. The set must contain
     * better-sqlite3 and nothing else.
     */
    const pkg = loadPackageJson();
    const deps = pkg.dependencies ?? {};
    const depNames = Object.keys(deps);

    assert.equal(depNames.length, 1,
      `I-01 violation: Expected exactly 1 production dependency, found ${depNames.length}: [${depNames.join(', ')}]`
    );
    assert.ok(depNames.includes('better-sqlite3'),
      'I-01 violation: The single production dependency must be better-sqlite3'
    );
  });

  it('better-sqlite3 version spec is present and valid', () => {
    /**
     * §4 I-01: better-sqlite3 must be a declared dependency.
     * A missing or empty version string would indicate a malformed manifest.
     */
    const pkg = loadPackageJson();
    const deps = pkg.dependencies ?? {};
    const version = deps['better-sqlite3'];

    assert.ok(version !== undefined,
      'I-01 violation: better-sqlite3 must be declared in dependencies'
    );
    assert.ok(typeof version === 'string' && version.length > 0,
      'I-01 violation: better-sqlite3 version specifier must be a non-empty string'
    );
  });

  // ─── NEGATIVE: Attempts to violate the invariant are detectable ───

  it('no additional production dependencies exist beyond better-sqlite3', () => {
    /**
     * §4 I-01: "No dependency added without Genesis-level review."
     * §3.1: "No Redis, Kafka, PostgreSQL, vector databases, or external services."
     *
     * This test would detect if someone added an unauthorized dependency.
     * The forbidden list is derived from §3.1's explicit exclusions.
     */
    const pkg = loadPackageJson();
    const deps = pkg.dependencies ?? {};
    const depNames = Object.keys(deps);

    const forbidden = [
      'redis', 'ioredis',         // §3.1: No Redis
      'kafkajs', 'kafka-node',    // §3.1: No Kafka
      'pg', 'postgres',           // §3.1: No PostgreSQL
      'mysql2', 'mariadb',        // §3.1: No external databases
      'pinecone', 'chromadb',     // §3.1: No vector databases
      'weaviate-ts-client',       // §3.1: No vector databases
      'axios', 'node-fetch',      // §3.1: No external services (raw HTTP via Node built-ins)
    ];

    for (const dep of depNames) {
      assert.ok(!forbidden.includes(dep),
        `I-01 violation: Forbidden dependency "${dep}" found in production dependencies. §3.1 prohibits external services.`
      );
    }
  });

  it('ONNX runtime is NOT a production dependency', () => {
    /**
     * §4 I-01: "ONNX Runtime is an optional peer dependency for offline embedding
     * mode only, installed by the consumer when needed."
     *
     * ONNX must NOT appear in dependencies. It may appear in peerDependencies
     * or optionalDependencies (both are consumer-installed).
     */
    const pkg = loadPackageJson();
    const deps = pkg.dependencies ?? {};

    assert.ok(!('onnxruntime-node' in deps),
      'I-01 violation: onnxruntime-node must not be a production dependency — it is an optional peer only'
    );
    assert.ok(!('onnxruntime-web' in deps),
      'I-01 violation: onnxruntime-web must not be a production dependency'
    );
  });

  // ─── EDGE CASES: Boundary conditions ───

  it('devDependencies do not leak into production dependency field', () => {
    /**
     * Edge case: a devDependency accidentally placed in dependencies would
     * violate I-01. TypeScript, test tooling, and type definitions are
     * development-only concerns.
     */
    const pkg = loadPackageJson();
    const deps = pkg.dependencies ?? {};
    const depNames = Object.keys(deps);

    const devOnlyPatterns = [
      /^@types\//,     // Type definitions are dev-only
      /^typescript$/,  // Compiler is dev-only
      /^eslint/,       // Linting is dev-only
      /^prettier$/,    // Formatting is dev-only
      /^vitest$/,      // Test frameworks violate C-04 anyway
      /^jest$/,        // Test frameworks violate C-04 anyway
    ];

    for (const dep of depNames) {
      for (const pattern of devOnlyPatterns) {
        assert.ok(!pattern.test(dep),
          `I-01 violation: "${dep}" appears to be a dev dependency incorrectly placed in production dependencies`
        );
      }
    }
  });

  it('dependencies field exists in package.json', () => {
    /**
     * Edge case: if the dependencies field is missing entirely, the engine
     * cannot function (better-sqlite3 would not be installed).
     */
    const pkg = loadPackageJson();
    assert.ok('dependencies' in pkg,
      'I-01 violation: package.json must have a "dependencies" field declaring better-sqlite3'
    );
  });
});
