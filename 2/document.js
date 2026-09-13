// Document layer: classify each line, drive the engine, align the output.
import { Big, BUILTIN_CONSTS } from "./builtins.js";
import { _isDateObj } from "./dates.js";
import { tokenize } from "./tokenize.js";
import {
  evaluateLine, ACC_KEY, _detectConversion, _buildMath, _tryParse, _reduceDateSubexprs, _tryDateEval,
} from "./evaluate.js";
import { DEFAULT_FMT_OPTS, formatResult } from "./format.js";

const DIRECTIVE_RE = /^@(format|separator)\s*=\s*(.+)$/i;
const FORMAT_RE = /^(minSig|fixed|scientific|eng|auto)(?:\((\d+)\))?$/i;
const RATE_RE = /^@rate\s+(\w+)\/(\w+)\s*=\s*(.+)$/i;

const TOKEN_ROLES = {
  NUM: "num", PCT: "num", DATE: "num",
  FUNC: "func", TOTAL: "func",
  ADDOP: "op", MULOP: "op", POW: "op",
  LPAREN: "op", RPAREN: "op", COMMA: "op", EQ: "op",
  COMMENT: "comment",
};


// Highlight role of one token. Only a line that computes is highlighted.
function _spanRole(token, inConv) {
  if (inConv && token[0] !== "COMMENT") return "unit";
  return TOKEN_ROLES[token[0]] || "text";
}

// Returns "blank", "prose", "comment", "directive", or a list of
// [start, end, role] spans. The role is one of "dim", "unit", "num", "func",
// "op", "comment" or "text". A line that does not compute is "prose", so colour
// marks exactly the lines calced reads.
function classifyLine(text, variables, rates) {
  const stripped = text.trim();
  if (!stripped) return "blank";
  if (stripped.startsWith("#")) return "comment";
  if (DIRECTIVE_RE.test(stripped) || RATE_RE.test(stripped)) return "directive";

  variables = variables || Object.create(null);
  let tokens = tokenize(text);
  let convStart = 0, convEnd = 0;
  let computed = false;

  const hasDate = tokens.some(t =>
    t[0] === "DATE" || (t[0] === "WORD" && _isDateObj(variables[t[1].toLowerCase()]))
  );
  if (hasDate) {
    if (_tryDateEval(tokens, variables) !== null) computed = true;
    else tokens = _reduceDateSubexprs(tokens, variables);
  }

  if (!computed) {
    let mathStart = 0;
    if (tokens.length >= 3 && tokens[0][0] === "WORD" && tokens[1][0] === "EQ") mathStart = 2;
    const conv = _detectConversion(tokens, rates);
    const allVars = Object.create(null);
    for (const k in BUILTIN_CONSTS) allVars[k] = BUILTIN_CONSTS[k];
    for (const k in variables) allVars[k] = variables[k];
    allVars[ACC_KEY] = 0;
    const [mathTokens] = _buildMath(tokens, mathStart, allVars, conv);
    const [result] = _tryParse(mathTokens);
    if (result !== null) {
      computed = true;
      if (conv[0] !== null) { convStart = conv[1]; convEnd = conv[2]; }
    }
  }

  if (!computed) return "prose";

  const spans = [];
  let pos = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t[0] === "EOF") break;
    const start = t[2], end = t[3];
    if (start > pos) spans.push([pos, start, "dim"]);
    spans.push([start, end, _spanRole(t, i >= convStart && i < convEnd)]);
    pos = end;
  }
  if (pos < text.length) spans.push([pos, text.length, "dim"]);
  return spans;
}

function escapeHTML(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function highlightLine(text, cls) {
  if (cls === "blank") return "";
  if (cls === "prose") return '<span class="hl-prose">' + escapeHTML(text) + '</span>';
  if (cls === "comment") return '<span class="hl-comment">' + escapeHTML(text) + '</span>';
  if (cls === "directive") return '<span class="hl-dim">' + escapeHTML(text) + '</span>';
  let html = "";
  for (const [start, end, role] of cls) {
    const chunk = escapeHTML(text.substring(start, end));
    html += role === "text" ? chunk : '<span class="hl-' + role + '">' + chunk + '</span>';
  }
  return html;
}

const RESULT_RE = /\s{2,}# => .*$/;
const ALIGNABLE_RE = /^-?[\d_, ]+(\.\d+)?$/;

// A block is a run of consecutive non-blank lines. It bounds the total, the
// decimal alignment and the total indicators alike.
function splitSections(output) {
  const sections = [];
  let cur = [];
  for (let i = 0; i < output.length; i++) {
    cur.push(i);
    if (output[i].endsBlock) { sections.push(cur); cur = []; }
  }
  if (cur.length) sections.push(cur);
  return sections;
}

function computeTotalIndicators(output) {
  // Returns array: null, "summed", or "total" per line
  const indicators = new Array(output.length).fill(null);
  const sections = splitSections(output);
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
function alignDecimalPoints(output, mode) {
  const aligned = output.map(o => o.result);
  for (const sec of splitSections(output)) {
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

    // A blank line ends the block, so it bounds the total above it.
    if (!stripped) {
      resultsAcc = [];
      output.push({ result: null, cls: "blank", endsBlock: true });
      continue;
    }

    const cls = classifyLine(line, variables, rates);
    if (applyDirective(stripped, fmtOpts, rates)) {
      output.push({ result: null, cls });
      continue;
    }
    if (stripped.startsWith("#")) {
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
  const aligned = alignDecimalPoints(output, "int");
  for (let i = 0; i < output.length; i++) output[i].result = aligned[i];
  return output;
}

// The text with `# =>` results, aligned per section. Used by copy and by the fixtures.
function formatForFile(text) {
  const lines = text.split("\n");
  const output = processText(text);
  const aligned = alignDecimalPoints(output, "int");
  const indicators = computeTotalIndicators(output);
  const formatted = new Array(lines.length);
  for (const sec of splitSections(output)) {
    const resultIdxs = sec.filter(i => output[i].result !== null);
    const maxLen = resultIdxs.length ? Math.max(...resultIdxs.map(i => lines[i].length)) : 0;
    const align = Math.max(maxLen + 2, 40);
    // Indicator-bearing results share one width, so the │ ┘ marks line up.
    let maxIndW = 0;
    for (const i of sec) {
      if (output[i].result !== null && indicators[i]) {
        maxIndW = Math.max(maxIndW, aligned[i].length);
      }
    }
    for (const i of sec) {
      if (output[i].result !== null) {
        const hasInd = indicators[i];
        const ind = indicators[i] === "summed" ? " │" : indicators[i] === "total" ? " ┘" : "";
        const padded = hasInd ? aligned[i].padEnd(maxIndW) : aligned[i];
        formatted[i] = lines[i].padEnd(align) + "# => " + padded + ind;
      } else {
        formatted[i] = lines[i];
      }
    }
  }
  return formatted.join("\n");
}

export {
  classifyLine, escapeHTML, highlightLine, processText, formatForFile,
  RESULT_RE, splitSections, computeTotalIndicators, alignDecimalPoints,
};
