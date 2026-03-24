/**
 * Limen CLI Output — JSON-only stdout/stderr formatting.
 *
 * Every command writes valid JSON to stdout.
 * Errors go to stderr as JSON.
 */

export function writeResult(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

export function writeError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code ?? 'UNKNOWN';
  process.stderr.write(JSON.stringify({ error: { code, message } }, null, 2) + '\n');
}
