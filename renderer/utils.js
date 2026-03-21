// ===== RadarSimApp - Utility Functions =====

function debounce(fn, delay = 150) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function parseNumber(val, fallback = 0) {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

function parseCSV(str) {
  return str
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => !isNaN(n));
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") e.className = v;
    else if (k === "textContent") e.textContent = v;
    else if (k === "innerHTML") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  }
  children.forEach((c) => {
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  });
  return e;
}

function wrapNumberInput(input) {
  const wrapper = document.createElement("div");
  wrapper.className = "number-input-wrapper";

  const spinner = document.createElement("div");
  spinner.className = "number-input-spinner";

  const upBtn = document.createElement("button");
  upBtn.className = "spin-btn";
  upBtn.type = "button";
  upBtn.tabIndex = -1;
  upBtn.innerHTML = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="2,7 5,3 8,7"/></svg>';

  const downBtn = document.createElement("button");
  downBtn.className = "spin-btn";
  downBtn.type = "button";
  downBtn.tabIndex = -1;
  downBtn.innerHTML = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="2,3 5,7 8,3"/></svg>';

  spinner.appendChild(upBtn);
  spinner.appendChild(downBtn);
  wrapper.appendChild(input);
  wrapper.appendChild(spinner);

  upBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    input.stepUp();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  downBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    input.stepDown();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  return wrapper;
}

function createInput(id, value, step) {
  const inp = el("input", { type: "number", id, value: String(value), step: String(step) });
  return wrapNumberInput(inp);
}

function createTextInput(id, value) {
  return el("input", { type: "text", id, value });
}

function createSVG(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  if (name === "trash") {
    const p1 = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    p1.setAttribute("points", "3 6 5 6 21 6");
    const p2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p2.setAttribute("d", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2");
    svg.appendChild(p1);
    svg.appendChild(p2);
  } else if (name === "chevron") {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    p.setAttribute("points", "6 9 12 15 18 9");
    svg.appendChild(p);
  } else if (name === "rcs") {
    // Scatter/trend icon
    const c1 = document.createElementNS("http://www.w3.org/2000/svg", "circle"); c1.setAttribute("cx", "4");  c1.setAttribute("cy", "20"); c1.setAttribute("r", "2"); svg.appendChild(c1);
    const c2 = document.createElementNS("http://www.w3.org/2000/svg", "circle"); c2.setAttribute("cx", "10"); c2.setAttribute("cy", "12"); c2.setAttribute("r", "2"); svg.appendChild(c2);
    const c3 = document.createElementNS("http://www.w3.org/2000/svg", "circle"); c3.setAttribute("cx", "18"); c3.setAttribute("cy", "6");  c3.setAttribute("r", "2"); svg.appendChild(c3);
    const ln = document.createElementNS("http://www.w3.org/2000/svg", "polyline"); ln.setAttribute("points", "4 20 10 12 18 6"); svg.appendChild(ln);
  } else if (name === "close") {
    const l1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l1.setAttribute("x1", "18"); l1.setAttribute("y1", "6");
    l1.setAttribute("x2", "6");  l1.setAttribute("y2", "18");
    const l2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l2.setAttribute("x1", "6");  l2.setAttribute("y1", "6");
    l2.setAttribute("x2", "18"); l2.setAttribute("y2", "18");
    svg.appendChild(l1);
    svg.appendChild(l2);
  }
  return svg;
}

function confirmAsync(message) {
  return new Promise((resolve) => {
    const overlay = el("div", { className: "confirm-overlay" }, [
      el("div", { className: "confirm-dialog" }, [
        el("p", { className: "confirm-message", textContent: message }),
        el("div", { className: "confirm-actions" }, [
          el("button", { className: "btn-secondary", textContent: "Cancel", onClick: () => { overlay.remove(); resolve(false); } }),
          el("button", { className: "btn-primary btn-danger-solid", textContent: "Delete", onClick: () => { overlay.remove(); resolve(true); } }),
        ]),
      ]),
    ]);
    document.body.appendChild(overlay);
    overlay.querySelector(".btn-secondary").focus();
  });
}
