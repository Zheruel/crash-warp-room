// Minimal Crash Bandicoot 3 (Naughty Dog) NSF reader + PS1 VAB/SEQ/ADPCM tools.
import fs from 'node:fs';

export function readNSF(path) {
  const d = fs.readFileSync(path);
  const entries = [];
  for (let p = 0; p < d.length / 0x10000; p++) {
    const pg = d.subarray(p * 0x10000, (p + 1) * 0x10000);
    if (pg.readUInt16LE(0) !== 0x1234) continue;
    const n = pg.readUInt32LE(8);
    for (let i = 0; i < n; i++) {
      const a = pg.readUInt32LE(0x10 + 4 * i), b = pg.readUInt32LE(0x14 + 4 * i);
      const e = pg.subarray(a, b);
      if (e.length < 16 || e.readUInt32LE(0) !== 0x0100ffff) continue;
      const count = e.readUInt32LE(12);
      const offs = [];
      for (let k = 0; k <= count; k++) offs.push(e.readUInt32LE(16 + 4 * k));
      const items = [];
      for (let k = 0; k < count; k++) items.push(e.subarray(offs[k], offs[k + 1]));
      entries.push({ page: p, index: i, id: e.readUInt32LE(4), type: e.readUInt32LE(8), items });
    }
  }
  return entries;
}

// type 13 = VAB header + SEQ, type 14 = VB wave bank pages (concatenated in page order)
export function readMusic(nsfPath) {
  const es = readNSF(nsfPath);
  const m = es.find((e) => e.type === 13);
  const vabBuf = m.items[1], seq = m.items[2];
  const vb = Buffer.concat(es.filter((e) => e.type === 14).map((e) => e.items[1]));
  return { vab: parseVAB(vabBuf, vb), seq: parseSEQ(seq) };
}

export function parseVAB(b, vb) {
  if (b.toString('latin1', 0, 4) !== 'pBAV') throw new Error('not VAB');
  const ps = b.readUInt16LE(18), ts = b.readUInt16LE(20), vs = b.readUInt16LE(22);
  const masterVol = b[24], masterPan = b[25];
  let p = 32;
  const progs = [];
  for (let i = 0; i < 128; i++, p += 16) progs.push({ tones: b[p], vol: b[p + 1], pan: b[p + 4], list: [] });
  for (let i = 0; i < 128; i++) {
    if (!progs[i].tones) continue;
    for (let j = 0; j < 16; j++, p += 32) {
      progs[i].list.push({
        vol: b[p + 2], pan: b[p + 3], center: b[p + 4], shift: b[p + 5], min: b[p + 6], max: b[p + 7],
        adsr1: b.readUInt16LE(p + 16), adsr2: b.readUInt16LE(p + 18), vag: b.readInt16LE(p + 22),
      });
    }
    progs[i].list = progs[i].list.filter((t) => t.vag > 0);
  }
  const sizes = [];
  for (let i = 0; i < 256; i++, p += 2) sizes.push(b.readUInt16LE(p) * 8);
  const vags = [];
  let off = 0;
  for (let i = 1; i <= vs; i++) { vags[i] = decodeVAG(vb.subarray(off, off + sizes[i])); off += sizes[i]; }
  if (off !== vb.length) console.warn('VB size mismatch', off, vb.length);
  return { masterVol, masterPan, progs, vags, ps, ts, vs };
}

const F = [[0, 0], [60, 0], [115, -52], [98, -55], [122, -60]];
// SPU-ADPCM -> Float32 (-1..1) with loop info
export function decodeVAG(buf) {
  const nb = buf.length / 16, out = new Float32Array(nb * 28);
  let s1 = 0, s2 = 0, loopStart = -1, loopEnd = -1, ended = -1;
  for (let k = 0; k < nb; k++) {
    const o = k * 16, shift = buf[o] & 15, filt = Math.min(buf[o] >> 4, 4), flags = buf[o + 1];
    if (flags & 4) loopStart = k * 28;
    for (let i = 0; i < 28; i++) {
      let nib = (buf[o + 2 + (i >> 1)] >> ((i & 1) * 4)) & 15;
      if (nib & 8) nib -= 16;
      let s = (nib << 12) >> shift;
      s += (s1 * F[filt][0] + s2 * F[filt][1] + 32) >> 6;
      s = s > 32767 ? 32767 : s < -32768 ? -32768 : s;
      s2 = s1; s1 = s;
      out[k * 28 + i] = s / 32768;
    }
    if (flags & 1) { ended = (k + 1) * 28; if (flags & 2) loopEnd = ended; else loopEnd = -1; break; }
  }
  const len = ended > 0 ? ended : out.length;
  return { pcm: out.subarray(0, len), loop: loopEnd > 0, loopStart: Math.max(0, loopStart) };
}

export function parseSEQ(b) {
  if (b.toString('latin1', 0, 4) !== 'pQES') throw new Error('not SEQ');
  const res = b.readUInt16BE(8);
  let tempo = (b[10] << 16) | (b[11] << 8) | b[12];
  let p = 16, t = 0, run = 0x90;
  const ev = [];
  const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 127); } while (c & 128); return v; };
  while (p < b.length) {
    t += vlq();
    let s = b[p];
    if (s & 0x80) { p++; run = s; } else s = run;
    const ty = s & 0xf0, ch = s & 15;
    if (s === 0xff) {
      const mt = b[p++];
      if (mt === 0x51) { ev.push({ t, k: 'tempo', v: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] }); p += 3; }
      else if (mt === 0x2f) { ev.push({ t, k: 'end' }); break; }
      else throw new Error('meta ' + mt);
    } else if (ty === 0x90) { const n = b[p++], v = b[p++]; ev.push({ t, k: v ? 'on' : 'off', ch, n, v }); }
    else if (ty === 0x80) { const n = b[p++]; p++; ev.push({ t, k: 'off', ch, n }); }
    else if (ty === 0xb0) { ev.push({ t, k: 'cc', ch, c: b[p], v: b[p + 1] }); p += 2; }
    else if (ty === 0xc0) { ev.push({ t, k: 'pc', ch, v: b[p++] }); }
    else if (ty === 0xe0) { ev.push({ t, k: 'bend', ch, v: (b[p + 1] << 7) | b[p] }); p += 2; }
    else throw new Error('status ' + s.toString(16));
  }
  return { res, tempo, events: ev };
}
