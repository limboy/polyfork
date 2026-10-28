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
