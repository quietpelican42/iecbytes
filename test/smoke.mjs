/**
 * Plain-JS checks against the built package, so they run on every Node version
 * in `engines` — the TypeScript suite needs type stripping and only runs on 24+.
 *
 *   npm run build && node --test test/smoke.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const { parse, format, parseBits, asNumber, AmbiguousUnitError } = await import('../dist/index.js');

test('parse: SI vs IEC', () => {
  assert.equal(parse('10KiB'), 10240n);
  assert.equal(parse('10kB'), 10000n);
  assert.equal(parse('1.5MB'), 1500000n);
});

test('parse: rejects ambiguous casing', () => {
  assert.throws(() => parse('10KB'), AmbiguousUnitError);
});

test('parse: jedec mode matches the bytes package', () => {
  assert.equal(parse('10KB', { mode: 'jedec' }), 10240n);
});

test('format: never carries into a printed overflow', () => {
  assert.equal(format(999_996n, { standard: 'si', precision: 2 }), '1 MB');
});

test('parseBits + asNumber', () => {
  assert.equal(parseBits('1b'), 1n);
  assert.equal(asNumber(1024n), 1024);
});
