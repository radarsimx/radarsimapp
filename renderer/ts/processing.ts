// ===== RadarSimApp - Processing Options =====
// The Simulation panel's processing checkboxes and FFT sizes. Range-Doppler
// brings the range profile with it, and an FFT size left to the app follows
// the waveform: the next power of two up from the samples or pulses it covers.

import { samplesPerPulse } from "./readout.js";
import { byId, fieldNumber } from "./utils.js";

const RANGE_FFT = "proc-rd-range-fft";
const DOPPLER_FFT = "proc-rd-doppler-fft";

function _checkbox(id: string): HTMLInputElement {
  return byId<HTMLInputElement>(id);
}

function _nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function _isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** What each FFT has to cover: the samples in a pulse, and the pulses in a frame. */
function _fftMinimums(): Record<string, number> {
  return {
    [RANGE_FFT]: samplesPerPulse(
      (fieldNumber("tx-t-end") - fieldNumber("tx-t-start")) * 1e-6,
      (fieldNumber("rx-fs") || 2) * 1e6,
    ),
    [DOPPLER_FFT]: Math.floor(fieldNumber("tx-pulses")) || 1,
  };
}

/** Show (or clear, with an empty message) the error under an FFT size. */
function _setFftError(input: HTMLInputElement, msg: string): void {
  input.classList.toggle("is-invalid", !!msg);
  const wrap = input.closest(".proc-sub-input-wrap");
  if (msg) wrap?.setAttribute("data-error", msg);
  else wrap?.removeAttribute("data-error");
}

function _validateFftInput(input: HTMLInputElement, minVal: number, label: string): void {
  const val = parseInt(input.value, 10);
  let msg = "";
  if (!_isPow2(val)) msg = `${label} must be a power of 2`;
  else if (val < minVal) msg = `${label} must be ≥ ${minVal} (next: ${_nextPow2(minVal)})`;
  _setFftError(input, msg);
}

/** Check the FFT sizes set by hand against the waveform; marks the ones that will not do. */
function _validateFftInputs(): void {
  const min = _fftMinimums();
  if (_checkbox(`${RANGE_FFT}-enable`).checked) _validateFftInput(byId(RANGE_FFT), min[RANGE_FFT], "Range FFT");
  if (_checkbox(`${DOPPLER_FFT}-enable`).checked) _validateFftInput(byId(DOPPLER_FFT), min[DOPPLER_FFT], "Doppler FFT");
}

/** Fill in the FFT sizes left to the app. */
function _updateAutoFftValues(): void {
  const min = _fftMinimums();
  for (const id of [RANGE_FFT, DOPPLER_FFT]) {
    if (!_checkbox(`${id}-enable`).checked) byId<HTMLInputElement>(id).value = String(_nextPow2(min[id]));
  }
}

/** Grey out the options of an unticked output, and hand its FFT size back to the app. */
function _syncSubOptions(): void {
  const outputs: [string, string, string][] = [
    ["proc-range-profile", "proc-range-profile-opts", RANGE_FFT],
    ["proc-range-doppler", "proc-range-doppler-opts", DOPPLER_FFT],
  ];
  for (const [checkbox, opts, fft] of outputs) {
    const on = _checkbox(checkbox).checked;
    byId(opts).classList.toggle("disabled", !on);
    if (on) continue;
    _checkbox(`${fft}-enable`).checked = false;
    const input = byId<HTMLInputElement>(fft);
    input.disabled = true;
    _setFftError(input, "");
  }
  _updateAutoFftValues();
}

// Bring the options in line with their checkboxes: at startup, and after a
// configuration is applied, which sets the fields without events.
function _syncProcessing(): void {
  if (_checkbox("proc-range-doppler").checked) _checkbox("proc-range-profile").checked = true;
  _syncSubOptions();
  for (const id of [RANGE_FFT, DOPPLER_FFT]) {
    byId<HTMLInputElement>(id).disabled = !_checkbox(`${id}-enable`).checked;
  }
}

/** Validate the FFT sizes before a run; false (with the errors shown) when one will not do. */
export function processingIsValid(): boolean {
  _validateFftInputs();
  return !document.querySelector("#proc-range-profile-opts .is-invalid, #proc-range-doppler-opts .is-invalid");
}

export function initProcessing(): void {
  // Range-Doppler on brings the range profile on; the range profile off takes range-Doppler with it
  _checkbox("proc-range-doppler").addEventListener("change", (e) => {
    if ((e.target as HTMLInputElement).checked) _checkbox("proc-range-profile").checked = true;
    _syncSubOptions();
  });
  _checkbox("proc-range-profile").addEventListener("change", (e) => {
    if (!(e.target as HTMLInputElement).checked) _checkbox("proc-range-doppler").checked = false;
    _syncSubOptions();
  });

  // An FFT size is typed in only while its override is ticked
  for (const id of [RANGE_FFT, DOPPLER_FFT]) {
    const enable = _checkbox(`${id}-enable`);
    const input = byId<HTMLInputElement>(id);
    enable.addEventListener("change", () => {
      input.disabled = !enable.checked;
      if (enable.checked) {
        _validateFftInputs();
      } else {
        _setFftError(input, "");
        _updateAutoFftValues();
      }
    });
    input.addEventListener("input", _validateFftInputs);
  }

  // The sizes left to the app follow the waveform
  for (const id of ["tx-t-start", "tx-t-end", "rx-fs", "tx-pulses"]) {
    document.getElementById(id)?.addEventListener("input", _updateAutoFftValues);
  }

  _syncProcessing();
  document.addEventListener("configapplied", _syncProcessing);
}
