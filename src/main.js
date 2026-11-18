import * as T from "three";
import { buildWorld } from "./hub.js";
import { player, title } from "./classic.js";
const $ = (s) => document.querySelector(s),
  canvas = $("#world"),
  dialog = $("dialog"),
  menu = $("#menu"),
  hints = $(".hints"),
  sound = $("#sound");
const names = [
  "Toad Village",
  "Under Pressure",
  "Orient Express",
  "Bone Yard",
  "Makin’ Waves",
  "Gee Wiz",
  "Hang ’Em High",
  "Hog Ride",
  "Tomb Time",
  "Midnight Run",
  "Dino Might!",
  "Deep Trouble",
  "High Time",
  "Road Crash",
  "Double Header",
  "Sphynxinator",
  "Bye Bye Blimps",
  "Tell No Tales",
  "Future Frenzy",
  "Tomb Wader",
  "Gone Tomorrow",
  "Orange Asphalt",
  "Flaming Passion",
  "Mad Bombers",
  "Bug Lite",
];
const chambers = ["Medieval", "Arabian", "Oriental", "Egyptian", "Future"];
const render = new T.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
render.setPixelRatio(Math.min(devicePixelRatio, 1.8));
render.shadowMap.enabled = true;
render.shadowMap.type = T.PCFShadowMap;
render.outputColorSpace = T.SRGBColorSpace;
render.toneMapping = T.ACESFilmicToneMapping;
render.toneMappingExposure = 1.13;
const scene = new T.Scene(),
  cam = new T.PerspectiveCamera(42, 1, 0.05, 155),
  [world, crash, titleScreen] = await Promise.all([
    buildWorld(scene),
    player(),
    title(),
  ]);
scene.add(crash.root);
const shadowCanvas = document.createElement("canvas");
shadowCanvas.width = shadowCanvas.height = 96;
const sc = shadowCanvas.getContext("2d"),
  g = sc.createRadialGradient(48, 48, 2, 48, 48, 46);
