# iecbytes

Byte-size parsing and formatting that keeps SI (`kB` = 1000) and IEC (`KiB` = 1024) separate, with exact `bigint` arithmetic throughout.

```ts
import { parse, format } from 'iecbytes';

parse('10KiB');           // 10240n — IEC, binary
parse('10kB');            // 10000n — SI, decimal
parse('10KB');            // throws AmbiguousUnitError: not a real unit in strict mode

format(1_500_000n);                       // "1.5 MB"
format(1536n, { standard: 'iec' });       // "1.5 KiB"
```

## Why

Node's most-downloaded byte-size package conflates decimal and binary units
and does not recognize IEC unit strings at all.

Measured: `bytes@3.1.2` installed fresh (494,427,464 downloads/month per
`api.npmjs.org/downloads/point/last-month/bytes`, 2026-08-29 to 2026-09-27 —
this is a load-bearing, near-ubiquitous dependency, used for size-limit
strings such as `express.json({ limit: '10kb' })`):

```
$ node -e "const bytes=require('bytes'); \
  console.log(bytes.parse('10KiB'), bytes.parse('10KB'), bytes.parse('1.5MB'))"
10 10240 1572864
```

`bytes.parse('10KiB')` returns `10` — it matches only the leading digits and
silently ignores the `KiB` unit, an off-by-1024x bug. `bytes.parse('10KB')`
returns `10240` — it treats the decimal `KB` unit as binary. A config value
like `"10KiB"`, written expecting a 10240-byte limit, silently becomes a
10-byte limit instead.

Checked the natural alternatives: `pretty-bytes` and `filesize` format
correctly (`prettyBytes(1024, {binary:true})` → `'1 KiB'`) but expose no
`parse()` at all — string-to-bytes is only half solved. `human-format` has a
`parse()`, but it is strict about casing rather than auto-detecting SI vs.
IEC from the unit itself: `parse('10 KB')` throws unless the input is spelled
exactly `'10 kB'`, and binary scale has to be passed in rather than read from
an `i` in the unit (measured: `human-format@1.2.1`). `byte-size` is
format-only (no `parse` export at all). `@saekitominaga/bytes` does not
exist on the npm registry under that name (checked; not a typo I could
resolve to a real package).

`xbytes@1.9.1` parses `1.5MB` correctly (`1500000`) but is JEDEC by default
for `KB`-shaped units: `xbytes.parseSize('10KB')` returns `10240`, the same
1024-based reading as `bytes`.

One real near-miss: **`bytes-iec@3.1.1`** (a fork of `bytes` itself, keywords
`iec`/`si`/`jedec`) gets all three headline cases right —
`parse('10KiB')` → `10240`, `parse('10KB')` → `10000`, `parse('1.5MB')` →
`1500000` (measured, installed fresh). It is the closest prior art to this
package and worth knowing about. It still falls short of "solved":

- **Unmaintained.** Its GitHub repo (`Saevon/bytes.js`) has had no commits
  since 2020-12-07 (checked via `gh api repos/Saevon/bytes.js` — `pushed_at`
  6 years ago from this writing, 4 stars, 156 commits total, none since).
  4,540,246 downloads/month vs. `bytes`' 494,427,464 (same date range) — a
  small fraction of the ecosystem has moved to it.
- **Float, not exact.** It computes `Math.floor(unitValue * parseFloat(str))`
  — plain `Number` arithmetic. Measured: `parse('1.1EB')` returns
  `1100000000000000100`, not the exact `1100000000000000000`; and
  `parse('9007199254740993B')` (2⁵³+1) silently returns `9007199254740992`,
  one byte short, with no error.
- **No ambiguity detection.** `10KB` and `10Kb` both silently parse as SI
  1000-based (whatever has no `i` is guessed decimal) — the exact
  guess-instead-of-reject behavior this package's `strict` mode exists to
  refuse.
- **No bit units.** `parse('100Mb')` returns `100000000` (treating the `b`
  as bytes), not the 12,500,000-byte value a bits-vs-bytes-aware reading
  would give.
