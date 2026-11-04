package com.vdaso.spartans;

import android.Manifest;
import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.pedro.common.ConnectChecker;
import com.pedro.encoder.input.sources.video.Camera2Source;
import com.pedro.library.multiple.MultiStream;
import com.pedro.library.multiple.MultiType;
import com.pedro.library.util.streamclient.StreamBaseClient;

/**
 * Camera station: films with the phone's camera and sends the one encoded picture to two places at once,
 * each on its own connection: the judging computer (MediaMTX over RTMP, through Tailscale) and YouTube (RTMPS).
 * Either can be left out. Each reconnects by itself if it drops, without affecting the other.
 * The judging computer may have several routes ("url1|url2": direct on the same Wi-Fi first, then Tailscale):
 * when one won't connect, the next is tried.
 */
public class StationActivity extends Activity implements SurfaceHolder.Callback {
    private static final int JUDGE = 0, YOUTUBE = 1;
    private static final int GREY = 0xff9a9a9a, AMBER = 0xffffb020, GREEN = 0xff33d17a, RED = 0xffff4d4d;

    private MultiStream stream;
    private SurfaceView view;
    private final TextView[] state = new TextView[2];
    private TextView clock;
    private Button go;
    private final String[] url = new String[2];
    private String youtubeBackup;
    private String[] judgeRoutes = new String[0];
    private int judgeRoute = 0;
    private boolean wantLive = false;
    private long startedAt;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        String judge = blankToNull(getIntent().getStringExtra("judge"));
        if (judge != null) judgeRoutes = judge.split("\\|");
        url[JUDGE] = judgeRoutes.length > 0 ? judgeRoutes[0] : null;
        url[YOUTUBE] = blankToNull(getIntent().getStringExtra("youtube"));
        // YouTube over RTMPS (the stream key stays private); plain RTMP if RTMPS won't connect
        youtubeBackup = url[YOUTUBE] == null ? null : url[YOUTUBE].replaceFirst("^rtmps://a\\.rtmps\\.youtube\\.com(:443)?/", "rtmp://a.rtmp.youtube.com/");
        buildScreen(getIntent().getStringExtra("label"));
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO}, 1);
        } else {
            setUp();
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        for (int r : results) {
            if (r != PackageManager.PERMISSION_GRANTED) {
                setState(JUDGE, "The camera and microphone are needed to stream", RED);
                go.setEnabled(false);
                return;
            }
        }
        setUp();
    }

    private void setUp() {
        stream = new MultiStream(this, new ConnectChecker[]{checker(JUDGE), checker(YOUTUBE)}, null, null, null);
        int height = getIntent().getIntExtra("height", 720);
        int width = height * 16 / 9;
        int kbps = getIntent().getIntExtra("bitrate", 3500);
        // keyframe every second: the judge picks the picture up quickly, and YouTube asks for 2 s or less
        boolean ok = stream.prepareVideo(width, height, kbps * 1000, 30, 1) && stream.prepareAudio(44100, true, 128 * 1000);
        if (!ok) {
            setState(JUDGE, "This phone can't film at " + width + "×" + height + ": pick a lower quality", RED);
            go.setEnabled(false);
            return;
        }
        for (int i = 0; i < 2; i++) {
            stream.getStreamClient(MultiType.RTMP, i).setReTries(1_000_000);
            // give up on a route quickly (a Wi-Fi address that isn't reachable from here), so the next is tried
            if (i == JUDGE && judgeRoutes.length > 1) stream.getStreamClient(MultiType.RTMP, i).setSocketTimeout(4000);
            setState(i, url[i] == null ? "Not set" : "Ready", GREY);
        }
        if (view.getHolder().getSurface().isValid() && !stream.isOnPreview()) stream.startPreview(view, false);
    }

    private ConnectChecker checker(final int i) {
        return new ConnectChecker() {
            @Override public void onConnectionStarted(String u) { setState(i, "Connecting" + route(i) + "…", AMBER); }
            @Override public void onConnectionSuccess() { setState(i, "LIVE" + route(i), GREEN); }
            @Override public void onConnectionFailed(String reason) {
                if (!wantLive || stream == null) return;
                StreamBaseClient c = stream.getStreamClient(MultiType.RTMP, i);
                String why = i == YOUTUBE && reason != null && reason.toLowerCase().contains("configure stream")
                        ? "(YouTube refused: check the stream key, and that live streaming is on for the channel)" : plain(reason);
                String next = null;
                if (i == YOUTUBE) next = youtubeBackup;
                else if (judgeRoutes.length > 1) { judgeRoute = (judgeRoute + 1) % judgeRoutes.length; next = judgeRoutes[judgeRoute]; }
                // moving on to the next route: straight away; back round to the first: after a pause
                long delay = i == JUDGE && judgeRoute != 0 ? 500 : 3000;
                if (c.reTry(delay, reason, next)) setState(i, "Trying" + route(i) + "… " + why, AMBER);
                else setState(i, "Can't connect: " + why, RED);
            }
            @Override public void onDisconnect() { if (!wantLive) setState(i, url[i] == null ? "Not set" : "Stopped", GREY); }
            @Override public void onAuthError() { setState(i, "Wrong name or password", RED); }
            @Override public void onAuthSuccess() { }
        };
    }

    private void toggle() {
        if (stream == null) return;
        if (!wantLive) {
            if (url[JUDGE] == null && url[YOUTUBE] == null) return;
            wantLive = true;
            startedAt = SystemClock.elapsedRealtime();
            judgeRoute = 0;
            if (judgeRoutes.length > 0) url[JUDGE] = judgeRoutes[0];
            for (int i = 0; i < 2; i++) if (url[i] != null) stream.startStream(MultiType.RTMP, i, url[i]);
            go.setText("STOP");
            tick();
        } else {
            stopAll();
        }
    }

    private void stopAll() {
        wantLive = false;
        if (stream != null) {
            for (int i = 0; i < 2; i++) if (url[i] != null) stream.stopStream(MultiType.RTMP, i);
            if (stream.isStreaming()) stream.stopStream();
        }
        go.setText("GO LIVE");
        clock.setText("");
    }

    private void tick() {
        if (!wantLive) return;
        long s = (SystemClock.elapsedRealtime() - startedAt) / 1000;
        clock.setText(String.format("%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60));
        ui.postDelayed(this::tick, 1000);
    }

    // ---- the preview follows the screen
    @Override public void surfaceCreated(SurfaceHolder h) { if (stream != null && !stream.isOnPreview()) stream.startPreview(view, false); }
    @Override public void surfaceChanged(SurfaceHolder h, int f, int w, int hgt) { if (stream != null) stream.getGlInterface().setPreviewResolution(w, hgt); }
    @Override public void surfaceDestroyed(SurfaceHolder h) { if (stream != null && stream.isOnPreview()) stream.stopPreview(); }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (stream != null) {
            stopAll();
            if (stream.isOnPreview()) stream.stopPreview();
            stream.release();
        }
        super.onDestroy();
    }

    // ---- the screen: camera picture, the two destinations' state on top, buttons on the right
    private void buildScreen(String label) {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        view = new SurfaceView(this);
        view.getHolder().addCallback(this);
        root.addView(view, new FrameLayout.LayoutParams(-1, -1));

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.VERTICAL);
        top.setPadding(dp(14), dp(10), dp(14), dp(10));
        top.setBackgroundColor(0x99000000);
        TextView title = text(label == null || label.isEmpty() ? "Camera station" : label, 16, Color.WHITE);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        top.addView(title);
        state[JUDGE] = text("", 14, GREY);
        state[YOUTUBE] = text("", 14, GREY);
        top.addView(row("Judging computer", state[JUDGE]));
        top.addView(row("YouTube", state[YOUTUBE]));
        FrameLayout.LayoutParams tl = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START);
        tl.setMargins(dp(10), dp(10), dp(10), dp(10));
        root.addView(top, tl);

        LinearLayout side = new LinearLayout(this);
        side.setOrientation(LinearLayout.VERTICAL);
        side.setGravity(Gravity.CENTER_HORIZONTAL);
        clock = text("", 15, Color.WHITE);
        side.addView(clock);
        go = new Button(this);
        go.setText("GO LIVE");
        go.setTextColor(Color.WHITE);
        go.setTextSize(16);
        GradientDrawable red = new GradientDrawable();
        red.setShape(GradientDrawable.OVAL);
        red.setColor(0xffe2231a);
        red.setStroke(dp(4), Color.WHITE);
        go.setBackground(red);
        go.setOnClickListener(v -> toggle());
        LinearLayout.LayoutParams gl = new LinearLayout.LayoutParams(dp(96), dp(96));
        gl.setMargins(0, dp(8), 0, dp(14));
        side.addView(go, gl);
        Button flip = small("Flip camera");
        flip.setOnClickListener(v -> { if (stream != null && stream.getVideoSource() instanceof Camera2Source) ((Camera2Source) stream.getVideoSource()).switchCamera(); });
        side.addView(flip);
        Button close = small("Close");
        close.setOnClickListener(v -> finish());
        side.addView(close);
        FrameLayout.LayoutParams sl = new FrameLayout.LayoutParams(-2, -2, Gravity.END | Gravity.CENTER_VERTICAL);
        sl.setMargins(dp(10), dp(10), dp(18), dp(10));
        root.addView(side, sl);
        setContentView(root);
    }

    private View row(String name, TextView value) {
        LinearLayout r = new LinearLayout(this);
        r.setPadding(0, dp(4), 0, 0);
        TextView n = text(name + ":  ", 14, Color.WHITE);
        r.addView(n);
        r.addView(value);
        return r;
    }

    private TextView text(String s, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        return t;
    }

    private Button small(String s) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setBackgroundColor(0x99000000);
        return b;
    }

    private void setState(int i, String s, int color) {
        ui.post(() -> { state[i].setText(s); state[i].setTextColor(color); });
    }

    /** " (direct)" / " (Tailscale)": which route the judging computer is on */
    private String route(int i) {
        if (i != JUDGE || judgeRoutes.length == 0) return "";
        String u = judgeRoutes[judgeRoute];
        return u.matches("^rtmps?://100\\.(6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\..*") ? " (Tailscale)" : " (direct)";
    }

    private static String plain(String reason) {
        if (reason == null) return "";
        String r = reason.toLowerCase();
        if (r.contains("timeout") || r.contains("timed out")) return "(no answer: is Tailscale on?)";
        if (r.contains("refused")) return "(refused: is the server running?)";
        if (r.contains("unreachable") || r.contains("unknown host")) return "(no internet / Tailscale off?)";
        return "(" + (reason.length() > 60 ? reason.substring(0, 60) + "…" : reason) + ")";
    }

    private static String blankToNull(String s) { return s == null || s.trim().isEmpty() ? null : s.trim(); }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
