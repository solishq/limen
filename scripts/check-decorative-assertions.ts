// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * AST-based check for decorative assertions (Hard Ban #8).
 *
 * Why this exists: grep-based checks produce false positives on comments
 * and string literals. This script uses the TypeScript compiler API to
 * find actual call expressions that are decorative assertions.
 *
 * Decorative assertions are assertions that pass regardless of the
 * implementation under test:
 *   - assert.ok(true)
 *   - assert.ok(1)
 *   - assert.equal(true, true)
 *   - expect(...).toBeTruthy() with no meaningful argument
 *
 * The scaffold/ directory is excluded — scaffolds are placeholders by design.
 */

import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const SEARCH_DIRS = [
  join(PROJECT_ROOT, 'src'),
  join(PROJECT_ROOT, 'tests'),
];
const EXCLUDE_DIRS = ['scaffold', 'node_modules', '.stryker-tmp'];

interface Violation {
  file: string;
  line: number;
  text: string;
}

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (EXCLUDE_DIRS.includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

function isLiteralTrue(node: ts.Node): boolean {
  return node.kind === ts.SyntaxKind.TrueKeyword;
}

function isLiteralOne(node: ts.Node): boolean {
  return ts.isNumericLiteral(node) && node.text === '1';
}

function isDecorativeAssertion(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;

  const expr = node.expression;

  // assert.ok(true) or assert.ok(1)
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'assert' &&
    expr.name.text === 'ok' &&
    node.arguments.length === 1
  ) {
    const arg = node.arguments[0];
    if (isLiteralTrue(arg) || isLiteralOne(arg)) return true;
  }

  // assert.equal(true, true)
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'assert' &&
    (expr.name.text === 'equal' || expr.name.text === 'strictEqual') &&
    node.arguments.length >= 2
  ) {
    if (isLiteralTrue(node.arguments[0]) && isLiteralTrue(node.arguments[1])) {
      return true;
    }
  }

  // .toBeTruthy() — only flag when called on expect() with no args or literal true
  if (
    ts.isPropertyAccessExpression(expr) &&
    expr.name.text === 'toBeTruthy' &&
    node.arguments.length === 0
  ) {
    return true;
  }

  return false;
}

function findDecorative(filePath: string): Violation[] {
  const source = readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );

  const violations: Violation[] = [];

  function visit(node: ts.Node): void {
    if (isDecorativeAssertion(node)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      violations.push({
        file: relative(process.cwd(), filePath),
        line: line + 1,
        text: source.split('\n')[line].trim(),
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

const files = SEARCH_DIRS.flatMap(d => collectTsFiles(d));
const allViolations: Violation[] = [];

for (const file of files) {
  allViolations.push(...findDecorative(file));
}

if (allViolations.length > 0) {
  console.error(`Found ${allViolations.length} decorative assertion(s) (Hard Ban #8):\n`);
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  process.exit(1);
} else {
  console.log(`Checked ${files.length} files — no decorative assertions found.`);
  process.exit(0);
}
