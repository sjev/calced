// Recursive descent parser and the expression evaluator.
import { Big, P, _powExceedsLimit, BUILTIN_FUNCS_1, BUILTIN_FUNCS_N, BUILTIN_CONSTS } from "./builtins.js";
import { UNIT_LOOKUP, convertTemperature } from "./units.js";
import { DURATION_UNITS, _isDateObj, _todayDate, _dateAddDays, _dateAddMonths, _dateDiffDays } from "./dates.js";
import { tokenize } from "./tokenize.js";

class Parser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0; }
  peek() { return this.pos < this.tokens.length ? this.tokens[this.pos] : ["EOF", null]; }
  consume() { return this.tokens[this.pos++]; }
  parseExpr() {
    let left = this.parseTerm();
    while (this.peek()[0] === "ADDOP") {
      const op = this.consume()[1];
      if (this.peek()[0] === "PCT") {
        const pct = this.consume()[1];
        const rate = P(pct.div(100));
        const factor = P(op === "+" ? new Big(1).plus(rate) : new Big(1).minus(rate));
        left = P(left.times(factor));
      } else {
        const right = this.parseTerm();
        left = P(op === "+" ? left.plus(right) : left.minus(right));
      }
    }
    // Handle "X as % of Y" → (X / Y) * 100
    if (this.peek()[0] === "AS"
        && this.pos + 2 < this.tokens.length
        && this.tokens[this.pos + 1][0] === "MULOP" && this.tokens[this.pos + 1][1] === "%"
        && this.tokens[this.pos + 2][0] === "OF") {
      this.consume(); // AS
      this.consume(); // %
      this.consume(); // OF
      const right = this.parseExpr();
      if (right.eq(0)) throw new Error("division by zero");
      left = P(P(left.div(right)).times(100));
    }
    return left;
  }
  parseTerm() {
    let left = this.parsePower();
    while (this.peek()[0] === "MULOP") {
      const op = this.consume()[1];
      const right = this.parsePower();
      if (op === "*") left = P(left.times(right));
      else if (op === "/") { if (right.eq(0)) throw new Error("division by zero"); left = P(left.div(right)); }
      else if (op === "%") { if (right.eq(0)) throw new Error("division by zero"); left = P(left.mod(right)); }
    }
    return left;
  }
  parsePower() {
    let base = this.parseUnary();
    if (this.peek()[0] === "POW") {
      this.consume();
      const exp = this.parsePower();
      if (_powExceedsLimit(base, exp)) throw new Error("result too large");
      try { return P(base.pow(exp.toNumber())); }
      catch (e) {
        // non-integer exponent, which big.js pow refuses: float, as Python does
        const r = Math.pow(base.toNumber(), exp.toNumber());
        if (!isFinite(r)) throw new Error("result too large");
        return new Big(r);
      }
    }
    return base;
  }
  parseUnary() {
    if (this.peek()[0] === "ADDOP") {
      const op = this.consume()[1];
      const val = this.parsePrimary();
      return op === "-" ? val.neg() : val;
    }
    return this.parsePrimary();
  }
  parsePrimary() {
    const t = this.peek();
    if (t[0] === "NUM") { this.consume(); return t[1]; }
    if (t[0] === "PCT") {
      this.consume();
      const pct = t[1];
      if (this.peek()[0] === "OF") { this.consume(); const base = this.parseExpr(); return pct.div(100).times(base); }
      return pct.div(100);
    }
    if (t[0] === "FUNC") {
      const name = this.consume()[1];
      if (this.peek()[0] !== "LPAREN") throw new Error("Expected ( after " + name);
      this.consume();
      const args = [this.parseExpr()];
      while (this.peek()[0] === "COMMA") { this.consume(); args.push(this.parseExpr()); }
      if (this.peek()[0] !== "RPAREN") throw new Error("Missing )");
      this.consume();
      if (name in BUILTIN_FUNCS_1) {
        if (args.length !== 1) throw new Error(name + " takes 1 argument");
        return BUILTIN_FUNCS_1[name](args[0]);
      }
      if (name in BUILTIN_FUNCS_N) return BUILTIN_FUNCS_N[name](args);
      throw new Error("Unknown function: " + name);
    }
    if (t[0] === "LPAREN") {
      this.consume();
      const val = this.parseExpr();
      if (this.peek()[0] !== "RPAREN") throw new Error("Missing )");
      this.consume();
      return val;
    }
    throw new Error("Unexpected: " + t[0]);
  }
}

