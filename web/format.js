// Number -> display string.
import { Big, MAX_RESULT_DIGITS } from "./builtins.js";
import { ENG_SUFFIX } from "./units.js";
import { _isDateObj, _dateToISO } from "./dates.js";

const DEFAULT_FMT_OPTS = { mode: "minSig", precision: 10, separator: "underscore" };

function addCommas(s) {
  const parts = s.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

// Round half-even to `places` decimals. Never falls back to exponential.
function _fixed(d, places, group) {
  const s = d.toFixed(places);
  return group === false ? s : addCommas(s);
}

// Scientific notation, half-even, exponent padded to two digits.
function _sci(d, dec) {
  return d.toExponential(dec).replace(/e([+-])(\d)$/, "e$1" + "0$2");
}

// Drop trailing fraction zeros.
function _strip(s) {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

// Formats from the exact decimal value, never via float, so that this and the
// Python engine agree. Rounding is half-even in every mode.
function formatResult(n, fmtOpts) {
  if (_isDateObj(n)) return _dateToISO(n);
  if (!fmtOpts) fmtOpts = DEFAULT_FMT_OPTS;
  const d = n instanceof Big ? n : new Big(n);
  const mode = fmtOpts.mode;
  const prec = fmtOpts.precision;
  const sep = fmtOpts.separator;
  function applySep(s) {
    if (sep === "comma") return s;
    if (sep === "underscore") return s.replace(/,/g, "_");
    if (sep === "space") return s.replace(/,/g, " ");
    return s.replace(/,/g, "");
  }

  if (Math.abs(d.e) > MAX_RESULT_DIGITS) return "too large";

  if (mode === "minSig") {
    if (d.eq(0)) return applySep("0");
    const showDec = Math.max(prec - d.e - 1, 0);
    return applySep(showDec ? _strip(_fixed(d, showDec)) : _fixed(d, 0));
  }

  if (mode === "fixed") {
    return applySep(_fixed(d, prec));
  }

  if (mode === "scientific") {
    return _sci(d, Math.max(prec - 1, 0));
  }

  if (mode === "eng") {
    if (d.eq(0)) return "0";
    const exp = d.e;
    let e3 = Math.floor(exp / 3) * 3;
    const dec = Math.max(prec - (exp - e3) - 1, 0);
    let mant = new Big(d.div(new Big("1e" + e3)).toFixed(dec));
    if (mant.abs().gte(1000)) { mant = mant.div(1000); e3 += 3; }  // rounding pushed the mantissa up a decade
    if (e3 === 0 || ENG_SUFFIX[e3] !== undefined) {
      return _strip(_fixed(mant, dec, false)) + (ENG_SUFFIX[e3] || "");
    }
    return _sci(d, Math.max(prec - 1, 0));  // outside the SI range
  }

  if (mode === "auto") {
    // %g semantics: exponential when exp < -4 or exp >= precision, zeros stripped
    if (d.eq(0)) return "0";
    const exp = d.e;
    if (exp < -4 || exp >= prec) {
      const parts = _sci(d, Math.max(prec - 1, 0)).split("e");
      return _strip(parts[0]) + "e" + parts[1];
    }
    return _strip(_fixed(d, Math.max(prec - 1 - exp, 0), false));
  }

  return d.toString();
}

export { DEFAULT_FMT_OPTS, addCommas, formatResult };
