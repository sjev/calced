# Section A
100                                     # => 100 │
200                                     # => 200 │
300                                     # => 300 │
sum()                                   # => 600 ┘

# Section B
10                                      # => 10 │
20                                      # => 20 │
sum()                                   # => 30 ┘

# Two totals in one section
100                                     # => 100 │
200                                     # => 200 │
sum()                                   # => 300 ┘
400                                     # => 400 │
sum()                                   # => 400 ┘

# Total in expressions
100                                     # =>   100 │
200                                     # =>   200 │
300                                     # =>   300 │
sum() * 2                               # => 1_200 ┘

# Assign total to variable
10                                      # => 10 │
20                                      # => 20 │
gesamt = sum()                          # => 30 ┘
gesamt / 2                              # => 15

# Assign total to variable and use in next section
100                                     # => 100 │
200                                     # => 200 │
first_half = sum()                      # => 300 ┘

# Next section uses the variable
first_half * 2                          # => 600

# Arithmetic with total
10                                      # =>  10 │
20                                      # =>  20 │
30                                      # =>  30 │
sum() + first_half                      # => 360 ┘

# Total minus variable
100                                     # =>  100 │
200                                     # =>  200 │
gesamt = sum()                          # =>  300 ┘
50                                      # =>   50 │
sum() - gesamt                          # => -250 ┘

# Assign total then use in later total expression
10                                      # => 10 │
20                                      # => 20 │
30                                      # => 30 │
subtotal = sum()                        # => 60 ┘
40                                      # => 40 │
50                                      # => 50 │
sum() - subtotal                        # => 30 ┘

# total and sum are ordinary variable names
price = 100                             # => 100
qty = 3                                 # =>   3
total = price * qty                     # => 300
total * 2                               # => 600
sum = total / 2                         # => 150
sum + 1                                 # => 151
