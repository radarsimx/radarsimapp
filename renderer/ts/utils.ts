// ===== RadarSimApp - Utility Functions =====

export function debounce<A extends unknown[]>(fn: (...args: A) => unknown, delay: number = 150): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout>;
  return function (this: unknown, ...args: A): void {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

export function parseNumber(val: unknown, fallback: number = 0): number {
  const n = parseFloat(String(val));
  return Number.isNaN(n) ? fallback : n;
}

export function isValidComplex(str: string | null | undefined): boolean {
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
    .filter((n) => !Number.isNaN(n));
}

// --- Reading the form ---

/** The value of the field with this id, or undefined when there is no such field. */
export function fieldValue(id: string): string | undefined {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null)?.value;
}

/** The number in a field; `fallback` when it is missing, empty or not a number. */
export function fieldNumber(id: string, fallback: number = 0): number {
  return parseNumber(fieldValue(id), fallback);
}

/** The numbers in a comma-separated field. */
export function fieldCSV(id: string): number[] {
  return parseCSV(fieldValue(id) ?? "");
}

export function fieldChecked(id: string): boolean {
  return (document.getElementById(id) as HTMLInputElement | null)?.checked ?? false;
}

/** The axes a vector's fields are named by: `${prefix}-x` and so on. */
export const XYZ = ["x", "y", "z"] as const;
/** The angles an orientation's fields are named by: `${prefix}-yaw` and so on. */
export const YPR = ["yaw", "pitch", "roll"] as const;

/** A vector from its fields, `${prefix}-${axis}` for each axis, with a fallback per axis (0 if not given). */
export function fieldVector(prefix: string, axes: readonly string[], fallbacks: number[] = []): number[] {
  return axes.map((a, k) => fieldNumber(`${prefix}-${a}`, fallbacks[k] ?? 0));
}

// --- Building the form ---

/** Attributes for {@link el}: `on*` keys take event handlers, the rest values. */
export type ElAttrs = Record<string, string | number | boolean | ((e: Event) => void) | null | undefined>;

export function el(
  tag: string,
  attrs: ElAttrs = {},
  children: (HTMLElement | SVGElement | string | null)[] = [],
): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) {
      if (typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "className") e.className = String(v);
    else if (k === "textContent") e.textContent = String(v ?? "");
    else if (k === "innerHTML") e.innerHTML = String(v ?? "");
    else e.setAttribute(k, String(v));
  }
  children.forEach((c) => {
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  });
  return e;
}

/**
 * The element with this id, which the page is expected to have. Throws, naming
 * the id, when it is missing, rather than failing later on a null.
 */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

/** Show how many items a list holds, beside its title. */
export function setCount(id: string, count: number): void {
  const badge = document.getElementById(id);
  if (badge) badge.textContent = String(count);
}

/** A labelled field: the label over whatever holds the value. `label` may carry markup. */
export function formGroup(label: string, ...content: (HTMLElement | null)[]): HTMLElement {
  return el("div", { className: "form-group" }, [el("label", { innerHTML: label }), ...content]);
}

/**
 * A labelled row of number inputs, one per axis, with ids `${idPrefix}-${axis}`.
 * `labels` names each input (markup allowed); `value(k)` gives the k-th value.
 */
export function vectorGroup(
  label: string,
  idPrefix: string,
  axes: readonly string[],
  labels: readonly string[],
  value: (k: number) => number,
  step: number,
): HTMLElement {
  return formGroup(
    label,
    el(
      "div",
      { className: "form-row triple" },
      axes.map((a, k) => formGroup(labels[k], createInput(`${idPrefix}-${a}`, value(k), step))),
    ),
  );
}

/** A list item's card: its fields, then a button that removes it. Starts collapsed; the outline opens it. */
export function itemCard(body: HTMLElement[], removeText: string, onRemove: () => void): HTMLElement {
  return el("div", { className: "channel-card collapsed" }, [
    el("div", { className: "channel-card-body" }, [
      ...body,
      el("div", { className: "card-actions" }, [
        el("button", { className: "btn-secondary btn-danger", title: "Remove", onClick: onRemove }, [
          trashIcon(),
          ` ${removeText}`,
        ]),
      ]),
    ]),
  ]);
}

export function wrapNumberInput(input: HTMLInputElement): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "number-input-wrapper";

  const spinner = document.createElement("div");
  spinner.className = "number-input-spinner";

  const spinButton = (points: string): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.className = "spin-btn";
    btn.type = "button";
    btn.tabIndex = -1;
    btn.innerHTML = `<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="${points}"/></svg>`;
    return btn;
  };
  const upBtn = spinButton("2,7 5,3 8,7");
  const downBtn = spinButton("2,3 5,7 8,3");

  spinner.append(upBtn, downBtn);
  wrapper.append(input, spinner);

  // One step on press, then repeating while held; "change" once let go
  function startSpin(stepFn: () => void): void {
    const step = (): void => {
      stepFn();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    step();
    let interval: ReturnType<typeof setInterval> | null = null;
    const timeout = setTimeout(() => {
      interval = setInterval(step, 60);
    }, 400);
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

/** A one-line text area that grows to fit what is typed into it. */
export function createTextInput(id: string, value: string): HTMLTextAreaElement {
  const ta = el("textarea", { id, rows: "1" }) as HTMLTextAreaElement;
  ta.value = value;
  ta.style.resize = "none";
  ta.style.overflow = "hidden";
  ta.style.lineHeight = "1.3";
  ta.style.height = "33px";

  const autoResize = (): void => {
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  };
  ta.addEventListener("input", autoResize);
  ta.addEventListener("focus", autoResize, { once: true });
  // It can only be measured once it is laid out
  new ResizeObserver((entries, obs) => {
    if (entries[0].contentRect.width > 0) {
      autoResize();
      obs.disconnect();
    }
  }).observe(ta);
  return ta;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function trashIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
  })) {
    svg.setAttribute(k, v);
  }
  const lid = document.createElementNS(SVG_NS, "polyline");
  lid.setAttribute("points", "3 6 5 6 21 6");
  const body = document.createElementNS(SVG_NS, "path");
  body.setAttribute("d", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2");
  svg.append(lid, body);
  return svg;
}

/** Ask before deleting something; resolves true when the user confirms. */
export function confirmAsync(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const answer = (ok: boolean) => () => {
      overlay.remove();
      resolve(ok);
    };
    const overlay = el("div", { className: "confirm-overlay" }, [
      el("div", { className: "confirm-dialog" }, [
        el("p", { className: "confirm-message", textContent: message }),
        el("div", { className: "confirm-actions" }, [
          el("button", { className: "btn-secondary", textContent: "Cancel", onClick: answer(false) }),
          el("button", { className: "btn-primary btn-danger-solid", textContent: "Delete", onClick: answer(true) }),
        ]),
      ]),
    ]);
    document.body.appendChild(overlay);
    (overlay.querySelector(".btn-secondary") as HTMLButtonElement).focus();
  });
}
