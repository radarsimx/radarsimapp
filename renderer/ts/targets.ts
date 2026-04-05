// ===== RadarSimApp - Target Functions =====

import { el, createInput, createSVG, debounce, parseNumber, confirmAsync } from './utils.js';
import { updateTargetsPlot, markResultsOutdated, plotlyLayout, plotlyConfig } from './plots.js';
import { pointTargets, meshTargets } from './shared.js';
import { debouncedAutoSave } from './state.js';

// --- Point Targets ---
export function savePointTargetStates(): void {
  pointTargets.forEach((t, i) => {
    const g = (id: string): string | undefined => (document.getElementById(id) as HTMLInputElement | null)?.value;
    t.location = [
      parseNumber(g(`pt-${i}-loc-x`), 10),
      parseNumber(g(`pt-${i}-loc-y`)),
      parseNumber(g(`pt-${i}-loc-z`)),
    ];
    t.rcs = parseNumber(g(`pt-${i}-rcs`), 20);
    t.phase = parseNumber(g(`pt-${i}-phase`));
    t.speed = [
      parseNumber(g(`pt-${i}-spd-x`)),
      parseNumber(g(`pt-${i}-spd-y`)),
      parseNumber(g(`pt-${i}-spd-z`)),
    ];
  });
}

export function renderPointTargets(): void {
  const container = document.getElementById("point-targets-list")!;
  container.innerHTML = "";
  pointTargets.forEach((t, i) => {
    const card = el("div", { className: "channel-card collapsed" }, [
      el("div", {
        className: "channel-card-header", onClick: () => {
          const isCollapsed = card.classList.contains("collapsed");
          if (isCollapsed) {
            card.parentElement?.querySelectorAll(".channel-card").forEach((c) => c.classList.add("collapsed"));
          }
          card.classList.toggle("collapsed");
        }
      }, [
        el("span", { textContent: `Target ${i + 1}` }),
        el("button", { className: "btn-icon btn-collapse", title: "Collapse" }, [
          createSVG("chevron"),
        ]),
      ]),
      el("div", { className: "channel-card-body" }, [
        el("div", { className: "form-group" }, [
          el("label", { textContent: "Location (m)" }),
          el("div", { className: "form-row triple" }, [
            el("div", { className: "form-group" }, [
              el("label", { textContent: "x" }),
              createInput(`pt-${i}-loc-x`, t.location?.[0] ?? 10, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "y" }),
              createInput(`pt-${i}-loc-y`, t.location?.[1] ?? 0, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "z" }),
              createInput(`pt-${i}-loc-z`, t.location?.[2] ?? 0, 1),
            ]),
          ]),
        ]),
        el("div", { className: "form-group" }, [
          el("label", { textContent: "Velocity (m/s)" }),
          el("div", { className: "form-row triple" }, [
            el("div", { className: "form-group" }, [
              el("label", { innerHTML: "v<sub>x</sub>" }),
              createInput(`pt-${i}-spd-x`, t.speed?.[0] ?? 0, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { innerHTML: "v<sub>y</sub>" }),
              createInput(`pt-${i}-spd-y`, t.speed?.[1] ?? 0, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { innerHTML: "v<sub>z</sub>" }),
              createInput(`pt-${i}-spd-z`, t.speed?.[2] ?? 0, 1),
            ]),
          ]),
        ]),
        el("div", { className: "form-row" }, [
          el("div", { className: "form-group" }, [
            el("label", { textContent: "RCS (dBsm)" }),
            createInput(`pt-${i}-rcs`, t.rcs ?? 20, 1),
          ]),
          el("div", { className: "form-group" }, [
            el("label", { textContent: "Phase (°)" }),
            createInput(`pt-${i}-phase`, t.phase ?? 0, 1),
          ]),
        ]),

        el("div", { style: "display:flex;justify-content:flex-end;margin-top:4px" }, [
          el("button", {
            className: "btn-secondary btn-danger", title: "Remove", onClick: async () => {
              if (!(await confirmAsync(`Remove Target ${i + 1}?`))) return;
              savePointTargetStates();
              pointTargets.splice(i, 1);
              renderPointTargets();
              updateTargetsPlot();
              markResultsOutdated();
              debouncedAutoSave();
            }
          }, [createSVG("trash"), " Remove Target"]),
        ]),
      ]),
    ]);
    container.appendChild(card);
  });
  requestAnimationFrame(() => {
    const debouncedUpdate = debounce(updateTargetsPlot);
    pointTargets.forEach((_, i) => {
      ["loc-x", "loc-y", "loc-z"].forEach((f) => {
        document.getElementById(`pt-${i}-${f}`)?.addEventListener("input", debouncedUpdate);
      });
    });
    const cards = document.querySelectorAll("#point-targets-list .channel-card");
    if (cards.length > 0) cards[cards.length - 1].classList.remove("collapsed");
    updateTargetsPlot();
  });
}

