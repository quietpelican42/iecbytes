import assert from 'node:assert/strict';
import test from 'node:test';

import { format, parse, type ParseMode } from '../src/index.ts';
import { MAX_EXPONENT, baseFor, type Standard } from '../src/units.ts';

/** Small deterministic PRNG (mulberry32) so failures reproduce without external deps. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random bigint with roughly `digits` decimal digits, for coverage across every scale. */
function randomBigint(rand: () => number, digits: number): bigint {
  let s = String(1 + Math.floor(rand() * 9)); // no leading zero
  for (let i = 1; i < digits; i++) s += String(Math.floor(rand() * 10));
  return BigInt(s);
}

function pickExponent(magnitude: bigint, base: bigint): number {
  let exponent = 0;
  let scale = 1n;
  while (exponent < MAX_EXPONENT && magnitude >= scale * base) {
    scale *= base;
    exponent++;
  }
  return exponent;
}

const STANDARD_TO_MODE: Record<Standard, ParseMode> = { si: 'strict', iec: 'strict', jedec: 'jedec' };

test('property: parse(format(n)) stays within the rounding bound, across scales and precisions', () => {
  const rand = prng(0xb00b1e5);
  const standards: Standard[] = ['si', 'iec', 'jedec'];
  const precisions = [0, 1, 2, 4];
  let checked = 0;

  for (const standard of standards) {
    const base = baseFor(standard);
    for (const precision of precisions) {
      for (let digits = 1; digits <= 33; digits++) {
        for (let sample = 0; sample < 3; sample++) {
          const n = randomBigint(rand, digits);
          const text = format(n, { standard, precision });
          // format() rounds decimal digits of a base-1024 (or fractional
          // base-1000) value, which does not always land back on an exact
          // integer byte count (e.g. "5.9 KiB" is really 6041.6 bytes) — so
          // round-tripping needs { rounding: 'nearest' } rather than the
          // default exactness guarantee, which is about parsing real input,
          // not recovering our own lossy display text.
          const back = parse(text, { mode: STANDARD_TO_MODE[standard], rounding: 'nearest' });

          const exponent = pickExponent(n, base);
          // Half-up rounding at `precision` decimals of a mantissa scaled by
          // base^exponent: the max error is half of the smallest displayed
          // increment, i.e. base^exponent / (2 * 10^precision) bytes. Add one
          // full base^exponent of slack for the rare case where rounding
          // carried into the next prefix (format() re-picks the exponent
          // then, which this test does not replicate bit-for-bit).
          const unit = base ** BigInt(exponent);
          const halfLastDigit = unit / (2n * 10n ** BigInt(precision));
          const tolerance = halfLastDigit + unit + 1n;
          const diff = back > n ? back - n : n - back;
          assert.ok(
            diff <= tolerance,
            `${standard} p${precision}: parse(format(${n})) = parse(${JSON.stringify(text)}) = ${back}, ` +
              `off by ${diff}, tolerance ${tolerance}`,
          );
          checked++;
        }
      }
    }
  }

  assert.ok(checked > 300, `expected a real property sweep, only ran ${checked} cases`);
});

test('property: format(parse(x)) is stable (parsing our own canonical output is idempotent)', () => {
  const rand = prng(0xfeed5eed);
  const standards: Standard[] = ['si', 'iec', 'jedec'];
  let checked = 0;
  for (const standard of standards) {
    for (let digits = 1; digits <= 30; digits++) {
      const n = randomBigint(rand, digits);
      const text = format(n, { standard, precision: 2 });
      const parsed = parse(text, { mode: STANDARD_TO_MODE[standard], rounding: 'nearest' });
      const again = format(parsed, { standard, precision: 2 });
      assert.equal(again, text);
      checked++;
    }
  }
  assert.ok(checked > 60);
});
