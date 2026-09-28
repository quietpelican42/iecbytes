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

/**
 * A bit-denominated size (`b`, `kb`, `Mib`, ...) did not land on a whole
 * number of bytes, so it cannot be returned as an exact byte bigint.
 */
export class FractionalByteError extends ByteSizeError {
  bits: bigint;
  constructor(input: string, bits: bigint) {
    super(
      `${JSON.stringify(input)} is ${bits} bit(s), not a whole number of bytes; ` +
        `use parseBits() to get the exact bit count`,
    );
    this.name = 'FractionalByteError';
    this.bits = bits;
  }
}

/** The decimal literal itself, combined with the unit, is not a whole number of bits. */
export class FractionalBitError extends ByteSizeError {
  constructor(input: string, numerator: bigint, denominator: bigint) {
    super(`${JSON.stringify(input)} is ${numerator}/${denominator} bit(s), not a whole number of bits`);
    this.name = 'FractionalBitError';
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
