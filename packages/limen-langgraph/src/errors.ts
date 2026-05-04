/**
 * @limen-ai/langgraph — Error types
 *
 * Design doc: Appendix A.2
 * 4 error classes, each with structured context for diagnostics.
 */

// ---------------------------------------------------------------------------
// LimenGovernanceError — Claim 4.1-4.7
// Thrown when a read is blocked by projection validity state.
// ---------------------------------------------------------------------------

export interface LimenGovernanceErrorOptions {
  /** Current validity state that caused the rejection */
  state: string;
  /** Whether the consumer should retry (Lagging, Rebuilding = true) */
  retryable: boolean;
  /** Human-readable reason for rejection */
  reason?: string;
  /** Actionable guidance for recovery */
  guidance?: string;
}

export class LimenGovernanceError extends Error {
  readonly state: string;
  readonly retryable: boolean;
  readonly reason?: string;
  readonly guidance?: string;

  constructor(options: LimenGovernanceErrorOptions) {
    const msg = options.guidance
      ? `Governance rejection: state=${options.state} — ${options.guidance}`
      : `Governance rejection: state=${options.state}`;
    super(msg);
    this.name = 'LimenGovernanceError';
    this.state = options.state;
    this.retryable = options.retryable;
    this.reason = options.reason;
    this.guidance = options.guidance;
  }
}

// ---------------------------------------------------------------------------
// LimenStorageError — Claim 8.16, 8.18, 3.23
// Thrown on chain/projection storage failures.
// ---------------------------------------------------------------------------

export class LimenStorageError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(`Storage error: ${detail}`);
    this.name = 'LimenStorageError';
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// LimenSerdeError — Claim 6.3, 6.3.1, 8.11
// Thrown on serialization/deserialization failures.
// ---------------------------------------------------------------------------

export interface LimenSerdeErrorOptions {
  typeTag: string;
  dataLength: number;
  cause: Error;
  /** Context for JSON.parse failures: 'metadata_json' | 'value_json' */
  context?: string;
  /** Row identifier for diagnostics */
  rowId?: string;
}

export class LimenSerdeError extends Error {
  readonly typeTag: string;
  readonly dataLength: number;
  override readonly cause: Error;
  readonly context?: string;
  readonly rowId?: string;

  constructor(options: LimenSerdeErrorOptions) {
    super(`Serde error: typeTag=${options.typeTag}, dataLength=${options.dataLength}`);
    this.name = 'LimenSerdeError';
    this.typeTag = options.typeTag;
    this.dataLength = options.dataLength;
    this.cause = options.cause;
    this.context = options.context;
    this.rowId = options.rowId;
  }
}

// ---------------------------------------------------------------------------
// LimenNotStartedError — Claim 8.12, 3.27
// Thrown when a public method is called before start().
// ---------------------------------------------------------------------------

export class LimenNotStartedError extends Error {
  constructor(message = 'Call start() before use') {
    super(message);
    this.name = 'LimenNotStartedError';
  }
}
