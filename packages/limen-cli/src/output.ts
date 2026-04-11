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

/**
 * FP-08 fix: Write raw text to stdout without JSON wrapping.
 * Used by `context --format text` so users can pipe directly into files
 * without needing `jq -r .text`. Text is emitted exactly as produced plus
 * a single trailing newline.
 */
export function writeRawText(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}

/**
 * FP-04 fix: Round a floating-point number to 4 decimal places.
 * Strips FSRS/floating-point noise from output (e.g. 0.6999999011124111 → 0.7).
 * Returns null unchanged (for nullable fields like lastAccessedAt).
 */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
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
