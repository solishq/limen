# Deep Code Fix Orchestrator

## Description
Comprehensive prompt for orchestrating a full-depth codebase audit, planning, and implementation cycle. Designed to be used by a senior engineering lead who needs to find and fix every production-impacting bug with zero regressions. This is not a review — it is a search-and-destroy operation against implementation defects.

## Invocation
```
/deep-code-fix-orchestrator [scope] [mode]
```
- `scope`: `full` | `kernel` | `api` | `transport` | `security` | `cognitive` | `orchestration` | specific file path
- `mode`: `audit-only` (report findings, no changes) | `plan-only` (report + plan, no changes) | `execute` (full cycle: find, plan, fix, verify, ship)
- Default: `full execute`

---

## PHASE 0: ORIENTATION (Do Not Skip)

Before touching a single line of code, build a mental model of the entire system. This is non-negotiable.

### 0.1 Codebase Cartography
1. Read `package.json`, `tsconfig.json`, and all build/test configuration
2. Map the module dependency graph — which layers depend on which
3. Identify the public API surface (exports, entry points, factory functions)
4. Identify the database schema and migration history
5. Count: source files, test files, lines of code, dependencies
6. Identify the test runner, assertion style, and test categories

### 0.2 Architecture Fingerprint
Answer these questions from code, not docs:
- What is the layering model? (e.g., kernel → substrate → orchestration → API)
- Where does state live? (database, in-memory maps, closures, module-level singletons)
- What is the concurrency model? (single-threaded, worker pool, async I/O)
- What is the error model? (Result types, exceptions, error codes, or mixed)
- What is the immutability model? (Object.freeze, readonly types, or mutable)
- What is the testing model? (unit, integration, contract, property-based, adversarial)

### 0.3 Blast Radius Map
Before ANY changes, identify:
- Which files have the most dependents (most dangerous to modify)
- Which tests cover which modules (what will catch regressions)
- Which modules are frozen/stable vs actively developed
- Whether there are integration tests that span multiple modules

**Output:** Written orientation document with architecture diagram, module map, and blast radius assessment. This document guides every subsequent decision.

---

## PHASE 1: DEEP AUDIT (8 Parallel Investigation Tracks)

Launch 8 specialized investigation agents in parallel. Each agent has a specific adversarial lens and a specific set of mechanistic checks. No agent overlaps with another. Each agent reads actual source code — never documentation, never comments, never README.

### Track 1: Type & Validation Boundary
**Adversarial lens:** "What inputs can slip past validation and reach arithmetic, SQL, or file operations?"

Mechanistic checks:
- [ ] For every `confidence`, `score`, `probability`, `ratio` parameter: does validation reject `NaN`? (NaN > 0 is false, NaN < 1 is false, NaN >= 0 is false, Number.isFinite(NaN) is false)
- [ ] For every numeric range check: is it `>= 0 && <= 1` (rejects NaN correctly) or is it `!(x < 0) && !(x > 1)` (passes NaN)?
- [ ] For every `parseInt` call: is the radix parameter present? (`parseInt('08')` is 0 in old engines)
- [ ] For every `typeof x === 'object'` check: is null excluded? (`typeof null === 'object'`)
- [ ] For every `JSON.parse` of user input: is `__proto__` / `constructor` / `prototype` handled?
- [ ] For every string-to-number conversion: what happens with `''`, `' '`, `'Infinity'`, `'NaN'`, `'0x1'`?
- [ ] For every Date constructor/parse: what happens with invalid date strings?
- [ ] For every array index access: what happens with negative indices, non-integer indices, out-of-bounds?
- [ ] For every template literal used in SQL/shell/URL: is it parameterized?

**Output format:**
```
| Entry Point | Parameter | Validation | NaN-safe | Null-safe | Injection-safe | Verdict |
```

### Track 2: Lifecycle & Resource Management
**Adversarial lens:** "What grows without bound? What leaks? What never gets cleaned up?"

