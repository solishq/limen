/**
 * Limen CLI Output — JSON-only stdout/stderr formatting.
 *
 * Every command writes valid JSON to stdout.
 * Errors go to stderr as JSON.
 */

/**
 * Custom error class that carries a machine-readable error code.
 * Used to propagate engine error codes (CONV_INVALID_CONFIDENCE, etc.)
 * through the CLI layer without losing the code on a plain Error.
 */
export class CliError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CliError';
    this.code = code;
  }
}

export function writeResult(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

export function writeError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  let code = 'UNKNOWN';
  if (error instanceof CliError) {
    code = error.code;
  } else if (error instanceof Error && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    code = (error as { code: string }).code;
  }
  process.stderr.write(JSON.stringify({ error: { code, message } }, null, 2) + '\n');
}
