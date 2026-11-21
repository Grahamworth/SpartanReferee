#!/usr/bin/env bash
# Tries the Android app in an emulator and keeps a screenshot of each step (.github/workflows/android-app.yml runs it on GitHub's
# Linux machines; this PC's emulator is too short of memory). Nobody signs in: that needs a person.
#   bash scripts/test-app-android.sh <app.apk> <folder for the pictures>
set -uo pipefail
APK="$1"; OUT="$2"; ID="${SPARTANREFEREE_APP_ID:-com.vdaso.spartanreferee}"
mkdir -p "$OUT"
shot() { tap_text "Wait" anr > /dev/null 2>&1 && sleep 2; adb exec-out screencap -p > "$OUT/$1.png"; echo "picture: $1"; }
open_app() { adb shell monkey -p "$ID" -c android.intent.category.LAUNCHER 1 > /dev/null; }
signal() { adb shell svc wifi "$1"; adb shell svc data "$1"; }
top() { adb shell dumpsys activity activities | grep -m1 -E "topResumedActivity|mResumedActivity" | sed 's/^ *//'; }
tap_text() { # taps the middle of the first thing on screen showing this text (web pages included)
  adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui-$2.xml" > /dev/null 2>&1
  local b; b=$(grep -o "<node[^>]*\(text\|content-desc\)=\"$1\"[^>]*>" "$OUT/ui-$2.xml" | head -1 | grep -o 'bounds="[^"]*"' | grep -o '[0-9]\+' | tr '\n' ' ')
  [ -n "$b" ] || { echo "not on screen: $1"; return 1; }
  set -- $b; adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 )); echo "tapped: $b"
}
adb install -r "$APK" || exit 1
adb shell settings put global window_animation_scale 0
# the emulator's own "isn't responding" boxes (its launcher is slow on a fresh boot) would cover the app: none, and a minute to settle
adb shell settings put global hide_error_dialogs 1
sleep 60

echo "1. The very first opening, with no signal: the app's own no-connection page"
signal disable; sleep 3; open_app; sleep 15; shot 1-first-opening-no-signal
adb shell am force-stop "$ID"; signal enable; sleep 10

echo "2. With signal: Learning's sign-in"
open_app; sleep 35; shot 2-sign-in; echo "   on top: $(top)"

echo "3. Sign in with Microsoft: Microsoft's page, inside the app"
if tap_text "Sign in with Microsoft" 3; then sleep 15; shot 3-microsoft; echo "   on top: $(top)"; fi

echo "4. The back button: back to the sign-in"
adb shell input keyevent 4; sleep 10; shot 4-back; echo "   on top: $(top)"

echo "5. No signal again, after a first visit: the copy the service worker keeps"
adb shell am force-stop "$ID"; signal disable; sleep 3; open_app; sleep 20; shot 5-no-signal-after-a-visit
signal enable

echo "6. The launcher's icon"
adb shell am force-stop "$ID"; adb shell input keyevent 3; sleep 3; adb shell input swipe 540 1800 540 300 300; sleep 4; shot 6-launcher

adb logcat -d -s Capacitor:* Capacitor/Console:* chromium:* AndroidRuntime:E > "$OUT/logcat.txt" 2>&1
grep -c "FATAL EXCEPTION" "$OUT/logcat.txt" && echo "the app crashed: see logcat.txt" || true
exit 0
