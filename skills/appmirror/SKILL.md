---
name: appmirror
description: Turn a screen recording of a mobile app (30-60 s) into a working Expo clone with the same screens, navigation and animations. Use when the user runs /appmirror or asks to clone or prototype an app from a video.
---

# appmirror

Turn a screen recording into a working Expo clone, then prove how close it is with a side-by-side page.

Scripts live in `${CLAUDE_PLUGIN_ROOT}/scripts` (run them with `node`). Install once with `npm install` in `${CLAUDE_PLUGIN_ROOT}`. Work in a fresh folder `./<app-name>-mirror/` next to the video. Always tell the user, in plain words, what you are doing and what is left; they may not code.

## Before you start

1. Check the video exists and is `.mp4` or `.mov`, 60 s max. Longer: ask to cut it. Do not fail silently.
2. Say the legal rule once: clones are for learning and prototyping, not for stores or commercial use.
3. Create a task list with the 4 steps below and keep it updated.

## Step 1: split the video

```
node scripts/extract-frames.mjs <video> --out frames
```

It prints a JSON summary and writes `contact-sheet.png` (every screen at rest), `transition-sheet_*.png` (one per animation) and the full-rate frames of each transition. **Read the sheets, not every frame.** Each scene has a `settledFile`: the screen once the movement stopped. That is the reference image of the screen. See `references/analyse.md` for the limits (blank first frame, tiny changes such as switches).

## Step 2: understand the app

Read the contact sheet, then open settled frames one by one for detail. Write `app-map.json` (format and rules in `references/analyse.md`): screens, elements with boxes (390x844), navigation, theme colors, transitions, animations. Cut icons and images out of the frames into `assets/`.

- **Step 2b, complex animations** (mascot, character, multi-part object): follow `references/animations.md`. Probe first on 4 frames and skip the tracking when it cannot work. Never spend minutes tracking something that will fall back.

## Step 3: build, then compare

Build the Expo project from `app-map.json` only (never re-read the video): `references/build.md`. Start the web dev server, then loop (`references/compare.md`):

```
node scripts/shoot.mjs screens --base-url http://localhost:8081 --map app-map.json --out captures
node scripts/compare-page.mjs --map app-map.json --captures captures --out compare.html
```

Read the scores in `report.json`, look at the original and the clone side by side, list the differences (colors, spacing, sizes, missing elements, wrong timing), fix, repeat. Stop when every screen is at 85 % or more and you see no major difference, or after 5 rounds. List what is not validated honestly. An animation that is still off after 3 rounds falls back to frame by frame.

## Step 4: deliver

1. `npx expo start --tunnel` for the QR code (Expo Go). If the tunnel cannot start, say so and give the web URL.
2. `compare.html` (single file, shareable).
3. A short summary: screens, average score, animations and their mode (tracked, mixed, frames), and everything that could not be reproduced. Say what the clone does not have: no real logic, no backend.

## Rules

- Do not change the clone's scope: only what is visible in the video. Fake realistic data for lists.
- Fonts that are not free: use the closest Google Font and say so.
- If something fails twice, stop, explain in plain language, and ask.
