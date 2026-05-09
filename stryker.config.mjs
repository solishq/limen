// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  // Target QAL-4 critical modules first, then QAL-3
  mutate: [
    // QAL-4: Governance (compliance, classification, harness, stores)
    'src/governance/**/*.ts',
    // QAL-4: Cryptographic operations
    'src/kernel/crypto/**/*.ts',
    // QAL-4: Audit trail (hash-chain, append-only)
    'src/kernel/audit/**/*.ts',
    // QAL-4: RBAC engine
    'src/kernel/rbac/**/*.ts',
    // QAL-3: Claims (knowledge integrity)
    'src/claims/**/*.ts',
    // QAL-3: Budget governor (resource control)
    'src/budget/**/*.ts',
    // QAL-3: Security layer
    'src/security/**/*.ts',
    // Exclude types/interfaces from mutation
    '!src/**/types.ts',
    '!src/**/interfaces/**',
  ],

  // Exclude non-source directories from sandbox processing
  ignorePatterns: [
    'docs/**',
    'dist/**',
    'node_modules/**',
    '.stryker-cache/**',
    '.stryker-tmp/**',
    'packages/**',
    'examples/**',
    '*.html',
  ],

  // Disable type-checks preprocessing for non-TS files
  disableTypeChecks: 'src/**/*.ts',

  // Node.js built-in test runner via tsx
  testRunner: 'command',
  commandRunner: {
    command: 'npx tsx --test tests/breaker/gdpr_erasure_breaker.test.ts tests/contract/test_contract_ccp_governance.test.ts tests/unit/phase10_governance.test.ts tests/rbac/rbac_enforcement.test.ts tests/scaffold/invariants/i02_user_owns_data.test.ts tests/scaffold/invariants/i03_atomic_audit.test.ts tests/scaffold/invariants/i06_audit_immutability.test.ts tests/gap/test_gap_004_audit_tamper.test.ts tests/gap/test_gap_007_checkpoint_governance.test.ts tests/gap/test_gap_017_governance_completion.test.ts tests/contract/test_contract_governance_cross_cutting.test.ts tests/contract/test_contract_governance_ids.test.ts tests/contract/test_governance_migrations.test.ts tests/contract/test_phase4_governance_wiring.test.ts tests/architectural/audit_coverage.test.ts tests/unit/phase9_security.test.ts',
  },

  // TypeScript type checking
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',

  // Reporters
  reporters: ['html', 'json', 'clear-text', 'progress'],
  jsonReporter: {
    fileName: 'docs/verification/mutation/stryker-report.json',
  },
  htmlReporter: {
    fileName: 'docs/verification/mutation/stryker-report.html',
  },

  // QAL-4 thresholds
  thresholds: {
    high: 90,   // QAL-4 target
    low: 70,    // Warning level
    break: 60,  // CI break threshold (initial baseline — will raise)
  },

  // Performance
  timeoutMS: 30000,
  timeoutFactor: 2,
  concurrency: 2,

  // Incremental mode for faster re-runs
  incremental: true,
  incrementalFile: '.stryker-cache/incremental.json',

  // Mutation level — standard mutations
  mutator: {
    excludedMutations: [],
  },
};
