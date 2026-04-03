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

interface ElectronAPI {
  runSimulation(config: any): Promise<IpcResult>;
  runRcsSimulation(config: any): Promise<IpcResult>;
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