- **No 2022 SI prefixes.** `parse('1QB')` returns `null` — a silent failure
  a caller checking truthiness rather than `=== null` would miss entirely.

## Installation

```sh
npm install iecbytes
```

Node >= 20.6. Zero runtime dependencies.

## Usage

### Parsing a config value strictly

```ts
import { parse } from 'iecbytes';

const maxUploadBytes = parse(process.env.MAX_UPLOAD ?? '10MiB'); // bigint
```

`strict` mode (the default) never guesses: `kB`/`MB`/... are SI (1000-based),
`KiB`/`MiB`/... are IEC (1024-based), and anything spelled ambiguously
(`KB`, `Kb`) throws `AmbiguousUnitError` naming the likely intents instead of
picking one.

### Matching `bytes`/Windows/JEDEC behavior on purpose

```ts
import { parse } from 'iecbytes';

parse('10KB', { mode: 'jedec' });                              // 10240n — same reading as bytes@3.1.2
parse('3.14159kb', { mode: 'jedec', rounding: 'floor' });       // 3216n  — bytes@3.1.2 gives exactly this too
```

`{ mode: 'jedec' }` alone matches `bytes@3.1.2`'s unit table (1024-based,
case-insensitive) for every input whose true value is already a whole byte.
For a fractional input, `bytes` computes `Math.floor(unitSize * value)` in
floating point — add `{ rounding: 'floor' }` to reproduce that truncation
exactly, in bigint arithmetic, for its five real units (`kb`/`mb`/`gb`/`tb`/`pb`).
See "Interop" below for the precise scope of that claim.

### Lenient parsing of unpredictable input

```ts
import { parse } from 'iecbytes';

parse('10k', { mode: 'auto' });  // 10000n
parse('10Ki', { mode: 'auto' }); // 10240n
```

`auto` is an explicit opt-in, never a default: case-insensitive, the trailing
`B` is optional, and an `i` anywhere after the prefix letter means IEC.

### Bits vs. bytes

```ts
import { parse } from 'iecbytes';

parse('100Mb'); // 12500000n bytes — lowercase b is bits (100 megabits)
parse('100MB'); // 100000000n bytes — uppercase B is bytes
```

### Formatting without a rounding-carry bug

```ts
import { format } from 'iecbytes';

format(999_996n, { standard: 'si', precision: 2 }); // "1 MB", never "1000.00 kB"
```

### Recovering a value from `format()`'s own (lossy) output

```ts
import { format, parse } from 'iecbytes';

const text = format(6042n, { standard: 'iec', precision: 1 }); // "5.9 KiB"
parse(text, { standard: 'iec' });                              // throws: 5.9 KiB is 6041.6 bytes, not an integer
parse(text, { rounding: 'nearest' });                           // 6042n
```

## Reference

### `parse(input: string, options?): bigint`

Parses a decimal number (sign, fraction, exponent all accepted) plus an
optional unit, returning the exact size in bytes. Throws if the result is not
a whole number of bytes.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `'strict' \| 'jedec' \| 'auto'` | `'strict'` | Which unit grammar to accept. |
| `rounding` | `'exact' \| 'nearest' \| 'floor'` | `'exact'` | `'nearest'` rounds half-up to a whole byte instead of throwing; `'floor'` rounds toward -Infinity, matching `bytes@3.1.2`'s `Math.floor(unitSize * value)` (see "Interop"). |

### `parseBits(input: string, options?): bigint`

Same grammar, returns the exact size in bits. Use this for values that are
not meant to be a whole number of bytes (e.g. raw bit-rate config).

### `asNumber(bytes: bigint, options?): number`

Converts a bigint to `Number`. Throws `UnsafeIntegerError` above
`Number.MAX_SAFE_INTEGER` unless `{ allowUnsafe: true }`.

