# Abstract Sign Generator

**Open the tool:** https://zikudriashova.github.io/abstract-sign-generator/

**Single-file version** (works offline, opens by double-click): see [Releases](https://github.com/zikudriashova/abstract-sign-generator/releases).

An interactive generator of abstract signs made of two pieces placed diagonally around the origin O: the top piece in quadrant I, the bottom piece in quadrant III.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # configurations, morphing, 3D shapes, exports
npm run build    # production build into dist/
npm run build:single  # one self-contained HTML in release/
```

## Quick start

- The sign is one of **five configurations** taken from `docs/references/sign-collection-fin.ai`. Pick one with the **1–5** buttons (or keys `1`–`5`), the *Sign → configuration* list, or the **Sheet** view.
- **Randomize** (key `R`) switches to a random other configuration; the seed makes it reproducible.
- **▶ Play** starts autoplay: a new configuration every *X* seconds (*Animation → every, s*). Click the canvas or press `Space` to pause and resume. In 3D, dragging to orbit does not count as a click.
- **2D / 3D** switches the view. **Construction** shows outlines, axes and the module grid.
- **★** saves the current sign to favorites. `⌘/Ctrl+Z` undo, `⇧⌘Z` redo. The last sign is restored on the next launch.

## Importing forms from SVG

Panel folder **Sign**:

- **Import sign (SVG)** — a whole sign becomes a new form (6, 7, …) next to the five built-in ones. The artboard (`viewBox`) is the sign: its centre is O, shapes in the top-right quarter become the top piece, shapes in the bottom-left quarter the bottom piece; the quadrant is half of the shorter artboard side. If a quarter is empty, that piece is kept from the current form.
- **Replace top / bottom piece (SVG)** — the file holds one piece; it is fitted into the quadrant by its bounding box (for the bottom piece, the top-right corner of the box goes to O, as the piece sits in the sign). On a built-in form this creates an imported copy; built-in forms never change.
- **Delete imported form** — removes the current form if it was imported.

Imported forms work everywhere: Randomize, autoplay, morph, colours per form, 3D and spin, all exports, presets and favourites. Toolbar buttons of imported forms have a dashed border.

What is read: filled `path`, `rect` (incl. rounded corners), `circle`, `ellipse`, `polygon`, `polyline`, with `transform` and `fill-rule` (holes in compound paths). Circles and circular curves become true arcs; free-form Bézier curves are split into short straight segments (≈ 1/700 of the quadrant). Stroke-only shapes, text, images and `<use>` are skipped with a warning — outline strokes and text before exporting. Colours in the file are ignored. Edges within 1% of the axes or the quadrant border are snapped. The file is never inserted into the page: only geometry is read. Limits: 3 MB per file, 6000 segments per piece, 24 imported forms.

## Shape-change animation

Panel folder **Animation**:

- **shape change** — *smooth morph* or *hard cut* (instant swap).
- **duration** — 150–2000 ms; **curve** — linear, ease-in-out, expo-out, back-out (morph only).
- The canvas never blocks during an animation: every new command (button, key, autoplay tick, undo) starts from the current in-between frame. Gap or rounding changes made mid-morph are picked up without restarting it.
- Morph resamples every contour into a ring of points (corners kept), matches rings between the two shapes (extra rings shrink into / grow from a point), aligns their start points and interpolates. In-between frames are polylines; the final frame is the exact outline with true arcs. Exports always use the exact outline.

## Spin (3D)

Panel folder **3D**: **spin top / spin bottom** — rotation of each piece around the sign's vertical axis through O (like the two leaves of a revolving door; at half a turn the top piece swings to the left and the bottom piece to the right), in turns per second (sign = direction, 0 = stop; a stopped piece eases back to its home angle). **top: forms per turn** — 0, 1, 2 or 4 shape changes per full turn of the top piece; the first change happens when the piece is edge-on (90°), so with *2 per turn* both changes are hidden in the edge-on moments even with *hard cut*. Shape changes caused by spinning do not go into the undo history.

## Colours per form

Panel folder **Color → colors per form**: each of the five configurations gets its own top and bottom fill (the background stays shared). While it is on, the colour controls and the palette list edit the *current* form (the labels show "form N"). **Palettes → forms** spreads the palettes over the five forms, using only palettes made for a background of the same brightness. When the form changes, colours blend together with the morph.

## Configurations

| # | Top piece | Bottom piece |
| --- | --- | --- |
| 1 | full-quadrant L, stroke ≈ 0.28 Q, inner corner rounded (R ≈ 0.43 Q) | sharp L, stroke 56.531/200 Q (from artboard 1) |
| 2 | four ⅓ Q squares on a 3×3 grid: (0,0), (1,1), (0,2), (2,0) | same |
| 3 | Q square with a triangular notch from the left side to near the center | same |
| 4 | "drop": circle of diameter Q with a sharp corner at O | same |
| 5 | right triangle with legs Q | same |

Q is the quadrant size (N modules). The bottom piece is the same in all five configurations (taken from artboard 1), so it never moves when the configuration changes. Coordinates were read from the vectors of the .ai file; sub-point drawing imprecision at the axes and quadrant edges was cleaned up, significant sizes are kept as drawn. Per-piece **Rounding** (convex / concave / corner O) can still be applied on top.

## Export

| What | How |
| --- | --- |
| SVG | `top` / `bottom` groups, arcs as `A`, gradients in `<defs>`; background optional |
| PNG 2D | 1x / 2x / 4x = 1024 / 2048 / 4096 px, square, transparent background |
| PNG 3D | render of the current 3D scene at the same sizes, transparent background (the shadow on the plane is kept) |
| GLB | same extrusion and materials as the 3D view; 1 module = 1 unit; nodes `top` and `bottom` |
| Animation | MP4 (H.264) or GIF, 720p or 1080p, 16:9 with the sign centered. One seamless loop through all five configurations starting from the current one, *every, s* per configuration, with the current morph / cut settings. Rendered frame by frame from the current view (2D or 3D), so the result does not depend on the machine's speed. With spin and *forms per turn* in 3D, the video is a whole number of turns (a multiple of five, also whole turns of the bottom piece when possible), so it loops seamlessly in both shape and angle. Colours per form are included. MP4: 30 fps via the browser's WebCodecs encoder (Chrome, Edge, Safari 16.4+); GIF: 25 fps, 256 colours per frame |
| JSON | sign preset (configuration, colors, 3D and animation settings) without UI state; import is strictly validated (hex colors only, ranges checked). Version 1 presets from the previous generator are rejected |

## Structure

- `src/geometry/` — pure geometry in grid modules: `configs` (the five configurations), `fillet`, `sign` (assembly), `serialize` (SVG path data).
- `src/anim/` — `morph.ts` (sampling, ring matching, easing), `engine.ts` (non-blocking tweening), `bind.ts` (connects the store to the renderers).
- `src/render2d/svg.ts` — the single source of the 2D picture: screen, SVG export and PNG are all drawn from it.
- `src/render3d/` — `shapes.ts` (Outline → THREE.Shape → ExtrudeGeometry with bevel), `Scene3D.tsx` (materials, environment, shadows, camera). Loaded as a separate chunk.
- `src/store/` — state, history, favorites. `src/ui/` — leva panel, canvas, toolbar. `src/export/` — SVG, PNG, GLB, JSON.
- `docs/references/` — the reference images.

## Notes

- The five configurations are encoded in `src/geometry/configs.ts` (coordinates read from the original design file). The design source files themselves are not part of this repository.
- Every push to `main` runs the tests and redeploys the site (`.github/workflows/pages.yml`).
