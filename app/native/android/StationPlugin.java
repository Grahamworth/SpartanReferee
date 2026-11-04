package com.vdaso.spartans;

import android.content.Intent;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Opens the camera station screen (StationActivity) from the web page: camera.html. */
@CapacitorPlugin(name = "Station")
public class StationPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        Intent i = new Intent(getContext(), StationActivity.class);
        i.putExtra("judge", call.getString("judge", ""));
        i.putExtra("youtube", call.getString("youtube", ""));
        i.putExtra("label", call.getString("label", "Camera station"));
        i.putExtra("height", call.getInt("height", 720));
        i.putExtra("bitrate", call.getInt("bitrate", 3500));
        getActivity().startActivity(i);
        call.resolve();
    }
}
