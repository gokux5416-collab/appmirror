# Step 2: read the frames, write `app-map.json`

## What extract-frames gives you

- `contact-sheet.png`: one tile per scene, each tile is the **settled** frame (after the movement stopped). Use it to list the screens.
- `scene_*.png`: the first frame of a change (often mid-slide, do not use it as a reference).
- `settled_*.png`: the reference image of each scene. Put it in `screens[].frame`.
- `trans_*.png` and `transition-sheet_*.png`: every frame during the 600 ms after a change. Use them to read durations, easing and direction.

## Known limits (found by running the pipeline)

- The first frame is often blank (app still loading). Ignore it.
- A scene is one event: a slide that lasts 300 ms is one scene, not ten.
- Very small changes (a switch flipping, a checkbox) can score below the noise of the video and be missed. If the user taps something and no scene shows it, infer it from UI conventions (a switch toggles, a row opens the next screen). To catch them, run again with `--scene 0.002` and check the result is not noise.
- The same screen appears several times (home, then Wi-Fi, then home). List it once, in `screens`.

## Writing the map

Same format as the project spec, section 5. Rules:

- Coordinates are in 390x844 px. Measure from the settled frames, do not guess.
- `screens[].id` is also the route (`home` or `index` is `/`, `wifi` is `/wifi`). Use lowercase ids without spaces.
- `screens[].frame` is the path of the settled frame, relative to `app-map.json`.
- `transitions`: type (`slide`, `fade`, `scale`, `none`), `durationMs`, and when you can see it the easing. iOS-like pushes are usually 300 to 350 ms with a fast start and a soft landing.
- Theme colors: read them from the frames (backgrounds, separators, accent). Fonts: closest free Google Font.
- `animations`: leave empty until step 2b.

Do not invent screens, text or features that are not in the video.
