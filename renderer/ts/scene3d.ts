// ===== RadarSimApp - 3D Scene View =====
// The stage behind the panels: the radar platform with its channels and
// boresight, the targets, a ground grid and the range rings around the radar.
// It draws a SceneModel (scene.ts) and holds no state of its own beyond the
// camera.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { meshColor, type SceneModel, type SceneMarker, type Vec3 } from './scene.js';
import { formatLength } from './readout.js';
import type { StageInsets } from './stage.js';

/** What the camera frames: everything, or just the antenna array. */
export type SceneFraming = "scene" | "array";
export type CameraPreset = "iso" | "top" | "side";

// The model is in metres, but an antenna array is millimetres across and the
// orbit controls only notice camera moves above a fixed size. Drawing the
// world a thousand times larger keeps them responsive down at that scale.
const UNITS_PER_METRE = 1000;

const FOV = 38;
/** Unit-ish vectors from what is looked at toward the camera; z is up. */
const VIEW_DIRECTIONS: Record<CameraPreset, Vec3> = {
  iso: [-1, -0.9, 0.7],
  top: [-0.001, 0, 1],  // a hair off vertical, so +x stays up the screen
  side: [0, -1, 0],
};

/** Smallest region worth framing (m): a lone channel, a lone target. */
const MIN_RADIUS: Record<SceneFraming, number> = { array: 0.01, scene: 0.5 };

const GRID_CELLS = 20;       // cells from the centre of the grid to its rim
const GRID_MAJOR_EVERY = 5;
const MAX_RINGS = 8;
/** Below this many pixels across, the array's channel names are dropped. */
const ARRAY_LABEL_MIN_PX = 90;

function niceStep(x: number): number {
  const decade = 10 ** Math.floor(Math.log10(x));
  const f = x / decade;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * decade;
}

