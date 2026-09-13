<p align="center">
  <img src="logo.svg" alt="calced logo" width="128">
</p>

# calced

A notepad calculator in the browser. Write math in plain text; results appear on the right.

[Open the web app](https://sjev.github.io/calced)

> A fork of [calced](https://github.com/karlb/calced) by Karl Bartel. See [Credits](#credits).

## Why calced?

Spreadsheets are overkill for quick calculations. REPLs lose context once you close them. calced keeps your math in plain text, with each result next to its expression.

- **Tiny, no dependencies** — ~86KB of plain ES modules. No build step, no node_modules.
- **Works offline** — all calculation is local.
- **Explicit** — a line computes only when the whole line parses, so prose is never mistaken for math.

## How it works

Every line is a calculation. A line calced cannot read in full shows no result, so prose mixed in with the math costs you nothing.

```
# Lease
lease_pm     = 695.02                   # => 695.02
gebruik_mnd  = 60                       # =>  60

termijnen    = lease_pm * gebruik_mnd   # => 41_701.2 │
opzegboete   = 0                        # =>      0   │
lease_totaal = sum()                    # => 41_701.2 ┘
```

- `#` starts a comment, to the end of the line.
- `sum()` adds the lines above it, back to the previous blank line or total.

The full syntax is in [`web/docs.md`](web/docs.md). The **Docs** button in the app shows the same document. Every example in it is a test.

The app suggests names as you type: variables (with their value), functions, constants, units, keywords and directives. `Ctrl+Space` shows every name that fits the position. Arrow keys choose, `Enter` or `Tab` accepts, `Esc` dismisses.

## Privacy

Your document stays in the browser. Calculation is local, and a shared link holds the text in the URL itself.

The page counts anonymous pageviews with a self-hosted Umami instance. It sets no cookies and keeps no personal data. To host it yourself, remove the counter script from `web/index.html`.

## Development

Tasks run with [invoke](https://www.pyinvoke.org/). Run `inv -l` for the full list.

```sh
uv sync                                        # create .venv with invoke
inv test                                       # all tests (needs node)
node web/test.mjs --update                     # rewrite tests/*.md results
python3 -m http.server 8000 --directory web    # serve the app locally
inv bump patch && inv release                  # publish to GitHub Pages
```

## Credits

calced is a fork of [karlb/calced](https://github.com/karlb/calced) by Karl Bartel.
He wrote the original CLI, the web app and the test suite.
This fork keeps his MIT license and his copyright.
