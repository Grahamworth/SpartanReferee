#!/usr/bin/env bash
# Packages the camera station on its own as the SpartanReferee Broadcaster app (Android): a phone that only films and
# streams, to the judging server and/or YouTube. Same camera page and native streaming screen as the Spartans app,
# without the rest of the app, sign-in or the referee check, so it can go on any phone. It needs no account: it only
# connects by scanning a camera's code, and only someone signed in to the company's server can see those.
#   bash scripts/build-broadcaster.sh
# Needs Node, JDK 21 and the Android SDK (as build-app.sh). Writes downloads/spartans-broadcaster.apk
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="${SPARTANREFEREE_BROADCAST_BUILD:-${TEMP:-/tmp}/spartanreferee-broadcaster}" # its own build folder: HeadJudge's has another app id
export ANDROID_HOME="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
APP_ID=com.vdaso.spartanreferee.broadcast # its own app, so it installs beside HeadJudge Broadcaster rather than replacing it
mkdir -p "$BUILD" "$SRC/downloads"
cat > "$BUILD/capacitor.config.json" <<EOF
{
  "appId": "$APP_ID",
  "appName": "SpartanReferee Broadcaster",
  "webDir": "www",
  "backgroundColor": "#0b0b0b",
  "android": { "allowMixedContent": true },
  "server": { "androidScheme": "https" }
}
EOF
cp "$SRC/app/package.json" "$BUILD/"

# the web side: its own page in SpartanReferee's look (broadcaster.html), working as the Spartans camera page does (camera.js)
rm -rf "$BUILD/www" && mkdir -p "$BUILD/www/vendor" "$BUILD/www/icons"
cp "$SRC/camera.js" "$SRC/headjudge.css" "$BUILD/www/"
cp "$SRC/broadcaster.html" "$BUILD/www/index.html"
cp "$SRC/vendor/jsQR.min.js" "$BUILD/www/vendor/"
cp -r "$SRC/icons/spartanreferee" "$BUILD/www/icons/"

cd "$BUILD"
[ -d node_modules/@capacitor/cli ] || npm install --no-audit --no-fund
[ -d android ] || npx cap add android
npx cap sync android
sed -i -E 's#(<string name="(app_name|title_activity_main)">)[^<]*#\1SpartanReferee Broadcaster#' android/app/src/main/res/values/strings.xml

# the native camera screen (RootEncoder from JitPack), in this app's own package
JAVA="android/app/src/main/java/${APP_ID//.//}"
mkdir -p "$JAVA"
# in Spartan colours, as the native screen already is: a red GO LIVE button with white lettering, on black panels
for f in "$SRC"/app/native/android/*.java; do
  sed -e "s/^package com\.vdaso\.spartans;/package $APP_ID;/" \
      -e 's/"Judging computer"/"Judging server"/' -e 's/"Camera station"/"Camera"/' "$f" > "$JAVA/$(basename "$f")"
done
GR=android/app/build.gradle
grep -q jitpack "$GR" || sed -i "s#dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs'#&\n    }\n    maven { url 'https://jitpack.io'#" "$GR"
grep -q RootEncoder "$GR" || sed -i 's#implementation project(.:capacitor-android.)#&\n    implementation "com.github.pedroSG94.RootEncoder:library:2.8.1"#' "$GR"
MAN=android/app/src/main/AndroidManifest.xml
grep -q ACCESS_NETWORK_STATE "$MAN" || sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#<queries><package android:name="com.tailscale.ipn" /></queries>\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />\n    &#' "$MAN"
grep -q 'android.permission.CAMERA' "$MAN" || sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />#' "$MAN"
grep -q StationActivity "$MAN" || sed -i 's#<provider#<activity android:name=".StationActivity" android:exported="false" android:screenOrientation="sensorLandscape" android:configChanges="orientation|screenSize|keyboardHidden" android:theme="@style/AppTheme.NoActionBar" />\n\n        <provider#' "$MAN"
for d in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  dir="android/app/src/main/res/mipmap-${d%%:*}"
  [ -d "$dir" ] && node "$SRC/scripts/resize-icon.cjs" "$SRC/icons/spartanreferee/icon-512.png" "${d##*:}" "$dir/ic_launcher.png" "$dir/ic_launcher_round.png" "$dir/ic_launcher_foreground.png"
done

# the launcher icon's background, behind the helmet
sed -i -E 's|<color name="ic_launcher_background">[^<]*|<color name="ic_launcher_background">#0b0b0b|' android/app/src/main/res/values/ic_launcher_background.xml

(cd android && ./gradlew assembleDebug --no-daemon -q)
cp android/app/build/outputs/apk/debug/app-debug.apk "$SRC/downloads/spartans-broadcaster.apk"
ls -la "$SRC/downloads/spartans-broadcaster.apk"
