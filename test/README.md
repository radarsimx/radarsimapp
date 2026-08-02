# Tests

Node's built-in runner (`node --test`), no test framework dependency. Test
files are TypeScript and run directly via Node 26's native type stripping.

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
| `unit/convert.test.mts` | typed-array helpers, `deg2rad`, complex parsing, antenna patterns, error codes |
| `unit/dsp.test.mts` | FFT, range/Doppler transforms, dB magnitude, noise generator |
| `unit/mesh.test.mts` | STL loading (ASCII + binary), scene mesh packing and striding |
| `unit/utils.test.mts` | renderer helpers and DOM builders |
| `unit/config.test.mts` | `collectConfig()` — unit conversions and config shape |
| `unit/state.test.mts` | `captureState`/`applyState`/`validateState` round-trip |
| `integration/bridge.test.mts` | `RadarSimBridge` driving real `radarsimc` calls |

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

`helpers/dom.mts` installs a jsdom document as the process globals.
`installAppDom()` loads the real `renderer/index.html` with its `<script>` tags
stripped, so the config and state tests run against the actual form markup —
a renamed or deleted field id fails the test rather than silently reading
`undefined`.

Note that jsdom has no `ResizeObserver` (the helper stubs it) and no Plotly or
`window.api`; `state.test.mts` stubs those two itself.

## Native tests

`integration/bridge.test.mts` drives the real `RadarSimBridge`, so it exercises
`bridge.ts`'s own koffi bindings rather than a copy of them. That matters: an
earlier version of this suite re-declared each signature itself, which only
proved the *test* agreed with `radarsim.h` — a binding edited in `bridge.ts`
alone would still have passed. Going through the bridge closes that hole, and
it covers `runSimulation`/`getSceneState` end to end at the same time.

Importing the module is itself a check. koffi resolves every `lib.func()`
declaration at import time, so a renamed or removed export throws before any
test body runs.

What this still does not cover: bindings the bridge never calls
(`Run_LidarSimulator`, `Run_NoiseSimulator`, `Create_Radar_Array`,
`Add_Point_Target_Array`, `Add_Mesh_Target_Array`,
`Create_Transmitter_SSBPhaseNoise`, `Run_InterferenceSimulator`). Their symbols
are verified to exist, but a wrong argument list would not be noticed until
something calls them.

### Nothing is skipped

The integration suite does not skip. If the native library is missing, stale,
or cannot run, `before()` throws and every test in the file is reported as
failed with a non-zero exit -- a skipped suite reads too much like a passing
one. An absent licence is not gated either: the free tier rejects mesh targets,
so the mesh cases fail on the library's own message while the rest still run.

This means the machine running these tests must supply a working `radarsimc`
for its platform, and a `license_RadarSimApp_*.lic` or
`license_RadarSimPy_*.lic` in `radarsimlib/` for the mesh cases. CI writes the
licence from a secret; see `.github/workflows/test.yml`.

### Running without a GPU

`radarsimlib/radarsimc.dll` is a CUDA build, but radarsimcpp now falls back to
CPU at runtime when no device is present, so these tests run on a GPU-less
machine. Verified with `CUDA_VISIBLE_DEVICES=-1`, which makes the CUDA runtime
report zero devices.

Note that the CPU and GPU ray tracers do not agree bit-for-bit on the mesh
path -- the mesh simulator sizes its ray pool from GPU free memory -- so
assertions over mesh results should allow for that.

To test a different `radarsimc` build, put it in `radarsimlib/` — that is the
only path `bridge.ts` looks at, so there is no override env var.
