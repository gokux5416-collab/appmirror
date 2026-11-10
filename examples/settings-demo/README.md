# settings-demo

The first end to end run of appmirror.

- `original/index.html`: a small iOS-style Settings app (web page). It stands in for a phone, so the demo has an "original" whose source you can read.
- `record.mjs`: records it as a 390x844 video, `settings-demo.mp4` (about 13 s, 3 screens).
- `app-map.json`: what Claude wrote after reading the frames (step 2).
- `mirror/`: the Expo project Claude built from `app-map.json` (step 3). Run it with `npm install` then `npx expo start --web`.
- `report.json`: the scores of the last round.

Result of the run: Home 100.0 %, Wi-Fi 99.9 %, Notifications 99.9 % (average 99.9 %).
It is a synthetic, easy app: expect lower scores on real recordings (compression, fonts, real photos).
The slide between screens exists in the clone, but its timing is not tuned yet: at the same instant the original is further along (see the slider in `compare.html`).

Reproduce:

```
node examples/settings-demo/record.mjs            # or use the committed settings-demo.mp4
node scripts/extract-frames.mjs examples/settings-demo/settings-demo.mp4 --out examples/settings-demo/frames
cd examples/settings-demo/mirror && npm install && npx expo start --web --port 8081
node scripts/shoot.mjs screens --base-url http://localhost:8081 --map examples/settings-demo/app-map.json --out captures
node scripts/compare-page.mjs --map examples/settings-demo/app-map.json --captures captures --out compare.html
```
