#!/usr/bin/env bash
# Packages the site as the Spartans app: an Android APK (built here) and the iPhone Xcode project (to build on a Mac).
#   bash scripts/build-app.sh
# Needs Node, JDK 21 and the Android SDK (ANDROID_HOME, or the default %LOCALAPPDATA%\Android\Sdk).
# Builds in a short temporary folder (deep folders break the Android tools on Windows), then writes
#   downloads/spartans.apk and downloads/spartans-ios-project.zip
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="${SPARTANS_BUILD:-${TEMP:-/tmp}/spartans-app}"
export ANDROID_HOME="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
mkdir -p "$BUILD" "$SRC/downloads"
cp "$SRC/app/package.json" "$SRC/app/capacitor.config.json" "$BUILD/"

# the web files the app carries (everything the site serves, except downloads and the PC streaming kit)
rm -rf "$BUILD/www" && mkdir -p "$BUILD/www"
WEB="index.html judge.html course.html chat.html camera.html profile.html admin.html news.html past.html
  styles.css hub.css hub-pages.css looks.css looks.js streaming.html phone.html scoreboard.html scoreboard.js judging.html hub.js hub-edit.js chat.js camera.js profile.js admin.js news.js past.js api-base.js judge-gate.js
  manifest.webmanifest app.js burpee.js exercises.js pose-filter.js multi.js finder.js ocr-prep.js readers.js digit-model.js
  digit-model.json rtmo-s.onnx course-world.js course-game.js course-people.js course-crowd.js course-sky.js course-look.js
  course-map.js course-games.js course-rules.js course-obstacles.js"
for f in $WEB; do cp "$SRC/$f" "$BUILD/www/"; done
cp -r "$SRC/icons" "$SRC/vendor" "$SRC/courses" "$BUILD/www/"

cd "$BUILD"
[ -d node_modules/@capacitor/cli ] && [ -d node_modules/@capgo/capacitor-social-login ] || npm install --no-audit --no-fund
[ -d android ] || npx cap add android
[ -d ios ] || npx cap add ios
npx cap sync

# Android: the camera station (native streaming screen, RootEncoder from JitPack)
JAVA=android/app/src/main/java/com/vdaso/spartans
cp "$SRC"/app/native/android/*.java "$JAVA/"
GR=android/app/build.gradle
grep -q jitpack "$GR" || sed -i "s#dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs'#&\n    }\n    maven { url 'https://jitpack.io'#" "$GR"
grep -q RootEncoder "$GR" || sed -i 's#implementation project(.:capacitor-android.)#&\n    implementation "com.github.pedroSG94.RootEncoder:library:2.8.1"#' "$GR"

# Android: the camera (judging), the voice and the app icon
MAN=android/app/src/main/AndroidManifest.xml
grep -q TTS_SERVICE "$MAN" || sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#<queries><intent><action android:name="android.intent.action.TTS_SERVICE" /></intent></queries>\n    &#' "$MAN"
grep -q ACCESS_NETWORK_STATE "$MAN" || sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#<queries><package android:name="com.tailscale.ipn" /></queries>\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />\n    &#' "$MAN"
grep -q 'android.permission.CAMERA' "$MAN" || sed -i 's#<uses-permission android:name="android.permission.INTERNET" />#<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />#' "$MAN"
grep -q StationActivity "$MAN" || sed -i 's#<provider#<activity android:name=".StationActivity" android:exported="false" android:screenOrientation="sensorLandscape" android:configChanges="orientation|screenSize|keyboardHidden" android:theme="@style/AppTheme.NoActionBar" />\n\n        <provider#' "$MAN"
for d in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  dir="android/app/src/main/res/mipmap-${d%%:*}"
  [ -d "$dir" ] && node "$SRC/scripts/resize-icon.cjs" "$SRC/icons/icon-512.png" "${d##*:}" "$dir/ic_launcher.png" "$dir/ic_launcher_round.png" "$dir/ic_launcher_foreground.png"
done
# iPhone: the camera note Apple requires, and the app icon
PL=ios/App/App/Info.plist
grep -q NSCameraUsageDescription "$PL" || sed -i 's#<dict>#<dict>\n\t<key>NSCameraUsageDescription</key>\n\t<string>The Burpee Judge uses the camera to count burpees.</string>\n\t<key>NSMicrophoneUsageDescription</key>\n\t<string>Evidence videos can include sound.</string>#' "$PL"
ICON_DIR=ios/App/App/Assets.xcassets/AppIcon.appiconset
[ -d "$ICON_DIR" ] && for f in "$ICON_DIR"/*.png; do cp "$SRC/icons/icon-1024.png" "$f"; done

(cd android && ./gradlew assembleDebug --no-daemon -q)
cp android/app/build/outputs/apk/debug/app-debug.apk "$SRC/downloads/spartans.apk"
rm -f "$SRC/downloads/spartans-ios-project.zip"
(powershell.exe -NoProfile -Command "Compress-Archive -Path '$(cygpath -w "$BUILD/ios")', '$(cygpath -w "$BUILD/capacitor.config.json")', '$(cygpath -w "$BUILD/package.json")' -DestinationPath '$(cygpath -w "$SRC/downloads/spartans-ios-project.zip")'")
ls -la "$SRC/downloads"
