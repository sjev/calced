# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Calced is a notepad calculator that evaluates math expressions in plain text. It is a web app in `web/`: ES modules, big.js for precision, no build step.

## Commands

Automation uses [invoke](https://www.pyinvoke.org/). Run `inv -l` for the full list.

```bash
uv sync                     # Create .venv with invoke
inv test                    # All tests (node)
node web/test.mjs --update  # Rewrite tests/*.md and web/docs.md with current results
git diff -- tests web/docs.md  # review what --update changed

# Serve the web app. ES modules need HTTP; file:// does not work.
python3 -m http.server 8000 --directory web

inv bump patch              # patch, minor or major; commits the version
inv release                 # test, deploy to gh-pages, push
```

## Architecture

The pipeline: **tokenize → classify line → parse → evaluate → format result → align output**.

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
| `document.js` | line classification, `processText`, highlight, alignment, `formatForFile` |
| `suggest.js` | autocomplete suggestions, no DOM |
| `store.js` | named documents in localStorage, no DOM |
| `share.js` | document to `?data=` link and back |
| `app.js` | all DOM wiring |

Imports go one way only: `vendor` -> `builtins` -> `units`/`dates` -> `tokenize` -> `evaluate` -> `format` -> `document` -> `app`. `store.js` and `share.js` are leaves that only `app.js` imports. Do not add a cycle.

`app.js` is the only file that touches the DOM. `index.html` has no inline `onclick`; a module script cannot see those, so handlers use `addEventListener` and `data-example`.

Key concepts: variable assignments (`x = 5`), format/separator directives (`@format = fixed(2)`), SI prefixes, unit conversions, date and datetime arithmetic, percentages, totals.

**A line computes only when every token is consumed.** No word is dropped and no
operator is repaired, so one unknown word or stray character makes the line prose. There
is no prose fence: markdown that happens to parse (a `- 5 km in miles` bullet, a bare
`pi`) computes, and you write it another way. `#` starts a comment to the end of the
line.

A **block** is a run of consecutive non-blank lines. It bounds `sum()`, the decimal
alignment and the `│ ┘` indicators alike (`splitSections`). A `#` line is a comment, not
a section heading.

Zero-argument calls (`date()`, `now()`, `sum()`) resolve in the tokenizer, not the parser — the parser does not support zero-arg calls. This keeps the bare words usable as variable names.

## Test Structure

- **`tests/*.md`** and **`web/docs.md`** — Integration tests. Each line with `# =>` has an expected result. `web/test.mjs` checks every result.
- **`tests/evaluate_vectors.json`** / **`tests/classify_vectors.json`** — Unit test vectors for `evaluateLine` and `classifyLine`.
- **`web/test.mjs`** — runs the vectors and the `.md` files. `web/test-suggest.mjs` covers autocomplete, `web/test-store.mjs` the document store.

New tests go in a `.md` fixture or a JSON vector file.
