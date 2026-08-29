// Autocomplete suggestions. No DOM.
import { BUILTIN_FUNC_NAMES, BUILTIN_CONSTS } from "./builtins.js";
import { UNIT_LOOKUP } from "./units.js";
import { DATE_KEYWORDS, DURATION_UNITS } from "./dates.js";

// Autocomplete vocabulary. The engine tables above are the source of truth for
// functions, constants, units and date words. Only the lists that the engine
// keeps inside a regex or an inline literal are repeated here.
const SUGGEST_DIRECTIVES = [
  ["@format", "@format = ", "number output format"],
  ["@separator", "@separator = ", "thousands separator"],
  ["@rate", "@rate ", "rate: @rate USD/EUR = 0.92"],
];
const SUGGEST_FORMATS = [
  ["minSig", "minSig(10)", "at least N significant digits"],
  ["fixed", "fixed(2)", "N digits after the point"],
  ["scientific", "scientific(3)", "1.23e+6"],
  ["eng", "eng(3)", "SI suffix: 1.23M"],
  ["auto", "auto", "shortest exact form"],
];
const SUGGEST_SEPARATORS = [
  ["off", "1000000"],
  ["underscore", "1_000_000"],
  ["comma", "1,000,000"],
  ["space", "1 000 000"],
];
const SUGGEST_KEYWORDS = {
  of: "50% of 300",
  as: "10 as % of 50",
  "in": "convert: 5 km in miles",
  to: "convert: 5 km to miles",
  total: "sum of the lines above",
  sum: "sum of the lines above",
  until: "days until 2026-12-31",
  since: "days since 2026-01-01",
};
const SUGGEST_FUNC_DESC = {
  sqrt: "square root", abs: "absolute value", floor: "round down",
  ceil: "round up", log: "natural logarithm", log2: "base-2 logarithm",
  log10: "base-10 logarithm", sin: "sine, radians", cos: "cosine, radians",
  tan: "tangent, radians", asin: "inverse sine", acos: "inverse cosine",
  atan: "inverse tangent", exp: "e to the power x",
  round: "round(x) or round(x, digits)", min: "smallest argument",
  max: "largest argument",
};
const SUGGEST_CONST_DESC = { pi: "3.14159...", e: "2.71828...", tau: "2 * pi" };
const SUGGEST_KIND_RANK = { variable: 0, constant: 1, function: 2, keyword: 3, unit: 4 };
const MAX_SUGGESTIONS = 12;
// The general vocabulary is large, so one typed character matches too much.
// It opens on the second character. The narrow lists after "@" or "in" do not.
const MIN_PREFIX = 2;
const IDENT_RE = /[A-Za-z_]\w*$/;
const ASSIGN_RE = /^\s*([A-Za-z_]\w*)\s*=/;
const SUGGEST_RATE_RE = /^\s*@rate\s+(\w+)\s*\/\s*(\w+)\s*=/i;

// Where the caret goes after the text is inserted. "sqrt()" puts it between the
// parentheses; "fixed(2)" selects the 2 so that typing replaces it.
function _cursorFor(insert) {
  const m = insert.match(/\((\d*)\)$/);
  if (!m) return [insert.length, insert.length];
  const start = insert.length - 1 - m[1].length;
  return [start, start + m[1].length];
}

function _item(name, insert, desc, kind) {
  return { name, insert, desc, kind, cursor: _cursorFor(insert) };
}