### `format(n: bigint | number, options?): string`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `standard` | `'si' \| 'iec' \| 'jedec'` | `'si'` | Unit family: 1000-based, 1024-based with `Ki`/`Mi`/..., or 1024-based with `K`/`M`/... (JEDEC spelling). |
| `precision` | `number` | `2` | Decimal digits to keep. |
| `fixed` | `boolean` | `false` | Keep trailing zeros out to `precision` (`"1.00 MB"`) instead of trimming them (`"1 MB"`). |
| `locale` | `string` | — | BCP 47 locale for the decimal separator/grouping, via `Intl.NumberFormat`. |
| `bits` | `boolean` | `false` | Render as bits (value × 8) using `Mb`/`Mib`-style units. |

Rounds half-up (ties round away from zero), computed in exact bigint
arithmetic. Re-picks the unit whenever rounding would otherwise carry into
the next prefix, so `format(999_996n, { precision: 2 })` reads `"1 MB"`, never
`"1000.00 kB"`.

### Units

Every SI/IEC prefix through the 2022 additions (ronna, quetta):
`B`, `kB`/`KiB`, `MB`/`MiB`, `GB`/`GiB`, `TB`/`TiB`, `PB`/`PiB`, `EB`/`EiB`,
`ZB`/`ZiB`, `YB`/`YiB`, `RB`/`RiB`, `QB`/`QiB`, plus the bit equivalents
(`b`, `kb`/`Kib`, ..., `Qb`/`Qib`) in `strict` mode.

### Errors

All extend `ByteSizeError`.

- `MalformedInputError` — the text is not a number optionally followed by a unit.
- `UnknownUnitError` — the unit text isn't recognized in the given mode.
- `AmbiguousUnitError` — the unit is a real spelling under a *different* mode (e.g. `KB` in `strict`); names the likely intents.
- `FractionalBitError` — a bit-denominated unit (`b`, `kb`, `Mib`, ...) times the decimal literal isn't a whole number of bits.
- `FractionalByteError` — a byte-denominated unit (`B`, `kB`, `KiB`, ...) times the decimal literal isn't a whole number of bytes, *or* a bit-denominated size is a whole number of bits but not a multiple of 8. The error class always names the unit family that was actually ambiguous — a fractional `EB` never reports as a bit error just because bytes are internally 8 bits.
- `UnsafeIntegerError` — `asNumber()` would lose precision.

### Interop: what other tools accept

| Tool | `KB`/`kb` | `KiB` | Notes |
| --- | --- | --- | --- |
| `bytes` npm (measured, v3.1.2) | 1024 | not recognized (parses only the leading digits) | case-insensitive; units above `pb` unsupported |
| Kubernetes `resource.Quantity` (per k8s API docs, not independently verified here) | `k`=1000, no bare `K` | `Ki`=1024 | also has `m` (milli, 10⁻³) with no binary equivalent |
| Docker (per Docker CLI docs, not independently verified here) | `kb`=1000 | `kib`=1024 | flags like `--memory` accept `b`/`k`/`m`/`g` (JEDEC-style, no `i`) too |
| `du -h` (measured here, macOS/BSD `du`) | — | 1024-based, but rounds up to the filesystem's allocated block size, not the raw byte count | `du -h` on a 10240-byte file here reports `12K` (12 disk-block-KiB), not 10 |
| `humanfriendly.parse_size` (measured here, Python, v10.0) | 1000 | 1024 | case-insensitive; matches this package's `auto` mode almost exactly, except it has no bit units and no ronna/quetta |
| systemd (per `systemd.syntax`/`-P`-style docs, not independently verified — no Linux available in this environment) | `K`=1024 (systemd's `K` is already binary; it has no separate decimal reading) | same as `K` | systemd unit files use `K`/`M`/`G`/`T` for 1024-based sizes; there is no `Ki` spelling |

This package's `jedec` mode matches the `bytes` row's unit table exactly
(case-insensitive, 1024-based, extended here through `QB` — `bytes` itself
stops at `pb`). The precise scope of the "matches `bytes`" claim:

- For any input whose true value is already a whole number of bytes,
  `{ mode: 'jedec' }` alone matches `bytes@3.1.2` — no rounding mode needed.
- For a fractional input on one of `bytes`' five real units (`kb`, `mb`,
  `gb`, `tb`, `pb` — the only ones its regex actually matches; see below),
  add `{ rounding: 'floor' }` to reproduce its `Math.floor(unitSize * value)`
  truncation exactly. This is verified by a differential test
  (`test/differential-bytes.test.ts`) against the real, installed package
  over a sweep of unit × value combinations, below 2⁵³; above 2⁵³, `bytes`'
  plain-float arithmetic silently loses precision and this package's exact
  bigint arithmetic does not — the same test documents and asserts that
  divergence rather than papering over it.
