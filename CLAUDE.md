# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Cuatro Puntos" — a geolocated WebAR experience (Spanish UI) for a fixed terrace at the Centro Cultural Universitario Rogelio Salmona, Manizales, Colombia. A visitor scans a QR, taps "Comenzar", and sees 4 transparent PNGs floating over the camera feed at the true compass bearing of 4 real landmarks. `prompt_cuatro_puntos.md` is the original, authoritative spec (formulas, UX flow, acceptance criteria in §13) — consult it before changing behavior.

**Success criterion #1:** when the phone points at a landmark, its image must be centered within ±5° bearing error after calibration. Compass accuracy dominates every other concern.

## Commands

- `npm run lan` — `tools/serve-lan.mjs`: HTTPS server on `0.0.0.0:8443` for testing from phones on the same Wi-Fi (sensors/camera need a secure context, so plain `http://IP` won't work). Self-signed cert with the LAN IPs in the SAN, stored in `.cert/` and regenerated when IPs change; applies `public/_headers` but forces `no-store` unless `--cache`; prints a terminal QR; `:8080` redirects to HTTPS.
- `npm test` — `node tools/test-geo.mjs`: dependency-free test of the geo math; prints the bearing/distance table for the 4 points; exits non-zero on failure.
- `npm run vendor` — rebuilds `public/vendor/three.module.min.js` with esbuild. Three ≥ r176 ships no `.min.js`, so the script bundles only the classes listed in `EXPORTS` in `tools/vendor-three.mjs`. **If any module imports a new class from `three`, add it there and re-run.**
- `npm run qr -- <https-url>` — writes `tools/out/qr.svg` and `qr.png`.
- `npx wrangler pages dev public` — local server (port 8788); pair with `cloudflared tunnel --url http://localhost:8788` for HTTPS on a real phone (camera/sensors/GPS require a secure context).
- `npx wrangler pages deploy public --project-name cuatro-puntos` — deploy to Cloudflare Pages.

URL flags: `?mock=1` (no camera/sensors, drag or arrow keys to rotate), `?debug=1` (diagnostics panel with live sliders), `?origin=lat,lng` (override origin). With `mock` or `debug`, `window.cuatroPuntos` exposes `setHeading(deg)` (synchronous: updates the camera without waiting for a frame), `project()`, `openGuide(step)` and `diagnostics()` — useful for verifying that each sprite crosses screen center exactly at its bearing. When testing in a background Chrome tab, rAF/timers are throttled: rely on the synchronous `setHeading`, and remember sprites fade in over `sprite.fadeInMs` (a screenshot taken right away shows them faint).

## Architecture

Static site, no build step, publish dir `public/`. Vanilla ES modules; Three.js resolved via an `importmap` to the local vendor file. **No runtime requests to external domains** (spotty signal on the terrace).

- `js/config.js` — single source of truth (origin, points, declination, position mode, FOV, smoothing, thresholds). Never hardcode coordinates, labels or filenames elsewhere.
- `js/geo.js` — pure math, no deps (also imported by Node tests). World convention used everywhere: **+X = East, +Y = Up, −Z = North**; bearings are true, clockwise from north.
- `js/sensors.js` — raw acquisition only, **no Three.js import** (it's loaded with the welcome screen): orientation source detection, camera, `GpsTracker`, `resolvePosition` (hybrid mode with hysteresis), wake lock.
- `js/orientation.js` — Three-based fusion: converts raw samples to the camera quaternion (earth-frame/DeviceOrientationControls conversions, iOS yaw offset from `webkitCompassHeading`, declination, manual alignment offset, jump filter, dead zone, slerp), interference monitor, `DragInput` for sensorless mode.
- `js/enhance.js` — DOM-free contrast pipeline (runs in a worker or main thread): crops each PNG to its visible content, then builds 3 RGBA variants (`original` / `realce` / `maximo`) with line alpha boost/thickening/darkening, dark halo behind white text, light halo behind dark lines, and an optional soft dark plate. Parallel lines are ~7 px apart at 1024 px width, so the light halo must stay narrower than that.
- `js/enhance-worker.js` + `js/images.js` — `prepareImages()` runs the pipeline in a module Web Worker when `OffscreenCanvas` exists (main-thread fallback otherwise) and returns `Map id → Promise<{canvases, width, height, contentWidthPx, contentHeightPx}>`. Started during the welcome prefetch, so it's usually done before "Comenzar".
- `js/ar-scene.js` — renderer, sprites on a sphere of radius `camera.sphereRadius`, constant angular width (of the drawing, not the padded canvas), roll compensation, projection for HUD. Textures use **premultiplied alpha** (`texture.premultiplyAlpha` + `CustomBlending` One/OneMinusSrcAlpha, fade via `material.color.setScalar(opacity)`) so halos don't get grey fringes from mipmaps. `setContrastMode()` swaps the sprite maps.
- `js/ui.js` — compass tape, edge indicators, distance labels, 2-step calibration guide (`runGuide`: "calibrate" measures real device rotation via `fusion.motionDeg` + iOS accuracy; "verify" shows a center reticle, the angular offset of the reference image, "Alinear con la mira" and ±1° fine tune), compass-quality chip, contrast toggle (persisted in `localStorage`), actionable warnings, help sheet, debug panel.
- `js/main.js` — welcome screen + flow orchestration. `orientation.js`, `ar-scene.js`, `ui.js` (and thus Three.js) and `images.js` are **dynamically imported** — prefetched 3 s after `load` or on first `pointerdown` — to keep the welcome screen light (Lighthouse mobile perf was 72 when prefetch started right after load; 100 after deferring it). Sprites are added as each image finishes; sprites only show once the guide reaches the "verify" step (or immediately in drag mode).

Key invariants:
- `DeviceOrientationEvent.requestPermission()` must be the first call in the "Comenzar" click handler, before any `await` (iOS user-gesture requirement).
- Orientation source priority: `AbsoluteOrientationSensor` → `deviceorientationabsolute` → `deviceorientation` with `absolute===true` → iOS webkit → relative `deviceorientation` (forces manual alignment before sprites show) → mouse/drag.
- Corrections (declination + user offset, plus iOS yaw offset) are applied once as a yaw rotation of the camera, never per sprite. HUD heading is derived from the same camera quaternion.
- The user alignment offset persists in `localStorage` only for absolute sources.
- GPS is optional: denied/absent → fixed origin, no error UI. `positionMode` is `"fixed"` since on-site testing showed a GPS fix ~200 m off while reporting ±20 m accuracy, which flipped `hybrid` to GPS and shifted La Ciudad 19°.
- Per-point `bearingOffsetDeg` (applied to `displayBearing` only, never `trueBearing`) plus `elevationDeg`/`angularWidthDeg` are tuned on site via `?debug=1` → "Ajuste fino por punto" → "Copiar valores". Before pasting those values into `config.js`, check the same diagnostics: if `usingGps` was true or `userYawOffsetDeg` ≠ 0, the offsets are relative to the GPS position / include the phone's manual alignment and must be converted to origin-relative offsets (physical bearing = displayBearing − userYawOffsetDeg; offset = physical − trueBearing from origin).

## Images

`public/*.png` are the client's originals (4321×1859 RGBA) with **spaces in their filenames** (`la colina.png`, `perla del ruiz.png`, `la ciudad.png`, `fabrica.png`). `config.js` references them verbatim and `main.js` URL-encodes them. Do not rename or modify them (spec §14); all processing happens at runtime. The artwork is white text (240,240,240) plus thin dark-teal→grey lines, occupying only y = 68–96 % of the canvas (full width).

In the SVG reticle (`#reticle`), toggle visibility with `toggleAttribute("hidden")` — SVG elements have no `.hidden` property.
