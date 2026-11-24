// ===== RadarSimApp - Configuration Collection =====
// Reads the whole form into the configuration the bridge simulates from,
// converting the units the fields are shown in to SI.

import { readChannel, type Side } from "./channels.js";
import { meshTargets, pointTargets, rxChannels, txChannels } from "./shared.js";
import { readMeshMotion, readPointTarget } from "./targets.js";
import { fieldChecked, fieldNumber, fieldValue, fieldVector, XYZ, YPR } from "./utils.js";

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

/**
 * A channel's fields as the bridge takes them: an empty pattern cut is left
 * for the library's default, and a zero delay left out.
 */
function _channelConfig(side: Side, i: number): TxChannelConfig {
  const { azimuth_angle, azimuth_pattern, elevation_angle, elevation_pattern, delay, ...ch } = readChannel(side, i);
  const out: TxChannelConfig = ch;
  if (azimuth_angle?.length) out.azimuth_angle = azimuth_angle;
  if (azimuth_pattern?.length) out.azimuth_pattern = azimuth_pattern;
  if (elevation_angle?.length) out.elevation_angle = elevation_angle;
  if (elevation_pattern?.length) out.elevation_pattern = elevation_pattern;
  if (delay) out.delay = delay;
  return out;
}

/** The channels of one side, or a single default channel when there are none. */
function _channelConfigs(side: Side, count: number): TxChannelConfig[] {
  return count > 0 ? Array.from({ length: count }, (_, i) => _channelConfig(side, i)) : [{}];
}

/** An FFT size, when its override is ticked and holds a number; null leaves the size to the bridge. */
function _fftOverride(id: string): number | null {
  return fieldChecked(`${id}-enable`) ? parseInt(fieldValue(id) ?? "", 10) || null : null;
}

export function collectConfig(): CollectedConfig {
  const targets: CollectedConfig["targets"] = pointTargets.map((_, i) => readPointTarget(i));
  meshTargets.forEach((_, i) => {
    const model = fieldValue(`mesh-${i}-model`) || "";
    if (!model) return;
    const mt: CollectedMeshTarget = {
      model,
      ...readMeshMotion(i),
      unit: fieldValue(`mesh-${i}-unit`) || "m",
    };
    const perm = fieldValue(`mesh-${i}-perm`);
    if (perm?.trim()) mt.permittivity = parseFloat(perm);
    targets.push(mt);
  });

  const rdEnabled = fieldChecked("proc-range-doppler");
  const rdRangeFft = _fftOverride("proc-rd-range-fft");

  return {
    transmitter: {
      f: [fieldNumber("tx-f-start") * 1e9, fieldNumber("tx-f-end") * 1e9],
      t: [fieldNumber("tx-t-start") * 1e-6, fieldNumber("tx-t-end") * 1e-6],
      tx_power: fieldNumber("tx-power"),
      pulses: parseInt(fieldValue("tx-pulses") ?? "", 10) || 1,
      prp: fieldNumber("tx-prp") * 1e-6,
      channels: _channelConfigs("tx", txChannels.length),
    },
    receiver: {
      fs: fieldNumber("rx-fs") * 1e6,
      noise_figure: fieldNumber("rx-nf"),
      rf_gain: fieldNumber("rx-rf-gain"),
      baseband_gain: fieldNumber("rx-bb-gain"),
      load_resistor: fieldNumber("rx-load-r"),
      bb_type: fieldValue("rx-bb-type") ?? "",
      gate_delay: fieldNumber("rx-gate-delay") * 1e-9,
      channels: _channelConfigs("rx", rxChannels.length),
    },
    radar: {
      location: fieldVector("radar-loc", XYZ),
      speed: fieldVector("radar-spd", XYZ),
      rotation: fieldVector("radar-rot", YPR),
      rotation_rate: fieldVector("radar-rr", YPR),
    },
    targets,
    simulation: {
      density: fieldNumber("sim-density", 1),
      level: fieldValue("sim-level") || null,
    },
    processing: {
      range_doppler: rdEnabled,
      rd_range_fft: rdRangeFft,
      rd_doppler_fft: _fftOverride("proc-rd-doppler-fft"),
      // Range-Doppler brings the range profile with it, as the checkboxes do
      range_profile: fieldChecked("proc-range-profile") || rdEnabled,
      rp_range_fft: rdRangeFft,
      noise: fieldChecked("proc-noise"),
    },
  };
}
