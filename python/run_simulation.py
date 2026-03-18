"""Run a radar baseband simulation using radarsimpy."""
import json
import sys
import numpy as np

from radarsimpy import Radar, Transmitter, Receiver
from radarsimpy.simulator import sim_radar  # type: ignore


def build_transmitter(tx_cfg):
    """Build a Transmitter from a config dict."""
    f = tx_cfg.get("f", [24e9, 24.5e9])
    t = tx_cfg.get("t", [0, 80e-6])

    if isinstance(f, list) and len(f) > 0 and isinstance(f[0], list):
        f = np.array(f)
    if isinstance(t, list) and len(t) > 0 and isinstance(t[0], list):
        t = np.array(t)

    channels = []
    for ch in tx_cfg.get("channels", [{}]):
        channel = {}
        if "location" in ch:
            channel["location"] = tuple(ch["location"])
        if "polarization" in ch:
            channel["polarization"] = ch["polarization"]
        if "delay" in ch:
            channel["delay"] = ch["delay"]
        if "azimuth_angle" in ch:
            channel["azimuth_angle"] = np.array(ch["azimuth_angle"])
        if "azimuth_pattern" in ch:
            channel["azimuth_pattern"] = np.array(ch["azimuth_pattern"])
        if "elevation_angle" in ch:
            channel["elevation_angle"] = np.array(ch["elevation_angle"])
        if "elevation_pattern" in ch:
            channel["elevation_pattern"] = np.array(ch["elevation_pattern"])
        if "grid" in ch:
            channel["grid"] = ch["grid"]
        if "pulse_amp" in ch:
            channel["pulse_amp"] = np.array(ch["pulse_amp"])
        if "pulse_phs" in ch:
            channel["pulse_phs"] = np.array(ch["pulse_phs"])
        channels.append(channel)

    kwargs = {
        "f": f,
        "t": t,
        "tx_power": tx_cfg.get("tx_power", 0),
        "pulses": tx_cfg.get("pulses", 1),
    }
    if tx_cfg.get("prp") is not None:
        kwargs["prp"] = tx_cfg["prp"]
    if tx_cfg.get("f_offset") is not None:
        kwargs["f_offset"] = np.array(tx_cfg["f_offset"])
    if tx_cfg.get("pn_f") is not None and tx_cfg.get("pn_power") is not None:
        kwargs["pn_f"] = np.array(tx_cfg["pn_f"])
        kwargs["pn_power"] = np.array(tx_cfg["pn_power"])
    kwargs["channels"] = channels if channels else [{}]

    return Transmitter(**kwargs)


def build_receiver(rx_cfg):
    """Build a Receiver from a config dict."""
    channels = []
    for ch in rx_cfg.get("channels", [{}]):
        channel = {}
        if "location" in ch:
            channel["location"] = tuple(ch["location"])
        if "polarization" in ch:
            channel["polarization"] = ch["polarization"]
        if "azimuth_angle" in ch:
            channel["azimuth_angle"] = np.array(ch["azimuth_angle"])
        if "azimuth_pattern" in ch:
            channel["azimuth_pattern"] = np.array(ch["azimuth_pattern"])
        if "elevation_angle" in ch:
            channel["elevation_angle"] = np.array(ch["elevation_angle"])
        if "elevation_pattern" in ch:
            channel["elevation_pattern"] = np.array(ch["elevation_pattern"])
        channels.append(channel)

    return Receiver(
        fs=rx_cfg.get("fs", 2e6),
        noise_figure=rx_cfg.get("noise_figure", 10),
        rf_gain=rx_cfg.get("rf_gain", 0),
        load_resistor=rx_cfg.get("load_resistor", 500),
        baseband_gain=rx_cfg.get("baseband_gain", 0),
        bb_type=rx_cfg.get("bb_type", "complex"),
        channels=channels if channels else [{}],
    )


def build_radar(cfg):
    """Build a Radar from a config dict."""
    tx = build_transmitter(cfg.get("transmitter", {}))
    rx = build_receiver(cfg.get("receiver", {}))
    radar_cfg = cfg.get("radar", {})
    return Radar(
        transmitter=tx,
        receiver=rx,
        location=radar_cfg.get("location", [0, 0, 0]),
        speed=radar_cfg.get("speed", [0, 0, 0]),
        rotation=radar_cfg.get("rotation", [0, 0, 0]),
        rotation_rate=radar_cfg.get("rotation_rate", [0, 0, 0]),
    )