function smoothstep(x: number, from: number, to: number): number {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * Grid lines on z = 0 out to GRID_CELLS unit cells, each cut into pieces a
 * cell long so it can fade toward the rim.
 */
function gridGeometry(colorAt: (r: number, major: boolean) => THREE.Color): THREE.BufferGeometry {
  const positions: number[] = [], colors: number[] = [];
  for (let line = -GRID_CELLS; line <= GRID_CELLS; line++) {
    const major = line % GRID_MAJOR_EVERY === 0;
    for (let piece = -GRID_CELLS; piece < GRID_CELLS; piece++) {
      const ends = [piece, piece + 1];
      if (ends.some((along) => Math.hypot(line, along) > GRID_CELLS)) continue;
      for (const swap of [false, true]) {
        for (const along of ends) {
          const c = colorAt(Math.hypot(line, along), major);
          positions.push(swap ? along : line, swap ? line : along, 0);
          colors.push(c.r, c.g, c.b);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/** A unit arrow along +x, to be scaled to length and turned to its direction. */
function arrowObject(color: THREE.ColorRepresentation): THREE.Group {
  const material = new THREE.MeshBasicMaterial({ color });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.88, 8), material);
  shaft.rotation.z = -Math.PI / 2;
  shaft.position.x = 0.44;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 14), material);
  head.rotation.z = -Math.PI / 2;
  head.position.x = 0.93;
  const g = new THREE.Group();
  g.add(shaft, head);
  return g;
}

function labelObject(className: string, text: string): CSS2DObject {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  return new CSS2DObject(div);
}

/** A marker is a glyph on its point with its name beside it. */
function markerObject(kind: string, marker: SceneMarker, color?: string): CSS2DObject {
  const div = document.createElement("div");
  div.className = `mk mk-${kind}`;
  div.title = `${marker.label}  (${marker.position.map((v) => Number(v.toPrecision(4))).join(", ")}) m`;
  if (color) div.style.setProperty("--mk", color);
  const glyph = document.createElement("i");
  glyph.className = "mk-glyph";
  const name = document.createElement("b");
  name.textContent = marker.label;
  div.append(glyph, name);
  const obj = new CSS2DObject(div);
  obj.center.set(0, 0.5);  // anchored by its glyph, not by the middle of the pair
  obj.position.set(...marker.position);
  return obj;
}

interface Tween {
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  start: number;
}

const TWEEN_MS = 320;

export class SceneView {
  /** Told the grid's cell size (m) whenever it changes. */
  onScale: ((cell: number) => void) | null = null;

  private renderer: THREE.WebGLRenderer;
  private labels = new CSS2DRenderer();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 1, 1e6);
  private orbit: OrbitControls;

  /** Everything in metres hangs off this; the scene itself is in millimetres. */
  private world = new THREE.Group();
  private grid: THREE.LineSegments;
  private axes = new THREE.AxesHelper(1);
  private rings = new THREE.Group();
  private ringNames: { radius: number; name: CSS2DObject }[] = [];
  private markers = new THREE.Group();
  private meshGroup = new THREE.Group();
  private meshObjects = new Map<SceneMesh, THREE.Mesh>();
  private boresight: THREE.Group;
  private boresightLabel = labelObject("mk-note mk-boresight-note", "Boresight");

  private model: SceneModel | null = null;
  private framing: SceneFraming = "scene";
  private direction = new THREE.Vector3(...VIEW_DIRECTIONS.iso).normalize();
  private insets: StageInsets = { left: 0, right: 0, top: 0, bottom: 0 };
  /** The camera is the user's once they have moved it; until then it follows the scene. */
  private userMoved = false;
  private fitted: THREE.Sphere | null = null;
  /** A fit asked for while the view was hidden had no size to work from. */
  private refitOnShow = false;
  private arrayBounds = new THREE.Sphere();
  private sceneBounds = new THREE.Sphere();
  private ringGeometry: THREE.BufferGeometry;
  private ringMaterial: THREE.LineBasicMaterial;
  private tween: Tween | null = null;
  private raf = 0;
  private gridCell = 0;
  private reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.labels.domElement.className = "s3-labels";
    host.append(this.renderer.domElement, this.labels.domElement);

    const background = new THREE.Color(this.css("--view-bg"));
    this.scene.background = background;

    this.camera.up.set(0, 0, 1);
    // On the host rather than the canvas, so a drag that starts on a marker orbits too
    this.orbit = new OrbitControls(this.camera, host);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.14;
    this.orbit.zoomToCursor = true;
    this.orbit.minDistance = 1;
    this.orbit.maxDistance = 1e8;
    this.orbit.addEventListener("change", () => this.invalidate());
    this.orbit.addEventListener("start", () => {
      this.userMoved = true;
      this.tween = null;
    });

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2438, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(-500, -800, 1500);
    const fill = new THREE.DirectionalLight(0xd6c9f2, 0.55);
    fill.position.set(600, 700, 400);
    this.scene.add(sun, fill);

    const line = new THREE.Color(this.css("--view-grid"));
    this.grid = new THREE.LineSegments(
      gridGeometry((r, major) => background.clone().lerp(
        line, (1 - smoothstep(r, GRID_CELLS * 0.25, GRID_CELLS * 0.95)) * (major ? 1 : 0.42))),
      new THREE.LineBasicMaterial({ vertexColors: true }));

    const circle: THREE.Vector3[] = [];
    for (let s = 0; s <= 128; s++) {
      const a = 2 * Math.PI * s / 128;
      circle.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
    }
    this.ringGeometry = new THREE.BufferGeometry().setFromPoints(circle);
    this.ringMaterial = new THREE.LineBasicMaterial({
      color: this.css("--view-ring"), transparent: true, opacity: 0.5,
    });

    this.axes.setColors(this.css("--ax-x"), this.css("--ax-y"), this.css("--ax-z"));
    this.boresight = arrowObject(this.css("--boresight"));
    this.boresight.visible = false;

    this.world.scale.setScalar(UNITS_PER_METRE);
    this.world.add(this.grid, this.axes, this.rings, this.meshGroup, this.boresight, this.markers);
    this.scene.add(this.world);

    host.addEventListener("dblclick", () => this.fit());
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  private css(name: string): string {
    return getComputedStyle(this.host).getPropertyValue(name).trim() || "#888";
  }

  // --- Model ---
  setModel(model: SceneModel): void {
    this.model = model;

    this.markers.clear();  // a removed marker takes its element with it
    this.markers.add(markerObject("radar", { label: "Radar", position: model.radar }));
    model.tx.forEach((m) => this.markers.add(markerObject("tx", m)));
    model.rx.forEach((m) => this.markers.add(markerObject("rx", m)));
    model.pointTargets.forEach((m) => this.markers.add(markerObject("point", m)));
    model.meshMarkers.forEach((m) => this.markers.add(markerObject("mesh", m)));

    this.syncMeshes(model.meshes);
    this.buildRings(model);
    this.arrayBounds = this.bounds("array");
    this.sceneBounds = this.bounds("scene");

    this.boresight.visible = !!model.boresight;
    if (model.boresight) {
      this.boresight.position.set(...model.radar);
      this.boresight.quaternion.setFromUnitVectors(
        new THREE.Vector3(1, 0, 0), new THREE.Vector3(...model.boresight).normalize());
      this.markers.add(this.boresightLabel);
    }

    if (this.userMoved) this.invalidate();
    else this.fit(false);
  }

  /** Geometry is kept for as long as the library's mesh object is the same one. */
  private syncMeshes(meshes: SceneMesh[]): void {
    const current = new Set(meshes);
    for (const [source, object] of this.meshObjects) {
      if (current.has(source)) continue;
      this.meshGroup.remove(object);
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
      this.meshObjects.delete(source);
    }
    for (const m of meshes) {
      if (!this.meshObjects.has(m)) {
        const positions = new Float32Array(m.x.length * 3);
        for (let v = 0; v < m.x.length; v++) {
          positions[v * 3] = m.x[v];
          positions[v * 3 + 1] = m.y[v];
          positions[v * 3 + 2] = m.z[v];
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
          color: meshColor(m.index), flatShading: true, roughness: 0.65, metalness: 0.05,
          side: THREE.DoubleSide,
        }));
        this.meshGroup.add(object);
        this.meshObjects.set(m, object);
      }
      if (m.bounds.every(isFinite)) {
        const [x0, y0, z0, x1, y1, z1] = m.bounds;
        this.markers.add(markerObject("mesh", {
          label: `M${m.index + 1}`, position: [(x0 + x1) / 2, (y0 + y1) / 2, z1],
        }, meshColor(m.index)));
      }
    }
  }

  /** Circles of constant range around the radar, out to the farthest target. */
  private buildRings(model: SceneModel): void {
    this.rings.clear();
    this.ringNames = [];

    const radar = new THREE.Vector3(...model.radar);
    let reach = 0;
    const consider = (p: Vec3): void => { reach = Math.max(reach, radar.distanceTo(new THREE.Vector3(...p))); };
    model.pointTargets.forEach((m) => consider(m.position));
    model.meshMarkers.forEach((m) => consider(m.position));
    model.meshes.forEach((m) => {
      if (!m.bounds.every(isFinite)) return;
      consider([m.bounds[0], m.bounds[1], m.bounds[2]]);
      consider([m.bounds[3], m.bounds[4], m.bounds[5]]);
    });
    if (reach <= 0) return;

    const step = niceStep(reach / 3);
    const count = Math.min(MAX_RINGS, Math.ceil(reach / step));
    // Named abeam of the boresight, clear of its arrow and of what lies ahead
    const ahead = new THREE.Vector3(...(model.boresight ?? [1, 0, 0])).setZ(0);
    if (ahead.lengthSq() < 1e-6) ahead.set(1, 0, 0);
    const abeam = new THREE.Vector3(ahead.y, -ahead.x, 0).normalize();

    for (let k = 1; k <= count; k++) {
      const ring = new THREE.Line(this.ringGeometry, this.ringMaterial);
      ring.scale.setScalar(k * step);
      const name = labelObject("mk-note mk-ring-note", formatLength(k * step));
      name.position.copy(abeam).multiplyScalar(k * step);
      this.ringNames.push({ radius: k * step, name });
      this.rings.add(ring, name);
    }
    this.rings.position.copy(radar);
  }

  // --- Camera ---
  /** Bounding sphere (m) of what a framing takes in. */
  private bounds(framing: SceneFraming): THREE.Sphere {
    const box = new THREE.Box3();
    const add = (p: Vec3): void => { box.expandByPoint(new THREE.Vector3(...p)); };
    const model = this.model;
    if (model) {
      add(model.radar);
      model.tx.forEach((m) => add(m.position));
      model.rx.forEach((m) => add(m.position));
      if (framing === "scene") {
        model.pointTargets.forEach((m) => add(m.position));
        model.meshMarkers.forEach((m) => add(m.position));
        model.meshes.forEach((m) => {
          if (!m.bounds.every(isFinite)) return;
          add([m.bounds[0], m.bounds[1], m.bounds[2]]);
          add([m.bounds[3], m.bounds[4], m.bounds[5]]);
        });
      }
    } else {
      add([0, 0, 0]);
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.radius = Math.max(sphere.radius, MIN_RADIUS[framing]);
    return sphere;
  }

  setFraming(framing: SceneFraming): void {
    this.framing = framing;
    this.fit();
  }

  setCamera(preset: CameraPreset): void {
    this.direction.set(...VIEW_DIRECTIONS[preset]).normalize();
    this.fitted = null;
    this.fit();
  }

  /**
   * Put the framing in the middle of what the panels leave clear. Asked for
   * outright it always moves; following the model it moves only when what it
   * frames has changed.
   */
  fit(explicit: boolean = true): void {
    const sphere = (this.framing === "array" ? this.arrayBounds : this.sceneBounds).clone();
    if (!explicit && this.fitted && this.fitted.equals(sphere)) {
      this.invalidate();
      return;
    }
    if (explicit && this.userMoved) {
      // Keep the angle the user left it at
      this.direction.copy(this.camera.position).sub(this.orbit.target).normalize();
    }
    this.userMoved = false;
    this.fitted = sphere;

    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) {
      this.refitOnShow = true;
      return;
    }
    const freeW = Math.max(w - this.insets.left - this.insets.right, 1);
    const freeH = Math.max(h - this.insets.top - this.insets.bottom, 1);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    const half = Math.atan(tanHalf * Math.min(freeW, freeH) / h);
    const distance = sphere.radius / Math.sin(half) * 1.2 * UNITS_PER_METRE;

    const target = sphere.center.clone().multiplyScalar(UNITS_PER_METRE);
    const position = target.clone().addScaledVector(this.direction, distance);
    if (this.reducedMotion.matches || this.refitOnShow) {
      this.tween = null;
      this.orbit.target.copy(target);
      this.camera.position.copy(position);
    } else {
      this.tween = {
        fromPosition: this.camera.position.clone(), toPosition: position,
        fromTarget: this.orbit.target.clone(), toTarget: target,
        start: 0,
      };
    }
    this.refitOnShow = false;
    this.invalidate();
  }

  setInsets(insets: StageInsets): void {
    const same = (Object.keys(insets) as (keyof StageInsets)[]).every((k) => insets[k] === this.insets[k]);
    if (same) return;
    this.insets = { ...insets };
    this.resize();
    this.refit();
  }

  /** The room to frame in has changed: frame again, unless the camera is the user's. */
  private refit(): void {
    if (this.userMoved) return;
    this.fitted = null;
    this.fit(false);
  }

  private resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;  // hidden behind a result plot
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    // Centred in the part of the view the panels and the bars leave clear
    const { left, right, top, bottom } = this.insets;
    this.camera.setViewOffset(w, h, (right - left) / 2, (bottom - top) / 2, w, h);
    if (this.refitOnShow) this.refit();
    this.invalidate();
  }

  // --- Rendering ---
  invalidate(): void {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(t: number): void {
    this.raf = 0;
    if (!this.host.clientWidth) return;

    let animating = false;
    if (this.tween) {
      if (!this.tween.start) this.tween.start = t;
      const k = Math.min(1, (t - this.tween.start) / TWEEN_MS);
      const eased = 1 - (1 - k) ** 3;
      this.camera.position.lerpVectors(this.tween.fromPosition, this.tween.toPosition, eased);
      this.orbit.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, eased);
      if (k >= 1) this.tween = null;
      animating = true;
    }
    if (this.orbit.update()) animating = true;  // still coasting

    this.fitToDistance();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    if (animating) this.invalidate();
  }

  /** Everything sized to the view rather than to the world: grid, arrow, axes, clip planes. */
  private fitToDistance(): void {
    const distance = this.camera.position.distanceTo(this.orbit.target);
    const metres = distance / UNITS_PER_METRE;

    const cell = niceStep(metres * 0.07);
    if (cell !== this.gridCell) {
      this.gridCell = cell;
      this.onScale?.(cell);
    }
    // The grid follows the view across the ground, a whole major cell at a time.
    // Close in on the array it is the platform's own level instead: the ground
    // may be metres below, and nowhere in sight.
    const snap = cell * GRID_MAJOR_EVERY;
    this.grid.scale.setScalar(cell);
    this.grid.position.set(
      Math.round(this.orbit.target.x / UNITS_PER_METRE / snap) * snap,
      Math.round(this.orbit.target.y / UNITS_PER_METRE / snap) * snap,
      this.framing === "array" ? this.model?.radar[2] ?? 0 : 0);

    this.axes.scale.setScalar(metres * 0.07);
    if (this.model?.boresight) {
      const length = metres * 0.2;
      this.boresight.scale.setScalar(length);
      this.boresightLabel.position.set(...this.model.boresight).normalize()
        .multiplyScalar(length * 1.12).add(this.boresight.position);
    }

    // A ring is named only while it is a sensible size on screen: not when the
    // view is down among the antennas, nor when the rings have shrunk to a dot
    for (const { radius, name } of this.ringNames) {
      name.visible = radius < metres * 4 && radius > metres * 0.04;
    }

    // Channel names pile up into one blot once the array is a speck
    const array = this.arrayBounds;
    const toArray = this.camera.position.distanceTo(array.center.clone().multiplyScalar(UNITS_PER_METRE));
    const pixels = array.radius * UNITS_PER_METRE / (toArray * Math.tan(THREE.MathUtils.degToRad(FOV) / 2))
      * this.host.clientHeight;
    this.host.classList.toggle("s3-far", pixels < ARRAY_LABEL_MIN_PX);

    // Near and far planes track the view, so depth holds from millimetres to kilometres
    const whole = this.sceneBounds;
    const toWhole = this.camera.position.distanceTo(whole.center.clone().multiplyScalar(UNITS_PER_METRE));
    this.camera.near = distance * 0.02;
    this.camera.far = Math.max(distance * 60, toWhole + whole.radius * UNITS_PER_METRE * 2.5);
    this.camera.updateProjectionMatrix();
  }
}
