# Polyfork

A desktop app, built with [mygo](https://github.com/egoist/mygo), that downloads free low-poly models from [polyfork.dev](https://polyfork.dev) and views them locally.

- `library.go`: the `Library` service the page calls. It searches the Polyfork API, downloads GLBs and thumbnails, and keeps `manifest.json`.
- `main.go`: binds `Library`, and serves the models folder to the page as `models://localhost/…`.
- `src/main.ts`: the three.js viewer and the download dialog.
- `app_updates.go` and `src/app-updates.ts`: application update checks and release notes.

Models are stored in `~/Library/Application Support/Polyfork/models` (`Polyfork Dev` for `bun run dev`).

**Check for Updates…** in the application menu checks the latest stable GitHub Release, displays its changes, and opens the universal DMG download when a newer version is available. Open the downloaded DMG and drag the app into Applications to finish updating. **更新模型** separately checks the model library.

```sh
bun run dev       # develop
bun run build     # build/darwin-arm64/Polyfork.app and a .dmg
bun run build:dmg # verified universal DMG for Apple Silicon and Intel (macOS only)
go test .         # downloads two real assets; -short skips it
```

## GitHub builds

The **Build macOS DMG** workflow runs on pushes to `main`, `v*` tags, pull requests, and manually from the Actions tab. It installs the Go version from `go.mod` and Bun 1.4.4, uses the committed lockfiles, runs the offline tests, and builds a universal app with the production frontend embedded. Before uploading, it mounts the DMG and checks the app's signature, both CPU architectures, and the Applications shortcut.

Download **Polyfork-macOS-universal** from a successful run's **Artifacts**, unzip it, open the DMG, and drag **Polyfork.app** into **Applications**. The same build is available locally with `bun install --frozen-lockfile && bun run build:dmg`; the image is written to `build/darwin-universal/polyfork-<version>.dmg`.

Pull requests and branch builds without Apple secrets are ad hoc signed and aren't notarized. On the first launch of one of those downloaded builds, macOS may block it; use **System Settings → Privacy & Security → Open Anyway** after attempting to open the app.

### Releases

Pushing a `v*` tag automatically publishes a GitHub Release after the signed, notarized DMG passes verification. The Release includes the DMG and automatically generated release notes. The tag must match the version in `mygo.config.ts`; for the current `0.3.0` version:

```sh
git tag v0.3.0
git push origin v0.3.0
```

For the next release, update `version` in `mygo.config.ts`, commit and push the change, then create and push the matching tag. Release builds require the Apple secrets below. Tags with a prerelease suffix, such as `v0.4.0-rc.1`, create a prerelease. Rerunning a tag build uploads a missing DMG or finishes an existing draft; published assets are preserved. You can also run the workflow manually against a version tag to publish its Release.

### Signing and notarization

Configure these repository **Settings → Secrets and variables → Actions** secrets to enable Developer ID signing and [Apple notarization](https://sosumi.ai/documentation/security/customizing-the-notarization-workflow) on pushes and manual runs:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE_P12_BASE64` | Base64 of the Developer ID Application certificate and private key exported as `.p12` |
| `ASC_PRIVATE_KEY_BASE64` | Base64 of the App Store Connect `AuthKey_<KEY_ID>.p8` private key |
| `ASC_KEY_ID` | Key ID from the `.p8` filename |
| `ASC_ISSUER_ID` | App Store Connect API issuer UUID |
| `APPLE_CERTIFICATE_PASSWORD` | Optional: the `.p12` export password; omit for a passwordless export |

With GitHub CLI authenticated (`gh auth login`), the setup helper can validate and upload the secrets directly from a directory containing `Certificates.p12`, `AuthKey_<KEY_ID>.p8`, and `ASC_ISSUER_ID.txt`:

```sh
python3 scripts/setup-macos-secrets.py /path/to/apple-credentials --repo limboy/polyfork
```

The helper checks the certificate type and expiration, validates Notary API access, and uploads secrets through standard input without displaying their contents. Add `--check-only` to validate the local files without contacting Apple or GitHub. For a password-protected `.p12`, supply `APPLE_CERTIFICATE_PASSWORD` in the environment.

The workflow imports the certificate into a temporary keychain, detects its signing identity, and stores the API credentials in that keychain. MyGo signs the app and DMG, submits the DMG for notarization, and staples the resulting ticket. The build script validates the ticket and Gatekeeper acceptance before uploading the artifact. The workflow cleans up the keychain and credential files even when a build fails. Pull request builds don't use Apple credentials.

## iOS

`ios/` is a SwiftUI app (iOS 26+) for browsing on a phone. It reads the catalogue from polyfork.dev directly, not from the desktop app's library. Thumbnails are cached, and a model's USDZ export is downloaded the first time it's opened, so it can be viewed offline afterwards. RealityKit shows the model, and AR Quick Look places it in the room. The USDZ export has no animations.

The Xcode project is generated from `ios/project.yml` with [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
cd ios && xcodegen generate && open Polyfork.xcodeproj
```

## License

The application's original source code is licensed under the [MIT License](LICENSE).

This project is an independent client for [polyfork.dev](https://polyfork.dev/). The name identifies the source of the assets and does not imply endorsement by Polyfork.

Models, thumbnails, animations, and other content downloaded from polyfork.dev are not covered by this project's MIT license. They remain subject to [Polyfork's licensing terms](https://polyfork.dev/licensing) and any asset-specific notices. Free low-poly mesh files are available under either CC BY 4.0 (with attribution and change notices) or the Polyfork license (without attribution, with restrictions on redistribution). The CC BY option does not cover source modules, HD editions, renders, or thumbnails.
