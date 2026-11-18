// Warped audio: PS1 title + Time Twister music (rendered from the original SEQ/VAB data) and original SFX.
// createAudio() -> { unlock(), setMode('menu'|'play'), setMuted(bool), setPaused(bool), play(cue) }
// cues: spin jump menu confirm pad portal respawn

const RATE = 48000; // sample rate the music files were rendered at (loop points are in these samples)
const MUSIC = {
  menu: {
    file: "title",
    gain: 0.62,
    loopStart: 346330 / RATE,
    loopEnd: 2078748 / RATE,
  }, // intro, then loops
  play: { file: "tt", gain: 0.5, loopStart: 0, loopEnd: 3758290 / RATE },
};
const CUES = {
  step: { bus: "world", gain: 0.32, rate: [0.97, 1.03] },
  land: { bus: "world", gain: 0.65, rate: [1, 1] },
  spin: { bus: "world", gain: 0.55, rate: [0.96, 1.05], single: true },
  jump: { bus: "world", gain: 0.5, rate: [0.95, 1.06] },
  menu: { bus: "ui", gain: 0.4, rate: [0.98, 1.03], min: 0.035 },
  confirm: { bus: "ui", gain: 0.5, rate: [1, 1] },
  pad: { bus: "world", gain: 0.5, rate: [1, 1], duck: [0.55, 0.9] },
  portal: {
    bus: "world",
    gain: 0.55,
    rate: [1, 1],
    single: true,
    duck: [0.35, 1.3],
  },
  respawn: { bus: "world", gain: 0.5, rate: [1, 1], duck: [0.6, 0.9] },
};
const FADE = { mode: 0.8, start: 0.35, resume: 0.25, pause: 0.12 };

