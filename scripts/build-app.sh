#!/usr/bin/env bash
# Builds SpartanReferee's phone apps for Google Play and the App Store (Capacitor): the referee site in an app of its own, opening on
# Learning's overview. The app shows the live site, so every site deploy reaches the apps with no store update; its service worker
# keeps the saved lessons, rules and handbook for no signal (sw.js). Only app/referee/no-connection.html is carried in the app, for
# a first opening with no signal. Android also gets the native camera screen (app/native/android), as the Broadcaster has.
#
#   bash scripts/build-app.sh android   (Windows or Linux: Node, JDK 21 and the Android SDK, as build-broadcaster.sh)
#     writes downloads/spartanreferee.aab (for Google Play) and downloads/spartanreferee.apk (to install directly), both signed with
#     the upload key named in ~/.spartanreferee/upload.properties (see README "The phone apps"); with no key they're left unsigned
#   bash scripts/build-app.sh ios       (a Mac with Xcode 26: GitHub's Mac builders run it, .github/workflows/iphone-app.yml)
#     writes build/ios/SpartanReferee-simulator.app (for the Simulator) and build/ios/SpartanReferee.xcarchive; signed and sent to
#     App Store Connect when APP_STORE_CONNECT_KEY_PATH, APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID and APPLE_TEAM_ID are set
#
# The app's id is fixed for good once it's in a store: SPARTANREFEREE_APP_ID changes it (default com.vdaso.spartanreferee). The
# version shown in the stores is VERSION below; the build number is the number of commits, so each build is higher than the last.
set -euo pipefail
PLATFORM="${1:-android}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
SITE=https://brave-forest-022879f03.3.azurestaticapps.net
APP_ID="${SPARTANREFEREE_APP_ID:-com.vdaso.spartanreferee}"
APP_NAME=SpartanReferee
VERSION=1.0.0
BUILD_NO="$(git -C "$SRC" rev-list --count HEAD)"
BUILD="${SPARTANREFEREE_APP_BUILD:-${TEMP:-/tmp}/spartanreferee-app}" # short and outside the repo: deep folders break the Android tools on Windows
mkdir -p "$BUILD"

# ---------------------------------------------------------------- the same for both
cat > "$BUILD/capacitor.config.json" <<EOF
{
  "appId": "$APP_ID",
  "appName": "$APP_NAME",
  "webDir": "www",
  "backgroundColor": "#0b0b0b",
  "appendUserAgent": "SpartanRefereeApp/$VERSION",
  "server": {
    "url": "$SITE/learn/",
    "errorPath": "no-connection.html",
    "allowNavigation": ["login.microsoftonline.com", "login.microsoft.com", "login.live.com", "account.live.com", "account.microsoft.com"]
  },
  "android": { "allowMixedContent": true },
  "ios": { "limitsNavigationsToAppBoundDomains": true, "contentInset": "never", "scrollEnabled": true },
  "plugins": { "SystemBars": { "insetsHandling": "css", "initialViewportFitValueHint": "cover" } }
}
EOF
cp "$SRC/app/package.json" "$BUILD/"
rm -rf "$BUILD/www" && mkdir -p "$BUILD/www"
# the no-connection page, with its texts in every language from i18n/<code>.json
node -e '
  const fs = require("fs"), [src, out, site] = process.argv.slice(1);
  let html = fs.readFileSync(`${src}/app/referee/no-connection.html`, "utf8");
  const keys = [...html.matchAll(/data-t>([^<]+)</g)].map((m) => m[1].trim());
  const strings = {};
  for (const f of fs.readdirSync(`${src}/i18n`).filter((f) => /^[a-z]{2}\.json$/.test(f) && f !== "en.json")) {
    const d = JSON.parse(fs.readFileSync(`${src}/i18n/${f}`, "utf8")), t = {};
    for (const k of keys) if (typeof d[k] === "string") t[k] = d[k];
    strings[f.slice(0, 2)] = t;
  }
  html = html.replace("/*STRINGS*/{}", JSON.stringify(strings)).replace("__SITE__", site)
    // the icon inside the page: the app serves only this one file of its own while the site is out of reach
    .replace("src=\"icon.png\"", `src="data:image/png;base64,${fs.readFileSync(`${src}/icons/spartanreferee/icon-192.png`).toString("base64")}"`);
  fs.writeFileSync(`${out}/no-connection.html`, html);
  fs.writeFileSync(`${out}/index.html`, `<!doctype html><meta charset="utf-8"><script>location.replace(${JSON.stringify(site + "/learn/")})</script>`);