Mechanistic checks:
- [ ] For every `new Map()` / `new Set()` / `[]` in module scope or closure: what adds to it? What removes? What bounds it?
- [ ] For every `setInterval` / `setTimeout`: where is `clearInterval` / `clearTimeout`? Is it in a `finally`? Is the reference stored?
- [ ] For every event listener registration (`.on()`, `.addEventListener()`, `.subscribe()`): where is the corresponding removal?
- [ ] For every `open()` / `connect()` / `createReadStream()`: where is `close()` / `destroy()`? Is it in a `finally`?
- [ ] For every cache/pool/queue: what is the max size? What happens when full? Is there TTL/LRU eviction?
- [ ] For every database connection obtained in a closure: does the closure outlive the operation?
- [ ] For every `unref()` call on timers: is the timer actually optional, or will skipping it cause data loss?
- [ ] For every `destroy()` / `close()` / `shutdown()` method: is it idempotent? What happens if called twice?
- [ ] For every constructor that allocates resources: is there a corresponding destructor? Is it documented?

**Output format:**
```
| Resource | File:Line | Created By | Destroyed By | Bounded | Max Size | TTL | Leak Risk |
```

### Track 3: Cross-Location Consistency
**Adversarial lens:** "Is the same concept implemented the same way everywhere?"

Mechanistic checks:
- [ ] Distance-to-similarity conversion: collect ALL formulas, compare
- [ ] Cost/token calculation: collect ALL formulas, compare
- [ ] Timestamp formatting: collect ALL format strings, compare
- [ ] ID generation: collect ALL methods (randomUUID, nanoid, counter), compare
- [ ] Error code semantics: same code, same meaning everywhere?
- [ ] Tenant ID null handling: `IS NULL` vs `= NULL` vs `?? null` — consistent?
- [ ] Transaction boundaries: same pattern (transaction wrapper) used everywhere?
- [ ] Retry/backoff: same algorithm, same constants everywhere?
- [ ] Config resolution: same defaults, same override order everywhere?
- [ ] Permission strings: same string constants, no typos?

**Output format:**
```
| Concept | Location A | Location B | Formula/Pattern A | Formula/Pattern B | Consistent? |
```

### Track 4: Atomicity & Crash Recovery
**Adversarial lens:** "If the process crashes between any two lines, what breaks?"

Mechanistic checks:
- [ ] For every multi-step mutation: is it wrapped in a transaction?
- [ ] For every transaction: does it cover ALL the steps, or just some?
- [ ] For every flag-based guard (set flag → do work → clear flag): what if crash after set, before clear?
- [ ] For every read-then-write: can a concurrent operation change the data between read and write?
- [ ] For every "write to external system then update local state": what if external succeeds but local fails?
- [ ] For every audit/log entry: is it in the same transaction as the audited mutation?
- [ ] For every archive/cleanup operation: is the delete in the same transaction as the archive record?
- [ ] For startup recovery: does the system detect and repair interrupted operations from a previous crash?

**Output format:**
```
| Operation | File:Line | Steps | Transaction Scope | Crash-Between Risk | Consequence |
```

### Track 5: Claim Verification
**Adversarial lens:** "Does the code actually do what it says it does?"

Mechanistic checks:
- [ ] For every public API method: trace from interface to implementation. Does it work or is it a stub?
- [ ] For every stub (returns `[]`, `null`, `0`, or throws "not implemented"): is it documented? Does the caller know?
- [ ] For every config option in the public API: is it actually read and used? Or declared but dead?
- [ ] For every feature flag: does toggling it actually change behavior?
- [ ] For every "secure" claim: is the security mechanism actually correct?
- [ ] For every "GDPR-compliant" claim: does it actually erase, or just soft-delete?
- [ ] For every "encrypted" claim: correct algorithm, mode, IV, key derivation, padding?
- [ ] For every "rate limited" claim: is the rate limit actually enforced? Is it bypassable?
- [ ] For every `wait()` / `poll()` method: does it actually wait, or does it return immediately?

**Output format:**
```
| Claim | Location | What It Says | What It Does | Verdict (MATCH/STUB/DEAD/LIE) |
```

### Track 6: Adversarial Input & Security Bypass
**Adversarial lens:** "How do I break the security controls?"

Mechanistic checks:
- [ ] PII detection: test with zero-width chars (U+200B/C/D/FEFF), Unicode digit variants, homoglyphs
- [ ] Injection detection: test with case variations, Unicode normalization bypasses, split across fields
- [ ] RBAC: test with empty permission sets (does empty = allow-all?), null tenant IDs, system actor IDs
- [ ] Tenant isolation: test with null tenant ID, cross-tenant ID references, parameter injection
- [ ] Rate limiting: test with identifier spoofing, clock manipulation, burst-then-wait patterns
- [ ] Webhook URLs: test with localhost, 127.0.0.1, [::1], 0.0.0.0, DNS rebinding, HTTP (not HTTPS)
- [ ] Encryption: test with key reuse, IV reuse, empty plaintext, max-length plaintext
- [ ] Session management: test with expired sessions, forged session IDs, cross-tenant session resume