function _crossRate(fr, to, rates) {
  function rateToMid(currency, mid) {
    const pair = currency + "/" + mid;
    if (pair in rates) return rates[pair];
    const rev = mid + "/" + currency;
    if (rev in rates) return new Big(1).div(rates[rev]);
    return null;
  }
  const mids = new Set();
  for (const key of Object.keys(rates)) {
    const [a, b] = key.split("/");
    mids.add(a);
    mids.add(b);
  }
  for (const mid of mids) {
    if (mid === fr || mid === to) continue;
    const rFr = rateToMid(fr, mid);
    const rTo = rateToMid(to, mid);
    if (rFr !== null && rTo !== null) return rFr.div(rTo);
  }
  return null;
}

function _detectConversion(tokens, rates) {
  const eofIdx = tokens.length - 1;
  // Scan backwards for WORD(from) WORD(in/to) WORD(to) pattern
  for (let i = eofIdx - 3; i >= 0; i--) {
    const tFr = tokens[i];
    const tKw = tokens[i + 1];
    const tTo = tokens[i + 2];
    if ((tTo[0] === "WORD" || tTo[0] === "FUNC")
        && tKw[0] === "WORD" && (tKw[1].toLowerCase() === "in" || tKw[1].toLowerCase() === "to")
        && (tFr[0] === "WORD" || tFr[0] === "FUNC")) {
      const frName = tFr[1].toLowerCase();
      const toName = tTo[1].toLowerCase();
      if (frName in UNIT_LOOKUP && toName in UNIT_LOOKUP) {
        const [frDim, frFactor] = UNIT_LOOKUP[frName];
        const [toDim, toFactor] = UNIT_LOOKUP[toName];
        if (frDim === toDim) return [[frDim, frFactor, toFactor], i, i + 3];
      }
      if (rates) {
        const pair = frName + "/" + toName;
        const rev = toName + "/" + frName;
        if (pair in rates) return [["rate", rates[pair], new Big(1)], i, i + 3];
        if (rev in rates) return [["rate", new Big(1), rates[rev]], i, i + 3];
        const cross = _crossRate(frName, toName, rates);
        if (cross !== null) return [["rate", cross, new Big(1)], i, i + 3];
      }
    }
  }
  return [null, eofIdx, eofIdx];
}

function _buildMath(tokens, start, allVars, conv) {
  // conv is the triple returned by _detectConversion. Returns
  // [mathTokens, mathToOrig], where mathToOrig[i] is the original token index
  // that mathTokens[i] came from.
  const [conversion, convStart, convEnd] = conv;
  let pairs = [];  // [token, original index]
  let parenDepth = 0;
  for (let idx = start; idx < tokens.length; idx++) {
    const t = tokens[idx];
    if (idx >= convStart && idx < convEnd) {
      // Replace the conversion span with inline MULOP(*) NUM(factor)
      if (idx === convStart && conversion) {
        const [dim, fromFactor, toFactor] = conversion;
        if (dim !== "temperature") {
          const factor = new Big(fromFactor).div(new Big(toFactor));
          pairs.push([["MULOP", "*", t[2], t[3]], idx]);
          pairs.push([["NUM", factor, t[2], t[3]], idx]);
        }
      }
      continue;
    }
    if (t[0] === "WORD") {
      const v = allVars[t[1].toLowerCase()];
      if (v !== undefined && !_isDateObj(v)) {
        pairs.push([["NUM", v instanceof Big ? v : new Big(v), t[2], t[3]], idx]);
      }
    } else if (t[0] === "TOTAL") {
      const v = allVars["total"];
      if (v !== undefined) {
        pairs.push([["NUM", v instanceof Big ? v : new Big(v), t[2], t[3]], idx]);
      }
    } else if (t[0] === "EQ" || t[0] === "DATE" || (t[0] === "COMMA" && parenDepth === 0)) {
      // not part of the math
    } else {
      if (t[0] === "LPAREN") parenDepth++;
      else if (t[0] === "RPAREN") parenDepth--;
      pairs.push([t, idx]);
    }
  }

  pairs = _stripEmptyParens(pairs);
  pairs = _stripOrphanOps(pairs, start);
  return [pairs.map(p => p[0]), pairs.map(p => p[1])];
}

