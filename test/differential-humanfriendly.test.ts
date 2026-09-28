/**
 * Differential test against Python's `humanfriendly.parse_size`, an
 * independent, widely-used reference implementation of the same SI/IEC
 * rules. Not a devDependency and never installed by this package: it is
 * looked up at test time and the whole file skips loudly if it is absent,
 * per this project's rule against committing/depending on third-party
 * fixtures.
 *
 * Set IECBYTES_PYTHON to a python executable that has `humanfriendly`
 * importable (e.g. a venv's bin/python) if it is not on PATH as `python3`.
 *
 *   pip install humanfriendly
 *   IECBYTES_PYTHON=/path/to/python npm test
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test, { before } from 'node:test';

import { parse } from '../src/index.ts';

const PYTHON = process.env.IECBYTES_PYTHON ?? 'python3';

function humanfriendlyAvailable(): boolean {
  const r = spawnSync(PYTHON, ['-c', 'import humanfriendly'], { encoding: 'utf8' });
  return r.status === 0;
}

/** Ask the real `humanfriendly.parse_size` for its answer, as a decimal string (it returns a float). */
function parseSizeViaPython(inputs: string[]): string[] {
  const script = `
import sys, json, humanfriendly
out = []
for s in json.loads(sys.stdin.read()):
    try:
        out.append(repr(humanfriendly.parse_size(s)))
    except Exception as e:
        out.append('ERROR:' + str(e))
print(json.dumps(out))
`;
  const r = spawnSync(PYTHON, ['-c', script], { input: JSON.stringify(inputs), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`python failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

let available = false;
before(() => {
  available = humanfriendlyAvailable();
});

test('differential: parse() agrees with humanfriendly.parse_size on shared ground (auto mode)', (t) => {
  if (!available) {
    t.skip(`humanfriendly not importable via "${PYTHON} -c 'import humanfriendly'"; run: pip install humanfriendly`);
    return;
  }

  // humanfriendly.parse_size is case-insensitive, treats an "i" as the IEC
  // marker, and has no bit units — exactly this package's `auto` mode. It
  // also has no ronna/quetta (2022 SI prefixes), so those are excluded here.
  const inputs = [
    '0 B',
    '1 B',
    '1 KB',
    '1 kB',
    '1KiB',
    '10 KB',
    '10 KiB',
    '1.5 MB',
    '1.5 MiB',
    '10 GB',
    '10 GiB',
    '1 TB',
    '1 TiB',
    '2.25 PB',
    '2.25 PiB',
    '1 EB',
    '1 EiB',
    '1 ZB',
    '1 ZiB',
    '1 YB',
    '1 YiB',
    '123456789 B',
    '0.001 KB',
    '999.999 MB',
  ];

  const pythonResults = parseSizeViaPython(inputs);
  for (const [i, input] of inputs.entries()) {
    const py = pythonResults[i]!;
    assert.ok(!py.startsWith('ERROR:'), `humanfriendly failed on ${input}: ${py}`);
    // humanfriendly returns a Python float; compare as numbers (both sides
    // are exact for every magnitude in this corpus).
    const pyValue = Number(py);
    const ours = parse(input, { mode: 'auto' });
    assert.equal(Number(ours), pyValue, `mismatch on ${JSON.stringify(input)}: ours=${ours} humanfriendly=${py}`);
  }
});

test('differential: humanfriendly.format_size has the exact rounding-carry bug this package avoids', (t) => {
  if (!available) {
    t.skip(`humanfriendly not importable via "${PYTHON} -c 'import humanfriendly'"`);
    return;
  }
  const r = spawnSync(PYTHON, ['-c', 'import humanfriendly; print(humanfriendly.format_size(999996))'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  // humanfriendly 10.0, measured here: prints "1000 KB", not "1 MB".
  assert.equal(r.stdout.trim(), '1000 KB');
});
