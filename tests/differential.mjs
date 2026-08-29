#!/usr/bin/env node
// Runs the JS engine over documents given as JSON on stdin, prints results as JSON.
// Used by tests/test_differential.py to compare the two engines line by line.
import { readFileSync } from "fs";
import { processText } from "../web/document.js";

const docs = JSON.parse(readFileSync(0, "utf-8"));
const out = docs.map((doc) =>
  processText(doc.join("\n")).map((r) => (r && r.result != null ? String(r.result).trim() : null))
);
process.stdout.write(JSON.stringify(out));
