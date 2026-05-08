# Limen v5 Phase 1 Foundation

## 1. What Is This?

Limen v5 Phase 1 Foundation is the structural core of a cognitive trust substrate
for AI systems. It provides an append-only, hash-chained audit log (the "chain"),
a four-operation dispatch loop that evaluates every proposed state transition
against refusal, authority, governance, and cascade integrity checks, and a
capability system that uses Rust's type system to make privilege forgery a
compile-time error. This phase covers Profiles 1 and 2 (single-node SQLite
storage with configurable durability). Consensus replication (Profile 3),
adaptive governance (Profile 4b), and cross-substrate federation (Profile 5)
are deferred to Phase 2.

## 2. Architecture Overview

The workspace contains 13 crates. Their dependency relationships enforce a
strict layering: lower crates never depend on higher ones.

```
                         limen_api
                            |
                       limen_substrate
                      /    |    \     \
     limen_substrate_runtime   limen_projection   limen_canonical
          |       |                |        |
   limen_foundation_ops    limen_chain      |
          |                    |    \       |
   limen_foundation_contract  |  limen_canonical
          |                   |
       limen_types         limen_types

   (independent)
   limen_consensus      -- Profile 3, Raft-based (optional feature)
   limen_graph          -- Graph query HTTP service
   limen_observability  -- Prometheus metrics
   limen_postgres       -- PostgreSQL storage backend
```

**Dependency rules:**

- `limen_types` is the leaf. Every crate may depend on it. It depends on nothing
  except `serde`.
- `limen_foundation_contract` defines traits (`FoundationOperation`,
  `ChainReadContext`, `ChainCommitSink`) and domain types (`ChainEntry`,
  `CommitDecision`, `VerdictSet`). It depends only on `limen_types`.
- `limen_foundation_ops` provides the four concrete operation implementations.
  It depends on `limen_foundation_contract`.
- `limen_chain` implements SQLite-backed chain storage. It depends on
  `limen_foundation_contract` (for the trait it implements) and `limen_canonical`
  (for deterministic serialization).
- `limen_chain` MUST NOT depend on `limen_projection` or `limen_foundation_ops`.
- `limen_substrate` assembles everything into a runnable substrate. It is the
  only crate that may depend on all lower layers.

## 3. The Dispatch Model

Every state change in Limen flows through the dispatch loop, defined in
`limen_foundation_contract::dispatch`. The loop executes four operations in
a fixed, non-configurable order:

```
Proposed Transition
        |
   [1] Refusal Evaluation      -- Can this transition be considered at all?
        |                         (empty payload, malformed schema -> Refuse)
        | Accept
   [2] Authority Evaluation     -- Is the actor authorized for this transition?
        |                         (identity mismatch -> Unauthorized)
        | Authorized
   [3] Governance Evaluation    -- Does the transition comply with active policies?
        |                         (policy violation -> Blocked)
        | Permitted
   [4] Cascade Integrity        -- Would this transition break cross-entry links?
        |                         (broken link -> Broken)
        | Intact
        v
   CommitDecision::Commit
```

**Short-circuiting:** If any operation produces a blocking verdict, the loop
immediately returns `CommitDecision::Refused` with the reason. Later operations
are not evaluated. This means a refused transition never reaches governance or
cascade checks.

**Verdict threading:** The actual `VerdictSet` from all evaluated operations is
threaded through to the chain commit sink. No verdicts are fabricated. If the
loop short-circuits at operation 2, the verdicts for operations 3 and 4 are
recorded as their default non-blocking values (they were never evaluated, not
that they passed).

**Static dispatch:** The four operations are hardcoded types, not a runtime
registry. `RefusalEvaluation`, `AuthorityAndCommitEvaluation`,
`GovernanceEvaluation`, and `CascadeIntegrityEvaluation` are concrete structs
that implement the `FoundationOperation` trait. There is no plugin mechanism
for adding or reordering operations.

## 4. Lifecycle State Machine

The substrate has a lifecycle guard (`LifecycleGuard`) that gates dispatch.
No commit transaction can execute unless the substrate is in `Ready` state.

```
  Uninitialized --> Initializing --> Ready <--> Degraded
                                      |            |
                                      v            v
                                       Shutdown <--+
```

