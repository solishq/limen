/**
 * Vitest config for the Limen CLI integration suite.
 *
 * F-BR4 Loopback: the CLI tests are integration tests that shell out
 * to `node dist/cli.js` for every assertion. Engine bootstrap alone
 * takes ~300-700ms per invocation, and retries on SQLite WAL contention
 * can compound that. The vitest default testTimeout of 5000ms is too
 * tight for this workload after the F-BR4-001 init-required invariant
 * adds one extra `init` call per suite plus four extra `init` calls in
 * health-cognitive. Raising the default here is simpler and safer than
 * retro-fitting timeouts onto every existing test.
 *
 * Note: vitest is invoked via `npx -y vitest@4.1.4` and is not a local
 * devDependency, so this file deliberately avoids importing from
 * 'vitest/config' (which would require a local install). Vitest auto-
 * detects a plain object default export.
 */
export default {
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
};
