// ===== RadarSimApp - Utility Functions =====

/**
 * Returns a debounced version of `fn` that delays invocation until `delay` ms
 * have elapsed since the last call. Useful for suppressing rapid re-renders
 * triggered by continuous input events (e.g. typing, window resize).
 *
 * @param {Function} fn - The function to debounce.
 * @param {number} [delay=150] - Quiet period in milliseconds.
 * @returns {Function} Debounced wrapper.
 */
function debounce(fn, delay = 150) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Parses a numeric string, returning `fallback` when the result is NaN.
 *
 * @param {*} val - Value to parse (typically a string from an input element).
 * @param {number} [fallback=0] - Value to return when `val` is not a finite number.
 * @returns {number}
 */
function parseNumber(val, fallback = 0) {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

/**
 * Normalises a complex-number value for display in a text input.
 * Numeric values are coerced to strings; strings are returned as-is.
 *
 * @param {string|number} val - The value to format.
 * @returns {string}
 */
function formatComplex(val) {
  if (typeof val === "string") return val;
  return String(val);
}

/**
 * Returns true when `str` is a syntactically valid Python-style complex number.
 * Accepted forms: real (`1`, `-1.5`, `1e3`), imaginary-only (`2j`, `-j`),
 * and full complex (`1+2j`, `-1.5-2.5e3j`).
 *
 * @param {string} str - The string to validate.
 * @returns {boolean}
 */
function isValidComplex(str) {
  const s = (str ?? "").trim();
  if (s === "") return false;
  // Real only: 1, -1.5, 1e3
  const realPat = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
  // Complex (real + imaginary): 1+2j, 1-j, -1.5+2.5e3j
  const complexPat = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[+-](\d+(\.\d*)?|\.\d+)?([eE][+-]?\d+)?[jJ]$/;
  // Imaginary only with coefficient: 2j, -2.5j, 2.5e3j
  const imagNumPat = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[jJ]$/;
  // Pure j: j, +j, -j
  const purePat = /^[+-]?[jJ]$/;
  return realPat.test(s) || complexPat.test(s) || imagNumPat.test(s) || purePat.test(s);
}

/**
 * Splits a comma-separated string into an array of finite numbers.
 * Non-numeric tokens and empty segments are silently discarded.
 *
 * @param {string} str - Comma-separated numeric string (e.g. `"-90, 0, 90"`).
 * @returns {number[]}
 */
function parseCSV(str) {
  return str
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => !isNaN(n));
}

/**
 * Concise DOM element factory.
 *
 * Creates an element of the given tag, applies attributes, and appends
 * children. Attribute keys are handled as follows:
 *  - `className`  → `element.className`
 *  - `textContent` → `element.textContent`
 *  - `innerHTML`  → `element.innerHTML`
 *  - `on<Event>`  → `element.addEventListener(<event>, value)`
 *  - anything else → `element.setAttribute(key, value)`
 *
 * @param {string} tag - HTML tag name (e.g. `"div"`, `"button"`).
 * @param {Object} [attrs={}] - Attributes / event handlers to apply.
 * @param {Array<HTMLElement|string>} [children=[]] - Child nodes or text strings.
 * @returns {HTMLElement}
 */
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

/**
 * Wraps a `<input type="number">` element with increment/decrement spinner
 * buttons. Holding a button triggers accelerating repeat steps after an
 * initial 400 ms delay.
 *
 * @param {HTMLInputElement} input - The number input to wrap.
 * @returns {HTMLDivElement} A `.number-input-wrapper` div containing the input
 *   and its spinner buttons.
 */
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

  /**
   * Begins a spin sequence: fires one step immediately, then repeats at
   * 60 ms intervals after an initial 400 ms hold delay.
   * The sequence stops on `mouseup` or `mouseleave`.
   *
   * @param {Function} stepFn - Called each tick to advance the input value.
   */
  function startSpin(stepFn) {
    stepFn();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    let delay = 400;
    let interval = null;
    const repeat = () => {
      stepFn();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const timeout = setTimeout(() => {
      interval = setInterval(repeat, 60);
    }, delay);
    const stop = () => {
      clearTimeout(timeout);
      clearInterval(interval);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    document.addEventListener("mouseup", stop, { once: true });
    document.addEventListener("mouseleave", stop, { once: true });
  }

  upBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startSpin(() => input.stepUp());
  });

  downBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startSpin(() => input.stepDown());
  });

  return wrapper;
}

