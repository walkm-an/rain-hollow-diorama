# Rain Hollow

[中文](README.md)

A pixel-art Halloween night that loops every 120 seconds, meant as the cover of a 10-hour lofi video. The night and the rain stay cold. Warm light stays in the windows, the door, the lanterns, and the fire. Every pixel is drawn by code. The repo contains no bitmaps. The internal frame is 480×270 and scales to the window with nearest-neighbor filtering, so a 1080p screen stays on whole pixels.

## Run it locally

Node.js 22 is required.

```bash
npm install
npm run dev
```

Open http://127.0.0.1:47321 . Press F for fullscreen, H for the time and render readout, and Space to pause or resume.

The address takes two parameters.

- `?t=41&paused=1` holds the picture at 41 seconds. Lightning peaks at 41.0 seconds and again at 97.5 seconds.
- `?hud=1` shows the readout in the top left.

## Build a file you can open

```bash
npm run build
```

The build writes one file, `dist/index.html`, with the script inlined. Open it with a double-click or a `file://` URL.

## Check the loop and the memory

`render(t)` depends only on t, and it repeats every 120 seconds. Every particle lifetime divides 120, so a particle count at one phase of the loop matches the next loop. The pixels at t and at t + 120 match, and the frame that crosses 120 seconds looks like any other frame step.

```bash
npm run verify
```

That command builds, writes three 1920×1080 screenshots, records a 10-second mp4, compares pixels across the loop, and then runs an accelerated simulation for at least 5 minutes of wall time. Reports land in `artifacts/`.

You can run the parts on their own.

- `npm run shots` writes t = 12, 41, and 78 to `artifacts/screenshots/`.
- `npm run record` records 10 seconds from t = 35, which includes the first lightning strike, to `artifacts/recording-10s.mp4`.
- `npm run record -- --start 0 --duration 120 --out artifacts/loop-120s.mp4` exports one full loop for playback.
- `npm run loop-check` compares pixels at t and t + 120, and compares the loop point with an ordinary 1/60 second step.
- `npm run soak` renders consecutive 1/60 second frames for at least 330 seconds of wall time and checks heap, DOM nodes, and particle counts.

Screenshots and the recording need Google Chrome and ffmpeg on the machine.

## The scene

A cut-away block of earth floats in the rain. From left to right there is a small graveyard, a crooked witch's cottage, a pumpkin patch, and a campfire with a cauldron. A black cat sits on a stump beside the fire. Smoke rises from the chimney and the fire. Rain falls in three depths. Water drips from the eaves and from the underside of the block.
