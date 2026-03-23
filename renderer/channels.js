// ===== RadarSimApp - Channel Functions =====

function createChannelCard(prefix, index, data, isTx) {
  const pfx = prefix.toLowerCase();

  // Build the fields column
  const fields = el("div", { className: "channel-card-fields" }, [
    // Location
    el("div", { className: "form-group" }, [
      el("label", { textContent: "LOCATION (X, Y, Z) [M]" }),
      el("div", { className: "form-row triple" }, [
        createInput(`${pfx}-ch-${index}-loc-x`, data.location?.[0] ?? 0, 0.001),
        createInput(`${pfx}-ch-${index}-loc-y`, data.location?.[1] ?? 0, 0.001),
        createInput(`${pfx}-ch-${index}-loc-z`, data.location?.[2] ?? 0, 0.001),
      ]),
    ]),

    // Polarization
    el("div", { className: "form-group" }, [
      el("label", { textContent: "POLARIZATION (X, Y, Z)" }),
      el("div", { className: "form-row triple" }, [
        createInput(`${pfx}-ch-${index}-pol-x`, data.polarization?.[0] ?? 0, 0.1),
        createInput(`${pfx}-ch-${index}-pol-y`, data.polarization?.[1] ?? 0, 0.1),
        createInput(`${pfx}-ch-${index}-pol-z`, data.polarization?.[2] ?? 1, 0.1),
      ]),
    ]),
  ]);

  if (isTx) {
    fields.appendChild(
      el("div", { className: "form-row" }, [
        el("div", { className: "form-group" }, [
          el("label", { textContent: "DELAY (NS)" }),
          createInput(`tx-ch-${index}-delay`, (data.delay ?? 0) * 1e9, 1),
        ]),
        el("div", { className: "form-group" }, [
          el("label", { textContent: "RAY GRID (°)" }),
          createInput(`tx-ch-${index}-grid`, data.grid ?? 1, 0.1),
        ]),
      ])
    );
  }

  // Antenna Pattern (azimuth)
  fields.append(
    el("div", { className: "form-group" }, [
      el("label", { textContent: "AZIMUTH ANGLES (°)" }),
      createTextInput(
        `${pfx}-ch-${index}-az-angles`,
        data.azimuth_angle?.join(", ") ?? "-90, 90"
      ),
    ]),
    el("div", { className: "form-group" }, [
      el("label", { textContent: "AZIMUTH PATTERN (DB)" }),
      createTextInput(
        `${pfx}-ch-${index}-az-pattern`,
        data.azimuth_pattern?.join(", ") ?? "0, 0"
      ),
    ]),

    // Antenna Pattern (elevation)
    el("div", { className: "form-group" }, [
      el("label", { textContent: "ELEVATION ANGLES (°)" }),
      createTextInput(
        `${pfx}-ch-${index}-el-angles`,
        data.elevation_angle?.join(", ") ?? "-90, 90"
      ),
    ]),
    el("div", { className: "form-group" }, [
      el("label", { textContent: "ELEVATION PATTERN (DB)" }),
      createTextInput(
        `${pfx}-ch-${index}-el-pattern`,
        data.elevation_pattern?.join(", ") ?? "0, 0"
      ),
    ]),
  );

  // Build the combined pattern plot
  const patternPlotDiv = el("div", { className: "pattern-plot", id: `${pfx}-ch-${index}-pattern-plot` });

  const plots = el("div", { className: "channel-card-plots" }, [
    el("div", { className: "pattern-plot-label", textContent: "Antenna Pattern" }),
    patternPlotDiv,
  ]);

  const card = el("div", { className: "channel-card collapsed" }, [
    el("div", {
      className: "channel-card-header", onClick: () => {
        const isCollapsed = card.classList.contains("collapsed");
        if (isCollapsed) {
          card.parentElement?.querySelectorAll(".channel-card").forEach(c => c.classList.add("collapsed"));
        }
        card.classList.toggle("collapsed");
        if (isCollapsed) {
          card.querySelectorAll(".js-plotly-plot").forEach((plot) => Plotly.Plots.resize(plot));
        }
      }
    }, [
      el("span", { textContent: `${prefix} Channel ${index + 1}` }),
      el("button", { className: "btn-icon btn-collapse", title: "Collapse" }, [
        createSVG("chevron"),
      ]),
    ]),
    el("div", { className: "channel-card-body" }, [
      fields,
      plots,
      el("div", { style: "display:flex;justify-content:flex-end;margin-top:4px" }, [
        el("button", { className: "btn-secondary btn-danger", title: "Remove", onClick: () => removeChannel(prefix, index) }, [
          createSVG("trash"),
          " Remove Channel",
        ]),
      ]),
    ]),
  ]);

  return card;
}

