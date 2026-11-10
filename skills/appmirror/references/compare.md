# Step 3 loop and step 4: compare and fix

## Score a round

```
node scripts/shoot.mjs screens --base-url http://localhost:8081 --map app-map.json --out captures
node scripts/compare-page.mjs --map app-map.json --captures captures --out compare.html
```

`compare-page` scores each screen (original settled frame vs clone capture) with pixelmatch, writes `compare.html` and `report.json` (`average`, one score per screen, one per animation instant). It stops with the screen's name if a capture or a frame is missing.

## Which frame goes with which capture

Always the **settled** frame of the original (`screens[].frame`) with the clone captured at rest (`shoot` waits 300 ms). Never compare with the first frame of a change: it is mid-slide.

## Reading the result

- A score under 85 % flags a screen. Open `captures/diff_*.png` when you need to see where (`node scripts/diff.mjs original.png clone.png --out diff.png`). Two ghost copies of the content mean an offset: measure it in pixels, then fix it.
- Real example: a navigation bar counted twice shifted the content 44 px down: 98 % became 99.9 % after one fix. Offsets and wrong sizes are the usual causes; colors come next.
- Then look at both images yourself. A high score can hide a missing small element.

## Animations

Capture the clone at exact instants (the browser clock is paused and advanced by hand):

```
node scripts/shoot.mjs animation --url http://localhost:8081/ --id slide --click 'text="Wi-Fi"' \
  --times 0,33,67,100,133 --out clone_anim
node scripts/extract-frames.mjs <video> --full --start <ms before the change> --end <ms> --out orig_anim
```

`--click` makes t = 0 the moment of the tap. The first changed original frame is t = 0: pair clone frame i with original frame i + offset, and pick the offset that fits (try a few). Pass the pairs to `compare-page --animations anim.json` (format: `[{id,label,fps,pairs:[{timeMs,original,clone}]}]`) to get a slider in `compare.html`.

**The pixel score is weak for animations.** Flat screens make almost any slide score 95 % or more. Look at the slider: compare how far the movement has gone at the same instant (a clone slower than the original is the usual defect, fix the duration and easing). Only trust a high score if the slider agrees.

## Stop rules

- Validated screen: score at 85 % or more and no major visible difference.
- Stop when everything is validated or after 5 rounds. An animation not validated after 3 rounds goes frame by frame.
- Never stop silently: list the screens and animations that are not validated in the final summary.
