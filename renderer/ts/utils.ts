// ===== RadarSimApp - Utility Functions =====

export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number = 150): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return function (this: any, ...args: Parameters<T>): void {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

export function parseNumber(val: any, fallback: number = 0): number {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

export function formatComplex(val: string | number): string {
  if (typeof val === "string") return val;
  return String(val);
}

export function isValidComplex(str: string): boolean {
  const s = (str ?? "").trim();
  if (s === "") return false;
  const realPat = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
  const complexPat = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[+-](\d+(\.\d*)?|\.\d+)?([eE][+-]?\d+)?[jJ]$/;
  const imagNumPat = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[jJ]$/;
  const purePat = /^[+-]?[jJ]$/;
  return realPat.test(s) || complexPat.test(s) || imagNumPat.test(s) || purePat.test(s);
}

export function parseCSV(str: string): number[] {
  return str
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => !isNaN(n));
}

export function el(tag: string, attrs: Record<string, any> = {}, children: (HTMLElement | SVGElement | string | null)[] = []): HTMLElement {
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

export function wrapNumberInput(input: HTMLInputElement): HTMLDivElement {
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

  function startSpin(stepFn: () => void): void {
    stepFn();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const delay = 400;
    let interval: ReturnType<typeof setInterval> | null = null;
    const repeat = (): void => {
      stepFn();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const timeout = setTimeout(() => {
      interval = setInterval(repeat, 60);
    }, delay);
    const stop = (): void => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
      document.removeEventListener("mouseup", stop);
      document.removeEventListener("mouseleave", stop);
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

export function createInput(id: string, value: number | string, step: number | string): HTMLDivElement {
  const inp = el("input", { type: "number", id, value: String(value), step: String(step) }) as HTMLInputElement;
  return wrapNumberInput(inp);
}

export function createTextInput(id: string, value: string): HTMLTextAreaElement {
  const ta = el("textarea", { id, rows: "1" }) as HTMLTextAreaElement;
  ta.value = value;
  ta.style.resize = "none";
  ta.style.overflow = "hidden";
  ta.style.lineHeight = "1.3";
  ta.style.height = "33px";

  const autoResize = (): void => {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  };
  ta.addEventListener("input", autoResize);
  ta.addEventListener("focus", autoResize, { once: true });
  new ResizeObserver((entries, obs) => {
    if (entries[0].contentRect.width > 0) { autoResize(); obs.disconnect(); }
  }).observe(ta);
  return ta;
}

export function createSVG(name: string): SVGSVGElement {
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

export function confirmAsync(message: string): Promise<boolean> {
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
    (overlay.querySelector(".btn-secondary") as HTMLButtonElement).focus();
  });
}
