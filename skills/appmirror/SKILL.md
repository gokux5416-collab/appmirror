---
name: appmirror
description: Turn a screen recording of a mobile app (30-60 s) into a working Expo clone with the same screens, navigation and animations. Use when the user runs /appmirror or asks to clone an app from a video.
---

# appmirror

> Work in progress. This file will orchestrate the 4 steps below.

## Steps

1. **Split the video** into frames (`scripts/extract-frames.mjs`).
2. **Understand the app**: read the frames, write `app-map.json` (see `references/analyse.md`).
   - **2b. Decompose complex animations** (see `references/animations.md`).
3. **Build, then compare**: generate the Expo project, screenshot it, score it against the original frames, fix, repeat (see `references/build.md` and `references/compare.md`).
4. **Deliver**: Expo tunnel QR code, `compare.html`, and an honest summary.
