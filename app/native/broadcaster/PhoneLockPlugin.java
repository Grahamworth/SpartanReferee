package com.vdaso.spartans;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The phone's own screen lock, as a banking app uses it: fingerprint or face, with the phone's passcode as well. */
@CapacitorPlugin(name = "PhoneLock")
public class PhoneLockPlugin extends Plugin {
    private static final int ANY_LOCK = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject out = new JSObject();
        out.put("available", BiometricManager.from(getContext()).canAuthenticate(ANY_LOCK) == BiometricManager.BIOMETRIC_SUCCESS);
        call.resolve(out);
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(getActivity(), ContextCompat.getMainExecutor(getContext()), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    JSObject out = new JSObject();
                    out.put("unlocked", true);
                    call.resolve(out);
                }

                @Override
                public void onAuthenticationError(int code, @NonNull CharSequence message) {
                    JSObject out = new JSObject();
                    out.put("unlocked", false);
                    out.put("cancelled", code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON || code == BiometricPrompt.ERROR_CANCELED);
                    out.put("message", message.toString());
                    call.resolve(out);
                }
                // a finger it didn't recognise: the prompt stays up for another go, so there's nothing to do here
            });
            prompt.authenticate(new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock HeadJudge Broadcaster")
                .setSubtitle("Use your fingerprint or phone passcode")
                .setAllowedAuthenticators(ANY_LOCK)
                .build());
        });
    }
}
