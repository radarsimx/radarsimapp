# Tests

Node's built-in runner (`node --test`), no test framework dependency. Test
files are TypeScript and run directly via Node 24's native type stripping.

```bash
npm test                 # build, then run everything
npm run test:unit        # pure logic + renderer, no native library needed
npm run test:integration # native radarsimc tests only
npm run test:watch       # re-run on change (skips the build step)
npm run typecheck:test   # type-check the tests themselves
```

## Layout

| Path | Covers |
|---|---|
| `unit/convert.test.ts` | typed-array helpers, `deg2rad`, complex parsing, antenna patterns, error codes |
| `unit/dsp.test.ts` | FFT, range/Doppler transforms, dB magnitude, noise generator |
| `unit/mesh.test.ts` | STL loading (ASCII + binary), scene mesh packing and striding |
| `unit/utils.test.ts` | renderer helpers and DOM builders |
| `unit/config.test.ts` | `collectConfig()` — unit conversions and config shape |
| `unit/state.test.ts` | `captureState`/`applyState`/`validateState` round-trip |
| `integration/native.test.ts` | real `radarsimc` calls through koffi |

## How the imports work

Tests import the **built** output in `dist/`, not the `.ts` sources. Node's
type stripping does not remap `./foo.js` specifiers to `./foo.ts`, and the
renderer modules import each other that way, so source imports would fail to
resolve. Testing `dist/` also means the tests exercise exactly what ships.

That is why `npm test` builds first. `test:watch` does not — run `npm run
build` alongside it, or use it only for tests whose sources you have already
rebuilt.

`bridge.ts` calls `koffi.load()` at import time, so it cannot be imported
without the native library present. Its DLL-independent logic therefore lives
in `convert.ts`, `dsp.ts` and `mesh.ts`, which `bridge.ts` imports and the
tests can load on their own.

## DOM tests

`helpers/dom.ts` installs a jsdom document as the process globals.
`installAppDom()` loads the real `renderer/index.html` with its `<script>` tags
stripped, so the config and state tests run against the actual form markup —
a renamed or deleted field id fails the test rather than silently reading
`undefined`.

Note that jsdom has no `ResizeObserver` (the helper stubs it) and no Plotly or
`window.api`; `state.test.ts` stubs those two itself.

## Native tests

`integration/native.test.ts` declares each function with the same koffi
signature `bridge.ts` uses, so a signature that drifts from `radarsim.h` fails
here — the type checker cannot see that kind of mismatch.

They **skip rather than fail** when:

- the native library is missing (the packaged Linux/macOS binaries currently
  lag the Windows one), or
- no license is active — the free tier rejects mesh targets, so the
  `Get_Target_Mesh_State` cases need a `license_*.lic` in `radarsimlib/`.

Point them at a different build with `RADARSIMAPP_LIB_PATH`:

```bash
RADARSIMAPP_LIB_PATH=/path/to/libradarsimc.so npm run test:integration
```
