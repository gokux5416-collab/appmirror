# Step 3: build the Expo project

Build from `app-map.json` only. Use plain React Native `StyleSheet` (no styling library).

## Create the project (what worked)

```
npx create-expo-app@latest <name>-mirror --template blank --no-install
cd <name>-mirror && npm install
npx expo install expo-router react-native-screens react-native-safe-area-context expo-linking expo-constants \
  react-native-web react-dom @expo/metro-runtime @react-native-async-storage/async-storage \
  react-native-reanimated react-native-worklets
npx expo-doctor
```

Then:
- In `package.json` set `"main": "expo-router/entry"`; delete `App.js` and `index.js`.
- In `app.json`: `"scheme": "<name>"`, `"web": { "bundler": "metro", "output": "single" }`.
- Screens go in `app/` (one file per screen id), the layout in `app/_layout.js`.
- Install packages only with `npx expo install` (right versions). Run `expo-doctor` before starting. Fix conflicts automatically, retry twice at most, then explain.

## Dev server for the compare loop

```
npx expo start --web --port 8081 < /dev/null > expo.log 2>&1 &
```

Do **not** set `CI=1`: it turns file watching off, and your fixes would not show in the screenshots. Wait until `curl http://localhost:8081/` answers 200 (the first bundle takes about 30 s).

## Things that cost time

- **Web has no screen transition.** The native stack animates on iOS and Android but not on Expo Web. Set the stack option `animation: 'none'` and animate the screen yourself, the same code on every platform: `entering={SlideInRight.duration(320).easing(Easing.bezierFn(...))}` and `exiting={SlideOutRight...}` on the screen's root `Animated.View`. Only for screens that are pushed, not for the first one. Known limit: on web the screen underneath is not drawn during the slide.
- **Do not use the built-in `Switch`.** It looks different on web. Draw it (track 51x31, knob 27, 220 ms) and animate it with Reanimated.
- **Status bar space:** recordings include it. Add the top padding you measure (usually 56 px on an iPhone frame).
- **Navigation bars:** custom navigation bars take space in the layout. If the original bar is overlaid, do not add it twice (a 44 px offset shows up as a low score).
- **Local interactions** (toggle, like, add, delete): keep the state with AsyncStorage so it survives a restart.
- Fake data for lists must look real (names, amounts, dates).

## Frame rate

Animations in the clone run at the device frame rate. For frame-by-frame sprites, never below 24 fps (30 by default).
