// Offline PS1 SPU-style renderer: VAB+SEQ -> looping stereo WAV (float32 -> 16-bit PCM).
// usage: node render.mjs <NSF> <out.wav> <whole|intro-loop>
import fs from 'node:fs';
import { readMusic } from './nsf.mjs';

const SR = 48000; // output rate (Opus-native); SPU samples are nominally 44.1 kHz
const K = SR / 44100;

function makeVoice(tone, vag, note, vel, chan, prog, vab, start) {
  const semis = note - tone.center + tone.shift / 128;
  const gain = (vel / 127) * (tone.vol / 127) * (prog.vol / 127) * (vab.masterVol / 127) * (chan.vol / 127) * (chan.expr / 127);
  const pan = Math.max(0, Math.min(127, tone.pan + (chan.pan - 64) + (prog.pan - 64))) / 127;
  return {
    vag, pos: 0, rate: Math.pow(2, semis / 12) * 44100 / SR, start, end: -1,
    l: gain * Math.cos(pan * Math.PI / 2) * Math.SQRT2, r: gain * Math.sin(pan * Math.PI / 2) * Math.SQRT2,
    a1: tone.adsr1, a2: tone.adsr2, phase: 0, level: 0, cnt: 0, key: note, ch: 0,
  };
}

function envParams(v) {
  const a1 = v.a1, a2 = v.a2;
  switch (v.phase) {
    case 0: return [(a1 >> 15) & 1, 0, (a1 >> 10) & 31, 7 - ((a1 >> 8) & 3)];
    case 1: return [1, 1, (a1 >> 4) & 15, -8];
    case 2: { const dec = (a2 >> 14) & 1; return [(a2 >> 15) & 1, dec, (a2 >> 8) & 31, dec ? -8 + ((a2 >> 6) & 3) : 7 - ((a2 >> 6) & 3)]; }
    default: return [(a2 >> 5) & 1, 1, a2 & 31, -8];
  }
}
function envTick(v) {
  const [exp, dec, shift, step0] = envParams(v);
  let cycles = 1 << Math.max(0, shift - 11);
  let step = step0 * (1 << Math.max(0, 11 - shift));
  if (exp && !dec && v.level > 0x6000) cycles <<= 2;
  if (exp && dec) step = (step * v.level) >> 15;
  if (--v.cnt <= 0) {
    v.cnt = cycles;
    v.level = Math.max(0, Math.min(0x7fff, v.level + step));
  }
  if (v.phase === 0 && v.level >= 0x7fff) v.phase = 1;
  if (v.phase === 1 && v.level <= (((v.a1 & 15) + 1) * 0x800)) v.phase = 2;
}

function render(music, startTick, endTick, totalSamples, tickOffsetSamples) {
  // returns dry stereo for ticks [startTick,endTick) mapped to sample time starting at tickOffsetSamples
  const { vab, seq } = music;
  const L = new Float32Array(totalSamples), R = new Float32Array(totalSamples);
  return { L, R };
}

// Build tick->sample map honoring tempo events
function tickMap(seq) {
  const pts = [{ t: 0, s: 0, tempo: seq.tempo }];
  for (const e of seq.events) if (e.k === 'tempo') {
    const p = pts[pts.length - 1];
    pts.push({ t: e.t, s: p.s + (e.t - p.t) * p.tempo / 1e6 / seq.res * SR, tempo: e.v });
  }
  return (t) => { let p = pts[0]; for (const q of pts) if (q.t <= t) p = q; return p.s + (t - p.t) * p.tempo / 1e6 / seq.res * SR; };
}

function playSequence(music, passes, L, R) {
  // passes: [{from,to,offset}] tick ranges played back-to-back; offset = sample start
  const { vab, seq } = music;
  const t2s = tickMap(seq);
  const voices = [];
  let cursor = 0;
  const ev = seq.events.filter((e) => e.k !== 'end');
  for (const pass of passes) {
    const chans = Array.from({ length: 16 }, () => ({ prog: 0, vol: 127, expr: 127, pan: 64 }));
    const base = pass.offset - t2s(pass.from);
    const active = [];
    for (const e of ev) {
      if (e.t < pass.from && !(e.k === 'pc' || e.k === 'cc')) continue;
      if (e.t >= pass.to) break;
      const s = Math.round(base + t2s(e.t));
      if (e.k === 'pc') chans[e.ch].prog = e.v;
      else if (e.k === 'cc') { const c = chans[e.ch]; if (e.c === 7) c.vol = e.v; else if (e.c === 11) c.expr = e.v; else if (e.c === 10) c.pan = e.v; }
      else if (e.k === 'on') {
        const ch = chans[e.ch], prog = vab.progs[ch.prog];
        if (!prog) continue;
        for (const tone of prog.list) {
          if (e.n < tone.min || e.n > tone.max) continue;
          const v = makeVoice(tone, vab.vags[tone.vag], e.n, e.v, ch, prog, vab, s);
          v.ch = e.ch; voices.push(v); active.push(v);
        }
      } else if (e.k === 'off') {
        for (let i = active.length - 1; i >= 0; i--) { const v = active[i]; if (v.ch === e.ch && v.key === e.n && v.end < 0) { v.end = s; active.splice(i, 1); break; } }
      }
    }
    // pass end: release anything still held
    const endS = Math.round(base + t2s(pass.to));
    for (const v of active) if (v.end < 0) v.end = endS;
  }
  const N = L.length;
  for (const v of voices) {
    const pcm = v.vag.pcm, len = pcm.length, loop = v.vag.loop, ls = v.vag.loopStart;
    let i = v.start, pos = 0;
    for (; i < N; i++) {
      if (i === v.end) v.phase = 3;
      if (i >= v.start) envTick(v);
      if (v.phase === 3 && v.level <= 0) break;
      let ip = pos | 0;
      if (ip >= len) { if (loop) { pos = ls + ((pos - ls) % (len - ls)); ip = pos | 0; } else break; }
      const f = pos - ip;
      const g = (n) => { let k = ip + n; if (k >= len) k = loop ? ls + ((k - ls) % (len - ls)) : len - 1; return k < 0 ? 0 : pcm[k]; };
      const y0 = g(-1), y1 = g(0), y2 = g(1), y3 = g(2);
      const smp = y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
      const e = smp * v.level / 32767;
      if (i >= 0) { L[i] += e * v.l; R[i] += e * v.r; }
      pos += v.rate;
    }
  }
}

