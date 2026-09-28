import { ByteSizeError } from './errors.ts';
import { MAX_EXPONENT, baseFor, byteUnitSymbol, type Standard } from './units.ts';

export interface FormatOptions {
  /** Which unit family to render in. Default `'si'`. */
  standard?: Standard;
  /** Decimal digits to keep. Default 2. */
  precision?: number;
  /**
   * Keep trailing zeros out to `precision` digits (`"1.00 MB"`) instead of
   * trimming them (`"1 MB"`). Default false.
   */
  fixed?: boolean;
  /** BCP 47 locale for the decimal separator and digit grouping, e.g. `'de-DE'`. */
  locale?: string;
  /** Render as bits (`Mb`, `Mib`) instead of bytes: the value is multiplied by 8 first. Default false. */
  bits?: boolean;
}

/** Half-up rounding of a non-negative `numerator / denominator`. */
function roundDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function formatMantissa(scaled: bigint, precision: number, fixed: boolean): string {
  if (precision <= 0) return scaled.toString();
  const digits = scaled.toString().padStart(precision + 1, '0');
  const intPart = digits.slice(0, digits.length - precision);
  let fracPart = digits.slice(digits.length - precision);
  if (!fixed) fracPart = fracPart.replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

function localize(mantissa: string, locale: string): string {
  const decimals = (mantissa.split('.')[1] ?? '').length;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(mantissa));
}

/**
 * Render an exact byte count as a human string. Never prints a mantissa that
 * rounds up to the base of the next unit (e.g. `"1000.00 kB"`): it re-picks
 * the unit whenever rounding would carry, so that case prints `"1 MB"`.
 *
 * Rounding is half-up (ties round away from zero), applied at the requested
 * `precision`, computed in exact bigint arithmetic — never through a `number`
 * intermediate, so it does not inherit float error at large sizes.
 */
export function format(n: bigint | number, options: FormatOptions = {}): string {
  const standard = options.standard ?? 'si';
  const precision = options.precision ?? 2;
  const fixed = options.fixed ?? false;
  const asBits = options.bits ?? false;

  let bytes: bigint;
  if (typeof n === 'bigint') {
    bytes = n;
  } else {
    if (!Number.isInteger(n)) {
      throw new ByteSizeError(`format() requires an integer byte count, got ${n}`);
    }
    bytes = BigInt(n);
  }

  const negative = bytes < 0n;
  let magnitude = negative ? -bytes : bytes;
  if (asBits) magnitude *= 8n;

  const base = baseFor(standard);
  let exponent = 0;
  let scale = 1n;
  while (exponent < MAX_EXPONENT && magnitude >= scale * base) {
    scale *= base;
    exponent++;
  }

  const scaleFactor = 10n ** BigInt(Math.max(precision, 0));
  let mantissaScaled = roundDiv(magnitude * scaleFactor, scale);

  // Rounding can carry the mantissa up to the next unit's threshold
  // (e.g. 999.996 kB -> "1000.00 kB"); re-pick the unit when that happens.
  if (exponent < MAX_EXPONENT && mantissaScaled >= base * scaleFactor) {
    exponent++;
    scale *= base;
    mantissaScaled = roundDiv(magnitude * scaleFactor, scale);
  }

  const mantissaStr = formatMantissa(mantissaScaled, precision, fixed);
  const numberStr = options.locale ? localize(mantissaStr, options.locale) : mantissaStr;
  const unit = byteUnitSymbol(standard, exponent, asBits);
  const sign = negative && magnitude !== 0n ? '-' : '';
  return `${sign}${numberStr} ${unit}`;
}