g.addColorStop(0, "#190e23af");
g.addColorStop(0.58, "#190e2370");
g.addColorStop(1, "#190e2300");
sc.fillStyle = g;
sc.fillRect(0, 0, 96, 96);
const shadow = new T.Mesh(
  new T.PlaneGeometry(1.65, 1.12),
  new T.MeshBasicMaterial({
    map: new T.CanvasTexture(shadowCanvas),
    transparent: true,
    depthWrite: false,
  }),
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = 0.069;
scene.add(shadow);
let activePad = -1;
let mode = "menu",
  selected = 0,
  focusPortal = -1,
  time = 0,
  ground = true,
  vy = 0,
  spin = 0,
  camYaw = 0,
  dialogKind = "",
  audio = null,
  ambient = null,
  soundOn = localStorage.warpSound === "on",
  heading = 0.15,
  transition = 1,
  gamepadButtons = [],
  touchX = 0,
  touchZ = 0,
  dialogTimer = 0;
const pos = new T.Vector3(),
  vel = new T.Vector2(),
  keys = new Set(),
  menuButtons = [$("#play"), $("#controls")],
  camGoal = new T.Vector3(),
  lookGoal = new T.Vector3(),
  look = new T.Vector3(),
  menuCam = new T.Vector3(),
  menuLook = new T.Vector3();
const pause = document.createElement("button");
pause.id = "pause";
pause.innerHTML = "Ⅱ";
pause.setAttribute("aria-label", "Pause game");
pause.hidden = true;
sound.before(pause);
function resize() {
  const w = innerWidth,
    h = innerHeight;
  render.setSize(w, h, false);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
  const portrait = w < h;
  menuCam.set(0.24, portrait ? 2.05 : 1.6, portrait ? 5.35 : 4.7);
  menuLook.set(
    portrait ? -0.72 : -cam.aspect * 0.82,
    portrait ? 0.56 : 1.04,
    -0.25,
  );
  if (mode === "menu") {
    cam.position.copy(menuCam);
    look.copy(menuLook);
    cam.lookAt(look);
  }
}
addEventListener("resize", resize);
resize();
const icon = () => {
  sound.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/>' +
    (soundOn
      ? '<path d="M16 8q4 4 0 8m3-11q6 7 0 14"/>'
      : '<path d="m17 9 5 6m0-6-5 6"/>') +
    "</svg>";
  sound.setAttribute("aria-label", soundOn ? "Mute sound" : "Enable sound");
};
function unlock() {
  if (!soundOn) return;
  if (!audio) {
    audio = new AudioContext();
    ambient = audio.createGain();
    ambient.gain.value = 0.022;
    ambient.connect(audio.destination);
    for (const freq of [110, 164.81, 220.2]) {
      let o = audio.createOscillator();
      o.frequency.value = freq;
      o.connect(ambient);
      o.start();
    }
  }
  audio.resume().catch(() => {});
}
function tone(freq, duration = 0.14, type = "sine", end = freq) {
  if (!soundOn || !audio) return;
  const o = audio.createOscillator(),
    v = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, audio.currentTime);
  o.frequency.exponentialRampToValueAtTime(end, audio.currentTime + duration);
  v.gain.setValueAtTime(0.075, audio.currentTime);
  v.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
  o.connect(v).connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + duration);
}
sound.onclick = () => {
  soundOn = !soundOn;
  localStorage.warpSound = soundOn ? "on" : "off";
  if (soundOn) {
    unlock();
    tone(440);
  } else audio?.suspend();
  icon();
};
icon();
function setSelected(i) {
  if (i !== selected) tone(390, 0.07);
  selected = i;
  menuButtons.forEach((b, j) => b.classList.toggle("selected", i === j));
}
function footer() {
  const pad = navigator.getGamepads?.()[0];
  hints.innerHTML =
    mode === "menu"
      ? pad
        ? "<kbd>↑ ↓</kbd><span>Navigate</span><kbd>A</kbd><span>Select</span>"
        : "<kbd>↑</kbd><kbd>↓</kbd><span>Navigate</span><kbd>Enter</kbd><span>Select</span>"
      : pad
        ? "<kbd>L</kbd><span>Move</span><kbd>A</kbd><span>Jump</span><kbd>X</kbd><span>Spin</span>"
        : "<kbd>WASD</kbd><span>Move</span><kbd>Space</kbd><span>Jump</span><kbd>X</kbd><span>Spin</span>";
  $("#screenName").textContent = mode === "menu" ? "MAIN MENU" : "WARP ROOM";
  if (matchMedia("(pointer:coarse)").matches)
    hints.textContent = mode === "menu" ? "Tap to select" : "";
}
function switchMode(value) {
  unlock();
  mode = value;
  const on = mode === "play";
  document.body.classList.toggle("playing", on);
  menu.hidden = on;
  pause.hidden = !on;
  $("#hud").hidden = !on;
  $("#touch").hidden = !on || !matchMedia("(pointer:coarse)").matches;
  $("#prompt").hidden = true;
  transition = 0;
  pos.set(0, world.height(0, 0) + 0.035, 0);
  vel.set(0, 0);
  vy = 0;
  ground = true;
  heading = on ? -0.65 : 0.15;
  spin = 0;
  camYaw = 0;
  focusPortal = -1;
  activePad = -1;
  world.activate(-1);
  keys.clear();
  footer();
  tone(on ? 294 : 440, 0.32, "sine", on ? 587 : 330);
}
function close() {
  dialog.close();
  dialogKind = "";
  dialogTimer = 0.18;
  keys.clear();
  touchX = touchZ = 0;
}
function modal(kind, title, html, buttons) {
  keys.clear();
  vel.set(0, 0);
  dialogKind = kind;
  $("#details").innerHTML = html;
  dialog.querySelector("h1").textContent = title;
  const actions = $("#dialogActions");
  actions.replaceChildren();
  for (const [label, fn] of buttons) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = fn;
    actions.append(b);
  }
  if (!dialog.open) dialog.showModal();
  actions.firstChild.focus();
}
function save() {
  if (mode === "play" && ground)
    localStorage.warpSlot = JSON.stringify({
      x: pos.x,
      z: pos.z,
      h: heading,
      y: pos.y,
      cam: camYaw,
    });
}
function loadGame() {
  let slot;
  try {
    slot = JSON.parse(localStorage.warpSlot || "null");
  } catch {}
  if (!slot) {
    modal(
      "load",
      "Load Game",
      "<p>No saved game. Start a new game to explore the Time Twister.</p>",
      [
        [
          "New game",
          () => {
            close();
            switchMode("play");
            save();
          },
        ],
        ["Back", close],
      ],
    );
    return;
  }
  switchMode("play");
  const y = world.height(slot.x, slot.z, slot.y + 0.5);
  if (Number.isFinite(y)) {
    pos.set(slot.x, y + 0.035, slot.z);
    camYaw = slot.cam;
    heading = slot.h;
  }
}
function controls() {
  modal(
    "controls",
    "Controls",
    [
      ["Move", "WASD / Arrows · Left stick"],
      ["Jump", "Space · A"],
      ["Spin", "X · X"],
      ["Use portal", "E · Y"],
      ["Rotate camera", "Q / R · Right stick"],
      ["Pause", "Esc · Start"],
    ]
      .map(([a, b]) => '<div class="row">' + a + "<span>" + b + "</span></div>")
      .join(""),
    [["Back", close]],
  );
}
function paused() {
  modal("pause", "Paused", "", [
    ["Resume", close],
    ["Controls", controls],
    [
      "Main menu",
      () => {
        save();
        close();
        switchMode("menu");
      },
    ],
  ]);
}
function portal() {
  if (focusPortal < 0) return;
  let i = focusPortal;
  tone(440, 0.55, "sine", 880);
  modal(
    "portal",
    names[i],
    '<div class="row">Time portal<span>' +
      String(i + 1).padStart(2, "0") +
      ' / 25</span></div><div class="row">Destination<span>' +
      chambers[Math.floor(i / 5)] +
      " chamber" +
      "</span></div><p>This destination is beyond the warp room preview.</p>",
    [
      ["Keep exploring", close],
      [
        "Warp to center",
        () => {
          close();
          switchMode("play");
        },
      ],
    ],
  );
}
dialog.addEventListener("cancel", (e) => {
  e.preventDefault();
  close();
});
pause.onclick = paused;
menuButtons.forEach((b, i) => {
  b.onpointerenter = () => setSelected(i);
  b.onfocus = () => setSelected(i);
});
$("#play").onclick = () => {
  switchMode("play");
  save();
};
$("#controls").onclick = loadGame;
footer();
function jump() {
  if (ground) {
    vy = 7.1;
    ground = false;
    tone(250, 0.19, "sine", 490);
  }
}
function doSpin() {
  if (!spin) {
    spin = 0.001;
    tone(190, 0.24, "triangle", 52);
  }
}
function act(code) {
  if (dialog.open) return;
  if (mode === "menu") {
    if (["ArrowUp", "ArrowDown", "KeyW", "KeyS"].includes(code))
      setSelected(1 - selected);
    if (code === "Enter" || code === "Space") menuButtons[selected].click();
  } else {
    if (code === "Space") jump();
    if (code === "KeyX") doSpin();
    if (code === "KeyE") portal();
    if (code === "Escape") paused();
  }
}
addEventListener("keydown", (e) => {
  if (dialog.open || (e.target === sound && e.code === "Enter")) return;
  if (
    ["Tab", "MetaLeft", "MetaRight"].includes(e.code) ||
    e.ctrlKey ||
    e.metaKey
  )
    return;
  if (e.code === "Enter" && document.activeElement === pause) return;
  e.preventDefault();
  keys.add(e.code);
  unlock();
  if (!e.repeat) act(e.code);
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => {
  keys.clear();
  touchX = touchZ = 0;
  if (mode === "play" && !dialog.open) paused();
});
addEventListener("gamepadconnected", footer);
addEventListener("gamepaddisconnected", footer);
for (const [id, fn] of [
  ["#jumpTouch", jump],
  ["#spinTouch", doSpin],
  ["#interactTouch", portal],
])
  $(id).onpointerdown = fn;
const stick = $("#stick");
function drag(e) {
  let r = stick.getBoundingClientRect(),
    x = (e.clientX - r.left - r.width / 2) / 32,
    y = (e.clientY - r.top - r.height / 2) / 32,
    m = Math.max(1, Math.hypot(x, y));
  touchX = x / m;
  touchZ = y / m;
  stick.firstChild.style.transform =
    "translate(" + touchX * 25 + "px," + touchZ * 25 + "px)";
}
stick.onpointerdown = (e) => {
  stick.setPointerCapture(e.pointerId);
  drag(e);
};
stick.onpointermove = (e) => {
  if (stick.hasPointerCapture(e.pointerId)) drag(e);
};
stick.onlostpointercapture = () => {
  touchX = touchZ = 0;
  stick.firstChild.style.transform = "";
};
const down = (...c) => (c.some((k) => keys.has(k)) ? 1 : 0);
let lastSave = 0;
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.04, (now - last) / 1000));
  last = now;
  dialogTimer = Math.max(0, dialogTimer - dt);
  const pad = Array.from(navigator.getGamepads?.() || []).find(Boolean);
  const pressed = (i) => pad?.buttons[i]?.pressed && !gamepadButtons[i];
  const axis = (i) => (Math.abs(pad?.axes[i] || 0) > 0.17 ? pad.axes[i] : 0);
  if (pad) {
    if (dialog.open) {
      const btn = [...$("#dialogActions").children];
      if (pressed(12) || pressed(13)) {
        let i = btn.indexOf(document.activeElement);
        btn[(i + (pressed(12) ? -1 : 1) + btn.length) % btn.length].focus();
      }
      if (pressed(0)) document.activeElement?.click();
      if (pressed(1) || pressed(9)) close();
    } else if (!dialogTimer) {
      if (mode === "menu") {
        if (
          pressed(12) ||
          pressed(13) ||
          (Math.abs(axis(1)) > 0.6 && !gamepadButtons[20])
        )
          setSelected(1 - selected);
        if (pressed(0) || pressed(9)) act("Enter");
      } else {
        if (pressed(0)) jump();
        if (pressed(2)) doSpin();
        if (pressed(3)) portal();
        if (pressed(9)) paused();
      }
    }
    gamepadButtons = pad.buttons.map((b) => b.pressed);
    gamepadButtons[20] = Math.abs(axis(1)) > 0.6;
  }
  const step = dialog.open ? 0 : dt;
  time += step;
  world.update(time, cam);
  transition = Math.min(1, transition + dt * 1.4);
  if (mode === "play") {
    camYaw += ((down("KeyR") - down("KeyQ")) * 1.65 + axis(2) * 2) * step;
    let x =
        down("KeyD", "ArrowRight") -
        down("KeyA", "ArrowLeft") +
        axis(0) +
        touchX,
      z =
        down("KeyS", "ArrowDown") - down("KeyW", "ArrowUp") + axis(1) + touchZ;
    const m = Math.max(1, Math.hypot(x, z));
    x /= m;
    z /= m;
    const tx = (x * Math.cos(camYaw) + z * Math.sin(camYaw)) * 4.8,
      tz = (z * Math.cos(camYaw) - x * Math.sin(camYaw)) * 4.8;
    vel.x = T.MathUtils.damp(vel.x, tx, 15, step);
    vel.y = T.MathUtils.damp(vel.y, tz, 15, step);
    const nx = pos.x + vel.x * step,
      nz = pos.z + vel.y * step;
    if (!world.blocked(pos.x, pos.z, nx, pos.z, pos.y)) pos.x = nx;
    if (!world.blocked(pos.x, pos.z, pos.x, nz, pos.y)) pos.z = nz;
    if (vel.length() > 0.12) {
      const h = Math.atan2(vel.x, vel.y);
      heading +=
        Math.atan2(Math.sin(h - heading), Math.cos(h - heading)) *
        (1 - Math.exp(-18 * step));
    }
    const floor = world.height(pos.x, pos.z, pos.y + 0.48);
    if (ground && pos.y - floor < 0.48) pos.y = floor + 0.035;
    else ground = false;
    if (!ground) {
      vy -= 19 * step;
      pos.y += vy * step;
      if (vy <= 0 && pos.y <= floor + 0.035 && pos.y > floor - 0.65) {
        pos.y = floor + 0.035;
        vy = 0;
        ground = true;
      }
      if (pos.y < -5) {
        pos.set(0, world.height(0, 0) + 0.035, 0);
        vel.set(0, 0);
        ground = true;
        vy = 0;
        tone(220, 0.25);
      }
    }
    if (time - lastSave > 2 && ground) {
      save();
      lastSave = time;
    }
    if (spin) {
      spin += step * 2.6;
      if (spin >= 1) spin = 0;
    }
    const standing = world.portals.findIndex(
      (p) => Math.hypot(pos.x - p.x, pos.z - p.z) < 1.0,
    );
    if (standing >= 0 && standing !== activePad && ground) {
      activePad = standing;
      world.activate(activePad);
      tone(370, 0.3, "sine", 740);
    }
    if (
      activePad >= 0 &&
      Math.hypot(
        pos.x - world.portals[activePad].x,
        pos.z - world.portals[activePad].z,
      ) > 11
    ) {
      activePad = -1;
      world.activate(-1);
    }
    focusPortal =
      standing >= 0
        ? standing
        : activePad >= 0 &&
            Math.hypot(
              pos.x - world.vortex.position.x,
              pos.z - world.vortex.position.z,
            ) < 2.4
          ? activePad
          : -1;
    $("#prompt").hidden = focusPortal < 0 || dialog.open;
    $("#interactTouch").hidden = focusPortal < 0;
    if (focusPortal >= 0)
      $("#prompt").textContent =
        (pad ? "Y" : matchMedia("(pointer:coarse)").matches ? "USE" : "[E]") +
        "   " +
        names[focusPortal];
    camGoal.set(
      pos.x + Math.sin(camYaw) * 10.5,
      3.8 + Math.max(0, pos.y) * 0.6,
      pos.z + Math.cos(camYaw) * 10.5,
    );
    lookGoal.set(pos.x, 1.65 + Math.max(0, pos.y) * 0.6, pos.z - 1.45);
  } else {
    pos.set(0, 0.045, 0);
    heading = -0.37 + 0.04 * Math.sin(time * 0.5);
    camGoal.copy(menuCam);
    camGoal.x += Math.sin(time * 0.14) * 0.055;
    lookGoal.copy(menuLook);
  }
  const damp = 1 - Math.exp(-dt * (transition < 1 ? 4 : 8));
  cam.position.lerp(camGoal, damp);
  look.lerp(lookGoal, damp);
  cam.lookAt(look);
  crash.root.position.copy(pos);
  crash.root.rotation.y = heading;
  crash.animate(
    time,
    mode === "play" ? Math.min(1, vel.length() / 4.8) : 0,
    !ground,
    spin,
  );
  const sy = world.height(pos.x, pos.z, pos.y + 0.13);
  shadow.position.set(pos.x, Number.isFinite(sy) ? sy + 0.025 : 0, pos.z);
  shadow.visible = Number.isFinite(sy) && mode === "play";
  shadow.material.opacity = Math.max(0.2, 1 - Math.max(0, pos.y) * 0.4);
  if (mode === "menu") {
    titleScreen.update(time, innerWidth, innerHeight);
    render.render(titleScreen.scene, titleScreen.camera);
  } else render.render(scene, cam);
}
document.body.classList.add("ready");
requestAnimationFrame(frame);
