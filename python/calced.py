#!/usr/bin/env python3
"""calced - a notepad calculator that updates files with results."""

import argparse
import base64
import calendar
import collections
import datetime
import difflib
import importlib.metadata
import json
import math
import os
import re
import sys
import time
import zlib
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation

RESULT_RE = re.compile(r"\s+# => .*$")
DIRECTIVE_RE = re.compile(r"^@(format|separator)\s*=\s*(.+)$", re.IGNORECASE)
FORMAT_RE = re.compile(r"^(minSig|fixed|scientific|eng|auto)(?:\((\d+)\))?$", re.IGNORECASE)
RATE_RE = re.compile(r"^@rate\s+(\w+)/(\w+)\s*=\s*(.+)$", re.IGNORECASE)
ALIGNABLE_RE = re.compile(r"^-?[\d_, ]+(\.\d+)?$")
DEFAULT_FMT_OPTS = {"mode": "minSig", "precision": 10, "separator": "underscore"}

# --- Date/time support ---
DATE = "DATE"
ISO_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
DATE_KEYWORDS = {"today", "tomorrow", "yesterday"}
DURATION_UNITS = {"day", "days", "week", "weeks", "month", "months", "year", "years"}


def _resolve_date_keyword(keyword):
    """Return a datetime.date for a date keyword."""
    today = datetime.date.today()
    if keyword == "today":
        return today
    if keyword == "tomorrow":
        return today + datetime.timedelta(days=1)
    if keyword == "yesterday":
        return today - datetime.timedelta(days=1)
    raise ValueError(f"Unknown date keyword: {keyword}")


def _add_months(d, months):
    """Add months to a date, clamping day to valid range."""
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    max_day = calendar.monthrange(year, month)[1]
    return datetime.date(year, month, min(d.day, max_day))


# SI prefixes (case-sensitive: M=mega, m=milli)
SI_PREFIX = {
    "Q": Decimal("1e30"),  # quetta
    "R": Decimal("1e27"),  # ronna
    "Y": Decimal("1e24"),  # yotta
    "Z": Decimal("1e21"),  # zetta
    "E": Decimal("1e18"),  # exa
    "P": Decimal("1e15"),  # peta
    "T": Decimal("1e12"),  # tera
    "G": Decimal("1e9"),  # giga
    "M": Decimal("1e6"),  # mega
    "K": Decimal("1e3"),  # kilo (unofficial but common)
    "k": Decimal("1e3"),  # kilo
    "m": Decimal("1e-3"),  # milli
    "u": Decimal("1e-6"),  # micro (ASCII)
    "μ": Decimal("1e-6"),  # micro
    "n": Decimal("1e-9"),  # nano
    "p": Decimal("1e-12"),  # pico
    "f": Decimal("1e-15"),  # femto
    "a": Decimal("1e-18"),  # atto
    "z": Decimal("1e-21"),  # zepto
    "y": Decimal("1e-24"),  # yocto
}
SI_SUFFIX_RE = "[" + re.escape("".join(SI_PREFIX.keys())) + "]"
# exponent -> prefix for engineering output ("K" and "μ" are input-only aliases)
ENG_SUFFIX = {round(math.log10(float(v))): k for k, v in SI_PREFIX.items() if k not in ("K", "μ")}

MAX_RESULT_DIGITS = 1000

# "%" is modulo here; a "%" that follows a number is tokenized as PCT instead.
SINGLE_CHAR_TOKENS = {
    "+": "ADDOP",
    "-": "ADDOP",
    "*": "MULOP",
    "/": "MULOP",
    "%": "MULOP",
    "^": "POW",
    "(": "LPAREN",
    ")": "RPAREN",
    ",": "COMMA",
    "=": "EQ",
}


def _pow_exceeds_limit(base, exp):
    """True when base**exp has more than MAX_RESULT_DIGITS digits.

    Bounds the size of the exact result, which is what makes the web engine slow:
    render() runs there on every keystroke.
    """
    try:
        e = abs(float(exp))
    except (ValueError, OverflowError):
        return True
    return e * len(base.normalize().as_tuple().digits) > MAX_RESULT_DIGITS


def _float_func(fn):
    """Wrap a math.* function: Decimal -> float -> compute -> Decimal."""

    def wrapper(x):
        return Decimal(str(fn(float(x))))

    return wrapper


BUILTIN_FUNCS_1 = {
    "sqrt": lambda x: x.sqrt() if isinstance(x, Decimal) else Decimal(str(math.sqrt(x))),
    "abs": abs,
    "floor": math.floor,
    "ceil": math.ceil,
    "log": _float_func(math.log),
    "log2": _float_func(math.log2),
    "log10": _float_func(math.log10),
    "sin": _float_func(math.sin),
    "cos": _float_func(math.cos),
    "tan": _float_func(math.tan),
    "asin": _float_func(math.asin),
    "acos": _float_func(math.acos),
    "atan": _float_func(math.atan),
    "exp": _float_func(math.exp),
}
BUILTIN_FUNCS_N = {
    "round": lambda args: round(args[0]) if len(args) == 1 else round(args[0], int(args[1])),
    "min": lambda args: min(args),
    "max": lambda args: max(args),
}
BUILTIN_FUNC_NAMES = set(BUILTIN_FUNCS_1) | set(BUILTIN_FUNCS_N)

BUILTIN_CONSTS = {
    "pi": Decimal(str(math.pi)),
    "e": Decimal(str(math.e)),
    "tau": Decimal(str(math.tau)),
}

