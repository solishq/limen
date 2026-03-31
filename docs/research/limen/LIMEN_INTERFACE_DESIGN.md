# Limen Interface Design Specification

**Date**: 2026-03-30
**Author**: SolisHQ Researcher (Design Taste + Production Engineering Audit)
**Status**: DEFINITIVE INTERFACE SPECIFICATION
**Purpose**: Every touchpoint a developer experiences, designed from first principles

---

## Design Philosophy

Three principles govern every Limen interface:

1. **Legibility over density.** A developer should absorb the meaning of any output in under 2 seconds. If they have to re-read it, the design failed.
2. **Structure for machines, beauty for humans.** Every output is valid structured data (JSON). Every *displayed* output is formatted for human comprehension. The `--json` flag is always available; human-readable is the default.
3. **Errors are conversations, not stack traces.** Every error tells you what, why, and how to fix it. Every error has a code you can search for.

### Design References

These CLIs informed the design vocabulary:

| CLI | Lesson Taken |
|-----|-------------|
| Vercel | Minimal chrome. Status communicated through symbols, not words. Silence is success. |
| GitHub (`gh`) | Consistent verb-noun grammar. Discoverable subcommands. Contextual help. |
| Railway | Color as semantic signal (green = running, yellow = building, red = failed). |
| Wrangler | Error messages that include the fix. "Did you mean...?" suggestions. |
| Charm ecosystem | Box-drawing characters for structure. Lip Gloss-style alignment. |

### Sources