// Freeverb-style stereo reverb (applied to dry mix; wet added)
function reverb(L, R, wet = 0.2, room = 0.82, damp = 0.35) {
  const N = L.length, tune = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((x) => Math.round(x * K)), ap = [556, 441, 341, 225].map((x) => Math.round(x * K)), spread = Math.round(23 * K);
  const outL = new Float32Array(N), outR = new Float32Array(N);
  const run = (inp, sp, out) => {
    const combs = tune.map((t) => ({ b: new Float32Array(t + sp), i: 0, s: 0 }));
    const aps = ap.map((t) => ({ b: new Float32Array(t + sp), i: 0 }));
    for (let n = 0; n < N; n++) {
      const x = inp[n] * 0.015; let y = 0;
      for (const c of combs) {
        const o = c.b[c.i]; c.s = o * (1 - damp) + c.s * damp; c.b[c.i] = x + c.s * room;
        if (++c.i >= c.b.length) c.i = 0; y += o;
      }
      for (const a of aps) { const bo = a.b[a.i]; const o = bo - y; a.b[a.i] = y + bo * 0.5; if (++a.i >= a.b.length) a.i = 0; y = o; }
      out[n] = y;
    }
  };
  const mono = new Float32Array(N); for (let n = 0; n < N; n++) mono[n] = (L[n] + R[n]) * 0.5;
  run(mono, 0, outL); run(mono, spread, outR);
  for (let n = 0; n < N; n++) { L[n] += outL[n] * wet * 3; R[n] += outR[n] * wet * 3; }
}

export function renderSong(nsf, mode) {
  const music = readMusic(nsf), seq = music.seq, t2s = tickMap(seq);
  const endTick = seq.events.find((e) => e.k === 'end').t;
  const ccs = seq.events.filter((e) => e.k === 'cc' && e.c === 99);
  const tail = SR * 6;
  let out;
  if (mode === 'whole') {
    const T = Math.round(t2s(endTick));
    const L = new Float32Array(T * 2 + tail), R = new Float32Array(T * 2 + tail);
    playSequence(music, [{ from: 0, to: endTick, offset: 0 }, { from: 0, to: endTick, offset: T }], L, R);
    reverb(L, R);
    out = { L: L.slice(T, 2 * T), R: R.slice(T, 2 * T), loopStart: 0, loopEnd: T, introEnd: 0 };
  } else {
    const ls = ccs.find((e) => e.v === 20).t, le = ccs.find((e) => e.v === 30).t;
    const I = Math.round(t2s(ls)), B = Math.round(t2s(le) - t2s(ls));
    const L = new Float32Array(I + B * 3 + tail), R = new Float32Array(I + B * 3 + tail);
    playSequence(music, [{ from: 0, to: ls, offset: 0 }, { from: ls, to: le, offset: I }, { from: ls, to: le, offset: I + B }, { from: ls, to: le, offset: I + 2 * B }], L, R);
    reverb(L, R);
    const oL = new Float32Array(I + B), oR = new Float32Array(I + B);
    oL.set(L.subarray(0, I)); oR.set(R.subarray(0, I));
    oL.set(L.subarray(I + 2 * B, I + 3 * B), I); oR.set(R.subarray(I + 2 * B, I + 3 * B), I);
    // crossfade the end of the intro toward the loop's end content so intro->loop is continuous
    const X = 2048;
    for (let k = 0; k < X; k++) {
      const w = (k + 1) / X, a = I - X + k, b = I + 2 * B - X + k;
      oL[a] = L[a] * (1 - w) + L[b] * w; oR[a] = R[a] * (1 - w) + R[b] * w;
    }
    out = { L: oL, R: oR, loopStart: I, loopEnd: I + B, introEnd: I };
  }
  return out;
}

export function writeWav(path, L, R, gain = 1) {
  const n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28);
  b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    for (const [c, ch] of [[0, L], [1, R]]) {
      const x = Math.tanh(ch[i] * gain * 0.9) / 0.9; // soft limiter
      b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), 44 + i * 4 + c * 2);
    }
  }
  fs.writeFileSync(path, b);
}

if (process.argv[1].endsWith('render.mjs')) {
  const [, , nsf, out, mode] = process.argv;
  const r = renderSong(nsf, mode);
  let ss = 0; for (let i = 0; i < r.L.length; i++) ss += r.L[i] ** 2 + r.R[i] ** 2;
  const rms = Math.sqrt(ss / (2 * r.L.length));
  const gain = Math.pow(10, -17 / 20) / rms; // normalise loudness to -17 dBFS RMS
  writeWav(out, r.L, r.R, gain);
  fs.writeFileSync(out + '.json', JSON.stringify({ samples: r.L.length, rate: SR, loopStart: r.loopStart, loopEnd: r.loopEnd, rms, gain }));
  console.log(out, r.L.length / SR + 's', 'loop', r.loopStart, r.loopEnd, 'rms', rms.toFixed(4), 'gain', gain.toFixed(2));
}