**Output format:**
```
| Control | Claimed Protection | Actual Check | Bypass Vector | Severity |
```

### Track 7: Developer Experience & Footguns
**Adversarial lens:** "What will a new developer get wrong on day one?"

Mechanistic checks:
- [ ] Count concepts needed for "hello world" (target: <= 5)
- [ ] Trace minimum viable code from import to first successful operation
- [ ] For every resource that needs cleanup: what happens if developer forgets?
- [ ] For every async method: what happens if developer doesn't await?
- [ ] For every Result/error return: what happens if developer ignores the error?
- [ ] For every method with side effects: is it obvious from the name?
- [ ] For the top 10 likely mistakes: are error messages helpful? Do they suggest fixes?
- [ ] Check defaults: are they safe? Are dev-mode defaults clearly marked as unsafe for production?

**Output format:**
```
| Dimension | Score (1-5) | Evidence |
```

### Track 8: Provider & Integration Correctness
**Adversarial lens:** "Does each external integration match the provider's actual API spec?"

Mechanistic checks:
- [ ] For each LLM adapter: are required request fields present? Types correct?
- [ ] For each streaming implementation: is parser state per-stream or shared? Are partial chunks handled?
- [ ] For each error response parser: are ALL provider-specific error codes mapped?
- [ ] For each token counter: does it match the provider's actual token counting?
- [ ] For each tool-calling implementation: are tool call IDs correctly round-tripped?
- [ ] For each retry implementation: are retryable vs non-retryable errors correctly classified?
- [ ] For each cost tracker: are cost-per-token values actually used in calculations?

**Output format:**
```
| Provider | Feature | Expected Behavior | Actual Behavior | Status |
```

---

## PHASE 2: TRIAGE & PLANNING

### 2.1 Findings Classification
After all 8 tracks complete, classify every finding into exactly one category:

| Category | Definition | Action |
|----------|-----------|--------|
| **CRITICAL** | Data corruption, security bypass, or production outage | Fix immediately, block release |
| **HIGH** | Incorrect behavior users will hit in normal usage | Fix before release |
| **MEDIUM** | Edge case bugs or degraded behavior under stress | Fix if time allows |
| **LOW** | Suboptimal but functional, cosmetic, or DX improvements | Track for later |

### 2.2 Dependency Graph of Fixes
Before implementing, map which fixes depend on which:
- Which fixes touch the same file? (merge conflict risk)
- Which fixes change interfaces vs implementations? (blast radius)
- Which fixes require database migration? (irreversible)
- Which fixes require test changes? (validation impact)

### 2.3 Implementation Plan
For each fix, specify:
1. **Exact file and line range** to modify
2. **The change** (old code → new code, described precisely)
3. **Why this change is correct** (first-principles reasoning)
4. **Blast radius** (what else could break, and how you'll verify it doesn't)
5. **Test coverage** (which existing tests cover this, which new tests are needed)

---

## PHASE 3: IMPLEMENTATION (Surgical Precision)

### Rules of Engagement
1. **One fix per logical change.** Don't bundle unrelated fixes.
2. **Read before edit.** Always read the current file before modifying it. Always.
3. **Preserve style.** Match the existing code style exactly — indentation, naming conventions, comment style, module patterns.
4. **No scope creep.** Fix the bug. Don't refactor surrounding code. Don't add docstrings. Don't add type annotations to code you didn't change. Don't "improve" adjacent code.
5. **No speculative fixes.** If you can't point to a specific input that triggers the bug, it's not a bug — it's an opinion.
6. **Preserve semantics.** If the old code returned `[]` for "no results" and the new code returns `[]` for "no results," that's fine. If the old code returned `[]` and the new code throws, that changes the API contract.
7. **Comment only what's non-obvious.** A `1 / (1 + distance)` formula needs a comment explaining why. A `sessions.delete(id)` call does not.

