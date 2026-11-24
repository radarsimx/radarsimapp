// ===== RadarSimApp - Configuration Collection =====

import { meshTargets, pointTargets, rxChannels, txChannels } from "./shared.js";
import { parseCSV, parseNumber } from "./utils.js";

/** A point target as the fields give it: every value is filled in. */
export interface CollectedPointTarget extends PointTargetConfig {
  location: number[];
  rcs: number;
  speed: number[];
  phase: number;
}

/** A mesh target as the fields give it: only the permittivity may be left out. */
export interface CollectedMeshTarget extends MeshTargetConfig {
  location: number[];
  speed: number[];
  rotation: number[];
  rotation_rate: number[];
  unit: string;
}

/** A configuration as the fields give it: every section and value is there. */
export interface CollectedConfig extends SimConfig {
  transmitter: TransmitterConfig & {
    f: number[];
    t: number[];
    tx_power: number;
    pulses: number;
    prp: number;
    channels: TxChannelConfig[];
  };
  receiver: Required<ReceiverConfig>;
  radar: Required<PlatformConfig>;
  targets: (CollectedPointTarget | CollectedMeshTarget)[];
  simulation: Required<Pick<SimulationConfig, "density" | "level">>;
  processing: Required<ProcessingConfig>;
}

export function collectConfig(): CollectedConfig {
  // TX
  const fStart = parseNumber((document.getElementById("tx-f-start") as HTMLInputElement).value) * 1e9;
  const fEnd = parseNumber((document.getElementById("tx-f-end") as HTMLInputElement).value) * 1e9;
  const tStart = parseNumber((document.getElementById("tx-t-start") as HTMLInputElement).value) * 1e-6;
  const tEnd = parseNumber((document.getElementById("tx-t-end") as HTMLInputElement).value) * 1e-6;

  const f = [fStart, fEnd];
  const t = [tStart, tEnd];

  // TX Channels
  const txChannelConfigs = txChannels.map((_: ChannelData, i: number) => {
    const ch: TxChannelConfig = {};
    ch.location = [
      parseNumber((document.getElementById(`tx-ch-${i}-loc-x`) as HTMLInputElement | null)?.value) * 1e-3,
      parseNumber((document.getElementById(`tx-ch-${i}-loc-y`) as HTMLInputElement | null)?.value) * 1e-3,
      parseNumber((document.getElementById(`tx-ch-${i}-loc-z`) as HTMLInputElement | null)?.value) * 1e-3,
    ];
    ch.polarization = [
      (document.getElementById(`tx-ch-${i}-pol-x`) as HTMLInputElement | null)?.value || "0",
      (document.getElementById(`tx-ch-${i}-pol-y`) as HTMLInputElement | null)?.value || "0",
      (document.getElementById(`tx-ch-${i}-pol-z`) as HTMLInputElement | null)?.value || "1",
    ];
    const azAngles = parseCSV(
      (document.getElementById(`tx-ch-${i}-az-angles`) as HTMLTextAreaElement | null)?.value || "",
    );
    const azPattern = parseCSV(
      (document.getElementById(`tx-ch-${i}-az-pattern`) as HTMLTextAreaElement | null)?.value || "",
    );
    if (azAngles.length > 0) ch.azimuth_angle = azAngles;
    if (azPattern.length > 0) ch.azimuth_pattern = azPattern;
    const elAngles = parseCSV(
      (document.getElementById(`tx-ch-${i}-el-angles`) as HTMLTextAreaElement | null)?.value || "",
    );
    const elPattern = parseCSV(
      (document.getElementById(`tx-ch-${i}-el-pattern`) as HTMLTextAreaElement | null)?.value || "",
    );
    if (elAngles.length > 0) ch.elevation_angle = elAngles;
    if (elPattern.length > 0) ch.elevation_pattern = elPattern;
    const delay = parseNumber((document.getElementById(`tx-ch-${i}-delay`) as HTMLInputElement | null)?.value) * 1e-9;
    if (delay !== 0) ch.delay = delay;
    return ch;
  });

  const txConfig: CollectedConfig["transmitter"] = {
    f,
    t,
    tx_power: parseNumber((document.getElementById("tx-power") as HTMLInputElement).value),
    pulses: parseInt((document.getElementById("tx-pulses") as HTMLInputElement).value, 10) || 1,
    prp: parseNumber((document.getElementById("tx-prp") as HTMLInputElement).value) * 1e-6,
    channels: txChannelConfigs.length > 0 ? txChannelConfigs : [{}],
  };

  // RX Channels
  const rxChannelConfigs = rxChannels.map((_: ChannelData, i: number) => {
    const ch: RxChannelConfig = {};
    ch.location = [
      parseNumber((document.getElementById(`rx-ch-${i}-loc-x`) as HTMLInputElement | null)?.value) * 1e-3,
      parseNumber((document.getElementById(`rx-ch-${i}-loc-y`) as HTMLInputElement | null)?.value) * 1e-3,
      parseNumber((document.getElementById(`rx-ch-${i}-loc-z`) as HTMLInputElement | null)?.value) * 1e-3,
    ];
    ch.polarization = [
      (document.getElementById(`rx-ch-${i}-pol-x`) as HTMLInputElement | null)?.value || "0",
      (document.getElementById(`rx-ch-${i}-pol-y`) as HTMLInputElement | null)?.value || "0",
      (document.getElementById(`rx-ch-${i}-pol-z`) as HTMLInputElement | null)?.value || "1",
    ];
    const azAngles = parseCSV(
      (document.getElementById(`rx-ch-${i}-az-angles`) as HTMLTextAreaElement | null)?.value || "",
    );
    const azPattern = parseCSV(
      (document.getElementById(`rx-ch-${i}-az-pattern`) as HTMLTextAreaElement | null)?.value || "",
    );
    if (azAngles.length > 0) ch.azimuth_angle = azAngles;
    if (azPattern.length > 0) ch.azimuth_pattern = azPattern;
    const elAngles = parseCSV(
      (document.getElementById(`rx-ch-${i}-el-angles`) as HTMLTextAreaElement | null)?.value || "",
    );
    const elPattern = parseCSV(
      (document.getElementById(`rx-ch-${i}-el-pattern`) as HTMLTextAreaElement | null)?.value || "",
    );
    if (elAngles.length > 0) ch.elevation_angle = elAngles;
    if (elPattern.length > 0) ch.elevation_pattern = elPattern;
    return ch;
  });

  // RX
  const rxConfig: CollectedConfig["receiver"] = {
    fs: parseNumber((document.getElementById("rx-fs") as HTMLInputElement).value) * 1e6,
    noise_figure: parseNumber((document.getElementById("rx-nf") as HTMLInputElement).value),
    rf_gain: parseNumber((document.getElementById("rx-rf-gain") as HTMLInputElement).value),
    baseband_gain: parseNumber((document.getElementById("rx-bb-gain") as HTMLInputElement).value),
    load_resistor: parseNumber((document.getElementById("rx-load-r") as HTMLInputElement).value),
    bb_type: (document.getElementById("rx-bb-type") as HTMLSelectElement).value,
    gate_delay: parseNumber((document.getElementById("rx-gate-delay") as HTMLInputElement).value) * 1e-9,
    channels: rxChannelConfigs.length > 0 ? rxChannelConfigs : [{}],
  };

  // Radar
  const radarConfig = {
    location: [
      parseNumber((document.getElementById("radar-loc-x") as HTMLInputElement).value),
      parseNumber((document.getElementById("radar-loc-y") as HTMLInputElement).value),
      parseNumber((document.getElementById("radar-loc-z") as HTMLInputElement).value),
    ],
    speed: [
      parseNumber((document.getElementById("radar-spd-x") as HTMLInputElement).value),
      parseNumber((document.getElementById("radar-spd-y") as HTMLInputElement).value),
      parseNumber((document.getElementById("radar-spd-z") as HTMLInputElement).value),
    ],
    rotation: [
      parseNumber((document.getElementById("radar-rot-yaw") as HTMLInputElement).value),
      parseNumber((document.getElementById("radar-rot-pitch") as HTMLInputElement).value),
      parseNumber((document.getElementById("radar-rot-roll") as HTMLInputElement).value),
    ],
    rotation_rate: [
      parseNumber((document.getElementById("radar-rr-yaw") as HTMLInputElement).value),
      parseNumber((document.getElementById("radar-rr-pitch") as HTMLInputElement).value),
      parseNumber((document.getElementById("radar-rr-roll") as HTMLInputElement).value),
    ],
  };

  // Targets
  const targets: CollectedConfig["targets"] = [];

  pointTargets.forEach((_: PointTargetData, i: number) => {
    targets.push({
      location: [
        parseNumber((document.getElementById(`pt-${i}-loc-x`) as HTMLInputElement | null)?.value, 10),
        parseNumber((document.getElementById(`pt-${i}-loc-y`) as HTMLInputElement | null)?.value),
        parseNumber((document.getElementById(`pt-${i}-loc-z`) as HTMLInputElement | null)?.value),
      ],
      rcs: parseNumber((document.getElementById(`pt-${i}-rcs`) as HTMLInputElement | null)?.value, 20),
      speed: [
        parseNumber((document.getElementById(`pt-${i}-spd-x`) as HTMLInputElement | null)?.value),
        parseNumber((document.getElementById(`pt-${i}-spd-y`) as HTMLInputElement | null)?.value),
        parseNumber((document.getElementById(`pt-${i}-spd-z`) as HTMLInputElement | null)?.value),
      ],
      phase: parseNumber((document.getElementById(`pt-${i}-phase`) as HTMLInputElement | null)?.value),
    });
  });

  meshTargets.forEach((_: MeshTargetData, i: number) => {
    const model = (document.getElementById(`mesh-${i}-model`) as HTMLInputElement | null)?.value || "";
    if (!model) return;
    const location = [
      parseNumber((document.getElementById(`mesh-${i}-loc-x`) as HTMLInputElement | null)?.value),
      parseNumber((document.getElementById(`mesh-${i}-loc-y`) as HTMLInputElement | null)?.value),
      parseNumber((document.getElementById(`mesh-${i}-loc-z`) as HTMLInputElement | null)?.value),
    ];
    const speed = [
      parseNumber((document.getElementById(`mesh-${i}-spd-x`) as HTMLInputElement | null)?.value),
      parseNumber((document.getElementById(`mesh-${i}-spd-y`) as HTMLInputElement | null)?.value),
      parseNumber((document.getElementById(`mesh-${i}-spd-z`) as HTMLInputElement | null)?.value),
    ];
    const rotation = [
      parseNumber((document.getElementById(`mesh-${i}-rot-yaw`) as HTMLInputElement | null)?.value),
      parseNumber((document.getElementById(`mesh-${i}-rot-pitch`) as HTMLInputElement | null)?.value),
      parseNumber((document.getElementById(`mesh-${i}-rot-roll`) as HTMLInputElement | null)?.value),
    ];
    const rotation_rate = [
      parseNumber((document.getElementById(`mesh-${i}-rr-yaw`) as HTMLInputElement | null)?.value),
      parseNumber((document.getElementById(`mesh-${i}-rr-pitch`) as HTMLInputElement | null)?.value),
      parseNumber((document.getElementById(`mesh-${i}-rr-roll`) as HTMLInputElement | null)?.value),
    ];
    const unit = (document.getElementById(`mesh-${i}-unit`) as HTMLSelectElement | null)?.value || "m";
    const mt: CollectedMeshTarget = { model, location, speed, rotation, rotation_rate, unit };
    const perm = (document.getElementById(`mesh-${i}-perm`) as HTMLInputElement | null)?.value;
    if (perm?.trim()) mt.permittivity = parseFloat(perm);
    targets.push(mt);
  });

  // Simulation
  const simConfig = {
    density: parseNumber((document.getElementById("sim-density") as HTMLInputElement).value, 1),
    level: (document.getElementById("sim-level") as HTMLSelectElement).value || null,
  };

  // Processing
  const rdRangeFftEnabled = (document.getElementById("proc-rd-range-fft-enable") as HTMLInputElement).checked;
  const rdDopplerFftEnabled = (document.getElementById("proc-rd-doppler-fft-enable") as HTMLInputElement).checked;
  const rdRangeFft = rdRangeFftEnabled
    ? parseInt((document.getElementById("proc-rd-range-fft") as HTMLInputElement).value, 10) || null
    : null;
  const rdDopplerFft = rdDopplerFftEnabled
    ? parseInt((document.getElementById("proc-rd-doppler-fft") as HTMLInputElement).value, 10) || null
    : null;
  const rdEnabled = (document.getElementById("proc-range-doppler") as HTMLInputElement).checked;
  const processing = {
    range_doppler: rdEnabled,
    rd_range_fft: rdRangeFft,
    rd_doppler_fft: rdDopplerFft,
    range_profile: (document.getElementById("proc-range-profile") as HTMLInputElement).checked || rdEnabled,
    rp_range_fft: rdRangeFft,
    noise: (document.getElementById("proc-noise") as HTMLInputElement).checked,
  };

  return {
    transmitter: txConfig,
    receiver: rxConfig,
    radar: radarConfig,
    targets,
    simulation: simConfig,
    processing,
  };
}
