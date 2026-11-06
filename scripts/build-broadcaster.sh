#!/usr/bin/env bash
# Packages the camera station on its own as the Spartans Broadcaster app (Android): a phone that only films and
# streams, to the judging laptop and/or YouTube. Same camera page and native streaming screen as the Spartans app,
# without the rest of the app, sign-in or the referee check, so it can go on any phone.
#   bash scripts/build-broadcaster.sh
# Needs Node, JDK 21 and the Android SDK (as build-app.sh). Writes downloads/spartans-broadcaster.apk
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="${SPARTANS_BROADCAST_BUILD:-${TEMP:-/tmp}/spartans-broadcaster}"
export ANDROID_HOME="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
APP_ID=com.vdaso.spartans.broadcast
mkdir -p "$BUILD" "$SRC/downloads"
cat > "$BUILD/capacitor.config.json" <<EOF
{
  "appId": "$APP_ID",
  "appName": "Spartans Broadcaster",
  "webDir": "www",
  "backgroundColor": "#1f2328",
  "android": { "allowMixedContent": true },
  "server": { "androidScheme": "https" }
}
EOF
cp "$SRC/app/package.json" "$BUILD/"

# the web side: the camera page as the app's only page
rm -rf "$BUILD/www" && mkdir -p "$BUILD/www/vendor"
for f in camera.js styles.css hub.css hub-pages.css looks.css looks.js; do cp "$SRC/$f" "$BUILD/www/"; done
cp "$SRC/vendor/jsQR.min.js" "$BUILD/www/vendor/"
cp -r "$SRC/icons" "$BUILD/www/"
node -e "
const fs = require('fs');
let h = fs.readFileSync(process.argv[1], 'utf8');
h = h.replace(/<title>[^<]*<\/title>/, '<title>Spartans Broadcaster</title>')
  .replace(/<script type=\"module\" src=\"judge-gate.js\"><\/script>\s*/, '')      // no sign-in or referee check
  .replace(/<link rel=\"manifest\"[^>]*>\s*/, '')
  .replace(/<a href=\"\.\/\" class=\"home-link\">[^<]*<\/a>/, '')                   // nothing to go back to
  .replace(/<h1 class=\"brand\">Camera <span>station<\/span><\/h1>/, '<h1 class=\"brand\">Spartans <span>Broadcaster</span></h1>')
  // the setup guide, big and first: everything a camera person needs (opens in the phone's browser)
  .replace(/ <p class=\"muted\"><a href=\"streaming.html\">[\s\S]*?<\/p>/, '\n  <a class=\"btn btn-red btn-big setup-guide\" href=\"https://mango-glacier-03e711403.4.azurestaticapps.net/streaming.html#phone\">📖 Setup guide: start here</a>\n  <p class=\"muted\" style=\"margin-top:6px\">Tailscale, scanning the laptop\\'s code, where to put the camera, and what to do if it won\\'t connect.</p>')
  .replace(/station's <b>Spartans app<\/b> QR code/g, \"station's <b>Broadcaster</b> QR code\")
  .replace('The camera station needs the Spartans app on an Android phone.', 'This needs the Spartans Broadcaster app on an Android phone.')
  .replace('</style>','  .setup-guide { display: flex; width: 100%; justify-content: center; text-align: center; margin: 14px 0 4px; clip-path: none; font-size: 1.5rem; padding: 18px; }\n</style>')
  .replace(/href=\"downloads\/spartans.apk\"/, 'href=\"https://mango-glacier-03e711403.4.azurestaticapps.net/downloads/spartans-broadcaster.apk\"');
fs.writeFileSync(process.argv[2], h);
" "$SRC/camera.html" "$BUILD/www/index.html"

cd "$BUILD"
[ -d node_modules/@capacitor/cli ] || npm install --no-audit --no-fund
[ -d android ] || npx cap add android
npx cap sync android

# the native camera screen (RootEncoder from JitPack), in this app's own package
JAVA="android/app/src/main/java/${APP_ID//.//}"
mkdir -p "$JAVA"
for f in "$SRC"/app/native/android/*.java; do sed "s/^package com\.vdaso\.spartans;/package $APP_ID;/" "$f" > "$JAVA/$(basename "$f")"; done
GR=android/app/build.gradle
grep -q jitpack "$GR" || sed -i "s#dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs'#&\n    }\n    maven { url 'https://jitpack.io'#" "$GR"
grep -q RootEncoder "$GR" || sed -i 's#implementation project(.:capacitor-android.)#&\n    implementation "com.github.pedroSG94.RootEncoder:library:2.8.1"#' "$GR"
MAN=android/app/src/main/AndroidManifest.xml
grep -q ACCESS_NETWORK_STATE "$MAN" || sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#<queries><package android:name="com.tailscale.ipn" /></queries>\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />\n    &#' "$MAN"
grep -q 'android.permission.CAMERA' "$MAN" || sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />#' "$MAN"
grep -q StationActivity "$MAN" || sed -i 's#<provider#<activity android:name=".StationActivity" android:exported="false" android:screenOrientation="sensorLandscape" android:configChanges="orientation|screenSize|keyboardHidden" android:theme="@style/AppTheme.NoActionBar" />\n\n        <provider#' "$MAN"
for d in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  dir="android/app/src/main/res/mipmap-${d%%:*}"
  [ -d "$dir" ] && node "$SRC/scripts/resize-icon.cjs" "$SRC/icons/icon-512.png" "${d##*:}" "$dir/ic_launcher.png" "$dir/ic_launcher_round.png" "$dir/ic_launcher_foreground.png"
done

(cd android && ./gradlew assembleDebug --no-daemon -q)
cp android/app/build/outputs/apk/debug/app-debug.apk "$SRC/downloads/spartans-broadcaster.apk"
ls -la "$SRC/downloads/spartans-broadcaster.apk"
