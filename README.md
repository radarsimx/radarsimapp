# RadarSimApp

Desktop radar simulation application powered by [RadarSimLib](https://github.com/radarsimx/radarsimlib) — a native C library called directly via FFI.

## Features

- **Transmitter Configuration** — FMCW/CW/custom waveforms, multi-channel TX with antenna patterns, phase noise modeling
- **Receiver Configuration** — Sampling rate, noise figure, RF/baseband gain, multi-channel RX with antenna patterns
- **Radar Platform** — Position, velocity, rotation, and rotation rate
- **Targets** — Point targets (RCS, speed, phase) and 3D mesh targets (STL files)
- **Simulation Engine** — Baseband simulation with configurable fidelity levels
- **RCS Analysis** — Compute radar cross-section of 3D models across angles
- **Visualization** — Range-Doppler maps, range profiles, baseband signals via Plotly
- **Export** — Save simulation results to JSON/CSV

## Prerequisites

- **Node.js** ≥ 18
- `radarsimc.dll` and a valid `license_RadarSimM_*.lic` file placed in `radarsimlib/`

## Setup

```bash
# Install Node.js dependencies
npm install

# Run the app
npm start

# Run in dev mode (with DevTools)
npm run dev
```

## Architecture

```
radarsimapp/
├── main.js              # Electron main process
├── preload.js           # Context bridge (secure IPC)
├── radarsimlib/
│   ├── bridge.js        # Native C bridge (koffi FFI → radarsimc.dll)
│   ├── radarsimc.dll    # RadarSimLib native library
│   └── license_RadarSimM_*.lic
├── renderer/
│   ├── index.html       # Main UI
│   ├── css/styles.css   # Dark theme
│   └── js/              # UI logic & state management
└── package.json
```

## Packaging (Windows .exe)

Install [electron-builder](https://www.electron.build/):

```bash
npm install --save-dev electron-builder
```

Then build:

```bash
npm run dist
```

The installer is output to `dist/`. `radarsimc.dll` and the license file are automatically unpacked from the `.asar` archive so they are accessible at runtime.

To produce a portable single executable instead of an installer, change `"target"` to `"portable"` in the `build` section of `package.json`.

## Usage

1. **About** — Click the button in the sidebar footer to verify the library version and license status
2. **Configure Transmitter** — Set waveform type, frequency, bandwidth, power, pulses, and TX channels
3. **Configure Receiver** — Set sampling rate, noise figure, gains, and RX channels
4. **Configure Radar** — Set platform position, velocity, and rotation
5. **Add Targets** — Add point targets (location, RCS, speed) or mesh targets (STL files)
6. **Run Simulation** — Configure simulation settings and click Run
7. **View Results** — Range-Doppler map, range profile, and baseband signal plots
8. **Export** — Save results to JSON for further analysis