- [Command Line Interface Guidelines (clig.dev)](https://clig.dev/) -- human-first CLI principles
- [Node.js CLI Apps Best Practices](https://github.com/lirantal/nodejs-cli-apps-best-practices) -- error codes, structure, output
- [Charm terminal UI ecosystem](https://charm.land/) -- visual vocabulary for terminal output
- [Ink: React for CLIs](https://github.com/vadimdemedes/ink) -- component-based terminal rendering
- [Google: Writing Helpful Error Messages](https://developers.google.com/tech-writing/error-messages) -- what/why/how structure
- [What's in a Good Error Message? (Morling)](https://www.morling.dev/blog/whats-in-a-good-error-message/) -- error anatomy
- [UX Patterns for CLI Tools (Lucas Costa)](https://www.lucasfcosta.com/blog/ux-patterns-cli-tools) -- feedback loops, progress

---

## Part 1: CLI Interface Design

### 1.1 Command Grammar

```
limen <verb> [noun] [flags]
```

Every command follows verb-first grammar. No positional arguments that require memorization. Flags are long-form by default with short aliases for frequent use.

### 1.2 Global Flags

```
--json          Force JSON output (default when piped)
--no-color      Disable color output
--verbose       Show timing and engine details
--data-dir      Override data directory
--master-key    Override master key path
--quiet         Suppress non-essential output
```

**Auto-detection**: When stdout is not a TTY (piped to another command or file), output automatically switches to JSON without `--json`. This follows the clig.dev principle: be human-first when a human is watching, machine-first when a machine is reading.

### 1.3 Color Palette

Colors carry semantic meaning. They are never decorative.

```
Cyan     (#5DE5D5)   Identifiers (subjects, predicates, claim IDs)
Green    (#50FA7B)   Success states, healthy, created
Yellow   (#F1FA8C)   Warnings, stale, degraded
Red      (#FF5555)   Errors, unhealthy, failures
Dim gray (#6272A4)   Metadata, timestamps, secondary info
White    (default)   Primary content, values
Magenta  (#FF79C6)   Relationship types, categories
Bold     (weight)    Section headers, emphasis
```

**Implementation note**: Use `chalk` for color (wide terminal support, auto-detection of color capability). Never embed raw ANSI codes.

### 1.4 Symbol Vocabulary

```
Symbol  Meaning              Usage
------  -------------------  ----------------------------------
  +     Created/added        New claim, new session
  -     Removed/retracted    Claim retraction, session close
  *     Modified/updated     Superseded claim, updated value
  ?     Query/search         Search results header
  !     Warning              Stale data, degraded health
  x     Error/failure        Failed operation
  >     Active/running       Current session, active mission
  .     Waiting/loading      Progress indicator dot
  |     Relationship         Claim connection
  #     Count/metric         Numeric results
```

All symbols use their plain ASCII form. The colored variant (green +, red x) carries the semantic weight. No emoji. Emoji breaks in many terminal emulators and SSH sessions.

---

### 1.5 Command Designs

#### `limen init`

Initializes the `~/.limen/` directory with master key and default config.

**Success output**:
```
  + Limen initialized

    Home        ~/.limen/
    Data        ~/.limen/data/
    Master key  ~/.limen/master.key    (created, 0600)
    Config      ~/.limen/config.json   (created)

    Run limen status to verify the engine.
```

**Already initialized**:
```
  * Limen already initialized

    Home        ~/.limen/
    Master key  ~/.limen/master.key    (exists, not overwritten)
    Config      ~/.limen/config.json   (exists, not overwritten)

    Existing data is preserved. No changes made.
```

**Error (permission denied)**:
```
  x LMN-1001: Cannot create Limen home directory

    Path: ~/.limen/
    Cause: Permission denied (EACCES)

    Fix: Check write permissions on your home directory.
         sudo mkdir -p ~/.limen && sudo chown $USER ~/.limen
    Docs: https://limen.dev/errors/LMN-1001
```

**Design rationale**: No spinners. `init` is instant (<100ms). Showing a spinner for something that takes 50ms is dishonest. The output shows exactly what was created, which lets the developer verify their system state at a glance.

---

#### `limen status`

Shows engine health, knowledge base stats, and freshness.

**Healthy output**:
```
  Limen v2.0.0

    Status      healthy
    Uptime      --  (CLI mode)

    Knowledge
      Claims       1,247 active    12 retracted
      Freshness    98% current     2% stale (>30d)
      Connections  483 relationships

    Storage
      Database     ~/.limen/data/limen.db
      Size         4.2 MB
      Migrations   27/27 applied

    Subsystems
      Kernel        healthy
      Claims        healthy
      Working Mem   healthy
      Orchestration healthy
      Governance    healthy
```

**Degraded output**:
```
  Limen v2.0.0

    Status      degraded

    Knowledge
      Claims       1,247 active    12 retracted
      Freshness    62% current     38% stale (>30d)    !
      Connections  483 relationships

    Storage
      Database     ~/.limen/data/limen.db
      Size         4.2 MB
      Migrations   25/27 applied                       !

    Subsystems
      Kernel        healthy
      Claims        healthy
      Working Mem   degraded    2 pending migrations
      Orchestration healthy
      Governance    healthy

    ! 2 issues detected. Run limen doctor for diagnostics.
```

**Empty knowledge base**:
```
  Limen v2.0.0

    Status      healthy

    Knowledge
      Claims       0
      Connections  0

    Storage
      Database     ~/.limen/data/limen.db
      Size         128 KB
      Migrations   27/27 applied

    Your knowledge base is empty.
    Run limen remember "your first fact" to get started.
```

**Design rationale**: Status is the "home screen" of the CLI. It should give a developer total situational awareness in one glance. The `!` warning indicators are right-aligned to create a scannable gutter. Numeric values are comma-separated for readability at scale.

---

#### `limen search "query"`

Full-text search across all claims.

**Results found**:
```
  ? "database decisions"                   3 results in 1.2ms

  1  entity:project:atlas                  confidence 0.95
     decision.database
     "Chose PostgreSQL for production due to JSONB support and team expertise."
     2 days ago

  2  entity:project:atlas                  confidence 0.90
     decision.cache
     "Chose Redis for session cache. 5ms P99 latency requirement."
     2 days ago    |supports #1

  3  entity:project:mercury                confidence 0.75
     decision.database
     "Evaluated DynamoDB but rejected for cost at expected query volume."
     14 days ago

  Tip: Use limen recall --subject "entity:project:atlas" for structured queries.
```

**No results**:
```
  ? "quantum computing architecture"       0 results in 0.8ms

    No claims match this query.

    Suggestions:
      Try broader terms:  limen search "architecture"
      Check subjects:     limen recall --subject "entity:project:*"
      Store knowledge:    limen remember "your fact here"
```

**Design rationale**: Search results use a numbered list for reference in follow-up commands. The subject and predicate are colored (cyan) to separate identity from content. The relationship indicator (`|supports #1`) shows graph connections inline without breaking the scan pattern. The "ago" timestamps are relative because absolute ISO timestamps are unreadable in context (but available with `--verbose`).

---

#### `limen recall --subject "entity:project:atlas"`

Structured recall with subject/predicate filters.

**Results found**:
```
  Recall: entity:project:atlas             5 claims

  decision.database                         0.95    2d ago
    "Chose PostgreSQL for production due to JSONB support."

  decision.cache                            0.90    2d ago
    "Chose Redis for session cache."
    |supports decision.database

  decision.auth                             0.85    5d ago
    "JWT with refresh tokens. 15min access, 7d refresh."

  finding.performance                       0.80    3d ago
    "P99 latency under 50ms for all read paths."
    |supports decision.database

  warning.scaling                           0.70    1d ago
    "Connection pool exhaustion possible above 500 concurrent."
    |contradicts finding.performance

  Showing 5 of 5. Use --limit to adjust.
```

**With `--verbose`**:
```
  Recall: entity:project:atlas             5 claims    engine=fts5    1.8ms

  ID         Subject                   Predicate            Value                                      Conf   ValidAt
  ────────   ────────────────────────   ──────────────────   ────────────────────────────────────────   ────   ──────────────────
  clm_8f2a   entity:project:atlas      decision.database    Chose PostgreSQL for production due to...  0.95   2026-03-28T14:22Z
  clm_8f2b   entity:project:atlas      decision.cache       Chose Redis for session cache.             0.90   2026-03-28T14:23Z
  clm_9a1c   entity:project:atlas      decision.auth        JWT with refresh tokens. 15min access...   0.85   2026-03-25T09:11Z
  clm_7b3d   entity:project:atlas      finding.performance  P99 latency under 50ms for all read...    0.80   2026-03-27T16:45Z
  clm_6c4e   entity:project:atlas      warning.scaling      Connection pool exhaustion possible...     0.70   2026-03-29T11:02Z
```

**Design rationale**: Default mode is optimized for reading: one claim per visual block, predicates as headers, values as quoted content. Verbose mode is optimized for scanning: tabular layout with truncated values. The developer chooses the mode that fits their task. Relationship lines use `|` prefix to stay visually subordinate to the claim content.

---

#### `limen remember "fact"`

Quick knowledge storage. Accepts natural text with optional explicit subject/predicate.

**Simple form**:
```
$ limen remember "User Alice prefers dark mode"

  + Stored                                 clm_a1b2

    Subject     entity:fact:1711756800000
    Predicate   fact.description
    Value       "User Alice prefers dark mode"
    Confidence  0.80

  Tip: For structured claims, use:
       limen remember --subject "entity:user:alice" --predicate "preference.theme" "dark mode"
```

**Structured form**:
```
$ limen remember --subject "entity:user:alice" --predicate "preference.theme" "dark mode"

  + Stored                                 clm_c3d4

    Subject     entity:user:alice
    Predicate   preference.theme
    Value       "dark mode"
    Confidence  0.80
```

**Validation error**:
```
  x LMN-2004: Invalid subject format

    Input: "user alice"
    Expected: entity:<type>:<id>  (e.g., entity:user:alice)

    The subject must be a URN with three colon-separated segments.
    First segment must be "entity".

    Fix: limen remember --subject "entity:user:alice" --predicate "preference.theme" "dark mode"
    Docs: https://limen.dev/errors/LMN-2004
```

**Design rationale**: The simple form (just a string) is the on-ramp. It stores the fact with auto-generated subject/predicate. The structured form with `--subject` and `--predicate` is for developers who have internalized the URN model. The tip in the simple form teaches the structured form without blocking the workflow.

---

#### `limen history`

Recent claims timeline.

**Output**:
```
  Recent claims                            last 24 hours

  03:15  + entity:user:alice        preference.theme       "dark mode"           0.80
  03:14  + entity:project:atlas     decision.database      "Chose PostgreSQL..." 0.95
  03:14  + entity:project:atlas     decision.cache         "Chose Redis..."      0.90
  03:14  | clm_8f2b supports clm_8f2a
  02:58  + entity:config:v2         setting.timeout        "30s"                 0.90
  02:30  - entity:config:v1         setting.timeout        retracted
  01:45  + entity:pattern:retry     architecture.pattern   "Exponential back..." 0.85

  7 events in last 24h. Use --since "2d" for longer range.
```

**Empty history**:
```
  Recent claims                            last 24 hours

    No activity in the last 24 hours.

    Use limen remember to store your first claim,
    or limen search to find existing knowledge.
```

**Design rationale**: History is a timeline. Timestamps are left-aligned for scanning. The `+`, `-`, `|`, `*` symbols create a parseable event log that a developer can skim vertically. Retracted claims show as `-` so the audit trail is visible. Relationship events (`|`) show inline.

---

#### `limen export --format json`

Export the entire knowledge base.

**Output (progress)**:
```
  Exporting knowledge base...

    Claims          1,247 / 1,247    done
    Relationships     483 / 483      done
    Working Memory     12 / 12       done

  + Exported to stdout (1,247 claims, 483 relationships)

    Pipe to file: limen export --format json > backup.json
```

**When piped** (auto-detected, no chrome):
```json
{
  "version": "2.0.0",
  "exported": "2026-03-30T03:15:42Z",
  "claims": [...],
  "relationships": [...],
  "workingMemory": [...],
  "meta": {
    "claimCount": 1247,
    "relationshipCount": 483,
    "workingMemoryEntries": 12
  }
}
```

**Design rationale**: When a human is watching (TTY detected), show progress. When piped to a file or another command, output pure JSON with no decoration. The `meta` field at the end of the export gives the consumer a checksum-like count to verify completeness.

---

#### `limen import file.json`

Import from file.

**Success**:
```
  Importing from backup.json...

    Claims          1,247 / 1,247    imported
    Relationships     483 / 483      imported
    Duplicates          3             skipped (same subject+predicate+value)
    Conflicts           0

  + Imported 1,244 new claims, 483 relationships
```

**With conflicts**:
```
  Importing from external.json...

    Claims            200 / 200      processed
    Relationships      45 / 45       imported
    Duplicates         12             skipped
    Conflicts           3             !

  + Imported 185 claims, 45 relationships

  ! 3 conflicts detected (same subject+predicate, different value):

    1  entity:user:alice   preference.theme
       Existing: "dark mode" (0.80)   Incoming: "light mode" (0.75)
       Resolution: kept existing (higher confidence)

    2  entity:config:v2    setting.timeout
       Existing: "30s" (0.90)         Incoming: "60s" (0.90)
       Resolution: kept existing (equal confidence, existing wins)

    3  entity:project:atlas decision.auth
       Existing: "JWT" (0.85)         Incoming: "OAuth2" (0.95)
       Resolution: superseded existing (incoming has higher confidence)

  Use --on-conflict=skip|replace|ask to control resolution.
```

**Design rationale**: Import is a potentially destructive operation. The output must make the developer confident about what happened. Every conflict is shown with both values and the resolution reasoning. The `--on-conflict` flag gives control without requiring it -- the default behavior is intelligent (highest confidence wins).

---

#### `limen doctor`

Health check and diagnostics.

**All healthy**:
```
  Limen Doctor                             5 checks passed

    Database integrity       ok     WAL mode, ACID verified
    Migration status         ok     27/27 applied
    Knowledge freshness      ok     98% current (threshold: 70%)
    Storage utilization      ok     4.2 MB (no limit configured)
    Configuration validity   ok     ~/.limen/config.json valid

  All systems healthy. No action required.
```

**Issues found**:
```
  Limen Doctor                             3 passed  2 issues

    Database integrity       ok     WAL mode, ACID verified
    Migration status         !      25/27 applied, 2 pending
    Knowledge freshness      ok     98% current
    Storage utilization      !      982 MB of 1 GB limit (98%)
    Configuration validity   ok     ~/.limen/config.json valid

  Issues:

    1  Migration status
       2 migrations pending: 026_vector_index, 027_fts5_rebuild
       Fix: limen migrate
       Risk: Some features may not work until migrations are applied.

    2  Storage utilization
       Database is at 98% of configured limit (1 GB).
       Fix: Increase limit in ~/.limen/config.json (storageLimit)
            or run limen gc to remove retracted claims older than 30d.
       Risk: Write operations will fail when limit is reached.
```

**Design rationale**: Doctor is diagnostic, not remedial. It tells you what is wrong and how to fix it, but never auto-fixes. Each issue has a numbered entry with a fix command and a risk statement. The risk statement is critical -- it tells the developer whether to act now or defer.

---

#### `limen serve --mcp`

Start the MCP server.

**Startup output** (to stderr, so stdout is clean for MCP protocol):
```
  Limen MCP Server v2.0.0

    Transport   stdio
    Engine      healthy
    Tools       22 registered
    Resources   1 registered

    Listening for MCP connections...
```

**With `--rest`**:
```
  Limen REST API v2.0.0

    Endpoint    http://localhost:3141
    Engine      healthy
    Routes      14 registered
    CORS        disabled (enable with --cors)

    Press Ctrl+C to stop.

  [03:15:42] INFO  server.started    port=3141 transport=http
```

**Design rationale**: Port 3141 (pi, memorable, unlikely to conflict). MCP server outputs startup info to stderr because stdout is reserved for the MCP JSON-RPC protocol. REST server outputs to stdout because it is interactive.

---

#### `limen graph`

ASCII visualization of knowledge relationships.

**Output**:
```
  Knowledge Graph                          28 nodes    34 edges

  entity:project:atlas
  +-- decision.database .................. "Chose PostgreSQL" (0.95)
  |   +-- supports
  |   |   +-- finding.performance ........ "P99 < 50ms" (0.80)
  |   +-- contradicted_by
  |       +-- warning.scaling ............ "Pool exhaustion" (0.70)
  +-- decision.cache .................... "Chose Redis" (0.90)
  |   +-- supports
  |       +-- decision.database
  +-- decision.auth ..................... "JWT + refresh" (0.85)

  entity:user:alice
  +-- preference.theme .................. "dark mode" (0.80)
  +-- preference.food ................... "hates cilantro" (0.90)

  entity:config:v2
  +-- setting.timeout ................... "30s" (0.90)
      +-- supersedes
          +-- entity:config:v1 setting.timeout (retracted)

  Clusters: 3    Orphans: 0    Max depth: 3
```

**Filtered graph**:
```
$ limen graph --subject "entity:project:atlas" --depth 2

  entity:project:atlas                     depth limit: 2

  +-- decision.database .................. "Chose PostgreSQL" (0.95)
  |   +-- finding.performance ............ "P99 < 50ms" (0.80)
  |   +-- warning.scaling ................ "Pool exhaustion" (0.70)
  +-- decision.cache .................... "Chose Redis" (0.90)
  +-- decision.auth ..................... "JWT + refresh" (0.85)

  5 nodes shown (3 total in graph, depth limited to 2).
```

**Empty graph**:
```
  Knowledge Graph                          0 nodes

    No knowledge stored yet.

    Start building your graph:
      limen remember --subject "entity:project:myapp" --predicate "decision.stack" "chose TypeScript"
      limen remember --subject "entity:project:myapp" --predicate "decision.db" "chose SQLite"
```

**Design rationale**: The graph uses tree-drawing characters (`+--`, `|`) which are universally supported across terminals. Dotted-line fill (`..`) between predicate and value creates visual alignment without relying on fixed-width columns. Relationships are shown as child nodes with the relationship type as a label. The `Clusters` / `Orphans` / `Max depth` footer gives structural metadata.

Why tree-style instead of box-and-arrow ASCII? Box-and-arrow graphs break down quickly with more than 5-6 nodes. The terminal is 80-120 columns wide. Trees compress information density while maintaining readability. For full graph visualization, the web dashboard (Part 6) handles it.

---

## Part 2: Error Message Design

### 2.1 Error Anatomy

Every Limen error follows this structure:

```
  x LMN-NNNN: <Title>                     (1 line, scannable)

    <Detail explanation>                    (1-3 lines, specific)

    Fix: <Actionable command or instruction>
    Docs: https://limen.dev/errors/LMN-NNNN
```

The `x` is red. The error code is bold. The title is white. The detail is dim. The fix is green. This creates a visual hierarchy: problem (red) -> context (dim) -> solution (green).

### 2.2 Error Code Registry

#### LMN-1xxx: Storage Errors

| Code | Title | When |
|------|-------|------|
| LMN-1001 | Cannot create data directory | `init` fails due to permissions |
| LMN-1002 | Database file locked | Another process holds the SQLite lock |
| LMN-1003 | Database corrupted | SQLite integrity check fails |
| LMN-1004 | Migration failed | A migration file fails to apply |
| LMN-1005 | Storage limit exceeded | Write would exceed configured storage limit |
| LMN-1006 | WAL checkpoint failed | WAL file cannot be checkpointed |
| LMN-1007 | Master key not found | The master key file does not exist |
| LMN-1008 | Master key invalid | The master key file is not 32 bytes |
| LMN-1009 | Backup failed | Export or backup operation failed |
| LMN-1010 | Import format invalid | Import file is not valid Limen JSON |

#### LMN-2xxx: Validation Errors

| Code | Title | When |
|------|-------|------|
| LMN-2001 | Subject required | Subject field is empty or null |
| LMN-2002 | Predicate required | Predicate field is empty or null |
| LMN-2003 | Confidence out of range | Confidence is not between 0.0 and 1.0 |
| LMN-2004 | Invalid subject format | Subject does not match `entity:<type>:<id>` |
| LMN-2005 | Invalid predicate format | Predicate does not match `<domain>.<property>` |
| LMN-2006 | Value exceeds maximum length | Object value exceeds 500 character limit |
| LMN-2007 | Invalid grounding mode | Grounding mode is not `evidence_path` or `runtime_witness` |
| LMN-2008 | Invalid relationship type | Relationship is not supports/contradicts/supersedes/derived_from |
| LMN-2009 | Missing mission context | Operation requires a mission ID |
| LMN-2010 | Invalid timestamp format | validAt is not valid ISO 8601 |
| LMN-2011 | Duplicate claim | Exact subject+predicate+value already exists |
| LMN-2012 | Invalid limit | Limit is not a positive integer or exceeds maximum |

#### LMN-3xxx: Query Errors

| Code | Title | When |
|------|-------|------|
| LMN-3001 | No active session | Operation requires an open session |
| LMN-3002 | Session already active | Attempted to open a session when one exists |
| LMN-3003 | Claim not found | Referenced claim ID does not exist |
| LMN-3004 | Invalid wildcard pattern | Subject/predicate wildcard is malformed |
| LMN-3005 | Query timeout | Query exceeded time limit |
| LMN-3006 | Result set too large | Query would return more than configured max |
| LMN-3007 | FTS index not built | Full-text search index needs rebuilding |
| LMN-3008 | Vector index unavailable | Vector search is not configured |

#### LMN-4xxx: Governance Errors

| Code | Title | When |
|------|-------|------|
| LMN-4001 | Governance protection active | Attempted to supersede a protected claim |
| LMN-4002 | Insufficient trust level | Agent trust level too low for operation |
| LMN-4003 | Budget exceeded | Token budget exhausted for mission |
| LMN-4004 | RBAC denied | Role does not have required permission |
| LMN-4005 | Audit chain broken | Hash chain integrity check failed |
| LMN-4006 | Policy violation | Hard policy constraint violated |
| LMN-4007 | Contract unsatisfied | Mission contract criteria not met |
| LMN-4008 | Lifecycle transition invalid | Invalid state transition attempted |
| LMN-4009 | Delegation cycle detected | Circular delegation in mission tree |
| LMN-4010 | Authority scope exceeded | Action exceeds caller's authority |

#### LMN-5xxx: Network/Distributed Errors

| Code | Title | When |
|------|-------|------|
| LMN-5001 | Provider unavailable | No LLM provider is reachable |
| LMN-5002 | Provider timeout | LLM provider did not respond in time |
| LMN-5003 | Provider rate limited | LLM provider returned 429 |
| LMN-5004 | MCP transport error | MCP connection lost or malformed |
| LMN-5005 | REST endpoint unreachable | REST server cannot bind port |

#### LMN-6xxx: Security Errors

| Code | Title | When |
|------|-------|------|
| LMN-6001 | Encryption key mismatch | Master key does not match existing database |
| LMN-6002 | Tenant isolation breach | Cross-tenant data access attempted |
| LMN-6003 | Credential redacted | Internal error message contained sensitive data |
| LMN-6004 | Session token invalid | Session authentication failed |
| LMN-6005 | Sandbox violation | Capability execution violated constraints |

### 2.3 Error Examples

**LMN-2004 in full context**:
```
  x LMN-2004: Invalid subject format

    Subject "user preferences" does not match URN format.
    Expected: entity:<type>:<id>  (three colon-separated segments)

    Examples:
      entity:user:alice
      entity:project:atlas
      entity:config:production

    Fix: limen remember --subject "entity:user:preferences" "prefers dark mode"
    Docs: https://limen.dev/errors/LMN-2004
```

**LMN-1002 in full context**:
```
  x LMN-1002: Database file locked

    Another process is holding the SQLite write lock on:
    ~/.limen/data/limen.db

    This usually means another Limen instance (CLI, MCP server, or
    your application) is running and holds the lock.

    Fix: Check for running processes:
         lsof ~/.limen/data/limen.db
         Or wait for the other process to release the lock.
         SQLite WAL mode supports concurrent readers, but only one writer.
    Docs: https://limen.dev/errors/LMN-1002
```

**LMN-4001 in full context**:
```
  x LMN-4001: Governance protection active

    Cannot supersede claim clm_8f2a.
    Subject "entity:hardban:001" matches protected prefix "entity:hardban:*".

    Protected claims cannot be superseded through normal operations.
    This is a governance safeguard, not a bug.

    Fix: If this claim genuinely needs updating, use an admin-level session:
         limen session open --trust admin
         Or contact your governance administrator.
    Docs: https://limen.dev/errors/LMN-4001
```

### 2.4 Error Design Principles

1. **Never say "invalid input."** Say what was invalid, what was expected, and give an example of the correct format.
2. **Never say "an error occurred."** Say which error, where, and what triggered it.
3. **Always include the error code.** Developers will google `LMN-2004`. Make it findable.
4. **Always include the fix.** If the fix is a command, make it copy-pasteable.
5. **Never expose internals.** No SQL, no stack traces, no file paths from the engine. The existing `LimenError` redaction layer (S39 IP-4) is the foundation -- this design extends it to the user-facing layer.
6. **Distinguish "you did something wrong" from "something broke."** LMN-2xxx means "fix your input." LMN-1xxx means "fix your environment." LMN-4xxx means "this was blocked by design."

### 2.5 Mapping to Existing Error Codes

The existing `LimenErrorCode` type in `api/interfaces/api.ts` maps to the LMN-xxxx codes:

| LimenErrorCode | LMN Code | Category |
|---------------|----------|----------|
| INVALID_INPUT | LMN-2001 through LMN-2012 | Validation (context-dependent) |
| ENGINE_UNHEALTHY | LMN-1003 | Storage |
| SESSION_NOT_FOUND | LMN-3001 | Query |
| UNAUTHORIZED | LMN-4004 | Governance |
| RATE_LIMITED | LMN-5003 | Network |
| BUDGET_EXCEEDED | LMN-4003 | Governance |
| STORAGE_EXCEEDED | LMN-1005 | Storage |
| HARD_POLICY_VIOLATION | LMN-4006 | Governance |
| CAPABILITY_VIOLATION | LMN-4002 | Governance |
| NOT_FOUND | LMN-3003 | Query |

The internal error codes remain unchanged. The LMN-xxxx codes are a user-facing layer that adds context, suggestions, and documentation links. The mapping happens at the CLI and MCP output boundaries.

---

## Part 3: API Response Design

### 3.1 Design Principle: Responses are Self-Documenting

Every API response includes enough metadata that a developer can understand what happened without reading logs or source code.

### 3.2 Response Shapes

#### `limen.remember()` Response

```typescript
interface RememberResult {
  /** The stored claim */
  claim: {
    id: string;
    subject: string;
    predicate: string;
    value: string;
    confidence: number;
    validAt: string;         // ISO 8601
    groundingMode: 'evidence_path' | 'runtime_witness';
  };

  /** Operation metadata */
  meta: {
    duration: number;        // milliseconds
    deduplicated: boolean;   // true if identical claim already existed
    previousClaimId?: string; // if this superseded an existing claim
  };
}
```

**Example**:
```json
{
  "claim": {
    "id": "clm_a1b2c3d4",
    "subject": "entity:user:alice",
    "predicate": "preference.theme",
    "value": "dark mode",
    "confidence": 0.80,
    "validAt": "2026-03-30T03:15:42Z",
    "groundingMode": "runtime_witness"
  },
  "meta": {
    "duration": 1.4,
    "deduplicated": false
  }
}
```

#### `limen.recall()` Response

```typescript
interface RecallResult {
  /** Matching claims, sorted by confidence descending */
  claims: Array<{
    id: string;
    subject: string;
    predicate: string;
    value: string;
    confidence: number;
    validAt: string;
    disputed: boolean;       // true if contradicting claims exist
    relationships: Array<{
      type: 'supports' | 'contradicts' | 'supersedes' | 'derived_from';
      targetClaimId: string;
      targetSubject: string;
      targetPredicate: string;
    }>;
  }>;

  /** Query metadata */
  meta: {
    query: {
      subject: string | null;
      predicate: string | null;
      minConfidence: number | null;
    };
    engine: 'exact' | 'fts5' | 'vector' | 'hybrid';
    duration: number;        // milliseconds
    totalResults: number;    // total matching (before limit)
    returned: number;        // actually returned (after limit)
    freshness: 'current' | 'mixed' | 'stale';
  };
}
```

**Example**:
```json
{
  "claims": [
    {
      "id": "clm_8f2a",
      "subject": "entity:project:atlas",
      "predicate": "decision.database",
      "value": "Chose PostgreSQL for production due to JSONB support and team expertise.",
      "confidence": 0.95,
      "validAt": "2026-03-28T14:22:00Z",
      "disputed": true,
      "relationships": [
        {
          "type": "supports",
          "targetClaimId": "clm_7b3d",
          "targetSubject": "entity:project:atlas",
          "targetPredicate": "finding.performance"
        }
      ]
    }
  ],
  "meta": {
    "query": { "subject": "entity:project:atlas", "predicate": "decision.*", "minConfidence": null },
    "engine": "fts5",
    "duration": 2.3,
    "totalResults": 3,
    "returned": 3,
    "freshness": "current"
  }
}
```

#### `limen.search()` Response

```typescript
interface SearchResult {
  /** Matching claims with relevance scores */
  claims: Array<{
    id: string;
    subject: string;
    predicate: string;
    value: string;
    confidence: number;
    relevance: number;       // 0.0-1.0, search relevance score
    snippet: string;         // highlighted match context
    validAt: string;
  }>;

  /** Search metadata */
  meta: {
    query: string;
    engine: 'fts5' | 'vector' | 'hybrid';
    duration: number;
    totalResults: number;
    returned: number;
  };
}
```

#### `limen.connect()` Response

```typescript
interface ConnectResult {
  relationship: {
    id: string;
    fromClaimId: string;
    toClaimId: string;
    type: 'supports' | 'contradicts' | 'supersedes' | 'derived_from';
  };
  meta: {
    duration: number;
    governanceChecked: boolean;
  };
}
```

#### `limen.health()` Response (already implemented, design audit)

The existing health response is well-structured. The design addition is the `freshness` field:

```typescript
interface HealthResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  subsystems: Record<string, {
    status: 'healthy' | 'degraded' | 'unhealthy';
    detail?: string;
  }>;
  knowledge: {
    claimCount: number;
    retractedCount: number;
    relationshipCount: number;
    freshness: {
      current: number;       // percentage of claims < 30d old
      stale: number;         // percentage >= 30d
      threshold: number;     // configured freshness threshold
    };
  };
  storage: {
    path: string;
    sizeBytes: number;
    migrationsApplied: number;
    migrationsTotal: number;
  };
  version: string;
}
```

### 3.3 API Response Design Principles

1. **Always include `meta`**. Duration, engine used, result counts. A developer debugging performance should never need to add timing code.
2. **Claims are always full objects.** No partial claims. If you query for a claim, you get its ID, subject, predicate, value, confidence, validAt, and dispute status.
3. **Relationships are inline.** A claim result includes its relationships. The developer does not need a second query to understand context.
4. **String IDs everywhere.** Even though the engine uses branded types internally, the public API uses plain strings. No `as ClaimId` casts in consumer code.
5. **ISO 8601 for all timestamps.** No Unix timestamps, no "2 days ago." The API is precise; the CLI humanizes.
6. **Freshness is a first-class field.** Every recall/search result includes a `freshness` indicator. Knowledge systems that do not surface staleness are silently lying.

---

## Part 4: MCP Server Output Design

### 4.1 Design Constraint

MCP tool outputs are consumed by LLMs (Claude, GPT, etc.) that read the text content. The output must be:

1. **Parseable by machines** -- valid JSON for structured extraction
2. **Readable by humans** -- developers see MCP output in Claude Code's tool output panels
3. **Token-efficient** -- LLMs have context windows; do not waste tokens on decoration

### 4.2 MCP Output Format

The current MCP output (JSON with `null, 2` formatting) is correct but can be improved for dual-audience readability.

#### `limen_health` Response

**Current** (acceptable, minor improvements):
```json
{
  "status": "healthy",
  "subsystems": { ... }
}
```

**Designed** (add summary line for LLM consumption):
```
Limen engine is healthy. 1,247 claims active, all subsystems operational.

{
  "status": "healthy",
  "version": "2.0.0",
  "claims": { "active": 1247, "retracted": 12 },
  "subsystems": {
    "kernel": "healthy",
    "claims": "healthy",
    "workingMemory": "healthy",
    "orchestration": "healthy",
    "governance": "healthy"
  }
}
```

The leading natural-language summary gives the LLM immediate context without parsing JSON. The JSON block follows for structured access.

#### `limen_remember` Response

**Current**:
```json
{
  "claimId": "clm_a1b2",
  "subject": "entity:user:alice",
  "predicate": "preference.theme",
  "object": "dark mode"
}
```

**Designed**:
```
Stored claim clm_a1b2: entity:user:alice / preference.theme = "dark mode" (confidence: 0.80)

{
  "claimId": "clm_a1b2",
  "subject": "entity:user:alice",
  "predicate": "preference.theme",
  "value": "dark mode",
  "confidence": 0.80
}
```

#### `limen_recall` Response

**Current**: Raw JSON array of filtered claims.

**Designed**:
```
Found 5 claims matching entity:project:atlas (query took 1.8ms)

1. decision.database (0.95): "Chose PostgreSQL for production due to JSONB support."
   - supports: finding.performance (clm_7b3d)
   - contradicted by: warning.scaling (clm_6c4e)

2. decision.cache (0.90): "Chose Redis for session cache."
   - supports: decision.database (clm_8f2a)

3. decision.auth (0.85): "JWT with refresh tokens. 15min access, 7d refresh."

4. finding.performance (0.80): "P99 latency under 50ms for all read paths."

5. warning.scaling (0.70): "Connection pool exhaustion possible above 500 concurrent."

{
  "claims": [
    {
      "claimId": "clm_8f2a",
      "subject": "entity:project:atlas",
      "predicate": "decision.database",
      "value": "Chose PostgreSQL for production due to JSONB support.",
      "confidence": 0.95,
      "disputed": true,
      "relationships": [...]
    }
  ],
  "meta": { "totalResults": 5, "engine": "fts5", "duration": 1.8 }
}
```

#### `limen_reflect` Response

**Current**: `{ "stored": 3, "claimIds": [...] }`

**Designed**:
```
Stored 3 learnings: 1 decision, 1 pattern, 1 warning.

{
  "stored": 3,
  "claimIds": ["clm_a1", "clm_a2", "clm_a3"],
  "byCategory": { "decision": 1, "pattern": 1, "warning": 1 }
}
```

#### `limen_session_open` Response

**Current**: Mission/task IDs as JSON.

**Designed**:
```
Knowledge session opened for project "limen-interface-design".

{
  "missionId": "3e8b4267-...",
  "taskId": "session-1711756800000",
  "project": "limen-interface-design",
  "protectedPrefixes": ["entity:hardban:*", "entity:amendment:*"]
}
```

### 4.3 MCP Error Responses

**Current**: `{ "error": "CODE", "message": "..." }`

**Designed**:
```
Error: No active session. Call limen_session_open first to begin storing knowledge.

{
  "error": "LMN-3001",
  "code": "NO_ACTIVE_SESSION",
  "message": "No active session. Call limen_session_open first.",
  "suggestion": "Use limen_session_open with a project name before calling limen_remember."
}
```

### 4.4 MCP Design Principles

1. **Natural language summary first, JSON second.** The LLM reads the summary. Structured tools parse the JSON. Both audiences are served.
2. **Include relationship context in recall results.** The LLM needs to understand claim connections to reason about knowledge. Do not make it call a second tool.
3. **Include category breakdowns in batch operations.** "Stored 3 learnings" is less useful than "1 decision, 1 pattern, 1 warning."
4. **Error suggestions should reference MCP tool names**, not CLI commands. The LLM calls `limen_session_open`, not `limen session open`.

---

## Part 5: Log Output Design

### 5.1 Log Format

Limen logs use structured key-value format with fixed-width fields for scannability.

```
[2026-03-30T03:15:42.123Z] INFO  claim.stored       subject=entity:user:alice predicate=preference.theme confidence=0.80 duration=1.4ms
[2026-03-30T03:15:42.456Z] INFO  claim.stored       subject=entity:project:atlas predicate=decision.database confidence=0.95 duration=2.1ms
[2026-03-30T03:15:42.789Z] INFO  relationship.created from=clm_8f2b to=clm_8f2a type=supports duration=0.8ms
[2026-03-30T03:15:43.012Z] WARN  claim.stale        subject=entity:config:v2 predicate=setting.timeout age=45d threshold=30d
[2026-03-30T03:15:43.345Z] INFO  recall.complete    query="user preferences" engine=fts5 results=3 duration=1.2ms
[2026-03-30T03:15:43.678Z] INFO  session.opened     project=limen-interface-design missionId=3e8b4267
[2026-03-30T03:15:44.012Z] ERROR governance.blocked  subject=entity:hardban:001 reason=protected_prefix code=LMN-4001
[2026-03-30T03:15:44.345Z] INFO  export.complete    claims=1247 relationships=483 size=4.2MB duration=890ms
```

### 5.2 Field Layout

```
[timestamp]  LEVEL  event.category    key=value key=value ...
 ^            ^      ^                 ^
 |            |      |                 |
 ISO 8601     4-char Dot-separated     Structured kv pairs
 with ms      padded event name        (no quoting unless spaces)
```

### 5.3 Color Coding (TTY only)

| Field | Color | Rationale |
|-------|-------|-----------|
| Timestamp | Dim gray | Timestamps are metadata, not primary content |
| INFO | Green | Normal operation |
| WARN | Yellow | Requires attention |
| ERROR | Red | Requires action |
| DEBUG | Dim gray | Development-only |
| Event name | Cyan | Primary identifier for log grep |
| Key names | Default | Keys are the structure |
| Values | Bright white | Values are the content |
| Duration | Dim (if <10ms), Yellow (if >100ms), Red (if >1000ms) | Performance signal |

### 5.4 Log Levels

| Level | When | Retention |
|-------|------|-----------|
| ERROR | Operation failed, data integrity risk | Always |
| WARN | Degraded state, stale data, approaching limits | Always |
| INFO | Claim stored, session opened, query complete | Default |
| DEBUG | SQL queries, cache hits, internal routing | `--verbose` only |

### 5.5 Log Design Principles

1. **One event per line.** Always. Multi-line log entries break `grep`, `tail -f`, and every log aggregator.
2. **Key-value pairs, not sentences.** `subject=entity:user:alice` is greppable. "Stored a claim for user alice" is not.
3. **Duration on every operation.** If it touches the database, it gets a `duration=` field. No exceptions.
4. **Error code on every error.** `code=LMN-4001` appears in the log line so operators can correlate log events with user-facing errors.
5. **No PII in logs.** Subject URNs and predicates are logged. Claim values are NOT logged (they may contain user data). Use `--verbose` to include values during debugging.

---

## Part 6: Web Dashboard

### 6.1 Verdict: Ship a Dashboard, But Not Yet

A web dashboard is the correct long-term interface for:

- **Knowledge graph visualization** -- trees work in the terminal; force-directed graphs work in a browser
- **Temporal exploration** -- scrubbing a timeline of knowledge changes
- **Health monitoring** -- real-time subsystem status for production deployments
- **Governance audit** -- reviewing audit chains and policy decisions

However, the dashboard should ship AFTER the CLI and API are complete. Reasoning:

1. **The CLI is the primary interface.** Limen is infrastructure. Infrastructure engineers live in terminals. A dashboard that ships before a complete CLI sends the wrong signal about who the product is for.
2. **Dashboards create maintenance burden.** Every API change requires a dashboard update. If the API is still evolving (it is), the dashboard becomes a drag on iteration speed.
3. **The MCP server IS the dashboard for AI agents.** Claude Code's tool output panel shows MCP results inline. For the primary user (an AI agent), the MCP interface is the dashboard.

### 6.2 When to Ship the Dashboard

Ship the dashboard when:
- The `limen.remember()` / `limen.recall()` / `limen.search()` API is stable (post-Sprint 1)
- The knowledge graph has >100 nodes in typical use (post-Sprint 2)
- A production user requests it (not before)

### 6.3 Dashboard Design (for when it ships)

**Technology**: Standalone HTML file served by `limen serve --dashboard` on port 3142. No build step. No React. Single `<script>` tag using D3.js from CDN. The dashboard makes REST API calls to the Limen REST server.

**Why single-file HTML?** Because Limen has one dependency (better-sqlite3). Adding React, Vite, and a build pipeline to render a few graphs contradicts the product identity. A single HTML file with inline D3.js is deployable, debuggable, and dependency-free.

**Views**:

| View | Visualization | Data Source |
|------|--------------|-------------|
| Knowledge Graph | D3.js force-directed graph. Nodes = subjects. Edges = relationships. Node size = claim count. Edge color = relationship type. | `GET /api/claims?includeRelationships=true` |
| Timeline | Horizontal timeline with claim events. Zoom by day/week/month. Color by category. | `GET /api/claims?sort=validAt` |
| Health | Green/yellow/red status cards for each subsystem. Auto-refresh every 5s. | `GET /api/health` |
| Search | Text input with live results. Click claim to expand. | `GET /api/search?q=` |
| Audit Log | Paginated table of audit events. Filter by subject, action, agent. | `GET /api/audit` |
| Freshness Heatmap | Calendar heatmap (GitHub-style) showing claim activity per day. Color intensity = claims stored. | `GET /api/claims/stats` |

---

## Part 7: README as Interface

### 7.1 Diagnosis of Current README

The current README leads with:

1. A banner image (good)
2. Badges (good)
3. A chat example: `limen.chat('What is quantum computing?')` (wrong audience)
4. "What's Running Underneath" (correct content, wrong position)

The problem: A developer looking for a **knowledge engine** sees a **chat wrapper** and bounces. The README must lead with knowledge operations because that is what makes Limen unique.

### 7.2 The Designed README

---

```markdown
<p align="center">
  <img src="docs/assets/banner.svg" alt="Limen" width="700">
</p>

<p align="center">
  <strong>Knowledge engine for AI agents.</strong><br>
  Store, recall, connect, and govern knowledge. One dependency. SQLite-powered.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/limen-ai"><img src="https://img.shields.io/npm/v/limen-ai" alt="npm"></a>
  <a href="https://github.com/solishq/limen/actions"><img src="https://img.shields.io/github/actions/workflow/status/solishq/limen/ci.yml?branch=main" alt="CI"></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Dependencies-1-green" alt="Dependencies">
  <img src="https://img.shields.io/badge/Tests-3200+-green" alt="Tests">
</p>

---

## 3 Lines to Remember

```typescript
import { createLimen } from 'limen-ai';

const limen = await createLimen();
await limen.remember('user:alice', 'preference.cuisine', 'loves Thai food');
const memories = await limen.recall('user:alice');
// => [{ subject: 'user:alice', predicate: 'preference.cuisine', value: 'loves Thai food', confidence: 0.8 }]
```

```bash
npm install limen-ai
```

No server. No Docker. No configuration. `createLimen()` provisions a local SQLite database with encryption, audit trails, and RBAC -- all running on a single `npm install` with one dependency.

---

## What Your Agent Can Do

```typescript
// Store knowledge
await limen.remember('project:atlas', 'decision.database', 'chose PostgreSQL for JSONB support');
await limen.remember('project:atlas', 'decision.cache', 'chose Redis for session cache');

// Connect knowledge
await limen.connect(claim1.id, claim2.id, 'supports');

// Search everything
const results = await limen.search('database decisions');

// Recall by subject
const atlas = await limen.recall('project:atlas');

// Recall by topic
const decisions = await limen.recall(null, { predicate: 'decision.*' });

// Retract with audit trail
await limen.forget(claim1.id);
```

Every operation is audited. Every claim has a confidence score. Every connection creates a knowledge graph. Every retraction preserves history.

---

## What Makes This Different

Limen is not a vector database with an API. It is a **governed knowledge engine**.

| Feature | Mem0 | Zep | Limen |
|---------|------|-----|-------|
| Store/recall | Yes | Yes | Yes |
| Confidence scores | No | No | Yes (0.0-1.0 per claim) |
| Audit trail | No | No | Yes (hash-chained, append-only) |
| RBAC | API keys | API keys | Per-operation role-based access |
| Knowledge graph | $249/mo | Yes | Yes (supports, contradicts, supersedes, derived_from) |
| Governance | No | No | 16 system calls, policy enforcement, budget tracking |
| Dependencies | 20+ | Postgres + Redis + Neo4j | 1 (better-sqlite3) |
| Hosting | Cloud required | Cloud required | Local SQLite. Your data stays on your machine. |

---

## MCP Server (Claude Code)

Limen ships with a Model Context Protocol server. Add it to your Claude Code configuration:

```json
{
  "mcpServers": {
    "limen": {
      "command": "npx",
      "args": ["limen-ai", "serve", "--mcp"]
    }
  }
}
```

22 tools available: `limen_remember`, `limen_recall`, `limen_search`, `limen_connect`, `limen_reflect`, `limen_session_open`, `limen_session_close`, `limen_scratch`, `limen_health`, and more.

---

## CLI

```bash
npx limen-ai init                           # Set up ~/.limen/
npx limen-ai status                         # Health + knowledge stats
npx limen-ai remember "chose TypeScript"    # Store a fact
npx limen-ai search "database decisions"    # Full-text search
npx limen-ai recall --subject "project:*"   # Structured query
npx limen-ai graph                          # ASCII knowledge graph
npx limen-ai doctor                         # Diagnostics
npx limen-ai export --format json > kb.json # Export
```

---

## What Runs Underneath

That `createLimen()` call is not a thin wrapper. When you store a claim, the engine:

- **Encrypts it** with AES-256-GCM in a WAL-mode SQLite database
- **Records an append-only, hash-chained audit entry** for the mutation
- **Enforces RBAC authorization** on the operation
- **Tracks token usage** against a budget ledger
- **Isolates data by tenant** (single-tenant by default, multi-tenant by config)

The governance layer runs whether you configure it or not. The difference between the demo and production is explicit configuration -- not a different code path.

---

## Architecture

```
                    +-------------------+
                    |    Your Agent     |
                    +-------------------+
                            |
               limen.remember() / limen.recall()
                            |
                    +-------------------+
                    |    API Surface    |   remember, recall, search, connect
                    +-------------------+
                            |
                    +-------------------+
                    |  Orchestration    |   missions, tasks, events, artifacts
                    +-------------------+
                            |
                    +-------------------+
                    |    Substrate      |   workers, capabilities, transport
                    +-------------------+
                            |
                    +-------------------+
                    |     Kernel        |   SQLite, RBAC, audit, crypto, time
                    +-------------------+
```

4 layers. 16 system calls. 134 invariants. 3,200+ tests. 1 dependency.

---

## Installation

```bash
npm install limen-ai
```

Requires Node.js >= 22. That's it.

---

## License

Apache 2.0. Use it in production. Modify it freely. Keep the attribution.

---

<p align="center">
  <strong>Limen</strong> — Latin for <em>threshold</em>.<br>
  The boundary where deterministic infrastructure meets stochastic cognition.
</p>
```

---

### 7.3 README Design Decisions

| Decision | Rationale |
|----------|-----------|
| Lead with `remember`/`recall`, not `chat` | Knowledge is the differentiation. Chat is commodity. |
| "3 Lines to Remember" as the hero section | Mirrors `createLimen()` simplicity. The heading itself is a mnemonic. |
| Comparison table with Mem0 and Zep | Developers will compare. Control the comparison. Lead with governance. |
| "Dependencies: 1" as a badge | This is Limen's most shocking stat. Make it visible immediately. |
| "Tests: 3200+" as a badge | Signals engineering rigor without requiring the developer to check. |
| No "Getting Started" tutorial in README | The 3-line example IS the getting started. Tutorials go in `/docs`. |
| Architecture as ASCII, not an image | ASCII renders in every terminal, every markdown previewer, every email. No broken images. |
| MCP config as copy-paste JSON | The fastest path to value for Claude Code users. |

### 7.4 The "Wow" Moment

The wow moment is in the comparison table. A developer reads:

> Dependencies: Mem0 = 20+. Zep = Postgres + Redis + Neo4j. Limen = 1.

That is the moment they realize this is not another wrapper. The second wow is:

> Audit trail: Mem0 = No. Zep = No. Limen = hash-chained, append-only.

A knowledge engine without an audit trail is a database with extra steps. Limen is the only one that treats knowledge as something worth governing.

---

## Part 8: Implementation Roadmap

### Phase 1: Error Infrastructure (Sprint 1, Week 1)

1. Create `LMN-xxxx` error code registry as a TypeScript const enum
2. Add `lmnCode` field to `LimenError` class
3. Add `suggestion` field to all error construction sites
4. Add `docsUrl` getter that generates `https://limen.dev/errors/LMN-NNNN`
5. Map existing `LimenErrorCode` values to `LMN-xxxx` codes

### Phase 2: CLI Output Layer (Sprint 1, Week 2)

1. Replace `writeResult(JSON.stringify(...))` with a formatting layer
2. Add TTY detection for auto-switching between human and JSON modes
3. Implement the color palette and symbol vocabulary
4. Add `--json`, `--no-color`, `--verbose`, `--quiet` global flags
5. Implement each command's designed output format

### Phase 3: MCP Output Enhancement (Sprint 1, Week 3)

1. Add natural-language summary prefix to all MCP tool responses
2. Add `meta` fields to recall and search responses
3. Add `suggestion` field to all MCP error responses
4. Add category breakdowns to batch operation responses

### Phase 4: New CLI Commands (Sprint 2)

1. `limen search` (requires FTS5 index)
2. `limen history`
3. `limen graph`
4. `limen doctor`
5. `limen export` / `limen import`
6. `limen serve --mcp` / `limen serve --rest`

### Phase 5: README Rewrite (Sprint 1, Day 1)

The README rewrite has zero code dependencies. It can ship immediately.

---

## Appendix A: Tool Stack Recommendation

| Purpose | Tool | Rationale |
|---------|------|-----------|
| Colors | `chalk` v5 (ESM) | Auto color detection, wide terminal support, no native deps |
| Spinners | `ora` | Battle-tested, graceful TTY fallback |
| Tables | Custom (fixed-width `padEnd`) | No dependency for simple alignment. `cli-table3` only if tables get complex |
| Box drawing | Unicode box chars (U+2500 block) | Universally supported in modern terminals |
| TTY detection | `process.stdout.isTTY` | Built-in Node.js. No dependency needed |
| Argument parsing | `commander` (already used) | No change needed |
| MCP server | `@modelcontextprotocol/sdk` (already used) | No change needed |

**Rejected**: Ink (React for terminals). Limen's CLI output is static, not interactive. Ink's value is in interactive TUIs (forms, selections, live updates). Limen's commands produce output and exit. Adding React's runtime for static output is over-engineering.

**Rejected**: Bubbletea/Charm. Go ecosystem. Limen is TypeScript. No interop path.

---

## Appendix B: Interface Checklist

Every new CLI command or MCP tool must satisfy this checklist before shipping:

- [ ] Success output designed (exact format, colors, alignment)
- [ ] Error output designed (LMN-xxxx code, suggestion, docs link)
- [ ] Empty state designed (what shows when there is nothing to show)
- [ ] JSON mode works (valid JSON on `--json` or piped output)
- [ ] Loading state designed (spinner for >200ms operations, nothing for <200ms)
- [ ] Verbose mode adds value (timing, IDs, engine details)
- [ ] Help text is actionable (examples, not just flag descriptions)
- [ ] Output fits in 80 columns without wrapping
- [ ] No emoji in output
- [ ] All values are aligned (consistent column widths within a command)

---

*Every interface a developer touches was designed. Not defaulted. Not accidental.*
*Limen -- the threshold where engineering meets experience.*
