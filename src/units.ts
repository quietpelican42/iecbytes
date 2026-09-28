/**
 * Unit tables for the three parsing/formatting conventions this package
 * supports. See README.md "How it works" for the reasoning; this file is
 * pure data plus the lookups built from it.
 */

export type Standard = 'si' | 'iec' | 'jedec';

/** One decimal (SI) or binary (IEC) prefix step, 2022 edition (ronna/quetta included). */
export interface Prefix {
  /** SI symbol, e.g. `'k'` for kilo, `'M'` for mega. Kilo is the only lowercase one. */
  si: string;
  /** IEC symbol, always uppercase-plus-`i`, e.g. `'Ki'`, `'Mi'`. */
  iec: string;
  /** Power of the base (1000 or 1024) this prefix multiplies by. */
  exponent: number;
  name: string;
}

export const PREFIXES: readonly Prefix[] = [
  { si: 'k', iec: 'Ki', exponent: 1, name: 'kilo' },
  { si: 'M', iec: 'Mi', exponent: 2, name: 'mega' },
  { si: 'G', iec: 'Gi', exponent: 3, name: 'giga' },
  { si: 'T', iec: 'Ti', exponent: 4, name: 'tera' },
  { si: 'P', iec: 'Pi', exponent: 5, name: 'peta' },
  { si: 'E', iec: 'Ei', exponent: 6, name: 'exa' },
  { si: 'Z', iec: 'Zi', exponent: 7, name: 'zetta' },
  { si: 'Y', iec: 'Yi', exponent: 8, name: 'yotta' },
  { si: 'R', iec: 'Ri', exponent: 9, name: 'ronna' },
  { si: 'Q', iec: 'Qi', exponent: 10, name: 'quetta' },
];

export const MAX_EXPONENT = PREFIXES[PREFIXES.length - 1]!.exponent;

export const SI_BASE = 1000n;
export const IEC_BASE = 1024n;
/** JEDEC (`bytes`, Windows Explorer, macOS Finder): binary math, decimal-looking names. */
export const JEDEC_BASE = 1024n;

/** A resolved unit: how many bits it counts, and per bit whether that's *2 bits* or 1024^n bits, etc. */
export interface UnitInfo {
  /** 1000 or 1024. */
  base: bigint;
  /** Power of `base` this unit multiplies a *byte or bit* count by. */
  exponent: number;
  /** True if the unit counts bits (lowercase `b`), false if bytes (uppercase `B`). */
  bits: boolean;
}

function buildStrictByteUnits(): Map<string, UnitInfo> {
  const m = new Map<string, UnitInfo>();
  m.set('B', { base: SI_BASE, exponent: 0, bits: false });
  for (const p of PREFIXES) {
    m.set(`${p.si}B`, { base: SI_BASE, exponent: p.exponent, bits: false });
    m.set(`${p.iec}B`, { base: IEC_BASE, exponent: p.exponent, bits: false });
  }
  return m;
}

function buildStrictBitUnits(): Map<string, UnitInfo> {
  const m = new Map<string, UnitInfo>();
  m.set('b', { base: SI_BASE, exponent: 0, bits: true });
  for (const p of PREFIXES) {
    m.set(`${p.si}b`, { base: SI_BASE, exponent: p.exponent, bits: true });
    m.set(`${p.iec}b`, { base: IEC_BASE, exponent: p.exponent, bits: true });
  }
  return m;
}

/** Exact-case SI + IEC unit spellings, e.g. `kB`, `MiB`, `Gib`, bare `B`/`b`. */
export const STRICT_UNITS: ReadonlyMap<string, UnitInfo> = new Map([
  ...buildStrictByteUnits(),
  ...buildStrictBitUnits(),
]);

/**
 * JEDEC unit spellings: case-insensitive prefix letter, base 1024, no bit
 * variant (matches the `bytes` npm package and Windows/macOS file managers,
 * none of which distinguish bits from bytes).
 */
export const JEDEC_UNITS: ReadonlyMap<string, UnitInfo> = new Map([
  ['B', { base: JEDEC_BASE, exponent: 0, bits: false }],
  ...PREFIXES.map(
    (p): [string, UnitInfo] => [`${p.si.toUpperCase()}B`, { base: JEDEC_BASE, exponent: p.exponent, bits: false }],
  ),
]);

/** Case-insensitive prefix lookup for `auto` mode: letter -> exponent (shared by SI and IEC). */
export const PREFIX_BY_LETTER: ReadonlyMap<string, number> = new Map(
  PREFIXES.map((p) => [p.si.toUpperCase(), p.exponent]),
);

/** Canonical byte-unit spelling for a given standard and exponent, used by `format`. */
export function byteUnitSymbol(standard: Standard, exponent: number, bits: boolean): string {
  const suffix = bits ? 'b' : 'B';
  if (exponent === 0) return suffix;
  const p = PREFIXES.find((x) => x.exponent === exponent);
  if (!p) throw new RangeError(`no prefix defined for exponent ${exponent}`);
  if (standard === 'iec') return `${p.iec}${suffix}`;
  if (standard === 'jedec') return `${p.si.toUpperCase()}${suffix}`;
  return `${p.si}${suffix}`;
}

export function baseFor(standard: Standard): bigint {
  return standard === 'si' ? SI_BASE : standard === 'iec' ? IEC_BASE : JEDEC_BASE;
}