' "$SRC" "$BUILD/www" "$SITE"

cd "$BUILD"
[ -d node_modules/@capacitor/cli ] || npm install --no-audit --no-fund

# ---------------------------------------------------------------- Android
if [ "$PLATFORM" = android ]; then
  export ANDROID_HOME="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
  [ -d android ] || npx cap add android
  npx cap sync android
  sed -i -E "s#(<string name=\"(app_name|title_activity_main)\">)[^<]*#\1$APP_NAME#" android/app/src/main/res/values/strings.xml

  # the native camera screen (RootEncoder from JitPack) and the phone's own voice, in this app's package
  JAVA="android/app/src/main/java/${APP_ID//.//}"
  mkdir -p "$JAVA"
  for f in "$SRC"/app/native/android/*.java; do
    sed -e "s/^package com\.vdaso\.spartans;/package $APP_ID;/" -e 's/"Judging computer"/"Judging server"/' -e 's/"Camera station"/"Camera"/' "$f" > "$JAVA/$(basename "$f")"
  done
  GR=android/app/build.gradle
  grep -q jitpack "$GR" || sed -i "s#dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs'#&\n    }\n    maven { url 'https://jitpack.io'#" "$GR"
  grep -q RootEncoder "$GR" || sed -i 's#implementation project(.:capacitor-android.)#&\n    implementation "com.github.pedroSG94.RootEncoder:library:2.8.1"#' "$GR"
  sed -i -E "s/versionCode [0-9]+/versionCode $BUILD_NO/; s/versionName \"[^\"]*\"/versionName \"$VERSION\"/" "$GR"
  # signing with the upload key, when this computer has it (never in the repo)
  cat > android/app/signing.gradle <<'EOF'
def where = System.getenv('SPARTANREFEREE_SIGNING') ?: "${System.getProperty('user.home')}/.spartanreferee/upload.properties"
def f = new File(where)
if (f.exists()) {
    def p = new Properties()
    f.withInputStream { p.load(it) }
    android.signingConfigs { upload { storeFile new File(p.storeFile); storePassword p.storePassword; keyAlias p.keyAlias; keyPassword p.keyPassword } }
    android.buildTypes.release.signingConfig android.signingConfigs.upload
} else {
    println "No upload key at $where: the release builds are unsigned"
}
EOF
  grep -q signing.gradle "$GR" || printf "\napply from: 'signing.gradle'\n" >> "$GR"

  # the camera (judging on the phone, the camera screen), the voice, the network checks the camera screen makes
  MAN=android/app/src/main/AndroidManifest.xml
  grep -q TTS_SERVICE "$MAN" || sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#<queries><intent><action android:name="android.intent.action.TTS_SERVICE" /></intent></queries>\n    &#' "$MAN"
  grep -q ACCESS_NETWORK_STATE "$MAN" || sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#<queries><package android:name="com.tailscale.ipn" /></queries>\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />\n    &#' "$MAN"
  grep -q 'android.permission.CAMERA' "$MAN" || sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />\n    <uses-feature android:name="android.hardware.microphone" android:required="false" />#' "$MAN"
  grep -q StationActivity "$MAN" || sed -i 's#<provider#<activity android:name=".StationActivity" android:exported="false" android:screenOrientation="sensorLandscape" android:configChanges="orientation|screenSize|keyboardHidden" android:theme="@style/AppTheme.NoActionBar" />\n\n        <provider#' "$MAN"

  # icons and splash screens: the helmet on black
  node "$SRC/scripts/app-images.cjs" android android/app/src/main/res
  sed -i -E 's|<color name="ic_launcher_background">[^<]*|<color name="ic_launcher_background">#0b0b0b|' android/app/src/main/res/values/ic_launcher_background.xml

  (cd android && ./gradlew bundleRelease assembleRelease --no-daemon -q)
  mkdir -p "$SRC/downloads"
  cp android/app/build/outputs/bundle/release/app-release.aab "$SRC/downloads/spartanreferee.aab"
  APK=android/app/build/outputs/apk/release/app-release.apk; [ -f "$APK" ] || APK=android/app/build/outputs/apk/release/app-release-unsigned.apk
  cp "$APK" "$SRC/downloads/spartanreferee.apk"
  echo "Android $VERSION ($BUILD_NO), $APP_ID:"
  ls -la "$SRC/downloads/spartanreferee.aab" "$SRC/downloads/spartanreferee.apk"
  exit 0
fi

# ---------------------------------------------------------------- iPhone (on a Mac)
[ "$PLATFORM" = ios ] || { echo "usage: bash scripts/build-app.sh android|ios"; exit 1; }
[ -d ios ] || npx cap add ios --packagemanager SPM
npx cap sync ios
PL=ios/App/App/Info.plist
pb() { /usr/libexec/PlistBuddy -c "$1" "$PL" >/dev/null 2>&1 || true; }
put() { pb "Delete :$1"; /usr/libexec/PlistBuddy -c "Add :$1 $2 $3" "$PL"; }
put CFBundleDisplayName string "$APP_NAME"
put NSCameraUsageDescription string "SpartanReferee uses the camera to judge reps and to film an event's obstacles."
put NSMicrophoneUsageDescription string "SpartanReferee listens when you ask the Assistant a question out loud, and videos filmed for judging can include sound."
put ITSAppUsesNonExemptEncryption bool false
# the service worker (offline lessons) only runs in an app that lists its sites (10 at most): the referee site, Microsoft's sign-in
# and YouTube (a slide's video plays in a YouTube frame, learn/video.js)
pb "Delete :WKAppBoundDomains"; /usr/libexec/PlistBuddy -c "Add :WKAppBoundDomains array" "$PL"
i=0; for d in "${SITE#https://}" login.microsoftonline.com login.microsoft.com login.live.com account.live.com account.microsoft.com www.youtube-nocookie.com www.youtube.com; do
  /usr/libexec/PlistBuddy -c "Add :WKAppBoundDomains:$i string $d" "$PL"; i=$((i + 1))
done
node "$SRC/scripts/app-images.cjs" ios ios/App/App/Assets.xcassets

OUT="$SRC/build/ios"; rm -rf "$OUT"; mkdir -p "$OUT"
if [ -d ios/App/App.xcworkspace ]; then WHAT=(-workspace ios/App/App.xcworkspace); else WHAT=(-project ios/App/App.xcodeproj); fi
SETTINGS=(MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD_NO" PRODUCT_BUNDLE_IDENTIFIER="$APP_ID" TARGETED_DEVICE_FAMILY=1)
# for the Simulator: proves it builds, and the workflow opens it to take a picture
xcodebuild "${WHAT[@]}" -scheme App -configuration Release -sdk iphonesimulator -derivedDataPath "$BUILD/dd-sim" \
  CODE_SIGNING_ALLOWED=NO "${SETTINGS[@]}" build -quiet
cp -R "$BUILD/dd-sim/Build/Products/Release-iphonesimulator/App.app" "$OUT/SpartanReferee-simulator.app"

if [ -n "${APP_STORE_CONNECT_KEY_PATH:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  # signed by Apple's cloud signing with the App Store Connect key, and uploaded to App Store Connect (TestFlight, then review)
  AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$APP_STORE_CONNECT_KEY_PATH" -authenticationKeyID "$APP_STORE_CONNECT_KEY_ID" -authenticationKeyIssuerID "$APP_STORE_CONNECT_ISSUER_ID")
  xcodebuild "${WHAT[@]}" -scheme App -configuration Release -sdk iphoneos -archivePath "$OUT/SpartanReferee.xcarchive" \
    DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic "${SETTINGS[@]}" "${AUTH[@]}" archive -quiet
  cat > "$BUILD/export.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>${APP_STORE_UPLOAD:-export}</string>
  <key>teamID</key><string>$APPLE_TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
</dict></plist>
EOF
  xcodebuild -exportArchive -archivePath "$OUT/SpartanReferee.xcarchive" -exportPath "$OUT/export" -exportOptionsPlist "$BUILD/export.plist" "${AUTH[@]}"
  echo "iPhone $VERSION ($BUILD_NO), $APP_ID: signed$([ "${APP_STORE_UPLOAD:-}" = upload ] && echo ' and uploaded to App Store Connect')"
else
  # no Apple account yet: the same build for a real iPhone, unsigned (it compiles; signing comes with the account)
  xcodebuild "${WHAT[@]}" -scheme App -configuration Release -sdk iphoneos -archivePath "$OUT/SpartanReferee.xcarchive" \
    CODE_SIGNING_ALLOWED=NO "${SETTINGS[@]}" archive -quiet
  echo "iPhone $VERSION ($BUILD_NO), $APP_ID: built for iPhone, unsigned (no App Store Connect key set)"
fi
ls -la "$OUT"
