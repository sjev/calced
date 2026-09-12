<p align="center">
  <img src="logo.svg" alt="calced logo" width="128">
</p>

# calced

A notepad calculator that evaluates math expressions in plain text files. Available as a **CLI tool** and a **web app**.

> A fork of [calced](https://github.com/karlb/calced) by Karl Bartel. See [Credits](#credits).

## Why calced?

Spreadsheets are overkill for quick calculations. REPLs lose context once you close them. calced keeps your math in plain text files where results stay next to the expressions, files can be versioned and diffed, and you use whatever editor you want.

Compared to other notepad calculators:

- **Tiny, no dependencies** — the CLI is a single 54KB Python file (stdlib only), the web app is ~86KB of plain ES modules. No build step, no node_modules, no Electron.
- **Works offline** — all calculation is local. 
- **Explicit** — a line computes only when the whole line parses, so prose is never mistaken for math.
- **Both CLI and web** — same syntax, same test suite, but well adapted to each environment.

## Privacy

Your document stays in the browser. Calculation is local, and a shared link holds the text in the URL itself.

The web app page counts anonymous pageviews with a self-hosted Umami instance. It sets no cookies and keeps no personal data.

If you like to host yourself, just remove page counter script from `index.html`


## Web

[Open the web app](https://sjev.github.io/calced) in a browser.

The web app suggests names as you type: your own variables (with their current
value), functions, constants, units, keywords and directives. Press `Ctrl+Space`
to see every name that fits the position, for example each unit you can convert
to after `5 km in `. Use the arrow keys to choose, `Enter` or `Tab` to accept,
and `Esc` to dismiss.

## CLI

```
calced <file>           # evaluate and update file in place
calced -s <file>        # print result to stdout (don't modify file)
calced -w <file>        # watch for changes and auto-update
calced -w -s <file>     # watch and print (clears screen on change)
calced -u <file>        # print shareable web URL
calced -n <file>        # show a diff of what would change
calced --json <file>    # print results as JSON
```

### Installation

Requires Python 3.9+. Any typical Python install method works (`pip install calced`, etc.).

```sh
# Install as a CLI tool
uv tool install git+https://github.com/sjev/calced.git

# Or just grab the single-file script and run it directly
python calced.py <file>
```

## How it works

Every line of the file is a calculation. Results are appended inline as `# => result`
comments.

A line computes only when calced can read **all** of it. One word it does not know, one
stray character, and the line shows no result and stays untouched. So prose mixed in
with the math costs you nothing, and calced never guesses at a number inside a sentence.

Two Python spellings do the rest:

```
"""
# Lease
Contractdata van Arval. Nothing in this block is read.
"""

lease_pm     = 695.02                   # => 695.02
gebruik_mnd  = 60                       # =>  60

termijnen    = lease_pm * gebruik_mnd   # => 41_701.2 │
opzegboete   = 0                        # =>      0   │
lease_totaal = sum()                    # => 41_701.2 ┘
```

- `#` starts a comment, to the end of the line.
- `"""` opens and closes a block of prose. Markdown inside it, headings included, is
  never read.
- `sum()` adds the lines above it, back to the previous blank line, prose block or
  total.

Results are aligned and updated in place each time you run the CLI (or automatically in
watch mode), or live as you type in the web app.

## Reference

The block below is `web/docs.md`. The **Docs** button in the web app shows the same
document. It is the single source for every example: the CLI runs it as an integration
test, so each result there is verified.

<!-- [[[cog
import os, subprocess

env = {**os.environ, "NO_COLOR": "1"}
out = subprocess.run(
    ["python", "python/calced.py", "-s", "web/docs.md"],
    capture_output=True, text=True, env=env,
).stdout
cog.out("```\n" + out + "```\n")
]]] -->
```
"""
# calced

Write math in plain text. Results appear on the right.
Edit any line to see the result change. Changes here are not saved.

Every line is a calculation. A line calced cannot read in full shows no
result, so prose costs you nothing.
"""

2 + 3                                   # =>     5
10 * (4 + 6)                            # =>   100
2 ** 10                                 # => 1_024
2 ^ 10                                  # => 1_024
7 // 2                                  # =>     3
17 % 5                                  # =>     2
(100 + 50) * 2                          # =>   300

"""
# Comments

A `#` starts a comment, as in Python. Use one to label a line.
"""

3.50                                    # bread                  # =>   3.5
1600 / 12                               # verzekering per maand  # => 133.3333333

"""
# Prose blocks

Three quotes open and close a block of prose, like a Python docstring.
Markdown inside it, headings included, is never read. This page uses them
throughout: every heading you see sits in one.
"""

"""
# Variables

Give a value a name, then use the name.
"""

price = 100                             # => 100
qty = 3                                 # =>   3
total = price * qty                     # => 300

"""
# Totals

sum() adds the lines above it. A blank line, a prose block or an earlier
total bounds what it reaches.
"""

3.50                                    # bread  # =>  3.5  │
2 * 1.20                                # milk   # =>  2.4  │
4.95                                    # eggs   # =>  4.95 │
sum()                                            # => 10.85 ┘

100                                     # => 100 │
200                                     # => 200 │
subtotal = sum()                        # => 300 ┘
subtotal * 2                            # => 600

"""
# Percentages

`of` takes a part of a number. `as` gives a number as a part of another.
"""

income = 5000                           # => 5_000
tax_rate = 22%                          # =>     0.22
tax = income * tax_rate                 # => 1_100
after_tax = income - tax                # => 3_900
50% of 300                              # =>   150
200 + 15%                               # =>   230
200 - 10%                               # =>   180
10 as % of 50                           # =>    20

"""
# SI prefixes
"""

1k + 500                                # =>      1_500
10 * 1.5M                               # => 15_000_000
2.5G / 1000                             # =>  2_500_000
5m + 3u                                 # =>          0.005003

"""
# Unit conversions

`to` and `in` mean the same thing.
"""

5 km in miles                           # =>     3.106855961
5 km to miles                           # =>     3.106855961
100 C in F                              # =>   212
1 gib in mib                            # => 1_024
60 min in hr                            # =>     1
1 gal in l                              # =>     3.78541

"""
# Rate conversions

Define your own rate, then convert with it.
"""

@rate USD/EUR = 0.92
100 USD in EUR                          # => 92
50 EUR in USD                           # => 54.34782609

@rate BTC/USD = 97500
0.5 BTC in USD                          # => 48_750

"""
# Functions
"""

sqrt(16)                                # => 4
round(3.14159, 2)                       # => 3.14
min(5, 2, 8)                            # => 2
max(1, 9, 3)                            # => 9
abs(-7)                                 # => 7
log10(1000)                             # => 3

"""
# Constants
"""

pi                                      # =>  3.141592654
e                                       # =>  2.718281828
2 * pi * 3                              # => 18.84955592

"""
# Dates

date() gives today. now() gives the current time. Fixed dates work too.

`days until 2026-12-31` and `weeks since 2026-01-01` count from today.
"""

2025-01-15 + 3 days                     # => 2025-01-18
2025-01-31 + 1 month                    # => 2025-02-28
2025-03-01 - 2025-01-01                 # => 59
deadline = 2025-06-15 + 2 weeks         # => 2025-06-29
deadline - 2025-06-15                   # => 14

"""
# Times
"""

2025-01-15 18:00 - 2025-01-15 09:00     # => 9
2025-01-15 09:00 + 3 hours              # => 2025-01-15 12:00

"""
# Number formats

Group digits with `_`. A comma is not a separator and not a decimal point.
"""

0xff                                    # =>       255
0b1010                                  # =>        10
0o17                                    # =>        15
1.5e3                                   # =>     1_500
1_000_000                               # => 1_000_000

"""
# Format directives

Modes: `minSig`, `fixed`, `scientific`, `eng` and `auto`. Each takes a digit
count. Separators: `underscore`, `comma`, `space` and `off`.
"""

@format = fixed(2)
1000000                                 # => 1_000_000.00

@format = scientific
1000000                                 # => 1.00e+06

@format = eng
1000000                                 # => 1M

@format = minSig(3)
@separator = comma
1000000                                 # => 1,000,000

"""
Suggestions appear as you type. Ctrl+Space shows the full list.

# Privacy

Your document stays in the browser. Calculation is local, and a shared link
holds the text in the URL itself.

The page counts anonymous pageviews with a self-hosted Umami instance.
It sets no cookies and keeps no personal data.
"""
```
<!-- [[[end]]] -->

## Development

Tasks run with [invoke](https://www.pyinvoke.org/). Run `inv -l` for the full list.

```sh
uv sync            # create .venv with the dev dependencies
inv ci             # lint + all tests (Python and JS)
inv format         # format the code
inv readme         # regenerate this file from its inline examples
uv tool install .  # install the CLI from this checkout
```

## Credits

calced is a fork of [karlb/calced](https://github.com/karlb/calced) by Karl Bartel.
He wrote the original CLI, the web app and the test suite.
This fork keeps his MIT license and his copyright.