// --- Mesh Targets ---
export function saveMeshTargetStates(): void {
  meshTargets.forEach((t, i) => {
    const g = (id: string): string | undefined => (document.getElementById(id) as HTMLInputElement | null)?.value;
    t.model = g(`mesh-${i}-model`) ?? t.model ?? "";
    t.location = [
      parseNumber(g(`mesh-${i}-loc-x`)),
      parseNumber(g(`mesh-${i}-loc-y`)),
      parseNumber(g(`mesh-${i}-loc-z`)),
    ];
    t.speed = [
      parseNumber(g(`mesh-${i}-spd-x`)),
      parseNumber(g(`mesh-${i}-spd-y`)),
      parseNumber(g(`mesh-${i}-spd-z`)),
    ];
    t.rotation = [
      parseNumber(g(`mesh-${i}-rot-yaw`)),
      parseNumber(g(`mesh-${i}-rot-pitch`)),
      parseNumber(g(`mesh-${i}-rot-roll`)),
    ];
    t.rotation_rate = [
      parseNumber(g(`mesh-${i}-rr-yaw`)),
      parseNumber(g(`mesh-${i}-rr-pitch`)),
      parseNumber(g(`mesh-${i}-rr-roll`)),
    ];
    t.unit = g(`mesh-${i}-unit`) ?? t.unit ?? "m";
    const permVal = g(`mesh-${i}-perm`);
    t.permittivity = permVal !== undefined && permVal !== "" ? parseNumber(permVal) : (t.permittivity ?? "");
  });
}

