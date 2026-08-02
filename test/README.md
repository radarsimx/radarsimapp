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
| `integration/bridge.test.ts` | `RadarSimBridge` driving real `radarsimc` calls |

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

`integration/bridge.test.ts` drives the real `RadarSimBridge`, so it exercises
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

### The packaged library needs a GPU

`radarsimlib/radarsimc.dll` is a **CUDA build**, and radarsimcpp has no runtime
CPU fallback. Its `execution_policy.hpp` says so directly — "fallback is
determined at compile time" — and `gpu_policy` selects CPU only via `#ifdef
_CUDA_`, which is *defined* in this build. `radarsim.cpp` then instantiates
every simulator with the default `gpu_policy` and never queries for a device.
So a CUDA build attempts CUDA whether or not a GPU exists.

Rather than sniffing for a driver, `before()` runs one real simulation **in a
child process**. If it fails, every test skips with the child's error, e.g.:

```
probe simulation failed: Run_RadarSimulator: PointSimulator: CUDA kernel launch failed (standard path) (code 101)
```

Doing it out-of-process means a hard crash in the native library is just a
non-zero exit rather than something that takes the suite with it. It also makes
the suite self-configuring: a **CPU build runs anywhere**, and if a future
build gains a genuine runtime fallback these tests start running with no change
here.

This is why the integration step is effectively a no-op on GitHub-hosted
runners: none of them have a GPU. Real coverage needs a self-hosted runner with
a GPU, or a CPU build of `radarsimc` shipped for CI.

They **skip rather than fail** when:

- the native library is missing, **or is too old to bind against** — the
  packaged Linux/macOS binaries currently lag the Windows one, so those
  platforms skip until current `.so`/`.dylib` are added; or
- no license is active — the free tier rejects mesh targets, so the mesh
  geometry cases need a `license_*.lic` in `radarsimlib/`.

Because of this, a green integration run on Linux or macOS today means
"skipped", not "passed". Check the skip count.

Point them at a different build with `RADARSIMAPP_LIB_PATH`:

```bash
RADARSIMAPP_LIB_PATH=/path/to/libradarsimc.so npm run test:integration
```
