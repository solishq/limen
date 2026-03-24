/**
 * verify-proof-pack.ts — CI enforcement script for proof document freshness.
 *
 * Parses docs/proof/*.md, extracts file:line references, and verifies they
 * are not stale (file exists, line number within range).
 *
 * Design constraints:
 *   - Pure node:fs + node:path + node:readline — zero imports from production code
 *   - Runs as: npx tsx scripts/verify-proof-pack.ts
 *   - Exit 0 if all references valid, exit 1 if any stale
 *
 * Reference patterns matched (derived from actual proof document analysis):
 *   - Backtick-wrapped: `src/path/to/file.ts:123`
 *   - Bare in table cells: | src/path/file.ts:42 |
 *   - CI file refs: `.github/workflows/ci.yml:45`
 *   - Short-form in CI column: `ci.yml:45`
 *
 * Deliberately skipped:
 *   - File paths without line numbers (e.g., `tests/contract/test_contract_ccp.test.ts`)
 *   - Markdown links (e.g., [system-calls.md](./system-calls.md))
 *   - Prose references (invariant IDs, FM IDs, etc.)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileReference {
  /** The file path as written in the proof document (relative to project root). */
  filePath: string;
  /** The line number referenced. */
  lineNumber: number;
  /** Which proof document contains this reference. */
  proofDoc: string;
  /** Line number within the proof document where the reference appears. */
  proofLine: number;
}

interface ValidationResult {
  ref: FileReference;
  valid: boolean;
  reason?: string;
}

interface DocSummary {
  proofDoc: string;
  total: number;
  valid: number;
  stale: number;
  staleDetails: ValidationResult[];
  skipped: boolean;
  skipReason?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const PROOF_DIR = path.join(PROJECT_ROOT, 'docs', 'proof');

/**
 * Known short-form path expansions.
 *
 * Some proof documents use short-form file names (e.g., `ci.yml:45`) instead
 * of the full relative path. This map resolves them. If a referenced file
 * does not start with a path separator or known prefix and appears in this
 * map, the expansion is used.
 */
const SHORT_FORM_EXPANSIONS: Record<string, string> = {
  'ci.yml': '.github/workflows/ci.yml',
};

// ---------------------------------------------------------------------------
// Reference Extraction
// ---------------------------------------------------------------------------

/**
 * Primary regex: matches file:line references where the path contains at
 * least one `/` (directory separator). This is the structural filter that
 * distinguishes real file paths from prose fragments like "v3.3.0" or
 * informal filename mentions like "tenant_scope.ts:40".
 *
 * Captures:
 *   Group 1: full match (path:line)
 *   Group 2: file path
 *   Group 3: line number
 */
const FILE_LINE_PATTERN =
  /(?:^|[`|\s,(])(([a-zA-Z_.][\w./\-]*\/[\w./\-]*\.(?:ts|js|yml|yaml|json|md)):(\d+))(?=[`|\s,).;]|$)/g;

/**
 * Secondary regex: matches known short-form file references that lack a
 * directory separator. These are resolved via SHORT_FORM_EXPANSIONS.
 * Built dynamically from the SHORT_FORM_EXPANSIONS keys.
 */
function buildShortFormPattern(): RegExp | null {
  const keys = Object.keys(SHORT_FORM_EXPANSIONS);
  if (keys.length === 0) return null;
  // Escape regex special chars in keys
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(
    `(?:^|[\`|\\s,(])((?:${escaped.join('|')}):(\\d+))(?=[\`|\\s,).;]|$)`,
    'g',
  );
}

const SHORT_FORM_PATTERN = buildShortFormPattern();

/**
 * Extract all file:line references from a single line of text.
 *
 * Returns an array of {filePath, lineNumber} objects. Handles:
 *   - Multiple references per line (both full-path and short-form)
 *   - Short-form path expansion (e.g., ci.yml -> .github/workflows/ci.yml)
 *   - Trailing punctuation stripping (handled by regex lookahead)
 */
