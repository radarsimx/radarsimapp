// ===== RadarSimApp - Types shared by the main process and renderer =====
//
// A global declaration file, included by both tsconfig.json (main process) and
// tsconfig.renderer.json, so the configuration the renderer collects and the
// result and scene it draws are the same types the bridge takes and returns.

/** A complex value as the fields hold it ("1+2j", "-j") or a plain real. */
type ComplexInput = string | number;

interface AntennaChannelConfig {
  /** Position on the platform (m). */
  location?: number[];
  /** Polarization vector [x, y, z]. */
  polarization?: ComplexInput[];
  /** Azimuth cut: angles (deg) and gains (dB) at them. */
  azimuth_angle?: number[];
  azimuth_pattern?: number[];
  /** Elevation cut: angles (deg) and gains (dB) at them. */
  elevation_angle?: number[];
  elevation_pattern?: number[];
}

interface TxChannelConfig extends AntennaChannelConfig {
  /** Channel delay (s). */
  delay?: number;
  /** Pulse-by-pulse amplitude and phase (deg) modulation. */
  pulse_amp?: number[];
  pulse_phs?: number[];
  /** Intra-pulse modulation: times (s) with amplitude and phase (deg) at them. */
  mod_t?: number[];
  amp?: number[];
  phs?: number[];
}

type RxChannelConfig = AntennaChannelConfig;

interface TransmitterConfig {
  /** Frequency (Hz) at each of `t`. */
  f?: number | number[];
  /** Time (s) of each frequency point. */
  t?: number | number[];
  /** dBm */
  tx_power?: number;
  pulses?: number;
  /** Pulse repetition period (s): one for all pulses, or one per pulse. */
  prp?: number | number[];
  /** Frequency offset of each pulse (Hz). */
  f_offset?: number[];
  /** Phase-noise spectrum: offset frequencies (Hz) and power (dBc/Hz). */
  pn_f?: number[];
  pn_power?: number[];
  pn_fs?: number;
  pn_num_samples?: number;
  pn_seed?: number;
  pn_validation?: boolean;
  channels?: TxChannelConfig[];
}

interface ReceiverConfig {
  /** Sampling rate (Hz). */
  fs?: number;
  /** dB */
  noise_figure?: number;
  /** dB */
  rf_gain?: number;
  /** dB */
  baseband_gain?: number;
  /** Ohm */
  load_resistor?: number;
  /** "complex" or "real". */
  bb_type?: string;
  /** Range-gate / deramp reference delay (s). */
  gate_delay?: number;
  channels?: RxChannelConfig[];
}

interface PlatformConfig {
  /** m */
  location?: number[];
  /** m/s */
  speed?: number[];
  /** Yaw, pitch, roll (deg). */
  rotation?: number[];
  /** deg/s */
  rotation_rate?: number[];
}

interface PointTargetConfig {
  /** Absent: what tells a point target from a mesh one. */
  model?: undefined;
  location?: number[];
  speed?: number[];
  /** dBsm */
  rcs?: number;
  /** deg */
  phase?: number;
}

interface MeshTargetConfig extends PlatformConfig {
  /** Path of the model file: .stl (ASCII or binary), .obj or .ply. */
  model: string;
  /** Unit the model is drawn in: "m", "cm", "mm" or "in". */
  unit?: string;
  origin?: number[];
  /** Relative permittivity, or "PEC" (the default) for a perfect conductor. */
  permittivity?: ComplexInput;
  skip_diffusion?: boolean;
  density?: number;
  environment?: boolean;
}

type TargetConfig = PointTargetConfig | MeshTargetConfig;

interface SimulationConfig {
  /** Ray density. */
  density?: number;
  /** "frame", "pulse" or "sample". */
  level?: string | null;
  ray_filter?: number[];
}

interface ProcessingConfig {
  range_doppler?: boolean;
  rd_range_fft?: number | null;
  rd_doppler_fft?: number | null;
  range_profile?: boolean;
  rp_range_fft?: number | null;
  noise?: boolean;
}

/** Everything a simulation or a scene query is run from. */
interface SimConfig {
  transmitter?: TransmitterConfig;
  receiver?: ReceiverConfig;
  radar?: PlatformConfig;
  targets?: TargetConfig[];
  simulation?: SimulationConfig;
  processing?: ProcessingConfig;
  /** Scene time a scene query is made at (s). */
  timestamp?: number;
}

/** One channel's samples in one pulse. */
interface ComplexSamples {
  re: number[];
  im: number[];
}

/** What a simulation returns. */
interface SimResult {
  /** [samples per pulse, pulses, channels] */
  baseband_shape: number[];
  /** [pulse][channel] */
  baseband: ComplexSamples[][];
  bb_type: string;
  range_axis: number[];
  velocity_axis?: number[];
  /** Magnitude (dB), [Doppler bin][channel][range bin]. */
  range_doppler?: number[][][];
  rd_range_fft_size?: number;
  rd_doppler_fft_size?: number;
  rd_range_axis?: number[];
  rd_doppler_axis?: number[];
  /** Magnitude (dB), [pulse][channel][range bin]. */
  range_profile?: number[][][];
  rp_range_fft_size?: number;
  rp_range_axis?: number[];
}

/** The library build and its license. */
interface LibraryInfo {
  radarsimlib_version: string;
  licensed: boolean;
  license_info: Record<string, string>;
}

/** One mesh target as the library places it, packed for the scene view. */
interface SceneMesh {
  /** Index into the mesh-target list (point targets are not counted). */
  index: number;
  /** Triangles in the source mesh. */
  totalCells: number;
  /** Triangles actually returned (< totalCells when strided). */
  cells: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  i: Int32Array;
  j: Int32Array;
  k: Int32Array;
  /** Axis-aligned bounds of the returned vertices: [minX, minY, minZ, maxX, maxY, maxZ]. */
  bounds: number[];
}

/** Where the library puts the radar and the mesh targets at one instant. */
interface SceneState {
  timestamp: number;
  /** Global Tx channel locations, [numTx][3] flattened (m). */
  txLocations: Float32Array | null;
  /** Global Rx channel locations, [numRx][3] flattened (m). */
  rxLocations: Float32Array | null;
  /** Global radar boresight unit vector. */
  boresight: Float32Array | null;
  meshes: SceneMesh[];
  /** Non-fatal problems — the caller falls back for whatever is missing. */
  warnings: string[];
}