// Drop parens left empty (or holding only commas) after WORDs were skipped.
function _stripEmptyParens(pairs) {
  let changed = true;
  while (changed) {
    changed = false;
    const out = [];
    let i = 0;
    while (i < pairs.length) {
      if (pairs[i][0][0] === "LPAREN") {
        let j = i + 1;
        while (j < pairs.length && pairs[j][0][0] === "COMMA") j++;
        if (j < pairs.length && pairs[j][0][0] === "RPAREN") {
          i = j + 1;
          changed = true;
          continue;
        }
      }
      out.push(pairs[i]);
      i++;
    }
    pairs = out;
  }
  return pairs;
}

// Drop operators left dangling after WORDs were skipped. A leading or doubled
// operator goes away, except a unary minus. A MULOP stays so that the parse
// fails, instead of silently exposing the numbers after it.
function _stripOrphanOps(pairs, start) {
  let changed = true;
  while (changed) {
    changed = false;
    const out = [];
    for (let i = 0; i < pairs.length; i++) {
      const [t, orig] = pairs[i];
      if (t[0] === "ADDOP" || t[0] === "MULOP") {
        const prev = out.length ? out[out.length - 1][0][0] : null;
        const nxt = i + 1 < pairs.length ? pairs[i + 1][0][0] : "EOF";
        if (prev === null || prev === "ADDOP" || prev === "MULOP") {
          const unaryMinus = t[0] === "ADDOP" && t[1] === "-"
            && (nxt === "NUM" || nxt === "LPAREN" || nxt === "FUNC")
            // a leading minus must be the first token of the expression
            && (prev !== null || orig === start);
          if (t[0] !== "MULOP" && !unaryMinus) { changed = true; continue; }
        } else if (nxt === "EOF" || nxt === "RPAREN") {
          changed = true;
          continue;
        }
      }
      out.push([t, orig]);
    }
    pairs = out;
  }
  return pairs;
}

// True when the tokens are only balanced parenthetical notes, e.g. "(net 30)".
function _isAnnotation(tokens) {
  let depth = 0;
  for (const t of tokens) {
    if (t[0] === "EOF") break;
    if (depth === 0 && t[0] !== "LPAREN") return false;
    if (t[0] === "LPAREN") depth++;
    else if (t[0] === "RPAREN") depth--;
  }
  return depth === 0;
}

// Parse math tokens, allowing trailing balanced parenthetical annotations.
// Returns [result, consumed] on success, or [null, -1] on failure.
function _tryParse(mathTokens) {
  try {
    const parser = new Parser(mathTokens);
    const result = parser.parseExpr();
    if (_isAnnotation(mathTokens.slice(parser.pos))) return [result, parser.pos];
    return [null, -1];
  } catch (e) {
    return [null, -1];
  }
}

function _reduceDateSubexprs(tokens, variables) {
  let result = tokens.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      if (result[i][0] !== "LPAREN") continue;
      let depth = 1, j = i + 1;
      while (j < result.length && depth > 0) {
        if (result[j][0] === "LPAREN") depth++;
        else if (result[j][0] === "RPAREN") depth--;
        j++;
      }
      const sub = result.slice(i + 1, j - 1);
      if (!sub.some(t => t[0] === "DATE")) continue;
      const subEof = sub.concat([["EOF", null, 0, 0]]);
      const dateResult = _tryDateEval(subEof, variables);
      if (dateResult !== null) {
        const [val] = dateResult;
        if (val instanceof Big) {
          result.splice(i, j - i, ["NUM", val, result[i][2], result[j - 1][3]]);
          changed = true;
          break;
        }
      }
    }
  }
  return result;
}

