// SI prefixes and the unit conversion tables.
import { Big } from "./builtins.js";

// --- SI Prefixes ---
const SI_PREFIX = {
  "Q":1e30,"R":1e27,"Y":1e24,"Z":1e21,"E":1e18,"P":1e15,"T":1e12,
  "G":1e9,"M":1e6,"K":1e3,"k":1e3,"m":1e-3,"u":1e-6,"\u03bc":1e-6,
  "n":1e-9,"p":1e-12,"f":1e-15,"a":1e-18,"z":1e-21,"y":1e-24
};
// exponent -> prefix for engineering output ("K" and "\u03bc" are input-only aliases)
const ENG_SUFFIX = {};
for (const [k, v] of Object.entries(SI_PREFIX)) {
  if (k !== "K" && k !== "\u03bc") ENG_SUFFIX[Math.round(Math.log10(v))] = k;
}
const SI_SUFFIX_CHARS = Object.keys(SI_PREFIX).join("").replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

// --- Unit conversion tables ---
const UNIT_TABLE = {
  length: {
    mm:0.001,millimeter:0.001,millimeters:0.001,
    cm:0.01,centimeter:0.01,centimeters:0.01,
    m:1,meter:1,meters:1,
    km:1000,kilometer:1000,kilometers:1000,
    "in":0.0254,inch:0.0254,inches:0.0254,
    ft:0.3048,foot:0.3048,feet:0.3048,
    yd:0.9144,yard:0.9144,yards:0.9144,
    mi:1609.344,mile:1609.344,miles:1609.344,
  },
  mass: {
    mg:0.001,milligram:0.001,milligrams:0.001,
    g:1,gram:1,grams:1,
    kg:1000,kilogram:1000,kilograms:1000,
    oz:28.3495,ounce:28.3495,ounces:28.3495,
    lb:453.592,lbs:453.592,pound:453.592,pounds:453.592,
  },
  temperature: {
    c:"c",celsius:"c",
    f:"f",fahrenheit:"f",
    k:"k",kelvin:"k",
  },
  data: {
    b:1,byte:1,bytes:1,
    kb:1000,kilobyte:1000,kilobytes:1000,
    mb:1e6,megabyte:1e6,megabytes:1e6,
    gb:1e9,gigabyte:1e9,gigabytes:1e9,
    tb:1e12,terabyte:1e12,terabytes:1e12,
    kib:1024,kibibyte:1024,kibibytes:1024,
    mib:1048576,mebibyte:1048576,mebibytes:1048576,
    gib:1073741824,gibibyte:1073741824,gibibytes:1073741824,
    tib:1099511627776,tebibyte:1099511627776,tebibytes:1099511627776,
  },
  time: {
    ms:0.001,millisecond:0.001,milliseconds:0.001,
    s:1,sec:1,second:1,seconds:1,
    min:60,minute:60,minutes:60,
    hr:3600,hour:3600,hours:3600,
    day:86400,days:86400,
    week:604800,weeks:604800,
  },
  volume: {
    ml:1,milliliter:1,milliliters:1,
    l:1000,liter:1000,liters:1000,
    tsp:4.929,teaspoon:4.929,teaspoons:4.929,
    tbsp:14.787,tablespoon:14.787,tablespoons:14.787,
    floz:29.574,cup:236.588,cups:236.588,
    pt:473.176,pint:473.176,pints:473.176,
    qt:946.353,quart:946.353,quarts:946.353,
    gal:3785.41,gallon:3785.41,gallons:3785.41,
  },
};

const UNIT_LOOKUP = Object.create(null);
for (const [dim, units] of Object.entries(UNIT_TABLE)) {
  for (const [name, factor] of Object.entries(units)) {
    UNIT_LOOKUP[name] = [dim, factor];
  }
}

function convertTemperature(value, fromKey, toKey) {
  const _273_15 = new Big("273.15");
  let k;
  if (fromKey === "c") k = value.plus(_273_15);
  else if (fromKey === "f") k = value.minus(32).times(5).div(9).plus(_273_15);
  else k = value;
  if (toKey === "c") return k.minus(_273_15);
  if (toKey === "f") return k.minus(_273_15).times(9).div(5).plus(32);
  return k;
}

export {
  SI_PREFIX, ENG_SUFFIX, SI_SUFFIX_CHARS,
  UNIT_TABLE, UNIT_LOOKUP, convertTemperature,
};