# --- Unit conversion tables ---
UNIT_TABLE = {
    "length": {
        "mm": Decimal("0.001"),
        "millimeter": Decimal("0.001"),
        "millimeters": Decimal("0.001"),
        "cm": Decimal("0.01"),
        "centimeter": Decimal("0.01"),
        "centimeters": Decimal("0.01"),
        "m": 1,
        "meter": 1,
        "meters": 1,
        "km": 1000,
        "kilometer": 1000,
        "kilometers": 1000,
        "in": Decimal("0.0254"),
        "inch": Decimal("0.0254"),
        "inches": Decimal("0.0254"),
        "ft": Decimal("0.3048"),
        "foot": Decimal("0.3048"),
        "feet": Decimal("0.3048"),
        "yd": Decimal("0.9144"),
        "yard": Decimal("0.9144"),
        "yards": Decimal("0.9144"),
        "mi": Decimal("1609.344"),
        "mile": Decimal("1609.344"),
        "miles": Decimal("1609.344"),
    },
    "mass": {
        "mg": Decimal("0.001"),
        "milligram": Decimal("0.001"),
        "milligrams": Decimal("0.001"),
        "g": 1,
        "gram": 1,
        "grams": 1,
        "kg": 1000,
        "kilogram": 1000,
        "kilograms": 1000,
        "oz": Decimal("28.3495"),
        "ounce": Decimal("28.3495"),
        "ounces": Decimal("28.3495"),
        "lb": Decimal("453.592"),
        "lbs": Decimal("453.592"),
        "pound": Decimal("453.592"),
        "pounds": Decimal("453.592"),
    },
    "temperature": {
        "c": "c",
        "celsius": "c",
        "f": "f",
        "fahrenheit": "f",
        "k": "k",
        "kelvin": "k",
    },
    "data": {
        "b": 1,
        "byte": 1,
        "bytes": 1,
        "kb": 1000,
        "kilobyte": 1000,
        "kilobytes": 1000,
        "mb": Decimal("1e6"),
        "megabyte": Decimal("1e6"),
        "megabytes": Decimal("1e6"),
        "gb": Decimal("1e9"),
        "gigabyte": Decimal("1e9"),
        "gigabytes": Decimal("1e9"),
        "tb": Decimal("1e12"),
        "terabyte": Decimal("1e12"),
        "terabytes": Decimal("1e12"),
        "kib": 1024,
        "kibibyte": 1024,
        "kibibytes": 1024,
        "mib": 1048576,
        "mebibyte": 1048576,
        "mebibytes": 1048576,
        "gib": 1073741824,
        "gibibyte": 1073741824,
        "gibibytes": 1073741824,
        "tib": 1099511627776,
        "tebibyte": 1099511627776,
        "tebibytes": 1099511627776,
    },
    "time": {
        "ms": Decimal("0.001"),
        "millisecond": Decimal("0.001"),
        "milliseconds": Decimal("0.001"),
        "s": 1,
        "sec": 1,
        "second": 1,
        "seconds": 1,
        "min": 60,
        "minute": 60,
        "minutes": 60,
        "hr": 3600,
        "hour": 3600,
        "hours": 3600,
        "day": 86400,
        "days": 86400,
        "week": 604800,
        "weeks": 604800,
    },
    "volume": {
        "ml": 1,
        "milliliter": 1,
        "milliliters": 1,
        "l": 1000,
        "liter": 1000,
        "liters": 1000,
        "tsp": Decimal("4.929"),
        "teaspoon": Decimal("4.929"),
        "teaspoons": Decimal("4.929"),
        "tbsp": Decimal("14.787"),
        "tablespoon": Decimal("14.787"),
        "tablespoons": Decimal("14.787"),
        "floz": Decimal("29.574"),
        "cup": Decimal("236.588"),
        "cups": Decimal("236.588"),
        "pt": Decimal("473.176"),
        "pint": Decimal("473.176"),
        "pints": Decimal("473.176"),
        "qt": Decimal("946.353"),
        "quart": Decimal("946.353"),
        "quarts": Decimal("946.353"),
        "gal": Decimal("3785.41"),
        "gallon": Decimal("3785.41"),
        "gallons": Decimal("3785.41"),
    },
}

# Flat lookup: lowercase name → (dimension, factor_or_key)
UNIT_LOOKUP = {}
for _dim, _units in UNIT_TABLE.items():
    for _name, _factor in _units.items():
        UNIT_LOOKUP[_name] = (_dim, _factor)


def convert_temperature(value, from_key, to_key):
    """Convert temperature via Kelvin as intermediate."""
    # To Kelvin
    if from_key == "c":
        k = value + Decimal("273.15")
    elif from_key == "f":
        k = (value - Decimal("32")) * Decimal("5") / Decimal("9") + Decimal("273.15")
    else:
        k = value
    # From Kelvin
    if to_key == "c":
        return k - Decimal("273.15")
    elif to_key == "f":
        return (k - Decimal("273.15")) * Decimal("9") / Decimal("5") + Decimal("32")
    else:
        return k


class ParseError(Exception):
    pass


def tokenize(text):
    """Tokenize text into math-relevant tokens, preserving words."""
    tokens = []
    i = 0
    n = len(text)
    while i < n:
        if text[i].isspace():
            i += 1
            continue

        start = i

        # ISO date: 2025-01-15 (must check before number parsing)
        if text[i].isdigit():
            dm = ISO_DATE_RE.match(text, i)
            if dm:
                try:
                    d = datetime.date.fromisoformat(dm.group())
                    tokens.append((DATE, d, start, dm.end()))
                    i = dm.end()
                    continue
                except ValueError:
                    pass  # fall through to number parsing

        # Hex/binary/octal: 0xFF, 0b1010, 0o77
        if text[i] == "0" and i + 1 < n and text[i + 1] in "xXbBoO":
            m = re.match(r"0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+", text[i:])
            if m:
                val = Decimal(int(m.group(), 0))
                end = i + m.end()
                tokens.append(("NUM", val, start, end))
                i = end
                continue

        # Numbers: 1,000 or 1_000 or 1.5 or .5 or 1.5e3 with optional SI suffix
        m = re.match(
            r"(\d(?:\d|_|,(?=\d))*\.?\d*|\.\d+)(?:([eE][+-]?\d+)|(" + SI_SUFFIX_RE + r"))?",
            text[i:],
        )
        if m and m.group(1):
            raw = m.group(1).replace(",", "").replace("_", "")
            exp = m.group(2)
            if exp:
                val = Decimal(raw + exp)
            else:
                val = Decimal(raw)
            suffix = m.group(3)
            if suffix:
                val *= SI_PREFIX[suffix]
            end = i + m.end()
            if end < n and text[end] == "%":
                tokens.append(("PCT", val, start, end + 1))
                i = end + 1
            else:
                tokens.append(("NUM", val, start, end))
                i = end
            continue

        typ = SINGLE_CHAR_TOKENS.get(text[i])
        if typ:
            tokens.append((typ, text[i], start, i + 1))
            i += 1
            continue

        # Words/identifiers
        m = re.match(r"[a-zA-Z_]\w*", text[i:])
        if m:
            word = m.group()
            wl = word.lower()
            end = i + m.end()
            if wl in DATE_KEYWORDS:
                tokens.append((DATE, _resolve_date_keyword(wl), start, end))
            elif wl == "of":
                tokens.append(("OF", "of", start, end))
            elif wl == "as":
                tokens.append(("AS", "as", start, end))
            elif wl in ("total", "sum"):
                tokens.append(("TOTAL", wl, start, end))
            elif wl in BUILTIN_FUNC_NAMES:
                tokens.append(("FUNC", wl, start, end))
            else:
                tokens.append(("WORD", word, start, end))
            i = end
            continue

        i += 1  # skip unknown chars

    tokens.append(("EOF", None, n, n))
    return tokens


