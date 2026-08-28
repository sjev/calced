# Rounding and magnitude

Both engines format from the exact decimal value, never via float, and round
half-even everywhere.

## Half-even ties

@format = fixed(0)
2.5                                     # =>  2
3.5                                     # =>  4
0.5                                     # =>  0
1.5                                     # =>  2
-2.5                                    # => -2
-3.5                                    # => -4

@format = fixed(2)
0.125                                   # =>  0.12
0.375                                   # =>  0.38
2.675                                   # =>  2.68
1.115                                   # =>  1.12

## Past 1e21: expand the digits, never fall back to exponential

@format = fixed(2)
1e21                                    # =>                         1_000_000_000_000_000_000_000.00
1e21 + 1                                # =>                         1_000_000_000_000_000_000_001.00
7.022936063287656e39                    # => 7_022_936_063_287_656_000_000_000_000_000_000_000_000.00

@format = minSig(10)
1e21                                    # =>                         1_000_000_000_000_000_000_000
2 ^ 100                                 # =>             1_267_650_600_228_229_401_496_703_205_000

## auto is %g: strip trailing zeros, exponential at exp < -4 or exp >= precision

@format = auto(8)
100                                     # =>  100
1000                                    # => 1000
1234.5678                               # => 1234.5678
0.000012345678                          # => 1.2345678e-05
0.0001                                  # =>    0.0001
73955852409047630000                    # => 7.3955852e+19

## Zero carries no exponent

@format = scientific(6)
0                                       # => 0.00000e+00
0 * 5                                   # => 0.00000e+00

@format = eng(3)
0                                       # => 0

@format = minSig(10)
0                                       # => 0
