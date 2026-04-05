# Dependency Response Plan

## better-sqlite3 (sole production dependency)

### If critical vulnerability discovered:
1. Check if the vuln affects Limen's usage patterns (WAL mode, in-process only)
2. If affected: update immediately, run full test suite, publish patch
3. If not affected: document assessment, update on next regular cycle

### If EOL announced:
1. Evaluate alternatives: sql.js (WebAssembly), bun:sqlite, node:sqlite (experimental)
2. Limen's SQLite interface is abstracted through substrate/database_lifecycle.ts
3. Migration path: implement new adapter behind the abstraction, run compatibility tests
4. Timeline: 6 months from EOL announcement to migration

### If unavailable (npm registry issue):
1. Lockfile pins exact version -- existing installs continue to work
2. For new installs: use npm cache or alternative registry mirror
3. No Limen code change needed

## sqlite-vec (optional dependency)

### If unavailable:
1. Limen degrades gracefully -- vector search disabled, core features unaffected
2. No action required unless vector search is critical to consumers

## @langchain/core (peer dependency, limen-langchain workspace only)

### If vulnerability in transitive langsmith:
1. Update @langchain/core peer dependency constraint to version range excluding vulnerable langsmith
2. Run `npm audit` to verify resolution
3. Core limen-ai package is unaffected -- vulnerability is isolated to workspace package