function renderTxChannels() {
  const container = document.getElementById("tx-channels-list");
  container.innerHTML = "";
  txChannels.forEach((ch, i) => {
    container.appendChild(createChannelCard("TX", i, ch, true));
  });

  requestAnimationFrame(() => {
    txChannels.forEach((_, i) => {
      updateChannelPatternPlot("tx", i);
      attachPatternListeners("tx", i);
    });
    updateTxLocationsPlot();
    attachLocationListeners();
    updateRadarOverviewPlot();
    const cards = document.querySelectorAll("#tx-channels-list .channel-card");
    if (cards.length > 0) cards[cards.length - 1].classList.remove("collapsed");
  });
}

function renderRxChannels() {
  const container = document.getElementById("rx-channels-list");
  container.innerHTML = "";
  rxChannels.forEach((ch, i) => {
    container.appendChild(createChannelCard("RX", i, ch, false));
  });

  requestAnimationFrame(() => {
    rxChannels.forEach((_, i) => {
      updateChannelPatternPlot("rx", i);
      attachPatternListeners("rx", i);
    });
    updateRxLocationsPlot();
    attachRxLocationListeners();
    updateRadarOverviewPlot();
    const cards = container.querySelectorAll(".channel-card");
    if (cards.length > 0) cards[cards.length - 1].classList.remove("collapsed");
  });
}

function saveTxChannelStates() {
  txChannels.forEach((ch, i) => {
    const g = (id) => document.getElementById(id)?.value;
    ch.location = [
      parseNumber(g(`tx-ch-${i}-loc-x`)),
      parseNumber(g(`tx-ch-${i}-loc-y`)),
      parseNumber(g(`tx-ch-${i}-loc-z`)),
    ];
    ch.polarization = [
      parseNumber(g(`tx-ch-${i}-pol-x`)),
      parseNumber(g(`tx-ch-${i}-pol-y`)),
      parseNumber(g(`tx-ch-${i}-pol-z`), 1),
    ];
    ch.azimuth_angle = parseCSV(g(`tx-ch-${i}-az-angles`) || "");
    ch.azimuth_pattern = parseCSV(g(`tx-ch-${i}-az-pattern`) || "");
    ch.elevation_angle = parseCSV(g(`tx-ch-${i}-el-angles`) || "");
    ch.elevation_pattern = parseCSV(g(`tx-ch-${i}-el-pattern`) || "");
    ch.delay = parseNumber(g(`tx-ch-${i}-delay`)) * 1e-9;
    ch.grid = parseNumber(g(`tx-ch-${i}-grid`), 1);
  });
}

function saveRxChannelStates() {
  rxChannels.forEach((ch, i) => {
    const g = (id) => document.getElementById(id)?.value;
    ch.location = [
      parseNumber(g(`rx-ch-${i}-loc-x`)),
      parseNumber(g(`rx-ch-${i}-loc-y`)),
      parseNumber(g(`rx-ch-${i}-loc-z`)),
    ];
    ch.polarization = [
      parseNumber(g(`rx-ch-${i}-pol-x`)),
      parseNumber(g(`rx-ch-${i}-pol-y`)),
      parseNumber(g(`rx-ch-${i}-pol-z`), 1),
    ];
    ch.azimuth_angle = parseCSV(g(`rx-ch-${i}-az-angles`) || "");
    ch.azimuth_pattern = parseCSV(g(`rx-ch-${i}-az-pattern`) || "");
    ch.elevation_angle = parseCSV(g(`rx-ch-${i}-el-angles`) || "");
    ch.elevation_pattern = parseCSV(g(`rx-ch-${i}-el-pattern`) || "");
  });
}

async function removeChannel(prefix, index) {
  if (!(await confirmAsync(`Remove ${prefix} Channel ${index + 1}?`))) return;
  if (prefix === "TX") {
    saveTxChannelStates();
    txChannels.splice(index, 1);
    renderTxChannels();
  } else {
    saveRxChannelStates();
    rxChannels.splice(index, 1);
    renderRxChannels();
  }
}

function attachLocationListeners() {
  txChannels.forEach((_, i) => {
    const debouncedUpdate = debounce(() => { updateTxLocationsPlot(); updateRadarOverviewPlot(); });
    ["loc-x", "loc-y", "loc-z"].forEach((field) => {
      const elem = document.getElementById(`tx-ch-${i}-${field}`);
      if (elem) {
        elem.addEventListener("input", debouncedUpdate);
      }
    });
  });
}

function attachRxLocationListeners() {
  rxChannels.forEach((_, i) => {
    const debouncedUpdate = debounce(() => { updateRxLocationsPlot(); updateRadarOverviewPlot(); });
    ["loc-x", "loc-y", "loc-z"].forEach((field) => {
      const elem = document.getElementById(`rx-ch-${i}-${field}`);
      if (elem) {
        elem.addEventListener("input", debouncedUpdate);
      }
    });
  });
}
