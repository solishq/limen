# Security Model

Limen treats security as infrastructure, not an add-on. Every layer of the architecture enforces security properties independently.

---

## Threat Model

Limen protects against:

1. **Agent misbehavior** — Agents interact only through 16 system calls. They cannot bypass the governance layer, write to the database directly, modify their own capabilities, or mutate completed artifacts.

2. **Data leakage** — Multi-tenant isolation (row-level or database-level) prevents cross-tenant access. Error messages are redacted at the API boundary — internal details (SQL, stack traces, file paths) are never exposed.

3. **Audit tampering** — The audit trail is append-only and hash-chained (SHA-256). No entry can be modified or deleted. Hash chain integrity is verified on demand.

4. **Provider trust** — LLM provider responses are treated as untrusted input. Tool calls are structurally validated. Response sizes are capped at 10 MB. Streaming has stall detection and event limits.

5. **Key compromise** — API keys are resolved once at adapter creation and never logged, included in error messages, or stored in the database.

---

## Encryption at Rest (I-11)

All sensitive data stored in SQLite is encrypted with AES-256-GCM.

| Property | Value |
|---|---|
| Algorithm | AES-256-GCM |
| Key length | 256 bits (32 bytes) |
| IV length | 96 bits (12 bytes, per NIST SP 800-38D) |
| Auth tag | 128 bits |
| Key derivation | PBKDF2 (600,000 iterations) |
| Implementation | Node.js built-in `crypto` module |

The `masterKey` provided to `createLimen()` must be at least 32 bytes. Limen uses PBKDF2 to derive encryption subkeys from the master key. Each encryption operation uses a unique random IV.

---

## Audit Trail (I-03, I-06)

Every state mutation is recorded in the audit trail within the **same database transaction** as the mutation itself (I-03). This is not eventual — it is atomic.

Properties:
- **Append-only**: No UPDATE or DELETE on audit entries. Enforced by SQLite triggers.
- **Hash-chained**: SHA-256 chain. Each entry includes the hash of the previous entry.
- **Monotonic**: Sequence numbers are strictly increasing.
- **Tamper-evident**: Verification walks the chain and checks every hash. A single modified entry breaks the chain.
- **Genesis anchor**: Chain starts from SHA-256 of empty string (well-known constant).

```typescript
// Verify audit chain integrity
const health = await limen.health();
console.log(health.subsystems.audit); // { status: 'healthy', chainValid: true }
```

---

## Authorization (I-13)

RBAC (Role-Based Access Control) is checked on every operation. Five default roles:

| Role | Permissions |
|---|---|
| `admin` | All operations including role management and data purge |
| `developer` | Create/modify agents, chat, infer, create missions, view telemetry |
| `operator` | Chat, view telemetry |
| `viewer` | View telemetry only |
| `auditor` | View telemetry, view audit trail |

In single-user mode (the default), RBAC is dormant — all operations are permitted. In multi-tenant mode, every operation requires an `OperationContext` with a valid role.

---

## Multi-Tenant Isolation (I-07)

Two isolation modes:

| Mode | Mechanism | Use Case |
|---|---|---|
| `row-level` | Tenant ID column on every table, enforced by scoped connections | Multiple tenants in one database |
| `database` | Separate SQLite file per tenant | Maximum isolation |

Row-level isolation uses a `TenantScopedConnection` that automatically filters all queries by tenant ID. There is no way to bypass the scope from the API surface.

---

## Transport Security

| Protection | Description |
|---|---|
| TLS enforcement | Non-TLS URLs rejected (except localhost/127.0.0.1) |
| Response size cap | 10 MB maximum response body |
| SSE line limit | 1 MB per SSE line |
| SSE event limit | 100,000 events per stream |
| Stall detection | 30s timeout on data gaps |
| First-byte timeout | 30s to receive first streaming byte |
| Total stream timeout | 10 minutes maximum |
| Retry-After cap | 60s maximum (rejects longer values) |
| API key isolation | Resolved once at creation, never logged or stored |

---

## Error Redaction

All errors at the API boundary are `LimenError` instances. Internal details are automatically redacted:

- SQL statements
- File paths
- Stack traces
- SQLite error codes
- Dependency internals (`better-sqlite3`, `node_modules`)
- Sensitive tokens (API keys, passwords, credentials)

If a message matches any redaction pattern, it is replaced with a generic safe message for that error code. Stack traces are replaced with a minimal, non-revealing format.

---

## Governance Boundary (I-17)

Agent output never directly mutates state. The flow is always:

```
Agent → System Call → Validation → State Mutation + Audit Entry
```

The 16 system calls are the only interface between agents and infrastructure. Each call validates the proposal before any state change occurs. This is structural — the layer architecture makes it impossible for agent code to reference kernel or substrate internals.

---

## Reporting Vulnerabilities

See [SECURITY.md](../SECURITY.md) for responsible disclosure policy.
