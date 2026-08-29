#!/usr/bin/env python3
"""Differential fuzz: the Python and JS engines must agree on every result.

The .md fixtures and JSON vectors compare each engine to a hand-written value, so
a case nobody thought to write can drift silently. This generates cases instead.

Every result must match exactly, with one documented exception: CPython's and
V8's libm return doubles that differ in the last ulp for some transcendental
inputs (tan far from zero, non-integer powers). Both engines then print their own
double faithfully. Those are counted, capped, and reported, not silenced.
"""

import json
import os
import random
import subprocess
import sys
import unittest
from decimal import Decimal, InvalidOperation, localcontext

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "python"))
import calced  # noqa: E402

SEED = int(os.environ.get("CALCED_FUZZ_SEED", "20260829"))
EXPRESSIONS = int(os.environ.get("CALCED_FUZZ_N", "500"))
DOC_LINES = 40  # keep documents the size real ones are

MODES = [
    "minSig(10)",
    "minSig(3)",
    "minSig(15)",
    "minSig(1)",
    "fixed(0)",
    "fixed(2)",
    "fixed(4)",
    "fixed(8)",
    "scientific(6)",
    "scientific(1)",
    "eng(3)",
    "eng(4)",
    "eng(6)",
    "auto(8)",
    "auto(3)",
    "auto(15)",
]
SEPARATORS = ["off", "comma", "underscore", "space"]
OPS = ["+", "-", "*", "/", "%"]
FUNCS = ["sqrt", "abs", "ln", "log", "log2", "sin", "cos", "tan", "exp", "round", "floor", "ceil"]
UNITS = [
    ("km", "m"),
    ("kg", "g"),
    ("h", "min"),
    ("MB", "KB"),
    ("C", "F"),
    ("mi", "km"),
    ("lb", "kg"),
    ("gal", "l"),
    ("GiB", "MiB"),
    ("min", "s"),
]


def _num(rnd):
    return rnd.choice(
        [
            f"{rnd.randint(1, 999999)}",
            f"{rnd.uniform(0.0001, 10000):.6f}",
            f"{rnd.randint(1, 99)}.{rnd.choice(['5', '25', '125', '05', '75', '375', '625', '0625'])}",
            f"{rnd.randint(1, 90)}k",
            f"{rnd.randint(1, 9)}M",
            f"{rnd.randint(1, 9)}u",
            f"{rnd.uniform(1, 9):.3f}e{rnd.randint(-8, 8)}",
            f"0.{rnd.randint(1, 999)}",
        ]
    )


def _expression(rnd):
    k = rnd.random()
    if k < 0.20:
        return f"{_num(rnd)} {rnd.choice(OPS)} {_num(rnd)}"
    if k < 0.36:
        return f"{_num(rnd)} {rnd.choice(OPS)} {_num(rnd)} {rnd.choice(OPS)} {_num(rnd)}"
    if k < 0.45:
        return f"{rnd.choice(FUNCS)}({_num(rnd)})"
    if k < 0.53:
        return f"{_num(rnd)} ^ {rnd.choice(['2', '3', '4', '0.5', '-1', '-2', '1.5', '0.25'])}"
    if k < 0.61:
        return f"({_num(rnd)} + {_num(rnd)}) / ({_num(rnd)} - {_num(rnd)})"
    if k < 0.68:
        return f"{rnd.randint(1, 99)}% of {_num(rnd)}"
    if k < 0.74:
        return f"{_num(rnd)} {rnd.choice(['+', '-'])} {rnd.randint(1, 80)}%"
    if k < 0.80:
        return f"{_num(rnd)} as % of {_num(rnd)}"
    if k < 0.90:
        frm, to = rnd.choice(UNITS)
        return f"{_num(rnd)} {frm} to {to}"
    return f"max({_num(rnd)}, {_num(rnd)}) / min({_num(rnd)}, {_num(rnd)})"


def _documents():
    """Many small documents, one format/separator pair each."""
    rnd = random.Random(SEED)
    exprs = [_expression(rnd) for _ in range(EXPRESSIONS)]
    docs = []
    for i, mode in enumerate(MODES):
        sep = SEPARATORS[i % len(SEPARATORS)]
        for start in range(0, len(exprs), DOC_LINES):
            docs.append(
                [f"@format = {mode}", f"@separator = {sep}"] + exprs[start : start + DOC_LINES]
            )
    return docs


def _python_results(docs):
    out = []
    for doc in docs:
        results = []
        for line in calced._process_lines("\n".join(doc)):
            results.append(
                None
                if line.result is None
                else calced.format_result(line.result, line.fmt_opts).strip()
            )
        out.append(results)
    return out


def _js_results(docs):
    proc = subprocess.run(
        ["node", os.path.join(ROOT, "tests", "differential.mjs")],
        input=json.dumps(docs),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError("JS engine failed: " + proc.stderr[-2000:])
    return json.loads(proc.stdout)


FLOAT_PATH = tuple(FUNCS) + ("^",)
LIBM_BUDGET = 0.001  # share of results allowed to differ only in the last digits


def _is_float_path(expr):
    """Transcendentals and non-integer powers are computed in float64 by both."""
    return any(tok in expr for tok in FLOAT_PATH)


def _agree_to(p, j, digits):
    """True when two formatted numbers agree once rounded to `digits` figures."""
    try:
        a, b = (
            Decimal(p.replace("_", "").replace(",", "").replace(" ", "")),
            Decimal(j.replace("_", "").replace(",", "").replace(" ", "")),
        )
    except (InvalidOperation, AttributeError):
        return False
    with localcontext() as ctx:
        ctx.prec = digits
        return +a == +b


class TestDifferential(unittest.TestCase):
    def test_engines_agree(self):
        docs = _documents()
        py = _python_results(docs)
        js = _js_results(docs)
        self.assertEqual(len(py), len(js), "document count mismatch")

        mismatches, libm = [], []
        lines = 0
        for doc, prow, jrow in zip(docs, py, js):
            for i, (p, j) in enumerate(zip(prow, jrow)):
                lines += 1
                if p == j:
                    continue
                where = f"{doc[0]} {doc[1]}\n    {doc[i]!r}\n    py={p!r}\n    js={j!r}"
                if _is_float_path(doc[i]) and _agree_to(p, j, 14):
                    libm.append(where)
                else:
                    mismatches.append(where)
        if mismatches:
            self.fail(
                f"{len(mismatches)} of {lines} results differ between engines:\n  "
                + "\n  ".join(mismatches[:15])
            )
        if len(libm) > lines * LIBM_BUDGET:
            self.fail(
                f"{len(libm)} of {lines} results differ in the last digits, over the "
                f"{LIBM_BUDGET:.1%} libm budget:\n  " + "\n  ".join(libm[:15])
            )
        if libm:
            print(
                f"\n  {len(libm)} of {lines} differ in the last digits only (libm), within budget"
            )


if __name__ == "__main__":
    unittest.main()
