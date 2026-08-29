// Document layer: classify each line, drive the engine, align the output.
import { Big, BUILTIN_CONSTS } from "./builtins.js";
import { _isDateObj } from "./dates.js";
import { tokenize } from "./tokenize.js";
import {
  evaluateLine, _detectConversion, _buildMath, _tryParse, _reduceDateSubexprs, _tryDateEval,
} from "./evaluate.js";
import { DEFAULT_FMT_OPTS, formatResult } from "./format.js";

const DIRECTIVE_RE = /^@(format|separator)\s*=\s*(.+)$/i;
const FORMAT_RE = /^(minSig|fixed|scientific|eng|auto)(?:\((\d+)\))?$/i;
const RATE_RE = /^@rate\s+(\w+)\/(\w+)\s*=\s*(.+)$/i;

function classifyLine(text, variables, rates) {
  const stripped = text.trim();
  if (!stripped) return "blank";
  if (stripped.startsWith("#")) return "comment";
  if (DIRECTIVE_RE.test(stripped)) return "directive";
  if (RATE_RE.test(stripped)) return "directive";

  variables = variables || Object.create(null);
  let tokens = tokenize(text);
  const allNames = new Set();
  for (const k in BUILTIN_CONSTS) allNames.add(k);
  for (const k in variables) allNames.add(k);

  const hasDate = tokens.some(t =>
    t[0] === "DATE" || (t[0] === "WORD" && _isDateObj(variables[t[1].toLowerCase()]))
  );

  const hasMath = tokens.some(t =>
    t[0] === "NUM" || t[0] === "PCT" || t[0] === "FUNC" || t[0] === "TOTAL" || t[0] === "DATE"
    || (t[0] === "WORD" && allNames.has(t[1].toLowerCase()))
  );

  const active = new Set();

  if (hasDate && hasMath) {
    // A date expression is active as a whole
    if (_tryDateEval(tokens, variables) !== null) {
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i][0] !== "EOF") active.add(i);
      }
    } else {
      tokens = _reduceDateSubexprs(tokens, variables);
    }
  }
  if (hasMath && active.size === 0) {
    if (tokens.some(t => t[0] === "TOTAL")
        && !tokens.some(t => t[0] === "NUM" || t[0] === "PCT" || t[0] === "FUNC" || t[0] === "WORD" || t[0] === "LPAREN")) {
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i][0] === "TOTAL") active.add(i);
      }
    } else {
      let mathStart = 0;
      if (tokens.length >= 3 && tokens[0][0] === "WORD" && tokens[1][0] === "EQ") {
        active.add(0);
        active.add(1);
        mathStart = 2;
      }

      const conv = _detectConversion(tokens, rates);
      const [conversion, convStart, convEnd] = conv;
      if (conversion !== null) {
        for (let ci = convStart; ci < convEnd; ci++) active.add(ci);
      }

      const allVars = Object.create(null);
      for (const k in BUILTIN_CONSTS) allVars[k] = BUILTIN_CONSTS[k];
      for (const k in variables) allVars[k] = variables[k];
      allVars['total'] = 0; allVars['sum'] = 0;
      const [mathTokens, mathToOrig] = _buildMath(tokens, mathStart, allVars, conv);
      const [result, consumed] = _tryParse(mathTokens);

      if (result !== null) {
        for (let i = 0; i < consumed; i++) active.add(mathToOrig[i]);
      } else {
        for (let i = 0; i < mathToOrig.length; i++) {
          if (mathTokens[i][0] === "NUM" || mathTokens[i][0] === "PCT") {
            active.add(mathToOrig[i]);
          }
        }
      }
    }
  }

  const spans = [];
  let pos = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t[0] === "EOF") break;
    const start = t[2], end = t[3];
    if (start > pos) spans.push([pos, start, true]);
    spans.push([start, end, !active.has(i)]);
    pos = end;
  }
  if (pos < text.length) spans.push([pos, text.length, true]);
  return spans;
}