DIM = "\033[2m"
BOLD = "\033[1m"
RED = "\033[31m"
GREEN = "\033[32m"
CYAN = "\033[36m"
RESET = "\033[0m"


def classify_line(text, variables, rates=None):
    """Classify tokens in a line for syntax highlighting.

    Returns "blank", "comment", "directive", or list of [start, end, dim] tuples.
    """
    stripped = text.strip()
    if not stripped:
        return "blank"
    if stripped.startswith("#"):
        return "comment"
    if DIRECTIVE_RE.match(stripped):
        return "directive"
    if RATE_RE.match(stripped):
        return "directive"

    variables = variables or {}
    tokens = tokenize(text)
    all_names = set(BUILTIN_CONSTS) | set(variables)

    has_date = any(t[0] == DATE for t in tokens) or any(
        t[0] == "WORD" and isinstance(variables.get(t[1].lower()), datetime.date) for t in tokens
    )

    has_math = any(
        t[0] in ("NUM", "PCT", "FUNC", "TOTAL", DATE)
        or (t[0] == "WORD" and t[1].lower() in all_names)
        for t in tokens
    )

    active = set()

    if has_date and has_math:
        # A date expression is active as a whole
        if _try_date_eval(tokens, variables) is not None:
            active.update(i for i, t in enumerate(tokens) if t[0] != "EOF")
        else:
            # Reduce parenthesized date sub-expressions for classification
            tokens = _reduce_date_subexprs(tokens, variables)
    if has_math and not active:
        if any(t[0] == "TOTAL" for t in tokens) and not any(
            t[0] in ("NUM", "PCT", "FUNC", "WORD", "LPAREN") for t in tokens
        ):
            for idx, t in enumerate(tokens):
                if t[0] == "TOTAL":
                    active.add(idx)
        else:
            math_start = 0
            if len(tokens) >= 3 and tokens[0][0] == "WORD" and tokens[1][0] == "EQ":
                active.add(0)
                active.add(1)
                math_start = 2

            conv = _detect_conversion(tokens, rates=rates)
            conversion, conv_start, conv_end = conv
            if conversion is not None:
                active.update(range(conv_start, conv_end))

            all_vars = {**BUILTIN_CONSTS, **variables, "total": 0, "sum": 0}
            math_tokens, math_to_orig = _build_math(tokens, math_start, all_vars, conv)
            result, consumed = _try_parse(math_tokens)

            if result is not None:
                for i in range(consumed):
                    active.add(math_to_orig[i])
            else:
                for i, orig_idx in enumerate(math_to_orig):
                    if math_tokens[i][0] in ("NUM", "PCT"):
                        active.add(orig_idx)

    spans = []
    pos = 0
    for idx, t in enumerate(tokens):
        if t[0] == "EOF":
            break
        start, end = t[2], t[3]
        if start > pos:
            spans.append([pos, start, True])
        spans.append([start, end, idx not in active])
        pos = end
    if pos < len(text):
        spans.append([pos, len(text), True])
    return spans


def colorize_expr(text, variables, rates=None):
    """Return text with dim escapes around ignored (non-math) words."""
    cls = classify_line(text, variables, rates=rates)
    if isinstance(cls, str):
        return text
    parts = []
    for start, end, dim in cls:
        chunk = text[start:end]
        if dim:
            parts.append(DIM + chunk + RESET)
        else:
            parts.append(chunk)
    return "".join(parts)


def colorize_line(line, result, fmt_result_str, align, variables, rates=None, indicator=None):
    """Return a colorized version of an output line."""
    stripped = line.strip()
    if result is not None:
        colored_expr = colorize_expr(stripped, variables, rates=rates)
        # Reconstruct with leading whitespace preserved
        leading = line[: len(line) - len(line.lstrip())]
        pad = max(align - len(line.rstrip()), 2)
        suffix = f" {DIM}{indicator}{RESET}" if indicator else ""
        return (
            leading
            + colored_expr
            + " " * pad
            + DIM
            + "# => "
            + RESET
            + GREEN
            + fmt_result_str
            + RESET
            + suffix
        )
    if stripped.startswith("#"):
        return BOLD + line + RESET
    if DIRECTIVE_RE.match(stripped) or RATE_RE.match(stripped):
        return DIM + line + RESET
    return line