### Implementation Order
1. Fix CRITICAL findings first (data corruption, security)
2. Fix HIGH findings that are leaf changes (no downstream dependencies)
3. Fix HIGH findings that change shared code (more blast radius)
4. Fix MEDIUM findings if they're surgical and low-risk

### Per-Fix Checklist
Before committing each fix:
- [ ] Re-read the modified file to verify correctness
- [ ] Verify the fix handles ALL edge cases identified in the audit (not just the primary case)
- [ ] Verify no new unused variables, imports, or dead code introduced
- [ ] Verify the fix doesn't change the public API contract (unless that's the point)
- [ ] Verify TypeScript types are satisfied (no new type errors)

---

## PHASE 4: VERIFICATION (Trust But Verify)

### 4.1 Static Analysis
1. Run the project's typecheck command — zero new errors allowed
2. Diff the error list before and after changes — only pre-existing errors should remain
3. Verify no new lint warnings

### 4.2 Test Execution
1. Run the full test suite
2. Categorize results:
   - **Previously passing, still passing** — good
   - **Previously failing (infra), still failing (infra)** — expected (e.g., missing native deps)
   - **Previously passing, now failing** — REGRESSION, must fix before shipping
   - **Previously failing, now passing** — bonus, note it
3. Run targeted tests against each modified file specifically
4. For fixes that change behavior (not just fixing bugs): verify the OLD behavior was actually wrong

### 4.3 Blast Radius Verification
For each modified file:
1. What other modules import this file? Run them.
2. What tests exercise this module? Run them.
3. Did the fix change any interface contracts? If so, are all callers updated?

### 4.4 Regression Checklist
- [ ] Zero new typecheck errors
- [ ] Zero new test failures
- [ ] All modified files re-read and verified post-edit
- [ ] All edge cases from audit covered by the fix
- [ ] No accidental API contract changes

---

## PHASE 5: SHIP

### 5.1 Commit Strategy
- One commit per logical group of related fixes (not one per file)
- Commit message format:
  ```
  fix: <summary of what was fixed and why>
  
  <numbered list of each fix with file, line, and one-line description>
  ```
- Include the session link for traceability

### 5.2 Push & Verify
- Push to the designated branch
- Verify push succeeded
- Do NOT create a PR unless explicitly asked

### 5.3 Post-Ship Summary
Deliver a table to the user:

```
| # | Severity | File:Line | Bug | Fix | Blast Radius |
```

And a confidence statement:
- How many fixes were made
- How many tests were run
- How many regressions were found (should be zero)
- What residual risk remains (things you checked but couldn't fix, or things outside audit scope)

---

## ANTI-PATTERNS (What This Prompt Prevents)

| Anti-Pattern | How This Prompt Prevents It |
|---|---|
| Surface-level "does encryption exist?" checks | 8 specialized tracks with mechanistic checklists |
| Reading docs instead of code | Explicit rule: "read code, not comments" |
| Fixing one bug, introducing another | Phase 4 blast radius verification |
| Scope creep during fixes | "No scope creep" rule in Phase 3 |
| Vague findings without evidence | "Every finding needs a file:line reference" |
| Fixing symptoms instead of root causes | Phase 2 dependency graph forces root cause analysis |
| Shipping without testing | Phase 4 regression checklist is mandatory |
| Missing edge cases in fixes | Per-fix checklist: "handles ALL edge cases from audit" |
| Inconsistent fix quality | Implementation rules of engagement standardize every fix |

---

## CALIBRATION NOTES

This prompt was battle-tested against Limen AI v2.0.0 (~40K LOC, 290 source files, 219 test files). It found 8 real bugs that a surface-level production readiness check missed:

1. L2 distance-to-similarity formula producing negative values (math bug)
2. Sessions growing unbounded with no TTL or eviction (lifecycle bug)
3. Database close() throwing on double-call (idempotency bug)
4. missions.list() silently returning [] as a stub (claim verification)
5. Audit archive not atomic — crash leaves trigger permanently disabled (atomicity bug)
6. Timer racing with destroy() during shutdown (lifecycle bug)
7. PII scanner not normalizing Unicode before regex (security bypass)
8. Rate limit map growing unbounded per agent ID (lifecycle bug)

All 8 were in code that passed a checklist-level production readiness review. The bugs lived beneath the abstraction level that checklists operate at.
