# TILT LAB · Head-Tilt Marble Maze

Tilt a floating maze board **with your head**: lean left/right to roll the board sideways,
nod up/down to pitch it. The ball rolls under gravity, bounces a little off the walls,
falling into a hole sends it back to the start, and rolling into the distant **green door** clears the level.
When your face leaves the frame the board levels out / the game pauses (configurable).

* **3D:** three.js (`vendor/three.module.js`, vendored — no CDN needed)
* **Face tracking:** MediaPipe FaceLandmarker (`vendor/mediapipe/`, local wasm + model, **fully offline**, no video ever leaves the machine)
* **Physics:** hand-written sphere-vs-OBB solver (position correction + restitution + friction + rotating-board carry), fixed 120 Hz substeps
* **Levels:** procedurally generated mazes (recursive backtracker + extra loops + safe hole punching), every hole validated with BFS so a route always exists

## Run

It must be served over http (ES modules and camera access are blocked on `file://`):

```bash
node tools/serve.mjs            # http://127.0.0.1:8123
node tools/serve.mjs 9000       # or pick a port
```

Then open <http://127.0.0.1:8123>. Camera access works on `localhost` (a secure context) without https.

Level self-check (prints every maze as ASCII and verifies connectivity):

```bash
node tools/check-levels.mjs
```

## First run

**Keyboard / drag is the default path** — press *Play with keyboard / drag* and go. A ghost hint sits on
the canvas (`WASD / arrows tilt · R restart`) until you actually tilt. Head control is an upgrade you can
turn on any time from the start screen or the settings drawer.

Level 1 is a hand-authored ~20 s tutorial: two long lanes end in a wall (so you feel the bounce and then
steer into the side opening) and a pit cluster forces you to hug the edge before the green door.
Floating labels mark each beat.

## Controls

| Input | Action |
| --- | --- |
| Tilt head left / right | board rolls sideways (roll) |
| Nod up / down | board pitches forward / back (pitch) |
| Arrow keys / WASD | tilt the board (no camera needed — switch any time) |
| Mouse / finger drag | drag a side down to tilt that way |
| `C` | re-calibrate the neutral head pose |
| `R` | restart the level |
| `Esc` / `P` / ⚙ | settings & pause (sensitivity, invert X/Y, pause-on-face-lost, mute) |
| `F` | fullscreen |
| Save clip | clear screen or settings drawer — shares/downloads the last 8 s |

Sensitivity, both invert toggles and "pause when the face is lost" are in the settings drawer —
if a control feels reversed, flip it there. Level 1 is the easiest and has no holes; later levels are
bigger, loopier and full of pits.

## Layout

```
index.html             page + UI (HUD, camera preview, tilt indicator, settings drawer)
src/main.js            game loop, state machine, HUD, level flow
src/board.js           tiltable board: instanced maze meshes, colliders, pose + angular velocity
src/levels.js          level configs + maze generation + BFS connectivity check
src/physics.js         ball physics (OBB/sphere collision, friction, restitution, broad phase)
src/face.js            MediaPipe face / head-pose tracking (roll/pitch, calibration, face-lost recentring)
src/input.js           keyboard / mouse / touch tilt input
src/camera.js          auto-framing overhead camera
src/fx.js              particle effects
src/audio.js           WebAudio synth SFX (including a speed-driven rolling loop)
src/clip.js            rolling 8 s canvas recorder (MediaRecorder) for shareable clips
src/textures.js        procedural textures (ball speckles, violet noise, sky, glow)
tools/serve.mjs        dependency-free static server
tools/check-levels.mjs level connectivity self-check
vendor/                three.js r160 + MediaPipe tasks-vision wasm and model
```

## Implementation notes

**Head pose → tilt.** Roll comes from the angle of the outer-eye-corner line (FaceMesh 33 / 263) —
stable and almost unaffected by expression. Pitch is taken from the euler angle decomposed out of the
4×4 facial transformation matrix. The median of the first ~20 stable frames becomes the neutral
baseline; afterwards the signal goes through a dead zone, a smoothstep curve and exponential smoothing
into −1..1, scaled to a maximum tilt of 17°. More than 500 ms without a detected face counts as "lost":
the signal eases back to 0 (board levels out), and if *pause when the face is lost* is on, the simulation
freezes and the HUD explains why.

**Physics on a rotating board.** Every floor and wall collider is a child of the board: each frame its
position and orientation are refreshed from the board quaternion and the board's angular velocity is
written into it, so the contact-point velocity is `ω × (contact − pivot)` and the ball is genuinely
carried by the tilting surface instead of teleporting. The solver runs 3 iterations per substep with
friction applied as `1 − e^(−k·dt)` (timestep-independent feel), and a bounding-sphere broad phase keeps
150+ colliders cheap at 120 Hz.

**Win / fall detection.** The ball position is transformed into **board-local space**, so "inside the
door cell" and "below the floor" (`local y < −2.5`) are simple cell checks that stay correct while the
board is tilted.

**Fall feedback.** A miss has to *read* as a miss: the ball keeps its angular momentum while airborne
(no more decaying spin, which made a drop look like a slide), and the fall FX — an expanding ring plus a
violet burst — is spawned at the **pit mouth on the deck**, never under the deck, so a drop never looks
like sinking through the floor. This fires the moment the ball is genuinely below the deck (`local y < −1.2`),
while it is still visible dropping in.

**Soft respawn.** A hard teleport to the pad at zero velocity feels teleporty, so a fall now fades the
screen, drops the ball in ~1.1 units above the pad with a gentle downward velocity, and scales it back in
(0.45 → 1 over 0.34 s) with a cyan pad ring, so you coast in rather than pop.

**Shareable clips.** `src/clip.js` keeps a rolling ~8 s buffer of `canvas.captureStream()` video via
MediaRecorder, so a clear (or a wipeout, via the drawer button) can be shared instantly. On the clear
screen the button is promoted to the primary action when you are playing with **head control**, since
that is the version worth posting. Sharing uses the OS sheet when the browser supports file sharing and
falls back to a `.webm` download.

**Keeping the ball on the board.** A fast-tilting board can throw the ball around: at radius *r* the
surface moves at `ω × r`, so the physics caps the velocity the ball inherits from the moving surface
(45 %), caps upward speed so the hop height stays below the wall height, rate-limits the tilt to
0.8 rad/s, and never resolves a deep overlap by popping the ball up (it uses last frame's position to
push it back out through the face it actually crossed). The outer ring of the maze is a 1.8-unit fence
and anything that still ends up outside the footprint is treated as a fall. A deterministic 60 fps sweep
(five levels × three tilt frequencies, full 17° amplitude) reports **zero** board escapes.