class Parser:
    """Recursive descent parser for math expressions."""

    def __init__(self, tokens):
        self.tokens = tokens
        self.pos = 0

    def peek(self):
        return self.tokens[self.pos] if self.pos < len(self.tokens) else ("EOF", None)

    def consume(self):
        tok = self.tokens[self.pos]
        self.pos += 1
        return tok

    def parse_expr(self):
        left = self.parse_term()
        while self.peek()[0] == "ADDOP":
            op = self.consume()[1]
            # Handle percentage: 100 + 25% means 100 * 1.25
            if self.peek()[0] == "PCT":
                pct = self.consume()[1]
                if op == "+":
                    left *= 1 + pct / 100
                else:
                    left *= 1 - pct / 100
            else:
                right = self.parse_term()
                left = left + right if op == "+" else left - right
        # Handle "X as % of Y" → (X / Y) * 100
        if (
            self.peek()[0] == "AS"
            and self.pos + 2 < len(self.tokens)
            and self.tokens[self.pos + 1][0] == "MULOP"
            and self.tokens[self.pos + 1][1] == "%"
            and self.tokens[self.pos + 2][0] == "OF"
        ):
            self.consume()  # AS
            self.consume()  # %
            self.consume()  # OF
            right = self.parse_expr()
            if right == 0:
                raise ZeroDivisionError
            left = left / right * 100
        return left

    def parse_term(self):
        left = self.parse_power()
        while self.peek()[0] == "MULOP":
            op = self.consume()[1]
            right = self.parse_power()
            if op == "*":
                left *= right
            elif op == "/":
                if right == 0:
                    raise ZeroDivisionError
                left /= right
            elif op == "%":
                if right == 0:
                    raise ZeroDivisionError
                left %= right
        return left

    def parse_power(self):
        base = self.parse_unary()
        if self.peek()[0] == "POW":
            self.consume()
            exp = self.parse_power()
            if _pow_exceeds_limit(base, exp):
                raise ParseError("result too large")
            if exp == exp.to_integral_value():
                try:
                    return base**exp
                except (InvalidOperation, ArithmeticError):
                    pass  # e.g. 0**0, which Decimal refuses but float defines
            # non-integer exponent, or a case Decimal refuses: the float path, as
            # the JS engine and the other transcendentals already use
            try:
                return Decimal(str(float(base) ** float(exp)))
            except (ArithmeticError, ValueError, InvalidOperation):
                raise ParseError("result too large")
        return base

    def parse_unary(self):
        if self.peek()[0] == "ADDOP":
            op = self.consume()[1]
            val = self.parse_primary()
            return -val if op == "-" else val
        return self.parse_primary()

    def parse_primary(self):
        t = self.peek()
        if t[0] == "NUM":
            self.consume()
            return t[1]
        if t[0] == "PCT":
            self.consume()
            pct = t[1]
            if self.peek()[0] == "OF":
                self.consume()
                base = self.parse_expr()
                return pct / 100 * base
            return pct / 100  # standalone percentage
        if t[0] == "FUNC":
            name = self.consume()[1]
            if self.peek()[0] != "LPAREN":
                raise ParseError(f"Expected ( after {name}")
            self.consume()
            args = [self.parse_expr()]
            while self.peek()[0] == "COMMA":
                self.consume()
                args.append(self.parse_expr())
            if self.peek()[0] != "RPAREN":
                raise ParseError("Missing )")
            self.consume()
            if name in BUILTIN_FUNCS_1:
                if len(args) != 1:
                    raise ParseError(f"{name} takes 1 argument")
                return BUILTIN_FUNCS_1[name](args[0])
            if name in BUILTIN_FUNCS_N:
                return BUILTIN_FUNCS_N[name](args)
            raise ParseError(f"Unknown function: {name}")
        if t[0] == "LPAREN":
            self.consume()
            val = self.parse_expr()
            if self.peek()[0] != "RPAREN":
                raise ParseError("Missing )")
            self.consume()
            return val
        raise ParseError(f"Unexpected: {t}")


def _cross_rate(fr, to, rates):
    """Find a cross rate between *fr* and *to* via a shared intermediate currency.

    Returns the effective Decimal multiplier (1 fr = result to), or None.
    """

    def _rate_to_mid(currency, mid):
        """Return the rate that converts 1 *currency* into *mid* units."""
        if (currency, mid) in rates:
            return rates[(currency, mid)]
        if (mid, currency) in rates:
            return Decimal(1) / rates[(mid, currency)]
        return None

    # Collect all currencies mentioned in any rate pair
    mids = set()
    for a, b in rates:
        mids.add(a)
        mids.add(b)

    for mid in mids:
        if mid == fr or mid == to:
            continue
        r_fr = _rate_to_mid(fr, mid)
        r_to = _rate_to_mid(to, mid)
        if r_fr is not None and r_to is not None:
            return r_fr / r_to
    return None


def _detect_conversion(tokens, rates=None):
    """Detect unit conversion: ... <from_unit> in|to <to_unit> ...

    Scans backwards through all token positions.
    Returns (conversion_info, conv_start, conv_end) where conv_end is exclusive.
    """
    eof_idx = len(tokens) - 1
    # Scan backwards for the pattern: WORD(from) WORD(in/to) WORD(to)
    for i in range(eof_idx - 3, -1, -1):
        t_fr = tokens[i]
        t_kw = tokens[i + 1]
        t_to = tokens[i + 2]
        if (
            t_to[0] in ("WORD", "FUNC")
            and t_kw[0] == "WORD"
            and t_kw[1].lower() in ("in", "to")
            and t_fr[0] in ("WORD", "FUNC")
        ):
            fr_name = t_fr[1].lower()
            to_name = t_to[1].lower()
            if fr_name in UNIT_LOOKUP and to_name in UNIT_LOOKUP:
                fr_dim, fr_factor = UNIT_LOOKUP[fr_name]
                to_dim, to_factor = UNIT_LOOKUP[to_name]
                if fr_dim == to_dim:
                    return (fr_dim, fr_factor, to_factor), i, i + 3
            if rates:
                pair = (fr_name, to_name)
                rev = (to_name, fr_name)
                if pair in rates:
                    return ("rate", rates[pair], Decimal(1)), i, i + 3
                elif rev in rates:
                    return ("rate", Decimal(1), rates[rev]), i, i + 3
                else:
                    cross = _cross_rate(fr_name, to_name, rates)
                    if cross is not None:
                        return ("rate", cross, Decimal(1)), i, i + 3
    return None, eof_idx, eof_idx


def _build_math(tokens, start, all_vars, conv):
    """Build math token list, resolving variables and skipping non-math tokens.

    *conv* is the triple returned by _detect_conversion. Returns
    (math_tokens, math_to_orig), where math_to_orig[i] is the original token
    index that math_tokens[i] came from.
    """
    conversion, conv_start, conv_end = conv
    pairs = []  # (token, original index)
    paren_depth = 0
    for idx in range(start, len(tokens)):
        t = tokens[idx]
        if conv_start <= idx < conv_end:
            # Replace the conversion span with inline MULOP(*) NUM(factor)
            if idx == conv_start and conversion is not None:
                dim, from_factor, to_factor = conversion
                if dim != "temperature":
                    factor = Decimal(str(from_factor)) / Decimal(str(to_factor))
                    pairs.append((("MULOP", "*", t[2], t[3]), idx))
                    pairs.append((("NUM", factor, t[2], t[3]), idx))
            continue
        if t[0] == "WORD":
            wl = t[1].lower()
            if wl in all_vars and not isinstance(all_vars[wl], datetime.date):
                pairs.append((("NUM", all_vars[wl], t[2], t[3]), idx))
        elif t[0] == "TOTAL":
            if "total" in all_vars:
                pairs.append((("NUM", all_vars["total"], t[2], t[3]), idx))
        elif t[0] in ("EQ", DATE) or (t[0] == "COMMA" and paren_depth == 0):
            pass
        else:
            if t[0] == "LPAREN":
                paren_depth += 1
            elif t[0] == "RPAREN":
                paren_depth -= 1
            pairs.append((t, idx))

    pairs = _strip_empty_parens(pairs)
    pairs = _strip_orphan_ops(pairs, start)
    return [t for t, _ in pairs], [i for _, i in pairs]