export function createAudio(options = {}) {
  const AC =
    typeof window !== "undefined" &&
    (window.AudioContext || window.webkitAudioContext);
  const dir = new URL(options.base || "./audio/", document.baseURI).href;

  let ctx = null,
    master,
    musicBus,
    duckBus,
    uiBus,
    worldBus;
  let mode = "menu",
    muted = false,
    paused = false,
    hidden = false,
    unlocked = false;
  const buffers = new Map(); // url-key -> Promise<AudioBuffer|null>
  const offsets = { menu: 0, play: 0 }; // resume position (s) per track
  let live = null; // {name, src, gain, t0, off}
  const lastCue = new Map(),
    lastTime = new Map(),
    pending = [];
  let worldSources = new Set();

  const now = () => ctx.currentTime;
  const ramp = (param, to, dur, t = now()) => {
    try {
      if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
      else {
        param.cancelScheduledValues(t);
        param.setValueAtTime(param.value, t);
      }
      param.linearRampToValueAtTime(to, t + Math.max(0.005, dur));
    } catch {
      param.value = to;
    }
  };
  const curve = (param, from, to, dur) => {
    // equal-power-ish fade
    const n = 24,
      c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      c[i] =
        from +
        (to - from) *
          (to > from
            ? Math.sin((k * Math.PI) / 2)
            : 1 - Math.sin(((1 - k) * Math.PI) / 2));
    }
    try {
      param.cancelScheduledValues(now());
      param.setValueAtTime(from, now());
      param.setValueCurveAtTime(c, now(), Math.max(0.02, dur));
    } catch {
      ramp(param, to, dur);
    }
  };

  function load(url) {
    if (!buffers.has(url)) {
      buffers.set(
        url,
        fetch(url)
          .then((r) => {
            if (!r.ok) throw new Error(r.status);
            return r.arrayBuffer();
          })
          .then(
            (d) =>
              new Promise((ok, no) => {
                const p = ctx.decodeAudioData(d, ok, no);
                if (p && p.catch) p.catch(no);
              }),
          )
          .catch(() => null),
      );
    }
    return buffers.get(url);
  }
  async function loadFirst(urls) {
    for (const u of urls) {
      const b = await load(dir + u);
      if (b) return b;
      buffers.delete(dir + u);
    }
    return null;
  }
  const canOpus = () => {
    try {
      return !!new Audio().canPlayType('audio/ogg; codecs="opus"');
    } catch {
      return false;
    }
  };
  const musicBuffer = (name) => {
    const f = MUSIC[name].file;
    return loadFirst(
      canOpus() ? [f + ".ogg", f + ".mp3"] : [f + ".mp3", f + ".ogg"],
    );
  };
  const sfxBuffer = (cue) => load(`${dir}sfx/${cue}.wav`);

  // ---- music -------------------------------------------------------------------------------
  function position() {
    if (!live) return 0;
    const m = MUSIC[live.name];
    let p = live.off + (now() - live.t0);
    if (p >= m.loopEnd)
      p = m.loopStart + ((p - m.loopStart) % (m.loopEnd - m.loopStart));
    return p;
  }
  function halt(fade) {
    const l = live;
    live = null;
    if (!l) return;
    curve(l.gain.gain, l.gain.gain.value, 0, fade);
    try {
      l.src.stop(now() + fade + 0.05);
    } catch {}
    setTimeout(
      () => {
        try {
          l.gain.disconnect();
        } catch {}
      },
      (fade + 0.2) * 1000,
    );
  }
  const wanted = () => (!paused && !hidden ? mode : null);
  let token = 0;
  // Reconcile playing music with (mode, paused, hidden). Callers store resume offsets before changing state.
  async function sync() {
    if (!ctx || !unlocked) return;
    const want = wanted();
    if (live && live.name === want) return;
    halt(want === null ? FADE.pause : FADE.mode);
    if (!want) {
      token++;
      return;
    }
    const mine = ++token,
      buf = await musicBuffer(want);
    if (!buf || mine !== token || wanted() !== want || live) return;
    const m = MUSIC[want],
      src = ctx.createBufferSource(),
      g = ctx.createGain();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = m.loopStart;
    src.loopEnd = Math.min(m.loopEnd, buf.duration);
    g.gain.value = 0;
    src.connect(g);
    g.connect(duckBus);
    let off = offsets[want] || 0;
    if (off >= src.loopEnd) off = src.loopStart;
    const t = now();
    src.start(t, off);
    live = { name: want, src, gain: g, t0: t, off };
    curve(g.gain, 0, m.gain, off > 0 ? FADE.resume : FADE.start);
  }

  // ---- sfx ---------------------------------------------------------------------------------
  function fire(cue) {
    const d = CUES[cue],
      buf = buffers.get(`${dir}sfx/${cue}.wav`);
    if (!d || !ctx || !unlocked) return false;
    Promise.resolve(buf).then((b) => {
      if (!b || muted || (d.bus === "world" && paused)) return;
      const t = now(),
        prev = lastCue.get(cue);
      if (d.min && t - (lastTime.get(cue) || -1) < d.min) return;
      lastTime.set(cue, t);
      if (d.single && prev) {
        try {
          prev.g.gain.cancelScheduledValues(t);
          prev.g.gain.setValueAtTime(prev.g.gain.value, t);
          prev.g.gain.linearRampToValueAtTime(0, t + 0.04);
          prev.s.stop(t + 0.06);
        } catch {}
      }
      const s = ctx.createBufferSource(),
        g = ctx.createGain();
      s.buffer = b;
      s.playbackRate.value =
        d.rate[0] + Math.random() * (d.rate[1] - d.rate[0]);
      g.gain.value = d.gain;
      s.connect(g);
      g.connect(d.bus === "ui" ? uiBus : worldBus);
      s.start(t);
      const rec = { s, g };
      lastCue.set(cue, rec);
      if (d.bus === "world") worldSources.add(rec);
      s.onended = () => {
        worldSources.delete(rec);
        try {
          g.disconnect();
        } catch {}
        if (lastCue.get(cue) === rec) lastCue.delete(cue);
      };
      if (d.duck) {
        // dip the music under big cues, then swell back
        const p = duckBus.gain;
        try {
          p.cancelScheduledValues(t);
          p.setValueAtTime(p.value, t);
          p.linearRampToValueAtTime(d.duck[0], t + 0.06);
          p.setValueAtTime(d.duck[0], t + d.duck[1]);
          p.linearRampToValueAtTime(1, t + d.duck[1] + 0.6);
        } catch {}
      }
    });
    return true;
  }

  // ---- public ------------------------------------------------------------------------------
  function applyMaster() {
    if (ctx) ramp(master.gain, muted ? 0 : 1, 0.05);
  }
  function applyWorld() {
    if (!ctx) return;
    if (paused) {
      ramp(worldBus.gain, 0, 0.04);
      const t = now() + 0.06;
      worldSources.forEach((r) => {
        try {
          r.s.stop(t);
        } catch {}
      });
      worldSources.clear();
    } else ramp(worldBus.gain, 1, 0.05);
  }

  function build() {
    ctx = new AC({ latencyHint: "interactive" });
    master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    master.connect(comp);
    comp.connect(ctx.destination);
    duckBus = ctx.createGain();
    musicBus = duckBus;
    uiBus = ctx.createGain();
    worldBus = ctx.createGain();
    duckBus.connect(master);
    uiBus.connect(master);
    worldBus.connect(master);
    master.gain.value = muted ? 0 : 1;
    ctx.onstatechange = () => {
      if (ctx.state === "interrupted") ctx.resume().catch(() => {});
    };
  }

  function unlock() {
    if (unlocked && ctx?.state === "running") return Promise.resolve(true);
    if (!AC) return Promise.resolve(false);
    try {
      if (!ctx) build();
      // play a silent buffer inside the gesture so iOS/Safari really starts the context
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
    } catch {
      return Promise.resolve(false);
    }
    const ready =
      ctx.state === "running"
        ? Promise.resolve()
        : ctx.resume().catch(() => {});
    return ready.then(() => {
      if (!unlocked) {
        unlocked = true;
        Object.keys(CUES).forEach((c) => sfxBuffer(c));
        sync().then(() => {
          Object.keys(MUSIC).forEach((m) => musicBuffer(m));
        });
        // flush cues requested while loading (only if still fresh)
        Promise.all(Object.keys(CUES).map((c) => sfxBuffer(c))).then(() => {
          const t = performance.now();
          pending.splice(0).forEach(([c, at]) => {
            if (t - at < 400) fire(c);
          });
        });
      }
      sync();
      return ctx.state === "running";
    });
  }

  function play(cue) {
    if (muted || !CUES[cue]) return false;
    if (!ctx || !unlocked) {
      if (AC) {
        pending.push([cue, performance.now()]);
        if (pending.length > 6) pending.shift();
        unlock();
      }
      return false;
    }
    if (CUES[cue].bus === "world" && paused) return false;
    if (!buffers.has(`${dir}sfx/${cue}.wav`)) sfxBuffer(cue);
    return fire(cue);
  }
  function setMode(m) {
    if (m !== "menu" && m !== "play") return;
    if (m === mode) return;
    offsets[mode] = 0;
    mode = m;
    sync();
  }
  function setMuted(v) {
    muted = !!v;
    applyMaster();
  }
  function setPaused(v) {
    v = !!v;
    if (v === paused) return;
    if (v && live) offsets[live.name] = position();
    paused = v;
    applyWorld();
    sync();
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      const h = document.hidden;
      if (h === hidden) return;
      if (h && live) offsets[live.name] = position();
      hidden = h;
      if (ctx && !h && ctx.state !== "running" && unlocked)
        ctx.resume().catch(() => {});
      sync();
    });
  }
  return { unlock, setMode, setMuted, setPaused, play };
}