def build_targets(targets_cfg):
    """Build a list of target dicts for sim_radar."""
    targets = []
    for t in targets_cfg:
        target = {}
        if "location" in t:
            target["location"] = tuple(t["location"])
        if "rcs" in t:
            target["rcs"] = t["rcs"]
        if "speed" in t:
            target["speed"] = tuple(t["speed"])
        if "phase" in t:
            target["phase"] = t["phase"]
        if "model" in t:
            target["model"] = t["model"]
        if "permittivity" in t:
            target["permittivity"] = complex(t["permittivity"])
        if "unit" in t:
            target["unit"] = t["unit"]
        if "origin" in t:
            target["origin"] = tuple(t["origin"])
        if "rotation" in t:
            target["rotation"] = tuple(t["rotation"])
        if "rotation_rate" in t:
            target["rotation_rate"] = tuple(t["rotation_rate"])
        targets.append(target)
    return targets


def run(config):
    """Run radar simulation and return serializable results."""
    radar = build_radar(config)
    targets = build_targets(config.get("targets", []))

    sim_cfg = config.get("simulation", {})
    result = sim_radar(
        radar,
        targets,
        density=sim_cfg.get("density", 1),
        level=sim_cfg.get("level", None),
        device=sim_cfg.get("device", "cpu"),
    )

    baseband = result["baseband"]
    timestamp = result["timestamp"]

    # Process range-Doppler if applicable
    from radarsimpy.processing import range_fft, doppler_fft, range_doppler_fft

    proc = config.get("processing", {})
    output = {
        "baseband_shape": list(baseband.shape),
        "timestamp_shape": list(timestamp.shape),
    }

    if proc.get("range_doppler", True) and baseband.ndim == 3:
        rd = range_doppler_fft(baseband)
        rd_mag = 20 * np.log10(np.abs(rd) + 1e-12)
        output["range_doppler"] = rd_mag.tolist()

    if proc.get("range_profile", False) and baseband.ndim == 3:
        rp = range_fft(baseband)
        rp_mag = 20 * np.log10(np.abs(rp) + 1e-12)
        output["range_profile"] = rp_mag.tolist()

    # Also send raw baseband magnitude for a simple plot
    bb_mag = 20 * np.log10(np.abs(baseband) + 1e-12)
    output["baseband"] = bb_mag.tolist()

    # Compute axis info
    tx_cfg = config.get("transmitter", {})
    rx_cfg = config.get("receiver", {})
    f = tx_cfg.get("f", [24e9, 24.5e9])
    t_arr = tx_cfg.get("t", [0, 80e-6])
    fs = rx_cfg.get("fs", 2e6)

    if isinstance(f, list) and len(f) >= 2:
        bw = abs(f[-1] - f[0])
    else:
        bw = 0

    if isinstance(t_arr, list) and len(t_arr) >= 2:
        sweep_time = abs(t_arr[-1] - t_arr[0])
    else:
        sweep_time = 0

    c = 3e8
    samples = baseband.shape[-1]
    if bw > 0:
        range_res = c / (2 * bw)
        max_range = range_res * samples
        output["range_axis"] = np.linspace(0, max_range, samples).tolist()
        output["range_res"] = range_res
    
    pulses = tx_cfg.get("pulses", 1)
    prp = tx_cfg.get("prp", sweep_time if sweep_time > 0 else 1e-3)
    if isinstance(f, list) and len(f) >= 1:
        fc = np.mean(f)
    else:
        fc = f
    wavelength = c / fc
    if pulses > 1 and isinstance(prp, (int, float)) and prp > 0:
        max_velocity = wavelength / (4 * prp)
        output["velocity_axis"] = np.linspace(
            -max_velocity, max_velocity, pulses
        ).tolist()
        output["max_velocity"] = max_velocity

    return output


if __name__ == "__main__":
    config = json.loads(sys.argv[1])
    result = run(config)
    print(json.dumps(result))