def _strip_empty_parens(pairs):
    """Drop parens left empty (or holding only commas) after WORDs were skipped."""
    changed = True
    while changed:
        changed = False
        out = []
        i = 0
        while i < len(pairs):
            if pairs[i][0][0] == "LPAREN":
                j = i + 1
                while j < len(pairs) and pairs[j][0][0] == "COMMA":
                    j += 1
                if j < len(pairs) and pairs[j][0][0] == "RPAREN":
                    i = j + 1
                    changed = True
                    continue
            out.append(pairs[i])
            i += 1
        pairs = out
    return pairs


def _strip_orphan_ops(pairs, start):
    """Drop operators left dangling after WORDs were skipped.

    A leading or doubled operator goes away, except a unary minus. A MULOP stays
    so that the parse fails, instead of silently exposing the numbers after it.
    """
    changed = True
    while changed:
        changed = False
        out = []
        for i, (t, orig) in enumerate(pairs):
            if t[0] in ("ADDOP", "MULOP"):
                prev = out[-1][0][0] if out else None
                nxt = pairs[i + 1][0][0] if i + 1 < len(pairs) else "EOF"
                if prev is None or prev in ("ADDOP", "MULOP"):
                    unary_minus = (
                        t[0] == "ADDOP"
                        and t[1] == "-"
                        and nxt in ("NUM", "LPAREN", "FUNC")
                        # a leading minus must be the first token of the expression
                        and (prev is not None or orig == start)
                    )
                    if t[0] != "MULOP" and not unary_minus:
                        changed = True
                        continue
                elif nxt in ("EOF", "RPAREN"):
                    changed = True
                    continue
            out.append((t, orig))
        pairs = out
    return pairs


def _is_annotation(tokens):
    """True when the tokens are only balanced parenthetical notes, e.g. "(net 30)"."""
    depth = 0
    for t in tokens:
        if t[0] == "EOF":
            break
        if depth == 0 and t[0] != "LPAREN":
            return False
        if t[0] == "LPAREN":
            depth += 1
        elif t[0] == "RPAREN":
            depth -= 1
    return depth == 0


def _try_parse(math_tokens):
    """Parse math tokens, allowing trailing balanced parenthetical annotations.

    Returns (result, consumed) on success, or (None, -1) on failure.
    """
    try:
        parser = Parser(math_tokens)
        result = parser.parse_expr()
        if _is_annotation(math_tokens[parser.pos :]):
            return result, parser.pos
        return None, -1
    except (ParseError, ArithmeticError, ValueError):
        return None, -1


def _reduce_date_subexprs(tokens, variables):
    """Replace parenthesized date sub-expressions with NUM tokens.

    E.g. ``(2025-03-01 - 2025-01-01) days in s`` becomes ``59 days in s``.
    Only replaces when the sub-expression evaluates to a number (Decimal).
    """
    result = list(tokens)
    changed = True
    while changed:
        changed = False
        for i, t in enumerate(result):
            if t[0] != "LPAREN":
                continue
            depth = 1
            j = i + 1
            while j < len(result) and depth > 0:
                if result[j][0] == "LPAREN":
                    depth += 1
                elif result[j][0] == "RPAREN":
                    depth -= 1
                j += 1
            # j is now past the matching RPAREN
            sub = result[i + 1 : j - 1]
            if not any(tok[0] == DATE for tok in sub):
                continue
            sub_with_eof = sub + [("EOF", None, 0, 0)]
            date_result = _try_date_eval(sub_with_eof, variables)
            if date_result is not None:
                val, _ = date_result
                if isinstance(val, Decimal):
                    result[i:j] = [("NUM", val, result[i][2], result[j - 1][3])]
                    changed = True
                    break
    return result


def _eval_count(tokens, all_vars):
    """Evaluate tokens to an integer count, or None when they do not resolve."""
    resolved = []
    for t in tokens:
        if t[0] == "WORD":
            wl = t[1].lower()
            if wl not in all_vars or isinstance(all_vars[wl], datetime.date):
                return None
            resolved.append(("NUM", all_vars[wl], t[2], t[3]))
        else:
            resolved.append(t)
    resolved.append(("EOF", None, 0, 0))
    value, _ = _try_parse(resolved)
    return None if value is None else int(value)


def _try_date_eval(tokens, variables):
    """Try to evaluate a date expression. Returns (result, variables) or None.

    Patterns:
    1. days until/since DATE → number
    2. DATE ± N duration_unit → date
    3. DATE - DATE → number (days)
    """
    try:
        return _try_date_eval_inner(tokens, variables)
    except Exception:
        return None


