# Contributing to Limen

Thank you for your interest in contributing to Limen. This document provides guidelines for contributing to the project.

## Development Setup

### Prerequisites

- Node.js >= 22.0.0
- npm
- C++ build tools (for `better-sqlite3` native compilation)
  - macOS: `xcode-select --install`
  - Ubuntu/Debian: `sudo apt install build-essential python3`
  - Windows: Install Visual Studio Build Tools

### Getting Started

```bash
git clone https://github.com/solishq/limen.git
cd limen
npm install
npm run typecheck   # Verify TypeScript compilation
npm test            # Run test suite (~2,400 tests)
```

## Architecture

Limen uses a strict layered architecture:

```
L4: API Surface      — createLimen(), chat/infer pipelines, sessions, agents
L2: Orchestration    — Mission/task governance, 16 system calls
L1.5: Substrate      — Task scheduler, LLM gateway, provider adapters
L1: Kernel           — Database, audit trail, crypto, events
```

Higher layers depend on lower layers only. No layer bypasses are permitted.

### Key Constraints

- **Single production dependency**: `better-sqlite3`. This is enforced by CI. No additional runtime dependencies will be accepted.
- **99 invariants**: Core behavioral guarantees enforced by the test suite. See the README for the full list.
- **Frozen zones**: `src/kernel/interfaces/`, `src/api/syscalls/interfaces/`, and `src/orchestration/interfaces/orchestration.ts` are constitutionally protected. Changes require a formal amendment process.
- **Three-File Architecture**: Each subsystem follows the pattern: `interfaces/` (types), `harness/` (factory), `stores/` (implementation).

## Pull Request Process

1. Fork the repository and create a feature branch
2. Make your changes
3. Run the full verification suite:
   ```bash
   npm run typecheck   # Zero errors required
   npm run build       # Clean compilation required
   npm test            # All tests must pass
   ```
4. Submit a pull request against `main`

### PR Requirements

- All existing tests must pass
- New functionality must include tests
- No `@ts-ignore` or `as any` (enforced by CI)
- No new runtime dependencies (enforced by CI)
- TypeScript strict mode compliance (all strict flags enabled)

## Code Style

- TypeScript with maximum strictness (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)
- ESM modules (`"type": "module"`)
- All temporal logic uses `TimeProvider` — never direct `Date.now()`
- All errors at the API boundary use `LimenError` with typed error codes
- Zero `console.log` in source code — use the structured `LimenLogger` callback

## Reporting Issues

Please use GitHub Issues. Include:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Node.js version
- Operating system

## Security Vulnerabilities

Please report security vulnerabilities privately. See [SECURITY.md](SECURITY.md) for details.

## Developer Certificate of Origin

All contributions must be signed off under the [Developer Certificate of Origin (DCO)](https://developercertificate.org/). This certifies that you wrote the contribution or have the right to submit it under the Apache-2.0 license.

Sign off your commits with `git commit -s`:

```bash
git commit -s -m "Add streaming timeout configuration"
```

This adds a `Signed-off-by: Your Name <your@email.com>` line to the commit message. All commits in a pull request must be signed off.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
