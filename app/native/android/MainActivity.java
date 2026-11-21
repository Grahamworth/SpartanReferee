package com.vdaso.spartans;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StationPlugin.class);
        registerPlugin(SpeechPlugin.class);
        super.onCreate(savedInstanceState);
        // The phone's back button: back a page; it only leaves the app from the homepage.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge().getWebView();
                if (!isHomepage(web) && web.canGoBack()) { web.goBack(); return; }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    // the Broadcaster's only page, or the SpartanReferee app's start: Learning's overview (/learn/ with no #/page after it)
    private static boolean isHomepage(WebView web) {
        String url = web.getUrl();
        if (url == null) return true;
        Uri uri = Uri.parse(url);
        String path = uri.getPath(), page = uri.getFragment();
        if (path != null && (path.equals("/learn/") || path.equals("/learn/index.html"))) return page == null || page.isEmpty() || page.equals("/");
        return path == null || path.isEmpty() || path.equals("/") || path.equals("/index.html") || path.equals("/app.html");
    }
}
