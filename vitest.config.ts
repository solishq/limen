// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Root vitest config for the Limen monorepo.
 *
 * All root-level tests use node:test (run via `npm test` / `npx tsx --test`).
 * Only packages/limen-cli has vitest tests (with its own vitest.config.ts).
 *
 * This config exists solely to prevent `npx vitest run` from root from
 * discovering node:test files and reporting hundreds of phantom failures.
 *
 * Test commands:
 *   npm test                                 — all node:test tests via tsx
 *   cd packages/limen-cli && npx vitest run  — CLI integration tests (vitest)
 */
export default {
  test: {
    include: [],
    exclude: ['**/*'],
  },
};
