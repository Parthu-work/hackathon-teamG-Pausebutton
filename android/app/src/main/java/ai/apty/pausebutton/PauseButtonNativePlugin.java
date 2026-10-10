package ai.apty.pausebutton;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.FirebaseApp;

import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.json.JSONObject;

/**
 * What the web app can ask of the phone, inside the Android app only
 * (src/lib/client/native.ts: registerPlugin("PauseButtonNative")):
 * connect this phone's message watcher and see how it is doing, open the
 * Android settings it needs, and the notification permission. Every Android
 * prompt comes after the web app explained it, and a "no" leaves the app
 * working: Android 13+ is never asked again once the person refused for good.
 */
@CapacitorPlugin(
        name = "PauseButtonNative",
        permissions = @Permission(strings = {Manifest.permission.POST_NOTIFICATIONS}, alias = PauseButtonNativePlugin.NOTIFICATIONS))
public class PauseButtonNativePlugin extends Plugin {
    static final String NOTIFICATIONS = "notifications";

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    /** Whether the person had said "Don't allow" once before the prompt now on screen (see notificationsAnswered). */
    private boolean rationaleBefore;

    /** The app came back to the front (maybe from Android's settings): tell the server, send what waits. */
    @Override
    protected void handleOnResume() {
        if (Prefs.token(getContext()) == null) return;
        boolean on = Watcher.listenerEnabled(getContext());
        // Access is on but Android has not bound the listener (after an update, or killed on some phones): ask again.
        if (on && Prefs.consented(getContext()) && !Prefs.listenerConnected(getContext())) MessageWatcherService.requestRebindQuietly(getContext());
        Watcher w = Watcher.get(getContext());
        w.reportStatus(on);
        w.kick();
    }

    /** { code, host? } → { ok, error?, userName? }: trades the code from "Connect this phone" for this phone's token. */
    @PluginMethod
    public void pair(PluginCall call) {
        String code = call.getString("code", "").trim().toUpperCase(Locale.ROOT);
        String given = call.getString("host");
        String host = Prefs.trimSlash(given != null && !given.trim().isEmpty() ? given.trim() : site());
        if (code.length() < 4) {
            call.resolve(new JSObject().put("ok", false).put("error", "Type the code shown on the screen."));
            return;
        }
        io.execute(() -> {
            String error = Watcher.get(getContext()).pair(host, code, Watcher.deviceName());
            if (error != null) {
                call.resolve(new JSObject().put("ok", false).put("error", error));
                return;
            }
            Watcher.get(getContext()).reportStatus(Watcher.listenerEnabled(getContext()));
            JSObject r = new JSObject().put("ok", true);
            String userName = Prefs.userName(getContext());
            if (userName != null && !userName.isEmpty()) r.put("userName", userName);
            call.resolve(r);
        });
    }

    /** The Connect screen's view of the watcher. Counts only, never senders or text. */
    @PluginMethod
    public void watcherStatus(PluginCall call) {
        int waiting = Watcher.get(getContext()).waiting();
        long lastDeliveredAt = Prefs.lastDeliveredAt(getContext());
        JSObject r = new JSObject();
        r.put("paired", Prefs.token(getContext()) != null);
        r.put("userName", orNull(Prefs.userName(getContext())));
        r.put("consented", Prefs.consented(getContext()));
        r.put("listenerOn", Watcher.listenerEnabled(getContext()));
        r.put("batteryUnrestricted", Watcher.batteryUnrestricted(getContext()));
        r.put("waiting", waiting);
        r.put("lastError", orNull(Prefs.lastError(getContext())));
        r.put("lastDeliveredAt", lastDeliveredAt > 0 ? (Object) lastDeliveredAt : JSONObject.NULL);
        r.put("today", Prefs.today(getContext()).describe(waiting));
        call.resolve(r);
    }

