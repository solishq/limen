<!-- @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md S5.1 -->

# Limen v5 Deployment Strategy

## 1. CI/CD Pipeline

The release pipeline is `scripts/release-pipeline.sh`. It is a single script executing 5 sequential stages with fail-fast semantics:

| Stage | Gate | What It Does | Failure = |
|-------|------|-------------|-----------|
| 1. VALIDATE | SolisForge compliance | Runs `solisforge-traceability-scanner.sh --ci` + contract hash verification | Non-compliant artifact |
| 2. BUILD | TypeScript compilation | `npx tsc --noEmit` with zero errors | Type-system violation |
| 3. TEST | Full test suite | `npm test` with 0 failures across 4,678+ tests | Behavioral regression |
| 4. PACK | Artifact production | `npm pack` produces versioned `.tgz` tarball | Packaging defect |
| 5. VERIFY | Smoke test | Installs tarball in clean temp project, runs `createLimen() -> remember -> recall -> health` | Integration failure |

**Invocation:**

```bash
bash scripts/release-pipeline.sh [--version 5.0.0-rc.1]
```

**Output:** `dist/limen-ai-{version}.tgz` -- a locally installable npm package artifact.

The pipeline does NOT publish to npm. Publication is a separate, explicit step requiring PA (Principal Authority) approval and OTP.

---

## 2. Progressive Rollout

Limen is a library, not a service. Rollout is progressive through artifact distribution channels:

### Stage 1: Local Link (Development)

```bash
# In the Limen repo
npm link

# In the consuming project
npm link limen-ai
```

Use for active development. Changes are reflected immediately. No version pinning.

### Stage 2: Tarball (Integration Testing)

```bash
# Produce the artifact
bash scripts/release-pipeline.sh

# Install in test project
npm install /path/to/dist/limen-ai-5.0.0.tgz
```

Use for integration testing across projects. The tarball is the exact artifact that would be published. This is the current distribution method for all SolisHQ projects.

### Stage 3: npm Publish (Distribution)

```bash
# Only after PA approval
npm publish dist/limen-ai-5.0.0.tgz --tag canary
```

- **canary tag**: First publish goes to `canary` tag, not `latest`. Consumers must explicitly opt in: `npm install limen-ai@canary`.
- **latest tag**: After canary validation period, promote: `npm dist-tag add limen-ai@5.0.0 latest`.
- **OTP required**: npm publish requires one-time password from authenticator.

---

## 3. Feature Flags

**Not applicable.** Limen is an embedded library, not a running service. There is no runtime feature flag infrastructure because:

- All capabilities are available at compile time through the TypeScript API surface.
- Consumers control which features they use by calling (or not calling) specific API methods.
- The engine configuration object (`createLimen(config)`) is the feature control mechanism -- PII detection, injection protection, rate limiting, and security policies are all config-driven.
- Version pinning in `package.json` is the rollout control -- consumers choose when to upgrade.

---

## 4. One-Click Rollback

Rollback to the previous stable version:

```bash
git checkout main && npm ci && npm run build
```

**Full procedure** (documented in `docs/CONTINUITY-ARTIFACT.md` Section 6):

1. **Stop** the running Limen MCP server process.
2. **Checkout** the stable branch: `git checkout main` (main tracks the latest stable release).
3. **Reinstall** dependencies: `npm ci` (deterministic install from lockfile).
4. **Rebuild**: `npm run build`.
5. **Verify**: `npm test` -- confirm all tests pass.
6. **Restart** the MCP server with the previous configuration.

**Maximum rollback time:** Under 5 minutes (checkout + install + build + verify).

**Data preservation:** The SQLite database is backward-compatible. v5 adds new tables and columns but does not alter or remove v4 schema elements. A v4 server ignores v5-only tables. No data migration is required for rollback.

**Consumer rollback** (for npm-installed consumers):

```bash
npm install limen-ai@4.0.0  # Pin to previous version
```

---

## 5. Environment Parity

Limen achieves environment parity through architectural simplicity:

**Single artifact, single dependency:** The entire engine state lives in one SQLite database file. There is no external database, no message queue, no cache layer, no configuration service. The same `.tgz` artifact runs identically on:

| Environment | Database | Behavior |
|-------------|----------|----------|
| Developer laptop (macOS) | `./limen.db` | Identical |
| CI runner (Linux) | `/tmp/test-limen.db` | Identical |
| Production server (Linux) | `/var/lib/app/limen.db` | Identical |
| Docker container | `/data/limen.db` | Identical |

**What varies between environments:**

- `dataDir` path -- where the SQLite file lives
- `masterKey` -- encryption key (must match per database)
- LLM provider API keys -- optional, only for verification features

**What does NOT vary:**

- Schema (created on first run, migrated automatically)
- Query behavior (SQLite WAL mode, same engine)
- Security policies (configured in code, not environment)
- Test suite (runs against same engine with same assertions)

---

## 6. Automated Gates

Three automated gates prevent defective artifacts from reaching any distribution channel:

### Gate 1: SolisForge Validator

```bash
bash scripts/solisforge-traceability-scanner.sh --ci
```

Verifies:
- All source files have `@governance` and `@traceability` markers
- Contract references resolve to ratified documents
- No orphan code (code without governance traceability)

**Failure mode:** `NON-COMPLIANT` exit code blocks Stage 1 of the release pipeline.

### Gate 2: Contract Hash Verification

```bash
bash scripts/verify-contract-hashes.sh
```

Verifies:
- All 14 ratified contracts match their recorded SHA-256 hashes
- The machine-readable manifest (`contracts/phase-x.contracts.json`) is consistent
- No unauthorized contract modifications

**Failure mode:** Hash mismatch blocks the pipeline and requires investigation (potential tampering or unauthorized amendment).

### Gate 3: Test Suite

```bash
npm test
```

Verifies:
- 4,678+ tests pass with 0 failures
- Behavioral contracts enforced (not just code coverage)
- Mutation testing baseline maintained (Stryker, when run)

**Failure mode:** Any test failure blocks Stage 3 of the release pipeline. No partial passes.

### Pre-Merge Workflow

Before any merge to `release/v5` or `main`:

1. Run all three gates locally
2. Verify contract hashes (guards against local contract drift)
3. Run the full release pipeline as a dry-run validation
4. Peer review (or Breaker/Certifier pipeline for governed phases)