def _try_date_eval_inner(tokens, variables):
    # Resolve date-holding variables: replace WORD tokens whose variable is a date
    resolved = []
    for t in tokens:
        if t[0] == "WORD":
            wl = t[1].lower()
            val = variables.get(wl)
            if isinstance(val, datetime.date):
                resolved.append((DATE, val, t[2], t[3]))
                continue
        resolved.append(t)

    # Check if there are any DATE tokens
    if not any(t[0] == DATE for t in resolved):
        return None

    # Strip assignment prefix
    var_name = None
    toks = resolved
    if len(toks) >= 3 and toks[0][0] == "WORD" and toks[1][0] == "EQ":
        var_name = toks[0][1].lower()
        toks = toks[2:]

    # Filter out EOF for pattern matching
    body = [t for t in toks if t[0] != "EOF"]
    if not body:
        return None

    # Strip outer parentheses
    while len(body) >= 2 and body[0][0] == "LPAREN" and body[-1][0] == "RPAREN":
        body = body[1:-1]
    if not body:
        return None

    def _finish(result):
        if var_name:
            return result, {**variables, var_name: result}
        return result, variables

    # Pattern 1: "days/weeks until/since DATE" (checked before label stripping)
    if (
        len(body) == 3
        and body[0][0] == "WORD"
        and body[0][1].lower() in ("days", "weeks")
        and body[1][0] == "WORD"
        and body[1][1].lower() in ("until", "since")
        and body[2][0] == DATE
    ):
        today = datetime.date.today()
        direction = body[1][1].lower()
        target = body[2][1]
        diff_days = (target - today).days if direction == "until" else (today - target).days
        if body[0][1].lower() == "weeks":
            return _finish(Decimal(diff_days) / Decimal(7))
        return _finish(Decimal(diff_days))

    # Strip leading label tokens before the first DATE for remaining patterns
    labels_stripped = False
    first_date_idx = next((i for i, t in enumerate(body) if t[0] == DATE), None)
    if first_date_idx is not None and first_date_idx > 0:
        if all(t[0] in ("WORD", "LPAREN", "RPAREN", "COMMA") for t in body[:first_date_idx]):
            body = body[first_date_idx:]
            labels_stripped = True

    # Pattern 0: bare DATE (e.g., "today", "2025-01-15")
    if len(body) == 1 and body[0][0] == DATE:
        if labels_stripped:
            return None
        return _finish(body[0][1])

    # Pattern 2: DATE ± expr duration_unit (supports compound: + 1 week + 3 days)
    if len(body) >= 4 and body[0][0] == DATE and body[1][0] == "ADDOP":
        all_vars = {**BUILTIN_CONSTS, **variables}
        d = body[0][1]
        pos = 1
        ok = True
        while ok and pos < len(body) and body[pos][0] == "ADDOP":
            op = body[pos][1]
            pos += 1
            # The segment runs up to the duration unit that closes it
            dur_pos = next(
                (
                    j
                    for j in range(pos, len(body))
                    if body[j][0] == "WORD" and body[j][1].lower() in DURATION_UNITS
                ),
                None,
            )
            if dur_pos is None or dur_pos == pos:
                ok = False
                break
            n = _eval_count(body[pos:dur_pos], all_vars)
            if n is None:
                ok = False
                break
            unit = body[dur_pos][1].lower()
            n = -n if op == "-" else n
            if unit in ("day", "days"):
                d = d + datetime.timedelta(days=n)
            elif unit in ("week", "weeks"):
                d = d + datetime.timedelta(weeks=n)
            elif unit in ("month", "months"):
                d = _add_months(d, n)
            else:  # year, years
                d = _add_months(d, n * 12)
            pos = dur_pos + 1
        if ok and _is_annotation(body[pos:]):
            return _finish(d)

    # Pattern 3: DATE - DATE → number of days
    if (
        len(body) == 3
        and body[0][0] == DATE
        and body[1][0] == "ADDOP"
        and body[1][1] == "-"
        and body[2][0] == DATE
    ):
        d1 = body[0][1]
        d2 = body[2][1]
        return _finish(Decimal((d1 - d2).days))

    return None


def evaluate_line(text, variables, rates=None, results_acc=None):
    """Evaluate a line. Returns (result, variables, has_total) or (None, variables, False)."""
    tokens = tokenize(text)

    has_total = any(t[0] == "TOTAL" for t in tokens)

    # Try date evaluation first
    date_result = _try_date_eval(tokens, variables)
    if date_result is not None:
        r, v = date_result
        return r, v, has_total

    # Reduce parenthesized date sub-expressions to numbers
    # e.g. (2025-03-01 - 2025-01-01) days in s → 59 days in s
    tokens = _reduce_date_subexprs(tokens, variables or {})

    all_vars = {**BUILTIN_CONSTS, **variables}

    # Compute subtotal from accumulator and inject as "total"/"sum"
    if results_acc is not None:
        subtotal = sum(r for r in results_acc if r is not None and not isinstance(r, datetime.date))
        all_vars["total"] = subtotal
        all_vars["sum"] = subtotal

    has_value = any(
        t[0] in ("NUM", "PCT", "FUNC", DATE, "TOTAL")
        or (t[0] == "WORD" and t[1].lower() in all_vars)
        for t in tokens
    )
    if not has_value:
        return None, variables, False

    pos = 0
    var_name = None
    if len(tokens) >= 3 and tokens[0][0] == "WORD" and tokens[1][0] == "EQ":
        var_name = tokens[0][1].lower()
        pos = 2

    conv = _detect_conversion(tokens, rates=rates)
    math_tokens, _ = _build_math(tokens, pos, all_vars, conv)
    result, _ = _try_parse(math_tokens)

    if result is None:
        return None, variables, False
    if conv[0] is not None:
        dim, from_factor, to_factor = conv[0]
        if dim == "temperature":
            result = convert_temperature(result, from_factor, to_factor)
    if var_name:
        variables = {**variables, var_name: result}
    return result, variables, has_total


def _fixed(d, places, group=True):
    """Round half-even to `places` decimals. Never falls back to exponential."""
    return format(d, ("," if group else "") + "." + str(places) + "f")


def _sci(d, dec):
    """Scientific notation, half-even, exponent padded to two digits."""
    if d == 0:
        # Decimal formats zero with a stray exponent (0E-6 -> "0.00000e-1")
        return ("0." + "0" * dec if dec else "0") + "e+00"
    return re.sub(r"e([+-])(\d)$", r"e\g<1>0\2", format(d, "." + str(dec) + "e"))


def _strip(s):
    """Drop trailing fraction zeros."""
    return s.rstrip("0").rstrip(".") if "." in s else s


