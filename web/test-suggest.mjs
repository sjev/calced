#!/usr/bin/env node
/**
 * Tests for the autocomplete suggestion function.
 * Imports the suggest module. It touches no DOM, so it runs in plain node.
 */
import { suggest } from "./suggest.js";

let failures = 0;
function check(label, ok, extra) {
  if (ok) return;
  failures++;
  console.error(`  FAIL ${label}${extra ? ": " + extra : ""}`);
}

// caret is marked with "|" in the test text
function ask(marked, force, values) {
  const caret = marked.indexOf("|");
  const text = marked.slice(0, caret) + marked.slice(caret + 1);
  return suggest(text, caret, !!force, values);
}
const names = (marked, force, values) => ask(marked, force, values).items.map(i => i.name);

// --- variables ---
{
  const r = ask("price = 100\nqty = 3\npr|", false, { price: "100" });
  check("variable first", r.items[0] && r.items[0].name === "price", JSON.stringify(names("price = 100\nqty = 3\npr|")));
  check("variable value shown", r.items[0] && r.items[0].desc === "100", r.items[0] && r.items[0].desc);
  check("replaces the whole word", r.start === "price = 100\nqty = 3\n".length && r.end === r.start + 2);
  check("no variable from below the caret", !names("q|\nqty = 3").includes("qty"));
  check("@rate is not a variable", !names("@rate USD/EUR = 0.92\nra|").includes("rate"));
}

// --- functions ---
{
  const r = ask("sq|");
  check("sqrt offered", r.items.some(i => i.name === "sqrt"));
  const f = r.items.find(i => i.name === "sqrt");
  check("function inserts parens", f && f.insert === "sqrt()", f && f.insert);
  check("caret goes inside the parens", f && f.cursor[0] === 5 && f.cursor[1] === 5, f && JSON.stringify(f.cursor));
}

// --- constants and keywords ---
check("pi offered", names("2 * pi|").includes("pi"));
check("one character is too short", names("2 * p|").length === 0, JSON.stringify(names("2 * p|")));
check("one character still opens on force", names("2 * p|", true).includes("pi"));
check("date() offered", names("da|").includes("date()"));
check("now() offered", names("no|").includes("now()"));
check("today no longer offered", !names("tod|").includes("today"));
check("sum() offered", names("su|").includes("sum()"));
// The caret belongs after the parens, not between them.
const sumItem = ask("su|").items.find(i => i.name === "sum()");
check("sum() caret after parens", sumItem && sumItem.cursor[0] === 5, JSON.stringify(sumItem));
// A variable named "sum" must not dedup the sum() entry away.
check("sum() survives a sum variable",
  names("sum = 1\nsu|").includes("sum()"));

// --- directives ---
{
  const r = ask("@|");
  check("directives offered", JSON.stringify(r.items.map(i => i.name)) === '["@rate","@format","@separator"]', JSON.stringify(r.items.map(i => i.name)));
  check("directive replaces the @", r.start === 0 && r.end === 1);
  const fmt = ask("@f|").items[0];
  check("@format chains into its values", fmt && fmt.insert === "@format = ", fmt && fmt.insert);

  const modes = names("@format = |", true);
  check("format modes", JSON.stringify(modes) === '["eng","auto","fixed","minSig","scientific"]', JSON.stringify(modes));
  const fixed = ask("@format = f|").items[0];
  check("fixed(2) selects the digits", fixed && fixed.insert === "fixed(2)" && fixed.cursor[0] === 6 && fixed.cursor[1] === 7,
    fixed && fixed.insert + " " + JSON.stringify(fixed.cursor));

  const seps = names("@separator = |", true);
  check("separator values", JSON.stringify(seps) === '["off","comma","space","underscore"]', JSON.stringify(seps));
}

// --- unit conversion ---
{
  const r = ask("5 km in |", true);
  const u = r.items.map(i => i.name);
  check("whole length dimension fits", ["mm", "cm", "m", "km", "in", "ft", "yd", "mi"].every(n => u.includes(n)), JSON.stringify(u));
  check("aliases move to the description", r.items.some(i => i.name === "mi" && i.desc.includes("miles")),
    JSON.stringify(r.items.map(i => i.desc)));
  check("other dimensions filtered out", !u.includes("kg") && !u.includes("gb"), JSON.stringify(u));
  check("a typed prefix keeps the long names", names("5 km to mil|").includes("miles"), JSON.stringify(names("5 km to mil|")));
  check("'in' after a number is the unit inch", names("5 in |", true).includes("ft"));
  check("mass stays mass", names("5 kg in |", true).every(n => !["mi", "cm"].includes(n)));
  check("rate currency offered", names("@rate USD/EUR = 0.92\n100 USD in |", true).includes("eur"));
  check("only currencies after a currency", !names("@rate USD/EUR = 0.92\n100 USD in |", true).includes("mi"));
  const mixed = ask("foo in |", true).items.map(i => i.desc.split(",")[0]);
  check("unknown left side offers every dimension", new Set(mixed).size > 1, JSON.stringify(mixed));
}

// --- quiet where it should be ---
check("comment line", names("# a comment |", true).length === 0);
check("empty word needs force", names("2 + |").length === 0);
check("force fills an empty word", names("2 + |", true).length > 0);
check("caret at start of an empty document", names("|", true).length > 0);
check("result capped", names("|", true).length <= 12);

console.log(failures ? `FAIL suggest (${failures} failed)` : "PASS suggest");
if (failures) process.exit(1);
