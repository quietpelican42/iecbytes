import assert from 'node:assert/strict';
import test from 'node:test';

import { format } from '../src/index.ts';

test('format: basic SI and IEC', () => {
  assert.equal(format(1500000n), '1.5 MB');
  assert.equal(format(1500000n, { standard: 'si' }), '1.5 MB');
  assert.equal(format(1536n, { standard: 'iec' }), '1.5 KiB');
  assert.equal(format(0n), '0 B');
  assert.equal(format(999n), '999 B');
  assert.equal(format(1000n), '1 kB');
  assert.equal(format(1024n, { standard: 'iec' }), '1 KiB');
});

test('format: jedec standard uses the JEDEC (uppercase, 1024-based) unit names', () => {
  assert.equal(format(1024n, { standard: 'jedec' }), '1 KB');
  assert.equal(format(1572864n, { standard: 'jedec' }), '1.5 MB');
});

test('format: never prints a mantissa that should have carried to the next unit', () => {
  // 999996 / 1000 = 999.996 kB, which at precision 2 rounds to "1000.00 kB" unless
  // the unit is re-picked — this is the exact bug this package refuses to have.
  assert.equal(format(999_996n, { standard: 'si', precision: 2 }), '1 MB');
  assert.equal(format(999_996n, { standard: 'si', precision: 2, fixed: true }), '1.00 MB');
  // Same class of bug, one exponent further out.
  assert.equal(format(999_999_996n, { standard: 'si', precision: 2 }), '1 GB');
  // And in IEC: 1024 * 1024 - 1 byte, rounded to 2 decimals, must not read "1024.00 KiB".
  assert.equal(format(1024n * 1024n - 1n, { standard: 'iec', precision: 2 }), '1 MiB');
});

test('format: precision and fixed', () => {
  assert.equal(format(1234n, { standard: 'si', precision: 0 }), '1 kB');
  assert.equal(format(1234n, { standard: 'si', precision: 1 }), '1.2 kB');
  assert.equal(format(1234n, { standard: 'si', precision: 3 }), '1.234 kB');
  assert.equal(format(1200n, { standard: 'si', precision: 3 }), '1.2 kB'); // trimmed
  assert.equal(format(1200n, { standard: 'si', precision: 3, fixed: true }), '1.200 kB');
});

test('format: half-up rounding at the boundary', () => {
  // 1.005 kB at precision 2: the exact tie between 1.00 and 1.01.
  assert.equal(format(1005n, { standard: 'si', precision: 2 }), '1.01 kB');
  assert.equal(format(1015n, { standard: 'si', precision: 2 }), '1.02 kB');
});

test('format: negative and integer-only number input', () => {
  assert.equal(format(-1536, { standard: 'iec' }), '-1.5 KiB');
  assert.equal(format(-0, { standard: 'iec' }), '0 B');
  assert.throws(() => format(1.5));
});

test('format: bits', () => {
  assert.equal(format(1_000_000n, { bits: true }), '8 Mb');
  assert.equal(format(1n, { bits: true }), '8 b');
  assert.equal(format(128n, { standard: 'iec', bits: true }), '1 Kib');
});

test('format: locale', () => {
  assert.equal(format(1500n, { standard: 'si', locale: 'de-DE' }), '1,5 kB');
  assert.equal(format(1234n, { standard: 'si', precision: 3, fixed: true, locale: 'de-DE' }), '1,234 kB');
});

test('format: every prefix up to quetta, round-trippable magnitude', () => {
  assert.equal(format(1000n ** 9n, { standard: 'si' }), '1 RB');
  assert.equal(format(1000n ** 10n, { standard: 'si' }), '1 QB');
  assert.equal(format(1024n ** 9n, { standard: 'iec' }), '1 RiB');
  assert.equal(format(1024n ** 10n, { standard: 'iec' }), '1 QiB');
  // Nothing beyond quetta: the largest prefix absorbs whatever is left.
  assert.equal(format(1000n ** 11n, { standard: 'si' }), '1000 QB');
});