// Evaluate tokens to an integer count, or null when they do not resolve.
function _evalCount(tokens, allVars) {
  const resolved = [];
  for (const t of tokens) {
    if (t[0] === "WORD") {
      const v = allVars[t[1].toLowerCase()];
      if (v === undefined || _isDateObj(v)) return null;
      resolved.push(["NUM", v instanceof Big ? v : new Big(v), t[2], t[3]]);
    } else {
      resolved.push(t);
    }
  }
  resolved.push(["EOF", null, 0, 0]);
  const [value] = _tryParse(resolved);
  return value === null ? null : Math.trunc(value.toNumber());
}

function _tryDateEval(tokens, variables) {
  try { return _tryDateEvalInner(tokens, variables); }
  catch (e) { return null; }
}

function _tryDateEvalInner(tokens, variables) {
  // Resolve date-holding variables
  const resolved = tokens.map(t => {
    if (t[0] === "WORD") {
      const wl = t[1].toLowerCase();
      const val = variables[wl];
      if (_isDateObj(val)) return ["DATE", val, t[2], t[3]];
    }
    return t;
  });
  if (!resolved.some(t => t[0] === "DATE")) return null;

  // Strip assignment prefix
  let varName = null;
  let toks = resolved;
  if (toks.length >= 3 && toks[0][0] === "WORD" && toks[1][0] === "EQ") {
    varName = toks[0][1].toLowerCase();
    toks = toks.slice(2);
  }
  let body = toks.filter(t => t[0] !== "EOF");
  if (!body.length) return null;

  // Strip outer parentheses
  while (body.length >= 2 && body[0][0] === "LPAREN" && body[body.length - 1][0] === "RPAREN") {
    body = body.slice(1, -1);
  }
  if (!body.length) return null;

  function _finish(result) {
    if (varName) {
      const newVars = Object.create(null);
      for (const k in variables) newVars[k] = variables[k];
      newVars[varName] = result;
      return [result, newVars];
    }
    return [result, variables];
  }

  // Pattern 1: "days/weeks until/since DATE" (checked before label stripping)
  if (body.length === 3
      && body[0][0] === "WORD" && (body[0][1].toLowerCase() === "days" || body[0][1].toLowerCase() === "weeks")
      && body[1][0] === "WORD" && (body[1][1].toLowerCase() === "until" || body[1][1].toLowerCase() === "since")
      && body[2][0] === "DATE") {
    const today = _todayDate();
    const target = body[2][1];
    const dir = body[1][1].toLowerCase();
    const diffDays = dir === "until" ? _dateDiffDays(target, today) : _dateDiffDays(today, target);
    if (body[0][1].toLowerCase() === "weeks") return _finish(new Big(diffDays).div(7));
    return _finish(new Big(diffDays));
  }

  // Strip leading label tokens before the first DATE for remaining patterns
  const LABEL_TYPES = new Set(["WORD", "LPAREN", "RPAREN", "COMMA"]);
  let firstDateIdx = -1;
  let labelsStripped = false;
  for (let i = 0; i < body.length; i++) {
    if (body[i][0] === "DATE") { firstDateIdx = i; break; }
  }
  if (firstDateIdx > 0 && body.slice(0, firstDateIdx).every(t => LABEL_TYPES.has(t[0]))) {
    body = body.slice(firstDateIdx);
    labelsStripped = true;
  }

  // Pattern 0: bare DATE
  if (body.length === 1 && body[0][0] === "DATE") {
    if (labelsStripped) return null;
    return _finish(body[0][1]);
  }

  // Pattern 2: DATE ± expr duration_unit (supports compound: + 1 week + 3 days)
  if (body.length >= 4 && body[0][0] === "DATE" && body[1][0] === "ADDOP") {
    const allVars = Object.create(null);
    for (const k in BUILTIN_CONSTS) allVars[k] = BUILTIN_CONSTS[k];
    for (const k in variables) allVars[k] = variables[k];
    let d = body[0][1];
    let pos = 1;
    let ok = true;
    while (ok && pos < body.length && body[pos][0] === "ADDOP") {
      const op = body[pos][1];
      pos++;
      // The segment runs up to the duration unit that closes it
      let durPos = -1;
      for (let j = pos; j < body.length; j++) {
        if (body[j][0] === "WORD" && DURATION_UNITS.has(body[j][1].toLowerCase())) {
          durPos = j;
          break;
        }
      }
      if (durPos < 0 || durPos === pos) { ok = false; break; }
      let n = _evalCount(body.slice(pos, durPos), allVars);
      if (n === null) { ok = false; break; }
      const unit = body[durPos][1].toLowerCase();
      if (op === "-") n = -n;
      if (unit === "day" || unit === "days") d = _dateAddDays(d, n);
      else if (unit === "week" || unit === "weeks") d = _dateAddDays(d, n * 7);
      else if (unit === "month" || unit === "months") d = _dateAddMonths(d, n);
      else d = _dateAddMonths(d, n * 12);  // year, years
      pos = durPos + 1;
    }
    if (ok && _isAnnotation(body.slice(pos))) return _finish(d);
  }

  // Pattern 3: DATE - DATE → number of days
  if (body.length === 3
      && body[0][0] === "DATE"
      && body[1][0] === "ADDOP" && body[1][1] === "-"
      && body[2][0] === "DATE") {
    return _finish(new Big(_dateDiffDays(body[0][1], body[2][1])));
  }

  return null;
}

