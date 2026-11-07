#!/usr/bin/env bash
set -euo pipefail

required=(APPLE_CERTIFICATE_P12_BASE64 ASC_PRIVATE_KEY_BASE64 ASC_KEY_ID ASC_ISSUER_ID)
configured=0
for name in "${required[@]}"; do
  if [[ -n "${!name:-}" ]]; then
    configured=$((configured + 1))
  fi
done
if [[ "$configured" -eq 0 ]]; then
  echo "Apple secrets aren't configured; building with ad hoc signing."
  exit 0
fi
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing GitHub Actions secret: $name" >&2
    exit 1
  fi
done

: "${RUNNER_TEMP:?This script runs on a GitHub Actions macOS runner.}"
: "${GITHUB_ENV:?GitHub Actions environment file is required.}"
umask 077

certificate="$RUNNER_TEMP/polyfork-signing.p12"
api_key="$RUNNER_TEMP/polyfork-notary.p8"
keychain="$RUNNER_TEMP/polyfork-signing.keychain-db"
keychain_password="$(openssl rand -hex 32)"
printf '::add-mask::%s\n' "$keychain_password"

printf '%s' "$APPLE_CERTIFICATE_P12_BASE64" | base64 --decode > "$certificate"
printf '%s' "$ASC_PRIVATE_KEY_BASE64" | base64 --decode > "$api_key"

security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$certificate" -P "${APPLE_CERTIFICATE_PASSWORD:-}" \
  -k "$keychain" -t cert -f pkcs12 -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -k "$keychain_password" "$keychain" > /dev/null
security list-keychains -d user -s "$keychain"

identity="$(security find-identity -v -p codesigning "$keychain" | \
  awk '/"Developer ID Application:/ { print $2; exit }')"
if [[ ! "$identity" =~ ^[0-9A-Fa-f]{40}$ ]]; then
  echo "The certificate must contain a valid Developer ID Application identity and private key." >&2
  exit 1
fi

xcrun notarytool store-credentials polyfork-notary \
  --key "$api_key" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" \
  --keychain "$keychain"

{
  printf 'APPLE_SIGNING_IDENTITY=%s\n' "$identity"
  printf 'APPLE_NOTARY_PROFILE=polyfork-notary\n'
  printf 'APPLE_KEYCHAIN_PATH=%s\n' "$keychain"
} >> "$GITHUB_ENV"

# The signing identity is now held by the temporary keychain. The workflow's
# cleanup step removes the API key and keychain after notarization finishes.
rm -f "$certificate"