function escapeHTML(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function highlightLine(text, cls) {
  if (cls === "blank") return "";
  if (cls === "comment") return '<span class="hl-comment">' + escapeHTML(text) + '</span>';
  if (cls === "directive") return '<span class="hl-dim">' + escapeHTML(text) + '</span>';
  let html = "";
  for (const [start, end, dim] of cls) {
    const chunk = escapeHTML(text.substring(start, end));
    html += dim ? '<span class="hl-dim">' + chunk + '</span>' : chunk;
  }
  return html;
}

const RESULT_RE = /\s{2,}# => .*$/;
const ALIGNABLE_RE = /^-?[\d_, ]+(\.\d+)?$/;

function splitSections(output, lines) {
  const sections = [];
  let cur = [];
  for (let i = 0; i < output.length; i++) {
    if (output[i].result === null && lines[i].trim().startsWith("#")) {
      if (cur.length) sections.push(cur);
      cur = [i];
    } else {
      cur.push(i);
    }
  }
  if (cur.length) sections.push(cur);
  return sections;
}

function computeTotalIndicators(output, lines) {
  // Returns array: null, "summed", or "total" per line
  const indicators = new Array(output.length).fill(null);
  const sections = splitSections(output, lines);
  for (const sec of sections) {
    for (const i of sec) {
      if (output[i].isTotal) {
        indicators[i] = "total";
        for (let j = sec.indexOf(i) - 1; j >= 0; j--) {
          const k = sec[j];
          if (output[k].isTotal) break;
          if (output[k].result !== null) indicators[k] = "summed";
        }
      }
    }
  }
  return indicators;
}

// Pad numbers so that decimal points line up within each section.
//   mode "frac": right-pad the fraction (web, used with text-align:right)
//   mode "int":  left-pad the integer part (file export)
function alignDecimalPoints(output, lines, mode) {
  const aligned = output.map(o => o.result);
  for (const sec of splitSections(output, lines)) {
    const info = [];
    for (const i of sec) {
      const r = aligned[i];
      if (r !== null && ALIGNABLE_RE.test(r)) {
        const dot = r.indexOf(".");
        const intW = dot >= 0 ? dot : r.length;
        info.push({ i, width: mode === "frac" ? r.length - intW : intW });
      }
    }
    if (info.length < 2) continue;
    const maxWidth = Math.max(...info.map(x => x.width));
    for (const x of info) {
      const pad = maxWidth - x.width;
      if (pad <= 0) continue;
      aligned[x.i] = mode === "frac"
        ? aligned[x.i] + "\u00a0".repeat(pad)
        : " ".repeat(pad) + aligned[x.i];
    }
  }
  return aligned;
}

// Apply a @rate, @format or @separator line. True when the line was one.
function applyDirective(stripped, fmtOpts, rates) {
  const rm = stripped.match(RATE_RE);
  if (rm) {
    rates[rm[1].toLowerCase() + "/" + rm[2].toLowerCase()] = new Big(rm[3].trim());
    return true;
  }
  const dm = stripped.match(DIRECTIVE_RE);
  if (!dm) return false;
  const key = dm[1].toLowerCase();
  const val = dm[2].trim();
  if (key === "format") {
    const fm = val.match(FORMAT_RE);
    if (fm) {
      const mode = fm[1].toLowerCase();
      fmtOpts.mode = mode === "minsig" ? "minSig" : mode;
      fmtOpts.precision = fm[2] !== undefined ? parseInt(fm[2]) : (mode === "minsig" ? 10 : 3);
    }
  } else if (key === "separator" && ["off", "underscore", "comma", "space"].includes(val.toLowerCase())) {
    fmtOpts.separator = val.toLowerCase();
  }
  return true;
}

function processText(text) {
  const lines = text.split("\n");
  let variables = Object.create(null);
  const rates = Object.create(null);
  let resultsAcc = [];
  const fmtOpts = { ...DEFAULT_FMT_OPTS };
  const output = [];
  for (const line of lines) {
    const stripped = line.trim();
    const cls = classifyLine(line, variables, rates);

    if (applyDirective(stripped, fmtOpts, rates)) {
      output.push({ result: null, cls });
      continue;
    }
    if (stripped.startsWith("#")) {
      resultsAcc = [];
      output.push({ result: null, cls });
      continue;
    }
    if (!stripped) {
      resultsAcc.push(null);
      output.push({ result: null, cls });
      continue;
    }

    const [result, newVars, isTotal] = evaluateLine(stripped, variables, rates, resultsAcc);
    variables = newVars;
    resultsAcc.push(result);
    if (result === null) {
      output.push({ result: null, cls });
      continue;
    }
    output.push({ result: formatResult(result, fmtOpts), cls, isTotal });
    if (isTotal) resultsAcc = [];
  }
  const aligned = alignDecimalPoints(output, lines, "int");
  for (let i = 0; i < output.length; i++) output[i].result = aligned[i];
  return output;
}

export {
  classifyLine, escapeHTML, highlightLine, processText,
  RESULT_RE, splitSections, computeTotalIndicators, alignDecimalPoints,
};
