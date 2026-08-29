# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Calced is a notepad calculator that evaluates math expressions in plain text. Two implementations share the same syntax and test suite:

- **Python CLI** (`python/calced.py`) — single file, stdlib only, uses `Decimal` for precision
- **JavaScript web app** (`web/`) — ES modules, big.js for precision, no build step

When referring to "JS" or "JavaScript", that means the web version in `web/`.

## Commands

Automation uses [invoke](https://www.pyinvoke.org/). Run `inv -l` for the full list.

```bash
uv sync                # Create .venv with the dev dependencies
inv ci                 # Lint + all tests
inv lint               # ruff check + ruff format --check
inv format             # ruff format
inv test               # All tests (Python + JS)
inv test-py            # Python unit tests + .md integration tests
inv test-js            # JavaScript tests (node web/test.mjs)

# Serve the web app. ES modules need HTTP; file:// does not work.
python3 -m http.server 8000 --directory web
inv test-property      # Property-based tests (hypothesis)
inv test-diff          # Differential fuzz between both engines

# Run a single Python test file
uv run python -m unittest tests.test_evaluate

# Run a single .md integration test
uv run python python/calced.py tests/basic_arithmetic.md
git diff --exit-code -- tests/basic_arithmetic.md  # verify no changes

# Regenerate README (uses cogapp to run inline examples)
inv readme
```

## Architecture

Both implementations follow the same pipeline: **tokenize → classify line → parse → evaluate → format result → align output**.

- `python/calced.py` (~1500 lines): recursive descent parser, `Decimal` arithmetic, CLI with argparse (modes: single-run, watch, show, url, json, dry-run)
- `web/`: the same engine as ES modules. Import only the module you need.

| File | Holds |
| --- | --- |
| `index.html` | head, markup, `<link>` and `<script type="module" src="app.js">` |
| `style.css` | all styles |
| `vendor/big.js` | vendored big.js v6.2.2 |
| `builtins.js` | numeric context, built-in functions and constants. Re-exports a configured `Big` |
| `units.js` | SI prefixes, unit conversion tables |
| `dates.js` | date values and date arithmetic |
| `tokenize.js` | text to token list |
| `evaluate.js` | `Parser` class, expression evaluation |
| `format.js` | number to display string |
| `document.js` | line classification, `processText`, highlight, alignment |
| `suggest.js` | autocomplete suggestions, no DOM |
| `app.js` | all DOM wiring, URL compression for sharing |

Imports go one way only: `vendor` -> `builtins` -> `units`/`dates` -> `tokenize` -> `evaluate` -> `format` -> `document` -> `app`. Do not add a cycle.

`app.js` is the only file that touches the DOM. `index.html` has no inline `onclick`; a module script cannot see those, so handlers use `addEventListener` and `data-example`.

Key concepts: variable assignments (`x = 5`), format/separator directives (`@format = fixed(2)`), SI prefixes, unit conversions, date arithmetic, percentages, totals.

## Test Structure

- **`tests/*.md`** — Integration tests. Each line with `# =>` has an expected result. The Python CLI processes these in-place; `git diff --exit-code` verifies nothing changed.
- **`tests/evaluate_vectors.json`** / **`tests/classify_vectors.json`** — Shared unit test vectors used by both Python and JS test runners.
- **`tests/test_*.py`** — Python unit tests (unittest framework). `test_cli.py` tests CLI flags via subprocess.
- **`web/test.mjs`** — JS test runner. It imports the engine modules directly and runs against the same vectors and `.md` files. `web/test-suggest.mjs` covers autocomplete.

New tests should use `.md` fixture files or add vectors to the JSON files — these are run against both implementations. Only use Python unittest classes for Python-specific CLI behavior.

## Cross-Language Consistency

Features must work identically in both Python and JS. When implementing a change, check both implementations and run `inv test` to verify both pass. The `.md` integration tests and JSON vectors are shared across both.

For non-trivial features, consider using separate agents for the Python and JS implementations, then run `inv test` to verify both pass.
