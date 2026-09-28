/**
 * Differential test against the real `bytes@3.1.2` npm package, in
 * `{ mode: 'jedec', rounding: 'floor' }` — the mode/rounding combination
 * documented as byte-for-byte compatible with `bytes`.
 *
 * `bytes` is not a devDependency of this package (it's the incumbent this
 * package exists to fix); it's looked up at test time in an external
 * directory and this file skips loudly if it isn't there, per this
 * project's rule against committing/depending on third-party fixtures.
 *
 *   mkdir -p /tmp/bytes-fixture && cd /tmp/bytes-fixture && npm init -y && npm install bytes@3.1.2
 *   IECBYTES_BYTES_CWD=/tmp/bytes-fixture npm test
 *
 * Ground truth on `bytes@3.1.2`'s actual behavior (read from its installed
 * `index.js`, not guessed): its parse regex only matches a number directly
 * followed by one of `kb|mb|gb|tb|pb` (case-insensitively) — no bare `b`/`B`
 * suffix, nothing past `pb`. Anything that doesn't match (including a bare
 * number, or `KiB`, or `eb`+) falls back to `parseInt(val, 10)` with the
 * unit forced to `'b'` — i.e. it silently truncates at the first
 * non-digit character and ignores whatever unit text followed. That
 * fallback is a source of its own bugs (it's how `bytes.parse('10KiB')`
 * silently becomes `10`, already covered in the README), so this test
 * restricts its "real unit arithmetic" comparison to the five units that
 * actually take the `Math.floor(unitSize * parseFloat(str))` path:
 * `kb`, `mb`, `gb`, `tb`, `pb`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test, { before } from 'node:test';

import { parse } from '../src/index.ts';

const BYTES_CWD = process.env.IECBYTES_BYTES_CWD ?? process.cwd();

function bytesAvailable(): boolean {
  const r = spawnSync('node', ['-e', 'require("bytes")'], { cwd: BYTES_CWD, encoding: 'utf8' });
  return r.status === 0;
}

/** Ask the real `bytes.parse` for its answer on each input, as a JSON-safe string (it can return `null`). */
function parseViaBytes(inputs: string[]): string[] {
  const script = `
const bytes = require('bytes');
const inputs = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log(JSON.stringify(inputs.map((s) => String(bytes.parse(s)))));
`;
  const r = spawnSync('node', ['-e', script], { cwd: BYTES_CWD, input: JSON.stringify(inputs), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`node failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

/** Small deterministic PRNG so the random-decimal sweep is reproducible. */
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

const REAL_BYTES_UNITS = ['kb', 'KB', 'Kb', 'mb', 'MB', 'gb', 'GB', 'tb', 'TB', 'pb', 'PB'];
const UNIT_SIZE: Record<string, number> = {
  kb: 2 ** 10,
  mb: 2 ** 20,
  gb: 2 ** 30,
  tb: 2 ** 40,
  pb: 2 ** 50,
};

/** True if mantissa*unitSize stays safely under 2^53 (float-vs-bigint agreement is not in question there). */
function safelyBelow2_53(mantissaText: string, unit: string): boolean {
  const size = UNIT_SIZE[unit.toLowerCase()];
  return Number(mantissaText) * size! < 2 ** 48;
}

let available = false;
before(() => {
  available = bytesAvailable();
});

test('differential: parse(..., {mode:"jedec", rounding:"floor"}) matches bytes@3.1.2 exactly (below 2^53)', (t) => {
  if (!available) {
    t.skip(
      `bytes@3.1.2 not resolvable from IECBYTES_BYTES_CWD=${JSON.stringify(BYTES_CWD)}; ` +
        `install it in a scratch dir and set that env var (see file header)`,
    );
    return;
  }

  const rand = prng(0xc0ffee);
  // "1e3" (the task's requested exponent-notation case) is deliberately not here:
  // bytes@3.1.2's regex has no exponent support at all, so it takes the same
  // truncating fallback path as an unrecognized unit — see the dedicated test below.
  const mantissas = ['1', '1.5', '0.25', '10', '1024', '3.14159', '1000', '1.1', '0', '999.999', '2.000001'];
  for (let i = 0; i < 20; i++) {
    // Random positive decimals with up to 6 fractional digits, kept small enough
    // that mantissa * 1024^5 (the largest unit tested) stays well under 2^53.
    const whole = Math.floor(rand() * 900) + 1;
    const frac = Math.floor(rand() * 1_000_000);
    mantissas.push(`${whole}.${String(frac).padStart(6, '0')}`);
  }

  const inputs: string[] = [];
  for (const mantissa of mantissas) {
    for (const unit of REAL_BYTES_UNITS) {
      if (safelyBelow2_53(mantissa, unit)) inputs.push(`${mantissa}${unit}`);
    }
  }

  const bytesResults = parseViaBytes(inputs);
  let checked = 0;
  for (const [i, input] of inputs.entries()) {
    const expected = bytesResults[i]!;
    assert.notEqual(expected, 'null', `bytes.parse(${JSON.stringify(input)}) unexpectedly returned null`);
    const ours = parse(input, { mode: 'jedec', rounding: 'floor' });
    assert.equal(ours.toString(), expected, `mismatch on ${JSON.stringify(input)}: ours=${ours} bytes=${expected}`);
    checked++;
  }
  assert.ok(checked > 150, `expected a real sweep, only checked ${checked}`);
});

test('differential: above 2^53, bytes@3.1.2 loses precision (float) and this package does not (bigint)', (t) => {
  if (!available) {
    t.skip(`bytes@3.1.2 not resolvable from IECBYTES_BYTES_CWD=${JSON.stringify(BYTES_CWD)}`);
    return;
  }

  // 1024 pb = 1024 * 1024^5 = 1024^6 = 2^60 exactly — an integer bigint
  // computation with no rounding. The true value is recomputed here
  // independently (plain bigint arithmetic, not by calling into this
  // package) as the ground truth both sides are checked against.
  const input = '1024pb';
  const trueFloor = 1024n ** 6n; // 1152921504606846976, independently recomputed

  const ours = parse(input, { mode: 'jedec', rounding: 'floor' });
  assert.equal(ours, trueFloor, 'this package must match independently-computed exact bigint math');

  const [bytesResult] = parseViaBytes([input]);
  assert.doesNotMatch(bytesResult!, /e\+/i, 'expected a plain integer string, not exponential notation');
  const bytesValue = BigInt(bytesResult!);
  assert.notEqual(
    bytesValue,
    trueFloor,
    'expected bytes@3.1.2 to have lost precision here (float arithmetic); if this now passes, ' +
      'its float-precision limitation no longer applies and this test (and the README) should be updated',
  );
});

test('differential: bytes@3.1.2 has no exponent-notation support at all (documented divergence)', (t) => {
  if (!available) {
    t.skip(`bytes@3.1.2 not resolvable from IECBYTES_BYTES_CWD=${JSON.stringify(BYTES_CWD)}`);
    return;
  }
  // bytes@3.1.2's regex requires `\d+(?:\.\d+)?` for the number — no `e`/`E`
  // exponent form. "1e3kb" fails that regex and falls back to
  // `parseInt('1e3kb', 10)` (= 1, truncated at the first non-digit) with the
  // unit forced to 'b': Math.floor(1 * 1) = 1, not 1000000 (1e3 kB).
  const [bytesResult] = parseViaBytes(['1e3kb']);
  assert.equal(bytesResult, '1', 'bytes@3.1.2 silently mis-parses exponent notation via its fallback path');
  assert.equal(parse('1e3kb', { mode: 'jedec', rounding: 'floor' }), 1_024_000n); // 1000 * 1024 (jedec)
});
