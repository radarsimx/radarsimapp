"""Run RCS simulation using radarsimpy."""
import json
import sys
import numpy as np

from radarsimpy.simulator import sim_rcs  # type: ignore


def run(config):
    """Run RCS simulation."""
    targets = []
    for t in config.get("targets", []):
        target = {}
        if "model" in t:
            target["model"] = t["model"]
        if "location" in t:
            target["location"] = tuple(t["location"])
        if "origin" in t:
            target["origin"] = tuple(t["origin"])
        if "rotation" in t:
            target["rotation"] = tuple(t["rotation"])
        if "permittivity" in t:
            target["permittivity"] = complex(t["permittivity"])
        if "unit" in t:
            target["unit"] = t["unit"]
        targets.append(target)

    rcs_cfg = config.get("rcs", {})
    frequency = rcs_cfg.get("frequency", 24e9)
    density = rcs_cfg.get("density", 1)

    inc_phi = np.array(rcs_cfg.get("inc_phi", [0]))
    inc_theta = np.array(rcs_cfg.get("inc_theta", [90]))

    obs_phi = rcs_cfg.get("obs_phi")
    obs_theta = rcs_cfg.get("obs_theta")

    inc_pol = rcs_cfg.get("inc_pol", [0, 0, 1])
    obs_pol = rcs_cfg.get("obs_pol", None)

    kwargs = {
        "targets": targets,
        "f": frequency,
        "inc_phi": inc_phi,
        "inc_theta": inc_theta,
        "inc_pol": inc_pol,
        "density": density,
    }
    if obs_phi is not None:
        kwargs["obs_phi"] = np.array(obs_phi)
    if obs_theta is not None:
        kwargs["obs_theta"] = np.array(obs_theta)
    if obs_pol is not None:
        kwargs["obs_pol"] = obs_pol

    rcs_result = sim_rcs(**kwargs)
    rcs_dbsm = 10 * np.log10(np.abs(rcs_result) + 1e-30)

    output = {
        "rcs_linear": np.abs(rcs_result).tolist()
        if hasattr(rcs_result, "tolist")
        else [float(np.abs(rcs_result))],
        "rcs_dbsm": rcs_dbsm.tolist()
        if hasattr(rcs_dbsm, "tolist")
        else [float(rcs_dbsm)],
        "inc_phi": inc_phi.tolist(),
        "inc_theta": inc_theta.tolist(),
    }

    return output


if __name__ == "__main__":
    config = json.loads(sys.argv[1])
    result = run(config)
    print(json.dumps(result))
