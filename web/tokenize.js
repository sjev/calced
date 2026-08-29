// Text -> token list.
import { Big, BUILTIN_FUNC_NAMES } from "./builtins.js";
import { SI_PREFIX, SI_SUFFIX_CHARS } from "./units.js";
import { _parseISO, _todayDate, _nowValue } from "./dates.js";

// "%" is modulo here; a "%" that follows a number is tokenized as PCT instead.
const SINGLE_CHAR_TOKENS = {
  "+": "ADDOP", "-": "ADDOP", "*": "MULOP", "/": "MULOP", "%": "MULOP",
  "^": "POW", "(": "LPAREN", ")": "RPAREN", ",": "COMMA", "=": "EQ",
};

const NUM_RE = new RegExp("^(\\d(?:\\d|_|,(?=\\d))*\\.?\\d*|\\.\\d+)(?:([eE][+-]?\\d+)|([" + SI_SUFFIX_CHARS + "]))?");
const HEX_BIN_OCT_RE = /^0[xX][0-9a-fA-F]+|^0[bB][01]+|^0[oO][0-7]+/;
const EMPTY_CALL_RE = /^[ \t]*\([ \t]*\)/;

// End index of an empty argument list at `pos`, or null.
function _emptyCallEnd(text, pos) {
  const m = text.substring(pos).match(EMPTY_CALL_RE);
  return m ? pos + m[0].length : null;
}

// Calls that take no arguments. They resolve here, so the bare word stays a
// usable variable name and the parser needs no zero-arg support.
const ZERO_ARG_CALLS = {
  date: ["DATE", _todayDate],
  now: ["DATE", _nowValue],
  sum: ["TOTAL", () => "sum"],
};

function tokenize(text) {
  const tokens = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] === ' ' || text[i] === '\t') { i++; continue; }
    const start = i;
    const slice = text.substring(i);
    // ISO date, optionally with a time: 2025-01-15, 2025-01-15 10:30
    if (text[i] >= '0' && text[i] <= '9') {
      const parsed = _parseISO(slice);
      if (parsed) {
        const end = i + parsed[1];
        tokens.push(["DATE", parsed[0], start, end]);
        i = end;
        continue;
      }
      // Not a real date, so fall through to number parsing.
    }
    // Hex/binary/octal
    if (text[i] === "0" && i + 1 < n && "xXbBoO".includes(text[i + 1])) {
      const hm = slice.match(HEX_BIN_OCT_RE);
      if (hm) {
        const val = new Big(Number(hm[0]));
        const end = i + hm[0].length;
        tokens.push(["NUM", val, start, end]);
        i = end;
        continue;
      }
    }
    const m = slice.match(NUM_RE);
    if (m && m[1]) {
      const raw = m[1].replace(/,/g, "").replace(/_/g, "");
      const exp = m[2];
      let val = new Big(exp ? raw + exp : raw);
      const suffix = m[3];
      if (suffix) val = val.times(SI_PREFIX[suffix]);
      const end = i + m[0].length;
      if (end < n && text[end] === "%") {
        tokens.push(["PCT", val, start, end + 1]);
        i = end + 1;
      } else {
        tokens.push(["NUM", val, start, end]);
        i = end;
      }
      continue;
    }
    const single = SINGLE_CHAR_TOKENS[text[i]];
    if (single) { tokens.push([single, text[i], start, i+1]); i++; continue; }
    const wm = slice.match(/^[a-zA-Z_]\w*/);
    if (wm) {
      const word = wm[0];
      const wl = word.toLowerCase();
      const end = i + wm[0].length;
      // Zero-argument calls resolve here, so the bare word stays a usable
      // variable name.
      const callEnd = _emptyCallEnd(text, end);
      if (callEnd !== null && wl in ZERO_ARG_CALLS) {
        const [typ, make] = ZERO_ARG_CALLS[wl];
        tokens.push([typ, make(), start, callEnd]);
        i = callEnd;
        continue;
      }
      if (wl === "of") tokens.push(["OF", "of", start, end]);
      else if (wl === "as") tokens.push(["AS", "as", start, end]);
      else if (BUILTIN_FUNC_NAMES.has(wl)) tokens.push(["FUNC", wl, start, end]);
      else tokens.push(["WORD", word, start, end]);
      i = end;
      continue;
    }
    i++;
  }
  tokens.push(["EOF", null, n, n]);
  return tokens;
}

export { SINGLE_CHAR_TOKENS, NUM_RE, HEX_BIN_OCT_RE, tokenize };
