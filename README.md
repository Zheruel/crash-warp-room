# Crash Bandicoot: Warped · Time Twister

[Play the warp room in your browser](https://zheruel.github.io/crash-warp-room/)

A Three.js recreation of the 1998 PlayStation title screen and Time Twister hub. Choose **New Game**, cross a bridge, and step on a numbered switch to open its portal. **Load Game** restores the last saved position on this browser. The playable area ends at the portals.

| Action | Keyboard | Controller |
| --- | --- | --- |
| Move | WASD or arrow keys | Left stick |
| Jump | Space | A |
| Spin | X | X |
| Inspect a portal | E | Y |
| Pause | Escape | Start |

Touch controls appear on touchscreens. The camera follows the original hub and bridge rails automatically. Jump into an open portal to inspect its destination. Sound starts after the first interaction and can be toggled with the speaker button.

## Run locally

Use Node.js 24. Run `npm ci` and `npm run dev` from the project directory. For a static deployment, run `npm run build` and serve the contents of `dist/`.

## Credits

The original game was developed by Naughty Dog. The recreation uses PlayStation scene, animation, and camera data. The title and hub music were rendered from the PlayStation sequences and instrument banks. Action sounds were decoded from the original ADPCM samples. The [noclip.website CrashWarped implementation](https://github.com/magcius/noclip.website/tree/main/src/CrashWarped) provided the format reference for the Three.js conversion. This is an unofficial fan project.
