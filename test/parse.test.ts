import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AmbiguousUnitError,
  FractionalBitError,
  FractionalByteError,
  MalformedInputError,
  UnknownUnitError,
  UnsafeIntegerError,
  asNumber,
  parse,
  parseBits,
} from '../src/index.ts';

test('strict mode: SI (1000-based) units', () => {
  assert.equal(parse('1B'), 1n);
  assert.equal(parse('1kB'), 1000n);
  assert.equal(parse('1MB'), 1000n ** 2n);
  assert.equal(parse('1GB'), 1000n ** 3n);
  assert.equal(parse('1TB'), 1000n ** 4n);
  assert.equal(parse('1PB'), 1000n ** 5n);
  assert.equal(parse('1EB'), 1000n ** 6n);
  assert.equal(parse('1ZB'), 1000n ** 7n);
  assert.equal(parse('1YB'), 1000n ** 8n);
  assert.equal(parse('1RB'), 1000n ** 9n);
  assert.equal(parse('1QB'), 1000n ** 10n);
});

test('strict mode: IEC (1024-based) units', () => {
  assert.equal(parse('1KiB'), 1024n);
  assert.equal(parse('1MiB'), 1024n ** 2n);
  assert.equal(parse('1GiB'), 1024n ** 3n);
  assert.equal(parse('1TiB'), 1024n ** 4n);
  assert.equal(parse('1QiB'), 1024n ** 10n);
});

test('strict mode: the premise this package fixes', () => {
  // bytes@3.1.2 gets every one of these wrong (see README "Why").
  assert.equal(parse('10KiB'), 10240n);
  assert.equal(parse('1.5MB'), 1500000n);
  assert.equal(parse('10kB'), 10000n);
});

test('strict mode: decimals, exponents, whitespace, signs', () => {
  assert.equal(parse('1.5kB'), 1500n);
  assert.equal(parse('  2   MB '), 2_000_000n);
  assert.equal(parse('1e3B'), 1000n);
  assert.equal(parse('1.5e3kB'), 1_500_000n);
  assert.equal(parse('-1kB'), -1000n);
  assert.equal(parse('+1kB'), 1000n);
  assert.equal(parse('.5kB'), 500n);
});

test('strict mode: bits vs bytes are distinct and case-exact', () => {
  assert.equal(parse('8b'), 1n); // 8 bits = 1 byte
  assert.equal(parse('8kb'), 1000n); // 8000 bits = 1000 bytes
  assert.equal(parse('8Mb'), 1_000_000n);
  assert.equal(parse('8Kib'), 1024n); // IEC kibibit
  assert.throws(() => parse('1b'), FractionalByteError); // 1 bit is not a whole byte
});

test('strict mode: rejects ambiguous casing instead of guessing', () => {
  assert.throws(() => parse('10KB'), AmbiguousUnitError);
  assert.throws(() => parse('10Kb'), AmbiguousUnitError);
});

test('strict mode: unknown unit', () => {
  assert.throws(() => parse('10XB'), UnknownUnitError);
  assert.throws(() => parse('10MiBx'), UnknownUnitError);
});

test('strict mode: malformed input', () => {
  assert.throws(() => parse(''), MalformedInputError);
  assert.throws(() => parse('kB'), MalformedInputError);
  assert.throws(() => parse('10 10 kB'), MalformedInputError);
  assert.throws(() => parse('ten kB'), MalformedInputError);
});

test('jedec mode: matches the `bytes` npm package (v3.1.2) exactly', () => {
  // Measured directly against the installed package; see README "Why".
  assert.equal(parse('1KB', { mode: 'jedec' }), 1024n);
  assert.equal(parse('10KB', { mode: 'jedec' }), 10240n);
  assert.equal(parse('1.5MB', { mode: 'jedec' }), 1572864n);
  assert.equal(parse('10kb', { mode: 'jedec' }), 10240n); // case-insensitive, like `bytes`
  assert.equal(parse('10Kb', { mode: 'jedec' }), 10240n);
});

test('jedec mode: extends past what `bytes` itself recognizes (documented extension)', () => {
  assert.equal(parse('1EB', { mode: 'jedec' }), 1024n ** 6n);
  assert.equal(parse('1QB', { mode: 'jedec' }), 1024n ** 10n);
});

test('auto mode: lenient, case-insensitive, "i" means IEC, trailing B optional', () => {
  assert.equal(parse('10K', { mode: 'auto' }), 10000n);
  assert.equal(parse('10k', { mode: 'auto' }), 10000n);
  assert.equal(parse('10Ki', { mode: 'auto' }), 10240n);
  assert.equal(parse('10KIB', { mode: 'auto' }), 10240n);
  assert.equal(parse('10kib', { mode: 'auto' }), 10240n);
  assert.equal(parse('10B', { mode: 'auto' }), 10n);
  assert.equal(parse('10', { mode: 'auto' }), 10n);
});

test('parseBits: exact bit counts, including ones parse() must reject', () => {
  assert.equal(parseBits('1b'), 1n);
  assert.equal(parseBits('1B'), 8n);
  assert.equal(parseBits('1kb'), 1000n);
  assert.throws(() => parseBits('1.5b'), FractionalBitError);
});

test('asNumber: exactness guard at 2^53', () => {
  const safe = parse('9007199254740991B'); // Number.MAX_SAFE_INTEGER
  assert.equal(asNumber(safe), Number.MAX_SAFE_INTEGER);

  const unsafe = safe + 1n;
  assert.throws(() => asNumber(unsafe), UnsafeIntegerError);
  assert.equal(asNumber(unsafe, { allowUnsafe: true }), Number(unsafe));
});

test('rounding: "nearest" recovers a value from decimal text that is not exactly whole bytes', () => {
  // 5.9 KiB is exactly 6041.6 bytes: not representable as an exact bigint.
  assert.throws(() => parse('5.9KiB'), FractionalBitError);
  assert.equal(parse('5.9KiB', { rounding: 'nearest' }), 6042n); // 6041.6 rounds up
  assert.equal(parse('1b', { rounding: 'nearest' }), 0n); // 1 bit rounds down to 0 bytes
  assert.equal(parse('5b', { rounding: 'nearest' }), 1n); // 5 bits rounds up to 1 byte
  assert.equal(parse('-5.9KiB', { rounding: 'nearest' }), -6042n);
});

test('zero and large scales round-trip through bigint exactly', () => {
  assert.equal(parse('0B'), 0n);
  assert.equal(parse('0kB'), 0n);
  assert.equal(parse('1QiB'), 1024n ** 10n);
});
