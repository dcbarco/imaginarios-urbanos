# Welcome screen tokens (measured)

All values were measured by script from `public/design/plantilla_digital_cardinales_Mesa de trabajo 1.png`
(2251 × 5001 px, **transparent background**, so the page background is white `#ffffff`).
Colors are exact pixel values (flat fills, not anti-aliased edges).
Positions are given in artboard px, then as **vw** (px / 2251 × 100; everything in the design scales with
width) and as **%H** (px / 5001 × 100). "@390" = CSS px on a 390 px wide viewport.

## Colors

| Token | Hex | Where |
|---|---|---|
| `--green-title` | `#0a4635` | "Cuatro Puntos" title, center dot of the cardinal mark |
| `--orange` | `#e74518` | "Comenzar" button fill; lowest (front) line of the top zigzag. Logo file accent is `#e74517` (same) |
| `--olive` | `#697525` | olive accent inside the logo's last "A" |
| `--grey-body` | `#5a5b5d` | body paragraph |
| `--ink` | `#000000` | "Sostén el celular en vertical", phone icon, cardinal chevrons |
| `--logo-ink` | `#1d1d1b` | logo black as placed in the artboard (the logo PNG itself is `#000000`; difference is negligible) |
| button text | `#ffffff` | |
| `--zig-top-front` | `#e74518` | top zigzag, lowest line |
| `--zig-top-back` | `#707225` | top zigzag, highest (18th) line |
| `--zig-bottom-light` / `--zig-bottom-dark` | `#f4f4f2` / `#292927` | bottom zigzag first (top) / last (bottom) line |

Top zigzag: each line has ONE flat color (no gradient along the line). From the lowest line upward:
`#e74518 #e04819 #d94a1a #d24d1a #cb501b #c4521c #bd551d #b6581d #af5a1e #a85d1f #a16020 #9a6221 #936521 #8c6822 #856a23 #7e6d24 #777024 #707225`
(18 lines, R −7 per step). Because the ridge is higher on the left, the upper (olive) lines exit the top
edge on the left, so the left side reads orange and the right side reads olive.

Bottom zigzag: 18 flat warm-grey lines, value −12 per line (`#f4f4f2 #e8e8e6 #dcdcda … #353533 #292927`),
light at the top, dark at the bottom. The last two are clipped by the bottom edge.

Line thickness in the reference: ~3.5 artboard px = **0.16vw ≈ 0.6 CSS px @390**. The SVGs use
`stroke-width:1` with `vector-effect:non-scaling-stroke` (1 CSS px); edit the `<style>` in the SVG to
`.75` if it looks heavy.

## Layout (artboard 1, 2251 × 5001)

| Element | Artboard px | vw | %H | @390 (CSS px) |
|---|---|---|---|---|
| Top zigzag | y 0 → 848 (lowest line bottom) | ends at 37.7vw | 16.96% | ends at y≈147 |
| Logo | left 339, top 749, w 519, h 198 | left 15.06, top 33.27, **w 23.06** | top 14.98% | left 58.7, top 129.8, w 89.9, h 34.3 |
| Cardinal mark (ink) | x 911–1341, y 1397–1840; center (1126, 1618.5) | w 19.10, h 19.68; center y 71.90 | center 32.36% | w 74.5, center y 280.4 |
| `cardinal-mark.svg` box (viewBox 226×233, includes 1 margin unit) | left 900, top 1385, w 452, h 466 | left 39.98, top 61.53, **w 20.08** | top 27.69% | w 78.3, h 80.7 |
| Center dot | Ø 25 (incl. 1.6 px black ring) | 1.11 | | 4.3 |
| Title ink | x 415–1839, y 2059–2190 (cap top → baseline), centered (cx 1127) | top 91.47, w 63.26 | 41.17% | top 356.7, w 246.7 |
| Body (4 lines) | ink x 457–1901, line tops 2407 / 2517 / 2627 / 2737, last ink bottom 2806 | top 106.93, w 64.19 | 48.13% | top 417 |
| Hold row: phone icon | x 453–562, y 3070–3254 (109 × 184) | w 4.84, h 8.17 | top 61.39% | 18.9 × 31.9 |
| Hold row: text | ink x 639–1891, y 3128–3197; gap icon→text 77 px (3.42vw); row center y 3162 | w 55.62 | 63.23% | gap 13.3 |
| Button | x 558–1692, y 3531–3850, **w 1135, h 320, radius ≈140** (curve fit; nearly a pill) | w 50.42, h 14.22, r 6.22, top 156.86 | top 70.61% | **196.6 × 55.4, r ≈24** |
| Button label ink | x 795–1452, y 3643–3726, centered | w 29.23 | | |
| Bottom zigzag | y 4110 → 5001 (891 tall) | h 39.58 | starts at 82.18% | h 154.4 |

