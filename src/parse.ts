import {
  AmbiguousUnitError,
  FractionalBitError,
  FractionalByteError,
  MalformedInputError,
  UnknownUnitError,
  UnsafeIntegerError,
} from './errors.ts';
import {
  IEC_BASE,
  JEDEC_UNITS,
  PREFIX_BY_LETTER,
  SI_BASE,
  STRICT_UNITS,
  type UnitInfo,
} from './units.ts';

export type ParseMode = 'strict' | 'jedec' | 'auto';

export interface ParseOptions {
  /**
   * `strict` (default): `kB`/`MB`/... are SI (1000^n), `KiB`/`MiB`/... are
   * IEC (1024^n), unit spelling is case-exact, and `Mb`/`MB` (bit vs byte)
   * are distinguished. Anything else (`KB`, `Kb`, ...) is rejected as
   * ambiguous rather than guessed at.
   *
   * `jedec`: `KB`/`MB`/`GB`/... are 1024^n, case-insensitively, matching the
   * `bytes` npm package and Windows/macOS file managers. No bit units.
   *
   * `auto`: case-insensitive, lenient, legacy behavior — an `i` anywhere
   * after the prefix letter means IEC (1024^n), otherwise SI (1000^n); the
   * trailing `B`/`b` is optional and, when present, not distinguished (all
   * sizes are bytes). This is an explicit opt-in: it is never the default,
   * because it is exactly the "guess what the user meant" behavior this
   * package exists to avoid.
   */
  mode?: ParseMode;
  /**
   * `exact` (default): throw `FractionalBitError`/`FractionalByteError` if
   * the input is not an exact whole number of bytes (e.g. bit units that
   * don't add up to a byte, or a decimal fraction of a non-power-of-10 unit
   * that doesn't land on an integer — `"5.9 KiB"` is genuinely 6041.6 bytes).
   *
   * `nearest`: round half-up (ties away from zero) to the nearest whole byte
   * instead. Use this when recovering a value from text `format()` itself
   * produced, since decimal rounding of a base-1024 (or
   * base-1000-but-fractional) value is not guaranteed to land back on an
   * integer.
   *
   * `floor`: round toward negative infinity, matching exactly what
   * `bytes@3.1.2`'s `Math.floor(unitSize * parseFloat(str))` does. Use this
   * for byte-for-byte parity with `bytes` in `{ mode: 'jedec' }` (see
   * README "Interop").
   */
  rounding?: 'exact' | 'nearest' | 'floor';
}

/** Half-up rounding (ties away from zero) of an exact `numerator / denominator`, sign-preserving. */
function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = abs / denominator;
  const remainder = abs % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Floor (round toward -Infinity) of an exact `numerator / denominator`; `denominator` must be > 0. */
function roundFloor(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder !== 0n && numerator < 0n ? quotient - 1n : quotient;
}

/** Round a `numerator/denominator` fraction per `rounding`, or invoke `onExact`/throw via `onInexact`. */
function resolveFraction(
  numerator: bigint,
  denominator: bigint,
  rounding: 'exact' | 'nearest' | 'floor',
  onInexact: () => never,
): bigint {
  if (numerator % denominator === 0n) return numerator / denominator;
  if (rounding === 'nearest') return roundHalfUp(numerator, denominator);
  if (rounding === 'floor') return roundFloor(numerator, denominator);
  onInexact();
}

const NUMBER_AND_UNIT = /^\s*([+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z]*)\s*$/;

interface Fraction {
  numerator: bigint;
  denominator: bigint;
}

/** Parse a decimal literal (optional sign, fraction, exponent) into an exact bigint fraction. */
function literalToFraction(text: string): Fraction {
  const negative = text.startsWith('-');
  const unsigned = negative || text.startsWith('+') ? text.slice(1) : text;
  const [mantissa, expPart] = unsigned.split(/[eE]/);
  const [intPart = '', fracPart = ''] = mantissa!.split('.');
  const digits = `${intPart}${fracPart}` || '0';
  let numerator = BigInt(digits);
  let denominator = 10n ** BigInt(fracPart.length);
  if (expPart !== undefined) {
    const exp = BigInt(expPart);
    if (exp >= 0n) numerator *= 10n ** exp;
    else denominator *= 10n ** -exp;
  }
  if (negative) numerator = -numerator;
  return { numerator, denominator };
}

const AMBIGUITY_HINT: ReadonlyMap<string, string[]> = (() => {
  const hint = new Map<string, string[]>();
  for (const key of STRICT_UNITS.keys()) {
    const lower = key.toLowerCase();
    const list = hint.get(lower) ?? [];
    list.push(key);
    hint.set(lower, list);
  }
  return hint;
})();

