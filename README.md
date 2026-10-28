# Polyfork

A desktop app, built with [mygo](https://github.com/egoist/mygo), that downloads free low-poly models from [polyfork.dev](https://polyfork.dev) and views them locally.

- `library.go`: the `Library` service the page calls. It searches the Polyfork API, downloads GLBs and thumbnails, and keeps `manifest.json`.
- `main.go`: binds `Library`, and serves the models folder to the page as `models://localhost/…`.
- `src/main.ts`: the three.js viewer and the download dialog.

Models are stored in `~/Library/Application Support/Polyfork/models` (`Polyfork Dev` for `bun run dev`).

```sh
bun run dev     # develop
bun run build   # build/darwin-arm64/Polyfork.app and a .dmg
go test .       # downloads two real assets; -short skips it
```

## iOS

`ios/` is a SwiftUI app (iOS 26+) for browsing on a phone. It reads the catalogue from polyfork.dev directly, not from the desktop app's library. Thumbnails are cached, and a model's USDZ export is downloaded the first time it's opened, so it can be viewed offline afterwards. RealityKit shows the model, and AR Quick Look places it in the room. The USDZ export has no animations.

The Xcode project is generated from `ios/project.yml` with [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
cd ios && xcodegen generate && open Polyfork.xcodeproj
```