def format_result(n, fmt_opts=None):
    """Format a number according to fmt_opts.

    Formats from the exact decimal value, never via float, so that this and the
    JS engine agree. Rounding is half-even in every mode.
    """
    if isinstance(n, datetime.date):
        return n.isoformat()
    if fmt_opts is None:
        fmt_opts = DEFAULT_FMT_OPTS
    d = n if isinstance(n, Decimal) else Decimal(str(n))
    mode = fmt_opts["mode"]
    prec = fmt_opts["precision"]
    sep = fmt_opts["separator"]

    def apply_sep(s):
        if sep == "comma":
            return s
        if sep == "underscore":
            return s.replace(",", "_")
        if sep == "space":
            return s.replace(",", " ")
        return s.replace(",", "")  # "off"

    if not d.is_finite() or abs(d.adjusted()) > MAX_RESULT_DIGITS:
        return "too large"

    if mode == "minSig":
        if d == 0:
            return apply_sep("0")
        show_dec = max(prec - d.adjusted() - 1, 0)
        return apply_sep(_strip(_fixed(d, show_dec)) if show_dec else _fixed(d, 0))

    if mode == "fixed":
        return apply_sep(_fixed(d, prec))

    if mode == "scientific":
        return _sci(d, max(prec - 1, 0))

    if mode == "eng":
        if d == 0:
            return "0"
        exp = d.adjusted()
        e3 = (exp // 3) * 3
        dec = max(prec - (exp - e3) - 1, 0)
        mant = d.scaleb(-e3).quantize(Decimal(1).scaleb(-dec), rounding=ROUND_HALF_EVEN)
        if abs(mant) >= 1000:  # rounding pushed the mantissa up a decade
            mant, e3 = mant.scaleb(-3), e3 + 3
        if e3 == 0 or e3 in ENG_SUFFIX:
            return _strip(_fixed(mant, dec, group=False)) + ENG_SUFFIX.get(e3, "")
        return _sci(d, max(prec - 1, 0))  # outside the SI range

    if mode == "auto":
        # %g semantics: exponential when exp < -4 or exp >= precision, zeros stripped
        if d == 0:
            return "0"
        exp = d.adjusted()
        if exp < -4 or exp >= prec:
            mant, _, e = _sci(d, max(prec - 1, 0)).partition("e")
            return _strip(mant) + "e" + e
        return _strip(_fixed(d, max(prec - 1 - exp, 0), group=False))

    return str(d)


Line = collections.namedtuple(
    "Line",
    "clean result fmt_opts variables rates is_total",
    defaults=(None, None, None, None, False),
)


def _apply_directive(stripped, fmt_opts, rates):
    """Apply a @rate, @format or @separator line. True when the line was one."""
    rm = RATE_RE.match(stripped)
    if rm:
        rates[(rm.group(1).lower(), rm.group(2).lower())] = Decimal(rm.group(3).strip())
        return True
    dm = DIRECTIVE_RE.match(stripped)
    if not dm:
        return False
    key, val = dm.group(1).lower(), dm.group(2).strip()
    if key == "format":
        fm = FORMAT_RE.match(val)
        if fm:
            mode = fm.group(1).lower()
            fmt_opts["mode"] = "minSig" if mode == "minsig" else mode
            if fm.group(2) is not None:
                fmt_opts["precision"] = int(fm.group(2))
            else:
                fmt_opts["precision"] = 10 if mode == "minsig" else 3
    elif key == "separator" and val.lower() in ("off", "underscore", "comma", "space"):
        fmt_opts["separator"] = val.lower()
    return True


def _process_lines(content):
    """Evaluate every line of *content*, yielding one Line per input line."""
    lines = content.split("\n")
    if lines and lines[-1] == "":
        lines = lines[:-1]

    variables = {}
    rates = {}
    results_acc = []
    fmt_opts = dict(DEFAULT_FMT_OPTS)

    for line in lines:
        clean = RESULT_RE.sub("", line).rstrip()
        stripped = clean.strip()

        if _apply_directive(stripped, fmt_opts, rates):
            yield Line(clean)
            continue

        if stripped.startswith("#"):
            results_acc.clear()
            yield Line(clean)
            continue

        if not stripped:
            results_acc.append(None)
            yield Line("")
            continue

        vars_before = dict(variables)
        result, variables, is_total = evaluate_line(
            stripped, variables, rates=rates, results_acc=results_acc
        )
        results_acc.append(result)
        if result is None:
            yield Line(clean)
            continue
        yield Line(clean, result, dict(fmt_opts), vars_before, dict(rates), is_total)
        if is_total:
            results_acc.clear()


def _split_sections(evaluated):
    """Split the lines into sections. A header line starts a new section."""
    sections = []
    current = []
    for line in evaluated:
        if current and line.result is None and line.clean.strip().startswith("#"):
            sections.append(current)
            current = []
        current.append(line)
    if current:
        sections.append(current)
    return sections


def _total_indicators(section):
    """Mark the lines that feed a total ("|") and the total lines themselves."""
    indicators = [None] * len(section)
    for i, line in enumerate(section):
        if not line.is_total:
            continue
        indicators[i] = "\u2518"
        for j in range(i - 1, -1, -1):  # back to the previous total
            if section[j].is_total:
                break
            if section[j].result is not None:
                indicators[j] = "\u2502"
    return indicators


def _align_decimals(fmt_strs):
    """Left-pad plain numbers so that their decimal points line up."""
    int_widths = {}
    for i, s in enumerate(fmt_strs):
        if s is not None and ALIGNABLE_RE.match(s):
            dot = s.find(".")
            int_widths[i] = dot if dot >= 0 else len(s)
    if len(int_widths) < 2:
        return list(fmt_strs)
    max_int_w = max(int_widths.values())
    return [
        " " * (max_int_w - int_widths[i]) + s if i in int_widths else s
        for i, s in enumerate(fmt_strs)
    ]


def _format_section(section, use_color):
    """Format one section into plain and colored output lines."""
    widths = [len(line.clean) for line in section if line.result is not None]
    align = max(max(widths) + 2, 40) if widths else 40

    fmt_strs = _align_decimals(
        [
            format_result(line.result, line.fmt_opts) if line.result is not None else None
            for line in section
        ]
    )
    indicators = _total_indicators(section)
    ind_width = max(
        [len(f) for f, ind in zip(fmt_strs, indicators) if ind and f is not None],
        default=0,
    )

    out = []
    col = []
    for line, fmt_str, indicator in zip(section, fmt_strs, indicators):
        if line.result is None:
            out.append(line.clean)
            if use_color:
                col.append(colorize_line(line.clean, None, None, align, None))
            continue
        padded = fmt_str.ljust(ind_width) if indicator else fmt_str
        suffix = f" {indicator}" if indicator else ""
        out.append(f"{line.clean.ljust(align)}# => {padded}{suffix}")
        if use_color:
            col.append(
                colorize_line(
                    line.clean,
                    line.result,
                    padded,
                    align,
                    line.variables,
                    rates=line.rates,
                    indicator=indicator,
                )
            )
    return out, col


def _color_enabled(no_color):
    """True when the terminal accepts ANSI colors."""
    return (
        not no_color
        and sys.stdout.isatty()
        and not os.environ.get("NO_COLOR", "")
        and os.environ.get("TERM") != "dumb"
    )


def _diff_color(line):
    """ANSI color for one unified-diff line."""
    if line.startswith(("---", "+++")):
        return BOLD
    if line.startswith("@@"):
        return CYAN
    if line.startswith("-"):
        return RED
    if line.startswith("+"):
        return GREEN
    return ""


def _write_diff(filepath, original, new_content, no_color):
    """Print a unified diff of the pending changes."""
    diff = difflib.unified_diff(
        original.splitlines(keepends=True),
        new_content.splitlines(keepends=True),
        fromfile=filepath,
        tofile=filepath,
    )
    color = _color_enabled(no_color)
    for line in diff:
        c = _diff_color(line) if color else ""
        sys.stdout.write((c + line + RESET) if c else line)


def process_file(filepath, show=False, no_color=False, stdin_content=None, dry_run=False):
    """Read, evaluate, and write back the file with results (or print to stdout)."""
    if stdin_content is not None:
        original = stdin_content
    else:
        with open(filepath, "r") as f:
            original = f.read()

    use_color = show and _color_enabled(no_color)

    output = []
    colored_output = []
    for section in _split_sections(_process_lines(original)):
        out, col = _format_section(section, use_color)
        output.extend(out)
        colored_output.extend(col)

    new_content = "\n".join(output) + "\n"
    changed = new_content != original

    if show:
        sys.stdout.write("\n".join(colored_output) + "\n" if use_color else new_content)
    elif dry_run:
        if changed:
            _write_diff(filepath, original, new_content, no_color)
    elif changed:
        with open(filepath, "w") as f:
            f.write(new_content)
    return changed


def process_json(content):
    """Evaluate content and return structured results as a list of dicts."""
    output = []
    for line in _process_lines(content):
        if line.result is None:
            value = None
        elif isinstance(line.result, datetime.date):
            value = line.result.isoformat()
        else:
            value = float(line.result)
        output.append({"input": line.clean, "result": value})
    return output


def watch_file(filepath, show=False, no_color=False, interval=0.5):
    """Watch file for changes and re-process."""
    last_mtime = os.path.getmtime(filepath)
    print(f"Watching {filepath} for changes... (Ctrl+C to stop)", file=sys.stderr)
    try:
        while True:
            try:
                mtime = os.path.getmtime(filepath)
                if mtime != last_mtime:
                    if show:
                        sys.stderr.write("\033[2J\033[H")
                        sys.stderr.flush()
                    if process_file(filepath, show=show, no_color=no_color):
                        if not show:
                            print("  Updated results.")
                    last_mtime = os.path.getmtime(filepath)
            except FileNotFoundError:
                pass
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nStopped.", file=sys.stderr)
        sys.exit(130)


def _get_version():
    """Get version from package metadata or pyproject.toml fallback."""
    try:
        return importlib.metadata.version("calced")
    except importlib.metadata.PackageNotFoundError:
        # Running from a source checkout: pyproject.toml sits in the repo root.
        toml_path = os.path.join(os.path.dirname(__file__), "..", "pyproject.toml")
        try:
            with open(toml_path) as f:
                for line in f:
                    if line.startswith("version"):
                        return line.split('"')[1]
        except OSError:
            pass
        return "0"


def main():
    parser = argparse.ArgumentParser(
        prog="calced",
        description="A notepad calculator that evaluates expressions in text files. Updates the input file in-place with results.",
        epilog="examples:\n  calced expenses.txt        evaluate and update file in-place\n  calced -s expenses.txt     print results to stdout\n  calced -w expenses.txt     watch file and re-evaluate on changes\n\ndocs & issues: https://github.com/karlb/calced",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("-V", "--version", action="version", version=f"%(prog)s {_get_version()}")
    parser.add_argument("file", help="path to input file")
    parser.add_argument(
        "-w", "--watch", action="store_true", help="watch for changes and auto-update"
    )
    output_group = parser.add_mutually_exclusive_group()
    output_group.add_argument(
        "-s",
        "--show",
        action="store_true",
        help="print result to stdout instead of updating the file",
    )
    output_group.add_argument(
        "-u",
        "--url",
        action="store_true",
        help="print URL for the web version of the file",
    )
    output_group.add_argument(
        "--json",
        action="store_true",
        help="output results as JSON",
    )
    output_group.add_argument(
        "-n",
        "--dry-run",
        action="store_true",
        help="show diff of what would change without updating the file",
    )
    parser.add_argument(
        "--no-color",
        action="store_true",
        help="disable colored output",
    )
    args = parser.parse_args()

    if args.watch and (args.url or args.json or args.dry_run):
        parser.error("--watch cannot be used with --url, --json, or --dry-run")

    if args.file == "-":
        content = sys.stdin.read()
        if args.json:
            print(json.dumps(process_json(content), indent=2))
        else:
            process_file(None, show=True, no_color=args.no_color, stdin_content=content)
        return

    if not os.path.exists(args.file):
        print(f"Error: {args.file} not found", file=sys.stderr)
        sys.exit(1)

    if args.url:
        content = open(args.file).read()
        content = re.sub(r"\s+# => .*$", "", content, flags=re.MULTILINE)
        compressed = zlib.compress(content.encode(), wbits=-15)
        encoded = base64.b64encode(compressed).decode()
        encoded = encoded.replace("+", "-").replace("/", "_").rstrip("=")
        major = _get_version().split(".")[0]
        print(f"https://calced.karl.berlin/{major}/#{encoded}")
        return

    if args.json:
        with open(args.file) as f:
            content = f.read()
        print(json.dumps(process_json(content), indent=2))
        return

    if args.dry_run:
        changed = process_file(args.file, dry_run=True)
        sys.exit(1 if changed else 0)

    if args.show and args.watch:
        sys.stderr.write("\033[2J\033[H")
        sys.stderr.flush()
    process_file(args.file, show=args.show, no_color=args.no_color)

    if args.watch:
        watch_file(args.file, show=args.show, no_color=args.no_color)


if __name__ == "__main__":
    main()