// Variables assigned on the lines above the caret, newest value wins.
function _docVars(head, values) {
  const found = new Map();
  for (const line of head.split("\n")) {
    if (/^\s*[@#]/.test(line)) continue;
    const m = line.match(ASSIGN_RE);
    if (m) found.set(m[1].toLowerCase(), true);
  }
  const out = [];
  for (const name of found.keys()) {
    out.push(_item(name, name, values[name] || "variable", "variable"));
  }
  return out;
}

// Currency codes named by the @rate lines above the caret.
function _rateCurrencies(head) {
  const out = new Set();
  for (const line of head.split("\n")) {
    const m = line.match(SUGGEST_RATE_RE);
    if (m) { out.add(m[1].toLowerCase()); out.add(m[2].toLowerCase()); }
  }
  return out;
}

function _pick(cands, prefix, caret, force) {
  const start = caret - prefix.length;
  if (!prefix && !force) return { items: [], start, end: caret };
  const p = prefix.toLowerCase();
  const seen = new Set();
  const items = [];
  for (const c of cands) {
    if (seen.has(c.name) || !c.name.toLowerCase().startsWith(p)) continue;
    seen.add(c.name);
    items.push(c);
  }
  items.sort((a, b) =>
    (SUGGEST_KIND_RANK[a.kind] ?? 9) - (SUGGEST_KIND_RANK[b.kind] ?? 9)
    || a.name.length - b.name.length
    || (a.name < b.name ? -1 : 1));
  return { items: items.slice(0, MAX_SUGGESTIONS), start, end: caret };
}

// Unit names of one dimension, or of every dimension when dim is null. With no
// prefix to narrow the list down, aliases of the same unit collapse into one
// row so that the whole dimension stays visible.
function _unitItems(dim, prefix) {
  const names = Object.keys(UNIT_LOOKUP).filter(n => !dim || UNIT_LOOKUP[n][0] === dim);
  if (prefix) return names.map(n => _item(n, n, UNIT_LOOKUP[n][0], "unit"));
  const groups = new Map();
  for (const n of names) {
    const key = UNIT_LOOKUP[n][0] + ":" + UNIT_LOOKUP[n][1];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  const out = [];
  for (const group of groups.values()) {
    const short = group.reduce((a, b) => (b.length < a.length ? b : a));
    // The dimension is only worth showing when the list mixes dimensions.
    const parts = (dim ? [] : [UNIT_LOOKUP[short][0]]).concat(group.filter(n => n !== short));
    out.push(_item(short, short, parts.join(", ") || UNIT_LOOKUP[short][0], "unit"));
  }
  return out;
}

/**
 * Suggestions for the caret position. Pure: no DOM, no engine state.
 * `values` maps a lower-case variable name to its rendered value, for the
 * description column only. `force` shows the whole list on an empty word.
 * Returns { items, start, end }; replace text[start..end) with item.insert.
 */
function suggest(text, caret, force, values) {
  values = values || {};
  const none = { items: [], start: caret, end: caret };
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const before = text.slice(lineStart, caret);
  if (/^\s*#/.test(before)) return none;
  const head = text.slice(0, lineStart);

  let m = before.match(/^\s*@format\s*=\s*(\w*)$/i);
  if (m) return _pick(SUGGEST_FORMATS.map(([n, i, d]) => _item(n, i, d, "value")), m[1], caret, force);

  m = before.match(/^\s*@separator\s*=\s*(\w*)$/i);
  if (m) return _pick(SUGGEST_SEPARATORS.map(([n, d]) => _item(n, n, d, "value")), m[1], caret, force);

  m = before.match(/^\s*@(\w*)$/);
  if (m) return _pick(SUGGEST_DIRECTIVES.map(([n, i, d]) => _item(n, i, d, "value")), "@" + m[1], caret, force);

  // "<unit> in|to <unit>" -- offer only targets that can be converted to.
  m = before.match(/\b(?:in|to)\s+(\w*)$/i);
  if (m) {
    const lhs = ((before.slice(0, before.length - m[0].length).match(/(\w+)\s*$/) || [])[1] || "").toLowerCase();
    const currencies = _rateCurrencies(head);
    const cands = [];
    if (currencies.has(lhs)) {
      for (const c of currencies) if (c !== lhs) cands.push(_item(c, c, "currency", "unit"));
    } else {
      const dim = UNIT_LOOKUP[lhs] ? UNIT_LOOKUP[lhs][0] : null;
      cands.push(..._unitItems(dim, m[1]));
      if (!dim) for (const c of currencies) cands.push(_item(c, c, "currency", "unit"));
    }
    if (cands.length) return _pick(cands, m[1], caret, force);
  }

  const w = before.match(IDENT_RE);
  const prefix = w ? w[0] : "";
  if (prefix.length < MIN_PREFIX && !force) return { items: [], start: caret - prefix.length, end: caret };
  const cands = _docVars(head, values);
  for (const c of Object.keys(BUILTIN_CONSTS)) cands.push(_item(c, c, SUGGEST_CONST_DESC[c] || "constant", "constant"));
  for (const f of BUILTIN_FUNC_NAMES) cands.push(_item(f, f + "()", SUGGEST_FUNC_DESC[f] || "function", "function"));
  for (const [k, d] of Object.entries(SUGGEST_KEYWORDS)) cands.push(_item(k, k, d, "keyword"));
  for (const k of DATE_KEYWORDS) cands.push(_item(k, k, "date", "keyword"));
  for (const u of DURATION_UNITS) cands.push(_item(u, u, "duration", "keyword"));
  // Units are the largest group, so they need a prefix to narrow them down.
  if (prefix) for (const name of Object.keys(UNIT_LOOKUP)) cands.push(_item(name, name, UNIT_LOOKUP[name][0], "unit"));
  return _pick(cands, prefix, caret, force);
}

export { suggest, ASSIGN_RE };
