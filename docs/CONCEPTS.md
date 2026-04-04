# Limen Concepts

This document explains the core concepts behind Limen's knowledge system. Read this before diving into the API.

---

## Subject URN Format

Every belief is stored against a **subject** — a URN (Uniform Resource Name) that identifies the entity the belief is about.

```
entity:<type>:<id>
```

- Exactly **3 colon-separated segments**
- The `entity:` prefix is fixed
- `<type>` is a lowercase alphabetic category (e.g., `user`, `project`, `market`, `decision`)
- `<id>` is a freeform identifier (e.g., `alice`, `alpha`, `ev-market-2025`)

Examples:

```
entity:user:alice
entity:project:limen
entity:decision:auth-redesign
entity:market:european-ev
```

Subjects support **wildcard recall**: `limen.recall('entity:user:*')` returns beliefs about all users. Trailing wildcards only.

---

## Predicate Format

The **predicate** describes what aspect of the subject the belief is about.

```
domain.property
```

- Exactly **2 dot-separated segments**
- `domain` groups related predicates (e.g., `preference`, `finding`, `decision`)
- `property` names the specific attribute (e.g., `food`, `performance`, `rationale`)

Examples:

```
preference.food          — what someone likes to eat
finding.performance      — a performance-related observation
decision.rationale       — why a decision was made
warning.gotcha           — a known pitfall
reflection.pattern       — an observed pattern
```

Predicates support **wildcard recall**: `limen.recall('entity:user:alice', 'preference.*')` returns all of Alice's preferences.

---

## Belief vs Claim

These two terms refer to the same underlying data, viewed from different perspectives:

| Term | Context | Type | Description |
|------|---------|------|-------------|
| **Belief** | User-facing (convenience API) | `BeliefView` | What you get from `remember()`, `recall()`, `search()`. Includes `effectiveConfidence` (after time-decay) and `freshness` label. |
| **Claim** | System-facing (claim protocol) | `ClaimApi` | What you get from `claims.assertClaim()`, `claims.queryClaims()`. Includes `evidence`, `groundingMode`, `missionId`, `taskId`. |

The convenience API (`remember`/`recall`/`search`/`forget`/`reflect`) wraps the claim protocol with simpler ergonomics. Use the convenience API for most use cases. Use the claim protocol when you need full provenance (evidence chains, mission context, typed IDs).

---

## Confidence Model

Every belief has a confidence score between **0.0 and 1.0**:

| Range | Meaning | Example |
|-------|---------|---------|
| 0.5 | Theoretical / speculative | Unverified hypothesis |
| 0.7 | Observed / default | Auto-extracted from conversation |
| 0.85 | Proven / demonstrated | Backed by test results |
| 0.95 | Validated / authoritative | Peer-reviewed, multi-source confirmed |

### Auto-extracted ceiling

Beliefs stored via the convenience API (`remember()`) are **capped at `maxAutoConfidence`** (default: 0.7). If you call `remember(subject, predicate, value, { confidence: 0.95 })`, the stored confidence is 0.7, not 0.95. This is **wrongness containment** — auto-extracted knowledge should not carry the same weight as evidence-grounded claims.

To store beliefs above the ceiling, use the claim protocol (`claims.assertClaim()`) with explicit evidence.

### FSRS Decay

Confidence decays over time using the **FSRS (Free Spaced Repetition Scheduler)** algorithm. The `effectiveConfidence` returned by `recall()` and `search()` reflects this decay. Older beliefs that are not accessed decay faster.

- `freshness: 'fresh'` — recently stored or accessed
- `freshness: 'aging'` — still useful but decaying
- `freshness: 'stale'` — significantly decayed, may need review

Access (recall/search) resets the decay clock, so frequently-used beliefs stay fresh.

---

## Retraction (forget)

`limen.forget(claimId, reason?)` performs a **soft delete**:

- The claim's status changes to `'retracted'`
- The claim **remains in the database** for audit continuity
- All relationships are preserved (for provenance tracing)
- Retracted claims are excluded from `recall()` and `search()` by default

This is not a hard delete. Data is never destroyed. If you need data erasure for compliance (GDPR right to erasure), use the governance API's `erasure` feature, which produces a cryptographic erasure certificate.

### Retraction Reasons

| Reason | When to use |
|--------|------------|
| `'incorrect'` | The belief was factually wrong |
| `'superseded'` | A newer, more accurate belief replaces it |
| `'expired'` | The belief is no longer relevant (time-bound) |
| `'manual'` | Default. Explicit user retraction without specific categorization |

---

## Result Pattern

All Limen operations return a `Result<T>` object. Always check `.ok` before accessing the value:

```typescript
const result = limen.recall('entity:user:alice');

if (result.ok) {
  // result.value is T (the success payload)
  console.log(result.value);
} else {
  // result.error has { code, message }
  console.error(result.error.code, result.error.message);
}
```

This applies to `remember()`, `recall()`, `search()`, `forget()`, `reflect()`, `connect()`, and all other operations. Never assume success — always branch on `.ok`.

Error codes are documented in [error-codes.md](./error-codes.md).
