// ===== RadarSimApp - Shared State =====
// The lists the panels are built from. Each entry mirrors one card of fields;
// the fields are the truth while the app runs, and these are brought up to
// date from them (save*States) before a list is re-rendered or saved.

export const txChannels: ChannelData[] = [];
export const rxChannels: ChannelData[] = [];
export const pointTargets: PointTargetData[] = [];
export const meshTargets: MeshTargetData[] = [];

/** A new point target: 10 m out along x, 20 dBsm, standing still. */
export function newPointTarget(): PointTargetData {
  return { location: [10, 0, 0], rcs: 20, speed: [0, 0, 0], phase: 0 };
}
