# calced

Write math anywhere in plain text. Results appear on the right.
Edit any line to see the result change. Changes here are not saved.

# Basics

2 + 3                                   # =>     5
10 * (4 + 6)                            # =>   100
2 ^ 10                                  # => 1_024
17 % 5                                  # =>     2
(100 + 50) * 2                          # =>   300

# Variables

Give a value a name, then use the name.

price = 100                             # => 100
qty = 3                                 # =>   3
total = price * qty                     # => 300

# Totals

A bare number counts towards the total. sum() adds the numbers above it.

bread 3.50                              # =>  3.5  │
milk 2 * 1.20                           # =>  2.4  │
eggs 4.95                               # =>  4.95 │
sum()                                   # => 10.85 ┘

A heading starts a new section, with its own sum.

# Second section

100                                     # => 100 │
200                                     # => 200 │
subtotal = sum()                        # => 300 ┘
subtotal * 2                            # => 600

# Percentages

income = 5000                           # => 5_000
tax_rate = 22%                          # =>     0.22
tax = income * tax_rate                 # => 1_100
after_tax = income - tax                # => 3_900
50% of 300                              # =>   150
200 + 15%                               # =>   230
200 - 10%                               # =>   180

# SI prefixes

1k + 500                                # =>      1_500
10 * 1.5M                               # => 15_000_000
2.5G / 1000                             # =>  2_500_000
5m + 3u                                 # =>          0.005003

# Unit conversions

5 km in miles                           # =>     3.106855961
100 C in F                              # =>   212
1 gib in mib                            # => 1_024
60 min in hr                            # =>     1
1 gal in l                              # =>     3.78541

# Rate conversions

Define your own rate, then convert with it.

@rate USD/EUR = 0.92
100 USD in EUR                          # =>     92
50 EUR in USD                           # =>     54.34782609

@rate BTC/USD = 97500
0.5 BTC in USD                          # => 48_750

# Functions

sqrt(16)                                # => 4
round(3.14159, 2)                       # => 3.14
min(5, 2, 8)                            # => 2
max(1, 9, 3)                            # => 9
abs(-7)                                 # => 7
log10(1000)                             # => 3

# Constants

pi                                      # =>  3.141592654
e                                       # =>  2.718281828
2 * pi * 3                              # => 18.84955592

# Dates

date() gives today. now() gives the current time. Fixed dates work too.

2025-01-15 + 3 days                     # => 2025-01-18
2025-01-31 + 1 month                    # => 2025-02-28
2025-03-01 - 2025-01-01                 # => 59
deadline = 2025-06-15 + 2 weeks         # => 2025-06-29
deadline - 2025-06-15                   # => 14

# Times

2025-01-15 18:00 - 2025-01-15 09:00     # => 9
2025-01-15 09:00 + 3 hours              # => 2025-01-15 12:00

# Number formats

0xff                                    # =>   255
0b1010                                  # =>    10
0o17                                    # =>    15
1.5e3                                   # => 1_500

# Trailing annotations

Text after the number is kept. A line with no math stays untouched.

rent 1500 (monthly)                     # => 1_500
budget 2000 EUR                         # => 2_000

# Format directives

1000000                                 # => 1_000_000

@format = fixed(2)
1000000                                 # => 1_000_000.00

@format = scientific
1000000                                 # => 1.00e+06

@format = eng
1000000                                 # => 1M

@format = minSig(3)
@separator = comma
1000000                                 # => 1,000,000

Suggestions appear as you type. Ctrl+Space shows the full list.

# Privacy

Your document stays in the browser. Calculation is local, and a shared link holds
the text in the URL itself.

The page counts anonymous pageviews with a self-hosted Umami instance.
It sets no cookies and keeps no personal data.