- `bytes@3.1.2`'s parser only matches `kb`/`mb`/`gb`/`tb`/`pb` by regex, with
  no bare `b`/`B` suffix, nothing past `pb`, and no exponent notation. Any
  input that fails that regex — including a bare number, `KiB`, `1e3kb`, or
  anything above `pb` — falls back in `bytes` to `parseInt(val, 10)` with
  the unit forced to `'b'`, silently truncating at the first non-digit
  character (this is the fallback that makes `bytes.parse('10KiB')` return
  `10`). This package does not reproduce that fallback in `jedec` mode: a
  bare number or `KiB` is still read as the size it actually names, not
  truncated. "Matches `bytes`" is a claim about its five real units, not
  about that fallback path.

`auto` mode matches the `humanfriendly` row.

## How it works

`parse()` converts the decimal literal to an exact `numerator/denominator`
bigint fraction (no floating-point step) and multiplies by the unit's
`base^exponent`. The result is checked for exactness in the unit's own
currency — bits for a bit-denominated unit, bytes for a byte-denominated
one — which is what makes the thrown error name the right family
(`FractionalBitError` vs. `FractionalByteError`) instead of a fractional `EB`
being reported as a bit problem just because bytes are internally 8 bits.
`rounding: 'nearest' | 'floor'` rounds instead of throwing. `format()` runs
the arithmetic in reverse: it
picks the largest unit that the magnitude clears, scales the mantissa by
`10^precision` using bigint division with an explicit half-up remainder
check, and re-picks the unit if that rounding would have carried the mantissa
up to the base of the next one.

## Limitations

- `auto` mode has no bit units — an `i` after the prefix letter always means
  IEC bytes, matching the legacy tools it mimics.
- `jedec` mode has no bit units either, matching `bytes` itself.
- Decimal `format()` output is inherently lossy for `iec`/`jedec` (1024-based)
  values: re-parsing it can land on a fractional byte and throw unless you
  pass `{ rounding: 'nearest' }` — this is a mathematical fact (1024 isn't a
  power of 10), not a bug; see "Recovering a value from `format()`'s own
  output" above.
- No locale-aware unit names (`"1 megabyte"`) — only the symbol forms.
- No `parseK8sQuantity`. Kubernetes `resource.Quantity` also has to parse
  `m` (milli) and reject `Ki`/`Mi` combined with negative exponents in ways
  this package's grammar doesn't model, and doing that correctly needs a
  differential test against the real Go `k8s.io/apimachinery` implementation,
  which this pass didn't have time to build and verify; the interop table
  above is the API docs only, explicitly marked as such.

## Compatibility

Actually run here: Node 24.20.0 (macOS), full suite plus `dist/` smoke tests.
Node 20.6/22 are exercised by the CI matrix (`.github/workflows/test.yml`)
against `dist/`, not run locally as part of this build. Untested anywhere:
Deno, Bun, earlier Node versions.

## Development

```sh
npm install
npx tsc --noEmit
npm test                              # node --test "test/*.test.ts"
npm run build && npm run test:dist    # what CI runs against node 20/22/24
```

The differential test against Python's `humanfriendly` needs it importable
by some Python (`pip install humanfriendly`); point `IECBYTES_PYTHON` at that
interpreter if it isn't `python3` on `PATH`. The differential test against
the real `bytes` npm package needs it installed in some directory (`npm
install bytes@3.1.2` in a scratch dir); point `IECBYTES_BYTES_CWD` at that
directory. Neither is a dependency of this package, and both tests skip
loudly, with instructions, if their target is absent.

## License

MIT, see [LICENSE](./LICENSE).
