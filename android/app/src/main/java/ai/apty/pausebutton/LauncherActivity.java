package ai.apty.pausebutton;

import android.net.Uri;

/**
 * Opens the Pause Button web app as a Trusted Web Activity: full screen in
 * Chrome, so everything the web app can do (push notifications, the dialer,
 * vibration) works here too. The address comes from the build (PB_HOST) or
 * from the Connect screen if the person changed it.
 */
public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    @Override
    protected Uri getLaunchingUrl() {
        Uri fromIntent = getIntent() != null ? getIntent().getData() : null;
        if (fromIntent != null && fromIntent.getScheme() != null && fromIntent.getScheme().startsWith("http")) {
            return fromIntent;
        }
        return Uri.parse(Prefs.host(this));
    }
}
