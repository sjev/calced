#!/usr/bin/env node
/**
 * Test runner for the JS calced engine.
 * Imports the engine modules and runs:
 *   1. Unit vectors from tests/classify_vectors.json and tests/evaluate_vectors.json
 *   2. Integration tests from tests/*.md and web/docs.md
 */
import { readFileSync, readdirSync } from "fs";
import { basename, join, dirname } from "path";
import { fileURLToPath } from "url";
import { processText, classifyLine } from "./document.js";
import { evaluateLine } from "./evaluate.js";
import { formatResult } from "./format.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const testsDir = join(__dirname, "..", "tests");

// --- Unit vector tests ---
let unitFailures = 0;

const classifyVectors = JSON.parse(readFileSync(join(testsDir, "classify_vectors.json"), "utf8"));
for (let i = 0; i < classifyVectors.length; i++) {
  const v = classifyVectors[i];
  const result = classifyLine(v.text, v.variables);
  if (JSON.stringify(result) !== JSON.stringify(v.expected)) {
    console.error(`FAIL classify vector ${i}: ${JSON.stringify(v.text)}`);
    if (v.note) console.error(`  note: ${v.note}`);
    console.error(`  expected: ${JSON.stringify(v.expected)}`);
    console.error(`  got:      ${JSON.stringify(result)}`);
    unitFailures++;
  }
}

const evaluateVectors = JSON.parse(readFileSync(join(testsDir, "evaluate_vectors.json"), "utf8"));
for (let i = 0; i < evaluateVectors.length; i++) {
  const v = evaluateVectors[i];
  const [result] = evaluateLine(v.text, v.variables);
  // Date results go through the formatter, which is where the date/datetime
  // distinction lives.
  const resultVal = result !== null
    ? (result._isDate ? formatResult(result) : result.toNumber())
    : result;
  if (resultVal !== v.expected) {
    console.error(`FAIL evaluate vector ${i}: ${JSON.stringify(v.text)}`);
    console.error(`  expected: ${JSON.stringify(v.expected)}`);
    console.error(`  got:      ${JSON.stringify(resultVal)}`);
    unitFailures++;
  }
}

const unitTotal = classifyVectors.length + evaluateVectors.length;
if (unitFailures) {
  console.log(`FAIL unit vectors (${unitTotal - unitFailures}/${unitTotal} passed)`);
} else {
  console.log(`PASS unit vectors (${unitTotal}/${unitTotal} passed)`);
}


const RESULT_RE = /\s+# => .*$/;
const INDICATOR_RE = / [│┘]$/;

let totalTests = 0;
let totalPassed = 0;
let totalFailed = 0;
let failedFiles = [];

const files = readdirSync(testsDir).filter(f => f.endsWith(".md")).sort()
  .map(f => join(testsDir, f));
files.push(join(__dirname, "docs.md"));  // the docs must hold in both engines

for (const path of files) {
  const file = basename(path);
  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n");
  // Remove trailing empty line from split
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  // Build pure input (strip # => results) and collect expected results
  const inputLines = [];
  const expected = []; // {lineNum, expected} or null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(RESULT_RE);
    if (m) {
      const clean = line.replace(RESULT_RE, "").trimEnd();
      inputLines.push(clean);
      const expStr = m[0].replace(/^\s+# => /, "").replace(INDICATOR_RE, "").trimEnd();
      expected.push({ lineNum: i + 1, expected: expStr });
    } else {
      inputLines.push(line);
      expected.push(null);
    }
  }

  const pureInput = inputLines.join("\n");
  const results = processText(pureInput);

  let filePassed = 0;
  let fileFailed = 0;

  for (let i = 0; i < expected.length; i++) {
    if (expected[i] === null) continue;
    totalTests++;
    const exp = expected[i].expected;
    const got = results[i] && results[i].result !== null ? results[i].result : null;
    if (got === exp) {
      filePassed++;
      totalPassed++;
    } else {
      fileFailed++;
      totalFailed++;
      const lineNum = expected[i].lineNum;
      console.error(`  FAIL ${file}:${lineNum}: expected "${exp}", got "${got}"`);
    }
  }

  const status = fileFailed === 0 ? "PASS" : "FAIL";
  const counts = `${filePassed + fileFailed} tests, ${filePassed} passed`;
  console.log(`${status} ${file} (${counts})`);
  if (fileFailed > 0) failedFiles.push(file);
}

console.log();
console.log(`Total: ${totalTests} tests, ${totalPassed} passed, ${totalFailed} failed`);

if (totalFailed > 0) {
  process.exit(1);
}