    /** Agreeing comes first (ConsentActivity, which then opens the setting); after that, Android's notification access settings. */
    @PluginMethod
    public void openListenerSettings(PluginCall call) {
        if (!Prefs.consented(getContext())) start(new Intent(getContext(), ConsentActivity.class), null);
        else start(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS), null);
        call.resolve();
    }

    /** Android's "Allow Pause Button to always run in the background?" */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        start(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName())),
                new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        call.resolve();
    }

    /** "Disconnect this phone": forgotten here at once, the server told now or once it can be reached, no more syncs. */
    @PluginMethod
    public void disconnect(PluginCall call) {
        Watcher.get(getContext()).disconnect(call::resolve);
    }

    @PluginMethod
    public void notificationStatus(PluginCall call) {
        call.resolve(notificationState());
    }

    /**
     * Asks Android for the notification permission (Android 13+), only when
     * it can still ask: once the person refused for good, this answers
     * denied without a prompt, and the web app offers Android's settings.
     */
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || notificationsAllowed() || Prefs.notificationsRefused(getContext())) {
            call.resolve(notificationState());
            return;
        }
        rationaleBefore = getActivity().shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS);
        requestPermissionForAlias(NOTIFICATIONS, call, "notificationsAnswered");
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        if (!notificationsAllowed()) {
            boolean rationaleNow = getActivity().shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS);
            // Android stops explaining only after a refusal for good. The very first prompt can also end
            // like that when the person just closed it, which is not a refusal: it may be asked again.
            if (!rationaleNow && (rationaleBefore || Prefs.notificationsAsked(getContext()))) Prefs.setNotificationsRefused(getContext(), true);
        }
        Prefs.setNotificationsAsked(getContext());
        call.resolve(notificationState());
    }

    /** Android's notification settings for this app (where a refusal for good is undone). */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        start(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName()),
                new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())));
        call.resolve();
    }

    /** Push through Firebase works only in a build made with google-services.json; otherwise the web app does not register. */
    @PluginMethod
    public void pushAvailable(PluginCall call) {
        boolean available;
        try {
            available = !FirebaseApp.getApps(getContext()).isEmpty();
        } catch (RuntimeException | LinkageError e) {
            available = false;
        }
        call.resolve(new JSObject().put("available", available));
    }

    // ----------------------------------------------------------------

    /** { permission: granted | denied | prompt, canAskAgain }. */
    private JSObject notificationState() {
        String permission;
        boolean canAskAgain;
        if (notificationsAllowed()) {
            permission = "granted";
            canAskAgain = true;
            // Allowed in Android's settings since a refusal: a later refusal counts afresh.
            if (Prefs.notificationsRefused(getContext())) Prefs.setNotificationsRefused(getContext(), false);
        } else if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || Prefs.notificationsRefused(getContext())) {
            permission = "denied"; // switched off in Android's settings: only the person can switch it back on
            canAskAgain = false;
        } else if (getActivity().shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
            permission = "denied"; // refused once: Android asks once more
            canAskAgain = true;
        } else {
            permission = "prompt";
            canAskAgain = true;
        }
        return new JSObject().put("permission", permission).put("canAskAgain", canAskAgain);
    }

    /** Allowed and not switched off for the app (below Android 13 there is no permission, only the switch). */
    private boolean notificationsAllowed() {
        boolean permitted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        return permitted && NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
    }

    /** The site the WebView shows: where this phone connects by default. */
    private String site() {
        String url = getBridge() != null ? getBridge().getServerUrl() : null;
        return url != null ? url : Prefs.site();
    }

    private void start(Intent intent, Intent fallback) {
        try {
            getActivity().startActivity(intent);
        } catch (ActivityNotFoundException e) {
            if (fallback != null) {
                try {
                    getActivity().startActivity(fallback);
                } catch (ActivityNotFoundException ignored) {
                    // Nothing on this phone handles it: the web app's own steps still say what to do.
                }
            }
        }
    }

    private static Object orNull(String s) {
        return s == null || s.isEmpty() ? JSONObject.NULL : s;
    }
}
