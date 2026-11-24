// ===== The "Running simulation" backdrop =====
// The same scene as the installer animation (scripts/generate-install-gif.cjs),
// after the radarsimx.com hero, in the app's purple: a faint dot grid that a thin
// line sweeps across from a new angle each pass, lighting up random dots that
// then fade. It draws at about 30 frames a second, since the GPU is busy with the
// simulation itself, and only while it is running.

const TILE = 22; // dot grid spacing (CSS px)
const SWEEP_MS = 2600; // time for the line to cross the window
const PAUSE_MS = 900; // quiet time before the next sweep
const HIT = 0.025; // chance the line lights a dot it passes (half the
// website's, as this fills the whole window)
const TRAIL = 140; // faint wash behind the line
const FRAME_MS = 33;

// --primary-edge, --accent and --mesh; --accent twice, so it lights most dots
const DOT_COLORS = ["184,163,230", "184,163,230", "123,98,179", "162,155,254"];
const ACCENT = "184,163,230";
const LINE = "214,202,245"; // a lighter --accent

interface Dot {
  x: number;
  y: number;
  born: number;
  life: number;
  peak: number;
  color: string;
}
interface GridPoint {
  x: number;
  y: number;
  s: number;
}
interface Sweep {
  start: number;
  angle: number;
  nx: number;
  ny: number;
  from: number;
  to: number;
  order: GridPoint[];
  next: number;
}

const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

export interface BusyAnimation {
  start(): void;
  stop(): void;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is not available");
  return ctx;
}

export function createBusyAnimation(canvas: HTMLCanvasElement): BusyAnimation {
  const ctx = context2d(canvas);
  const grid = document.createElement("canvas"); // the still dot grid, drawn once per size
  const gridCtx = context2d(grid);
  let w = 0,
    h = 0,
    cols = 0,
    rows = 0;
  let dots: Dot[] = [];
  let sweep: Sweep | null = null;
  let angle = Math.random() * Math.PI * 2;
  let raf = 0,
    last = 0,
    running = false;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  function resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nw = canvas.clientWidth,
      nh = canvas.clientHeight;
    if (nw === w && nh === h && canvas.width === Math.round(nw * dpr)) return false;
    w = nw;
    h = nh;
    cols = Math.floor(w / TILE);
    rows = Math.floor(h / TILE);
    for (const c of [canvas, grid]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Faint dots, fading out away from the upper middle
    gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gridCtx.clearRect(0, 0, w, h);
    const mx = w / 2,
      my = h * 0.35,
      rx = w * 0.7,
      ry = h * 0.6;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * TILE + TILE / 2,
          y = r * TILE + TILE / 2;
        const d = Math.hypot((x - mx) / rx, (y - my) / ry);
        if (d >= 1) continue;
        gridCtx.fillStyle = `rgba(255,255,255,${(0.09 * (1 - d)).toFixed(3)})`;
        gridCtx.beginPath();
        gridCtx.arc(x, y, 1, 0, Math.PI * 2);
        gridCtx.fill();
      }
    }
    sweep = null;
    return true;
  }

  function newSweep(now: number): Sweep {
    angle = (angle + Math.PI / 3 + Math.random() * ((Math.PI * 4) / 3)) % (Math.PI * 2);
    const nx = Math.cos(angle),
      ny = Math.sin(angle);
    const proj = (x: number, y: number) => x * nx + y * ny;
    const corners = [proj(0, 0), proj(w, 0), proj(0, h), proj(w, h)];
    const order: GridPoint[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * TILE + TILE / 2,
          y = r * TILE + TILE / 2;
        order.push({ x, y, s: proj(x, y) });
      }
    }
    order.sort((a, b) => a.s - b.s);
    return {
      start: now,
      angle,
      nx,
      ny,
      order,
      next: 0,
      from: Math.min(...corners) - TRAIL * 0.2,
      to: Math.max(...corners) + TRAIL * 0.2,
    };
  }

  function drawLine(sw: Sweep, pos: number): void {
    const half = Math.hypot(w, h) / 2;
    const x = pos - ((w / 2) * sw.nx + (h / 2) * sw.ny);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(sw.angle);
    const trail = ctx.createLinearGradient(x - TRAIL, 0, x, 0);
    trail.addColorStop(0, `rgba(${ACCENT},0)`);
    trail.addColorStop(1, `rgba(${ACCENT},0.07)`);
    ctx.fillStyle = trail;
    ctx.fillRect(x - TRAIL, -half, TRAIL, half * 2);
    const line = ctx.createLinearGradient(0, -half, 0, half);
    line.addColorStop(0, `rgba(${LINE},0)`);
    line.addColorStop(0.35, `rgba(${LINE},0.55)`);
    line.addColorStop(0.65, `rgba(${LINE},0.55)`);
    line.addColorStop(1, `rgba(${LINE},0)`);
    ctx.fillStyle = line;
    ctx.fillRect(x - 0.75, -half, 1.5, half * 2);
    ctx.restore();
  }

  function frame(now: number): void {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (now - last < FRAME_MS) return;
    last = now;
    resize();
    if (!sweep || now - sweep.start > SWEEP_MS + PAUSE_MS) sweep = newSweep(now);
    const sw = sweep;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(grid, 0, 0, w, h);

    const t = now - sw.start;
    const sweeping = t <= SWEEP_MS;
    let pos = 0;
    if (sweeping) {
      pos = sw.from + easeInOut(t / SWEEP_MS) * (sw.to - sw.from);
      while (sw.next < sw.order.length && sw.order[sw.next].s <= pos) {
        const p = sw.order[sw.next++];
        if (Math.random() < HIT) {
          dots.push({
            x: p.x,
            y: p.y,
            born: now,
            life: 1600 + Math.random() * 2200,
            peak: 0.55 + Math.random() * 0.45,
            color: DOT_COLORS[Math.floor(Math.random() * DOT_COLORS.length)],
          });
        }
      }
    }

    dots = dots.filter((d) => now - d.born < d.life);
    for (const d of dots) {
      const k = (now - d.born) / d.life;
      const a = (k < 0.06 ? k / 0.06 : (1 - (k - 0.06) / 0.94) ** 1.6) * d.peak;
      const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, 10);
      g.addColorStop(0, `rgba(${d.color},${(a * 0.6).toFixed(3)})`);
      g.addColorStop(1, `rgba(${d.color},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(d.x - 10, d.y - 10, 20, 20);
      ctx.fillStyle = `rgba(${d.color},${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    if (sweeping) drawLine(sw, pos);
  }

  return {
    start() {
      if (running) return;
      resize();
      if (reduced.matches) {
        // No motion: just the still grid
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(grid, 0, 0, w, h);
        return;
      }
      running = true;
      last = 0;
      dots = [];
      sweep = null;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