**Five states:**

| State | Meaning |
|---|---|
| `Uninitialized` | Default. No initialization has begun. |
| `Initializing` | Schema migration or startup in progress. |
| `Ready` | Fully operational. Dispatch is permitted. |
| `Degraded` | Operational with reduced capability. Dispatch is blocked. |
| `Shutdown` | Terminal. No new operations accepted. No transitions out. |

**Valid transitions** are encoded in `is_valid_transition()`. Any other
transition returns `LifecycleError::InvalidTransition`. Self-transitions
(e.g., Ready -> Ready) are also invalid.

**Thread safety:** `LifecycleGuard` wraps the state in a `RwLock`. Multiple
threads can read the current state concurrently. State transitions acquire
a write lock. The `require_ready()` check at the top of
`run_commit_transaction_gated` is a read-lock operation, so concurrent
dispatches do not serialize against each other (only against state changes).

## 5. Chain Storage

The chain is an append-only, hash-chained audit log stored in SQLite.

**Schema:** Three tables:
- `chain_entries` -- one row per entry (committed or refused), keyed by
  `global_sequence`
- `tenant_chain_state` -- per-tenant sequence counter and last hash
- `global_chain_state` -- singleton row with the next global sequence number

**Commit path** (`commit_entry` in `limen_chain::commit`):

1. Acquire the Mutex-protected SQLite connection.
2. Begin an `IMMEDIATE` transaction (exclusive write lock from the start,
   preventing TOCTOU races).
3. Read current `next_global_sequence` and per-tenant sequence within the
   transaction.
4. Read the previous entry's `content_hash` for hash-chain linkage.
5. Build the entry struct with a zeroed `content_hash` placeholder.
6. Serialize the entry using canonical MessagePack (fixed-width format for
   deterministic hashing).
7. Compute `blake3(serialized_bytes)` and set it as the `content_hash`.
8. Insert the entry, update sequence counters, commit the transaction.

**Hash chaining:** Each entry's `previous_hash` field contains the
`content_hash` of the immediately preceding entry (by global sequence).
The first entry has `previous_hash = None`. This forms an unbroken chain
that `verify_chain` can validate end-to-end.

**Verification** (`verify_chain` in `limen_chain::verify`):

1. Read all entries ordered by `global_sequence`.
2. For each entry: recompute `blake3(payload)` and compare to the stored
   `content_hash`. If they differ, the payload was tampered with.
3. Check that each entry's `stored_previous_hash` matches the previous
   entry's `content_hash`. If they differ, the chain linkage is broken.
4. Hash byte arrays that are not exactly 32 bytes produce an
   `IntegrityViolation` error (they indicate storage corruption, not
   merely a mismatched hash).

**WAL mode:** The database uses SQLite WAL (Write-Ahead Logging) for
concurrent read access during writes. Sync mode is configurable:
`Normal` for development speed, `Full` for production durability.

## 6. Capability Sealing

Capabilities (`FoundationReadCapability`, `TransactionRuntimeContext`,
`OperationRuntimeEnvelope`) use Rust's type system to prevent forgery.
Each contains a private `_seal: PhantomData<*const ()>` field.

**How it works:**

- The `PhantomData<*const ()>` field is private to `limen_foundation_contract`.
- External crates cannot construct the struct because they cannot provide the
  private field.
- `PhantomData<*const ()>` also opts out of `Send` and `Sync`, so capabilities
  cannot cross thread boundaries. They are bound to the transaction that
  created them.
- Only `substrate_authority::mint_capability` and `mint_transaction_context`
  (module-private functions) can create these values.

**Compile-fail tests** prove this:

```rust
// tests/compile_fail/construct_foundation_capability.rs
// This MUST fail to compile:
let fake = FoundationReadCapability {
    reader: &reader,
    scope: TenantScope("t".into()),
    _seal: PhantomData,  // ERROR: field `_seal` is private
};
```

Three compile-fail tests exist: one for `FoundationReadCapability`, one for
`TransactionRuntimeContext`, and one for `OperationRuntimeEnvelope`. The
`trybuild` crate verifies that each fails with the expected compiler error.