Centering notes: logo is left-aligned (left 15.06vw). Mark, title and button are centered on the page
(cx 1126 ≈ 1125.5). The body block (cx 1180) and the hold row (cx 1172) are shifted ~2.2–2.4vw right of
center in the artboard — almost certainly unintentional; center them.

## Typography (Montserrat, sizes derived from ink width/height with the actual font metrics)

| Text | Weight | font-size | line-height / tracking | Color |
|---|---|---|---|---|
| "Cuatro Puntos" | 800 (stems measure between 800 and 900) | 186.7 px = **8.29vw** (32.3 @390) matches the ink width; cap height suggests 180 px = 8.0vw + `letter-spacing:.024em` | 1 | `#0a4635` |
| Body paragraph | 400–500 (stem 0.087em: between Regular 0.071 and Medium 0.096; 400 is fine) | 92 px = **4.09vw** (15.9 @390) | line pitch 110 px → **line-height 1.2** | `#5a5b5d` |
| "Sostén el celular en vertical" | 800 | 85 px = **3.79vw** (14.8 @390) | normal | `#000000` |
| "Comenzar" | 800 | 114 px = **5.06vw** (19.8 @390) with `letter-spacing:.06em` (or 5.46vw without tracking) | — | `#ffffff` |

Body line breaks in the design: "Gira sobre ti mismo y descubre / cuatro lugares de Manizales /
suspendidos en el aire, justo en / su dirección real" (max-width ≈ 64.2vw).

Vertical rhythm (artboard px → vw): logo bottom 947 · mark ink top 1397 (+450 = 20.0vw) · mark ink
bottom 1840 · title cap top 2059 (+219 = 9.7vw) · title baseline 2190 · body first line top 2407
(+217 = 9.6vw) · body last line bottom 2806 · hold row top 3070 (+264 = 11.7vw) · hold row bottom 3254 ·
button top 3531 (+277 = 12.3vw) · button bottom 3850 · bottom zigzag top 4110 (+260 = 11.6vw).

## Artboard 2 (2251 × 4001, shorter screens)

Same element sizes. The content block (mark → button) is moved up exactly 500 px (mark top 897,
title top 1106, body 1907, hold row 2570, button 3031–3350). Logo: left 310, top 455, w 497 (22.08vw).
Top zigzag is shorter (lowest line ends at y 687 = 30.5vw); bottom zigzag starts at 3207 (794 tall = 35.3vw).
The SVGs are drawn from artboard 1; on short screens just let the content overlap/crop the decorations
(`zigzag-top.svg` anchored top with `xMidYMin slice`, `zigzag-bottom.svg` anchored bottom with
`xMidYMax slice`; their natural aspect is 900×366 and 900×361, i.e. full width).

## Files

- `logo-manizales-imaginada.png` (640×244, 16-color palette, 10.7 KB) and `.webp` (q88, 14.9 KB) —
  the PNG is smaller, so `<img src=png>` alone is fine; `width="640" height="244"` for CLS.
- `zigzag-top.svg` (viewBox 0 0 900 366), `zigzag-bottom.svg` (viewBox 0 0 900 361): traced line by line from
  the artboard at 900/2251 scale, so placing them at 100vw width reproduces the reference exactly.
- `cardinal-mark.svg` (viewBox 0 0 226 233; chevrons `currentColor`, dot `#0a4635`; scales with its box,
  strokes are not non-scaling). Use with inline `<svg>` or `<img>` (in `<img>`, currentColor = black).
- `phone-vertical.svg` (viewBox 0 0 109 184, stroke 7 user units ≈ 1.2 CSS px at 18.9 px wide, `currentColor`).
- `../fonts/fonts.css` + `montserrat-latin-{400,600,800}.woff2` (family "Montserrat", `font-display:swap`).
