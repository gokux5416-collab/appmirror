# Step 2b: complex animations (mascot, character, multi-part object)

Goal: a clone that moves like the original, with as few frames as possible, and always a result.

## 1. Probe first (seconds, not minutes)

Take the first 4 frames of the animation, cropped to its zone:

```
node scripts/extract-frames.mjs <video> --full --start <ms> --end <ms + 4 frames> --crop x,y,w,h --out probe
node scripts/remove-bg.mjs ...   (see below)
node scripts/track-parts.mjs --frames probe --fps <fps> --out probe-out/parts.json
```

If `probe-out/parts.json` says fallback, or there are more than 12 parts, or most of the area deforms (a shape that morphs, a character that squashes), **skip the tracking** and go to the fallback. Tracking a whole animation that will fall back costs about 50 s per 64 frames.

## 2. Full run

1. `extract-frames --full --start --end --crop` for the whole animation at the video's full frame rate.
2. `remove-bg.mjs <frame> [--bg r,g,b] [--side both|left|right]`: solid color first, then a vertical gradient (the result gives CSS-ready stops, draw the gradient in code, not as frames), then the ML fallback (`@imgly/background-removal-node`, optional dependency).
3. `track-parts.mjs --frames <dir> --fps <fps> --out <dir>/parts.json`: parts, transform per frame, rigid or deforming. Look at `debug.png` and name the parts.
4. Rigid parts: `vectorize.mjs <part.png>` (VTracer) only if the SVG is smaller and clean (flat colors). A raster PNG with keyframes (x, y, rotate, scale) is fine and often lighter. VTracer loses glows and fine detail.
5. Deforming parts: leftover images per frame.
6. Write the result in `app-map.json` (`animations`, `mode`: `tracked`, `mixed` or `frames`).

## 3. Fallback: one file, 24 fps minimum

```
node scripts/encode-sprite.mjs --frames <dir> --fps <fps> --out animation.webp
```

One animated WebP with alpha (about 8 times lighter than PNG frames). Play it with `expo-image` in the clone. Not WebM: alpha is not reliable on iOS. Never below 24 fps.

## 4. Separate layers when you can

Gradient background as code, text as real text (a counter such as "1599/1600"), particles as small sprites. Only the part that really morphs stays frame by frame.

## Honest limits

- Animations that change shape (morphing, liquid) cannot be tracked: they fall back to frames.
- You cannot recover the original animation file (Lottie, Rive) from a recording. Do not claim it.
- Say in the summary which animations are tracked, mixed or frame by frame.
