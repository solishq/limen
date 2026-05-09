// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
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
 * F-BR5 Loopback: the suite is pinned to single-file execution
 * (`fileParallelism: false`). Every test in every file spawns a child
 * CLI process that opens its own SQLite database in its own temp
 * dataDir. Running multiple files in parallel does not cause dataDir
 * collisions, but it does multiply the number of concurrent child
 * processes the system must schedule, which inflates engine bootstrap
 * latency and exposes the SQLite WAL contention retry path in runCli
 * to transient failures. Observed under the F-BR5 sweep as a
 * sporadic FP-FP06-001 disputed=false → true flip ONLY when all five
 * suite files run in parallel (isolated runs of knowledge.test.ts or
 * FP-06 alone passed reliably). Pinning to single-file execution
 * removes an entire class of flakiness without changing what the
 * tests exercise. Tradeoff: wall-clock time rises from ~160s parallel
 * to ~270s serialized — acceptable for an integration suite that
 * must be reliable.
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
    // vitest 4.x: disable inter-file parallelism. Matches
    // `--no-file-parallelism` on the CLI. Without this, the five CLI
    // integration files race on SQLite WAL contention and produce a
    // sporadic FP-FP06-001 disputed=false → true flip under load.
    fileParallelism: false,
    // vitest 4 flattened poolOptions to the top level. Single-thread
    // execution prevents sibling tests within a file from magnifying
    // engine bootstrap latency past the retry window in runCli.
    pool: 'threads',
    singleThread: true,
  },
};
