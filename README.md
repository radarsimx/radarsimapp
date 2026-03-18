# RadarSimApp

Desktop radar simulation application powered by [RadarSimPy](https://github.com/radarsimx/radarsimpy).

## Features

- **Transmitter Configuration** — FMCW/CW/custom waveforms, multi-channel TX with antenna patterns, phase noise modeling
- **Receiver Configuration** — Sampling rate, noise figure, RF/baseband gain, multi-channel RX with antenna patterns
- **Radar Platform** — Position, velocity, rotation, and rotation rate
- **Targets** — Point targets (RCS, speed, phase) and 3D mesh targets (STL/OBJ/PLY)
- **Simulation Engine** — Baseband simulation with CPU/GPU support, configurable fidelity levels
- **RCS Analysis** — Compute radar cross-section of 3D models across angles
- **Visualization** — Range-Doppler maps, range profiles, baseband signals via Plotly
- **Export** — Save simulation results to JSON/CSV

## Prerequisites

- **Node.js** ≥ 18
- **Python** ≥ 3.9 with `radarsimpy` and `numpy` installed
- The pre-built `radarsimpy` module must be importable from your Python environment

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
├── python/
│   ├── bridge.js        # Node.js ↔ Python bridge
│   ├── check_env.py     # Environment checker
│   ├── run_simulation.py # Baseband simulation runner
│   └── run_rcs.py       # RCS simulation runner
├── renderer/
│   ├── index.html       # Main UI
│   ├── styles.css       # Modern dark theme
│   └── app.js           # UI logic & state management
└── package.json
```

## Usage

1. **Check Environment** — Click the button in the sidebar footer to verify Python + RadarSimPy are available
2. **Configure Transmitter** — Set waveform type, frequency, bandwidth, power, pulses, and TX channels
3. **Configure Receiver** — Set sampling rate, noise figure, gains, and RX channels
4. **Configure Radar** — Set platform position, velocity, and rotation
5. **Add Targets** — Add point targets (location, RCS, speed) or mesh targets (3D models)
6. **Run Simulation** — Configure simulation settings and click Run
7. **View Results** — Range-Doppler map, range profile, and baseband signal plots
8. **Export** — Save results to JSON for further analysis
