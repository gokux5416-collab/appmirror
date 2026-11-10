# appmirror

> Film a mobile app. Get a working Expo clone.

**Status: early (pre-V1).** The pipeline runs end to end on a demo app (see `examples/settings-demo`). It has not been tested on real phone recordings yet.

appmirror is an open source [Claude Code](https://claude.com/claude-code) plugin. Give it a screen recording of a mobile app (30 to 60 seconds) and it builds an [Expo](https://expo.dev) project you can open on your phone: same screens, same navigation, similar animations, with local interactions (toggle, like, add, delete).

## What it is for

- Turning an app you like into a clickable prototype to start from.
- Showing an idea on a phone in minutes.
- Rebuilding the look of your own app when you only have a recording.

## What it is not

It copies **what the video shows**: look, navigation, motion. There is no real logic, no backend, no accounts, and nothing that is not on screen. You cannot recover the original animation files (Lottie, Rive) from a recording.

## Legal notice

appmirror is for **learning and prototyping**. Generated clones reproduce the design of apps that belong to their authors. **Do not publish them on app stores and do not use them commercially.**

## Usage

```
/appmirror path/to/video.mp4
```

1. The video is split into frames (scene changes grouped into events, one settled frame per screen).
2. Claude reads the frames and writes `app-map.json` (screens, navigation, colors, transitions, animations).
3. An Expo project is generated, screenshotted with Playwright, scored against the original frames with pixelmatch, and corrected in a loop (5 rounds max).
4. You get an Expo QR code, and `compare.html`: the original and the clone side by side, with a score per screen and a slider for animations.

Each script also runs alone, for example `node scripts/diff.mjs original.png clone.png`.

## Install

```
git clone https://github.com/gokux5416-collab/appmirror
cd appmirror && npm install
```

Requires Node 20 or more. ffmpeg comes from `ffmpeg-static`, Playwright installs its own browser (`npx playwright install chromium`).

Notes:
- `@imgly/background-removal-node` is an optional dependency, used only to remove non-uniform backgrounds. If it fails to install, solid and gradient backgrounds still work.
- `@visioncortex/vtracer` is an alpha release (turns rigid animation parts into SVG).
- `npm audit` reports a few moderate issues in transitive dependencies of the optional package; none are used at runtime by the core scripts.

## V1 scope

- One `.mp4` or `.mov` video, 60 s max, 15 screens max.
- All screens seen in the video, navigation, transitions, complex animations (tracked by parts when possible, one animated WebP at 24 fps minimum otherwise).
- Local interactions stored with AsyncStorage.

## Known limits

- Tiny changes (a switch flipping) can be missed by scene detection and are inferred from UI conventions.
- Expo Web has no screen transition: the clone draws its own slide. The screen underneath is not drawn during it.
- Shapes that morph (liquid, blobs) cannot be tracked; they play frame by frame.
- The pixel score is weak for animations on flat screens: check the slider in `compare.html`.

## License

[MIT](LICENSE)