export function renderMeshTargets(): void {
  const container = document.getElementById("mesh-targets-list")!;
  container.innerHTML = "";
  meshTargets.forEach((t, i) => {
    const card = el("div", { className: "channel-card collapsed" }, [
      el("div", {
        className: "channel-card-header", onClick: () => {
          const isCollapsed = card.classList.contains("collapsed");
          if (isCollapsed) {
            card.parentElement?.querySelectorAll(".channel-card").forEach((c) => c.classList.add("collapsed"));
          }
          card.classList.toggle("collapsed");
        }
      }, [
        el("span", { textContent: `Mesh ${i + 1}` }),
        el("button", { className: "btn-icon btn-collapse", title: "Collapse" }, [
          createSVG("chevron"),
        ]),
      ]),
      el("div", { className: "channel-card-body" }, [
        // Model path
        el("div", { className: "form-group" }, [
          el("label", { textContent: "3D Model File" }),
          el("div", { style: "display:flex;gap:8px" }, [
            (() => {
              const inp = el("input", {
                type: "text",
                id: `mesh-${i}-model`,
                value: t.model ?? "",
                placeholder: "Path to .stl / .obj / .ply",
                style: "flex:1",
              });
              return inp;
            })(),
            el("button", {
              className: "btn-secondary",
              textContent: "Browse",
              onClick: async () => {
                const f = await window.api.selectFile({
                  filters: [{ name: "3D Models", extensions: ["stl", "obj", "ply"] }],
                });
                if (f) {
                  (document.getElementById(`mesh-${i}-model`) as HTMLInputElement).value = f;
                  meshTargets[i].model = f;
                }
              },
            }),
          ]),
        ]),

        // Location
        el("div", { className: "form-group" }, [
          el("label", { textContent: "Location (m)" }),
          el("div", { className: "form-row triple" }, [
            el("div", { className: "form-group" }, [
              el("label", { textContent: "x" }),
              createInput(`mesh-${i}-loc-x`, t.location?.[0] ?? 0, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "y" }),
              createInput(`mesh-${i}-loc-y`, t.location?.[1] ?? 0, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "z" }),
              createInput(`mesh-${i}-loc-z`, t.location?.[2] ?? 0, 1),
            ]),
          ]),
        ]),

        // Speed
        el("div", { className: "form-group" }, [
          el("label", { textContent: "Velocity (m/s)" }),
          el("div", { className: "form-row triple" }, [
            el("div", { className: "form-group" }, [
              el("label", { innerHTML: "v<sub>x</sub>" }),
              createInput(`mesh-${i}-spd-x`, t.speed?.[0] ?? 0, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { innerHTML: "v<sub>y</sub>" }),
              createInput(`mesh-${i}-spd-y`, t.speed?.[1] ?? 0, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { innerHTML: "v<sub>z</sub>" }),
              createInput(`mesh-${i}-spd-z`, t.speed?.[2] ?? 0, 1),
            ]),
          ]),
        ]),

        // Rotation
        el("div", { className: "form-group" }, [
          el("label", { textContent: "Rotation (°)" }),
          el("div", { className: "form-row triple" }, [
            el("div", { className: "form-group" }, [
              el("label", { textContent: "yaw" }),
              createInput(`mesh-${i}-rot-yaw`, t.rotation?.[0] ?? 0, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "pitch" }),
              createInput(`mesh-${i}-rot-pitch`, t.rotation?.[1] ?? 0, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "roll" }),
              createInput(`mesh-${i}-rot-roll`, t.rotation?.[2] ?? 0, 1),
            ]),
          ]),
        ]),

        // Rotation Rate
        el("div", { className: "form-group" }, [
          el("label", { textContent: "Rotation Rate (°/s)" }),
          el("div", { className: "form-row triple" }, [
            el("div", { className: "form-group" }, [
              el("label", { textContent: "yaw rate" }),
              createInput(`mesh-${i}-rr-yaw`, t.rotation_rate?.[0] ?? 0, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "pitch rate" }),
              createInput(`mesh-${i}-rr-pitch`, t.rotation_rate?.[1] ?? 0, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "roll rate" }),
              createInput(`mesh-${i}-rr-roll`, t.rotation_rate?.[2] ?? 0, 1),
            ]),
          ]),
        ]),

        // Unit
        el("div", { className: "form-row" }, [
          el("div", { className: "form-group" }, [
            el("label", { textContent: "Model Unit" }),
            (() => {
              const sel = el("select", { id: `mesh-${i}-unit` });
              ["m", "cm", "mm"].forEach((u) => {
                const opt = el("option", { value: u, textContent: u });
                if (u === (t.unit ?? "m")) (opt as HTMLOptionElement).selected = true;
                sel.appendChild(opt);
              });
              return sel;
            })(),
          ]),
          el("div", { className: "form-group" }, [
            el("label", { innerHTML: "Permittivity (ε<sub>r</sub>)" }),
            createInput(`mesh-${i}-perm`, t.permittivity ?? "", 0.1),
          ]),
        ]),

        el("div", { style: "display:flex;justify-content:flex-end;gap:8px;margin-top:4px" }, [
          el("button", { className: "btn-secondary btn-rcs", title: "Run RCS Analysis for this target", onClick: () => openRcsModal(i) }, [
            createSVG("rcs"), " RCS Analysis",
          ]),
          el("button", {
            className: "btn-secondary btn-danger", title: "Remove", onClick: async () => {
              if (!(await confirmAsync(`Remove Mesh ${i + 1}?`))) return;
              saveMeshTargetStates();
              meshTargets.splice(i, 1);
              renderMeshTargets();
              updateTargetsPlot();
              markResultsOutdated();
              debouncedAutoSave();
            }
          }, [createSVG("trash"), " Remove Mesh"]),
        ]),
      ]),
    ]);
    container.appendChild(card);
  });
  requestAnimationFrame(() => {
    const debouncedUpdate = debounce(updateTargetsPlot);
    meshTargets.forEach((_, i) => {
      ["loc-x", "loc-y", "loc-z"].forEach((f) => {
        document.getElementById(`mesh-${i}-${f}`)?.addEventListener("input", debouncedUpdate);
      });
    });
    const cards = document.querySelectorAll("#mesh-targets-list .channel-card");
    if (cards.length > 0) cards[cards.length - 1].classList.remove("collapsed");
    updateTargetsPlot();
  });
}

