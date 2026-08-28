#!/usr/bin/env node
// Runs the JS engine over documents given as JSON on stdin, prints results as JSON.
// Used by tests/test_differential.py to compare the two engines line by line.
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const htmlPath = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "index.html");
const html = readFileSync(htmlPath, "utf-8");
const code = html.slice(html.indexOf("// -- CALCED ENGINE BEGIN --"), html.indexOf("// END CALCED ENGINE"));
const { processText } = new Function(code + "\nreturn { processText };")();

const docs = JSON.parse(readFileSync(0, "utf-8"));
const out = docs.map((doc) =>
  processText(doc.join("\n")).map((r) => (r && r.result != null ? String(r.result).trim() : null))
);
process.stdout.write(JSON.stringify(out));