function evaluateLine(text, variables, rates, resultsAcc) {
  let tokens = tokenize(text);
  const hasTotal = tokens.some(t => t[0] === "TOTAL");
  // Try date evaluation first
  const dateResult = _tryDateEval(tokens, variables);
  if (dateResult !== null) return [dateResult[0], dateResult[1], hasTotal];
  // Reduce parenthesized date sub-expressions to numbers
  tokens = _reduceDateSubexprs(tokens, variables || Object.create(null));
  const allVars = Object.create(null);
  for (const k in BUILTIN_CONSTS) allVars[k] = BUILTIN_CONSTS[k];
  for (const k in variables) allVars[k] = variables[k];
  // Compute subtotal from accumulator and inject as "total"/"sum"
  if (resultsAcc) {
    const subtotal = resultsAcc.reduce((s, r) => r !== null && !_isDateObj(r) ? s.plus(r) : s, new Big(0));
    allVars["total"] = subtotal;
    allVars["sum"] = subtotal;
  }
  const hasValue = tokens.some(t =>
    t[0] === "NUM" || t[0] === "PCT" || t[0] === "FUNC" || t[0] === "DATE" || t[0] === "TOTAL" || (t[0] === "WORD" && t[1].toLowerCase() in allVars)
  );
  if (!hasValue) return [null, variables, false];
  let pos = 0;
  let varName = null;
  if (tokens.length >= 3 && tokens[0][0] === "WORD" && tokens[1][0] === "EQ") {
    varName = tokens[0][1].toLowerCase();
    pos = 2;
  }
  const conv = _detectConversion(tokens, rates);
  const [mathTokens] = _buildMath(tokens, pos, allVars, conv);
  let [result] = _tryParse(mathTokens);
  if (result === null) return [null, variables, false];
  if (conv[0] !== null) {
    const [dim, fromFactor, toFactor] = conv[0];
    if (dim === "temperature") result = convertTemperature(result, fromFactor, toFactor);
  }
  if (varName) {
    const newVars = Object.create(null);
    for (const k in variables) newVars[k] = variables[k];
    newVars[varName] = result;
    return [result, newVars, hasTotal];
  }
  return [result, variables, hasTotal];
}

export {
  Parser, evaluateLine,
  _detectConversion, _buildMath, _tryParse, _reduceDateSubexprs, _tryDateEval,
};
