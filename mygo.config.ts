import { defineConfig } from "mygo-cli";

export default defineConfig({
  name: "Polyfork",
  identifier: "me.limboy.polyfork",
  version: "0.3.0",
  // `mygo dev` runs devCommand and loads devUrl; `mygo build` runs
  // buildCommand and embeds frontendDist into the app.
  devUrl: "http://localhost:5173",
  devCommand: "bun run dev:web",
  buildCommand: "bun run build:web",
  frontendDist: "dist",
  bindings: "src/mygo.ts",
  out: "build",
  macos: {
    signingIdentity: process.env.APPLE_SIGNING_IDENTITY,
    notarize: process.env.APPLE_NOTARY_PROFILE
      ? {
          keychainProfile: process.env.APPLE_NOTARY_PROFILE,
          keychain: process.env.APPLE_KEYCHAIN_PATH,
        }
      : undefined,
  },
});
