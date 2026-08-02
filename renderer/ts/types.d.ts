// --- Plotly global (loaded via <script> tag) ---
declare namespace Plotly {
  function newPlot(root: string | HTMLElement, data: any[], layout?: any, config?: any): Promise<any>;
  function react(root: string | HTMLElement, data: any[], layout?: any, config?: any): Promise<any>;
  function purge(root: string | HTMLElement): void;
  namespace Plots {
    function resize(root: HTMLElement): void;
  }
}

// --- Electron preload API ---
interface IpcResult {
  success: boolean;
  data?: any;
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
  runSimulation(config: any): Promise<IpcResult>;
  getSceneState(config: any): Promise<IpcResult & { data?: SceneState }>;
  getAppVersion(): Promise<string>;
  checkLibrary(): Promise<IpcResult>;
  activateLicense(): Promise<IpcResult & { cancelled?: boolean }>;
  selectFile(options?: FileDialogOptions): Promise<string | null>;
  exportResults(data: any): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  saveConfig(jsonData: string): Promise<boolean>;
  loadConfig(): Promise<string | null>;
  windowMinimize(): void;
  windowMaximize(): void;
  windowClose(): void;
  windowIsMaximized(): Promise<boolean>;
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