function resolveStrictUnit(input: string, unitText: string): UnitInfo {
  const exact = STRICT_UNITS.get(unitText);
  if (exact) return exact;

  const lower = unitText.toLowerCase();
  const caseVariants = AMBIGUITY_HINT.get(lower) ?? [];
  const jedecMatch = JEDEC_UNITS.has(unitText.toUpperCase());
  if (caseVariants.length > 0 || jedecMatch) {
    const parts = caseVariants.map((o) => JSON.stringify(o));
    let suggestion = `did you mean ${parts.join(' or ')}?`;
    if (jedecMatch) {
      suggestion += ` Or pass { mode: 'jedec' } for the 1024-based, case-insensitive reading (matches the \`bytes\` package and Windows).`;
    }
    throw new AmbiguousUnitError(input, unitText, suggestion);
  }
  throw new UnknownUnitError(input, unitText, 'strict');
}

function resolveJedecUnit(input: string, unitText: string): UnitInfo {
  const unit = JEDEC_UNITS.get(unitText.toUpperCase());
  if (!unit) throw new UnknownUnitError(input, unitText, 'jedec');
  return unit;
}

const AUTO_UNIT = /^([kmgtpezyrqKMGTPEZYRQ]?)([iI]?)([bB]?)$/;

function resolveAutoUnit(input: string, unitText: string): UnitInfo {
  const m = AUTO_UNIT.exec(unitText);
  if (!m) throw new UnknownUnitError(input, unitText, 'auto');
  const [, letter, iMarker] = m;
  if (!letter) return { base: SI_BASE, exponent: 0, bits: false };
  const exponent = PREFIX_BY_LETTER.get(letter.toUpperCase());
  if (exponent === undefined) throw new UnknownUnitError(input, unitText, 'auto');
  return { base: iMarker ? IEC_BASE : SI_BASE, exponent, bits: false };
}

interface Resolved {
  /** The decimal literal times the unit's `base^exponent`, as an exact fraction. */
  numerator: bigint;
  denominator: bigint;
  unit: UnitInfo;
}

/**
 * Parse the number and unit, and compute the exact value in the *unit's own
 * currency*: bits if the unit is bit-denominated (`b`, `kb`, `Mib`, ...),
 * bytes if it is byte-denominated (`B`, `kB`, `KiB`, ...). Keeping the two
 * currencies apart (rather than always converting to bits) is what lets the
 * error thrown for an inexact result name the right unit family: a
 * fractional `EB` value is a `FractionalByteError`, not a bit-currency error
 * that happens to be about bytes.
 */
function resolve(input: string, options: ParseOptions): Resolved {
  const mode = options.mode ?? 'strict';
  const m = NUMBER_AND_UNIT.exec(input);
  if (!m) {
    throw new MalformedInputError(input, 'expected a number optionally followed by a unit, e.g. "10 KiB"');
  }
  const [, numberText, unitText] = m;

  let unit: UnitInfo;
  if (unitText === '') {
    unit = { base: SI_BASE, exponent: 0, bits: false };
  } else if (mode === 'strict') {
    unit = resolveStrictUnit(input, unitText!);
  } else if (mode === 'jedec') {
    unit = resolveJedecUnit(input, unitText!);
  } else {
    unit = resolveAutoUnit(input, unitText!);
  }

  const { numerator: litNumerator, denominator } = literalToFraction(numberText!);
  const numerator = litNumerator * unit.base ** BigInt(unit.exponent);
  return { numerator, denominator, unit };
}

/** Parse a human byte/bit size to an exact bigint number of bits. */
export function parseBits(input: string, options: ParseOptions = {}): bigint {
  const { numerator, denominator, unit } = resolve(input, options);
  const rounding = options.rounding ?? 'exact';

  if (unit.bits) {
    return resolveFraction(numerator, denominator, rounding, () => {
      throw new FractionalBitError(input, numerator, denominator);
    });
  }
  const bytes = resolveFraction(numerator, denominator, rounding, () => {
    throw new FractionalByteError(input, numerator, denominator);
  });
  return bytes * 8n;
}

/** Parse a human byte size to an exact bigint number of bytes. */
export function parse(input: string, options: ParseOptions = {}): bigint {
  const { numerator, denominator, unit } = resolve(input, options);
  const rounding = options.rounding ?? 'exact';

  if (!unit.bits) {
    return resolveFraction(numerator, denominator, rounding, () => {
      throw new FractionalByteError(input, numerator, denominator);
    });
  }
  const bits = resolveFraction(numerator, denominator, rounding, () => {
    throw new FractionalBitError(input, numerator, denominator);
  });
  return resolveFraction(bits, 8n, rounding, () => {
    throw new FractionalByteError(input, bits, 8n);
  });
}

export interface AsNumberOptions {
  /** Truncate to a `Number` even past `Number.MAX_SAFE_INTEGER` instead of throwing. Default false. */
  allowUnsafe?: boolean;
}

/** Convert an exact byte bigint to a `Number`, refusing to silently lose precision. */
export function asNumber(bytes: bigint, options: AsNumberOptions = {}): number {
  const abs = bytes < 0n ? -bytes : bytes;
  if (!options.allowUnsafe && abs > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new UnsafeIntegerError(bytes);
  }
  return Number(bytes);
}
