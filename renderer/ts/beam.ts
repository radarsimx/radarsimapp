// ===== RadarSimApp - Pattern Coverage =====
// The angles a channel's antenna pattern is given over. Each channel has its
// own, and sits at its own place on the platform: the 3D view draws each
// channel's cuts as fans from where that channel is.

/** The span of one cut, in degrees off boresight. */
export interface AngleSpan {
  lo: number;
  hi: number;
}

export interface Coverage {
  az: AngleSpan | null;
  el: AngleSpan | null;
}

/** The smallest and largest angle of a cut, or null when it has none. */
export function angleSpan(angles: number[]): AngleSpan | null {
  const finite = angles.filter(Number.isFinite);
  if (finite.length === 0) return null;
  return { lo: Math.min(...finite), hi: Math.max(...finite) };
}

/** One channel's coverage: the span of each of its pattern cuts. Null when neither has any angles. */
export function channelCoverage(azAngles: number[], elAngles: number[]): Coverage | null {
  const az = angleSpan(azAngles), el = angleSpan(elAngles);
  return az || el ? { az, el } : null;
}
