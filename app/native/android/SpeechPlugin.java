package com.vdaso.spartans;

import android.speech.tts.TextToSpeech;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

/** Says things out loud for the web pages: Android's in-app browser has no speech of its own. */
@CapacitorPlugin(name = "Speech")
public class SpeechPlugin extends Plugin {
    private TextToSpeech tts;
    private boolean ready;

    @Override
    public void load() {
        tts = new TextToSpeech(getContext(), (status) -> {
            if (status != TextToSpeech.SUCCESS) return;
            tts.setLanguage(Locale.ENGLISH);
            ready = true;
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        if (!ready) { call.reject("Speech isn't ready"); return; }
        tts.setSpeechRate(call.getFloat("rate", 1f));
        tts.speak(call.getString("text", ""), TextToSpeech.QUEUE_FLUSH, null, "say");
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (ready) tts.stop();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) tts.shutdown();
    }
}
