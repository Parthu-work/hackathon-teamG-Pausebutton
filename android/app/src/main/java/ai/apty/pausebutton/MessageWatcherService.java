package ai.apty.pausebutton;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcelable;
import android.provider.Settings;
import android.provider.Telephony;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Screens M1–M4 in real life: once the person agreed (ConsentActivity) and
 * allowed notification access, this service sees every new SMS and WhatsApp
 * notification and hands its text to the {@link Watcher}, which decides
 * whether it leaves the phone and gets it to the server even through a
 * network outage or a restart. It never reads old chats and never sends
 * anything itself.
 */
public class MessageWatcherService extends NotificationListenerService {
    private static final Set<String> WHATSAPP = new HashSet<>(Arrays.asList("com.whatsapp", "com.whatsapp.w4b"));
    private static final Set<String> SMS = new HashSet<>(Arrays.asList(
            "com.google.android.apps.messaging", // Google Messages
            "com.samsung.android.messaging",     // Samsung Messages
            "com.android.mms", "com.android.messaging",
            "com.oneplus.mms", "com.miui.sms", "com.sonymobile.android.mms"));
    /**
     * SMS apps that also post other notifications (Truecaller: calls and caller ID).
     * Read only for message notifications, like whichever app the person made their
     * default SMS app, so a phone whose SMS app is not listed above is watched too.
     */
    private static final Set<String> SMS_TOO = new HashSet<>(Arrays.asList(
            "com.truecaller", "com.microsoft.android.smsorganizer"));

    private ConnectivityManager.NetworkCallback network;

    @Override
    public void onListenerConnected() {
        Prefs.setListenerConnected(this, true);
        watchNetwork();
        Watcher w = Watcher.get(this);
        w.reportStatus(true);
        // After a reboot, an update or the system killing the app: send what waited.
        w.kick();
    }

    @Override
    public void onListenerDisconnected() {
        Prefs.setListenerConnected(this, false);
        stopWatchingNetwork();
        // Ask Android to bind the listener again (some phones do not on their own).
        requestRebindQuietly(this);
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String pkg = sbn.getPackageName();
        String channel = channelFor(pkg);
        if (channel == null) return; // other apps: not read
        if (!Prefs.consented(this)) { // before the person agreed: not read, only noted for the Connect screen
            Prefs.setLastSkip(this, Watcher.NOT_CONSENTED);
            return;
        }
        Notification n = sbn.getNotification();
        if (n == null || n.extras == null) return;
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return; // "3 new messages", not a message

        Bundle ex = n.extras;
        // An app read only for its messages (the default SMS app, Truecaller): not its calls or other notices.
        if (!WHATSAPP.contains(pkg) && !SMS.contains(pkg) && !"com.android.shell".equals(pkg)
                && !Notification.CATEGORY_MESSAGE.equals(n.category) && ex.getParcelableArray(Notification.EXTRA_MESSAGES) == null) return;
        String sender = str(ex.getCharSequence(Notification.EXTRA_TITLE));
        String text = str(ex.getCharSequence(Notification.EXTRA_BIG_TEXT));
        if (text.isEmpty()) text = str(ex.getCharSequence(Notification.EXTRA_TEXT));

        // Chat-style notifications carry the messages themselves: use the newest one.
        Parcelable[] messages = ex.getParcelableArray(Notification.EXTRA_MESSAGES);
        if (messages != null && messages.length > 0 && messages[messages.length - 1] instanceof Bundle) {
            Bundle last = (Bundle) messages[messages.length - 1];
            String t = str(last.getCharSequence("text"));
            String s = str(last.getCharSequence("sender"));
            if (!t.isEmpty()) text = t;
            if (sender.isEmpty() && !s.isEmpty()) sender = s;
        }
        if (sender.isEmpty() || text.isEmpty() || looksLikeSummary(text)) return;
        Watcher.get(this).onMessage(pkg, channel, sender, text);
    }

    private String channelFor(String pkg) {
        if (WHATSAPP.contains(pkg)) return "whatsapp";
        if (SMS.contains(pkg) || SMS_TOO.contains(pkg)) return "sms";
        // Debug builds also accept notifications posted from `adb shell cmd notification post`, for testing.
        if (BuildConfig.DEBUG && "com.android.shell".equals(pkg)) return "sms";
        if (!pkg.equals(getPackageName()) && pkg.equals(defaultSmsApp(this))) return "sms";
        return null;
    }

    /** The app the person chose for SMS (no permission needed to ask), or null. */
    private static String defaultSmsApp(Context c) {
        try {
            return Telephony.Sms.getDefaultSmsPackage(c);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * Android's notification access switch for Pause Button: its own page
     * (Android 11+), so the person does not have to find it in a list.
     */
    static Intent accessSettings(Context c) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                    .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, new ComponentName(c, MessageWatcherService.class).flattenToString());
        }
        return accessList();
    }

    /** The list of apps with notification access: where the switch is on phones without the page above. */
    static Intent accessList() {
        return new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
    }

    /**
     * Android 13+ keeps notification access locked ("Restricted setting", the
     * switch greyed out) for an app installed from a downloaded APK rather than
     * an app store, until the person taps ⋮ › Allow restricted settings on the
     * app's App info page.
     */
    static boolean mayBeRestricted(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false;
        try {
            String installer = c.getPackageManager().getInstallSourceInfo(c.getPackageName()).getInstallingPackageName();
            return !"com.android.vending".equals(installer);
        } catch (PackageManager.NameNotFoundException | RuntimeException e) {
            return true;
        }
    }

    /** The app's App info page, where ⋮ › Allow restricted settings is. */
    static Intent appInfo(Context c) {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.getPackageName()));
    }

    /** The network came back: what waited goes now instead of after the backoff. */
    private void watchNetwork() {
        if (network != null) return;
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        if (cm == null) return;
        network = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network n) {
                Watcher.get(MessageWatcherService.this).kick();
            }
        };
        try {
            cm.registerDefaultNetworkCallback(network);
        } catch (RuntimeException e) {
            network = null; // the backoff and the next message still get things out
        }
    }

    private void stopWatchingNetwork() {
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        if (cm != null && network != null) {
            try {
                cm.unregisterNetworkCallback(network);
            } catch (RuntimeException ignored) {
                // Already gone.
            }
        }
        network = null;
    }

    /** Rebinds the listener; harmless when it is bound already or access is off. */
    static void requestRebindQuietly(Context c) {
        try {
            requestRebind(new ComponentName(c, MessageWatcherService.class));
        } catch (RuntimeException ignored) {
            // Notification access is off: nothing to rebind.
        }
    }

    static String str(CharSequence cs) {
        return cs == null ? "" : cs.toString().trim();
    }

    static boolean looksLikeSummary(String text) {
        return text.matches("(?i)^\\d+ new messages?.*") || text.matches("(?i)^\\d+ messages? from .*");
    }
}
