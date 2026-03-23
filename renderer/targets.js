// ===== RadarSimApp - Target Functions =====

// --- Point Targets ---
function savePointTargetStates() {
  pointTargets.forEach((t, i) => {
    const g = (id) => document.getElementById(id)?.value;
    t.location = [
      parseNumber(g(`pt-${i}-loc-x`), 50),
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

function renderPointTargets() {
  const container = document.getElementById("point-targets-list");
  container.innerHTML = "";
  pointTargets.forEach((t, i) => {
    const card = el("div", { className: "channel-card collapsed" }, [
      el("div", {
        className: "channel-card-header", onClick: () => {
          const isCollapsed = card.classList.contains("collapsed");
          if (isCollapsed) {
            card.parentElement?.querySelectorAll(".channel-card").forEach(c => c.classList.add("collapsed"));
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
              createInput(`pt-${i}-loc-x`, t.location?.[0] ?? 50, 1),
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
function saveMeshTargetStates() {
  meshTargets.forEach((t, i) => {
    const g = (id) => document.getElementById(id)?.value;
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
    t.permittivity = parseNumber(g(`mesh-${i}-perm`), t.permittivity ?? "");
  });
}

function renderMeshTargets() {
  const container = document.getElementById("mesh-targets-list");
  container.innerHTML = "";
  meshTargets.forEach((t, i) => {
    const card = el("div", { className: "channel-card collapsed" }, [
      el("div", {
        className: "channel-card-header", onClick: () => {
          const isCollapsed = card.classList.contains("collapsed");
          if (isCollapsed) {
            card.parentElement?.querySelectorAll(".channel-card").forEach(c => c.classList.add("collapsed"));
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
                  document.getElementById(`mesh-${i}-model`).value = f;
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
              el("label", { textContent: "yaw" }),
              createInput(`mesh-${i}-rr-yaw`, t.rotation_rate?.[0] ?? 0, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "pitch" }),
              createInput(`mesh-${i}-rr-pitch`, t.rotation_rate?.[1] ?? 0, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "roll" }),
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
                if (u === (t.unit ?? "m")) opt.selected = true;
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