## 7. Audit-Before-Success

The invariant: **`CommitDecision::Commit` is never returned to a caller
without a durable chain entry already written.**

This is enforced by fusing the chain write into the dispatch entry point:

```rust
// In run_commit_transaction_gated:
let outcome = execute_dispatch_loop(...);

if let CommitDecision::Commit { .. } = &outcome.decision {
    // Write chain entry BEFORE returning.
    // If this fails, the caller gets Err, never Commit.
    commit_sink.commit_entry(
        proposed, outcome.decision, outcome.verdicts,
        tenant_scope, commit_envelope,
    ).map_err(CommitTransactionError::ChainCommitFailed)?;
}

Ok(outcome.decision)
```

There is no code path where the function returns `Ok(CommitDecision::Commit)`
without having first successfully called `commit_sink.commit_entry()`. If the
sink fails (disk full, SQLite error, etc.), the error propagates and the
caller sees `Err(ChainCommitFailed)`, never `Commit`.

The `ChainCommitSink` trait is defined in `limen_foundation_contract` (not
`limen_chain`) so the dispatch loop can write chain entries without a
compile-time dependency on the storage crate. `SqliteChainStorage` implements
this trait in `limen_chain`.

## 8. For Adapter Developers

To build a new storage adapter (e.g., PostgreSQL, S3-backed), implement these
traits from `limen_foundation_contract`:

### ChainReadContext

```rust
pub trait ChainReadContext {
    fn read_entry(&self, seq: ChainSequence) -> Result<Option<ChainEntry>, ChainReadError>;
    fn read_tenant_state(&self, scope: &TenantScope) -> Result<TenantChainState, ChainReadError>;
    fn read_governance_state_at(&self, scope: &TenantScope, id: &PolicyId)
        -> Result<Option<GovernanceState>, ChainReadError>;
    fn read_authority_state_at(&self, scope: &TenantScope, actor: &Actor)
        -> Result<Vec<AuthorityState>, ChainReadError>;
    fn read_cascade_link(&self, hash: Blake3Hash) -> Result<Option<CascadeLink>, ChainReadError>;
    fn freshness_marker(&self) -> FreshnessMarker;
}
```

This is the read-side interface. The dispatch loop reads chain state through
this trait. Your adapter must provide transaction-consistent reads (the four
operations in a single dispatch must see the same chain state).

### ChainCommitSink

```rust
pub trait ChainCommitSink {
    fn commit_entry(
        &self,
        proposed: ProposedTransitionEnvelope,
        decision: CommitDecision,
        verdicts: VerdictSet,
        tenant_scope: TenantScope,
        commit_envelope: CommitEnvelope,
    ) -> Result<ChainEntry, String>;
}
```

This is the write-side interface. Your adapter MUST ensure durability before
returning `Ok`. The audit-before-success invariant depends on this contract.

### Key types (all in `limen_types`)

| Type | Description |
|---|---|
| `Blake3Hash([u8; 32])` | Content hash. Always exactly 32 bytes. |
| `ChainSequence(u64)` | Monotonic sequence number (global or per-tenant). |
| `TenantScope(String)` | Tenant isolation key. |
| `SubstrateInstant(u64)` | Substrate-controlled timestamp. |
| `CommitDecision` | `Commit { path }` or `Refused(reason)`. |
| `ChainEntry` | `Committed(CommittedEntry)` or `Refusal(RefusalEntry)`. |

### Key invariants

1. **Global sequence must be gap-free.** Entry N must have `global_sequence = N`.
2. **Hash chain must be unbroken.** Entry N's `previous_hash` must equal
   entry (N-1)'s `content_hash`. Entry 0 has `previous_hash = None`.
3. **Content hash is computed from the "hashable form"** -- the entry serialized
   with `content_hash` set to `[0; 32]`. The actual hash is stored in a
   separate column. `verify_chain` recomputes `blake3(payload)` and compares.
4. **Refusals are chain-linked.** Refused transitions get their own chain entry
   with the same hash-chain linkage as committed entries.
5. **Hash byte arrays must be exactly 32 bytes.** Any other length indicates
   storage corruption and must produce an error, not a silent zero-fill.
