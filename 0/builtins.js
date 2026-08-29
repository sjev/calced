// Numeric context and built-in functions/constants.
// Re-exports Big so that every consumer gets it already configured.
import { Big } from "./vendor/big.js";

// Match Python's Decimal: 28-digit context, half-even rounding.
// Decimal counts the context precision in significant digits, but big.js rounds
// div/sqrt to decimal PLACES. So compute with headroom, then round to
// significant digits. DP = 40 holds a full 28 significant digits down to ~1e-12.
Big.DP = 40;
Big.RM = 2;
const CTX_PREC = 28;
const P = (x) => x.prec(CTX_PREC);

const MAX_RESULT_DIGITS = 1000;

// True when base**exp has more than MAX_RESULT_DIGITS digits. Bounds the size of
// the exact result: big.js pow is exact, and render() runs on every keystroke.
function _powExceedsLimit(base, exp) {
  const e = Math.abs(exp.toNumber());
  if (!isFinite(e)) return true;
  return e * base.c.length > MAX_RESULT_DIGITS;
}

function _bigWrap(fn) {
  return function(x) { return new Big(fn(x.toNumber()).toString()); };
}
const BUILTIN_FUNCS_1 = {
  sqrt: (x) => P(x.sqrt()),
  abs: (x) => x.abs(),
  floor: (x) => new Big(Math.floor(x.toNumber())),
  ceil: (x) => new Big(Math.ceil(x.toNumber())),
  log: _bigWrap(Math.log), log2: _bigWrap(Math.log2), log10: _bigWrap(Math.log10),
  sin: _bigWrap(Math.sin), cos: _bigWrap(Math.cos), tan: _bigWrap(Math.tan),
  asin: _bigWrap(Math.asin), acos: _bigWrap(Math.acos), atan: _bigWrap(Math.atan),
  exp: _bigWrap(Math.exp),
};
const BUILTIN_FUNCS_N = {
  round: (args) => args.length === 1 ? args[0].round(0) : args[0].round(args[1].toNumber()),
  min: (args) => args.reduce((a, b) => a.lt(b) ? a : b),
  max: (args) => args.reduce((a, b) => a.gt(b) ? a : b),
};
const BUILTIN_FUNC_NAMES = new Set([...Object.keys(BUILTIN_FUNCS_1), ...Object.keys(BUILTIN_FUNCS_N)]);
const BUILTIN_CONSTS = { pi: new Big(Math.PI.toString()), e: new Big(Math.E.toString()), tau: new Big((2 * Math.PI).toString()) };

export {
  Big, CTX_PREC, P, MAX_RESULT_DIGITS, _powExceedsLimit,
  BUILTIN_FUNCS_1, BUILTIN_FUNCS_N, BUILTIN_FUNC_NAMES, BUILTIN_CONSTS,
};