/**
 * Creates a styled `<input type="number">` wrapped in spinner buttons.
 *
 * @param {string} id - The `id` attribute for the input element.
 * @param {number|string} value - Initial value.
 * @param {number|string} step - Step size used by the browser and spinner buttons.
 * @returns {HTMLDivElement} The `.number-input-wrapper` produced by {@link wrapNumberInput}.
 */
function createInput(id, value, step) {
  const inp = el("input", { type: "number", id, value: String(value), step: String(step) });
  return wrapNumberInput(inp);
}

/**
 * Creates an auto-resizing `<textarea>` for comma-separated value inputs.
 * The element grows vertically as content is added and shrinks when removed.
 *
 * @param {string} id - The `id` attribute for the textarea element.
 * @param {string} value - Initial text content.
 * @returns {HTMLTextAreaElement}
 */
function createTextInput(id, value) {
  const ta = el("textarea", { id, rows: 1 });
  ta.value = value;
  ta.style.resize = "none";
  ta.style.overflow = "hidden";
  ta.style.lineHeight = "1.3";
  ta.style.height = "33px";

  // Recalculates height to fit content exactly.
  const autoResize = () => {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  };
  ta.addEventListener("input", autoResize);
  // Resize once on first focus in case the element was off-screen during init.
  ta.addEventListener("focus", autoResize, { once: true });
  // ResizeObserver fires the initial resize as soon as the element has a non-zero
  // layout width (i.e. once it is inserted into a visible part of the DOM).
  new ResizeObserver((entries, obs) => {
    if (entries[0].contentRect.width > 0) { autoResize(); obs.disconnect(); }
  }).observe(ta);
  return ta;
}

/**
 * Creates an SVG icon element by name.
 *
 * Supported icon names:
 *  - `"trash"`   — delete / remove action
 *  - `"chevron"` — expand / collapse toggle
 *  - `"rcs"`     — RCS scatter-trend indicator
 *  - `"close"`   — dismiss / close action
 *
 * @param {string} name - Icon identifier.
 * @returns {SVGSVGElement}
 */
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
    // Scatter/trend icon — three dots connected by a rising line
    const c1 = document.createElementNS("http://www.w3.org/2000/svg", "circle"); c1.setAttribute("cx", "4"); c1.setAttribute("cy", "20"); c1.setAttribute("r", "2"); svg.appendChild(c1);
    const c2 = document.createElementNS("http://www.w3.org/2000/svg", "circle"); c2.setAttribute("cx", "10"); c2.setAttribute("cy", "12"); c2.setAttribute("r", "2"); svg.appendChild(c2);
    const c3 = document.createElementNS("http://www.w3.org/2000/svg", "circle"); c3.setAttribute("cx", "18"); c3.setAttribute("cy", "6"); c3.setAttribute("r", "2"); svg.appendChild(c3);
    const ln = document.createElementNS("http://www.w3.org/2000/svg", "polyline"); ln.setAttribute("points", "4 20 10 12 18 6"); svg.appendChild(ln);
  } else if (name === "close") {
    const l1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l1.setAttribute("x1", "18"); l1.setAttribute("y1", "6");
    l1.setAttribute("x2", "6"); l1.setAttribute("y2", "18");
    const l2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l2.setAttribute("x1", "6"); l2.setAttribute("y1", "6");
    l2.setAttribute("x2", "18"); l2.setAttribute("y2", "18");
    svg.appendChild(l1);
    svg.appendChild(l2);
  }
  return svg;
}

/**
 * Displays a non-blocking confirmation dialog built from native DOM elements
 * (no `window.confirm`), returning a Promise that resolves to `true` when the
 * user confirms or `false` when they cancel.
 *
 * The dialog is appended to `document.body` and removed when dismissed.
 *
 * @param {string} message - The question to present to the user.
 * @returns {Promise<boolean>}
 */
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
    // Focus the safe option by default so Enter does not accidentally confirm.
    overlay.querySelector(".btn-secondary").focus();
  });
}

