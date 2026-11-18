# Warped audio assets
- `title.ogg/.mp3`: Title Screen music. Rendered from `3C.NSF` (type-13 VAB+SEQ, type-14 VB wave bank). 133 bpm; intro (0–7.22 s) then loop (CC99 20..30 markers).
- `tt.ogg/.mp3`: Time Twister music. Rendered from `02.NSF`. 141 bpm, 78.3 s, whole-song loop. Loop points are sample-exact (see `manifest.json`, 48 kHz).
- `sfx/*.wav`: original procedural SFX (spin, jump, menu, confirm, pad, portal, respawn), 32 kHz mono.
- `_src/`: build tools. `node _src/render.mjs <NSF> <out.wav> whole|intro-loop` (SPU-style sampler: ADPCM decode, ADSR, pan, reverb), `node _src/sfx.mjs <dir>`. Encode: `ffmpeg -i x.wav -c:a libopus -b:a 112k x.ogg` and `-c:a libmp3lame -b:a 160k x.mp3`.
