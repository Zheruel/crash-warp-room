import * as T from "three";
import { readModel } from "./classic.js";
const base = "/classic/";
const json = (name) => fetch(base + name + ".json").then((r) => r.json());
export async function buildWorld(scene) {
  const [{ meta, pads }, bytes, atlas, props, switches, cocoData] =
    await Promise.all([
      json("hub"),
      fetch(base + "geometry.bin").then((r) => r.arrayBuffer()),
      new T.TextureLoader().loadAsync(base + "atlas.png"),
      json("WObOC"),
      json("ButOC"),
      json("CocoC"),
    ]);
  atlas.magFilter = T.NearestFilter;
  atlas.minFilter = T.LinearFilter;
  atlas.flipY = false;
  const material = new T.ShaderMaterial({
    side: T.DoubleSide,
    uniforms: { atlas: { value: atlas } },
    vertexShader:
      "attribute vec3 color;varying vec3 rgb;varying vec2 tex;void main(){rgb=color;tex=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader:
      "uniform sampler2D atlas;varying vec3 rgb;varying vec2 tex;void main(){vec4 t=texture2D(atlas,tex);if(t.a<.1)discard;gl_FragColor=vec4(2.*rgb*t.rgb,1.);}",
  });
  let offset = 0;
  const floors = new Map(),
    walls = new Map();
  function indexTriangle(map, t) {
    for (
      let x = Math.floor(Math.min(t.ax, t.bx, t.cx) / 2);
      x <= Math.floor(Math.max(t.ax, t.bx, t.cx) / 2);
      x++
    )
      for (
        let z = Math.floor(Math.min(t.az, t.bz, t.cz) / 2);
        z <= Math.floor(Math.max(t.az, t.bz, t.cz) / 2);
        z++
      ) {
        const k = x + "," + z;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(t);
      }
  }
  for (const { count } of meta) {
    const geom = new T.BufferGeometry(),
      pos = new Float32Array(bytes, offset, count * 3);
    offset += count * 12;
    geom.setAttribute("position", new T.BufferAttribute(pos, 3));
    geom.setAttribute(
      "uv",
      new T.BufferAttribute(new Float32Array(bytes, offset, count * 2), 2),
    );
    offset += count * 8;
    geom.setAttribute(
      "color",
      new T.Uint8BufferAttribute(
        new Uint8Array(bytes, offset, count * 3),
        3,
        true,
      ),
    );
    offset += count * 3;
    offset = Math.ceil(offset / 4) * 4;
    scene.add(new T.Mesh(geom, material));
    for (let i = 0; i < pos.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = pos.subarray(i, i + 9);
      if (Math.min(ay, by, cy) > 8) continue;
      const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay),
        ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az),
        nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const t = { ax, ay, az, bx, by, bz, cx, cy, cz, ny };
      if (Math.abs(ny) > Math.hypot(nx, ny, nz) * 0.55)
        indexTriangle(floors, t);
      else if (Math.max(ay, by, cy) - Math.min(ay, by, cy) > 0.65)
        indexTriangle(walls, t);
    }
  }
  const animations = [];
  async function prop(data, name, x, y, z, scale, angle = 0) {
    const model = await readModel(data[name]);
    model.mesh.position.set(x, y, z);
    model.mesh.scale.setScalar(scale);
    model.mesh.rotation.y = angle;
    scene.add(model.mesh);
    return model;
  }
  const sky = await prop(props, "Sk12V", 0, 0, 0, 0.25);
  sky.mesh.renderOrder = -2;
  for (const m of sky.mesh.material) m.depthWrite = false;
  const monitor = await prop(props, "Sc12V", 0, 0, 0, 0.043);
  animations.push([monitor, 5]);
  const coco = await prop(
    cocoData,
    "Si12V",
    (-740096 / 4096) * 0.043,
    0,
    (64256 / 4096) * 0.043,
    0.043,
    1.4,
  );
  animations.push([coco, 10]);
  const portals = pads
    .filter((p) => p.id % 6 !== 5)
    .sort((a, b) => a.id - b.id);
  for (const p of pads) {
    const n =
      p.id % 6 === 5
        ? [36, 32, 33, 34, 35][Math.floor(p.id / 6)]
        : p.id + 1 - Math.floor(p.id / 6);
    const model = await prop(
      switches,
      "D" + String(n).padStart(2, "0") + "2G",
      p.x,
      p.y,
      p.z,
      0.043,
      p.angle,
    );
    p.mesh = model.mesh;
  }
  const barrier = await readModel(props.Bar2V);
  const barriers = [];
  const arcs = [
    [7.38, -5.96],
    [8.87, 3.42],
    [1.48, 9.37],
    [-7.38, 5.96],
  ];
  const angles = [-682, 2730, 2048, 1365];
  for (let i = 0; i < arcs.length; i++) {
    let m = barrier.mesh.clone();
    m.position.set(arcs[i][0], 3.14, arcs[i][1]);
    m.rotation.y = (angles[i] * Math.PI) / 2048;
    m.scale.setScalar(0.043);
    scene.add(m);
    barriers.push(m);
    for (const mat of m.material) {
      mat.transparent = true;
      mat.blending = T.AdditiveBlending;
      mat.depthWrite = false;
    }
  }
  const starPositions = [];
  let seed = 3057;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 2600; i++) {
    let a = random() * Math.PI * 2,
      b = random() * 1.45,
      r = 79;
    starPositions.push(
      r * Math.cos(a) * Math.cos(b),
      r * Math.sin(b) - 6,
      r * Math.sin(a) * Math.cos(b),
    );
  }
  const starGeo = new T.BufferGeometry();
  starGeo.setAttribute(
    "position",
    new T.Float32BufferAttribute(starPositions, 3),
  );
  scene.add(
    new T.Points(
      starGeo,
      new T.PointsMaterial({ color: 0xe1ccff, size: 0.075, toneMapped: false }),
    ),
  );
  const film = await new T.TextureLoader().loadAsync("/classic/vortex.png");
  film.flipY = false;
  film.magFilter = T.NearestFilter;
  film.minFilter = T.LinearFilter;
  const vortex = new T.Mesh(
    new T.SphereGeometry(1.6, 40, 28),
    new T.ShaderMaterial({
      uniforms: {
        film: { value: film },
        row: { value: 0 },
        frame: { value: 0 },
      },
      vertexShader:
        "varying vec3 n;void main(){n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader:
        "varying vec3 n;uniform sampler2D film;uniform float frame,row;void main(){vec2 uv=normalize(n).xy*.48+.5;vec3 c=texture2D(film,vec2((frame+uv.x)/6.,(row+1.-uv.y)/24.)).rgb;float rim=pow(1.-max(0.,normalize(n).z),2.6);gl_FragColor=vec4(c+vec3(.48,.72,1.)*rim,1.);}",
    }),
  );
  scene.add(vortex);
  vortex.visible = false;
  let active = -1;
  function activate(i) {
    active = i;
    vortex.visible = i >= 0;
    if (i < 0) return;
    const p = portals[i],
      ch = Math.floor(p.id / 6),
      r = 35.5,
      angle = [0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI, (-2 * Math.PI) / 3][
        ch
      ];
    vortex.position.set(Math.sin(angle) * r, 2.35, -Math.cos(angle) * r);
    vortex.material.uniforms.row.value = (ch * 4 + (i % 5)) % 24;
  }
  function height(x, z, ceiling = 2) {
    let best = -Infinity;
    for (const t of floors.get(Math.floor(x / 2) + "," + Math.floor(z / 2)) ||
      []) {
      const u =
          ((t.cz - t.az) * (x - t.ax) - (t.cx - t.ax) * (z - t.az)) / -t.ny,
        v = (-(t.bz - t.az) * (x - t.ax) + (t.bx - t.ax) * (z - t.az)) / -t.ny;
      if (u < -0.001 || v < -0.001 || u + v > 1.001) continue;
      let y = t.ay + u * (t.by - t.ay) + v * (t.cy - t.ay);
      if (y <= ceiling && y > best) best = y;
    }
    for (const p of pads)
      if (Math.hypot(x - p.x, z - p.z) < 0.97 && p.y + 0.39 <= ceiling)
        best = Math.max(best, p.y + 0.39);
    return best;
  }
  const ray = new T.Ray(),
    point = new T.Vector3(),
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3();
  function blocked(x, z, nextX, nextZ, y) {
    const dx = nextX - x,
      dz = nextZ - z,
      d = Math.hypot(dx, dz);
    if (d < 0.001) return false;
    ray.set(a.set(x, y + 0.74, z), b.set(dx / d, 0, dz / d));
    for (const t of walls.get(
      Math.floor(nextX / 2) + "," + Math.floor(nextZ / 2),
    ) || []) {
      if (
        ray.intersectTriangle(
          a.set(t.ax, t.ay, t.az),
          b.set(t.bx, t.by, t.bz),
          c.set(t.cx, t.cy, t.cz),
          false,
          point,
        ) &&
        point.distanceTo(ray.origin) < d + 0.19
      )
        return true;
    }
    return false;
  }
  return {
    portals,
    height,
    blocked,
    activate,
    vortex,
    update(t, camera) {
      for (const m of barriers)
        m.visible = camera.position.distanceTo(m.position) > 7.2;
      vortex.material.uniforms.frame.value = Math.floor(t * 7) % 6;
      barrier.pose(t * 14);
      for (const p of pads)
        p.mesh.scale.y = active >= 0 && portals[active] === p ? 0.027 : 0.043;
      for (const [m, f] of animations) m.pose(t * f);
      sky.pose(t * 2);
    },
  };
}
