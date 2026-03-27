<p align="center">
  <img src="https://raw.githubusercontent.com/radarsimx/.github/refs/heads/main/profile/radarsimapp.svg" alt="RadarSimApp logo" width="200"/>
</p>

# RadarSimApp

A **Radar** **Sim**ulation desktop **App** powered by [RadarSimLib](https://github.com/radarsimx/radarsimlib)

RadarSimApp is a cross-platform desktop application that brings the full power of RadarSimLib into an intuitive graphical interface. Model FMCW radar transceivers, define point and mesh targets, run baseband simulations, and visualize Range-Doppler maps — all without writing a single line of code.

<p align="center">
  <img src="./assets/radarsimapp.gif" alt="RadarSimApp UI demo" width="800"/>
</p>

---

## Key Features

- :satellite: **Radar Modeling**
  - Transmitter: FMCW/CW/custom waveforms, multi-channel TX, antenna patterns, phase noise
  - Receiver: sampling rate, noise figure, RF/baseband gain, multi-channel RX, antenna patterns
  - Radar platform: position, velocity, rotation, and rotation rate
- :video_game: **Simulation**
  - Baseband data from point targets and 3D mesh targets (STL)
  - Configurable fidelity levels: frame, pulse, and sample
  - Optional receiver noise injection
  - RCS analysis across incidence angles
- :signal_strength: **Signal Processing**
  - Range profile computation with configurable FFT size
  - Range-Doppler map with configurable Doppler FFT size
- :bar_chart: **Visualization**
  - Interactive Plotly plots: baseband signal, range profile, range-Doppler map
  - TX/RX channel location plots and virtual array overview
  - Waveform frequency-vs-time preview
- :floppy_disk: **Configuration Management**
  - Save/load full radar configurations to/from JSON

---

## Dependencies

- **Node.js** ≥ 18
- `radarsimc.dll` (Windows) / `libradarsimcpp.so` (Linux) / `libradarsimcpp.dylib` (macOS) placed in `radarsimlib/`
- A valid `license_RadarSimM_*.lic` file placed in `radarsimlib/`

**Node.js package dependencies** (installed via `npm install`):

| Package | Purpose |
|---|---|
| `koffi` | FFI bindings to the native RadarSimLib |
| `plotly.js-dist` | Interactive result plots |
| `h5wasm` | HDF5/JSON export support |
| `electron-squirrel-startup` | Windows installer integration |

---

## Development

```bash
# Clone the repository
git clone https://github.com/radarsimx/radarsimapp.git
cd radarsimapp

# Install Node.js dependencies
npm install

# Place the native library and license file
cp /path/to/radarsimc.dll radarsimlib/
cp /path/to/license_RadarSimM_*.lic radarsimlib/

# Run the app
npm start

# Run in development mode (with DevTools open)
npm run dev
```

---

## Architecture

```
radarsimapp/
├── main.js              # Electron main process
├── preload.js           # Context bridge (secure IPC)
├── radarsimlib/
│   ├── bridge.js        # Native C bridge (koffi FFI → RadarSimLib)
│   ├── radarsimc.dll    # RadarSimLib native library (Windows)
│   └── license_RadarSimM_*.lic
├── renderer/
│   ├── index.html       # Main UI
│   ├── css/
│   │   └── styles.css   # Dark theme
│   └── js/
│       ├── app.js       # Simulation runner & event wiring
│       ├── channels.js  # TX/RX channel management
│       ├── config.js    # Config serialization & defaults
│       ├── plots.js     # Plotly rendering helpers
│       ├── state.js     # Persistent UI state (localStorage)
│       ├── targets.js   # Point & mesh target management
│       └── utils.js     # Shared utilities
└── package.json
```

---

## Packaging

Build a platform-specific installer or package:

```bash
# Windows (Squirrel installer)
npm run dist:win

# macOS (DMG)
npm run dist:mac

# Linux (AppImage)
npm run dist:linux
```

The output is placed in `dist/`. The native library and license file are automatically unpacked from the `.asar` archive at runtime via `asarUnpack`.

---

## Usage

1. **About** — Click the **About** button in the sidebar footer to verify the library version and license status
2. **Configure Transmitter** — Set start/end frequency, sweep timing, pulse count, TX power, and TX channels with antenna patterns
3. **Configure Receiver** — Set sampling rate, baseband type, noise figure, gain, and RX channels with antenna patterns
4. **Configure Radar** — Set platform position, velocity, rotation, and rotation rate
5. **Add Targets** — Add point targets (location, RCS, speed, phase) or mesh targets (STL files with motion parameters)
6. **Run Simulation** — Select fidelity level, toggle noise and processing options, then click **Run Simulation**
7. **View Results** — Inspect the baseband signal, range profile, and Range-Doppler map; step through channels and pulses
8. **Export** — Save the full simulation result to JSON for further analysis

---

## License

This project is licensed under the terms of the [LICENSE](LICENSE.txt) file.
