package ai.apty.pausebutton;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.CookieManager;

import com.getcapacitor.BridgeActivity;

/**
 * The app: the hosted Pause Button site (capacitor.config.ts, server.url) in
 * Capacitor's WebView, full screen, no browser bar. The web app reaches the
 * phone through {@link PauseButtonNativePlugin}. A notification or the Share
 * sheet opens it on a page of the site (intent extra {@link #EXTRA_URL}).
 */
public class MainActivity extends BridgeActivity {
    /** A page of the app's own site to show, e.g. "/open/<alertId>" or "/share?text=…". Nothing else is loaded. */
    static final String EXTRA_URL = "pb_url";
    /** The tag of the notification that opened the app (a button on it was used): it goes away. */
    static final String EXTRA_CANCEL = "pb_cancel";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PauseButtonNativePlugin.class);
        super.onCreate(savedInstanceState); // loads the site, then hands the starting intent to onNewIntent
        if (Prefs.token(this) != null) SyncWorker.schedule(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openPage(intent);
    }

    @Override
    public void onPause() {
        super.onPause();
        // The sign-in cookie on disk now, so Block on a lock-screen notification works once the app is closed.
        // (No bridge: Android's WebView is missing or being updated, and CookieManager would throw.)
        if (bridge != null) CookieManager.getInstance().flush();
    }

    private void openPage(Intent intent) {
        if (intent == null) return;
        Alerts.cancel(this, intent.getStringExtra(EXTRA_CANCEL));
        String path = intent.getStringExtra(EXTRA_URL);
        // Once: not again when the activity is recreated with the same intent.
        intent.removeExtra(EXTRA_URL);
        intent.removeExtra(EXTRA_CANCEL);
        if (bridge == null || !PushAlert.isAppPath(path)) return;
        String site = bridge.getServerUrl() != null ? Prefs.trimSlash(bridge.getServerUrl()) : Prefs.site();
        bridge.getWebView().loadUrl(site + path);
    }
}
