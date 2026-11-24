// --- Plotly global (loaded via <script> tag) ---
/** Plotly takes traces, layout and config as plain objects of its own options. */
type PlotlyObject = Record<string, unknown>;

declare namespace Plotly {
  function newPlot(
    root: string | HTMLElement,
    data: PlotlyObject[],
    layout?: PlotlyObject,
    config?: PlotlyObject,
  ): Promise<HTMLElement>;
  function react(
    root: string | HTMLElement,
    data: PlotlyObject[],
    layout?: PlotlyObject,
    config?: PlotlyObject,
  ): Promise<HTMLElement>;
  function purge(root: string | HTMLElement): void;
  namespace Plots {
    function resize(root: HTMLElement): void;
  }
}

// --- Electron preload API ---
interface IpcResult<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}

interface FileDialogOptions {
  filters?: Array<{ name: string; extensions: string[] }>;
}

interface SceneMesh {
  index: number;
  totalCells: number;
  cells: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  i: Int32Array;
  j: Int32Array;
  k: Int32Array;
  /** [minX, minY, minZ, maxX, maxY, maxZ] of the returned vertices. */
  bounds: number[];
}

interface SceneState {
  timestamp: number;
  txLocations: Float32Array | null;
  rxLocations: Float32Array | null;
  boresight: Float32Array | null;
  meshes: SceneMesh[];
  warnings: string[];
}

interface ElectronAPI {
  runSimulation(config: SimConfig): Promise<IpcResult<SimResult>>;
  getSceneState(config: SimConfig): Promise<IpcResult<SceneState>>;
  getAppVersion(): Promise<string>;
  checkLibrary(): Promise<IpcResult<LibraryInfo>>;
  activateLicense(): Promise<IpcResult<{ licensed: boolean; product?: string }> & { cancelled?: boolean }>;
  selectFile(options?: FileDialogOptions): Promise<string | null>;
  exportResults(data: SimResult): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  saveConfig(jsonData: string): Promise<boolean>;
  loadConfig(): Promise<string | null>;
  windowMinimize(): void;
  windowMaximize(): void;
  windowClose(): void;
  windowIsMaximized(): Promise<boolean>;
  onFullscreenChanged(callback: (isFullscreen: boolean) => void): void;
  /** Node's process.platform: "darwin", "win32", "linux", ... */
  platform: string;
}

interface Window {
  api: ElectronAPI;
}

// --- App Data Types ---
interface ChannelData {
  location?: number[];
  polarization?: (string | number)[];
  azimuth_angle?: number[];
  azimuth_pattern?: number[];
  elevation_angle?: number[];
  elevation_pattern?: number[];
  delay?: number;
  pulse_amp?: number[];
  pulse_phs?: number[];
  mod_t?: number[];
  amp?: number[];
  phs?: number[];
}

interface PointTargetData {
  location?: number[];
  rcs?: number;
  speed?: number[];
  phase?: number;
}

interface MeshTargetData {
  model?: string;
  location?: number[];
  speed?: number[];
  rotation?: number[];
  rotation_rate?: number[];
  unit?: string;
  permittivity?: number | string;
}

interface AppState {
  fields: Record<string, string | boolean>;
  sidebarCollapsed?: boolean;
  txChannels: ChannelData[];
  rxChannels: ChannelData[];
  pointTargets: PointTargetData[];
  meshTargets: MeshTargetData[];
}