// --- RCS Analysis Modal ---
function openRcsModal(meshIndex: number): void {
  document.querySelector(".rcs-modal-overlay")?.remove();

  saveMeshTargetStates();
  const t = meshTargets[meshIndex];
  if (!t?.model) {
    const cards = document.querySelectorAll("#mesh-targets-list .channel-card");
    if (cards[meshIndex]) {
      const warn = el("div", { className: "status-msg error", textContent: "Set a 3D model file before running RCS analysis.", style: "margin-top:8px" });
      cards[meshIndex].querySelector(".channel-card-body")!.appendChild(warn);
      setTimeout(() => warn.remove(), 3000);
    }
    return;
  }
  const modelName = t.model.split(/[\\/]/).pop();

  const statusEl = el("div", { className: "status-msg" });
  const runBtn = el("button", { className: "btn-primary" }, [
    el("span", { innerHTML: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>' }),
    " Run RCS Analysis",
  ]);

  const plotId = "rcs-modal-plot";

  runBtn.addEventListener("click", async () => {
    (runBtn as HTMLButtonElement).disabled = true;
    statusEl.className = "status-msg running";
    statusEl.textContent = "Running...";

    try {
      const mt: any = { model: t.model, location: t.location ?? [0, 0, 0], unit: t.unit ?? "m" };
      if (t.permittivity) mt.permittivity = t.permittivity;

      const phiStart = parseNumber((document.getElementById("rcs-m-phi-start") as HTMLInputElement | null)?.value);
      const phiEnd = parseNumber((document.getElementById("rcs-m-phi-end") as HTMLInputElement | null)?.value, 360);
      const phiStep = parseNumber((document.getElementById("rcs-m-phi-step") as HTMLInputElement | null)?.value, 1);
      const phi: number[] = [];
      for (let a = phiStart; a <= phiEnd; a += phiStep) phi.push(a);

      const config = {
        targets: [mt],
        rcs: {
          frequency: parseNumber((document.getElementById("rcs-m-freq") as HTMLInputElement | null)?.value, 24) * 1e9,
          density: parseNumber((document.getElementById("rcs-m-density") as HTMLInputElement | null)?.value, 1),
          inc_phi: phi,
          inc_theta: [parseNumber((document.getElementById("rcs-m-theta") as HTMLInputElement | null)?.value, 90)],
          inc_pol: [
            parseNumber((document.getElementById("rcs-m-pol-x") as HTMLInputElement | null)?.value),
            parseNumber((document.getElementById("rcs-m-pol-y") as HTMLInputElement | null)?.value),
            parseNumber((document.getElementById("rcs-m-pol-z") as HTMLInputElement | null)?.value, 1),
          ],
        },
      };

      const result = await window.api.runRcsSimulation(config);
      if (!result.success) throw new Error(result.error);

      statusEl.className = "status-msg success";
      statusEl.textContent = "Done.";

      const container = document.getElementById(plotId)!;
      Plotly.newPlot(
        container,
        [{
          x: result.data.inc_phi,
          y: result.data.rcs_dbsm,
          type: "scatter", mode: "lines",
          line: { color: "#689f38", width: 2 },
          fill: "tozeroy", fillcolor: "rgba(104, 159, 56, 0.1)",
        }],
        {
          ...plotlyLayout,
          margin: { l: 60, r: 16, t: 16, b: 50 },
          xaxis: { ...plotlyLayout.xaxis, title: "Phi (°)" },
          yaxis: { ...plotlyLayout.yaxis, title: "RCS (dBsm)" },
        },
        plotlyConfig
      );
    } catch (err) {
      statusEl.className = "status-msg error";
      statusEl.textContent = "Error: " + (err as Error).message;
    } finally {
      (runBtn as HTMLButtonElement).disabled = false;
    }
  });

  const overlay = el("div", { className: "rcs-modal-overlay" }, [
    el("div", { className: "rcs-modal" }, [
      // Header
      el("div", { className: "rcs-modal-header" }, [
        el("div", {}, [
          el("h2", { textContent: "RCS Analysis" }),
          el("p", { className: "rcs-modal-subtitle", textContent: modelName }),
        ]),
        el("button", { className: "btn-icon", title: "Close", onClick: () => overlay.remove() }, [
          createSVG("close"),
        ]),
      ]),
      // Body
      el("div", { className: "rcs-modal-body" }, [
        // Left: settings
        el("div", { className: "rcs-modal-left" }, [
          el("div", { className: "form-row" }, [
            el("div", { className: "form-group" }, [
              el("label", { textContent: "FREQUENCY (GHZ)" }),
              createInput("rcs-m-freq", 24, 0.1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "RAY DENSITY" }),
              createInput("rcs-m-density", 1, 0.1),
            ]),
          ]),
          el("h4", { className: "subsection-label", textContent: "Incidence Angles" }),
          el("div", { className: "form-row" }, [
            el("div", { className: "form-group" }, [
              el("label", { textContent: "PHI START (°)" }),
              createInput("rcs-m-phi-start", 0, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "PHI END (°)" }),
              createInput("rcs-m-phi-end", 360, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "PHI STEP (°)" }),
              createInput("rcs-m-phi-step", 1, 1),
            ]),
          ]),
          el("div", { className: "form-group" }, [
            el("label", { textContent: "THETA (°)" }),
            createInput("rcs-m-theta", 90, 1),
          ]),
          el("h4", { className: "subsection-label", textContent: "Polarization" }),
          el("div", { className: "form-row triple" }, [
            el("div", { className: "form-group" }, [
              el("label", { textContent: "POL X" }),
              createInput("rcs-m-pol-x", 0, 0.1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "POL Y" }),
              createInput("rcs-m-pol-y", 0, 0.1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "POL Z" }),
              createInput("rcs-m-pol-z", 1, 0.1),
            ]),
          ]),
          el("div", { className: "run-controls", style: "margin-top:20px" }, [
            runBtn,
            statusEl,
          ]),
        ]),
        // Right: plot
        el("div", { className: "rcs-modal-right" }, [
          el("div", { id: plotId, className: "rcs-modal-plot" }),
        ]),
      ]),
    ]),
  ]);

  // Close on backdrop click
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
