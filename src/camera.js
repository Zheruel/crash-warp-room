import { MathUtils } from "three";
import paths from "./camera-paths.json";

// Each sample contains world position, pitch and yaw from the PS1 zone path.
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
function sample(path, value, parameter) {
  let lo = 0,
    hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (parameter(path[mid]) <= value) lo = mid;
    else hi = mid;
  }
  const a = path[lo],
    b = path[hi];
  const mix = MathUtils.clamp(
    (value - parameter(a)) / (parameter(b) - parameter(a) || 1),
    0,
    1,
  );
  return a.map((n, i) => n + (i === 4 ? wrap(b[i] - n) : b[i] - n) * mix);
}

const bridges = paths.bridges.map((path) => {
  const yaw = path[0][4];
  const x = -Math.sin(yaw),
    z = -Math.cos(yaw);
  // The rail follows longitudinal progress. Crossing the row of switches
  // moves Crash across the shot, with the portal still in frame.
  const progress = (p) => p[0] * x + p[2] * z;
  return { path, x, z, yaw, progress };
});

export function hubCamera() {
  let yaw = 0,
    initialized = false;
  return {
    reset(initialYaw = 0) {
      yaw = initialYaw;
      initialized = false;
    },
    update(pos, dt, eye, target) {
      const radius = Math.hypot(pos.x, pos.z);
      const bearing = Math.atan2(-pos.x, -pos.z);
      const nearest = bridges.reduce((best, b) =>
        Math.abs(wrap(b.yaw - bearing)) < Math.abs(wrap(best.yaw - bearing))
          ? b
          : best,
      );
      const side = Math.abs(pos.x * nearest.z - pos.z * nearest.x);
      const along = pos.x * nearest.x + pos.z * nearest.z;
      const enter =
        MathUtils.smoothstep(along, 4.5, 9) *
        (1 - MathUtils.smoothstep(side, 2.5, 5.0));
      // Leave a little freedom at the centre; facing doesn't drive the camera.
      const error = wrap(bearing - yaw);
      const margin =
        Math.asin(Math.min(1, 0.75 / Math.max(radius, 0.75))) * (1 - enter);
      const orbitTurn =
        Math.sign(error) * Math.max(0, Math.abs(error) - margin);
      const desired = orbitTurn + wrap(nearest.yaw - (yaw + orbitTurn)) * enter;
      if (radius > 0.8)
        yaw = wrap(
          yaw +
            MathUtils.clamp(
              desired * (initialized ? 1 - Math.exp(-5.2 * dt) : 1),
              initialized ? -2.8 * dt : -Math.PI,
              initialized ? 2.8 * dt : Math.PI,
            ),
        );
      initialized = true;
      const orbital = sample(paths.orbit, yaw, (p) => p[4]);
      const setback = MathUtils.lerp(
        9.68,
        8.0,
        MathUtils.smoothstep(along, 12, 30),
      );
      const bridge = sample(nearest.path, along - setback, nearest.progress);
      // Interpolate the orbit angle before leaving the circular rail.
      const weight =
        enter *
        (1 -
          MathUtils.smoothstep(Math.abs(wrap(nearest.yaw - yaw)), 0.03, 1.05));
      const pitch = MathUtils.lerp(
        orbital[3],
        bridge[3] + 0.155 * MathUtils.smoothstep(along, 12, 30),
        weight,
      );
      const viewYaw = yaw + wrap(bridge[4] - yaw) * weight;
      eye.set(...orbital.slice(0, 3));
      eye.x += (bridge[0] - eye.x) * weight;
      eye.y += (bridge[1] - eye.y) * weight;
      eye.z += (bridge[2] - eye.z) * weight;
      target.set(
        eye.x - 10 * Math.sin(viewYaw) * Math.cos(pitch),
        eye.y + 10 * Math.sin(pitch),
        eye.z - 10 * Math.cos(viewYaw) * Math.cos(pitch),
      );
      return viewYaw;
    },
  };
}
