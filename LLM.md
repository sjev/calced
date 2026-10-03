# Writing calced calculations

Output a plain-text calced document: one expression per line. A line computes only if
every token parses. Otherwise it shows no result and counts as prose. Do not write results.
The tool shows them.

## Syntax

| Feature | Example |
| --- | --- |
| Operators | `+ - * / // % ** ^ ( )` |
| Variable | `loan = 250k`, then `loan * rate / 12`. Names: letters, digits, `_` |
| Comment | `1200 * 12  # rent per year`. A `#` line is a heading or note |
| Total | `subtotal = sum()` adds the lines above it, up to a blank line or an earlier total |
| Percent | `rate = 3.5%` (0.035), `50% of 300`, `200 + 15%`, `10 as % of 50` |
| SI prefix | `1.5k`, `2M`, `3G`, `5m`, `3u` |
| Numbers | `1_000_000`, `1.5e3`, `0xff`. No `,` in numbers |
| Functions | `sqrt abs floor ceil round(x, n) min max log log2 log10 exp sin cos tan asin acos atan` |
| Constants | `pi`, `e`, `tau` |
| Units | `5 km in miles`, `d km in miles`, `100 C in F`. Length, mass, temperature, data, time, volume |
| Custom rate | `@rate USD/EUR = 0.92`, then `100 USD in EUR` |
| Dates | `2025-01-31 + 1 month`, `2025-03-01 - 2025-01-01` (days), `deadline = 2025-06-15 + n weeks` |
| Times | `2025-01-15 09:00 + 3 hours`, difference in hours |
| Today | `date()`, `now()`, `days until 2026-12-31`, `weeks since 2026-01-01` |
| Format | `@format = fixed(2)`, `minSig(3)`, `scientific`, `eng`. `@separator = comma` |

## Rules

- A variable holds a plain number, not a unit. `d = 5 km` fails. Use `d = 5` and `d km in miles`.
- Put each input in its own named variable at the top. Derive all later values from names.
- Put labels in `# comments`, never as bare words on a math line. `Rent: 1200` fails.
- Do not use the words `sum`, `date`, `now`, `pi`, `e`, `tau` or function names as variables.
- Group related lines in blocks. Separate blocks with a blank line so `sum()` stays local.
- `x ^ n` fails if the exact result exceeds 1000 digits (`1.0035 ^ 360`). Use `exp(n * log(x))`.
- No conditionals, loops, arrays or user functions. Unroll steps line by line.

## Example

```
# Inputs
price = 350k
down = 20%
rate = 4.2%
years = 30

# Mortgage
loan = price * (1 - down)
r = rate / 12
n = years * 12
f = exp(n * log(1 + r))
payment = loan * r * f / (f - 1)   # monthly
interest = payment * n - loan
```
