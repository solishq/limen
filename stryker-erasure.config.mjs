// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
// Focused config: erasure_engine.ts only — baseline validation run
export default {
  mutate: ['src/governance/compliance/erasure_engine.ts'],

  ignorePatterns: [
    'docs/**',
    'dist/**',
    'node_modules/**',
    '.stryker-cache/**',
    '.stryker-tmp/**',
    'packages/**',
    'examples/**',
  ],

  disableTypeChecks: 'src/**/*.ts',

  testRunner: 'command',
  commandRunner: {
    command: 'npx tsx --test tests/mutation/erasure_mutation_kill.test.ts tests/breaker/gdpr_erasure_breaker.test.ts tests/unit/phase10_governance.test.ts tests/scaffold/invariants/i02_user_owns_data.test.ts tests/scaffold/invariants/i03_atomic_audit.test.ts tests/scaffold/invariants/i06_audit_immutability.test.ts tests/gap/test_gap_004_audit_tamper.test.ts',
  },

  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',

  reporters: ['json', 'clear-text', 'progress'],
  jsonReporter: {
    fileName: 'docs/verification/mutation/stryker-erasure-report.json',
  },

  thresholds: { high: 90, low: 70, break: 60 },
  timeoutMS: 30000,
  timeoutFactor: 2,
  concurrency: 2,
  incremental: false,
};
