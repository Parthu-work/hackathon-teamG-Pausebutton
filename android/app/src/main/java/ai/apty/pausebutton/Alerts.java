package ai.apty.pausebutton;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;

import java.io.IOException;

import org.json.JSONException;

/**
 * Shows the server's push alerts as Android notifications, the way
 * public/sw.js shows them in a browser: urgent ones loud and on the lock
 * screen with their buttons (Block payment, It's fine), a newer one about the
 * same message replacing the older one, and a tap opening the app on the
 * alert. Also the "You blocked it" that follows Block on the lock screen.
 */
final class Alerts {
    static final String CHANNEL_URGENT = "alerts-urgent";
    static final String CHANNEL = "alerts";
    /** Same rhythm as the browser's urgent alert (sw.js), after Android's leading pause. */
    private static final long[] URGENT_VIBRATION = {0, 400, 150, 400, 150, 400, 150, 800};
    private static final String EXTRA_CHECK_ID = "pb_check_id";
    private static final int AMBER = 0xFFF2A900;

    private Alerts() {}

    /** Both channels; creating one that exists changes nothing (the person's own choices stay). */
    static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel urgent = new NotificationChannel(CHANNEL_URGENT, "Urgent alerts", NotificationManager.IMPORTANCE_HIGH);
        urgent.setDescription("A payment is paused or a scam was found. Loud, and on the lock screen with a Block button.");
        urgent.enableVibration(true);
        urgent.setVibrationPattern(URGENT_VIBRATION);
        nm.createNotificationChannel(urgent);
        NotificationChannel quiet = new NotificationChannel(CHANNEL, "Alerts", NotificationManager.IMPORTANCE_DEFAULT);
        quiet.setDescription("Answers from your family and other news from Pause Button.");
        nm.createNotificationChannel(quiet);
    }

    /** Shows the alert. Returns null when it is on screen, else why not (for the receipt). */
    static String show(Context c, PushAlert a) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return "NoNotificationManager";
        channels(c);
        String channel = a.urgent ? CHANNEL_URGENT : CHANNEL;
        if (!nm.areNotificationsEnabled()) return "NotificationsOff";
        NotificationChannel ch = nm.getNotificationChannel(channel);
        if (ch != null && ch.getImportance() == NotificationManager.IMPORTANCE_NONE) return "ChannelOff";
        if (a.checkId != null) replaceOlder(nm, a.checkId, a.tag);

        Bundle extras = new Bundle();
        if (a.checkId != null) extras.putString(EXTRA_CHECK_ID, a.checkId);
        Notification.Builder b = new Notification.Builder(c, channel)
                .setSmallIcon(R.drawable.ic_stat_pause)
                .setColor(AMBER)
                .setContentTitle(a.title)
                .setContentText(a.body)
                .setStyle(new Notification.BigTextStyle().bigText(a.body))
                .setContentIntent(open(c, a.url, a.tag, a.tag.hashCode()))
                .setAutoCancel(true)
                .setOnlyAlertOnce(false)
                .addExtras(extras);
        if (a.at > 0) b.setWhen(a.at).setShowWhen(true);
        if (a.urgent) b.setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PUBLIC);
        for (PushAlert.Action action : a.actions) {
            PendingIntent tap = "block".equals(action.action)
                    ? NotificationActionReceiver.block(c, a.holdId, a.who, a.tag)
                    : open(c, "/family/hold/" + a.holdId + "?approve=1", a.tag, (a.tag + "|fine").hashCode());
            b.addAction(new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_stat_pause), action.title, tap).build());
        }
        try {
            nm.notify(a.tag, a.notificationId(), b.build());
            return null;
        } catch (SecurityException e) {
            return "NotificationsOff"; // not allowed to post (Android 13+ without the permission)
        }
    }

    /** A notice that follows a lock-screen Block (its tag: hold-<holdId>, as in sw.js). */
    static void notice(Context c, String holdId, PushAlert.Notice n) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        channels(c);
        String tag = "hold-" + holdId;
        PendingIntent tap = open(c, n.url, tag, tag.hashCode());
        Notification.Builder b = new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_pause)
                .setColor(AMBER)
                .setContentTitle(n.title)
                .setContentText(n.body)
                .setStyle(new Notification.BigTextStyle().bigText(n.body))
                .setContentIntent(tap)
                .setAutoCancel(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC);
        if (n.button != null) b.addAction(new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_stat_pause), n.button, tap).build());
        try {
            nm.notify(tag, tag.hashCode(), b.build());
        } catch (SecurityException e) {
            // Notifications not allowed: the family screen shows the outcome when opened.
        }
    }

    /** Takes the notification with this tag off the screen (a button on it was used). */
    static void cancel(Context c, String tag) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null && tag != null) nm.cancel(tag, tag.hashCode());
    }

    /** Tells the server the push arrived and whether it is on screen, so a push that reaches no one is noticed. Never fails. */
    static void receipt(PushAlert a, String notShownBecause) {
        if (a.receipt == null) return;
        try {
            Backend.post(Prefs.site(), "/api/push/receipt", null, a.receiptBody(notShownBecause == null, notShownBecause));
        } catch (IOException | JSONException e) {
            // Best effort, like the browser's receipt.
        }
    }

    /** Opens the app on a page of its own site; the notification with {@code tag} goes away. */
    static PendingIntent open(Context c, String path, String tag, int requestCode) {
        Intent i = new Intent(c, MainActivity.class)
                .putExtra(MainActivity.EXTRA_URL, path)
                .putExtra(MainActivity.EXTRA_CANCEL, tag)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        // A request code per notification and button: one notification's page never replaces another's.
        return PendingIntent.getActivity(c, requestCode, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** A heads-up was followed by the urgent alert about the same message: only the newer one stays. */
    private static void replaceOlder(NotificationManager nm, String checkId, String tag) {
        try {
            for (StatusBarNotification s : nm.getActiveNotifications()) {
                Bundle ex = s.getNotification().extras;
                if (ex != null && checkId.equals(ex.getString(EXTRA_CHECK_ID)) && !tag.equals(s.getTag())) nm.cancel(s.getTag(), s.getId());
            }
        } catch (RuntimeException e) {
            // Could not list them: both stay, which is harmless.
        }
    }
}