function extractReferences(
  line: string,
  proofDoc: string,
  proofLine: number,
): FileReference[] {
  const refs: FileReference[] = [];

  // Pass 1: full-path references (contain `/`)
  FILE_LINE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_LINE_PATTERN.exec(line)) !== null) {
    const filePath = match[2];
    const lineNumber = parseInt(match[3], 10);

    if (!lineNumber || lineNumber <= 0) continue;
    if (filePath.includes('://')) continue;

    refs.push({ filePath, lineNumber, proofDoc, proofLine });
  }

  // Pass 2: short-form references (no `/`, resolved via expansion map)
  if (SHORT_FORM_PATTERN) {
    SHORT_FORM_PATTERN.lastIndex = 0;
    while ((match = SHORT_FORM_PATTERN.exec(line)) !== null) {
      // match[1] is the full "file:line" portion, but we need the file and line separately.
      // The regex captures (filename:line) as group 1 and (line) as group 2.
      // We need to extract the filename from group 1 minus the ":line" suffix.
      const lineNumber = parseInt(match[2], 10);
      if (!lineNumber || lineNumber <= 0) continue;

      // Extract filename: full match group 1 = "ci.yml:45", strip ":45"
      const fullMatch = match[1];
      const fileName = fullMatch.substring(0, fullMatch.lastIndexOf(':'));
      const filePath = SHORT_FORM_EXPANSIONS[fileName];
      if (!filePath) continue;

      refs.push({ filePath, lineNumber, proofDoc, proofLine });
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// File Line Count Cache
// ---------------------------------------------------------------------------

const lineCountCache = new Map<string, number | null>();

/**
 * Get the number of lines in a file. Returns null if the file does not exist.
 * Results are cached for performance.
 */
function getLineCount(absolutePath: string): number | null {
  if (lineCountCache.has(absolutePath)) {
    return lineCountCache.get(absolutePath)!;
  }

  try {
    const content = fs.readFileSync(absolutePath, 'utf-8');
    // Count lines: split by newline. A file with no trailing newline still
    // has its last line counted. An empty file has 0 lines (or 1 if it has
    // a single empty line).
    const lines = content.split('\n');
    // If the file ends with a newline, the last element is empty string.
    // The "line count" for validation purposes is the number of non-empty
    // trailing-newline-adjusted lines. But for file:line references, line N
    // is valid if N <= total lines including the trailing empty one from split.
    // Actually: a file with content "a\nb\n" splits to ["a", "b", ""] which
    // is 3 elements but 2 real lines. Line 2 is valid, line 3 is not.
    // A file with "a\nb" (no trailing newline) splits to ["a", "b"] — 2 lines.
    //
    // The correct count: if file ends with \n, lines.length - 1. Otherwise lines.length.
    const count =
      content.length > 0 && content.endsWith('\n')
        ? lines.length - 1
        : lines.length;
    lineCountCache.set(absolutePath, count);
    return count;
  } catch {
    lineCountCache.set(absolutePath, null);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reference Validation
// ---------------------------------------------------------------------------

/**
 * Validate a single file:line reference.
 *
 * Checks:
 *   1. File exists (relative to project root)
 *   2. Line number is within the file's line count
 *
 * Optional (SHOULD, not MUST): checks if the line (with +/-3 tolerance)
 * contains a governance marker (I-XX, SC-XX, FM-XX pattern). This is
 * informational only and does not affect the valid/invalid determination.
 */
function validateReference(ref: FileReference): ValidationResult {
  const absolutePath = path.resolve(PROJECT_ROOT, ref.filePath);
  const lineCount = getLineCount(absolutePath);

  if (lineCount === null) {
    return {
      ref,
      valid: false,
      reason: `file not found`,
    };
  }

  if (ref.lineNumber > lineCount) {
    return {
      ref,
      valid: false,
      reason: `line out of range — file has ${lineCount} lines`,
    };
  }

  return { ref, valid: true };
}

// ---------------------------------------------------------------------------
// Proof Document Processing
// ---------------------------------------------------------------------------

/**
 * Process a single proof document. Reads it line by line, extracts all
 * file:line references, validates each, and returns a summary.
 */
async function processProofDoc(docPath: string): Promise<DocSummary> {
  const proofDoc = path.relative(PROJECT_ROOT, docPath);
  const refs: FileReference[] = [];

  const fileStream = fs.createReadStream(docPath, 'utf-8');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    const lineRefs = extractReferences(line, proofDoc, lineNum);
    refs.push(...lineRefs);
  }

  // If no references found, check if this is a links-only document
  if (refs.length === 0) {
    return {
      proofDoc,
      total: 0,
      valid: 0,
      stale: 0,
      staleDetails: [],
      skipped: true,
      skipReason: 'links only',
    };
  }

  // Validate all references
  const results = refs.map(validateReference);
  const validCount = results.filter((r) => r.valid).length;
  const staleResults = results.filter((r) => !r.valid);

  return {
    proofDoc,
    total: refs.length,
    valid: validCount,
    stale: staleResults.length,
    staleDetails: staleResults,
    skipped: false,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Check if proof directory exists
  if (!fs.existsSync(PROOF_DIR)) {
    console.log('verify-proof-pack: docs/proof/ does not exist — nothing to check');
    process.exit(0);
  }

  // Find all .md files in docs/proof/
  const entries = fs.readdirSync(PROOF_DIR);
  const mdFiles = entries
    .filter((e) => e.endsWith('.md'))
    .sort()
    .map((e) => path.join(PROOF_DIR, e));

  if (mdFiles.length === 0) {
    console.log('verify-proof-pack: no .md files in docs/proof/ — nothing to check');
    process.exit(0);
  }

  console.log('verify-proof-pack: checking docs/proof/*.md');

  // Process each document
  const summaries: DocSummary[] = [];
  for (const mdFile of mdFiles) {
    const summary = await processProofDoc(mdFile);
    summaries.push(summary);
  }

  // Print results
  let totalRefs = 0;
  let totalValid = 0;
  let totalStale = 0;

  for (const s of summaries) {
    if (s.skipped) {
      console.log(`  ${s.proofDoc}: 0 references (${s.skipReason}), skipped`);
      continue;
    }

    if (s.stale === 0) {
      console.log(`  ${s.proofDoc}: ${s.total} references, ${s.valid} valid`);
    } else {
      console.log(
        `  ${s.proofDoc}: ${s.total} references, ${s.valid} valid, ${s.stale} STALE`,
      );
      for (const detail of s.staleDetails) {
        console.log(
          `    STALE: ${detail.ref.filePath}:${detail.ref.lineNumber} (${detail.reason})`,
        );
      }
    }

    totalRefs += s.total;
    totalValid += s.valid;
    totalStale += s.stale;
  }

  // Print totals
  console.log('');
  console.log(
    `Total: ${totalRefs} references checked, ${totalValid} valid, ${totalStale} stale`,
  );

  if (totalStale > 0) {
    console.log(
      '\u2717 Proof pack has stale references — update docs/proof/ before merging',
    );
    process.exit(1);
  } else {
    console.log('\u2713 Proof pack is fresh');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('verify-proof-pack: fatal error:', err);
  process.exit(1);
});
