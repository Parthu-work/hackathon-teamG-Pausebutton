#!/usr/bin/env bash
# Fails unless the APK is signed with the shared debug key (android/debug.keystore),
# so a newer APK always installs over an older one. Needs keytool (a JDK) and
# apksigner (Android build-tools 36.0.0).
#
#   scripts/check-apk-signer.sh android/app/build/outputs/apk/debug/app-debug.apk
set -euo pipefail

apk="${1:?usage: scripts/check-apk-signer.sh <apk>}"
apksigner="${APKSIGNER:-$ANDROID_HOME/build-tools/36.0.0/apksigner}"
want=$(keytool -list -v -keystore android/debug.keystore -storepass android -alias androiddebugkey \
  | sed -n 's/.*SHA256: //p' | tr -d ': ' | tr 'A-F' 'a-f')
got=$("$apksigner" verify --print-certs "$apk" | sed -n 's/.*certificate SHA-256 digest: //p' | head -1)
echo "APK signer: $got"
echo "Shared key: $want"
if [ -z "$want" ] || [ "$got" != "$want" ]; then
  echo "::error::$apk is not signed with android/debug.keystore, so it would not install over earlier versions."
  exit 1
fi
