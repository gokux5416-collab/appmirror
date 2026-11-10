# appmirror

> Film a mobile app. Get a working Expo clone.

**Status: work in progress (pre-V1).** A demo GIF will go here.

appmirror is an open source [Claude Code](https://claude.com/claude-code) plugin. Give it a screen recording of a mobile app (30 to 60 seconds) and it builds an [Expo](https://expo.dev) clone you can open on your phone: same screens, same navigation, same animations, with local interactions (like, check, add, delete).

## Legal notice

appmirror is for **learning and prototyping**. Generated clones reproduce the design of apps that belong to their authors. **Do not publish them on app stores and do not use them commercially.**

## Usage (planned)

```
/appmirror path/to/video.mp4
```

1. Split the video into frames.
2. Claude reads the frames and writes `app-map.json` (screens, navigation, colors, animations).
3. An Expo project is generated, then compared with the original frames and corrected in a loop.
4. You get a QR code (Expo Go) and a `compare.html` page showing original and clone side by side.

## V1 scope

- One `.mp4` or `.mov` video, 60 s max, 15 screens max.
- All screens seen in the video, navigation, transitions, and complex animations (mascots, multi-part characters).
- Local interactions stored with AsyncStorage. No backend, no accounts.

## License

[MIT](LICENSE)
