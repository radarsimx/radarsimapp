// ===== RadarSimApp - Derived Waveform Readout =====

const SPEED_OF_LIGHT = 299792458;

/** Waveform and sampling parameters, in SI units (Hz, s). */
export interface ReadoutInput {
  fStart: number;
  fEnd: number;
  tStart: number;
  tEnd: number;
  prp: number;
  pulses: number;
  fs: number;
}

/** What the waveform resolves, in SI units. NaN where it is undefined. */
export interface Readout {
  bandwidth: number;
  pulseLength: number;
  samplesPerPulse: number;
  /** c / 2B */
  rangeResolution: number;
  /** Unambiguous velocity, +/- lambda / (4 PRP) */
  maxVelocity: number;
  /** lambda / (2 N PRP) */
  velocityResolution: number;
}

export function deriveReadout(input: ReadoutInput): Readout {
  const bandwidth = Math.abs(input.fEnd - input.fStart);
  const pulseLength = Math.abs(input.tEnd - input.tStart);
  const centre = (input.fStart + input.fEnd) / 2;
  const wavelength = centre > 0 ? SPEED_OF_LIGHT / centre : NaN;
  const frame = input.pulses > 0 ? input.pulses * input.prp : NaN;
  return {
    bandwidth,
    pulseLength,
    // Rounded first, so 80 us at 2 MHz is 160 samples and not 161 off a
    // floating point product a hair over.
    samplesPerPulse: Math.ceil(Number((pulseLength * input.fs).toPrecision(12))) || 1,
    rangeResolution: bandwidth > 0 ? SPEED_OF_LIGHT / (2 * bandwidth) : NaN,
    maxVelocity: input.prp > 0 ? wavelength / (4 * input.prp) : NaN,
    velocityResolution: frame > 0 ? wavelength / (2 * frame) : NaN,
  };
}

/** A length with the unit that keeps it readable: m, cm or mm. */
export function formatLength(metres: number): string {
  if (!isFinite(metres)) return "—";
  if (metres >= 1) return `${Number(metres.toPrecision(3))} m`;
  if (metres >= 0.01) return `${Number((metres * 100).toPrecision(3))} cm`;
  return `${Number((metres * 1000).toPrecision(3))} mm`;
}

export function formatSpeed(metresPerSecond: number): string {
  return isFinite(metresPerSecond) ? `${Number(metresPerSecond.toPrecision(3))} m/s` : "—";
}

function _field(id: string): number {
  return parseFloat((document.getElementById(id) as HTMLInputElement | null)?.value ?? "") || 0;
}

function _show(id: string, text: string): void {
  const elem = document.getElementById(id);
  if (elem) elem.textContent = text;
}

/** Refresh the readout tiles from the transmitter and receiver fields. */
export function updateReadout(): void {
  const fStart = _field("tx-f-start"), fEnd = _field("tx-f-end");
  const tStart = _field("tx-t-start"), tEnd = _field("tx-t-end");

  (document.getElementById("tx-bandwidth") as HTMLInputElement).value = ((fEnd - fStart) * 1000).toFixed(1);
  (document.getElementById("tx-pulse-length") as HTMLInputElement).value = (tEnd - tStart).toFixed(1);

  const r = deriveReadout({
    fStart: fStart * 1e9, fEnd: fEnd * 1e9,
    tStart: tStart * 1e-6, tEnd: tEnd * 1e-6,
    prp: _field("tx-prp") * 1e-6,
    pulses: Math.floor(_field("tx-pulses")),
    fs: _field("rx-fs") * 1e6,
  });
  _show("ro-samples", String(r.samplesPerPulse));
  _show("ro-range-res", formatLength(r.rangeResolution));
  _show("ro-v-max", isFinite(r.maxVelocity) ? `±${formatSpeed(r.maxVelocity)}` : "—");
  _show("ro-v-res", formatSpeed(r.velocityResolution));
}
