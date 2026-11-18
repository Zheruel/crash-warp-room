import * as T from "three";

const loader = new T.TextureLoader();
const textures = new Map();
async function page(path) {
  if (!path) return null;
  if (!textures.has(path))
    textures.set(
      path,
      loader.loadAsync("./classic/" + path).then((texture) => {
        texture.flipY = false;
        texture.magFilter = T.NearestFilter;
        texture.minFilter = T.LinearFilter;
        return texture;
      }),
    );
  return textures.get(path);
}

export async function readModel(data) {
  const geometry = new T.BufferGeometry();
  const pos = new T.Float32BufferAttribute(
    new Float32Array(data.ids.length * 3),
    3,
  );
  geometry.setAttribute("position", pos);
  geometry.setAttribute("uv", new T.Float32BufferAttribute(data.uv, 2));
  geometry.setAttribute(
    "color",
    new T.Uint8BufferAttribute(data.color, 3, true),
  );
  const materials = await Promise.all(
    data.groups.map(async (group, i) => {
      geometry.addGroup(group.start, group.count, i);
      const texture = await page(group.path);
      const material = new T.ShaderMaterial({
        side: T.DoubleSide,
        uniforms: {
          sheet: { value: texture },
          alpha: { value: group.psxBlend === 0 ? 0.5 : 1 },
        },
        vertexShader:
          "attribute vec3 color; varying vec3 rgb; varying vec2 tex; void main(){rgb=color;tex=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader:
          "varying vec3 rgb; varying vec2 tex; uniform sampler2D sheet; uniform float alpha; void main(){vec4 c=vec4(rgb,1.);" +
          (texture
            ? "vec4 t=texture2D(sheet,tex);if(t.a<.1)discard;c.rgb*=2.*t.rgb;"
            : "") +
          "gl_FragColor=vec4(c.rgb,alpha);}",
      });
      if (group.psxBlend !== undefined && group.psxBlend !== 3) {
        material.transparent = true;
        material.depthWrite = false;
        material.forceSinglePass = true;
        if (group.psxBlend === 1) material.blending = T.AdditiveBlending;
        if (group.psxBlend === 2) {
          material.blending = T.CustomBlending;
          material.blendEquation = T.ReverseSubtractEquation;
          material.blendSrc = T.OneFactor;
          material.blendDst = T.OneFactor;
        }
      }
      return material;
    }),
  );
  const mesh = new T.Mesh(geometry, materials);
  mesh.frustumCulled = false;
  function pose(frame) {
    const f = Math.floor(frame) % data.frames.length;
    const a = data.frames[f],
      b = data.frames[(f + 1) % data.frames.length],
      mix = frame - Math.floor(frame);
    for (let i = 0; i < data.ids.length; i++) {
      const idx = data.ids[i] * 3;
      for (let j = 0; j < 3; j++)
        pos.array[i * 3 + j] = a[idx + j] + (b[idx + j] - a[idx + j]) * mix;
    }
    pos.needsUpdate = true;
  }
  pose(data.frames.length - 1);
  return { mesh, pose, count: data.frames.length };
}

export async function player() {
  const data = await (await fetch("./classic/WillC.json")).json();
  const clips = Object.fromEntries(
    await Promise.all(
      Object.entries(data).map(async ([key, d]) => [key, await readModel(d)]),
    ),
  );
  const root = new T.Group(),
    rig = new T.Group();
  root.add(rig);
  rig.scale.setScalar(0.043);
  for (const clip of Object.values(clips)) {
    rig.add(clip.mesh);
    clip.mesh.visible = false;
  }
  let active;
  function animate(t, speed, airborne, spin) {
    const key = spin
      ? "WiBlV"
      : airborne
        ? "CJF1V"
        : speed > 0.4
          ? "CrR0V"
          : speed > 0.07
            ? "CrW0V"
            : "Cr20V";
    const clip = clips[key];
    if (active !== clip) {
      if (active) active.mesh.visible = false;
      clip.mesh.visible = true;
      active = clip;
    }
    clip.pose(
      spin
        ? Math.floor(spin * clip.count)
        : airborne
          ? Math.min(clip.count - 1, 6)
          : t * (speed > 0.07 ? 17 : 10),
    );
    rig.rotation.y = spin ? -Math.PI * 6 * spin : 0;
  }
  animate(0, 0, false, 0);
  return { root, animate };
}

export async function title() {
  const data = await (await fetch("./classic/TitOC.json")).json();
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(54, 1, 0.1, 2000);
  const group = new T.Group();
  scene.add(group);
  const meshes = {};
  for (const k of [
    "Ar3YV",
    "Cl3YV",
    "ThrYV",
    "LC3YV",
    "Co2YV",
    "Wa2YV",
    "RinYV",
    "Li1YV",
  ]) {
    const model = await readModel(data[k]);
    group.add(model.mesh);
    meshes[k] = model;
    if (["RinYV", "Li1YV"].includes(k))
      for (const m of model.mesh.material) {
        m.blending = T.AdditiveBlending;
        m.transparent = true;
        m.depthWrite = false;
      }
    if (k === "Wa2YV")
      for (let i = 0; i < data[k].groups.length; i++) {
        if (data[k].groups[i].path?.endsWith("-29.png")) {
          let m = model.mesh.material[i];
          m.transparent = true;
          m.blending = T.AdditiveBlending;
          m.depthWrite = false;
        }
      }
  }
  camera.position.set(0, 0, 275);
  camera.lookAt(0, 0, 0);
  const background = new T.Mesh(
    new T.PlaneGeometry(2, 2),
    new T.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { time: { value: 0 }, aspect: { value: 1 } },
      vertexShader:
        "varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.9999,1.);}",
      fragmentShader: `varying vec2 v;uniform float time,aspect;
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){vec2 p=vec2((v.x-.5)*aspect,v.y-.5);float a=sin(p.x*4.+p.y*3.+time*.07);float b=sin(p.y*12.+a*1.2+time*.06);
vec3 col=vec3(.018,.003,.06)+vec3(.105,.003,.16)*(.5+.5*a)+vec3(.022,.012,.31)*pow(.5+.5*b,5.);
vec2 grid=p*190.;float h=hash(floor(grid));if(h>.993)col+=vec3(.76,.83,1.)*smoothstep(.32,.06,length(fract(grid)-.5))*(.7+.3*sin(time+h*600.));
gl_FragColor=vec4(col,1.);}`,
    }),
  );
  background.frustumCulled = false;
  background.renderOrder = -100;
  scene.add(background);
  return {
    scene,
    camera,
    update(t, w, h) {
      const aspect = w / h;
      camera.aspect = aspect;
      camera.fov = T.MathUtils.radToDeg(
        2 * Math.atan(Math.max(136, 153 / aspect) / 275),
      );
      camera.updateProjectionMatrix();
      group.position.set(4, -4, 0);
      background.material.uniforms.time.value = t;
      background.material.uniforms.aspect.value = aspect;
      meshes.Li1YV.pose(t * 11);
      meshes.RinYV.pose(t * 5);
    },
  };
}
