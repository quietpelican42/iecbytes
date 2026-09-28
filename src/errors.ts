/** Base class for every error this package throws. */
export class ByteSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ByteSizeError';
  }
}

/** The input does not look like a byte size at all (empty, no number, garbage). */
export class MalformedInputError extends ByteSizeError {
  input: string;
  constructor(input: string, reason: string) {
    super(`Malformed byte size ${JSON.stringify(input)}: ${reason}`);
    this.name = 'MalformedInputError';
    this.input = input;
  }
}

/**
 * The unit is a real word but its meaning depends on convention the caller
 * did not pin down (e.g. `KB` is 1000 in SI, 1024 under JEDEC/Windows, and
 * not a unit at all in strict IEC, which spells it `KiB`).
 */
export class AmbiguousUnitError extends ByteSizeError {
  input: string;
  unit: string;
  constructor(input: string, unit: string, suggestion: string) {
    super(
      `Ambiguous unit ${JSON.stringify(unit)} in ${JSON.stringify(input)}: ${suggestion}`,
    );
    this.name = 'AmbiguousUnitError';
    this.input = input;
    this.unit = unit;
  }
}

/** The unit text is not one this package recognizes in the requested mode. */
export class UnknownUnitError extends ByteSizeError {
  input: string;
  unit: string;
  constructor(input: string, unit: string, mode: string) {
    super(`Unknown unit ${JSON.stringify(unit)} in ${JSON.stringify(input)} for mode ${JSON.stringify(mode)}`);
    this.name = 'UnknownUnitError';
    this.input = input;
    this.unit = unit;
  }
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Reduce numerator/denominator to lowest terms for a readable error message (denominator > 0). */
function reducedFraction(numerator: bigint, denominator: bigint): string {
  if (numerator === 0n) return '0';
  const g = gcd(numerator, denominator);
  const n = numerator / g;
  const d = denominator / g;
  return d === 1n ? `${n}` : `${n}/${d}`;
}

/**
 * The exact value is not a whole number of *bytes*. Two distinct situations
 * produce this: a byte-denominated unit whose decimal literal doesn't divide
 * evenly (`"1.1EB"` is exactly `1100000000000000000` — fine — but e.g.
 * `"1.1KiB"` is not an integer), or a bit-denominated size that is a whole
 * number of bits but not a multiple of 8 (`"1b"` is 1 bit, not 1/8 of a byte).
 * `numerator`/`denominator` is the exact byte count as a fraction.
 */
export class FractionalByteError extends ByteSizeError {
  numerator: bigint;
  denominator: bigint;
  constructor(input: string, numerator: bigint, denominator: bigint) {
    super(
      `${JSON.stringify(input)} is ${reducedFraction(numerator, denominator)} byte(s), not a whole number of bytes; ` +
        `use parseBits() for the exact bit count, or { rounding: 'nearest' | 'floor' } to round`,
    );
    this.name = 'FractionalByteError';
    this.numerator = numerator;
    this.denominator = denominator;
  }
}

/** The decimal literal itself, combined with a *bit*-denominated unit, is not a whole number of bits. */
export class FractionalBitError extends ByteSizeError {
  numerator: bigint;
  denominator: bigint;
  constructor(input: string, numerator: bigint, denominator: bigint) {
    super(
      `${JSON.stringify(input)} is ${reducedFraction(numerator, denominator)} bit(s), not a whole number of bits; ` +
        `{ rounding: 'nearest' | 'floor' } will round`,
    );
    this.name = 'FractionalBitError';
    this.numerator = numerator;
    this.denominator = denominator;
  }
}

/** A parsed or computed value does not fit in a JS `number` without losing precision. */
export class UnsafeIntegerError extends ByteSizeError {
  value: bigint;
  constructor(value: bigint) {
    super(
      `${value} exceeds Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER}); ` +
        `pass { allowUnsafe: true } to truncate to a Number anyway, or keep using the bigint`,
    );
    this.name = 'UnsafeIntegerError';
    this.value = value;
  }
}
